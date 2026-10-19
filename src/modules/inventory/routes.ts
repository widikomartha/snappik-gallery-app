import { createHmac, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { z } from "zod";
import { config } from "../../config";
import { entitlement } from "../entitlement";
import { json, Problem } from "../http";

type Studio={id:string;user_id:string};
const missing=()=>new Problem(404,"NOT_FOUND","Not found.");
export async function inventoryRoutes(c: PoolClient,studio: Studio,request: Request,value: unknown): Promise<Response | null> {
  const url=new URL(request.url);
  const match=/^\/api\/v1\/projects\/([^/]+)\/(sync(?:\/cancel)?|photos)$/.exec(url.pathname);
  if(!match)return null;
  const [,id,action]=match;
  if(!z.uuid().safeParse(id).success)throw missing();
  const p=(await c.query("SELECT * FROM projects WHERE studio_id=$1 AND id=$2 FOR UPDATE",[studio.id,id])).rows[0];
  if(!p)throw missing();
  if(action==="sync" && request.method==="POST") {
    if(!z.object({}).strict().safeParse(value).success)throw new Problem(422,"INVALID_INPUT","Use an empty JSON object.");
    const key=request.headers.get("idempotency-key");
    if(!key||! /^[\x20-\x7e]{16,128}$/.test(key))throw new Problem(422,"INVALID_INPUT","Use an idempotency key of 16–128 printable ASCII characters.");
    const operation=`inventory.sync:${id}`;
    const hash=createHmac("sha256",config().secret).update("{}").digest("hex");
    const saved=(await c.query("SELECT request_hash,response,expires_at>clock_timestamp() AS valid FROM idempotency_records WHERE actor_id=$1 AND studio_id=$2 AND operation=$3 AND key=$4",[studio.user_id,studio.id,operation,key])).rows[0];
    if(saved){
      if(saved.request_hash!==hash)throw new Problem(409,"IDEMPOTENCY_CONFLICT","This key belongs to a different request.");
      if(!saved.valid)throw new Problem(409,"IDEMPOTENCY_EXPIRED","Review the saved job before starting another sync.");
      return json(saved.response,202);
    }
    if(p.archived_at)throw new Problem(403,"PROJECT_ARCHIVED","Restore the project before syncing.");
    if((await entitlement(c,studio.id)).status!=="active")throw new Problem(403,"ENTITLEMENT_EXPIRED","Your entitlement has expired.");
    // Coalesce competing requests for the same source configuration; retain each retry result.
    let job=(await c.query("SELECT id FROM jobs WHERE studio_id=$1 AND project_id=$2 AND status IN ('pending','running') AND (source_revision IS NULL OR source_revision=$3) ORDER BY created_at DESC,id DESC LIMIT 1",[studio.id,id,p.source_revision])).rows[0];
    if(!job)job=(await c.query("INSERT INTO jobs(studio_id,project_id,type,dedupe_key,source_revision) VALUES($1,$2,'inventory',$3,$4) RETURNING id",[studio.id,id,`sync:${randomUUID()}`,p.source_revision])).rows[0];
    const response={job_id:job.id};
    await c.query("UPDATE projects SET inventory_status='pending' WHERE studio_id=$1 AND id=$2",[studio.id,id]);
    await c.query("INSERT INTO idempotency_records(actor_id,studio_id,operation,key,request_hash,project_id,response) VALUES($1,$2,$3,$4,$5,$6,$7)",[studio.user_id,studio.id,operation,key,hash,id,response]);
    await c.query("INSERT INTO audit_events(studio_id,actor_id,project_id,action,outcome) VALUES($1,$2,$3,'inventory.sync','success')",[studio.id,studio.user_id,id]);
    return json(response,202);
  }
  if(action==="sync/cancel" && request.method==="POST") {
    const input=z.object({job_id:z.uuid()}).strict().safeParse(value);
    if(!input.success)throw new Problem(422,"INVALID_INPUT","Choose a job to cancel.");
    const j=(await c.query("SELECT * FROM jobs WHERE studio_id=$1 AND project_id=$2 AND id=$3 FOR UPDATE",[studio.id,id,input.data.job_id])).rows[0];
    if(!j)throw missing();
    if(j.status==="pending"||j.status==="running") {
      await c.query("UPDATE jobs SET status='cancelled',lease_token=lease_token+1,lease_deadline=NULL,completed_at=clock_timestamp(),failure_code='SCAN_CANCELLED' WHERE id=$1",[j.id]);
      await c.query("DELETE FROM inventory_stage WHERE job_id=$1",[j.id]);
      await c.query("INSERT INTO inventory_job_events(studio_id,project_id,job_id,lease_token,attempt,event,code) VALUES($1,$2,$3,$4,$5,'cancelled','SCAN_CANCELLED')",[studio.id,id,j.id,j.lease_token,j.attempt_count]);
      await c.query(`UPDATE projects SET inventory_status=CASE WHEN EXISTS(SELECT 1 FROM jobs WHERE studio_id=$1 AND project_id=$2 AND status IN ('pending','running')) THEN 'pending' ELSE 'failed' END,
        inventory_failure_code='SCAN_CANCELLED' WHERE studio_id=$1 AND id=$2`,[studio.id,id]);
      await c.query("INSERT INTO audit_events(studio_id,actor_id,project_id,action,outcome) VALUES($1,$2,$3,'inventory.cancel','success')",[studio.id,studio.user_id,id]);
    }
    return json({job_id:j.id,status:j.status==="pending"||j.status==="running"?"cancelled":j.status});
  }
  if(action==="photos" && request.method==="GET") {
    const query=z.object({limit:z.coerce.number().int().min(1).max(100).default(50),cursor:z.string().max(200).optional()}).strict().safeParse(Object.fromEntries(url.searchParams));
    if(!query.success)throw new Problem(422,"INVALID_INPUT","Invalid inventory page.");
    let cursor:string|null=null;
    if(query.data.cursor)try{cursor=z.uuid().parse(Buffer.from(query.data.cursor,"base64url").toString("utf8"));}catch{throw new Problem(422,"INVALID_INPUT","Invalid inventory cursor.");}
    const rows=(await c.query(`SELECT id,provider_file_id,filename,folder_path,mime,size_bytes,source_version,available,
      CASE WHEN preview_expires_at<=clock_timestamp() THEN 'pending' ELSE preview_status END AS preview_status,seen_generation
      FROM project_photos WHERE studio_id=$1 AND project_id=$2 AND ($3::uuid IS NULL OR id>$3::uuid) ORDER BY id LIMIT $4`,[studio.id,id,cursor,query.data.limit+1])).rows;
    const items=rows.slice(0,query.data.limit).map(row=>({...row,preview_url:row.available&&row.preview_status==="ready"&&!p.archived_at&&!p.source_access_denied?`/api/v1/projects/${id}/media/${row.id}`:null}));
    return json({items,next_cursor:rows.length>query.data.limit?Buffer.from(items.at(-1)!.id).toString("base64url"):null,
      inventory_status:p.inventory_status,generation:p.inventory_generation,origin:p.inventory_origin,failure_code:p.inventory_failure_code,summary:p.inventory_summary,last_successful_sync_at:p.last_successful_sync_at});
  }
  throw missing();
}
