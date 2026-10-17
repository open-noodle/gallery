<script lang="ts">
  import { page } from '$app/state';
  import type { ValueFilter } from '$lib/gallery/asset-viewer/detail-panel-filters';
  import { authManager } from '$lib/managers/auth-manager.svelte';
  import { applyContextualFilter, resolveFilterTarget } from '$lib/utils/filter-target';
  import { IconButton } from '@immich/ui';
  import { mdiMagnify } from '@mdi/js';
  import type { Snippet } from 'svelte';
  import type { ClassValue } from 'svelte/elements';
  import { t } from 'svelte-i18n';

  /**
   * A detail panel value that, clicked, filters the surface the viewer was opened on by it. Plain
   * content when there is no `filter`, and on a shared link (R4/E2: no timeline to land on).
   */
  type Props = {
    label: string;
    filter?: ValueFilter;
    /** Also offer 🔍 "search everywhere", except on /photos where it is a no-op (E5). */
    searchEverywhere?: boolean;
    class?: ClassValue;
    children: Snippet;
  };

  const { label, filter, searchEverywhere = false, class: className, children }: Props = $props();

  const canFilter = $derived(!authManager.isSharedLink);
  const isOnPhotos = $derived(resolveFilterTarget(page.url)?.kind === 'photos');
</script>

{#if canFilter && filter}
  {@const { value, patch } = filter}
  <button
    type="button"
    class={['text-left hover:text-primary', className]}
    aria-label="{label}: {value}"
    onclick={() => applyContextualFilter(patch)}
  >
    {@render children()}
  </button>
  {#if searchEverywhere && !isOnPhotos}
    <IconButton
      icon={mdiMagnify}
      aria-label="{$t('search_everywhere')}: {value}"
      size="small"
      shape="round"
      color="secondary"
      variant="ghost"
      onclick={() => applyContextualFilter(patch, { global: true })}
    />
  {/if}
{:else}
  <span class={className}>{@render children()}</span>
{/if}
