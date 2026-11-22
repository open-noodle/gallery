<script lang="ts">
  import { searchHotkeyLabel } from '#lib/gallery/search/search-hotkey.ts';
  import { globalSearchManager } from '#lib/managers/global-search-manager.svelte.ts';
  import { t } from 'svelte-i18n';

  const { originalPath }: { originalPath?: string } = $props();
</script>

<div
  class="flex flex-wrap items-center gap-2 rounded-xl border border-gray-200/80 bg-white/90 px-4 py-2 text-sm text-gray-700 shadow-sm dark:border-gray-700 dark:bg-immich-dark-gray/90 dark:text-gray-200"
>
  {#if originalPath}
    <span>{$t('full_path_or_folder')}: <bdi>{originalPath}</bdi></span>
  {:else}
    <span>{$t('search_legacy_notice', { values: { hotkey: searchHotkeyLabel() } })}</span>
  {/if}
  <button
    type="button"
    class="font-medium text-primary hover:text-primary/80 focus-visible:outline-2 focus-visible:outline-primary"
    onclick={() => globalSearchManager.open()}
  >
    {$t('search_open_palette')}
  </button>
</div>
