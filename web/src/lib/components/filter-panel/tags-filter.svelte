<script lang="ts">
  import { Icon } from '@immich/ui';
  import { mdiMagnify } from '@mdi/js';
  import { SvelteMap } from 'svelte/reactivity';
  import { t } from 'svelte-i18n';
  import type { TagOption } from './filter-panel';
  import TagFilterRow from './tag-filter-row.svelte';

  interface Props {
    tags: TagOption[];
    selectedIds: string[];
    selectedNames?: Map<string, string>;
    onSelectionChange: (ids: string[]) => void;
  }

  let { tags, selectedIds, selectedNames, onSelectionChange }: Props = $props();

  let searchQuery = $state('');
  let showAll = $state(false);

  const INITIAL_SHOW_COUNT = 10;

  // Cache tag names so orphaned tags can display their name even after removal from results
  const tagNameCache = new SvelteMap<string, string>();
  $effect(() => {
    for (const tag of tags) {
      tagNameCache.set(tag.id, tag.name);
    }
  });

  // Clear search when tags list changes (e.g. temporal filter refetch)
  let previousTagsLength = 0;
  $effect(() => {
    const currentLength = tags.length;
    if (previousTagsLength > 0 && currentLength !== previousTagsLength) {
      searchQuery = '';
      showAll = false;
    }
    previousTagsLength = currentLength;
  });

  // Orphaned tags: selected but not in current results
  let orphanedTags = $derived(
    selectedIds
      .filter((id) => tags.every((t) => t.id !== id))
      .map((id) => ({ id, name: selectedNames?.get(id) ?? tagNameCache.get(id) ?? id })),
  );

  let filteredTags = $derived(
    searchQuery.trim() ? tags.filter((t) => t.name.toLowerCase().includes(searchQuery.trim().toLowerCase())) : tags,
  );

  // When searching, show all results (no truncation); otherwise respect INITIAL_SHOW_COUNT
  let visibleTags = $derived(searchQuery.trim() || showAll ? filteredTags : filteredTags.slice(0, INITIAL_SHOW_COUNT));

  let remainingCount = $derived(Math.max(0, filteredTags.length - INITIAL_SHOW_COUNT));

  function toggleTag(id: string) {
    const isSelected = selectedIds.includes(id);
    if (isSelected) {
      onSelectionChange(selectedIds.filter((tid) => tid !== id));
    } else {
      onSelectionChange([...selectedIds, id]);
    }
  }
</script>

<div data-testid="tags-filter">
  {#if tags.length === 0 && orphanedTags.length === 0}
    <p class="text-sm text-gray-400 dark:text-gray-500" data-testid="tags-empty">{$t('filter_no_tags_available')}</p>
  {:else}
    <!-- Search input -->
    <div class="relative mb-2">
      <div class="pointer-events-none absolute top-1/2 left-2 -translate-y-1/2 text-gray-400 dark:text-gray-500">
        <Icon icon={mdiMagnify} size="14" />
      </div>
      <input
        type="text"
        class="immich-form-input h-8 w-full rounded-lg pr-2 pl-7 text-sm"
        placeholder={$t('search_tags')}
        bind:value={searchQuery}
        oninput={() => {
          showAll = false;
        }}
        data-testid="tags-search-input"
      />
    </div>

    <!-- Orphaned tags (selected but no longer in suggestions) -->
    {#each orphanedTags as tag (tag.id)}
      <TagFilterRow id={tag.id} name={tag.name} checked dimmed onToggle={toggleTag} />
    {/each}

    <!-- Empty search results -->
    {#if filteredTags.length === 0 && searchQuery.trim()}
      <p class="text-sm text-gray-400 dark:text-gray-500" data-testid="tags-no-results">
        {$t('filter_no_matching_tags')}
      </p>
    {/if}

    <!-- Tags list -->
    {#each visibleTags as tag (tag.id)}
      <TagFilterRow id={tag.id} name={tag.name} checked={selectedIds.includes(tag.id)} onToggle={toggleTag} />
    {/each}

    <!-- Show more link -->
    {#if !showAll && remainingCount > 0 && !searchQuery.trim()}
      <button
        type="button"
        class="py-1 text-xs font-medium text-immich-primary dark:text-immich-dark-primary"
        onclick={() => (showAll = true)}
        data-testid="tags-show-more"
      >
        {$t('filter_show_more', { values: { count: remainingCount } })}
      </button>
    {/if}
  {/if}
</div>
