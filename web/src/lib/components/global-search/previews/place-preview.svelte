<script lang="ts">
  import { getAssetMediaUrl } from '$lib/utils';
  import { AssetMediaSize, searchAssets, type AssetResponseDto, type PlacesResponseDto } from '@immich/sdk';
  import { Icon } from '@immich/ui';
  import { mdiMapMarker } from '@mdi/js';
  import { t } from 'svelte-i18n';

  interface Props {
    place: PlacesResponseDto;
  }
  let { place }: Props = $props();

  let photos = $state<AssetResponseDto[]>([]);
  let loaded = $state(false);
  let generation = 0;

  $effect(() => {
    const gen = ++generation;
    const cityName = place.name;
    const stateName = place.admin1name;
    photos = [];
    loaded = false;
    const dwell = setTimeout(() => {
      void (async () => {
        const ctrl = new AbortController();
        try {
          const response = await searchAssets(
            {
              metadataSearchDto: {
                city: cityName,
                state: stateName ?? undefined,
                size: 4,
              },
            },
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

  const subtitle = $derived([place.admin1name, place.admin2name].filter(Boolean).join(' · '));
</script>

<div class="flex flex-col gap-3 p-5">
  <div class="flex items-center gap-2">
    <Icon icon={mdiMapMarker} size="1.5em" class="text-gray-500 dark:text-gray-400" />
    <div class="min-w-0 flex-1">
      <div class="truncate text-base font-semibold">{place.name}</div>
      {#if subtitle}
        <div class="truncate text-xs font-normal text-gray-500 dark:text-gray-400">{subtitle}</div>
      {/if}
    </div>
  </div>
  {#if loaded}
    {#if photos.length > 0}
      <div class="flex gap-2">
        {#each photos as photo (photo.id)}
          <img
            src={getAssetMediaUrl({ id: photo.id, size: AssetMediaSize.Thumbnail })}
            alt=""
            class="h-12 w-12 rounded-md object-cover"
          />
        {/each}
      </div>
    {:else}
      <div class="text-xs text-gray-500 dark:text-gray-400">{$t('cmdk_no_photos_here')}</div>
    {/if}
  {/if}
</div>
