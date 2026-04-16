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

<!-- Content-sized preview. Avoids `h-full` / `flex-1` chains that would fight the
     palette row for height. The image is placed inside a fixed-height flex-centered
     frame so its size is fully definite (no percent-height quirks) and the content
     below is anchored predictably. -->
<div class="flex flex-col gap-3 p-5">
  <div class="flex h-[200px] w-full items-center justify-center overflow-hidden rounded-md bg-subtle/40">
    <img
      src={thumbUrl}
      alt={photo.originalFileName ?? ''}
      class="max-h-full max-w-full object-contain"
      loading="lazy"
    />
  </div>
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
