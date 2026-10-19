import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { harness, BrowserSession, fixturePassword } from "./harness";
import { SyntheticDrive, SYNTHETIC_ROOT } from "../src/adapters/synthetic-drive";
import { SourceError, traverse, FOLDER, MAX_BYTES, type InventoryProvider, type ProviderFile } from "../src/modules/inventory/provider";
import { claim, fail, processLease, publish, renew, runInventoryOnce, type Lease } from "../src/modules/inventory/worker";
import { preview } from "../src/modules/inventory/preview";
import { ownerPreview,type OwnerTransaction } from "../src/modules/inventory/media";

let h:Awaited<ReturnType<typeof harness>>;
before(async()=>{h=await harness();await Promise.all([h.migrate(),h.migrate()]);},{timeout:60000});
after(async()=>{if(h)await h.close();});
async function result(r:Response,status=200){assert.equal(r.status,status);return (await r.json()).data;}
async function code(r:Response,status:number,expected:string){assert.equal(r.status,status);assert.equal((await r.json()).error.code,expected);}
async function owner(){
  await h.pool.query('DELETE FROM "rateLimit"');
  const b=new BrowserSession(h.base);const email=`inventory-${randomUUID()}@example.test`;const password=fixturePassword();
  await b.request("/api/auth/sign-up/email","POST",{name:"Synthetic inventory owner",email,password});
  await b.request(await h.mail(email,"verification"));await b.request("/api/auth/sign-in/email","POST",{email,password});
  const setup=await result(await b.request("/api/v1/onboarding","POST",{name:"Inventory studio",slug:`i-${randomUUID()}`,locale:"en",timezone:"Asia/Makassar"}),201);
  const p=await result(await b.request("/api/v1/projects","POST",{client_label:"Generated color fixture",drive_folder_id:SYNTHETIC_ROOT},{"Idempotency-Key":randomUUID()}),201);
  return {b,p,studio:setup.studio};
}
const source=new SyntheticDrive();
const scope={studioId:randomUUID(),projectId:randomUUID(),rootId:SYNTHETIC_ROOT};
const signal=()=>new AbortController().signal;
async function sync(b:BrowserSession,p:{id:string},key=randomUUID()){return result(await b.request(`/api/v1/projects/${p.id}/sync`,"POST",{},{"Idempotency-Key":key}),202);}
async function lease(p:{id:string}) {const j=await claim(h.pool,randomUUID());assert.ok(j);assert.equal(j.project_id,p.id);return j;}
async function cleanQueue(){await h.pool.query("UPDATE jobs SET status='cancelled',lease_deadline=NULL WHERE status IN ('pending','running')");}
const photo=(id:string,parentId=SYNTHETIC_ROOT):ProviderFile=>({id,name:"IMG_001.jpg",parentId,mime:"image/jpeg",size:20,version:"v1"});
function fixture(files:ProviderFile[]):InventoryProvider {return {origin:"synthetic",folder:(s,id,abort)=>source.folder(s,id,abort),async list(){return {files,next:null};},async *read(){yield Buffer.from("not an image");}};}

test("EPIC-03 A01 bounded traversal, names/paths, skips, page/depth/photo limits and invalid ancestry",async()=>{
  const seen:{id:string;name:string;path:string}[]=[];
  const summary=await traverse(source,scope,true,signal(),async(f,path)=>{seen.push({id:f.id,name:f.name,path});});
  assert.equal(summary.photos,3);assert.deepEqual(summary.skipped,{unsupported:1,trashed:1,oversize:1,invalid_content:0});
  assert.equal(new Set(seen.map(f=>f.id)).size,3);assert.equal(seen.filter(f=>f.name==="IMG_001.jpg").length,2);assert.equal(seen[1].path,"Portraits");assert.equal(seen[2].name,"IMAGE.JPG");
  assert.equal((await traverse(source,scope,false,signal(),async()=>{})).photos,1);
  const abort=new AbortController();abort.abort();await assert.rejects(traverse(source,scope,true,abort.signal,async()=>{}),{code:"SCAN_CANCELLED"});
  await assert.rejects(traverse(fixture([photo("synthetic-off-root-01","different-parent-01")]),scope,true,signal(),async()=>{}),{code:"INVALID_PROVIDER_METADATA"});
  await assert.rejects(traverse(fixture([photo("synthetic-duplicate-1"),photo("synthetic-duplicate-1")]),scope,true,signal(),async()=>{}),{code:"DUPLICATE_PROVIDER_ID"});
  const looping=fixture([]);looping.list=async()=>({files:[],next:"same"});await assert.rejects(traverse(looping,scope,true,signal(),async()=>{}),{code:"INVALID_PROVIDER_CURSOR"});
  const deep=fixture([]);deep.list=async(_s,id)=>({files:[{...photo(`synthetic-depth-${id===SYNTHETIC_ROOT?1:Number(id.split("-").at(-1))+1}`,id),name:"Nested",mime:FOLDER}],next:null});
  await assert.rejects(traverse(deep,scope,true,signal(),async()=>{}),{code:"SCAN_DEPTH_LIMIT"});
  const many=fixture([]);many.list=async(_s,id,cursor)=>{const start=Number(cursor??0);return {files:Array.from({length:Math.min(1000,5001-start)},(_,i)=>photo(`synthetic-count-${String(start+i).padStart(5,"0")}`,id)),next:start+1000<5001?String(start+1000):null};};
  await assert.rejects(traverse(many,scope,true,signal(),async()=>{}),{code:"SCAN_PHOTO_LIMIT"});
  const exact=fixture([photo("synthetic-exact-limit")]);exact.list=async()=>({files:[{...photo("synthetic-exact-limit"),size:MAX_BYTES}],next:null});
  assert.equal((await traverse(exact,scope,false,signal(),async()=>{})).photos,1);
  const named=fixture([{...photo("synthetic-name-slash"),name:"IMG / 001.JPG"}]);let exactName="";
  await traverse(named,scope,false,signal(),async file=>{exactName=file.name;});assert.equal(exactName,"IMG / 001.JPG");
});

test("EPIC-03 A04 real isolated decoder checks actual MIME, dimensions, byte counts, metadata stripping and cancellation",async()=>{
  const file=(await source.list(scope,SYNTHETIC_ROOT,null,signal())).files[1];
  const image=await preview(source,scope,file,signal());assert.equal(image.status,"ready");assert.ok(image.bytes);
  const meta=await sharp(image.bytes).metadata();assert.equal(meta.format,"jpeg");assert.ok(meta.width!<=1024);assert.equal(meta.exif,undefined);
  assert.equal((await preview(source,scope,{...file,mime:"image/png"},signal())).status,"invalid_content");
  await assert.rejects(preview(source,scope,{...file,size:1},signal()),{code:"SOURCE_SIZE_CHANGED"});
  const bad=fixture([]);bad.read=async function*(){yield Buffer.alloc(20);};assert.equal((await preview(bad,scope,photo("synthetic-invalid-01"),signal())).status,"invalid_content");
  const pixels=await sharp({create:{width:5000,height:5000,channels:3,background:"white"}}).png().toBuffer();
  bad.read=async function*(){yield pixels;};assert.equal((await preview(bad,scope,{...photo("synthetic-pixels-001"),mime:"image/png",size:pixels.length},signal())).status,"invalid_content");
  const abort=new AbortController();abort.abort();await assert.rejects(preview(source,scope,file,abort.signal),{code:"SCAN_CANCELLED"});
});

test("EPIC-03 A01/A04 PostgreSQL worker publishes previews; scoped HTTP denies other principals and cache reuse",async()=>{
  await cleanQueue();const {b,p,studio}=await owner();const outsider=await owner();
  const j=await lease(p);assert.equal(await processLease(h.pool,j,source),true);
  const inventory=await result(await b.request(`/api/v1/projects/${p.id}/photos?limit=2`));assert.equal(inventory.origin,"synthetic");assert.equal(inventory.generation,1);assert.equal(inventory.items.length,2);assert.ok(inventory.next_cursor);
  const second=await result(await b.request(`/api/v1/projects/${p.id}/photos?limit=2&cursor=${inventory.next_cursor}`));assert.equal(second.items.length,1);
  const rows=[...inventory.items,...second.items];assert.equal(new Set(rows.map(f=>f.id)).size,3);
  const r=await b.request(rows[0].preview_url);assert.equal(r.status,200);assert.equal(r.headers.get("content-type"),"image/jpeg");assert.match(r.headers.get("cache-control")!,/no-store/);assert.equal((await sharp(Buffer.from(await r.arrayBuffer())).metadata()).format,"jpeg");
  await code(await outsider.b.request(rows[0].preview_url),404,"NOT_FOUND");await code(await new BrowserSession(h.base).request(rows[0].preview_url),401,"AUTH_REQUIRED");
  for(const suffix of ["photos","sync","sync/cancel"]){await code(await outsider.b.request(`/api/v1/projects/${p.id}/${suffix}`,suffix==="photos"?"GET":"POST",suffix==="photos"?undefined:{}),404,"NOT_FOUND");}
  await code(await b.request(`/api/v1/projects/${p.id}/photos?url=https://example.test`),422,"INVALID_INPUT");
  await code(await b.request(`/api/v1/projects/${p.id}/sync`,"POST",{},{Origin:"https://example.test","Idempotency-Key":randomUUID()}),403,"ORIGIN_DENIED");
  await h.pool.query("UPDATE studios SET suspended_at=clock_timestamp() WHERE id=$1",[studio.id]);await code(await b.request(rows[0].preview_url),403,"STUDIO_SUSPENDED");
  await h.pool.query("UPDATE studios SET suspended_at=NULL WHERE id=$1",[studio.id]);
  await result(await b.request(`/api/v1/projects/${p.id}/archive`,"POST",{expected_revision:1}));await code(await b.request(rows[0].preview_url),404,"NOT_FOUND");
  await cleanQueue();
});

test("EPIC-03 A02 partial failure, revocation, cancellation and complete removal preserve selected identities",async()=>{
  await cleanQueue();const {b,p}=await owner();await processLease(h.pool,await lease(p),source);
  const original=(await h.pool.query("SELECT * FROM project_photos WHERE project_id=$1 ORDER BY provider_file_id",[p.id])).rows;
  await h.pool.query("INSERT INTO selection_items(studio_id,project_id,selection_set_id,photo_id,note) SELECT studio_id,project_id,id,$2,'Synthetic note' FROM selection_sets WHERE project_id=$1",[p.id,original[1].id]);
  const key=randomUUID();const first=await sync(b,p,key);assert.deepEqual(await sync(b,p,key),first);
  const coalesced=await Promise.all(Array.from({length:5},()=>sync(b.clone(),p)));assert.ok(coalesced.every(x=>x.job_id===first.job_id));
  const partial=new SyntheticDrive();let pages=0;const normal=partial.list.bind(partial);partial.list=async(...args)=>{if(++pages===2)throw new SourceError("SOURCE_PERMISSION_LOST");return normal(...args);};
  assert.equal(await processLease(h.pool,await lease(p),partial),false);
  let saved=await result(await b.request(`/api/v1/projects/${p.id}`));assert.equal(saved.inventory_generation,1);assert.equal(saved.inventory_status,"failed");
  assert.equal((await h.pool.query("SELECT count(*)::int AS n FROM project_photos WHERE project_id=$1 AND available",[p.id])).rows[0].n,3);
  await code(await b.request(`/api/v1/projects/${p.id}/media/${original[0].id}`),503,"SOURCE_UNAVAILABLE");
  await sync(b,p);const cancelled=await lease(p);await result(await b.request(`/api/v1/projects/${p.id}/sync/cancel`,"POST",{job_id:cancelled.id}));
  assert.equal(await processLease(h.pool,cancelled,source),false);assert.equal(await renew(h.pool,cancelled),false);
  await code(await b.request(`/api/v1/projects/${p.id}/media/${original[0].id}`),503,"SOURCE_UNAVAILABLE"); // cancellation cannot erase provider revocation
  await sync(b,p);const reduced=new SyntheticDrive();const list=reduced.list.bind(reduced);reduced.list=async(...args)=>{const page=await list(...args);return {...page,files:page.files.filter(f=>f.id!==original[1].provider_file_id)};};
  assert.equal(await processLease(h.pool,await lease(p),reduced),true);
  const current=(await h.pool.query("SELECT id,available FROM project_photos WHERE project_id=$1 AND provider_file_id=$2",[p.id,original[1].provider_file_id])).rows[0];assert.equal(current.id,original[1].id);assert.equal(current.available,false);
  assert.equal((await h.pool.query("SELECT photo_id FROM selection_items WHERE project_id=$1",[p.id])).rows[0].photo_id,original[1].id);
  assert.equal((await b.request(`/api/v1/projects/${p.id}/media/${original[0].id}`)).status,200);
  await sync(b,p);assert.equal(await processLease(h.pool,await lease(p),source),true);
  assert.equal((await h.pool.query("SELECT id FROM project_photos WHERE project_id=$1 AND provider_file_id=$2 AND available",[p.id,original[1].provider_file_id])).rows[0].id,original[1].id);
  await sync(b,p);const corrupt=new SyntheticDrive();const normalList=corrupt.list.bind(corrupt);const normalRead=corrupt.read.bind(corrupt);
  corrupt.list=async(...args)=>{const page=await normalList(...args);return {...page,files:page.files.map(f=>f.id===original[1].provider_file_id?{...f,name:"Renamed.JPG",version:"opaque-next-version"}:f)};};
  corrupt.read=async function*(s,f,abort){if(f.id===original[1].provider_file_id)yield Buffer.alloc(f.size);else yield* normalRead(s,f,abort);};
  assert.equal(await processLease(h.pool,await lease(p),corrupt),true);
  const invalid=(await h.pool.query("SELECT id,filename,source_version,available,preview_status,preview_bytes FROM project_photos WHERE project_id=$1 AND id=$2",[p.id,original[1].id])).rows[0];
  assert.equal(invalid.filename,"Renamed.JPG");assert.equal(invalid.source_version,"opaque-next-version");assert.equal(invalid.available,false);assert.equal(invalid.preview_status,"invalid_content");assert.equal(invalid.preview_bytes,null);
  const report=await result(await b.request(`/api/v1/projects/${p.id}/photos`));assert.equal(report.summary.skipped.invalid_content,1);
  await code(await b.request(`/api/v1/projects/${p.id}/media/${invalid.id}`),404,"NOT_FOUND");
});

test("EPIC-03 A03 lease fencing, competing claims, retry hints, crash exhaustion and configuration races",async()=>{
  await cleanQueue();const {b,p}=await owner();const competing=await Promise.all(Array.from({length:5},()=>claim(h.pool,randomUUID())));assert.equal(competing.filter(Boolean).length,1);const stale=competing.find(Boolean)!;
  await h.pool.query("UPDATE jobs SET lease_deadline=clock_timestamp()-interval '1 second' WHERE id=$1",[stale.id]);
  const current=await lease(p);assert.notEqual(current.lease_token,stale.lease_token);assert.equal(await renew(h.pool,stale),false);
  const summary={photos:0,folders:1,skipped:{unsupported:0,trashed:0,oversize:0,invalid_content:0}};
  assert.equal(await publish(h.pool,stale,summary,"synthetic"),false);assert.equal(await fail(h.pool,stale,new SourceError("SOURCE_PERMISSION_LOST")),false);
  assert.equal(await fail(h.pool,current,new SourceError("SOURCE_RATE_LIMITED",true,120)),true);
  assert.equal((await h.pool.query("SELECT available_at>clock_timestamp()+interval '110 seconds' AS delayed FROM jobs WHERE id=$1",[current.id])).rows[0].delayed,true);
  assert.equal(await claim(h.pool,randomUUID()),null);
  await h.pool.query("UPDATE jobs SET available_at=clock_timestamp() WHERE id=$1",[current.id]);const last=await lease(p);
  await h.pool.query("UPDATE jobs SET attempt_count=4,lease_deadline=clock_timestamp()-interval '1 second' WHERE id=$1",[last.id]);
  assert.equal(await claim(h.pool,randomUUID()),null);assert.equal((await h.pool.query("SELECT failure_code FROM jobs WHERE id=$1",[last.id])).rows[0].failure_code,"RETRY_EXHAUSTED");
  const events=(await h.pool.query("SELECT event,code FROM inventory_job_events WHERE job_id=$1",[last.id])).rows;assert.ok(events.some(e=>e.code==="LEASE_RECOVERED"));assert.ok(events.some(e=>e.code==="RETRY_EXHAUSTED"));
  await sync(b,p);const superseded=await lease(p);
  await result(await b.request(`/api/v1/projects/${p.id}`,"PATCH",{expected_revision:1,detect_subfolders:false}));
  assert.equal(await processLease(h.pool,superseded,source),false);
  assert.equal((await result(await b.request(`/api/v1/projects/${p.id}`))).inventory_generation,0);
  assert.equal(await runInventoryOnce(h.pool,source),true);
  assert.equal((await result(await b.request(`/api/v1/projects/${p.id}/photos`))).items.length,1);
  const completed=(await h.pool.query("SELECT count(*)::int AS n FROM inventory_job_events WHERE project_id=$1 AND event='published'",[p.id])).rows[0].n;assert.equal(completed,1);
  await sync(b,p);const archivedLease=await lease(p);
  const archived=await result(await b.request(`/api/v1/projects/${p.id}/archive`,"POST",{expected_revision:2}));
  await result(await b.request(`/api/v1/projects/${p.id}/restore`,"POST",{expected_revision:archived.revision}));
  assert.equal(await processLease(h.pool,archivedLease,source),false);
  assert.equal((await result(await b.request(`/api/v1/projects/${p.id}`))).inventory_generation,1);
  await sync(b,p);const short=await lease(p);
  await h.pool.query("CREATE FUNCTION slow_inventory_publish_test() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_sleep(1.2); RETURN NEW; END $$; CREATE TRIGGER slow_inventory_publish BEFORE UPDATE ON projects FOR EACH ROW EXECUTE FUNCTION slow_inventory_publish_test()");
  try{
    await h.pool.query("UPDATE jobs SET lease_deadline=clock_timestamp()+interval '1 second' WHERE id=$1",[short.id]);
    await assert.rejects(publish(h.pool,short,summary,"synthetic"),{code:"LEASE_LOST"});
  }finally{await h.pool.query("DROP TRIGGER slow_inventory_publish ON projects; DROP FUNCTION slow_inventory_publish_test()");}
  assert.equal((await result(await b.request(`/api/v1/projects/${p.id}`))).inventory_generation,1);
  assert.equal((await h.pool.query("SELECT count(*)::int AS n FROM project_photos WHERE project_id=$1 AND available",[p.id])).rows[0].n,1);
  await cleanQueue();
});

test("public cached preview releases DB locks for provider checks and rechecks archive/version/expiry after the wait",async()=>{
  await cleanQueue();const {b,p,studio}=await owner();await processLease(h.pool,await lease(p),source);
  await h.pool.query("UPDATE projects SET inventory_origin='google_public' WHERE id=$1",[p.id]);
  await h.pool.query("UPDATE project_photos SET preview_expires_at=clock_timestamp()+interval '1 day' WHERE project_id=$1",[p.id]);
  const photo=(await h.pool.query("SELECT id FROM project_photos WHERE project_id=$1 LIMIT 1",[p.id])).rows[0];
  const request=new Request(`${h.base}/api/v1/projects/${p.id}/media/${photo.id}`);
  let transactions=0;
  const asOwner:OwnerTransaction=async read=>{
    const c=await h.pool.connect();try{await c.query("BEGIN");transactions++;await c.query("SELECT id FROM studios WHERE id=$1 FOR UPDATE",[studio.id]);const result=await read(c,{id:studio.id,user_id:randomUUID()});await c.query("COMMIT");return result;}
    catch(error){await c.query("ROLLBACK");throw error;}finally{c.release();}
  };
  const verified=await ownerPreview(request,p.id,photo.id,asOwner,async()=>{const c=await h.pool.connect();try{await c.query("BEGIN");await c.query("SELECT id FROM projects WHERE id=$1 FOR UPDATE NOWAIT",[p.id]);await c.query("ROLLBACK");}finally{c.release();}});
  assert.equal(verified.status,200);assert.equal(transactions,2);
  await assert.rejects(ownerPreview(request,p.id,photo.id,asOwner,async()=>{throw new SourceError("SOURCE_PERMISSION_LOST");}),{code:"SOURCE_UNAVAILABLE"});
  await assert.rejects(ownerPreview(request,p.id,photo.id,asOwner,async()=>{await h.pool.query("UPDATE project_photos SET source_version='new-version' WHERE id=$1",[photo.id]);}),{code:"SOURCE_UNAVAILABLE"});
  await assert.rejects(ownerPreview(request,p.id,photo.id,asOwner,async()=>{await result(await b.request(`/api/v1/projects/${p.id}/archive`,"POST",{expected_revision:1}));}),{code:"NOT_FOUND"});
  const archived=await result(await b.request(`/api/v1/projects/${p.id}`));await result(await b.request(`/api/v1/projects/${p.id}/restore`,"POST",{expected_revision:archived.revision}));
  await h.pool.query("UPDATE project_photos SET preview_expires_at=clock_timestamp() WHERE id=$1",[photo.id]);
  await code(await b.request(`/api/v1/projects/${p.id}/media/${photo.id}`),503,"SOURCE_UNAVAILABLE");
  const listing=await result(await b.request(`/api/v1/projects/${p.id}/photos`));assert.equal(listing.items.find((item:{id:string})=>item.id===photo.id).preview_url,null);
  await sync(b,p);await runInventoryOnce(h.pool,{origin:"google_public",forScope:()=>{throw new SourceError("SOURCE_NOT_APPROVED");}});
  const job=(await h.pool.query("SELECT status,failure_code FROM jobs WHERE project_id=$1 ORDER BY created_at DESC LIMIT 1",[p.id])).rows[0];assert.equal(job.status,"failed");assert.equal(job.failure_code,"SOURCE_NOT_APPROVED");
});
