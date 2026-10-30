import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await sql`ALTER TABLE "shared_space" ADD "editorsCanAddMembers" boolean`.execute(db);
  await sql`ALTER TABLE "shared_space" ADD "editorsCanChangeRoles" boolean`.execute(db);
}

// down drops the columns: there is no earlier home for this data (NULL means "follow the server setting").
export async function down(db: Kysely<any>): Promise<void> {
  await sql`ALTER TABLE "shared_space" DROP COLUMN "editorsCanChangeRoles"`.execute(db);
  await sql`ALTER TABLE "shared_space" DROP COLUMN "editorsCanAddMembers"`.execute(db);
}
