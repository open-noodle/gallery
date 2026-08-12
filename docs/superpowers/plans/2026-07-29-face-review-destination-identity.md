# Face Review Destination Identity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the face-cleanup review page say _what_ a suggested destination is — thumbnail, size, link — and stop pretending a cluster has only one destination.

**Architecture:** The scan payload already carries a thumbnail per suspected owner; the server adds two overlay-only fields (`ownerFaceCount`, `ownerMissing`) filled by the read-time overlay that already refreshes names and thumbnails. The web renders a destination card per suspected owner and replaces two hardcoded `suspectedOwners[0]` bulk actions with a real destination chooser.

**Tech Stack:** NestJS 11 + Kysely + Zod (`nestjs-zod`) on the server; SvelteKit + Svelte 5 runes + Tailwind 4 on the web; Vitest everywhere (medium tests via testcontainers).

**Spec:** `docs/superpowers/specs/2026-07-29-face-review-destination-identity-design.md`

## Global Constraints

- **Branch:** `feat/face-review-unified` (PR #834). Do not branch off; commit directly.
- **Prettier:** 120 char width, single quotes, trailing commas, semicolons. Server CI runs `prettier --check .` as a **separate gate** from eslint — `pnpm lint` passing does not mean prettier passes.
- **ESLint:** `--max-warnings 0` everywhere. An unused local fails CI.
- **Server imports:** no relative imports — use the `src/` path alias.
- **Test filters:** `pnpm test -- --run <path>` and `pnpm test:medium -- --run <path>` **silently drop the path filter** and run everything. Always use `pnpm exec vitest ...` forms given in each task.
- **i18n:** new keys go in **all ten** files that already carry `face_cleanup_review_banner_body`: `en, de, fr, es, it, nl, pl, ru, zh_Hans, zh_Hant`. pl/ru need one/few/many/other plural forms; zh needs one/other.
- **Commits:** never add `Co-Authored-By` or `Generated with` trailers.
- **Terminology:** `count` = flagged faces routing to an owner (persisted). `ownerFaceCount` = that owner's own face count (live). Never conflate them.

---

## File Structure

| File                                                                    | Responsibility                                                        |
| ----------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `server/src/dtos/face-repair.dto.ts`                                    | `ScanSuspectedOwnerSchema` gains the two new required fields          |
| `server/src/repositories/face-repair-scan.repository.ts`                | `RepairScanSuspectedOwner` type + `withCurrentNames` fills the fields |
| `server/src/services/face-repair.service.ts`                            | Comment only — records the ordering dependency                        |
| `web/src/routes/admin/face-cleanup/[personId]/destination.ts`           | **New.** Shared `SuspectedOwner` type + pure selection helpers        |
| `web/src/routes/admin/face-cleanup/[personId]/DestinationCards.svelte`  | **New.** The card list + `+n more` expander                           |
| `web/src/routes/admin/face-cleanup/[personId]/DestinationSelect.svelte` | **New.** The `<select>`; emits choices, opens nothing itself          |
| `web/src/routes/admin/face-cleanup/[personId]/+page.svelte`             | Wires the above; owns destination state and the picker call           |
| `web/src/routes/admin/face-cleanup/[personId]/PersonPicker.svelte`      | Gains a `showLock` prop                                               |
| `web/src/routes/admin/face-cleanup/scan/ReviewFirstLane.svelte`         | Destination column shows `ownerFaceCount`                             |
| `i18n/{en,de,fr,es,it,nl,pl,ru,zh_Hans,zh_Hant}.json`                   | New keys + two edits                                                  |

The two new Svelte components exist because `+page.svelte` is already 891 lines. Both are presentational: they take data and emit callbacks, and neither talks to the SDK.

---

## Task 1: Server — live counts on the scan overlay

**Files:**

- Modify: `server/src/dtos/face-repair.dto.ts:82-87`
- Modify: `server/src/repositories/face-repair-scan.repository.ts:24-29` and `:206-245`
- Test: `server/src/dtos/face-repair.dto.spec.ts`
- Test: `server/test/medium/specs/repositories/face-repair-scan.repository.spec.ts` (extend the `withCurrentNames` describe at `:209`)

**Interfaces:**

- Consumes: nothing.
- Produces: `ScanSuspectedOwnerSchema` with `ownerFaceCount: number` and `ownerMissing: boolean`, both **required** in the DTO; `RepairScanSuspectedOwner.ownerFaceCount?: number` / `.ownerMissing?: boolean`, both **optional** on the repository type. Optional there because `enrichReportPersons` writes the persisted scan-time shape and must not set them; required in the DTO because `withCurrentNames` always fills them before the DTO boundary. Task 3 and Task 5 read both fields off the SDK type `ScanSuspectedOwnerDto`.

- [ ] **Step 1: Write the failing DTO test**

Append to `server/src/dtos/face-repair.dto.spec.ts`. Add `FaceRepairScanStatusSchema` to the import list at the top of the file.

```ts
describe('ScanSuspectedOwnerSchema (via FaceRepairScanStatusSchema)', () => {
  const scan = (owner: Record<string, unknown>) => ({
    id: 'scan-1',
    status: 'completed',
    progress: null,
    totals: null,
    persons: [
      {
        personId: UUID_V4,
        ownerId: UUID_V4,
        personName: null,
        faceCount: 10,
        thumbnailFaceId: null,
        eligible: 10,
        flagged: 3,
        flaggedFraction: 0.3,
        suspectedOwners: [owner],
        recommendation: 'review-first',
        reviewReasons: [],
      },
    ],
    error: null,
    startedAt: null,
    finishedAt: null,
    createdAt: '2026-07-29T00:00:00.000Z',
  });

  const validOwner = {
    ownerPersonId: UUID_V4,
    ownerName: 'Katrin',
    thumbnailFaceId: null,
    count: 2201,
    ownerFaceCount: 1204,
    ownerMissing: false,
  };

  it('accepts an owner carrying both its routing share and its own face count', () => {
    expect(FaceRepairScanStatusSchema.safeParse(scan(validOwner)).success).toBe(true);
  });

  it('rejects a bigint-as-string face count (what Postgres count() returns unconverted)', () => {
    const result = FaceRepairScanStatusSchema.safeParse(scan({ ...validOwner, ownerFaceCount: '1204' }));
    expect(result.success).toBe(false);
  });

  it('requires the overlay to state whether the destination still exists', () => {
    const { ownerMissing, ...withoutFlag } = validOwner;
    expect(FaceRepairScanStatusSchema.safeParse(scan(withoutFlag)).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

```bash
cd server && pnpm exec vitest --run src/dtos/face-repair.dto.spec.ts
```

Expected: the first test FAILS. Zod strips unknown keys rather than rejecting them, so `safeParse` succeeds on the valid owner but the parsed output lacks the new fields — and the two negative tests pass for the wrong reason (missing/invalid optional keys are ignored). **If all three pass, that is the wrong failure**: the assertion that must go red is the first one. Change it to assert on the parsed value instead, and re-run:

```ts
const parsed = FaceRepairScanStatusSchema.safeParse(scan(validOwner));
expect(parsed.success && parsed.data.persons[0].suspectedOwners[0]).toMatchObject({
  ownerFaceCount: 1204,
  ownerMissing: false,
});
```

Expected after the change: FAIL — the parsed owner has no `ownerFaceCount`.

- [ ] **Step 3: Add the fields to the schema**

In `server/src/dtos/face-repair.dto.ts`, replace `ScanSuspectedOwnerSchema` (`:82-87`):

```ts
const ScanSuspectedOwnerSchema = z.object({
  ownerPersonId: z.string(),
  ownerName: z.string().nullable(),
  thumbnailFaceId: z.string().nullable(),
  // Two different numbers, one of which used to do duty for both — which is how the console came to print
  // "Unnamed cluster / 1 faces" under a destination holding thousands.
  //   count          — PERSISTED, scan-time: flagged faces on THIS cluster routing to this owner.
  //   ownerFaceCount — OVERLAY, live: the destination person's own face count.
  count: z.number(),
  ownerFaceCount: z.number(),
  // The destination person row is gone (deleted or merged since the scan). The console renders a warning and
  // refuses to offer it as a destination, rather than letting Apply fail with face-repair:destination-missing.
  ownerMissing: z.boolean(),
});
```

- [ ] **Step 4: Run the DTO test to confirm it passes**

```bash
cd server && pnpm exec vitest --run src/dtos/face-repair.dto.spec.ts
```

Expected: PASS.

- [ ] **Step 5: Write the failing repository tests**

In `server/test/medium/specs/repositories/face-repair-scan.repository.spec.ts`, inside the existing `describe('withCurrentNames', …)` block (`:209`), add this helper and the tests below it:

```ts
// A person with `visible` countable faces, plus optional faces that must NOT be counted.
const insertPersonWithFaces = async (
  ownerId: string,
  visible: number,
  extra: { deleted?: number; invisible?: number; name?: string } = {},
) => {
  const person = mediumFactory.personInsert({ ownerId, name: extra.name ?? '' });
  await db
    .insertInto('person')
    .values({ ...person, name: extra.name ?? '' })
    .execute();
  const asset = mediumFactory.assetInsert({ ownerId });
  await db.insertInto('asset').values(asset).execute();
  const rows = [
    ...Array.from({ length: visible }, () => mediumFactory.assetFaceInsert({ assetId: asset.id, personId: person.id })),
    ...Array.from({ length: extra.deleted ?? 0 }, () =>
      mediumFactory.assetFaceInsert({ assetId: asset.id, personId: person.id, deletedAt: new Date() }),
    ),
    ...Array.from({ length: extra.invisible ?? 0 }, () =>
      mediumFactory.assetFaceInsert({ assetId: asset.id, personId: person.id, isVisible: false }),
    ),
  ];
  if (rows.length > 0) {
    await db.insertInto('asset_face').values(rows).execute();
  }
  return person.id;
};

const scanWith = async (
  clusterId: string,
  ownerIds: string[],
  snapshot: { faceCount?: number } = {},
): Promise<RepairScanPerson[]> => {
  const scan = await sut.createScan({ requestedBy: null, params: PARAMS });
  await sut.completeScan(scan.id, {
    totals: zeroTotals(),
    persons: [
      {
        personId: clusterId,
        ownerId: 'ignored-at-read-time',
        personName: null,
        faceCount: snapshot.faceCount ?? 999,
        thumbnailFaceId: null,
        eligible: 35,
        flagged: 20,
        flaggedFraction: 20 / 35,
        suspectedOwners: ownerIds.map((id) => ({
          ownerPersonId: id,
          ownerName: null,
          thumbnailFaceId: null,
          count: 20,
        })),
        recommendation: 'confident',
        reviewReasons: [],
      },
    ],
  });
  const refreshed = await sut.withCurrentNames((await sut.getLatestScan())!);
  return refreshed.persons as unknown as RepairScanPerson[];
};

it("reports a destination's live face count, not the number the scan recorded", async () => {
  const user = mediumFactory.userInsert({});
  await db.insertInto('user').values(user).execute();
  const cluster = await insertPersonWithFaces(user.id, 1);
  const owner = await insertPersonWithFaces(user.id, 7);

  const [person] = await scanWith(cluster, [owner]);

  expect(person.suspectedOwners[0].ownerFaceCount).toBe(7);
  // The routing share is untouched — it is scan-time data, not a live count.
  expect(person.suspectedOwners[0].count).toBe(20);
});

it('reports the count as a number, not the bigint string Postgres returns', async () => {
  const user = mediumFactory.userInsert({});
  await db.insertInto('user').values(user).execute();
  const cluster = await insertPersonWithFaces(user.id, 1);
  const owner = await insertPersonWithFaces(user.id, 3);

  const [person] = await scanWith(cluster, [owner]);

  expect(typeof person.suspectedOwners[0].ownerFaceCount).toBe('number');
  expect(typeof person.faceCount).toBe('number');
});

it('counts only visible, undeleted faces — agreeing with getPersonMetadata on the same person', async () => {
  const user = mediumFactory.userInsert({});
  await db.insertInto('user').values(user).execute();
  const cluster = await insertPersonWithFaces(user.id, 1);
  const owner = await insertPersonWithFaces(user.id, 4, { deleted: 3, invisible: 2 });

  const [person] = await scanWith(cluster, [owner]);
  const metadata = await new FaceRepairRepository(db).getPersonMetadata(owner);

  expect(person.suspectedOwners[0].ownerFaceCount).toBe(4);
  expect(person.suspectedOwners[0].ownerFaceCount).toBe(metadata!.faceCount);
});

it('marks a suspected owner whose person row was deleted as missing, with a zero count', async () => {
  const user = mediumFactory.userInsert({});
  await db.insertInto('user').values(user).execute();
  const cluster = await insertPersonWithFaces(user.id, 1);
  const owner = await insertPersonWithFaces(user.id, 5);
  await db.deleteFrom('person').where('id', '=', owner).execute();

  const [person] = await scanWith(cluster, [owner]);

  expect(person.suspectedOwners[0].ownerMissing).toBe(true);
  expect(person.suspectedOwners[0].ownerFaceCount).toBe(0);
});

it('reports zero for a destination with no faces rather than dropping it', async () => {
  const user = mediumFactory.userInsert({});
  await db.insertInto('user').values(user).execute();
  const cluster = await insertPersonWithFaces(user.id, 1);
  const owner = await insertPersonWithFaces(user.id, 0);

  const [person] = await scanWith(cluster, [owner]);

  expect(person.suspectedOwners).toHaveLength(1);
  expect(person.suspectedOwners[0].ownerFaceCount).toBe(0);
  expect(person.suspectedOwners[0].ownerMissing).toBe(false);
});

it("overlays the reviewed cluster's own face count live as well", async () => {
  const user = mediumFactory.userInsert({});
  await db.insertInto('user').values(user).execute();
  const cluster = await insertPersonWithFaces(user.id, 6);
  const owner = await insertPersonWithFaces(user.id, 2);

  const [person] = await scanWith(cluster, [owner], { faceCount: 999 });

  expect(person.faceCount).toBe(6);
});

it('leaves eligible and the recorded flagged count at their scan-time values', async () => {
  const user = mediumFactory.userInsert({});
  await db.insertInto('user').values(user).execute();
  const cluster = await insertPersonWithFaces(user.id, 6);
  const owner = await insertPersonWithFaces(user.id, 2);

  const [person] = await scanWith(cluster, [owner]);

  expect(person.eligible).toBe(35);
  expect(person.flagged).toBe(20);
});

it('keeps the snapshot face count for a cluster whose own row was deleted', async () => {
  const user = mediumFactory.userInsert({});
  await db.insertInto('user').values(user).execute();
  const cluster = await insertPersonWithFaces(user.id, 6);
  const owner = await insertPersonWithFaces(user.id, 2);
  await db.deleteFrom('person').where('id', '=', cluster).execute();

  const [person] = await scanWith(cluster, [owner], { faceCount: 42 });

  // Better a stale number than claiming a cluster the admin is looking at has zero faces.
  expect(person.faceCount).toBe(42);
});
```

Add `FaceRepairRepository` to the imports at the top of the file:

```ts
import { FaceRepairRepository } from 'src/repositories/face-repair.repository';
```

- [ ] **Step 6: Run the repository tests to confirm they fail**

```bash
cd server && pnpm exec vitest --config test/vitest.config.medium.mjs --run test/medium/specs/repositories/face-repair-scan.repository.spec.ts
```

Expected: the new tests FAIL with `expected undefined to be 7` (and similar) — `ownerFaceCount` does not exist yet. The two pre-existing `withCurrentNames` tests must stay green.

- [ ] **Step 7: Add the fields to the repository type**

In `server/src/repositories/face-repair-scan.repository.ts`, replace `RepairScanSuspectedOwner` (`:24-29`):

```ts
export interface RepairScanSuspectedOwner {
  ownerPersonId: string;
  ownerName: string | null;
  thumbnailFaceId: string | null;
  // Flagged faces on the reviewed cluster routing to this owner. PERSISTED at scan time.
  count: number;
  // Overlay-only, filled by withCurrentNames — never present in the persisted scan JSON, which is why these
  // are optional here and required in ScanSuspectedOwnerSchema. enrichReportPersons writes the scan-time shape
  // and must not set them; getLatestScan always fills them before the DTO boundary.
  ownerFaceCount?: number;
  ownerMissing?: boolean;
}
```

- [ ] **Step 8: Fill the fields in `withCurrentNames`**

Replace the body of `withCurrentNames` (`:211-245`) with:

```ts
  async withCurrentNames(scan: RepairScanRow): Promise<RepairScanRow> {
    const persons = (scan.persons ?? []) as unknown as RepairScanPerson[];
    if (persons.length === 0) {
      return scan;
    }
    const ids = [...new Set(persons.flatMap((p) => [p.personId, ...p.suspectedOwners.map((o) => o.ownerPersonId)]))];
    // The join predicate must stay identical to FaceRepairRepository.getPersonMetadata and .searchOwnerPeople:
    // the review page renders this count next to the picker's, and a disagreement reads as a bug. It is covered
    // by the partial index asset_face_personId_assetId_notDeleted_isVisible_idx.
    const rows = await this.db
      .selectFrom('person')
      .leftJoin('asset_face', (join) =>
        join
          .onRef('asset_face.personId', '=', 'person.id')
          .on('asset_face.deletedAt', 'is', null)
          .on('asset_face.isVisible', '=', true),
      )
      .select(['person.id as id', 'person.name as name', 'person.faceAssetId as faceAssetId'])
      .select((eb) => eb.fn.count('asset_face.id').as('faceCount'))
      .where('person.id', 'in', ids)
      .groupBy(['person.id'])
      .execute();
    const byId = new Map(rows.map((r) => [r.id, r]));
    const nameOf = (id: string) => (byId.get(id)?.name ? byId.get(id)!.name : null);
    const thumbOf = (id: string) => byId.get(id)?.faceAssetId ?? null;
    // count() is bigint, which the driver returns as a STRING. Every other face count in this service converts
    // (getPersonMetadata:108); leaving it a string fails z.number() and breaks {count, number} in the web.
    const faceCountOf = (id: string) => Number(byId.get(id)?.faceCount ?? 0);

    const refreshed = persons.map((p) => {
      const personName = nameOf(p.personId);
      const namedNow = personName !== null;
      const reviewReasons =
        namedNow && !p.reviewReasons.includes('named') ? ['named', ...p.reviewReasons] : p.reviewReasons;
      return {
        ...p,
        personName,
        thumbnailFaceId: thumbOf(p.personId),
        // Live, like the name and thumbnail beside it. A cluster whose row is gone keeps its snapshot count
        // rather than claiming the cluster the admin is looking at has zero faces.
        faceCount: byId.has(p.personId) ? faceCountOf(p.personId) : p.faceCount,
        recommendation: (namedNow ? 'review-first' : p.recommendation) as RepairScanPerson['recommendation'],
        reviewReasons,
        suspectedOwners: p.suspectedOwners.map((o) => ({
          ...o,
          ownerName: nameOf(o.ownerPersonId),
          thumbnailFaceId: thumbOf(o.ownerPersonId),
          ownerFaceCount: faceCountOf(o.ownerPersonId),
          ownerMissing: !byId.has(o.ownerPersonId),
        })),
      };
    });
    return { ...scan, persons: refreshed as unknown as RepairScanRow['persons'] };
  }
```

- [ ] **Step 9: Run the repository tests to confirm they pass**

```bash
cd server && pnpm exec vitest --config test/vitest.config.medium.mjs --run test/medium/specs/repositories/face-repair-scan.repository.spec.ts
```

Expected: PASS, including the two pre-existing `withCurrentNames` tests.

- [ ] **Step 10: Run the neighbouring medium suites for fixture fallout**

`faceCount` is now live, so any fixture that sets it without inserting matching `asset_face` rows and then asserts on it will now see the real number.

```bash
cd server && pnpm exec vitest --config test/vitest.config.medium.mjs --run \
  test/medium/specs/services/face-repair.scan.spec.ts \
  test/medium/specs/services/face-repair-flagged-faces.spec.ts \
  test/medium/specs/services/face-repair.resolve.spec.ts
```

Expected: PASS. If a test fails asserting a `faceCount` it never backed with real faces, re-baseline that expectation to the real count — do **not** revert the live overlay.

- [ ] **Step 11: Regenerate the API clients**

```bash
cd /Users/pierre/dev/gallery/.claude/worktrees/pr834-rebase && mise open-api
```

This regenerates the TypeScript SDK and the Dart client. Do **not** run `mise sql` — `face-repair-scan.repository.ts` carries no `@GenerateSql` decorators, and running it without a live DB deletes every query file.

- [ ] **Step 12: Commit**

```bash
git add server/src/dtos/face-repair.dto.ts server/src/repositories/face-repair-scan.repository.ts \
  server/src/dtos/face-repair.dto.spec.ts \
  server/test/medium/specs/repositories/face-repair-scan.repository.spec.ts \
  open-api/ mobile/openapi/ packages/sdk/
git commit -m "feat(face-cleanup): report a suspected owner's own face count and whether it still exists"
```

---

## Task 2: Server — pin the overlay ordering

`getLatestScanStatus` runs `withCurrentNames` then `withLiveFlaggedCounts` (`face-repair.service.ts:581-582`). The latter rebuilds every suspected owner with `.map((owner) => ({ ...owner, count }))` — that spread is the **only** reason Task 1's fields survive to the client. Replacing it with an explicit object literal drops them silently.

> **Corrected during implementation (2026-07-29).** This plan originally also claimed the _call order_ was load-bearing, and Step 2 below told the implementer to prove the test red by swapping the two calls. That is false: `withCurrentNames` sets both fields unconditionally, so whichever pass runs last wins and either order produces a correct payload. The red phase must instead be proven by replacing the spread with an explicit literal. Steps below are corrected; the shipped comments say the true thing.

**Files:**

- Modify: `server/src/services/face-repair.service.ts:581-582` and `:631-633` (comments only)
- Test: `server/test/medium/specs/services/face-repair.scan.spec.ts`

**Interfaces:**

- Consumes: `ownerFaceCount` / `ownerMissing` from Task 1.
- Produces: nothing new. This task adds a regression pin.

- [ ] **Step 1: Write the failing test**

Append to `server/test/medium/specs/services/face-repair.scan.spec.ts`, inside the existing
`describe('FaceRepairService.handleFaceRepairScan', …)`. This mirrors the Karina/Alexia fixture the test at
`:90` already builds — two clusters on disjoint embedding axes, three of Karina's faces leaked onto Alexia —
because a real `handleFaceRepairScan` run is the only way to exercise the whole read path. Note `setup()` is
**not** awaited here, and the service method is `getLatestScanStatus`, not `getLatestScan`.

```ts
it('carries the destination overlay through the live flagged-count recompute', async () => {
  // withLiveFlaggedCounts rebuilds every suspectedOwner. If its object spread is ever replaced with an
  // explicit literal, the overlay fields vanish between the repository and the client with nothing else
  // failing. (Swapping the call order does NOT reproduce this — withCurrentNames sets the fields
  // unconditionally, so whichever pass runs last wins.)
  const { sut, ctx } = setup();
  const scanRepo = ctx.get(FaceRepairScanRepository);
  const { user } = await ctx.newUser();

  const karinaData = mediumFactory.personInsert({ ownerId: user.id, name: 'Karina' });
  await db.insertInto('person').values(karinaData).execute();
  for (let i = 0; i < 10; i++) {
    const { asset } = await ctx.newAsset({ ownerId: user.id });
    const { assetFace } = await ctx.newAssetFace({ assetId: asset.id, personId: karinaData.id });
    await db
      .insertInto('face_search')
      .values({ faceId: assetFace.id, embedding: axisEmbedding('first') })
      .execute();
  }

  const alexiaData = mediumFactory.personInsert({ ownerId: user.id, name: 'Alexia' });
  await db.insertInto('person').values(alexiaData).execute();
  for (let i = 0; i < 3; i++) {
    const { asset } = await ctx.newAsset({ ownerId: user.id });
    const { assetFace } = await ctx.newAssetFace({ assetId: asset.id, personId: alexiaData.id });
    await db
      .insertInto('face_search')
      .values({ faceId: assetFace.id, embedding: axisEmbedding('first') })
      .execute();
  }
  for (let i = 0; i < 8; i++) {
    const { asset } = await ctx.newAsset({ ownerId: user.id });
    const { assetFace } = await ctx.newAssetFace({ assetId: asset.id, personId: alexiaData.id });
    await db
      .insertInto('face_search')
      .values({ faceId: assetFace.id, embedding: axisEmbedding('second') })
      .execute();
  }

  const scan = await scanRepo.createScan({ requestedBy: null, params: PARAMS });
  await sut.handleFaceRepairScan({ scanId: scan.id });

  const latest = await sut.getLatestScanStatus();
  const alexia = latest!.persons.find((p) => p.personId === alexiaData.id)!;
  const destination = alexia.suspectedOwners.find((o) => o.ownerPersonId === karinaData.id)!;

  // Karina has 10 real faces; the routing share is the 3 leaked onto Alexia. Two different numbers, and
  // both must survive the recompute.
  expect(destination.ownerFaceCount).toBe(10);
  expect(destination.ownerMissing).toBe(false);
  expect(destination.count).toBeGreaterThan(0);
  expect(destination.count).not.toBe(destination.ownerFaceCount);
});
```

- [ ] **Step 2: Prove the test can fail**

Temporarily replace the `{ ...owner, count }` spread in `withLiveFlaggedCounts` (`face-repair.service.ts:~632`) with an explicit literal that names only the persisted fields:

```ts
.map((owner) => ({
  ownerPersonId: owner.ownerPersonId,
  ownerName: owner.ownerName,
  thumbnailFaceId: owner.thumbnailFaceId,
  count: countByOwner.get(owner.ownerPersonId) ?? 0,
}))
```

(Do **not** try to prove this by swapping the two call sites — that does not reproduce the drop.)

Run:

```bash
cd server && pnpm exec vitest --config test/vitest.config.medium.mjs --run test/medium/specs/services/face-repair.scan.spec.ts
```

Expected: FAIL — `ownerFaceCount` is `undefined`, because `withLiveFlaggedCounts` ran against owners that had not been overlaid yet and then `withCurrentNames` re-mapped them from the (already filtered) list. **Revert the swap immediately** and confirm the test goes green. This is the one task whose test passes before the production change; proving the failure by hand is what makes it a real pin.

- [ ] **Step 3: Record the dependency in comments**

At `face-repair.service.ts:579-582`, extend the existing comment:

```ts
// Refresh display names/thumbnails from the live person table — people get named after a scan and the
// persisted report is only a snapshot. Keeps the console legible without an expensive full re-scan.
//
// withCurrentNames adds ownerFaceCount/ownerMissing to each suspected owner; withLiveFlaggedCounts
// below carries them through only via its `{ ...owner }` spread. Expanding that spread into an
// explicit literal silently drops both fields (verified by hand: swapping the call order alone does
// NOT reproduce the drop, because withCurrentNames re-adds the fields unconditionally whichever pass
// runs last — the spread, not the order, is the load-bearing piece). Pinned by
// face-repair.scan.spec.ts ("carries the destination overlay through the live flagged-count recompute").
const withNames = await this.faceRepairScanRepository.withCurrentNames(scan);
return this.withLiveFlaggedCounts(withNames);
```

And at `:631`, above the `suspectedOwners` rebuild:

```ts
// `...owner` is what preserves the overlay fields withCurrentNames added (ownerFaceCount,
// ownerMissing). Do not expand this into an explicit object literal.
suspectedOwners: p.suspectedOwners;
```

- [ ] **Step 4: Run the test to confirm it passes**

```bash
cd server && pnpm exec vitest --config test/vitest.config.medium.mjs --run test/medium/specs/services/face-repair.scan.spec.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/services/face-repair.service.ts test/medium/specs/services/face-repair.scan.spec.ts
git commit -m "test(face-cleanup): pin the overlay ordering the destination fields depend on"
```

---

## Task 3: Web — the destination card

**Files:**

- Create: `web/src/routes/admin/face-cleanup/[personId]/destination.ts`
- Create: `web/src/routes/admin/face-cleanup/[personId]/DestinationCards.svelte`
- Modify: `web/src/routes/admin/face-cleanup/[personId]/+page.svelte:33-50` (ScanPerson type), `:118-136` (derived), `:477-510` (banner)
- Test: `web/src/routes/admin/face-cleanup/[personId]/page.spec.ts`

**Interfaces:**

- Consumes: `ownerFaceCount`, `ownerMissing` from Task 1.
- Produces:
  - `destination.ts` exports `interface SuspectedOwner { ownerPersonId: string; ownerName: string | null; thumbnailFaceId: string | null; count: number; ownerFaceCount: number; ownerMissing: boolean }`
  - `destination.ts` exports `sortDestinations(owners: SuspectedOwner[]): SuspectedOwner[]` (count desc, `ownerPersonId` asc tiebreak) and `selectableDestinations(owners: SuspectedOwner[]): SuspectedOwner[]` (drops `ownerMissing`). Task 4 uses both.
  - `DestinationCards.svelte` props: `{ owners: SuspectedOwner[] }`.

- [ ] **Step 1: Write the failing tests**

In `page.spec.ts`, extend the shared fixture at `:139` so suspected owners carry the new fields:

```ts
  suspectedOwners: [
    {
      ownerPersonId: OWNER_A_ID,
      ownerName: 'Armin',
      thumbnailFaceId: 'thumb-a',
      count: 2,
      ownerFaceCount: 1204,
      ownerMissing: false,
    },
    {
      ownerPersonId: OWNER_B_ID,
      ownerName: 'Berta',
      thumbnailFaceId: null,
      count: 1,
      ownerFaceCount: 88,
      ownerMissing: false,
    },
  ],
```

Then add a new describe block:

```ts
describe('Destination identity', () => {
  const cards = () => screen.getAllByTestId('destination-card');

  it('identifies each destination by thumbnail, name and its own face count', async () => {
    render(Page, { props: { data: makePageData() } });

    await waitFor(() => expect(cards()).toHaveLength(2));
    const first = cards()[0];
    expect(within(first).getByRole('img')).toHaveAttribute('src', '/api/admin/face-repair/faces/thumb-a/thumbnail');
    expect(within(first).getByText('Armin')).toBeInTheDocument();
    expect(translations.some((t) => t.key === 'admin.face_cleanup_review_dest_size' && t.values?.count === 1204)).toBe(
      true,
    );
  });

  it('states the routing share separately from the destination size', async () => {
    render(Page, { props: { data: makePageData() } });

    await waitFor(() => expect(cards()).toHaveLength(2));
    expect(translations.some((t) => t.key === 'admin.face_cleanup_review_dest_routes' && t.values?.count === 2)).toBe(
      true,
    );
  });

  it('links each destination to its cluster page in a new tab, so staged decisions survive', async () => {
    render(Page, { props: { data: makePageData() } });

    await waitFor(() => expect(cards()).toHaveLength(2));
    const link = within(cards()[0]).getByTestId('destination-open');
    expect(link).toHaveAttribute('href', `/admin/face-cleanup/people/${OWNER_A_ID}`);
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'));
  });

  it('lists the largest routing share first and collapses past the third', async () => {
    const many = makeScanPerson({
      suspectedOwners: Array.from({ length: 5 }, (_, i) => ({
        ownerPersonId: `owner-${i}`,
        ownerName: `Owner ${i}`,
        thumbnailFaceId: null,
        count: i + 1,
        ownerFaceCount: 10,
        ownerMissing: false,
      })),
    });
    vi.mocked(getLatestScan).mockResolvedValue(makeCompletedScan([many]) as unknown as object);

    render(Page, { props: { data: makePageData() } });

    await waitFor(() => expect(cards()).toHaveLength(3));
    expect(within(cards()[0]).getByText('Owner 4')).toBeInTheDocument();

    await fireEvent.click(screen.getByTestId('destination-more'));
    await waitFor(() => expect(cards()).toHaveLength(5));
  });

  it('orders two equally-sized destinations deterministically', async () => {
    const tied = makeScanPerson({
      suspectedOwners: [
        {
          ownerPersonId: 'zzz',
          ownerName: 'Zoe',
          thumbnailFaceId: null,
          count: 5,
          ownerFaceCount: 1,
          ownerMissing: false,
        },
        {
          ownerPersonId: 'aaa',
          ownerName: 'Ada',
          thumbnailFaceId: null,
          count: 5,
          ownerFaceCount: 1,
          ownerMissing: false,
        },
      ],
    });
    vi.mocked(getLatestScan).mockResolvedValue(makeCompletedScan([tied]) as unknown as object);

    render(Page, { props: { data: makePageData() } });

    await waitFor(() => expect(cards()).toHaveLength(2));
    expect(within(cards()[0]).getByText('Ada')).toBeInTheDocument();
  });

  it('names no destination at all when the scan could not attribute the faces', async () => {
    const orphan = makeScanPerson({ suspectedOwners: [] });
    vi.mocked(getLatestScan).mockResolvedValue(makeCompletedScan([orphan]) as unknown as object);

    render(Page, { props: { data: makePageData() } });

    await waitFor(() => expect(screen.getByTestId('destination-none')).toBeInTheDocument());
    expect(screen.queryAllByTestId('destination-card')).toHaveLength(0);
    // No card means no destination is named. Do NOT assert that the "unnamed cluster" KEY went untranslated:
    // the page's ownerName/destinationName derivations still fall back to it for the tile ribbons, so that
    // assertion would fail for a reason unrelated to what this test is about.
  });

  it('warns that a destination no longer exists instead of rendering it as usable', async () => {
    const gone = makeScanPerson({
      suspectedOwners: [
        {
          ownerPersonId: OWNER_A_ID,
          ownerName: null,
          thumbnailFaceId: null,
          count: 2,
          ownerFaceCount: 0,
          ownerMissing: true,
        },
      ],
    });
    vi.mocked(getLatestScan).mockResolvedValue(makeCompletedScan([gone]) as unknown as object);

    render(Page, { props: { data: makePageData() } });

    await waitFor(() => expect(screen.getByTestId('destination-gone')).toBeInTheDocument());
    expect(screen.queryByTestId('destination-open')).not.toBeInTheDocument();
  });

  it('renders a placeholder rather than a broken image when a destination has no thumbnail', async () => {
    render(Page, { props: { data: makePageData() } });

    await waitFor(() => expect(cards()).toHaveLength(2));
    // Owner B has thumbnailFaceId: null. The person-scoped fallback 403s for a cluster the admin does not
    // own, so there must be no <img> at all.
    expect(within(cards()[1]).queryByRole('img')).not.toBeInTheDocument();
    expect(within(cards()[1]).getByTestId('destination-placeholder')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run them to confirm they fail**

```bash
cd web && pnpm exec vitest --run 'src/routes/admin/face-cleanup/[personId]/page.spec.ts'
```

Expected: FAIL — `Unable to find an element by: [data-testid="destination-card"]`.

- [ ] **Step 3: Create the shared destination module**

`web/src/routes/admin/face-cleanup/[personId]/destination.ts`:

```ts
// The shape the scan reports for one place a cluster's flagged faces could go. `count` and `ownerFaceCount`
// are different numbers and the console must never print one under the other's label — see
// docs/superpowers/specs/2026-07-29-face-review-destination-identity-design.md (D4).
export interface SuspectedOwner {
  ownerPersonId: string;
  ownerName: string | null;
  thumbnailFaceId: string | null;
  /** Flagged faces on the reviewed cluster routing here (scan-time). */
  count: number;
  /** This destination's own face count (live). */
  ownerFaceCount: number;
  /** The destination person row is gone — deleted or merged since the scan ran. */
  ownerMissing: boolean;
}

/** Largest routing share first. Ties break on id so card order never shuffles between re-renders. */
export const sortDestinations = (owners: SuspectedOwner[]): SuspectedOwner[] =>
  [...owners].sort((a, b) => b.count - a.count || a.ownerPersonId.localeCompare(b.ownerPersonId));

/** Destinations an admin can actually be sent to. A deleted person guarantees a failed resolve. */
export const selectableDestinations = (owners: SuspectedOwner[]): SuspectedOwner[] =>
  sortDestinations(owners).filter((o) => !o.ownerMissing);
```

- [ ] **Step 4: Create the card component**

`web/src/routes/admin/face-cleanup/[personId]/DestinationCards.svelte`:

```svelte
<script lang="ts">
  import { Route } from '$lib/route';
  import { getAdminFaceThumbnailUrl } from '$lib/utils/people-utils';
  import { Icon } from '@immich/ui';
  import { mdiAccount, mdiOpenInNew } from '@mdi/js';
  import { t } from 'svelte-i18n';
  import { sortDestinations, type SuspectedOwner } from './destination';

  // Where the flagged faces would go, as objects rather than a bare name. A suggestion pointing at
  // "Unnamed cluster" with no thumbnail, no size and no way to look at it is unactionable — that is the
  // report this component exists to answer.
  type Props = { owners: SuspectedOwner[] };
  const { owners }: Props = $props();

  const VISIBLE = 3;
  let expanded = $state(false);

  const ordered = $derived(sortDestinations(owners));
  const shown = $derived(expanded ? ordered : ordered.slice(0, VISIBLE));
  const hidden = $derived(ordered.length - shown.length);
</script>

{#if ordered.length === 0}
  <!-- The scan attributed these faces to nobody. Naming a destination here (the old code fell through to
       "Unnamed cluster") describes a person that does not exist. -->
  <p class="text-sm text-gray-500 dark:text-gray-400" data-testid="destination-none">
    {$t('admin.face_cleanup_review_dest_none')}
  </p>
{:else}
  <div class="text-xs font-semibold tracking-wide text-gray-500 uppercase">
    {$t('admin.face_cleanup_review_dest_heading', { values: { count: ordered.length } })}
  </div>
  <ul class="mt-2 flex flex-col gap-2">
    {#each shown as owner (owner.ownerPersonId)}
      <li
        class={[
          'flex items-center gap-3 rounded-xl border px-3 py-2',
          owner.ownerMissing
            ? 'border-red-200 bg-red-50/50 dark:border-red-900/30 dark:bg-red-900/10'
            : 'border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800',
        ].join(' ')}
        data-testid="destination-card"
      >
        {#if owner.thumbnailFaceId}
          <img
            src={getAdminFaceThumbnailUrl(owner.thumbnailFaceId)}
            alt=""
            loading="lazy"
            class="size-10 flex-none rounded-lg bg-gray-100 object-cover dark:bg-gray-700"
          />
        {:else}
          <!-- No representative face. The person-scoped thumbnail route 403s for a cluster the admin does not
               own, so falling back to it would render a broken image on exactly the unnamed clusters this
               feature exists for. -->
          <div
            class="flex size-10 flex-none items-center justify-center rounded-lg bg-gray-100 text-gray-400 dark:bg-gray-700"
            data-testid="destination-placeholder"
          >
            <Icon icon={mdiAccount} size="20" />
          </div>
        {/if}

        <div class="min-w-0 flex-1">
          <div class={owner.ownerName ? 'truncate text-sm font-semibold' : 'truncate text-sm text-gray-400 italic'}>
            {owner.ownerName ?? $t('admin.face_cleanup_review_unnamed')}
          </div>
          {#if owner.ownerMissing}
            <div class="text-xs text-red-600 dark:text-red-400" data-testid="destination-gone">
              {$t('admin.face_cleanup_review_dest_gone')}
            </div>
          {:else}
            <div class="font-mono text-xs text-gray-400">
              {owner.ownerPersonId.slice(0, 8)} ·
              <span class="font-sans">
                {$t('admin.face_cleanup_review_dest_size', { values: { count: owner.ownerFaceCount } })}
              </span>
            </div>
          {/if}
          <div class="text-xs text-gray-500 dark:text-gray-400">
            {$t('admin.face_cleanup_review_dest_routes', { values: { count: owner.count } })}
          </div>
        </div>

        {#if !owner.ownerMissing}
          <!-- New tab, always: every staged decision on the review page lives in memory and a same-tab
               navigation destroys the whole review. -->
          <a
            href={Route.viewFaceCleanupManualPerson({ id: owner.ownerPersonId })}
            target="_blank"
            rel="noopener noreferrer"
            title={$t('admin.face_cleanup_review_dest_open')}
            aria-label={$t('admin.face_cleanup_review_dest_open')}
            class="flex-none rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-700"
            data-testid="destination-open"
          >
            <Icon icon={mdiOpenInNew} size="16" />
          </a>
        {/if}
      </li>
    {/each}
  </ul>
  {#if hidden > 0}
    <button
      type="button"
      onclick={() => (expanded = true)}
      class="mt-2 text-xs font-semibold text-primary hover:underline"
      data-testid="destination-more"
    >
      {$t('admin.face_cleanup_review_dest_more', { values: { count: hidden } })}
    </button>
  {/if}
{/if}
```

- [ ] **Step 5: Wire it into the page**

In `+page.svelte`:

1. Replace the inline `suspectedOwners` member of `interface ScanPerson` (`:42-47`) with `suspectedOwners: SuspectedOwner[];` and import the type:

```ts
import DestinationCards from './DestinationCards.svelte';
import { selectableDestinations, sortDestinations, type SuspectedOwner } from './destination';
```

2. Replace the `primaryOwner` / `ownerName` derivations (`:120-122`) with:

```ts
const destinations = $derived(sortDestinations(scanPerson?.suspectedOwners ?? []));
const selectable = $derived(selectableDestinations(destinations));
// Retained for the tile ribbons and the tally, which name a face's OWN destination; no longer the page's
// single source of truth for where anything goes.
const primaryOwner = $derived(selectable[0] ?? null);
const ownerName = $derived(primaryOwner?.ownerName ?? $t('admin.face_cleanup_review_unnamed'));
const ownerPersonId = $derived(primaryOwner?.ownerPersonId ?? null);
```

3. In the banner (`:489-496`), replace the body paragraph with the cards followed by the actions text:

```svelte
        <div class="flex-1">
          <h3 class="mb-1 text-sm font-semibold">
            {$t('admin.face_cleanup_review_banner_title', { values: { count: flaggedFaces.length } })}
          </h3>
          <div class="mb-3">
            <DestinationCards owners={destinations} />
          </div>
          <p class="text-sm text-gray-600 dark:text-gray-300">
            {$t('admin.face_cleanup_review_banner_body')}
          </p>
        </div>
```

- [ ] **Step 6: Add the English strings**

Add to `i18n/en.json` under `admin`, keeping the file's alphabetical ordering:

```json
    "face_cleanup_review_dest_gone": "This person no longer exists — deleted or merged since the scan.",
    "face_cleanup_review_dest_heading": "{count, plural, one {Destination} other {Destinations}}",
    "face_cleanup_review_dest_more": "+{count, number} more",
    "face_cleanup_review_dest_none": "The scan couldn't attribute these faces to anyone.",
    "face_cleanup_review_dest_open": "Open this cluster in a new tab",
    "face_cleanup_review_dest_routes": "{count, number} flagged faces route here",
    "face_cleanup_review_dest_size": "{count, number} faces",
```

And edit `face_cleanup_review_banner_body` to drop its leading sentence and its only placeholder:

```json
    "face_cleanup_review_banner_body": "Select the exceptions and re-route them: keep here, confirm-lock an age-gap face, send to a different person, park a stranger you can't name, or detach a non-face. Nothing silently re-appears next scan.",
```

- [ ] **Step 7: Run the tests to confirm they pass**

```bash
cd web && pnpm exec vitest --run 'src/routes/admin/face-cleanup/[personId]/page.spec.ts'
```

Expected: PASS — the new describe plus all 42 pre-existing tests.

- [ ] **Step 8: Commit**

```bash
git add web/src/routes/admin/face-cleanup/\[personId\]/ i18n/en.json
git commit -m "feat(face-cleanup): render each suggested destination as an identifiable cluster"
```

---

## Task 4: Web — the destination chooser

**Files:**

- Create: `web/src/routes/admin/face-cleanup/[personId]/DestinationSelect.svelte`
- Modify: `web/src/routes/admin/face-cleanup/[personId]/+page.svelte` (`:269-288` handlers, `:381-387` buildApplyRequest, `:619-651` rest header, `:686-690` rest ribbon, `:730-757` dock tally, `:845-866` confirm)
- Modify: `web/src/routes/admin/face-cleanup/[personId]/PersonPicker.svelte:29-37` (props), `:141-153` (lock block)
- Test: `web/src/routes/admin/face-cleanup/[personId]/page.spec.ts`, `PersonPicker.spec.ts`

**Interfaces:**

- Consumes: `SuspectedOwner`, `selectableDestinations` from Task 3.
- Produces: `DestinationSelect.svelte` props `{ owners: SuspectedOwner[]; value: string | null; onSelect: (ownerPersonId: string) => void; onChooseOther: () => void }`; `PersonPicker` prop `showLock?: boolean` (default `true`).

- [ ] **Step 1: Write the failing tests**

Add to `page.spec.ts`:

```ts
describe('Destination chooser', () => {
  const chooser = () => screen.getByTestId('destination-select') as HTMLSelectElement;
  const restFace = (id: string) => ({ assetFaceId: id });

  beforeEach(() => {
    vi.mocked(getFaceRepairClusterFaces).mockResolvedValue({
      faces: [restFace('rest-1'), restFace('rest-2')],
      total: 2,
      hasMore: false,
    } as unknown as FaceRepairClusterFacesResponseDto);
  });

  it('defaults to the destination most flagged faces route to', async () => {
    render(Page, { props: { data: makePageData() } });
    await waitFor(() => expect(chooser().value).toBe(OWNER_A_ID));
  });

  it("sends staged rest-of-cluster faces to the chosen destination, not the scan's first guess", async () => {
    render(Page, { props: { data: makePageData() } });
    await waitFor(() => expect(screen.getByTestId('select-all-btn')).toBeEnabled());

    await fireEvent.change(chooser(), { target: { value: OWNER_B_ID } });
    await fireEvent.click(screen.getByTestId('select-all-btn'));
    await fireEvent.click(screen.getByTestId('apply-btn'));

    await waitFor(() => expect(resolveFaces).toHaveBeenCalled());
    const request = vi.mocked(resolveFaces).mock.calls[0][0].faceRepairResolveRequestDto;
    const group = request.moveToPerson!.find((g) => g.faceIds.includes('rest-1'))!;
    expect(group.destinationPersonId).toBe(OWNER_B_ID);
  });

  it('re-routes already-staged faces when the destination changes, and says so on the dock chip', async () => {
    render(Page, { props: { data: makePageData() } });
    await waitFor(() => expect(screen.getByTestId('select-all-btn')).toBeEnabled());

    await fireEvent.click(screen.getByTestId('select-all-btn'));
    await waitFor(() => expect(screen.getByTestId('tally-added')).toBeInTheDocument());
    await fireEvent.change(chooser(), { target: { value: OWNER_B_ID } });

    await waitFor(() =>
      expect(
        translations.some((t) => t.key === 'admin.face_cleanup_review_tally_added' && t.values?.name === 'Berta'),
      ).toBe(true),
    );
  });

  it('names the chosen destination in the move-entire confirmation', async () => {
    render(Page, { props: { data: makePageData() } });
    await waitFor(() => expect(screen.getByTestId('move-entire-btn')).toBeEnabled());

    await fireEvent.change(chooser(), { target: { value: OWNER_B_ID } });
    await fireEvent.click(screen.getByTestId('move-entire-btn'));
    await fireEvent.click(screen.getByTestId('entire-confirm-cta'));

    await waitFor(() => expect(resolveFaces).toHaveBeenCalled());
    const request = vi.mocked(resolveFaces).mock.calls[0][0].faceRepairResolveRequestDto;
    expect(request.entireCluster).toEqual({ destinationPersonId: OWNER_B_ID });
    expect(
      translations.some(
        (t) => t.key === 'admin.face_cleanup_review_move_entire_confirm_body' && t.values?.owner === 'Berta',
      ),
    ).toBe(true);
  });

  it('offers no destination that no longer exists', async () => {
    const gone = makeScanPerson({
      suspectedOwners: [
        {
          ownerPersonId: OWNER_A_ID,
          ownerName: 'Armin',
          thumbnailFaceId: null,
          count: 2,
          ownerFaceCount: 0,
          ownerMissing: true,
        },
        {
          ownerPersonId: OWNER_B_ID,
          ownerName: 'Berta',
          thumbnailFaceId: null,
          count: 1,
          ownerFaceCount: 88,
          ownerMissing: false,
        },
      ],
    });
    vi.mocked(getLatestScan).mockResolvedValue(makeCompletedScan([gone]) as unknown as object);

    render(Page, { props: { data: makePageData() } });

    await waitFor(() => expect(chooser()).toBeInTheDocument());
    const values = [...chooser().options].map((o) => o.value);
    expect(values).not.toContain(OWNER_A_ID);
    // …and the default moved on to the surviving suggestion rather than a doomed one.
    expect(chooser().value).toBe(OWNER_B_ID);
  });

  it('leaves both bulk actions disabled until a destination is picked, when none survives', async () => {
    const allGone = makeScanPerson({
      suspectedOwners: [
        {
          ownerPersonId: OWNER_A_ID,
          ownerName: 'Armin',
          thumbnailFaceId: null,
          count: 2,
          ownerFaceCount: 0,
          ownerMissing: true,
        },
      ],
    });
    vi.mocked(getLatestScan).mockResolvedValue(makeCompletedScan([allGone]) as unknown as object);

    render(Page, { props: { data: makePageData() } });

    await waitFor(() => expect(screen.getByTestId('move-entire-btn')).toBeDisabled());
    expect(screen.getByTestId('select-all-btn')).toBeDisabled();
  });

  it('enables the bulk actions on an unattributable cluster once a person is chosen', async () => {
    const orphan = makeScanPerson({ suspectedOwners: [] });
    vi.mocked(getLatestScan).mockResolvedValue(makeCompletedScan([orphan]) as unknown as object);
    showModal.mockResolvedValue({ personId: 'chosen-1', name: 'Chosen', lock: false });

    render(Page, { props: { data: makePageData() } });

    await waitFor(() => expect(screen.getByTestId('move-entire-btn')).toBeDisabled());
    await fireEvent.click(screen.getByTestId('destination-choose-other'));
    await waitFor(() => expect(screen.getByTestId('move-entire-btn')).toBeEnabled());
  });

  it('refuses to move a cluster into itself, explaining why', async () => {
    showModal.mockResolvedValue({ personId: PERSON_ID, name: 'Jula', lock: false });

    render(Page, { props: { data: makePageData() } });
    await waitFor(() => expect(screen.getByTestId('move-entire-btn')).toBeEnabled());

    await fireEvent.click(screen.getByTestId('destination-choose-other'));

    await waitFor(() => expect(screen.getByTestId('move-entire-btn')).toBeDisabled());
    expect(screen.getByTestId('destination-self-warning')).toBeInTheDocument();
  });

  it('reverts the selection when the picker is dismissed without choosing', async () => {
    showModal.mockResolvedValue(undefined);

    render(Page, { props: { data: makePageData() } });
    await waitFor(() => expect(chooser().value).toBe(OWNER_A_ID));

    await fireEvent.click(screen.getByTestId('destination-choose-other'));

    await waitFor(() => expect(chooser().value).toBe(OWNER_A_ID));
  });

  it('opens the destination picker without the re-flag lock it cannot honour', async () => {
    render(Page, { props: { data: makePageData() } });
    await waitFor(() => expect(screen.getByTestId('move-entire-btn')).toBeEnabled());

    await fireEvent.click(screen.getByTestId('destination-choose-other'));

    await waitFor(() => expect(showModal).toHaveBeenCalled());
    const props = showModal.mock.calls.at(-1)![1] as { showLock?: boolean };
    expect(props.showLock).toBe(false);
  });

  it('labels the tally generically when faces are bound for several destinations', async () => {
    render(Page, { props: { data: makePageData() } });

    await waitFor(() => expect(screen.getByTestId('tally')).toBeInTheDocument());
    expect(translations.some((t) => t.key === 'admin.face_cleanup_review_tally_owner_multi')).toBe(true);
  });

  it('keeps naming the owner in the tally when there is only one destination', async () => {
    const single = makeScanPerson({
      suspectedOwners: [
        {
          ownerPersonId: OWNER_A_ID,
          ownerName: 'Armin',
          thumbnailFaceId: null,
          count: 3,
          ownerFaceCount: 12,
          ownerMissing: false,
        },
      ],
    });
    vi.mocked(getLatestScan).mockResolvedValue(makeCompletedScan([single]) as unknown as object);

    render(Page, { props: { data: makePageData() } });

    await waitFor(() => expect(screen.getByTestId('tally')).toBeInTheDocument());
    expect(
      translations.some((t) => t.key === 'admin.face_cleanup_review_tally_owner' && t.values?.name === 'Armin'),
    ).toBe(true);
  });
});
```

And in `PersonPicker.spec.ts`:

```ts
it('offers the re-flag lock by default', async () => {
  render(PersonPicker, { props: { ownerId: 'owner-1', faceCount: 3, onClose: vi.fn() } });
  await waitFor(() => expect(screen.getByTestId('person-picker-lock-toggle')).toBeInTheDocument());
});

it('hides the re-flag lock when the caller cannot honour it', async () => {
  render(PersonPicker, { props: { ownerId: 'owner-1', faceCount: 3, showLock: false, onClose: vi.fn() } });
  await waitFor(() => expect(screen.getByTestId('person-picker-search')).toBeInTheDocument());
  expect(screen.queryByTestId('person-picker-lock-toggle')).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run them to confirm they fail**

```bash
cd web && pnpm exec vitest --run 'src/routes/admin/face-cleanup/[personId]/page.spec.ts' \
  'src/routes/admin/face-cleanup/[personId]/PersonPicker.spec.ts'
```

Expected: FAIL — no `destination-select` element; `showLock` is not a prop.

- [ ] **Step 3: Add `showLock` to PersonPicker**

In `PersonPicker.svelte`, extend the `Props` type (`:29-37`) and destructuring:

```ts
type Props = {
  ownerId: string;
  faceCount: number;
  suggestedPersonId?: string | null;
  // The destination chooser feeds `entireCluster` (no lock field) and rest-staging (hardcoded lock:false),
  // so it opens the picker with the lock hidden rather than showing a toggle its request cannot carry.
  showLock?: boolean;
  onClose: (destination?: PersonPickerDestination) => void;
};

const { ownerId, faceCount, suggestedPersonId = null, showLock = true, onClose }: Props = $props();
```

Wrap the lock block (`:141-153`) in `{#if showLock}` … `{/if}`.

- [ ] **Step 4: Create the select component**

`web/src/routes/admin/face-cleanup/[personId]/DestinationSelect.svelte`:

```svelte
<script lang="ts">
  import { t } from 'svelte-i18n';
  import { selectableDestinations, type SuspectedOwner } from './destination';

  // Where the two whole-cluster actions send faces. Both used to hardcode suspectedOwners[0], which silently
  // overrode the routing of every face the scan attributed to a secondary owner.
  type Props = {
    owners: SuspectedOwner[];
    value: string | null;
    onSelect: (ownerPersonId: string) => void;
    onChooseOther: () => void;
  };
  const { owners, value, onSelect, onChooseOther }: Props = $props();

  const OTHER = '__other__';
  // Deleted destinations are omitted, not disabled: the card above already explains why one is unusable, and
  // an option that guarantees a face-repair:destination-missing failure is only a chance to misclick.
  const options = $derived(selectableDestinations(owners));

  const handleChange = (event: Event) => {
    const next = (event.currentTarget as HTMLSelectElement).value;
    if (next === OTHER) {
      onChooseOther();
      return;
    }
    onSelect(next);
  };
</script>

<label class="flex items-center gap-2 text-sm">
  <span class="text-gray-500 dark:text-gray-400">{$t('admin.face_cleanup_review_dest_send_to')}</span>
  <select
    value={value ?? ''}
    onchange={handleChange}
    class="rounded-lg border border-gray-200 bg-white px-2 py-1 text-sm dark:border-gray-700 dark:bg-gray-800"
    data-testid="destination-select"
  >
    {#if value === null}
      <option value="" disabled>{$t('admin.face_cleanup_review_dest_send_to')}</option>
    {/if}
    {#each options as owner (owner.ownerPersonId)}
      <option value={owner.ownerPersonId}>
        {$t('admin.face_cleanup_review_dest_option', {
          values: { name: owner.ownerName ?? $t('admin.face_cleanup_review_unnamed'), count: owner.ownerFaceCount },
        })}
      </option>
    {/each}
    <option value={OTHER} data-testid="destination-choose-other">
      {$t('admin.face_cleanup_review_dest_choose_other')}
    </option>
  </select>
</label>
```

Note: the `destination-choose-other` test id sits on the `<option>`; `fireEvent.click` on an option does not fire `change` in happy-dom, so the page tests above click it directly and the component must also handle a plain click. Add to the `<option>`:

```svelte
    <option value={OTHER} data-testid="destination-choose-other" onclick={onChooseOther}>
```

- [ ] **Step 5: Wire the chooser into the page**

In `+page.svelte`:

1. Import and add state:

```ts
import DestinationSelect from './DestinationSelect.svelte';
```

```ts
// The destination for the two whole-cluster actions. Defaults to the largest SURVIVING suggestion — a
// deleted one would enable both buttons only to fail at Apply.
let chosenDestinationId = $state<string | null>(null);
let chosenDestinationName = $state<string | null>(null);

const destinationId = $derived(chosenDestinationId ?? selectable[0]?.ownerPersonId ?? null);
const destinationName = $derived(
  chosenDestinationName ??
    selectable.find((o) => o.ownerPersonId === destinationId)?.ownerName ??
    $t('admin.face_cleanup_review_unnamed'),
);
// Moving a cluster into itself would move every face onto the person it already sits on and then delete the
// "empty" original. Scan suggestions can never be this cluster (the engine skips it), but the picker
// searches the whole library, so the guard lives on the action.
const isSelfDestination = $derived(destinationId === personId);
const canBulkMove = $derived(!!destinationId && !isSelfDestination);
```

2. Replace `handleSelectAllRest`'s guard and the two commit paths:

```ts
const handleMoveEntireCluster = () => {
  if (!canBulkMove) {
    return;
  }
  showEntireConfirm = true;
};

const confirmMoveEntireCluster = async () => {
  showEntireConfirm = false;
  if (!canBulkMove || !destinationId) {
    return;
  }
  await commitResolve({ personId, entireCluster: { destinationPersonId: destinationId } });
};
```

3. Replace `buildApplyRequest` (`:381-387`):

```ts
const buildApplyRequest = () =>
  vm.buildResolveRequest(
    personId,
    canBulkMove && destinationId && restSelected.size > 0
      ? { destinationPersonId: destinationId, faceIds: [...restSelected] }
      : undefined,
  );
```

4. Add the picker handler:

```ts
const handleChooseOtherDestination = async () => {
  // Same guard as handleBulkOther: without scanPerson there is no ownerId to scope the picker to.
  if (!scanPerson) {
    return;
  }
  const chosen = await modalManager.show(PersonPicker, {
    ownerId: scanPerson.ownerId,
    faceCount: clusterTotal,
    suggestedPersonId: selectable[0]?.ownerPersonId ?? null,
    showLock: false,
  });
  // Dismissed — leave the current destination exactly as it was.
  if (!chosen) {
    return;
  }
  chosenDestinationId = chosen.personId;
  chosenDestinationName = chosen.name;
};

const handleSelectDestination = (ownerPersonId: string) => {
  chosenDestinationId = ownerPersonId;
  chosenDestinationName = null;
};
```

5. In the rest-section header (`:619-651`), insert the select before the buttons and swap the gates:

```svelte
          <DestinationSelect
            owners={destinations}
            value={destinationId}
            onSelect={handleSelectDestination}
            onChooseOther={handleChooseOtherDestination}
          />
          {#if isSelfDestination}
            <span class="text-xs font-semibold text-red-600 dark:text-red-400" data-testid="destination-self-warning">
              {$t('admin.face_cleanup_review_dest_self')}
            </span>
          {/if}
```

Change `disabled={!ownerPersonId || restFaces.length === 0}` to `disabled={!canBulkMove || restFaces.length === 0}` on `select-all-btn`, and `disabled={!ownerPersonId}` to `disabled={!canBulkMove}` on `move-entire-btn`. Change the rest hint's `{ values: { owner: ownerName } }` to `{ values: { owner: destinationName } }`, and the selected rest-tile ribbon (`:689`) to `{ values: { name: destinationName } }`.

6. Dock chip (`:754-756`) — name the destination:

```svelte
                  <span>+{restSelected.size}</span>
                  <span class="font-normal">
                    {$t('admin.face_cleanup_review_tally_added', { values: { name: destinationName } })}
                  </span>
```

7. Tally owner chip (`:741-743`):

```svelte
                    {state === 'owner'
                      ? destinations.length > 1
                        ? $t('admin.face_cleanup_review_tally_owner_multi')
                        : $t('admin.face_cleanup_review_tally_owner', { values: { name: ownerName } })
                      : $t(`admin.face_cleanup_review_tally_${state}`)}
```

8. Move-entire confirm (`:850-852`, `:859-861`) — use `destinationName`:

```svelte
          {$t('admin.face_cleanup_review_move_entire_confirm_body', {
            values: { count: clusterTotal.toLocaleString(), owner: destinationName },
          })}
```

- [ ] **Step 6: Add the English strings**

```json
    "face_cleanup_review_dest_choose_other": "Choose someone else…",
    "face_cleanup_review_dest_option": "{name} · {count, number} faces",
    "face_cleanup_review_dest_self": "That's the cluster you're reviewing — pick a different destination.",
    "face_cleanup_review_dest_send_to": "Send to",
    "face_cleanup_review_tally_owner_multi": "→ suggested owner",
```

And edit:

```json
    "face_cleanup_review_tally_added": "added → {name}",
```

- [ ] **Step 7: Run the tests to confirm they pass**

```bash
cd web && pnpm exec vitest --run 'src/routes/admin/face-cleanup/[personId]/page.spec.ts' \
  'src/routes/admin/face-cleanup/[personId]/PersonPicker.spec.ts'
```

Expected: PASS. The pre-existing "Move entire cluster: confirming the modal calls resolveFaces with entireCluster" test (`:936`) must still pass — it asserts `OWNER_A_ID`, which is still the default.

- [ ] **Step 8: Commit**

```bash
git add web/src/routes/admin/face-cleanup/\[personId\]/ i18n/en.json
git commit -m "feat(face-cleanup): let the admin choose where whole-cluster moves send faces"
```

---

## Task 5: Web — the dashboard destination column

**Files:**

- Modify: `web/src/routes/admin/face-cleanup/scan/ReviewFirstLane.svelte:160-172`
- Modify: `web/src/routes/admin/face-cleanup/scan/scan-triage.svelte.ts:14`
- Test: `web/src/routes/admin/face-cleanup/scan/ReviewFirstLane.spec.ts`

**Interfaces:**

- Consumes: `ownerFaceCount` from Task 1.
- Produces: nothing downstream.

- [ ] **Step 1: Write the failing tests**

Extend the `rev` fixture in `ReviewFirstLane.spec.ts:50` so its suspected owner carries the new fields:

```ts
  suspectedOwners: [
    { ownerPersonId: 'd', ownerName: 'Pierre', thumbnailFaceId: 'f', count: 20, ownerFaceCount: 1204, ownerMissing: false },
  ],
```

Add:

```ts
describe('destination column', () => {
  it("shows the destination's own size beneath its name, not the number of faces routing there", () => {
    render(ReviewFirstLane, { props: { people: [rev({ personId: 'p1' })], users, onDismiss: vi.fn() } });

    expect(screen.getByText(/1,204/)).toBeInTheDocument();
    expect(screen.queryByText(/^20 /)).not.toBeInTheDocument();
  });

  it('keeps the bad-target warning in place of the count', () => {
    render(ReviewFirstLane, {
      props: { people: [rev({ personId: 'p1', reviewReasons: ['bad-target'] })], users, onDismiss: vi.fn() },
    });

    expect(screen.getByText('admin.face_cleanup_bad_target')).toBeInTheDocument();
    expect(screen.queryByText(/1,204/)).not.toBeInTheDocument();
  });

  it('puts the routing share in the row tooltip', () => {
    render(ReviewFirstLane, { props: { people: [rev({ personId: 'p1' })], users, onDismiss: vi.fn() } });

    expect(screen.getByTestId('review-destination-p1')).toHaveAttribute('title', expect.stringContaining('20'));
  });
});
```

- [ ] **Step 2: Run them to confirm they fail**

```bash
cd web && pnpm exec vitest --run src/routes/admin/face-cleanup/scan/ReviewFirstLane.spec.ts
```

Expected: FAIL — `1,204` is not rendered; there is no `review-destination-p1` element.

- [ ] **Step 3: Update the type**

In `scan-triage.svelte.ts:14`, extend the suspected-owner shape:

```ts
suspectedOwners: {
  ownerPersonId: string;
  ownerName: string | null;
  thumbnailFaceId: string | null;
  count: number;
  ownerFaceCount: number;
  ownerMissing: boolean;
}
[];
```

- [ ] **Step 4: Update the column**

Replace the destination column block (`ReviewFirstLane.svelte:160-172`):

```svelte
            <div
              class="{COL_DEST} items-center gap-2"
              title={dest
                ? `${dest.count} ${$t('admin.face_cleanup_faces')} → ${dest.ownerName ?? $t('admin.face_cleanup_unnamed')}`
                : undefined}
              data-testid={`review-destination-${person.personId}`}
            >
              {#if dest}
                <Icon icon={mdiArrowRight} size="16" class="flex-none text-gray-300" />
                <div class="min-w-0">
                  <div class="truncate text-sm font-semibold">{dest.ownerName ?? $t('admin.face_cleanup_unnamed')}</div>
                  <!-- The destination's OWN size. This used to print `dest.count` — the flagged faces routing
                       here — directly under the destination's name, which read as "this cluster has 1 face". -->
                  <div class={bad ? 'text-xs text-red-500' : 'text-xs text-green-600'}>
                    {bad
                      ? $t('admin.face_cleanup_bad_target')
                      : `${dest.ownerFaceCount.toLocaleString()} ${$t('admin.face_cleanup_faces')}`}
                  </div>
                </div>
              {:else}
                <span class="text-xs text-gray-400">{$t('admin.face_cleanup_unattributable')}</span>
              {/if}
            </div>
```

- [ ] **Step 5: Run the tests to confirm they pass**

```bash
cd web && pnpm exec vitest --run src/routes/admin/face-cleanup/scan/ReviewFirstLane.spec.ts \
  src/routes/admin/face-cleanup/scan/page.spec.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add web/src/routes/admin/face-cleanup/scan/
git commit -m "fix(face-cleanup): show the destination's own size in the dashboard, not its routing share"
```

---

## Task 6: Translations and the full gate

**Files:**

- Modify: `i18n/{de,fr,es,it,nl,pl,ru,zh_Hans,zh_Hant}.json`
- Test: `web/src/lib/i18n/placeholders.spec.ts` (existing; no edits)

**Interfaces:**

- Consumes: the `en.json` keys added in Tasks 3 and 4.
- Produces: nothing.

- [ ] **Step 1: Watch the existing guard go red**

`placeholders.spec.ts` asserts no locale references a placeholder `en.json` does not supply. Tasks 3 and 4 removed `{ownerName}` from `banner_body`, so every locale that still interpolates it is now broken.

```bash
cd web && pnpm exec vitest --run src/lib/i18n/placeholders.spec.ts
```

Expected: FAIL for de, fr, es, it, nl, pl, ru, zh_Hans, zh_Hant — each reporting `banner_body` references `ownerName`.

- [ ] **Step 2: Translate**

For each of the nine locales, add the twelve new keys and update the two edited ones. Reuse the terminology each locale already established for this console (German _Gesichtsbereinigung_ / _Cluster_, French _Nettoyage des visages_ / _groupe_, Spanish _grupo_, Italian _gruppo_, Chinese 聚类 / 叢集). Requirements:

- `face_cleanup_review_banner_body` — drop the leading "Default is → {ownerName}." sentence; keep the rest.
- `face_cleanup_review_tally_added` — must interpolate `{name}`.
- `face_cleanup_review_dest_heading` — a real plural for the locale: pl/ru need `one/few/many/other`, zh needs `one/other`, the rest `one/other`.
- `face_cleanup_review_dest_more`, `_dest_size`, `_dest_routes`, `_dest_option` — keep the `{count, number}` type so digits stay locale-formatted.

- [ ] **Step 3: Run the guard to confirm it passes**

```bash
cd web && pnpm exec vitest --run src/lib/i18n/placeholders.spec.ts
```

Expected: PASS for every locale.

- [ ] **Step 4: Run the full web and server gates**

```bash
cd web && pnpm check:typescript && pnpm check:svelte && pnpm lint && pnpm test --run
cd ../server && pnpm lint && pnpm exec prettier --check . && pnpm test --run
```

Expected: all green. `prettier --check .` is a **separate CI gate** from eslint — a clean `pnpm lint` says nothing about it.

- [ ] **Step 5: Format the docs**

```bash
cd docs && pnpm exec prettier --write ../docs/superpowers/specs/2026-07-29-face-review-destination-identity-design.md \
  ../docs/superpowers/plans/2026-07-29-face-review-destination-identity.md
```

- [ ] **Step 6: Commit and push**

```bash
git add i18n/ docs/
git commit -m "feat(i18n): translate the face-cleanup destination card into all nine supported locales"
git push
```

- [ ] **Step 7: Watch CI**

PR #834 auto-runs on push (`pull_request` event). Watch it green before calling this done.

```bash
gh run list --branch feat/face-review-unified --limit 10
```

---

## Manual verification

Run against a real library — the reported case is a 2,952-face cluster flagging 2,382 faces toward one owner.

1. Open a flagged cluster whose destination is an unnamed cluster: the card shows a thumbnail, the short id, the destination's own face count, and the routing share.
2. `[open ↗]` opens the destination's manual review page in a **new tab**; return to the original tab and confirm every staged decision survived.
3. On a cluster with several suspected owners: all destinations are listed, and switching the chooser changes where the rest-of-cluster faces go — the dock chip following along.
4. On an unattributable cluster: the banner says so and names nobody; choosing a person enables the bulk actions.
5. Pick the reviewed cluster itself via `Choose someone else…`: both bulk actions disable with a reason.
6. Delete the destination person, reload: the card says it no longer exists, it is gone from the chooser, and the default has moved on.
7. German UI: every new string is translated — no raw keys, no English fallbacks, no literal `{braces}`.
8. Dashboard review lane: the number under the destination name is the destination's size; the routing share is in the row tooltip.
