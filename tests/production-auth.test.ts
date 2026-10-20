import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import * as OTPAuth from "otpauth";
import { chromium, expect } from "@playwright/test";
import { BrowserSession, fixturePassword } from "./harness";
import { productionHarness } from "./production-harness";
import { sendSmtp } from "../src/modules/auth/mail";
import { SMTPServer } from "smtp-server";
import { generate } from "selfsigned";
import { freePort } from "./harness";
import { randomUUID } from "node:crypto";

let h: Awaited<ReturnType<typeof productionHarness>>;
before(async () => { h = await productionHarness(); }, { timeout: 60000 });
after(async () => {
  if (!h) return;
  try {
    for (const message of h.messages) assert.equal(h.logs().includes(message.url), false, "Auth mail URL must not enter web logs");
    assert.equal(h.logs().includes(process.env.SMTP_PASSWORD!), false, "SMTP credential must not enter web logs");
  } finally { await h.close(); }
});
beforeEach(async () => { await h.pool.query('DELETE FROM "rateLimit"'); });
async function status(response: Response, expected: number) {
  assert.equal(response.status, expected, `Expected HTTP ${expected}, received ${response.status}`); return response;
}
async function login() {
  const session = new BrowserSession(h.base);
  const response = await status(await session.request("/api/auth/sign-in/email", "POST", { email: h.email, password: h.password }), 200);
  return { session, response };
}
const navigation = { "Sec-Fetch-Site": "cross-site", "Sec-Fetch-Mode": "navigate", "Sec-Fetch-Dest": "document" };

test("production HTTPS cookies, existing identity/studio/trial continuity, cross-origin and callback denials", async () => {
  const { session, response } = await login();
  const cookies = response.headers.getSetCookie(); assert.ok(cookies.length);
  for (const cookie of cookies) { assert.match(cookie, /; Secure/i); assert.match(cookie, /; HttpOnly/i); assert.match(cookie, /; SameSite=Lax/i); assert.doesNotMatch(cookie, /; Domain=/i); }
  const me = (await (await status(await session.request("/api/v1/me"), 200)).json()).data;
  assert.equal(me.user.id, h.original.user.id); assert.deepEqual(me.studio, h.original.studio); assert.deepEqual(me.entitlement.grants, h.original.entitlement.grants);
  await status(await session.request("/api/v1/onboarding", "POST", { name: "Preserved studio", slug: "preserved-studio", locale: "en", timezone: "Asia/Makassar" }), 200);
  await status(await h.rawRequest("/api/auth/get-session", "GET", undefined, navigation), 403);
  await status(await session.request("/api/auth/sign-out", "POST", {}, { Origin: "https://foreign.example.test" }), 403);
  for (const callbackURL of ["https://foreign.example.test/login", "//foreign.example.test/login", `${h.base}/g/anything`, `${h.base}/login?token=stolen`]) {
    await status(await session.request("/api/auth/sign-in/email", "POST", { email: h.email, password: h.password, callbackURL }), 403);
  }
  await status(await h.rawRequest("/api/auth/sign-in/email", "POST", { email: h.email, password: h.password }, { Host: "foreign.example.test" }), 403);
  const outsider = new BrowserSession(h.base), email = "not-invited@example.test";
  await status(await outsider.request("/api/auth/sign-up/email", "POST", { name: "Synthetic", email, password: fixturePassword() }), 200);
  assert.equal((await h.pool.query('SELECT count(*)::int n FROM "user" WHERE email=$1', [email])).rows[0].n, 0);
  assert.equal(h.messages.filter(m => m.to === email).length, 0);
  const project = (await (await status(await session.request("/api/v1/projects", "POST", { client_label: "Synthetic TLS grant", drive_folder_id: "synthetic-folder-00001" }, { "Idempotency-Key": randomUUID() }), 201)).json()).data;
  const grant = await status(await new BrowserSession(h.base).request(`/api/v1${project.public_url}/access`, "POST", { workflow: "main" }), 200);
  assert.match(grant.headers.getSetCookie()[0], /; Secure/i); assert.match(grant.headers.getSetCookie()[0], /; SameSite=Strict/i);
  const allowlist = process.env.AUTH_OWNER_EMAILS!;
  try {
    process.env.AUTH_OWNER_EMAILS = "retry@example.test,browser@example.test"; await h.restart();
    await status(await session.request("/api/v1/me"), 403);
  } finally { process.env.AUTH_OWNER_EMAILS = allowlist; await h.restart(); }
});

test("TLS SMTP failure/retry, invitation and email-navigation callbacks; no production local mailbox", async () => {
  const b = new BrowserSession(h.base), email = "retry@example.test", password = fixturePassword();
  h.rejectDelivery(true);
  try { await status(await b.request("/api/auth/sign-up/email", "POST", { name: "Retry", email, password }), 503); }
  finally { h.rejectDelivery(false); }
  await status(await b.request("/api/auth/sign-up/email", "POST", { name: "Retry", email, password }), 200);
  assert.equal((await h.pool.query('SELECT count(*)::int n FROM "user" WHERE email=$1', [email])).rows[0].n, 1);
  await status(await b.request("/api/auth/sign-in/email", "POST", { email, password }), 403);
  const link = h.mail(email, "verification");
  const bad = new URL(link); bad.searchParams.set("callbackURL", "https://foreign.example.test/login");
  await status(await h.rawRequest(bad.href, "GET", undefined, navigation), 403);
  assert.equal((await h.pool.query('SELECT "emailVerified" FROM "user" WHERE email=$1', [email])).rows[0].emailVerified, false);
  const verified = await status(await h.rawRequest(link, "GET", undefined, navigation), 302);
  assert.equal(verified.headers.get("location"), `${h.base}/login`);
  await status(await b.request("/api/auth/sign-in/email", "POST", { email, password }), 200);
  assert.equal((await h.pool.query('SELECT count(*)::int n FROM local_mail m JOIN "user" u ON u.id=m.user_id WHERE u.email=$1', [email])).rows[0].n, 0);
  assert.ok(h.secureDeliveries() >= 1);
});

test("cross-replica concurrent throttling ignores spoofed IP headers and survives both process restarts", async () => {
  const responses = await Promise.all(Array.from({ length: 12 }, (_, i) => new BrowserSession(h.base).request("/api/auth/request-password-reset", "POST", { email: "unknown@example.test" }, { "X-Forwarded-For": `192.0.2.${i + 1}`, "X-Real-IP": `198.51.100.${i + 1}` })));
  assert.equal(responses.filter(r => r.status === 200).length, 5);
  assert.equal(responses.filter(r => r.status === 429).length, 7);
  await h.restart();
  const blocked = await status(await new BrowserSession(h.base).request("/api/auth/request-password-reset", "POST", { email: "UNKNOWN@example.test" }), 429);
  assert.equal(blocked.headers.get("retry-after"), "60");
  assert.ok((await h.pool.query('SELECT key FROM "rateLimit"')).rows.every(row => !row.key.includes("@")));
  await h.pool.query('DELETE FROM "rateLimit"');
  const global = await Promise.all(Array.from({ length: 65 }, (_, i) => new BrowserSession(h.base).request("/api/auth/request-password-reset", "POST", { email: `not-invited-${i}@example.test` }, { "X-Forwarded-For": `192.0.2.${i + 1}` })));
  assert.equal(global.filter(r => r.status === 200).length, 60); assert.equal(global.filter(r => r.status === 429).length, 5);
});

test("SMTP STARTTLS succeeds; stripped STARTTLS and untrusted certificates fail before delivery", async () => {
  const saved = { ...process.env }, untrusted = await generate([{ name: "commonName", value: "localhost" }], { algorithm: "sha256" });
  try {
    for (const mode of ["starttls", "stripped", "untrusted"] as const) {
      const port = await freePort(); let delivered = 0;
      const server = new SMTPServer({ ...(mode === "untrusted" ? { secure: true, key: untrusted.private, cert: untrusted.cert } : { secure: false, ...h.tls }),
        disabledCommands: mode === "stripped" ? ["STARTTLS"] : [], logger: false, disableReverseLookup: true, closeTimeout: 100, socketTimeout: 1000,
        onAuth(auth, session, done) { done(session.secure ? null : new Error("Denied"), { user: "synthetic" }); },
        onData(stream, session, done) { stream.resume(); stream.on("end", () => { delivered += Number(session.secure); done(); }); },
      });
      server.on("error", () => {}); await new Promise<void>(resolve => server.listen(port, "127.0.0.1", resolve));
      process.env.SMTP_PORT = String(port); process.env.SMTP_TLS = mode === "untrusted" ? "implicit" : "starttls";
      try {
        const send = () => sendSmtp("owner@example.test", "verification", `${h.base}/api/auth/verify-email?token=synthetic`);
        if (mode === "starttls") { await send(); assert.equal(delivered, 1); }
        else { await assert.rejects(send); assert.equal(delivered, 0); }
      } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
    }
  } finally { process.env = saved; }
});

test("production reset races preserve MFA/business data and revoke sessions across replicas and restart", async () => {
  const { session } = await login(), old = session.clone();
  const enrollment = await (await status(await session.request("/api/auth/two-factor/enable", "POST", { password: h.password, method: "totp" }), 200)).json();
  await status(await session.request("/api/auth/two-factor/verify-totp", "POST", { code: OTPAuth.URI.parse(enrollment.totpURI).generate(), trustDevice: false }), 200);
  await status(await old.request("/api/v1/me"), 401);
  const current = session.clone();
  const pending = new BrowserSession(h.base);
  const challenge = await (await status(await pending.request("/api/auth/sign-in/email", "POST", { email: h.email, password: h.password }), 200)).json(); assert.equal(challenge.twoFactorRedirect, true);
  await status(await pending.request("/api/v1/me"), 401);
  const backups = [pending.clone(), pending.clone()];
  const proofs = await Promise.all(backups.map(b => b.request("/api/auth/two-factor/verify-backup-code", "POST", { code: enrollment.backupCodes[0], trustDevice: false })));
  assert.equal(proofs.filter(r => r.status === 200).length, 1);
  await h.pool.query('DELETE FROM "rateLimit"');
  await status(await session.request("/api/auth/request-password-reset", "POST", { email: h.email }), 200);
  const callback = await status(await h.rawRequest(h.mail(h.email, "recovery"), "GET", undefined, navigation), 302);
  const token = new URL(callback.headers.get("location")!).searchParams.get("token")!, newPassword = fixturePassword();
  const results = await Promise.all([0, 1].map(() => session.clone().request("/api/auth/reset-password", "POST", { token, newPassword })));
  assert.deepEqual(results.map(r => r.status).sort(), [200, 400]);
  await h.restart();
  await status(await current.request("/api/v1/me"), 401);
  const fresh = new BrowserSession(h.base);
  assert.equal((await (await status(await fresh.request("/api/auth/sign-in/email", "POST", { email: h.email, password: newPassword }), 200)).json()).twoFactorRedirect, true);
  await status(await fresh.request("/api/auth/two-factor/verify-backup-code", "POST", { code: enrollment.backupCodes[1], trustDevice: false }), 200);
  const data = (await (await status(await fresh.request("/api/v1/me"), 200)).json()).data;
  assert.equal(data.user.mfa_enabled, true); assert.deepEqual(data.studio, h.original.studio); assert.deepEqual(data.entitlement.grants, h.original.entitlement.grants);
  const copied = fresh.clone(); await status(await fresh.request("/api/auth/sign-out", "POST", {}), 200); await status(await copied.request("/api/v1/me"), 401);
  h.password = newPassword;
});

test("production browser login, SMTP verification, setup, reset callback and logout use HTTPS", async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  try {
    const page = await context.newPage(); const password = fixturePassword(), email = "browser@example.test";
    await page.goto(`${h.base}/login`); await page.getByRole("combobox", { name: "Bahasa" }).selectOption("en");
    await expect(page.getByText("Private studio access", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Create an account", exact: true }).click();
    await page.getByLabel("Your name", { exact: true }).fill("Synthetic browser");
    await page.locator("form").first().getByLabel("Email address", { exact: true }).fill(email);
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Create an account", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("check your inbox");
    await page.goto(h.mail(email, "verification")); await page.waitForURL(`${h.base}/login`);
    await page.locator("form").first().getByLabel("Email address", { exact: true }).fill(email);
    await page.getByLabel("Password", { exact: true }).fill(password); await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page.waitForURL("**/onboarding");
    await page.getByLabel("Studio name", { exact: true }).fill("Browser production studio"); await page.getByLabel("Studio address", { exact: true }).fill("browser-production");
    await page.getByRole("button", { name: "Create my studio" }).click(); await page.waitForURL("**/app");
    const cookie = (await context.cookies()).find(c => c.name.includes("session_token")); assert.ok(cookie?.secure && cookie.httpOnly);
    await page.getByRole("button", { name: "Sign out" }).click(); await page.waitForURL("**/login");
    await page.goto(`${h.base}/recover`); await page.getByLabel("Email address", { exact: true }).fill(email); await page.getByRole("button", { name: "Request recovery link" }).click();
    await expect(page.getByRole("status")).toContainText("submitted for email delivery");
    await page.goto(h.mail(email, "recovery")); await expect(page.getByLabel("New password (12–128 characters)", { exact: true })).toBeVisible();
    await expect.poll(() => page.url()).toBe(`${h.base}/recover`);
    const next = fixturePassword(); await page.getByLabel("New password (12–128 characters)", { exact: true }).fill(next); await page.getByRole("button", { name: "Set new password" }).click();
    await expect(page.getByRole("status")).toContainText("Password updated");
    assert.ok(!h.logs().includes(password) && !h.logs().includes(next));
  } finally { await browser.close(); }
});
