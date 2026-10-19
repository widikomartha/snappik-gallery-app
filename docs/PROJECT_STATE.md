# Current project state

**Inspected:** 20 October 2026. **Mode:** `fresh-build`. No source was copied from the original repository. Evidence describes actual local implementation and executed checks.

| Field | Actual value |
|---|---|
| Repository | Local Git repository; no remote configured |
| Branch + HEAD + changes | `main`, based on `915ae6a`; uncommitted EPIC-04 implementation (inspect Git status) |
| Verified running features | Local auth/MFA/recovery/onboarding/settings/trial; project lifecycle/dashboard; fenced inventory jobs, atomic publication/private owner previews; client workflow grants, gallery/private client previews and shared revisioned draft |
| Current epic | EPIC-04 — Client Gallery & Photo Selection |
| Epic status 01 / 02 / 03 | In progress (D-01) / Done (local lifecycle) / Blocked (remaining provider/hosted proof) |
| Epic status 04 / 05 / 06 | In progress / Not verified / Not verified |
| Evidence | [EPIC-04](EPIC-04-EVIDENCE.md), [EPIC-03](EPIC-03-EVIDENCE.md), [EPIC-02](EPIC-02-EVIDENCE.md) |
| Single EPIC-04 residual blocker | Physical-phone touch/accessibility verification; desktop Chromium cannot establish device acceptance |
| Next concrete action | Verify the implemented gallery on a real phone before marking EPIC-04 Done |

**EPIC-04 implementation:** discovery exposes only enterable workflow metadata/locale. Independent password gates issue hashed, expiring, versioned main/download grants with durable local throttling. Client requests scope by studio/project and current workflow state; private previews repeat grant checks around provider visibility checks. Gallery provides published-photo folder filters, pagination, duplicate-name-safe selection, keyboard viewer/zoom, exact review, locale/theme, quota and notes. Full replacement saves commit with expected revisions; conflicts and lost replies retain local unsaved intent and require deliberate recovery. The existing confirmed state blocks writes; confirmation and original streaming remain EPIC-05. Empty source folders are not represented in existing inventory persistence. Migration `007_gallery.sql` was applied repeatably in isolated tests and the managed local development database; checksums/readiness passed and existing project/photo/selection/grant counts were retained. The temporary database process was stopped.

**EPIC-03 retained outcome:** bounded scans stage private generated previews by fenced lease and atomically publish complete generations, retaining stable IDs/selection references. Failure/cancellation/lease loss cannot erase acknowledged inventory. Source denial is sticky until successful validation. Decoder limits real MIME/pixels/bytes in a separate process. Migrations `005_inventory.sql`/`006_preview_expiry.sql` were previously applied repeatably to managed development storage with existing rows retained. Local previews use private PostgreSQL bytes.

**EPIC-03 residual external gate:** A05 still lacks resource-key-required/actual ACL revocation/limited-child/key-policy evidence (D-02) and hosted media/decoder proof (D-03). Prior authorized local public-source verification published 100 images with 100 ready previews, authenticated owner HTTP denial/expiry checks and real pagination. That approved encrypted, allowlisted source checks current parent membership/version outside transactions, then repeats authorization before bytes. Public preview expiry is seven days absolute. Default provider configuration stays disabled; synthetic mode is explicit. EPIC-04 tests used generated fixtures and add no live-provider evidence.

**Boundaries:** no confirmation/snapshot/reopen/results/original-download writer, purge, operator controls or deployment. D-01 production auth, D-02 remaining provider/key-policy proof, D-03 hosting/media and D-04 privacy remain open. Runtime: Node 24.18.0/npm 11.16.0, Next.js 16.4.2, React 19.2.7, Better Auth 1.7.11, PostgreSQL 18.4 and Sharp 0.35.5. Existing unrelated changes were preserved; no commit or external account action occurred.
