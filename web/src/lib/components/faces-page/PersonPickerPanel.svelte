<script lang="ts">
  import PersonPickerGrid, { type PickerCandidate } from '$lib/components/faces-page/PersonPickerGrid.svelte';
  import { IconButton, Input } from '@immich/ui';
  import { mdiArrowLeftThin } from '@mdi/js';
  import type { Snippet } from 'svelte';
  import { t } from 'svelte-i18n';
  import { linear } from 'svelte/easing';
  import { fly } from 'svelte/transition';

  /**
   * The "which person is this?" screen, shared by the owner's `AssignFaceSidePanel` and the
   * space-flavoured `SpacePersonSidePanel`.
   *
   * Those two were separate screens until #992's field testing, and which one you got turned on
   * whether you OWNED the photo — so on one photo in one space the editor saw a short, named,
   * searchable list while the owner saw upstream's whole-library grid with the search hidden behind
   * a magnifier. This owns everything the two can agree on: the panel chrome, the search field, the
   * candidate ordering (`orderPickerCandidates`) and the grid.
   *
   * What it deliberately does NOT own is where candidates come from or what a click writes. Those
   * are two different tables reached through two different endpoints (`person` via
   * `reassignFacesById`, `shared_space_person` via `PUT …/people/:id/faces/:faceId`), and the owner
   * must keep their whole library on their own photo. Callers resolve `candidates` and handle
   * `onSelect`; only the presentation is shared.
   */
  type Props = {
    candidates: PickerCandidate[];
    isLoading?: boolean;
    emptyLabel: string;
    onSelect: (candidate: PickerCandidate) => void;
    onClose: () => void;
    /**
     * The search text. Bound rather than internal because both callers need it for more than
     * filtering — the space picker also names the person its "create" button makes.
     */
    query?: string;
    /**
     * Fired after every edit to `query`, for callers whose candidate list is not already in hand.
     * The owner's picker searches the server here: `getAllPeople` serves one page, so filtering the
     * loaded list would silently stop finding anyone past it. The space picker leaves this unset and
     * filters its own loaded candidates.
     */
    onQueryChange?: (query: string) => void;
    /** Rendered at the end of the header row (the owner's "create person from this face"). */
    headerActions?: Snippet;
    /** Rendered beside the search field (the space picker's "create person" with the typed name). */
    searchActions?: Snippet;
  };

  let {
    candidates,
    isLoading = false,
    emptyLabel,
    onSelect,
    onClose,
    query = $bindable(''),
    onQueryChange,
    headerActions,
    searchActions,
  }: Props = $props();
</script>

<section
  transition:fly={{ x: 360, duration: 100, easing: linear }}
  class="absolute top-0 h-full w-90 overflow-x-hidden bg-light p-2 dark:text-immich-dark-fg"
>
  <div class="flex place-items-center justify-between gap-2">
    <div class="flex items-center gap-2">
      <IconButton
        shape="round"
        color="secondary"
        variant="ghost"
        icon={mdiArrowLeftThin}
        aria-label={$t('back')}
        onclick={onClose}
      />
      <p class="flex text-lg text-immich-fg dark:text-immich-dark-fg">{$t('select_face')}</p>
    </div>
    {#if headerActions}
      <div class="flex justify-end gap-2">
        {@render headerActions()}
      </div>
    {/if}
  </div>

  <div class="p-4 text-sm">
    <div class="mb-4 flex gap-2">
      <Input placeholder={$t('search_people')} bind:value={query} oninput={() => onQueryChange?.(query)} size="tiny" />
      {#if searchActions}
        {@render searchActions()}
      {/if}
    </div>
    <h2 class="mt-4 mb-8">{$t('all_people')}</h2>
    <PersonPickerGrid {candidates} {isLoading} {emptyLabel} {onSelect} />
  </div>
</section>
