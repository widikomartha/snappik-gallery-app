import { createHash, randomBytes } from "node:crypto";
import { verifyPassword } from "better-auth/crypto";
import type { PoolClient } from "pg";
import { z } from "zod";
import { transaction } from "../../db/pool";
import { body, failure, json, origin, Problem } from "../http";
import { authorizedWorkflow } from "../projects/access";
import { ownerPreview, type OwnerTransaction } from "../inventory/media";
import { confirm, clientSnapshot } from "./results";
import { originalDownload } from "./download";
import { assertOperational } from "../operations/recovery";

type Kind = "main" | "download";
const unavailable = () => new Problem(404,"GALLERY_UNAVAILABLE","Gallery unavailable.");
const digest = (s:string) => createHash("sha256").update(s).digest("hex");
const cookieName = (kind:Kind) => `snappik_gallery_${kind}`;
function parse<T>(schema:z.ZodType<T>,value:unknown):T {
  const p=schema.safeParse(value);if(!p.success)throw new Problem(422,"INVALID_INPUT","Check gallery fields.");return p.data;
}
// Studio -> project locks match owner edits, inventory publication and archive.
async function project(c:PoolClient,token:string) {
  await assertOperational(c,true);
  const ref=(await c.query("SELECT studio_id,id FROM projects WHERE public_token=$1",[token])).rows[0];
  if(!ref)throw unavailable();
  const studio=(await c.query("SELECT id,setup_status,suspended_at FROM studios WHERE id=$1 FOR UPDATE",[ref.studio_id])).rows[0];
  const p=(await c.query("SELECT * FROM projects WHERE studio_id=$1 AND id=$2 AND public_token=$3 FOR UPDATE",[ref.studio_id,ref.id,token])).rows[0];
  if(!p||p.archived_at||studio.suspended_at||studio.setup_status!=="active")throw unavailable();return p;
}
async function workflow(c:PoolClient,p:Record<string,any>,kind:Kind) {
  const w=(await c.query("SELECT *,expires_at IS NULL OR expires_at>clock_timestamp() AS timely FROM project_workflows WHERE studio_id=$1 AND project_id=$2 AND kind=$3",[p.studio_id,p.id,kind])).rows[0];
  if(!w?.enabled||!w.timely)throw unavailable();return w;
}
async function granted(c:PoolClient,p:Record<string,any>,request:Request,kind:Kind) {
  await workflow(c,p,kind);
  const raw=request.headers.get("cookie")?.split(";").map(s=>s.trim()).find(s=>s.startsWith(`${cookieName(kind)}=`))?.slice(cookieName(kind).length+1);
  const g=raw&&/^[\w-]{43}$/.test(raw)?await authorizedWorkflow(c,digest(raw),kind):null;
  if(!g||g.project_id!==p.id||g.studio_id!==p.studio_id)throw new Problem(401,"GALLERY_GRANT_REQUIRED","Enter gallery access again.");
  return digest(raw!);
}
async function selection(c:PoolClient,p:Record<string,any>) {
  const s=(await c.query("SELECT state AS status,revision,saved_at,last_confirmation_id FROM selection_sets WHERE studio_id=$1 AND project_id=$2 FOR UPDATE",[p.studio_id,p.id])).rows[0];
  const w=await workflow(c,p,"main");
  const items=(await c.query(`SELECT i.photo_id,i.note,f.filename,f.folder_path,f.available FROM selection_items i JOIN project_photos f
    ON (f.studio_id,f.project_id,f.id)=(i.studio_id,i.project_id,i.photo_id) WHERE i.studio_id=$1 AND i.project_id=$2 ORDER BY i.photo_id`,[p.studio_id,p.id])).rows;
  const snapshot=s.last_confirmation_id?(await c.query("SELECT id,revision,confirmed_at,items FROM selection_confirmations WHERE studio_id=$1 AND project_id=$2 AND id=$3",[p.studio_id,p.id,s.last_confirmation_id])).rows[0]:null;
  const immutable=snapshot?clientSnapshot(snapshot):null;
  return {...s,quota:w.quota,notes_enabled:p.notes_enabled,items:s.status==="confirmed"&&immutable?immutable.items.map(i=>({...i,available:true})):items,latest_confirmation:immutable};
}
const draft=z.object({expected_revision:z.number().int().positive(),items:z.array(z.object({photo_id:z.uuid(),note:z.string().refine(s=>[...s].length<=500&&!s.includes("\0")&&s.isWellFormed()).default("")}).strict()).max(500)}).strict();

export async function galleryHandler(request:Request) {
  origin(request);
  const url=new URL(request.url);const match=/^\/api\/v1\/g\/([\w-]{32})(?:\/(access|photos|selection(?:\/confirm)?|media\/[^/]+|download\/[^/]+))?$/.exec(url.pathname);
  if(!match)throw unavailable();const token=match[1],action=match[2];
  const kind=parse(z.enum(["main","download"]),url.searchParams.get("workflow")??"main");
  if(action?.startsWith("download/")&&request.method==="GET") {
    if(url.search)throw new Problem(422,"INVALID_INPUT","Unexpected query.");
    const asClient:OwnerTransaction=read=>transaction(async c=>{const p=await project(c,token);await granted(c,p,request,"download");return read(c,{id:p.studio_id,user_id:""});});
    const id=await transaction(async c=>{const p=await project(c,token);await granted(c,p,request,"download");return p.id as string;});
    return originalDownload(request,id,action.slice(9),asClient);
  }
  if(action==="selection/confirm"&&request.method==="POST") {
    if(url.search)throw new Problem(422,"INVALID_INPUT","Unexpected query.");
    const value=await body(request);
    return transaction(async c=>{const p=await project(c,token),actor=await granted(c,p,request,"main");return json(await confirm(c,p,actor,request,value));});
  }
  if(action==="access"&&request.method==="POST") {
    if(url.search)throw new Problem(422,"INVALID_INPUT","Unexpected query.");
    const input=parse(z.object({workflow:z.enum(["main","download"]),password:z.string().max(128).optional()}).strict(),await body(request));
    // Commit the attempt before slow hashing, including wrong-password attempts.
    const snapshot=await transaction(async c=>{
      const p=await project(c,token),w=await workflow(c,p,input.workflow);
      const a=(await c.query(`INSERT INTO gallery_access_attempts(studio_id,project_id,workflow) VALUES($1,$2,$3)
        ON CONFLICT(studio_id,project_id,workflow) DO UPDATE SET
        attempts=CASE WHEN gallery_access_attempts.window_started_at+interval '1 minute'<=clock_timestamp() THEN 1 ELSE gallery_access_attempts.attempts+1 END,
        window_started_at=CASE WHEN gallery_access_attempts.window_started_at+interval '1 minute'<=clock_timestamp() THEN clock_timestamp() ELSE gallery_access_attempts.window_started_at END RETURNING attempts`,[p.studio_id,p.id,input.workflow])).rows[0];
      return {p,w,limited:a.attempts>20};
    });
    if(snapshot.limited){const response=failure(new Problem(429,"RATE_LIMITED","Retry later."));response.headers.set("Retry-After","60");return response;}
    if(snapshot.w.password_hash&&(!input.password||!await verifyPassword({hash:snapshot.w.password_hash,password:input.password})))throw new Problem(403,"ACCESS_DENIED","Access could not be verified.");
    return transaction(async c=>{
      const p=await project(c,token),w=await workflow(c,p,input.workflow);
      if(p.access_version!==snapshot.p.access_version||w.access_version!==snapshot.w.access_version||w.password_hash!==snapshot.w.password_hash)throw unavailable();
      const raw=randomBytes(32).toString("base64url");
      // Re-entering a gate replaces just this browser's current workflow grant.
      const old=request.headers.get("cookie")?.split(";").map(s=>s.trim()).find(s=>s.startsWith(`${cookieName(input.workflow)}=`))?.split("=")[1];
      if(old)await c.query("UPDATE gallery_sessions SET revoked_at=clock_timestamp() WHERE token_hash=$1 AND studio_id=$2 AND project_id=$3 AND workflow=$4",[digest(old),p.studio_id,p.id,input.workflow]);
      const g=(await c.query(`INSERT INTO gallery_sessions(token_hash,studio_id,project_id,workflow,project_access_version,workflow_access_version,expires_at)
        VALUES($1,$2,$3,$4,$5,$6,LEAST(clock_timestamp()+interval '12 hours',$7::timestamptz)) RETURNING expires_at`,[digest(raw),p.studio_id,p.id,input.workflow,p.access_version,w.access_version,w.expires_at])).rows[0];
      const response=json({workflow:input.workflow,expires_at:g.expires_at});
      // The approved runtime is HTTP loopback only; hosted mode must use Secure.
      response.headers.set("Set-Cookie",`${cookieName(input.workflow)}=${raw}; Path=/api/v1/g/${token}; HttpOnly; SameSite=Strict; Max-Age=${Math.max(0,Math.floor((new Date(g.expires_at).getTime()-Date.now())/1000))}${url.protocol==="https:"?"; Secure":""}`);return response;
    });
  }
  if(action?.startsWith("media/")&&request.method==="GET") {
    if([...url.searchParams.keys()].some(k=>k!=="workflow"))throw new Problem(422,"INVALID_INPUT","Unexpected query.");
    const asClient:OwnerTransaction=read=>transaction(async c=>{const p=await project(c,token);await granted(c,p,request,kind);return read(c,{id:p.studio_id,user_id:""});});
    const id=await transaction(async c=>{const p=await project(c,token);await granted(c,p,request,kind);return p.id as string;});
    return ownerPreview(request,id,action.slice(6),asClient);
  }
  const value=request.method==="PUT"?parse(draft,await body(request,1048576)):null;
  return transaction(async c=>{
    const p=await project(c,token);
    if(!action&&request.method==="GET") {
      if(url.search)throw new Problem(422,"INVALID_INPUT","Unexpected query.");
      const workflows=(await c.query("SELECT kind,password_hash IS NOT NULL AS password_required,expires_at FROM project_workflows WHERE studio_id=$1 AND project_id=$2 AND enabled AND (expires_at IS NULL OR expires_at>clock_timestamp()) ORDER BY kind",[p.studio_id,p.id])).rows;
      if(!workflows.length)throw unavailable();
      const settings=(await c.query("SELECT locale FROM studio_settings WHERE studio_id=$1",[p.studio_id])).rows[0];
      return json({workflows,locale:settings?.locale??"id"});
    }
    if(action==="photos"&&request.method==="GET") {
      const q=parse(z.object({workflow:z.enum(["main","download"]).optional(),limit:z.coerce.number().int().min(1).max(100).default(50),cursor:z.uuid().optional(),folder:z.string().max(2000).optional()}).strict(),Object.fromEntries(url.searchParams));
      await granted(c,p,request,kind);
      if(p.source_access_denied)throw new Problem(503,"SOURCE_UNAVAILABLE","Photos unavailable. Retry later.");
      const rows=(await c.query(`SELECT id,filename,folder_path,preview_status FROM project_photos WHERE studio_id=$1 AND project_id=$2 AND available
        AND ($3::uuid IS NULL OR id>$3) AND ($4::text IS NULL OR folder_path=$4) ORDER BY id LIMIT $5`,[p.studio_id,p.id,q.cursor,q.folder,q.limit+1])).rows;
      const folders=(await c.query("SELECT DISTINCT folder_path FROM project_photos WHERE studio_id=$1 AND project_id=$2 AND available ORDER BY folder_path",[p.studio_id,p.id])).rows.map(r=>r.folder_path);
      return json({items:rows.slice(0,q.limit).map(f=>({...f,preview_url:`/api/v1/g/${token}/media/${f.id}?workflow=${kind}`})),next_cursor:rows.length>q.limit?rows[q.limit-1].id:null,folders,inventory_status:p.inventory_status,origin:p.inventory_origin});
    }
    if(action==="selection"&&["GET","PUT"].includes(request.method)) {
      if(url.search)throw new Problem(422,"INVALID_INPUT","Unexpected query.");
      await granted(c,p,request,"main");const current=await selection(c,p);
      if(request.method==="GET")return json(current);
      if(current.status==="confirmed")throw new Problem(409,"SELECTION_LOCKED","Selection is locked.",current.revision);
      if(value!.expected_revision!==current.revision)throw new Problem(409,"REVISION_CONFLICT","Selection changed. Review saved choices.",current.revision);
      const items=value!.items,ids=items.map(i=>i.photo_id);
      if(new Set(ids).size!==ids.length)throw new Problem(422,"INVALID_INPUT","Use unique photo IDs.");
      if(ids.length>current.quota)throw new Problem(422,"QUOTA_EXCEEDED","Maximum selection exceeded.");
      if(!p.notes_enabled&&items.some(i=>i.note&&current.items.find((old:{photo_id:string;note:string})=>old.photo_id===i.photo_id)?.note!==i.note))throw new Problem(422,"NOTES_DISABLED","Notes are disabled.");
      const eligible=(await c.query("SELECT id FROM project_photos WHERE studio_id=$1 AND project_id=$2 AND id=ANY($3::uuid[]) AND available",[p.studio_id,p.id,ids])).rowCount;
      if(eligible!==ids.length)throw new Problem(422,"SOURCE_PHOTO_UNAVAILABLE","Remove unavailable photos before saving.");
      if(p.source_access_denied)throw new Problem(503,"SOURCE_UNAVAILABLE","Photos unavailable. Retry later.");
      await c.query("DELETE FROM selection_items WHERE studio_id=$1 AND project_id=$2",[p.studio_id,p.id]);
      await c.query(`INSERT INTO selection_items(studio_id,project_id,selection_set_id,photo_id,note)
        SELECT $1,$2,s.id,x.photo_id,x.note FROM selection_sets s CROSS JOIN jsonb_to_recordset($3::jsonb) AS x(photo_id uuid,note text) WHERE s.studio_id=$1 AND s.project_id=$2`,[p.studio_id,p.id,JSON.stringify(items)]);
      await c.query("UPDATE selection_sets SET state=$3,revision=revision+1,saved_at=clock_timestamp() WHERE studio_id=$1 AND project_id=$2",[p.studio_id,p.id,ids.length?"selecting":"not_started"]);
      return json(await selection(c,p));
    }
    throw unavailable();
  });
}
