import {
  AssetMediaStatus,
  type AssetMediaResponseDto,
  type ServerConfigDto,
  type UserAdminResponseDto,
} from '@immich/sdk';
import { get } from 'svelte/store';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { authManager } from '$lib/managers/auth-manager.svelte';
import { uploadManager } from '$lib/managers/upload-manager.svelte';
import { uploadAssetsStore } from '$lib/stores/upload';
import { UploadState } from '$lib/types';
import * as utils from '$lib/utils';
import * as chunkedUpload from '$lib/utils/chunked-upload';
import { preferencesFactory } from '@test-data/factories/preferences-factory';
import { fileUploadHandler } from './file-uploader';

const DEFAULT_UPLOAD_CHUNK_SIZE = 33_554_432; // 32 MiB, matches the server default

const { serverConfigState } = vi.hoisted(() => ({
  serverConfigState: { value: { uploadChunkSize: 33_554_432 } as ServerConfigDto },
}));

vi.mock(import('$lib/managers/server-config-manager.svelte'), () => ({
  serverConfigManager: {
    get value() {
      return serverConfigState.value;
    },
    init: vi.fn(),
    loadServerConfig: vi.fn(),
  },
}));

describe('fileUploader error handling', () => {
  const mockFile = new File(['content'], 'test.jpg', { type: 'image/jpeg' });
  const mockUserObject = { id: 'user-123', email: 'test@example.com' } as UserAdminResponseDto;
  const mockError = new Error('Upload failed');
  const mockUploadResponse = { id: 'mock-id', status: AssetMediaStatus.Created } as AssetMediaResponseDto;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(uploadManager, 'getExtensions').mockReturnValue(['.jpg']);
    uploadAssetsStore.reset();
    authManager.reset();
    serverConfigState.value = { uploadChunkSize: DEFAULT_UPLOAD_CHUNK_SIZE } as ServerConfigDto;
  });

  for (const [name, mockUser] of [
    ['logged-in users', true],
    ['anonymous users', false],
  ] as const) {
    describe(`for ${name}`, () => {
      beforeEach(() => {
        if (mockUser) {
          authManager.setUser(mockUserObject);
        }
      });

      it(`should transition successful uploads to done`, async () => {
        vi.spyOn(utils, 'uploadRequest').mockResolvedValue({ status: 200, data: mockUploadResponse });

        await fileUploadHandler({ files: [mockFile] });

        const items = get(uploadAssetsStore);
        expect(items.length).toBe(1);
        expect(items[0].state).toBe(UploadState.DONE);
      });

      it('should capture errors', async () => {
        vi.spyOn(utils, 'uploadRequest').mockRejectedValue(mockError);

        await fileUploadHandler({ files: [mockFile] });

        const items = get(uploadAssetsStore);
        expect(items.length).toBe(1);
        expect(items[0].state).toBe(UploadState.ERROR);
      });
    });
  }

  it('should suppress errors on logout', async () => {
    authManager.setUser(mockUserObject);
    authManager.setPreferences(preferencesFactory.build());
    vi.spyOn(utils, 'uploadRequest').mockImplementationOnce(() => {
      authManager.reset();
      return Promise.reject(mockError);
    });

    await fileUploadHandler({ files: [mockFile] });

    const items = get(uploadAssetsStore);
    expect(items.length).toBe(1);
    expect(items[0].state).toBe(UploadState.STARTED);
  });
});

describe('fileUploader chunked-upload routing', () => {
  const mockUserObject = { id: 'user-123', email: 'test@example.com' } as UserAdminResponseDto;
  const mockUploadResponse = { id: 'mock-id', status: AssetMediaStatus.Created } as AssetMediaResponseDto;
  const mockChunkedResponse = { id: 'mock-id-chunked', status: AssetMediaStatus.Created } as AssetMediaResponseDto;

  // One byte over the default 32 MiB threshold used in beforeEach.
  const bigFile = new File([new Uint8Array(DEFAULT_UPLOAD_CHUNK_SIZE + 1)], 'big-video.mp4', {
    type: 'video/mp4',
  });
  const smallFile = new File(['content'], 'test.jpg', { type: 'image/jpeg' });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(uploadManager, 'getExtensions').mockReturnValue(['.jpg', '.mp4']);
    uploadAssetsStore.reset();
    authManager.reset();
    authManager.setUser(mockUserObject);
    serverConfigState.value = { uploadChunkSize: DEFAULT_UPLOAD_CHUNK_SIZE } as ServerConfigDto;
    vi.spyOn(utils, 'uploadRequest').mockResolvedValue({ status: 200, data: mockUploadResponse });
    vi.spyOn(chunkedUpload, 'uploadFileChunked').mockResolvedValue(mockChunkedResponse);
  });

  it('takes the single-shot path when the file is below the threshold', async () => {
    await fileUploadHandler({ files: [smallFile] });

    expect(utils.uploadRequest).toHaveBeenCalledOnce();
    expect(chunkedUpload.uploadFileChunked).not.toHaveBeenCalled();

    const items = get(uploadAssetsStore);
    expect(items[0].state).toBe(UploadState.DONE);
    expect(items[0].assetId).toBe(mockUploadResponse.id);
  });

  it('takes the chunked path when the file is above the threshold', async () => {
    await fileUploadHandler({ files: [bigFile] });

    expect(chunkedUpload.uploadFileChunked).toHaveBeenCalledOnce();
    expect(utils.uploadRequest).not.toHaveBeenCalled();

    const call = vi.mocked(chunkedUpload.uploadFileChunked).mock.calls[0][0];
    expect(call.file).toBe(bigFile);
    expect(call.chunkSize).toBe(DEFAULT_UPLOAD_CHUNK_SIZE);

    const items = get(uploadAssetsStore);
    expect(items[0].state).toBe(UploadState.DONE);
    expect(items[0].assetId).toBe(mockChunkedResponse.id);
  });

  it('forces the single-shot path when uploadChunkSize is 0', async () => {
    serverConfigState.value = { uploadChunkSize: 0 } as ServerConfigDto;

    await fileUploadHandler({ files: [bigFile] });

    expect(utils.uploadRequest).toHaveBeenCalledOnce();
    expect(chunkedUpload.uploadFileChunked).not.toHaveBeenCalled();
  });

  it('forces the single-shot path when uploadChunkSize is missing (old server)', async () => {
    serverConfigState.value = {} as ServerConfigDto;

    await fileUploadHandler({ files: [bigFile] });

    expect(utils.uploadRequest).toHaveBeenCalledOnce();
    expect(chunkedUpload.uploadFileChunked).not.toHaveBeenCalled();
  });
});
