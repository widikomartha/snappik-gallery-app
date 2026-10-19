# Snappik Studio

Fresh-build TypeScript application for the six-epic photography studio MVP. EPIC-01 provides a **local-only** owner workspace with Better Auth email/password verification, authenticator MFA and backup codes, password recovery, PostgreSQL studio onboarding/settings/trial, health checks and a foundation worker. EPIC-02 adds DB-backed projects, workflow configuration, quota-safe archive/restore, link rotation, search/filtering and a dashboard. EPIC-03 adds bounded local generated inventory, fenced worker jobs, retry-safe sync/cancel and protected owner previews. An allowlisted public-only Drive adapter supports the separately approved local source/cache; remaining provider edge cases and hosted-media verification remain gated. Client gallery and operator flows belong to later epics.

Production authentication remains gated by **D-01** in [decisions](docs/DECISIONS.md). Only loopback HTTP and loopback PostgreSQL are accepted. There is no test-login endpoint, external email service, provider consent or deployment configuration.

## Windows setup

Use PowerShell 7+, Node **24.18.0** and npm **11.16.0**. Versions are pinned in [.node-version](.node-version), [package.json](package.json) and [package-lock.json](package-lock.json). Stop this application's running web/worker/database processes before reinstalling dependencies on Windows, where running executables cannot be replaced.

```powershell
npm ci --no-fund --no-audit
npm run setup:local
npm run db:local
```

Keep that terminal running. The generated database uses PostgreSQL **18.4** binaries from the development dependency, listens only on `127.0.0.1:55432`, and persists under `.local/postgres`. Setup creates random private configuration in `.env.local` only when absent. It never overwrites existing configuration or resets a database.

In a second terminal:

```powershell
npm run db:migrate
npm run dev
```

In a third terminal:

```powershell
npm run worker
```

Open [local studio login](http://127.0.0.1:3000/login). Register using a synthetic email address and a password of 12–128 characters. Retrieve the private local verification link on this computer:

```powershell
npm run mail:local -- owner@example.test
```

Open that link, sign in and complete onboarding. The same CLI retrieves recovery links requested through `/recover`. **Treat the displayed links as credentials:** the CLI is the intentional local delivery surface; never capture them in logs, screenshots or documentation. Mail is encrypted at rest, expires after 30 minutes and has no HTTP read endpoint. The worker removes expired mail. `.env.local` and `.local` are private development files and are excluded from Git; protect them with your local OS account permissions.

Use `/account` to enroll an authenticator. Save backup codes privately before confirming enrollment. Password reset revokes old sessions and pending MFA challenges while retaining the enrolled factor and studio data. Losing both the authenticator and every backup code has no implemented support bypass; the production recovery policy remains a D-01 decision.

`/health/live` checks the web process; `/health/ready` verifies database access and migration checksums, with a separate recent worker-heartbeat state. Web readiness alone does not assert that a worker is running. The worker handles heartbeat/expired local mail and, when explicitly configured, inventory jobs. Default `INVENTORY_ADAPTER=disabled` leaves provider jobs pending.

Use `/app/projects` to create and manage projects. Omitted configuration inherits a saved studio-default snapshot; passwords/deadlines are independent per workflow. The source form accepts a Drive folder ID or a standard folder link, but **only ID syntax is checked locally**. With the default disabled adapter, inventory jobs remain pending until local source activation. For local generated colors only, set `INVENTORY_ADAPTER=synthetic` in the private `.env.local`, restart the worker, and use `synthetic-folder-00001` as the source. This opt-in fixture publishes three previews (including duplicate filenames in different folders), explicit skip counts and a synthetic label. Owner detail offers sync/retry/cancel and retains the previous complete inventory on failed scans. Other roots fail safely under the synthetic adapter. For approved local public-only access, privately set `GOOGLE_DRIVE_APPROVED_ROOT_ID`, `GOOGLE_DRIVE_LOCAL_CACHE_APPROVED=true` and a temporary `GOOGLE_DRIVE_API_KEY` in `.env.local`, then run `npm run drive:configure-local`. The CLI encrypts the key (and optional `GOOGLE_DRIVE_ROOT_RESOURCE_KEY`), removes plaintext entries and selects `INVENTORY_ADAPTER=google_public`. Keep the existing local encryption secret private; replacing it requires resealing the provider key. Restart web and worker. Only that root may sync; removing cache approval or encrypted credentials denies public previews. Public previews expire after seven days and always recheck live source membership/visibility/version plus current local authorization. `npm run drive:verify-live` explicitly opts into a live scan in an isolated local database and prints aggregate evidence only; CI never calls it. Local caching was approved on 20 October 2026. Remaining provider edge cases/key policy (D-02), hosted private media (D-03), and public client-gallery flows are still pending. An uncertain create response offers an identical retry; if that page was closed or reloaded, review the saved project list before creating again. Existing local databases need `npm run db:migrate` after starting the database; migrations are additive and do not reset data.

## Verification

See the [EPIC-01 acceptance record](docs/EPIC-01-EVIDENCE.md), [EPIC-02 acceptance record](docs/EPIC-02-EVIDENCE.md) and [EPIC-03 evidence](docs/EPIC-03-EVIDENCE.md) for exact commands, tested boundaries and remaining gates. Tests create new isolated PostgreSQL clusters under `.local/tests` and run a real production Next.js HTTP server. They never reset the development database. Test clusters persist privately after shutdown; no automatic database destruction is performed. Browser screenshots contain only synthetic workspace information and empty login forms under ignored `test-results/`.

The [Windows CI workflow](.github/workflows/ci.yml) installs from the lockfile and runs validation, build, PostgreSQL/HTTP, Chromium and documentation checks. It is configured, not evidence of a hosted run.

## Contracts

Start with [AGENTS.md](AGENTS.md), [project state](docs/PROJECT_STATE.md), [backlog](docs/BACKLOG.md) and the task-specific [documentation map](docs/README.md). The original specification was independently authored from public Snappik documentation; this fresh build imports no original repository source. No Git repository or remote existed in this target folder at adoption.
