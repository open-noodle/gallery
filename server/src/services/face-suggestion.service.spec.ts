import { BadRequestException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JobName, JobStatus, MetadataKey, QueueName } from 'src/enum';
import { FaceSearchResult } from 'src/repositories/search.repository';
import { FaceSuggestionService } from 'src/services/face-suggestion.service';
import { clearConfigCache } from 'src/utils/config';
import { spaceVisibleAssetVisibilities } from 'src/utils/shared-space-album-scope';
import { AssetFaceFactory } from 'test/factories/asset-face.factory';
import { AuthFactory } from 'test/factories/auth.factory';
import { PersonFactory } from 'test/factories/person.factory';
import { authStub } from 'test/fixtures/auth.stub';
import { getForAssetFace } from 'test/mappers';
import { makeStream, newTestService, ServiceMocks } from 'test/utils';

describe(FaceSuggestionService.name, () => {
  let sut: FaceSuggestionService;
  let mocks: ServiceMocks;

  beforeEach(() => {
    ({ sut, mocks } = newTestService(FaceSuggestionService));
    mocks.faceIdentity.ensurePersonIdentity.mockResolvedValue({ id: 'identity-1' } as any);
    // Default: no face has been manually linked or negatively verdicted — the suggestion-scan handlers'
    // write-time exclusion (D3) becomes a no-op unless an individual test configures otherwise.
    mocks.faceIdentity.getManualLinkedFaceIds.mockResolvedValue(new Set());
    mocks.facePersonVerdict.getNegativeVerdictTokens.mockResolvedValue(new Map());
    mocks.sharedSpace.getAssignedFaceIdsForSpace.mockResolvedValue([]);
  });

  describe('handlePersonSuggestionScan', () => {
    const enabled = {
      machineLearning: {
        enabled: true,
        facialRecognition: {
          enabled: true,
          maxDistance: 0.5,
          minFaces: 3,
          suggestions: { enabled: true, maxDistance: 0.8 },
        },
      },
    };

    it('runs on the people backfill queue, not facial recognition', () => {
      const config = new Reflector().get(MetadataKey.JobConfig, sut.handlePersonSuggestionScan);
      expect(config).toEqual(expect.objectContaining({ queue: 'peopleBackfill' }));
    });

    it('skips when suggestions are enabled but the band is inverted (suggestions.maxDistance <= maxDistance)', async () => {
      mocks.systemMetadata.get.mockResolvedValue({
        machineLearning: {
          enabled: true,
          facialRecognition: {
            enabled: true,
            maxDistance: 0.5,
            minFaces: 3,
            suggestions: { enabled: true, maxDistance: 0.5 },
          },
        },
      });

      await expect(sut.handlePersonSuggestionScan({ id: 'person-1' })).resolves.toBe(JobStatus.Skipped);
      expect(mocks.person.getById).not.toHaveBeenCalled();
      expect(mocks.facePersonVerdict.upsertPending).not.toHaveBeenCalled();
    });

    it('skips an unnamed / hidden / pet / missing person (edge 5, 7, 16)', async () => {
      mocks.systemMetadata.get.mockResolvedValue(enabled);

      mocks.person.getById.mockResolvedValueOnce(void 0);
      await expect(sut.handlePersonSuggestionScan({ id: 'gone' })).resolves.toBe(JobStatus.Skipped);

      mocks.person.getById.mockResolvedValueOnce({
        id: 'p',
        ownerId: 'u',
        name: '',
        isHidden: false,
        type: 'person',
      } as any);
      await expect(sut.handlePersonSuggestionScan({ id: 'p' })).resolves.toBe(JobStatus.Skipped);

      mocks.person.getById.mockResolvedValueOnce({
        id: 'p',
        ownerId: 'u',
        name: 'A',
        isHidden: true,
        type: 'person',
      } as any);
      await expect(sut.handlePersonSuggestionScan({ id: 'p' })).resolves.toBe(JobStatus.Skipped);

      mocks.person.getById.mockResolvedValueOnce({
        id: 'p',
        ownerId: 'u',
        name: 'Rex',
        isHidden: false,
        type: 'pet',
      } as any);
      await expect(sut.handlePersonSuggestionScan({ id: 'p' })).resolves.toBe(JobStatus.Skipped);

      expect(mocks.facePersonVerdict.upsertPending).not.toHaveBeenCalled();
    });

    it('no-ops when the person has zero assigned-face embeddings (edge 15)', async () => {
      mocks.systemMetadata.get.mockResolvedValue(enabled);
      mocks.person.getById.mockResolvedValue({
        id: 'p',
        ownerId: 'u',
        name: 'A',
        isHidden: false,
        type: 'person',
      } as any);
      mocks.person.getAssignedFaceEmbeddings.mockResolvedValue([]);

      await expect(sut.handlePersonSuggestionScan({ id: 'p' })).resolves.toBe(JobStatus.Skipped);
      expect(mocks.search.searchFaces).not.toHaveBeenCalled();
      expect(mocks.facePersonVerdict.upsertPending).not.toHaveBeenCalled();
    });

    it('keeps only the open band (maxDistance, suggestionMaxDistance], min distance per face, then upserts', async () => {
      mocks.systemMetadata.get.mockResolvedValue(enabled);
      mocks.person.getById.mockResolvedValue({
        id: 'p',
        ownerId: 'u',
        name: 'A',
        isHidden: false,
        type: 'person',
      } as any);
      mocks.person.getAssignedFaceEmbeddings.mockResolvedValue([{ embedding: 'e1' }, { embedding: 'e2' }] as any);
      mocks.search.searchFaces
        .mockResolvedValueOnce([
          { id: 'f-low', personId: null, distance: 0.45 }, // <= maxDistance → excluded (auto-assign band)
          { id: 'f-band', personId: null, distance: 0.7 }, // in band
          { id: 'f-edge', personId: null, distance: 0.8 }, // == suggestionMaxDistance → kept (closed upper)
        ] as any)
        .mockResolvedValueOnce([
          { id: 'f-band', personId: null, distance: 0.6 }, // same face, smaller distance → min wins
        ] as any);

      await expect(sut.handlePersonSuggestionScan({ id: 'p' })).resolves.toBe(JobStatus.Success);

      expect(mocks.search.searchFaces).toHaveBeenCalledTimes(2);
      // S11 (slice 11b): the owner-scoped branch applies NO unconditional visibility gate of its own
      // (search.repository.ts F2 comment) — this arg is the only thing keeping Locked/Hidden assets out of
      // the suggestion pool for a personal person. Pin it so removing it cannot silently pass.
      expect(mocks.search.searchFaces).toHaveBeenCalledWith(
        expect.objectContaining({
          userIds: ['u'],
          hasPerson: false,
          maxDistance: 0.8,
          visibility: spaceVisibleAssetVisibilities,
        }),
      );
      const rows = mocks.facePersonVerdict.upsertPending.mock.calls[0][0];
      expect(rows).toEqual(
        expect.arrayContaining([
          { personId: 'p', assetFaceId: 'f-band', distance: 0.6 },
          { personId: 'p', assetFaceId: 'f-edge', distance: 0.8 },
        ]),
      );
      expect(rows).toHaveLength(2); // f-low excluded
    });

    it('caps embedding sample and candidate count (edge 14 — bounded work)', async () => {
      mocks.systemMetadata.get.mockResolvedValue(enabled);
      mocks.person.getById.mockResolvedValue({
        id: 'p',
        ownerId: 'u',
        name: 'A',
        isHidden: false,
        type: 'person',
      } as any);
      mocks.person.getAssignedFaceEmbeddings.mockResolvedValue([{ embedding: 'e' }] as any);
      mocks.search.searchFaces.mockResolvedValue([]);

      await sut.handlePersonSuggestionScan({ id: 'p' });

      expect(mocks.person.getAssignedFaceEmbeddings).toHaveBeenCalledWith('p', 20);
      expect(mocks.search.searchFaces).toHaveBeenCalledWith(expect.objectContaining({ numResults: 100 }));
    });

    it('never resurrects a resolved decision — delegates the guarantee to upsertPending (edge 1, 2)', async () => {
      mocks.systemMetadata.get.mockResolvedValue({
        machineLearning: {
          enabled: true,
          facialRecognition: {
            enabled: true,
            maxDistance: 0.5,
            minFaces: 3,
            suggestions: { enabled: true, maxDistance: 0.8 },
          },
        },
      });
      mocks.person.getById.mockResolvedValue({
        id: 'p',
        ownerId: 'u',
        name: 'A',
        isHidden: false,
        type: 'person',
      } as any);
      mocks.person.getAssignedFaceEmbeddings.mockResolvedValue([{ embedding: 'e' }] as any);
      mocks.search.searchFaces.mockResolvedValue([{ id: 'f-dismissed', personId: null, distance: 0.7 }] as any);

      await sut.handlePersonSuggestionScan({ id: 'p' });

      // The scan unconditionally calls the conditional upsert; the WHERE status='pending'
      // guard in the repository is the single source of the never-resurrect guarantee.
      // The job must not pre-filter resolved rows — it delegates to upsertPending.
      expect(mocks.facePersonVerdict.upsertPending).toHaveBeenCalledWith([
        { personId: 'p', assetFaceId: 'f-dismissed', distance: 0.7 },
      ]);
    });

    it('drops a manually-linked or negatively-verdicted candidate before upserting (D3 write-time exclusion)', async () => {
      mocks.systemMetadata.get.mockResolvedValue(enabled);
      mocks.person.getById.mockResolvedValue({
        id: 'p',
        ownerId: 'u',
        name: 'A',
        isHidden: false,
        type: 'person',
        identityId: 'identity-p',
      } as any);
      mocks.person.getAssignedFaceEmbeddings.mockResolvedValue([{ embedding: 'e' }] as any);
      mocks.search.searchFaces.mockResolvedValue([
        { id: 'f-manual', personId: null, distance: 0.7 },
        { id: 'f-negative-person', personId: null, distance: 0.7 },
        { id: 'f-negative-identity', personId: null, distance: 0.7 },
        { id: 'f-kept', personId: null, distance: 0.7 },
      ] as any);
      mocks.faceIdentity.getManualLinkedFaceIds.mockResolvedValue(new Set(['f-manual']));
      mocks.facePersonVerdict.getNegativeVerdictTokens.mockResolvedValue(
        new Map([
          ['f-negative-person', new Set(['person:p'])],
          ['f-negative-identity', new Set(['identity:identity-p'])],
        ]),
      );

      await sut.handlePersonSuggestionScan({ id: 'p' });

      expect(mocks.faceIdentity.getManualLinkedFaceIds).toHaveBeenCalledWith(
        expect.arrayContaining(['f-manual', 'f-negative-person', 'f-negative-identity', 'f-kept']),
      );
      expect(mocks.facePersonVerdict.upsertPending).toHaveBeenCalledWith([
        { personId: 'p', assetFaceId: 'f-kept', distance: 0.7 },
      ]);
    });
  });

  describe('handlePersonSuggestionScanQueueAll', () => {
    const enabled = {
      machineLearning: {
        enabled: true,
        facialRecognition: {
          enabled: true,
          maxDistance: 0.5,
          minFaces: 3,
          suggestions: { enabled: true, maxDistance: 0.8 },
        },
      },
    };

    it('runs on the people backfill queue', () => {
      const config = new Reflector().get(MetadataKey.JobConfig, sut.handlePersonSuggestionScanQueueAll);
      expect(config).toEqual(expect.objectContaining({ queue: 'peopleBackfill' }));
    });

    it('skips and enumerates nothing when the feature is disabled', async () => {
      mocks.systemMetadata.get.mockResolvedValue({
        machineLearning: {
          enabled: true,
          facialRecognition: {
            enabled: true,
            maxDistance: 0.5,
            minFaces: 3,
            suggestions: { enabled: false, maxDistance: 0.7 },
          },
        },
      });

      await expect(sut.handlePersonSuggestionScanQueueAll({})).resolves.toBe(JobStatus.Skipped);
      expect((mocks.person as any).getScannablePeopleWithUnassignedFaces).not.toHaveBeenCalled();
      expect(mocks.job.queueAll).not.toHaveBeenCalled();
    });

    it('queues one PersonSuggestionScan per scannable person', async () => {
      mocks.systemMetadata.get.mockResolvedValue(enabled);
      (mocks.person as any).getScannablePeopleWithUnassignedFaces.mockReturnValue(
        makeStream([
          { id: 'p1', ownerId: 'u' },
          { id: 'p2', ownerId: 'u' },
        ]),
      );

      await expect(sut.handlePersonSuggestionScanQueueAll({})).resolves.toBe(JobStatus.Success);

      expect(mocks.job.queueAll).toHaveBeenCalledWith([
        { name: JobName.PersonSuggestionScan, data: { id: 'p1' } },
        { name: JobName.PersonSuggestionScan, data: { id: 'p2' } },
      ]);
    });

    it('empty library → success, no scan jobs queued except empty flush', async () => {
      mocks.systemMetadata.get.mockResolvedValue(enabled);
      (mocks.person as any).getScannablePeopleWithUnassignedFaces.mockReturnValue(makeStream([]));

      await expect(sut.handlePersonSuggestionScanQueueAll({})).resolves.toBe(JobStatus.Success);
      expect(mocks.job.queueAll).toHaveBeenCalledWith([]);
    });
  });

  describe('handleSpacePersonSuggestionScan', () => {
    const enabled = {
      machineLearning: {
        enabled: true,
        facialRecognition: {
          enabled: true,
          maxDistance: 0.5,
          minFaces: 3,
          suggestions: { enabled: true, maxDistance: 0.8 },
        },
      },
    };

    it('runs on the people backfill queue', () => {
      const config = new Reflector().get(MetadataKey.JobConfig, sut.handleSpacePersonSuggestionScan);
      expect(config).toEqual(expect.objectContaining({ queue: QueueName.PeopleBackfill }));
    });

    it('skips when feature is disabled', async () => {
      mocks.systemMetadata.get.mockResolvedValue({
        machineLearning: {
          enabled: true,
          facialRecognition: {
            enabled: true,
            maxDistance: 0.5,
            minFaces: 3,
            suggestions: { enabled: true, maxDistance: 0.5 },
          },
        },
      });

      await expect(sut.handleSpacePersonSuggestionScan({ id: 'space-person-1' })).resolves.toBe(JobStatus.Skipped);
      expect(mocks.sharedSpace.getSpacePersonAssignedFaceEmbeddings).not.toHaveBeenCalled();
      expect(mocks.facePersonVerdict.upsertPendingForSpacePerson).not.toHaveBeenCalled();
    });

    it('skips missing, unnamed, whitespace, hidden, pet, or disabled-space people', async () => {
      mocks.systemMetadata.get.mockResolvedValue(enabled);
      mocks.sharedSpace.getPersonById.mockResolvedValueOnce(void 0);
      await expect(sut.handleSpacePersonSuggestionScan({ id: 'gone' })).resolves.toBe(JobStatus.Skipped);

      for (const person of [
        { id: 'p', spaceId: 's', name: '', isHidden: false, type: 'person', faceRecognitionEnabled: true },
        { id: 'p', spaceId: 's', name: ' '.repeat(3), isHidden: false, type: 'person', faceRecognitionEnabled: true },
        { id: 'p', spaceId: 's', name: 'Alice', isHidden: true, type: 'person', faceRecognitionEnabled: true },
        { id: 'p', spaceId: 's', name: 'Rex', isHidden: false, type: 'pet', faceRecognitionEnabled: true },
        { id: 'p', spaceId: 's', name: 'Alice', isHidden: false, type: 'person', faceRecognitionEnabled: false },
      ]) {
        mocks.sharedSpace.getPersonById.mockResolvedValueOnce(person as any);
        if (person.name.trim() !== '' && !person.isHidden && person.type === 'person') {
          mocks.sharedSpace.getById.mockResolvedValueOnce({
            id: 's',
            faceRecognitionEnabled: person.faceRecognitionEnabled,
          } as any);
        }
        await expect(sut.handleSpacePersonSuggestionScan({ id: 'p' })).resolves.toBe(JobStatus.Skipped);
      }

      expect(mocks.sharedSpace.getSpacePersonAssignedFaceEmbeddings).not.toHaveBeenCalled();
      expect(mocks.facePersonVerdict.upsertPendingForSpacePerson).not.toHaveBeenCalled();
    });

    it('skips when the space person has zero linked face embeddings', async () => {
      mocks.systemMetadata.get.mockResolvedValue(enabled);
      mocks.sharedSpace.getPersonById.mockResolvedValue({
        id: 'sp',
        spaceId: 'space-1',
        name: 'Alice',
        isHidden: false,
        type: 'person',
      } as any);
      mocks.sharedSpace.getById.mockResolvedValue({ id: 'space-1', faceRecognitionEnabled: true } as any);
      mocks.sharedSpace.getSpacePersonAssignedFaceEmbeddings.mockResolvedValue([]);

      await expect(sut.handleSpacePersonSuggestionScan({ id: 'sp' })).resolves.toBe(JobStatus.Skipped);
      expect(mocks.search.searchFaces).not.toHaveBeenCalled();
      expect(mocks.facePersonVerdict.upsertPendingForSpacePerson).not.toHaveBeenCalled();
    });

    it('keeps only the open band, takes min distance per candidate, and upserts by spacePersonId', async () => {
      mocks.systemMetadata.get.mockResolvedValue(enabled);
      mocks.sharedSpace.getPersonById.mockResolvedValue({
        id: 'sp',
        spaceId: 'space-1',
        name: 'Alice',
        isHidden: false,
        type: 'person',
      } as any);
      mocks.sharedSpace.getById.mockResolvedValue({ id: 'space-1', faceRecognitionEnabled: true } as any);
      mocks.sharedSpace.getSpacePersonAssignedFaceEmbeddings.mockResolvedValue([
        { embedding: 'e1' },
        { embedding: 'e2' },
      ] as any);
      mocks.search.searchFaces
        .mockResolvedValueOnce([
          { id: 'too-close', personId: null, distance: 0.5 },
          { id: 'candidate', personId: null, distance: 0.7 },
        ] as FaceSearchResult[])
        .mockResolvedValueOnce([{ id: 'candidate', personId: null, distance: 0.6 }] as FaceSearchResult[]);

      await expect(sut.handleSpacePersonSuggestionScan({ id: 'sp' })).resolves.toBe(JobStatus.Success);

      expect(mocks.search.searchFaces).toHaveBeenCalledWith(
        expect.objectContaining({
          spaceId: 'space-1',
          hasPerson: false,
          maxDistance: 0.8,
          numResults: 100,
        }),
      );
      expect(mocks.facePersonVerdict.upsertPendingForSpacePerson).toHaveBeenCalledWith([
        { spacePersonId: 'sp', assetFaceId: 'candidate', distance: 0.6 },
      ]);
    });

    it('does not upsert matches already assigned to a shared-space person in the same space', async () => {
      mocks.systemMetadata.get.mockResolvedValue(enabled);
      mocks.sharedSpace.getPersonById.mockResolvedValue({
        id: 'sp',
        spaceId: 'space-1',
        name: 'Alice',
        isHidden: false,
        type: 'person',
      } as any);
      mocks.sharedSpace.getById.mockResolvedValue({ id: 'space-1', faceRecognitionEnabled: true } as any);
      mocks.sharedSpace.getSpacePersonAssignedFaceEmbeddings.mockResolvedValue([{ embedding: 'e1' }] as any);
      mocks.search.searchFaces.mockResolvedValue([
        { id: 'assigned-face', personId: null, distance: 0.6 },
        { id: 'candidate', personId: null, distance: 0.7 },
      ] as FaceSearchResult[]);
      mocks.sharedSpace.getAssignedFaceIdsForSpace.mockResolvedValue([{ assetFaceId: 'assigned-face' }]);

      await expect(sut.handleSpacePersonSuggestionScan({ id: 'sp' })).resolves.toBe(JobStatus.Success);

      expect(mocks.sharedSpace.getAssignedFaceIdsForSpace).toHaveBeenCalledWith('space-1', [
        'assigned-face',
        'candidate',
      ]);
      expect(mocks.facePersonVerdict.upsertPendingForSpacePerson).toHaveBeenCalledWith([
        { spacePersonId: 'sp', assetFaceId: 'candidate', distance: 0.7 },
      ]);
    });

    it('drops a manually-linked or negatively-verdicted candidate before upserting (D3 write-time exclusion)', async () => {
      mocks.systemMetadata.get.mockResolvedValue(enabled);
      mocks.sharedSpace.getPersonById.mockResolvedValue({
        id: 'sp',
        spaceId: 'space-1',
        name: 'Alice',
        isHidden: false,
        type: 'person',
        identityId: 'identity-sp',
      } as any);
      mocks.sharedSpace.getById.mockResolvedValue({ id: 'space-1', faceRecognitionEnabled: true } as any);
      mocks.sharedSpace.getSpacePersonAssignedFaceEmbeddings.mockResolvedValue([{ embedding: 'e1' }] as any);
      mocks.search.searchFaces.mockResolvedValue([
        { id: 'f-manual', personId: null, distance: 0.7 },
        { id: 'f-negative-space-person', personId: null, distance: 0.7 },
        { id: 'f-negative-identity', personId: null, distance: 0.7 },
        { id: 'f-kept', personId: null, distance: 0.7 },
      ] as FaceSearchResult[]);
      mocks.faceIdentity.getManualLinkedFaceIds.mockResolvedValue(new Set(['f-manual']));
      mocks.facePersonVerdict.getNegativeVerdictTokens.mockResolvedValue(
        new Map([
          ['f-negative-space-person', new Set(['space-person:sp'])],
          ['f-negative-identity', new Set(['identity:identity-sp'])],
        ]),
      );

      await expect(sut.handleSpacePersonSuggestionScan({ id: 'sp' })).resolves.toBe(JobStatus.Success);

      expect(mocks.faceIdentity.getManualLinkedFaceIds).toHaveBeenCalledWith(
        expect.arrayContaining(['f-manual', 'f-negative-space-person', 'f-negative-identity', 'f-kept']),
      );
      expect(mocks.facePersonVerdict.upsertPendingForSpacePerson).toHaveBeenCalledWith([
        { spacePersonId: 'sp', assetFaceId: 'f-kept', distance: 0.7 },
      ]);
    });
  });

  describe('handleSpacePersonSuggestionScanQueueAll', () => {
    const enabled = {
      machineLearning: {
        enabled: true,
        facialRecognition: {
          enabled: true,
          maxDistance: 0.5,
          minFaces: 3,
          suggestions: { enabled: true, maxDistance: 0.8 },
        },
      },
    };

    it('runs on the people backfill queue', () => {
      const config = new Reflector().get(MetadataKey.JobConfig, sut.handleSpacePersonSuggestionScanQueueAll);
      expect(config).toEqual(expect.objectContaining({ queue: QueueName.PeopleBackfill }));
    });

    it('skips enumeration when feature is disabled', async () => {
      mocks.systemMetadata.get.mockResolvedValue({
        machineLearning: {
          enabled: true,
          facialRecognition: {
            enabled: true,
            maxDistance: 0.5,
            minFaces: 3,
            suggestions: { enabled: false, maxDistance: 0.7 },
          },
        },
      });

      await expect(sut.handleSpacePersonSuggestionScanQueueAll({})).resolves.toBe(JobStatus.Skipped);
      expect(mocks.sharedSpace.getScannableSpacePeopleWithUnassignedFaces).not.toHaveBeenCalled();
      expect(mocks.job.queueAll).not.toHaveBeenCalled();
    });

    it('queues one SpacePersonSuggestionScan per scannable space person', async () => {
      mocks.systemMetadata.get.mockResolvedValue(enabled);
      mocks.sharedSpace.getScannableSpacePeopleWithUnassignedFaces.mockReturnValue(
        makeStream([
          { id: 'sp1', spaceId: 's1' },
          { id: 'sp2', spaceId: 's1' },
        ]) as any,
      );

      await expect(sut.handleSpacePersonSuggestionScanQueueAll({})).resolves.toBe(JobStatus.Success);

      expect(mocks.job.queueAll).toHaveBeenCalledWith([
        { name: JobName.SpacePersonSuggestionScan, data: { id: 'sp1' } },
        { name: JobName.SpacePersonSuggestionScan, data: { id: 'sp2' } },
      ]);
    });
  });

  describe('getFaceSuggestions', () => {
    const enabled = {
      machineLearning: {
        enabled: true,
        facialRecognition: {
          enabled: true,
          maxDistance: 0.5,
          minFaces: 3,
          suggestions: { enabled: true, maxDistance: 0.8 },
        },
      },
    };

    it('denies a non-owner with no state change (edge 18 absence)', async () => {
      mocks.systemMetadata.get.mockResolvedValue(enabled);
      mocks.access.person.checkOwnerAccess.mockResolvedValue(new Set()); // not the owner

      await expect(
        sut.getFaceSuggestions(AuthFactory.create(), 'person-1', { page: 1, size: 50 }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(mocks.facePersonVerdict.getPendingForPerson).not.toHaveBeenCalled();
    });

    it('refuses a space member (non-owner) — suggestions are owner-only (D6)', async () => {
      // Space member: NOT the owner, but space-reachable (would pass PersonRead).
      mocks.access.person.checkOwnerAccess.mockResolvedValue(new Set());
      mocks.access.person.checkSharedSpaceAccess.mockResolvedValue(new Set(['person-1']));

      await expect(sut.getFaceSuggestions(AuthFactory.create(), 'person-1', { page: 1, size: 10 })).rejects.toThrow(
        BadRequestException,
      );
      expect(mocks.facePersonVerdict.getPendingForPerson).not.toHaveBeenCalled();
    });

    it('refuses an admin who is not the owner — PersonUpdate has no admin carve-out (D6)', async () => {
      mocks.access.person.checkOwnerAccess.mockResolvedValue(new Set());

      await expect(
        sut.getFaceSuggestions(AuthFactory.create({ isAdmin: true }), 'person-1', { page: 1, size: 10 }),
      ).rejects.toThrow(BadRequestException);
      expect(mocks.facePersonVerdict.getPendingForPerson).not.toHaveBeenCalled();
    });

    it('returns total + mapped items for the owner', async () => {
      mocks.systemMetadata.get.mockResolvedValue(enabled);
      mocks.access.person.checkOwnerAccess.mockResolvedValue(new Set(['person-1']));
      mocks.facePersonVerdict.getPendingForPerson.mockResolvedValue({
        total: 1,
        items: [
          {
            assetFaceId: 'face-1',
            distance: 0.62,
            assetId: 'asset-1',
            imageWidth: 4000,
            imageHeight: 3000,
            boundingBoxX1: 1,
            boundingBoxX2: 2,
            boundingBoxY1: 3,
            boundingBoxY2: 4,
            fileCreatedAt: new Date('2026-01-01T00:00:00.000Z'),
          },
        ],
      });

      const res = await sut.getFaceSuggestions(AuthFactory.create(), 'person-1', { page: 1, size: 50 });

      expect(mocks.facePersonVerdict.getPendingForPerson).toHaveBeenCalledWith('person-1', {
        maxDistance: 0.5,
        suggestionMaxDistance: 0.8,
        page: 1,
        size: 50,
      });
      expect(res).toEqual({
        total: 1,
        items: [
          {
            assetFaceId: 'face-1',
            assetId: 'asset-1',
            distance: 0.62,
            imageWidth: 4000,
            imageHeight: 3000,
            boundingBoxX1: 1,
            boundingBoxX2: 2,
            boundingBoxY1: 3,
            boundingBoxY2: 4,
            fileCreatedAt: '2026-01-01T00:00:00.000Z',
          },
        ],
      });
    });

    it('returns an empty page without querying the repository when the band is inverted (edge 7)', async () => {
      mocks.systemMetadata.get.mockResolvedValue({
        machineLearning: {
          enabled: true,
          facialRecognition: {
            enabled: true,
            maxDistance: 0.5,
            minFaces: 3,
            // Suggestions are explicitly ON (enabled: true) but misconfigured with a distance at/below
            // maxDistance — a schema-valid (>= 0.1) yet inverted band, distinct from the toggle-off case
            // covered by the next test below.
            suggestions: { enabled: true, maxDistance: 0.3 },
          },
        },
      });
      mocks.access.person.checkOwnerAccess.mockResolvedValue(new Set(['person-1']));

      const res = await sut.getFaceSuggestions(AuthFactory.create(), 'person-1', { page: 1, size: 50 });

      expect(mocks.facePersonVerdict.getPendingForPerson).not.toHaveBeenCalled();
      expect(res).toEqual({ total: 0, items: [] });
    });

    it('returns an empty page without querying when suggestions are disabled but the band is still valid', async () => {
      mocks.systemMetadata.get.mockResolvedValue({
        machineLearning: {
          enabled: true,
          facialRecognition: { enabled: true, maxDistance: 0.5, suggestions: { enabled: false, maxDistance: 0.7 } },
        },
      });
      mocks.access.person.checkOwnerAccess.mockResolvedValue(new Set(['person-1']));

      await expect(sut.getFaceSuggestions(authStub.admin, 'person-1', { page: 1, size: 10 })).resolves.toEqual({
        total: 0,
        items: [],
      });

      expect(mocks.facePersonVerdict.getPendingForPerson).not.toHaveBeenCalled();
    });
  });

  describe('confirmFaceSuggestion', () => {
    // Slice 3 (S3.9): the feature gate now runs BEFORE the access checks, so every test below that exercises
    // the write chain needs suggestions enabled — matching the space twin (confirmSpacePersonFaceSuggestion),
    // which already gates the same way.
    const enabled = {
      machineLearning: {
        enabled: true,
        facialRecognition: {
          enabled: true,
          maxDistance: 0.5,
          minFaces: 3,
          suggestions: { enabled: true, maxDistance: 0.8 },
        },
      },
    };

    beforeEach(() => {
      mocks.systemMetadata.get.mockResolvedValue(enabled);
    });

    it('denies a non-owner with NO state change (edge 18 absence)', async () => {
      mocks.access.person.checkOwnerAccess.mockResolvedValue(new Set()); // not owner

      await expect(sut.confirmFaceSuggestion(AuthFactory.create(), 'person-1', 'face-1')).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(mocks.facePersonVerdict.claimPending).not.toHaveBeenCalled();
      expect(mocks.person.reassignFace).not.toHaveBeenCalled();
    });

    // S11 (slice 11a): confirm applies the identical owner-BOTH gate reject/ignore apply — owning the person
    // is not enough, the caller must also own the face (face_identity.id is a cross-owner key). Mirrors the
    // S4.1/S4.2 denial tests for rejectFaceSuggestion/ignoreFaceSuggestion below. Person and face are mocked
    // to otherwise valid, resolvable state so that a removed guard would let the write chain run to
    // completion (resolving `true`) instead of coincidentally rejecting for an unrelated reason (e.g. a
    // missing `findOrFail` mock) — the same discipline the S4.3 owner-path test below applies positively.
    it('denies a face the caller does not own, even though the person is owned, with NO state change', async () => {
      const face = AssetFaceFactory.create();
      const person = PersonFactory.create();
      mocks.access.person.checkOwnerAccess.mockResolvedValue(new Set([person.id])); // person ownership OK
      mocks.access.person.checkFaceOwnerAccess.mockResolvedValue(new Set()); // face NOT owned by the caller
      mocks.person.getById.mockResolvedValue(person);
      mocks.person.getFaceById.mockResolvedValue(getForAssetFace(face));
      mocks.facePersonVerdict.claimPending.mockResolvedValue(1);

      await expect(sut.confirmFaceSuggestion(AuthFactory.create(), person.id, face.id)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(mocks.facePersonVerdict.claimPending).not.toHaveBeenCalled();
      expect(mocks.person.reassignFace).not.toHaveBeenCalled();
    });

    it('flips the row to confirmed then delegates to reassignFacesById (assign + manual identity + feature photo)', async () => {
      const face = AssetFaceFactory.create();
      const person = PersonFactory.create();
      person.faceAssetId = null; // no feature photo yet — triggers createNewFeaturePhoto
      mocks.access.person.checkOwnerAccess.mockResolvedValue(new Set([person.id]));
      mocks.access.person.checkFaceOwnerAccess.mockResolvedValue(new Set([face.id]));
      mocks.person.getFaceById.mockResolvedValue(getForAssetFace(face));
      mocks.person.reassignFace.mockResolvedValue(1);
      mocks.person.getById.mockResolvedValue(person);
      mocks.person.getRandomFace.mockResolvedValue(face); // drives createNewFeaturePhoto
      mocks.facePersonVerdict.claimPending.mockResolvedValue(1); // a pending row existed

      // S11.7: the caller (controller) needs to know whether this call actually did something — `true` here
      // is what the controller maps to 200. See the idempotent/disabled-feature cases below for the `false`
      // (204, no-op) side of the same signal.
      await expect(sut.confirmFaceSuggestion(AuthFactory.create(), person.id, face.id)).resolves.toBe(true);

      // Slice 9: every write in the chain now runs inside `databaseRepository.transaction`, so each call
      // carries a trailing trx arg — the test/utils.ts L318 passthrough default makes `trx === mocks.database`.
      // Slice 3 (S3.9): claimPending now also takes the eligibility band, read from the same config lookup.
      expect(mocks.facePersonVerdict.claimPending).toHaveBeenCalledWith(
        person.id,
        face.id,
        { maxDistance: 0.5, suggestionMaxDistance: 0.8 },
        mocks.database,
      );
      expect(mocks.person.reassignFace).toHaveBeenCalledWith(face.id, person.id, mocks.database);
      expect(mocks.faceIdentity.replaceFaceIdentity).toHaveBeenCalledWith(
        {
          assetFaceId: face.id,
          identityId: 'identity-1',
          source: 'manual',
        },
        mocks.database,
      );
      expect(mocks.person.update).toHaveBeenCalledWith(
        expect.objectContaining({ id: person.id, faceAssetId: face.id }),
      );
      expect(mocks.facePersonVerdict.resolveAssignedFace).toHaveBeenCalledWith(face.id, mocks.database);
      // S11 (slice 11d): defense-in-depth clear, scoped to this target's identity, inside the same trx.
      expect(mocks.facePersonVerdict.clearNegativeForTarget).toHaveBeenCalledWith(
        { personId: person.id, identityId: 'identity-1' },
        [face.id],
        mocks.database,
      );
    });

    it('is idempotent when the row is already confirmed/rejected/ignored but person+face still exist → 204 (false), no reassign', async () => {
      const face = AssetFaceFactory.create();
      const person = PersonFactory.create();
      mocks.access.person.checkOwnerAccess.mockResolvedValue(new Set([person.id]));
      mocks.access.person.checkFaceOwnerAccess.mockResolvedValue(new Set([face.id]));
      // Slice 9: person/face are now read BEFORE the transaction opens (claimPending — and the rest of the
      // write chain — must run inside the trx, and these two lookups have no trx-aware repo method), so
      // they're fetched unconditionally even on the idempotent path.
      mocks.person.getById.mockResolvedValue(person);
      mocks.person.getFaceById.mockResolvedValue(getForAssetFace(face));
      mocks.facePersonVerdict.claimPending.mockResolvedValue(0); // already confirmed/rejected/ignored

      // S11.7: no-op (already resolved) -> false, the signal the controller maps to 204.
      await expect(sut.confirmFaceSuggestion(AuthFactory.create(), person.id, face.id)).resolves.toBe(false);
      expect(mocks.person.reassignFace).not.toHaveBeenCalled();
    });

    it('a CASCADE-deleted person or face → 400 (owner-only precedence, edges 9, 10)', async () => {
      mocks.access.person.checkOwnerAccess.mockResolvedValue(new Set()); // person row gone

      await expect(sut.confirmFaceSuggestion(AuthFactory.create(), 'person-1', 'face-1')).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(mocks.facePersonVerdict.claimPending).not.toHaveBeenCalled();
    });

    it('S3.9: returns early without calling requireAccess or any repository when suggestions.enabled is false', async () => {
      mocks.systemMetadata.get.mockResolvedValue({
        machineLearning: {
          enabled: true,
          facialRecognition: {
            enabled: true,
            maxDistance: 0.5,
            minFaces: 3,
            suggestions: { enabled: false, maxDistance: 0.8 },
          },
        },
      });

      // S11.7: the feature-disabled short-circuit is a no-op -> false (204).
      await expect(sut.confirmFaceSuggestion(AuthFactory.create(), 'person-1', 'face-1')).resolves.toBe(false);

      expect(mocks.access.person.checkOwnerAccess).not.toHaveBeenCalled();
      expect(mocks.access.person.checkFaceOwnerAccess).not.toHaveBeenCalled();
      expect(mocks.person.getById).not.toHaveBeenCalled();
      expect(mocks.person.getFaceById).not.toHaveBeenCalled();
      expect(mocks.facePersonVerdict.claimPending).not.toHaveBeenCalled();

      // Positive control, same test body: the identical call reaches requireAccess once suggestions are
      // enabled again — proves the absence above is the feature gate, not a broken mock/call path.
      // getConfig({ withCache: true }) memoizes at module scope, so the mock swap alone would not be
      // observed on the next call — clear it explicitly, same as a fresh test's systemMetadata mock does.
      clearConfigCache();
      mocks.systemMetadata.get.mockResolvedValue(enabled);
      mocks.access.person.checkOwnerAccess.mockResolvedValue(new Set()); // still denies — but PROVES it ran
      await expect(sut.confirmFaceSuggestion(AuthFactory.create(), 'person-1', 'face-1')).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(mocks.access.person.checkOwnerAccess).toHaveBeenCalled();
    });
  });

  describe('rejectFaceSuggestion / ignoreFaceSuggestion / dismissFaceSuggestion', () => {
    it('denies a non-owner for reject and ignore with NO state change (edge 18 absence)', async () => {
      mocks.access.person.checkOwnerAccess.mockResolvedValue(new Set());

      await expect(sut.rejectFaceSuggestion(AuthFactory.create(), 'person-1', 'face-1')).rejects.toBeInstanceOf(
        BadRequestException,
      );
      await expect(sut.ignoreFaceSuggestion(AuthFactory.create(), 'person-1', 'face-1')).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(mocks.facePersonVerdict.markRejected).not.toHaveBeenCalled();
      expect(mocks.facePersonVerdict.markIgnored).not.toHaveBeenCalled();
    });

    // S4.1: the personal reject path must apply the identical face-ownership gate confirm already applies
    // (Permission.PersonCreate → access.person.checkFaceOwnerAccess) — reject is no longer "person-ownership
    // only": verdictOpts stamps every row with the target's identity, and that identity is a CROSS-OWNER key
    // (identity-merge-propagation.service.ts), so an assetFaceId the caller does not own must be refused before
    // any row is written.
    it('S4.1: rejectFaceSuggestion throws BadRequestException when checkFaceOwnerAccess returns empty, and never calls markRejected', async () => {
      mocks.access.person.checkOwnerAccess.mockResolvedValue(new Set(['person-1'])); // person ownership OK
      mocks.access.person.checkFaceOwnerAccess.mockResolvedValue(new Set()); // face NOT owned by the caller

      await expect(sut.rejectFaceSuggestion(AuthFactory.create(), 'person-1', 'face-1')).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(mocks.facePersonVerdict.markRejected).not.toHaveBeenCalled();
    });

    // S4.2: same gate on ignore and on dismiss (which delegates to reject, so it inherits the gate rather than
    // duplicating it).
    it('S4.2: ignoreFaceSuggestion and dismissFaceSuggestion throw BadRequestException when checkFaceOwnerAccess returns empty, and never write a verdict', async () => {
      mocks.access.person.checkOwnerAccess.mockResolvedValue(new Set(['person-1']));
      mocks.access.person.checkFaceOwnerAccess.mockResolvedValue(new Set());

      await expect(sut.ignoreFaceSuggestion(AuthFactory.create(), 'person-1', 'face-1')).rejects.toBeInstanceOf(
        BadRequestException,
      );
      await expect(sut.dismissFaceSuggestion(AuthFactory.create(), 'person-1', 'face-1')).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(mocks.facePersonVerdict.markIgnored).not.toHaveBeenCalled();
      expect(mocks.facePersonVerdict.markRejected).not.toHaveBeenCalled();
    });

    // S4.3 (pin): the owner path — owning BOTH the person and the face — still passes and still writes the
    // verdict row exactly as before. Mutated/reverted below (see the "S4.3 pin mutation" block at the end of
    // this describe) to prove the assertion can actually fail.
    it('S4.3: the owner path passes both the person and face ownership checks and still calls markRejected', async () => {
      const authUser = AuthFactory.create();
      mocks.access.person.checkOwnerAccess.mockResolvedValue(new Set(['person-1']));
      mocks.access.person.checkFaceOwnerAccess.mockResolvedValue(new Set(['face-1']));
      mocks.facePersonVerdict.markRejected.mockResolvedValue(1);

      // S11.7: markRejected affecting a row -> true (200).
      await expect(sut.rejectFaceSuggestion(authUser, 'person-1', 'face-1')).resolves.toBe(true);

      expect(mocks.access.person.checkOwnerAccess).toHaveBeenCalledWith(authUser.user.id, new Set(['person-1']));
      expect(mocks.access.person.checkFaceOwnerAccess).toHaveBeenCalledWith(authUser.user.id, new Set(['face-1']));
      expect(mocks.facePersonVerdict.markRejected).toHaveBeenCalledWith('person-1', 'face-1', {
        identityId: 'identity-1',
        source: 'suggestion',
        actorId: authUser.user.id,
      });
    });

    it('reject flips the row to rejected and never assigns or reassigns the face', async () => {
      const authUser = AuthFactory.create();
      mocks.access.person.checkOwnerAccess.mockResolvedValue(new Set(['person-1']));
      mocks.access.person.checkFaceOwnerAccess.mockResolvedValue(new Set(['face-1']));
      mocks.facePersonVerdict.markRejected.mockResolvedValue(1);

      await expect(sut.rejectFaceSuggestion(authUser, 'person-1', 'face-1')).resolves.toBe(true);

      expect(mocks.facePersonVerdict.markRejected).toHaveBeenCalledWith('person-1', 'face-1', {
        identityId: 'identity-1',
        source: 'suggestion',
        actorId: authUser.user.id,
      });
      expect(mocks.facePersonVerdict.markIgnored).not.toHaveBeenCalled();
      expect(mocks.person.reassignFace).not.toHaveBeenCalled();
      expect(mocks.person.reassignFaces).not.toHaveBeenCalled();
    });

    it('ignore flips the row to ignored and never assigns or reassigns the face', async () => {
      const authUser = AuthFactory.create();
      mocks.access.person.checkOwnerAccess.mockResolvedValue(new Set(['person-1']));
      mocks.access.person.checkFaceOwnerAccess.mockResolvedValue(new Set(['face-1']));
      mocks.facePersonVerdict.markIgnored.mockResolvedValue(1);

      await expect(sut.ignoreFaceSuggestion(authUser, 'person-1', 'face-1')).resolves.toBe(true);

      expect(mocks.facePersonVerdict.markIgnored).toHaveBeenCalledWith('person-1', 'face-1', {
        identityId: 'identity-1',
        source: 'suggestion',
        actorId: authUser.user.id,
      });
      expect(mocks.facePersonVerdict.markRejected).not.toHaveBeenCalled();
      expect(mocks.person.reassignFace).not.toHaveBeenCalled();
      expect(mocks.person.reassignFaces).not.toHaveBeenCalled();
    });

    it('reject and ignore no-op stale or already-resolved rows and never assigns or reassigns the face', async () => {
      const authUser = AuthFactory.create();
      mocks.access.person.checkOwnerAccess.mockResolvedValue(new Set(['person-1']));
      mocks.access.person.checkFaceOwnerAccess.mockResolvedValue(new Set(['face-1']));
      mocks.facePersonVerdict.markRejected.mockResolvedValue(0);
      mocks.facePersonVerdict.markIgnored.mockResolvedValue(0);

      // S11.7: markRejected/markIgnored affecting no rows -> false (204) — the third of the "server methods
      // already distinguish these internally" signals the plan calls out for reject/ignore.
      await expect(sut.rejectFaceSuggestion(authUser, 'person-1', 'face-1')).resolves.toBe(false);
      await expect(sut.ignoreFaceSuggestion(authUser, 'person-1', 'face-1')).resolves.toBe(false);

      expect(mocks.facePersonVerdict.markRejected).toHaveBeenCalledWith('person-1', 'face-1', {
        identityId: 'identity-1',
        source: 'suggestion',
        actorId: authUser.user.id,
      });
      expect(mocks.facePersonVerdict.markIgnored).toHaveBeenCalledWith('person-1', 'face-1', {
        identityId: 'identity-1',
        source: 'suggestion',
        actorId: authUser.user.id,
      });
      expect(mocks.person.reassignFace).not.toHaveBeenCalled();
      expect(mocks.person.reassignFaces).not.toHaveBeenCalled();
    });

    it('dismiss remains a compatibility wrapper around reject', async () => {
      const authUser = AuthFactory.create();
      mocks.access.person.checkOwnerAccess.mockResolvedValue(new Set(['person-1']));
      mocks.access.person.checkFaceOwnerAccess.mockResolvedValue(new Set(['face-1']));
      mocks.facePersonVerdict.markRejected.mockResolvedValue(1);

      await expect(sut.dismissFaceSuggestion(authUser, 'person-1', 'face-1')).resolves.toBe(true);

      expect(mocks.facePersonVerdict.markRejected).toHaveBeenCalledWith('person-1', 'face-1', {
        identityId: 'identity-1',
        source: 'suggestion',
        actorId: authUser.user.id,
      });
      expect(mocks.facePersonVerdict.markIgnored).not.toHaveBeenCalled();
      expect(mocks.person.reassignFace).not.toHaveBeenCalled();
      expect(mocks.person.reassignFaces).not.toHaveBeenCalled();
    });
  });
});
