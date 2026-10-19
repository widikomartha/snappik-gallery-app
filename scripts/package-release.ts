import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { migrationFiles } from "../src/db/migrate";

const exec=promisify(execFile),root=process.cwd();
const {stdout}=await exec("git",["ls-files","--cached","--others","--exclude-standard","-z"],{maxBuffer:8*1024*1024,windowsHide:true});
const names=[...new Set(stdout.split("\0").filter(Boolean))].sort();
const rootFiles=new Set([".env.example",".gitattributes",".gitignore",".node-version",".npmrc","AGENTS.md","README.md","package.json","package-lock.json","tsconfig.json","next.config.ts","next-env.d.ts"]);
// Source/documentation only; no Git objects, local config, backups, media or logs.
if(names.some(name=>!rootFiles.has(name)&&! /^(src|scripts|tests|docs|\.github)\//.test(name)))throw new Error("Unreviewed path in release manifest");
const destination=path.resolve(".local/releases",randomUUID()),source=path.join(destination,"source");
await mkdir(source,{recursive:true});const files=[];
for(const name of names) {
  const input=path.resolve(root,name);
  if(!input.startsWith(root+path.sep)||(await lstat(input)).isSymbolicLink())throw new Error("Unsafe source path");
  if(/(^|\/)\.env(\.|$)/.test(name)&&name!==".env.example")throw new Error("Private configuration cannot be packaged");
  const bytes=await readFile(input),output=path.join(source,name);await mkdir(path.dirname(output),{recursive:true});await writeFile(output,bytes,{flag:"wx"});
  files.push({path:name,bytes:bytes.length,sha256:createHash("sha256").update(bytes).digest("hex")});
}
const head=(await exec("git",["rev-parse","HEAD"],{windowsHide:true})).stdout.trim();
const dirty=!!(await exec("git",["status","--porcelain"],{windowsHide:true})).stdout.trim();
await writeFile(path.join(destination,"manifest.json"),JSON.stringify({created_at:new Date().toISOString(),head,dirty,node:process.version,release_ready:false,migrations:(await migrationFiles()).map(({name,checksum})=>({name,checksum})),files},null,2),{flag:"wx"});
console.log(JSON.stringify({code:"LOCAL_SOURCE_PACKAGE_WRITTEN",directory:path.relative(root,destination).replaceAll("\\","/"),files:files.length,head,dirty,release_ready:false}));
