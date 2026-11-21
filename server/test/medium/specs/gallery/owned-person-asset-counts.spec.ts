// #1232: photo counts for the owner-only people list ("Show & hide people"), counted like the People page.
import { Kysely } from 'kysely';
import { beforeAll, describe, expect, it } from 'vitest';
import { AssetVisibility } from 'src/enum.js';
import { GalleryPersonRepository } from 'src/gallery/repositories/gallery-person.repository.js';
import { LoggingRepository } from 'src/repositories/logging.repository.js';
import { DB } from 'src/schema/index.js';
import { BaseService } from 'src/services/base.service.js';
import { newMediumService } from 'test/medium.factory.js';
import { getKyselyDB } from 'test/utils.js';

let db: Kysely<DB>;

beforeAll(async () => {
  db = await getKyselyDB();
});

const setup = () => {
  const { ctx } = newMediumService(BaseService, { database: db, real: [], mock: [LoggingRepository] });
  return { ctx, sut: ctx.get(GalleryPersonRepository) };
};

describe(GalleryPersonRepository.name, () => {
  describe('getOwnedPersonAssetCounts', () => {
    it('counts distinct live timeline assets with a visible face of each person', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();
      const { person: busy } = await ctx.newPerson({ ownerId: user.id, name: 'Busy' });
      const { person: quiet } = await ctx.newPerson({ ownerId: user.id, name: 'Quiet' });
      const { person: absent } = await ctx.newPerson({ ownerId: user.id, name: 'Absent' });

      const counted = async (dto: Parameters<typeof ctx.newAsset>[0] = {}) => {
        const { asset } = await ctx.newAsset({ ownerId: user.id, ...dto });
        return asset.id;
      };
      const face = (assetId: string, personGroupId: string, extra: { isVisible?: boolean; deletedAt?: Date } = {}) =>
        ctx.newAssetFace({ assetId, personGroupId, ...extra });

      // Busy: three timeline photos, one of them with two faces of Busy (counted once).
      const [one, two, three] = [await counted(), await counted(), await counted()];
      await face(one, busy.personGroupId);
      await face(one, busy.personGroupId);
      await face(two, busy.personGroupId);
      await face(three, busy.personGroupId);
      // Not counted: archived, trashed, offline, a hidden face, a deleted face.
      await face(await counted({ visibility: AssetVisibility.Archive }), busy.personGroupId);
      await face(await counted({ deletedAt: new Date() }), busy.personGroupId);
      await face(await counted({ isOffline: true }), busy.personGroupId);
      await face(await counted(), busy.personGroupId, { isVisible: false });
      await face(await counted(), busy.personGroupId, { deletedAt: new Date() });
      // Quiet: one photo.
      await face(await counted(), quiet.personGroupId);

      const counts = await sut.getOwnedPersonAssetCounts(user.id, [
        busy.personGroupId,
        quiet.personGroupId,
        absent.personGroupId,
      ]);

      expect(Object.fromEntries(counts)).toEqual({ [busy.personGroupId]: 3, [quiet.personGroupId]: 1 });
    });

    it("does not count another user's assets or people that were not asked for", async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();
      const { user: other } = await ctx.newUser();
      const { person } = await ctx.newPerson({ ownerId: user.id, name: 'Mine' });
      const { person: unasked } = await ctx.newPerson({ ownerId: user.id, name: 'Unasked' });
      const { asset } = await ctx.newAsset({ ownerId: user.id });
      const { asset: foreign } = await ctx.newAsset({ ownerId: other.id });
      await ctx.newAssetFace({ assetId: asset.id, personGroupId: person.personGroupId });
      await ctx.newAssetFace({ assetId: foreign.id, personGroupId: person.personGroupId });
      await ctx.newAssetFace({ assetId: asset.id, personGroupId: unasked.personGroupId });

      const counts = await sut.getOwnedPersonAssetCounts(user.id, [person.personGroupId]);

      expect(Object.fromEntries(counts)).toEqual({ [person.personGroupId]: 1 });
      await expect(sut.getOwnedPersonAssetCounts(user.id, [])).resolves.toEqual(new Map());
    });
  });
});
