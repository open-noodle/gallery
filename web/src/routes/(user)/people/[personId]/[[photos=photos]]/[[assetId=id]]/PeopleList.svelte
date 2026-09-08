<script lang="ts">
  import SearchPeople from '$lib/components/faces-page/PeopleSearch.svelte';
  import { type PersonResponseDto } from '@immich/sdk';
  import { t } from 'svelte-i18n';
  import FaceThumbnail from './FaceThumbnail.svelte';
  import { mdiSwapVertical } from '@mdi/js';
  import { IconButton } from '@immich/ui';

  interface Props {
    people: PersonResponseDto[];
    peopleToNotShow: PersonResponseDto[];
    onSelect: (person: PersonResponseDto) => void;
    handleSearch?: (sortFaces: boolean) => void;
  }

  let { people, peopleToNotShow, onSelect, handleSearch }: Props = $props();
  let searchedPeopleLocal: PersonResponseDto[] = $state([]);
  let sortBySimilarirty = $state(false);
  let name = $state('');

  const showPeople = $derived(
    (name ? searchedPeopleLocal : people).filter((person) =>
      peopleToNotShow.every((unselectedPerson) => unselectedPerson.id !== person.id),
    ),
  );
</script>

<div class="flex h-14 w-full shrink-0 place-items-center gap-2 md:gap-4">
  <div class="min-w-0 grow md:w-96 md:grow-0">
    <SearchPeople type="searchBar" placeholder={$t('search_people')} bind:searchName={name} bind:searchedPeopleLocal />
  </div>

  {#if handleSearch}
    <IconButton
      shape="round"
      color="secondary"
      variant="ghost"
      icon={mdiSwapVertical}
      onclick={() => {
        sortBySimilarirty = !sortBySimilarirty;
        handleSearch(sortBySimilarirty);
      }}
      aria-label={$t('sort_people_by_similarity')}
    />
  {/if}
</div>

<!-- Fills whatever height is left over instead of a fixed `screenHeight - 400`, so on a phone the
     candidates get the whole screen below the search field rather than a stub of it (#1082). -->
<div
  class="mt-4 min-h-0 flex-1 immich-scrollbar overflow-y-auto rounded-3xl bg-gray-200 p-4 md:mt-6 md:p-10 dark:bg-immich-dark-gray"
>
  <div
    data-testid="reassign-people-grid"
    class="grid grid-cols-3 gap-4 sm:grid-cols-4 md:gap-8 lg:grid-cols-6 xl:grid-cols-8 2xl:grid-cols-10"
  >
    {#each showPeople as person (person.id)}
      <FaceThumbnail {person} onClick={() => onSelect(person)} circle border selectable />
    {/each}
  </div>
</div>
