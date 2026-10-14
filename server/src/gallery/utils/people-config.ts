import type { SystemConfig } from 'src/dtos/config.dto.js';
import type { MergeAuthorizer } from 'src/services/identity-merge-propagation.service.js';
import type { UserMetadataItem } from 'src/types.js';
import { createCrossOwnerMergeAuthorizer } from 'src/utils/merge-policy.js';
import { getPreferences } from 'src/utils/preferences.js';

/**
 * Callers resolve the config BEFORE the merge transaction opens and pass it in. The authorizer runs inside that
 * transaction while it holds the instance-wide advisory lock; reading config there would query a second pool
 * connection that a saturated pool cannot grant, deadlocking every merge. Handing over an already-resolved value
 * keeps the transaction free of any `this.db` I/O.
 */
export const crossOwnerMergeAuthorizer = (
  { server }: Pick<SystemConfig, 'server'>,
  dto: { confirmCrossOwner?: boolean },
): MergeAuthorizer => createCrossOwnerMergeAuthorizer(() => Promise.resolve(server), dto);

/**
 * The caller's People face threshold. The per-user `people.minimumFaces` preference (default 3 via
 * `getPreferences`) takes precedence over the ML config default. The People list, its statistics and its face
 * statistics all resolve it here, so they agree with each other and with the list's SQL (`getAllForUser`,
 * `person.repository.ts`), which reads the same preference with a literal `3` fallback; neither path double-filters.
 */
export const resolveMinimumFaceCount = (
  { machineLearning }: Pick<SystemConfig, 'machineLearning'>,
  metadata: UserMetadataItem[],
): number => getPreferences(metadata).people.minimumFaces ?? machineLearning.facialRecognition.minFaces;
