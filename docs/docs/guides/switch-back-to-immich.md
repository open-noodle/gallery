# Switching Back to Immich

This guide walks through switching a Gallery instance back to upstream [Immich](https://github.com/immich-app/immich). It runs a cleanup script that strips Gallery-only schema from your database so that the vanilla `immich-server` image will start against it.

:::danger
**This is a one-way, destructive operation.** The cleanup script drops every Gallery-only table and column. Anything stored only in Gallery-specific features is permanently lost. At minimum, you will lose:

- Shared spaces (members, assets, person clusters, libraries, activity, audit history), unless you [keep them as shared albums](#optional-keep-your-spaces-as-shared-albums)
- User groups and memberships
- Classification categories and prompts
- Pet detection results, and every individual pet you named through pet recognition. Pets are removed completely, so they do not come back as people.
- Rule memories. Immich only has "On this day" and birthday memories.
- Video trims. Trimmed videos go back to their full length.
- Photos in share links that the link creator could not have shared in plain Immich. Links that are left with no photos are deleted, and so are album links made from a space to albums the link creator neither owns nor was added to as an editor.
- Asset duplicate checksums
- Library sync state
- Favorites belonging to anyone other than the asset's owner (see note below)

Assets you uploaded through Gallery are preserved, as long as they exist in Immich-native tables (which is the normal case for every file uploaded via the web or mobile app).

**The right answer is to restore the `pg_dump` you took before switching to Gallery.** Use this script only if you skipped that step.
:::

## Trying Immich first

Upstream Immich also starts on a Gallery database without the cleanup script. You can use that to try Immich for a while and then go back to Gallery with nothing lost, as long as you avoid the three actions listed after the steps. Gallery's automated tests run this round trip and check that the data is intact afterwards.

1. Back up your database as in [step 1](#1-back-up-your-database).
2. Open **Administration > Job Queues** and wait until no queue has active or waiting jobs. Stop the Gallery containers as in [step 2](#2-stop-the-gallery-stack), including the Redis flush.
3. Switch the image to Immich as in [step 5](#5-switch-your-compose-file-to-upstream-immich) and start the stack. Set `IMMICH_VERSION` to exactly the Immich release your Gallery release is built on, not a floating tag such as `v3`. It is `upstream.version` in `branding/config.json` at your release's tag, for example `https://github.com/open-noodle/gallery/blob/v5.4.0/branding/config.json` (find your version as in [step 3](#3-download-the-cleanup-script)). For the current `main` branch it is `v3.3.3`. A newer Immich runs its own database migrations, and Gallery then refuses to start on that database until you restore the backup from step 1.

Immich shows each user their own photos and videos, with their own favorites. Workflow steps with a Gallery action, such as adding uploads to a space, do nothing while Immich runs. If Immich's server stops at startup with `cannot resolve import "extism:host/user" "gallery"`, your Gallery release is older than this guide: update Gallery, start it once and stop it again before you switch, so it replaces its workflow plugin with one Immich can load. A trimmed video plays at full length and shows its full duration, but its thumbnail is still taken from the trimmed part. Immich's schema check warns about Gallery's database functions and about Gallery's rows in `migration_overrides` (for functions, triggers and indexes); those warnings are expected here.

While you try Immich, do not do any of these, or going back to Gallery loses data:

- **Do not change settings in Immich**, neither under **Administration > Settings** nor in a user's own settings. Immich saves only the settings it knows, so the first save erases every Gallery setting: classification categories, pet detection and recognition, memory settings and the other Gallery-only options. A user's settings save erases their Gallery memory type choices the same way. Back on Gallery, those settings are back at their defaults, and classification categories have no other copy.
- **Do not share a person with another user.** Immich's person sharing fails with a server error on a Gallery database, because of an index Gallery keeps on the `person` table. Nothing is saved. After the cleanup script it works.
- **Do not run face detection again in Immich**: no **Refresh faces** on a photo, no photo edits, and no **Refresh** or **Reset** for **Face Detection** under **Administration > Job Queues** (**Missing** is safe). Gallery stores pet faces as faces, and Immich deletes every face its own detection does not find again, so the pet faces on those photos are lost. Back on Gallery, they come back only when pet detection runs on those photos again.

Never run Gallery and Immich on the same database at the same time. If both change the favorite on the same photo at the same moment, the database can stop one of the two changes with a deadlock error.

To go back to Gallery, wait until Immich's job queues are empty, stop Immich, flush Redis again, switch the image back to Gallery and start the stack. Favorites you changed in Immich carry over.

To stay on Immich, you still have to run the cleanup script below. Without it, these problems remain, and they also apply while you try Immich:

- Share links made from a space keep showing other members' photos, even after those members leave the space.
- Files stored in S3 do not load.
- The Immich mobile app stops syncing when it receives a rule memory, which it cannot read.
- Pets show up as people.

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

### Optional: keep your spaces as shared albums

By default the script deletes shared spaces. To keep each one as an Immich shared album instead, add one more `-c` line next to the token:

```bash
docker exec immich_postgres psql -U postgres -d immich \
  -v ON_ERROR_STOP=1 \
  -c "SET gallery.revert_token = 'i_accept_data_loss';" \
  -c "SET gallery.convert_spaces = 'on';" \
  -f /tmp/revert-to-immich.sql
```

- Each space becomes one album with the same name and description. It holds the space's photos, the photos of its linked libraries as they are now (the album does not follow the library any more), the photos of its linked albums shown in the space, and the photos members added to those albums. Trashed photos are left out.
- The space creator owns the album. If that account was deleted, the longest-standing member takes over, space owners first. Space owners and editors become album editors, viewers stay viewers. A space whose members have all been deleted is skipped.
- Every member also gets direct access to the space's linked albums, as an editor if they owned or edited any space that linked the album, else as a viewer. Someone who already had access to such an album keeps their role.
- Workflow steps that add photos to a space now add them to that space's album. Steps that add photos to an album inside a space have no Immich equivalent and are deleted.
- A space person's name and birthday are copied to the matching person in each member's own people, if that person has none yet.
- Not kept: space colours, folders, hidden albums, activity, nicknames for people.

Gallery lets members favorite each other's photos; Immich only keeps favorites on your own photos. To keep those too, also add `-c "SET gallery.convert_favorites = 'on';"`: each such member gets a private album called "Favorites from shared spaces" with the photos they can still reach. The owners of those photos cannot see or remove them from that album, which is why this is off unless you ask for it.

The stock Immich mobile app picks up the new albums as shared albums on its next sync.

## 5. Switch your compose file to upstream Immich

Edit your `docker-compose.yml` and replace every reference to the Gallery image with the upstream `immich-server` image. Pin the Immich release your Gallery release is built on: `upstream.version` in `branding/config.json` at your release's tag, as in [Trying Immich first](#trying-immich-first). For the current `main` branch it is `v3.3.3`. After the cleanup script has run, a newer Immich release also works.

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
IMMICH_VERSION=v3.3.3
```

## 6. Start the stack

```bash
docker compose up -d
docker compose logs -f immich-server
```

Watch the server log. A successful boot ends with the usual Immich startup banner and no migration errors. If you see a "missing migration" or "corrupted migrations" error, the cleanup did not complete. Restore your `pg_dump` from step 1 and open an issue on the Gallery repository with the full error output.

## What was removed

Here is what the cleanup script changes:

- It drops the Gallery-only tables `shared_space*`, `album_space_asset*`, `library_user`, `library_audit`, `library_asset_audit`, `shared_space_library*`, `face_identity*`, `face_repair*`, `pet_search`, `user_group`, `user_group_member`, `classification_category`, `classification_prompt_embedding`, `storage_migration_log`, `asset_duplicate_checksum`, `asset_favorite`, `asset_favorite_audit`, `asset_video_trim`, `face_person_verdict`, `shared_link_space`, `asset_face_creator`, `person_identity`, `person_pet` and `asset_job_status_gallery`. The last five hold data that older Gallery releases kept in extra columns on Immich tables: which space a share link came from, who drew a face, a person's face identity, which people are pets, and the pet detection and classification progress of each asset.
- On a database last run by an older Gallery release, it also drops the columns that release added to Immich tables: `person.type`, `person.species`, `person.identityId`, `asset_job_status.petsDetectedAt`, `asset_job_status.classifiedAt`, `library.createId`, `shared_link.spaceId` and `asset_face.createdBy`. Current releases add no columns to Immich tables, only indexes and triggers, which the script also drops.
- It keeps `asset.isFavorite`, the upstream Immich column that holds each owner's favorites, and drops `asset_favorite`, the overlay Gallery uses so each space member can favorite independently. On a database last run by a Gallery release that had removed the column, it first restores the column and fills it from the overlay, for the asset's owner only. Favorites belonging to anyone else (for example, a shared-space viewer who favorited another member's photo) have no equivalent in plain Immich's single-favorite-flag model and are discarded. Your own favorites on your own assets are preserved.
- It deletes pets: their people, the faces detected on them and their recognition data. Without this they would show up as people.
- It deletes rule memories, which the Immich mobile app cannot read.
- It undoes video trims: the full-length video comes back, and the trim and its trimmed video and thumbnails are no longer referenced. On a database last run by an older Gallery release, which stored the trimmed length as the video's duration, it also restores the original duration. Those files stay on disk. The blurred placeholder Immich shows while a thumbnail loads is cleared and rebuilt from the original by the nightly missing thumbnails task.
- It removes from share links every photo the link creator could not share in plain Immich. The creator keeps their own photos, and a partner's photos only while that partner still shares with them, the partner's account is not deleted, and the photo is not archived or locked. Gallery hid the other photos once they left the space; Immich would keep showing them. Links left with no photos are deleted.
- It deletes album links made from a space to albums the link creator neither owns nor was added to as an editor, the same rule Immich uses for sharing an album. Being a member of the space is not enough: Immich does not know about spaces. Album links made outside a space are kept.
- It removes Gallery-only settings rows from `system_metadata` and Gallery-only permissions from API keys.
- It drops the Gallery-only functions and triggers that reference the dropped tables.
- It strips every Gallery setting out of the `system-config` row in `system_metadata`, including the classification categories, and Gallery's memory type choices out of each user's preferences.
- It deletes the sync checkpoints of Gallery's own sync streams from `session_sync_checkpoint`.
- It resets the `jit = off` setting Gallery puts on the database to the PostgreSQL default.
- It drops Gallery's own migration history table, `gallery_migrations`, and deletes fork rows from `kysely_migrations` (where older Gallery versions recorded them) and `migration_overrides`, so upstream Immich's migrator does not see them as unknown migrations.
- Where needed, it rolls back upstream migrations that Gallery pulled in after the currently supported Immich tag. Gallery may be rebased onto upstream commits newer than the Immich release you switch back to, so the script also removes those migration rows and reverses their schema changes before vanilla Immich starts.

The script header documents each step in detail.
