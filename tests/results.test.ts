import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { harness, BrowserSession } from "./harness";
import { galleryFixture, result, code } from "./gallery-fixture";
import { originalDownload, attachment } from "../src/modules/gallery/download";
import { authorizedWorkflow } from "../src/modules/projects/access";
import { Problem } from "../src/modules/http";
import type { OwnerTransaction } from "../src/modules/inventory/media";
import { MAX_BYTES } from "../src/modules/inventory/provider";
import { SyntheticDrive } from "../src/adapters/synthetic-drive";

let h:Awaited<ReturnType<typeof harness>>;
before(async()=>{h=await harness({inventoryAdapter:"synthetic"});await h.migrate();await h.migrate();},{timeout:60000});
after(async()=>{if(h)await h.close();});
const key=()=>({"Idempotency-Key":randomUUID()});
async function fixture(){const f=await galleryFixture(h);await result(await f.client.request(`${f.path}/access`,"POST",{workflow:"main"}));const photos=(await result(await f.client.request(`${f.path}/photos`))).items;return {...f,photos};}
async function save(f:Awaited<ReturnType<typeof fixture>>,revision=1){return result(await f.client.request(`${f.path}/selection`,"PUT",{expected_revision:revision,items:f.photos.slice(0,2).map((p:{id:string},i:number)=>({photo_id:p.id,note:i?"=1+1":"Exact synthetic note"}))}));}

test("A01/A02 confirmation validates canonical draft, atomically locks, recovers lost response and isolates session/key",async()=>{
  const f=await fixture(),{client:c,path,p}=f;
  await code(await c.request(`${path}/selection/confirm`,"POST",{expected_revision:1},key()),422,"QUOTA_EXCEEDED");
  const s=await save(f);const headers=key(),intent={expected_revision:s.revision};
  await code(await c.request(`${path}/selection/confirm`,"POST",intent),422,"INVALID_INPUT");
  await code(await c.request(`${path}/selection/confirm`,"POST",{...intent,items:[]},headers),422,"INVALID_INPUT");
  await code(await c.request(`${path}/selection/confirm`,"POST",{expected_revision:1},key()),409,"REVISION_CONFLICT");
  await code(await c.request(`${path}/selection/confirm`,"POST",intent,{...headers,Origin:"https://example.test"}),403,"ORIGIN_DENIED");
  const snap=await result(await c.request(`${path}/selection/confirm`,"POST",intent,headers));
  assert.equal(snap.revision,s.revision+1);assert.equal(snap.items.length,2);assert.ok(snap.items.every((i:object)=>!("provider_file_id" in i)));
  assert.deepEqual(await result(await c.clone().request(`${path}/selection/confirm`,"POST",intent,headers)),snap);
  await code(await c.request(`${path}/selection/confirm`,"POST",{expected_revision:snap.revision},headers),409,"IDEMPOTENCY_CONFLICT");
  await code(await c.request(`${path}/selection/confirm`,"POST",intent,key()),409,"SELECTION_LOCKED");
  await code(await c.request(`${path}/selection`,"PUT",{expected_revision:snap.revision,items:[]}),409,"SELECTION_LOCKED");
  const d=await result(await c.request(`${path}/selection`));assert.deepEqual(d.latest_confirmation,snap);assert.equal(d.status,"confirmed");
  const another=new BrowserSession(h.base);await result(await another.request(`${path}/access`,"POST",{workflow:"main"}));
  await code(await another.request(`${path}/selection/confirm`,"POST",intent,headers),409,"SELECTION_LOCKED");
  await h.pool.query("UPDATE selection_requests SET expires_at=clock_timestamp() WHERE project_id=$1",[p.id]);
  await code(await c.request(`${path}/selection/confirm`,"POST",intent,headers),409,"IDEMPOTENCY_EXPIRED");
  assert.equal((await h.pool.query("SELECT count(*)::int AS n FROM selection_confirmations WHERE project_id=$1",[p.id])).rows[0].n,1);
  await assert.rejects(h.pool.query("UPDATE selection_confirmations SET items='[]'::jsonb WHERE project_id=$1",[p.id]),/immutable/);
  await assert.rejects(h.pool.query("DELETE FROM selection_confirmations WHERE project_id=$1",[p.id]),/immutable/);
});

test("A01/A02 independent HTTP save/confirm and confirm/confirm races resolve one acknowledged revision",async()=>{
  for(const mode of ["save","confirm"]){
    const f=await fixture();const s=await save(f),{client:c,path,p}=f;
    const blocker=await h.pool.connect();await blocker.query("BEGIN");await blocker.query("SELECT id FROM studios WHERE id=$1 FOR UPDATE",[p.studio_id]);
    const pending=[c.clone().request(`${path}/selection/confirm`,"POST",{expected_revision:s.revision},key()),mode==="save"?c.clone().request(`${path}/selection`,"PUT",{expected_revision:s.revision,items:[{photo_id:f.photos[2].id}]}):c.clone().request(`${path}/selection/confirm`,"POST",{expected_revision:s.revision},key())];
    await blocker.query("COMMIT");blocker.release();const replies=await Promise.all(pending);assert.deepEqual(replies.map(r=>r.status).sort(),[200,409]);
    const state=await result(await c.request(`${path}/selection`));const snapshots=(await h.pool.query("SELECT revision,items FROM selection_confirmations WHERE project_id=$1",[p.id])).rows;
    if(state.status==="confirmed"){assert.equal(snapshots.length,1);assert.equal(state.items.length,2);assert.equal(snapshots[0].revision,state.revision);}else{assert.equal(snapshots.length,0);assert.equal(state.items[0].photo_id,f.photos[2].id);}
  }
});

test("A01 confirmation denial/rollback preserves saved intent and creates no snapshot",async()=>{
  const f=await fixture();const s=await save(f),headers=key();
  await h.pool.query("UPDATE project_photos SET available=false WHERE id=$1",[s.items[0].photo_id]);
  await code(await f.client.request(`${f.path}/selection/confirm`,"POST",{expected_revision:s.revision},headers),422,"SOURCE_PHOTO_UNAVAILABLE");
  await h.pool.query("UPDATE project_photos SET available=true WHERE id=$1",[s.items[0].photo_id]);
  await h.pool.query(`CREATE FUNCTION results_fail_lock() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic rollback'; END $$;
    CREATE TRIGGER results_fail_lock BEFORE UPDATE ON selection_sets FOR EACH ROW EXECUTE FUNCTION results_fail_lock()`);
  try{await code(await f.client.request(`${f.path}/selection/confirm`,"POST",{expected_revision:s.revision},headers),503,"TEMPORARILY_UNAVAILABLE");}
  finally{await h.pool.query("DROP TRIGGER results_fail_lock ON selection_sets; DROP FUNCTION results_fail_lock()");}
  assert.deepEqual(await result(await f.client.request(`${f.path}/selection`)),s);
  assert.equal((await h.pool.query("SELECT count(*)::int AS n FROM selection_confirmations WHERE project_id=$1",[f.p.id])).rows[0].n,0);
  await result(await f.client.request(`${f.path}/selection/confirm`,"POST",{expected_revision:s.revision},headers));
});

test("A02/A03 simultaneous matching confirms/reopens replay once; competing reopen and revoked confirm deny",async()=>{
  const f=await fixture(),{client:c,path,p,owner}=f;const s=await save(f),headers=key(),body={expected_revision:s.revision};
  const replies=await Promise.all([c.clone().request(`${path}/selection/confirm`,"POST",body,headers),c.clone().request(`${path}/selection/confirm`,"POST",body,headers)]);
  const first=await result(replies[0]);assert.deepEqual(await result(replies[1]),first);
  const reopen=`/api/v1/projects/${p.id}/selection/reopen`,reopenBody={expected_revision:first.revision,reason:"Synthetic collaborative revision request"},reopenKey=key();
  const opened=await Promise.all([owner.clone().request(reopen,"POST",reopenBody,reopenKey),owner.clone().request(reopen,"POST",reopenBody,reopenKey)]);
  const current=await result(opened[0]);assert.deepEqual(await result(opened[1]),current);
  assert.equal((await h.pool.query("SELECT count(*)::int AS n FROM audit_events WHERE project_id=$1 AND action='selection.reopen'",[p.id])).rows[0].n,1);
  await code(await owner.request(reopen,"POST",reopenBody,key()),409,"REVISION_CONFLICT");
  await h.pool.query("UPDATE project_workflows SET quota=1 WHERE project_id=$1 AND kind='main'",[p.id]);await code(await c.request(`${path}/selection/confirm`,"POST",{expected_revision:current.revision},key()),422,"QUOTA_EXCEEDED");
  await h.pool.query("UPDATE project_workflows SET quota=2,expires_at=clock_timestamp() WHERE project_id=$1 AND kind='main'",[p.id]);
  await code(await c.request(`${path}/selection/confirm`,"POST",body,headers),404,"GALLERY_UNAVAILABLE");
  assert.equal((await h.pool.query("SELECT count(*)::int AS n FROM selection_confirmations WHERE project_id=$1",[p.id])).rows[0].n,1);
});

test("A03/A04 reopen retains immutable history, reason audit, stable IDs/names/CSV and expired-owner exports",async()=>{
  const f=await fixture(),{owner,client:c,path,p}=f,ownerPath=`/api/v1/projects/${p.id}`;
  await result(await owner.request(ownerPath,"PATCH",{expected_revision:p.revision,main:{quota:3}}));
  const s=await result(await c.request(`${path}/selection`,"PUT",{expected_revision:1,items:f.photos.map((photo:{id:string},index:number)=>({photo_id:photo.id,note:index?"=1+1":"Synthetic, quoted \"note\"\nsecond line"}))}));
  const snap=await result(await c.request(`${path}/selection/confirm`,"POST",{expected_revision:s.revision},key()));
  const history=await result(await owner.request(`${ownerPath}/confirmations?limit=1`));assert.equal(history.items[0].id,snap.id);
  const exact=(await owner.request(`${ownerPath}/results.csv?confirmation_id=${snap.id}`));assert.equal(exact.status,200);const csv=await exact.text();
  assert.ok(csv.includes(snap.confirmed_at));
  assert.match(csv,/"'=1\+1"/);assert.match(csv,/"IMG_001.jpg"/);assert.match(csv,/"IMAGE.JPG"/);assert.match(csv,/Portraits/);assert.match(csv,/Synthetic, quoted ""note""\nsecond line/);assert.match(csv,/provider_file_id/);for(const i of snap.items)assert.ok(csv.includes(i.photo_id));
  await code(await owner.request(`${ownerPath}/results.csv`),422,"INVALID_INPUT");
  const reason="Synthetic client requested a revision",headers=key(),body={expected_revision:snap.revision,reason};
  await code(await owner.request(`${ownerPath}/selection/reopen`,"POST",{...body,reason:"short"},key()),422,"INVALID_INPUT");
  await code(await owner.request(`${ownerPath}/selection/reopen`,"POST",{...body,expected_revision:1},key()),409,"REVISION_CONFLICT");
  const reopened=await result(await owner.request(`${ownerPath}/selection/reopen`,"POST",body,headers));
  assert.equal(reopened.revision,snap.revision+1);assert.equal(reopened.items.length,3);assert.equal(reopened.status,"selecting");
  assert.deepEqual(await result(await owner.request(`${ownerPath}/selection/reopen`,"POST",body,headers)),reopened);
  assert.equal((await h.pool.query("SELECT reason FROM audit_events WHERE project_id=$1 AND action='selection.reopen'",[p.id])).rows[0].reason,reason);
  const renamed="=Synthetic.JPG";await h.pool.query("UPDATE project_photos SET filename=$2 WHERE project_id=$1",[p.id,renamed]);
  const snap2=await result(await c.request(`${path}/selection/confirm`,"POST",{expected_revision:reopened.revision},key()));assert.notEqual(snap.id,snap2.id);
  assert.equal(await (await owner.request(`${ownerPath}/results.csv?confirmation_id=${snap.id}`)).text(),csv);
  const newer=await (await owner.request(`${ownerPath}/results.csv?confirmation_id=${snap2.id}`)).text();assert.match(newer,/"'=Synthetic.JPG"/);
  const first=await result(await owner.request(`${ownerPath}/confirmations?limit=1`));assert.equal(first.items[0].id,snap2.id);const second=await result(await owner.request(`${ownerPath}/confirmations?limit=1&cursor=${first.next_cursor}`));assert.equal(second.items[0].id,snap.id);assert.equal(second.next_cursor,null);
  const foreign=await fixture();for(const tail of ["selection","confirmations",`results.csv?confirmation_id=${snap.id}`])await code(await foreign.owner.request(`${ownerPath}/${tail}`),404,"NOT_FOUND");
  await code(await foreign.owner.request(`${ownerPath}/selection/reopen`,"POST",{expected_revision:snap2.revision,reason},key()),404,"NOT_FOUND");
  await code(await owner.request(`/api/v1/projects/${foreign.p.id}/results.csv?confirmation_id=${snap.id}`),404,"NOT_FOUND");
  await code(await c.request(`${ownerPath}/selection`),401,"AUTH_REQUIRED");
  await h.pool.query("UPDATE entitlement_grants SET starts_at=starts_at-interval '8 days',ends_at=ends_at-interval '8 days' WHERE studio_id=$1",[p.studio_id]);
  await code(await owner.request(`${ownerPath}/selection/reopen`,"POST",{expected_revision:snap2.revision,reason},key()),403,"ENTITLEMENT_EXPIRED");
  assert.equal((await owner.request(`${ownerPath}/results.csv?confirmation_id=${snap.id}`)).status,200);assert.equal((await owner.request(`${ownerPath}/results.csv?view=draft`)).status,200);
});

test("A05 actual original HTTP uses download-only grant independently of draft/confirmation and current revocation",async()=>{
  const f=await fixture(),{client:c,path,p}=f;const photo=f.photos[2],url=`${path}/download/${photo.id}`;
  await code(await c.request(url),401,"GALLERY_GRANT_REQUIRED");await code(await f.owner.request(url),401,"GALLERY_GRANT_REQUIRED");
  const download=new BrowserSession(h.base);await result(await download.request(`${path}/access`,"POST",{workflow:"download"}));
  const r=await download.request(url);assert.equal(r.status,200);assert.equal(r.headers.get("content-type"),"image/jpeg");assert.ok(r.headers.get("content-disposition")?.includes(photo.filename));assert.ok(r.headers.get("cache-control")?.includes("no-store"));const bytes=Buffer.from(await r.arrayBuffer());assert.equal(bytes.length,Number(r.headers.get("content-length")));assert.equal(bytes[0],255);
  await code(await download.request(`${path}/selection/confirm`,"POST",{expected_revision:1},key()),401,"GALLERY_GRANT_REQUIRED");
  await code(await download.request(`${path}/download/${randomUUID()}`),404,"NOT_FOUND");
  await h.pool.query("UPDATE gallery_sessions SET expires_at=clock_timestamp() WHERE project_id=$1 AND workflow='download'",[p.id]);await code(await download.request(url),401,"GALLERY_GRANT_REQUIRED");
  await result(await download.request(`${path}/access`,"POST",{workflow:"download"}));
  await h.pool.query("UPDATE project_workflows SET access_version=access_version+1 WHERE project_id=$1 AND kind='download'",[p.id]);await code(await download.request(url),401,"GALLERY_GRANT_REQUIRED");
  await result(await download.request(`${path}/access`,"POST",{workflow:"download"}));
  await h.pool.query("UPDATE projects SET archived_at=clock_timestamp() WHERE id=$1",[p.id]);await code(await download.request(url),404,"GALLERY_UNAVAILABLE");
  assert.ok(!attachment('Photo"\r\n/Name.JPG').includes("\r\n"));assert.match(attachment("Foto á.JPG"),/filename\*=UTF-8''Foto%20%C3%A1.JPG/);
});

test("A05 transfer boundary rejects truncation, overflow, permission loss, timeout/cancel and revocation during provider wait",async()=>{
  const f=await fixture(),{p,client:c,path}=f;await result(await c.request(`${path}/access`,"POST",{workflow:"download"}));
  const hash=createHash("sha256").update(c.cookies.get("snappik_gallery_download")!).digest("hex");
  const asClient:OwnerTransaction=async read=>{const db=await h.pool.connect();try{await db.query("BEGIN");await db.query("SELECT id FROM studios WHERE id=$1 FOR UPDATE",[p.studio_id]);await db.query("SELECT id FROM projects WHERE id=$1 FOR UPDATE",[p.id]);const grant=await authorizedWorkflow(db,hash,"download");if(!grant)throw new Problem(401,"GALLERY_GRANT_REQUIRED","Denied");const r=await read(db,{id:p.studio_id,user_id:""});await db.query("COMMIT");return r;}catch(e){await db.query("ROLLBACK");throw e;}finally{db.release();}};
  const photo=f.photos[0].id,req=()=>new Request(`${h.base}${path}/download/${photo}`);
  for(const behavior of ["truncated","overflow","forbidden","invalid"]){
    await assert.rejects(originalDownload(req(),p.id,photo,asClient,async function*(pointer){if(behavior==="forbidden")throw Error();if(behavior==="overflow")yield new Uint8Array(pointer.file.size+1);else if(behavior==="invalid")yield new Uint8Array(pointer.file.size);else yield new Uint8Array(1);}),{code:"SOURCE_UNAVAILABLE"});
  }
  await assert.rejects(originalDownload(req(),p.id,photo,asClient,async function*(){await new Promise(()=>{});yield new Uint8Array();},20),{code:"SOURCE_UNAVAILABLE"});
  const controller=new AbortController();const cancelled=originalDownload(new Request(req(),{signal:controller.signal}),p.id,photo,asClient,async function*(){controller.abort();yield new Uint8Array(1);});await assert.rejects(cancelled,{code:"SOURCE_UNAVAILABLE"});
  await h.pool.query("UPDATE project_photos SET size_bytes=$2 WHERE id=$1",[photo,MAX_BYTES+1]);await assert.rejects(originalDownload(req(),p.id,photo,asClient),{code:"SOURCE_UNAVAILABLE"});
  const file=(await h.pool.query("SELECT provider_file_id FROM project_photos WHERE id=$1",[photo])).rows[0];const synthetic=new SyntheticDrive();const scope={studioId:p.studio_id,projectId:p.id,rootId:p.drive_folder_id};const chunks=[];for await(const b of synthetic.read(scope,{id:file.provider_file_id} as any,new AbortController().signal))chunks.push(b);const bytes=Buffer.concat(chunks);await h.pool.query("UPDATE project_photos SET size_bytes=$2 WHERE id=$1",[photo,bytes.length]);
  await assert.rejects(originalDownload(req(),p.id,photo,asClient,async function*(){await h.pool.query("UPDATE gallery_sessions SET revoked_at=clock_timestamp() WHERE token_hash=$1",[hash]);yield bytes;}),{code:"GALLERY_GRANT_REQUIRED"});
});
