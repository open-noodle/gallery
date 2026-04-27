<script lang="ts">
  import UserPageLayout from '$lib/components/layouts/user-page-layout.svelte';
  import LoadingSpinner from '$lib/components/shared-components/LoadingSpinner.svelte';
  import EmptyPlaceholder from '$lib/components/shared-components/empty-placeholder.svelte';
  import SearchBar from '$lib/elements/SearchBar.svelte';
  import GroupTab from '$lib/elements/GroupTab.svelte';
  import { locale } from '$lib/stores/preferences.store';
  import { handleError } from '$lib/utils/handle-error';
  import { searchMemories, type MemoryResponseDto } from '@immich/sdk';
  import { onMount } from 'svelte';
  import { t } from 'svelte-i18n';
  import MemoryCard from './memory-card.svelte';
  import {
    buildMemoryIndexItems,
    filterMemoryIndexItems,
    groupMemoryIndexItems,
    type MemoryIndexFilter,
  } from './memory-index-utils';
  import type { PageData } from './$types';

  interface Props {
    data: PageData;
  }

  let { data }: Props = $props();

  const filters: MemoryIndexFilter[] = ['all', 'saved'];

  let memories = $state<MemoryResponseDto[]>([]);
  let isLoading = $state(true);
  let hasError = $state(false);
  let searchQuery = $state('');
  let filter = $state<MemoryIndexFilter>('all');

  const items = $derived(buildMemoryIndexItems(memories, { translate: $t, locale: $locale }));
  const filteredItems = $derived(filterMemoryIndexItems(items, { query: searchQuery, filter }));
  const groups = $derived(groupMemoryIndexItems(filteredItems, { locale: $locale }));
  const labels = $derived([$t('memory_filter_all'), $t('memory_filter_saved')]);
  const description = $derived(
    !isLoading && !hasError ? `(${filteredItems.length.toLocaleString($locale)})` : undefined,
  );

  onMount(() => {
    const loadMemories = async () => {
      try {
        memories = await searchMemories({});
      } catch (error) {
        hasError = true;
        handleError(error, $t('memories_error'));
      } finally {
        isLoading = false;
      }
    };

    void loadMemories();
  });
</script>

<UserPageLayout title={data.meta.title} {description}>
  {#snippet buttons()}
    <div class="flex h-10 items-center gap-2">
      <div class="w-56 sm:w-72">
        <SearchBar placeholder={$t('memories_search_placeholder')} bind:name={searchQuery} showLoadingSpinner={false} />
      </div>
      <div class="h-full">
        <GroupTab
          label={$t('memories')}
          {filters}
          {labels}
          selected={filter}
          onSelect={(selected) => (filter = selected as MemoryIndexFilter)}
        />
      </div>
    </div>
  {/snippet}

  <section class="mx-auto flex w-full max-w-screen-2xl flex-col gap-8 px-2 py-6 sm:px-4 lg:px-8">
    {#if isLoading}
      <div class="flex min-h-80 items-center justify-center">
        <LoadingSpinner size="large" />
      </div>
    {:else if hasError}
      <EmptyPlaceholder text={$t('memories_error')} fullWidth class="mx-auto max-w-xl" />
    {:else if filteredItems.length === 0}
      <EmptyPlaceholder text={$t('memories_empty')} fullWidth class="mx-auto max-w-xl" />
    {:else}
      {#each groups as group (group.key)}
        <section class="space-y-3" aria-labelledby={`memories-${group.key}`}>
          <h2 id={`memories-${group.key}`} class="text-sm font-medium tracking-normal text-gray-600 dark:text-gray-300">
            {group.label}
          </h2>

          <div
            class="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5"
            data-testid="memory-group-grid"
          >
            {#each group.items as item, index (item.memory.id)}
              <MemoryCard {item} preload={group.key === groups[0]?.key && index < 8} />
            {/each}
          </div>
        </section>
      {/each}
    {/if}
  </section>
</UserPageLayout>
