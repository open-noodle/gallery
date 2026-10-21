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

- `copy(fromKey, toKey)`: S3 `CopyObject` up to 5 GiB, multipart `UploadPartCopy` above (content type carried over from `HeadObject`, upload aborted when a part or the completion fails). `CopySource` is URL-encoded per path segment: template names hold spaces, Unicode and the `+N` duplicate suffix, which S3 would otherwise read as a space.
  - **Storage class.** A copy is written in `STANDARD` unless told otherwise, which would undo a lifecycle rule's transition (and, for Standard-IA, bill the original's minimum storage duration on delete). The source's class is sent when it is one of the SDK's `StorageClass` values other than `STANDARD`. A provider's tier name is not: MinIO reports an ILM-transitioned object's tier (`WARM-TIER`) in `HeadObject` and rejects it on `CopyObject` and `CreateMultipartUpload` with `InvalidStorageClass`, so such a copy lands in the default class and the provider's own rule transitions it again once it is old enough. An object in an archive class (Glacier Flexible Retrieval, Deep Archive) cannot be copied until restored; its move fails with `InvalidObjectState`, logged on every run.
  - **No `UploadPartCopy`.** Storj's gateway answers `UploadPartCopy` with 501 `NotImplemented`, and its `CopyObject` has no 5 GiB limit, so a 501 anywhere in the multipart path falls back to one `CopyObject` (an upload already created is aborted first). Any other error is the copy's.
  - **Abandoned parts.** The abort covers failures Gallery sees. A process stopped mid-copy leaves its parts, invisible in a listing and billed, which only a bucket lifecycle rule (`AbortIncompleteMultipartUpload`) removes: the same exposure an interrupted multipart upload already had. The S3 docs recommend the rule.
  - **Disk.** `mkdir` + `copyFile`, then the source's atime and mtime, as upstream's disk move keeps them (`rename`, or `utimes` after its cross-device copy).
- `stat(key)`: `{ size }` (`HeadObject` `ContentLength` on S3).
- `put(key, source)` on disk writes `.<uuid>.tmp` beside the target (a fixed-length name: one derived from the target's could exceed the 255-byte file name limit the target itself fits in) and renames it into place, removing the temp file on failure. An S3 upload was already atomic: the object appears only on a completed `PutObject` or `CompleteMultipartUpload`. So an interrupted write never leaves a partial file at the target, which the storage migration's size check (below) would otherwise refuse on every retry. A process killed mid-write leaves the temp file instead, which nothing reads and no job cleans up.

### The mover (`src/gallery/utils/backend-file-move.ts`)

`StorageCore.moveFile` hands every request that is not disk-to-disk to `moveBackendFile` (one call; the old early return is gone):

| `oldPath` | `newPath`                    | Result                                                                                                                |
| --------- | ---------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| key       | key                          | move inside the key's backend                                                                                         |
| key       | disk path under media loc.   | the path becomes its key (`thumbs/…` for `/data/thumbs/…`); move inside the backend. Derivative migration takes this. |
| key       | disk path outside media loc. | refused with a warning                                                                                                |
| disk path | key                          | the key becomes `<mediaLocation>/<key>`; upstream's disk move. A disk sidecar of an S3 original takes this.           |

The move follows upstream's `moveFile` step for step, `move_history` included, so the next attempt finishes an interrupted one. Upstream's `moveFile` returns before any of this when `oldPath === newPath`.

0. **A sidecar waits for its original.** The template sends the sidecar to `<new original>.xmp` right after the original's move, whether or not that move finished. A move that stops without throwing (copy error, size mismatch, missing asset info, file at neither location, failed verification) keeps its `Original` row and leaves the original where it was; its destination name is still free, so the next asset rendered to that name takes it, and that asset's sidecar overwrites this one. While the entity has an `Original` row, the mover does not move its sidecar (warning logged): a key sidecar, or a disk sidecar of an S3 original. A disk sidecar of a disk original never reaches the mover and keeps upstream's behaviour. The reverse case, a sidecar whose own move failed after its original moved on, stays at `<old name>.xmp` while that name is free for the next asset; so a fresh sidecar move also refuses a destination that already exists (warning logged, no row), since the template probes only the original's destination and a copy overwrites.
1. **Find the entity's `move_history` row.**
   - Disk paths while the file is a key: left by a disk move from before a storage migration; replaced by this move.
   - `oldPath` is not the database's path, and the database's path exists: the database has moved on (an earlier move saved its new path and stopped before cleaning up, or the file was rewritten in place). The row is replaced and the move starts from the database's path. Upstream's recovery would copy the row's `oldPath` over the destination: a stale object, or one that now belongs to another asset, while the database's file is orphaned. The row's `oldPath` is not deleted either: an admin may have removed that orphan by hand, and its name may since have been given to another asset. It stays an orphan.
   - Otherwise upstream's recovery: file at old, at new (verify size and, if enabled, SHA-1 by staging the object), or at neither (give up with upstream's warning). This includes a database path that is gone: an interrupted recovery may have moved the row on to a file the database never pointed at.
2. `copy(old, new)`.
3. `stat(new).size` against the asset's `fileSizeInByte` (or `stat(old)` for a derivative or sidecar). On mismatch stop; the row stays for the next attempt. Only an original's copy is deleted: its destination was picked as free under the template lock, so the object there is this copy. A derivative's key is fixed per asset and a sidecar's is not probed, so another job (a regenerated thumbnail) may have just written it; deleting it would delete that job's file. The next attempt redoes the copy over it.
4. Save the new path (upstream's `savePath`).
5. Delete the old key. A failure is a warning: the object is orphaned, the asset is fine.
6. Delete the row.

The database moves before the old key is deleted, the reverse of upstream's cross-device disk fallback: a crash between 4 and 5 leaves an extra object, never an asset whose key is missing. Without asset info (derivatives) a file found at the new location cannot be compared and is accepted; upstream would `stat` the missing old file and throw on every retry.

Crash windows, each leaving an orphaned object as upstream's cross-device copy fallback does on disk:

- **Between 2 and 4** (copied, not saved): on the next run the template sees its own copy occupying the destination and picks `+1`; recovery copies the still-present old key there, and the first copy is never referenced. Treating "the destination this entity's own row targets" as free would avoid it, but only safely after proving the object there is this asset's copy (size and checksum): if the crash came before the copy, another asset may have taken that name since. Not done; the window is the length of one `HeadObject` and one `UPDATE`.
- **Between 4 and 6** (saved; old key or row not yet deleted): the old key may stay behind, and the row does. The next run with the same template finds the asset in place and returns before reading the row, so the row stays until the asset moves again, when step 1 replaces it as outdated and its old key stays an orphan. Until then step 0 keeps the asset's sidecar where it is: still referenced and served, just not templated. Workaround, while no template migration runs: `DELETE FROM move_history m USING asset a WHERE m."pathType" = 'original' AND m."entityId" = a.id AND m."newPath" = a."originalPath"` (rows of moves whose save went through), then run the template migration again.

A `move_history` row left by an interrupted key move, followed by an S3-to-disk storage migration, holds keys while the file is on disk. Upstream's disk recovery then finds the file at neither key and gives up on every run for that entity (the reverse, a disk row for a key file, is handled). Workaround, as for upstream's stale rows: `DELETE FROM move_history WHERE "oldPath" NOT LIKE '/%'` while no template migration runs.

### Storage template seams (`src/gallery/utils/storage-template-backend.ts`)

`StorageTemplateService.getTemplatePath` makes two calls into the fork module and otherwise runs upstream's code (album lookups, `+N` duplicate handling, the path-traversal guard):

- `getTemplateLibraryRoot(originalPath, user)`: upstream's `<mediaLocation>/library/<label>` for a disk original, the key `library/<label>` for an S3 original (`<label>` is the storage label, or the user id without one), always with a trailing `/`. Upstream's guard is `fullPath.startsWith(rootPath)`, and without the slash `library/admin` also admits `library/admin2/…`: make, model and lens are rendered unsanitized, so EXIF `../admin2` escapes into another user's folder, which user deletion then removes with that user. The slash closes the gap on disk too.
- `isTemplateDestinationTaken(destination, storageRepository, logger)` (the service's logger, so its warning follows the log format and carries the job's correlation id): upstream's disk check alone when S3 is not configured. With S3 configured a destination is taken when either backend holds it. Otherwise a disk asset at `/data/library/admin/2024/IMG_1.jpg` and an S3 asset templated to `library/admin/2024/IMG_1.jpg` would collide at the next storage migration, which would refuse the second asset's target as a size mismatch or, when the sizes happen to match, point it at the first one's file.
  - The S3 check failing is fatal only for an S3 destination: the error reaches `getTemplatePath`'s catch, which keeps the original path, so the asset is not moved this run. For a disk destination it is logged and the key counts as free: upstream never asked S3 about a disk destination, and an S3 outage must not stop disk templating. The storage migration's size check is the backstop for the collision this can let through.

`StorageCore.isAndroidMotionPath` also recognises `encoded-video/` keys: an Android embedded motion video on S3 lives at `encoded-video/<owner>/…-MP.mp4` and, as on disk, is not templated. This also fixes `includeEmbeddedVideos` for S3 downloads.

### Derivative migration on a manual template run

A fork service listens for `QueueStart` (emitted only when an admin starts a queue by hand). For the Storage Template Migration queue, with S3 configured and the template enabled, it queues one job on the Migration queue that streams the assets holding a non-edited derivative under a key, and the people whose thumbnail is a key, and queues upstream's `AssetFileMigration` / `PersonFileMigration` for them. Those handlers run upstream's `moveAssetImage` / `moveAssetVideo` / `movePersonFile`, which reach the mover through `moveFile`. Disk derivatives are left to upstream's Migration job, as before.

Nothing is queued while the Migration queue has an active job. Upstream refuses to start the Migration queue while it is active ("Job is already running") and the per-file jobs have no deduplication, so a second set queued over a running one would run two jobs for one entity at once (the queue's default concurrency is 5): the loser fails on the `move_history` row or a missing key, and the database still points at an existing key. The test is upstream's (active jobs only), so a paused queue holding waiting jobs still lets a second set in, as it does for upstream's own Migration start.

### Accounting and cleanup

- `computePhysicalUsage` counts S3 `library/<label>/` (it already under-counted after a disk-to-S3 migration, which writes there).
- User deletion removes the S3 keys of the five folders upstream removes on disk (`library/<label>/`, and `upload/`, `profile/`, `thumbs/`, `encoded-video/` under the user id) whenever S3 is configured, whatever the write backend: objects stay in the bucket after a switch back to disk. `library/<label>/` is skipped, with a warning, while an asset of another owner has its original or one of its files under it. The label is an admin setting: it can change without a template migration, leaving the files under the old label, and the old label can then be given to another user, whose deletion would otherwise remove the first user's originals. The id-keyed prefixes cannot be shared. The disk library folder keeps upstream's unconditional removal, in upstream's lines. A failed prefix delete is logged and not retried: the same job deletes the user row, so nothing queues it again, and the objects are found only by hand.
- The storage migration no longer trusts an existing target blindly: it compares sizes and fails the file on a mismatch (logged with both paths) instead of re-pointing the asset. It does not delete the target after a failed `put`: the "target does not exist" check and the `put` are separate steps, so another writer may have created the target in between, and with both backends' writes atomic a failed `put` has nothing partial to remove. A mismatched target is therefore a partial file from a build before atomic disk writes, a source rewritten since an earlier copy (a regenerated thumbnail), or another asset's file at the same logical path. The docs tell the admin to look before acting: a leftover of the same asset is deleted and the migration rerun; another asset's file stays, and the failing asset stays on its current backend.

## What users see

- A new S3 upload is `PUT` to `upload/…`, then after metadata extraction copied to `library/…` and deleted from `upload/…`: the same two steps disk takes.
- Requests, made serially: about five per moved original (`HeadObject` probe of the destination, `HeadObject` + `CopyObject`, `HeadObject` of the copy, `DeleteObject`) and about five per sidecar (`HeadObject` + `CopyObject`, `HeadObject` of both keys, `DeleteObject`), plus one `HeadObject` per extra `+N` candidate. A multipart copy adds `CreateMultipartUpload`, one `UploadPartCopy` per part and `CompleteMultipartUpload`. Later runs make none for assets already in place.
- `+N` probing is quadratic. Upstream's loop probes `name`, `name+1`, … until one is free, so the k-th asset rendered to one name costs k probes and n such assets about n²/2. On disk a probe is a local `stat`; on S3 it is a `HeadObject`, and with S3 configured a disk destination costs one too. Templates that render many files to one name (`{{filename}}` without a date folder, camera counters that wrap) pay for it. Not changed: avoiding it means replacing upstream's loop (listing the prefix once, or caching the highest suffix).
- Versioned buckets keep a noncurrent version of every moved object until a lifecycle rule expires it. Object Lock on AWS and MinIO requires versioning, so the delete adds a delete marker and the locked object stays as a noncurrent version until its retention ends; providers whose lock refuses deletes outright (R2 bucket locks, Wasabi compliance mode) leave the old key in place, logged with its key.
- A job that read an asset's old key just before the move and opens it after fails with `NoSuchKey`, the same race upstream has with `rename` on disk, with a wider window. A presigned URL issued for the old key stops working.

## Layering

No schema, endpoint, i18n or revert-script change. The one API-visible change is a new `JobName` value, `StorageBackendFileMigrationQueueAll`, which the OpenAPI spec and the TypeScript SDK list (the Dart client is generated at build time). `move_history` keeps Immich's meaning (a move in progress) and its rows are transient. Stock Immich cannot read S3 assets either way.

Upstream files: `storage-template.service.ts` loses its S3 skip and gains two calls; `storage.core.ts` swaps its early return for one call, plus the `isAndroidMotionPath` line; one registration line each in `enum.ts` and `types.ts` for the derivative queue-all job; `user.service.ts`'s fork-owned S3 cleanup block takes its prefixes from one call into `storage-usage.ts`, which also decides the `library/` skip, so usage and deletion cannot drift apart. The trailing `/` on the template root, the destination check and its S3 error handling, the sidecar wait and the Migration-queue test all live in fork modules. Without S3 configured, the trailing `/` is the only change to upstream's disk behaviour (its guard now refuses a sibling folder).

## Not covered

- Orphan detection on S3: integrity checks still skip S3 (open-noodle/gallery#685), so an object orphaned by step 5, by a replaced row or by a crash window is found only by hand.
- Edited derivatives (`isEdited`) are not re-pathed, as upstream.
- Multipart parts left by a server stopped mid-copy: removed only by a bucket lifecycle rule.
