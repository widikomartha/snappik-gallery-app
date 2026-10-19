# Current project state

**Inspected:** 20 October 2026. **Mode:** `fresh-build`. No source was copied from the original repository. Evidence describes actual local implementation and executed checks.

| Field | Actual value |
|---|---|
| Repository | Local Git repository; no remote configured |
| Branch + HEAD + changes | `main`, based on `9ce14e2`; uncommitted EPIC-05 implementation (inspect Git status) |
| Verified running features | Local auth/onboarding/settings/trial; project lifecycle/dashboard; fenced inventory/private previews; independent client grants/gallery/revisioned draft; immutable confirmation/history/results/reopen/CSV and bounded original delivery |
| Current epic | EPIC-05 — Confirmation, Results & Downloads |
| Epic status 01 / 02 / 03 | In progress (D-01) / Done (local lifecycle) / Blocked (remaining provider/hosted proof) |
| Epic status 04 / 05 / 06 | In progress / Blocked / Not verified |
| Evidence | [EPIC-05](EPIC-05-EVIDENCE.md), [EPIC-04](EPIC-04-EVIDENCE.md), [EPIC-03](EPIC-03-EVIDENCE.md), [EPIC-02](EPIC-02-EVIDENCE.md) |
| Single EPIC-05 residual blocker | A05 real-provider and hosted original-delivery verification under D-02/D-03 |
| Next concrete action | Close the dedicated provider/hosting verification gate before marking EPIC-05 Done |

**EPIC-05 implementation:** current main grant and acknowledged revision govern atomic confirmation. One immutable snapshot locks the draft; same-session/key/body replay recovers the original acknowledgment and different intent cannot duplicate a locked confirmation. Owner history/result reads remain scoped; copy/CSV preserve IDs, original names/paths/notes, revision and UTC confirmation time with safe spreadsheet escaping. Active owners can deliberately reopen with reason and expected revision; choices/history survive, revision advances and reconfirm creates a new snapshot. Uncertain confirmation/reopen responses retain the same request for retry with editing paused. Download-only grants authorize eligible originals independently of selection; current source/grant checks, exact size/content, cancellation, 50 MiB/60 seconds and two transfers/process bound local delivery. Complete originals are validated transiently before attachment headers and never persisted. Migration `008_results.sql` was applied twice to isolated and managed local storage; readiness passed and existing row counts were retained. The temporary managed database process was stopped.

**Retained EPIC-04 outcome:** independent password gates issue hashed, expiring, versioned grants with durable local throttling. Protected gallery/private previews, folder filters, pagination, duplicate-name-safe selection, keyboard viewer, review, ID/EN/theme, quota/notes and full replacement saves use current server authorization and expected revisions. Conflicts/lost replies retain unsaved intent and require deliberate recovery. Migration `007_gallery.sql` was previously applied repeatably with existing rows retained. Physical-phone touch/accessibility proof remains outstanding; EPIC-05 browser checks do not close that EPIC-04 gate.

**Retained EPIC-03 outcome:** bounded scans stage private generated previews with fenced leases and atomic complete generations. Failed/cancelled scans preserve inventory and stable selected references. Source denial is sticky until successful validation. Decoder work has separate-process MIME/pixel/byte bounds. The separately approved local public source is encrypted/allowlisted, checks current parent membership/version outside transactions and repeats authorization before bytes; public previews expire after seven days. Prior live verification published 100 photos/previews and exercised authenticated denials/expiry/pagination. Default provider mode remains disabled; synthetic mode is explicit. Resource-key-required/actual ACL revocation/limited-child/key-policy evidence (D-02) and hosted media/transfer proof (D-03) remain open. EPIC-05 tests add generated-source/protocol evidence, no new live-provider proof.

**Boundaries:** no purge, operator controls or deployment. D-01 production auth and D-04 privacy also remain open. Runtime: Node 24.18.0/npm 11.16.0, Next.js 16.4.2, React 19.2.7, Better Auth 1.7.11, PostgreSQL 18.4 and Sharp 0.35.5. Existing unrelated changes were preserved; no commit, provider consent, paid provisioning or external account action occurred.
