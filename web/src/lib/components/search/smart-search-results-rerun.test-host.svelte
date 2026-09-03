<script lang="ts">
  import type { FilterState } from '$lib/components/filter-panel/filter-panel';
  import SmartSearchResults from '$lib/components/search/smart-search-results.svelte';
  import type { AssetResponseDto } from '@immich/sdk';

  /**
   * Test host that reproduces how the searchable pages (`/photos`, `/recently-added`, a space
   * timeline) drive `SmartSearchResults`: the HOST owns `results` and mounts the component only
   * while there is a query, so the loaded assets outlive an unmount.
   *
   * `rerender` from @testing-library/svelte re-fires the component's mount effect, so it cannot
   * tell "the host re-ran the search" from "the component was mounted fresh" — the difference
   * #1052 turns on. Driving a real host is the only way to observe it.
   */
  interface Props {
    filters: FilterState;
  }

  let { filters = $bindable() }: Props = $props();

  let searchQuery = $state('beach');
  let reloadToken = $state(0);
  let results = $state<AssetResponseDto[]>([]);
  let isLoading = $state(false);

  /**
   * How the real pages commit a search from the URL: every searchable page's URL effect resets its
   * own `isLoading` to false in the same synchronous block that assigns the new query. The component
   * has to re-assert loading after that, or the blanked grid falls through to the "no results" empty
   * state while the replacement is still in flight.
   */
  const commitSearchFromUrl = (query: string) => {
    isLoading = false;
    searchQuery = query;
  };
</script>

<button type="button" data-testid="host-clear-search" onclick={() => (searchQuery = '')}>clear</button>
<button type="button" data-testid="host-new-search" onclick={() => (searchQuery = 'mountain')}>search</button>
<button type="button" data-testid="host-commit-url-search" onclick={() => commitSearchFromUrl('mountain')}>
  commit
</button>
<button type="button" data-testid="host-add-filter" onclick={() => (filters = { ...filters, city: 'Berlin' })}>
  filter
</button>
<button type="button" data-testid="host-reload" onclick={() => reloadToken++}>reload</button>

<!-- The gallery virtualizes to zero height under happy-dom, so the loaded assets are only
     observable through the host's own copy of them. -->
<span data-testid="host-result-ids">{results.map((asset) => asset.id).join(',')}</span>

{#if searchQuery}
  <SmartSearchResults
    bind:results
    bind:isLoading
    {searchQuery}
    {filters}
    {reloadToken}
    isShared={false}
    language="en"
  />
{/if}
