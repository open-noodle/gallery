import { uploadRequest } from '#lib/utils.ts';
import { hashFile } from '#lib/utils/file-uploader.ts';
import type { TakeoutMediaItem } from '#lib/utils/google-takeout-parser.ts';
import { uploadTakeoutItem } from '#lib/utils/google-takeout-uploader.ts';
import { factory } from '#test/common/factories.ts';
import { AssetMediaStatus, AssetRejectReason, AssetUploadAction, checkBulkUpload, updateAsset } from '@immich/sdk';

const scope = vi.hoisted(() => ({ userId: 'takeout-retry-test-user', baseUrl: '/takeout-retry-tests/api' }));
vi.mock('#lib/managers/auth-manager.svelte.ts', () => ({
  authManager: {
    get user() {
      return { id: scope.userId };
    },
  },
}));
vi.mock('@immich/sdk', async (original) => ({
  ...(await original<typeof import('@immich/sdk')>()),
  getBaseUrl: () => scope.baseUrl,
  checkBulkUpload: vi.fn(),
  updateAsset: vi.fn(),
}));
vi.mock('#lib/utils.ts', () => ({ uploadRequest: vi.fn() }));
vi.mock('#lib/utils/file-uploader.ts', () => ({ hashFile: vi.fn() }));
vi.mock('#lib/gallery/album/album-add.ts', () => ({ createAlbum: vi.fn() }));

const options = { importFavorites: true, importArchived: true, importDescriptions: true, skipDuplicates: true };
const markerKey = (assetId = 'retry-asset') =>
  `gallery:takeout-metadata:${JSON.stringify([scope.baseUrl, scope.userId, assetId])}`;
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

function cleanupMarkers() {
  for (const key of Object.keys(localStorage)) {
    if (key.startsWith('gallery:takeout-metadata:') && key.includes('/takeout-retry-tests/')) {
      localStorage.removeItem(key);
    }
  }
}

function duplicatePreflight() {
  vi.mocked(checkBulkUpload).mockResolvedValue({
    results: [
      {
        id: 'photo.jpg',
        assetId: 'retry-asset',
        action: AssetUploadAction.Reject,
        reason: AssetRejectReason.Duplicate,
      },
    ],
  });
}

async function failMetadata() {
  vi.mocked(updateAsset).mockRejectedValueOnce(new Error('Metadata unavailable'));
  const result = await uploadTakeoutItem(item(), options);
  expect(result).toEqual({ assetId: 'retry-asset', status: 'error', error: 'Metadata unavailable' });
  expect(localStorage.getItem(markerKey())).toBe('pending');
}

beforeEach(() => {
  scope.userId = 'takeout-retry-test-user';
  scope.baseUrl = '/takeout-retry-tests/api';
  cleanupMarkers();
  vi.mocked(hashFile).mockResolvedValue('checksum');
  vi.mocked(checkBulkUpload).mockResolvedValue({
    results: [{ id: 'photo.jpg', action: AssetUploadAction.Accept, reason: AssetRejectReason.Duplicate }],
  });
  vi.mocked(uploadRequest).mockResolvedValue({
    data: { id: 'retry-asset', status: AssetMediaStatus.Created },
    status: 201,
  });
  vi.mocked(updateAsset).mockResolvedValue(factory.asset());
});

afterEach(async () => {
  vi.restoreAllMocks();
  // Complete any failed work so the memory fallback is also clean for the next test.
  scope.userId = 'takeout-retry-test-user';
  scope.baseUrl = '/takeout-retry-tests/api';
  duplicatePreflight();
  vi.mocked(updateAsset).mockResolvedValue(factory.asset());
  await uploadTakeoutItem(item(), options);
  cleanupMarkers();
});

it.each(['preflight', 'upload'])('retries unfinished metadata through the %s duplicate path', async (path) => {
  await failMetadata();
  if (path === 'preflight') {
    duplicatePreflight();
  } else {
    vi.mocked(uploadRequest).mockResolvedValue({
      data: { id: 'retry-asset', status: AssetMediaStatus.Duplicate },
      status: 200,
    });
  }
  const result = await uploadTakeoutItem(item(), options);
  expect(result).toEqual({ assetId: 'retry-asset', status: 'duplicate' });
  expect(updateAsset).toHaveBeenCalledTimes(2);
  expect(updateAsset).toHaveBeenLastCalledWith({
    id: 'retry-asset',
    updateAssetDto: {
      latitude: 48.8566,
      longitude: 2.3522,
      description: 'Trip description',
      dateTimeOriginal: '2021-01-01T00:00:00.000Z',
      visibility: 'archive',
    },
  });
  expect(uploadRequest).toHaveBeenCalledTimes(path === 'preflight' ? 1 : 2);
  expect(localStorage.getItem(markerKey())).toBeNull();
});

it('keeps repeated metadata failures retryable without uploading again', async () => {
  await failMetadata();
  duplicatePreflight();
  vi.mocked(updateAsset).mockRejectedValueOnce(new Error('Still unavailable'));
  expect(await uploadTakeoutItem(item(), options)).toMatchObject({ assetId: 'retry-asset', status: 'error' });
  expect(localStorage.getItem(markerKey())).toBe('pending');
  expect(uploadRequest).toHaveBeenCalledOnce();
  expect(await uploadTakeoutItem(item(), options)).toMatchObject({ status: 'duplicate' });
  expect(updateAsset).toHaveBeenCalledTimes(3);
});

it.each(['preflight', 'upload'])('preserves ordinary existing duplicates through the %s path', async (path) => {
  if (path === 'preflight') {
    duplicatePreflight();
  } else {
    vi.mocked(uploadRequest).mockResolvedValue({
      data: { id: 'retry-asset', status: AssetMediaStatus.Duplicate },
      status: 200,
    });
  }
  expect(await uploadTakeoutItem(item(), options)).toMatchObject({ status: 'duplicate' });
  expect(updateAsset).not.toHaveBeenCalled();
});

it('does not reapply metadata to completed imports', async () => {
  expect(await uploadTakeoutItem(item(), options)).toMatchObject({ status: 'imported' });
  duplicatePreflight();
  await uploadTakeoutItem(item(), options);
  expect(updateAsset).toHaveBeenCalledOnce();
  expect(localStorage.getItem(markerKey())).toBeNull();
});

it('honors current import options when retrying metadata', async () => {
  await failMetadata();
  duplicatePreflight();
  await uploadTakeoutItem(item(), { ...options, importDescriptions: false, importArchived: false });
  expect(updateAsset).toHaveBeenLastCalledWith({
    id: 'retry-asset',
    updateAssetDto: { latitude: 48.8566, longitude: 2.3522, dateTimeOriginal: '2021-01-01T00:00:00.000Z' },
  });
});

it('recovers a persisted marker from a previous page', async () => {
  localStorage.setItem(markerKey('persisted-asset'), 'pending');
  vi.mocked(checkBulkUpload).mockResolvedValue({
    results: [
      {
        id: 'photo.jpg',
        assetId: 'persisted-asset',
        action: AssetUploadAction.Reject,
        reason: AssetRejectReason.Duplicate,
      },
    ],
  });
  await uploadTakeoutItem(item(), options);
  expect(updateAsset).toHaveBeenCalledWith(expect.objectContaining({ id: 'persisted-asset' }));
  expect(localStorage.getItem(markerKey('persisted-asset'))).toBeNull();
  expect(uploadRequest).not.toHaveBeenCalled();
});

it('retains unfinished work when a retry has no sidecar', async () => {
  await failMetadata();
  duplicatePreflight();
  await uploadTakeoutItem({ ...item(), metadata: undefined }, options);
  expect(updateAsset).toHaveBeenCalledOnce();
  expect(localStorage.getItem(markerKey())).toBe('pending');
  await uploadTakeoutItem(item(), options);
  expect(updateAsset).toHaveBeenCalledTimes(2);
  expect(localStorage.getItem(markerKey())).toBeNull();
});

it.each(['user', 'server'])('isolates pending metadata by %s', async (change) => {
  await failMetadata();
  const originalKey = markerKey();
  if (change === 'user') {
    scope.userId = 'other-user';
  } else {
    scope.baseUrl = '/takeout-retry-tests/other-server/api';
  }
  duplicatePreflight();
  await uploadTakeoutItem(item(), options);
  expect(updateAsset).toHaveBeenCalledOnce();
  expect(localStorage.getItem(originalKey)).toBe('pending');
});

it('keeps same-page retries working when browser storage is blocked', async () => {
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('Storage blocked');
  });
  vi.mocked(updateAsset).mockRejectedValueOnce(new Error('Metadata unavailable'));
  expect(await uploadTakeoutItem(item(), options)).toMatchObject({ status: 'error' });
  duplicatePreflight();
  expect(await uploadTakeoutItem(item(), options)).toMatchObject({ status: 'duplicate' });
  expect(updateAsset).toHaveBeenCalledTimes(2);
});

it('does not record metadata work before an upload succeeds', async () => {
  vi.mocked(uploadRequest).mockRejectedValueOnce(new Error('Upload failed'));
  expect(await uploadTakeoutItem(item(), options)).toEqual({ assetId: '', status: 'error', error: 'Upload failed' });
  expect(localStorage.getItem(markerKey())).toBeNull();
  expect(updateAsset).not.toHaveBeenCalled();
});
