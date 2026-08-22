import { ExpressionBuilder, Insertable, Kysely, Selectable, sql } from 'kysely';
import { InjectKysely } from 'nestjs-kysely';
import { PostgresError } from 'postgres';
import { SourceType } from 'src/enum';
import { DB } from 'src/schema';
import { FaceRepairScanTable } from 'src/schema/tables/face-repair-scan.table';
import { reviewableAssetVisibility } from 'src/utils/face-review';

// The partial unique index enforcing at most one in-flight scan (see face-repair-scan.table.ts).
const IN_FLIGHT_INDEX = 'face_repair_scan_in_flight_uq';

export type RepairScanStatus = 'pending' | 'running' | 'completed' | 'failed';

export interface RepairScanParams {
  maxDistance: number;
  minFaces: number;
  voteWindow: number;
  voteMargin: number;
  maxAttributionDistance: number;
  maxFlaggedFraction: number;
  largeClusterThreshold: number;
  ownerId?: string;
}

export interface RepairScanSuspectedOwner {
  ownerPersonId: string;
  ownerName: string | null;
  thumbnailFaceId: string | null;
  // Flagged faces on the reviewed cluster routing to this owner. PERSISTED at scan time.
  count: number;
  // Overlay-only, filled by withCurrentNames — never present in the persisted scan JSON, which is why these
  // are optional here and required in ScanSuspectedOwnerSchema. enrichReportPersons writes the scan-time shape
  // and must not set them; FaceRepairService.getLatestScanStatus always fills them before the DTO boundary.
  ownerFaceCount?: number;
  ownerMissing?: boolean;
}

export interface RepairScanPerson {
  personGroupId: string;
  ownerId: string;
  personName: string | null;
  faceCount: number;
  thumbnailFaceId: string | null;
  eligible: number;
  flagged: number;
  flaggedFraction: number;
  suspectedOwners: RepairScanSuspectedOwner[];
  recommendation: 'confident' | 'review-first';
  reviewReasons: string[];
}

export interface RepairScanTotals {
  eligibleFaces: number;
  flaggedFaces: number;
  toRepair: number;
  reviewOnlyFaces: number;
  reviewOnlyPersons: number;
  affectedPersons: number;
  reviewOnlyByReason: { overCap: number; badTarget: number; unAttributable: number };
}

export interface RepairScanProgress {
  scanned: number;
  total: number;
  // Heartbeat: stamped on every progress write so stale (worker-lost) scans can be detected and failed.
  heartbeatAt?: string;
}

export type RepairScanRow = Selectable<FaceRepairScanTable>;

// Typed sentinel so callers can distinguish "scan already in progress" from real DB failures.
export class ScanInProgressError extends Error {
  constructor() {
    super('A face-repair scan is already in progress');
  }
}

export class FaceRepairScanRepository {
  constructor(@InjectKysely() private db: Kysely<DB>) {}

  async createScan(input: { requestedBy: string | null; params: RepairScanParams }): Promise<RepairScanRow> {
    try {
      return await this.db.transaction().execute(async (trx) => {
        const inFlight = await trx
          .selectFrom('face_repair_scan')
          .select('id')
          .where('status', 'in', ['pending', 'running'])
          .executeTakeFirst();
        if (inFlight) {
          throw new ScanInProgressError();
        }
        return trx
          .insertInto('face_repair_scan')
          .values({
            status: 'pending',
            requestedBy: input.requestedBy,
            params: input.params as unknown as Insertable<FaceRepairScanTable>['params'],
          })
          .returningAll()
          .executeTakeFirstOrThrow();
      });
    } catch (error) {
      // Race-safe backstop for the SELECT-then-INSERT above: two concurrent createScan transactions each read no
      // in-flight row (neither sees the other's uncommitted insert), then collide on the partial unique index.
      // Translate that collision into the same typed "already in progress" signal callers already handle.
      if ((error as PostgresError)?.code === '23505' && (error as PostgresError)?.constraint_name === IN_FLIGHT_INDEX) {
        throw new ScanInProgressError();
      }
      throw error;
    }
  }

  getLatestScan(): Promise<RepairScanRow | undefined> {
    return this.db.selectFrom('face_repair_scan').selectAll().orderBy('createdAt', 'desc').limit(1).executeTakeFirst();
  }

  getScanById(id: string): Promise<RepairScanRow | undefined> {
    return this.db.selectFrom('face_repair_scan').selectAll().where('id', '=', id).executeTakeFirst();
  }

  async updateScanProgress(
    id: string,
    input: { status?: RepairScanStatus; progress?: RepairScanProgress; startedAt?: Date },
  ): Promise<void> {
    await this.db
      .updateTable('face_repair_scan')
      .set({
        ...(input.status && { status: input.status }),
        ...(input.progress && { progress: { ...input.progress, heartbeatAt: new Date().toISOString() } }),
        ...(input.startedAt && { startedAt: input.startedAt }),
      })
      .where('id', '=', id)
      .execute();
  }

  async completeScan(id: string, input: { totals: RepairScanTotals; persons: RepairScanPerson[] }): Promise<void> {
    await this.db
      .updateTable('face_repair_scan')
      .set({ status: 'completed', totals: input.totals, persons: input.persons, finishedAt: new Date() })
      .where('id', '=', id)
      .execute();
  }

  // Self-heal: fail in-flight scans whose last sign of life (progress heartbeat, else startedAt, else
  // createdAt) is older than the cutoff. Covers worker hard-crashes and a Redis failure between the row
  // insert and the job enqueue — without this, a lost scan blocks new scans AND applies forever.
  async failStaleScans(staleAfterMs: number): Promise<number> {
    const cutoff = new Date(Date.now() - staleAfterMs);
    const result = await this.db
      .updateTable('face_repair_scan')
      .set({
        status: 'failed',
        error: 'Scan timed out: the worker stopped reporting progress (it may have crashed or been restarted)',
        finishedAt: new Date(),
      })
      .where('status', 'in', ['pending', 'running'])
      .where(sql<boolean>`coalesce((progress->>'heartbeatAt')::timestamptz, "startedAt", "createdAt") < ${cutoff}`)
      .execute();
    return Number(result[0]?.numUpdatedRows ?? 0);
  }

  async failScan(id: string, error: string): Promise<void> {
    await this.db
      .updateTable('face_repair_scan')
      .set({ status: 'failed', error, finishedAt: new Date() })
      .where('id', '=', id)
      .execute();
  }

  // Drop the given persons from the latest scan's persisted report after they have been applied, and keep the
  // headline `flaggedFaces`/`affectedPersons` totals coherent with the trimmed list. The report is a
  // point-in-time snapshot; without this an applied row reappears the next time the console refetches it.
  async removePersonsFromLatestScan(personGroupIds: string[]): Promise<void> {
    if (personGroupIds.length === 0) {
      return;
    }
    const latest = await this.getLatestScan();
    if (!latest?.persons) {
      return;
    }
    const remove = new Set(personGroupIds);
    const persons = (latest.persons as unknown as RepairScanPerson[]).filter((p) => !remove.has(p.personGroupId));
    const totals = latest.totals
      ? {
          ...(latest.totals as unknown as RepairScanTotals),
          flaggedFaces: persons.reduce((sum, p) => sum + p.flagged, 0),
          affectedPersons: persons.length,
        }
      : latest.totals;
    await this.db
      .updateTable('face_repair_scan')
      .set({
        persons: persons as unknown as RepairScanRow['persons'],
        totals: totals as unknown as RepairScanRow['totals'],
      })
      .where('id', '=', latest.id)
      .execute();
  }

  async pruneSupersededScans(): Promise<void> {
    const latest = await this.db
      .selectFrom('face_repair_scan')
      .select('id')
      .orderBy('createdAt', 'desc')
      .limit(1)
      .executeTakeFirst();
    if (!latest) {
      return;
    }
    await this.db.deleteFrom('face_repair_scan').where('id', '!=', latest.id).execute();
  }

  // The names/thumbnails in the persisted report are a point-in-time snapshot, but people get named (and their
  // representative face changes) after a scan runs. Overlay the *current* person + suspected-owner names and
  // thumbnails at read time so the console reflects reality without forcing a full, expensive re-scan. Flagging
  // numbers stay as scanned. A cluster that has since been named is also promoted to `review-first` (reason
  // `named`) so it is never silently bulk-applied.
  async withCurrentNames(scan: RepairScanRow): Promise<RepairScanRow> {
    const persons = (scan.persons ?? []) as unknown as RepairScanPerson[];
    if (persons.length === 0) {
      return scan;
    }
    const ids = [...new Set(persons.flatMap((p) => [p.personGroupId, ...p.suspectedOwners.map((o) => o.ownerPersonId)]))];
    // The join predicate must stay identical to FaceRepairRepository.getPersonMetadata and .searchOwnerPeople:
    // the review page renders this count next to the picker's, and a disagreement reads as a bug. It is covered
    // by the partial index asset_face_personId_assetId_notDeleted_isVisible_idx.
    const rows = await this.db
      .selectFrom('person')
      .leftJoin('asset_face', (join) =>
        join
          .onRef('asset_face.personGroupId', '=', 'person.personGroupId')
          .on('asset_face.deletedAt', 'is', null)
          .on('asset_face.isVisible', '=', true),
      )
      .select(['person.personGroupId as id', 'person.name as name', 'person.faceAssetId as faceAssetId'])
      .select((eb) => eb.fn.count('asset_face.id').as('faceCount'))
      .where('person.personGroupId', 'in', ids)
      // group by the composite PRIMARY KEY: Postgres infers functional dependency only from a
      // primary key, never from the unique index on personGroupId, so name/faceAssetId would
      // otherwise be ungrouped.
      .groupBy(['person.ownerId', 'person.personGroupId'])
      .execute();
    const byId = new Map(rows.map((r) => [r.id, r]));
    const nameOf = (id: string) => (byId.get(id)?.name ? byId.get(id)!.name : null);
    const thumbOf = (id: string) => byId.get(id)?.faceAssetId ?? null;
    // count() is bigint, which the driver returns as a STRING. Every other face count in this service converts
    // (getPersonMetadata:108); leaving it a string fails z.number() and breaks {count, number} in the web.
    const faceCountOf = (id: string) => Number(byId.get(id)?.faceCount ?? 0);

    const refreshed = persons.map((p) => {
      const personName = nameOf(p.personGroupId);
      const namedNow = personName !== null;
      const reviewReasons =
        namedNow && !p.reviewReasons.includes('named') ? ['named', ...p.reviewReasons] : p.reviewReasons;
      return {
        ...p,
        personName,
        thumbnailFaceId: thumbOf(p.personGroupId),
        // Live, like the name and thumbnail beside it. A cluster whose row is gone keeps its snapshot count
        // rather than claiming the cluster the admin is looking at has zero faces.
        faceCount: byId.has(p.personGroupId) ? faceCountOf(p.personGroupId) : p.faceCount,
        recommendation: (namedNow ? 'review-first' : p.recommendation) as RepairScanPerson['recommendation'],
        reviewReasons,
        suspectedOwners: p.suspectedOwners.map((o) => ({
          ...o,
          ownerName: nameOf(o.ownerPersonId),
          thumbnailFaceId: thumbOf(o.ownerPersonId),
          ownerFaceCount: faceCountOf(o.ownerPersonId),
          ownerMissing: !byId.has(o.ownerPersonId),
        })),
      };
    });
    return { ...scan, persons: refreshed as unknown as RepairScanRow['persons'] };
  }

  async replaceScanFlaggedFaces(
    scanId: string,
    faces: { assetFaceId: string; personGroupId: string; suspectedOwnerId: string }[],
  ): Promise<void> {
    await this.db.deleteFrom('face_repair_scan_flagged_face').where('scanId', '=', scanId).execute();
    for (let index = 0; index < faces.length; index += 1000) {
      const chunk = faces.slice(index, index + 1000);
      await this.db
        .insertInto('face_repair_scan_flagged_face')
        .values(
          chunk.map((face) => ({
            scanId,
            assetFaceId: face.assetFaceId,
            personGroupId: face.personGroupId,
            suspectedOwnerId: face.suspectedOwnerId,
          })),
        )
        .execute();
    }
  }

  async getScanFlaggedFaces(
    scanId: string,
    personGroupId: string,
  ): Promise<{ assetFaceId: string; suspectedOwnerId: string }[]> {
    return (
      this.db
        .selectFrom('face_repair_scan_flagged_face as ff')
        .innerJoin('asset_face', 'asset_face.id', 'ff.assetFaceId')
        .innerJoin('asset', 'asset.id', 'asset_face.assetId')
        .innerJoin('face_search', 'face_search.faceId', 'asset_face.id')
        .select(['ff.assetFaceId as assetFaceId', 'ff.suspectedOwnerId as suspectedOwnerId'])
        .where('ff.scanId', '=', scanId)
        .where('ff.personGroupId', '=', personGroupId)
        .where('asset_face.personGroupId', '=', personGroupId)
        .where('asset_face.sourceType', '=', sql.lit(SourceType.MachineLearning))
        .where('asset_face.deletedAt', 'is', null)
        .where('asset_face.isVisible', '=', true)
        .where('asset.deletedAt', 'is', null)
        // Slice 1: the snapshot is a persisted list, so an asset moved into the Locked folder AFTER the scan
        // flagged its face would otherwise still have its crop rendered by the console. The scan's own
        // eligibility read excludes locked/hidden assets; this read has to agree, or the policy holds only
        // until someone locks a photo.
        .where((eb) => reviewableAssetVisibility(eb as unknown as ExpressionBuilder<DB, keyof DB>))
        .orderBy('ff.assetFaceId')
        .execute()
    );
  }

  // Multi-person variant of getScanFlaggedFaces used by the apply path: read the persisted flagged-face
  // snapshot for a set of approved persons instead of recomputing the plan via per-face ANN in the request
  // (the scan already computed and stored exactly these rows). The eligibility join mirrors
  // streamEligibleFaces / getScanFlaggedFaces exactly, and `asset_face.personGroupId = ff.personGroupId` keeps the read
  // self-correcting: a face moved off its recorded person since the scan is silently dropped, so applying the
  // stored snapshot is safe. `personGroupId` is returned so the caller can route each face from its recorded person.
  async getScanFlaggedFacesForPersons(
    scanId: string,
    personGroupIds: string[],
  ): Promise<{ assetFaceId: string; personGroupId: string; suspectedOwnerId: string }[]> {
    if (personGroupIds.length === 0) {
      return [];
    }
    return (
      this.db
        .selectFrom('face_repair_scan_flagged_face as ff')
        .innerJoin('asset_face', 'asset_face.id', 'ff.assetFaceId')
        .innerJoin('asset', 'asset.id', 'asset_face.assetId')
        .innerJoin('face_search', 'face_search.faceId', 'asset_face.id')
        .select(['ff.assetFaceId as assetFaceId', 'ff.personGroupId as personGroupId', 'ff.suspectedOwnerId as suspectedOwnerId'])
        .where('ff.scanId', '=', scanId)
        .where('ff.personGroupId', 'in', personGroupIds)
        .whereRef('asset_face.personGroupId', '=', 'ff.personGroupId')
        .where('asset_face.sourceType', '=', sql.lit(SourceType.MachineLearning))
        .where('asset_face.deletedAt', 'is', null)
        .where('asset_face.isVisible', '=', true)
        .where('asset.deletedAt', 'is', null)
        // Slice 1, and more load-bearing here than on the console read: this feeds the APPLY path, so without
        // it a resolve could act on a face whose asset was locked after the scan. Dropping it silently is the
        // same self-correcting behaviour this query already applies to a face moved off its recorded person.
        .where((eb) => reviewableAssetVisibility(eb as unknown as ExpressionBuilder<DB, keyof DB>))
        .orderBy('ff.assetFaceId')
        .execute()
    );
  }

  async enrichReportPersons(
    rows: Array<{
      personGroupId: string;
      eligible: number;
      flagged: number;
      flaggedFraction: number;
      suspectedOwnerIds: string[];
    }>,
  ): Promise<RepairScanPerson[]> {
    const personGroupIds = [...new Set(rows.flatMap((r) => [r.personGroupId, ...r.suspectedOwnerIds]))];
    if (personGroupIds.length === 0) {
      return [];
    }
    const people = await this.db
      .selectFrom('person')
      .select(['personGroupId as id', 'ownerId', 'name', 'faceAssetId'])
      .where('personGroupId', 'in', personGroupIds)
      .execute();
    const byId = new Map(people.map((person) => [person.id, person]));
    const nameOf = (id: string) => (byId.get(id)?.name ? byId.get(id)!.name : null);
    const thumbOf = (id: string) => byId.get(id)?.faceAssetId ?? null;

    return rows.map((row) => {
      const counts = new Map<string, number>();
      for (const ownerId of row.suspectedOwnerIds) {
        counts.set(ownerId, (counts.get(ownerId) ?? 0) + 1);
      }
      return {
        personGroupId: row.personGroupId,
        ownerId: byId.get(row.personGroupId)?.ownerId ?? '',
        personName: nameOf(row.personGroupId),
        faceCount: row.eligible,
        thumbnailFaceId: thumbOf(row.personGroupId),
        eligible: row.eligible,
        flagged: row.flagged,
        flaggedFraction: row.flaggedFraction,
        suspectedOwners: [...counts].map(([ownerPersonId, count]) => ({
          ownerPersonId,
          ownerName: nameOf(ownerPersonId),
          thumbnailFaceId: thumbOf(ownerPersonId),
          count,
        })),
        recommendation: 'confident',
        reviewReasons: [],
      };
    });
  }
}
