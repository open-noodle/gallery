import { schemaFromCode } from '@immich/sql-tools';
import { VERSION_ENTRY_TABLES, VERSION_TABLE_POLICY } from 'src/gallery/repositories/asset-version.repository.js';
import 'src/schema/index.js';

// A file that goes behind its photo is hidden for good, so every table that points at an asset needs an answer to
// "what happens to this file's rows then" (AssetVersionRepository.pair). This spec fails when Immich or Gallery adds a
// table that points at an asset, until someone gives it that answer in VERSION_TABLE_POLICY.
describe('VERSION_TABLE_POLICY', () => {
  const schema = schemaFromCode({ overrides: true, namingStrategy: 'default' });
  const pointingAtAssets = schema.tables
    .filter((table) =>
      table.constraints.some(
        (constraint) => constraint.type === 'foreign-key' && constraint.referenceTableName === 'asset',
      ),
    )
    .map((table) => table.name)
    .toSorted();

  it('has an answer for every table that points at an asset, and for no other', () => {
    expect(Object.keys(VERSION_TABLE_POLICY).toSorted()).toEqual(pointingAtAssets);
  });

  it('removes from a file going behind exactly the entries the policy says go', () => {
    const removed = Object.entries(VERSION_TABLE_POLICY)
      .filter(([, policy]) => ['same-on-photo', 'removed'].includes(policy))
      .map(([table]) => table)
      .toSorted();
    expect([...VERSION_ENTRY_TABLES].toSorted()).toEqual(removed);
  });
});
