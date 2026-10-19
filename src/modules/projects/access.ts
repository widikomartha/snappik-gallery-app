import type { PoolClient } from "pg";

// Shared repository boundary for future client routes. Never authorize from URL possession.
// Call within the request transaction; callers must hold studio -> project locks for mutations.
export async function authorizedWorkflow(client: PoolClient, tokenHash: string, workflow: "main" | "download") {
  return (await client.query(`SELECT p.id AS project_id,p.studio_id,w.kind FROM gallery_sessions g
    JOIN projects p ON p.id=g.project_id AND p.studio_id=g.studio_id
    JOIN studios s ON s.id=p.studio_id
    JOIN project_workflows w ON w.project_id=p.id AND w.studio_id=p.studio_id AND w.kind=g.workflow
    WHERE g.token_hash=$1 AND g.workflow=$2 AND g.revoked_at IS NULL AND g.expires_at>clock_timestamp()
      AND g.project_access_version=p.access_version AND g.workflow_access_version=w.access_version
      AND p.archived_at IS NULL AND s.suspended_at IS NULL AND s.setup_status='active' AND w.enabled
      AND (w.expires_at IS NULL OR w.expires_at>clock_timestamp())`, [tokenHash, workflow])).rows[0] ?? null;
}
