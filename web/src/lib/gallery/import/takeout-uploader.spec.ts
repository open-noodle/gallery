import { createAlbum } from '#lib/gallery/album/album-add.ts';
import { authManager } from '#lib/managers/auth-manager.svelte.ts';
import type { ImportOptions } from '#lib/managers/import-manager.svelte.ts';
import { uploadRequest } from '#lib/utils.ts';
import { hashFile } from '#lib/utils/file-uploader.ts';
import type { TakeoutMediaItem } from '#lib/utils/google-takeout-parser.ts';
import { createImportAlbums, uploadTakeoutItem } from '#lib/utils/google-takeout-uploader.ts';
import { factory } from '#test/unit/factories.ts';
import { test } from '#test/unit/fixtures.ts';
import type { Mock } from '#test/unit/mocks/mock.ts';
import { AssetRejectReason, AssetUploadAction } from '@immich/sdk';

vi.mock('#lib/utils.ts', { spy: true });
vi.mock('#lib/utils/file-uploader.ts', { spy: true });
// Album grouping is unit-tested independently of the album helper's own mutation behavior.
vi.mock('#lib/gallery/album/album-add.ts', { spy: true });

function makeItem(overrides: Partial<TakeoutMediaItem> = {}): TakeoutMediaItem {
  const file = new File(['fake-image-data'], 'IMG_001.jpg', {
    type: 'image/jpeg',
    lastModified: 1_609_459_200_000,
  });
  return {
    path: 'Takeout/Google Photos/Trip/IMG_001.jpg',
    name: 'IMG_001.jpg',
    size: file.size,
    lastModified: 1_609_459_200_000,
    getFile: vi.fn(() => Promise.resolve(file)),
    metadata: {
      title: 'IMG_001.jpg',
      description: 'A nice photo',
      dateTaken: new Date('2021-01-01T00:00:00.000Z'),
      latitude: 48.8566,
      longitude: 2.3522,
      isFavorite: true,
      isArchived: false,
    },
    albumName: 'Trip',
    ...overrides,
  };
}

function defaultOptions(): ImportOptions {
  return {
    importFavorites: true,
    importArchived: true,
    importDescriptions: true,
    skipDuplicates: true,
  };
}

const defaultMetadata = {
  latitude: 48.8566,
  longitude: 2.3522,
  description: 'A nice photo',
  dateTimeOriginal: '2021-01-01T00:00:00.000Z',
};
const expectMetadata = (api: Mock['api']) =>
  expect(api.updateAsset).toHaveBeenCalledWith({ params: { id: 'asset-1' }, body: defaultMetadata });
const uploadedForm = () => vi.mocked(uploadRequest).mock.calls[0][0].data;
const duplicatePreflight = (api: Mock['api']) =>
  api.on({
    checkBulkUpload: () => ({
      json: {
        results: [
          {
            id: 'IMG_001.jpg',
            assetId: 'existing-asset-1',
            action: AssetUploadAction.Reject,
            reason: AssetRejectReason.Duplicate,
          },
        ],
      },
    }),
  });

test.describe('uploadTakeoutItem', () => {
  test.beforeEach(({ data }) => {
    authManager.setUser(data.user);
    data.addAssets(factory.asset({ id: 'asset-1' }));
    vi.mocked(hashFile).mockResolvedValue('b2953b8e364061cea5600e64ec5049d63f08efbe');
    vi.mocked(uploadRequest).mockResolvedValue({ data: { id: 'asset-1', status: 'created' }, status: 201 });
  });

  test('builds FormData with correct fileCreatedAt from Takeout date', async ({ api }) => {
    await uploadTakeoutItem(makeItem(), defaultOptions());
    expect(uploadRequest).toHaveBeenCalledOnce();
    expect(uploadedForm().get('fileCreatedAt')).toBe('2021-01-01T00:00:00.000Z');
    expectMetadata(api);
  });

  test('does not send fields removed from AssetMediaCreateDto (deviceAssetId, deviceId)', async ({ api }) => {
    await uploadTakeoutItem(makeItem(), defaultOptions());
    const form = uploadedForm();
    expect(form.get('deviceAssetId')).toBeNull();
    expect(form.get('deviceId')).toBeNull();
    expect(form.get('fileCreatedAt')).not.toBeNull();
    expect(form.get('fileModifiedAt')).not.toBeNull();
    expect(form.get('isFavorite')).not.toBeNull();
    expect(form.get('assetData')).not.toBeNull();
    expectMetadata(api);
  });

  test('sets isFavorite when option enabled and item is favorited', async ({ api }) => {
    await uploadTakeoutItem(makeItem(), defaultOptions());
    expect(uploadedForm().get('isFavorite')).toBe('true');
    expectMetadata(api);
  });

  test('sets isFavorite to false when option disabled', async ({ api }) => {
    await uploadTakeoutItem(makeItem(), { ...defaultOptions(), importFavorites: false });
    expect(uploadedForm().get('isFavorite')).toBe('false');
    expectMetadata(api);
  });

  test('loads the file through getFile once during upload', async ({ api }) => {
    const file = new File(['lazy-bytes'], 'IMG_001.jpg', { lastModified: 1_609_459_200_000 });
    const getFile = vi.fn(() => Promise.resolve(file));
    await uploadTakeoutItem(makeItem({ getFile, size: file.size }), { ...defaultOptions(), skipDuplicates: false });
    expect(getFile).toHaveBeenCalledOnce();
    const uploaded = uploadedForm().get('assetData') as File;
    expect(uploaded.name).toBe('IMG_001.jpg');
    expect(await uploaded.text()).toBe('lazy-bytes');
    expectMetadata(api);
  });

  test('hashes lazy file bytes in the upload hash worker for duplicate checks', async ({ api }) => {
    duplicatePreflight(api);
    const file = new File(['lazy-bytes'], 'IMG_001.jpg');
    const getFile = vi.fn(() => Promise.resolve(file));
    const result = await uploadTakeoutItem(makeItem({ getFile, size: file.size }), defaultOptions());
    expect(getFile).toHaveBeenCalledOnce();
    expect(hashFile).toHaveBeenCalledWith(file);
    expect(api.checkBulkUpload).toHaveBeenCalledWith({
      body: {
        assets: [{ id: 'IMG_001.jpg', checksum: 'b2953b8e364061cea5600e64ec5049d63f08efbe' }],
      },
    });
    expect(result).toEqual({ assetId: 'existing-asset-1', status: 'duplicate' });
    expect(uploadRequest).not.toHaveBeenCalled();
    expect(api.updateAsset).not.toHaveBeenCalled();
  });

  test('uses item name and lastModified metadata instead of file metadata', async ({ api }) => {
    const file = new File(['bytes'], 'WRONG_NAME.jpg', { lastModified: 946_684_800_000 });
    await uploadTakeoutItem(
      makeItem({ name: 'IMG_FROM_ITEM.jpg', getFile: () => Promise.resolve(file), metadata: undefined }),
      { ...defaultOptions(), skipDuplicates: false },
    );
    const form = uploadedForm();
    expect(form.get('fileCreatedAt')).toBe('2021-01-01T00:00:00.000Z');
    expect((form.get('assetData') as File).name).toBe('IMG_FROM_ITEM.jpg');
    expect((form.get('assetData') as File).lastModified).toBe(1_609_459_200_000);
    expect(api.updateAsset).not.toHaveBeenCalled();
  });

  test('calls updateAsset with GPS coordinates after upload', async ({ api }) => {
    await uploadTakeoutItem(makeItem(), defaultOptions());
    expectMetadata(api);
    expect(api.updateAsset.calls[0].body).toMatchObject({ latitude: 48.8566, longitude: 2.3522 });
  });

  test('calls updateAsset with description after upload', async ({ api }) => {
    await uploadTakeoutItem(makeItem(), defaultOptions());
    expectMetadata(api);
    expect(api.updateAsset.calls[0].body).toMatchObject({ description: 'A nice photo' });
  });

  test('sets visibility to archive when item is archived and option enabled', async ({ api }) => {
    const item = makeItem();
    item.metadata!.isArchived = true;
    await uploadTakeoutItem(item, defaultOptions());
    expect(api.updateAsset).toHaveBeenCalledWith({
      params: { id: 'asset-1' },
      body: { ...defaultMetadata, visibility: 'archive' },
    });
  });

  test('skips metadata updates when options disabled', async ({ api }) => {
    await uploadTakeoutItem(makeItem(), {
      importFavorites: false,
      importArchived: false,
      importDescriptions: false,
      skipDuplicates: false,
    });
    expect(api.updateAsset).toHaveBeenCalledWith({
      params: { id: 'asset-1' },
      body: {
        latitude: 48.8566,
        longitude: 2.3522,
        dateTimeOriginal: '2021-01-01T00:00:00.000Z',
      },
    });
  });

  test('returns duplicate status when dedup check rejects', async ({ api }) => {
    duplicatePreflight(api);
    expect(await uploadTakeoutItem(makeItem(), defaultOptions())).toEqual({
      assetId: 'existing-asset-1',
      status: 'duplicate',
    });
    expect(uploadRequest).not.toHaveBeenCalled();
    expect(api.updateAsset).not.toHaveBeenCalled();
  });

  test('returns error on upload failure', async ({ api }) => {
    vi.mocked(uploadRequest).mockRejectedValueOnce(new Error('Network error'));
    expect(await uploadTakeoutItem(makeItem(), defaultOptions())).toMatchObject({
      status: 'error',
      error: 'Network error',
    });
    expect(api.updateAsset).not.toHaveBeenCalled();
  });

  test('returns an item error when lazy file loading fails', async ({ api }) => {
    const item = makeItem({ getFile: () => Promise.reject(new Error('Cannot extract zip entry')) });
    expect(await uploadTakeoutItem(item, { ...defaultOptions(), skipDuplicates: false })).toMatchObject({
      status: 'error',
      error: 'Cannot extract zip entry',
    });
    expect(uploadRequest).not.toHaveBeenCalled();
    expect(api.updateAsset).not.toHaveBeenCalled();
  });
});

test.describe('createImportAlbums', () => {
  const createAlbumMock = vi.mocked(createAlbum);
  test.beforeEach(() => {
    createAlbumMock.mockReset();
  });

  test('creates albums for selected album names', async () => {
    createAlbumMock.mockResolvedValue(factory.album({ id: 'album-1', albumName: 'Trip' }));

    const items: TakeoutMediaItem[] = [
      makeItem({ path: 'Takeout/Google Photos/Trip/IMG_001.jpg', albumName: 'Trip' }),
      makeItem({ path: 'Takeout/Google Photos/Trip/IMG_002.jpg', albumName: 'Trip' }),
    ];
    const assetIdMap = new Map([
      ['Takeout/Google Photos/Trip/IMG_001.jpg', 'asset-1'],
      ['Takeout/Google Photos/Trip/IMG_002.jpg', 'asset-2'],
    ]);

    const count = await createImportAlbums(items, assetIdMap, new Set(['Trip']));

    expect(createAlbumMock).toHaveBeenCalledWith('Trip', ['asset-1', 'asset-2']);
    expect(count).toBe(1);
  });

  test('adds correct assets to each album', async () => {
    createAlbumMock.mockResolvedValue(factory.album({ id: 'album-1' }));

    const items: TakeoutMediaItem[] = [
      makeItem({ path: 'a/Trip/IMG_001.jpg', albumName: 'Trip' }),
      makeItem({ path: 'a/Vacation/IMG_002.jpg', albumName: 'Vacation' }),
      makeItem({ path: 'a/Trip/IMG_003.jpg', albumName: 'Trip' }),
    ];
    const assetIdMap = new Map([
      ['a/Trip/IMG_001.jpg', 'asset-1'],
      ['a/Vacation/IMG_002.jpg', 'asset-2'],
      ['a/Trip/IMG_003.jpg', 'asset-3'],
    ]);

    await createImportAlbums(items, assetIdMap, new Set(['Trip', 'Vacation']));

    expect(createAlbumMock).toHaveBeenCalledWith('Trip', ['asset-1', 'asset-3']);
    expect(createAlbumMock).toHaveBeenCalledWith('Vacation', ['asset-2']);
  });

  test('skips unselected albums', async () => {
    createAlbumMock.mockResolvedValue(factory.album({ id: 'album-1' }));

    const items: TakeoutMediaItem[] = [
      makeItem({ path: 'a/Trip/IMG_001.jpg', albumName: 'Trip' }),
      makeItem({ path: 'a/Vacation/IMG_002.jpg', albumName: 'Vacation' }),
    ];
    const assetIdMap = new Map([
      ['a/Trip/IMG_001.jpg', 'asset-1'],
      ['a/Vacation/IMG_002.jpg', 'asset-2'],
    ]);

    await createImportAlbums(items, assetIdMap, new Set(['Trip']));

    expect(createAlbumMock).toHaveBeenCalledOnce();
    expect(createAlbumMock).toHaveBeenCalledWith('Trip', ['asset-1']);
  });

  test('returns count of albums created', async () => {
    createAlbumMock.mockResolvedValue(factory.album({ id: 'album-1' }));

    const items: TakeoutMediaItem[] = [
      makeItem({ path: 'a/Trip/IMG_001.jpg', albumName: 'Trip' }),
      makeItem({ path: 'a/Vacation/IMG_002.jpg', albumName: 'Vacation' }),
      makeItem({ path: 'a/Family/IMG_003.jpg', albumName: 'Family' }),
    ];
    const assetIdMap = new Map([
      ['a/Trip/IMG_001.jpg', 'asset-1'],
      ['a/Vacation/IMG_002.jpg', 'asset-2'],
      ['a/Family/IMG_003.jpg', 'asset-3'],
    ]);

    const count = await createImportAlbums(items, assetIdMap, new Set(['Trip', 'Vacation', 'Family']));
    expect(count).toBe(3);
  });

  test('handles album creation failure gracefully', async ({ logger }) => {
    createAlbumMock
      .mockResolvedValueOnce(factory.album({ id: 'album-1' }))
      .mockRejectedValueOnce(new Error('Failed'))
      .mockResolvedValueOnce(factory.album({ id: 'album-3' }));

    const items: TakeoutMediaItem[] = [
      makeItem({ path: 'a/Trip/IMG_001.jpg', albumName: 'Trip' }),
      makeItem({ path: 'a/Bad/IMG_002.jpg', albumName: 'Bad' }),
      makeItem({ path: 'a/Good/IMG_003.jpg', albumName: 'Good' }),
    ];
    const assetIdMap = new Map([
      ['a/Trip/IMG_001.jpg', 'asset-1'],
      ['a/Bad/IMG_002.jpg', 'asset-2'],
      ['a/Good/IMG_003.jpg', 'asset-3'],
    ]);

    // Should not throw
    const count = await createImportAlbums(items, assetIdMap, new Set(['Trip', 'Bad', 'Good']));
    // Only 2 succeeded
    expect(count).toBe(2);
    expect(logger.error).toHaveBeenCalledWith(/Failed to create album "Bad"/);
  });
});
