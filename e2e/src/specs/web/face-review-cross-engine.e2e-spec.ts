/**
 * Face review — cross-engine guarantees (Slice 14).
 *
 * The unification's headline claim is that the admin cleanup console and the per-person suggestion queue
 * share ONE verdict layer, so a decision recorded by either engine binds the other. Until this file, that
 * claim was only ever exercised at the medium layer: `face-cleanup.e2e-spec.ts` contains zero references to
 * `face-suggestions`, and the two suggestion specs contain zero references to `face-repair`.
 *
 * These tests cover the parts of the guarantee that live at the HTTP boundary — role enforcement and the
 * Locked-asset policy — which the medium tests, running below the guard layer, structurally cannot prove.
 *
 * Seeding note (same constraint the sibling suites document at length): this stack runs with
 * IMMICH_MACHINE_LEARNING_ENABLED=false, so no real scan can produce embeddings. Both engines' inputs are
 * seeded directly — `face_repair_scan` + `face_repair_scan_flagged_face` for the cleanup console, and
 * pending `face_person_verdict` rows for the suggestion queue — exactly as
 * `face-cleanup.e2e-spec.ts` and `space-person-face-suggestions.e2e-spec.ts` already do. The ML dependency
 * lives in *producing* candidates, not in the gates under test here.
 *
 * Every absence assertion below carries a positive control in the same test body (spec §2): a control face
 * that IS surfaced under otherwise-identical conditions. Without it, "the locked face is not offered" would
 * pass just as happily if the endpoint returned nothing at all.
 */
import {
  getFaceRepairPersonFaces,
  SharedSpaceRole,
  updateConfig,
  updateSpace,
  type LoginResponseDto,
} from '@immich/sdk';
import { expect, test } from '@playwright/test';
import { createUserDto } from 'src/fixtures';
import { asBearerAuth, utils } from 'src/utils';

const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

// getScanFlaggedFaces joins face_search (sourceType=MachineLearning AND visible AND HAS an embedding), so a
// flagged face with no embedding row is silently invisible to the console. Same fixed literal the sibling
// suite uses — no real ANN search runs against it.
const EMBEDDING = '[' + Array.from({ length: 512 }, () => 1).join(',') + ']';

test.describe.serial('Face review cross-engine', () => {
  let admin: LoginResponseDto;
  let owner: LoginResponseDto;
  let editor: LoginResponseDto;
  let viewer: LoginResponseDto;

  test.beforeAll(async () => {
    utils.initSdk();
    await utils.resetDatabase();
    admin = await utils.adminSetup();
    owner = await utils.userSetup(admin.accessToken, createUserDto.create('cross-engine-owner'));
    editor = await utils.userSetup(admin.accessToken, createUserDto.create('cross-engine-editor'));
    viewer = await utils.userSetup(admin.accessToken, createUserDto.create('cross-engine-viewer'));

    // Open the suggestion read-gate: the queue only surfaces candidates in the band between the recognition
    // maxDistance and the (wider) suggestions maxDistance.
    const config = await utils.getSystemConfig(admin.accessToken);
    config.machineLearning.facialRecognition.maxDistance = 0.5;
    config.machineLearning.facialRecognition.suggestions = { enabled: true, maxDistance: 0.8 };
    await updateConfig({ adminConfigDto: config }, { headers: asBearerAuth(admin.accessToken) });
  });

  test.afterAll(async () => {
    const config = await utils.getSystemConfig(admin.accessToken);
    config.machineLearning.facialRecognition.suggestions = { enabled: false, maxDistance: 0.7 };
    await updateConfig({ adminConfigDto: config }, { headers: asBearerAuth(admin.accessToken) });
  });

  /**
   * S14.4 — the four suggestion actions on a SPACE person are editor-gated.
   *
   * A viewer must be refused on every one of confirm / reject / ignore / dismiss, and — the control that
   * makes those refusals mean something — an editor must succeed on the same call against the same space,
   * the same person and an equivalent pending face. A blanket 403 (feature off, space misconfigured, person
   * unreachable) would satisfy the viewer half alone.
   *
   * Each action gets its OWN face: these endpoints are idempotent and drain the pending row they act on, so
   * reusing one face would make every action after the first a no-op and the editor's `acted` flag would
   * stop discriminating.
   */
  test('S14.4: a space viewer is refused every suggestion action; an editor is not', async ({ page }) => {
    const db = await utils.connectDatabase();

    const space = await utils.createSpace(owner.accessToken, { name: 'Cross Engine RBAC' });
    await updateSpace(
      { id: space.id, sharedSpaceUpdateDto: { faceRecognitionEnabled: true } },
      { headers: asBearerAuth(owner.accessToken) },
    );
    await utils.addSpaceMember(owner.accessToken, space.id, { userId: editor.userId, role: SharedSpaceRole.Editor });
    await utils.addSpaceMember(owner.accessToken, space.id, { userId: viewer.userId, role: SharedSpaceRole.Viewer });

    const representativeAsset = await utils.createAsset(owner.accessToken);
    const candidateAsset = await utils.createAsset(owner.accessToken);
    await utils.addSpaceAssets(owner.accessToken, space.id, [representativeAsset.id, candidateAsset.id]);
    await utils.waitForQueueFinish(admin.accessToken, 'thumbnailGeneration');

    const { spacePersonId } = await utils.createSpacePerson(
      space.id,
      'Cross Engine Space Person',
      owner.userId,
      representativeAsset.id,
    );

    const actions = ['confirm', 'reject', 'ignore', 'dismiss'] as const;

    // One pending face per action, each inside the suggestion band.
    const faceForAction = new Map<(typeof actions)[number], string>();
    for (const action of actions) {
      const { rows } = await db.query<{ id: string }>(`INSERT INTO asset_face ("assetId") VALUES ($1) RETURNING id`, [
        candidateAsset.id,
      ]);
      const faceId = rows[0].id;
      await db.query(`INSERT INTO face_person_verdict ("spacePersonId", "assetFaceId", distance) VALUES ($1, $2, $3)`, [
        spacePersonId,
        faceId,
        0.6,
      ]);
      faceForAction.set(action, faceId);
    }

    const url = (action: string, faceId: string) =>
      `/api/shared-spaces/${space.id}/people/${spacePersonId}/face-suggestions/${faceId}/${action}`;

    for (const action of actions) {
      const faceId = faceForAction.get(action)!;

      const refused = await page.request.post(url(action, faceId), { headers: bearer(viewer.accessToken) });
      expect(refused.status(), `viewer must be refused on ${action}`).toBe(403);

      // Positive control, same space / person / action, differing only in role.
      const allowed = await page.request.post(url(action, faceId), { headers: bearer(editor.accessToken) });
      expect(allowed.status(), `editor must be allowed on ${action}`).toBe(200);
      // S11b: the outcome is in the body, not the status code. The editor's call is the first to touch this
      // face, so it genuinely acted — proving the viewer's 403 stopped real work rather than a no-op.
      expect(await allowed.json(), `editor's ${action} must report it acted`).toEqual({ acted: true });
    }
  });

  /**
   * S14.5 — a face on a Locked asset is invisible to BOTH engines, and its admin crop is refused.
   *
   * The Locked folder is designed to require the owner's elevated re-authentication; neither the cleanup
   * console nor the suggestion queue re-authenticates, so neither may surface a crop from one (spec §4).
   * Each half pairs the locked face with a control face on an ordinary asset, seeded identically.
   */
  test('S14.5: a Locked-asset face reaches neither engine and its admin thumbnail is refused', async ({ page }) => {
    const db = await utils.connectDatabase();

    const cluster = await utils.createPerson(admin.accessToken, { name: 'Cross Engine Locked Cluster' });
    const suspected = await utils.createPerson(admin.accessToken, { name: 'Cross Engine Suspected Owner' });
    const queueTarget = await utils.createPerson(admin.accessToken, { name: 'Cross Engine Queue Target' });

    const openAsset = await utils.createAsset(admin.accessToken);
    const lockedAsset = await utils.createAsset(admin.accessToken);
    await utils.waitForQueueFinish(admin.accessToken, 'thumbnailGeneration');
    await db.query(`UPDATE asset SET visibility = 'locked' WHERE id = $1`, [lockedAsset.id]);

    // ---- cleanup console half ----
    const controlFlagged = await utils.createFace({ assetId: openAsset.id, personGroupId: cluster.id });
    const lockedFlagged = await utils.createFace({ assetId: lockedAsset.id, personGroupId: cluster.id });

    const { rows: scanRows } = await db.query<{ id: string }>(
      `INSERT INTO "face_repair_scan" ("status", "requestedBy", "totals", "persons", "startedAt", "finishedAt")
       VALUES ('completed', $1, $2::jsonb, $3::jsonb, now(), now())
       RETURNING id`,
      [
        admin.userId,
        JSON.stringify({ eligibleFaces: 2, flaggedFaces: 2, reviewOnlyFaces: 2, affectedPersons: 1 }),
        JSON.stringify([
          {
            personId: cluster.id,
            ownerId: admin.userId,
            personName: null,
            faceCount: 2,
            thumbnailFaceId: null,
            eligible: 2,
            flagged: 2,
            flaggedFraction: 1,
            suspectedOwners: [{ ownerPersonId: suspected.id, ownerName: null, thumbnailFaceId: null, count: 2 }],
            recommendation: 'review-first',
            reviewReasons: [],
          },
        ]),
      ],
    );
    const scanId = scanRows[0].id;

    for (const faceId of [controlFlagged, lockedFlagged]) {
      await db.query(
        `INSERT INTO "face_search" ("faceId", "embedding") VALUES ($1, $2::vector)
         ON CONFLICT ("faceId") DO NOTHING`,
        [faceId, EMBEDDING],
      );
      // A face a real scan would cluster is an ML attribution, not a human placement; left as 'manual'
      // (utils.createFace's shortcut) the verdict layer reads it as already settled and the assertions below
      // go vacuous. Same downgrade the sibling suite performs — see face-cleanup.e2e-spec.ts.
      await db.query(`UPDATE "face_identity_face" SET "source" = 'ml' WHERE "assetFaceId" = $1`, [faceId]);
      await db.query(
        `INSERT INTO "face_repair_scan_flagged_face" ("scanId", "assetFaceId", "personGroupId", "suspectedOwnerId")
         VALUES ($1, $2, $3, $4)`,
        [scanId, faceId, cluster.id, suspected.id],
      );
    }

    // `admin/face-repair/person/:id` is the MANUAL review page's metadata route and carries no flaggedFaces
    // at all — reading it here silently yielded an empty list. The flagged-faces reader is
    // `scan/person/:id`, which this SDK call wraps, same as face-cleanup.e2e-spec.ts uses.
    const consoleBody = await getFaceRepairPersonFaces(
      { personId: cluster.id },
      { headers: bearer(admin.accessToken) },
    );
    const consoleFaceIds: string[] = consoleBody.flaggedFaces.map((f) => f.assetFaceId);
    // Control first: the identically-seeded face on an ordinary asset IS surfaced, so the absence below is
    // about the Locked policy and not about the console being empty.
    expect(consoleFaceIds).toContain(controlFlagged);
    expect(consoleFaceIds).not.toContain(lockedFlagged);

    // ---- suggestion queue half ----
    const { rows: controlRows } = await db.query<{ id: string }>(
      `INSERT INTO asset_face ("assetId") VALUES ($1) RETURNING id`,
      [openAsset.id],
    );
    const { rows: lockedRows } = await db.query<{ id: string }>(
      `INSERT INTO asset_face ("assetId") VALUES ($1) RETURNING id`,
      [lockedAsset.id],
    );
    const controlCandidate = controlRows[0].id;
    const lockedCandidate = lockedRows[0].id;

    for (const faceId of [controlCandidate, lockedCandidate]) {
      await db.query(`INSERT INTO face_person_verdict ("personGroupId", "assetFaceId", distance) VALUES ($1, $2, $3)`, [
        queueTarget.id,
        faceId,
        0.6,
      ]);
    }

    const queueResponse = await page.request.get(`/api/people/${queueTarget.id}/face-suggestions`, {
      headers: bearer(admin.accessToken),
    });
    expect(queueResponse.status()).toBe(200);
    const queueBody = await queueResponse.json();
    const queuedFaceIds: string[] = (queueBody.items ?? []).map((i: { assetFaceId: string }) => i.assetFaceId);
    expect(queuedFaceIds).toContain(controlCandidate);
    expect(queuedFaceIds).not.toContain(lockedCandidate);

    // ---- admin thumbnail half ----
    // The admin crop route is face-keyed and join-free (Slice 7 D7), so nothing about the person scoping
    // would refuse it — only the Locked policy does. The control proves the route serves an equivalent face.
    const controlThumb = await page.request.get(`/api/admin/face-repair/faces/${controlFlagged}/thumbnail`, {
      headers: bearer(admin.accessToken),
    });
    expect(controlThumb.status()).toBe(200);

    const lockedThumb = await page.request.get(`/api/admin/face-repair/faces/${lockedFlagged}/thumbnail`, {
      headers: bearer(admin.accessToken),
    });
    expect(lockedThumb.ok(), 'a Locked-asset face crop must not be served to the admin console').toBe(false);
  });
});
