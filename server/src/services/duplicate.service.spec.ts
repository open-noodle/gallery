import { BulkIdErrorReason } from 'src/dtos/asset-ids.response.dto';
import { MapAsset } from 'src/dtos/asset-response.dto';
import { AssetType, AssetVisibility, JobName, JobStatus } from 'src/enum';
import { DuplicateService } from 'src/services/duplicate.service';
import { AssetFactory } from 'test/factories/asset.factory';
import { authStub } from 'test/fixtures/auth.stub';
import { getForDuplicate } from 'test/mappers';
import { newUuid } from 'test/small.factory';
import { makeStream, newTestService, ServiceMocks } from 'test/utils';
import { beforeEach, describe, expect, it, vitest } from 'vitest';

vitest.useFakeTimers();

const hasEmbedding = {
  id: 'asset-1',
  ownerId: 'user-id',
  stackId: null,
  type: AssetType.Image,
  duplicateId: null,
  embedding: '[1, 2, 3, 4]',
  visibility: AssetVisibility.Timeline,
};

const hasDupe = {
  ...hasEmbedding,
  id: 'asset-2',
  duplicateId: 'duplicate-id',
};

describe(DuplicateService.name, () => {
  let sut: DuplicateService;
  let mocks: ServiceMocks;

  beforeEach(() => {
    ({ sut, mocks } = newTestService(DuplicateService));
    mocks.duplicateRepository.delete.mockResolvedValue(undefined as any);
    mocks.duplicateRepository.deleteAll.mockResolvedValue(undefined as any);
    // Default to "no editable spaces" so the new merge branch is a no-op for
    // existing tests. Tests that exercise the merge override per case.
    mocks.sharedSpace.getEditableByAssetIds.mockResolvedValue(new Set());
  });

  it('should work', () => {
    expect(sut).toBeDefined();
  });

  describe('getDuplicates', () => {
    it('should get duplicates', async () => {
      const asset = AssetFactory.from().exif().build();
      mocks.access.duplicate.checkOwnerAccess.mockResolvedValue(new Set(['duplicate-id']));
      mocks.duplicateRepository.cleanupSingletonGroups.mockResolvedValue();
      mocks.duplicateRepository.getAll.mockResolvedValue([
        {
          duplicateId: 'duplicate-id',
          assets: [getForDuplicate(asset), getForDuplicate(asset)],
        },
      ]);
      await expect(sut.getDuplicates(authStub.admin)).resolves.toEqual([
        {
          duplicateId: 'duplicate-id',
          assets: [expect.objectContaining({ id: asset.id }), expect.objectContaining({ id: asset.id })],
          suggestedKeepAssetIds: [asset.id],
        },
      ]);
    });

    it('should return suggestedKeepAssetIds based on file size', async () => {
      const smallAsset = AssetFactory.from().exif({ fileSizeInByte: 1000 }).build();
      const largeAsset = AssetFactory.from().exif({ fileSizeInByte: 5000 }).build();
      mocks.duplicateRepository.cleanupSingletonGroups.mockResolvedValue();
      mocks.duplicateRepository.getAll.mockResolvedValue([
        {
          duplicateId: 'duplicate-id',
          assets: [getForDuplicate(smallAsset), getForDuplicate(largeAsset)],
        },
      ]);
      const result = await sut.getDuplicates(authStub.admin);
      expect(result[0].suggestedKeepAssetIds).toEqual([largeAsset.id]);
    });
  });

  describe('delete', () => {
    it('should delete a specific duplicate group', async () => {
      const duplicateId = newUuid();

      await sut.delete(authStub.admin, duplicateId);

      expect(mocks.duplicateRepository.delete).toHaveBeenCalledWith(authStub.admin.user.id, duplicateId);
    });
  });

  describe('deleteAll', () => {
    it('should delete multiple duplicate groups', async () => {
      const ids = [newUuid(), newUuid()];

      await sut.deleteAll(authStub.admin, { ids });

      expect(mocks.duplicateRepository.deleteAll).toHaveBeenCalledWith(authStub.admin.user.id, ids);
    });
  });

  describe('handleQueueSearchDuplicates', () => {
    beforeEach(() => {
      mocks.systemMetadata.get.mockResolvedValue({
        machineLearning: {
          enabled: true,
          duplicateDetection: {
            enabled: true,
          },
        },
      });
    });

    it('should skip if machine learning is disabled', async () => {
      mocks.systemMetadata.get.mockResolvedValue({
        machineLearning: {
          enabled: false,
          duplicateDetection: {
            enabled: true,
          },
        },
      });

      await expect(sut.handleQueueSearchDuplicates({})).resolves.toBe(JobStatus.Skipped);
      expect(mocks.job.queue).not.toHaveBeenCalled();
      expect(mocks.job.queueAll).not.toHaveBeenCalled();
      expect(mocks.systemMetadata.get).toHaveBeenCalled();
    });

    it('should skip if duplicate detection is disabled', async () => {
      mocks.systemMetadata.get.mockResolvedValue({
        machineLearning: {
          enabled: true,
          duplicateDetection: {
            enabled: false,
          },
        },
      });

      await expect(sut.handleQueueSearchDuplicates({})).resolves.toBe(JobStatus.Skipped);
      expect(mocks.job.queue).not.toHaveBeenCalled();
      expect(mocks.job.queueAll).not.toHaveBeenCalled();
      expect(mocks.systemMetadata.get).toHaveBeenCalled();
    });

    it('should queue missing assets', async () => {
      const asset = AssetFactory.create();
      mocks.assetJob.streamForSearchDuplicates.mockReturnValue(makeStream([asset]));

      await sut.handleQueueSearchDuplicates({});

      expect(mocks.assetJob.streamForSearchDuplicates).toHaveBeenCalledWith(undefined);
      expect(mocks.job.queueAll).toHaveBeenCalledWith([
        {
          name: JobName.AssetDetectDuplicates,
          data: { id: asset.id },
        },
      ]);
    });

    it('should queue all assets', async () => {
      const asset = AssetFactory.create();
      mocks.assetJob.streamForSearchDuplicates.mockReturnValue(makeStream([asset]));

      await sut.handleQueueSearchDuplicates({ force: true });

      expect(mocks.assetJob.streamForSearchDuplicates).toHaveBeenCalledWith(true);
      expect(mocks.job.queueAll).toHaveBeenCalledWith([
        {
          name: JobName.AssetDetectDuplicates,
          data: { id: asset.id },
        },
      ]);
    });

    it('should batch queue assets when exceeding pagination size', async () => {
      const assets = Array.from({ length: 1001 }, () => AssetFactory.create());
      mocks.assetJob.streamForSearchDuplicates.mockReturnValue(makeStream(assets));

      await sut.handleQueueSearchDuplicates({});

      // Should have been called at least twice: once for the batch of 1000, once for the remaining 1
      expect(mocks.job.queueAll).toHaveBeenCalledTimes(2);
    });
  });

  describe('resolve', () => {
    it('should handle mixed success and failure', async () => {
      const asset = AssetFactory.create();
      mocks.access.duplicate.checkOwnerAccess.mockResolvedValue(new Set(['group-1', 'group-2']));
      mocks.duplicateRepository.get.mockResolvedValueOnce(void 0);
      mocks.duplicateRepository.get.mockResolvedValueOnce({
        duplicateId: 'group-2',
        assets: [asset as unknown as MapAsset],
      });

      await expect(
        sut.resolve(authStub.admin, {
          groups: [
            { duplicateId: 'group-1', keepAssetIds: [], trashAssetIds: [] },
            { duplicateId: 'group-2', keepAssetIds: [asset.id], trashAssetIds: [] },
          ],
        }),
      ).resolves.toEqual([
        { id: 'group-1', success: false, error: BulkIdErrorReason.NOT_FOUND },
        { id: 'group-2', success: true },
      ]);
    });

    it('should catch and report errors', async () => {
      mocks.access.duplicate.checkOwnerAccess.mockResolvedValue(new Set(['group-1']));
      mocks.duplicateRepository.get.mockRejectedValue(new Error('Database error'));

      await expect(
        sut.resolve(authStub.admin, {
          groups: [{ duplicateId: 'group-1', keepAssetIds: [], trashAssetIds: [] }],
        }),
      ).resolves.toEqual([{ id: 'group-1', success: false, error: BulkIdErrorReason.UNKNOWN }]);
    });
  });

  describe('resolveGroup (via resolve)', () => {
    it('should fail if duplicate group not found', async () => {
      mocks.access.duplicate.checkOwnerAccess.mockResolvedValue(new Set(['missing-id']));
      mocks.duplicateRepository.get.mockResolvedValue(void 0);

      await expect(
        sut.resolve(authStub.admin, {
          groups: [{ duplicateId: 'missing-id', keepAssetIds: [], trashAssetIds: [] }],
        }),
      ).resolves.toEqual([
        {
          id: 'missing-id',
          success: false,
          error: BulkIdErrorReason.NOT_FOUND,
        },
      ]);
    });

    it('should skip when keepAssetIds contains non-member', async () => {
      const asset = AssetFactory.create();
      mocks.access.duplicate.checkOwnerAccess.mockResolvedValue(new Set(['group-1']));
      mocks.duplicateRepository.get.mockResolvedValue({
        duplicateId: 'group-1',
        assets: [asset as unknown as MapAsset],
      });

      await expect(
        sut.resolve(authStub.admin, {
          groups: [{ duplicateId: 'group-1', keepAssetIds: ['asset-999', asset.id], trashAssetIds: [] }],
        }),
      ).resolves.toEqual([{ id: 'group-1', success: true }]);
    });

    it('should skip when trashAssetIds contains non-member', async () => {
      const asset = AssetFactory.create();
      mocks.access.duplicate.checkOwnerAccess.mockResolvedValue(new Set(['group-1']));
      mocks.duplicateRepository.get.mockResolvedValue({
        duplicateId: 'group-1',
        assets: [asset as unknown as MapAsset],
      });

      await expect(
        sut.resolve(authStub.admin, {
          groups: [{ duplicateId: 'group-1', keepAssetIds: [asset.id], trashAssetIds: ['asset-999'] }],
        }),
      ).resolves.toEqual([{ id: 'group-1', success: true }]);
    });

    it('should fail if keepAssetIds and trashAssetIds overlap', async () => {
      const asset1 = AssetFactory.create();
      const asset2 = AssetFactory.create();
      mocks.access.duplicate.checkOwnerAccess.mockResolvedValue(new Set(['group-1']));
      mocks.duplicateRepository.get.mockResolvedValue({
        duplicateId: 'group-1',
        assets: [asset1 as unknown as MapAsset, asset2 as unknown as MapAsset],
      });

      const result = await sut.resolve(authStub.admin, {
        groups: [{ duplicateId: 'group-1', keepAssetIds: [asset1.id], trashAssetIds: [asset1.id] }],
      });

      expect(result[0].success).toBe(false);
      expect(result[0].errorMessage).toContain('An asset cannot be in both keepAssetIds and trashAssetIds');
    });

    it('should fail if keepAssetIds and trashAssetIds do not cover all assets', async () => {
      const asset1 = AssetFactory.create();
      const asset2 = AssetFactory.create();
      const asset3 = AssetFactory.create();
      mocks.access.duplicate.checkOwnerAccess.mockResolvedValue(new Set(['group-1']));
      mocks.duplicateRepository.get.mockResolvedValue({
        duplicateId: 'group-1',
        assets: [asset1 as unknown as MapAsset, asset2 as unknown as MapAsset, asset3 as unknown as MapAsset],
      });

      const result = await sut.resolve(authStub.admin, {
        groups: [{ duplicateId: 'group-1', keepAssetIds: [asset1.id], trashAssetIds: [asset2.id] }],
      });

      expect(result[0].success).toBe(false);
      expect(result[0].errorMessage).toContain('Every asset must be in either keepAssetIds or trashAssetIds');
    });

    it('should fail if partial trash without keepers', async () => {
      const asset1 = AssetFactory.create();
      const asset2 = AssetFactory.create();
      mocks.access.duplicate.checkOwnerAccess.mockResolvedValue(new Set(['group-1']));
      mocks.duplicateRepository.get.mockResolvedValue({
        duplicateId: 'group-1',
        assets: [asset1 as unknown as MapAsset, asset2 as unknown as MapAsset],
      });

      const result = await sut.resolve(authStub.admin, {
        groups: [{ duplicateId: 'group-1', keepAssetIds: [], trashAssetIds: [asset1.id] }],
      });

      expect(result[0].success).toBe(false);
      expect(result[0].errorMessage).toContain('Every asset must be in either keepAssetIds or trashAssetIds');
    });

    it('should sync merged tags to asset_exif.tags', async () => {
      const asset1 = AssetFactory.create();
      const asset2 = AssetFactory.create();
      mocks.access.duplicate.checkOwnerAccess.mockResolvedValue(new Set(['group-1']));
      mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set(['asset-2']));
      mocks.access.tag.checkOwnerAccess.mockResolvedValue(new Set(['tag-1', 'tag-2']));
      mocks.duplicateRepository.get.mockResolvedValue({
        duplicateId: 'group-1',
        assets: [
          {
            ...asset1,
            tags: [
              {
                id: 'tag-1',
                value: 'Work',
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                parentId: null,
                color: null,
              },
            ],
          },
          {
            ...asset2,
            tags: [
              {
                id: 'tag-2',
                value: 'Travel',
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                parentId: null,
                color: null,
              },
            ],
          },
        ] as any,
      });

      const result = await sut.resolve(authStub.admin, {
        groups: [{ duplicateId: 'group-1', keepAssetIds: [asset1.id], trashAssetIds: [asset2.id] }],
      });

      expect(result[0].success).toBe(true);

      // Verify tags were applied to tag_asset table
      expect(mocks.tag.replaceAssetTags).toHaveBeenCalledWith(asset1.id, ['tag-1', 'tag-2']);

      // Verify merged tag values were written to asset_exif.tags so SidecarWrite preserves them
      expect(mocks.asset.updateAllExif).toHaveBeenCalledWith([asset1.id], { tags: ['Work', 'Travel'] });

      // Verify SidecarWrite was queued (to write tags to sidecar)
      expect(mocks.job.queueAll).toHaveBeenCalledWith([{ name: JobName.SidecarWrite, data: { id: asset1.id } }]);
    });

    describe('shared space sync', () => {
      const spaceX = 'space-x-id';
      const spaceY = 'space-y-id';

      // eslint-disable-next-line unicorn/consistent-function-scoping -- test helper, kept local to this describe
      const setupBaseDuplicate = (asset1: any, asset2: any) => {
        mocks.access.duplicate.checkOwnerAccess.mockResolvedValue(new Set(['group-1']));
        mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set([asset2.id]));
        mocks.duplicateRepository.get.mockResolvedValue({
          duplicateId: 'group-1',
          assets: [asset1 as unknown as MapAsset, asset2 as unknown as MapAsset],
        });
      };

      it('adds keeper to spaces the trashed asset was in', async () => {
        const asset1 = AssetFactory.create();
        const asset2 = AssetFactory.create();
        setupBaseDuplicate(asset1, asset2);
        mocks.sharedSpace.getEditableByAssetIds.mockResolvedValue(new Set([spaceX]));
        mocks.sharedSpace.addAssets.mockResolvedValue([]);

        const result = await sut.resolve(authStub.admin, {
          groups: [{ duplicateId: 'group-1', keepAssetIds: [asset1.id], trashAssetIds: [asset2.id] }],
        });

        expect(result[0].success).toBe(true);
        expect(mocks.sharedSpace.getEditableByAssetIds).toHaveBeenCalledWith(
          authStub.admin.user.id,
          new Set([asset1.id, asset2.id]),
        );
        expect(mocks.sharedSpace.addAssets).toHaveBeenCalledWith([
          { spaceId: spaceX, assetId: asset1.id, addedById: authStub.admin.user.id },
        ]);
        expect(mocks.job.queueAll).toHaveBeenCalledWith(
          expect.arrayContaining([
            { name: JobName.SharedSpaceFaceMatch, data: { spaceId: spaceX, assetId: asset1.id } },
          ]),
        );
      });

      it('does not call addAssets when the user has no editable spaces containing the group', async () => {
        const asset1 = AssetFactory.create();
        const asset2 = AssetFactory.create();
        setupBaseDuplicate(asset1, asset2);
        mocks.sharedSpace.getEditableByAssetIds.mockResolvedValue(new Set());

        const result = await sut.resolve(authStub.admin, {
          groups: [{ duplicateId: 'group-1', keepAssetIds: [asset1.id], trashAssetIds: [asset2.id] }],
        });

        expect(result[0].success).toBe(true);
        expect(mocks.sharedSpace.addAssets).not.toHaveBeenCalled();
        const faceMatchCalls = mocks.job.queueAll.mock.calls
          .flat()
          .flat()
          .filter((j: any) => j?.name === JobName.SharedSpaceFaceMatch);
        expect(faceMatchCalls).toHaveLength(0);
      });

      it('adds keeper to multiple editable spaces', async () => {
        const asset1 = AssetFactory.create();
        const asset2 = AssetFactory.create();
        setupBaseDuplicate(asset1, asset2);
        mocks.sharedSpace.getEditableByAssetIds.mockResolvedValue(new Set([spaceX, spaceY]));
        mocks.sharedSpace.addAssets.mockResolvedValue([]);

        const result = await sut.resolve(authStub.admin, {
          groups: [{ duplicateId: 'group-1', keepAssetIds: [asset1.id], trashAssetIds: [asset2.id] }],
        });

        expect(result[0].success).toBe(true);
        const addAssetsArg = mocks.sharedSpace.addAssets.mock.calls[0][0] as Array<{
          spaceId: string;
          assetId: string;
          addedById: string;
        }>;
        expect(addAssetsArg).toHaveLength(2);
        expect(addAssetsArg).toEqual(
          expect.arrayContaining([
            { spaceId: spaceX, assetId: asset1.id, addedById: authStub.admin.user.id },
            { spaceId: spaceY, assetId: asset1.id, addedById: authStub.admin.user.id },
          ]),
        );

        const queuedFaceJobs = mocks.job.queueAll.mock.calls
          .flat()
          .flat()
          .filter((j: any) => j?.name === JobName.SharedSpaceFaceMatch);
        expect(queuedFaceJobs).toHaveLength(2);
      });

      it('skips the space sync branch entirely when there are no keepers', async () => {
        const asset1 = AssetFactory.create();
        const asset2 = AssetFactory.create();
        setupBaseDuplicate(asset1, asset2);
        mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set([asset1.id, asset2.id]));

        const result = await sut.resolve(authStub.admin, {
          groups: [{ duplicateId: 'group-1', keepAssetIds: [], trashAssetIds: [asset1.id, asset2.id] }],
        });

        expect(result[0].success).toBe(true);
        expect(mocks.sharedSpace.getEditableByAssetIds).not.toHaveBeenCalled();
        expect(mocks.sharedSpace.addAssets).not.toHaveBeenCalled();
      });

      it('reports failure cleanly if addAssets throws, and NO downstream mutation runs', async () => {
        // Regression guard for the "place merge first" decision in the design.
        // If anyone moves the new branch later, downstream mutations would
        // have already happened before the throw, leaving partial state.
        const asset1 = AssetFactory.create();
        const asset2 = AssetFactory.create();
        setupBaseDuplicate(asset1, asset2);
        mocks.sharedSpace.getEditableByAssetIds.mockResolvedValue(new Set([spaceX]));
        mocks.sharedSpace.addAssets.mockRejectedValue(new Error('db exploded'));

        const result = await sut.resolve(authStub.admin, {
          groups: [{ duplicateId: 'group-1', keepAssetIds: [asset1.id], trashAssetIds: [asset2.id] }],
        });

        expect(result[0].success).toBe(false);
        expect(result[0].error).toBe(BulkIdErrorReason.UNKNOWN);

        // None of the downstream merge / mutation steps should have run.
        expect(mocks.album.addAssetIdsToAlbums).not.toHaveBeenCalled();
        expect(mocks.tag.replaceAssetTags).not.toHaveBeenCalled();
        expect(mocks.asset.updateAllExif).not.toHaveBeenCalled();

        // The trash step must NOT have run.
        const trashCalls = mocks.asset.updateAll.mock.calls.filter(
          ([_ids, update]: [string[], any]) =>
            update && (update.deletedAt !== undefined || update.status !== undefined),
        );
        expect(trashCalls).toHaveLength(0);
      });
    });

    // NOTE: The following integration-style tests are covered by E2E tests instead
    // to avoid complex mock setup. The validation and error-handling logic above
    // is thoroughly unit tested.
  });

  describe('resolveGroup tombstones', () => {
    it('should create checksum tombstone when resolving duplicates', async () => {
      const asset1 = AssetFactory.create();
      const asset2 = AssetFactory.create();
      const checksum = Buffer.from('abc123', 'hex');
      mocks.access.duplicate.checkOwnerAccess.mockResolvedValue(new Set(['group-1']));
      mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set([asset2.id]));
      mocks.duplicateRepository.get.mockResolvedValue({
        duplicateId: 'group-1',
        assets: [asset1 as unknown as MapAsset, asset2 as unknown as MapAsset],
      });
      mocks.asset.getChecksumsByIds.mockResolvedValue([{ id: asset2.id, checksum }]);

      const result = await sut.resolve(authStub.admin, {
        groups: [{ duplicateId: 'group-1', keepAssetIds: [asset1.id], trashAssetIds: [asset2.id] }],
      });

      expect(result[0].success).toBe(true);
      expect(mocks.asset.getChecksumsByIds).toHaveBeenCalledWith([asset2.id]);
      expect(mocks.duplicateRepository.createChecksumTombstones).toHaveBeenCalledWith([
        { assetId: asset1.id, ownerId: authStub.admin.user.id, checksum },
      ]);
    });

    it('should create tombstones for multiple trashed assets pointing to first kept asset', async () => {
      const asset1 = AssetFactory.create();
      const asset2 = AssetFactory.create();
      const asset3 = AssetFactory.create();
      const checksum2 = Buffer.from('aabb', 'hex');
      const checksum3 = Buffer.from('ccdd', 'hex');
      mocks.access.duplicate.checkOwnerAccess.mockResolvedValue(new Set(['group-1']));
      mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set([asset2.id, asset3.id]));
      mocks.duplicateRepository.get.mockResolvedValue({
        duplicateId: 'group-1',
        assets: [asset1 as unknown as MapAsset, asset2 as unknown as MapAsset, asset3 as unknown as MapAsset],
      });
      mocks.asset.getChecksumsByIds.mockResolvedValue([
        { id: asset2.id, checksum: checksum2 },
        { id: asset3.id, checksum: checksum3 },
      ]);

      const result = await sut.resolve(authStub.admin, {
        groups: [{ duplicateId: 'group-1', keepAssetIds: [asset1.id], trashAssetIds: [asset2.id, asset3.id] }],
      });

      expect(result[0].success).toBe(true);
      expect(mocks.duplicateRepository.createChecksumTombstones).toHaveBeenCalledWith([
        { assetId: asset1.id, ownerId: authStub.admin.user.id, checksum: checksum2 },
        { assetId: asset1.id, ownerId: authStub.admin.user.id, checksum: checksum3 },
      ]);
    });

    it('should use first kept asset as tombstone target when multiple are kept', async () => {
      const asset1 = AssetFactory.create();
      const asset2 = AssetFactory.create();
      const asset3 = AssetFactory.create();
      const checksum = Buffer.from('eeff', 'hex');
      mocks.access.duplicate.checkOwnerAccess.mockResolvedValue(new Set(['group-1']));
      mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set([asset3.id]));
      mocks.duplicateRepository.get.mockResolvedValue({
        duplicateId: 'group-1',
        assets: [asset1 as unknown as MapAsset, asset2 as unknown as MapAsset, asset3 as unknown as MapAsset],
      });
      mocks.asset.getChecksumsByIds.mockResolvedValue([{ id: asset3.id, checksum }]);

      const result = await sut.resolve(authStub.admin, {
        groups: [{ duplicateId: 'group-1', keepAssetIds: [asset1.id, asset2.id], trashAssetIds: [asset3.id] }],
      });

      expect(result[0].success).toBe(true);
      expect(mocks.duplicateRepository.createChecksumTombstones).toHaveBeenCalledWith([
        { assetId: asset1.id, ownerId: authStub.admin.user.id, checksum },
      ]);
    });

    it('should not create tombstones when all assets are trashed', async () => {
      const asset1 = AssetFactory.create();
      const asset2 = AssetFactory.create();
      mocks.access.duplicate.checkOwnerAccess.mockResolvedValue(new Set(['group-1']));
      mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set([asset1.id, asset2.id]));
      mocks.duplicateRepository.get.mockResolvedValue({
        duplicateId: 'group-1',
        assets: [asset1 as unknown as MapAsset, asset2 as unknown as MapAsset],
      });

      const result = await sut.resolve(authStub.admin, {
        groups: [{ duplicateId: 'group-1', keepAssetIds: [], trashAssetIds: [asset1.id, asset2.id] }],
      });

      expect(result[0].success).toBe(true);
      expect(mocks.asset.getChecksumsByIds).not.toHaveBeenCalled();
      expect(mocks.duplicateRepository.createChecksumTombstones).not.toHaveBeenCalled();
    });

    it('should succeed even if tombstone insert fails', async () => {
      const asset1 = AssetFactory.create();
      const asset2 = AssetFactory.create();
      mocks.access.duplicate.checkOwnerAccess.mockResolvedValue(new Set(['group-1']));
      mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set([asset2.id]));
      mocks.duplicateRepository.get.mockResolvedValue({
        duplicateId: 'group-1',
        assets: [asset1 as unknown as MapAsset, asset2 as unknown as MapAsset],
      });
      mocks.asset.getChecksumsByIds.mockResolvedValue([{ id: asset2.id, checksum: Buffer.from('aa', 'hex') }]);
      mocks.duplicateRepository.createChecksumTombstones.mockRejectedValue(new Error('DB error'));

      const result = await sut.resolve(authStub.admin, {
        groups: [{ duplicateId: 'group-1', keepAssetIds: [asset1.id], trashAssetIds: [asset2.id] }],
      });

      expect(result[0].success).toBe(true);
    });

    it('should not create tombstones when idsToTrash is empty after non-member filtering', async () => {
      const asset1 = AssetFactory.create();
      mocks.access.duplicate.checkOwnerAccess.mockResolvedValue(new Set(['group-1']));
      mocks.duplicateRepository.get.mockResolvedValue({
        duplicateId: 'group-1',
        assets: [asset1 as unknown as MapAsset],
      });

      const result = await sut.resolve(authStub.admin, {
        groups: [{ duplicateId: 'group-1', keepAssetIds: [asset1.id], trashAssetIds: ['non-member'] }],
      });

      expect(result[0].success).toBe(true);
      expect(mocks.asset.getChecksumsByIds).not.toHaveBeenCalled();
      expect(mocks.duplicateRepository.createChecksumTombstones).not.toHaveBeenCalled();
    });
  });

  describe('handleSearchDuplicates', () => {
    beforeEach(() => {
      mocks.systemMetadata.get.mockResolvedValue({
        machineLearning: {
          enabled: true,
          duplicateDetection: {
            enabled: true,
          },
        },
      });
    });

    it('should skip if machine learning is disabled', async () => {
      mocks.systemMetadata.get.mockResolvedValue({
        machineLearning: {
          enabled: false,
          duplicateDetection: {
            enabled: true,
          },
        },
      });
      const result = await sut.handleSearchDuplicates({ id: newUuid() });

      expect(result).toBe(JobStatus.Skipped);
      expect(mocks.assetJob.getForSearchDuplicatesJob).not.toHaveBeenCalled();
    });

    it('should skip if duplicate detection is disabled', async () => {
      mocks.systemMetadata.get.mockResolvedValue({
        machineLearning: {
          enabled: true,
          duplicateDetection: {
            enabled: false,
          },
        },
      });
      const result = await sut.handleSearchDuplicates({ id: newUuid() });

      expect(result).toBe(JobStatus.Skipped);
      expect(mocks.assetJob.getForSearchDuplicatesJob).not.toHaveBeenCalled();
    });

    it('should fail if asset is not found', async () => {
      mocks.assetJob.getForSearchDuplicatesJob.mockResolvedValue(void 0);

      const asset = AssetFactory.create();
      const result = await sut.handleSearchDuplicates({ id: asset.id });

      expect(result).toBe(JobStatus.Failed);
      expect(mocks.logger.error).toHaveBeenCalledWith(`Asset ${asset.id} not found`);
    });

    it('should skip if asset is part of stack', async () => {
      const asset = AssetFactory.from().stack().build();
      mocks.assetJob.getForSearchDuplicatesJob.mockResolvedValue({ ...hasEmbedding, stackId: asset.stackId });

      const result = await sut.handleSearchDuplicates({ id: asset.id });

      expect(result).toBe(JobStatus.Skipped);
      expect(mocks.logger.debug).toHaveBeenCalledWith(`Asset ${asset.id} is part of a stack, skipping`);
    });

    it('should skip if asset is not visible', async () => {
      const asset = AssetFactory.create({ visibility: AssetVisibility.Hidden });
      mocks.assetJob.getForSearchDuplicatesJob.mockResolvedValue({ ...hasEmbedding, ...asset });

      const result = await sut.handleSearchDuplicates({ id: asset.id });

      expect(result).toBe(JobStatus.Skipped);
      expect(mocks.logger.debug).toHaveBeenCalledWith(`Asset ${asset.id} is not visible, skipping`);
    });

    it('should skip if asset is locked', async () => {
      const asset = AssetFactory.create({ visibility: AssetVisibility.Locked });
      mocks.assetJob.getForSearchDuplicatesJob.mockResolvedValue({ ...hasEmbedding, ...asset });

      const result = await sut.handleSearchDuplicates({ id: asset.id });

      expect(result).toBe(JobStatus.Skipped);
      expect(mocks.logger.debug).toHaveBeenCalledWith(`Asset ${asset.id} is locked, skipping`);
    });

    it('should fail if asset is missing embedding', async () => {
      mocks.assetJob.getForSearchDuplicatesJob.mockResolvedValue({ ...hasEmbedding, embedding: null });

      const asset = AssetFactory.create();
      const result = await sut.handleSearchDuplicates({ id: asset.id });

      expect(result).toBe(JobStatus.Failed);
      expect(mocks.logger.debug).toHaveBeenCalledWith(`Asset ${asset.id} is missing embedding`);
    });

    it('should search for duplicates and update asset with duplicateId', async () => {
      mocks.assetJob.getForSearchDuplicatesJob.mockResolvedValue(hasEmbedding);
      const asset = AssetFactory.create();
      mocks.duplicateRepository.search.mockResolvedValue([{ assetId: asset.id, distance: 0.01, duplicateId: null }]);
      mocks.duplicateRepository.merge.mockResolvedValue();
      const expectedAssetIds = [asset.id, hasEmbedding.id];

      const result = await sut.handleSearchDuplicates({ id: hasEmbedding.id });

      expect(result).toBe(JobStatus.Success);
      expect(mocks.duplicateRepository.search).toHaveBeenCalledWith({
        assetId: hasEmbedding.id,
        embedding: hasEmbedding.embedding,
        maxDistance: 0.01,
        type: hasEmbedding.type,
        userIds: [hasEmbedding.ownerId],
      });
      expect(mocks.duplicateRepository.merge).toHaveBeenCalledWith({
        assetIds: expectedAssetIds,
        targetId: expect.any(String),
        sourceIds: [],
      });
      expect(mocks.asset.upsertJobStatus).toHaveBeenCalledWith(
        ...expectedAssetIds.map((assetId) => ({ assetId, duplicatesDetectedAt: expect.any(Date) })),
      );
    });

    it('should use existing duplicate ID among matched duplicates', async () => {
      const duplicateId = hasDupe.duplicateId;
      mocks.assetJob.getForSearchDuplicatesJob.mockResolvedValue(hasEmbedding);
      mocks.duplicateRepository.search.mockResolvedValue([{ assetId: hasDupe.id, distance: 0.01, duplicateId }]);
      mocks.duplicateRepository.merge.mockResolvedValue();
      const expectedAssetIds = [hasEmbedding.id];

      const result = await sut.handleSearchDuplicates({ id: hasEmbedding.id });

      expect(result).toBe(JobStatus.Success);
      expect(mocks.duplicateRepository.search).toHaveBeenCalledWith({
        assetId: hasEmbedding.id,
        embedding: hasEmbedding.embedding,
        maxDistance: 0.01,
        type: hasEmbedding.type,
        userIds: [hasEmbedding.ownerId],
      });
      expect(mocks.duplicateRepository.merge).toHaveBeenCalledWith({
        assetIds: expectedAssetIds,
        targetId: duplicateId,
        sourceIds: [],
      });
      expect(mocks.asset.upsertJobStatus).toHaveBeenCalledWith(
        ...expectedAssetIds.map((assetId) => ({ assetId, duplicatesDetectedAt: expect.any(Date) })),
      );
    });

    it('should remove duplicateId if no duplicates found and asset has duplicateId', async () => {
      mocks.assetJob.getForSearchDuplicatesJob.mockResolvedValue(hasDupe);
      mocks.duplicateRepository.search.mockResolvedValue([]);

      const result = await sut.handleSearchDuplicates({ id: hasDupe.id });

      expect(result).toBe(JobStatus.Success);
      expect(mocks.asset.update).toHaveBeenCalledWith({ id: hasDupe.id, duplicateId: null });
      expect(mocks.asset.upsertJobStatus).toHaveBeenCalledWith({
        assetId: hasDupe.id,
        duplicatesDetectedAt: expect.any(Date),
      });
    });

    it('should not remove duplicateId if no duplicates found and asset has no duplicateId', async () => {
      mocks.assetJob.getForSearchDuplicatesJob.mockResolvedValue(hasEmbedding);
      mocks.duplicateRepository.search.mockResolvedValue([]);

      const result = await sut.handleSearchDuplicates({ id: hasEmbedding.id });

      expect(result).toBe(JobStatus.Success);
      expect(mocks.asset.update).not.toHaveBeenCalled();
      expect(mocks.asset.upsertJobStatus).toHaveBeenCalledWith({
        assetId: hasEmbedding.id,
        duplicatesDetectedAt: expect.any(Date),
      });
    });

    it('should use asset duplicateId as target when asset already has one', async () => {
      const existingDuplicateId = 'existing-duplicate-id';
      const assetWithDupe = { ...hasEmbedding, duplicateId: existingDuplicateId };
      mocks.assetJob.getForSearchDuplicatesJob.mockResolvedValue(assetWithDupe);
      mocks.duplicateRepository.search.mockResolvedValue([
        { assetId: 'other-asset', distance: 0.01, duplicateId: null },
      ]);
      mocks.duplicateRepository.merge.mockResolvedValue();

      const result = await sut.handleSearchDuplicates({ id: assetWithDupe.id });

      expect(result).toBe(JobStatus.Success);
      expect(mocks.duplicateRepository.merge).toHaveBeenCalledWith({
        assetIds: ['other-asset', assetWithDupe.id],
        targetId: existingDuplicateId,
        sourceIds: [],
      });
    });

    it('should merge multiple duplicate IDs into one target', async () => {
      mocks.assetJob.getForSearchDuplicatesJob.mockResolvedValue(hasEmbedding);
      mocks.duplicateRepository.search.mockResolvedValue([
        { assetId: 'dup-1', distance: 0.01, duplicateId: 'dup-id-1' },
        { assetId: 'dup-2', distance: 0.01, duplicateId: 'dup-id-2' },
        { assetId: 'dup-3', distance: 0.01, duplicateId: 'dup-id-1' },
      ]);
      mocks.duplicateRepository.merge.mockResolvedValue();

      const result = await sut.handleSearchDuplicates({ id: hasEmbedding.id });

      expect(result).toBe(JobStatus.Success);
      // Should use first duplicate ID (dup-id-1) as target, dup-id-2 as source
      expect(mocks.duplicateRepository.merge).toHaveBeenCalledWith({
        assetIds: expect.arrayContaining(['dup-2', hasEmbedding.id]),
        targetId: 'dup-id-1',
        sourceIds: ['dup-id-2'],
      });
    });
  });
});
