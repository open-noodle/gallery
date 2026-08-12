import { StorageCore } from 'src/cores/storage.core';
import { UserAdmin } from 'src/database';
import { StorageFolder } from 'src/enum';
import { StorageBackend } from 'src/interfaces/storage-backend.interface';
import { AssetRepository } from 'src/repositories/asset.repository';
import { StorageRepository } from 'src/repositories/storage.repository';

const UUID_LENGTH = 36;
const UUID_PATTERN = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;

/**
 * Derivative files are laid out by owner, not by library, so a plain folder walk cannot tell an
 * external-library asset's thumbnail from an uploaded asset's thumbnail. Every asset-derived
 * filename starts with the asset UUID (see StorageCore.getImagePath / getEncodedVideoPath), so the
 * caller can recover the id and check it against the owner's external asset ids.
 *
 * Returns null for files that are not keyed on an asset id (HLS segments, Android motion sidecars).
 * Note: person thumbnails also match the <uuid>. pattern and ARE returned; the caller filters by
 * membership in the owner's external-asset-id set, so person ids are naturally excluded.
 */
export const getDerivativeAssetId = (filename: string): string | null => {
  const candidate = filename.slice(0, UUID_LENGTH);
  if (!UUID_PATTERN.test(candidate)) {
    return null;
  }

  const separator = filename[UUID_LENGTH];
  if (separator !== undefined && separator !== '_' && separator !== '.') {
    return null;
  }

  // Normalise to lowercase: Postgres always returns uuid columns lowercased, so
  // getExternalAssetIds' set membership check would silently miss an uppercase-cased
  // extraction. Filenames are built from asset.id (already lowercase) so this never
  // fires today, but keep it — do not go back to preserving the source casing.
  return candidate.toLowerCase();
};

type PhysicalUsageDeps = {
  user: Pick<UserAdmin, 'id' | 'storageLabel'>;
  assetRepository: AssetRepository;
  storageRepository: StorageRepository;
  s3: StorageBackend | undefined;
};

/**
 * Total bytes this user occupies on disk and in S3: originals, profile images, thumbnails and
 * transcodes. Upstream counts only originals and excludes external-library assets entirely
 * (user.repository.ts syncUsage, `libraryId is null`); derivative files are laid out by ownerId
 * with no library dimension, so external assets are filtered out here by asset id instead.
 */
export const computePhysicalUsage = async ({
  user,
  assetRepository,
  storageRepository,
  s3,
}: PhysicalUsageDeps): Promise<number> => {
  const externalAssetIds = await assetRepository.getExternalAssetIds(user.id);
  const shouldCount = (filename: string) => {
    const assetId = getDerivativeAssetId(filename);
    return assetId === null || !externalAssetIds.has(assetId);
  };

  // Originals (library/, upload/) and profile images are never external, so they are unfiltered.
  const disk = await Promise.all([
    storageRepository.getFolderSize(StorageCore.getLibraryFolder(user)),
    storageRepository.getFolderSize(StorageCore.getFolderLocation(StorageFolder.Upload, user.id)),
    storageRepository.getFolderSize(StorageCore.getFolderLocation(StorageFolder.Profile, user.id)),
    storageRepository.getFolderSize(StorageCore.getFolderLocation(StorageFolder.Thumbnails, user.id), shouldCount),
    storageRepository.getFolderSize(StorageCore.getFolderLocation(StorageFolder.EncodedVideo, user.id), shouldCount),
  ]);
  let total = disk.reduce((total, value) => total + value, 0);

  if (s3) {
    const remote = await Promise.all([
      s3.getPrefixUsage(`${StorageFolder.Upload}/${user.id}/`),
      s3.getPrefixUsage(`${StorageFolder.Profile}/${user.id}/`),
      s3.getPrefixUsage(`${StorageFolder.Thumbnails}/${user.id}/`, shouldCount),
      s3.getPrefixUsage(`${StorageFolder.EncodedVideo}/${user.id}/`, shouldCount),
    ]);
    total += remote.reduce((total, value) => total + value, 0);
  }

  return total;
};
