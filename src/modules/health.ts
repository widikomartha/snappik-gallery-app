import { db } from "../db/pool";
import { ready } from "../db/migrate";
import { json } from "./http";
import { assertOperational } from "./operations/recovery";

export async function health(kind: string) {
  if (kind === "live") return json({ status: "live" });
  if (kind !== "ready") return json({ status: "unknown" }, 404);
  try {
    await ready(db());
    await assertOperational(db());
    const result = await db().query("SELECT EXISTS(SELECT 1 FROM worker_heartbeats WHERE last_seen_at>clock_timestamp()-interval '30 seconds') AS worker");
    return json({ status: "ready", database: "ready", worker: result.rows[0].worker ? "running" : "not_running" });
  } catch { return json({ status: "not_ready" }, 503); }
}
