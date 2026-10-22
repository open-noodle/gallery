import type { DiskStorageBackend } from 'src/backends/disk-storage.backend.js';
import type { S3StorageBackend } from 'src/backends/s3-storage.backend.js';
import type { StorageBackend } from 'src/interfaces/storage-backend.interface.js';
import { isDiskPath } from 'src/backends/disk-storage.backend.js';

/**
 * The process's storage backends, set once by StorageService.onBootstrap; StorageService's static getters delegate
 * here. A leaf module: it imports no service, core or repository, so StorageCore's move hook and other low-level code
 * can resolve a backend without importing StorageService, which extends BaseService and so imports nearly everything.
 * Keep it that way: importing storage.core.ts from here would close the cycle storage.core -> s3-file-move -> here.
 */
export const storageBackends: {
  diskBackend: DiskStorageBackend;
  s3Backend: S3StorageBackend | undefined;
  writeBackendType: 'disk' | 's3';
  getWriteBackend(): StorageBackend;
  backendFor(key: string, absoluteDisk?: StorageBackend): StorageBackend;
} = {
  diskBackend: undefined as unknown as DiskStorageBackend,
  s3Backend: undefined,
  writeBackendType: 'disk',

  getWriteBackend(): StorageBackend {
    if (storageBackends.writeBackendType === 's3' && storageBackends.s3Backend) {
      return storageBackends.s3Backend;
    }
    return storageBackends.diskBackend;
  },

  // disk path: disk file (through `absoluteDisk`); relative key: S3, or the media location when S3 is off
  backendFor(key: string, absoluteDisk: StorageBackend = storageBackends.diskBackend): StorageBackend {
    if (isDiskPath(key)) {
      return absoluteDisk;
    }
    return storageBackends.s3Backend ?? storageBackends.diskBackend;
  },
};
