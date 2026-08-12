# Face Cleanup Advanced Scan Tuning — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an admin fine-tune a single Face Cleanup scan from a curated "Advanced" modal (match sensitivity, min faces, contamination cap), without changing global facial-recognition settings or the scan engine.

**Architecture:** The scan pipeline already persists per-scan params (`createScan({ params })`) and the job already reads them (`handleFaceRepairScan` → `storedParams`). Only the trigger hardcodes them. We add an optional `params` body to `POST /admin/face-repair/scan`, a `GET /admin/face-repair/scan/defaults` read for pre-fill, and a dashboard modal. Tuned values are per-scan transient — no new storage, no engine change.

**Tech Stack:** NestJS + Kysely + nestjs-zod (server), SvelteKit + Svelte 5 runes + `@immich/ui` `FormModal` (web), oazapfts SDK, Vitest.

**Spec:** [`2026-06-06-face-cleanup-advanced-scan-design.md`](2026-06-06-face-cleanup-advanced-scan-design.md)

**Reference facts (already verified in the codebase):**

- `server/src/services/face-repair.service.ts:392` — `triggerScan(requestedBy)` hardcodes params and queues `JobName.FaceRepairScan`.
- Defaults: `DEFAULT_VOTE_WINDOW=200`, `DEFAULT_VOTE_MARGIN=2`, `DEFAULT_MAX_ATTRIBUTION_DISTANCE=0.35`, `DEFAULT_MAX_FLAGGED_FRACTION=0.5`, `DEFAULT_LARGE_CLUSTER_THRESHOLD=50` (`face-repair.service.ts:37-41`).
- `createScan({ requestedBy, params: RepairScanParams })` (`face-repair-scan.repository.ts:60`); `RepairScanParams` has all 7 numeric fields (`:8-17`).
- `handleFaceRepairScan` already reads `storedParams?.X ?? DEFAULT` (`face-repair.service.ts:294-300`).
- Existing range rules on `FaceRepairRequestSchema` (`face-repair.dto.ts:4-16`): `maxDistance` `z.number().gt(0).max(2)`, `minFaces` `z.number().int().min(1)`, `voteWindow` `z.number().int().min(1)`, `voteMargin` `z.number().int().min(0)`, `maxAttributionDistance` `z.number().gt(0).max(2)`, `maxFlaggedFraction` `z.number().min(0).max(1)`.
- Controller: `server/src/controllers/face-repair-admin.controller.ts` (`triggerScan` at `:41`).
- Dashboard Re-scan button: `web/src/routes/admin/face-cleanup/+page.svelte:240-248`; `handleRescan` at `:135`; imports `triggerScan` from `@immich/sdk` at `:6`.
- Modal pattern: `web/src/lib/modals/ApiKeyCreateModal.svelte` (`FormModal`, `Field`, `Input`, `modalManager.show`).
- Unit-test pattern: `newTestService(FaceRepairService)` + `mocks.systemMetadata.get.mockResolvedValue(null)` (`face-repair.person.spec.ts`); spy instance methods with `vi.spyOn(sut, 'method')`.

---

## File Structure

- **Modify** `server/src/dtos/face-repair.dto.ts` — add `FaceRepairScanParamsSchema`, `FaceRepairScanTriggerRequestSchema`, `FaceRepairScanDefaultsSchema` + DTO classes.
- **Modify** `server/src/services/face-repair.service.ts` — `triggerScan(requestedBy, overrides?)` merges overrides; new `getScanDefaults()`.
- **Modify** `server/src/controllers/face-repair-admin.controller.ts` — `triggerScan` takes `@Body()`; new `GET scan/defaults`.
- **Modify** `server/src/dtos/face-repair.dto.spec.ts` — DTO validation tests (extend existing file).
- **Modify** `server/src/controllers/face-repair-admin.controller.spec.ts` — trigger-with-body + defaults delegation.
- **Create** `server/src/services/face-repair.scan-defaults.spec.ts` — `getScanDefaults` unit test.
- **Modify** `server/test/medium/specs/services/face-repair.scan.spec.ts` — params-reach-engine medium test.
- **Regen** `open-api/immich-openapi-specs.json`, `open-api/typescript-sdk/src/fetch-client.ts`, `mobile/openapi/**`.
- **Create** `web/src/routes/admin/face-cleanup/AdvancedScanModal.svelte` — the modal.
- **Create** `web/src/routes/admin/face-cleanup/AdvancedScanModal.spec.ts` — modal component test.
- **Modify** `web/src/routes/admin/face-cleanup/+page.svelte` — Advanced button + open handler + tuned trigger.
- **Modify** `i18n/en.json` — labels/help/buttons.

---

## Task 1: Server — scan trigger accepts an optional `params` body

**Files:**

- Modify: `server/src/dtos/face-repair.dto.ts`
- Modify: `server/src/services/face-repair.service.ts:392-415`
- Modify: `server/src/controllers/face-repair-admin.controller.ts:38-43`
- Test: `server/src/dtos/face-repair.dto.spec.ts`, `server/src/controllers/face-repair-admin.controller.spec.ts`

- [ ] **Step 1: Write failing DTO tests** — append to `server/src/dtos/face-repair.dto.spec.ts`:

```ts
import { FaceRepairDeclineRemoveRequestSchema, FaceRepairScanTriggerRequestSchema } from 'src/dtos/face-repair.dto';

describe('FaceRepairScanTriggerRequestSchema', () => {
  it('accepts an empty body (quick-path Re-scan)', () => {
    expect(FaceRepairScanTriggerRequestSchema.safeParse({}).success).toBe(true);
  });

  it('accepts the curated params', () => {
    const r = FaceRepairScanTriggerRequestSchema.safeParse({
      params: { maxDistance: 0.45, minFaces: 4, maxFlaggedFraction: 0.3 },
    });
    expect(r.success).toBe(true);
  });

  it('accepts the non-curated params too (full optional set; future raw panel)', () => {
    const r = FaceRepairScanTriggerRequestSchema.safeParse({
      params: { voteWindow: 100, voteMargin: 0, maxAttributionDistance: 0.4, largeClusterThreshold: 80 },
    });
    expect(r.success).toBe(true);
  });

  it('rejects maxDistance above 2', () => {
    expect(FaceRepairScanTriggerRequestSchema.safeParse({ params: { maxDistance: 2.5 } }).success).toBe(false);
  });

  it('rejects maxFlaggedFraction above 1', () => {
    expect(FaceRepairScanTriggerRequestSchema.safeParse({ params: { maxFlaggedFraction: 1.5 } }).success).toBe(false);
  });

  it('rejects minFaces below 1', () => {
    expect(FaceRepairScanTriggerRequestSchema.safeParse({ params: { minFaces: 0 } }).success).toBe(false);
  });
});
```

(Keep the existing `FaceRepairDeclineRemoveRequestSchema` import line; merge, don't duplicate.)

- [ ] **Step 2: Run to verify failure**

Run: `export PATH="$HOME/.local/share/mise/shims:$PATH"; cd server && pnpm test -- --run src/dtos/face-repair.dto.spec.ts`
Expected: FAIL — `FaceRepairScanTriggerRequestSchema` is not exported.

- [ ] **Step 3: Add the schemas** — in `server/src/dtos/face-repair.dto.ts`, after `FaceRepairScanTriggerResponseSchema` (around line 55):

```ts
const FaceRepairScanParamsSchema = z.object({
  maxDistance: z.number().gt(0).max(2).optional(),
  minFaces: z.number().int().min(1).optional(),
  voteWindow: z.number().int().min(1).optional(),
  voteMargin: z.number().int().min(0).optional(),
  maxAttributionDistance: z.number().gt(0).max(2).optional(),
  maxFlaggedFraction: z.number().min(0).max(1).optional(),
  largeClusterThreshold: z.number().int().min(1).optional(),
});

export const FaceRepairScanTriggerRequestSchema = z
  .object({ params: FaceRepairScanParamsSchema.optional() })
  .meta({ id: 'FaceRepairScanTriggerRequestDto' });
export class FaceRepairScanTriggerRequestDto extends createZodDto(FaceRepairScanTriggerRequestSchema) {}
```

- [ ] **Step 4: Run DTO tests to verify pass**

Run: `cd server && pnpm test -- --run src/dtos/face-repair.dto.spec.ts`
Expected: PASS (all decline + scan-trigger cases).

- [ ] **Step 5: Thread params through the service** — in `server/src/services/face-repair.service.ts`, replace `triggerScan` (`:392-415`):

```ts
  async triggerScan(
    requestedBy: string,
    overrides?: {
      maxDistance?: number;
      minFaces?: number;
      voteWindow?: number;
      voteMargin?: number;
      maxAttributionDistance?: number;
      maxFlaggedFraction?: number;
      largeClusterThreshold?: number;
    },
  ): Promise<{ scanId: string }> {
    if (await this.jobRepository.isActive(QueueName.FacialRecognition)) {
      throw new ConflictException('Refusing to scan while facial recognition is active');
    }
    const { machineLearning } = await this.getConfig({ withCache: true });
    const recognition = machineLearning.facialRecognition;
    const params = {
      maxDistance: overrides?.maxDistance ?? recognition.maxDistance,
      minFaces: overrides?.minFaces ?? recognition.minFaces,
      voteWindow: overrides?.voteWindow ?? DEFAULT_VOTE_WINDOW,
      voteMargin: overrides?.voteMargin ?? DEFAULT_VOTE_MARGIN,
      maxAttributionDistance: overrides?.maxAttributionDistance ?? DEFAULT_MAX_ATTRIBUTION_DISTANCE,
      maxFlaggedFraction: overrides?.maxFlaggedFraction ?? DEFAULT_MAX_FLAGGED_FRACTION,
      largeClusterThreshold: overrides?.largeClusterThreshold ?? DEFAULT_LARGE_CLUSTER_THRESHOLD,
    };
    let scan;
    try {
      scan = await this.faceRepairScanRepository.createScan({ requestedBy, params });
    } catch {
      throw new ConflictException('A face-repair scan is already in progress');
    }
    await this.jobRepository.queue({ name: JobName.FaceRepairScan, data: { scanId: scan.id } });
    return { scanId: scan.id };
  }
```

(Only the signature and the `overrides?.X ??` prefixes change; the default fallbacks are byte-identical to today, so an empty body reproduces the current behavior exactly.)

- [ ] **Step 6: Wire the controller** — in `server/src/controllers/face-repair-admin.controller.ts`, update the trigger handler (`:38-43`) and add the DTO import:

```ts
  @Post('scan')
  @Authenticated({ admin: true })
  @Endpoint({ summary: 'Trigger a face-repair scan', history: new HistoryBuilder().added('v1') })
  triggerScan(
    @Auth() auth: AuthDto,
    @Body() dto: FaceRepairScanTriggerRequestDto,
  ): Promise<FaceRepairScanTriggerResponseDto> {
    return this.service.triggerScan(auth.user.id, dto.params) as Promise<FaceRepairScanTriggerResponseDto>;
  }
```

`Body` is **already imported** from `@nestjs/common` (used by the decline routes) — do not re-add it. Only add `FaceRepairScanTriggerRequestDto` to the existing dtos import block.

- [ ] **Step 7: Update controller spec** — in `server/src/controllers/face-repair-admin.controller.spec.ts`, find the `POST /admin/face-repair/scan` describe block and replace its delegation assertions with:

```ts
it('delegates a no-body scan (quick path) with undefined params', async () => {
  service.triggerScan.mockResolvedValue({ scanId: 's1' });
  const { status } = await request(ctx.getHttpServer())
    .post('/admin/face-repair/scan')
    .set('Authorization', 'Bearer token')
    .send({});
  expect(status).toBe(201);
  expect(service.triggerScan).toHaveBeenCalledWith(expect.any(String), undefined);
});

it('delegates tuned params to the service', async () => {
  service.triggerScan.mockResolvedValue({ scanId: 's2' });
  const params = { maxDistance: 0.4, minFaces: 5, maxFlaggedFraction: 0.3 };
  const { status } = await request(ctx.getHttpServer())
    .post('/admin/face-repair/scan')
    .set('Authorization', 'Bearer token')
    .send({ params });
  expect(status).toBe(201);
  expect(service.triggerScan).toHaveBeenCalledWith(expect.any(String), params);
});

it('rejects out-of-range params with 400', async () => {
  const { status } = await request(ctx.getHttpServer())
    .post('/admin/face-repair/scan')
    .set('Authorization', 'Bearer token')
    .send({ params: { maxDistance: 9 } });
  expect(status).toBe(400);
  expect(service.triggerScan).not.toHaveBeenCalled();
});
```

Keep the existing "should be an authenticated route" test in this block. POST returns **201** here (verified: the existing scan/apply POST tests assert `201`; GET/DELETE assert `200`).

- [ ] **Step 8: Run server unit tests**

Run: `cd server && pnpm test -- --run src/dtos/face-repair.dto.spec.ts src/controllers/face-repair-admin.controller.spec.ts`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add server/src/dtos/face-repair.dto.ts server/src/services/face-repair.service.ts server/src/controllers/face-repair-admin.controller.ts server/src/dtos/face-repair.dto.spec.ts server/src/controllers/face-repair-admin.controller.spec.ts
git commit -m "feat(face-repair): accept optional tuning params on the scan trigger"
```

---

## Task 2: Server — effective-defaults read endpoint

**Files:**

- Modify: `server/src/dtos/face-repair.dto.ts`
- Modify: `server/src/services/face-repair.service.ts` (add `getScanDefaults`)
- Modify: `server/src/controllers/face-repair-admin.controller.ts`
- Create: `server/src/services/face-repair.scan-defaults.spec.ts`

- [ ] **Step 1: Write the failing service test** — create `server/src/services/face-repair.scan-defaults.spec.ts`:

```ts
import { FaceRepairService } from 'src/services/face-repair.service';
import { newTestService } from 'test/utils';

describe(`${FaceRepairService.name}.getScanDefaults`, () => {
  it('returns config maxDistance/minFaces and the default flagged-fraction cap', async () => {
    const { sut } = newTestService(FaceRepairService);
    vi.spyOn(sut, 'getConfig').mockResolvedValue({
      machineLearning: { facialRecognition: { maxDistance: 0.5, minFaces: 3 } },
    } as any);

    const result = await sut.getScanDefaults();

    expect(result).toEqual({ maxDistance: 0.5, minFaces: 3, maxFlaggedFraction: 0.5 });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd server && pnpm test -- --run src/services/face-repair.scan-defaults.spec.ts`
Expected: FAIL — `getScanDefaults` is not a function.

- [ ] **Step 3: Add the service method** — in `server/src/services/face-repair.service.ts`, immediately after `triggerScan`:

```ts
  async getScanDefaults(): Promise<{ maxDistance: number; minFaces: number; maxFlaggedFraction: number }> {
    const { machineLearning } = await this.getConfig({ withCache: true });
    const recognition = machineLearning.facialRecognition;
    return {
      maxDistance: recognition.maxDistance,
      minFaces: recognition.minFaces,
      maxFlaggedFraction: DEFAULT_MAX_FLAGGED_FRACTION,
    };
  }
```

- [ ] **Step 4: Run to verify pass**

Run: `cd server && pnpm test -- --run src/services/face-repair.scan-defaults.spec.ts`
Expected: PASS.

- [ ] **Step 5: Add the DTO** — in `server/src/dtos/face-repair.dto.ts`, after `FaceRepairScanTriggerRequestDto`:

```ts
export const FaceRepairScanDefaultsSchema = z
  .object({
    maxDistance: z.number(),
    minFaces: z.number(),
    maxFlaggedFraction: z.number(),
  })
  .meta({ id: 'FaceRepairScanDefaultsDto' });
export class FaceRepairScanDefaultsDto extends createZodDto(FaceRepairScanDefaultsSchema) {}
```

- [ ] **Step 6: Add the controller route** — in `server/src/controllers/face-repair-admin.controller.ts`, after the `triggerScan` handler:

```ts
  @Get('scan/defaults')
  @Authenticated({ admin: true })
  @Endpoint({ summary: 'Get effective face-repair scan defaults', history: new HistoryBuilder().added('v1') })
  getFaceRepairScanDefaults(): Promise<FaceRepairScanDefaultsDto> {
    return this.service.getScanDefaults() as Promise<FaceRepairScanDefaultsDto>;
  }
```

Add `FaceRepairScanDefaultsDto` to the dtos import block. (Place this route before `@Get('scan/person/:personId')` so `defaults` is not captured as a `:personId` param.)

- [ ] **Step 7: Add controller delegation spec** — in `server/src/controllers/face-repair-admin.controller.spec.ts`, add:

```ts
describe('GET /admin/face-repair/scan/defaults', () => {
  it('should be an authenticated route', async () => {
    await request(ctx.getHttpServer()).get('/admin/face-repair/scan/defaults');
    expect(ctx.authenticate).toHaveBeenCalled();
  });

  it('delegates to service.getScanDefaults', async () => {
    service.getScanDefaults.mockResolvedValue({ maxDistance: 0.5, minFaces: 3, maxFlaggedFraction: 0.5 });
    const { status, body } = await request(ctx.getHttpServer())
      .get('/admin/face-repair/scan/defaults')
      .set('Authorization', 'Bearer token');
    expect(status).toBe(200);
    expect(body).toMatchObject({ maxDistance: 0.5, minFaces: 3, maxFlaggedFraction: 0.5 });
  });
});
```

- [ ] **Step 8: Run unit tests**

Run: `cd server && pnpm test -- --run src/services/face-repair.scan-defaults.spec.ts src/controllers/face-repair-admin.controller.spec.ts`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add server/src/dtos/face-repair.dto.ts server/src/services/face-repair.service.ts server/src/controllers/face-repair-admin.controller.ts server/src/services/face-repair.scan-defaults.spec.ts server/src/controllers/face-repair-admin.controller.spec.ts
git commit -m "feat(face-repair): add scan defaults read endpoint"
```

---

## Task 3: Server medium — tuned params actually reach the engine

**Files:**

- Modify: `server/test/medium/specs/services/face-repair.scan.spec.ts`

This proves the wiring end-to-end on a real DB via a **two-scan contrast**: the SAME contaminated cluster is repairable at the default cap but goes review-only (over-cap) at a tuned low cap. The over-cap rule is `flagged / eligible > maxFlaggedFraction` (`face-repair.service.ts:120`), so the contamination must sit **between** the two caps: ~27% (3 leaked of 11 eligible) is **under** the 0.5 default (→ `toRepair`) but **over** the 0.1 tuned cap (→ `reviewOnly`). A 60% fixture would be over-cap at _both_ caps and the test would pass even if params never flowed — so the level is load-bearing.

- [ ] **Step 1: Add the medium test** — append inside the existing `describe('FaceRepairService.handleFaceRepairScan', ...)` block in `server/test/medium/specs/services/face-repair.scan.spec.ts`. It reuses the file's `axisEmbedding`, `setup`, `db`, and `ctx` helpers (mirrors the existing "flagged person" fixture: 3 leaked + 8 genuine):

```ts
it('triggerScan overrides flow to the engine: maxFlaggedFraction flips a cluster repairable→review-only', async () => {
  const { sut, ctx } = setup();
  const jobMock = ctx.getMock(JobRepository);
  jobMock.isActive.mockResolvedValue(false);
  jobMock.queue.mockResolvedValue(undefined);
  const { user } = await ctx.newUser();

  // Reference owner Karina: 10 first-axis faces, so the leaked faces have a clean cluster to vote toward.
  const karina = mediumFactory.personInsert({ ownerId: user.id, name: 'Karina' });
  await db.insertInto('person').values(karina).execute();
  for (let i = 0; i < 10; i++) {
    const { asset } = await ctx.newAsset({ ownerId: user.id });
    const { assetFace } = await ctx.newAssetFace({ assetId: asset.id, personId: karina.id });
    await db
      .insertInto('face_search')
      .values({ faceId: assetFace.id, embedding: axisEmbedding('first') })
      .execute();
  }

  // Unnamed cluster: 3 leaked first-axis + 8 genuine second-axis → 3/11 ≈ 27% flagged.
  const cluster = mediumFactory.personInsert({ ownerId: user.id, name: '' });
  await db.insertInto('person').values(cluster).execute();
  for (let i = 0; i < 3; i++) {
    const { asset } = await ctx.newAsset({ ownerId: user.id });
    const { assetFace } = await ctx.newAssetFace({ assetId: asset.id, personId: cluster.id });
    await db
      .insertInto('face_search')
      .values({ faceId: assetFace.id, embedding: axisEmbedding('first') })
      .execute();
  }
  for (let i = 0; i < 8; i++) {
    const { asset } = await ctx.newAsset({ ownerId: user.id });
    const { assetFace } = await ctx.newAssetFace({ assetId: asset.id, personId: cluster.id });
    await db
      .insertInto('face_search')
      .values({ faceId: assetFace.id, embedding: axisEmbedding('second') })
      .execute();
  }

  // Default run (no overrides): 27% < 0.5 cap → the leaked faces are repairable, none over-cap.
  const a = await sut.triggerScan(user.id);
  await sut.handleFaceRepairScan({ scanId: a.scanId });
  const defaultRun = await sut.getLatestScanStatus();
  expect(defaultRun!.status).toBe('completed');
  expect(defaultRun!.totals!.toRepair).toBeGreaterThan(0);
  expect(defaultRun!.totals!.reviewOnlyByReason.overCap).toBe(0);

  // Clear the scan row so the tuned run is unambiguously the latest (and avoids any active-scan guard).
  await db.deleteFrom('face_repair_scan').execute();

  // Tuned run: 27% > 0.1 cap → the SAME faces go review-only (over-cap), none repaired.
  const b = await sut.triggerScan(user.id, { maxFlaggedFraction: 0.1 });
  await sut.handleFaceRepairScan({ scanId: b.scanId });
  const tunedRun = await sut.getLatestScanStatus();
  expect(tunedRun!.status).toBe('completed');
  expect(tunedRun!.totals!.toRepair).toBe(0);
  expect(tunedRun!.totals!.reviewOnlyByReason.overCap).toBeGreaterThan(0);
});
```

The file already imports `JobRepository` (in its `mock:` list) and `mediumFactory` (from `test/medium.factory`); no new imports needed. `db` is the module-level `Kysely` handle already used by the other tests.

- [ ] **Step 2: Note on running** — medium tests need Docker (not available locally). They run in CI. Mark this step done after the code is written; CI's `Medium Tests` job is the gate.

- [ ] **Step 3: Commit**

```bash
git add server/test/medium/specs/services/face-repair.scan.spec.ts
git commit -m "test(face-repair): medium test that triggerScan params reach the engine"
```

---

## Task 4: Regenerate OpenAPI spec + SDKs

**Files:** `open-api/immich-openapi-specs.json`, `open-api/typescript-sdk/src/fetch-client.ts`, `mobile/openapi/**`

- [ ] **Step 1: Build the server** (the spec sync reads `dist/`)

Run: `export PATH="$HOME/.local/share/mise/shims:$PATH"; cd server && pnpm build`
Expected: builds with no errors.

- [ ] **Step 2: Sync the spec**

Run: `cd server && pnpm sync:open-api`
Expected: prints `Done`; `git status` shows `open-api/immich-openapi-specs.json` modified.

- [ ] **Step 3: Verify the spec diff** — confirm the new `FaceRepairScanTriggerRequestDto` (with optional `params`) and `FaceRepairScanDefaultsDto`, and that `POST /admin/face-repair/scan` now has a request body and `GET /admin/face-repair/scan/defaults` exists.

Run: `git --no-pager diff open-api/immich-openapi-specs.json | grep -E "FaceRepairScanTriggerRequestDto|FaceRepairScanDefaultsDto|scan/defaults"`
Expected: shows the new schema ids and path.

- [ ] **Step 4: Regenerate clients**

Run: `cd .. && make open-api`
Expected: TS SDK builds (tsc), Dart client generated + patched, no errors.

- [ ] **Step 5: Confirm SDK functions exist**

Run: `grep -nE "export function triggerScan|export function getFaceRepairScanDefaults" open-api/typescript-sdk/src/fetch-client.ts`
Expected: both present; `triggerScan` now takes an optional `{ faceRepairScanTriggerRequestDto }` body arg.

- [ ] **Step 6: Commit**

```bash
git add open-api mobile/openapi
git commit -m "chore(open-api): regenerate for scan params + defaults endpoint"
```

---

## Task 5: Web — Advanced modal + dashboard wiring

**Files:**

- Create: `web/src/routes/admin/face-cleanup/AdvancedScanModal.svelte`
- Create: `web/src/routes/admin/face-cleanup/AdvancedScanModal.spec.ts`
- Modify: `web/src/routes/admin/face-cleanup/+page.svelte`
- Modify: `i18n/en.json`

- [ ] **Step 1: Add i18n keys** — in `i18n/en.json`, insert in alphabetical order within the `admin` block (near the other `face_cleanup_*` keys):

```json
    "face_cleanup_advanced": "Advanced",
    "face_cleanup_advanced_apply": "Run scan",
    "face_cleanup_advanced_cap": "Contamination cap",
    "face_cleanup_advanced_cap_help": "If more than this share of a person's faces look wrong, send the whole cluster to review-only instead of auto-repairing. Higher = more aggressive auto-repair.",
    "face_cleanup_advanced_min_faces": "Minimum faces per person",
    "face_cleanup_advanced_min_faces_help": "Skip people with fewer faces than this.",
    "face_cleanup_advanced_reset": "Reset to defaults",
    "face_cleanup_advanced_sensitivity": "Match sensitivity",
    "face_cleanup_advanced_sensitivity_help": "How close two faces must look to be treated as the same person. Lower = stricter (fewer matches); higher = looser (more matches).",
    "face_cleanup_advanced_subtitle": "Fine-tune this scan. Applies to this run only.",
    "face_cleanup_advanced_title": "Advanced scan",
```

(Place each key so the block stays sorted — e.g. `face_cleanup_advanced*` come right before `face_cleanup_apply_*`.)

- [ ] **Step 2: Write the failing modal component test** — create `web/src/routes/admin/face-cleanup/AdvancedScanModal.spec.ts`. Covers pre-fill, submit (numeric coercion), and the defaults-failure fallback:

```ts
import '@testing-library/jest-dom';
import { render, screen, waitFor } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getFaceRepairScanDefaults } from '@immich/sdk';
import AdvancedScanModal from './AdvancedScanModal.svelte';

vi.mock('@immich/sdk', () => ({ getFaceRepairScanDefaults: vi.fn() }));

const mockDefaults = (v: { maxDistance: number; minFaces: number; maxFlaggedFraction: number }) =>
  vi.mocked(getFaceRepairScanDefaults).mockResolvedValue(v);

// Mirror the existing modal specs: let the modal's open/close transition timers flush between tests.
afterEach(async () => {
  await new Promise((resolve) => setTimeout(resolve, 500));
});

describe('AdvancedScanModal', () => {
  beforeEach(() => vi.mocked(getFaceRepairScanDefaults).mockReset());

  it('pre-fills the controls from the defaults endpoint', async () => {
    mockDefaults({ maxDistance: 0.5, minFaces: 3, maxFlaggedFraction: 0.5 });
    render(AdvancedScanModal, { props: { onClose: vi.fn(), onRun: vi.fn() } });
    expect(await screen.findByDisplayValue('3')).toBeInTheDocument();
  });

  it('submits numeric params (not strings) and closes', async () => {
    mockDefaults({ maxDistance: 0.5, minFaces: 3, maxFlaggedFraction: 0.5 });
    const onRun = vi.fn();
    const onClose = vi.fn();
    render(AdvancedScanModal, { props: { onClose, onRun } });
    await screen.findByDisplayValue('3');

    await userEvent.click(screen.getByRole('button', { name: 'Run scan' }));

    expect(onRun).toHaveBeenCalledTimes(1);
    const arg = onRun.mock.calls[0][0];
    expect(typeof arg.maxDistance).toBe('number');
    expect(typeof arg.minFaces).toBe('number');
    expect(typeof arg.maxFlaggedFraction).toBe('number');
    expect(arg).toEqual({ maxDistance: 0.5, minFaces: 3, maxFlaggedFraction: 0.5 });
    expect(onClose).toHaveBeenCalled();
  });

  it('falls back to safe defaults when the defaults endpoint fails', async () => {
    vi.mocked(getFaceRepairScanDefaults).mockRejectedValue(new Error('boom'));
    render(AdvancedScanModal, { props: { onClose: vi.fn(), onRun: vi.fn() } });
    // Component-level fallback minFaces is 3; the modal still renders and is runnable.
    await waitFor(() => expect(screen.getByDisplayValue('3')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Run scan' })).toBeInTheDocument();
  });
});
```

(If `FormModal` cannot render standalone in happy-dom — needs the modal-manager portal — render via a thin wrapper or assert on the inner form controls; keep all three behaviors covered.)

- [ ] **Step 3: Run to verify failure**

Run: `export PATH="$HOME/.local/share/mise/shims:$PATH"; cd web && pnpm test -- --run 'src/routes/admin/face-cleanup/AdvancedScanModal.spec.ts'`
Expected: FAIL — module `./AdvancedScanModal.svelte` does not exist.

- [ ] **Step 4: Create the modal** — `web/src/routes/admin/face-cleanup/AdvancedScanModal.svelte`:

```svelte
<script lang="ts">
  import { getFaceRepairScanDefaults } from '@immich/sdk';
  import { Field, FormModal } from '@immich/ui';
  import { mdiTune } from '@mdi/js';
  import { onMount } from 'svelte';
  import { t } from 'svelte-i18n';

  type Params = { maxDistance: number; minFaces: number; maxFlaggedFraction: number };
  type Props = { onClose: () => void; onRun: (params: Params) => void };
  const { onClose, onRun }: Props = $props();

  // Sensible fallbacks until the defaults endpoint resolves.
  let maxDistance = $state(0.5);
  let minFaces = $state(3);
  let maxFlaggedFraction = $state(0.5);

  const loadDefaults = async () => {
    try {
      const d = await getFaceRepairScanDefaults();
      maxDistance = d.maxDistance;
      minFaces = d.minFaces;
      maxFlaggedFraction = d.maxFlaggedFraction;
    } catch {
      // keep fallbacks; the server re-applies defaults for any omitted field anyway
    }
  };

  onMount(loadDefaults);

  const onSubmit = () => {
    // Coerce to numbers — the API rejects string params (z.number()). Native numeric inputs already bind as
    // numbers; Number() is a no-op safety net.
    onRun({
      maxDistance: Number(maxDistance),
      minFaces: Number(minFaces),
      maxFlaggedFraction: Number(maxFlaggedFraction),
    });
    onClose();
  };
</script>

<FormModal
  title={$t('admin.face_cleanup_advanced_title')}
  icon={mdiTune}
  {onClose}
  {onSubmit}
  submitText={$t('admin.face_cleanup_advanced_apply')}
  size="giant"
>
  <p class="mb-4 text-sm text-gray-500 dark:text-gray-400">{$t('admin.face_cleanup_advanced_subtitle')}</p>

  <div class="flex flex-col gap-5">
    <Field label={$t('admin.face_cleanup_advanced_sensitivity')}>
      <div class="flex items-center gap-3">
        <input type="range" min="0.1" max="1" step="0.01" bind:value={maxDistance} class="flex-1" data-testid="sensitivity-range" />
        <span class="w-12 text-right font-mono text-sm">{maxDistance.toFixed(2)}</span>
      </div>
      <p class="mt-1 text-xs text-gray-400">{$t('admin.face_cleanup_advanced_sensitivity_help')}</p>
    </Field>

    <Field label={$t('admin.face_cleanup_advanced_min_faces')}>
      <input
        type="number"
        min="1"
        step="1"
        bind:value={minFaces}
        class="w-24 rounded-lg border border-gray-300 bg-white px-2 py-1 text-sm dark:border-gray-600 dark:bg-gray-800"
        data-testid="min-faces-input"
      />
      <p class="mt-1 text-xs text-gray-400">{$t('admin.face_cleanup_advanced_min_faces_help')}</p>
    </Field>

    <Field label={$t('admin.face_cleanup_advanced_cap')}>
      <div class="flex items-center gap-3">
        <input type="range" min="0" max="1" step="0.01" bind:value={maxFlaggedFraction} class="flex-1" data-testid="cap-range" />
        <span class="w-12 text-right font-mono text-sm">{maxFlaggedFraction.toFixed(2)}</span>
      </div>
      <p class="mt-1 text-xs text-gray-400">{$t('admin.face_cleanup_advanced_cap_help')}</p>
    </Field>

    <button type="button" class="self-start text-sm font-semibold text-primary hover:underline" onclick={loadDefaults}>
      {$t('admin.face_cleanup_advanced_reset')}
    </button>
  </div>
</FormModal>
```

> **Slider ranges are deliberate:** `maxDistance` validates 0–2 server-side but the slider exposes the
> practical **0.1–1** range (FR cosine distances above ~0.7 are already very loose; >1 is nonsensical).
> `maxFlaggedFraction` uses the full 0–1. Caveat: a range input with `max="1"` two-way-binds, so a
> pre-filled `maxDistance` > 1 (only reachable via a hand-edited FR config) is **clamped to 1** on load.
> That's acceptable for nonsensical values; if exact >1 fidelity is ever needed, widen the slider `max` to 2.

- [ ] **Step 5: Run the component test to verify pass**

Run: `cd web && pnpm test -- --run 'src/routes/admin/face-cleanup/AdvancedScanModal.spec.ts'`
Expected: PASS. (If `FormModal` requires a portal/manager context that breaks render, fall back to asserting on a render of the inner controls; keep the pre-fill assertion.)

- [ ] **Step 6: Wire the dashboard** — in `web/src/routes/admin/face-cleanup/+page.svelte`:

(a) Imports — change the `@immich/ui` import to include `modalManager`, add the SDK body type, and import the modal:

```ts
import { applyFaceRepair, declineFaceRepair, getLatestScan, triggerScan } from '@immich/sdk';
import { Button, Icon, modalManager, toastManager } from '@immich/ui';
import { mdiRefresh, mdiClose, mdiTune } from '@mdi/js';
import AdvancedScanModal from './AdvancedScanModal.svelte';
```

(b) Add a tuned-scan handler next to `handleRescan` (`:135`):

```ts
const runScan = async (params?: { maxDistance: number; minFaces: number; maxFlaggedFraction: number }) => {
  scanning = true;
  applyError = null;
  try {
    // The generated SDK requires the body arg; an empty body is the quick-path (server applies defaults).
    await triggerScan({ faceRepairScanTriggerRequestDto: params ? { params } : {} });
    await fetchLatestScan();
    startPolling();
  } catch (error: unknown) {
    const status = (error as { status?: number }).status;
    toastManager.danger(status === 409 ? $t('admin.face_cleanup_scan_conflict') : $t('admin.face_cleanup_scan_error'));
  } finally {
    scanning = false;
  }
};

const handleRescan = () => runScan();

const handleAdvanced = () => modalManager.show(AdvancedScanModal, { onRun: (params) => void runScan(params) });
```

(Replace the existing `handleRescan` body — the quick path now goes through `runScan()` with an empty body.)

(c) Add the Advanced button immediately before the Re-scan `<Button>` (`:240`):

```svelte
        <Button
          color="secondary"
          disabled={scanning || (!!scan && isActive(scan.status))}
          onclick={handleAdvanced}
          class="gap-2"
        >
          <Icon icon={mdiTune} size="16" />
          {$t('admin.face_cleanup_advanced')}
        </Button>
```

- [ ] **Step 7: Type-check, lint, format the web**

Run: `cd .. && make check-web && make lint-web`
Then: `cd web && pnpm exec prettier --write 'src/routes/admin/face-cleanup/AdvancedScanModal.svelte' 'src/routes/admin/face-cleanup/+page.svelte' ../i18n/en.json`
Expected: tsc clean, eslint clean.

- [ ] **Step 8: Run web unit tests for the feature**

Run: `cd web && pnpm test -- --run 'src/routes/admin/face-cleanup/AdvancedScanModal.spec.ts'`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add web/src/routes/admin/face-cleanup/AdvancedScanModal.svelte web/src/routes/admin/face-cleanup/AdvancedScanModal.spec.ts web/src/routes/admin/face-cleanup/+page.svelte i18n/en.json
git commit -m "feat(web): advanced scan tuning modal on the face-cleanup dashboard"
```

---

## Task 6: Full verification

- [ ] **Step 1: Server checks**

Run: `cd .. && make check-server && make lint-server`
Then: `cd server && pnpm exec prettier --write src/dtos/face-repair.dto.ts src/dtos/face-repair.dto.spec.ts src/services/face-repair.service.ts src/services/face-repair.scan-defaults.spec.ts src/controllers/face-repair-admin.controller.ts src/controllers/face-repair-admin.controller.spec.ts test/medium/specs/services/face-repair.scan.spec.ts`
Expected: tsc clean, eslint clean.

- [ ] **Step 2: Full server unit suite**

Run: `cd server && pnpm test -- --run`
Expected: all pass (no regression).

- [ ] **Step 3: Full web unit suite**

Run: `cd web && pnpm test -- --run`
Expected: all pass.

- [ ] **Step 4: Commit any format fixes**

```bash
git add -A && git commit -m "style(face-repair): prettier-format advanced-scan files" || echo "nothing to format"
```

- [ ] **Step 5: Push and let CI run** (medium + e2e + OpenAPI-sync checks are CI-only)

```bash
git push
```

---

## Self-Review

**Spec coverage:**

- Curated 3 knobs (maxDistance/minFaces/maxFlaggedFraction) → Task 5 modal; DTO accepts all 7 → Task 1. ✓
- Per-scan transient, no new storage → Task 1 (`createScan` only; no metadata writes). ✓
- Pre-filled defaults via dedicated endpoint → Task 2 + Task 5 `loadDefaults`. ✓
- Quick Re-scan preserved → Task 5 `runScan()` no-arg path. ✓
- Engine unchanged; params flow proven → Task 3 medium test (two-scan contrast). ✓
- OpenAPI/SDK regen → Task 4. ✓

**Test & edge-case coverage:**

- **Validation (T1):** curated params accepted; non-curated/full set accepted; `maxDistance>2`, `maxFlaggedFraction>1`, `minFaces<1` rejected; empty body (quick path) accepted.
- **Defaults (T2):** `getScanDefaults` returns config maxDistance/minFaces + constant cap; route authenticated + delegates.
- **Controller (T1):** no-body delegates `undefined` params (quick path unchanged); tuned params delegated; out-of-range → 400.
- **Engine flow (T3):** the _load-bearing_ edge — same 27% cluster is `toRepair` at the 0.5 default but `over-cap`/`reviewOnly` at the 0.1 tuned cap. A 60% fixture would falsely pass, so the contamination level is justified in the task.
- **Modal (T5):** pre-fill from endpoint; submit sends **numeric** (not string) params + closes; defaults-endpoint-failure falls back to safe values and stays runnable.
- **Known untested branches (acceptable, pre-existing):** the web 409 "scan in progress" toast branch is unchanged existing behavior copied into `runScan`; not separately tested.

**Placeholder scan:** No TBD/TODO; every code step has full code. The two conditionals ("if FormModal can't render standalone, assert inner controls") are concrete fallbacks, not placeholders.

**Type consistency:** `triggerScan(requestedBy, overrides?)` signature matches controller call `dto.params` and medium-test call `{ maxFlaggedFraction }`; `getScanDefaults()` return shape `{ maxDistance, minFaces, maxFlaggedFraction }` matches `FaceRepairScanDefaultsSchema` and the modal's `loadDefaults`; modal `onRun(params)` shape matches dashboard `runScan(params)` and the SDK body `{ faceRepairScanTriggerRequestDto: { params } }`. ✓
