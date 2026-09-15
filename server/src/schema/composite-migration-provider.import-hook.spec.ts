import { CompositeMigrationProvider } from 'src/schema/composite-migration-provider.js';
import { describe, expect, it } from 'vitest';

// Unlike composite-migration-provider.spec.ts, this file does not mock `kysely/migration` — it
// exercises the real FileMigrationProvider against on-disk fixtures to prove migrations actually
// load under ESM. The boot-breaking fix here was the import source: Kysely 0.29 moved
// FileMigrationProvider/Migration/MigrationProvider out of the main `kysely` package into a
// `kysely/migration` subpath, so importing them from `kysely` resolved to a `KyselyTypeError` stub
// and threw "This expression is not constructable" at boot. The `import` hook passed alongside it
// (see composite-migration-provider.spec.ts for the assertion that pins it) mirrors upstream's own
// call site and is defensive rather than load-bearing here: FileMigrationProvider falls back to a
// bare `await import(filePath)` when `import` is omitted, and that fallback happens to work for the
// absolute POSIX paths this test (and the real server) use.
describe('CompositeMigrationProvider (real FileMigrationProvider, ESM)', () => {
  it('loads migrations from every folder under ESM', async () => {
    const provider = new CompositeMigrationProvider([
      new URL('__fixtures__/migrations-a', import.meta.url).pathname,
      new URL('__fixtures__/migrations-b', import.meta.url).pathname,
    ]);
    const migrations = await provider.getMigrations();
    expect(Object.keys(migrations).sort()).toEqual(['1000000000000-A', '2000000000000-B']);
  });
});
