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

  it('reports false for a shared-link call with no auth', () => {
    // The mapSharedLink regression this slice exists to prevent: no auth object at all ->
    // isFavoriteForUser is never projected -> must never leak a favorite to an anonymous visitor.
    const asset = getForAsset(AssetFactory.create());

    const result = mapAsset(asset, { stripMetadata: false });

    expect(result.isFavorite).toBe(false);
  });

  // #763 slice 3: the global asset."isFavorite" column mapAsset used to guard against leaking
  // (owner's raw flag reaching non-owners / anonymous callers) has been dropped outright — the
  // leak this guarded against is now structurally impossible, since there is no raw column left
  // to fall back to. The fail-safe-false coverage above (row without isFavoriteForUser) and the
  // grep gate (favorite-grep-gate.spec.ts) cover the same intent going forward.
});
