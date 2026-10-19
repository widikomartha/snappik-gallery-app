# Decision gates — only consequential unknowns

These are explicitly **open** until a project owner approves the relevant choice and engineering verifies it. Technical preference is not permission to connect accounts, spend money, change private data or deploy. Independent synthetic/internal work is allowed to proceed.

| Gate | Needed decision / minimum proof | Blocks |
|---|---|---|
| D-01 Authentication production mode | Choose supported provider/mode and owner/recovery policy; verify protected browser login/logout/callback/email delivery/MFA, DB concurrency, durable revocation, shared throttles, HTTPS, key custody and migration compatibility | Production EPIC-01 and EPIC-06 |
| D-02 Google Drive source access | Decide studio OAuth vs public-only approach and acceptable scopes; dedicated synthetic root tests for nested/limited folders, resource keys, pagination, permission loss, cache rights, credentials/reconnect and quotas. Never escalate scopes silently | Real-provider EPIC-03, 05 |
| D-03 Hosting/storage/region/budget | Approve target cost, region/processors and provider; verify 50 MiB delivery limits, Linux worker, private bucket, provider path-log redaction, DB pool/lease recovery, backups/restore and source packaging | EPIC-06 staging/pilot, hosted media |
| D-04 Privacy/retention | Approve jurisdictions, processor list, privacy/support copy, retention, deletion/export procedure, retention backups and request identity verification | Public EPIC-06 |
| D-05 Brand | Approve original marks/assets before public marketing polish; fallback to text wordmark/system type for pilot | Branding polish only |

**Defaults until resolved:** TypeScript modular monolith, PostgreSQL, worker, adapter interfaces, local synthetic data, invitation-only pilot, system typography, **no** automatic payment/email provider/Drive connection/production provisioning. Do not embed speculative vendor endpoints or undocumented SDK behavior into core contracts.

## Recording a closed decision

For each gate: specify `status: Approved/Rejected/Still open`, approver, approval date, exact tested configuration and version, evidence path/run, tradeoff, ongoing operational owner, and affected contracts/epics. Update only the impacted authoritative docs, not every file. A gate is not closed by a comparative blog post, a passing mock, or a local-only success.

## Adoption decisions (not provider gates)

**Current adoption:** fresh-build, selected after inspection found only this documentation package in the target folder on 19 October 2026. Local implementation uses the pinned Better Auth adapter and private encrypted local email delivery; this is permitted independent local work, not approval of D-01. Project owner remains the decision owner for production provider, delivery and lost-factor recovery policy; approval/evidence are still pending.

- **Existing-repo mode:** audit code/migrations first, preserve working modules, migrate documentation incrementally and do not claim old evidence as freshly rerun.
- **Fresh-build mode:** use these target contracts as starting architecture. Authenticate/local development can initially use safe synthetic adapters, but no synthetic test-login bypass exposed to real users.
- **Original repository's source code:** usage/republication requires verified license/owner permission; this docs package alone does not confer that right.
