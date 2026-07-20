import { mapAsset } from 'src/dtos/asset-response.dto';
import { AssetFactory } from 'test/factories/asset.factory';
import { authStub } from 'test/fixtures/auth.stub';
import { getForAsset } from 'test/mappers';

describe('mapAsset — per-user favorite (#763)', () => {
  it('reports true when the row carries isFavoriteForUser', () => {
    const asset = getForAsset(AssetFactory.create({ ownerId: authStub.user1.user.id }));

    const result = mapAsset({ ...asset, isFavoriteForUser: true }, { auth: authStub.user1 });

    expect(result.isFavorite).toBe(true);
  });

  it('reports false when the row carries isFavoriteForUser false', () => {
    const asset = getForAsset(AssetFactory.create({ ownerId: authStub.user1.user.id }));

    const result = mapAsset({ ...asset, isFavoriteForUser: false }, { auth: authStub.user1 });

    expect(result.isFavorite).toBe(false);
  });

  it('reports false when the row does not carry the field at all', () => {
    // a query that forgot to project -> fail-safe false, never a leak
    const asset = getForAsset(AssetFactory.create({ ownerId: authStub.user1.user.id }));

    const result = mapAsset(asset, { auth: authStub.user1 });

    expect(result.isFavorite).toBe(false);
  });

  it('NEVER reads the raw asset.isFavorite column', () => {
    // This is the anti-leak assertion: owner, raw column true, overlay false -> false.
    // Raw and overlay are deliberately made to DISAGREE; if the mapper ever falls back
    // to entity.isFavorite, this fails.
    const asset = getForAsset(AssetFactory.create({ ownerId: authStub.user1.user.id, isFavorite: true }));

    const result = mapAsset({ ...asset, isFavoriteForUser: false }, { auth: authStub.user1 });

    expect(result.isFavorite).toBe(false);
  });

  it('reports false for a shared-link call with no auth, even when the raw column is true', () => {
    // The mapSharedLink regression this slice exists to prevent: no auth object at all,
    // raw column true. Must never leak the owner's favorite to an anonymous visitor.
    const asset = getForAsset(AssetFactory.create({ isFavorite: true }));

    const result = mapAsset(asset, { stripMetadata: false });

    expect(result.isFavorite).toBe(false);
  });
});
