<script lang="ts">
  import { SortOrder } from '$lib/stores/preferences.store';
  import { spaceAlbumViewSettings } from '$lib/stores/space-album-view-settings.store';
  import { getSpaceAlbumSortLabels, type SpaceAlbumSortOptionMetadata } from '$lib/utils/space-album-sort';
  import { t } from 'svelte-i18n';

  // The space table's counterpart of AlbumsTableHeader (#972): the same sort button and arrow, reading
  // and writing the space album view settings instead of the /albums ones.
  interface Props {
    option: SpaceAlbumSortOptionMetadata;
  }

  let { option }: Props = $props();

  const labels = $derived(getSpaceAlbumSortLabels($t));

  const handleSort = () => {
    if ($spaceAlbumViewSettings.sortBy === option.id) {
      $spaceAlbumViewSettings.sortOrder =
        $spaceAlbumViewSettings.sortOrder === SortOrder.Asc ? SortOrder.Desc : SortOrder.Asc;
    } else {
      $spaceAlbumViewSettings.sortBy = option.id;
      $spaceAlbumViewSettings.sortOrder = option.defaultOrder;
    }
  };
</script>

<th class="text-sm font-medium {option.columnStyle}" data-testid="space-albums-table-header-{option.id}">
  <button
    type="button"
    class="rounded-lg p-2 hover:bg-immich-dark-primary hover:dark:bg-immich-dark-primary/50"
    onclick={handleSort}
  >
    {#if $spaceAlbumViewSettings.sortBy === option.id}
      {#if $spaceAlbumViewSettings.sortOrder === SortOrder.Desc}
        &#8595;
      {:else}
        &#8593;
      {/if}
    {/if}
    {labels[option.id]}
  </button>
</th>
