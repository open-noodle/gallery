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
    // #1041 (slice 9): folder view is a personal-timeline surface now — the album arm gates on the
    // VIEWER's own per-user hide (a shared_space_album_hidden NOT EXISTS), not the shared
    // showInTimeline flag, which governs only the space's own Photos tab (§3). This test used to
    // assert the OPPOSITE (`"showInTimeline" = `) — that assertion described exactly the #1041 bug.
    it("album arm gates on the viewer's personal hide (shared_space_album_hidden), not the shared showInTimeline flag", () => {
      const db = offlineKysely();
      const sut = new ViewRepository(db as never);
      const query = db
        .selectFrom('asset')
        .where((eb) => (sut as any).ownedOrSpaceAccessible(eb, '00000000-0000-0000-0000-000000000000'))
        .selectAll('asset')
        .compile();
      expect(query.sql).toContain('shared_space_album_hidden');
      expect(query.sql).not.toContain('"showInTimeline" = ');
    });
  });
});
