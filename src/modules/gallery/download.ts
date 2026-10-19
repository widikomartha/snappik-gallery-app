import type { PoolClient } from "pg";
import { z } from "zod";
import { configuredInventoryProvider } from "../../adapters/synthetic-drive";
import { Problem } from "../http";
import type { OwnerTransaction } from "../inventory/media";
import { MAX_BYTES, PHOTO_MIMES, type InventoryProvider, type ProviderFile, type SourceScope } from "../inventory/provider";

type Pointer={scope:SourceScope;source_revision:number;origin:string;ancestry:string[];file:ProviderFile};
type Source=(pointer:Pointer,signal:AbortSignal)=>AsyncIterable<Uint8Array>;
async function* source(p:Pointer,signal:AbortSignal) {
  const configured=configuredInventoryProvider();
  if(!configured||configured.origin!==p.origin)throw Error();
  const provider:InventoryProvider="forScope" in configured?configured.forScope(p.scope):configured;
  async function visible(){if("assertPreviewVisible" in provider)await (provider as InventoryProvider & {assertPreviewVisible:(scope:SourceScope,file:unknown,signal:AbortSignal)=>Promise<void>}).assertPreviewVisible(p.scope,{...p.file,ancestry:p.ancestry},signal);}
  await visible();
  yield* provider.read(p.scope,p.file,signal);
  await visible();
}
export function attachment(filename:string) {
  // Preserve Unicode/name case/extensions; strip path separators and header controls.
  const safe=filename.replace(/[\u0000-\u001f\u007f/\\]/g,"_").slice(0,1024)||"photo";
  const fallback=safe.replace(/[^\x20-\x7e]|[";%]/g,"_");
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(safe).replace(/[!'()*]/g,c=>`%${c.charCodeAt(0).toString(16).toUpperCase()}`)}`;
}
let transfers=0;
// Buffer one bounded original before sending headers: provider truncation/errors cannot
// become a successful attachment. No original is persisted. Local concurrent memory is bounded.
export async function originalDownload(request:Request,projectId:string,photoId:string,asClient:OwnerTransaction,readSource:Source=source,timeoutMs=60000) {
  if(!z.uuid().safeParse(photoId).success)throw new Problem(404,"NOT_FOUND","Not found.");
  const unavailable=()=>new Problem(503,"SOURCE_UNAVAILABLE","Original unavailable. Retry or contact the studio.");
  async function pointer(c:PoolClient,studio:{id:string}) {
    const p=(await c.query("SELECT drive_folder_id,source_revision,inventory_origin,archived_at,source_access_denied FROM projects WHERE studio_id=$1 AND id=$2 FOR UPDATE",[studio.id,projectId])).rows[0];
    if(!p||p.archived_at)throw new Problem(404,"NOT_FOUND","Not found.");
    const f=(await c.query("SELECT provider_file_id,filename,mime,size_bytes,source_version,provider_ancestry FROM project_photos WHERE studio_id=$1 AND project_id=$2 AND id=$3 AND available",[studio.id,projectId,photoId])).rows[0];
    if(!f)throw new Problem(404,"NOT_FOUND","Not found.");
    if(p.source_access_denied||!PHOTO_MIMES.has(f.mime)||Number(f.size_bytes)>MAX_BYTES||Number(f.size_bytes)<=0)throw unavailable();
    return {scope:{studioId:studio.id,projectId,rootId:p.drive_folder_id},source_revision:p.source_revision,origin:p.inventory_origin,ancestry:f.provider_ancestry,
      file:{id:f.provider_file_id,name:f.filename,mime:f.mime,size:Number(f.size_bytes),version:f.source_version,parentId:f.provider_ancestry?.at(-1)??p.drive_folder_id}} as Pointer;
  }
  const before=await asClient(pointer);
  if(transfers>=2)throw new Problem(503,"TEMPORARILY_UNAVAILABLE","Downloads busy. Retry shortly.");
  transfers++;
  const controller=new AbortController();
  const signal=AbortSignal.any([request.signal,controller.signal,AbortSignal.timeout(timeoutMs)]);
  try {
    const chunks:Uint8Array[]=[];let total=0;
    // Race the iterator as well: cancellation/timeout cannot hang on a stalled source.
    const iterator=readSource(before,signal)[Symbol.asyncIterator]();
    const abort=()=>new DOMException("Transfer interrupted","AbortError");
    let onAbort:()=>void=()=>{};
    const stopped=new Promise<never>((_,reject)=>{onAbort=()=>reject(abort());signal.addEventListener("abort",onAbort,{once:true});if(signal.aborted)onAbort();});
    try {for(;;){const {done,value}=await Promise.race([iterator.next(),stopped]);if(done)break;total+=value.length;if(total>MAX_BYTES||total>before.file.size)throw unavailable();chunks.push(value);}}
    finally{signal.removeEventListener("abort",onAbort);void iterator.return?.().catch(()=>{});}
    if(signal.aborted||total!==before.file.size)throw unavailable();
    const bytes=Buffer.concat(chunks,total);
    const mime=bytes[0]===0xff&&bytes[1]===0xd8&&bytes[2]===0xff?"image/jpeg":bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))?"image/png":bytes.toString("ascii",0,4)==="RIFF"&&bytes.toString("ascii",8,12)==="WEBP"?"image/webp":null;
    if(mime!==before.file.mime)throw unavailable();
    return await asClient(async(c,s)=>{
      const after=await pointer(c,s);if(signal.aborted||JSON.stringify(before)!==JSON.stringify(after))throw unavailable();
      return new Response(new Uint8Array(bytes),{headers:{"Content-Type":mime,"Content-Length":String(total),"Content-Disposition":attachment(before.file.name),"Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff","Content-Security-Policy":"default-src 'none'; sandbox"}});
    });
  }catch(e){if(e instanceof Problem)throw e;throw unavailable();}
  finally{controller.abort();transfers--;}
}
