# EPIC-01 local acceptance record

**Result:** In progress; local implementation verified, production D-01 open. **Environment:** Windows, PowerShell 7.6.5, Node 24.18.0, npm 11.16.0, PostgreSQL 18.4 native server, Next.js 16.4.2 production HTTP server, Better Auth 1.7.11, Chromium 156 through Playwright 1.64.1. Date: 19 October 2026. Adoption had no Git metadata; the owner subsequently requested an initial delivery commit on `main`. Use `git log` for its identity.

## Reproduce

From the workspace root, with this application's processes stopped for the Windows reinstall:

```powershell
npm ci --no-fund --no-audit
npm run typecheck
npm test
npm run build
npm run test:db
npx playwright install chromium
npm run test:browser
pwsh -NoProfile -File docs/tools/validate-docs.ps1
```

The test harness creates a new PostgreSQL cluster with generated credentials, applies the committed migrations and starts Next.js with isolated configuration. It uses separate PostgreSQL connections and concurrent real HTTP requests. No test-login endpoint or mocked session provider is used. The browser's deliberately injected failed-save response tests UI recovery only; durable failure/rollback claims come from PostgreSQL trigger fault injection in the integration suite.

**Observed results:** lockfile reinstall, typecheck and production build passed; 3 validation tests and 9 PostgreSQL/HTTP test groups passed; the Chromium journey passed; documentation validation passed (15 Markdown files, 24 relative links, 3 JSON examples). Source/migrations and changed contracts were reviewed directly during implementation; the initial delivery's staged diff was reviewed after Git initialization.

## Acceptance scope

| Row | Local evidence | Production limitation |
|---|---|---|
| A01 | Lockfile install, TypeScript/build; repeated/concurrent migration application and checksum-tamper refusal; real web liveness/schema readiness and separate worker heartbeat | No shared-environment least-privilege or hosted restart proof; CI configured but not remotely run |
| A02 | 24 simultaneous onboarding requests create one studio/member/settings/trial; lost-response retry returns saved result; injected trial-write failure rolls back; dependency repair preserves original trial; exact 168 hours and 3-project limit | Project usage is zero by construction until EPIC-02, not a tested quota implementation |
| A03 | Real login and session refresh; copied cookies denied after logout/expiry/revocation; failed session deletion returns 503 and retry works; failed local-mail persistence returns 503 and same registration retry recovers one account | HTTPS, real delivery/callback infrastructure and distributed deployment proof pending |
| A04 | Real password reset, token expiry/single use/concurrent reuse, reset-write rollback and old-password login race; factor proof required; backup-code replay/concurrency; failed factor disable rolls back; reset preserves factor and business data, revokes sessions and pending MFA proof | No external recovery delivery or approved support recovery policy; no bypass for lost factor plus lost backup codes |
| A05 | Absent/unverified/suspended principals denied; suspended `/me` hides operational studio data; foreign/missing Origin, oversized/unknown fields, tenant-ID injection and unknown owner IDs denied; local throttling exercised | Synthetic identities only; no production security certification or provider acceptance |

Chromium exercises registration, actual encrypted local-mail verification, login, onboarding, refresh, studio settings, two-tab revision conflict with retained intent, failed-save intent, logout, authenticator enrollment/backup login, password recovery with MFA preserved, keyboard focus and 360/768/1440 layout checks. Empty-login and synthetic workspace screenshots are generated in ignored `test-results/`; no credentials/factor secrets are captured. These are browser-emulated viewports, not real-device accessibility proof.

## Implementation constraints reviewed

- Numbered checksummed additive migrations; no web-startup DDL or reset command. App IDs are UUIDs; studio ownership and initial trial uniqueness have database constraints.
- Owner operations resolve membership server-side, lock and recheck the current verified session, and acknowledge only after commit. Studio/settings edits compare expected revisions. Onboarding retry never overwrites an already completed profile or renews a grant.
- Better Auth owns credentials and factors. A request-scoped adapter ensures direct plugin writes and nested provider operations share the same PostgreSQL transaction. Password/factor triggers revoke live sessions and pending MFA proofs. A separate single-connection advisory-lock gate serializes local auth transitions across processes; this conservative policy is not a production throughput design.
- Local outbox writes complete before HTTP success, after signup's provider transaction. Failure returns 503; retry of unverified registration recovers delivery without duplicating the account. Mail has no HTTP read endpoint; CLI is private local delivery.
- No cookie cache; server expiry/revocation is read from durable state. Cookie mutations require the configured Origin/Host; tokens stay in HttpOnly provider cookies. Application error logs contain only safe codes/correlation IDs; framework incoming-request logging is disabled. Hosting/edge log policy is unverified.
- Only loopback local mode is enabled. No external email/Drive account, paid provisioning, deployment, operator rights or later-epic functionality was added.

**Residual blocker:** D-01 needs owner approval and actual production-mode provider, email, HTTPS, MFA/recovery, shared throttling, key custody and migration/revocation evidence. The full epic must remain `In progress` until that gate is satisfied.
