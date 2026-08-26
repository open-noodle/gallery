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
import { BadRequestException } from '@nestjs/common';
import { Kysely } from 'kysely';
import { AuthDto } from 'src/dtos/auth.dto';
import { AssetEditAction } from 'src/dtos/editing.dto';
import { AssetVisibility, SourceType } from 'src/enum';
import { AssetEditRepository } from 'src/repositories/asset-edit.repository';
import { AssetRepository } from 'src/repositories/asset.repository';
import { DatabaseRepository } from 'src/repositories/database.repository';
import { FaceIdentityRepository } from 'src/repositories/face-identity.repository';
import { FacePersonVerdictRepository } from 'src/repositories/face-person-verdict.repository';
import { LoggingRepository } from 'src/repositories/logging.repository';
import { PersonRepository } from 'src/repositories/person.repository';
import { SharedSpaceRepository } from 'src/repositories/shared-space.repository';
import { DB } from 'src/schema';
import { BaseService } from 'src/services/base.service';
import { SharedSpaceService } from 'src/services/shared-space.service';
import { newMediumService } from 'test/medium.factory';
import { getKyselyDB } from 'test/utils';
import { beforeAll, describe, expect, it, vi } from 'vitest';

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
      real: [
        FacePersonVerdictRepository,
        SharedSpaceRepository,
        FaceIdentityRepository,
        DatabaseRepository,
        PersonRepository,
      ],
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

// §6.3.1 row 3 (REVISED 2026-08-25): the face already belongs to one of Bob's own people, under an
// identity Anna's target space person does not share. This row used to be the "space-local override"
// -- Anna's correction stopped at the space boundary. The revision reverses that: a correction is a
// correction everywhere, so Anna re-pointing this face at Uncle Tom re-points the identity link and
// Bob's own copy of the photo too.
//
// What survives the revision is that Anna edits the FACE, never Bob's PEOPLE: his 'Dad' person row
// keeps its name and its own identity, and every other face he filed under Dad stays there. Only the
// one face Anna actually re-pointed moves. That distinction is what the assertions below separate.
describe('the owner-named override re-points the face for everyone (F-36 revised, F-40 revised)', () => {
  it("re-points the face's identity and Bob's own asset_face.personId, while leaving Bob's 'Dad' person row and his other faces intact (F-36, F-40)", async () => {
    const { sut, ctx } = newMediumService(SharedSpaceService, {
      database: defaultDatabase,
      real: [
        FacePersonVerdictRepository,
        SharedSpaceRepository,
        FaceIdentityRepository,
        DatabaseRepository,
        PersonRepository,
      ],
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

    // A SECOND face Bob filed under Dad, on a different asset, which Anna never touches. Without it
    // the "Bob's other faces are intact" assertion below would be vacuous -- and Dad would be left
    // with no faces at all, which is a different scenario (a person emptied out) than the one this
    // case is about.
    const { assetId: otherAssetId } = await reachPathBuilders.direct(ctx, { spaceId: space.id, ownerId: bob.id });
    const { result: otherFaceId } = await ctx.newAssetFace({ assetId: otherAssetId, personId: bobPerson.id });
    await faceIdentityRepo.linkFace({
      assetFaceId: otherFaceId,
      identityId: bobIdentity.id,
      source: 'owner-person',
    });

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

    // F-36 (revised): the face's GLOBAL identity link now follows Anna's correction, off Bob's
    // identity and onto the space person's.
    const identityLink = await defaultDatabase
      .selectFrom('face_identity_face')
      .selectAll()
      .where('assetFaceId', '=', faceId)
      .executeTakeFirstOrThrow();
    expect(identityLink.identityId).not.toBe(bobIdentity.id);

    // F-40 (revised): Bob's own copy of the photo moves too -- off 'Dad' and onto a person carrying
    // Anna's name. Asserting it is no longer bobPerson.id would pass even if the column were nulled,
    // so pin the row it actually lands on.
    const face = await defaultDatabase
      .selectFrom('asset_face')
      .selectAll()
      .where('id', '=', faceId)
      .executeTakeFirstOrThrow();
    expect(face.personId).not.toBe(bobPerson.id);
    const landedOn = await defaultDatabase
      .selectFrom('person')
      .selectAll()
      .where('id', '=', face.personId!)
      .executeTakeFirstOrThrow();
    expect(landedOn.ownerId).toBe(bob.id);
    expect(landedOn.name).toBe('Uncle Tom');

    // The half the revision did NOT change: Anna re-pointed a FACE, not Bob's person. 'Dad' still
    // exists, still named, still under his own identity -- so any OTHER face Bob filed under Dad is
    // untouched, and his People page still resolves Dad as Dad.
    const person = await defaultDatabase
      .selectFrom('person')
      .selectAll()
      .where('id', '=', bobPerson.id)
      .executeTakeFirstOrThrow();
    expect(person.name).toBe('Dad');
    expect(person.identityId).toBe(bobIdentity.id);

    // The other face Bob filed under Dad did not move with the one Anna corrected.
    const otherFace = await defaultDatabase
      .selectFrom('asset_face')
      .selectAll()
      .where('id', '=', otherFaceId)
      .executeTakeFirstOrThrow();
    expect(otherFace.personId).toBe(bobPerson.id);

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
      real: [
        FacePersonVerdictRepository,
        SharedSpaceRepository,
        FaceIdentityRepository,
        DatabaseRepository,
        PersonRepository,
      ],
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

  // Slice 9, Task 1 (spec §6.6): `isEditorDrawn` is the client's only signal for whether the
  // delete-box affordance applies -- derived from `asset_face.createdBy IS NOT NULL`, never
  // `sourceType` (see deleteSpaceAssetFace's doc comment for why sourceType cannot tell the two
  // apart). Both rows share the same fixture setup so a difference can only be explained by
  // `createdBy`, not by something else about the face.
  it('reports isEditorDrawn: true for a face with createdBy set, false for a detected face (spec §6.6)', async () => {
    const { ctx } = setup();
    const spaceRepo = ctx.get(SharedSpaceRepository);
    const { anna, bob, space } = await newSpaceWithEditorAndMember(ctx);
    const { assetId } = await reachPathBuilders.direct(ctx, { spaceId: space.id, ownerId: bob.id });
    const { result: drawnFaceId } = await ctx.newAssetFace({ assetId, createdBy: anna.id });
    const { result: detectedFaceId } = await ctx.newAssetFace({ assetId });

    const faces = await spaceRepo.getAssetFacesForSpace(space.id, assetId);

    const drawn = faces.find((face) => face.id === drawnFaceId);
    const detected = faces.find((face) => face.id === detectedFaceId);
    expect(drawn).toMatchObject({ isEditorDrawn: true });
    expect(detected).toMatchObject({ isEditorDrawn: false });
  });

  // #992 field report: a face named in TWO spaces came back TWICE from this read -- one row per
  // `shared_space_person_face` link, because that join is not space-scoped (only the
  // `shared_space_person` join below it is, and it merely NULLs the other space's columns). The
  // panel renders these in a keyed `{#each face.id}`, and Svelte throws `each_key_duplicate` on a
  // repeated key, aborting the branch swap and leaving the loading spinner up for good (see
  // `appendUniqueById`'s doc comment for the same failure mode on the people grid).
  it('returns ONE row for a face also held by a space person in ANOTHER space', async () => {
    const { ctx } = setup();
    const spaceRepo = ctx.get(SharedSpaceRepository);
    const { bob, space } = await newSpaceWithEditorAndMember(ctx);
    const { space: otherSpace } = await ctx.newSharedSpace({ createdById: bob.id });
    const { assetId } = await reachPathBuilders.direct(ctx, { spaceId: space.id, ownerId: bob.id });
    await ctx.newSharedSpaceAsset({ spaceId: otherSpace.id, assetId });
    const { result: faceId } = await ctx.newAssetFace({ assetId });

    const here = await spaceRepo.createPerson({ spaceId: space.id, name: 'Aurelia' });
    const there = await spaceRepo.createPerson({ spaceId: otherSpace.id, name: 'Aurelia elsewhere' });
    await spaceRepo.addPersonFaces([
      { personId: here.id, assetFaceId: faceId },
      { personId: there.id, assetFaceId: faceId },
    ]);

    const faces = await spaceRepo.getAssetFacesForSpace(space.id, assetId);

    expect(faces.map((face) => face.id)).toEqual([faceId]);
    expect(faces[0]).toMatchObject({ spacePersonId: here.id, spacePersonName: 'Aurelia' });
  });
});

// Slice 4, Task 1 (spec §6.4, §9.4): DELETE /shared-spaces/:id/people/:personId/faces/:assetFaceId.
// Removes only the shared_space_person_face projection row. Two traps this slice exists to catch:
// a forgotten recount (F-32) and an accidental delete of face_identity_face (F-22).
describe('detach', () => {
  // F-32: the counts must come back down. Written FIRST — a missing recount is invisible
  // to every other test here and only surfaces later as mis-ordered, silently-hidden people.
  it('recounts faceCount/assetCount on detach (F-32)', async () => {
    const { ctx } = setup();
    const spaceRepo = ctx.get(SharedSpaceRepository);
    const { bob, space } = await newSpaceWithEditorAndMember(ctx);
    const { assetId } = await reachPathBuilders.direct(ctx, { spaceId: space.id, ownerId: bob.id });
    const { result: faceId } = await ctx.newAssetFace({ assetId });
    const person = await spaceRepo.createPerson({ spaceId: space.id, name: 'Aurelia' });
    await spaceRepo.addPersonFaces([{ personId: person.id, assetFaceId: faceId }]);

    const before = await defaultDatabase
      .selectFrom('shared_space_person')
      .selectAll()
      .where('id', '=', person.id)
      .executeTakeFirstOrThrow();
    expect(before.faceCount).toBe(1);

    await spaceRepo.removePersonFace(person.id, faceId);

    const after = await defaultDatabase
      .selectFrom('shared_space_person')
      .selectAll()
      .where('id', '=', person.id)
      .executeTakeFirstOrThrow();
    expect(after.faceCount).toBe(0);
    expect(after.assetCount).toBe(0);
  });

  // F-22: the identity link survives, so other spaces sharing it are unaffected (§5.1).
  it('leaves face_identity_face untouched (F-22)', async () => {
    const { ctx } = setup();
    const spaceRepo = ctx.get(SharedSpaceRepository);
    const { bob, space } = await newSpaceWithEditorAndMember(ctx);
    const { assetId } = await reachPathBuilders.direct(ctx, { spaceId: space.id, ownerId: bob.id });
    const { result: faceId } = await ctx.newAssetFace({ assetId });
    const person = await spaceRepo.createPerson({ spaceId: space.id, name: 'Aurelia' });
    const identity = await ctx.get(FaceIdentityRepository).ensureSpacePersonIdentity(person.id);
    await ctx
      .get(FaceIdentityRepository)
      .replaceFaceIdentity({ assetFaceId: faceId, identityId: identity.id, source: 'manual' });
    await spaceRepo.addPersonFaces([{ personId: person.id, assetFaceId: faceId }]);

    await spaceRepo.removePersonFace(person.id, faceId);

    const link = await defaultDatabase
      .selectFrom('face_identity_face')
      .selectAll()
      .where('assetFaceId', '=', faceId)
      .executeTakeFirst();
    expect(link).toBeDefined();
    expect(link?.identityId).toBe(identity.id);
  });
});

// Slice 4, Task 2 (spec §6.2, §9.4): POST /shared-spaces/:id/people — create a space person,
// optionally attaching a seed face in the same transaction.
describe('createSpacePerson', () => {
  // F-15: person + attachment are one transaction. A crash between them would leave a
  // nameless orphan in the space's people list.
  it('creates the person and attaches the seed face atomically (F-15)', async () => {
    const { sut, ctx } = newMediumService(SharedSpaceService, {
      database: defaultDatabase,
      real: [
        FacePersonVerdictRepository,
        SharedSpaceRepository,
        FaceIdentityRepository,
        DatabaseRepository,
        PersonRepository,
      ],
      mock: [LoggingRepository],
    });
    const { anna, bob, space } = await newSpaceWithEditorAndMember(ctx);
    const { assetId } = await reachPathBuilders.direct(ctx, { spaceId: space.id, ownerId: bob.id });
    const { result: faceId } = await ctx.newAssetFace({ assetId });
    const auth = { user: { id: anna.id } } as AuthDto;

    const person = await sut.createSpacePerson(auth, space.id, { name: 'Aurelia', assetFaceId: faceId });

    expect(person.name).toBe('Aurelia');
    expect(person.spaceId).toBe(space.id);

    const projectionRows = await defaultDatabase
      .selectFrom('shared_space_person_face')
      .selectAll()
      .where('assetFaceId', '=', faceId)
      .execute();
    expect(projectionRows).toEqual([{ personId: person.id, assetFaceId: faceId }]);

    const dbPerson = await defaultDatabase
      .selectFrom('shared_space_person')
      .selectAll()
      .where('id', '=', person.id)
      .executeTakeFirstOrThrow();
    expect(dbPerson.faceCount).toBe(1);
    expect(dbPerson.assetCount).toBe(1);
    expect(dbPerson.identityId).not.toBeNull();
  });

  // F-15 negative: force the attach to throw and assert NO person row survives.
  it('rolls the person back when the attach fails (F-15)', async () => {
    const { sut, ctx } = newMediumService(SharedSpaceService, {
      database: defaultDatabase,
      real: [
        FacePersonVerdictRepository,
        SharedSpaceRepository,
        FaceIdentityRepository,
        DatabaseRepository,
        PersonRepository,
      ],
      mock: [LoggingRepository],
    });
    const spaceRepo = ctx.get(SharedSpaceRepository);
    const { anna, bob, space } = await newSpaceWithEditorAndMember(ctx);
    const { assetId } = await reachPathBuilders.direct(ctx, { spaceId: space.id, ownerId: bob.id });
    const { result: faceId } = await ctx.newAssetFace({ assetId });
    const auth = { user: { id: anna.id } } as AuthDto;

    vi.spyOn(spaceRepo, 'addPersonFaces').mockRejectedValueOnce(new Error('boom'));

    await expect(sut.createSpacePerson(auth, space.id, { name: 'Aurelia', assetFaceId: faceId })).rejects.toThrow(
      'boom',
    );

    const rows = await defaultDatabase
      .selectFrom('shared_space_person')
      .selectAll()
      .where('spaceId', '=', space.id)
      .execute();
    expect(rows).toEqual([]);
  });

  // F-33: the seed face's identity already has a space person in this space.
  it('returns the existing person instead of violating the unique index (F-33)', async () => {
    const { sut, ctx } = newMediumService(SharedSpaceService, {
      database: defaultDatabase,
      real: [
        FacePersonVerdictRepository,
        SharedSpaceRepository,
        FaceIdentityRepository,
        DatabaseRepository,
        PersonRepository,
      ],
      mock: [LoggingRepository],
    });
    const spaceRepo = ctx.get(SharedSpaceRepository);
    const faceIdentityRepo = ctx.get(FaceIdentityRepository);
    const { anna, bob, space } = await newSpaceWithEditorAndMember(ctx);
    const { assetId } = await reachPathBuilders.direct(ctx, { spaceId: space.id, ownerId: bob.id });
    const { result: faceId } = await ctx.newAssetFace({ assetId });
    const auth = { user: { id: anna.id } } as AuthDto;

    // An existing space person already carries an identity, established via a DIFFERENT face of
    // the same identity than the one we are about to seed with.
    const existingPerson = await spaceRepo.createPerson({ spaceId: space.id, name: 'Uncle Tom' });
    const identity = await faceIdentityRepo.ensureSpacePersonIdentity(existingPerson.id);
    // The seed face already resolves to that SAME identity (e.g. left over from an earlier
    // attach/detach cycle, or ML backfill) -- a plain createPerson would violate
    // shared_space_person_spaceId_identityId_key the moment linkFaceToSpacePerson tried to point
    // a NEW person's identity here.
    await faceIdentityRepo.replaceFaceIdentity({ assetFaceId: faceId, identityId: identity.id, source: 'manual' });

    const person = await sut.createSpacePerson(auth, space.id, { name: 'Someone Else', assetFaceId: faceId });

    expect(person.id).toBe(existingPerson.id);
    // The pre-existing name wins -- create-from-face does not rename an existing person.
    expect(person.name).toBe('Uncle Tom');

    const peopleInSpace = await defaultDatabase
      .selectFrom('shared_space_person')
      .selectAll()
      .where('spaceId', '=', space.id)
      .execute();
    expect(peopleInSpace).toHaveLength(1);

    const projectionRows = await defaultDatabase
      .selectFrom('shared_space_person_face')
      .selectAll()
      .where('assetFaceId', '=', faceId)
      .execute();
    expect(projectionRows).toEqual([{ personId: existingPerson.id, assetFaceId: faceId }]);
  });
});

// Slice 5 (spec §5.1, §6.3.1): the cross-space identity-propagation contract that the rest of the
// design (Slice 6 onward) is built on top of. Adds NO production code -- these four tests pin
// behaviour that already exists via `linkFaceToSpacePerson`/`replaceFaceIdentity`'s global upsert.
// If any of these fails, the premise behind §5.1 is wrong and must be revisited before Slice 6.
describe('cross-space identity propagation (F-20, F-21)', () => {
  // F-20: `face_identity_face`'s primary key is `assetFaceId` alone (§5.1), so attaching a face in
  // space A rewrites that face's GLOBAL identity. If space B already has a person carrying that same
  // identity, B's resolved view of it picks up the newly-attached face too -- not because B's own
  // `shared_space_person_face` projection changed (it never does here), but because every resolved
  // read (`getResolvedPersonByIdentityId`, the same path the owner's own view uses) aggregates faces
  // by identity across everything the viewer can reach, independent of which space wrote them.
  it('an attach in space A propagates to space B through the shared identity (F-20)', async () => {
    const { sut, ctx } = newMediumService(SharedSpaceService, {
      database: defaultDatabase,
      real: [
        FacePersonVerdictRepository,
        SharedSpaceRepository,
        FaceIdentityRepository,
        DatabaseRepository,
        PersonRepository,
      ],
      mock: [LoggingRepository],
    });
    const spaceRepo = ctx.get(SharedSpaceRepository);
    const faceIdentityRepo = ctx.get(FaceIdentityRepository);
    const { anna, bob, space: spaceA } = await newSpaceWithEditorAndMember(ctx);
    const { space: spaceB } = await ctx.newSharedSpace({ createdById: bob.id });
    await ctx.newSharedSpaceMember({ spaceId: spaceB.id, userId: bob.id, role: 'owner' });
    // Erin is a member of B ONLY -- mirrors the spec's own example ("Anna's edit is visible to Erin").
    const { user: erin } = await ctx.newUser();
    await ctx.newSharedSpaceMember({ spaceId: spaceB.id, userId: erin.id, role: 'viewer' });

    // B already has a person carrying identity X, established by a face reachable only through B.
    const { assetId: seedAssetId } = await reachPathBuilders.direct(ctx, { spaceId: spaceB.id, ownerId: bob.id });
    const { result: seedFaceId } = await ctx.newAssetFace({ assetId: seedAssetId });
    const personB = await spaceRepo.createPerson({ spaceId: spaceB.id, name: 'B-side' });
    const identityX = await faceIdentityRepo.ensureSpacePersonIdentity(personB.id);
    await spaceRepo.addPersonFaces([{ personId: personB.id, assetFaceId: seedFaceId }]);
    await faceIdentityRepo.replaceFaceIdentity({
      assetFaceId: seedFaceId,
      identityId: identityX.id,
      source: 'manual',
    });

    // Non-vacuous baseline: before Anna's attach, Erin already resolves identity X to exactly the one
    // asset the seed face lives on.
    const before = await faceIdentityRepo.getResolvedPersonByIdentityId(erin.id, identityX.id);
    expect(before?.numberOfAssets).toBe(1);

    // A's person is lined up to the SAME identity ahead of time (per the plan: "use
    // ensureSpacePersonIdentity to line them up") -- this is what makes it a genuine propagation
    // case rather than the ordinary case of a person minting a brand-new identity.
    const personA = await spaceRepo.createPerson({ spaceId: spaceA.id, name: 'A-side' });
    await defaultDatabase
      .updateTable('shared_space_person')
      .set({ identityId: identityX.id })
      .where('id', '=', personA.id)
      .execute();

    // A brand-new, unassigned face on an asset reachable through BOTH spaces -- through A (so Anna's
    // attach is permitted at all) and through B (so Erin's resolution can ever reach it).
    const { asset } = await ctx.newAsset({ ownerId: bob.id, visibility: AssetVisibility.Timeline });
    await ctx.newSharedSpaceAsset({ spaceId: spaceA.id, assetId: asset.id });
    await ctx.newSharedSpaceAsset({ spaceId: spaceB.id, assetId: asset.id });
    const { result: newFaceId } = await ctx.newAssetFace({ assetId: asset.id });

    const auth = { user: { id: anna.id } } as AuthDto;
    await expect(sut.attachFaceToSpacePerson(auth, spaceA.id, personA.id, newFaceId)).resolves.toBe(true);

    // The new face's global identity is now X.
    const link = await defaultDatabase
      .selectFrom('face_identity_face')
      .selectAll()
      .where('assetFaceId', '=', newFaceId)
      .executeTakeFirstOrThrow();
    expect(link.identityId).toBe(identityX.id);

    // And it is now part of what Erin -- a member only of B, who never touched space A -- resolves
    // for identity X: one more asset than before, reached entirely through the shared identity.
    const after = await faceIdentityRepo.getResolvedPersonByIdentityId(erin.id, identityX.id);
    expect(after?.numberOfAssets).toBe(2);
  });

  // F-21: the other half of §5.1. Identity is shared; naming is per space. A test that only checked
  // F-20 would let a future change leak names across spaces unnoticed.
  it('naming does not propagate -- B keeps its own name for the shared identity (F-21)', async () => {
    const { sut, ctx } = newMediumService(SharedSpaceService, {
      database: defaultDatabase,
      real: [
        FacePersonVerdictRepository,
        SharedSpaceRepository,
        FaceIdentityRepository,
        DatabaseRepository,
        PersonRepository,
      ],
      mock: [LoggingRepository],
    });
    const spaceRepo = ctx.get(SharedSpaceRepository);
    const faceIdentityRepo = ctx.get(FaceIdentityRepository);
    const { anna, bob, space: spaceA } = await newSpaceWithEditorAndMember(ctx);
    const { space: spaceB } = await ctx.newSharedSpace({ createdById: bob.id });
    await ctx.newSharedSpaceMember({ spaceId: spaceB.id, userId: bob.id, role: 'owner' });

    const personB = await spaceRepo.createPerson({ spaceId: spaceB.id, name: 'Bandit' });
    const identityX = await faceIdentityRepo.ensureSpacePersonIdentity(personB.id);

    const personA = await spaceRepo.createPerson({ spaceId: spaceA.id, name: 'Different Name Entirely' });
    await defaultDatabase
      .updateTable('shared_space_person')
      .set({ identityId: identityX.id })
      .where('id', '=', personA.id)
      .execute();

    const { assetId } = await reachPathBuilders.direct(ctx, { spaceId: spaceA.id, ownerId: bob.id });
    const { result: faceId } = await ctx.newAssetFace({ assetId });
    const auth = { user: { id: anna.id } } as AuthDto;

    await expect(sut.attachFaceToSpacePerson(auth, spaceA.id, personA.id, faceId)).resolves.toBe(true);

    const bPersonAfter = await defaultDatabase
      .selectFrom('shared_space_person')
      .select(['name', 'identityId'])
      .where('id', '=', personB.id)
      .executeTakeFirstOrThrow();
    // The identity link is shared (proves this is a real propagation fixture, not a no-op)...
    expect(bPersonAfter.identityId).toBe(identityX.id);
    // ...but B's own name column is untouched by Anna's attach in A.
    expect(bPersonAfter.name).toBe('Bandit');
  });
});

// Slice 5 (spec §6.3.1, REVISED 2026-08-25): F-23 and F-39 are a pair, and the revision splits them
// apart rather than pointing them the same way. The original insulation ("an attach never touches the
// owner's side") was reversed: an editor naming a face must show up on the owner's OWN copy of the
// photo, creating a person in his library when he has never named that human. So F-23 now pins the
// propagation.
//
// F-39 is NOT reversed and still pins isolation, because the propagation is identity-scoped: it moves
// only the face actually being attached. An attach elsewhere, under an identity of its own, must still
// leave Bob's unrelated people alone -- and it pins the RESOLVED name/birthday
// `applyResolvedPersonMetadata` (asset.service.ts:180) computes through the identity layer at request
// time, which a column-only assertion would miss, since resolution happens at read time.
describe('attach propagates to the owner, but only for the attached identity (F-23 revised, F-39)', () => {
  // F-23 (revised): columns -- the attach reaches asset_face.personId and Bob's person table.
  it("writes asset_face.personId and creates the owner's person row (F-23)", async () => {
    const { sut, ctx } = newMediumService(SharedSpaceService, {
      database: defaultDatabase,
      real: [
        FacePersonVerdictRepository,
        SharedSpaceRepository,
        FaceIdentityRepository,
        DatabaseRepository,
        PersonRepository,
      ],
      mock: [LoggingRepository],
    });
    const spaceRepo = ctx.get(SharedSpaceRepository);
    const { anna, bob, space } = await newSpaceWithEditorAndMember(ctx);
    const { assetId } = await reachPathBuilders.direct(ctx, { spaceId: space.id, ownerId: bob.id });
    const { result: faceId } = await ctx.newAssetFace({ assetId });
    const person = await spaceRepo.createPerson({ spaceId: space.id, name: 'Aurelia' });
    const auth = { user: { id: anna.id } } as AuthDto;

    // Non-vacuous baseline.
    const faceBefore = await defaultDatabase
      .selectFrom('asset_face')
      .select('personId')
      .where('id', '=', faceId)
      .executeTakeFirstOrThrow();
    expect(faceBefore.personId).toBeNull();
    await expect(
      defaultDatabase.selectFrom('person').selectAll().where('ownerId', '=', bob.id).execute(),
    ).resolves.toEqual([]);

    await expect(sut.attachFaceToSpacePerson(auth, space.id, person.id, faceId)).resolves.toBe(true);

    const faceAfter = await defaultDatabase
      .selectFrom('asset_face')
      .select('personId')
      .where('id', '=', faceId)
      .executeTakeFirstOrThrow();
    expect(faceAfter.personId).not.toBeNull();

    // Bob had never named this human, so the propagation had to CREATE the person, carrying Anna's
    // name across -- and the face must point at exactly that new row, not merely at "some" person.
    const bobPeople = await defaultDatabase.selectFrom('person').selectAll().where('ownerId', '=', bob.id).execute();
    expect(bobPeople).toHaveLength(1);
    expect(bobPeople[0].name).toBe('Aurelia');
    expect(faceAfter.personId).toBe(bobPeople[0].id);
  });

  // F-39: the resolved view. An attach happening anywhere in a space Bob's asset is reachable through
  // must never perturb what Bob himself sees for HIS OWN, entirely unrelated, identity.
  it("leaves Bob's RESOLVED name and birthday unchanged after an unrelated attach elsewhere (F-39)", async () => {
    const { sut, ctx } = newMediumService(SharedSpaceService, {
      database: defaultDatabase,
      real: [
        FacePersonVerdictRepository,
        SharedSpaceRepository,
        FaceIdentityRepository,
        DatabaseRepository,
        PersonRepository,
      ],
      mock: [LoggingRepository],
    });
    const spaceRepo = ctx.get(SharedSpaceRepository);
    const faceIdentityRepo = ctx.get(FaceIdentityRepository);
    const { anna, bob, space } = await newSpaceWithEditorAndMember(ctx);

    // Bob has a named, dated person under HIS OWN identity.
    const { result: bobPerson } = await ctx.newPerson({ ownerId: bob.id, name: 'Dad', birthDate: '1970-06-15' });
    const bobIdentity = await faceIdentityRepo.ensurePersonIdentity(bobPerson.id);
    const { assetId: bobAssetId } = await reachPathBuilders.direct(ctx, { spaceId: space.id, ownerId: bob.id });
    const { result: bobFaceId } = await ctx.newAssetFace({ assetId: bobAssetId, personId: bobPerson.id });
    await faceIdentityRepo.linkFace({ assetFaceId: bobFaceId, identityId: bobIdentity.id, source: 'owner-person' });

    // A completely DIFFERENT, unrelated face -- no connection to Bob's identity at all.
    const { assetId: otherAssetId } = await reachPathBuilders.direct(ctx, { spaceId: space.id, ownerId: bob.id });
    const { result: unrelatedFaceId } = await ctx.newAssetFace({ assetId: otherAssetId });
    const spacePerson = await spaceRepo.createPerson({ spaceId: space.id, name: 'Someone Else' });
    const auth = { user: { id: anna.id } } as AuthDto;

    // Non-vacuous baseline: resolution already works and returns Bob's real values before the attach.
    const before = await faceIdentityRepo.getResolvedPersonByIdentityId(bob.id, bobIdentity.id);
    expect(before?.name).toBe('Dad');
    expect(before?.birthDate).toBe('1970-06-15');

    await expect(sut.attachFaceToSpacePerson(auth, space.id, spacePerson.id, unrelatedFaceId)).resolves.toBe(true);

    const after = await faceIdentityRepo.getResolvedPersonByIdentityId(bob.id, bobIdentity.id);
    expect(after?.name).toBe('Dad');
    expect(after?.birthDate).toBe('1970-06-15');
  });
});

// Slice 6, Task 2 (spec §6.5, §9.6): POST /shared-spaces/:id/assets/:assetId/faces -- draw a box.
// F-16 pins the edit-aware coordinate transform: it is not optional, since #992 lets an editor
// rotate a member's asset, making a rotated preview a likely path rather than an exotic one.
describe('createSpaceAssetFace', () => {
  const realRepos = [
    FacePersonVerdictRepository,
    SharedSpaceRepository,
    FaceIdentityRepository,
    DatabaseRepository,
    PersonRepository,
    AssetEditRepository,
    AssetRepository,
  ];

  // F-16: mirrors transform.spec.ts's own 'should rotate 90 degrees clockwise' case (the FORWARD
  // direction used to display an already-stored face): an original box (100,100)-(200,200) on a
  // 1000x800 original becomes (600,100)-(700,200) on the resulting 800x1000 preview. Anna draws on
  // the PREVIEW here, so the box she submits is that same preview-space box, and the stored result
  // must be exactly the ORIGINAL box the forward case started from -- computed independently, not
  // just "a row exists".
  it('stores a box drawn on a rotated preview in ORIGINAL-image coordinates (F-16)', async () => {
    const { sut, ctx } = newMediumService(SharedSpaceService, {
      database: defaultDatabase,
      real: realRepos,
      mock: [LoggingRepository],
    });
    const spaceRepo = ctx.get(SharedSpaceRepository);
    const { anna, bob, space } = await newSpaceWithEditorAndMember(ctx);
    const { asset } = await ctx.newAsset({
      ownerId: bob.id,
      visibility: AssetVisibility.Timeline,
      width: 800,
      height: 1000,
    });
    await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: asset.id });
    await ctx.newExif({ assetId: asset.id, exifImageWidth: 1000, exifImageHeight: 800 });
    await ctx
      .get(AssetEditRepository)
      .replaceAll(asset.id, [{ action: AssetEditAction.Rotate, parameters: { angle: 90 } }]);
    const person = await spaceRepo.createPerson({ spaceId: space.id, name: 'Aurelia' });
    const auth = { user: { id: anna.id } } as AuthDto;

    const result = await sut.createSpaceAssetFace(auth, space.id, asset.id, {
      x: 600,
      y: 100,
      width: 100,
      height: 100,
      imageWidth: 800,
      imageHeight: 1000,
      spacePersonId: person.id,
    });

    // Original-image coordinates, not the preview coordinates Anna submitted.
    expect(result.boundingBoxX1).toBe(100);
    expect(result.boundingBoxY1).toBe(100);
    expect(result.boundingBoxX2).toBe(200);
    expect(result.boundingBoxY2).toBe(200);
    expect(result.imageWidth).toBe(1000);
    expect(result.imageHeight).toBe(800);
    expect(result.spacePersonId).toBe(person.id);

    const face = await defaultDatabase
      .selectFrom('asset_face')
      .selectAll()
      .where('id', '=', result.id)
      .executeTakeFirstOrThrow();
    expect(face.boundingBoxX1).toBe(100);
    expect(face.boundingBoxY1).toBe(100);
    expect(face.boundingBoxX2).toBe(200);
    expect(face.boundingBoxY2).toBe(200);
    expect(face.imageWidth).toBe(1000);
    expect(face.imageHeight).toBe(800);
    // Editor-drawn: sourceType Manual and createdBy is Anna. Since §6.3.1 was revised (2026-08-25)
    // the box Anna draws AND names propagates, so personId lands on a person in Bob's own library
    // carrying her name -- this used to assert null.
    expect(face.sourceType).toBe(SourceType.Manual);
    expect(face.createdBy).toBe(anna.id);
    expect(face.personId).not.toBeNull();
    const ownerPerson = await defaultDatabase
      .selectFrom('person')
      .selectAll()
      .where('id', '=', face.personId!)
      .executeTakeFirstOrThrow();
    expect(ownerPerson.ownerId).toBe(bob.id);
    expect(ownerPerson.name).toBe('Aurelia');

    const projectionRows = await defaultDatabase
      .selectFrom('shared_space_person_face')
      .selectAll()
      .where('assetFaceId', '=', result.id)
      .execute();
    expect(projectionRows).toEqual([{ personId: person.id, assetFaceId: result.id }]);
  });

  // F-17: the asset carries edits (so the transform must run) but has no exif dimensions to invert
  // against -- 400, matching the message the owner path (PersonService.createFace) uses for the
  // identical condition, since both now share convertFaceBoxToOriginalImageSpace.
  it('rejects with 400 when the asset has edits but no exif dimensions (F-17)', async () => {
    const { sut, ctx } = newMediumService(SharedSpaceService, {
      database: defaultDatabase,
      real: realRepos,
      mock: [LoggingRepository],
    });
    const spaceRepo = ctx.get(SharedSpaceRepository);
    const { anna, bob, space } = await newSpaceWithEditorAndMember(ctx);
    const { asset } = await ctx.newAsset({
      ownerId: bob.id,
      visibility: AssetVisibility.Timeline,
      width: 800,
      height: 1000,
    });
    await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: asset.id });
    // Deliberately NO ctx.newExif call -- the asset has no exif row, so exifImageWidth/Height come
    // back null from the left join.
    await ctx
      .get(AssetEditRepository)
      .replaceAll(asset.id, [{ action: AssetEditAction.Rotate, parameters: { angle: 90 } }]);
    const person = await spaceRepo.createPerson({ spaceId: space.id, name: 'Aurelia' });
    const auth = { user: { id: anna.id } } as AuthDto;

    await expect(
      sut.createSpaceAssetFace(auth, space.id, asset.id, {
        x: 600,
        y: 100,
        width: 100,
        height: 100,
        imageWidth: 800,
        imageHeight: 1000,
        spacePersonId: person.id,
      }),
    ).rejects.toThrow(new BadRequestException('Asset does not have valid dimensions'));

    const rows = await defaultDatabase.selectFrom('asset_face').selectAll().where('assetId', '=', asset.id).execute();
    expect(rows).toEqual([]);
  });
});

// Slice 6, Task 3 (spec §6.6, §9.6): DELETE /shared-spaces/:id/faces/:assetFaceId -- an editor may
// delete a box THEY drew (F-18), but a genuinely detected face stays refused (F-19). Written
// together, not sequentially: the two differ ONLY by whether createdBy is null, so an
// implementation that forgets the check would pass F-18 and fail only F-19.
describe('deleteSpaceAssetFace', () => {
  const realRepos = [
    FacePersonVerdictRepository,
    SharedSpaceRepository,
    FaceIdentityRepository,
    DatabaseRepository,
    PersonRepository,
    AssetEditRepository,
    AssetRepository,
  ];

  // F-18: Anna may delete a box SHE drew. Drawn through the real createSpaceAssetFace path (Task
  // 2), so createdBy is set the genuine way, not poked in by hand.
  it('deletes a face the editor drew (F-18)', async () => {
    const { sut, ctx } = newMediumService(SharedSpaceService, {
      database: defaultDatabase,
      real: realRepos,
      mock: [LoggingRepository],
    });
    const spaceRepo = ctx.get(SharedSpaceRepository);
    const { anna, bob, space } = await newSpaceWithEditorAndMember(ctx);
    const { assetId } = await reachPathBuilders.direct(ctx, { spaceId: space.id, ownerId: bob.id });
    const person = await spaceRepo.createPerson({ spaceId: space.id, name: 'Aurelia' });
    const auth = { user: { id: anna.id } } as AuthDto;

    const drawn = await sut.createSpaceAssetFace(auth, space.id, assetId, {
      x: 10,
      y: 20,
      width: 100,
      height: 110,
      imageWidth: 4000,
      imageHeight: 3000,
      spacePersonId: person.id,
    });

    const before = await defaultDatabase
      .selectFrom('shared_space_person')
      .select(['faceCount', 'assetCount'])
      .where('id', '=', person.id)
      .executeTakeFirstOrThrow();
    expect(before.faceCount).toBe(1);

    await expect(sut.deleteSpaceAssetFace(auth, space.id, drawn.id)).resolves.toBeUndefined();

    const face = await defaultDatabase
      .selectFrom('asset_face')
      .selectAll()
      .where('id', '=', drawn.id)
      .executeTakeFirst();
    expect(face).toBeUndefined();

    const projectionRows = await defaultDatabase
      .selectFrom('shared_space_person_face')
      .selectAll()
      .where('assetFaceId', '=', drawn.id)
      .execute();
    expect(projectionRows).toEqual([]);

    // The cascade removes the projection row without recounting -- the delete must do that itself.
    const after = await defaultDatabase
      .selectFrom('shared_space_person')
      .select(['faceCount', 'assetCount'])
      .where('id', '=', person.id)
      .executeTakeFirstOrThrow();
    expect(after.faceCount).toBe(0);
    expect(after.assetCount).toBe(0);
  });

  // F-19: a GENUINELY detected face -- created the normal way (ctx.newAssetFace, used throughout
  // this file for every detected-face fixture), createdBy never set. FaceDelete stays owner-only
  // for these; the space editor path must refuse it exactly like PersonService.deleteFace would
  // for a non-owner, and must NOT decide this from sourceType (both this face and the F-18 one
  // above carry sourceType default/Manual-shaped values -- createdBy is the only real signal).
  it('refuses a genuinely detected face (F-19)', async () => {
    const { sut, ctx } = newMediumService(SharedSpaceService, {
      database: defaultDatabase,
      real: realRepos,
      mock: [LoggingRepository],
    });
    const spaceRepo = ctx.get(SharedSpaceRepository);
    const { anna, bob, space } = await newSpaceWithEditorAndMember(ctx);
    const { assetId } = await reachPathBuilders.direct(ctx, { spaceId: space.id, ownerId: bob.id });
    const { result: faceId } = await ctx.newAssetFace({ assetId });
    const person = await spaceRepo.createPerson({ spaceId: space.id, name: 'Aurelia' });
    await spaceRepo.addPersonFaces([{ personId: person.id, assetFaceId: faceId }]);
    const auth = { user: { id: anna.id } } as AuthDto;

    // Non-vacuous baseline: this really is a detected face, not editor-drawn.
    const seeded = await defaultDatabase
      .selectFrom('asset_face')
      .select(['createdBy'])
      .where('id', '=', faceId)
      .executeTakeFirstOrThrow();
    expect(seeded.createdBy).toBeNull();

    await expect(sut.deleteSpaceAssetFace(auth, space.id, faceId)).rejects.toThrow(BadRequestException);

    // Nothing was destroyed.
    const face = await defaultDatabase.selectFrom('asset_face').selectAll().where('id', '=', faceId).executeTakeFirst();
    expect(face).toBeDefined();
    const projectionRows = await defaultDatabase
      .selectFrom('shared_space_person_face')
      .selectAll()
      .where('assetFaceId', '=', faceId)
      .execute();
    expect(projectionRows).toEqual([{ personId: person.id, assetFaceId: faceId }]);
  });
});
