# EPIC-06 local implementation and release evidence

**Date:** 20 October 2026 (Asia/Makassar). **Checkout:** `main`, based on `ab375b7`, uncommitted implementation. **Result: Blocked.** The combined authorized-pilot gate remains open: D-01/D-02/D-03/D-04, current-denial/deletion reconciliation and retention policy, real device and hosted operational proof. No deployment, provider consent, real-account permission assignment or paid provisioning occurred.

## Acceptance boundary

| Row | Local result | Remaining release proof |
|---|---|---|
| A01 | Separate scoped/global operator roles; actual five-minute session-bound TOTP; restricted diagnostics; audited/idempotent grants and suspend/reactivate; durable throttle; ID/EN operator UI | Approved hosted authentication/MFA/custody and shared infrastructure |
| A02 | Actual PostgreSQL/HTTP cross-principal tests, origin/body checks, current grant/revocation and transaction races; bounded media/protocol regressions; captured application-log checks; dependency audit | Hosted/edge log privacy, deployed security review and live provider edge cases |
| A03 | AES-GCM logical DB/private-preview backup; real empty isolated DB restore; immutable results and exact preview bytes retained; old credentials/links invalidated; quarantine denies auth/business/readiness/worker | Approved retention/purge; newer deletion/revocation overlay replay **before reopening**; independent backup ACL/key custody and hosted restore. Quarantine alone does not pass this row |
| A04 | Chromium operator + gallery/result journeys, ID/EN, keyboard, 360/768/1440; measured synthetic pilot-capacity fixture | Real phone, complete accessibility/200% device matrix; provider cold generation and target-host memory/pools/capacity |
| A05 | Build/schema/readiness checks, worker telemetry/advisory alerts, source-package hashes/migration manifest and local procedures | Authorized staging, runtime/worker restart and alert delivery there, release owner and executed rollback; all decision gates closed |

## Executed local verification

Service/browser tests use isolated PostgreSQL 18.4 and production Next.js HTTP, synthetic users and generated colors. Restricted sandbox service startup and one generated-directory build failed; successful runs used approved local-process access. Initial browser failures identified an overly broad alert selector and the language selector's accessible name; both were corrected before the passing run. No failed attempt is counted as a pass.

- `npm run typecheck`, `npm test` (3 tests), `npm run build`: passed on Node 24.18.0 / npm 11.16.0 with pinned dependencies.
- `npm run test:operations` (4 tests): separate permission and actual TOTP proof; enrollment/failed code/failed proof-storage denial; freshness/session/logout; scoped list/detail/audit/metric denial; strict queries/body/origin; parallel identical grant replay, changed/expired keys, grant/reason bounds, audit rollback/immutability, durable throttling; suspension/save race and permanent main/download grant revocation across reactivation; role revocation; captured application logs exclude reason/cookie/share path. Actual encrypted backup restores immutable confirmation and identical private preview bytes into a **new database**, rejects tampering/wrong keys/occupied target, invalidates credentials/links and remains quarantined. Auth/owner/client/readiness HTTP quarantine checks pass; liveness stays available.
- `npm run test:db` (14), `npm run test:inventory` (12), `npm run test:gallery` (6), `npm run test:results` (7): passed. These exercise real affected auth/session/tenant/project/gallery/media/job and selection/confirmation boundaries. Public provider tests are protocol fixtures, not new live Drive verification.
- `npm run test:operations:browser`: passed. Covers real operator MFA/permission denial, verification, sanitized diagnostics, committed-suspend/lost-response/same-key recovery, suspension confirmation, reactivation, audit/metrics, ID/EN, keyboard and viewport overflow. `npm run test:gallery:browser` and `npm run test:results:browser`: passed for combined existing client/owner journeys. Screenshots under ignored `test-results/` contain only synthetic data. No physical-phone/production accessibility claim.
- `npm audit --omit=dev`: npm registry reported **0 vulnerabilities** in production dependencies. This is the advisory database's result at execution, not a security certification. No dependency version was changed.
- Migration `009_operations.sql` applied twice to isolated fixtures and to the managed local development database. Checksums/readiness passed. Actual managed counts were zero studios/projects/photos/selection items/confirmations before and after; nonempty fixture preservation is established by the isolated tests. No real operator roles were provisioned. The temporary managed database process was stopped.
- `pwsh -NoProfile -File docs/tools/validate-docs.ps1`, `git diff --check`: passed after documentation review.
- `npm run release:package`: produces an ignored local source directory plus manifest with HEAD, dirty state, Node version, migration checksums and per-file SHA-256. The verified package excludes private env/runtime/Git/backup data; it is explicitly `release_ready=false`. It packages current source rather than silently substituting the older committed tree.

CI now includes operations/results suites and browser checks plus the capacity fixture. The workflow was updated locally; no hosted CI run is claimed.

## Measured local capacity

`npm run test:pilot-load` ran on Windows/loopback with explicitly seeded **10 studios, 100 projects, 1000 photos, four folders and exactly 50 active clients**, verified by a database assertion. One HTTP-issued grant and 49 seeded hashed grants separate browsing capacity from the separately tested 20/minute/gallery access-gate throttle. Background projects and preview objects are capacity fixtures, not provider scans. Clients browse concurrently while one of those same 50 sessions performs ten save/confirm/owner-reopen cycles. It is a short contention sample, not sustained production load or a statistical SLA.

The aggregate artifact is `test-results/pilot-load.json` (final run timestamp `2026-10-19T21:35:52.578Z`, 20 October locally). No identifiers, credentials or media bytes appear in the report.

| Measurement | Sample count | Observed |
|---|---|---|
| Gallery list p95 | 150 | 196 ms |
| Draft read p95 | 150 | 234 ms |
| Warm preview p95 | 150 | 368 ms |
| Draft save p95 | 10 | 227 ms |
| Confirmation p95 | 10 | 237 ms |
| Owner reopen p95 | 10 | 371 ms |
| Warm first list + 24 preview bodies | 1 | 227 ms |
| Cold missing-preview denial | 1 | 15 ms, expected 503; **not cold regeneration/render time** |

The concurrent workload lasted 2.32 seconds, with 481 measured successful operations and one intentionally missing-preview denial. Peak sampled DB connections: 15, including harness, web and idle worker; configured business pool maximum is 12/process plus web auth guard 1. Idle worker RSS was 99,577,856 bytes (~95 MiB), pool total 1/waiting 0; this is not decoder/native-worker peak. Provider calls in this load workload: zero. Original local limits remain 50 MiB/60 seconds/two concurrent transfers per process. Provider quota, 1000-image cold generation, native memory peak, network/hosted transfer and real-device measurements remain unmeasured.

## Local operating and recovery procedure

1. Start the managed local database and run `npm run db:migrate` before web/worker startup. `/health/live` tests web liveness; `/health/ready` checks schema/DB/quarantine and reports worker state separately. `/ops` requires a separately provisioned permission and fresh TOTP; enrolling MFA never creates an operator role. No real role was assigned by this change.
2. Operator diagnostics accept a studio UUID support reference. Check recent errors/queue/expired leases and worker RSS/pool through global `/ops/metrics`; advisory codes are `WORKER_NOT_RUNNING`, `FAILED_JOBS`, `EXPIRED_LEASES`. These are pull diagnostics; no outbound alert service or delivery is configured. Retention candidate count does not authorize purge. Use identical pending request/key after unknown mutation results; after closing the page, review current diagnostics/audit before issuing a new operation.
3. `npm run release:package` captures a source manifest in `.local/releases/`. For local DB/preview backup, privately configure a separate 64-hex `LOCAL_BACKUP_KEY` and run `npm run backup:local`. Keep key custody, private configuration and encrypted backup storage separate. The CLI writes a new encrypted file under `.local/backups/`, prints only aggregate metadata and never overwrites an old backup. Local OS access control and off-machine/key custody are **not** verified production policy. Drive originals are not copied. The 128 MiB ceiling is intentionally a bounded local tool; it is not the hosted backup strategy.
4. Rehearse recovery only in a fresh, isolated, offline PostgreSQL database with the same migration manifest. `restoreQuarantined` refuses occupied targets, preserves immutable history and private objects, strips sessions/challenges/mail/operator roles, revokes every gallery grant and rotates share tokens. Keep that database quarantined. **Do not toggle the DB flag to reopen it:** the authoritative newer deletion/revocation overlay and its recovery/release policy are still missing under D-03/D-04. The automated drill proves this safe stopping point, not a completed recovery/reopening procedure.
5. Before any authorized staging release: approve D-01..D-04 and a named release/incident owner; choose least-privilege DB/runtime/backup roles and independent denial journal/key custody; verify HTTPS/Secure cookies, edge path-log suppression, provider access limits, retention/deletion replay, real-device checks and hosted load. Record private deployment coordinates only in the authorized private record. Run migrations explicitly once, start web/worker, verify restart/lease recovery and delivered alerts, then execute the complete owner/client/operator journey.
6. The proposed rollback process is **not yet staging-verified**: stop admission and workers, preserve current database plus latest denial/deletion journal, deploy the last compatible source package, verify schema compatibility/readiness, and re-run denial/health journeys before admission. Do not down-migrate or restore an older DB as an automatic rollback; immutable results and newer denial state must survive. An incompatible schema requires a reviewed forward repair or the approved quarantined recovery process.

**Single residual gate:** authorized pilot release evidence, including approved D-01..D-04, reconciled retention/recovery, real device and hosted operation/rollback. EPIC-06 remains **Blocked** until the combined gate is closed.
