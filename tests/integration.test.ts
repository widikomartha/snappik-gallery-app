import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import * as OTPAuth from "otpauth";
import { spawn } from "node:child_process";
import { harness, BrowserSession, fixturePassword } from "./harness";

let h: Awaited<ReturnType<typeof harness>>;
before(async () => { h = await harness(); }, { timeout: 60000 });
after(async () => { if (h) await h.close(); });
beforeEach(async () => { if ((await h.pool.query("SELECT to_regclass('\"rateLimit\"') IS NOT NULL AS present")).rows[0].present) await h.pool.query('DELETE FROM "rateLimit"'); });
async function status(response: Response, expected: number) {
  const code = response.status === expected ? "" : await response.clone().json().then(r => r.error?.code ?? r.code ?? "UNKNOWN").catch(() => "NON_JSON");
  assert.equal(response.status, expected, `Expected HTTP ${expected}; received HTTP ${response.status} (${code})`); return response;
}
async function account(label: string) {
  const browser = new BrowserSession(h.base); const email = `${label}@example.test`; const password = fixturePassword();
  await status(await browser.request("/api/auth/sign-up/email", "POST", { name: "Synthetic owner", email, password }), 200);
  const verify = await browser.request(await h.mail(email, "verification")); assert.ok(verify.status < 400);
  await status(await browser.request("/api/auth/sign-in/email", "POST", { email, password }), 200);
  return { browser, email, password };
}
const setup = (slug: string) => ({ name: "Synthetic Studio", slug, locale: "id", timezone: "Asia/Makassar" });
async function me(browser: BrowserSession) { const r = await browser.request("/api/v1/me"); await status(r, 200); return (await r.json()).data; }

test("A01 liveness/readiness, repeat and concurrent checksummed PostgreSQL migrations", async () => {
  await status(await fetch(`${h.base}/health/live`), 200);
  await status(await fetch(`${h.base}/health/ready`), 503);
  await Promise.all([h.migrate(), h.migrate()]); await h.migrate();
  const result = await (await status(await fetch(`${h.base}/health/ready`), 200)).json();
  assert.equal(result.data.worker, "not_running");
  assert.equal((await h.pool.query("SELECT count(*)::int AS n FROM schema_migrations")).rows[0].n, 4);
  const worker = spawn(process.execPath,["--import","tsx","src/worker/main.ts"],{env:process.env,windowsHide:true,stdio:"ignore"});
  try {
    let running=false;
    for(let i=0;i<40;i++) { const health=await (await fetch(`${h.base}/health/ready`)).json(); if(health.data.worker==="running") { running=true;break; } await new Promise(r=>setTimeout(r,100)); }
    assert.ok(running,"Worker must emit a real database heartbeat");
  } finally { worker.kill(); }
  const saved=(await h.pool.query("SELECT checksum FROM schema_migrations WHERE name='003_auth_revocation.sql'")).rows[0].checksum;
  await h.pool.query("UPDATE schema_migrations SET checksum='invalid' WHERE name='003_auth_revocation.sql'");
  try { await status(await fetch(`${h.base}/health/ready`),503); await assert.rejects(h.migrate()); }
  finally { await h.pool.query("UPDATE schema_migrations SET checksum=$1 WHERE name='003_auth_revocation.sql'",[saved]); }
});
test("A02 onboarding parallel/lost-response retry, trial preservation, settings revisions and tenant isolation", async () => {
  const a = await account("tenant-a"); const b = await account("tenant-b");
  assert.equal((await me(a.browser)).setup_status, "setup_required");
  await status(await a.browser.request("/api/v1/studio/settings"),403);
  const responses = await Promise.all(Array.from({ length: 24 }, () => a.browser.clone().request("/api/v1/onboarding", "POST", setup("studio-a"))));
  assert.equal(responses.filter(r => r.status === 201).length, 1); assert.equal(responses.filter(r => r.status === 200).length, 23);
  const original = await me(a.browser);
  const trial = original.entitlement.grants[0]; assert.equal(new Date(trial.ends_at).getTime() - new Date(trial.starts_at).getTime(), 168*3600000); assert.equal(trial.project_limit,3);
  await status(await b.browser.request("/api/v1/onboarding", "POST", setup("studio-b")), 201);
  await status(await a.browser.request("/api/v1/studio", "PATCH", { expected_revision: 1, name: "Changed", studio_id: (await me(b.browser)).studio.id }), 422);
  await status(await a.browser.request(`/api/v1/studio/${(await me(b.browser)).studio.id}`), 404);
  const competing = await Promise.all(["One", "Two"].map(name => a.browser.clone().request("/api/v1/studio", "PATCH", { expected_revision: 1, name })));
  assert.deepEqual(competing.map(r=>r.status).sort(), [200,409]);
  assert.equal((await me(b.browser)).studio.name,"Synthetic Studio");
  await status(await a.browser.request("/api/v1/studio/settings", "PATCH", { expected_revision: 1, locale: "en" }), 200);
  await status(await a.browser.request("/api/v1/onboarding", "POST", { ...setup("studio-a"), name: (await me(a.browser)).studio.name }), 200);
  const current = await me(a.browser); assert.equal(current.settings.locale,"en"); assert.deepEqual(current.entitlement.grants, original.entitlement.grants);
  const count = (await h.pool.query("SELECT (SELECT count(*) FROM studio_members WHERE studio_id=$1)::int AS members,(SELECT count(*) FROM entitlement_grants WHERE studio_id=$1)::int AS grants", [original.studio.id])).rows[0]; assert.deepEqual(count,{members:1,grants:1});
});
test("A02 setup rollback and repair never renew the original trial", async () => {
  const a = await account("rollback");
  await h.pool.query("CREATE FUNCTION fail_setup_test() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected'; END $$; CREATE TRIGGER fail_setup BEFORE INSERT ON entitlement_grants FOR EACH ROW EXECUTE FUNCTION fail_setup_test()");
  try { await status(await a.browser.request("/api/v1/onboarding", "POST", setup("rollback-studio")),503); }
  finally { await h.pool.query("DROP TRIGGER fail_setup ON entitlement_grants; DROP FUNCTION fail_setup_test()"); }
  assert.equal((await me(a.browser)).studio,null);
  await status(await a.browser.request("/api/v1/onboarding", "POST", setup("rollback-studio")),201);
  const first = await me(a.browser);
  await h.pool.query("DELETE FROM studio_settings WHERE studio_id=$1",[first.studio.id]);
  await status(await a.browser.request("/api/v1/onboarding", "POST", setup("rollback-studio")),200);
  assert.deepEqual((await me(a.browser)).entitlement.grants,first.entitlement.grants);
  assert.equal((await me(a.browser)).settings.timezone,"Asia/Makassar");
});
test("A03 login denial, refresh, durable logout, copied/expired/revoked cookies and logout storage uncertainty", async () => {
  const a = await account("sessions");
  await status(await a.browser.clone().request("/api/auth/sign-in/email", "POST", {email:a.email,password:fixturePassword()}),401);
  const id = (await me(a.browser)).user.id;
  await h.pool.query('UPDATE session SET "updatedAt"=now()-interval \'2 hours\' WHERE "userId"=$1',[id]);
  await status(await a.browser.request("/api/auth/get-session"),200); await me(a.browser);
  const stolen = a.browser.clone();
  await status(await a.browser.request("/api/auth/sign-out","POST",{}),200);
  await status(await stolen.request("/api/v1/me"),401);
  await status(await a.browser.request("/api/auth/sign-in/email","POST",{email:a.email,password:a.password}),200);
  await h.pool.query('CREATE FUNCTION fail_logout_test() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION \'injected\'; END $$; CREATE TRIGGER fail_logout BEFORE DELETE ON session FOR EACH ROW EXECUTE FUNCTION fail_logout_test()');
  try { await status(await a.browser.request("/api/auth/sign-out","POST",{}),503); await me(a.browser); }
  finally { await h.pool.query("DROP TRIGGER fail_logout ON session; DROP FUNCTION fail_logout_test()"); }
  await status(await a.browser.request("/api/auth/sign-out","POST",{}),200);
  await status(await a.browser.request("/api/auth/sign-in/email","POST",{email:a.email,password:a.password}),200);
  await h.pool.query('UPDATE session SET "expiresAt"=now() WHERE "userId"=$1',[id]);
  await status(await a.browser.request("/api/v1/me"),401);
  await status(await a.browser.request("/api/auth/sign-in/email","POST",{email:a.email,password:a.password}),200);
  await h.pool.query('DELETE FROM session WHERE "userId"=$1',[id]);
  await status(await a.browser.request("/api/v1/me"),401);
});
test("A04 single-use recovery, rollback, expired/concurrent token, old-password login race, business preservation", async () => {
  const a = await account("recovery"); await a.browser.request("/api/v1/onboarding","POST",setup("recovered-studio"));
  const first = await me(a.browser); const stale = a.browser.clone(); const newPassword = fixturePassword();
  await status(await a.browser.request("/api/auth/request-password-reset","POST",{email:a.email,redirectTo:`${h.base}/recover`}),200);
  const link = await h.mail(a.email,"recovery");
  const callback = await status(await a.browser.request(link),302); const token = new URL(callback.headers.get("location")!).searchParams.get("token")!;
  await h.pool.query('CREATE FUNCTION fail_password_test() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION \'injected\'; END $$; CREATE TRIGGER fail_password BEFORE UPDATE OF password ON account FOR EACH ROW EXECUTE FUNCTION fail_password_test()');
  try { await status(await a.browser.request("/api/auth/reset-password","POST",{token,newPassword}),503); await me(stale); }
  finally { await h.pool.query("DROP TRIGGER fail_password ON account; DROP FUNCTION fail_password_test()"); }
  const racingLogin=a.browser.clone();
  const results = await Promise.all([a.browser.clone().request("/api/auth/reset-password","POST",{token,newPassword}), a.browser.clone().request("/api/auth/reset-password","POST",{token,newPassword}), racingLogin.request("/api/auth/sign-in/email","POST",{email:a.email,password:a.password})]);
  assert.equal(results.slice(0,2).filter(r=>r.status===200).length,1); assert.equal(results.slice(0,2).filter(r=>r.status===400).length,1);
  await status(await stale.request("/api/v1/me"),401);
  await status(await racingLogin.request("/api/v1/me"),401);
  await status(await a.browser.request("/api/auth/sign-in/email","POST",{email:a.email,password:a.password}),401);
  await status(await a.browser.request("/api/auth/sign-in/email","POST",{email:a.email,password:newPassword}),200);
  assert.deepEqual((await me(a.browser)).studio,first.studio); assert.deepEqual((await me(a.browser)).entitlement,first.entitlement);
  await a.browser.request("/api/auth/request-password-reset","POST",{email:a.email});
  const expiredLink = await h.mail(a.email,"recovery"); const expiredToken = new URL(expiredLink).pathname.split("/").at(-1);
  await h.pool.query("UPDATE verification SET \"expiresAt\"=now()-interval '1 second' WHERE identifier=$1",[`reset-password:${expiredToken}`]);
  await status(await a.browser.request("/api/auth/reset-password","POST",{token:expiredToken,newPassword:fixturePassword()}),400);
});
test("A04 MFA requires proof, backup replay/concurrency, failed disable rollback, reset preserves factor and revokes pending proof", async () => {
  const a = await account("mfa"); const old = a.browser.clone();
  const enrollment = await (await status(await a.browser.request("/api/auth/two-factor/enable","POST",{password:a.password,method:"totp"}),200)).json();
  assert.equal((await me(a.browser)).user.mfa_enabled,false);
  const totp = OTPAuth.URI.parse(enrollment.totpURI);
  await status(await a.browser.request("/api/auth/two-factor/verify-totp","POST",{code:totp.generate(),trustDevice:false}),200);
  assert.equal((await me(a.browser)).user.mfa_enabled,true); await status(await old.request("/api/v1/me"),401);
  const challenge = new BrowserSession(h.base);
  const signIn = await (await status(await challenge.request("/api/auth/sign-in/email","POST",{email:a.email,password:a.password}),200)).json(); assert.equal(signIn.twoFactorRedirect,true);
  await status(await challenge.request("/api/v1/me"),401);
  const copies = [challenge.clone(),challenge.clone()];
  const verified = await Promise.all(copies.map(b=>b.request("/api/auth/two-factor/verify-backup-code","POST",{code:enrollment.backupCodes[0],trustDevice:false})));
  assert.equal(verified.filter(r=>r.status===200).length,1); const valid = copies[verified.findIndex(r=>r.status===200)];
  await me(valid);
  const replay = new BrowserSession(h.base); await replay.request("/api/auth/sign-in/email","POST",{email:a.email,password:a.password});
  const replayResult = await replay.request("/api/auth/two-factor/verify-backup-code","POST",{code:enrollment.backupCodes[0],trustDevice:false}); assert.ok(replayResult.status>=400);
  await h.pool.query('CREATE FUNCTION fail_factor_test() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION \'injected\'; END $$; CREATE TRIGGER fail_factor BEFORE DELETE ON "twoFactor" FOR EACH ROW EXECUTE FUNCTION fail_factor_test()');
  try { await status(await valid.request("/api/auth/two-factor/disable","POST",{password:a.password}),503); assert.equal((await me(valid)).user.mfa_enabled,true); }
  finally { await h.pool.query('DROP TRIGGER fail_factor ON "twoFactor"; DROP FUNCTION fail_factor_test()'); }
  // Start the next independent security scenario with a fresh throttle window.
  await h.pool.query('DELETE FROM "rateLimit"');
  const pending = new BrowserSession(h.base); await pending.request("/api/auth/sign-in/email","POST",{email:a.email,password:a.password});
  await pending.request("/api/auth/request-password-reset","POST",{email:a.email});
  const token = new URL(await h.mail(a.email,"recovery")).pathname.split("/").at(-1); const newPassword=fixturePassword();
  await status(await pending.request("/api/auth/reset-password","POST",{token,newPassword}),200);
  const attempt=await pending.request("/api/auth/two-factor/verify-backup-code","POST",{code:enrollment.backupCodes[1],trustDevice:false}); assert.ok(attempt.status>=400);
  await status(await valid.request("/api/v1/me"),401);
  const fresh=new BrowserSession(h.base); const sign=await (await fresh.request("/api/auth/sign-in/email","POST",{email:a.email,password:newPassword})).json(); assert.equal(sign.twoFactorRedirect,true);
  await status(await fresh.request("/api/auth/two-factor/verify-backup-code","POST",{code:enrollment.backupCodes[1],trustDevice:false}),200);
  await status(await fresh.request("/api/auth/two-factor/disable","POST",{password:newPassword}),200);
  assert.equal((await me(fresh)).user.mfa_enabled,false);
});
test("A05 absent, unverified, suspended, expired entitlement, origin/body/unknown-field and bypass denials", async () => {
  const absent=new BrowserSession(h.base); await status(await absent.request("/api/v1/me"),401);
  await status(await absent.request("/api/auth/test-login","POST",{}),404);
  const password=fixturePassword(); await absent.request("/api/auth/sign-up/email","POST",{name:"Unverified",email:"unverified@example.test",password});
  await status(await absent.request("/api/auth/sign-in/email","POST",{email:"unverified@example.test",password}),403);
  const a=await account("denials"); await a.browser.request("/api/v1/onboarding","POST",setup("denials-studio")); const first=await me(a.browser);
  await h.pool.query('UPDATE "user" SET "emailVerified"=false WHERE id=$1',[first.user.id]);
  await status(await a.browser.request("/api/v1/me"),403);
  await h.pool.query('UPDATE "user" SET "emailVerified"=true WHERE id=$1',[first.user.id]);
  await status(await a.browser.request("/api/v1/onboarding","POST",setup("denials-studio"),{Origin:"https://foreign.example.test"}),403);
  await status(await a.browser.request("/api/v1/onboarding","POST",setup("denials-studio"),{Origin:""}),403);
  await status(await a.browser.request("/api/v1/onboarding","POST",{...setup("denials-studio"),name:"x".repeat(17000)}),413);
  await h.pool.query("UPDATE entitlement_grants SET revoked_at=now() WHERE studio_id=$1",[first.studio.id]);
  await status(await a.browser.request("/api/v1/entitlement"),200);
  await status(await a.browser.request("/api/v1/studio","PATCH",{expected_revision:1,name:"Denied"}),403);
  await h.pool.query("UPDATE entitlement_grants SET revoked_at=NULL,starts_at=now()-interval '168 hours',ends_at=now() WHERE studio_id=$1",[first.studio.id]);
  const expired=await (await a.browser.request("/api/v1/entitlement")).json(); assert.equal(expired.data.status,"expired");
  await status(await a.browser.request("/api/v1/studio/settings","PATCH",{expected_revision:1,locale:"en"}),403);
  await h.pool.query("UPDATE studios SET suspended_at=now() WHERE id=$1",[first.studio.id]);
  const suspended=await me(a.browser); assert.equal(suspended.setup_status,"suspended"); assert.equal(suspended.studio,null);
  await status(await a.browser.request("/api/v1/studio/settings"),403);
  await status(await a.browser.request("/api/v1/onboarding","POST",setup("denials-studio")),403);
  await status(await a.browser.request("/api/auth/sign-out","POST",{}),200);
});
test("A05 local authentication throttles are enforced and never treated as production-wide proof", async () => {
  const browser=new BrowserSession(h.base);
  const results=[];
  for(let i=0;i<6;i++) results.push(await browser.request("/api/auth/request-password-reset","POST",{email:"unknown@example.test"}));
  assert.equal(results[0].status,200); assert.equal(results.at(-1)!.status,429);
});
test("A03 uncertain local mail delivery fails visibly and registration retry recovers one account", async () => {
  const browser=new BrowserSession(h.base); const email="mail-retry@example.test"; const password=fixturePassword();
  await h.pool.query("CREATE FUNCTION fail_mail_test() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected'; END $$; CREATE TRIGGER fail_mail BEFORE INSERT ON local_mail FOR EACH ROW EXECUTE FUNCTION fail_mail_test()");
  try { await status(await browser.request("/api/auth/sign-up/email","POST",{name:"Synthetic",email,password}),503); }
  finally { await h.pool.query("DROP TRIGGER fail_mail ON local_mail; DROP FUNCTION fail_mail_test()"); }
  await status(await browser.request("/api/auth/sign-up/email","POST",{name:"Synthetic",email,password}),200);
  assert.equal((await h.pool.query('SELECT count(*)::int AS n FROM "user" WHERE email=$1',[email])).rows[0].n,1);
  const verification=await browser.request(await h.mail(email,"verification")); assert.ok(verification.status<400);
  await status(await browser.request("/api/auth/sign-in/email","POST",{email,password}),200);
});
