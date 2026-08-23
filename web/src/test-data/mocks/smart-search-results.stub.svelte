<script lang="ts">
  import type { FilterState } from '$lib/components/filter-panel/filter-panel';

  interface Props {
    isLoading?: boolean;
    searchQuery?: string;
    filters?: FilterState;
    withSharedSpaces?: boolean;
    spaceId?: string;
    albumIds?: string[];
    language?: string;
    total?: number;
    // $bindable on the real component, so a host that binds it expects to be able to read loaded
    // results back. Spreading it onto the div instead made any behaviour keyed on results — the
    // selection toolbar acting on the search grid — unobservable.
    results?: unknown[];
    isShared?: boolean;
    space?: { id: string; canWrite: boolean };
    [key: string]: unknown;
  }

  let {
    isLoading = $bindable(false),
    searchQuery = '',
    filters,
    withSharedSpaces,
    spaceId,
    albumIds,
    language = '',
    total,
    results = $bindable([]),
    isShared,
    space,
    ...rest
  }: Props = $props();
</script>

<div
  {...rest}
  data-testid="smart-search-results"
  data-loading={String(isLoading)}
  data-search-query={searchQuery}
  data-sort-order={filters?.sortOrder ?? ''}
  data-is-favorite={String(filters?.isFavorite)}
  data-filter-favorite={String(filters?.isFavorite)}
  data-filter-not-in-album={String(filters?.isNotInAlbum)}
  data-filter-in-album={String(filters?.isInAlbum)}
  data-filter-person-ids={filters?.personIds.join(',') ?? ''}
  data-filter-tag-ids={filters?.tagIds.join(',') ?? ''}
  data-filter-media-type={filters?.mediaType ?? ''}
  data-filter-rating={filters?.rating ?? ''}
  data-filter-date-after={filters?.dateAfter ?? ''}
  data-filter-date-before={filters?.dateBefore ?? ''}
  data-filter-city={filters?.city ?? ''}
  data-filter-country={filters?.country ?? ''}
  data-filter-make={filters?.make ?? ''}
  data-filter-model={filters?.model ?? ''}
  data-with-shared-spaces={String(withSharedSpaces)}
  data-space-id={spaceId ?? ''}
  data-album-ids={albumIds?.join(',') ?? ''}
  data-result-count={results.length}
  data-is-shared={String(isShared)}
  data-space={JSON.stringify(space ?? null)}
  data-country={filters?.country ?? ''}
  data-language={language}
  data-total={total ?? ''}
></div>
