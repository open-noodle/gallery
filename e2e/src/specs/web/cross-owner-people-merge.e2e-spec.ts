import type { LoginResponseDto, SystemConfigDto } from '@immich/sdk';
import { expect, test } from '@playwright/test';
import { asBearerAuth, utils } from 'src/utils';

// Browser coverage for the cross-owner people-merge UX (issue #733). A regular (non-admin) user
// drives the real person-detail merge flow; the instance toggle — not admin status — decides the
// outcome. ML is disabled in the e2e stack, so the cross-owner precondition (one face identity on
// two owners' people) is seeded directly in SQL, mirroring shared-space-person-profile.e2e-spec.ts.
//
// The two scenarios mutate shared seed state (the second one commits the merge), so they run in
// order: toggle-off (blocked, no mutation) first, then toggle-on (confirm -> commit).
test.describe.configure({ mode: 'serial' });

test.describe('Cross-owner people merge', () => {
  let admin: LoginResponseDto;
  let actor: LoginResponseDto;
  let targetPersonId: string;
  let baseConfig: SystemConfigDto;

  test.beforeAll(async () => {
    utils.initSdk();
    await utils.resetDatabase([
      'face_identity_face',
      'face_identity',
      'shared_space',
      'person',
      'album',
      'asset',
      'asset_face',
      'activity',
      'api_key',
      'session',
      'user',
      'system_metadata',
      'tag',
      'user_group',
    ]);
    const db = await utils.connectDatabase();

    admin = await utils.adminSetup();
    actor = await utils.userSetup(admin.accessToken, {
      email: 'cross-owner-actor@test.com',
      name: 'Cross Owner Actor',
      password: 'password',
    });
    const otherOwner = await utils.userSetup(admin.accessToken, {
      email: 'cross-owner-other@test.com',
      name: 'Cross Owner Other',
      password: 'password',
    });

    // The actor owns the space, so as its Owner they can repair the space-person source.
    const space = await utils.createSpace(actor.accessToken, { name: 'Cross Owner Space' });

    const targetPerson = await utils.createPerson(actor.accessToken, { name: 'Ada Target' });
    const otherOwnerPerson = await utils.createPerson(otherOwner.accessToken, { name: 'Ada Other Owner' });
    targetPersonId = targetPerson.id;

    const actorAsset = await utils.createAsset(actor.accessToken);
    const otherAsset = await utils.createAsset(otherOwner.accessToken);

    // Mint identities: targetPerson -> T, otherOwnerPerson -> S. The target's asset is deliberately
    // NOT added to the space, so identity T has no space profile and the cross-owner merge does not
    // trip the same-scope-conflict guard.
    await utils.createFace({ assetId: actorAsset.id, personId: targetPerson.id });
    const otherFace = await utils.createFace({ assetId: otherAsset.id, personId: otherOwnerPerson.id });
    const otherOwnerRow = await db.query(`SELECT "identityId" FROM "person" WHERE id = $1`, [otherOwnerPerson.id]);
    const identityS = otherOwnerRow.rows[0].identityId as string;

    // A space-person in the actor's space carries identity S — repairable by the actor, but S also
    // belongs to the other owner's personal person, which makes the merge cross-owner.
    const spacePerson = await db.query(
      `INSERT INTO "shared_space_person"
         ("spaceId", name, "isHidden", "faceCount", "assetCount", "representativeFaceId", "identityId", "type")
       VALUES ($1, 'Ada Shared', false, 3, 3, $2, $3, 'person')
       RETURNING id`,
      [space.id, otherFace, identityS],
    );
    const sharedPersonId = spacePerson.rows[0].id as string;
    await db.query(`INSERT INTO "shared_space_person_face" ("personId", "assetFaceId") VALUES ($1, $2)`, [
      sharedPersonId,
      otherFace,
    ]);

    // Give identity S three actor-accessible faces inside the space so "Ada Shared" clears the
    // minimum-face-count threshold and surfaces as a candidate in the actor's merge selector
    // (getAllPeople?withSharedSpaces=true). The faces sit on actor-owned in-space assets and attach
    // to identity S so they resolve to the same "Ada Shared" space-person.
    const spaceAssets = await Promise.all([
      utils.createAsset(actor.accessToken),
      utils.createAsset(actor.accessToken),
      utils.createAsset(actor.accessToken),
    ]);
    await utils.addSpaceAssets(
      actor.accessToken,
      space.id,
      spaceAssets.map((asset) => asset.id),
    );
    for (const asset of spaceAssets) {
      const faceRow = await db.query(`INSERT INTO "asset_face" ("assetId") VALUES ($1) RETURNING id`, [asset.id]);
      const assetFaceId = faceRow.rows[0].id as string;
      await db.query(
        `INSERT INTO "face_identity_face" ("assetFaceId", "identityId", "source") VALUES ($1, $2, 'manual')`,
        [assetFaceId, identityS],
      );
      await db.query(`INSERT INTO "shared_space_person_face" ("personId", "assetFaceId") VALUES ($1, $2)`, [
        sharedPersonId,
        assetFaceId,
      ]);
    }

    baseConfig = await utils.getSystemConfig(admin.accessToken);
  });

  const setCrossOwnerMerge = async (page: import('@playwright/test').Page, enabled: boolean) => {
    const response = await page.request.put('/api/system-config', {
      headers: asBearerAuth(admin.accessToken),
      data: { ...baseConfig, server: { ...baseConfig.server, mergePeopleAcrossOwners: enabled } },
    });
    expect(response.ok()).toBe(true);
  };

  // Opens the merge selector on the actor's target person, picks the cross-owner space-person, and
  // clicks through the generic "merge these people?" confirmation — the point where the server is hit.
  const startCrossOwnerMerge = async (page: import('@playwright/test').Page) => {
    await page.goto(`/people/${targetPersonId}`);
    await expect(page.getByText('Ada Target')).toBeVisible();

    await page.getByRole('button', { name: 'Open', exact: true }).click();
    await page.getByText('Merge people').click();
    await expect(page.getByText('Choose matching people to merge')).toBeVisible();

    await page.getByRole('button', { name: 'Ada Shared' }).click();
    await page.getByRole('button', { name: 'Merge', exact: true }).click();

    // Generic pre-merge confirmation (default confirm label).
    await page.getByRole('dialog').getByRole('button', { name: 'Confirm' }).click();
  };

  test('blocks the merge with a descriptive toast when the toggle is off', async ({ context, page }) => {
    await setCrossOwnerMerge(page, false);
    await utils.setAuthCookies(context, actor.accessToken);

    await startCrossOwnerMerge(page);

    // The server's descriptive blocked message is surfaced (never a raw error), and the merge
    // selector stays put because nothing committed.
    await expect(page.getByText(/appears in another user/i)).toBeVisible();
    await expect(page.getByText('Choose matching people to merge')).toBeVisible();
  });

  test('shows a cross-owner confirmation and completes the merge when the toggle is on', async ({ context, page }) => {
    await setCrossOwnerMerge(page, true);
    await utils.setAuthCookies(context, actor.accessToken);

    await startCrossOwnerMerge(page);

    // The strong cross-owner confirmation dialog appears; confirming it re-runs the merge with the
    // acknowledgement so the server commits it.
    const confirmDialog = page.getByRole('dialog');
    await expect(confirmDialog.getByText('Merge people across owners')).toBeVisible();
    await confirmDialog.getByRole('button', { name: 'Merge' }).click();

    await expect(page.getByText(/Merged 1 person/i)).toBeVisible();
  });
});
