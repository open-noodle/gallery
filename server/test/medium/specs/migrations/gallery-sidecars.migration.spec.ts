import { Kysely, RawBuilder, sql } from 'kysely';
import { beforeAll, describe, expect, it } from 'vitest';
import { SharedLinkType } from 'src/enum.js';
import { DB } from 'src/schema/index.js';
import * as sharedLinkSpace from 'src/schema/migrations-gallery/1798000000000-AddSharedLinkSpaceTable.js';
import * as assetFaceCreator from 'src/schema/migrations-gallery/1798100000000-AddAssetFaceCreatorTable.js';
import * as libraryCreateId from 'src/schema/migrations-gallery/1798200000000-DropLibraryCreateId.js';
import { SyncTestContext } from 'test/medium.factory.js';
import { getKyselyDB } from 'test/utils.js';

// down() then up() on this file's own database copy: down() must move each sidecar's rows back onto
// the upstream column, and up() must move them out again (the backfill an upgrading database runs).
let db: Kysely<DB>;

beforeAll(async () => {
  db = await getKyselyDB();
});

const raw = async <T>(query: RawBuilder<T>) => {
  const { rows } = await query.execute(db);
  return rows;
};

describe('1798000000000-AddSharedLinkSpaceTable', () => {
  it('round-trips the link space through shared_link."spaceId"', async () => {
    const ctx = new SyncTestContext(db);
    const { user } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: user.id });
    const { sharedLink } = await ctx.newSharedLink({
      userId: user.id,
      type: SharedLinkType.Individual,
      spaceId: space.id,
    });
    const { sharedLink: plainLink } = await ctx.newSharedLink({ userId: user.id, type: SharedLinkType.Individual });

    await sharedLinkSpace.down(db);
    await expect(
      raw(
        sql<{
          id: string;
          spaceId: string | null;
        }>`SELECT id, "spaceId" FROM shared_link WHERE id IN (${sharedLink.id}, ${plainLink.id}) ORDER BY array_position(ARRAY[${sharedLink.id}, ${plainLink.id}]::uuid[], id)`,
      ),
    ).resolves.toEqual([
      { id: sharedLink.id, spaceId: space.id },
      { id: plainLink.id, spaceId: null },
    ]);
    await expect(raw(sql`SELECT to_regclass('shared_link_space') AS t`)).resolves.toEqual([{ t: null }]);

    await sharedLinkSpace.up(db);
    await expect(db.selectFrom('shared_link_space').selectAll().execute()).resolves.toEqual([
      { sharedLinkId: sharedLink.id, spaceId: space.id },
    ]);
    await expect(
      raw(
        sql`SELECT column_name FROM information_schema.columns WHERE table_name = 'shared_link' AND column_name = 'spaceId'`,
      ),
    ).resolves.toEqual([]);
  });
});

describe('1798100000000-AddAssetFaceCreatorTable', () => {
  it('round-trips the face creator through asset_face."createdBy"', async () => {
    const ctx = new SyncTestContext(db);
    const { user } = await ctx.newUser();
    const { asset } = await ctx.newAsset({ ownerId: user.id });
    const { result: drawn } = await ctx.newAssetFace({ assetId: asset.id, createdBy: user.id });
    const { result: detected } = await ctx.newAssetFace({ assetId: asset.id });

    await assetFaceCreator.down(db);
    await expect(
      raw(
        sql<{
          id: string;
          createdBy: string | null;
        }>`SELECT id, "createdBy" FROM asset_face WHERE id IN (${drawn}, ${detected}) ORDER BY array_position(ARRAY[${drawn}, ${detected}]::uuid[], id)`,
      ),
    ).resolves.toEqual([
      { id: drawn, createdBy: user.id },
      { id: detected, createdBy: null },
    ]);

    await assetFaceCreator.up(db);
    await expect(db.selectFrom('asset_face_creator').selectAll().execute()).resolves.toEqual([
      { assetFaceId: drawn, userId: user.id },
    ]);
    await expect(
      raw(
        sql`SELECT column_name FROM information_schema.columns WHERE table_name = 'asset_face' AND column_name = 'createdBy'`,
      ),
    ).resolves.toEqual([]);
  });
});

describe('1798200000000-DropLibraryCreateId', () => {
  it('restores library."createId" on down() and still grants the owner on insert after up()', async () => {
    const ctx = new SyncTestContext(db);
    const { user } = await ctx.newUser();

    await libraryCreateId.down(db);
    const { library: before } = await ctx.newLibrary({ ownerId: user.id });
    const [{ createId }] = await raw(sql<{ createId: string }>`SELECT "createId" FROM library WHERE id = ${before.id}`);
    // The restored trigger copies library."createId" again.
    await expect(
      db.selectFrom('library_user').select('createId').where('libraryId', '=', before.id).execute(),
    ).resolves.toEqual([{ createId }]);

    await libraryCreateId.up(db);
    await expect(
      raw(
        sql`SELECT column_name FROM information_schema.columns WHERE table_name = 'library' AND column_name = 'createId'`,
      ),
    ).resolves.toEqual([]);
    const { library: after } = await ctx.newLibrary({ ownerId: user.id });
    await expect(
      db.selectFrom('library_user').select('userId').where('libraryId', '=', after.id).execute(),
    ).resolves.toEqual([{ userId: user.id }]);
  });
});
