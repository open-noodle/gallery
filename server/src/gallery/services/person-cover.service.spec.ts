import { BadRequestException } from '@nestjs/common';
import { JobName, JobStatus } from 'src/enum.js';
import type { CoverCandidateRow } from 'src/gallery/repositories/person-cover.repository.js';
import { PersonCoverService } from 'src/gallery/services/person-cover.service.js';
import { readFaceGreyscalePixels } from 'src/gallery/utils/image-quality.js';
import { PERSON_COVER_CROP_SIZE, PERSON_COVER_VERSION } from 'src/gallery/utils/person-cover.js';
import { clearConfigCache } from 'src/utils/config.js';
import { AuthFactory } from 'test/factories/auth.factory.js';
import { PersonFactory } from 'test/factories/person.factory.js';
import { ServiceMocks, makeStream, newTestService } from 'test/utils.js';

vi.mock('src/gallery/utils/image-quality.js', () => ({ readFaceGreyscalePixels: vi.fn() }));

const size = PERSON_COVER_CROP_SIZE;
// A sharp face: fine stripes. A blurred one: flat grey. Both well exposed.
const sharpPixels = Buffer.from(
  Array.from({ length: size * size }, (_, i) => ((i + Math.floor(i / size)) % 2 ? 230 : 40)),
);
const flatPixels = Buffer.alloc(size * size, 128);

const candidate = (faceId: string, overrides: Partial<CoverCandidateRow> = {}): CoverCandidateRow => ({
  faceId,
  assetId: `asset-${faceId}`,
  date: new Date('2026-06-01T12:00:00Z'),
  trustedDate: true,
  size: 100,
  embedding: [1, 0, 0],
  previewPath: `/thumbs/${faceId}.jpeg`,
  imageWidth: 1000,
  imageHeight: 1000,
  boundingBoxX1: 100,
  boundingBoxY1: 100,
  boundingBoxX2: 200,
  boundingBoxY2: 200,
  ...overrides,
});

describe(PersonCoverService.name, () => {
  let sut: PersonCoverService;
  let mocks: ServiceMocks;
  let ensureLocalFile: ReturnType<typeof vi.spyOn>;

  const setConfig = (enabled: boolean) =>
    mocks.systemMetadata.get.mockResolvedValue({ machineLearning: { facialRecognition: { covers: { enabled } } } });

  /** The sharp face is `sharpFaceId`; every other face reads flat. */
  const givenFaces = (faces: CoverCandidateRow[], sharpFaceId?: string) => {
    mocks.personCover.getPersonCandidates.mockResolvedValue(faces);
    mocks.personCover.getSpacePersonCandidates.mockResolvedValue(faces);
    vi.mocked(readFaceGreyscalePixels).mockImplementation((path: string) =>
      Promise.resolve(path === `/thumbs/${sharpFaceId}.jpeg` ? sharpPixels : flatPixels),
    );
  };

  beforeEach(() => {
    clearConfigCache();
    ({ sut, mocks } = newTestService(PersonCoverService));
    setConfig(true);
    ensureLocalFile = vi.spyOn(sut['backendMedia'], 'ensureLocalFile').mockImplementation((path: string) => {
      const cleanup = () => Promise.resolve();
      return Promise.resolve({ localPath: path, cleanup, [Symbol.asyncDispose]: cleanup });
    });
    mocks.personCover.getIdentityHandPickedCovers.mockResolvedValue([]);
    mocks.personCover.applyPersonPick.mockResolvedValue('changed');
    mocks.personCover.applySpacePersonPick.mockResolvedValue('changed');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('handleQueueAll', () => {
    it('queues every personal and space person the selection returns', async () => {
      mocks.personCover.streamPeopleToPick.mockReturnValue(makeStream([{ personGroupId: 'person-1' }]));
      mocks.personCover.streamSpacePeopleToPick.mockReturnValue(makeStream([{ id: 'space-person-1' }]));

      await expect(sut.handleQueueAll({ force: true })).resolves.toBe(JobStatus.Success);

      expect(mocks.personCover.streamPeopleToPick).toHaveBeenCalledWith({ force: true });
      expect(mocks.personCover.streamSpacePeopleToPick).toHaveBeenCalledWith({ force: true });
      expect(mocks.job.queueAll).toHaveBeenCalledWith([
        { name: JobName.PersonCover, data: { id: 'person-1', force: true } },
      ]);
      expect(mocks.job.queueAll).toHaveBeenCalledWith([
        { name: JobName.SpacePersonCover, data: { id: 'space-person-1', force: true } },
      ]);
    });

    it('does nothing while the setting is off', async () => {
      setConfig(false);

      await expect(sut.handleQueueAll({ force: false })).resolves.toBe(JobStatus.Skipped);

      expect(mocks.personCover.streamPeopleToPick).not.toHaveBeenCalled();
      expect(mocks.job.queueAll).not.toHaveBeenCalled();
    });
  });

  describe('handlePersonCover', () => {
    const person = PersonFactory.create({ faceAssetId: 'face-old' });

    beforeEach(() => {
      mocks.person.getByGroupIdOnly.mockResolvedValue(person);
      givenFaces([candidate('face-old'), candidate('face-sharp')], 'face-sharp');
    });

    it('picks the best face for a person with no row, and regenerates the thumbnail', async () => {
      mocks.personCover.getPersonCover.mockResolvedValue(undefined);

      await expect(sut.handlePersonCover({ id: person.personGroupId })).resolves.toBe(JobStatus.Success);

      expect(mocks.personCover.applyPersonPick).toHaveBeenCalledWith({
        personGroupId: person.personGroupId,
        faceId: 'face-sharp',
        candidateCount: 2,
        mode: 'missing',
      });
      expect(mocks.job.queue).toHaveBeenCalledWith({
        name: JobName.PersonGenerateThumbnail,
        data: { ownerId: person.ownerId, personGroupId: person.personGroupId },
      });
      // Never the identity's representative face: only hand picks write it.
      expect(mocks.faceIdentity.updateRepresentativeFace).not.toHaveBeenCalled();
    });

    it.each([
      ['a holding manual cover on a Missing run', { source: 'manual' as const, faceId: 'face-old' }, false],
      ['a holding manual cover on an All run', { source: 'manual' as const, faceId: 'face-old' }, true],
      ['a holding unknown cover on a Missing run', { source: 'unknown' as const, faceId: 'face-old' }, false],
    ])('keeps %s without reading a preview', async (_, cover, force) => {
      mocks.personCover.getPersonCover.mockResolvedValue({ ...cover, candidateCount: null, version: null });

      await expect(sut.handlePersonCover({ id: person.personGroupId, force })).resolves.toBe(JobStatus.Skipped);

      expect(mocks.personCover.getPersonCandidates).not.toHaveBeenCalled();
      expect(mocks.personCover.applyPersonPick).not.toHaveBeenCalled();
    });

    it.each([
      ['an unknown cover on an All run', { source: 'unknown' as const, faceId: 'face-old' }, true],
      ['a manual row whose face is no longer the cover', { source: 'manual' as const, faceId: 'face-gone' }, false],
      ['an unknown row whose face is no longer the cover', { source: 'unknown' as const, faceId: 'face-gone' }, false],
    ])('replaces %s', async (_, cover, force) => {
      mocks.personCover.getPersonCover.mockResolvedValue({ ...cover, candidateCount: null, version: null });

      await sut.handlePersonCover({ id: person.personGroupId, force });

      expect(mocks.personCover.applyPersonPick).toHaveBeenCalledWith(
        expect.objectContaining({ faceId: 'face-sharp', mode: force ? 'all' : 'missing' }),
      );
    });

    it('leaves a fresh automatic pick alone on a Missing run', async () => {
      mocks.personCover.getPersonCover.mockResolvedValue({
        source: 'auto',
        faceId: 'face-old',
        candidateCount: 2,
        version: PERSON_COVER_VERSION,
      });

      await expect(sut.handlePersonCover({ id: person.personGroupId })).resolves.toBe(JobStatus.Skipped);

      expect(ensureLocalFile).not.toHaveBeenCalled();
      expect(mocks.personCover.applyPersonPick).not.toHaveBeenCalled();
    });

    it('looks again at an automatic pick once the candidates grew by a quarter', async () => {
      mocks.personCover.getPersonCover.mockResolvedValue({
        source: 'auto',
        faceId: 'face-old',
        candidateCount: 1,
        version: PERSON_COVER_VERSION,
      });

      await sut.handlePersonCover({ id: person.personGroupId });

      expect(mocks.personCover.applyPersonPick).toHaveBeenCalledWith(expect.objectContaining({ faceId: 'face-sharp' }));
    });

    it('skips hidden people and pets', async () => {
      for (const skipped of [
        { ...person, isHidden: true },
        { ...person, type: 'pet' as const },
      ]) {
        mocks.person.getByGroupIdOnly.mockResolvedValue(skipped as never);

        await expect(sut.handlePersonCover({ id: person.personGroupId, force: true })).resolves.toBe(JobStatus.Skipped);
      }

      expect(mocks.personCover.applyPersonPick).not.toHaveBeenCalled();
    });

    it('records the count without reading a preview when there is only one candidate', async () => {
      givenFaces([candidate('face-old')]);

      await sut.handlePersonCover({ id: person.personGroupId });

      expect(ensureLocalFile).not.toHaveBeenCalled();
      expect(mocks.personCover.applyPersonPick).toHaveBeenCalledWith({
        personGroupId: person.personGroupId,
        faceId: null,
        candidateCount: 1,
        mode: 'missing',
      });
    });

    it('keeps the current cover within the margin, and queues no thumbnail', async () => {
      // Two flat faces: the only difference is the date, worth 0.15 at most, but the current one is newer.
      givenFaces([candidate('face-old'), candidate('face-other', { date: new Date('2026-01-01T12:00:00Z') })]);
      mocks.personCover.applyPersonPick.mockResolvedValue('unchanged');

      await sut.handlePersonCover({ id: person.personGroupId });

      expect(mocks.personCover.applyPersonPick).toHaveBeenCalledWith(expect.objectContaining({ faceId: 'face-old' }));
      expect(mocks.job.queue).not.toHaveBeenCalled();
    });

    it('does nothing while the setting is off', async () => {
      setConfig(false);

      await expect(sut.handlePersonCover({ id: person.personGroupId })).resolves.toBe(JobStatus.Skipped);

      expect(mocks.person.getByGroupIdOnly).not.toHaveBeenCalled();
    });

    describe('identity', () => {
      const linked = PersonFactory.create({ faceAssetId: 'face-old', identityId: 'identity-1' });

      beforeEach(() => {
        mocks.person.getByGroupIdOnly.mockResolvedValue(linked);
      });

      it('leaves the person to a hand-picked cover elsewhere in its identity that is one of its own faces', async () => {
        mocks.personCover.getIdentityHandPickedCovers.mockResolvedValue([
          { faceId: 'face-old', facePersonGroupId: linked.personGroupId },
        ]);

        await expect(sut.handlePersonCover({ id: linked.personGroupId, force: true })).resolves.toBe(JobStatus.Skipped);

        expect(mocks.personCover.applyPersonPick).not.toHaveBeenCalled();
      });

      it('picks when the hand-picked face is on another person', async () => {
        mocks.personCover.getIdentityHandPickedCovers.mockResolvedValue([
          { faceId: 'face-elsewhere', facePersonGroupId: 'person-2' },
        ]);

        await sut.handlePersonCover({ id: linked.personGroupId });

        expect(mocks.personCover.applyPersonPick).toHaveBeenCalledWith(
          expect.objectContaining({ faceId: 'face-sharp' }),
        );
      });
    });
  });

  describe('chooseAutomatically', () => {
    const auth = AuthFactory.create();
    const person = PersonFactory.create({ faceAssetId: 'face-old', identityId: 'identity-1' });

    beforeEach(() => {
      mocks.access.galleryPerson.checkOwnerAccess.mockResolvedValue(new Set([person.personGroupId]));
      mocks.person.getByGroupIdOnly.mockResolvedValue(person);
      givenFaces([candidate('face-old'), candidate('face-sharp')], 'face-sharp');
    });

    it('replaces a hand-picked cover, ignores the identity rule, and works with the setting off', async () => {
      setConfig(false);
      mocks.personCover.getPersonCover.mockResolvedValue({
        source: 'manual',
        faceId: 'face-old',
        candidateCount: null,
        version: null,
      });
      mocks.personCover.getIdentityHandPickedCovers.mockResolvedValue([
        { faceId: 'face-old', facePersonGroupId: person.personGroupId },
      ]);

      await expect(sut.chooseAutomatically(auth, person.personGroupId)).resolves.toEqual(
        expect.objectContaining({ id: person.personGroupId }),
      );

      expect(mocks.personCover.applyPersonPick).toHaveBeenCalledWith({
        personGroupId: person.personGroupId,
        faceId: 'face-sharp',
        candidateCount: 2,
        mode: 'action',
      });
    });

    it('takes the best face without the margin', async () => {
      givenFaces([candidate('face-old'), candidate('face-new', { date: new Date('2026-07-01T12:00:00Z') })]);

      await sut.chooseAutomatically(auth, person.personGroupId);

      expect(mocks.personCover.applyPersonPick).toHaveBeenCalledWith(expect.objectContaining({ faceId: 'face-new' }));
    });

    it('picks the only candidate', async () => {
      givenFaces([candidate('face-only')]);

      await sut.chooseAutomatically(auth, person.personGroupId);

      expect(mocks.personCover.applyPersonPick).toHaveBeenCalledWith(expect.objectContaining({ faceId: 'face-only' }));
    });

    it('answers 400 when the person has no photo to choose from', async () => {
      givenFaces([]);

      await expect(sut.chooseAutomatically(auth, person.personGroupId)).rejects.toThrow(BadRequestException);

      expect(mocks.personCover.applyPersonPick).not.toHaveBeenCalled();
    });

    it('is owner only', async () => {
      mocks.access.galleryPerson.checkOwnerAccess.mockResolvedValue(new Set());

      await expect(sut.chooseAutomatically(auth, person.personGroupId)).rejects.toThrow(BadRequestException);

      expect(mocks.person.getByGroupIdOnly).not.toHaveBeenCalled();
    });
  });

  describe('handleSpacePersonCover', () => {
    const spacePerson = {
      id: 'space-person-1',
      spaceId: 'space-1',
      isHidden: false,
      type: 'person',
      identityId: 'identity-1',
      representativeFaceId: 'face-old',
      representativeFaceSource: 'auto',
    };

    beforeEach(() => {
      mocks.sharedSpace.getPersonById.mockResolvedValue(spacePerson as never);
      mocks.personCover.getSpacePersonCover.mockResolvedValue(undefined);
      givenFaces([candidate('face-old'), candidate('face-sharp')], 'face-sharp');
    });

    it('picks from the faces reachable in the space', async () => {
      await expect(sut.handleSpacePersonCover({ id: spacePerson.id })).resolves.toBe(JobStatus.Success);

      expect(mocks.personCover.getSpacePersonCandidates).toHaveBeenCalledWith(spacePerson.id);
      expect(mocks.personCover.applySpacePersonPick).toHaveBeenCalledWith({
        spacePersonId: spacePerson.id,
        faceId: 'face-sharp',
        candidateCount: 2,
      });
    });

    it('never touches a hand-picked space cover, even on an All run', async () => {
      mocks.sharedSpace.getPersonById.mockResolvedValue({
        ...spacePerson,
        representativeFaceSource: 'manual',
      } as never);

      await expect(sut.handleSpacePersonCover({ id: spacePerson.id, force: true })).resolves.toBe(JobStatus.Skipped);

      expect(mocks.personCover.applySpacePersonPick).not.toHaveBeenCalled();
    });

    it('leaves a fresh pick alone on a Missing run', async () => {
      mocks.personCover.getSpacePersonCover.mockResolvedValue({
        faceId: 'face-old',
        candidateCount: 2,
        version: PERSON_COVER_VERSION,
      });

      await expect(sut.handleSpacePersonCover({ id: spacePerson.id })).resolves.toBe(JobStatus.Skipped);

      expect(mocks.personCover.applySpacePersonPick).not.toHaveBeenCalled();
    });

    it('leaves the space person to a hand-picked face of its identity that is valid in the space', async () => {
      mocks.personCover.getIdentityHandPickedCovers.mockResolvedValue([
        { faceId: 'face-owner-pick', facePersonGroupId: 'person-1' },
      ]);
      mocks.sharedSpace.isSpacePersonRepresentativeFaceValid.mockResolvedValue(true);

      await expect(sut.handleSpacePersonCover({ id: spacePerson.id })).resolves.toBe(JobStatus.Skipped);

      expect(mocks.sharedSpace.isSpacePersonRepresentativeFaceValid).toHaveBeenCalledWith(
        spacePerson.id,
        'face-owner-pick',
      );
      expect(mocks.personCover.applySpacePersonPick).not.toHaveBeenCalled();
    });

    it('picks when that hand-picked face is not in the space', async () => {
      mocks.personCover.getIdentityHandPickedCovers.mockResolvedValue([
        { faceId: 'face-owner-pick', facePersonGroupId: 'person-1' },
      ]);
      mocks.sharedSpace.isSpacePersonRepresentativeFaceValid.mockResolvedValue(false);

      await sut.handleSpacePersonCover({ id: spacePerson.id });

      expect(mocks.personCover.applySpacePersonPick).toHaveBeenCalledWith(
        expect.objectContaining({ faceId: 'face-sharp' }),
      );
    });
  });
});
