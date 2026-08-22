import { Kysely } from 'kysely';
import { randomUUID } from 'node:crypto';
import { SourceType } from 'src/enum';
import { FaceRepairDeclineRepository } from 'src/repositories/face-repair-decline.repository';
import { LoggingRepository } from 'src/repositories/logging.repository';
import { PersonRepository } from 'src/repositories/person.repository';
import { DB } from 'src/schema';
import { BaseService } from 'src/services/base.service';
import { newMediumService } from 'test/medium.factory';
import { getKyselyDB } from 'test/utils';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

// NOTE: Docker is required to run these tests. They are not run locally (no Docker) but are validated in CI.

async function seedFaceAndPersons(db: Kysely<DB>) {
  const { ctx } = newMediumService(BaseService, {
    database: db,
    real: [FaceRepairDeclineRepository, PersonRepository],
    mock: [LoggingRepository],
  });

  const { user } = await ctx.newUser();
  const { person: personP } = await ctx.newPerson({ ownerId: user.id });
  const { person: personQ } = await ctx.newPerson({ ownerId: user.id });
  const { asset } = await ctx.newAsset({ ownerId: user.id });
  const { assetFace } = await ctx.newAssetFace({
    assetId: asset.id,
    personGroupId: personP.personGroupId,
    sourceType: SourceType.MachineLearning,
    isVisible: true,
  });

  return {
    faceId: assetFace.id,
    personP: personP.personGroupId,
    personQ: personQ.personGroupId,
    declinedBy: user.id,
  };
}

describe(FaceRepairDeclineRepository.name, () => {
  let sut: FaceRepairDeclineRepository;
  let db: Kysely<DB>;

  beforeAll(async () => {
    db = await getKyselyDB();
    sut = new FaceRepairDeclineRepository(db);
  });

  afterEach(() => db.deleteFrom('face_repair_decline').execute());

  // This table now records ONLY the console-local cluster mute ("stop showing me this whole person"). The
  // face-level "this face is not that person" fact moved to the shared `face_person_verdict` layer so the
  // suggestion engine can see it too — see face-person-verdict.repository.spec.ts.
  it('creates a cluster mute and loads it into the mute map', async () => {
    const { personP, personQ, declinedBy } = await seedFaceAndPersons(db);

    await sut.createClusterMutes({
      persons: [{ personId: personP, suspectedOwnerIds: [personQ] }],
      declinedBy,
    });

    const mutes = await sut.getClusterMuteMap([personP]);
    expect(mutes.get(personP)).toEqual(new Set([personQ]));
  });

  it('returns an empty map for an empty scope rather than reading the whole table', async () => {
    const { personP, personQ, declinedBy } = await seedFaceAndPersons(db);
    await sut.createClusterMutes({
      persons: [{ personId: personP, suspectedOwnerIds: [personQ] }],
      declinedBy,
    });

    expect(await sut.getClusterMuteMap([])).toEqual(new Map());
  });

  it('scopes the mute map to the persons asked for', async () => {
    const { personP, personQ, declinedBy } = await seedFaceAndPersons(db);
    const other = await seedFaceAndPersons(db);
    await sut.createClusterMutes({
      persons: [
        { personId: personP, suspectedOwnerIds: [personQ] },
        { personId: other.personP, suspectedOwnerIds: [other.personQ] },
      ],
      declinedBy,
    });

    const mutes = await sut.getClusterMuteMap([personP]);
    expect(mutes.keys().toArray()).toEqual([personP]);
  });

  it('re-muting a person replaces the stored fingerprint (one row per person, last-write-wins)', async () => {
    const { personP, personQ, declinedBy } = await seedFaceAndPersons(db);

    await sut.createClusterMutes({ persons: [{ personId: personP, suspectedOwnerIds: [personQ] }], declinedBy });
    await sut.createClusterMutes({ persons: [{ personId: personP, suspectedOwnerIds: [] }], declinedBy });

    const rows = await db.selectFrom('face_repair_decline').selectAll().where('personGroupId', '=', personP).execute();
    expect(rows).toHaveLength(1);

    const mutes = await sut.getClusterMuteMap([personP]);
    expect(mutes.get(personP)).toEqual(new Set());
  });

  it('lists and removes cluster mutes by id', async () => {
    const { personP, personQ, declinedBy } = await seedFaceAndPersons(db);
    await sut.createClusterMutes({ persons: [{ personId: personP, suspectedOwnerIds: [personQ] }], declinedBy });

    const listed = await sut.listDeclines();
    expect(listed).toHaveLength(1);
    expect(listed[0].personGroupId).toBe(personP);

    expect(await sut.removeClusterMutes({ ids: [listed[0].id] })).toBe(1);
    expect(await sut.listDeclines()).toEqual([]);
  });

  it('removeClusterMutes with no ids is a no-op', async () => {
    expect(await sut.removeClusterMutes({})).toBe(0);
  });

  // S10.3 (F20): the resolutions-remove DTO's clusterMuteIds now goes up to MAX_RESOLVE_FACES (25 000),
  // and removeClusterMutes was completely unchunked. The filler is far larger than Postgres's 65 535
  // bind-parameter ceiling (non-existent ids), so this genuinely fails today, before chunking.
  it('removes only the requested cluster mutes, chunked, without a bind-parameter error on a huge request', async () => {
    const { personP, personQ, declinedBy } = await seedFaceAndPersons(db);
    const other = await seedFaceAndPersons(db);
    await sut.createClusterMutes({
      persons: [
        { personId: personP, suspectedOwnerIds: [personQ] },
        { personId: other.personP, suspectedOwnerIds: [other.personQ] },
      ],
      declinedBy,
    });

    const listed = await sut.listDeclines();
    const rowP = listed.find((r) => r.personGroupId === personP)!;
    const rowOther = listed.find((r) => r.personGroupId === other.personP)!;

    const filler = Array.from({ length: 70_000 }, () => randomUUID());
    const removed = await sut.removeClusterMutes({ ids: [rowP.id, ...filler] });

    expect(removed).toBe(1);
    const remaining = await sut.listDeclines();
    expect(remaining.map((r) => r.id)).toEqual([rowOther.id]); // positive control: untouched
  });

  // H6: face-verdict.service.ts calls this for every suspected owner in a scan, unchunked. minFaces is
  // admin-settable, so a full-library scan can pass every flagged face's suspected-owner person id — far
  // larger than Postgres's 65 535 bind-parameter ceiling (one id is one bind parameter). Mirrors the
  // removeClusterMutes (F20) chunking test above.
  it('finds a cluster mute among a personId list far larger than the bind-parameter ceiling', async () => {
    const { personP, personQ, declinedBy } = await seedFaceAndPersons(db);
    const other = await seedFaceAndPersons(db);
    await sut.createClusterMutes({
      persons: [{ personId: personP, suspectedOwnerIds: [personQ] }],
      declinedBy,
    });

    const filler = Array.from({ length: 70_000 }, () => randomUUID());
    const mutes = await sut.getClusterMuteMap([personP, other.personP, ...filler]);

    expect(mutes.get(personP)).toEqual(new Set([personQ]));
    expect(mutes.has(other.personP)).toBe(false); // positive control: no mute recorded for this person
  });

  it('cascades: deleting the person removes its cluster mute', async () => {
    const { personP, personQ, declinedBy } = await seedFaceAndPersons(db);
    await sut.createClusterMutes({ persons: [{ personId: personP, suspectedOwnerIds: [personQ] }], declinedBy });

    await db.deleteFrom('person').where('personGroupId', '=', personP).execute();

    expect(await sut.listDeclines()).toEqual([]);
  });
});
