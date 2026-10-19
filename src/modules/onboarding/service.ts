import type { PoolClient } from "pg";
import { transaction } from "../../db/pool";
import { identity, lockIdentity } from "../auth/principal";
import { body, json, origin, Problem } from "../http";
import { initialDefaults, profile, settingsPatch, studioPatch } from "./validation";
import { projectRoutes } from "../projects/service";
import { entitlement } from "../entitlement";

async function owner(client: PoolClient, subject: string) {
  return (await client.query(`SELECT u.id AS user_id,s.* FROM users u JOIN studio_members m ON m.user_id=u.id JOIN studios s ON s.id=m.studio_id WHERE u.auth_provider='better-auth-local' AND u.auth_subject=$1 FOR UPDATE OF s`, [subject])).rows[0];
}
function active(studio: Record<string, unknown> | undefined) {
  if (!studio) throw new Problem(403, "SETUP_REQUIRED", "Complete studio setup first.");
  if (studio.suspended_at) throw new Problem(403, "STUDIO_SUSPENDED", "Studio access is suspended.");
}
async function settings(client: PoolClient, studioId: string) {
  return (await client.query("SELECT locale,timezone,revision,defaults_version,defaults FROM studio_settings WHERE studio_id=$1", [studioId])).rows[0] ?? null;
}
const studioDTO = (s: Record<string, unknown>) => ({ id: s.id, name: s.name, slug: s.slug, revision: s.revision, provisioned_at: s.provisioned_at });

export async function ownerHandler(request: Request) {
  origin(request);
  const path = new URL(request.url).pathname.replace(/^\/api\/v1\//, "");
  const value = request.method === "GET" ? null : await body(request);
  const principal = await identity(request);
  try {
    return await transaction(async client => {
      const session = await lockIdentity(client, principal);
      let studio = await owner(client, session.user.id);
      if (path === "me" && request.method === "GET") {
        const user = { id: session.user.id, name: session.user.name, email: session.user.email, email_verified: true, mfa_enabled: !!session.user.twoFactorEnabled };
        if (studio?.suspended_at) return json({ user, setup_status: "suspended", studio: null, settings: null, entitlement: null });
        return json({ user, setup_status: studio?.setup_status ?? "setup_required", studio: studio ? studioDTO(studio) : null, settings: studio ? await settings(client, studio.id) : null, entitlement: studio ? await entitlement(client, studio.id) : null });
      }
      if (path === "onboarding" && request.method === "POST") {
        const parsed = profile.safeParse(value);
        if (!parsed.success) throw new Problem(422, "INVALID_INPUT", "Check name, slug, language and timezone.");
        const input = parsed.data;
        if (studio?.suspended_at) active(studio);
        const completed = studio?.setup_status === "active";
        if (completed && (studio.name !== input.name || studio.slug !== input.slug)) throw new Problem(409, "SETUP_CONFLICT", "Setup is already saved. Use settings to edit it.");
        const mapping = (await client.query("INSERT INTO users (auth_provider,auth_subject) VALUES ('better-auth-local',$1) ON CONFLICT (auth_provider,auth_subject) DO UPDATE SET auth_subject=EXCLUDED.auth_subject RETURNING id", [session.user.id])).rows[0];
        if (!studio) {
          studio = (await client.query("INSERT INTO studios DEFAULT VALUES RETURNING *")).rows[0];
          await client.query("INSERT INTO studio_members (studio_id,user_id) VALUES ($1,$2)", [studio.id, mapping.id]);
        }
        // Repair missing dependencies without resetting acknowledged values or original trial.
        await client.query("INSERT INTO studio_settings (studio_id,locale,timezone,defaults) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING", [studio.id, input.locale, input.timezone, initialDefaults]);
        await client.query("INSERT INTO entitlement_grants (studio_id,source,source_ref,starts_at,ends_at,project_limit) SELECT id,'trial','initial',provisioned_at,provisioned_at+interval '168 hours',3 FROM studios WHERE id=$1 ON CONFLICT DO NOTHING", [studio.id]);
        if (!completed) {
          studio = (await client.query("UPDATE studios SET name=$2,slug=$3,setup_status='active' WHERE id=$1 RETURNING *", [studio.id, input.name, input.slug])).rows[0];
          await client.query("INSERT INTO audit_events (studio_id,actor_id,action,outcome) VALUES ($1,$2,'studio.setup','success')", [studio.id, mapping.id]);
        }
        return json({ studio: studioDTO(studio), settings: await settings(client, studio.id), entitlement: await entitlement(client, studio.id) }, completed ? 200 : 201);
      }
      active(studio);
      if (path === "projects" || path.startsWith("projects/") || path === "dashboard" || path.startsWith("jobs/")) return projectRoutes(client, studio, request, value);
      if (request.method === "GET" && path === "entitlement") return json(await entitlement(client, studio.id));
      if (request.method === "GET" && path === "studio/settings") return json(await settings(client, studio.id));
      if (request.method === "PATCH" && ["studio", "studio/settings"].includes(path)) {
        if ((await entitlement(client, studio.id)).status !== "active") throw new Problem(403, "ENTITLEMENT_EXPIRED", "Your entitlement has expired.");
        const parsed = (path === "studio" ? studioPatch : settingsPatch).safeParse(value);
        if (!parsed.success) throw new Problem(422, "INVALID_INPUT", "Check settings and revision.");
        const input = parsed.data;
        const canonical = path === "studio" ? studio : await settings(client, studio.id);
        if (!canonical) throw new Problem(409, "SETUP_REQUIRED", "Retry setup to repair settings.");
        if (canonical.revision !== input.expected_revision) throw new Problem(409, "REVISION_CONFLICT", "Settings changed. Reload before saving.", canonical.revision);
        let saved;
        if (path === "studio") {
          const p = studioPatch.parse(value);
          saved = (await client.query("UPDATE studios SET name=COALESCE($2,name),slug=COALESCE($3,slug),revision=revision+1 WHERE id=$1 RETURNING *", [studio.id, p.name, p.slug])).rows[0];
        } else {
          const p = settingsPatch.parse(value);
          saved = (await client.query("UPDATE studio_settings SET locale=COALESCE($2,locale),timezone=COALESCE($3,timezone),defaults=COALESCE($4,defaults),revision=revision+1 WHERE studio_id=$1 RETURNING locale,timezone,revision,defaults_version,defaults", [studio.id, p.locale, p.timezone, p.defaults])).rows[0];
        }
        await client.query("INSERT INTO audit_events (studio_id,actor_id,action,outcome) VALUES ($1,$2,$3,'success')", [studio.id, studio.user_id, path === "studio" ? "studio.update" : "settings.update"]);
        return json(path === "studio" ? studioDTO(saved) : saved);
      }
      throw new Problem(404, "NOT_FOUND", "Not found.");
    });
  } catch (error) {
    if ((error as { code?: string }).code === "23505") throw new Problem(409, "SLUG_TAKEN", "This studio address is already in use.");
    throw error;
  }
}
