import { Kysely } from 'kysely';
import { AssetVisibility } from 'src/enum';
import { LoggingRepository } from 'src/repositories/logging.repository';
import { StackRepository } from 'src/repositories/stack.repository';
import { DB } from 'src/schema';
import { BaseService } from 'src/services/base.service';
import { newMediumService } from 'test/medium.factory';
import { getKyselyDB } from 'test/utils';
import { beforeAll, describe, expect, it } from 'vitest';

let defaultDatabase: Kysely<DB>;

const setup = (db?: Kysely<DB>) => {
  const { ctx } = newMediumService(BaseService, {
    database: db || defaultDatabase,
    real: [],
    mock: [LoggingRepository],
  });
  return { ctx, sut: ctx.get(StackRepository) };
};

const sorted = (ids: string[]) => [...ids].sort();

beforeAll(async () => {
  defaultDatabase = await getKyselyDB();
});

describe(StackRepository.name, () => {
  describe('getStackedAssetIds', () => {
    it('returns an empty array for empty input', async () => {
      const { sut } = setup();
      await expect(sut.getStackedAssetIds([])).resolves.toEqual([]);
    });

    it('returns a non-stacked asset unchanged', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();
      const { asset } = await ctx.newAsset({ ownerId: user.id });

      await expect(sut.getStackedAssetIds([asset.id])).resolves.toEqual([asset.id]);
    });

    it('expands the stack primary to include all its children', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();
      const { asset: primary } = await ctx.newAsset({ ownerId: user.id });
      const { asset: child } = await ctx.newAsset({ ownerId: user.id });
      await ctx.newStack({ ownerId: user.id }, [primary.id, child.id]);

      const result = await sut.getStackedAssetIds([primary.id]);
      expect(sorted(result)).toEqual(sorted([primary.id, child.id]));
    });

    it('expands a stack child to include the primary and every sibling', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();
      const { asset: primary } = await ctx.newAsset({ ownerId: user.id });
      const { asset: childA } = await ctx.newAsset({ ownerId: user.id });
      const { asset: childB } = await ctx.newAsset({ ownerId: user.id });
      await ctx.newStack({ ownerId: user.id }, [primary.id, childA.id, childB.id]);

      // Seeding from a NON-primary member must still return the whole stack —
      // this is the exact case that broke #751 (child in a space, primary not).
      const result = await sut.getStackedAssetIds([childA.id]);
      expect(sorted(result)).toEqual(sorted([primary.id, childA.id, childB.id]));
    });

    it('deduplicates when multiple members of the same stack are passed', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();
      const { asset: primary } = await ctx.newAsset({ ownerId: user.id });
      const { asset: child } = await ctx.newAsset({ ownerId: user.id });
      await ctx.newStack({ ownerId: user.id }, [primary.id, child.id]);

      const result = await sut.getStackedAssetIds([primary.id, child.id]);
      expect(sorted(result)).toEqual(sorted([primary.id, child.id]));
      expect(result).toHaveLength(2);
    });

    it('expands every distinct stack referenced by the input', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();
      const { asset: primaryA } = await ctx.newAsset({ ownerId: user.id });
      const { asset: childA } = await ctx.newAsset({ ownerId: user.id });
      const { asset: primaryB } = await ctx.newAsset({ ownerId: user.id });
      const { asset: childB } = await ctx.newAsset({ ownerId: user.id });
      await ctx.newStack({ ownerId: user.id }, [primaryA.id, childA.id]);
      await ctx.newStack({ ownerId: user.id }, [primaryB.id, childB.id]);

      const result = await sut.getStackedAssetIds([childA.id, primaryB.id]);
      expect(sorted(result)).toEqual(sorted([primaryA.id, childA.id, primaryB.id, childB.id]));
    });

    it('unions stacked and non-stacked inputs', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();
      const { asset: primary } = await ctx.newAsset({ ownerId: user.id });
      const { asset: child } = await ctx.newAsset({ ownerId: user.id });
      const { asset: loner } = await ctx.newAsset({ ownerId: user.id });
      await ctx.newStack({ ownerId: user.id }, [primary.id, child.id]);

      const result = await sut.getStackedAssetIds([primary.id, loner.id]);
      expect(sorted(result)).toEqual(sorted([primary.id, child.id, loner.id]));
    });

    it('excludes soft-deleted siblings from the expansion', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();
      const { asset: primary } = await ctx.newAsset({ ownerId: user.id });
      const { asset: liveChild } = await ctx.newAsset({ ownerId: user.id });
      const { asset: deletedChild } = await ctx.newAsset({ ownerId: user.id, deletedAt: new Date() });
      await ctx.newStack({ ownerId: user.id }, [primary.id, liveChild.id, deletedChild.id]);

      const result = await sut.getStackedAssetIds([primary.id]);
      expect(sorted(result)).toEqual(sorted([primary.id, liveChild.id]));
    });

    it('excludes a soft-deleted input asset', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();
      const { asset: deleted } = await ctx.newAsset({ ownerId: user.id, deletedAt: new Date() });

      await expect(sut.getStackedAssetIds([deleted.id])).resolves.toEqual([]);
    });

    it('ignores ids that do not exist', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();
      const { asset } = await ctx.newAsset({ ownerId: user.id });

      const result = await sut.getStackedAssetIds([asset.id, '00000000-0000-0000-0000-000000000000']);
      expect(result).toEqual([asset.id]);
    });

    it('excludes Hidden and Locked siblings when a visibility whitelist is given', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();
      const { asset: primary } = await ctx.newAsset({ ownerId: user.id, visibility: AssetVisibility.Timeline });
      const { asset: archived } = await ctx.newAsset({ ownerId: user.id, visibility: AssetVisibility.Archive });
      const { asset: hidden } = await ctx.newAsset({ ownerId: user.id, visibility: AssetVisibility.Hidden });
      const { asset: locked } = await ctx.newAsset({ ownerId: user.id, visibility: AssetVisibility.Locked });
      await ctx.newStack({ ownerId: user.id }, [primary.id, archived.id, hidden.id, locked.id]);

      const result = await sut.getStackedAssetIds([primary.id], [AssetVisibility.Archive, AssetVisibility.Timeline]);
      // Hidden/Locked (RBAC-sensitive tiers) must never be auto-contributed to a space.
      expect(sorted(result)).toEqual(sorted([primary.id, archived.id]));
    });

    it('returns siblings of any visibility when no whitelist is given', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();
      const { asset: primary } = await ctx.newAsset({ ownerId: user.id, visibility: AssetVisibility.Timeline });
      const { asset: hidden } = await ctx.newAsset({ ownerId: user.id, visibility: AssetVisibility.Hidden });
      await ctx.newStack({ ownerId: user.id }, [primary.id, hidden.id]);

      // The remove path passes no whitelist — it must reach every live member so
      // nothing is left orphaned in the space.
      const result = await sut.getStackedAssetIds([primary.id]);
      expect(sorted(result)).toEqual(sorted([primary.id, hidden.id]));
    });
  });
});
