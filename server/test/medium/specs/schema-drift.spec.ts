import { DatabaseConnectionParams, schemaDiff, schemaFromCode, schemaFromDatabase } from '@immich/sql-tools';
import 'src/schema';
import { immich_uuid_v7 } from 'src/schema/functions';
import { describe, expect, it } from 'vitest';

// The medium global setup migrates the `mich` template DB (all upstream + gallery migrations), so its
// live schema is exactly what a freshly-migrated instance boots with. This mirrors
// DatabaseRepository.getSchemaDrift() — the decorator-vs-database check the server runs on startup.
const computeDrift = async () => {
  const source = schemaFromCode({
    overrides: true,
    namingStrategy: 'default',
    uuidFunction: (version) => (version === 7 ? `${immich_uuid_v7.name}()` : 'uuid_generate_v4()'),
  });
  const connection = {
    connectionType: 'url',
    url: process.env.IMMICH_TEST_POSTGRES_URL!,
  } as DatabaseConnectionParams;
  const target = await schemaFromDatabase({ connection });
  return schemaDiff(source, target, {
    tables: { ignoreExtra: true },
    constraints: { ignoreExtra: false },
    indexes: { ignoreExtra: true },
    triggers: { ignoreExtra: true },
    columns: { ignoreExtra: true },
    functions: { ignoreExtra: false },
    parameters: { ignoreExtra: true },
    extensions: { ignoreExtra: true },
  });
};

describe('schema drift', () => {
  // General contract: any migration_overrides row whose stored `sql` doesn't byte-match what
  // schemaFromCode's asIndexCreate/asTriggerCreate would emit for that object produces boot-time
  // drift (the decorator-vs-database check the server runs on startup logs it as missing + extra +
  // "override needs to be updated"). This gate asserts there are ZERO such offenders anywhere in the
  // schema, not just for one named index — a per-index filter would silently hide new instances of
  // the same class of bug (as happened with face_repair_scan_in_flight_uq, fixed by
  // 1784000000000-FixFaceRepairScanInFlightIndexOverride, and again with the face_person_verdict
  // partial-index overrides).
  it('reports no schema drift at all (decorator/override vs a freshly-migrated DB)', async () => {
    const drift = await computeDrift();
    expect(drift.asHuman()).toEqual([]);
  });
});
