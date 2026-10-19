import type { PoolClient } from "pg";

// Callers lock the studio before using this projection to authorize quota writes.
export async function entitlement(client: PoolClient, studioId: string) {
  const grants = (await client.query(`SELECT source,starts_at,ends_at,project_limit,revoked_at,
    (revoked_at IS NULL AND starts_at<=clock_timestamp() AND ends_at>clock_timestamp()) AS active
    FROM entitlement_grants WHERE studio_id=$1 ORDER BY starts_at,id`, [studioId])).rows;
  const applicable = grants.filter(g => g.active);
  const usage = (await client.query("SELECT count(*)::int AS n FROM projects WHERE studio_id=$1 AND archived_at IS NULL", [studioId])).rows[0].n;
  return { status: applicable.length ? "active" : "expired", project_limit: Math.max(0, ...applicable.map(g => g.project_limit)), active_project_usage: usage, grants };
}
