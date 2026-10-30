import { Kysely, sql } from 'kysely';

// Library Cleanup versions the metadata-derived `isScreenshot` apart from the pixel scores, so a change to the
// screenshot rule re-runs without reading every preview again (specs/2026-09-23-library-cleanup-design.md,
// "Changing the quality analysis"). Until now one `version` covered both, so existing rows take it as their
// screenshot version.
export async function up(db: Kysely<any>): Promise<void> {
  await sql`ALTER TABLE "asset_quality" ADD "screenshotVersion" smallint;`.execute(db);
  await sql`UPDATE "asset_quality" SET "screenshotVersion" = "version";`.execute(db);
  await sql`ALTER TABLE "asset_quality" ALTER COLUMN "screenshotVersion" SET NOT NULL;`.execute(db);
}

// "Moving the data back" for derived data: the column only says which rule computed `isScreenshot`, and the build
// before this one has no such stamp, so it is dropped. `version` still stamps the pixel scores and the screenshot
// flag the row holds; the job recomputes both whenever it re-analyses the asset.
export async function down(db: Kysely<any>): Promise<void> {
  await sql`ALTER TABLE "asset_quality" DROP COLUMN "screenshotVersion";`.execute(db);
}
