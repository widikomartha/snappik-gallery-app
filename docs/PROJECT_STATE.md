# Current project state

**Inspected:** 20 October 2026. **Mode:** `fresh-build`. No source was copied from the original repository. Current evidence comes from the actual local checkout and tests, not target contracts.

| Field | Actual value |
|---|---|
| Mode / repository URL | Fresh build; local Git repository; no remote configured |
| Branch + HEAD + dirty changes | `main`; EPIC-02 delivery commit (see `git log` for identity and `git status` for current changes) |
| Verified running features | Local auth/MFA/recovery/onboarding/settings/trial; DB-backed project create/list/detail/config; dashboard; quota and entitlement; archive/restore; link rotation; source/job projections; health/readiness/foundation worker |
| Current epic | EPIC-02 — Studio & Project Management |
| Epic status 01 / 02 / 03 | In progress (D-01 open) / Done (local lifecycle) / Not verified |
| Epic status 04 / 05 / 06 | Not verified / Not verified / Not verified |
| Relevant checks last run | [EPIC-02 evidence](EPIC-02-EVIDENCE.md): typecheck, validation, production build, 14 PostgreSQL/HTTP tests, foundation + project Chromium journeys, docs validator and diff check |
| External gates | D-01 production auth, D-02 Drive, D-03 hosting/media and D-04 privacy remain open |
| One next concrete action | Select EPIC-03 and resolve D-02 for approved real-provider verification; independent fixture work remains possible |

**EPIC-02 outcome:** project/workflows/selection set/audit/pending inventory job/idempotency response commit atomically. Concurrent creates/restores respect current non-archived quota. Revisions reject stale edits; workflow omission retains deadlines/passwords; archive/rotation revoke through version checks and restore retains original deadlines/history. Owner screens expose the saved source state and use explicit pending-provider copy. Existing auth/settings browser flows still pass.

**Boundary:** local project lifecycle has no remaining acceptance blocker. Candidate Drive IDs receive syntax validation only; inventory jobs remain pending until EPIC-03 implements provider validation/scans. Ready/failed projections, selection records and grants in tests are explicit synthetic fixtures. The shared DB grant-policy repository is tested, but public client/grant issuance routes are not implemented. No photo processing, confirmation/results export, purge or deployment is claimed. Tests used isolated clusters. The additive `004_projects.sql` migration was subsequently applied to the managed local development database with checksums verified and existing data retained; its temporary process was stopped.

**Production blocker:** D-01 still lacks approved provider/email/recovery/HTTPS/key-custody configuration and deployment-mode proof. The local adapter rejects non-loopback deployment. EPIC-01 remains In progress; local EPIC-02 success does not close production or provider gates.

Runtime: Node 24.18.0/npm 11.16.0, Next.js 16.4.2, React 19.2.7, Better Auth 1.7.11, PostgreSQL 18.4. Owner identity maps to immutable provider UUID; no owner session grants client or operator rights. Entitlement usage now derives from persisted non-archived projects. No external accounts, provider consents, hosted resources or deployments were changed.
