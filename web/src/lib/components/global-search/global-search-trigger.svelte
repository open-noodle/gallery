<script lang="ts">
  import { featureFlagsManager } from '$lib/managers/feature-flags-manager.svelte';
  import { globalSearchManager } from '$lib/managers/global-search-manager.svelte';
  import { Icon } from '@immich/ui';
  import { mdiMagnify } from '@mdi/js';
  import { t } from 'svelte-i18n';

  // Platform-aware hotkey label: ⌘K on Mac / iOS, Ctrl+K everywhere else. csr=true
  // in +layout.ts so `navigator` is always defined client-side; the value never
  // changes mid-session, so read it once at module load.
  const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPod|iPad/.test(navigator.platform);
  const hotkeyLabel = isMac ? '⌘K' : 'Ctrl+K';
</script>

{#if featureFlagsManager.valueOrUndefined?.search}
  <button
    type="button"
    onclick={() => globalSearchManager.open()}
    aria-label={$t('cmdk_quick_search')}
    data-testid="cmdk-trigger"
    class="group/cmdk flex items-center gap-2 rounded-full border border-primary/40 bg-primary/5 px-3 py-1.5 text-sm font-medium text-primary shadow-sm transition-all duration-200 hover:border-primary/70 hover:bg-primary/15 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
  >
    <Icon icon={mdiMagnify} size="1em" aria-hidden />
    <span class="hidden md:inline">{$t('cmdk_quick_search')}</span>
    <kbd
      class="rounded border border-primary/40 bg-primary/10 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-primary"
      >{hotkeyLabel}</kbd
    >
  </button>
{/if}
