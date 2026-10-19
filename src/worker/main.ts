import { randomUUID } from "node:crypto";
import { db } from "../db/pool";
import { ready } from "../db/migrate";
import { configuredInventoryProvider } from "../adapters/synthetic-drive";
import { runInventoryOnce } from "../modules/inventory/worker";
import { config } from "../config";

const id = randomUUID();
let stopped = false;
const stop = new AbortController();
config(); const provider = configuredInventoryProvider();
for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => { stopped = true;stop.abort(); });
console.log(JSON.stringify({code:"WORKER_STARTING",inventory_adapter:provider?.origin??"disabled"}));
while (!stopped) {
  try {
    await ready(db());
    await db().query("INSERT INTO worker_heartbeats (id,last_seen_at) VALUES ($1,clock_timestamp()) ON CONFLICT (id) DO UPDATE SET last_seen_at=clock_timestamp()", [id]);
    await db().query("DELETE FROM local_mail WHERE expires_at<=clock_timestamp()");
    await db().query("DELETE FROM worker_heartbeats WHERE last_seen_at<clock_timestamp()-interval '1 day'");
    await db().query("UPDATE project_photos SET preview_bytes=NULL,preview_status='pending',preview_expires_at=NULL WHERE preview_expires_at<=clock_timestamp()");
    // Scans can take minutes; heartbeat remains independent of job progress.
    const heartbeat=setInterval(()=>{void db().query("UPDATE worker_heartbeats SET last_seen_at=clock_timestamp() WHERE id=$1",[id]).catch(()=>{});},5000);
    try { if(provider)await runInventoryOnce(db(),provider,stop.signal,id); }
    finally { clearInterval(heartbeat); }
  } catch { console.error(JSON.stringify({ code: "WORKER_NOT_READY" })); }
  await new Promise(resolve => setTimeout(resolve, 5000));
}
await db().query("DELETE FROM worker_heartbeats WHERE id=$1", [id]).catch(() => {});
await db().end();
