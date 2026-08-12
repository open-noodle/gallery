const UUID_LENGTH = 36;
const UUID_PATTERN = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;

/**
 * Derivative files are laid out by owner, not by library, so a plain folder walk cannot tell an
 * external-library asset's thumbnail from an uploaded asset's thumbnail. Every asset-derived
 * filename starts with the asset UUID (see StorageCore.getImagePath / getEncodedVideoPath), so the
 * caller can recover the id and check it against the owner's external asset ids.
 *
 * Returns null for files that are not keyed on an asset id (HLS segments, Android motion sidecars).
 */
export const getDerivativeAssetId = (filename: string): string | null => {
  const candidate = filename.slice(0, UUID_LENGTH);
  if (!UUID_PATTERN.test(candidate)) {
    return null;
  }

  const separator = filename[UUID_LENGTH];
  if (separator !== undefined && separator !== '_' && separator !== '.' && separator !== '-') {
    return null;
  }

  return candidate;
};
