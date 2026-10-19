import { loadEnvFile } from "node:process";
import { readFile, writeFile } from "node:fs/promises";
import { createCipheriv, createHash, randomBytes } from "node:crypto";
import { config } from "../src/config";
import { providerId } from "../src/modules/inventory/provider";

loadEnvFile(".env.local");
try{
  const cfg=config();const root=process.env.GOOGLE_DRIVE_APPROVED_ROOT_ID;
  if(!root||!providerId(root)||process.env.GOOGLE_DRIVE_LOCAL_CACHE_APPROVED!=="true")throw Error();
  let env=await readFile(".env.local","utf8");
  const values:Record<string,string>={INVENTORY_ADAPTER:"google_public"};
  if(!process.env.GOOGLE_DRIVE_API_KEY&&!process.env.GOOGLE_DRIVE_API_KEY_ENCRYPTED)throw Error();
  for(const name of ["GOOGLE_DRIVE_API_KEY","GOOGLE_DRIVE_ROOT_RESOURCE_KEY"]){
    const value=process.env[name];if(!value)continue;
    const iv=randomBytes(12);const cipher=createCipheriv("aes-256-gcm",createHash("sha256").update(`drive-config:v1:${cfg.mailKey}`).digest(),iv);
    values[`${name}_ENCRYPTED`]=Buffer.concat([iv,cipher.update(value),cipher.final(),cipher.getAuthTag()]).toString("base64");
    env=env.replace(new RegExp(`^${name}=.*(?:\\r?\\n|$)`,"m"),"");
  }
  for(const [name,value]of Object.entries(values)){
    const pattern=new RegExp(`^${name}=.*$`,"m");env=pattern.test(env)?env.replace(pattern,`${name}=${value}`):`${env.trimEnd()}\n${name}=${value}\n`;
  }
  await writeFile(".env.local",env,{mode:0o600});
  console.log("Approved local public-only configuration saved; API key encrypted and plaintext entry removed. Restart web and worker to use it.");
}catch{console.error("DRIVE_CONFIGURATION_INVALID: privately configure the approved root, API key and explicit local cache approval; no values printed.");process.exitCode=1;}
