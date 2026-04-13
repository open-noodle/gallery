<script lang="ts" generics="T extends { id?: string; latitude?: number; longitude?: number }">
  import type { ProviderStatus } from '$lib/managers/global-search-manager.svelte';
  import type { Snippet } from 'svelte';
  import { t } from 'svelte-i18n';
  import { Command } from 'bits-ui';
  import Skeleton from '$lib/elements/Skeleton.svelte';

  interface Props {
    heading: string;
    status: ProviderStatus<T>;
    renderRow: Snippet<[T]>;
    idPrefix: 'photo' | 'person' | 'place' | 'tag';
    onActivate: (item: T) => void;
    onSeeAll?: () => void;
  }
  let { heading, status, renderRow, idPrefix, onActivate, onSeeAll }: Props = $props();

  function itemKey(item: T): string {
    if (item.id !== undefined) {
      return `${idPrefix}:${item.id}`;
    }
    if (idPrefix === 'place' && item.latitude !== undefined && item.longitude !== undefined) {
      return `${idPrefix}:${item.latitude.toFixed(4)}:${item.longitude.toFixed(4)}`;
    }
    return '';
  }
</script>

{#if status.status !== 'idle'}
  <Command.Group class="mb-4">
    <Command.GroupHeading
      class="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400"
    >
      {heading}
    </Command.GroupHeading>
    <Command.GroupItems>
      {#if status.status === 'loading'}
        {#each [0, 1, 2] as i (i)}
          <div class="mx-3 mb-1">
            <Skeleton height={52} />
          </div>
        {/each}
      {:else if status.status === 'ok'}
        {#each status.items as item (itemKey(item))}
          <Command.Item value={itemKey(item)} onSelect={() => onActivate(item)}>
            {@render renderRow(item)}
          </Command.Item>
        {/each}
        {#if onSeeAll && status.total > status.items.length}
          <button
            type="button"
            onclick={onSeeAll}
            class="mt-1 flex w-full items-center justify-between px-3 py-2 text-xs font-medium text-primary tabular-nums"
          >
            <span>{$t('cmdk_see_all', { values: { count: status.total } })}</span>
            <span aria-hidden="true">→</span>
          </button>
        {/if}
      {:else if status.status === 'timeout'}
        <div class="px-3 py-2 text-xs text-gray-500 dark:text-gray-400">{$t('cmdk_slow_results')}</div>
      {:else if status.status === 'error'}
        <div class="px-3 py-2 text-xs text-gray-500 dark:text-gray-400">
          {#if status.message === 'tag_cache_too_large'}
            {$t('cmdk_tag_cache_too_large')}
          {:else}
            {$t('cmdk_couldnt_load', { values: { entity: heading } })}
          {/if}
        </div>
      {/if}
    </Command.GroupItems>
  </Command.Group>
{/if}
