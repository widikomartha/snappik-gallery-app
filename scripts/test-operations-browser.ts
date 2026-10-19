import { chromium, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import * as OTPAuth from "otpauth";
import { mkdir } from "node:fs/promises";
import { harness, BrowserSession, fixturePassword } from "../tests/harness";
import { galleryFixture, result } from "../tests/gallery-fixture";

const h=await harness({inventoryAdapter:"synthetic"});await h.migrate();const browser=await chromium.launch({headless:true});
try {
  const f=await galleryFixture(h),studio=(await result(await f.owner.request("/api/v1/me"))).studio.id;
  const b=new BrowserSession(h.base),email=`operator-${randomUUID()}@example.test`,password=fixturePassword();
  await b.request("/api/auth/sign-up/email","POST",{name:"Synthetic operator",email,password});await b.request(await h.mail(email,"verification"));await b.request("/api/auth/sign-in/email","POST",{email,password});
  const user=(await (await b.request("/api/auth/get-session")).json()).user.id;
  for(const p of ["diagnostics_read","entitlement_write","studio_suspend"])await h.pool.query("INSERT INTO platform_roles(user_id,permission) VALUES($1,$2)",[user,p]);
  const enrollment=await (await b.request("/api/auth/two-factor/enable","POST",{password,method:"totp"})).json(),totp=OTPAuth.URI.parse(enrollment.totpURI);
  await b.request("/api/auth/two-factor/verify-totp","POST",{code:totp.generate(),trustDevice:false});
  await h.pool.query("DELETE FROM operator_mfa_proofs");
  const context=await browser.newContext({viewport:{width:1440,height:1000}});await context.addCookies([...b.cookies].map(([name,value])=>({name,value,url:h.base})));
  const page=await context.newPage();page.on("dialog",d=>d.accept());const errors:string[]=[];page.on("pageerror",()=>errors.push("runtime"));
  await page.goto(`${h.base}/ops`);await page.getByLabel("Studio support reference",{exact:true}).fill(studio);await page.getByRole("button",{name:"Read diagnostics",exact:true}).click();
  await expect(page.locator(".ops-shell").getByRole("alert")).toContainText("Access denied");
  await page.getByLabel("Authenticator code",{exact:true}).fill(totp.generate());await page.getByRole("button",{name:"Verify fresh MFA",exact:true}).click();await expect(page.getByRole("status")).toContainText("five minutes");
  await page.getByRole("button",{name:"Read diagnostics",exact:true}).click();await expect(page.getByRole("region",{name:"Diagnostics",exact:true})).toContainText(studio);
  expect(await page.getByRole("region",{name:"Diagnostics",exact:true}).textContent()).not.toContain("client_label");
  let lost=false;const keys:string[]=[];
  await page.route(`**/ops/studios/${studio}/suspend`,async route=>{keys.push(route.request().headers()["idempotency-key"]);if(!lost){lost=true;const r=await route.fetch();expect(r.status()).toBe(200);await route.abort("failed");}else await route.continue();});
  await page.getByLabel("Reason (10–1000 characters)",{exact:true}).fill("Synthetic pilot support request");await page.getByRole("button",{name:"Suspend studio",exact:true}).click();
  await expect(page.locator(".ops-shell").getByRole("alert")).toContainText("Operation not acknowledged");await expect(page.getByRole("button",{name:"Suspend studio",exact:true})).toBeDisabled();
  await page.getByRole("button",{name:"Retry pending operation",exact:true}).click();await expect(page.getByRole("status")).toContainText("Operation acknowledged");expect(keys.length).toBe(2);expect(keys[0]).toBe(keys[1]);
  expect((await h.pool.query("SELECT count(*)::int n FROM operator_events WHERE studio_id=$1 AND operation='suspend'",[studio])).rows[0].n).toBe(1);
  await page.getByRole("button",{name:"Read diagnostics",exact:true}).click();await page.getByLabel("Reason (10–1000 characters)",{exact:true}).fill("Synthetic pilot resumption request");await page.getByRole("button",{name:"Reactivate studio",exact:true}).click();await expect(page.getByRole("status")).toContainText("Operation acknowledged");
  await page.getByRole("button",{name:"Refresh audit",exact:true}).click();await expect(page.getByRole("region",{name:"Redacted operator audit",exact:true})).toContainText("reactivate");
  await page.getByRole("button",{name:"Read metrics",exact:true}).click();await expect(page.getByRole("region",{name:"Operational metrics",exact:true})).toContainText('"purge_enabled": false');
  await page.getByLabel("Language",{exact:true}).selectOption("id");await expect(page.getByRole("heading",{name:"Operasional platform",exact:true})).toBeVisible();
  await mkdir("test-results",{recursive:true});for(const width of [360,768,1440]){await page.setViewportSize({width,height:1000});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:`test-results/operations-${width}.png`,fullPage:true});}
  await page.getByLabel("Bahasa",{exact:true}).focus();await page.keyboard.press("Tab");expect(await page.evaluate(()=>document.activeElement?.tagName)).toBe("INPUT");
  expect(errors).toHaveLength(0);
  console.log("PASS: operator Chromium permission/MFA, diagnostics, lost-reply/same-key suspend, reactivation, audit/metrics, ID/EN, keyboard and 360/768/1440. No real-device or staging claim.");
}finally{await browser.close();await h.close();}
