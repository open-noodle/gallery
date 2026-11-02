import { BadRequestException } from '@nestjs/common';
import { AuthDto } from 'src/dtos/auth.dto.js';
import { Permission } from 'src/enum.js';
import { AccessRepository } from 'src/repositories/access.repository.js';
import { requireAccess } from 'src/utils/access.js';

/**
 * Validates the shared-space scope of a legacy-shape search request (metadata, statistics, random, large assets,
 * smart and smart facets) and checks the caller may read the requested space.
 *
 * Fork RBAC (H-1): trash is an owner-private state; a shared-space-scoped search must never enumerate
 * another member's trashed assets. Reject withDeleted / trashedAfter / trashedBefore / isOffline when a
 * space scope (spaceId or withSharedSpaces) is set — mirrors timeBucketChecks (timeline.service.ts) and
 * the caller-proof SQL gate in searchAssetBuilder. trashedAfter/trashedBefore/isOffline implicitly flip
 * withDeleted (searchAssetBuilder :676), so they are rejected too. StatisticsSearchDto has no withDeleted
 * field (optional here → undefined); it is still reachable via the implicit-flip params.
 */
export const assertGallerySearchScope = async (
  access: AccessRepository,
  auth: AuthDto,
  dto: {
    spaceId?: string;
    withSharedSpaces?: boolean;
    spacePersonIds?: string[];
    withDeleted?: boolean;
    trashedAfter?: Date;
    trashedBefore?: Date;
    isOffline?: boolean;
  },
): Promise<void> => {
  const spaceScope = !!dto.spaceId || !!dto.withSharedSpaces;
  const wantsTrashOrOffline = !!dto.withDeleted || !!dto.trashedAfter || !!dto.trashedBefore || !!dto.isOffline;
  if (spaceScope && wantsTrashOrOffline) {
    throw new BadRequestException('Trashed and offline assets are not available when searching a shared space');
  }

  if (dto.spaceId && dto.withSharedSpaces) {
    throw new BadRequestException('Cannot use both spaceId and withSharedSpaces');
  }

  if (dto.spacePersonIds?.length && !dto.spaceId) {
    throw new BadRequestException('spacePersonIds requires spaceId');
  }

  if (dto.spaceId) {
    await requireAccess(access, { auth, permission: Permission.SharedSpaceRead, ids: [dto.spaceId] });
  }
};
