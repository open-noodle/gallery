import { peopleViewSettings } from '#lib/gallery/stores/preferences.store.ts';
import { sortPeople } from '#lib/utils/people-utils.ts';
import type { PersonResponseDto } from '@immich/sdk';
import { fromStore } from 'svelte/store';

class PeopleSortManager {
  // Reuse the established preference rather than creating another persisted setting.
  #settings = fromStore(peopleViewSettings);

  sort(people: PersonResponseDto[]): PersonResponseDto[] {
    return sortPeople(people, this.#settings.current.sortBy);
  }
}

export const peopleSortManager = new PeopleSortManager();
