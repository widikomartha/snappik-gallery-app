# Architecture and project structure

**Style:** a modular monolith in one TypeScript repository: Next.js web/API + separate Node worker, PostgreSQL as durable data store and jobs ledger, provider adapters for authentication, Google Drive and private derived-media storage. This is the **target shape**; inspect existing code for actually implemented modules before creating new ones.

## Reference runtime

- Web/API: Next.js 16 / React 19 / TypeScript 5; backend runs in Node. Match exact versions and commands to the repo's `package.json` and lockfile; do not silently upgrade during a feature task.
- DB: PostgreSQL with reviewed numbered SQL migrations, checksums and separate least-privilege runtime/DDL roles in shared environments. Never auto-run DDL at web startup.
- Worker: separate process built from the same codebase, using a PostgreSQL-backed job queue, lease renewal, fencing, retry and dead-job visibility. No Redis or microservices required for pilot.
- Provider adapters: verified authentication session, Google Drive folder/file inventory and controlled original download, private derived-image object store.
- UI: reusable accessible components; Indonesian and English; no mandatory paid UI library. If reusing an existing codebase, adopt its installed patterns rather than migrating frameworks gratuitously.

## Module ownership

```text
src/
  app/                 Next.js routes, pages and thin request handlers
  modules/
    auth/              identity/session/recovery only
    onboarding/        studio initialization and settings
    projects/          project lifecycle, workflow config, entitlement checks
    inventory/         scan publishing, photo metadata, source availability
    gallery/           public gates, scoped media and selection services
    confirmation/      immutable snapshots, reopen, results/export
    operations/        restricted operator commands, audit projections
    reliability/       jobs, idempotency, audit, operational policy
  adapters/            auth, Drive, private-storage implementations
  db/                  pool, migrations, repositories, grants
  worker/              job dispatch/handlers
  ui/                  components, design tokens, localization (as needed)
tests/                 unit, PostgreSQL, API, E2E/contract as used by repo
```

These are *boundaries*, not instructions to create empty folders. When existing modules already cover a responsibility, extend them instead of duplicating code.

## End-to-end data flow

1. Owner authenticates; server resolves verified identity + studio membership; onboarding/trial are created once.
2. Owner creates project transactionally, producing immutable ID/share-token and pending scan job.
3. Worker validates Drive root/subtree and collects a bounded staged generation; after a complete successful scan, atomically publishes photo metadata and availability. Original bytes stay in Drive.
4. Authenticated client access gate issues workflow-specific grant; server checks grant version and current deadlines on **every** metadata/media/mutation request.
5. Clients save a shared revisioned set. Confirmation persists immutable exact-photo snapshot; owner views/exports that snapshot or explicitly reopens.
6. Original downloads stream from a validated provider ID after independent download grant checks. Derived thumbnails come from private cache through a protected endpoint.

## Critical transactions and concurrency

- Transactional create: check authenticated owner/entitlement/quota while locking studio; create project/workflows/selection set/audit/job/idempotency response; commit, then return `201`.
- Selection save: lock project then set, validate expected revision+grant+item availability+quota, write full intended set and revision, then acknowledge.
- Confirmation: same lock order; persist immutable snapshot and mark locked atomically; same idempotency key returns original.
- Reopen: same lock order plus active owner entitlement; preserve historical confirmations.
- Inventory: external listing outside DB transaction. Stage scan; lock project and set at publish, revalidate source/config/generation/fence and update availability in a single transaction. Failed/partial scans do not tombstone photos.
- Jobs: claim with lease; renew; only the current lease token may publish/finish; bounded retry and observable terminal failure.

## Media limits and cache

Use `project/studio/providerFileId/sourceVersion/transformVersion/size` as a private cache key. Access check is independent of cached bytes. Bound upstream data to 50 MiB per supported original, cap decoder dimensions/memory/time based on *measured target-host capability*, avoid proxying arbitrary URLs, and clean transient scratch on failures. Cache retention requires provider and privacy clearance, not merely a technical TTL.

**Implemented local EPIC-03 exception:** generated fixtures and the explicitly approved local public source use private PostgreSQL preview bytes scoped by studio/project/photo/source version, with the fixed `decode-preview.mjs` transform (1024px JPEG). Decoding runs one image at a time in a separate killable process with a 24-million-pixel input ceiling, 128 MiB V8 heap limit, five-second libvips processing timeout, ten-second decoder-process deadline and separate 60-second upstream transfer deadline; native process memory still requires target-host measurement/isolation under D-03. Output is <=512 KiB, metadata is stripped, and no scratch/original files are written. Scan staging is capped at 5,000 photos, depth 10, 2,000 folders, 20,000 entries and 10,000 pages, with a ten-minute generated-fixture / thirty-minute public-source scan deadline. Breaches fail visibly. The owner separately approved caching for the allowlisted local public source on 20 October 2026; public previews expire absolutely after seven days and the worker removes expired bytes without removing photo/selection metadata. Each public preview request authorizes locally, releases the transaction, verifies current provider root/ancestry/file version via parent listings and metadata, then authorizes again before returning bytes. Private DB storage does not choose a production object store or close D-02/D-03 release gates.

## Environment and deployment assumptions

Development on Windows uses local PostgreSQL and synthetic provider fixtures. The previous codebase used pinned Node 24 / npm 11.16.0; verify exact runtime. Production topology, region, provider, secrets, independent backup strategy and log redaction are **pending decisions**. Do not hardcode a speculative provider name into domain services. Web and worker need independent operational limits; `health/live` tests process liveness and `health/ready` tests DB/schema readiness, not completeness of product features.

## Non-functional constraints

- No external provider calls while holding application transactions.
- No reliance on user-supplied tenant IDs, provider URLs, role flags or names as authorization keys.
- Preserve business state on lost response, refresh failure, worker restart and stale tabs.
- Restrict stored secrets, logs, provider-derived assets and audit access; review `SECURITY.md` before implementing affected entry points.
- Prefer current repo conventions and existing infrastructure to new libraries/services for their own sake.
