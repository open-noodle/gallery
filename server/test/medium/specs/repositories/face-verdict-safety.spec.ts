import { Kysely } from 'kysely';
import { AssetVisibility, JobStatus, SourceType, SystemMetadataKey } from 'src/enum';
import { AccessRepository } from 'src/repositories/access.repository';
import { AssetRepository } from 'src/repositories/asset.repository';
import { ConfigRepository } from 'src/repositories/config.repository';
import { DatabaseRepository } from 'src/repositories/database.repository';
import { FaceIdentityRepository } from 'src/repositories/face-identity.repository';
import { FacePersonVerdictRepository } from 'src/repositories/face-person-verdict.repository';
import { JobRepository } from 'src/repositories/job.repository';
import { LoggingRepository } from 'src/repositories/logging.repository';
import { MachineLearningRepository } from 'src/repositories/machine-learning.repository';
import { PersonRepository } from 'src/repositories/person.repository';
import { SearchRepository } from 'src/repositories/search.repository';
import { SharedSpaceRepository } from 'src/repositories/shared-space.repository';
import { StorageRepository } from 'src/repositories/storage.repository';
import { SystemMetadataRepository } from 'src/repositories/system-metadata.repository';
import { DB } from 'src/schema';
import { BaseService } from 'src/services/base.service';
import { PersonService } from 'src/services/person.service';
import { clearConfigCache } from 'src/utils/config';
import { newMediumService } from 'test/medium.factory';
import { newEmbedding } from 'test/small.factory';
import { getKyselyDB } from 'test/utils';

// Slice 6: the two source-of-truth safety fixes.
//   1. searchFaces must exclude soft-deleted faces (the "not a face" tombstone), so neither the suggestion
//      scan nor recognition ever picks a crop a human already declared not-a-face.
//   2. unassignFaces ("reset all people") must clear the human-placement record too, so a library-wide
//      reset does not leave every previously-confirmed face permanently excluded from both engines.
let db: Kysely<DB>;

const setup = () => {
  const { ctx } = newMediumService(BaseService, {
    database: db,
    real: [SearchRepository, PersonRepository, FaceIdentityRepository],
    mock: [LoggingRepository],
  });
  return {
    ctx,
    searchRepository: ctx.get(SearchRepository),
    personRepository: ctx.get(PersonRepository),
    faceIdentityRepository: ctx.get(FaceIdentityRepository),
  };
};

type Ctx = ReturnType<typeof setup>['ctx'];

beforeAll(async () => {
  db = await getKyselyDB();
});

// Seed a face with a real face_search embedding so it is a genuine searchFaces candidate.
const seedSearchableFace = async (
  ctx: Ctx,
  input: { ownerId: string; personId: string | null; embedding: string },
): Promise<string> => {
  const { asset } = await ctx.newAsset({ ownerId: input.ownerId });
  const { assetFace } = await ctx.newAssetFace({
    assetId: asset.id,
    personGroupId: input.personId,
    sourceType: SourceType.MachineLearning,
  });
  await ctx.database.insertInto('face_search').values({ faceId: assetFace.id, embedding: input.embedding }).execute();
  return assetFace.id;
};

describe('searchFaces excludes soft-deleted faces', () => {
  it('does not return a face whose asset_face.deletedAt is set', async () => {
    const { ctx, searchRepository } = setup();
    const { user } = await ctx.newUser();
    const embedding = newEmbedding();

    const liveFace = await seedSearchableFace(ctx, { ownerId: user.id, personId: null, embedding });
    const tombstonedFace = await seedSearchableFace(ctx, { ownerId: user.id, personId: null, embedding });
    await ctx.database
      .updateTable('asset_face')
      .set({ deletedAt: new Date() })
      .where('id', '=', tombstonedFace)
      .execute();

    const results = await searchRepository.searchFaces({
      userIds: [user.id],
      embedding,
      numResults: 10,
      maxDistance: 2,
      hasPerson: false,
    });

    const ids = results.map((r) => r.id);
    expect(ids).toContain(liveFace);
    expect(ids).not.toContain(tombstonedFace);
  });
});

describe('unassignFaces clears human placements', () => {
  it('removes every manual identity link so no face stays falsely settled', async () => {
    const { ctx, personRepository, faceIdentityRepository } = setup();
    const { user } = await ctx.newUser();
    const { person } = await ctx.newPerson({ ownerId: user.id, name: 'Anna' });
    const { asset } = await ctx.newAsset({ ownerId: user.id });
    const { assetFace } = await ctx.newAssetFace({
      assetId: asset.id,
      personGroupId: person.personGroupId,
      sourceType: SourceType.MachineLearning,
    });

    const identity = await faceIdentityRepository.ensurePersonIdentity(person.personGroupId);
    await faceIdentityRepository.replaceFaceIdentity({
      assetFaceId: assetFace.id,
      identityId: identity.id,
      source: 'manual',
    });
    const linkedBefore = await faceIdentityRepository.getManualLinkedFaceIds([assetFace.id]);
    expect(linkedBefore.has(assetFace.id)).toBe(true);

    await personRepository.unassignFaces({ sourceType: SourceType.MachineLearning });

    // The face is unassigned AND no longer carries a human-placement record.
    const face = await db
      .selectFrom('asset_face')
      .select('personGroupId')
      .where('id', '=', assetFace.id)
      .executeTakeFirstOrThrow();
    expect(face.personId).toBeNull();
    const linkedAfter = await faceIdentityRepository.getManualLinkedFaceIds([assetFace.id]);
    expect(linkedAfter.has(assetFace.id)).toBe(false);
  });

  it('unassigns only faces of the given source type, leaving other-source faces and their identity links untouched', async () => {
    // `unassignFaces` returns Promise<void>, so `resolves.toBeUndefined()` alone (the old body of this test)
    // can never fail for any non-throwing implementation, including a complete no-op or one that ignores
    // `sourceType` entirely. It was also unscoped — it ran against the whole shared medium database with
    // nothing seeded, which could perturb sibling specs. This version seeds two faces of DIFFERENT source
    // types under a fresh user (so it cannot leak into sibling specs), calls unassignFaces scoped to ONE of
    // them, and asserts the untouched source type is a genuine, checked control — not merely unperturbed by
    // accident.
    const { ctx, personRepository, faceIdentityRepository } = setup();
    const { user } = await ctx.newUser();

    const { person: mlPerson } = await ctx.newPerson({ ownerId: user.id, name: 'ML Person' });
    const { asset: mlAsset } = await ctx.newAsset({ ownerId: user.id });
    const { assetFace: mlFace } = await ctx.newAssetFace({
      assetId: mlAsset.id,
      personGroupId: mlPerson.personGroupId,
      sourceType: SourceType.MachineLearning,
    });
    const mlIdentity = await faceIdentityRepository.ensurePersonIdentity(mlPerson.personGroupId);
    await faceIdentityRepository.replaceFaceIdentity({
      assetFaceId: mlFace.id,
      identityId: mlIdentity.id,
      source: 'manual',
    });

    const { person: manualPerson } = await ctx.newPerson({ ownerId: user.id, name: 'Manual Person' });
    const { asset: manualAsset } = await ctx.newAsset({ ownerId: user.id });
    const { assetFace: manualFace } = await ctx.newAssetFace({
      assetId: manualAsset.id,
      personGroupId: manualPerson.personGroupId,
      sourceType: SourceType.Manual,
    });
    const manualIdentity = await faceIdentityRepository.ensurePersonIdentity(manualPerson.personGroupId);
    await faceIdentityRepository.replaceFaceIdentity({
      assetFaceId: manualFace.id,
      identityId: manualIdentity.id,
      source: 'manual',
    });

    // Positive controls: both faces are genuinely assigned + linked before the call.
    const mlLinkedBefore = await faceIdentityRepository.getManualLinkedFaceIds([mlFace.id]);
    expect(mlLinkedBefore.has(mlFace.id)).toBe(true);
    const manualLinkedBefore = await faceIdentityRepository.getManualLinkedFaceIds([manualFace.id]);
    expect(manualLinkedBefore.has(manualFace.id)).toBe(true);

    await personRepository.unassignFaces({ sourceType: SourceType.MachineLearning });

    // The ML face is unassigned and its human-placement record is gone.
    const mlAfter = await db
      .selectFrom('asset_face')
      .select('personGroupId')
      .where('id', '=', mlFace.id)
      .executeTakeFirstOrThrow();
    expect(mlAfter.personId).toBeNull();
    const mlLinkedAfter = await faceIdentityRepository.getManualLinkedFaceIds([mlFace.id]);
    expect(mlLinkedAfter.has(mlFace.id)).toBe(false);

    // The non-ML (Manual) face is completely untouched — still assigned, link intact.
    const manualAfter = await db
      .selectFrom('asset_face')
      .select('personGroupId')
      .where('id', '=', manualFace.id)
      .executeTakeFirstOrThrow();
    expect(manualAfter.personId).toBe(manualPerson.personGroupId);
    const manualLinkedAfter = await faceIdentityRepository.getManualLinkedFaceIds([manualFace.id]);
    expect(manualLinkedAfter.has(manualFace.id)).toBe(true);
  });
});

// Slice 8 (F16): "reset all people" — the one production flow that runs deleteUnreferencedIdentities — must
// leave no fully-orphaned face_person_verdict row behind, while rows that still have a live target survive.
const setupReset = () => {
  clearConfigCache();

  const { sut, ctx } = newMediumService(PersonService, {
    database: db,
    real: [
      AccessRepository,
      AssetRepository,
      ConfigRepository,
      DatabaseRepository,
      FaceIdentityRepository,
      FacePersonVerdictRepository,
      PersonRepository,
      SharedSpaceRepository,
    ],
    mock: [JobRepository, LoggingRepository, MachineLearningRepository, StorageRepository, SystemMetadataRepository],
  });

  const jobMock = ctx.getMock(JobRepository);
  jobMock.waitForQueueCompletion.mockResolvedValue();
  jobMock.empty.mockResolvedValue();
  jobMock.queue.mockResolvedValue();
  jobMock.queueAll.mockResolvedValue();
  jobMock.getJobCounts.mockResolvedValue({ active: 0, waiting: 0, delayed: 0, paused: 0, completed: 0, failed: 0 });

  const metadata = ctx.getMock(SystemMetadataRepository);
  metadata.get.mockImplementation((key) => {
    if (key === SystemMetadataKey.SystemConfig) {
      return { machineLearning: { facialRecognition: { enabled: true, minFaces: 1 } } } as any;
    }
    return undefined as any;
  });
  metadata.set.mockResolvedValue();

  return { sut, ctx };
};

describe('S8.8 — a forced reset leaves no fully-orphaned verdict, and rows with a live target survive', () => {
  it('BDD: given verdicts of every shape, when a forced recognition run completes (unassignFaces -> handlePersonCleanup -> deleteUnreferencedIdentities), then no fully-orphaned row survives and rows with a live target do', async () => {
    const { sut: person, ctx } = setupReset();
    const verdictRepository = ctx.get(FacePersonVerdictRepository);
    const faceIdentityRepository = ctx.get(FaceIdentityRepository);
    const { user } = await ctx.newUser();

    const anyRowFor = async (assetFaceId: string) => {
      const row = await ctx.database
        .selectFrom('face_person_verdict')
        .select('id')
        .where('assetFaceId', '=', assetFaceId)
        .executeTakeFirst();
      return row !== undefined;
    };

    // Shape 1: already fully orphaned BEFORE the run starts (personId/spacePersonId/identityId all NULL) —
    // proves the reaper sweeps pre-existing orphans, not just ones freshly created by this run.
    const { asset: preOrphanAsset } = await ctx.newAsset({ ownerId: user.id, visibility: AssetVisibility.Timeline });
    const { assetFace: preOrphanFace } = await ctx.newAssetFace({
      assetId: preOrphanAsset.id,
      personGroupId: null,
      sourceType: SourceType.MachineLearning,
    });
    await ctx.database
      .insertInto('face_person_verdict')
      .values({
        assetFaceId: preOrphanFace.id,
        personId: null,
        spacePersonId: null,
        identityId: null,
        status: 'rejected',
        source: 'cleanup',
      })
      .execute();

    // Shapes 2 & 3: `doomed` has exactly one ML face — unassignFaces empties it, handlePersonCleanup deletes
    // it as faceless, and its identity (referenced by nothing else) becomes GC-eligible in the same run.
    // Shape 2 is personId-keyed (against `doomed`), shape 3 is identityId-only, both riding the same identity
    // down to fully orphaned.
    const { person: doomed } = await ctx.newPerson({ ownerId: user.id, name: 'Doomed' });
    const doomedIdentity = await faceIdentityRepository.ensurePersonIdentity(doomed.personGroupId);
    const { asset: doomedAsset } = await ctx.newAsset({ ownerId: user.id, visibility: AssetVisibility.Timeline });
    await ctx.newAssetFace({ assetId: doomedAsset.id, personGroupId: doomed.personGroupId, sourceType: SourceType.MachineLearning });

    const { asset: personOnlyAsset } = await ctx.newAsset({ ownerId: user.id, visibility: AssetVisibility.Timeline });
    const { assetFace: personOnlyFace } = await ctx.newAssetFace({
      assetId: personOnlyAsset.id,
      personGroupId: null,
      sourceType: SourceType.MachineLearning,
    });
    await verdictRepository.markRejected(doomed.personGroupId, personOnlyFace.id, {
      identityId: doomedIdentity.id,
      source: 'cleanup',
      actorId: user.id,
    });

    const { asset: identityOnlyAsset } = await ctx.newAsset({ ownerId: user.id, visibility: AssetVisibility.Timeline });
    const { assetFace: identityOnlyFace } = await ctx.newAssetFace({
      assetId: identityOnlyAsset.id,
      personGroupId: null,
      sourceType: SourceType.MachineLearning,
    });
    await ctx.database
      .insertInto('face_person_verdict')
      .values({
        assetFaceId: identityOnlyFace.id,
        personId: null,
        spacePersonId: null,
        identityId: doomedIdentity.id,
        status: 'ignored',
        source: 'suggestion',
      })
      .execute();

    // Shape 4: spacePersonId-only. A forced recognition run wipes EVERY shared_space_person row
    // unconditionally (not just faceless ones), so this always degrades — here to fully orphaned, since
    // nothing else references it.
    const { space } = await ctx.newSharedSpace({ createdById: user.id });
    const spacePerson = await ctx.database
      .insertInto('shared_space_person')
      .values({ spaceId: space.id, name: 'Space Person' })
      .returningAll()
      .executeTakeFirstOrThrow();
    const { asset: spaceOnlyAsset } = await ctx.newAsset({ ownerId: user.id, visibility: AssetVisibility.Timeline });
    const { assetFace: spaceOnlyFace } = await ctx.newAssetFace({
      assetId: spaceOnlyAsset.id,
      personGroupId: null,
      sourceType: SourceType.MachineLearning,
    });
    await verdictRepository.markRejectedForSpacePerson(spacePerson.id, spaceOnlyFace.id);

    // Shape 5 (positive control — a LIVE target): `live` keeps a non-ML face, so unassignFaces (scoped to
    // MachineLearning) never empties it and handlePersonCleanup never deletes it — its verdict row's
    // personId stays live through the whole run.
    const { person: live } = await ctx.newPerson({ ownerId: user.id, name: 'Live' });
    const { asset: liveAsset } = await ctx.newAsset({ ownerId: user.id, visibility: AssetVisibility.Timeline });
    await ctx.newAssetFace({ assetId: liveAsset.id, personGroupId: live.personGroupId, sourceType: SourceType.Manual });
    const { assetFace: liveTargetFace } = await ctx.newAssetFace({
      assetId: liveAsset.id,
      personGroupId: null,
      sourceType: SourceType.MachineLearning,
    });
    await verdictRepository.markRejected(live.personGroupId, liveTargetFace.id, { source: 'cleanup', actorId: user.id });

    // Positive controls: every one of the five rows exists before the run.
    for (const faceId of [
      preOrphanFace.id,
      personOnlyFace.id,
      identityOnlyFace.id,
      spaceOnlyFace.id,
      liveTargetFace.id,
    ]) {
      expect(await anyRowFor(faceId)).toBe(true);
    }

    await expect(person.handleQueueRecognizeFaces({ force: true })).resolves.toBe(JobStatus.Success);

    expect(await anyRowFor(preOrphanFace.id)).toBe(false); // pre-existing orphan collected
    expect(await anyRowFor(personOnlyFace.id)).toBe(false); // personId degraded to orphaned -> collected
    expect(await anyRowFor(identityOnlyFace.id)).toBe(false); // identityId degraded to orphaned -> collected
    expect(await anyRowFor(spaceOnlyFace.id)).toBe(false); // spacePersonId degraded to orphaned -> collected
    expect(await anyRowFor(liveTargetFace.id)).toBe(true); // live target: the row survives
  });
});
