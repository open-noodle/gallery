import { get } from 'svelte/store';
import { PeopleFilterBy, peopleViewSettings } from '$lib/stores/preferences.store';

/**
 * The People/Pets type filter, shared by the global People page, the space People tab, and both of
 * their `load` functions.
 *
 * Deliberately a module of its own rather than part of `people-utils`: that module reaches the
 * asset-viewer manager and the SDK URL helpers, and a SvelteKit `load` has no business pulling those
 * in just to read one persisted enum.
 */

/** The `type` query param a filter maps to; `All` sends none. */
export type PeopleTypeParam = 'person' | 'pet' | undefined;

export const peopleFilterToTypeParam = (filterBy: PeopleFilterBy): PeopleTypeParam => {
  switch (filterBy) {
    case PeopleFilterBy.People: {
      return 'person';
    }
    case PeopleFilterBy.Pets: {
      return 'pet';
    }
    default: {
      return undefined;
    }
  }
};

/** The persisted choice, falling back to `All` for an absent or corrupt localStorage value. */
export const resolvePeopleFilterBy = (value: unknown): PeopleFilterBy =>
  Object.values(PeopleFilterBy).includes(value as PeopleFilterBy) ? (value as PeopleFilterBy) : PeopleFilterBy.All;

/**
 * The persisted People/Pets choice, for callers outside a component — the `load` functions.
 *
 * Both People pages used to load unfiltered and re-apply the persisted filter in `onMount`, so a
 * saved Pets choice painted the whole people list for one round trip before narrowing to pets.
 * Reading the setting here — the root layout sets `ssr = false`, so `load` runs in the browser with
 * localStorage available — makes the first request the already-filtered one.
 */
export const getPersistedPeopleFilterBy = (): PeopleFilterBy => resolvePeopleFilterBy(get(peopleViewSettings).filterBy);

/** The `type` param for the persisted choice. */
export const getPersistedPeopleTypeParam = (): PeopleTypeParam => peopleFilterToTypeParam(getPersistedPeopleFilterBy());
