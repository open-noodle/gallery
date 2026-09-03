import type { LoginResponseDto } from '@immich/sdk';
import {
  createUnion,
  DefaultAccess,
  FamilyAccessLevel,
  FamilyUnionStatus,
  getUnions,
  setAccess,
  setMyRoot,
  SharedSpaceRole,
  updateConfig,
} from '@immich/sdk';
import { expect, test } from '@playwright/test';
import { asBearerAuth, utils } from 'src/utils';

// Family relationships — slice 15, Task 1: the three journeys that prove the assembled feature
// works end to end. See specs/2026-08-31-family-relationships-design-and-slices.md (D1-D8) and
// .superpowers/plans/2026-08-31-family-relationships-slice-15.md.
//
// DRAG-AND-DROP DECISION (recorded here per the slice-15 instructions): the canvas
// (`FamilyCanvas.svelte`) uses native HTML5 `dragstart`/`dragover`/`drop` with `DataTransfer`.
// Playwright's `locator.dragTo()` does not reliably drive this — the browser-level drag gesture
// it simulates does not consistently deliver a populated `DataTransfer` to a `drop` listener
// across elements. Playwright's own documented workaround for exactly this case is used instead:
// create ONE `DataTransfer` via `page.evaluateHandle`, then dispatch `dragstart` / `dragover` /
// `drop` (and `dragend`) as discrete events that all share that same handle. This reproduces the
// real gesture (the same event sequence and the same `DataTransfer` object a physical drag would
// deliver) rather than calling the API directly, and journey 1 below exercises it for a genuine
// mutation, verified via the resulting network response AND the derived label changing on a
// completely different page afterwards.
//
// What this does NOT exercise: the canvas can only ever drag a card that is already rendered
// somewhere in the CURRENTLY SELECTED cluster (`FamilyCanvas.svelte`'s own comment: "there is no
// 'new person' branch here for this slice — no tray/search surface exists yet to originate a drag
// for someone not already on the canvas"), and a cluster is one connected component, so two
// people can only ever be dragged relative to each other once SOME union already connects them
// into the same rendered graph. Concretely: the very first union in a graph, and any union that
// would connect two previously-disconnected people for the first time, cannot be created via drag
// today — only through the API (or, for a real user, by having the two people already share some
// other recorded relationship). Journey 1 below seeds its graph via the API for exactly this
// reason and uses the real drag only for the one edge that can honestly be added that way: giving
// a child who already has one recorded parent a second one, which is also the most common
// "growing an existing family" action a real user would perform in this UI. This is a real,
// current gap in slice 10/11's canvas (no way to introduce a brand-new person by dragging), not a
// Playwright reliability workaround — it would be true for a human user with a mouse too.

/** Mints a person + a private asset + a face, and returns the resulting identity id (read back
 * via SQL — `PersonResponseDto` deliberately never exposes `identityId`, per CLAUDE.md). Mirrors
 * `person-face-suggestions.e2e-spec.ts`'s use of `utils.createFace` to wire up `face_identity`. */
async function mintIdentity(
  db: Awaited<ReturnType<typeof utils.connectDatabase>>,
  accessToken: string,
  name: string,
  assetId?: string,
): Promise<{ personId: string; identityId: string }> {
  const person = await utils.createPerson(accessToken, { name });
  const asset = assetId ? { id: assetId } : await utils.createAsset(accessToken);
  // sourceType: 'manual' — this dev stack has facial recognition ML enabled, and the default
  // 'machine-learning' sourceType is treated as a prior ML detection: `handleDetectFaces` re-runs
  // on the (fake) asset, finds 0 real faces, and DELETES the seeded face shortly afterward —
  // silently wiping the identity out from under the test a few seconds into the run. See the
  // comment on utils.createFace itself for the same warning.
  await utils.createFace({ assetId: asset.id, personId: person.id, sourceType: 'manual' });
  const row = await db.query<{ identityId: string }>(`SELECT "identityId" FROM "person" WHERE id = $1`, [person.id]);
  return { personId: person.id, identityId: row.rows[0].identityId };
}

test.describe('Family relationships (web)', () => {
  let admin: LoginResponseDto;

  test.beforeAll(async () => {
    utils.initSdk();
    // `face_identity`/`family_union` cascade the fork's family tables but aren't in the default
    // reset list; `shared_space` cascades every shared-space table journey 2 needs.
    await utils.resetDatabase([
      'stack',
      'library',
      'shared_link',
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
      'integrity_report',
      'user_group',
      'face_identity',
      'family_union',
      'shared_space',
    ]);
    admin = await utils.adminSetup();

    // A1/D2: the feature is off, and 'none' by default, until an admin turns it on. Every journey
    // below grants (or deliberately withholds) access explicitly per user, on top of this floor.
    const config = await utils.getSystemConfig(admin.accessToken);
    config.familyTree = { enabled: true, defaultAccess: DefaultAccess.None };
    await updateConfig({ systemConfigDto: config }, { headers: asBearerAuth(admin.accessToken) });
  });

  test('records a family and shows a derived relationship on the person page', async ({ context, page }) => {
    const user = await utils.userSetup(admin.accessToken, {
      email: 'family-j1-builder@test.com',
      name: 'Family Journey1 Builder',
      password: 'password',
    });
    await setAccess(
      { userId: user.userId, familyAccessUpdateDto: { level: FamilyAccessLevel.Contribute } },
      { headers: asBearerAuth(admin.accessToken) },
    );

    const db = await utils.connectDatabase();
    const grandparent = await mintIdentity(db, user.accessToken, 'E2E Journey1 Grandparent');
    const parent = await mintIdentity(db, user.accessToken, 'E2E Journey1 Parent');
    const root = await mintIdentity(db, user.accessToken, 'E2E Journey1 Root');
    const secondParent = await mintIdentity(db, user.accessToken, 'E2E Journey1 SecondParent');

    // Seeded via the API (see the drag-and-drop note above): grandparent -> parent -> root, plus
    // a second union that makes `secondParent` the PARENT's partner (not yet root's own parent).
    await createUnion(
      { familyUnionCreateDto: { partnerIds: [grandparent.identityId], childIds: [parent.identityId] } },
      { headers: asBearerAuth(user.accessToken) },
    );
    await createUnion(
      { familyUnionCreateDto: { partnerIds: [parent.identityId], childIds: [root.identityId] } },
      { headers: asBearerAuth(user.accessToken) },
    );
    // A distinct startDate keeps this union's partnerKey from colliding with the one the drag
    // below creates for the SAME pair (partnerKey = sorted partner ids + startDate, D1.5) once
    // secondParent also joins root's union as a second partner with no startDate of its own.
    await createUnion(
      {
        familyUnionCreateDto: {
          partnerIds: [parent.identityId, secondParent.identityId],
          status: FamilyUnionStatus.Married,
          startDate: '1990-06-01',
        },
      },
      { headers: asBearerAuth(user.accessToken) },
    );

    await utils.setAuthCookies(context, user.accessToken);

    // BEFORE: nobody ever typed "grandparent" anywhere — it falls out of two recorded
    // parent-child edges. secondParent is reachable only as a step-parent (the parent's partner
    // in a DIFFERENT union than the one that makes them root's own parent).
    await page.goto(`/people/${root.personId}`);
    const relationRow = (name: string) => page.getByTestId('family-relation-row').filter({ hasText: name });

    const grandparentRow = relationRow('E2E Journey1 Grandparent');
    await expect(grandparentRow).toBeVisible();
    await expect(grandparentRow.locator('p').nth(1)).toHaveText('grandparent');

    const secondParentRow = relationRow('E2E Journey1 SecondParent');
    await expect(secondParentRow).toBeVisible();
    await expect(secondParentRow.locator('p').nth(1)).toHaveText('step-parent');

    // Now build the connecting edge FOR REAL: drag secondParent's card and drop it in the
    // "above" zone belonging to root's card — D6's "add a missing parent" gesture. Both cards are
    // already members of the SAME cluster (root via `parent`, secondParent via `parent`'s other
    // union), which is what makes this drag possible at all — see the top-of-file note.
    await page.goto('/family');
    await expect(page.getByTestId('family-page')).toBeVisible();

    const secondParentNode = page.getByTestId('family-node').filter({ hasText: 'E2E Journey1 SecondParent' });
    await expect(secondParentNode).toBeVisible();

    const dropZone = page.locator(
      `[data-testid="family-drop-zone"][data-position="above"][data-target-id="${root.identityId}"]`,
    );
    const rootNode = page.locator(`[data-testid="family-node"][data-identity-id="${root.identityId}"]`);

    const dataTransfer = await page.evaluateHandle(() => new DataTransfer());
    await secondParentNode.dispatchEvent('dragstart', { dataTransfer });
    // Only the card under the pointer offers its gestures — every card showing all three at once
    // tiled the canvas with overlapping boxes. So the drag has to reach `root` before its zones
    // exist, exactly as a real one does.
    await rootNode.dispatchEvent('dragover', { dataTransfer });
    await expect(dropZone).toBeVisible();

    const joined = page.waitForResponse(
      (response) =>
        response.request().method() === 'PUT' && /\/family\/unions\/[^/]+\/participants$/.test(response.url()),
    );
    await dropZone.dispatchEvent('dragover', { dataTransfer });
    await dropZone.dispatchEvent('drop', { dataTransfer });
    await secondParentNode.dispatchEvent('dragend', { dataTransfer });
    const joinResponse = await joined;
    expect(joinResponse.ok()).toBe(true);

    // AFTER: same page, same person, no typed word changed — but the graph structure did, so the
    // label the server derives changes from "step-parent" to "parent".
    await page.goto(`/people/${root.personId}`);
    const secondParentRowAfter = relationRow('E2E Journey1 SecondParent');
    await expect(secondParentRowAfter).toBeVisible();
    await expect(secondParentRowAfter.locator('p').nth(1)).toHaveText('parent');

    // The grandparent chain is untouched by the drag — still derived, still never typed.
    await expect(relationRow('E2E Journey1 Grandparent').locator('p').nth(1)).toHaveText('grandparent');
  });

  test('redacts a person the second viewer cannot see', async ({ context, page }) => {
    const owner = await utils.userSetup(admin.accessToken, {
      email: 'family-j2-owner@test.com',
      name: 'Family Journey2 Owner',
      password: 'password',
    });
    const viewer = await utils.userSetup(admin.accessToken, {
      email: 'family-j2-viewer@test.com',
      name: 'Family Journey2 Viewer',
      password: 'password',
    });
    await setAccess(
      { userId: owner.userId, familyAccessUpdateDto: { level: FamilyAccessLevel.Contribute } },
      { headers: asBearerAuth(admin.accessToken) },
    );
    await setAccess(
      { userId: viewer.userId, familyAccessUpdateDto: { level: FamilyAccessLevel.View } },
      { headers: asBearerAuth(admin.accessToken) },
    );

    const db = await utils.connectDatabase();

    const space = await utils.createSpace(owner.accessToken, { name: 'E2E Family Redaction Space' });
    await utils.addSpaceMember(owner.accessToken, space.id, { userId: viewer.userId, role: SharedSpaceRole.Viewer });

    const sharedAsset = await utils.createAsset(owner.accessToken);
    await utils.addSpaceAssets(owner.accessToken, space.id, [sharedAsset.id]);

    // A face being technically reachable (via `face_identity_face` on an accessible asset) is not
    // enough on its own for the viewer to RESOLVE the identity — `queryAccessibleProfiles` also
    // needs a profile row to hang a display name off: either the viewer's own `person` (not the
    // case here — these are the OWNER's people), or a `shared_space_person` in a space the viewer
    // belongs to. `mintIdentity` alone only gives the owner's own accessible face; this adds the
    // space-person profile that actually makes it resolvable to a DIFFERENT viewer.
    const makeResolvableViaSpace = async (name: string) => {
      const identity = await mintIdentity(db, owner.accessToken, name, sharedAsset.id);
      const faceRow = await db.query<{ id: string }>(
        `SELECT "assetFaceId" AS id FROM face_identity_face WHERE "identityId" = $1 LIMIT 1`,
        [identity.identityId],
      );
      const faceId = faceRow.rows[0].id;
      const spacePersonResult = await db.query<{ id: string }>(
        `INSERT INTO "shared_space_person"
           ("spaceId", name, "isHidden", "faceCount", "assetCount", "representativeFaceId", "identityId", "type")
         VALUES ($1, $2, false, 1, 1, $3, $4, 'person')
         RETURNING id`,
        [space.id, name, faceId, identity.identityId],
      );
      await db.query(`INSERT INTO "shared_space_person_face" ("personId", "assetFaceId") VALUES ($1, $2)`, [
        spacePersonResult.rows[0].id,
        faceId,
      ]);
      return identity;
    };

    const partnerA = await makeResolvableViaSpace('E2E Redaction Visible A');
    const partnerB = await makeResolvableViaSpace('E2E Redaction Visible B');

    // The child's only face lives on a PRIVATE asset the viewer's space never sees.
    const hiddenPerson = await utils.createPerson(owner.accessToken, { name: 'E2E Redaction Hidden Child' });
    const privateAsset = await utils.createAsset(owner.accessToken);
    // sourceType: 'manual' — see the note on mintIdentity above.
    await utils.createFace({ assetId: privateAsset.id, personId: hiddenPerson.id, sourceType: 'manual' });
    const hiddenRow = await db.query<{ identityId: string }>(`SELECT "identityId" FROM "person" WHERE id = $1`, [
      hiddenPerson.id,
    ]);
    const hiddenIdentityId = hiddenRow.rows[0].identityId;

    await createUnion(
      {
        familyUnionCreateDto: {
          partnerIds: [partnerA.identityId, partnerB.identityId],
          childIds: [hiddenIdentityId],
        },
      },
      { headers: asBearerAuth(owner.accessToken) },
    );

    await utils.setAuthCookies(context, viewer.accessToken);

    // BEFORE: the viewer resolves exactly 2 of the union's 3 participants (D3's ">= 2 resolvable"
    // threshold), so the union is visible — but the child is redacted to an anonymous seat, and
    // neither their name nor their identity id ever reaches the client.
    await page.goto('/family');
    await expect(page.getByTestId('family-page')).toBeVisible();
    await expect(page.getByTestId('family-node').filter({ hasText: 'E2E Redaction Visible A' })).toBeVisible();
    await expect(page.getByTestId('family-node').filter({ hasText: 'E2E Redaction Visible B' })).toBeVisible();
    await expect(page.getByTestId('family-anonymous-seat')).toBeVisible();
    await expect(page.getByText('E2E Redaction Hidden Child')).toHaveCount(0);

    const beforeGraph = await getUnions({ page: 1, size: 200 }, { headers: asBearerAuth(viewer.accessToken) });
    const beforeSerialized = JSON.stringify(beforeGraph);
    // E30: not just the name — the raw identity id must never leak either, or a client could
    // correlate the same hidden person across unions/viewers, reconstructing what redaction
    // withholds.
    expect(beforeSerialized).not.toContain(hiddenIdentityId);
    expect(beforeSerialized).not.toContain('E2E Redaction Hidden Child');

    // WIDEN: the SAME fixture, the SAME union — the only thing that changes is what this one
    // viewer can now resolve, by sharing the child's identity into the same space.
    const secondSharedAsset = await utils.createAsset(owner.accessToken);
    await utils.addSpaceAssets(owner.accessToken, space.id, [secondSharedAsset.id]);
    // sourceType: 'manual' — see the note on mintIdentity above.
    const hiddenFaceId = await utils.createFace({
      assetId: secondSharedAsset.id,
      personId: hiddenPerson.id,
      sourceType: 'manual',
    });

    await db.query('BEGIN');
    try {
      const spacePersonResult = await db.query<{ id: string }>(
        `INSERT INTO "shared_space_person"
           ("spaceId", name, "isHidden", "faceCount", "assetCount", "representativeFaceId", "identityId", "type")
         VALUES ($1, $2, false, 1, 1, $3, $4, 'person')
         RETURNING id`,
        [space.id, 'E2E Redaction Hidden Child', hiddenFaceId, hiddenIdentityId],
      );
      await db.query(`INSERT INTO "shared_space_person_face" ("personId", "assetFaceId") VALUES ($1, $2)`, [
        spacePersonResult.rows[0].id,
        hiddenFaceId,
      ]);
      await db.query('COMMIT');
    } catch (error) {
      await db.query('ROLLBACK');
      throw error;
    }

    // AFTER: same union, same viewer — now widened to resolve the third participant, and the
    // real name appears where the anonymous seat used to be.
    await page.goto('/family');
    await expect(page.getByTestId('family-page')).toBeVisible();
    await expect(page.getByText('E2E Redaction Hidden Child')).toBeVisible();
    await expect(page.getByTestId('family-anonymous-seat')).toHaveCount(0);

    const afterGraph = await getUnions({ page: 1, size: 200 }, { headers: asBearerAuth(viewer.accessToken) });
    expect(JSON.stringify(afterGraph)).toContain(hiddenIdentityId);
  });

  test('shows no family surfaces at all to a user with no access', async ({ context, page }) => {
    const granted = await utils.userSetup(admin.accessToken, {
      email: 'family-j3-granted@test.com',
      name: 'Family Journey3 Granted',
      password: 'password',
    });
    const ungranted = await utils.userSetup(admin.accessToken, {
      email: 'family-j3-none@test.com',
      name: 'Family Journey3 None',
      password: 'password',
    });

    const db = await utils.connectDatabase();

    // Same-shaped fixture for both viewers: a person with a recognized face, so an absent surface
    // below is evidence of the access gate — not of missing data. `setMyRoot` only needs `view`,
    // so it is called for each viewer while they still have it, then access is set to its FINAL
    // level (view vs none) — deriving "that's you" from the person's own root is the cheapest way
    // to get a guaranteed non-null relation label without needing a second person at all.
    const buildFixtureAs = async (user: { userId: string; accessToken: string }, personName: string) => {
      await setAccess(
        { userId: user.userId, familyAccessUpdateDto: { level: FamilyAccessLevel.View } },
        { headers: asBearerAuth(admin.accessToken) },
      );
      const asset = await utils.createAsset(user.accessToken);
      const identity = await mintIdentity(db, user.accessToken, personName, asset.id);
      await setMyRoot(
        { familyMyRootUpdateDto: { identityId: identity.identityId } },
        { headers: asBearerAuth(user.accessToken) },
      );
      return { personId: identity.personId, assetId: asset.id };
    };

    const grantedFixture = await buildFixtureAs(granted, 'E2E Journey3 Granted Subject');
    const ungrantedFixture = await buildFixtureAs(ungranted, 'E2E Journey3 None Subject');

    // Positive control leaves `granted` at `view`; the negative control drops `ungranted` to
    // `none` — same fixture shape, only the access level differs.
    await setAccess(
      { userId: ungranted.userId, familyAccessUpdateDto: { level: FamilyAccessLevel.None } },
      { headers: asBearerAuth(admin.accessToken) },
    );

    // Positive control: a `view`-granted user gets every surface.
    await utils.setAuthCookies(context, granted.accessToken);
    await page.goto('/photos');
    await expect(page.getByRole('link', { name: 'Family', exact: true })).toBeVisible();

    await page.goto(`/people/${grantedFixture.personId}`);
    await expect(page.getByTestId('family-relations-panel')).toBeVisible();

    await page.goto(`/photos/${grantedFixture.assetId}`);
    await page.waitForSelector('#immich-asset-viewer');
    await page.keyboard.press('i');
    await expect(page.getByTestId('detail-panel-people')).toBeVisible();
    await expect(page.getByTestId('detail-panel-person-relation')).toBeVisible();
    await expect(page.getByTestId('detail-panel-person-relation')).toHaveText("that's you");

    // Negative control: A1/A12 — a `none` user gets NOTHING, not a disabled or empty version.
    await utils.setAuthCookies(context, ungranted.accessToken);
    await page.goto('/photos');
    await expect(page.getByRole('link', { name: 'Family', exact: true })).toHaveCount(0);

    await page.goto(`/people/${ungrantedFixture.personId}`);
    await expect(page.getByTestId('family-relations-panel')).toHaveCount(0);

    await page.goto(`/photos/${ungrantedFixture.assetId}`);
    await page.waitForSelector('#immich-asset-viewer');
    await page.keyboard.press('i');
    await expect(page.getByTestId('detail-panel-people')).toBeVisible();
    await expect(page.getByTestId('detail-panel-person-relation')).toHaveCount(0);
  });
});
