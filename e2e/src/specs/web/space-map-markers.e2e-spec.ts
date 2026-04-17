import type { LoginResponseDto } from '@immich/sdk';
import { removeMember as removeSpaceMember, SharedSpaceRole, updateAssets, updateMemberTimeline } from '@immich/sdk';
import { expect, test } from '@playwright/test';
import { asBearerAuth, utils } from 'src/utils';

// Asset-creation helper: createAsset in utils doesn't set GPS coords, so we
// patch the asset after upload via the SDK's bulk update endpoint.
async function setAssetGeo(accessToken: string, assetId: string, latitude: number, longitude: number) {
  await updateAssets(
    { assetBulkUpdateDto: { ids: [assetId], latitude, longitude } },
    { headers: asBearerAuth(accessToken) },
  );
}

async function fetchMarkers(page: import('@playwright/test').Page, accessToken: string) {
  const response = await page.request.get('/api/gallery/map/markers?withSharedSpaces=true', {
    headers: asBearerAuth(accessToken),
  });
  if (!response.ok()) {
    throw new Error(`Unexpected status ${response.status()}: ${await response.text()}`);
  }
  return (await response.json()) as Array<{ id: string }>;
}

test.describe('Space photos on personal map', () => {
  let admin: LoginResponseDto;
  let memberLogin: LoginResponseDto;
  let memberId: string;
  let spaceId: string;
  let ownerAssetId: string;

  test.beforeAll(async () => {
    utils.initSdk();
    await utils.resetDatabase();
    admin = await utils.adminSetup();

    // Admin (owner) creates the space and member
    memberLogin = await utils.userSetup(admin.accessToken, {
      email: 'member@test.com',
      name: 'Member',
      password: 'password',
    });
    memberId = memberLogin.userId;

    const space = await utils.createSpace(admin.accessToken, { name: 'Trip Photos' });
    spaceId = space.id;
    await utils.addSpaceMember(admin.accessToken, space.id, { userId: memberId, role: SharedSpaceRole.Viewer });

    // Owner uploads an asset, sets its GPS, adds it to the space
    const asset = await utils.createAsset(admin.accessToken);
    ownerAssetId = asset.id;
    await setAssetGeo(admin.accessToken, asset.id, 48.8566, 2.3522); // Paris
    await utils.addSpaceAssets(admin.accessToken, space.id, [asset.id]);
  });

  test('member sees space marker on personal map (matrix row 1)', async ({ page }) => {
    const markers = await fetchMarkers(page, memberLogin.accessToken);
    expect(markers.find((m) => m.id === ownerAssetId)).toBeDefined();
  });

  test('marker disappears when member sets showInTimeline=false (matrix row 7)', async ({ page }) => {
    // Self-PATCH — `/me/timeline` requires the member's own token, not admin's.
    await updateMemberTimeline(
      { id: spaceId, sharedSpaceMemberTimelineDto: { showInTimeline: false } },
      { headers: asBearerAuth(memberLogin.accessToken) },
    );

    try {
      const markers = await fetchMarkers(page, memberLogin.accessToken);
      expect(markers.find((m) => m.id === ownerAssetId)).toBeUndefined();
    } finally {
      // Restore so subsequent tests in this describe don't inherit the off state.
      await updateMemberTimeline(
        { id: spaceId, sharedSpaceMemberTimelineDto: { showInTimeline: true } },
        { headers: asBearerAuth(memberLogin.accessToken) },
      );
    }
  });

  test('non-member sees no space markers (matrix row 8)', async ({ page }) => {
    const outsiderLogin = await utils.userSetup(admin.accessToken, {
      email: 'outsider@test.com',
      name: 'Outsider',
      password: 'password',
    });

    const markers = await fetchMarkers(page, outsiderLogin.accessToken);
    expect(markers.find((m) => m.id === ownerAssetId)).toBeUndefined();
  });

  test('former member (removed from space) sees no marker (matrix row 9)', async ({ page }) => {
    // Admin removes the member from the space.
    await removeSpaceMember({ id: spaceId, userId: memberId }, { headers: asBearerAuth(admin.accessToken) });

    try {
      const markers = await fetchMarkers(page, memberLogin.accessToken);
      expect(markers.find((m) => m.id === ownerAssetId)).toBeUndefined();
    } finally {
      // Re-add the member so we leave state consistent if other specs share this file's describe.
      await utils.addSpaceMember(admin.accessToken, spaceId, { userId: memberId, role: SharedSpaceRole.Viewer });
    }
  });
});
