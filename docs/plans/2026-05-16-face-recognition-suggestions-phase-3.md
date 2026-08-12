# Face Recognition Suggestions — Phase 3 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Expose the auto-generated suggestions over a documented, owner-only HTTP API —
`GET /people/:id/face-suggestions` (paginated + total), `POST …/:assetFaceId/confirm`,
`POST …/:assetFaceId/dismiss` — with full DTOs, idempotency, the resolve-on-assign hook wired
into the existing manual-reassign paths (merge needs **no** code — covered by the Phase-1 FK
`ON DELETE CASCADE` invariant), and regenerated OpenAPI (TS + Dart) + SQL. **No web UI.**

**Architecture:** Three fork endpoints on the existing `PersonController`. GET reuses the
Phase-1 `getPendingForPerson` read (extended in this phase to also return the face bounding
box + asset id + dimensions for the full-photo modal) behind a `Permission.PersonRead`
owner-only check; its band + scannable + feature-off read-gate is already enforced in the
repository (edge 7). Confirm flips the row `pending → confirmed` _then_ delegates to the
existing `PersonService.reassignFacesById` (assign + `manual` identity + feature photo); the
resolve-on-assign delete embedded in the reassign path then clears every other person's still-
`pending` row for that now-assigned face (edge 12). Dismiss is a status-guarded
`pending → dismissed` update; the face stays unassigned and the Phase-1 conditional
`upsertPending` guarantees a later scan never recreates it. All three are idempotent (status-
guarded; 0 rows → still 200) and owner-only (presence **and** absence asserted).

**Tech Stack:** NestJS controllers + `@Endpoint`/`@Authenticated`, Zod DTOs
(`createZodDto`), Kysely (`@GenerateSql`-decorated repository methods), Vitest unit tests
(`newTestService` auto-mock factory), Vitest medium tests (testcontainers Postgres), Vitest
API e2e (`e2e/`), generated `@immich/sdk` (TS) + Dart OpenAPI client.

**Design reference:** `docs/plans/2026-05-15-face-recognition-suggestions-design.md`
(Architecture → "HTTP API"; "Lifecycle & state transitions"; "Authorization"; Edge cases).
**Phase 1 output this builds on:** `PersonFaceSuggestionRepository.getPendingForPerson`
(band + scannable + feature-off read-gate), `.upsertPending` (never-resurrect conditional
upsert), `.resolveAssignedFace` (pending-only delete for an assigned face),
`facialRecognition.suggestionMaxDistance` config. **Phase 2 output:** suggestions are already
generated automatically by the scan jobs — Phase 3 only reads/mutates the rows they produce.

**Edge cases covered by this phase:** 7 (API read gate), 8, 9, 10, 11, 12, 18.
**Out of scope (Phase 4+):** `PersonSuggestionBanner.svelte` /
`PersonSuggestionReviewModal.svelte`, localStorage snooze, Playwright web E2E, shared-space
suggestions (Phase 5), mobile (Phase 6).

**Conventions for every task:** strict TDD (write the failing test, run it, watch it fail for
the expected reason, write the minimal code, run it green, commit). No `--no-verify`. Run all
commands from `/home/pierre/dev/gallery/.worktrees/face-recognition-suggestions`. Server
commands run in `server/`.

- Unit test: `cd server && pnpm test -- --run <file>`
- Medium test (real Postgres via testcontainers): `cd server && pnpm test:medium -- --run <file>`
- Type check: `make check-server`
- API e2e: `cd e2e && pnpm test -- --run <file>` (needs the e2e stack — see Task 8)

Phase 3 **adds a controller + DTOs and adds/changes `@GenerateSql` repository methods**, so the
generated-file regeneration (TS SDK **and** Dart client **and** `make sql`) is mandatory and
is Task 8 — CI fails otherwise (memory `feedback_openapi_dart_and_sql`,
`feedback_ci_generated_files`). Commit messages use neutral wording — owner-only access is an
access-scoping change, **not** framed as a security fix (memory `feedback_no_security_in_commits`).

---

## Confirm flow (the crux — read before Task 5/6)

```
POST /people/:id/face-suggestions/:assetFaceId/confirm
  → requireAccess(PersonUpdate, [id])           # owner-only — BEFORE any write (edge 18 absence;
  →                                             #   also: deleted person → 400 here, edges 9/10)
  → requireAccess(PersonCreate, [assetFaceId])  # owner-only on the face (deleted face → 400 here,
  →                                             #   edges 9/10); same access reassignFacesById re-checks
  → n = markConfirmed(id, assetFaceId)          # WHERE status='pending' → 'confirmed'
  → if n === 0: return                          # idempotent: row already confirmed/dismissed while
  →                                             #   person+face still exist (double-submit / racing scan)
  → reassignFacesById(auth, id, { id: assetFaceId })
        # assigns face, replaceFaceIdentity(..,'manual'), createNewFeaturePhoto if faceAssetId null,
        # AND (Task 5) the embedded resolveAssignedFace(assetFaceId) deletes every OTHER
        # person's still-`pending` row for this now-assigned face (edge 12). This person's
        # row is already 'confirmed' (set above) so the pending-only delete leaves it intact.
  → 200 (void body)
```

`markConfirmed` runs **before** `reassignFacesById` precisely so the embedded
`resolveAssignedFace` (a `WHERE status='pending'` delete) cannot wipe the row we are
confirming. Order matters; do not reorder.

---

### Task 1: Suggestion DTOs (Zod schemas + param schema)

**Files:**

- Modify: `server/src/dtos/person.dto.ts` (add schemas + classes near
  `PersonFacePageResponseSchema`, ~line 178-188; mirror its `createZodDto` style exactly)
- Create: `server/src/dtos/person-face-suggestion.dto.spec.ts`

**Step 1: Write the failing test**

Create `server/src/dtos/person-face-suggestion.dto.spec.ts`:

```ts
import {
  PersonFaceSuggestionPageQuerySchema,
  PersonFaceSuggestionPageResponseSchema,
  PersonFaceSuggestionParamsSchema,
} from 'src/dtos/person.dto';
import { describe, expect, it } from 'vitest';

describe('PersonFaceSuggestion DTOs', () => {
  it('query schema coerces and defaults page/size', () => {
    expect(PersonFaceSuggestionPageQuerySchema.parse({})).toEqual({ page: 1, size: 50 });
    expect(PersonFaceSuggestionPageQuerySchema.parse({ page: '2', size: '10' })).toEqual({ page: 2, size: 10 });
  });

  it('query schema rejects size > 100 and page < 1', () => {
    expect(() => PersonFaceSuggestionPageQuerySchema.parse({ size: 101 })).toThrow();
    expect(() => PersonFaceSuggestionPageQuerySchema.parse({ page: 0 })).toThrow();
  });

  it('params schema requires two uuids', () => {
    expect(() => PersonFaceSuggestionParamsSchema.parse({ id: 'not-a-uuid', assetFaceId: 'x' })).toThrow();
    const ok = PersonFaceSuggestionParamsSchema.parse({
      id: '00000000-0000-4000-8000-000000000001',
      assetFaceId: '00000000-0000-4000-8000-000000000002',
    });
    expect(ok.assetFaceId).toBe('00000000-0000-4000-8000-000000000002');
  });

  it('page response schema accepts a fully-populated item', () => {
    const parsed = PersonFaceSuggestionPageResponseSchema.parse({
      total: 1,
      items: [
        {
          assetFaceId: '00000000-0000-4000-8000-000000000003',
          assetId: '00000000-0000-4000-8000-000000000004',
          distance: 0.62,
          imageWidth: 4000,
          imageHeight: 3000,
          boundingBoxX1: 10,
          boundingBoxX2: 110,
          boundingBoxY1: 20,
          boundingBoxY2: 140,
          fileCreatedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    });
    expect(parsed.total).toBe(1);
    expect(parsed.items[0].distance).toBe(0.62);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd server && pnpm test -- --run src/dtos/person-face-suggestion.dto.spec.ts`
Expected: FAIL — the three schemas are not exported from `src/dtos/person.dto.ts`.

**Step 3: Write minimal implementation**

In `server/src/dtos/person.dto.ts`, immediately after the
`export class PersonFacePageResponseDto extends createZodDto(PersonFacePageResponseSchema) {}`
line (~188), add:

```ts
export const PersonFaceSuggestionPageQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1).describe('Page number'),
    size: z.coerce.number().int().min(1).max(100).default(50).describe('Number of suggestions per page'),
  })
  .meta({ id: 'PersonFaceSuggestionPageQueryDto' });

export const PersonFaceSuggestionParamsSchema = z
  .object({
    id: z.uuidv4().describe('Person ID'),
    assetFaceId: z.uuidv4().describe('Unassigned asset face ID being reviewed'),
  })
  .meta({ id: 'PersonFaceSuggestionParamsDto' });

export const PersonFaceSuggestionResponseSchema = z
  .object({
    assetFaceId: z.uuidv4().describe('Unassigned asset face ID'),
    assetId: z.uuidv4().describe('Asset ID containing the candidate face'),
    distance: z.number().meta({ format: 'double' }).describe('Embedding distance to the person'),
    imageWidth: z.int().min(0).describe('Image width in pixels'),
    imageHeight: z.int().min(0).describe('Image height in pixels'),
    boundingBoxX1: z.int().describe('Bounding box X1 coordinate'),
    boundingBoxX2: z.int().describe('Bounding box X2 coordinate'),
    boundingBoxY1: z.int().describe('Bounding box Y1 coordinate'),
    boundingBoxY2: z.int().describe('Bounding box Y2 coordinate'),
    fileCreatedAt: z.string().meta({ format: 'date-time' }).optional().describe('Asset creation date'),
  })
  .meta({ id: 'PersonFaceSuggestionResponseDto' });

export const PersonFaceSuggestionPageResponseSchema = z
  .object({
    total: z.int().min(0).describe('Total in-band pending suggestions for this person'),
    items: z.array(PersonFaceSuggestionResponseSchema),
  })
  .meta({ id: 'PersonFaceSuggestionPageResponseDto' });

export class PersonFaceSuggestionPageQueryDto extends createZodDto(PersonFaceSuggestionPageQuerySchema) {}
export class PersonFaceSuggestionParamsDto extends createZodDto(PersonFaceSuggestionParamsSchema) {}
export class PersonFaceSuggestionResponseDto extends createZodDto(PersonFaceSuggestionResponseSchema) {}
export class PersonFaceSuggestionPageResponseDto extends createZodDto(PersonFaceSuggestionPageResponseSchema) {}
```

`z` and `createZodDto` are already imported at the top of `person.dto.ts` (the file is built
entirely on them). No new imports.

**Step 4: Run test to verify it passes**

Run: `cd server && pnpm test -- --run src/dtos/person-face-suggestion.dto.spec.ts`
Then: `make check-server`
Expected: PASS (4 tests); no type errors.

**Step 5: Commit**

```bash
git add server/src/dtos/person.dto.ts server/src/dtos/person-face-suggestion.dto.spec.ts
git commit -m "feat(server): add person face-suggestion API DTOs"
```

---

### Task 2: Repository `markConfirmed` + `markDismissed` (idempotent, status-guarded)

Two status-guarded `UPDATE … WHERE status='pending'` statements returning the affected-row
count so the service can branch on idempotency. Mirror the existing `resolveAssignedFace`
`@GenerateSql` style in the same file.

**Files:**

- Modify: `server/src/repositories/person-face-suggestion.repository.ts` (add both methods
  after `resolveAssignedFace`, before `getPendingForPerson`)
- Modify: `server/test/medium/specs/repositories/person-face-suggestion.repository.spec.ts`
  (append a `describe`)

**Step 1: Write the failing test**

Append to `server/test/medium/specs/repositories/person-face-suggestion.repository.spec.ts`
(reuse the file's existing `setup`, `defaultDatabase`, the `personId`/`assetFaceId` seeding
beforeEach, and the `getRow` helper introduced in Phase 1 Task 6):

```ts
describe('markConfirmed / markDismissed (idempotent, status-guarded)', () => {
  it('markConfirmed flips a pending row to confirmed and returns 1; re-running returns 0', async () => {
    const { sut } = setup();
    await sut.upsertPending([{ personId, assetFaceId, distance: 0.6 }]);

    expect(await sut.markConfirmed(personId, assetFaceId)).toBe(1);
    expect((await getRow(personId, assetFaceId)).status).toBe('confirmed');

    // idempotent: already confirmed → no pending row → 0 affected, status unchanged
    expect(await sut.markConfirmed(personId, assetFaceId)).toBe(0);
    expect((await getRow(personId, assetFaceId)).status).toBe('confirmed');
  });

  it('markDismissed flips a pending row to dismissed and returns 1; re-running returns 0', async () => {
    const { sut } = setup();
    await sut.upsertPending([{ personId, assetFaceId, distance: 0.6 }]);

    expect(await sut.markDismissed(personId, assetFaceId)).toBe(1);
    expect((await getRow(personId, assetFaceId)).status).toBe('dismissed');

    expect(await sut.markDismissed(personId, assetFaceId)).toBe(0);
    expect((await getRow(personId, assetFaceId)).status).toBe('dismissed');
  });

  it('markConfirmed does not override a dismissed row and vice-versa (status guard)', async () => {
    const { sut } = setup();
    await sut.upsertPending([{ personId, assetFaceId, distance: 0.6 }]);
    await sut.markDismissed(personId, assetFaceId);

    expect(await sut.markConfirmed(personId, assetFaceId)).toBe(0);
    expect((await getRow(personId, assetFaceId)).status).toBe('dismissed');
  });

  it('returns 0 for a (personId, assetFaceId) pair that has no row (benign idempotent)', async () => {
    const { sut } = setup();
    expect(await sut.markConfirmed(personId, assetFaceId)).toBe(0);
    expect(await sut.markDismissed(personId, assetFaceId)).toBe(0);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd server && pnpm test:medium -- --run test/medium/specs/repositories/person-face-suggestion.repository.spec.ts`
Expected: FAIL — `sut.markConfirmed is not a function`.

**Step 3: Write minimal implementation**

In `server/src/repositories/person-face-suggestion.repository.ts`, add after
`resolveAssignedFace` (and before `getPendingForPerson`):

```ts
  @GenerateSql({ params: [DummyValue.UUID, DummyValue.UUID] })
  async markConfirmed(personId: string, assetFaceId: string): Promise<number> {
    const result = await this.db
      .updateTable('person_face_suggestion')
      .set({ status: 'confirmed' })
      .where('personId', '=', personId)
      .where('assetFaceId', '=', assetFaceId)
      .where('status', '=', 'pending')
      .executeTakeFirst();
    return Number(result.numUpdatedRows ?? 0n);
  }

  @GenerateSql({ params: [DummyValue.UUID, DummyValue.UUID] })
  async markDismissed(personId: string, assetFaceId: string): Promise<number> {
    const result = await this.db
      .updateTable('person_face_suggestion')
      .set({ status: 'dismissed' })
      .where('personId', '=', personId)
      .where('assetFaceId', '=', assetFaceId)
      .where('status', '=', 'pending')
      .executeTakeFirst();
    return Number(result.numUpdatedRows ?? 0n);
  }
```

`DummyValue` and `GenerateSql` are already imported in this file (used by `upsertPending`).
The `updatedAt` column is bumped automatically by the Phase-1 `person_face_suggestion_updatedAt`
trigger, so the `.set` only needs `status`.

**Step 4: Run test to verify it passes**

Run: `cd server && pnpm test:medium -- --run test/medium/specs/repositories/person-face-suggestion.repository.spec.ts`
Expected: PASS (4 new tests; the Phase-1 suite in this file still green).

**Step 5: Commit**

```bash
git add server/src/repositories/person-face-suggestion.repository.ts server/test/medium/specs/repositories/person-face-suggestion.repository.spec.ts
git commit -m "feat(server): add status-guarded markConfirmed/markDismissed for suggestions"
```

---

### Task 3: Enrich `getPendingForPerson` with asset id, bounding box & dimensions

The Phase-1 read returns only `{ assetFaceId, distance }`. The review modal needs the full
photo + the candidate face box. Extend the **existing** `getPendingForPerson` (the design's
Phase-1 note says this method is "wired by Phase 3") to also select the `asset_face`
bounding box + image dimensions + `assetId` and the `asset.fileCreatedAt`, by adding an
`asset` join to the query that already joins `asset_face as af`. The read-gate, band filter,
ordering, pagination and `total` are unchanged.

**Files:**

- Modify: `server/src/repositories/person-face-suggestion.repository.ts` (`getPendingForPerson`)
- Modify: `server/test/medium/specs/repositories/person-face-suggestion.repository.spec.ts`
  (extend the existing `getPendingForPerson (band read + read gate)` describe with one test;
  keep the Phase-1 tests untouched)

**Step 1: Write the failing test**

Add this test inside the existing
`describe('getPendingForPerson (band read + read gate)')` block (it reuses that block's
`maxDistance`/`suggestionMaxDistance` constants and the Phase-1 seeded `personPId` whose
in-band pending faces carry known bounding boxes — assert on whatever the Phase-1 seed sets;
if the Phase-1 seed does not set explicit bbox/dimensions, set them on the seeded
`asset_face` rows in that block's `beforeEach` so the values are deterministic):

```ts
it('returns the asset id, bounding box and dimensions for each in-band pending item', async () => {
  const { sut } = setup();
  const res = await sut.getPendingForPerson(personPId, { maxDistance, suggestionMaxDistance, page: 1, size: 10 });

  expect(res.total).toBe(2);
  for (const item of res.items) {
    expect(item.assetId).toEqual(expect.any(String));
    expect(item.imageWidth).toBeGreaterThan(0);
    expect(item.imageHeight).toBeGreaterThan(0);
    expect(typeof item.boundingBoxX1).toBe('number');
    expect(typeof item.boundingBoxX2).toBe('number');
    expect(typeof item.boundingBoxY1).toBe('number');
    expect(typeof item.boundingBoxY2).toBe('number');
  }
  // still ordered by distance ascending (Phase-1 contract preserved)
  expect(res.items.map((i) => i.distance)).toEqual([0.6, 0.7]);
});
```

**Step 2: Run test to verify it fails**

Run: `cd server && pnpm test:medium -- --run test/medium/specs/repositories/person-face-suggestion.repository.spec.ts`
Expected: FAIL — `item.assetId` / `item.imageWidth` / `item.boundingBoxX1` are `undefined`
(the SELECT only returns `assetFaceId`, `distance`).

**Step 3: Write minimal implementation**

In `getPendingForPerson`, the query already does
`.innerJoin('asset_face as af', 'af.id', 'pfs.assetFaceId')`. Add an `asset` join and widen
the items SELECT. Replace the `base` builder and the `items` query with:

```ts
const base = this.db
  .selectFrom('person_face_suggestion as pfs')
  .innerJoin('asset_face as af', 'af.id', 'pfs.assetFaceId')
  .innerJoin('asset', 'asset.id', 'af.assetId')
  .where('pfs.personId', '=', personId)
  .where('pfs.status', '=', 'pending')
  .where('pfs.distance', '>', opts.maxDistance)
  .where('pfs.distance', '<=', opts.suggestionMaxDistance)
  .where('af.personId', 'is', null)
  .where('af.deletedAt', 'is', null);

const totalRow = await base.select((eb) => eb.fn.countAll<string>().as('total')).executeTakeFirstOrThrow();

const items = await base
  .select([
    'pfs.assetFaceId as assetFaceId',
    'pfs.distance as distance',
    'af.assetId as assetId',
    'af.imageWidth as imageWidth',
    'af.imageHeight as imageHeight',
    'af.boundingBoxX1 as boundingBoxX1',
    'af.boundingBoxX2 as boundingBoxX2',
    'af.boundingBoxY1 as boundingBoxY1',
    'af.boundingBoxY2 as boundingBoxY2',
    'asset.fileCreatedAt as fileCreatedAt',
  ])
  .orderBy('pfs.distance', 'asc')
  .limit(opts.size)
  .offset((opts.page - 1) * opts.size)
  .execute();

return { total: Number(totalRow.total), items };
```

**Remove** the explicit `Promise<{ total: number; items: Array<{ assetFaceId: string;
distance: number }> }>` return-type annotation that Phase 1 put on `getPendingForPerson`
(the `): Promise<{ ... }> {` line) and replace it with no annotation — let TypeScript infer
the return type from the (unchanged) two read-gate early returns + the widened final return:

```ts
  async getPendingForPerson(
    personId: string,
    opts: { maxDistance: number; suggestionMaxDistance: number; page: number; size: number },
  ) {
```

> **Why not hand-type it (verified correctness fix):** `asset.fileCreatedAt` is declared
> `Timestamp` in `src/schema/tables/asset.table.ts:88` (a branded sql-tools type, **not**
> `Date`). A hand-written `fileCreatedAt: Date` does **not** structurally match Kysely's
> inferred `.execute()` row, so the `return { total, items }` line fails `make check-server`.
> Letting inference flow keeps the signature correct without coupling it to the branded
> column type. The Task-4 service mapper consumes it via `asDateString(item.fileCreatedAt)`,
> which is generic over `Date | string | undefined | null` and accepts the branded
> `Timestamp` safely (this is exactly how the sibling `getFacesForPicker` at
> `person.service.ts:311` already handles `asset.fileCreatedAt`).

Leave the two read-gate early returns (`return { total: 0, items: [] }`) exactly as-is —
under inference the function return type is the union of those and the final return; `[]` is
assignable, and a destructured `items.map(...)` in the caller still yields the populated
element type.

**Step 4: Run test to verify it passes + Phase-1 regression**

Run: `cd server && pnpm test:medium -- --run test/medium/specs/repositories/person-face-suggestion.repository.spec.ts`
Expected: PASS for the new test **and** every pre-existing test in this file (the Phase-1
band-read tests only assert `res.total` and `res.items.map((i) => i.distance)` and the
gate `toEqual({ total: 0, items: [] })`, all unaffected by extra item fields). Then
`make check-server` → no type errors.

**Step 5: Commit**

```bash
git add server/src/repositories/person-face-suggestion.repository.ts server/test/medium/specs/repositories/person-face-suggestion.repository.spec.ts
git commit -m "feat(server): return asset/bbox metadata from getPendingForPerson"
```

---

### Task 4: Service `getFaceSuggestions` — owner-only paginated GET

**Files:**

- Modify: `server/src/services/person.service.ts` (new method; place it next to `getById`,
  ~after line 287)
- Modify: `server/src/services/person.service.spec.ts` (new `describe('getFaceSuggestions')`)

**Step 1: Write the failing test**

Add a `describe` to `server/src/services/person.service.spec.ts` (mirror the auth/access
mock style used by `describe('getById')` / `describe('reassignFacesById')` —
`AuthFactory.create()`, `mocks.access.person.checkOwnerAccess`, and the config-mock style
from Phase 2 specs):

```ts
describe('getFaceSuggestions', () => {
  const enabled = {
    machineLearning: { facialRecognition: { maxDistance: 0.5, suggestionMaxDistance: 0.8, minFaces: 3 } },
  };

  it('denies a non-owner with no state change (edge 18 absence)', async () => {
    mocks.systemMetadata.get.mockResolvedValue(enabled);
    mocks.access.person.checkOwnerAccess.mockResolvedValue(new Set()); // not the owner

    await expect(
      sut.getFaceSuggestions(AuthFactory.create(), 'person-1', { page: 1, size: 50 }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(mocks.personFaceSuggestion.getPendingForPerson).not.toHaveBeenCalled();
  });

  it('returns total + mapped items for the owner', async () => {
    mocks.systemMetadata.get.mockResolvedValue(enabled);
    mocks.access.person.checkOwnerAccess.mockResolvedValue(new Set(['person-1']));
    mocks.personFaceSuggestion.getPendingForPerson.mockResolvedValue({
      total: 1,
      items: [
        {
          assetFaceId: 'face-1',
          distance: 0.62,
          assetId: 'asset-1',
          imageWidth: 4000,
          imageHeight: 3000,
          boundingBoxX1: 1,
          boundingBoxX2: 2,
          boundingBoxY1: 3,
          boundingBoxY2: 4,
          fileCreatedAt: new Date('2026-01-01T00:00:00.000Z'),
        },
      ],
    });

    const res = await sut.getFaceSuggestions(AuthFactory.create(), 'person-1', { page: 1, size: 50 });

    expect(mocks.personFaceSuggestion.getPendingForPerson).toHaveBeenCalledWith('person-1', {
      maxDistance: 0.5,
      suggestionMaxDistance: 0.8,
      page: 1,
      size: 50,
    });
    expect(res).toEqual({
      total: 1,
      items: [
        {
          assetFaceId: 'face-1',
          assetId: 'asset-1',
          distance: 0.62,
          imageWidth: 4000,
          imageHeight: 3000,
          boundingBoxX1: 1,
          boundingBoxX2: 2,
          boundingBoxY1: 3,
          boundingBoxY2: 4,
          fileCreatedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    });
  });

  it('passes the feature-off config through so the repository read-gate returns empty (edge 7)', async () => {
    mocks.systemMetadata.get.mockResolvedValue({
      machineLearning: { facialRecognition: { maxDistance: 0.5, suggestionMaxDistance: 0, minFaces: 3 } },
    });
    mocks.access.person.checkOwnerAccess.mockResolvedValue(new Set(['person-1']));
    mocks.personFaceSuggestion.getPendingForPerson.mockResolvedValue({ total: 0, items: [] });

    const res = await sut.getFaceSuggestions(AuthFactory.create(), 'person-1', { page: 1, size: 50 });

    expect(mocks.personFaceSuggestion.getPendingForPerson).toHaveBeenCalledWith('person-1', {
      maxDistance: 0.5,
      suggestionMaxDistance: 0,
      page: 1,
      size: 50,
    });
    expect(res).toEqual({ total: 0, items: [] });
  });
});
```

> The repository (Phase 1) owns the actual read-gate logic; the service test asserts the
> config is threaded through correctly. The medium repository spec already proves the gate
> itself (edges 3, 4, 7, 13).

**Step 2: Run test to verify it fails**

Run: `cd server && pnpm test -- --run src/services/person.service.spec.ts -t getFaceSuggestions`
Expected: FAIL — `sut.getFaceSuggestions is not a function`.

**Step 3: Write minimal implementation**

In `server/src/services/person.service.ts`, add after `getById` (~line 287). `asDateString`
is already imported (used by `getFacesForPicker`), `Permission` is imported, `getConfig` is
on `BaseService`:

```ts
  async getFaceSuggestions(
    auth: AuthDto,
    id: string,
    dto: PersonFaceSuggestionPageQueryDto,
  ): Promise<PersonFaceSuggestionPageResponseDto> {
    await this.requireAccess({ auth, permission: Permission.PersonRead, ids: [id] });

    const { machineLearning } = await this.getConfig({ withCache: true });
    const { maxDistance, suggestionMaxDistance } = machineLearning.facialRecognition;

    const { total, items } = await this.personFaceSuggestionRepository.getPendingForPerson(id, {
      maxDistance,
      suggestionMaxDistance,
      page: dto.page,
      size: dto.size,
    });

    return {
      total,
      items: items.map((item) => ({
        assetFaceId: item.assetFaceId,
        assetId: item.assetId,
        distance: item.distance,
        imageWidth: item.imageWidth,
        imageHeight: item.imageHeight,
        boundingBoxX1: item.boundingBoxX1,
        boundingBoxX2: item.boundingBoxX2,
        boundingBoxY1: item.boundingBoxY1,
        boundingBoxY2: item.boundingBoxY2,
        fileCreatedAt: asDateString(item.fileCreatedAt) ?? undefined,
      })),
    };
  }
```

Add the DTO imports to the existing `from 'src/dtos/person.dto'` import block in
`person.service.ts`:

```ts
  PersonFaceSuggestionPageQueryDto,
  PersonFaceSuggestionPageResponseDto,
```

`this.requireAccess` with `Permission.PersonRead` is the owner-only check (it throws
`BadRequestException` for a non-owner — same pattern as `getFacesForPicker`/`reassignFaces`).
Shared-space accessible-person widening is **deliberately not** added here — that is Phase 5.

**Step 4: Run test to verify it passes**

Run: `cd server && pnpm test -- --run src/services/person.service.spec.ts -t getFaceSuggestions`
Then: `make check-server`
Expected: PASS (3 tests); no type errors.

**Step 5: Commit**

```bash
git add server/src/services/person.service.ts server/src/services/person.service.spec.ts
git commit -m "feat(server): add owner-only getFaceSuggestions service read"
```

---

### Task 5: Wire `resolveAssignedFace` into the reassign paths (edge 11) + edge-12/8 invariants (medium)

The Phase-1 `resolveAssignedFace(assetFaceId)` deletes only `status='pending'` rows for a
face. Wire it into the two manual-reassign service paths so that when a face becomes
assigned, its now-invalid `pending` suggestions across **every** person are cleared.

**Edge-case coverage split (read carefully — the coverage claim must be exact):**

- **Edge 11 — _manual_ reassign branch:** covered _here_ by the new
  `resolveAssignedFace` call in `reassignFaces`/`reassignFacesById` (unit tests (a), (b)).
- **Edge 11 — _recognition auto-assign_ branch:** the recognition path
  (`handleRecognizeFaces`) does **not** go through `reassignFaces*`, so it is **not** wired
  here. That branch is covered by the Phase-1 `getPendingForPerson` read-time
  `where('af.personId', 'is', null)` filter (already proven by the Phase-1 band-read medium
  test "excludes assigned/deleted faces"). Cross-referenced, not re-tested.
- **Edge 12 — confirming one person resolves the other's pending row:** the _end state_
  (confirming person's row stays `confirmed`, the sibling person's `pending` row is deleted)
  is real SQL behavior and is proven by the **non-mocked medium test (c)** below — the unit
  test (a) only proves `resolveAssignedFace` is _called_, which is insufficient on its own.
- **Edge 8 — person merge:** **no merge-path code** is added. The invariant that makes this
  safe is asserted directly by medium test (d): a `pending` row only ever references an
  **unassigned** face (`af.personId IS NULL`), and `mergePerson` only ever moves **assigned**
  faces (a merged person's faces were assigned to that person), so a merge can never strand a
  _cross-person_ pending row; the merged-away person's own rows are removed by the Phase-1 FK
  `ON DELETE CASCADE` when `removeAllPeople` deletes that person. Test (d) proves both halves
  of that invariant rather than tautologically re-testing Postgres CASCADE in isolation.

**Files:**

- Modify: `server/src/services/person.service.ts` (`reassignFaces` ~line 217;
  `reassignFacesById` ~line 236)
- Modify: `server/src/services/person.service.spec.ts` (extend
  `describe('reassignFaces')` and `describe('reassignFacesById')`; add a `describe` for the
  merge CASCADE regression — or add a medium test, see Step 1)

**Step 1: Write the failing tests**

(a) Unit — extend `describe('reassignFacesById')` (mirror its existing mock setup at
spec:1155-1200: `mocks.access.person.checkOwnerAccess`, `mocks.access.person.checkFaceOwnerAccess`,
`mocks.person.getFaceById = getForAssetFace(face)`, `mocks.person.reassignFace`,
`mocks.person.getById`):

```ts
it('resolves pending suggestions for the face when it is reassigned by id (edge 11, manual branch)', async () => {
  const face = AssetFaceFactory.create();
  const person = PersonFactory.create();
  mocks.access.person.checkOwnerAccess.mockResolvedValue(new Set([person.id]));
  mocks.access.person.checkFaceOwnerAccess.mockResolvedValue(new Set([face.id]));
  mocks.person.getFaceById.mockResolvedValue(getForAssetFace(face));
  mocks.person.reassignFace.mockResolvedValue(1);
  mocks.person.getById.mockResolvedValue(person);

  await sut.reassignFacesById(AuthFactory.create(), person.id, { id: face.id });

  expect(mocks.personFaceSuggestion.resolveAssignedFace).toHaveBeenCalledWith(face.id);
});
```

(b) Unit — extend `describe('reassignFaces')` (mirror its existing setup at spec:943; it
iterates `dto.data` and calls `mocks.person.getFacesByIds`):

```ts
it('resolves pending suggestions for every reassigned face (edge 11)', async () => {
  // reuse the describe's existing happy-path arrange (person + one face via getFacesByIds)
  // then after the act:
  expect(mocks.personFaceSuggestion.resolveAssignedFace).toHaveBeenCalledWith(reassignedFace.id);
});
```

(c) Medium — **edge 12 end-state** (non-mocked; this is the test that actually proves
edge 12, not the mocked unit test (a)). Append to
`server/test/medium/specs/repositories/person-face-suggestion.repository.spec.ts`. Seed two
named scannable people `p1`, `p2` and one **unassigned** `assetFaceId` (reuse the file's
existing seed helpers; add a second person via the medium factory):

```ts
describe('edge 12 — confirming for one person resolves the other person’s pending row', () => {
  it('keeps the confirmed row and deletes the sibling person’s pending row for the same face', async () => {
    const { sut } = setup();
    await sut.upsertPending([
      { personId: p1Id, assetFaceId, distance: 0.6 },
      { personId: p2Id, assetFaceId, distance: 0.65 },
    ]);

    // Confirm flow order (Task 6): markConfirmed BEFORE the embedded resolveAssignedFace.
    expect(await sut.markConfirmed(p1Id, assetFaceId)).toBe(1);
    await sut.resolveAssignedFace(assetFaceId); // pending-only delete across ALL persons

    expect((await getRow(p1Id, assetFaceId)).status).toBe('confirmed'); // survives (non-pending)
    const p2 = await defaultDatabase
      .selectFrom('person_face_suggestion')
      .selectAll()
      .where('personId', '=', p2Id)
      .where('assetFaceId', '=', assetFaceId)
      .execute();
    expect(p2).toEqual([]); // sibling pending row deleted
  });
});
```

(d) Medium — **edge 8 invariant** (proves the two halves that make a no-code merge safe;
**not** a bare CASCADE tautology):

```ts
describe('edge 8 — merge cannot strand a cross-person pending row', () => {
  it('half 1: a pending row only ever references an unassigned face (af.personId IS NULL)', async () => {
    // Seed a pending row, then assign its face to ANY person (simulating what a merge does to
    // that person's faces) and prove the read no longer surfaces it — so the row is inert,
    // not "stranded", even with no merge-path code.
    const { sut } = setup();
    await sut.upsertPending([{ personId, assetFaceId, distance: 0.6 }]);
    await defaultDatabase.updateTable('asset_face').set({ personId }).where('id', '=', assetFaceId).execute(); // face now assigned

    const res = await sut.getPendingForPerson(personId, {
      maxDistance: 0.5,
      suggestionMaxDistance: 0.8,
      page: 1,
      size: 10,
    });
    expect(res.items.find((i) => i.assetFaceId === assetFaceId)).toBeUndefined();
  });

  it('half 2: removing the candidate person (what removeAllPeople does in a merge) drops its rows via FK CASCADE', async () => {
    const { sut } = setup();
    await sut.upsertPending([{ personId, assetFaceId, distance: 0.6 }]);
    expect(await getRow(personId, assetFaceId)).toBeTruthy();

    // mergePerson → removeAllPeople([mergedAwayPerson]) deletes the person row.
    await defaultDatabase.deleteFrom('person').where('id', '=', personId).execute();

    const remaining = await defaultDatabase
      .selectFrom('person_face_suggestion')
      .selectAll()
      .where('personId', '=', personId)
      .execute();
    expect(remaining).toEqual([]); // Phase-1 FK ON DELETE CASCADE — no orphan, no merge code
  });
});
```

**Step 2: Run tests to verify they fail**

```bash
cd server && pnpm test -- --run src/services/person.service.spec.ts -t "reassignFacesById"
cd server && pnpm test -- --run src/services/person.service.spec.ts -t "reassignFaces"
cd server && pnpm test:medium -- --run test/medium/specs/repositories/person-face-suggestion.repository.spec.ts
```

Expected:

- Unit tests (a) + (b) **FAIL** — `resolveAssignedFace` is never called from the reassign
  service paths yet (this is the red test driving the Step-3 wiring).
- Medium tests (c) + (d) **PASS already** — they exercise only Phase-1 `resolveAssignedFace`
  - Task-2 `markConfirmed` + Phase-1 `getPendingForPerson`, all of which exist before
    Task 5. They are deliberately **standing-regression / invariant guards** (same pattern as
    the Phase-2 edge-1 and queue-placement guards): they assert the SQL invariants that the
    "no merge-path code" decision (edge 8) and the confirm ordering (edge 12) _depend on_, so
    that a future change to `resolveAssignedFace`/`markConfirmed`/the read filter that broke
    those invariants would fail loudly here. If (c) or (d) is red at this step, a Phase-1/2
    guarantee regressed and must be fixed at its source, not papered over here.

**Step 3: Write minimal implementation**

In `reassignFacesById` (`person.service.ts`), immediately after
`await this.personRepository.reassignFace(face.id, personId);` (line ~236):

```ts
await this.personRepository.reassignFace(face.id, personId);
await this.personFaceSuggestionRepository.resolveAssignedFace(face.id);
await this.replaceFaceIdentity(personId, face.id, 'manual');
```

In `reassignFaces` (bulk), inside the `for (const face of faces)` loop, immediately after
`await this.personRepository.reassignFace(face.id, personId);` (line ~217):

```ts
await this.personRepository.reassignFace(face.id, personId);
await this.personFaceSuggestionRepository.resolveAssignedFace(face.id);
await this.replaceFaceIdentity(personId, face.id, 'manual');
```

`this.personFaceSuggestionRepository` is already injected on `BaseService` (Phase 1 Task 5).
**No edits to `mergePerson`** — edge 8 needs no merge-path code; the invariant that makes
that safe is proven by medium test (d) (a pending row only references an unassigned face, so
a merge — which moves only assigned faces — cannot strand a cross-person row; the merged-away
person's own rows go via FK CASCADE).

**Step 4: Run tests to verify they pass**

```bash
cd server && pnpm test -- --run src/services/person.service.spec.ts -t "reassignFacesById"
cd server && pnpm test -- --run src/services/person.service.spec.ts -t "reassignFaces"
cd server && pnpm test:medium -- --run test/medium/specs/repositories/person-face-suggestion.repository.spec.ts
```

Expected: all PASS, including every pre-existing `reassignFaces*` test (the new
`resolveAssignedFace` automock returns `undefined` and does not change the asserted
person/identity/feature-photo behavior).

**Step 5: Commit**

```bash
git add server/src/services/person.service.ts server/src/services/person.service.spec.ts server/test/medium/specs/repositories/person-face-suggestion.repository.spec.ts
git commit -m "feat(server): resolve pending suggestions when a face is reassigned"
```

---

### Task 6: Service `confirmFaceSuggestion` + `dismissFaceSuggestion` (edges 9, 10, 12, 18)

**Files:**

- Modify: `server/src/services/person.service.ts` (two new methods, next to
  `getFaceSuggestions`)
- Modify: `server/src/services/person.service.spec.ts`
  (`describe('confirmFaceSuggestion')`, `describe('dismissFaceSuggestion')`)

**Step 1: Write the failing tests**

```ts
describe('confirmFaceSuggestion', () => {
  it('denies a non-owner with NO state change (edge 18 absence)', async () => {
    mocks.access.person.checkOwnerAccess.mockResolvedValue(new Set()); // not owner

    await expect(sut.confirmFaceSuggestion(AuthFactory.create(), 'person-1', 'face-1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(mocks.personFaceSuggestion.markConfirmed).not.toHaveBeenCalled();
    expect(mocks.person.reassignFace).not.toHaveBeenCalled();
  });

  it('flips the row to confirmed then delegates to reassignFacesById (assign + manual identity + feature photo)', async () => {
    const face = AssetFaceFactory.create();
    const person = PersonFactory.create({ faceAssetId: null }); // no feature photo yet
    mocks.access.person.checkOwnerAccess.mockResolvedValue(new Set([person.id]));
    mocks.access.person.checkFaceOwnerAccess.mockResolvedValue(new Set([face.id]));
    mocks.person.getFaceById.mockResolvedValue(getForAssetFace(face));
    mocks.person.reassignFace.mockResolvedValue(1);
    mocks.person.getById.mockResolvedValue(person);
    mocks.person.getRandomFace.mockResolvedValue(face); // drives createNewFeaturePhoto
    mocks.personFaceSuggestion.markConfirmed.mockResolvedValue(1); // a pending row existed

    await sut.confirmFaceSuggestion(AuthFactory.create(), person.id, face.id);

    expect(mocks.personFaceSuggestion.markConfirmed).toHaveBeenCalledWith(person.id, face.id);
    expect(mocks.person.reassignFace).toHaveBeenCalledWith(face.id, person.id); // delegated assign
    expect(mocks.faceIdentity.replaceFaceIdentity).toHaveBeenCalledWith({
      assetFaceId: face.id,
      identityId: 'identity-1',
      source: 'manual',
    });
    expect(mocks.person.update).toHaveBeenCalledWith(expect.objectContaining({ id: person.id, faceAssetId: face.id })); // feature photo created (faceAssetId was null)
    // edge 12: reassignFacesById embeds resolveAssignedFace; confirmed row (set above) survives
    expect(mocks.personFaceSuggestion.resolveAssignedFace).toHaveBeenCalledWith(face.id);
  });

  it('is idempotent when the row is already resolved but person+face still exist → 200, no reassign', async () => {
    // Realistic idempotency case: double-submit, or a concurrent scan/auto-assign already
    // flipped the row, while the person and face still exist (access checks pass).
    mocks.access.person.checkOwnerAccess.mockResolvedValue(new Set(['person-1']));
    mocks.access.person.checkFaceOwnerAccess.mockResolvedValue(new Set(['face-1']));
    mocks.personFaceSuggestion.markConfirmed.mockResolvedValue(0); // already confirmed/dismissed → 0 pending

    await expect(sut.confirmFaceSuggestion(AuthFactory.create(), 'person-1', 'face-1')).resolves.toBeUndefined();
    expect(mocks.person.reassignFace).not.toHaveBeenCalled(); // does NOT re-touch an already-resolved face
  });

  it('a CASCADE-deleted person or face → 400 (owner-only precedence), NOT a server 200 (edges 9, 10)', async () => {
    // Person deleted mid-review: checkOwnerAccess([personId]) is empty → first requireAccess
    // throws BEFORE markConfirmed (no state change). Same shape for a deleted face via
    // checkFaceOwnerAccess. The "benign advance" for a vanished item is a CLIENT behavior
    // (Phase 4 modal treats every confirm/dismiss response — including this 400 — as
    // "advance"); the server does NOT fabricate a 200 for an entity the caller cannot access.
    mocks.access.person.checkOwnerAccess.mockResolvedValue(new Set()); // person row gone

    await expect(sut.confirmFaceSuggestion(AuthFactory.create(), 'person-1', 'face-1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(mocks.personFaceSuggestion.markConfirmed).not.toHaveBeenCalled(); // absence — no state change
  });
});

describe('dismissFaceSuggestion', () => {
  it('denies a non-owner with NO state change (edge 18 absence)', async () => {
    mocks.access.person.checkOwnerAccess.mockResolvedValue(new Set());

    await expect(sut.dismissFaceSuggestion(AuthFactory.create(), 'person-1', 'face-1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(mocks.personFaceSuggestion.markDismissed).not.toHaveBeenCalled();
  });

  it('flips the row to dismissed and never assigns the face (idempotent 200)', async () => {
    mocks.access.person.checkOwnerAccess.mockResolvedValue(new Set(['person-1']));
    mocks.personFaceSuggestion.markDismissed.mockResolvedValue(1);

    await expect(sut.dismissFaceSuggestion(AuthFactory.create(), 'person-1', 'face-1')).resolves.toBeUndefined();
    expect(mocks.personFaceSuggestion.markDismissed).toHaveBeenCalledWith('person-1', 'face-1');
    expect(mocks.person.reassignFace).not.toHaveBeenCalled(); // face stays unassigned

    mocks.personFaceSuggestion.markDismissed.mockResolvedValue(0); // re-dismiss → still 200
    await expect(sut.dismissFaceSuggestion(AuthFactory.create(), 'person-1', 'face-1')).resolves.toBeUndefined();
  });
});
```

> The non-owner absence tests assert the **first** access check throws before any mutation
> mock is touched. Confirm checks `PersonUpdate` then `PersonCreate`; with
> `checkOwnerAccess` returning an empty set the first `requireAccess` throws
> `BadRequestException` (verified: `requireAccess` → `BadRequestException` with message
> `Not found or no <permission> access`, `src/utils/access.ts:40`; `Permission.PersonUpdate`
> → `access.person.checkOwnerAccess`, `Permission.PersonCreate` →
> `access.person.checkFaceOwnerAccess`, `src/utils/access.ts:301-310` — same mapping
> `reassignFacesById` relies on).
>
> **Factory-override caveat (same as Phase 2 Task 6):** if `PersonFactory.create` does not
> accept a `{ faceAssetId: null }` override, build the person then set the field on the
> returned object before mocking — `const person = PersonFactory.create(); person.faceAssetId
= null;`. The behavioral assertions (`markConfirmed`/`reassignFace`/`replaceFaceIdentity`/
> `person.update` called or not) are the contract; the factory mechanics are flexible.

**Step 2: Run tests to verify they fail**

```bash
cd server && pnpm test -- --run src/services/person.service.spec.ts -t "confirmFaceSuggestion"
cd server && pnpm test -- --run src/services/person.service.spec.ts -t "dismissFaceSuggestion"
```

Expected: FAIL — `sut.confirmFaceSuggestion is not a function`.

**Step 3: Write minimal implementation**

In `server/src/services/person.service.ts`, next to `getFaceSuggestions`:

```ts
  async confirmFaceSuggestion(auth: AuthDto, personId: string, assetFaceId: string): Promise<void> {
    await this.requireAccess({ auth, permission: Permission.PersonUpdate, ids: [personId] });
    await this.requireAccess({ auth, permission: Permission.PersonCreate, ids: [assetFaceId] });

    const confirmed = await this.personFaceSuggestionRepository.markConfirmed(personId, assetFaceId);
    if (confirmed === 0) {
      // Idempotent: the row was already confirmed/dismissed (double-submit, or a concurrent
      // scan/auto-assign resolved it) while person+face still exist. A CASCADE-deleted
      // person/face never reaches here — the requireAccess checks above already threw 400
      // (owner-only precedence; edges 9/10 — the client treats that 400 as benign-advance).
      return;
    }

    // Delegates assign + replaceFaceIdentity('manual') + createNewFeaturePhoto, and (Task 5)
    // its embedded resolveAssignedFace deletes every OTHER person's still-pending row for
    // this now-assigned face (edge 12). This person's row is already 'confirmed' above, so
    // the pending-only delete leaves it intact.
    await this.reassignFacesById(auth, personId, { id: assetFaceId });
  }

  async dismissFaceSuggestion(auth: AuthDto, personId: string, assetFaceId: string): Promise<void> {
    // Owner-only on the PERSON only — intentionally asymmetric with confirm. Dismiss never
    // touches the face (it only suppresses a (personId, assetFaceId) suggestion row), so
    // person ownership is sufficient; confirm additionally checks face ownership because it
    // assigns the face. Consequence: dismiss on a CASCADE-deleted face (person still exists)
    // → markDismissed affects 0 rows → benign 200; that asymmetry is by-design, not a gap.
    await this.requireAccess({ auth, permission: Permission.PersonUpdate, ids: [personId] });
    await this.personFaceSuggestionRepository.markDismissed(personId, assetFaceId);
    // Face stays unassigned; the Phase-1 conditional upsertPending never resurrects a
    // 'dismissed' row, so a later scan will not re-suggest it for this person.
  }
```

`FaceDto` (the `{ id }` shape `reassignFacesById` expects) is already imported in
`person.service.ts`.

**Step 4: Run tests to verify they pass + full describe regression**

```bash
cd server && pnpm test -- --run src/services/person.service.spec.ts -t "confirmFaceSuggestion"
cd server && pnpm test -- --run src/services/person.service.spec.ts -t "dismissFaceSuggestion"
cd server && pnpm test -- --run src/services/person.service.spec.ts -t "reassignFacesById"
```

Expected: all PASS, including the pre-existing `reassignFacesById` tests (unchanged behavior;
the new `resolveAssignedFace`/`markConfirmed` automocks return `undefined`/`0` by default and
do not affect them).

**Step 5: Commit**

```bash
git add server/src/services/person.service.ts server/src/services/person.service.spec.ts
git commit -m "feat(server): add idempotent confirm/dismiss face-suggestion services"
```

---

### Task 7: Controller endpoints

> **TDD note (deliberate exception — mirrors Phase 2 Task 1).** A controller method here is
> pure declarative wiring: route + permission decorator + a one-line delegation to a service
> method that **already has full red→green unit coverage** (Tasks 4 & 6). There is no
> behavior to red-test in isolation, and this repo has **no controller-only spec files** (the
> established convention is service-level unit tests + API e2e for the HTTP surface). The
> failing test that drives this task is **Task 8's API e2e**, which 404s/401s until these
> routes exist. Keep this task to wiring only; all behavior is already TDD'd in 4 & 6 and the
> HTTP contract is asserted red→green in Task 8. (Sequencing note: Task 8 Step 1 writes that
> e2e as the red test; this task makes it reachable; Task 8 Step 3 turns it green.)

Three fork endpoints on `PersonController`. GET takes `:id` (validated by `UUIDParamDto`) +
the query DTO. Confirm/dismiss take the two-uuid param DTO and return `200` with no body
(`@HttpCode(HttpStatus.OK)` + `Promise<void>`). Coarse `@Authenticated` permission gate
(the service does the fine-grained owner check): GET → `PersonRead`, confirm →
`PersonReassign` (it reassigns a face, mirroring `reassignFaces`), dismiss → `PersonUpdate`.
Fork endpoints use `HistoryBuilder().added('v1').beta('v1')` (the shared-space controller
convention).

**Files:**

- Modify: `server/src/controllers/person.controller.ts` (imports + 3 methods). Place the
  three methods after `mergePerson` at the end of the class for review locality. Route
  ordering vs. the generic `@Get(':id')` (line 197) is a non-issue: `GET /people/:id` is a
  two-segment route and `GET /people/:id/face-suggestions` is three-segment, so they cannot
  collide regardless of declaration order (the precedented two-field `@Param()` DTO is
  `asset.controller.ts:195` `@Param() { id, key }: …`).
- Test: none in this task — see the TDD note above; the HTTP contract is the Task 8 API e2e.

**Step 1: Add the imports**

In the `from 'src/dtos/person.dto'` import block in `person.controller.ts`, add (keep
alphabetical grouping like the existing block):

```ts
  PersonFaceSuggestionPageQueryDto,
  PersonFaceSuggestionPageResponseDto,
  PersonFaceSuggestionParamsDto,
```

**Step 2: Add the three endpoints**

Append inside `PersonController`, after `mergePerson` (line ~292):

```ts
  @Get(':id/face-suggestions')
  @Authenticated({ permission: Permission.PersonRead })
  @Endpoint({
    summary: 'Get face suggestions for a person',
    description: 'Retrieve near-miss unassigned faces suggested for this person, best match first.',
    history: new HistoryBuilder().added('v1').beta('v1'),
  })
  getPersonFaceSuggestions(
    @Auth() auth: AuthDto,
    @Param() { id }: UUIDParamDto,
    @Query() dto: PersonFaceSuggestionPageQueryDto,
  ): Promise<PersonFaceSuggestionPageResponseDto> {
    return this.service.getFaceSuggestions(auth, id, dto);
  }

  @Post(':id/face-suggestions/:assetFaceId/confirm')
  @Authenticated({ permission: Permission.PersonReassign })
  @HttpCode(HttpStatus.OK)
  @Endpoint({
    summary: 'Confirm a face suggestion',
    description: 'Assign the suggested face to the person. Idempotent.',
    history: new HistoryBuilder().added('v1').beta('v1'),
  })
  confirmPersonFaceSuggestion(
    @Auth() auth: AuthDto,
    @Param() { id, assetFaceId }: PersonFaceSuggestionParamsDto,
  ): Promise<void> {
    return this.service.confirmFaceSuggestion(auth, id, assetFaceId);
  }

  @Post(':id/face-suggestions/:assetFaceId/dismiss')
  @Authenticated({ permission: Permission.PersonUpdate })
  @HttpCode(HttpStatus.OK)
  @Endpoint({
    summary: 'Dismiss a face suggestion',
    description: 'Suppress this suggestion for the person forever. The face stays unassigned. Idempotent.',
    history: new HistoryBuilder().added('v1').beta('v1'),
  })
  dismissPersonFaceSuggestion(
    @Auth() auth: AuthDto,
    @Param() { id, assetFaceId }: PersonFaceSuggestionParamsDto,
  ): Promise<void> {
    return this.service.dismissFaceSuggestion(auth, id, assetFaceId);
  }
```

`Get`, `Post`, `HttpCode`, `HttpStatus`, `Param`, `Query`, `Auth`, `Authenticated`,
`Endpoint`, `HistoryBuilder`, `UUIDParamDto`, `Permission`, `AuthDto` are all already
imported in `person.controller.ts`.

**Step 3: Type check**

Run: `make check-server`
Expected: clean.

**Step 4: Smoke the route shape**

Run: `cd server && pnpm test -- --run src/services/person.service.spec.ts -t "FaceSuggestion"`
Expected: PASS (the service tests from Tasks 4 & 6 — confirms the controller delegates to
methods that already have green coverage).

**Step 5: Commit**

```bash
git add server/src/controllers/person.controller.ts
git commit -m "feat(server): add person face-suggestion endpoints"
```

---

### Task 8: OpenAPI (TS + Dart) + `make sql` + API e2e + final gates

**Files:**

- Generated: `open-api/immich-openapi-specs.json`, `open-api/typescript-sdk/**`,
  `mobile/openapi/**` (via `make open-api`)
- Generated: `server/src/queries/person-face-suggestion.repository.sql`,
  `server/src/queries/person.repository.sql` (unchanged unless Phase 2 touched it),
  (via `make sql`)
- Create: `e2e/src/specs/server/api/person-face-suggestions.e2e-spec.ts`

**Step 1: Write the failing API e2e (HTTP contract — edges 7, 18)**

Create `e2e/src/specs/server/api/person-face-suggestions.e2e-spec.ts`, mirroring the
structure of the sibling `e2e/src/specs/server/api/person.e2e-spec.ts` (same imports:
`createUserDto`, `app`, `utils`, `request` from `supertest`, the `beforeAll` admin/user
setup). Seed `person_face_suggestion` rows through the e2e DB helper used by
`e2e/src/storage-migration.ts` / the duplicate spec (raw Kysely via `utils`) — one named
owner person with an in-band pending row pointing at an owned, unassigned `asset_face`, plus
a hidden person with a pending row:

```ts
describe('/people/:id/face-suggestions', () => {
  it('GET requires authentication', async () => {
    const { status } = await request(app).get(`/people/${owner.personId}/face-suggestions`);
    expect(status).toBe(401);
  });

  it('GET returns total + in-band pending items for the owner, distance ascending', async () => {
    const { status, body } = await request(app)
      .get(`/people/${owner.personId}/face-suggestions`)
      .set('Authorization', `Bearer ${owner.accessToken}`);
    expect(status).toBe(200);
    expect(body.total).toBeGreaterThan(0);
    expect(body.items[0]).toMatchObject({
      assetFaceId: expect.any(String),
      assetId: expect.any(String),
      distance: expect.any(Number),
    });
    const distances = body.items.map((i: { distance: number }) => i.distance);
    expect(distances).toEqual([...distances].sort((a, b) => a - b));
  });

  it('GET denies a non-owner — empty/absence, no leakage (edge 18)', async () => {
    const { status } = await request(app)
      .get(`/people/${owner.personId}/face-suggestions`)
      .set('Authorization', `Bearer ${stranger.accessToken}`);
    expect(status).toBe(400); // requireAccess(PersonRead) denial
  });

  it('GET on a hidden (non-scannable) person returns empty even though a pending row exists (edge 7)', async () => {
    const { status, body } = await request(app)
      .get(`/people/${owner.hiddenPersonId}/face-suggestions`)
      .set('Authorization', `Bearer ${owner.accessToken}`);
    expect(status).toBe(200);
    expect(body).toEqual({ total: 0, items: [] });
  });

  it('dismiss is owner-only and idempotent; the face stays unassigned', async () => {
    const denied = await request(app)
      .post(`/people/${owner.personId}/face-suggestions/${owner.assetFaceId}/dismiss`)
      .set('Authorization', `Bearer ${stranger.accessToken}`);
    expect(denied.status).toBe(400); // absence — no state change

    const first = await request(app)
      .post(`/people/${owner.personId}/face-suggestions/${owner.assetFaceId}/dismiss`)
      .set('Authorization', `Bearer ${owner.accessToken}`);
    expect(first.status).toBe(200);

    const again = await request(app)
      .post(`/people/${owner.personId}/face-suggestions/${owner.assetFaceId}/dismiss`)
      .set('Authorization', `Bearer ${owner.accessToken}`);
    expect(again.status).toBe(200); // idempotent

    // dismissed → no longer returned
    const { body } = await request(app)
      .get(`/people/${owner.personId}/face-suggestions`)
      .set('Authorization', `Bearer ${owner.accessToken}`);
    expect(body.items.find((i: { assetFaceId: string }) => i.assetFaceId === owner.assetFaceId)).toBeUndefined();
  });

  it('confirm is owner-only and idempotent', async () => {
    const denied = await request(app)
      .post(`/people/${owner.personId}/face-suggestions/${owner.confirmFaceId}/confirm`)
      .set('Authorization', `Bearer ${stranger.accessToken}`);
    expect(denied.status).toBe(400);

    const ok = await request(app)
      .post(`/people/${owner.personId}/face-suggestions/${owner.confirmFaceId}/confirm`)
      .set('Authorization', `Bearer ${owner.accessToken}`);
    expect(ok.status).toBe(200);

    const again = await request(app)
      .post(`/people/${owner.personId}/face-suggestions/${owner.confirmFaceId}/confirm`)
      .set('Authorization', `Bearer ${owner.accessToken}`);
    expect(again.status).toBe(200); // idempotent (row already confirmed → no-op)
  });
});
```

> ML is **not** required: faces + embeddings + suggestion rows are seeded directly via the
> e2e Kysely helper (the same approach `storage-migration.ts` uses for raw inserts; memory
> `feedback_storage_migration_harness_conventions`). Use `utils.resetDatabase()` in
> `beforeAll` and seed with `createUserDto.user1` (owner) and a second user (stranger).
> Drain `metadataExtraction` is **not** needed (no tag/rating mutation; memory
> `feedback_e2e_metadata_extraction_wait` does not apply here).

**Step 2: Run it — expect failure**

Bring up the e2e stack, then:
`cd e2e && pnpm test -- --run src/specs/server/api/person-face-suggestions.e2e-spec.ts`
Expected: FAIL — the endpoints exist (Task 7) but the e2e server image must be rebuilt with
the new routes/DTOs/migration. Rebuild the e2e server image first
(`make e2e` / the project's e2e bring-up), then the failures should be assertion-level
(seed wiring) not 404. Iterate seed helpers until green. **Fix at root cause — no
retry-if-flaky** (memory `feedback_no_flake_allowance`).

**Step 3: Make it pass**

Adjust only the e2e seed helper until all cases pass. Do **not** weaken the owner-only or
read-gate assertions.

Run: `cd e2e && pnpm test -- --run src/specs/server/api/person-face-suggestions.e2e-spec.ts`
Expected: PASS (all cases).

**Step 4: Regenerate all generated artifacts**

The controller + DTOs change the OpenAPI surface; Tasks 2 & 3 add/changed `@GenerateSql`
methods. Per memory `feedback_openapi_dart_and_sql` / `feedback_ci_generated_files`,
regenerate **both** clients **and** SQL (needs a built server + reachable Postgres):

```bash
make build-server
cd server && pnpm sync:open-api && cd ..
make open-api          # regenerates TS SDK AND Dart client (mobile/openapi)
make sql               # regenerates server/src/queries/*.repository.sql
make check-server
make check-web         # SDK type surface changed — verify web still type-checks
```

Then run Prettier on every changed non-generated file (zero-warning CI):

```bash
cd server && npx prettier --write src/dtos/person.dto.ts src/controllers/person.controller.ts src/services/person.service.ts src/repositories/person-face-suggestion.repository.ts && cd ..
```

Expected: `make sql` creates/updates `server/src/queries/person-face-suggestion.repository.sql`
(new `markConfirmed`/`markDismissed`, changed `getPendingForPerson`); `make open-api`
produces a non-empty diff under `open-api/` and `mobile/openapi/`; `make check-server` /
`make check-web` clean. If no local Postgres is available, commit code without the
regenerated SQL and note in the PR that `make sql` must run before merge (CI enforces
generated-file freshness — memory `feedback_ci_generated_files`).

**Step 5: Full Phase-3 regression + commit**

```bash
cd server && pnpm test -- --run src/services/person.service.spec.ts
cd server && pnpm test -- --run src/dtos/person-face-suggestion.dto.spec.ts
cd server && pnpm test:medium -- --run test/medium/specs/repositories/person-face-suggestion.repository.spec.ts
cd e2e && pnpm test -- --run src/specs/server/api/person-face-suggestions.e2e-spec.ts
make check-server && make check-web
```

Expected: all green.

```bash
git add open-api mobile/openapi server/src/queries e2e/src/specs/server/api/person-face-suggestions.e2e-spec.ts \
  server/src/dtos/person.dto.ts server/src/controllers/person.controller.ts \
  server/src/services/person.service.ts server/src/repositories/person-face-suggestion.repository.ts
git commit -m "feat: regenerate OpenAPI + SQL and add face-suggestion API e2e"
```

---

## Phase 3 exit criteria

- `GET /people/:id/face-suggestions?page=&size=` → `{ total, items[{ assetFaceId, assetId,
distance, imageWidth, imageHeight, boundingBoxX1..Y2, fileCreatedAt? }] }`; in-band
  `pending` only; distance ascending; paginated; **owner-only** (non-owner denied, absence
  asserted — edge 18); invalid UUID → 400 (`UUIDParamDto`); non-scannable / feature-off
  person → `{ total: 0, items: [] }` via the Phase-1 read-gate (edge 7).
- `POST …/confirm`: owner-only (absence asserted); flips the row `pending → confirmed` then
  delegates to `reassignFacesById` (face assigned, identity `manual`, feature photo when
  `faceAssetId` null — all three asserted at the unit level); idempotent when the row is
  already resolved but person+face still exist → 200, no reassign. A CASCADE-deleted
  person/face → **400** (owner-only precedence — `requireAccess` throws before any write);
  the "benign advance" for a vanished item is a Phase-4 client behavior, **not** a fabricated
  server 200 (edges 9, 10). Edge 12's _end state_ (confirmed row survives
  the pending-only `resolveAssignedFace` delete; the sibling person's `pending` row is
  deleted) is proven by the **non-mocked Task 5 medium test (c)**, not by the mocked unit
  assertion alone.
- `POST …/dismiss`: owner-only (absence asserted); flips `pending → dismissed`; the face
  stays unassigned; the Phase-1 conditional `upsertPending` never re-suggests it; idempotent
  (0 rows → 200).
- `resolveAssignedFace` wired into `reassignFaces` (bulk) and `reassignFacesById` so a
  manually-reassigned face's stale `pending` suggestions are cleared — **edge 11's manual
  branch**; edge 11's _recognition auto-assign_ branch is covered by the Phase-1
  `getPendingForPerson` `af.personId IS NULL` read filter (cross-referenced, already
  Phase-1-tested). **Edge 8** needs no merge-path code: the safety invariant (a pending row
  only references an unassigned face, so a merge — which moves only assigned faces — cannot
  strand a cross-person row; the merged-away person's own rows drop via FK `ON DELETE
CASCADE`) is proven by the two-part Task 5 medium test (d), not a bare CASCADE tautology.
- OpenAPI TS SDK **and** Dart client regenerated and committed; `make sql` regenerated and
  committed; Prettier-clean; `make check-server` + `make check-web` clean.
- API e2e proves the HTTP contract: 401 unauth, owner-only presence/absence (edge 18),
  read-gate (edge 7), confirm/dismiss idempotency.

**Not in this phase (Phase 4+):** `PersonSuggestionBanner.svelte` /
`PersonSuggestionReviewModal.svelte`, localStorage snooze, full-photo bbox highlight,
Playwright web E2E (edge cases 1/13 UI side), shared-space suggestions + RBAC matrix
(Phase 5), mobile (Phase 6). The repository `getPendingForPerson`/`markConfirmed`/
`markDismissed`/`resolveAssignedFace` are now fully wired by the API; Phase 4 consumes the
generated SDK only.
