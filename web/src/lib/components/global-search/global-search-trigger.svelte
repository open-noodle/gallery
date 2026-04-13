<script lang="ts">
  import { featureFlagsManager } from '$lib/managers/feature-flags-manager.svelte';
  import { globalSearchManager } from '$lib/managers/global-search-manager.svelte';
  import { Icon } from '@immich/ui';
  import { mdiMagnify } from '@mdi/js';
  import { t } from 'svelte-i18n';
</script>

{#if featureFlagsManager.valueOrUndefined?.search}
  <button
    type="button"
    onclick={() => globalSearchManager.open()}
    class="flex w-full items-center gap-2 rounded-lg border border-gray-200 bg-subtle/60 px-3 py-2 text-sm text-gray-500 hover:bg-subtle dark:border-gray-700 dark:text-gray-400"
  >
    <Icon icon={mdiMagnify} size="1em" aria-hidden />
    <span class="flex-1 text-left">{$t('cmdk_search')}</span>
    <kbd
      class="rounded-sm border border-gray-200 bg-subtle/60 px-1.5 py-0.5 font-mono text-[11px] font-medium text-gray-500 dark:border-gray-700 dark:text-gray-400"
      >⌘K</kbd
    >
  </button>
{/if}
