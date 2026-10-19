# EPIC-02 — local acceptance evidence

**Verified:** 19–20 October 2026, Windows, Node 24.18.0/npm 11.16.0, PostgreSQL 18.4, production Next.js 16.4.2 HTTP server and headless Chromium. Branch `main`, starting HEAD `9574759`; verification performed before the EPIC-02 delivery commit (see `git log` for its identity). Synthetic identities, roots and grants only; no external service was changed. After acceptance passed, the additive migration was also applied to the managed loopback development database using the existing checksummed migrator; the temporary database process was stopped.

**Result:** Done for the local project-lifecycle scope defined in EPIC-02. Production authentication remains gated by D-01; real Drive access/indexing by D-02/EPIC-03. The explicit local candidate-source exception is in `BUSINESS_RULES.md` and paired API/database/design contracts.

| Assertion | Actual boundary and observed outcome |
|---|---|
| A01 | Real authenticated HTTP + PostgreSQL: eight concurrent identical create requests returned the same original project; one project/set/audit/job and two workflow rows persisted. Changed input/key reuse conflicted. Failure injected at final idempotency insert rolled back the complete transaction. Chromium discarded a real committed HTTP reply, then retried the exact original key/body and reached one durable detail page. |
| A02 | Six competing creates with two existing projects yielded one success and five limit conflicts. Usage counted real non-archived rows. Revoked entitlement blocked create/config/restore while read/dashboard/archive/rotation continued. The original create acknowledgment remained recoverable; active manual grants selected the highest limit. |
| A03 | Defaults snapshots stayed unchanged after studio defaults changed; later creates inherited the new defaults. Optional phone omission and download-only creation worked. Unicode labels, main quota bounds, unknown fields, phone/source format and workflow enablement were checked. Passwords used the existing slow hash and never appeared in DTOs. Omitted deadlines persisted, null cleared them, and workflow version changes invalidated only relevant grants. Actual selection-item count prevented unsafe quota reduction; a confirmed set blocked quota edits. Parallel stale edits yielded one success/one conflict. Chromium preserved unsaved intent after conflict/failed edit and required deliberate reload. |
| A04 | Actual shared PostgreSQL grant-policy repository denied both stored workflow grants after archive, freed quota, and continued denying old grants after restore. Restore preserved the selection record and absolute deadline. Two competing restores under one remaining slot yielded one success/one conflict. The 30-day cutoff denied restoration. Rotation changed the token/access version. Browser archive/restore/rotation confirmations and persisted state passed. |
| A05 | Two authenticated studios: detail/config/actions/jobs denied foreign IDs; list/dashboard contained only current-studio data. Composite FK rejected a cross-studio job insert. Deferred photos/selection/results routes returned 404. Pagination, search, filters, canonical counts and pending/ready/failed projections passed. Unknown/absent/suspended/cross-origin requests were denied. Subfolder edits queued a new pending job. |

Verification commands (all passed):

```powershell
npm run typecheck
npm test
npm run build
npm run test:db
npm run test:browser
npm run test:projects:browser
pwsh -NoProfile -File docs/tools/validate-docs.ps1
git diff --check
```

`npm test`: 3 tests. `npm run test:db`: 14 tests (9 foundation/auth + 5 project acceptance cases), fresh isolated PostgreSQL clusters and separate HTTP requests/connections. Both browser scripts exercised the actual production build; project screens checked at 360/768/1440px with ID/EN, focus and overflow checks. Synthetic list screenshots in ignored `test-results/projects-*.png` were visually reviewed. The Windows sandbox prevented Next from creating generated directories; the build and process-based tests ran with approved normal local filesystem/process permissions. CI includes the project browser script; no hosted CI run is claimed.

Limits: ready/failed source states and existing selection/grant records are explicitly seeded projections, not provider/client-flow proof. Initial inventory jobs remain pending because the foundation worker does not index Drive. Public gallery/grant issuance, photo inventory/media, result export/confirmation, provider resync, purge and production deployment belong to later epics. Closing/reloading an uncertain create page loses its in-memory form/passwords, so owners must review the saved list before starting a new create. No production, real-device or full-accessibility claim. Test runs used isolated databases. The verified additive migration was subsequently applied to the existing local development database without resets or data deletion; it was stopped afterward. Future checkouts use `npm run db:local` and `npm run db:migrate` as documented in the README.
