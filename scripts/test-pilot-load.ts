import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { harness, BrowserSession } from "../tests/harness";
import { galleryFixture, result } from "../tests/gallery-fixture";

const h=await harness({inventoryAdapter:"synthetic"});await h.migrate();
const samples:Record<string,number[]>={};const statuses:Record<string,number>={};let peakConnections=0,worker:ReturnType<typeof spawn>|undefined;
async function timed(name:string,run:()=>Promise<Response>,status=200) {
  const start=performance.now(),r=await run();await r.clone().arrayBuffer();(samples[name]??=[]).push(performance.now()-start);statuses[r.status]=(statuses[r.status]??0)+1;assert.equal(r.status,status);return r;
}
try {
  const f=await galleryFixture(h),studio=(await result(await f.owner.request("/api/v1/me"))).studio.id;
  // Explicit database capacity fixtures: no provider acceptance is inferred.
  const studios=[studio];for(let i=1;i<10;i++)studios.push((await h.pool.query("INSERT INTO studios(name,slug,setup_status) VALUES('Synthetic capacity studio',$1,'active') RETURNING id",[`load-${randomUUID()}`])).rows[0].id);
  for(const [index,id] of studios.entries())for(let j=index===0?1:0;j<10;j++)await h.pool.query(`INSERT INTO projects(studio_id,public_token,client_label,drive_folder_id,detect_subfolders,notes_enabled,layout,defaults_snapshot)
    VALUES($1,$2,'Synthetic capacity project','synthetic-folder-00001',true,true,'grid','{}')`,[id,randomBytes(24).toString("base64url")]);
  await result(await f.client.request(`${f.path}/access`,"POST",{workflow:"main"}));
  const source=(await h.pool.query("SELECT * FROM project_photos WHERE project_id=$1 LIMIT 1",[f.p.id])).rows[0];
  await h.pool.query(`INSERT INTO project_photos(studio_id,project_id,provider_file_id,filename,folder_path,mime,size_bytes,source_version,available,seen_generation,preview_bytes,preview_status)
    SELECT $1,$2,'capacity-photo-'||g,'GENERATED_'||g||'.JPG','Folder '||((g%4)+1),'image/jpeg',$3,'capacity-v1',true,1,$4,'ready' FROM generate_series(1,997) g`,[studio,f.p.id,source.size_bytes,source.preview_bytes]);
  // Keep the sample exactly four folders; actual original bytes remain generated.
  await h.pool.query("UPDATE project_photos SET folder_path='Folder '||((abs(hashtext(id::text)::bigint)%4)+1) WHERE project_id=$1",[f.p.id]);
  const clients=[f.client,...Array.from({length:49},()=>new BrowserSession(h.base))];
  for(const c of clients.slice(1)) {
    // Seed active grants, bypassing the separately tested 20/minute gate throttle.
    const raw=randomBytes(32).toString("base64url");c.cookies.set("snappik_gallery_main",raw);
    await h.pool.query(`INSERT INTO gallery_sessions(token_hash,studio_id,project_id,workflow,project_access_version,workflow_access_version,expires_at)
      SELECT $1,$2,$3,'main',p.access_version,w.access_version,clock_timestamp()+interval '12 hours' FROM projects p JOIN project_workflows w ON w.project_id=p.id AND w.kind='main' WHERE p.id=$3`,[createHash("sha256").update(raw).digest("hex"),studio,f.p.id]);
  }
  assert.equal((await h.pool.query("SELECT count(*)::int n FROM gallery_sessions WHERE project_id=$1 AND workflow='main' AND revoked_at IS NULL AND expires_at>clock_timestamp()",[f.p.id])).rows[0].n,50);
  await h.pool.query("UPDATE project_photos SET preview_status='pending',preview_bytes=NULL WHERE id=$1",[source.id]);
  await timed("cold_preview_miss",()=>clients[0].request(`${f.path}/media/${source.id}`),503);
  await h.pool.query("UPDATE project_photos SET preview_status='ready',preview_bytes=$2 WHERE id=$1",[source.id,source.preview_bytes]);
  const photos=(await result(await clients[0].request(`${f.path}/photos?limit=24`))).items;
  await timed("warm_first_batch",async()=>{
    const list=await clients[0].request(`${f.path}/photos?limit=24`);assert.equal(list.status,200);
    const media=await Promise.all(photos.map((p:{id:string})=>clients[0].request(`${f.path}/media/${p.id}`)));for(const r of media){assert.equal(r.status,200);await r.arrayBuffer();}return list;
  });
  worker=spawn(process.execPath,["--import","tsx","src/worker/main.ts"],{env:{...process.env,INVENTORY_ADAPTER:"disabled"},windowsHide:true,stdio:"ignore"});
  for(let i=0;i<100;i++){if((await h.pool.query("SELECT 1 FROM worker_heartbeats WHERE rss_bytes>0")).rowCount)break;await new Promise(r=>setTimeout(r,50));}
  const poll=setInterval(()=>void h.pool.query("SELECT count(*)::int n FROM pg_stat_activity WHERE datname=current_database()").then(r=>{peakConnections=Math.max(peakConnections,r.rows[0].n);}).catch(()=>{}),25);
  const started=performance.now();
  try {
    await Promise.all([
      ...clients.map(async c=>{for(let i=0;i<3;i++){
        await timed("gallery_list",()=>c.request(`${f.path}/photos?limit=24`));await timed("draft_read",()=>c.request(`${f.path}/selection`));await timed("warm_preview",()=>c.request(`${f.path}/media/${photos[i].id}`));
      }}),
      (async()=>{let revision=1;for(let i=0;i<10;i++){
        const s=await result(await timed("draft_save",()=>f.client.request(`${f.path}/selection`,"PUT",{expected_revision:revision,items:[{photo_id:photos[0].id,note:"Synthetic capacity note"}]})));revision=s.revision;
        const confirmed=await result(await timed("confirm",()=>f.client.request(`${f.path}/selection/confirm`,"POST",{expected_revision:revision},{"Idempotency-Key":randomUUID()})));revision=confirmed.revision;
        const reopened=await result(await timed("owner_reopen",()=>f.owner.request(`/api/v1/projects/${f.p.id}/selection/reopen`,"POST",{expected_revision:revision,reason:"Synthetic load repeat confirmation"},{"Idempotency-Key":randomUUID()})));revision=reopened.revision;
      }})(),
    ]);
  }finally{clearInterval(poll);}
  const fixture=(await h.pool.query(`SELECT (SELECT count(*)::int FROM studios) studios,(SELECT count(*)::int FROM projects) projects,(SELECT count(*)::int FROM project_photos WHERE project_id=$1) photos,(SELECT count(DISTINCT folder_path)::int FROM project_photos WHERE project_id=$1) folders`,[f.p.id])).rows[0];
  assert.deepEqual(fixture,{studios:10,projects:100,photos:1000,folders:4});
  const report={generated_at:new Date().toISOString(),environment:{node:process.version,platform:process.platform,mode:"isolated local synthetic",provider_calls:0},fixture:{...fixture,active_clients:50,grant_setup:"seeded hashed grants; issuance throttle tested separately"},duration_ms:performance.now()-started,statuses,latencies:Object.fromEntries(Object.entries(samples).map(([k,v])=>{v.sort((a,b)=>a-b);return [k,{n:v.length,p50_ms:v[Math.ceil(v.length*.5)-1],p95_ms:v[Math.ceil(v.length*.95)-1],max_ms:v.at(-1)}];})),peak_database_connections:peakConnections,worker:(await h.pool.query("SELECT rss_bytes::text,pool_total,pool_waiting FROM worker_heartbeats ORDER BY last_seen_at DESC LIMIT 1")).rows[0]??null,limits:{business_pool_per_process:12,auth_guard_pool_per_web:1,original_concurrency_per_process:2,original_max_bytes:50*1024*1024},not_measured:["cold provider regeneration / 1000-image decoder peak","provider quota / hosted latency / native memory","real device / pilot activation / sustained load"],release_ready:false};
  await mkdir("test-results",{recursive:true});await writeFile("test-results/pilot-load.json",JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{worker?.kill();await h.close();}
