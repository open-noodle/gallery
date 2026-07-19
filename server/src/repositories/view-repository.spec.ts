import { DummyDriver, Kysely, PostgresAdapter, PostgresIntrospector, PostgresQueryCompiler } from 'kysely';
import { ViewRepository } from 'src/repositories/view-repository';
import type { DB } from 'src/schema';

const offlineKysely = () =>
  new Kysely<DB>({
    dialect: {
      createAdapter: () => new PostgresAdapter(),
      createDriver: () => new DummyDriver(),
      createIntrospector: (db) => new PostgresIntrospector(db),
      createQueryCompiler: () => new PostgresQueryCompiler(),
    },
  });

describe(ViewRepository.name, () => {
  describe('ownedOrSpaceAccessible', () => {
    it('album arm requires showInTimeline on folder-view projection surfaces', () => {
      const db = offlineKysely();
      const sut = new ViewRepository(db as never);
      const query = db
        .selectFrom('asset')
        .where((eb) => (sut as any).ownedOrSpaceAccessible(eb, '00000000-0000-0000-0000-000000000000'))
        .selectAll('asset')
        .compile();
      expect(query.sql).toContain('"showInTimeline" = ');
    });
  });
});
