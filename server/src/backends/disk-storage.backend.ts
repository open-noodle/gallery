import { constants, createReadStream, createWriteStream } from 'node:fs';
import { mkdir, opendir, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { ServeOptions, ServeStrategy, StorageBackend } from 'src/interfaces/storage-backend.interface.js';
import { StorageRepository } from 'src/repositories/storage.repository.js';

/**
 * exists / readAll / delete go through StorageRepository: they replace direct StorageRepository
 * calls in upstream code paths, which keeps those paths (and the specs that mock the repository)
 * unchanged for disk files.
 */
export class DiskStorageBackend implements StorageBackend {
  constructor(
    private mediaLocation: string,
    private storageRepository: StorageRepository,
  ) {}

  private resolvePath(key: string): string {
    // Absolute paths are legacy disk assets — return as-is
    if (isAbsolute(key)) {
      return key;
    }
    // an absolute-only backend (see BaseService.backendFor): a relative key would resolve against
    // the cwd, and deletePrefix would then remove whatever it found there
    if (!this.mediaLocation) {
      throw new Error(`Disk backend without a media location cannot resolve relative key ${key}`);
    }
    return join(this.mediaLocation, key);
  }

  async put(key: string, source: Readable | Buffer): Promise<void> {
    const fullPath = this.resolvePath(key);
    await mkdir(dirname(fullPath), { recursive: true });

    if (Buffer.isBuffer(source)) {
      await writeFile(fullPath, source);
    } else {
      const writeStream = createWriteStream(fullPath);
      await pipeline(source, writeStream);
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
