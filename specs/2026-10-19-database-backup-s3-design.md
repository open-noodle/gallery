# Database Backups to S3 Design

## Overview

Scheduled `pg_dump` backups originally landed only on the server disk. The first S3 increment made backup storage
backend-addressable and added a same-bucket cloud option. The current design extends that work to independent
destinations while retaining the original behavior for existing installations.

## Current design: independent destinations

The admin chooses **Local only**, **Cloud only**, or **Local and cloud**. Local staging remains under
`UPLOAD_LOCATION/backups`; the remote destination is configured separately from the media backend, so it works
with disk-backed or S3-backed media.

- Set `IMMICH_BACKUP_S3_BUCKET` and an instance-unique `IMMICH_BACKUP_S3_PREFIX`. Region defaults to
  `us-east-1`; endpoint and static credentials are optional. Credentials come from deployment environment or the
  AWS SDK provider chain, never from system config.
- Cloud-only deletes the staged local copy only after upload verification. Local-and-cloud retains both copies.
  Failed uploads remain local and are retried during cleanup.
- Retention counts a backup found in both destinations once and removes expired copies from each destination.
  If the remote listing fails, routine backups are not pruned because the full retention inventory is unknown;
  local backups remain listable.
- Config validation checks the deployment target when an administrator transitions to an independent cloud
  destination. Resolving a cloud destination with missing environment configuration fails explicitly.
- Existing `backup.database.s3.enabled: true` config is migrated on read to `destination: cloud` and continues to
  use the media bucket and its existing S3 credentials when media storage is S3; otherwise the legacy setting
  falls back to local backups. Selecting a new destination clears that deprecated compatibility flag. Moving a
  legacy cloud destination to `both` therefore requires the independent target.
- The legacy media-bucket mode still requires `IMMICH_STORAGE_BACKEND=s3` and the old `backups/` prefix. The new
  independent target uses its configured prefix, preventing separate Gallery instances from sharing retention
  state.

The remaining sections record the rationale and implementation of the original same-bucket increment. Where they
conflict with this current-design section, the current design supersedes them.

## Original implementation decisions (historical)

- **The destination is a `StorageBackend`, not a post-hoc uploader.** A second service that uploaded finished
  backups after the fact would have left every other operation — retention, listing, restore, download, delete —
  still disk-only, and restore-from-S3 would have had to be deferred. Going through the interface makes all of them
  backend-aware at once. The owner rejected the post-hoc-uploader shape explicitly.
- **Staged, in this order:** dump to the staging disk, upload, then delete the local copy. Streaming `pg_dump`
  straight at S3 would hold a multipart upload open for the length of the dump; staging keeps the dump local and
  fast, then moves a finished file. The failure semantics fall out of the ordering and are the main reason to
  prefer it (section 3).
- **Gated on the env storage backend being S3.** That gate is what keeps the feature small: it is the reason no
  credentials, region or endpoint belong in the saved config. Letting backups go to S3 while media stays on disk is
  out of scope, and lifting the gate is what would bring back a bucket/region/endpoint/credentials block of its own.
- **One config field:** `backup.database.s3 = { enabled }`. Earlier drafts had a configurable bucket and then a
  configurable prefix. The owner removed both. The bucket went first: the gate already guarantees the server is
  credentialed for exactly one bucket, so a bucket field only let an admin name a destination the server might not
  be able to write to, and the failure would surface at backup time. The prefix went next, for the stronger
  reason below.
- **The prefix is fixed at `backups/`** (`BACKUP_PREFIX`), which is `StorageFolder.Backups` — the folder upstream
  already reserves for backups under the media location. Every media key is namespaced by one of the other five
  `StorageFolder` values (`upload/`, `library/`, `thumbs/`, `encoded-video/`, `profile/`), so sharing the media
  bucket **cannot** collide with media, and the bucket ends up mirroring the on-disk layout. Fixing it is what
  makes that a guarantee rather than a convention an admin can break: a configurable prefix could be set empty,
  which would scatter dumps through the media key space and make every listing (retention, the backup list,
  restore) enumerate the entire bucket. With it fixed there is no such state to validate against, and the staging
  and remote keys are the same string.
- **Off by default** (`enabled: false`), so a fresh install behaves exactly like upstream Immich.
- **One key space.** `backups/<filename>` on both backends: `DiskStorageBackend` resolves it under the media
  location, and it is the S3 object key verbatim. A promote therefore copies a key rather than translating one, and
  `S3StorageBackend` needs no prefix support of its own (media does not use any).
- **`list(prefix)` returns only the direct children of the prefix** on both backends: the S3 implementation
  passes `Delimiter: '/'`. A recursive listing would return keys whose filename no longer reconstructs the key, so
  a caller round-tripping a listing into `delete` — which is exactly what retention does — would silently delete
  nothing.
- **`list(prefix)` is the only addition to `StorageBackend`.** `rename` is added to `DiskStorageBackend` alone,
  because S3 has no move — only a copy-then-delete that is neither atomic nor cheap for a multi-gigabyte object —
  and the single caller only ever moves a file on the staging disk.
- **The cross-field rule lives in `ConfigValidate`, not in a `superRefine`.** The config schemas feed
  `createZodDto` and OpenAPI generation (see `server/src/utils/config.ts`), which a refinement would not survive.
  It validates only the **transition** to on, not any config whose flag is already on: rejecting the latter would
  brick every unrelated admin save once `IMMICH_STORAGE_BACKEND` stopped being `s3`, and since the UI hides the
  group off S3 there would be no control left to turn it off with. An already-on flag on a disk-backed server is
  handled where it matters instead — `resolve()` degrades to local-only with a warning.
- **`downloadBackup` returns an `ImmichMediaResponse`, not a `ServeStrategy`.** `sendFile` already dispatches the
  three cases, and both call sites (`database-backup.controller.ts` and `maintenance-worker.controller.ts`) go
  through it, so converting in the service leaves both controllers untouched instead of duplicating the dispatch.

## 1. The abstraction

`DatabaseBackupService` takes its storage from a fork-owned resolver rather than touching the filesystem:

```ts
// server/src/gallery/utils/backup-store.ts
export interface BackupStore {
  staging: DiskStorageBackend; // always the disk backend — where pg_dump writes
  remote?: { backend: StorageBackend; bucket: string }; // only when the gate below is satisfied
  key: (filename: string) => string; // `backups/<filename>`, on either backend
  prefix: string; // BACKUP_PREFIX, for listings
}
```

`staging` is typed as the concrete `DiskStorageBackend` rather than the interface, because the local-only promote
needs its disk-only `rename`.

`BackupStoreResolver.resolve()` reads the saved config fresh on every call, so an admin edit applies without
restarting the server. Only the S3 client is cached, keyed on bucket, region, endpoint and access key id, and
rebuilt when any of those change. It is a Nest provider (registered in `galleryServices`) rather than a static,
so the backup service can be given a stub and the client is owned by something with a lifecycle.

**The gate.** `remote` is set only when all of: the env storage backend is `s3`, `backup.database.s3.enabled` is
on, and `IMMICH_S3_BUCKET` is set. The S3 backend is built from `envData.storage.s3` verbatim — nothing about the
destination comes from the saved config at all. A failed gate degrades to local-only with a warning
logged once per distinct misconfiguration, so an admin who sets `IMMICH_STORAGE_BACKEND` back to disk still gets
backups instead of none.

## 2. What each operation became

Keys are relative throughout, and identical on both backends (`backups/<filename>`). Today's absolute paths
always resolved to disk, because `isDiskPath` is `isAbsolute`; relative keys are what make one call site work
against either backend, and the fixed prefix is what lets a promote reuse the same key rather than translating it.

| Operation                | Behaviour                                                                                                                                                       |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `createDatabaseBackup`   | Pipes `pg_dump \| gzip` into `staging.put(<key>.tmp)` and renames it to its real name. Does **not** upload — see section 3.                                     |
| `promoteToRemote`        | The staged promote: `staging.get` streamed into `remote.backend.put`, then `staging.delete`. Called by the retention pass and by `uploadBackup`.                |
| `uploadBackup`           | Admin-supplied file, written to `<key>.tmp` and renamed like the dump, then promoted through the shared helper.                                                 |
| `listBackups`            | Unions both listings, deduplicated by filename, local winning. A failure on one side is warned and skipped, so an unreachable bucket cannot hide local backups. |
| `cleanupDatabaseBackups` | Promotes, prunes the union to `keepLastAmount`, sweeps local `.tmp` files, then reports any upload failure (section 4).                                         |
| `downloadBackup`         | Resolves the backup, asks that backend for a serve strategy, and converts it to the matching `ImmichMediaResponse`.                                             |
| `restoreDatabaseBackup`  | Reads through `backend.get`, so **restore-from-S3 comes free**. The rollback restore point is always read from the staging disk.                                |
| `deleteBackup`           | Deletes from both backends; `delete` is a no-op on a missing disk file, so attempting both is safe.                                                             |

`locate(filename)` is local-first, then remote: a backup whose upload failed is still on disk and must stay
downloadable and restorable from there, while everything else exists only in the bucket. Neither place holding it
is a `NotFoundException`.

**The backup backend forces `serveMode: 'proxy'`,** whatever media uses. In `redirect` mode `getServeStrategy`
answers with a presigned URL valid for `IMMICH_S3_PRESIGNED_URL_EXPIRY` (3600s by default), and anyone holding
that URL can fetch it with no Immich session — acceptable for a thumbnail, not for a database dump carrying every
user's password hash and session tokens. Proxying keeps the download on the authenticated admin route where
`Permission.BackupDownload` actually applies.

**The restore read forwards stream errors.** `pipe()` does not, and the source may now be S3, so a dropped socket
mid-restore would otherwise be an unhandled `'error'` that takes the worker down instead of rolling the restore
back. `readBackup` joins the source to the decoder with `stream.pipeline`, which listens on both at once. Forwarding
by hand (`source.on('error', e => gunzip.destroy(e))`) is not enough: the decoder then has no listener until the
restore starts reading it, so an early drop or a corrupt gzip header is still uncaught.

**An admin upload is staged too.** The retention pass runs in the microservices worker and promotes, then deletes,
every valid backup it lists. An upload written straight to its real name could be listed half written, uploaded
truncated and then lost locally. It is written to `<key>.tmp` (not a valid name, so never listed) and renamed. An
interrupted upload's `.tmp` is removed by `uploadBackup` itself, not swept by retention, because sweeping it would
race an upload still in progress. The two can still promote the same finished file at once; the loser's read
fails, so `promoteToRemote` treats "gone locally and present in the bucket" as done rather than as a failed upload.

**One server per bucket.** The prefix is fixed, so two servers on one bucket share one backup namespace and each
one's retention prunes the other's dumps. A copy of an instance restored from a database backup inherits
`backup.database.s3.enabled`, so a test clone pointed at the production bucket must turn it off. The user docs say so.

**The `.tmp` promote still matters.** `isValidDatabaseBackupName` excludes `.tmp` and `isFailedDatabaseBackupName`
matches it, so a dump killed half way can never be listed or restored as a valid backup. With a remote configured
the upload only ever runs on the promoted file, so no `.tmp` key ever reaches S3.

## 3. Failure semantics

| Step fails                       | Result                                                                                                                                                                    |
| :------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `pg_dump` / `gzip`               | Unchanged from before: the `.tmp` key is deleted, nothing is promoted, the job fails.                                                                                     |
| S3 upload                        | **The local file is kept**, retention still runs, and the job then fails with the bucket named. The next run retries the upload.                                          |
| Local delete after a good upload | Warned, job still succeeds — the object is safely in S3, and the straggler is swept by the next cleanup.                                                                  |
| Listing the bucket               | Warned; retention prunes what it can see and the backup list falls back to the local one, so an unreachable bucket neither stops retention nor hides a restorable backup. |
| A single delete                  | Warned; the remaining backups are still pruned.                                                                                                                           |

So a broken bucket or an expired credential degrades to the old local-only behaviour rather than losing backups
or stopping retention.

**Why the promote lives in cleanup and not in `createDatabaseBackup`.** An earlier revision uploaded at the end of
`createDatabaseBackup`. A review caught that this is unsafe: the throw escaped `createDatabaseBackup`,
`handleBackupDatabase` rethrew it, and `cleanupDatabaseBackups()` on the next line never ran. Retention, the
`.tmp` sweep **and** the straggler-retry loop all live in cleanup, so an unwritable bucket silently stopped all
three — each cron tick added one more un-pruned dump to the media volume until it filled, at which point there
were no backups at all. The upload is retryable and the dump on disk is already a valid backup, so promoting is
now part of the retention pass: failures are collected, the prune and the sweep still run, and one aggregate
error is thrown at the end so the job still reports failure. `handleBackupDatabase` is untouched upstream text.

The dump pipeline is wired so the backend owns the destination: `pipeline(pgdump, gzip, passthrough)` runs
alongside `staging.put(key, passthrough)`, with the pipeline's own rejection captured and rethrown after the put
settles. A `pg_dump` failure destroys the passthrough, which surfaces as the put rejecting, and the captured error
is the one reported.

## 4. Retention across both backends

`keepLastAmount` applies to every routine backup the admin can see, as the union of both backends' listings, so
the total is bounded however the uploads are faring. An earlier revision pruned only the "canonical" set (S3 when
enabled), which meant local stragglers from failed uploads were never counted or pruned — the unbounded growth
described above. Deleting by filename now hits both sides; `delete` is a no-op where the backup is not present.

Cleanup does three things, in this order:

1. **Promote.** Every local backup that is not already in the bucket is uploaded and its local copy removed;
   one already there is just a duplicate and is deleted locally. `uploaded-` backups are included, so an admin
   upload whose own promote failed is retried. Failures are collected, not thrown.
2. **Prune** the union to `keepLastAmount`, newest first.
3. **Sweep** the staging disk for `.tmp` files, which only ever exist locally.

Then, if any promote failed, one error naming the bucket and the affected filenames.

`restore-point-*` files are untouched throughout: they match neither the routine nor the failed-backup pattern,
they are the restore flow's own local safety net, and they must not depend on the remote a restore may be reading
from. Upstream never pruned them either.

**Turning the feature off leaves the objects in the bucket.** Retention can only prune a backend it resolves, so
once `remote` is gone the objects under `backups/` are no longer managed. This is deliberate and documented for
the admin rather than silently cleaned up.

## 5. Gating the UI

There was no client-side signal for "the server is running on S3", so one feature flag was added, following
`peopleStatistics` (itself fork-added) through the same files: `s3Storage` on `ServerFeaturesSchema`
(`server/src/dtos/server.dto.ts`), set from `envData.storage.backend === 's3'` in `ServerService.getFeatures()`.
`config.repository.ts` needed no change.

The web wraps the whole S3 group in `{#if featureFlagsManager.value.s3Storage}`, so the section is absent rather
than disabled when it cannot apply (`AuthSettings.svelte` is the in-repo precedent for `{#if}`-hiding a dependent
config group). The switch is the entire control — there is nothing else to configure — and the existing
`SettingButtonsRow keys={['backup']}` already covers saving.

`IMMICH_CONFIG_FILE` sets the flag too, through the same schema — nothing extra was needed for that, and
`galleryConfigBool` is what makes a quoted YAML boolean parse. In that mode the whole Backup section is read-only
in the UI, and `ConfigValidate` never fires (it only runs from `updateSystemConfig`, which config-file mode
refuses), so a file that enables S3 backups off the S3 backend reaches the resolver: it degrades to local-only
with a warning, which is the only diagnosis available when there is no admin UI to show an error in.

Server-side the `ConfigValidate` handler rejects a save that enables S3 backups while the storage backend is not
S3, so the API cannot be used to reach a state the UI will not show. `DatabaseBackupService` holds the handler but
delegates to `validateBackupS3Config` in the fork namespace, keeping the upstream file to one call into a fork
module.

## 6. Layering

New fork code is in `server/src/gallery/utils/backup-store.ts` and
`server/src/gallery/dtos/config.dto.ts`. The upstream files carry seams, not new logic:

- `storage-backend.interface.ts`, `disk-storage.backend.ts`, `s3-storage.backend.ts` — one new interface method and
  its two implementations, plus the disk-only `rename`. These three are already fork-owned under
  `storage-and-media`.
- `src/dtos/config.dto.ts` — one spread of the fork schema into `backup.database` and one spread of the defaults.
- `src/dtos/server.dto.ts`, `src/services/server.service.ts` — one feature flag each.
- `src/services/database-backup.service.ts` — the substantive edit, and the one upstream file whose diff against
  the tag grows materially. It is the price of the owner's decision: the alternative was leaving the service
  disk-only and bolting an uploader beside it.
- `src/app.module.ts` — one provider line, because `MaintenanceModule` lists its providers explicitly rather than
  spreading `services`. A spec in `backup-store.spec.ts` fails for any future non-optional dependency of
  `DatabaseBackupService` that is missing there, since nothing else would catch it before the restore flow failed
  to boot.
- `web/src/routes/admin/system-settings/BackupSettings.svelte` — one `{#if}` group inside the existing section.

Measured against the `v3.3.5` tag (the base after the 2026-10-22 rebase), the upstream files this touches go from
+674/-9 to +1138/-76 lines. Two of them were byte-identical to upstream before: `database-backup.service.ts`
(now +341/-66) and `BackupSettings.svelte` (now +18/-1). The service is where the whole change lives, so that is
the cost being paid; the rest are a handful of lines each.

No database migration, no new dependency (`@aws-sdk/client-s3`, `@aws-sdk/lib-storage` and
`@aws-sdk/s3-request-presigner` are already server dependencies), and no fork table, so
`scripts/revert-to-immich.sql` is unaffected: turning the toggle off, or reverting to Immich, leaves backups
local-only with nothing to clean up. The only trace in the database is the `backup.database.s3` block in the saved
system config, which a stock Immich server's config schema strips as an unknown key.

`AdminConfigDatabaseBackupDto.s3` and `ServerFeaturesDto.s3Storage` are newly required fields on DTOs the mobile
client deserializes, so both have backward-compatibility defaults in `mobile/lib/utils/openapi_patching.dart`,
which is what lets an older app talk to a newer server.

## 7. Out of scope

- Wiring the declared-but-unused `NotificationType.BackupFailed` so a failed upload emails the admin, instead of
  only surfacing as a failed job.
- A "Test connection" button. `POST /admin/test-email` is the precedent, but endpoint plus UI is its own slice.
  `specs/s3-startup-health-check.md` plans a `HeadBucket` check that is not yet implemented and would be the
  natural place to share that code.
- Letting backups go to S3 while media stays on disk.
