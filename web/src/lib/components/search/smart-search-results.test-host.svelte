<script lang="ts">
  import type { FilterState } from '$lib/components/filter-panel/filter-panel';
  import SmartSearchResults from '$lib/components/search/smart-search-results.svelte';

  /**
   * Test host that reproduces how the album pages drive `SmartSearchResults`: `album` is `$state`
   * and the scope is `$derived([album.id])`.
   *
   * This exists because `rerender` from @testing-library/svelte re-fires the component's mount
   * effect even for literally identical props, so it cannot distinguish "the host re-derived the
   * scope" from "the scope changed". Driving a real host is the only way to observe that
   * difference.
   */
  interface Props {
    album: { id: string; name: string };
    filters: FilterState;
  }

  let { album = $bindable(), filters }: Props = $props();

  const searchAlbumIds = $derived([album.id]);
</script>

<button type="button" data-testid="host-rename-album" onclick={() => (album = { ...album, name: `${album.name}!` })}>
  rename
</button>
<button type="button" data-testid="host-switch-album" onclick={() => (album = { id: 'album-2', name: 'other' })}
  >switch</button
>
<SmartSearchResults searchQuery="beach" {filters} albumIds={searchAlbumIds} isShared={false} language="en" />
