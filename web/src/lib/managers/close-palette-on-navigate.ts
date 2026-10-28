import { globalSearchManager } from '#lib/managers/global-search-manager.svelte.ts';

export function closePaletteOnNavigate() {
  if (!globalSearchManager.isOpen || globalSearchManager.consumeKeepOpenOnNextNavigate()) {
    return;
  }

  if (globalSearchManager.isOpen) {
    globalSearchManager.close();
  }
}
