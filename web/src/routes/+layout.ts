import { goto } from '$app/navigation';
import { serverConfigManager } from '$lib/managers/server-config-manager.svelte';
import { maintenanceCreateUrl, maintenanceReturnUrl, maintenanceShouldRedirect } from '$lib/utils/maintenance';
import { init } from '$lib/utils/server';
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

  // commandPaletteManager.enable() is intentionally NOT called — we reclaim Ctrl+K /
  // Cmd+K / `/` for the Gallery cmdk palette (GlobalSearchManager). Per-page
  // <CommandPaletteDefaultProvider> mounts still compile but their shortcut is dead.
  // Re-enable if per-page @immich/ui action palettes are needed in the future.

  return {
    error,
    meta: {
      title: 'Immich',
    },
  };
}) satisfies LayoutLoad;
