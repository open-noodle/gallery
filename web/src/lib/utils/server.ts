import { defaults } from '@immich/sdk';
import { memoize } from 'lodash-es';
import { authManager } from '$lib/managers/auth-manager.svelte';
import { familyAccessManager } from '$lib/managers/family-access-manager.svelte';
import { featureFlagsManager } from '$lib/managers/feature-flags-manager.svelte';
import { serverConfigManager } from '$lib/managers/server-config-manager.svelte';
import { initLanguage } from '$lib/utils';

type Fetch = typeof fetch;

async function _init(fetch: Fetch) {
  // set event.fetch on the fetch-client used by @immich/sdk
  // https://kit.svelte.dev/docs/load#making-fetch-requests
  // https://github.com/oazapfts/oazapfts/blob/main/README.md#fetch-options
  defaults.fetch = fetch;
  await initLanguage();
  await serverConfigManager.init();
  await authManager.load();

  if (!serverConfigManager.value.maintenanceMode) {
    await featureFlagsManager.init();

    // Gallery-fork: family relationships. Only probed once the caller is authenticated — the
    // underlying `GET /family/me` call requires a session, and running it on e.g. the login page
    // would just be a guaranteed 401 for no benefit.
    if (authManager.authenticated) {
      await familyAccessManager.init();
    }
  }
}

export const init = memoize(_init, () => 'singlevalue');
