import { chromium, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { harness } from "../tests/harness";
import { galleryFixture, result } from "../tests/gallery-fixture";

const h=await harness();await h.migrate();const browser=await chromium.launch({headless:true});
const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage();page.setDefaultTimeout(15000);
const runtimeErrors:string[]=[];page.on("pageerror",()=>runtimeErrors.push("Browser runtime error"));
try {
  const f=await galleryFixture(h,true),{client:c,path}=f;
  await page.goto(`${h.base}${f.p.public_url}`);await expect(page.getByRole("link",{name:/Choose photos/})).toBeVisible();await expect(page.getByRole("img")).toHaveCount(0);
  await page.getByRole("link",{name:/Choose photos/}).click();await page.getByLabel("Gallery password").fill(f.main);await page.getByRole("button",{name:"Enter gallery",exact:true}).click();
  await expect(page.getByText("One shared draft: everyone with main access edits the same selection.",{exact:true})).toBeVisible();await expect(page.getByRole("img")).toHaveCount(3);
  await expect.poll(()=>page.getByRole("img").evaluateAll(imgs=>imgs.every(img=>(img as HTMLImageElement).naturalWidth>0))).toBe(true);
  const cards=page.locator(".photo-card");await expect(cards.locator("strong").filter({hasText:"IMG_001.jpg"})).toHaveCount(2);
  await page.getByLabel("Folder",{exact:true}).selectOption("Portraits");await expect(cards).toHaveCount(2);await page.getByLabel("Folder",{exact:true}).selectOption("*");await expect(cards).toHaveCount(3);
  const opener=cards.first().getByRole("button",{name:/Enlarge/});await opener.focus();await page.keyboard.press("Enter");const dialog=page.getByRole("dialog");await expect(dialog).toBeVisible();
  await expect(cards.getByRole("button",{name:"Select",exact:true}).first()).not.toHaveAttribute("aria-pressed","true");
  await page.keyboard.press("ArrowRight");await page.getByRole("dialog").getByRole("button",{name:"Select",exact:true}).click();
  await page.getByLabel("Photo note (maximum 500 characters)",{exact:true}).fill("😀".repeat(500));await page.keyboard.press("Escape");await expect(page.getByRole("dialog")).toHaveCount(0);await expect(opener).toBeFocused();
  await page.getByRole("button",{name:"Save draft",exact:true}).click();await expect(page.getByRole("status").filter({hasText:/^Saved$/})).toBeVisible();
  await page.reload();await expect(page.locator(".is-selected")).toHaveCount(1);await expect(page.getByRole("status").filter({hasText:/^Saved$/})).toBeVisible();
  // Actual second tab saves a different full draft through the same client cookie.
  const second=await context.newPage();await second.goto(page.url());await expect(second.getByRole("status").filter({hasText:/^Saved$/})).toBeVisible();
  await second.locator(".photo-card").getByRole("button",{name:"Select",exact:true}).first().click();await second.getByRole("button",{name:"Save draft",exact:true}).click();await expect(second.getByRole("status").filter({hasText:/^Saved$/})).toBeVisible();
  await page.locator(".is-selected").getByRole("button",{name:/Remove/}).click();await page.getByRole("button",{name:"Save draft",exact:true}).click();await expect(page.getByRole("status").filter({hasText:/Another client/})).toBeVisible();await expect(page.getByRole("region",{name:"Current server draft"})).toBeVisible();
  await expect(page.getByRole("button",{name:"Save draft",exact:true})).toBeDisabled();await page.getByRole("button",{name:"Reapply my choices to this revision",exact:true}).click();await expect(page.getByRole("status").filter({hasText:/^Unsaved$/})).toBeVisible();
  await page.getByRole("button",{name:"Save draft",exact:true}).click();await expect(page.getByRole("status").filter({hasText:/^Saved$/})).toBeVisible();await second.close();
  // Commit succeeds, transport response is lost: UI must retain unsaved intent.
  let lost=false;await page.route(`**${path}/selection`,async route=>{if(route.request().method()==="PUT"&&!lost){lost=true;const r=await route.fetch();if(r.status()!==200)throw Error("Expected committed save");await route.abort("failed");}else await route.continue();});
  await page.locator(".photo-card").getByRole("button",{name:"Select",exact:true}).first().click();await page.getByRole("button",{name:"Save draft",exact:true}).click();await expect(page.getByRole("status").filter({hasText:/Save not acknowledged/})).toBeVisible();
  await page.getByRole("button",{name:"Review choices",exact:true}).click();await expect(page.getByText("Save all changes before confirmation.",{exact:true})).toBeVisible();await expect(page.getByRole("button",{name:/Confirm/})).toHaveCount(0);
  await page.getByRole("button",{name:"Review server draft",exact:true}).click();await page.getByRole("button",{name:"Use server draft",exact:true}).click();await expect(page.getByRole("status").filter({hasText:/^Saved$/})).toBeVisible();
  await page.getByRole("button",{name:"Back to photos",exact:true}).click();await page.unroute(`**${path}/selection`);
  await page.route(`**${path}/media/**`,route=>route.fulfill({status:503,contentType:"application/json",body:JSON.stringify({error:{code:"SOURCE_UNAVAILABLE"}})}));
  await page.getByRole("button",{name:"Refresh gallery",exact:true}).click();await expect(page.getByText("Preview unavailable. Retry from the gallery.",{exact:true}).first()).toBeVisible();
  await page.unroute(`**${path}/media/**`);await page.getByRole("button",{name:"Refresh gallery",exact:true}).click();await expect(page.getByRole("img")).toHaveCount(3);
  await mkdir("test-results",{recursive:true});
  for(const width of [360,768,1440]){await page.setViewportSize({width,height:1000});if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth))throw Error(`Gallery overflow at ${width}`);await page.screenshot({path:`test-results/gallery-${width}.png`,fullPage:true});}
  await page.getByLabel("Theme",{exact:true}).selectOption("dark");await page.screenshot({path:"test-results/gallery-dark.png",fullPage:true});
  await page.getByLabel("Language",{exact:true}).selectOption("id");await expect(page.getByRole("heading",{name:"Galeri foto Anda",exact:true})).toBeVisible();await page.getByRole("button",{name:"Tinjau pilihan",exact:true}).click();await expect(page.getByText("Konfirmasi hadir di EPIC-05. Pilihan belum dikunci.",{exact:true})).toBeVisible();
  await page.reload();await expect(page.getByRole("heading",{name:"Galeri foto Anda",exact:true})).toBeVisible();await expect(page.locator(".gallery-dark")).toHaveCount(1);
  await page.getByRole("button",{name:"Tinjau pilihan",exact:true}).click();await page.getByLabel("Catatan foto (maksimum 500 karakter)",{exact:true}).first().fill("x".repeat(501));await page.getByRole("button",{name:"Simpan draf",exact:true}).click();await expect(page.locator(".gallery").getByRole("alert")).toContainText("Periksa kuota maksimum");await expect(page.getByRole("status").filter({hasText:/Penyimpanan belum diakui/})).toBeVisible();
  // Grant revocation is observed on the next actual request, with no owner bypass.
  await result(await c.request(`${path}/access`,"POST",{workflow:"download",password:f.download}));await result(await c.request(`${path}/photos?workflow=download`));
  await h.pool.query("UPDATE projects SET archived_at=clock_timestamp() WHERE id=$1",[f.p.id]);await page.reload();await expect(page.locator(".gallery").getByRole("alert")).toContainText("Galeri tidak tersedia");await expect(page.getByRole("img")).toHaveCount(0);
  if(runtimeErrors.length)throw Error("Browser runtime error");
  console.log("PASS: actual gallery/grant/media/draft HTTP+PostgreSQL in Chromium, duplicate filenames, folder filters, viewer keyboard, 500/501 Unicode, refresh, two-tab conflict, deliberate recovery, lost reply, ID/EN, themes, 360/768/1440 and archive denial. Real phone not tested.");
} finally {await browser.close();await h.close();}
