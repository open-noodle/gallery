import { Insertable, Kysely } from 'kysely';
import { InjectKysely } from 'nestjs-kysely';
import { DB } from 'src/schema';
import { FaceRepairDeclineTable } from 'src/schema/tables/face-repair-decline.table';

export interface PersonDeclineInput {
  personId: string;
  suspectedOwnerIds: string[];
}

export interface DeclineListRow {
  id: string;
  type: 'face' | 'person';
  assetFaceId: string | null;
  suspectedOwnerId: string | null;
  suspectedOwnerName: string | null;
  suspectedOwnerThumbnailFaceId: string | null;
  personId: string | null;
  personName: string | null;
  personThumbnailFaceId: string | null;
  createdAt: string;
}

export class FaceRepairDeclineRepository {
  constructor(@InjectKysely() private db: Kysely<DB>) {}

  // Insert face and/or person declines. Face rows are idempotent on the (assetFaceId, suspectedOwnerId) partial
  // unique index — re-declining the same face/owner is a no-op. Person rows are last-write-wins: the dashboard
  // always sends the person's current full suspected-owner set, so re-dismissing replaces the stored fingerprint.
  // Returns the number of rows actually inserted.
  async createClusterMutes(input: { persons?: PersonDeclineInput[]; declinedBy: string | null }): Promise<number> {
    const personRows = (input.persons ?? []).map((p) => ({
      type: 'person' as const,
      assetFaceId: null,
      suspectedOwnerId: null,
      personId: p.personId,
      suspectedOwnerIds: p.suspectedOwnerIds as unknown as Insertable<FaceRepairDeclineTable>['suspectedOwnerIds'],
      declinedBy: input.declinedBy,
    }));
    if (personRows.length === 0) {
      return 0;
    }
    return this.db.transaction().execute(async (trx) => {
      let created = 0;
      if (personRows.length > 0) {
        const personIds = (input.persons ?? []).map((p) => p.personId);
        // last-write-wins: a re-dismiss replaces the person's stored suspected-owner fingerprint
        await trx
          .deleteFrom('face_repair_decline')
          .where('type', '=', 'person')
          .where('personId', 'in', personIds)
          .execute();
        const inserted = await trx.insertInto('face_repair_decline').values(personRows).returning('id').execute();
        created += inserted.length;
      }
      return created;
    });
  }

  // Cluster mutes only. Face-level "this face is not that person" verdicts moved to the shared
  // `face_person_verdict` layer so BOTH face features can see them; this table now records only the
  // console-local "stop showing me this whole cluster" fingerprint, which is a UI queue concern rather than
  // a fact about a face. Scoped to the persons in play — never an unscoped read.
  // H6: chunked at 1000, matching removeClusterMutes below. face-verdict.service.ts calls this for every
  // suspected owner in a scan; minFaces is admin-settable, so a full-library scan can pass every flagged
  // face's suspected-owner person id — one id is one bind parameter, so an unchunked IN-list breaks at
  // Postgres's 65 535-parameter ceiling.
  async getClusterMuteMap(personIds: string[]): Promise<Map<string, Set<string>>> {
    const mutedPersons = new Map<string, Set<string>>();
    if (personIds.length === 0) {
      return mutedPersons;
    }
    for (let index = 0; index < personIds.length; index += 1000) {
      const rows = await this.db
        .selectFrom('face_repair_decline')
        .select(['personId', 'suspectedOwnerIds'])
        .where('type', '=', 'person')
        .where('personId', 'in', personIds.slice(index, index + 1000))
        .execute();
      for (const row of rows) {
        if (row.personId) {
          mutedPersons.set(row.personId, new Set(row.suspectedOwnerIds as unknown as string[]));
        }
      }
    }
    return mutedPersons;
  }

  async listDeclines(): Promise<DeclineListRow[]> {
    const rows = await this.db
      .selectFrom('face_repair_decline')
      .select(['id', 'type', 'assetFaceId', 'suspectedOwnerId', 'personId', 'createdAt'])
      .where('type', '=', 'person')
      .orderBy('createdAt', 'desc')
      .execute();
    if (rows.length === 0) {
      return [];
    }
    const ids = [
      ...new Set(rows.flatMap((r) => [r.personId, r.suspectedOwnerId].filter((x): x is string => x !== null))),
    ];
    const people =
      ids.length > 0
        ? await this.db.selectFrom('person').select(['personGroupId', 'name', 'faceAssetId']).where('personGroupId', 'in', ids).execute()
        : [];
    const byId = new Map(people.map((p) => [p.personGroupId, p]));
    const nameOf = (id: string | null) => (id && byId.get(id)?.name ? byId.get(id)!.name! : null);
    const thumbOf = (id: string | null) => (id ? (byId.get(id)?.faceAssetId ?? null) : null);
    return rows.map((r) => ({
      id: r.id,
      type: r.type as 'face' | 'person',
      assetFaceId: r.assetFaceId,
      suspectedOwnerId: r.suspectedOwnerId,
      suspectedOwnerName: nameOf(r.suspectedOwnerId),
      suspectedOwnerThumbnailFaceId: thumbOf(r.suspectedOwnerId),
      personId: r.personId,
      personName: nameOf(r.personId),
      personThumbnailFaceId: thumbOf(r.personId),
      createdAt: r.createdAt as unknown as string,
    }));
  }

  // Remove declines by row id and/or by face natural key. The declined-page "Undo" sends ids; the review
  // screen's in-place undecline sends faces (it knows the (assetFaceId, suspectedOwnerId) pair but not the
  // server-generated row id). Returns the total number of rows removed.
  //
  // F20: chunked at 1000, matching the idiom every other bulk face path in the sibling repositories uses.
  // The resolutions-remove DTO's clusterMuteIds is capped at MAX_RESOLVE_FACES (25 000) but a direct
  // caller is not bounded by the DTO at all — one id is one bind parameter, so an unchunked IN-list
  // breaks at Postgres's 65 535-parameter ceiling.
  async removeClusterMutes(input: { ids?: string[] }): Promise<number> {
    const ids = input.ids ?? [];
    if (ids.length === 0) {
      return 0;
    }
    let removed = 0;
    for (let index = 0; index < ids.length; index += 1000) {
      const chunk = ids.slice(index, index + 1000);
      const rows = await this.db
        .deleteFrom('face_repair_decline')
        .where('id', 'in', chunk)
        .where('type', '=', 'person')
        .returning('id')
        .execute();
      removed += rows.length;
    }
    return removed;
  }
}
