import { createDecipheriv, createHash } from "node:crypto";
import { config } from "../config";
import { PublicDrive } from "./public-drive";
import { SourceError, providerId, type SourceScope } from "../modules/inventory/provider";

// Local-only, explicitly approved root. No key or resource key enters a DTO/job.
export function localPublicDrive(scope: SourceScope,pageSize=1000) {
  const cfg=config();
  if(process.env.INVENTORY_ADAPTER!=="google_public"||process.env.GOOGLE_DRIVE_LOCAL_CACHE_APPROVED!=="true")throw new SourceError("PROVIDER_NOT_CONFIGURED");
  if(!providerId(scope.rootId)||scope.rootId!==process.env.GOOGLE_DRIVE_APPROVED_ROOT_ID)throw new SourceError("SOURCE_NOT_APPROVED");
  try{
    function decrypt(value:string){
      const bytes=Buffer.from(value,"base64");if(bytes.length<29)throw Error();
      const decipher=createDecipheriv("aes-256-gcm",createHash("sha256").update(`drive-config:v1:${cfg.mailKey}`).digest(),bytes.subarray(0,12));
      decipher.setAuthTag(bytes.subarray(-16));return Buffer.concat([decipher.update(bytes.subarray(12,-16)),decipher.final()]).toString();
    }
    if(process.env.GOOGLE_DRIVE_API_KEY||process.env.GOOGLE_DRIVE_ROOT_RESOURCE_KEY)throw Error();
    const apiKey=decrypt(process.env.GOOGLE_DRIVE_API_KEY_ENCRYPTED??"");
    const resourceKey=process.env.GOOGLE_DRIVE_ROOT_RESOURCE_KEY_ENCRYPTED;
    return new PublicDrive({apiKey,scope,rootResourceKey:resourceKey?decrypt(resourceKey):undefined,pageSize});
  }catch{throw new SourceError("PROVIDER_NOT_CONFIGURED");}
}
