import { isSpaceScopedPerson } from '#lib/utils/scoped-person-ref.ts';
import { getAllPeople, searchPerson, type PersonResponseDto } from '@immich/sdk';

/**
The people the owner's face picker (`AssignFaceSidePanel`) offers, read through the identity
endpoints rather than the owner-only ones (#1287).

A name or birthday given to someone inside a space is stored on that space's profile and resolved
per face identity at read time; it is never written back to the owner's `person` row. The
owner-only list and search (`withSharedSpaces` unset) return that raw row, so every person named
only in a space arrived unnamed: sorted into the unnamed tail (and so possibly off the 500-row
page), and not found by name. The identity endpoints resolve the name, sort on it and search
every profile's name, as the People page and the merge picker already do.

They also return identities the viewer only sees through a space. A face on the owner's photo can
only be reassigned to a person the owner holds, so those rows are dropped; an identity the owner
holds a person for always comes back with that person as its primary profile, under the same id
the owner-only list used.
*/
const isOwnedPerson = (person: PersonResponseDto) => !isSpaceScopedPerson(person);

/** `searchAccessiblePeople` (server `SearchService.searchPerson`) returns at most this many rows. */
export const ownedPickerSearchLimit = 50;

export const loadOwnedPickerPeople = async (): Promise<PersonResponseDto[]> => {
  const { people } = await getAllPeople({ withHidden: true, withSharedSpaces: true });
  return people.filter((person) => isOwnedPerson(person));
};

/**
`isComplete` is judged on the server's row count, before the space-only rows are dropped: a full
page may have more matches behind it, and the caller must not narrow a growing query locally then.
*/
export const searchOwnedPickerPeople = async (
  name: string,
  options: { signal?: AbortSignal },
): Promise<{ people: PersonResponseDto[]; isComplete: boolean }> => {
  const people = await searchPerson({ name, withSharedSpaces: true }, options);
  return {
    people: people.filter((person) => isOwnedPerson(person)),
    isComplete: people.length < ownedPickerSearchLimit,
  };
};
