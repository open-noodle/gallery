import { Kysely, sql } from 'kysely';
import { beforeAll, describe, expect, it } from 'vitest';
import { DB } from 'src/schema/index.js';
import * as addImageAdjust from 'src/schema/migrations-gallery/1799000000000-AddAssetImageAdjustTable.js';
import { SyncTestContext } from 'test/medium.factory.js';
import { getKyselyDB } from 'test/utils.js';

// Replays the upgrade from a pre-release build of the Adjust tool, which stored the adjustment as an `adjust`
// asset_edit action, and the downgrade, on this file's own database copy.
let db: Kysely<DB>;

beforeAll(async () => {
  db = await getKyselyDB();
});

const assetRows = async (ids: string[]) => {
  const { rows } = await sql<{ id: string; isEdited: boolean; thumbhash: Buffer | null }>`
    SELECT id, "isEdited", thumbhash FROM asset WHERE id = ANY(${ids}::uuid[])
  `.execute(db);
  return Object.fromEntries(rows.map((row) => [row.id, row]));
};

const insertEdit = (assetId: string, action: string, parameters: object, sequence = 0) =>
  db
    .insertInto('asset_edit')
    .values({ assetId, action: action as any, parameters: parameters as any, sequence })
    .execute();

describe('1799000000000-AddAssetImageAdjustTable', () => {
  it('moves pre-release adjust edits into asset_image_adjust and keeps the assets edited', async () => {
    const ctx = new SyncTestContext(db);
    await addImageAdjust.down(db);

    const { user } = await ctx.newUser();
    const { asset: adjustedOnly } = await ctx.newAsset({ ownerId: user.id });
    const { asset: croppedAndAdjusted } = await ctx.newAsset({ ownerId: user.id });
    const { asset: cropped } = await ctx.newAsset({ ownerId: user.id });
    await insertEdit(adjustedOnly.id, 'adjust', { exposure: 20, invert: true });
    await insertEdit(croppedAndAdjusted.id, 'crop', { x: 0, y: 0, width: 10, height: 10 });
    await insertEdit(croppedAndAdjusted.id, 'adjust', { saturation: -50 }, 1);
    await insertEdit(cropped.id, 'crop', { x: 0, y: 0, width: 10, height: 10 });

    await addImageAdjust.up(db);

    const { rows } = await sql<{ assetId: string; exposure: number; contrast: number; saturation: number; invert: boolean }>`
      SELECT * FROM asset_image_adjust
    `.execute(db);
    expect(rows).toEqual(
      expect.arrayContaining([
        { assetId: adjustedOnly.id, exposure: 20, contrast: 0, saturation: 0, invert: true },
        { assetId: croppedAndAdjusted.id, exposure: 0, contrast: 0, saturation: -50, invert: false },
      ]),
    );
    expect(rows).toHaveLength(2);

    const { rows: edits } = await sql<{ assetId: string; action: string }>`
      SELECT "assetId", action FROM asset_edit WHERE "assetId" = ANY(${[adjustedOnly.id, croppedAndAdjusted.id, cropped.id]}::uuid[])
    `.execute(db);
    expect(edits).toEqual(
      expect.arrayContaining([
        { assetId: croppedAndAdjusted.id, action: 'crop' },
        { assetId: cropped.id, action: 'crop' },
      ]),
    );
    expect(edits).toHaveLength(2);

    const after = await assetRows([adjustedOnly.id, croppedAndAdjusted.id, cropped.id]);
    expect(after[adjustedOnly.id].isEdited).toBe(true);
    expect(after[croppedAndAdjusted.id].isEdited).toBe(true);
    expect(after[cropped.id].isEdited).toBe(true);
  });

  it('drops the adjusted files on downgrade so they regenerate without the adjustment', async () => {
    const ctx = new SyncTestContext(db);
    const { user } = await ctx.newUser();
    const { asset: adjustedOnly } = await ctx.newAsset({ ownerId: user.id, thumbhash: Buffer.from('hash') });
    const { asset: croppedAndAdjusted } = await ctx.newAsset({ ownerId: user.id, thumbhash: Buffer.from('hash') });
    await insertEdit(croppedAndAdjusted.id, 'crop', { x: 0, y: 0, width: 10, height: 10 });
    await sql`INSERT INTO asset_image_adjust ("assetId", exposure) VALUES (${adjustedOnly.id}, 10), (${croppedAndAdjusted.id}, 10)`.execute(
      db,
    );
    await sql`UPDATE asset SET "isEdited" = true WHERE id = ${adjustedOnly.id}`.execute(db);
    for (const assetId of [adjustedOnly.id, croppedAndAdjusted.id]) {
      await sql`INSERT INTO asset_file ("assetId", type, path, "isEdited") VALUES (${assetId}, 'preview', ${`/edited/${assetId}.jpg`}, true)`.execute(
        db,
      );
    }

    await addImageAdjust.down(db);

    const after = await assetRows([adjustedOnly.id, croppedAndAdjusted.id]);
    expect(after[adjustedOnly.id]).toMatchObject({ isEdited: false, thumbhash: null });
    expect(after[croppedAndAdjusted.id]).toMatchObject({ isEdited: true, thumbhash: null });
    const { rows: files } = await sql`
      SELECT 1 FROM asset_file WHERE "isEdited" AND "assetId" = ANY(${[adjustedOnly.id, croppedAndAdjusted.id]}::uuid[])
    `.execute(db);
    expect(files).toEqual([]);
    const { rows: table } = await sql<{ name: string | null }>`SELECT to_regclass('asset_image_adjust') AS name`.execute(db);
    expect(table[0].name).toBeNull();

    await addImageAdjust.up(db);
  });
});
