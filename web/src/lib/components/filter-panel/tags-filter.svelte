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
  let extraPages = $state(0);

  const INITIAL_SHOW_COUNT = 10;
  const PAGE_SIZE = 50;

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
      extraPages = 0;
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

  /**
   * The list is always truncated — to INITIAL_SHOW_COUNT, or to a first page of search matches — and
   * "Show more" adds one PAGE_SIZE at a time. Never render every match at once: each row mounts a
   * tooltip and measures its own layout, and a one-letter search in a library with thousands of tags
   * froze iOS Safari for ~15s doing exactly that (#1125).
   *
   * Truncation never hides a tag that is actually SELECTED. A library with thousands of tags will
   * essentially never have the active one in the first ten, so a tag filter applied from anywhere
   * other than this list (a contextual filter clicked in the asset viewer, a shared link, typed
   * search) left the panel looking as though nothing was selected. Selected tags are hoisted rather
   * than scrolled to: it needs no measurement, survives a re-fetch, and puts them alongside the
   * orphaned tags already pinned above instead of splitting the selection across two places.
   */
  let visibleLimit = $derived((searchQuery.trim() ? PAGE_SIZE : INITIAL_SHOW_COUNT) + extraPages * PAGE_SIZE);

  let visibleTags = $derived.by(() => {
    if (filteredTags.length <= visibleLimit) {
      return filteredTags;
    }

    const selected = filteredTags.filter((tag) => selectedIds.includes(tag.id));
    if (selected.length === 0) {
      return filteredTags.slice(0, visibleLimit);
    }

    const rest = filteredTags.filter((tag) => !selectedIds.includes(tag.id));
    return [...selected, ...rest].slice(0, Math.max(visibleLimit, selected.length));
  });

  let remainingCount = $derived(Math.max(0, filteredTags.length - visibleTags.length));
  let nextPageCount = $derived(Math.min(PAGE_SIZE, remainingCount));

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
          extraPages = 0;
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
    {#if remainingCount > 0}
      <button
        type="button"
        class="py-1 text-xs font-medium text-immich-primary dark:text-immich-dark-primary"
        onclick={() => extraPages++}
        data-testid="tags-show-more"
      >
        {$t('filter_show_more', { values: { count: nextPageCount } })}
      </button>
    {/if}
  {/if}
</div>
