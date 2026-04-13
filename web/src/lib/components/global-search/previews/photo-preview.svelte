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

<div class="flex h-full flex-col gap-3 p-5">
  <!-- Cap the image via `max-h` directly on the <img>. We intentionally avoid the
       `aspect-ratio` + `h-full` pattern: percent heights require a definite parent
       height, and `aspect-ratio` isn't always considered definite for that resolution,
       so `h-full` would collapse to the image's natural height and overflow an
       `overflow-hidden` container. `max-h-[200px] max-w-full object-contain` keeps
       the natural aspect intact, caps the image at 200px tall within the pane width,
       and centers it horizontally via `mx-auto`. -->
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
  <div class="mt-auto flex gap-2">
    <Button variant="ghost" size="small" onclick={() => goto(`/photos/${photo.id}`)}>
      {$t('cmdk_open')}
    </Button>
  </div>
</div>
