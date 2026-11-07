<script lang="ts">
  import type { ValueFilter } from '#lib/gallery/asset-viewer/detail-panel-filters.ts';
  import { authManager } from '#lib/managers/auth-manager.svelte.ts';
  import { applyContextualFilter, resolveFilterTarget } from '#lib/utils/filter-target.ts';
  import { IconButton } from '@immich/ui';
  import { mdiMagnify } from '@mdi/js';
  import type { Snippet } from 'svelte';
  import { t } from 'svelte-i18n';
  import type { ClassValue } from 'svelte/elements';
  import { page } from '$app/state';

  /**
  A detail panel value that, clicked, filters the surface the viewer was opened on by it. Plain
  content when there is no `filter`, and on a shared link (R4/E2: no timeline to land on).
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
  const isOnPhotos = $derived(resolveFilterTarget(new URL(page.url.href))?.kind === 'photos');
</script>

{#if canFilter && filter}
  {const { value, patch } = $derived(filter)}
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
