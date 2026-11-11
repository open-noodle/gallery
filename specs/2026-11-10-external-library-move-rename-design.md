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
- Touch only external-library files. An install can also hold upload-managed assets on S3, and those are never renamed, moved or rewritten by this feature (decision 9).
- Never run at the same time as a storage migration or an integrity check (decision 10).

## Non-goals (v1)

- Bulk renaming by pattern, exif date or album (the larger ask in the discussion). Build it on top of the single-item operation later.
- Renaming or moving a whole external library. Changing import paths already offlines files that leave every import path. A library-level relocation would be a path remap and can come later.
- Changing a library's owner. Moves never cross owners.
- Export file naming. That belongs to the download path, not to disk.
- Changing how upload-managed (non-external) assets are stored. The storage template already handles those.
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

### 5. Ordering and failure handling

0. Take the file-operation lock (decision 10). Hold it until step 6, and refuse with a clear error if it is already held.
1. Probe the source and target folders.
2. Pause the library watcher for the affected import path, or mark the paths as in-flight, so a concurrent scan does not treat the move as a delete plus an add.
3. Rename the file on disk. Then the sidecar, if present.
4. Update the asset row (`originalPath`, `originalFileName`, checksum) in one transaction.
5. If step 4 fails, rename the file back and report the error.
6. Resume the watcher.

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

This feature acts only on the first kind.

- Rename and move check `isExternal = true` and an absolute `originalPath` before any disk call. Any other asset is refused with an error. It is not skipped silently, so the user sees why.
- A folder move selects by `libraryId` and `isExternal = true` as well as the path prefix. A prefix alone also matches upload-managed originals on disk, which have absolute paths too.
- Derived files (thumbnails, previews, encoded videos, depth maps, Data Saver copies) are keyed by asset id under the media location. They do not move with a rename, and the feature does not touch them.
- Medium: a move started while a storage migration holds the lock is refused, with no change on disk or in the database.
- Medium: storage migration and integrity jobs wait while a move holds the lock, and an integrity run during a move records no false missing or untracked report.
- Medium: a folder move with a prefix that matches an upload-managed original on disk leaves that asset unchanged; a prefix with `_` or `%` matches only its own folder.
- Medium: an asset whose sidecar is an S3 key is refused as a whole.
- Sidecars of an external asset sit beside the original and follow it (decision 5). If a sidecar's path is an S3 key, the operation is refused as a whole, not applied to the original alone.
- Storage migration is a second writer of the same columns. Decision 10 keeps the two apart.

### 10. No concurrent runs with storage migration or integrity checks

Three operations write `asset.originalPath` or `asset_file.path`, or read the library tree while they run:

- Storage migration (`server/src/services/storage-migration.service.ts`). Its start checks only that no migration job is queued or active, so a move that begins later is not stopped. `rollback(batchId)` rewrites the same columns and needs the same protection. The `toS3` direction selects every absolute path, which includes external-library files (open question 6).
- Integrity checks (`server/src/services/integrity.service.ts`). `DatabaseLock.IntegrityCheck` is taken once to register the cron jobs on one worker. It does not guard the jobs that run. A check that reads a path mid-move records a false missing or untracked report.
- Rename and move (this spec).

Decision: the three never run at the same time. They share one exclusive lock, a new `DatabaseLock` entry separate from `IntegrityCheck` (`server/src/enum.ts`). It is taken with `databaseRepository.withLock` or `tryLock`, which use a session advisory lock on a pinned connection, so it also holds across worker processes.

- Rename and move take it with `tryLock` before the probe in decision 3. If it is he
6. Storage migration `toS3` selects every absolute `originalPath` and `asset_file.path` with no `isExternal` or `libraryId` filter (`server/src/repositories/storage-migration.repository.ts`). Its `computeTargetPath` comment says an external path "keeps the whole path without its leading slash". If that is what happens, a `toS3` run turns external originals into S3 keys and breaks their rename. Confirm with a test. If it is confirmed, fix the migration to exclude external assets before this feature ships; the fix belongs to the migration, not to this spec.
7. Lock granularity: a folder move can run for a long time. Hold the lock for the whole move (storage migration waits for it), or per batch (a migration can start between batches, and the move must then re-check the lock)?ld, the request fails with a clear message (for example "a storage migration or an integrity check is running") and changes nothing.
- Storage migration start and rollback, and each integrity job run, take it when they run. If it is held, the job waits and retries rather than failing.
- The lock is released in a `finally`. A session advisory lock is also released when its connection closes, so a crashed holder does not block the others.
- The probe file from decision 3 is created under the same lock, so an integrity scan never sees it.

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
- Authorization matrix as described in decision 7.
- E2E: one happy-path rename from the asset viewer.

## Open questions

1. Uniqueness constraint on `checksum`: per library, or global? Decides whether the rewrite can collide.
2. Crash recovery between disk rename and database update: journal table or reconciliation on rescan?
3. Who may rename or move: owner only, or admins too?
4. Does a move need to refuse when the target folder is excluded by a pattern, or only warn?
5. Should the folder browser show read-only folders as browsable but not selectable?
6. Storage migration `toS3` selects every absolute `originalPath` and `asset_file.path` with no `isExternal` or `libraryId` filter (`server/src/repositories/storage-migration.repository.ts`). Its `computeTargetPath` comment says an external path "keeps the whole path without its leading slash". If that is what happens, a `toS3` run turns external originals into S3 keys and breaks their rename. Confirm with a test. If it is confirmed, fix the migration to exclude external assets before this feature ships; the fix belongs to the migration, not to this spec.
7. Lock granularity: a folder move can run for a long time. Hold the lock for the whole move (storage migration waits for it), or per batch (a migration can start between batches, and the move must then re-check the lock)?
