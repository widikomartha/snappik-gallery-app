# Documentation map — progressive disclosure

**Do not read every file by default.** Startup is `../AGENTS.md` + `PROJECT_STATE.md` + `BACKLOG.md`. Read additional files only for the current task. Most files define *target behavior*, not claims about existing application functionality.

| Task | Additional documents |
|---|---|
| Epic planning / product scope | `PRD.md`, `BUSINESS_RULES.md`, `DECISIONS.md` |
| EPIC-01 — foundation/auth | `ARCHITECTURE.md`, `DATABASE.md`, `API.md` (auth + owner), `SECURITY.md`, `QUALITY.md` |
| EPIC-02 — projects | `BUSINESS_RULES.md` (project/entitlement), `DATABASE.md`, `API.md` (owner), `DESIGN.md`, `QUALITY.md` |
| EPIC-03 — Drive/media | `ARCHITECTURE.md` (inventory), `DATABASE.md`, `API.md` (media), `SECURITY.md`, `DECISIONS.md` |
| EPIC-04 — gallery/selection | `BUSINESS_RULES.md` (access/selection), `API.md` (client), `DESIGN.md`, `QUALITY.md` |
| EPIC-05 — confirmation/results/download | `BUSINESS_RULES.md` (confirmation), `DATABASE.md`, `API.md`, `SECURITY.md`, `QUALITY.md` |
| EPIC-06 — operators/release | `SECURITY.md`, `QUALITY.md`, `ARCHITECTURE.md`, `DECISIONS.md` |
| Bugfix | Actual changed code/test + owning contracts only |
| Docs edit | Owning docs + affected references; run the docs validator |

**Responsibility boundary:** `PRD` = what; `BUSINESS_RULES` = rules; `API` = wire; `DATABASE` = durable state; `DESIGN` = user experience; `SECURITY` = protections; `QUALITY` = proof; `BACKLOG` = delivery; `PROJECT_STATE` = current observed progress; `DECISIONS` = unresolved external choices.

## Controlled updates

- Keep IDs limited to `EPIC-01` ... `EPIC-06`. Use acceptance codes `A01` etc. *inside each epic* only; no separate microtask registry.
- For a behavioral change, update the owning rule plus affected API/database/design/quality sections **once**. Link rather than copy historical command logs.
- Keep `PROJECT_STATE.md` under about two printed pages. Put test artifacts in the actual test system, a PR, or commit summary—not in an ever-growing historical state file.
- A decision needs an owner, specific input/evidence, affected epic and a clear pending/approved state. Never silently convert a recommendation into approval.
- Archive superseded investigation output outside startup docs if historical evidence must be retained.
