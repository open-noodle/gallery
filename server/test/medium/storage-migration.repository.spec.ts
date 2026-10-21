import { Kysely } from 'kysely';
import { AssetFileType, AssetStatus } from 'src/enum.js';
import { LoggingRepository } from 'src/repositories/logging.repository.js';
import { StorageMigrationRepository } from 'src/repositories/storage-migration.repository.js';
import { DB } from 'src/schema/index.js';
import { BaseService } from 'src/services/base.service.js';
import { newMediumService } from 'test/medium.factory.js';
import { getKyselyDB } from 'test/utils.js';

let defaultDatabase: Kysely<DB>;

// newRealRepository in the medium factory does not build StorageMigrationRepository, so the spec constructs it on the
// same database the context writes to
const setup = () => {
  const { ctx } = newMediumService(BaseService, { database: defaultDatabase, real: [], mock: [LoggingRepository] });
  return { ctx, sut: new StorageMigrationRepository(defaultDatabase) };
};

beforeAll(async () => {
  defaultDatabase = await getKyselyDB();
});

describe('StorageMigrationRepository.hasBackendOriginals', () => {
  // the query looks at every asset in the database, so each case starts from an empty asset table
  beforeEach(async () => {
    await defaultDatabase.deleteFrom('asset_file').execute();
    await defaultDatabase.deleteFrom('asset').execute();
  });

  it('is false without assets', async () => {
    const { sut } = setup();

    await expect(sut.hasBackendOriginals()).resolves.toBe(false);
  });

  it('is false when every original is a disk path', async () => {
    const { ctx, sut } = setup();
    const { user } = await ctx.newUser();
    await ctx.newAsset({ ownerId: user.id, originalPath: `/data/upload/${user.id}/ab/cd/a.jpg` });
    await ctx.newAsset({ ownerId: user.id, originalPath: `/data/library/${user.id}/2026/b.jpg` });

    await expect(sut.hasBackendOriginals()).resolves.toBe(false);
  });

  it('is true when an original is a storage-backend key', async () => {
    const { ctx, sut } = setup();
    const { user } = await ctx.newUser();
    await ctx.newAsset({ ownerId: user.id, originalPath: `/data/upload/${user.id}/ab/cd/a.jpg` });
    await ctx.newAsset({ ownerId: user.id, originalPath: `upload/${user.id}/ab/cd/x.jpg` });

    await expect(sut.hasBackendOriginals()).resolves.toBe(true);
  });

  it('counts a trashed original stored as a key', async () => {
    const { ctx, sut } = setup();
    const { user } = await ctx.newUser();
    await ctx.newAsset({
      ownerId: user.id,
      originalPath: `upload/${user.id}/ab/cd/x.jpg`,
      deletedAt: new Date(),
      status: AssetStatus.Trashed,
    });

    await expect(sut.hasBackendOriginals()).resolves.toBe(true);
  });

  it('ignores keys held only by asset files', async () => {
    const { ctx, sut } = setup();
    const { user } = await ctx.newUser();
    const { asset } = await ctx.newAsset({ ownerId: user.id, originalPath: `/data/upload/${user.id}/ab/cd/x.jpg` });
    await ctx.newAssetFile({
      assetId: asset.id,
      type: AssetFileType.Sidecar,
      path: `upload/${user.id}/ab/cd/x.jpg.xmp`,
      isEdited: false,
    });

    await expect(sut.hasBackendOriginals()).resolves.toBe(false);
  });
});
