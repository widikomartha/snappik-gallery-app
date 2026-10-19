import { createHmac, randomBytes } from "node:crypto";
import type { PoolClient } from "pg";
import { hashPassword } from "better-auth/crypto";
import { z } from "zod";
import { config } from "../../config";
import { json, Problem } from "../http";
import { entitlement } from "../entitlement";
import { canonical, projectCreate, projectPatch, revisionInput } from "./validation";

type Studio = { id: string; user_id: string };
type Workflow = { kind: "main" | "download"; enabled: boolean; quota: number | null; expires_at: string | Date | null; password_hash: string | null; access_version: number };
const missing = () => new Problem(404, "NOT_FOUND", "Not found.");
function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new Problem(422, "INVALID_INPUT", "Check project fields and revision.");
  return result.data;
}
async function writable(client: PoolClient, studio: Studio, quota = false) {
  const current = await entitlement(client, studio.id);
  if (current.status !== "active") throw new Problem(403, "ENTITLEMENT_EXPIRED", "Your entitlement has expired.");
  if (quota && current.active_project_usage >= current.project_limit) throw new Problem(409, "PROJECT_LIMIT_REACHED", "Archive a project or increase your project allowance.");
}
async function workflows(client: PoolClient, studio: Studio, id: string): Promise<Workflow[]> {
  return (await client.query("SELECT kind,enabled,quota,expires_at,password_hash,access_version FROM project_workflows WHERE studio_id=$1 AND project_id=$2 ORDER BY kind", [studio.id,id])).rows;
}
async function detail(client: PoolClient, studio: Studio, id: string) {
  const p = (await client.query(`SELECT p.*,s.state AS selection_status,s.revision AS selection_revision,
    (SELECT count(*)::int FROM selection_items i WHERE i.studio_id=p.studio_id AND i.project_id=p.id) AS selected_count,
    (SELECT id FROM jobs j WHERE j.studio_id=p.studio_id AND j.project_id=p.id ORDER BY created_at DESC,id DESC LIMIT 1) AS job_id
    FROM projects p JOIN selection_sets s ON s.studio_id=p.studio_id AND s.project_id=p.id WHERE p.studio_id=$1 AND p.id=$2`, [studio.id,id])).rows[0];
  if (!p) throw missing();
  const { public_token, defaults_snapshot: snapshot, ...safe } = p;
  return { ...safe, defaults_snapshot: snapshot, public_url: `/g/${public_token}`, source_validation: "pending_provider", workflows: (await workflows(client, studio, id)).map(({ password_hash, ...w }) => ({ ...w, password_set: !!password_hash })) };
}
async function audit(client: PoolClient, studio: Studio, id: string, action: string) {
  await client.query("INSERT INTO audit_events(studio_id,actor_id,project_id,action,outcome) VALUES($1,$2,$3,$4,'success')", [studio.id,studio.user_id,id,action]);
}
const pageQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50), cursor: z.string().max(500).optional(),
  q: z.string().trim().max(100).default(""), state: z.enum(["active","archived","all"]).default("active"),
  inventory_status: z.enum(["pending","ready","failed"]).optional(), selection_status: z.enum(["not_started","selecting","confirmed"]).optional(),
}).strict();

export async function projectRoutes(client: PoolClient, studio: Studio, request: Request, value: unknown): Promise<Response> {
  const url = new URL(request.url); const path = url.pathname.replace(/^\/api\/v1\//, "");
  if (path === "dashboard" && request.method === "GET") {
    const counts = (await client.query(`SELECT count(*)::int AS total,
      count(*) FILTER(WHERE p.archived_at IS NULL)::int AS active,
      count(*) FILTER(WHERE p.archived_at IS NOT NULL)::int AS archived,
      count(*) FILTER(WHERE p.archived_at IS NULL AND s.state='selecting')::int AS selecting,
      count(*) FILTER(WHERE p.archived_at IS NULL AND s.state='confirmed')::int AS confirmed,
      count(*) FILTER(WHERE p.archived_at IS NULL AND p.inventory_status='pending')::int AS pending,
      count(*) FILTER(WHERE p.archived_at IS NULL AND p.inventory_status='failed')::int AS failed
      FROM projects p JOIN selection_sets s ON s.studio_id=p.studio_id AND s.project_id=p.id WHERE p.studio_id=$1`, [studio.id])).rows[0];
    const recent = (await client.query(`SELECT p.id,p.client_label,p.inventory_status,p.archived_at,s.state AS selection_status
      FROM projects p JOIN selection_sets s ON s.studio_id=p.studio_id AND s.project_id=p.id
      WHERE p.studio_id=$1 ORDER BY p.created_at DESC,p.id DESC LIMIT 5`, [studio.id])).rows;
    const deadlines = (await client.query(`SELECT p.id,p.client_label,w.kind,w.expires_at FROM projects p
      JOIN project_workflows w ON w.studio_id=p.studio_id AND w.project_id=p.id
      WHERE p.studio_id=$1 AND p.archived_at IS NULL AND w.enabled AND w.expires_at>=clock_timestamp()
      AND w.expires_at<clock_timestamp()+interval '7 days' ORDER BY w.expires_at,p.id,w.kind LIMIT 20`, [studio.id])).rows;
    return json({ counts, recent_projects: recent, next_deadlines: deadlines, entitlement: await entitlement(client,studio.id), generated_at: new Date().toISOString() });
  }
  if (path.startsWith("jobs/") && request.method === "GET") {
    const id = path.slice(5); if (!z.uuid().safeParse(id).success) throw missing();
    const job = (await client.query("SELECT id,project_id,type,status,attempt_count,failure_code,created_at FROM jobs WHERE studio_id=$1 AND id=$2", [studio.id,id])).rows[0];
    if (!job) throw missing(); return json(job);
  }
  if (path === "projects" && request.method === "GET") {
    const query = parse(pageQuery, Object.fromEntries(url.searchParams));
    let cursor: { time: string; id: string } | null = null;
    if (query.cursor) {
      try { cursor = z.object({ time: z.iso.datetime({offset:true}), id: z.uuid() }).strict().parse(JSON.parse(Buffer.from(query.cursor,"base64url").toString("utf8"))); }
      catch { throw new Problem(422,"INVALID_INPUT","Invalid page cursor."); }
    }
    const rows = (await client.query(`SELECT p.id,p.client_label,p.inventory_status,p.archived_at,p.revision,p.created_at,s.state AS selection_status,
      to_char(p.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_time
      FROM projects p JOIN selection_sets s ON s.studio_id=p.studio_id AND s.project_id=p.id
      WHERE p.studio_id=$1 AND ($2='all' OR ($2='active' AND p.archived_at IS NULL) OR ($2='archived' AND p.archived_at IS NOT NULL))
      AND strpos(lower(p.client_label),lower($3))>0 AND ($4::text IS NULL OR p.inventory_status=$4)
      AND ($5::text IS NULL OR s.state=$5) AND ($6::timestamptz IS NULL OR (p.created_at,p.id)<($6::timestamptz,$7::uuid))
      ORDER BY p.created_at DESC,p.id DESC LIMIT $8`, [studio.id,query.state,query.q,query.inventory_status,query.selection_status,cursor?.time,cursor?.id,query.limit+1])).rows;
    const page = rows.slice(0,query.limit); const last = page.at(-1);
    return json({ items: page.map(({ cursor_time, ...row }) => row), next_cursor: rows.length>query.limit ? Buffer.from(JSON.stringify({ time:last.cursor_time,id:last.id })).toString("base64url") : null });
  }
  if (path === "projects" && request.method === "POST") {
    const input = parse(projectCreate,value);
    const key = request.headers.get("idempotency-key");
    if (!key || !/^[\x20-\x7e]{16,128}$/.test(key)) throw new Problem(422,"INVALID_INPUT","Use an idempotency key of 16–128 printable ASCII characters.");
    const hash = createHmac("sha256",config().secret).update(canonical(input)).digest("hex");
    const record = (await client.query("SELECT request_hash,response,expires_at>clock_timestamp() AS valid FROM idempotency_records WHERE actor_id=$1 AND studio_id=$2 AND operation='project.create' AND key=$3", [studio.user_id,studio.id,key])).rows[0];
    if (record) {
      if (record.request_hash!==hash) throw new Problem(409,"IDEMPOTENCY_CONFLICT","This key belongs to a different request.");
      if (!record.valid) throw new Problem(409,"IDEMPOTENCY_EXPIRED","This request key has expired. Review saved projects before creating another.");
      return json(record.response,201);
    }
    await writable(client,studio,true);
    const settings = (await client.query("SELECT defaults,revision,defaults_version FROM studio_settings WHERE studio_id=$1",[studio.id])).rows[0];
    if (!settings) throw new Problem(409,"SETUP_REQUIRED","Repair studio settings first.");
    const main = { ...settings.defaults.main,...input.main };
    const download = { ...settings.defaults.download,...input.download,quota:null };
    if (!main.enabled && !download.enabled) throw new Problem(422,"INVALID_INPUT","Enable at least one workflow.");
    if (main.enabled && main.quota==null) throw new Problem(422,"INVALID_INPUT","Main selection requires a quota.");
    const p = (await client.query(`INSERT INTO projects(studio_id,public_token,client_label,client_phone,admin_phone,drive_folder_id,detect_subfolders,notes_enabled,layout,defaults_snapshot)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`, [studio.id,randomBytes(24).toString("base64url"),input.client_label,input.client_phone,input.admin_phone,input.drive_folder_id,input.detect_subfolders??settings.defaults.detect_subfolders,input.notes_enabled??settings.defaults.notes_enabled,input.layout??settings.defaults.layout,settings])).rows[0];
    for (const [kind,w] of [["main",main],["download",download]] as const) await client.query("INSERT INTO project_workflows(studio_id,project_id,kind,enabled,quota,expires_at,password_hash) VALUES($1,$2,$3,$4,$5,$6,$7)", [studio.id,p.id,kind,w.enabled,w.quota,w.expires_at,w.password ? await hashPassword(w.password) : null]);
    await client.query("INSERT INTO selection_sets(studio_id,project_id) VALUES($1,$2)",[studio.id,p.id]);
    await client.query("INSERT INTO jobs(studio_id,project_id,type,dedupe_key) VALUES($1,$2,'inventory','initial')",[studio.id,p.id]);
    await audit(client,studio,p.id,"project.create");
    const response = await detail(client,studio,p.id);
    await client.query("INSERT INTO idempotency_records(actor_id,studio_id,operation,key,request_hash,project_id,response) VALUES($1,$2,'project.create',$3,$4,$5,$6)",[studio.user_id,studio.id,key,hash,p.id,response]);
    return json(response,201);
  }
  const match = /^projects\/([^/]+)(?:\/(archive|restore|access\/rotate))?$/.exec(path);
  if (!match || !z.uuid().safeParse(match[1]).success) throw missing();
  const id = match[1]; const action = match[2];
  const p = (await client.query("SELECT * FROM projects WHERE studio_id=$1 AND id=$2 FOR UPDATE",[studio.id,id])).rows[0];
  if (!p) throw missing();
  if (!action && request.method==="GET") return json(await detail(client,studio,id));
  if ((!action && request.method!=="PATCH") || (action && request.method!=="POST")) throw missing();
  const input = action ? parse(revisionInput,value) : parse(projectPatch,value);
  if (p.revision!==input.expected_revision) throw new Problem(409,"REVISION_CONFLICT","Project changed. Reload before saving.",p.revision);
  if (action==="archive") {
    if (!p.archived_at) await client.query("UPDATE projects SET archived_at=clock_timestamp(),access_version=access_version+1,revision=revision+1,updated_at=clock_timestamp() WHERE studio_id=$1 AND id=$2",[studio.id,id]);
  } else if (action==="restore") {
    if (!p.archived_at) throw new Problem(409,"PROJECT_NOT_ARCHIVED","Project is already active.");
    const within = (await client.query("SELECT archived_at+interval '30 days'>clock_timestamp() AS allowed FROM projects WHERE studio_id=$1 AND id=$2",[studio.id,id])).rows[0].allowed;
    if (!within) throw new Problem(403,"RESTORE_WINDOW_EXPIRED","The 30-day restore window has ended.");
    await writable(client,studio,true);
    await client.query("UPDATE projects SET archived_at=NULL,revision=revision+1,updated_at=clock_timestamp() WHERE studio_id=$1 AND id=$2",[studio.id,id]);
  } else if (action==="access/rotate") {
    await client.query("UPDATE projects SET public_token=$3,access_version=access_version+1,revision=revision+1,updated_at=clock_timestamp() WHERE studio_id=$1 AND id=$2",[studio.id,id,randomBytes(24).toString("base64url")]);
  } else {
    await writable(client,studio);
    if (p.archived_at) throw new Problem(403,"PROJECT_ARCHIVED","Restore the project before editing.");
    const edit = parse(projectPatch,value); const current = await workflows(client,studio,id);
    const merged = current.map(w=>({...w,...edit[w.kind]}));
    if (!merged.some(w=>w.enabled) || merged.some(w=>w.kind==="main" && w.enabled && w.quota==null)) throw new Problem(422,"INVALID_INPUT","Enable a workflow and set the main quota when enabled.");
    // Project lock serializes future selection writes; inspect the actual canonical set/items.
    const selection = (await client.query("SELECT state FROM selection_sets WHERE studio_id=$1 AND project_id=$2 FOR UPDATE",[studio.id,id])).rows[0];
    const mainEdit = edit.main;
    if (mainEdit?.quota!==undefined && mainEdit.quota!==current.find(w=>w.kind==="main")!.quota) {
      if (selection.state==="confirmed") throw new Problem(409,"SELECTION_LOCKED","Reopen selection before changing its quota.");
      const count = (await client.query("SELECT count(*)::int AS n FROM selection_items WHERE studio_id=$1 AND project_id=$2",[studio.id,id])).rows[0].n;
      if (mainEdit.quota!==null && mainEdit.quota<count) throw new Problem(422,"QUOTA_EXCEEDED","Quota cannot be below the saved selection count.");
    }
    for (const w of current) {
      const patch = edit[w.kind]; if (!patch) continue;
      const next = {...w,...patch};
      const passwordHash = patch.password===undefined ? w.password_hash : patch.password===null ? null : await hashPassword(patch.password);
      const revoke = patch.password!==undefined || (patch.enabled!==undefined && patch.enabled!==w.enabled) || patch.expires_at!==undefined;
      await client.query("UPDATE project_workflows SET enabled=$4,quota=$5,expires_at=$6,password_hash=$7,access_version=access_version+$8 WHERE studio_id=$1 AND project_id=$2 AND kind=$3",[studio.id,id,w.kind,next.enabled,next.quota,next.expires_at,passwordHash,revoke?1:0]);
    }
    await client.query(`UPDATE projects SET client_label=COALESCE($3,client_label),
      client_phone=CASE WHEN $4 THEN $5 ELSE client_phone END,admin_phone=CASE WHEN $6 THEN $7 ELSE admin_phone END,
      detect_subfolders=COALESCE($8,detect_subfolders),notes_enabled=COALESCE($9,notes_enabled),layout=COALESCE($10,layout),
      revision=revision+1,updated_at=clock_timestamp() WHERE studio_id=$1 AND id=$2`,[studio.id,id,edit.client_label,edit.client_phone!==undefined,edit.client_phone,edit.admin_phone!==undefined,edit.admin_phone,edit.detect_subfolders,edit.notes_enabled,edit.layout]);
    if (edit.detect_subfolders!==undefined && edit.detect_subfolders!==p.detect_subfolders) {
      await client.query("UPDATE projects SET inventory_status='pending' WHERE studio_id=$1 AND id=$2",[studio.id,id]);
      await client.query("INSERT INTO jobs(studio_id,project_id,type,dedupe_key) VALUES($1,$2,'inventory',$3)",[studio.id,id,`config:${p.revision+1}`]);
    }
  }
  await audit(client,studio,id,`project.${action??"update"}`);
  return json(await detail(client,studio,id));
}
