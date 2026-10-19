import { createHash } from "node:crypto";
import { z } from "zod";
import type { PoolClient } from "pg";
import { db, transaction } from "../../db/pool";
import { identity, lockIdentity } from "../auth/principal";
import { body, json, origin, Problem } from "../http";

const uuid = z.string().uuid();
const reason = z.string().trim().refine(s => s.isWellFormed() && !s.includes("\0") && [...s].length >= 10 && [...s].length <= 1000);
const statusInput = z.object({ reason }).strict();
const grantInput = statusInput.extend({ starts_at: z.iso.datetime({ offset: true }), ends_at: z.iso.datetime({ offset: true }), project_limit: z.number().int().min(1).max(1000) }).strict().refine(v => {
  const duration = Date.parse(v.ends_at) - Date.parse(v.starts_at);
  return duration > 0 && duration <= 366 * 86400000;
});
async function permitted(client: PoolClient, user: string, permission: string, studio?: string) {
  const rows = await client.query("SELECT id FROM platform_roles WHERE user_id=$1 AND permission=$2 AND ($3::uuid IS NULL OR studio_id IS NULL OR studio_id=$3) FOR SHARE", [user, permission, studio ?? null]);
  if (!rows.rowCount) throw new Problem(403, "OPERATOR_DENIED", "Operator permission is required.");
}
async function fresh(client: PoolClient, session: string) {
  const proof = await client.query(`SELECT p.session_id FROM operator_mfa_proofs p JOIN session s ON s.id=p.session_id JOIN "user" u ON u.id=s."userId"
    JOIN "twoFactor" f ON f."userId"=u.id WHERE p.session_id=$1 AND u."twoFactorEnabled" AND f.verified
    AND p.verified_at<=clock_timestamp() AND p.verified_at>clock_timestamp()-interval '5 minutes'`, [session]);
  if (!proof.rowCount) throw new Problem(403, "FRESH_MFA_REQUIRED", "Verify an authenticator code in this session, then retry.");
}
export async function operationsHandler(request: Request) {
  origin(request);
  const url = new URL(request.url), path = url.pathname.replace(/^\/api\/v1\/ops\//, "");
  const match = /^studios\/([^/]+)(?:\/(grants|suspend|reactivate))?$/.exec(path);
  const studioId = match?.[1];
  if (studioId && !uuid.safeParse(studioId).success) throw new Problem(404, "NOT_FOUND", "Not found.");
  const mutation = request.method === "POST" && !!match?.[2];
  if ((!mutation && (request.method !== "GET" || !!match?.[2])) || (!match && !["studios", "audit-events", "metrics"].includes(path))) throw new Problem(404, "NOT_FOUND", "Not found.");
  const principal = await identity(request);
  const permission = mutation ? match![2] === "grants" ? "entitlement_write" : "studio_suspend" : "diagnostics_read";
  // Throttle in its own transaction so invalid/rolled-back requests count too.
  await transaction(async client => {
    await lockIdentity(client, principal); await permitted(client, principal.user.id, permission, studioId);
    await fresh(client, principal.session.id);
    const attempt = (await client.query(`INSERT INTO operator_attempts(user_id) VALUES($1) ON CONFLICT(user_id) DO UPDATE SET
      attempts=CASE WHEN operator_attempts.window_started_at<=clock_timestamp()-interval '1 minute' THEN 1 ELSE operator_attempts.attempts+1 END,
      window_started_at=CASE WHEN operator_attempts.window_started_at<=clock_timestamp()-interval '1 minute' THEN clock_timestamp() ELSE operator_attempts.window_started_at END RETURNING attempts`, [principal.user.id])).rows[0];
    return attempt.attempts;
  }).then(attempts => { if (attempts > 60) throw new Problem(429, "RATE_LIMITED", "Wait a minute before retrying."); });
  const value = mutation ? await body(request) : null;
  return transaction(async client => {
    await lockIdentity(client, principal); await permitted(client, principal.user.id, permission, studioId); await fresh(client, principal.session.id);
    if (!mutation) {
      const allowed = path === "metrics" ? [] : path === "studios" ? ["studio_id", "after", "limit"] : path === "audit-events" ? ["after", "limit"] : [];
      if ([...url.searchParams.keys()].some(k => !allowed.includes(k) || url.searchParams.getAll(k).length !== 1)) throw new Problem(422, "INVALID_INPUT", "Check query fields.");
      const query = z.object({ studio_id: uuid.optional(), after: (path === "audit-events" ? z.string().regex(/^[1-9][0-9]{0,17}$/) : uuid).optional(), limit: z.coerce.number().int().min(1).max(50).default(20) }).safeParse(Object.fromEntries(url.searchParams));
      if (!query.success) throw new Problem(422, "INVALID_INPUT", "Check query fields.");
      const q = query.data;
      const scope = `EXISTS(SELECT 1 FROM platform_roles r WHERE r.user_id=$1 AND r.permission='diagnostics_read' AND (r.studio_id IS NULL OR r.studio_id=s.id))`;
      if (path === "metrics") return json(await metrics(client, principal.user.id));
      if (path === "audit-events") {
        const rows = (await client.query(`SELECT e.id::text,e.studio_id,e.operation,e.occurred_at FROM operator_events e JOIN studios s ON s.id=e.studio_id
          WHERE ${scope} AND ($2::bigint IS NULL OR e.id>$2) ORDER BY e.id LIMIT $3`, [principal.user.id, q.after ?? null, q.limit + 1])).rows;
        return json({ items: rows.slice(0,q.limit), next: rows.length > q.limit ? rows[q.limit-1].id : null });
      }
      const rows = (await client.query(`SELECT s.id,s.setup_status,s.suspended_at,s.revision,s.provisioned_at,
        (SELECT count(*)::int FROM projects p WHERE p.studio_id=s.id AND p.archived_at IS NULL) AS active_projects,
        (SELECT count(*)::int FROM jobs j WHERE j.studio_id=s.id AND j.status='failed') AS failed_jobs,
        (SELECT count(*)::int FROM entitlement_grants g WHERE g.studio_id=s.id AND g.revoked_at IS NULL AND g.starts_at<=clock_timestamp() AND g.ends_at>clock_timestamp()) AS active_grants
        FROM studios s WHERE ${scope} AND ($2::uuid IS NULL OR s.id=$2) AND ($3::uuid IS NULL OR s.id>$3) ORDER BY s.id LIMIT $4`, [principal.user.id, studioId ?? q.studio_id ?? null, q.after ?? null, q.limit + 1])).rows;
      if (studioId) { if (!rows.length) throw new Problem(404,"NOT_FOUND","Not found."); return json(rows[0]); }
      return json({ items: rows.slice(0,q.limit), next: rows.length > q.limit ? rows[q.limit-1].id : null });
    }
    if (url.search) throw new Problem(422,"INVALID_INPUT","Query fields are not supported.");
    const operation = match![2];
    const parsed = (operation === "grants" ? grantInput : statusInput).safeParse(value);
    const key = request.headers.get("idempotency-key");
    if (!parsed.success || !key || !/^[\x21-\x7e]{16,128}$/.test(key)) throw new Problem(422,"INVALID_INPUT","Supply a bounded reason, valid grant and idempotency key.");
    const input = parsed.data, hash = createHash("sha256").update(JSON.stringify(input)).digest("hex");
    const studio = (await client.query("SELECT id,suspended_at,revision FROM studios WHERE id=$1 FOR UPDATE", [studioId])).rows[0];
    if (!studio) throw new Problem(404,"NOT_FOUND","Not found.");
    const scope = [principal.user.id, principal.session.id, studioId, operation, key];
    const replay = (await client.query("SELECT *,expires_at>clock_timestamp() AS live FROM operator_requests WHERE actor_id=$1 AND session_id=$2 AND studio_id=$3 AND operation=$4 AND key=$5", scope)).rows[0];
    if (replay) {
      if (replay.request_hash !== hash) throw new Problem(409,"IDEMPOTENCY_CONFLICT","This key belongs to another request.");
      if (!replay.live) throw new Problem(409,"IDEMPOTENCY_EXPIRED","Review the saved operation before continuing.");
      return json(replay.response);
    }
    const event = (await client.query("INSERT INTO operator_events(actor_id,studio_id,operation,reason) VALUES($1,$2,$3,$4) RETURNING id::text", [principal.user.id, studioId, operation, input.reason])).rows[0];
    let response;
    if (operation === "grants") {
      const grant = grantInput.parse(value);
      response = (await client.query(`INSERT INTO entitlement_grants(studio_id,source,source_ref,starts_at,ends_at,project_limit,operator_event_id)
        VALUES($1,'manual',$2,$3,$4,$5,$6) RETURNING id,starts_at,ends_at,project_limit`, [studioId, `operator:${event.id}`, grant.starts_at, grant.ends_at, grant.project_limit, event.id])).rows[0];
    } else {
      await client.query(`UPDATE studios SET suspended_at=${operation === "suspend" ? "COALESCE(suspended_at,clock_timestamp())" : "NULL"},revision=revision+1 WHERE id=$1`, [studioId]);
      // Permanent invalidation: reactivation cannot revive grants issued before suspension.
      if (operation === "suspend") {
        await client.query("UPDATE projects SET access_version=access_version+1 WHERE studio_id=$1", [studioId]);
        await client.query("UPDATE gallery_sessions SET revoked_at=COALESCE(revoked_at,clock_timestamp()) WHERE studio_id=$1", [studioId]);
      }
      response = { studio_id: studioId, status: operation === "suspend" ? "suspended" : "active", revision: studio.revision+1 };
    }
    response = { ...response, event_id: event.id };
    await client.query("INSERT INTO operator_requests(actor_id,session_id,studio_id,operation,key,request_hash,response) VALUES($1,$2,$3,$4,$5,$6,$7)", [...scope, hash, response]);
    return json(response);
  });
}
async function metrics(client: PoolClient, user: string) {
  // Global process/worker metrics require an explicitly global diagnostics role.
  if (!(await client.query("SELECT id FROM platform_roles WHERE user_id=$1 AND permission='diagnostics_read' AND studio_id IS NULL FOR SHARE",[user])).rowCount) throw new Problem(403,"OPERATOR_DENIED","Global diagnostics permission is required.");
  const counts = (await client.query(`SELECT
    (SELECT count(*)::int FROM jobs WHERE status='pending') AS pending_jobs,
    (SELECT count(*)::int FROM jobs WHERE status='failed') AS failed_jobs,
    (SELECT count(*)::int FROM jobs WHERE status='running' AND lease_deadline<=clock_timestamp()) AS expired_leases,
    EXISTS(SELECT 1 FROM worker_heartbeats WHERE last_seen_at>clock_timestamp()-interval '30 seconds') AS worker_running,
    (SELECT count(*)::int FROM projects WHERE archived_at<=clock_timestamp()-interval '30 days') AS retention_candidates`)).rows[0];
  const worker=(await client.query("SELECT rss_bytes::text,pool_total,pool_waiting FROM worker_heartbeats WHERE last_seen_at>clock_timestamp()-interval '30 seconds' ORDER BY last_seen_at DESC LIMIT 1")).rows[0]??null;
  const alerts=[...(!counts.worker_running?["WORKER_NOT_RUNNING"]:[]),...(counts.failed_jobs?["FAILED_JOBS"]:[]),...(counts.expired_leases?["EXPIRED_LEASES"]:[])];
  return { ...counts, alerts, worker, web_rss_bytes: process.memoryUsage().rss, db_pool: { total: db().totalCount, idle: db().idleCount, waiting: db().waitingCount, maximum: 12 }, purge_enabled: false };
}
