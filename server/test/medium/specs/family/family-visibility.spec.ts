import { Kysely } from 'kysely';
import { randomUUID } from 'node:crypto';
import { AuthDto } from 'src/dtos/auth.dto';
import { AssetVisibility, SharedSpaceRole } from 'src/enum';
import { FaceIdentityRepository } from 'src/repositories/face-identity.repository';
import { FamilyRepository } from 'src/repositories/family.repository';
import { LoggingRepository } from 'src/repositories/logging.repository';
import { DB } from 'src/schema';
import { FamilyService } from 'src/services/family.service';
import { ProjectedFamilyParticipant } from 'src/utils/family-labels';
import { newMediumService } from 'test/medium.factory';
import { getKyselyDB } from 'test/utils';
import { beforeAll, describe, expect, it, vi } from 'vitest';

let db: Kysely<DB>;

beforeAll(async () => {
  db = await getKyselyDB();
});

/** face_identity has no medium.factory helper, so insert directly (mirrors family-write.spec.ts). */
const newIdentity = async (input: { type?: 'person' | 'pet'; gender?: string | null } = {}) => {
  const row = await db
    .insertInto('face_identity')
    .values({ type: input.type ?? 'person', gender: input.gender ?? null })
    .returning('id')
    .executeTakeFirstOrThrow();
  return row.id;
};

const newUser = async () => {
  const row = await db
    .insertInto('user')
    .values({ email: `${randomUUID()}@family-visibility.test`, name: 'Family Visibility Test' })
    .returning('id')
    .executeTakeFirstOrThrow();
  return row.id;
};

const setup = () => {
  const { sut, ctx } = newMediumService(FamilyService, {
    database: db,
    real: [FamilyRepository, FaceIdentityRepository],
    mock: [LoggingRepository],
  });
  // Access control (capability) is covered exhaustively by the unit suite in
  // family.service.spec.ts and is a different layer (D2) from content scoping (D3), which is
  // what this file tests. Bypassing both gates here keeps these tests focused on visibility.
  sut['requireFamilyRead'] = async () => {};
  sut['requireFamilyWrite'] = async () => {};
  return { sut, ctx, faceIdentityRepo: ctx.get(FaceIdentityRepository), familyRepository: ctx.get(FamilyRepository) };
};

const newAuth = async (userId?: string): Promise<AuthDto> => {
  const id = userId ?? (await newUser());
  return { user: { id } } as AuthDto;
};

/** Makes `identityId` resolvable to `viewerId` through the viewer's OWN `person` row — the
 * `E31` path. Builds the full chain `hydrateAccessiblePeople`/`resolveAccessibleIdentityNames`
 * actually requires: an accessible timeline asset with a linked face, plus an owned profile. */
const grantOwnLibraryAccess = async (
  ctx: ReturnType<typeof setup>['ctx'],
  faceIdentityRepo: FaceIdentityRepository,
  input: { viewerId: string; identityId: string; name?: string; isHidden?: boolean },
) => {
  const { asset } = await ctx.newAsset({ ownerId: input.viewerId, visibility: AssetVisibility.Timeline });
  const { assetFace } = await ctx.newAssetFace({ assetId: asset.id });
  await faceIdentityRepo.linkFace({ assetFaceId: assetFace.id, identityId: input.identityId, source: 'owner-person' });
  await ctx.newPerson({
    ownerId: input.viewerId,
    identityId: input.identityId,
    name: input.name ?? 'Test Person',
    isHidden: input.isHidden ?? false,
  });
};

/** Makes `identityId` resolvable to `viewerId` through a `shared_space_person` in a space the
 * viewer belongs to (timeline-enabled) — the `E32` path. `ownerId` owns the space and the asset
 * the profile's representative face lives on. */
const grantSharedSpaceAccess = async (
  ctx: ReturnType<typeof setup>['ctx'],
  faceIdentityRepo: FaceIdentityRepository,
  input: { viewerId: string; ownerId: string; identityId: string; name?: string; isHidden?: boolean },
) => {
  const { space } = await ctx.newSharedSpace({ createdById: input.ownerId });
  await ctx.newSharedSpaceMember({ spaceId: space.id, userId: input.ownerId, role: SharedSpaceRole.Owner });
  await ctx.newSharedSpaceMember({ spaceId: space.id, userId: input.viewerId, role: SharedSpaceRole.Viewer });
  const { asset } = await ctx.newAsset({ ownerId: input.ownerId, visibility: AssetVisibility.Timeline });
  await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: asset.id, addedById: input.ownerId });
  const { assetFace } = await ctx.newAssetFace({ assetId: asset.id });
  await faceIdentityRepo.linkFace({ assetFaceId: assetFace.id, identityId: input.identityId, source: 'owner-person' });
  const spacePerson = await ctx.database
    .insertInto('shared_space_person')
    .values({
      spaceId: space.id,
      identityId: input.identityId,
      representativeFaceId: assetFace.id,
      type: 'person',
      name: input.name ?? 'Test Person',
      isHidden: input.isHidden ?? false,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  await ctx.database
    .insertInto('shared_space_person_face')
    .values({ personId: spacePerson.id, assetFaceId: assetFace.id })
    .execute();

  return { space, spacePerson };
};

const revokeSharedSpaceMembership = async (ctx: ReturnType<typeof setup>['ctx'], spaceId: string, userId: string) => {
  await ctx.database
    .deleteFrom('shared_space_member')
    .where('spaceId', '=', spaceId)
    .where('userId', '=', userId)
    .execute();
};

/** A union with two partners and two children — four independent participants, so tests can
 * grant the viewer access to exactly N of them and observe the threshold rule. Shared by the
 * E27/E28/E29 tests so each is proven on the SAME fixture shape, differing only in grants. */
const createFourPersonUnion = async (sut: FamilyService, auth: AuthDto) => {
  const [partnerA, partnerB, childA, childB] = await Promise.all([
    newIdentity(),
    newIdentity(),
    newIdentity(),
    newIdentity(),
  ]);
  const union = await sut.createUnion(auth, { partnerIds: [partnerA, partnerB], childIds: [childA, childB] });
  return { unionId: union.id, partnerA, partnerB, childA, childB };
};

const isKnown = (participant: ProjectedFamilyParticipant): participant is { kind: 'known'; identityId: string } =>
  participant.kind === 'known';

describe('family relationships — visibility query (real SQL)', () => {
  describe('union visibility', () => {
    // E28. GIVEN a union of two partners with two children WHEN a viewer can resolve only one
    // of the four THEN the union is omitted: one participant says nothing and leaks a headcount.
    it('omits a union when the viewer can resolve only one participant', async () => {
      const { sut, ctx, faceIdentityRepo } = setup();
      const viewerId = await newUser();
      const auth = await newAuth(viewerId);
      const { partnerA } = await createFourPersonUnion(sut, auth);

      await grantOwnLibraryAccess(ctx, faceIdentityRepo, { viewerId, identityId: partnerA });

      const result = await sut.getVisibleGraph(auth);

      expect(result.unions).toHaveLength(0);
      expect(Object.keys(result.identities)).toHaveLength(0);
    });

    // E27 — positive control for the omission above, on the SAME fixture shape: the only
    // difference is that the viewer now also resolves a second participant.
    it('returns that union once the viewer can resolve a second participant', async () => {
      const { sut, ctx, faceIdentityRepo } = setup();
      const viewerId = await newUser();
      const auth = await newAuth(viewerId);
      const { unionId, partnerA, partnerB, childA, childB } = await createFourPersonUnion(sut, auth);

      await grantOwnLibraryAccess(ctx, faceIdentityRepo, { viewerId, identityId: partnerA });
      await grantOwnLibraryAccess(ctx, faceIdentityRepo, { viewerId, identityId: partnerB });

      const result = await sut.getVisibleGraph(auth);

      expect(result.unions).toHaveLength(1);
      const union = result.unions[0]!;
      expect(union.id).toBe(unionId);
      // Participant order within a role is the repository's identity-id order (see
      // RawUnionRow), not creation order — sort the expectation the same way.
      const [firstPartner, secondPartner] = [partnerA, partnerB].sort();
      expect(union.partners).toEqual([
        { kind: 'known', identityId: firstPartner },
        { kind: 'known', identityId: secondPartner },
      ]);
      // The two children remain unresolved and are redacted, not dropped.
      expect(union.children).toEqual([{ kind: 'anonymous' }, { kind: 'anonymous' }]);
      expect(union.children).not.toEqual(expect.arrayContaining([expect.objectContaining({ identityId: childA })]));
      expect(union.children).not.toEqual(expect.arrayContaining([expect.objectContaining({ identityId: childB })]));
    });

    // E29
    it('omits a union when the viewer can resolve none of its participants', async () => {
      const { sut } = setup();
      const auth = await newAuth();
      await createFourPersonUnion(sut, auth);

      const result = await sut.getVisibleGraph(auth);

      expect(result.unions).toHaveLength(0);
    });

    // E31 — own-library resolution alone is sufficient to cross the two-participant threshold.
    it('counts a person the viewer holds only in their own library', async () => {
      const { sut, ctx, faceIdentityRepo } = setup();
      const viewerId = await newUser();
      const auth = await newAuth(viewerId);
      const [partnerA, partnerB] = await Promise.all([newIdentity(), newIdentity()]);
      const union = await sut.createUnion(auth, { partnerIds: [partnerA, partnerB] });

      await grantOwnLibraryAccess(ctx, faceIdentityRepo, { viewerId, identityId: partnerA, name: 'Alice' });
      await grantOwnLibraryAccess(ctx, faceIdentityRepo, { viewerId, identityId: partnerB, name: 'Bob' });

      const result = await sut.getVisibleGraph(auth);

      expect(result.unions).toHaveLength(1);
      expect(result.unions[0]!.id).toBe(union.id);
      expect(result.identities[partnerA]).toEqual({ name: 'Alice', gender: null });
      expect(result.identities[partnerB]).toEqual({ name: 'Bob', gender: null });
    });

    // E32 — mixing one own-library resolution with one shared-space resolution isolates the
    // shared-space contribution: if it didn't count, this union would still be below the
    // threshold and would be omitted by the same rule proven in E28.
    it('counts a person the viewer reaches through a shared space', async () => {
      const { sut, ctx, faceIdentityRepo } = setup();
      const viewerId = await newUser();
      const ownerId = await newUser();
      const auth = await newAuth(viewerId);
      const [partnerA, partnerB] = await Promise.all([newIdentity(), newIdentity()]);
      const union = await sut.createUnion(auth, { partnerIds: [partnerA, partnerB] });

      await grantOwnLibraryAccess(ctx, faceIdentityRepo, { viewerId, identityId: partnerA, name: 'Alice' });
      await grantSharedSpaceAccess(ctx, faceIdentityRepo, { viewerId, ownerId, identityId: partnerB, name: 'Bob' });

      const result = await sut.getVisibleGraph(auth);

      expect(result.unions).toHaveLength(1);
      expect(result.unions[0]!.id).toBe(union.id);
      expect(result.unions[0]!.partners).toEqual(
        expect.arrayContaining([
          { kind: 'known', identityId: partnerA },
          { kind: 'known', identityId: partnerB },
        ]),
      );
    });

    // E33 — proven by flipping the flag on the SAME fixture: hidden first (omitted), then
    // unhidden (visible), with nothing else changed in between.
    it('does not count a hidden person towards the threshold', async () => {
      const { sut, ctx, faceIdentityRepo } = setup();
      const viewerId = await newUser();
      const auth = await newAuth(viewerId);
      const [partnerA, partnerB] = await Promise.all([newIdentity(), newIdentity()]);
      const union = await sut.createUnion(auth, { partnerIds: [partnerA, partnerB] });

      await grantOwnLibraryAccess(ctx, faceIdentityRepo, { viewerId, identityId: partnerA });
      await grantOwnLibraryAccess(ctx, faceIdentityRepo, { viewerId, identityId: partnerB, isHidden: true });

      const hiddenResult = await sut.getVisibleGraph(auth);
      expect(hiddenResult.unions).toHaveLength(0);

      // Flip the flag — same fixture, same union, same two identities.
      await ctx.database
        .updateTable('person')
        .set({ isHidden: false })
        .where('ownerId', '=', viewerId)
        .where('identityId', '=', partnerB)
        .execute();

      const unhiddenResult = await sut.getVisibleGraph(auth);
      expect(unhiddenResult.unions).toHaveLength(1);
      expect(unhiddenResult.unions[0]!.id).toBe(union.id);
    });

    // E34 — proven the same way: visible while a member, gone the next read after leaving.
    it('hides a previously visible union after the viewer leaves the space', async () => {
      const { sut, ctx, faceIdentityRepo } = setup();
      const viewerId = await newUser();
      const ownerId = await newUser();
      const auth = await newAuth(viewerId);
      const [partnerA, partnerB] = await Promise.all([newIdentity(), newIdentity()]);
      const union = await sut.createUnion(auth, { partnerIds: [partnerA, partnerB] });

      await grantOwnLibraryAccess(ctx, faceIdentityRepo, { viewerId, identityId: partnerA });
      const { space } = await grantSharedSpaceAccess(ctx, faceIdentityRepo, {
        viewerId,
        ownerId,
        identityId: partnerB,
      });

      const beforeLeaving = await sut.getVisibleGraph(auth);
      expect(beforeLeaving.unions).toHaveLength(1);
      expect(beforeLeaving.unions[0]!.id).toBe(union.id);

      await revokeSharedSpaceMembership(ctx, space.id, viewerId);

      const afterLeaving = await sut.getVisibleGraph(auth);
      expect(afterLeaving.unions).toHaveLength(0);
    });
  });

  describe('redaction', () => {
    // E30 — security. A leaked identityId lets a client correlate the same hidden person across
    // unions and reconstruct what redaction withholds.
    it('never returns the identity id of a participant the viewer cannot resolve', async () => {
      const { sut, ctx, faceIdentityRepo } = setup();
      const viewerId = await newUser();
      const auth = await newAuth(viewerId);
      const [partnerA, partnerB] = await Promise.all([newIdentity(), newIdentity()]);
      const anton = await newIdentity();
      await sut.createUnion(auth, { partnerIds: [partnerA, partnerB], childIds: [anton] });

      await grantOwnLibraryAccess(ctx, faceIdentityRepo, { viewerId, identityId: partnerA });
      await grantOwnLibraryAccess(ctx, faceIdentityRepo, { viewerId, identityId: partnerB });

      const result = await sut.getVisibleGraph(auth);

      expect(result.unions).toHaveLength(1);
      expect(JSON.stringify(result)).not.toContain(anton);
    });

    // Repeated calls against the identical, unchanged fixture must keep every anonymous seat at
    // the same array position — never reshuffled between reads.
    it('returns a stable opaque slot for each unresolvable participant', async () => {
      const { sut, ctx, faceIdentityRepo } = setup();
      const viewerId = await newUser();
      const auth = await newAuth(viewerId);
      const [partnerA, partnerB, childKnown] = await Promise.all([newIdentity(), newIdentity(), newIdentity()]);
      const childUnknown = await newIdentity();
      await sut.createUnion(auth, { partnerIds: [partnerA, partnerB], childIds: [childKnown, childUnknown] });

      await grantOwnLibraryAccess(ctx, faceIdentityRepo, { viewerId, identityId: partnerA });
      await grantOwnLibraryAccess(ctx, faceIdentityRepo, { viewerId, identityId: partnerB });
      await grantOwnLibraryAccess(ctx, faceIdentityRepo, { viewerId, identityId: childKnown });

      const first = await sut.getVisibleGraph(auth);
      const second = await sut.getVisibleGraph(auth);

      expect(first.unions[0]!.children).toEqual(second.unions[0]!.children);
      // Both calls must place the resolvable child ahead of the anonymous one (ordered by
      // identity id at the repository layer — see RawUnionRow), never shuffled between reads.
      const expectedOrder =
        childKnown < childUnknown
          ? [{ kind: 'known', identityId: childKnown }, { kind: 'anonymous' }]
          : [{ kind: 'anonymous' }, { kind: 'known', identityId: childKnown }];
      expect(first.unions[0]!.children).toEqual(expectedOrder);
    });

    // Positive control for E30/the redaction tests above — a resolvable participant DOES come
    // back with its real id.
    it('returns the real identity id for a participant the viewer can resolve', async () => {
      const { sut, ctx, faceIdentityRepo } = setup();
      const viewerId = await newUser();
      const auth = await newAuth(viewerId);
      const [partnerA, partnerB] = await Promise.all([newIdentity(), newIdentity()]);
      await sut.createUnion(auth, { partnerIds: [partnerA, partnerB] });

      await grantOwnLibraryAccess(ctx, faceIdentityRepo, { viewerId, identityId: partnerA, name: 'Alice' });
      await grantOwnLibraryAccess(ctx, faceIdentityRepo, { viewerId, identityId: partnerB, name: 'Bob' });

      const result = await sut.getVisibleGraph(auth);

      const knownIds = result.unions[0]!.partners.filter(isKnown).map((participant) => participant.identityId);
      expect(knownIds.sort()).toEqual([partnerA, partnerB].sort());
    });
  });

  describe('cluster detection', () => {
    // E63/E64
    it('reports two families as separate clusters when nothing joins them', async () => {
      const { sut, ctx, faceIdentityRepo } = setup();
      const viewerId = await newUser();
      const auth = await newAuth(viewerId);
      const [a1, b1, a2, b2] = await Promise.all([newIdentity(), newIdentity(), newIdentity(), newIdentity()]);
      await sut.createUnion(auth, { partnerIds: [a1, b1] });
      await sut.createUnion(auth, { partnerIds: [a2, b2] });

      await Promise.all(
        [a1, b1, a2, b2].map((identityId) => grantOwnLibraryAccess(ctx, faceIdentityRepo, { viewerId, identityId })),
      );

      const clusters = await sut.getClusters(auth);

      expect(clusters).toHaveLength(2);
      expect(clusters.every((cluster) => cluster.size === 2)).toBe(true);
      // Cluster order is not meaningful — find each family by which root it produced instead
      // of assuming an index. Each root belongs to exactly one of the two families, never both.
      const family1Cluster = clusters.find((cluster) => [a1, b1].includes(cluster.rootCandidateId));
      const family2Cluster = clusters.find((cluster) => [a2, b2].includes(cluster.rootCandidateId));
      expect(family1Cluster).toBeDefined();
      expect(family2Cluster).toBeDefined();
      expect(family1Cluster).not.toBe(family2Cluster);
    });

    // E64 — same two families as above, now joined by a third union that bridges them.
    it('reports one cluster once a union joins two previously separate families', async () => {
      const { sut, ctx, faceIdentityRepo } = setup();
      const viewerId = await newUser();
      const auth = await newAuth(viewerId);
      const [a1, b1, a2, b2] = await Promise.all([newIdentity(), newIdentity(), newIdentity(), newIdentity()]);
      await sut.createUnion(auth, { partnerIds: [a1, b1] });
      await sut.createUnion(auth, { partnerIds: [a2, b2] });

      await Promise.all(
        [a1, b1, a2, b2].map((identityId) => grantOwnLibraryAccess(ctx, faceIdentityRepo, { viewerId, identityId })),
      );

      const before = await sut.getClusters(auth);
      expect(before).toHaveLength(2);

      // A bridging union: b1 (family 1) and a2 (family 2) form a new couple.
      await sut.createUnion(auth, { partnerIds: [b1, a2] });

      const after = await sut.getClusters(auth);

      expect(after).toHaveLength(1);
      expect(after[0]!.size).toBe(4);
      expect([a1, b1, a2, b2]).toContain(after[0]!.rootCandidateId);
    });

    // E63 — a standalone resolvable person with no union at all must never spawn a cluster of
    // their own, and must never crash cluster detection (checked first, with no unions at all).
    it('omits a person who belongs to no union from every cluster', async () => {
      const { sut, ctx, faceIdentityRepo } = setup();
      const viewerId = await newUser();
      const auth = await newAuth(viewerId);
      const standalone = await newIdentity();
      await grantOwnLibraryAccess(ctx, faceIdentityRepo, { viewerId, identityId: standalone });

      // No unions exist yet at all — must not crash, must return no clusters.
      await expect(sut.getClusters(auth)).resolves.toEqual([]);

      const [partnerA, partnerB] = await Promise.all([newIdentity(), newIdentity()]);
      await sut.createUnion(auth, { partnerIds: [partnerA, partnerB] });
      await grantOwnLibraryAccess(ctx, faceIdentityRepo, { viewerId, identityId: partnerA });
      await grantOwnLibraryAccess(ctx, faceIdentityRepo, { viewerId, identityId: partnerB });

      const clusters = await sut.getClusters(auth);

      expect(clusters).toHaveLength(1);
      expect(clusters[0]!.size).toBe(2);
      expect(clusters[0]!.rootCandidateId).not.toBe(standalone);
    });
  });

  describe('scale (E65)', () => {
    // Several hundred unions in the graph. Profile resolution must run as ONE query regardless —
    // an N+1 here would reproduce the documented JIT-driven slowness on a similar people-page
    // join. Assert the query COUNT, never elapsed time (timing assertions flake in CI).
    it('resolves several hundred unions worth of participants in a single query', async () => {
      const { sut, ctx, familyRepository, faceIdentityRepo } = setup();
      const viewerId = await newUser();
      const auth = await newAuth(viewerId);

      const unionCount = 300;
      const identityRows = await db
        .insertInto('face_identity')
        .values(Array.from({ length: unionCount * 2 }, () => ({ type: 'person' as const })))
        .returning('id')
        .execute();
      const identityIds = identityRows.map((row) => row.id);

      const unionRows = await db
        .insertInto('family_union')
        .values(Array.from({ length: unionCount }, () => ({ startDate: null })))
        .returning('id')
        .execute();

      const partnerRows = unionRows.flatMap((row, index) => [
        { unionId: row.id, identityId: identityIds[index * 2]! },
        { unionId: row.id, identityId: identityIds[index * 2 + 1]! },
      ]);
      await db.insertInto('family_union_partner').values(partnerRows).execute();

      // Grant the viewer access to exactly the pair backing the first union, so the
      // resolution logic still has real work to do amid the large unresolved pool.
      await grantOwnLibraryAccess(ctx, faceIdentityRepo, { viewerId, identityId: identityIds[0]! });
      await grantOwnLibraryAccess(ctx, faceIdentityRepo, { viewerId, identityId: identityIds[1]! });

      const resolveSpy = vi.spyOn(faceIdentityRepo, 'resolveAccessibleIdentityNames');
      const unionsSpy = vi.spyOn(familyRepository, 'getAllUnionsWithParticipants');

      const result = await sut.getVisibleGraph(auth);

      expect(resolveSpy).toHaveBeenCalledTimes(1);
      expect(unionsSpy).toHaveBeenCalledTimes(1);
      expect(result.unions).toHaveLength(1);
      expect(result.unions[0]!.id).toBe(unionRows[0]!.id);
    });
  });
});
