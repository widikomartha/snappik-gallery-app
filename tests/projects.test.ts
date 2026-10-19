import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { verifyPassword } from "better-auth/crypto";
import { harness, BrowserSession, fixturePassword } from "./harness";
import { authorizedWorkflow } from "../src/modules/projects/access";

let h:Awaited<ReturnType<typeof harness>>;
before(async()=>{h=await harness();await Promise.all([h.migrate(),h.migrate()]);},{timeout:60000});
after(async()=>{if(h)await h.close();});
beforeEach(async()=>{await h.pool.query('DELETE FROM "rateLimit"');});
async function result(r:Response,status=200){assert.equal(r.status,status,`Expected HTTP ${status}, received ${r.status}`);return (await r.json()).data;}
async function code(r:Response,status:number,expected:string){assert.equal(r.status,status);assert.equal((await r.json()).error.code,expected);}
async function owner(){
  const b=new BrowserSession(h.base); const email=`project-${randomUUID()}@example.test`;const password=fixturePassword();
  await result(await b.request("/api/auth/sign-up/email","POST",{name:"Synthetic owner",email,password}));
  await b.request(await h.mail(email,"verification"));await result(await b.request("/api/auth/sign-in/email","POST",{email,password}));
  const me=await result(await b.request("/api/v1/onboarding","POST",{name:"Project studio",slug:`p-${randomUUID()}`,locale:"en",timezone:"Asia/Makassar"}),201);
  return {b,studio:me.studio};
}
const input=(label="Synthetic project")=>({client_label:label,drive_folder_id:"synthetic-folder-00001"});
const create=(b:BrowserSession,body:unknown=input(),key=randomUUID())=>b.request("/api/v1/projects","POST",body,{"Idempotency-Key":key});
async function get(b:BrowserSession,id:string){return result(await b.request(`/api/v1/projects/${id}`));}
async function mutate(b:BrowserSession,p:{id:string;revision:number},action:string){return b.request(`/api/v1/projects/${p.id}/${action}`,"POST",{expected_revision:p.revision});}
async function grant(p:{id:string;studio_id:string},workflow="main"){
  const token=randomUUID();await h.pool.query(`INSERT INTO gallery_sessions(token_hash,studio_id,project_id,workflow,project_access_version,workflow_access_version,expires_at)
    SELECT $1,p.studio_id,p.id,w.kind,p.access_version,w.access_version,clock_timestamp()+interval '1 hour' FROM projects p
    JOIN project_workflows w ON w.studio_id=p.studio_id AND w.project_id=p.id WHERE p.studio_id=$2 AND p.id=$3 AND w.kind=$4`,[token,p.studio_id,p.id,workflow]);return token;
}
async function allowed(token:string,workflow:"main"|"download"="main") {const client=await h.pool.connect();try{return await authorizedWorkflow(client,token,workflow);}finally{client.release();}}

test("EPIC-02 A01 atomic create, concurrent identical retry, changed intent, expired key and rollback",async()=>{
  const {b,studio}=await owner();const key=randomUUID();
  const responses=await Promise.all(Array.from({length:8},()=>create(b.clone(),input(),key)));
  const projects=await Promise.all(responses.map(r=>result(r,201)));assert.equal(new Set(projects.map(p=>p.id)).size,1);
  const p=projects[0];assert.equal(p.inventory_status,"pending");assert.equal(p.source_validation,"pending_provider");assert.equal(p.workflows.length,2);assert.equal(p.selection_status,"not_started");
  assert.ok(p.public_url.startsWith("/g/"));assert.ok(p.public_url.length>=35);
  await create(b,input(),key); // Intentionally ignore the response, then recover it using the same key.
  assert.deepEqual(await result(await create(b,{drive_folder_id:"synthetic-folder-00001",client_label:"Synthetic project"},key),201),p);
  const counts=(await h.pool.query(`SELECT (SELECT count(*) FROM projects WHERE studio_id=$1)::int AS projects,
    (SELECT count(*) FROM selection_sets WHERE studio_id=$1)::int AS sets,
    (SELECT count(*) FROM project_workflows WHERE studio_id=$1)::int AS workflows,
    (SELECT count(*) FROM jobs WHERE studio_id=$1)::int AS jobs,
    (SELECT count(*) FROM audit_events WHERE studio_id=$1 AND action='project.create')::int AS audits`,[studio.id])).rows[0];
  assert.deepEqual(counts,{projects:1,sets:1,workflows:2,jobs:1,audits:1});
  await code(await create(b,input("Different"),key),409,"IDEMPOTENCY_CONFLICT");
  await h.pool.query("UPDATE idempotency_records SET expires_at=clock_timestamp() WHERE studio_id=$1",[studio.id]);
  await code(await create(b,input(),key),409,"IDEMPOTENCY_EXPIRED");
  await h.pool.query("CREATE FUNCTION fail_project_test() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected'; END $$; CREATE TRIGGER fail_project BEFORE INSERT ON idempotency_records FOR EACH ROW EXECUTE FUNCTION fail_project_test()");
  const rollbackKey=randomUUID();try{await code(await create(b,input("Rollback"),rollbackKey),503,"TEMPORARILY_UNAVAILABLE");}
  finally{await h.pool.query("DROP TRIGGER fail_project ON idempotency_records; DROP FUNCTION fail_project_test()");}
  assert.equal((await h.pool.query("SELECT count(*)::int AS n FROM projects WHERE studio_id=$1",[studio.id])).rows[0].n,1);
  await result(await create(b,input("Rollback"),rollbackKey),201);
});

test("EPIC-02 A02 quota race, expired read/archive/revocation, current manual grants",async()=>{
  const {b,studio}=await owner();const originalKey=randomUUID();const acknowledged=await result(await create(b,input(),originalKey),201);await result(await create(b),201);
  const racing=await Promise.all(Array.from({length:6},()=>create(b.clone())));assert.deepEqual(racing.map(r=>r.status).sort(),[201,409,409,409,409,409]);
  const p=await result(racing.find(r=>r.status===201)!,201);
  const entitlement=await result(await b.request("/api/v1/entitlement"));assert.equal(entitlement.active_project_usage,3);
  await h.pool.query("UPDATE entitlement_grants SET revoked_at=clock_timestamp() WHERE studio_id=$1",[studio.id]);
  assert.equal((await result(await create(b,input(),originalKey),201)).id,acknowledged.id);
  await code(await create(b),403,"ENTITLEMENT_EXPIRED");
  await code(await b.request(`/api/v1/projects/${p.id}`,"PATCH",{expected_revision:p.revision,client_label:"Denied"}),403,"ENTITLEMENT_EXPIRED");
  await get(b,p.id);await result(await b.request("/api/v1/projects"));await result(await b.request("/api/v1/dashboard"));
  const rotated=await result(await mutate(b,p,"access/rotate"));const archived=await result(await mutate(b,rotated,"archive"));
  await code(await mutate(b,archived,"restore"),403,"ENTITLEMENT_EXPIRED");
  await h.pool.query("INSERT INTO entitlement_grants(studio_id,source,source_ref,starts_at,ends_at,project_limit) VALUES($1,'manual','local-fixture',clock_timestamp()-interval '1 second',clock_timestamp()+interval '1 day',5),($1,'manual','lower-fixture',clock_timestamp()-interval '1 second',clock_timestamp()+interval '1 day',2)",[studio.id]);
  const current=await result(await b.request("/api/v1/entitlement"));assert.equal(current.project_limit,5);assert.equal(current.active_project_usage,2);
  await result(await mutate(b,archived,"restore"));
});

test("EPIC-02 A03 defaults snapshot, workflow/password/deadline PATCH, stale revision and selected quota",async()=>{
  const {b}=await owner();const password=fixturePassword();const deadline="2030-01-02T03:04:05Z";
  let p=await result(await create(b,{...input("😀".repeat(100)),main:{expires_at:deadline,password},download:{enabled:true,password:fixturePassword()}}),201);
  assert.equal(p.client_phone,null);assert.equal(p.workflows.find((w:{kind:string})=>w.kind==="main").password_set,true);
  assert.equal(JSON.stringify(p).includes(password),false);assert.equal(JSON.stringify(p).includes("password_hash"),false);
  const hash=(await h.pool.query("SELECT password_hash FROM project_workflows WHERE studio_id=$1 AND project_id=$2 AND kind='main'",[p.studio_id,p.id])).rows[0].password_hash;
  assert.ok(await verifyPassword({hash,password}));
  const settings=await result(await b.request("/api/v1/studio/settings"));await result(await b.request("/api/v1/studio/settings","PATCH",{expected_revision:settings.revision,defaults:{...settings.defaults,main:{...settings.defaults.main,quota:44}}}));
  assert.equal((await get(b,p.id)).workflows.find((w:{kind:string})=>w.kind==="main").quota,20);
  assert.equal((await result(await create(b),201)).workflows.find((w:{kind:string})=>w.kind==="main").quota,44);
  const old=p; p=await result(await b.request(`/api/v1/projects/${p.id}`,"PATCH",{expected_revision:p.revision,client_label:"Updated",main:{quota:21}}));
  assert.equal(new Date(p.workflows.find((w:{kind:string})=>w.kind==="main").expires_at).toISOString(),new Date(deadline).toISOString());
  await code(await b.request(`/api/v1/projects/${old.id}`,"PATCH",{expected_revision:old.revision,client_label:"Stale"}),409,"REVISION_CONFLICT");
  const token=await grant(p);assert.ok(await allowed(token));
  p=await result(await b.request(`/api/v1/projects/${p.id}`,"PATCH",{expected_revision:p.revision,main:{password:null,expires_at:null}}));assert.equal(await allowed(token),null);
  assert.equal(p.workflows.find((w:{kind:string})=>w.kind==="main").expires_at,null);
  const mainGrant=await grant(p);const downloadGrant=await grant(p,"download");
  p=await result(await b.request(`/api/v1/projects/${p.id}`,"PATCH",{expected_revision:p.revision,download:{enabled:false}}));
  assert.ok(await allowed(mainGrant));assert.equal(await allowed(downloadGrant,"download"),null);
  p=await result(await b.request(`/api/v1/projects/${p.id}`,"PATCH",{expected_revision:p.revision,download:{enabled:true}}));
  assert.equal(await allowed(downloadGrant,"download"),null);
  for(const bad of [{client_label:"😀".repeat(101)},{client_phone:"0812"},{main:{quota:501}},{main:{quota:0}},{main:{quota:1.5}},{main:{enabled:false},download:{enabled:false}},{drive_folder_id:"https://example.test/"},{studio_id:randomUUID()},{download:{quota:2}}]) await code(await create(b,{...input(),...bad}),422,"INVALID_INPUT");
  await code(await b.request("/api/v1/projects","POST",input()),422,"INVALID_INPUT");
  await code(await b.request(`/api/v1/projects/${p.id}`,"PATCH",{expected_revision:p.revision,drive_folder_id:"replacement-folder"}),422,"INVALID_INPUT");
  const selection=(await h.pool.query("SELECT id FROM selection_sets WHERE studio_id=$1 AND project_id=$2",[p.studio_id,p.id])).rows[0];
  for(let i=0;i<2;i++){const photo=(await h.pool.query("INSERT INTO project_photos(studio_id,project_id,provider_file_id,filename,folder_path,mime,size_bytes,source_version,seen_generation) VALUES($1,$2,$3,'IMG_001.jpg','','image/jpeg',1,'v1',1) RETURNING id",[p.studio_id,p.id,`synthetic-${i}`])).rows[0];await h.pool.query("INSERT INTO selection_items(studio_id,project_id,selection_set_id,photo_id) VALUES($1,$2,$3,$4)",[p.studio_id,p.id,selection.id,photo.id]);}
  await code(await b.request(`/api/v1/projects/${p.id}`,"PATCH",{expected_revision:p.revision,main:{quota:1}}),422,"QUOTA_EXCEEDED");
  await h.pool.query("UPDATE selection_sets SET state='confirmed' WHERE id=$1",[selection.id]);
  await code(await b.request(`/api/v1/projects/${p.id}`,"PATCH",{expected_revision:p.revision,main:{quota:30}}),409,"SELECTION_LOCKED");
  const race=await Promise.all(["A","B"].map(client_label=>b.clone().request(`/api/v1/projects/${p.id}`,"PATCH",{expected_revision:p.revision,client_label})));assert.deepEqual(race.map(r=>r.status).sort(),[200,409]);
});

test("EPIC-02 A04 archive revocation, deadline/history preservation, concurrent restores and retention equality",async()=>{
  const {b}=await owner();let p=await result(await create(b,{...input(),main:{expires_at:"2030-01-01T00:00:00Z"},download:{enabled:true}}),201);
  const set=(await h.pool.query("SELECT * FROM selection_sets WHERE project_id=$1",[p.id])).rows[0];
  const main=await grant(p);const download=await grant(p,"download");assert.ok(await allowed(main));assert.ok(await allowed(download,"download"));assert.equal(await allowed(main,"download"),null);
  p=await result(await mutate(b,p,"archive"));assert.equal(await allowed(main),null);assert.equal(await allowed(download,"download"),null);
  assert.equal((await result(await b.request("/api/v1/entitlement"))).active_project_usage,0);
  const restored=await result(await mutate(b,p,"restore"));assert.equal(await allowed(main),null);assert.equal(await allowed(download,"download"),null);
  assert.deepEqual((await h.pool.query("SELECT * FROM selection_sets WHERE project_id=$1",[p.id])).rows[0],set);
  assert.equal(new Date(restored.workflows.find((w:{kind:string})=>w.kind==="main").expires_at).toISOString(),"2030-01-01T00:00:00.000Z");
  const fresh=await grant(restored);assert.ok(await allowed(fresh));const rotated=await result(await mutate(b,restored,"access/rotate"));assert.notEqual(rotated.public_url,restored.public_url);assert.equal(await allowed(fresh),null);
  p=await result(await mutate(b,rotated,"archive"));const other=await result(await create(b),201);const archivedOther=await result(await mutate(b,other,"archive"));await result(await create(b),201);await result(await create(b),201);
  const races=await Promise.all([p,archivedOther].map(p=>mutate(b.clone(),p,"restore")));assert.deepEqual(races.map(r=>r.status).sort(),[200,409]);
  const denied=[p,archivedOther][races.findIndex(r=>r.status===409)];await h.pool.query("UPDATE projects SET archived_at=clock_timestamp()-interval '30 days' WHERE id=$1",[denied.id]);
  await code(await mutate(b,denied,"restore"),403,"RESTORE_WINDOW_EXPIRED");
  const active=await get(b,[p,archivedOther][races.findIndex(r=>r.status===200)].id);const token=await grant(active);
  await h.pool.query("UPDATE project_workflows SET expires_at=clock_timestamp() WHERE studio_id=$1 AND project_id=$2 AND kind='main'",[active.studio_id,active.id]);assert.equal(await allowed(token),null);
});

test("EPIC-02 A05 scoped detail/list/jobs/denials, canonical dashboard, pagination and source states",async()=>{
  const a=await owner();const b=await owner();const p=await result(await create(a.b,input("Search needle")),201);const p2=await result(await create(a.b,input("Second")),201);
  await result(await create(b.b,input("Other studio")),201);
  for(const suffix of ["", "/photos", "/selection", "/results.csv?view=draft"])await code(await b.b.request(`/api/v1/projects/${p.id}${suffix}`),404,"NOT_FOUND");
  await code(await b.b.request(`/api/v1/projects/${p.id}`,"PATCH",{expected_revision:1,client_label:"Stolen"}),404,"NOT_FOUND");
  for(const action of ["archive","restore","access/rotate"])await code(await mutate(b.b,p,action),404,"NOT_FOUND");
  await code(await b.b.request(`/api/v1/jobs/${p.job_id}`),404,"NOT_FOUND");
  assert.equal((await result(await a.b.request(`/api/v1/jobs/${p.job_id}`))).status,"pending");
  const page1=await result(await a.b.request("/api/v1/projects?limit=1"));const page2=await result(await a.b.request(`/api/v1/projects?limit=1&cursor=${page1.next_cursor}`));assert.equal(page1.items.length,1);assert.equal(page2.items.length,1);assert.notEqual(page1.items[0].id,page2.items[0].id);assert.equal(page2.next_cursor,null);
  assert.equal((await result(await a.b.request("/api/v1/projects?q=needle"))).items[0].id,p.id);
  await code(await a.b.request("/api/v1/projects?limit=101"),422,"INVALID_INPUT");await code(await a.b.request("/api/v1/projects?cursor=bad"),422,"INVALID_INPUT");
  await h.pool.query("UPDATE projects SET inventory_status='ready',last_successful_sync_at=clock_timestamp() WHERE id=$1",[p.id]);await h.pool.query("UPDATE projects SET inventory_status='failed' WHERE id=$1",[p2.id]);
  assert.equal((await get(a.b,p.id)).inventory_status,"ready");assert.equal((await get(a.b,p2.id)).inventory_status,"failed");
  assert.equal((await result(await a.b.request("/api/v1/projects?inventory_status=failed"))).items[0].id,p2.id);
  const dashboard=await result(await a.b.request("/api/v1/dashboard"));assert.equal(dashboard.counts.total,2);assert.equal(dashboard.counts.failed,1);assert.equal(dashboard.entitlement.active_project_usage,2);
  assert.equal(JSON.stringify(dashboard).includes("Other studio"),false);
  const edited=await result(await a.b.request(`/api/v1/projects/${p.id}`,"PATCH",{expected_revision:p.revision,detect_subfolders:false}));assert.equal(edited.inventory_status,"pending");assert.notEqual(edited.job_id,p.job_id);
  assert.equal((await result(await a.b.request(`/api/v1/jobs/${edited.job_id}`))).status,"pending");
  const downloadOnly=await result(await create(b.b,{...input("Downloads only"),main:{enabled:false,quota:null},download:{enabled:true}}),201);
  assert.equal(downloadOnly.selection_status,"not_started");assert.equal(downloadOnly.workflows.find((w:{kind:string})=>w.kind==="main").quota,null);
  await code(await create(new BrowserSession(h.base)),401,"AUTH_REQUIRED");
  await code(await a.b.request("/api/v1/projects","POST",input(),{"Idempotency-Key":randomUUID(),Origin:"http://evil.example.test"}),403,"ORIGIN_DENIED");
  const token=await grant(p);await h.pool.query("UPDATE studios SET suspended_at=clock_timestamp() WHERE id=$1",[a.studio.id]);assert.equal(await allowed(token),null);
  await code(await a.b.request(`/api/v1/projects/${p.id}`),403,"STUDIO_SUSPENDED");
  // Composite FKs reject attempts to attach dependent data to another studio's project.
  await assert.rejects(h.pool.query("INSERT INTO jobs(studio_id,project_id,type,dedupe_key) VALUES($1,$2,'inventory','cross-studio')",[b.studio.id,p.id]),{code:"23503"});
});
