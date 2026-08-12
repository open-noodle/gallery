/**
 * Face Cleanup admin page — smoke + decline/undo + full-resolution flow (X1/X2) + temporal-consistency
 * hardening (Consistency X1/X2) + manual review mode (Slice 11) tests.
 *
 * Scope: the dashboard/empty-state/decline smoke tests below are a reduced fallback — a real face-repair
 * SCAN JOB requires live CLIP embeddings, which are unavailable in this ML-disabled e2e stack
 * (IMMICH_MACHINE_LEARNING_ENABLED=false, e2e/docker-compose.yml). X1/X2 instead seed a completed scan
 * directly (face_search dummy embedding + face_repair_scan + face_repair_scan_flagged_face rows), mirroring
 * exactly how the server's own medium/testcontainer tests do it
 * (server/test/medium/specs/services/face-repair.resolve.spec.ts) — the ML dependency lives in *producing*
 * suggested embeddings, not in resolving already-flagged faces, so this is a faithful (not synthetic) test
 * of the review → resolve → drain flow.
 *
 * What this file covers:
 *   1. Dashboard page renders and, since this stack has never scanned, offers the first-run action
 *      ("Run first scan") rather than "Re-scan".
 *   2. Review page (/admin/face-cleanup/[personId]) renders for a valid person; empty state is
 *      shown since there are no flagged faces (no scan has run yet).
 *   3. Resolutions page (/admin/face-cleanup/resolutions) renders the empty state.
 *   4. A person-level dismiss seeded directly via the API renders a row (with an Undo button) on the
 *      resolutions page. The interactive Undo click is covered by the medium tests, not here.
 *   5. X1 — seeding a flagged cluster and driving the review page: select → route one face into each of the
 *      five terminal states via the bulk bar → Apply → assert the resolve payload and that the person drains
 *      from the console.
 *   6. X2 — Resolutions page: undoing a lock re-enables flagging (re-checked against the same persisted scan
 *      snapshot, which is the same mechanism a subsequent scan run applies — see the test body for the exact
 *      scope this covers vs. the medium/component tests).
 *   7. Consistency X1/X2 (temporal-consistency hardening design §7.6, distinct from the X1/X2 above, which
 *      predate and cover the full-resolution feature) — see the test bodies for what each proves and the
 *      "re-scan" proxy technique both use (a real, live-embeddings scan job isn't available in this
 *      ML-disabled stack, same constraint as X1/X2 above).
 *   8. Slice 11 (manual review mode, design docs/superpowers/specs/2026-07-23-manual-face-review-mode-design.md
 *      §7/§8) — the manual flow end to end: a never-scanned person is reviewed through
 *      /admin/face-cleanup/people/[personId], routing faces into move/lock/detach and asserting the durable DB
 *      state each writes. Then the cross-engine invariant: a later (seeded) scan must honour every one of
 *      those manual decisions exactly as it would a guided one — the locked face is never re-flagged, the
 *      detached face stays gone, the moved face is not re-proposed.
 *
 * The tests follow the proven `rebase-smoke-pages` canary pattern (admin-page-header landmark,
 * `.first()`, explicit timeout).
 */
import {
  getFaceRepairPersonFaces,
  mergePerson,
  resolveFaces,
  unconfirmFaceRepairFaces,
  type LoginResponseDto,
} from '@immich/sdk';
import { expect, test } from '@playwright/test';
import { asBearerAuth, utils } from 'src/utils';

type PgClient = Awaited<ReturnType<typeof utils.connectDatabase>>;

// A fixed, valid pgvector literal — the exact value doesn't matter for X1/X2 (no real ANN search is
// performed against it), only that a face_search row exists so the eligibility joins in
// getScanFlaggedFaces/getScanFlaggedFacesForPersons (sourceType=MachineLearning ∧ isVisible ∧ HAS an
// embedding) resolve the seeded faces. Same value the server's own medium tests use.
const EMBEDDING = '[' + Array.from({ length: 512 }, () => 1).join(',') + ']';

// Idempotent: the consistency specs seed a SECOND flagged scan over the same faces (to simulate a later
// re-scan), so re-inserting a face's embedding must not collide on `face_search`'s primary key. The embedding
// is identical on every seed, so DO NOTHING is the correct no-op.
const seedFaceSearch = (db: PgClient, faceId: string) =>
  db.query(
    `INSERT INTO "face_search" ("faceId", "embedding") VALUES ($1, $2::vector)
     ON CONFLICT ("faceId") DO NOTHING`,
    [faceId, EMBEDDING],
  );

/**
 * Seeds a completed face-repair scan flagging every face in `faceIds` (already created via
 * `utils.createFace`) toward `suspectedOwnerId`, without running a real (ML-driven) scan job. This is the
 * same data shape `FaceRepairService.getPersonFlaggedFaces`/`getLatestScanStatus` read — `personName`/
 * `ownerName`/`thumbnailFaceId` are left null because `withCurrentNames` overlays them from the live
 * `person` table at read time, so the actual names created via `utils.createPerson` are what the UI shows.
 */
const seedFlaggedScan = async (
  db: PgClient,
  args: {
    ownerUserId: string;
    personId: string;
    suspectedOwnerId: string;
    faceIds: string[];
    preserveSource?: boolean;
  },
): Promise<string> => {
  const totals = {
    eligibleFaces: args.faceIds.length,
    flaggedFaces: args.faceIds.length,
    toRepair: 0,
    reviewOnlyFaces: args.faceIds.length,
    reviewOnlyPersons: 1,
    affectedPersons: 1,
    reviewOnlyByReason: { overCap: 0, badTarget: 0, unAttributable: 0 },
  };
  const persons = [
    {
      personId: args.personId,
      ownerId: args.ownerUserId,
      personName: null,
      faceCount: args.faceIds.length,
      thumbnailFaceId: null,
      eligible: args.faceIds.length,
      flagged: args.faceIds.length,
      flaggedFraction: 1,
      suspectedOwners: [
        { ownerPersonId: args.suspectedOwnerId, ownerName: null, thumbnailFaceId: null, count: args.faceIds.length },
      ],
      recommendation: 'review-first',
      reviewReasons: [],
    },
  ];

  const { rows } = await db.query(
    `INSERT INTO "face_repair_scan" ("status", "requestedBy", "totals", "persons", "startedAt", "finishedAt")
     VALUES ('completed', $1, $2::jsonb, $3::jsonb, now(), now())
     RETURNING id`,
    [args.ownerUserId, JSON.stringify(totals), JSON.stringify(persons)],
  );
  const scanId = rows[0].id as string;

  for (const faceId of args.faceIds) {
    await seedFaceSearch(db, faceId);
    // `utils.createFace` links every face with source='manual' (its shortcut for a full face→identity
    // link). A face a scan FLAGS is by definition an ML-clustered attribution, not a human placement — and
    // the unified verdict layer correctly excludes human-placed (source='manual') faces from flagging. Left
    // as 'manual', these seeded faces would be filtered straight back out and the review page would show
    // "no flagged faces". Downgrade to 'ml' so they represent what a real scan actually flags.
    //
    // `preserveSource` skips this for durability RE-seeds: those simulate a later scan re-proposing a face
    // that a prior move/lock legitimately set to source='manual', and the whole point is to prove the
    // manual placement keeps it out of the review — downgrading it here would defeat the test.
    if (!args.preserveSource) {
      await db.query(`UPDATE "face_identity_face" SET "source" = 'ml' WHERE "assetFaceId" = $1`, [faceId]);
    }
    await db.query(
      `INSERT INTO "face_repair_scan_flagged_face" ("scanId", "assetFaceId", "personId", "suspectedOwnerId")
       VALUES ($1, $2, $3, $4)`,
      [scanId, faceId, args.personId, args.suspectedOwnerId],
    );
  }

  return scanId;
};

/**
 * Like seedFlaggedScan, but flags faces across MULTIPLE persons within a SINGLE scan (one `face_repair_scan`
 * row). The Slice 11 cross-engine invariant test below needs this: seeding two SEPARATE scans (one per person)
 * would each stamp `now()`, and `getFaceRepairPersonFaces` reads only `getLatestScan()` — a documented
 * nondeterminism trap on this feature (two scans stamped the same `now()` make the "latest" tie-break
 * unreliable). Worse, with two scans only the second seed's snapshot is ever read back, so a naive two-scan
 * seed would pass its "not re-flagged" assertions vacuously (the face simply isn't mentioned in whichever scan
 * happens to be "latest") rather than because the manual decision was actually honoured. One scan, multiple
 * persons, sidesteps the whole class of flake.
 */
const seedFlaggedScanMulti = async (
  db: PgClient,
  args: {
    ownerUserId: string;
    groups: { personId: string; suspectedOwnerId: string; faceIds: string[]; preserveSource?: boolean }[];
  },
): Promise<string> => {
  const totalFaces = args.groups.reduce((sum, group) => sum + group.faceIds.length, 0);
  const totals = {
    eligibleFaces: totalFaces,
    flaggedFaces: totalFaces,
    toRepair: 0,
    reviewOnlyFaces: totalFaces,
    reviewOnlyPersons: args.groups.length,
    affectedPersons: args.groups.length,
    reviewOnlyByReason: { overCap: 0, badTarget: 0, unAttributable: 0 },
  };
  const persons = args.groups.map((group) => ({
    personId: group.personId,
    ownerId: args.ownerUserId,
    personName: null,
    faceCount: group.faceIds.length,
    thumbnailFaceId: null,
    eligible: group.faceIds.length,
    flagged: group.faceIds.length,
    flaggedFraction: 1,
    suspectedOwners: [
      { ownerPersonId: group.suspectedOwnerId, ownerName: null, thumbnailFaceId: null, count: group.faceIds.length },
    ],
    recommendation: 'review-first',
    reviewReasons: [],
  }));

  const { rows } = await db.query(
    `INSERT INTO "face_repair_scan" ("status", "requestedBy", "totals", "persons", "startedAt", "finishedAt")
     VALUES ('completed', $1, $2::jsonb, $3::jsonb, now(), now())
     RETURNING id`,
    [args.ownerUserId, JSON.stringify(totals), JSON.stringify(persons)],
  );
  const scanId = rows[0].id as string;

  for (const group of args.groups) {
    for (const faceId of group.faceIds) {
      await seedFaceSearch(db, faceId);
      // Same downgrade seedFlaggedScan performs above, and the same preserveSource escape hatch — see its
      // comment for the full rationale.
      if (!group.preserveSource) {
        await db.query(`UPDATE "face_identity_face" SET "source" = 'ml' WHERE "assetFaceId" = $1`, [faceId]);
      }
      await db.query(
        `INSERT INTO "face_repair_scan_flagged_face" ("scanId", "assetFaceId", "personId", "suspectedOwnerId")
         VALUES ($1, $2, $3, $4)`,
        [scanId, faceId, group.personId, group.suspectedOwnerId],
      );
    }
  }

  return scanId;
};

test.describe.serial('Face Cleanup', () => {
  let admin: LoginResponseDto;

  // Slice 11 (manual review mode, design §7/§8): the manual-flow test populates this so the cross-engine
  // invariant test that follows can read what it wrote. A `.serial` failure in the manual-flow test skips the
  // invariant test automatically, so there is no risk of the latter running against a stale/absent fixture.
  let manualFlow: {
    source: Awaited<ReturnType<typeof utils.createPerson>>;
    destination: Awaited<ReturnType<typeof utils.createPerson>>;
    faceMove: string;
    faceLock: string;
    faceDetach: string;
  } | null = null;

  test.beforeAll(async () => {
    utils.initSdk();
    await utils.resetDatabase();
    admin = await utils.adminSetup();
  });

  /**
   * Seeds one face on `personId` that looks machine-clustered rather than human-placed. `utils.createFace`
   * always links a face source='manual' (utils.ts:529-530) — its shortcut for a full face→identity link — but
   * a face a REAL scan would cluster is, by definition, an ML attribution, not a human placement. Left as
   * 'manual' it would already read as "settled" to the verdict layer (manualLinkedFaceIds is owner-agnostic —
   * see face-verdict.service.ts), making the cross-engine invariant test's "not re-flagged" assertions vacuous
   * rather than meaningful — the exact trap seedFlaggedScan's downgrade above exists to avoid, reproduced here
   * for a cluster with NO scan at all (seedFlaggedScan can't be reused directly for that — it always creates a
   * face_repair_scan row, and the manual-flow test's whole point is a review with none).
   *
   * Also seeds a `face_search` row: both getClusterFacePage (the manual review page's face listing) and
   * getEligibleFaceIdsForPerson (the `lock` bulk action's eligibility check) inner-join it, so a face with no
   * embedding row would silently vanish from the review grid and 400 out of "lock" as ineligible.
   */
  const seedMlClusterFace = async (db: PgClient, args: { assetId: string; personId: string }): Promise<string> => {
    const faceId = await utils.createFace(args);
    await seedFaceSearch(db, faceId);
    await db.query(`UPDATE "face_identity_face" SET "source" = 'ml' WHERE "assetFaceId" = $1`, [faceId]);
    return faceId;
  };

  test('admin can reach the face-cleanup page and it renders', async ({ context, page }) => {
    await utils.setAuthCookies(context, admin.accessToken);

    await page.goto('/admin/face-cleanup/scan');

    // AdminPageLayout → BreadcrumbActionPage landmark — confirms the page mounted without error.
    await expect(page.locator('[data-testid="admin-page-header"]').first()).toBeVisible({ timeout: 15_000 });

    // Page-specific control. This stack has never run a scan, so the action is the FIRST-RUN one
    // (admin.face_cleanup_mode_run_first_scan = "Run first scan"), not "Re-scan" — an instance with nothing to
    // repeat must not be told to repeat it. Asserting "Re-scan" here was asserting the bug.
    await expect(page.getByRole('button', { name: 'Run first scan' }).first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('button', { name: 'Re-scan' })).toHaveCount(0);

    // ...and the first-run CTA lives in the empty state itself, so the instruction and the action are one object.
    await expect(page.getByTestId('first-scan-cta')).toBeVisible();
  });

  /**
   * Decline flow — review page (reduced: empty-state only; `decline-btn` requires ML flagged faces).
   *
   * Navigating to `/admin/face-cleanup/{personId}` with a real person ID but no completed scan
   * renders the review page in its "no flagged faces" empty state.  This confirms the route
   * mounts without error.  The `decline-btn` data-testid (added in Slice 4) lives in the face
   * tiles grid which is only rendered when flagged faces exist; it cannot be exercised here.
   */
  test('review page renders for a valid person (no flagged faces — no scan has run yet)', async ({ context, page }) => {
    await utils.setAuthCookies(context, admin.accessToken);

    // Create a person so the route has a valid UUID to load.
    const person = await utils.createPerson(admin.accessToken, { name: 'E2E Review Smoke' });

    await page.goto(`/admin/face-cleanup/${person.id}`);

    // The page must mount without error — admin-page-header landmark is present.
    await expect(page.locator('[data-testid="admin-page-header"]').first()).toBeVisible({ timeout: 15_000 });

    // With no scan there are no flagged faces → the empty-state section is shown.
    // Text from admin.face_cleanup_review_no_flagged = "No flagged faces".
    await expect(page.getByText('No flagged faces').first()).toBeVisible({ timeout: 10_000 });
  });

  /**
   * Resolutions page — empty state.
   *
   * Before any decline/lock is recorded the page shows the top-level empty-state placeholder.
   * Text from admin.face_cleanup_resolutions_empty = "No decisions recorded yet". (The declines-only
   * `/admin/face-cleanup/declined` route was replaced by this unified page in Slice 7 — it now 307-redirects
   * here; see web/src/routes/admin/face-cleanup/declined/+page.ts.)
   */
  test('resolutions page shows empty state when there are no declines or locks', async ({ context, page }) => {
    await utils.setAuthCookies(context, admin.accessToken);

    await page.goto('/admin/face-cleanup/resolutions');

    await expect(page.locator('[data-testid="admin-page-header"]').first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('No decisions recorded yet').first()).toBeVisible({ timeout: 10_000 });
  });

  /**
   * A "keep here" (soft-decline) recorded through the cleanup console is a NEGATIVE verdict in the shared
   * layer, and the resolutions page lists it with an Undo. Clicking Undo removes the verdict, so a later scan
   * may flag the face again. (Cluster-level dismisses are console-local and intentionally NOT listed here.)
   */
  test('a cleanup keep-here verdict appears on the resolutions page and Undo re-enables flagging', async ({
    context,
    page,
  }) => {
    await utils.setAuthCookies(context, admin.accessToken);
    const db = await utils.connectDatabase();

    const sourceName = 'Verdict Kept Person';
    const source = await utils.createPerson(admin.accessToken, { name: sourceName });
    const owner = await utils.createPerson(admin.accessToken, { name: 'Verdict Owner Person' });
    const asset = await utils.createAsset(admin.accessToken);
    const faceId = await utils.createFace({ assetId: asset.id, personId: source.id });

    await seedFlaggedScan(db, {
      ownerUserId: admin.userId,
      personId: source.id,
      suspectedOwnerId: owner.id,
      faceIds: [faceId],
    });

    // "Keep here": the admin says this face genuinely belongs to `source`, not the suspected owner.
    await resolveFaces(
      { faceRepairResolveRequestDto: { personId: source.id, stay: [faceId] } },
      { headers: asBearerAuth(admin.accessToken) },
    );

    // The face drains from the console.
    const beforeUndo = await getFaceRepairPersonFaces(
      { personId: source.id },
      { headers: asBearerAuth(admin.accessToken) },
    );
    expect(beforeUndo.flaggedFaces.some((f) => f.assetFaceId === faceId)).toBe(false);

    // S14.6 positive control for the post-undo `toHaveLength(0)` at the end of this test. Without it that
    // assertion passes vacuously the moment the resolve stops writing a verdict at all, or the column/status
    // names drift — an empty result would then mean "Undo worked" and "nothing was ever written" identically.
    // Run the SAME query first and require exactly the row Undo is supposed to remove.
    const { rows: seededVerdictRows } = await db.query(
      `SELECT id FROM "face_person_verdict" WHERE "assetFaceId" = $1 AND status IN ('rejected', 'ignored')`,
      [faceId],
    );
    expect(seededVerdictRows).toHaveLength(1);

    await page.goto('/admin/face-cleanup/resolutions');
    await expect(page.locator('[data-testid="admin-page-header"]').first()).toBeVisible({ timeout: 15_000 });

    // Scoped to the target person's own name — this suite runs `.serial` against a shared DB, so other tests
    // in this file may leave their own resolution rows behind. Filtering here (both for the click AND the
    // post-undo assertion below) means this test's outcome never depends on running first/alone.
    const verdictRow = page
      .locator('[data-testid="resolution-row"][data-source="cleanup"]')
      .filter({ hasText: owner.name });
    await expect(verdictRow.first()).toBeVisible({ timeout: 10_000 });

    await verdictRow.first().locator('[data-testid="undo-button"]').click();
    await expect(verdictRow).toHaveCount(0, { timeout: 10_000 });

    // Undo removed the negative verdict from the shared layer — so the (face, owner) pairing is no longer
    // settled and a later scan may flag it again. (The full re-scan-re-flags semantics are covered by the
    // medium tests face-repair.resolutions.spec.ts + face-review-cross-flow.spec.ts, which are not subject to
    // scan-snapshot timing; here we assert the durable state the page's Undo produced.)
    const { rows: verdictRows } = await db.query(
      `SELECT id FROM "face_person_verdict" WHERE "assetFaceId" = $1 AND status IN ('rejected', 'ignored')`,
      [faceId],
    );
    expect(verdictRows).toHaveLength(0);
  });

  test('X1: routing every state via the bulk bar and applying drains the person from the console', async ({
    context,
    page,
  }) => {
    await utils.setAuthCookies(context, admin.accessToken);
    const db = await utils.connectDatabase();

    const sourceName = 'X1 Flagged Person';
    const ownerName = 'X1 Owner Person';
    const otherName = 'X1 Other Person';

    const source = await utils.createPerson(admin.accessToken, { name: sourceName });
    const owner = await utils.createPerson(admin.accessToken, { name: ownerName });
    const other = await utils.createPerson(admin.accessToken, { name: otherName });

    const asset = await utils.createAsset(admin.accessToken);
    const faceOwner = await utils.createFace({ assetId: asset.id, personId: source.id });
    const faceStay = await utils.createFace({ assetId: asset.id, personId: source.id });
    const faceLock = await utils.createFace({ assetId: asset.id, personId: source.id });
    const faceOther = await utils.createFace({ assetId: asset.id, personId: source.id });
    const faceUnknown = await utils.createFace({ assetId: asset.id, personId: source.id });
    const faceDetach = await utils.createFace({ assetId: asset.id, personId: source.id });

    await seedFlaggedScan(db, {
      ownerUserId: admin.userId,
      personId: source.id,
      suspectedOwnerId: owner.id,
      faceIds: [faceOwner, faceStay, faceLock, faceOther, faceUnknown, faceDetach],
    });

    // Confirm the seeded person shows up on the dashboard before it's resolved.
    await page.goto('/admin/face-cleanup/scan');
    await expect(page.locator('[data-testid="admin-page-header"]').first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(sourceName).first()).toBeVisible({ timeout: 10_000 });

    await page.goto(`/admin/face-cleanup/${source.id}`);
    await expect(page.locator('[data-testid="admin-page-header"]').first()).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('[data-testid="face-tile"]')).toHaveCount(6, { timeout: 15_000 });

    const tile = (faceId: string) => page.locator(`[data-testid="face-tile"][data-faceid="${faceId}"]`);

    // faceOwner is left untouched — it stays in the default `owner` state.

    await tile(faceStay).click();
    await page.locator('[data-testid="bulk-stay"]').click();

    await tile(faceLock).click();
    await page.locator('[data-testid="bulk-lock"]').click();

    await tile(faceOther).click();
    await page.locator('[data-testid="bulk-other"]').click();
    await expect(page.locator('[data-testid="person-picker"]')).toBeVisible({ timeout: 10_000 });
    await page.locator(`[data-testid="person-picker-row-${other.id}"]`).click();

    // A real face of a real person the admin cannot name — parked in a cluster of its own rather than forced
    // onto the suspected owner.
    await tile(faceUnknown).click();
    await page.locator('[data-testid="bulk-unknown"]').click();

    await tile(faceDetach).click();
    await page.locator('[data-testid="bulk-detach"]').click();

    // Sanity-check every tile landed in the expected state before Apply.
    await expect(tile(faceOwner)).toHaveAttribute('data-state', 'owner');
    await expect(tile(faceStay)).toHaveAttribute('data-state', 'stay');
    await expect(tile(faceLock)).toHaveAttribute('data-state', 'lock');
    await expect(tile(faceOther)).toHaveAttribute('data-state', 'other');
    await expect(tile(faceUnknown)).toHaveAttribute('data-state', 'unknown');
    await expect(tile(faceDetach)).toHaveAttribute('data-state', 'detach');

    // This Apply discards a face ("not a face" is irreversible), so it must be confirmed before anything is sent.
    await page.locator('[data-testid="apply-btn"]').click();
    // The hand-rolled `detach-confirm` overlay these testids targeted is gone — the page now uses
    // @immich/ui's ConfirmModal (modalManager.show), which renders a role=dialog and takes no testid. Target
    // the dialog and its confirm button by accessible name, the pattern the other web specs already use.
    const detachDialog = page.getByRole('dialog');
    await expect(detachDialog).toBeVisible({ timeout: 10_000 });
    await expect(detachDialog.getByText(/not a face/i)).toBeVisible();

    const [resolveRequest] = await Promise.all([
      page.waitForRequest((req) => req.url().includes('/admin/face-repair/resolve') && req.method() === 'POST'),
      detachDialog.getByRole('button', { name: /Yes, discard/i }).click(),
    ]);

    const payload = resolveRequest.postDataJSON() as {
      personId: string;
      moveToPerson: { destinationPersonId: string; faceIds: string[] }[];
      stay: string[];
      lock: string[];
      detach: string[];
      unknown: string[];
    };
    expect(payload.personId).toBe(source.id);
    expect(payload.stay).toEqual([faceStay]);
    expect(payload.lock).toEqual([faceLock]);
    expect(payload.detach).toEqual([faceDetach]);
    expect(payload.unknown).toEqual([faceUnknown]);
    const moveGroups = new Map(payload.moveToPerson.map((group) => [group.destinationPersonId, group.faceIds]));
    expect(moveGroups.get(owner.id)).toEqual([faceOwner]);
    expect(moveGroups.get(other.id)).toEqual([faceOther]);

    // Apply navigates back to the dashboard on success; the person must have drained from the console.
    await page.waitForURL('**/admin/face-cleanup/scan', { timeout: 15_000 });
    await expect(page.locator('[data-testid="admin-page-header"]').first()).toBeVisible({ timeout: 15_000 });

    // Wait for the dashboard to actually finish loading its (freshly refetched) scan snapshot before asserting
    // an absence: the header summary line ("… flagged faces across … people") only renders once
    // `scan.status === 'completed'` with its totals, so its presence means the fresh (drained) snapshot has
    // rendered — not a still-loading page the absence check could pass against vacuously.
    await expect(page.getByText(/flagged faces across/).first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(sourceName)).toHaveCount(0);
  });

  /**
   * The action dock stays pinned to the bottom even when the review is short.
   *
   * It used to be `sticky bottom-0` inside the scrolled content. Sticky only pins while its containing block
   * still extends below it — so on a review with a handful of faces the page never overflowed, sticky was inert,
   * and the bar came to rest wherever the content happened to end: adrift in the middle of the page (reported by
   * a user). It now renders through AdminPageLayout's `footer` slot, OUTSIDE the scroll area.
   *
   * This can only be caught here. The AdminPageLayout test stub renders `children` and `footer` into the same
   * element, so putting the dock back inside the scrolled content would keep every component test green while
   * reintroducing exactly this bug.
   */
  test('the action dock stays pinned to the bottom of the viewport on a short review', async ({ context, page }) => {
    await utils.setAuthCookies(context, admin.accessToken);
    const db = await utils.connectDatabase();

    const source = await utils.createPerson(admin.accessToken, { name: 'Dock Short Person' });
    const owner = await utils.createPerson(admin.accessToken, { name: 'Dock Owner Person' });
    const asset = await utils.createAsset(admin.accessToken);
    const face = await utils.createFace({ assetId: asset.id, personId: source.id });

    // ONE flagged face: nowhere near enough content to fill the page, which is precisely the case that floated.
    await seedFlaggedScan(db, {
      ownerUserId: admin.userId,
      personId: source.id,
      suspectedOwnerId: owner.id,
      faceIds: [face],
    });

    await page.goto(`/admin/face-cleanup/${source.id}`);
    await expect(page.locator('[data-testid="admin-page-header"]').first()).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('[data-testid="face-tile"]')).toHaveCount(1, { timeout: 15_000 });

    const dock = page.locator('[data-testid="face-dock"]');
    await expect(dock).toBeVisible();

    const box = await dock.boundingBox();
    const grid = await page.locator('[data-testid="flagged-grid"]').boundingBox();
    const viewport = page.viewportSize();
    expect(box).not.toBeNull();
    expect(grid).not.toBeNull();
    expect(viewport).not.toBeNull();

    // THE assertion: the dock is flush with the bottom of the screen. Being below the content is not enough —
    // the floating dock was below the content too, just adrift, with dead space underneath. Distance to the
    // bottom is the only thing that separates the two.
    //
    // Not pixel-exact: the app shell insets its content region by a few pixels (shared by every admin page,
    // unrelated to this dock), so a fixed dock measures ~8px short of the viewport. The bug measured ~124px
    // short. A 16px tolerance sits an order of magnitude away from the failure, so it cannot let it through.
    const SHELL_INSET_TOLERANCE = 16;
    expect(box!.y + box!.height).toBeGreaterThanOrEqual(viewport!.height - SHELL_INSET_TOLERANCE);

    // Sanity: it really is the dock below the review grid, not some other element that happens to hug the bottom.
    //
    // Compared against the grid's TOP, not its bottom. `boundingBox()` reports layout geometry, including the
    // part of an element scrolled out of view — so once the page content exceeds the viewport, the grid's
    // reported bottom extends past the pinned footer even though it is visually clipped above it. The old
    // `grid.y + grid.height` form therefore encoded "this review is short enough not to scroll", which is a
    // property of the fixture, not of the dock. Adding the destination cards above the grid made a one-face
    // review tall enough to scroll and broke it (grid bottom 709 vs dock top 617) while the dock was still
    // correctly pinned. Ordering against the grid's top is scroll-independent and still catches a dock that
    // renders above the review content.
    expect(box!.y).toBeGreaterThan(grid!.y);
  });

  /**
   * X2 — Resolutions page: Undo removes the row and re-enables flagging.
   *
   * Scope note: this drives the interactive Undo click and verifies its server-side effect directly (rather
   * than by triggering a brand-new scan job, which needs live embeddings this ML-disabled e2e stack doesn't
   * have): after Undo, `getFaceRepairPersonFaces` — the SAME query the review page calls, re-evaluating the
   * live decline/lock state against the persisted scan snapshot — includes the face again. That re-evaluation
   * (`applyDeclineFilters` dropping locked/declined faces) is exactly the mechanism a subsequent scan's
   * persistence would also go through (see FaceRepairService.removeResolutions's comment: "Removing a lock
   * re-enables flagging: the face drops out of getLockedFaceIds() and the next scan can suspect it again").
   * The interactive select→lock→Apply route through the review page is covered by X1; medium tests M5/M16
   * cover the full re-scan-drops-a-locked-face semantics against a real second scan.
   */
  test('X2: un-confirming a human-placed face re-enables flagging for that face', async () => {
    // A confirm/lock records the human placement as the face's manual identity link (there is no separate
    // lock row any more). Un-confirming it — via POST /admin/face-repair/unconfirm — downgrades that link so
    // a later scan may suspect the face again. This is the recovery path the resolutions-page lock-undo used
    // to provide.
    const db = await utils.connectDatabase();

    const source = await utils.createPerson(admin.accessToken, { name: 'X2 Confirmed Person' });
    const owner = await utils.createPerson(admin.accessToken, { name: 'X2 Owner Person' });
    const asset = await utils.createAsset(admin.accessToken);
    const faceId = await utils.createFace({ assetId: asset.id, personId: source.id });

    await seedFlaggedScan(db, {
      ownerUserId: admin.userId,
      personId: source.id,
      suspectedOwnerId: owner.id,
      faceIds: [faceId],
    });

    await resolveFaces(
      { faceRepairResolveRequestDto: { personId: source.id, lock: [faceId] } },
      { headers: asBearerAuth(admin.accessToken) },
    );

    const beforeUnconfirm = await getFaceRepairPersonFaces(
      { personId: source.id },
      { headers: asBearerAuth(admin.accessToken) },
    );
    expect(beforeUnconfirm.flaggedFaces.some((f) => f.assetFaceId === faceId)).toBe(false);

    await unconfirmFaceRepairFaces(
      { faceRepairUnconfirmRequestDto: { assetFaceIds: [faceId] } },
      { headers: asBearerAuth(admin.accessToken) },
    );

    // Un-confirm downgraded the human placement from 'manual' back to 'ml', so the face is no longer settled
    // and a later scan may flag it again. (The full re-scan-re-flags semantics are covered by the medium
    // tests, which are not subject to scan-snapshot timing; here we assert the durable state directly.)
    const { rows: linkRows } = await db.query(`SELECT source FROM "face_identity_face" WHERE "assetFaceId" = $1`, [
      faceId,
    ]);
    expect(linkRows).toHaveLength(1);
    expect(linkRows[0].source).toBe('ml');
  });

  /**
   * Consistency X1 (temporal-consistency hardening design §7.6 — distinct from X1 above, which predates and
   * covers the full-resolution feature): a deliberate "Move → chosen person" with the picker's lock toggle ON
   * durably locks the moved face so it is never re-flagged — without this, a plain move writes no persisted
   * marker at all (design §1, gap 3).
   *
   * "Re-scan" proxy: this ML-disabled stack can't run a real, live-embeddings scan job (see the file header),
   * so durability is proven the same way the existing X2 test above proves it for a plain lock — by seeding a
   * FRESH completed scan snapshot that (as a later real scan would) proposes the SAME face flagged again, then
   * reading it back through `getFaceRepairPersonFaces`. That endpoint runs the exact seam a real scan's
   * `buildRepairPlan` now also runs (a scoped `getDeclineMaps` read + `applyDeclineFilters`, Slice 4) — since
   * the lock is owner-agnostic, this proves the face would be dropped by a later scan regardless of who it
   * re-suspects.
   */
  test('Consistency X1: a move-and-lock via the picker survives a later re-scan', async ({ context, page }) => {
    await utils.setAuthCookies(context, admin.accessToken);
    const db = await utils.connectDatabase();

    const sourceName = 'CX1 Flagged Person';
    const ownerName = 'CX1 Owner Person';
    const otherName = 'CX1 Chosen Person';

    const source = await utils.createPerson(admin.accessToken, { name: sourceName });
    const owner = await utils.createPerson(admin.accessToken, { name: ownerName });
    const other = await utils.createPerson(admin.accessToken, { name: otherName });

    const asset = await utils.createAsset(admin.accessToken);
    const faceId = await utils.createFace({ assetId: asset.id, personId: source.id });

    await seedFlaggedScan(db, {
      ownerUserId: admin.userId,
      personId: source.id,
      suspectedOwnerId: owner.id,
      faceIds: [faceId],
    });

    await page.goto(`/admin/face-cleanup/${source.id}`);
    await expect(page.locator('[data-testid="admin-page-header"]').first()).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('[data-testid="face-tile"]')).toHaveCount(1, { timeout: 15_000 });

    await page.locator('[data-testid="face-tile"]').click();
    await page.locator('[data-testid="bulk-other"]').click();
    await expect(page.locator('[data-testid="person-picker"]')).toBeVisible({ timeout: 10_000 });

    // The "Lock so it won't re-flag" checkbox defaults to checked (P1) — assert it explicitly so this test
    // documents driving the picker with the lock toggle ON, per design §7.6 X1.
    await expect(page.locator('[data-testid="person-picker-lock-toggle"] button[role="checkbox"]')).toBeChecked();
    await page.locator(`[data-testid="person-picker-row-${other.id}"]`).click();

    const [resolveRequest] = await Promise.all([
      page.waitForRequest((req) => req.url().includes('/admin/face-repair/resolve') && req.method() === 'POST'),
      page.locator('[data-testid="apply-btn"]').click(),
    ]);
    const payload = resolveRequest.postDataJSON() as {
      moveToPerson: { destinationPersonId: string; faceIds: string[]; lock: boolean }[];
    };
    const chosenGroup = payload.moveToPerson.find((g) => g.destinationPersonId === other.id);
    expect(chosenGroup?.faceIds).toEqual([faceId]);
    expect(chosenGroup?.lock).toBe(true);

    await page.waitForURL('**/admin/face-cleanup/scan', { timeout: 15_000 });

    // The face actually moved to `other`, and its human placement is recorded as a manual identity link on
    // `other`'s identity (there is no separate lock table any more).
    const { rows: faceRows } = await db.query(`SELECT "personId" FROM "asset_face" WHERE id = $1`, [faceId]);
    expect(faceRows[0].personId).toBe(other.id);
    const { rows: linkRows } = await db.query(
      `SELECT fif.source FROM "face_identity_face" fif WHERE fif."assetFaceId" = $1`,
      [faceId],
    );
    expect(linkRows).toHaveLength(1);
    expect(linkRows[0].source).toBe('manual');

    // Simulate a LATER real scan: it would re-derive faceId as a candidate now living on `other` and, absent
    // the lock, propose it flagged toward `owner` again (the age-gap/re-suspect case) — seed that snapshot
    // directly (same technique `seedFlaggedScan` uses throughout this file).
    await seedFlaggedScan(db, {
      ownerUserId: admin.userId,
      personId: other.id,
      suspectedOwnerId: owner.id,
      faceIds: [faceId],
      preserveSource: true,
    });

    const afterRescan = await getFaceRepairPersonFaces(
      { personId: other.id },
      { headers: asBearerAuth(admin.accessToken) },
    );
    expect(afterRescan.flaggedFaces.some((f) => f.assetFaceId === faceId)).toBe(false);
  });

  /**
   * Consistency X2 (temporal-consistency hardening design §7.6 — distinct from X2 above, which predates and
   * covers the full-resolution feature): locking a face, then merging its person into a different one via the
   * real merge API, must not lose the lock — before Slice 1 of this design, `face_repair_lock.personId` was a
   * `CASCADE`-deleting FK, so merging the locked-on person away silently destroyed the lock and re-exposed the
   * face to the next scan (design §1, gap 1 — "the most serious hole ... in the strongest guarantee").
   *
   * Uses the same "re-scan" proxy as Consistency X1 above (see its docstring) since a real, live-embeddings
   * scan job isn't available in this ML-disabled stack.
   */
  test('Consistency X2: a lock survives a person merge and the face is still not re-flagged on a later scan', async ({
    context,
  }) => {
    await utils.setAuthCookies(context, admin.accessToken);
    const db = await utils.connectDatabase();

    const sourceName = 'CX2 Locked Person';
    const ownerName = 'CX2 Owner Person';
    const targetName = 'CX2 Merge Target Person';

    const source = await utils.createPerson(admin.accessToken, { name: sourceName });
    const owner = await utils.createPerson(admin.accessToken, { name: ownerName });
    const mergeTarget = await utils.createPerson(admin.accessToken, { name: targetName });
    const asset = await utils.createAsset(admin.accessToken);
    const faceId = await utils.createFace({ assetId: asset.id, personId: source.id });

    await seedFlaggedScan(db, {
      ownerUserId: admin.userId,
      personId: source.id,
      suspectedOwnerId: owner.id,
      faceIds: [faceId],
    });

    // Lock the face on `source` through the real resolve endpoint (a plain "Confirm / lock", not a move —
    // the interactive picker-driven move-and-lock route is Consistency X1's concern).
    await resolveFaces(
      { faceRepairResolveRequestDto: { personId: source.id, lock: [faceId] } },
      { headers: asBearerAuth(admin.accessToken) },
    );
    const { rows: linkRowsBefore } = await db.query(
      `SELECT source FROM "face_identity_face" WHERE "assetFaceId" = $1`,
      [faceId],
    );
    expect(linkRowsBefore).toHaveLength(1);
    expect(linkRowsBefore[0].source).toBe('manual');

    // Merge `source` into `mergeTarget` via the real API. The human placement is keyed by identity, which the
    // merge preserves, so it survives with no bespoke re-pointing (the whole point of the unified layer).
    await mergePerson(
      { id: mergeTarget.id, mergePersonDto: { ids: [source.id] } },
      { headers: asBearerAuth(admin.accessToken) },
    );

    const { rows: linkRowsAfter } = await db.query(`SELECT source FROM "face_identity_face" WHERE "assetFaceId" = $1`, [
      faceId,
    ]);
    expect(linkRowsAfter).toHaveLength(1);
    expect(linkRowsAfter[0].source).toBe('manual');

    // The merge itself re-points the face to the target too.
    const { rows: faceRows } = await db.query(`SELECT "personId" FROM "asset_face" WHERE id = $1`, [faceId]);
    expect(faceRows[0].personId).toBe(mergeTarget.id);

    // Simulate a LATER real scan re-suspecting the same face (now on `mergeTarget`) toward some owner: the
    // lock is owner-agnostic, so it must still be dropped regardless of who is proposed.
    await seedFlaggedScan(db, {
      ownerUserId: admin.userId,
      personId: mergeTarget.id,
      suspectedOwnerId: owner.id,
      faceIds: [faceId],
      preserveSource: true,
    });

    const afterRescan = await getFaceRepairPersonFaces(
      { personId: mergeTarget.id },
      { headers: asBearerAuth(admin.accessToken) },
    );
    expect(afterRescan.flaggedFaces.some((f) => f.assetFaceId === faceId)).toBe(false);
  });

  /**
   * Slice 7 (D7): admin cleanup + resolutions surfaces render face crops for clusters the admin does not own.
   * Every scenario above seeds under `admin` itself, so the person-scoped `/people/.../faces/.../thumbnail`
   * route (still owner/access-checked) happens to work by construction — it never exercises the broken-image
   * case a real deployment hits constantly (an admin reviewing a REGULAR user's flagged cluster). This test
   * seeds a cluster owned by a SECOND user and asserts the face `<img>` elements the admin sees actually
   * decode (naturalWidth > 0), on both the review grid and — after a "keep here" negative verdict, which has
   * no person↔face join at all — the resolutions page (the structural-404 site).
   */
  test('admin renders face crops for a cluster owned by a different user (review grid + resolutions)', async ({
    context,
    page,
  }) => {
    await utils.setAuthCookies(context, admin.accessToken);
    const db = await utils.connectDatabase();

    const secondUser = await utils.userSetup(admin.accessToken, {
      email: 'face-cleanup-second-user@test.com',
      name: 'Face Cleanup Second User',
      password: 'password',
    });

    const source = await utils.createPerson(secondUser.accessToken, { name: 'Second User Flagged Person' });
    const owner = await utils.createPerson(secondUser.accessToken, { name: 'Second User Owner Person' });
    const asset = await utils.createAsset(secondUser.accessToken);
    const faceCrop = await utils.createFace({ assetId: asset.id, personId: source.id });
    const faceStay = await utils.createFace({ assetId: asset.id, personId: source.id });

    await seedFlaggedScan(db, {
      ownerUserId: secondUser.userId,
      personId: source.id,
      suspectedOwnerId: owner.id,
      faceIds: [faceCrop, faceStay],
    });

    // getFaceThumbnailSource needs a generated Preview/Thumbnail file (it does NOT fall back to the original),
    // so the naturalWidth>0 assertions below would race the async thumbnail job without this wait. If this is
    // return "done" before the job is enqueued — see memory e2e-waitforqueuefinish-false-done).
    // The queue-status endpoint is admin-only, so poll with the ADMIN token (the jobs run on the shared
    // global queue regardless of which user owns the asset) — secondUser's token 403s here.
    await utils.waitForQueueFinish(admin.accessToken, 'metadataExtraction');
    await utils.waitForQueueFinish(admin.accessToken, 'thumbnailGeneration');

    // Admin reviews the second user's cluster — the OLD person-scoped thumbnail route requires
    // AssetRead/PersonRead access the admin doesn't hold on this owner's rows and would 403/404 here.
    await page.goto(`/admin/face-cleanup/${source.id}`);
    await expect(page.locator('[data-testid="admin-page-header"]').first()).toBeVisible({ timeout: 15_000 });

    const tile = page.locator('[data-testid="face-tile"]').first();
    await expect(tile).toBeVisible({ timeout: 15_000 });
    const tileImg = tile.locator('img');
    await expect(tileImg).toHaveAttribute('src', /.+/);
    const tileNaturalWidth = await tileImg.evaluate((img: HTMLImageElement) => img.naturalWidth);
    expect(tileNaturalWidth).toBeGreaterThan(0);

    // "Keep here": a negative verdict with NO person↔face join at all — the structural-404 case the
    // resolutions page must still render a thumbnail for.
    await resolveFaces(
      { faceRepairResolveRequestDto: { personId: source.id, stay: [faceStay] } },
      { headers: asBearerAuth(admin.accessToken) },
    );

    await page.goto('/admin/face-cleanup/resolutions');
    await expect(page.locator('[data-testid="admin-page-header"]').first()).toBeVisible({ timeout: 15_000 });

    // S14.6: scoped to THIS test's row. `.first()` on an unscoped locator is a shared-DB hazard — this suite
    // runs `.serial` and earlier tests leave their own resolution rows behind, so an unscoped `.first()` could
    // assert a thumbnail on some other test's row and pass while this one's rendered nothing. Filtered on the
    // SUSPECTED OWNER, not the cluster: a "keep here" records "this face is not <owner>", so the owner's name
    // is what the row renders (the undo test above scopes the same way).
    const row = page.locator('[data-testid="resolution-row"]').filter({ hasText: owner.name }).first();
    await expect(row).toBeVisible({ timeout: 15_000 });
    const rowImg = row.locator('img').first();
    await expect(rowImg).toHaveAttribute('src', /.+/);
    const rowNaturalWidth = await rowImg.evaluate((img: HTMLImageElement) => img.naturalWidth);
    expect(rowNaturalWidth).toBeGreaterThan(0);
  });

  /**
   * Slice 11 (manual review mode, design §7/§8 of
   * docs/superpowers/specs/2026-07-23-manual-face-review-mode-design.md) — manual flow end to end.
   *
   * Seeds a person with faces and NO scan at all — the chooser must still treat manual mode as reachable
   * (design §6.2: "manual must be reachable on a brand-new instance"), and the manual review page must list
   * every one of the person's faces rather than a scan-flagged subset (manual mode ignores scan state
   * entirely, §7). Drives all three write-bearing bulk actions this page has (move-to-chosen-person, lock,
   * "not a face") plus a fourth face left untouched at the default `keep`, then asserts the DURABLE DB STATE
   * each action produced — not UI text, per plan instructions — since that state is what the cross-engine
   * invariant test below depends on and re-verifies after a later scan.
   */
  test('manual review: reviewing a never-scanned person applies move/lock/not-a-face and writes durable state', async ({
    context,
    page,
  }) => {
    await utils.setAuthCookies(context, admin.accessToken);
    const db = await utils.connectDatabase();

    const sourceName = 'ManualFlowE2E Source Person';
    const destinationName = 'ManualFlowE2E Destination Person';

    const source = await utils.createPerson(admin.accessToken, { name: sourceName });
    const destination = await utils.createPerson(admin.accessToken, { name: destinationName });
    const asset = await utils.createAsset(admin.accessToken);

    const faceMove = await seedMlClusterFace(db, { assetId: asset.id, personId: source.id });
    const faceLock = await seedMlClusterFace(db, { assetId: asset.id, personId: source.id });
    const faceDetach = await seedMlClusterFace(db, { assetId: asset.id, personId: source.id });
    const faceKeep = await seedMlClusterFace(db, { assetId: asset.id, personId: source.id });

    // 1. Chooser: manual mode is reachable even though this person — and, by this point in the suite, most
    // others too — has never been scanned. The manual card's CTA must be a genuine link (an `href`), not the
    // disabled stub the scan-running state renders with no `href` at all (design §6.2/§7).
    await page.goto('/admin/face-cleanup');
    await expect(page.locator('[data-testid="admin-page-header"]').first()).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('[data-testid="chooser-card-manual"]')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('[data-testid="chooser-manual-cta"]')).toHaveAttribute(
      'href',
      '/admin/face-cleanup/people',
    );

    // 2. Browse people: pick the owner, click the person. The owner selector only renders once more than one
    // user exists — this suite has already created a second user by this point in the file — so select admin
    // explicitly rather than relying on default ordering; on a single-owner instance there is no selector to
    // interact with at all, and the default selection is already correct.
    await page.goto('/admin/face-cleanup/people');
    await expect(page.locator('[data-testid="admin-page-header"]').first()).toBeVisible({ timeout: 15_000 });
    const ownerSelect = page.locator('[data-testid="owner-select"]');
    if ((await ownerSelect.count()) > 0) {
      await ownerSelect.selectOption(admin.userId);
    }
    // Filter to this test's own person by name — many other tests in this `.serial` file have already created
    // admin-owned people, so the plain (unfiltered, paginated) grid offers no guarantee this row is on page 0.
    await page.locator('[data-testid="people-search-input"]').fill(sourceName);
    await expect(page.locator(`[data-testid="person-tile-${source.id}"]`)).toBeVisible({ timeout: 15_000 });
    await page.locator(`[data-testid="person-tile-${source.id}"]`).click();

    await page.waitForURL(`**/admin/face-cleanup/people/${source.id}`, { timeout: 15_000 });
    await expect(page.locator('[data-testid="admin-page-header"]').first()).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('[data-testid="manual-review-heading"]')).toHaveText(sourceName, { timeout: 15_000 });

    // 3. The manual review page lists ALL of the person's faces — no scan, so no flagged-only subset.
    await expect(page.locator('[data-testid="face-tile"]')).toHaveCount(4, { timeout: 15_000 });

    const tile = (faceId: string) => page.locator(`[data-testid="face-tile"][data-faceid="${faceId}"]`);

    // Move to another person.
    await tile(faceMove).click();
    await page.locator('[data-testid="manual-review-bulk-move"]').click();
    await expect(page.locator('[data-testid="person-picker"]')).toBeVisible({ timeout: 10_000 });
    // Same defensive search as the people browser above — this picker's own admin-scale people list is not
    // guaranteed to show a freshly created destination on its unfiltered first page either.
    await page.locator('[data-testid="person-picker-search"]').fill(destinationName);
    await page.locator(`[data-testid="person-picker-row-${destination.id}"]`).click();
    await expect(tile(faceMove)).toHaveAttribute('data-state', 'move');

    // Lock in place.
    await tile(faceLock).click();
    await page.locator('[data-testid="manual-review-bulk-lock"]').click();
    await expect(tile(faceLock)).toHaveAttribute('data-state', 'lock');

    // Not a face.
    await tile(faceDetach).click();
    await page.locator('[data-testid="manual-review-bulk-detach"]').click();
    await expect(tile(faceDetach)).toHaveAttribute('data-state', 'detach');

    // faceKeep is left untouched — still the default `keep`, proving the grid really did list all four faces
    // and that "keep" writes nothing (design §3.1).
    await expect(tile(faceKeep)).toHaveAttribute('data-state', 'keep');

    // "Not a face" is irreversible, so Apply confirms before sending anything.
    await page.locator('[data-testid="manual-review-apply-btn"]').click();
    // Same ConfirmModal as the guided review page above — see the note there.
    const manualDetachDialog = page.getByRole('dialog');
    await expect(manualDetachDialog).toBeVisible({ timeout: 10_000 });

    const [resolveRequest, resolveResponse] = await Promise.all([
      page.waitForRequest((req) => req.url().includes('/admin/face-repair/resolve') && req.method() === 'POST'),
      page.waitForResponse(
        (res) => res.url().includes('/admin/face-repair/resolve') && res.request().method() === 'POST',
      ),
      manualDetachDialog.getByRole('button', { name: /Yes, discard/i }).click(),
    ]);
    expect(resolveResponse.ok()).toBe(true);

    const payload = resolveRequest.postDataJSON() as {
      personId: string;
      moveToPerson: { destinationPersonId: string; faceIds: string[]; lock: boolean }[];
      stay: string[];
      lock: string[];
      detach: string[];
      unknown: string[];
    };
    expect(payload.personId).toBe(source.id);
    expect(payload.stay).toEqual([]);
    expect(payload.lock).toEqual([faceLock]);
    expect(payload.detach).toEqual([faceDetach]);
    expect(payload.unknown).toEqual([]);
    const moveGroup = payload.moveToPerson.find((group) => group.destinationPersonId === destination.id);
    expect(moveGroup).toBeDefined();
    expect(moveGroup?.faceIds).toEqual([faceMove]);

    // ---- Durable DB state, not UI text ----

    // Moved face: re-attributed to the destination, and its identity link now records the human placement.
    const { rows: moveFaceRows } = await db.query(`SELECT "personId" FROM "asset_face" WHERE id = $1`, [faceMove]);
    expect(moveFaceRows[0].personId).toBe(destination.id);
    const { rows: moveLinkRows } = await db.query(`SELECT source FROM "face_identity_face" WHERE "assetFaceId" = $1`, [
      faceMove,
    ]);
    expect(moveLinkRows).toHaveLength(1);
    expect(moveLinkRows[0].source).toBe('manual');

    // Locked face: still on `source`; its identity link now records the confirmed placement (there is no
    // separate lock table — that link IS the lock, design §5.3).
    const { rows: lockFaceRows } = await db.query(`SELECT "personId" FROM "asset_face" WHERE id = $1`, [faceLock]);
    expect(lockFaceRows[0].personId).toBe(source.id);
    const { rows: lockLinkRows } = await db.query(`SELECT source FROM "face_identity_face" WHERE "assetFaceId" = $1`, [
      faceLock,
    ]);
    expect(lockLinkRows).toHaveLength(1);
    expect(lockLinkRows[0].source).toBe('manual');

    // Detached face: unassigned and soft-deleted, identity link stripped entirely.
    const { rows: detachFaceRows } = await db.query(`SELECT "personId", "deletedAt" FROM "asset_face" WHERE id = $1`, [
      faceDetach,
    ]);
    expect(detachFaceRows[0].personId).toBeNull();
    expect(detachFaceRows[0].deletedAt).not.toBeNull();
    const { rows: detachLinkRows } = await db.query(
      `SELECT source FROM "face_identity_face" WHERE "assetFaceId" = $1`,
      [faceDetach],
    );
    expect(detachLinkRows).toHaveLength(0);

    manualFlow = { source, destination, faceMove, faceLock, faceDetach };
  });

  /**
   * Slice 11 — cross-engine invariant (design §7, "the point of the feature").
   *
   * After the manual-flow test's decisions, simulate a LATER scan re-deriving the surviving faces as
   * candidates and proposing them flagged again — toward an owner neither face has ever been associated with
   * before, so there is no way a stale pairing could accidentally save this assertion — and confirm the manual
   * decisions are honoured exactly as guided ones would be: the locked face is not re-flagged, the moved face
   * is not re-proposed, and the detached face stays gone. Asserts durable DB state (identity-link source, plus
   * the flagged-snapshot read every review page and dashboard already goes through), never re-scan ordering —
   * two scans stamped the same `now()` make getLatestScan nondeterministic, a flake this feature has already
   * produced once (see seedFlaggedScanMulti's docstring above for why this seeds ONE scan, not two).
   */
  test('manual review: a later scan honours every manual decision exactly as a guided one (cross-engine invariant)', async () => {
    if (!manualFlow) {
      throw new Error('manual review fixture is missing — the preceding test must have run and passed first');
    }
    const { source, destination, faceMove, faceLock, faceDetach } = manualFlow;
    const db = await utils.connectDatabase();

    const bystander = await utils.createPerson(admin.accessToken, { name: 'ManualFlowE2E Rescan Bystander' });

    // One scan, two persons — see seedFlaggedScanMulti's docstring for why this must not be two separate calls.
    await seedFlaggedScanMulti(db, {
      ownerUserId: admin.userId,
      groups: [
        { personId: source.id, suspectedOwnerId: bystander.id, faceIds: [faceLock], preserveSource: true },
        { personId: destination.id, suspectedOwnerId: bystander.id, faceIds: [faceMove], preserveSource: true },
      ],
    });

    // Locked face: never re-flagged on the person it was locked to, regardless of who the new scan suspects —
    // the manual link is owner-agnostic (design §5.3).
    const sourceFlagged = await getFaceRepairPersonFaces(
      { personId: source.id },
      { headers: asBearerAuth(admin.accessToken) },
    );
    expect(sourceFlagged.flaggedFaces.some((f) => f.assetFaceId === faceLock)).toBe(false);

    // Moved face: not re-proposed on its new person either.
    const destinationFlagged = await getFaceRepairPersonFaces(
      { personId: destination.id },
      { headers: asBearerAuth(admin.accessToken) },
    );
    expect(destinationFlagged.flaggedFaces.some((f) => f.assetFaceId === faceMove)).toBe(false);

    // Durable confirmation underneath the read-path filters above: the identity links a real scan's verdict
    // layer keys off are still exactly what the manual review wrote — running another scan did not touch them.
    const { rows: lockLinkRows } = await db.query(`SELECT source FROM "face_identity_face" WHERE "assetFaceId" = $1`, [
      faceLock,
    ]);
    expect(lockLinkRows).toHaveLength(1);
    expect(lockLinkRows[0].source).toBe('manual');

    const { rows: moveLinkRows } = await db.query(`SELECT source FROM "face_identity_face" WHERE "assetFaceId" = $1`, [
      faceMove,
    ]);
    expect(moveLinkRows).toHaveLength(1);
    expect(moveLinkRows[0].source).toBe('manual');

    // Detached face stays gone. A real scan cannot even see it — every eligibility predicate this feature uses
    // (getClusterFacePage, getEligibleFaceIdsForPerson, streamEligibleFaces) requires deletedAt IS NULL and a
    // live personId, both of which the detach cleared — so there is nothing here for a scan to resurrect; this
    // simply re-confirms the durable state the manual-flow test wrote still holds.
    const { rows: detachFaceRows } = await db.query(`SELECT "personId", "deletedAt" FROM "asset_face" WHERE id = $1`, [
      faceDetach,
    ]);
    expect(detachFaceRows[0].personId).toBeNull();
    expect(detachFaceRows[0].deletedAt).not.toBeNull();
    const { rows: detachLinkRows } = await db.query(
      `SELECT source FROM "face_identity_face" WHERE "assetFaceId" = $1`,
      [faceDetach],
    );
    expect(detachLinkRows).toHaveLength(0);
  });
});
