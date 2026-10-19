import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { preview } from "./preview";
import { SourceError, traverse, type InventoryProvider, type ScanSummary, type ScopedInventorySource } from "./provider";

export const MAX_ATTEMPTS = 4;
export const LEASE_SECONDS = 30;
export type Lease = { id: string; studio_id: string; project_id: string; lease_token: string; lease_owner: string; attempt_count: number; source_revision: number; base_generation: number; drive_folder_id: string; detect_subfolders: boolean };
async function tx<T>(pool: Pool, run: (client: PoolClient)=>Promise<T>) {
  const c=await pool.connect(); try { await c.query("BEGIN");const value=await run(c);await c.query("COMMIT");return value; }
  catch(e){await c.query("ROLLBACK");throw e;}finally{c.release();}
}
async function event(c: PoolClient, j: Lease, name: string, code: string | null = null) {
  await c.query("INSERT INTO inventory_job_events(studio_id,project_id,job_id,lease_token,attempt,event,code) VALUES($1,$2,$3,$4,$5,$6,$7)",[j.studio_id,j.project_id,j.id,j.lease_token,j.attempt_count,name,code]);
}
async function lockProject(c: PoolClient, j: Pick<Lease,"studio_id"|"project_id">) {
  const s=(await c.query("SELECT suspended_at,setup_status FROM studios WHERE id=$1 FOR UPDATE",[j.studio_id])).rows[0];
  const p=(await c.query("SELECT * FROM projects WHERE studio_id=$1 AND id=$2 FOR UPDATE",[j.studio_id,j.project_id])).rows[0];
  return {s,p};
}
async function owns(c: PoolClient, j: Lease) {
  return (await c.query(`SELECT id FROM jobs WHERE studio_id=$1 AND project_id=$2 AND id=$3 AND status='running'
    AND lease_owner=$4 AND lease_token=$5 AND lease_deadline>clock_timestamp() FOR UPDATE`,[j.studio_id,j.project_id,j.id,j.lease_owner,j.lease_token])).rowCount===1;
}
async function projectOutcome(c: PoolClient,j: Lease,code: string) {
  await c.query(`UPDATE projects SET inventory_status=CASE WHEN EXISTS(SELECT 1 FROM jobs WHERE studio_id=$1 AND project_id=$2 AND status IN ('pending','running')) THEN 'pending' ELSE 'failed' END,
    inventory_failure_code=$3,source_access_denied=source_access_denied OR $3 IN ('SOURCE_PERMISSION_LOST','SOURCE_ACCESS_REVOKED') WHERE studio_id=$1 AND id=$2`,[j.studio_id,j.project_id,code]);
}
export async function claim(pool: Pool, workerId: string): Promise<Lease | null> {
  // Candidate read holds no locks. All competing mutations use studio -> project -> job.
  const candidates=(await pool.query(`SELECT j.id,j.studio_id,j.project_id FROM jobs j
    WHERE j.type='inventory' AND ((j.status='pending' AND j.available_at<=clock_timestamp()) OR (j.status='running' AND j.lease_deadline<=clock_timestamp()))
    AND NOT EXISTS(SELECT 1 FROM jobs other WHERE other.project_id=j.project_id AND other.id<>j.id AND other.status='running' AND other.lease_deadline>clock_timestamp())
    ORDER BY j.available_at,j.created_at,j.id LIMIT 20`)).rows;
  for(const candidate of candidates) {
    const lease=await tx(pool,async c=>{
      const studio=(await c.query("SELECT suspended_at,setup_status FROM studios WHERE id=$1 FOR UPDATE SKIP LOCKED",[candidate.studio_id])).rows[0];
      if(!studio)return null;
      const p=(await c.query("SELECT * FROM projects WHERE studio_id=$1 AND id=$2 FOR UPDATE",[candidate.studio_id,candidate.project_id])).rows[0];
      const j=(await c.query(`SELECT * FROM jobs WHERE id=$1 AND ((status='pending' AND available_at<=clock_timestamp()) OR (status='running' AND lease_deadline<=clock_timestamp())) FOR UPDATE`,[candidate.id])).rows[0];
      if(!j)return null;
      if((await c.query("SELECT 1 FROM jobs WHERE project_id=$1 AND id<>$2 AND status='running' AND lease_deadline>clock_timestamp()",[j.project_id,j.id])).rowCount)return null;
      const blocked=p.archived_at||studio.suspended_at||studio.setup_status!=="active";
      const superseded=j.source_revision!==null && j.source_revision!==p.source_revision;
      if(blocked||superseded||j.attempt_count>=MAX_ATTEMPTS) {
        const code=blocked?"SOURCE_ACCESS_REVOKED":superseded?"SCAN_SUPERSEDED":"RETRY_EXHAUSTED";
        await c.query("UPDATE jobs SET status=$2,failure_code=$3,completed_at=clock_timestamp(),lease_deadline=NULL,lease_token=lease_token+1 WHERE id=$1",[j.id,j.attempt_count>=MAX_ATTEMPTS?"failed":"cancelled",code]);
        await event(c,j,"terminal",code);await projectOutcome(c,j,code);
        await c.query("DELETE FROM inventory_stage WHERE job_id=$1",[j.id]);return null;
      }
      const claimed=(await c.query(`UPDATE jobs SET status='running',attempt_count=attempt_count+1,lease_owner=$2,lease_token=lease_token+1,
        lease_deadline=clock_timestamp()+make_interval(secs=>$3),source_revision=$4,base_generation=$5,failure_code=NULL
        WHERE id=$1 RETURNING *`,[j.id,workerId,LEASE_SECONDS,p.source_revision,p.inventory_generation])).rows[0];
      await c.query("DELETE FROM inventory_stage WHERE job_id=$1",[j.id]);
      await event(c,claimed,"claimed",j.status==="running"?"LEASE_RECOVERED":null);
      return {...claimed,drive_folder_id:p.drive_folder_id,detect_subfolders:p.detect_subfolders} as Lease;
    });
    if(lease)return lease;
  }
  return null;
}
export async function renew(pool: Pool,j: Lease) {
  return (await pool.query(`UPDATE jobs SET lease_deadline=clock_timestamp()+make_interval(secs=>$6)
    WHERE studio_id=$1 AND project_id=$2 AND id=$3 AND lease_owner=$4 AND lease_token=$5 AND status='running' AND lease_deadline>clock_timestamp()`,[j.studio_id,j.project_id,j.id,j.lease_owner,j.lease_token,LEASE_SECONDS])).rowCount===1;
}
export async function publish(pool: Pool,j: Lease,summary: ScanSummary,origin: InventoryProvider["origin"]) {
  return tx(pool,async c=>{
    const {s,p}=await lockProject(c,j);
    await c.query("SELECT id FROM selection_sets WHERE studio_id=$1 AND project_id=$2 FOR UPDATE",[j.studio_id,j.project_id]);
    if(!await owns(c,j))return false;
    if(p.archived_at||s.suspended_at||s.setup_status!=="active"||p.source_revision!==j.source_revision||p.drive_folder_id!==j.drive_folder_id||p.detect_subfolders!==j.detect_subfolders||p.inventory_generation!==j.base_generation) {
      await c.query("UPDATE jobs SET status='cancelled',failure_code='SCAN_SUPERSEDED',completed_at=clock_timestamp(),lease_deadline=NULL WHERE id=$1",[j.id]);
      await event(c,j,"cancelled","SCAN_SUPERSEDED");await projectOutcome(c,j,"SCAN_SUPERSEDED");await c.query("DELETE FROM inventory_stage WHERE job_id=$1",[j.id]);return false;
    }
    const generation=p.inventory_generation+1;
    const count=(await c.query("SELECT count(*)::int AS n FROM inventory_stage WHERE job_id=$1 AND lease_token=$2",[j.id,j.lease_token])).rows[0].n;
    if(count!==summary.photos || count>5000)throw new SourceError("INCOMPLETE_STAGE");
    await c.query(`INSERT INTO project_photos(studio_id,project_id,provider_file_id,filename,folder_path,mime,size_bytes,source_version,available,seen_generation,preview_bytes,preview_status,provider_ancestry)
      SELECT studio_id,project_id,provider_file_id,filename,folder_path,mime,size_bytes,source_version,preview_status='ready',$3,preview_bytes,preview_status,provider_ancestry
      FROM inventory_stage WHERE job_id=$1 AND lease_token=$2
      ON CONFLICT(project_id,provider_file_id) DO UPDATE SET filename=EXCLUDED.filename,folder_path=EXCLUDED.folder_path,mime=EXCLUDED.mime,
        size_bytes=EXCLUDED.size_bytes,source_version=EXCLUDED.source_version,available=EXCLUDED.available,seen_generation=EXCLUDED.seen_generation,
        preview_bytes=EXCLUDED.preview_bytes,preview_status=EXCLUDED.preview_status,provider_ancestry=EXCLUDED.provider_ancestry`,[j.id,j.lease_token,generation]);
    await c.query("UPDATE project_photos SET preview_expires_at=CASE WHEN $4='google_public' AND preview_status='ready' THEN clock_timestamp()+interval '7 days' ELSE NULL END WHERE studio_id=$1 AND project_id=$2 AND seen_generation=$3",[j.studio_id,j.project_id,generation,origin]);
    await c.query("UPDATE project_photos SET available=false,preview_bytes=NULL WHERE studio_id=$1 AND project_id=$2 AND seen_generation<>$3",[j.studio_id,j.project_id,generation]);
    await c.query(`UPDATE projects SET inventory_status='ready',inventory_generation=$3,last_successful_sync_at=clock_timestamp(),
      inventory_origin=$4,inventory_failure_code=NULL,source_access_denied=false,inventory_summary=$5 WHERE studio_id=$1 AND id=$2`,[j.studio_id,j.project_id,generation,origin,summary]);
    const finished=await c.query("UPDATE jobs SET status='succeeded',summary=$2,completed_at=clock_timestamp(),lease_deadline=NULL WHERE id=$1 AND lease_deadline>clock_timestamp() RETURNING id",[j.id,summary]);
    if(finished.rowCount!==1)throw new SourceError("LEASE_LOST");
    await event(c,j,"published");await c.query("DELETE FROM inventory_stage WHERE job_id=$1",[j.id]);return true;
  });
}
export async function fail(pool: Pool,j: Lease,error: unknown) {
  const e=error instanceof SourceError?error:new SourceError("SOURCE_UNAVAILABLE",true);
  return tx(pool,async c=>{
    await lockProject(c,j);if(!await owns(c,j))return false;
    const retry=e.retryable&&j.attempt_count<MAX_ATTEMPTS;
    const delay=Math.min(3600,Math.max(2**j.attempt_count,Number.isFinite(e.retryAfterSeconds)?e.retryAfterSeconds:0));
    await c.query(`UPDATE jobs SET status=$2,failure_code=$3,available_at=clock_timestamp()+make_interval(secs=>$4),
      lease_deadline=NULL,completed_at=CASE WHEN $2='pending' THEN NULL ELSE clock_timestamp() END WHERE id=$1`,[j.id,retry?"pending":"failed",e.code,delay]);
    await event(c,j,retry?"retry_scheduled":"failed",e.code);await projectOutcome(c,j,e.code);
    await c.query("DELETE FROM inventory_stage WHERE job_id=$1",[j.id]);return true;
  });
}
export async function processLease(pool: Pool,j: Lease,provider: InventoryProvider,stopSignal?: AbortSignal) {
  const controller=new AbortController();const signal=controller.signal;
  const cancel=()=>controller.abort();stopSignal?.addEventListener("abort",cancel,{once:true});if(stopSignal?.aborted)cancel();
  const timeout=setTimeout(cancel,(provider.origin==="google_public"?30:10)*60*1000);
  // Recursive scheduling prevents overlapping renewals when the DB is slow.
  let renewal:ReturnType<typeof setTimeout>;let renewing:Promise<void>|undefined;let done=false;
  const tick=()=>{renewing=(async()=>{try{if(!await renew(pool,j))cancel();}catch{cancel();}if(!done)renewal=setTimeout(tick,5000);})();};
  renewal=setTimeout(tick,5000);
  try {
    const scope={studioId:j.studio_id,projectId:j.project_id,rootId:j.drive_folder_id};let invalid=0;
    const summary=await traverse(provider,scope,j.detect_subfolders,signal,async(file,folderPath,ancestry)=>{
      const image=await preview(provider,scope,file,signal);if(image.status!=="ready")invalid++;
      const staged=await pool.query(`WITH live AS (SELECT id FROM jobs WHERE studio_id=$1 AND project_id=$2 AND id=$3 AND lease_token=$4 AND lease_owner=$13 AND status='running' AND lease_deadline>clock_timestamp() FOR UPDATE)
        INSERT INTO inventory_stage(studio_id,project_id,job_id,lease_token,provider_file_id,filename,folder_path,mime,size_bytes,source_version,preview_bytes,preview_status,provider_ancestry)
        SELECT $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$14::jsonb FROM live`,[j.studio_id,j.project_id,j.id,j.lease_token,file.id,file.name,folderPath,file.mime,file.size,file.version,image.bytes,image.status,j.lease_owner,JSON.stringify(ancestry)]);
      if(staged.rowCount!==1)throw new SourceError("LEASE_LOST");
    });
    summary.skipped.invalid_content=invalid;
    if(signal.aborted)throw new SourceError(stopSignal?.aborted?"WORKER_STOPPED":"SCAN_TIMEOUT",true);
    return await publish(pool,j,summary,provider.origin);
  } catch(e) {
    await fail(pool,j,signal.aborted?new SourceError(stopSignal?.aborted?"WORKER_STOPPED":"SCAN_INTERRUPTED",true):e);return false;
  } finally {done=true;clearTimeout(renewal!);clearTimeout(timeout);stopSignal?.removeEventListener("abort",cancel);await renewing;}
}
export async function runInventoryOnce(pool: Pool,provider: InventoryProvider | ScopedInventorySource,signal?: AbortSignal,workerId=randomUUID()) {
  const j=await claim(pool,workerId);if(!j)return false;
  let adapter:InventoryProvider;
  try{adapter="forScope" in provider?provider.forScope({studioId:j.studio_id,projectId:j.project_id,rootId:j.drive_folder_id}):provider;}
  catch(error){await fail(pool,j,error);return true;}
  await processLease(pool,j,adapter,signal);return true;
}
