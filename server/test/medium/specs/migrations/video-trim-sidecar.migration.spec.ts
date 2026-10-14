import { Kysely, sql } from 'kysely';
import { beforeAll, describe, expect, it } from 'vitest';
import { AssetType } from 'src/enum.js';
import { DB } from 'src/schema/index.js';
import * as moveTrim from 'src/schema/migrations-gallery/1798900000000-MoveVideoTrimToSidecar.js';
import { SyncTestContext } from 'test/medium.factory.js';
import { getKyselyDB } from 'test/utils.js';

// Replays the upgrade from a release that stored trims in asset_edit and wrote the trimmed length into
// asset.duration, on this file's own database copy.
let db: Kysely<DB>;

beforeAll(async () => {
  db = await getKyselyDB();
});

const assets = async (ids: string[]) => {
  const { rows } = await sql<{ id: string; duration: number | null; isEdited: boolean; updateId: string }>`
    SELECT id, duration, "isEdited", "updateId" FROM asset WHERE id = ANY(${ids}::uuid[])
  `.execute(db);
  return Object.fromEntries(rows.map((row) => [row.id, row]));
};

const insertEdit = async (assetId: string, action: string, parameters: object, sequence = 0) => {
  const { id } = await db
    .insertInto('asset_edit')
    .values({ assetId, action: action as any, parameters: parameters as any, sequence })
    .returning('id')
    .executeTakeFirstOrThrow();
  return id;
};

describe('1798900000000-MoveVideoTrimToSidecar', () => {
  it('moves trims to the sidecar, restores the original duration and keeps the asset edited', async () => {
    const ctx = new SyncTestContext(db);
    await moveTrim.down(db);

    const { user } = await ctx.newUser();
    const newVideo = () => ctx.newAsset({ ownerId: user.id, type: AssetType.Video, duration: 30_000 });
    const { asset: trimmed } = await newVideo();
    const { asset: pending } = await newVideo();
    const { asset: legacy } = await newVideo();
    const { asset: cropped } = await ctx.newAsset({ ownerId: user.id });

    // The trim job had finished for `trimmed`, not yet for `pending`; `legacy` carries no originalDuration.
    const trimmedEdit = await insertEdit(trimmed.id, 'trim', { startTime: 5, endTime: 25, originalDuration: 30 });
    const pendingEdit = await insertEdit(pending.id, 'trim', { startTime: 1, endTime: 4, originalDuration: 30 });
    const legacyEdit = await insertEdit(legacy.id, 'trim', { startTime: 0, endTime: 8 });
    const cropEdit = await insertEdit(cropped.id, 'crop', { x: 0, y: 0, width: 10, height: 10 });
    await sql`UPDATE asset SET duration = 19500 WHERE id = ${trimmed.id}`.execute(db);
    await sql`UPDATE asset SET duration = 8000 WHERE id = ${legacy.id}`.execute(db);
    const ids = [trimmed.id, pending.id, legacy.id, cropped.id];
    const before = await assets(ids);
    expect(Object.values(before).every(({ isEdited }) => isEdited)).toBe(true);

    await moveTrim.up(db);

    const { rows: sidecar } = await sql<{ assetId: string; startTime: number; endTime: number }>`
      SELECT * FROM asset_video_trim ORDER BY "startTime"
    `.execute(db);
    expect(sidecar).toEqual(
      expect.arrayContaining([
        { assetId: trimmed.id, startTime: 5, endTime: 25, duration: 19_500 },
        { assetId: pending.id, startTime: 1, endTime: 4, duration: null },
        { assetId: legacy.id, startTime: 0, endTime: 8, duration: 8000 },
      ]),
    );
    expect(sidecar).toHaveLength(3);

    const after = await assets(ids);
    expect(after[trimmed.id].duration).toBe(30_000);
    expect(after[pending.id].duration).toBe(30_000);
    expect(after[legacy.id].duration).toBe(8000);
    expect(Object.values(after).every(({ isEdited }) => isEdited)).toBe(true);
    // Clients re-sync the trimmed videos, whose projected duration is unchanged.
    expect(after[trimmed.id].updateId).not.toBe(before[trimmed.id].updateId);
    expect(after[cropped.id].updateId).toBe(before[cropped.id].updateId);

    const { rows: edits } = await sql<{ id: string }>`SELECT id FROM asset_edit`.execute(db);
    expect(edits).toEqual([{ id: cropEdit }]);
    const { rows: audits } = await sql<{ editId: string }>`SELECT "editId" FROM asset_edit_audit`.execute(db);
    expect(audits.map(({ editId }) => editId).toSorted()).toEqual([trimmedEdit, pendingEdit, legacyEdit].toSorted());

    await moveTrim.down(db);

    const { rows: restored } = await sql<{ assetId: string; parameters: Record<string, number> }>`
      SELECT "assetId", parameters FROM asset_edit WHERE action = 'trim'
    `.execute(db);
    expect(restored).toEqual(
      expect.arrayContaining([
        { assetId: trimmed.id, parameters: { startTime: 5, endTime: 25, originalDuration: 30 } },
        { assetId: pending.id, parameters: { startTime: 1, endTime: 4, originalDuration: 30 } },
      ]),
    );
    const reverted = await assets(ids);
    expect(reverted[trimmed.id].duration).toBe(19_500);
    expect(reverted[pending.id].duration).toBe(30_000);
    const { rows: table } = await sql`SELECT to_regclass('asset_video_trim') AS name`.execute(db);
    expect(table).toEqual([{ name: null }]);

    await moveTrim.up(db);
  });

  it('keeps the lowest-sequence trim when an asset carries two', async () => {
    const ctx = new SyncTestContext(db);
    await moveTrim.down(db);

    const { user } = await ctx.newUser();
    const { asset } = await ctx.newAsset({ ownerId: user.id, type: AssetType.Video, duration: 30_000 });
    const second = await insertEdit(asset.id, 'trim', { startTime: 2, endTime: 9, originalDuration: 30 }, 1);
    const first = await insertEdit(asset.id, 'trim', { startTime: 5, endTime: 25, originalDuration: 30 }, 0);

    await moveTrim.up(db);

    const { rows: sidecar } = await sql<{ startTime: number }>`
      SELECT "startTime" FROM asset_video_trim WHERE "assetId" = ${asset.id}
    `.execute(db);
    expect(sidecar).toEqual([{ startTime: 5 }]);
    const { rows: edits } = await sql`SELECT id FROM asset_edit WHERE id IN (${first}, ${second})`.execute(db);
    expect(edits).toEqual([]);
  });
});
