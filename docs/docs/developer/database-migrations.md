# Database Migrations

After making any changes in the `server/src/schema`, a database migration need to run in order to register the changes in the database. Follow the steps below to create a new migration.

1. Run the command

```bash
mise //server:migrations generate <migration-name>
```

2. Check if the migration file makes sense.
3. Move the migration file to folder `./server/src/schema/migrations-gallery` in your code editor. `./server/src/schema/migrations` holds upstream migrations only.
4. Run the command

```bash
mise //server:migrations-gallery sync-order
```

The last step adds the migration to the `ORDER` manifest, which records the order migrations run in. It is committed so that two branches adding a migration conflict in git instead of silently merging out of order, which would stop the server from starting for anyone who ran them in the wrong order.

The server will automatically detect `*.ts` file changes and restart. Part of the server start-up process includes running any new migrations, so it will be applied immediately.

## Reverting a Migration

If you need to undo the most recently applied migration—for example, when developing or testing on schema changes—run:

```bash
mise //server:migrations revert
```

This command rolls back the newest Gallery migration, or the newest upstream migration once no Gallery migration is left, and brings the database schema back to its previous state. Like `mise //server:migrations run`, it goes through the server's own migrator (`server/src/bin/gallery-migrations.ts`, run from `dist/`, so build the server first), because `sql-tools` only knows the `kysely_migrations` ledger and not `gallery_migrations`.
