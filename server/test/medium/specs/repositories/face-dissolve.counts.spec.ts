import { Kysely } from 'kysely';
import { beforeAll, describe, expect, it } from 'vitest';
import { AssetVisibility, SourceType } from 'src/enum.js';
import { FaceDissolveRepository } from 'src/gallery/repositories/face-dissolve.repository.js';
import { DB } from 'src/schema/index.js';
import { DissolveScope } from 'src/gallery/utils/face-dissolve.js';
import {
  seedAsset,
  seedFace,
  seedPerson,
  seedSpace,
  seedSpacePerson,
  seedUser,
} from 'test/medium/specs/repositories/face-dissolve.fixtures.js';
import { getKyselyDB } from 'test/utils.js';

let db: Kysely<DB>;

beforeAll(async () => {
  db = await getKyselyDB();
});

describe('FaceDissolveRepository.getCounts', () => {
  it('counts shared assets and assets that can never be re-detected', async () => {
    const repo = new FaceDissolveRepository(db);
    const user = await seedUser(db);
    const target = await seedPerson(db, { ownerId: user.id, name: 'Target' });
    const other = await seedPerson(db, { ownerId: user.id, name: 'Other' });
    const pet = await seedPerson(db, { ownerId: user.id, name: 'Pet', type: 'pet' });

    const solo = await seedAsset(db, { ownerId: user.id });
    await seedFace(db, { assetId: solo.id, personGroupId: target.personGroupId, sourceType: SourceType.Exif });
    // A second in-scope target face on the SAME asset (F5): `assets` must count this asset once, not twice.
    await seedFace(db, { assetId: solo.id, personGroupId: target.personGroupId, sourceType: SourceType.Exif });

    const shared = await seedAsset(db, { ownerId: user.id });
    await seedFace(db, { assetId: shared.id, personGroupId: target.personGroupId, sourceType: SourceType.Exif });
    await seedFace(db, { assetId: shared.id, personGroupId: other.personGroupId });
    // A second sibling face on the SAME shared asset (F2): `sharedAssets` counts qualifying ASSETS, not rows.
    await seedFace(db, { assetId: shared.id, personGroupId: other.personGroupId });

    // hidden and preview-less assets can never be re-detected (L11)
    const hidden = await seedAsset(db, { ownerId: user.id, visibility: AssetVisibility.Hidden });
    await seedFace(db, { assetId: hidden.id, personGroupId: target.personGroupId, sourceType: SourceType.Exif });

    const noPreview = await seedAsset(db, { ownerId: user.id, withPreview: false });
    await seedFace(db, { assetId: noPreview.id, personGroupId: target.personGroupId, sourceType: SourceType.Exif });

    // A trashed asset can never be re-detected either (F3).
    const trashed = await seedAsset(db, { ownerId: user.id });
    await seedFace(db, { assetId: trashed.id, personGroupId: target.personGroupId, sourceType: SourceType.Exif });
    await db.updateTable('asset').set({ deletedAt: new Date() }).where('id', '=', trashed.id).execute();

    // A sibling PET face carries no re-detection risk (F1): handleDetectFaces never removes pet faces, so
    // this asset must NOT count toward sharedAssets even though it holds a second creature's face.
    const petOnly = await seedAsset(db, { ownerId: user.id });
    await seedFace(db, { assetId: petOnly.id, personGroupId: target.personGroupId, sourceType: SourceType.Exif });
    await seedFace(db, { assetId: petOnly.id, personGroupId: pet.personGroupId, isPet: true });

    const counts = await repo.getCounts(target.personGroupId, DissolveScope.Exif);

    expect(counts.faces).toBe(7);
    expect(counts.delete).toBe(7);
    expect(counts.assets).toBe(6);
    expect(counts.rescanAssets).toBe(6);
    expect(counts.sharedAssets).toBe(1);
    expect(counts.notRedetectable).toBe(3);
  });

  it('splits in-scope faces by the treatment each gets', async () => {
    const repo = new FaceDissolveRepository(db);
    const user = await seedUser(db);
    const target = await seedPerson(db, { ownerId: user.id, name: 'Target' });
    const asset = await seedAsset(db, { ownerId: user.id });
    const on = { assetId: asset.id, personGroupId: target.personGroupId };

    await seedFace(db, { ...on, withEmbedding: true });
    await seedFace(db, on);
    await seedFace(db, { ...on, deletedAt: new Date() });
    await seedFace(db, { ...on, sourceType: SourceType.Exif });
    await seedFace(db, { ...on, sourceType: SourceType.Manual });

    const counts = await repo.getCounts(target.personGroupId, DissolveScope.All);
    expect(counts).toMatchObject({ faces: 5, hide: 3, delete: 1, keep: 1, softDeleted: 1 });
  });

  it('says whether the person survives, and how many faces it keeps', async () => {
    const repo = new FaceDissolveRepository(db);
    const user = await seedUser(db);
    const target = await seedPerson(db, { ownerId: user.id, name: 'Target' });
    const asset = await seedAsset(db, { ownerId: user.id });
    const on = { assetId: asset.id, personGroupId: target.personGroupId };

    await seedFace(db, { ...on, sourceType: SourceType.Exif });
    await seedFace(db, { ...on, withEmbedding: true });
    await seedFace(db, { ...on, withEmbedding: true, isVisible: false });

    const exifScope = await repo.getCounts(target.personGroupId, DissolveScope.Exif);
    expect(exifScope).toMatchObject({ remainingFaces: 2, personRemoved: false });

    const allScope = await repo.getCounts(target.personGroupId, DissolveScope.All);
    expect(allScope).toMatchObject({ remainingFaces: 0, personRemoved: true });
  });

  it('counts shared and unrecoverable photos only among the photos that get re-scanned', async () => {
    const repo = new FaceDissolveRepository(db);
    const user = await seedUser(db);
    const target = await seedPerson(db, { ownerId: user.id, name: 'Target' });
    const other = await seedPerson(db, { ownerId: user.id, name: 'Other' });

    // Detected faces are hidden, never re-scanned, so neither photo below is at risk.
    const sharedMl = await seedAsset(db, { ownerId: user.id });
    await seedFace(db, { assetId: sharedMl.id, personGroupId: target.personGroupId, withEmbedding: true });
    await seedFace(db, { assetId: sharedMl.id, personGroupId: other.personGroupId, withEmbedding: true });
    const hiddenMl = await seedAsset(db, { ownerId: user.id, visibility: AssetVisibility.Hidden });
    await seedFace(db, { assetId: hiddenMl.id, personGroupId: target.personGroupId, withEmbedding: true });

    const counts = await repo.getCounts(target.personGroupId, DissolveScope.All);
    expect(counts).toMatchObject({ assets: 2, rescanAssets: 0, sharedAssets: 0, notRedetectable: 0 });
  });

  it('counts the Space persons a dissolve removes and the ones that remain', async () => {
    const repo = new FaceDissolveRepository(db);
    const user = await seedUser(db);
    const target = await seedPerson(db, { ownerId: user.id, name: 'Target' });
    const other = await seedPerson(db, { ownerId: user.id, name: 'Other' });
    const asset = await seedAsset(db, { ownerId: user.id });
    const junk1 = await seedFace(db, { assetId: asset.id, personGroupId: target.personGroupId, withEmbedding: true });
    const junk2 = await seedFace(db, { assetId: asset.id, personGroupId: target.personGroupId, withEmbedding: true });
    const otherFace = await seedFace(db, {
      assetId: asset.id,
      personGroupId: other.personGroupId,
      withEmbedding: true,
    });

    const space1 = await seedSpace(db, user.id);
    const space2 = await seedSpace(db, user.id);
    await seedSpacePerson(db, space1, [junk1.id]);
    await seedSpacePerson(db, space1, [junk2.id, otherFace.id]);
    await seedSpacePerson(db, space2, [junk1.id, otherFace.id]);

    const counts = await repo.getCounts(target.personGroupId, DissolveScope.All);
    expect(counts).toMatchObject({ spacePersonsRemoved: 1, spacePersonsKept: 2, spacesKept: 2 });
  });

  // The Health tab and this dialog must describe the SAME face set: discovery exists to predict what a
  // dissolve will remove. They disagreed, because the aggregate filtered isVisible/deletedAt and the
  // dissolve does not — so the dialog counted (and the dissolve deleted) faces discovery never showed.
  it('agrees with the discovery aggregate on a person holding invisible and soft-deleted faces', async () => {
    const repo = new FaceDissolveRepository(db);
    const user = await seedUser(db);
    const target = await seedPerson(db, { ownerId: user.id, name: 'Target' });
    const asset = await seedAsset(db, { ownerId: user.id });

    await seedFace(db, { assetId: asset.id, personGroupId: target.personGroupId, sourceType: SourceType.Exif });
    await seedFace(db, { assetId: asset.id, personGroupId: target.personGroupId, sourceType: SourceType.Exif });
    // Invisible and soft-deleted faces are still this person's, and a dissolve still deletes them.
    const invisible = await seedFace(db, {
      assetId: asset.id,
      personGroupId: target.personGroupId,
      sourceType: SourceType.Exif,
    });
    await db.updateTable('asset_face').set({ isVisible: false }).where('id', '=', invisible.id).execute();
    await seedFace(db, {
      assetId: asset.id,
      personGroupId: target.personGroupId,
      sourceType: SourceType.Exif,
      deletedAt: new Date(),
    });

    const counts = await repo.getCounts(target.personGroupId, DissolveScope.All);
    const health = await repo.getPeopleHealth({ ownerId: user.id, sort: 'faceCount', page: 1, size: 10 });
    const row = health.people.find((person) => person.id === target.personGroupId)!;

    // 4 = 2 plain + 1 invisible + 1 soft-deleted. Discovery must not quietly report 2.
    expect(counts.faces).toBe(4);
    expect(row.faceCount).toBe(counts.faces);
    expect(row.exif).toBe(counts.delete);
    expect(row.facesWithoutEmbedding).toBe(counts.faces);
  });
});
