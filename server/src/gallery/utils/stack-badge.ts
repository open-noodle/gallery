import { sql } from 'kysely';

/**
 * `HAVING` for the timeline's stack projection: a stack is reported (and badged) only while at least two of its
 * photos are outside the trash. A stack of two with one trashed otherwise came back as `[stackId, "1"]` and the
 * web showed a stack badge and expand action for a single photo (#1187). The stack row itself is kept, so a
 * restore puts the photo back into it.
 */
export const stackHasSeveralLiveAssets = sql<boolean>`count(*) >= 2`;
