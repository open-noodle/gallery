import { fork } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rm, stat, unlink, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VideoSampleCache, videoSampleKey } from 'src/gallery/utils/video-sample-cache.js';

const location = (root: string, key: string) => {
  const hash = videoSampleKey(key);
  return join(root, hash[0], `${hash}.sample`);
};

describe('VideoSampleCache', () => {
  let dir: string;
  let cache: VideoSampleCache;
  let root: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'video-cache-spec-'));
    root = join(dir, 'cache');
    cache = new VideoSampleCache({ root });
  });

  afterEach(async () => {
    cache[Symbol.dispose]();
    await rm(dir, { recursive: true, force: true });
  });

  it('reuses a completed sample across cache instances and preserves it when a job edits or deletes its copy', async () => {
    const first = join(dir, 'human.jpeg');
    const second = join(dir, 'pet.jpeg');
    const produce = vi.fn(() => writeFile(first, 'original frame'));
    await cache.materialize('same frame', first, produce);
    await writeFile(first, 'altered by consumer');
    await unlink(first);

    using otherWorker = new VideoSampleCache({ root });
    const unnecessary = vi.fn(() => writeFile(second, 'wrong'));
    await otherWorker.materialize('same frame', second, unnecessary);

    expect(produce).toHaveBeenCalledTimes(1);
    expect(unnecessary).not.toHaveBeenCalled();
    expect(await readFile(second, 'utf8')).toBe('original frame');
  });

  it('coordinates simultaneous producers across independent instances', async () => {
    using otherWorker = new VideoSampleCache({ root });
    const produce = vi.fn((output: string) => writeFile(output, 'frame'));
    const first = join(dir, 'human.jpeg');
    const second = join(dir, 'pet.jpeg');
    await Promise.all([
      cache.materialize('frame', first, () => produce(first)),
      otherWorker.materialize('frame', second, () => produce(second)),
    ]);
    expect(produce).toHaveBeenCalledTimes(1);
    expect(await readFile(first, 'utf8')).toBe('frame');
    expect(await readFile(second, 'utf8')).toBe('frame');
  });

  it('coordinates separate Node processes sharing a cache directory', async () => {
    // Node's type stripping runs the real filesystem cache without importing Vitest or its module mocks.
    const moduleUrl = new URL('video-sample-cache.ts', import.meta.url).href;
    const script = join(dir, 'worker.mjs');
    await writeFile(
      script,
      String.raw`
      import { appendFile, writeFile } from 'node:fs/promises';
      import { setTimeout } from 'node:timers/promises';
      import { VideoSampleCache } from ${JSON.stringify(moduleUrl)};
      using cache = new VideoSampleCache({ root: process.argv[2] });
      await cache.materialize('shared-frame', process.argv[3], async () => {
        await appendFile(process.argv[4], 'extracted\n');
        await setTimeout(100);
        await writeFile(process.argv[3], 'frame');
      });
    `,
    );
    const counter = join(dir, 'counter');
    const run = (output: string) =>
      new Promise<void>((resolve, reject) => {
        const child = fork(script, [root, output, counter], { execArgv: [], stdio: 'pipe' });
        let stderr = '';
        child.stderr?.on('data', (chunk) => {
          stderr += String(chunk);
        });
        child.on('error', reject);
        child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(stderr))));
      });
    await Promise.all([run(join(dir, 'human.jpeg')), run(join(dir, 'pet.jpeg'))]);
    expect(await readFile(counter, 'utf8')).toBe('extracted\n');
  });

  it('propagates extraction failures without caching partial output, then allows a retry', async () => {
    const output = join(dir, 'frame.jpeg');
    const error = new Error('ffmpeg failed');
    await expect(
      cache.materialize('frame', output, async () => {
        await writeFile(output, 'partial');
        throw error;
      }),
    ).rejects.toBe(error);
    const retry = vi.fn(() => writeFile(output, 'complete'));
    await cache.materialize('frame', output, retry);
    expect(retry).toHaveBeenCalledTimes(1);
    expect(await readFile(location(root, 'frame'), 'utf8')).toBe('complete');
  });

  it('expires idle entries and regenerates expired samples', async () => {
    const output = join(dir, 'frame.jpeg');
    await cache.materialize('frame', output, () => writeFile(output, 'old'));
    const expired = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    await utimes(location(root, 'frame'), expired, expired);
    await cache.prune();
    await expect(stat(location(root, 'frame'))).rejects.toMatchObject({ code: 'ENOENT' });
    await cache.materialize('frame', output, () => writeFile(output, 'new'));
    expect(await readFile(output, 'utf8')).toBe('new');
  });

  it('evicts the least recently used entry within its shard and skips samples larger than the budget', async () => {
    cache[Symbol.dispose]();
    cache = new VideoSampleCache({ root, maxBytes: 16 * 8 }); // 8 bytes per shard.
    const keys = ['a'];
    for (let i = 0; keys.length < 3; i++) {
      if (videoSampleKey(`key-${i}`)[0] === videoSampleKey('a')[0]) {
        keys.push(`key-${i}`);
      }
    }
    const output = join(dir, 'frame.jpeg');
    for (const [index, key] of keys.entries()) {
      await cache.materialize(key, output, () => writeFile(output, '1234'));
      const used = new Date(Date.now() - (3 - index) * 1000);
      await utimes(location(root, key), used, used);
    }
    await expect(stat(location(root, keys[0]))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readFile(location(root, keys[1]), 'utf8')).toBe('1234');
    expect(await readFile(location(root, keys[2]), 'utf8')).toBe('1234');
    await cache.materialize('oversized', output, () => writeFile(output, '123456789'));
    await expect(stat(location(root, 'oversized'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readFile(output, 'utf8')).toBe('123456789');
  });

  it('falls back to extraction if cache storage is unavailable', async () => {
    const unavailable = join(dir, 'not-a-directory');
    await writeFile(unavailable, 'file');
    using brokenCache = new VideoSampleCache({ root: unavailable });
    const output = join(dir, 'frame.jpeg');
    await brokenCache.materialize('frame', output, () => writeFile(output, 'frame'));
    expect(await readFile(output, 'utf8')).toBe('frame');
  });

  it('recovers an abandoned producer lock without publishing partial frames', async () => {
    const hash = videoSampleKey('frame');
    const abandoned = join(root, 'locks', `entry-${hash}`);
    await mkdir(abandoned, { recursive: true });
    const owner = join(abandoned, 'old-owner');
    await writeFile(owner, '');
    const stale = new Date(Date.now() - 120_000);
    await utimes(owner, stale, stale);
    const output = join(dir, 'frame.jpeg');
    await cache.materialize('frame', output, () => writeFile(output, 'complete'));
    expect(await readFile(location(root, 'frame'), 'utf8')).toBe('complete');
    await expect(stat(abandoned)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('does not let a former producer release a replacement producer lock', async () => {
    const firstGate = Promise.withResolvers<void>();
    const firstStarted = Promise.withResolvers<void>();
    const secondGate = Promise.withResolvers<void>();
    const secondStarted = Promise.withResolvers<void>();
    const firstOutput = join(dir, 'first.jpeg');
    const first = cache.materialize('frame', firstOutput, async () => {
      firstStarted.resolve();
      await firstGate.promise;
      await writeFile(firstOutput, 'frame');
    });
    await firstStarted.promise;
    const lock = join(root, 'locks', `entry-${videoSampleKey('frame')}`);
    const owners = await readdir(lock);
    const stale = new Date(Date.now() - 120_000);
    await utimes(join(lock, owners[0]), stale, stale);

    const secondOutput = join(dir, 'second.jpeg');
    const second = cache.materialize('frame', secondOutput, async () => {
      secondStarted.resolve();
      await secondGate.promise;
      await writeFile(secondOutput, 'frame');
    });
    try {
      await secondStarted.promise;
      firstGate.resolve();
      await first;
      const replacementOwners = await readdir(lock);
      expect(replacementOwners).toHaveLength(1);
      expect(replacementOwners[0]).not.toBe(owners[0]);
    } finally {
      firstGate.resolve();
      secondGate.resolve();
      await Promise.all([first, second]);
    }
    await expect(stat(lock)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('disables caching and removes retained samples while preserving consumer copies', async () => {
    const output = join(dir, 'frame.jpeg');
    await cache.materialize('frame', output, () => writeFile(output, 'frame'));
    await cache.configure({ maxSizeGiB: 0, retentionHours: 24 });
    await expect(stat(location(root, 'frame'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readFile(output, 'utf8')).toBe('frame');
    const producer = vi.fn(() => writeFile(output, 'fresh'));
    await cache.materialize('frame', output, producer);
    await cache.materialize('frame', output, producer);
    expect(producer).toHaveBeenCalledTimes(2);
  });

  it('prunes existing entries when retention is reduced', async () => {
    const output = join(dir, 'frame.jpeg');
    await cache.materialize('frame', output, () => writeFile(output, 'frame'));
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
    await utimes(location(root, 'frame'), twoHoursAgo, twoHoursAgo);
    await cache.configure({ maxSizeGiB: 2, retentionHours: 1 });
    await expect(stat(location(root, 'frame'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readFile(output, 'utf8')).toBe('frame');
  });

  it('enforces a smaller budget and can grow the cache again without a restart', async () => {
    const output = join(dir, 'frame.jpeg');
    await cache.materialize('frame', output, () => writeFile(output, '12345678'));
    await cache.configure({ maxSizeGiB: (16 * 4) / 1024 ** 3, retentionHours: 24 });
    await expect(stat(location(root, 'frame'))).rejects.toMatchObject({ code: 'ENOENT' });
    await cache.configure({ maxSizeGiB: (16 * 16) / 1024 ** 3, retentionHours: 24 });
    await cache.materialize('frame', output, () => writeFile(output, '12345678'));
    expect(await readFile(location(root, 'frame'), 'utf8')).toBe('12345678');
  });

  it('bounds waits for another producer and leaves its active lock intact', async () => {
    using impatient = new VideoSampleCache({ root, lockWait: 0 });
    const output = join(dir, 'first.jpeg');
    const { promise: blocked, resolve: release } = Promise.withResolvers<void>();
    const { promise: entered, resolve: started } = Promise.withResolvers<void>();
    const first = cache.materialize('frame', output, async () => {
      started();
      await blocked;
      await writeFile(output, 'first');
    });
    await entered;
    const fallback = join(dir, 'second.jpeg');
    try {
      await impatient.materialize('frame', fallback, () => writeFile(fallback, 'fallback'));
      expect(await readFile(fallback, 'utf8')).toBe('fallback');
      const locks = await readdir(join(root, 'locks'));
      expect(locks.filter((name) => name.startsWith('entry-'))).toHaveLength(1);
    } finally {
      release();
      await first;
    }
  });
});
