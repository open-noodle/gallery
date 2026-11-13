import { galleryAppHeader } from '#lib/gallery/client-header.ts';
import { authManager } from '#lib/managers/auth-manager.svelte.ts';
import { familyAccessManager } from '#lib/managers/family-access-manager.svelte.ts';
import { featureFlagsManager } from '#lib/managers/feature-flags-manager.svelte.ts';
import { queryClient } from '#lib/queries/client.ts';
import { getPublicConfigQuery } from '#lib/queries/config-public.query.ts';
import { getServerConfigQuery } from '#lib/queries/server-info.query.ts';
import { initLanguage } from '#lib/utils.ts';
import { setFetch, setHeaders } from '@immich/sdk';
import { memoize } from 'lodash-es';

type Fetch = typeof fetch;

async function _init(fetch: Fetch) {
  // set event.fetch on the fetch-client used by @immich/sdk
  // https://kit.svelte.dev/docs/load#making-fetch-requests
  // https://github.com/oazapfts/oazapfts/blob/main/README.md#fetch-options
  setFetch(fetch);
  setHeaders(galleryAppHeader);
  await initLanguage();
  const serverConfig = await queryClient.query(getServerConfigQuery());
  await authManager.load();

  if (!serverConfig.maintenanceMode) {
    await Promise.all([queryClient.query(getPublicConfigQuery()), featureFlagsManager.init()]);

    // Gallery-fork: family relationships. Only probed when the server has the feature on, and once the
    // caller is authenticated: `GET /family/me` requires a session, and answers 403 to a viewer without access.
    if (authManager.authenticated && featureFlagsManager.value.familyTree) {
      await familyAccessManager.init();
    }
  }
}

export const init = memoize(_init, () => 'singlevalue');
