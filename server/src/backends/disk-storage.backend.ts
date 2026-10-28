import { Dirent, constants, createReadStream } from 'node:fs';
import { mkdir, opendir, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { ServeOptions, ServeStrategy, StorageBackend } from 'src/interfaces/storage-backend.interface.js';
import { StorageRepository } from 'src/repositories/storage.repository.js';

/**
A stored path that names a disk file: absolute, in upstream's layout. A relative key belongs to the configured
storage backend (S3, or the media location when S3 is off). StorageService.backendFor decides on it; sites
that run upstream's own disk code for disk files test it too.
*/
export const isDiskPath = (key: string) => isAbsolute(key);

/**
exists / readAll / delete go through StorageRepository: they replace direct StorageRepository
calls in upstream code paths, which keeps those paths (and the specs that mock the repository)
unchanged for disk files.
*/
export class DiskStorageBackend implements StorageBackend {
  constructor(
    private mediaLocation: string,
    private storageRepository: StorageRepository,
  ) {}

  private resolvePath(key: string): string {
    if (isDiskPath(key)) {
      return key;
    }
    // an absolute-only backend (see BackendMediaServer.backendFor): a relative key would resolve against
    // the cwd, and deletePrefix would then remove whatever it found there
    if (!this.mediaLocation) {
      throw new Error(`Disk backend without a media location cannot resolve relative key ${key}`);
    }
    return join(this.mediaLocation, key);
  }

  // `metadata` is accepted for parity with the interface and ignored: a disk file carries no
  // content type, and the HTTP layer decides it per route when the file is served.
  async put(key: string, source: Readable | Buffer, _metadata?: { contentType?: string }): Promise<void> {
    const fullPath = this.resolvePath(key);
    await mkdir(dirname(fullPath), { recursive: true });

    if (Buffer.isBuffer(source)) {
      await writeFile(fullPath, source);
    } else {
      // Through the repository, not a bare `createWriteStream`: it opens the stream with `flush: true`,
      // which fsyncs before close. The database backup needs that — the dump is renamed to its real name
      // and then uploaded as soon as this resolves, so an unflushed tail would promote a truncated file
      // after a host crash. It is also what the class comment above promises: upstream's own write path.
      await pipeline(source, this.storageRepository.createWriteStream(fullPath));
    }
  }

  async get(key: string): Promise<{ stream: Readable; contentType?: string; length?: number }> {
    const fullPath = this.resolvePath(key);
    const fileStat = await stat(fullPath);
    return {
      stream: createReadStream(fullPath),
      length: fileStat.size,
    };
  }

  readAll(key: string): Promise<Buffer> {
    return this.storageRepository.readFile(this.resolvePath(key));
  }

  exists(key: string, options?: { readable?: boolean }): Promise<boolean> {
    return this.storageRepository.checkFileExists(
      this.resolvePath(key),
      options?.readable ? constants.R_OK : constants.F_OK,
    );
  }

  delete(key: string): Promise<void> {
    return this.storageRepository.unlink(this.resolvePath(key));
  }

  async deletePrefix(prefix: string): Promise<void> {
    await rm(this.resolvePath(prefix), { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }

  async list(prefix: string): Promise<Array<{ key: string; size: number }>> {
    const folder = this.resolvePath(prefix);
    let entries: Dirent[];
    try {
      entries = await readdir(folder, { withFileTypes: true });
    } catch (error: any) {
      // a backups folder that has never been written to is an empty listing, not a failure
      if (error.code === 'ENOENT') {
        return [];
      }
      throw error;
    }

    const results: Array<{ key: string; size: number }> = [];
    for (const entry of entries) {
      // Deliberately not `entry.isFile()`: that is false for a symlink, and a backups folder is a
      // plausible place to find one (an admin pointing at a bigger volume). `stat` follows the link, so a
      // symlinked file is listed — and therefore visible to retention — while directories still are not.
      if (!entry.isFile() && !entry.isSymbolicLink()) {
        continue;
      }
      try {
        const entryStat = await stat(join(folder, entry.name));
        if (!entryStat.isFile()) {
          continue;
        }
        results.push({ key: join(prefix, entry.name), size: entryStat.size });
      } catch (error: any) {
        // same race as getFolderSize: a file a delete job removed mid-walk is simply not listed. A
        // dangling symlink lands here too, and is likewise simply not listed.
        if (error.code !== 'ENOENT') {
          throw error;
        }
      }
    }

    return results;
  }

  /**
  Move a file within this backend. Deliberately NOT on `StorageBackend`: S3 has no move, only a
  copy-then-delete that is neither atomic nor cheap for a multi-gigabyte object, and the one
  caller (the database backup's `.tmp` promote) only ever moves a file on the staging disk.
  */
  rename(fromKey: string, toKey: string): Promise<void> {
    return this.storageRepository.rename(this.resolvePath(fromKey), this.resolvePath(toKey));
  }

  async getPrefixUsage(prefix: string, shouldCount?: (filename: string) => boolean): Promise<number> {
    return this.getFolderSize(this.resolvePath(prefix), shouldCount);
  }

  getServeStrategy(key: string, _options: ServeOptions): Promise<ServeStrategy> {
    return Promise.resolve({ type: 'file', path: this.resolvePath(key) });
  }

  downloadToTemp(key: string): Promise<{ tempPath: string; cleanup: () => Promise<void> }> {
    return Promise.resolve({
      tempPath: this.resolvePath(key),
      cleanup: () => Promise.resolve(),
    });
  }

  getReadableUrl(key: string): Promise<string> {
    return Promise.resolve(this.resolvePath(key));
  }

  private async getFolderSize(folder: string, shouldCount?: (filename: string) => boolean): Promise<number> {
    let total = 0;
    let dir;
    try {
      dir = await opendir(folder);
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        return 0;
      }
      throw error;
    }

    for await (const entry of dir) {
      const entryPath = join(folder, entry.name);
      if (entry.isDirectory()) {
        total += await this.getFolderSize(entryPath, shouldCount);
      } else if (entry.isFile() && (!shouldCount || shouldCount(entry.name))) {
        try {
          const entryStat = await stat(entryPath);
          total += entryStat.size;
        } catch (error: any) {
          // The nightly scan walks a live tree that delete jobs are writing to; a file that
          // disappears mid-walk must not abort the whole user's sync.
          if (error.code !== 'ENOENT') {
            throw error;
          }
        }
      }
    }

    return total;
  }
}
