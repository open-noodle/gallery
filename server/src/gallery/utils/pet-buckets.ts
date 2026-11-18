import { JobName } from 'src/enum.js';
import type { PetFaceRepository } from 'src/gallery/repositories/pet-face.repository.js';
import type { PersonRepository } from 'src/repositories/person.repository.js';
import type { JobItem } from 'src/types.js';

type PetBucketDependencies = { petFaceRepository: PetFaceRepository; personRepository: PersonRepository };

/**
The owner's species person ("bucket") for `label`, created on first use: where a pet goes when it is not a species pet
recognition identifies, or recognition is off. Shared by photo and video pet detection; `cache` saves the lookups
within one asset.
*/
export const speciesPersonFor = async (
  { petFaceRepository, personRepository }: PetBucketDependencies,
  ownerId: string,
  label: string,
  cache: Map<string, string>,
): Promise<string> => {
  const cached = cache.get(label);
  if (cached) {
    return cached;
  }

  const existing = await petFaceRepository.getByOwnerAndSpecies(ownerId, label);
  const person =
    existing ?? (await personRepository.createWithGroup({ ownerId, name: label, type: 'pet', species: label }));
  const { personGroupId } = person;
  cache.set(label, personGroupId);
  return personGroupId;
};

/**
Makes `faceId` the cover of a person who has none yet, and returns the thumbnail job that follows; undefined when the
person already has a cover or is gone.
*/
export const coverPersonIfMissing = async (
  { personRepository }: Pick<PetBucketDependencies, 'personRepository'>,
  personGroupId: string,
  faceId: string,
): Promise<JobItem | undefined> => {
  const person = await personRepository.getByGroupIdOnly(personGroupId);
  if (!person || person.faceAssetId) {
    return;
  }

  await personRepository.update({ ownerId: person.ownerId, personGroupId, faceAssetId: faceId });
  return { name: JobName.PersonGenerateThumbnail, data: { ownerId: person.ownerId, personGroupId } };
};
