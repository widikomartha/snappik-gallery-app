import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { db } from "../src/db/pool";
import { config } from "../src/config";
import { encryptedBackup } from "../src/modules/operations/backup";
config();
try {
  const value=process.env.LOCAL_BACKUP_KEY;
  if(!value||!/^[0-9a-f]{64}$/i.test(value))throw new Error("Configure a separate private LOCAL_BACKUP_KEY (64 hex characters); keep custody outside the backup.");
  const key=Buffer.from(value,"hex");
  try {
    const bytes=await encryptedBackup(db(),key);await mkdir(".local/backups",{recursive:true});
    await writeFile(`.local/backups/${Date.now()}-${randomUUID()}.bin`,bytes,{flag:"wx",mode:0o600});
    console.log(JSON.stringify({code:"LOCAL_BACKUP_WRITTEN",bytes:bytes.length,encrypted:true}));
  }finally{key.fill(0);}
}catch{console.error(JSON.stringify({code:"LOCAL_BACKUP_FAILED"}));process.exitCode=1;}
finally{await db().end();}
