/**
 * Medium tests for `FacePersonVerdictRepository.isFaceAssignableInSpace` — the data half
 * of the #734-follow-up authority rule (spec §3, §9.1).
 *
 * Rule: a face is assignable in space S if its asset is reachable through S by any of the
 * three paths, the face is live and visible, and the face does not belong to a person its
 * OWNER marked hidden.
 *
 * Deliberately NOT the #992 rule: there is no owner-is-member clause here (F-6). An editor
 * may name Carol's face even though Carol never joined the space, because nothing of
 * Carol's is written — only the space's own taxonomy.
 *
 * Discipline: every deny row below is mutation-proved non-vacuous. Each uses a fixture that
 * a GRANT row in the same block also uses, so a deny can only be explained by the specific
 * property under test.
 */
import { Kysely } from 'kysely';
import { AuthDto } from 'src/dtos/auth.dto';
import { AssetVisibility } from 'src/enum';
import { DatabaseRepository } from 'src/repositories/database.repository';
import { FaceIdentityRepository } from 'src/repositories/face-identity.repository';
import { FacePersonVerdictRepository } from 'src/repositories/face-person-verdict.repository';
import { LoggingRepository } from 'src/repositories/logging.repository';
import { SharedSpaceRepository } from 'src/repositories/shared-space.repository';
import { DB } from 'src/schema';
import { BaseService } from 'src/services/base.service';
import { SharedSpaceService } from 'src/services/shared-space.service';
import { newMediumService } from 'test/medium.factory';
import { getKyselyDB } from 'test/utils';
import { beforeAll, describe, expect, it } from 'vitest';

let defaultDatabase: Kysely<DB>;

const setup = () => {
  const { ctx } = newMediumService(BaseService, {
    database: defaultDatabase,
    real: [FacePersonVerdictRepository, SharedSpaceRepository],
    mock: [LoggingRepository],
  });
  return { ctx, verdictRepo: ctx.get(FacePersonVerdictRepository) };
};

beforeAll(async () => {
  defaultDatabase = await getKyselyDB();
});

/** Anna (Editor) + Bob (space Owner, asset owner) in one space. */
const newSpaceWithEditorAndMember = async (ctx: ReturnType<typeof setup>['ctx']) => {
  const { user: anna } = await ctx.newUser();
  const { user: bob } = await ctx.newUser();
  const { space } = await ctx.newSharedSpace({ createdById: bob.id });
  await ctx.newSharedSpaceMember({ spaceId: space.id, userId: bob.id, role: 'owner' });
  await ctx.newSharedSpaceMember({ spaceId: space.id, userId: anna.id, role: 'editor' });
  return { anna, bob, space };
};

type ReachPath = 'direct' | 'library' | 'album';

const reachPathBuilders: Record<
  ReachPath,
  (ctx: ReturnType<typeof setup>['ctx'], args: { spaceId: string; ownerId: string }) => Promise<{ assetId: string }>
> = {
  direct: async (ctx, { spaceId, ownerId }) => {
    const { asset } = await ctx.newAsset({ ownerId, visibility: AssetVisibility.Timeline });
    await ctx.newSharedSpaceAsset({ spaceId, assetId: asset.id });
    return { assetId: asset.id };
  },
  library: async (ctx, { spaceId, ownerId }) => {
    const { library } = await ctx.newLibrary({ ownerId });
    const { asset } = await ctx.newAsset({ ownerId, libraryId: library.id, visibility: AssetVisibility.Timeline });
    await ctx.newSharedSpaceLibrary({ spaceId, libraryId: library.id });
    return { assetId: asset.id };
  },
  album: async (ctx, { spaceId, ownerId }) => {
    const { result: album } = await ctx.newAlbum({ ownerId, albumName: 'Face assign album' });
    const { asset } = await ctx.newAsset({ ownerId, visibility: AssetVisibility.Timeline });
    await ctx.newAlbumAsset({ albumId: album.id, assetId: asset.id });
    await ctx.newSharedSpaceAlbum({ spaceId, albumId: album.id });
    return { assetId: asset.id };
  },
};

describe('isFaceAssignableInSpace', () => {
  // F-1, F-2, F-3: all three reach paths grant.
  describe.each<ReachPath>(['direct', 'library', 'album'])('reach path: %s', (path) => {
    it('grants for a face on a member-owned asset reachable by this path', async () => {
      const { ctx, verdictRepo } = setup();
      const { bob, space } = await newSpaceWithEditorAndMember(ctx);
      const { assetId } = await reachPathBuilders[path](ctx, { spaceId: space.id, ownerId: bob.id });
      const { result: faceId } = await ctx.newAssetFace({ assetId });

      await expect(verdictRepo.isFaceAssignableInSpace(space.id, faceId)).resolves.toBe(true);
    });
  });

  // F-6: the asset owner need NOT be a space member. This is the deliberate divergence
  // from #992's checkSpaceEditAccess, whose album arm requires owner-is-member.
  it('grants when the asset owner is NOT a space member (F-6)', async () => {
    const { ctx, verdictRepo } = setup();
    const { space } = await newSpaceWithEditorAndMember(ctx);
    const { user: carol } = await ctx.newUser();
    const { assetId } = await reachPathBuilders.album(ctx, { spaceId: space.id, ownerId: carol.id });
    const { result: faceId } = await ctx.newAssetFace({ assetId });

    await expect(verdictRepo.isFaceAssignableInSpace(space.id, faceId)).resolves.toBe(true);
  });

  // F-7: reachability binds to the space asked about.
  it('denies when the asset is reachable only through a DIFFERENT space (F-7)', async () => {
    const { ctx, verdictRepo } = setup();
    const { bob, space } = await newSpaceWithEditorAndMember(ctx);
    const { space: otherSpace } = await ctx.newSharedSpace({ createdById: bob.id });
    const { assetId } = await reachPathBuilders.direct(ctx, { spaceId: otherSpace.id, ownerId: bob.id });
    const { result: faceId } = await ctx.newAssetFace({ assetId });

    // Non-vacuous: the same fixture grants when asked about otherSpace.
    await expect(verdictRepo.isFaceAssignableInSpace(otherSpace.id, faceId)).resolves.toBe(true);
    await expect(verdictRepo.isFaceAssignableInSpace(space.id, faceId)).resolves.toBe(false);
  });

  // F-9: the hidden-person exclusion at the WRITE. Its read-side twin is F-8 in Slice 3.
  it('denies a face belonging to a person the OWNER marked hidden (F-9)', async () => {
    const { ctx, verdictRepo } = setup();
    const { bob, space } = await newSpaceWithEditorAndMember(ctx);
    const { assetId } = await reachPathBuilders.direct(ctx, { spaceId: space.id, ownerId: bob.id });
    const { result: person } = await ctx.newPerson({ ownerId: bob.id, isHidden: true });
    const { result: faceId } = await ctx.newAssetFace({ assetId, personId: person.id });

    await expect(verdictRepo.isFaceAssignableInSpace(space.id, faceId)).resolves.toBe(false);

    // Non-vacuous: un-hide the same person and the same face becomes assignable.
    await defaultDatabase.updateTable('person').set({ isHidden: false }).where('id', '=', person.id).execute();
    await expect(verdictRepo.isFaceAssignableInSpace(space.id, faceId)).resolves.toBe(true);
  });

  // F-10: asset-level gates, each mutation-proved.
  it.each([
    [
      'trashed',
      (db: Kysely<DB>, assetId: string) =>
        db.updateTable('asset').set({ deletedAt: new Date() }).where('id', '=', assetId).execute(),
    ],
    [
      'offline',
      (db: Kysely<DB>, assetId: string) =>
        db.updateTable('asset').set({ isOffline: true }).where('id', '=', assetId).execute(),
    ],
    [
      'hidden',
      (db: Kysely<DB>, assetId: string) =>
        db.updateTable('asset').set({ visibility: AssetVisibility.Hidden }).where('id', '=', assetId).execute(),
    ],
    [
      'locked',
      (db: Kysely<DB>, assetId: string) =>
        db.updateTable('asset').set({ visibility: AssetVisibility.Locked }).where('id', '=', assetId).execute(),
    ],
  ])('denies when the asset is %s (F-10)', async (_label, mutate) => {
    const { ctx, verdictRepo } = setup();
    const { bob, space } = await newSpaceWithEditorAndMember(ctx);
    const { assetId } = await reachPathBuilders.direct(ctx, { spaceId: space.id, ownerId: bob.id });
    const { result: faceId } = await ctx.newAssetFace({ assetId });

    // Non-vacuous: granted before the mutation.
    await expect(verdictRepo.isFaceAssignableInSpace(space.id, faceId)).resolves.toBe(true);
    await mutate(defaultDatabase, assetId);
    await expect(verdictRepo.isFaceAssignableInSpace(space.id, faceId)).resolves.toBe(false);
  });

  // F-11: face-level gates.
  it.each([
    ['soft-deleted', { deletedAt: new Date(), isVisible: true }],
    ['not visible', { deletedAt: null, isVisible: false }],
  ])('denies when the face is %s (F-11)', async (_label, patch) => {
    const { ctx, verdictRepo } = setup();
    const { bob, space } = await newSpaceWithEditorAndMember(ctx);
    const { assetId } = await reachPathBuilders.direct(ctx, { spaceId: space.id, ownerId: bob.id });
    const { result: faceId } = await ctx.newAssetFace({ assetId });

    await expect(verdictRepo.isFaceAssignableInSpace(space.id, faceId)).resolves.toBe(true);
    await defaultDatabase.updateTable('asset_face').set(patch).where('id', '=', faceId).execute();
    await expect(verdictRepo.isFaceAssignableInSpace(space.id, faceId)).resolves.toBe(false);
  });
});

describe('attach idempotence (F-14)', () => {
  it('a second identical attach is a no-op, with no duplicate projection row', async () => {
    const { sut, ctx } = newMediumService(SharedSpaceService, {
      database: defaultDatabase,
      real: [FacePersonVerdictRepository, SharedSpaceRepository, FaceIdentityRepository, DatabaseRepository],
      mock: [LoggingRepository],
    });
    const { anna, bob, space } = await newSpaceWithEditorAndMember(ctx);
    const { assetId } = await reachPathBuilders.direct(ctx, { spaceId: space.id, ownerId: bob.id });
    const { result: faceId } = await ctx.newAssetFace({ assetId });
    const person = await ctx.get(SharedSpaceRepository).createPerson({ spaceId: space.id, name: 'Aurelia' });

    const auth = { user: { id: anna.id } } as AuthDto;
    await sut.attachFaceToSpacePerson(auth, space.id, person.id, faceId);
    await sut.attachFaceToSpacePerson(auth, space.id, person.id, faceId);

    const rows = await defaultDatabase
      .selectFrom('shared_space_person_face')
      .selectAll()
      .where('assetFaceId', '=', faceId)
      .execute();
    expect(rows).toHaveLength(1);
  });
});
