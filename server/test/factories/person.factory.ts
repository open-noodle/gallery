import { PersonLike, PersonRow } from 'test/factories/types.js';
import { newDate, newUuid, newUuidV7 } from 'test/small.factory.js';

export class PersonFactory {
  private constructor(private readonly value: PersonRow) {}

  static create(dto: PersonLike = {}) {
    return PersonFactory.from(dto).build();
  }

  static from(dto: PersonLike = {}) {
    return new PersonFactory({
      birthDate: null,
      color: null,
      createdAt: newDate(),
      faceAssetId: null,
      personGroupId: newUuid(),
      identityId: null,
      isFavorite: false,
      isHidden: false,
      name: 'person',
      otherPeople: [],
      sharedBy: [],
      sharedWith: [],
      ownerId: newUuid(),
      species: null,
      thumbnailPath: '/data/thumbs/person-thumbnail.jpg',
      type: 'person',
      updatedAt: newDate(),
      updateId: newUuidV7(),
      ...dto,
    });
  }

  build() {
    return { ...this.value };
  }
}
