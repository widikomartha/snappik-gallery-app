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

### Selection example

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

**Current local EPIC-01 implementation:** `/me`, `/onboarding`, `/studio` PATCH, `/studio/settings` GET/PATCH and `/entitlement` GET are implemented; later-epic routes in this target contract are not. Onboarding retries with the same completed name/slug return saved state, preserve existing settings and repair missing dependencies. A different completed name/slug returns `409 SETUP_CONFLICT`; edits go through revisioned settings/profile routes. `SLUG_TAKEN` is a retryable-input 409. Entitlement includes `status`, `project_limit`, `active_project_usage` (zero until EPIC-02) and grant dates/status. Settings defaults currently support the version-1 grid defaults in `BUSINESS_RULES.md`, main quota 1–500, notes/subfolder flags and the download-default toggle; no project deadline is created here.

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
