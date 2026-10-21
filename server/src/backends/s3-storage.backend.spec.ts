import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { PassThrough, Readable, Writable } from 'node:stream';
import { Mock, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { S3StorageBackend, S3_STREAM_IDLE_TIMEOUT_MS } from 'src/backends/s3-storage.backend.js';
import { CacheControl } from 'src/enum.js';
import { RangeNotSatisfiableError } from 'src/interfaces/storage-backend.interface.js';

// vi.mock() calls are hoisted above every import by Vitest's transform regardless of where they
// appear textually, so the imports above already see the mocked modules — this ordering is just
// for readability (mocks grouped together before the test body that uses them).
vi.mock('@aws-sdk/client-s3', async (importOriginal) => {
  const { StorageClass } = await importOriginal<typeof import('@aws-sdk/client-s3')>();
  const mockSend = vi.fn();
  return {
    // the backend only forwards a storage class the SDK knows, so it reads the real list
    StorageClass,
    // Vitest 4 invokes a mocked constructor via Reflect.construct when the code under test `new`s
    // it; an arrow function has no [[Construct]] slot, so this must be a function expression.
    S3Client: vi.fn(function () {
      return { send: mockSend, destroy: vi.fn() };
    }),
    // The commands below are also `new`-ed by the backend (or exist for parity with the real SDK), so
    // they get the same function-expression treatment as S3Client above.
    PutObjectCommand: vi.fn(function (input: any) {
      return { input, _type: 'PutObjectCommand' };
    }),
    GetObjectCommand: vi.fn(function (input: any) {
      return { input, _type: 'GetObjectCommand' };
    }),
    HeadObjectCommand: vi.fn(function (input: any) {
      return { input, _type: 'HeadObjectCommand' };
    }),
    DeleteObjectCommand: vi.fn(function (input: any) {
      return { input, _type: 'DeleteObjectCommand' };
    }),
    ListObjectsV2Command: vi.fn(function (input: any) {
      return { input, _type: 'ListObjectsV2Command' };
    }),
    DeleteObjectsCommand: vi.fn(function (input: any) {
      return { input, _type: 'DeleteObjectsCommand' };
    }),
    CopyObjectCommand: vi.fn(function (input: any) {
      return { input, _type: 'CopyObjectCommand' };
    }),
    CreateMultipartUploadCommand: vi.fn(function (input: any) {
      return { input, _type: 'CreateMultipartUploadCommand' };
    }),
    UploadPartCopyCommand: vi.fn(function (input: any) {
      return { input, _type: 'UploadPartCopyCommand' };
    }),
    CompleteMultipartUploadCommand: vi.fn(function (input: any) {
      return { input, _type: 'CompleteMultipartUploadCommand' };
    }),
    AbortMultipartUploadCommand: vi.fn(function (input: any) {
      return { input, _type: 'AbortMultipartUploadCommand' };
    }),
  };
});

vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: vi.fn().mockResolvedValue('https://bucket.s3.amazonaws.com/key?X-Amz-Signature=abc123'),
}));

vi.mock('@aws-sdk/lib-storage', () => ({
  // Same Reflect.construct requirement as S3Client above — Upload is also `new`-ed.
  Upload: vi.fn().mockImplementation(function () {
    return { done: vi.fn().mockResolvedValue({}) };
  }),
}));

const quietBody = () => new Readable({ read() {} });

// a GetObject that only settles by being aborted, like a slow S3 response the client gives up on
const abortableSend = (_command: unknown, { abortSignal }: { abortSignal: AbortSignal }) =>
  new Promise<never>((_resolve, reject) => {
    abortSignal.addEventListener('abort', () => reject(abortSignal.reason));
  });

// multipart copies above 100 bytes, in 40-byte parts
const lowCopyThresholdBackend = () =>
  new S3StorageBackend({
    bucket: 'test-bucket',
    region: 'us-east-1',
    presignedUrlExpiry: 3600,
    serveMode: 'redirect',
    multipartCopyThreshold: 100,
    multipartCopyPartSize: 40,
  });

describe('S3StorageBackend', () => {
  let backend: S3StorageBackend;
  let mockSend: Mock<(command: any) => Promise<any>>;

  const inputsOf = (type: string) =>
    mockSend.mock.calls.filter(([command]) => command._type === type).map(([command]) => command.input);

  /** the sizes of a multipart copy's parts, after checking that their ranges cover the object exactly, in order */
  const partSizes = (size: number) => {
    const ranges = inputsOf('UploadPartCopyCommand').map((input, index) => {
      const match = /^bytes=(\d+)-(\d+)$/.exec(input.CopySourceRange);
      expect(match).not.toBeNull();
      expect(input.PartNumber).toBe(index + 1);
      return { start: Number(match?.[1]), end: Number(match?.[2]) };
    });

    let next = 0;
    for (const { start, end } of ranges) {
      expect(start).toBe(next);
      expect(end).toBeGreaterThanOrEqual(start);
      next = end + 1;
    }
    expect(next).toBe(size);
    return ranges.map(({ start, end }) => end - start + 1);
  };

  beforeEach(() => {
    backend = new S3StorageBackend({
      bucket: 'test-bucket',
      region: 'us-east-1',
      presignedUrlExpiry: 3600,
      serveMode: 'redirect' as const,
    });
    const client = (S3Client as unknown as ReturnType<typeof vi.fn>).mock.results[0]?.value;
    mockSend = client?.send;
  });

  afterEach(() => {
    // clearAllMocks resets call history but leaves queued `mockResolvedValueOnce` values on
    // the shared `send` mock, so an unconsumed one would bleed into the next test
    mockSend.mockReset();
    vi.clearAllMocks();
  });

  describe('client', () => {
    it('only sends and verifies flexible checksums when an operation requires them (#1133)', () => {
      expect(S3Client).toHaveBeenCalledWith(
        expect.objectContaining({
          requestChecksumCalculation: 'WHEN_REQUIRED',
          responseChecksumValidation: 'WHEN_REQUIRED',
        }),
      );
    });
  });

  describe('put', () => {
    it('should upload buffer using Upload (multipart-capable)', async () => {
      const { Upload } = await import('@aws-sdk/lib-storage');
      await backend.put('upload/user1/ab/cd/file.jpg', Buffer.from('data'), {
        contentType: 'image/jpeg',
      });
      expect(Upload).toHaveBeenCalledWith(
        expect.objectContaining({
          params: expect.objectContaining({
            Bucket: 'test-bucket',
            Key: 'upload/user1/ab/cd/file.jpg',
            ContentType: 'image/jpeg',
          }),
        }),
      );
    });
  });

  describe('get', () => {
    it('should return stream from S3 GetObject', async () => {
      const bodyStream = Readable.from([Buffer.from('s3 content')]);
      mockSend.mockResolvedValueOnce({
        Body: bodyStream,
        ContentType: 'image/jpeg',
        ContentLength: 10,
      });

      const result = await backend.get('thumbs/user1/ab/cd/thumb.webp');
      expect(result.contentType).toBe('image/jpeg');
      expect(result.length).toBe(10);

      const chunks: Buffer[] = [];
      for await (const chunk of result.stream) {
        chunks.push(Buffer.from(chunk));
      }
      expect(Buffer.concat(chunks).toString()).toBe('s3 content');
    });
  });

  describe('readAll', () => {
    it('should read every chunk of the object into one buffer', async () => {
      mockSend.mockResolvedValueOnce({ Body: Readable.from([Buffer.from('chunk-1-'), Buffer.from('chunk-2')]) });

      await expect(backend.readAll('thumbs/user1/preview.webp')).resolves.toEqual(Buffer.from('chunk-1-chunk-2'));
    });
  });

  describe('exists', () => {
    it('should return true when HeadObject succeeds', async () => {
      mockSend.mockResolvedValueOnce({});
      expect(await backend.exists('some/key.jpg')).toBe(true);
    });

    it('should return false when HeadObject throws NotFound', async () => {
      mockSend.mockRejectedValueOnce({ name: 'NotFound' });
      expect(await backend.exists('missing/key.jpg')).toBe(false);
    });
  });

  describe('delete', () => {
    it('should send DeleteObjectCommand', async () => {
      mockSend.mockResolvedValueOnce({});
      await backend.delete('old/key.jpg');
      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            Bucket: 'test-bucket',
            Key: 'old/key.jpg',
          }),
        }),
      );
    });
  });

  describe('stat', () => {
    it('should return the ContentLength from HeadObject', async () => {
      mockSend.mockResolvedValueOnce({ ContentLength: 1234, ContentType: 'image/jpeg' });

      await expect(backend.stat('library/admin/2024/IMG_0001.jpg')).resolves.toEqual({ size: 1234 });
      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          _type: 'HeadObjectCommand',
          input: { Bucket: 'test-bucket', Key: 'library/admin/2024/IMG_0001.jpg' },
        }),
      );
    });

    it('should reject, not report a size of zero, when the object is missing', async () => {
      mockSend.mockRejectedValueOnce({ name: 'NotFound', $metadata: { httpStatusCode: 404 } });

      await expect(backend.stat('missing/key.jpg')).rejects.toMatchObject({ name: 'NotFound' });
    });
  });

  describe('copy', () => {
    type SentCommand = { _type: string; input: any };
    const GiB = 1024 ** 3;
    const MiB = 1024 ** 2;

    /** answers each command as S3 would for a source object of `size` bytes */
    const asS3 =
      (size: number, contentType = 'video/mp4') =>
      (command: SentCommand): Promise<unknown> => {
        switch (command._type) {
          case 'HeadObjectCommand': {
            return Promise.resolve({ ContentLength: size, ContentType: contentType });
          }
          case 'CreateMultipartUploadCommand': {
            return Promise.resolve({ UploadId: 'upload-1' });
          }
          case 'UploadPartCopyCommand': {
            return Promise.resolve({ CopyPartResult: { ETag: `"etag-${command.input.PartNumber}"` } });
          }
          default: {
            return Promise.resolve({});
          }
        }
      };

    it.each([
      ['a space', 'upload/user1/ab/cd/My Photo.jpg', 'test-bucket/upload/user1/ab/cd/My%20Photo.jpg'],
      ['a duplicate suffix', 'library/admin/2023/IMG_0001+1.jpg', 'test-bucket/library/admin/2023/IMG_0001%2B1.jpg'],
      [
        'Unicode',
        'library/admin/Café/Crème brûlée.jpg',
        'test-bucket/library/admin/Caf%C3%A9/Cr%C3%A8me%20br%C3%BBl%C3%A9e.jpg',
      ],
      [
        'reserved characters in nested folders',
        'library/admin/2023/Trip #1/Day 1 & 2/50% off?.jpg',
        'test-bucket/library/admin/2023/Trip%20%231/Day%201%20%26%202/50%25%20off%3F.jpg',
      ],
    ])('should CopyObject a key with %s, encoding CopySource per segment', async (_, fromKey, copySource) => {
      mockSend.mockImplementation(asS3(1024, 'image/jpeg'));
      const toKey = `library/admin/2024/${fromKey.split('/').at(-1)}`;

      await backend.copy(fromKey, toKey);

      expect(inputsOf('HeadObjectCommand')).toEqual([{ Bucket: 'test-bucket', Key: fromKey }]);
      // only CopySource is encoded: the SDK encodes the destination Key itself
      expect(inputsOf('CopyObjectCommand')).toEqual([
        { Bucket: 'test-bucket', Key: toKey, CopySource: copySource, MetadataDirective: 'COPY' },
      ]);
      expect(inputsOf('CreateMultipartUploadCommand')).toEqual([]);
    });

    /** asS3, with HeadObject also reporting the source's storage class */
    const asS3InClass = (size: number, storageClass: string, contentType = 'video/mp4') => {
      const respond = asS3(size, contentType);
      return (command: SentCommand) =>
        command._type === 'HeadObjectCommand'
          ? Promise.resolve({ ContentLength: size, ContentType: contentType, StorageClass: storageClass })
          : respond(command);
    };

    it('should keep the storage class of the source, which a copy would otherwise reset to STANDARD', async () => {
      mockSend.mockImplementation(asS3InClass(1024, 'STANDARD_IA', 'image/jpeg'));

      await backend.copy('upload/user1/ab/cd/photo.jpg', 'library/admin/2024/photo.jpg');

      expect(inputsOf('CopyObjectCommand')).toEqual([
        expect.objectContaining({ Key: 'library/admin/2024/photo.jpg', StorageClass: 'STANDARD_IA' }),
      ]);
    });

    it('should keep the storage class of the source on a multipart copy', async () => {
      mockSend.mockImplementation(asS3InClass(120, 'INTELLIGENT_TIERING'));

      await lowCopyThresholdBackend().copy('upload/user1/ab/cd/video.mp4', 'library/admin/2024/video.mp4');

      expect(inputsOf('CreateMultipartUploadCommand')).toEqual([
        {
          Bucket: 'test-bucket',
          Key: 'library/admin/2024/video.mp4',
          ContentType: 'video/mp4',
          StorageClass: 'INTELLIGENT_TIERING',
        },
      ]);
    });

    it.each([
      ['a MinIO tier name', 'WARM-TIER'],
      ['STANDARD, the default', 'STANDARD'],
    ])('should not send a storage class that is %s', async (_, storageClass) => {
      // MinIO reports an ILM-transitioned object's tier there and rejects it on a copy with InvalidStorageClass
      mockSend.mockImplementation(asS3InClass(1024, storageClass, 'image/jpeg'));

      await backend.copy('upload/user1/ab/cd/photo.jpg', 'library/admin/2024/photo.jpg');

      expect(inputsOf('CopyObjectCommand')).toEqual([
        {
          Bucket: 'test-bucket',
          Key: 'library/admin/2024/photo.jpg',
          CopySource: 'test-bucket/upload/user1/ab/cd/photo.jpg',
          MetadataDirective: 'COPY',
          StorageClass: undefined,
        },
      ]);
    });

    it('should not send a MinIO tier name on a multipart copy', async () => {
      mockSend.mockImplementation(asS3InClass(120, 'WARM-TIER'));

      await lowCopyThresholdBackend().copy('upload/user1/ab/cd/video.mp4', 'library/admin/2024/video.mp4');

      const [createInput] = inputsOf('CreateMultipartUploadCommand');
      expect(createInput).toMatchObject({ Key: 'library/admin/2024/video.mp4', ContentType: 'video/mp4' });
      expect(createInput.StorageClass).toBeUndefined();
      expect(inputsOf('CompleteMultipartUploadCommand')).toHaveLength(1);
    });

    it('should copy an object of exactly 5 GiB, the CopyObject limit, in one request', async () => {
      mockSend.mockImplementation(asS3(5 * GiB));

      await backend.copy('upload/user1/ab/cd/video.mp4', 'library/admin/2024/video.mp4');

      expect(inputsOf('CopyObjectCommand')).toHaveLength(1);
      expect(inputsOf('CreateMultipartUploadCommand')).toEqual([]);
    });

    it('should copy an object above 5 GiB in 512 MiB parts', async () => {
      mockSend.mockImplementation(asS3(5 * GiB + 1));

      await backend.copy('upload/user1/ab/cd/video.mp4', 'library/admin/2024/video.mp4');

      expect(inputsOf('CopyObjectCommand')).toEqual([]);
      expect(partSizes(5 * GiB + 1)).toEqual([...Array.from({ length: 10 }, () => 512 * MiB), 1]);
      expect(inputsOf('CompleteMultipartUploadCommand')).toHaveLength(1);
    });

    it('should grow the parts to keep an object of 5 TiB, the S3 maximum, within 10,000 parts', async () => {
      const size = 5 * 1024 ** 4;
      mockSend.mockImplementation(asS3(size));

      await backend.copy('upload/user1/ab/cd/huge.mp4', 'library/admin/2024/huge.mp4');

      const sizes = partSizes(size);
      expect(sizes).toHaveLength(10_000);
      expect(sizes.slice(0, -1).every((partSize) => partSize >= 512 * MiB && partSize <= 5 * GiB)).toBe(true);
    });

    it('should copy an object above the threshold part by part, carrying the content type over', async () => {
      const fromKey = 'library/admin/2023/Café clip+1.mov';
      const toKey = 'library/admin/2024/Café clip+1.mov';
      const copySource = 'test-bucket/library/admin/2023/Caf%C3%A9%20clip%2B1.mov';
      mockSend.mockImplementation(asS3(250, 'video/quicktime'));

      await lowCopyThresholdBackend().copy(fromKey, toKey);

      expect(mockSend.mock.calls.map(([command]) => command._type)).toEqual([
        'HeadObjectCommand',
        'CreateMultipartUploadCommand',
        ...Array.from({ length: 7 }, () => 'UploadPartCopyCommand'),
        'CompleteMultipartUploadCommand',
      ]);
      expect(inputsOf('CreateMultipartUploadCommand')).toEqual([
        { Bucket: 'test-bucket', Key: toKey, ContentType: 'video/quicktime' },
      ]);
      expect(inputsOf('UploadPartCopyCommand')).toEqual(
        ['0-39', '40-79', '80-119', '120-159', '160-199', '200-239', '240-249'].map((range, index) => ({
          Bucket: 'test-bucket',
          Key: toKey,
          UploadId: 'upload-1',
          PartNumber: index + 1,
          CopySource: copySource,
          CopySourceRange: `bytes=${range}`,
        })),
      );
      expect(inputsOf('CompleteMultipartUploadCommand')).toEqual([
        {
          Bucket: 'test-bucket',
          Key: toKey,
          UploadId: 'upload-1',
          MultipartUpload: {
            Parts: Array.from({ length: 7 }, (_, index) => ({ ETag: `"etag-${index + 1}"`, PartNumber: index + 1 })),
          },
        },
      ]);
    });

    it('should keep an object of exactly the threshold to one CopyObject', async () => {
      mockSend.mockImplementation(asS3(100));

      await lowCopyThresholdBackend().copy('upload/a.mov', 'library/a.mov');

      expect(inputsOf('CopyObjectCommand')).toHaveLength(1);
      expect(inputsOf('CreateMultipartUploadCommand')).toEqual([]);
    });

    it('should abort the upload and rethrow the error when a part fails', async () => {
      const failure = new Error('SlowDown');
      const respond = asS3(250);
      mockSend.mockImplementation((command: SentCommand) =>
        command._type === 'UploadPartCopyCommand' && command.input.PartNumber === 2
          ? Promise.reject(failure)
          : respond(command),
      );

      await expect(lowCopyThresholdBackend().copy('upload/a.mov', 'library/a.mov')).rejects.toBe(failure);

      expect(inputsOf('UploadPartCopyCommand')).toHaveLength(2);
      expect(inputsOf('CompleteMultipartUploadCommand')).toEqual([]);
      expect(inputsOf('AbortMultipartUploadCommand')).toEqual([
        { Bucket: 'test-bucket', Key: 'library/a.mov', UploadId: 'upload-1' },
      ]);
      // only a gateway without UploadPartCopy falls back to one CopyObject
      expect(inputsOf('CopyObjectCommand')).toEqual([]);
    });

    describe('on a gateway without UploadPartCopy', () => {
      // plain objects instead of Errors (unicorn/no-error-property-assignment), shaped as the SDK reports a 501
      const notImplemented = { name: 'NotImplemented', $metadata: { httpStatusCode: 501 } };
      const unnamed501 = { name: 'Unknown', $metadata: { httpStatusCode: 501 } };

      it.each([
        ['NotImplemented', notImplemented],
        ['an unnamed 501', unnamed501],
      ])('should abort the upload and copy with one CopyObject on %s', async (_, failure) => {
        const respond = asS3InClass(250, 'STANDARD_IA', 'video/quicktime');
        mockSend.mockImplementation((command: SentCommand) =>
          command._type === 'UploadPartCopyCommand' ? Promise.reject(failure) : respond(command),
        );

        await lowCopyThresholdBackend().copy('library/admin/2023/Café clip+1.mov', 'library/admin/2024/clip.mov');

        expect(mockSend.mock.calls.map(([command]) => command._type)).toEqual([
          'HeadObjectCommand',
          'CreateMultipartUploadCommand',
          'UploadPartCopyCommand',
          'AbortMultipartUploadCommand',
          'CopyObjectCommand',
        ]);
        expect(inputsOf('CopyObjectCommand')).toEqual([
          {
            Bucket: 'test-bucket',
            Key: 'library/admin/2024/clip.mov',
            CopySource: 'test-bucket/library/admin/2023/Caf%C3%A9%20clip%2B1.mov',
            MetadataDirective: 'COPY',
            StorageClass: 'STANDARD_IA',
          },
        ]);
      });

      it('should fall back when completing the upload is not implemented either', async () => {
        const respond = asS3(250);
        mockSend.mockImplementation((command: SentCommand) =>
          command._type === 'CompleteMultipartUploadCommand' ? Promise.reject(notImplemented) : respond(command),
        );

        await lowCopyThresholdBackend().copy('upload/a.mov', 'library/a.mov');

        expect(inputsOf('AbortMultipartUploadCommand')).toHaveLength(1);
        expect(inputsOf('CopyObjectCommand')).toHaveLength(1);
      });

      it('should reject with the CopyObject error, without retrying again, when the fallback fails', async () => {
        const tooLarge = { name: 'InvalidRequest', $metadata: { httpStatusCode: 400 } };
        const respond = asS3(250);
        mockSend.mockImplementation((command: SentCommand) => {
          if (command._type === 'UploadPartCopyCommand') {
            return Promise.reject(notImplemented);
          }
          if (command._type === 'CopyObjectCommand') {
            return Promise.reject(tooLarge);
          }
          return respond(command);
        });

        await expect(lowCopyThresholdBackend().copy('upload/a.mov', 'library/a.mov')).rejects.toBe(tooLarge);
        expect(inputsOf('CreateMultipartUploadCommand')).toHaveLength(1);
        expect(inputsOf('CopyObjectCommand')).toHaveLength(1);
      });

      it('should not retry a CopyObject below the threshold that is not implemented', async () => {
        const respond = asS3(100);
        mockSend.mockImplementation((command: SentCommand) =>
          command._type === 'CopyObjectCommand' ? Promise.reject(notImplemented) : respond(command),
        );

        await expect(lowCopyThresholdBackend().copy('upload/a.mov', 'library/a.mov')).rejects.toBe(notImplemented);
        expect(inputsOf('CopyObjectCommand')).toHaveLength(1);
        expect(inputsOf('CreateMultipartUploadCommand')).toEqual([]);
      });
    });

    it('should abort the upload when completing it fails', async () => {
      const failure = new Error('InternalError');
      const respond = asS3(250);
      mockSend.mockImplementation((command: SentCommand) =>
        command._type === 'CompleteMultipartUploadCommand' ? Promise.reject(failure) : respond(command),
      );

      await expect(lowCopyThresholdBackend().copy('upload/a.mov', 'library/a.mov')).rejects.toBe(failure);

      expect(inputsOf('AbortMultipartUploadCommand')).toEqual([
        { Bucket: 'test-bucket', Key: 'library/a.mov', UploadId: 'upload-1' },
      ]);
    });

    it('should rethrow the copy error, not the abort error, when the abort fails too', async () => {
      const failure = new Error('SlowDown');
      const respond = asS3(250);
      mockSend.mockImplementation((command: SentCommand) => {
        if (command._type === 'UploadPartCopyCommand') {
          return Promise.reject(failure);
        }
        if (command._type === 'AbortMultipartUploadCommand') {
          return Promise.reject(new Error('NoSuchUpload'));
        }
        return respond(command);
      });

      await expect(lowCopyThresholdBackend().copy('upload/a.mov', 'library/a.mov')).rejects.toBe(failure);
      expect(inputsOf('AbortMultipartUploadCommand')).toHaveLength(1);
    });

    it('should not abort an upload it could not create', async () => {
      const failure = new Error('AccessDenied');
      const respond = asS3(250);
      mockSend.mockImplementation((command: SentCommand) =>
        command._type === 'CreateMultipartUploadCommand' ? Promise.reject(failure) : respond(command),
      );

      await expect(lowCopyThresholdBackend().copy('upload/a.mov', 'library/a.mov')).rejects.toBe(failure);
      expect(inputsOf('UploadPartCopyCommand')).toEqual([]);
      expect(inputsOf('AbortMultipartUploadCommand')).toEqual([]);
    });

    it('should reject without copying when the source is missing', async () => {
      mockSend.mockRejectedValueOnce({ name: 'NotFound', $metadata: { httpStatusCode: 404 } });

      await expect(backend.copy('upload/missing.jpg', 'library/missing.jpg')).rejects.toMatchObject({
        name: 'NotFound',
      });
      expect(inputsOf('CopyObjectCommand')).toEqual([]);
      expect(inputsOf('CreateMultipartUploadCommand')).toEqual([]);
    });
  });

  describe('getServeStrategy', () => {
    it('should return redirect with presigned URL when serveMode is redirect', async () => {
      const strategy = await backend.getServeStrategy('thumbs/user1/ab/cd/thumb.webp', {
        contentType: 'image/webp',
        cacheControl: CacheControl.PrivateWithCache,
      });
      expect(strategy.type).toBe('redirect');
      if (strategy.type === 'redirect') {
        expect(strategy.url).toContain('X-Amz-Signature');
      }
      expect(getSignedUrl).toHaveBeenCalled();
    });

    it('should include response override metadata in redirect presigned URLs', async () => {
      const strategy = await backend.getServeStrategy('upload/user1/photo.jpg', {
        contentType: 'image/jpeg',
        cacheControl: CacheControl.PrivateWithCache,
        fileName: 'Vacation Photo.jpg',
        disposition: 'attachment',
      });

      expect(strategy.type).toBe('redirect');
      expect(GetObjectCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          Bucket: 'test-bucket',
          Key: 'upload/user1/photo.jpg',
          ResponseContentType: 'image/jpeg',
          ResponseContentDisposition: `attachment; filename*=UTF-8''Vacation%20Photo.jpg`,
        }),
      );
    });

    it('should sign a high-cardinality redirect burst without opening S3 read streams', async () => {
      const strategies = await Promise.all(
        Array.from({ length: 200 }, (_, index) =>
          backend.getServeStrategy(`thumbs/user1/aa/bb/thumb-${index}.webp`, {
            contentType: 'image/webp',
            cacheControl: CacheControl.PrivateWithCache,
            fileName: `thumb-${index}.webp`,
            disposition: 'inline',
          }),
        ),
      );

      expect(strategies).toHaveLength(200);
      expect(strategies.every((strategy) => strategy.type === 'redirect')).toBe(true);
      expect(mockSend).not.toHaveBeenCalled();
      expect(getSignedUrl).toHaveBeenCalledTimes(200);
    });

    it('should return stream when serveMode is proxy', async () => {
      const proxyBackend = new S3StorageBackend({
        bucket: 'test-bucket',
        region: 'us-east-1',
        presignedUrlExpiry: 3600,
        serveMode: 'proxy' as const,
      });

      const bodyStream = Readable.from([Buffer.from('proxied')]);
      // Need to get the new client's send mock
      const allClients = (S3Client as unknown as ReturnType<typeof vi.fn>).mock.results;
      const proxyClient = allClients.at(-1)?.value;
      proxyClient.send.mockResolvedValueOnce({
        Body: bodyStream,
        ContentLength: 7,
      });

      const strategy = await proxyBackend.getServeStrategy('key.jpg', {
        contentType: 'image/jpeg',
        cacheControl: CacheControl.PrivateWithCache,
      });
      expect(strategy.type).toBe('stream');
    });

    it('should limit concurrent proxied S3 reads', async () => {
      const proxyBackend = new S3StorageBackend({
        bucket: 'test-bucket',
        region: 'us-east-1',
        presignedUrlExpiry: 3600,
        serveMode: 'proxy' as const,
        proxyReadConcurrency: 1,
      });
      const proxyClient = (S3Client as unknown as ReturnType<typeof vi.fn>).mock.results.at(-1)?.value;
      const { promise: firstPending, resolve: firstResolve } = Promise.withResolvers<unknown>();
      proxyClient.send
        .mockReturnValueOnce(firstPending)
        .mockResolvedValueOnce({ Body: Readable.from([Buffer.from('second')]), ContentLength: 6 });

      const first = proxyBackend.getServeStrategy('first.jpg', {
        contentType: 'image/jpeg',
        cacheControl: CacheControl.PrivateWithCache,
      });
      const second = proxyBackend.getServeStrategy('second.jpg', {
        contentType: 'image/jpeg',
        cacheControl: CacheControl.PrivateWithCache,
      });
      await Promise.resolve();

      expect(proxyClient.send).toHaveBeenCalledTimes(1);
      firstResolve({ Body: Readable.from([Buffer.from('first')]), ContentLength: 5 });
      const firstStrategy = await first;
      expect(proxyClient.send).toHaveBeenCalledTimes(1);
      if (firstStrategy.type === 'stream') {
        firstStrategy.stream.destroy();
      }
      await second;

      expect(proxyClient.send).toHaveBeenCalledTimes(2);
      await expect(second).resolves.toMatchObject({ type: 'stream' });
    });

    it('should pass the client Range header through to S3 and relay the partial response', async () => {
      const proxyBackend = new S3StorageBackend({
        bucket: 'test-bucket',
        region: 'us-east-1',
        presignedUrlExpiry: 3600,
        serveMode: 'proxy' as const,
      });
      const proxyClient = (S3Client as unknown as ReturnType<typeof vi.fn>).mock.results.at(-1)?.value;
      proxyClient.send.mockResolvedValueOnce({
        Body: Readable.from([Buffer.from('a'.repeat(1024))]),
        ContentLength: 1024,
        ContentRange: 'bytes 0-1023/1048576',
      });

      const strategy = await proxyBackend.getServeStrategy('upload/user1/video.mp4', {
        contentType: 'video/mp4',
        cacheControl: CacheControl.PrivateWithCache,
        range: 'bytes=0-1023',
      });

      expect(GetObjectCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          Bucket: 'test-bucket',
          Key: 'upload/user1/video.mp4',
          Range: 'bytes=0-1023',
        }),
      );
      expect(strategy).toMatchObject({
        type: 'stream',
        length: 1024,
        contentRange: 'bytes 0-1023/1048576',
      });
    });

    it('should relay open-ended and suffix ranges verbatim without parsing them', async () => {
      const proxyBackend = new S3StorageBackend({
        bucket: 'test-bucket',
        region: 'us-east-1',
        presignedUrlExpiry: 3600,
        serveMode: 'proxy' as const,
      });
      const proxyClient = (S3Client as unknown as ReturnType<typeof vi.fn>).mock.results.at(-1)?.value;
      proxyClient.send
        .mockResolvedValueOnce({
          Body: Readable.from([Buffer.from('tail')]),
          ContentLength: 4,
          ContentRange: 'bytes 1048572-1048575/1048576',
        })
        .mockResolvedValueOnce({
          Body: Readable.from([Buffer.from('rest')]),
          ContentLength: 4,
          ContentRange: 'bytes 512-515/516',
        });

      await proxyBackend.getServeStrategy('upload/user1/video.mp4', {
        contentType: 'video/mp4',
        cacheControl: CacheControl.PrivateWithCache,
        range: 'bytes=-4',
      });
      await proxyBackend.getServeStrategy('upload/user1/video.mp4', {
        contentType: 'video/mp4',
        cacheControl: CacheControl.PrivateWithCache,
        range: 'bytes=512-',
      });

      expect(GetObjectCommand).toHaveBeenCalledWith(expect.objectContaining({ Range: 'bytes=-4' }));
      expect(GetObjectCommand).toHaveBeenCalledWith(expect.objectContaining({ Range: 'bytes=512-' }));
    });

    it('should not set Range on the S3 request when the client sent no range', async () => {
      const proxyBackend = new S3StorageBackend({
        bucket: 'test-bucket',
        region: 'us-east-1',
        presignedUrlExpiry: 3600,
        serveMode: 'proxy' as const,
      });
      const proxyClient = (S3Client as unknown as ReturnType<typeof vi.fn>).mock.results.at(-1)?.value;
      proxyClient.send.mockResolvedValueOnce({
        Body: Readable.from([Buffer.from('whole object')]),
        ContentLength: 12,
      });

      const strategy = await proxyBackend.getServeStrategy('upload/user1/video.mp4', {
        contentType: 'video/mp4',
        cacheControl: CacheControl.PrivateWithCache,
      });

      // assert the value, not just the absence of the key: the backend always passes
      // `Range`, and the AWS SDK omits the header only because the value is undefined
      const [[commandInput]] = (GetObjectCommand as unknown as ReturnType<typeof vi.fn>).mock.calls;
      expect(commandInput.Range).toBeUndefined();
      expect(strategy).toMatchObject({ type: 'stream', length: 12 });
      expect((strategy as { contentRange?: string }).contentRange).toBeUndefined();
    });

    it('should surface an unsatisfiable range as RangeNotSatisfiableError and release the read slot', async () => {
      const proxyBackend = new S3StorageBackend({
        bucket: 'test-bucket',
        region: 'us-east-1',
        presignedUrlExpiry: 3600,
        serveMode: 'proxy' as const,
        proxyReadConcurrency: 1,
      });
      const proxyClient = (S3Client as unknown as ReturnType<typeof vi.fn>).mock.results.at(-1)?.value;
      // plain object instead of an Error (unicorn/no-error-property-assignment)
      const invalidRange = {
        name: 'InvalidRange',
        message: 'The requested range is not satisfiable',
        $metadata: { httpStatusCode: 416 },
      };
      proxyClient.send.mockRejectedValueOnce(invalidRange).mockResolvedValueOnce({
        Body: Readable.from([Buffer.from('second')]),
        ContentLength: 6,
      });

      await expect(
        proxyBackend.getServeStrategy('upload/user1/video.mp4', {
          contentType: 'video/mp4',
          cacheControl: CacheControl.PrivateWithCache,
          range: 'bytes=999999999-',
        }),
      ).rejects.toBeInstanceOf(RangeNotSatisfiableError);

      // the limiter slot must have been released, otherwise this second read would never start
      const second = await proxyBackend.getServeStrategy('upload/user1/other.mp4', {
        contentType: 'video/mp4',
        cacheControl: CacheControl.PrivateWithCache,
      });
      expect(second.type).toBe('stream');
      expect(proxyClient.send).toHaveBeenCalledTimes(2);
    });

    it('should ignore the range in redirect mode and leave it to S3', async () => {
      const strategy = await backend.getServeStrategy('upload/user1/video.mp4', {
        contentType: 'video/mp4',
        cacheControl: CacheControl.PrivateWithCache,
        range: 'bytes=0-1023',
      });

      expect(strategy.type).toBe('redirect');
      // the presigned command must carry no Range at all: the client replays its own
      // Range header against S3, which answers it natively
      const [[commandInput]] = (GetObjectCommand as unknown as ReturnType<typeof vi.fn>).mock.calls;
      expect('Range' in commandInput).toBe(false);
      expect(mockSend).not.toHaveBeenCalled();
    });

    it('should not acquire proxy read slots in redirect mode', async () => {
      const strategy = await backend.getServeStrategy('thumbs/user1/ab/cd/thumb.webp', {
        contentType: 'image/webp',
        cacheControl: CacheControl.PrivateWithCache,
      });

      expect(strategy.type).toBe('redirect');
      expect(mockSend).not.toHaveBeenCalled();
      expect(getSignedUrl).toHaveBeenCalled();
    });
  });

  // The proxy read slot belongs to the stream getServeStrategy returns: whatever ends the read, the
  // slot comes back without the HTTP layer doing more than destroying a stream it stops piping.
  describe('proxy read slot', () => {
    const options = { contentType: 'video/mp4', cacheControl: CacheControl.PrivateWithCache };
    let proxyBackend: S3StorageBackend;
    let send: Mock<(command: unknown, options: { abortSignal: AbortSignal }) => Promise<unknown>>;

    const activeSlots = () => (proxyBackend as any).proxyReadLimiter.active as number;
    const serve = async (signal?: AbortSignal) => {
      const strategy = await proxyBackend.getServeStrategy('upload/user1/video.mp4', { ...options, signal });
      if (strategy.type !== 'stream') {
        throw new Error('expected a stream');
      }
      return strategy.stream;
    };

    beforeEach(() => {
      proxyBackend = new S3StorageBackend({
        bucket: 'test-bucket',
        region: 'us-east-1',
        presignedUrlExpiry: 3600,
        serveMode: 'proxy',
        proxyReadConcurrency: 1,
      });
      send = (S3Client as unknown as ReturnType<typeof vi.fn>).mock.results.at(-1)?.value.send;
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('is released when the stream is read to the end', async () => {
      send.mockResolvedValueOnce({ Body: Readable.from([Buffer.from('video')]) });

      const stream = await serve();
      expect(activeSlots()).toBe(1);
      await expect(stream.toArray()).resolves.toEqual([Buffer.from('video')]);

      await vi.waitFor(() => expect(activeSlots()).toBe(0));
    });

    it('is released when the S3 body fails mid-read', async () => {
      const body = quietBody();
      send.mockResolvedValueOnce({ Body: body });

      const stream = await serve();
      body.destroy(new Error('stream failed'));

      await expect(stream.toArray()).rejects.toThrow('stream failed');
      expect(activeSlots()).toBe(0);
    });

    it('is released when the consumer destroys the stream, and the S3 body goes with it', async () => {
      const body = quietBody();
      send.mockResolvedValueOnce({ Body: body });

      const stream = await serve();
      stream.destroy();

      await vi.waitFor(() => expect(activeSlots()).toBe(0));
      expect(body.destroyed).toBe(true);
    });

    it('is released when GetObject fails', async () => {
      send.mockRejectedValueOnce(new Error('denied'));

      await expect(serve()).rejects.toThrow('denied');
      expect(activeSlots()).toBe(0);
    });

    it('is released, and GetObject aborted, when the client leaves before the stream exists', async () => {
      send.mockImplementationOnce(abortableSend);
      const response = new AbortController();

      const pending = serve(response.signal);
      await vi.waitFor(() => expect(send).toHaveBeenCalled());
      response.abort();

      await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
      expect(activeSlots()).toBe(0);
    });

    it('is never used by a read whose client left while it waited for a slot', async () => {
      const first = quietBody();
      send.mockResolvedValueOnce({ Body: first });
      const firstStream = await serve();
      const response = new AbortController();

      const queued = serve(response.signal);
      response.abort();
      firstStream.destroy();

      await expect(queued).rejects.toMatchObject({ name: 'AbortError' });
      expect(send).toHaveBeenCalledTimes(1);
      expect(activeSlots()).toBe(0);
    });

    it('is never queued for by a client that already left', async () => {
      send.mockResolvedValueOnce({ Body: quietBody() });
      const firstStream = await serve();
      const response = new AbortController();
      response.abort();

      // the slot is held, so a queued read would hang here instead of rejecting
      await expect(serve(response.signal)).rejects.toMatchObject({ name: 'AbortError' });
      expect((proxyBackend as any).proxyReadLimiter.queue).toHaveLength(0);
      firstStream.destroy();
      await vi.waitFor(() => expect(activeSlots()).toBe(0));
    });

    it('never surfaces an idle destroy as an unhandled stream error while the stream is only piped', async () => {
      // pipe() adds no 'error' listener to its source, and with no signal nothing else does: this
      // holds only because the backend's own pipeline listens on the stream it returns
      vi.useFakeTimers();
      send.mockResolvedValueOnce({ Body: quietBody() });
      const stream = await serve();
      stream.pipe(new PassThrough());
      const uncaught = vi.fn();
      process.on('uncaughtException', uncaught);

      try {
        await vi.advanceTimersByTimeAsync(S3_STREAM_IDLE_TIMEOUT_MS);
        vi.useRealTimers();
        await new Promise((resolve) => setImmediate(resolve));
        expect(stream.errored?.message).toBe('S3 stream idle timeout');
        expect(uncaught).not.toHaveBeenCalled();
      } finally {
        process.off('uncaughtException', uncaught);
      }
    });

    it('never surfaces an idle destroy as an unhandled error once the S3 body has ended into a stalled consumer', async () => {
      // the thumbnail endpoint resolves its stream before sendFile, so there is no signal; once the
      // body has ended into the stream the backend's pipeline completes and drops its listeners,
      // leaving the idle destroy as the stream's only exit while the client holds the socket open
      vi.useFakeTimers();
      send.mockResolvedValueOnce({ Body: Readable.from([Buffer.from('a'), Buffer.from('b')]) });
      const stream = await serve();
      stream.pipe(new Writable({ highWaterMark: 1, write: () => {} }));
      const uncaught = vi.fn();
      process.on('uncaughtException', uncaught);

      try {
        await vi.advanceTimersByTimeAsync(S3_STREAM_IDLE_TIMEOUT_MS);
        vi.useRealTimers();
        await new Promise((resolve) => setImmediate(resolve));
        expect(stream.errored?.message).toBe('S3 stream idle timeout');
        expect(uncaught).not.toHaveBeenCalled();
        expect(activeSlots()).toBe(0);
      } finally {
        process.off('uncaughtException', uncaught);
      }
    });

    it('is released when the client leaves after the stream exists but before anything reads it', async () => {
      // e.g. sendFile throwing between getting the stream and piping it: the error response
      // closes the response, which aborts its signal
      const body = quietBody();
      send.mockResolvedValueOnce({ Body: body });
      const response = new AbortController();

      const stream = await serve(response.signal);
      response.abort();

      await vi.waitFor(() => expect(activeSlots()).toBe(0));
      expect(stream.destroyed).toBe(true);
      expect(body.destroyed).toBe(true);
    });

    it('is released, and the S3 body destroyed, after a full idle window with no data', async () => {
      vi.useFakeTimers();
      const body = quietBody();
      send.mockResolvedValueOnce({ Body: body });

      const stream = await serve();
      const destroy = vi.spyOn(stream, 'destroy');

      await vi.advanceTimersByTimeAsync(S3_STREAM_IDLE_TIMEOUT_MS - 1);
      expect(destroy).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(1);
      expect(destroy).toHaveBeenCalledWith(expect.objectContaining({ message: 'S3 stream idle timeout' }));
      expect(activeSlots()).toBe(0);
      expect(body.destroyed).toBe(true);
    });

    it('measures idleness from the last chunk, not the first', async () => {
      vi.useFakeTimers();
      const body = quietBody();
      send.mockResolvedValueOnce({ Body: body });

      const stream = await serve();
      stream.resume();

      // keep data flowing across more than two windows: a timer that never reset would have fired
      for (let elapsed = 0; elapsed < S3_STREAM_IDLE_TIMEOUT_MS * 2.5; elapsed += S3_STREAM_IDLE_TIMEOUT_MS / 4) {
        await vi.advanceTimersByTimeAsync(S3_STREAM_IDLE_TIMEOUT_MS / 4);
        body.push(Buffer.from('x'));
      }
      await vi.advanceTimersByTimeAsync(S3_STREAM_IDLE_TIMEOUT_MS - 1);
      expect(stream.destroyed).toBe(false);

      await vi.advanceTimersByTimeAsync(1);
      expect(stream.destroyed).toBe(true);
      expect(activeSlots()).toBe(0);
    });

    it('clears its idle timer once the read ends', async () => {
      vi.useFakeTimers();
      send.mockResolvedValueOnce({ Body: Readable.from([Buffer.from('video')]) });

      const stream = await serve();
      await stream.toArray();

      expect(vi.getTimerCount()).toBe(0);
    });
  });

  describe('downloadToTemp', () => {
    it('should download to a temp file and provide cleanup', async () => {
      const bodyStream = Readable.from([Buffer.from('temp file content')]);
      mockSend.mockResolvedValueOnce({ Body: bodyStream });

      const { tempPath, cleanup } = await backend.downloadToTemp('key.jpg');

      expect(tempPath).toContain('immich-');
      expect(tempPath.endsWith('.tmp')).toBe(true);

      const content = await readFile(tempPath, 'utf8');
      expect(content).toBe('temp file content');

      await cleanup();
      expect(existsSync(tempPath)).toBe(false);
    });
  });

  describe('getReadableUrl', () => {
    it('returns a presigned GET url for the key', async () => {
      const url = await backend.getReadableUrl('upload/admin/ab/cd/video.mp4');

      expect(url).toBe('https://bucket.s3.amazonaws.com/key?X-Amz-Signature=abc123');
      expect(GetObjectCommand).toHaveBeenCalledWith(expect.objectContaining({ Key: 'upload/admin/ab/cd/video.mp4' }));
    });

    it('signs the probe url with a short expiry, not the client serve TTL', async () => {
      // The backend is configured with presignedUrlExpiry: 3600 (client serving). This URL is
      // consumed server-side within the request and is a bearer credential, so it must be
      // short-lived to bound exposure if it ever reaches a log.
      await backend.getReadableUrl('upload/admin/ab/cd/video.mp4');

      const lastCall = vi.mocked(getSignedUrl).mock.calls.at(-1);
      expect(lastCall?.[2]).toEqual(expect.objectContaining({ expiresIn: 60 }));
    });
  });

  describe('deletePrefix', () => {
    it('should not send DeleteObjectsCommand when the prefix matches nothing', async () => {
      mockSend.mockResolvedValueOnce({ Contents: [], IsTruncated: false });

      await backend.deletePrefix('upload/ghost/');

      const listInputs = mockSend.mock.calls
        .filter(([cmd]) => cmd._type === 'ListObjectsV2Command')
        .map(([cmd]) => cmd.input);
      const deleteInputs = mockSend.mock.calls.filter(([cmd]) => cmd._type === 'DeleteObjectsCommand');
      expect(listInputs).toEqual([expect.objectContaining({ Bucket: 'test-bucket', Prefix: 'upload/ghost/' })]);
      expect(deleteInputs).toEqual([]);
    });

    it('should list then delete in a single batch for one page of results', async () => {
      mockSend
        .mockResolvedValueOnce({
          Contents: [{ Key: 'upload/u/aa/1.jpg' }, { Key: 'upload/u/aa/2.jpg' }, { Key: 'upload/u/bb/3.jpg' }],
          IsTruncated: false,
        })
        .mockResolvedValueOnce({ Deleted: [{}, {}, {}] });

      await backend.deletePrefix('upload/u/');

      const listCalls = mockSend.mock.calls.filter(([cmd]) => cmd._type === 'ListObjectsV2Command');
      const deleteInputs = mockSend.mock.calls
        .filter(([cmd]) => cmd._type === 'DeleteObjectsCommand')
        .map(([cmd]) => cmd.input);
      expect(listCalls).toHaveLength(1);
      expect(deleteInputs).toEqual([
        expect.objectContaining({
          Bucket: 'test-bucket',
          Delete: {
            Objects: [{ Key: 'upload/u/aa/1.jpg' }, { Key: 'upload/u/aa/2.jpg' }, { Key: 'upload/u/bb/3.jpg' }],
          },
        }),
      ]);
    });

    it('should paginate via ContinuationToken across multiple pages', async () => {
      mockSend
        .mockResolvedValueOnce({
          Contents: [{ Key: 'upload/u/a.jpg' }],
          IsTruncated: true,
          NextContinuationToken: 'token-page-2',
        })
        .mockResolvedValueOnce({ Deleted: [{}] })
        .mockResolvedValueOnce({ Contents: [{ Key: 'upload/u/b.jpg' }], IsTruncated: false })
        .mockResolvedValueOnce({ Deleted: [{}] });

      await backend.deletePrefix('upload/u/');

      const listInputs = mockSend.mock.calls
        .filter(([cmd]) => cmd._type === 'ListObjectsV2Command')
        .map(([cmd]) => cmd.input);
      const deleteCalls = mockSend.mock.calls.filter(([cmd]) => cmd._type === 'DeleteObjectsCommand');
      expect(listInputs).toHaveLength(2);
      expect(listInputs[0].ContinuationToken).toBeUndefined();
      expect(listInputs[1].ContinuationToken).toBe('token-page-2');
      expect(deleteCalls).toHaveLength(2);
    });

    it('should throw when DeleteObjects returns a non-empty Errors field', async () => {
      mockSend
        .mockResolvedValueOnce({ Contents: [{ Key: 'upload/u/x.jpg' }], IsTruncated: false })
        .mockResolvedValueOnce({
          Deleted: [],
          Errors: [{ Key: 'upload/u/x.jpg', Code: 'AccessDenied', Message: 'no perms' }],
        });

      await expect(backend.deletePrefix('upload/u/')).rejects.toThrow(/AccessDenied/);
    });

    it('should propagate exceptions from ListObjectsV2Command', async () => {
      mockSend.mockRejectedValueOnce(new Error('throttled'));

      await expect(backend.deletePrefix('upload/u/')).rejects.toThrow('throttled');
      expect(mockSend.mock.calls.filter(([cmd]) => cmd._type === 'DeleteObjectsCommand')).toEqual([]);
    });
  });

  describe('getPrefixUsage', () => {
    it('should sum object sizes across all pages', async () => {
      mockSend
        .mockResolvedValueOnce({
          Contents: [{ Size: 10 }, { Size: 20 }],
          IsTruncated: true,
          NextContinuationToken: 'token-page-2',
        })
        .mockResolvedValueOnce({
          Contents: [{ Size: 30 }, {}],
          IsTruncated: false,
        });

      await expect(backend.getPrefixUsage('thumbs/user-a/')).resolves.toBe(60);

      const listInputs = mockSend.mock.calls
        .filter(([cmd]) => cmd._type === 'ListObjectsV2Command')
        .map(([cmd]) => cmd.input);
      expect(listInputs).toEqual([
        expect.objectContaining({ Bucket: 'test-bucket', Prefix: 'thumbs/user-a/' }),
        expect.objectContaining({
          Bucket: 'test-bucket',
          Prefix: 'thumbs/user-a/',
          ContinuationToken: 'token-page-2',
        }),
      ]);
    });

    it('should return zero when the prefix matches nothing', async () => {
      mockSend.mockResolvedValueOnce({ Contents: undefined, IsTruncated: false });

      await expect(backend.getPrefixUsage('profile/ghost/')).resolves.toBe(0);
    });

    it('skips objects rejected by the filter', async () => {
      mockSend.mockResolvedValueOnce({
        Contents: [
          { Key: 'thumbs/user-a/aa/bb/keep.webp', Size: 10 },
          { Key: 'thumbs/user-a/aa/bb/skip.webp', Size: 20 },
        ],
        IsTruncated: false,
      });

      await expect(backend.getPrefixUsage('thumbs/user-a/', (filename) => filename !== 'skip.webp')).resolves.toBe(10);
    });
  });
});
