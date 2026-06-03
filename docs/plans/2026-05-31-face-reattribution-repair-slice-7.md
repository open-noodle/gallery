# Face re-attribution repair — Slice 7 (Admin endpoint) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]`.
> Strict TDD: failing test first, RUN it, minimal impl, RUN green. Report red+green output.
> Build on Slices 1–6 (`FaceRepairService.runRepair`, `RunRepairResult`, `RepairReport`).
> Do NOT regenerate OpenAPI/SDK (the human controller does that afterward). Do NOT implement Slice 8.

**Goal:** Expose `runRepair` as an admin-only `POST /admin/face-repair` with a validated request DTO and a typed
response DTO. The endpoint is thin: validate → `service.runRepair(dto)` → map to response.

**Architecture:** A fork controller mirroring `src/controllers/classification.controller.ts` (an existing fork
admin controller using `@Authenticated({ admin: true })`), Zod DTOs via `createZodDto`, registered wherever
`ClassificationController` is registered, and a controller spec mirroring
`src/controllers/classification.controller.spec.ts`.

**Read first and MIRROR:** `src/controllers/classification.controller.ts` (+ its `.spec.ts`) for the exact
controller/guard/`@Endpoint`/registration pattern and how its spec mocks the service; `src/dtos/` + the
`createZodDto` usage in e.g. `src/dtos/user.dto.ts` for the Zod DTO pattern; the `RunRepairOptions` /
`RunRepairResult` / `RepairReport` shapes in `src/services/face-repair.service.ts` +
`src/services/face-repair.summary.ts`.

---

### Task 1: DTOs

**Files:** Create `server/src/dtos/face-repair.dto.ts`.

- [ ] **Step 1: Implement the Zod request + response DTOs** (no separate test — exercised by the controller spec
      in Task 2; this is generated-shape code). Request schema fields all optional with validation:

```typescript
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const FaceRepairRequestSchema = z
  .object({
    dryRun: z.boolean().default(true),
    ownerId: z.string().uuid().optional(),
    personId: z.string().uuid().optional(),
    maxDistance: z.number().gt(0).max(2).optional(),
    minFaces: z.number().int().min(1).optional(),
    voteWindow: z.number().int().min(1).optional(),
    voteMargin: z.number().int().min(0).optional(),
    maxAttributionDistance: z.number().gt(0).max(2).optional(),
    maxFlaggedFraction: z.number().min(0).max(1).optional(),
  })
  .meta({ id: 'FaceRepairRequestDto' });
export class FaceRepairRequestDto extends createZodDto(FaceRepairRequestSchema) {}

const SuspectedOwnerSchema = z.object({ ownerPersonId: z.string(), count: z.number() });
const PersonSchema = z.object({
  personId: z.string(),
  eligible: z.number(),
  flagged: z.number(),
  flaggedFraction: z.number(),
  reviewOnly: z.boolean(),
  suspectedOwners: z.array(SuspectedOwnerSchema),
});
export const FaceRepairResponseSchema = z
  .object({
    dryRun: z.boolean(),
    mutated: z.boolean(),
    executed: z.object({ unassigned: z.number(), requeued: z.number() }).optional(),
    report: z.object({
      totals: z.object({
        eligibleFaces: z.number(),
        flaggedFaces: z.number(),
        toRepair: z.number(),
        reviewOnlyFaces: z.number(),
        reviewOnlyPersons: z.number(),
        affectedPersons: z.number(),
      }),
      persons: z.array(PersonSchema),
    }),
  })
  .meta({ id: 'FaceRepairResponseDto' });
export class FaceRepairResponseDto extends createZodDto(FaceRepairResponseSchema) {}
```

(Match the EXACT `createZodDto`/`z`/`.meta` import + style used in the repo's other Zod DTOs — confirm
`nestjs-zod` vs the repo's wrapper, and whether `.uuid()`/`.meta` are how existing DTOs are written. Adjust to the
prevailing pattern; the field set above is the contract.)

- [ ] **Step 2: Commit after Task 2** (DTO + controller land together).

---

### Task 2: Controller + spec

**Files:** Create `server/src/controllers/face-repair-admin.controller.ts`; Modify the controller registration
list (wherever `ClassificationController` is listed); Create
`server/src/controllers/face-repair-admin.controller.spec.ts`.

- [ ] **Step 1: Write the failing controller spec** mirroring `classification.controller.spec.ts` (it uses the
      shared controller-test harness that builds the Nest app with a mocked service). Assertions:
  - `POST /admin/face-repair` with no body → calls `service.runRepair` with `dryRun: true` (the schema default) and
    returns the service result;
  - it is admin-guarded (the harness's unauthenticated/non-admin request is rejected — follow exactly how the
    classification spec asserts the guard);
  - an invalid body (e.g. `maxFlaggedFraction: 2`) → 400 (Zod validation), service NOT called.

  (Use the same `mockService`/`request(...)` helpers the classification spec uses. If the harness auto-asserts
  auth for every route, a single `shouldBeAuthenticated`-style check is enough — match the repo convention.)

- [ ] **Step 2: Run, confirm red** — `cd server && pnpm test -- --run src/controllers/face-repair-admin.controller.spec.ts` → FAIL (controller missing).

- [ ] **Step 3: Implement the controller** (mirror `classification.controller.ts`):

```typescript
import { Body, Controller, Post } from '@nestjs/common';
import { FaceRepairRequestDto, FaceRepairResponseDto } from 'src/dtos/face-repair.dto';
import { Authenticated } from 'src/middleware/auth.guard';
import { FaceRepairService } from 'src/services/face-repair.service';

@Controller('admin/face-repair')
export class FaceRepairAdminController {
  constructor(private service: FaceRepairService) {}

  @Post()
  @Authenticated({ admin: true })
  runFaceRepair(@Body() dto: FaceRepairRequestDto): Promise<FaceRepairResponseDto> {
    return this.service.runRepair(dto);
  }
}
```

(Add the `@Endpoint`/`@ApiTags` decorators if `classification.controller.ts` uses them — mirror it. Ensure
`runRepair`'s return type is assignable to `FaceRepairResponseDto`; if Nest needs an explicit cast/serialization,
follow the classification controller's approach. Register `FaceRepairAdminController` in the same controllers
array as `ClassificationController`.)

- [ ] **Step 4: Run, confirm green** — same command → PASS.
- [ ] **Step 5: Validate + commit** — `cd server && pnpm exec prettier --write <changed> && pnpm exec eslint <changed> --max-warnings 0 && pnpm exec tsc --noEmit`; `git add -A && git commit -m "feat(server): admin endpoint for face re-attribution repair"`.

> Do NOT run OpenAPI/SDK generation — leave the spec/SDK out of sync; the human controller regenerates and commits
> them in a dedicated step (build + sync:open-api + make open-api).

---

## Self-review

- Slice-7 matrix rows: non-admin rejected ✓ (T2); dryRun defaults true ✓ (T2, via schema default); params parsed
  - invalid rejected ✓ (T2); OpenAPI/SDK regenerated → deferred to the human step (NOT this subagent). No Slice 8.
    Types consistent (`RunRepairResult` ⊇ `FaceRepairResponseDto` shape). No placeholders.
