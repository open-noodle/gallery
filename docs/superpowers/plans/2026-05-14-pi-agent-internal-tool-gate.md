# Pi Agent Internal Tool Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build vertical slice 5 for the Pi agent by adding one server-owned internal metadata read tool behind session policy, explicit approval, and durable `agent_tool_call` audit rows.

**Architecture:** Gallery remains the policy and audit authority. The runner-facing tool route is marked internal and exposes only `readAssetMetadata`; every policy-allowed call in this slice requires explicit approval before execution. The tool never calls Pi, never returns previews/originals, never mutates albums, and never creates long-lived grants.

**Tech Stack:** NestJS, Kysely, `@immich/sql-tools`, Postgres, Zod DTOs via `nestjs-zod`, Vitest, existing Gallery access utilities.

---

## Scope

This slice implements:

- `agent_tool_call` table and repository.
- One internal tool: `readAssetMetadata`.
- Strict approval lifecycle: request -> pending approval -> approved or denied -> execute approved request.
- Atomic tool-call state transitions so approvals and executions are one-shot under retries or concurrent runner calls.
- User/session ownership checks through `agent_session`.
- Normal Gallery asset access checks plus session permission-plan checks.
- Redacted audit metadata for requests and responses.
- Tests for policy denial, access denial, locked-asset gating, pending approval, approval, denial, execution, guarded transitions, and audit persistence.

For this slice, `permissionPlanSnapshot.assetScope.sharedSpaces` means shared-space assets only. Shared album and partner timeline access remain denied to the agent until a future permission-plan field explicitly adds them.

This slice intentionally does not implement:

- Pi SDK/runtime calls.
- Runner authentication headers.
- Streaming.
- Grants or YOLO read mode.
- Preview/original tools.
- Search/list album/read album tools.
- UI for approvals.
- Album operation plans or album mutations.

## Existing Context

Slice 1 already added provider credentials.
Slice 2 already added `agent_session` and immutable permission-plan snapshots.
Slice 3 already added `agent_message`.
Slice 4 already added runner status and the disabled Assistant page.

The approved design spec for this feature is:

- `docs/superpowers/specs/2026-05-14-pi-agent-album-assistant-design.md`

The roadmap entry for slice 5 is:

```text
Internal tool gate without Pi:
- implement one metadata read tool behind session policy;
- strict approval path;
- agent_tool_call audit rows;
- tests for access checks, approval-required responses, approvals, denials, and audit persistence.
```

## API Contracts

Internal tool request:

```http
POST /agent/sessions/:id/tools/read-asset-metadata
```

Initial request body:

```json
{
  "assetIds": ["00000000-0000-4000-8000-000000000001"]
}
```

Approval-required response:

```json
{
  "status": "approval-required",
  "toolCall": {
    "id": "00000000-0000-4000-8000-000000000101",
    "sessionId": "00000000-0000-4000-8000-000000000201",
    "toolName": "readAssetMetadata",
    "status": "pending_approval",
    "approvalDecision": null,
    "requestSummary": "Read metadata for 1 asset",
    "responseSummary": null,
    "dataClass": "metadata",
    "assetCount": 1,
    "albumCount": 0,
    "startedAt": "2026-05-14T12:00:00.000Z",
    "completedAt": null,
    "error": null
  }
}
```

Approval decision route:

```http
POST /agent/sessions/:id/tool-calls/:toolCallId/approval
```

Approval body:

```json
{
  "decision": "approved"
}
```

Denial body:

```json
{
  "decision": "denied",
  "reason": "This album contains private photos."
}
```

Execute approved request body:

```json
{
  "toolCallId": "00000000-0000-4000-8000-000000000101"
}
```

Success response:

```json
{
  "status": "success",
  "toolCall": {
    "id": "00000000-0000-4000-8000-000000000101",
    "sessionId": "00000000-0000-4000-8000-000000000201",
    "toolName": "readAssetMetadata",
    "status": "completed",
    "approvalDecision": "approved",
    "requestSummary": "Read metadata for 1 asset",
    "responseSummary": "Returned metadata for 1 asset",
    "dataClass": "metadata",
    "assetCount": 1,
    "albumCount": 0,
    "startedAt": "2026-05-14T12:00:00.000Z",
    "completedAt": "2026-05-14T12:01:00.000Z",
    "error": null
  },
  "assets": [
    {
      "id": "00000000-0000-4000-8000-000000000001",
      "ownerId": "00000000-0000-4000-8000-000000000301",
      "type": "IMAGE",
      "originalFileName": "IMG_0001.jpg",
      "localDateTime": "2026-05-14T10:00:00.000Z",
      "fileCreatedAt": "2026-05-14T10:00:00.000Z",
      "fileModifiedAt": "2026-05-14T10:00:00.000Z",
      "isFavorite": false,
      "visibility": "timeline",
      "exifInfo": {
        "dateTimeOriginal": "2026-05-14T10:00:00.000Z",
        "city": "Berlin",
        "state": "Berlin",
        "country": "Germany",
        "make": "Canon",
        "model": "R5",
        "lensModel": "RF 35mm",
        "latitude": 52.52,
        "longitude": 13.405,
        "rating": 5
      },
      "tags": [{ "id": "00000000-0000-4000-8000-000000000401", "value": "travel", "color": null }]
    }
  ]
}
```

Denied response:

```json
{
  "status": "denied",
  "reason": "Not found or no asset.read access",
  "toolCall": {
    "id": "00000000-0000-4000-8000-000000000101",
    "sessionId": "00000000-0000-4000-8000-000000000201",
    "toolName": "readAssetMetadata",
    "status": "denied",
    "approvalDecision": "denied",
    "requestSummary": "Read metadata for 1 asset",
    "responseSummary": null,
    "dataClass": "metadata",
    "assetCount": 1,
    "albumCount": 0,
    "startedAt": "2026-05-14T12:00:00.000Z",
    "completedAt": "2026-05-14T12:00:00.000Z",
    "error": "Not found or no asset.read access"
  }
}
```

## File Structure

Create:

- `server/src/types/agent-tool.types.ts` - redacted metadata and audit metadata types.
- `server/src/dtos/agent-tool.dto.ts` - request, response, approval, and route-param DTOs.
- `server/src/dtos/agent-tool.dto.spec.ts` - DTO validation and serialization tests.
- `server/src/schema/tables/agent-tool-call.table.ts` - SQL-tools table for durable tool-call audit.
- `server/src/schema/migrations/1778900000000-AgentToolCall.ts` - manual migration for `agent_tool_call`.
- `server/src/repositories/agent-tool-call.repository.ts` - Kysely create/list/get, counted asset totals, and guarded transition queries.
- `server/test/medium/specs/repositories/agent-tool-call.repository.spec.ts` - DB-backed audit tests.
- `server/src/services/agent-tool.service.ts` - policy, approval, execution, and audit behavior.
- `server/src/services/agent-tool.service.spec.ts` - service TDD coverage.
- `server/src/controllers/agent-tool.controller.ts` - internal tool and approval routes.
- `server/src/controllers/agent-tool.controller.spec.ts` - route auth, validation, and serialization tests.

Modify:

- `server/src/enum.ts` - add tool name/status/decision/data-class enums.
- `server/src/database.ts` - export `AgentToolCall` and add selected columns.
- `server/src/schema/index.ts` - register table and DB interface.
- `server/src/repositories/index.ts` - register `AgentToolCallRepository`.
- `server/src/services/index.ts` - register `AgentToolService`.
- `server/src/controllers/index.ts` - register `AgentToolController`.
- `server/src/repositories/asset.repository.ts` - add narrow `getAgentMetadataByIds()` and `getAgentLockedIds()` queries.
- `server/test/medium/specs/repositories/asset.repository.spec.ts` - DB-backed redaction and locked-visibility coverage.
- `server/test/repositories/asset.repository.mock.ts` - add mocks for agent asset queries.
- `scripts/revert-to-immich.sql` - drop `agent_tool_call`, remove migration rows, and update sanity checks.
- Generated OpenAPI/SDK files changed by `make open-api-typescript`.

## Task 1: Tool Contracts And Audit Schema

**Files:**

- Create: `server/src/types/agent-tool.types.ts`
- Create: `server/src/dtos/agent-tool.dto.ts`
- Create: `server/src/dtos/agent-tool.dto.spec.ts`
- Create: `server/src/schema/tables/agent-tool-call.table.ts`
- Create: `server/src/schema/migrations/1778900000000-AgentToolCall.ts`
- Modify: `server/src/enum.ts`
- Modify: `server/src/database.ts`
- Modify: `server/src/schema/index.ts`

- [ ] **Step 1: Write failing DTO tests**

Create `server/src/dtos/agent-tool.dto.spec.ts`:

```ts
import {
  AgentReadAssetMetadataToolRequestDto,
  AgentReadAssetMetadataToolResponseDto,
  AgentToolApprovalDto,
} from 'src/dtos/agent-tool.dto';
import {
  AgentToolApprovalDecision,
  AgentToolCallStatus,
  AgentToolDataClass,
  AgentToolName,
  AssetType,
  AssetVisibility,
} from 'src/enum';
import { factory } from 'test/small.factory';
import z from 'zod';

type ReadMetadataInput = z.input<typeof AgentReadAssetMetadataToolRequestDto.schema>;

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

describe('Agent tool DTOs', () => {
  describe(AgentReadAssetMetadataToolRequestDto.name, () => {
    const parse = (input: ReadMetadataInput) => AgentReadAssetMetadataToolRequestDto.schema.safeParse(input);

    it('accepts a new metadata request with asset ids', () => {
      const assetId = factory.uuid();
      const result = parse({ assetIds: [assetId] });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual({ assetIds: [assetId] });
      }
    });

    it('accepts an approved tool call resume request', () => {
      const toolCallId = factory.uuid();
      const result = parse({ toolCallId });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual({ toolCallId });
      }
    });

    it('rejects requests without assetIds or toolCallId', () => {
      const result = parse({});

      expectIssue(result, [], 'Provide assetIds for a new tool request or toolCallId for an approved request');
    });

    it('rejects requests with both assetIds and toolCallId', () => {
      const result = parse({ assetIds: [factory.uuid()], toolCallId: factory.uuid() });

      expectIssue(result, [], 'Provide either assetIds or toolCallId, not both');
    });

    it('rejects invalid asset ids', () => {
      const result = parse({ assetIds: ['not-a-uuid'] });

      expectIssue(result, ['assetIds', 0], 'Invalid UUID');
    });

    it('rejects duplicate asset ids so audit counts and result rows stay unambiguous', () => {
      const assetId = factory.uuid();
      const result = parse({ assetIds: [assetId, assetId] });

      expectIssue(result, ['assetIds'], 'assetIds must be unique');
    });
  });

  describe(AgentToolApprovalDto.name, () => {
    it('accepts approval and denial decisions', () => {
      expect(AgentToolApprovalDto.schema.safeParse({ decision: AgentToolApprovalDecision.Approved }).success).toBe(
        true,
      );
      expect(
        AgentToolApprovalDto.schema.safeParse({
          decision: AgentToolApprovalDecision.Denied,
          reason: 'Contains private photos',
        }).success,
      ).toBe(true);
    });

    it('rejects blank denial reasons after trim', () => {
      const result = AgentToolApprovalDto.schema.safeParse({
        decision: AgentToolApprovalDecision.Denied,
        reason: '   ',
      });

      expectIssue(result, ['reason'], 'Too small');
    });
  });

  describe(AgentReadAssetMetadataToolResponseDto.name, () => {
    const toolCall = {
      id: factory.uuid(),
      sessionId: factory.uuid(),
      toolName: AgentToolName.ReadAssetMetadata,
      status: AgentToolCallStatus.Completed,
      approvalDecision: AgentToolApprovalDecision.Approved,
      requestSummary: 'Read metadata for 1 asset',
      responseSummary: 'Returned metadata for 1 asset',
      dataClass: AgentToolDataClass.Metadata,
      assetCount: 1,
      albumCount: 0,
      startedAt: new Date('2026-05-14T12:00:00.000Z'),
      completedAt: new Date('2026-05-14T12:01:00.000Z'),
      error: null,
    };

    it('serializes success responses with dates and metadata only', () => {
      const result = AgentReadAssetMetadataToolResponseDto.schema.safeEncode({
        status: 'success',
        toolCall,
        assets: [
          {
            id: factory.uuid(),
            ownerId: factory.uuid(),
            type: AssetType.Image,
            originalFileName: 'IMG_0001.jpg',
            localDateTime: new Date('2026-05-14T10:00:00.000Z'),
            fileCreatedAt: new Date('2026-05-14T10:00:00.000Z'),
            fileModifiedAt: new Date('2026-05-14T10:00:00.000Z'),
            isFavorite: false,
            visibility: AssetVisibility.Timeline,
            exifInfo: {
              dateTimeOriginal: new Date('2026-05-14T10:00:00.000Z'),
              city: 'Berlin',
              state: 'Berlin',
              country: 'Germany',
              make: 'Canon',
              model: 'R5',
              lensModel: 'RF 35mm',
              latitude: 52.52,
              longitude: 13.405,
              rating: 5,
            },
            tags: [{ id: factory.uuid(), value: 'travel', color: null }],
          },
        ],
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.toolCall.startedAt).toBe('2026-05-14T12:00:00.000Z');
        expect(result.data.assets[0].localDateTime).toBe('2026-05-14T10:00:00.000Z');
      }
    });
  });
});
```

- [ ] **Step 2: Run DTO tests to verify they fail**

Run:

```bash
pnpm --dir server test src/dtos/agent-tool.dto.spec.ts
```

Expected: FAIL because `server/src/dtos/agent-tool.dto.ts` and new enums do not exist.

- [ ] **Step 3: Add enums**

Modify `server/src/enum.ts` near the existing agent enums:

```ts
export enum AgentToolName {
  ReadAssetMetadata = 'readAssetMetadata',
}

export enum AgentToolCallStatus {
  PendingApproval = 'pending_approval',
  Approved = 'approved',
  Executing = 'executing',
  Denied = 'denied',
  Completed = 'completed',
  Failed = 'failed',
}

export enum AgentToolApprovalDecision {
  Approved = 'approved',
  Denied = 'denied',
}

export enum AgentToolDataClass {
  Metadata = 'metadata',
}
```

- [ ] **Step 4: Add shared tool types**

Create `server/src/types/agent-tool.types.ts`:

```ts
import { AgentProviderType, AssetType, AssetVisibility } from 'src/enum';

export type AgentToolProviderSnapshot = {
  providerCredentialId: string | null;
  providerType: AgentProviderType;
  label: string;
  baseUrl: string | null;
  model: string;
};

export type AgentToolReadAssetMetadataRequestMetadata = {
  assetIds: string[];
};

export type AgentToolReadAssetMetadataResponseMetadata = {
  assetIds: string[];
};

export type AgentAssetMetadata = {
  id: string;
  ownerId: string;
  type: AssetType;
  originalFileName: string;
  localDateTime: Date;
  fileCreatedAt: Date;
  fileModifiedAt: Date;
  isFavorite: boolean;
  visibility: AssetVisibility;
  exifInfo: {
    dateTimeOriginal: Date | null;
    city: string | null;
    state: string | null;
    country: string | null;
    make: string | null;
    model: string | null;
    lensModel: string | null;
    latitude: number | null;
    longitude: number | null;
    rating: number | null;
  } | null;
  tags: Array<{
    id: string;
    value: string;
    color: string | null;
  }>;
};
```

- [ ] **Step 5: Add DTOs**

Create `server/src/dtos/agent-tool.dto.ts`:

```ts
import { createZodDto } from 'nestjs-zod';
import {
  AgentToolApprovalDecision,
  AgentToolCallStatus,
  AgentToolDataClass,
  AgentToolName,
  AssetType,
  AssetVisibility,
} from 'src/enum';
import { isoDatetimeToDate } from 'src/validation';
import z from 'zod';

const MAX_TOOL_ASSET_IDS = 10_000;
const summary = z.string().trim().min(1).max(500);
const reason = z.string().trim().min(1).max(1000).optional();
const uuid = z.uuidv4();

const AgentToolNameSchema = z.enum(AgentToolName).meta({ id: 'AgentToolName' });
const AgentToolCallStatusSchema = z.enum(AgentToolCallStatus).meta({ id: 'AgentToolCallStatus' });
const AgentToolApprovalDecisionSchema = z.enum(AgentToolApprovalDecision).meta({
  id: 'AgentToolApprovalDecision',
});
const AgentToolDataClassSchema = z.enum(AgentToolDataClass).meta({ id: 'AgentToolDataClass' });
const AssetTypeSchema = z.enum(AssetType).meta({ id: 'AssetType' });
const AssetVisibilitySchema = z.enum(AssetVisibility).meta({ id: 'AssetVisibility' });

const AgentReadAssetMetadataToolRequestSchema = z
  .object({
    assetIds: z.array(uuid).min(1).max(MAX_TOOL_ASSET_IDS).optional(),
    toolCallId: uuid.optional(),
  })
  .superRefine((value, ctx) => {
    if (value.assetIds && new Set(value.assetIds).size !== value.assetIds.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['assetIds'],
        message: 'assetIds must be unique',
      });
    }

    if (!value.assetIds && !value.toolCallId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Provide assetIds for a new tool request or toolCallId for an approved request',
      });
    }

    if (value.assetIds && value.toolCallId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Provide either assetIds or toolCallId, not both',
      });
    }
  })
  .meta({ id: 'AgentReadAssetMetadataToolRequestDto' });

const AgentToolApprovalSchema = z
  .object({
    decision: AgentToolApprovalDecisionSchema,
    reason,
  })
  .meta({ id: 'AgentToolApprovalDto' });

const AgentToolCallResponseSchema = z
  .object({
    id: uuid,
    sessionId: uuid,
    toolName: AgentToolNameSchema,
    status: AgentToolCallStatusSchema,
    approvalDecision: AgentToolApprovalDecisionSchema.nullable(),
    requestSummary: summary,
    responseSummary: summary.nullable(),
    dataClass: AgentToolDataClassSchema,
    assetCount: z.number().int().min(0),
    albumCount: z.number().int().min(0),
    startedAt: isoDatetimeToDate,
    completedAt: isoDatetimeToDate.nullable(),
    error: z.string().nullable(),
  })
  .meta({ id: 'AgentToolCallResponseDto' });

const AgentAssetMetadataSchema = z
  .object({
    id: uuid,
    ownerId: uuid,
    type: AssetTypeSchema,
    originalFileName: z.string(),
    localDateTime: isoDatetimeToDate,
    fileCreatedAt: isoDatetimeToDate,
    fileModifiedAt: isoDatetimeToDate,
    isFavorite: z.boolean(),
    visibility: AssetVisibilitySchema,
    exifInfo: z
      .object({
        dateTimeOriginal: isoDatetimeToDate.nullable(),
        city: z.string().nullable(),
        state: z.string().nullable(),
        country: z.string().nullable(),
        make: z.string().nullable(),
        model: z.string().nullable(),
        lensModel: z.string().nullable(),
        latitude: z.number().nullable(),
        longitude: z.number().nullable(),
        rating: z.number().int().nullable(),
      })
      .nullable(),
    tags: z.array(
      z.object({
        id: uuid,
        value: z.string(),
        color: z.string().nullable(),
      }),
    ),
  })
  .meta({ id: 'AgentAssetMetadata' });

const AgentReadAssetMetadataToolResponseSchema = z
  .discriminatedUnion('status', [
    z.object({
      status: z.literal('approval-required'),
      toolCall: AgentToolCallResponseSchema,
    }),
    z.object({
      status: z.literal('denied'),
      reason: z.string(),
      toolCall: AgentToolCallResponseSchema,
    }),
    z.object({
      status: z.literal('success'),
      toolCall: AgentToolCallResponseSchema,
      assets: z.array(AgentAssetMetadataSchema),
    }),
  ])
  .meta({ id: 'AgentReadAssetMetadataToolResponseDto' });

const AgentToolCallParamsSchema = z
  .object({
    id: uuid,
    toolCallId: uuid,
  })
  .meta({ id: 'AgentToolCallParamsDto' });

export class AgentReadAssetMetadataToolRequestDto extends createZodDto(AgentReadAssetMetadataToolRequestSchema) {}
export class AgentToolApprovalDto extends createZodDto(AgentToolApprovalSchema) {}
export class AgentToolCallResponseDto extends createZodDto(AgentToolCallResponseSchema) {}
export class AgentReadAssetMetadataToolResponseDto extends createZodDto(AgentReadAssetMetadataToolResponseSchema) {}
export class AgentToolCallParamsDto extends createZodDto(AgentToolCallParamsSchema) {}

export { AgentAssetMetadataSchema };
```

- [ ] **Step 6: Add audit table**

Create `server/src/schema/tables/agent-tool-call.table.ts`:

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
} from '@immich/sql-tools';
import { AgentToolApprovalDecision, AgentToolCallStatus, AgentToolDataClass, AgentToolName } from 'src/enum';
import { AgentSessionTable } from 'src/schema/tables/agent-session.table';
import type {
  AgentToolProviderSnapshot,
  AgentToolReadAssetMetadataRequestMetadata,
  AgentToolReadAssetMetadataResponseMetadata,
} from 'src/types/agent-tool.types';

@Index({ columns: ['sessionId', 'status'] })
@Index({ columns: ['sessionId', 'startedAt', 'id'] })
@Table('agent_tool_call')
export class AgentToolCallTable {
  @PrimaryGeneratedColumn()
  id!: Generated<string>;

  @ForeignKeyColumn(() => AgentSessionTable, { onUpdate: 'CASCADE', onDelete: 'CASCADE' })
  sessionId!: string;

  @Column()
  toolName!: AgentToolName;

  @Column()
  status!: AgentToolCallStatus;

  @Column({ nullable: true })
  approvalDecision!: AgentToolApprovalDecision | null;

  @Column({ type: 'text' })
  requestSummary!: string;

  @Column({ type: 'text', nullable: true })
  responseSummary!: string | null;

  @Column({ type: 'jsonb' })
  redactedRequestMetadata!: AgentToolReadAssetMetadataRequestMetadata;

  @Column({ type: 'jsonb', nullable: true })
  redactedResponseMetadata!: AgentToolReadAssetMetadataResponseMetadata | null;

  @Column()
  dataClass!: AgentToolDataClass;

  @Column()
  assetCount!: number;

  @Column()
  albumCount!: number;

  @Column({ type: 'jsonb' })
  providerSnapshot!: AgentToolProviderSnapshot;

  @CreateDateColumn()
  startedAt!: Generated<Timestamp>;

  @Column({ type: 'timestamp with time zone', nullable: true })
  completedAt!: Timestamp | null;

  @Column({ type: 'text', nullable: true })
  error!: string | null;
}
```

- [ ] **Step 7: Add migration**

Create `server/src/schema/migrations/1778900000000-AgentToolCall.ts`:

```ts
import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE "agent_tool_call" (
      "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
      "sessionId" uuid NOT NULL,
      "toolName" character varying NOT NULL,
      "status" character varying NOT NULL,
      "approvalDecision" character varying,
      "requestSummary" text NOT NULL,
      "responseSummary" text,
      "redactedRequestMetadata" jsonb NOT NULL,
      "redactedResponseMetadata" jsonb,
      "dataClass" character varying NOT NULL,
      "assetCount" integer NOT NULL,
      "albumCount" integer NOT NULL,
      "providerSnapshot" jsonb NOT NULL,
      "startedAt" timestamp with time zone NOT NULL DEFAULT now(),
      "completedAt" timestamp with time zone,
      "error" text,
      CONSTRAINT "agent_tool_call_pkey" PRIMARY KEY ("id"),
      CONSTRAINT "agent_tool_call_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "agent_session"("id") ON UPDATE CASCADE ON DELETE CASCADE
    )
  `.execute(db);

  await sql`CREATE INDEX "agent_tool_call_sessionId_status_idx" ON "agent_tool_call" ("sessionId", "status")`.execute(
    db,
  );
  await sql`CREATE INDEX "agent_tool_call_sessionId_startedAt_id_idx" ON "agent_tool_call" ("sessionId", "startedAt", "id")`.execute(
    db,
  );
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP INDEX "agent_tool_call_sessionId_startedAt_id_idx"`.execute(db);
  await sql`DROP INDEX "agent_tool_call_sessionId_status_idx"`.execute(db);
  await sql`DROP TABLE "agent_tool_call"`.execute(db);
}
```

- [ ] **Step 8: Register table and selected columns**

Modify `server/src/schema/index.ts`:

```ts
import { AgentToolCallTable } from 'src/schema/tables/agent-tool-call.table';
```

Add `AgentToolCallTable` to `ImmichDatabase.tables` immediately after `AgentMessageTable`.

Add to `DB`:

```ts
agent_tool_call: AgentToolCallTable;
```

Modify `server/src/database.ts`:

```ts
import { AgentToolCallTable } from 'src/schema/tables/agent-tool-call.table';
```

Add the exported type:

```ts
export type AgentToolCall = Selectable<AgentToolCallTable>;
```

Add selected columns in the existing `columns` object:

```ts
agentToolCall: [
  'id',
  'sessionId',
  'toolName',
  'status',
  'approvalDecision',
  'requestSummary',
  'responseSummary',
  'redactedRequestMetadata',
  'redactedResponseMetadata',
  'dataClass',
  'assetCount',
  'albumCount',
  'providerSnapshot',
  'startedAt',
  'completedAt',
  'error',
] as const,
```

- [ ] **Step 9: Run DTO tests to verify they pass**

Run:

```bash
pnpm --dir server test src/dtos/agent-tool.dto.spec.ts
```

Expected: PASS.

- [ ] **Step 10: Commit contracts and schema**

```bash
git add server/src/enum.ts server/src/types/agent-tool.types.ts server/src/dtos/agent-tool.dto.ts server/src/dtos/agent-tool.dto.spec.ts server/src/schema/tables/agent-tool-call.table.ts server/src/schema/migrations/1778900000000-AgentToolCall.ts server/src/schema/index.ts server/src/database.ts docs/superpowers/plans/2026-05-14-pi-agent-internal-tool-gate.md
git commit -m "feat: add agent tool call contracts"
```

## Task 2: Audit Repository And Asset Metadata Query

**Files:**

- Create: `server/src/repositories/agent-tool-call.repository.ts`
- Create: `server/test/medium/specs/repositories/agent-tool-call.repository.spec.ts`
- Modify: `server/src/repositories/index.ts`
- Modify: `server/src/repositories/asset.repository.ts`
- Modify: `server/test/medium/specs/repositories/asset.repository.spec.ts`
- Modify: `server/test/repositories/asset.repository.mock.ts`

- [ ] **Step 1: Write failing repository tests**

Create `server/test/medium/specs/repositories/agent-tool-call.repository.spec.ts`:

```ts
import { Kysely } from 'kysely';
import {
  AgentApprovalMode,
  AgentPermissionPreset,
  AgentProviderType,
  AgentToolApprovalDecision,
  AgentToolCallStatus,
  AgentToolDataClass,
  AgentToolName,
} from 'src/enum';
import { AgentProviderCredentialRepository } from 'src/repositories/agent-provider-credential.repository';
import { AgentSessionRepository } from 'src/repositories/agent-session.repository';
import { AgentToolCallRepository } from 'src/repositories/agent-tool-call.repository';
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
    sut: new AgentToolCallRepository(database),
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

describe(AgentToolCallRepository.name, () => {
  it('creates, lists, retrieves, and updates tool calls for a session', async () => {
    const { ctx, credentialRepository, sessionRepository, sut } = setup();
    const { session } = await createSession(ctx, credentialRepository, sessionRepository);
    const assetId = '00000000-0000-4000-8000-000000000001';

    const created = await sut.create({
      sessionId: session.id,
      toolName: AgentToolName.ReadAssetMetadata,
      status: AgentToolCallStatus.PendingApproval,
      approvalDecision: null,
      requestSummary: 'Read metadata for 1 asset',
      responseSummary: null,
      redactedRequestMetadata: { assetIds: [assetId] },
      redactedResponseMetadata: null,
      dataClass: AgentToolDataClass.Metadata,
      assetCount: 1,
      albumCount: 0,
      providerSnapshot: {
        providerCredentialId: session.providerCredentialId,
        providerType: AgentProviderType.OpenAI,
        label: 'OpenAI personal',
        baseUrl: null,
        model: 'gpt-5.1',
      },
      startedAt: new Date('2026-05-14T12:00:00.000Z'),
    });

    expect(created).toMatchObject({
      sessionId: session.id,
      toolName: AgentToolName.ReadAssetMetadata,
      status: AgentToolCallStatus.PendingApproval,
      approvalDecision: null,
      assetCount: 1,
      albumCount: 0,
      completedAt: null,
      error: null,
    });

    await expect(sut.getByIdForSession(session.id, created.id)).resolves.toMatchObject({ id: created.id });
    await expect(sut.getBySessionId(session.id)).resolves.toMatchObject([{ id: created.id }]);

    const completedAt = new Date('2026-05-14T12:01:00.000Z');
    const updated = await sut.transition(session.id, created.id, AgentToolCallStatus.PendingApproval, {
      status: AgentToolCallStatus.Completed,
      approvalDecision: AgentToolApprovalDecision.Approved,
      responseSummary: 'Returned metadata for 1 asset',
      redactedResponseMetadata: { assetIds: [assetId] },
      completedAt,
    });

    expect(updated).toMatchObject({
      id: created.id,
      status: AgentToolCallStatus.Completed,
      approvalDecision: AgentToolApprovalDecision.Approved,
      responseSummary: 'Returned metadata for 1 asset',
      redactedResponseMetadata: { assetIds: [assetId] },
      completedAt,
    });

    await expect(
      sut.transition(session.id, created.id, AgentToolCallStatus.PendingApproval, {
        status: AgentToolCallStatus.Completed,
        completedAt: new Date('2026-05-14T12:02:00.000Z'),
      }),
    ).resolves.toBeUndefined();
  });

  it('counts only active or completed asset totals for session limits and can exclude the current call', async () => {
    const { ctx, credentialRepository, sessionRepository, sut } = setup();
    const { session } = await createSession(ctx, credentialRepository, sessionRepository);
    const { session: otherSession } = await createSession(ctx, credentialRepository, sessionRepository);

    const createToolCall = (sessionId: string, status: AgentToolCallStatus, assetCount: number) =>
      sut.create({
        sessionId,
        toolName: AgentToolName.ReadAssetMetadata,
        status,
        approvalDecision:
          status === AgentToolCallStatus.Denied
            ? AgentToolApprovalDecision.Denied
            : status === AgentToolCallStatus.PendingApproval
              ? null
              : AgentToolApprovalDecision.Approved,
        requestSummary: `Read metadata for ${assetCount} assets`,
        responseSummary: status === AgentToolCallStatus.Completed ? `Returned metadata for ${assetCount} assets` : null,
        redactedRequestMetadata: { assetIds: Array.from({ length: assetCount }, () => factory.uuid()) },
        redactedResponseMetadata: null,
        dataClass: AgentToolDataClass.Metadata,
        assetCount,
        albumCount: 0,
        providerSnapshot: {
          providerCredentialId: session.providerCredentialId,
          providerType: AgentProviderType.OpenAI,
          label: 'OpenAI personal',
          baseUrl: null,
          model: 'gpt-5.1',
        },
        completedAt:
          status === AgentToolCallStatus.Completed || status === AgentToolCallStatus.Denied ? new Date() : null,
        error: status === AgentToolCallStatus.Denied ? 'Denied' : null,
      });

    await createToolCall(session.id, AgentToolCallStatus.Completed, 1);
    const pending = await createToolCall(session.id, AgentToolCallStatus.PendingApproval, 2);
    await createToolCall(session.id, AgentToolCallStatus.Approved, 3);
    await createToolCall(session.id, AgentToolCallStatus.Executing, 4);
    await createToolCall(session.id, AgentToolCallStatus.Denied, 10);
    await createToolCall(otherSession.id, AgentToolCallStatus.Completed, 20);

    await expect(sut.getCountedAssetCountBySession(session.id)).resolves.toBe(10);
    await expect(sut.getCountedAssetCountBySession(session.id, pending.id)).resolves.toBe(8);
  });

  it('does not return calls across sessions and cascades on session delete', async () => {
    const { ctx, credentialRepository, sessionRepository, sut } = setup();
    const { session } = await createSession(ctx, credentialRepository, sessionRepository);
    const { session: otherSession } = await createSession(ctx, credentialRepository, sessionRepository);

    const created = await sut.create({
      sessionId: session.id,
      toolName: AgentToolName.ReadAssetMetadata,
      status: AgentToolCallStatus.PendingApproval,
      approvalDecision: null,
      requestSummary: 'Read metadata for 1 asset',
      responseSummary: null,
      redactedRequestMetadata: { assetIds: ['00000000-0000-4000-8000-000000000001'] },
      redactedResponseMetadata: null,
      dataClass: AgentToolDataClass.Metadata,
      assetCount: 1,
      albumCount: 0,
      providerSnapshot: {
        providerCredentialId: session.providerCredentialId,
        providerType: AgentProviderType.OpenAI,
        label: 'OpenAI personal',
        baseUrl: null,
        model: 'gpt-5.1',
      },
    });

    await expect(sut.getByIdForSession(otherSession.id, created.id)).resolves.toBeUndefined();

    await defaultDatabase.deleteFrom('agent_session').where('id', '=', session.id).execute();

    await expect(sut.getByIdForSession(session.id, created.id)).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run repository tests to verify they fail**

Run:

```bash
pnpm --dir server test:medium agent-tool-call.repository.spec.ts
```

Expected: FAIL because `AgentToolCallRepository` and `agent_tool_call` registration do not exist.

- [ ] **Step 3: Add audit repository**

Create `server/src/repositories/agent-tool-call.repository.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { Insertable, Kysely, sql, Updateable } from 'kysely';
import { InjectKysely } from 'nestjs-kysely';
import { columns } from 'src/database';
import { DummyValue, GenerateSql } from 'src/decorators';
import { AgentToolCallStatus } from 'src/enum';
import { DB } from 'src/schema';
import { AgentToolCallTable } from 'src/schema/tables/agent-tool-call.table';
import { asUuid } from 'src/utils/database';

type AgentToolCallUpdate = Pick<
  Updateable<AgentToolCallTable>,
  'status' | 'approvalDecision' | 'responseSummary' | 'redactedResponseMetadata' | 'completedAt' | 'error'
>;

@Injectable()
export class AgentToolCallRepository {
  constructor(@InjectKysely() private db: Kysely<DB>) {}

  create(dto: Insertable<AgentToolCallTable>) {
    return this.db.insertInto('agent_tool_call').values(dto).returning(columns.agentToolCall).executeTakeFirstOrThrow();
  }

  @GenerateSql({ params: [DummyValue.UUID] })
  getBySessionId(sessionId: string) {
    return this.db
      .selectFrom('agent_tool_call')
      .select(columns.agentToolCall)
      .where('sessionId', '=', asUuid(sessionId))
      .orderBy('startedAt', 'desc')
      .orderBy('id', 'desc')
      .execute();
  }

  @GenerateSql({ params: [DummyValue.UUID, DummyValue.UUID] })
  getByIdForSession(sessionId: string, id: string) {
    return this.db
      .selectFrom('agent_tool_call')
      .select(columns.agentToolCall)
      .where('sessionId', '=', asUuid(sessionId))
      .where('id', '=', asUuid(id))
      .executeTakeFirst();
  }

  @GenerateSql({ params: [DummyValue.UUID, DummyValue.UUID] })
  async getCountedAssetCountBySession(sessionId: string, excludedToolCallId?: string): Promise<number> {
    const result = await this.db
      .selectFrom('agent_tool_call')
      .select((eb) => sql<number>`coalesce(sum(${eb.ref('assetCount')}), 0)::int`.as('assetCount'))
      .where('sessionId', '=', asUuid(sessionId))
      .where('status', 'in', [
        AgentToolCallStatus.PendingApproval,
        AgentToolCallStatus.Approved,
        AgentToolCallStatus.Executing,
        AgentToolCallStatus.Completed,
      ])
      .$if(Boolean(excludedToolCallId), (qb) => qb.where('id', '!=', asUuid(excludedToolCallId!)))
      .executeTakeFirstOrThrow();

    return result.assetCount;
  }

  transition(sessionId: string, id: string, expectedStatus: AgentToolCallStatus, dto: AgentToolCallUpdate) {
    return this.db
      .updateTable('agent_tool_call')
      .set(dto)
      .where('sessionId', '=', asUuid(sessionId))
      .where('id', '=', asUuid(id))
      .where('status', '=', expectedStatus)
      .returning(columns.agentToolCall)
      .executeTakeFirst();
  }
}
```

Modify `server/src/repositories/index.ts`:

```ts
import { AgentToolCallRepository } from 'src/repositories/agent-tool-call.repository';
```

Add `AgentToolCallRepository` to `repositories` immediately after `AgentSessionRepository`.

- [ ] **Step 4: Write failing DB-backed asset metadata and locked-visibility tests**

Modify `server/test/medium/specs/repositories/asset.repository.spec.ts` imports:

```ts
import { AssetFileType, AssetOrder, AssetVisibility } from 'src/enum';
import { AssetRepository } from 'src/repositories/asset.repository';
import { FaceIdentityRepository } from 'src/repositories/face-identity.repository';
import { LoggingRepository } from 'src/repositories/logging.repository';
import { SharedSpaceRepository } from 'src/repositories/shared-space.repository';
import { TagRepository } from 'src/repositories/tag.repository';
```

Add this describe block inside `describe(AssetRepository.name, () => {`:

```ts
describe('getAgentMetadataByIds', () => {
  it('returns redacted metadata with exif and tags while excluding media/original fields', async () => {
    const { ctx, sut } = setup();
    const { user } = await ctx.newUser();
    const { asset } = await ctx.newAsset({
      ownerId: user.id,
      originalFileName: 'IMG_0001.jpg',
      originalPath: '/uploads/private/IMG_0001.jpg',
      localDateTime: new Date('2026-05-14T10:00:00.000Z'),
      fileCreatedAt: new Date('2026-05-14T10:00:01.000Z'),
      fileModifiedAt: new Date('2026-05-14T10:00:02.000Z'),
      isFavorite: true,
      visibility: AssetVisibility.Timeline,
    });
    await ctx.newExif({
      assetId: asset.id,
      dateTimeOriginal: new Date('2026-05-14T10:00:00.000Z'),
      city: 'Berlin',
      state: 'Berlin',
      country: 'Germany',
      make: 'Canon',
      model: 'R5',
      lensModel: 'RF 35mm',
      latitude: 52.52,
      longitude: 13.405,
      rating: 5,
    });
    const tag = await ctx.get(TagRepository).upsertValue({ userId: user.id, value: 'travel' });
    await ctx.newTagAsset({ tagIds: [tag.id], assetIds: [asset.id] });
    await ctx.newAssetFile({ assetId: asset.id, type: AssetFileType.Preview, path: 'preview.jpg' });

    const [result] = await sut.getAgentMetadataByIds([asset.id]);

    expect(result).toMatchObject({
      id: asset.id,
      ownerId: user.id,
      type: asset.type,
      originalFileName: 'IMG_0001.jpg',
      localDateTime: new Date('2026-05-14T10:00:00.000Z'),
      fileCreatedAt: new Date('2026-05-14T10:00:01.000Z'),
      fileModifiedAt: new Date('2026-05-14T10:00:02.000Z'),
      isFavorite: true,
      visibility: AssetVisibility.Timeline,
      exifInfo: expect.objectContaining({
        dateTimeOriginal: new Date('2026-05-14T10:00:00.000Z'),
        city: 'Berlin',
        state: 'Berlin',
        country: 'Germany',
        make: 'Canon',
        model: 'R5',
        lensModel: 'RF 35mm',
        latitude: 52.52,
        longitude: 13.405,
        rating: 5,
      }),
      tags: [expect.objectContaining({ id: tag.id, value: 'travel' })],
    });
    expect(result).not.toHaveProperty('originalPath');
    expect(result).not.toHaveProperty('checksum');
    expect(result).not.toHaveProperty('files');
    expect(result).not.toHaveProperty('faces');
  });
});

describe('getAgentLockedIds', () => {
  it('returns only requested assets with locked visibility', async () => {
    const { ctx, sut } = setup();
    const { user } = await ctx.newUser();
    const { asset: timelineAsset } = await ctx.newAsset({
      ownerId: user.id,
      visibility: AssetVisibility.Timeline,
    });
    const { asset: lockedAsset } = await ctx.newAsset({
      ownerId: user.id,
      visibility: AssetVisibility.Locked,
    });

    await expect(sut.getAgentLockedIds(new Set([timelineAsset.id, lockedAsset.id, factory.uuid()]))).resolves.toEqual(
      new Set([lockedAsset.id]),
    );
  });
});
```

- [ ] **Step 5: Run asset repository tests to verify they fail**

Run:

```bash
pnpm --dir server test:medium asset.repository.spec.ts -t "getAgent"
```

Expected: FAIL because `AssetRepository.getAgentMetadataByIds()` and `AssetRepository.getAgentLockedIds()` do not exist yet.

- [ ] **Step 6: Add narrow asset metadata and locked-visibility queries**

Modify `server/src/repositories/asset.repository.ts` near `getByIdsWithAllRelationsButStacks()`:

```ts
  @GenerateSql({ params: [DummyValue.UUID_SET] })
  @ChunkedSet()
  async getAgentLockedIds(ids: Set<string>): Promise<Set<string>> {
    if (ids.size === 0) {
      return new Set();
    }

    const results = await this.db
      .selectFrom('asset')
      .select('asset.id')
      .where('asset.id', 'in', [...ids])
      .where('asset.visibility', '=', AssetVisibility.Locked)
      .execute();

    return new Set(results.map(({ id }) => id));
  }

  @GenerateSql({ params: [[DummyValue.UUID]] })
  @ChunkedArray()
  getAgentMetadataByIds(ids: string[]) {
    return this.db
      .selectFrom('asset')
      .select([
        'asset.id',
        'asset.ownerId',
        'asset.type',
        'asset.originalFileName',
        'asset.localDateTime',
        'asset.fileCreatedAt',
        'asset.fileModifiedAt',
        'asset.isFavorite',
        'asset.visibility',
      ])
      .select(withTags)
      .$call(withExif)
      .where('asset.id', '=', anyUuid(ids))
      .execute();
  }
```

Update the `server/src/repositories/asset.repository.ts` decorator import:

```ts
import { Chunked, ChunkedArray, ChunkedSet, DummyValue, GenerateSql } from 'src/decorators';
```

Modify `server/test/repositories/asset.repository.mock.ts`:

```ts
getAgentLockedIds: vitest.fn().mockResolvedValue(new Set()),
getAgentMetadataByIds: vitest.fn().mockResolvedValue([]),
```

- [ ] **Step 7: Run repository tests to verify they pass**

Run:

```bash
pnpm --dir server test:medium agent-tool-call.repository.spec.ts
pnpm --dir server test:medium asset.repository.spec.ts -t "getAgent"
```

Expected: PASS.

- [ ] **Step 8: Commit repository work**

```bash
git add server/src/repositories/agent-tool-call.repository.ts server/test/medium/specs/repositories/agent-tool-call.repository.spec.ts server/src/repositories/index.ts server/src/repositories/asset.repository.ts server/test/medium/specs/repositories/asset.repository.spec.ts server/test/repositories/asset.repository.mock.ts
git commit -m "feat: persist agent tool call audits"
```

## Task 3: Internal Tool Gate Service

**Files:**

- Create: `server/src/services/agent-tool.service.ts`
- Create: `server/src/services/agent-tool.service.spec.ts`
- Modify: `server/src/services/index.ts`

- [ ] **Step 1: Write failing service tests**

Create `server/src/services/agent-tool.service.spec.ts` with these test cases:

```ts
import { BadRequestException } from '@nestjs/common';
import {
  AgentApprovalMode,
  AgentPermissionPreset,
  AgentProviderType,
  AgentSessionStatus,
  AgentToolApprovalDecision,
  AgentToolCallStatus,
  AgentToolDataClass,
  AgentToolName,
  AssetType,
  AssetVisibility,
} from 'src/enum';
import { AgentSessionRepository } from 'src/repositories/agent-session.repository';
import { AgentToolCallRepository } from 'src/repositories/agent-tool-call.repository';
import { AssetRepository } from 'src/repositories/asset.repository';
import { AgentToolService } from 'src/services/agent-tool.service';
import { AgentSession } from 'src/database';
import { AssetFactory } from 'test/factories/asset.factory';
import { AuthFactory } from 'test/factories/auth.factory';
import { newAccessRepositoryMock } from 'test/repositories/access.repository.mock';
import { newAssetRepositoryMock } from 'test/repositories/asset.repository.mock';
import { factory } from 'test/small.factory';
import { automock } from 'test/utils';

const auth = AuthFactory.create();
const assetId = factory.uuid();
const sessionId = factory.uuid();
const toolCallId = factory.uuid();
const now = new Date('2026-05-14T12:00:00.000Z');

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
    maxAssetsPerToolCall: 2,
    maxAssetsPerSession: 10,
    maxPreviewsPerToolCall: 0,
    maxOriginalsPerToolCall: 0,
    expiresInMinutes: 60,
  },
};

const session = {
  id: sessionId,
  userId: auth.user.id,
  providerCredentialId: factory.uuid(),
  credentialSnapshot: {
    id: factory.uuid(),
    providerType: AgentProviderType.OpenAI,
    label: 'OpenAI personal',
    baseUrl: null,
    models: ['gpt-5.1'],
    defaultModel: 'gpt-5.1',
  },
  modelSnapshot: { providerCredentialId: factory.uuid(), model: 'gpt-5.1' },
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
  updateId: factory.uuid(),
} satisfies AgentSession;

const pendingToolCall = {
  id: toolCallId,
  sessionId,
  toolName: AgentToolName.ReadAssetMetadata,
  status: AgentToolCallStatus.PendingApproval,
  approvalDecision: null,
  requestSummary: 'Read metadata for 1 asset',
  responseSummary: null,
  redactedRequestMetadata: { assetIds: [assetId] },
  redactedResponseMetadata: null,
  dataClass: AgentToolDataClass.Metadata,
  assetCount: 1,
  albumCount: 0,
  providerSnapshot: {
    providerCredentialId: session.providerCredentialId,
    providerType: AgentProviderType.OpenAI,
    label: 'OpenAI personal',
    baseUrl: null,
    model: 'gpt-5.1',
  },
  startedAt: now,
  completedAt: null,
  error: null,
};

describe(AgentToolService.name, () => {
  let sut: AgentToolService;
  let accessRepository: ReturnType<typeof newAccessRepositoryMock>;
  let assetRepository: ReturnType<typeof newAssetRepositoryMock>;
  let sessionRepository: ReturnType<typeof automock<AgentSessionRepository>>;
  let toolCallRepository: ReturnType<typeof automock<AgentToolCallRepository>>;

  beforeEach(() => {
    accessRepository = newAccessRepositoryMock();
    assetRepository = newAssetRepositoryMock();
    sessionRepository = automock(AgentSessionRepository, { args: [{} as never] });
    toolCallRepository = automock(AgentToolCallRepository, { args: [{} as never] });
    sut = new AgentToolService(
      accessRepository as never,
      assetRepository as unknown as AssetRepository,
      sessionRepository,
      toolCallRepository,
    );

    sessionRepository.getById.mockResolvedValue(session);
    sessionRepository.update.mockResolvedValue({ ...session, status: AgentSessionStatus.WaitingForToolApproval });
    toolCallRepository.create.mockResolvedValue(pendingToolCall);
    toolCallRepository.getCountedAssetCountBySession.mockResolvedValue(0);
    toolCallRepository.transition.mockImplementation(async (_sessionId, _id, _expectedStatus, dto) => ({
      ...pendingToolCall,
      ...dto,
    }));
    accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set([assetId]));
  });

  it('returns approval-required and writes a pending audit row for strict metadata reads', async () => {
    const result = await sut.readAssetMetadata(auth, sessionId, { assetIds: [assetId] });

    expect(result.status).toBe('approval-required');
    expect(toolCallRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId,
        toolName: AgentToolName.ReadAssetMetadata,
        status: AgentToolCallStatus.PendingApproval,
        redactedRequestMetadata: { assetIds: [assetId] },
        dataClass: AgentToolDataClass.Metadata,
        assetCount: 1,
      }),
    );
    expect(sessionRepository.update).toHaveBeenCalledWith(auth.user.id, sessionId, {
      status: AgentSessionStatus.WaitingForToolApproval,
    });
  });

  it('persists a denied audit row when metadata reads are disabled by the session policy', async () => {
    sessionRepository.getById.mockResolvedValue({
      ...session,
      permissionPlanSnapshot: {
        ...permissionPlanSnapshot,
        read: { ...permissionPlanSnapshot.read, metadata: false },
      },
    });
    toolCallRepository.create.mockResolvedValue({
      ...pendingToolCall,
      status: AgentToolCallStatus.Denied,
      approvalDecision: AgentToolApprovalDecision.Denied,
      completedAt: now,
      error: 'Session policy does not allow metadata reads',
    });

    const result = await sut.readAssetMetadata(auth, sessionId, { assetIds: [assetId] });

    expect(result.status).toBe('denied');
    expect(result.reason).toBe('Session policy does not allow metadata reads');
    expect(assetRepository.getAgentMetadataByIds).not.toHaveBeenCalled();
  });

  it('denies inaccessible assets before creating a pending approval', async () => {
    accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set());
    toolCallRepository.create.mockResolvedValue({
      ...pendingToolCall,
      status: AgentToolCallStatus.Denied,
      approvalDecision: AgentToolApprovalDecision.Denied,
      completedAt: now,
      error: 'Not found or no asset.read access',
    });

    const result = await sut.readAssetMetadata(auth, sessionId, { assetIds: [assetId] });

    expect(result.status).toBe('denied');
    expect(result.reason).toBe('Not found or no asset.read access');
  });

  it('denies metadata reads when provider exposure disables metadata', async () => {
    sessionRepository.getById.mockResolvedValue({
      ...session,
      permissionPlanSnapshot: {
        ...permissionPlanSnapshot,
        providerExposure: { ...permissionPlanSnapshot.providerExposure, metadata: false },
      },
    });
    toolCallRepository.create.mockResolvedValue({
      ...pendingToolCall,
      status: AgentToolCallStatus.Denied,
      approvalDecision: AgentToolApprovalDecision.Denied,
      completedAt: now,
      error: 'Session policy does not allow metadata reads',
    });

    const result = await sut.readAssetMetadata(auth, sessionId, { assetIds: [assetId] });

    expect(result.status).toBe('denied');
    expect(assetRepository.getAgentMetadataByIds).not.toHaveBeenCalled();
  });

  it('denies metadata requests above the per-tool asset limit before checking access', async () => {
    const result = await sut.readAssetMetadata(auth, sessionId, {
      assetIds: [assetId, factory.uuid(), factory.uuid()],
    });

    expect(result.status).toBe('denied');
    expect(result.reason).toBe('Session policy allows at most 2 assets per metadata tool call');
    expect(accessRepository.asset.checkOwnerAccess).not.toHaveBeenCalled();
  });

  it('denies metadata requests above the per-session asset limit before checking access', async () => {
    toolCallRepository.getCountedAssetCountBySession.mockResolvedValue(9);

    const result = await sut.readAssetMetadata(auth, sessionId, { assetIds: [assetId, factory.uuid()] });

    expect(result.status).toBe('denied');
    expect(result.reason).toBe('Session policy allows at most 10 assets per session');
    expect(toolCallRepository.getCountedAssetCountBySession).toHaveBeenCalledWith(sessionId);
    expect(accessRepository.asset.checkOwnerAccess).not.toHaveBeenCalled();
  });

  it('allows shared-space assets only when the session asset scope enables shared spaces', async () => {
    accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set());
    accessRepository.asset.checkSpaceAccess.mockResolvedValue(new Set([assetId]));
    sessionRepository.getById.mockResolvedValue({
      ...session,
      permissionPlanSnapshot: {
        ...permissionPlanSnapshot,
        assetScope: { owned: false, sharedSpaces: true, locked: false },
      },
    });

    const result = await sut.readAssetMetadata(auth, sessionId, { assetIds: [assetId] });

    expect(result.status).toBe('approval-required');
    expect(accessRepository.asset.checkAlbumAccess).not.toHaveBeenCalled();
    expect(accessRepository.asset.checkPartnerAccess).not.toHaveBeenCalled();
    expect(assetRepository.getAgentLockedIds).toHaveBeenCalledWith(new Set([assetId]));
  });

  it('denies shared-space locked assets unless elevated locked access is enabled', async () => {
    accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set());
    accessRepository.asset.checkSpaceAccess.mockResolvedValue(new Set([assetId]));
    assetRepository.getAgentLockedIds.mockResolvedValue(new Set([assetId]));
    sessionRepository.getById.mockResolvedValue({
      ...session,
      permissionPlanSnapshot: {
        ...permissionPlanSnapshot,
        assetScope: { owned: false, sharedSpaces: true, locked: false },
      },
    });
    toolCallRepository.create.mockResolvedValue({
      ...pendingToolCall,
      status: AgentToolCallStatus.Denied,
      approvalDecision: AgentToolApprovalDecision.Denied,
      completedAt: now,
      error: 'Not found or no asset.read access',
    });

    const result = await sut.readAssetMetadata(auth, sessionId, { assetIds: [assetId] });

    expect(result.status).toBe('denied');
    expect(result.reason).toBe('Not found or no asset.read access');
  });

  it('allows shared-space locked assets when the plan allows locked assets and auth is elevated', async () => {
    const elevatedAuth = AuthFactory.from({ id: auth.user.id }).session({ hasElevatedPermission: true }).build();
    accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set());
    accessRepository.asset.checkSpaceAccess.mockResolvedValue(new Set([assetId]));
    sessionRepository.getById.mockResolvedValue({
      ...session,
      permissionPlanSnapshot: {
        ...permissionPlanSnapshot,
        assetScope: { owned: false, sharedSpaces: true, locked: true },
      },
    });

    const result = await sut.readAssetMetadata(elevatedAuth, sessionId, { assetIds: [assetId] });

    expect(result.status).toBe('approval-required');
    expect(assetRepository.getAgentLockedIds).not.toHaveBeenCalled();
  });

  it('passes elevated locked access only when the plan allows locked assets and auth is elevated', async () => {
    const elevatedAuth = AuthFactory.from({ id: auth.user.id }).session({ hasElevatedPermission: true }).build();
    sessionRepository.getById.mockResolvedValue({
      ...session,
      permissionPlanSnapshot: {
        ...permissionPlanSnapshot,
        assetScope: { owned: true, sharedSpaces: false, locked: true },
      },
    });

    await sut.readAssetMetadata(elevatedAuth, sessionId, { assetIds: [assetId] });

    expect(accessRepository.asset.checkOwnerAccess).toHaveBeenCalledWith(
      elevatedAuth.user.id,
      new Set([assetId]),
      true,
    );
  });

  it('lists historical tool calls for owned sessions even after the session is completed', async () => {
    sessionRepository.getById.mockResolvedValue({ ...session, status: AgentSessionStatus.Completed });
    toolCallRepository.getBySessionId.mockResolvedValue([pendingToolCall]);

    const result = await sut.getToolCalls(auth, sessionId);

    expect(result).toMatchObject([{ id: toolCallId }]);
    expect(toolCallRepository.getBySessionId).toHaveBeenCalledWith(sessionId);
  });

  it('approves pending tool calls', async () => {
    toolCallRepository.getByIdForSession.mockResolvedValue(pendingToolCall);

    const result = await sut.approveToolCall(auth, sessionId, toolCallId, {
      decision: AgentToolApprovalDecision.Approved,
    });

    expect(result.status).toBe(AgentToolCallStatus.Approved);
    expect(toolCallRepository.transition).toHaveBeenCalledWith(
      sessionId,
      toolCallId,
      AgentToolCallStatus.PendingApproval,
      {
        status: AgentToolCallStatus.Approved,
        approvalDecision: AgentToolApprovalDecision.Approved,
        responseSummary: 'Tool call approved by user',
        redactedResponseMetadata: null,
        completedAt: null,
        error: null,
      },
    );
    expect(sessionRepository.update).toHaveBeenCalledWith(auth.user.id, sessionId, {
      status: AgentSessionStatus.Running,
    });
  });

  it('denies pending tool calls', async () => {
    toolCallRepository.getByIdForSession.mockResolvedValue(pendingToolCall);

    const result = await sut.approveToolCall(auth, sessionId, toolCallId, {
      decision: AgentToolApprovalDecision.Denied,
      reason: 'Private photos',
    });

    expect(result.status).toBe(AgentToolCallStatus.Denied);
    expect(toolCallRepository.transition).toHaveBeenCalledWith(
      sessionId,
      toolCallId,
      AgentToolCallStatus.PendingApproval,
      {
        status: AgentToolCallStatus.Denied,
        approvalDecision: AgentToolApprovalDecision.Denied,
        responseSummary: null,
        redactedResponseMetadata: null,
        completedAt: expect.any(Date),
        error: 'Private photos',
      },
    );
    expect(sessionRepository.update).toHaveBeenCalledWith(auth.user.id, sessionId, {
      status: AgentSessionStatus.Running,
    });
  });

  it('rejects approval decisions for tool calls that are no longer pending', async () => {
    toolCallRepository.getByIdForSession.mockResolvedValue({
      ...pendingToolCall,
      status: AgentToolCallStatus.Approved,
      approvalDecision: AgentToolApprovalDecision.Approved,
    });

    await expect(
      sut.approveToolCall(auth, sessionId, toolCallId, { decision: AgentToolApprovalDecision.Approved }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(toolCallRepository.transition).not.toHaveBeenCalled();
  });

  it('executes an approved metadata request and writes response audit metadata', async () => {
    toolCallRepository.getByIdForSession.mockResolvedValue({
      ...pendingToolCall,
      status: AgentToolCallStatus.Approved,
      approvalDecision: AgentToolApprovalDecision.Approved,
    });
    const asset = AssetFactory.create({
      id: assetId,
      ownerId: auth.user.id,
      type: AssetType.Image,
      visibility: AssetVisibility.Timeline,
      originalFileName: 'IMG_0001.jpg',
      isFavorite: true,
    });
    assetRepository.getAgentMetadataByIds.mockResolvedValue([
      {
        ...asset,
        exifInfo: {
          ...asset.exifInfo,
          dateTimeOriginal: new Date('2026-05-14T10:00:00.000Z'),
          city: 'Berlin',
          state: 'Berlin',
          country: 'Germany',
          make: 'Canon',
          model: 'R5',
          lensModel: 'RF 35mm',
          latitude: 52.52,
          longitude: 13.405,
          rating: 5,
        },
        tags: [{ id: factory.uuid(), value: 'travel', color: null }],
      },
    ]);

    const result = await sut.readAssetMetadata(auth, sessionId, { toolCallId });

    expect(result.status).toBe('success');
    expect(result.assets).toMatchObject([{ id: assetId, originalFileName: 'IMG_0001.jpg' }]);
    expect(toolCallRepository.getCountedAssetCountBySession).toHaveBeenCalledWith(sessionId, toolCallId);
    expect(toolCallRepository.transition).toHaveBeenNthCalledWith(
      1,
      sessionId,
      toolCallId,
      AgentToolCallStatus.Approved,
      {
        status: AgentToolCallStatus.Executing,
        approvalDecision: AgentToolApprovalDecision.Approved,
        responseSummary: 'Tool call execution started',
        redactedResponseMetadata: null,
        completedAt: null,
        error: null,
      },
    );
    expect(toolCallRepository.transition).toHaveBeenNthCalledWith(
      2,
      sessionId,
      toolCallId,
      AgentToolCallStatus.Executing,
      {
        status: AgentToolCallStatus.Completed,
        approvalDecision: AgentToolApprovalDecision.Approved,
        responseSummary: 'Returned metadata for 1 asset',
        redactedResponseMetadata: { assetIds: [assetId] },
        completedAt: expect.any(Date),
        error: null,
      },
    );
  });

  it('does not read asset metadata when an approved call was already claimed by another execution', async () => {
    toolCallRepository.getByIdForSession.mockResolvedValue({
      ...pendingToolCall,
      status: AgentToolCallStatus.Approved,
      approvalDecision: AgentToolApprovalDecision.Approved,
    });
    toolCallRepository.transition.mockResolvedValueOnce(undefined);

    await expect(sut.readAssetMetadata(auth, sessionId, { toolCallId })).rejects.toBeInstanceOf(BadRequestException);

    expect(assetRepository.getAgentMetadataByIds).not.toHaveBeenCalled();
  });

  it('revalidates asset access after approval and records denial if access drifted', async () => {
    toolCallRepository.getByIdForSession.mockResolvedValue({
      ...pendingToolCall,
      status: AgentToolCallStatus.Approved,
      approvalDecision: AgentToolApprovalDecision.Approved,
    });
    accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set());

    const result = await sut.readAssetMetadata(auth, sessionId, { toolCallId });

    expect(result.status).toBe('denied');
    expect(assetRepository.getAgentMetadataByIds).not.toHaveBeenCalled();
    expect(toolCallRepository.transition).toHaveBeenNthCalledWith(
      2,
      sessionId,
      toolCallId,
      AgentToolCallStatus.Executing,
      {
        status: AgentToolCallStatus.Denied,
        approvalDecision: AgentToolApprovalDecision.Denied,
        responseSummary: null,
        redactedResponseMetadata: null,
        completedAt: expect.any(Date),
        error: 'Not found or no asset.read access',
      },
    );
    expect(sessionRepository.update).toHaveBeenCalledWith(auth.user.id, sessionId, {
      status: AgentSessionStatus.Running,
    });
  });

  it('revalidates per-session asset limits after approval and records denial if the limit drifted', async () => {
    toolCallRepository.getByIdForSession.mockResolvedValue({
      ...pendingToolCall,
      status: AgentToolCallStatus.Approved,
      approvalDecision: AgentToolApprovalDecision.Approved,
    });
    toolCallRepository.getCountedAssetCountBySession.mockResolvedValue(10);

    const result = await sut.readAssetMetadata(auth, sessionId, { toolCallId });

    expect(result.status).toBe('denied');
    expect(result.reason).toBe('Session policy allows at most 10 assets per session');
    expect(assetRepository.getAgentMetadataByIds).not.toHaveBeenCalled();
    expect(toolCallRepository.transition).toHaveBeenNthCalledWith(
      2,
      sessionId,
      toolCallId,
      AgentToolCallStatus.Executing,
      {
        status: AgentToolCallStatus.Denied,
        approvalDecision: AgentToolApprovalDecision.Denied,
        responseSummary: null,
        redactedResponseMetadata: null,
        completedAt: expect.any(Date),
        error: 'Session policy allows at most 10 assets per session',
      },
    );
    expect(sessionRepository.update).toHaveBeenCalledWith(auth.user.id, sessionId, {
      status: AgentSessionStatus.Running,
    });
  });

  it('fails an approved metadata call when an asset disappears after access revalidation', async () => {
    toolCallRepository.getByIdForSession.mockResolvedValue({
      ...pendingToolCall,
      status: AgentToolCallStatus.Approved,
      approvalDecision: AgentToolApprovalDecision.Approved,
    });
    assetRepository.getAgentMetadataByIds.mockResolvedValue([]);

    const result = await sut.readAssetMetadata(auth, sessionId, { toolCallId });

    expect(result.status).toBe('denied');
    expect(result.reason).toBe('One or more assets were not found during metadata read');
    expect(toolCallRepository.transition).toHaveBeenNthCalledWith(
      2,
      sessionId,
      toolCallId,
      AgentToolCallStatus.Executing,
      {
        status: AgentToolCallStatus.Failed,
        approvalDecision: AgentToolApprovalDecision.Approved,
        responseSummary: null,
        redactedResponseMetadata: { assetIds: [] },
        completedAt: expect.any(Date),
        error: 'One or more assets were not found during metadata read',
      },
    );
    expect(sessionRepository.update).toHaveBeenCalledWith(auth.user.id, sessionId, {
      status: AgentSessionStatus.Running,
    });
  });

  it('marks the tool call failed and restores the session when metadata retrieval throws', async () => {
    toolCallRepository.getByIdForSession.mockResolvedValue({
      ...pendingToolCall,
      status: AgentToolCallStatus.Approved,
      approvalDecision: AgentToolApprovalDecision.Approved,
    });
    assetRepository.getAgentMetadataByIds.mockRejectedValue(new Error('database unavailable'));

    const result = await sut.readAssetMetadata(auth, sessionId, { toolCallId });

    expect(result.status).toBe('denied');
    expect(result.reason).toBe('Metadata read failed');
    expect(toolCallRepository.transition).toHaveBeenNthCalledWith(
      2,
      sessionId,
      toolCallId,
      AgentToolCallStatus.Executing,
      {
        status: AgentToolCallStatus.Failed,
        approvalDecision: AgentToolApprovalDecision.Approved,
        responseSummary: null,
        redactedResponseMetadata: null,
        completedAt: expect.any(Date),
        error: 'Metadata read failed',
      },
    );
    expect(sessionRepository.update).toHaveBeenCalledWith(auth.user.id, sessionId, {
      status: AgentSessionStatus.Running,
    });
  });

  it('rejects missing sessions', async () => {
    sessionRepository.getById.mockResolvedValue(undefined);

    await expect(sut.readAssetMetadata(auth, sessionId, { assetIds: [assetId] })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});
```

- [ ] **Step 2: Run service tests to verify they fail**

Run:

```bash
pnpm --dir server test src/services/agent-tool.service.spec.ts
```

Expected: FAIL because `AgentToolService` is not implemented.

- [ ] **Step 3: Implement service**

Create `server/src/services/agent-tool.service.ts`:

```ts
import { BadRequestException, Injectable } from '@nestjs/common';
import { AgentSession, AgentToolCall } from 'src/database';
import {
  AgentReadAssetMetadataToolRequestDto,
  AgentReadAssetMetadataToolResponseDto,
  AgentToolApprovalDto,
  AgentToolCallResponseDto,
} from 'src/dtos/agent-tool.dto';
import { AuthDto } from 'src/dtos/auth.dto';
import {
  AgentApprovalMode,
  AgentSessionStatus,
  AgentToolApprovalDecision,
  AgentToolCallStatus,
  AgentToolDataClass,
  AgentToolName,
  Permission,
} from 'src/enum';
import { AccessRepository } from 'src/repositories/access.repository';
import { AgentSessionRepository } from 'src/repositories/agent-session.repository';
import { AgentToolCallRepository } from 'src/repositories/agent-tool-call.repository';
import { AssetRepository } from 'src/repositories/asset.repository';
import { AgentAssetMetadata, AgentToolProviderSnapshot } from 'src/types/agent-tool.types';
import { setIsEqual } from 'src/utils/set';

type AgentMetadataAsset = Awaited<ReturnType<AssetRepository['getAgentMetadataByIds']>>[number];

@Injectable()
export class AgentToolService {
  private static readonly activeStatuses = [
    AgentSessionStatus.Created,
    AgentSessionStatus.Running,
    AgentSessionStatus.WaitingForToolApproval,
    AgentSessionStatus.Interrupted,
  ];

  constructor(
    private readonly accessRepository: AccessRepository,
    private readonly assetRepository: AssetRepository,
    private readonly sessionRepository: AgentSessionRepository,
    private readonly toolCallRepository: AgentToolCallRepository,
  ) {}

  async readAssetMetadata(
    auth: AuthDto,
    sessionId: string,
    dto: AgentReadAssetMetadataToolRequestDto,
  ): Promise<AgentReadAssetMetadataToolResponseDto> {
    const session = await this.getOwnedSession(auth, sessionId);

    if (dto.toolCallId) {
      return this.executeApprovedReadAssetMetadata(auth, session, dto.toolCallId);
    }

    const assetIds = dto.assetIds ?? [];
    const requestSummary = this.readMetadataSummary(assetIds.length);
    const denialReason = await this.getReadMetadataDenialReason(auth, session, assetIds);
    if (denialReason) {
      const toolCall = await this.toolCallRepository.create({
        sessionId: session.id,
        toolName: AgentToolName.ReadAssetMetadata,
        status: AgentToolCallStatus.Denied,
        approvalDecision: AgentToolApprovalDecision.Denied,
        requestSummary,
        responseSummary: null,
        redactedRequestMetadata: { assetIds },
        redactedResponseMetadata: null,
        dataClass: AgentToolDataClass.Metadata,
        assetCount: assetIds.length,
        albumCount: 0,
        providerSnapshot: this.getProviderSnapshot(session),
        completedAt: new Date(),
        error: denialReason,
      });

      return { status: 'denied', reason: denialReason, toolCall: this.mapToolCall(toolCall) };
    }

    const toolCall = await this.toolCallRepository.create({
      sessionId: session.id,
      toolName: AgentToolName.ReadAssetMetadata,
      status: AgentToolCallStatus.PendingApproval,
      approvalDecision: null,
      requestSummary,
      responseSummary: null,
      redactedRequestMetadata: { assetIds },
      redactedResponseMetadata: null,
      dataClass: AgentToolDataClass.Metadata,
      assetCount: assetIds.length,
      albumCount: 0,
      providerSnapshot: this.getProviderSnapshot(session),
      completedAt: null,
      error: null,
    });

    await this.sessionRepository.update(auth.user.id, session.id, {
      status: AgentSessionStatus.WaitingForToolApproval,
    });

    return { status: 'approval-required', toolCall: this.mapToolCall(toolCall) };
  }

  async getToolCalls(auth: AuthDto, sessionId: string): Promise<AgentToolCallResponseDto[]> {
    const session = await this.getOwnedSession(auth, sessionId, { requireActive: false });
    const toolCalls = await this.toolCallRepository.getBySessionId(session.id);
    return toolCalls.map((toolCall) => this.mapToolCall(toolCall));
  }

  async approveToolCall(
    auth: AuthDto,
    sessionId: string,
    toolCallId: string,
    dto: AgentToolApprovalDto,
  ): Promise<AgentToolCallResponseDto> {
    const session = await this.getOwnedSession(auth, sessionId);
    const toolCall = await this.getToolCallForSession(session.id, toolCallId);

    if (toolCall.status !== AgentToolCallStatus.PendingApproval) {
      throw new BadRequestException('Agent tool call is not pending approval');
    }

    if (dto.decision === AgentToolApprovalDecision.Denied) {
      const updated = await this.toolCallRepository.transition(
        session.id,
        toolCall.id,
        AgentToolCallStatus.PendingApproval,
        {
          status: AgentToolCallStatus.Denied,
          approvalDecision: AgentToolApprovalDecision.Denied,
          responseSummary: null,
          redactedResponseMetadata: null,
          completedAt: new Date(),
          error: dto.reason ?? 'Denied by user',
        },
      );
      if (!updated) {
        throw new BadRequestException('Agent tool call is not pending approval');
      }
      await this.sessionRepository.update(auth.user.id, session.id, { status: AgentSessionStatus.Running });
      return this.mapToolCall(updated);
    }

    const updated = await this.toolCallRepository.transition(
      session.id,
      toolCall.id,
      AgentToolCallStatus.PendingApproval,
      {
        status: AgentToolCallStatus.Approved,
        approvalDecision: AgentToolApprovalDecision.Approved,
        responseSummary: 'Tool call approved by user',
        redactedResponseMetadata: null,
        completedAt: null,
        error: null,
      },
    );
    if (!updated) {
      throw new BadRequestException('Agent tool call is not pending approval');
    }

    await this.sessionRepository.update(auth.user.id, session.id, { status: AgentSessionStatus.Running });
    return this.mapToolCall(updated);
  }

  private async executeApprovedReadAssetMetadata(
    auth: AuthDto,
    session: AgentSession,
    toolCallId: string,
  ): Promise<AgentReadAssetMetadataToolResponseDto> {
    const toolCall = await this.getToolCallForSession(session.id, toolCallId);
    const assetIds = toolCall.redactedRequestMetadata.assetIds;

    if (toolCall.status === AgentToolCallStatus.Denied) {
      return {
        status: 'denied',
        reason: toolCall.error ?? 'Tool call was denied',
        toolCall: this.mapToolCall(toolCall),
      };
    }

    if (toolCall.status !== AgentToolCallStatus.Approved) {
      throw new BadRequestException('Agent tool call has not been approved');
    }

    const executing = await this.toolCallRepository.transition(session.id, toolCall.id, AgentToolCallStatus.Approved, {
      status: AgentToolCallStatus.Executing,
      approvalDecision: AgentToolApprovalDecision.Approved,
      responseSummary: 'Tool call execution started',
      redactedResponseMetadata: null,
      completedAt: null,
      error: null,
    });
    if (!executing) {
      throw new BadRequestException('Agent tool call is already executing or completed');
    }

    try {
      const denialReason = await this.getReadMetadataDenialReason(auth, session, assetIds, {
        excludedToolCallId: toolCall.id,
      });
      if (denialReason) {
        const denied = await this.toolCallRepository.transition(
          session.id,
          toolCall.id,
          AgentToolCallStatus.Executing,
          {
            status: AgentToolCallStatus.Denied,
            approvalDecision: AgentToolApprovalDecision.Denied,
            responseSummary: null,
            redactedResponseMetadata: null,
            completedAt: new Date(),
            error: denialReason,
          },
        );
        if (!denied) {
          throw new BadRequestException('Agent tool call is already completed');
        }
        await this.sessionRepository.update(auth.user.id, session.id, { status: AgentSessionStatus.Running });
        return { status: 'denied', reason: denialReason, toolCall: this.mapToolCall(denied) };
      }

      const assets = await this.assetRepository.getAgentMetadataByIds(assetIds);
      const orderedAssets = this.orderAssets(assetIds, assets).map((asset) => this.mapAssetMetadata(asset));
      if (orderedAssets.length !== assetIds.length) {
        const failed = await this.toolCallRepository.transition(
          session.id,
          toolCall.id,
          AgentToolCallStatus.Executing,
          {
            status: AgentToolCallStatus.Failed,
            approvalDecision: AgentToolApprovalDecision.Approved,
            responseSummary: null,
            redactedResponseMetadata: { assetIds: orderedAssets.map((asset) => asset.id) },
            completedAt: new Date(),
            error: 'One or more assets were not found during metadata read',
          },
        );
        if (!failed) {
          throw new BadRequestException('Agent tool call is already completed');
        }
        await this.sessionRepository.update(auth.user.id, session.id, { status: AgentSessionStatus.Running });
        return {
          status: 'denied',
          reason: 'One or more assets were not found during metadata read',
          toolCall: this.mapToolCall(failed),
        };
      }

      const updated = await this.toolCallRepository.transition(session.id, toolCall.id, AgentToolCallStatus.Executing, {
        status: AgentToolCallStatus.Completed,
        approvalDecision: AgentToolApprovalDecision.Approved,
        responseSummary: this.readMetadataResponseSummary(orderedAssets.length),
        redactedResponseMetadata: { assetIds },
        completedAt: new Date(),
        error: null,
      });
      if (!updated) {
        throw new BadRequestException('Agent tool call is already completed');
      }
      await this.sessionRepository.update(auth.user.id, session.id, { status: AgentSessionStatus.Running });

      return { status: 'success', toolCall: this.mapToolCall(updated), assets: orderedAssets };
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }

      const failed = await this.toolCallRepository.transition(session.id, toolCall.id, AgentToolCallStatus.Executing, {
        status: AgentToolCallStatus.Failed,
        approvalDecision: AgentToolApprovalDecision.Approved,
        responseSummary: null,
        redactedResponseMetadata: null,
        completedAt: new Date(),
        error: 'Metadata read failed',
      });
      if (!failed) {
        throw new BadRequestException('Agent tool call is already completed');
      }
      await this.sessionRepository.update(auth.user.id, session.id, { status: AgentSessionStatus.Running });
      return { status: 'denied', reason: 'Metadata read failed', toolCall: this.mapToolCall(failed) };
    }
  }

  private async getOwnedSession(
    auth: AuthDto,
    sessionId: string,
    options: { requireActive?: boolean } = {},
  ): Promise<AgentSession> {
    const session = await this.sessionRepository.getById(auth.user.id, sessionId);
    if (!session) {
      throw new BadRequestException('Agent session not found');
    }

    if (options.requireActive !== false && !AgentToolService.activeStatuses.includes(session.status)) {
      throw new BadRequestException('Agent session does not accept tool calls');
    }

    return session;
  }

  private async getToolCallForSession(sessionId: string, toolCallId: string): Promise<AgentToolCall> {
    const toolCall = await this.toolCallRepository.getByIdForSession(sessionId, toolCallId);
    if (!toolCall) {
      throw new BadRequestException('Agent tool call not found');
    }

    if (toolCall.toolName !== AgentToolName.ReadAssetMetadata) {
      throw new BadRequestException('Agent tool call does not match readAssetMetadata');
    }

    return toolCall;
  }

  private async getReadMetadataDenialReason(
    auth: AuthDto,
    session: AgentSession,
    assetIds: string[],
    options: { excludedToolCallId?: string } = {},
  ): Promise<string | null> {
    const plan = session.permissionPlanSnapshot;

    if (session.approvalMode !== AgentApprovalMode.Strict) {
      return 'Only strict approval mode is supported for metadata tools in this slice';
    }

    if (!plan.read.metadata || !plan.providerExposure.metadata) {
      return 'Session policy does not allow metadata reads';
    }

    if (assetIds.length > plan.limits.maxAssetsPerToolCall) {
      return `Session policy allows at most ${plan.limits.maxAssetsPerToolCall} assets per metadata tool call`;
    }

    const countedAssetCount = await this.toolCallRepository.getCountedAssetCountBySession(
      session.id,
      options.excludedToolCallId,
    );
    if (countedAssetCount + assetIds.length > plan.limits.maxAssetsPerSession) {
      return `Session policy allows at most ${plan.limits.maxAssetsPerSession} assets per session`;
    }

    const requestedIds = new Set(assetIds);
    const allowLockedAssets = plan.assetScope.locked && auth.session?.hasElevatedPermission === true;
    const ownerAccess = plan.assetScope.owned
      ? await this.accessRepository.asset.checkOwnerAccess(auth.user.id, requestedIds, allowLockedAssets)
      : new Set<string>();

    if (!plan.assetScope.sharedSpaces) {
      return setIsEqual(requestedIds, ownerAccess) ? null : `Not found or no ${Permission.AssetRead} access`;
    }

    const spaceAccess = await this.accessRepository.asset.checkSpaceAccess(auth.user.id, requestedIds);
    const readableIds = new Set([...ownerAccess, ...spaceAccess]);
    if (!allowLockedAssets) {
      const lockedIds = await this.assetRepository.getAgentLockedIds(readableIds);
      for (const lockedId of lockedIds) {
        readableIds.delete(lockedId);
      }
    }

    return setIsEqual(requestedIds, readableIds) ? null : `Not found or no ${Permission.AssetRead} access`;
  }

  private getProviderSnapshot(session: AgentSession): AgentToolProviderSnapshot {
    return {
      providerCredentialId: session.providerCredentialId,
      providerType: session.credentialSnapshot.providerType,
      label: session.credentialSnapshot.label,
      baseUrl: session.credentialSnapshot.baseUrl,
      model: session.modelSnapshot.model,
    };
  }

  private orderAssets(assetIds: string[], assets: AgentMetadataAsset[]): AgentMetadataAsset[] {
    const byId = new Map(assets.map((asset) => [asset.id, asset]));
    return assetIds.map((id) => byId.get(id)).filter((asset): asset is AgentMetadataAsset => Boolean(asset));
  }

  private mapAssetMetadata(asset: AgentMetadataAsset): AgentAssetMetadata {
    return {
      id: asset.id,
      ownerId: asset.ownerId,
      type: asset.type,
      originalFileName: asset.originalFileName,
      localDateTime: asset.localDateTime,
      fileCreatedAt: asset.fileCreatedAt,
      fileModifiedAt: asset.fileModifiedAt,
      isFavorite: asset.isFavorite,
      visibility: asset.visibility,
      exifInfo: asset.exifInfo
        ? {
            dateTimeOriginal: asset.exifInfo.dateTimeOriginal,
            city: asset.exifInfo.city,
            state: asset.exifInfo.state,
            country: asset.exifInfo.country,
            make: asset.exifInfo.make,
            model: asset.exifInfo.model,
            lensModel: asset.exifInfo.lensModel,
            latitude: asset.exifInfo.latitude,
            longitude: asset.exifInfo.longitude,
            rating: asset.exifInfo.rating,
          }
        : null,
      tags: asset.tags.map((tag) => ({ id: tag.id, value: tag.value, color: tag.color })),
    };
  }

  private mapToolCall(toolCall: AgentToolCall): AgentToolCallResponseDto {
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

  private readMetadataSummary(assetCount: number): string {
    return `Read metadata for ${assetCount} ${assetCount === 1 ? 'asset' : 'assets'}`;
  }

  private readMetadataResponseSummary(assetCount: number): string {
    return `Returned metadata for ${assetCount} ${assetCount === 1 ? 'asset' : 'assets'}`;
  }
}
```

Modify `server/src/services/index.ts`:

```ts
import { AgentToolService } from 'src/services/agent-tool.service';
```

Add `AgentToolService` to `services` immediately after `AgentSessionService`.

- [ ] **Step 4: Run service tests to verify they pass**

Run:

```bash
pnpm --dir server test src/services/agent-tool.service.spec.ts
```

Expected: PASS.

- [ ] **Step 5: Commit service work**

```bash
git add server/src/services/agent-tool.service.ts server/src/services/agent-tool.service.spec.ts server/src/services/index.ts
git commit -m "feat: add strict agent metadata tool gate"
```

## Task 4: Internal Controller Routes

**Files:**

- Create: `server/src/controllers/agent-tool.controller.ts`
- Create: `server/src/controllers/agent-tool.controller.spec.ts`
- Modify: `server/src/controllers/index.ts`

- [ ] **Step 1: Write failing controller tests**

Create `server/src/controllers/agent-tool.controller.spec.ts`:

```ts
import { AgentToolController } from 'src/controllers/agent-tool.controller';
import {
  AgentReadAssetMetadataToolResponseDto,
  AgentToolApprovalDto,
  AgentToolCallResponseDto,
} from 'src/dtos/agent-tool.dto';
import {
  AgentToolApprovalDecision,
  AgentToolCallStatus,
  AgentToolDataClass,
  AgentToolName,
  Permission,
} from 'src/enum';
import { AgentToolService } from 'src/services/agent-tool.service';
import request from 'supertest';
import { AuthFactory } from 'test/factories/auth.factory';
import { factory } from 'test/small.factory';
import { automock, ControllerContext, controllerSetup } from 'test/utils';

describe(AgentToolController.name, () => {
  let ctx: ControllerContext;
  const service = automock(AgentToolService, {
    args: [{} as never, {} as never, {} as never, {} as never],
    strict: false,
  });
  const auth = AuthFactory.create();
  const sessionId = factory.uuid();
  const toolCallId = factory.uuid();
  const assetId = factory.uuid();
  const now = new Date('2026-05-14T12:00:00.000Z');
  const toolCall: AgentToolCallResponseDto = {
    id: toolCallId,
    sessionId,
    toolName: AgentToolName.ReadAssetMetadata,
    status: AgentToolCallStatus.PendingApproval,
    approvalDecision: null,
    requestSummary: 'Read metadata for 1 asset',
    responseSummary: null,
    dataClass: AgentToolDataClass.Metadata,
    assetCount: 1,
    albumCount: 0,
    startedAt: now,
    completedAt: null,
    error: null,
  };
  const approvalRequired: AgentReadAssetMetadataToolResponseDto = {
    status: 'approval-required',
    toolCall,
  };

  beforeAll(async () => {
    ctx = await controllerSetup(AgentToolController, [{ provide: AgentToolService, useValue: service }]);
    return () => ctx.close();
  });

  beforeEach(() => {
    service.resetAllMocks();
    ctx.reset();
    ctx.authenticate.mockResolvedValue(auth);
  });

  const expectPermission = (permission: Permission) => {
    expect(ctx.authenticate).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({ permission }),
      }),
    );
  };

  it('requires session update permission for metadata tool requests', async () => {
    service.readAssetMetadata.mockResolvedValue(approvalRequired);

    await request(ctx.getHttpServer())
      .post(`/agent/sessions/${sessionId}/tools/read-asset-metadata`)
      .send({
        assetIds: [assetId],
      });

    expect(ctx.authenticate).toHaveBeenCalled();
    expectPermission(Permission.AgentSessionUpdate);
  });

  it('calls the service for metadata tool requests and serializes dates', async () => {
    service.readAssetMetadata.mockResolvedValue(approvalRequired);

    const { status, body } = await request(ctx.getHttpServer())
      .post(`/agent/sessions/${sessionId}/tools/read-asset-metadata`)
      .send({ assetIds: [assetId] });

    expect(status).toBe(201);
    expect(service.readAssetMetadata).toHaveBeenCalledWith(auth, sessionId, { assetIds: [assetId] });
    expect(body.toolCall.startedAt).toBe(now.toISOString());
  });

  it('validates metadata tool request bodies', async () => {
    const { status, body } = await request(ctx.getHttpServer())
      .post(`/agent/sessions/${sessionId}/tools/read-asset-metadata`)
      .send({});

    expect(status).toBe(400);
    expect(body).toEqual(
      factory.responses.badRequest(['Provide assetIds for a new tool request or toolCallId for an approved request']),
    );
  });

  it('requires session read permission for listing tool calls', async () => {
    service.getToolCalls.mockResolvedValue([toolCall]);

    await request(ctx.getHttpServer()).get(`/agent/sessions/${sessionId}/tool-calls`);

    expect(service.getToolCalls).toHaveBeenCalledWith(auth, sessionId);
    expectPermission(Permission.AgentSessionRead);
  });

  it('requires session update permission for approvals', async () => {
    const approved = {
      ...toolCall,
      status: AgentToolCallStatus.Approved,
      approvalDecision: AgentToolApprovalDecision.Approved,
    };
    service.approveToolCall.mockResolvedValue(approved);

    await request(ctx.getHttpServer())
      .post(`/agent/sessions/${sessionId}/tool-calls/${toolCallId}/approval`)
      .send({
        decision: AgentToolApprovalDecision.Approved,
      } satisfies AgentToolApprovalDto);

    expect(service.approveToolCall).toHaveBeenCalledWith(auth, sessionId, toolCallId, {
      decision: AgentToolApprovalDecision.Approved,
    });
    expectPermission(Permission.AgentSessionUpdate);
  });
});
```

- [ ] **Step 2: Run controller tests to verify they fail**

Run:

```bash
pnpm --dir server test src/controllers/agent-tool.controller.spec.ts
```

Expected: FAIL because `AgentToolController` does not exist.

- [ ] **Step 3: Implement controller**

Create `server/src/controllers/agent-tool.controller.ts`:

```ts
import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Endpoint, HistoryBuilder } from 'src/decorators';
import {
  AgentReadAssetMetadataToolRequestDto,
  AgentReadAssetMetadataToolResponseDto,
  AgentToolApprovalDto,
  AgentToolCallParamsDto,
  AgentToolCallResponseDto,
} from 'src/dtos/agent-tool.dto';
import { AuthDto } from 'src/dtos/auth.dto';
import { ApiTag, Permission } from 'src/enum';
import { Auth, Authenticated } from 'src/middleware/auth.guard';
import { AgentToolService } from 'src/services/agent-tool.service';
import { UUIDParamDto } from 'src/validation';

@ApiTags(ApiTag.AgentSessions)
@Controller('agent/sessions/:id')
export class AgentToolController {
  constructor(private readonly service: AgentToolService) {}

  @Post('tools/read-asset-metadata')
  @Authenticated({ permission: Permission.AgentSessionUpdate })
  @Endpoint({
    summary: 'Execute the internal readAssetMetadata agent tool',
    description:
      'Internal route for requesting or resuming a strict-approved metadata read tool call for an AI agent session.',
    history: new HistoryBuilder().added('v2.7.5').internal('v2.7.5'),
  })
  readAssetMetadata(
    @Auth() auth: AuthDto,
    @Param() { id }: UUIDParamDto,
    @Body() dto: AgentReadAssetMetadataToolRequestDto,
  ): Promise<AgentReadAssetMetadataToolResponseDto> {
    return this.service.readAssetMetadata(auth, id, dto);
  }

  @Get('tool-calls')
  @Authenticated({ permission: Permission.AgentSessionRead })
  @Endpoint({
    summary: 'List agent tool calls',
    description: 'List audited internal tool calls for an AI agent session owned by the current user.',
    history: new HistoryBuilder().added('v2.7.5').alpha('v2.7.5'),
  })
  getToolCalls(@Auth() auth: AuthDto, @Param() { id }: UUIDParamDto): Promise<AgentToolCallResponseDto[]> {
    return this.service.getToolCalls(auth, id);
  }

  @Post('tool-calls/:toolCallId/approval')
  @Authenticated({ permission: Permission.AgentSessionUpdate })
  @Endpoint({
    summary: 'Approve or deny an agent tool call',
    description: 'Record an explicit user approval decision for a pending internal agent tool call.',
    history: new HistoryBuilder().added('v2.7.5').alpha('v2.7.5'),
  })
  approveToolCall(
    @Auth() auth: AuthDto,
    @Param() { id, toolCallId }: AgentToolCallParamsDto,
    @Body() dto: AgentToolApprovalDto,
  ): Promise<AgentToolCallResponseDto> {
    return this.service.approveToolCall(auth, id, toolCallId, dto);
  }
}
```

Modify `server/src/controllers/index.ts`:

```ts
import { AgentToolController } from 'src/controllers/agent-tool.controller';
```

Add `AgentToolController` to `controllers` immediately after `AgentSessionController`.

- [ ] **Step 4: Run controller tests to verify they pass**

Run:

```bash
pnpm --dir server test src/controllers/agent-tool.controller.spec.ts
```

Expected: PASS.

- [ ] **Step 5: Commit controller work**

```bash
git add server/src/controllers/agent-tool.controller.ts server/src/controllers/agent-tool.controller.spec.ts server/src/controllers/index.ts
git commit -m "feat: expose internal agent tool gate routes"
```

## Task 5: Generated Artifacts, Revert Script, And Verification

**Files:**

- Modify: `scripts/revert-to-immich.sql`
- Modify: generated OpenAPI/SDK files changed by `make open-api-typescript`
- Modify: generated SQL snapshots changed by server checks

- [ ] **Step 1: Update revert script**

Modify `scripts/revert-to-immich.sql`.

Drop order must remove `agent_tool_call` before `agent_session`:

```sql
DROP TABLE IF EXISTS "agent_tool_call" CASCADE;
DROP TABLE IF EXISTS "agent_message" CASCADE;
DROP TABLE IF EXISTS "agent_session" CASCADE;
DROP TABLE IF EXISTS "agent_provider_credential" CASCADE;
```

Add the migration timestamp/name to the migration cleanup block:

```sql
1778900000000, 'AgentToolCall'
```

Update sanity checks that list fork-only tables so they include:

```sql
'agent_provider_credential', 'agent_session', 'agent_message', 'agent_tool_call'
```

- [ ] **Step 2: Generate OpenAPI and SDK artifacts**

Run:

```bash
make open-api-typescript
```

Expected: generated OpenAPI and TypeScript SDK files include:

- `AgentReadAssetMetadataToolRequestDto`
- `AgentReadAssetMetadataToolResponseDto`
- `AgentToolApprovalDto`
- `AgentToolCallResponseDto`
- internal `readAssetMetadata` route
- approval and list routes

- [ ] **Step 3: Generate SQL snapshots**

Run:

```bash
pnpm --dir server check
```

Expected: PASS, or generated SQL query snapshots update for:

- `agent.tool.call.repository.sql`
- `asset.repository.sql` with `getAgentMetadataByIds` and `getAgentLockedIds`

If snapshots changed, inspect them and stage only the expected generated files.

- [ ] **Step 4: Run targeted test suite**

Run:

```bash
pnpm --dir server test src/dtos/agent-tool.dto.spec.ts
pnpm --dir server test src/services/agent-tool.service.spec.ts
pnpm --dir server test src/controllers/agent-tool.controller.spec.ts
pnpm --dir server test:medium agent-tool-call.repository.spec.ts
pnpm --dir server test:medium asset.repository.spec.ts -t "getAgent"
```

Expected: PASS.

- [ ] **Step 5: Run related regression tests**

Run:

```bash
pnpm --dir server test src/services/agent-session.service.spec.ts src/services/agent-message.service.spec.ts src/controllers/agent-session.controller.spec.ts src/controllers/agent-message.controller.spec.ts
pnpm --dir server test:medium agent-session.repository.spec.ts agent-message.repository.spec.ts
```

Expected: PASS.

- [ ] **Step 6: Verify migration ordering**

Run:

```bash
ls server/src/schema/migrations | rg 'Agent|17789'
```

Expected output includes the agent migrations in this order:

```text
1777000000000-AgentProviderCredential.ts
1777100000000-AgentSession.ts
1778778147082-AddAgentSessionProviderCredentialIndex.ts
1778800000000-AgentMessage.ts
1778900000000-AgentToolCall.ts
```

- [ ] **Step 7: Commit generated and verification work**

```bash
git add scripts/revert-to-immich.sql server/src/queries open-api web/src/lib/api open-api/typescript-sdk
git commit -m "chore: update agent tool generated artifacts"
```

If generated paths differ in this branch, use `git status --short` after `make open-api-typescript` and stage only generated OpenAPI/SDK/query outputs plus `scripts/revert-to-immich.sql`.

## Self-Review

- Spec coverage: this plan covers slice 5 from the approved design: one metadata read tool, session policy gate, strict approval requirement, atomic `agent_tool_call` audit transitions, access checks, approvals, denials, and audit persistence.
- Deferred scope: Pi runtime, runner authentication, streaming, grants, YOLO reads, previews/originals, album tools, planning tables, and UI are left to later roadmap slices.
- Type consistency: tool name/status/decision/data-class enums are shared across table, DTOs, repository, service, and controller.
- Security: request and response audit metadata store asset ids and summaries only; no previews, originals, media bytes, provider secrets, or full model prompts are stored. `assetScope.sharedSpaces` is intentionally limited to shared-space access, not shared albums or partner timelines, and locked shared-space assets are filtered unless `assetScope.locked` is enabled and the auth session is elevated.
- Testing: DTO, repository, service, controller, generated check, and related session/message regressions are included. Repository tests cover guarded audit transitions, session isolation, cascade deletion, counted per-session asset totals, the real metadata query/redaction shape for exif, tags, and excluded media/original fields, and locked-asset visibility detection. Service tests cover duplicate prevention through DTOs, policy read/exposure denial, per-tool and per-session asset limits, shared-space-only scope, locked shared-space denial without elevated scope, elevated locked access, historical audit listing, approval/denial session resume, non-pending approval rejection, execution claim races, approval-time access and session-limit drift, missing assets after revalidation, repository failure handling, and missing sessions.
