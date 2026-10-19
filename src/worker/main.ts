import { randomUUID } from "node:crypto";
import { db } from "../db/pool";
import { ready } from "../db/migrate";

const id = randomUUID();
let stopped = false;
for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => { stopped = true; });
console.log("Foundation worker starting (heartbeat and local-mail retention only).");
while (!stopped) {
  try {
    await ready(db());
    await db().query("INSERT INTO worker_heartbeats (id,last_seen_at) VALUES ($1,clock_timestamp()) ON CONFLICT (id) DO UPDATE SET last_seen_at=clock_timestamp()", [id]);
    await db().query("DELETE FROM local_mail WHERE expires_at<=clock_timestamp()");
    await db().query("DELETE FROM worker_heartbeats WHERE last_seen_at<clock_timestamp()-interval '1 day'");
  } catch { console.error(JSON.stringify({ code: "WORKER_NOT_READY" })); }
  await new Promise(resolve => setTimeout(resolve, 5000));
}
await db().query("DELETE FROM worker_heartbeats WHERE id=$1", [id]).catch(() => {});
await db().end();
