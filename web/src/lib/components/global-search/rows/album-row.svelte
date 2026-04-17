<script lang="ts">
  import { getAssetMediaUrl } from '$lib/utils';
  import { Icon } from '@immich/ui';
  import { mdiImageMultipleOutline } from '@mdi/js';
  import { AssetMediaSize, type AlbumNameDto } from '@immich/sdk';
  import { t } from 'svelte-i18n';

  interface Props {
    item: AlbumNameDto;
    isPending: boolean;
  }
  let { item, isPending }: Props = $props();

  const thumbUrl = $derived(
    item.albumThumbnailAssetId
      ? getAssetMediaUrl({ id: item.albumThumbnailAssetId, size: AssetMediaSize.Thumbnail })
      : '',
  );
</script>

<div
  class={[
    'flex h-[52px] items-center gap-3 rounded-lg px-3 py-2 transition-colors duration-[80ms] ease-out group-data-[selected]:bg-primary/10',
    isPending && 'opacity-50',
  ]}
>
  {#if thumbUrl}
    <img src={thumbUrl} alt="" class="h-10 w-10 rounded-md object-cover" loading="lazy" />
  {:else}
    <div class="flex h-10 w-10 items-center justify-center rounded-md bg-subtle/40" aria-hidden="true">
      <Icon icon={mdiImageMultipleOutline} size="1.125em" class="text-gray-500 dark:text-gray-400" />
    </div>
  {/if}
  <div class="min-w-0 flex-1">
    <div class="truncate text-sm font-medium">{item.albumName}</div>
    <div class="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
      <span class="truncate">{$t('items_count', { values: { count: item.assetCount } })}</span>
      {#if item.shared}
        <span
          class="shrink-0 rounded-full bg-subtle/60 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-gray-600 dark:text-gray-300"
        >
          {$t('shared')}
        </span>
      {/if}
    </div>
  </div>
  {#if isPending}
    <span
      data-testid="pending-spinner"
      class="h-4 w-4 shrink-0 rounded-full border-2 border-gray-300 border-t-primary dark:border-gray-600 dark:border-t-primary"
      style:animation="spin 0.8s linear infinite"
      aria-hidden="true"
    ></span>
  {/if}
</div>

<style>
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
</style>
