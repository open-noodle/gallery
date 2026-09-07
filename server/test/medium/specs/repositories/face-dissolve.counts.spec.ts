import { Kysely } from 'kysely';
import { AssetVisibility, SourceType } from 'src/enum';
import { FaceDissolveRepository } from 'src/repositories/face-dissolve.repository';
import { DB } from 'src/schema';
import { DissolveScope } from 'src/utils/face-dissolve';
import { seedAsset, seedFace, seedPerson, seedUser } from 'test/medium/specs/repositories/face-dissolve.fixtures';
import { getKyselyDB } from 'test/utils';
import { beforeAll, describe, expect, it } from 'vitest';

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
    await seedFace(db, { assetId: solo.id, personId: target.id, sourceType: SourceType.Exif });
    // A second in-scope target face on the SAME asset (F5): `assets` must count this asset once, not twice.
    await seedFace(db, { assetId: solo.id, personId: target.id, sourceType: SourceType.Exif });

    const shared = await seedAsset(db, { ownerId: user.id });
    await seedFace(db, { assetId: shared.id, personId: target.id, sourceType: SourceType.Exif });
    await seedFace(db, { assetId: shared.id, personId: other.id });
    // A second sibling face on the SAME shared asset (F2): `sharedAssets` counts qualifying ASSETS, not rows.
    await seedFace(db, { assetId: shared.id, personId: other.id });

    // hidden and preview-less assets can never be re-detected (L11)
    const hidden = await seedAsset(db, { ownerId: user.id, visibility: AssetVisibility.Hidden });
    await seedFace(db, { assetId: hidden.id, personId: target.id, sourceType: SourceType.Exif });

    const noPreview = await seedAsset(db, { ownerId: user.id, withPreview: false });
    await seedFace(db, { assetId: noPreview.id, personId: target.id, sourceType: SourceType.Exif });

    // A trashed asset can never be re-detected either (F3).
    const trashed = await seedAsset(db, { ownerId: user.id });
    await seedFace(db, { assetId: trashed.id, personId: target.id, sourceType: SourceType.Exif });
    await db.updateTable('asset').set({ deletedAt: new Date() }).where('id', '=', trashed.id).execute();

    // A sibling PET face carries no re-detection risk (F1): handleDetectFaces never removes pet faces, so
    // this asset must NOT count toward sharedAssets even though it holds a second creature's face.
    const petOnly = await seedAsset(db, { ownerId: user.id });
    await seedFace(db, { assetId: petOnly.id, personId: target.id, sourceType: SourceType.Exif });
    await seedFace(db, { assetId: petOnly.id, personId: pet.id, isPet: true });

    const counts = await repo.getCounts(target.id, DissolveScope.Exif);

    expect(counts.faces).toBe(7);
    expect(counts.exif).toBe(7);
    expect(counts.assets).toBe(6);
    expect(counts.sharedAssets).toBe(1);
    expect(counts.notRedetectable).toBe(3);
  });

  it('splits detected faces by whether they carry an embedding', async () => {
    const repo = new FaceDissolveRepository(db);
    const user = await seedUser(db);
    const target = await seedPerson(db, { ownerId: user.id, name: 'Target' });
    const asset = await seedAsset(db, { ownerId: user.id });

    await seedFace(db, { assetId: asset.id, personId: target.id, withEmbedding: true });
    await seedFace(db, { assetId: asset.id, personId: target.id });
    await seedFace(db, { assetId: asset.id, personId: target.id, deletedAt: new Date() });
    // An EXIF-sourced face mixed in (F4): `exif` must differ from `faces`, not trivially equal it.
    await seedFace(db, { assetId: asset.id, personId: target.id, sourceType: SourceType.Exif });

    const counts = await repo.getCounts(target.id, DissolveScope.All);
    expect(counts.faces).toBe(4);
    expect(counts.exif).toBe(1);
    expect(counts.mlWithEmbedding).toBe(1);
    expect(counts.mlWithoutEmbedding).toBe(2);
    expect(counts.softDeleted).toBe(1);
  });

  // Feeds the "the nightly cleanup deletes this person anyway" warning. Counted with PersonCleanup's own
  // definition of "has a face" (getAllWithoutFaces: deletedAt IS NULL AND isVisible IS TRUE), because that
  // is the query that decides the person's fate — not the displayed face count.
  it('counts the live faces a dissolve would leave behind, PersonCleanup-style', async () => {
    const repo = new FaceDissolveRepository(db);
    const user = await seedUser(db);
    const target = await seedPerson(db, { ownerId: user.id, name: 'Target' });
    const asset = await seedAsset(db, { ownerId: user.id });

    await seedFace(db, { assetId: asset.id, personId: target.id, sourceType: SourceType.Exif });
    await seedFace(db, { assetId: asset.id, personId: target.id, withEmbedding: true });
    // Neither of these keeps a person alive: PersonCleanup's join excludes both.
    await seedFace(db, { assetId: asset.id, personId: target.id, sourceType: SourceType.Exif, deletedAt: new Date() });
    const invisible = await seedFace(db, { assetId: asset.id, personId: target.id, sourceType: SourceType.Exif });
    await db.updateTable('asset_face').set({ isVisible: false }).where('id', '=', invisible.id).execute();

    // Dissolving only the EXIF faces leaves the live ML face behind — the person survives.
    const exifScope = await repo.getCounts(target.id, DissolveScope.Exif);
    expect(exifScope.remainingLiveFaces).toBe(1);

    // Dissolving everything leaves nothing live behind, so the nightly cleanup takes the person.
    const allScope = await repo.getCounts(target.id, DissolveScope.All);
    expect(allScope.remainingLiveFaces).toBe(0);

    // And the ML-only scope leaves the live EXIF face, so it is not a constant either.
    const mlScope = await repo.getCounts(target.id, DissolveScope.MachineLearning);
    expect(mlScope.remainingLiveFaces).toBe(1);
  });

  // getCounts was previously exercised with Exif, All and MachineLearning but never WithoutEmbedding —
  // the one scope whose predicate is an anti-join rather than an equality, and the only one that can
  // select faces across BOTH source types. Reported from production, where the tab appeared to duplicate
  // the machine-learning numbers.
  it('counts the without-embedding scope across both source types, never the embedded ones', async () => {
    const repo = new FaceDissolveRepository(db);
    const user = await seedUser(db);
    const target = await seedPerson(db, { ownerId: user.id, name: 'Target' });
    const asset = await seedAsset(db, { ownerId: user.id });

    // The contamination shape: EXIF faces never carry an embedding.
    await seedFace(db, { assetId: asset.id, personId: target.id, sourceType: SourceType.Exif });
    await seedFace(db, { assetId: asset.id, personId: target.id, sourceType: SourceType.Exif });
    // A bare ML face — no embedding either, so it belongs to this scope too.
    await seedFace(db, { assetId: asset.id, personId: target.id });
    // Three EMBEDDED ML faces, which this scope must never touch.
    for (let i = 0; i < 3; i++) {
      await seedFace(db, { assetId: asset.id, personId: target.id, withEmbedding: true });
    }

    const noEmbedding = await repo.getCounts(target.id, DissolveScope.WithoutEmbedding);
    // 2 exif + 1 bare ML. Every number below is distinct from the machine-learning scope's, so a predicate
    // that aliased the two would fail rather than coincide.
    expect(noEmbedding.faces).toBe(3);
    expect(noEmbedding.exif).toBe(2);
    expect(noEmbedding.mlWithoutEmbedding).toBe(1);
    // Definitional: nothing in a no-embedding set can have an embedding. This is the assertion that fails
    // if the scope ever selects the embedded faces instead.
    expect(noEmbedding.mlWithEmbedding).toBe(0);

    const ml = await repo.getCounts(target.id, DissolveScope.MachineLearning);
    expect(ml.faces).toBe(4);
    expect(ml.mlWithEmbedding).toBe(3);
    // The two scopes must not agree on this library, or the test could not tell them apart.
    expect(noEmbedding.faces).not.toBe(ml.faces);
  });

  // The Health tab and this dialog must describe the SAME face set: discovery exists to predict what a
  // dissolve will remove. They disagreed, because the aggregate filtered isVisible/deletedAt and the
  // dissolve does not — so the dialog counted (and the dissolve deleted) faces discovery never showed.
  it('agrees with the discovery aggregate on a person holding invisible and soft-deleted faces', async () => {
    const repo = new FaceDissolveRepository(db);
    const user = await seedUser(db);
    const target = await seedPerson(db, { ownerId: user.id, name: 'Target' });
    const asset = await seedAsset(db, { ownerId: user.id });

    await seedFace(db, { assetId: asset.id, personId: target.id, sourceType: SourceType.Exif });
    await seedFace(db, { assetId: asset.id, personId: target.id, sourceType: SourceType.Exif });
    // Invisible and soft-deleted faces are still this person's, and a dissolve still deletes them.
    const invisible = await seedFace(db, { assetId: asset.id, personId: target.id, sourceType: SourceType.Exif });
    await db.updateTable('asset_face').set({ isVisible: false }).where('id', '=', invisible.id).execute();
    await seedFace(db, { assetId: asset.id, personId: target.id, sourceType: SourceType.Exif, deletedAt: new Date() });

    const counts = await repo.getCounts(target.id, DissolveScope.All);
    const health = await repo.getPeopleHealth({ ownerId: user.id, sort: 'faceCount', page: 1, size: 10 });
    const row = health.people.find((person) => person.id === target.id)!;

    // 4 = 2 plain + 1 invisible + 1 soft-deleted. Discovery must not quietly report 2.
    expect(counts.faces).toBe(4);
    expect(row.faceCount).toBe(counts.faces);
    expect(row.exif).toBe(counts.exif);
    expect(row.facesWithoutEmbedding).toBe(counts.faces);
  });
});
