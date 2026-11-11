# External library: rename and move files and folders in-app

Status: draft, not yet reviewed. Discussion: open-noodle/gallery discussion 1285 (ex-nerd, jaimevisser).

## Problem

Users reorganise their external libraries on disk (rename a file, move a file, move a folder) and then lose the Gallery metadata attached to those files. Gallery identifies an external asset by its path, so a change of path looks like a deleted file plus a new file.

Current behaviour, in code:

- `processEntity` in `server/src/services/library.service.ts` sets `checksum = sha1("path:" + assetPath)` with `checksumAlgorithm = sha1Path`, and `originalPath = assetPath`. The path is the identity.
- A rescan of a moved file creates a new asset. The old asset goes to trash, and the docs say so: album membership, descriptions, faces and other edits are lost (`docs/docs/features/libraries.md`, the caution about moving assets within a library).
- A folder move repeats this for every file under it.

## Goals

- Rename one file from the asset viewer, and move one file or a whole folder, without losing the asset's id or its metadata.
- Keep the operation safe: the disk and the database must not disagree after a failure.
- Work only where the server can actually write. Read-only mounts fail clearly and up front.
- Write into external libraries. A move can take an upload-managed asset (on disk or on S3) into an external library. Importing a whole folder into the user library is a separate operation that the storage template renames (decision 11). Upload-managed assets are never renamed (decision 9).
- Never run at the same time as a storage migration or an integrity check (decision 10).

## Non-goals (v1)

- Bulk renaming by pattern, exif date or album (the larger ask in the discussion). Build it on top of the single-item operation later.
- Renaming or moving a whole external library. Changing import paths already offlines files that leave every import path. A library-level relocation would be a path remap and can come later.
- Changing a library's owner. Moves never cross owners.
- Export file naming. That belongs to the download path, not to disk.
- Changing how upload-managed (non-external) assets are stored. The storage template already handles those.
- Moving single files into upload-managed storage from the move dialog. Folder imports into the user library follow the storage template and are a separate operation (decision 11).
- Mobile UI for rename and move. v1 is web only; see the API and client constraints.

## Decisions

### 1. In-app rename and move on disk (option 2)

The server renames the file on disk and updates the asset row in one operation. Sidecars follow the file.

Alternatives considered:

- Path remap only: the user moves files on disk and then tells Gallery the new path. Cheaper, needs no write access, works on read-only mounts. Kept as a fallback, not the v1 plan.
- Store a stable id and match on content or metadata during scans: fixes moves made outside Gallery too, but changes the scan path and needs cheap change detection on network storage. Long-term question, not v1.

### 2. Input

- Filename: free text. The server validates it: no path separators, no empty name, no `.` or `..`, no collision with an existing entry in the same folder.
- Folder: browse, restricted to the library's import paths. Typed paths go wrong often (container paths versus host paths, see the troubleshooting section of `docs/docs/features/libraries.md`). The existing folder view (Account Settings > Features > Folders) is a tree browser and can be reused for the move dialog.
- Move targets are folders under the import paths of libraries the user owns, including other libraries of the same owner. Libraries owned by someone else are not listed at all, not shown disabled. The target must lie under one of that library's import paths, and must not be hidden by an exclusion pattern, or the file is offlined on the next scan.
- A move across libraries changes the asset's library as well as its path. Across mounts `rename` fails with EXDEV, so the move is copy-then-delete. The row rewrite in decision 4 must cover the library id, and open question 1 decides whether the new checksum can collide.
- The external move dialog lists external libraries only. The user library is not a target of that dialog: a folder import into it is a separate operation (decision 11). The asset and the target library must have the same owner.

### 3. Writability probe

Run at action time, not only at library creation or page load. Mount state can change, and the UI state is only a hint.

- Probe both the source folder and the target folder. A move removes the entry from the source and creates it in the target, so both need write access.
- The probe creates a real file with exclusive-create and deletes it in a `finally`. `access(W_OK)` is not used: it can report writable on read-only bind mounts.
- Probe file name: hidden and unique, for example `.gallery-write-probe-<uuid>.xmp`.
- Extension: `.xmp`. It is registered as a sidecar type in `server/src/utils/mime-types.ts` (the `sidecar` map). It is not part of `getSupportedFileExtensions()` (image and video only), which both the library crawl (`server/src/repositories/storage.repository.ts`) and the watcher (`server/src/services/library.service.ts`) use to decide what to import. A probe file is therefore never imported as an asset.
- A cleanup failure is logged as a warning and the operation continues.
- The real rename can still fail after a successful probe (permissions change, disk full). Map `EROFS`, `EACCES` and `ENOSPC` to the same user-facing errors the probe gives.
- A rename or move on a read-only library shows the action disabled, with a reason. The server returns an error with the same reason. It must not behave like a silent metadata revert, which is what happens to read-only libraries today.

### 4. Identity and asset rows

Open question, to settle before implementation: the new checksum after a move.

- Option A: keep the asset row and its id, rewrite `originalPath`, `originalFileName` and the checksum to match the new path. Rescans then find the asset at its new path.
- Option B: keep the checksum unchanged on purpose and key the rescan on the path mapping stored elsewhere. More change, and it leaves the checksum out of sync with the path.

Option A is the working assumption. The uniqueness constraint on `checksum` (per library or global) has not been checked yet, and it decides whether the rewrite can collide with an existing row.

A move from upload-managed storage takes the same path checksum as a rename, so a rescan finds the asset. The asset loses the content checksum it had, and with it deduplication against uploads (open question 8).

### 5. Ordering and failure handling

0. Take the file-operation lock (decision 10). Hold it until step 6, and refuse with a clear error if it is already held.
1. Probe the source and target folders.
2. Pause the library watcher for the affected import path, including the target, or mark the paths as in-flight, so a concurrent scan does not treat the move or its copy as a delete plus an add, or import the copy as a new asset.
3. Rename the file on disk. Then the sidecar, if present.
4. Update the asset row (`originalPath`, `originalFileName`, checksum) in one transaction.
5. If step 4 fails, rename the file back and report the error.
6. Resume the watcher.

Upload-managed source (move only): step 3 writes a copy to a hidden temporary file in the target folder, verifies its size and content checksum against the asset, and renames it into place. Step 5 removes that new file, never the source. The source is deleted after step 4 commits. If that delete fails, the failure is logged and the leftover is listed for manual cleanup, since the asset already points at the new location.

Open: a crash between steps 3 and 4 leaves the disk and the database out of sync. Options are a small journal table or a reconciliation pass on the next library scan that matches files by checksum or by size and mtime. Pick one before implementation.

### 6. Folder moves

- Rewrite the path prefix for every asset in the library under the old folder, in one transaction. Batch the work in a job if the count is large.
- The rewrite selects by `libraryId`, `isExternal = true` and an absolute `originalPath` under the prefix, not by the prefix alone (decision 9). The prefix is LIKE-escaped with `escapeLikePattern` (`server/src/utils/database.ts`), so a folder name containing `_` or `%` matches only itself.
- Move the folder on disk first. If the database update fails, rename the folder back.
- Sidecars of every file in the tree follow.

### 7. Who may act

Open: is it the library owner only, or also an admin? An external library belongs to a single user, and the docs say the owner cannot be changed later. The authorization matrix for this needs the enumerating test described in `AGENTS.md` (rule 7): every actor (owner, admin, other user), every library state (read-only, read-write, owner changed), every operation.

### 8. Feedback while a move runs

The move runs as a server job. Submitting the move dialog closes it at once, and the user keeps working in the folder. Each state has its own surface:

- **In progress:** a progress panel in the bottom-right corner, like the upload panel. It reads the job's status from the server, so it returns after a reload or a closed tab. It is not a notification: it is not written to the drawer and it goes away when the job ends.
- **Succeeded:** a success toast that dismisses itself after a few seconds. No drawer entry; the folder shows the result.
- **Failed:** a toast at the moment of failure that stays until dismissed and shows the reason. It also writes one drawer entry (level `error`, type `Custom`, `data` carrying the library and folder ids), so the failure survives a reload or a missed toast. Dismissing the toast leaves the drawer entry; marking the entry read clears it.

The failure entry uses `Custom` rather than a new notification type. A new enum value would fail to decode in stock and older apps, which AGENTS.md rule 6 forbids.

No blocking progress dialog in v1.

### 9. Mixed storage: external libraries and S3 in one install

One install can hold two kinds of asset at once:

- External-library assets: the original is on disk, `libraryId` is set and `isExternal = true`, and `originalPath` is an absolute path.
- Upload-managed assets: the original is a storage key on S3 (`originalPath` has no leading slash), or a file under the media location on disk. Their `libraryId` is null.

This feature renames external assets only. It moves both kinds into external libraries. Moving a folder into upload-managed storage is the import in decision 11, which the storage template governs; it is not a move in this sense.

- Rename: external assets only. Rename checks `isExternal = true` and an absolute `originalPath` before any disk call. Any other asset is refused with an error, not skipped silently, so the user sees why. An upload-managed asset is not renamed, because its key or file name belongs to the storage template.
- Move source: an external asset, an upload-managed original on disk, or an upload-managed original on S3.
- Move target: always a folder under an external library's import path. A target under the media location, or an S3 key, is refused before any change. Decision 11 is the only path into the user library.
- A move from upload-managed storage makes the asset external. `libraryId` and `isExternal = true` are set, and `originalPath` becomes the absolute target path. The asset keeps its id, album membership and edits. The storage template no longer applies to it.
- An S3 source is streamed into a hidden temporary file in the target folder. Its size and content checksum are verified against the asset, and the file is renamed into place. The S3 object is deleted only after the database commit. `moveS3File` has no S3-to-disk direction (it covers S3 to S3 and disk to S3), so this path is new code.
- An upload-managed disk source uses the same order. The writability probe (decision 3) runs on the target only, because the server owns the media location. Across mounts the move is copy-then-delete (decision 2).
- A folder move selects by `libraryId` and `isExternal = true` as well as the path prefix. A prefix alone also matches upload-managed originals on disk, which have absolute paths too. Folder moves apply to external folders only.
- Derived files (thumbnails, previews, encoded videos, depth maps, Data Saver copies) are keyed by asset id under the media location. They do not move with a rename or a move, and the feature does not touch them.
- Medium: a move started while a storage migration holds the lock is refused, with no change on disk or in the database.
- Medium: storage migration and integrity jobs wait while a move holds the lock, and an integrity run during a move records no false missing or untracked report.
- Medium: a folder move with a prefix that matches an upload-managed original on disk leaves that asset unchanged; a prefix with `_` or `%` matches only its own folder.
- Medium: an asset whose sidecar is an S3 key is refused as a whole.
- Sidecars of an external asset sit beside the original and follow it (decision 5). If a sidecar's path is an S3 key, the operation is refused as a whole, not applied to the original alone.
- Storage migration is a second writer of the same columns. Decision 10 keeps the two apart.
- Folder view origin. The folder tree shows S3 keys and disk paths together (`ViewRepository.getUniqueOriginalPaths`, `getAssetsByOriginalPath`). An S3 key has no leading slash, so an S3 folder such as `upload/admin` is a top-level node beside `/`. The contents query matches `%<folder>/%`, a substring match, so the S3 folder also returns disk originals under `/data/upload/admin/`, and a disk folder returns S3 keys with the same segments. A move started from either folder could take the wrong assets. Fix, a prerequisite for folder moves: anchor the contents query to the exact folder prefix, `originalPath LIKE '<folder>/%' ESCAPE '\'` with the folder escaped by `escapeLikePattern`, and keep direct children only with `NOT LIKE '<folder>/%/%'`. The tree's trailing-slash normalisation stays. The change is one in-place edit to an upstream file (`server/src/repositories/view-repository.ts`); the PR reports its diff against the upstream tag (`AGENTS.md`, rule 5).

### 10. No concurrent runs with storage migration or integrity checks

Three operations write `asset.originalPath` or `asset_file.path`, or read the library tree while they run:

- Storage migration (`server/src/services/storage-migration.service.ts`). Its start checks only that no migration job is queued or active, so a move that begins later is not stopped. `rollback(batchId)` rewrites the same columns and needs the same protection. The `toS3` direction selects every absolute path, which includes external-library files (open question 6).
- Integrity checks (`server/src/services/integrity.service.ts`). `DatabaseLock.IntegrityCheck` is taken once to register the cron jobs on one worker. It does not guard the jobs that run. A check that reads a path mid-move records a false missing or untracked report.
- Rename and move (this spec).

Decision: the three never run at the same time. They share one exclusive lock, a new `DatabaseLock` entry separate from `IntegrityCheck` (`server/src/enum.ts`). It is taken with `databaseRepository.withLock` or `tryLock`, which use a session advisory lock on a pinned connection, so it also holds across worker processes.

- Rename and move take it with `tryLock` before the probe in decision 3. If it is held, the request fails with a clear message (for example "a storage migration or an integrity check is running") and changes nothing.
- Storage migration start and rollback, and each integrity job run, take it when they run. If it is held, the job waits and retries rather than failing.
- The lock is released in a `finally`. A session advisory lock is also released when its connection closes, so a crashed holder does not block the others.
- The probe file from decision 3 is created under the same lock, so an integrity scan never sees it.

### 11. Folder import into the user library

This reverses the scope set earlier in the discussion, which excluded moves into the user library. The reversal covers whole folders only: an external folder can be imported into its owner's user library, and the storage template chooses the name of every file. Moving single files into upload-managed storage stays out of scope (non-goals).

The import is a separate operation from the external move. It has its own menu item, "Move into your library…" (stage 2, shown on external folders), and its own confirmation (stage 5). The external move dialog (stage 4) keeps listing external libraries only.

What happens to each file under the folder, recursively, with its sidecar:

1. **Plan.** Render the destination with the storage template, as the template bullet below describes. Names given earlier in the same batch are reserved, so a repeat gets the template's `+N` suffix.
2. **Copy.** Read the source once and stream it into a hidden temporary file in the target folder. Hash the content (sha1) while writing. The target backend is in the backend bullet below.
3. **Verify and check.** Compare the size with the source. Check the content checksum against the unique index `(ownerId, checksum)` where `libraryId IS NULL` (`server/src/schema/tables/asset.table.ts`). A file whose content an upload already holds is refused: its temporary file is removed, its source stays, and the job result reports it (question 14).
4. **Commit.** Rename the temporary file to its planned name. In one transaction, set `libraryId = null`, `isExternal = false`, `originalPath` to the new path, and `checksum` to the content sha1 with `checksumAlgorithm = sha1`. Update the sidecar row, and rename the sidecar to `${newPath}.xmp`, as `moveAsset` does.
5. **Remove the source.** Delete the source and its sidecar only after the commit. A failed delete is logged and listed for manual cleanup. The asset already points at the new file.

The asset keeps its id, album membership, faces and edits. Derived files do not move (decision 9).

Implementation findings, from reading the code:

- **Template rendering.** `StorageTemplateService.moveAsset` returns early for `asset.isExternal`, so the import cannot reuse it. The import is a fork service under `server/src/gallery/services/`. It renders through the same steps `getTemplatePath` uses (compiled template, `render`, the `rootPath` guard, `+N` collisions), with the root given by the target. Today `getTemplateLibraryRoot` (`server/src/gallery/utils/storage-template-s3.ts`) picks the root from the original's path type, so an external disk source would always render to disk. The import passes the write backend instead. Preferred: one optional root argument on the upstream `getTemplatePath`. The alternative is a fork copy of the render steps, which drifts from upstream. The PR reports the diff growth against the upstream tag (`AGENTS.md`, rule 5).
- **Target backend.** It follows the write backend, the same test new uploads use (`StorageService.getWriteBackend()`, as in `getRemoteWriteBackend` in `server/src/gallery/utils/backend-media-server.ts`). On an S3 write backend the key is `library/<storageLabel or id>/…`, streamed to S3 like `moveUploadToBackend`. On a disk write backend the path is `StorageCore.getLibraryFolder(user)` plus the rendered path.
- **Template off.** The menu item is disabled with the reason "The storage template is off", and the server refuses the action. Without a template there is no name to apply. The upload default (`upload/<owner>/…`) is not used, because it is not the template the user asked for.
- **S3 template gate.** While `StorageTemplateS3State` is `pending` (`server/src/gallery/services/storage-template-s3.service.ts`), the import is refused with a reason that points to Storage Template Migration. An import into S3 would be a template move that the admin has not yet approved (`isManualOnlyTemplateMove`). Refused, as decided (question 13).
- **Metadata.** A file without `fileSizeInByte` or without extracted metadata cannot be rendered. It is listed in the dialog as "not moved: metadata not extracted yet" and stays in place. The other files proceed (question 11: list and skip).
- **Live photo pairs.** A live photo is two asset rows: the still, and a hidden video. The still's `livePhotoVideoId` points at the video. The pair is matched by `livePhotoCID` within one library (`assetRepository.findLivePhotoMatch`, called from `server/src/services/metadata.service.ts`), so the two files can sit in different folders. The video is a real file under the library, so the import lists and moves it, including hidden assets, which the folder view does not show. The video takes the still's new name with its own extension (`getLivePhotoMotionFilename`), as the storage template job already does. A pair with one half outside the folder is open question 12.
- **Android embedded motion video.** The video is cut out of the still's bytes and written to the media location (`getMotionVideoPath`), as a hidden asset. It is not a file under the folder. The import does not move it, and the still moves alone.
- **Preview is a dry run.** It reads asset rows and does existence checks through `isTemplateDestinationTaken` (disk and S3). It hashes no content and writes nothing. The run uses the template in force when it runs (best effort, question 10). Each name that differs from the preview is reported in the job result.
- **Resumable, one file at a time.** Each file is its own unit with its own commit. A rerun plans only the assets still external under the folder. A crash between the rename (step 4) and the commit leaves a file at the planned name while the row still points at the source. A rerun would then template that file to `+1`, a second copy. The job state therefore journals the planned path before the rename, so the next run removes the orphan (open question 2 and decision 5).
- **Failures.** One file's failure does not stop the job. The job result lists each failed or skipped file with its reason. Feedback follows decision 8: the progress panel while it runs, a success toast with the moved and skipped counts, and a failure toast plus a drawer entry when any file failed.
- **Locks and watcher.** The job takes `DatabaseLock.StorageTemplateMigration`, which `moveAsset` also takes per asset, so the per-asset template job cannot run on the same file. It also takes the shared lock of decision 10 (per job or per file, open question 7). The watcher pauses for the source import path (decision 5, step 2), and does not import the in-flight copy at the target.
- **Authorization.** The owner of the external library is the owner of the asset and of the target library. Moves stay within one owner, so an admin who is not the owner is refused (questions 3 and 9). The matrix in decision 7 covers actor (owner, admin who is not the owner, other user), template on and off, S3 gate pending and clear, write backend disk and S3, and the preview and run operations.
- **API.** Two new fork endpoints under the gallery controller: a paged preview and an import job. Both are additive (`AGENTS.md`, rule 6). An older app never calls them.
- **Undo.** Not automatic. A file can go back out to an external library through the external move from the user library (decision 2, moves from upload-managed storage).
- **Upstream files.** `storage-template.service.ts` gains the optional root argument if the preferred option is taken. Nothing else in upstream code changes.

## API and client constraints

- New endpoints and response fields are additive only. Old apps must keep working against the new server, and a new app against an old server must fail closed (`AGENTS.md`, rule 6).
- The new server code goes under `server/src/gallery/` (controllers, services, repositories, utils), with one hook call into any upstream file (`AGENTS.md`, rule 5).
- Any new user-facing string goes into `i18n/gallery/en.json` and the nine maintained locales in the same change (`AGENTS.md`, i18n section).
- Mobile: out of scope for v1. Only the web asset viewer and folder browser use the new operations.

## Test plan (sketch)

- Unit: filename validation, prefix rewrite, probe logic (writable, read-only, probe cleanup failure).
- Medium: rename and move against a real database and a temporary directory, including a forced failure at step 4 that must roll the disk back.
- Medium: watcher race, asserting the moved asset keeps its id.
- Medium: a move started while a storage migration holds the lock is refused, with no change on disk or in the database.
- Medium: storage migration and integrity jobs wait while a move holds the lock, and an integrity run during a move records no false missing or untracked report.
- Medium: a folder move with a prefix that matches an upload-managed original on disk leaves that asset unchanged; a prefix with `_` or `%` matches only its own folder.
- Medium: an asset whose sidecar is an S3 key is refused as a whole.
- Medium: a move from upload-managed disk and from S3 into an external library keeps the id, sets `isExternal` and `libraryId`, and removes the source only after the commit; derived files are unchanged.
- Medium: a forced failure during an S3-to-disk move leaves the object, the row and the target folder as they were, apart from the removed temporary file.
- Medium: an external move into the media location or an S3 key is refused, with no change. The import (decision 11) has its own tests below.
- Medium: a rename of an upload-managed asset is refused.
- Medium: after a move from S3, a `toS3` storage migration run leaves the asset's path alone (needs the open question 6 fix).
- Medium: the watcher does not import the in-flight copy at the target.
- Medium, folder view origin (decision 9), in a sibling file under `server/test/medium/specs/gallery/`: an S3 folder `upload/admin` does not return the disk original `/data/upload/admin/x.jpg`; the disk folder `/data/upload/admin` does not return the S3 key `upload/admin/x.jpg`; only direct children are returned; a folder name with `_` or `%` matches only itself.
- Authorization matrix as described in decision 7.
- Medium, import (decision 11): a folder imported into a disk user library keeps each asset's id, albums, faces and edits; `libraryId` is null, `isExternal` is false, the checksum is the content sha1; sidecars move; the source is removed only after the commit.
- Medium, import into an S3 write backend: the key is `library/<label>/…`; the source is removed only after the commit.
- Medium, import: the template off, or `StorageTemplateS3State` pending, refuses with a reason and no change.
- Medium, import: a file whose content an upload already holds is refused, its source stays, and the other files proceed.
- Medium, import: a file without metadata is listed as skipped and is not moved.
- Medium, import: a live photo pair inside the folder moves as one unit, the video under the still's new name. A pair with its partner outside the folder: both files are listed and skipped, and neither moves.
- Medium, import: an admin who is not the owner is refused with no change.
- Medium, import: a forced failure at the rename or the commit leaves the source and the row as they were, with the temporary file removed.
- Medium, import: an interrupted job, rerun, does not create a `+1` copy of a file that already moved.
- Medium, import: names reserved within the batch give `+1`, `+2`; a name taken on disk or in S3 is skipped by the template.
- Unit, import: the write backend picks the root (`library/<label or id>` on S3, the media location on disk); a motion video takes its still's date.
- Medium, import: storage migration and integrity jobs wait, or refuse, while the import holds the lock (decision 10).
- Authorization matrix for the import (decision 11, Authorization).
- E2E: the menu item is disabled with its reason when the template is off; the confirmation lists every file with its new name.
- E2E: one happy-path rename from the asset viewer.

## Open questions

1. Uniqueness constraint on `checksum`: per library, or global? Decides whether the rewrite can collide.
2. Crash recovery between disk rename and database update, and between the copy into an external folder and the database update (uploads and S3 sources): journal table or reconciliation on rescan? A crash after the copy leaves a file the scanner would import as a second asset.
3. Decided: owner only. Moves stay within one owner (answer to question 9).
4. Does a move need to refuse when the target folder is excluded by a pattern, or only warn?
5. Should the folder browser show read-only folders as browsable but not selectable?
6. Storage migration `toS3` selects every absolute `originalPath` and `asset_file.path` with no `isExternal` or `libraryId` filter (`server/src/repositories/storage-migration.repository.ts`). Its `computeTargetPath` comment says an external path "keeps the whole path without its leading slash". If that is what happens, a `toS3` run turns external originals into S3 keys and breaks their rename. Confirm with a test. If it is confirmed, fix the migration to exclude external assets before this feature ships; the fix belongs to the migration, not to this spec. This also matters for moved assets: one moved out of S3 has an absolute path, so the same selection would send it back to S3.
7. Lock granularity: a folder move can run for a long time. Hold the lock for the whole move (storage migration waits for it), or per batch (a migration can start between batches, and the move must then re-check the lock)?
8. Checksum of an upload-managed asset moved into an external library: take the path checksum (decision 4, which loses content deduplication against uploads), or keep the content checksum and make the rescan match it?
9. Decided: an admin who is not the owner cannot import into that owner's library. Moves stay within one owner, and a move from an external library to a user library needs both owned by the same owner.
10. Decided: best effort. The run uses the template in force when it runs, and the job result reports each name that differs from the preview.
11. Decided: list and skip. A file without metadata stays in place and the dialog lists it.
12. Open. Proposed: a live photo pair with one half outside the folder is listed and skipped, with both files left in place. The alternative is moving the partner too, which changes files outside the folder.
13. Decided: refuse on an S3 install while `StorageTemplateS3State` is pending, until Storage Template Migration is done.
14. Decided: refuse the file and keep the source in place. The job result reports it. Linking to the existing asset would lose the external asset's albums and faces, so it is not done.
