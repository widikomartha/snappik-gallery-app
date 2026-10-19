# Product requirements — Snappik MVP

**Product:** Snappik-style studio photo-selection and delivery web app. **Status:** implementation specification, not evidence of completion. **Delivery model:** invitation-only pilot; one studio owner per studio; clients need no account.

## Problem / outcome

Studios send photos through Google Drive while clients return loosely specified filenames and notes over chat. Filename collisions, missing context, revision confusion and lost confirmations cause rework. The outcome is a durable project: the studio presents an authorized gallery; the client selects and confirms exact photo IDs and notes; the studio receives the same immutable result; eligible individual originals can be downloaded.

## Users and permissions

- **Visitor:** product information, basic help and login.
- **Studio owner:** setup, project management, workflow configuration, source sync, exact results/export and explicit selection reopening.
- **Gallery client:** account-free, link-based access to the enabled main-selection and/or download workflow, each with its own gate.
- **Platform operator:** separately authorized support diagnostics and bounded entitlement/suspension actions; no general photo browsing or impersonation.

## Included in MVP

1. Secure owner login/logout/recovery and idempotent studio onboarding; one owner/studio, 7-day pilot grant, maximum three active projects unless manually extended.
2. Owner dashboard and create/edit/archive/restore project; per-project main and download access, optional passwords/deadlines, quota and source folder.
3. Google Drive-based source inventory with safe pagination/subfolders, stable file IDs, thumbnails, failed-sync recovery and bounded resource usage.
4. Responsive, accessible, Indonesian/English client gallery and photo viewer; a **single shared main selection per project**; notes and revision-controlled saves.
5. Atomic confirmation and immutable snapshots; owner reopen with reason and history; exact copy/CSV result; individually authorized downloads.
6. Minimum operator diagnostics, manual grants/suspension with audit, appropriate privacy controls, operational recovery and staged pilot release.

## Out of scope

Payments/automated billing, staff invitation, extra-photo/print workflow, batch import, AI culling/photo editing, Telegram/WhatsApp automation, custom domains, CRM sync, direct ZIP/download-all, mass-delete UI, shared gallery private sets per recipient and storing/replacing original photos on Snappik. Future work requires separately approved scope.

## Pilot acceptance targets (targets, not measured claims)

- No cross-tenant data disclosure or lost acknowledged selection/confirmation in acceptance tests.
- At least 95% of scripted valid main selection/confirmation runs succeed in the defined device test matrix.
- Owner save/confirm API p95 <1 second under documented pilot load, excluding external provider time.
- First thumbnail batch <3 seconds with warm cache under documented test network; measure cold cache separately.
- Load fixture: 10 studios, 100 projects, a 1,000-image / 4-folder sample project, 50 active client sessions.
- Activation target: >=80% of invited pilot studios that complete setup create a usable project; report counts and denominator.

## Release gates

EPIC-01 through EPIC-06 acceptance pass for the chosen pilot environment, external provider/hosting/privacy decisions are actually approved and verified, no high-severity defects remain, backup/restore and revocation checks pass, and privacy/support claims match product behavior. A successful local build is not authorization for a public release.

**Authoritative exact behavior:** `BUSINESS_RULES.md`. **Delivery order:** `BACKLOG.md`. **Unresolved provider choices:** `DECISIONS.md`.
