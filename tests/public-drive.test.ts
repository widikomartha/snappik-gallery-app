import { test } from "node:test";
import assert from "node:assert/strict";
import { PublicDrive } from "../src/adapters/public-drive";
import { FOLDER, traverse, type SourceScope } from "../src/modules/inventory/provider";
import { localPublicDrive } from "../src/adapters/drive-local-config";
import { createCipheriv,createHash,randomBytes } from "node:crypto";

const scope:SourceScope={studioId:"synthetic-studio",projectId:"synthetic-project",rootId:"synthetic-public-root"};
const root={id:scope.rootId,name:"Synthetic root",mimeType:FOLDER,version:"1",resourceKey:"synthetic-root-key"};
const child={id:"synthetic-public-child",name:"Child",mimeType:FOLDER,version:"1",parents:[root.id],resourceKey:"synthetic-child-key"};
const file={id:"synthetic-public-photo",name:"IMG_001.JPG",mimeType:"image/jpeg",size:"3",version:"opaque-v1",parents:[child.id],resourceKey:"synthetic-photo-key"};
const signal=()=>new AbortController().signal;
function setup(change?:(url:URL)=>Response|null) {
  const calls:{url:URL;headers:Headers}[]=[];
  const transport:typeof fetch=async(input,init)=>{
    const url=new URL(String(input));const headers=new Headers(init?.headers);calls.push({url,headers});
    assert.equal(url.origin,"https://www.googleapis.com");assert.equal(init?.redirect,"error");assert.equal(init?.cache,"no-store");assert.equal(headers.get("x-goog-api-key"),"synthetic-api-key");assert.equal(headers.has("authorization"),false);assert.equal(url.searchParams.has("key"),false);
    const changed=change?.(url);if(changed)return changed;
    if(url.searchParams.get("alt")==="media")return new Response(Buffer.from([1,2,3]),{headers:{"Content-Type":"image/jpeg","Content-Length":"3"}});
    if(url.pathname.endsWith("/files")){
      if(url.searchParams.get("q")===`'${root.id}' in parents`)return Response.json({files:url.searchParams.has("pageToken")?[{...file,id:"synthetic-root-photo",parents:[root.id]}]:[child],...(!url.searchParams.has("pageToken")?{nextPageToken:"synthetic-page"}:{})});
      return Response.json({files:[file]});
    }
    return Response.json(url.pathname.endsWith(root.id)?root:url.pathname.endsWith(child.id)?child:url.pathname.endsWith("synthetic-root-photo")?{...file,id:"synthetic-root-photo",parents:[root.id]}:file);
  };
  const adapter=new PublicDrive({apiKey:"synthetic-api-key",scope,rootResourceKey:"synthetic-root-key",transport});
  return {adapter,calls};
}
test("public-only protocol: fixed endpoints, scoped root/parents, pagination, resource headers and bounded original read",async()=>{
  const {adapter,calls}=setup();const found:string[]=[];
  const summary=await traverse(adapter,scope,true,signal(),async(f,path)=>{found.push(path);const chunks=[];for await(const chunk of adapter.read(scope,f,signal()))chunks.push(chunk);assert.equal(Buffer.concat(chunks).length,3);});
  assert.equal(summary.photos,2);assert.deepEqual(found,["","Child"]);
  assert.ok(calls.some(c=>c.url.searchParams.get("pageToken")==="synthetic-page"));
  assert.ok(calls.some(c=>c.headers.get("x-goog-drive-resource-keys")===`${file.id}/synthetic-photo-key`));
  assert.ok(calls.some(c=>c.headers.get("x-goog-drive-resource-keys")===`${root.id}/synthetic-root-key`));
  await assert.rejects(adapter.list({...scope,studioId:"foreign"},root.id,null,signal()),{code:"SOURCE_PERMISSION_LOST"});
  await assert.rejects(adapter.list(scope,"off-root-folder-01",null,signal()),{code:"SOURCE_PERMISSION_LOST"});
});
test("public-only protocol: incomplete listing, permission loss, redirects, rate hints, invalid metadata and source changes fail safely",async()=>{
  const incomplete=setup(url=>url.pathname.endsWith("/files")?Response.json({files:[],incompleteSearch:true}):null);
  await assert.rejects(traverse(incomplete.adapter,scope,true,signal(),async()=>{}),{code:"INCOMPLETE_PROVIDER_SEARCH"});
  const revoked=setup(()=>new Response(null,{status:404}));await assert.rejects(revoked.adapter.folder(scope,root.id,signal()),{code:"SOURCE_PERMISSION_LOST"});
  const limited=setup(()=>Response.json({error:{errors:[{reason:"userRateLimitExceeded"}]}},{status:403,headers:{"Retry-After":"120"}}));
  await assert.rejects(limited.adapter.folder(scope,root.id,signal()),(error:unknown)=>{assert.equal((error as {code:string}).code,"SOURCE_RATE_LIMITED");assert.equal((error as {retryAfterSeconds:number}).retryAfterSeconds,120);return true;});
  const redirect=setup(()=>new Response(null,{status:302,headers:{Location:"http://127.0.0.1/private"}}));await assert.rejects(redirect.adapter.folder(scope,root.id,signal()),{code:"SOURCE_UNAVAILABLE"});
  const invalid=setup(url=>url.pathname.endsWith("/files")?Response.json({files:[{...file,parents:["off-root-parent-001"]}]}):null);await assert.rejects(traverse(invalid.adapter,scope,true,signal(),async()=>{}),{code:"INVALID_PROVIDER_METADATA"});
  const changed=setup(url=>(url.pathname.endsWith(file.id)||url.pathname.endsWith("synthetic-root-photo"))&&url.searchParams.get("alt")!=="media"?Response.json({...file,id:url.pathname.split("/").at(-1),parents:[url.pathname.endsWith(file.id)?child.id:root.id],version:"new-opaque-version"}):null);
  await assert.rejects(traverse(changed.adapter,scope,true,signal(),async(f)=>{for await(const _chunk of changed.adapter.read(scope,f,signal())){/* consume */}}),{code:"SOURCE_VERSION_CHANGED"});
  const oversized=setup(url=>url.searchParams.get("alt")==="media"?new Response(Buffer.alloc(4),{headers:{"Content-Type":"image/jpeg"}}):null);
  await assert.rejects(traverse(oversized.adapter,scope,true,signal(),async(f)=>{for await(const _chunk of oversized.adapter.read(scope,f,signal())){/* consume */}}),{code:"SOURCE_SIZE_CHANGED"});
});

test("cached public previews recheck live root, version and current ancestry without fetching original bytes",async()=>{
  const {adapter,calls}=setup();const expected={id:file.id,version:file.version,mime:file.mimeType,size:3,ancestry:[root.id,child.id]};
  await adapter.assertPreviewVisible(scope,expected,signal());assert.ok(calls.some(c=>c.url.pathname.endsWith(root.id)));assert.ok(calls.some(c=>c.url.searchParams.get("q")===`'${child.id}' in parents`));
  assert.ok(calls.every(c=>!c.url.searchParams.has("alt")));
  const revoked=setup(url=>url.pathname.endsWith(root.id)?new Response(null,{status:404}):null);
  await assert.rejects(revoked.adapter.assertPreviewVisible(scope,expected,signal()),{code:"SOURCE_PERMISSION_LOST"});
  const changed=setup();await assert.rejects(changed.adapter.assertPreviewVisible(scope,{...expected,version:"different"},signal()),{code:"SOURCE_VERSION_CHANGED"});
  const moved=setup(url=>url.pathname.endsWith("/files")&&url.searchParams.get("q")===`'${root.id}' in parents`?Response.json({files:[]}):null);
  await assert.rejects(moved.adapter.assertPreviewVisible(scope,expected,signal()),{code:"SOURCE_PERMISSION_LOST"});
});

test("public metadata may omit parents only when stable-ID membership proves every current ancestry edge",async()=>{
  const {adapter}=setup(url=>url.pathname.endsWith(file.id)&&!url.searchParams.has("alt")?Response.json({...file,parents:undefined}):null);
  await adapter.assertPreviewVisible(scope,{id:file.id,version:file.version,mime:file.mimeType,size:3,ancestry:[root.id,child.id]},signal());
  await assert.rejects(adapter.assertPreviewVisible(scope,{id:file.id,version:file.version,mime:file.mimeType,size:3,ancestry:[root.id]},signal()),{code:"SOURCE_PERMISSION_LOST"});
});

test("local public configuration requires cache approval, approved root and authenticated encryption",()=>{
  const names=["APP_MODE","APP_URL","DATABASE_URL","BETTER_AUTH_SECRET","LOCAL_MAIL_KEY","INVENTORY_ADAPTER","GOOGLE_DRIVE_LOCAL_CACHE_APPROVED","GOOGLE_DRIVE_APPROVED_ROOT_ID","GOOGLE_DRIVE_API_KEY_ENCRYPTED","GOOGLE_DRIVE_API_KEY","GOOGLE_DRIVE_ROOT_RESOURCE_KEY"];
  const saved=Object.fromEntries(names.map(name=>[name,process.env[name]]));const mailKey="synthetic-local-encryption-key-00000000001";
  const iv=randomBytes(12);const cipher=createCipheriv("aes-256-gcm",createHash("sha256").update(`drive-config:v1:${mailKey}`).digest(),iv);
  const encrypted=Buffer.concat([iv,cipher.update("synthetic-api-key"),cipher.final(),cipher.getAuthTag()]).toString("base64");
  try{
    delete process.env.GOOGLE_DRIVE_API_KEY;delete process.env.GOOGLE_DRIVE_ROOT_RESOURCE_KEY;
    Object.assign(process.env,{APP_MODE:"local",APP_URL:"http://127.0.0.1:3000",DATABASE_URL:"postgresql://127.0.0.1/local",BETTER_AUTH_SECRET:"synthetic-auth-secret-00000000000000001",LOCAL_MAIL_KEY:mailKey,INVENTORY_ADAPTER:"google_public",GOOGLE_DRIVE_LOCAL_CACHE_APPROVED:"true",GOOGLE_DRIVE_APPROVED_ROOT_ID:scope.rootId,GOOGLE_DRIVE_API_KEY_ENCRYPTED:encrypted});
    assert.equal(localPublicDrive(scope).origin,"google_public");
    process.env.GOOGLE_DRIVE_API_KEY="synthetic-unsealed-key";assert.throws(()=>localPublicDrive(scope),{code:"PROVIDER_NOT_CONFIGURED"});delete process.env.GOOGLE_DRIVE_API_KEY;
    assert.throws(()=>localPublicDrive({...scope,rootId:"synthetic-unapproved-root"}),{code:"SOURCE_NOT_APPROVED"});
    process.env.GOOGLE_DRIVE_LOCAL_CACHE_APPROVED="false";assert.throws(()=>localPublicDrive(scope),{code:"PROVIDER_NOT_CONFIGURED"});
    process.env.GOOGLE_DRIVE_LOCAL_CACHE_APPROVED="true";process.env.LOCAL_MAIL_KEY="different-synthetic-key-00000000000001";assert.throws(()=>localPublicDrive(scope),{code:"PROVIDER_NOT_CONFIGURED"});
  }finally{for(const name of names){if(saved[name]===undefined)delete process.env[name];else process.env[name]=saved[name];}}
});
