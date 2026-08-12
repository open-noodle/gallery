import { Kysely } from 'kysely';
import { SourceType } from 'src/enum';
import { FaceIdentityRepository } from 'src/repositories/face-identity.repository';
import { FacePersonVerdictRepository } from 'src/repositories/face-person-verdict.repository';
import { FaceRepairDeclineRepository } from 'src/repositories/face-repair-decline.repository';
import { LoggingRepository } from 'src/repositories/logging.repository';
import { PersonRepository } from 'src/repositories/person.repository';
import { DB } from 'src/schema';
import { BaseService } from 'src/services/base.service';
import { newMediumService } from 'test/medium.factory';
import { getKyselyDB } from 'test/utils';

// Temporal consistency across a person merge or hard delete.
//
// This used to require bespoke re-pointing machinery in `mergePersonProfile`, because both durable Face
// Cleanup facts were keyed by `person` with ON DELETE CASCADE: merging a person away silently wiped the
// lock or decline, and the face resurfaced on the very next scan.
//
// The unified verdict layer removes that class of bug structurally rather than patching it:
//   - a human placement is `face_identity_face.source='manual'`, keyed by IDENTITY, which the merge
//     preserves (see face-identity.manual-durability.spec.ts);
//   - a negative verdict stores the target's identity alongside a `personId` that is ON DELETE SET NULL,
//     so the row survives its person and stays matchable by identity.
//
// These tests assert the survival directly, with no re-pointing step involved.
let db: Kysely<DB>;

const setup = () => {
  const { ctx } = newMediumService(BaseService, {
    database: db,
    real: [PersonRepository, FaceIdentityRepository, FacePersonVerdictRepository, FaceRepairDeclineRepository],
    mock: [LoggingRepository],
  });
  return {
    ctx,
    personRepository: ctx.get(PersonRepository),
    faceIdentityRepository: ctx.get(FaceIdentityRepository),
    facePersonVerdictRepository: ctx.get(FacePersonVerdictRepository),
    declineRepository: ctx.get(FaceRepairDeclineRepository),
  };
};

type Ctx = ReturnType<typeof setup>['ctx'];

beforeAll(async () => {
  db = await getKyselyDB();
});

const seedFace = async (ctx: Ctx, ownerId: string, personId: string | null): Promise<string> => {
  const { asset } = await ctx.newAsset({ ownerId });
  const { assetFace } = await ctx.newAssetFace({ assetId: asset.id, personId, sourceType: SourceType.MachineLearning });
  return assetFace.id;
};

const verdictRowFor = (assetFaceId: string) =>
  db
    .selectFrom('face_person_verdict')
    .select(['id', 'personId', 'identityId', 'status'])
    .where('assetFaceId', '=', assetFaceId)
    .executeTakeFirst();

// Two people about to be merged (source into survivor), plus two other people who can stand in as
// "suspected owners" on a cluster mute — `face_repair_decline.suspectedOwnerIds` just needs valid person
// ids, not any particular relationship to source/survivor.
const seedTwoPeople = async (ctx: Ctx, ownerId: string) => {
  const { person: source } = await ctx.newPerson({ ownerId, name: 'Source' });
  const { person: survivor } = await ctx.newPerson({ ownerId, name: 'Survivor' });
  const { person: ownerA } = await ctx.newPerson({ ownerId, name: 'Owner A' });
  const { person: ownerB } = await ctx.newPerson({ ownerId, name: 'Owner B' });
  return { source, survivor, ownerA, ownerB };
};

describe('face verdicts survive person delete/merge without re-pointing', () => {
  it('keeps a negative verdict, keyed by identity, when its target person is hard-deleted', async () => {
    const { ctx, personRepository, faceIdentityRepository, facePersonVerdictRepository } = setup();
    const { user } = await ctx.newUser();
    const { person: owner } = await ctx.newPerson({ ownerId: user.id, name: 'Suspected' });
    const faceId = await seedFace(ctx, user.id, null);

    const identity = await faceIdentityRepository.ensurePersonIdentity(owner.id);
    await facePersonVerdictRepository.markRejected(owner.id, faceId, {
      identityId: identity.id,
      source: 'cleanup',
      actorId: user.id,
    });

    await personRepository.delete([owner.id]);

    const row = await verdictRowFor(faceId);
    expect(row).toBeDefined();
    expect(row?.status).toBe('rejected');
    // The person reference falls away; the identity key is what keeps the verdict usable.
    expect(row?.personId).toBeNull();
    expect(row?.identityId).toBe(identity.id);

    const tokens = await facePersonVerdictRepository.getNegativeVerdictTokens([faceId]);
    expect(tokens.get(faceId)).toContain(`identity:${identity.id}`);
  });

  it('keeps a human placement through a merge, so the face is still settled afterwards', async () => {
    const { ctx, personRepository, faceIdentityRepository } = setup();
    const { user } = await ctx.newUser();
    const { person: source } = await ctx.newPerson({ ownerId: user.id, name: 'Anna' });
    const { person: target } = await ctx.newPerson({ ownerId: user.id, name: 'Anna dup' });
    const faceId = await seedFace(ctx, user.id, source.id);

    const sourceIdentity = await faceIdentityRepository.ensurePersonIdentity(source.id);
    await faceIdentityRepository.replaceFaceIdentity({
      assetFaceId: faceId,
      identityId: sourceIdentity.id,
      source: 'manual',
    });

    const targetIdentity = await faceIdentityRepository.ensurePersonIdentity(target.id);
    await personRepository.mergePersonProfile({
      sourcePersonId: source.id,
      targetPersonId: target.id,
      targetIdentityId: targetIdentity.id,
    });

    const settled = await faceIdentityRepository.getManualLinkedFaceIds([faceId]);
    expect(settled.has(faceId)).toBe(true);
  });

  it('keeps a negative verdict through a merge of its target person', async () => {
    const { ctx, personRepository, faceIdentityRepository, facePersonVerdictRepository } = setup();
    const { user } = await ctx.newUser();
    const { person: source } = await ctx.newPerson({ ownerId: user.id, name: 'Bob' });
    const { person: target } = await ctx.newPerson({ ownerId: user.id, name: 'Bob dup' });
    const faceId = await seedFace(ctx, user.id, null);

    const sourceIdentity = await faceIdentityRepository.ensurePersonIdentity(source.id);
    await facePersonVerdictRepository.markRejected(source.id, faceId, {
      identityId: sourceIdentity.id,
      source: 'cleanup',
      actorId: user.id,
    });

    const targetIdentity = await faceIdentityRepository.ensurePersonIdentity(target.id);
    await personRepository.mergePersonProfile({
      sourcePersonId: source.id,
      targetPersonId: target.id,
      targetIdentityId: targetIdentity.id,
    });

    const row = await verdictRowFor(faceId);
    expect(row).toBeDefined();
    expect(row?.status).toBe('rejected');
  });
});

// H10: `face_repair_decline.personId` is ON DELETE CASCADE (unlike the SET NULL FK the verdict tests above
// rely on), so a bare merge silently destroys the console's cluster mute along with the source person row —
// the muted cluster resurfaces on the very next scan. A person carries AT MOST ONE `type='person'` row
// (createClusterMutes deletes-then-inserts), so retargetDeclinePersonId only has three cases to get right.
describe('cluster mutes survive a person merge', () => {
  it('carries a cluster mute onto the survivor when its person is merged away', async () => {
    const { ctx, personRepository, faceIdentityRepository, declineRepository } = setup();
    const { user } = await ctx.newUser();
    const { source, survivor, ownerA } = await seedTwoPeople(ctx, user.id);

    await declineRepository.createClusterMutes({
      persons: [{ personId: source.id, suspectedOwnerIds: [ownerA.id] }],
      declinedBy: user.id,
    });
    // Positive control: without this, a broken seed produces the same green as a broken merge.
    const before = await declineRepository.getClusterMuteMap([source.id]);
    expect(before.get(source.id)).toEqual(new Set([ownerA.id]));

    const targetIdentity = await faceIdentityRepository.ensurePersonIdentity(survivor.id);
    await personRepository.mergePersonProfile({
      sourcePersonId: source.id,
      targetPersonId: survivor.id,
      targetIdentityId: targetIdentity.id,
    });

    const after = await declineRepository.getClusterMuteMap([survivor.id]);
    expect(after.get(survivor.id)).toEqual(new Set([ownerA.id]));
  });

  // GIVEN both people muted their own cluster, each against a different suspected owner
  // WHEN they are merged
  // THEN the survivor keeps exactly ONE row whose suspected owners are the union of both — the merged
  // cluster now contains both people's faces, so both mutes still apply. Two rows would be worse than the
  // bug this fixes: getClusterMuteMap does a plain `.set()` per row it reads, so which row "wins" would
  // depend on read order rather than being deterministic.
  it('unions the suspected owners when both people muted their clusters', async () => {
    const { ctx, personRepository, faceIdentityRepository, declineRepository } = setup();
    const { user } = await ctx.newUser();
    const { source, survivor, ownerA, ownerB } = await seedTwoPeople(ctx, user.id);

    await declineRepository.createClusterMutes({
      persons: [{ personId: source.id, suspectedOwnerIds: [ownerA.id] }],
      declinedBy: user.id,
    });
    await declineRepository.createClusterMutes({
      persons: [{ personId: survivor.id, suspectedOwnerIds: [ownerB.id] }],
      declinedBy: user.id,
    });
    // Positive control: both mutes really were written before the merge runs.
    const beforeSource = await declineRepository.getClusterMuteMap([source.id]);
    const beforeSurvivor = await declineRepository.getClusterMuteMap([survivor.id]);
    expect(beforeSource.get(source.id)).toEqual(new Set([ownerA.id]));
    expect(beforeSurvivor.get(survivor.id)).toEqual(new Set([ownerB.id]));

    const targetIdentity = await faceIdentityRepository.ensurePersonIdentity(survivor.id);
    await personRepository.mergePersonProfile({
      sourcePersonId: source.id,
      targetPersonId: survivor.id,
      targetIdentityId: targetIdentity.id,
    });

    const rows = await db
      .selectFrom('face_repair_decline')
      .selectAll()
      .where('type', '=', 'person')
      .where('personId', '=', survivor.id)
      .execute();
    expect(rows).toHaveLength(1);
    expect(new Set(rows[0].suspectedOwnerIds as unknown as string[])).toEqual(new Set([ownerA.id, ownerB.id]));
  });

  it('leaves the survivor untouched when only the survivor had a mute', async () => {
    const { ctx, personRepository, faceIdentityRepository, declineRepository } = setup();
    const { user } = await ctx.newUser();
    const { source, survivor, ownerB } = await seedTwoPeople(ctx, user.id);

    await declineRepository.createClusterMutes({
      persons: [{ personId: survivor.id, suspectedOwnerIds: [ownerB.id] }],
      declinedBy: user.id,
    });
    // Positive control
    const before = await declineRepository.getClusterMuteMap([survivor.id]);
    expect(before.get(survivor.id)).toEqual(new Set([ownerB.id]));

    const targetIdentity = await faceIdentityRepository.ensurePersonIdentity(survivor.id);
    await personRepository.mergePersonProfile({
      sourcePersonId: source.id,
      targetPersonId: survivor.id,
      targetIdentityId: targetIdentity.id,
    });

    const after = await declineRepository.getClusterMuteMap([survivor.id]);
    expect(after.get(survivor.id)).toEqual(new Set([ownerB.id]));
  });

  it('is a no-op when neither person had a mute', async () => {
    const { ctx, personRepository, faceIdentityRepository, declineRepository } = setup();
    const { user } = await ctx.newUser();
    const { source, survivor } = await seedTwoPeople(ctx, user.id);

    const targetIdentity = await faceIdentityRepository.ensurePersonIdentity(survivor.id);
    await expect(
      personRepository.mergePersonProfile({
        sourcePersonId: source.id,
        targetPersonId: survivor.id,
        targetIdentityId: targetIdentity.id,
      }),
    ).resolves.not.toThrow();

    const after = await declineRepository.getClusterMuteMap([survivor.id]);
    expect(after.size).toBe(0);
  });
});
