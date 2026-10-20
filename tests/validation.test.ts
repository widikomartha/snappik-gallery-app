import test from "node:test";
import assert from "node:assert/strict";
import { profile, initialDefaults, defaults, studioPatch, settingsPatch } from "../src/modules/onboarding/validation";
import { config } from "../src/config";
import { randomBytes } from "node:crypto";

test("profile accepts ID/EN and a real IANA zone, rejects injected scope and invalid slugs", () => {
  const value = { name: "Synthetic Studio", slug: "synthetic-studio", locale: "id", timezone: "Asia/Makassar" };
  assert.ok(profile.safeParse(value).success);
  for (const extra of [{ studio_id: "fake" }, { role: "operator" }, { slug: "../evil" }, { timezone: "Invalid/Zone" }, { locale: "xx" }]) assert.equal(profile.safeParse({ ...value, ...extra }).success, false);
});
test("settings enforce revisions, default bounds and allowlists", () => {
  assert.ok(defaults.safeParse(initialDefaults).success);
  for (const quota of [0, 501, 1.5]) assert.equal(defaults.safeParse({ ...initialDefaults, main: { ...initialDefaults.main, quota } }).success, false);
  assert.equal(studioPatch.safeParse({ name: "Hello", expected_revision: 0 }).success, false);
  assert.equal(settingsPatch.safeParse({ expected_revision: 1 }).success, false);
  assert.ok(settingsPatch.safeParse({ expected_revision: 1, locale: "en" }).success);
});
test("local adapter fails closed for remote URL and unknown modes", () => {
  const saved = { ...process.env };
  Object.assign(process.env, { APP_MODE: "local", APP_URL: "http://127.0.0.1:3000", DATABASE_URL: "postgresql://example@127.0.0.1/db", BETTER_AUTH_SECRET: "x".repeat(40), LOCAL_MAIL_KEY: "y".repeat(40) });
  try {
    assert.equal(config().appUrl, "http://127.0.0.1:3000");
    process.env.APP_URL = "https://public.example.test"; assert.throws(config);
    process.env.APP_URL = "http://127.0.0.1:3000"; process.env.APP_MODE = "production"; assert.throws(config);
  } finally { process.env = saved; }
});

test("production configuration requires HTTPS, generated secret, invitation list, verified DB TLS and authenticated SMTP", () => {
  const saved = { ...process.env };
  const value = { APP_MODE: "production", APP_URL: "https://studio.example.test", DATABASE_URL: "postgresql://synthetic@db.example.test/app?sslmode=verify-full", BETTER_AUTH_SECRET: randomBytes(48).toString("hex"), AUTH_OWNER_EMAILS: "owner@example.test", SMTP_HOST: "smtp.example.test", SMTP_PORT: "587", SMTP_TLS: "starttls", SMTP_USER: "synthetic", SMTP_PASSWORD: randomBytes(24).toString("hex"), SMTP_FROM: "sender@example.test" };
  try {
    Object.assign(process.env, value); assert.equal(config().mode, "production"); assert.equal(config().smtp?.secure, false);
    for (const invalid of [{ APP_URL: "http://studio.example.test" }, { APP_URL: "https://user:pass@studio.example.test" }, { APP_URL: "https://studio.example.test/path" }, { APP_URL: "https://studio.example.test?secret=bad" }, { BETTER_AUTH_SECRET: "a".repeat(64) }, { AUTH_OWNER_EMAILS: "" }, { SMTP_TLS: "none" }, { SMTP_FROM: "sender@example.test\r\nBcc: injected@example.test" }, { SMTP_PASSWORD: "" }, { SMTP_PORT: "0" }, { DATABASE_URL: "postgresql://synthetic@db.example.test/app?sslmode=no-verify" }, { DATABASE_URL: "postgresql://synthetic@db.example.test/app?sslmode=require" }]) {
      Object.assign(process.env, value, invalid); assert.throws(config);
    }
  } finally { process.env = saved; }
});
