# Library Cleanup — design

Status: approved in brainstorming, 2026-09-23.
Visual reference: `specs/mockups/2026-09-23-library-cleanup-mockups.html`. It is **binding for layout and
interaction**; see [Visual reference](#visual-reference).

## Goal

A place users come back to regularly that does two jobs at once:

1. **Relive** — a daily _rewind_ of every photo taken on today's date across all years, reviewed a day at a
   time, until the whole library has been seen once.
2. **Tidy** — a set of cleanup _queues_ (largest files, bursts, screenshots, blurry/botched photos, plus the
   existing duplicates utility), each of which can be drained to zero.

Success: a user can open Cleanup, finish today's date in a few minutes, and act on a queue — and every action
is reversible until the trash is emptied.

## Scope

**In v1**

- Web only. Mobile reuses the same endpoints later.
- Only the requesting user's **own** assets. Asset deletion is owner-only by design
  (`specs/2026-03-23-spaces-permissions-matrix.md`); admin- or space-editor cleanup would change that model and
  needs its own design.
- Queues: **Space hogs**, **Bursts & series**, **Screenshots**, **Blurry & botched**, and **Duplicates**
  (a link plus a count; the existing `/utilities/duplicates` page is not rebuilt).
- Daily **Rewind** with a year **calendar** (reviewed days fill in) and a streak.
- "Trash" always means the recoverable trash. Nothing is permanently deleted from Cleanup except through the
  existing "Empty trash" action.

**Not in v1**

- Receipts/documents, messenger saves, accidental short videos, live-photo motion stripping, low-res copies,
  "shrink" (re-encode) for large videos, blur scoring for videos.
- A "space freed this month" counter — once trash is emptied the assets are gone and attributing the freed
  bytes to Cleanup would need a dedicated ledger. The hub shows "could still free X" and "trash holds Y".
- Sidebar entry / badge.

## Placement

Cleanup is a new entry **inside the Utilities page**, at the top of "Organize your library" in
`web/src/routes/(user)/utilities/UtilitiesMenu.svelte` — the only upstream file touched on the web side. The
existing Duplicates, Large files, Geolocation and Workflows entries are unchanged.

| Route                                  | Page                                                                                               |
| -------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `/utilities/cleanup`                   | Hub: year calendar (hover-to-peek), queue rail with counts and bytes, "Rewind today", trash footer |
| `/utilities/cleanup/rewind/[monthDay]` | Rewind for one date, grouped by year                                                               |
| `/utilities/cleanup/[queue]`           | `space-hogs`, `bursts`, `screenshots`, `blurry`                                                    |

The Duplicates card links to the existing `/utilities/duplicates`.

## Visual reference

The web UI must look and behave like `specs/mockups/2026-09-23-library-cleanup-mockups.html`. Open it in a
browser; its tabs are the screens. It is built from Gallery's own palette and app shell, so translate it into
`@immich/ui` components and Tailwind rather than copying its CSS. Where the mockup and this spec disagree, this
spec wins: the mockup uses placeholder data and colour blocks instead of photos.

| Mockup tab               | Route / component                               | Must match                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ------------------------ | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **2 · Hub**              | `/utilities/cleanup`                            | Two columns: the calendar card on the left (12 month rows × 31 day columns; shaded by photo count; reviewed days green; today outlined; legend below), with the hover **day peek** strip under it (date, count, thumbnail row, "Rewind this day"). On the right, a **queue rail** card: thumbnail, name, one-line description, count and "−bytes" on each row, and a trash footer with "Empty". The header holds the streak and days-reviewed subtitle, a "Could still free" chip and the primary "Rewind today" button. Stacks to one column below ~980px                                                                                                                                                                                 |
| **3 · Daily rewind**     | `/utilities/cleanup/rewind/[monthDay]`          | Title "<date>, across N years"; Grid / One-at-a-time toggle (grid is the default); previous/next day buttons; progress bar with the keep/favourite/trash/untouched summary; "Hide reviewed" toggle. One section per year with a "N years ago · place · count" subheading and a "Keep all remaining" action. Mark styles: **green border + ✓** for keep, **pink border + ♥** for favourite, **greyed + red "TRASH" overlay** for trash, a primary focus ring. A sticky bottom **action bar** shows the shortcut legend, "Move N to trash" and "Finish day ✓". In one-at-a-time mode: a dark stage, four round buttons (trash / skip / favourite / keep), an up-next filmstrip and a hints card (burst, low sharpness) linking to the queues |
| **4 · Bursts & series**  | `/utilities/cleanup/bursts`, `BurstGroupCard`   | One card per group: time range, "N shots · size" chip, a source chip (camera burst vs. same moment), place; actions Keep all / Stack instead / **Keep 1, trash N−1**. A thumbnail row where the suggested pick carries a **★ SHARPEST** badge and a keep mark, and the others are pre-marked trash; click to toggle. Page header: "Keep all on page" and "Accept suggestions on page (−bytes)"                                                                                                                                                                                                                                                                                                                                             |
| **5 · Blurry & botched** | `/utilities/cleanup/blurry`, `QueueSelectGrid`  | Header actions "Not a problem (keep)" and "Trash N selected". A toolbar with reason chips (All / Blurry / Too dark / Overexposed, each with a count), the **strictness slider** (lenient, balanced, strict) and the "Hide photos with faces" toggle. A selectable grid with a reason badge on each tile. Screenshots uses the same component without the slider or reason chips                                                                                                                                                                                                                                                                                                                                                            |
| **6 · Space hogs**       | `/utilities/cleanup/space-hogs`, `SpaceHogList` | A total in the header ("Your N largest files take up X, Y% of your library"); a Videos / Photos / All toggle; a min-size control. Rows: thumbnail (with ▶ for video), filename, "type · resolution · duration · year · album/favourite" signals, a size with a proportional bar, and Keep / Trash                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| 1 · Hub A, 7 · Mobile    | —                                               | **Not to build.** Tab 1 is the rejected hub layout. Tab 7 is a direction for the later mobile release                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |

Required everywhere: the breadcrumb `Utilities / Cleanup / <page>`; the Utilities sidebar item stays active (there
is no Cleanup sidebar item); counts and bytes use tabular figures; dark mode through the existing theme tokens.

## Architecture: store facts, decide at query time

Only blur/exposure needs pixels, so only that is precomputed — as raw **facts** (scores), never as queue
**verdicts**. Queue membership, burst groups and size rankings are computed per request. Thresholds are query
parameters, so the strictness slider and threshold tuning never require re-running a job.

### Data model (fork-only migrations in `server/src/schema/migrations-gallery/`)

**`asset_quality`** — one row per analysed asset.

| Column                         | Type                               | Notes                                                            |
| ------------------------------ | ---------------------------------- | ---------------------------------------------------------------- |
| `assetId`                      | PK, FK → `asset` ON DELETE CASCADE |                                                                  |
| `ownerId`                      | FK → `user` ON DELETE CASCADE      | Denormalised so per-owner counts never join through `asset`      |
| `sharpness`                    | real, nullable                     | Laplacian variance on a 512px greyscale preview; null for videos |
| `brightness`                   | real, nullable                     | Mean luminance 0–255                                             |
| `clippedDark`, `clippedBright` | real, nullable                     | Fraction of pixels ≤ 8 / ≥ 247                                   |
| `isScreenshot`                 | boolean                            | Heuristic, see below                                             |
| `version`                      | smallint                           | Scoring-algorithm version; bumping it makes "Missing" re-analyse |

Indexes: `(ownerId, sharpness)`, partial `(ownerId) WHERE "isScreenshot"`.

**`cleanup_decision`** — a user's "keep" choices, so queues drain to zero.

| Column                       | Type                                                                  |
| ---------------------------- | --------------------------------------------------------------------- |
| `userId`, `queue`, `assetId` | composite PK (both FKs ON DELETE CASCADE)                             |
| `decision`                   | `'keep'` (trash is recorded by the trash itself, so it is not stored) |
| `createdAt`                  | timestamptz                                                           |

`queue` ∈ `rewind | space_hogs | bursts | screenshots | blurry`. Keep is **per queue**: "not blurry" does not
mean "not a duplicate". A rewind keep also means "seen".

**`cleanup_day_review`** — `userId` + `monthDay` (smallint, `month*100+day`, e.g. `923`, `229`) as PK,
`reviewedAt` timestamptz (latest wins, which leaves room for a yearly re-review later).

**`asset_job_status.qualityAnalyzedAt`** — timestamptz, nullable; same pattern as `classifiedAt` /
`petsDetectedAt`.

**Indexes on upstream tables** (fork migrations):

- `asset`: partial expression index on `(ownerId, <month-day of localDateTime>)` where the asset is not trashed,
  has timeline or archive visibility, is not offline and has no `libraryId`. The expression uses the same
  `("localDateTime" AT TIME ZONE 'UTC')` form as the existing `asset_localDateTime_idx`, and the calendar query
  must use it verbatim.
- `asset_exif`: `("fileSizeInByte" DESC)`. It sits on an upstream table, so it needs a verbatim
  `migration_overrides` row.

**Static guards** (both live in the server _unit_ suite; no medium test catches them):

- `src/schema/revert-to-immich.spec.ts` is generative. Every new table and override needs its five blocks in
  `scripts/revert-to-immich.sql`:
  1. `DROP TABLE` in FK order
  2. `DROP FUNCTION` (none expected)
  3. the `migration_overrides` names, including the `asset_exif` size index override
  4. the `fork_tables_left` list
  5. the `kysely_migrations` delete list
- `src/utils/shared-space-album-scope.guard.spec.ts`: only the id-only "which selected assets are in a Space"
  lookup (used by the confirmation, see Edge cases) touches `shared_space_*`. It returns ids, not asset rows,
  so it gets an explicit `VIS_ALLOWLIST` entry.

### Include and exclude rules (every queue, rewind and calendar)

- Included: assets owned by the user, including **archived** ones (they still use storage).
- Excluded: assets that are trashed, have `locked` or `hidden` visibility (the hidden ones include live-photo
  motion parts), are offline, or belong to an **external library** (trashing those does not free the file).

### Quality analysis job

- New `QueueName.QualityAnalysis` with `JobName.AssetAnalyzeQuality` and `AssetAnalyzeQualityQueueAll`.
- Chained in `job.service.ts` `onDone` for `AssetGenerateThumbnails`, next to the fork's existing
  `PetDetection` hook, so uploads are analysed automatically.
- Admin Jobs card "Quality analysis" offers **Missing** and **All**. Missing covers a null `qualityAnalyzedAt`
  or an older `version`. It streams the asset IDs rather than loading them all. Default concurrency is 2.
- Per image:
  1. Read the existing **preview** through the storage repository (so it works on S3). The original is never
     read.
  2. `sharp`: greyscale, resize to 512px on the long edge, take the raw buffer.
  3. **Sharpness**: a 3×3 Laplacian (`0 1 0 / 1 -4 1 / 0 1 0`) in TypeScript, then its variance. This is done in
     TypeScript because sharp's `convolve` clamps negative responses to 0–255, which corrupts the variance.
  4. **Brightness** and **clipping** from the same buffer.
- **`isScreenshot`**: the original filename matches a multi-locale pattern list (e.g. `Screenshot`,
  `Screen Recording`, `Bildschirmfoto`, `Capture d'écran`, `Schermafbeelding`, `截屏`, `スクリーンショット`),
  **or** there is no camera make/model **and** (the file is a PNG **or** its aspect ratio is ≥ 2.0).
- Videos get only `isScreenshot`, which catches screen recordings. Their sharpness and brightness stay null.

### Queue rules (at query time)

| Queue       | Rule                                                                                                                                                                                                                                                                                                                                                                   |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Space hogs  | Order by `fileSizeInByte DESC, id`; optional `type` and `minSize` filters                                                                                                                                                                                                                                                                                              |
| Bursts      | Photos ordered by `localDateTime`. A new group starts when the gap exceeds 2 s or `autoStackId` changes; groups need ≥ 2 members. Groups with no `autoStackId` must also pass a CLIP cosine-distance check against the first member, computed for the current page only. Stacked assets are excluded. Suggested keep: highest `sharpness`, then largest file           |
| Screenshots | `isScreenshot`                                                                                                                                                                                                                                                                                                                                                         |
| Blurry      | Reason `blurry`: `sharpness < threshold[strictness]`. `dark`: `brightness < 35 AND clippedDark > 0.5`. `bright`: `clippedBright > 0.4`. `hideFaces` (default **on**) excludes assets with any `asset_face`, to protect intentional shallow-focus portraits. The lenient, balanced and strict thresholds are **calibrated on a personal-instance clone before release** |
| All         | Exclude assets with a `cleanup_decision` keep for that queue, and apply the include/exclude rules                                                                                                                                                                                                                                                                      |

Rewind and calendar use the month and day of `localDateTime`, the wall-clock time at capture. 29 February is its
own date.

### API

`CleanupController` → `CleanupService` → `CleanupRepository`. All endpoints are scoped to `auth.user.id`, with
new permissions `cleanup.read` and `cleanup.update`.

| Endpoint                                   | Purpose                                                                                                                                                                                                                                                                                                                           |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /cleanup/queues/{queue}/count`        | `{count, bytes}`, plus `analysedPercent` for the blurry and screenshots queues. `duplicates` is counted through the duplicate repository. One request per card, all fired in parallel by the hub                                                                                                                                  |
| `GET /cleanup/trash`                       | `{count, bytes}`                                                                                                                                                                                                                                                                                                                  |
| `GET /cleanup/calendar?tz=`                | 366 × `{monthDay, assetCount, reviewedAt \| null}`, plus `{daysReviewed, streak}`. `tz` is the browser's IANA zone. **Streak** = the number of consecutive local calendar dates, ending today or yesterday, on which at least one day was completed (derived from `reviewedAt`). Catching up several days on one date counts once |
| `GET /cleanup/rewind/{monthDay}?year=`     | One year at a time: `{id, type, localDateTime, thumbhash, ratio, fileSize, kept}` plus the list of years with counts                                                                                                                                                                                                              |
| `POST /cleanup/rewind/{monthDay}/complete` | Upsert `cleanup_day_review`                                                                                                                                                                                                                                                                                                       |
| `GET /cleanup/queues/{queue}`              | Keyset page (`cursor`, `limit`) with per-queue parameters. Bursts return `{groupId, source: 'burstId' \| 'timeWindow', assets[], suggestedKeepId}`                                                                                                                                                                                |
| `PUT /cleanup/decisions`                   | `{queue, assetIds, decision: 'keep'}`                                                                                                                                                                                                                                                                                             |
| `DELETE /cleanup/decisions`                | `{queue, assetIds}` — undo a keep                                                                                                                                                                                                                                                                                                 |

Reused unchanged: `DELETE /assets` (trash), `PUT /assets` (favourite), `POST /stacks` ("Stack instead"), and the
trash empty endpoint. Trash semantics, audit rows and sync events therefore behave exactly as they do today.

### Web

- Components in `web/src/lib/components/cleanup/`: `CleanupCalendar` (a 12 × 31 grid shaded by photo count, with
  reviewed and today states and a hover peek), `CleanupQueueRail`, `RewindYearSection`, `RewindGrid`,
  `BurstGroupCard` (keep 1 and trash the rest / keep all / stack instead), `QueueSelectGrid` (screenshots and
  blurry: trash selected / not a problem), `SpaceHogList`.
- **Rewind batches its changes.** A `RewindSession` class (runes) holds keep, favourite and trash marks locally,
  and `Z` undoes. "Move N to trash" and "Finish day" commit in this order:
  1. `DELETE /assets` for trash marks
  2. `PUT /assets` for favourites
  3. `PUT /cleanup/decisions` for keeps and favourites
  4. `…/complete`, for "Finish day" only

  Commits go out in chunks of 1,000 IDs with a progress state. Leaving with uncommitted marks shows a
  confirmation modal. Default mode is the grid by year; years load lazily as you scroll.

- **Queue pages act immediately**, with the standard "Moved to trash · Undo" toast, matching the duplicates page.
- **Shortcuts** via `$lib/actions/shortcut` and `ShortcutsModal`: `K` keep, `F` favourite, `Del` trash, arrows to
  move, `Space` open in the asset viewer, `Z` undo, `Shift+Enter` finish day.
- i18n: new `cleanup_*` keys in `en` plus the nine required locales. The admin Jobs card gets a label.

## Scale (500k+ assets per user)

- No `OFFSET` anywhere. Keyset pagination on `(fileSizeInByte, id)` and `(localDateTime, id)`.
- The hub renders immediately. Counts and calendar arrive as independent parallel requests, so a slow one never
  blocks the others.
- Bursts pages walk forward from the cursor in windows of about 2,000 photos using the index. The count is a
  single ordered index pass with `lag()`. If that misses the budget in measurement, fall back to a per-user
  cached count refreshed after quality analysis.
- A rewind day at 500k assets is about 1,400 photos, so it is fetched a year at a time.
- **Budget:** every cleanup endpoint under 300 ms at p95 for a 500k-asset user.
- **Index safety check** (a required plan task):
  - On a synthetic 500k seed (a dev `generate_series` script) and a personal-instance clone, capture
    `EXPLAIN (ANALYZE, BUFFERS)` **before and after** the migrations for: timeline bucket list and bucket
    contents, the legacy large-assets search, metadata search sorted by size, smart search, sync-stream asset
    queries, and the duplicate nearest-neighbour search.
  - A plan may change only on a query we meant to speed up.
  - Also time a bulk-insert pass (an external-library scan) before and after.
  - Run as the `gallery` role (`psql` as `postgres` misses `jit=off`).
  - Expected cost: the `asset` partial expression index cannot match any existing query. The `asset_exif`
    size index can only change size-sorted plans, and should improve them. Writes pay one extra index entry;
    HOT updates are lost only on updates that change the indexed columns.

## Edge cases

- **Asset trashed or deleted elsewhere during a rewind session:** the commit skips missing or trashed IDs and
  reports them, rather than failing the batch.
- **Restored from trash:** the asset re-enters any queue it matches. This is intended.
- **Live photos:** trashing the still trashes the motion part through the existing path. Sizes include the
  motion file.
- **Stacks:** excluded from Bursts. Elsewhere a stack is represented by its primary asset.
- **Not yet analysed:** the Blurry and Screenshots cards show "Analysing… N% of library", never a misleading 0.
- **Owned assets that are in a Space:** trashing removes them for Space members too (today's behaviour). The
  confirmation says so when the selection contains such assets.

## Testing

- **Server unit:** Laplacian variance on synthetic sharp and blurred buffers; clipping; the screenshot heuristic
  table (filenames, EXIF, PNG, aspect ratio); service scoping and permissions.
- **Server medium (real DB):** every queue query, including keyset pagination, keep exclusion, the
  include/exclude rules and the burst 2 s boundary with and without `autoStackId`; calendar counts; day-complete
  upsert; the migration static guards.
- **Web unit:** `RewindSession` (mark, undo, commit order, chunking, partial failure); calendar states; the
  unsaved-marks confirmation.
- **E2E (Playwright):** hub → rewind → mark → commit → the asset is in trash; one queue keep and one queue trash
  flow.
- **Performance:** the index safety check and 300 ms budget above; blur threshold calibration on the personal
  clone.
