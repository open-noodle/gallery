import { Kysely, sql } from 'kysely';
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

// These assertions are about what updateUsage writes, so read both usage columns straight off the
// row rather than through UserRepository.get — no projection between the write and the check.
const getUsage = (userId: string) =>
  db
    .selectFrom('user')
    .select(['quotaUsageInBytes', 'physicalUsageInBytes'])
    .where('id', '=', userId)
    .executeTakeFirstOrThrow();

describe('physicalUsageInBytes column', () => {
  it('exists after migrations and defaults to zero', async () => {
    const result = await sql<{
      column_default: string | null;
      is_nullable: string;
    }>`SELECT column_default, is_nullable FROM information_schema.columns
       WHERE table_name = 'user' AND column_name = 'physicalUsageInBytes'`.execute(db);

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].is_nullable).toBe('NO');
    expect(result.rows[0].column_default).toBe('0');
  });
});

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

    const after = await getUsage(user.id);
    expect(after.quotaUsageInBytes).toBe(1000);
    // The quota sync must not touch the fork-owned physical column.
    expect(after.physicalUsageInBytes).toBe(0);

    const otherAfter = await getUsage(other.id);
    expect(otherAfter.quotaUsageInBytes).toBe(77);
  });
});

describe('UserRepository.updateUsage', () => {
  it('moves both the quota and the physical column', async () => {
    const { ctx, sut } = setup();
    const { user } = await ctx.newUser();

    await sut.updateUsage(user.id, 500);

    const after = await getUsage(user.id);
    expect(after.quotaUsageInBytes).toBe(500);
    expect(after.physicalUsageInBytes).toBe(500);
  });

  it('clamps the physical column at zero', async () => {
    const { ctx, sut } = setup();
    const { user } = await ctx.newUser();

    await sut.updateUsage(user.id, -500);

    const after = await getUsage(user.id);
    expect(after.physicalUsageInBytes).toBe(0);
    // Deliberate asymmetry: the quota column keeps upstream's exact unclamped arithmetic.
    expect(after.quotaUsageInBytes).toBe(-500);
  });
});
