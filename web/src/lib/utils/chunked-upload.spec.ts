import { AssetMediaStatus, AssetVisibility, type AssetMediaResponseDto } from '@immich/sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// A cold worker pays this file's module-transform cost inside whichever test happens to run
// first, which can approach the default 5000ms test timeout on a loaded machine even though the
// actual chunked-upload logic under test resolves in well under a millisecond. Raise it so that
// cost never turns into a false-negative timeout.
vi.setConfig({ testTimeout: 15_000 });

const createUploadSessionMock = vi.fn();
const deleteUploadSessionMock = vi.fn();

vi.mock('@immich/sdk', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@immich/sdk')>();
  return {
    ...actual,
    getBaseUrl: () => '/api',
    createUploadSession: (...args: unknown[]) => createUploadSessionMock(...args),
    deleteUploadSession: (...args: unknown[]) => deleteUploadSessionMock(...args),
  };
});

type ScriptedResponse = {
  status: number;
  headers?: Record<string, string>;
  body?: string;
  networkError?: boolean;
};

class FakeXhr {
  static instances: FakeXhr[] = [];
  static nextResponses: ScriptedResponse[] = [];

  method = '';
  url = '';
  requestHeaders: Record<string, string> = {};
  body: Blob | undefined;
  status = 0;
  responseText = '';

  #responseHeaders: Record<string, string> = {};
  #listeners: Record<string, Array<() => void>> = {};
  #uploadListeners: Record<string, Array<(event: { loaded: number; total: number }) => void>> = {};
  #aborted = false;

  upload = {
    addEventListener: (type: string, callback: (event: { loaded: number; total: number }) => void) => {
      (this.#uploadListeners[type] ??= []).push(callback);
    },
  };

  constructor() {
    FakeXhr.instances.push(this);
  }

  open(method: string, url: string) {
    this.method = method;
    this.url = url;
  }

  setRequestHeader(key: string, value: string) {
    this.requestHeaders[key] = value;
  }

  addEventListener(type: string, callback: () => void) {
    (this.#listeners[type] ??= []).push(callback);
  }

  getResponseHeader(name: string) {
    return this.#responseHeaders[name] ?? null;
  }

  abort() {
    if (this.#aborted) {
      return;
    }
    this.#aborted = true;
    this.#emit('abort');
  }

  send(body?: Blob) {
    this.body = body;
    if (this.#aborted) {
      return;
    }

    const scripted = FakeXhr.nextResponses.shift();
    if (!scripted) {
      throw new Error(`No scripted XHR response left for ${this.method} ${this.url}`);
    }

    queueMicrotask(() => {
      if (this.#aborted) {
        return;
      }

      if (scripted.networkError) {
        this.#emit('error');
        return;
      }

      if (this.body) {
        for (const callback of this.#uploadListeners.progress ?? []) {
          callback({ loaded: Math.floor(this.body.size / 2), total: this.body.size });
        }
        for (const callback of this.#uploadListeners.progress ?? []) {
          callback({ loaded: this.body.size, total: this.body.size });
        }
      }

      this.status = scripted.status;
      this.#responseHeaders = scripted.headers ?? {};
      this.responseText = scripted.body ?? '';
      this.#emit('load');
    });
  }

  #emit(type: string) {
    for (const callback of this.#listeners[type] ?? []) {
      callback();
    }
  }
}

describe('chunked-upload', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    FakeXhr.instances = [];
    FakeXhr.nextResponses = [];
    vi.stubGlobal('XMLHttpRequest', FakeXhr);
    deleteUploadSessionMock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const asset: AssetMediaResponseDto = { id: 'asset-1', status: AssetMediaStatus.Created };

  const baseParams = () => ({
    file: new File([new Uint8Array(25)], 'video.mp4'),
    chunkSize: 10,
    checksum: 'checksum-1',
    fileCreatedAt: '2026-01-01T00:00:00.000Z',
    fileModifiedAt: '2026-01-01T00:00:00.000Z',
  });

  describe('uploadFileChunked', () => {
    it('splits a file into the right number of chunks with correct offsets', async () => {
      const { uploadFileChunked } = await import('./chunked-upload');

      createUploadSessionMock.mockResolvedValue({ id: 'session-1', offset: 0, expiresAt: '2026-01-02T00:00:00.000Z' });
      FakeXhr.nextResponses = [
        { status: 204, headers: { 'Upload-Offset': '10' } },
        { status: 204, headers: { 'Upload-Offset': '20' } },
        { status: 201, body: JSON.stringify(asset) },
      ];

      const result = await uploadFileChunked(baseParams());

      expect(result).toEqual(asset);

      const patches = FakeXhr.instances.filter((instance) => instance.method === 'PATCH');
      expect(patches).toHaveLength(3);
      expect(patches[0].requestHeaders['Upload-Offset']).toBe('0');
      expect(patches[0].body?.size).toBe(10);
      expect(patches[0].requestHeaders['Content-Type']).toBe('application/offset+octet-stream');
      expect(patches[1].requestHeaders['Upload-Offset']).toBe('10');
      expect(patches[1].body?.size).toBe(10);
      expect(patches[2].requestHeaders['Upload-Offset']).toBe('20');
      expect(patches[2].body?.size).toBe(5);
    });

    it('reports monotonically increasing aggregate progress across chunks', async () => {
      const { uploadFileChunked } = await import('./chunked-upload');

      createUploadSessionMock.mockResolvedValue({ id: 'session-1', offset: 0, expiresAt: '2026-01-02T00:00:00.000Z' });
      FakeXhr.nextResponses = [
        { status: 204, headers: { 'Upload-Offset': '10' } },
        { status: 204, headers: { 'Upload-Offset': '20' } },
        { status: 201, body: JSON.stringify(asset) },
      ];

      const progressEvents: Array<{ loaded: number; total: number }> = [];
      await uploadFileChunked({
        ...baseParams(),
        onUploadProgress: (loaded, total) => {
          progressEvents.push({ loaded, total });
        },
      });

      expect(progressEvents.length).toBeGreaterThan(0);
      for (const event of progressEvents) {
        expect(event.total).toBe(25);
      }
      for (let index = 1; index < progressEvents.length; index++) {
        expect(progressEvents[index].loaded).toBeGreaterThanOrEqual(progressEvents[index - 1].loaded);
      }
      expect(progressEvents.at(-1)?.loaded).toBe(25);
    });

    it('retries a failed chunk after re-syncing via HEAD', async () => {
      const { uploadFileChunked } = await import('./chunked-upload');

      createUploadSessionMock.mockResolvedValue({ id: 'session-1', offset: 0, expiresAt: '2026-01-02T00:00:00.000Z' });
      FakeXhr.nextResponses = [
        { status: 0, networkError: true }, // first chunk fails
        { status: 200, headers: { 'Upload-Offset': '4' } }, // HEAD resync: server actually has 4 bytes
        { status: 204, headers: { 'Upload-Offset': '14' } }, // retried chunk succeeds, resliced from offset 4
        { status: 204, headers: { 'Upload-Offset': '24' } },
        { status: 201, body: JSON.stringify(asset) },
      ];

      const result = await uploadFileChunked({ ...baseParams(), retryDelayMs: 0 });

      expect(result).toEqual(asset);

      const heads = FakeXhr.instances.filter((instance) => instance.method === 'HEAD');
      expect(heads).toHaveLength(1);

      const patches = FakeXhr.instances.filter((instance) => instance.method === 'PATCH');
      // failed attempt + 3 successful chunk attempts (resynced chunk1, chunk2, chunk3(final, 5 bytes at offset 20? size is 25))
      expect(patches).toHaveLength(4);
      expect(patches[0].requestHeaders['Upload-Offset']).toBe('0');
      // retried chunk starts from the resynced offset (4), not from 0
      expect(patches[1].requestHeaders['Upload-Offset']).toBe('4');
      expect(patches[1].body?.size).toBe(10);
    });

    it('surfaces the error after N failed retries', async () => {
      const { uploadFileChunked } = await import('./chunked-upload');

      createUploadSessionMock.mockResolvedValue({ id: 'session-1', offset: 0, expiresAt: '2026-01-02T00:00:00.000Z' });
      FakeXhr.nextResponses = [
        { status: 0, networkError: true },
        { status: 200, headers: { 'Upload-Offset': '0' } },
        { status: 0, networkError: true },
        { status: 200, headers: { 'Upload-Offset': '0' } },
        { status: 0, networkError: true },
        { status: 200, headers: { 'Upload-Offset': '0' } },
        { status: 0, networkError: true },
      ];

      deleteUploadSessionMock.mockResolvedValue(undefined);

      await expect(uploadFileChunked({ ...baseParams(), retryDelayMs: 0, maxRetries: 3 })).rejects.toThrow();

      const patches = FakeXhr.instances.filter((instance) => instance.method === 'PATCH');
      expect(patches).toHaveLength(4); // 1 initial attempt + 3 retries

      expect(deleteUploadSessionMock).toHaveBeenCalledWith(expect.objectContaining({ id: 'session-1' }));
    });

    it('passes visibility, isFavorite and metadata identically to the single-shot path', async () => {
      const { uploadFileChunked } = await import('./chunked-upload');

      createUploadSessionMock.mockResolvedValue({ id: 'session-1', offset: 0, expiresAt: '2026-01-02T00:00:00.000Z' });
      FakeXhr.nextResponses = [
        { status: 204, headers: { 'Upload-Offset': '10' } },
        { status: 204, headers: { 'Upload-Offset': '20' } },
        { status: 201, body: JSON.stringify(asset) },
      ];

      await uploadFileChunked({
        ...baseParams(),
        filename: 'video.mp4',
        isFavorite: true,
        visibility: AssetVisibility.Locked,
        metadata: [{ key: 'foo', value: { bar: 'baz' } }],
      });

      expect(createUploadSessionMock).toHaveBeenCalledWith(
        expect.objectContaining({
          uploadSessionCreateDto: expect.objectContaining({
            filename: 'video.mp4',
            size: 25,
            checksum: 'checksum-1',
            isFavorite: true,
            visibility: AssetVisibility.Locked,
            metadata: [{ key: 'foo', value: { bar: 'baz' } }],
          }),
        }),
      );

      const call = createUploadSessionMock.mock.calls[0][0];
      // JSON-native types, not multipart string forms
      expect(typeof call.uploadSessionCreateDto.isFavorite).toBe('boolean');
      expect(Array.isArray(call.uploadSessionCreateDto.metadata)).toBe(true);
    });

    it('aborts the in-flight request and deletes the session', async () => {
      const { uploadFileChunked } = await import('./chunked-upload');
      const { cancelUploadRequests } = await import('$lib/utils');

      createUploadSessionMock.mockResolvedValue({ id: 'session-1', offset: 0, expiresAt: '2026-01-02T00:00:00.000Z' });
      deleteUploadSessionMock.mockResolvedValue(undefined);

      // Never resolve the first chunk's PATCH on its own; it will be aborted.
      FakeXhr.nextResponses = [];

      const uploadPromise = uploadFileChunked(baseParams());

      // Let the session get created and the first chunk's XHR get opened.
      await vi.waitFor(() => {
        expect(FakeXhr.instances.some((instance) => instance.method === 'PATCH')).toBe(true);
      });

      cancelUploadRequests();

      await expect(uploadPromise).rejects.toThrow();

      const patch = FakeXhr.instances.find((instance) => instance.method === 'PATCH');
      expect(patch).toBeDefined();

      expect(deleteUploadSessionMock).toHaveBeenCalledWith(expect.objectContaining({ id: 'session-1' }));
    });
  });

  describe('shouldUploadChunked', () => {
    it('is false when uploadChunkSize is 0', async () => {
      const { shouldUploadChunked } = await import('./chunked-upload');
      expect(shouldUploadChunked(100 * 1024 * 1024, 0)).toBe(false);
    });

    it('is false when uploadChunkSize is missing (old server)', async () => {
      const { shouldUploadChunked } = await import('./chunked-upload');
      expect(shouldUploadChunked(100 * 1024 * 1024, undefined)).toBe(false);
    });

    it('is false when the file is smaller than the chunk size', async () => {
      const { shouldUploadChunked } = await import('./chunked-upload');
      expect(shouldUploadChunked(10, 33_554_432)).toBe(false);
    });

    it('is true when the file is larger than the chunk size', async () => {
      const { shouldUploadChunked } = await import('./chunked-upload');
      expect(shouldUploadChunked(33_554_432 + 1, 33_554_432)).toBe(true);
    });
  });
});
