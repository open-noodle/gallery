import { BadRequestException } from '@nestjs/common';
import { checkAssetEditAccess, requireAssetEditAccess } from 'src/gallery/utils/access-grants.js';
import { AccessRepository } from 'src/repositories/access.repository.js';
import { newAccessRepositoryMock } from 'test/repositories/access.repository.mock.js';
import { factory, newUuid } from 'test/small.factory.js';

describe('checkAssetEditAccess', () => {
  it('grants owned assets, then space Owner/Editor assets over the rest', async () => {
    const access = newAccessRepositoryMock();
    const auth = factory.auth();
    const [owned, edited, other] = [newUuid(), newUuid(), newUuid()];
    access.asset.checkOwnerAccess.mockResolvedValue(new Set([owned]));
    access.spaceAsset.checkSpaceEditAccess.mockResolvedValue(new Set([edited]));

    const result = await checkAssetEditAccess(access as unknown as AccessRepository, {
      auth,
      ids: [owned, edited, other],
    });

    expect(result).toEqual(new Set([owned, edited]));
    expect(access.spaceAsset.checkSpaceEditAccess).toHaveBeenCalledWith(auth.user.id, new Set([edited, other]));
  });

  it('grants nothing to a shared-link session', async () => {
    const access = newAccessRepositoryMock();
    const auth = factory.auth({ sharedLink: {} });
    const id = newUuid();
    access.asset.checkOwnerAccess.mockResolvedValue(new Set([id]));
    access.spaceAsset.checkSpaceEditAccess.mockResolvedValue(new Set([id]));

    await expect(checkAssetEditAccess(access as unknown as AccessRepository, { auth, ids: [id] })).resolves.toEqual(
      new Set(),
    );
    expect(access.spaceAsset.checkSpaceEditAccess).not.toHaveBeenCalled();
  });
});

describe('requireAssetEditAccess', () => {
  it('passes when every id is editable', async () => {
    const access = newAccessRepositoryMock();
    const id = newUuid();
    access.spaceAsset.checkSpaceEditAccess.mockResolvedValue(new Set([id]));

    await expect(
      requireAssetEditAccess(access as unknown as AccessRepository, { auth: factory.auth(), ids: [id] }),
    ).resolves.toBeUndefined();
  });

  it('throws when any id is not editable', async () => {
    const access = newAccessRepositoryMock();
    const [owned, other] = [newUuid(), newUuid()];
    access.asset.checkOwnerAccess.mockResolvedValue(new Set([owned]));

    await expect(
      requireAssetEditAccess(access as unknown as AccessRepository, { auth: factory.auth(), ids: [owned, other] }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
