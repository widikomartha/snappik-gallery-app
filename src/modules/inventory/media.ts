import type { PoolClient } from "pg";
import { z } from "zod";
import { localPublicDrive } from "../../adapters/drive-local-config";
import { Problem } from "../http";
import type { SourceScope } from "./provider";

type Studio={id:string;user_id:string};
export type OwnerTransaction=<T>(read:(client:PoolClient,studio:Studio)=>Promise<T>)=>Promise<T>;
type Pointer={scope:SourceScope;sourceRevision:number;origin:string;file:{id:string;version:string;mime:string;size:number;ancestry:string[]|null}};
type Verify=(pointer:Pointer,signal:AbortSignal)=>Promise<void>;
const unavailable=()=>new Problem(503,"SOURCE_UNAVAILABLE","Preview is unavailable. Check source access or retry a sync.");

// Authorize -> provider check without a transaction -> authorize again -> bytes.
// The injectable verifier lets DB race tests exercise revocation during the external wait.
export async function ownerPreview(request:Request,projectId:string,photoId:string,asOwner:OwnerTransaction,
  verify:Verify=async(pointer,signal)=>localPublicDrive(pointer.scope).assertPreviewVisible(pointer.scope,pointer.file,signal)) {
  if(!z.uuid().safeParse(projectId).success||!z.uuid().safeParse(photoId).success)throw new Problem(404,"NOT_FOUND","Not found.");
  async function read(c:PoolClient,studio:Studio,bytes=false){
    const p=(await c.query("SELECT drive_folder_id,source_revision,inventory_origin,archived_at,source_access_denied FROM projects WHERE studio_id=$1 AND id=$2 FOR UPDATE",[studio.id,projectId])).rows[0];
    if(!p||p.archived_at)throw new Problem(404,"NOT_FOUND","Not found.");
    if(p.source_access_denied)throw unavailable();
    const photo=(await c.query(`SELECT provider_file_id,source_version,mime,size_bytes,preview_status,provider_ancestry,
      preview_expires_at IS NOT NULL AS bounded_cache,preview_expires_at IS NULL OR preview_expires_at>clock_timestamp() AS cache_valid${bytes?",preview_bytes":""}
      FROM project_photos WHERE studio_id=$1 AND project_id=$2 AND id=$3 AND available`,[studio.id,projectId,photoId])).rows[0];
    if(!photo)throw new Problem(404,"NOT_FOUND","Not found.");
    if(photo.preview_status!=="ready"||!photo.cache_valid||(p.inventory_origin==="google_public"&&!photo.bounded_cache))throw unavailable();
    return {pointer:{scope:{studioId:studio.id,projectId,rootId:p.drive_folder_id},sourceRevision:p.source_revision,origin:p.inventory_origin,
      file:{id:photo.provider_file_id,version:photo.source_version,mime:photo.mime,size:Number(photo.size_bytes),ancestry:photo.provider_ancestry}} as Pointer,bytes:photo.preview_bytes as Buffer|undefined};
  }
  const initial=await asOwner((c,s)=>read(c,s));
  if(initial.pointer.origin==="google_public"){
    try{await verify(initial.pointer,request.signal);}catch{throw unavailable();}
  }
  return asOwner(async(c,s)=>{
    const current=await read(c,s,true);
    if(request.signal.aborted||!current.bytes||JSON.stringify(current.pointer)!==JSON.stringify(initial.pointer))throw unavailable();
    return new Response(new Uint8Array(current.bytes),{headers:{"Content-Type":"image/jpeg","Content-Length":String(current.bytes.length),"Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff","Content-Security-Policy":"default-src 'none'; sandbox"}});
  });
}
