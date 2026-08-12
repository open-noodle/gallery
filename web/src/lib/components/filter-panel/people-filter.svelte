<script lang="ts">
  import { Icon } from '@immich/ui';
  import { mdiMagnify } from '@mdi/js';
  import { SvelteMap } from 'svelte/reactivity';
  import { t } from 'svelte-i18n';
  import type { PersonOption } from './filter-panel';

  interface Props {
    people: PersonOption[];
    selectedIds: string[];
    selectedNames?: Map<string, string>;
    onSelectionChange: (ids: string[]) => void;
    emptyText?: string;
  }

  let { people, selectedIds, selectedNames, onSelectionChange, emptyText }: Props = $props();

  let searchQuery = $state('');
  let showAll = $state(false);

  const INITIAL_SHOW_COUNT = 5;

  const personCache = new SvelteMap<string, PersonOption>();
  $effect(() => {
    for (const person of people) {
      personCache.set(person.id, person);
    }
  });

  // Orphaned people: selected but not in current results
  let orphanedPeople = $derived(
    selectedIds
      .filter((id) => people.every((p) => p.id !== id))
      .map((id) => {
        const cached = personCache.get(id);
        return {
          id,
          name: selectedNames?.get(id) ?? cached?.name ?? id,
          thumbnailUrl: cached?.thumbnailUrl,
          isOrphaned: true,
        } as PersonOption & { isOrphaned: boolean };
      }),
  );

  let filteredPeople = $derived(
    searchQuery.trim() ? people.filter((p) => p.name.toLowerCase().includes(searchQuery.trim().toLowerCase())) : people,
  );

  // Selected people are hoisted out of the truncated head for the same reason tags-filter hoists
  // selected tags: with the head only five rows long, a person filter applied from anywhere but this
  // list (a contextual filter clicked in the viewer, a shared link, typed search) was invisible here.
  let visiblePeople = $derived.by(() => {
    if (searchQuery.trim() || showAll) {
      return filteredPeople;
    }

    const selected = filteredPeople.filter((person) => selectedIds.includes(person.id));
    if (selected.length === 0) {
      return filteredPeople.slice(0, INITIAL_SHOW_COUNT);
    }

    const rest = filteredPeople.filter((person) => !selectedIds.includes(person.id));
    return [...selected, ...rest].slice(0, Math.max(INITIAL_SHOW_COUNT, selected.length));
  });

  let remainingCount = $derived(filteredPeople.length - visiblePeople.length);

  function getInitial(name: string): string {
    return name.charAt(0).toUpperCase();
  }

  function getAvatarGradient(name: string): string {
    const gradients = [
      'linear-gradient(135deg, #667eea, #764ba2)',
      'linear-gradient(135deg, #f093fb, #f5576c)',
      'linear-gradient(135deg, #4facfe, #00f2fe)',
      'linear-gradient(135deg, #43e97b, #38f9d7)',
      'linear-gradient(135deg, #fa709a, #fee140)',
      'linear-gradient(135deg, #a18cd1, #fbc2eb)',
    ];
    let hash = 0;
    for (const ch of name) {
      hash = ch.codePointAt(0)! + ((hash << 5) - hash);
    }
    return gradients[Math.abs(hash) % gradients.length];
  }

  function togglePerson(id: string) {
    const isSelected = selectedIds.includes(id);
    if (isSelected) {
      onSelectionChange(selectedIds.filter((pid) => pid !== id));
    } else {
      onSelectionChange([...selectedIds, id]);
    }
  }
</script>

<div data-testid="people-filter">
  {#if people.length === 0 && orphanedPeople.length === 0}
    <p class="text-sm text-gray-400 dark:text-gray-500" data-testid="people-empty">
      {emptyText ?? $t('spaces_no_people')}
    </p>
  {:else}
    <!-- Search input -->
    <div class="relative mb-2">
      <div class="pointer-events-none absolute top-1/2 left-2 -translate-y-1/2 text-gray-400 dark:text-gray-500">
        <Icon icon={mdiMagnify} size="14" />
      </div>
      <input
        type="text"
        class="immich-form-input h-8 w-full rounded-lg pr-2 pl-7 text-sm"
        placeholder={$t('filter_search_people')}
        bind:value={searchQuery}
        oninput={() => {
          showAll = false;
        }}
        data-testid="people-search-input"
      />
    </div>

    <!-- Orphaned people (selected but no longer in suggestions) -->
    {#each orphanedPeople as person (person.id)}
      <button
        type="button"
        class="-mx-2 flex w-[calc(100%+1rem)] items-center gap-2 rounded-lg px-2 py-1.5 text-sm opacity-50 hover:bg-subtle"
        onclick={() => togglePerson(person.id)}
        aria-pressed="true"
        data-testid="people-item-{person.id}"
      >
        <!-- Checkbox (always checked for orphaned) -->
        <div
          class="flex size-4 shrink-0 items-center justify-center rounded-sm bg-immich-primary dark:bg-immich-dark-primary"
        >
          <svg viewBox="0 0 24 24" class="size-3 text-white dark:text-black">
            <path fill="currentColor" d="M21,7L9,19L3.5,13.5L4.91,12.09L9,16.17L19.59,5.59L21,7Z" />
          </svg>
        </div>

        <!-- Avatar -->
        {#if person.thumbnailUrl}
          <img
            src={person.thumbnailUrl}
            alt={person.name}
            class="size-5 shrink-0 rounded-full object-cover"
            onerror={(e) => {
              const img = e.currentTarget as HTMLImageElement;
              img.style.display = 'none';
              img.nextElementSibling?.removeAttribute('style');
            }}
          />
          <div
            class="flex size-5 shrink-0 items-center justify-center rounded-full text-[9px] font-semibold text-white"
            style="display: none; background: {getAvatarGradient(person.name)}"
          >
            {getInitial(person.name)}
          </div>
        {:else}
          <div
            class="flex size-5 shrink-0 items-center justify-center rounded-full bg-gray-300 text-[9px] font-semibold text-white dark:bg-gray-600"
          >
            {getInitial(person.name)}
          </div>
        {/if}

        <!-- Label -->
        <span class="flex-1 truncate text-left font-medium">{person.name}</span>
      </button>
    {/each}

    <!-- People list -->
    {#each visiblePeople as person (person.id)}
      {@const isActive = selectedIds.includes(person.id)}
      <button
        type="button"
        class="-mx-2 flex w-[calc(100%+1rem)] items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-subtle {isActive
          ? 'font-medium'
          : 'text-gray-500 dark:text-gray-300'}"
        onclick={() => togglePerson(person.id)}
        data-testid="people-item-{person.id}"
      >
        <!-- Checkbox -->
        <div
          class="flex size-4 shrink-0 items-center justify-center rounded-sm {isActive
            ? 'bg-immich-primary dark:bg-immich-dark-primary'
            : 'border border-gray-300 dark:border-gray-600'}"
        >
          {#if isActive}
            <svg viewBox="0 0 24 24" class="size-3 text-white dark:text-black">
              <path fill="currentColor" d="M21,7L9,19L3.5,13.5L4.91,12.09L9,16.17L19.59,5.59L21,7Z" />
            </svg>
          {/if}
        </div>

        <!-- Avatar -->
        {#if person.thumbnailUrl}
          <img
            src={person.thumbnailUrl}
            alt={person.name}
            class="size-5 shrink-0 rounded-full object-cover"
            onerror={(e) => {
              const img = e.currentTarget as HTMLImageElement;
              img.style.display = 'none';
              img.nextElementSibling?.removeAttribute('style');
            }}
          />
          <div
            class="flex size-5 shrink-0 items-center justify-center rounded-full text-[9px] font-semibold text-white"
            style="display: none; background: {getAvatarGradient(person.name)}"
          >
            {getInitial(person.name)}
          </div>
        {:else}
          <div
            class="flex size-5 shrink-0 items-center justify-center rounded-full text-[9px] font-semibold text-white"
            style="background: {getAvatarGradient(person.name)}"
          >
            {getInitial(person.name)}
          </div>
        {/if}

        <!-- Label -->
        <span class="flex-1 truncate text-left">{person.name}</span>
      </button>
    {/each}

    <!-- Show more link -->
    {#if !showAll && remainingCount > 0 && !searchQuery.trim()}
      <button
        type="button"
        class="py-1 text-xs font-medium text-immich-primary dark:text-immich-dark-primary"
        onclick={() => (showAll = true)}
        data-testid="people-show-more"
      >
        {$t('filter_show_more', { values: { count: remainingCount } })}
      </button>
    {/if}
  {/if}
</div>
