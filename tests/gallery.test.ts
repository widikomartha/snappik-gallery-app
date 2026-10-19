import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { harness, BrowserSession } from "./harness";
import { galleryFixture, result, code } from "./gallery-fixture";

let h:Awaited<ReturnType<typeof harness>>;
before(async()=>{h=await harness();await Promise.all([h.migrate(),h.migrate()]);},{timeout:60000});
after(async()=>{if(h)await h.close();});

test("EPIC-04 A01 discovery is minimal; real main/download grants independent, throttled, scoped and origin-bound",async()=>{
  const f=await galleryFixture(h,true),{client:c,path,p,owner}=f;
  const b=await result(await c.request(path));assert.deepEqual(Object.keys(b).sort(),["locale","workflows"]);assert.equal(JSON.stringify(b).includes(p.drive_folder_id),false);
  await code(await c.request(`${path}/photos`),401,"GALLERY_GRANT_REQUIRED");
  await code(await owner.request(`${path}/selection`),401,"GALLERY_GRANT_REQUIRED");
  await code(await c.request(`${path}/access`,"POST",{workflow:"main",password:f.download}),403,"ACCESS_DENIED");
  const access=await c.request(`${path}/access`,"POST",{workflow:"main",password:f.main});await result(access);
  assert.match(access.headers.get("set-cookie")!,/HttpOnly; SameSite=Strict/);assert.match(access.headers.get("set-cookie")!,new RegExp(`Path=${path}`));
  const g=(await h.pool.query("SELECT token_hash,expires_at<=clock_timestamp()+interval '12 hours' AS bounded FROM gallery_sessions WHERE project_id=$1",[p.id])).rows[0];assert.equal(g.bounded,true);assert.equal(g.token_hash.length,64);assert.notEqual(g.token_hash,c.cookies.get("snappik_gallery_main"));
  await result(await c.request(`${path}/photos`));await code(await c.request(`${path}/photos?workflow=download`),401,"GALLERY_GRANT_REQUIRED");
  const downloadOnly=new BrowserSession(h.base);await result(await downloadOnly.request(`${path}/access`,"POST",{workflow:"download",password:f.download}));
  await result(await downloadOnly.request(`${path}/photos?workflow=download`));await code(await downloadOnly.request(`${path}/selection`),401,"GALLERY_GRANT_REQUIRED");
  await code(await c.request(`${path}/access`,"POST",{workflow:"download",password:f.download},{Origin:"https://example.test"}),403,"ORIGIN_DENIED");
  const other=await galleryFixture(h);await code(await c.request(`${other.path}/selection`),401,"GALLERY_GRANT_REQUIRED");
  for(let i=0;i<20;i++)await c.request(`${path}/access`,"POST",{workflow:"main",password:"wrong-password"});
  const limited=await c.request(`${path}/access`,"POST",{workflow:"main",password:f.main});await code(limited,429,"RATE_LIMITED");assert.equal(limited.headers.get("retry-after"),"60");
});

test("EPIC-04 A01 current expiry, workflow version, rotation, archive and suspension deny existing grants",async()=>{
  const {client:c,path,p,owner}=await galleryFixture(h);const gate=()=>resultPromise(c.request(`${path}/access`,"POST",{workflow:"main"}));
  await gate();await h.pool.query("UPDATE gallery_sessions SET expires_at=clock_timestamp() WHERE project_id=$1",[p.id]);await code(await c.request(`${path}/selection`),401,"GALLERY_GRANT_REQUIRED");
  await gate();await h.pool.query("UPDATE project_workflows SET expires_at=clock_timestamp() WHERE project_id=$1 AND kind='main'",[p.id]);await code(await c.request(`${path}/selection`),404,"GALLERY_UNAVAILABLE");await code(await c.request(`${path}/access`,"POST",{workflow:"main"}),404,"GALLERY_UNAVAILABLE");
  await h.pool.query("UPDATE project_workflows SET expires_at=NULL WHERE project_id=$1",[p.id]);await gate();
  let current=await result(await owner.request(`/api/v1/projects/${p.id}`,"PATCH",{expected_revision:p.revision,main:{password:"new-fake-password"}}));await code(await c.request(`${path}/selection`),401,"GALLERY_GRANT_REQUIRED");
  await result(await c.request(`${path}/access`,"POST",{workflow:"main",password:"new-fake-password"}));
  await h.pool.query("UPDATE project_workflows SET enabled=false WHERE project_id=$1 AND kind='main'",[p.id]);await code(await c.request(`${path}/selection`),404,"GALLERY_UNAVAILABLE");await h.pool.query("UPDATE project_workflows SET enabled=true WHERE project_id=$1",[p.id]);
  await h.pool.query("UPDATE studios SET suspended_at=clock_timestamp() WHERE id=$1",[p.studio_id]);await code(await c.request(path),404,"GALLERY_UNAVAILABLE");await code(await c.request(`${path}/photos`),404,"GALLERY_UNAVAILABLE");await h.pool.query("UPDATE studios SET suspended_at=NULL WHERE id=$1",[p.studio_id]);
  current=await result(await owner.request(`/api/v1/projects/${p.id}/access/rotate`,"POST",{expected_revision:current.revision}));await code(await c.request(path),404,"GALLERY_UNAVAILABLE");await code(await c.request(`${path}/selection`),404,"GALLERY_UNAVAILABLE");
  const rotated=`/api/v1${current.public_url}`;await result(await c.request(`${rotated}/access`,"POST",{workflow:"main",password:"new-fake-password"}));
  await result(await owner.request(`/api/v1/projects/${p.id}/archive`,"POST",{expected_revision:current.revision}));await code(await c.request(`${rotated}/selection`),404,"GALLERY_UNAVAILABLE");
  await code(await c.request(`/api/v1/g/${"a".repeat(32)}`),404,"GALLERY_UNAVAILABLE");
});
async function resultPromise(p:Promise<Response>){return result(await p);}

test("EPIC-04 A02 protected pagination, paths and media enforce project/grant/cache/source boundaries",async()=>{
  const {client:c,path,p}=await galleryFixture(h);await result(await c.request(`${path}/access`,"POST",{workflow:"main"}));
  const first=await result(await c.request(`${path}/photos?limit=1`)),rest=await result(await c.request(`${path}/photos?limit=100&cursor=${first.next_cursor}`));assert.equal(first.items.length+rest.items.length,3);
  const all=[...first.items,...rest.items];assert.equal(all.filter(i=>i.filename==="IMG_001.jpg").length,2);assert.equal(new Set(all.map(i=>i.id)).size,3);assert.deepEqual(first.folders,["","Portraits"]);assert.equal(JSON.stringify(all).includes("provider_file_id"),false);
  assert.equal((await result(await c.request(`${path}/photos?folder=Portraits`))).items.length,2);
  const photo=all[0],media=await c.request(photo.preview_url);assert.equal(media.status,200);assert.equal(media.headers.get("content-type"),"image/jpeg");assert.equal(media.headers.get("cache-control"),"private, no-store");assert.ok((await media.arrayBuffer()).byteLength>100);
  await code(await new BrowserSession(h.base).request(photo.preview_url),401,"GALLERY_GRANT_REQUIRED");await code(await c.request(`${path}/media/${photo.id}?workflow=download`),401,"GALLERY_GRANT_REQUIRED");
  await code(await c.request(`${path}/media/${randomUUID()}`),404,"NOT_FOUND");await code(await c.request(`${path}/photos?limit=101`),422,"INVALID_INPUT");
  await h.pool.query("UPDATE project_photos SET preview_expires_at=clock_timestamp() WHERE id=$1",[photo.id]);await code(await c.request(photo.preview_url),503,"SOURCE_UNAVAILABLE");
  await h.pool.query("UPDATE projects SET source_access_denied=true WHERE id=$1",[p.id]);await code(await c.request(`${path}/photos`),503,"SOURCE_UNAVAILABLE");await code(await c.request(photo.preview_url),503,"SOURCE_UNAVAILABLE");
});

test("EPIC-04 A03 full exact draft, Unicode notes, quota, unavailable/foreign IDs, rollback and refresh",async()=>{
  const {client:c,path,p,owner}=await galleryFixture(h);await result(await c.request(`${path}/access`,"POST",{workflow:"main"}));
  const photos=(await result(await c.request(`${path}/photos`))).items;let s=await result(await c.request(`${path}/selection`));
  const save=(items:unknown[],revision=s.revision)=>c.request(`${path}/selection`,"PUT",{expected_revision:revision,items});
  s=await result(await save(photos.slice(0,2).map((p:{id:string})=>({photo_id:p.id,note:"😀".repeat(500)}))));assert.equal(s.items.length,2);assert.equal(s.status,"selecting");assert.ok(s.saved_at);
  const persisted=await result(await c.clone().request(`${path}/selection`));assert.deepEqual(persisted,s);
  await code(await save([{photo_id:photos[0].id,note:"😀".repeat(501)}]),422,"INVALID_INPUT");
  await code(await save([{photo_id:photos[0].id},{photo_id:photos[0].id}]),422,"INVALID_INPUT");await code(await save(photos.map((p:{id:string})=>({photo_id:p.id}))),422,"QUOTA_EXCEEDED");
  const other=await galleryFixture(h),foreign=(await h.pool.query("SELECT id FROM project_photos WHERE project_id=$1 LIMIT 1",[other.p.id])).rows[0].id;await code(await save([{photo_id:foreign}]),422,"SOURCE_PHOTO_UNAVAILABLE");
  await h.pool.query("UPDATE project_photos SET available=false WHERE id=$1",[photos[0].id]);const unavailable=await result(await c.request(`${path}/selection`));assert.equal(unavailable.items.find((i:{photo_id:string})=>i.photo_id===photos[0].id).available,false);await code(await save(s.items),422,"INVALID_INPUT"); // canonical DTO fields are not mutation fields
  await code(await save([{photo_id:photos[0].id}]),422,"SOURCE_PHOTO_UNAVAILABLE");assert.deepEqual(await result(await c.request(`${path}/selection`)),unavailable);
  s=await result(await save([{photo_id:photos[1].id,note:"<script>synthetic</script>"}]));assert.equal(s.items[0].note,"<script>synthetic</script>");
  await result(await owner.request(`/api/v1/projects/${p.id}`,"PATCH",{expected_revision:p.revision,notes_enabled:false}));await code(await save([{photo_id:photos[1].id,note:"changed"}]),422,"NOTES_DISABLED");
  s=await result(await save([{photo_id:photos[1].id,note:s.items[0].note}]));s=await result(await save([]));assert.equal(s.status,"not_started");assert.deepEqual(s.items,[]);
  await code(await c.request(`${path}/selection`,"PUT",{expected_revision:s.revision,items:[],studio_id:p.studio_id}),422,"INVALID_INPUT");
  await code(await c.request(`${path}/selection`,"PUT",{expected_revision:s.revision,items:[]},{Origin:"https://example.test"}),403,"ORIGIN_DENIED");
  await code(await c.request(`${path}/selection`,"PUT",{padding:"x".repeat(1048576)}),413,"PAYLOAD_TOO_LARGE");
});

test("EPIC-04 A04 separate HTTP connections race one revision; lost reply remains recoverable; locked set denies",async()=>{
  const {client:c,path,p}=await galleryFixture(h);await result(await c.request(`${path}/access`,"POST",{workflow:"main"}));const photos=(await result(await c.request(`${path}/photos`))).items;
  const initial=await result(await c.request(`${path}/selection`));
  const replies=await Promise.all(photos.slice(0,2).map((p:{id:string})=>c.clone().request(`${path}/selection`,"PUT",{expected_revision:initial.revision,items:[{photo_id:p.id}]})));assert.deepEqual(replies.map(r=>r.status).sort(),[200,409]);
  const winner=await result(replies.find(r=>r.ok)!);assert.deepEqual(await result(await c.request(`${path}/selection`)),winner);await code(replies.find(r=>!r.ok)!,409,"REVISION_CONFLICT");
  // Ignore an acknowledged transport reply, then retry the old expected revision.
  const intent={expected_revision:winner.revision,items:[{photo_id:photos[2].id}]};assert.equal((await c.request(`${path}/selection`,"PUT",intent)).status,200);await code(await c.request(`${path}/selection`,"PUT",intent),409,"REVISION_CONFLICT");
  const saved=await result(await c.request(`${path}/selection`));assert.equal(saved.items[0].photo_id,photos[2].id);
  await h.pool.query("UPDATE selection_sets SET state='confirmed',revision=revision+1 WHERE project_id=$1",[p.id]);await code(await c.request(`${path}/selection`,"PUT",{expected_revision:saved.revision,items:[]}),409,"SELECTION_LOCKED");
});

test("EPIC-04 A03 500-item maximum and 1 MiB transport; transaction failure retains acknowledged items",async()=>{
  const {client:c,path,p,owner}=await galleryFixture(h);await result(await c.request(`${path}/access`,"POST",{workflow:"main"}));
  await result(await owner.request(`/api/v1/projects/${p.id}`,"PATCH",{expected_revision:p.revision,main:{quota:500}}));
  // Additional generated metadata only, scoped to this isolated test project.
  await h.pool.query(`INSERT INTO project_photos(studio_id,project_id,provider_file_id,filename,folder_path,mime,size_bytes,source_version,seen_generation)
    SELECT $1,$2,'synthetic-bulk-'||n,'IMG_001.jpg','Bulk','image/jpeg',1,'v1',1 FROM generate_series(1,497) AS n`,[p.studio_id,p.id]);
  const ids=(await h.pool.query("SELECT id FROM project_photos WHERE project_id=$1 ORDER BY id",[p.id])).rows.map(r=>r.id);
  const payload={expected_revision:1,items:ids.map(photo_id=>({photo_id,note:"😀".repeat(500)}))};assert.ok(Buffer.byteLength(JSON.stringify(payload))<1048576);assert.ok(Buffer.byteLength(JSON.stringify(payload))>16384);
  const s=await result(await c.request(`${path}/selection`,"PUT",payload));assert.equal(s.items.length,500);assert.equal(s.quota,500);
  await code(await c.request(`${path}/selection`,"PUT",{expected_revision:s.revision,items:[...payload.items,{photo_id:randomUUID()}]}),422,"INVALID_INPUT");
  await h.pool.query(`CREATE FUNCTION gallery_fail_save() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic failure'; END $$;
    CREATE TRIGGER gallery_fail_save BEFORE UPDATE ON selection_sets FOR EACH ROW EXECUTE FUNCTION gallery_fail_save()`);
  try {await code(await c.request(`${path}/selection`,"PUT",{expected_revision:s.revision,items:[]}),503,"TEMPORARILY_UNAVAILABLE");assert.deepEqual(await result(await c.request(`${path}/selection`)),s);}
  finally {await h.pool.query("DROP TRIGGER gallery_fail_save ON selection_sets; DROP FUNCTION gallery_fail_save()");}
  // Owner entitlement expiry does not change independently authorized client writes.
  await h.pool.query("UPDATE entitlement_grants SET starts_at=starts_at-interval '8 days',ends_at=ends_at-interval '8 days' WHERE studio_id=$1",[p.studio_id]);
  const empty=await result(await c.request(`${path}/selection`,"PUT",{expected_revision:s.revision,items:[]}));assert.equal(empty.status,"not_started");
});
