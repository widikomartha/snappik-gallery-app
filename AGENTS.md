# Working rules for coding agents

Read **this file**, [`docs/PROJECT_STATE.md`](docs/PROJECT_STATE.md), and [`docs/BACKLOG.md`](docs/BACKLOG.md) before changing code. Then read *only* the relevant contracts listed in [`docs/README.md`](docs/README.md). Avoid loading the entire documentation tree for every request.

## Scope and evidence

- The user-selected epic defines the scope. A request for documentation does not authorize implementation, deployment, commits or external account actions.
- Inspect branch, worktree, actual code, migrations, scripts and test output first; preserve unrelated changes. `PROJECT_STATE.md` is an initial snapshot, **not live evidence**.
- Implement the smallest useful end-to-end slice **within that epic**. Internal plans/checklists are fine; do not proliferate persistent backlog items or speculative documents.
- Resolve ordinary local implementation details yourself. Ask only about decisions that materially change product scope, external access, cost, privacy, irreversible actions or production deployment. Record unresolved external choices in `DECISIONS.md` and proceed on independent work.
- Never call something implemented because it appears in a contract, or passed because a mock, fixture, note or screenshot exists.

## Contract authority

- [`PRD.md`](docs/PRD.md): scope and supported audience.
- [`BUSINESS_RULES.md`](docs/BUSINESS_RULES.md): behavior, limits and state transitions.
- [`ARCHITECTURE.md`](docs/ARCHITECTURE.md): design and module boundaries.
- [`DATABASE.md`](docs/DATABASE.md): persistence and transaction rules.
- [`API.md`](docs/API.md): externally observable HTTP contract.
- [`DESIGN.md`](docs/DESIGN.md): user flows, UI states, accessibility.
- [`SECURITY.md`](docs/SECURITY.md): access and threat boundaries.
- [`QUALITY.md`](docs/QUALITY.md): acceptance and verification.
- [`BACKLOG.md`](docs/BACKLOG.md): six epics and dependencies.

When contracts conflict, report the discrepancy, use the owning document to resolve the matter, and update affected references **together**, without rewriting source code merely to hide the problem.

## Non-negotiables

- Separate owner, client and platform-operator principals; scope every data read/write server-side by studio/project.
- Use stable provider file IDs, not filenames, for identity; keep original filenames and folder paths for display/export.
- Selection uses expected revisions; confirmations are immutable; unknown results/retries cannot silently erase acknowledged data.
- Main-selection and original-download permissions are independent. Share URL possession is not owner authorization.
- No secrets, client photographs, real login credentials, private gallery URLs or raw sensitive notes in fixtures, prompts, docs, commits or logs.
- No unapproved provider consent, paid provisioning, database destruction, production deployment or account changes.

## Finish each epic

Verify meaningful success, denial, retry and concurrency cases with the **actual boundaries changed**. Run relevant available checks and `pwsh -NoProfile -File docs/tools/validate-docs.ps1`; review the diff; update `PROJECT_STATE.md` and the single epic's status in `BACKLOG.md`; provide concise evidence and residual blockers. If incomplete, keep status `In progress`/`Blocked`, not `Done`.
