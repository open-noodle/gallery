import { Kysely } from 'kysely';
import { LoggingRepository } from 'src/repositories/logging.repository';
import { UserRepository } from 'src/repositories/user.repository';
import { DB } from 'src/schema';
import { BaseService } from 'src/services/base.service';
import { newMediumService } from 'test/medium.factory';
import { getKyselyDB } from 'test/utils';

let db: Kysely<DB>;

beforeAll(async () => {
  db = await getKyselyDB();
});

const setup = () => {
  const { ctx } = newMediumService(BaseService, {
    database: db,
    real: [],
    mock: [LoggingRepository],
  });
  return { ctx, sut: ctx.get(UserRepository) };
};

// These assertions are about what the repository writes, so read the column straight off the row
// rather than through UserRepository.get — no projection between the write and the check.
const getUsage = (userId: string) =>
  db.selectFrom('user').select(['quotaUsageInBytes']).where('id', '=', userId).executeTakeFirstOrThrow();

describe('UserRepository.syncUsage', () => {
  it('sums originals and ignores external library assets', async () => {
    const { ctx, sut } = setup();
    const { user } = await ctx.newUser();
    const { library } = await ctx.newLibrary({ ownerId: user.id });

    const { asset: owned } = await ctx.newAsset({ ownerId: user.id });
    await ctx.newExif({ assetId: owned.id, fileSizeInByte: 1000 });
    const { asset: external } = await ctx.newAsset({ ownerId: user.id, libraryId: library.id });
    await ctx.newExif({ assetId: external.id, fileSizeInByte: 9_000_000 });

    // A second owner: the subquery correlates on asset.ownerId = user.id, and with only one user in
    // the table a broken correlation would still produce 1000.
    const { user: other } = await ctx.newUser();
    const { asset: otherOwned } = await ctx.newAsset({ ownerId: other.id });
    await ctx.newExif({ assetId: otherOwned.id, fileSizeInByte: 77 });

    await sut.syncUsage(user.id);
    await sut.syncUsage(other.id);

    await expect(getUsage(user.id)).resolves.toEqual({ quotaUsageInBytes: 1000 });
    await expect(getUsage(other.id)).resolves.toEqual({ quotaUsageInBytes: 77 });
  });
});

describe('UserRepository.updateUsage', () => {
  it('applies the delta to the quota column', async () => {
    const { ctx, sut } = setup();
    const { user } = await ctx.newUser();

    await sut.updateUsage(user.id, 500);

    await expect(getUsage(user.id)).resolves.toEqual({ quotaUsageInBytes: 500 });
  });

  it('keeps upstream unclamped arithmetic for a negative delta', async () => {
    const { ctx, sut } = setup();
    const { user } = await ctx.newUser();

    await sut.updateUsage(user.id, -500);

    await expect(getUsage(user.id)).resolves.toEqual({ quotaUsageInBytes: -500 });
  });
});

describe('UserRepository.setUsage', () => {
  it('overwrites the same column syncUsage fills', async () => {
    const { ctx, sut } = setup();
    const { user } = await ctx.newUser();
    const { asset } = await ctx.newAsset({ ownerId: user.id });
    await ctx.newExif({ assetId: asset.id, fileSizeInByte: 1000 });

    await sut.syncUsage(user.id);
    // The derivative-inclusive walk writes here, so display and quota enforcement read whichever
    // figure the admin's toggle selected without knowing which one produced it.
    await sut.setUsage(user.id, 4321);

    await expect(getUsage(user.id)).resolves.toEqual({ quotaUsageInBytes: 4321 });
  });
});
