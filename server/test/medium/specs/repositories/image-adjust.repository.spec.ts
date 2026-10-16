import { Kysely } from 'kysely';
import { beforeAll, describe, expect, it } from 'vitest';
import { ImageAdjustRepository } from 'src/gallery/repositories/image-adjust.repository.js';
import { LoggingRepository } from 'src/repositories/logging.repository.js';
import { DB } from 'src/schema/index.js';
import { BaseService } from 'src/services/base.service.js';
import { newMediumService } from 'test/medium.factory.js';
import { getKyselyDB } from 'test/utils.js';

let defaultDatabase: Kysely<DB>;

const adjust = { exposure: 20, contrast: -10, saturation: 0, invert: true };

const setup = async () => {
  const { ctx } = newMediumService(BaseService, { database: defaultDatabase, real: [], mock: [LoggingRepository] });
  const { user } = await ctx.newUser();
  const { asset } = await ctx.newAsset({ ownerId: user.id });
  return { ctx, asset, sut: ctx.get(ImageAdjustRepository) };
};

const isEdited = async (id: string) => {
  const asset = await defaultDatabase
    .selectFrom('asset')
    .select('isEdited')
    .where('id', '=', id)
    .executeTakeFirstOrThrow();
  return asset.isEdited;
};

const addCrop = (assetId: string) =>
  defaultDatabase
    .insertInto('asset_edit')
    .values({ assetId, action: 'crop' as any, parameters: { x: 0, y: 0, width: 10, height: 10 } as any, sequence: 0 })
    .execute();

beforeAll(async () => {
  defaultDatabase = await getKyselyDB();
});

describe(ImageAdjustRepository.name, () => {
  it('stores the adjustment and marks the asset edited, without writing asset_edit', async () => {
    const { asset, sut } = await setup();

    await sut.upsert(asset.id, adjust);

    await expect(sut.get(asset.id)).resolves.toEqual(adjust);
    await expect(isEdited(asset.id)).resolves.toBe(true);
    const edits = await defaultDatabase.selectFrom('asset_edit').where('assetId', '=', asset.id).selectAll().execute();
    expect(edits).toEqual([]);
  });

  it('replaces an earlier adjustment', async () => {
    const { asset, sut } = await setup();
    await sut.upsert(asset.id, adjust);

    await sut.upsert(asset.id, { exposure: 0, contrast: 0, saturation: -100, invert: false });

    await expect(sut.get(asset.id)).resolves.toEqual({ exposure: 0, contrast: 0, saturation: -100, invert: false });
  });

  it('clears isEdited when the adjustment was the only edit', async () => {
    const { asset, sut } = await setup();
    await sut.upsert(asset.id, adjust);

    await expect(sut.delete(asset.id)).resolves.toBe(true);

    await expect(sut.get(asset.id)).resolves.toBeUndefined();
    await expect(isEdited(asset.id)).resolves.toBe(false);
    await expect(sut.delete(asset.id)).resolves.toBe(false);
  });

  it('keeps isEdited when a crop still applies', async () => {
    const { asset, sut } = await setup();
    await addCrop(asset.id);
    await sut.upsert(asset.id, adjust);

    await sut.delete(asset.id);

    await expect(isEdited(asset.id)).resolves.toBe(true);
  });

  it('sets isEdited back after Immich clears it with the last crop', async () => {
    const { asset, sut } = await setup();
    await addCrop(asset.id);
    await sut.upsert(asset.id, adjust);
    // asset_edit_delete clears the flag: it does not know about the adjustment.
    await defaultDatabase.deleteFrom('asset_edit').where('assetId', '=', asset.id).execute();
    await expect(isEdited(asset.id)).resolves.toBe(false);

    await sut.markEdited(asset.id);

    await expect(isEdited(asset.id)).resolves.toBe(true);
  });

  it('reads the adjustment for rendering and marks the asset edited again', async () => {
    const { asset, sut } = await setup();
    await addCrop(asset.id);
    await sut.upsert(asset.id, adjust);
    await defaultDatabase.deleteFrom('asset_edit').where('assetId', '=', asset.id).execute();

    await expect(sut.getForRender(asset.id)).resolves.toEqual(adjust);

    await expect(isEdited(asset.id)).resolves.toBe(true);
  });

  it('leaves an unadjusted asset alone when reading for rendering', async () => {
    const { asset, sut } = await setup();

    await expect(sut.getForRender(asset.id)).resolves.toBeUndefined();

    await expect(isEdited(asset.id)).resolves.toBe(false);
  });

  it('cascades with the asset', async () => {
    const { ctx, asset, sut } = await setup();
    await sut.upsert(asset.id, adjust);

    await ctx.database.deleteFrom('asset').where('id', '=', asset.id).execute();

    await expect(sut.get(asset.id)).resolves.toBeUndefined();
  });
});
