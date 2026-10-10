# Switching Back to Immich

This guide walks through switching a Gallery instance back to upstream [Immich](https://github.com/immich-app/immich). It runs a cleanup script that strips Gallery-only schema from your database so that the vanilla `immich-server` image will start against it.

:::danger
**This is a one-way, destructive operation.** The cleanup script drops every Gallery-only table and column. Anything stored only in Gallery-specific features is permanently lost. At minimum, you will lose:

- Shared spaces (members, assets, person clusters, libraries, activity, audit history)
- User groups and memberships
- Classification categories and prompts
- Pet detection results, and every individual pet you named through pet recognition. Pets are removed completely, so they do not come back as people.
- Rule memories. Immich only has "On this day" and birthday memories.
- Video trims. Trimmed videos go back to their full length.
- Photos in share links that the link creator could not have shared in plain Immich. Links that are left with no photos are deleted, and so are album links made from a space to albums the link creator does not own, even when the creator can edit that album.
- Asset duplicate checksums
- Library sync state
- Favorites belonging to anyone other than the asset's owner (see note below)

Assets you uploaded through Gallery are preserved, as long as they exist in Immich-native tables (which is the normal case for every file uploaded via the web or mobile app).

**The right answer is to restore the `pg_dump` you took before switching to Gallery.** Use this script only if you skipped that step.
:::

## Before you start

### Move files out of S3

Upstream Immich can only read files from disk. If you use [S3 storage](/features/s3-storage), move every file back to disk first with the [Storage Migration](/features/storage-migration) tool (**Administration > Storage Migration**, direction **S3 → Disk**, all file types selected). Wait until it finishes and the estimate for **S3 → Disk** shows no files left.

The cleanup script checks this. If any original, thumbnail, encoded video, person thumbnail or profile image still points at S3, it stops with an error before changing anything. The check treats every path that does not start with `/` as an S3 file, so on an install without Docker, `IMMICH_MEDIA_LOCATION` must be an absolute path.

### Let background jobs finish

Open **Administration > Job Queues** and wait until no queue has active or waiting jobs. Jobs that Gallery queued are cleared in step 2 and do not run on Immich.

## 1. Back up your database

Take a `pg_dump` first, even if you plan to run the cleanup script. It is your way back if something goes wrong.

```bash
docker exec immich_postgres pg_dump -U postgres -d immich \
  > gallery-pre-revert-$(date +%F).sql
```

Keep that file outside your Gallery install directory.

## 2. Stop the Gallery stack

The cleanup script takes `ACCESS EXCLUSIVE` locks on many tables, so a running server will either deadlock with it or race it. Stop every app container, but keep the database up so the script can connect:

```bash
docker compose stop immich-server immich-machine-learning
```

Leave `immich_postgres` running.

Then clear the job queue in Redis, so Immich does not start with jobs only Gallery knows how to run:

```bash
docker exec immich_redis redis-cli FLUSHALL
```

Redis only holds the job queue, so nothing else is lost.

## 3. Download the cleanup script

**Use the script attached to the release you are actually running, not the copy on the `main` branch.** Each script targets the exact set of Gallery-only tables, columns and fork migrations for its own release. `main` is always ahead, so its copy can drop things your schema does not have, or miss things it does, if your instance is even one release behind.

Find your version first: run [`immich-admin version`](/administration/server-commands#examples) in the `immich_server` container, or click the version number at the bottom of the sidebar in the Gallery web UI to open the About dialog.

Then open that version's page on the [Gallery releases page](https://github.com/open-noodle/gallery/releases), for example `https://github.com/open-noodle/gallery/releases/tag/v5.4.0`, and download the `revert-to-immich.sql` asset attached to it, either from the browser or with `curl`:

```bash
curl -LO https://github.com/open-noodle/gallery/releases/download/v5.4.0/revert-to-immich.sql
```

Replace `v5.4.0` with your own version. Every release since this asset was introduced ships one. If yours predates it, upgrade to the nearest later release first and use the script attached there.

Read the script header first. It lists every table and column the script will drop.

## 4. Run the cleanup script

Copy the script into the postgres container and run it with `psql`:

```bash
docker cp revert-to-immich.sql immich_postgres:/tmp/
docker exec immich_postgres psql -U postgres -d immich \
  -v ON_ERROR_STOP=1 \
  -c "SET gallery.revert_token = 'i_accept_data_loss';" \
  -f /tmp/revert-to-immich.sql
```

Notes:

- The `gallery.revert_token` setting is a deliberate speed-bump. The script refuses to run without it, so you cannot execute it by accident.
- `ON_ERROR_STOP=1` is important: without it, `psql` will keep going past the first error and leave the database in a half-cleaned state. The script wraps everything in a transaction, so a mid-script failure rolls the whole thing back.
- On success, the last line of output reads:
  ```
  NOTICE: revert-to-immich: cleanup finished. Switch your image to ghcr.io/immich-app/immich-server and start the stack.
  ```

## 5. Switch your compose file to upstream Immich

Edit your `docker-compose.yml` and replace every reference to the Gallery image with the upstream `immich-server` image. Pin a version close to the Immich release Gallery was last rebased from. You can find it in [`branding/config.json`](https://github.com/open-noodle/gallery/blob/main/branding/config.json) in the Gallery repository, under `upstream.version`.

```yaml title="docker-compose.yml"
services:
  immich-server:
    # image: ghcr.io/open-noodle/gallery-server:${IMMICH_VERSION:-release}
    // highlight-next-line
    image: ghcr.io/immich-app/immich-server:${IMMICH_VERSION:-release}
...
  immich-machine-learning:
    #image: ghcr.io/open-noodle/gallery-ml:${IMMICH_VERSION:-release}
    // highlight-next-line
    image: ghcr.io/immich-app/immich-machine-learning:${IMMICH_VERSION:-release}
```

Upstream Immich uses the same [postgres image](https://github.com/immich-app/base-images) as Gallery, so no database image change is needed.

Remove any Gallery-only environment variables from your `.env` file, such as `IMMICH_STORAGE_BACKEND` and the `IMMICH_S3_*` settings. Upstream Immich ignores variables it does not know without any warning, so they do no harm today. They share Immich's `IMMICH_` prefix, though, and a later Immich release could give one of those names a meaning.

```yaml title=".env"
#IMMICH_VERSION=v5
// highlight-next-line
IMMICH_VERSION=v3
```

## 6. Start the stack

```bash
docker compose up -d
docker compose logs -f immich-server
```

Watch the server log. A successful boot ends with the usual Immich startup banner and no migration errors. If you see a "missing migration" or "corrupted migrations" error, the cleanup did not complete. Restore your `pg_dump` from step 1 and open an issue on the Gallery repository with the full error output.

## What was removed

Here is what the cleanup script changes:

- It drops the Gallery-only tables `shared_space*`, `album_space_asset*`, `library_user`, `library_audit`, `library_asset_audit`, `shared_space_library*`, `face_identity*`, `face_repair*`, `pet_search`, `user_group`, `user_group_member`, `classification_category`, `classification_prompt_embedding`, `storage_migration_log`, `asset_duplicate_checksum`, `asset_favorite` and `asset_favorite_audit`.
- It drops the Gallery-added columns `person.type`, `person.species`, `person.identityId`, `asset_job_status.petsDetectedAt`, `asset_job_status.classifiedAt`, `library.createId`, `shared_link.spaceId` and `asset_face.createdBy`.
- It restores `asset.isFavorite`, an upstream Immich column Gallery moved into the `asset_favorite` overlay so each space member can favorite independently, before dropping `asset_favorite`, and backfills it from the overlay, but only for the asset's owner. Favorites belonging to anyone else (for example, a shared-space viewer who favorited another member's photo) have no equivalent in plain Immich's single-favorite-flag model and are discarded. Your own favorites on your own assets are preserved.
- It deletes pets: their people, the faces detected on them and their recognition data. Without this they would show up as people.
- It deletes rule memories, which the Immich mobile app cannot read.
- It undoes video trims: the original duration comes back, and the trim and its trimmed video and thumbnails are no longer referenced. Those files stay on disk. The blurred placeholder Immich shows while a thumbnail loads is cleared and rebuilt from the original by the nightly missing thumbnails task.
- It removes from share links every photo the link creator could not share in plain Immich. The creator keeps their own photos, and a partner's photos only while that partner still shares with them, the partner's account is not deleted, and the photo is not archived or locked. Gallery hid the other photos once they left the space; Immich would keep showing them. Links left with no photos are deleted.
- It deletes album links made from a space to albums the link creator does not own. This is stricter than Immich, which also lets album editors share an album, so such a link an editor created is deleted too. Album links made outside a space are kept.
- It removes Gallery-only settings rows from `system_metadata` and Gallery-only permissions from API keys.
- It drops the Gallery-only functions and triggers that reference the dropped tables.
- It strips the `classification` key out of the `system-config` row in `system_metadata`.
- It deletes fork migration rows from `kysely_migrations` and `migration_overrides`, so upstream Immich's migrator does not see them as unknown migrations.
- Where needed, it rolls back upstream migrations that Gallery pulled in after the currently supported Immich tag. Gallery may be rebased onto upstream commits newer than the Immich release you switch back to, so the script also removes those migration rows and reverses their schema changes before vanilla Immich starts.

The script header documents each step in detail.
