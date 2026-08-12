# Face Cleanup — Add Faces — Slice 2 (DTO + controller endpoint + OpenAPI regen) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Expose `POST /admin/face-repair/scan/person/:personId/cluster-faces` (paginated, backed by Slice 1's
`getClusterFacePage`) and extend `FaceRepairApplyRequestDto` with an optional `manualMove` block + a relaxed,
refine-guarded `approvedPersonIds`, then regenerate the OpenAPI TS + Dart clients so Slices 5/6 can consume them.

**Architecture:** Pure transport layer. New Zod DTOs (`createZodDto`), one thin service method that converts
`{ page, size }` → `{ offset, limit }` and delegates to Slice 1's repo method, one new admin-guarded controller
route, and a full `make open-api` regen. The apply endpoint already forwards the whole request DTO to
`service.applyRepair`, so `manualMove` rides through with **no controller change** — only the schema and tests
change. The service-side behaviour of `manualMove` is Slice 3; this slice only carries it across the wire.

**Tech Stack:** NestJS controllers, `nestjs-zod` `createZodDto`, Zod v4 (`z.uuidv4()`, `.refine(fn,{error,path})`,
`.meta({id})`), Vitest unit (`newTestService`) + controller tests (`controllerSetup` + supertest), OpenAPI
Generator v7.12.0 (Dart, needs Java — Java 21 present) + oazapfts (TS).

**Spec:** [`2026-06-25-face-cleanup-add-faces-design.md`](2026-06-25-face-cleanup-add-faces-design.md) — Slice 2;
Architecture §Server.1, §Server.2, §OpenAPI; edge cases E14, E17.

## Global Constraints

- **Zod v4 patterns** (match the existing file): `import z from 'zod'`; UUIDs via `z.uuidv4()`; cross-field
  validation via `.refine((value) => …, { error: '…', path: ['…'] })` placed on the `z.object({…})` and
  **before** `.meta({ id })`; every request/response schema ends with `.meta({ id: '…Dto' })` then
  `export class … extends createZodDto(…)`.
- **No inline `z.enum()` in DTOs** — it generates an anonymous SDK enum that renumbers oazapfts's `Type`/`Type2`
  pool and silently repoints unrelated consumers (see the comment at `face-repair.dto.ts:161`). Our additions
  use only strings/booleans/uuids/arrays — no enums. Keep it that way.
- **Controller conventions:** `@Authenticated({ admin: true })`, `@Endpoint({ summary, history: new
HistoryBuilder().added('v1') })`, path params via `@Param('personId', new ParseUUIDPipe({ version: '4' }))`.
- **SDK function name:** the cluster-faces controller method MUST be named `getFaceRepairClusterFaces` so the
  generated SDK exports `getFaceRepairClusterFaces` (Slices 5/6 import that exact name).
- **Service imports:** `src/` path alias only; Kysely; no relative imports.
- **Formatting/lint:** Prettier (120/single-quote/trailing-comma/semis); full ESLint deferred to Slice 7; every
  commit `tsc --noEmit`-clean and prettier-clean.
- **OpenAPI regen is mandatory and full:** `make open-api` (TS **and** Dart). A TS-only regen passes locally but
  hides Dart drift and fails the CI "OpenAPI Clients" check. Needs Java (present) + network (the Dart step
  `wget`s mustache templates and `pnpm dlx`es the generator).

---

## File Structure

- Modify: `server/src/dtos/face-repair.dto.ts` — extend `FaceRepairApplyRequestSchema`; add
  `FaceRepairClusterFacesRequestDto` / `FaceRepairClusterFacesResponseDto`.
- Modify: `server/src/dtos/face-repair.dto.spec.ts` — schema validation tests.
- Modify: `server/src/services/face-repair.service.ts` — add the thin `getClusterFaces` method.
- Create: `server/src/services/face-repair.cluster-faces.spec.ts` — unit test for `getClusterFaces`.
- Modify: `server/src/controllers/face-repair-admin.controller.ts` — add the cluster-faces route.
- Modify: `server/src/controllers/face-repair-admin.controller.spec.ts` — cluster-faces + apply route tests.
- Regenerate (Task 5): `open-api/immich-openapi-specs.json`, `open-api/typescript-sdk/src/fetch-client.ts`,
  `mobile/openapi/**` (Dart client).

---

## Task 1: Extend the apply DTO — `manualMove` + relaxed `approvedPersonIds` + refine (TDD)

**Files:**

- Modify: `server/src/dtos/face-repair.dto.ts`
- Test: `server/src/dtos/face-repair.dto.spec.ts`

**Interfaces:**

- Produces (Slice 3 consumes): `FaceRepairApplyRequestDto` now shaped
  `{ approvedPersonIds: string[]; excludeFaceIds?: string[]; manualMove?: { personId: string;
destinationPersonId: string; faceIds?: string[]; entireCluster?: boolean } }`, with `approvedPersonIds`
  defaulting to `[]` and a refine requiring it non-empty unless `manualMove` is present.

- [ ] **Step 1: Write the failing tests**

Add `FaceRepairApplyRequestSchema` to the import at the top of
`server/src/dtos/face-repair.dto.spec.ts` (it currently imports `FaceRepairDeclineRemoveRequestSchema,
FaceRepairScanTriggerRequestSchema`):

```ts
import {
  FaceRepairApplyRequestSchema,
  FaceRepairDeclineRemoveRequestSchema,
  FaceRepairScanTriggerRequestSchema,
} from 'src/dtos/face-repair.dto';
```

Append this describe block to the end of the file:

```ts
describe('FaceRepairApplyRequestSchema', () => {
  const UUID_A = '00000000-0000-4000-a000-000000000001';
  const UUID_B = '00000000-0000-4000-a000-000000000002';
  const UUID_C = '00000000-0000-4000-a000-000000000003';

  it('accepts the legacy flagged-only apply (non-empty approvedPersonIds, no manualMove)', () => {
    expect(FaceRepairApplyRequestSchema.safeParse({ approvedPersonIds: [UUID_A] }).success).toBe(true);
  });

  it('accepts an entire-cluster apply: empty approvedPersonIds WITH manualMove', () => {
    const result = FaceRepairApplyRequestSchema.safeParse({
      approvedPersonIds: [],
      manualMove: { personId: UUID_A, destinationPersonId: UUID_B, entireCluster: true },
    });
    expect(result.success).toBe(true);
  });

  it('defaults approvedPersonIds to [] when omitted but manualMove is present', () => {
    const result = FaceRepairApplyRequestSchema.safeParse({
      manualMove: { personId: UUID_A, destinationPersonId: UUID_B, faceIds: [UUID_C] },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.approvedPersonIds).toEqual([]);
    }
  });

  it('rejects a request that would do nothing: empty approvedPersonIds AND no manualMove', () => {
    expect(FaceRepairApplyRequestSchema.safeParse({ approvedPersonIds: [] }).success).toBe(false);
    expect(FaceRepairApplyRequestSchema.safeParse({}).success).toBe(false);
  });

  it('rejects a manualMove missing destinationPersonId (E17)', () => {
    const result = FaceRepairApplyRequestSchema.safeParse({
      approvedPersonIds: [],
      manualMove: { personId: UUID_A, entireCluster: true },
    });
    expect(result.success).toBe(false);
  });

  it('rejects a manualMove with a non-array faceIds', () => {
    const result = FaceRepairApplyRequestSchema.safeParse({
      manualMove: { personId: UUID_A, destinationPersonId: UUID_B, faceIds: 'nope' },
    });
    expect(result.success).toBe(false);
  });

  it('rejects a non-uuid in approvedPersonIds', () => {
    expect(FaceRepairApplyRequestSchema.safeParse({ approvedPersonIds: ['not-a-uuid'] }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail (red)**

Run: `cd server && npx vitest --config test/vitest.config.mjs run src/dtos/face-repair.dto.spec.ts -t FaceRepairApplyRequestSchema`
Expected: FAIL — `FaceRepairApplyRequestSchema` import is fine, but the current schema has `.min(1)` (no default,
no manualMove), so "accepts empty approvedPersonIds WITH manualMove", "defaults … to []", and the manualMove
cases fail. (If the import itself errors, the symbol name is wrong — it is exported at `face-repair.dto.ts:126`.)

- [ ] **Step 3: Implement the schema change**

In `server/src/dtos/face-repair.dto.ts`, replace the current apply request schema (lines ~126-129):

```ts
export const FaceRepairApplyRequestSchema = z
  .object({ approvedPersonIds: z.array(z.uuidv4()).min(1), excludeFaceIds: z.array(z.uuidv4()).optional() })
  .meta({ id: 'FaceRepairApplyRequestDto' });
export class FaceRepairApplyRequestDto extends createZodDto(FaceRepairApplyRequestSchema) {}
```

with:

```ts
const FaceRepairManualMoveSchema = z.object({
  personId: z.uuidv4(),
  destinationPersonId: z.uuidv4(),
  faceIds: z.array(z.uuidv4()).optional(),
  entireCluster: z.boolean().optional(),
});

export const FaceRepairApplyRequestSchema = z
  .object({
    approvedPersonIds: z.array(z.uuidv4()).default([]),
    excludeFaceIds: z.array(z.uuidv4()).optional(),
    manualMove: FaceRepairManualMoveSchema.optional(),
  })
  .refine((value) => value.approvedPersonIds.length > 0 || value.manualMove !== undefined, {
    error: 'approvedPersonIds must be non-empty unless manualMove is provided',
    path: ['approvedPersonIds'],
  })
  .meta({ id: 'FaceRepairApplyRequestDto' });
export class FaceRepairApplyRequestDto extends createZodDto(FaceRepairApplyRequestSchema) {}
```

> `.refine(...).meta(...)` is the established pattern (see `activity.dto.ts:57`). The refine is a cross-field
> constraint, not representable in JSON Schema — OpenAPI emits the object shape and the runtime enforces the
> refine. Both are correct.

- [ ] **Step 4: Run the tests to verify they pass (green)**

Run: `cd server && npx vitest --config test/vitest.config.mjs run src/dtos/face-repair.dto.spec.ts`
Expected: PASS — the new `FaceRepairApplyRequestSchema` cases and the pre-existing decline/scan-trigger cases.

- [ ] **Step 5: Type-check + format**

Run: `cd server && npx tsc --noEmit` → exit 0.
Run: `cd .. && npx prettier --check server/src/dtos/face-repair.dto.ts server/src/dtos/face-repair.dto.spec.ts`
(if it fails, `npx prettier --write` those files and re-run).

- [ ] **Step 6: Commit**

```bash
git add server/src/dtos/face-repair.dto.ts server/src/dtos/face-repair.dto.spec.ts
git commit -m "feat(server): add manualMove to face-repair apply DTO + relax approvedPersonIds"
```

---

## Task 2: Cluster-faces request + response DTOs (TDD)

**Files:**

- Modify: `server/src/dtos/face-repair.dto.ts`
- Test: `server/src/dtos/face-repair.dto.spec.ts`

**Interfaces:**

- Produces (Task 3/4 + Slices 5/6 consume): `FaceRepairClusterFacesRequestDto`
  `{ excludeFaceIds: string[] (default []); page: number (int ≥ 0); size: number (int 1–200) }` and
  `FaceRepairClusterFacesResponseDto` `{ faces: { assetFaceId: string }[]; total: number; hasMore: boolean }`.

- [ ] **Step 1: Write the failing tests**

Add `FaceRepairClusterFacesRequestSchema` to the dto.spec import block, then append:

```ts
describe('FaceRepairClusterFacesRequestSchema', () => {
  const UUID = '00000000-0000-4000-a000-000000000001';

  it('accepts a valid page/size and defaults excludeFaceIds to []', () => {
    const result = FaceRepairClusterFacesRequestSchema.safeParse({ page: 0, size: 50 });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.excludeFaceIds).toEqual([]);
    }
  });

  it('accepts excludeFaceIds and the boundary size of 200', () => {
    expect(FaceRepairClusterFacesRequestSchema.safeParse({ excludeFaceIds: [UUID], page: 3, size: 200 }).success).toBe(
      true,
    );
  });

  it('rejects size below 1 (E14)', () => {
    expect(FaceRepairClusterFacesRequestSchema.safeParse({ page: 0, size: 0 }).success).toBe(false);
  });

  it('rejects size above 200 (E14)', () => {
    expect(FaceRepairClusterFacesRequestSchema.safeParse({ page: 0, size: 201 }).success).toBe(false);
  });

  it('rejects a negative page (E14)', () => {
    expect(FaceRepairClusterFacesRequestSchema.safeParse({ page: -1, size: 50 }).success).toBe(false);
  });

  it('rejects a non-integer size', () => {
    expect(FaceRepairClusterFacesRequestSchema.safeParse({ page: 0, size: 1.5 }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify red**

Run: `cd server && npx vitest --config test/vitest.config.mjs run src/dtos/face-repair.dto.spec.ts -t FaceRepairClusterFacesRequestSchema`
Expected: FAIL — `FaceRepairClusterFacesRequestSchema` is not exported (import resolves to `undefined`).

- [ ] **Step 3: Implement the DTOs**

Append to `server/src/dtos/face-repair.dto.ts` (after the apply DTOs):

```ts
export const FaceRepairClusterFacesRequestSchema = z
  .object({
    excludeFaceIds: z.array(z.uuidv4()).default([]),
    page: z.number().int().min(0),
    size: z.number().int().min(1).max(200),
  })
  .meta({ id: 'FaceRepairClusterFacesRequestDto' });
export class FaceRepairClusterFacesRequestDto extends createZodDto(FaceRepairClusterFacesRequestSchema) {}

export const FaceRepairClusterFacesResponseSchema = z
  .object({
    faces: z.array(z.object({ assetFaceId: z.string() })),
    total: z.number(),
    hasMore: z.boolean(),
  })
  .meta({ id: 'FaceRepairClusterFacesResponseDto' });
export class FaceRepairClusterFacesResponseDto extends createZodDto(FaceRepairClusterFacesResponseSchema) {}
```

- [ ] **Step 4: Run to verify green**

Run: `cd server && npx vitest --config test/vitest.config.mjs run src/dtos/face-repair.dto.spec.ts`
Expected: PASS (all DTO cases).

- [ ] **Step 5: Type-check + format** (same commands as Task 1 Step 5).

- [ ] **Step 6: Commit**

```bash
git add server/src/dtos/face-repair.dto.ts server/src/dtos/face-repair.dto.spec.ts
git commit -m "feat(server): add face-repair cluster-faces request/response DTOs"
```

---

## Task 3: `FaceRepairService.getClusterFaces` — page/size → offset/limit delegation (TDD)

**Files:**

- Modify: `server/src/services/face-repair.service.ts`
- Create: `server/src/services/face-repair.cluster-faces.spec.ts`

**Interfaces:**

- Consumes: `FaceRepairRepository.getClusterFacePage(personId, { excludeFaceIds, limit, offset })` (Slice 1,
  mocked here as `mocks.faceRepair.getClusterFacePage`).
- Produces (Task 4 consumes): `getClusterFaces(personId: string, options: { excludeFaceIds: string[];
page: number; size: number }): Promise<{ faces: { assetFaceId: string }[]; total: number; hasMore: boolean }>`.

- [ ] **Step 1: Write the failing test**

Create `server/src/services/face-repair.cluster-faces.spec.ts`:

```ts
import { FaceRepairService } from 'src/services/face-repair.service';
import { newTestService, ServiceMocks } from 'test/utils';

describe(FaceRepairService.name, () => {
  let sut: FaceRepairService;
  let mocks: ServiceMocks;

  beforeEach(() => {
    ({ sut, mocks } = newTestService(FaceRepairService));
  });

  describe('getClusterFaces', () => {
    it('converts page/size to offset/limit and delegates to the repository', async () => {
      const repoResult = { faces: [{ assetFaceId: 'f1' }], total: 7, hasMore: true };
      mocks.faceRepair.getClusterFacePage.mockResolvedValue(repoResult);

      const result = await sut.getClusterFaces('person-1', { excludeFaceIds: ['x'], page: 2, size: 3 });

      expect(mocks.faceRepair.getClusterFacePage).toHaveBeenCalledWith('person-1', {
        excludeFaceIds: ['x'],
        limit: 3,
        offset: 6, // page * size
      });
      expect(result).toBe(repoResult);
    });

    it('computes offset 0 for the first page', async () => {
      mocks.faceRepair.getClusterFacePage.mockResolvedValue({ faces: [], total: 0, hasMore: false });

      await sut.getClusterFaces('person-2', { excludeFaceIds: [], page: 0, size: 50 });

      expect(mocks.faceRepair.getClusterFacePage).toHaveBeenCalledWith('person-2', {
        excludeFaceIds: [],
        limit: 50,
        offset: 0,
      });
    });
  });
});
```

- [ ] **Step 2: Run to verify red**

Run: `cd server && npx vitest --config test/vitest.config.mjs run src/services/face-repair.cluster-faces.spec.ts`
Expected: FAIL — `sut.getClusterFaces is not a function`.

- [ ] **Step 3: Implement the service method**

Add to the `FaceRepairService` class in `server/src/services/face-repair.service.ts` (place it next to the other
read methods, e.g. after `getPersonFlaggedFaces`):

```ts
  getClusterFaces(
    personId: string,
    options: { excludeFaceIds: string[]; page: number; size: number },
  ): Promise<{ faces: { assetFaceId: string }[]; total: number; hasMore: boolean }> {
    return this.faceRepairRepository.getClusterFacePage(personId, {
      excludeFaceIds: options.excludeFaceIds,
      limit: options.size,
      offset: options.page * options.size,
    });
  }
```

> `this.faceRepairRepository` is the injected repo accessor already used throughout this service (e.g.
> `executeRepair` calls `this.faceRepairRepository.reattributeFaces`). Use the same accessor name.

- [ ] **Step 4: Run to verify green**

Run: `cd server && npx vitest --config test/vitest.config.mjs run src/services/face-repair.cluster-faces.spec.ts`
Expected: PASS (both cases).

- [ ] **Step 5: Type-check + format** (tsc + prettier on the two files).

- [ ] **Step 6: Commit**

```bash
git add server/src/services/face-repair.service.ts server/src/services/face-repair.cluster-faces.spec.ts
git commit -m "feat(server): face-repair getClusterFaces service (page/size delegation)"
```

---

## Task 4: Controller endpoint + apply route tests (TDD)

**Files:**

- Modify: `server/src/controllers/face-repair-admin.controller.ts`
- Test: `server/src/controllers/face-repair-admin.controller.spec.ts`

**Interfaces:**

- Consumes: `service.getClusterFaces` (Task 3) and the existing `service.applyRepair`.
- Produces (Slices 5/6 consume via SDK): route `POST /admin/face-repair/scan/person/:personId/cluster-faces`
  → SDK `getFaceRepairClusterFaces`.

- [ ] **Step 1: Write the failing tests**

Append two describe blocks to `server/src/controllers/face-repair-admin.controller.spec.ts` (inside the outer
`describe(FaceRepairAdminController.name, …)`):

```ts
describe('POST /admin/face-repair/scan/person/:personId/cluster-faces', () => {
  const personId = '00000000-0000-4000-a000-000000000010';
  const faceId = '00000000-0000-4000-a000-000000000011';

  it('should be an authenticated route', async () => {
    await request(ctx.getHttpServer()).post(`/admin/face-repair/scan/person/${personId}/cluster-faces`);
    expect(ctx.authenticate).toHaveBeenCalled();
  });

  it('delegates to service.getClusterFaces and returns the page', async () => {
    service.getClusterFaces.mockResolvedValue({ faces: [{ assetFaceId: faceId }], total: 1, hasMore: false });
    const { status, body } = await request(ctx.getHttpServer())
      .post(`/admin/face-repair/scan/person/${personId}/cluster-faces`)
      .set('Authorization', 'Bearer token')
      .send({ excludeFaceIds: [faceId], page: 0, size: 50 });
    expect(status).toBe(201);
    expect(service.getClusterFaces).toHaveBeenCalledWith(personId, {
      excludeFaceIds: [faceId],
      page: 0,
      size: 50,
    });
    expect(body).toMatchObject({ faces: [{ assetFaceId: faceId }], total: 1, hasMore: false });
  });

  it('rejects size out of range with 400 (E14)', async () => {
    const { status } = await request(ctx.getHttpServer())
      .post(`/admin/face-repair/scan/person/${personId}/cluster-faces`)
      .set('Authorization', 'Bearer token')
      .send({ page: 0, size: 0 });
    expect(status).toBe(400);
    expect(service.getClusterFaces).not.toHaveBeenCalled();
  });

  it('rejects a negative page with 400 (E14)', async () => {
    const { status } = await request(ctx.getHttpServer())
      .post(`/admin/face-repair/scan/person/${personId}/cluster-faces`)
      .set('Authorization', 'Bearer token')
      .send({ page: -1, size: 50 });
    expect(status).toBe(400);
    expect(service.getClusterFaces).not.toHaveBeenCalled();
  });

  it('rejects a non-uuid personId with 400', async () => {
    const { status } = await request(ctx.getHttpServer())
      .post('/admin/face-repair/scan/person/not-a-uuid/cluster-faces')
      .set('Authorization', 'Bearer token')
      .send({ page: 0, size: 50 });
    expect(status).toBe(400);
    expect(service.getClusterFaces).not.toHaveBeenCalled();
  });
});

describe('POST /admin/face-repair/apply', () => {
  const personId = '00000000-0000-4000-a000-000000000020';
  const destId = '00000000-0000-4000-a000-000000000021';

  it('should be an authenticated route', async () => {
    await request(ctx.getHttpServer()).post('/admin/face-repair/apply');
    expect(ctx.authenticate).toHaveBeenCalled();
  });

  it('delegates the legacy flagged-only apply to service.applyRepair', async () => {
    service.applyRepair.mockResolvedValue({ moved: 2, skipped: 0 });
    const { status } = await request(ctx.getHttpServer())
      .post('/admin/face-repair/apply')
      .set('Authorization', 'Bearer token')
      .send({ approvedPersonIds: [personId] });
    expect(status).toBe(201);
    expect(service.applyRepair).toHaveBeenCalledWith(expect.objectContaining({ approvedPersonIds: [personId] }));
  });

  it('passes a manualMove block (empty approvedPersonIds) through to service.applyRepair', async () => {
    service.applyRepair.mockResolvedValue({ moved: 5, skipped: 0 });
    const manualMove = { personId, destinationPersonId: destId, entireCluster: true };
    const { status } = await request(ctx.getHttpServer())
      .post('/admin/face-repair/apply')
      .set('Authorization', 'Bearer token')
      .send({ approvedPersonIds: [], manualMove });
    expect(status).toBe(201);
    expect(service.applyRepair).toHaveBeenCalledWith(expect.objectContaining({ manualMove }));
  });

  it('rejects empty approvedPersonIds with no manualMove (400, refine)', async () => {
    const { status } = await request(ctx.getHttpServer())
      .post('/admin/face-repair/apply')
      .set('Authorization', 'Bearer token')
      .send({ approvedPersonIds: [] });
    expect(status).toBe(400);
    expect(service.applyRepair).not.toHaveBeenCalled();
  });

  it('rejects a manualMove missing destinationPersonId with 400 (E17)', async () => {
    const { status } = await request(ctx.getHttpServer())
      .post('/admin/face-repair/apply')
      .set('Authorization', 'Bearer token')
      .send({ approvedPersonIds: [], manualMove: { personId, entireCluster: true } });
    expect(status).toBe(400);
    expect(service.applyRepair).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify red**

Run: `cd server && npx vitest --config test/vitest.config.mjs run src/controllers/face-repair-admin.controller.spec.ts -t "cluster-faces"`
Expected: FAIL — the cluster-faces route does not exist (404, so `status` is not 201 and `service.getClusterFaces`
is never called). The apply-route block also fails its `manualMove` passthrough until the route compiles.

- [ ] **Step 3: Implement the controller route**

In `server/src/controllers/face-repair-admin.controller.ts`:

Add the two new DTOs to the existing import from `src/dtos/face-repair.dto`:

```ts
  FaceRepairClusterFacesRequestDto,
  FaceRepairClusterFacesResponseDto,
```

Add this route inside the controller class (place it right after `getFaceRepairPersonFaces`, keeping the
`scan/person/:personId` routes together):

```ts
  @Post('scan/person/:personId/cluster-faces')
  @Authenticated({ admin: true })
  @Endpoint({
    summary: "List a person's cluster faces (paginated, excluding the supplied flagged ids)",
    history: new HistoryBuilder().added('v1'),
  })
  getFaceRepairClusterFaces(
    @Param('personId', new ParseUUIDPipe({ version: '4' })) personId: string,
    @Body() dto: FaceRepairClusterFacesRequestDto,
  ): Promise<FaceRepairClusterFacesResponseDto> {
    return this.service.getClusterFaces(personId, dto) as Promise<FaceRepairClusterFacesResponseDto>;
  }
```

> No change to `applyFaceRepair` is needed — it already does `return this.service.applyRepair(dto)` and `dto`
> now carries `manualMove`, so the block is forwarded as-is. The `as Promise<…>` cast matches the existing
> style in this controller (the service returns the structural shape; the cast satisfies the DTO class type).

- [ ] **Step 4: Run to verify green**

Run: `cd server && npx vitest --config test/vitest.config.mjs run src/controllers/face-repair-admin.controller.spec.ts`
Expected: PASS — the new cluster-faces + apply blocks **and** the pre-existing controller cases.

- [ ] **Step 5: Type-check + format** (tsc + prettier on the controller + its spec).

- [ ] **Step 6: Commit**

```bash
git add server/src/controllers/face-repair-admin.controller.ts server/src/controllers/face-repair-admin.controller.spec.ts
git commit -m "feat(server): cluster-faces admin endpoint + apply manualMove passthrough tests"
```

---

## Task 5: OpenAPI regen (TS + Dart) — verification only

**Files:** regenerated artifacts (no hand edits):

- `open-api/immich-openapi-specs.json`
- `open-api/typescript-sdk/src/fetch-client.ts`
- `mobile/openapi/**` (Dart client + new model files)

- [ ] **Step 1: Run the full regen**

Run (from the worktree root, NOT `server/`): `make open-api`
This builds the server, re-syncs `immich-openapi-specs.json` from the controllers/DTOs, then regenerates the Dart
client (OpenAPI Generator, Java) and the TS SDK (oazapfts) and builds `@immich/sdk`. Expect several minutes and
network access (the Dart step `wget`s mustache templates). Expected: completes with no error.

> If the Dart step fails on a `wget`/network or `pnpm dlx` error, it is environmental — retry once. If
> `make open-api` fails inside the server build, fix the underlying TS error (it will name the file) before
> proceeding; do not hand-edit generated files.

- [ ] **Step 2: Confirm the regen is scoped to this slice's additions**

Run: `git status --short` and `git diff --stat`
Expected changed files: `open-api/immich-openapi-specs.json`, `open-api/typescript-sdk/src/fetch-client.ts`,
and files under `mobile/openapi/`. Spot-check that the spec/SDK now contain:

- `getFaceRepairClusterFaces` (TS): `grep -n "getFaceRepairClusterFaces" open-api/typescript-sdk/src/fetch-client.ts`
- `FaceRepairClusterFacesRequestDto` / `FaceRepairClusterFacesResponseDto` and `manualMove` in the spec:
  `grep -n "FaceRepairClusterFaces\|manualMove" open-api/immich-openapi-specs.json`
- New Dart model files exist: `ls mobile/openapi/lib/model | grep -i "cluster_faces\|manual_move"`

If unrelated endpoints/DTOs changed, the committed spec had pre-existing drift — that is expected to be corrected
by a full regen; note it in the report but do not revert it.

- [ ] **Step 3: Type-check the SDK + server**

Run: `cd server && npx tsc --noEmit` → exit 0 (server still compiles against the regenerated spec source).

- [ ] **Step 4: Commit**

```bash
git add open-api/immich-openapi-specs.json open-api/typescript-sdk/src/fetch-client.ts mobile/openapi
git commit -m "chore(api): regenerate OpenAPI clients for cluster-faces + manualMove"
```

> The TS SDK `build/` directory is git-ignored — do not add it. Committing the regenerated `src/fetch-client.ts`
> is what matters; CI rebuilds the SDK.

---

## Self-Review

- **Spec coverage (Slice 2):** cluster-faces endpoint (Task 4) ✓; apply DTO `manualMove` + relaxed
  `approvedPersonIds` + refine (Task 1) ✓; cluster-faces DTOs (Task 2) ✓; page/size→offset/limit service
  delegation (Task 3) ✓; full OpenAPI regen TS+Dart (Task 5) ✓. Edge cases: E14 (size/page validation — dto.spec
  Task 2 + controller Task 4) ✓; E17 (manualMove missing destinationPersonId rejected — dto.spec Task 1 +
  controller Task 4) ✓.
- **Placeholders:** none — full schema/method/route/test code and exact commands.
- **Type consistency:** `getClusterFaces(personId, { excludeFaceIds, page, size })` and the
  `{ faces: { assetFaceId }[]; total; hasMore }` return shape are identical across the DTO (Task 2), service
  (Task 3), and controller (Task 4). `manualMove` shape `{ personId, destinationPersonId, faceIds?,
entireCluster? }` is identical in the DTO (Task 1) and the controller passthrough; Slice 3 consumes exactly
  this shape. SDK fn name pinned to `getFaceRepairClusterFaces`.
- **Carry-forward to Slice 3:** `applyRepair`'s input type must be widened to accept `manualMove?` and the
  manual-move behaviour implemented; the controller already forwards it. Slices 5/6 import
  `getFaceRepairClusterFaces` and the extended `FaceRepairApplyRequestDto` from `@immich/sdk`.
