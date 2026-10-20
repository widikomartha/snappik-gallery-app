# EPIC-01 local acceptance record

**Result:** In progress; local implementation and D-01 production-mode protocol verified; hosted/inbox/custody acceptance remains open. **Environment:** Windows, PowerShell 7.6.5, Node 24.18.0, npm 11.16.0, PostgreSQL 18.4 native server, Next.js 16.4.2, Better Auth 1.7.11, Nodemailer 10.1.7, Playwright 1.64.1 Chromium. Latest D-01 work: 20 October 2026, `main` based on `cc14c37`, uncommitted. Original local acceptance below dates to 19 October; it remains historical evidence where not rerun.

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

## D-01 production adapter verification — 20 October 2026

The owner approved retaining verified-email/password with optional owner TOTP, single-use backup codes, no support bypass and owner-configured SMTP. No live SMTP/provider account, domain, deployment or credential was configured. No new migration: the existing provider namespace/UUIDs, password/factor triggers, studio membership and trial persist across mode changes.

Re-run commands after building:

```powershell
npm run typecheck
npm test
npm run build
npm run test:db
npm run test:auth:production
npm run test:browser
npm run test:gallery
npm run test:operations
npm audit --omit=dev --audit-level=high
pwsh -NoProfile -File docs/tools/validate-docs.ps1
git diff --check
```

The production harness creates an isolated PostgreSQL cluster, seeds a real local account/studio, then switches that same database/secret to two separate production Next.js processes behind a local HTTPS reverse proxy. A generated test CA is trusted only by the fixture processes; certificate verification stays enabled for protocol requests/SMTP. Chromium explicitly tolerates the synthetic local HTTPS certificate. SMTP delivery uses a real authenticated TLS server in memory with synthetic recipients, rejection and downgrade/certificate cases. Test clusters are stopped and retained privately; no development DB reset or external request is involved. Initial sandboxed native startup and one Windows generated-output build failed; native checks/build were rerun outside the sandbox. Fixture bugs involving SMTP listen events, Fetch metadata rewriting and a button label were corrected before the final run.

| Boundary | Executed assertion |
|---|---|
| HTTPS + continuity | Secure/HttpOnly/host-only owner cookies; Strict/Secure gallery grants behind HTTP upstream; same provider UUID/studio/trial after local-to-production switch; no schema remap |
| Access + callbacks | Noninvited signup does not create/deliver; removal denies existing owner session; bad Host/Origin, cross-site API fetch and foreign/credential-bearing callbacks denied; external-inbox verification/reset navigation accepted |
| SMTP + retry | TLS/authenticated verification and recovery; rejected signup mail returns 503, repeat recovers one account; production leaves local mailbox empty; valid STARTTLS works, stripped STARTTLS/untrusted certificate deliver nothing |
| Shared throttle + restart | Concurrent account attempts across two processes enforce 5 mail attempts/minute; 60-route ceiling includes rotating unknown identities/spoofed IPs; counts persist after both processes restart; HMAC keys omit email |
| MFA + revocation | Real TOTP enrollment; one winner for concurrent backup-code/reset reuse; reset preserves factor/studio/trial; old cookies denied across processes/restart; logout copied cookie denied |
| Browser + logging | HTTPS signup/email verification/login/onboarding/logout/recovery UI; recovery token stripped from browser URL; production inbox copy; no delivered URL or SMTP credential in captured web output |

HTTP success means SMTP acceptance, not inbox arrival. Unknown acceptance may duplicate mail after retry. Conservative serialized auth is a bounded pilot policy, not measured hosted throughput. Existing local DB fault injection remains the proof of rollback/uncertain-storage handling.

**Latest observed results:** typecheck and build passed; 4 unit cases, 14 foundation/project DB/HTTP groups, 6 production-auth groups, 6 gallery groups and 4 operator/recovery groups passed. The local Chromium auth journey passed. Production-dependency audit reported zero vulnerabilities; documentation validation passed (20 Markdown files, 55 relative links, 3 JSON examples) and `git diff --check` passed. CI includes the production suite after Chromium installation; remote CI was not run. No commit/deployment or managed development DB change occurred.

## Original local acceptance scope

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
- At original local acceptance only loopback mode was enabled. D-01 subsequently added production-mode transport as described above; no real external account, provisioning or deployment occurred.

**Residual blocker:** D-01 still needs the approved live SMTP account/sender and HTTPS target, named secret/key custody/rotation owner, real inbox/browser delivery and hosted proxy/log/least-privilege DB/restart/migration proof. Policy approval and local protocol success do not close this operational gate. The full epic remains `In progress`.
