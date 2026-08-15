import { SharedSpaceRole } from 'src/enum';

/**
 * Ordering of shared-space roles. Extracted from shared-space.service.ts so that
 * other fork services (the guessing game) can gate on role without duplicating -
 * and drifting from - the ordering.
 */
export const SHARED_SPACE_ROLE_HIERARCHY: Record<SharedSpaceRole, number> = {
  [SharedSpaceRole.Viewer]: 0,
  [SharedSpaceRole.Editor]: 1,
  [SharedSpaceRole.Owner]: 2,
};

export const getSharedSpaceRoleScore = (role: string): number =>
  SHARED_SPACE_ROLE_HIERARCHY[role as SharedSpaceRole] ?? 0;

export const hasSharedSpaceRole = (role: string, minimum: SharedSpaceRole): boolean =>
  getSharedSpaceRoleScore(role) >= SHARED_SPACE_ROLE_HIERARCHY[minimum];
