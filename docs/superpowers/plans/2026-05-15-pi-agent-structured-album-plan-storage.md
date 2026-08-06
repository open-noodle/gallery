# Pi Agent Structured Album Plan Storage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build vertical slice 11 from `docs/superpowers/specs/2026-05-14-pi-agent-album-assistant-design.md`: persist structured album operation plans, let the runner propose or revise them through planning tools, and validate operation dependencies before any user-facing review or apply flow.

**Architecture:** Gallery remains the durable authority for proposed writes. The runner receives only planning tools that store structured proposals; these tools cannot mutate albums and cannot call the future apply endpoint. A new operation-plan repository owns revisioned `agent_operation_plan` and `agent_operation` rows in one transaction, while a service validates session ownership, write-scope policy, operation shape, temporary album dependencies, revision replacement, session status, and websocket notification.

**Tech Stack:** NestJS controllers/services/repositories, Kysely/Postgres migrations, sql-tools schema tables, Zod DTOs, existing runner tool gateway, Node `node:test` runner tests, Vitest server tests, generated OpenAPI/SDK artifacts.

---

## Design Source

The approved design defines slice 11 as:

```text
Structured album plan storage
- operation plan and operation tables;
- propose/revise operations;
- dependency validation;
- tests for operation shape and dependency blocking.
```

This slice follows the operation model in the same design:

```text
MVP operation types:
- album.create
- album.addAssets
- album.updateDetails
- album.setCover

Dependency examples:
- album.addAssets for a newly proposed album depends on the matching album.create.
- album.setCover for a newly proposed album depends on the matching album.create.
- Disabling a dependency should disable or block dependent operations.
```

Slices 1-10 are already present on PR #574 / `explore/pi-agent-brainstorm`: provider credentials, sessions, transcript persistence, runner health, read tool gate, setup UI, runner protocol, Pi runtime, read tool expansion, and YOLO read mode.

## Scope

This slice implements:

- `agent_operation_plan` and `agent_operation` schema tables, migrations, DB types, and repositories.
- Operation DTOs for create/add-assets/update-details/set-cover proposal inputs and stored plan responses.
- Server-side validation for:
  - write-scope flags;
  - normal Gallery access for every referenced existing album and asset;
  - active owned sessions;
  - operation-specific payload shape;
  - existing-album versus newly proposed album targets;
  - unique `temporaryTargetId` values for newly proposed albums;
  - automatic dependency creation for operations that target a newly proposed album;
  - blocking proposals that target a new temporary album without a matching `album.create`;
  - revision requests that target a plan owned by the session.
- Completed/denied/failed `agent_tool_call` audit rows for every planning tool invocation.
- Agent planning tools:
  - `proposeAlbumOperations`
  - `reviseProposedOperations`
  - `summarizePlan`
- Browser-readable current-plan API for the later review UI.
- Websocket notification when a new plan revision is ready.
- Runner-side Pi custom planning tools wired through the same runner-only tool gateway.
- Generated OpenAPI/SDK/mobile artifacts for new public browser routes.

This slice intentionally does not implement:

- Plan review UI toggles.
- Operation group toggles.
- Apply endpoint or album mutation execution.
- Partial apply failure handling.
- Direct write tools in Pi.
- Tool-call approval grants for planning tools. Planning tools persist proposals only; album mutation still requires future user review and apply.

## File Structure

Create:

- `server/src/types/agent-operation.types.ts` - operation-plan payload and response domain types.
- `server/src/dtos/agent-operation.dto.ts` - Zod DTOs for proposing, revising, summarizing, and reading plans.
- `server/src/dtos/agent-operation.dto.spec.ts` - operation-shape and dependency-input DTO tests.
- `server/src/schema/tables/agent-operation-plan.table.ts` - sql-tools table for plan revisions.
- `server/src/schema/tables/agent-operation.table.ts` - sql-tools table for proposed operations.
- `server/src/schema/migrations/1778920000000-AgentOperationPlan.ts` - Postgres migration for both tables and indexes.
- `server/src/repositories/agent-operation-plan.repository.ts` - transactional revision persistence and plan lookup.
- `server/test/medium/specs/repositories/agent-operation-plan.repository.spec.ts` - medium DB coverage for revision ordering and cascade behavior.
- `server/src/services/agent-operation-plan.service.ts` - ownership, policy, operation validation, dependency calculation, revision replacement, websocket event.
- `server/src/services/agent-operation-plan.service.spec.ts` - service TDD for proposal/revision validation, access checks, tool-call audit rows, and session state.
- `server/src/controllers/agent-operation-plan.controller.ts` - authenticated browser routes.
- `server/src/controllers/agent-operation-plan.controller.spec.ts` - route/auth/date serialization tests.

Modify:

- `server/src/enum.ts` - add planning tool names, plan data class, operation plan, operation, target, risk, and status enums.
- `server/src/types/agent-tool.types.ts` - add planning-tool audit request/response metadata shapes.
- `server/src/schema/index.ts` - register `agent_operation_plan` and `agent_operation` tables.
- `server/src/database.ts` - export selectable `AgentOperationPlan` and `AgentOperation` types plus reusable column lists.
- `server/src/controllers/index.ts` - register `AgentOperationPlanController`.
- `server/src/controllers/agent-runner-tool.controller.ts` - add runner-only planning-tool routes.
- `server/src/controllers/agent-runner-tool.controller.spec.ts` - cover runner planning routes and bearer auth.
- `server/src/services/index.ts` - register `AgentOperationPlanService`.
- `server/src/repositories/index.ts` - register `AgentOperationPlanRepository`.
- `server/src/repositories/websocket.repository.ts` - add operation-plan websocket event variant.
- `agent-runner/src/gallery-tools.mjs` - add planning tool definitions alongside read tools.
- `agent-runner/src/gallery-tools.test.mjs` - prove planning tools are present and apply/write tools are absent.
- `agent-runner/src/pi-runtime.mjs` - include planning tool names in capabilities.
- `agent-runner/src/pi-runtime.test.mjs` - assert custom planning tools are exposed when gateway is configured.
- `open-api/immich-openapi-specs.json`, `open-api/typescript-sdk/**`, `mobile/openapi/**` - generated API artifacts.

## Contracts

### New Enums

Use these enum values exactly:

```ts
export enum AgentToolName {
  SearchAssets = 'searchAssets',
  ReadAssetMetadata = 'readAssetMetadata',
  ReadAssetPreviews = 'readAssetPreviews',
  ReadAssetOriginals = 'readAssetOriginals',
  ListAlbums = 'listAlbums',
  ReadAlbum = 'readAlbum',
  ProposeAlbumOperations = 'proposeAlbumOperations',
  ReviseProposedOperations = 'reviseProposedOperations',
  SummarizePlan = 'summarizePlan',
}

export enum AgentToolDataClass {
  Metadata = 'metadata',
  Previews = 'previews',
  Originals = 'originals',
  Plan = 'plan',
}

export enum AgentOperationPlanStatus {
  Proposed = 'proposed',
  Superseded = 'superseded',
  Applied = 'applied',
  Cancelled = 'cancelled',
}

export enum AgentOperationType {
  AlbumCreate = 'album.create',
  AlbumAddAssets = 'album.addAssets',
  AlbumUpdateDetails = 'album.updateDetails',
  AlbumSetCover = 'album.setCover',
}

export enum AgentOperationTargetKind {
  NewAlbum = 'new_album',
  ExistingAlbum = 'existing_album',
}

export enum AgentOperationRiskLevel {
  Low = 'low',
  Medium = 'medium',
  High = 'high',
}

export enum AgentOperationStatus {
  Proposed = 'proposed',
  Applied = 'applied',
  Skipped = 'skipped',
  Failed = 'failed',
}
```

### Proposal Request Shape

Planning tools accept client-proposed operations without database IDs. Gallery assigns IDs and computes `dependencyIds`.

```ts
type AgentAlbumOperationInput =
  | {
      type: 'album.create';
      summary: string;
      targetKind: 'new_album';
      temporaryTargetId: string;
      riskLevel?: 'low' | 'medium' | 'high';
      enabled?: boolean;
      payload: { albumName: string; description?: string };
    }
  | {
      type: 'album.addAssets';
      summary: string;
      targetKind: 'existing_album' | 'new_album';
      targetId?: string;
      temporaryTargetId?: string;
      assetIds: string[];
      riskLevel?: 'low' | 'medium' | 'high';
      enabled?: boolean;
      payload?: Record<string, never>;
    }
  | {
      type: 'album.updateDetails';
      summary: string;
      targetKind: 'existing_album';
      targetId: string;
      riskLevel?: 'low' | 'medium' | 'high';
      enabled?: boolean;
      payload: { albumName?: string; description?: string };
    }
  | {
      type: 'album.setCover';
      summary: string;
      targetKind: 'existing_album' | 'new_album';
      targetId?: string;
      temporaryTargetId?: string;
      assetIds: [string];
      riskLevel?: 'low' | 'medium' | 'high';
      enabled?: boolean;
      payload?: Record<string, never>;
    };
```

Rules:

- `album.create` must use `targetKind: 'new_album'` and a unique `temporaryTargetId`.
- `album.addAssets` and `album.setCover` may target an existing album by `targetId` or a newly proposed album by `temporaryTargetId`.
- Newly targeted `album.addAssets` and `album.setCover` operations require a same-plan `album.create` with the same `temporaryTargetId`.
- `album.updateDetails` targets existing albums only in this slice. New album name/description belongs on `album.create`.
- `enabled` defaults to `true`.
- `riskLevel` defaults to `low`.
- Asset IDs must be unique within an operation.
- Proposal/revision requests are rejected if the session permission plan disables the relevant write scope.

### Stored Response Shape

Stored operations include database IDs and computed dependencies:

```ts
type AgentOperationPlanResponseDto = {
  id: string;
  sessionId: string;
  revision: number;
  status: 'proposed' | 'superseded' | 'applied' | 'cancelled';
  summary: string;
  operations: AgentOperationResponseDto[];
  createdAt: Date;
  updatedAt: Date;
};

type AgentOperationResponseDto = {
  id: string;
  planId: string;
  type: 'album.create' | 'album.addAssets' | 'album.updateDetails' | 'album.setCover';
  summary: string;
  targetKind: 'new_album' | 'existing_album';
  targetId: string | null;
  temporaryTargetId: string | null;
  assetIds: string[];
  payload: Record<string, unknown>;
  dependencyIds: string[];
  riskLevel: 'low' | 'medium' | 'high';
  enabled: boolean;
  status: 'proposed' | 'applied' | 'skipped' | 'failed';
  result: Record<string, unknown> | null;
  error: string | null;
  createdAt: Date;
  updatedAt: Date;
};
```

### Routes

Browser-authenticated routes:

```http
GET /api/agent/sessions/:id/operation-plan
POST /api/agent/sessions/:id/operation-plan/proposals
POST /api/agent/sessions/:id/operation-plan/:planId/revisions
POST /api/agent/sessions/:id/operation-plan/:planId/summary
```

Runner-only gateway routes:

```http
POST /api/agent/internal/tools/sessions/:id/propose-album-operations
POST /api/agent/internal/tools/sessions/:id/revise-proposed-operations/:planId
POST /api/agent/internal/tools/sessions/:id/summarize-plan/:planId
```

The browser proposal routes are marked internal/alpha for generated SDK use and testability. Normal users will use the plan review UI in slice 12.

### Planning Tool Gate And Audit

Planning tools do not require interactive approval because they only persist proposed writes. They still pass through the Gallery tool gate:

1. Check that the session belongs to the signed-in user.
2. Check that the session is active.
3. Check normal Gallery access for referenced existing albums and assets.
4. Check the write-scope portion of the session permission plan.
5. Persist an `agent_tool_call` row with one of:
   - `Completed` for stored proposals/revisions/summaries;
   - `Denied` for access or policy denial;
   - `Failed` for unexpected persistence failures.
6. Return only redacted operation-plan details to the runner.

Audit metadata shape:

```ts
type AgentOperationPlanToolRequestMetadata = {
  planId?: string;
  operationCount: number;
  operationTypes: string[];
  albumIds: string[];
  assetIds: string[];
};

type AgentOperationPlanToolResponseMetadata = {
  planId: string | null;
  operationIds: string[];
};
```

Planning tool rows use `dataClass: 'plan'`, `assetCount` equal to the number of unique referenced asset IDs, and `albumCount` equal to the number of unique referenced existing album IDs.

### Runner Tool Names

Expose these Pi custom tools when `toolGateway` is configured:

```text
searchAssets
readAssetMetadata
readAssetPreviews
readAssetOriginals
listAlbums
readAlbum
proposeAlbumOperations
reviseProposedOperations
summarizePlan
```

Do not expose write/apply tools:

```text
createAlbum
addAssetsToAlbum
updateAlbum
setAlbumCover
applyAlbumOperations
```

## Task 1: Enums, Types, And DTO Contracts

**Files:**

- Modify: `server/src/enum.ts`
- Create: `server/src/types/agent-operation.types.ts`
- Modify: `server/src/types/agent-tool.types.ts`
- Create: `server/src/dtos/agent-operation.dto.ts`
- Create: `server/src/dtos/agent-operation.dto.spec.ts`

- [ ] **Step 1: Write failing DTO tests**

Create `server/src/dtos/agent-operation.dto.spec.ts`.

```ts
import {
  AgentOperationPlanResponseDto,
  AgentOperationPlanSummaryRequestDto,
  AgentOperationPlanToolResponseDto,
  AgentProposeAlbumOperationsDto,
  AgentReviseAlbumOperationsDto,
} from 'src/dtos/agent-operation.dto';
import {
  AgentOperationPlanStatus,
  AgentOperationRiskLevel,
  AgentOperationStatus,
  AgentOperationTargetKind,
  AgentOperationType,
} from 'src/enum';
import { factory } from 'test/small.factory';
import z from 'zod';

const expectIssue = (
  result: { success: boolean; error?: z.ZodError },
  path: Array<string | number>,
  message: string,
) => {
  expect(result.success).toBe(false);
  expect(result.error?.issues).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        path,
        message: expect.stringContaining(message),
      }),
    ]),
  );
};

describe('Agent operation DTOs', () => {
  it('accepts a create album operation proposal and defaults enabled/risk fields', () => {
    const result = AgentProposeAlbumOperationsDto.schema.safeParse({
      summary: 'Create a Portugal trip album.',
      operations: [
        {
          type: AgentOperationType.AlbumCreate,
          summary: 'Create Portugal 2026.',
          targetKind: AgentOperationTargetKind.NewAlbum,
          temporaryTargetId: 'tmp-portugal-2026',
          payload: { albumName: 'Portugal 2026', description: 'Best travel photos.' },
        },
      ],
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.operations[0]).toMatchObject({
        enabled: true,
        riskLevel: AgentOperationRiskLevel.Low,
      });
    }
  });

  it('accepts add assets to a newly proposed album by temporary target id', () => {
    const assetId = factory.uuid();
    const result = AgentProposeAlbumOperationsDto.schema.safeParse({
      summary: 'Create Portugal and add one photo.',
      operations: [
        {
          type: AgentOperationType.AlbumCreate,
          summary: 'Create Portugal 2026.',
          targetKind: AgentOperationTargetKind.NewAlbum,
          temporaryTargetId: 'tmp-portugal-2026',
          payload: { albumName: 'Portugal 2026' },
        },
        {
          type: AgentOperationType.AlbumAddAssets,
          summary: 'Add beach photo.',
          targetKind: AgentOperationTargetKind.NewAlbum,
          temporaryTargetId: 'tmp-portugal-2026',
          assetIds: [assetId],
        },
      ],
    });

    expect(result.success).toBe(true);
  });

  it('rejects create album operations without a temporary target id', () => {
    const result = AgentProposeAlbumOperationsDto.schema.safeParse({
      summary: 'Invalid create.',
      operations: [
        {
          type: AgentOperationType.AlbumCreate,
          summary: 'Create missing temp id.',
          targetKind: AgentOperationTargetKind.NewAlbum,
          payload: { albumName: 'Portugal' },
        },
      ],
    });

    expectIssue(result, ['operations', 0, 'temporaryTargetId'], 'Required');
  });

  it('rejects duplicate asset ids within one operation', () => {
    const assetId = factory.uuid();
    const result = AgentProposeAlbumOperationsDto.schema.safeParse({
      summary: 'Invalid add.',
      operations: [
        {
          type: AgentOperationType.AlbumAddAssets,
          summary: 'Duplicate add.',
          targetKind: AgentOperationTargetKind.ExistingAlbum,
          targetId: factory.uuid(),
          assetIds: [assetId, assetId],
        },
      ],
    });

    expectIssue(result, ['operations', 0, 'assetIds'], 'assetIds must be unique');
  });

  it('rejects existing album operations without targetId', () => {
    const result = AgentProposeAlbumOperationsDto.schema.safeParse({
      summary: 'Invalid target.',
      operations: [
        {
          type: AgentOperationType.AlbumSetCover,
          summary: 'Set cover without target id.',
          targetKind: AgentOperationTargetKind.ExistingAlbum,
          assetIds: [factory.uuid()],
        },
      ],
    });

    expectIssue(result, ['operations', 0, 'targetId'], 'targetId is required for existing album targets');
  });

  it('accepts revision requests with a non-empty operation list', () => {
    const result = AgentReviseAlbumOperationsDto.schema.safeParse({
      feedback: 'Split Lisbon and Porto into separate albums.',
      summary: 'Separate city albums.',
      operations: [
        {
          type: AgentOperationType.AlbumUpdateDetails,
          summary: 'Rename existing album.',
          targetKind: AgentOperationTargetKind.ExistingAlbum,
          targetId: factory.uuid(),
          payload: { albumName: 'Lisbon highlights' },
          riskLevel: AgentOperationRiskLevel.Medium,
        },
      ],
    });

    expect(result.success).toBe(true);
  });

  it('accepts summarize-plan requests', () => {
    const result = AgentOperationPlanSummaryRequestDto.schema.safeParse({
      focus: 'Explain high risk changes.',
    });

    expect(result.success).toBe(true);
  });

  it('serializes persisted plan responses with dates and dependency ids', () => {
    const planId = factory.uuid();
    const operationId = factory.uuid();
    const dependencyId = factory.uuid();
    const result = AgentOperationPlanResponseDto.schema.safeParse({
      id: planId,
      sessionId: factory.uuid(),
      revision: 2,
      status: AgentOperationPlanStatus.Proposed,
      summary: 'Portugal album plan.',
      operations: [
        {
          id: operationId,
          planId,
          type: AgentOperationType.AlbumAddAssets,
          summary: 'Add photos.',
          targetKind: AgentOperationTargetKind.NewAlbum,
          targetId: null,
          temporaryTargetId: 'tmp-portugal-2026',
          assetIds: [factory.uuid()],
          payload: {},
          dependencyIds: [dependencyId],
          riskLevel: AgentOperationRiskLevel.Low,
          enabled: true,
          status: AgentOperationStatus.Proposed,
          result: null,
          error: null,
          createdAt: '2026-05-15T12:00:00.000Z',
          updatedAt: '2026-05-15T12:00:01.000Z',
        },
      ],
      createdAt: '2026-05-15T12:00:00.000Z',
      updatedAt: '2026-05-15T12:00:01.000Z',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.createdAt).toEqual(new Date('2026-05-15T12:00:00.000Z'));
      expect(result.data.operations[0].dependencyIds).toEqual([dependencyId]);
    }
  });

  it('serializes planning tool responses with no plan as null', () => {
    const result = AgentOperationPlanToolResponseDto.schema.safeParse({
      status: 'success',
      plan: null,
      toolCall: null,
      summary: 'No proposed plan exists.',
    });

    expect(result.success).toBe(true);
  });
});
```

- [ ] **Step 2: Run DTO tests and verify they fail**

Run:

```bash
pnpm --dir server test src/dtos/agent-operation.dto.spec.ts
```

Expected: FAIL because `server/src/dtos/agent-operation.dto.ts` and the new enums do not exist yet.

- [ ] **Step 3: Add operation enums**

Modify `server/src/enum.ts`.

Extend the existing `AgentToolName` enum:

```ts
ProposeAlbumOperations = 'proposeAlbumOperations',
ReviseProposedOperations = 'reviseProposedOperations',
SummarizePlan = 'summarizePlan',
```

Extend the existing `AgentToolDataClass` enum:

```ts
Plan = 'plan',
```

Add the operation enums after `AgentToolDataClass`.

```ts
export enum AgentOperationPlanStatus {
  Proposed = 'proposed',
  Superseded = 'superseded',
  Applied = 'applied',
  Cancelled = 'cancelled',
}

export enum AgentOperationType {
  AlbumCreate = 'album.create',
  AlbumAddAssets = 'album.addAssets',
  AlbumUpdateDetails = 'album.updateDetails',
  AlbumSetCover = 'album.setCover',
}

export enum AgentOperationTargetKind {
  NewAlbum = 'new_album',
  ExistingAlbum = 'existing_album',
}

export enum AgentOperationRiskLevel {
  Low = 'low',
  Medium = 'medium',
  High = 'high',
}

export enum AgentOperationStatus {
  Proposed = 'proposed',
  Applied = 'applied',
  Skipped = 'skipped',
  Failed = 'failed',
}
```

- [ ] **Step 4: Add operation domain types**

Create `server/src/types/agent-operation.types.ts`.

```ts
import {
  AgentOperationPlanStatus,
  AgentOperationRiskLevel,
  AgentOperationStatus,
  AgentOperationTargetKind,
  AgentOperationType,
} from 'src/enum';

export type AgentOperationPayload =
  | { albumName: string; description?: string }
  | { albumName?: string; description?: string }
  | Record<string, never>;

export type AgentOperationResult = {
  albumId?: string;
  assetIds?: string[];
  skippedReason?: string;
};

export type AgentAlbumOperationInput = {
  type: AgentOperationType;
  summary: string;
  targetKind: AgentOperationTargetKind;
  targetId?: string;
  temporaryTargetId?: string;
  assetIds?: string[];
  payload?: AgentOperationPayload;
  dependencyIds?: string[];
  riskLevel: AgentOperationRiskLevel;
  enabled: boolean;
};

export type AgentOperationPlanCreate = {
  sessionId: string;
  revision: number;
  status: AgentOperationPlanStatus;
  summary: string;
};

export type AgentOperationCreate = {
  planId: string;
  type: AgentOperationType;
  summary: string;
  targetKind: AgentOperationTargetKind;
  targetId: string | null;
  temporaryTargetId: string | null;
  assetIds: string[];
  payload: AgentOperationPayload;
  dependencyIds: string[];
  riskLevel: AgentOperationRiskLevel;
  enabled: boolean;
  status: AgentOperationStatus;
  result: AgentOperationResult | null;
  error: string | null;
};
```

Modify `server/src/types/agent-tool.types.ts` by adding planning metadata types:

```ts
export type AgentToolOperationPlanRequestMetadata = {
  planId?: string;
  operationCount: number;
  operationTypes: string[];
  albumIds: string[];
  assetIds: string[];
};

export type AgentToolOperationPlanResponseMetadata = {
  planId: string | null;
  operationIds: string[];
};
```

Add them to the existing metadata unions:

```ts
export type AgentToolRequestMetadata =
  | AgentToolSearchAssetsRequestMetadata
  | AgentToolReadAssetIdsRequestMetadata
  | AgentToolReadAlbumRequestMetadata
  | AgentToolListAlbumsRequestMetadata
  | AgentToolOperationPlanRequestMetadata;

export type AgentToolResponseMetadata = AgentToolResponseIdsMetadata | AgentToolOperationPlanResponseMetadata;
```

- [ ] **Step 5: Add DTO schemas**

Create `server/src/dtos/agent-operation.dto.ts`.

```ts
import { createZodDto, type ZodDto } from 'nestjs-zod';
import { AgentToolCallResponseDto } from 'src/dtos/agent-tool.dto';
import {
  AgentOperationPlanStatus,
  AgentOperationRiskLevel,
  AgentOperationStatus,
  AgentOperationTargetKind,
  AgentOperationType,
} from 'src/enum';
import { isoDatetimeToDate } from 'src/validation';
import z from 'zod';

const uuid = z.uuidv4();
const summary = z.string().trim().min(1).max(1000);
const temporaryTargetId = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .regex(/^[a-zA-Z0-9_-]+$/);
const emptyPayload = z.record(z.string(), z.never()).optional().default({});
const uniqueAssetIds = z
  .array(uuid)
  .min(1)
  .max(10_000)
  .superRefine((assetIds, ctx) => {
    if (new Set(assetIds).size !== assetIds.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'assetIds must be unique' });
    }
  });

const OperationTypeSchema = z.enum(AgentOperationType).meta({ id: 'AgentOperationType' });
const OperationTargetKindSchema = z.enum(AgentOperationTargetKind).meta({ id: 'AgentOperationTargetKind' });
const OperationRiskLevelSchema = z.enum(AgentOperationRiskLevel).meta({ id: 'AgentOperationRiskLevel' });
const OperationStatusSchema = z.enum(AgentOperationStatus).meta({ id: 'AgentOperationStatus' });
const OperationPlanStatusSchema = z.enum(AgentOperationPlanStatus).meta({ id: 'AgentOperationPlanStatus' });

const baseOperation = {
  summary,
  riskLevel: OperationRiskLevelSchema.optional().default(AgentOperationRiskLevel.Low),
  enabled: z.boolean().optional().default(true),
};

const AgentAlbumCreateOperationInputSchema = z
  .strictObject({
    ...baseOperation,
    type: z.literal(AgentOperationType.AlbumCreate),
    targetKind: z.literal(AgentOperationTargetKind.NewAlbum),
    temporaryTargetId,
    payload: z.strictObject({
      albumName: z.string().trim().min(1).max(200),
      description: z.string().trim().max(1000).optional().default(''),
    }),
  })
  .meta({ id: 'AgentAlbumCreateOperationInput' });

const AgentAlbumAddAssetsOperationInputSchema = z
  .strictObject({
    ...baseOperation,
    type: z.literal(AgentOperationType.AlbumAddAssets),
    targetKind: OperationTargetKindSchema,
    targetId: uuid.optional(),
    temporaryTargetId: temporaryTargetId.optional(),
    assetIds: uniqueAssetIds,
    payload: emptyPayload,
  })
  .superRefine((value, ctx) => validateTarget(value, ctx))
  .meta({ id: 'AgentAlbumAddAssetsOperationInput' });

const AgentAlbumUpdateDetailsOperationInputSchema = z
  .strictObject({
    ...baseOperation,
    type: z.literal(AgentOperationType.AlbumUpdateDetails),
    targetKind: z.literal(AgentOperationTargetKind.ExistingAlbum),
    targetId: uuid,
    payload: z
      .strictObject({
        albumName: z.string().trim().min(1).max(200).optional(),
        description: z.string().trim().max(1000).optional(),
      })
      .superRefine((value, ctx) => {
        if (value.albumName === undefined && value.description === undefined) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Provide albumName or description' });
        }
      }),
  })
  .meta({ id: 'AgentAlbumUpdateDetailsOperationInput' });

const AgentAlbumSetCoverOperationInputSchema = z
  .strictObject({
    ...baseOperation,
    type: z.literal(AgentOperationType.AlbumSetCover),
    targetKind: OperationTargetKindSchema,
    targetId: uuid.optional(),
    temporaryTargetId: temporaryTargetId.optional(),
    assetIds: z.tuple([uuid]),
    payload: emptyPayload,
  })
  .superRefine((value, ctx) => validateTarget(value, ctx))
  .meta({ id: 'AgentAlbumSetCoverOperationInput' });

const validateTarget = (
  value: { targetKind: AgentOperationTargetKind; targetId?: string; temporaryTargetId?: string },
  ctx: z.RefinementCtx,
) => {
  if (value.targetKind === AgentOperationTargetKind.ExistingAlbum && !value.targetId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['targetId'],
      message: 'targetId is required for existing album targets',
    });
  }

  if (value.targetKind === AgentOperationTargetKind.NewAlbum && !value.temporaryTargetId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['temporaryTargetId'],
      message: 'temporaryTargetId is required for new album targets',
    });
  }

  if (value.targetKind === AgentOperationTargetKind.ExistingAlbum && value.temporaryTargetId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['temporaryTargetId'],
      message: 'temporaryTargetId is only valid for new album targets',
    });
  }

  if (value.targetKind === AgentOperationTargetKind.NewAlbum && value.targetId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['targetId'],
      message: 'targetId is only valid for existing album targets',
    });
  }
};

const AgentAlbumOperationInputSchema = z
  .discriminatedUnion('type', [
    AgentAlbumCreateOperationInputSchema,
    AgentAlbumAddAssetsOperationInputSchema,
    AgentAlbumUpdateDetailsOperationInputSchema,
    AgentAlbumSetCoverOperationInputSchema,
  ])
  .meta({ id: 'AgentAlbumOperationInput' });

const AgentProposeAlbumOperationsSchema = z
  .strictObject({
    summary,
    operations: z.array(AgentAlbumOperationInputSchema).min(1).max(500),
  })
  .meta({ id: 'AgentProposeAlbumOperationsDto' });

const AgentReviseAlbumOperationsSchema = AgentProposeAlbumOperationsSchema.extend({
  feedback: z.string().trim().min(1).max(2000).optional(),
}).meta({ id: 'AgentReviseAlbumOperationsDto' });

const AgentOperationResponseSchema = z
  .object({
    id: uuid,
    planId: uuid,
    type: OperationTypeSchema,
    summary,
    targetKind: OperationTargetKindSchema,
    targetId: uuid.nullable(),
    temporaryTargetId: z.string().nullable(),
    assetIds: z.array(uuid),
    payload: z.record(z.string(), z.unknown()),
    dependencyIds: z.array(uuid),
    riskLevel: OperationRiskLevelSchema,
    enabled: z.boolean(),
    status: OperationStatusSchema,
    result: z.record(z.string(), z.unknown()).nullable(),
    error: z.string().nullable(),
    createdAt: isoDatetimeToDate,
    updatedAt: isoDatetimeToDate,
  })
  .meta({ id: 'AgentOperationResponseDto' });

const AgentOperationPlanResponseSchema = z
  .object({
    id: uuid,
    sessionId: uuid,
    revision: z.number().int().min(1),
    status: OperationPlanStatusSchema,
    summary,
    operations: z.array(AgentOperationResponseSchema),
    createdAt: isoDatetimeToDate,
    updatedAt: isoDatetimeToDate,
  })
  .meta({ id: 'AgentOperationPlanResponseDto' });

const AgentOperationPlanToolResponseSchema = z
  .object({
    status: z.literal('success'),
    plan: AgentOperationPlanResponseSchema.nullable(),
    toolCall: AgentToolCallResponseDto.schema.nullable(),
    summary: z.string(),
  })
  .meta({ id: 'AgentOperationPlanToolResponseDto' });

const AgentOperationPlanSummaryRequestSchema = z
  .strictObject({
    focus: z.string().trim().min(1).max(1000).optional(),
  })
  .meta({ id: 'AgentOperationPlanSummaryRequestDto' });

const AgentOperationPlanParamsSchema = z
  .object({
    id: uuid,
    planId: uuid,
  })
  .meta({ id: 'AgentOperationPlanParamsDto' });

const namedZodDto = <TSchema extends z.ZodType>(schemaName: string, schema: TSchema): ZodDto<TSchema, false> => {
  const dto = createZodDto(schema);
  Object.defineProperty(dto, 'name', { value: schemaName });
  return dto;
};

export class AgentProposeAlbumOperationsDto extends createZodDto(AgentProposeAlbumOperationsSchema) {}
export class AgentReviseAlbumOperationsDto extends createZodDto(AgentReviseAlbumOperationsSchema) {}
export class AgentOperationPlanSummaryRequestDto extends createZodDto(AgentOperationPlanSummaryRequestSchema) {}
export class AgentOperationPlanParamsDto extends createZodDto(AgentOperationPlanParamsSchema) {}
export const AgentOperationPlanResponseDto = namedZodDto(
  'AgentOperationPlanResponseDto',
  AgentOperationPlanResponseSchema,
);
export type AgentOperationPlanResponseDto = z.output<typeof AgentOperationPlanResponseSchema>;
export const AgentOperationPlanToolResponseDto = namedZodDto(
  'AgentOperationPlanToolResponseDto',
  AgentOperationPlanToolResponseSchema,
);
export type AgentOperationPlanToolResponseDto = z.output<typeof AgentOperationPlanToolResponseSchema>;
```

- [ ] **Step 6: Run DTO tests and verify they pass**

Run:

```bash
pnpm --dir server test src/dtos/agent-operation.dto.spec.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add server/src/enum.ts server/src/types/agent-operation.types.ts server/src/types/agent-tool.types.ts server/src/dtos/agent-operation.dto.ts server/src/dtos/agent-operation.dto.spec.ts
git commit -m "feat(server): define agent album operation contracts"
```

## Task 2: Schema, Migration, And Repository

**Files:**

- Create: `server/src/schema/tables/agent-operation-plan.table.ts`
- Create: `server/src/schema/tables/agent-operation.table.ts`
- Create: `server/src/schema/migrations/1778920000000-AgentOperationPlan.ts`
- Create: `server/src/repositories/agent-operation-plan.repository.ts`
- Create: `server/test/medium/specs/repositories/agent-operation-plan.repository.spec.ts`
- Modify: `server/src/schema/index.ts`
- Modify: `server/src/database.ts`
- Modify: `server/src/repositories/index.ts`

- [ ] **Step 1: Write failing medium repository tests**

Create `server/test/medium/specs/repositories/agent-operation-plan.repository.spec.ts`.

```ts
import { Kysely } from 'kysely';
import {
  AgentApprovalMode,
  AgentOperationPlanStatus,
  AgentOperationRiskLevel,
  AgentOperationStatus,
  AgentOperationTargetKind,
  AgentOperationType,
  AgentPermissionPreset,
  AgentProviderType,
} from 'src/enum';
import { AgentOperationPlanRepository } from 'src/repositories/agent-operation-plan.repository';
import { AgentProviderCredentialRepository } from 'src/repositories/agent-provider-credential.repository';
import { AgentSessionRepository } from 'src/repositories/agent-session.repository';
import { LoggingRepository } from 'src/repositories/logging.repository';
import { DB } from 'src/schema';
import { BaseService } from 'src/services/base.service';
import { newMediumService } from 'test/medium.factory';
import { factory } from 'test/small.factory';
import { getKyselyDB } from 'test/utils';

let defaultDatabase: Kysely<DB>;

const permissionPlanSnapshot = {
  read: { metadata: true, previews: false, originals: false },
  providerExposure: {
    metadata: true,
    previews: false,
    originals: false,
    allowOriginalsForExternalProviders: false,
  },
  assetScope: { owned: true, sharedSpaces: false, locked: false },
  writeScope: { createAlbum: true, addAssets: true, updateDetails: true, setCover: true },
  limits: {
    maxAssetsPerToolCall: 100,
    maxAssetsPerSession: 1000,
    maxPreviewsPerToolCall: 0,
    maxOriginalsPerToolCall: 0,
    expiresInMinutes: 60,
  },
};

const setup = (db?: Kysely<DB>) => {
  const database = db || defaultDatabase;
  const { ctx } = newMediumService(BaseService, {
    database,
    real: [],
    mock: [LoggingRepository],
  });

  return {
    ctx,
    credentialRepository: new AgentProviderCredentialRepository(database),
    sessionRepository: new AgentSessionRepository(database),
    sut: new AgentOperationPlanRepository(database),
  };
};

const createSession = async (
  ctx: ReturnType<typeof setup>['ctx'],
  credentialRepository: AgentProviderCredentialRepository,
  sessionRepository: AgentSessionRepository,
) => {
  const { user } = await ctx.newUser();
  const credential = await credentialRepository.create({
    userId: user.id,
    providerType: AgentProviderType.OpenAI,
    label: 'OpenAI personal',
    baseUrl: null,
    encryptedSecret: 'v1:encrypted',
    models: ['gpt-5.1'],
    defaultModel: 'gpt-5.1',
  });

  const session = await sessionRepository.create({
    userId: user.id,
    providerCredentialId: credential.id,
    credentialSnapshot: {
      id: credential.id,
      providerType: AgentProviderType.OpenAI,
      label: 'OpenAI personal',
      baseUrl: null,
      models: ['gpt-5.1'],
      defaultModel: 'gpt-5.1',
    },
    modelSnapshot: { providerCredentialId: credential.id, model: 'gpt-5.1' },
    permissionPreset: AgentPermissionPreset.Careful,
    permissionPlanSnapshot,
    approvalMode: AgentApprovalMode.Strict,
    runnerEndpoint: null,
    runnerSessionId: null,
    runnerCapabilitiesSnapshot: null,
    initialContextSnapshot: {},
  });

  return { user, session };
};

beforeAll(async () => {
  defaultDatabase = await getKyselyDB();
});

describe(AgentOperationPlanRepository.name, () => {
  it('creates a revision with operations and returns operations in creation order', async () => {
    const { ctx, credentialRepository, sessionRepository, sut } = setup();
    const { session } = await createSession(ctx, credentialRepository, sessionRepository);
    const plan = await sut.createRevision({
      plan: {
        sessionId: session.id,
        revision: 1,
        status: AgentOperationPlanStatus.Proposed,
        summary: 'Portugal album plan.',
      },
      operations: [
        {
          planId: '',
          type: AgentOperationType.AlbumCreate,
          summary: 'Create Portugal.',
          targetKind: AgentOperationTargetKind.NewAlbum,
          targetId: null,
          temporaryTargetId: 'tmp-portugal',
          assetIds: [],
          payload: { albumName: 'Portugal' },
          dependencyIds: [],
          riskLevel: AgentOperationRiskLevel.Low,
          enabled: true,
          status: AgentOperationStatus.Proposed,
          result: null,
          error: null,
        },
        {
          planId: '',
          type: AgentOperationType.AlbumAddAssets,
          summary: 'Add one asset.',
          targetKind: AgentOperationTargetKind.NewAlbum,
          targetId: null,
          temporaryTargetId: 'tmp-portugal',
          assetIds: [factory.uuid()],
          payload: {},
          dependencyIds: [],
          riskLevel: AgentOperationRiskLevel.Low,
          enabled: true,
          status: AgentOperationStatus.Proposed,
          result: null,
          error: null,
        },
      ],
    });

    expect(plan).toMatchObject({
      sessionId: session.id,
      revision: 1,
      status: AgentOperationPlanStatus.Proposed,
      operations: [{ type: AgentOperationType.AlbumCreate }, { type: AgentOperationType.AlbumAddAssets }],
    });
    expect(plan.operations.every((operation) => operation.planId === plan.id)).toBe(true);
  });

  it('stores database operation ids as dependencies for operations targeting newly proposed albums', async () => {
    const { ctx, credentialRepository, sessionRepository, sut } = setup();
    const { session } = await createSession(ctx, credentialRepository, sessionRepository);
    const plan = await sut.createRevision({
      plan: {
        sessionId: session.id,
        revision: 1,
        status: AgentOperationPlanStatus.Proposed,
        summary: 'Portugal album plan.',
      },
      operations: [
        {
          planId: '',
          type: AgentOperationType.AlbumCreate,
          summary: 'Create Portugal.',
          targetKind: AgentOperationTargetKind.NewAlbum,
          targetId: null,
          temporaryTargetId: 'tmp-portugal',
          assetIds: [],
          payload: { albumName: 'Portugal' },
          dependencyIds: [],
          riskLevel: AgentOperationRiskLevel.Low,
          enabled: true,
          status: AgentOperationStatus.Proposed,
          result: null,
          error: null,
        },
        {
          planId: '',
          type: AgentOperationType.AlbumSetCover,
          summary: 'Set Portugal cover.',
          targetKind: AgentOperationTargetKind.NewAlbum,
          targetId: null,
          temporaryTargetId: 'tmp-portugal',
          assetIds: [factory.uuid()],
          payload: {},
          dependencyIds: [],
          riskLevel: AgentOperationRiskLevel.Low,
          enabled: true,
          status: AgentOperationStatus.Proposed,
          result: null,
          error: null,
        },
      ],
    });

    const [createOperation, coverOperation] = plan.operations;
    expect(coverOperation.dependencyIds).toEqual([createOperation.id]);
  });

  it('supersedes the previous proposed plan when creating a replacement revision', async () => {
    const { ctx, credentialRepository, sessionRepository, sut } = setup();
    const { session } = await createSession(ctx, credentialRepository, sessionRepository);
    const first = await sut.createRevision({
      plan: { sessionId: session.id, revision: 1, status: AgentOperationPlanStatus.Proposed, summary: 'First plan.' },
      operations: [],
    });
    const second = await sut.createReplacementRevision(session.id, {
      plan: { sessionId: session.id, status: AgentOperationPlanStatus.Proposed, summary: 'Second plan.' },
      operations: [],
    });

    await expect(sut.getByIdForSession(session.id, first.id)).resolves.toMatchObject({
      id: first.id,
      status: AgentOperationPlanStatus.Superseded,
    });
    await expect(sut.getCurrentBySessionId(session.id)).resolves.toMatchObject({ id: second.id, revision: 2 });
  });

  it('computes replacement revisions inside the replacement transaction', async () => {
    const { ctx, credentialRepository, sessionRepository, sut } = setup();
    const { session } = await createSession(ctx, credentialRepository, sessionRepository);
    await sut.createRevision({
      plan: { sessionId: session.id, revision: 1, status: AgentOperationPlanStatus.Proposed, summary: 'First plan.' },
      operations: [],
    });

    const replacement = await sut.createReplacementRevision(session.id, {
      plan: { sessionId: session.id, status: AgentOperationPlanStatus.Proposed, summary: 'Atomic revision.' },
      operations: [],
    });

    expect(replacement.revision).toBe(2);
  });

  it('computes the next revision per session', async () => {
    const { ctx, credentialRepository, sessionRepository, sut } = setup();
    const { session } = await createSession(ctx, credentialRepository, sessionRepository);

    await expect(sut.getNextRevision(session.id)).resolves.toBe(1);
    await sut.createRevision({
      plan: { sessionId: session.id, revision: 1, status: AgentOperationPlanStatus.Proposed, summary: 'First plan.' },
      operations: [],
    });
    await expect(sut.getNextRevision(session.id)).resolves.toBe(2);
  });

  it('deletes operations when the owning session is deleted', async () => {
    const { ctx, credentialRepository, sessionRepository, sut } = setup();
    const { session } = await createSession(ctx, credentialRepository, sessionRepository);
    const plan = await sut.createRevision({
      plan: { sessionId: session.id, revision: 1, status: AgentOperationPlanStatus.Proposed, summary: 'Plan.' },
      operations: [
        {
          planId: '',
          type: AgentOperationType.AlbumCreate,
          summary: 'Create Portugal.',
          targetKind: AgentOperationTargetKind.NewAlbum,
          targetId: null,
          temporaryTargetId: 'tmp-portugal',
          assetIds: [],
          payload: { albumName: 'Portugal' },
          dependencyIds: [],
          riskLevel: AgentOperationRiskLevel.Low,
          enabled: true,
          status: AgentOperationStatus.Proposed,
          result: null,
          error: null,
        },
      ],
    });

    await defaultDatabase.deleteFrom('agent_session').where('id', '=', session.id).execute();

    await expect(sut.getByIdForSession(session.id, plan.id)).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run medium tests and verify they fail**

Run:

```bash
pnpm --dir server test:medium test/medium/specs/repositories/agent-operation-plan.repository.spec.ts
```

Expected: FAIL because the repository and tables do not exist yet.

- [ ] **Step 3: Add sql-tools table classes**

Create `server/src/schema/tables/agent-operation-plan.table.ts`.

```ts
import {
  Column,
  CreateDateColumn,
  ForeignKeyColumn,
  Generated,
  Index,
  PrimaryGeneratedColumn,
  Table,
  Timestamp,
  UpdateDateColumn,
} from '@immich/sql-tools';
import { UpdatedAtTrigger } from 'src/decorators';
import { AgentOperationPlanStatus } from 'src/enum';
import { AgentSessionTable } from 'src/schema/tables/agent-session.table';

@Index({ columns: ['sessionId', 'status'] })
@Index({ name: 'agent_operation_plan_sessionId_revision_key', columns: ['sessionId', 'revision'], unique: true })
@Table('agent_operation_plan')
@UpdatedAtTrigger('agent_operation_plan_updatedAt')
export class AgentOperationPlanTable {
  @PrimaryGeneratedColumn()
  id!: Generated<string>;

  @ForeignKeyColumn(() => AgentSessionTable, { onUpdate: 'CASCADE', onDelete: 'CASCADE' })
  sessionId!: string;

  @Column({ type: 'integer' })
  revision!: number;

  @Column()
  status!: AgentOperationPlanStatus;

  @Column({ type: 'text' })
  summary!: string;

  @CreateDateColumn()
  createdAt!: Generated<Timestamp>;

  @UpdateDateColumn()
  updatedAt!: Generated<Timestamp>;
}
```

Create `server/src/schema/tables/agent-operation.table.ts`.

```ts
import {
  Column,
  CreateDateColumn,
  ForeignKeyColumn,
  Generated,
  Index,
  PrimaryGeneratedColumn,
  Table,
  Timestamp,
  UpdateDateColumn,
} from '@immich/sql-tools';
import { UpdatedAtTrigger } from 'src/decorators';
import { AgentOperationRiskLevel, AgentOperationStatus, AgentOperationTargetKind, AgentOperationType } from 'src/enum';
import { AgentOperationPlanTable } from 'src/schema/tables/agent-operation-plan.table';
import type { AgentOperationPayload, AgentOperationResult } from 'src/types/agent-operation.types';

@Index({ columns: ['planId'] })
@Index({ columns: ['planId', 'status'] })
@Table('agent_operation')
@UpdatedAtTrigger('agent_operation_updatedAt')
export class AgentOperationTable {
  @PrimaryGeneratedColumn()
  id!: Generated<string>;

  @ForeignKeyColumn(() => AgentOperationPlanTable, { onUpdate: 'CASCADE', onDelete: 'CASCADE' })
  planId!: string;

  @Column()
  type!: AgentOperationType;

  @Column({ type: 'text' })
  summary!: string;

  @Column()
  targetKind!: AgentOperationTargetKind;

  @Column({ nullable: true })
  targetId!: string | null;

  @Column({ nullable: true })
  temporaryTargetId!: string | null;

  @Column({ type: 'jsonb' })
  assetIds!: string[];

  @Column({ type: 'jsonb' })
  payload!: AgentOperationPayload;

  @Column({ type: 'jsonb' })
  dependencyIds!: string[];

  @Column()
  riskLevel!: AgentOperationRiskLevel;

  @Column({ type: 'boolean', default: true })
  enabled!: Generated<boolean>;

  @Column({ default: AgentOperationStatus.Proposed })
  status!: Generated<AgentOperationStatus>;

  @Column({ type: 'jsonb', nullable: true })
  result!: AgentOperationResult | null;

  @Column({ type: 'text', nullable: true })
  error!: string | null;

  @CreateDateColumn()
  createdAt!: Generated<Timestamp>;

  @UpdateDateColumn()
  updatedAt!: Generated<Timestamp>;
}
```

- [ ] **Step 4: Register schema and database types**

Modify `server/src/schema/index.ts` imports and `DB`:

```ts
import { AgentOperationTable } from 'src/schema/tables/agent-operation.table';
import { AgentOperationPlanTable } from 'src/schema/tables/agent-operation-plan.table';
```

```ts
agent_operation_plan: AgentOperationPlanTable;
agent_operation: AgentOperationTable;
```

Modify `server/src/database.ts` imports, selectable exports, and column lists:

```ts
import { AgentOperationTable } from 'src/schema/tables/agent-operation.table';
import { AgentOperationPlanTable } from 'src/schema/tables/agent-operation-plan.table';
```

```ts
export type AgentOperationPlan = Selectable<AgentOperationPlanTable>;
export type AgentOperation = Selectable<AgentOperationTable>;
```

Add these entries to `columns` near the other agent column lists:

```ts
agentOperationPlan: ['id', 'sessionId', 'revision', 'status', 'summary', 'createdAt', 'updatedAt'],
agentOperation: [
  'id',
  'planId',
  'type',
  'summary',
  'targetKind',
  'targetId',
  'temporaryTargetId',
  'assetIds',
  'payload',
  'dependencyIds',
  'riskLevel',
  'enabled',
  'status',
  'result',
  'error',
  'createdAt',
  'updatedAt',
],
```

- [ ] **Step 5: Add migration**

Create `server/src/schema/migrations/1778920000000-AgentOperationPlan.ts`.

```ts
import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE "agent_operation_plan" (
      "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
      "sessionId" uuid NOT NULL,
      "revision" integer NOT NULL,
      "status" character varying NOT NULL,
      "summary" text NOT NULL,
      "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
      "updatedAt" timestamp with time zone NOT NULL DEFAULT now(),
      CONSTRAINT "agent_operation_plan_pkey" PRIMARY KEY ("id"),
      CONSTRAINT "agent_operation_plan_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "agent_session"("id") ON UPDATE CASCADE ON DELETE CASCADE
    )
  `.execute(db);

  await sql`CREATE INDEX "agent_operation_plan_sessionId_status_idx" ON "agent_operation_plan" ("sessionId", "status")`.execute(
    db,
  );
  await sql`CREATE UNIQUE INDEX "agent_operation_plan_sessionId_revision_key" ON "agent_operation_plan" ("sessionId", "revision")`.execute(
    db,
  );

  await sql`
    CREATE OR REPLACE TRIGGER "agent_operation_plan_updatedAt"
    BEFORE UPDATE ON "agent_operation_plan"
    FOR EACH ROW
    EXECUTE FUNCTION updated_at()
  `.execute(db);

  await sql`
    INSERT INTO "migration_overrides" ("name", "value")
    VALUES ('trigger_agent_operation_plan_updatedAt', '{"type":"trigger","name":"agent_operation_plan_updatedAt","sql":"CREATE OR REPLACE TRIGGER \\"agent_operation_plan_updatedAt\\"\\n  BEFORE UPDATE ON \\"agent_operation_plan\\"\\n  FOR EACH ROW\\n  EXECUTE FUNCTION updated_at();"}'::jsonb)
  `.execute(db);

  await sql`
    CREATE TABLE "agent_operation" (
      "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
      "planId" uuid NOT NULL,
      "type" character varying NOT NULL,
      "summary" text NOT NULL,
      "targetKind" character varying NOT NULL,
      "targetId" uuid,
      "temporaryTargetId" character varying,
      "assetIds" jsonb NOT NULL,
      "payload" jsonb NOT NULL,
      "dependencyIds" jsonb NOT NULL,
      "riskLevel" character varying NOT NULL,
      "enabled" boolean NOT NULL DEFAULT true,
      "status" character varying NOT NULL DEFAULT 'proposed',
      "result" jsonb,
      "error" text,
      "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
      "updatedAt" timestamp with time zone NOT NULL DEFAULT now(),
      CONSTRAINT "agent_operation_pkey" PRIMARY KEY ("id"),
      CONSTRAINT "agent_operation_planId_fkey" FOREIGN KEY ("planId") REFERENCES "agent_operation_plan"("id") ON UPDATE CASCADE ON DELETE CASCADE
    )
  `.execute(db);

  await sql`CREATE INDEX "agent_operation_planId_idx" ON "agent_operation" ("planId")`.execute(db);
  await sql`CREATE INDEX "agent_operation_planId_status_idx" ON "agent_operation" ("planId", "status")`.execute(db);

  await sql`
    CREATE OR REPLACE TRIGGER "agent_operation_updatedAt"
    BEFORE UPDATE ON "agent_operation"
    FOR EACH ROW
    EXECUTE FUNCTION updated_at()
  `.execute(db);

  await sql`
    INSERT INTO "migration_overrides" ("name", "value")
    VALUES ('trigger_agent_operation_updatedAt', '{"type":"trigger","name":"agent_operation_updatedAt","sql":"CREATE OR REPLACE TRIGGER \\"agent_operation_updatedAt\\"\\n  BEFORE UPDATE ON \\"agent_operation\\"\\n  FOR EACH ROW\\n  EXECUTE FUNCTION updated_at();"}'::jsonb)
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DELETE FROM "migration_overrides" WHERE "name" = 'trigger_agent_operation_updatedAt'`.execute(db);
  await sql`DROP TRIGGER IF EXISTS "agent_operation_updatedAt" ON "agent_operation"`.execute(db);
  await sql`DROP INDEX "agent_operation_planId_status_idx"`.execute(db);
  await sql`DROP INDEX "agent_operation_planId_idx"`.execute(db);
  await sql`DROP TABLE "agent_operation"`.execute(db);
  await sql`DELETE FROM "migration_overrides" WHERE "name" = 'trigger_agent_operation_plan_updatedAt'`.execute(db);
  await sql`DROP TRIGGER IF EXISTS "agent_operation_plan_updatedAt" ON "agent_operation_plan"`.execute(db);
  await sql`DROP INDEX "agent_operation_plan_sessionId_revision_key"`.execute(db);
  await sql`DROP INDEX "agent_operation_plan_sessionId_status_idx"`.execute(db);
  await sql`DROP TABLE "agent_operation_plan"`.execute(db);
}
```

- [ ] **Step 6: Add repository implementation**

Create `server/src/repositories/agent-operation-plan.repository.ts`.

```ts
import { Injectable } from '@nestjs/common';
import { Insertable, Kysely, sql, Transaction } from 'kysely';
import { InjectKysely } from 'nestjs-kysely';
import { columns } from 'src/database';
import { DummyValue, GenerateSql } from 'src/decorators';
import { AgentOperationPlanStatus, AgentOperationTargetKind, AgentOperationType } from 'src/enum';
import { DB } from 'src/schema';
import { AgentOperationTable } from 'src/schema/tables/agent-operation.table';
import { AgentOperationPlanTable } from 'src/schema/tables/agent-operation-plan.table';
import { asUuid } from 'src/utils/database';

type PlanCreate = Insertable<AgentOperationPlanTable>;
type ReplacementPlanCreate = Omit<PlanCreate, 'revision'>;
type OperationCreate = Insertable<AgentOperationTable>;

export type AgentOperationPlanWithOperations = Awaited<ReturnType<AgentOperationPlanRepository['createRevision']>>;

@Injectable()
export class AgentOperationPlanRepository {
  constructor(@InjectKysely() private db: Kysely<DB>) {}

  async createRevision(dto: { plan: PlanCreate; operations: OperationCreate[] }) {
    return this.db.transaction().execute(async (trx) => {
      const plan = await trx
        .insertInto('agent_operation_plan')
        .values(dto.plan)
        .returning(columns.agentOperationPlan)
        .executeTakeFirstOrThrow();

      const operations = await this.insertOperationsResolvingDependencies(trx, plan.id, dto.operations);

      return { ...plan, operations };
    });
  }

  async createReplacementRevision(
    sessionId: string,
    dto: { plan: ReplacementPlanCreate; operations: OperationCreate[] },
  ) {
    return this.db.transaction().execute(async (trx) => {
      await trx
        .selectFrom('agent_session')
        .select('id')
        .where('id', '=', asUuid(sessionId))
        .forUpdate()
        .executeTakeFirstOrThrow();

      const revisionResult = await trx
        .selectFrom('agent_operation_plan')
        .select((eb) => sql<number>`coalesce(max(${eb.ref('revision')}), 0)::int + 1`.as('revision'))
        .where('sessionId', '=', asUuid(sessionId))
        .executeTakeFirstOrThrow();

      await trx
        .updateTable('agent_operation_plan')
        .set({ status: AgentOperationPlanStatus.Superseded })
        .where('sessionId', '=', asUuid(sessionId))
        .where('status', '=', AgentOperationPlanStatus.Proposed)
        .execute();

      const plan = await trx
        .insertInto('agent_operation_plan')
        .values({ ...dto.plan, revision: revisionResult.revision })
        .returning(columns.agentOperationPlan)
        .executeTakeFirstOrThrow();

      const operations = await this.insertOperationsResolvingDependencies(trx, plan.id, dto.operations);

      return { ...plan, operations };
    });
  }

  @GenerateSql({ params: [DummyValue.UUID] })
  async getNextRevision(sessionId: string) {
    const result = await this.db
      .selectFrom('agent_operation_plan')
      .select((eb) => sql<number>`coalesce(max(${eb.ref('revision')}), 0)::int + 1`.as('revision'))
      .where('sessionId', '=', asUuid(sessionId))
      .executeTakeFirstOrThrow();

    return result.revision;
  }

  @GenerateSql({ params: [DummyValue.UUID] })
  async getCurrentBySessionId(sessionId: string) {
    const plan = await this.db
      .selectFrom('agent_operation_plan')
      .select(columns.agentOperationPlan)
      .where('sessionId', '=', asUuid(sessionId))
      .where('status', '=', AgentOperationPlanStatus.Proposed)
      .orderBy('revision', 'desc')
      .orderBy('id', 'desc')
      .executeTakeFirst();

    return plan ? { ...plan, operations: await this.getOperations(plan.id) } : undefined;
  }

  @GenerateSql({ params: [DummyValue.UUID, DummyValue.UUID] })
  async getByIdForSession(sessionId: string, planId: string) {
    const plan = await this.db
      .selectFrom('agent_operation_plan')
      .select(columns.agentOperationPlan)
      .where('sessionId', '=', asUuid(sessionId))
      .where('id', '=', asUuid(planId))
      .executeTakeFirst();

    return plan ? { ...plan, operations: await this.getOperations(plan.id) } : undefined;
  }

  private getOperations(planId: string) {
    return this.db
      .selectFrom('agent_operation')
      .select(columns.agentOperation)
      .where('planId', '=', asUuid(planId))
      .orderBy('createdAt', 'asc')
      .orderBy('id', 'asc')
      .execute();
  }

  private async insertOperationsResolvingDependencies(
    trx: Transaction<DB>,
    planId: string,
    operations: OperationCreate[],
  ) {
    if (operations.length === 0) {
      return [];
    }

    const inserted = await trx
      .insertInto('agent_operation')
      .values(operations.map((operation) => ({ ...operation, planId })))
      .returning(columns.agentOperation)
      .execute();

    const createIdByTemporaryTargetId = new Map(
      inserted
        .filter((operation) => operation.type === AgentOperationType.AlbumCreate && operation.temporaryTargetId)
        .map((operation) => [operation.temporaryTargetId!, operation.id]),
    );

    const resolved = [];
    for (const operation of inserted) {
      const dependencyIds =
        (operation.type === AgentOperationType.AlbumAddAssets || operation.type === AgentOperationType.AlbumSetCover) &&
        operation.targetKind === AgentOperationTargetKind.NewAlbum &&
        operation.temporaryTargetId
          ? [createIdByTemporaryTargetId.get(operation.temporaryTargetId)!]
          : operation.dependencyIds;

      if (dependencyIds === operation.dependencyIds) {
        resolved.push(operation);
        continue;
      }

      resolved.push(
        await trx
          .updateTable('agent_operation')
          .set({ dependencyIds })
          .where('id', '=', asUuid(operation.id))
          .returning(columns.agentOperation)
          .executeTakeFirstOrThrow(),
      );
    }

    return resolved;
  }
}
```

- [ ] **Step 7: Register the repository**

Modify `server/src/repositories/index.ts`:

```ts
import { AgentOperationPlanRepository } from 'src/repositories/agent-operation-plan.repository';
```

Add it to `repositories` near the other agent repositories:

```ts
AgentOperationPlanRepository,
```

- [ ] **Step 8: Run migration/debug and repository tests**

Run:

```bash
pnpm --dir server migrations:debug
pnpm --dir server test:medium test/medium/specs/repositories/agent-operation-plan.repository.spec.ts
```

Expected: PASS. If `migrations:debug` prints generated SQL that differs from the manual migration, reconcile table/index/trigger definitions before continuing.

- [ ] **Step 9: Commit**

```bash
git add server/src/schema/tables/agent-operation-plan.table.ts server/src/schema/tables/agent-operation.table.ts server/src/schema/migrations/1778920000000-AgentOperationPlan.ts server/src/repositories/agent-operation-plan.repository.ts server/test/medium/specs/repositories/agent-operation-plan.repository.spec.ts server/src/schema/index.ts server/src/database.ts server/src/repositories/index.ts
git commit -m "feat(server): persist agent operation plan revisions"
```

## Task 3: Operation Plan Service

**Files:**

- Create: `server/src/services/agent-operation-plan.service.ts`
- Create: `server/src/services/agent-operation-plan.service.spec.ts`
- Modify: `server/src/services/index.ts`
- Modify: `server/src/repositories/websocket.repository.ts`

- [ ] **Step 1: Write failing service tests**

Create `server/src/services/agent-operation-plan.service.spec.ts`.

```ts
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { AgentOperation, AgentOperationPlan, AgentSession } from 'src/database';
import {
  AgentApprovalMode,
  AgentOperationPlanStatus,
  AgentOperationRiskLevel,
  AgentOperationStatus,
  AgentOperationTargetKind,
  AgentOperationType,
  AgentPermissionPreset,
  AgentProviderType,
  AgentSessionStatus,
  AgentToolApprovalDecision,
  AgentToolCallStatus,
  AgentToolDataClass,
  AgentToolName,
} from 'src/enum';
import { AccessRepository } from 'src/repositories/access.repository';
import { AgentOperationPlanRepository } from 'src/repositories/agent-operation-plan.repository';
import { AgentSessionRepository } from 'src/repositories/agent-session.repository';
import { AgentToolCallRepository } from 'src/repositories/agent-tool-call.repository';
import { AssetRepository } from 'src/repositories/asset.repository';
import { WebsocketRepository } from 'src/repositories/websocket.repository';
import { AgentOperationPlanService } from 'src/services/agent-operation-plan.service';
import { AgentPermissionPlanSnapshot } from 'src/types/agent-session.types';
import { AuthFactory } from 'test/factories/auth.factory';
import { newAccessRepositoryMock } from 'test/repositories/access.repository.mock';
import { newAssetRepositoryMock } from 'test/repositories/asset.repository.mock';
import { newUuid } from 'test/small.factory';
import { automock } from 'test/utils';

const now = new Date('2026-05-15T12:00:00.000Z');

const permissionPlanSnapshot: AgentPermissionPlanSnapshot = {
  read: { metadata: true, previews: false, originals: false },
  providerExposure: {
    metadata: true,
    previews: false,
    originals: false,
    allowOriginalsForExternalProviders: false,
  },
  assetScope: { owned: true, sharedSpaces: false, locked: false },
  writeScope: { createAlbum: true, addAssets: true, updateDetails: true, setCover: true },
  limits: {
    maxAssetsPerToolCall: 100,
    maxAssetsPerSession: 1000,
    maxPreviewsPerToolCall: 0,
    maxOriginalsPerToolCall: 0,
    expiresInMinutes: 60,
  },
};

const makeSession = (overrides: Partial<AgentSession> = {}): AgentSession => {
  const providerCredentialId = newUuid();
  return {
    id: newUuid(),
    userId: newUuid(),
    providerCredentialId,
    credentialSnapshot: {
      id: providerCredentialId,
      providerType: AgentProviderType.OpenAI,
      label: 'OpenAI personal',
      baseUrl: null,
      models: ['gpt-5.1'],
      defaultModel: 'gpt-5.1',
    },
    modelSnapshot: { providerCredentialId, model: 'gpt-5.1' },
    permissionPreset: AgentPermissionPreset.Careful,
    permissionPlanSnapshot,
    approvalMode: AgentApprovalMode.Strict,
    runnerEndpoint: null,
    runnerSessionId: null,
    runnerCapabilitiesSnapshot: null,
    status: AgentSessionStatus.Running,
    initialContextSnapshot: {},
    createdAt: now,
    updatedAt: now,
    endedAt: null,
    updateId: newUuid(),
    ...overrides,
  };
};

const makeOperation = (overrides: Partial<AgentOperation> = {}): AgentOperation => ({
  id: newUuid(),
  planId: overrides.planId ?? newUuid(),
  type: AgentOperationType.AlbumCreate,
  summary: 'Create Portugal.',
  targetKind: AgentOperationTargetKind.NewAlbum,
  targetId: null,
  temporaryTargetId: 'tmp-portugal',
  assetIds: [],
  payload: { albumName: 'Portugal' },
  dependencyIds: [],
  riskLevel: AgentOperationRiskLevel.Low,
  enabled: true,
  status: AgentOperationStatus.Proposed,
  result: null,
  error: null,
  createdAt: now,
  updatedAt: now,
  ...overrides,
});

const makePlan = (overrides: Partial<AgentOperationPlan> & { operations?: AgentOperation[] } = {}) => {
  const plan: AgentOperationPlan = {
    id: newUuid(),
    sessionId: newUuid(),
    revision: 1,
    status: AgentOperationPlanStatus.Proposed,
    summary: 'Portugal plan.',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
  return { ...plan, operations: overrides.operations ?? [makeOperation({ planId: plan.id })] };
};

describe(AgentOperationPlanService.name, () => {
  let sut: AgentOperationPlanService;
  let accessRepository: ReturnType<typeof newAccessRepositoryMock>;
  let assetRepository: ReturnType<typeof newAssetRepositoryMock>;
  let sessionRepository: ReturnType<typeof automock<AgentSessionRepository>>;
  let planRepository: ReturnType<typeof automock<AgentOperationPlanRepository>>;
  let toolCallRepository: ReturnType<typeof automock<AgentToolCallRepository>>;
  let websocketRepository: ReturnType<typeof automock<WebsocketRepository>>;

  beforeEach(() => {
    accessRepository = newAccessRepositoryMock();
    assetRepository = newAssetRepositoryMock();
    sessionRepository = automock(AgentSessionRepository, { args: [{} as never] });
    planRepository = automock(AgentOperationPlanRepository, { args: [{} as never] });
    toolCallRepository = automock(AgentToolCallRepository, { args: [{} as never] });
    websocketRepository = automock(WebsocketRepository);
    sut = new AgentOperationPlanService(
      accessRepository as unknown as AccessRepository,
      assetRepository as unknown as AssetRepository,
      sessionRepository,
      planRepository,
      toolCallRepository,
      websocketRepository,
    );
  });

  it('stores a proposed plan with computed dependencies and marks the session waiting for plan review', async () => {
    const auth = AuthFactory.create();
    const session = makeSession({ userId: auth.user.id });
    const createOperationId = newUuid();
    const addOperationId = newUuid();
    const plan = makePlan({
      sessionId: session.id,
      operations: [
        makeOperation({ id: createOperationId, planId: 'plan-id' }),
        makeOperation({
          id: addOperationId,
          planId: 'plan-id',
          type: AgentOperationType.AlbumAddAssets,
          summary: 'Add beach photo.',
          temporaryTargetId: 'tmp-portugal',
          assetIds: [newUuid()],
          payload: {},
          dependencyIds: [createOperationId],
        }),
      ],
    });
    sessionRepository.getById.mockResolvedValue(session);
    planRepository.createReplacementRevision.mockResolvedValue(plan);
    accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set([plan.operations[1].assetIds[0]]));
    toolCallRepository.create.mockImplementation((dto) =>
      Promise.resolve({
        id: newUuid(),
        startedAt: now,
        completedAt: now,
        ...dto,
      } as never),
    );

    const result = await sut.proposeAlbumOperations(auth, session.id, {
      summary: 'Portugal plan.',
      operations: [
        {
          type: AgentOperationType.AlbumCreate,
          summary: 'Create Portugal.',
          targetKind: AgentOperationTargetKind.NewAlbum,
          temporaryTargetId: 'tmp-portugal',
          payload: { albumName: 'Portugal' },
          enabled: true,
          riskLevel: AgentOperationRiskLevel.Low,
        },
        {
          type: AgentOperationType.AlbumAddAssets,
          summary: 'Add beach photo.',
          targetKind: AgentOperationTargetKind.NewAlbum,
          temporaryTargetId: 'tmp-portugal',
          assetIds: [plan.operations[1].assetIds[0]],
          payload: {},
          enabled: true,
          riskLevel: AgentOperationRiskLevel.Low,
        },
      ],
    });

    expect(result.status).toBe('success');
    expect(planRepository.createReplacementRevision).toHaveBeenCalledWith(
      session.id,
      expect.objectContaining({
        plan: expect.objectContaining({ sessionId: session.id, revision: 1, summary: 'Portugal plan.' }),
        operations: expect.arrayContaining([
          expect.objectContaining({
            type: AgentOperationType.AlbumCreate,
            temporaryTargetId: 'tmp-portugal',
            dependencyIds: [],
          }),
          expect.objectContaining({
            type: AgentOperationType.AlbumAddAssets,
            temporaryTargetId: 'tmp-portugal',
            dependencyIds: expect.arrayContaining([expect.any(String)]),
          }),
        ]),
      }),
    );
    expect(sessionRepository.update).toHaveBeenCalledWith(auth.user.id, session.id, {
      status: AgentSessionStatus.WaitingForPlanReview,
    });
    expect(toolCallRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: session.id,
        toolName: AgentToolName.ProposeAlbumOperations,
        status: AgentToolCallStatus.Completed,
        approvalDecision: AgentToolApprovalDecision.Approved,
        dataClass: AgentToolDataClass.Plan,
        assetCount: 1,
        albumCount: 0,
        redactedResponseMetadata: { planId: plan.id, operationIds: [createOperationId, addOperationId] },
      }),
    );
    expect(websocketRepository.clientSend).toHaveBeenCalledWith('on_agent_session_event', auth.user.id, {
      type: 'operation-plan-ready',
      sessionId: session.id,
      planId: plan.id,
      revision: plan.revision,
    });
  });

  it('rejects operations targeting a new album without a matching create operation', async () => {
    const auth = AuthFactory.create();
    const assetId = newUuid();
    const session = makeSession({ userId: auth.user.id });
    sessionRepository.getById.mockResolvedValue(session);
    accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set([assetId]));

    await expect(
      sut.proposeAlbumOperations(auth, session.id, {
        summary: 'Broken plan.',
        operations: [
          {
            type: AgentOperationType.AlbumAddAssets,
            summary: 'Add to missing new album.',
            targetKind: AgentOperationTargetKind.NewAlbum,
            temporaryTargetId: 'tmp-missing',
            assetIds: [assetId],
            payload: {},
            enabled: true,
            riskLevel: AgentOperationRiskLevel.Low,
          },
        ],
      }),
    ).rejects.toThrow('No album.create operation found for temporaryTargetId: tmp-missing');
    expect(planRepository.createReplacementRevision).not.toHaveBeenCalled();
  });

  it('audits and rejects inaccessible existing album targets', async () => {
    const auth = AuthFactory.create();
    const session = makeSession({ userId: auth.user.id });
    sessionRepository.getById.mockResolvedValue(session);
    accessRepository.album.checkOwnerAccess.mockResolvedValue(new Set());
    accessRepository.album.checkSharedAlbumAccess.mockResolvedValue(new Set());
    toolCallRepository.create.mockImplementation((dto) =>
      Promise.resolve({ id: newUuid(), startedAt: now, completedAt: now, ...dto } as never),
    );

    await expect(
      sut.proposeAlbumOperations(auth, session.id, {
        summary: 'Denied plan.',
        operations: [
          {
            type: AgentOperationType.AlbumUpdateDetails,
            summary: 'Rename inaccessible album.',
            targetKind: AgentOperationTargetKind.ExistingAlbum,
            targetId: newUuid(),
            payload: { albumName: 'Private album' },
            enabled: true,
            riskLevel: AgentOperationRiskLevel.Low,
          },
        ],
      }),
    ).rejects.toThrow('One or more target albums are not accessible');

    expect(toolCallRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        status: AgentToolCallStatus.Denied,
        approvalDecision: AgentToolApprovalDecision.Denied,
        dataClass: AgentToolDataClass.Plan,
        error: 'One or more target albums are not accessible',
      }),
    );
    expect(planRepository.createReplacementRevision).not.toHaveBeenCalled();
  });

  it('audits and rejects inaccessible asset ids', async () => {
    const auth = AuthFactory.create();
    const session = makeSession({ userId: auth.user.id });
    const albumId = newUuid();
    sessionRepository.getById.mockResolvedValue(session);
    accessRepository.album.checkOwnerAccess.mockResolvedValue(new Set([albumId]));
    accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set());
    accessRepository.asset.checkSpaceAccess.mockResolvedValue(new Set());
    toolCallRepository.create.mockImplementation((dto) =>
      Promise.resolve({ id: newUuid(), startedAt: now, completedAt: now, ...dto } as never),
    );

    await expect(
      sut.proposeAlbumOperations(auth, session.id, {
        summary: 'Denied plan.',
        operations: [
          {
            type: AgentOperationType.AlbumAddAssets,
            summary: 'Add inaccessible asset.',
            targetKind: AgentOperationTargetKind.ExistingAlbum,
            targetId: albumId,
            assetIds: [newUuid()],
            payload: {},
            enabled: true,
            riskLevel: AgentOperationRiskLevel.Low,
          },
        ],
      }),
    ).rejects.toThrow('One or more assets are not accessible');

    expect(toolCallRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        status: AgentToolCallStatus.Denied,
        approvalDecision: AgentToolApprovalDecision.Denied,
        dataClass: AgentToolDataClass.Plan,
        error: 'One or more assets are not accessible',
      }),
    );
    expect(planRepository.createReplacementRevision).not.toHaveBeenCalled();
  });

  it('rejects duplicate create temporary target ids', async () => {
    const auth = AuthFactory.create();
    const session = makeSession({ userId: auth.user.id });
    sessionRepository.getById.mockResolvedValue(session);

    await expect(
      sut.proposeAlbumOperations(auth, session.id, {
        summary: 'Broken plan.',
        operations: [
          {
            type: AgentOperationType.AlbumCreate,
            summary: 'Create one.',
            targetKind: AgentOperationTargetKind.NewAlbum,
            temporaryTargetId: 'tmp-dup',
            payload: { albumName: 'One' },
            enabled: true,
            riskLevel: AgentOperationRiskLevel.Low,
          },
          {
            type: AgentOperationType.AlbumCreate,
            summary: 'Create two.',
            targetKind: AgentOperationTargetKind.NewAlbum,
            temporaryTargetId: 'tmp-dup',
            payload: { albumName: 'Two' },
            enabled: true,
            riskLevel: AgentOperationRiskLevel.Low,
          },
        ],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects proposals when the session write scope disables the operation type', async () => {
    const auth = AuthFactory.create();
    const albumId = newUuid();
    const assetId = newUuid();
    const session = makeSession({
      userId: auth.user.id,
      permissionPlanSnapshot: {
        ...permissionPlanSnapshot,
        writeScope: { ...permissionPlanSnapshot.writeScope, addAssets: false },
      },
    });
    sessionRepository.getById.mockResolvedValue(session);
    accessRepository.album.checkOwnerAccess.mockResolvedValue(new Set([albumId]));
    accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set([assetId]));

    await expect(
      sut.proposeAlbumOperations(auth, session.id, {
        summary: 'Denied plan.',
        operations: [
          {
            type: AgentOperationType.AlbumAddAssets,
            summary: 'Add to existing album.',
            targetKind: AgentOperationTargetKind.ExistingAlbum,
            targetId: albumId,
            assetIds: [assetId],
            payload: {},
            enabled: true,
            riskLevel: AgentOperationRiskLevel.Low,
          },
        ],
      }),
    ).rejects.toThrow('Agent permission policy does not allow adding assets to albums');
  });

  it('revises only a current plan owned by the session', async () => {
    const auth = AuthFactory.create();
    const session = makeSession({ userId: auth.user.id });
    const oldPlan = makePlan({ sessionId: session.id });
    const newPlan = makePlan({ sessionId: session.id, revision: 2 });
    sessionRepository.getById.mockResolvedValue(session);
    planRepository.getByIdForSession.mockResolvedValue(oldPlan);
    planRepository.createReplacementRevision.mockResolvedValue(newPlan);
    toolCallRepository.create.mockImplementation((dto) =>
      Promise.resolve({ id: newUuid(), startedAt: now, completedAt: now, ...dto } as never),
    );

    await expect(
      sut.reviseProposedOperations(auth, session.id, oldPlan.id, {
        feedback: 'Rename it.',
        summary: 'Revised plan.',
        operations: [
          {
            type: AgentOperationType.AlbumCreate,
            summary: 'Create Portugal renamed.',
            targetKind: AgentOperationTargetKind.NewAlbum,
            temporaryTargetId: 'tmp-portugal',
            payload: { albumName: 'Portugal highlights' },
            enabled: true,
            riskLevel: AgentOperationRiskLevel.Low,
          },
        ],
      }),
    ).resolves.toMatchObject({ status: 'success', plan: { id: newPlan.id, revision: 2 } });
  });

  it('returns null when no current plan exists', async () => {
    const auth = AuthFactory.create();
    const session = makeSession({ userId: auth.user.id });
    sessionRepository.getById.mockResolvedValue(session);
    planRepository.getCurrentBySessionId.mockResolvedValue(undefined);

    await expect(sut.getCurrentPlan(auth, session.id)).resolves.toBeNull();
  });

  it('throws not found for sessions not owned by the user', async () => {
    const auth = AuthFactory.create();
    sessionRepository.getById.mockResolvedValue(undefined);

    await expect(sut.getCurrentPlan(auth, newUuid())).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects proposal writes for terminal sessions', async () => {
    const auth = AuthFactory.create();
    const session = makeSession({ userId: auth.user.id, status: AgentSessionStatus.Completed });
    sessionRepository.getById.mockResolvedValue(session);

    await expect(
      sut.proposeAlbumOperations(auth, session.id, {
        summary: 'Late plan.',
        operations: [
          {
            type: AgentOperationType.AlbumCreate,
            summary: 'Create too late.',
            targetKind: AgentOperationTargetKind.NewAlbum,
            temporaryTargetId: 'tmp-late',
            payload: { albumName: 'Too late' },
            enabled: true,
            riskLevel: AgentOperationRiskLevel.Low,
          },
        ],
      }),
    ).rejects.toThrow('Agent session is not active');
    expect(planRepository.createReplacementRevision).not.toHaveBeenCalled();
  });

  it('rejects revisions for superseded plans', async () => {
    const auth = AuthFactory.create();
    const session = makeSession({ userId: auth.user.id });
    const supersededPlan = makePlan({ sessionId: session.id, status: AgentOperationPlanStatus.Superseded });
    sessionRepository.getById.mockResolvedValue(session);
    planRepository.getByIdForSession.mockResolvedValue(supersededPlan);

    await expect(
      sut.reviseProposedOperations(auth, session.id, supersededPlan.id, {
        summary: 'Invalid revision.',
        operations: [
          {
            type: AgentOperationType.AlbumCreate,
            summary: 'Create duplicate revision.',
            targetKind: AgentOperationTargetKind.NewAlbum,
            temporaryTargetId: 'tmp-invalid',
            payload: { albumName: 'Invalid' },
            enabled: true,
            riskLevel: AgentOperationRiskLevel.Low,
          },
        ],
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(planRepository.createReplacementRevision).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run service tests and verify they fail**

Run:

```bash
pnpm --dir server test src/services/agent-operation-plan.service.spec.ts
```

Expected: FAIL because the service does not exist.

- [ ] **Step 3: Extend websocket event type**

Modify `server/src/repositories/websocket.repository.ts` by adding this variant to `AgentSessionClientEvent`.

```ts
| {
    type: 'operation-plan-ready';
    sessionId: string;
    planId: string;
    revision: number;
  }
```

- [ ] **Step 4: Add service implementation**

Create `server/src/services/agent-operation-plan.service.ts`.

```ts
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AgentOperation, AgentOperationPlan, AgentSession, AgentToolCall } from 'src/database';
import {
  AgentToolApprovalDecision,
  AgentToolCallStatus,
  AgentToolDataClass,
  AgentToolName,
  AlbumUserRole,
  AgentOperationPlanStatus,
  AgentOperationStatus,
  AgentOperationTargetKind,
  AgentOperationType,
  AgentSessionStatus,
} from 'src/enum';
import {
  AgentOperationPlanResponseDto,
  AgentOperationPlanSummaryRequestDto,
  AgentOperationPlanToolResponseDto,
  AgentProposeAlbumOperationsDto,
  AgentReviseAlbumOperationsDto,
} from 'src/dtos/agent-operation.dto';
import { AuthDto } from 'src/dtos/auth.dto';
import { AccessRepository } from 'src/repositories/access.repository';
import { AgentOperationPlanRepository } from 'src/repositories/agent-operation-plan.repository';
import { AgentSessionRepository } from 'src/repositories/agent-session.repository';
import { AgentToolCallRepository } from 'src/repositories/agent-tool-call.repository';
import { AssetRepository } from 'src/repositories/asset.repository';
import { WebsocketRepository } from 'src/repositories/websocket.repository';
import { AgentAlbumOperationInput, AgentOperationCreate } from 'src/types/agent-operation.types';

type PlanWithOperations = AgentOperationPlan & { operations: AgentOperation[] };

@Injectable()
export class AgentOperationPlanService {
  private static readonly activeStatuses = [
    AgentSessionStatus.Created,
    AgentSessionStatus.Running,
    AgentSessionStatus.WaitingForToolApproval,
    AgentSessionStatus.WaitingForPlanReview,
    AgentSessionStatus.Interrupted,
  ];

  constructor(
    private readonly accessRepository: AccessRepository,
    private readonly assetRepository: AssetRepository,
    private readonly sessionRepository: AgentSessionRepository,
    private readonly planRepository: AgentOperationPlanRepository,
    private readonly toolCallRepository: AgentToolCallRepository,
    private readonly websocketRepository: WebsocketRepository,
  ) {}

  async getCurrentPlan(auth: AuthDto, sessionId: string): Promise<AgentOperationPlanResponseDto | null> {
    const session = await this.getOwnedSession(auth, sessionId, { requireActive: false });
    const plan = await this.planRepository.getCurrentBySessionId(session.id);
    return plan ? this.mapPlan(plan) : null;
  }

  async proposeAlbumOperations(
    auth: AuthDto,
    sessionId: string,
    dto: AgentProposeAlbumOperationsDto,
  ): Promise<AgentOperationPlanToolResponseDto> {
    const session = await this.getOwnedSession(auth, sessionId, { requireActive: true });
    return this.runPlanningTool(auth, session, AgentToolName.ProposeAlbumOperations, dto, async () => {
      await this.validateNormalAccess(auth, session, dto.operations);
      const operations = this.prepareOperations(session, dto.operations);
      const plan = await this.planRepository.createReplacementRevision(session.id, {
        plan: {
          sessionId: session.id,
          status: AgentOperationPlanStatus.Proposed,
          summary: dto.summary,
        },
        operations,
      });

      await this.markWaitingForPlanReview(auth, session, plan);
      return { plan, summary: this.summarize(plan) };
    });
  }

  async reviseProposedOperations(
    auth: AuthDto,
    sessionId: string,
    planId: string,
    dto: AgentReviseAlbumOperationsDto,
  ): Promise<AgentOperationPlanToolResponseDto> {
    const session = await this.getOwnedSession(auth, sessionId, { requireActive: true });
    const existingPlan = await this.planRepository.getByIdForSession(session.id, planId);
    if (!existingPlan || existingPlan.status !== AgentOperationPlanStatus.Proposed) {
      throw new NotFoundException('Agent operation plan not found');
    }

    return this.runPlanningTool(auth, session, AgentToolName.ReviseProposedOperations, dto, async () => {
      await this.validateNormalAccess(auth, session, dto.operations);
      const operations = this.prepareOperations(session, dto.operations);
      const plan = await this.planRepository.createReplacementRevision(session.id, {
        plan: {
          sessionId: session.id,
          status: AgentOperationPlanStatus.Proposed,
          summary: dto.summary,
        },
        operations,
      });

      await this.markWaitingForPlanReview(auth, session, plan);
      return { plan, summary: this.summarize(plan) };
    });
  }

  async summarizePlan(
    auth: AuthDto,
    sessionId: string,
    planId: string,
    _dto: AgentOperationPlanSummaryRequestDto,
  ): Promise<AgentOperationPlanToolResponseDto> {
    const session = await this.getOwnedSession(auth, sessionId, { requireActive: false });
    const plan = await this.planRepository.getByIdForSession(session.id, planId);
    if (!plan) {
      throw new NotFoundException('Agent operation plan not found');
    }

    return this.runPlanningTool(auth, session, AgentToolName.SummarizePlan, { planId, operations: [] }, async () => ({
      plan,
      summary: this.summarize(plan),
    }));
  }

  private async runPlanningTool(
    auth: AuthDto,
    session: AgentSession,
    toolName: AgentToolName,
    request: { operations?: AgentAlbumOperationInput[]; planId?: string },
    operation: () => Promise<{ plan: PlanWithOperations; summary: string }>,
  ): Promise<AgentOperationPlanToolResponseDto> {
    try {
      const result = await operation();
      const toolCall = await this.createPlanningAudit(session, toolName, request, {
        status: AgentToolCallStatus.Completed,
        approvalDecision: AgentToolApprovalDecision.Approved,
        responseSummary: result.summary,
        redactedResponseMetadata: {
          planId: result.plan.id,
          operationIds: result.plan.operations.map((planOperation) => planOperation.id),
        },
        error: null,
      });
      return {
        status: 'success',
        plan: this.mapPlan(result.plan),
        toolCall: this.mapToolCall(toolCall),
        summary: result.summary,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Agent operation planning failed';
      const status = error instanceof BadRequestException ? AgentToolCallStatus.Denied : AgentToolCallStatus.Failed;
      const approvalDecision =
        status === AgentToolCallStatus.Denied ? AgentToolApprovalDecision.Denied : AgentToolApprovalDecision.Approved;
      await this.createPlanningAudit(session, toolName, request, {
        status,
        approvalDecision,
        responseSummary: null,
        redactedResponseMetadata: null,
        error: message,
      });
      throw error;
    }
  }

  private async getOwnedSession(auth: AuthDto, sessionId: string, options: { requireActive: boolean }) {
    const session = await this.sessionRepository.getById(auth.user.id, sessionId);
    if (!session) {
      throw new NotFoundException('Agent session not found');
    }

    if (options.requireActive && !AgentOperationPlanService.activeStatuses.includes(session.status)) {
      throw new BadRequestException('Agent session is not active');
    }

    return session;
  }

  private async validateNormalAccess(auth: AuthDto, session: AgentSession, operations: AgentAlbumOperationInput[]) {
    const albumIds = new Set(
      operations
        .filter((operation) => operation.targetKind === AgentOperationTargetKind.ExistingAlbum && operation.targetId)
        .map((operation) => operation.targetId!),
    );
    if (albumIds.size > 0) {
      const writableAlbumIds = await this.getWritableAlbumIds(auth, session, albumIds);
      if (writableAlbumIds.size !== albumIds.size) {
        throw new BadRequestException('One or more target albums are not accessible');
      }
    }

    const assetIds = [...new Set(operations.flatMap((operation) => operation.assetIds ?? []))];
    if (assetIds.length > 0) {
      const readableAssetIds = await this.getReadableAssetIds(auth, session, assetIds);
      if (readableAssetIds.size !== assetIds.length) {
        throw new BadRequestException('One or more assets are not accessible');
      }
    }
  }

  private async getWritableAlbumIds(auth: AuthDto, session: AgentSession, albumIds: Set<string>) {
    const writableIds = new Set<string>();
    if (session.permissionPlanSnapshot.assetScope.owned) {
      const ownerIds = await this.accessRepository.album.checkOwnerAccess(auth.user.id, albumIds);
      for (const id of ownerIds) {
        writableIds.add(id);
      }
    }

    if (session.permissionPlanSnapshot.assetScope.sharedSpaces) {
      const sharedIds = await this.accessRepository.album.checkSharedAlbumAccess(
        auth.user.id,
        albumIds,
        AlbumUserRole.Editor,
      );
      for (const id of sharedIds) {
        writableIds.add(id);
      }
    }

    return writableIds;
  }

  private async getReadableAssetIds(auth: AuthDto, session: AgentSession, assetIds: string[]) {
    const requestedIds = new Set(assetIds);
    const readableIds = new Set<string>();
    const allowLockedAssets =
      session.permissionPlanSnapshot.assetScope.locked && auth.session?.hasElevatedPermission === true;

    if (session.permissionPlanSnapshot.assetScope.owned) {
      const ownerIds = await this.accessRepository.asset.checkOwnerAccess(
        auth.user.id,
        requestedIds,
        allowLockedAssets,
      );
      for (const id of ownerIds) {
        readableIds.add(id);
      }
    }

    if (session.permissionPlanSnapshot.assetScope.sharedSpaces) {
      const spaceIds = await this.accessRepository.asset.checkSpaceAccess(auth.user.id, requestedIds);
      for (const id of spaceIds) {
        readableIds.add(id);
      }

      if (!allowLockedAssets) {
        const lockedIds = await this.assetRepository.getAgentLockedIds(readableIds);
        for (const id of lockedIds) {
          readableIds.delete(id);
        }
      }
    }

    const agentReadableIds = await this.assetRepository.getAgentReadableIds(readableIds);
    for (const id of readableIds) {
      if (!agentReadableIds.has(id)) {
        readableIds.delete(id);
      }
    }

    return readableIds;
  }

  private prepareOperations(session: AgentSession, inputs: AgentAlbumOperationInput[]): AgentOperationCreate[] {
    const createByTemporaryTargetId = new Map<string, number>();
    const dependencyTokenByTemporaryTargetId = new Map<string, string>();

    inputs.forEach((operation, index) => {
      this.validateWriteScope(session, operation.type);
      if (operation.type === AgentOperationType.AlbumCreate) {
        const temporaryTargetId = operation.temporaryTargetId;
        if (!temporaryTargetId) {
          throw new BadRequestException('album.create requires temporaryTargetId');
        }
        if (createByTemporaryTargetId.has(temporaryTargetId)) {
          throw new BadRequestException(`Duplicate album.create temporaryTargetId: ${temporaryTargetId}`);
        }
        createByTemporaryTargetId.set(temporaryTargetId, index);
        dependencyTokenByTemporaryTargetId.set(temporaryTargetId, `new-album:${temporaryTargetId}`);
      }
    });

    return inputs.map((operation) => {
      const dependencyIds: string[] = [];
      if (
        (operation.type === AgentOperationType.AlbumAddAssets || operation.type === AgentOperationType.AlbumSetCover) &&
        operation.targetKind === AgentOperationTargetKind.NewAlbum
      ) {
        const temporaryTargetId = operation.temporaryTargetId;
        if (!temporaryTargetId || !createByTemporaryTargetId.has(temporaryTargetId)) {
          throw new BadRequestException(`No album.create operation found for temporaryTargetId: ${temporaryTargetId}`);
        }
        dependencyIds.push(dependencyTokenByTemporaryTargetId.get(temporaryTargetId)!);
      }

      return {
        planId: '',
        type: operation.type,
        summary: operation.summary,
        targetKind: operation.targetKind,
        targetId: operation.targetId ?? null,
        temporaryTargetId: operation.temporaryTargetId ?? null,
        assetIds: operation.assetIds ?? [],
        payload: operation.payload ?? {},
        dependencyIds,
        riskLevel: operation.riskLevel,
        enabled: operation.enabled,
        status: AgentOperationStatus.Proposed,
        result: null,
        error: null,
      };
    });
  }

  private validateWriteScope(session: AgentSession, type: AgentOperationType) {
    const writeScope = session.permissionPlanSnapshot.writeScope;
    if (type === AgentOperationType.AlbumCreate && !writeScope.createAlbum) {
      throw new BadRequestException('Agent permission policy does not allow creating albums');
    }
    if (type === AgentOperationType.AlbumAddAssets && !writeScope.addAssets) {
      throw new BadRequestException('Agent permission policy does not allow adding assets to albums');
    }
    if (type === AgentOperationType.AlbumUpdateDetails && !writeScope.updateDetails) {
      throw new BadRequestException('Agent permission policy does not allow updating album details');
    }
    if (type === AgentOperationType.AlbumSetCover && !writeScope.setCover) {
      throw new BadRequestException('Agent permission policy does not allow setting album covers');
    }
  }

  private async markWaitingForPlanReview(auth: AuthDto, session: AgentSession, plan: PlanWithOperations) {
    await this.sessionRepository.update(auth.user.id, session.id, { status: AgentSessionStatus.WaitingForPlanReview });
    this.websocketRepository.clientSend('on_agent_session_event', auth.user.id, {
      type: 'operation-plan-ready',
      sessionId: session.id,
      planId: plan.id,
      revision: plan.revision,
    });
  }

  private createPlanningAudit(
    session: AgentSession,
    toolName: AgentToolName,
    request: { operations?: AgentAlbumOperationInput[]; planId?: string },
    result: {
      status: AgentToolCallStatus.Completed | AgentToolCallStatus.Denied | AgentToolCallStatus.Failed;
      approvalDecision: AgentToolApprovalDecision;
      responseSummary: string | null;
      redactedResponseMetadata: { planId: string | null; operationIds: string[] } | null;
      error: string | null;
    },
  ) {
    const operations = request.operations ?? [];
    const assetIds = [...new Set(operations.flatMap((operation) => operation.assetIds ?? []))];
    const albumIds = [
      ...new Set(
        operations
          .filter((operation) => operation.targetKind === AgentOperationTargetKind.ExistingAlbum && operation.targetId)
          .map((operation) => operation.targetId!),
      ),
    ];

    return this.toolCallRepository.create({
      sessionId: session.id,
      toolName,
      status: result.status,
      approvalDecision: result.approvalDecision,
      requestSummary:
        toolName === AgentToolName.SummarizePlan
          ? `Summarize operation plan ${request.planId}`
          : `Store ${operations.length} proposed album operation(s)`,
      responseSummary: result.responseSummary,
      redactedRequestMetadata: {
        planId: request.planId,
        operationCount: operations.length,
        operationTypes: operations.map((operation) => operation.type),
        albumIds,
        assetIds,
      },
      redactedResponseMetadata: result.redactedResponseMetadata,
      dataClass: AgentToolDataClass.Plan,
      assetCount: assetIds.length,
      albumCount: albumIds.length,
      providerSnapshot: {
        providerCredentialId: session.providerCredentialId,
        providerType: session.credentialSnapshot.providerType,
        label: session.credentialSnapshot.label,
        baseUrl: session.credentialSnapshot.baseUrl,
        model: session.modelSnapshot.model,
      },
      completedAt: new Date(),
      error: result.error,
    });
  }

  private mapPlan(plan: PlanWithOperations): AgentOperationPlanResponseDto {
    return {
      id: plan.id,
      sessionId: plan.sessionId,
      revision: plan.revision,
      status: plan.status,
      summary: plan.summary,
      operations: plan.operations.map((operation) => ({
        id: operation.id,
        planId: operation.planId,
        type: operation.type,
        summary: operation.summary,
        targetKind: operation.targetKind,
        targetId: operation.targetId,
        temporaryTargetId: operation.temporaryTargetId,
        assetIds: operation.assetIds,
        payload: operation.payload,
        dependencyIds: this.resolveDependencyIds(plan.operations, operation),
        riskLevel: operation.riskLevel,
        enabled: operation.enabled,
        status: operation.status,
        result: operation.result,
        error: operation.error,
        createdAt: operation.createdAt,
        updatedAt: operation.updatedAt,
      })),
      createdAt: plan.createdAt,
      updatedAt: plan.updatedAt,
    };
  }

  private mapToolCall(toolCall: AgentToolCall) {
    return {
      id: toolCall.id,
      sessionId: toolCall.sessionId,
      toolName: toolCall.toolName,
      status: toolCall.status,
      approvalDecision: toolCall.approvalDecision,
      requestSummary: toolCall.requestSummary,
      responseSummary: toolCall.responseSummary,
      dataClass: toolCall.dataClass,
      assetCount: toolCall.assetCount,
      albumCount: toolCall.albumCount,
      startedAt: toolCall.startedAt,
      completedAt: toolCall.completedAt,
      error: toolCall.error,
    };
  }

  private resolveDependencyIds(operations: AgentOperation[], operation: AgentOperation) {
    return operation.dependencyIds.map((dependencyId) => {
      if (!dependencyId.startsWith('new-album:')) {
        return dependencyId;
      }

      const temporaryTargetId = dependencyId.slice('new-album:'.length);
      const createOperation = operations.find(
        (candidate) =>
          candidate.type === AgentOperationType.AlbumCreate && candidate.temporaryTargetId === temporaryTargetId,
      );
      return createOperation?.id ?? dependencyId;
    });
  }

  private summarize(plan: PlanWithOperations) {
    const createCount = plan.operations.filter((operation) => operation.type === AgentOperationType.AlbumCreate).length;
    const addCount = plan.operations.filter((operation) => operation.type === AgentOperationType.AlbumAddAssets).length;
    const updateCount = plan.operations.filter(
      (operation) => operation.type === AgentOperationType.AlbumUpdateDetails,
    ).length;
    const coverCount = plan.operations.filter(
      (operation) => operation.type === AgentOperationType.AlbumSetCover,
    ).length;
    return `Plan revision ${plan.revision}: ${createCount} album create, ${addCount} asset add, ${updateCount} detail update, ${coverCount} cover change operation(s).`;
  }
}
```

- [ ] **Step 5: Register the service**

Modify `server/src/services/index.ts`:

```ts
import { AgentOperationPlanService } from 'src/services/agent-operation-plan.service';
```

Add it to `services` near the other agent services:

```ts
AgentOperationPlanService,
```

- [ ] **Step 6: Run service tests and fix dependency-id persistence if needed**

Run:

```bash
pnpm --dir server test src/services/agent-operation-plan.service.spec.ts
```

Expected: PASS.

If reviewers prefer storing database dependency IDs instead of `new-album:<temporaryTargetId>` tokens, move dependency resolution into `AgentOperationPlanRepository.createRevision()` after operation insert and update dependent rows in the same transaction. Keep the public response behavior unchanged.

- [ ] **Step 7: Commit**

```bash
git add server/src/services/agent-operation-plan.service.ts server/src/services/agent-operation-plan.service.spec.ts server/src/services/index.ts server/src/repositories/websocket.repository.ts
git commit -m "feat(server): validate and store agent album operation plans"
```

## Task 4: Browser And Runner Controllers

**Files:**

- Create: `server/src/controllers/agent-operation-plan.controller.ts`
- Create: `server/src/controllers/agent-operation-plan.controller.spec.ts`
- Modify: `server/src/controllers/index.ts`
- Modify: `server/src/controllers/agent-runner-tool.controller.ts`
- Modify: `server/src/controllers/agent-runner-tool.controller.spec.ts`

- [ ] **Step 1: Write failing browser controller tests**

Create `server/src/controllers/agent-operation-plan.controller.spec.ts`.

```ts
import { DECORATORS } from '@nestjs/swagger/dist/constants';
import { AgentOperationPlanController } from 'src/controllers/agent-operation-plan.controller';
import {
  AgentOperationPlanResponseDto,
  AgentOperationPlanToolResponseDto,
  AgentProposeAlbumOperationsDto,
} from 'src/dtos/agent-operation.dto';
import {
  AgentOperationPlanStatus,
  AgentOperationRiskLevel,
  AgentOperationStatus,
  AgentOperationTargetKind,
  AgentOperationType,
  Permission,
} from 'src/enum';
import { AgentOperationPlanService } from 'src/services/agent-operation-plan.service';
import request from 'supertest';
import { AuthFactory } from 'test/factories/auth.factory';
import { factory } from 'test/small.factory';
import { automock, ControllerContext, controllerSetup } from 'test/utils';

describe(AgentOperationPlanController.name, () => {
  let ctx: ControllerContext;
  const service = automock(AgentOperationPlanService, {
    args: [{} as never, {} as never, {} as never],
    strict: false,
  });
  const auth = AuthFactory.create();
  const sessionId = factory.uuid();
  const planId = factory.uuid();
  const operationId = factory.uuid();
  const createdAt = new Date('2026-05-15T12:00:00.000Z');
  const updatedAt = new Date('2026-05-15T12:00:01.000Z');
  const plan: AgentOperationPlanResponseDto = {
    id: planId,
    sessionId,
    revision: 1,
    status: AgentOperationPlanStatus.Proposed,
    summary: 'Portugal plan.',
    operations: [
      {
        id: operationId,
        planId,
        type: AgentOperationType.AlbumCreate,
        summary: 'Create Portugal.',
        targetKind: AgentOperationTargetKind.NewAlbum,
        targetId: null,
        temporaryTargetId: 'tmp-portugal',
        assetIds: [],
        payload: { albumName: 'Portugal' },
        dependencyIds: [],
        riskLevel: AgentOperationRiskLevel.Low,
        enabled: true,
        status: AgentOperationStatus.Proposed,
        result: null,
        error: null,
        createdAt,
        updatedAt,
      },
    ],
    createdAt,
    updatedAt,
  };

  beforeAll(async () => {
    ctx = await controllerSetup(AgentOperationPlanController, [
      { provide: AgentOperationPlanService, useValue: service },
    ]);
    return () => ctx.close();
  });

  beforeEach(() => {
    service.resetAllMocks();
    ctx.reset();
    ctx.authenticate.mockResolvedValue(auth);
  });

  it.each([
    ['getCurrentOperationPlan', AgentOperationPlanResponseDto, 'AgentOperationPlanResponseDto'],
    ['proposeAlbumOperations', AgentOperationPlanToolResponseDto, 'AgentOperationPlanToolResponseDto'],
    ['reviseProposedOperations', AgentOperationPlanToolResponseDto, 'AgentOperationPlanToolResponseDto'],
    ['summarizePlan', AgentOperationPlanToolResponseDto, 'AgentOperationPlanToolResponseDto'],
  ] as const)('documents %s with a typed response DTO', (methodName, responseDto, schemaName) => {
    const responses = Reflect.getMetadata(
      DECORATORS.API_RESPONSE,
      AgentOperationPlanController.prototype[methodName],
    ) as Record<number, { type?: unknown }> | undefined;

    expect(responses?.[methodName === 'getCurrentOperationPlan' ? 200 : 201]?.type).toBe(responseDto);
    expect(responseDto.name).toBe(schemaName);
  });

  it('gets the current operation plan with read permission and serializes dates', async () => {
    service.getCurrentPlan.mockResolvedValue(plan);

    const { status, body } = await request(ctx.getHttpServer()).get(`/agent/sessions/${sessionId}/operation-plan`);

    expect(status).toBe(200);
    expect(ctx.authenticate).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: expect.objectContaining({ permission: Permission.AgentSessionRead }) }),
    );
    expect(service.getCurrentPlan).toHaveBeenCalledWith(auth, sessionId);
    expect(body.createdAt).toBe(createdAt.toISOString());
    expect(body.operations[0].updatedAt).toBe(updatedAt.toISOString());
  });

  it('returns null when no current operation plan exists', async () => {
    service.getCurrentPlan.mockResolvedValue(null);

    const { status, body } = await request(ctx.getHttpServer()).get(`/agent/sessions/${sessionId}/operation-plan`);

    expect(status).toBe(200);
    expect(body).toBeNull();
  });

  it('proposes album operations with update permission', async () => {
    const dto: AgentProposeAlbumOperationsDto = {
      summary: 'Portugal plan.',
      operations: [
        {
          type: AgentOperationType.AlbumCreate,
          summary: 'Create Portugal.',
          targetKind: AgentOperationTargetKind.NewAlbum,
          temporaryTargetId: 'tmp-portugal',
          payload: { albumName: 'Portugal', description: '' },
          riskLevel: AgentOperationRiskLevel.Low,
          enabled: true,
        },
      ],
    };
    service.proposeAlbumOperations.mockResolvedValue({
      status: 'success',
      plan,
      toolCall: null,
      summary: 'Plan revision 1.',
    });

    const { status } = await request(ctx.getHttpServer())
      .post(`/agent/sessions/${sessionId}/operation-plan/proposals`)
      .send(dto);

    expect(status).toBe(201);
    expect(ctx.authenticate).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: expect.objectContaining({ permission: Permission.AgentSessionUpdate }) }),
    );
    expect(service.proposeAlbumOperations).toHaveBeenCalledWith(auth, sessionId, dto);
  });

  it('validates proposal bodies before calling the service', async () => {
    const { status } = await request(ctx.getHttpServer())
      .post(`/agent/sessions/${sessionId}/operation-plan/proposals`)
      .send({ summary: 'Broken', operations: [] });

    expect(status).toBe(400);
    expect(service.proposeAlbumOperations).not.toHaveBeenCalled();
  });

  it('revises a plan with update permission', async () => {
    service.reviseProposedOperations.mockResolvedValue({
      status: 'success',
      plan,
      toolCall: null,
      summary: 'Plan revision 2.',
    });

    const { status } = await request(ctx.getHttpServer())
      .post(`/agent/sessions/${sessionId}/operation-plan/${planId}/revisions`)
      .send({
        feedback: 'Use a shorter name.',
        summary: 'Revised Portugal plan.',
        operations: [
          {
            type: AgentOperationType.AlbumCreate,
            summary: 'Create Portugal.',
            targetKind: AgentOperationTargetKind.NewAlbum,
            temporaryTargetId: 'tmp-portugal',
            payload: { albumName: 'Portugal' },
          },
        ],
      });

    expect(status).toBe(201);
    expect(ctx.authenticate).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: expect.objectContaining({ permission: Permission.AgentSessionUpdate }) }),
    );
    expect(service.reviseProposedOperations).toHaveBeenCalledWith(auth, sessionId, planId, expect.any(Object));
  });

  it('summarizes a plan with read permission', async () => {
    service.summarizePlan.mockResolvedValue({
      status: 'success',
      plan,
      toolCall: null,
      summary: 'Plan revision 1.',
    });

    const { status } = await request(ctx.getHttpServer())
      .post(`/agent/sessions/${sessionId}/operation-plan/${planId}/summary`)
      .send({ focus: 'risk' });

    expect(status).toBe(201);
    expect(ctx.authenticate).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: expect.objectContaining({ permission: Permission.AgentSessionRead }) }),
    );
    expect(service.summarizePlan).toHaveBeenCalledWith(auth, sessionId, planId, { focus: 'risk' });
  });
});
```

- [ ] **Step 2: Run controller tests and verify they fail**

Run:

```bash
pnpm --dir server test src/controllers/agent-operation-plan.controller.spec.ts
```

Expected: FAIL because the controller does not exist.

- [ ] **Step 3: Add browser controller**

Create `server/src/controllers/agent-operation-plan.controller.ts`.

```ts
import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Endpoint, HistoryBuilder } from 'src/decorators';
import {
  AgentOperationPlanParamsDto,
  AgentOperationPlanResponseDto,
  AgentOperationPlanSummaryRequestDto,
  AgentOperationPlanToolResponseDto,
  AgentProposeAlbumOperationsDto,
  AgentReviseAlbumOperationsDto,
} from 'src/dtos/agent-operation.dto';
import { AuthDto } from 'src/dtos/auth.dto';
import { ApiTag, Permission } from 'src/enum';
import { Auth, Authenticated } from 'src/middleware/auth.guard';
import { AgentOperationPlanService } from 'src/services/agent-operation-plan.service';
import { UUIDParamDto } from 'src/validation';

@ApiTags(ApiTag.AgentSessions)
@Controller('agent/sessions/:id/operation-plan')
export class AgentOperationPlanController {
  constructor(private readonly service: AgentOperationPlanService) {}

  @Get()
  @Authenticated({ permission: Permission.AgentSessionRead })
  @ApiOkResponse({ type: AgentOperationPlanResponseDto })
  @Endpoint({
    summary: 'Get the current agent operation plan',
    description: 'Get the current proposed album operation plan for an AI agent session owned by the current user.',
    history: new HistoryBuilder().added('v2.7.5').alpha('v2.7.5'),
  })
  getCurrentOperationPlan(
    @Auth() auth: AuthDto,
    @Param() { id }: UUIDParamDto,
  ): Promise<AgentOperationPlanResponseDto | null> {
    return this.service.getCurrentPlan(auth, id);
  }

  @Post('proposals')
  @Authenticated({ permission: Permission.AgentSessionUpdate })
  @ApiCreatedResponse({ type: AgentOperationPlanToolResponseDto })
  @Endpoint({
    summary: 'Propose agent album operations',
    description: 'Internal route for storing a structured album operation proposal for an AI agent session.',
    history: new HistoryBuilder().added('v2.7.5').internal('v2.7.5'),
  })
  proposeAlbumOperations(
    @Auth() auth: AuthDto,
    @Param() { id }: UUIDParamDto,
    @Body() dto: AgentProposeAlbumOperationsDto,
  ): Promise<AgentOperationPlanToolResponseDto> {
    return this.service.proposeAlbumOperations(auth, id, dto);
  }

  @Post(':planId/revisions')
  @Authenticated({ permission: Permission.AgentSessionUpdate })
  @ApiCreatedResponse({ type: AgentOperationPlanToolResponseDto })
  @Endpoint({
    summary: 'Revise agent album operations',
    description: 'Internal route for replacing a proposed operation plan with a new revision.',
    history: new HistoryBuilder().added('v2.7.5').internal('v2.7.5'),
  })
  reviseProposedOperations(
    @Auth() auth: AuthDto,
    @Param() { id, planId }: AgentOperationPlanParamsDto,
    @Body() dto: AgentReviseAlbumOperationsDto,
  ): Promise<AgentOperationPlanToolResponseDto> {
    return this.service.reviseProposedOperations(auth, id, planId, dto);
  }

  @Post(':planId/summary')
  @Authenticated({ permission: Permission.AgentSessionRead })
  @ApiCreatedResponse({ type: AgentOperationPlanToolResponseDto })
  @Endpoint({
    summary: 'Summarize an agent operation plan',
    description: 'Internal route for returning a compact summary of a stored operation plan.',
    history: new HistoryBuilder().added('v2.7.5').internal('v2.7.5'),
  })
  summarizePlan(
    @Auth() auth: AuthDto,
    @Param() { id, planId }: AgentOperationPlanParamsDto,
    @Body() dto: AgentOperationPlanSummaryRequestDto,
  ): Promise<AgentOperationPlanToolResponseDto> {
    return this.service.summarizePlan(auth, id, planId, dto);
  }
}
```

- [ ] **Step 4: Register browser controller**

Modify `server/src/controllers/index.ts`:

```ts
import { AgentOperationPlanController } from 'src/controllers/agent-operation-plan.controller';
```

Add it to `controllers` near the other agent controllers:

```ts
AgentOperationPlanController,
```

- [ ] **Step 5: Add runner gateway routes**

Modify `server/src/controllers/agent-runner-tool.controller.ts` imports:

```ts
import {
  AgentOperationPlanParamsDto,
  AgentOperationPlanSummaryRequestDto,
  AgentOperationPlanToolResponseDto,
  AgentProposeAlbumOperationsDto,
  AgentReviseAlbumOperationsDto,
} from 'src/dtos/agent-operation.dto';
import { AgentOperationPlanService } from 'src/services/agent-operation-plan.service';
```

Change the constructor:

```ts
constructor(
  private readonly service: AgentToolService,
  private readonly operationPlanService: AgentOperationPlanService,
) {}
```

Append these methods:

```ts
@Post('propose-album-operations')
@ApiCreatedResponse({ type: AgentOperationPlanToolResponseDto })
@Endpoint({
  summary: 'Execute the runner proposeAlbumOperations agent tool',
  description: 'Internal runner gateway for storing proposed album operations for an AI agent session.',
  history: history(),
})
runnerProposeAlbumOperations(
  @Auth() auth: AuthDto,
  @Param() { id }: UUIDParamDto,
  @Body() dto: AgentProposeAlbumOperationsDto,
): Promise<AgentOperationPlanToolResponseDto> {
  return this.operationPlanService.proposeAlbumOperations(auth, id, dto);
}

@Post('revise-proposed-operations/:planId')
@ApiCreatedResponse({ type: AgentOperationPlanToolResponseDto })
@Endpoint({
  summary: 'Execute the runner reviseProposedOperations agent tool',
  description: 'Internal runner gateway for replacing a proposed album operation plan revision.',
  history: history(),
})
runnerReviseProposedOperations(
  @Auth() auth: AuthDto,
  @Param() { id, planId }: AgentOperationPlanParamsDto,
  @Body() dto: AgentReviseAlbumOperationsDto,
): Promise<AgentOperationPlanToolResponseDto> {
  return this.operationPlanService.reviseProposedOperations(auth, id, planId, dto);
}

@Post('summarize-plan/:planId')
@ApiCreatedResponse({ type: AgentOperationPlanToolResponseDto })
@Endpoint({
  summary: 'Execute the runner summarizePlan agent tool',
  description: 'Internal runner gateway for summarizing a proposed album operation plan.',
  history: history(),
})
runnerSummarizePlan(
  @Auth() auth: AuthDto,
  @Param() { id, planId }: AgentOperationPlanParamsDto,
  @Body() dto: AgentOperationPlanSummaryRequestDto,
): Promise<AgentOperationPlanToolResponseDto> {
  return this.operationPlanService.summarizePlan(auth, id, planId, dto);
}
```

- [ ] **Step 6: Extend runner controller tests**

Modify `server/src/controllers/agent-runner-tool.controller.spec.ts` to provide `AgentOperationPlanService` in `controllerSetup` and add one representative route test.

```ts
it('routes runner propose-album-operations through bearer auth', async () => {
  operationPlanService.proposeAlbumOperations.mockResolvedValue({
    status: 'success',
    plan: null,
    toolCall: null,
    summary: 'Plan revision 1.',
  });

  const { status } = await request(ctx.getHttpServer())
    .post(`/agent/internal/tools/sessions/${sessionId}/propose-album-operations`)
    .set('Authorization', `Bearer ${token}`)
    .send({
      summary: 'Portugal plan.',
      operations: [
        {
          type: AgentOperationType.AlbumCreate,
          summary: 'Create Portugal.',
          targetKind: AgentOperationTargetKind.NewAlbum,
          temporaryTargetId: 'tmp-portugal',
          payload: { albumName: 'Portugal' },
        },
      ],
    });

  expect(status).toBe(201);
  expect(operationPlanService.proposeAlbumOperations).toHaveBeenCalledWith(
    { user: { id: auth.user.id } },
    sessionId,
    expect.objectContaining({ summary: 'Portugal plan.' }),
  );
});
```

- [ ] **Step 7: Run controller tests**

Run:

```bash
pnpm --dir server test src/controllers/agent-operation-plan.controller.spec.ts src/controllers/agent-runner-tool.controller.spec.ts
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add server/src/controllers/agent-operation-plan.controller.ts server/src/controllers/agent-operation-plan.controller.spec.ts server/src/controllers/index.ts server/src/controllers/agent-runner-tool.controller.ts server/src/controllers/agent-runner-tool.controller.spec.ts
git commit -m "feat(server): expose agent operation planning tools"
```

## Task 5: Runner Planning Tools

**Files:**

- Modify: `agent-runner/src/gallery-tools.mjs`
- Modify: `agent-runner/src/gallery-tools.test.mjs`
- Modify: `agent-runner/src/pi-runtime.mjs`
- Modify: `agent-runner/src/pi-runtime.test.mjs`

- [ ] **Step 1: Write failing runner tool tests**

Modify `agent-runner/src/gallery-tools.test.mjs`:

```js
const expectedToolNames = [
  'searchAssets',
  'readAssetMetadata',
  'readAssetPreviews',
  'readAssetOriginals',
  'listAlbums',
  'readAlbum',
  'proposeAlbumOperations',
  'reviseProposedOperations',
  'summarizePlan',
];

const routeByToolName = {
  searchAssets: 'search-assets',
  readAssetMetadata: 'read-asset-metadata',
  readAssetPreviews: 'read-asset-previews',
  readAssetOriginals: 'read-asset-originals',
  listAlbums: 'list-albums',
  readAlbum: 'read-album',
  proposeAlbumOperations: 'propose-album-operations',
  reviseProposedOperations: 'revise-proposed-operations/plan-1',
  summarizePlan: 'summarize-plan/plan-1',
};
```

Add a test for plan ID route mapping:

```js
it('maps plan tools to plan-aware gateway routes', async () => {
  const client = createRecordingClient();
  const tools = createGalleryTools({ client });
  const revise = tools.find((tool) => tool.name === 'reviseProposedOperations');
  const summarize = tools.find((tool) => tool.name === 'summarizePlan');

  await revise.execute('call-revise', { planId: 'plan-1', operations: [], summary: 'Revision' });
  await summarize.execute('call-summary', { planId: 'plan-1', focus: 'risk' });

  assert.deepEqual(client.calls.at(-2), {
    path: 'revise-proposed-operations/plan-1',
    body: { operations: [], summary: 'Revision' },
  });
  assert.deepEqual(client.calls.at(-1), {
    path: 'summarize-plan/plan-1',
    body: { focus: 'risk' },
  });
});
```

Keep the forbidden write tool assertion and expand it:

```js
const forbiddenNames = [
  'createAlbum',
  'addAssetsToAlbum',
  'removeAssetsFromAlbum',
  'updateAlbum',
  'setAlbumCover',
  'applyAlbumOperations',
];
```

- [ ] **Step 2: Run runner tests and verify they fail**

Run:

```bash
pnpm --dir agent-runner test
```

Expected: FAIL because only read tools exist.

- [ ] **Step 3: Replace read-only export with read plus planning tools**

Modify `agent-runner/src/gallery-tools.mjs`.

```js
export const galleryToolNames = [
  'searchAssets',
  'readAssetMetadata',
  'readAssetPreviews',
  'readAssetOriginals',
  'listAlbums',
  'readAlbum',
  'proposeAlbumOperations',
  'reviseProposedOperations',
  'summarizePlan',
];

export const galleryReadToolNames = galleryToolNames.slice(0, 6);
export const galleryPlanningToolNames = galleryToolNames.slice(6);
```

Add planning definitions:

```js
const toolDefinitions = [
  {
    name: 'searchAssets',
    route: 'search-assets',
    label: 'Search assets',
    description: 'Search Gallery assets visible to this session.',
  },
  {
    name: 'readAssetMetadata',
    route: 'read-asset-metadata',
    label: 'Read asset metadata',
    description: 'Read metadata for Gallery assets visible to this session.',
  },
  {
    name: 'readAssetPreviews',
    route: 'read-asset-previews',
    label: 'Read asset previews',
    description: 'Read preview references for Gallery assets visible to this session.',
  },
  {
    name: 'readAssetOriginals',
    route: 'read-asset-originals',
    label: 'Read asset originals',
    description: 'Read original asset references without downloading media bytes.',
  },
  {
    name: 'listAlbums',
    route: 'list-albums',
    label: 'List albums',
    description: 'List Gallery albums visible to this session.',
  },
  {
    name: 'readAlbum',
    route: 'read-album',
    label: 'Read album',
    description: 'Read a Gallery album visible to this session.',
  },
  {
    name: 'proposeAlbumOperations',
    route: 'propose-album-operations',
    label: 'Propose album operations',
    description: 'Store a structured album organization plan for user review without applying it.',
  },
  {
    name: 'reviseProposedOperations',
    route: ({ planId }) => `revise-proposed-operations/${encodeURIComponent(planId)}`,
    label: 'Revise proposed album operations',
    description: 'Replace an existing proposed album operation plan with a new revision.',
  },
  {
    name: 'summarizePlan',
    route: ({ planId }) => `summarize-plan/${encodeURIComponent(planId)}`,
    label: 'Summarize plan',
    description: 'Summarize a stored proposed album operation plan.',
  },
];
```

Replace `createGalleryReadTools` with `createGalleryTools`, keeping a compatibility alias:

```js
const getRouteAndBody = (tool, params) => {
  if (typeof tool.route === 'string') {
    return { route: tool.route, body: params };
  }

  if (!params || typeof params.planId !== 'string' || params.planId.length === 0) {
    throw new Error(`${tool.name} requires planId`);
  }

  const { planId: _planId, ...body } = params;
  return { route: tool.route(params), body };
};

export const createGalleryTools = ({ client }) =>
  toolDefinitions.map((tool) =>
    defineTool({
      name: tool.name,
      label: tool.label,
      description: tool.description,
      parameters,
      async execute(_toolCallId, params, signal) {
        const { route, body } = getRouteAndBody(tool, params);
        const result = await client.post(route, body, { signal });
        return {
          content: [{ type: 'text', text: JSON.stringify(result) }],
          details: result,
        };
      },
    }),
  );

export const createGalleryReadTools = createGalleryTools;
```

- [ ] **Step 4: Update Pi runtime capabilities**

Modify `agent-runner/src/pi-runtime.mjs` imports:

```js
import { createGalleryTools, galleryToolNames } from './gallery-tools.mjs';
```

Use all Gallery tools:

```js
const customTools = body.toolGateway
  ? createGalleryTools({
      client: createGalleryToolClient({
        gateway: body.toolGateway,
        gallerySessionId: body.gallerySessionId,
      }),
    })
  : [];
```

Return capabilities:

```js
tools: body.toolGateway ? galleryToolNames : [],
```

- [ ] **Step 5: Update runner tests**

Modify `agent-runner/src/pi-runtime.test.mjs` expected tools from read-only names to `galleryToolNames`, and keep assertions that built-in tools stay disabled.

```js
assert.deepEqual(result.capabilities.tools, galleryToolNames);
```

- [ ] **Step 6: Run runner tests**

Run:

```bash
pnpm --dir agent-runner test
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add agent-runner/src/gallery-tools.mjs agent-runner/src/gallery-tools.test.mjs agent-runner/src/pi-runtime.mjs agent-runner/src/pi-runtime.test.mjs
git commit -m "feat(agent-runner): expose album operation planning tools"
```

## Task 6: Generated Artifacts And Focused Verification

**Files:**

- Modify: `server/src/queries/*.sql` if `sync:sql` updates generated query snapshots.
- Modify: `open-api/immich-openapi-specs.json`
- Modify: `open-api/typescript-sdk/**`
- Modify: `mobile/openapi/**`

- [ ] **Step 1: Run generated SQL sync**

Run:

```bash
pnpm --dir server build
pnpm --dir server sync:sql
```

Expected: PASS. Review generated query files and ensure only agent operation plan SQL changed.

- [ ] **Step 2: Run OpenAPI generation**

Run:

```bash
./open-api/bin/generate-open-api.sh
```

Expected: PASS. The generated spec and clients include the new browser routes and operation DTOs. Runner-only internal routes may also appear because existing runner tool routes are decorated; confirm no raw provider secret DTOs are introduced.

- [ ] **Step 3: Run focused server and runner checks**

Run:

```bash
pnpm --dir server test src/dtos/agent-operation.dto.spec.ts src/services/agent-operation-plan.service.spec.ts src/controllers/agent-operation-plan.controller.spec.ts src/controllers/agent-runner-tool.controller.spec.ts
pnpm --dir server test:medium test/medium/specs/repositories/agent-operation-plan.repository.spec.ts
pnpm --dir agent-runner test
```

Expected: PASS.

- [ ] **Step 4: Run broader static checks**

Run:

```bash
pnpm --dir server check
pnpm --dir server lint
pnpm --dir server format
```

Expected: PASS.

- [ ] **Step 5: Inspect diff for scope**

Run:

```bash
git diff --stat
git diff -- server/src/types/agent-operation.types.ts server/src/dtos/agent-operation.dto.ts server/src/services/agent-operation-plan.service.ts agent-runner/src/gallery-tools.mjs
```

Expected: Diff only contains slice 11 operation-plan storage and planning-tool work. No album mutation/apply behavior should be present.

- [ ] **Step 6: Commit generated artifacts and final fixes**

```bash
git add server/src/queries open-api/immich-openapi-specs.json open-api/typescript-sdk mobile/openapi
git commit -m "chore: regenerate agent operation plan api artifacts"
```

If no generated artifacts changed, skip the commit and record that result in the PR summary.

## Edge Case Coverage Matrix

| Edge Case                                 | Covered By                                                                                                            |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Empty proposal operation list             | `AgentProposeAlbumOperationsDto` rejects `operations: []`; browser controller invalid-body test                       |
| Invalid operation target shape            | DTO tests for missing existing `targetId`, missing create `temporaryTargetId`, and duplicate asset IDs                |
| Duplicate new-album temporary IDs         | Service test `rejects duplicate create temporary target ids`                                                          |
| New-album dependent op without create     | Service test `rejects operations targeting a new album without a matching create operation`                           |
| `album.setCover` dependency resolution    | Repository medium test `stores database operation ids as dependencies for operations targeting newly proposed albums` |
| Disabled write-scope policy               | Service test `rejects proposals when the session write scope disables the operation type`                             |
| Existing album access denied              | Service test `audits and rejects inaccessible existing album targets`                                                 |
| Asset access denied                       | Service test `audits and rejects inaccessible asset ids`                                                              |
| Terminal session write attempt            | Service test `rejects proposal writes for terminal sessions`                                                          |
| Superseded plan revision attempt          | Service test `rejects revisions for superseded plans`                                                                 |
| No current plan                           | Service and browser controller tests for `null` current plan                                                          |
| Concurrent replacement revision numbering | Repository replacement path locks `agent_session` with `FOR UPDATE`; medium test verifies in-transaction revision     |
| Session deletion cascade                  | Medium repository test `deletes operations when the owning session is deleted`                                        |
| Operation `updatedAt` drift               | `agent_operation_updatedAt` trigger and `migrations:debug` verification                                               |
| Runner tool exposure                      | Runner tests assert read plus planning tools are exposed and apply/write tools are absent                             |
| Tool-gate audit                           | Service tests assert completed and denied `agent_tool_call` rows for planning tools                                   |

## Self-Review Checklist

- [ ] Spec coverage: operation-plan tables, operation rows, propose/revise tools, summarize tool, tool-gate audit rows, normal access checks, dependency validation, and tests for shape/blocking are all covered.
- [ ] Scope guard: no apply endpoint, no album mutation execution, no plan review UI, and no direct Pi write tools are introduced.
- [ ] Placeholder scan: no banned placeholder wording remains in the plan body.
- [ ] Type consistency: enum names, DTO names, route names, and service method names match across tasks.
- [ ] Security: every browser route uses `AgentSessionRead` or `AgentSessionUpdate`; every runner route stays behind `AgentRunnerToolGuard`; session ownership is enforced through `AgentSessionRepository.getById(auth.user.id, sessionId)`; referenced existing albums/assets are checked through normal Gallery access repositories.
- [ ] Privacy: operation tables store IDs, summaries, and payloads only; no previews, originals, provider payloads, raw model messages, filesystem paths, or raw secrets are stored.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-15-pi-agent-structured-album-plan-storage.md`.

Two execution options:

**1. Subagent-Driven (recommended)** - dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** - execute tasks in this session using `superpowers:executing-plans`, batch execution with checkpoints.

Which approach?
