# Remote Database Backups

By default, Gallery's [automatic database backups](/administration/backup-and-restore#automatic-database-backups) are written to `UPLOAD_LOCATION/backups`, on the same disk as the server. If that host dies, the library and every backup of it go together.

When Gallery is already running on the [S3-compatible storage backend](/features/s3-storage), it can upload each scheduled backup to object storage instead and keep nothing on local disk.

:::info
This option only appears when the server is started with `IMMICH_STORAGE_BACKEND=s3`. It reuses that backend's bucket, credentials, region and endpoint, so there is nothing new to configure and no new secret stored in the database. On a disk-backed server the whole section is hidden, and the API refuses to enable it.
:::

## Turning it on

1. Go to **Administration > Settings > Backup Settings**.
2. Turn on **Upload backups to S3**.
3. Save.

If you run Gallery from a [config file](/install/config-file), set it there instead — the Backup section is read-only in the web UI in that mode:

```json
{
  "backup": {
    "database": {
      "s3": {
        "enabled": true
      }
    }
  }
}
```

In config-file mode the server cannot refuse the setting at save time, because there is no save. If the file turns this on while `IMMICH_STORAGE_BACKEND` is not `s3`, the server logs a warning on the first backup and keeps writing backups to local disk.

That is the whole setting. Backups go to the same bucket as your media, under `backups/` — the same folder name they use on disk, and one no media file can occupy, since media is written under `upload/`, `library/`, `thumbs/`, `encoded-video/` and `profile/`. If you want S3 lifecycle rules just for your backups, scope them to the `backups/` prefix. Rules on the whole bucket apply to backups too: a rule that moves objects to an archive storage class such as Glacier makes those backups impossible to restore until they are retrieved.

:::warning One server per bucket
Every server writes to the same `backups/` prefix. If two servers share a bucket (for example a test copy of your instance pointed at the production bucket), each one lists the other's backups and its retention pass deletes them. Give each server its own bucket, or turn this option off on the copy. A copy restored from a database backup inherits this setting, so check it after a restore.
:::

The next scheduled or manual backup is uploaded. From then on, **Administration > Settings > Backup Settings** and the restore picker list the backups in your bucket.

## How a backup reaches the bucket

Each backup is written in stages:

1. `pg_dump` writes a compressed dump to `UPLOAD_LOCATION/backups`, under a temporary name.
2. The finished file is given its real name, so a dump interrupted half way can never be mistaken for a usable backup.
3. The retention pass uploads it to the bucket — along with any earlier backup still on disk from a failed upload.
4. The local copy is deleted.

Steps 3 and 4 are part of retention rather than the dump itself, so an unwritable bucket cannot stop old backups being pruned.

This ordering is what makes the failure cases safe:

| What goes wrong             | What happens                                                                                                                                        |
| :-------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------- |
| The dump itself fails       | The temporary file is removed and the job fails, exactly as it does without S3.                                                                     |
| The upload fails            | **The backup stays on local disk**, retention still runs, and the job then fails with the bucket named. Nothing is lost, and the next run retries.  |
| The local delete fails      | A warning is logged and the job still succeeds — the backup is safely in the bucket, and the leftover file is cleaned up on the next backup run.    |
| The bucket cannot be listed | A warning is logged; retention still prunes what it can see, and the backup list falls back to the local one so it cannot hide a restorable backup. |

So a wrong bucket name or an expired key leaves you with exactly the local-only behaviour you had before, not with no backups at all.

## Retention, downloads and restores

- **Retention** (`Keep last amount`) applies to every backup you can see, counting the bucket and the server's disk together, so the total is bounded however the uploads are faring. A file left behind by a failed upload is retried first; if it is still outside the newest `Keep last amount` after that, it is pruned like any other.
- **The backup list** merges both places, so during an outage you still see one coherent set.
- **Downloading** a backup serves it from wherever it is, always streamed through the server. Unlike your media, backups ignore `IMMICH_S3_SERVE_MODE`: a presigned redirect would let anyone holding that URL fetch the whole dump without signing in, and a dump contains every user's password hash and session tokens.
- **Restoring** reads straight from the bucket, so a backup that has already been uploaded can be restored without downloading it first. The automatic restore point Gallery takes before a restore is always kept on local disk, since it exists to recover a restore that goes wrong.
- **Uploading** a backup through the admin UI follows the same staged path and ends up in the bucket.

## Turning it off

Turn the toggle off and save. The next backup stays on local disk, and retention goes back to pruning the local folder. Objects already in the bucket are left alone, and they no longer appear in the backup list or the restore picker. Delete them yourself if you no longer want them.

:::caution
Database backups contain metadata only, never photos or videos. They must be paired with a copy of the files in `UPLOAD_LOCATION`, as described in [Backup and Restore](/administration/backup-and-restore). The dumps live in the same bucket as your media, so this is not an off-site copy of anything — losing the bucket loses both. A dump contains every user's password hash and session tokens, so make sure the bucket is private and encrypted at rest.
:::
