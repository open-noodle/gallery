import { NotFoundException } from '@nestjs/common';
import { Kysely } from 'kysely';
import { FaceRepairRepository } from 'src/repositories/face-repair.repository';
import { LoggingRepository } from 'src/repositories/logging.repository';
import { DB } from 'src/schema';
import { FaceRepairService } from 'src/services/face-repair.service';
import { newMediumService } from 'test/medium.factory';
import { getKyselyDB } from 'test/utils';

// Slice 3 (manual face review, docs/superpowers/plans/2026-07-23-manual-face-review-slice-3.md, spec §5.5/§7):
// GET admin/face-repair/person/:personId. The manual review page has no scan to read personName/ownerId off,
// so it needs this dedicated, admin-gated lookup. faceCount/thumbnailFaceId must agree with
// searchOwnerPeople's browser-grid counts, so getPersonMetadata reuses that method's exact join conditions.
let db: Kysely<DB>;

const setup = () => {
  return newMediumService(FaceRepairService, {
    database: db,
    real: [FaceRepairRepository],
    mock: [LoggingRepository],
  });
};

beforeAll(async () => {
  db = await getKyselyDB();
});

describe('FaceRepairService.getPersonMetadata', () => {
  it('returns the row for an existing person', async () => {
    const { sut, ctx } = setup();
    const { user } = await ctx.newUser();
    const { person } = await ctx.newPerson({ ownerId: user.id, name: 'Alice' });
    const { asset } = await ctx.newAsset({ ownerId: user.id });
    const { assetFace } = await ctx.newAssetFace({ assetId: asset.id, personGroupId: person.personGroupId });
    await ctx.database
      .updateTable('person')
      .set({ faceAssetId: assetFace.id })
      .where('personGroupId', '=', person.personGroupId)
      .execute();

    const result = await sut.getPersonMetadata(person.personGroupId);

    expect(result).toEqual({
      id: person.personGroupId,
      name: 'Alice',
      ownerId: user.id,
      faceCount: 1,
      thumbnailFaceId: assetFace.id,
    });
  });

  it('404s for an unknown person id', async () => {
    const { sut } = setup();
    await expect(sut.getPersonMetadata('00000000-0000-4000-a000-000000000099')).rejects.toThrow(NotFoundException);
  });

  it('succeeds for a person owned by a DIFFERENT user than the caller (admin-gated at the controller, not here)', async () => {
    const { sut, ctx } = setup();
    const { user: owner } = await ctx.newUser();
    // A second, unrelated user exists purely to prove the metadata read is not scoped to it.
    await ctx.newUser();
    const { person } = await ctx.newPerson({ ownerId: owner.id, name: 'Bob' });

    const result = await sut.getPersonMetadata(person.personGroupId);

    expect(result.id).toBe(person.personGroupId);
    expect(result.ownerId).toBe(owner.id);
  });

  it("returns an unnamed person's raw empty name unchanged, with no server-side display-string coercion", async () => {
    const { sut, ctx } = setup();
    const { user } = await ctx.newUser();
    const { person } = await ctx.newPerson({ ownerId: user.id, name: '' });

    const result = await sut.getPersonMetadata(person.personGroupId);

    expect(result.name).toBe('');
  });

  it('returns faceCount 0 and thumbnailFaceId null for a person with zero faces', async () => {
    const { sut, ctx } = setup();
    const { user } = await ctx.newUser();
    const { person } = await ctx.newPerson({ ownerId: user.id, name: 'Nobody', faceAssetId: null });

    const result = await sut.getPersonMetadata(person.personGroupId);

    expect(result.faceCount).toBe(0);
    expect(result.thumbnailFaceId).toBeNull();
  });

  it('excludes soft-deleted and non-visible faces from faceCount, mirroring searchOwnerPeople', async () => {
    const { sut, ctx } = setup();
    const { user } = await ctx.newUser();
    const { person } = await ctx.newPerson({ ownerId: user.id, name: 'Carla' });

    const { asset: visibleAsset } = await ctx.newAsset({ ownerId: user.id });
    await ctx.newAssetFace({
      assetId: visibleAsset.id,
      personGroupId: person.personGroupId,
      isVisible: true,
      deletedAt: null,
    });

    const { asset: deletedAsset } = await ctx.newAsset({ ownerId: user.id });
    await ctx.newAssetFace({
      assetId: deletedAsset.id,
      personGroupId: person.personGroupId,
      isVisible: true,
      deletedAt: new Date(),
    });

    const { asset: hiddenAsset } = await ctx.newAsset({ ownerId: user.id });
    await ctx.newAssetFace({
      assetId: hiddenAsset.id,
      personGroupId: person.personGroupId,
      isVisible: false,
      deletedAt: null,
    });

    const result = await sut.getPersonMetadata(person.personGroupId);

    expect(result.faceCount).toBe(1);
  });
});
