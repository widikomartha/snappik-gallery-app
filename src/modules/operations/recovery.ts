import type { Pool, PoolClient } from "pg";
import { Problem } from "../http";

export async function assertOperational(client: Pool | PoolClient, lock = false) {
  const row = (await client.query(`SELECT quarantined FROM recovery_control WHERE singleton${lock ? " FOR SHARE" : ""}`)).rows[0];
  if (!row || row.quarantined) throw new Problem(503,"RECOVERY_QUARANTINED","Recovery verification is required before access can resume.");
}
