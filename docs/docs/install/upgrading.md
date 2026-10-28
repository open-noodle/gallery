---
sidebar_position: 95
---

# Upgrading

:::tip Breaking changes
You can see versions that had breaking changes [here][breaking].
:::

When a new version of Gallery is [released][releases], you should read the release notes and account for any breaking changes noted (as mentioned above).
If you use `IMMICH_VERSION` in your `.env` file, it will need to be updated to the latest or desired version.
After that, the application can be upgraded and restarted with the following commands, run in the directory with the `docker-compose.yml` file:

```bash title="Upgrade and restart Gallery"
docker compose pull && docker compose up -d
```

To clean up disk space, the old version's obsolete container images can be deleted with the following command:

```bash title="Clean up unused Docker images"
docker image prune
```

[watchtower]: https://containrrr.dev/watchtower/
[breaking]: https://github.com/open-noodle/gallery/releases?q=label%3Abreaking&expanded=true
[releases]: https://github.com/open-noodle/gallery/releases

## Versioning Policy

Gallery follows [semantic versioning][semver], which tags releases in the format `<major>.<minor>.<patch>`.
We intend for breaking changes, including those to the API or deployment, to be limited to major version releases.
You can configure your Docker image to point to the current major version by using a metatag, such as `:v3`. These metatags do not follow release candidates.

The mobile app is typically compatible with the current and prior major version. However, the server is only compatible with the matching major version.
Thus, we recommend upgrading all mobile clients before upgrading the server to ensure compatibility.

We do not backport patches to earlier versions. We encourage all users to run the most recent stable release of Gallery.
Downgrading is not supported in general: an earlier release does not know the database changes a later one made. To go back to an earlier Gallery release anyway, follow [Rolling back to an earlier release](#rolling-back-to-an-earlier-release).

[semver]: https://semver.org/

## Rolling back to an earlier release

An earlier Gallery release refuses to start on a database that has Gallery migrations it does not ship. Undo those migrations first, with the release you are leaving, which is the one that knows how to undo them. Each step moves its data back to where the earlier release keeps it, so nothing the earlier release can show is lost. Data for features the earlier release does not have goes with the step that undoes them: going back to a 5.7 release drops favorites set by anyone other than the asset's owner, and the record of who added each face. The procedure was tested going back to `v5.8.0-rc.1` and upgrading again; going back to 5.7 was not tested.

Three older Gallery migrations do not move their data back, so going back to a release from before one of them loses that data:

- `1778000000000-MoveClassificationToConfig`: the classification categories. Undoing it recreates the old classification tables empty and removes the categories from the settings.
- `1777000000000-AdminScopedClassification`: the owner and tag of each classification category, which come back empty.
- `1775100000000-DropSpacePersonThumbnailPath`: the thumbnail of each space person, whose path comes back empty.

1. Back up your database.
2. Stop the stack with `docker compose down`, and keep the current image in your compose file for now.
3. Find the newest Gallery migration the earlier release ships, for example for `v5.8.0-rc.1`:

   ```bash
   docker run --rm --entrypoint ls ghcr.io/open-noodle/gallery-server:v5.8.0-rc.1 /usr/src/app/server/dist/schema/migrations-gallery
   ```

4. List the Gallery migrations your database has, newest first:

   ```bash
   docker compose up -d database
   docker compose exec database psql -U postgres -d immich -c 'SELECT "name" FROM "gallery_migrations" ORDER BY "name" DESC LIMIT 20;'
   ```

5. Undo the newest Gallery migration with the current image, and repeat until the newest name left is the one from step 3. Each run logs `Reverted migration "<name>"`. Do not run it once more: when no Gallery migration is left to undo, it undoes one of the base database migrations Gallery shares with its upstream project.

   ```bash
   docker compose run --rm immich-server "node server/dist/bin/gallery-migrations.js revert"
   ```

   This command does not go through the image's start script, so it does not read `*_FILE` secrets. If your compose file passes the database password or URL that way, add `-e DB_PASSWORD=<password>` (or `-e DB_URL=<url>`) to the `run` command.

6. Releases before the separate `gallery_migrations` table (all of 5.7 and the 5.8 release candidates) look for their migration records in `kysely_migrations`. For those, copy the records back:

   ```bash
   docker compose exec database psql -U postgres -d immich -c 'INSERT INTO "kysely_migrations" ("name", "timestamp") SELECT "name", "timestamp" FROM "gallery_migrations" ON CONFLICT ("name") DO NOTHING;'
   ```

   Without this step the earlier release stops on boot with `relation "storage_migration_log" already exists`. The failed boot changes nothing in the database.

7. Switch the image to the earlier release and start the stack.

Use your own container, user and database names if they differ. When you upgrade again, Gallery moves the records back and runs the undone migrations again.

## Migrating to VectorChord

:::info
If you deploy Gallery using Docker Compose, see `ghcr.io/immich-app/postgres` in the `docker-compose.yml` file and have not explicitly set the `DB_VECTOR_EXTENSION` environmental variable, your Gallery database is already using VectorChord and this section does not apply to you.
:::

:::important
If you do not deploy Gallery using Docker Compose and see a deprecation warning for pgvecto.rs on server startup, you should refer to the maintainers of the Gallery distribution for guidance (if using a turnkey solution) or adapt the instructions for your specific setup.
:::

Gallery has migrated off of the deprecated pgvecto.rs database extension to its successor, [VectorChord](https://github.com/tensorchord/VectorChord), which comes with performance improvements in almost every aspect. This section will guide you on how to make this change in a Docker Compose setup.

Before making any changes, please [back up your database](/administration/backup-and-restore). While every effort has been made to make this migration as smooth as possible, there’s always a chance that something can go wrong.

After making a backup, please modify your `docker-compose.yml` file with the following information.

```diff
  [...]

  database:
    container_name: immich_postgres
-   image: docker.io/tensorchord/pgvecto-rs:pg14-v0.2.0@sha256:739cdd626151ff1f796dc95a6591b55a714f341c737e27f045019ceabf8e8c52
+   image: ghcr.io/immich-app/postgres:14-vectorchord0.4.3-pgvectors0.2.0
    environment:
      POSTGRES_PASSWORD: ${DB_PASSWORD}
      POSTGRES_USER: ${DB_USERNAME}
      POSTGRES_DB: ${DB_DATABASE_NAME}
      POSTGRES_INITDB_ARGS: '--data-checksums'
+     # Uncomment the DB_STORAGE_TYPE: 'HDD' var if your database isn't stored on SSDs
+     # DB_STORAGE_TYPE: 'HDD'
    volumes:
      # Do not edit the next line. If you want to change the database storage location on your system, edit the value of DB_DATA_LOCATION in the .env file
      - ${DB_DATA_LOCATION}:/var/lib/postgresql/data
-   healthcheck:
-     test: >-
-       pg_isready --dbname="$${POSTGRES_DB}" --username="$${POSTGRES_USER}" || exit 1;
-       Chksum="$$(psql --dbname="$${POSTGRES_DB}" --username="$${POSTGRES_USER}" --tuples-only --no-align
-       --command='SELECT COALESCE(SUM(checksum_failures), 0) FROM pg_stat_database')";
-       echo "checksum failure count is $$Chksum";
-       [ "$$Chksum" = '0' ] || exit 1
-     interval: 5m
-     start_interval: 30s
-     start_period: 5m
-   command: >-
-     postgres
-     -c shared_preload_libraries=vectors.so
-     -c 'search_path="$$user", public, vectors'
-     -c logging_collector=on
-     -c max_wal_size=2GB
-     -c shared_buffers=512MB
-     -c wal_compression=on
+   shm_size: 128mb
    restart: always

    [...]
```

:::important
If you deviated from the defaults of pg14 or pgvectors0.2.0, you must adjust the pg major version and pgvecto.rs version. If you are still using the default `docker.io/tensorchord/pgvecto-rs:pg14-v0.2.0` image, you can just follow the changes above. For example, if the previous image is `docker.io/tensorchord/pgvecto-rs:pg16-v0.3.0`, the new image should be `ghcr.io/immich-app/postgres:16-vectorchord0.3.0-pgvectors0.3.0` instead of the image specified in the diff.
:::

After making these changes, you can start Gallery as normal. Gallery will make some changes to the DB during startup, which can take seconds to minutes to finish, depending on hardware and library size. In particular, it's normal for the server logs to be seemingly stuck at `Reindexing clip_index` and `Reindexing face_index` for some time if you have over 100k assets in Gallery and/or Gallery is on a relatively weak server. If you see these logs and there are no errors, just give it time.

:::danger
After switching to VectorChord, you should not downgrade Gallery below 1.133.0.
:::

If you hit problems during the migration, contact us on [GitHub](https://github.com/open-noodle/gallery/discussions) or [Discord](https://discord.gg/cxBfbuxyG4).

### VectorChord FAQ

#### I have a separate PostgreSQL instance shared with multiple services. How can I switch to VectorChord?

Please see the [standalone PostgreSQL documentation](/administration/postgres-standalone#migrating-to-vectorchord) for migration instructions. The migration path will be different depending on whether you're currently using pgvecto.rs or pgvector, as well as whether Gallery has superuser DB permissions.

#### Why are so many lines removed from the `docker-compose.yml` file? Does this mean the health check is removed?

These lines are now incorporated into the image itself along with some additional tuning.

#### What does this change mean for my existing DB backups?

The new DB image includes pgvector and pgvecto.rs in addition to VectorChord, so you can use this image to restore from existing backups that used either of these extensions. However, backups made after switching to VectorChord require an image containing VectorChord to restore successfully.

#### Do I still need pgvecto.rs installed after migrating to VectorChord?

pgvecto.rs only needs to be available during the migration, or if you need to restore from a backup that used pgvecto.rs. For a leaner DB and a smaller image, you can optionally switch to an image variant that does not have pgvecto.rs installed, once you have performed the migration and started Gallery: `ghcr.io/immich-app/postgres:14-vectorchord0.4.3`, changing the PostgreSQL version as appropriate.

#### Why does it matter whether my database is on an SSD or an HDD?

These storage mediums have different performance characteristics. As a result, the optimal settings for an SSD are not the same as those for an HDD. Either configuration is compatible with SSD and HDD, but using the right configuration will make Gallery snappier. As a general tip, we recommend users store the database on an SSD whenever possible.

#### Can I use the new database image as a general PostgreSQL image outside of Gallery?

It’s a standard PostgreSQL container image that additionally contains the VectorChord, pgvector, and (optionally) pgvecto.rs extensions. If you were using the previous pgvecto.rs image for other purposes, you can similarly do so with this image.
