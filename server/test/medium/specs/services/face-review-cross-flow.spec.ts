import { Kysely } from 'kysely';
import { AssetVisibility, JobName, JobStatus, SharedSpaceRole, SourceType, SystemMetadataKey } from 'src/enum';
import { AccessRepository } from 'src/repositories/access.repository';
import { ConfigRepository } from 'src/repositories/config.repository';
import { DatabaseRepository } from 'src/repositories/database.repository';
import { FaceIdentityRepository } from 'src/repositories/face-identity.repository';
import { FacePersonVerdictRepository } from 'src/repositories/face-person-verdict.repository';
import { FaceRepairDeclineRepository } from 'src/repositories/face-repair-decline.repository';
import { FaceRepairScanRepository } from 'src/repositories/face-repair-scan.repository';
import { FaceRepairRepository } from 'src/repositories/face-repair.repository';
import { JobRepository } from 'src/repositories/job.repository';
import { LoggingRepository } from 'src/repositories/logging.repository';
import { PersonRepository } from 'src/repositories/person.repository';
import { SearchRepository } from 'src/repositories/search.repository';
import { SharedSpaceRepository } from 'src/repositories/shared-space.repository';
import { SystemMetadataRepository } from 'src/repositories/system-metadata.repository';
import { DB } from 'src/schema';
import { FaceRepairService } from 'src/services/face-repair.service';
import { FaceSuggestionService } from 'src/services/face-suggestion.service';
import { PersonService } from 'src/services/person.service';
import { SharedSpaceService } from 'src/services/shared-space.service';
import { IFacialRecognitionJob } from 'src/types';
import { clearConfigCache } from 'src/utils/config';
import { MediumTestContext, newMediumService } from 'test/medium.factory';
import { factory } from 'test/small.factory';
import { getKyselyDB } from 'test/utils';
import { Mocked, vi } from 'vitest';

// Slice 7 — cross-flow integration. This is the slice that would have caught every leak in the design's
// defect inventory: it drives BOTH engines against ONE database and asserts that a decision made in one is
// honoured by the other. Each half is unit/medium-tested on its own; here they meet.
//
// The Face Cleanup scan (buildRepairPlan) is a real embedding KNN scan, so "not flagged" means the shared
// verdict layer actually excluded the face, not that a fixture happened to omit it.

// Disjoint-axis embeddings (cosine distance ~1.0) stand in for genuinely different people. Mirrors
// face-repair-e2e.spec.ts.
const axisEmbedding = (axis: 'first' | 'second') => {
  const values = Array.from({ length: 512 }, (_, index) => {
    const inFirstHalf = index < 256;
    return (axis === 'first' ? inFirstHalf : !inFirstHalf) ? 1 : 0;
  });
  return '[' + values.join(',') + ']';
};

const repairParams = {
  dryRun: false as const,
  maxDistance: 0.6,
  voteWindow: 50,
  minFaces: 1,
  voteMargin: 2,
  maxAttributionDistance: 0.35,
  maxFlaggedFraction: 0.5,
};

const planParams = {
  maxDistance: 0.6,
  voteWindow: 50,
  minFaces: 1,
  voteMargin: 2,
  maxAttributionDistance: 0.35,
  maxFlaggedFraction: 0.5,
};

let db: Kysely<DB>;

beforeAll(async () => {
  db = await getKyselyDB();
});

const setupRepair = () => {
  const { ctx, sut } = newMediumService(FaceRepairService, {
    database: db,
    real: [
      FaceRepairRepository,
      FaceRepairScanRepository,
      FaceRepairDeclineRepository,
      FacePersonVerdictRepository,
      SearchRepository,
      PersonRepository,
      FaceIdentityRepository,
      ConfigRepository,
      DatabaseRepository,
      SystemMetadataRepository,
    ],
    mock: [LoggingRepository, JobRepository],
  });
  const jobMock = ctx.getMock<JobRepository, Mocked<JobRepository>>(JobRepository);
  jobMock.isActive.mockResolvedValue(false);
  jobMock.queueAll.mockResolvedValue();
  jobMock.queue.mockResolvedValue();
  return { sut, ctx };
};

const setupPerson = () => {
  const { ctx, sut } = newMediumService(PersonService, {
    database: db,
    real: [
      AccessRepository,
      ConfigRepository,
      DatabaseRepository,
      FaceIdentityRepository,
      FacePersonVerdictRepository,
      PersonRepository,
      SearchRepository,
      SharedSpaceRepository,
    ],
    mock: [JobRepository, LoggingRepository, SystemMetadataRepository],
  });
  const metadata = ctx.getMock<SystemMetadataRepository, Mocked<SystemMetadataRepository>>(SystemMetadataRepository);
  metadata.get.mockResolvedValue({ machineLearning: { facialRecognition: { minFaces: 1 } } } as any);
  const jobs = ctx.getMock<JobRepository, Mocked<JobRepository>>(JobRepository);
  jobs.queue.mockResolvedValue();
  jobs.queueAll.mockResolvedValue();
  // Slice 13: the suggestion engine (confirm/reject/ignore/dismiss, the four suggestion-scan job handlers)
  // moved to FaceSuggestionService. This shares `ctx`'s exact dependency instances — same mocked
  // JobRepository/SystemMetadataRepository config, same real repos over the same DB — so a test can seed
  // through `sut` (PersonService) and observe the consequence through `faceSuggestion`, or vice versa.
  const faceSuggestion = ctx.getService(FaceSuggestionService);
  return { sut, ctx, faceSuggestion };
};

// D3 (defect 5) — the suggestion side of the cross-flow: FaceSuggestionService's suggestion-scan handlers
// read `machineLearning.facialRecognition.{maxDistance,suggestions.maxDistance}` via cached getConfig(),
// which setupPerson's mock doesn't provide (it only stubs minFaces, for reassign/confirm's preference
// lookup). Wraps setupPerson unmodified with a full suggestion-band config and a cleared module-level
// config cache so it can't pick up a stale value from a preceding test's mock/DB config.
const SUGGESTION_BAND = { maxDistance: 0.5, minFaces: 1, suggestions: { enabled: true, maxDistance: 0.8 } };

const setupSuggestionPerson = () => {
  clearConfigCache();
  const { sut, ctx, faceSuggestion } = setupPerson();
  ctx
    .getMock<SystemMetadataRepository, Mocked<SystemMetadataRepository>>(SystemMetadataRepository)
    .get.mockResolvedValue({ machineLearning: { facialRecognition: SUGGESTION_BAND } } as any);
  return { sut, ctx, faceSuggestion };
};

const setupSpace = () =>
  newMediumService(SharedSpaceService, {
    database: db,
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

// SharedSpaceService reads config with `withCache: false` (always fresh from the DB), so writing the real
// row here is enough regardless of the personal side's mocked/cached config above.
const enableSpaceSuggestionBand = (ctx: MediumTestContext) =>
  ctx.get(SystemMetadataRepository).set(SystemMetadataKey.SystemConfig, {
    machineLearning: { facialRecognition: SUGGESTION_BAND },
  } as any);

// Bipolar embeddings give an EXACT, reproducible cosine distance (see face-suggestion-exclusions.spec.ts for
// the derivation): 0 flips is the shared "anchor" axis, 180 flips (distance ≈ 0.703) sits inside the open
// suggestion band (0.5, 0.8].
const bipolarEmbedding = (flips: number) =>
  '[' + Array.from({ length: 512 }, (_, index) => (index < flips ? -1 : 1)).join(',') + ']';
const SUGGESTION_ANCHOR = bipolarEmbedding(0);
const SUGGESTION_CANDIDATE = bipolarEmbedding(180);

const seedSuggestionFace = async (
  ctx: MediumTestContext,
  input: { ownerId: string; personId?: string | null; embedding: string },
) => {
  const { asset } = await ctx.newAsset({ ownerId: input.ownerId, visibility: AssetVisibility.Timeline });
  const { assetFace } = await ctx.newAssetFace({
    assetId: asset.id,
    personId: input.personId ?? null,
    sourceType: SourceType.MachineLearning,
  });
  await ctx.database.insertInto('face_search').values({ faceId: assetFace.id, embedding: input.embedding }).execute();
  return { asset, assetFace };
};

const newSuggestionAnchoredPerson = async (ctx: MediumTestContext, ownerId: string, name: string) => {
  const { person } = await ctx.newPerson({ ownerId, name });
  await seedSuggestionFace(ctx, { ownerId, personId: person.id, embedding: SUGGESTION_ANCHOR });
  return person;
};

const newSuggestionSpace = async (ctx: MediumTestContext, ownerId: string) => {
  const { space } = await ctx.newSharedSpace({ createdById: ownerId, faceRecognitionEnabled: true });
  await ctx.newSharedSpaceMember({ spaceId: space.id, userId: ownerId, role: SharedSpaceRole.Owner });
  return space;
};

const newSuggestionAnchoredSpacePerson = async (
  ctx: MediumTestContext,
  input: { spaceId: string; ownerId: string; name: string; identityId?: string | null },
) => {
  const spacePerson = await ctx.database
    .insertInto('shared_space_person')
    .values({
      spaceId: input.spaceId,
      name: input.name,
      type: 'person',
      isHidden: false,
      identityId: input.identityId ?? null,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  const { assetFace: anchor } = await seedSuggestionFace(ctx, { ownerId: input.ownerId, embedding: SUGGESTION_ANCHOR });
  await ctx.get(SharedSpaceRepository).addPersonFaces([{ personId: spacePerson.id, assetFaceId: anchor.id }]);
  return spacePerson;
};

const newSuggestionCandidateFace = (ctx: MediumTestContext, ownerId: string) =>
  seedSuggestionFace(ctx, { ownerId, embedding: SUGGESTION_CANDIDATE });

const pendingFor = async (
  ctx: MediumTestContext,
  column: 'personId' | 'spacePersonId',
  targetId: string,
  assetFaceId: string,
) => {
  const row = await ctx.database
    .selectFrom('face_person_verdict')
    .select('id')
    .where(column, '=', targetId)
    .where('assetFaceId', '=', assetFaceId)
    .where('status', '=', 'pending')
    .executeTakeFirst();
  return row !== undefined;
};

// Slice 8: a rejected/ignored row matched by whichever key the caller supplies.
const negativeExists = async (
  ctx: MediumTestContext,
  column: 'personId' | 'spacePersonId' | 'identityId',
  targetId: string,
  assetFaceId: string,
) => {
  const row = await ctx.database
    .selectFrom('face_person_verdict')
    .select('id')
    .where(column, '=', targetId)
    .where('assetFaceId', '=', assetFaceId)
    .where('status', 'in', ['rejected', 'ignored'])
    .executeTakeFirst();
  return row !== undefined;
};

type RepairCtx = ReturnType<typeof setupRepair>['ctx'];

// A named person with `faceCount` faces on `embedding`, each an ML face with a real face_search vector and
// an owner-person identity link — a clean, backfill-complete cluster.
const buildCluster = async (ctx: RepairCtx, ownerId: string, embedding: string, faceCount: number, name: string) => {
  const faceIdentityRepo = ctx.get(FaceIdentityRepository);
  const { person } = await ctx.newPerson({ ownerId, name });
  const identity = await faceIdentityRepo.ensurePersonIdentity(person.id);
  const faceIds: string[] = [];
  for (let index = 0; index < faceCount; index++) {
    const { asset } = await ctx.newAsset({ ownerId, visibility: AssetVisibility.Timeline });
    const { assetFace } = await ctx.newAssetFace({
      assetId: asset.id,
      personId: person.id,
      sourceType: SourceType.MachineLearning,
    });
    await ctx.database.insertInto('face_search').values({ faceId: assetFace.id, embedding }).execute();
    await faceIdentityRepo.linkFace({ assetFaceId: assetFace.id, identityId: identity.id, source: 'owner-person' });
    faceIds.push(assetFace.id);
  }
  return { person, identity, faceIds };
};

// Attach `count` faces of the given embedding to an existing person (contamination that a cleanup scan will
// flag toward whoever actually owns that embedding).
const leakFacesInto = async (
  ctx: RepairCtx,
  ownerId: string,
  person: { id: string; identityId?: string | null },
  embedding: string,
  count: number,
) => {
  const faceIdentityRepo = ctx.get(FaceIdentityRepository);
  const identity = await faceIdentityRepo.ensurePersonIdentity(person.id);
  const faceIds: string[] = [];
  for (let index = 0; index < count; index++) {
    const { asset } = await ctx.newAsset({ ownerId, visibility: AssetVisibility.Timeline });
    const { assetFace } = await ctx.newAssetFace({
      assetId: asset.id,
      personId: person.id,
      sourceType: SourceType.MachineLearning,
    });
    await ctx.database.insertInto('face_search').values({ faceId: assetFace.id, embedding }).execute();
    await faceIdentityRepo.linkFace({ assetFaceId: assetFace.id, identityId: identity.id, source: 'owner-person' });
    faceIds.push(assetFace.id);
  }
  return faceIds;
};

const flaggedFaceIds = async (repair: FaceRepairService, ownerId: string): Promise<Set<string>> => {
  const plan = await repair.buildRepairPlan({ ownerId, ...planParams });
  return new Set([...plan.toRepair, ...plan.reviewOnlyFaces].map((f) => f.assetFaceId));
};

describe('face review cross-flow: a decision in one engine is honoured by the other', () => {
  // Slice 5 (F9/F10) — the revert chain, traced end to end: a space suggestion confirm never writes
  // asset_face.personId (space people are a projection over personal people), so non-forced recognition's
  // `{ personId: null }` filter alone does not exclude a confirmed-but-still-unassigned face. Without the
  // fix, the next non-forced pass re-queues it, recognition clusters it onto a different (often brand new)
  // personal person and repoints its face_identity_face.identityId, and processSpaceFaceMatch then deletes
  // the confirmed shared_space_person_face row once it sees the identity moved.
  //
  // Placed FIRST in this describe block deliberately: getAllFaces has no owner scoping, so
  // handleQueueRecognizeFaces sweeps the WHOLE asset_face table. Running before the other tests in this file
  // seed their own unassigned faces keeps this test's queued-job set small and its assertions unambiguous.
  describe('Slice 5 — a human placement survives the next recognition pass (F9, F10)', () => {
    it('S5.4/S5.5 — a confirmed space suggestion is not re-queued, re-clustered, or reverted by the next non-forced recognition pass', async () => {
      const { sut: person, ctx } = setupSuggestionPerson();
      const { sut: space, ctx: spaceCtx } = setupSpace();
      await enableSpaceSuggestionBand(spaceCtx);
      const { user: owner } = await ctx.newUser();
      const { user: editor } = await ctx.newUser();
      const editorAuth = factory.auth({ user: editor });

      const s = await newSuggestionSpace(ctx, owner.id);
      await ctx.newSharedSpaceMember({ spaceId: s.id, userId: editor.id, role: SharedSpaceRole.Editor });
      const spaceAnna = await newSuggestionAnchoredSpacePerson(ctx, {
        spaceId: s.id,
        ownerId: owner.id,
        name: 'Space Anna',
      });

      // The face the editor is about to confirm. It sits outside maxDistance (that's WHY it was a
      // suggestion, not an exact match) and its asset must be a real space asset for the confirm's
      // reachability check to accept it.
      const { assetFace: face } = await newSuggestionCandidateFace(ctx, owner.id);
      await ctx.newSharedSpaceAsset({ spaceId: s.id, assetId: face.assetId, addedById: owner.id });

      // A positive control: an ordinary unassigned ML face, never confirmed by anyone. Proves the scan
      // below genuinely queues faces rather than vacuously producing zero jobs.
      const { assetFace: control } = await seedSuggestionFace(ctx, {
        ownerId: owner.id,
        embedding: axisEmbedding('first'),
      });

      const verdictRepo = ctx.get(FacePersonVerdictRepository);
      await verdictRepo.upsertPendingForSpacePerson([
        { spacePersonId: spaceAnna.id, assetFaceId: face.id, distance: 0.6 },
      ]);
      expect(await pendingFor(ctx, 'spacePersonId', spaceAnna.id, face.id)).toBe(true); // positive control: pending row exists before confirm

      // Given: an editor has confirmed F on space person S.
      await space.confirmSpacePersonFaceSuggestion(editorAuth, s.id, spaceAnna.id, face.id);

      const spacePersonAfterConfirm = await ctx.database
        .selectFrom('shared_space_person')
        .select('identityId')
        .where('id', '=', spaceAnna.id)
        .executeTakeFirstOrThrow();
      const confirmedIdentityId = spacePersonAfterConfirm.identityId;
      expect(confirmedIdentityId).toEqual(expect.any(String));

      const linkAfterConfirm = await ctx.database
        .selectFrom('face_identity_face')
        .select(['identityId', 'source'])
        .where('assetFaceId', '=', face.id)
        .executeTakeFirstOrThrow();
      expect(linkAfterConfirm).toEqual({ identityId: confirmedIdentityId, source: 'manual' });

      const sspfAfterConfirm = await ctx.database
        .selectFrom('shared_space_person_face')
        .select('assetFaceId')
        .where('personId', '=', spaceAnna.id)
        .where('assetFaceId', '=', face.id)
        .executeTakeFirst();
      expect(sspfAfterConfirm).toBeDefined(); // positive control: the confirm actually wrote the projection row

      // When: a non-forced handleQueueRecognizeFaces runs and every queued handleRecognizeFaces job is
      // executed.
      const jobMock = ctx.getMock<JobRepository, Mocked<JobRepository>>(JobRepository);
      jobMock.waitForQueueCompletion.mockResolvedValue();
      jobMock.getJobCounts.mockResolvedValue({ active: 0, waiting: 0, delayed: 0, paused: 0, completed: 0, failed: 0 });
      const metadata = ctx.getMock<SystemMetadataRepository, Mocked<SystemMetadataRepository>>(
        SystemMetadataRepository,
      );
      metadata.set.mockResolvedValue();

      await expect(person.handleQueueRecognizeFaces({ force: false })).resolves.toBe(JobStatus.Success);

      const queuedRecognitionJobs: IFacialRecognitionJob[] = [];
      for (const [batch] of jobMock.queueAll.mock.calls) {
        for (const job of batch) {
          if (job.name === JobName.FacialRecognition) {
            queuedRecognitionJobs.push(job.data);
          }
        }
      }
      const queuedIds = queuedRecognitionJobs.map((job) => job.id);

      // Then: F was not queued — the mechanism this slice adds.
      expect(queuedIds).not.toContain(face.id);
      // Positive control, same call: an ordinary face IS queued — the scan is not vacuously empty.
      expect(queuedIds).toContain(control.id);

      // Execute every job the scan actually queued (this includes spaceAnna's own anchor face and the
      // control — a genuine full non-forced pass, not a hand-picked subset).
      for (const job of queuedRecognitionJobs) {
        await person.handleRecognizeFaces(job);
      }

      // Drive any resulting shared-space match jobs to completion too — this is the step that, pre-fix,
      // deletes the confirmed shared_space_person_face row once a re-recognized face's identity has moved.
      const queuedSpaceMatchJobs: { spaceId: string; assetId: string }[] = [];
      for (const [job] of jobMock.queue.mock.calls) {
        if (job.name === JobName.SharedSpaceFaceMatch) {
          queuedSpaceMatchJobs.push({ spaceId: job.data.spaceId, assetId: job.data.assetId });
        }
      }
      for (const job of queuedSpaceMatchJobs) {
        await space.handleSharedSpaceFaceMatch({ spaceId: job.spaceId, assetId: job.assetId });
      }

      // Then: shared_space_person_face still holds (S, F).
      const sspfAfter = await ctx.database
        .selectFrom('shared_space_person_face')
        .select('assetFaceId')
        .where('personId', '=', spaceAnna.id)
        .where('assetFaceId', '=', face.id)
        .executeTakeFirst();
      expect(sspfAfter).toBeDefined();

      // Then: face_identity_face.identityId is still S's identity.
      const linkAfter = await ctx.database
        .selectFrom('face_identity_face')
        .select(['identityId', 'source'])
        .where('assetFaceId', '=', face.id)
        .executeTakeFirstOrThrow();
      expect(linkAfter).toEqual({ identityId: confirmedIdentityId, source: 'manual' });

      // F itself was never touched by recognition at all.
      const faceAfter = await ctx.database
        .selectFrom('asset_face')
        .select('personId')
        .where('id', '=', face.id)
        .executeTakeFirstOrThrow();
      expect(faceAfter.personId).toBeNull();
    });

    it('S5.6 — a face carrying an ml/owner-person/backfill link is still queued by non-forced recognition (control for S5.1)', async () => {
      const { ctx } = setupPerson();
      const personRepo = ctx.get(PersonRepository);
      const faceIdentityRepo = ctx.get(FaceIdentityRepository);
      const { user } = await ctx.newUser();
      const { asset } = await ctx.newAsset({ ownerId: user.id, visibility: AssetVisibility.Timeline });

      const linkedFaceIds: string[] = [];
      for (const source of ['ml', 'owner-person', 'backfill'] as const) {
        const { assetFace } = await ctx.newAssetFace({
          assetId: asset.id,
          personId: null,
          sourceType: SourceType.MachineLearning,
        });
        const { person } = await ctx.newPerson({ ownerId: user.id });
        const identity = await faceIdentityRepo.ensurePersonIdentity(person.id);
        await faceIdentityRepo.replaceFaceIdentity({ assetFaceId: assetFace.id, identityId: identity.id, source });
        linkedFaceIds.push(assetFace.id);
      }

      // Absence control, same call: a genuinely manual-linked face IS excluded — only 'manual' is special.
      const { assetFace: manualFace } = await ctx.newAssetFace({
        assetId: asset.id,
        personId: null,
        sourceType: SourceType.MachineLearning,
      });
      const { person: manualPerson } = await ctx.newPerson({ ownerId: user.id });
      const manualIdentity = await faceIdentityRepo.ensurePersonIdentity(manualPerson.id);
      await faceIdentityRepo.replaceFaceIdentity({
        assetFaceId: manualFace.id,
        identityId: manualIdentity.id,
        source: 'manual',
      });

      const ids: string[] = [];
      for await (const face of personRepo.getAllFaces({
        personId: null,
        sourceType: SourceType.MachineLearning,
        excludeManuallyPlaced: true,
      })) {
        ids.push(face.id);
      }

      for (const id of linkedFaceIds) {
        expect(ids).toContain(id);
      }
      expect(ids).not.toContain(manualFace.id);
    });
  });

  it('leak 1a — a human placement is never re-flagged by the cleanup scan', async () => {
    const { sut: repair, ctx } = setupRepair();
    const { sut: person } = setupPerson();
    const { user } = await ctx.newUser();
    const auth = factory.auth({ user });

    // Bob owns the "first-axis" look. Anna's cluster has been contaminated with three first-axis faces.
    await buildCluster(ctx, user.id, axisEmbedding('first'), 10, 'Bob');
    const { person: anna } = await buildCluster(ctx, user.id, axisEmbedding('second'), 5, 'Anna');
    const leaked = await leakFacesInto(ctx, user.id, anna, axisEmbedding('first'), 3);

    // Baseline: the cleanup scan flags all three leaked faces (toward Bob).
    expect(await flaggedFaceIds(repair, user.id)).toEqual(new Set(leaked));

    // A user places ONE of those faces on Anna by hand (it genuinely is a young/rare photo of her). This
    // fixture leaves the face already assigned to Anna (leakFacesInto sets asset_face.personId = anna.id), so
    // the applicable human-placement path is reassignFacesById — the suggestion-confirm path requires an
    // UNASSIGNED face and is exercised separately in leak 1b below. Asserting asset_face.personId === anna.id
    // here would prove nothing: the fixture already put it there before this call ran.
    await person.reassignFacesById(auth, anna.id, { id: leaked[0] });

    // The reassignment left a manual identity link for the face — the durable record a re-scan must respect.
    const link = await db
      .selectFrom('face_identity_face')
      .select('source')
      .where('assetFaceId', '=', leaked[0])
      .executeTakeFirst();
    expect(link?.source).toBe('manual');

    // Re-scan: the placed face is no longer flagged; the other two still are (positive control). Before the
    // unification this was the ping-pong — an admin would be asked to move the user's placed face away,
    // unrecoverably.
    const afterPlacement = await flaggedFaceIds(repair, user.id);
    expect(afterPlacement.has(leaked[0])).toBe(false);
    expect(afterPlacement.has(leaked[1])).toBe(true);
    expect(afterPlacement.has(leaked[2])).toBe(true);
  });

  it('leak 1b — a suggestion confirm writes the human placement and drains the queue', async () => {
    const { ctx, faceSuggestion } = setupSuggestionPerson();
    const { user } = await ctx.newUser();
    const auth = factory.auth({ user });
    const verdictRepo = ctx.get(FacePersonVerdictRepository);

    // An anchored named person and an UNASSIGNED candidate face — the real precondition a suggestion-review
    // confirm click acts on (unlike leak 1a's fixture, this face has no personId yet).
    const anna = await newSuggestionAnchoredPerson(ctx, user.id, 'Anna');
    const { assetFace: face } = await newSuggestionCandidateFace(ctx, user.id);

    // Seed a genuine PENDING suggestion row inside the open band (maxDistance, suggestions.maxDistance] =
    // (0.5, 0.8] — the real precondition a confirm click drains. Positive control: assert it exists before
    // confirming, so the drain assertion below actually means something.
    await verdictRepo.upsertPending([{ personId: anna.id, assetFaceId: face.id, distance: 0.6 }]);
    expect(await pendingFor(ctx, 'personId', anna.id, face.id)).toBe(true);

    // Nothing but the real confirm path.
    await faceSuggestion.confirmFaceSuggestion(auth, anna.id, face.id);

    // All three post-conditions of a real confirm: the face is reassigned, a manual identity link exists for
    // it, and the pending suggestion row is drained.
    const assetFace = await db
      .selectFrom('asset_face')
      .select('personId')
      .where('id', '=', face.id)
      .executeTakeFirstOrThrow();
    expect(assetFace.personId).toBe(anna.id);
    const link = await db
      .selectFrom('face_identity_face')
      .select('source')
      .where('assetFaceId', '=', face.id)
      .executeTakeFirst();
    expect(link?.source).toBe('manual');
    expect(await pendingFor(ctx, 'personId', anna.id, face.id)).toBe(false);
  });

  it("leak 4/5 — a user's rejection suppresses a later cleanup flag toward that same person", async () => {
    const { sut: repair, ctx } = setupRepair();
    const { faceSuggestion } = setupPerson();
    const { user } = await ctx.newUser();
    const auth = factory.auth({ user });

    const { person: bob } = await buildCluster(ctx, user.id, axisEmbedding('first'), 10, 'Bob');
    const { person: anna } = await buildCluster(ctx, user.id, axisEmbedding('second'), 5, 'Anna');
    const leaked = await leakFacesInto(ctx, user.id, anna, axisEmbedding('first'), 1);
    const face = leaked[0];

    // Baseline: cleanup flags the leaked face toward Bob.
    const flaggedBefore = await flaggedFaceIds(repair, user.id);
    expect(flaggedBefore.has(face)).toBe(true);

    // The user, reviewing Bob's suggestions, says "no, that face is NOT Bob". Recorded as a shared negative
    // verdict against Bob (with his identity).
    await faceSuggestion.rejectFaceSuggestion(auth, bob.id, face);

    // Re-scan: cleanup no longer flags the face toward Bob — the two engines now agree it is not his.
    const flaggedAfter = await flaggedFaceIds(repair, user.id);
    expect(flaggedAfter.has(face)).toBe(false);
  });

  it('leak 3 — a cleanup move leaves no stale pending suggestion for the moved face', async () => {
    const { sut: repair, ctx } = setupRepair();
    const { user } = await ctx.newUser();
    const verdictRepo = ctx.get(FacePersonVerdictRepository);

    const { person: bob } = await buildCluster(ctx, user.id, axisEmbedding('first'), 10, 'Bob');
    const { person: anna } = await buildCluster(ctx, user.id, axisEmbedding('second'), 5, 'Anna');
    const [face] = await leakFacesInto(ctx, user.id, anna, axisEmbedding('first'), 1);

    // A pending suggestion for this face exists for a THIRD person (Carol), left over from an earlier scan.
    const { person: carol } = await ctx.newPerson({ ownerId: user.id, name: 'Carol' });
    await verdictRepo.upsertPending([{ personId: carol.id, assetFaceId: face, distance: 0.62 }]);

    // The admin scans and moves the leaked face to its true owner, Bob.
    await repair.runRepair({ ownerId: user.id, ...repairParams });
    const moved = await db.selectFrom('asset_face').select('personId').where('id', '=', face).executeTakeFirstOrThrow();
    expect(moved.personId).toBe(bob.id);

    // The stale pending suggestion is gone — drained at the write path, not merely hidden by a read filter.
    const rows = await db
      .selectFrom('face_person_verdict')
      .select(['personId', 'status'])
      .where('assetFaceId', '=', face)
      .execute();
    expect(rows.filter((r) => r.status === 'pending')).toEqual([]);
  });

  it('leak 2 — a detached "not a face" is never re-proposed by a suggestion scan', async () => {
    const { sut: repair, ctx } = setupRepair();
    const { user } = await ctx.newUser();
    const searchRepo = ctx.get(SearchRepository);

    const { person: anna } = await buildCluster(ctx, user.id, axisEmbedding('second'), 5, 'Anna');
    const [face] = await leakFacesInto(ctx, user.id, anna, axisEmbedding('second'), 1);

    // Seed the latest scan snapshot so resolveFaces can act on this face, then detach it as "not a face".
    const scanRepo = ctx.get(FaceRepairScanRepository);
    const scan = await scanRepo.createScan({
      requestedBy: user.id,
      params: {
        maxDistance: 0.6,
        minFaces: 1,
        voteWindow: 50,
        voteMargin: 2,
        maxAttributionDistance: 0.35,
        maxFlaggedFraction: 0.5,
        largeClusterThreshold: 50,
      },
    });
    await scanRepo.replaceScanFlaggedFaces(scan.id, [
      { assetFaceId: face, personId: anna.id, suspectedOwnerId: anna.id },
    ]);
    await scanRepo.completeScan(scan.id, {
      totals: {
        eligibleFaces: 1,
        flaggedFaces: 1,
        toRepair: 1,
        reviewOnlyFaces: 0,
        reviewOnlyPersons: 0,
        affectedPersons: 1,
        reviewOnlyByReason: { overCap: 0, badTarget: 0, unAttributable: 0 },
      },
      persons: [
        {
          personId: anna.id,
          ownerId: user.id,
          personName: 'Anna',
          faceCount: 1,
          thumbnailFaceId: null,
          eligible: 1,
          flagged: 1,
          flaggedFraction: 1,
          suspectedOwners: [],
          recommendation: 'confident',
          reviewReasons: [],
        },
      ],
    });
    await repair.resolveFaces(
      { personId: anna.id, moveToPerson: [], stay: [], lock: [], detach: [face], unknown: [] },
      user.id,
    );

    // The face is tombstoned; a suggestion scan's candidate search must not return it for anyone.
    const results = await searchRepo.searchFaces({
      userIds: [user.id],
      embedding: axisEmbedding('second'),
      numResults: 20,
      maxDistance: 2,
      hasPerson: false,
    });
    expect(results.map((r) => r.id)).not.toContain(face);
  });

  // D3 (defect 5) — the suggestion engine's two scopes (personal, space) share ONE verdict layer: a
  // rejection recorded in either scope must be honoured by the other, in both directions, without a re-scan.
  it('one rejection answers personal and space scope (defect 5)', async () => {
    const { ctx, faceSuggestion } = setupSuggestionPerson();
    const { sut: space, ctx: spaceCtx } = setupSpace();
    await enableSpaceSuggestionBand(spaceCtx);
    const { user } = await ctx.newUser();
    const auth = factory.auth({ user });

    const anna = await newSuggestionAnchoredPerson(ctx, user.id, 'Anna');
    const identity = await ctx.get(FaceIdentityRepository).ensurePersonIdentity(anna.id);
    const s = await newSuggestionSpace(ctx, user.id);
    const spaceAnna = await newSuggestionAnchoredSpacePerson(ctx, {
      spaceId: s.id,
      ownerId: user.id,
      name: 'Space Anna',
      identityId: identity.id,
    });

    // Forward: a PERSONAL rejection suppresses the SPACE scan. A CONTROL face — seeded identically but never
    // rejected — is picked up by the SAME scan call: its pending row is the positive control that this run
    // genuinely produces suggestions when nothing suppresses them (JobStatus.Success alone proves nothing —
    // handleSpacePersonSuggestionScan returns Success even when its candidate map ends up empty).
    const { assetFace: faceOne } = await newSuggestionCandidateFace(ctx, user.id);
    await ctx.newSharedSpaceAsset({ spaceId: s.id, assetId: faceOne.assetId, addedById: user.id });
    const { assetFace: faceOneControl } = await newSuggestionCandidateFace(ctx, user.id);
    await ctx.newSharedSpaceAsset({ spaceId: s.id, assetId: faceOneControl.assetId, addedById: user.id });
    await faceSuggestion.rejectFaceSuggestion(auth, anna.id, faceOne.id);
    await expect(faceSuggestion.handleSpacePersonSuggestionScan({ id: spaceAnna.id })).resolves.toBe(JobStatus.Success);
    expect(await pendingFor(ctx, 'spacePersonId', spaceAnna.id, faceOne.id)).toBe(false);
    expect(await pendingFor(ctx, 'spacePersonId', spaceAnna.id, faceOneControl.id)).toBe(true);

    // Reverse: a SPACE rejection suppresses the PERSONAL scan. Same control-face pattern.
    const { assetFace: faceTwo } = await newSuggestionCandidateFace(ctx, user.id);
    await ctx.newSharedSpaceAsset({ spaceId: s.id, assetId: faceTwo.assetId, addedById: user.id });
    const { assetFace: faceTwoControl } = await newSuggestionCandidateFace(ctx, user.id);
    await ctx.newSharedSpaceAsset({ spaceId: s.id, assetId: faceTwoControl.assetId, addedById: user.id });
    await space.rejectSpacePersonFaceSuggestion(auth, s.id, spaceAnna.id, faceTwo.id);
    await expect(faceSuggestion.handlePersonSuggestionScan({ id: anna.id })).resolves.toBe(JobStatus.Success);
    expect(await pendingFor(ctx, 'personId', anna.id, faceTwo.id)).toBe(false);
    expect(await pendingFor(ctx, 'personId', anna.id, faceTwoControl.id)).toBe(true);
  });

  it('keep-here suppresses a later suggestion', async () => {
    const { sut: repair, ctx } = setupRepair();
    const { faceSuggestion } = setupSuggestionPerson();
    const { user } = await ctx.newUser();

    const o = await newSuggestionAnchoredPerson(ctx, user.id, 'O');
    // O's identity must exist BEFORE the keep-here write below — resolveFaces's stay bucket only reads an
    // owner's identity token, it never creates one, so the negative verdict would carry a null identityId
    // (personId-only) if O had never been identity-linked yet.
    const oIdentity = await ctx.get(FaceIdentityRepository).ensurePersonIdentity(o.id);
    const s = await newSuggestionSpace(ctx, user.id);
    const spaceO = await newSuggestionAnchoredSpacePerson(ctx, {
      spaceId: s.id,
      ownerId: user.id,
      name: 'Space O',
      identityId: oIdentity.id,
    });

    // Anna's cluster is contaminated with one face on O's axis — the classic leak the cleanup scan flags,
    // with O as the suspected owner.
    const { person: anna } = await ctx.newPerson({ ownerId: user.id, name: 'Anna' });
    const { assetFace: face } = await seedSuggestionFace(ctx, {
      ownerId: user.id,
      personId: anna.id,
      embedding: SUGGESTION_CANDIDATE,
    });

    const scanRepo = ctx.get(FaceRepairScanRepository);
    const scan = await scanRepo.createScan({
      requestedBy: user.id,
      params: {
        maxDistance: 0.6,
        minFaces: 1,
        voteWindow: 50,
        voteMargin: 2,
        maxAttributionDistance: 0.35,
        maxFlaggedFraction: 0.5,
        largeClusterThreshold: 50,
      },
    });
    await scanRepo.replaceScanFlaggedFaces(scan.id, [
      { assetFaceId: face.id, personId: anna.id, suspectedOwnerId: o.id },
    ]);
    await scanRepo.completeScan(scan.id, {
      totals: {
        eligibleFaces: 1,
        flaggedFaces: 1,
        toRepair: 1,
        reviewOnlyFaces: 0,
        reviewOnlyPersons: 0,
        affectedPersons: 1,
        reviewOnlyByReason: { overCap: 0, badTarget: 0, unAttributable: 0 },
      },
      persons: [
        {
          personId: anna.id,
          ownerId: user.id,
          personName: 'Anna',
          faceCount: 1,
          thumbnailFaceId: null,
          eligible: 1,
          flagged: 1,
          flaggedFraction: 1,
          suspectedOwners: [],
          recommendation: 'confident',
          reviewReasons: [],
        },
      ],
    });

    // The admin says "keep it here" — F stays on Anna, but a durable decline is recorded against O.
    await repair.resolveFaces(
      { personId: anna.id, moveToPerson: [], stay: [face.id], lock: [], detach: [], unknown: [] },
      user.id,
    );

    // Intermediate fact this whole test depends on — the "keep here" write actually produced a durable
    // NEGATIVE verdict against O, rather than the rest of the test just assuming it did.
    const stayedVerdict = await ctx.database
      .selectFrom('face_person_verdict')
      .select(['status'])
      .where('personId', '=', o.id)
      .where('assetFaceId', '=', face.id)
      .executeTakeFirst();
    expect(stayedVerdict?.status).toBe('rejected');

    // Later, the kept face is unassigned (e.g. a reset) — the exact shape a suggestion-scan candidate has.
    await ctx.database.updateTable('asset_face').set({ personId: null }).where('id', '=', face.id).execute();
    await ctx.newSharedSpaceAsset({ spaceId: s.id, assetId: face.assetId, addedById: user.id });

    // A CONTROL face, seeded identically (same embedding, same space) but never kept-here, is the positive
    // control: the same two scan calls below must still propose IT, proving the calls genuinely run a search
    // rather than vacuously returning Success with an empty candidate map.
    const { assetFace: control } = await seedSuggestionFace(ctx, {
      ownerId: user.id,
      personId: null,
      embedding: SUGGESTION_CANDIDATE,
    });
    await ctx.newSharedSpaceAsset({ spaceId: s.id, assetId: control.assetId, addedById: user.id });

    await expect(faceSuggestion.handlePersonSuggestionScan({ id: o.id })).resolves.toBe(JobStatus.Success);
    expect(await pendingFor(ctx, 'personId', o.id, face.id)).toBe(false);
    expect(await pendingFor(ctx, 'personId', o.id, control.id)).toBe(true);

    // The same keep-here decision, honoured in a DIFFERENT scope that shares O's identity — a space person
    // is a distinct (spacePersonId, assetFaceId) row from O's own, so this is not covered by the
    // same-target "never resurrect" upsert guard the personal assertion above could already pass on alone.
    await expect(faceSuggestion.handleSpacePersonSuggestionScan({ id: spaceO.id })).resolves.toBe(JobStatus.Success);
    expect(await pendingFor(ctx, 'spacePersonId', spaceO.id, face.id)).toBe(false);
    expect(await pendingFor(ctx, 'spacePersonId', spaceO.id, control.id)).toBe(true);
  });

  // Slice 8 (F15, F16) — the verdict table never states a fact the rest of the system contradicts, and it
  // does not grow without bound.
  describe('Slice 8 — verdict lifecycle: clearing and collection (F15, F16)', () => {
    it('S8.1 — a negative verdict no longer lists "F is not Q" once the owner places F on Q', async () => {
      const { sut: person, ctx } = setupPerson();
      const verdictRepo = ctx.get(FacePersonVerdictRepository);
      const faceIdentityRepo = ctx.get(FaceIdentityRepository);
      const { user } = await ctx.newUser();
      const auth = factory.auth({ user });

      const { person: holder } = await ctx.newPerson({ ownerId: user.id, name: 'Holder' });
      const { person: q } = await ctx.newPerson({ ownerId: user.id, name: 'Q' });
      const qIdentity = await faceIdentityRepo.ensurePersonIdentity(q.id);
      const { asset } = await ctx.newAsset({ ownerId: user.id });
      const { assetFace: face } = await ctx.newAssetFace({ assetId: asset.id, personId: holder.id });

      // Given: an admin kept F away from Q — the stay bucket's write shape, a durable rejected verdict.
      await verdictRepo.markRejected(q.id, face.id, {
        identityId: qIdentity.id,
        source: 'cleanup',
        actorId: user.id,
      });

      // Positive control: the resolutions page DOES list "F is not Q" before the placement.
      const before = await verdictRepo.listNegativeVerdicts({ page: 1, size: 50 });
      expect(before.items.some((r) => r.assetFaceId === face.id && r.personId === q.id)).toBe(true);

      // When: the owner later places F on Q through the face editor.
      await person.reassignFacesById(auth, q.id, { id: face.id });

      // Then: the resolutions page no longer lists it.
      const after = await verdictRepo.listNegativeVerdicts({ page: 1, size: 50 });
      expect(after.items.some((r) => r.assetFaceId === face.id && r.personId === q.id)).toBe(false);
    });

    it('S8.2 — the same placement leaves a rejected verdict against a DIFFERENT person untouched (scoping control)', async () => {
      const { sut: person, ctx } = setupPerson();
      const verdictRepo = ctx.get(FacePersonVerdictRepository);
      const faceIdentityRepo = ctx.get(FaceIdentityRepository);
      const { user } = await ctx.newUser();
      const auth = factory.auth({ user });

      const { person: holder } = await ctx.newPerson({ ownerId: user.id, name: 'Holder' });
      const { person: q } = await ctx.newPerson({ ownerId: user.id, name: 'Q' });
      const { person: r } = await ctx.newPerson({ ownerId: user.id, name: 'R' });
      const qIdentity = await faceIdentityRepo.ensurePersonIdentity(q.id);
      const rIdentity = await faceIdentityRepo.ensurePersonIdentity(r.id);
      const { asset } = await ctx.newAsset({ ownerId: user.id });
      const { assetFace: face } = await ctx.newAssetFace({ assetId: asset.id, personId: holder.id });

      await verdictRepo.markRejected(q.id, face.id, {
        identityId: qIdentity.id,
        source: 'cleanup',
        actorId: user.id,
      });
      await verdictRepo.markRejected(r.id, face.id, {
        identityId: rIdentity.id,
        source: 'cleanup',
        actorId: user.id,
      });
      expect(await negativeExists(ctx, 'personId', q.id, face.id)).toBe(true); // positive control
      expect(await negativeExists(ctx, 'personId', r.id, face.id)).toBe(true); // positive control

      await person.reassignFacesById(auth, q.id, { id: face.id });

      expect(await negativeExists(ctx, 'personId', q.id, face.id)).toBe(false); // cleared: same target
      expect(await negativeExists(ctx, 'personId', r.id, face.id)).toBe(true); // scoping: different target survives
    });

    it('S8.3 — identity-keyed clearing: a NULL-personId verdict against the target identity is cleared', async () => {
      const { sut: person, ctx } = setupPerson();
      const faceIdentityRepo = ctx.get(FaceIdentityRepository);
      const { user } = await ctx.newUser();
      const auth = factory.auth({ user });

      const { person: holder } = await ctx.newPerson({ ownerId: user.id, name: 'Holder' });
      const { person: q } = await ctx.newPerson({ ownerId: user.id, name: 'Q' });
      const qIdentity = await faceIdentityRepo.ensurePersonIdentity(q.id);
      const { asset } = await ctx.newAsset({ ownerId: user.id });
      const { assetFace: face } = await ctx.newAssetFace({ assetId: asset.id, personId: holder.id });

      // A verdict recorded with only the identity (personId NULL) — the shape a decline against a
      // since-deleted-and-recreated suspected owner leaves behind.
      await ctx.database
        .insertInto('face_person_verdict')
        .values({
          assetFaceId: face.id,
          personId: null,
          spacePersonId: null,
          identityId: qIdentity.id,
          status: 'rejected',
          source: 'cleanup',
        })
        .execute();
      expect(await negativeExists(ctx, 'identityId', qIdentity.id, face.id)).toBe(true); // positive control

      await person.reassignFacesById(auth, q.id, { id: face.id });

      expect(await negativeExists(ctx, 'identityId', qIdentity.id, face.id)).toBe(false);
    });

    // Note on this test's shape: a negative verdict matching a space confirm's target (by spacePersonId OR
    // by identityId) can never coexist, in this codebase, with a pending row for that SAME (target, face)
    // pair — hasPendingForSpacePerson/claimPendingForSpacePerson apply the IDENTICAL match (excludeNegativeVerdict)
    // to decide whether the row is even visible as pending, so a confirm can only ever reach the transaction
    // when no such negative exists yet. clearNegativeForTarget's call from inside the confirm is therefore
    // defense-in-depth (it also protects against a future change that decouples the two gates), not something
    // a natural end-to-end fixture can force to delete a row — verified instead as a WIRING assertion: the
    // right method is called with the right target descriptor and face id. The matcher's own correctness
    // (spacePersonId / identityId / personId branches, and the different-target scoping) is exhaustively
    // covered directly at the repository layer (face-person-verdict.repository.spec.ts) and via the personal
    // face-editor path above (S8.1-S8.3), which has no such pending-row precondition to fight.
    it('S8.4 — a space confirm calls clearNegativeForTarget scoped to the space person and its identity', async () => {
      const { sut: space, ctx } = setupSpace();
      await enableSpaceSuggestionBand(ctx);
      const verdictRepo = ctx.get(FacePersonVerdictRepository);
      const faceIdentityRepo = ctx.get(FaceIdentityRepository);
      const { user: owner } = await ctx.newUser();
      const { user: editor } = await ctx.newUser();
      const editorAuth = factory.auth({ user: editor });

      const s = await newSuggestionSpace(ctx, owner.id);
      await ctx.newSharedSpaceMember({ spaceId: s.id, userId: editor.id, role: SharedSpaceRole.Editor });
      const spaceAnna = await newSuggestionAnchoredSpacePerson(ctx, {
        spaceId: s.id,
        ownerId: owner.id,
        name: 'Space Anna',
      });

      const { assetFace: face } = await newSuggestionCandidateFace(ctx, owner.id);
      await ctx.newSharedSpaceAsset({ spaceId: s.id, assetId: face.assetId, addedById: owner.id });

      await verdictRepo.upsertPendingForSpacePerson([
        { spacePersonId: spaceAnna.id, assetFaceId: face.id, distance: 0.6 },
      ]);
      expect(await pendingFor(ctx, 'spacePersonId', spaceAnna.id, face.id)).toBe(true); // positive control

      const clearSpy = vi.spyOn(verdictRepo, 'clearNegativeForTarget');

      await space.confirmSpacePersonFaceSuggestion(editorAuth, s.id, spaceAnna.id, face.id);

      const identity = await faceIdentityRepo.ensureSpacePersonIdentity(spaceAnna.id);
      expect(clearSpy).toHaveBeenCalledWith(
        { spacePersonId: spaceAnna.id, identityId: identity.id },
        [face.id],
        expect.anything(),
      );
    });

    it('S8.5 — a cleanup move clears a negative for (Q, F); the lock bucket clears a negative for the reviewed person', async () => {
      const { sut: repair, ctx } = setupRepair();
      const verdictRepo = ctx.get(FacePersonVerdictRepository);
      const faceIdentityRepo = ctx.get(FaceIdentityRepository);
      const { user } = await ctx.newUser();

      // Move half: F moves from `holder` to Q. A rejected verdict directly keyed to (Q, F) predates the
      // move (an earlier decline against Q, now contradicted by it).
      const { person: holder } = await ctx.newPerson({ ownerId: user.id, name: 'Holder' });
      const { person: q } = await ctx.newPerson({ ownerId: user.id, name: 'Q' });
      const qIdentity = await faceIdentityRepo.ensurePersonIdentity(q.id);
      const { assetFace: moveFace } = await seedSuggestionFace(ctx, {
        ownerId: user.id,
        personId: holder.id,
        embedding: SUGGESTION_CANDIDATE,
      });
      await verdictRepo.markRejected(q.id, moveFace.id, {
        identityId: qIdentity.id,
        source: 'cleanup',
        actorId: user.id,
      });
      expect(await negativeExists(ctx, 'personId', q.id, moveFace.id)).toBe(true); // positive control

      await repair.executeRepair({
        toRepair: [{ assetFaceId: moveFace.id, currentPersonId: holder.id, suspectedOwnerId: q.id }],
        reviewOnlyFaces: [],
        reviewOnlyPersonIds: [],
        unAttributableFaces: [],
        perPerson: [],
      });

      expect(await negativeExists(ctx, 'personId', q.id, moveFace.id)).toBe(false); // cleared by the move

      // Lock half: F2 sits on `reviewed`; a rejected verdict directly keyed to (reviewed, F2) predates the
      // lock.
      const { person: reviewed } = await ctx.newPerson({ ownerId: user.id, name: 'Reviewed' });
      const reviewedIdentity = await faceIdentityRepo.ensurePersonIdentity(reviewed.id);
      const { assetFace: lockFace } = await seedSuggestionFace(ctx, {
        ownerId: user.id,
        personId: reviewed.id,
        embedding: SUGGESTION_CANDIDATE,
      });
      await verdictRepo.markRejected(reviewed.id, lockFace.id, {
        identityId: reviewedIdentity.id,
        source: 'cleanup',
        actorId: user.id,
      });
      expect(await negativeExists(ctx, 'personId', reviewed.id, lockFace.id)).toBe(true); // positive control

      await repair.resolveFaces(
        { personId: reviewed.id, moveToPerson: [], stay: [], lock: [lockFace.id], detach: [], unknown: [] },
        user.id,
      );

      expect(await negativeExists(ctx, 'personId', reviewed.id, lockFace.id)).toBe(false); // cleared by the lock
    });

    it('S8.6 — after Q is deleted and re-created sharing the same identity, a later scan offers F again', async () => {
      const { sut: person, ctx, faceSuggestion } = setupSuggestionPerson();
      const verdictRepo = ctx.get(FacePersonVerdictRepository);
      const faceIdentityRepo = ctx.get(FaceIdentityRepository);
      const { user } = await ctx.newUser();
      const auth = factory.auth({ user });

      // Given: the S8.1 sequence — admin declines F toward Q1, the owner then places F on Q1 (cleared).
      const { person: holder } = await ctx.newPerson({ ownerId: user.id, name: 'Holder' });
      const q1 = await newSuggestionAnchoredPerson(ctx, user.id, 'Q');
      const q1Identity = await faceIdentityRepo.ensurePersonIdentity(q1.id);
      const { assetFace: face } = await seedSuggestionFace(ctx, {
        ownerId: user.id,
        personId: holder.id,
        embedding: SUGGESTION_CANDIDATE,
      });
      await verdictRepo.markRejected(q1.id, face.id, {
        identityId: q1Identity.id,
        source: 'cleanup',
        actorId: user.id,
      });
      await person.reassignFacesById(auth, q1.id, { id: face.id });
      expect(await negativeExists(ctx, 'personId', q1.id, face.id)).toBe(false); // sanity: S8.1's fix ran

      // When: a reset unassigns F (strips its manual identity link and its personId — scoped to just this
      // one face here, mirroring unassignFaces's two effects without perturbing sibling fixtures in this
      // shared-DB file) and Q is deleted and re-created, sharing the same identity (an
      // identity-reconciliation re-link, not a fresh identity).
      await faceIdentityRepo.unlinkFaces([face.id]);
      await ctx.database.updateTable('asset_face').set({ personId: null }).where('id', '=', face.id).execute();

      await ctx.database.deleteFrom('person').where('id', '=', q1.id).execute();
      const faceAfterDelete = await ctx.database
        .selectFrom('asset_face')
        .select('personId')
        .where('id', '=', face.id)
        .executeTakeFirstOrThrow();
      expect(faceAfterDelete.personId).toBeNull(); // sanity: the face is genuinely unassigned

      const q2 = await newSuggestionAnchoredPerson(ctx, user.id, 'Q');
      await ctx.database.updateTable('person').set({ identityId: q1Identity.id }).where('id', '=', q2.id).execute();

      // Then: a suggestion scan offers F again — it was permanently suppressed before this slice.
      await expect(faceSuggestion.handlePersonSuggestionScan({ id: q2.id })).resolves.toBe(JobStatus.Success);
      expect(await pendingFor(ctx, 'personId', q2.id, face.id)).toBe(true);
    });

    it('S8.9 — the reaper runs after the identity GC, so a row whose only remaining key is a GC-removed identity is collected', async () => {
      const { sut: person, ctx } = setupPerson();
      const jobMock = ctx.getMock<JobRepository, Mocked<JobRepository>>(JobRepository);
      jobMock.waitForQueueCompletion.mockResolvedValue();
      jobMock.empty.mockResolvedValue();
      jobMock.queue.mockResolvedValue();
      jobMock.queueAll.mockResolvedValue();
      jobMock.getJobCounts.mockResolvedValue({
        active: 0,
        waiting: 0,
        delayed: 0,
        paused: 0,
        completed: 0,
        failed: 0,
      });
      const metadata = ctx.getMock<SystemMetadataRepository, Mocked<SystemMetadataRepository>>(
        SystemMetadataRepository,
      );
      metadata.get.mockResolvedValue({ machineLearning: { facialRecognition: { enabled: true, minFaces: 1 } } } as any);
      metadata.set.mockResolvedValue();
      const verdictRepo = ctx.get(FacePersonVerdictRepository);
      const faceIdentityRepo = ctx.get(FaceIdentityRepository);
      const { user } = await ctx.newUser();

      // A person P with exactly ONE ML face: unassignFaces empties it, so handlePersonCleanup deletes P as
      // faceless, and its identity — referenced by nothing else — becomes GC-eligible in the SAME run.
      const { person: p } = await ctx.newPerson({ ownerId: user.id, name: 'P' });
      const pIdentity = await faceIdentityRepo.ensurePersonIdentity(p.id);
      const { asset: pAsset } = await ctx.newAsset({ ownerId: user.id, visibility: AssetVisibility.Timeline });
      await ctx.newAssetFace({ assetId: pAsset.id, personId: p.id, sourceType: SourceType.MachineLearning });

      // The row under test: identityId-only (personId/spacePersonId already NULL), against a face unrelated
      // to P's own — its ONLY remaining key is P's identity, which only becomes NULL once the identity GC
      // (deleteUnreferencedIdentities) runs.
      const { asset: targetAsset } = await ctx.newAsset({ ownerId: user.id, visibility: AssetVisibility.Timeline });
      const { assetFace: targetFace } = await ctx.newAssetFace({
        assetId: targetAsset.id,
        personId: null,
        sourceType: SourceType.MachineLearning,
      });
      await ctx.database
        .insertInto('face_person_verdict')
        .values({
          assetFaceId: targetFace.id,
          personId: null,
          spacePersonId: null,
          identityId: pIdentity.id,
          status: 'rejected',
          source: 'cleanup',
        })
        .execute();

      // Positive control: a verdict with a LIVE target survives the whole run. `live` needs a face the
      // forced reset does NOT unassign (a Manual-source face — unassignFaces below is scoped to
      // sourceType=MachineLearning), or `live` itself would go faceless and get swept by the SAME
      // handlePersonCleanup call, making this control vacuous.
      const { person: live } = await ctx.newPerson({ ownerId: user.id, name: 'Live' });
      const { asset: liveAsset } = await ctx.newAsset({ ownerId: user.id, visibility: AssetVisibility.Timeline });
      await ctx.newAssetFace({ assetId: liveAsset.id, personId: live.id, sourceType: SourceType.Manual });
      const { assetFace: liveFace } = await ctx.newAssetFace({
        assetId: liveAsset.id,
        personId: null,
        sourceType: SourceType.MachineLearning,
      });
      await verdictRepo.markRejected(live.id, liveFace.id, { source: 'cleanup', actorId: user.id });

      // Row-existence by assetFaceId alone, NOT by identityId=pIdentity.id: the identity GC's ON DELETE SET
      // NULL degrades that column to NULL as a SEPARATE effect from the reaper actually deleting the row —
      // asserting on `identityId = pIdentity.id` would read `false` the instant the column is nulled even if
      // the row itself survives uncollected, silently passing regardless of the reaper's call position. This
      // is the exact trap the ordering mutation below caught on the first attempt at this test.
      const anyVerdictRowFor = async (assetFaceId: string) => {
        const row = await ctx.database
          .selectFrom('face_person_verdict')
          .select('id')
          .where('assetFaceId', '=', assetFaceId)
          .executeTakeFirst();
        return row !== undefined;
      };

      expect(await negativeExists(ctx, 'identityId', pIdentity.id, targetFace.id)).toBe(true); // positive control
      expect(await anyVerdictRowFor(targetFace.id)).toBe(true); // positive control

      await expect(person.handleQueueRecognizeFaces({ force: true })).resolves.toBe(JobStatus.Success);

      expect(await anyVerdictRowFor(targetFace.id)).toBe(false); // collected — the row itself is gone
      expect(await negativeExists(ctx, 'personId', live.id, liveFace.id)).toBe(true); // live target kept
    });
  });
});
