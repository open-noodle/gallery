<script lang="ts">
  import { Route } from '$lib/route';
  import { getAssetMediaUrl } from '$lib/utils';
  import { AssetMediaSize } from '@immich/sdk';
  import { Icon } from '@immich/ui';
  import { mdiHeart } from '@mdi/js';
  import { t } from 'svelte-i18n';
  import type { MemoryIndexItem } from './memory-index-utils';

  interface Props {
    item: MemoryIndexItem;
    preload?: boolean;
  }

  let { item, preload = false }: Props = $props();

  let firstAsset = $derived(item.memory.assets[0]);
  let collageAssets = $derived(item.memory.assets.slice(0, item.memory.assets.length >= 3 ? 4 : 1));
  let hasCollage = $derived(item.memory.assets.length >= 3);
  let loading: 'eager' | 'lazy' = $derived(preload ? 'eager' : 'lazy');

  const getCollageImageClass = (index: number, count: number) => {
    const base = 'size-full object-cover transition duration-200 group-hover:scale-[1.02]';

    if (index === 0) {
      return `col-span-2 row-span-2 ${base}`;
    }

    if (count === 3 || index === 3) {
      return `col-span-2 ${base}`;
    }

    return base;
  };
</script>

{#if firstAsset}
  <a
    href={Route.memoryViewer({ id: firstAsset.id, source: 'history' })}
    aria-label={item.title}
    data-testid="memory-card"
    class="group block overflow-hidden rounded-lg border border-gray-200 bg-white transition hover:border-gray-300 hover:shadow-sm dark:border-gray-800 dark:bg-gray-950 dark:hover:border-gray-700"
  >
    <div class="relative aspect-[4/3] overflow-hidden bg-gray-100 dark:bg-gray-900">
      {#if hasCollage}
        <div class="grid size-full grid-cols-4 grid-rows-2 gap-0.5 bg-gray-200 dark:bg-gray-800">
          {#each collageAssets as asset, index (asset.id)}
            <img
              src={getAssetMediaUrl({ id: asset.id, size: AssetMediaSize.Thumbnail })}
              alt=""
              {loading}
              class={getCollageImageClass(index, collageAssets.length)}
            />
          {/each}
        </div>
      {:else}
        <img
          src={getAssetMediaUrl({ id: firstAsset.id, size: AssetMediaSize.Thumbnail })}
          alt=""
          {loading}
          class="size-full object-cover transition duration-200 group-hover:scale-[1.02]"
        />
      {/if}

      {#if item.memory.isSaved}
        <div
          class="absolute start-2 top-2 flex size-7 items-center justify-center rounded-full bg-black/45 text-white shadow-sm backdrop-blur-sm"
          data-testid="memory-saved-indicator"
        >
          <Icon icon={mdiHeart} size="15" />
        </div>
      {/if}
    </div>

    <div class="space-y-1 p-3">
      <div>
        <p class="truncate text-sm font-medium text-gray-950 dark:text-white" title={item.title}>{item.title}</p>
        {#if item.subtitle}
          <p class="truncate text-xs text-gray-500 dark:text-gray-400" title={item.subtitle}>{item.subtitle}</p>
        {/if}
      </div>

      <div class="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
        <span>{item.dateLabel}</span>
        <span aria-hidden="true">&middot;</span>
        <span>{$t('memory_assets_count', { values: { count: item.memory.assets.length } })}</span>
      </div>
    </div>
  </a>
{/if}
