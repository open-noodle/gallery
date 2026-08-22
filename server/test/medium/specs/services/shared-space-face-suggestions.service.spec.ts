import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Kysely } from 'kysely';
import { AssetVisibility, SharedSpaceRole, SystemMetadataKey } from 'src/enum';
import { ConfigRepository } from 'src/repositories/config.repository';
import { DatabaseRepository } from 'src/repositories/database.repository';
import { FaceIdentityRepository } from 'src/repositories/face-identity.repository';
import { FacePersonVerdictRepository } from 'src/repositories/face-person-verdict.repository';
import { JobRepository } from 'src/repositories/job.repository';
import { LoggingRepository } from 'src/repositories/logging.repository';
import { SharedSpaceRepository } from 'src/repositories/shared-space.repository';
import { SystemMetadataRepository } from 'src/repositories/system-metadata.repository';
import { DB } from 'src/schema';
import { SharedSpaceService } from 'src/services/shared-space.service';
import { newMediumService } from 'test/medium.factory';
import { factory } from 'test/small.factory';
import { getKyselyDB } from 'test/utils';
import { vi } from 'vitest';

let defaultDatabase: Kysely<DB>;

beforeAll(async () => {
  defaultDatabase = await getKyselyDB();
});

const setup = (db?: Kysely<DB>) =>
  newMediumService(SharedSpaceService, {
    database: db || defaultDatabase,
    real: [
      SharedSpaceRepository,
      FacePersonVerdictRepository,
      FaceIdentityRepository,
      ConfigRepository,
      SystemMetadataRepository,
      // Slice 5 (F10): confirmSpacePersonFaceSuggestion wraps its writes in
      // this.databaseRepository.transaction(...) — without this, databaseRepository is undefined on the sut
      // and every confirm call throws.
      DatabaseRepository,
    ],
    mock: [LoggingRepository, JobRepository],
  });

const authFor = (user: { id: string; name: string; email: string; isAdmin?: boolean }) =>
  factory.auth({ user: { id: user.id, name: user.name, email: user.email, isAdmin: user.isAdmin } });

const enableSuggestionBand = async (ctx: ReturnType<typeof setup>['ctx']) => {
  await ctx.get(SystemMetadataRepository).set(SystemMetadataKey.SystemConfig, {
    machineLearning: {
      enabled: true,
      facialRecognition: { enabled: true, maxDistance: 0.5, suggestions: { enabled: true, maxDistance: 0.8 } },
    },
  } as any);
};

const createSuggestionFixture = async (
  ctx: ReturnType<typeof setup>['ctx'],
  input: { reviewerRole?: SharedSpaceRole; faceRecognitionEnabled?: boolean } = {},
) => {
  await enableSuggestionBand(ctx);

  const { user: owner } = await ctx.newUser();
  const { user: reviewer } = await ctx.newUser();
  const { user: assetOwner } = await ctx.newUser();
  const { space } = await ctx.newSharedSpace({
    createdById: owner.id,
    faceRecognitionEnabled: input.faceRecognitionEnabled ?? true,
  });
  await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, role: SharedSpaceRole.Owner });
  await ctx.newSharedSpaceMember({
    spaceId: space.id,
    userId: reviewer.id,
    role: input.reviewerRole ?? SharedSpaceRole.Editor,
  });
  const { asset } = await ctx.newAsset({ ownerId: assetOwner.id, visibility: AssetVisibility.Timeline });
  await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: asset.id, addedById: owner.id });
  const { assetFace } = await ctx.newAssetFace({ assetId: asset.id, personGroupId: null });
  const spacePerson = await ctx.database
    .insertInto('shared_space_person')
    .values({ spaceId: space.id, name: 'Alice', type: 'person', isHidden: false, identityId: null })
    .returningAll()
    .executeTakeFirstOrThrow();
  await ctx.database
    .insertInto('face_person_verdict')
    .values({ spacePersonId: spacePerson.id, assetFaceId: assetFace.id, distance: 0.6 })
    .execute();

  return { owner, reviewer, assetOwner, space, asset, assetFace, spacePerson };
};

describe('SharedSpaceService space face suggestions', () => {
  it('returns suggestions to editors and an empty page to viewers (edge 24)', async () => {
    const { ctx, sut } = setup();
    const fx = await createSuggestionFixture(ctx, { reviewerRole: SharedSpaceRole.Viewer });

    await expect(
      sut.getSpacePersonFaceSuggestions(authFor(fx.reviewer), fx.space.id, fx.spacePerson.id, { page: 1, size: 50 }),
    ).resolves.toEqual({ total: 0, items: [] });

    await ctx.database
      .updateTable('shared_space_member')
      .set({ role: SharedSpaceRole.Editor })
      .where('spaceId', '=', fx.space.id)
      .where('userId', '=', fx.reviewer.id)
      .execute();

    const result = await sut.getSpacePersonFaceSuggestions(authFor(fx.reviewer), fx.space.id, fx.spacePerson.id, {
      page: 1,
      size: 50,
    });

    expect(result.total).toBe(1);
    expect(result.items[0]).toEqual(expect.objectContaining({ assetFaceId: fx.assetFace.id, assetId: fx.asset.id }));
  });

  it('denies viewer confirm/dismiss without mutating rows (edge 24 absence)', async () => {
    const { ctx, sut } = setup();
    const fx = await createSuggestionFixture(ctx, { reviewerRole: SharedSpaceRole.Viewer });

    await expect(
      sut.confirmSpacePersonFaceSuggestion(authFor(fx.reviewer), fx.space.id, fx.spacePerson.id, fx.assetFace.id),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      sut.dismissSpacePersonFaceSuggestion(authFor(fx.reviewer), fx.space.id, fx.spacePerson.id, fx.assetFace.id),
    ).rejects.toBeInstanceOf(ForbiddenException);

    const row = await ctx.database
      .selectFrom('face_person_verdict')
      .select(['status'])
      .where('spacePersonId', '=', fx.spacePerson.id)
      .where('assetFaceId', '=', fx.assetFace.id)
      .executeTakeFirstOrThrow();
    expect(row.status).toBe('pending');
  });

  it('rejects a route person from another space with no identity mutation', async () => {
    const { ctx, sut } = setup();
    const fx = await createSuggestionFixture(ctx);
    const { space: otherSpace } = await ctx.newSharedSpace({ createdById: fx.owner.id, faceRecognitionEnabled: true });
    await ctx.newSharedSpaceMember({ spaceId: otherSpace.id, userId: fx.reviewer.id, role: SharedSpaceRole.Editor });

    await expect(
      sut.confirmSpacePersonFaceSuggestion(authFor(fx.reviewer), otherSpace.id, fx.spacePerson.id, fx.assetFace.id),
    ).rejects.toBeInstanceOf(BadRequestException);

    const person = await ctx.database
      .selectFrom('shared_space_person')
      .select(['identityId'])
      .where('id', '=', fx.spacePerson.id)
      .executeTakeFirstOrThrow();
    expect(person.identityId).toBeNull();
  });

  it('confirm creates a missing space identity, links the candidate face, and keeps asset_face ownership unchanged (edges 26 and 31)', async () => {
    const { ctx, sut } = setup();
    const fx = await createSuggestionFixture(ctx);

    await sut.confirmSpacePersonFaceSuggestion(authFor(fx.reviewer), fx.space.id, fx.spacePerson.id, fx.assetFace.id);

    const person = await ctx.database
      .selectFrom('shared_space_person')
      .select(['identityId'])
      .where('id', '=', fx.spacePerson.id)
      .executeTakeFirstOrThrow();
    expect(person.identityId).toEqual(expect.any(String));

    const link = await ctx.database
      .selectFrom('face_identity_face')
      .select(['identityId', 'source'])
      .where('assetFaceId', '=', fx.assetFace.id)
      .executeTakeFirstOrThrow();
    expect(link).toEqual({ identityId: person.identityId!, source: 'manual' });

    const face = await ctx.database
      .selectFrom('asset_face')
      .innerJoin('asset', 'asset.id', 'asset_face.assetId')
      .select(['asset_face.personGroupId', 'asset.ownerId'])
      .where('asset_face.id', '=', fx.assetFace.id)
      .executeTakeFirstOrThrow();
    expect(face.personGroupId).toBeNull();
    expect(face.ownerId).toBe(fx.assetOwner.id);
  });

  it('confirm clears other pending personal and space suggestions for the same face (edge 28)', async () => {
    const { ctx, sut } = setup();
    const fx = await createSuggestionFixture(ctx);
    const { person } = await ctx.newPerson({ ownerId: fx.assetOwner.id, name: 'Personal Alice' });
    await ctx.database
      .insertInto('face_person_verdict')
      .values({ personId: person.personGroupId, assetFaceId: fx.assetFace.id, distance: 0.61 })
      .execute();
    const otherSpacePerson = await ctx.database
      .insertInto('shared_space_person')
      .values({ spaceId: fx.space.id, name: 'Other Alice', type: 'person', isHidden: false })
      .returningAll()
      .executeTakeFirstOrThrow();
    await ctx.database
      .insertInto('face_person_verdict')
      .values({ spacePersonId: otherSpacePerson.id, assetFaceId: fx.assetFace.id, distance: 0.62 })
      .execute();

    await sut.confirmSpacePersonFaceSuggestion(authFor(fx.reviewer), fx.space.id, fx.spacePerson.id, fx.assetFace.id);

    // Confirm drains EVERY pending suggestion for this now-assigned face — the confirming space person's
    // own row included. There is no surviving 'confirmed' row: the positive verdict is the manual identity
    // link written on the space person's identity, not a status here.
    const rows = await ctx.database
      .selectFrom('face_person_verdict')
      .select(['personId', 'spacePersonId', 'status'])
      .where('assetFaceId', '=', fx.assetFace.id)
      .execute();
    expect(rows).toEqual([]);

    const link = await ctx.database
      .selectFrom('face_identity_face')
      .select('source')
      .where('assetFaceId', '=', fx.assetFace.id)
      .executeTakeFirstOrThrow();
    expect(link.source).toBe('manual');
  });

  // Slice 3 (F6): hasPendingForSpacePerson now applies the SAME manual-link anti-join its read twin
  // (getPendingForSpacePerson) always has — a face someone has already manually placed (any identity) never
  // reads as pending for anyone else. Before this slice, hasPendingForSpacePerson omitted that anti-join, so
  // a confirm could still "win" a face the review queue would no longer have offered, silently overwriting
  // the earlier human's placement. Renamed from "confirm overwrites an existing face identity link (edge 32)"
  // — that assumption is exactly the gap this slice closes.
  it('confirm no-ops when the face already carries a manual link to a different identity (D3 self-heal, edge 32)', async () => {
    const { ctx, sut } = setup();
    const faceIdentityRepository = ctx.get(FaceIdentityRepository);
    const fx = await createSuggestionFixture(ctx);
    const { person: oldPerson } = await ctx.newPerson({ ownerId: fx.assetOwner.id, name: 'Old' });
    const oldIdentity = await faceIdentityRepository.ensurePersonIdentity(oldPerson.personGroupId);
    await faceIdentityRepository.replaceFaceIdentity({
      assetFaceId: fx.assetFace.id,
      identityId: oldIdentity.id,
      source: 'manual',
    });

    await sut.confirmSpacePersonFaceSuggestion(authFor(fx.reviewer), fx.space.id, fx.spacePerson.id, fx.assetFace.id);

    const spacePerson = await ctx.database
      .selectFrom('shared_space_person')
      .select('identityId')
      .where('id', '=', fx.spacePerson.id)
      .executeTakeFirstOrThrow();
    expect(spacePerson.identityId).toBeNull(); // no-op: no identity created for the space person

    const link = await ctx.database
      .selectFrom('face_identity_face')
      .select(['identityId', 'source'])
      .where('assetFaceId', '=', fx.assetFace.id)
      .executeTakeFirstOrThrow();
    expect(link).toEqual({ identityId: oldIdentity.id, source: 'manual' }); // the existing link is untouched

    const row = await ctx.database
      .selectFrom('face_person_verdict')
      .select('status')
      .where('spacePersonId', '=', fx.spacePerson.id)
      .where('assetFaceId', '=', fx.assetFace.id)
      .executeTakeFirstOrThrow();
    expect(row.status).toBe('pending'); // untouched

    // Positive control, same fixture: a DIFFERENT, not-yet-linked face on the same space person confirms
    // normally — the no-op above is specific to the pre-existing manual link, not a broken confirm path.
    const { assetFace: freshFace } = await ctx.newAssetFace({ assetId: fx.asset.id, personGroupId: null });
    await ctx.database
      .insertInto('face_person_verdict')
      .values({ spacePersonId: fx.spacePerson.id, assetFaceId: freshFace.id, distance: 0.6 })
      .execute();

    await sut.confirmSpacePersonFaceSuggestion(authFor(fx.reviewer), fx.space.id, fx.spacePerson.id, freshFace.id);

    const freshLink = await ctx.database
      .selectFrom('face_identity_face')
      .select(['identityId', 'source'])
      .where('assetFaceId', '=', freshFace.id)
      .executeTakeFirstOrThrow();
    expect(freshLink.source).toBe('manual');
  });

  it('confirm and dismiss no-op stale unshared candidates (edge 21)', async () => {
    const { ctx, sut } = setup();
    const fx = await createSuggestionFixture(ctx);
    await ctx.database
      .deleteFrom('shared_space_asset')
      .where('spaceId', '=', fx.space.id)
      .where('assetId', '=', fx.asset.id)
      .execute();

    await expect(
      sut.confirmSpacePersonFaceSuggestion(authFor(fx.reviewer), fx.space.id, fx.spacePerson.id, fx.assetFace.id),
    ).resolves.toBe(false);
    await expect(
      sut.dismissSpacePersonFaceSuggestion(authFor(fx.reviewer), fx.space.id, fx.spacePerson.id, fx.assetFace.id),
    ).resolves.toBe(false);

    const person = await ctx.database
      .selectFrom('shared_space_person')
      .select('identityId')
      .where('id', '=', fx.spacePerson.id)
      .executeTakeFirstOrThrow();
    const row = await ctx.database
      .selectFrom('face_person_verdict')
      .select('status')
      .where('spacePersonId', '=', fx.spacePerson.id)
      .where('assetFaceId', '=', fx.assetFace.id)
      .executeTakeFirstOrThrow();
    expect(person.identityId).toBeNull();
    expect(row.status).toBe('pending');
  });

  it('dismiss marks only the target suggestion and leaves identity graph unchanged', async () => {
    const { ctx, sut } = setup();
    const fx = await createSuggestionFixture(ctx);

    await sut.dismissSpacePersonFaceSuggestion(authFor(fx.reviewer), fx.space.id, fx.spacePerson.id, fx.assetFace.id);

    const row = await ctx.database
      .selectFrom('face_person_verdict')
      .select('status')
      .where('spacePersonId', '=', fx.spacePerson.id)
      .where('assetFaceId', '=', fx.assetFace.id)
      .executeTakeFirstOrThrow();
    const link = await ctx.database
      .selectFrom('face_identity_face')
      .select('assetFaceId')
      .where('assetFaceId', '=', fx.assetFace.id)
      .executeTakeFirst();
    expect(row.status).toBe('rejected');
    expect(link).toBeUndefined();
  });

  // D9: reachability (RBAC), not pendingness, gates a space reject/ignore. A drained-but-still-reachable
  // face (e.g. a concurrent confirm claimed the queue row for a sibling target) must still be resolvable —
  // not silently no-op the way the old hasPendingForSpacePerson gate did.
  it('space reject on a drained-but-reachable face still records the verdict (D9)', async () => {
    const { ctx, sut } = setup();
    const fx = await createSuggestionFixture(ctx);
    // Drain the pending row directly — the face's asset stays in the space (reachable), it simply has no
    // queue row left to claim.
    await ctx
      .get(FacePersonVerdictRepository)
      .claimPendingForSpacePerson(fx.spacePerson.id, fx.assetFace.id, { maxDistance: 0.5, suggestionMaxDistance: 0.8 });
    const drained = await ctx.database
      .selectFrom('face_person_verdict')
      .selectAll()
      .where('spacePersonId', '=', fx.spacePerson.id)
      .where('assetFaceId', '=', fx.assetFace.id)
      .executeTakeFirst();
    expect(drained).toBeUndefined();

    await sut.rejectSpacePersonFaceSuggestion(authFor(fx.reviewer), fx.space.id, fx.spacePerson.id, fx.assetFace.id);

    const row = await ctx.database
      .selectFrom('face_person_verdict')
      .selectAll()
      .where('spacePersonId', '=', fx.spacePerson.id)
      .where('assetFaceId', '=', fx.assetFace.id)
      .executeTakeFirstOrThrow();
    expect(row.status).toBe('rejected');
    expect(row.source).toBe('suggestion');
    expect(row.identityId).toEqual(expect.any(String));
    expect(row.actorId).toBe(fx.reviewer.id);
  });

  it('space reject on a genuinely unreachable face is refused (no verdict row written)', async () => {
    const { ctx, sut } = setup();
    const fx = await createSuggestionFixture(ctx);
    await ctx.database
      .deleteFrom('shared_space_asset')
      .where('spaceId', '=', fx.space.id)
      .where('assetId', '=', fx.asset.id)
      .execute();

    await expect(
      sut.rejectSpacePersonFaceSuggestion(authFor(fx.reviewer), fx.space.id, fx.spacePerson.id, fx.assetFace.id),
    ).resolves.toBe(false);

    const row = await ctx.database
      .selectFrom('face_person_verdict')
      .select(['status', 'identityId', 'actorId'])
      .where('spacePersonId', '=', fx.spacePerson.id)
      .where('assetFaceId', '=', fx.assetFace.id)
      .executeTakeFirstOrThrow();
    // The original pending row is untouched — no verdict was written.
    expect(row).toEqual({ status: 'pending', identityId: null, actorId: null });
  });

  // S3.8 (F5): confirm applies the same eligibility the read (hasPendingForSpacePerson) already applies — a
  // pending suggestion whose asset the owner has since moved into the Locked folder must not be confirmable.
  it('S3.8 — Given a pending suggestion, When the owner moves the asset into the Locked folder and then confirms, Then the confirm is a no-op', async () => {
    const { ctx, sut } = setup();
    const fx = await createSuggestionFixture(ctx);

    await ctx.database
      .updateTable('asset')
      .set({ visibility: AssetVisibility.Locked })
      .where('id', '=', fx.asset.id)
      .execute();

    await expect(
      sut.confirmSpacePersonFaceSuggestion(authFor(fx.reviewer), fx.space.id, fx.spacePerson.id, fx.assetFace.id),
    ).resolves.toBe(false);

    const lockedPerson = await ctx.database
      .selectFrom('shared_space_person')
      .select('identityId')
      .where('id', '=', fx.spacePerson.id)
      .executeTakeFirstOrThrow();
    expect(lockedPerson.identityId).toBeNull(); // no identity created

    const lockedLink = await ctx.database
      .selectFrom('face_identity_face')
      .select('assetFaceId')
      .where('assetFaceId', '=', fx.assetFace.id)
      .executeTakeFirst();
    expect(lockedLink).toBeUndefined(); // no manual link

    const lockedRow = await ctx.database
      .selectFrom('face_person_verdict')
      .select('status')
      .where('spacePersonId', '=', fx.spacePerson.id)
      .where('assetFaceId', '=', fx.assetFace.id)
      .executeTakeFirstOrThrow();
    expect(lockedRow.status).toBe('pending'); // row untouched

    // Positive control, same fixture: once the asset leaves the Locked folder, the SAME confirm call succeeds.
    await ctx.database
      .updateTable('asset')
      .set({ visibility: AssetVisibility.Timeline })
      .where('id', '=', fx.asset.id)
      .execute();

    await sut.confirmSpacePersonFaceSuggestion(authFor(fx.reviewer), fx.space.id, fx.spacePerson.id, fx.assetFace.id);

    const unlockedPerson = await ctx.database
      .selectFrom('shared_space_person')
      .select('identityId')
      .where('id', '=', fx.spacePerson.id)
      .executeTakeFirstOrThrow();
    expect(unlockedPerson.identityId).toEqual(expect.any(String));

    const unlockedLink = await ctx.database
      .selectFrom('face_identity_face')
      .select(['identityId', 'source'])
      .where('assetFaceId', '=', fx.assetFace.id)
      .executeTakeFirstOrThrow();
    expect(unlockedLink).toEqual({ identityId: unlockedPerson.identityId!, source: 'manual' });

    const unlockedRow = await ctx.database
      .selectFrom('face_person_verdict')
      .select('status')
      .where('spacePersonId', '=', fx.spacePerson.id)
      .where('assetFaceId', '=', fx.assetFace.id)
      .executeTakeFirst();
    expect(unlockedRow).toBeUndefined(); // drained
  });

  // Slice 5 (F10): confirmSpacePersonFaceSuggestion's four writes used to be autocommit — a crash between
  // any two of them left a 'manual'-linked face attached to nobody, excluded from every read with no repair
  // path. Wrapped in one transaction so a failure anywhere rolls back everything.
  describe('confirmSpacePersonFaceSuggestion transactional atomicity (Slice 5, F10)', () => {
    it('S5.8 — fault injection: addPersonFaces throws inside the transaction, all four writes roll back', async () => {
      const { ctx, sut } = setup();
      const fx = await createSuggestionFixture(ctx);
      const addPersonFacesSpy = vi
        .spyOn(ctx.get(SharedSpaceRepository), 'addPersonFaces')
        .mockRejectedValue(new Error('boom: addPersonFaces'));

      await expect(
        sut.confirmSpacePersonFaceSuggestion(authFor(fx.reviewer), fx.space.id, fx.spacePerson.id, fx.assetFace.id),
      ).rejects.toThrow('boom: addPersonFaces');

      const row = await ctx.database
        .selectFrom('face_person_verdict')
        .select('status')
        .where('spacePersonId', '=', fx.spacePerson.id)
        .where('assetFaceId', '=', fx.assetFace.id)
        .executeTakeFirst();
      expect(row?.status).toBe('pending'); // the claim's delete rolled back too

      const link = await ctx.database
        .selectFrom('face_identity_face')
        .select('assetFaceId')
        .where('assetFaceId', '=', fx.assetFace.id)
        .executeTakeFirst();
      expect(link).toBeUndefined(); // no manual link survives

      const sspf = await ctx.database
        .selectFrom('shared_space_person_face')
        .select('assetFaceId')
        .where('personId', '=', fx.spacePerson.id)
        .where('assetFaceId', '=', fx.assetFace.id)
        .executeTakeFirst();
      expect(sspf).toBeUndefined();

      addPersonFacesSpy.mockRestore();

      // Positive control, same fixture: with the fault removed, the identical call now succeeds and writes
      // all four — proving the fixture and the confirm path are otherwise healthy, not that everything 400s.
      await sut.confirmSpacePersonFaceSuggestion(authFor(fx.reviewer), fx.space.id, fx.spacePerson.id, fx.assetFace.id);
      const linkAfterRetry = await ctx.database
        .selectFrom('face_identity_face')
        .select('source')
        .where('assetFaceId', '=', fx.assetFace.id)
        .executeTakeFirstOrThrow();
      expect(linkAfterRetry.source).toBe('manual');
    });

    it('S5.9 — fault injection: replaceFaceIdentity throws inside the transaction, same all-or-nothing assertion', async () => {
      const { ctx, sut } = setup();
      const fx = await createSuggestionFixture(ctx);
      const replaceFaceIdentitySpy = vi
        .spyOn(ctx.get(FaceIdentityRepository), 'replaceFaceIdentity')
        .mockRejectedValue(new Error('boom: replaceFaceIdentity'));

      await expect(
        sut.confirmSpacePersonFaceSuggestion(authFor(fx.reviewer), fx.space.id, fx.spacePerson.id, fx.assetFace.id),
      ).rejects.toThrow('boom: replaceFaceIdentity');

      const row = await ctx.database
        .selectFrom('face_person_verdict')
        .select('status')
        .where('spacePersonId', '=', fx.spacePerson.id)
        .where('assetFaceId', '=', fx.assetFace.id)
        .executeTakeFirst();
      expect(row?.status).toBe('pending'); // the claim rolled back

      const link = await ctx.database
        .selectFrom('face_identity_face')
        .select('assetFaceId')
        .where('assetFaceId', '=', fx.assetFace.id)
        .executeTakeFirst();
      expect(link).toBeUndefined();

      const sspf = await ctx.database
        .selectFrom('shared_space_person_face')
        .select('assetFaceId')
        .where('personId', '=', fx.spacePerson.id)
        .where('assetFaceId', '=', fx.assetFace.id)
        .executeTakeFirst();
      expect(sspf).toBeUndefined();

      replaceFaceIdentitySpy.mockRestore();

      // Positive control, same fixture: the identical call now succeeds once the fault is removed.
      await sut.confirmSpacePersonFaceSuggestion(authFor(fx.reviewer), fx.space.id, fx.spacePerson.id, fx.assetFace.id);
      const linkAfterRetry = await ctx.database
        .selectFrom('face_identity_face')
        .select('source')
        .where('assetFaceId', '=', fx.assetFace.id)
        .executeTakeFirstOrThrow();
      expect(linkAfterRetry.source).toBe('manual');
    });

    it('S5.10 (pin): a double-submit resolves exactly once — the losing claim finds nothing left to do', async () => {
      const { ctx, sut } = setup();
      const fx = await createSuggestionFixture(ctx);
      const replaceFaceIdentitySpy = vi.spyOn(ctx.get(FaceIdentityRepository), 'replaceFaceIdentity');

      await Promise.all([
        sut.confirmSpacePersonFaceSuggestion(authFor(fx.reviewer), fx.space.id, fx.spacePerson.id, fx.assetFace.id),
        sut.confirmSpacePersonFaceSuggestion(authFor(fx.reviewer), fx.space.id, fx.spacePerson.id, fx.assetFace.id),
      ]);

      // Whichever call wins the claim writes the link; the other finds claimed === 0 (either at the outer
      // hasPendingForSpacePerson gate or the inner claimed check) and never reaches replaceFaceIdentity again.
      expect(replaceFaceIdentitySpy).toHaveBeenCalledTimes(1);

      const links = await ctx.database
        .selectFrom('face_identity_face')
        .select('assetFaceId')
        .where('assetFaceId', '=', fx.assetFace.id)
        .execute();
      expect(links).toHaveLength(1); // positive control: the winning call's write is still there, exactly once

      const sspfRows = await ctx.database
        .selectFrom('shared_space_person_face')
        .select('assetFaceId')
        .where('personId', '=', fx.spacePerson.id)
        .where('assetFaceId', '=', fx.assetFace.id)
        .execute();
      expect(sspfRows).toHaveLength(1);
    });
  });
});
