# Decision gates — only consequential unknowns

These are explicitly **open** until a project owner approves the relevant choice and engineering verifies it. Technical preference is not permission to connect accounts, spend money, change private data or deploy. Independent synthetic/internal work is allowed to proceed.

| Gate | Needed decision / minimum proof | Blocks |
|---|---|---|
| D-01 Authentication production mode | Choose supported provider/mode and owner/recovery policy; verify protected browser login/logout/callback/email delivery/MFA, DB concurrency, durable revocation, shared throttles, HTTPS, key custody and migration compatibility | Production EPIC-01 and EPIC-06 |
| D-02 Google Drive source access | Owner selected public-only and supplied an approved root/key plus local preview-cache approval on 20 October 2026. Local runtime is allowlisted/encrypted; gate still open for resource-key-required/ACL/limited-child proof, key restrictions/rotation and hosted constraints. No OAuth consent/scopes authorized | Real-provider EPIC-03, 05 |
| D-03 Hosting/storage/region/budget | Approve target cost, region/processors and provider; verify 50 MiB delivery limits, Linux worker, private bucket, provider path-log redaction, DB pool/lease recovery, backups/restore and source packaging | EPIC-06 staging/pilot, hosted media |
| D-04 Privacy/retention | Approve jurisdictions, processor list, privacy/support copy, retention, deletion/export procedure, retention backups and request identity verification | Public EPIC-06 |
| D-05 Brand | Approve original marks/assets before public marketing polish; fallback to text wordmark/system type for pilot | Branding polish only |

**Defaults until resolved:** TypeScript modular monolith, PostgreSQL, worker, adapter interfaces, local synthetic data, invitation-only pilot, system typography, **no** automatic payment/email provider/Drive connection/production provisioning. Do not embed speculative vendor endpoints or undocumented SDK behavior into core contracts.

**D-02 partial decision — Still open:** project owner approved public-only access, supplied one public source and an API key, and explicitly approved local preview caching in this chat on 20 October 2026. Configuration is private in `.env.local`; the key is AES-GCM encrypted using a domain-separated key derived from the existing local secret. No key, source URL/ID, filenames or image bytes enter evidence, fixtures or logs. `drive:configure-local` removes plaintext key inputs, supports encrypted optional root resource keys, and enables only the allowlisted local source. A read-only live scan published 100 images in two folders with 100 ready previews; protected HTTP access/denials/expiry and a smaller-page metadata traversal passed. Live `files.get` omitted parent metadata, so current stable-ID parent-list membership now proves ancestry; request-local resource keys are rediscovered from those listings. A seven-day absolute local preview lifetime bounds cache use; no original file is persisted. Local activation is approved independently of D-03 hosted activation. Remaining engineering proof: key-required fixture, actual ACL revocation/limited-child visibility and key restriction/rotation ownership. Public-only access cannot promise discovery of children hidden from the public caller. Project owner owns external approvals; engineering owns verification. No Google account/ACL setting was changed. See [EPIC-03 evidence](EPIC-03-EVIDENCE.md).

## Recording a closed decision

**EPIC-06 implementation boundary — Still open, project owner:** local operator APIs/UI, separately permitted TOTP proof, diagnostics, encrypted logical backup/quarantined restore and synthetic pilot-load measurement proceed without external account actions. D-03 still needs the authorized staging target, operational owner, key custody/backup ACLs, current denial/deletion reconciliation storage, real monitoring delivery and rollback proof. D-04 still needs approved retention/purge and recovery reopening semantics; therefore only retention candidate counts are enabled and restored data cannot reopen. Existing D-01/D-02 and real-device gates remain open. Local implementation does not approve any gate or assign permissions to a real account. See [EPIC-06 evidence](EPIC-06-EVIDENCE.md).

For each gate: specify `status: Approved/Rejected/Still open`, approver, approval date, exact tested configuration and version, evidence path/run, tradeoff, ongoing operational owner, and affected contracts/epics. Update only the impacted authoritative docs, not every file. A gate is not closed by a comparative blog post, a passing mock, or a local-only success.

## Adoption decisions (not provider gates)

**Current adoption:** fresh-build, selected after inspection found only this documentation package in the target folder on 19 October 2026. Local implementation uses the pinned Better Auth adapter and private encrypted local email delivery; this is permitted independent local work, not approval of D-01. Project owner remains the decision owner for production provider, delivery and lost-factor recovery policy; approval/evidence are still pending.

- **Existing-repo mode:** audit code/migrations first, preserve working modules, migrate documentation incrementally and do not claim old evidence as freshly rerun.
- **Fresh-build mode:** use these target contracts as starting architecture. Authenticate/local development can initially use safe synthetic adapters, but no synthetic test-login bypass exposed to real users.
- **Original repository's source code:** usage/republication requires verified license/owner permission; this docs package alone does not confer that right.
