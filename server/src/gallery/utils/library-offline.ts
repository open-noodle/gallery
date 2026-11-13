import { R_OK } from 'node:constants';
import path from 'node:path';
import { JobName, JobStatus } from 'src/enum.js';
import { AssetRepository } from 'src/repositories/asset.repository.js';
import { LibraryRepository } from 'src/repositories/library.repository.js';
import { StorageRepository } from 'src/repositories/storage.repository.js';
import { JobOf } from 'src/types.js';

// Filesystem notifications are hints: a disappearing mount must never authorize deletion.
export async function reconcileLibraryUnlink(
  job: JobOf<JobName.LibraryRemoveAsset>,
  libraries: LibraryRepository,
  assets: AssetRepository,
  storage: StorageRepository,
) {
  const library = await libraries.get(job.libraryId);
  if (!library || library.deletedAt) {
    return JobStatus.Skipped;
  }
  const accessibleRoots = await Promise.all(
    library.importPaths.map(async (root) => {
      try {
        const stat = await storage.stat(root);
        return stat.isDirectory() && (await storage.checkFileExists(root, R_OK)) ? root : null;
      } catch {
        return null;
      }
    }),
  );
  for (const originalPath of job.paths) {
    const accessible = accessibleRoots.some((root) => {
      if (!root) return false;
      const relative = path.relative(root, originalPath);
      return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
    });
    if (!accessible) continue;
    try {
      await storage.stat(originalPath);
      continue;
    } catch {
      // Preserve the record and its media even on permission or transient I/O failures.
    }
    const asset = await assets.getByLibraryIdAndOriginalPath(job.libraryId, originalPath);
    if (asset && !asset.isOffline) {
      await assets.updateAll([asset.id], { isOffline: true });
    }
  }
  return JobStatus.Success;
}

export const externalAssetOfflineUpdate = { isOffline: true };
