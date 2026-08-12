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

// physicalUsageInBytes is not part of the userAdmin projection yet, so read both usage columns
// straight off the row rather than through UserRepository.get.
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

    await sut.syncUsage(user.id);

    const after = await getUsage(user.id);
    expect(after.quotaUsageInBytes).toBe(1000);
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
  });
});
