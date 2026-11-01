# Remote Database Backups

By default, Gallery's [automatic database backups](/administration/backup-and-restore#automatic-database-backups)
are written to `UPLOAD_LOCATION/backups`, on the same disk as the server. If that host dies, the library and every
backup of it go together.

Gallery can also store scheduled database backups in an independent S3-compatible bucket. This works with either
the disk or S3 media backend and does not store cloud credentials in the database. Choose **Local only**, **Cloud
only**, or **Local and cloud** in **Administration > Settings > Backup Settings**.

## Configure cloud storage

Set these variables on every server worker that lists, creates, or restores backups. Credentials can be omitted
when the deployment provides an IAM role or another AWS SDK credential provider.

```dotenv
IMMICH_BACKUP_S3_BUCKET=gallery-backups
IMMICH_BACKUP_S3_REGION=us-east-1
IMMICH_BACKUP_S3_PREFIX=gallery/production
# Optional for S3-compatible services and static credentials:
IMMICH_BACKUP_S3_ENDPOINT=https://s3.example.com
IMMICH_BACKUP_S3_ACCESS_KEY_ID=...
IMMICH_BACKUP_S3_SECRET_ACCESS_KEY=...
```

Set both access-key variables or neither. `IMMICH_BACKUP_S3_PREFIX` is required and must be unique to this Gallery
instance. Different instances must not share a prefix: each instance lists and applies retention to everything
under its own prefix.

The same values can be supplied through your deployment's environment configuration; they are not editable in the
admin UI or saved to Gallery's system configuration. In config-file mode, select the destination in the file
instead, because the Backup section is read-only in the web UI:

```json
{
  "backup": {
    "database": {
      "destination": "both"
    }
  }
}
```

Use `local`, `cloud`, or `both` for the destination. Configure the environment variables before selecting `cloud`
or `both`; the server reports missing cloud configuration rather than silently claiming to back up remotely.

## Existing S3 backup settings

Older Gallery versions used `backup.database.s3.enabled` to upload backups to the media bucket under `backups/`.
That setting is retained for existing configuration files, which are migrated to **Cloud only** and continue to
use the media bucket and its existing S3 credentials when `IMMICH_STORAGE_BACKEND=s3`; otherwise the legacy
setting falls back to local backups. New configurations should use `destination` and the independent
`IMMICH_BACKUP_S3_*` variables. Selecting a new destination in the UI clears the deprecated setting.

## How backups are stored

The backup is first written to `UPLOAD_LOCATION/backups` under a temporary name. Once the dump succeeds, it is
renamed to its final name so a partial dump is never mistaken for a usable backup.

- **Local only:** the finished backup remains on disk.
- **Cloud only:** the finished backup is uploaded to the configured prefix and verified before the local copy is
  removed. If upload or verification fails, the local copy remains and the next cleanup retries it.
- **Local and cloud:** the backup is uploaded and verified, and both copies are retained.

The automatic restore point Gallery takes before a restore always stays on local disk. It exists to recover a
restore that goes wrong and must not depend on the remote store being available.

| What goes wrong                   | What happens                                                                                                                          |
| :-------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------ |
| The dump itself fails             | The temporary file is removed and the job fails, as it does with local backups.                                                       |
| The upload fails                  | The local backup remains; the job reports the failure and the next cleanup retries the upload.                                        |
| The local delete fails            | In cloud-only mode, a warning is logged. The verified cloud copy remains available and the local duplicate is retried during cleanup. |
| The cloud bucket cannot be listed | A warning is logged. Backups remain visible from the local disk, and retention does not prune while the remote inventory is unknown.  |

## Retention, downloads and restores

- **Retention** (`Keep last amount`) applies to the combined set of routine backups, counting a backup found in
  both places once. Expired backups are removed from every destination where they exist. A failed cloud upload is
  retried before retention runs.
- **The backup list** merges local and cloud backups, deduplicated by filename. If one destination is unavailable,
  backups from the other remain visible.
- **Downloading** a cloud backup is streamed through the authenticated server route. Backups do not use
  `IMMICH_S3_SERVE_MODE`: a presigned redirect would allow anyone holding its URL to fetch the database dump
  without signing in.
- **Restoring** reads the backup from whichever destination has it. The pre-restore safety backup remains local.
- **Uploading** a backup through the admin UI uses the same staging and destination flow.

When switching to **Local only**, existing cloud objects are left in the bucket but are no longer listed or used by
Gallery. Delete them separately if they are no longer needed.

:::caution
Database backups contain metadata only, never photos or videos. Pair them with a copy of the files in
`UPLOAD_LOCATION`, as described in [Backup and Restore](/administration/backup-and-restore). A database dump
contains every user's password hash and session tokens, so keep the bucket private and encrypted at rest.
:::
