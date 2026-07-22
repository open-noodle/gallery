import { schemaFromCode } from '@immich/sql-tools';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import 'src/schema';

// Companion to migration-override-parity.spec.ts, which pins FUNCTION DDL. A trigger has no
// `registerFunction(...).expression` to compare against — it is generated from a decorator
// (`@AfterDeleteTrigger` on AlbumSpaceAssetTable) by sql-tools' asTriggerCreate. sql-tools compares
// `migration_overrides` rows by exact string equality, so if the decorator's options ever stop
// reproducing the DDL its migration executed (scope, transition table, a stray `when`), every
// deployed DB drifts again — and nothing else in the suite would notice.
//
// This lives in its own file because migration-override-parity.spec.ts mocks `kysely`'s `sql` tag,
// under which importing `src/schema` throws.
//
// Same options as DatabaseRepository.getSchemaDrift so the generated text matches what actually
// runs against a database.
const overrides = schemaFromCode({ overrides: true, namingStrategy: 'default' }).overrides;

const overrideSql = (name: string): string => {
  const override = overrides.find((element) => element.name === name);
  if (!override) {
    throw new Error(`no override named ${name} was generated from the declarative schema`);
  }
  return (override.value as { sql: string }).sql;
};

const migrationSource = (filename: string): string =>
  readFileSync(join(process.cwd(), 'src/schema/migrations-gallery', filename), 'utf8');

describe('album_space_asset_delete_audit trigger parity (#764, migration 1783100000000)', () => {
  it('generates trigger DDL byte-identical to the statement the migration executed', () => {
    // Verbatim from 1783100000000-AddAlbumSpaceAssetSyncAndAudit.ts. Asserted against the migration
    // source below too, so this literal cannot silently rot away from it.
    const expected = `CREATE OR REPLACE TRIGGER "album_space_asset_delete_audit"
  AFTER DELETE ON "album_space_asset"
  REFERENCING OLD TABLE AS "old"
  FOR EACH STATEMENT
  EXECUTE FUNCTION album_space_asset_delete_audit();`;

    expect(overrideSql('trigger_album_space_asset_delete_audit')).toBe(expected);

    // The migration executes this as a plain (unescaped) template literal, so the source contains
    // the text verbatim — no template-literal unescaping to hand-simulate.
    expect(migrationSource('1783100000000-AddAlbumSpaceAssetSyncAndAudit.ts')).toContain(expected);
  });

  // The pre-existing updatedAt trigger on the same table, as a control: proves the assertion above
  // is exercising real generation rather than an accident of how this one trigger is declared.
  it('keeps the sibling updatedAt trigger on the same table in parity', () => {
    const expected = `CREATE OR REPLACE TRIGGER "album_space_asset_updatedAt"
  BEFORE UPDATE ON "album_space_asset"
  FOR EACH ROW
  EXECUTE FUNCTION updated_at();`;

    expect(overrideSql('trigger_album_space_asset_updatedAt')).toBe(expected);
    expect(migrationSource('1783100000000-AddAlbumSpaceAssetSyncAndAudit.ts')).toContain(expected);
  });
});
