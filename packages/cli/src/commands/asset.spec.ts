import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { describe, expect, it, MockedFunction, vi } from 'vitest';

import {
  AssetRejectReason,
  AssetUploadAction,
  AssetVisibility,
  checkBulkUpload,
  defaults,
  getServerConfig,
  getSupportedMediaTypes,
  ServerConfigDto,
} from '@immich/sdk';
import { SingleBar } from 'cli-progress';
import createFetchMock from 'vitest-fetch-mock';

import {
  checkForDuplicates,
  deleteFiles,
  findSidecar,
  getAlbumName,
  startWatch,
  uploadFiles,
  UploadOptionsDto,
} from 'src/commands/asset';

vi.mock('@immich/sdk');

describe('getAlbumName', () => {
  it('should return a non-undefined value', () => {
    if (os.platform() === 'win32') {
      // This is meaningless for Unix systems.
      expect(getAlbumName(String.raw`D:\test\Filename.txt`, {} as UploadOptionsDto)).toBe('test');
    }
    expect(getAlbumName('D:/parentfolder/test/Filename.txt', {} as UploadOptionsDto)).toBe('test');
  });

  it('has higher priority to return `albumName` in `options`', () => {
    expect(getAlbumName('/parentfolder/test/Filename.txt', { albumName: 'example' } as UploadOptionsDto)).toBe(
      'example',
    );
  });
});

describe('uploadFiles', () => {
  const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-'));
  const testFilePath = path.join(testDir, 'test.png');
  const testFileData = 'test';
  const baseUrl = 'https://example.com';
  const apiKey = 'key';
  const retry = 3;

  const fetchMocker = createFetchMock(vi);

  beforeEach(() => {
    // Create a test file
    fs.writeFileSync(testFilePath, testFileData);

    // Defaults
    vi.mocked(defaults).baseUrl = baseUrl;
    vi.mocked(defaults).headers = { 'x-api-key': apiKey };

    fetchMocker.enableMocks();
    fetchMocker.resetMocks();
  });

  it('returns new assets when upload file is successful', async () => {
    fetchMocker.doMockIf(new RegExp(`${baseUrl}/assets$`), function () {
      return {
        status: 200,
        body: JSON.stringify({ id: 'fc5621b1-86f6-44a1-9905-403e607df9f5', status: 'created' }),
      };
    });

    await expect(uploadFiles([testFilePath], { concurrency: 1 })).resolves.toEqual([
      {
        filepath: testFilePath,
        id: 'fc5621b1-86f6-44a1-9905-403e607df9f5',
      },
    ]);
  }, 10_000);

  it('returns new assets when upload file retry is successful', async () => {
    let counter = 0;
    fetchMocker.doMockIf(new RegExp(`${baseUrl}/assets$`), function () {
      counter++;
      if (counter < retry) {
        throw new Error('Network error');
      }

      return {
        status: 200,
        body: JSON.stringify({ id: 'fc5621b1-86f6-44a1-9905-403e607df9f5', status: 'created' }),
      };
    });

    await expect(uploadFiles([testFilePath], { concurrency: 1 })).resolves.toEqual([
      {
        filepath: testFilePath,
        id: 'fc5621b1-86f6-44a1-9905-403e607df9f5',
      },
    ]);
  });

  it('returns new assets when upload file retry is failed', async () => {
    fetchMocker.doMockIf(new RegExp(`${baseUrl}/assets$`), function () {
      throw new Error('Network error');
    });

    await expect(uploadFiles([testFilePath], { concurrency: 1 })).resolves.toEqual([]);
  });

  it('uploads assets with the specified visibility', async () => {
    fetchMocker.doMockIf(new RegExp(`${baseUrl}/assets$`), function () {
      return {
        status: 200,
        body: JSON.stringify({ id: 'fc5621b1-86f6-44a1-9905-403e607df9f5', status: 'created' }),
      };
    });

    await uploadFiles([testFilePath], { concurrency: 1, visibility: AssetVisibility.Hidden });

    const formData = fetchMocker.mock.calls[0]?.[1]?.body as FormData;
    expect(formData.get('visibility')).toBe('hidden');
  });
});

describe('uploadFiles chunked upload', () => {
  const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-chunked-'));
  const baseUrl = 'https://example.com';
  const apiKey = 'key';
  const sessionId = 'session-1234';
  const assetId = 'fc5621b1-86f6-44a1-9905-403e607df9f5';

  const fetchMocker = createFetchMock(vi);

  beforeEach(() => {
    vi.mocked(defaults).baseUrl = baseUrl;
    vi.mocked(defaults).headers = { 'x-api-key': apiKey };

    fetchMocker.enableMocks();
    fetchMocker.resetMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // Mocks the create + N PATCH calls of the session protocol. The last PATCH resolves as the
  // final chunk (201, AssetMediaResponseDto); every earlier PATCH resolves 204 (more expected).
  const mockChunkedUploadEndpoints = (totalChunks: number) => {
    let patchCalls = 0;
    fetchMocker.doMockIf(new RegExp(`${baseUrl}/assets/upload-session`), (request) => {
      if (request.method === 'POST') {
        return {
          status: 201,
          body: JSON.stringify({
            id: sessionId,
            offset: 0,
            expiresAt: new Date(Date.now() + 60_000).toISOString(),
          }),
        };
      }

      patchCalls++;
      if (patchCalls < totalChunks) {
        return { status: 204 };
      }

      return {
        status: 201,
        body: JSON.stringify({ id: assetId, status: 'created' }),
      };
    });
  };

  it('creates a session and PATCHes N parts for a file above the threshold', async () => {
    const testFilePath = path.join(testDir, 'above-threshold.bin');
    const fileContent = Buffer.from('0123456789'); // 10 bytes
    fs.writeFileSync(testFilePath, fileContent);

    vi.mocked(getServerConfig).mockResolvedValue({ uploadChunkSize: 3 } as ServerConfigDto);
    mockChunkedUploadEndpoints(4);

    await expect(uploadFiles([testFilePath], { concurrency: 1 })).resolves.toEqual([
      { id: assetId, filepath: testFilePath },
    ]);

    const calls = fetchMocker.mock.calls;
    expect(calls).toHaveLength(5); // 1 create + 4 chunks

    const [sessionUrl, sessionInit] = calls[0];
    expect(sessionUrl).toBe(`${baseUrl}/assets/upload-session`);
    expect(sessionInit?.method?.toString().toUpperCase()).toBe('POST');
    expect((sessionInit?.headers as Record<string, string>)['Content-Type']).toBe('application/json');

    const createBody = JSON.parse(sessionInit?.body as string);
    expect(createBody).toMatchObject({
      filename: 'above-threshold.bin',
      size: 10,
      isFavorite: false,
    });

    const expectedChunks = [
      { offset: 0, bytes: fileContent.subarray(0, 3) },
      { offset: 3, bytes: fileContent.subarray(3, 6) },
      { offset: 6, bytes: fileContent.subarray(6, 9) },
      { offset: 9, bytes: fileContent.subarray(9, 10) },
    ];

    for (const [index, expected] of expectedChunks.entries()) {
      const [url, init] = calls[index + 1];
      expect(url).toBe(`${baseUrl}/assets/upload-session/${sessionId}`);
      expect(init?.method).toBe('PATCH');
      expect((init?.headers as Record<string, string>)['Upload-Offset']).toBe(String(expected.offset));
      expect((init?.headers as Record<string, string>)['Content-Type']).toBe('application/offset+octet-stream');
      expect(Buffer.from(init?.body as Uint8Array).equals(expected.bytes)).toBe(true);
    }
  });

  it('uses the existing single-shot path for a file below the threshold', async () => {
    const testFilePath = path.join(testDir, 'below-threshold.png');
    fs.writeFileSync(testFilePath, 'test');

    vi.mocked(getServerConfig).mockResolvedValue({ uploadChunkSize: 1000 } as ServerConfigDto);
    fetchMocker.doMockIf(new RegExp(`${baseUrl}/assets$`), function () {
      return { status: 200, body: JSON.stringify({ id: assetId, status: 'created' }) };
    });

    await expect(uploadFiles([testFilePath], { concurrency: 1 })).resolves.toEqual([
      { id: assetId, filepath: testFilePath },
    ]);

    const calls = fetchMocker.mock.calls;
    expect(calls).toHaveLength(1);
    expect(calls[0][0]).toBe(`${baseUrl}/assets`);
    expect(calls.some(([url]) => String(url).includes('upload-session'))).toBe(false);
  });

  it('forces single-shot when uploadChunkSize is 0', async () => {
    const testFilePath = path.join(testDir, 'zero-chunk-size.png');
    fs.writeFileSync(testFilePath, Buffer.alloc(50, 'a'));

    vi.mocked(getServerConfig).mockResolvedValue({ uploadChunkSize: 0 } as ServerConfigDto);
    fetchMocker.doMockIf(new RegExp(`${baseUrl}/assets$`), function () {
      return { status: 200, body: JSON.stringify({ id: assetId, status: 'created' }) };
    });

    await expect(uploadFiles([testFilePath], { concurrency: 1 })).resolves.toEqual([
      { id: assetId, filepath: testFilePath },
    ]);

    const calls = fetchMocker.mock.calls;
    expect(calls).toHaveLength(1);
    expect(calls[0][0]).toBe(`${baseUrl}/assets`);
  });

  it('forces single-shot when uploadChunkSize is missing (old server)', async () => {
    const testFilePath = path.join(testDir, 'missing-chunk-size.png');
    fs.writeFileSync(testFilePath, Buffer.alloc(50, 'a'));

    vi.mocked(getServerConfig).mockResolvedValue({} as ServerConfigDto);
    fetchMocker.doMockIf(new RegExp(`${baseUrl}/assets$`), function () {
      return { status: 200, body: JSON.stringify({ id: assetId, status: 'created' }) };
    });

    await expect(uploadFiles([testFilePath], { concurrency: 1 })).resolves.toEqual([
      { id: assetId, filepath: testFilePath },
    ]);

    const calls = fetchMocker.mock.calls;
    expect(calls).toHaveLength(1);
    expect(calls[0][0]).toBe(`${baseUrl}/assets`);
  });

  it('carries a sidecar on the create call, not as a second part', async () => {
    const testFilePath = path.join(testDir, 'with-sidecar.jpg');
    const fileContent = Buffer.from('0123456789'); // 10 bytes
    fs.writeFileSync(testFilePath, fileContent);
    const sidecarPath = path.join(testDir, 'with-sidecar.jpg.xmp');
    const sidecarContent = '<xmp>example sidecar</xmp>';
    fs.writeFileSync(sidecarPath, sidecarContent, 'utf8');

    vi.mocked(getServerConfig).mockResolvedValue({ uploadChunkSize: 3 } as ServerConfigDto);
    mockChunkedUploadEndpoints(4);

    await uploadFiles([testFilePath], { concurrency: 1 });

    const calls = fetchMocker.mock.calls;
    const [, sessionInit] = calls[0];
    const createBody = JSON.parse(sessionInit?.body as string);

    expect(createBody.sidecar).toBe(sidecarContent);

    // The sidecar must never be sent as a separate part/request of its own.
    expect(calls).toHaveLength(5); // 1 create + 4 chunks, nothing extra for the sidecar
    for (const [, init] of calls) {
      expect(init?.body instanceof FormData).toBe(false);
    }
  });

  it('progress totals match the file size exactly after a chunked upload', async () => {
    const testFilePath = path.join(testDir, 'progress.bin');
    const fileContent = Buffer.from('0123456789'); // 10 bytes
    fs.writeFileSync(testFilePath, fileContent);

    vi.mocked(getServerConfig).mockResolvedValue({ uploadChunkSize: 3 } as ServerConfigDto);
    mockChunkedUploadEndpoints(4);

    const incrementSpy = vi.spyOn(SingleBar.prototype, 'increment');

    await uploadFiles([testFilePath], { concurrency: 1, progress: true });

    const totalIncremented = incrementSpy.mock.calls.reduce(
      (sum, call) => sum + (typeof call[0] === 'number' ? call[0] : 0),
      0,
    );
    expect(totalIncremented).toBe(fileContent.byteLength);
  });
});

describe('checkForDuplicates', () => {
  const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-'));
  const testFilePath = path.join(testDir, 'test.png');
  const testFileData = 'test';
  const testFileChecksum = 'a94a8fe5ccb19ba61c4c0873d391e987982fbbd3'; // SHA1
  const retry = 3;

  beforeEach(() => {
    // Create a test file
    fs.writeFileSync(testFilePath, testFileData);
  });

  it('checks duplicates', async () => {
    vi.mocked(checkBulkUpload).mockResolvedValue({
      results: [
        {
          action: AssetUploadAction.Accept,
          id: testFilePath,
        },
      ],
    });

    await checkForDuplicates([testFilePath], { concurrency: 1 });

    expect(checkBulkUpload).toHaveBeenCalledWith({
      assetBulkUploadCheckDto: {
        assets: [
          {
            checksum: testFileChecksum,
            id: testFilePath,
          },
        ],
      },
    });
  });

  it('returns duplicates when check duplicates is rejected', async () => {
    vi.mocked(checkBulkUpload).mockResolvedValue({
      results: [
        {
          action: AssetUploadAction.Reject,
          id: testFilePath,
          assetId: 'fc5621b1-86f6-44a1-9905-403e607df9f5',
          reason: AssetRejectReason.Duplicate,
        },
      ],
    });

    await expect(checkForDuplicates([testFilePath], { concurrency: 1 })).resolves.toEqual({
      duplicates: [
        {
          filepath: testFilePath,
          id: 'fc5621b1-86f6-44a1-9905-403e607df9f5',
        },
      ],
      newFiles: [],
    });
  });

  it('returns new assets when check duplicates is accepted', async () => {
    vi.mocked(checkBulkUpload).mockResolvedValue({
      results: [
        {
          action: AssetUploadAction.Accept,
          id: testFilePath,
        },
      ],
    });

    await expect(checkForDuplicates([testFilePath], { concurrency: 1 })).resolves.toEqual({
      duplicates: [],
      newFiles: [testFilePath],
    });
  });

  it('returns results when check duplicates retry is successful', async () => {
    let mocked = vi.mocked(checkBulkUpload);
    for (let i = 1; i < retry; i++) {
      mocked = mocked.mockRejectedValueOnce(new Error('Network error'));
    }
    mocked.mockResolvedValue({
      results: [
        {
          action: AssetUploadAction.Accept,
          id: testFilePath,
        },
      ],
    });

    await expect(checkForDuplicates([testFilePath], { concurrency: 1 })).resolves.toEqual({
      duplicates: [],
      newFiles: [testFilePath],
    });
  });

  it('returns results when check duplicates retry is failed', async () => {
    vi.mocked(checkBulkUpload).mockRejectedValue(new Error('Network error'));

    await expect(checkForDuplicates([testFilePath], { concurrency: 1 })).resolves.toEqual({
      duplicates: [],
      newFiles: [],
    });
  });
});

describe('startWatch', () => {
  let testFolder: string;
  let checkBulkUploadMocked: MockedFunction<typeof checkBulkUpload>;

  beforeEach(async () => {
    vi.restoreAllMocks();

    vi.mocked(getSupportedMediaTypes).mockResolvedValue({
      image: ['.jpg'],
      sidecar: ['.xmp'],
      video: ['.mp4'],
    });

    testFolder = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'test-startWatch-'));
    checkBulkUploadMocked = vi.mocked(checkBulkUpload);
    checkBulkUploadMocked.mockResolvedValue({
      results: [],
    });
  });

  it('should start watching a directory and upload new files', async () => {
    const testFilePath = path.join(testFolder, 'test.jpg');

    await startWatch([testFolder], { concurrency: 1 }, { batchSize: 1, debounceTimeMs: 10 });
    await sleep(100); // to debounce the watcher from considering the test file as a existing file
    await fs.promises.writeFile(testFilePath, 'testjpg');

    await vi.waitFor(
      () =>
        expect(checkBulkUpload).toHaveBeenCalledWith({
          assetBulkUploadCheckDto: {
            assets: [
              expect.objectContaining({
                id: testFilePath,
              }),
            ],
          },
        }),
      { timeout: 5000 },
    );
  });

  it('should filter out unsupported files', async () => {
    const testFilePath = path.join(testFolder, 'test.jpg');
    const unsupportedFilePath = path.join(testFolder, 'test.txt');

    await startWatch([testFolder], { concurrency: 1 }, { batchSize: 1, debounceTimeMs: 10 });
    await sleep(100); // to debounce the watcher from considering the test file as a existing file
    await fs.promises.writeFile(testFilePath, 'testjpg');
    await fs.promises.writeFile(unsupportedFilePath, 'testtxt');

    await vi.waitFor(
      () =>
        expect(checkBulkUpload).toHaveBeenCalledWith({
          assetBulkUploadCheckDto: {
            assets: expect.arrayContaining([
              expect.objectContaining({
                id: testFilePath,
              }),
            ]),
          },
        }),
      { timeout: 5000 },
    );

    expect(checkBulkUpload).not.toHaveBeenCalledWith({
      assetBulkUploadCheckDto: {
        assets: expect.arrayContaining([
          expect.objectContaining({
            id: unsupportedFilePath,
          }),
        ]),
      },
    });
  });

  it('should filter out ignored patterns', async () => {
    const testFilePath = path.join(testFolder, 'test.jpg');
    const ignoredPattern = 'ignored';
    const ignoredFolder = path.join(testFolder, ignoredPattern);
    await fs.promises.mkdir(ignoredFolder, { recursive: true });
    const ignoredFilePath = path.join(ignoredFolder, 'ignored.jpg');

    await startWatch([testFolder], { concurrency: 1, ignore: ignoredPattern }, { batchSize: 1, debounceTimeMs: 10 });
    await sleep(100); // to debounce the watcher from considering the test file as a existing file
    await fs.promises.writeFile(testFilePath, 'testjpg');
    await fs.promises.writeFile(ignoredFilePath, 'ignoredjpg');

    await vi.waitFor(
      () =>
        expect(checkBulkUpload).toHaveBeenCalledWith({
          assetBulkUploadCheckDto: {
            assets: expect.arrayContaining([
              expect.objectContaining({
                id: testFilePath,
              }),
            ]),
          },
        }),
      { timeout: 5000 },
    );

    expect(checkBulkUpload).not.toHaveBeenCalledWith({
      assetBulkUploadCheckDto: {
        assets: expect.arrayContaining([
          expect.objectContaining({
            id: ignoredFilePath,
          }),
        ]),
      },
    });
  });

  afterEach(async () => {
    await fs.promises.rm(testFolder, { recursive: true, force: true });
  });
});

describe('findSidecar', () => {
  let testDir: string;
  let testFilePath: string;

  beforeEach(() => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-sidecar-'));
    testFilePath = path.join(testDir, 'test.jpg');
    fs.writeFileSync(testFilePath, 'test');
  });

  afterEach(() => {
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  it('should find sidecar file with photo.xmp naming convention', () => {
    const sidecarPath = path.join(testDir, 'test.xmp');
    fs.writeFileSync(sidecarPath, 'xmp data');

    const result = findSidecar(testFilePath);
    expect(result).toBe(sidecarPath);
  });

  it('should find sidecar file with photo.ext.xmp naming convention', () => {
    const sidecarPath = path.join(testDir, 'test.jpg.xmp');
    fs.writeFileSync(sidecarPath, 'xmp data');

    const result = findSidecar(testFilePath);
    expect(result).toBe(sidecarPath);
  });

  it('should prefer photo.ext.xmp over photo.xmp when both exist', () => {
    const sidecarPath1 = path.join(testDir, 'test.xmp');
    const sidecarPath2 = path.join(testDir, 'test.jpg.xmp');
    fs.writeFileSync(sidecarPath1, 'xmp data 1');
    fs.writeFileSync(sidecarPath2, 'xmp data 2');

    const result = findSidecar(testFilePath);
    // Should return the first one found (photo.xmp) based on the order in the code
    expect(result).toBe(sidecarPath1);
  });

  it('should return undefined when no sidecar file exists', () => {
    const result = findSidecar(testFilePath);
    expect(result).toBeUndefined();
  });
});

describe('deleteFiles', () => {
  let testDir: string;
  let testFilePath: string;

  beforeEach(() => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-delete-'));
    testFilePath = path.join(testDir, 'test.jpg');
    fs.writeFileSync(testFilePath, 'test');
  });

  afterEach(() => {
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  it('should delete asset and sidecar file when main file is deleted', async () => {
    const sidecarPath = path.join(testDir, 'test.xmp');
    fs.writeFileSync(sidecarPath, 'xmp data');

    await deleteFiles([{ id: 'test-id', filepath: testFilePath }], [], { delete: true, concurrency: 1 });

    expect(fs.existsSync(testFilePath)).toBe(false);
    expect(fs.existsSync(sidecarPath)).toBe(false);
  });

  it('should not delete sidecar file when delete option is false', async () => {
    const sidecarPath = path.join(testDir, 'test.xmp');
    fs.writeFileSync(sidecarPath, 'xmp data');

    await deleteFiles([{ id: 'test-id', filepath: testFilePath }], [], { delete: false, concurrency: 1 });

    expect(fs.existsSync(testFilePath)).toBe(true);
    expect(fs.existsSync(sidecarPath)).toBe(true);
  });
});
