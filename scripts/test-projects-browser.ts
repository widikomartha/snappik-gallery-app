import { chromium, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { harness, BrowserSession, fixturePassword } from "../tests/harness";

const h=await harness();await h.migrate();
const browser=await chromium.launch({headless:true});const context=await browser.newContext({viewport:{width:1440,height:1000}});const page=await context.newPage();
page.setDefaultTimeout(15000);const errors:string[]=[];page.on("pageerror",()=>errors.push("Browser runtime error"));
try {
  await mkdir("test-results",{recursive:true});
  const session=new BrowserSession(h.base);const email=`project-browser-${randomUUID()}@example.test`;const password=fixturePassword();
  for(const r of [await session.request("/api/auth/sign-up/email","POST",{name:"Synthetic project owner",email,password})])if(!r.ok)throw Error("Synthetic registration failed");
  await session.request(await h.mail(email,"verification"));await session.request("/api/auth/sign-in/email","POST",{email,password});
  const setup=await session.request("/api/v1/onboarding","POST",{name:"Synthetic project studio",slug:`browser-${randomUUID()}`,locale:"en",timezone:"Asia/Makassar"});if(setup.status!==201)throw Error("Setup failed");
  await context.addCookies([...session.cookies].map(([name,value])=>({name,value,url:h.base,httpOnly:true,sameSite:"Lax" as const})));
  await page.goto(`${h.base}/app/projects`);await expect(page.getByText("No projects match this view.")).toBeVisible();
  await page.getByRole("link",{name:"+ Create project",exact:true}).click();
  await page.getByLabel("Client label",{exact:true}).fill("Synthetic graduation");await page.getByLabel("Drive folder ID or folder link",{exact:true}).fill("https://drive.google.com/drive/folders/synthetic-folder-00001");
  await page.getByLabel("Maximum selection",{exact:true}).fill("25");const deadline=new Date(Date.now()+86400000).toISOString().slice(0,16);
  await page.getByRole("group",{name:"Main selection",exact:true}).getByLabel("Deadline (UTC)",{exact:true}).fill(deadline);
  const keys:string[]=[];let lost=false;
  await page.route("**/api/v1/projects",async route=>{if(route.request().method()!=="POST"){await route.continue();return;}keys.push(route.request().headers()["idempotency-key"]);if(!lost){lost=true;const response=await route.fetch();if(response.status()!==201)throw Error("Create before reply loss failed");await route.abort("failed");}else await route.continue();});
  await page.getByRole("button",{name:"Create project",exact:true}).click();await expect(page.getByText("The create result is uncertain.",{exact:false})).toBeVisible();
  await expect(page.getByLabel("Client label",{exact:true})).toHaveValue("Synthetic graduation");await expect(page.getByLabel("Client label",{exact:true})).toBeDisabled();
  await page.getByRole("button",{name:"Retry",exact:true}).click();await page.waitForURL(/\/app\/projects\/[0-9a-f-]+$/);await page.unroute("**/api/v1/projects");
  if(keys.length!==2||keys[0]!==keys[1])throw Error("Lost reply must reuse original key");
  if((await h.pool.query("SELECT count(*)::int AS n FROM projects")).rows[0].n!==1)throw Error("Lost reply duplicated project");
  const detailUrl=page.url();const id=new URL(detailUrl).pathname.split("/").at(-1)!;
  await expect(page.getByRole("heading",{name:"Synthetic graduation",exact:true})).toBeVisible();await expect(page.getByText("Source status: Preparing",{exact:true})).toBeVisible();
  console.log("Browser: durable create after lost HTTP reply");
  await page.getByRole("link",{name:"Edit project",exact:true}).click();const other=await context.newPage();await other.goto(page.url());await expect(other.getByLabel("Client label",{exact:true})).toHaveValue("Synthetic graduation");
  await page.getByLabel("Client label",{exact:true}).fill("Saved graduation");await page.getByRole("button",{name:"Save changes",exact:true}).click();await expect(page.getByRole("status")).toHaveText("Saved.");
  await other.getByLabel("Client label",{exact:true}).fill("Unsaved other tab");await other.getByRole("button",{name:"Save changes",exact:true}).click();await expect(other.getByRole("main").getByRole("alert")).toContainText("another tab");await expect(other.getByLabel("Client label",{exact:true})).toHaveValue("Unsaved other tab");
  await other.getByRole("button",{name:"Reload saved project",exact:true}).click();await expect(other.getByLabel("Client label",{exact:true})).toHaveValue("Saved graduation");await other.close();
  await page.route(`**/api/v1/projects/${id}`,route=>route.request().method()==="PATCH"?route.fulfill({status:503,contentType:"application/json",body:JSON.stringify({error:{code:"TEMPORARILY_UNAVAILABLE"}})}):route.continue());
  await page.getByLabel("Client label",{exact:true}).fill("Retained local edit");await page.getByRole("button",{name:"Save changes",exact:true}).click();await expect(page.getByRole("main").getByRole("alert")).toContainText("couldn't confirm");await expect(page.getByLabel("Client label",{exact:true})).toHaveValue("Retained local edit");await page.unroute(`**/api/v1/projects/${id}`);
  await page.goto(detailUrl);page.once("dialog",dialog=>dialog.accept());await page.getByRole("button",{name:"Archive",exact:true}).click();await expect(page.getByRole("button",{name:"Restore",exact:true})).toBeVisible();
  page.once("dialog",dialog=>dialog.accept());await page.getByRole("button",{name:"Restore",exact:true}).click();await expect(page.getByRole("button",{name:"Archive",exact:true})).toBeVisible();
  const w=(await h.pool.query("SELECT expires_at FROM project_workflows WHERE project_id=$1 AND kind='main'",[id])).rows[0];if(new Date(w.expires_at).toISOString().slice(0,16)!==deadline)throw Error("Archive/restore changed deadline");
  const old=(await h.pool.query("SELECT public_token FROM projects WHERE id=$1",[id])).rows[0].public_token;page.once("dialog",dialog=>dialog.accept());await page.getByRole("button",{name:"Rotate share link",exact:true}).click();await expect(page.getByRole("status")).toHaveText("Saved.");
  if((await h.pool.query("SELECT public_token FROM projects WHERE id=$1",[id])).rows[0].public_token===old)throw Error("Link was not rotated");
  for(const [status,label] of [["ready","Ready"],["failed","Failed"]]){await h.pool.query("UPDATE projects SET inventory_status=$2 WHERE id=$1",[id,status]);await page.reload();await expect(page.getByText(`Source status: ${label}`,{exact:true})).toBeVisible();}
  await page.goto(`${h.base}/app`);await expect(page.getByRole("heading",{name:"Studio overview",exact:true})).toBeVisible();await expect(page.getByRole("heading",{name:"Deadlines in the next 7 days",exact:true})).toBeVisible();
  console.log("Browser: revision conflict, retained failed edit, archive/restore, rotation, source projections and dashboard");
  for(const width of [360,768,1440]){
    await page.setViewportSize({width,height:1000});await page.goto(`${h.base}/app/projects`);await expect(page.getByRole("heading",{name:"Projects",exact:true})).toBeVisible();
    await page.getByLabel("Search clients",{exact:true}).fill("no matches");await expect(page.getByText("No projects match this view.")).toBeVisible();await page.getByLabel("Search clients",{exact:true}).fill("Saved");await expect(page.getByText("Saved graduation",{exact:true})).toBeVisible();
    if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth))throw Error(`Horizontal overflow at ${width}`);
    await page.screenshot({path:`test-results/projects-${width}.png`,fullPage:true});
    await page.goto(`${h.base}/app/projects/new`);await expect(page.getByRole("heading",{name:"Create project",exact:true})).toBeVisible();
    if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth))throw Error(`Form horizontal overflow at ${width}`);
  }
  await page.getByRole("combobox",{name:"Language",exact:true}).selectOption("id");await expect(page.getByRole("heading",{name:"Buat proyek",exact:true})).toBeVisible();
  await page.keyboard.press("Tab");if(await page.evaluate(()=>document.activeElement?.tagName==="BODY"))throw Error("Keyboard focus failed");
  if(errors.length)throw Error("Browser runtime errors");
  console.log("PASS: EPIC-02 Chromium owner journey, actual PostgreSQL/HTTP lost reply, conflicts, lifecycle, search, ID/EN and 360/768/1440 layouts. Source ready/failed states are explicitly seeded projections, not provider proof.");
}finally{await browser.close();await h.close();}
