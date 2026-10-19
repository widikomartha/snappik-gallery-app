import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { BrowserSession, fixturePassword, type harness } from "./harness";
import { SyntheticDrive, SYNTHETIC_ROOT } from "../src/adapters/synthetic-drive";
import { runInventoryOnce } from "../src/modules/inventory/worker";

export async function result(r:Response,status=200){assert.equal(r.status,status);return (await r.json()).data;}
export async function code(r:Response,status:number,code:string){assert.equal(r.status,status);assert.equal((await r.json()).error.code,code);}
export async function galleryFixture(h:Awaited<ReturnType<typeof harness>>,passwords=false) {
  await h.pool.query('DELETE FROM "rateLimit"');
  const owner=new BrowserSession(h.base),email=`gallery-${randomUUID()}@example.test`,password=fixturePassword();
  await result(await owner.request("/api/auth/sign-up/email","POST",{name:"Synthetic gallery owner",email,password}));
  await owner.request(await h.mail(email,"verification"));await result(await owner.request("/api/auth/sign-in/email","POST",{email,password}));
  await result(await owner.request("/api/v1/onboarding","POST",{name:"Gallery studio",slug:`g-${randomUUID()}`,locale:"en",timezone:"Asia/Makassar"}),201);
  const main=fixturePassword(),download=fixturePassword();
  const p=await result(await owner.request("/api/v1/projects","POST",{client_label:"Generated gallery",drive_folder_id:SYNTHETIC_ROOT,main:{quota:2,...(passwords?{password:main}:{})},download:{enabled:true,...(passwords?{password:download}:{})}},{"Idempotency-Key":randomUUID()}),201);
  await runInventoryOnce(h.pool,new SyntheticDrive());
  const path=`/api/v1${p.public_url}`;const client=new BrowserSession(h.base);
  return {owner,p,path,client,main,download};
}
