<script lang="ts">
  import type { FilterState } from '$lib/components/filter-panel/filter-panel';
  import { Route } from '$lib/route';
  import { Icon } from '@immich/ui';
  import { mdiMapOutline } from '@mdi/js';
  import { t } from 'svelte-i18n';

  interface Props {
    spaceId: string;
    /**
     * The space's LIVE filter state. Required on purpose: this link used to be a hard-coded
     * `/map?spaceId=<id>`, which silently dropped every active filter and the search term on the
     * way to the map (#767a). Making the prop required means a new call site cannot re-introduce
     * that by simply forgetting it.
     */
    filters: FilterState;
    searchQuery?: string;
  }

  let { spaceId, filters, searchQuery }: Props = $props();

  const mapUrl = $derived(Route.map({ spaceId, query: searchQuery, filters }));
</script>

<a
  href={mapUrl}
  class="flex items-center justify-center rounded-full p-2 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-200"
  aria-label={$t('map')}
>
  <Icon icon={mdiMapOutline} size="24" />
</a>
