import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import type { Pool } from "pg";
import { migrationFiles, ready } from "../../db/migrate";

// A bounded local logical backup, including private PostgreSQL preview objects.
// This does not back up Drive originals, app source, private env or key custody.
const tables = ["user","users","studios","studio_members","studio_settings","account","twoFactor","session","verification","rateLimit","local_mail","worker_heartbeats","platform_roles","operator_mfa_proofs","operator_attempts","operator_events","entitlement_grants","projects","project_workflows","project_photos","selection_sets","selection_items","selection_confirmations","selection_requests","jobs","idempotency_records","gallery_sessions","gallery_access_attempts","inventory_stage","inventory_job_events","audit_events","operator_requests"] as const;
const maxBytes = 128 * 1024 * 1024;
const magic = Buffer.from("SNAPPIK-LOCAL-BACKUP-1\n");
type Snapshot = { migrations:{name:string;checksum:string}[]; tables:Record<string,string[]> };
const manifest = async () => (await migrationFiles()).map(({name,checksum})=>({name,checksum}));
async function checkTables(pool:Pool) {
  const actual=(await pool.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).rows.map(r=>r.tablename);
  const expected=[...tables,"recovery_control","schema_migrations"].sort();
  if(JSON.stringify(actual)!==JSON.stringify(expected))throw new Error("Backup table manifest mismatch");
}
function keyCheck(key:Buffer) { if(key.length!==32)throw new Error("A separate 32-byte backup key is required"); }
export async function encryptedBackup(pool:Pool,key:Buffer) {
  keyCheck(key);await ready(pool);await checkTables(pool);
  const client=await pool.connect();const data:Snapshot={migrations:await manifest(),tables:{}};let size=0;
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    for(const table of tables) {
      data.tables[table]=[];
      await client.query(`DECLARE backup_rows NO SCROLL CURSOR FOR SELECT row_to_json(t)::text AS row FROM "${table}" t`);
      for(;;) {
        const batch=await client.query("FETCH 50 FROM backup_rows");if(!batch.rowCount)break;
        for(const row of batch.rows) {size+=Buffer.byteLength(row.row);if(size>maxBytes)throw new Error("Local backup exceeds 128 MiB");data.tables[table].push(row.row);}
      }
      await client.query("CLOSE backup_rows");
    }
    await client.query("COMMIT");
  } catch(e){await client.query("ROLLBACK");throw e;}finally{client.release();}
  const plain=Buffer.from(JSON.stringify(data));
  if(plain.length>maxBytes)throw new Error("Local backup exceeds 128 MiB");
  const nonce=randomBytes(12),cipher=createCipheriv("aes-256-gcm",key,nonce);cipher.setAAD(magic);
  try { const bytes=Buffer.concat([cipher.update(plain),cipher.final()]);return Buffer.concat([magic,nonce,cipher.getAuthTag(),bytes]); }
  finally {plain.fill(0);}
}
export async function restoreQuarantined(pool:Pool,encrypted:Buffer,key:Buffer) {
  keyCheck(key);if(encrypted.length>maxBytes+magic.length+28||!encrypted.subarray(0,magic.length).equals(magic))throw new Error("Invalid backup format");
  const offset=magic.length,decipher=createDecipheriv("aes-256-gcm",key,encrypted.subarray(offset,offset+12));decipher.setAAD(magic);decipher.setAuthTag(encrypted.subarray(offset+12,offset+28));
  const plain=Buffer.concat([decipher.update(encrypted.subarray(offset+28)),decipher.final()]);
  let data:Snapshot;try{data=JSON.parse(plain.toString("utf8"));}finally{plain.fill(0);}
  if(JSON.stringify(data.migrations)!==JSON.stringify(await manifest())||JSON.stringify(Object.keys(data.tables))!==JSON.stringify(tables))throw new Error("Backup schema mismatch");
  await ready(pool);await checkTables(pool);
  const client=await pool.connect();
  try {
    await client.query("BEGIN");
    // No restore into an occupied database and no delete/truncate/disabled FK.
    for(const table of tables) {
      await client.query(`LOCK TABLE "${table}" IN ACCESS EXCLUSIVE MODE`);
      if((await client.query(`SELECT 1 FROM "${table}" LIMIT 1`)).rowCount)throw new Error("Restore requires an empty isolated database");
    }
    await client.query("UPDATE recovery_control SET quarantined=true WHERE singleton");
    const confirmations:{id:string;studio_id:string;project_id:string;last_confirmation_id:string}[]=[];
    for(const table of tables)for(const text of data.tables[table]) {
      // Access sessions, challenges and roles never survive a restore. Newer denial
      // overlays remain required; quarantine stays closed even after success.
      if(["session","verification","local_mail","operator_mfa_proofs","platform_roles"].includes(table))continue;
      let row=text;
      if(table==="selection_sets") {const value=JSON.parse(row);if(value.last_confirmation_id){confirmations.push(value);row=JSON.stringify({...value,last_confirmation_id:null});}}
      if(table==="projects") {const value=JSON.parse(row);row=JSON.stringify({...value,public_token:randomBytes(24).toString("base64url"),access_version:value.access_version+1});}
      if(table==="gallery_sessions") {const value=JSON.parse(row);row=JSON.stringify({...value,revoked_at:new Date().toISOString()});}
      await client.query(`INSERT INTO "${table}" OVERRIDING SYSTEM VALUE SELECT * FROM json_populate_record(NULL::"${table}",$1::json)`,[row]);
    }
    for(const row of confirmations)await client.query("UPDATE selection_sets SET last_confirmation_id=$4 WHERE studio_id=$1 AND project_id=$2 AND id=$3",[row.studio_id,row.project_id,row.id,row.last_confirmation_id]);
    for(const table of ["operator_events","inventory_job_events"])await client.query(`SELECT setval(pg_get_serial_sequence('${table}','id'),COALESCE((SELECT max(id) FROM ${table}),1),(SELECT count(*)>0 FROM ${table}))`);
    await client.query("COMMIT");
  }catch(e){await client.query("ROLLBACK");throw e;}finally{client.release();}
}
