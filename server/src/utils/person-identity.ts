import { PersonResponseDto } from 'src/dtos/person.dto';

type ResolvablePerson = Pick<PersonResponseDto, 'id' | 'name' | 'birthDate'>;

/**
 * Overlay the identity-wide name/birthday resolution onto already-mapped people.
 *
 * A name or birthday set inside a shared space is stored on `shared_space_person` and resolved at
 * read time against the face identity — it is never written back to `person`. Any read path that
 * maps a raw `person` row therefore has to re-apply that resolution, or it hands back the raw
 * (often empty) `person.birthDate` and the age disappears (#808).
 *
 * Each distinct identity is resolved once, regardless of how many people map onto it.
 */
export const applyResolvedIdentityMetadata = async <T extends ResolvablePerson>({
  people,
  identityByPersonId,
  resolve,
}: {
  people: T[];
  identityByPersonId: Map<string, string>;
  resolve: (identityId: string) => Promise<PersonResponseDto | undefined>;
}): Promise<void> => {
  if (people.length === 0 || identityByPersonId.size === 0) {
    return;
  }

  const resolvedByIdentity = new Map<string, PersonResponseDto>();
  await Promise.all(
    [...new Set(identityByPersonId.values())].map(async (identityId) => {
      const resolved = await resolve(identityId);
      if (resolved) {
        resolvedByIdentity.set(identityId, resolved);
      }
    }),
  );

  for (const person of people) {
    const identityId = identityByPersonId.get(person.id);
    const resolved = identityId ? resolvedByIdentity.get(identityId) : undefined;
    if (resolved) {
      person.name = resolved.name;
      person.birthDate = resolved.birthDate;
    }
  }
};
