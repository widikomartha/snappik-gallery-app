# Business rules (normative)

These rules govern **all implementations**, including background jobs and direct API requests. UI restrictions alone do not enforce policy. Unless specified otherwise, timestamps are UTC instants and comparisons use the server/database clock.

## Identity, setup and entitlement

- Each project and dependent record belongs to one studio; resolve owner membership on the server. `studio_id` or `role` supplied by a browser never establishes scope.
- MVP owner identity is a verified provider subject, **not an email-string join**. One owner per studio, one studio per owner. Onboarding creates/repairs studio, membership, settings and initial trial idempotently in a transaction. Never reset an existing trial on a retry.
- Studio name: 1–100 Unicode code points after trimming; slug: 3–50 lowercase ASCII characters/digits/hyphens, globally unique; reject reserved route names (`app`, `api`, `auth`, `login`, `register`, `recover`, `g`, `ops`, `admin`, `health`, `settings`, `projects`, `help`, `privacy`, `terms`).
- Trial begins at studio's initial `provisioned_at`, lasts **168 hours** and permits **3 non-archived projects**. Active manual grants can override the limit; compute the highest applicable nonrevoked active limit. Dates are not extended by repeated login/setup.
- Expired studio entitlement blocks creation, config changes, source resync and reopen, but allows owner read/export, archive, access revocation, logout and privacy/support actions. Client workflows remain governed by their own permission/deadline unless the studio is suspended.
- Suspension denies gallery access and normal owner business operations immediately; the owner sees restricted support/recovery information. Operator actions require independent permissions and audited reasons.
- Default studio settings: locale `id`, timezone `Asia/Makassar`, detect subfolders true, notes true, grid layout, main enabled with quota 20 and no deadline, download disabled with no deadline. Owner can change later defaults without silently mutating existing projects.

## Projects and source

- Require nonempty client label (maximum 100 Unicode code points), a provider-validated Drive folder identity and at least one enabled workflow. Phone fields are optional E.164; never block photo selection because of absent contact numbers.
- EPIC-02 local lifecycle exception: creation may persist a syntactically valid candidate folder ID (10–200 ASCII letters/digits/underscore/hyphen), explicitly reported as `source_validation=pending_provider`. This never proves folder existence, ownership or permissions. Inventory stays pending until EPIC-03 performs provider validation and a complete scan; no media/client access is implemented by this exception. No arbitrary URL is fetched. The current lifecycle API keeps the root immutable; use a new project for a different root.
- Main quota is an integer **1–500** when enabled; not required when main is disabled. Quota is a *maximum*, not a minimum. Changing defaults does not rewrite project snapshots. Omitted PATCH fields retain old values; explicitly null `expires_at` means no deadline.
- Project creation atomically commits project, enabled workflows, one empty main selection set (dormant when main is disabled), an audit event, a deduplicated inventory job and the idempotency result. Acknowledging creation never waits for Drive indexing; the initial inventory state is `pending`.
- Archive immediately denies client requests and removes project from active quota; restore within **30 days** checks current entitlement/project limit and **preserves original absolute deadlines**. Project purge is worker-driven after the retention window; it does not remove original Drive files.
- Provider file identity is `(project_id, provider_file_id)`, not name/path/case/extension. Keep original filename, folder path, MIME, size and provider version for display and export. Photo source version is opaque, not globally monotonic.
- Supported photos: JPEG/JPG, PNG and WebP, **maximum 50 MiB each**. Pilot inventory ceiling: **5,000 photos/project**, maximum traversal depth **10**; unsupported, trashed and oversize items have explicit skip counts. Validate actual content/metadata, not extension alone.
- Traverse only the owner-authorized root subtree, with bounded pagination and provider resource limits. Do not follow external shortcuts. Publish a generation **only if the entire scan completed**; failures preserve last complete generation and all acknowledged choices. A removed source photo becomes unavailable, never silently unselected. Invalid selected photos must be removed/replaced before reconfirmation; old snapshots remain unchanged.
- Replacing a Drive root when it has selected photos is unsupported in MVP: create a new project. Provider credentials/root permissions must be resolved before introducing final connection fields; see `DECISIONS.md`.

## Independent gallery access

- Public share URL `/g/{publicToken}` is generated with cryptographic entropy (at least 192 random bits). Token possession grants a *limited discovery page*, not owner access or media access.
- Main selection and download are distinct workflows; each has independent `enabled`, password hash, expiry and grant. Changing password, rotating the share token or disabling a workflow invalidates relevant active grants (version checks). Passwords are 8–128 characters with an approved slow hash.
- `expires_at = null` is unlimited project deadline. At `server_now >= expires_at`, deny. Each gallery grant expires no later than **12 hours** after issue or the earlier workflow deadline. Every protected request rechecks current project/studio/workflow/access version and deadline, including cached media access.
- Archiving, suspension or access revocation makes previously issued grants unusable. Photos already downloaded or independently shared through Drive cannot be recalled. Never imply otherwise.
- Unauthorized/unknown/revoked galleries show a generic unavailable state. Do not reveal studio contacts, credentials, Drive root IDs or note bodies in public bootstrap responses.

## Shared selection and confirmation

- A project has **one collaborative main selection set**, shared by all clients authorized for its main workflow. Explicitly explain this in the UI; it is not one draft per recipient.
- Disabling notes blocks new or changed nonempty draft notes; unchanged saved notes may be retained or explicitly cleared. Removing their selected photo removes its current draft note.
- Draft state: `not_started` (0 items) or `selecting` (>=1 item). Confirmation requires **at least one** and at most the configured quota. Only available, in-project IDs may be selected, each at most once. Notes belong to selected items only, plain text, up to **500 Unicode code points**; removing a selected item removes its *current draft* note.
- Every save, note update, confirm, reopen and relevant project config edit verifies its own `expected_revision`, acquires locks in consistent **studio (when needed) → project → selection set** order, and increments the appropriate revision in one transaction. A stale revision returns **409**, never automatically overwrites newer data.
- `PUT` selection submits the **complete intended draft**, not a merge patch. Only a successful server acknowledgement makes the UI label it `saved`. Failed or uncertain saves retain local unsaved intent visibly. On a conflict, fetch canonical state, show the change and require deliberate user reapplication; never auto-merge past a confirmation boundary.
- Confirmation checks current authorization, server revision, active available items and quota; in one transaction it stores an **immutable snapshot of IDs + original names/paths + notes + server time**, marks the set `confirmed`, and disallows client edits.
- Confirmation retries with identical idempotency key and same intent return the *original* snapshot; a different key on an already confirmed set returns `SELECTION_LOCKED`. A lost response does not authorize creating a second confirmation.
- Owner can reopen only with active entitlement, a reason and current expected revision. Reopen retains items and immutable prior confirmations, moves state to selecting, increments revision; clients refresh/poll before editing. Previously confirmed exports do not change.
- Quota reductions below existing draft count are rejected. Quota/source-root changes while confirmed require deliberate reopen; root replacement with selected items stays unsupported even after reopen.

## Results, download and reliability

- Owner result view/export distinguishes `current draft` from `confirmation #N`. CSV contains stable photo ID, provider ID (owner only), original filename, folder path, note and confirmation revision/time. Quote/escape CSV and neutralize spreadsheet-formula injection.
- Original download checks **download grant** independent of selection and main confirmation; eligible photos need not be selected. Server resolves an in-project provider ID and enforces bounded transfer; never fetch a client-provided URL. Show failures instead of claiming a successful download after a truncated or forbidden response.
- All creates/confirms/reopens/resync/operator mutations requiring an idempotency key scope it to actor/session, studio/project, operation and key; key length **16–128 printable ASCII**, TTL **24 hours**. Same key with different request payload is 409. After TTL, database uniqueness still prevents duplicating business identities.
- Project creation retains an actor/studio/operation/key tombstone after the 24-hour replay window. An expired key returns `IDEMPOTENCY_EXPIRED`, requiring review of saved projects; it is never silently treated as a new create. Matching retries within the window recover the original acknowledgment even if quota or entitlement has since changed. Suspension still denies access. PATCH omission preserves workflow deadlines/passwords; changing a deadline also advances that workflow's access version.
- Jobs use bounded retry/backoff, leases and fencing. A worker crash or duplicate processing must not duplicate persisted business actions. Do not hold DB transactions across external network requests.
- Dashboard derives counts from canonical records; visible-page status refresh defaults to **15 seconds**, with hidden/error backoff and user-triggered refresh. Do not market polling as realtime push.
- Proposed retention before policy approval: archived project restoration for 30 days; derived thumbnails 7 days idle; client grants <=12 hours; request logs 14 days; audit events 180 days; backups 30 days. Legal and processor approval remains a release gate (`DECISIONS.md`).

## Explicit state invariants

| Dimension | Values | Never infer from |
|---|---|---|
| Studio | setup_required / active / suspended | trial label alone |
| Entitlement | active / expired | client expiry |
| Inventory | pending / ready / failed | project creation acknowledgement |
| Main selection | not_started / selecting / confirmed | download enabled flag |
| Gallery grant | valid / expired / revoked / absent, per workflow | public URL possession |
| Project lifecycle | active / archived / purge_due | whether confirmation exists |

Rules are decisions for the MVP. Changes to limits, workflows or access semantics require updating `API.md`, `DATABASE.md`, `DESIGN.md` and relevant acceptance scenarios, not ad hoc agent assumptions.
