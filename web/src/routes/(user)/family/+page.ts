import {
  FamilyAccessLevel,
  getClusters,
  getMyRoot,
  getUnions,
  type FamilyClusterResponseDto,
  type FamilyGraphResponseDto,
} from '@immich/sdk';
import { authenticate } from '$lib/utils/auth';
import { getFormatter } from '$lib/utils/i18n';
import type { PageLoad } from './$types';

// D8.5/A8: `GET /family/unions` is paginated (E49), but the canvas needs the whole visible graph
// at once to lay itself out — a person's union on page 2 can be the very thing that makes their
// generation resolvable from the root on page 1. 200 keeps this to a small, bounded number of
// round trips even for a large family; nothing here is cached across requests (D8.3).
const FAMILY_UNIONS_PAGE_SIZE = 200;

type FamilyGraph = Pick<FamilyGraphResponseDto, 'unions' | 'identities'>;

async function loadFullGraph(): Promise<FamilyGraph> {
  const unions: FamilyGraphResponseDto['unions'] = [];
  let identities: FamilyGraphResponseDto['identities'] = {};
  let page = 1;

  for (;;) {
    const response = await getUnions({ page, size: FAMILY_UNIONS_PAGE_SIZE });
    unions.push(...response.unions);
    identities = { ...identities, ...response.identities };
    if (!response.hasNextPage) {
      return { unions, identities };
    }
    page += 1;
  }
}

export const load = (async ({ url }) => {
  await authenticate(url);
  const $t = await getFormatter();

  let clusters: FamilyClusterResponseDto[] = [];
  let rootId: string | null = null;
  let graph: FamilyGraph = { unions: [], identities: {} };
  let granted = true;
  // A6: `GET /family/me` reports the caller's OWN effective access level, which is the only
  // signal that says whether they may write. `view` is read-only; the canvas hides its editing
  // affordances entirely rather than disabling them.
  let canContribute = false;

  try {
    // Nothing above is assigned until every call has succeeded, so a failure part-way through
    // leaves the page with its "no access" defaults rather than a half-loaded graph.
    const [clusterList, rootResponse] = await Promise.all([getClusters(), getMyRoot()]);
    graph = await loadFullGraph();
    clusters = clusterList;
    rootId = rootResponse.rootIdentityId;
    canContribute = rootResponse.access === FamilyAccessLevel.Contribute;
  } catch {
    // A1/A12: `GET /family/clusters` and `GET /family/me` both require `FamilyRead` and 403 for
    // a viewer whose effective access is `none`. The page renders no surface at all for them
    // (+page.svelte), not an error state — same rule as the sidebar entry.
    granted = false;
  }

  return {
    granted,
    canContribute,
    clusters,
    rootId,
    unions: graph.unions,
    identities: graph.identities,
    meta: {
      title: $t('family_canvas_title'),
    },
  };
}) satisfies PageLoad;
