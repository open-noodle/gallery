import { JobName, SharedSpaceActivityType } from 'src/enum';
import { PersonRepository } from 'src/repositories/person.repository';
import { SharedSpaceRepository } from 'src/repositories/shared-space.repository';
import { IdentityMergePropagationService, MergeProfile } from 'src/services/identity-merge-propagation.service';

type PersonalMergePersonRow = {
  id: string;
  name: string;
  birthDate: string | null;
  thumbnailPath: string;
  color: string | null;
  species: string | null;
  isHidden: boolean;
  isFavorite: boolean;
  faceAssetId: string | null;
  identityId: string | null;
};

type PersonalMergeFaceRow = { id: string; personId: string | null; deletedAt?: string | null; isVisible?: boolean };

class PersonalMergeDb {
  constructor(
    public people: PersonalMergePersonRow[],
    public faces: PersonalMergeFaceRow[],
  ) {}

  selectFrom(table: string) {
    return new PersonalMergeSelectBuilder(this, table);
  }

  updateTable(table: string) {
    return new PersonalMergeUpdateBuilder(this, table);
  }

  deleteFrom(table: string) {
    return new PersonalMergeDeleteBuilder(this, table);
  }
}

class PersonalMergeSelectBuilder {
  private idFilter: string[] | null = null;
  private faceFilters: Array<{ column: string; operator: string; value: unknown }> = [];

  constructor(
    private db: PersonalMergeDb,
    private table: string,
  ) {}

  select() {
    return this;
  }

  where(column: string, operator: string, value: unknown) {
    if (this.table === 'person' && column === 'id' && operator === 'in' && Array.isArray(value)) {
      this.idFilter = value;
    }

    if (this.table === 'asset_face') {
      this.faceFilters.push({ column, operator, value });
    }
    return this;
  }

  execute() {
    if (this.table !== 'person') {
      return [];
    }

    return this.idFilter ? this.db.people.filter((person) => this.idFilter?.includes(person.id)) : this.db.people;
  }

  executeTakeFirst() {
    if (this.table !== 'asset_face') {
      return null;
    }

    return this.db.faces.find((face) =>
      this.faceFilters.every(({ column, operator, value }) => {
        const key = column.replace('asset_face.', '') as keyof PersonalMergeFaceRow;
        const faceValue = face[key] ?? null;
        if (operator === '=') {
          return faceValue === value;
        }
        if (operator === 'is') {
          return faceValue === value;
        }
        return false;
      }),
    );
  }
}

class PersonalMergeUpdateBuilder {
  private update: Record<string, unknown> = {};
  private whereColumn: string | null = null;
  private whereValue: string | null = null;

  constructor(
    private db: PersonalMergeDb,
    private table: string,
  ) {}

  set(update: Record<string, unknown>) {
    this.update = update;
    return this;
  }

  where(column: string, _operator: string, value: string) {
    this.whereColumn = column;
    this.whereValue = value;
    return this;
  }

  execute() {
    if (this.table === 'person' && this.whereColumn === 'id') {
      for (const person of this.db.people) {
        if (person.id === this.whereValue) {
          Object.assign(person, this.update);
        }
      }
    }

    if (this.table === 'asset_face' && this.whereColumn === 'personId') {
      for (const face of this.db.faces) {
        if (face.personId === this.whereValue) {
          Object.assign(face, this.update);
        }
      }
    }

    return [];
  }
}

class PersonalMergeDeleteBuilder {
  private whereColumn: string | null = null;
  private whereValue: string | null = null;

  constructor(
    private db: PersonalMergeDb,
    private table: string,
  ) {}

  where(column: string, _operator: string, value: string) {
    this.whereColumn = column;
    this.whereValue = value;
    return this;
  }

  execute() {
    if (this.table === 'person' && this.whereColumn === 'id') {
      const before = this.db.people.length;
      this.db.people = this.db.people.filter((person) => person.id !== this.whereValue);
      return [{ numDeletedRows: BigInt(before - this.db.people.length) }];
    }

    return [{ numDeletedRows: 0n }];
  }
}

type SharedSpaceMergePersonRow = {
  id: string;
  name: string;
  birthDate: string | null;
  isHidden: boolean;
  representativeFaceId: string | null;
  representativeFaceSource: 'auto' | 'manual';
  nameSource: string;
  birthDateSource: string;
  faceCount: number;
  assetCount: number;
};

type SharedSpaceMergeFaceRow = { personId: string; assetFaceId: string; assetId: string };
type SharedSpaceMergeAliasRow = { personId: string; userId: string; alias: string };

class SharedSpaceMergeDb {
  constructor(
    public people: SharedSpaceMergePersonRow[],
    public faces: SharedSpaceMergeFaceRow[],
    public aliases: SharedSpaceMergeAliasRow[],
  ) {}

  selectFrom(table: string) {
    return new SharedSpaceMergeSelectBuilder(this, table);
  }

  updateTable(table: string) {
    return new SharedSpaceMergeUpdateBuilder(this, table);
  }

  deleteFrom(table: string) {
    return new SharedSpaceMergeDeleteBuilder(this, table);
  }

  insertInto(table: string) {
    return new SharedSpaceMergeInsertBuilder(this, table);
  }

  removeDuplicateFaces(fromPersonId: string, toPersonId: string) {
    const targetFaceIds = new Set(
      this.faces.filter((face) => face.personId === toPersonId).map((face) => face.assetFaceId),
    );
    this.faces = this.faces.filter((face) => face.personId !== fromPersonId || !targetFaceIds.has(face.assetFaceId));
  }

  moveFaces(fromPersonId: string, toPersonId: string) {
    for (const face of this.faces) {
      if (face.personId === fromPersonId) {
        face.personId = toPersonId;
      }
    }
  }

  recount(personIds: string[]) {
    for (const personId of personIds) {
      const person = this.people.find((person) => person.id === personId);
      if (!person) {
        continue;
      }

      const faces = this.faces.filter((face) => face.personId === personId);
      person.faceCount = faces.length;
      person.assetCount = new Set(faces.map((face) => face.assetId)).size;
    }
  }
}

class SharedSpaceMergeSelectBuilder {
  private whereColumn: string | null = null;
  private whereValue: string | null = null;

  constructor(
    private db: SharedSpaceMergeDb,
    private table: string,
  ) {}

  select() {
    return this;
  }

  selectAll() {
    return this;
  }

  where(column: string, _operator: string, value: string) {
    this.whereColumn = column;
    this.whereValue = value;
    return this;
  }

  execute() {
    if (this.table === 'shared_space_person_alias') {
      return this.db.aliases.filter((alias) => alias.personId === this.whereValue);
    }

    if (this.table === 'shared_space_person_face') {
      return this.db.faces
        .filter((face) => face.personId === this.whereValue)
        .map((face) => ({ assetFaceId: face.assetFaceId }));
    }

    return [];
  }

  evaluateAssetFaceIds() {
    if (this.table !== 'shared_space_person_face' || this.whereColumn !== 'personId') {
      return [];
    }

    return this.db.faces.filter((face) => face.personId === this.whereValue).map((face) => face.assetFaceId);
  }
}

class SharedSpaceMergeUpdateBuilder {
  private update: Record<string, unknown> = {};
  private whereColumn: string | null = null;
  private whereValue: string | null = null;

  constructor(
    private db: SharedSpaceMergeDb,
    private table: string,
  ) {}

  set(update: Record<string, unknown>) {
    this.update = update;
    return this;
  }

  where(column: string, _operator: string, value: string) {
    this.whereColumn = column;
    this.whereValue = value;
    return this;
  }

  execute() {
    if (this.table === 'shared_space_person_face' && this.whereColumn === 'personId') {
      for (const face of this.db.faces) {
        if (face.personId === this.whereValue) {
          Object.assign(face, this.update);
        }
      }
    }

    return [];
  }
}

class SharedSpaceMergeDeleteBuilder {
  private personId: string | null = null;
  private duplicateFaceSubquery: SharedSpaceMergeSelectBuilder | null = null;

  constructor(
    private db: SharedSpaceMergeDb,
    private table: string,
  ) {}

  where(column: string, operator: string, value: string | SharedSpaceMergeSelectBuilder) {
    if (column === 'personId' && operator === '=') {
      this.personId = value as string;
    }

    if (column === 'assetFaceId' && operator === 'in') {
      this.duplicateFaceSubquery = value as SharedSpaceMergeSelectBuilder;
    }

    if (column === 'id' && operator === '=') {
      this.personId = value as string;
    }

    return this;
  }

  execute() {
    if (this.table === 'shared_space_person_face') {
      const duplicateFaceIds = new Set(this.duplicateFaceSubquery?.evaluateAssetFaceIds());
      this.db.faces = this.db.faces.filter(
        (face) => face.personId !== this.personId || !duplicateFaceIds.has(face.assetFaceId),
      );
      return [];
    }

    if (this.table === 'shared_space_person_alias') {
      this.db.aliases = this.db.aliases.filter((alias) => alias.personId !== this.personId);
      return [];
    }

    if (this.table === 'shared_space_person') {
      const before = this.db.people.length;
      this.db.people = this.db.people.filter((person) => person.id !== this.personId);
      return [{ numDeletedRows: BigInt(before - this.db.people.length) }];
    }

    return [{ numDeletedRows: 0n }];
  }
}

class SharedSpaceMergeInsertBuilder {
  private row: SharedSpaceMergeAliasRow | null = null;

  constructor(
    private db: SharedSpaceMergeDb,
    private table: string,
  ) {}

  values(row: SharedSpaceMergeAliasRow) {
    this.row = row;
    return this;
  }

  onConflict() {
    return this;
  }

  doNothing() {
    return this;
  }

  execute() {
    if (this.table !== 'shared_space_person_alias' || !this.row) {
      return [];
    }

    const exists = this.db.aliases.some(
      (alias) => alias.personId === this.row?.personId && alias.userId === this.row?.userId,
    );
    if (!exists) {
      this.db.aliases.push(this.row);
    }

    return [];
  }
}

class TestSharedSpaceRepository extends SharedSpaceRepository {
  public reassignPersonFacesSafeCalls: Array<{ fromPersonId: string; toPersonId: string }> = [];

  constructor(private fakeDb: SharedSpaceMergeDb) {
    super(fakeDb as never);
  }

  override reassignPersonFacesSafe(fromPersonId: string, toPersonId: string) {
    this.reassignPersonFacesSafeCalls.push({ fromPersonId, toPersonId });
    this.fakeDb.removeDuplicateFaces(fromPersonId, toPersonId);
    this.fakeDb.moveFaces(fromPersonId, toPersonId);
    return Promise.resolve();
  }

  override recountPersons(personIds: string[]) {
    this.fakeDb.recount(personIds);
    return Promise.resolve();
  }
}

const profile = (overrides: Partial<MergeProfile> & Pick<MergeProfile, 'kind' | 'id' | 'identityId'>) =>
  ({
    type: 'person',
    name: overrides.id,
    faceCount: 1,
    ...overrides,
  }) as MergeProfile;

const makeService = (profiles: MergeProfile[]) => {
  const transaction = { transaction: true };
  const databaseRepository = {
    transaction: vi.fn((callback: (db: typeof transaction) => Promise<unknown>) => callback(transaction)),
  };
  const personRepository = {
    lockPeopleForMerge: vi.fn().mockResolvedValue(void 0),
    mergePersonProfile: vi.fn().mockResolvedValue({ deletedThumbnailPath: null, targetNeedsFeatureFaceRepair: false }),
    getRandomFace: vi.fn().mockResolvedValue(null),
    update: vi.fn().mockResolvedValue(void 0),
    updatePersonIdentity: vi.fn().mockResolvedValue(void 0),
  };
  const faceIdentityRepository = {
    ensurePersonIdentity: vi.fn((personId: string) => {
      const profile = profiles.find((profile) => profile.kind === 'person' && profile.id === personId);
      if (!profile) {
        throw new Error('Person not found');
      }

      profile.identityId ??= `identity-for-${personId}`;
      return { id: profile.identityId, type: profile.type };
    }),
    ensureSpacePersonIdentity: vi.fn((personId: string) => {
      const profile = profiles.find((profile) => profile.kind === 'space-person' && profile.id === personId);
      if (!profile) {
        throw new Error('Space person not found');
      }

      profile.identityId ??= `identity-for-${personId}`;
      return { id: profile.identityId, type: profile.type };
    }),
    getMergePropagationProfiles: vi.fn(
      (
        input: { mode: 'profiles'; personIds: string[] } | { mode: 'identities'; identityIds: string[] },
      ): MergeProfile[] => {
        if (input.mode === 'profiles') {
          const personIds = new Set(input.personIds);
          return profiles.filter((profile) => profile.kind === 'person' && personIds.has(profile.id));
        }

        const identityIds = new Set(input.identityIds);
        return profiles.filter((profile) => profile.identityId && identityIds.has(profile.identityId));
      },
    ),
    linkPersonFaces: vi.fn().mockResolvedValue(void 0),
    mergeIdentitiesAfterProfileResolution: vi.fn().mockResolvedValue(void 0),
  };
  const jobRepository = {
    queue: vi.fn().mockResolvedValue(void 0),
  };
  const logger = {
    error: vi.fn(),
  };
  const sharedSpaceRepository = {
    lockSpacePeopleForMerge: vi.fn().mockResolvedValue(void 0),
    getPersonById: vi.fn((personId: string) => {
      const person = profiles.find((profile) => profile.kind === 'space-person' && profile.id === personId);
      return person
        ? {
            id: person.id,
            spaceId: person.spaceId,
            identityId: person.identityId,
            type: person.type,
            name: person.name,
            faceCount: person.faceCount,
          }
        : undefined;
    }),
    mergeSpacePersonProfile: vi.fn().mockResolvedValue(void 0),
    updateSpacePersonIdentity: vi.fn().mockResolvedValue(void 0),
    repairInvalidRepresentativeFaces: vi.fn().mockResolvedValue(void 0),
    repairOrphanedRepresentativeFaces: vi.fn().mockResolvedValue(void 0),
    logActivity: vi.fn().mockResolvedValue(void 0),
  };

  const sut = new IdentityMergePropagationService({
    databaseRepository: databaseRepository as never,
    faceIdentityRepository: faceIdentityRepository as never,
    jobRepository: jobRepository as never,
    logger: logger as never,
    personRepository: personRepository as never,
    sharedSpaceRepository: sharedSpaceRepository as never,
  });

  return {
    sut,
    mocks: {
      database: databaseRepository,
      faceIdentity: faceIdentityRepository,
      job: jobRepository,
      logger,
      person: personRepository,
      sharedSpace: sharedSpaceRepository,
    },
    transaction,
    faceIdentityRepository,
  };
};

describe(PersonRepository.name, () => {
  describe('mergePersonProfile', () => {
    it('preserves target personal name, birth date, color, species, hidden, favorite, and feature face', async () => {
      const db = new PersonalMergeDb(
        [
          {
            id: 'target-person',
            name: 'Target Name',
            birthDate: '1980-01-02',
            thumbnailPath: '/target-thumb.jpg',
            color: '#123456',
            species: 'human',
            isHidden: true,
            isFavorite: true,
            faceAssetId: 'target-feature-face',
            identityId: 'identity-target-old',
          },
          {
            id: 'source-person',
            name: 'Source Name',
            birthDate: '1990-03-04',
            thumbnailPath: '/source-thumb.jpg',
            color: '#abcdef',
            species: 'source species',
            isHidden: false,
            isFavorite: false,
            faceAssetId: 'source-feature-face',
            identityId: 'identity-source',
          },
        ],
        [
          { id: 'target-feature-face', personId: 'target-person', deletedAt: null, isVisible: true },
          { id: 'source-face', personId: 'source-person', deletedAt: null, isVisible: true },
        ],
      );
      const sut = new PersonRepository(db as never);

      const result = await sut.mergePersonProfile(
        { sourcePersonId: 'source-person', targetPersonId: 'target-person', targetIdentityId: 'identity-target' },
        db as never,
      );

      expect(result).toEqual(
        expect.objectContaining({
          deletedThumbnailPath: '/source-thumb.jpg',
          targetNeedsFeatureFaceRepair: false,
        }),
      );
      expect(db.people).toHaveLength(1);
      expect(db.people[0]).toMatchObject({
        id: 'target-person',
        name: 'Target Name',
        birthDate: '1980-01-02',
        color: '#123456',
        species: 'human',
        isHidden: true,
        isFavorite: true,
        faceAssetId: 'target-feature-face',
        identityId: 'identity-target',
      });
      expect(db.faces).toEqual([
        { id: 'target-feature-face', personId: 'target-person', deletedAt: null, isVisible: true },
        { id: 'source-face', personId: 'target-person', deletedAt: null, isVisible: true },
      ]);
    });

    it('fills blank personal target metadata from source without copying hidden or favorite', async () => {
      const db = new PersonalMergeDb(
        [
          {
            id: 'target-person',
            name: '',
            birthDate: null,
            thumbnailPath: '',
            color: null,
            species: null,
            isHidden: false,
            isFavorite: false,
            faceAssetId: null,
            identityId: 'identity-target-old',
          },
          {
            id: 'source-person',
            name: 'Source Name',
            birthDate: '1990-03-04',
            thumbnailPath: '',
            color: '#abcdef',
            species: 'source species',
            isHidden: true,
            isFavorite: true,
            faceAssetId: 'source-feature-face',
            identityId: 'identity-source',
          },
        ],
        [],
      );
      const sut = new PersonRepository(db as never);

      await sut.mergePersonProfile(
        { sourcePersonId: 'source-person', targetPersonId: 'target-person', targetIdentityId: 'identity-target' },
        db as never,
      );

      expect(db.people).toEqual([
        expect.objectContaining({
          id: 'target-person',
          name: 'Source Name',
          birthDate: '1990-03-04',
          color: '#abcdef',
          species: 'source species',
          isHidden: false,
          isFavorite: false,
          faceAssetId: null,
          identityId: 'identity-target',
        }),
      ]);
    });

    it('reports feature face repair is needed when the preserved personal feature face is invalid', async () => {
      const db = new PersonalMergeDb(
        [
          {
            id: 'target-person',
            name: 'Target Name',
            birthDate: null,
            thumbnailPath: '',
            color: null,
            species: null,
            isHidden: false,
            isFavorite: false,
            faceAssetId: 'missing-feature-face',
            identityId: 'identity-target-old',
          },
          {
            id: 'source-person',
            name: 'Source Name',
            birthDate: null,
            thumbnailPath: '',
            color: null,
            species: null,
            isHidden: false,
            isFavorite: false,
            faceAssetId: null,
            identityId: 'identity-source',
          },
        ],
        [{ id: 'source-face', personId: 'source-person', deletedAt: null, isVisible: true }],
      );
      const sut = new PersonRepository(db as never);

      const result = await sut.mergePersonProfile(
        { sourcePersonId: 'source-person', targetPersonId: 'target-person', targetIdentityId: 'identity-target' },
        db as never,
      );

      expect(result.targetNeedsFeatureFaceRepair).toBe(true);
      expect(db.people).toEqual([
        expect.objectContaining({ id: 'target-person', faceAssetId: 'missing-feature-face' }),
      ]);
      expect(db.faces).toEqual([{ id: 'source-face', personId: 'target-person', deletedAt: null, isVisible: true }]);
    });
  });
});

describe(SharedSpaceRepository.name, () => {
  describe('mergeSpacePersonProfile', () => {
    it('preserves target shared-space name, birth date, hidden state, representative face, and metadata sources', async () => {
      const db = new SharedSpaceMergeDb(
        [
          {
            id: 'target-person',
            name: 'Target Name',
            birthDate: '1980-01-02',
            isHidden: true,
            representativeFaceId: 'target-representative-face',
            representativeFaceSource: 'manual',
            nameSource: 'manual',
            birthDateSource: 'manual',
            faceCount: 1,
            assetCount: 1,
          },
          {
            id: 'source-person',
            name: 'Source Name',
            birthDate: '1990-03-04',
            isHidden: false,
            representativeFaceId: 'source-representative-face',
            representativeFaceSource: 'auto',
            nameSource: 'profile',
            birthDateSource: 'profile',
            faceCount: 1,
            assetCount: 1,
          },
        ],
        [
          { personId: 'target-person', assetFaceId: 'target-face', assetId: 'target-asset' },
          { personId: 'source-person', assetFaceId: 'source-face', assetId: 'source-asset' },
        ],
        [],
      );
      const sut = new TestSharedSpaceRepository(db);

      await sut.mergeSpacePersonProfile(
        { sourcePersonId: 'source-person', targetPersonId: 'target-person' },
        db as never,
      );

      expect(sut.reassignPersonFacesSafeCalls).toEqual([
        { fromPersonId: 'source-person', toPersonId: 'target-person' },
      ]);
      expect(db.people).toEqual([
        expect.objectContaining({
          id: 'target-person',
          name: 'Target Name',
          birthDate: '1980-01-02',
          isHidden: true,
          representativeFaceId: 'target-representative-face',
          representativeFaceSource: 'manual',
          nameSource: 'manual',
          birthDateSource: 'manual',
        }),
      ]);
    });

    it('migrates aliases while keeping existing survivor aliases', async () => {
      const db = new SharedSpaceMergeDb(
        [
          {
            id: 'target-person',
            name: 'Target Name',
            birthDate: null,
            isHidden: false,
            representativeFaceId: null,
            representativeFaceSource: 'auto',
            nameSource: 'none',
            birthDateSource: 'none',
            faceCount: 0,
            assetCount: 0,
          },
          {
            id: 'source-person',
            name: 'Source Name',
            birthDate: null,
            isHidden: false,
            representativeFaceId: null,
            representativeFaceSource: 'auto',
            nameSource: 'none',
            birthDateSource: 'none',
            faceCount: 0,
            assetCount: 0,
          },
        ],
        [],
        [
          { personId: 'target-person', userId: 'user-1', alias: 'Target Alias' },
          { personId: 'source-person', userId: 'user-1', alias: 'Source Alias Loses' },
          { personId: 'source-person', userId: 'user-2', alias: 'Source Alias Moves' },
        ],
      );
      const sut = new TestSharedSpaceRepository(db);

      await sut.mergeSpacePersonProfile(
        { sourcePersonId: 'source-person', targetPersonId: 'target-person' },
        db as never,
      );

      expect(db.aliases).toEqual([
        { personId: 'target-person', userId: 'user-1', alias: 'Target Alias' },
        { personId: 'target-person', userId: 'user-2', alias: 'Source Alias Moves' },
      ]);
    });

    it('recounts face and asset counts after shared-space profile merge', async () => {
      const db = new SharedSpaceMergeDb(
        [
          {
            id: 'target-person',
            name: 'Target Name',
            birthDate: null,
            isHidden: false,
            representativeFaceId: null,
            representativeFaceSource: 'auto',
            nameSource: 'none',
            birthDateSource: 'none',
            faceCount: 0,
            assetCount: 0,
          },
          {
            id: 'source-person',
            name: 'Source Name',
            birthDate: null,
            isHidden: false,
            representativeFaceId: null,
            representativeFaceSource: 'auto',
            nameSource: 'none',
            birthDateSource: 'none',
            faceCount: 0,
            assetCount: 0,
          },
        ],
        [
          { personId: 'target-person', assetFaceId: 'target-face', assetId: 'asset-a' },
          { personId: 'source-person', assetFaceId: 'source-face-1', assetId: 'asset-b' },
          { personId: 'source-person', assetFaceId: 'source-face-2', assetId: 'asset-b' },
        ],
        [],
      );
      const sut = new TestSharedSpaceRepository(db);

      await sut.mergeSpacePersonProfile(
        { sourcePersonId: 'source-person', targetPersonId: 'target-person' },
        db as never,
      );

      expect(db.people).toEqual([expect.objectContaining({ id: 'target-person', faceCount: 3, assetCount: 2 })]);
    });
  });
});

describe('IdentityMergePropagationService', () => {
  describe('buildPersonalMergePlan', () => {
    it('plans personal merge propagation into duplicate space people across multiple spaces', async () => {
      const target = {
        kind: 'person',
        id: 'person-x',
        ownerId: 'owner-1',
        identityId: 'identity-x',
        type: 'person',
        name: 'X',
        faceCount: 10,
      } satisfies MergeProfile;
      const source = {
        kind: 'person',
        id: 'person-y',
        ownerId: 'owner-1',
        identityId: 'identity-y',
        type: 'person',
        name: 'Y',
        faceCount: 4,
      } satisfies MergeProfile;
      const spaceAX = {
        kind: 'space-person',
        id: 'space-a-x',
        spaceId: 'space-a',
        identityId: 'identity-x',
        type: 'person',
        name: 'X',
        faceCount: 3,
      } satisfies MergeProfile;
      const spaceAY = {
        kind: 'space-person',
        id: 'space-a-y',
        spaceId: 'space-a',
        identityId: 'identity-y',
        type: 'person',
        name: 'Y',
        faceCount: 2,
      } satisfies MergeProfile;
      const spaceBX = {
        kind: 'space-person',
        id: 'space-b-x',
        spaceId: 'space-b',
        identityId: 'identity-x',
        type: 'person',
        name: 'X',
        faceCount: 8,
      } satisfies MergeProfile;
      const spaceBY = {
        kind: 'space-person',
        id: 'space-b-y',
        spaceId: 'space-b',
        identityId: 'identity-y',
        type: 'person',
        name: 'Y',
        faceCount: 1,
      } satisfies MergeProfile;
      const { sut } = makeService([target, source, spaceAX, spaceAY, spaceBX, spaceBY]);

      const plan = await sut.buildPersonalMergePlan({
        actorUserId: 'owner-1',
        targetPersonId: 'person-x',
        sourcePersonIds: ['person-y'],
      });

      expect(plan.actorUserId).toBe('owner-1');
      expect(plan.origin).toEqual({
        type: 'person',
        targetProfileId: 'person-x',
        sourceProfileIds: ['person-y'],
        ownerId: 'owner-1',
      });
      expect(plan.targetIdentityId).toBe('identity-x');
      expect(plan.sourceIdentityIds).toEqual(['identity-y']);
      expect(plan.personalProfileMerges).toEqual([
        { ownerId: 'owner-1', targetPersonId: 'person-x', sourcePersonIds: ['person-y'] },
      ]);
      expect(plan.spaceProfileMerges).toEqual([
        { spaceId: 'space-a', targetPersonId: 'space-a-x', sourcePersonIds: ['space-a-y'] },
        { spaceId: 'space-b', targetPersonId: 'space-b-x', sourcePersonIds: ['space-b-y'] },
      ]);
      expect(plan.affectedSpaceIds).toEqual(['space-a', 'space-b']);
      expect(plan.followUpJobs).toEqual([
        { name: JobName.SharedSpacePersonMetadataBackfill, data: { identityId: 'identity-x' } },
        { name: JobName.SharedSpacePersonDedup, data: { spaceId: 'space-a' } },
        { name: JobName.SharedSpacePersonDedup, data: { spaceId: 'space-b' } },
      ]);
      expect(plan.activityEvents).toEqual([
        expect.objectContaining({ spaceId: 'space-a', userId: 'owner-1', type: SharedSpaceActivityType.PersonMerge }),
        expect.objectContaining({ spaceId: 'space-b', userId: 'owner-1', type: SharedSpaceActivityType.PersonMerge }),
      ]);
    });

    it('keeps a single affected space profile and updates it to the target identity', async () => {
      const { sut } = makeService([
        profile({ kind: 'person', id: 'person-x', ownerId: 'owner-1', identityId: 'identity-x', faceCount: 10 }),
        profile({ kind: 'person', id: 'person-y', ownerId: 'owner-1', identityId: 'identity-y', faceCount: 4 }),
        profile({ kind: 'space-person', id: 'space-a-y', spaceId: 'space-a', identityId: 'identity-y' }),
      ]);

      const plan = await sut.buildPersonalMergePlan({
        actorUserId: 'owner-1',
        targetPersonId: 'person-x',
        sourcePersonIds: ['person-y'],
      });

      expect(plan.spaceProfileMerges).toEqual([]);
      expect(plan.profileIdentityUpdates).toEqual([
        { kind: 'space-person', profileId: 'space-a-y', identityId: 'identity-x' },
      ]);
      expect(plan.affectedSpaceIds).toEqual(['space-a']);
    });

    it('uses deterministic survivor fallback outside the initiating scope', async () => {
      const { sut } = makeService([
        profile({ kind: 'person', id: 'person-x', ownerId: 'owner-1', identityId: 'identity-x', faceCount: 10 }),
        profile({ kind: 'person', id: 'person-y', ownerId: 'owner-1', identityId: 'identity-y', faceCount: 4 }),
        profile({ kind: 'person', id: 'person-z', ownerId: 'owner-1', identityId: 'identity-z', faceCount: 5 }),
        profile({ kind: 'person', id: 'owner-2-low', ownerId: 'owner-2', identityId: 'identity-y', faceCount: 1 }),
        profile({ kind: 'person', id: 'owner-2-high', ownerId: 'owner-2', identityId: 'identity-z', faceCount: 9 }),
      ]);

      const plan = await sut.buildPersonalMergePlan({
        actorUserId: 'owner-1',
        targetPersonId: 'person-x',
        sourcePersonIds: ['person-y', 'person-z'],
      });

      expect(plan.personalProfileMerges).toEqual([
        { ownerId: 'owner-1', targetPersonId: 'person-x', sourcePersonIds: ['person-z', 'person-y'] },
        { ownerId: 'owner-2', targetPersonId: 'owner-2-high', sourcePersonIds: ['owner-2-low'] },
      ]);
    });

    it('prefers named survivor candidates over unnamed candidates with equal face counts outside the initiating scope', async () => {
      const { sut } = makeService([
        profile({ kind: 'person', id: 'person-x', ownerId: 'owner-1', identityId: 'identity-x', faceCount: 10 }),
        profile({ kind: 'person', id: 'person-y', ownerId: 'owner-1', identityId: 'identity-y', faceCount: 4 }),
        profile({ kind: 'person', id: 'person-z', ownerId: 'owner-1', identityId: 'identity-z', faceCount: 4 }),
        profile({
          kind: 'person',
          id: 'owner-2-a',
          ownerId: 'owner-2',
          identityId: 'identity-y',
          name: '',
          faceCount: 5,
        }),
        profile({
          kind: 'person',
          id: 'owner-2-b',
          ownerId: 'owner-2',
          identityId: 'identity-z',
          name: 'Named candidate',
          faceCount: 5,
        }),
      ]);

      const plan = await sut.buildPersonalMergePlan({
        actorUserId: 'owner-1',
        targetPersonId: 'person-x',
        sourcePersonIds: ['person-y', 'person-z'],
      });

      expect(plan.personalProfileMerges).toEqual([
        { ownerId: 'owner-1', targetPersonId: 'person-x', sourcePersonIds: ['person-y', 'person-z'] },
        { ownerId: 'owner-2', targetPersonId: 'owner-2-b', sourcePersonIds: ['owner-2-a'] },
      ]);
    });

    it('deduplicates duplicate source ids before planning', async () => {
      const { sut, faceIdentityRepository } = makeService([
        profile({ kind: 'person', id: 'person-x', ownerId: 'owner-1', identityId: 'identity-x' }),
        profile({ kind: 'person', id: 'person-y', ownerId: 'owner-1', identityId: 'identity-y' }),
      ]);

      const plan = await sut.buildPersonalMergePlan({
        actorUserId: 'owner-1',
        targetPersonId: 'person-x',
        sourcePersonIds: ['person-y', 'person-y'],
      });

      expect(plan.origin.sourceProfileIds).toEqual(['person-y']);
      expect(plan.sourceIdentityIds).toEqual(['identity-y']);
      expect(plan.personalProfileMerges).toEqual([
        { ownerId: 'owner-1', targetPersonId: 'person-x', sourcePersonIds: ['person-y'] },
      ]);
      expect(faceIdentityRepository.ensurePersonIdentity).toHaveBeenCalledTimes(2);
    });

    it('ensures origin profiles with missing identities before planning attached profiles', async () => {
      const profiles = [
        profile({ kind: 'person', id: 'person-x', ownerId: 'owner-1', identityId: null, faceCount: 10 }),
        profile({ kind: 'person', id: 'person-y', ownerId: 'owner-1', identityId: null, faceCount: 4 }),
        profile({
          kind: 'space-person',
          id: 'space-a-y',
          spaceId: 'space-a',
          identityId: 'identity-for-person-y',
        }),
      ];
      const { sut, faceIdentityRepository } = makeService(profiles);

      const plan = await sut.buildPersonalMergePlan({
        actorUserId: 'owner-1',
        targetPersonId: 'person-x',
        sourcePersonIds: ['person-y'],
      });

      expect(faceIdentityRepository.ensurePersonIdentity.mock.calls.map(([personId]) => personId)).toEqual([
        'person-x',
        'person-y',
      ]);
      expect(faceIdentityRepository.getMergePropagationProfiles).toHaveBeenNthCalledWith(
        2,
        {
          mode: 'identities',
          identityIds: ['identity-for-person-x', 'identity-for-person-y'],
        },
        void 0,
      );
      expect(plan.targetIdentityId).toBe('identity-for-person-x');
      expect(plan.sourceIdentityIds).toEqual(['identity-for-person-y']);
      expect(plan.profileIdentityUpdates).toEqual([
        { kind: 'space-person', profileId: 'space-a-y', identityId: 'identity-for-person-x' },
      ]);
    });

    it('ignores source identity ids already equal to the target identity', async () => {
      const { sut } = makeService([
        profile({ kind: 'person', id: 'person-x', ownerId: 'owner-1', identityId: 'identity-x', faceCount: 10 }),
        profile({ kind: 'person', id: 'person-y', ownerId: 'owner-1', identityId: 'identity-x', faceCount: 4 }),
        profile({ kind: 'person', id: 'person-z', ownerId: 'owner-1', identityId: 'identity-z', faceCount: 2 }),
      ]);

      const plan = await sut.buildPersonalMergePlan({
        actorUserId: 'owner-1',
        targetPersonId: 'person-x',
        sourcePersonIds: ['person-y', 'person-z'],
      });

      expect(plan.sourceIdentityIds).toEqual(['identity-z']);
      expect(plan.personalProfileMerges).toEqual([
        { ownerId: 'owner-1', targetPersonId: 'person-x', sourcePersonIds: ['person-y', 'person-z'] },
      ]);
    });

    it('rejects missing initiating target or source profiles before execution', async () => {
      const { sut } = makeService([
        profile({ kind: 'person', id: 'person-x', ownerId: 'owner-1', identityId: 'identity-x' }),
      ]);

      await expect(
        sut.buildPersonalMergePlan({
          actorUserId: 'owner-1',
          targetPersonId: 'person-x',
          sourcePersonIds: ['person-y'],
        }),
      ).rejects.toThrow('Source person not found');
    });

    it('allows mixed person and pet personal merges so the target type wins', async () => {
      const { sut } = makeService([
        profile({ kind: 'person', id: 'person-x', ownerId: 'owner-1', identityId: 'identity-x', type: 'person' }),
        profile({ kind: 'person', id: 'person-y', ownerId: 'owner-1', identityId: 'identity-y', type: 'pet' }),
      ]);

      const plan = await sut.buildPersonalMergePlan({
        actorUserId: 'owner-1',
        targetPersonId: 'person-x',
        sourcePersonIds: ['person-y'],
      });

      expect(plan.personalProfileMerges).toEqual([
        { ownerId: 'owner-1', targetPersonId: 'person-x', sourcePersonIds: ['person-y'] },
      ]);
      expect(plan.targetIdentityId).toBe('identity-x');
      expect(plan.sourceIdentityIds).toEqual(['identity-y']);
    });

    it('includes actor, follow-up jobs, and propagated activity events in the plan', async () => {
      const { sut } = makeService([
        profile({ kind: 'person', id: 'person-x', ownerId: 'owner-1', identityId: 'identity-x', faceCount: 10 }),
        profile({ kind: 'person', id: 'person-y', ownerId: 'owner-1', identityId: 'identity-y', faceCount: 4 }),
        profile({ kind: 'space-person', id: 'space-a-y', spaceId: 'space-a', identityId: 'identity-y' }),
      ]);

      const plan = await sut.buildPersonalMergePlan({
        actorUserId: 'owner-1',
        targetPersonId: 'person-x',
        sourcePersonIds: ['person-y'],
      });

      expect(plan.actorUserId).toBe('owner-1');
      expect(plan.followUpJobs).toEqual([
        { name: JobName.SharedSpacePersonMetadataBackfill, data: { identityId: 'identity-x' } },
        { name: JobName.SharedSpacePersonDedup, data: { spaceId: 'space-a' } },
      ]);
      expect(plan.activityEvents).toEqual([
        {
          spaceId: 'space-a',
          userId: 'owner-1',
          type: SharedSpaceActivityType.PersonMerge,
          data: {
            originScope: 'person',
            actorUserId: 'owner-1',
            activityRole: 'propagated',
            originatingSpaceId: null,
            targetProfileId: 'person-x',
            sourceProfileIds: ['person-y'],
            targetIdentityId: 'identity-x',
            sourceIdentityIds: ['identity-y'],
            affectedPersonalProfileMergeCount: 1,
            affectedSharedSpaceProfileMergeCount: 0,
            affectedSpaceIds: ['space-a'],
          },
        },
      ]);
    });
  });

  describe('buildSpaceMergePlan', () => {
    it('plans initiating-space merge and personal profile merges for affected owners', async () => {
      const { sut } = makeService([
        profile({ kind: 'space-person', id: 'space-a-x', spaceId: 'space-a', identityId: 'identity-x', faceCount: 10 }),
        profile({ kind: 'space-person', id: 'space-a-y', spaceId: 'space-a', identityId: 'identity-y', faceCount: 4 }),
        profile({ kind: 'person', id: 'owner-1-x', ownerId: 'owner-1', identityId: 'identity-x', faceCount: 8 }),
        profile({ kind: 'person', id: 'owner-1-y', ownerId: 'owner-1', identityId: 'identity-y', faceCount: 2 }),
      ]);

      const plan = await sut.buildSpaceMergePlan({
        actorUserId: 'editor-1',
        spaceId: 'space-a',
        targetPersonId: 'space-a-x',
        sourcePersonIds: ['space-a-y'],
      });

      expect(plan.origin).toEqual({
        type: 'space-person',
        targetProfileId: 'space-a-x',
        sourceProfileIds: ['space-a-y'],
        spaceId: 'space-a',
      });
      expect(plan.targetIdentityId).toBe('identity-x');
      expect(plan.sourceIdentityIds).toEqual(['identity-y']);
      expect(plan.spaceProfileMerges).toEqual([
        { spaceId: 'space-a', targetPersonId: 'space-a-x', sourcePersonIds: ['space-a-y'] },
      ]);
      expect(plan.personalProfileMerges).toEqual([
        { ownerId: 'owner-1', targetPersonId: 'owner-1-x', sourcePersonIds: ['owner-1-y'] },
      ]);
      expect(plan.affectedOwnerIds).toEqual(['owner-1']);
      expect(plan.affectedSpaceIds).toEqual(['space-a']);
    });

    it('plans identity updates for owners with only one affected personal profile', async () => {
      const { sut } = makeService([
        profile({ kind: 'space-person', id: 'space-a-x', spaceId: 'space-a', identityId: 'identity-x', faceCount: 10 }),
        profile({ kind: 'space-person', id: 'space-a-y', spaceId: 'space-a', identityId: 'identity-y', faceCount: 4 }),
        profile({ kind: 'person', id: 'owner-2-y', ownerId: 'owner-2', identityId: 'identity-y', faceCount: 2 }),
      ]);

      const plan = await sut.buildSpaceMergePlan({
        actorUserId: 'editor-1',
        spaceId: 'space-a',
        targetPersonId: 'space-a-x',
        sourcePersonIds: ['space-a-y'],
      });

      expect(plan.personalProfileMerges).toEqual([]);
      expect(plan.profileIdentityUpdates).toContainEqual({
        kind: 'person',
        profileId: 'owner-2-y',
        identityId: 'identity-x',
      });
      expect(plan.affectedOwnerIds).toEqual(['owner-2']);
    });

    it('includes initiating-space activity and propagated activity for other affected spaces', async () => {
      const { sut } = makeService([
        profile({ kind: 'space-person', id: 'space-a-x', spaceId: 'space-a', identityId: 'identity-x', faceCount: 10 }),
        profile({ kind: 'space-person', id: 'space-a-y', spaceId: 'space-a', identityId: 'identity-y', faceCount: 4 }),
        profile({ kind: 'space-person', id: 'space-b-x', spaceId: 'space-b', identityId: 'identity-x', faceCount: 8 }),
        profile({ kind: 'space-person', id: 'space-b-y', spaceId: 'space-b', identityId: 'identity-y', faceCount: 1 }),
      ]);

      const plan = await sut.buildSpaceMergePlan({
        actorUserId: 'editor-1',
        spaceId: 'space-a',
        targetPersonId: 'space-a-x',
        sourcePersonIds: ['space-a-y'],
      });

      expect(plan.spaceProfileMerges).toEqual([
        { spaceId: 'space-a', targetPersonId: 'space-a-x', sourcePersonIds: ['space-a-y'] },
        { spaceId: 'space-b', targetPersonId: 'space-b-x', sourcePersonIds: ['space-b-y'] },
      ]);
      expect(plan.followUpJobs).toEqual([
        { name: JobName.SharedSpacePersonMetadataBackfill, data: { identityId: 'identity-x' } },
        { name: JobName.SharedSpacePersonDedup, data: { spaceId: 'space-a' } },
        { name: JobName.SharedSpacePersonDedup, data: { spaceId: 'space-b' } },
      ]);
      expect(plan.activityEvents).toEqual([
        expect.objectContaining({
          spaceId: 'space-a',
          data: expect.objectContaining({ originScope: 'space-person', activityRole: 'initiating' }),
        }),
        expect.objectContaining({
          spaceId: 'space-b',
          data: expect.objectContaining({ originScope: 'space-person', activityRole: 'propagated' }),
        }),
      ]);
    });

    it('plans propagated merges in every other space with duplicate profiles', async () => {
      const { sut } = makeService([
        profile({ kind: 'space-person', id: 'space-a-x', spaceId: 'space-a', identityId: 'identity-x', faceCount: 10 }),
        profile({ kind: 'space-person', id: 'space-a-y', spaceId: 'space-a', identityId: 'identity-y', faceCount: 4 }),
        profile({ kind: 'space-person', id: 'space-b-x', spaceId: 'space-b', identityId: 'identity-x', faceCount: 8 }),
        profile({ kind: 'space-person', id: 'space-b-y', spaceId: 'space-b', identityId: 'identity-y', faceCount: 1 }),
        profile({ kind: 'space-person', id: 'space-c-y', spaceId: 'space-c', identityId: 'identity-y', faceCount: 2 }),
      ]);

      const plan = await sut.buildSpaceMergePlan({
        actorUserId: 'editor-1',
        spaceId: 'space-a',
        targetPersonId: 'space-a-x',
        sourcePersonIds: ['space-a-y'],
      });

      expect(plan.spaceProfileMerges).toEqual([
        { spaceId: 'space-a', targetPersonId: 'space-a-x', sourcePersonIds: ['space-a-y'] },
        { spaceId: 'space-b', targetPersonId: 'space-b-x', sourcePersonIds: ['space-b-y'] },
      ]);
      expect(plan.profileIdentityUpdates).toContainEqual({
        kind: 'space-person',
        profileId: 'space-c-y',
        identityId: 'identity-x',
      });
      expect(plan.affectedSpaceIds).toEqual(['space-a', 'space-b', 'space-c']);
      expect(plan.followUpJobs).toEqual([
        { name: JobName.SharedSpacePersonMetadataBackfill, data: { identityId: 'identity-x' } },
        { name: JobName.SharedSpacePersonDedup, data: { spaceId: 'space-a' } },
        { name: JobName.SharedSpacePersonDedup, data: { spaceId: 'space-b' } },
        { name: JobName.SharedSpacePersonDedup, data: { spaceId: 'space-c' } },
      ]);
    });

    it('keeps other-space single profiles and updates identity only', async () => {
      const { sut } = makeService([
        profile({ kind: 'space-person', id: 'space-a-x', spaceId: 'space-a', identityId: 'identity-x', faceCount: 10 }),
        profile({ kind: 'space-person', id: 'space-a-y', spaceId: 'space-a', identityId: 'identity-y', faceCount: 4 }),
        profile({ kind: 'space-person', id: 'space-c-y', spaceId: 'space-c', identityId: 'identity-y', faceCount: 2 }),
      ]);

      const plan = await sut.buildSpaceMergePlan({
        actorUserId: 'editor-1',
        spaceId: 'space-a',
        targetPersonId: 'space-a-x',
        sourcePersonIds: ['space-a-y'],
      });

      expect(plan.spaceProfileMerges).toEqual([
        { spaceId: 'space-a', targetPersonId: 'space-a-x', sourcePersonIds: ['space-a-y'] },
      ]);
      expect(plan.profileIdentityUpdates.filter((update) => update.kind === 'space-person')).toEqual([
        { kind: 'space-person', profileId: 'space-c-y', identityId: 'identity-x' },
      ]);
      expect(plan.affectedSpaceIds).toEqual(['space-a', 'space-c']);
    });

    it('deduplicates affected space ids for jobs and activity', async () => {
      const { sut } = makeService([
        profile({ kind: 'space-person', id: 'space-a-x', spaceId: 'space-a', identityId: 'identity-x', faceCount: 10 }),
        profile({ kind: 'space-person', id: 'space-a-y', spaceId: 'space-a', identityId: 'identity-y', faceCount: 4 }),
        profile({ kind: 'space-person', id: 'space-a-z', spaceId: 'space-a', identityId: 'identity-z', faceCount: 2 }),
        profile({ kind: 'space-person', id: 'space-b-x', spaceId: 'space-b', identityId: 'identity-x', faceCount: 8 }),
        profile({ kind: 'space-person', id: 'space-b-y', spaceId: 'space-b', identityId: 'identity-y', faceCount: 1 }),
        profile({ kind: 'space-person', id: 'space-b-z', spaceId: 'space-b', identityId: 'identity-z', faceCount: 3 }),
        profile({ kind: 'space-person', id: 'space-c-y', spaceId: 'space-c', identityId: 'identity-y', faceCount: 2 }),
      ]);

      const plan = await sut.buildSpaceMergePlan({
        actorUserId: 'editor-1',
        spaceId: 'space-a',
        targetPersonId: 'space-a-x',
        sourcePersonIds: ['space-a-y', 'space-a-y', 'space-a-z'],
      });

      expect(plan.origin.sourceProfileIds).toEqual(['space-a-y', 'space-a-z']);
      expect(plan.sourceIdentityIds).toEqual(['identity-y', 'identity-z']);
      expect(plan.affectedSpaceIds).toEqual(['space-a', 'space-b', 'space-c']);
      expect(plan.followUpJobs).toEqual([
        { name: JobName.SharedSpacePersonMetadataBackfill, data: { identityId: 'identity-x' } },
        { name: JobName.SharedSpacePersonDedup, data: { spaceId: 'space-a' } },
        { name: JobName.SharedSpacePersonDedup, data: { spaceId: 'space-b' } },
        { name: JobName.SharedSpacePersonDedup, data: { spaceId: 'space-c' } },
      ]);
      expect(plan.activityEvents.map((event) => event.spaceId)).toEqual(['space-a', 'space-b', 'space-c']);
    });

    it('plans personal propagation and other-space activity without requiring actor membership in other scopes', async () => {
      const { sut, mocks } = makeService([
        profile({ kind: 'space-person', id: 'space-a-x', spaceId: 'space-a', identityId: 'identity-x', faceCount: 10 }),
        profile({ kind: 'space-person', id: 'space-a-y', spaceId: 'space-a', identityId: 'identity-y', faceCount: 4 }),
        profile({ kind: 'person', id: 'owner-2-x', ownerId: 'owner-2', identityId: 'identity-x', faceCount: 5 }),
        profile({ kind: 'person', id: 'owner-2-y', ownerId: 'owner-2', identityId: 'identity-y', faceCount: 3 }),
        profile({ kind: 'space-person', id: 'space-b-x', spaceId: 'space-b', identityId: 'identity-x', faceCount: 6 }),
        profile({ kind: 'space-person', id: 'space-b-y', spaceId: 'space-b', identityId: 'identity-y', faceCount: 1 }),
      ]);

      const plan = await sut.buildSpaceMergePlan({
        actorUserId: 'editor-1',
        spaceId: 'space-a',
        targetPersonId: 'space-a-x',
        sourcePersonIds: ['space-a-y'],
      });

      expect(mocks.sharedSpace.getPersonById.mock.calls.map(([personId]) => personId)).toEqual([
        'space-a-x',
        'space-a-y',
      ]);
      expect(plan.personalProfileMerges).toContainEqual({
        ownerId: 'owner-2',
        targetPersonId: 'owner-2-x',
        sourcePersonIds: ['owner-2-y'],
      });
      expect(plan.spaceProfileMerges).toEqual([
        { spaceId: 'space-a', targetPersonId: 'space-a-x', sourcePersonIds: ['space-a-y'] },
        { spaceId: 'space-b', targetPersonId: 'space-b-x', sourcePersonIds: ['space-b-y'] },
      ]);
      expect(plan.activityEvents.map((event) => event.spaceId)).toEqual(['space-a', 'space-b']);
    });

    it('plans singleton identity updates for other spaces', async () => {
      const { sut } = makeService([
        profile({ kind: 'space-person', id: 'space-a-x', spaceId: 'space-a', identityId: 'identity-x', faceCount: 10 }),
        profile({ kind: 'space-person', id: 'space-a-y', spaceId: 'space-a', identityId: 'identity-y', faceCount: 4 }),
        profile({ kind: 'space-person', id: 'space-b-y', spaceId: 'space-b', identityId: 'identity-y', faceCount: 1 }),
      ]);

      const plan = await sut.buildSpaceMergePlan({
        actorUserId: 'editor-1',
        spaceId: 'space-a',
        targetPersonId: 'space-a-x',
        sourcePersonIds: ['space-a-y'],
      });

      expect(plan.profileIdentityUpdates.filter((update) => update.kind === 'space-person')).toEqual([
        { kind: 'space-person', profileId: 'space-b-y', identityId: 'identity-x' },
      ]);
      expect(plan.activityEvents.map((event) => event.spaceId)).toEqual(['space-a', 'space-b']);
    });
  });

  describe('executePlan for personal-origin propagation', () => {
    it('merges personal profiles before collapsing identities', async () => {
      const { sut, mocks } = makeService([]);

      await sut.executePlan(
        {
          actorUserId: 'owner-1',
          origin: {
            type: 'person',
            targetProfileId: 'person-x',
            sourceProfileIds: ['person-y'],
            ownerId: 'owner-1',
          },
          targetIdentityId: 'identity-x',
          sourceIdentityIds: ['identity-y'],
          personalProfileMerges: [{ ownerId: 'owner-1', targetPersonId: 'person-x', sourcePersonIds: ['person-y'] }],
          spaceProfileMerges: [],
          profileIdentityUpdates: [],
          affectedOwnerIds: ['owner-1'],
          affectedSpaceIds: [],
          followUpJobs: [],
          activityEvents: [],
        },
        { actorUserId: 'owner-1' },
      );

      expect(mocks.person.mergePersonProfile).toHaveBeenCalledWith(
        { sourcePersonId: 'person-y', targetPersonId: 'person-x', targetIdentityId: 'identity-x' },
        expect.anything(),
      );
      expect(mocks.person.mergePersonProfile.mock.invocationCallOrder[0]).toBeLessThan(
        mocks.faceIdentity.mergeIdentitiesAfterProfileResolution.mock.invocationCallOrder[0],
      );
      expect(mocks.faceIdentity.mergeIdentitiesAfterProfileResolution).toHaveBeenCalledWith(
        { targetIdentityId: 'identity-x', sourceIdentityIds: ['identity-y'], source: 'manual' },
        expect.anything(),
      );
    });

    it('links moved personal faces to the target identity with manual source before collapsing identities', async () => {
      const { sut, mocks } = makeService([]);

      await sut.executePlan(
        {
          actorUserId: 'owner-1',
          origin: {
            type: 'person',
            targetProfileId: 'person-x',
            sourceProfileIds: ['person-y'],
            ownerId: 'owner-1',
          },
          targetIdentityId: 'identity-x',
          sourceIdentityIds: ['identity-y'],
          personalProfileMerges: [{ ownerId: 'owner-1', targetPersonId: 'person-x', sourcePersonIds: ['person-y'] }],
          spaceProfileMerges: [],
          profileIdentityUpdates: [],
          affectedOwnerIds: ['owner-1'],
          affectedSpaceIds: [],
          followUpJobs: [],
          activityEvents: [],
        },
        { actorUserId: 'owner-1' },
      );

      expect(mocks.faceIdentity.linkPersonFaces).toHaveBeenCalledWith(
        { personId: 'person-x', identityId: 'identity-x', source: 'manual' },
        expect.anything(),
      );
      expect(mocks.faceIdentity.linkPersonFaces.mock.invocationCallOrder[0]).toBeLessThan(
        mocks.faceIdentity.mergeIdentitiesAfterProfileResolution.mock.invocationCallOrder[0],
      );
    });

    it('queues source person thumbnail cleanup for deleted personal profiles', async () => {
      const { sut, mocks } = makeService([]);
      mocks.person.mergePersonProfile.mockResolvedValueOnce({
        deletedThumbnailPath: '/source-person-thumb.jpg',
        targetNeedsFeatureFaceRepair: false,
      });

      await sut.executePlan(
        {
          actorUserId: 'owner-1',
          origin: {
            type: 'person',
            targetProfileId: 'person-x',
            sourceProfileIds: ['person-y'],
            ownerId: 'owner-1',
          },
          targetIdentityId: 'identity-x',
          sourceIdentityIds: ['identity-y'],
          personalProfileMerges: [{ ownerId: 'owner-1', targetPersonId: 'person-x', sourcePersonIds: ['person-y'] }],
          spaceProfileMerges: [],
          profileIdentityUpdates: [],
          affectedOwnerIds: ['owner-1'],
          affectedSpaceIds: [],
          followUpJobs: [],
          activityEvents: [],
        },
        { actorUserId: 'owner-1' },
      );

      expect(mocks.job.queue).toHaveBeenCalledWith({
        name: JobName.FileDelete,
        data: { files: ['/source-person-thumb.jpg'] },
      });
    });

    it('repairs missing personal survivor feature faces and queues thumbnail regeneration', async () => {
      const { sut, mocks, transaction } = makeService([]);
      mocks.person.mergePersonProfile.mockResolvedValueOnce({
        deletedThumbnailPath: null,
        targetNeedsFeatureFaceRepair: true,
      });
      mocks.person.getRandomFace.mockResolvedValueOnce({ id: 'replacement-face' });

      await sut.executePlan(
        {
          actorUserId: 'owner-1',
          origin: {
            type: 'person',
            targetProfileId: 'person-x',
            sourceProfileIds: ['person-y'],
            ownerId: 'owner-1',
          },
          targetIdentityId: 'identity-x',
          sourceIdentityIds: ['identity-y'],
          personalProfileMerges: [{ ownerId: 'owner-1', targetPersonId: 'person-x', sourcePersonIds: ['person-y'] }],
          spaceProfileMerges: [],
          profileIdentityUpdates: [],
          affectedOwnerIds: ['owner-1'],
          affectedSpaceIds: [],
          followUpJobs: [],
          activityEvents: [],
        },
        { actorUserId: 'owner-1' },
      );

      expect(mocks.person.getRandomFace).toHaveBeenCalledWith('person-x', transaction);
      expect(mocks.person.update).toHaveBeenCalledWith(
        { id: 'person-x', faceAssetId: 'replacement-face' },
        transaction,
      );
      expect(mocks.job.queue).toHaveBeenCalledWith({
        name: JobName.PersonGenerateThumbnail,
        data: { id: 'person-x' },
      });
    });

    it('merges duplicate space profiles before collapsing identities', async () => {
      const { sut, mocks } = makeService([]);

      await sut.executePlan(
        {
          actorUserId: 'owner-1',
          origin: {
            type: 'person',
            targetProfileId: 'person-x',
            sourceProfileIds: ['person-y'],
            ownerId: 'owner-1',
          },
          targetIdentityId: 'identity-x',
          sourceIdentityIds: ['identity-y'],
          personalProfileMerges: [],
          spaceProfileMerges: [{ spaceId: 'space-a', targetPersonId: 'space-a-x', sourcePersonIds: ['space-a-y'] }],
          profileIdentityUpdates: [],
          affectedOwnerIds: [],
          affectedSpaceIds: ['space-a'],
          followUpJobs: [],
          activityEvents: [],
        },
        { actorUserId: 'owner-1' },
      );

      expect(mocks.sharedSpace.mergeSpacePersonProfile).toHaveBeenCalledWith(
        { sourcePersonId: 'space-a-y', targetPersonId: 'space-a-x' },
        expect.anything(),
      );
      expect(mocks.sharedSpace.mergeSpacePersonProfile.mock.invocationCallOrder[0]).toBeLessThan(
        mocks.faceIdentity.mergeIdentitiesAfterProfileResolution.mock.invocationCallOrder[0],
      );
    });

    it('repairs shared-space representative faces before queueing space dedup jobs', async () => {
      const { sut, mocks, transaction } = makeService([]);

      await sut.executePlan(
        {
          actorUserId: 'owner-1',
          origin: {
            type: 'person',
            targetProfileId: 'person-x',
            sourceProfileIds: ['person-y'],
            ownerId: 'owner-1',
          },
          targetIdentityId: 'identity-x',
          sourceIdentityIds: ['identity-y'],
          personalProfileMerges: [],
          spaceProfileMerges: [{ spaceId: 'space-a', targetPersonId: 'space-a-x', sourcePersonIds: ['space-a-y'] }],
          profileIdentityUpdates: [],
          affectedOwnerIds: [],
          affectedSpaceIds: ['space-a'],
          followUpJobs: [{ name: JobName.SharedSpacePersonDedup, data: { spaceId: 'space-a' } }],
          activityEvents: [],
        },
        { actorUserId: 'owner-1' },
      );

      expect(mocks.sharedSpace.repairInvalidRepresentativeFaces).toHaveBeenCalledWith('space-a', transaction);
      expect(mocks.sharedSpace.repairOrphanedRepresentativeFaces).toHaveBeenCalledWith('space-a', transaction);
      expect(mocks.sharedSpace.mergeSpacePersonProfile.mock.invocationCallOrder[0]).toBeLessThan(
        mocks.sharedSpace.repairInvalidRepresentativeFaces.mock.invocationCallOrder[0],
      );
      expect(mocks.sharedSpace.repairOrphanedRepresentativeFaces.mock.invocationCallOrder[0]).toBeLessThan(
        mocks.job.queue.mock.invocationCallOrder[0],
      );
    });

    it('updates single affected profiles to the target identity without deleting them', async () => {
      const { sut, mocks } = makeService([]);

      await sut.executePlan(
        {
          actorUserId: 'owner-1',
          origin: {
            type: 'person',
            targetProfileId: 'person-x',
            sourceProfileIds: ['person-y'],
            ownerId: 'owner-1',
          },
          targetIdentityId: 'identity-x',
          sourceIdentityIds: ['identity-y'],
          personalProfileMerges: [],
          spaceProfileMerges: [],
          profileIdentityUpdates: [
            { kind: 'person', profileId: 'person-z', identityId: 'identity-x' },
            { kind: 'space-person', profileId: 'space-a-y', identityId: 'identity-x' },
          ],
          affectedOwnerIds: ['owner-2'],
          affectedSpaceIds: ['space-a'],
          followUpJobs: [],
          activityEvents: [],
        },
        { actorUserId: 'owner-1' },
      );

      expect(mocks.person.updatePersonIdentity).toHaveBeenCalledWith(
        { personId: 'person-z', identityId: 'identity-x' },
        expect.anything(),
      );
      expect(mocks.sharedSpace.updateSpacePersonIdentity).toHaveBeenCalledWith(
        { personId: 'space-a-y', identityId: 'identity-x' },
        expect.anything(),
      );
      expect(mocks.person.mergePersonProfile).not.toHaveBeenCalled();
      expect(mocks.sharedSpace.mergeSpacePersonProfile).not.toHaveBeenCalled();
    });

    it('queues metadata backfill and shared-space dedup for affected spaces once', async () => {
      const { sut, mocks } = makeService([]);

      await sut.executePlan(
        {
          actorUserId: 'owner-1',
          origin: {
            type: 'person',
            targetProfileId: 'person-x',
            sourceProfileIds: ['person-y'],
            ownerId: 'owner-1',
          },
          targetIdentityId: 'identity-x',
          sourceIdentityIds: ['identity-y'],
          personalProfileMerges: [],
          spaceProfileMerges: [],
          profileIdentityUpdates: [],
          affectedOwnerIds: [],
          affectedSpaceIds: ['space-a', 'space-b'],
          followUpJobs: [
            { name: JobName.SharedSpacePersonMetadataBackfill, data: { identityId: 'identity-x' } },
            { name: JobName.SharedSpacePersonDedup, data: { spaceId: 'space-a' } },
            { name: JobName.SharedSpacePersonDedup, data: { spaceId: 'space-a' } },
            { name: JobName.SharedSpacePersonDedup, data: { spaceId: 'space-b' } },
          ],
          activityEvents: [],
        },
        { actorUserId: 'owner-1' },
      );

      expect(mocks.job.queue).toHaveBeenCalledTimes(3);
      expect(mocks.job.queue).toHaveBeenCalledWith({
        name: JobName.SharedSpacePersonMetadataBackfill,
        data: { identityId: 'identity-x' },
      });
      expect(mocks.job.queue).toHaveBeenCalledWith({
        name: JobName.SharedSpacePersonDedup,
        data: { spaceId: 'space-a' },
      });
      expect(mocks.job.queue).toHaveBeenCalledWith({
        name: JobName.SharedSpacePersonDedup,
        data: { spaceId: 'space-b' },
      });
    });

    it('runs DB mutations inside one transaction and passes the transaction to every mutation helper', async () => {
      const { sut, mocks, transaction } = makeService([]);

      await sut.executePlan(
        {
          actorUserId: 'owner-1',
          origin: {
            type: 'person',
            targetProfileId: 'person-x',
            sourceProfileIds: ['person-y'],
            ownerId: 'owner-1',
          },
          targetIdentityId: 'identity-x',
          sourceIdentityIds: ['identity-y'],
          personalProfileMerges: [{ ownerId: 'owner-1', targetPersonId: 'person-x', sourcePersonIds: ['person-y'] }],
          spaceProfileMerges: [{ spaceId: 'space-a', targetPersonId: 'space-a-x', sourcePersonIds: ['space-a-y'] }],
          profileIdentityUpdates: [
            { kind: 'person', profileId: 'person-z', identityId: 'identity-x' },
            { kind: 'space-person', profileId: 'space-a-z', identityId: 'identity-x' },
          ],
          affectedOwnerIds: ['owner-1'],
          affectedSpaceIds: ['space-a'],
          followUpJobs: [],
          activityEvents: [
            {
              spaceId: 'space-a',
              userId: 'owner-1',
              type: SharedSpaceActivityType.PersonMerge,
              data: {
                originScope: 'person',
                actorUserId: 'owner-1',
                activityRole: 'propagated',
                originatingSpaceId: null,
                targetProfileId: 'person-x',
                sourceProfileIds: ['person-y'],
                targetIdentityId: 'identity-x',
                sourceIdentityIds: ['identity-y'],
                affectedPersonalProfileMergeCount: 1,
                affectedSharedSpaceProfileMergeCount: 1,
                affectedSpaceIds: ['space-a'],
              },
            },
          ],
        },
        { actorUserId: 'owner-1' },
      );

      expect(mocks.database.transaction).toHaveBeenCalledTimes(1);
      expect(mocks.person.mergePersonProfile).toHaveBeenCalledWith(expect.anything(), transaction);
      expect(mocks.faceIdentity.linkPersonFaces).toHaveBeenCalledWith(expect.anything(), transaction);
      expect(mocks.sharedSpace.mergeSpacePersonProfile).toHaveBeenCalledWith(expect.anything(), transaction);
      expect(mocks.person.updatePersonIdentity).toHaveBeenCalledWith(expect.anything(), transaction);
      expect(mocks.sharedSpace.updateSpacePersonIdentity).toHaveBeenCalledWith(expect.anything(), transaction);
      expect(mocks.faceIdentity.mergeIdentitiesAfterProfileResolution).toHaveBeenCalledWith(
        expect.anything(),
        transaction,
      );
      expect(mocks.sharedSpace.logActivity).toHaveBeenCalledWith(expect.anything(), transaction);
    });

    it('does not queue follow-up jobs when identity collapse fails', async () => {
      const { sut, mocks } = makeService([]);

      mocks.faceIdentity.mergeIdentitiesAfterProfileResolution.mockRejectedValueOnce(new Error('collapse failed'));

      await expect(
        sut.executePlan(
          {
            actorUserId: 'owner-1',
            origin: {
              type: 'person',
              targetProfileId: 'person-x',
              sourceProfileIds: ['person-y'],
              ownerId: 'owner-1',
            },
            targetIdentityId: 'identity-x',
            sourceIdentityIds: ['identity-y'],
            personalProfileMerges: [{ ownerId: 'owner-1', targetPersonId: 'person-x', sourcePersonIds: ['person-y'] }],
            spaceProfileMerges: [],
            profileIdentityUpdates: [],
            affectedOwnerIds: ['owner-1'],
            affectedSpaceIds: ['space-a'],
            followUpJobs: [{ name: JobName.SharedSpacePersonMetadataBackfill, data: { identityId: 'identity-x' } }],
            activityEvents: [],
          },
          { actorUserId: 'owner-1' },
        ),
      ).rejects.toThrow('collapse failed');

      expect(mocks.database.transaction).toHaveBeenCalledTimes(1);
      expect(mocks.job.queue).not.toHaveBeenCalled();
    });

    it('logs and returns success when follow-up queueing fails after the transaction commits', async () => {
      const { sut, mocks } = makeService([
        profile({ kind: 'person', id: 'person-x', ownerId: 'owner-1', identityId: 'identity-x' }),
        profile({ kind: 'person', id: 'person-y', ownerId: 'owner-1', identityId: 'identity-y' }),
        profile({ kind: 'space-person', id: 'space-a-y', spaceId: 'space-a', identityId: 'identity-y' }),
      ]);
      mocks.job.queue.mockRejectedValueOnce(new Error('queue failed'));

      await expect(
        sut.mergePersonalPeople({ user: { id: 'owner-1' } } as never, 'person-x', ['person-y']),
      ).resolves.toEqual([{ id: 'person-y', success: true }]);

      expect(mocks.database.transaction).toHaveBeenCalledTimes(1);
      expect(mocks.person.mergePersonProfile).toHaveBeenCalled();
      expect(mocks.faceIdentity.mergeIdentitiesAfterProfileResolution).toHaveBeenCalled();
      expect(mocks.sharedSpace.logActivity).toHaveBeenCalledWith(
        expect.objectContaining({ spaceId: 'space-a', type: SharedSpaceActivityType.PersonMerge }),
        expect.anything(),
      );
      expect(mocks.logger.error).toHaveBeenCalledWith(
        expect.stringContaining('Failed to queue merge propagation follow-up jobs'),
        expect.any(String),
      );
    });
  });

  describe('activity fanout', () => {
    it('writes initiating activity for the origin space and propagated activity for every affected other space', async () => {
      const { sut, mocks } = makeService([
        profile({ kind: 'space-person', id: 'space-a-x', spaceId: 'space-a', identityId: 'identity-x', faceCount: 10 }),
        profile({ kind: 'space-person', id: 'space-a-y', spaceId: 'space-a', identityId: 'identity-y', faceCount: 4 }),
        profile({ kind: 'space-person', id: 'space-b-x', spaceId: 'space-b', identityId: 'identity-x', faceCount: 8 }),
        profile({ kind: 'space-person', id: 'space-b-y', spaceId: 'space-b', identityId: 'identity-y', faceCount: 1 }),
        profile({ kind: 'space-person', id: 'space-c-y', spaceId: 'space-c', identityId: 'identity-y', faceCount: 2 }),
      ]);

      const plan = await sut.buildSpaceMergePlan({
        actorUserId: 'editor-1',
        spaceId: 'space-a',
        targetPersonId: 'space-a-x',
        sourcePersonIds: ['space-a-y'],
      });
      await sut.executePlan(plan, { actorUserId: 'editor-1' });

      expect(mocks.sharedSpace.logActivity).toHaveBeenCalledTimes(3);
      expect(mocks.sharedSpace.logActivity).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          spaceId: 'space-a',
          data: expect.objectContaining({
            originScope: 'space-person',
            activityRole: 'initiating',
            originatingSpaceId: 'space-a',
            targetIdentityId: 'identity-x',
            sourceIdentityIds: ['identity-y'],
            affectedSpaceIds: ['space-a', 'space-b', 'space-c'],
          }),
        }),
        expect.anything(),
      );
      expect(mocks.sharedSpace.logActivity).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          spaceId: 'space-b',
          data: expect.objectContaining({
            originScope: 'space-person',
            activityRole: 'propagated',
            originatingSpaceId: 'space-a',
            targetIdentityId: 'identity-x',
            sourceIdentityIds: ['identity-y'],
            affectedSpaceIds: ['space-a', 'space-b', 'space-c'],
          }),
        }),
        expect.anything(),
      );
      expect(mocks.sharedSpace.logActivity).toHaveBeenNthCalledWith(
        3,
        expect.objectContaining({
          spaceId: 'space-c',
          data: expect.objectContaining({
            originScope: 'space-person',
            activityRole: 'propagated',
            originatingSpaceId: 'space-a',
            targetIdentityId: 'identity-x',
            sourceIdentityIds: ['identity-y'],
            affectedSpaceIds: ['space-a', 'space-b', 'space-c'],
          }),
        }),
        expect.anything(),
      );
    });

    it('does not write duplicate activity when duplicate source ids are provided', async () => {
      const { sut, mocks } = makeService([
        profile({ kind: 'space-person', id: 'space-a-x', spaceId: 'space-a', identityId: 'identity-x', faceCount: 10 }),
        profile({ kind: 'space-person', id: 'space-a-y', spaceId: 'space-a', identityId: 'identity-y', faceCount: 4 }),
        profile({ kind: 'space-person', id: 'space-b-y', spaceId: 'space-b', identityId: 'identity-y', faceCount: 2 }),
      ]);

      const plan = await sut.buildSpaceMergePlan({
        actorUserId: 'editor-1',
        spaceId: 'space-a',
        targetPersonId: 'space-a-x',
        sourcePersonIds: ['space-a-y', 'space-a-y'],
      });
      await sut.executePlan(plan, { actorUserId: 'editor-1' });

      expect(plan.origin.sourceProfileIds).toEqual(['space-a-y']);
      expect(mocks.sharedSpace.logActivity).toHaveBeenCalledTimes(2);
      expect(mocks.sharedSpace.logActivity.mock.calls.map(([event]) => event.spaceId)).toEqual(['space-a', 'space-b']);
    });
  });
});
