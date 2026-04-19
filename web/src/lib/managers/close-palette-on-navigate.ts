import { globalSearchManager } from '$lib/managers/global-search-manager.svelte';

export function closePaletteOnNavigate() {
  if (globalSearchManager.isOpen) {
    globalSearchManager.close();
  }
}
