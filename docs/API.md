# API contract (normative target)

**Business prefix:** `/api/v1`. **Web pages:** `/app/...` and `/g/:token/...` are presentation routes, not aliases for protected API routes. This is the contract for the **target MVP**; only use a route as implemented after verifying it exists and its integration tests pass.

## Global conventions

- JSON UTF-8 unless CSV or binary. UUID internal identifiers. Date/time fields are RFC3339 UTC instants. Reject unknown mutation fields.
- Owner requests use verified server-side session and membership; operator requests additionally require scoped operator permission. Client uses workflow-specific grant cookie, never owner session.
- Success: `{ "data": ... }` except binary/download and explicitly paginated lists. Error: `{ "error": { "code": "...", "message": "...", "request_id": "...", "fields": {}, "current_revision": 4 } }`, with optional fields. Return safe localized display messages; internal codes remain stable.
- `Idempotency-Key` **16–128 printable ASCII** required on create/resync/confirm/reopen/operator mutations; key bound to actor+resource+operation+canonical body; reuse with different body -> 409; retention 24h.
- Expected revision is an integer `expected_revision`; do not synthesize a new revision on ambiguous responses. PUT selection is **full replacement**, not an incremental patch.
- Pagination: `limit` integer 1–100, default 50, opaque `cursor`, reply `{ "data": { "items": [], "next_cursor": null } }`; sorted with stable tie-breaking ID.
- Denial: 404 for cross-tenant/unknown owner IDs; 403 for known-but-disallowed operations; public client bootstrap gives generic unavailable for unknown/revoked share links. Mutations require origin/CSRF controls; sensitive data uses `Cache-Control: no-store`.
- API token/cookie safety and independent grants: see `SECURITY.md`.

## Owner routes (prefix `/api/v1`)

| Method | Path | Inputs / outcome |
|---|---|---|
| GET | `/me` | Verified identity and minimal studio/setup/entitlement; no provider tokens |
| POST | `/onboarding` | `{name,slug,locale,timezone}`; idempotent setup; 201 first completion, 200 same retry |
| PATCH | `/studio` | `{expected_revision,name?,slug?}`; preserve omitted fields |
| GET/PATCH | `/studio/settings` | Read/update settings and defaults with settings `expected_revision` |
| GET | `/entitlement` | Current trial/manual grant status, active project usage/limit |
| GET | `/projects` | Paginated list and active/archived/status filters |
| POST | `/projects` | Durable create with idempotency key; 201 project/job response |
| GET/PATCH | `/projects/:id` | Detail / guarded config update with `expected_revision` |
| POST | `/projects/:id/archive` | `{expected_revision}`; immediately revoke gallery access |
| POST | `/projects/:id/restore` | `{expected_revision}`; current entitlement/quota checks |
| POST | `/projects/:id/access/rotate` | `{expected_revision}`; rotate share token and grants |
| POST | `/projects/:id/sync` | Idempotently enqueue bounded inventory sync; 202 `{job_id}` |
| POST | `/projects/:id/sync/cancel` | `{job_id}`; scoped, retry-safe cancellation; terminal jobs return their saved status |
| GET | `/projects/:id/photos` | Paginated owner inventory incl. source health and availability |
| GET | `/projects/:id/media/:photoId` | Protected owner preview only; not unrestricted original |
| GET | `/projects/:id/selection` | Current selection status+revision and latest confirmation summary |
| GET | `/projects/:id/confirmations` | Paginated immutable confirmation history |
| POST | `/projects/:id/selection/reopen` | `{expected_revision,reason}` and idempotency key |
| GET | `/projects/:id/results.csv` | `confirmation_id` (immutable snapshot) OR explicit `view=draft`; safe CSV attachment |
| GET | `/dashboard` | Derived current counts, next deadlines, `generated_at` |
| GET | `/jobs/:id` | Scoped sanitized job outcome/progress, not provider raw payload |

### Project-create request/response

```json
{
  "client_label": "Graduation session",
  "drive_folder_id": "validated-google-drive-folder-id",
  "detect_subfolders": true,
  "notes_enabled": true,
  "layout": "grid",
  "main": { "enabled": true, "quota": 20, "expires_at": null },
  "download": { "enabled": false, "expires_at": null }
}
```

Passwords can be specified as optional *write-only* workflow fields; `null` explicitly removes an existing password on PATCH and omission means retain. Response never contains hash or plaintext. Optional client/admin phone fields are E.164. Source link input is normalized *client side* to a candidate ID, then server-adapter validated; no caller-supplied arbitrary URL fetch. `drive_connection_id` and resource keys are **not active fields until the provider model is approved and matching schema/route migrations are reviewed**.

**Local EPIC-02 boundary:** the server validates candidate folder ID syntax only, as permitted by the local exception in `BUSINESS_RULES.md`; it returns `source_validation: "pending_provider"` and never claims source access is verified. New projects inherit omitted configuration from a durable snapshot of studio defaults. Both workflow rows are returned in `workflows` with `kind`, `enabled`, `quota`, `expires_at`, `password_set` and access version; a selection set exists even when main is disabled. Project detail also includes revision, selection status/revision/count, latest `job_id`, source status and last successful sync time. POST returns this owner detail as the durable original response. PATCH accepts client label, optional nullable phones, subfolder/notes flags, grid layout and partial main/download configuration; root replacement is not accepted. Null removes a deadline/password, while omission preserves it.

`GET /projects` accepts `q` (literal case-insensitive client-label substring, <=100 characters), `state=active|archived|all` (default active), `inventory_status=pending|ready|failed`, `selection_status=not_started|selecting|confirmed`, `limit` and opaque `cursor`. Ordering is newest creation time then ID, with timestamp precision preserved in the cursor. `GET /dashboard` returns canonical `counts`, `recent_projects`, `next_deadlines` (enabled workflows in the next seven days), `entitlement` and `generated_at`. `GET /jobs/:id` exposes only scoped identity/type/status/attempt count/safe failure code/time. No worker payload or source credentials are returned.

Create requires `Idempotency-Key`; archive/restore/rotation require only `expected_revision`. A stale action is 409, including retries after a committed action: fetch detail and review canonical state. Archive and rotation remain allowed with expired entitlement. Restore at or after the 30-day boundary returns `403 RESTORE_WINDOW_EXPIRED`. Replay after the create key's 24-hour window returns `409 IDEMPOTENCY_EXPIRED`, preserving the retained unique key rather than making another project.

### Implemented local EPIC-03 owner inventory

Sync accepts exactly `{}` and requires an idempotency key. Same-key replay recovers the original 202/job; concurrent distinct keys coalesce an existing pending/running job for the current source configuration. Archived/expired-entitlement studios cannot enqueue; cancellation remains permitted and advances the lease fence without changing acknowledged inventory. No URL, credential, root replacement or resource-key input is accepted. With the default disabled adapter, jobs remain pending. The explicit local synthetic adapter processes only its generated fixture root; successful detail has `source_validation: "synthetic_fixture"`, never verified Google access.

Photos accepts only `limit`/opaque UUID `cursor`, returns UUID-ordered `items`, `next_cursor`, `inventory_status`, complete `generation`, `origin`, safe `failure_code`, skip `summary` and `last_successful_sync_at`. Items retain stable IDs, exact name/path/MIME/size/version, `available`, `preview_status`, `seen_generation` and a protected `preview_url` or null. Historical unavailable rows remain visible to the owner. Media rechecks the current owner session/studio/project/photo, denies archive/suspension/unavailable photos and sticky source permission loss, then returns only bounded JPEG preview bytes with `private, no-store`/`nosniff`; no original or provider fetch URL is exposed. EPIC-04 client media uses a separate workflow-grant boundary described below. Every cached response still crosses owner authorization. Job reads add `summary`, `available_at` and `completed_at` without exposing stage contents, lease ownership or provider payloads.

The local `google_public` adapter is opt-in and restricted to the privately configured approved root with explicit cache approval and an encrypted API key. Completed live scans identify `source_validation: "public_provider"` and `origin: "google_public"`; only publicly visible provider items are included. Public previews expire absolutely after seven days. Media uses two authorization transactions around a provider visibility/version/membership check, with no provider call holding DB locks. Changes to session/studio/project/source/photo/expiry during the external wait deny the response. Parent ancestry remains private metadata, and API keys/resource keys never enter DTOs. D-02 edge-case proof and D-03 hosting remain open.

```json
{
  "data": {
    "id": "c6ba5462-e214-4b3f-a52f-40b3991f2ea1",
    "revision": 1,
    "public_url": "/g/<opaque-token>",
    "inventory_status": "pending",
    "job_id": "87d2c9b9-728a-4e4a-b64a-44d122d762b3"
  }
}
```

On initial `/me` with verified identity but no setup, return `setup_status: "setup_required"` and null missing studio/settings/entitlement; `suspended` response hides ordinary studio operational details. Missing/expired login yields 401, email not verified 403, persistence/provider uncertainty 503, conflicts 409. Never redirect JSON APIs to a login HTML page.

## Client routes (prefix `/api/v1`)

| Method | Path | Inputs / outcome |
|---|---|---|
| GET | `/g/:token` | Generic minimal label/branding and which workflows may be entered; no photos/notes/provider IDs |
| POST | `/g/:token/access` | `{workflow:"main"|"download",password?}`; grant-specific HttpOnly cookie and canonical state |
| GET | `/g/:token/photos` | Workflow grant + optional `workflow=main|download`; paginated in-project photo refs, names, folders and preview endpoint |
| GET | `/g/:token/media/:photoId` | Workflow grant + `workflow`; protected derived-image variant, no raw provider URL |
| GET | `/g/:token/selection` | Main grant; status, quota, revision, acknowledged selection and timestamp |
| PUT | `/g/:token/selection` | Main grant; `{expected_revision,items:[{photo_id,note?}]}`; complete draft, max 1 MiB |
| POST | `/g/:token/selection/confirm` | Main grant + idempotency key; `{expected_revision}`, immutable snapshot response |
| GET | `/g/:token/download/:photoId` | Download grant only; validate availability and stream one original with safe filename |

**Cookie policy:** main and download grants have **distinct cookie names**, Secure + HttpOnly + SameSite, scoped to their API project path where practical. Never let a main cookie authorize original download or a download cookie authorize selection. Every media request explicitly supplies the intended workflow and validates its grant; browser cookie path alone is insufficient.

### Implemented local EPIC-04 boundary

Discovery returns only `{locale,workflows:[{kind,password_required,expires_at}]}` for currently enterable workflows. Access returns `{workflow,expires_at}` and the workflow cookie; canonical draft is fetched separately. Attempts are durably limited to 20 per project/workflow per minute, shared across local web processes, including failed passwords; 429 includes `Retry-After: 60`. The approved runtime is HTTP loopback, so its cookie omits Secure; a future hosted runtime must require HTTPS/Secure. Cookies remain HttpOnly, SameSite=Strict and scoped to the specific gallery API path. Only SHA-256 hashes of random 256-bit grants are stored; this is not password hashing.

Photos supports `workflow`, `limit`, UUID `cursor` and optional exact `folder` (empty string means root). It returns `{items,next_cursor,folders,inventory_status,origin}`; each item has stable `id`, original `filename`, `folder_path`, `preview_status`, and protected `preview_url`. Folder choices derive from available published photos, so empty provider folders have no entries. Provider IDs, root IDs, credentials and note bodies never enter discovery/photo responses. Client media reuses private derived previews with current grant checks before and after the existing provider visibility check. It streams no original.

Selection GET/PUT returns `{status,revision,quota,notes_enabled,items,saved_at}`, with canonical items including `photo_id,note,filename,folder_path,available`. PUT accepts only the documented mutation fields, bounds the body at 1 MiB and rejects duplicate/foreign/unavailable IDs, over-quota sets and notes over 500 Unicode code points. With notes disabled, unchanged existing notes may be retained or removed with their photo; new/changed nonempty notes are rejected. Full replacement and revision increment commit atomically under studio → project → selection locks. Confirmed sets reject writes. EPIC-05 adds the confirmation and original-download routes below.

### Implemented local EPIC-05 boundary

Confirm accepts exactly `{expected_revision}` and requires the current main grant plus an idempotency key. It returns `{id,revision,confirmed_at,items}`; each immutable item contains `photo_id,filename,folder_path,note`, with no provider ID. Confirmation advances the selection revision once and locks editing. Selection GET includes `last_confirmation_id` and `latest_confirmation`; while confirmed, its choices use immutable snapshot metadata. Matching session/key/body replay returns the original snapshot, including after reopen; another session/key cannot confirm a locked set. Expired retained keys return `IDEMPOTENCY_EXPIRED`. Authorization is checked before replay.

Owner selection GET returns current status/revision/items and the full latest confirmation. History returns full immutable snapshots with owner-only provider IDs, newest revision first; `limit` is 1–100 and `cursor` is the prior page’s last revision as a numeric string. Reopen accepts `{expected_revision,reason}` (10–1000 Unicode code points after trimming) and an owner-scoped idempotency key. It retains choices/history, advances revision and audits the reason. Matching replay recovers the original acknowledgment; new reopen requires active entitlement and an unarchived confirmed project. Cross-studio IDs return 404.

CSV requires exactly `confirmation_id=<UUID>` or `view=draft`; columns are `photo_id,provider_file_id,filename,folder_path,note,revision,confirmed_at,view`. Confirmation time is UTC ISO text; draft time is empty. Fields are quoted, embedded quotes doubled and formula-capable cells prefixed with an apostrophe. Read/export remains available to an expired owner.

Original GET accepts no query/body, requires only the current download grant, and does not require selection or confirmation. It resolves the published in-project source, allows JPEG/PNG/WebP up to 50 MiB, validates exact size/content signature, and repeats current authorization/source-pointer checks before delivery. Public Drive checks live ancestry/version around the bounded read; originals are never persisted. Local transfers are limited to two concurrent originals/process and 60 seconds including validation. The entire bounded original is validated before attachment headers; the client waits for a complete body before offering the file. Transfer failures return a safe 503; absent/unavailable photo IDs return 404 and invalid grants 401 (unavailable workflow/project gives generic 404). Private/no-store, nosniff and sanitized UTF-8 attachment names apply. Hosted streaming/resource limits and live Drive denial/revocation proof remain D-02/D-03 gates.

### Selection request

```json
{
  "expected_revision": 4,
  "items": [
    { "photo_id": "69a67726-6b36-42e3-93a3-021501a0f6b5", "note": "Slight exposure adjustment" }
  ]
}
```

After save, server returns canonical `{data:{status:"selecting",revision:5,quota:20,items:[...],saved_at:"..."}}`. Confirm uses this **acknowledged** revision, not optimistic local state. `409 REVISION_CONFLICT` returns latest revision; UI must fetch latest state and let the user choose reapplication. Confirmation failure cannot be presented as success.

## Operator routes (prefix `/api/v1`)

| Method | Path | Required permission |
|---|---|---|
| GET | `/ops/studios` | `diagnostics_read`; bounded support reference search |
| GET | `/ops/studios/:id` | `diagnostics_read`; sanitized setup, entitlement and job status |
| POST | `/ops/studios/:id/grants` | `entitlement_write`; `{starts_at,ends_at,project_limit,reason}` plus key |
| POST | `/ops/studios/:id/suspend` | `studio_suspend`; `{reason}` plus key |
| POST | `/ops/studios/:id/reactivate` | `studio_suspend`; `{reason}` plus key |
| GET | `/ops/audit-events` | `diagnostics_read`; paginated redacted audit |

Reason: 10–1,000 characters. Pilot manual grant: up to 366 days and project_limit 1–1,000. Platform authorization is independent from studio ownership and requires fresh, session-bound MFA for privileged mutations. No raw photo access by default.

## Auth and provider-specific endpoints

**Current local implementation:** EPIC-01 routes `/me`, `/onboarding`, `/studio` PATCH, `/studio/settings` GET/PATCH and `/entitlement` GET remain implemented. EPIC-02 adds project list/create/detail/PATCH, archive/restore/access rotation, dashboard and scoped job read. EPIC-03 adds the owner sync/cancel/photos/media routes described above. EPIC-04 implements client discovery/grants/gallery/draft; EPIC-05 implements confirmation, owner results/history/reopen/export and original delivery. Operator routes remain unimplemented and return 404. Onboarding retries with the same completed name/slug return saved state, preserve existing settings and repair missing dependencies. A different completed name/slug returns `409 SETUP_CONFLICT`; edits go through revisioned settings/profile routes. `SLUG_TAKEN` is a retryable-input 409. Entitlement includes `status`, `project_limit`, actual non-archived `active_project_usage` and grant dates/status. Settings defaults currently support the version-1 grid defaults in `BUSINESS_RULES.md`, main quota 1–500, notes/subfolder flags and the download-default toggle; no project deadline is created here.

Local `/api/auth` exposes reviewed email signup/signin, verification/resend, session read/signout, reset request/callback/consume, password change and TOTP/backup-code enrollment/verification/disable/regeneration only. Passwords are 12–128 characters; verification/reset links expire after 30 minutes; sessions expire after 12 hours with database refresh after one hour. Device trust and public synthetic-login paths are not enabled. Auth-library success/error bodies retain their provider format outside `/api/v1`; adapter/storage uncertainty returns the safe 503 error envelope. Non-loopback configuration is refused while D-01 is open.

`/api/auth/*` is **outside** `/api/v1`. If adopting an existing authorized Snappik codebase, retain its reviewed Better Auth local mode and migration/session guards rather than inventing another password system. Real provider callback, external delivery and production mode remain decision gates. Owner/business APIs must reject unverifiable or revoked sessions; HTTP 200 from an unguarded upstream auth library is not sufficient proof of logout. Expose only reviewed auth paths for the chosen mode. No public synthetic test-login endpoint.

## Error codes / client recovery

| HTTP | Representative code | Handling |
|---|---|---|
| 400/422 | `INVALID_INPUT`, `INVALID_SOURCE`, `QUOTA_EXCEEDED`, `SOURCE_PHOTO_UNAVAILABLE` | Correct field/item; don't blindly retry |
| 401 | `AUTH_REQUIRED`, `GALLERY_GRANT_REQUIRED` | Re-authenticate or enter menu gate |
| 403 | `ENTITLEMENT_EXPIRED`, `STUDIO_SUSPENDED`, `WORKFLOW_DISABLED`, `ACCESS_EXPIRED` | Display restriction / allowed recovery |
| 404 | `NOT_FOUND`, `GALLERY_UNAVAILABLE` | Generic no-leak unavailable state |
| 409 | `REVISION_CONFLICT`, `SELECTION_LOCKED`, `IDEMPOTENCY_CONFLICT`, `PROJECT_LIMIT_REACHED` | Refresh canonical state, preserve unsaved intent |
| 413 | `PAYLOAD_TOO_LARGE` | Reduce payload |
| 429 | `RATE_LIMITED` | Honor `Retry-After`; bounded/manual retry |
| 502/503 | `SOURCE_UNAVAILABLE`, `TEMPORARILY_UNAVAILABLE` | Clear uncertainty and retry safely |

No internal stack, SQL, provider token, Drive root ID or full share-token URL in error payloads or logs.
