# Current project state

**Inspected:** 20 October 2026. **Mode:** `fresh-build`. Evidence reflects actual code and executed local checks; no source was copied from the original repository.

| Field | Actual value |
|---|---|
| Repository | Local Git checkout; `origin` configured (not contacted) |
| Branch + HEAD + changes | `main`, based on `ab375b7`; uncommitted EPIC-06 implementation (inspect Git status) |
| Verified running features | Local auth/onboarding/settings/trial; projects; fenced inventory/private previews; client grants/gallery/draft; immutable results/reopen/export/download; restricted operator UI/API and diagnostics |
| Current epic | EPIC-06 — Operations, Security & Pilot Release |
| Epic status 01 / 02 / 03 | In progress (D-01) / Done (local lifecycle) / Blocked (provider/hosted proof) |
| Epic status 04 / 05 / 06 | In progress / Blocked / Blocked |
| Evidence | [EPIC-06](EPIC-06-EVIDENCE.md), [EPIC-05](EPIC-05-EVIDENCE.md), [EPIC-04](EPIC-04-EVIDENCE.md), [EPIC-03](EPIC-03-EVIDENCE.md) |
| Single EPIC-06 residual gate | Authorized pilot release evidence: D-01..D-04, reconciled retention/recovery, real device and hosted operation/rollback |
| Next concrete action | Obtain the approved staging/privacy/auth/provider choices, then implement and verify reconciliation/purge and the hosted release gate |

**EPIC-06 delivered locally:** `/ops` and separate scoped/global permissions require actual TOTP proof within five minutes in the current provider session. Restricted diagnostics omit gallery content and sensitive support text. Reasoned grants/suspend/reactivate use atomic immutable audit, durable throttling and session-scoped idempotency. Suspension permanently revokes old gallery sessions, including after reactivation. Operator UI preserves an unknown request for identical retry. Metrics expose safe queue/lease/advisory alerts and web/worker RSS/pool counters; retention remains report-only.

A separately keyed AES-GCM logical backup includes private preview objects. Real restore into a new isolated DB preserved exact preview bytes and immutable confirmations, rejected corruption/occupied targets and invalidated old sessions/share URLs. Restored databases remain quarantined across auth/business/readiness/worker paths. Newer deletion/revocation overlay replay and safe reopening are still missing; quarantine does not complete restore acceptance. Source packaging records actual working-tree hashes, migration identity and `release_ready=false`, excluding private env/runtime/backup data.

**Executed evidence:** build/typecheck/unit, PostgreSQL/HTTP suites (14 foundation/projects, 12 inventory/protocol, 6 gallery, 7 results, 4 operations), Chromium operator/gallery/results journeys, production-dependency audit (zero reported vulnerabilities), docs validation and diff checks. Synthetic load: 10 studios/100 projects/1000 photos/four folders/50 clients; save p95 227 ms, confirm p95 237 ms (10 samples each); warm 24-preview batch 227 ms. Worker idle RSS ~95 MiB; decoder peak/cold provider generation and hosted capacity were not measured. Migration `009_operations.sql` applied twice to managed local storage with readiness/checksums passed; its actual existing business tables were empty and stayed empty. No real roles were assigned; the temporary DB process was stopped.

**Retained outcomes:** EPIC-05 confirmation/history/reopen/export and independent bounded original delivery remain locally verified, with real-provider/hosted A05 proof pending D-02/D-03. EPIC-04 gallery/draft/conflict recovery remains locally verified with physical-phone acceptance outstanding. EPIC-03's separately approved public-only local source/cache has prior evidence; default provider mode remains disabled and live edge cases/key policy/hosted constraints remain open. No new live-provider request was performed for EPIC-06.

**Boundaries:** no destructive purge, recovery reopening, real account/operator permission changes, external alert delivery or deployment. D-01 auth, remaining D-02 provider proof, D-03 hosting/custody and D-04 privacy remain open. Runtime pins: Node 24.18.0/npm 11.16.0, Next.js 16.4.2, React 19.2.7, Better Auth 1.7.11, PostgreSQL 18.4, Sharp 0.35.5. No commit or external provisioning occurred.
