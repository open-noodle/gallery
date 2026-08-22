import { Insertable, Kysely, Transaction } from 'kysely';
import { DB } from 'src/schema';
import { FaceRepairDeclineTable } from 'src/schema/tables/face-repair-decline.table';

/**
 * Re-keys the source person's cluster mute onto the survivor before the merge deletes that person.
 * `face_repair_decline.personGroupId` is ON DELETE CASCADE (verified against a live database) — unlike the
 * `face_person_verdict.personGroupId` FK that {@link retargetVerdictPersonId} guards, which is SET NULL — so
 * without this a merge silently destroys the admin's "stop showing me this cluster" decision and the
 * cluster resurfaces on the very next scan.
 *
 * A person carries at most ONE `type='person'` row — `createClusterMutes` deletes-then-inserts rather than
 * appending — so this reduces to three cases:
 *   - only the source has a mute: move its row onto the survivor.
 *   - only the survivor has a mute (or neither does): nothing to do.
 *   - both have one: the survivor's row absorbs the UNION of both suspected-owner sets — the merged
 *     cluster now contains both people's faces, so both mutes still apply — and the source row is
 *     dropped. Leaving two rows instead would be worse than the bug this fixes: `getClusterMuteMap` does a
 *     plain `.set()` per row it reads, so which row "wins" would depend on read order rather than being
 *     deterministic.
 *
 * Must run BEFORE the source person is deleted: the FK is CASCADE, not SET NULL, so a bare delete removes
 * the source's row outright rather than leaving it to retarget.
 *
 * Edge case: `suspectedOwnerIds` carries no FK (it is a plain jsonb array of ids), so if the survivor's
 * mute already lists the source person as a suspected owner, the union keeps that now-dangling id. That is
 * an existing property of this column — nothing upstream of this function enforces referential integrity
 * on it either — so this function does not attempt to prune it; doing so is out of scope for a merge-time
 * re-pointing step.
 */
export async function retargetDeclinePersonId(
  trx: Kysely<DB> | Transaction<DB>,
  sourceId: string,
  survivorId: string,
): Promise<void> {
  const rows = await trx
    .selectFrom('face_repair_decline')
    .select(['id', 'personGroupId', 'suspectedOwnerIds'])
    .where('type', '=', 'person')
    .where('personGroupId', 'in', [sourceId, survivorId])
    .execute();

  const source = rows.find((row) => row.personGroupId === sourceId);
  if (!source) {
    return;
  }

  const survivor = rows.find((row) => row.personGroupId === survivorId);
  if (!survivor) {
    await trx.updateTable('face_repair_decline').set({ personGroupId: survivorId }).where('id', '=', source.id).execute();
    return;
  }

  const union = [
    ...new Set([
      ...((survivor.suspectedOwnerIds ?? []) as unknown as string[]),
      ...((source.suspectedOwnerIds ?? []) as unknown as string[]),
    ]),
  ];
  await trx
    .updateTable('face_repair_decline')
    .set({ suspectedOwnerIds: union as unknown as Insertable<FaceRepairDeclineTable>['suspectedOwnerIds'] })
    .where('id', '=', survivor.id)
    .execute();
  await trx.deleteFrom('face_repair_decline').where('id', '=', source.id).execute();
}
