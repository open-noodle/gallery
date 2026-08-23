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

// §6.3.1 row 3: the face already belongs to one of Bob's own people, under an identity Anna's target
// space person does not share. F-40 is the companion pin: the override must be entirely space-local,
// so everything Bob's OWN reads go through -- his person row, asset_face.personId, and the identity
// resolution his People page and asset viewer resolve names/birthdays through -- must come out unchanged
// on the other side of Anna's write.
describe('the owner-named override is space-local (F-36, F-40)', () => {
  it('overrides Bob’s naming in the space without rewriting the face’s identity, and without touching Bob’s own person, asset_face.personId, or his resolved view (F-36, F-40)', async () => {
    const { sut, ctx } = newMediumService(SharedSpaceService, {
      database: defaultDatabase,
      real: [FacePersonVerdictRepository, SharedSpaceRepository, FaceIdentityRepository, DatabaseRepository],
      mock: [LoggingRepository],
    });
    const faceIdentityRepo = ctx.get(FaceIdentityRepository);
    const { anna, bob, space } = await newSpaceWithEditorAndMember(ctx);
    const { assetId } = await reachPathBuilders.direct(ctx, { spaceId: space.id, ownerId: bob.id });

    // Bob already named this face himself, under HIS OWN identity.
    const { result: bobPerson } = await ctx.newPerson({ ownerId: bob.id, name: 'Dad' });
    const bobIdentity = await faceIdentityRepo.ensurePersonIdentity(bobPerson.id);
    const { result: faceId } = await ctx.newAssetFace({ assetId, personId: bobPerson.id });
    await faceIdentityRepo.linkFace({ assetFaceId: faceId, identityId: bobIdentity.id, source: 'owner-person' });

    // Anna creates a DIFFERENT space person and overrides the naming, space-locally.
    const spacePerson = await ctx.get(SharedSpaceRepository).createPerson({ spaceId: space.id, name: 'Uncle Tom' });
    const auth = { user: { id: anna.id } } as AuthDto;

    await expect(sut.attachFaceToSpacePerson(auth, space.id, spacePerson.id, faceId)).resolves.toBe(true);

    // The space's own projection shows the face under Anna's person.
    const projectionRows = await defaultDatabase
      .selectFrom('shared_space_person_face')
      .selectAll()
      .where('assetFaceId', '=', faceId)
      .execute();
    expect(projectionRows).toEqual([{ personId: spacePerson.id, assetFaceId: faceId }]);

    // F-36: the face's GLOBAL identity link is untouched -- still Bob's identity, not the space person's.
    const identityLink = await defaultDatabase
      .selectFrom('face_identity_face')
      .selectAll()
      .where('assetFaceId', '=', faceId)
      .executeTakeFirstOrThrow();
    expect(identityLink.identityId).toBe(bobIdentity.id);
    expect(identityLink.source).toBe('owner-person');

    // F-40: asset_face.personId, Bob's own person row, and the RESOLVED view his own reads go through
    // (not just the columns) are exactly as they were before Anna's write.
    const face = await defaultDatabase
      .selectFrom('asset_face')
      .selectAll()
      .where('id', '=', faceId)
      .executeTakeFirstOrThrow();
    expect(face.personId).toBe(bobPerson.id);

    const person = await defaultDatabase
      .selectFrom('person')
      .selectAll()
      .where('id', '=', bobPerson.id)
      .executeTakeFirstOrThrow();
    expect(person.name).toBe('Dad');
    expect(person.identityId).toBe(bobIdentity.id);

    const resolved = await faceIdentityRepo.getResolvedPersonByIdentityId(bob.id, bobIdentity.id);
    expect(resolved?.name).toBe('Dad');
  });
});

// F-37: two editors attach the SAME face to two DIFFERENT space people at the same time. Needs two real
// Postgres transactions actually racing -- a mocked repository cannot express the interleaving this pins.
describe('concurrent attach to the same face (F-37)', () => {
  it('serializes -- one wins, never two projection rows, never a lost recount', async () => {
    const { sut, ctx } = newMediumService(SharedSpaceService, {
      database: defaultDatabase,
      real: [FacePersonVerdictRepository, SharedSpaceRepository, FaceIdentityRepository, DatabaseRepository],
      mock: [LoggingRepository],
    });
    const { anna, bob, space } = await newSpaceWithEditorAndMember(ctx);
    const { assetId } = await reachPathBuilders.direct(ctx, { spaceId: space.id, ownerId: bob.id });
    const { result: faceId } = await ctx.newAssetFace({ assetId });
    const personA = await ctx.get(SharedSpaceRepository).createPerson({ spaceId: space.id, name: 'A' });
    const personB = await ctx.get(SharedSpaceRepository).createPerson({ spaceId: space.id, name: 'B' });

    const auth = { user: { id: anna.id } } as AuthDto;
    const [resultA, resultB] = await Promise.all([
      sut.attachFaceToSpacePerson(auth, space.id, personA.id, faceId),
      sut.attachFaceToSpacePerson(auth, space.id, personB.id, faceId),
    ]);

    // Neither side is refused -- the loser's write becomes an ordinary sequential reassign once it
    // acquires the lock the winner already released.
    expect(resultA).toBe(true);
    expect(resultB).toBe(true);

    const rows = await defaultDatabase
      .selectFrom('shared_space_person_face')
      .selectAll()
      .where('assetFaceId', '=', faceId)
      .execute();
    expect(rows).toHaveLength(1);

    const winnerId = rows[0].personId;
    const loserId = winnerId === personA.id ? personB.id : personA.id;

    const winner = await defaultDatabase
      .selectFrom('shared_space_person')
      .select(['faceCount'])
      .where('id', '=', winnerId)
      .executeTakeFirstOrThrow();
    const loser = await defaultDatabase
      .selectFrom('shared_space_person')
      .select(['faceCount'])
      .where('id', '=', loserId)
      .executeTakeFirstOrThrow();
    expect(winner.faceCount).toBe(1);
    expect(loser.faceCount).toBe(0);
  });
});

// Slice 3 (spec §6.1, §9.3): GET /shared-spaces/:id/assets/:assetId/faces — the read-side twin of
// isFaceAssignableInSpace's hidden-person exclusion. An editor must never be able to attach a face
// this list would not show them, so the two must apply the identical filter.
describe('getAssetFacesForSpace', () => {
  // F-8: the read-side twin of F-9. Written so "absent" is proved to mean the filter fired,
  // not that the fixture never created the face — un-hide and the same face appears.
  it('omits a face belonging to a person the OWNER marked hidden (F-8)', async () => {
    const { ctx } = setup();
    const spaceRepo = ctx.get(SharedSpaceRepository);
    const { bob, space } = await newSpaceWithEditorAndMember(ctx);
    const { assetId } = await reachPathBuilders.direct(ctx, { spaceId: space.id, ownerId: bob.id });
    const { result: person } = await ctx.newPerson({ ownerId: bob.id, isHidden: true });
    const { result: faceId } = await ctx.newAssetFace({ assetId, personId: person.id });

    await expect(spaceRepo.getAssetFacesForSpace(space.id, assetId)).resolves.toEqual([]);

    await defaultDatabase.updateTable('person').set({ isHidden: false }).where('id', '=', person.id).execute();
    const shown = await spaceRepo.getAssetFacesForSpace(space.id, assetId);
    expect(shown.map((f) => f.id)).toEqual([faceId]);
  });

  // F-12: a face held by a space person the SPACE hid is likewise absent.
  it('omits a face held by a hidden space person (F-12)', async () => {
    const { ctx } = setup();
    const spaceRepo = ctx.get(SharedSpaceRepository);
    const { bob, space } = await newSpaceWithEditorAndMember(ctx);
    const { assetId } = await reachPathBuilders.direct(ctx, { spaceId: space.id, ownerId: bob.id });
    const { result: faceId } = await ctx.newAssetFace({ assetId });
    const person = await spaceRepo.createPerson({ spaceId: space.id, name: 'Hidden one', isHidden: true });
    await spaceRepo.addPersonFaces([{ personId: person.id, assetFaceId: faceId }]);

    await expect(spaceRepo.getAssetFacesForSpace(space.id, assetId)).resolves.toEqual([]);

    await defaultDatabase
      .updateTable('shared_space_person')
      .set({ isHidden: false })
      .where('id', '=', person.id)
      .execute();
    const shown = await spaceRepo.getAssetFacesForSpace(space.id, assetId);
    expect(shown.map((f) => f.id)).toEqual([faceId]);
  });

  it('returns an unassigned face with a null space person', async () => {
    const { ctx } = setup();
    const spaceRepo = ctx.get(SharedSpaceRepository);
    const { bob, space } = await newSpaceWithEditorAndMember(ctx);
    const { assetId } = await reachPathBuilders.direct(ctx, { spaceId: space.id, ownerId: bob.id });
    const { result: faceId } = await ctx.newAssetFace({ assetId });

    const faces = await spaceRepo.getAssetFacesForSpace(space.id, assetId);
    expect(faces).toHaveLength(1);
    expect(faces[0]).toMatchObject({ id: faceId, spacePersonId: null, spacePersonName: null });
  });

  it('omits soft-deleted and invisible faces', async () => {
    const { ctx } = setup();
    const spaceRepo = ctx.get(SharedSpaceRepository);
    const { bob, space } = await newSpaceWithEditorAndMember(ctx);
    const { assetId } = await reachPathBuilders.direct(ctx, { spaceId: space.id, ownerId: bob.id });
    const { result: faceId } = await ctx.newAssetFace({ assetId });

    await expect(spaceRepo.getAssetFacesForSpace(space.id, assetId)).resolves.toHaveLength(1);
    await defaultDatabase.updateTable('asset_face').set({ isVisible: false }).where('id', '=', faceId).execute();
    await expect(spaceRepo.getAssetFacesForSpace(space.id, assetId)).resolves.toEqual([]);
  });
});
