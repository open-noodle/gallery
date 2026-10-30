import { Kysely, sql } from 'kysely';
import { beforeAll, describe, expect, it } from 'vitest';
import { DB } from 'src/schema/index.js';
import * as addScreenshotVersion from 'src/schema/migrations-gallery/1799600000000-AddAssetQualityScreenshotVersion.js';
import { SyncTestContext } from 'test/medium.factory.js';
import { getKyselyDB } from 'test/utils.js';

// Replays the upgrade from a build whose asset_quality had one `version` for the pixel scores and the screenshot
// flag, and the downgrade, on this file's own database copy.
let db: Kysely<DB>;

beforeAll(async () => {
  db = await getKyselyDB();
});

const columnExists = async () => {
  const { rows } = await sql<{ exists: boolean }>`
    SELECT EXISTS (
      SELECT FROM information_schema.columns WHERE table_name = 'asset_quality' AND column_name = 'screenshotVersion'
    ) AS exists
  `.execute(db);
  return rows[0].exists;
};

describe('1799600000000-AddAssetQualityScreenshotVersion', () => {
  it('stamps existing rows with their version as the screenshot version, and drops the column on downgrade', async () => {
    const ctx = new SyncTestContext(db);
    await addScreenshotVersion.down(db);
    expect(await columnExists()).toBe(false);

    const { user } = await ctx.newUser();
    const { asset: v1 } = await ctx.newAsset({ ownerId: user.id });
    const { asset: v3 } = await ctx.newAsset({ ownerId: user.id });
    await sql`
      INSERT INTO asset_quality ("assetId", "ownerId", sharpness, "isScreenshot", version)
      VALUES (${v1.id}, ${user.id}, 10, true, 1), (${v3.id}, ${user.id}, 20, false, 3)
    `.execute(db);

    await addScreenshotVersion.up(db);

    const { rows } = await sql<{ assetId: string; version: number; screenshotVersion: number; isScreenshot: boolean }>`
      SELECT "assetId", version, "screenshotVersion", "isScreenshot" FROM asset_quality
    `.execute(db);
    expect(rows).toEqual(
      expect.arrayContaining([
        { assetId: v1.id, version: 1, screenshotVersion: 1, isScreenshot: true },
        { assetId: v3.id, version: 3, screenshotVersion: 3, isScreenshot: false },
      ]),
    );
    expect(rows).toHaveLength(2);
    const { asset: unstamped } = await ctx.newAsset({ ownerId: user.id });
    await expect(
      sql`INSERT INTO asset_quality ("assetId", "ownerId", version) VALUES (${unstamped.id}, ${user.id}, 1)`.execute(db),
    ).rejects.toThrow(/screenshotVersion/);

    await addScreenshotVersion.down(db);
    expect(await columnExists()).toBe(false);
    const { rows: kept } = await sql<{ assetId: string; version: number; isScreenshot: boolean }>`
      SELECT "assetId", version, "isScreenshot" FROM asset_quality
    `.execute(db);
    expect(kept).toEqual(
      expect.arrayContaining([
        { assetId: v1.id, version: 1, isScreenshot: true },
        { assetId: v3.id, version: 3, isScreenshot: false },
      ]),
    );

    await addScreenshotVersion.up(db);
    expect(await columnExists()).toBe(true);
  });
});
