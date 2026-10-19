import test from "node:test";
import assert from "node:assert/strict";
import { profile, initialDefaults, defaults, studioPatch, settingsPatch } from "../src/modules/onboarding/validation";
import { config } from "../src/config";

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
