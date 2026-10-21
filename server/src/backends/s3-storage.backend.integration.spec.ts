import {
  CreateBucketCommand,
  HeadObjectCommand,
  ListMultipartUploadsCommand,
  ListObjectsV2Command,
  S3Client,
  S3ServiceException,
} from '@aws-sdk/client-s3';
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { S3StorageBackend } from 'src/backends/s3-storage.backend.js';
import { CacheControl } from 'src/enum.js';
import { RangeNotSatisfiableError } from 'src/interfaces/storage-backend.interface.js';

const canRunDocker = process.env.IMMICH_TEST_DOCKER === 'true';

async function countKeysForPrefix(client: S3Client, bucket: string, prefix: string): Promise<number> {
  let count = 0;
  let continuationToken: string | undefined;
  do {
    const page = await client.send(
      new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: continuationToken }),
    );
    count += page.Contents?.length ?? 0;
    continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (continuationToken);
  return count;
}

describe.skipIf(!canRunDocker)('S3StorageBackend integration (MinIO)', () => {
  let container: StartedTestContainer;
  let backend: S3StorageBackend;
  const bucket = 'test-bucket';

  beforeAll(async () => {
    // MinIO withdrew its own images on 2026-09-24; same pinned Chainguard build as
    // e2e/docker-compose.storage-migration.yml
    container = await new GenericContainer(
      'cgr.dev/chainguard/minio:latest@sha256:bd014394a80898e68c149f2311fdf8d5a2c2f3bb2c33b9327ae6d02b4b065ae1',
    )
      .withExposedPorts(9000)
      .withEnvironment({ MINIO_ROOT_USER: 'minioadmin', MINIO_ROOT_PASSWORD: 'minioadmin' })
      .withCommand(['server', '/data'])
      .withWaitStrategy(Wait.forHttp('/minio/health/live', 9000))
      .start();

    const endpoint = `http://${container.getHost()}:${container.getMappedPort(9000)}`;

    // Create bucket via direct S3 client
    const client = new S3Client({
      region: 'us-east-1',
      endpoint,
      forcePathStyle: true,
      credentials: { accessKeyId: 'minioadmin', secretAccessKey: 'minioadmin' },
    });
    await client.send(new CreateBucketCommand({ Bucket: bucket }));
    client.destroy();

    backend = new S3StorageBackend({
      bucket,
      region: 'us-east-1',
      endpoint,
      accessKeyId: 'minioadmin',
      secretAccessKey: 'minioadmin',
      presignedUrlExpiry: 3600,
      serveMode: 'redirect',
    });
  }, 60_000);

  afterAll(async () => {
    await container?.stop();
  });

  it('should round-trip a file through put and get', async () => {
    const content = Buffer.from('hello from S3 integration test');
    await backend.put('test/round-trip.txt', content, { contentType: 'text/plain' });

    const { stream, contentType } = await backend.get('test/round-trip.txt');
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.from(chunk));
    }
    expect(Buffer.concat(chunks).toString()).toBe('hello from S3 integration test');
    expect(contentType).toBe('text/plain');
  });

  it('should report exists correctly', async () => {
    await backend.put('test/exists.txt', Buffer.from('data'));
    expect(await backend.exists('test/exists.txt')).toBe(true);
    expect(await backend.exists('test/nope.txt')).toBe(false);
  });

  it('should delete objects', async () => {
    await backend.put('test/delete-me.txt', Buffer.from('data'));
    expect(await backend.exists('test/delete-me.txt')).toBe(true);

    await backend.delete('test/delete-me.txt');
    expect(await backend.exists('test/delete-me.txt')).toBe(false);
  });

  it('should download to temp file and cleanup', async () => {
    await backend.put('test/temp-download.txt', Buffer.from('temp content'));
    const { tempPath, cleanup } = await backend.downloadToTemp('test/temp-download.txt');

    const content = await readFile(tempPath, 'utf8');
    expect(content).toBe('temp content');

    await cleanup();
    expect(existsSync(tempPath)).toBe(false);
  });

  it('should return presigned URL in redirect mode', async () => {
    await backend.put('test/presigned.txt', Buffer.from('presigned data'));
    const strategy = await backend.getServeStrategy('test/presigned.txt', {
      contentType: 'text/plain',
      cacheControl: CacheControl.PrivateWithCache,
    });
    expect(strategy.type).toBe('redirect');
    if (strategy.type !== 'redirect') {
      return;
    }

    expect(strategy.url).toContain('test/presigned.txt');
    expect(strategy.url).toContain('X-Amz');
  });

  it('deletePrefix sweeps objects across list-pagination and delete-batch boundaries', async () => {
    // 2500 keys exercises both SDK caps in one test: ListObjectsV2 returns 1000 per page,
    // DeleteObjects takes 1000 per call. Three pages in, three batches out.
    const endpoint = `http://${container.getHost()}:${container.getMappedPort(9000)}`;
    const verifyClient = new S3Client({
      region: 'us-east-1',
      endpoint,
      forcePathStyle: true,
      credentials: { accessKeyId: 'minioadmin', secretAccessKey: 'minioadmin' },
    });

    const prefix = 'delete-prefix-boundary/';
    const totalKeys = 2500;
    const body = Buffer.from('x');
    const concurrency = 100;
    for (let offset = 0; offset < totalKeys; offset += concurrency) {
      const batch: Promise<unknown>[] = [];
      for (let i = 0; i < concurrency && offset + i < totalKeys; i++) {
        batch.push(backend.put(`${prefix}object-${offset + i}.txt`, body));
      }
      await Promise.all(batch);
    }

    const preCount = await countKeysForPrefix(verifyClient, bucket, prefix);
    expect(preCount).toBe(totalKeys);

    await backend.deletePrefix(prefix);

    const postCount = await countKeysForPrefix(verifyClient, bucket, prefix);
    expect(postCount).toBe(0);

    verifyClient.destroy();
  }, 120_000);

  it('should stream content in proxy mode', async () => {
    // Create a second backend instance in proxy mode
    const endpoint = `http://${container.getHost()}:${container.getMappedPort(9000)}`;
    const proxyBackend = new S3StorageBackend({
      bucket,
      region: 'us-east-1',
      endpoint,
      accessKeyId: 'minioadmin',
      secretAccessKey: 'minioadmin',
      presignedUrlExpiry: 3600,
      serveMode: 'proxy',
    });

    await backend.put('test/proxy.txt', Buffer.from('proxy content'));
    const strategy = await proxyBackend.getServeStrategy('test/proxy.txt', {
      contentType: 'text/plain',
      cacheControl: CacheControl.PrivateWithCache,
    });
    expect(strategy.type).toBe('stream');
    // eslint-disable-next-line unicorn/prefer-early-return
    if (strategy.type === 'stream') {
      const chunks: Buffer[] = [];
      for await (const chunk of strategy.stream) {
        chunks.push(Buffer.from(chunk));
      }
      expect(Buffer.concat(chunks).toString()).toBe('proxy content');
    }
  });

  it('should read a whole object into a buffer', async () => {
    await backend.put('test/read-all.txt', Buffer.from('whole object'));
    await expect(backend.readAll('test/read-all.txt')).resolves.toEqual(Buffer.from('whole object'));
  });

  it('should free a proxy read slot when the response it serves closes unread', async () => {
    const endpoint = `http://${container.getHost()}:${container.getMappedPort(9000)}`;
    const proxyBackend = new S3StorageBackend({
      bucket,
      region: 'us-east-1',
      endpoint,
      accessKeyId: 'minioadmin',
      secretAccessKey: 'minioadmin',
      presignedUrlExpiry: 3600,
      serveMode: 'proxy',
      proxyReadConcurrency: 1,
    });
    const options = { contentType: 'text/plain', cacheControl: CacheControl.PrivateWithCache };
    await backend.put('test/abandoned.txt', Buffer.from('abandoned'));

    const response = new AbortController();
    const first = await proxyBackend.getServeStrategy('test/abandoned.txt', { ...options, signal: response.signal });
    response.abort();

    // with one slot, this read only starts once the abandoned one gave its slot back
    const second = await proxyBackend.getServeStrategy('test/abandoned.txt', options);
    expect(first.type === 'stream' && first.stream.destroyed).toBe(true);
    if (second.type !== 'stream') {
      throw new Error('expected a stream');
    }
    const chunks = await second.stream.toArray();
    expect(chunks.join('')).toBe('abandoned');
  });

  describe('range requests in proxy mode', () => {
    // 'proxy range content' is 19 bytes
    const body = 'proxy range content';
    let proxyBackend: S3StorageBackend;

    beforeAll(async () => {
      const endpoint = `http://${container.getHost()}:${container.getMappedPort(9000)}`;
      proxyBackend = new S3StorageBackend({
        bucket,
        region: 'us-east-1',
        endpoint,
        accessKeyId: 'minioadmin',
        secretAccessKey: 'minioadmin',
        presignedUrlExpiry: 3600,
        serveMode: 'proxy',
      });
      await backend.put('test/proxy-range.txt', Buffer.from(body));
    });

    const readRange = async (range: string) => {
      const strategy = await proxyBackend.getServeStrategy('test/proxy-range.txt', {
        contentType: 'text/plain',
        cacheControl: CacheControl.PrivateWithCache,
        range,
      });
      if (strategy.type !== 'stream') {
        throw new Error(`expected a stream strategy, got ${strategy.type}`);
      }
      const chunks: Buffer[] = [];
      for await (const chunk of strategy.stream) {
        chunks.push(Buffer.from(chunk));
      }
      return { ...strategy, content: Buffer.concat(chunks).toString() };
    };

    // These prove the pass-through design: we never parse the Range header, and a real
    // S3 server resolves every syntax for us and reports the byte window it served.
    it('should serve a closed range', async () => {
      const { content, length, contentRange } = await readRange('bytes=0-4');
      expect(content).toBe('proxy');
      expect(length).toBe(5);
      expect(contentRange).toBe(`bytes 0-4/${body.length}`);
    });

    it('should serve an open-ended range', async () => {
      const { content, length, contentRange } = await readRange('bytes=12-');
      expect(content).toBe('content');
      expect(length).toBe(7);
      expect(contentRange).toBe(`bytes 12-18/${body.length}`);
    });

    it('should serve a suffix range', async () => {
      const { content, length, contentRange } = await readRange('bytes=-7');
      expect(content).toBe('content');
      expect(length).toBe(7);
      expect(contentRange).toBe(`bytes 12-18/${body.length}`);
    });

    it('should serve the whole object with no content range when no range is asked for', async () => {
      const strategy = await proxyBackend.getServeStrategy('test/proxy-range.txt', {
        contentType: 'text/plain',
        cacheControl: CacheControl.PrivateWithCache,
      });
      expect(strategy).toMatchObject({ type: 'stream', length: body.length });
      expect((strategy as { contentRange?: string }).contentRange).toBeUndefined();
      if (strategy.type === 'stream') {
        strategy.stream.destroy();
      }
    });

    it('should reject an unsatisfiable range', async () => {
      await expect(readRange('bytes=9999-10000')).rejects.toBeInstanceOf(RangeNotSatisfiableError);
    });
  });

  describe('copy and stat', () => {
    // template names: spaces, Unicode, the `+N` duplicate suffix and reserved URL characters, in nested folders
    const awkwardSource = 'test/copy/Café Trip/IMG_0001+1 (50% off) #2.jpg';
    const awkwardTarget = 'test/copy/library/admin/2024/Crème brûlée & co/IMG_0001+1.jpg';

    it('should copy an object whose key needs encoding, keeping the source and its content type', async () => {
      const content = Buffer.from('copy with awkward characters');
      await backend.put(awkwardSource, content, { contentType: 'image/jpeg' });

      await backend.copy(awkwardSource, awkwardTarget);

      await expect(backend.readAll(awkwardTarget)).resolves.toEqual(content);
      await expect(backend.stat(awkwardTarget)).resolves.toEqual({ size: content.length });
      const { stream, contentType } = await backend.get(awkwardTarget);
      stream.destroy();
      expect(contentType).toBe('image/jpeg');
      expect(await backend.exists(awkwardSource)).toBe(true);
    });

    it('should overwrite an existing target', async () => {
      await backend.put('test/copy/overwrite-source.txt', Buffer.from('new'));
      await backend.put('test/copy/overwrite-target.txt', Buffer.from('stale content'));

      await backend.copy('test/copy/overwrite-source.txt', 'test/copy/overwrite-target.txt');

      await expect(backend.readAll('test/copy/overwrite-target.txt')).resolves.toEqual(Buffer.from('new'));
    });

    it('should reject stat and copy for a missing object', async () => {
      await expect(backend.stat('test/copy/missing.txt')).rejects.toBeDefined();
      await expect(backend.copy('test/copy/missing.txt', 'test/copy/missing-target.txt')).rejects.toBeDefined();
      expect(await backend.exists('test/copy/missing-target.txt')).toBe(false);
    });

    it('should copy part by part above a lowered threshold', async () => {
      // 5 MiB is the smallest part S3 and MinIO accept; 12 MiB makes parts of 5, 5 and 2 MiB
      const MiB = 1024 ** 2;
      const endpoint = `http://${container.getHost()}:${container.getMappedPort(9000)}`;
      const multipartBackend = new S3StorageBackend({
        bucket,
        region: 'us-east-1',
        endpoint,
        accessKeyId: 'minioadmin',
        secretAccessKey: 'minioadmin',
        presignedUrlExpiry: 3600,
        serveMode: 'redirect',
        multipartCopyThreshold: 5 * MiB,
        multipartCopyPartSize: 5 * MiB,
      });
      const content = randomBytes(12 * MiB);
      const source = 'test/copy/Café Trip/clip+1.mp4';
      const target = 'test/copy/library/admin/2024/Café Trip/clip+1.mp4';
      await backend.put(source, content, { contentType: 'video/mp4' });

      await multipartBackend.copy(source, target);

      await expect(multipartBackend.stat(target)).resolves.toEqual({ size: content.length });
      // equals rather than toEqual: a failing 12 MiB toEqual would print both buffers
      const copied = await multipartBackend.readAll(target);
      expect(copied.equals(content)).toBe(true);
      const { stream, contentType } = await multipartBackend.get(target);
      stream.destroy();
      expect(contentType).toBe('video/mp4');

      // a multipart object's ETag ends in its part count, so this proves the copy went part by part
      const verifyClient = new S3Client({
        region: 'us-east-1',
        endpoint,
        forcePathStyle: true,
        credentials: { accessKeyId: 'minioadmin', secretAccessKey: 'minioadmin' },
      });
      const { ETag } = await verifyClient.send(new HeadObjectCommand({ Bucket: bucket, Key: target }));
      verifyClient.destroy();
      expect(ETag).toMatch(/-3"$/);
    }, 60_000);

    it('should abort its upload and copy with one CopyObject on a gateway without UploadPartCopy', async () => {
      // Storj's gateway answers UploadPartCopy with 501 NotImplemented. MinIO implements it, so the backend's own
      // client refuses it the same way before the request leaves; every other request reaches MinIO.
      const endpoint = `http://${container.getHost()}:${container.getMappedPort(9000)}`;
      const fallbackBackend = new S3StorageBackend({
        bucket,
        region: 'us-east-1',
        endpoint,
        accessKeyId: 'minioadmin',
        secretAccessKey: 'minioadmin',
        presignedUrlExpiry: 3600,
        serveMode: 'redirect',
        multipartCopyThreshold: 1024,
      });
      const sent: string[] = [];
      const fallbackClient: S3Client = (fallbackBackend as any).client;
      fallbackClient.middlewareStack.add(
        (next, context) => (args) => {
          sent.push(context.commandName ?? 'unknown');
          if (context.commandName === 'UploadPartCopyCommand') {
            throw new S3ServiceException({
              name: 'NotImplemented',
              $fault: 'server',
              $metadata: { httpStatusCode: 501 },
              message: 'A header you provided implies functionality that is not implemented',
            });
          }
          return next(args);
        },
        { step: 'initialize', name: 'refuseUploadPartCopy' },
      );
      const content = randomBytes(64 * 1024);
      const source = 'test/copy/no-part-copy/Café clip+1.mp4';
      const target = 'test/copy/library/admin/2024/no-part-copy/Café clip+1.mp4';
      await backend.put(source, content, { contentType: 'video/mp4' });

      await fallbackBackend.copy(source, target);

      expect(sent).toEqual([
        'HeadObjectCommand',
        'CreateMultipartUploadCommand',
        'UploadPartCopyCommand',
        'AbortMultipartUploadCommand',
        'CopyObjectCommand',
      ]);
      const copied = await backend.readAll(target);
      expect(copied.equals(content)).toBe(true);
      const { stream, contentType } = await backend.get(target);
      stream.destroy();
      expect(contentType).toBe('video/mp4');

      // the aborted upload holds no parts
      const verifyClient = new S3Client({
        region: 'us-east-1',
        endpoint,
        forcePathStyle: true,
        credentials: { accessKeyId: 'minioadmin', secretAccessKey: 'minioadmin' },
      });
      const { Uploads } = await verifyClient.send(new ListMultipartUploadsCommand({ Bucket: bucket, Prefix: target }));
      verifyClient.destroy();
      expect(Uploads ?? []).toEqual([]);
    });
  });
});
