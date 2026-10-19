# EPIC-04 local implementation evidence

**Date:** 20 October 2026. **Checkout:** `main`, based on `915ae6a`, uncommitted implementation. **Result: In progress.** Physical-phone touch/accessibility verification remains outstanding. No deployment, provider consent, account change or production acceptance is claimed.

## Delivered boundary

Account-free `/g/:token` discovery and independent main/download gates; workflow-scoped cookies and durable local password throttling; protected published-photo pagination/folders/private previews; stable photo identities; viewer and exact selection review; full shared draft replacement with quota, Unicode notes and expected revisions. ID/EN, light/dark and pending/saved/failed/conflict states are implemented. Lost replies preserve local unsaved intent. Conflict recovery requires reviewing server state and choosing to use it or deliberately reapply local intent; confirmed sets prohibit reapplication/writes. Confirmation and original downloading remain EPIC-05, with no actionable controls claiming those features.

## Verification

All database/browser fixtures use isolated new PostgreSQL 18.4 instances, synthetic owners and worker-generated colors. The additive migration was also applied twice to the managed local development database, with checksums/readiness verified and existing project/photo/selection/grant counts unchanged. The verification stopped its temporary database process. The restricted sandbox could not complete isolated service startup; successful HTTP/browser runs use approved local-process access outside that sandbox. Failed initial test runs are not acceptance evidence.

- `npm run typecheck`, `npm test`, `npm run build`: passed.
- `npm run test:db`: 14 passed, including checksummed/repeat migrations, actual worker heartbeat, auth/recovery/MFA, owner tenant scope, project quota and archive races.
- `npm run test:inventory`: 12 passed, including actual decoder/worker/publication, protected owner media, cancellation/lease/source races and public-provider protocol fixtures. This does not add live-provider proof.
- `npm run test:projects:browser`: passed again after updating owner share-link feedback, using actual local HTTP/PostgreSQL.
- `npm run test:gallery`: 6 passed. Verifies minimal discovery; independently issued main/download cookies; owner-cookie denial; cross-project grant denial; wrong password/throttling/CSRF; deadline equality/version/rotation/archive/suspension; protected client media; pagination/folders/duplicate filenames; exact refresh persistence; 500/501 Unicode code points; full 500-item/~1 MiB draft; transaction rollback; competing HTTP saves and lost-response retry; locked selections.
- `npm run test:gallery:browser`: passed. Actual production-build HTTP/DB/media in Chromium. Covers gates, loaded images, folders, separate enlarge/select controls, viewer keyboard, note/save/refresh, two-tab 409 and explicit reapplication, committed-save/lost-response recovery, failed-preview retry, viewer focus restoration, ID/EN messages, themes, archive denial and 360/768/1440 overflow checks. Screenshots are ignored local artifacts under `test-results/gallery-*.png`; the 360px rendering was inspected.
- `pwsh -NoProfile -File docs/tools/validate-docs.ps1` and `git diff --check`: passed.

## Acceptance limits

A01, A03 and A04 are exercised through real HTTP/PostgreSQL boundaries with generated inventory. A02/A05 have Chromium coverage; physical-phone touch/focus/zoom/screen-reader evidence is still required before calling the epic Done. Browser emulation and screenshots cannot establish that claim. Confirm is unavailable throughout this EPIC-04 slice, including while unsaved/failed; actual confirm transactions and their races belong to EPIC-05.

Folder menus derive from published available photos; empty provider folders are not persisted by EPIC-03. The current hosted/provider gates D-01–D-04 and EPIC-03's remaining proof are unchanged. The local HTTP-cookie exception cannot authorize production cookie configuration. No live source was fetched for gallery acceptance.
