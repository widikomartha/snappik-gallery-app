# Implementation backlog — SIX epics only

**Status:** EPIC-01 is `In progress` with a verified local slice and open D-01 gate; EPIC-02 is `Done` for its local project-lifecycle scope; EPIC-03 is `Blocked` on remaining provider edge-case/key-policy and hosted-media proof; EPIC-04 is `In progress` with local gallery/selection implementation and physical-phone verification outstanding; EPIC-05 is `Blocked` after local implementation, pending D-02/D-03 download proof; EPIC-06 is `Blocked` after local operator/security/recovery/capacity implementation, pending the authorized pilot release gate. **No microtask registry.** A coding agent reports completion against these **six** user-visible outcomes. Historical work from an existing Snappik clone is not automatically accepted as current proof.

## At a glance

| Epic | Outcome | Depends on | Done when |
|---|---|---|---|
| **EPIC-01** Foundation & Authentication | Owner securely enters a durable studio | No prior epic; D-01 for production | Local auth/onboarding works, error/retry boundaries tested |
| **EPIC-02** Studio & Project Management | Owner reliably manages project lifecycle | EPIC-01; may use synthetic session for nonproduction implementation | DB-backed projects, quota, archive/restore, dashboard |
| **EPIC-03** Google Drive & Media | Projects show accurate provider-backed photo inventory | EPIC-02; D-02 live provider, D-03 hosted media | Complete scans, source/thumbnail errors and permissions tested |
| **EPIC-04** Client Gallery & Selection | Client can browse and save current draft | EPIC-02 + EPIC-03 contract; synthetic inventory allowed until live adapter | Authorized gallery + revisioned selection + notes |
| **EPIC-05** Confirmation, Results & Downloads | Studio receives immutable exact result; download grant works | EPIC-04; EPIC-03 for originals | Confirmation/reopen/export + authorized original download |
| **EPIC-06** Operations, Security & Pilot Release | Safe, observable staging/pilot system | EPIC-01..05; D-01/02/03/04 | Operator controls, security/E2E/restore/load and staging evidence |

`In progress` means a bounded slice is being developed. `Blocked` means a named external dependency prevents an *essential acceptance row*, but independent slices may continue. `Done` means **all** required acceptance assertions have actually passed; a prototype or synthetic adapter cannot finish an epic requiring real-provider proof.

---

## EPIC-01 — Foundation & Authentication

**Status: In progress.** Local foundation plus the owner-approved Better Auth email/password, optional TOTP/backup-only recovery and TLS SMTP production adapter are implemented. Two-process HTTPS/PostgreSQL/SMTP/Chromium protocol checks cover shared throttles, continuity and revocation; see the [A01–A05 acceptance record](EPIC-01-EVIDENCE.md). The single residual D-01 gate is approved live SMTP/hosted configuration, key custody and actual inbox/host/DB-role proof; no production readiness is claimed.

**Outcome:** a verified owner can login, create/repair exactly one studio, see current entitlement, logout and recover access without losing acknowledged studio data.

**In scope:** reproducible Windows setup, TypeScript app/web/worker skeleton or reuse, migrations and constrained DB repositories, authenticated session transport, password/MFA/recovery per approved mode, onboarding, owner settings and trial, basic system observability/health, build and CI.

**Acceptance criteria**

- **A01** Fresh clean checkout installs/builds on pinned runtime, local DB migrations apply repeatably, worker/web start, and health/readiness are truthful.
- **A02** Verified user -> onboarding creates one studio, membership, settings and **168-hour / 3-project trial**; concurrent repeats and transaction failure neither duplicate nor reset grant.
- **A03** Owner login/refresh/logout/expired+revoked session follows server state, and protected API denies copied cookies after logout; uncertain storage does not claim success.
- **A04** Password recovery and MFA follow approved semantics; expired/reused/concurrent tokens and session/factor races are covered; stored business data is preserved.
- **A05** Suspended/absent/unverified/cross-origin/cross-tenant principals receive correct denial; synthetic tests are explicitly distinguished from production proof.

**Important constraints:** do not replace a working authentication foundation from an existing clone; never expose local test-login as a public endpoint. D-01 can remain open while local app-side work proceeds, but **production** acceptance cannot pass until its gate closes.

**Evidence:** build/typecheck, isolated PostgreSQL race tests, real HTTP auth/onboarding tests, browser login/logout/setup, provider/HTTPS/recovery tests for deployment mode. Capture exact commands and environment only once in implementation evidence, not copied across docs.

## EPIC-02 — Studio & Project Management

**Status: Done (local project lifecycle).** A01–A05 verified through PostgreSQL, authenticated production-build HTTP and Chromium; see [EPIC-02 evidence](EPIC-02-EVIDENCE.md). Sources remain explicitly pending provider validation/indexing until EPIC-03; client routes and production release are not claimed.

**Outcome:** owner can create a real DB-backed project, configure selection/download workflows, see inventory status, search/list, archive and restore under correct quotas.

**In scope:** owner dashboard/list/detail/create/edit, tenant isolation, entitlement evaluation, workflow password/deadline/quota configuration, default snapshots, idempotent creation, archive/restore, link rotation, canonical job/status projection.

**Acceptance criteria**

- **A01** Create writes project/workflows/selection set/audit/inventory job atomically; loss of HTTP reply + same idempotency key produces **one** project, not duplicates.
- **A02** Trial permits three non-archived projects; competing fourth creates cannot bypass limit; expired entitlement blocks writes but not allowed owner read/export/archive/revocation.
- **A03** Config revisions reject stale edits; omitted deadlines remain unchanged; optional phone never blocks core creation; main quota 1..500, at least one workflow enabled.
- **A04** Archive immediately revokes client access, frees active quota; restore within 30 days preserves original deadlines/history while verifying current quota and entitlement.
- **A05** Owner can distinguish `pending/ready/failed` source state, and cross-studio IDs yield no data in list, detail, edit, jobs or exports.

**Evidence:** API/browser journey, actual PostgreSQL idempotency/quota races, grant and archive tests, fresh+stale revision checks. Live Drive indexing is not needed to complete **project lifecycle** assertions; use an explicit pending job until EPIC-03 integration.

## EPIC-03 — Google Drive & Media Processing

**Status: Blocked.** Local bounded scans, fenced worker/retries/cancellation, atomic generations, protected previews and owner inventory controls are verified. The owner selected public-only access, supplied an approved public root/key and approved local preview caching on 20 October 2026. Local public-source activation is allowlisted with encrypted credentials, current provider membership/version checks, repeated owner authorization and seven-day cache expiry. A real scan published all 100 visible photos with 100 ready previews; authenticated HTTP denial/expiry cases and real pagination passed. A05 still requires key-required/actual ACL revocation/limited-child and key-policy evidence (D-02), plus hosted-media evidence (D-03). See [EPIC-03 evidence](EPIC-03-EVIDENCE.md).

**Outcome:** a valid project can sync an approved Drive folder and show safe, accurate, permission-checked previews without losing the previous complete inventory on failure.

**In scope:** provider access/credential lifecycle after D-02, validated source IDs/root, bounded pagination/nesting, inventory generations, MIME/size checks, provider resource keys, changed/unavailable photos, real job processing and safe thumbnails/private derived storage, sync/retry/cancellation.

**Acceptance criteria**

- **A01** Authorized fixture root/children traverse predictably; duplicate filenames preserve distinct provider IDs and folder paths. Unsupported/trashed/oversize items produce explicit skip counts; 5,000-image/depth-10/50 MiB ceilings fail visibly rather than truncating silently.
- **A02** Incomplete/cancelled/permission-lost scans retain the last complete generation and selected references; only completed generation marks missing photos unavailable.
- **A03** Worker crash, lease loss, duplicate processing, 429/rate hints and retry exhaustion yield deterministic auditable outcomes without duplicate publication.
- **A04** Thumbnail/media endpoints recheck current grants and tenant, bound decoder/transfer resources and never publish a public derived bucket or arbitrary fetch URL.
- **A05** Dedicated approved Google Drive fixture tests prove supported access mode, folder visibility, resource keys/revocation and credential/cache compliance; hosted media constraints require relevant D-03 evidence.

**Evidence:** adapter contract fixtures **plus** provider test root and hosted media evidence for production. Do not treat a synthetic Drive adapter as acceptance of A05. When blocked on consent/provider config, complete offline processing and leave the epic `Blocked` or `In progress`, not `Done`.

## EPIC-04 — Client Gallery & Photo Selection

**Status: In progress.** Independent client access, protected gallery/viewer, shared revisioned draft and explicit conflict recovery are implemented locally. See [EPIC-04 evidence](EPIC-04-EVIDENCE.md) for executed checks. Physical-phone touch/accessibility verification remains the single acceptance blocker; desktop Chromium emulation cannot prove it. Confirmation and original downloads remain EPIC-05.

**Outcome:** an account-free client passes main access, browses a responsive gallery and persists an exact shared draft with notes and concurrency recovery.

**In scope:** public bootstrap, independent workflow grants, optional passwords/deadlines, protected paginated gallery/folders/viewer/thumbnail, locale/theme and accessibility, shared selection, notes, quota, pending/saved/conflict states.

**Acceptance criteria**

- **A01** Unknown/rotated/expired share links reveal no photos; main-password and download-password grants remain independent; expiry equality, suspension, archive and workflow disable deny.
- **A02** Client browses root/child folders, expands images and selects independently by **stable photo ID**, including same-named files; responsive 360/768/1440, keyboard and meaningful mobile interactions work.
- **A03** Draft saves full unique item set up to maximum quota, validate photo availability, note at 500 Unicode code points accepted and 501 rejected; persisted draft survives refresh.
- **A04** Two-tab stale revision returns 409 with no silent overwrite; UI preserves pending intent as unsaved and allows deliberate conflict recovery; failed/uncertain save cannot be labeled `Saved`.
- **A05** Confirm control is blocked while saves are pending/failed, and correct messages render in Indonesian and English without exposing raw provider errors.

**Evidence:** browser flows with actual API/DB; boundary and denial tests with separate tenant and grant; real phone for final accessibility/device claims. Synthetic Drive metadata may power gallery until EPIC-03 live integration, but final combined E2E is required in EPIC-06.

## EPIC-05 — Confirmation, Results & Downloads

**Status: Blocked.** Local atomic confirmation/idempotency, immutable history, owner results/CSV/reopen and separately authorized bounded original delivery are implemented and verified. See [EPIC-05 evidence](EPIC-05-EVIDENCE.md). A05 still requires real-provider edge cases and hosted original-transfer proof under D-02/D-03; synthetic sources cannot close this gate.

**Outcome:** client locks an exact selection, owner gets a reliable immutable result and can intentionally reopen; client original download works only under its separate grant.

**In scope:** server atomic confirm/idempotency, history, owner reopen with reason, result dashboard, exact CSV/copy, download grant and validated bounded original streaming.

**Acceptance criteria**

- **A01** Confirm validates saved current revision/eligible items/quota, creates exactly one immutable snapshot and locks further client edits; concurrent save/confirm races have defined outcomes.
- **A02** Identical idempotency retry recovers original confirmation after lost response; different request/key cannot create a second confirmation while locked.
- **A03** Owner reopen retains choices and old snapshots, increments draft revision; reconfirm produces a **new** immutable snapshot. Expired owner cannot reopen.
- **A04** Owner copy/CSV includes stable IDs, original filenames (with case/extensions), folder paths, notes, snapshot revision; CSV spreadsheet formula values are escaped safely.
- **A05** Valid download grant can stream eligible source independently of selection; main-only/expired/revoked grants cannot. Missing file/permission loss/timeout/oversize/cancellation are reported honestly without partial-success claims.

**Evidence:** actual DB transaction/race tests; CSV fixture with duplicate name and formula string; real Drive source + streaming tests after D-02/03. Report outstanding provider verification rather than marking download fully done from mock output.

## EPIC-06 — Operations, Security & Pilot Release

**Status: Blocked.** Separately authorized operator UI/API with fresh actual TOTP, audited/idempotent grants/suspend/reactivate, restricted diagnostics/metrics, encrypted local DB/private-preview backup and quarantined isolated restore, source packaging and measured synthetic pilot load are implemented. See [EPIC-06 evidence](EPIC-06-EVIDENCE.md). The single residual gate is authorized pilot release evidence: approved D-01..D-04, newer deletion/revocation reconciliation and retention/purge, real-device and hosted operation/rollback proof. No deployment or real operator assignment occurred.

**Outcome:** the app is operable and ready for a controlled, authorized pilot, with documented restore/revocation and cross-principal denial evidence.

**In scope:** restricted operator views/grants/suspend/reactivate, audit/metrics, privacy/retention, access and vulnerability tests, localization/device pass, source+object backup and restore, capacity measurement, release/rollback and staging deployment.

**Acceptance criteria**

- **A01** Platform operator needs separate permission and fresh MFA; support diagnostics exclude gallery content by default. Grants/suspension need bounded reason and atomic audit; owner never self-grants operator rights.
- **A02** Cross-tenant, gallery authorization, CSRF/SSRF, token logs, XSS, upload/media size, expiry/revocation and critical transaction races pass realistic tests.
- **A03** Archive retention/purge rechecks and isolated database/object restore prove that **newer revocations/deletions are re-applied** before recovered galleries reopen; backup encryption/access policy verified.
- **A04** Real device/keyboard/accessibility/locales and selected pilot load fixture measured; report p95, warm/cold gallery, worker memory/DB pools/provider limits rather than claiming arbitrary SLA.
- **A05** Staging deployment, migration, restart, worker recovery, monitoring/alerting, secret log redaction, release ownership and rollback procedure are verified; D-01/02/03/04 approved and no severe untriaged defect.

**Evidence:** staging URLs only in private authorized records, timestamped build/commit/migration identity, real run artifacts, security/restore matrix and measured load. No approval to deploy merely because this epic exists.

---

## Agent execution protocol (keep the backlog small)

**Request pattern:** `Implement EPIC-04 against the existing repository. Read AGENTS.md, PROJECT_STATE.md, BACKLOG.md and the task-specific contracts. Build the smallest complete vertical slices within this epic, verify them and update only its single status row. Do not create new epics or implement deferred features.`

1. Audit existing implementation and determine what portion of the epic is genuinely missing.
2. Write a brief **ephemeral** plan (3–7 internal steps); do not create permanent fine-grained tasks/docs unless user explicitly asks.
3. Implement each slice with its denial/retry tests; avoid mock-only “Done” claims.
4. Run applicable tests and doc validation. Review changes/permissions and update the epic to `Done` only when all A01–A05 pass for the declared environment; otherwise retain `In progress`/`Blocked` with a **single concise blocker** in `PROJECT_STATE.md`.
5. Continue with next epic or request missing authorization only for externally consequential decisions.

**Excluded future features** are owned by a future scope decision, not by a hidden seventh epic. These six epics constitute the complete MVP backlog.
