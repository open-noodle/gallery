# Storage Template on S3 — Design

Supersedes the "storage template is a no-op on S3" decision recorded in `2026-03-02-s3-storage-design.md` ("S3 moves: No physical copy+delete"), the skip guards of `2026-04-19-storage-template-s3-compat-design.md`, and the "S3 never writes to library/" exclusion of `2026-04-22-s3-orphan-cleanup-user-delete-design.md`.

## Problem

With `IMMICH_STORAGE_BACKEND=s3`, the storage template did nothing. `StorageTemplateService.moveAsset` returned early for every relative (S3) `originalPath`, and `StorageCore.moveFile` returned early for any relative `oldPath`, so an S3 upload stayed at `upload/<userId>/ab/cd/<assetId>.<ext>` forever, and the Migration job ("migrate thumbnails to the latest folder structure") never touched S3 thumbnails or encoded videos. The S3 docs said the opposite.

## Owner decisions (2026-10-20)

1. **No new toggle.** The existing "Enable storage template" switch governs S3 too. Installations that had it on with S3 (where it silently did nothing) start moving new uploads on upgrade, and existing assets when an admin runs the Storage Template Migration job.
2. **Verify like Immich does on disk.** Upstream's disk move renames without checking anything and only verifies (size, then SHA-1 when `storageTemplate.hashVerificationEnabled`) a file it has to trust without having moved it itself: one an interrupted move left at its new location. An S3 server-side copy is treated as the rename, plus the size check a copy needs (a `HeadObject`): no read-back of the object. The SHA-1 check runs only in the interrupted-move recovery path, as upstream.
3. **Derivatives move on a manual run.** Starting the Storage Template Migration job by hand (the admin Jobs page) also re-paths the S3-stored thumbnails, previews, full-size images, encoded videos and person thumbnails, the work upstream's Migration job does for disk. The Migration job itself now handles S3 files as well.

## Why a copy

S3 general-purpose buckets have no rename. `RenameObject` exists only for S3 Express One Zone directory buckets, and MinIO, Garage, R2 and B2 have none. A move is `CopyObject` (server-side: no bytes pass through Gallery, nothing leaves the bucket) and `DeleteObject`. `CopyObject` stops at 5 GiB, so larger objects use a multipart copy (`UploadPartCopy`).

## Design

### Namespaces: a file stays in the backend that holds it

A stored path is a disk file when absolute and a storage-backend key when relative (`isDiskPath`). `<mediaLocation>/<key>` on disk and `<key>` on S3 are the same logical location: the storage migration maps one onto the other (`StorageMigrationService.computeTargetPath`). The template never moves a file between backends. It renders the destination in the namespace of the original, and the mover reads any new path in the namespace of the file it moves.

### Backend primitives (`src/interfaces/storage-backend.interface.ts`)

- `copy(fromKey, toKey)`: S3 `CopyObject` up to 5 GiB, multipart `UploadPartCopy` above (content type carried over from `HeadObject`, upload aborted on failure). The storage class is carried over too: a copy is written in `STANDARD` unless told otherwise, which would undo a lifecycle rule's transition (and, for Standard-IA, bill the original's minimum storage duration on delete). An object in an archive class (Glacier Flexible Retrieval, Deep Archive) cannot be copied until restored; its move fails with `InvalidObjectState`, logged on every run. `CopySource` is URL-encoded per path segment: template names hold spaces, Unicode and the `+N` duplicate suffix, which S3 would otherwise read as a space. Disk: `mkdir` + `copyFile`.
- `stat(key)`: `{ size }` (`HeadObject` `ContentLength` on S3).

### The mover (`src/gallery/utils/backend-file-move.ts`)

`StorageCore.moveFile` hands every request that is not disk-to-disk to `moveBackendFile` (one call; the old early return is gone):

| `oldPath` | `newPath`                     | Result                                                                                                                |
| --------- | ----------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| key       | key                           | move inside the key's backend                                                                                         |
| key       | disk path under media loc.    | the path becomes its key (`thumbs/…` for `/data/thumbs/…`); move inside the backend. Derivative migration takes this. |
| key       | disk path outside media loc.  | refused with a warning                                                                                                |
| disk path | key                           | the key becomes `<mediaLocation>/<key>`; upstream's disk move. A disk sidecar of an S3 original takes this.          |

The move follows upstream's `moveFile` step for step, `move_history` included, so the next attempt finishes an interrupted one:

1. Find the entity's `move_history` row. A row with disk paths while the file is a key was left by a disk move from before a storage migration; it is replaced. Otherwise upstream's recovery: file at old, at new (verify size and, if enabled, SHA-1 by staging the object), or at neither (give up with upstream's warning).
2. `copy(old, new)`.
3. `stat(new).size` against the asset's `fileSizeInByte` (or `stat(old)` for a derivative). On mismatch delete the copy and stop; the row stays for the next attempt.
4. Save the new path (upstream's `savePath`).
5. Delete the old key. A failure is a warning: the object is orphaned, the asset is fine.
6. Delete the row.

The database moves before the old key is deleted, the reverse of upstream's cross-device disk fallback: a crash between 4 and 5 leaves an extra object, never an asset whose key is missing. Without asset info (derivatives) a file found at the new location cannot be compared and is accepted; upstream would `stat` the missing old file and throw on every retry.

Two crash windows leave an orphaned object, as upstream's cross-device copy fallback does on disk:

- Between 4 and 5: the old key stays behind, and so does the `move_history` row.
- Between 2 and 4 (copied, not yet saved): on the next run the template sees its own copy occupying the destination and picks `+1`; recovery copies the still-present old key there, and the first copy is never referenced. Treating "the destination this entity's own row targets" as free would avoid it, but only safely after proving the object there is this asset's copy (size and checksum): if the crash came before the copy, another asset may have taken that name since. Not done; the window is the length of one `HeadObject` and one `UPDATE`.

A `move_history` row left by an interrupted key move, followed by an S3-to-disk storage migration, holds keys while the file is on disk. Upstream's disk recovery then finds the file at neither key and gives up on every run for that entity (the reverse, a disk row for a key file, is handled). Workaround, as for upstream's stale rows: `DELETE FROM move_history WHERE "oldPath" NOT LIKE '/%'` while no template migration runs.

### Storage template seams (`src/gallery/utils/storage-template-backend.ts`)

`StorageTemplateService.getTemplatePath` makes two calls into the fork module and otherwise runs upstream's code (album lookups, `+N` duplicate handling, the path-traversal guard):

- `getTemplateLibraryRoot(originalPath, user)`: upstream's `<mediaLocation>/library/<label>` for a disk original, the key `library/<label>` for an S3 original.
- `isTemplateDestinationTaken(destination, storageRepository)`: upstream's disk check alone when S3 is not configured. With S3 configured a destination is taken when either backend holds it. Otherwise a disk asset at `/data/library/admin/2024/IMG_1.jpg` and an S3 asset templated to `library/admin/2024/IMG_1.jpg` would collide at the next storage migration, whose "target exists → skip the copy" shortcut points the second asset at the first one's object and, with delete-source on, deletes the original.

`StorageCore.isAndroidMotionPath` also recognises `encoded-video/` keys: an Android embedded motion video on S3 lives at `encoded-video/<owner>/…-MP.mp4` and, as on disk, is not templated. This also fixes `includeEmbeddedVideos` for S3 downloads.

### Derivative migration on a manual template run

A fork service listens for `QueueStart` (emitted only when an admin starts a queue by hand). For the Storage Template Migration queue, with S3 configured and the template enabled, it queues one job on the Migration queue that streams the assets holding a non-edited derivative under a key, and the people whose thumbnail is a key, and queues upstream's `AssetFileMigration` / `PersonFileMigration` for them. Those handlers run upstream's `moveAssetImage` / `moveAssetVideo` / `movePersonFile`, which reach the mover through `moveFile`. Disk derivatives are left to upstream's Migration job, as before.

### Accounting and cleanup

- `computePhysicalUsage` counts S3 `library/<label>/` (it already under-counted after a disk-to-S3 migration, which writes there).
- User deletion cleans the S3 `library/<label>/` prefix, as upstream removes the disk library folder.
- The storage migration no longer trusts an existing target blindly: it compares sizes and fails the file on a mismatch instead of re-pointing the asset. A `put` that fails removes its own partial target (it checked the target did not exist first), so a failed disk write does not turn into a permanent size mismatch; a process killed mid-write still leaves one, which the size check then refuses to trust (logged with both paths).

## What users see

- A new S3 upload is `PUT` to `upload/…`, then after metadata extraction copied to `library/…` and deleted from `upload/…`: the same two steps disk takes.
- A first bulk run on an existing S3 library makes about four requests per asset, serially; later runs make none for assets already in place.
- Versioned buckets keep a noncurrent version of every moved object until a lifecycle rule expires it. Object Lock on AWS and MinIO requires versioning, so the delete adds a delete marker and the locked object stays as a noncurrent version until its retention ends; providers whose lock refuses deletes outright (R2 bucket locks, Wasabi compliance mode) leave the old key in place, logged with its key.
- A job that read an asset's old key just before the move and opens it after fails with `NoSuchKey`, the same race upstream has with `rename` on disk, with a wider window. A presigned URL issued for the old key stops working.

## Layering

No schema, endpoint, i18n or revert-script change. The one API-visible change is a new `JobName` value, `StorageBackendFileMigrationQueueAll`, which the OpenAPI spec and the TypeScript SDK list (the Dart client is generated at build time). `move_history` keeps Immich's meaning (a move in progress) and its rows are transient. Stock Immich cannot read S3 assets either way. Upstream files: `storage-template.service.ts` loses its S3 skip and gains two calls, `storage.core.ts` swaps its early return for one call, plus the `isAndroidMotionPath` line; one registration line each in `enum.ts` and `types.ts` for the derivative queue-all job; `user.service.ts`'s fork-owned S3 cleanup block reads its prefixes from `storage-usage.ts`, so usage and deletion cannot drift apart.

Starting Storage Template Migration again while the Migration queue still holds derivative jobs from the last run can queue an entity twice; the second job fails on the `move_history` row or a missing key, and the database still points at an existing key. Upstream's Migration job has the same exposure when it overlaps itself.

## Not covered

- Orphan detection on S3: integrity checks still skip S3 (open-noodle/gallery#685), so an object orphaned by step 5 is found only by hand.
- Edited derivatives (`isEdited`) are not re-pathed, as upstream.
