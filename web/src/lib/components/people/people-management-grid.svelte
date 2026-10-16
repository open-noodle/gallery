<script lang="ts" generics="T extends { id: string }">
  import { shortcut } from '$lib/actions/shortcut';
  import PeopleGrid from '$lib/components/people/people-grid.svelte';
  import PersonTile from '$lib/components/people/person-tile.svelte';
  import type { ManagedPerson } from '$lib/components/people/people-types';
  import { ThumbnailLoadQueue } from '$lib/components/people/thumbnail-load-queue.svelte';
  import type { Snippet } from 'svelte';
  import { t } from 'svelte-i18n';

  interface Props {
    people: T[];
    toManagedPerson: (person: T) => ManagedPerson;
    gridClass?: string;
    cardClass?: string;
    nameInputClass?: string;
    readonlyNameClass?: string;
    hasNextPage?: boolean;
    loading?: boolean;
    loadNextPage: () => void;
    canEditNames?: boolean | ((person: T) => boolean);
    canShowActions?: boolean | ((person: T) => boolean);
    deferThumbnails?: boolean;
    thumbnailConcurrency?: number;
    onNameSubmit?: (name: string, person: T) => void | Promise<void>;
    /** Existing people whose name matches what is being typed; enables the suggestion dropdown. */
    searchNameSuggestions?: (name: string, person: T) => Promise<T[]>;
    /** Picking a suggestion means "this is the same person", so it replaces the rename. */
    onSuggestionSelect?: (suggestion: T, person: T) => void | Promise<void>;
    actions?: Snippet<[T]>;
  }

  let {
    people,
    toManagedPerson,
    gridClass = 'w-full grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-7 2xl:grid-cols-10 gap-1',
    cardClass = 'p-2 rounded-xl hover:bg-gray-200 border-2 hover:border-immich-primary/50 hover:shadow-sm dark:hover:bg-immich-dark-primary/20 hover:dark:border-immich-dark-primary/25 border-transparent transition-all',
    nameInputClass = 'bg-white dark:bg-immich-dark-gray border-gray-100 placeholder-gray-400 text-center dark:border-gray-900 w-full rounded-2xl mt-2 py-2 text-sm text-primary',
    readonlyNameClass = 'mt-2 truncate text-center text-sm font-medium',
    hasNextPage = false,
    loading = false,
    loadNextPage,
    canEditNames = false,
    canShowActions = true,
    deferThumbnails = false,
    thumbnailConcurrency = 8,
    onNameSubmit = () => {},
    searchNameSuggestions,
    onSuggestionSelect = () => {},
    actions,
  }: Props = $props();

  const MAX_SUGGESTIONS = 5;
  const suggestionListId = $props.id();

  const getThumbnailConcurrency = () => thumbnailConcurrency;
  let editingName = $state('');
  let currentThumbnailConcurrency = $state(getThumbnailConcurrency());
  let thumbnailQueue = $state(new ThumbnailLoadQueue(getThumbnailConcurrency()));

  $effect(() => {
    if (thumbnailConcurrency === currentThumbnailConcurrency) {
      return;
    }

    currentThumbnailConcurrency = thumbnailConcurrency;
    thumbnailQueue = new ThumbnailLoadQueue(thumbnailConcurrency);
  });

  const isNameEditable = (person: T) => (typeof canEditNames === 'function' ? canEditNames(person) : canEditNames);

  const shouldShowActions = (person: T) =>
    !!actions && (typeof canShowActions === 'function' ? canShowActions(person) : canShowActions);

  let suggestionsFor = $state<string | null>(null);
  let suggestions = $state<T[]>([]);
  let activeSuggestion = $state(-1);
  let searchSequence = 0;
  let skipNextSubmit = false;

  const clearSuggestions = () => {
    searchSequence++;
    suggestions = [];
    activeSuggestion = -1;
  };

  const handleNameFocus = (person: T, managedPerson: ManagedPerson) => {
    editingName = managedPerson.canonicalName ?? managedPerson.displayName;
    suggestionsFor = person.id;
    clearSuggestions();
  };

  const updateSuggestions = async (person: T) => {
    const name = editingName.trim();
    const sequence = ++searchSequence;
    if (!searchNameSuggestions || !name) {
      suggestions = [];
      activeSuggestion = -1;
      return;
    }

    try {
      const results = await searchNameSuggestions(name, person);
      if (sequence !== searchSequence || suggestionsFor !== person.id) {
        return;
      }
      suggestions = results.filter(({ id }) => id !== person.id).slice(0, MAX_SUGGESTIONS);
      activeSuggestion = -1;
    } catch {
      if (sequence === searchSequence) {
        suggestions = [];
      }
    }
  };

  const handleNameInput = (event: Event, person: T) => {
    if (!event.target) {
      return;
    }
    editingName = (event.target as HTMLInputElement).value;
    void updateSuggestions(person);
  };

  const handleNameSubmit = async (person: T) => {
    suggestionsFor = null;
    clearSuggestions();
    if (skipNextSubmit) {
      skipNextSubmit = false;
      return;
    }
    await onNameSubmit(editingName, person);
  };

  const selectSuggestion = async (suggestion: T, person: T, input: HTMLInputElement) => {
    const managedPerson = toManagedPerson(person);
    // Blurring commits the typed name, which is exactly what picking a suggestion replaces.
    skipNextSubmit = true;
    input.value = managedPerson.canonicalName ?? managedPerson.displayName;
    input.blur();
    await onSuggestionSelect(suggestion, person);
  };

  const handleNameKeydown = (event: KeyboardEvent) => {
    if (suggestions.length === 0) {
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      activeSuggestion = (activeSuggestion + step + suggestions.length) % suggestions.length;
    } else if (event.key === 'Escape') {
      event.stopPropagation();
      clearSuggestions();
    }
  };

  const handleNameEnter = (input: HTMLInputElement, person: T) => {
    const suggestion = suggestions[activeSuggestion];
    if (suggestion) {
      void selectSuggestion(suggestion, person, input);
      return;
    }
    input.blur();
  };
</script>

<PeopleGrid items={people} class={gridClass} {hasNextPage} {loading} {loadNextPage}>
  {#snippet children(person)}
    {@const managedPerson = toManagedPerson(person)}
    <div class={cardClass}>
      <PersonTile
        person={managedPerson}
        showActionMenu={shouldShowActions(person)}
        deferThumbnail={deferThumbnails}
        {thumbnailQueue}
      >
        {#snippet actionMenu()}
          {@render actions?.(person)}
        {/snippet}

        {#snippet footer()}
          {#if isNameEditable(person)}
            {@const listId = `${suggestionListId}-${person.id}`}
            {@const showSuggestions = suggestionsFor === person.id && suggestions.length > 0}
            <div class="relative">
              <input
                type="text"
                class={nameInputClass}
                value={managedPerson.canonicalName ?? managedPerson.displayName}
                placeholder={$t('add_a_name')}
                autocomplete="off"
                role={searchNameSuggestions ? 'combobox' : undefined}
                aria-autocomplete={searchNameSuggestions ? 'list' : undefined}
                aria-expanded={searchNameSuggestions ? showSuggestions : undefined}
                aria-controls={showSuggestions ? listId : undefined}
                aria-activedescendant={showSuggestions && activeSuggestion >= 0
                  ? `${listId}-${activeSuggestion}`
                  : undefined}
                use:shortcut={{
                  shortcut: { key: 'Enter' },
                  onShortcut: (e) => handleNameEnter(e.currentTarget as HTMLInputElement, person),
                }}
                onfocusin={() => handleNameFocus(person, managedPerson)}
                onfocusout={() => void handleNameSubmit(person)}
                oninput={(event) => handleNameInput(event, person)}
                onkeydown={handleNameKeydown}
              />
              {#if showSuggestions}
                <ul
                  id={listId}
                  role="listbox"
                  aria-label={$t('suggestions')}
                  class="absolute inset-x-0 top-full z-20 mt-1 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-lg dark:border-gray-700 dark:bg-immich-dark-gray"
                >
                  {#each suggestions as suggestion, index (suggestion.id)}
                    {@const managedSuggestion = toManagedPerson(suggestion)}
                    <!-- Keyboard selection lives on the combobox input (arrows + Enter via aria-activedescendant);
                         mousedown is cancelled so a click doesn't blur the input and commit the typed name. -->
                    <!-- svelte-ignore a11y_click_events_have_key_events -->
                    <li
                      id={`${listId}-${index}`}
                      role="option"
                      aria-selected={index === activeSuggestion}
                      class="flex cursor-pointer items-center gap-2 px-2 py-1.5 text-start text-sm text-primary hover:bg-gray-100 dark:hover:bg-gray-700 {index ===
                      activeSuggestion
                        ? 'bg-gray-100 dark:bg-gray-700'
                        : ''}"
                      onmousedown={(event) => event.preventDefault()}
                      onclick={(event) => {
                        const input = event.currentTarget.closest('div')?.querySelector('input');
                        if (input) {
                          void selectSuggestion(suggestion, person, input);
                        }
                      }}
                    >
                      <img
                        src={managedSuggestion.thumbnailUrl}
                        alt=""
                        class="size-7 shrink-0 rounded-full object-cover"
                        loading="lazy"
                      />
                      <span class="truncate">{managedSuggestion.displayName}</span>
                    </li>
                  {/each}
                </ul>
              {/if}
            </div>
          {:else if managedPerson.displayName}
            <p class={readonlyNameClass}>{managedPerson.displayName}</p>
          {/if}
        {/snippet}
      </PersonTile>
    </div>
  {/snippet}
</PeopleGrid>
