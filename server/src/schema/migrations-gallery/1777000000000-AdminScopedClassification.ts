import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  const admin = await sql<{ id: string }>`
    SELECT "id" FROM "user" WHERE "isAdmin" = true ORDER BY "createdAt" ASC LIMIT 1
  `.execute(db);

  if (admin.rows.length > 0) {
    const adminId = admin.rows[0].id;

    await sql`
      UPDATE "classification_category" cc
      SET "name" = cc."name" || ' (' || u."name" || ')'
      FROM "user" u
      WHERE cc."userId" = u."id"
        AND cc."userId" != ${adminId}
        AND EXISTS (
          SELECT 1 FROM "classification_category" admin_cc
          WHERE admin_cc."userId" = ${adminId}
            AND admin_cc."name" = cc."name"
        )
    `.execute(db);

    await sql`
      UPDATE "classification_category" SET "userId" = ${adminId}
      WHERE "userId" != ${adminId}
    `.execute(db);
  }

  await sql`ALTER TABLE "classification_category" DROP COLUMN "tagId"`.execute(db);
  await sql`ALTER TABLE "classification_category" DROP CONSTRAINT "classification_category_userId_name_uq"`.execute(db);
  await sql`ALTER TABLE "classification_category" DROP COLUMN "userId"`.execute(db);
  await sql`ALTER TABLE "classification_category" ADD CONSTRAINT "classification_category_name_uq" UNIQUE ("name")`.execute(
    db,
  );
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`ALTER TABLE "classification_category" DROP CONSTRAINT IF EXISTS "classification_category_name_uq"`.execute(
    db,
  );
  await sql`ALTER TABLE "classification_category" ADD COLUMN "userId" uuid REFERENCES "user"("id") ON UPDATE CASCADE ON DELETE CASCADE`.execute(
    db,
  );
  await sql`ALTER TABLE "classification_category" ADD COLUMN "tagId" uuid REFERENCES "tag"("id") ON DELETE SET NULL`.execute(
    db,
  );
  await sql`ALTER TABLE "classification_category" ADD CONSTRAINT "classification_category_userId_name_uq" UNIQUE ("userId", "name")`.execute(
    db,
  );
  await sql`CREATE INDEX "classification_category_tagId_idx" ON "classification_category" ("tagId")`.execute(db);
}
