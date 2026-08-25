import {
  CompiledQuery,
  DummyDriver,
  Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
} from 'kysely';
import { DateTime } from 'luxon';
import { AssetOrderWithRandom } from 'src/enum';
import { MemoryRepository } from 'src/repositories/memory.repository';
import type { DB } from 'src/schema';

const offlineDialect = () => ({
  createAdapter: () => new PostgresAdapter(),
  createDriver: () => new DummyDriver(),
  createIntrospector: (db: Kysely<DB>) => new PostgresIntrospector(db),
  createQueryCompiler: () => new PostgresQueryCompiler(),
});

const offlineKysely = () => new Kysely<DB>({ dialect: offlineDialect() });

/**
 * `searchAccessible` ends in `.execute()`, so its SQL cannot be reached through `.compile()`
 * the way the builders can. The DummyDriver still runs the query (returning no rows) and Kysely
 * still emits the compiled statement to `log`, so recording it there is the only way to assert
 * on the query the fork's served path actually sends.
 */
const recordingRepository = () => {
  const queries: CompiledQuery[] = [];
  const db = new Kysely<DB>({
    dialect: offlineDialect(),
    log: (event) => {
      if (event.level === 'query') {
        queries.push(event.query);
      }
    },
  });

  return { sut: new MemoryRepository(db), queries, last: () => queries.at(-1)! };
};

const userId = '00000000-0000-0000-0000-000000000000';

describe(MemoryRepository.name, () => {
  const sut = new MemoryRepository(offlineKysely());

  describe('accessibleSearchBuilder', () => {
    it('album arm requires showInTimeline on memory projection surfaces', () => {
      const sut = new MemoryRepository(offlineKysely());
      const query = (sut as any)
        .accessibleSearchBuilder('00000000-0000-0000-0000-000000000000', {})
        .select((eb: any) => eb.lit(1).as('one'))
        .compile();
      expect(query.sql).toContain('"showInTimeline" = ');
    });
  });

  describe('searchBuilder', () => {
    it('excludes future scheduled memories when no date filter is provided', () => {
      const now = vi.spyOn(DateTime, 'now').mockReturnValue(DateTime.fromISO('2026-04-30T12:00:00Z') as DateTime<true>);

      try {
        const query = sut.searchBuilder('00000000-0000-0000-0000-000000000000', {}).selectAll('memory').compile();

        expect(query.sql).toContain('("showAt" is null or "showAt" <= $1)');
        expect(query.sql).not.toContain('"hideAt"');
        expect(query.parameters).toEqual([
          new Date('2026-04-30T12:00:00.000Z'),
          '00000000-0000-0000-0000-000000000000',
        ]);
      } finally {
        now.mockRestore();
      }
    });

    it('filters by the full visibility window when a date filter is provided', () => {
      const query = sut
        .searchBuilder('00000000-0000-0000-0000-000000000000', { for: new Date('2026-04-30T12:00:00.000Z') })
        .selectAll('memory')
        .compile();

      expect(query.sql).toContain('("showAt" is null or "showAt" <= $1)');
      expect(query.sql).toContain('("hideAt" is null or "hideAt" >= $2)');
      expect(query.parameters).toEqual([
        new Date('2026-04-30T12:00:00.000Z'),
        new Date('2026-04-30T12:00:00.000Z'),
        '00000000-0000-0000-0000-000000000000',
      ]);
    });
  });
  // Regression guards for the immich-28675 rebase. `GET /memories` is served by
  // `searchAccessible`, not by upstream's `search`, so upstream's contract has to be asserted
  // against the fork's copy or it silently drifts.
  describe('searchAccessible', () => {
    it('leaves showAt scoping to the caller, so the index can show upcoming memories', async () => {
      // Upstream's index sends `isUpcoming: undefined` for "show upcoming" and `false` for
      // "hide upcoming". #486's implicit guard would filter the upcoming ones back out of the
      // first case, leaving the Upcoming section permanently empty.
      const { sut, last } = recordingRepository();

      await sut.searchAccessible(userId, { size: 250, order: AssetOrderWithRandom.Desc });

      expect(last().sql).not.toContain('"showAt" <=');
    });

    it('honours an explicit isUpcoming: false, which is how the index hides upcoming memories', async () => {
      const { sut, last } = recordingRepository();

      await sut.searchAccessible(userId, { isUpcoming: false });

      // The assets subquery consumes the leading placeholders, so match the shape, not $1.
      expect(last().sql).toMatch(/\("showAt" is null or "showAt" <= \$\d+\)/);
    });

    it('honours an explicit isUpcoming: true without contradicting it', async () => {
      const { sut, last } = recordingRepository();

      await sut.searchAccessible(userId, { isUpcoming: true });

      expect(last().sql).toMatch(/"showAt" > \$\d+/);
      expect(last().sql).not.toContain('"showAt" <=');
    });

    it('keeps the memory lane bounded by its own date window', async () => {
      const { sut, last } = recordingRepository();

      await sut.searchAccessible(userId, { for: new Date('2026-04-30T12:00:00.000Z') });

      expect(last().sql).toMatch(/\("showAt" is null or "showAt" <= \$\d+\)/);
      expect(last().sql).toMatch(/\("hideAt" is null or "hideAt" >= \$\d+\)/);
    });

    it('filters to a single memory when the caller passes an id', async () => {
      // memoryManager.loadMemory(id) deep-links straight to this. Without the filter the server
      // returns an arbitrary memory and the viewer opens the wrong one.
      const { sut, last } = recordingRepository();
      const memoryId = '11111111-1111-4111-8111-111111111111';

      await sut.searchAccessible(userId, { id: memoryId });

      expect(last().sql).toContain('"id" = $');
      expect(last().parameters).toContain(memoryId);
    });

    it('offsets by page so pagination advances past the first page', async () => {
      const { sut, last } = recordingRepository();

      await sut.searchAccessible(userId, { size: 250, page: 3 });

      expect(last().sql).toContain('limit');
      expect(last().sql).toContain('offset');
      expect(last().parameters).toEqual(expect.arrayContaining([250, 500]));
    });

    it('does not offset without a page size to offset by', async () => {
      const { sut, last } = recordingRepository();

      await sut.searchAccessible(userId, { page: 3 });

      expect(last().sql).not.toContain('offset');
    });

    it('orders exactly like upstream search: showAt first, nulls last', async () => {
      const { sut, last } = recordingRepository();

      await sut.searchAccessible(userId, { order: AssetOrderWithRandom.Desc });
      const accessible = last().sql.slice(last().sql.lastIndexOf('order by'));

      await sut.search(userId, { order: AssetOrderWithRandom.Desc });
      const upstream = last().sql.slice(last().sql.lastIndexOf('order by'));

      expect(accessible).toBe(upstream);
      expect(accessible).toContain('order by "showAt" desc nulls last, "memoryAt" desc');
    });

    it('orders ascending when asked, still matching upstream search', async () => {
      const { sut, last } = recordingRepository();

      await sut.searchAccessible(userId, { order: AssetOrderWithRandom.Asc });
      const accessible = last().sql.slice(last().sql.lastIndexOf('order by'));

      await sut.search(userId, { order: AssetOrderWithRandom.Asc });
      const upstream = last().sql.slice(last().sql.lastIndexOf('order by'));

      expect(accessible).toBe(upstream);
      expect(accessible).toContain('order by "showAt" asc nulls last, "memoryAt" asc');
    });
  });
});
