# Verification and release acceptance

**Rule:** tests verify behavior through real affected boundaries. A synthetic adapter checks a local contract; it cannot prove Google Drive permission semantics, hosted streaming, external email, a real device or backup restore. `Done` requires every acceptance row in the selected epic, with relevant provider gates closed where applicable.

## Canonical test fixture

- Studio A active; B separate tenant; C expired entitlement; D suspended; one operator with and one without permission/MFA.
- Three photos including **two different provider IDs both named `IMG_001.jpg`** in different folders and an uppercase extension; a deleted/unavailable source; an oversize/unsupported item; nested/empty folders.
- Two main clients/tabs editing the **same selection set**, a separate download-only grant, rotated link, per-menu passwords and a deadline at `T-1ms`, `T`, `T+1ms`.
- Use deterministic fake clock for domain semantics and **real separate PostgreSQL connections/barriers** for races. Include a lost-response retry, worker death, and provider 429/timeout.
- Use generated images and harmless fake credentials; never import personal images, secrets or competitor data.

## Acceptance matrix (one row per meaningful risk)

| Scenario | Required observable result | Epic |
|---|---|---|
| QA-01 Authentication/logout/recovery | Old sessions denied after successful logout/reset, unrecoverable uncertainty signaled, MFA unaffected | 01 |
| QA-02 Tenant/auth mapping | Cross-studio IDs denied on all current protected APIs and DB scoped writes | 01–06 |
| QA-03 Onboarding repeat/race | One owner/studio/settings/trial across parallel/retry/failure; original trial start kept | 01 |
| QA-04 Create/reply loss/quota | Same key -> one project/job; changed payload -> conflict; simultaneous fourth project denied | 02 |
| QA-05 Project config/archive/restore | Stale revision blocked; deadlines retained; archive denies clients; restore under quota only | 02 |
| QA-06 Source inventory | Pagination/nesting/resource identity; no hidden/partial scan reported complete | 03 |
| QA-07 Scan failure/removal | Last completed generation preserved; unavailable item retained in draft | 03 |
| QA-08 Job restart/fencing | Killed/retried worker cannot duplicate visible business action | 03 |
| QA-09 Gallery UX | Correct folders/photo refs/viewer/error states at 360/768/1440 + keyboard | 04 |
| QA-10 Main vs download grant | Wrong/expired/rotated/suspended grant denied, independent menu passwords | 04,05 |
| QA-11 Quota/notes/identity | 500 Unicode note accepted, 501 rejected; same-named photos distinct | 04 |
| QA-12 Shared save conflict | Two-tab 409, no overwrite; pending change not called saved | 04 |
| QA-13 Confirm race | Only acknowledged expected revision confirms; no double snapshot | 05 |
| QA-14 Reopen/history | Old immutable result persists, fresh revision/edit/reconfirm correct | 05 |
| QA-15 Result export | Exact IDs/filename/path/note/revision, CSV formula escaping | 05 |
| QA-16 Download failures | Only download grant streams original; bounded overflow/truncate/timeout/cancel failures | 05 |
| QA-17 Operator | Permission+recent MFA+reason and audit, no default photo data | 06 |
| QA-18 Privacy/security | SSRF, XSS, CSRF, raw token/log, private object and redaction checks | 06 |
| QA-19 Archive retention & restore | Purge won't delete Drive originals; staging restore keeps newer denial/deletion | 06 |
| QA-20 Device and language | Real mobile + desktop, ID/EN, 200% zoom/focus/status tested | 04,06 |
| QA-21 Backup, deployment, load | Verified staging rollback, worker, restore, metric/alert and PRD load report | 06 |

## Verification by type

| Change | Minimum checks |
|---|---|
| Documentation only | Broken Markdown links, epic IDs A01–A05, consistency and examples; no runtime claims |
| Domain/validation | Fast unit cases for normal and boundary/denial states |
| Transaction/persistence | Real PostgreSQL constraints, rollback, duplicate request, concurrent barrier/race |
| API/auth | HTTP shape, sanitized denial/CSRF/origin, current principal+tenant scope, revoked session |
| Gallery/UI | Browser interaction and error recovery, pending vs saved, locale/keyboard, supported viewport |
| Provider/worker | Synthetic contract + approved dedicated-provider proof, lost lease, retry and bounded resources |
| Staging/production | Health, log redaction, least privilege, real backup restore, rollback, load and device matrix |

## Suggested Windows checks

Use scripts actually declared in the target `package.json`; example compatible Snappik clone:

```powershell
npm run typecheck
npm test
npm run test:db
npm run build
npm run test:smoke
pwsh -NoProfile -File docs/tools/validate-docs.ps1
```

Provider auth, recovery and browser commands may have their own dedicated test scripts; inspect `package.json` and execute only relevant suites. CI passing is evidence **only for the commands actually executed**, on that exact commit/environment.

## Completion record (short template, not a growing history)

```text
Epic: EPIC-XX | Result: Done / In progress / Blocked
Commit/branch/worktree: ...
Delivered user-facing path: ...
Evidence: [command or test run + environment + pass/fail]; [browser/provider proof if required]
Known limitation / dependency: ...
Contracts updated: ...
Next useful slice: ...
```

Keep run logs outside `PROJECT_STATE.md` and link them from PR/issue/CI or a single bounded evidence artifact. When result uncertain, report `Not run` or `Blocked`, not `Passed`.

Current local EPIC-02 assertions and exact verification commands are recorded once in [EPIC-02 evidence](EPIC-02-EVIDENCE.md). Gallery revocation is verified through the actual shared PostgreSQL grant-policy repository with synthetic stored grants; actual public client access/issuance and draft HTTP/DB/browser evidence are recorded in [EPIC-04 evidence](EPIC-04-EVIDENCE.md). Ready/failed inventory projections are explicitly seeded test data, never provider scan evidence.

Local EPIC-03 assertions and commands are recorded in [EPIC-03 evidence](EPIC-03-EVIDENCE.md). Tests exercise actual fenced PostgreSQL publication, protected owner HTTP media and a real worker/Chromium journey using generated colors. Public-only protocol fixtures additionally cover missing parent metadata, current parent-list membership, encrypted allowlisted configuration, expiry and the second authorization after provider waits. Live checks are an explicit opt-in command with private configuration and aggregate-only reporting; they do not close resource-key-required/actual ACL revocation/hidden-child/key-policy or hosted-storage acceptance.

Local EPIC-05 transaction, HTTP and Chromium results are recorded in [EPIC-05 evidence](EPIC-05-EVIDENCE.md). The suite exercises independent DB connections, identical/different-key races, rollback, immutable history, reopen/reconfirm, exact CSV, grant separation and transfer interruption/revocation. Generated-source and injected-failure tests do not establish live Google ACL behavior or hosted delivery.

## Documentation validator limitations

Local EPIC-06 execution and release procedures are recorded in [EPIC-06 evidence](EPIC-06-EVIDENCE.md). Its PostgreSQL/HTTP tests cover actual TOTP proof, scoped permissions, replay/races, immutable audit/rollback, suspension/revocation and an encrypted DB/private-preview round trip into quarantined isolated storage. Browser checks cover the operator surface and lost replies. The pilot-capacity command seeds explicitly synthetic 10-studio/100-project/1000-photo/4-folder data and 50 active hashed grants, measures real HTTP reads/save/confirm/reopen and reports sample counts/p95/worker RSS/pools; it does not measure provider regeneration, hosted capacity or real-device behavior. CI configuration alone is not a hosted execution record.

`docs/tools/validate-docs.ps1` checks Markdown links, fenced JSON, epic links and common mandatory docs. It **cannot** prove requirements are semantically consistent, API implementation matches docs, secrets are absent, backend behavior works or release readiness. Review those separately, especially after any change to source provider, schema, access rules or limits.
