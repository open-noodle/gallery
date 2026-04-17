<script lang="ts">
  import { goto } from '$app/navigation';
  import { getAssetMediaUrl } from '$lib/utils';
  import { AssetMediaSize, type AlbumNameDto } from '@immich/sdk';
  import { Button, Icon } from '@immich/ui';
  import { mdiImageMultipleOutline } from '@mdi/js';
  import { DateTime } from 'luxon';
  import { t } from 'svelte-i18n';

  interface Props {
    item: AlbumNameDto;
  }
  let { item }: Props = $props();

  const thumbUrl = $derived(
    item.albumThumbnailAssetId
      ? getAssetMediaUrl({ id: item.albumThumbnailAssetId, size: AssetMediaSize.Preview })
      : '',
  );

  const countLabel = $derived($t('cmdk_preview_item_count', { values: { count: item.assetCount } }));

  const formatMonthYear = (iso: string) => DateTime.fromISO(iso, { zone: 'UTC' }).toFormat('LLL yyyy');

  const dateRange = $derived.by(() => {
    if (!item.startDate || !item.endDate) {
      return '';
    }
    const start = formatMonthYear(item.startDate);
    const end = formatMonthYear(item.endDate);
    return start === end ? start : `${start} – ${end}`;
  });

  const metadataLine = $derived(dateRange ? `${countLabel} · ${dateRange}` : countLabel);
</script>

<div data-cmdk-preview-album class="flex flex-col gap-3 p-5">
  {#if thumbUrl}
    <div class="flex h-[180px] w-full items-center justify-center overflow-hidden rounded-md bg-subtle/40">
      <img src={thumbUrl} alt="" class="max-h-full max-w-full object-contain" loading="lazy" />
    </div>
  {:else}
    <div
      data-testid="album-preview-placeholder"
      class="flex h-[180px] w-full items-center justify-center rounded-md bg-subtle/40"
      aria-hidden="true"
    >
      <Icon icon={mdiImageMultipleOutline} size="2em" class="text-gray-500 dark:text-gray-400" />
    </div>
  {/if}

  <div class="min-w-0">
    <div class="flex items-center gap-2">
      <div class="truncate text-sm font-medium">{item.albumName}</div>
      {#if item.shared}
        <span
          class="shrink-0 rounded-full bg-subtle/60 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-gray-600 dark:text-gray-300"
        >
          {$t('shared')}
        </span>
      {/if}
    </div>
    <div class="truncate text-xs font-normal text-gray-500 dark:text-gray-400">{metadataLine}</div>
  </div>

  <div class="flex gap-2">
    <Button variant="ghost" size="small" onclick={() => goto(`/albums/${item.id}`)}>{$t('cmdk_open')}</Button>
  </div>
</div>
