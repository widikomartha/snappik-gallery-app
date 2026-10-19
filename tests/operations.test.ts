import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import * as OTPAuth from "otpauth";
import { Pool } from "pg";
import { harness, BrowserSession, fixturePassword } from "./harness";
import { galleryFixture, result, code } from "./gallery-fixture";
import { migrate } from "../src/db/migrate";
import { encryptedBackup, restoreQuarantined } from "../src/modules/operations/backup";
import { assertOperational } from "../src/modules/operations/recovery";

let h:Awaited<ReturnType<typeof harness>>;
before(async()=>{h=await harness({inventoryAdapter:"synthetic",captureLogs:true});await h.migrate();await h.migrate();},{timeout:60000});
after(async()=>{if(h)await h.close();});
const headers=()=>({"Idempotency-Key":randomUUID()});
const intent={reason:"Synthetic support request verified"};
async function operator(permissions=["diagnostics_read","entitlement_write","studio_suspend"],studio?:string) {
  await h.pool.query('DELETE FROM "rateLimit"');
  const b=new BrowserSession(h.base),email=`ops-${randomUUID()}@example.test`,password=fixturePassword();
  await result(await b.request("/api/auth/sign-up/email","POST",{name:"Synthetic operator",email,password}));await b.request(await h.mail(email,"verification"));
  await result(await b.request("/api/auth/sign-in/email","POST",{email,password}));
  const user=(await (await b.request("/api/auth/get-session")).json()).user.id;
  for(const p of permissions)await h.pool.query("INSERT INTO platform_roles(user_id,permission,studio_id) VALUES($1,$2,$3)",[user,p,studio??null]);
  const enrollment=await (await b.request("/api/auth/two-factor/enable","POST",{password,method:"totp"})).json();
  const totp=OTPAuth.URI.parse(enrollment.totpURI);
  return {b,user,totp,password,email,async verify(){await result(await b.request("/api/auth/two-factor/verify-totp","POST",{code:totp.generate(),trustDevice:false}));}};
}
async function studio(f:Awaited<ReturnType<typeof galleryFixture>>) {return (await result(await f.owner.request("/api/v1/me"))).studio.id as string;}

test("A01 separate operator permission, actual fresh session-bound TOTP, safe diagnostics and scoped denials",async()=>{
  const f=await galleryFixture(h),id=await studio(f),path=`/api/v1/ops/studios/${id}`;
  await code(await new BrowserSession(h.base).request(path),401,"AUTH_REQUIRED");
  await code(await f.owner.request(path),403,"OPERATOR_DENIED");
  await code(await f.owner.request("/api/v1/ops/roles","POST",{permission:"studio_suspend"}),404,"NOT_FOUND");
  const op=await operator(["diagnostics_read"],id);
  await code(await op.b.request(path),403,"FRESH_MFA_REQUIRED");
  const badCode=op.totp.generate()==="000000"?"111111":"000000";
  assert.ok((await op.b.request("/api/auth/two-factor/verify-totp","POST",{code:badCode,trustDevice:false})).status>=400);
  // Enrollment alone isn't proof, and a failed code cannot mint a proof.
  assert.equal((await h.pool.query("SELECT count(*)::int n FROM operator_mfa_proofs p JOIN session s ON s.id=p.session_id WHERE s.\"userId\"=$1",[op.user])).rows[0].n,0);
  await h.pool.query("CREATE FUNCTION fail_proof_test() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected'; END $$; CREATE TRIGGER fail_proof BEFORE INSERT ON operator_mfa_proofs FOR EACH ROW EXECUTE FUNCTION fail_proof_test()");
  try {await code(await op.b.request("/api/auth/two-factor/verify-totp","POST",{code:op.totp.generate(),trustDevice:false}),503,"TEMPORARILY_UNAVAILABLE");}
  finally {await h.pool.query("DROP TRIGGER fail_proof ON operator_mfa_proofs; DROP FUNCTION fail_proof_test()");}
  await code(await op.b.request(path),403,"FRESH_MFA_REQUIRED");
  await op.verify();const dto=await result(await op.b.request(path));
  assert.deepEqual(Object.keys(dto).sort(),["id","setup_status","suspended_at","revision","provisioned_at","active_projects","failed_jobs","active_grants"].sort());
  assert.equal(dto.id,id);assert.equal(dto.active_projects,1);
  const listed=await result(await op.b.request("/api/v1/ops/studios?limit=1"));assert.equal(listed.items.length,1);assert.equal(listed.items[0].id,id);
  const other=await galleryFixture(h);await code(await op.b.request(`/api/v1/ops/studios/${await studio(other)}`),403,"OPERATOR_DENIED");
  await code(await op.b.request(`${path}/suspend`,"POST",intent,headers()),403,"OPERATOR_DENIED");
  await code(await op.b.request("/api/v1/ops/metrics"),403,"OPERATOR_DENIED");
  await code(await op.b.request(`${path}?photos=true`),422,"INVALID_INPUT");
  await code(await op.b.request(`${path}/grants`),404,"NOT_FOUND");
  await code(await op.b.request("/api/v1/ops/studios?limit=51"),422,"INVALID_INPUT");
  await code(await op.b.request(path,"GET",undefined,{"Sec-Fetch-Site":"cross-site"}),403,"ORIGIN_DENIED");
  await h.pool.query("UPDATE operator_mfa_proofs SET verified_at=clock_timestamp()-interval '5 minutes' WHERE session_id IN (SELECT id FROM session WHERE \"userId\"=$1)",[op.user]);
  await code(await op.b.request(path),403,"FRESH_MFA_REQUIRED");await op.verify();
  const fresh=new BrowserSession(h.base);await fresh.request("/api/auth/sign-in/email","POST",{email:op.email,password:op.password});
  await code(await fresh.request(path),401,"AUTH_REQUIRED");
  const copied=op.b.clone();await op.b.request("/api/auth/sign-out","POST",{});await code(await copied.request(path),401,"AUTH_REQUIRED");
});

test("A01 grants/suspension atomic audit, parallel replay, payload conflict, expiry tombstones and rollback",async()=>{
  const f=await galleryFixture(h),id=await studio(f),op=await operator();await op.verify();const path=`/api/v1/ops/studios/${id}`;
  const grant={...intent,starts_at:"2026-10-01T00:00:00Z",ends_at:"2026-11-01T00:00:00Z",project_limit:12},key=headers();
  const replies=await Promise.all(Array.from({length:8},()=>op.b.clone().request(`${path}/grants`,"POST",grant,key)));
  const first=await result(replies[0]);for(const r of replies.slice(1))assert.deepEqual(await result(r),first);
  assert.equal((await h.pool.query("SELECT count(*)::int n FROM entitlement_grants WHERE studio_id=$1 AND source='manual'",[id])).rows[0].n,1);
  assert.equal((await h.pool.query("SELECT count(*)::int n FROM operator_events WHERE studio_id=$1",[id])).rows[0].n,1);
  await code(await op.b.request(`${path}/grants`,"POST",{...grant,project_limit:13},key),409,"IDEMPOTENCY_CONFLICT");
  await code(await op.b.request(`${path}/grants`,"POST",{...grant,ends_at:"2028-11-01T00:00:00Z"},headers()),422,"INVALID_INPUT");
  await code(await op.b.request(`${path}/grants`,"POST",{...grant,project_limit:0},headers()),422,"INVALID_INPUT");
  await code(await op.b.request(`${path}/suspend`,"POST",{reason:"short"},headers()),422,"INVALID_INPUT");
  await code(await op.b.request(`${path}/suspend`,"POST",{...intent,studio_id:id},headers()),422,"INVALID_INPUT");
  await code(await op.b.request(`${path}/suspend`,"POST",intent,{...headers(),Origin:"https://foreign.example.test"}),403,"ORIGIN_DENIED");
  await h.pool.query("UPDATE operator_requests SET expires_at=clock_timestamp() WHERE studio_id=$1",[id]);
  await code(await op.b.request(`${path}/grants`,"POST",grant,key),409,"IDEMPOTENCY_EXPIRED");
  await h.pool.query("CREATE FUNCTION fail_operator_test() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected'; END $$; CREATE TRIGGER fail_operator BEFORE INSERT ON operator_events FOR EACH ROW EXECUTE FUNCTION fail_operator_test()");
  const retry=headers();try{await code(await op.b.request(`${path}/suspend`,"POST",intent,retry),503,"TEMPORARILY_UNAVAILABLE");}
  finally{await h.pool.query("DROP TRIGGER fail_operator ON operator_events; DROP FUNCTION fail_operator_test()");}
  assert.equal((await h.pool.query("SELECT suspended_at FROM studios WHERE id=$1",[id])).rows[0].suspended_at,null);
  await result(await op.b.request(`${path}/suspend`,"POST",intent,retry));
  assert.ok((await h.pool.query("SELECT suspended_at FROM studios WHERE id=$1",[id])).rows[0].suspended_at);
  // Immutable audit and no sensitive reason/actor exposed through support projection.
  await assert.rejects(h.pool.query("UPDATE operator_events SET reason='tampered synthetic reason' WHERE id=$1",[first.event_id]));
  const events=await result(await op.b.request("/api/v1/ops/audit-events?limit=50"));assert.ok(events.items.length>=2);
  assert.ok(events.items.every((e:Record<string,unknown>)=>!('reason'in e)&&!('actor_id'in e)));
  const m=await result(await op.b.request("/api/v1/ops/metrics"));assert.equal(m.purge_enabled,false);assert.equal(m.db_pool.maximum,12);
  await h.pool.query("UPDATE operator_attempts SET attempts=60 WHERE user_id=$1",[op.user]);await code(await op.b.request(path),429,"RATE_LIMITED");
  await h.pool.query("DELETE FROM operator_attempts WHERE user_id=$1",[op.user]);await result(await op.b.request(path));
  assert.equal(h.logs().includes(intent.reason),false);assert.equal(h.logs().includes(f.p.public_url),false);assert.equal(h.logs().includes(op.b.cookie),false);
});

test("A01/A02 suspension races client writes and permanently denies old main/download grants after reactivation",async()=>{
  const f=await galleryFixture(h),id=await studio(f),op=await operator();await op.verify();
  await result(await f.client.request(`${f.path}/access`,"POST",{workflow:"main"}));await result(await f.client.request(`${f.path}/access`,"POST",{workflow:"download"}));
  const photos=(await result(await f.client.request(`${f.path}/photos`))).items;
  const responses=await Promise.all([op.b.request(`/api/v1/ops/studios/${id}/suspend`,"POST",intent,headers()),f.client.request(`${f.path}/selection`,"PUT",{expected_revision:1,items:[{photo_id:photos[0].id,note:"Synthetic race"}]})]);
  assert.equal(responses[0].status,200);assert.ok([200,404].includes(responses[1].status));
  await code(await f.client.request(`${f.path}/photos`),404,"GALLERY_UNAVAILABLE");
  await code(await f.owner.request(`/api/v1/projects/${f.p.id}`),403,"STUDIO_SUSPENDED");
  await result(await op.b.request(`/api/v1/ops/studios/${id}/reactivate`,"POST",intent,headers()));
  await code(await f.client.request(`${f.path}/photos`),401,"GALLERY_GRANT_REQUIRED");
  await code(await f.client.request(`${f.path}/download/${photos[0].id}`),401,"GALLERY_GRANT_REQUIRED");
  await result(await f.client.request(`${f.path}/access`,"POST",{workflow:"main"}));await result(await f.client.request(`${f.path}/photos`));
  await h.pool.query("DELETE FROM platform_roles WHERE user_id=$1",[op.user]);await code(await op.b.request("/api/v1/ops/studios"),403,"OPERATOR_DENIED");
});

test("A03 actual encrypted DB/private-preview restore preserves immutable results and quarantines all access",async()=>{
  const f=await galleryFixture(h);await result(await f.client.request(`${f.path}/access`,"POST",{workflow:"main"}));
  const photos=(await result(await f.client.request(`${f.path}/photos`))).items;
  const saved=await result(await f.client.request(`${f.path}/selection`,"PUT",{expected_revision:1,items:[{photo_id:photos[0].id,note:"Synthetic restore proof"}]}));
  const confirmation=await result(await f.client.request(`${f.path}/selection/confirm`,"POST",{expected_revision:saved.revision},headers()));
  const key=randomBytes(32),backup=await encryptedBackup(h.pool,key);
  assert.equal(backup.includes(Buffer.from("Synthetic restore proof")),false);
  // Newer revocations are deliberately absent from the backup. Offline restore
  // must not make either the old session or old share URL usable again.
  await h.pool.query("UPDATE gallery_sessions SET revoked_at=clock_timestamp() WHERE project_id=$1",[f.p.id]);
  const database=`restore_${randomUUID().replaceAll("-","")}`;await h.pool.query(`CREATE DATABASE "${database}"`);
  const connection=new URL(h.pool.options.connectionString!);connection.pathname=`/${database}`;
  const target=new Pool({connectionString:connection.toString()});
  try {
    await migrate(target);const corrupt=Buffer.from(backup);corrupt[corrupt.length-1]^=1;
    await assert.rejects(restoreQuarantined(target,corrupt,key));await assert.rejects(restoreQuarantined(target,backup,randomBytes(32)));
    assert.equal((await target.query('SELECT count(*)::int n FROM "user"')).rows[0].n,0);
    await restoreQuarantined(target,backup,key);await assert.rejects(assertOperational(target));
    const restored=(await target.query("SELECT * FROM selection_confirmations WHERE id=$1",[confirmation.id])).rows[0];assert.equal(restored.items[0].note,"Synthetic restore proof");
    const original=(await h.pool.query("SELECT preview_bytes FROM project_photos WHERE id=$1",[photos[0].id])).rows[0];
    assert.deepEqual((await target.query("SELECT preview_bytes FROM project_photos WHERE id=$1",[photos[0].id])).rows[0].preview_bytes,original.preview_bytes);
    assert.equal((await target.query('SELECT count(*)::int n FROM session')).rows[0].n,0);
    assert.equal((await target.query("SELECT count(*)::int n FROM platform_roles")).rows[0].n,0);
    assert.equal((await target.query("SELECT count(*)::int n FROM gallery_sessions WHERE revoked_at IS NULL")).rows[0].n,0);
    assert.notEqual((await target.query("SELECT public_token FROM projects WHERE id=$1",[f.p.id])).rows[0].public_token,f.p.public_url.split("/").at(-1));
    await assert.rejects(target.query("DELETE FROM selection_confirmations WHERE id=$1",[confirmation.id]));
    await assert.rejects(restoreQuarantined(target,backup,key));
    assert.equal((await target.query("SELECT count(*)::int n FROM selection_confirmations WHERE id=$1",[confirmation.id])).rows[0].n,1);
  }finally{key.fill(0);await target.end();}
  // Actual HTTP fence, including auth and health. No recovery release endpoint.
  await h.pool.query("UPDATE recovery_control SET quarantined=true");
  try {
    for(const path of ["/api/v1/me",`${f.path}/photos`,"/api/auth/get-session"])await code(await f.owner.request(path),503,"RECOVERY_QUARANTINED");
    assert.equal((await fetch(`${h.base}/health/ready`)).status,503);assert.equal((await fetch(`${h.base}/health/live`)).status,200);
  }finally{await h.pool.query("UPDATE recovery_control SET quarantined=false");}
});
