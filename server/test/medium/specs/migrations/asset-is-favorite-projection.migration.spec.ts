import { Kysely, sql } from 'kysely';
import { beforeAll, describe, expect, it } from 'vitest';
import { DB } from 'src/schema/index.js';
import * as addFavoriteTables from 'src/schema/migrations-gallery/1794000000000-AddAssetFavoriteTables.js';
import * as dropColumn from 'src/schema/migrations-gallery/1794100000000-DropAssetIsFavoriteColumn.js';
import * as restoreProjection from 'src/schema/migrations-gallery/1798800000000-RestoreAssetIsFavoriteProjection.js';
import { SyncTestContext } from 'test/medium.factory.js';
import { getKyselyDB } from 'test/utils.js';

// The upgrade path from a release older than the overlay, replayed on this file's own database copy:
// favorites live in asset."isFavorite", 1794000000000 copies them into asset_favorite, 1794100000000
// drops the column, Gallery then writes only the overlay, and 1798800000000 restores the column as the
// owner's projection.
let db: Kysely<DB>;

beforeAll(async () => {
  db = await getKyselyDB();
});

const columnValues = async (ids: string[]) => {
  const { rows } = await sql<{ id: string; isFavorite: boolean; updateId: string }>`
    SELECT id, "isFavorite", "updateId" FROM asset WHERE id = ANY(${ids}::uuid[])
  `.execute(db);
  return Object.fromEntries(rows.map((row) => [row.id, row]));
};

const overlay = async () => {
  const { rows } = await sql<{ userId: string; assetId: string }>`
    SELECT "userId", "assetId" FROM asset_favorite ORDER BY "userId", "assetId"
  `.execute(db);
  return rows;
};

describe('1798800000000-RestoreAssetIsFavoriteProjection', () => {
  it('backfills owner favorites made before and after the column drop, and only those', async () => {
    const ctx = new SyncTestContext(db);
    await restoreProjection.down(db);
    await dropColumn.down(db);
    await addFavoriteTables.down(db);

    const { user: owner } = await ctx.newUser();
    const { user: member } = await ctx.newUser();
    const { asset: oldFavorite } = await ctx.newAsset({ ownerId: owner.id, isFavorite: true });
    const { asset: plain } = await ctx.newAsset({ ownerId: owner.id });

    await addFavoriteTables.up(db);
    const { asset: newFavorite } = await ctx.newAsset({ ownerId: owner.id });
    await dropColumn.up(db);
    await sql`
      INSERT INTO asset_favorite ("userId", "assetId")
      VALUES (${member.id}, ${oldFavorite.id}), (${member.id}, ${plain.id}), (${owner.id}, ${newFavorite.id})
    `.execute(db);
    const ids = [oldFavorite.id, plain.id, newFavorite.id];
    const { rows: columns } = await sql`
      SELECT 1 FROM information_schema.columns WHERE table_name = 'asset' AND column_name = 'isFavorite'
    `.execute(db);
    expect(columns).toEqual([]);
    const { rows: updateIds } = await sql<{ id: string; updateId: string }>`
      SELECT id, "updateId" FROM asset WHERE id = ANY(${ids}::uuid[])
    `.execute(db);
    const updateIdBefore = Object.fromEntries(updateIds.map(({ id, updateId }) => [id, updateId]));
    const overlayBefore = await overlay();

    await restoreProjection.up(db);

    const after = await columnValues(ids);
    expect(after[oldFavorite.id].isFavorite).toBe(true);
    expect(after[newFavorite.id].isFavorite).toBe(true);
    expect(after[plain.id].isFavorite).toBe(false);
    // The backfill re-syncs owner favorites to stock clients, and nothing else.
    expect(after[oldFavorite.id].updateId).not.toBe(updateIdBefore[oldFavorite.id]);
    expect(after[plain.id].updateId).toBe(updateIdBefore[plain.id]);
    await expect(overlay()).resolves.toEqual(overlayBefore);

    // The triggers are live: a stock-style write reaches the overlay, a member's unfavorite does not reach the column.
    await sql`UPDATE asset SET "isFavorite" = true WHERE id = ${plain.id}`.execute(db);
    await sql`DELETE FROM asset_favorite WHERE "userId" = ${member.id} AND "assetId" = ${oldFavorite.id}`.execute(db);
    const final = await columnValues(ids);
    expect(final[plain.id].isFavorite).toBe(true);
    expect(final[oldFavorite.id].isFavorite).toBe(true);
    await expect(overlay()).resolves.toContainEqual({ userId: owner.id, assetId: plain.id });
  });

  it('round-trips through down() and up()', async () => {
    const ctx = new SyncTestContext(db);
    const { user: owner } = await ctx.newUser();
    const { asset } = await ctx.newAsset({ ownerId: owner.id, isFavorite: true });

    await restoreProjection.down(db);
    const { rows: leftovers } = await sql<{ name: string }>`
      SELECT tgname AS name FROM pg_trigger WHERE tgname LIKE 'asset%favorite_after_%'
      UNION ALL SELECT name FROM migration_overrides WHERE name LIKE '%favorite_after_%'
    `.execute(db);
    expect(leftovers).toEqual([]);

    await restoreProjection.up(db);
    await expect(columnValues([asset.id])).resolves.toMatchObject({ [asset.id]: { isFavorite: true } });
  });
});
