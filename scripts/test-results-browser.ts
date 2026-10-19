import { chromium, expect } from "@playwright/test";
import { harness } from "../tests/harness";
import { galleryFixture, result } from "../tests/gallery-fixture";
import { mkdir } from "node:fs/promises";

const h=await harness({inventoryAdapter:"synthetic"});await h.migrate();const browser=await chromium.launch({headless:true});
const context=await browser.newContext({viewport:{width:1440,height:1000},permissions:["clipboard-read","clipboard-write"]});
const page=await context.newPage();page.setDefaultTimeout(15000);const errors:string[]=[];page.on("pageerror",()=>errors.push("runtime"));page.on("dialog",d=>d.accept());
try {
  const f=await galleryFixture(h),{p,path}=f;
  await page.goto(`${h.base}${p.public_url}/main`);await page.getByRole("button",{name:"Enter gallery",exact:true}).click();
  await expect(page.locator(".photo-card")).toHaveCount(3);
  await page.locator(".photo-card").getByRole("button",{name:"Select",exact:true}).first().click();
  await page.getByRole("button",{name:"Review choices",exact:true}).click();await expect(page.getByRole("button",{name:"Confirm and lock selection",exact:true})).toBeDisabled();
  await page.getByRole("button",{name:"Save draft",exact:true}).click();await expect(page.getByRole("status").filter({hasText:/^Saved$/})).toBeVisible();
  let lost=false;const confirmKeys:string[]=[];
  await page.route(`**${path}/selection/confirm`,async route=>{confirmKeys.push(route.request().headers()["idempotency-key"]);if(!lost){lost=true;const r=await route.fetch();expect(r.status()).toBe(200);await route.abort("failed");}else await route.continue();});
  await page.getByRole("button",{name:"Confirm and lock selection",exact:true}).click();await expect(page.getByText(/Confirmation not acknowledged/)).toBeVisible();await expect(page.getByRole("button",{name:"Save draft",exact:true})).toBeDisabled();
  await page.getByRole("button",{name:"Retry",exact:true}).click();await expect(page.getByRole("region",{name:"Immutable confirmation",exact:true})).toBeVisible();expect(confirmKeys.length).toBe(2);expect(confirmKeys[0]).toBe(confirmKeys[1]);
  await page.reload();await expect(page.getByRole("region",{name:"Immutable confirmation",exact:true})).toBeVisible();
  // Actual owner session remains distinct from gallery grant cookies.
  const ownerContext=await browser.newContext({permissions:["clipboard-read","clipboard-write"]});await ownerContext.addCookies([...f.owner.cookies].map(([name,value])=>({name,value,url:h.base})));
  const owner=await ownerContext.newPage();owner.on("dialog",d=>d.accept());await owner.goto(`${h.base}/app/projects/${p.id}`);
  const results=owner.getByRole("region",{name:"Selection results",exact:true});await expect(results.getByRole("heading",{name:/Immutable confirmation/})).toBeVisible();
  await results.getByRole("button",{name:"Copy exact CSV",exact:true}).click();await expect(results.getByRole("status")).toHaveText("Exact CSV copied.");
  const csv=await owner.evaluate(()=>navigator.clipboard.readText());expect(csv).toContain("provider_file_id");expect(csv).toMatch(/"(?:IMG_001.jpg|IMAGE.JPG)"/);
  const [csvDownload]=await Promise.all([owner.waitForEvent("download"),results.getByRole("link",{name:"Download CSV",exact:true}).click()]);expect(await csvDownload.failure()).toBeNull();
  let lostReopen=false;const reopenKeys:string[]=[];
  await owner.route(`**/projects/${p.id}/selection/reopen`,async route=>{reopenKeys.push(route.request().headers()["idempotency-key"]);if(!lostReopen){lostReopen=true;const r=await route.fetch();expect(r.status()).toBe(200);await route.abort("failed");}else await route.continue();});
  await results.getByLabel("Reason for reopening (10–1000 characters)",{exact:true}).fill("Synthetic client requested revised choices");await results.getByRole("button",{name:"Reopen selection",exact:true}).click();await expect(results.getByText(/Reopen result uncertain/)).toBeVisible();await expect(results.getByLabel("Reason for reopening (10–1000 characters)",{exact:true})).toBeDisabled();
  await results.getByRole("button",{name:"Retry reopen",exact:true}).click();await expect(results.getByRole("status")).toContainText("Selection reopened");expect(reopenKeys.length).toBe(2);expect(reopenKeys[0]).toBe(reopenKeys[1]);
  await page.getByRole("button",{name:"Review server draft",exact:true}).click();await page.getByRole("button",{name:"Use server draft",exact:true}).click();
  await page.getByRole("button",{name:"Review choices",exact:true}).click();await page.getByRole("button",{name:"Confirm and lock selection",exact:true}).click();await expect(page.getByRole("region",{name:"Immutable confirmation",exact:true})).toBeVisible();
  await results.getByRole("button",{name:"Refresh results",exact:true}).click();await expect(results.getByLabel("Result view",{exact:true}).locator("option")).toHaveCount(4);
  const downloadPage=await context.newPage();await downloadPage.goto(`${h.base}${p.public_url}/download`);await downloadPage.getByRole("button",{name:"Enter gallery",exact:true}).click();
  const [download]=await Promise.all([downloadPage.waitForEvent("download"),downloadPage.getByRole("button",{name:"Download original",exact:true}).first().click()]);expect(await download.failure()).toBeNull();expect(download.suggestedFilename()).toMatch(/\.(jpg|JPG)$/);
  await downloadPage.route(`**${path}/download/**`,r=>r.fulfill({status:503,contentType:"application/json",body:JSON.stringify({error:{code:"SOURCE_UNAVAILABLE"}})}));
  await downloadPage.getByRole("button",{name:"Download original",exact:true}).first().click();await expect(downloadPage.locator(".gallery").getByRole("alert")).toContainText("Download failed");
  await page.getByLabel("Language",{exact:true}).selectOption("id");await expect(page.getByRole("region",{name:"Konfirmasi permanen",exact:true})).toBeVisible();
  await mkdir("test-results",{recursive:true});for(const width of [360,768,1440]){await page.setViewportSize({width,height:1000});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:`test-results/results-${width}.png`,fullPage:true});}
  expect(errors).toHaveLength(0);await ownerContext.close();
  console.log("PASS: Chromium actual HTTP/DB confirmation with lost reply/same-key recovery, locked refresh, owner history/copy/CSV/reopen/reconfirm, original attachment/error, ID/EN, 360/768/1440. Generated sources only; no phone/provider/hosted claim.");
}finally{await browser.close();await h.close();}
