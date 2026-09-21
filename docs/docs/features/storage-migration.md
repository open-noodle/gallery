# Storage Migration

Noodle Gallery has a built-in tool for moving files between disk and S3-compatible object storage. It runs in both directions: all your existing files from disk to S3, or from S3 back to disk.

## Features

- Migrates in both directions, disk to S3 or S3 to disk.
- You choose which file types to move: originals, thumbnails, previews, full-size images, encoded videos, sidecars, person thumbnails and profile images.
- An estimate before you start shows file counts and the data size to expect.
- An interrupted migration resumes. Start it again and the files already migrated are skipped.
- Running a migration several times is safe. Already-migrated files are detected and skipped.
- Every migration creates a batch ID, so you can roll a whole batch back to the original file paths.
- You set how many files migrate in parallel.
- Optimistic concurrency keeps the migration from colliding with files that are being uploaded while it runs.

## Prerequisites

1. Configure S3 storage. Set up your S3 environment variables as described in the [S3 Storage documentation](/features/s3-storage).

2. Set `IMMICH_STORAGE_BACKEND` to match the migration direction:
   - To migrate to S3: set `IMMICH_STORAGE_BACKEND=s3`
   - To migrate to disk: set `IMMICH_STORAGE_BACKEND=disk`

   New uploads made during the migration then go to the correct backend.

3. Restart Gallery after changing environment variables.

## Using the Admin UI

### Starting a Migration

1. Go to **Administration > Storage Migration** in the web UI.
2. Select the migration direction (Disk to S3 or S3 to Disk).
3. Click **Get Estimate** to see how many files will be migrated and the estimated data size.
4. Choose which file types to include (all are selected by default).
5. Set the concurrency level (default: 5). Higher values migrate faster but use more resources.
6. Choose whether to delete source files after successful migration.
7. Click **Start Migration**.

### Monitoring Progress

The status panel shows:

- Whether a migration is currently active
- Number of waiting, active, completed, and failed jobs

### Rolling Back

If you need to undo a migration:

1. Copy the **batch ID** from when the migration was started (shown in the UI and server logs).
2. Enter it in the **Rollback** section.
3. Click **Rollback**. This reverts all database path changes for that batch.

:::warning
Rollback only reverts the **database paths**. If you enabled "delete source files" during the migration, the original files are gone and rollback cannot bring them back. To fully revert, run a migration in the opposite direction.
:::

## Using the API

The migration tool exposes four API endpoints under `/storage-migration`:

### Get Estimate

```
GET /storage-migration/estimate?direction=toS3
```

Returns file counts by type and estimated total size in bytes.

### Start Migration

```
POST /storage-migration/start
Content-Type: application/json

{
  "direction": "toS3",
  "deleteSource": false,
  "concurrency": 5,
  "fileTypes": {
    "originals": true,
    "thumbnails": true,
    "previews": true,
    "fullsize": true,
    "encodedVideos": true,
    "sidecars": true,
    "personThumbnails": true,
    "profileImages": true
  }
}
```

Returns a `batchId` that can be used for rollback.

### Check Status

```
GET /storage-migration/status
```

Returns whether a migration is active and job counts.

### Rollback

```
POST /storage-migration/rollback/{batchId}
```

Reverts all path changes from the specified batch.

## Tips

- Back up your database before you start. The migration is built to be safe, but a backup is a cheap extra net.
- Start with a low concurrency (3 to 5) and raise it if your system handles it well.
- Leave "delete source" off for the first migration, so you can check that everything works before removing source files.
- Only one migration runs at a time. Starting a second one while the first is in progress returns an error.

## Technical Implementation

### Migration Log Table

Migrations are tracked in a dedicated `storage_migration_log` table:

```
┌─────────────────────────────┐
│   storage_migration_log     │
├─────────────────────────────┤
│ id (UUID PK)                │
│ entityType (varchar)        │  'asset', 'assetFile', 'person', 'user'
│ entityId (UUID)             │
│ fileType (varchar?)         │  'original', 'thumbnail', 'preview', etc.
│ oldPath (text)              │
│ newPath (text)              │
│ direction (varchar)         │  'toS3' or 'toDisk'
│ batchId (UUID, indexed)     │
│ migratedAt (timestamp)      │
└─────────────────────────────┘
```

Each migrated file gets one log row. The `batchId` groups every file from a single run, so rollback can work a whole batch at a time.

### Job Architecture

Migration uses BullMQ with a two-phase approach:

```
Admin clicks "Start"
        │
        ▼
┌───────────────────┐     ┌───────────────────┐
│ QueueAll job       │     │ Single job (×N)    │
│                   │     │                   │
│ Streams files from│────►│ 1. Check source   │
│ DB in batches of  │     │ 2. Check target   │
│ 1000, queues      │     │    (idempotency)  │
│ individual jobs   │     │ 3. Stream copy    │
│                   │     │ 4. Update DB path │
│ Sets concurrency  │     │ 5. Log migration  │
│ on the queue      │     │ 6. Delete source? │
└───────────────────┘     └───────────────────┘
```

The orchestrator job streams file records from 8 sources (assets, asset files by type, person thumbnails and user profile images), batches them and queues one migration job per file. Worker concurrency follows the value you set, from 1 to 20, default 5.

### Path Transformation

The migration converts between absolute disk paths and relative S3 keys:

- Disk to S3: strip the media location prefix, so `/usr/src/app/upload/library/...` becomes `library/...`
- S3 to Disk: prepend the media location prefix

The S3 storage backend uses relative paths, the disk backend absolute ones. That convention lets [dual backend routing](/features/s3-storage#dual-backend-routing) work transparently.

### Concurrency Safety

Each per-file job uses **optimistic concurrency** when updating the database: the UPDATE statement includes a WHERE clause matching the old path. If the path was changed by a concurrent upload or another migration job, the UPDATE affects 0 rows and the job logs a skip rather than corrupting data. This makes migrations safe to run while the system is serving live uploads.

### Rollback

Rollback reads every log entry for a given `batchId` and reverses each path update with the same optimistic concurrency pattern (UPDATE WHERE path = newPath, SET path = oldPath). If all reversals succeed, the log entries for that batch are deleted. If any fail, the log is kept for debugging. Rollback never moves files. It only reverts database paths, so if source files were deleted during the migration you need a migration in the opposite direction to bring the files back.
