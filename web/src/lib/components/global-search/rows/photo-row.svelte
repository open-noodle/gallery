<script lang="ts">
  import { getAssetMediaUrl } from '$lib/utils';
  import { AssetMediaSize, type AssetResponseDto } from '@immich/sdk';

  interface Props {
    item: AssetResponseDto;
  }
  let { item }: Props = $props();

  const subtitle = $derived(
    [item.exifInfo?.dateTimeOriginal?.slice(0, 10), item.exifInfo?.city].filter(Boolean).join(' · '),
  );
  const thumbUrl = $derived(
    getAssetMediaUrl({
      id: item.id,
      size: AssetMediaSize.Thumbnail,
      cacheKey: (item as { thumbhash?: string }).thumbhash,
    }),
  );
</script>

<div
  class="flex h-[52px] items-center gap-3 rounded-lg px-3 py-2 transition-colors duration-[80ms] ease-out group-data-[selected]:bg-primary/10"
>
  <img src={thumbUrl} alt="" class="h-10 w-10 rounded-md object-cover" loading="lazy" />
  <div class="min-w-0 flex-1">
    <div class="truncate text-sm font-medium">{item.originalFileName}</div>
    {#if subtitle}
      <div class="truncate text-xs text-gray-500 dark:text-gray-400">{subtitle}</div>
    {/if}
  </div>
</div>
