// M12: sql-tools compares `migration_overrides` rows by exact string equality against the
// DDL `registerFunction(...)` in src/schema/functions.ts would emit (via its internal
// asFunctionExpression helper, surfaced here as DatabaseFunction.expression). If a
// migration's executed CREATE OR REPLACE FUNCTION / its migration_overrides `sql` value
// ever drifts from that registered expression (e.g. a hand-edit that drops comment lines
// or truncates the trailing `$$;`), a future `migrations:generate` against a DB that ran
// this migration emits a spurious FunctionCreate + OverrideUpdate. This pins both strings
// to the registered function byte-for-byte so drift fails fast, independent of a DB.
//
// Captures the literal strings passed to every `sql\`...\`` call in the migration's up()
// by mocking `kysely`'s `sql` tag — since none of this migration's templates interpolate
// values, the single element of the tagged-template `strings` array IS the exact runtime
// string (already escape-processed by the JS engine), the same text Kysely would compile
// and send to Postgres. This avoids hand-simulating template-literal escaping rules by
// regex-parsing the raw source file.
const capturedSql = vi.hoisted(() => [] as string[]);

function fakeSql(strings: TemplateStringsArray, ...values: unknown[]): { execute: () => Promise<void> } {
  if (values.length > 0) {
    throw new Error('migration-override-parity fake sql`` does not support interpolated values');
  }
  capturedSql.push(strings[0]);
  return { execute: () => Promise.resolve() };
}

vi.mock('kysely', async () => {
  const actual = await vi.importActual<typeof import('kysely')>('kysely');
  return { ...actual, sql: fakeSql };
});

import {
  album_soft_delete_shared_space_album,
  album_space_asset_delete_audit,
  shared_space_member_after_insert_album,
} from 'src/schema/functions';
// Static import (not dynamic `import()`): tsc's node16/nodenext resolution can't resolve a
// `src/`-aliased specifier inside a dynamic import expression (TS2307), unlike a static
// import. vitest hoists `vi.mock('kysely', ...)` above every import in this file regardless
// of source position (same pattern as composite-migration-provider.spec.ts), so the mock is
// already installed by the time this migration module's top-level `import { sql } from
// 'kysely'` resolves.
import { up as upAlbumSoftDelete } from 'src/schema/migrations-gallery/1782050000000-AddAlbumSoftDeleteSharedSpaceAlbumTrigger';
import { up as upAlbumSpaceAssetSyncAndAudit } from 'src/schema/migrations-gallery/1783100000000-AddAlbumSpaceAssetSyncAndAudit';
import { up as upMemberJoinGrantCreateId } from 'src/schema/migrations-gallery/1783700000000-FixSharedSpaceMemberJoinGrantCreateId';
import { up as upRepairDrift } from 'src/schema/migrations-gallery/1784800000000-RepairSharedSpaceAlbumGrantDrift';

describe('1782050000000-AddAlbumSoftDeleteSharedSpaceAlbumTrigger override parity', () => {
  beforeEach(() => {
    capturedSql.length = 0;
  });

  it('executes and overrides the function with DDL byte-identical to functions.ts', async () => {
    await upAlbumSoftDelete({} as any);

    const [executedFunctionDdl, , functionOverrideInsert] = capturedSql;

    // The registered function's DDL (functions.ts) is the source of truth `migrations:generate`
    // diffs against — both the migration's executed statement and its override row must match it
    // byte-for-byte, or a scratch-DB `migrations:generate` run emits a spurious diff.
    expect(executedFunctionDdl).toBe(album_soft_delete_shared_space_album.expression);

    const overrideValue = JSON.parse(
      functionOverrideInsert.match(/VALUES \('function_album_soft_delete_shared_space_album', '(.+)'::jsonb\)/s)![1],
    ) as { type: string; name: string; sql: string };
    expect(overrideValue.sql).toBe(album_soft_delete_shared_space_album.expression);
  });
});

// This migration REPLACED the body registered in functions.ts (ON CONFLICT DO NOTHING ->
// DO UPDATE SET createId/createdAt, fixing #752 review F-A: a re-added member whose grant
// survived removal kept its original createId, so the grant-keyed backfill never re-fired and
// contributions made during the absence stayed undeliverable). Its sibling 1782100000000 updated
// functions.ts to match; this one did not, so every DB that ran it reports FunctionCreate +
// OverrideUpdate forever — and `migrations:generate` would emit a migration REVERTING the fix.
describe('1783700000000-FixSharedSpaceMemberJoinGrantCreateId override parity', () => {
  beforeEach(() => {
    capturedSql.length = 0;
  });

  it('executes and overrides the function with DDL byte-identical to functions.ts', async () => {
    await upMemberJoinGrantCreateId({} as any);

    const [executedFunctionDdl, functionOverrideUpdate] = capturedSql;

    expect(executedFunctionDdl).toBe(shared_space_member_after_insert_album.expression);

    const overrideValue = JSON.parse(functionOverrideUpdate.match(/SET "value" = '(.+)'::jsonb/s)![1]) as {
      type: string;
      name: string;
      sql: string;
    };
    expect(overrideValue.sql).toBe(shared_space_member_after_insert_album.expression);
  });
});

// Locate a statement by content rather than index — these migrations also emit columns, tables
// and indexes whose ordering is not what these tests pin. Throws with the searched-for label
// instead of letting a miss surface as `expect(undefined).toBe(<300 chars of DDL>)`.
const findSql = (label: string, predicate: (statement: string) => boolean): string => {
  const found = capturedSql.find((element) => predicate(element));
  if (found === undefined) {
    throw new Error(`no captured statement matched ${label} (captured ${capturedSql.length} statements)`);
  }
  return found;
};

const parseOverrideValue = (statement: string): { type: string; name: string; sql: string } =>
  JSON.parse(statement.match(/'(\{.+\})'::jsonb/s)![1]) as { type: string; name: string; sql: string };

// This migration created album_space_asset_delete_audit (function + statement AFTER DELETE
// trigger) but nothing was ever registered in functions.ts / on AlbumSpaceAssetTable, so every DB
// that ran it reported FunctionDrop + two OverrideDrops. The two tools differ in how dangerous
// their suggested remediation is: `schema-check` (and the boot warning) pass
// `triggers: { ignoreExtra: true }`, so they emit no DROP TRIGGER and the bare `DROP FUNCTION`
// fails outright on the trigger dependency; `migrations:generate` passes no such option, emits
// DROP TRIGGER *before* DROP FUNCTION, and would therefore execute cleanly — silently removing
// #764's sync delete stream.
describe('1783100000000-AddAlbumSpaceAssetSyncAndAudit override parity', () => {
  beforeEach(() => {
    capturedSql.length = 0;
  });

  it('executes and overrides the delete-audit function with DDL byte-identical to functions.ts', async () => {
    await upAlbumSpaceAssetSyncAndAudit({} as any);

    const executedFunctionDdl = findSql('the delete-audit CREATE FUNCTION', (s) =>
      s.startsWith('CREATE OR REPLACE FUNCTION album_space_asset_delete_audit()'),
    );
    expect(executedFunctionDdl).toBe(album_space_asset_delete_audit.expression);

    const functionOverrideInsert = findSql('the delete-audit function override row', (s) =>
      s.includes(`VALUES ('function_album_space_asset_delete_audit'`),
    );
    expect(parseOverrideValue(functionOverrideInsert).sql).toBe(album_space_asset_delete_audit.expression);
  });

  // The trigger half. functions.ts has no counterpart to compare against (a trigger is declared by
  // the @AfterDeleteTrigger decorator on AlbumSpaceAssetTable, and importing src/schema under this
  // file's `kysely` mock blows up), so this pins the migration's two strings to each other and
  // trigger-override-parity.spec.ts pins the decorator's generated DDL to the same text. Together
  // they close the loop: decorator === executed DDL === override row.
  it('stores a trigger override row byte-identical to the trigger it executes', async () => {
    await upAlbumSpaceAssetSyncAndAudit({} as any);

    const executedTriggerDdl = findSql('the delete-audit CREATE TRIGGER', (s) =>
      s.startsWith('CREATE OR REPLACE TRIGGER "album_space_asset_delete_audit"'),
    );
    const triggerOverrideInsert = findSql('the delete-audit trigger override row', (s) =>
      s.includes(`VALUES ('trigger_album_space_asset_delete_audit'`),
    );

    expect(parseOverrideValue(triggerOverrideInsert).sql).toBe(executedTriggerDdl);
    // Guards the shape the decorator has to reproduce: statement scope, an OLD transition table,
    // and NO `WHEN` guard (FK cascades run at trigger depth > 1 and must still be tombstoned).
    expect(executedTriggerDdl).toContain('REFERENCING OLD TABLE AS "old"');
    expect(executedTriggerDdl).toContain('FOR EACH STATEMENT');
    expect(executedTriggerDdl).not.toContain('WHEN (');
  });
});

// The repair migration re-asserts all three objects for v5.2.0-rc.0 installs whose admin acted on
// the (wrong-way) drift advice. Because it writes migration_overrides rows, its DDL must match
// functions.ts byte-for-byte too — otherwise the repair would itself introduce fresh drift.
describe('1784800000000-RepairSharedSpaceAlbumGrantDrift override parity', () => {
  beforeEach(() => {
    capturedSql.length = 0;
  });

  it('re-asserts every object with DDL byte-identical to functions.ts', async () => {
    await upRepairDrift({} as any);

    const memberFn = findSql('the member-join CREATE FUNCTION', (s) =>
      s.startsWith('CREATE OR REPLACE FUNCTION shared_space_member_after_insert_album()'),
    );
    expect(memberFn).toBe(shared_space_member_after_insert_album.expression);
    expect(
      parseOverrideValue(
        findSql('the member-join override upsert', (s) =>
          s.includes(`VALUES ('function_shared_space_member_after_insert_album'`),
        ),
      ).sql,
    ).toBe(shared_space_member_after_insert_album.expression);

    const auditFn = findSql('the delete-audit CREATE FUNCTION', (s) =>
      s.startsWith('CREATE OR REPLACE FUNCTION album_space_asset_delete_audit()'),
    );
    expect(auditFn).toBe(album_space_asset_delete_audit.expression);
    expect(
      parseOverrideValue(
        findSql('the delete-audit function override upsert', (s) =>
          s.includes(`VALUES ('function_album_space_asset_delete_audit'`),
        ),
      ).sql,
    ).toBe(album_space_asset_delete_audit.expression);

    // The trigger is recreated too (a CASCADE drop takes it with the function).
    const auditTrigger = findSql('the delete-audit CREATE TRIGGER', (s) =>
      s.startsWith('CREATE OR REPLACE TRIGGER "album_space_asset_delete_audit"'),
    );
    expect(
      parseOverrideValue(
        findSql('the delete-audit trigger override upsert', (s) =>
          s.includes(`VALUES ('trigger_album_space_asset_delete_audit'`),
        ),
      ).sql,
    ).toBe(auditTrigger);
  });

  // Every statement must be safe to run against a database that is already correct.
  it('is idempotent — only CREATE OR REPLACE and override upserts, never a DROP', async () => {
    await upRepairDrift({} as any);

    expect(capturedSql.length).toBeGreaterThan(0);
    for (const statement of capturedSql) {
      expect(statement).not.toMatch(/\bDROP\b/);
      expect(statement).toMatch(/^(CREATE OR REPLACE|INSERT INTO "migration_overrides")/);
    }
    // Override writes must upsert, not blind-insert: a healthy DB already has these rows.
    const overrideWrites = capturedSql.filter((s) => s.startsWith('INSERT INTO "migration_overrides"'));
    expect(overrideWrites).toHaveLength(3);
    for (const write of overrideWrites) {
      expect(write).toContain('ON CONFLICT ("name") DO UPDATE SET "value" = EXCLUDED."value"');
    }
  });
});
