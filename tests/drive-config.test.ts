import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir,readFile,writeFile } from "node:fs/promises";
import { createDecipheriv,createHash,randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";

test("local credential CLI encrypts keys, removes plaintext, preserves app secrets and supports explicit key replacement",async()=>{
  const cwd=path.resolve(`.local/drive-config-test-${randomUUID()}`);await mkdir(cwd,{recursive:true});
  const envFile=path.join(cwd,".env.local");const mailKey="synthetic-encryption-secret-000000000001";const authKey="synthetic-auth-secret-00000000000000001";
  const apiKey="synthetic-provider-key-first";const rootKey="synthetic-root-resource-key";
  await writeFile(envFile,`APP_MODE=local\nAPP_URL=http://127.0.0.1:3000\nDATABASE_URL=postgresql://127.0.0.1/synthetic\nBETTER_AUTH_SECRET=${authKey}\nLOCAL_MAIL_KEY=${mailKey}\nGOOGLE_DRIVE_APPROVED_ROOT_ID=synthetic-approved-root\nGOOGLE_DRIVE_LOCAL_CACHE_APPROVED=true\nGOOGLE_DRIVE_API_KEY=${apiKey}\nGOOGLE_DRIVE_ROOT_RESOURCE_KEY=${rootKey}\n`);
  const environment={...Object.fromEntries(["PATH","SystemRoot","TEMP","TMP"].filter(name=>process.env[name]!==undefined).map(name=>[name,process.env[name]!])),NODE_ENV:"test" as const};
  const run=()=>promisify(execFile)(process.execPath,["--import","tsx",path.resolve("scripts/configure-drive-local.ts")],{cwd,env:environment,windowsHide:true,encoding:"utf8"});
  function parse(text:string){return Object.fromEntries(text.trim().split(/\r?\n/).map(line=>{const i=line.indexOf("=");return [line.slice(0,i),line.slice(i+1)];}));}
  function decrypt(value:string){const bytes=Buffer.from(value,"base64");const decipher=createDecipheriv("aes-256-gcm",createHash("sha256").update(`drive-config:v1:${mailKey}`).digest(),bytes.subarray(0,12));decipher.setAuthTag(bytes.subarray(-16));return Buffer.concat([decipher.update(bytes.subarray(12,-16)),decipher.final()]).toString();}
  const output=await run();assert.ok(!output.stdout.includes(apiKey)&&!output.stdout.includes(rootKey));
  let saved=parse(await readFile(envFile,"utf8"));assert.equal(saved.BETTER_AUTH_SECRET,authKey);assert.equal(saved.LOCAL_MAIL_KEY,mailKey);assert.equal(saved.INVENTORY_ADAPTER,"google_public");
  assert.equal(saved.GOOGLE_DRIVE_API_KEY,undefined);assert.equal(saved.GOOGLE_DRIVE_ROOT_RESOURCE_KEY,undefined);
  assert.equal(decrypt(saved.GOOGLE_DRIVE_API_KEY_ENCRYPTED),apiKey);assert.equal(decrypt(saved.GOOGLE_DRIVE_ROOT_RESOURCE_KEY_ENCRYPTED),rootKey);
  const replacement="synthetic-provider-key-replacement";await writeFile(envFile,(await readFile(envFile,"utf8"))+`\nGOOGLE_DRIVE_API_KEY=${replacement}\n`);
  await run();saved=parse(await readFile(envFile,"utf8"));assert.equal(saved.GOOGLE_DRIVE_API_KEY,undefined);assert.equal(decrypt(saved.GOOGLE_DRIVE_API_KEY_ENCRYPTED),replacement);assert.equal(saved.BETTER_AUTH_SECRET,authKey);
  const before=await readFile(envFile,"utf8");await writeFile(envFile,before.replace("GOOGLE_DRIVE_LOCAL_CACHE_APPROVED=true","GOOGLE_DRIVE_LOCAL_CACHE_APPROVED=false"));
  await assert.rejects(run());assert.equal(await readFile(envFile,"utf8"),before.replace("GOOGLE_DRIVE_LOCAL_CACHE_APPROVED=true","GOOGLE_DRIVE_LOCAL_CACHE_APPROVED=false"));
});
