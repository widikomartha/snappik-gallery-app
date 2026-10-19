import { randomUUID } from "node:crypto";
import { mkdir,writeFile } from "node:fs/promises";
import sharp from "sharp";
import { harness,BrowserSession,fixturePassword } from "../tests/harness";
import { localPublicDrive } from "../src/adapters/drive-local-config";
import { claim,processLease } from "../src/modules/inventory/worker";
import { SourceError } from "../src/modules/inventory/provider";

// Explicit opt-in CLI; never part of CI. No source IDs/names/paths/bytes or keys
// enter stdout, screenshots, fixtures or the aggregate report.
const rootId=process.env.GOOGLE_DRIVE_APPROVED_ROOT_ID;const mailKey=process.env.LOCAL_MAIL_KEY;
let h:Awaited<ReturnType<typeof harness>>|undefined;let progress:ReturnType<typeof setInterval>|undefined;
let failed=false;
function ensure(value:unknown){if(!value)throw new Error("LIVE_VERIFICATION_FAILED");}
async function data(response:Response,status=200){ensure(response.status===status);return (await response.json()).data;}
try{
  ensure(rootId&&mailKey&&process.env.GOOGLE_DRIVE_LOCAL_CACHE_APPROVED==="true");
  h=await harness({mailKey,inventoryAdapter:"google_public"});await h.migrate();
  const instance=h;
  async function owner(){
    await instance.pool.query('DELETE FROM "rateLimit"');
    const b=new BrowserSession(instance.base);const email=`live-fixture-${randomUUID()}@example.test`;const password=fixturePassword();
    ensure((await b.request("/api/auth/sign-up/email","POST",{name:"Synthetic verification owner",email,password})).ok);
    await b.request(await instance.mail(email,"verification"));ensure((await b.request("/api/auth/sign-in/email","POST",{email,password})).ok);
    await data(await b.request("/api/v1/onboarding","POST",{name:"Local verification studio",slug:`v-${randomUUID()}`,locale:"en",timezone:"Asia/Makassar"}),201);return b;
  }
  const b=await owner();
  const p=await data(await b.request("/api/v1/projects","POST",{client_label:"Approved public source verification",drive_folder_id:rootId},{"Idempotency-Key":randomUUID()}),201);
  let job=await claim(h.pool,randomUUID());ensure(job&&job.project_id===p.id);if(!job)throw Error();
  let provider=localPublicDrive({studioId:job.studio_id,projectId:job.project_id,rootId:job.drive_folder_id});
  const jobId=job.id;
  const started=Date.now();
  progress=setInterval(()=>{void instance.pool.query("SELECT count(*)::int AS staged FROM inventory_stage WHERE job_id=$1",[jobId]).then(r=>console.log(JSON.stringify({code:"LIVE_SCAN_PROGRESS",staged:r.rows[0].staged}))).catch(()=>{});},20000);
  let published=false;let outcome;
  for(;;){
    published=await processLease(h.pool,job,provider);outcome=await data(await b.request(`/api/v1/jobs/${job.id}`));
    if(published||outcome.status!=="pending")break;
    console.log(JSON.stringify({code:"LIVE_SCAN_RETRY",attempt:outcome.attempt_count,failure_code:outcome.failure_code}));
    const delay=Math.min(60000,Math.max(0,new Date(outcome.available_at).getTime()-Date.now())+100);await new Promise(resolve=>setTimeout(resolve,delay));
    job=await claim(h.pool,randomUUID());if(!job)throw Error();provider=localPublicDrive({studioId:job.studio_id,projectId:job.project_id,rootId:job.drive_folder_id});
  }
  clearInterval(progress);progress=undefined;
  if(!published)throw new SourceError(outcome.failure_code??"LIVE_SCAN_FAILED");
  const listing=await data(await b.request(`/api/v1/projects/${p.id}/photos?limit=100`));
  const ready=listing.items.filter((item:{preview_url:string|null})=>!!item.preview_url);ensure(ready.length>0);
  const first=ready[0];const response=await b.request(first.preview_url);ensure(response.status===200&&response.headers.get("cache-control")?.includes("no-store"));
  const image=await sharp(Buffer.from(await response.arrayBuffer())).metadata();ensure(image.format==="jpeg"&&!image.exif&&image.width!<=1024&&image.height!<=1024);
  ensure((await new BrowserSession(h.base).request(first.preview_url)).status===401);
  const other=await owner();ensure((await other.request(first.preview_url)).status===404);
  const archived=await data(await b.request(`/api/v1/projects/${p.id}/archive`,"POST",{expected_revision:p.revision}));ensure((await b.request(first.preview_url)).status===404);
  await data(await b.request(`/api/v1/projects/${p.id}/restore`,"POST",{expected_revision:archived.revision}));ensure((await b.request(first.preview_url)).status===200);
  await h.pool.query("UPDATE project_photos SET preview_expires_at=clock_timestamp() WHERE project_id=$1 AND id=$2",[p.id,first.id]);ensure((await b.request(first.preview_url)).status===503);
  const retained=(await h.pool.query("SELECT inventory_generation FROM projects WHERE id=$1",[p.id])).rows[0].inventory_generation;ensure(retained===1);
  const report={code:"LIVE_VERIFICATION_COMPLETE",verified_at:new Date().toISOString(),summary:outcome.summary,ready_previews:ready.length,
    scan_duration_ms:Date.now()-started,provider:provider.diagnostics(),checks:{protected_http_preview:true,anonymous_denied:true,cross_tenant_denied:true,archive_restore:true,cache_expiry_denied:true,complete_generation_retained:true},
    pending:["live_resource_key_required_fixture","live_permission_revocation_and_limited_child_visibility","key_restriction_and_rotation_ownership","D03_hosted_media"]};
  await mkdir(".local",{recursive:true});await writeFile(".local/drive-verification.json",JSON.stringify(report,null,2)+"\n",{mode:0o600});console.log(JSON.stringify(report));
}catch(error){console.error(JSON.stringify({code:error instanceof SourceError?error.code:"LIVE_VERIFICATION_FAILED"}));failed=true;}
finally{if(progress)clearInterval(progress);if(h)await h.close();if(failed)process.exitCode=1;}
