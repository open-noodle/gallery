<script lang="ts">
  import { getAssetMediaUrl } from '$lib/utils';
  import { AssetMediaSize, type AssetResponseDto } from '@immich/sdk';
  import { Button } from '@immich/ui';
  import { t } from 'svelte-i18n';
  import { goto } from '$app/navigation';

  interface Props {
    photo: AssetResponseDto;
  }
  let { photo }: Props = $props();

  const thumbUrl = $derived(
    getAssetMediaUrl({
      id: photo.id,
      size: AssetMediaSize.Preview,
      cacheKey: (photo as { thumbhash?: string }).thumbhash,
    }),
  );
  const dateLine = $derived(
    [photo.exifInfo?.dateTimeOriginal?.slice(0, 10), photo.exifInfo?.city].filter(Boolean).join(' · '),
  );
  const cameraLine = $derived(
    [photo.exifInfo?.make, photo.exifInfo?.fNumber, photo.exifInfo?.exposureTime].filter(Boolean).join(' · '),
  );
</script>

<!-- Content-sized preview. We intentionally avoid `h-full` and `flex-col` stretching
     here: the pane is a flex child of a row with `flex-1` + `max-h-[60vh]`, and
     without a definite parent height the row grows to fit its content — so an
     `h-full` chain inside the preview would force the whole palette taller. Letting
     the preview be content-sized keeps the row within its max-height and the pane's
     `overflow-y-auto` handles any edge-case overflow. -->
<div class="flex flex-col gap-3 p-5">
  <img
    src={thumbUrl}
    alt={photo.originalFileName ?? ''}
    class="mx-auto max-h-[200px] max-w-full rounded-md object-contain"
    loading="lazy"
  />
  <div class="min-w-0">
    <div class="truncate text-base font-semibold">{photo.originalFileName}</div>
    {#if dateLine}
      <div class="truncate text-xs font-normal text-gray-500 dark:text-gray-400">{dateLine}</div>
    {/if}
    {#if cameraLine}
      <div class="truncate text-xs font-normal text-gray-500 dark:text-gray-400">{cameraLine}</div>
    {/if}
  </div>
  <div class="flex gap-2">
    <Button variant="ghost" size="small" onclick={() => goto(`/photos/${photo.id}`)}>
      {$t('cmdk_open')}
    </Button>
  </div>
</div>
