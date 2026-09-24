# Library Cleanup — design

Status: approved in brainstorming on 2026-09-23. Revised the same day after a claim-by-claim check against the
codebase (see [Review corrections](#review-corrections)).
Visual reference: `specs/mockups/2026-09-23-library-cleanup-mockups.html`. It is **binding for layout and
interaction** — see [Visual reference](#visual-reference).

## Goal

A place users return to regularly that does two jobs at once:

1. **Relive.** A daily _rewind_ of every photo taken on today's date in every past year, reviewed one date at a
   time until the whole library has been seen once.
2. **Tidy.** A set of cleanup _queues_ that can each be drained to zero: largest files, bursts, screenshots and
   blurry or botched photos, plus the existing duplicates utility.

Success means a user can open Cleanup, finish today's date in a few minutes and act on a queue. Every action
can be undone until the trash is emptied.

## Scope

**In v1**

- Web only. Mobile can later reuse the same endpoints.
- Only the requesting user's **own** assets. Deleting an asset is owner-only by design
  (`specs/2026-03-23-spaces-permissions-matrix.md`). Cleanup by admins or space editors would change that model
  and needs its own design.
- Queues: **Space hogs**, **Bursts & series**, **Screenshots**, **Blurry & botched**, and **Duplicates**. The
  duplicates queue is a count plus a link; the existing `/utilities/duplicates` page is not rebuilt.
- A daily **Rewind**, a year **calendar** where reviewed dates fill in, and a streak.
- "Trash" always means the recoverable trash. Nothing is permanently deleted from Cleanup except through the
  existing "Empty trash" action — unless the administrator has turned the trash off, in which case Cleanup
  deletes permanently after an explicit confirmation, as the duplicates utility does (see Edge cases).

**Not in v1**

- Queues for receipts and documents, messenger saves, accidental short videos and low-resolution copies.
- Stripping the motion part of live photos, shrinking (re-encoding) large videos, and blur scoring for videos.
- A "space freed this month" counter. Once the trash is emptied the assets are gone, so crediting the freed
  bytes to Cleanup would need a dedicated ledger. The hub shows "could still free X" and "trash holds Y"
  instead.
- A sidebar entry or badge.
- Re-scoring edited assets (see [Quality analysis job](#quality-analysis-job)).

## Placement

Cleanup is a new entry at the top of the "Organize your library" group in
`web/src/routes/(user)/utilities/UtilitiesMenu.svelte`. The existing Duplicates, Large files, Geolocation and
Workflows entries stay as they are. The Utilities sidebar item already stays highlighted for any path under
`/utilities/...` (`sidebar-nav-item.svelte` does a prefix match), so the sidebar needs no change.

| Route                                                                   | Page                                                                                                                         |
| ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `/utilities/cleanup`                                                    | Hub: the year calendar with hover-to-peek, a queue rail showing counts and bytes, a "Rewind today" button and a trash footer |
| `/utilities/cleanup/rewind/[monthDay]/[[photos=photos]]/[[assetId=id]]` | Rewind for one date, grouped by year                                                                                         |
| `/utilities/cleanup/[queue]/[[photos=photos]]/[[assetId=id]]`           | One queue page each for `space-hogs`, `bursts`, `screenshots` and `blurry`                                                   |

The optional `[[photos=photos]]/[[assetId=id]]` segments open the existing asset viewer, following the pattern
the large-files page uses. The Duplicates card links to the existing `/utilities/duplicates`.

**Upstream files touched on the web side:**

- `UtilitiesMenu.svelte`: one link.
- `web/src/lib/route.ts`: the `Route.cleanup*` helpers. The fork already patches this file for spaces, import
  and so on.
- `web/src/lib/services/queue.service.ts` and `web/src/routes/admin/system-settings/JobSettings.svelte`: both
  are `Record<QueueName, …>` and fail typecheck until the new queue has an entry.
- `web/src/lib/constants.ts` (`ADMIN_VISIBLE_QUEUES`).
- `i18n/*.json`.

## Visual reference

The web UI must look and behave like `specs/mockups/2026-09-23-library-cleanup-mockups.html`. Open it in a
browser; its tabs are the screens. The mockup is built from Gallery's own palette and app shell, so build it
with `@immich/ui` components and Tailwind rather than copying its CSS. The mockup uses placeholder data and
colour blocks instead of photos. Where it disagrees with this spec, the spec wins.

| Mockup tab               | Route / component                               | Must match                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ------------------------ | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **2 · Hub**              | `/utilities/cleanup`                            | Two columns. **Left:** the calendar card, a grid of 12 month rows by 31 day columns. Cells are shaded by photo count, reviewed dates are green and today is outlined; a legend sits below. Under the card is the hover **day peek** strip: date, photo count, a row of thumbnails and a "Rewind this day" button. **Right:** a **queue rail** card. Each row shows a thumbnail, the queue name, a one-line description, a count and the space it would free ("−bytes"). A trash footer holds an "Empty" button. **Header:** the streak and days-reviewed subtitle, a "Could still free" chip and the primary "Rewind today" button. Below roughly 980px the two columns stack into one                                                                                                                                               |
| **3 · Daily rewind**     | `/utilities/cleanup/rewind/[monthDay]`          | **Header:** the title "<date>, across N years", a Grid / One-at-a-time toggle (grid is the default), buttons for the previous and next date, a progress bar with a keep / favourite / trash / untouched summary, and a "Hide reviewed" toggle. **Body:** one section per year, headed "N years ago · place · count" with a "Keep all remaining" action. **Marks:** keep is a green border with ✓, favourite a pink border with ♥, trash a greyed tile with a red "TRASH" overlay; the focused tile gets a primary-colour ring. **Footer:** a sticky **action bar** with the shortcut legend, "Move N to trash" and "Finish day ✓". **One-at-a-time mode:** a dark stage, four round buttons (trash, skip, favourite, keep), a filmstrip of upcoming photos, and a hints card (burst, low sharpness) that links to the relevant queue |
| **4 · Bursts & series**  | `/utilities/cleanup/bursts`, `BurstGroupCard`   | **Page header:** "Keep all on page" and "Accept suggestions on page (−bytes)". **Each group is a card:** the time range, an "N shots · size" chip, a source chip ("camera burst" or "same moment"), the place, and the actions Keep all / Stack instead / **Keep 1, trash N−1**. Its thumbnail row gives the suggested pick a **★ SHARPEST** badge and a keep mark, and pre-marks the others as trash. Clicking a thumbnail toggles its mark                                                                                                                                                                                                                                                                                                                                                                                         |
| **5 · Blurry & botched** | `/utilities/cleanup/blurry`, `QueueSelectGrid`  | **Header actions:** "Not a problem (keep)" and "Trash N selected". **Toolbar:** reason chips with counts (All / Blurry / Too dark / Overexposed), the **strictness slider** (lenient / balanced / strict) and a "Hide photos with faces" toggle. **Body:** a grid of selectable tiles, each with a reason badge. Screenshots uses the same component without the slider or the reason chips                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| **6 · Space hogs**       | `/utilities/cleanup/space-hogs`, `SpaceHogList` | **Header:** a total ("Your N largest files take up X, Y% of your library"), a Videos / Photos / All toggle and a minimum-size control. **Each row:** a thumbnail (▶ on videos), the filename, the signals "type · resolution · duration · year · album/favourite", the size with a proportional bar, and Keep / Trash buttons                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 1 · Hub A, 7 · Mobile    | —                                               | **Not to be built.** Tab 1 is the rejected hub layout. Tab 7 is a direction for the later mobile release                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |

Required on every page:

- The breadcrumb `Utilities / Cleanup / <page>`. The Utilities sidebar item stays active; there is no Cleanup
  sidebar item.
- Tabular figures for counts and byte sizes.
- Dark mode through the existing theme tokens.
- The calendar is a new 12 × 31 component. The existing `CalendarHeatmap.svelte` lays out by week, so it does
  not fit and is not reused.

## Architecture: store facts, decide at query time

Only blur and exposure need to look at pixels, so only those are precomputed. They are stored as raw **facts**
(scores), never as queue **verdicts**. Queue membership, burst groups and size rankings are computed on each
request. Thresholds are passed as query parameters, so moving the strictness slider or tuning a threshold never
requires re-running a job.

### Data model (fork-only migrations in `server/src/schema/migrations-gallery/`)

**`asset_quality`** — one row per analysed asset.

| Column                         | Type                               | Notes                                                                                          |
| ------------------------------ | ---------------------------------- | ---------------------------------------------------------------------------------------------- |
| `assetId`                      | PK, FK → `asset` ON DELETE CASCADE |                                                                                                |
| `ownerId`                      | FK → `user` ON DELETE CASCADE      | Copied from the asset so per-owner counts never have to join through `asset`                   |
| `sharpness`                    | real, nullable                     | Variance of the Laplacian on a 512px greyscale preview. Null for videos and for failed decodes |
| `brightness`                   | real, nullable                     | Mean brightness, 0–255                                                                         |
| `clippedDark`, `clippedBright` | real, nullable                     | Share of pixels that are near-black (≤ 8) or near-white (≥ 247)                                |
| `isScreenshot`                 | boolean, not null                  | Set by a heuristic, see below                                                                  |
| `version`                      | smallint, not null                 | Version of the scoring algorithm. Bumping it makes "Missing" re-analyse the asset              |

Indexes: `(ownerId, sharpness)`, and a partial index `(ownerId) WHERE "isScreenshot"`.

**`cleanup_decision`** — a user's "keep" choices, so that queues drain to zero.

| Column                       | Type                                                                   |
| ---------------------------- | ---------------------------------------------------------------------- |
| `userId`, `queue`, `assetId` | Composite PK. Both FKs are ON DELETE CASCADE                           |
| `decision`                   | `'keep'`. Trash is not stored here because the trash itself records it |
| `createdAt`                  | timestamptz                                                            |

`queue` is one of `rewind | space_hogs | bursts | screenshots | blurry`. A keep applies to **one queue only**:
"not blurry" does not mean "not a duplicate". A keep in `rewind` also marks the photo as seen.

**`cleanup_day_review`** — records which dates the user has finished.

- Primary key: `userId` plus `monthDay`, a smallint equal to `month*100+day` (e.g. `923` for 23 September,
  `229` for 29 February).
- `reviewedAt` (timestamptz): the latest completion wins, which leaves room for a yearly re-review later.

**`asset_job_status.qualityAnalyzedAt`**: a nullable timestamptz column, following the same pattern as
`classifiedAt` and `petsDetectedAt`.

**Indexes on upstream tables** (added by fork migrations, declared with `@Index` in the upstream table files,
which follows the precedent of `asset-exif.table.ts` and `person.table.ts`):

- `asset_localMonthDay_idx` on `asset`: a partial expression index.
  - Columns: `("ownerId", ((extract(month from ("localDateTime" at time zone 'UTC')) * 100 + extract(day from ("localDateTime" at time zone 'UTC')))::smallint), "localDateTime")`.
  - Condition: `WHERE "deletedAt" IS NULL AND "visibility" IN ('timeline','archive') AND "isOffline" = false AND "libraryId" IS NULL`.
  - It is an expression index, so the migration also inserts its `migration_overrides` row (precedent:
    `1782000000000-AddAssetExifDescriptionTrigramIndex.ts`).
  - The calendar and rewind queries must repeat this expression and condition **verbatim**; otherwise
    PostgreSQL will not use the index.
  - The trailing `"localDateTime"` key makes the calendar count an index-only scan that reads the stored
    month-day value. Without it, PostgreSQL evaluates the expression for every row: 279 ms p95 at 500k
    assets, against 25 ms p95 with it (the performance check below).
- `asset_cleanup_localDateTime_idx` on `asset`: a partial btree on `("ownerId", "localDateTime", "id")` with
  the same condition as `asset_localMonthDay_idx`, so only Cleanup queries can use it. It serves the keyset
  pages in `(localDateTime, id)` order: bursts windows, screenshots and blurry. Their cursors are written
  as row comparisons (`("localDateTime", "id") > (x, y)`), which PostgreSQL turns into an index condition.
  Without this index every bursts window was a sequential scan plus a sort, and a page of 100 burst groups
  took 1,064 ms p95 at 500k assets (150 ms p95 with it). The migration inserts its `migration_overrides`
  row, because it is a partial index.
  - The cursor timestamp is the database's own microsecond value, selected as
    `to_char(... 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')` and compared as `::timestamptz`. A JS `Date` holds only
    milliseconds, so a cursor built from one would repeat rows (ascending bursts) or skip them (descending
    screenshots and blurry) for any `localDateTime` with sub-millisecond digits.
  - The bursts window extension is capped at 10 extra windows, as a safety net against a run with no gap.
- `asset_exif_fileSizeInByte_idx`: a **plain** single-column btree on `asset_exif ("fileSizeInByte")`.
  PostgreSQL can scan a btree backwards, so `ORDER BY … DESC` is served without declaring `DESC`. A plain
  `columns` index needs no `migration_overrides` row (precedent: `person_personGroupId_key`).

**Other obligations for the migrations:**

- Register every new migration in `server/src/schema/migrations-gallery/ORDER`. The CI job
  `migration-order.yml` checks this list.
- The schema decorators must match the migrations exactly. CI job `sql-schema-up-to-date` fails if
  `migrations:generate` produces any diff, and the medium test `schema-drift.spec.ts` compares the schema in
  code with the real database.
- Update `scripts/revert-to-immich.sql`. The unit test `revert-to-immich.spec.ts` only checks a subset of this
  script, so the real gate is CI job `gallery-revert-to-immich-validation.yml`, which boots upstream Immich after
  running the revert. The script needs:
  - `DROP TABLE` for `cleanup_decision`, `cleanup_day_review` and `asset_quality`, in foreign-key order.
  - In step 4: `DROP COLUMN asset_job_status."qualityAnalyzedAt"` and `DROP INDEX` for all three upstream-table
    indexes.
  - The `migration_overrides` names `index_asset_localMonthDay_idx` and `index_asset_cleanup_localDateTime_idx`.
  - Entries in the `fork_tables_left` list and the `kysely_migrations` delete list.

### Include and exclude rules (every queue, rewind and calendar)

- **Included:** assets owned by the user with `deletedAt IS NULL`, including **archived** ones (they still use
  storage).
- **Excluded:**
  - `visibility` of `hidden` (the motion part of a live photo) or `locked`.
  - `isOffline`.
  - Any asset with a `libraryId` (external library). Trashing those does not free the file on disk.
- **Stacks (queues only):** in a queue, an asset appears only if it is not in a stack or is the stack's primary. **Rewind and the calendar show every in-scope asset, stack members included**: rewind is about seeing every photo, and leaving the stack rule out keeps the calendar count answerable from the partial index alone. If the primary asset is
  in the trash, the stack drops out of Cleanup until the primary is restored or the trash is emptied. When the
  trash is emptied, the existing hard-delete path reassigns the primary.

These rules live in one repository helper, `withCleanupScope(qb, userId)`, which every query uses. It writes
the visibility filter as `AssetVisibility.Timeline` / `AssetVisibility.Archive`. That form also gives the
shared-space guard its visibility marker.

### Quality analysis job

- **Registration**, modelled on Classification. A new `QueueName.QualityAnalysis` and the jobs
  `JobName.AssetAnalyzeQuality` / `AssetAnalyzeQualityQueueAll`. The queue has to be registered everywhere the
  code keys on `QueueName`:
  - `enum.ts`
  - the `JobItem` union in `types.ts`
  - `galleryJobDefaults` in `gallery/config.dto.ts` (concurrency 2)
  - `AdminConfigJobDto` in `dtos/config.dto.ts`
  - `QueuesResponseLegacyDto` in `dtos/queue-legacy.dto.ts`
  - `queue.service.ts`: the command switch and the "concurrency is configurable" set
  - `services/index.ts`
  - web: `ADMIN_VISIBLE_QUEUES`, `queue.service.ts` (icon, title, subtitle) and `JobSettings.svelte`
  - `queue.service.spec.ts`, which expects every `QueueName`
- **Chaining:** in `job.service.ts`, the `onDone` handler for `AssetGenerateThumbnails` queues the new job next
  to the fork's existing `PetDetection` hook, so uploads are analysed automatically. External-library scans also
  pass through this hook (`source: 'upload'`), so the handler skips assets that have a `libraryId`. The QueueAll
  query excludes them as well.
- **Admin Jobs card, "Quality analysis":**
  - **Missing** picks assets where `qualityAnalyzedAt IS NULL`, or whose `asset_quality.version` is older than
    the current one. Like the classification query, it inner-joins `asset_job_status`. It applies the scope
    rules and streams the ids.
  - **All** re-runs every asset.
- **Per image:**
  1. Resolve the **unedited preview**: `withFilePath(eb, AssetFileType.Preview)`, which defaults to
     `isEdited = false`, the same file pet detection and OCR read. If there is no preview yet, return
     `Skipped` without writing; the thumbnail chain will queue the job again.
  2. `const { localPath, cleanup } = await this.ensureLocalFile(path)` from `BaseService`. It returns the path
     unchanged on disk and downloads to a temporary file on S3. Call `cleanup()` in a `finally` block.
  3. With `sharp(localPath)`: flatten any alpha channel, convert to greyscale, resize to 512px on the long edge
     and read the raw buffer.
  4. **Sharpness:** apply a 3×3 Laplacian (`0 1 0 / 1 -4 1 / 0 1 0`) in TypeScript over the interior pixels,
     then take the variance. It is done in TypeScript because sharp's `convolve` clamps results to 0–255,
     which destroys the negative responses. A flat image scores 0.
  5. **Brightness** and **clipping** come from the same buffer.
  6. Upsert `asset_quality`, then set `qualityAnalyzedAt`.
  7. **If decoding fails:** write the row with null scores, still set `qualityAnalyzedAt`, and log a warning.
     This prevents a "Missing" retry loop. Null scores never match a quality rule.
- **`isScreenshot`**, all of it pure logic in a unit-tested function:
  - The original filename matches a pattern list that covers several locales: `Screenshot`,
    `Screen Shot`, `Screen Recording`, `Bildschirmfoto`, `Capture d'écran`, `Schermafbeelding`,
    `Captura de pantalla`, `Screenshot_`, `截屏`, `スクリーンショット`;
  - **or** there is no camera make or model **and** either the file is a PNG or its aspect ratio (long side over
    short side) is at least 2.0.
- **Videos** get only `isScreenshot`, which catches screen recordings. Their sharpness and brightness stay null.
- **Edited assets are not re-scored.** The score describes the unedited preview, which is the same file other
  analysis jobs read. The thumbnail job for an edit does not chain, and that is accepted for v1.

### Queue rules (applied at query time, on top of the scope rules)

| Queue       | Rule                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Space hogs  | Sort by `fileSizeInByte DESC, id DESC`. `fileSizeInByte IS NOT NULL`. Optional filters: `type`, and `minSize` in bytes. For a live photo, the displayed size adds the motion part's size (joined through `livePhotoVideoId`)                                                                                                                                                                                                                                                                                                                                                               |
| Bursts      | Images only, sorted by `localDateTime`. A new group starts when the gap exceeds 2 seconds or `autoStackId` changes; a group needs at least 2 members. A group without an `autoStackId` must also pass a CLIP check: each member's `smart_search.embedding <=>` distance to the first member must be ≤ 0.1. That check runs only for the current page. A member with no embedding makes the group fail the check. Stacked assets are excluded entirely. Assets with a `bursts` keep are excluded **before** grouping. Suggested keep: highest `sharpness`, then largest file, then earliest |
| Screenshots | `asset_quality.isScreenshot`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Blurry      | Images only. The `reason` parameter is `blurry`, `dark`, `bright` or `all` (default `all`). `blurry`: `sharpness < T[strictness]`, where strictness is `lenient`, `balanced` (default) or `strict`. `dark`: `brightness < 35 AND clippedDark > 0.5`. `bright`: `clippedBright > 0.4`. `hideFaces` (default **on**) excludes assets that have any face with `deletedAt IS NULL AND isVisible`. The T values are constants in one place, calibrated on a clone of the personal instance before release                                                                                       |
| Duplicates  | Count and bytes only, using a new query that mirrors `DuplicateRepository.getAll`'s filters: `duplicateId` set, default visibility, `deletedAt` null, `stackId` null, and groups of more than 1. Bytes = the sum of each group's sizes minus that group's largest file. The existing page does the resolving                                                                                                                                                                                                                                                                               |
| All         | Exclude assets that have a `cleanup_decision` keep for that queue                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |

Rewind and the calendar use the month and day of `localDateTime` (the wall-clock time at capture), through the
index expression above. 29 February is a date of its own.

### API

`CleanupController` → `CleanupService` → `CleanupRepository`. The repository is registered in
`BASE_SERVICE_DEPENDENCIES` and the constructor list of `base.service.ts` (the fork's `ClassificationRepository`
is the precedent), in `newTestService` in `test/utils.ts`, and in the real and mock repository switches of
`medium.factory.ts`.

- Every endpoint is scoped to `auth.user.id`. New permissions: `cleanup.read` and `cleanup.update`.
- DTOs are Zod schemas. Every enum carries `.meta({ id })`: `CleanupQueue`, `CleanupDecision`,
  `CleanupStrictness`, `CleanupBlurReason` and `CleanupBurstSource`. An anonymous enum on a request body
  generates `Type2`-style names that break the Dart client.
- `monthDay` is validated as a real calendar date (`229` is allowed; `230`, `431` and `1301` return 400). `tz`
  must be a valid IANA timezone name.
- Every endpoint that returns queue items also accepts `cursor`, `limit` (default 100, max 500) and returns
  `nextCursor`.

| Endpoint                                | Purpose                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /cleanup/queues/{queue}/count`     | Returns `{count, bytes, analysedPercent?}`. `queue` also accepts `duplicates`. `analysedPercent` is included for `blurry` and `screenshots`: analysed in-scope assets divided by all in-scope assets, or 100 when there are none. The hub sends one of these per card, all in parallel. For `space_hogs`, `count` is the number of in-scope files at or above `minSize` (default 100 MiB, shared with the page's default filter) and `bytes` is their total. The same filter query parameters as the list are accepted |
| `GET /cleanup/trash`                    | Returns `{count, bytes}` for the user's trashed assets that are not in an external library                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `GET /cleanup/calendar?tz=`             | Returns 366 rows of `{monthDay, assetCount, reviewedAt \| null}`, plus `{daysReviewed, streak}`. **Streak** counts consecutive dates in the viewer's timezone, ending today or yesterday, on which at least one day was completed; catching up on several days in one sitting counts once. `daysReviewed` counts only dates that have photos                                                                                                                                                                           |
| `GET /cleanup/rewind/{monthDay}`        | Returns `{years: [{year, count}]}`, newest first                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `GET /cleanup/rewind/{monthDay}/{year}` | Returns that year's assets: `{id, type, originalFileName, localDateTime, thumbhash, width, height, duration, fileSize, isFavorite, inAlbum, kept, city}`, plus `reason` (the Blurry reason at the default strictness, for the one-at-a-time hints card; the burst hint is computed client-side with the 2 s gap rule). The queue pages use the same asset shape                                                                                                                                                                                                                                                                                                                     |
| `GET /cleanup/queues/{queue}`           | A keyset page of items, with the per-queue parameters above. Bursts returns `{groupId, source: 'burstId' \| 'timeWindow', assets[], suggestedKeepId}`. A group is never split across two pages: the scan keeps reading past the ~2,000-row window until it finds a gap. A bursts page may hold fewer than `limit` groups, even none, while `nextCursor` is non-null (the per-page scan cap, see Scale)                                                                                                                                                                                                                                                 |
| `POST /cleanup/commit`                  | Body: `{queue, trashIds[], favoriteIds[], keepIds[], completeMonthDay?}` (at most 1,000 ids per list). Returns `{trashed, favorited, kept, skipped[]}`. See below                                                                                                                                                                                                                                                                                                                                                      |
| `DELETE /cleanup/decisions`             | Body: `{queue, assetIds}`. Removes a keep                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `POST /cleanup/in-spaces`               | Body: `{assetIds}` (at most 1,000). Returns `{assetIds}`: the subset of the caller's own ids that belong to any shared space. It is a POST so that long id lists do not have to fit in a URL                                                                                                                                                                                                                                                                                                                           |

**Why `POST /cleanup/commit` exists instead of calling `DELETE /assets` directly.** `DELETE /assets` and
`PUT /assets` are all-or-nothing: a single missing, foreign or locked id makes the whole batch return 400.
Re-trashing an already-trashed id also overwrites `deletedAt`, which restarts its auto-empty clock.

`CleanupService.commit` therefore:

1. Filters every id list down to assets the caller owns that are still inside the cleanup scope. Everything
   else goes into `skipped[]` with a reason (`not_found` (which also covers another user's ids, so that their existence is not confirmed), `out_of_scope` or `already_trashed`)
   instead of failing the request.
2. For the remaining trash ids, does exactly what `AssetService.deleteAll` does for a non-forced delete:
   `assetRepository.updateAll(ids, {deletedAt: now, status: Trashed})`, then emits `AssetTrashAll`. That keeps
   websocket and sync behaviour identical.
3. Sets `isFavorite` on the favourite ids.
4. Upserts `keep` decisions for the keep ids and the favourite ids. A favourite is always a keep.
5. Upserts `cleanup_day_review` if `completeMonthDay` is set.

These run in that order. Steps 3–5 share one database transaction; the trash update and its event come first.
The endpoint requires `cleanup.update`, which is documented as including the ability to trash the caller's own
assets.

**Reused as they are:** `POST /stacks` for "Stack instead", `POST /trash/restore/assets` for Undo, and
`POST /trash/empty` for "Empty".

### Web

- **Components** live in `web/src/lib/components/cleanup/`:
  - `CleanupCalendar`: the 12 × 31 grid with shading, reviewed and today states, and the hover peek.
  - `CleanupQueueRail`.
  - `RewindYearSection` and `RewindGrid`.
  - `BurstGroupCard`.
  - `QueueSelectGrid`.
  - `SpaceHogList`.

  Tiles are square crops loaded lazily through the existing thumbnail URL helper, with the thumbhash as a
  placeholder. `GalleryViewer` is not used, because it needs full `AssetResponseDto`s and a justified layout.

- **Rewind marks locally, then commits.**
  - A `RewindSession` class (Svelte runes) holds the keep, favourite and trash marks, with an undo stack
    (`Z`).
  - "Move N to trash" and "Finish day" send `POST /cleanup/commit`, in chunks of 1,000 ids, with a progress
    state. They then report anything skipped ("3 photos had already changed and were skipped").
  - "Finish day" sends `completeMonthDay` on its last chunk only.
  - Leaving the page with marks that have not been committed shows a confirmation modal. So do the
    previous/next-date buttons.
  - Years load one at a time as the user scrolls. Grid is the default mode; one-at-a-time is a toggle.
- **Queue pages** act immediately through `POST /cleanup/commit`. After a trash they show the toast
  `assets_trashed_count` with an **Undo** button (5-second timeout). Undo calls `restoreAssets` for the ids that
  were actually trashed. This is the existing `deleteAssets(…, onUndoDelete)` pattern in `lib/utils/actions.ts`.
  The duplicates page shows no Undo, so it is not the model here.
- **Group actions on Bursts** always resolve every member of the group. "Keep 1, trash N−1" and "Accept
  suggestions" keep the marked photos and trash the rest. "Keep all" keeps every photo. "Stack instead" calls
  `POST /stacks` with the suggested keep first, so it becomes the primary. A group therefore never comes back
  half-resolved.
- **Shortcuts** use `$lib/actions/shortcut`: `K` keep, `F` favourite, `Delete` trash, arrow keys to move,
  `Space` to open the focused photo in the viewer, `Z` undo and `Shift+Enter` finish the day.
  - Following the existing `assetViewerManager.isViewing ? [] : …` pattern, all of them are **turned off while
    the asset viewer is open**, because the viewer already uses `z` for zoom and `Space` for video play/pause.
  - `ShortcutsModal` receives the page's own list through its `shortcuts` prop.
- **Confirmation for Space assets.** Before trashing, the page calls `POST /cleanup/in-spaces`, which returns
  the ids that belong to any shared space through the direct (`shared_space_asset`) or album
  (`shared_space_album` → `album_asset`, `album.deletedAt IS NULL`) route. The library route cannot apply,
  because external-library assets are out of scope. If any ids come back, the confirmation says those photos
  will disappear for Space members too.
  - The query lives in `cleanup.repository.ts`. It returns ids only, so it gets a `VIS_ALLOWLIST` entry in
    `shared-space-album-scope.guard.spec.ts` with that reason. It does not reference `shared_space_library`, so
    `ALBUM_ALLOWLIST` is not needed.
- **i18n:** new `cleanup_*` keys go into `en.json` and the nine required locales, sorted. `fork-string-parity`
  requires every key in all nine. The admin Jobs card and `JobSettings` labels use i18n keys, not hard-coded
  English.

## Scale (users with 500,000+ assets)

- No `OFFSET` anywhere. Pagination uses keysets: `(fileSizeInByte, id)` and `(localDateTime, id)`.
- The hub renders immediately. The counts, the trash total and the calendar are separate requests sent in
  parallel, so a slow one never blocks the others.
- Bursts pages walk forward from the cursor through the `(ownerId, localDateTime)` range, in windows of about
  2,000 rows. A group that crosses a window edge is extended rather than split.
  - A page starts at most `CLEANUP_BURST_MAX_WINDOWS_PER_PAGE = 8` window queries (~13 ms each at 500k,
    so ~105 ms; ~235 ms in the worst case, where the last window still extends by up to
    `CLEANUP_BURST_MAX_EXTENSIONS = 10`). Without the cap a library with few bursts, and every last page,
    scanned to the end of the library (~250 windows at 500k). When the cap is reached the page ends early —
    with fewer than `limit` groups, possibly none — and a non-null `nextCursor` just past the last scanned
    window; the web pager keeps requesting pages while the list end is in view, and only `nextCursor: null`
    means the queue is exhausted.
  - The bursts **count** is one ordered pass using `lag()`. It counts candidate groups **before** the per-page CLIP check, so it is an upper bound; the hub row labels it as "up to N".
  - If that pass misses the time budget during measurement, fall back to a per-user cached count, refreshed
    after quality analysis. The implementation plan records which option was chosen.
  - Measured (2026-09-24, 500k synthetic seed): the first shape grouped every row and spilled a ~450k-group
    hash aggregate to disk (377 ms p95). Adding `lead()` to mark each group's last row lets the pass drop
    singletons before grouping (239 ms p95; 248 ms at the endpoint), so the live count was kept and no cache
    was added.
- A single date at 500k assets holds about 1,400 photos, so rewind fetches them one year at a time.
- **Time budget:** every cleanup endpoint must answer in under 300 ms at p95 for a user with 500k assets.
- **Index safety check** (a required implementation task):
  - On a synthetic seed of 500k assets (a dev script using `generate_series`) and on a clone of the personal
    instance, capture `EXPLAIN (ANALYZE, BUFFERS)` **before and after** the migrations for these existing
    queries: the timeline bucket list and bucket contents, the legacy large-assets search, metadata search
    sorted by size, smart search, the sync-stream asset queries, and the duplicate nearest-neighbour search.
  - Only a query we meant to speed up may change its plan.
  - Also time a bulk insert (an external-library scan) before and after.
  - Run everything as the `gallery` role; `psql` as `postgres` does not pick up `jit=off`.
  - Expected cost:
    - The partial expression index can only match a query that uses its exact expression.
    - The plain `fileSizeInByte` index can only change plans that sort or filter by size, and should improve
      them.
    - Each write pays for one more index entry, and loses the in-place (HOT) update only when it changes an
      indexed column.

## Edge cases

| Case                                                                   | Behaviour                                                                                                                                                               |
| ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Asset trashed or deleted elsewhere, or in another tab, before a commit | Reported in `skipped[]` (`already_trashed` / `not_found`). The rest of the batch succeeds and the UI reports how many were skipped                                      |
| Ids of another user's assets sent to `commit`                          | Reported in `skipped[]` as `not_found`, exactly like a missing id, so the response does not confirm that they exist                                                     |
| Locked, hidden, offline or external-library ids sent to `commit`       | Reported in `skipped[]` as `out_of_scope`                                                                                                                               |
| Restored from the trash                                                | The asset returns to any queue it matches. This is intended                                                                                                             |
| Keep decisions on assets that are later trashed or restored            | The keep stays. It still applies after a restore                                                                                                                        |
| Live photo still trashed                                               | The motion part is **not** trashed; it stays hidden until the trash is emptied. Its size is still counted with the still                                                |
| Stack primary in the trash                                             | The stack drops out of Cleanup until the primary is restored or the trash is emptied                                                                                    |
| Capture date edited                                                    | The photo moves to its new date immediately, because dates are computed at query time. Decisions follow the asset                                                       |
| User with no assets, or a date with no photos                          | The calendar shows 0 for that date and it cannot be completed. Counts are 0 and `analysedPercent` is 100                                                                |
| Analysis not finished                                                  | The Blurry and Screenshots rows show "Analysing… N%", never a misleading 0                                                                                              |
| No preview yet, or the preview is on S3                                | No preview: the job is Skipped and runs again through the thumbnail chain. S3: the preview goes through `ensureLocalFile`, with the temporary file removed in `finally` |
| Preview that is corrupt or cannot be decoded                           | Null scores, `qualityAnalyzedAt` set, a warning logged, and no retry loop                                                                                               |
| Flat or solid-colour photo                                             | Sharpness is 0, so it lands in Blurry. That is acceptable: such photos are almost always accidental                                                                     |
| Photo with an alpha channel                                            | Flattened before scoring                                                                                                                                                |
| Invalid `monthDay`, `tz` or enum value                                 | 400                                                                                                                                                                     |
| More than 1,000 ids in one `commit` list                               | 400. The client splits into chunks                                                                                                                                      |
| Asset without an embedding in a time-window burst                      | That group fails the CLIP check and is not shown. Groups formed from the camera's burst id are not affected                                                             |
| Burst group straddling a page boundary                                 | Never split; the scan extends past the window                                                                                                                           |
| Owned assets that are also in a Space                                  | The confirmation warns that trashing removes them for Space members too                                                                                                 |
| Trash turned off (`trash.enabled = false`)                             | `commit` deletes permanently (`AssetStatus.Deleted` + `AssetDeleteAll`), like the duplicates utility. Every web trash action asks "Permanently delete" first, the toast offers no Undo, and the hub hides the trash footer |
| Uncommitted rewind marks and the user navigates away                   | A confirmation modal appears                                                                                                                                            |
| Asset viewer open                                                      | Cleanup shortcuts are turned off, so the viewer's own `z` and `Space` still work                                                                                        |

## Testing

**Server unit tests (vitest):**

- The Laplacian variance on synthetic sharp versus box-blurred buffers, a flat buffer (0), and a buffer smaller
  than 3×3.
- The brightness and clipping thresholds.
- A table of screenshot-heuristic cases: every pattern in the list, a camera JPEG, a PNG with no EXIF, the
  aspect-ratio boundary at 2.0, and a video.
- The `monthDay` and `tz` validators.
- `CleanupService`:
  - `commit` partitions ids into `skipped` for every reason, keeps its order, emits `AssetTrashAll` only for the
    ids actually trashed, treats a favourite as a keep, and only upserts the completed date when it is set.
  - The streak calculation, including gaps, today versus yesterday, several completions in one sitting, and a
    timezone boundary.
  - The quality job: the Skipped path when there is no preview, the S3 path (`ensureLocalFile` cleanup is called
    even when scoring throws), the decode-failure path, a video, and an external-library asset.
- **Controller specs** (the `controllerSetup` pattern): 400s for an invalid `monthDay`, `tz`, enum value, cursor
  or oversized id list, and the permission metadata on every route.
- `queue.service.spec.ts` updated for the new queue.

**Server medium tests (real database), under `test/medium/specs/`:**

- `repositories/cleanup.repository.spec.ts`:
  - The scope rules, one fixture per exclusion: trashed, hidden, locked, offline, external library, another
    owner, a stack that is not the primary, and a trashed primary.
  - Keep exclusion applies per queue.
  - Keyset pagination for every queue, with no duplicates and no gaps across pages.
  - Space hogs ordering and the added live-photo size.
  - Bursts: the 2-second boundary (2.0 s joins a group, just over does not), `autoStackId` changes, the
    time-window CLIP check passing and failing, a missing embedding, a group straddling a window, and a keep
    applied before grouping.
  - Blurry: each reason, each strictness, `hideFaces` with a visible face, a deleted face and an invisible face.
  - The duplicates count and bytes match `getAll`.
  - Calendar counts, including 29 February and archived assets being counted.
  - The id-only Space lookup, via the direct route and the album route, and a deleted album.
- `services/cleanup.service.spec.ts`: `commit` end to end, which checks the asset is trashed, the event fires
  and `skipped` is correct.
- `schema-drift.spec.ts` passes with the new tables and indexes.

**Static and CI gates:**

- `revert-to-immich.spec.ts` passes, the ORDER manifest is updated, and `migrations:generate` produces no
  diff.
- `mise //:sql` query files are regenerated for the `@GenerateSql` methods.
- `shared-space-album-scope.guard.spec.ts` passes.
- OpenAPI, the TypeScript SDK and the Dart client are regenerated with `mise //:open-api`. The Dart client is
  compiled by CI's Unit Test Mobile job.
- The i18n tests pass: `fork-string-parity`, `placeholders` and sorting.

**Web unit tests (vitest and testing-library):**

- `RewindSession`: marking, the undo stack, splitting into chunks of 1,000, sending `completeMonthDay` only on
  the last chunk, and reporting skipped ids.
- `CleanupCalendar`: the cell states (none, shading, reviewed, today, 29 February) and the hover peek.
- `BurstGroupCard`: the suggested pick, toggling, and every action resolving all members.
- `QueueSelectGrid`: selection, and "Not a problem" sending keeps.
- The shortcuts turn off while the viewer is open.
- The unsaved-marks confirmation.
- The Undo toast calls `restoreAssets` only for the ids actually trashed.

**E2E:**

- API (`e2e/src/specs/server/api/cleanup.e2e-spec.ts`):
  - Every endpoint, both authenticated and not.
  - Another user's ids end up in `skipped`.
  - Commit followed by restore.
- Web (`e2e/src/specs/web/cleanup.e2e-spec.ts`), following the precedent of `duplicates.e2e-spec.ts`:
  - Utilities → Cleanup hub renders the calendar and the queue rail.
  - Rewind: mark photos, move them to trash, and find them in the trash.
  - Finish day: the date's calendar cell turns green.
  - One queue: keep a photo and it disappears; trash a photo, then Undo.
- Assertions use test ids; the visual-regression suite is not used.

**Performance:** the index safety check and the 300 ms budget above, plus calibrating the blur thresholds on
the personal instance clone.

## Review corrections

These corrections came from checking the first draft against the code on 2026-09-23. They are recorded so the
reasons behind the design survive.

1. `DELETE /assets` and `PUT /assets` fail the whole batch if any single id is missing, foreign or locked, and
   re-trashing an already-trashed asset restarts its auto-empty clock. Hence the filtering `POST /cleanup/commit`.
2. Trashing a live-photo still does **not** trash its motion part (the motion part is removed only when the
   trash is emptied).
3. `StorageRepository.readFile` only reads local disk, so it fails for previews on S3. The job uses
   `BaseService.ensureLocalFile`.
4. The thumbnail chain also runs for external-library assets, so the handler skips those. The chain does not
   run after edits, so edited assets are not re-scored.
5. A plain `fileSizeInByte` index serves `DESC` sorts on its own, so it needs no `migration_overrides` row. The
   `DESC` index in the draft would have forced one.
6. `revert-to-immich.spec.ts` checks less than the draft assumed. The real gate is the CI job that runs the
   revert and boots upstream Immich. Step 4 of the script also needs to drop the new column and indexes.
7. The duplicates page has no Undo. The Undo pattern is `deleteAssets(…, onUndoDelete)`.
8. The asset viewer already binds `z` and `Space`, so the Cleanup shortcuts are turned off while it is open.
   The viewer is opened through the `[[photos=photos]]/[[assetId=id]]` route segments.
9. Adding a queue also touches `route.ts`, `web/.../queue.service.ts`, `JobSettings.svelte` and
   `ADMIN_VISIBLE_QUEUES`, which the draft missed.
10. DTOs are Zod schemas. Every enum needs `.meta({id})`, or the generated Dart client breaks.
11. There was no id-only "is this asset in a Space" lookup, so a new one covers the direct and album routes.
12. Stack filtering would stop the calendar being answered from the index alone, so rewind and the calendar include stack members; only the queues apply the primary-only rule.
13. A separate `not_owned` reason would confirm that another user's asset id exists, so it is folded into `not_found`.
