import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  analyzeUpstreamFkKeys,
  upstreamFkRegistryPath,
  type UpstreamKey,
} from './upstream-fk-keys';

const registry: Record<string, UpstreamKey> = {
  person_pkey: {
    table: 'person',
    columns: ['id'],
    forkForeignKeys: ['face_person_verdict_personId_fkey'],
  },
  album_pkey: {
    table: 'album',
    columns: ['id'],
    forkForeignKeys: ['shared_space_album_albumId_fkey'],
  },
};

const migration = (text: string) => [
  { path: 'server/src/schema/migrations/1800000000000-Test.ts', text },
];

describe('analyzeUpstreamFkKeys', () => {
  it('flags a migration that drops a listed key (the ClusterGroups case)', () => {
    const result = analyzeUpstreamFkKeys(
      registry,
      migration(`
        await sql\`ALTER TABLE "person" DROP CONSTRAINT "person_pkey";\`.execute(db);
        await sql\`ALTER TABLE "person" DROP COLUMN "id";\`.execute(db);
      `),
    );

    expect(result.ok).toBe(false);
    expect(result.details).toHaveLength(1);
    expect(result.details[0]).toContain('1800000000000-Test.ts');
    expect(result.details[0]).toContain('drops or renames person_pkey');
    expect(result.details[0]).toContain('changes column person.id');
    expect(result.details[0]).toContain('face_person_verdict_personId_fkey');
  });

  it('flags a type change, a rename and a drop of the referenced table or column', () => {
    for (const statement of [
      'ALTER TABLE "album" ALTER COLUMN "id" TYPE text',
      'ALTER TABLE "album" RENAME COLUMN "id" TO "albumId"',
      'ALTER TABLE "album" RENAME TO "albums"',
      'DROP TABLE IF EXISTS "album"',
    ]) {
      const result = analyzeUpstreamFkKeys(
        registry,
        migration(`await sql\`${statement};\`.execute(db);`),
      );
      expect(result.ok, statement).toBe(false);
    }
  });

  it('ignores changes that leave the listed keys alone', () => {
    const result = analyzeUpstreamFkKeys(
      registry,
      migration(`
        await sql\`ALTER TABLE "album" ADD COLUMN "foo" text;\`.execute(db);
        await sql\`ALTER TABLE "album" DROP COLUMN "description";\`.execute(db);
        await sql\`ALTER TABLE "album_asset" DROP COLUMN "id";\`.execute(db);
        await sql\`CREATE TABLE "person_group" ("id" uuid, CONSTRAINT "person_group_pkey" PRIMARY KEY ("id"));\`.execute(db);
      `),
    );

    expect(result).toEqual({
      ok: true,
      title: 'Upstream migrations vs fork FKs on upstream keys',
      details: [],
    });
  });

  it('reads the repo registry, which lists the person_group sidecar FKs', () => {
    const file = path.resolve(process.cwd(), '../..', upstreamFkRegistryPath);
    const { keys } = JSON.parse(fs.readFileSync(file, 'utf8')) as {
      keys: Record<string, UpstreamKey>;
    };

    expect(keys.person_group_pkey.forkForeignKeys).toEqual(
      expect.arrayContaining([
        'person_identity_personGroupId_fkey',
        'person_pet_personGroupId_fkey',
      ]),
    );
    const result = analyzeUpstreamFkKeys(
      keys,
      migration(
        'await sql`ALTER TABLE "person_group" DROP CONSTRAINT "person_group_pkey";`.execute(db);',
      ),
    );
    expect(result.ok).toBe(false);
  });
});
