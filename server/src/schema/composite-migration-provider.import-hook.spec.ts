import { CompositeMigrationProvider } from 'src/schema/composite-migration-provider.js';
import { describe, expect, it } from 'vitest';

// Unlike composite-migration-provider.spec.ts, this file does not mock `kysely` — it exercises the
// real FileMigrationProvider against on-disk fixtures to prove migrations actually load under ESM.
// Kysely's FileMigrationProvider needs an explicit `import` hook to load .js migration files once
// the server runs as ESM; without it, this fails with "Please specify an import function".
describe('CompositeMigrationProvider (real FileMigrationProvider, ESM import hook)', () => {
  it('loads migrations from every folder under ESM', async () => {
    const provider = new CompositeMigrationProvider([
      new URL('__fixtures__/migrations-a', import.meta.url).pathname,
      new URL('__fixtures__/migrations-b', import.meta.url).pathname,
    ]);
    const migrations = await provider.getMigrations();
    expect(Object.keys(migrations).sort()).toEqual(['1000000000000-A', '2000000000000-B']);
  });
});
