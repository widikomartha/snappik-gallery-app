# Database and transactions (normative)

**Persistence:** PostgreSQL; UUID identifiers; `timestamptz` UTC instants; server-generated timestamps; reviewed numbered additive SQL migrations with checksums and migration journal. The logical model below is the target; **reuse and inspect existing schema before adding migrations**. Do not create a second table just because this file uses a conceptual label.

## Core logical entities

| Entity | Required key fields / constraints |
|---|---|
| `users` | PK id; immutable `(auth_provider, auth_subject)` unique; email *nonunique* metadata; `security_version` to revoke past sessions; provider secrets outside app user DTOs |
| `studios` | PK id; name/slug (nullable until completed), unique nonnull slug, setup/suspend status, `provisioned_at`, revision |
| `studio_members` | Composite `(studio_id,user_id)` PK/FK; MVP owner-only; uniqueness preventing multiple active owner studios |
| `studio_settings` | `studio_id` PK; locale id/en; valid IANA timezone; `revision`; versioned defaults snapshot JSON validated by application |
| `entitlement_grants` | id, studio_id, source trial/manual, starts/ends, limit, revoked_at, source_ref, operator actor/reason; unique initial trial per studio |
| `platform_roles` | user id + explicit diagnostics/grant/suspend permission; separated from membership; no self-grant |
| `projects` | `(studio_id,id)` unique, opaque high-entropy `public_token` unique, access_version, client label, source root id, configuration, revision, inventory status/generation, archived_at, timestamps |
| `project_workflows` | `(project_id,kind)` unique; kind main/download; enabled, quota nullable, expires_at nullable, slow password hash nullable, access_version |
| `project_photos` | id, studio/project composite scope, provider_file_id, exact filename/path/MIME/size/source_version, available, seen_generation; unique `(project_id,provider_file_id)` |
| `selection_sets` | one current main set/project; studio/project scope, state, revision, saved_at, last confirmation reference |
| `selection_items` | `(selection_set_id,photo_id)` unique, plain-text note <=500 Unicode code points, canonical photo reference |
| `selection_confirmations` | immutable id, studio/project/set, revision, confirmed_at, exact JSON or relational snapshot of photo ID/provider ID/name/path/note; immutable history |
| `gallery_sessions` | hashed/revocable per-workflow grants, access version, expiry; main/download separation; no raw token in logs |
| `jobs` | scoped type/project, payload_version, status, attempt count, available_at, lease owner/token/deadline, dedupe key, safe failure code |
| `idempotency_records` | keyed actor/tenant/resource/operation/key + canonical request hash + durable original response; 24h TTL |
| `audit_events` | actor/action/tenant/resource/UTC timestamp/outcome/reason, sanitized fields, immutable evidence appropriate to retention |

## Consistency constraints

- Every dependent project/photo/selection/job FK preserves studio/project scope; use composite FKs or explicit scoped validation plus DB protections. Do not accept unqualified IDs in public repositories.
- Confirmation snapshot is immutable even if project/photo metadata changes, project archives or the owner reopens. Historical selected photo rows cannot be silently cascade-deleted while required by history.
- Notes are bounded by **Unicode code points** in application validation; PostgreSQL may add check constraints but never assume UTF-8 byte length equals characters.
- Project and set revisions are **distinct**. Unknown fields cannot silently mutate schema-derived fields.
- Folder paths/filenames are display metadata, never unique identity. Preserve capitalization and file extensions in exports.
- Unique entitlement trial source reference and one-owner constraint are database-level, not frontend assumptions.

## Transaction recipes

**Onboarding:** acquire stable user mapping/user lock -> find/create studio/membership -> insert missing settings/trial -> validate profile -> audit setup -> commit. Set trial start at original `provisioned_at` using DB precision; same request retry recovers saved outcome. Do not reset trial or overwrite other tab's setup.

**Create project:** authorize verified owner, lock studio, count non-archived project quota, compare input and idempotency key, insert project+workflow+selection set+audit+scan job+response in one commit. Return `201` with `inventory_status=pending`, irrespective of background scan timing.

**Save selection:** verify *current* main grant, lock project then selection set, compare expected revision, check each photo same project and available, count quota, replace canonical item rows, increment set revision, commit. Do not silently merge stale versions.

**Confirm:** same locks and current policy checks; enforce 1..quota and available items; store immutable confirmation snapshot and set locked in same transaction. Same canonical idempotency scope/key -> original response, not another snapshot.

**Reopen:** verified active owner, same locks, reason required, preserve current selected IDs and all previous confirmations, unlock and increment revision; audit.

**Inventory publish:** list and stage outside transaction. Inside project+selection locks validate worker lease/fence, source root/config/generation, then publish new metadata, mark missing **only if complete** and record last_successful_sync_at. Failed scans retain last complete generation.

**Archive/restore/purge:** archive changes access version synchronously; restore verifies owner entitlement/quota and old absolute dates; worker purge after 30 days rechecks archived state under lock before deleting derived assets/allowed records. Do not delete Drive originals.

## Current EPIC-02 schema boundary

`004_projects.sql` adds the project lifecycle tables, both workflow rows (including disabled workflows), one dormant-or-active selection set, scoped photo/item references for quota guards, inventory jobs, creation idempotency and gallery grant version references. Composite foreign keys preserve studio/project scope throughout. The initial job is durable `pending`; the foundation worker does not process it. Changing subfolder detection queues a new revision-deduplicated pending job without removing old inventory metadata.

Project creation snapshots the saved defaults plus their version/revision; later studio defaults do not rewrite that snapshot or project settings. Workflow hashes use the existing Better Auth slow-password implementation and never enter DTOs. Request fingerprints use keyed HMAC over canonical validated input, so passwords are not persisted as plaintext or unkeyed fast hashes. Idempotency replay expires after 24 hours; retained key uniqueness rejects reuse after that window. Archive/rotation advance the project access version; restore retains the advanced version, original workflow deadlines and selection records. No purge, confirmation writer, gallery session issuance or provider inventory writer is delivered by this migration.

## Migration / release policy

- Prefer `ADD nullable → backfill → verify → enforce NOT NULL/unique` for expansions. Production changes need reviewed migration and backup/compatibility plan, not destructive `down/reset`.
- Checksummed migrations and advisory locking prevent out-of-order/concurrent duplicate application. SQL and journal commit atomically; failed DDL rolls back.
- Review web **and** worker compatibility before schema changes. Never roll old workers without lease-fencing support back onto a schema/process that expects fencing.
- Separate runtime, migrator and backup identities in shared environments; prove least-privilege access. Build must not require a real provider login.
- Authentication library tables live behind the chosen provider adapter and its reviewed schema; **do not fabricate credential tables or duplicate hashing in app users**.

## Provider extension gate

A real Drive access decision may need studio-owned encrypted connection references, root resource keys, per-file resource keys, scopes, refresh/revoke lifecycle and cache/legal controls. **Do not add unreviewed credential columns to `projects` or expose secret values in gallery DTOs.** Define source-connection schema and paired API contract only after the provider fixture is exercised and `DECISIONS.md` is resolved for that mode.
