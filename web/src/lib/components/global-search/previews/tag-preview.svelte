<script lang="ts">
  import { getAssetMediaUrl } from '$lib/utils';
  import { AssetMediaSize, searchAssets, type AssetResponseDto, type TagResponseDto } from '@immich/sdk';
  import { t } from 'svelte-i18n';

  interface Props {
    tag: TagResponseDto;
  }
  let { tag }: Props = $props();

  let photos = $state<AssetResponseDto[]>([]);
  let loaded = $state(false);
  let generation = 0;

  $effect(() => {
    const gen = ++generation;
    const tagId = tag.id;
    photos = [];
    loaded = false;
    const dwell = setTimeout(() => {
      void (async () => {
        const ctrl = new AbortController();
        try {
          const response = await searchAssets(
            { metadataSearchDto: { tagIds: [tagId], size: 6 } },
            { signal: ctrl.signal },
          );
          if (gen !== generation) {
            return;
          }
          photos = response.assets.items;
        } catch {
          // ignore
        } finally {
          if (gen === generation) {
            loaded = true;
          }
        }
      })();
    }, 300);
    return () => clearTimeout(dwell);
  });
</script>

<div class="p-5">
  <div class="text-base font-semibold">{tag.name}</div>
  {#if loaded && photos.length === 0}
    <div class="mt-3 text-xs text-gray-500 dark:text-gray-400">{$t('cmdk_no_tagged_photos')}</div>
  {:else if loaded}
    <div class="mt-3 grid grid-cols-3 gap-2">
      {#each photos as photo (photo.id)}
        <img
          src={getAssetMediaUrl({ id: photo.id, size: AssetMediaSize.Thumbnail })}
          alt=""
          class="h-[72px] w-[72px] rounded-md object-cover"
        />
      {/each}
    </div>
  {/if}
</div>
