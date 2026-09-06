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

    const solo = await seedAsset(db, { ownerId: user.id });
    await seedFace(db, { assetId: solo.id, personId: target.id, sourceType: SourceType.Exif });

    const shared = await seedAsset(db, { ownerId: user.id });
    await seedFace(db, { assetId: shared.id, personId: target.id, sourceType: SourceType.Exif });
    await seedFace(db, { assetId: shared.id, personId: other.id });

    // hidden and preview-less assets can never be re-detected (L11)
    const hidden = await seedAsset(db, { ownerId: user.id, visibility: AssetVisibility.Hidden });
    await seedFace(db, { assetId: hidden.id, personId: target.id, sourceType: SourceType.Exif });

    const noPreview = await seedAsset(db, { ownerId: user.id, withPreview: false });
    await seedFace(db, { assetId: noPreview.id, personId: target.id, sourceType: SourceType.Exif });

    const counts = await repo.getCounts(target.id, DissolveScope.Exif);

    expect(counts.faces).toBe(4);
    expect(counts.exif).toBe(4);
    expect(counts.assets).toBe(4);
    expect(counts.sharedAssets).toBe(1);
    expect(counts.notRedetectable).toBe(2);
  });

  it('splits detected faces by whether they carry an embedding', async () => {
    const repo = new FaceDissolveRepository(db);
    const user = await seedUser(db);
    const target = await seedPerson(db, { ownerId: user.id, name: 'Target' });
    const asset = await seedAsset(db, { ownerId: user.id });

    await seedFace(db, { assetId: asset.id, personId: target.id, withEmbedding: true });
    await seedFace(db, { assetId: asset.id, personId: target.id });
    await seedFace(db, { assetId: asset.id, personId: target.id, deletedAt: new Date() });

    const counts = await repo.getCounts(target.id, DissolveScope.All);
    expect(counts.mlWithEmbedding).toBe(1);
    expect(counts.mlWithoutEmbedding).toBe(2);
    expect(counts.softDeleted).toBe(1);
  });
});
