import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { writeFile } from 'node:fs/promises';
import { JobName, UserMetadataKey } from 'src/enum.js';
import { GalleryPeopleService } from 'src/gallery/gallery-people.service.js';
import { ImmichStreamResponse } from 'src/utils/file.js';
import { CROSS_OWNER_MERGE_ERROR_CODE } from 'src/utils/merge-policy.js';
import { AssetFaceFactory } from 'test/factories/asset-face.factory.js';
import { AuthFactory } from 'test/factories/auth.factory.js';
import { PersonFactory } from 'test/factories/person.factory.js';
import { newUuid } from 'test/small.factory.js';
import { ServiceMocks, newTestService } from 'test/utils.js';

const prefsMetadata = (minimumFaces: number) =>
  [{ key: UserMetadataKey.Preferences, value: { people: { minimumFaces } } }] as any;

// Cross-owner scoped-merge (#733) request fixture.
const crossOwnerMergeDto = (overrides: Record<string, unknown> = {}) => ({
  target: { type: 'person' as const, id: newUuid() },
  sources: [{ type: 'space-person' as const, id: newUuid(), spaceId: newUuid() }],
  ...overrides,
});

/** The cross-owner authorizer each merge entry point hands to the planner (src/utils/merge-policy.ts). */
type MergeAuthorizerFn = (plan: {
  collapsedOwnerIds: string[];
  repointedOwnerIds: string[];
  unrepairableSpaceCollapseIds: string[];
}) => Promise<void>;

const planWith = (overrides: {
  collapsedOwnerIds?: string[];
  repointedOwnerIds?: string[];
  unrepairableSpaceCollapseIds?: string[];
}) => ({
  collapsedOwnerIds: [],
  repointedOwnerIds: [],
  unrepairableSpaceCollapseIds: [],
  ...overrides,
});

describe(GalleryPeopleService.name, () => {
  let sut: GalleryPeopleService;
  let mocks: ServiceMocks;

  beforeEach(() => {
    ({ sut, mocks } = newTestService(GalleryPeopleService));
    mocks.faceIdentity.ensurePersonIdentity.mockResolvedValue({ id: 'identity-1' } as any);
    const faceIdentityMock = mocks.faceIdentity as any;
    faceIdentityMock.getAccessiblePeople ??= vi.fn();
    faceIdentityMock.getAccessiblePeopleStatistics ??= vi.fn();
    faceIdentityMock.getAccessiblePeopleFaceStatistics ??= vi.fn();
    faceIdentityMock.getAccessiblePersonByProfileId ??= vi.fn();
    faceIdentityMock.getResolvedPersonByIdentityId ??= vi.fn();
    faceIdentityMock.getAccessiblePersonStatistics ??= vi.fn();
    faceIdentityMock.getAccessibleProfileIdentityId ??= vi.fn();
    faceIdentityMock.hasBackfillWork ??= vi.fn();
    faceIdentityMock.getBackfillWork ??= vi.fn();
    faceIdentityMock.getBackfillWork.mockResolvedValue({
      hasPersonalIdentityWork: false,
      hasSpacePersonIdentityWork: false,
      hasSharedSpaceProjectionWork: false,
    });
    faceIdentityMock.getSharedSpaceFaceMatchBackfillTargets ??= vi.fn();
    faceIdentityMock.getSharedSpaceFaceMatchBackfillTargets.mockResolvedValue([]);
    faceIdentityMock.getPendingSharedSpaceFaceMatchBackfillTargets ??= vi.fn();
    faceIdentityMock.getPendingSharedSpaceFaceMatchBackfillTargets.mockResolvedValue([]);
    faceIdentityMock.deletePendingSharedSpaceFaceMatchBackfillTargets ??= vi.fn();
    faceIdentityMock.deletePendingSharedSpaceFaceMatchBackfillTargets.mockResolvedValue(void 0);
    faceIdentityMock.deleteUnreferencedIdentities ??= vi.fn();
    faceIdentityMock.deleteUnreferencedIdentities.mockResolvedValue(void 0);
    (mocks.person as any).getPeopleOverviewStatistics ??= vi.fn();
    (mocks.person as any).getPeopleFaceStatistics ??= vi.fn();
    (mocks.faceIdentity as any).getAccessiblePersonByProfileId.mockResolvedValue(void 0);
    (mocks.faceIdentity as any).getAccessibleProfileIdentityId.mockResolvedValue(void 0);
    mocks.sharedSpace.getSpaceIdsWithFaceRecognitionEnabled.mockResolvedValue([]);
    // Default: no stored preferences → getPreferences() falls back to minimumFaces = 3.
    mocks.user.getMetadata.mockResolvedValue([]);
    mocks.sharedSpace.getAssignedFaceIdsForSpace.mockResolvedValue([]);
    // Default: no face has been manually linked or negatively verdicted — the suggestion-scan handlers'
    // write-time exclusion (D3) becomes a no-op unless an individual test configures otherwise.
    mocks.faceIdentity.getManualLinkedFaceIds.mockResolvedValue(new Set());
    mocks.facePersonVerdict.getNegativeVerdictTokens.mockResolvedValue(new Map());
  });

  const useIdentityMergePropagation = () => {
    const identityMergePropagation = {
      mergePersonalPeople: vi.fn(),
      mergeScopedProfiles: vi.fn(),
    };
    (
      sut as unknown as { identityMergePropagationService: typeof identityMergePropagation }
    ).identityMergePropagationService = identityMergePropagation;

    return identityMergePropagation;
  };

  it('should be defined', () => {
    expect(sut).toBeDefined();
  });

  describe('people.minimumFaces preference (M2)', () => {
    it('threads the user preference into withSharedSpaces people-stats', async () => {
      const auth = AuthFactory.create();
      mocks.user.getMetadata.mockResolvedValue(prefsMetadata(5));
      (mocks.faceIdentity as any).getAccessiblePeopleStatistics.mockResolvedValue({
        total: 0,
        hidden: 0,
        detectedFaceCount: 0,
      });

      await sut.getPeopleStatistics(auth, { withSharedSpaces: true, page: 1, size: 50 } as any);

      expect((mocks.faceIdentity as any).getAccessiblePeopleStatistics).toHaveBeenCalledWith(auth.user.id, {
        minimumFaceCount: 5,
      });
    });

    it('threads the user preference into withSharedSpaces people-face-stats', async () => {
      const auth = AuthFactory.create();
      mocks.user.getMetadata.mockResolvedValue(prefsMetadata(5));
      (mocks.faceIdentity as any).getAccessiblePeopleFaceStatistics.mockResolvedValue({
        detectedFaceCount: 0,
        assignedVisibleFaceCount: 0,
        namedVisiblePersonCount: 0,
        assignedHiddenFaceCount: 0,
        unassignedFaceCount: 0,
      });

      await sut.getPeopleFaceStatistics(auth, { withSharedSpaces: true, page: 1, size: 50 } as any);

      expect((mocks.faceIdentity as any).getAccessiblePeopleFaceStatistics).toHaveBeenCalledWith(auth.user.id, {
        minimumFaceCount: 5,
      });
    });

    it('threads the user preference into the non-shared people-stats surfaces', async () => {
      const auth = AuthFactory.create();
      mocks.user.getMetadata.mockResolvedValue(prefsMetadata(5));
      (mocks.person as any).getPeopleOverviewStatistics.mockResolvedValue({
        total: 0,
        hidden: 0,
        detectedFaceCount: 0,
      });
      (mocks.person as any).getPeopleFaceStatistics.mockResolvedValue({
        detectedFaceCount: 0,
        assignedVisibleFaceCount: 0,
        namedVisiblePersonCount: 0,
        assignedHiddenFaceCount: 0,
        unassignedFaceCount: 0,
      });

      await sut.getPeopleStatistics(auth, { page: 1, size: 50 } as any);
      await sut.getPeopleFaceStatistics(auth, { page: 1, size: 50 } as any);

      expect((mocks.person as any).getPeopleOverviewStatistics).toHaveBeenCalledWith(auth.user.id, {
        minimumFaceCount: 5,
      });
      expect((mocks.person as any).getPeopleFaceStatistics).toHaveBeenCalledWith(auth.user.id, {
        minimumFaceCount: 5,
      });
    });
  });

  describe('getPeopleStatistics', () => {
    it('uses identity-grouped global scope when withSharedSpaces is true', async () => {
      const auth = AuthFactory.create();
      (mocks.faceIdentity as any).getAccessiblePeopleStatistics.mockResolvedValue({
        total: 3,
        hidden: 1,
        detectedFaceCount: 11,
      });

      await expect(
        sut.getPeopleStatistics(auth, { withSharedSpaces: true, page: 4, size: 10 } as any),
      ).resolves.toEqual({
        total: 3,
        hidden: 1,
        detectedFaceCount: 11,
      });

      expect((mocks.faceIdentity as any).getAccessiblePeopleStatistics).toHaveBeenCalledWith(auth.user.id, {
        minimumFaceCount: 3,
      });
      expect((mocks.person as any).getPeopleOverviewStatistics).not.toHaveBeenCalled();
    });

    it('uses personal-only scope when withSharedSpaces is omitted', async () => {
      const auth = AuthFactory.create();
      (mocks.person as any).getPeopleOverviewStatistics.mockResolvedValue({
        total: 2,
        hidden: 0,
        detectedFaceCount: 5,
      });

      await expect(sut.getPeopleStatistics(auth, { page: 1, size: 50 } as any)).resolves.toEqual({
        total: 2,
        hidden: 0,
        detectedFaceCount: 5,
      });

      expect((mocks.person as any).getPeopleOverviewStatistics).toHaveBeenCalledWith(auth.user.id, {
        minimumFaceCount: 3,
      });
      expect((mocks.faceIdentity as any).getAccessiblePeopleStatistics).not.toHaveBeenCalled();
    });

    it('rejects closest-person filters instead of returning misleading unfiltered totals', async () => {
      const auth = AuthFactory.create();

      await expect(
        sut.getPeopleStatistics(auth, { closestPersonId: newUuid(), page: 1, size: 50 } as any),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect((mocks.person as any).getPeopleOverviewStatistics).not.toHaveBeenCalled();
      expect((mocks.faceIdentity as any).getAccessiblePeopleStatistics).not.toHaveBeenCalled();
    });

    it('rejects closest-asset filters instead of returning misleading unfiltered totals', async () => {
      const auth = AuthFactory.create();

      await expect(
        sut.getPeopleStatistics(auth, { closestAssetId: newUuid(), page: 1, size: 50 } as any),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect((mocks.person as any).getPeopleOverviewStatistics).not.toHaveBeenCalled();
      expect((mocks.faceIdentity as any).getAccessiblePeopleStatistics).not.toHaveBeenCalled();
    });
  });

  describe('getPeopleFaceStatistics', () => {
    it('uses identity-grouped global scope when withSharedSpaces is true', async () => {
      const auth = AuthFactory.create();
      (mocks.faceIdentity as any).getAccessiblePeopleFaceStatistics.mockResolvedValue({
        detectedFaceCount: 11,
        assignedVisibleFaceCount: 7,
        namedVisiblePersonCount: 3,
        assignedHiddenFaceCount: 2,
        unassignedFaceCount: 2,
      });

      await expect(
        sut.getPeopleFaceStatistics(auth, { withSharedSpaces: true, page: 4, size: 10 } as any),
      ).resolves.toEqual({
        detectedFaceCount: 11,
        assignedVisibleFaceCount: 7,
        namedVisiblePersonCount: 3,
        assignedHiddenFaceCount: 2,
        unassignedFaceCount: 2,
      });

      expect((mocks.faceIdentity as any).getAccessiblePeopleFaceStatistics).toHaveBeenCalledWith(auth.user.id, {
        minimumFaceCount: 3,
      });
      expect((mocks.person as any).getPeopleFaceStatistics).not.toHaveBeenCalled();
    });

    it('uses personal-only scope when withSharedSpaces is omitted', async () => {
      const auth = AuthFactory.create();
      (mocks.person as any).getPeopleFaceStatistics.mockResolvedValue({
        detectedFaceCount: 5,
        assignedVisibleFaceCount: 4,
        namedVisiblePersonCount: 2,
        assignedHiddenFaceCount: 1,
        unassignedFaceCount: 0,
      });

      await expect(sut.getPeopleFaceStatistics(auth, { page: 1, size: 50 } as any)).resolves.toEqual({
        detectedFaceCount: 5,
        assignedVisibleFaceCount: 4,
        namedVisiblePersonCount: 2,
        assignedHiddenFaceCount: 1,
        unassignedFaceCount: 0,
      });

      expect((mocks.person as any).getPeopleFaceStatistics).toHaveBeenCalledWith(auth.user.id, {
        minimumFaceCount: 3,
      });
      expect((mocks.faceIdentity as any).getAccessiblePeopleFaceStatistics).not.toHaveBeenCalled();
    });

    it('rejects closest-person filters instead of returning misleading unfiltered totals', async () => {
      const auth = AuthFactory.create();

      await expect(
        sut.getPeopleFaceStatistics(auth, { closestPersonId: newUuid(), page: 1, size: 50 } as any),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect((mocks.person as any).getPeopleFaceStatistics).not.toHaveBeenCalled();
      expect((mocks.faceIdentity as any).getAccessiblePeopleFaceStatistics).not.toHaveBeenCalled();
    });

    it('rejects closest-asset filters instead of returning misleading unfiltered totals', async () => {
      const auth = AuthFactory.create();

      await expect(
        sut.getPeopleFaceStatistics(auth, { closestAssetId: newUuid(), page: 1, size: 50 } as any),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect((mocks.person as any).getPeopleFaceStatistics).not.toHaveBeenCalled();
      expect((mocks.faceIdentity as any).getAccessiblePeopleFaceStatistics).not.toHaveBeenCalled();
    });
  });

  describe('representative face', () => {
    it('updates a personal representative face by exact assetFaceId', async () => {
      const auth = AuthFactory.create();
      const person = PersonFactory.create({ identityId: 'identity-1' });
      const face = AssetFaceFactory.create({ id: 'face-1', assetId: 'asset-1', personGroupId: person.personGroupId });
      mocks.access.person.checkOwnerAccess.mockResolvedValue(new Set([person.personGroupId]));
      mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set([face.assetId]));
      mocks.person.getRepresentativeFaceForUpdate.mockResolvedValue(face);
      mocks.person.getByGroupIdOnly.mockResolvedValue(person);
      mocks.person.update.mockResolvedValue({ ...person, faceAssetId: face.id });

      await expect(sut.updateRepresentativeFace(auth, person.personGroupId, { assetFaceId: face.id })).resolves.toEqual(
        expect.objectContaining({ id: person.personGroupId }),
      );

      expect(mocks.person.getRepresentativeFaceForUpdate).toHaveBeenCalledWith({
        personId: person.personGroupId,
        assetFaceId: face.id,
      });
      expect(mocks.person.update).toHaveBeenCalledWith({
        ownerId: person.ownerId,
        personGroupId: person.personGroupId,
        faceAssetId: face.id,
      });
      expect(mocks.faceIdentity.updateRepresentativeFace).toHaveBeenCalledWith({
        identityId: person.identityId,
        assetFaceId: face.id,
      });
      expect(mocks.job.queue).toHaveBeenCalledWith({
        name: JobName.PersonGenerateThumbnail,
        data: { ownerId: person.ownerId, personGroupId: person.personGroupId },
      });
    });

    it('rejects a face that does not belong to the requested person or identity', async () => {
      const auth = AuthFactory.create();
      const person = PersonFactory.create();
      mocks.access.person.checkOwnerAccess.mockResolvedValue(new Set([person.personGroupId]));
      mocks.person.getByGroupIdOnly.mockResolvedValue(person);
      mocks.person.getRepresentativeFaceForUpdate.mockResolvedValue(
        undefined as Awaited<ReturnType<typeof mocks.person.getRepresentativeFaceForUpdate>>,
      );

      await expect(sut.updateRepresentativeFace(auth, person.personGroupId, { assetFaceId: 'face-1' })).rejects.toThrow(
        BadRequestException,
      );

      expect(mocks.person.update).not.toHaveBeenCalled();
      expect(mocks.job.queue).not.toHaveBeenCalled();
    });

    it('rejects a selected face when the actor cannot read the face asset', async () => {
      const auth = AuthFactory.create();
      const person = PersonFactory.create();
      const face = AssetFaceFactory.create({ id: 'face-1', assetId: 'asset-1', personGroupId: person.personGroupId });
      mocks.access.person.checkOwnerAccess.mockResolvedValue(new Set([person.personGroupId]));
      mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set());
      mocks.person.getByGroupIdOnly.mockResolvedValue(person);
      mocks.person.getRepresentativeFaceForUpdate.mockResolvedValue(face);

      await expect(sut.updateRepresentativeFace(auth, person.personGroupId, { assetFaceId: face.id })).rejects.toThrow(
        BadRequestException,
      );

      expect(mocks.person.update).not.toHaveBeenCalled();
      expect(mocks.faceIdentity.updateRepresentativeFace).not.toHaveBeenCalled();
      expect(mocks.job.queue).not.toHaveBeenCalled();
    });

    it('lists exact personal face crops for the picker', async () => {
      const auth = AuthFactory.create();
      const person = PersonFactory.create({ faceAssetId: 'face-1' });
      mocks.access.person.checkOwnerAccess.mockResolvedValue(new Set([person.personGroupId]));
      mocks.person.getByGroupIdOnly.mockResolvedValue(person);
      mocks.person.getRepresentativeFaces.mockResolvedValue([
        {
          ...AssetFaceFactory.create({ id: 'face-1', assetId: 'asset-1', personGroupId: person.personGroupId }),
          fileCreatedAt: new Date('2024-01-01T00:00:00.000Z'),
          representativeFaceId: person.faceAssetId,
        },
        {
          ...AssetFaceFactory.create({ id: 'face-2', assetId: 'asset-2', personGroupId: person.personGroupId }),
          fileCreatedAt: new Date('2024-01-02T00:00:00.000Z'),
          representativeFaceId: person.faceAssetId,
        },
      ]);

      await expect(sut.getFacesForPicker(auth, person.personGroupId, { page: 1, size: 1 })).resolves.toEqual({
        faces: [expect.objectContaining({ id: 'face-1', assetId: 'asset-1', isRepresentative: true })],
        hasNextPage: true,
      });
    });

    it('serves a personal picker face crop only for faces belonging to the person', async () => {
      const auth = AuthFactory.create();
      const face = AssetFaceFactory.create({ id: 'face-1', assetId: 'asset-1' });
      const cleanup = vi.fn();
      mocks.access.person.checkOwnerAccess.mockResolvedValue(new Set(['person-1']));
      mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set([face.assetId]));
      mocks.person.getRepresentativeFaceForUpdate.mockResolvedValue(face);
      mocks.asset.getForThumbnail.mockResolvedValue({ path: '/preview.jpg' } as any);
      vi.spyOn(sut as any, 'ensureLocalFile').mockResolvedValue({ localPath: '/preview.jpg', cleanup });
      mocks.media.decodeImage.mockResolvedValue({
        data: Buffer.from('decoded-image'),
        info: { width: 250, height: 250, channels: 3 },
      });
      mocks.media.generateThumbnail.mockImplementation(async (_input, _options, output) => {
        await writeFile(output, Buffer.from('cropped-face'));
      });

      const result = await sut.getFaceThumbnail(auth, 'person-1', 'face-1');

      expect(mocks.person.getRepresentativeFaceForUpdate).toHaveBeenCalledWith({
        personId: 'person-1',
        assetFaceId: 'face-1',
      });
      expect(mocks.media.generateThumbnail).toHaveBeenCalled();
      expect(cleanup).toHaveBeenCalled();
      if (result instanceof ImmichStreamResponse) {
        result.stream.destroy();
      }
    });

    it('lists picker face crops for a shared-space member who does not own the person', async () => {
      const auth = AuthFactory.create();
      const person = PersonFactory.create({ faceAssetId: 'face-1' });
      mocks.access.person.checkOwnerAccess.mockResolvedValue(new Set());
      mocks.access.person.checkSharedSpaceAccess.mockResolvedValue(new Set([person.personGroupId]));
      mocks.person.getByGroupIdOnly.mockResolvedValue(person);
      mocks.person.getRepresentativeFaces.mockResolvedValue([
        {
          ...AssetFaceFactory.create({ id: 'face-1', assetId: 'asset-1', personGroupId: person.personGroupId }),
          fileCreatedAt: new Date('2024-01-01T00:00:00.000Z'),
          representativeFaceId: person.faceAssetId,
        },
      ]);

      await expect(sut.getFacesForPicker(auth, person.personGroupId, { page: 1, size: 10 })).resolves.toEqual({
        faces: [expect.objectContaining({ id: 'face-1', assetId: 'asset-1', isRepresentative: true })],
        hasNextPage: false,
      });
      expect(mocks.access.person.checkSharedSpaceAccess).toHaveBeenCalledWith(
        auth.user.id,
        new Set([person.personGroupId]),
      );
    });

    // M1: a non-owner (space-granted) caller must be scoped to space-reachable, shareable-visibility
    // faces only -- never the owner's Hidden/never-shared faces or faces pulled in via another user's
    // identity. checkOwnerAccess returning an empty set is the non-owner signal.
    it('scopes the repository call to the caller when the caller does not own the person', async () => {
      const auth = AuthFactory.create();
      const person = PersonFactory.create({ faceAssetId: 'face-1' });
      mocks.access.person.checkOwnerAccess.mockResolvedValue(new Set());
      mocks.access.person.checkSharedSpaceAccess.mockResolvedValue(new Set([person.personGroupId]));
      mocks.person.getByGroupIdOnly.mockResolvedValue(person);
      mocks.person.getRepresentativeFaces.mockResolvedValue([]);

      await sut.getFacesForPicker(auth, person.personGroupId, { page: 1, size: 10 });

      expect(mocks.person.getRepresentativeFaces).toHaveBeenCalledWith({
        personId: person.personGroupId,
        take: 10,
        skip: 0,
        scope: { memberUserId: auth.user.id },
      });
    });

    it('does not scope the repository call for the owner', async () => {
      const auth = AuthFactory.create();
      const person = PersonFactory.create({ faceAssetId: 'face-1' });
      mocks.access.person.checkOwnerAccess.mockResolvedValue(new Set([person.personGroupId]));
      mocks.person.getByGroupIdOnly.mockResolvedValue(person);
      mocks.person.getRepresentativeFaces.mockResolvedValue([]);

      await sut.getFacesForPicker(auth, person.personGroupId, { page: 1, size: 10 });

      expect(mocks.person.getRepresentativeFaces).toHaveBeenCalledWith({
        personId: person.personGroupId,
        take: 10,
        skip: 0,
        scope: undefined,
      });
    });

    // M2: renamed from "...a shared-space member..." — before M2, ANY shared-space member (including
    // a Viewer) passed here since only PersonRead was checked. Now the write gate additionally
    // requires Editor/Owner space role, so this positive control must grant edit access explicitly.
    it('updates the representative face for a shared-space Editor who does not own the person', async () => {
      const auth = AuthFactory.create();
      const person = PersonFactory.create({ identityId: 'identity-1' });
      const face = AssetFaceFactory.create({ id: 'face-1', assetId: 'asset-1', personGroupId: person.personGroupId });
      mocks.access.person.checkOwnerAccess.mockResolvedValue(new Set());
      mocks.access.person.checkSharedSpaceAccess.mockResolvedValue(new Set([person.personGroupId]));
      mocks.access.person.checkSharedSpaceEditAccess.mockResolvedValue(new Set([person.personGroupId]));
      mocks.access.asset.checkSpaceAccess.mockResolvedValue(new Set([face.assetId]));
      mocks.person.getRepresentativeFaceForUpdate.mockResolvedValue(face);
      mocks.person.getByGroupIdOnly.mockResolvedValue(person);
      mocks.person.update.mockResolvedValue({ ...person, faceAssetId: face.id });

      await expect(sut.updateRepresentativeFace(auth, person.personGroupId, { assetFaceId: face.id })).resolves.toEqual(
        expect.objectContaining({ id: person.personGroupId }),
      );

      expect(mocks.person.update).toHaveBeenCalledWith({
        ownerId: person.ownerId,
        personGroupId: person.personGroupId,
        faceAssetId: face.id,
      });
      expect(mocks.access.person.checkSharedSpaceEditAccess).toHaveBeenCalledWith(
        auth.user.id,
        new Set([person.personGroupId]),
      );
    });

    it('rejects a representative face update when the actor cannot read the chosen face asset', async () => {
      const auth = AuthFactory.create();
      const person = PersonFactory.create();
      const face = AssetFaceFactory.create({ id: 'face-1', assetId: 'asset-1', personGroupId: person.personGroupId });
      mocks.access.person.checkOwnerAccess.mockResolvedValue(new Set());
      mocks.access.person.checkSharedSpaceAccess.mockResolvedValue(new Set([person.personGroupId]));
      // Editor access (the M2 write gate) is granted; the failure below is the pre-existing,
      // unrelated AssetRead check on the chosen face itself.
      mocks.access.person.checkSharedSpaceEditAccess.mockResolvedValue(new Set([person.personGroupId]));
      mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set());
      mocks.access.asset.checkSpaceAccess.mockResolvedValue(new Set());
      mocks.person.getByGroupIdOnly.mockResolvedValue(person);
      mocks.person.getRepresentativeFaceForUpdate.mockResolvedValue(face);

      await expect(sut.updateRepresentativeFace(auth, person.personGroupId, { assetFaceId: face.id })).rejects.toThrow(
        BadRequestException,
      );

      expect(mocks.person.update).not.toHaveBeenCalled();
      expect(mocks.job.queue).not.toHaveBeenCalled();
    });

    // Slice 3 — M2: PersonRead (checked above) admits ANY space role, including Viewer. Mutating the
    // owner's GLOBAL representative face must be denied to a Viewer -- only the owner or a space
    // Editor/Owner may do it. Before this fix, a Viewer with PersonRead reachability could mutate.
    it('denies a representative face update from a shared-space viewer who is not owner or editor (M2)', async () => {
      const auth = AuthFactory.create();
      const person = PersonFactory.create({ identityId: 'identity-1' });
      const face = AssetFaceFactory.create({ id: 'face-1', assetId: 'asset-1', personGroupId: person.personGroupId });
      // PersonRead reachability: the viewer has shared-space READ access...
      mocks.access.person.checkOwnerAccess.mockResolvedValue(new Set());
      mocks.access.person.checkSharedSpaceAccess.mockResolvedValue(new Set([person.personGroupId]));
      // ...but NOT edit access (viewer role).
      mocks.access.person.checkSharedSpaceEditAccess.mockResolvedValue(new Set());
      mocks.access.asset.checkSpaceAccess.mockResolvedValue(new Set([face.assetId]));
      mocks.person.getByGroupIdOnly.mockResolvedValue(person);
      mocks.person.getRepresentativeFaceForUpdate.mockResolvedValue(face);

      await expect(sut.updateRepresentativeFace(auth, person.personGroupId, { assetFaceId: face.id })).rejects.toThrow(
        ForbiddenException,
      );

      expect(mocks.access.person.checkSharedSpaceEditAccess).toHaveBeenCalledWith(
        auth.user.id,
        new Set([person.personGroupId]),
      );
      expect(mocks.person.update).not.toHaveBeenCalled();
      expect(mocks.faceIdentity.updateRepresentativeFace).not.toHaveBeenCalled();
      expect(mocks.job.queue).not.toHaveBeenCalled();
    });
  });

  describe('scoped people repair', () => {
    // The scoped merge now delegates wholesale to the propagation planner: the planner resolves and
    // RBAC-checks the refs, and collapses profiles that would otherwise land in the same scope. The service's
    // only remaining job is the cross-owner policy, which it hands to the planner as an authorizer that runs
    // against the built plan, inside the merge transaction, before anything is written (#733).
    it('delegates the merge to the propagation planner, with an authorizer', async () => {
      const identityMergePropagation = useIdentityMergePropagation();
      const auth = AuthFactory.create();
      const dto = {
        target: { type: 'person' as const, id: newUuid() },
        sources: [{ type: 'space-person' as const, id: newUuid(), spaceId: newUuid() }],
      };

      await sut.mergeScopedPeople(auth, dto);

      expect(identityMergePropagation.mergeScopedProfiles).toHaveBeenCalledWith(auth, dto, expect.any(Function));
      expect(mocks.faceIdentity.mergeIdentities).not.toHaveBeenCalled();
    });

    // #733 review H1: the cross-owner toggle must be resolved BEFORE the merge transaction opens. The authorizer
    // runs inside that transaction while it holds the instance-wide advisory lock, and a config read there needs a
    // second pool connection a saturated pool cannot grant — deadlocking every merge (#595). So the service reads
    // the config eagerly and hands the authorizer an already-resolved value; invoking it does no further config I/O.
    it('resolves the cross-owner toggle before delegating to the planner (not inside the merge transaction)', async () => {
      mocks.systemMetadata.get.mockResolvedValue({ server: { mergePeopleAcrossOwners: false } });
      const identityMergePropagation = useIdentityMergePropagation();

      await sut.mergeScopedPeople(AuthFactory.create(), crossOwnerMergeDto() as never);

      expect(mocks.systemMetadata.get).toHaveBeenCalled();
      const readsBeforeAuthorize = mocks.systemMetadata.get.mock.calls.length;
      const authorize = identityMergePropagation.mergeScopedProfiles.mock.calls[0][2] as MergeAuthorizerFn;
      await authorize(planWith({ collapsedOwnerIds: ['owner-b'] })).catch(() => {});
      expect(mocks.systemMetadata.get).toHaveBeenCalledTimes(readsBeforeAuthorize);
    });

    // (a) A merge that only RE-POINTS another owner's person is not destructive — their row keeps its name and
    // faces, and the recognition job does exactly this unattended. It is never gated, even with the toggle off.
    it('does not gate a merge that only re-points another owner’s person', async () => {
      mocks.systemMetadata.get.mockResolvedValue({ server: { mergePeopleAcrossOwners: false } });
      const identityMergePropagation = useIdentityMergePropagation();
      await sut.mergeScopedPeople(AuthFactory.create(), crossOwnerMergeDto() as never);
      const authorize = identityMergePropagation.mergeScopedProfiles.mock.calls[0][2] as MergeAuthorizerFn;

      await expect(authorize(planWith({ repointedOwnerIds: ['owner-b'] }))).resolves.toBeUndefined();
    });

    // (b) A merge that would COLLAPSE two of another owner's people deletes one of their rows. That is what the
    // instance toggle and the confirmation exist for.
    it('blocks a destructive cross-owner merge when the toggle is off', async () => {
      mocks.systemMetadata.get.mockResolvedValue({ server: { mergePeopleAcrossOwners: false } });
      const identityMergePropagation = useIdentityMergePropagation();
      await sut.mergeScopedPeople(AuthFactory.create(), crossOwnerMergeDto() as never);
      const authorize = identityMergePropagation.mergeScopedProfiles.mock.calls[0][2] as MergeAuthorizerFn;

      const error = await authorize(planWith({ collapsedOwnerIds: ['owner-b'] })).catch((error_: unknown) => error_);

      expect(error).toBeInstanceOf(ForbiddenException);
      expect((error as ForbiddenException).getResponse()).toMatchObject({
        code: CROSS_OWNER_MERGE_ERROR_CODE.blocked,
      });
    });

    it('requires explicit confirmation for a destructive cross-owner merge when the toggle is on', async () => {
      mocks.systemMetadata.get.mockResolvedValue({ server: { mergePeopleAcrossOwners: true } });
      const identityMergePropagation = useIdentityMergePropagation();
      await sut.mergeScopedPeople(AuthFactory.create(), crossOwnerMergeDto() as never);
      const authorize = identityMergePropagation.mergeScopedProfiles.mock.calls[0][2] as MergeAuthorizerFn;

      const error = await authorize(planWith({ collapsedOwnerIds: ['owner-b', 'owner-c'] })).catch(
        (error_: unknown) => error_,
      );

      expect(error).toBeInstanceOf(ConflictException);
      expect((error as ConflictException).getResponse()).toMatchObject({
        code: CROSS_OWNER_MERGE_ERROR_CODE.confirmationRequired,
        impactedOwnerCount: 2,
      });
    });

    it('permits a destructive cross-owner merge once the toggle is on and the user confirms', async () => {
      mocks.systemMetadata.get.mockResolvedValue({ server: { mergePeopleAcrossOwners: true } });
      const identityMergePropagation = useIdentityMergePropagation();
      await sut.mergeScopedPeople(AuthFactory.create(), crossOwnerMergeDto({ confirmCrossOwner: true }) as never);
      const authorize = identityMergePropagation.mergeScopedProfiles.mock.calls[0][2] as MergeAuthorizerFn;

      await expect(authorize(planWith({ collapsedOwnerIds: ['owner-b'] }))).resolves.toBeUndefined();
      // Affected owners are intentionally not notified (issue #733 revision): once the instance opts in and the
      // user acknowledges, the merge commits silently.
      expect(mocks.notification.create).not.toHaveBeenCalled();
      expect(mocks.websocket.clientSend).not.toHaveBeenCalled();
    });

    it('detaches a scoped profile after access and backing-face checks', async () => {
      const auth = AuthFactory.create();
      const profile = { type: 'person' as const, id: newUuid() };
      mocks.faceIdentity.resolveDetachRef.mockResolvedValue({
        accessible: true,
        identityId: 'identity-1',
        type: 'person',
        allBackingFacesRepairable: true,
      } as any);

      await sut.detachScopedPerson(auth, { profile });

      expect(mocks.faceIdentity.resolveDetachRef).toHaveBeenCalledWith(auth.user.id, profile);
      expect(mocks.faceIdentity.detachScopedProfile).toHaveBeenCalledWith(profile);
      expect(mocks.job.queue).toHaveBeenCalledWith({
        name: JobName.SharedSpacePersonMetadataBackfill,
        data: {},
      });
    });

    it('rejects detach when selected profile faces also back inaccessible profiles', async () => {
      const auth = AuthFactory.create();
      mocks.faceIdentity.resolveDetachRef.mockResolvedValue({
        accessible: true,
        identityId: 'identity-1',
        type: 'person',
        allBackingFacesRepairable: false,
      } as any);

      await expect(
        sut.detachScopedPerson(auth, { profile: { type: 'space-person', id: newUuid(), spaceId: newUuid() } }),
      ).rejects.toBeInstanceOf(ForbiddenException);

      expect(mocks.faceIdentity.detachScopedProfile).not.toHaveBeenCalled();
    });
  });
});
