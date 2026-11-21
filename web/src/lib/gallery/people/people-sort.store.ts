import { peopleViewSettings } from '#lib/gallery/stores/preferences.store.ts';
import { sortPeople } from '#lib/utils/people-utils.ts';
import type { PersonResponseDto } from '@immich/sdk';
import { derived } from 'svelte/store';

/** Shared with the People page: favorites and named people precede the selected sort. */
export const sortPeopleByPreference = derived(peopleViewSettings, ({ sortBy }) => {
  return (people: PersonResponseDto[]): PersonResponseDto[] => sortPeople(people, sortBy);
});
