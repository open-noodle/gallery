import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await sql`CREATE INDEX "shared_space_album_asset_audit_albumId_id_idx" ON "shared_space_album_asset_audit" ("albumId", "id")`.execute(
    db,
  );
  await sql`CREATE INDEX "shared_space_album_user_audit_userId_id_idx" ON "shared_space_album_user_audit" ("userId", "id")`.execute(
    db,
  );
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`DROP INDEX IF EXISTS "shared_space_album_asset_audit_albumId_id_idx"`.execute(db);
  await sql`DROP INDEX IF EXISTS "shared_space_album_user_audit_userId_id_idx"`.execute(db);
}
