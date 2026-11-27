import { TagService } from 'src/services/tag.service.js';
import { authStub } from 'test/fixtures/auth.stub.js';
import { ServiceMocks, newTestService } from 'test/utils.js';

// Exercised through upstream's TagService, so the one-spread hook in bulkTagAssets is covered too
// (specs/2026-11-27-bulk-tag-feedback-design.md).
describe('galleryTagBulkFeedback through TagService.bulkTagAssets', () => {
  let sut: TagService;
  let mocks: ServiceMocks;

  beforeEach(() => {
    ({ sut, mocks } = newTestService(TagService));
    mocks.asset.getForUpdateTags.mockResolvedValue({ tags: [{ value: 'tag-1' }] });
  });

  it('reports every requested asset as tagged when every tag and asset is permitted', async () => {
    mocks.access.tag.checkOwnerAccess.mockResolvedValue(new Set(['tag-1']));
    mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set(['asset-1', 'asset-2']));
    mocks.tag.upsertAssetIds.mockResolvedValue([
      { tagId: 'tag-1', assetId: 'asset-1' },
      { tagId: 'tag-1', assetId: 'asset-2' },
    ]);

    await expect(
      sut.bulkTagAssets(authStub.admin, { tagIds: ['tag-1'], assetIds: ['asset-1', 'asset-2'] }),
    ).resolves.toEqual({
      count: 2,
      taggedAssetIds: ['asset-1', 'asset-2'],
      skippedAssetIds: [],
      skippedTagIds: [],
    });
  });

  it('counts an asset that already carried the tag as tagged, without a new link or event', async () => {
    mocks.access.tag.checkOwnerAccess.mockResolvedValue(new Set(['tag-1']));
    mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set(['asset-1', 'asset-2']));
    mocks.tag.upsertAssetIds.mockResolvedValue([{ tagId: 'tag-1', assetId: 'asset-2' }]);

    await expect(
      sut.bulkTagAssets(authStub.admin, { tagIds: ['tag-1'], assetIds: ['asset-1', 'asset-2'] }),
    ).resolves.toMatchObject({ count: 1, taggedAssetIds: ['asset-1', 'asset-2'], skippedAssetIds: [] });
    expect(mocks.event.emit).toHaveBeenCalledTimes(1);
    expect(mocks.event.emit).toHaveBeenCalledWith('AssetTag', { assetId: 'asset-2', userId: authStub.admin.user.id });
  });

  it('reports a tag the caller may not use as skipped instead of a silent success', async () => {
    mocks.access.tag.checkOwnerAccess.mockResolvedValue(new Set());
    mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set(['asset-1']));
    mocks.tag.upsertAssetIds.mockResolvedValue([]);

    await expect(
      sut.bulkTagAssets(authStub.admin, { tagIds: ['foreign-tag'], assetIds: ['asset-1'] }),
    ).resolves.toEqual({ count: 0, taggedAssetIds: [], skippedAssetIds: [], skippedTagIds: ['foreign-tag'] });
    expect(mocks.tag.upsertAssetIds).toHaveBeenCalledWith([]);
    expect(mocks.event.emit).not.toHaveBeenCalled();
  });

  it('reports the permitted assets as tagged with the permitted tags when another requested tag was skipped', async () => {
    mocks.access.tag.checkOwnerAccess.mockResolvedValue(new Set(['tag-1', 'tag-2']));
    mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set(['asset-1', 'asset-2']));
    mocks.tag.upsertAssetIds.mockResolvedValue([
      { tagId: 'tag-1', assetId: 'asset-1' },
      { tagId: 'tag-1', assetId: 'asset-2' },
      { tagId: 'tag-2', assetId: 'asset-1' },
      { tagId: 'tag-2', assetId: 'asset-2' },
    ]);

    await expect(
      sut.bulkTagAssets(authStub.admin, {
        tagIds: ['tag-1', 'tag-2', 'foreign-tag'],
        assetIds: ['asset-1', 'asset-2'],
      }),
    ).resolves.toEqual({
      count: 4,
      taggedAssetIds: ['asset-1', 'asset-2'],
      skippedAssetIds: [],
      skippedTagIds: ['foreign-tag'],
    });
    expect(mocks.tag.upsertAssetIds).toHaveBeenCalledWith([
      { tagId: 'tag-1', assetId: 'asset-1' },
      { tagId: 'tag-1', assetId: 'asset-2' },
      { tagId: 'tag-2', assetId: 'asset-1' },
      { tagId: 'tag-2', assetId: 'asset-2' },
    ]);
  });

  it('reports assets the caller may not edit as skipped, and writes nothing for them', async () => {
    mocks.access.tag.checkOwnerAccess.mockResolvedValue(new Set(['tag-1']));
    mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set(['asset-1']));
    mocks.access.spaceAsset.checkSpaceEditAccess.mockResolvedValue(new Set());
    mocks.tag.upsertAssetIds.mockResolvedValue([{ tagId: 'tag-1', assetId: 'asset-1' }]);

    await expect(
      sut.bulkTagAssets(authStub.admin, { tagIds: ['tag-1'], assetIds: ['asset-1', 'asset-2'] }),
    ).resolves.toEqual({
      count: 1,
      taggedAssetIds: ['asset-1'],
      skippedAssetIds: ['asset-2'],
      skippedTagIds: [],
    });
    expect(mocks.tag.upsertAssetIds).toHaveBeenCalledWith([{ tagId: 'tag-1', assetId: 'asset-1' }]);
  });

  it('reports each requested id once when the request repeats it', async () => {
    mocks.access.tag.checkOwnerAccess.mockResolvedValue(new Set());
    mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set());
    mocks.access.spaceAsset.checkSpaceEditAccess.mockResolvedValue(new Set());
    mocks.tag.upsertAssetIds.mockResolvedValue([]);

    await expect(sut.bulkTagAssets(authStub.admin, { tagIds: ['t', 't'], assetIds: ['a', 'a'] })).resolves.toEqual({
      count: 0,
      taggedAssetIds: [],
      skippedAssetIds: ['a'],
      skippedTagIds: ['t'],
    });
  });

  it('keeps the exif update and the AssetTag event per newly linked asset, in that order', async () => {
    mocks.access.tag.checkOwnerAccess.mockResolvedValue(new Set(['tag-1']));
    mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set(['asset-1', 'asset-2']));
    mocks.tag.upsertAssetIds.mockResolvedValue([
      { tagId: 'tag-1', assetId: 'asset-1' },
      { tagId: 'tag-1', assetId: 'asset-2' },
    ]);
    const order: string[] = [];
    mocks.asset.upsertExif.mockImplementation(({ exif }) => {
      order.push(`exif:${exif.assetId}`);
      return Promise.resolve();
    });
    // `emit` is generic over every event, so a typed implementation for one event does not fit its signature.
    mocks.event.emit.mockImplementation(((name: string, payload: { assetId: string }) => {
      order.push(`${name}:${payload.assetId}`);
      return Promise.resolve();
    }) as never);

    await sut.bulkTagAssets(authStub.admin, { tagIds: ['tag-1'], assetIds: ['asset-1', 'asset-2'] });

    expect(order).toEqual(['exif:asset-1', 'AssetTag:asset-1', 'exif:asset-2', 'AssetTag:asset-2']);
    expect(mocks.event.emit).toHaveBeenNthCalledWith(1, 'AssetTag', {
      assetId: 'asset-1',
      userId: authStub.admin.user.id,
    });
  });
});
