import { JobName, JobStatus, SystemMetadataKey } from 'src/enum';
import { PetRecognitionService } from 'src/services/pet-recognition.service';
import { makeStream, newTestService, ServiceMocks } from 'test/utils';

const enabledConfig = {
  machineLearning: {
    enabled: true,
    petRecognition: { enabled: true, modelName: 'pet-recognition-base', maxDistance: 0.55, minFaces: 1 },
  },
};

const makePetFace = (overrides: Record<string, unknown> = {}) => ({
  id: 'face-id',
  assetId: 'asset-id',
  personId: null,
  asset: { ownerId: 'owner-id' },
  petSearch: { faceId: 'face-id', embedding: '[1,2,3]', species: null },
  ...overrides,
});

const makePerson = (overrides: Record<string, unknown> = {}) => ({
  id: 'person-id',
  identityId: null,
  ownerId: 'owner-id',
  name: '',
  type: 'pet',
  species: 'dog',
  createdAt: new Date(),
  updatedAt: new Date(),
  updateId: 'update-id',
  birthDate: null,
  color: null,
  faceAssetId: null,
  isFavorite: false,
  isHidden: false,
  thumbnailPath: '',
  ...overrides,
});

describe(PetRecognitionService.name, () => {
  let sut: PetRecognitionService;
  let mocks: ServiceMocks;

  beforeEach(() => {
    ({ sut, mocks } = newTestService(PetRecognitionService));
  });

  it('should work', () => {
    expect(sut).toBeDefined();
  });

  describe('handleQueuePetRecognition', () => {
    it('should skip when pet recognition is disabled (default)', async () => {
      expect(await sut.handleQueuePetRecognition({ force: false })).toEqual(JobStatus.Skipped);

      expect(mocks.person.deleteAllPets).not.toHaveBeenCalled();
      expect(mocks.person.getUnassignedPetFaces).not.toHaveBeenCalled();
      expect(mocks.systemMetadata.set).not.toHaveBeenCalled();
    });

    it('should skip when machine learning is disabled even if pet recognition is enabled', async () => {
      mocks.systemMetadata.get.mockResolvedValue({
        machineLearning: { enabled: false, petRecognition: { enabled: true } },
      });

      expect(await sut.handleQueuePetRecognition({ force: false })).toEqual(JobStatus.Skipped);
    });

    describe('when pet recognition is enabled', () => {
      beforeEach(() => {
        mocks.systemMetadata.get.mockResolvedValue(enabledConfig);
        mocks.sharedSpace.deleteAllPets.mockResolvedValue(void 0);
      });

      it('force: true purges pet people, space copies and pet_search, then requeues detection with force (6.1)', async () => {
        expect(await sut.handleQueuePetRecognition({ force: true })).toEqual(JobStatus.Success);

        expect(mocks.person.deleteAllPets).toHaveBeenCalled();
        expect(mocks.sharedSpace.deleteAllPets).toHaveBeenCalled();
        expect(mocks.person.deleteAllPetSearch).toHaveBeenCalled();
        expect(mocks.job.queue).toHaveBeenCalledWith({ name: JobName.PetDetectionQueueAll, data: { force: true } });
        expect(mocks.person.getUnassignedPetFaces).not.toHaveBeenCalled();
      });

      it('force: false queues PetRecognition only for embedded, unassigned pet faces (6.2)', async () => {
        mocks.person.getUnassignedPetFaces.mockReturnValue(makeStream([{ id: 'face-1' }, { id: 'face-2' }]));

        expect(await sut.handleQueuePetRecognition({ force: false })).toEqual(JobStatus.Success);

        expect(mocks.job.queueAll).toHaveBeenCalledWith([
          { name: JobName.PetRecognition, data: { id: 'face-1', deferred: false } },
          { name: JobName.PetRecognition, data: { id: 'face-2', deferred: false } },
        ]);
        expect(mocks.person.deleteAllPets).not.toHaveBeenCalled();
        expect(mocks.person.deleteAllPetSearch).not.toHaveBeenCalled();
        expect(mocks.job.queue).not.toHaveBeenCalledWith(
          expect.objectContaining({ name: JobName.PetDetectionQueueAll }),
        );
      });

      it('nightly: true skips without queueing when lastRun is newer than the newest pet face (6.3)', async () => {
        const lastRun = new Date('2026-07-20T00:00:00.000Z');
        mocks.systemMetadata.get.mockResolvedValue({ ...enabledConfig, lastRun: lastRun.toISOString() });
        mocks.person.getLatestPetDate.mockResolvedValue(new Date(lastRun.getTime() - 1000).toISOString());

        expect(await sut.handleQueuePetRecognition({ force: false, nightly: true })).toEqual(JobStatus.Skipped);

        expect(mocks.person.getUnassignedPetFaces).not.toHaveBeenCalled();
        expect(mocks.job.queueAll).not.toHaveBeenCalled();
        expect(mocks.job.queue).not.toHaveBeenCalled();
        expect(mocks.systemMetadata.set).not.toHaveBeenCalled();
      });

      it('nightly: true with an older lastRun queues work (6.4)', async () => {
        const lastRun = new Date('2026-07-20T00:00:00.000Z');
        mocks.systemMetadata.get.mockResolvedValue({ ...enabledConfig, lastRun: lastRun.toISOString() });
        mocks.person.getLatestPetDate.mockResolvedValue(new Date(lastRun.getTime() + 1000).toISOString());
        mocks.person.getUnassignedPetFaces.mockReturnValue(makeStream([{ id: 'face-1' }]));

        expect(await sut.handleQueuePetRecognition({ force: false, nightly: true })).toEqual(JobStatus.Success);

        expect(mocks.job.queueAll).toHaveBeenCalledWith([
          { name: JobName.PetRecognition, data: { id: 'face-1', deferred: false } },
        ]);
      });

      it('nightly: true with no prior lastRun queues work (first-ever nightly run)', async () => {
        mocks.person.getLatestPetDate.mockResolvedValue('2026-07-20T00:00:00.000Z');
        mocks.person.getUnassignedPetFaces.mockReturnValue(makeStream([{ id: 'face-1' }]));

        expect(await sut.handleQueuePetRecognition({ force: false, nightly: true })).toEqual(JobStatus.Success);

        expect(mocks.job.queueAll).toHaveBeenCalledWith([
          { name: JobName.PetRecognition, data: { id: 'face-1', deferred: false } },
        ]);
      });

      it('records lastRun and modelName in system metadata after a run (6.5)', async () => {
        mocks.person.getUnassignedPetFaces.mockReturnValue(makeStream([]));

        expect(await sut.handleQueuePetRecognition({ force: false })).toEqual(JobStatus.Success);

        expect(mocks.systemMetadata.set).toHaveBeenCalledWith(SystemMetadataKey.PetRecognitionState, {
          lastRun: expect.any(String),
          modelName: 'pet-recognition-base',
        });
      });

      it('records lastRun and modelName on a force run too', async () => {
        expect(await sut.handleQueuePetRecognition({ force: true })).toEqual(JobStatus.Success);

        expect(mocks.systemMetadata.set).toHaveBeenCalledWith(SystemMetadataKey.PetRecognitionState, {
          lastRun: expect.any(String),
          modelName: 'pet-recognition-base',
        });
      });
    });
  });

  describe('handlePetRecognition', () => {
    it('should skip when pet recognition is disabled (default) and not touch the repositories', async () => {
      expect(await sut.handlePetRecognition({ id: 'face-id' })).toEqual(JobStatus.Skipped);

      expect(mocks.person.getPetFaceForRecognition).not.toHaveBeenCalled();
      expect(mocks.search.searchPets).not.toHaveBeenCalled();
    });

    it('should skip when machine learning is disabled even if pet recognition is enabled', async () => {
      mocks.systemMetadata.get.mockResolvedValue({
        machineLearning: { enabled: false, petRecognition: { enabled: true } },
      });

      expect(await sut.handlePetRecognition({ id: 'face-id' })).toEqual(JobStatus.Skipped);
      expect(mocks.search.searchPets).not.toHaveBeenCalled();
    });

    describe('when pet recognition is enabled', () => {
      beforeEach(() => {
        mocks.systemMetadata.get.mockResolvedValue(enabledConfig);
      });

      it('fails when the face is not found', async () => {
        mocks.person.getPetFaceForRecognition.mockResolvedValue(void 0);

        expect(await sut.handlePetRecognition({ id: 'face-id' })).toEqual(JobStatus.Failed);
        expect(mocks.search.searchPets).not.toHaveBeenCalled();
      });

      it('should skip and not throw when the face has no embedding row (5.8)', async () => {
        mocks.person.getPetFaceForRecognition.mockResolvedValue(makePetFace({ petSearch: null }));

        expect(await sut.handlePetRecognition({ id: 'face-id' })).toEqual(JobStatus.Skipped);
        expect(mocks.search.searchPets).not.toHaveBeenCalled();
      });

      it('should skip and not search when the face already has a person assigned (5.7)', async () => {
        mocks.person.getPetFaceForRecognition.mockResolvedValue(makePetFace({ personId: 'existing-person' }));
        mocks.faceIdentity.ensurePersonIdentity.mockResolvedValue({ id: 'identity-id' } as any);

        expect(await sut.handlePetRecognition({ id: 'face-id' })).toEqual(JobStatus.Skipped);

        expect(mocks.search.searchPets).not.toHaveBeenCalled();
        expect(mocks.faceIdentity.ensurePersonIdentity).toHaveBeenCalledWith('existing-person');
        expect(mocks.faceIdentity.replaceFaceIdentity).toHaveBeenCalledWith({
          assetFaceId: 'face-id',
          identityId: 'identity-id',
          source: 'owner-person',
        });
        expect(mocks.person.reassignFaces).not.toHaveBeenCalled();
      });

      it('creates a new pet person with the detected species when there is no match (5.5)', async () => {
        mocks.person.getPetFaceForRecognition.mockResolvedValue(makePetFace());
        mocks.search.searchPets
          .mockResolvedValueOnce([{ id: 'face-id', personId: null, distance: 0 }])
          .mockResolvedValueOnce([]);
        mocks.person.create.mockResolvedValue(makePerson({ id: 'new-person' }));
        mocks.faceIdentity.ensurePersonIdentity.mockResolvedValue({ id: 'new-identity' } as any);
        mocks.person.getById.mockResolvedValue(makePerson({ id: 'new-person', faceAssetId: null }));
        mocks.sharedSpace.getSpaceIdsForAsset.mockResolvedValue([]);

        expect(await sut.handlePetRecognition({ id: 'face-id', label: 'dog' })).toEqual(JobStatus.Success);

        expect(mocks.person.create).toHaveBeenCalledWith({
          ownerId: 'owner-id',
          type: 'pet',
          species: 'dog',
          name: '',
        });
        expect(mocks.person.reassignFaces).toHaveBeenCalledWith({ faceIds: ['face-id'], newPersonId: 'new-person' });
      });

      it('R4.3 falls back to the stored pet_search species when the job carries no label', async () => {
        // The queue-all and nightly fan-outs have no label in their job data (F8) — the species
        // persisted at embed time is the only thing that can stamp the new person.
        mocks.person.getPetFaceForRecognition.mockResolvedValue(
          makePetFace({ petSearch: { faceId: 'face-id', embedding: '[1,2,3]', species: 'cat' } }),
        );
        mocks.search.searchPets
          .mockResolvedValueOnce([{ id: 'face-id', personId: null, distance: 0 }])
          .mockResolvedValueOnce([]);
        mocks.person.create.mockResolvedValue(makePerson({ id: 'new-person', species: 'cat' }));
        mocks.faceIdentity.ensurePersonIdentity.mockResolvedValue({ id: 'new-identity' } as any);
        mocks.person.getById.mockResolvedValue(makePerson({ id: 'new-person', faceAssetId: null }));
        mocks.sharedSpace.getSpaceIdsForAsset.mockResolvedValue([]);

        expect(await sut.handlePetRecognition({ id: 'face-id' })).toEqual(JobStatus.Success);

        expect(mocks.person.create).toHaveBeenCalledWith(expect.objectContaining({ species: 'cat' }));
      });

      it('R4.4 pin: an explicit job label still wins over the stored species', async () => {
        mocks.person.getPetFaceForRecognition.mockResolvedValue(
          makePetFace({ petSearch: { faceId: 'face-id', embedding: '[1,2,3]', species: 'cat' } }),
        );
        mocks.search.searchPets
          .mockResolvedValueOnce([{ id: 'face-id', personId: null, distance: 0 }])
          .mockResolvedValueOnce([]);
        mocks.person.create.mockResolvedValue(makePerson({ id: 'new-person' }));
        mocks.faceIdentity.ensurePersonIdentity.mockResolvedValue({ id: 'new-identity' } as any);
        mocks.person.getById.mockResolvedValue(makePerson({ id: 'new-person', faceAssetId: null }));
        mocks.sharedSpace.getSpaceIdsForAsset.mockResolvedValue([]);

        expect(await sut.handlePetRecognition({ id: 'face-id', label: 'dog' })).toEqual(JobStatus.Success);

        expect(mocks.person.create).toHaveBeenCalledWith(expect.objectContaining({ species: 'dog' }));
      });

      it('assigns to a person already matched by search without creating a new person (5.6)', async () => {
        mocks.person.getPetFaceForRecognition.mockResolvedValue(makePetFace());
        mocks.search.searchPets.mockResolvedValue([
          { id: 'face-id', personId: null, distance: 0 },
          { id: 'other-face', personId: 'matched-person', distance: 0.1 },
        ]);
        mocks.faceIdentity.ensurePersonIdentity.mockResolvedValue({ id: 'matched-identity' } as any);
        mocks.person.getById.mockResolvedValue(makePerson({ id: 'matched-person', faceAssetId: 'existing-face' }));
        mocks.sharedSpace.getSpaceIdsForAsset.mockResolvedValue([]);

        expect(await sut.handlePetRecognition({ id: 'face-id' })).toEqual(JobStatus.Success);

        expect(mocks.person.create).not.toHaveBeenCalled();
        expect(mocks.person.reassignFaces).toHaveBeenCalledWith({
          faceIds: ['face-id'],
          newPersonId: 'matched-person',
        });
        // matched-person already has a representative face, so no update/thumbnail job.
        expect(mocks.person.update).not.toHaveBeenCalled();
      });

      it('requeues with deferred:true and does not create a person when not core (5.9)', async () => {
        mocks.systemMetadata.get.mockResolvedValue({
          machineLearning: {
            enabled: true,
            petRecognition: { enabled: true, modelName: 'pet-recognition-base', maxDistance: 0.55, minFaces: 2 },
          },
        });
        mocks.person.getPetFaceForRecognition.mockResolvedValue(makePetFace());
        mocks.search.searchPets.mockResolvedValue([{ id: 'face-id', personId: null, distance: 0 }]);

        expect(await sut.handlePetRecognition({ id: 'face-id', label: 'dog' })).toEqual(JobStatus.Skipped);

        expect(mocks.job.queue).toHaveBeenCalledWith({
          name: JobName.PetRecognition,
          data: { id: 'face-id', deferred: true, label: 'dog' },
        });
        expect(mocks.person.create).not.toHaveBeenCalled();
        expect(mocks.person.reassignFaces).not.toHaveBeenCalled();
      });

      it('does not requeue a second time when already deferred and still not core (5.10)', async () => {
        mocks.systemMetadata.get.mockResolvedValue({
          machineLearning: {
            enabled: true,
            petRecognition: { enabled: true, modelName: 'pet-recognition-base', maxDistance: 0.55, minFaces: 2 },
          },
        });
        mocks.person.getPetFaceForRecognition.mockResolvedValue(makePetFace());
        mocks.search.searchPets
          .mockResolvedValueOnce([{ id: 'face-id', personId: null, distance: 0 }])
          .mockResolvedValueOnce([]);

        expect(await sut.handlePetRecognition({ id: 'face-id', deferred: true, label: 'dog' })).toEqual(
          JobStatus.Skipped,
        );

        expect(mocks.job.queue).not.toHaveBeenCalledWith(expect.objectContaining({ name: JobName.PetRecognition }));
        expect(mocks.person.create).not.toHaveBeenCalled();
      });

      it('links face_identity with type pet (via ensurePersonIdentity) and source owner-person when assigning (5.11)', async () => {
        mocks.person.getPetFaceForRecognition.mockResolvedValue(makePetFace());
        mocks.search.searchPets
          .mockResolvedValueOnce([{ id: 'face-id', personId: null, distance: 0 }])
          .mockResolvedValueOnce([]);
        mocks.person.create.mockResolvedValue(makePerson({ id: 'new-person' }));
        mocks.faceIdentity.ensurePersonIdentity.mockResolvedValue({ id: 'new-identity' } as any);
        mocks.person.getById.mockResolvedValue(makePerson({ id: 'new-person', faceAssetId: null }));
        mocks.sharedSpace.getSpaceIdsForAsset.mockResolvedValue([]);

        expect(await sut.handlePetRecognition({ id: 'face-id', label: 'dog' })).toEqual(JobStatus.Success);

        // ensurePersonIdentity derives face_identity.type from person.type ('pet' — see
        // FaceIdentityRepository.ensurePersonIdentity), so calling it on a type:'pet' person is
        // what stamps the identity as type='pet'.
        expect(mocks.faceIdentity.ensurePersonIdentity).toHaveBeenCalledWith('new-person');
        expect(mocks.faceIdentity.replaceFaceIdentity).toHaveBeenCalledWith({
          assetFaceId: 'face-id',
          identityId: 'new-identity',
          source: 'owner-person',
        });
      });

      it('queues SharedSpaceFaceMatch for the asset after assignment (5.12)', async () => {
        mocks.person.getPetFaceForRecognition.mockResolvedValue(makePetFace({ assetId: 'asset-1' }));
        mocks.search.searchPets
          .mockResolvedValueOnce([{ id: 'face-id', personId: null, distance: 0 }])
          .mockResolvedValueOnce([]);
        mocks.person.create.mockResolvedValue(makePerson({ id: 'new-person' }));
        mocks.faceIdentity.ensurePersonIdentity.mockResolvedValue({ id: 'new-identity' } as any);
        mocks.person.getById.mockResolvedValue(makePerson({ id: 'new-person', faceAssetId: null }));
        mocks.sharedSpace.getSpaceIdsForAsset.mockResolvedValue([{ spaceId: 'space-1' }, { spaceId: 'space-2' }]);

        expect(await sut.handlePetRecognition({ id: 'face-id', label: 'dog' })).toEqual(JobStatus.Success);

        expect(mocks.job.queue).toHaveBeenCalledWith({
          name: JobName.SharedSpaceFaceMatch,
          data: { spaceId: 'space-1', assetId: 'asset-1' },
        });
        expect(mocks.job.queue).toHaveBeenCalledWith({
          name: JobName.SharedSpaceFaceMatch,
          data: { spaceId: 'space-2', assetId: 'asset-1' },
        });
      });

      it('passes the configured maxDistance to the search, so an out-of-range match is not returned and a new person is created (5.13)', async () => {
        mocks.person.getPetFaceForRecognition.mockResolvedValue(makePetFace());
        mocks.search.searchPets
          .mockResolvedValueOnce([{ id: 'face-id', personId: null, distance: 0 }])
          .mockResolvedValueOnce([]);
        mocks.person.create.mockResolvedValue(makePerson({ id: 'new-person' }));
        mocks.faceIdentity.ensurePersonIdentity.mockResolvedValue({ id: 'new-identity' } as any);
        mocks.person.getById.mockResolvedValue(makePerson({ id: 'new-person', faceAssetId: null }));
        mocks.sharedSpace.getSpaceIdsForAsset.mockResolvedValue([]);

        expect(await sut.handlePetRecognition({ id: 'face-id', label: 'dog' })).toEqual(JobStatus.Success);

        expect(mocks.search.searchPets).toHaveBeenCalledWith(expect.objectContaining({ maxDistance: 0.55 }));
        expect(mocks.person.create).toHaveBeenCalledWith(expect.objectContaining({ species: 'dog' }));
      });

      it('sets the representative face and queues PersonGenerateThumbnail when the resolved person has none', async () => {
        mocks.person.getPetFaceForRecognition.mockResolvedValue(makePetFace());
        mocks.search.searchPets
          .mockResolvedValueOnce([{ id: 'face-id', personId: null, distance: 0 }])
          .mockResolvedValueOnce([]);
        mocks.person.create.mockResolvedValue(makePerson({ id: 'new-person' }));
        mocks.faceIdentity.ensurePersonIdentity.mockResolvedValue({ id: 'new-identity' } as any);
        mocks.person.getById.mockResolvedValue(makePerson({ id: 'new-person', faceAssetId: null }));
        mocks.sharedSpace.getSpaceIdsForAsset.mockResolvedValue([]);

        expect(await sut.handlePetRecognition({ id: 'face-id', label: 'dog' })).toEqual(JobStatus.Success);

        expect(mocks.person.update).toHaveBeenCalledWith({ id: 'new-person', faceAssetId: 'face-id' });
        expect(mocks.job.queue).toHaveBeenCalledWith({
          name: JobName.PersonGenerateThumbnail,
          data: { id: 'new-person' },
        });
      });
    });
  });
});
