# Switching from Immich to Gallery

Gallery runs on your existing Immich database, media and configuration. You change two image names, and on first start Gallery adds its own tables and columns. Your photos and videos stay where they are.

## Check your Immich version first

Gallery is built on top of a specific Immich release, its upstream base. The current base is **Immich v3.3.1**.

:::warning
Switch only from Immich **v3.3.1 or older**. A database that a newer Immich has already migrated contains migrations Gallery does not ship yet, and Gallery refuses to start against it. If you already run a newer Immich, wait for a Gallery release based on that version. Downgrades are not supported.
:::

To see which version you run, check the server version in the Immich web app, or the image tag of `immich-server` in your `docker-compose.yml` and `.env`.

## 1. Back up your database

Take a `pg_dump` before you switch. Restoring it is the cleanest way back to Immich, and your safety net if anything goes wrong.

```bash
docker exec immich_postgres pg_dump -U postgres -d immich \
  > immich-pre-gallery-$(date +%F).sql
```

Use your own container name, user and database name if they differ. Keep the file outside your install directory.

## 2. Change the images

Set the Gallery version in your `.env` file:

```bash
IMMICH_VERSION=v5
```

Change the two image names in your `docker-compose.yml`:

```diff
services:
  immich-server:
-   image: ghcr.io/immich-app/immich-server:${IMMICH_VERSION:-release}
+   image: ghcr.io/open-noodle/gallery-server:${IMMICH_VERSION:-release}

  immich-machine-learning:
-   image: ghcr.io/immich-app/immich-machine-learning:${IMMICH_VERSION:-release}
+   image: ghcr.io/open-noodle/gallery-ml:${IMMICH_VERSION:-release}
```

Keep any hardware acceleration suffix on the machine learning tag, for example `-cuda`.

## 3. Restart

```bash
docker compose pull
docker compose up -d
```

On first start Gallery applies the Immich migrations up to its base, if your database is older, and then its own. It records its own migrations in a separate `gallery_migrations` table and leaves the Immich migration history in `kysely_migrations` as Immich wrote it.

## Switching back

Flip the two image names back and restore the backup from step 1. If you skipped the backup, see [Switching Back to Immich](./switch-back-to-immich.md).
