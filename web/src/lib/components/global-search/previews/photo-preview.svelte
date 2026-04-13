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
  <!-- Letterbox the image inside a fixed-aspect frame: `object-contain` shows the full
       image without cropping, `bg-subtle/40` fills the non-image area when the source
       aspect doesn't match 4:3. Previously we used `object-cover` which cropped both
       landscape (sides) and portrait (top/bottom) sources. -->
  <div class="aspect-[4/3] w-full overflow-hidden rounded-md bg-subtle/40">
    <img
      src={thumbUrl}
      alt={photo.originalFileName ?? ''}
      class="h-full w-full object-contain"
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
  <div class="mt-auto flex gap-2">
    <Button variant="ghost" size="small" onclick={() => goto(`/photos/${photo.id}`)}>
      {$t('cmdk_open')}
    </Button>
  </div>
</div>
