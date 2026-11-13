import { Kysely } from 'kysely';
import { AssetStatus } from 'src/enum.js';
import { AssetJobRepository } from 'src/repositories/asset-job.repository.js';
import { AssetRepository } from 'src/repositories/asset.repository.js';
import { LoggingRepository } from 'src/repositories/logging.repository.js';
import { DB } from 'src/schema/index.js';
import { BaseService } from 'src/services/base.service.js';
import { newMediumService } from 'test/medium.factory.js';
import { getKyselyDB } from 'test/utils.js';

let database: Kysely<DB>;
beforeAll(async () => {
  database = await getKyselyDB();
});

const setup = async () => {
  const { ctx } = newMediumService(BaseService, { database, real: [], mock: [LoggingRepository] });
  const { user } = await ctx.newUser();
  const { library } = await ctx.newLibrary({ ownerId: user.id });
  return { ctx, user, library };
};

describe('external-library offline deletion safety', () => {
  it('expires only explicitly trashed/deleted assets, including offline ones, at the inclusive cutoff', async () => {
    const { ctx, user, library } = await setup();
    const cutoff = new Date('2026-01-01T00:00:00Z');
    const recent = new Date('2026-01-02T00:00:00Z');
    const seeded: string[] = [];
    const eligible: string[] = [];
    for (const status of [AssetStatus.Active, AssetStatus.Trashed, AssetStatus.Deleted]) {
      for (const isOffline of [false, true]) {
        for (const deletedAt of [null, cutoff, recent]) {
          const { asset } = await ctx.newAsset({
            ownerId: user.id,
            libraryId: library.id,
            isExternal: true,
            status,
            isOffline,
            deletedAt,
          });
          seeded.push(asset.id);
          if (status !== AssetStatus.Active && deletedAt === cutoff) eligible.push(asset.id);
        }
      }
    }
    const found: string[] = [];
    for await (const { id } of ctx.get(AssetJobRepository).streamForDeletedJob(cutoff)) {
      if (seeded.includes(id)) found.push(id);
    }
    expect(found.toSorted()).toEqual(eligible.toSorted());
  });

  it('marks excluded paths offline without trashing them or replacing existing deletion metadata', async () => {
    const { ctx, user, library } = await setup();
    const assets = ctx.get(AssetRepository);
    const legacyDate = new Date('2020-01-01T00:00:00Z');
    for (const status of [AssetStatus.Active, AssetStatus.Trashed, AssetStatus.Deleted]) {
      const { asset } = await ctx.newAsset({
        ownerId: user.id,
        libraryId: library.id,
        isExternal: true,
        originalPath: `/excluded/${status}.jpg`,
        status,
        deletedAt: status === AssetStatus.Active ? null : legacyDate,
      });
      expect(await assets.detectOfflineExternalAssets(library.id, () => false)).toBe(1);
      await expect(assets.getById(asset.id)).resolves.toMatchObject({
        isOffline: true,
        status,
        deletedAt: status === AssetStatus.Active ? null : legacyDate,
      });
    }
    const { asset: kept } = await ctx.newAsset({
      ownerId: user.id,
      libraryId: library.id,
      isExternal: true,
      originalPath: '/kept/a.jpg',
    });
    expect(await assets.detectOfflineExternalAssets(library.id, () => true)).toBe(0);
    await expect(assets.getById(kept.id)).resolves.toMatchObject({ isOffline: false, deletedAt: null });
  });
});
