<script lang="ts">
  import { getAssetMediaUrl } from '$lib/utils';
  import { AssetMediaSize, type PersonResponseDto } from '@immich/sdk';
  import { t } from 'svelte-i18n';

  interface Props {
    item: PersonResponseDto & { numberOfAssets?: number; faceAssetId?: string };
  }
  let { item }: Props = $props();

  const thumbUrl = $derived(
    item.faceAssetId ? getAssetMediaUrl({ id: item.faceAssetId, size: AssetMediaSize.Thumbnail }) : '',
  );
</script>

<div
  class="flex h-[52px] items-center gap-3 rounded-lg px-3 py-2 transition-colors duration-[80ms] ease-out group-data-[selected]:bg-primary/10"
>
  {#if thumbUrl}
    <img src={thumbUrl} alt="" class="h-10 w-10 rounded-full object-cover" loading="lazy" />
  {:else}
    <div class="h-10 w-10 rounded-full bg-subtle/40" aria-hidden="true"></div>
  {/if}
  <div class="min-w-0 flex-1">
    <div class="truncate text-sm font-medium">{item.name || $t('cmdk_unnamed_person')}</div>
    {#if item.numberOfAssets !== undefined}
      <div class="text-xs text-gray-500 dark:text-gray-400">{item.numberOfAssets} photos</div>
    {/if}
  </div>
</div>
