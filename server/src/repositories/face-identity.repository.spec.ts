import { FaceIdentityRepository } from 'src/repositories/face-identity.repository';

type QueryRecord = {
  table: string;
  where: unknown[];
};

const makeDb = (rows: Record<string, Array<Record<string, unknown>>>) => {
  const queries: QueryRecord[] = [];
  const db = {
    selectFrom: vi.fn((table: string) => {
      const query: QueryRecord = { table, where: [] };
      queries.push(query);

      const builder = {
        select: vi.fn((selection: unknown) => {
          if (typeof selection === 'function') {
            selection({
              selectFrom: () => ({
                select: () => ({
                  whereRef: () => ({
                    as: () => 0,
                  }),
                }),
              }),
            });
          }

          return builder;
        }),
        where: vi.fn((...args: unknown[]) => {
          query.where = args;
          return builder;
        }),
        execute: vi.fn(() => {
          const tableRows = rows[table] ?? [];
          const [column, operator, values] = query.where as [
            string | undefined,
            string | undefined,
            string[] | undefined,
          ];
          if (operator !== 'in' || !column || !values) {
            return tableRows;
          }

          const key = column.split('.').at(-1);
          return tableRows.filter((row) => key && values.includes(row[key] as string));
        }),
      };

      return builder;
    }),
  };

  return { db, queries };
};

describe(FaceIdentityRepository.name, () => {
  describe('getMergePropagationProfiles', () => {
    it('returns requested personal profiles in profile mode', async () => {
      const { db, queries } = makeDb({
        person: [
          {
            id: 'person-1',
            ownerId: 'owner-1',
            identityId: 'identity-1',
            type: 'person',
            name: 'Alice',
            faceCount: '4',
          },
          {
            id: 'person-2',
            ownerId: 'owner-2',
            identityId: 'identity-2',
            type: 'pet',
            name: 'Buddy',
            faceCount: 7,
          },
        ],
      });
      const sut = new FaceIdentityRepository(db as never);

      await expect(
        sut.getMergePropagationProfiles({ mode: 'profiles', personIds: ['person-1', 'person-1', ''] }),
      ).resolves.toEqual([
        {
          kind: 'person',
          id: 'person-1',
          ownerId: 'owner-1',
          identityId: 'identity-1',
          type: 'person',
          name: 'Alice',
          faceCount: 4,
        },
      ]);
      expect(queries).toMatchObject([{ table: 'person', where: ['person.id', 'in', ['person-1']] }]);
    });

    it('returns personal and shared-space profiles in identity mode', async () => {
      const { db, queries } = makeDb({
        person: [
          {
            id: 'person-1',
            ownerId: 'owner-1',
            identityId: 'identity-1',
            type: 'person',
            name: 'Alice',
            faceCount: 3,
          },
          {
            id: 'person-2',
            ownerId: 'owner-2',
            identityId: 'identity-2',
            type: 'person',
            name: 'Other',
            faceCount: 9,
          },
        ],
        shared_space_person: [
          {
            id: 'space-person-1',
            spaceId: 'space-1',
            identityId: 'identity-1',
            type: 'person',
            name: 'Alice Space',
            faceCount: '5',
          },
          {
            id: 'space-person-2',
            spaceId: 'space-2',
            identityId: 'identity-2',
            type: 'person',
            name: 'Other Space',
            faceCount: 8,
          },
        ],
      });
      const sut = new FaceIdentityRepository(db as never);

      await expect(
        sut.getMergePropagationProfiles({ mode: 'identities', identityIds: ['identity-1', 'identity-1', ''] }),
      ).resolves.toEqual([
        {
          kind: 'person',
          id: 'person-1',
          ownerId: 'owner-1',
          identityId: 'identity-1',
          type: 'person',
          name: 'Alice',
          faceCount: 3,
        },
        {
          kind: 'space-person',
          id: 'space-person-1',
          spaceId: 'space-1',
          identityId: 'identity-1',
          type: 'person',
          name: 'Alice Space',
          faceCount: 5,
        },
      ]);
      expect(queries).toMatchObject([
        { table: 'person', where: ['person.identityId', 'in', ['identity-1']] },
        { table: 'shared_space_person', where: ['shared_space_person.identityId', 'in', ['identity-1']] },
      ]);
    });

    it('rejects mixed profile and identity lookup modes', async () => {
      const sut = new FaceIdentityRepository({} as never);

      await expect(
        sut.getMergePropagationProfiles({
          mode: 'profiles',
          personIds: ['person-1'],
          identityIds: ['identity-1'],
        } as never),
      ).rejects.toThrow('Cannot lookup merge propagation profiles by profile ids and identity ids in the same call');
    });
  });
});
