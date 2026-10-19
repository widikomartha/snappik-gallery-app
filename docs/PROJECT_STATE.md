# Current project state

**Inspected:** 20 October 2026. **Mode:** `fresh-build`. No source was copied from the original repository. Evidence comes from actual local code, migrations and tests, not target contracts.

| Field | Actual value |
|---|---|
| Mode / repository URL | Fresh build; local Git repository; no remote configured |
| Branch + HEAD + dirty changes | `main`; EPIC-03 delivery based on `a0f30b1` (inspect current Git log/status) |
| Verified running features | Local auth/MFA/recovery/onboarding/settings/trial; project lifecycle/dashboard; bounded generated inventory, fenced jobs/retries/cancel, atomic publication, private owner previews and inventory controls |
| Current epic | EPIC-03 — Google Drive & Media Processing |
| Epic status 01 / 02 / 03 | In progress (D-01 open) / Done (local lifecycle) / Blocked (live-provider/hosted-media proof) |
| Epic status 04 / 05 / 06 | Not verified / Not verified / Not verified |
| Relevant evidence | [EPIC-03 verification](EPIC-03-EVIDENCE.md); existing [EPIC-02 evidence](EPIC-02-EVIDENCE.md) |
| External gates | D-01 production auth, D-02 remaining public-only provider/key-policy proof, D-03 hosting/media and D-04 privacy remain open |
| One next concrete action | Complete remaining resource-key/ACL/limited-child/key-policy proof and resolve D-03 hosted-media constraints |

**EPIC-03 outcome:** the local worker validates bounded root/children traversal, stages metadata/private generated previews by lease, and atomically publishes complete generations while retaining stable photo IDs/selection references. Failure/cancellation/lease loss cannot tombstone acknowledged inventory. Source denial survives cancellation/retry until successful validation. Owner photos/media/sync/cancel routes enforce current studio scope and source state; UI exposes generation, skips, failures, explicit synthetic labeling and retry-safe controls. Decoder checks actual MIME, pixels/bytes and metadata stripping in a separate bounded process. `005_inventory.sql` and `006_preview_expiry.sql` are additive and have also been applied repeatably to the managed development database with checksums/readiness verified and existing row counts retained; the temporary process was stopped. Local previews use private PostgreSQL bytes, not a public bucket.

**Single residual EPIC-03 blocker:** A05 still lacks dedicated resource-key-required/actual ACL revocation/limited-child/key-policy evidence (D-02) and hosted private-media/decoder proof (D-03). The owner supplied one approved public root/key and approved local preview caching on 20 October 2026. An encrypted, allowlisted local public-source adapter is enabled in private configuration. The live handler published 100 publicly visible images in two folders with 100 ready private previews and no skips. Authenticated HTTP delivery and anonymous/cross-tenant/archive/expiry denials passed; real pagination also passed with smaller pages. Media checks live parent-list membership/version outside a DB transaction, then rechecks owner/session/source/photo state before returning bounded bytes. Cache expiry is seven days absolute; expired bytes are denied immediately and removed by worker maintenance. No secret/resource-key request fields or DB credential columns were added. Default configuration remains disabled; explicit synthetic mode remains available.

**Boundaries:** public gallery/workflow grant issuance and client media, selection writes, confirmation/results/original downloads, purge and deployment are not implemented. Existing stored grant-policy tests remain synthetic fixtures. D-01 still prevents production auth acceptance; only loopback local configuration is accepted. Only read-only requests to the owner-approved public Google source and local cache operations are authorized; no consent, external account/ACL change, provisioning or deployment occurred. Runtime versions remain Node 24.18.0/npm 11.16.0, Next.js 16.4.2, React 19.2.7, Better Auth 1.7.11, PostgreSQL 18.4; direct Sharp is pinned at 0.35.5.
