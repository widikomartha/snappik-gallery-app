# Current project state

**Inspected:** 19 October 2026. **Mode:** `fresh-build`. Target folder originally contained only documentation; no application, migrations, lockfile or Git metadata existed. No source was copied from the original repository.

| Field | Actual value |
|---|---|
| Mode / repository URL | Fresh build in the selected workspace; local Git repository initialized at the owner's request; no remote configured |
| Branch + HEAD + dirty changes | `main`; initial EPIC-01 delivery commit (see `git log` for identity and `git status` for current changes) |
| Verified running features | Local registration/verification/login/logout, TOTP MFA/backup codes, recovery preserving factor/studio, transactional onboarding and repair, studio/settings revisions, current trial, health/readiness and foundation worker |
| Current epic | EPIC-01 — Foundation & Authentication |
| Epic status 01 / 02 / 03 | In progress (local slice verified; D-01 open) / Not verified / Not verified |
| Epic status 04 / 05 / 06 | Not verified / Not verified / Not verified |
| Relevant checks last run | See [EPIC-01 acceptance record](EPIC-01-EVIDENCE.md); real PostgreSQL + production Next.js HTTP + Chromium, synthetic identities only |
| External gates | D-01 production auth remains open; D-02/03/04 unchanged |
| One next concrete action | Owner selects production auth/recovery mode and authorizes the dedicated D-01 verification environment |

**Blocker:** D-01 lacks approved production provider/email/recovery/HTTPS/key-custody configuration and deployment-mode proof. The local adapter deliberately rejects non-loopback deployment. Local passing tests do not close this gate or complete the epic.

Current foundation uses Node 24.18.0/npm 11.16.0, Next.js 16.4.2, React 19.2.7, Better Auth 1.7.11 and PostgreSQL 18.4. Owner principal maps to the provider's immutable UUID, never an email join. No client or operator authorization is implemented by an owner session. Entitlement usage is zero until project persistence is delivered in EPIC-02. No external accounts, provider consents, hosted resources or deployments were changed.
