import { takeoutMetadataManager } from '#lib/gallery/managers/takeout-metadata-manager.svelte.ts';
import { authManager } from '#lib/managers/auth-manager.svelte.ts';
import { uploadRequest } from '#lib/utils.ts';
import { hashFile } from '#lib/utils/file-uploader.ts';
import type { TakeoutMediaItem } from '#lib/utils/google-takeout-parser.ts';
import { uploadTakeoutItem } from '#lib/utils/google-takeout-uploader.ts';
import { factory } from '#test/unit/factories.ts';
import { test as base } from '#test/unit/fixtures.ts';
import type { Mock } from '#test/unit/mocks/mock.ts';
import { AssetMediaStatus, AssetRejectReason, AssetUploadAction, getBaseUrl, setBaseUrl } from '@immich/sdk';

// These two transports are outside the fetch-based API fixture: uploads use XHR and hashing
// uses a worker. Keep the real SDK, authentication manager and metadata requests in every test.
vi.mock('#lib/utils.ts', { spy: true });
vi.mock('#lib/utils/file-uploader.ts', { spy: true });

const options = { importFavorites: true, importArchived: true, importDescriptions: true, skipDuplicates: true };
const item = (): TakeoutMediaItem => ({
  path: 'Takeout/Google Photos/Trip/photo.jpg',
  name: 'photo.jpg',
  size: 5,
  lastModified: 1_609_459_200_000,
  getFile: () => Promise.resolve(new File(['photo'], 'photo.jpg')),
  metadata: {
    title: 'photo.jpg',
    description: 'Trip description',
    dateTaken: new Date('2021-01-01T00:00:00Z'),
    latitude: 48.8566,
    longitude: 2.3522,
    isArchived: true,
    isFavorite: true,
  },
});

const test = base.extend<{ assetId: string; markerKey: string }>({
  assetId: async ({ data }, use) => {
    const asset = factory.asset({ ownerId: data.user.id });
    data.addAssets(asset);
    authManager.setUser(data.user);
    vi.mocked(hashFile).mockResolvedValue('checksum');
    vi.mocked(uploadRequest).mockResolvedValue({
      data: { id: asset.id, status: AssetMediaStatus.Created },
      status: 201,
    });
    const originalBaseUrl = getBaseUrl();
    await use(asset.id);
    setBaseUrl(originalBaseUrl);
    vi.restoreAllMocks();
  },
  markerKey: async ({ assetId }, use) => {
    const key = `gallery:takeout-metadata:${JSON.stringify([getBaseUrl(), authManager.user.id, assetId])}`;
    await use(key);
    takeoutMetadataManager.setPending(key, false);
  },
});

function duplicatePreflight(api: Mock['api'], assetId: string) {
  api.on({
    checkBulkUpload: () => ({
      json: {
        results: [{ id: 'photo.jpg', assetId, action: AssetUploadAction.Reject, reason: AssetRejectReason.Duplicate }],
      },
    }),
  });
}

async function failMetadata(api: Mock['api'], assetId: string, markerKey: string) {
  api.on({ updateAsset: () => ({ status: 503, json: { message: 'Metadata unavailable' } }) });
  expect(await uploadTakeoutItem(item(), options)).toMatchObject({ assetId, status: 'error' });
  expect(api.updateAsset).toHaveBeenCalledWith({ params: { id: assetId }, body: expect.any(Object) });
  expect(localStorage.getItem(markerKey)).toBe('pending');
}

function allowMetadata(api: Mock['api']) {
  api.on({ updateAsset: () => ({ json: factory.asset() }) });
}

for (const path of ['preflight', 'upload']) {
  test(`retries unfinished metadata through the ${path} duplicate path`, async ({ api, assetId, markerKey }) => {
    await failMetadata(api, assetId, markerKey);
    allowMetadata(api);
    if (path === 'preflight') {
      duplicatePreflight(api, assetId);
    } else {
      vi.mocked(uploadRequest).mockResolvedValue({
        data: { id: assetId, status: AssetMediaStatus.Duplicate },
        status: 200,
      });
    }
    expect(await uploadTakeoutItem(item(), options)).toEqual({ assetId, status: 'duplicate' });
    expect(api.updateAsset).toHaveBeenCalledWith({
      params: { id: assetId },
      body: {
        latitude: 48.8566,
        longitude: 2.3522,
        description: 'Trip description',
        dateTimeOriginal: '2021-01-01T00:00:00.000Z',
        visibility: 'archive',
      },
    });
    expect(api.updateAsset.calls).toHaveLength(2);
    expect(uploadRequest).toHaveBeenCalledTimes(path === 'preflight' ? 1 : 2);
    expect(localStorage.getItem(markerKey)).toBeNull();
  });

  test(`preserves ordinary existing duplicates through the ${path} path`, async ({ api, assetId, markerKey }) => {
    if (path === 'preflight') {
      duplicatePreflight(api, assetId);
    } else {
      vi.mocked(uploadRequest).mockResolvedValue({
        data: { id: assetId, status: AssetMediaStatus.Duplicate },
        status: 200,
      });
    }
    expect(await uploadTakeoutItem(item(), options)).toMatchObject({ status: 'duplicate' });
    expect(api.updateAsset).not.toHaveBeenCalled();
    expect(localStorage.getItem(markerKey)).toBeNull();
  });
}

test('keeps repeated metadata failures retryable without uploading again', async ({ api, assetId, markerKey }) => {
  await failMetadata(api, assetId, markerKey);
  duplicatePreflight(api, assetId);
  expect(await uploadTakeoutItem(item(), options)).toMatchObject({ assetId, status: 'error' });
  expect(localStorage.getItem(markerKey)).toBe('pending');
  expect(uploadRequest).toHaveBeenCalledOnce();
  allowMetadata(api);
  expect(await uploadTakeoutItem(item(), options)).toMatchObject({ status: 'duplicate' });
  expect(api.updateAsset).toHaveBeenCalledWith({ params: { id: assetId }, body: expect.any(Object) });
  expect(api.updateAsset.calls).toHaveLength(3);
});

test('does not reapply metadata to completed imports', async ({ api, assetId, markerKey }) => {
  expect(await uploadTakeoutItem(item(), options)).toMatchObject({ status: 'imported' });
  duplicatePreflight(api, assetId);
  await uploadTakeoutItem(item(), options);
  expect(api.updateAsset).toHaveBeenCalledWith({ params: { id: assetId }, body: expect.any(Object) });
  expect(api.updateAsset.calls).toHaveLength(1);
  expect(localStorage.getItem(markerKey)).toBeNull();
});

test('honors current import options when retrying metadata', async ({ api, assetId, markerKey }) => {
  await failMetadata(api, assetId, markerKey);
  duplicatePreflight(api, assetId);
  allowMetadata(api);
  await uploadTakeoutItem(item(), { ...options, importDescriptions: false, importArchived: false });
  expect(api.updateAsset).toHaveBeenCalledWith({
    params: { id: assetId },
    body: {
      latitude: 48.8566,
      longitude: 2.3522,
      dateTimeOriginal: '2021-01-01T00:00:00.000Z',
    },
  });
});

test('recovers a persisted marker from a previous page', async ({ api, assetId, markerKey }) => {
  localStorage.setItem(markerKey, 'pending');
  duplicatePreflight(api, assetId);
  expect(await uploadTakeoutItem(item(), options)).toMatchObject({ status: 'duplicate' });
  expect(api.updateAsset).toHaveBeenCalledWith({ params: { id: assetId }, body: expect.any(Object) });
  expect(localStorage.getItem(markerKey)).toBeNull();
  expect(uploadRequest).not.toHaveBeenCalled();
});

test('retains unfinished work when a retry has no sidecar', async ({ api, assetId, markerKey }) => {
  await failMetadata(api, assetId, markerKey);
  duplicatePreflight(api, assetId);
  await uploadTakeoutItem({ ...item(), metadata: undefined }, options);
  expect(api.updateAsset.calls).toHaveLength(1);
  expect(localStorage.getItem(markerKey)).toBe('pending');
  allowMetadata(api);
  await uploadTakeoutItem(item(), options);
  expect(api.updateAsset).toHaveBeenCalledWith({ params: { id: assetId }, body: expect.any(Object) });
  expect(api.updateAsset.calls).toHaveLength(2);
  expect(localStorage.getItem(markerKey)).toBeNull();
});

for (const change of ['user', 'server']) {
  test(`isolates pending metadata by ${change}`, async ({ api, assetId, markerKey }) => {
    await failMetadata(api, assetId, markerKey);
    if (change === 'user') {
      authManager.setUser(factory.user());
    } else {
      setBaseUrl('https://other-server.example/api');
    }
    duplicatePreflight(api, assetId);
    await uploadTakeoutItem(item(), options);
    expect(api.updateAsset.calls).toHaveLength(1);
    expect(localStorage.getItem(markerKey)).toBe('pending');
  });
}

test('keeps same-page retries working when browser storage is blocked', async ({ api, assetId, markerKey }) => {
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('Storage blocked');
  });
  api.on({ updateAsset: () => ({ status: 503, json: { message: 'Metadata unavailable' } }) });
  expect(await uploadTakeoutItem(item(), options)).toMatchObject({ status: 'error' });
  duplicatePreflight(api, assetId);
  allowMetadata(api);
  expect(await uploadTakeoutItem(item(), options)).toMatchObject({ status: 'duplicate' });
  expect(api.updateAsset).toHaveBeenCalledWith({ params: { id: assetId }, body: expect.any(Object) });
  expect(api.updateAsset.calls).toHaveLength(2);
  expect(localStorage.getItem(markerKey)).toBeNull();
});

test('does not record metadata work before an upload succeeds', async ({ api, markerKey }) => {
  vi.mocked(uploadRequest).mockRejectedValueOnce(new Error('Upload failed'));
  expect(await uploadTakeoutItem(item(), options)).toEqual({ assetId: '', status: 'error', error: 'Upload failed' });
  expect(localStorage.getItem(markerKey)).toBeNull();
  expect(api.updateAsset).not.toHaveBeenCalled();
});
