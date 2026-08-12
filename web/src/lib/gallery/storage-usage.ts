import type { ServerConfigDto, UserAdminResponseDto } from '@immich/sdk';

type StorageSpaceInput = {
  user: UserAdminResponseDto;
  authenticated: boolean;
  serverInfo?: { diskSizeRaw: number; diskUseRaw: number };
  serverConfig?: ServerConfigDto;
};

/**
 * Which pair of numbers the sidebar meter shows.
 *
 * A user with no quota sees whole-server disk figures — upstream behaviour, deliberately kept.
 * A user with a quota sees their own usage, reading either the upstream originals-only column or
 * the fork's physical column depending on the server-wide display toggle.
 */
export const getStorageSpace = ({ user, authenticated, serverInfo, serverConfig }: StorageSpaceInput) => {
  const hasQuota = user.quotaSizeInBytes !== null;
  if (!hasQuota || !authenticated) {
    return { usedBytes: serverInfo?.diskUseRaw || 0, availableBytes: serverInfo?.diskSizeRaw || 0 };
  }

  const includeDerivatives = serverConfig?.storageUsageIncludesDerivatives ?? false;
  const used = includeDerivatives ? user.physicalUsageInBytes : user.quotaUsageInBytes;

  return { usedBytes: used || 0, availableBytes: user.quotaSizeInBytes || 0 };
};
