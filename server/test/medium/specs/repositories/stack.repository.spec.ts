import { Kysely } from 'kysely';
import { beforeAll, describe, expect, it } from 'vitest';
import { LoggingRepository } from 'src/repositories/logging.repository.js';
import { StackRepository } from 'src/repositories/stack.repository.js';
import { DB } from 'src/schema/index.js';
import { BaseService } from 'src/services/base.service.js';
import { newMediumService } from 'test/medium.factory.js';
import { getKyselyDB } from 'test/utils.js';

let defaultDatabase: Kysely<DB>;

const setup = (db?: Kysely<DB>) => {
  const { ctx } = newMediumService(BaseService, {
    database: db || defaultDatabase,
    real: [],
    mock: [LoggingRepository],
  });
  return { ctx, sut: ctx.get(StackRepository) };
};

beforeAll(async () => {
  defaultDatabase = await getKyselyDB();
});

describe(StackRepository.name, () => {
  // #763 slice 1b Task 2 — stack.dto.ts's mapStack feeds each stack asset through mapAsset, which
  // now reads `isFavoriteForUser` exclusively (slice 1b Task 1). getById (and search/create/update,
  // sharing the withAssets helper) must project the overlay keyed to the CALLER.
  describe('getById (#763)', () => {
    it('projects isFavoriteForUser onto stack.assets for the requesting user, independent of the owner', async () => {
      const { ctx, sut } = setup();
      const { user: owner } = await ctx.newUser();
      const { user: viewer } = await ctx.newUser();
      const { asset: primary } = await ctx.newAsset({ ownerId: owner.id });
      const { asset: child } = await ctx.newAsset({ ownerId: owner.id });
      // withAssets inner-joins asset_exif (via innerJoinLateral) — every asset needs a row there
      // to be included at all.
      await ctx.newExif({ assetId: primary.id, make: 'Test' });
      await ctx.newExif({ assetId: child.id, make: 'Test' });
      const { stack } = await ctx.newStack({ ownerId: owner.id }, [primary.id, child.id]);

      await ctx.database.insertInto('asset_favorite').values({ userId: viewer.id, assetId: child.id }).execute();

      const asOwner = await sut.getById(stack.id, owner.id);
      expect(asOwner?.assets.find((a) => a.id === child.id)?.isFavoriteForUser).toBe(false);

      const asViewer = await sut.getById(stack.id, viewer.id);
      expect(asViewer?.assets.find((a) => a.id === child.id)?.isFavoriteForUser).toBe(true);

      const withoutAuthUserId = await sut.getById(stack.id);
      expect(withoutAuthUserId?.assets.find((a) => a.id === child.id)?.isFavoriteForUser).toBeUndefined();
    });
  });
});
