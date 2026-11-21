import { AuthDto } from 'src/dtos/auth.dto.js';
import { PersonResponseDto } from 'src/dtos/person.dto.js';
import { GalleryPersonRepository } from 'src/gallery/repositories/gallery-person.repository.js';

/**
Adds `numberOfAssets` to the owner-only `GET /people` list (#1232), so "Show & hide people" can sort by
photo count like the People page, whose grouped list already carries it. The field is optional and
additive and set only for people with counted photos (clients read it absent as 0); stock clients get
upstream's response unchanged and skip the query.
*/
export const withOwnedPersonAssetCounts = async (
  repository: Pick<GalleryPersonRepository, 'getOwnedPersonAssetCounts'>,
  auth: AuthDto,
  people: PersonResponseDto[],
): Promise<PersonResponseDto[]> => {
  if (auth.stockClient || people.length === 0) {
    return people;
  }

  const counts = await repository.getOwnedPersonAssetCounts(
    auth.user.id,
    people.map(({ id }) => id),
  );
  return people.map((person) => {
    const numberOfAssets = counts.get(person.id);
    return numberOfAssets === undefined ? person : { ...person, numberOfAssets };
  });
};
