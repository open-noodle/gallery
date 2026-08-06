# Pi Agent MCP Minimal Context Slice 7 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add session-scoped large-selection handles so Pi can plan against hundreds or thousands of search results without copying every asset ID through model context.

**Architecture:** Persist ordered, deduplicated asset ID snapshots in a new `agent_selection_handle` table keyed by session and user. `searchAssets` can mint a handle and return only a compact handle summary plus samples, while planning DTOs accept `assetSelectionHandleId` and `AgentOperationPlanService` materializes asset IDs server-side before normal plan validation, review, sparse selection, and apply.

**Tech Stack:** NestJS services and DTOs, Kysely repositories, sql-tools schema/migrations, Vitest unit and medium repository tests, generated MCP docs and runner prompt cheat sheet.

---

## Scope

Slice 7 implements only:

- persisted server-side selection handles for asset ID snapshots;
- `searchAssets` support for creating a handle from the current bounded result;
- planning-operation input support for `assetSelectionHandleId` as an alternative to explicit `assetIds`;
- server-side handle resolution before plan persistence, validation, review, sparse item selection, and apply;
- compact audit/tool metadata that records handle counts and samples instead of full handle-derived asset IDs;
- denied preparation audit metadata that records attempted selection handle IDs for unavailable, empty, or over-limit handles;
- MCP contract, generated prompt, and generated docs updates that teach Pi to use handles for large selections.

Slice 7 does not implement:

- a direct write/apply MCP tool;
- cross-session reusable handles;
- handles for unbounded "all photos" searches across every page;
- thumbnail eager-loading changes beyond tests proving the plan response still carries asset IDs and no media refs.

## Decisions

- A handle represents the **current bounded search result page**. If `hasMore` is true, Pi must page or narrow before claiming it covers all matching photos.
- `searchAssets` adds `createSelectionHandle?: boolean`. When false or omitted, response behavior is unchanged.
- When `createSelectionHandle` is true, `searchAssets` stores the full returned page's ordered unique asset IDs, returns `selectionHandle`, and keeps top-level `assetIds` compact by returning at most `sampleSize` IDs, defaulting to 25. This avoids sending thousands of IDs back through MCP while still giving Pi examples for explanation.
- Planning operations add `assetSelectionHandleId?: string` for every operation that currently needs `assetIds`. The operation must provide exactly one of `assetIds` or `assetSelectionHandleId`.
- Plans persist materialized `assetIds` in `agent_operation` so the existing plan review UI, sparse item selection, field overrides, apply path, and applied-plan history continue to work.
- Handle rows store ordered unique IDs in JSONB. This is acceptable for thousands of UUIDs and keeps the slice small; the context win comes from not sending those IDs through MCP.
- Handles expire using `createdAt + permissionPlanSnapshot.limits.expiresInMinutes`. Repository resolution checks `expiresAt > now`.
- Permission checks happen twice: handle lookup checks same user/session/expiry, then `AgentOperationPlanService.validateNormalAccess()` and `validateApplyAccess()` re-check current asset access before persistence/apply.

## Files

- Create: `server/src/schema/tables/agent-selection-handle.table.ts`
- Modify: `server/src/schema/index.ts`
- Modify: `server/src/database.ts`
- Create: `server/src/schema/migrations/1778950000000-AgentSelectionHandle.ts`
- Create: `server/src/repositories/agent-selection-handle.repository.ts`
- Create: `server/src/queries/agent.selection.handle.repository.sql`
- Modify: `server/src/repositories/index.ts`
- Create: `server/test/medium/specs/repositories/agent-selection-handle.repository.spec.ts`
- Modify: `server/src/dtos/agent-tool.dto.ts`
- Modify: `server/src/dtos/agent-tool.dto.spec.ts`
- Modify: `server/src/types/agent-tool.types.ts`
- Modify: `server/src/types/agent-operation.types.ts`
- Modify: `server/src/dtos/agent-operation.dto.ts`
- Modify: `server/src/dtos/agent-operation.dto.spec.ts`
- Modify: `server/src/services/agent-tool.service.ts`
- Modify: `server/src/services/agent-tool.service.spec.ts`
- Modify: `server/src/services/agent-operation-plan.service.ts`
- Modify: `server/src/services/agent-operation-plan.service.spec.ts`
- Modify: `server/src/services/agent-mcp-tool-contract.service.ts`
- Modify: `server/src/services/agent-mcp-tool-contract.service.spec.ts`
- Modify: `server/src/services/agent-mcp-prompt.service.ts`
- Modify: `server/src/services/agent-mcp-prompt.service.spec.ts`
- Modify: `server/src/services/agent-mcp-docs.service.ts`
- Modify: `server/src/services/agent-mcp-docs.service.spec.ts`
- Regenerate: `agent-runner/src/generated/gallery-mcp-prompt-cheat-sheet.mjs`
- Regenerate: `docs/superpowers/generated/pi-agent-mcp-tools.md`

## Task 1: Persist Selection Handles

**Files:**

- Create: `server/src/schema/tables/agent-selection-handle.table.ts`
- Modify: `server/src/schema/index.ts`
- Modify: `server/src/database.ts`
- Create: `server/src/schema/migrations/1778950000000-AgentSelectionHandle.ts`
- Create: `server/src/repositories/agent-selection-handle.repository.ts`
- Create: `server/src/queries/agent.selection.handle.repository.sql`
- Create: `server/test/medium/specs/repositories/agent-selection-handle.repository.spec.ts`

- [x] **Step 1: Write failing repository tests**

Create `server/test/medium/specs/repositories/agent-selection-handle.repository.spec.ts`:

```ts
import { Kysely } from 'kysely';
import { AgentApprovalMode, AgentPermissionPreset, AgentProviderType } from 'src/enum';
import { AgentProviderCredentialRepository } from 'src/repositories/agent-provider-credential.repository';
import { AgentSelectionHandleRepository } from 'src/repositories/agent-selection-handle.repository';
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
    maxAssetsPerToolCall: 10_000,
    maxAssetsPerSession: 10_000,
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
    database,
    credentialRepository: new AgentProviderCredentialRepository(database),
    sessionRepository: new AgentSessionRepository(database),
    sut: new AgentSelectionHandleRepository(database),
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

describe(AgentSelectionHandleRepository.name, () => {
  it('creates ordered unique session/user-scoped handles with samples and expiry', async () => {
    const { ctx, credentialRepository, sessionRepository, sut } = setup();
    const { user, session } = await createSession(ctx, credentialRepository, sessionRepository);
    const first = factory.uuid();
    const second = factory.uuid();
    const expiresAt = new Date('2026-05-21T12:30:00.000Z');

    const handle = await sut.create({
      sessionId: session.id,
      userId: user.id,
      sourceToolCallId: null,
      assetIds: [first, second, first],
      expiresAt,
    });

    expect(handle).toMatchObject({
      sessionId: session.id,
      userId: user.id,
      assetIds: [first, second],
      assetCount: 2,
      sampleAssetIds: [first, second],
      expiresAt,
    });
  });

  it('resolves only for the same session and user before expiry', async () => {
    const { ctx, credentialRepository, sessionRepository, sut } = setup();
    const { user, session } = await createSession(ctx, credentialRepository, sessionRepository);
    const other = await createSession(ctx, credentialRepository, sessionRepository);
    const assetIds = [factory.uuid(), factory.uuid()];
    const handle = await sut.create({
      sessionId: session.id,
      userId: user.id,
      sourceToolCallId: null,
      assetIds,
      expiresAt: new Date('2026-05-21T12:30:00.000Z'),
    });

    await expect(
      sut.getValidForPlanning({
        id: handle.id,
        sessionId: session.id,
        userId: user.id,
        now: new Date('2026-05-21T12:00:00.000Z'),
      }),
    ).resolves.toMatchObject({ id: handle.id, assetIds });

    await expect(
      sut.getValidForPlanning({
        id: handle.id,
        sessionId: other.session.id,
        userId: user.id,
        now: new Date('2026-05-21T12:00:00.000Z'),
      }),
    ).resolves.toBeUndefined();

    await expect(
      sut.getValidForPlanning({
        id: handle.id,
        sessionId: session.id,
        userId: other.user.id,
        now: new Date('2026-05-21T12:00:00.000Z'),
      }),
    ).resolves.toBeUndefined();

    await expect(
      sut.getValidForPlanning({
        id: handle.id,
        sessionId: session.id,
        userId: user.id,
        now: new Date('2026-05-21T12:30:00.000Z'),
      }),
    ).resolves.toBeUndefined();
  });

  it('handles thousands of assets deterministically without expanding samples', async () => {
    const { ctx, credentialRepository, sessionRepository, sut } = setup();
    const { user, session } = await createSession(ctx, credentialRepository, sessionRepository);
    const assetIds = Array.from({ length: 1500 }, () => factory.uuid());

    const handle = await sut.create({
      sessionId: session.id,
      userId: user.id,
      sourceToolCallId: null,
      assetIds,
      expiresAt: new Date('2026-05-21T12:30:00.000Z'),
    });

    expect(handle.assetCount).toBe(1500);
    expect(handle.sampleAssetIds).toEqual(assetIds.slice(0, 25));
    await expect(
      sut.getValidForPlanning({
        id: handle.id,
        sessionId: session.id,
        userId: user.id,
        now: new Date('2026-05-21T12:00:00.000Z'),
      }),
    ).resolves.toMatchObject({ assetIds });
  });
});
```

- [x] **Step 2: Run repository test and verify it fails**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.medium.mjs test/medium/specs/repositories/agent-selection-handle.repository.spec.ts
```

Expected: fails because `AgentSelectionHandleRepository` and the table do not exist.

- [x] **Step 3: Add schema table, migration, and DB typings**

Create `server/src/schema/tables/agent-selection-handle.table.ts`:

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
import { UpdateIdColumn } from 'src/decorators';
import { AgentSessionTable } from 'src/schema/tables/agent-session.table';
import { AgentToolCallTable } from 'src/schema/tables/agent-tool-call.table';
import { UserTable } from 'src/schema/tables/user.table';

@Table('agent_selection_handle')
@Index({ columns: ['sessionId', 'userId', 'expiresAt'] })
@Index({ columns: ['sourceToolCallId'] })
export class AgentSelectionHandleTable {
  @PrimaryGeneratedColumn()
  id!: Generated<string>;

  @ForeignKeyColumn(() => AgentSessionTable, { onUpdate: 'CASCADE', onDelete: 'CASCADE' })
  sessionId!: string;

  @ForeignKeyColumn(() => UserTable, { onUpdate: 'CASCADE', onDelete: 'CASCADE' })
  userId!: string;

  @ForeignKeyColumn(() => AgentToolCallTable, { onUpdate: 'CASCADE', onDelete: 'SET NULL', nullable: true })
  sourceToolCallId!: string | null;

  @Column({ type: 'jsonb' })
  assetIds!: string[];

  @Column({ type: 'integer' })
  assetCount!: number;

  @Column({ type: 'jsonb' })
  sampleAssetIds!: string[];

  @Column({ type: 'timestamp with time zone' })
  expiresAt!: Timestamp;

  @CreateDateColumn()
  createdAt!: Generated<Timestamp>;

  @UpdateIdColumn({ index: true })
  updateId!: Generated<string>;
}
```

Modify `server/src/schema/index.ts`:

```ts
import { AgentSelectionHandleTable } from 'src/schema/tables/agent-selection-handle.table';
```

Add `AgentSelectionHandleTable` to `ImmichDatabase.tables` next to other agent tables and add to `DB`:

```ts
agent_selection_handle: AgentSelectionHandleTable;
```

Modify `server/src/database.ts`:

```ts
import { AgentSelectionHandleTable } from 'src/schema/tables/agent-selection-handle.table';
export type AgentSelectionHandle = Selectable<AgentSelectionHandleTable>;
```

Create `server/src/schema/migrations/1778950000000-AgentSelectionHandle.ts`:

```ts
import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE "agent_selection_handle" (
      "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
      "sessionId" uuid NOT NULL,
      "userId" uuid NOT NULL,
      "sourceToolCallId" uuid,
      "assetIds" jsonb NOT NULL,
      "assetCount" integer NOT NULL,
      "sampleAssetIds" jsonb NOT NULL,
      "expiresAt" timestamp with time zone NOT NULL,
      "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
      "updateId" uuid NOT NULL DEFAULT immich_uuid_v7(),
      CONSTRAINT "agent_selection_handle_pkey" PRIMARY KEY ("id"),
      CONSTRAINT "agent_selection_handle_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "agent_session"("id") ON UPDATE CASCADE ON DELETE CASCADE,
      CONSTRAINT "agent_selection_handle_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON UPDATE CASCADE ON DELETE CASCADE,
      CONSTRAINT "agent_selection_handle_sourceToolCallId_fkey" FOREIGN KEY ("sourceToolCallId") REFERENCES "agent_tool_call"("id") ON UPDATE CASCADE ON DELETE SET NULL
    )
  `.execute(db);

  await sql`CREATE INDEX "agent_selection_handle_sessionId_userId_expiresAt_idx" ON "agent_selection_handle" ("sessionId", "userId", "expiresAt")`.execute(
    db,
  );
  await sql`CREATE INDEX "agent_selection_handle_sourceToolCallId_idx" ON "agent_selection_handle" ("sourceToolCallId")`.execute(
    db,
  );
  await sql`CREATE INDEX "agent_selection_handle_updateId_idx" ON "agent_selection_handle" ("updateId")`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP INDEX "agent_selection_handle_updateId_idx"`.execute(db);
  await sql`DROP INDEX "agent_selection_handle_sourceToolCallId_idx"`.execute(db);
  await sql`DROP INDEX "agent_selection_handle_sessionId_userId_expiresAt_idx"`.execute(db);
  await sql`DROP TABLE "agent_selection_handle"`.execute(db);
}
```

- [x] **Step 4: Implement repository**

Create `server/src/repositories/agent-selection-handle.repository.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { Kysely } from 'kysely';
import { InjectKysely } from 'nestjs-kysely';
import { columns } from 'src/database';
import { DummyValue, GenerateSql } from 'src/decorators';
import { DB } from 'src/schema';
import { asUuid } from 'src/utils/database';

const selectionHandleSampleSize = 25;

export type AgentSelectionHandleCreate = {
  sessionId: string;
  userId: string;
  sourceToolCallId: string | null;
  assetIds: string[];
  expiresAt: Date;
};

export type AgentSelectionHandleLookup = {
  id: string;
  sessionId: string;
  userId: string;
  now: Date;
};

@Injectable()
export class AgentSelectionHandleRepository {
  constructor(@InjectKysely() private db: Kysely<DB>) {}

  create(dto: AgentSelectionHandleCreate) {
    const assetIds = this.uniqueOrdered(dto.assetIds);

    return this.db
      .insertInto('agent_selection_handle')
      .values({
        sessionId: dto.sessionId,
        userId: dto.userId,
        sourceToolCallId: dto.sourceToolCallId,
        assetIds,
        assetCount: assetIds.length,
        sampleAssetIds: assetIds.slice(0, selectionHandleSampleSize),
        expiresAt: dto.expiresAt,
      })
      .returning(columns.agentSelectionHandle)
      .executeTakeFirstOrThrow();
  }

  @GenerateSql({ params: [DummyValue.UUID, DummyValue.UUID, DummyValue.UUID] })
  getValidForPlanning(dto: AgentSelectionHandleLookup) {
    return this.db
      .selectFrom('agent_selection_handle')
      .select(columns.agentSelectionHandle)
      .where('id', '=', asUuid(dto.id))
      .where('sessionId', '=', asUuid(dto.sessionId))
      .where('userId', '=', asUuid(dto.userId))
      .where('expiresAt', '>', dto.now)
      .executeTakeFirst();
  }

  private uniqueOrdered(assetIds: string[]) {
    return [...new Set(assetIds)];
  }
}
```

Modify `server/src/repositories/index.ts`:

```ts
import { AgentSelectionHandleRepository } from 'src/repositories/agent-selection-handle.repository';
```

Add `AgentSelectionHandleRepository` to the exported `repositories` array next to the other agent repositories so Nest can inject it into `AgentToolService` and `AgentOperationPlanService`.

- [x] **Step 5: Run repository test and verify it passes**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.medium.mjs test/medium/specs/repositories/agent-selection-handle.repository.spec.ts
```

Expected: passes.

## Task 2: Add DTO And Type Contract For Handles

**Files:**

- Modify: `server/src/dtos/agent-tool.dto.ts`
- Modify: `server/src/dtos/agent-tool.dto.spec.ts`
- Modify: `server/src/types/agent-tool.types.ts`
- Modify: `server/src/types/agent-operation.types.ts`
- Modify: `server/src/dtos/agent-operation.dto.ts`
- Modify: `server/src/dtos/agent-operation.dto.spec.ts`

- [x] **Step 1: Write failing DTO tests for search handle request/response**

In `server/src/dtos/agent-tool.dto.spec.ts`, add tests under `AgentSearchAssetsToolRequestDto`:

```ts
it('accepts search selection handle creation with compact samples', () => {
  const result = parseSearchAssetsRequest({
    filters: {},
    limit: 500,
    detail: 'ids',
    createSelectionHandle: true,
    sampleSize: 5,
  });

  expect(result.success).toBe(true);
  if (result.success) {
    expect(result.data).toMatchObject({
      limit: 500,
      detail: 'ids',
      createSelectionHandle: true,
      sampleSize: 5,
    });
  }
});
```

Add response encoding test near other `AgentSearchAssetsToolResponseDto` tests:

```ts
it('encodes search responses with compact selection handle summaries', () => {
  const assetIds = Array.from({ length: 3 }, () => factory.uuid());
  const handleId = factory.uuid();
  const toolCallId = factory.uuid();
  const response = {
    status: 'success' as const,
    toolCall: makeToolCall({ id: toolCallId, toolName: AgentToolName.SearchAssets }),
    summary: 'Created a selection handle for 3 assets',
    detail: 'ids' as const,
    assetIds: assetIds.slice(0, 1),
    returnedCount: 1,
    hasMore: false,
    nextPage: null,
    resultSize: makeResultSize({ returnedItems: 1 }),
    selectionHandle: {
      id: handleId,
      assetCount: 3,
      sampleAssetIds: assetIds.slice(0, 2),
      sourceToolCallId: toolCallId,
      expiresAt: new Date('2026-05-21T12:30:00.000Z'),
    },
  };

  const encoded = AgentSearchAssetsToolResponseDto.schema.safeEncode(response);

  expect(encoded.success).toBe(true);
  if (encoded.success) {
    expect(encoded.data.selectionHandle).toMatchObject({
      id: handleId,
      assetCount: 3,
      sampleAssetIds: assetIds.slice(0, 2),
      sourceToolCallId: toolCallId,
    });
    expect(encoded.data.assetIds).toEqual(assetIds.slice(0, 1));
  }
});
```

- [x] **Step 2: Write failing planning DTO tests for handle operations**

Create or extend `server/src/dtos/agent-operation.dto.spec.ts` with:

```ts
import { AgentProposeAlbumOperationsDto } from 'src/dtos/agent-operation.dto';
import { AgentOperationRiskLevel, AgentOperationTargetKind, AgentOperationType } from 'src/enum';
import { factory } from 'test/small.factory';

const parsePlan = (input: unknown) => AgentProposeAlbumOperationsDto.schema.safeParse(input);

describe('assetSelectionHandleId planning input', () => {
  it('accepts assetSelectionHandleId instead of explicit assetIds for asset-bearing operations', () => {
    const selectionHandleId = factory.uuid();
    const result = parsePlan({
      summary: 'Add handle-selected photos',
      operations: [
        {
          type: AgentOperationType.AlbumAddAssets,
          summary: 'Add selected photos',
          targetKind: AgentOperationTargetKind.ExistingAlbum,
          targetId: factory.uuid(),
          assetSelectionHandleId: selectionHandleId,
          riskLevel: AgentOperationRiskLevel.Medium,
          enabled: true,
          payload: {},
        },
      ],
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.operations[0]).toMatchObject({ assetSelectionHandleId: selectionHandleId });
      expect(result.data.operations[0]).not.toHaveProperty('assetIds');
    }
  });

  it('rejects operations that provide both assetIds and assetSelectionHandleId', () => {
    const result = parsePlan({
      summary: 'Invalid mixed selection',
      operations: [
        {
          type: AgentOperationType.AlbumAddAssets,
          summary: 'Add selected photos',
          targetKind: AgentOperationTargetKind.ExistingAlbum,
          targetId: factory.uuid(),
          assetIds: [factory.uuid()],
          assetSelectionHandleId: factory.uuid(),
          riskLevel: AgentOperationRiskLevel.Medium,
          enabled: true,
          payload: {},
        },
      ],
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.message)).toContain(
      'Provide either assetIds or assetSelectionHandleId, not both',
    );
  });

  it('rejects asset-bearing operations that provide neither assetIds nor assetSelectionHandleId', () => {
    const result = parsePlan({
      summary: 'Invalid missing selection',
      operations: [
        {
          type: AgentOperationType.SpaceAddAssets,
          summary: 'Add selected photos',
          targetKind: AgentOperationTargetKind.ExistingSpace,
          targetId: factory.uuid(),
          riskLevel: AgentOperationRiskLevel.Medium,
          enabled: true,
          payload: {},
        },
      ],
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.message)).toContain('Provide assetIds or assetSelectionHandleId');
  });
});
```

- [x] **Step 3: Run DTO tests and verify they fail**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/dtos/agent-tool.dto.spec.ts src/dtos/agent-operation.dto.spec.ts
```

Expected: fails because `createSelectionHandle`, `selectionHandle`, and `assetSelectionHandleId` are unknown.

- [x] **Step 4: Add DTO/type implementation**

Modify `server/src/types/agent-tool.types.ts`:

```ts
export type AgentSearchAssetsSelectionHandle = {
  id: string;
  assetCount: number;
  sampleAssetIds: string[];
  sourceToolCallId: string | null;
  expiresAt: Date;
};

export type AgentToolSearchAssetsRequestMetadata = {
  mode: AgentSearchAssetsMode;
  query?: string;
  filters: AgentSearchAssetsFilters;
  limit: number;
  page: number;
  order?: AgentSearchAssetsOrder;
  detail: AgentSearchAssetsDetail;
  fields: AgentSearchAssetsField[];
  sampleSize?: number;
  createSelectionHandle?: boolean;
};
```

Extend `AgentToolResponseIdsMetadata`:

```ts
selectionHandleIds?: string[];
selectionHandleAssetCount?: number;
selectionHandleSampleAssetIds?: string[];
```

Modify `AgentToolOperationPlanRequestMetadata`:

```ts
assetIds: string[];
assetCount?: number;
assetIdsSample?: string[];
selectionHandles?: Array<{
  id: string;
  assetCount: number;
  sampleAssetIds: string[];
}>;
```

Modify `server/src/types/agent-operation.types.ts`:

```ts
assetSelectionHandleId?: string;
```

Add it only to `AgentAlbumOperationInput`; `AgentOperationCreate` remains persisted `assetIds`.

Modify `server/src/dtos/agent-tool.dto.ts`:

```ts
createSelectionHandle: z.boolean().optional(),
```

Add `createSelectionHandle?: boolean` to the local `AgentSearchAssetsToolRequestOutput` type.

Include `createSelectionHandle` in `hasNewSearchFields` and transform output:

```ts
createSelectionHandle: value.createSelectionHandle ?? false,
```

Add response schema:

```ts
const AgentSearchAssetsSelectionHandleSchema = z
  .object({
    id: uuid,
    assetCount: z.number().int().min(0),
    sampleAssetIds: z.array(uuid).max(25),
    sourceToolCallId: uuid.nullable(),
    expiresAt: isoDatetimeToDate,
  })
  .meta({ id: 'AgentSearchAssetsSelectionHandle' });
```

Add to search success response:

```ts
selectionHandle: AgentSearchAssetsSelectionHandleSchema.optional(),
```

Modify `server/src/dtos/agent-operation.dto.ts`:

1. Add:

```ts
const assetSelectionHandleId = uuid;
const assetSelection = {
  assetIds: uniqueAssetIds.optional(),
  assetSelectionHandleId: assetSelectionHandleId.optional(),
};

const validateAssetSelection = (
  operation: { assetIds?: string[]; assetSelectionHandleId?: string },
  ctx: z.RefinementCtx,
) => {
  if (operation.assetIds && operation.assetSelectionHandleId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Provide either assetIds or assetSelectionHandleId, not both',
    });
  }

  if (!operation.assetIds && !operation.assetSelectionHandleId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Provide assetIds or assetSelectionHandleId',
    });
  }
};
```

2. Replace `assetIds: uniqueAssetIds` in album add/remove, space add/remove, cover, and `assetBatchBase` with `...assetSelection`.
3. In each schema's `superRefine`, call `validateAssetSelection(operation, ctx)` before the existing target validation.
4. Keep response schema unchanged except adding optional `assetSelectionHandleId` is not needed because persisted operations still return materialized `assetIds`.

- [x] **Step 5: Run DTO tests and verify they pass**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/dtos/agent-tool.dto.spec.ts src/dtos/agent-operation.dto.spec.ts
```

Expected: passes.

## Task 3: Mint Handles From `searchAssets`

**Files:**

- Modify: `server/src/services/agent-tool.service.ts`
- Modify: `server/src/services/agent-tool.service.spec.ts`

- [x] **Step 1: Write failing service tests for compact handle creation**

In `server/src/services/agent-tool.service.spec.ts`, add `AgentSelectionHandleRepository` import, mock setup, and constructor injection. Add tests near existing `searchAssets` tests:

```ts
it('searchAssets creates a selection handle and returns only compact sample ids when requested', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(now);
  const auth = AuthFactory.create();
  const assetIds = Array.from({ length: 60 }, () => newUuid());
  const session = makeSession({
    userId: auth.user.id,
    permissionPlanSnapshot: makePlan({ limits: { maxAssetsPerToolCall: 1000, maxAssetsPerSession: 1000 } }),
  });
  const handle = {
    id: newUuid(),
    sessionId: session.id,
    userId: auth.user.id,
    sourceToolCallId: newUuid(),
    assetIds,
    assetCount: assetIds.length,
    sampleAssetIds: assetIds.slice(0, 25),
    expiresAt: new Date(now.getTime() + 60 * 60_000),
    createdAt: now,
    updateId: newUuid(),
  };
  sessionRepository.getById.mockResolvedValue(session);
  searchRepository.searchMetadata.mockResolvedValue({
    items: assetIds.map((id) => ({ id })) as never,
    hasNextPage: false,
  });
  accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set(assetIds));
  assetRepository.getAgentReadableIds.mockResolvedValue(new Set(assetIds));
  selectionHandleRepository.create.mockResolvedValue(handle);
  toolCallRepository.createWithSessionLimit.mockResolvedValue({
    status: 'created',
    toolCall: makeToolCall({
      id: handle.sourceToolCallId!,
      sessionId: session.id,
      toolName: AgentToolName.SearchAssets,
    }),
  });
  toolCallRepository.transitionWithSessionLimit.mockResolvedValue({
    status: 'transitioned',
    toolCall: makeToolCall({
      id: handle.sourceToolCallId!,
      sessionId: session.id,
      toolName: AgentToolName.SearchAssets,
      status: AgentToolCallStatus.Completed,
      responseSummary: 'Created a selection handle for 60 assets',
      completedAt,
      redactedResponseMetadata: {
        selectionHandleIds: [handle.id],
        selectionHandleAssetCount: 60,
        selectionHandleSampleAssetIds: assetIds.slice(0, 25),
        resultSize: expect.any(Object),
      },
    }),
  });

  const result = await sut.searchAssets(auth, session.id, {
    filters: {},
    limit: 60,
    createSelectionHandle: true,
    sampleSize: 5,
  });

  expect(selectionHandleRepository.create).toHaveBeenCalledWith({
    sessionId: session.id,
    userId: auth.user.id,
    sourceToolCallId: handle.sourceToolCallId,
    assetIds,
    expiresAt: new Date(now.getTime() + 60 * 60_000),
  });
  expect(result.status).toBe('success');
  if (result.status === 'success') {
    expect(result.selectionHandle).toMatchObject({
      id: handle.id,
      assetCount: 60,
      sampleAssetIds: assetIds.slice(0, 25),
      sourceToolCallId: handle.sourceToolCallId,
    });
    expect(result.assetIds).toEqual(assetIds.slice(0, 5));
    expect(JSON.stringify(result)).not.toContain(assetIds[59]);
  }
  vi.useRealTimers();
});

it('searchAssets creates handles from budget-truncated search output without truncating handle counts', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(now);
  const auth = AuthFactory.create();
  const assetIds = Array.from({ length: 500 }, () => newUuid());
  const session = makeSession({
    userId: auth.user.id,
    permissionPlanSnapshot: makePlan({ limits: { maxAssetsPerToolCall: 1000, maxAssetsPerSession: 1000 } }),
  });
  sessionRepository.getById.mockResolvedValue(session);
  searchRepository.searchMetadata.mockResolvedValue({
    items: assetIds.map((id) => ({ id })) as never,
    hasNextPage: true,
  });
  accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set(assetIds));
  assetRepository.getAgentReadableIds.mockResolvedValue(new Set(assetIds));
  selectionHandleRepository.create.mockImplementation((dto) =>
    Promise.resolve({
      id: newUuid(),
      sessionId: dto.sessionId,
      userId: dto.userId,
      sourceToolCallId: dto.sourceToolCallId,
      assetIds: dto.assetIds,
      assetCount: dto.assetIds.length,
      sampleAssetIds: dto.assetIds.slice(0, 25),
      expiresAt: dto.expiresAt,
      createdAt: now,
      updateId: newUuid(),
    }),
  );
  vi.spyOn(sut as never, 'getReadToolResponseBudgetBytes').mockReturnValue(900);

  const result = await sut.searchAssets(auth, session.id, {
    filters: {},
    limit: 500,
    createSelectionHandle: true,
    sampleSize: 25,
  });

  expect(result.status).toBe('success');
  if (result.status === 'success') {
    expect(result.selectionHandle?.assetCount).toBe(500);
    expect(result.resultSize.truncated).toBe(true);
    expect(result.resultSize.omittedFields).toContain('assetIds');
  }
  vi.useRealTimers();
});
```

- [x] **Step 2: Run service tests and verify they fail**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-tool.service.spec.ts --testNamePattern "selection handle|budget-truncated search"
```

Expected: fails because `AgentToolService` does not inject/create selection handles.

- [x] **Step 3: Implement search handle creation**

Modify `server/src/services/agent-tool.service.ts`:

1. Inject repository:

```ts
import { AgentSelectionHandleRepository } from 'src/repositories/agent-selection-handle.repository';
```

Constructor:

```ts
private readonly selectionHandleRepository: AgentSelectionHandleRepository,
```

2. Extend the search descriptor result type with:

```ts
selectionHandle?: AgentSearchAssetsSelectionHandle;
```

3. Include `createSelectionHandle` in request metadata:

```ts
...(request.createSelectionHandle ? { createSelectionHandle: true } : {}),
```

4. In `execute`, accept `toolCallId`:

```ts
execute: async (auth, session, request, toolCallId) => {
```

5. After computing `assetIds` and `pageResult`, create the handle:

```ts
const selectionHandle = request.createSelectionHandle
  ? await this.selectionHandleRepository.create({
      sessionId: session.id,
      userId: auth.user.id,
      sourceToolCallId: toolCallId,
      assetIds,
      expiresAt: this.getSelectionHandleExpiresAt(session),
    })
  : undefined;
const compactAssetIds = selectionHandle && assetIds.length > 0 ? assetIds.slice(0, request.sampleSize ?? 25) : assetIds;
const pageResult = {
  detail,
  assetIds: compactAssetIds,
  returnedCount: compactAssetIds.length,
  hasMore: result.hasNextPage,
  nextPage: result.hasNextPage ? String(normalizedRequest.page + 1) : null,
  ...(selectionHandle
    ? {
        selectionHandle: {
          id: selectionHandle.id,
          assetCount: selectionHandle.assetCount,
          sampleAssetIds: selectionHandle.sampleAssetIds,
          sourceToolCallId: selectionHandle.sourceToolCallId,
          expiresAt: selectionHandle.expiresAt,
        },
      }
    : {}),
};
```

6. Add helper:

```ts
private getSelectionHandleExpiresAt(session: AgentSession) {
  const minutes = session.permissionPlanSnapshot.limits.expiresInMinutes;
  return new Date(Date.now() + minutes * 60_000);
}
```

Use `vi.setSystemTime(now)` in the search service tests that assert exact expiry values.

7. Update `responseSummary`, `responseMetadata`, `resultAssetCount`, and `resultSize`:

```ts
responseMetadata: (result) => ({
  ...(result.selectionHandle
    ? {
        selectionHandleIds: [result.selectionHandle.id],
        selectionHandleAssetCount: result.selectionHandle.assetCount,
        selectionHandleSampleAssetIds: result.selectionHandle.sampleAssetIds,
      }
    : { assetIds: result.assetIds }),
}),
resultAssetCount: (result) => result.selectionHandle?.assetCount ?? result.assetIds.length,
```

8. Update `getSearchAssetsResponseSummary()` to append:

```ts
selectionHandleAssetCount?: number;
```

and return `Created a selection handle for N assets; returned M sample asset ids` when present.

9. Update `truncateSearchAssetsResult()` so it preserves `selectionHandle` and never removes or rewrites `selectionHandle.assetCount`.

- [x] **Step 4: Run focused service tests and verify they pass**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-tool.service.spec.ts --testNamePattern "selection handle|budget-truncated search"
```

Expected: passes.

## Task 4: Materialize Handles In Planning Tools

**Files:**

- Modify: `server/src/services/agent-operation-plan.service.ts`
- Modify: `server/src/services/agent-operation-plan.service.spec.ts`

- [x] **Step 1: Write failing service tests for handle materialization and access**

In `server/src/services/agent-operation-plan.service.spec.ts`, add `AgentSelectionHandleRepository` import, mock setup, and constructor injection. Add tests:

```ts
it('materializes assetSelectionHandleId server-side before storing and reviewing a plan', async () => {
  const auth = AuthFactory.create();
  const session = makeSession({ userId: auth.user.id });
  const selectionHandleId = newUuid();
  const assetIds = Array.from({ length: 150 }, () => newUuid());
  const albumId = newUuid();
  sessionRepository.getById.mockResolvedValue(session);
  selectionHandleRepository.getValidForPlanning.mockResolvedValue({
    id: selectionHandleId,
    sessionId: session.id,
    userId: auth.user.id,
    sourceToolCallId: newUuid(),
    assetIds,
    assetCount: assetIds.length,
    sampleAssetIds: assetIds.slice(0, 25),
    expiresAt: new Date('2026-05-21T12:30:00.000Z'),
    createdAt: now,
    updateId: newUuid(),
  });
  accessRepository.album.checkOwnerAccess.mockResolvedValue(new Set([albumId]));
  accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set(assetIds));
  assetRepository.getAgentReadableIds.mockResolvedValue(new Set(assetIds));
  const createdPlan = makePlan({
    sessionId: session.id,
    operations: [
      makeOperation({
        type: AgentOperationType.AlbumAddAssets,
        targetKind: AgentOperationTargetKind.ExistingAlbum,
        targetId: albumId,
        temporaryTargetId: null,
        assetIds,
        payload: {},
      }),
    ],
  });
  planRepository.createReplacementRevision.mockResolvedValue(createdPlan);

  const result = await sut.proposeAlbumOperations(auth, session.id, {
    summary: 'Add selected photos',
    operations: [
      {
        type: AgentOperationType.AlbumAddAssets,
        summary: 'Add selected photos',
        targetKind: AgentOperationTargetKind.ExistingAlbum,
        targetId: albumId,
        assetSelectionHandleId: selectionHandleId,
        payload: {},
        riskLevel: AgentOperationRiskLevel.Medium,
        enabled: true,
      },
    ],
  });

  expect(selectionHandleRepository.getValidForPlanning).toHaveBeenCalledWith({
    id: selectionHandleId,
    sessionId: session.id,
    userId: auth.user.id,
    now: expect.any(Date),
  });
  expect(planRepository.createReplacementRevision).toHaveBeenCalledWith(
    session.id,
    expect.objectContaining({
      operations: [
        expect.objectContaining({
          assetIds,
          assetSelectionHandleId: undefined,
        }),
      ],
    }),
  );
  expect(result.plan?.operations[0].assetIds).toHaveLength(150);
  expect(toolCallRepository.create).toHaveBeenCalledWith(
    expect.objectContaining({
      assetCount: 150,
      redactedRequestMetadata: expect.objectContaining({
        assetCount: 150,
        assetIds: assetIds.slice(0, 25),
        selectionHandles: [{ id: selectionHandleId, assetCount: 150, sampleAssetIds: assetIds.slice(0, 25) }],
      }),
    }),
  );
});

it('rejects expired or cross-session selection handles before plan persistence', async () => {
  const auth = AuthFactory.create();
  const session = makeSession({ userId: auth.user.id });
  sessionRepository.getById.mockResolvedValue(session);
  selectionHandleRepository.getValidForPlanning.mockResolvedValue(undefined);

  await expect(
    sut.proposeAlbumOperations(auth, session.id, {
      summary: 'Add expired handle photos',
      operations: [
        {
          type: AgentOperationType.AlbumAddAssets,
          summary: 'Add selected photos',
          targetKind: AgentOperationTargetKind.ExistingAlbum,
          targetId: newUuid(),
          assetSelectionHandleId: newUuid(),
          payload: {},
          riskLevel: AgentOperationRiskLevel.Medium,
          enabled: true,
        },
      ],
    }),
  ).rejects.toThrow('Selection handle is expired or not available for this session');

  expect(planRepository.createReplacementRevision).not.toHaveBeenCalled();
});

it('re-checks handle assets against current permissions and deleted assets', async () => {
  const auth = AuthFactory.create();
  const session = makeSession({ userId: auth.user.id });
  const allowedAssetId = newUuid();
  const deletedOrDeniedAssetId = newUuid();
  const albumId = newUuid();
  sessionRepository.getById.mockResolvedValue(session);
  selectionHandleRepository.getValidForPlanning.mockResolvedValue({
    id: newUuid(),
    sessionId: session.id,
    userId: auth.user.id,
    sourceToolCallId: newUuid(),
    assetIds: [allowedAssetId, deletedOrDeniedAssetId],
    assetCount: 2,
    sampleAssetIds: [allowedAssetId, deletedOrDeniedAssetId],
    expiresAt: new Date('2026-05-21T12:30:00.000Z'),
    createdAt: now,
    updateId: newUuid(),
  });
  accessRepository.album.checkOwnerAccess.mockResolvedValue(new Set([albumId]));
  accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set([allowedAssetId]));
  assetRepository.getAgentReadableIds.mockResolvedValue(new Set([allowedAssetId]));

  await expect(
    sut.proposeAlbumOperations(auth, session.id, {
      summary: 'Add stale handle photos',
      operations: [
        {
          type: AgentOperationType.AlbumAddAssets,
          summary: 'Add selected photos',
          targetKind: AgentOperationTargetKind.ExistingAlbum,
          targetId: albumId,
          assetSelectionHandleId: newUuid(),
          payload: {},
          riskLevel: AgentOperationRiskLevel.Medium,
          enabled: true,
        },
      ],
    }),
  ).rejects.toThrow('One or more assets are not accessible');
});

it('keeps sparse item selection deterministic after applying a handle-derived plan', async () => {
  const auth = AuthFactory.create();
  const assetIds = [newUuid(), newUuid(), newUuid(), newUuid()];
  const { session, albumId, operation, plan } = makeAddAssetsPlan(auth, assetIds);
  sessionRepository.getById.mockResolvedValue(session);
  planRepository.getByIdForSession.mockResolvedValue(plan);
  planRepository.getCurrentBySessionId.mockResolvedValue(plan);
  planRepository.claimCurrentForApply.mockResolvedValue(plan);
  planRepository.completeApply.mockImplementation((_planId, updates) =>
    Promise.resolve(applyUpdatesToPlan(plan, updates)),
  );
  accessRepository.album.checkOwnerAccess.mockResolvedValue(new Set([albumId]));
  accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set(assetIds));
  assetRepository.getAgentReadableIds.mockResolvedValue(new Set(assetIds));
  albumService.addAssets.mockResolvedValue([
    { id: assetIds[0], success: true },
    { id: assetIds[2], success: true },
  ] as never);

  await sut.applyApprovedOperations(auth, session.id, plan.id, {
    operationIds: [operation.id],
    itemSelections: {
      [operation.id]: { itemKind: 'asset', mode: 'only', itemIds: [assetIds[0], assetIds[2]] },
    },
    planRevision: plan.revision,
  });

  expect(albumService.addAssets).toHaveBeenCalledWith(auth, albumId, { ids: [assetIds[0], assetIds[2]] });
});
```

- [x] **Step 2: Run planning tests and verify they fail**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-operation-plan.service.spec.ts --testNamePattern "assetSelectionHandleId|selection handles|handle-derived"
```

Expected: fails because the planning service does not resolve handles.

- [x] **Step 3: Implement planning materialization**

Modify `server/src/services/agent-operation-plan.service.ts`:

1. Inject repository:

```ts
import { AgentSelectionHandleRepository } from 'src/repositories/agent-selection-handle.repository';
```

Constructor:

```ts
private readonly selectionHandleRepository: AgentSelectionHandleRepository,
```

2. Add local type:

```ts
type PlanningSelectionAudit = Array<{
  id: string;
  assetCount: number;
  sampleAssetIds: string[];
}>;
```

3. Make `prepareOperations` async and accept `auth`:

```ts
const { operations, selectionAudit } = await this.prepareOperations(auth, session, dto.operations);
```

Use the same for `reviseProposedOperations`.

4. Add handle resolution inside `prepareOperations`:

```ts
const materializedAssetIds = operation.assetSelectionHandleId
  ? await this.resolveSelectionHandleAssetIds(auth, session, operation.assetSelectionHandleId, selectionAudit)
  : (operation.assetIds ?? []);
```

Push prepared operation with:

```ts
assetIds: materializedAssetIds,
assetSelectionHandleId: undefined,
```

5. Add resolver:

```ts
private async resolveSelectionHandleAssetIds(
  auth: AuthDto,
  session: AgentSession,
  id: string,
  selectionAudit: PlanningSelectionAudit,
) {
  const handle = await this.selectionHandleRepository.getValidForPlanning({
    id,
    sessionId: session.id,
    userId: auth.user.id,
    now: new Date(),
  });
  if (!handle) {
    throw new BadRequestException('Selection handle is expired or not available for this session');
  }

  selectionAudit.push({
    id: handle.id,
    assetCount: handle.assetCount,
    sampleAssetIds: handle.sampleAssetIds,
  });

  return handle.assetIds;
}
```

6. Extend `PlanningRequest` with `selectionHandles?: PlanningSelectionAudit`.
7. Pass `selectionAudit` to `runPlanningTool`:

```ts
return this.runPlanningTool(
  auth,
  session,
  AgentToolName.ProposeAlbumOperations,
  { ...dto, operations, selectionHandles: selectionAudit },
  async () => { ... },
);
```

8. Update `createPlanningAudit` and `redactRequestMetadata()`:

```ts
const assetIds = [...new Set(operations.flatMap((operation) => operation.assetIds ?? []))];
const handleDerived = (request.selectionHandles?.length ?? 0) > 0;
const assetIdsForAudit = handleDerived ? assetIds.slice(0, 25) : assetIds;
```

Set `assetCount: assetIds.length` on the tool call and metadata:

```ts
assetIds: assetIdsForAudit,
assetCount: assetIds.length,
assetIdsSample: handleDerived ? assetIds.slice(0, 25) : undefined,
selectionHandles: request.selectionHandles,
```

Remove undefined metadata fields before returning.

9. Ensure denied audits from expired handles include `selectionHandles` when available and no full asset list.

- [x] **Step 4: Run focused planning tests and verify they pass**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-operation-plan.service.spec.ts --testNamePattern "assetSelectionHandleId|selection handles|handle-derived"
```

Expected: passes.

## Task 5: Contract, Prompt, And Generated Docs

**Files:**

- Modify: `server/src/services/agent-mcp-tool-contract.service.ts`
- Modify: `server/src/services/agent-mcp-tool-contract.service.spec.ts`
- Modify: `server/src/services/agent-mcp-prompt.service.ts`
- Modify: `server/src/services/agent-mcp-prompt.service.spec.ts`
- Modify: `server/src/services/agent-mcp-docs.service.ts`
- Modify: `server/src/services/agent-mcp-docs.service.spec.ts`
- Regenerate: `agent-runner/src/generated/gallery-mcp-prompt-cheat-sheet.mjs`
- Regenerate: `docs/superpowers/generated/pi-agent-mcp-tools.md`

- [x] **Step 1: Write failing contract/prompt/doc tests**

In `server/src/services/agent-mcp-tool-contract.service.spec.ts`, add:

```ts
it('documents large selection handle search and plan examples that parse live DTO schemas', () => {
  const search = sut.getReadToolContract(AgentToolName.SearchAssets);
  const plan = sut.getPlanningToolContract(AgentToolName.ProposeAlbumOperations);
  const searchExample = search?.examples.find((example) => example.name === 'large-selection-handle-search');
  const planExample = plan?.examples.find((example) => example.name === 'create-album-from-selection-handle');

  expect(search?.usage).toContain('createSelectionHandle');
  expect(searchExample?.arguments).toMatchObject({
    createSelectionHandle: true,
    detail: 'ids',
    sampleSize: 5,
  });
  expect(AgentReadToolRequestSchemas[AgentToolName.SearchAssets].safeParse(searchExample?.arguments).success).toBe(
    true,
  );

  expect(plan?.usage).toContain('assetSelectionHandleId');
  expect(JSON.stringify(planExample?.arguments)).toContain('assetSelectionHandleId');
  expect(
    AgentOperationPlanToolRequestSchemas[AgentToolName.ProposeAlbumOperations].safeParse(planExample?.arguments)
      .success,
  ).toBe(true);
  expect(JSON.stringify(planExample?.arguments)).not.toContain('"assetIds"');
});
```

In `server/src/services/agent-mcp-prompt.service.spec.ts`, add:

```ts
it('renders large-selection handle guidance without encouraging pasted asset ids', () => {
  const prompt = sut.renderPromptCheatSheet();

  expect(prompt).toContain('createSelectionHandle');
  expect(prompt).toContain('assetSelectionHandleId');
  expect(prompt).toContain('Do not paste hundreds of assetIds');
});
```

In `server/src/services/agent-mcp-docs.service.spec.ts`, add:

```ts
it('documents large selection handles in the progressive detail workflow', () => {
  const docs = sut.renderMarkdown();

  expect(docs).toContain('Large selections');
  expect(docs).toContain('createSelectionHandle');
  expect(docs).toContain('assetSelectionHandleId');
  expect(docs).toContain('current bounded page');
});
```

- [x] **Step 2: Run docs/contract tests and verify they fail**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-mcp-tool-contract.service.spec.ts src/services/agent-mcp-prompt.service.spec.ts src/services/agent-mcp-docs.service.spec.ts
```

Expected: fails because handle guidance/examples are missing.

- [x] **Step 3: Implement contract and generated text source**

Modify `server/src/services/agent-mcp-tool-contract.service.ts`:

- Add search example:

```ts
{
  name: 'large-selection-handle-search',
  description: 'Create a compact server-side selection handle for a bounded large result.',
  arguments: {
    detail: 'ids',
    createSelectionHandle: true,
    sampleSize: 5,
    filters: { isNotInAlbum: true },
    limit: 500,
    page: 1,
  },
}
```

- Update search usage to say `createSelectionHandle` stores the current bounded page server-side and returns samples.
- Add plan example:

```ts
{
  name: 'create-album-from-selection-handle',
  description: 'Create an album and add a large server-side selection without pasting asset IDs.',
  arguments: {
    summary: 'Create an album from the selected search result.',
    operations: [
      {
        type: 'album.create',
        summary: 'Create album',
        targetKind: 'new_album',
        temporaryTargetId: 'selection-album',
        payload: { albumName: 'Selected photos', description: '' },
        riskLevel: 'low',
        enabled: true,
      },
      {
        type: 'album.addAssets',
        summary: 'Add selected photos',
        targetKind: 'new_album',
        temporaryTargetId: 'selection-album',
        assetSelectionHandleId: '<selection-handle-id>',
        payload: {},
        riskLevel: 'medium',
        enabled: true,
      },
    ],
  },
}
```

- Add common mistake:

```ts
{
  id: 'planning-pasted-large-asset-ids',
  match: { issuePath: 'operations.0.assetIds', messageIncludes: 'expected array to have <=' },
  hint: 'For hundreds or thousands of assets, call searchAssets with createSelectionHandle and use assetSelectionHandleId in the plan.',
  exampleName: 'create-album-from-selection-handle',
}
```

Modify `server/src/services/agent-mcp-prompt.service.ts`:

```ts
'Large selections: call searchAssets with createSelectionHandle true for the current bounded page, then use assetSelectionHandleId in the plan. Do not paste hundreds of assetIds into a planning call.',
```

Modify `server/src/services/agent-mcp-docs.service.ts` to add a `Large selections` subsection under the progressive detail workflow with:

- search compactly first;
- `createSelectionHandle: true` for bounded current page;
- use `selectionHandle.id` as `assetSelectionHandleId`;
- page or narrow if `hasMore` is true;
- plan review still shows counts/samples and Gallery applies only after user approval.

- [x] **Step 4: Run contract/docs tests and verify they pass**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-mcp-tool-contract.service.spec.ts src/services/agent-mcp-prompt.service.spec.ts src/services/agent-mcp-docs.service.spec.ts
```

Expected: passes.

- [x] **Step 5: Regenerate prompt and docs**

Run:

```bash
pnpm --dir server run build
pnpm --dir server run sync:agent-mcp-prompt
pnpm --dir server run sync:agent-mcp-docs
```

Expected: generated files update and no generation drift remains.

## Task 6: End-To-End Edge Coverage And Final Verification

**Files:**

- Modify: tests touched in Tasks 1-5 only unless final gaps are found.

- [x] **Step 1: Add or confirm tests for every Slice 7 edge case**

Confirm the following edge coverage is present:

- Expired handle: `AgentSelectionHandleRepository` and planning service reject `expiresAt <= now`.
- Wrong session/user: repository returns undefined; planning service reports unavailable handle.
- Handle after assets changed/deleted: planning service permission/readability test rejects missing or inaccessible asset IDs.
- Handle from a truncated result: search service test creates handle with full `assetCount` while result is truncated.
- User deselects a subset before applying: planning service sparse selection test applies only selected handle-derived asset IDs.
- Thousands of assets: repository medium test persists and resolves 1500 ordered IDs with 25 samples.
- Duplicate assets in saved selection: repository dedupes while preserving order.
- User permissions change between handle creation and plan application: planning service re-checks access before persistence and existing apply path re-checks access before mutation.
- Concurrent plan creation/revision/apply using the same handle: planning service/repository locking keeps plan revision behavior deterministic because handles resolve to stable ordered IDs and `createReplacementRevision`/`claimCurrentForApply` already lock the session.
- Audit logs/activity cards: planning service audit metadata has `assetCount`, 25-ID sample, and `selectionHandles`, not full handle-derived IDs.
- Denied preparation audits: expired/cross-session, empty, and over-limit handle failures record `attemptedSelectionHandleIds`.
- SQL generation: `AgentSelectionHandleRepository.getValidForPlanning` uses one DTO-shaped `@GenerateSql` argument and generated SQL exists in `server/src/queries/agent.selection.handle.repository.sql`.
- Plan review no eager thumbnails: materialized plan response includes operation `assetIds` and service tests assert no preview/original repository methods are called during planning.

If any item is missing, add a focused test before implementation changes.

- [x] **Step 2: Run focused test suite**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/dtos/agent-tool.dto.spec.ts src/dtos/agent-operation.dto.spec.ts src/services/agent-tool.service.spec.ts src/services/agent-operation-plan.service.spec.ts src/services/agent-mcp-tool-contract.service.spec.ts src/services/agent-mcp-prompt.service.spec.ts src/services/agent-mcp-docs.service.spec.ts
pnpm --dir server exec vitest --config test/vitest.config.medium.mjs test/medium/specs/repositories/agent-selection-handle.repository.spec.ts
```

Expected: all focused tests pass.

- [x] **Step 3: Run final verification**

Run:

```bash
pnpm --dir server run check
pnpm --dir server run test -- src/dtos/agent-tool.dto.spec.ts src/dtos/agent-operation.dto.spec.ts src/services/agent-tool.service.spec.ts src/services/agent-operation-plan.service.spec.ts src/services/agent-mcp-tool-contract.service.spec.ts src/services/agent-mcp-prompt.service.spec.ts src/services/agent-mcp-docs.service.spec.ts
pnpm --dir server exec vitest --config test/vitest.config.medium.mjs test/medium/specs/repositories/agent-selection-handle.repository.spec.ts
git diff --check
```

Expected: TypeScript check passes, focused unit tests pass, medium repository test passes, and whitespace check is clean.

- [x] **Step 3a: Run reviewer-fix regression tests and SQL generation**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-operation-plan.service.spec.ts --testNamePattern "selection handle|cover candidate|empty selection|expired or cross-session"
pnpm --dir server exec vitest --config test/vitest.config.medium.mjs test/medium/specs/repositories/agent-selection-handle.repository.spec.ts --testNamePattern "SQL generation"
pnpm --dir server run build
pnpm --dir server run sync:sql
```

Expected: denied preparation audits include attempted handle IDs, SQL generation metadata matches the repository method signature, and the generated query file is present.

- [ ] **Step 4: Commit and push Slice 7**

Run:

```bash
git status --short
git add server/src/schema/tables/agent-selection-handle.table.ts server/src/schema/index.ts server/src/database.ts server/src/schema/migrations/1778950000000-AgentSelectionHandle.ts server/src/repositories/agent-selection-handle.repository.ts server/src/queries/agent.selection.handle.repository.sql server/src/repositories/index.ts server/test/medium/specs/repositories/agent-selection-handle.repository.spec.ts server/src/dtos/agent-tool.dto.ts server/src/dtos/agent-tool.dto.spec.ts server/src/types/agent-tool.types.ts server/src/types/agent-operation.types.ts server/src/dtos/agent-operation.dto.ts server/src/dtos/agent-operation.dto.spec.ts server/src/services/agent-tool.service.ts server/src/services/agent-tool.service.spec.ts server/src/services/agent-operation-plan.service.ts server/src/services/agent-operation-plan.service.spec.ts server/src/services/agent-mcp-tool-contract.service.ts server/src/services/agent-mcp-tool-contract.service.spec.ts server/src/services/agent-mcp-prompt.service.ts server/src/services/agent-mcp-prompt.service.spec.ts server/src/services/agent-mcp-docs.service.ts server/src/services/agent-mcp-docs.service.spec.ts agent-runner/src/generated/gallery-mcp-prompt-cheat-sheet.mjs docs/superpowers/generated/pi-agent-mcp-tools.md docs/superpowers/plans/2026-05-21-pi-agent-mcp-minimal-context-slice-7.md
git commit -m "feat: add Pi selection handles"
git push
```

Expected: commit succeeds and pushes to `origin/explore/pi-agent-brainstorm`.
