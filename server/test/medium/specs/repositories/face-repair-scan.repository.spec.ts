import { Kysely } from 'kysely';
import {
  FaceRepairScanRepository,
  RepairScanParams,
  RepairScanPerson,
  ScanInProgressError,
} from 'src/repositories/face-repair-scan.repository';
import { FaceRepairRepository } from 'src/repositories/face-repair.repository';
import { DB } from 'src/schema';
import { insertPersonGroup, mediumFactory } from 'test/medium.factory';
import { getKyselyDB } from 'test/utils';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

const PARAMS: RepairScanParams = {
  maxDistance: 0.5,
  minFaces: 3,
  voteWindow: 200,
  voteMargin: 2,
  maxAttributionDistance: 0.35,
  maxFlaggedFraction: 0.5,
  largeClusterThreshold: 50,
};

const zeroTotals = () => ({
  eligibleFaces: 0,
  flaggedFaces: 0,
  toRepair: 0,
  reviewOnlyFaces: 0,
  reviewOnlyPersons: 0,
  affectedPersons: 0,
  reviewOnlyByReason: { overCap: 0, badTarget: 0, unAttributable: 0 },
});

describe(FaceRepairScanRepository.name, () => {
  let db: Kysely<DB>;
  let sut: FaceRepairScanRepository;

  beforeAll(async () => {
    db = await getKyselyDB();
    sut = new FaceRepairScanRepository(db);
  });

  afterEach(() => db.deleteFrom('face_repair_scan').execute());

  // A person with `visible` countable faces, plus optional faces that must NOT be counted.
  const insertPersonWithFaces = async (
    ownerId: string,
    visible: number,
    extra: { deleted?: number; invisible?: number; name?: string } = {},
  ) => {
    const person = mediumFactory.personInsert({ ownerId, name: extra.name ?? '' });
    await db
      .insertInto('person')
      .values({ ...person, name: extra.name ?? '' })
      .execute();
    const asset = mediumFactory.assetInsert({ ownerId });
    await db.insertInto('asset').values(asset).execute();
    const rows = [
      ...Array.from({ length: visible }, () =>
        mediumFactory.assetFaceInsert({ assetId: asset.id, personGroupId: person.personGroupId }),
      ),
      ...Array.from({ length: extra.deleted ?? 0 }, () =>
        mediumFactory.assetFaceInsert({ assetId: asset.id, personGroupId: person.personGroupId, deletedAt: new Date() }),
      ),
      ...Array.from({ length: extra.invisible ?? 0 }, () =>
        mediumFactory.assetFaceInsert({ assetId: asset.id, personGroupId: person.personGroupId, isVisible: false }),
      ),
    ];
    if (rows.length > 0) {
      await db.insertInto('asset_face').values(rows).execute();
    }
    return person.personGroupId;
  };

  const scanWith = async (
    clusterId: string,
    ownerIds: string[],
    snapshot: { faceCount?: number } = {},
  ): Promise<RepairScanPerson[]> => {
    const scan = await sut.createScan({ requestedBy: null, params: PARAMS });
    await sut.completeScan(scan.id, {
      totals: zeroTotals(),
      persons: [
        {
          personId: clusterId,
          ownerId: 'ignored-at-read-time',
          personName: null,
          faceCount: snapshot.faceCount ?? 999,
          thumbnailFaceId: null,
          eligible: 35,
          flagged: 20,
          flaggedFraction: 20 / 35,
          suspectedOwners: ownerIds.map((id) => ({
            ownerPersonId: id,
            ownerName: null,
            thumbnailFaceId: null,
            count: 20,
          })),
          recommendation: 'confident',
          reviewReasons: [],
        },
      ],
    });
    const refreshed = await sut.withCurrentNames((await sut.getLatestScan())!);
    return refreshed.persons as unknown as RepairScanPerson[];
  };

  it('creates a pending scan and returns it as the latest', async () => {
    const scan = await sut.createScan({ requestedBy: null, params: PARAMS });
    expect(scan.status).toBe('pending');

    const latest = await sut.getLatestScan();
    expect(latest?.id).toBe(scan.id);
    expect(latest?.params).toEqual(PARAMS);
    expect(latest?.persons).toEqual([]);
  });

  it('single-flight (M2): two concurrent createScan calls — one wins, the other throws ScanInProgressError', async () => {
    // The classic race: both transactions SELECT no in-flight row (neither sees the other's uncommitted insert),
    // then both INSERT. The partial unique index makes the second collide, translated to ScanInProgressError.
    const results = await Promise.allSettled([
      sut.createScan({ requestedBy: null, params: PARAMS }),
      sut.createScan({ requestedBy: null, params: PARAMS }),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toBeInstanceOf(ScanInProgressError);

    // Exactly one in-flight scan row persisted — the index held.
    const inFlight = await db
      .selectFrom('face_repair_scan')
      .select('id')
      .where('status', 'in', ['pending', 'running'])
      .execute();
    expect(inFlight).toHaveLength(1);
  });

  it('single-flight: createScan rejects with ScanInProgressError while a running scan exists', async () => {
    const first = await sut.createScan({ requestedBy: null, params: PARAMS });
    await sut.updateScanProgress(first.id, { status: 'running' });
    await expect(sut.createScan({ requestedBy: null, params: PARAMS })).rejects.toBeInstanceOf(ScanInProgressError);
  });

  // H7: `UNIQUE (status) WHERE status IN ('pending','running')` is unique on the VALUE of status, so one
  // 'pending' row and one 'running' row could coexist — two admins crossing the pending -> running
  // transition at the same time both succeed. createScan's own SELECT-then-INSERT check is advisory; the
  // index is the backstop, so this bypasses the repository and inserts directly to prove the DB constraint
  // itself, not the application-level check above, closes the race.
  describe('in-flight index (H7)', () => {
    // GIVEN a scan that has already moved from `pending` to `running`
    // WHEN a second scan row is inserted directly, bypassing createScan's advisory SELECT
    // THEN the unique index itself must reject it — the SELECT is advisory, the index is the backstop.
    it('refuses a second in-flight scan across the pending -> running transition', async () => {
      const first = await sut.createScan({ requestedBy: null, params: PARAMS });
      await sut.updateScanProgress(first.id, { status: 'running' });

      await expect(db.insertInto('face_repair_scan').values({ status: 'pending' }).execute()).rejects.toThrow(
        /face_repair_scan_in_flight_uq/,
      );
    });

    // Positive control: without this, an index that rejected EVERY insert would also pass the test above.
    it('still allows a new scan once the previous one completed', async () => {
      const first = await sut.createScan({ requestedBy: null, params: PARAMS });
      await sut.completeScan(first.id, { totals: zeroTotals(), persons: [] });
      await expect(sut.createScan({ requestedBy: null, params: PARAMS })).resolves.toBeDefined();
    });

    // The naive `CREATE UNIQUE INDEX ... WHERE status IN (...)` fails outright if the instance already
    // holds more than one in-flight row (exactly the state H7 describes) — the migration must demote every
    // in-flight row but the newest to 'failed' BEFORE creating the index, or upgrading a raced instance
    // would crash-loop on boot. Reproduces that starting state by inserting two in-flight rows directly
    // (bypassing the now-active index the same way the test above does) is not possible without dropping
    // the index first, so this asserts the migration source actually performs the demote-before-create
    // ordering rather than re-deriving Postgres's index-creation failure mode via execution.
    it("the migration demotes every in-flight scan but the newest to 'failed' before recreating the index", async () => {
      const { readFileSync } = await import('node:fs');
      const { resolve } = await import('node:path');
      // eslint-disable-next-line unicorn/prefer-module
      const thisDir = __dirname;
      const migrationPath = resolve(
        thisDir,
        '../../../../src/schema/migrations-gallery/1790000000000-FixFaceRepairScanInFlightIndex.ts',
      );
      const source = readFileSync(migrationPath, 'utf8');

      const demoteIndex = source.indexOf('SET "status" = \'failed\'');
      const createIndexIndex = source.indexOf('CREATE UNIQUE INDEX "face_repair_scan_in_flight_uq"');
      expect(demoteIndex).toBeGreaterThan(-1);
      expect(createIndexIndex).toBeGreaterThan(-1);
      // The demotion must run BEFORE the index is (re-)created, or an instance already holding more than
      // one in-flight row would fail index creation on boot instead of self-healing.
      expect(demoteIndex).toBeLessThan(createIndexIndex);
      // Keeps exactly the newest in-flight row — every OTHER in-flight row is demoted.
      expect(source).toContain('ORDER BY "createdAt" DESC LIMIT 1');
    });
  });

  it('advances progress, then completes with totals + persons and finishedAt', async () => {
    const scan = await sut.createScan({ requestedBy: null, params: PARAMS });

    await sut.updateScanProgress(scan.id, { status: 'running', progress: { scanned: 10, total: 100 } });
    let row = await sut.getScanById(scan.id);
    expect(row?.status).toBe('running');
    expect(row?.progress).toMatchObject({ scanned: 10, total: 100 });
    expect(row?.progress?.heartbeatAt).toBeDefined(); // heartbeat stamped for stale-scan detection

    const totals = {
      eligibleFaces: 5,
      flaggedFaces: 2,
      toRepair: 0,
      reviewOnlyFaces: 2,
      reviewOnlyPersons: 1,
      affectedPersons: 1,
      reviewOnlyByReason: { overCap: 2, badTarget: 0, unAttributable: 0 },
    };
    await sut.completeScan(scan.id, { totals, persons: [] });
    row = await sut.getScanById(scan.id);
    expect(row?.status).toBe('completed');
    expect(row?.totals).toEqual(totals);
    expect(row?.finishedAt).not.toBeNull();
  });

  it('fails a scan with an error message and finishedAt, no half-written report', async () => {
    const scan = await sut.createScan({ requestedBy: null, params: PARAMS });
    await sut.failScan(scan.id, 'boom');
    const row = await sut.getScanById(scan.id);
    expect(row?.status).toBe('failed');
    expect(row?.error).toBe('boom');
    expect(row?.finishedAt).not.toBeNull();
    expect(row?.totals).toBeNull();
  });

  it('refuses a second scan while one is pending/running', async () => {
    await sut.createScan({ requestedBy: null, params: PARAMS });
    await expect(sut.createScan({ requestedBy: null, params: PARAMS })).rejects.toThrow(/scan .*in progress/i);
  });

  it('failStaleScans fails lost in-flight scans past the cutoff and unblocks new scans', async () => {
    const scan = await sut.createScan({ requestedBy: null, params: PARAMS });

    // Fresh in-flight scan: not stale, untouched.
    expect(await sut.failStaleScans(60_000)).toBe(0);
    const fresh = await sut.getScanById(scan.id);
    expect(fresh?.status).toBe('pending');

    // Backdate its only sign of life beyond the cutoff (no heartbeat, no startedAt -> createdAt governs).
    await db
      .updateTable('face_repair_scan')
      .set({ createdAt: new Date(Date.now() - 120_000) })
      .where('id', '=', scan.id)
      .execute();

    expect(await sut.failStaleScans(60_000)).toBe(1);
    const row = await sut.getScanById(scan.id);
    expect(row?.status).toBe('failed');
    expect(row?.error).toContain('timed out');
    expect(row?.finishedAt).not.toBeNull();

    // The console is unblocked: a new scan can be created again.
    await expect(sut.createScan({ requestedBy: null, params: PARAMS })).resolves.toBeDefined();
  });

  it('failStaleScans honors a recent progress heartbeat over an old createdAt', async () => {
    const scan = await sut.createScan({ requestedBy: null, params: PARAMS });
    await db
      .updateTable('face_repair_scan')
      .set({ createdAt: new Date(Date.now() - 120_000) })
      .where('id', '=', scan.id)
      .execute();
    // A live worker is reporting progress — the scan must NOT be reaped despite the old createdAt.
    await sut.updateScanProgress(scan.id, { status: 'running', progress: { scanned: 1, total: 10 } });

    expect(await sut.failStaleScans(60_000)).toBe(0);
    const alive = await sut.getScanById(scan.id);
    expect(alive?.status).toBe('running');
  });

  it('pruneSupersededScans keeps only the latest', async () => {
    const first = await sut.createScan({ requestedBy: null, params: PARAMS });
    await sut.completeScan(first.id, { totals: zeroTotals(), persons: [] });
    const second = await sut.createScan({ requestedBy: null, params: PARAMS });
    await sut.completeScan(second.id, { totals: zeroTotals(), persons: [] });

    await sut.pruneSupersededScans();
    expect(await sut.getScanById(first.id)).toBeUndefined();
    const latestAfterPrune = await sut.getLatestScan();
    expect(latestAfterPrune?.id).toBe(second.id);
  });

  it('removePersonsFromLatestScan drops the given persons and recomputes flaggedFaces/affectedPersons', async () => {
    const person = (id: string, flagged: number): RepairScanPerson => ({
      personId: id,
      ownerId: '00000000-0000-4000-8000-0000000000ff',
      personName: null,
      faceCount: flagged + 2,
      thumbnailFaceId: null,
      eligible: flagged + 2,
      flagged,
      flaggedFraction: flagged / (flagged + 2),
      suspectedOwners: [],
      recommendation: 'confident',
      reviewReasons: [],
    });
    const scan = await sut.createScan({ requestedBy: null, params: PARAMS });
    await sut.completeScan(scan.id, {
      totals: { ...zeroTotals(), flaggedFaces: 15, affectedPersons: 3 },
      persons: [person('p1', 6), person('p2', 4), person('p3', 5)],
    });

    await sut.removePersonsFromLatestScan(['p1', 'p3']);

    const row = await sut.getScanById(scan.id);
    expect((row?.persons as unknown as RepairScanPerson[]).map((p) => p.personId)).toEqual(['p2']);
    expect((row?.totals as unknown as { flaggedFaces: number }).flaggedFaces).toBe(4);
    expect((row?.totals as unknown as { affectedPersons: number }).affectedPersons).toBe(1);
  });

  it('removePersonsFromLatestScan is a no-op for an empty id list', async () => {
    const scan = await sut.createScan({ requestedBy: null, params: PARAMS });
    await sut.completeScan(scan.id, { totals: zeroTotals(), persons: [] });
    await expect(sut.removePersonsFromLatestScan([])).resolves.toBeUndefined();
  });

  describe('withCurrentNames', () => {
    it('overlays the live person + owner names; a cluster named since the scan is promoted to review-first', async () => {
      const user = mediumFactory.userInsert({});
      await db.insertInto('user').values(user).execute();
      const cluster = mediumFactory.personInsert({ personGroupId: await insertPersonGroup(db, user.id), ownerId: user.id, name: '' });
      const owner = mediumFactory.personInsert({ personGroupId: await insertPersonGroup(db, user.id), ownerId: user.id, name: '' });
      await db
        .insertInto('person')
        .values([
          { ...cluster, name: '' },
          { ...owner, name: '' },
        ])
        .execute();

      const scan = await sut.createScan({ requestedBy: null, params: PARAMS });
      await sut.completeScan(scan.id, {
        totals: zeroTotals(),
        persons: [
          {
            personId: cluster.personGroupId,
            ownerId: user.id,
            personName: null, // unnamed at scan time
            faceCount: 35,
            thumbnailFaceId: null,
            eligible: 35,
            flagged: 20,
            flaggedFraction: 20 / 35,
            suspectedOwners: [{ ownerPersonId: owner.personGroupId, ownerName: null, thumbnailFaceId: null, count: 20 }],
            recommendation: 'confident',
            reviewReasons: [],
          },
        ],
      });

      // Both get named AFTER the scan ran.
      await db.updateTable('person').set({ name: 'Karina' }).where('personGroupId', '=', cluster.personGroupId).execute();
      await db.updateTable('person').set({ name: 'Christoph' }).where('personGroupId', '=', owner.personGroupId).execute();

      const refreshed = await sut.withCurrentNames((await sut.getLatestScan())!);
      const persons = refreshed.persons as unknown as RepairScanPerson[];

      expect(persons[0].personName).toBe('Karina');
      expect(persons[0].suspectedOwners[0].ownerName).toBe('Christoph');
      // A cluster named after the scan must not stay in the auto-selected "confident" group.
      expect(persons[0].recommendation).toBe('review-first');
      expect(persons[0].reviewReasons).toContain('named');
      // Flagging numbers are untouched (it is not a re-scan).
      expect(persons[0].flagged).toBe(20);
    });

    it('leaves an empty report untouched', async () => {
      const scan = await sut.createScan({ requestedBy: null, params: PARAMS });
      await sut.completeScan(scan.id, { totals: zeroTotals(), persons: [] });
      const refreshed = await sut.withCurrentNames((await sut.getLatestScan())!);
      expect(refreshed.persons).toEqual([]);
    });

    it("reports a destination's live face count, not the number the scan recorded", async () => {
      const user = mediumFactory.userInsert({});
      await db.insertInto('user').values(user).execute();
      const cluster = await insertPersonWithFaces(user.id, 1);
      const owner = await insertPersonWithFaces(user.id, 7);

      const [person] = await scanWith(cluster, [owner]);

      expect(person.suspectedOwners[0].ownerFaceCount).toBe(7);
      // The routing share is untouched — it is scan-time data, not a live count.
      expect(person.suspectedOwners[0].count).toBe(20);
    });

    it('reports the count as a number, not the bigint string Postgres returns', async () => {
      const user = mediumFactory.userInsert({});
      await db.insertInto('user').values(user).execute();
      const cluster = await insertPersonWithFaces(user.id, 1);
      const owner = await insertPersonWithFaces(user.id, 3);

      const [person] = await scanWith(cluster, [owner]);

      expect(typeof person.suspectedOwners[0].ownerFaceCount).toBe('number');
      expect(typeof person.faceCount).toBe('number');
    });

    it('counts only visible, undeleted faces — agreeing with getPersonMetadata on the same person', async () => {
      const user = mediumFactory.userInsert({});
      await db.insertInto('user').values(user).execute();
      const cluster = await insertPersonWithFaces(user.id, 1);
      const owner = await insertPersonWithFaces(user.id, 4, { deleted: 3, invisible: 2 });

      const [person] = await scanWith(cluster, [owner]);
      const metadata = await new FaceRepairRepository(db).getPersonMetadata(owner);

      expect(person.suspectedOwners[0].ownerFaceCount).toBe(4);
      expect(person.suspectedOwners[0].ownerFaceCount).toBe(metadata!.faceCount);
    });

    // The destination chooser (DestinationSelect) labels its options with searchOwnerPeople's faceCount, while
    // the destination card / tooltip label the same person with withCurrentNames' ownerFaceCount — a
    // disagreement between the two surfaces would read as a bug. All three join predicates
    // (getPersonMetadata, searchOwnerPeople, withCurrentNames) are identical today, so this is a pin against
    // future drift, not a live defect.
    it('agrees with searchOwnerPeople for the same person', async () => {
      const user = mediumFactory.userInsert({});
      await db.insertInto('user').values(user).execute();
      const cluster = await insertPersonWithFaces(user.id, 1);
      const owner = await insertPersonWithFaces(user.id, 4, { deleted: 3, invisible: 2 });

      const [person] = await scanWith(cluster, [owner]);
      const { people } = await new FaceRepairRepository(db).searchOwnerPeople(user.id, { page: 0, size: 50 });
      const match = people.find((p) => p.id === owner);

      expect(person.suspectedOwners[0].ownerFaceCount).toBe(4);
      expect(person.suspectedOwners[0].ownerFaceCount).toBe(match!.faceCount);
    });

    it('marks a suspected owner whose person row was deleted as missing, with a zero count', async () => {
      const user = mediumFactory.userInsert({});
      await db.insertInto('user').values(user).execute();
      const cluster = await insertPersonWithFaces(user.id, 1);
      const owner = await insertPersonWithFaces(user.id, 5);
      await db.deleteFrom('person').where('personGroupId', '=', owner).execute();

      const [person] = await scanWith(cluster, [owner]);

      expect(person.suspectedOwners[0].ownerMissing).toBe(true);
      expect(person.suspectedOwners[0].ownerFaceCount).toBe(0);
    });

    it('reports zero for a destination with no faces rather than dropping it', async () => {
      const user = mediumFactory.userInsert({});
      await db.insertInto('user').values(user).execute();
      const cluster = await insertPersonWithFaces(user.id, 1);
      const owner = await insertPersonWithFaces(user.id, 0);

      const [person] = await scanWith(cluster, [owner]);

      expect(person.suspectedOwners).toHaveLength(1);
      expect(person.suspectedOwners[0].ownerFaceCount).toBe(0);
      expect(person.suspectedOwners[0].ownerMissing).toBe(false);
    });

    it("overlays the reviewed cluster's own face count live as well", async () => {
      const user = mediumFactory.userInsert({});
      await db.insertInto('user').values(user).execute();
      const cluster = await insertPersonWithFaces(user.id, 6);
      const owner = await insertPersonWithFaces(user.id, 2);

      const [person] = await scanWith(cluster, [owner], { faceCount: 999 });

      expect(person.faceCount).toBe(6);
    });

    it('leaves eligible and the recorded flagged count at their scan-time values', async () => {
      const user = mediumFactory.userInsert({});
      await db.insertInto('user').values(user).execute();
      const cluster = await insertPersonWithFaces(user.id, 6);
      const owner = await insertPersonWithFaces(user.id, 2);

      const [person] = await scanWith(cluster, [owner]);

      expect(person.eligible).toBe(35);
      expect(person.flagged).toBe(20);
    });

    it('keeps the snapshot face count for a cluster whose own row was deleted', async () => {
      const user = mediumFactory.userInsert({});
      await db.insertInto('user').values(user).execute();
      const cluster = await insertPersonWithFaces(user.id, 6);
      const owner = await insertPersonWithFaces(user.id, 2);
      await db.deleteFrom('person').where('personGroupId', '=', cluster).execute();

      const [person] = await scanWith(cluster, [owner], { faceCount: 42 });

      // Better a stale number than claiming a cluster the admin is looking at has zero faces.
      expect(person.faceCount).toBe(42);
    });
  });

  describe('enrichReportPersons', () => {
    let ownerId: string;
    let p: { id: string; faceAssetId: string | null; name: string };
    let unnamed: { id: string; faceAssetId: string | null; name: string };
    let q: { id: string; faceAssetId: string | null; name: string };

    beforeAll(async () => {
      // Create owner user
      const user = mediumFactory.userInsert({});
      await db.insertInto('user').values(user).execute();
      ownerId = user.id;

      // Person p: named 'Jula', will get a faceAssetId via asset_face
      const pData = mediumFactory.personInsert({ ownerId, name: 'Jula' });
      await db.insertInto('person').values(pData).execute();

      // Create an asset + asset_face for p, then link faceAssetId
      const pAsset = mediumFactory.assetInsert({ ownerId });
      await db.insertInto('asset').values(pAsset).execute();
      const pFace = mediumFactory.assetFaceInsert({ assetId: pAsset.id, personGroupId: pData.personGroupId });
      await db.insertInto('asset_face').values(pFace).execute();
      await db.updateTable('person').set({ faceAssetId: pFace.id }).where('personGroupId', '=', pData.personGroupId).execute();
      p = { id: pData.personGroupId, faceAssetId: pFace.id, name: 'Jula' };

      // Person unnamed: name = '' (empty string → null after enrich)
      const unnamedData = mediumFactory.personInsert({ ownerId, name: '' });
      // personInsert spreads `name: ''` last so it overrides the default 'Test Name'
      await db
        .insertInto('person')
        .values({ ...unnamedData, name: '' })
        .execute();
      unnamed = { id: unnamedData.personGroupId, faceAssetId: null, name: '' };

      // Person q: suspected owner, no faceAssetId
      const qData = mediumFactory.personInsert({ ownerId });
      await db.insertInto('person').values(qData).execute();
      q = { id: qData.personGroupId, faceAssetId: null, name: qData.name };
    });

    afterEach(async () => {
      await db.deleteFrom('face_repair_scan').execute();
    });

    it('enriches persons with names + thumbnails; null name and null thumbnail survive', async () => {
      const enriched = await sut.enrichReportPersons([
        { personId: p.id, eligible: 10, flagged: 8, flaggedFraction: 0.8, suspectedOwnerIds: [q.id] },
        { personId: unnamed.id, eligible: 4, flagged: 3, flaggedFraction: 0.75, suspectedOwnerIds: [] },
      ]);

      const enrichedP = enriched.find((row) => row.personId === p.id)!;
      expect(enrichedP.personName).toBe('Jula');
      expect(enrichedP.ownerId).toBe(ownerId);
      expect(enrichedP.thumbnailFaceId).toBe(p.faceAssetId);
      expect(enrichedP.suspectedOwners).toEqual([
        { ownerPersonId: q.id, ownerName: q.name ?? null, thumbnailFaceId: null, count: 1 },
      ]);

      const enrichedUnnamed = enriched.find((row) => row.personId === unnamed.id)!;
      expect(enrichedUnnamed.personName).toBeNull();
    });

    it('round-trips a 600+ person report through jsonb without loss', async () => {
      const persons: RepairScanPerson[] = Array.from({ length: 600 }, (_, i) => ({
        personId: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
        ownerId,
        personName: i % 2 === 0 ? `P${i}` : null,
        faceCount: i,
        thumbnailFaceId: null,
        eligible: i + 1,
        flagged: i,
        flaggedFraction: i / (i + 1),
        suspectedOwners: [],
        recommendation: 'confident',
        reviewReasons: [],
      }));
      const scan = await sut.createScan({ requestedBy: null, params: PARAMS });
      await sut.completeScan(scan.id, { totals: zeroTotals(), persons });
      const row = await sut.getScanById(scan.id);
      expect(row?.persons).toHaveLength(600);
      expect(row?.persons[599].personName).toBeNull();
    });
  });

  it('migration is reversible: down function exists and drops face_repair_scan', async () => {
    // Dynamic import of migration via path alias causes TS2307 under moduleResolution:node16,
    // so we assert reversibility by inspecting the migration source instead of executing it.
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    // eslint-disable-next-line unicorn/prefer-module
    const thisDir = __dirname;
    const migrationPath = resolve(
      thisDir,
      '../../../../src/schema/migrations-gallery/1780000000000-AddFaceRepairScan.ts',
    );
    const source = readFileSync(migrationPath, 'utf8');
    expect(source).toContain('export async function down');
    expect(source).toContain('DROP TABLE');
    expect(source).toContain('face_repair_scan');
  });
});
