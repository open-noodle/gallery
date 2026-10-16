/** Apple platforms open search with ⌘K; everything else uses Ctrl+K (see global-search.svelte). */
export const isApplePlatform = (platform: string = typeof navigator === 'undefined' ? '' : navigator.platform) =>
  /Mac|iPhone|iPod|iPad/.test(platform);

/** The label for the search hotkey on this (or the given) platform. */
export const searchHotkeyLabel = (platform?: string) => (isApplePlatform(platform) ? '⌘K' : 'Ctrl+K');
