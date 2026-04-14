import { goto } from '$app/navigation';
import { serverConfigManager } from '$lib/managers/server-config-manager.svelte';
import { maintenanceCreateUrl, maintenanceReturnUrl, maintenanceShouldRedirect } from '$lib/utils/maintenance';
import { init } from '$lib/utils/server';
import { commandPaletteManager } from '@immich/ui';
import type { LayoutLoad } from './$types';

export const ssr = false;
export const csr = true;

export const load = (async ({ fetch, url }) => {
  let error;
  try {
    await init(fetch);

    if (maintenanceShouldRedirect(serverConfigManager.value.maintenanceMode, url)) {
      await goto(
        serverConfigManager.value.maintenanceMode ? maintenanceCreateUrl(url) : maintenanceReturnUrl(url.searchParams),
      );
    }
  } catch (initError) {
    error = initError;
  }

  // Enable the @immich/ui command palette manager *only* for its #handleKeydown
  // dispatcher, which fires per-page <CommandPaletteDefaultProvider> action
  // shortcuts (F=favorite, I=info, face-editor keys, etc.). The upstream's
  // Ctrl+K / Cmd+K / `/` palette-open shortcuts are stripped at the package
  // level via patches/@immich__ui@0.69.0.patch so Gallery owns those keys for
  // its own cmdk palette (GlobalSearchManager). Without this enable() call,
  // every page-level keyboard action silently dies.
  commandPaletteManager.enable();

  return {
    error,
    meta: {
      title: 'Immich',
    },
  };
}) satisfies LayoutLoad;
