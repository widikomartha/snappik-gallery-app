# UX, screens and interaction states

**Goal:** simple, photo-first UX for studios and clients, with explicit saving/locking/access states. The existing Snappik prototype may be used as reference, but **a prototype is not production UI**. Use original/synthetic photos in fixtures; do not publish an audited competitor gallery or client subjects.

## Sitemap

| Screen | User | Must support |
|---|---|---|
| `/` / `/help` | visitor | accurate features, access/privacy explanation, login CTA |
| `/login`, `/recover` | owner | safe return URL, errors, recovery, MFA when supported by approved mode |
| `/onboarding` | owner | studio name+slug, locale/timezone, retry without duplicate setup |
| `/app` | owner | project totals, recent projects, selecting/confirmed, next 7 days, refresh time |
| `/app/projects` | owner | list/search/filter active/archived, create action, empty states |
| `/app/projects/new` | owner | client label/source, main & download config, quota/deadlines, safe retry |
| `/app/projects/:id`, `/edit` | owner | source health, share/access, config, selection status, history/results, archive/reopen |
| `/app/settings`, `/account` | owner | profile/defaults/locale/timezone, trial or manual grant status |
| `/g/:token` | client | neutral menu chooser/gates; generic unavailable screen |
| `/g/:token/main` | client | folder gallery, viewer, selection bar, notes and pending/saved/conflict states |
| `/g/:token/main/review` | client | exact selected IDs/names/folders/notes and locked confirmation action |
| `/g/:token/main/confirmed` | client | immutable saved-confirmation acknowledgment, read-only choice set |
| `/g/:token/download` | client | independent access gate and individual original download |
| `/ops/...` | operator | bounded diagnostics, reasons for grants/suspension, audit outcomes |

## Four must-pass journeys

1. **Owner first project:** authenticate -> complete one-time setup -> create project -> get durable detail page (inventory may still be pending) -> view source status -> copy share link. Lost create response reuses original key; no duplicate project.
2. **Client main selection:** open share -> enter main access -> browse folders & full-size viewer -> select unique photo IDs -> add notes -> save -> review current server revision -> confirm -> read-only acknowledgment. A failed save keeps local pending intent and blocks confirm.
3. **Owner results/reopen:** view last immutable confirmation -> exact copy/CSV -> reopen with reason -> client refresh detects new draft revision -> reconfirm yields a **new** immutable snapshot.
4. **Download:** open download menu -> pass independent download gate -> browse -> fetch one eligible original with correct sanitized name; main-only grant cannot download.

## UI components and defaults

- **Photo cards:** maintain aspect ratios; show original name and folder path when ambiguous; distinct select checkbox/button and enlarge action. No accidental select on open.
- **Photo viewer:** previous/next, zoom/reset, select, note, close; Escape close, arrow navigation outside inputs, focus trap/restore.
- **Selection bar:** selected count / *maximum* quota, visible `Unsaved`, `Saving`, `Saved`, `Failed`, `Conflict` and `Confirmed` variants. All status from canonical server acknowledgement. Deselect remains possible when at quota.
- **Review:** every selected photo appears once with folder and note; confirm dialog states that edits become locked. Await all acknowledged saves and use the **acknowledged** revision.
- **Owner results:** label `Last confirmed (#revision)` separately from `Current draft`; copy/CSV never removes filename case/extensions or folder path.
- **Settings:** distinct main/download toggle, passwords and deadlines; never conflate workflow expiry with owner trial. `No deadline` visibly means null; edited omitted values stay unchanged.
- **Job status:** `Preparing / Ready / Failed`, last successful sync timestamp, safe retry. Show progress percentage only if measurable.
- **Destructive controls:** confirm archive, link rotation, reopen and operator suspend, explaining impact. No misleading dead buttons for deferred features.

## Input and error recovery

Every data-driven view needs applicable loading, empty, saved, stale/partial, validation, permission expired, server unavailable and retry states. Preserve form data after recoverable error. A server-committed project is not marked failed merely because navigation to detail broke. Wrong gallery password gets generic throttled feedback. If a source photo disappears, display it as unavailable in the draft instead of silently clearing it; allow explicit replacement/removal.

The local EPIC-02 owner flow labels the source as awaiting EPIC-03 access validation/indexing. Share-link copying explains that the client gallery belongs to EPIC-04. Create failures with uncertain outcomes hold the original request/key in memory and freeze fields for an identical retry; the UI warns owners to check the project list before starting another create. Browser reload does not persist passwords or the held form; manual project-list review remains necessary after closing that page. Revision conflicts preserve the form and require explicit reload of saved project data. Read views refresh every 15 seconds while visible, back off when hidden or failing, and show their last successful refresh time; edit forms never poll over unsaved entries. Deadline inputs are explicitly labeled UTC; detail/dashboard deadlines use the studio's timezone. Archive/restore/rotation explain their impact in native confirmation dialogs.

## Design system (pilot defaults)

| Token | Light | Dark |
|---|---|---|
| Background | `#F8FAFC` | `#0F172A` |
| Surface | `#FFFFFF` | `#1E293B` |
| Text | `#0F172A` | `#F8FAFC` |
| Secondary | `#475569` | `#CBD5E1` |
| Primary | `#1D4ED8` with white | `#93C5FD` with dark text |
| Error | `#B91C1C` | `#FCA5A5` |

System sans-serif, body 16px / 1.5 line height, 4px spacing scale, 8px control radius, at least 44x44px touch target, visible focus and selection signals beyond color alone. Use responsive grid, not a fixed image count per row; gallery widths start at 360px, also verify 768px and 1440px.

## Localization and accessibility

Support Indonesian and English UI strings, including formatted validation messages; studio setting provides default and gallery visitor may override locally. Keep exact filenames untouched. Store instants UTC; show localized absolute deadline + optional relative label. Support keyboard-only main journey, proper dialog focus, screen-reader status, reduced motion, 200% zoom, light/dark contrast, and touch interactions on a real phone before pilot release. Do not claim full accessibility from mock screenshots.
