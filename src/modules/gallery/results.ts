import { createHmac } from "node:crypto";
import { config } from "../../config";
import type { PoolClient } from "pg";
import { z } from "zod";
import { entitlement } from "../entitlement";
import { json, Problem } from "../http";

type Scope={studio_id:string;id:string};
type Snapshot={id:string;revision:number;confirmed_at:string;items:Record<string,any>[]};
export const revision=z.object({expected_revision:z.number().int().positive()}).strict();
export function input<T>(schema:z.ZodType<T>,value:unknown):T {
  const r=schema.safeParse(value);if(!r.success)throw new Problem(422,"INVALID_INPUT","Check result fields and revision.");return r.data;
}
async function replay(c:PoolClient,p:Scope,actor:string,op:string,request:Request,value:unknown) {
  const key=request.headers.get("idempotency-key");
  if(!key||!/^[\x20-\x7e]{16,128}$/.test(key))throw new Problem(422,"INVALID_INPUT","Use an idempotency key of 16–128 printable ASCII characters.");
  const hash=createHmac("sha256",config().secret).update(JSON.stringify(value)).digest("hex");
  const r=(await c.query(`SELECT *,expires_at>clock_timestamp() AS valid FROM selection_requests
    WHERE studio_id=$1 AND project_id=$2 AND actor=$3 AND operation=$4 AND key=$5`,[p.studio_id,p.id,actor,op,key])).rows[0];
  if(r&&r.request_hash!==hash)throw new Problem(409,"IDEMPOTENCY_CONFLICT","This key belongs to a different request.");
  if(r&&!r.valid)throw new Problem(409,"IDEMPOTENCY_EXPIRED","Request key expired. Review current results.");
  return {response:r?.response,async save(response:unknown){await c.query(`INSERT INTO selection_requests(studio_id,project_id,actor,operation,key,request_hash,response)
    VALUES($1,$2,$3,$4,$5,$6,$7)`,[p.studio_id,p.id,actor,op,key,hash,response]);}};
}
export async function currentResult(c:PoolClient,p:Scope) {
  const s=(await c.query("SELECT state AS status,revision,saved_at,last_confirmation_id FROM selection_sets WHERE studio_id=$1 AND project_id=$2 FOR UPDATE",[p.studio_id,p.id])).rows[0];
  const items=(await c.query(`SELECT i.photo_id,f.provider_file_id,f.filename,f.folder_path,i.note,f.available FROM selection_items i JOIN project_photos f
    ON (f.studio_id,f.project_id,f.id)=(i.studio_id,i.project_id,i.photo_id) WHERE i.studio_id=$1 AND i.project_id=$2 ORDER BY i.photo_id`,[p.studio_id,p.id])).rows;
  const latest=s.last_confirmation_id?(await c.query("SELECT id,revision,confirmed_at,items FROM selection_confirmations WHERE studio_id=$1 AND project_id=$2 AND id=$3",[p.studio_id,p.id,s.last_confirmation_id])).rows[0]:null;
  return {...s,items,latest_confirmation:latest};
}
export const clientSnapshot=(s:Snapshot)=>({...s,items:s.items.map(({provider_file_id,...i})=>i)});
export async function confirm(c:PoolClient,p:Scope & {source_access_denied:boolean},actor:string,request:Request,value:unknown) {
  const v=input(revision,value),retry=await replay(c,p,actor,"confirm",request,v);
  if(retry.response)return retry.response;
  const s=await currentResult(c,p);
  if(s.status==="confirmed")throw new Problem(409,"SELECTION_LOCKED","Selection is locked.",s.revision);
  if(s.revision!==v.expected_revision)throw new Problem(409,"REVISION_CONFLICT","Selection changed. Review saved choices.",s.revision);
  const w=(await c.query("SELECT quota FROM project_workflows WHERE studio_id=$1 AND project_id=$2 AND kind='main'",[p.studio_id,p.id])).rows[0];
  if(!s.items.length||s.items.length>w.quota)throw new Problem(422,"QUOTA_EXCEEDED","Confirm between one photo and the maximum quota.");
  if(s.items.some((i:Record<string,any>)=>!i.available))throw new Problem(422,"SOURCE_PHOTO_UNAVAILABLE","Remove unavailable photos before confirming.");
  if(p.source_access_denied)throw new Problem(503,"SOURCE_UNAVAILABLE","Source unavailable. Retry later.");
  const snapshot=(await c.query(`INSERT INTO selection_confirmations(studio_id,project_id,selection_set_id,revision,items)
    SELECT $1,$2,id,revision+1,$3 FROM selection_sets WHERE studio_id=$1 AND project_id=$2 RETURNING id,revision,confirmed_at,items`,
    [p.studio_id,p.id,JSON.stringify(s.items.map(({available,...i}:Record<string,any>)=>i))])).rows[0];
  await c.query("UPDATE selection_sets SET state='confirmed',revision=revision+1,last_confirmation_id=$3 WHERE studio_id=$1 AND project_id=$2",[p.studio_id,p.id,snapshot.id]);
  const response=clientSnapshot(snapshot);await retry.save(response);return response;
}
// Shared by CSV attachment and copy: exact identifiers and values, with formula-safe cells.
export function resultsCsv(items:Record<string,any>[],revision:number,time:string|Date|null,view:string) {
  const cell=(v:unknown)=>{let s=String(v??"");if(/^[\s\u0000-\u001f]*[=+\-@]/u.test(s)||/^[\t\r\n]/.test(s))s="'"+s;return '"'+s.replaceAll('"','""')+'"';};
  return [["photo_id","provider_file_id","filename","folder_path","note","revision","confirmed_at","view"],
    ...items.map(i=>[i.photo_id,i.provider_file_id,i.filename,i.folder_path,i.note,revision,time instanceof Date?time.toISOString():time,view])].map(row=>row.map(cell).join(",")).join("\r\n")+"\r\n";
}
export async function resultRoutes(c:PoolClient,studio:{id:string;user_id:string},request:Request,value:unknown):Promise<Response|null> {
  const u=new URL(request.url),m=/^\/api\/v1\/projects\/([^/]+)\/(selection(?:\/reopen)?|confirmations|results\.csv)$/.exec(u.pathname);
  if(!m)return null;
  if(!z.uuid().safeParse(m[1]).success)throw new Problem(404,"NOT_FOUND","Not found.");
  const p=(await c.query("SELECT * FROM projects WHERE studio_id=$1 AND id=$2 FOR UPDATE",[studio.id,m[1]])).rows[0];
  if(!p)throw new Problem(404,"NOT_FOUND","Not found.");
  const action=m[2];
  if(action==="selection"&&request.method==="GET"){if(u.search)throw new Problem(422,"INVALID_INPUT","Unexpected query.");return json(await currentResult(c,p));}
  if(action==="confirmations"&&request.method==="GET") {
    const q=input(z.object({limit:z.coerce.number().int().min(1).max(100).default(50),cursor:z.coerce.number().int().positive().optional()}).strict(),Object.fromEntries(u.searchParams));
    const rows=(await c.query("SELECT id,revision,confirmed_at,items FROM selection_confirmations WHERE studio_id=$1 AND project_id=$2 AND ($3::int IS NULL OR revision<$3) ORDER BY revision DESC LIMIT $4",[studio.id,p.id,q.cursor,q.limit+1])).rows;
    return json({items:rows.slice(0,q.limit),next_cursor:rows.length>q.limit?String(rows[q.limit-1].revision):null});
  }
  if(action==="results.csv"&&request.method==="GET") {
    const q=input(z.union([z.object({view:z.literal("draft")}).strict(),z.object({confirmation_id:z.uuid()}).strict()]),Object.fromEntries(u.searchParams));
    let s;let view="draft";
    if("view" in q)s=await currentResult(c,p);
    else {s=(await c.query("SELECT revision,confirmed_at,items FROM selection_confirmations WHERE studio_id=$1 AND project_id=$2 AND id=$3",[studio.id,p.id,q.confirmation_id])).rows[0];view="confirmation";}
    if(!s)throw new Problem(404,"NOT_FOUND","Not found.");
    return new Response(resultsCsv(s.items,s.revision,s.confirmed_at??null,view),{headers:{"Content-Type":"text/csv; charset=utf-8","Content-Disposition":`attachment; filename="results-${view}-${s.revision}.csv"`,"Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff"}});
  }
  if(action==="selection/reopen"&&request.method==="POST") {
    if(u.search)throw new Problem(422,"INVALID_INPUT","Unexpected query.");
    const v=input(revision.extend({reason:z.string().trim().refine(s=>[...s].length>=10&&[...s].length<=1000&&!s.includes("\0")&&s.isWellFormed())}),value);
    const retry=await replay(c,p,studio.user_id,"reopen",request,v);if(retry.response)return json(retry.response);
    if((await entitlement(c,studio.id)).status!=="active")throw new Problem(403,"ENTITLEMENT_EXPIRED","Your entitlement has expired.");
    if(p.archived_at)throw new Problem(403,"PROJECT_ARCHIVED","Restore the project first.");
    const s=await currentResult(c,p);
    if(s.revision!==v.expected_revision)throw new Problem(409,"REVISION_CONFLICT","Selection changed. Review results.",s.revision);
    if(s.status!=="confirmed")throw new Problem(409,"SELECTION_NOT_CONFIRMED","Selection is already open.",s.revision);
    await c.query("UPDATE selection_sets SET state='selecting',revision=revision+1 WHERE studio_id=$1 AND project_id=$2",[studio.id,p.id]);
    await c.query("INSERT INTO audit_events(studio_id,actor_id,project_id,action,outcome,reason) VALUES($1,$2,$3,'selection.reopen','success',$4)",[studio.id,studio.user_id,p.id,v.reason]);
    const response=await currentResult(c,p);await retry.save(response);return json(response);
  }
  throw new Problem(404,"NOT_FOUND","Not found.");
}
