import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { copyFile, mkdir, readdir, rename, rm, rmdir, stat, unlink, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const SHARDS = '0123456789abcdef';
const CACHE_TTL = 24 * 60 * 60 * 1000;
const CACHE_BYTES = 2 * 1024 ** 3;
const LOCK_STALE = 60_000;

export const videoSampleKey = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

/**
Disposable, host-local samples shared by human and pet video jobs. Copies belong to the caller; the cache never
exposes its files to a detector's unlink/overwrite. See specs/2026-11-21-shared-video-samples-design.md.
*/
export class VideoSampleCache {
  private root: string;
  private ttl: number;
  private shardBytes: number;
  private lockWait: number;
  private sweep?: NodeJS.Timeout;

  constructor(options: { root?: string; ttl?: number; maxBytes?: number; lockWait?: number } = {}) {
    this.root = options.root ?? join(tmpdir(), 'gallery-video-samples-v1');
    this.ttl = options.ttl ?? CACHE_TTL;
    this.shardBytes = Math.floor((options.maxBytes ?? CACHE_BYTES) / SHARDS.length);
    this.lockWait = options.lockWait ?? 30_000;
  }

  /** Changes apply to subsequent reads/publications, including jobs already running in this worker. */
  async configure(settings: { maxSizeGiB: number; retentionHours: number }): Promise<void> {
    const shardBytes = Math.floor((settings.maxSizeGiB * 1024 ** 3) / SHARDS.length);
    const ttl = settings.retentionHours * 60 * 60 * 1000;
    const changed = shardBytes !== this.shardBytes || ttl !== this.ttl;
    this.shardBytes = shardBytes;
    this.ttl = ttl;
    if (shardBytes > 0) {
      this.startSweep();
    } else {
      this[Symbol.dispose]();
    }
    if (changed || shardBytes === 0) {
      await this.prune();
    }
  }

  /** A failure to read or write the cache leaves normal extraction available. Producer errors still propagate. */
  async materialize(key: string, output: string, produce: () => Promise<void>): Promise<boolean> {
    if (this.shardBytes <= 0) {
      await produce();
      return false;
    }
    this.startSweep();
    const hash = videoSampleKey(key);
    const shard = join(this.root, hash[0]);
    const cached = join(shard, `${hash}.sample`);
    let hit = false;
    const acquired = await this.withLock(`entry-${hash}`, async () => {
      await this.withLock(`shard-${hash[0]}`, async () => {
        try {
          const info = await stat(cached);
          if (this.shardBytes > 0 && info.size > 0 && Date.now() - info.mtimeMs < this.ttl) {
            await copyFile(cached, output, constants.COPYFILE_FICLONE);
            const now = new Date();
            await utimes(cached, now, now);
            hit = true;
          }
        } catch {
          // A missing, expired or unreadable entry is a miss.
        }
      });
      if (hit) {
        return;
      }

      await produce();
      // Store only complete, non-empty samples. Publishing is optional; extraction above is not.
      await this.withLock(`shard-${hash[0]}`, async () => {
        const staging = join(shard, `${hash}.${randomUUID()}.tmp`);
        try {
          const { size } = await stat(output);
          if (size <= 0 || size > this.shardBytes) {
            return;
          }
          await mkdir(shard, { recursive: true, mode: 0o700 });
          await this.pruneShard(shard, this.shardBytes - size, cached);
          await copyFile(output, staging, constants.COPYFILE_FICLONE);
          await rename(staging, cached);
        } catch {
          // Disk pressure or an unavailable cache must not fail a detection job.
        } finally {
          await unlink(staging).catch(() => {});
        }
      });
    });
    if (!acquired) {
      await produce();
    }
    return hit;
  }

  /** Also runs during idle periods after the first use, so expired samples do not require another video job. */
  async prune(): Promise<void> {
    for (const name of await readdir(join(this.root, 'locks')).catch(() => [] as string[])) {
      await this.removeStaleOwners(join(this.root, 'locks', name));
    }
    for (const shard of SHARDS) {
      await this.withLock(`shard-${shard}`, () => this.pruneShard(join(this.root, shard), this.shardBytes));
    }
  }

  [Symbol.dispose]() {
    clearInterval(this.sweep);
    this.sweep = undefined;
  }

  private startSweep() {
    this.sweep ??= setInterval(() => void this.prune().catch(() => {}), 10 * 60 * 1000).unref();
  }

  private async pruneShard(shard: string, budget: number, replacing?: string) {
    const entries = await readdir(shard).catch(() => [] as string[]);
    const kept: { path: string; bytes: number; used: number }[] = [];
    let bytes = 0;
    for (const name of entries) {
      const path = join(shard, name);
      const info = await stat(path).catch(() => {});
      if (!info) {
        continue;
      }
      if (path === replacing || Date.now() - info.mtimeMs >= this.ttl || name.endsWith('.tmp')) {
        await unlink(path);
      } else {
        kept.push({ path, bytes: info.size, used: info.mtimeMs });
        bytes += info.size;
      }
    }
    for (const entry of kept.sort((a, b) => a.used - b.used)) {
      if (bytes <= budget) {
        break;
      }
      await unlink(entry.path);
      bytes -= entry.bytes;
    }
  }

  private async removeStaleOwners(lock: string) {
    // Heartbeats belong to individual tokens, not the replaceable lock directory. Also collects orphan claims.
    for (const owner of await readdir(lock).catch(() => [] as string[])) {
      const path = join(lock, owner);
      const info = await stat(path).catch(() => {});
      if (info && Date.now() - info.mtimeMs > LOCK_STALE) {
        await unlink(path).catch(() => {});
      }
    }
    await rmdir(lock).catch(() => {});
  }

  /**
  Atomic directory rename publishes a NON-EMPTY lock, including its unique owner token. Recovery and release remove
  only that token and rmdir only an empty directory, so a former owner cannot remove a replacement owner's lock.
  Waits are bounded: a crashed/unresponsive worker can cost duplicate extraction, never a stuck detection job.
  */
  private async withLock(name: string, run: () => Promise<void>): Promise<boolean> {
    const locks = join(this.root, 'locks');
    const token = randomUUID();
    const claim = join(locks, `.claim-${token}`);
    const lock = join(locks, name);
    let acquired = false;
    try {
      await mkdir(locks, { recursive: true, mode: 0o700 });
      await mkdir(claim, { mode: 0o700 });
      await writeFile(join(claim, token), '', { mode: 0o600 });
      const deadline = Date.now() + this.lockWait;
      do {
        try {
          await rename(claim, lock);
          acquired = true;
          break;
        } catch (error) {
          if (!['EEXIST', 'ENOTEMPTY'].includes((error as NodeJS.ErrnoException).code ?? '')) {
            return false;
          }
        }
        await this.removeStaleOwners(lock);
        if (Date.now() >= deadline) {
          return false;
        }
        await delay(25);
      } while (!acquired);
    } catch {
      return false;
    } finally {
      if (!acquired) {
        await rm(claim, { recursive: true, force: true }).catch(() => {});
      }
    }

    const owner = join(lock, token);
    const heartbeat = setInterval(() => {
      const now = new Date();
      void utimes(owner, now, now).catch(() => {});
    }, LOCK_STALE / 3).unref();
    try {
      await run();
      return true;
    } finally {
      clearInterval(heartbeat);
      await unlink(owner).catch(() => {});
      await rmdir(lock).catch(() => {});
    }
  }
}

export const videoSampleCache = new VideoSampleCache();
