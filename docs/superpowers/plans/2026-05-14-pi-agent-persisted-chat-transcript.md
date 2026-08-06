# Pi Agent Persisted Chat Transcript Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build vertical slice 3 for the Pi agent by persisting per-session chat messages and exposing authenticated append/list APIs for a user's own agent sessions.

**Architecture:** Gallery remains the authority for session ownership and durable transcript state. This slice adds immutable `agent_message` rows owned through `agent_session`, plus a small service/controller layer that appends user messages and lists the full transcript. It does not call the runner, stream tokens, implement tool approvals, create album plans, add Assistant UI, or mutate albums.

**Tech Stack:** NestJS, Kysely, SQL Tools decorators, Zod DTOs via `nestjs-zod`, existing auth/permission guards, Vitest unit and medium tests, OpenAPI generation.

---

## Branch And Dependency Strategy

This plan is written from `plan/pi-agent-slice-3`, branched from green `explore/pi-agent-brainstorm` at `57bc0fe2f6`.

Slice 3 depends on completed slice 2 session shell APIs and storage:

- `agent_session` exists and cascades on user deletion.
- `AgentSessionRepository.getById(userId, sessionId)` scopes session reads by owner.
- `AgentSessionStatus` includes active and terminal states.
- `Permission.AgentSessionRead` and `Permission.AgentSessionUpdate` exist.

This slice intentionally does not depend on slice 4 runner health work and must not touch Assistant UI.

Expected append/register conflicts with other agent slices:

- `server/src/database.ts`
- `server/src/schema/index.ts`
- `server/src/controllers/index.ts`
- `server/src/services/index.ts`
- `server/src/repositories/index.ts`
- generated OpenAPI/mobile SDK files
- `scripts/revert-to-immich.sql`

Resolve those by keeping all agent additions from every slice.

## Scope

This slice implements:

- `agent_message` SQL table.
- Message role and structured content DTOs.
- Message repository with append/list operations.
- Message service with ownership checks via `AgentSessionRepository`.
- `POST /agent/sessions/:id/messages` to append a user-authored message.
- `GET /agent/sessions/:id/messages` to list transcript messages in chronological order.
- Tests for ordering, ownership, cascade cleanup, terminal-session append rejection, and content validation.
- OpenAPI, TypeScript SDK, mobile OpenAPI updates.
- `revert-to-immich.sql` cleanup coverage for the new table and migration.

This slice intentionally does not implement:

- Runner-side assistant messages.
- Streaming events.
- Tool calls or approval prompts.
- Operation plans.
- UI.
- Any album mutations.
- Direct writes from chat messages.

## API Contract

Append user message:

```text
POST /agent/sessions/{id}/messages
permission: agentSession.update
```

Request:

```json
{
  "content": {
    "blocks": [{ "type": "text", "text": "Organize my Portugal photos." }]
  }
}
```

Response:

```json
{
  "id": "00000000-0000-4000-8000-000000000001",
  "sessionId": "00000000-0000-4000-8000-000000000002",
  "role": "user",
  "content": {
    "blocks": [{ "type": "text", "text": "Organize my Portugal photos." }]
  },
  "providerMessageId": null,
  "toolCallId": null,
  "createdAt": "2026-05-14T12:00:00.000Z"
}
```

List messages:

```text
GET /agent/sessions/{id}/messages
permission: agentSession.read
```

Response order is ascending by `createdAt`, then `id`.

## Content Shape

Persisted content must be structured now so future slices can add tool, asset, and plan references without rewriting the table. The public user-message append endpoint accepts text blocks only in this slice. Asset, tool-call, and plan reference blocks are response/storage-capable for future runner and UI slices, but accepting them from users now would require access checks that belong to later tool/UI work.

```ts
type AgentMessageContent = {
  blocks: AgentMessageBlock[];
};

type AgentMessageBlock =
  | { type: 'text'; text: string }
  | { type: 'tool-call'; toolCallId: string; summary?: string }
  | { type: 'asset'; assetId: string; label?: string }
  | { type: 'plan'; planId: string; label?: string };
```

Limits:

- At least 1 block.
- At most 100 blocks.
- Text block text must be trimmed, non-empty, and at most 8,000 characters.
- Optional labels/summaries are at most 500 characters.
- Full content JSON must be at most 32 KiB.
- Request DTO accepts only text blocks.
- The public append endpoint always writes role `user` and always sets `providerMessageId`/`toolCallId` to `null`.

## File Structure

Create:

- `server/src/types/agent-message.types.ts` - shared TypeScript types for role, content blocks, and content payloads.
- `server/src/dtos/agent-message.dto.ts` - Zod DTOs for append request and response.
- `server/src/dtos/agent-message.dto.spec.ts` - unit coverage for content shape and request/response DTO validation.
- `server/src/schema/tables/agent-message.table.ts` - SQL Tools table definition.
- `server/src/schema/migrations/1778800000000-AgentMessage.ts` - generated/manual migration for the table.
- `server/src/repositories/agent-message.repository.ts` - database append/list boundary.
- `server/test/medium/specs/repositories/agent-message.repository.spec.ts` - medium coverage for persistence, ordering, ownership-by-session lookup, and cascade cleanup.
- `server/src/services/agent-message.service.ts` - ownership/status checks and response mapping.
- `server/src/services/agent-message.service.spec.ts` - unit coverage for append/list behavior and edge cases.
- `server/src/controllers/agent-message.controller.ts` - authenticated nested message endpoints.
- `server/src/controllers/agent-message.controller.spec.ts` - route, permission, serialization, and validation coverage.

Modify:

- `server/src/enum.ts` - add `AgentMessageRole`.
- `server/src/database.ts` - export `AgentMessage` type and `columns.agentMessage`.
- `server/src/schema/index.ts` - register `AgentMessageTable`.
- `server/src/repositories/index.ts` - register `AgentMessageRepository`.
- `server/src/services/index.ts` - register `AgentMessageService`.
- `server/src/controllers/index.ts` - register `AgentMessageController`.
- `scripts/revert-to-immich.sql` - drop `agent_message`, remove migration row, and include sanity checks.
- Generated OpenAPI, TypeScript SDK, and mobile OpenAPI files from `make open-api`.

---

## Task 1: Message Contracts And Table

**Files:**

- Modify: `server/src/enum.ts`
- Create: `server/src/types/agent-message.types.ts`
- Create: `server/src/dtos/agent-message.dto.ts`
- Create: `server/src/dtos/agent-message.dto.spec.ts`
- Create: `server/src/schema/tables/agent-message.table.ts`
- Modify: `server/src/database.ts`
- Modify: `server/src/schema/index.ts`

- [ ] **Step 1: Write failing DTO validation tests**

Create `server/src/dtos/agent-message.dto.spec.ts` with DTO tests that compile against non-existent DTO code first:

```ts
import { AgentMessageCreateDto, AgentMessageResponseDto } from 'src/dtos/agent-message.dto';
import { AgentMessageRole } from 'src/enum';
import { factory } from 'test/small.factory';
import z from 'zod';

type AgentMessageCreateInput = z.input<typeof AgentMessageCreateDto.schema>;

const parseCreate = (input: AgentMessageCreateInput) => AgentMessageCreateDto.schema.safeParse(input);

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

const makeResponse = (overrides: Partial<AgentMessageResponseDto> = {}): AgentMessageResponseDto => ({
  id: factory.uuid(),
  sessionId: factory.uuid(),
  role: AgentMessageRole.Assistant,
  content: { blocks: [{ type: 'text', text: 'I can help with that.' }] },
  providerMessageId: null,
  toolCallId: null,
  createdAt: new Date('2026-05-14T12:00:00.000Z'),
  ...overrides,
});

describe('AgentMessage DTOs', () => {
  describe(AgentMessageCreateDto.name, () => {
    it('accepts text blocks and trims text', () => {
      const result = parseCreate({ content: { blocks: [{ type: 'text', text: '  Organize my photos.  ' }] } });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.content.blocks).toEqual([{ type: 'text', text: 'Organize my photos.' }]);
      }
    });

    it('rejects empty block lists', () => {
      const result = parseCreate({ content: { blocks: [] } });

      expectIssue(result, ['content', 'blocks'], 'Too small');
    });

    it('rejects more than 100 blocks', () => {
      const result = parseCreate({
        content: {
          blocks: Array.from({ length: 101 }, () => ({ type: 'text', text: 'hello' })),
        },
      });

      expectIssue(result, ['content', 'blocks'], 'Too big');
    });

    it('rejects blank text after trim', () => {
      const result = parseCreate({ content: { blocks: [{ type: 'text', text: '   ' }] } });

      expectIssue(result, ['content', 'blocks', 0, 'text'], 'Too small');
    });

    it('rejects text blocks above 8,000 characters', () => {
      const result = parseCreate({ content: { blocks: [{ type: 'text', text: 'x'.repeat(8001) }] } });

      expectIssue(result, ['content', 'blocks', 0, 'text'], 'Too big');
    });

    it('rejects full content JSON above 32 KiB', () => {
      const result = parseCreate({
        content: {
          blocks: Array.from({ length: 5 }, (_, index) => ({
            type: 'text',
            text: `${index}-${'x'.repeat(8000)}`,
          })),
        },
      });

      expectIssue(result, ['content'], 'content must be 32 KiB or less');
    });

    it('rejects unknown block types', () => {
      const result = parseCreate({ content: { blocks: [{ type: 'html', html: '<b>no</b>' }] } as never });

      expectIssue(result, ['content', 'blocks', 0, 'type'], 'Invalid input');
    });

    it.each([
      { type: 'asset', assetId: factory.uuid() },
      { type: 'tool-call', toolCallId: factory.uuid() },
      { type: 'plan', planId: factory.uuid() },
    ])('rejects $type blocks from the public create DTO', (block) => {
      const result = parseCreate({ content: { blocks: [block] } as never });

      expectIssue(result, ['content', 'blocks', 0, 'type'], 'Invalid input');
    });
  });

  describe(AgentMessageResponseDto.name, () => {
    it('encodes persisted structured response blocks', () => {
      const toolCallId = factory.uuid();
      const result = AgentMessageResponseDto.schema.safeEncode(
        makeResponse({
          content: {
            blocks: [
              { type: 'text', text: 'Working on it.' },
              { type: 'tool-call', toolCallId, summary: 'Read matching assets.' },
              { type: 'asset', assetId: factory.uuid(), label: 'IMG_0001.jpg' },
              { type: 'plan', planId: factory.uuid(), label: 'Portugal album plan' },
            ],
          },
          providerMessageId: 'provider-message-1',
          toolCallId,
        }),
      );

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.createdAt).toBe('2026-05-14T12:00:00.000Z');
      }
    });

    it.each([
      { block: { type: 'tool-call', toolCallId: factory.uuid(), summary: 'x'.repeat(501) }, path: 'summary' },
      { block: { type: 'asset', assetId: factory.uuid(), label: 'x'.repeat(501) }, path: 'label' },
      { block: { type: 'plan', planId: factory.uuid(), label: 'x'.repeat(501) }, path: 'label' },
    ])('bounds optional structured block text fields', ({ block, path }) => {
      const result = AgentMessageResponseDto.schema.safeEncode(makeResponse({ content: { blocks: [block] } as never }));

      expectIssue(result, ['content', 'blocks', 0, path], 'Too big');
    });
  });
});
```

- [ ] **Step 2: Run DTO tests and verify RED**

Run:

```bash
pnpm --dir server test agent-message.dto.spec.ts
```

Expected: FAIL because `agent-message.dto` and `AgentMessageRole` do not exist yet.

- [ ] **Step 3: Add enum, shared types, DTOs, and table**

Add to `server/src/enum.ts` near the existing agent enums:

```ts
export enum AgentMessageRole {
  User = 'user',
  Assistant = 'assistant',
  System = 'system',
  Tool = 'tool',
}
```

Create `server/src/types/agent-message.types.ts`:

```ts
export type AgentMessageTextBlock = {
  type: 'text';
  text: string;
};

export type AgentMessageToolCallBlock = {
  type: 'tool-call';
  toolCallId: string;
  summary?: string;
};

export type AgentMessageAssetBlock = {
  type: 'asset';
  assetId: string;
  label?: string;
};

export type AgentMessagePlanBlock = {
  type: 'plan';
  planId: string;
  label?: string;
};

export type AgentMessageBlock =
  | AgentMessageTextBlock
  | AgentMessageToolCallBlock
  | AgentMessageAssetBlock
  | AgentMessagePlanBlock;

export type AgentMessageContent = {
  blocks: AgentMessageBlock[];
};
```

Create `server/src/dtos/agent-message.dto.ts`:

```ts
import { createZodDto } from 'nestjs-zod';
import { AgentMessageRole } from 'src/enum';
import { isoDatetimeToDate } from 'src/validation';
import z from 'zod';

const MAX_CONTENT_BYTES = 32_768;
const text = z.string().trim().min(1).max(8000);
const label = z.string().trim().min(1).max(500).optional();
const jsonByteLength = (value: unknown) => Buffer.byteLength(JSON.stringify(value), 'utf8');

const AgentMessageRoleSchema = z.enum(AgentMessageRole).meta({ id: 'AgentMessageRole' });

const AgentMessageTextBlockSchema = z
  .object({
    type: z.literal('text'),
    text,
  })
  .meta({ id: 'AgentMessageTextBlock' });

const AgentMessageToolCallBlockSchema = z
  .object({
    type: z.literal('tool-call'),
    toolCallId: z.uuidv4(),
    summary: label,
  })
  .meta({ id: 'AgentMessageToolCallBlock' });

const AgentMessageAssetBlockSchema = z
  .object({
    type: z.literal('asset'),
    assetId: z.uuidv4(),
    label,
  })
  .meta({ id: 'AgentMessageAssetBlock' });

const AgentMessagePlanBlockSchema = z
  .object({
    type: z.literal('plan'),
    planId: z.uuidv4(),
    label,
  })
  .meta({ id: 'AgentMessagePlanBlock' });

const AgentMessageBlockSchema = z
  .discriminatedUnion('type', [
    AgentMessageTextBlockSchema,
    AgentMessageToolCallBlockSchema,
    AgentMessageAssetBlockSchema,
    AgentMessagePlanBlockSchema,
  ])
  .meta({ id: 'AgentMessageBlock' });

const AgentMessageContentSchema = z
  .object({
    blocks: z.array(AgentMessageBlockSchema).min(1).max(100),
  })
  .refine((value) => jsonByteLength(value) <= MAX_CONTENT_BYTES, {
    message: 'content must be 32 KiB or less',
  })
  .meta({ id: 'AgentMessageContent' });

const AgentUserMessageContentSchema = z
  .object({
    blocks: z.array(AgentMessageTextBlockSchema).min(1).max(100),
  })
  .refine((value) => jsonByteLength(value) <= MAX_CONTENT_BYTES, {
    message: 'content must be 32 KiB or less',
  })
  .meta({ id: 'AgentUserMessageContent' });

const AgentMessageCreateSchema = z
  .object({
    content: AgentUserMessageContentSchema,
  })
  .meta({ id: 'AgentMessageCreateDto' });

const AgentMessageResponseSchema = z
  .object({
    id: z.uuidv4(),
    sessionId: z.uuidv4(),
    role: AgentMessageRoleSchema,
    content: AgentMessageContentSchema,
    providerMessageId: z.string().nullable(),
    toolCallId: z.uuidv4().nullable(),
    createdAt: isoDatetimeToDate,
  })
  .meta({ id: 'AgentMessageResponseDto' });

export class AgentMessageCreateDto extends createZodDto(AgentMessageCreateSchema) {}
export class AgentMessageResponseDto extends createZodDto(AgentMessageResponseSchema) {}
```

Create `server/src/schema/tables/agent-message.table.ts`:

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
import { AgentMessageRole } from 'src/enum';
import { AgentSessionTable } from 'src/schema/tables/agent-session.table';
import type { AgentMessageContent } from 'src/types/agent-message.types';

@Index({ columns: ['sessionId', 'createdAt', 'id'] })
@Table('agent_message')
export class AgentMessageTable {
  @PrimaryGeneratedColumn()
  id!: Generated<string>;

  @ForeignKeyColumn(() => AgentSessionTable, { onUpdate: 'CASCADE', onDelete: 'CASCADE' })
  sessionId!: string;

  @Column()
  role!: AgentMessageRole;

  @Column({ type: 'jsonb' })
  content!: AgentMessageContent;

  @Column({ nullable: true })
  providerMessageId!: string | null;

  @Column({ type: 'uuid', nullable: true })
  toolCallId!: string | null;

  @CreateDateColumn()
  createdAt!: Generated<Timestamp>;
}
```

Modify `server/src/database.ts`:

```ts
import { AgentMessageTable } from 'src/schema/tables/agent-message.table';
```

Add type:

```ts
export type AgentMessage = Selectable<AgentMessageTable>;
```

Add columns:

```ts
agentMessage: ['id', 'sessionId', 'role', 'content', 'providerMessageId', 'toolCallId', 'createdAt'],
```

Modify `server/src/schema/index.ts`:

```ts
import { AgentMessageTable } from 'src/schema/tables/agent-message.table';
```

Add `AgentMessageTable` immediately after `AgentSessionTable` in `ImmichDatabase.tables`.

- [ ] **Step 4: Run DTO tests and server typecheck and verify GREEN**

Run:

```bash
pnpm --dir server test agent-message.dto.spec.ts
pnpm --dir server check
```

Expected: PASS.

- [ ] **Step 5: Commit contracts**

This commit must not include controller tests or route code; those are introduced in Task 4 so intermediate repository/service tasks keep passing typecheck.

```bash
git add server/src/enum.ts server/src/types/agent-message.types.ts server/src/dtos/agent-message.dto.ts server/src/dtos/agent-message.dto.spec.ts server/src/schema/tables/agent-message.table.ts server/src/database.ts server/src/schema/index.ts
git commit -m "feat: add agent message contracts"
```

---

## Task 2: Repository And Migration

**Files:**

- Create: `server/src/repositories/agent-message.repository.ts`
- Create: `server/test/medium/specs/repositories/agent-message.repository.spec.ts`
- Create: `server/src/schema/migrations/1778800000000-AgentMessage.ts`
- Modify: `server/src/repositories/index.ts`

- [ ] **Step 1: Write failing medium repository tests**

Create `server/test/medium/specs/repositories/agent-message.repository.spec.ts`:

```ts
import { Kysely } from 'kysely';
import { AgentApprovalMode, AgentMessageRole, AgentPermissionPreset, AgentProviderType } from 'src/enum';
import { AgentMessageRepository } from 'src/repositories/agent-message.repository';
import { AgentProviderCredentialRepository } from 'src/repositories/agent-provider-credential.repository';
import { AgentSessionRepository } from 'src/repositories/agent-session.repository';
import { LoggingRepository } from 'src/repositories/logging.repository';
import { DB } from 'src/schema';
import { BaseService } from 'src/services/base.service';
import type { AgentMessageContent } from 'src/types/agent-message.types';
import { newMediumService } from 'test/medium.factory';
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
    sut: new AgentMessageRepository(database),
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

describe(AgentMessageRepository.name, () => {
  it('appends messages and lists them in chronological order for a session', async () => {
    const { ctx, credentialRepository, sessionRepository, sut } = setup();
    const { session } = await createSession(ctx, credentialRepository, sessionRepository);

    const first = await sut.create({
      sessionId: session.id,
      role: AgentMessageRole.User,
      content: { blocks: [{ type: 'text', text: 'Start organizing.' }] },
      providerMessageId: null,
      toolCallId: null,
      createdAt: new Date('2026-05-14T12:00:00.000Z'),
    });
    const second = await sut.create({
      sessionId: session.id,
      role: AgentMessageRole.Assistant,
      content: { blocks: [{ type: 'text', text: 'I can help with that.' }] },
      providerMessageId: 'provider-message-1',
      toolCallId: null,
      createdAt: new Date('2026-05-14T12:00:01.000Z'),
    });

    await expect(sut.getBySessionId(session.id)).resolves.toMatchObject([
      { id: first.id, role: AgentMessageRole.User },
      { id: second.id, role: AgentMessageRole.Assistant, providerMessageId: 'provider-message-1' },
    ]);
  });

  it('uses id as a deterministic tie-breaker when createdAt values match', async () => {
    const { ctx, credentialRepository, sessionRepository, sut } = setup();
    const { session } = await createSession(ctx, credentialRepository, sessionRepository);
    const createdAt = new Date('2026-05-14T12:00:00.000Z');
    const firstId = '00000000-0000-4000-8000-000000000001';
    const secondId = '00000000-0000-4000-8000-000000000002';

    await sut.create({
      id: secondId,
      sessionId: session.id,
      role: AgentMessageRole.Assistant,
      content: { blocks: [{ type: 'text', text: 'Second by id.' }] },
      providerMessageId: null,
      toolCallId: null,
      createdAt,
    });
    await sut.create({
      id: firstId,
      sessionId: session.id,
      role: AgentMessageRole.User,
      content: { blocks: [{ type: 'text', text: 'First by id.' }] },
      providerMessageId: null,
      toolCallId: null,
      createdAt,
    });

    await expect(sut.getBySessionId(session.id)).resolves.toMatchObject([{ id: firstId }, { id: secondId }]);
  });

  it('persists structured response-capable content blocks', async () => {
    const { ctx, credentialRepository, sessionRepository, sut } = setup();
    const { session } = await createSession(ctx, credentialRepository, sessionRepository);
    const toolCallId = '00000000-0000-4000-8000-000000000101';
    const content: AgentMessageContent = {
      blocks: [
        { type: 'text', text: 'I found matching photos.' },
        { type: 'tool-call', toolCallId, summary: 'Read candidate metadata.' },
        { type: 'asset', assetId: '00000000-0000-4000-8000-000000000102', label: 'IMG_0001.jpg' },
        { type: 'plan', planId: '00000000-0000-4000-8000-000000000103', label: 'Portugal album plan' },
      ],
    };

    const saved = await sut.create({
      sessionId: session.id,
      role: AgentMessageRole.Assistant,
      content,
      providerMessageId: 'provider-message-1',
      toolCallId,
    });

    await expect(sut.getBySessionId(session.id)).resolves.toMatchObject([
      {
        id: saved.id,
        role: AgentMessageRole.Assistant,
        content,
        providerMessageId: 'provider-message-1',
        toolCallId,
      },
    ]);
  });

  it('returns no messages for another session and cascades when the session is deleted', async () => {
    const { ctx, credentialRepository, sessionRepository, sut } = setup();
    const { session } = await createSession(ctx, credentialRepository, sessionRepository);
    const { session: otherSession } = await createSession(ctx, credentialRepository, sessionRepository);

    await sut.create({
      sessionId: session.id,
      role: AgentMessageRole.User,
      content: { blocks: [{ type: 'text', text: 'Only in my session.' }] },
      providerMessageId: null,
      toolCallId: null,
    });

    await expect(sut.getBySessionId(otherSession.id)).resolves.toEqual([]);

    await defaultDatabase.deleteFrom('agent_session').where('id', '=', session.id).execute();

    await expect(sut.getBySessionId(session.id)).resolves.toEqual([]);
  });

  it('rejects messages for missing sessions through the foreign key', async () => {
    const { sut } = setup();

    await expect(
      sut.create({
        sessionId: '00000000-0000-4000-8000-000000000001',
        role: AgentMessageRole.User,
        content: { blocks: [{ type: 'text', text: 'Missing session.' }] },
        providerMessageId: null,
        toolCallId: null,
      }),
    ).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run medium tests and verify RED**

Run:

```bash
pnpm --dir server test:medium agent-message.repository.spec.ts
```

Expected: FAIL because `agent_message` table and `AgentMessageRepository` do not exist.

- [ ] **Step 3: Add repository**

Create `server/src/repositories/agent-message.repository.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { Insertable, Kysely } from 'kysely';
import { InjectKysely } from 'nestjs-kysely';
import { columns } from 'src/database';
import { DummyValue, GenerateSql } from 'src/decorators';
import { DB } from 'src/schema';
import { AgentMessageTable } from 'src/schema/tables/agent-message.table';
import { asUuid } from 'src/utils/database';

@Injectable()
export class AgentMessageRepository {
  constructor(@InjectKysely() private db: Kysely<DB>) {}

  create(dto: Insertable<AgentMessageTable>) {
    return this.db.insertInto('agent_message').values(dto).returning(columns.agentMessage).executeTakeFirstOrThrow();
  }

  @GenerateSql({ params: [DummyValue.UUID] })
  getBySessionId(sessionId: string) {
    return this.db
      .selectFrom('agent_message')
      .select(columns.agentMessage)
      .where('sessionId', '=', asUuid(sessionId))
      .orderBy('createdAt', 'asc')
      .orderBy('id', 'asc')
      .execute();
  }
}
```

Modify `server/src/repositories/index.ts`:

```ts
import { AgentMessageRepository } from 'src/repositories/agent-message.repository';
```

Add `AgentMessageRepository` to the `repositories` array next to the other agent repositories.

- [ ] **Step 4: Add migration**

Create `server/src/schema/migrations/1778800000000-AgentMessage.ts`:

```ts
import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE "agent_message" (
      "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
      "sessionId" uuid NOT NULL,
      "role" character varying NOT NULL,
      "content" jsonb NOT NULL,
      "providerMessageId" character varying,
      "toolCallId" uuid,
      "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
      CONSTRAINT "agent_message_pkey" PRIMARY KEY ("id"),
      CONSTRAINT "agent_message_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "agent_session"("id") ON UPDATE CASCADE ON DELETE CASCADE
    )
  `.execute(db);

  await sql`CREATE INDEX "agent_message_sessionId_createdAt_id_idx" ON "agent_message" ("sessionId", "createdAt", "id")`.execute(
    db,
  );
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TABLE "agent_message"`.execute(db);
}
```

- [ ] **Step 5: Run repository tests and verify GREEN**

Run:

```bash
pnpm --dir server test:medium agent-message.repository.spec.ts
```

Expected: PASS.

- [ ] **Step 6: Run server typecheck**

Run:

```bash
pnpm --dir server check
```

Expected: PASS.

- [ ] **Step 7: Commit repository and migration**

```bash
git add server/src/repositories/agent-message.repository.ts server/test/medium/specs/repositories/agent-message.repository.spec.ts server/src/schema/migrations/1778800000000-AgentMessage.ts server/src/repositories/index.ts
git commit -m "feat: add agent message storage"
```

---

## Task 3: Message Service

**Files:**

- Create: `server/src/services/agent-message.service.ts`
- Create: `server/src/services/agent-message.service.spec.ts`
- Modify: `server/src/services/index.ts`

- [ ] **Step 1: Write failing service tests**

Create `server/src/services/agent-message.service.spec.ts`:

```ts
import { AgentMessage, AgentSession } from 'src/database';
import { AgentMessageCreateDto } from 'src/dtos/agent-message.dto';
import {
  AgentApprovalMode,
  AgentMessageRole,
  AgentPermissionPreset,
  AgentProviderType,
  AgentSessionStatus,
} from 'src/enum';
import { AgentMessageRepository } from 'src/repositories/agent-message.repository';
import { AgentSessionRepository } from 'src/repositories/agent-session.repository';
import { AgentMessageService } from 'src/services/agent-message.service';
import { AgentPermissionPlanSnapshot } from 'src/types/agent-session.types';
import { AuthFactory } from 'test/factories/auth.factory';
import { newUuid } from 'test/small.factory';
import { automock } from 'test/utils';

const now = new Date('2026-05-14T12:00:00.000Z');
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

const makeMessage = (overrides: Partial<AgentMessage> = {}): AgentMessage => ({
  id: newUuid(),
  sessionId: newUuid(),
  role: AgentMessageRole.User,
  content: { blocks: [{ type: 'text', text: 'Organize my photos.' }] },
  providerMessageId: null,
  toolCallId: null,
  createdAt: now,
  ...overrides,
});

describe(AgentMessageService.name, () => {
  let sut: AgentMessageService;
  let messageRepository: ReturnType<typeof automock<AgentMessageRepository>>;
  let sessionRepository: ReturnType<typeof automock<AgentSessionRepository>>;

  beforeEach(() => {
    messageRepository = automock(AgentMessageRepository, { args: [{} as never] });
    sessionRepository = automock(AgentSessionRepository, { args: [{} as never] });
    sut = new AgentMessageService(messageRepository, sessionRepository);
  });

  it('appends a user message to an owned active session', async () => {
    const auth = AuthFactory.create();
    const session = makeSession({ userId: auth.user.id });
    const dto: AgentMessageCreateDto = {
      content: { blocks: [{ type: 'text', text: 'Organize my Portugal photos.' }] },
    };
    const saved = makeMessage({ sessionId: session.id, content: dto.content });

    sessionRepository.getById.mockResolvedValue(session);
    messageRepository.create.mockResolvedValue(saved);

    const result = await sut.appendUserMessage(auth, session.id, dto);

    expect(sessionRepository.getById).toHaveBeenCalledWith(auth.user.id, session.id);
    expect(messageRepository.create).toHaveBeenCalledWith({
      sessionId: session.id,
      role: AgentMessageRole.User,
      content: dto.content,
      providerMessageId: null,
      toolCallId: null,
    });
    expect(result).toEqual(saved);
  });

  it.each([
    AgentSessionStatus.Created,
    AgentSessionStatus.Running,
    AgentSessionStatus.WaitingForToolApproval,
    AgentSessionStatus.WaitingForPlanReview,
    AgentSessionStatus.Interrupted,
  ])('allows append while session status is %s', async (status) => {
    const auth = AuthFactory.create();
    const session = makeSession({ userId: auth.user.id, status });
    const dto: AgentMessageCreateDto = { content: { blocks: [{ type: 'text', text: 'Hello' }] } };
    const saved = makeMessage({ sessionId: session.id, content: dto.content });

    sessionRepository.getById.mockResolvedValue(session);
    messageRepository.create.mockResolvedValue(saved);

    await expect(sut.appendUserMessage(auth, session.id, dto)).resolves.toEqual(saved);
  });

  it.each([
    AgentSessionStatus.Applying,
    AgentSessionStatus.Completed,
    AgentSessionStatus.Cancelled,
    AgentSessionStatus.Failed,
  ])('rejects append while session status is %s', async (status) => {
    const auth = AuthFactory.create();
    const session = makeSession({ userId: auth.user.id, status });

    sessionRepository.getById.mockResolvedValue(session);

    await expect(
      sut.appendUserMessage(auth, session.id, { content: { blocks: [{ type: 'text', text: 'Hello' }] } }),
    ).rejects.toThrow('Agent session does not accept new messages');
    expect(messageRepository.create).not.toHaveBeenCalled();
  });

  it('rejects append for missing or cross-user sessions', async () => {
    const auth = AuthFactory.create();
    const sessionId = newUuid();

    sessionRepository.getById.mockResolvedValue(undefined);

    await expect(
      sut.appendUserMessage(auth, sessionId, { content: { blocks: [{ type: 'text', text: 'Hello' }] } }),
    ).rejects.toThrow('Agent session not found');
    expect(messageRepository.create).not.toHaveBeenCalled();
  });

  it('lists messages for an owned session', async () => {
    const auth = AuthFactory.create();
    const session = makeSession({ userId: auth.user.id });
    const messages = [
      makeMessage({ sessionId: session.id, role: AgentMessageRole.User }),
      makeMessage({ sessionId: session.id, role: AgentMessageRole.Assistant }),
    ];

    sessionRepository.getById.mockResolvedValue(session);
    messageRepository.getBySessionId.mockResolvedValue(messages);

    const result = await sut.getMessages(auth, session.id);

    expect(sessionRepository.getById).toHaveBeenCalledWith(auth.user.id, session.id);
    expect(messageRepository.getBySessionId).toHaveBeenCalledWith(session.id);
    expect(result).toEqual(messages);
  });

  it('rejects list for missing or cross-user sessions', async () => {
    const auth = AuthFactory.create();
    const sessionId = newUuid();

    sessionRepository.getById.mockResolvedValue(undefined);

    await expect(sut.getMessages(auth, sessionId)).rejects.toThrow('Agent session not found');
    expect(messageRepository.getBySessionId).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run service tests and verify RED**

Run:

```bash
pnpm --dir server test agent-message.service.spec.ts
```

Expected: FAIL because `AgentMessageService` does not exist.

- [ ] **Step 3: Implement service**

Create `server/src/services/agent-message.service.ts`:

```ts
import { BadRequestException, Injectable } from '@nestjs/common';
import { AgentMessage, AgentSession } from 'src/database';
import { AgentMessageCreateDto, AgentMessageResponseDto } from 'src/dtos/agent-message.dto';
import { AuthDto } from 'src/dtos/auth.dto';
import { AgentMessageRole, AgentSessionStatus } from 'src/enum';
import { AgentMessageRepository } from 'src/repositories/agent-message.repository';
import { AgentSessionRepository } from 'src/repositories/agent-session.repository';

@Injectable()
export class AgentMessageService {
  private static readonly appendableStatuses = [
    AgentSessionStatus.Created,
    AgentSessionStatus.Running,
    AgentSessionStatus.WaitingForToolApproval,
    AgentSessionStatus.WaitingForPlanReview,
    AgentSessionStatus.Interrupted,
  ];

  constructor(
    private readonly messageRepository: AgentMessageRepository,
    private readonly sessionRepository: AgentSessionRepository,
  ) {}

  async appendUserMessage(
    auth: AuthDto,
    sessionId: string,
    dto: AgentMessageCreateDto,
  ): Promise<AgentMessageResponseDto> {
    const session = await this.getOwnedSession(auth, sessionId);

    if (!AgentMessageService.appendableStatuses.includes(session.status)) {
      throw new BadRequestException('Agent session does not accept new messages');
    }

    const message = await this.messageRepository.create({
      sessionId: session.id,
      role: AgentMessageRole.User,
      content: dto.content,
      providerMessageId: null,
      toolCallId: null,
    });

    return this.map(message);
  }

  async getMessages(auth: AuthDto, sessionId: string): Promise<AgentMessageResponseDto[]> {
    const session = await this.getOwnedSession(auth, sessionId);
    const messages = await this.messageRepository.getBySessionId(session.id);
    return messages.map((message) => this.map(message));
  }

  private async getOwnedSession(auth: AuthDto, sessionId: string): Promise<AgentSession> {
    const session = await this.sessionRepository.getById(auth.user.id, sessionId);
    if (!session) {
      throw new BadRequestException('Agent session not found');
    }

    return session;
  }

  private map(message: AgentMessage): AgentMessageResponseDto {
    return {
      id: message.id,
      sessionId: message.sessionId,
      role: message.role,
      content: message.content,
      providerMessageId: message.providerMessageId,
      toolCallId: message.toolCallId,
      createdAt: message.createdAt,
    };
  }
}
```

Modify `server/src/services/index.ts`:

```ts
import { AgentMessageService } from 'src/services/agent-message.service';
```

Add `AgentMessageService` to the `services` array next to the other agent services.

- [ ] **Step 4: Run service tests and verify GREEN**

Run:

```bash
pnpm --dir server test agent-message.service.spec.ts
```

Expected: PASS.

- [ ] **Step 5: Run server typecheck**

Run:

```bash
pnpm --dir server check
```

Expected: PASS.

- [ ] **Step 6: Commit service**

```bash
git add server/src/services/agent-message.service.ts server/src/services/agent-message.service.spec.ts server/src/services/index.ts
git commit -m "feat: add agent message service"
```

---

## Task 4: Controller And API Registration

**Files:**

- Create: `server/src/controllers/agent-message.controller.ts`
- Modify: `server/src/controllers/index.ts`
- Create: `server/src/controllers/agent-message.controller.spec.ts`

- [ ] **Step 1: Write failing controller tests**

Create `server/src/controllers/agent-message.controller.spec.ts`:

```ts
import { AgentMessageController } from 'src/controllers/agent-message.controller';
import { AgentMessageCreateDto, AgentMessageResponseDto } from 'src/dtos/agent-message.dto';
import { AgentMessageRole, Permission } from 'src/enum';
import { AgentMessageService } from 'src/services/agent-message.service';
import request from 'supertest';
import { AuthFactory } from 'test/factories/auth.factory';
import { factory } from 'test/small.factory';
import { automock, ControllerContext, controllerSetup } from 'test/utils';

describe(AgentMessageController.name, () => {
  let ctx: ControllerContext;
  const service = automock(AgentMessageService, { args: [{} as never, {} as never], strict: false });
  const auth = AuthFactory.create();
  const sessionId = factory.uuid();
  const messageId = factory.uuid();
  const now = new Date('2026-05-14T12:00:00.000Z');
  const body: AgentMessageCreateDto = {
    content: {
      blocks: [{ type: 'text', text: 'Organize my Portugal photos.' }],
    },
  };
  const response: AgentMessageResponseDto = {
    id: messageId,
    sessionId,
    role: AgentMessageRole.User,
    content: body.content,
    providerMessageId: null,
    toolCallId: null,
    createdAt: now,
  };

  beforeAll(async () => {
    ctx = await controllerSetup(AgentMessageController, [{ provide: AgentMessageService, useValue: service }]);
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

  describe('POST /agent/sessions/:id/messages', () => {
    it('should be an authenticated route with update permission', async () => {
      service.appendUserMessage.mockResolvedValue(response);

      await request(ctx.getHttpServer()).post(`/agent/sessions/${sessionId}/messages`).send(body);

      expect(ctx.authenticate).toHaveBeenCalled();
      expectPermission(Permission.AgentSessionUpdate);
    });

    it('should call the service with auth, session id, and body', async () => {
      service.appendUserMessage.mockResolvedValue(response);

      const { status, body: result } = await request(ctx.getHttpServer())
        .post(`/agent/sessions/${sessionId}/messages`)
        .send(body);

      expect(status).toBe(201);
      expect(service.appendUserMessage).toHaveBeenCalledWith(auth, sessionId, body);
      expect(result).toEqual({ ...response, createdAt: now.toISOString() });
    });

    it('should strip server-owned fields from append requests', async () => {
      service.appendUserMessage.mockResolvedValue(response);

      await request(ctx.getHttpServer())
        .post(`/agent/sessions/${sessionId}/messages`)
        .send({
          ...body,
          role: AgentMessageRole.Assistant,
          providerMessageId: 'provider-message-1',
          toolCallId: factory.uuid(),
        });

      expect(service.appendUserMessage).toHaveBeenCalledWith(auth, sessionId, body);
    });

    it('should require a valid session uuid', async () => {
      const { status, body: result } = await request(ctx.getHttpServer())
        .post('/agent/sessions/not-a-uuid/messages')
        .send(body);

      expect(status).toBe(400);
      expect(result).toEqual(factory.responses.badRequest(['[id] Invalid UUID']));
    });

    it('should reject empty message blocks', async () => {
      const { status, body: result } = await request(ctx.getHttpServer())
        .post(`/agent/sessions/${sessionId}/messages`)
        .send({ content: { blocks: [] } });

      expect(status).toBe(400);
      expect(result).toEqual(
        factory.responses.badRequest(['[content.blocks] Too small: expected array to have >=1 items']),
      );
    });

    it('should reject blank text blocks', async () => {
      const { status, body: result } = await request(ctx.getHttpServer())
        .post(`/agent/sessions/${sessionId}/messages`)
        .send({ content: { blocks: [{ type: 'text', text: '   ' }] } });

      expect(status).toBe(400);
      expect(result).toEqual(
        factory.responses.badRequest(['[content.blocks.0.text] Too small: expected string to have >=1 characters']),
      );
    });

    it('should reject unknown block types', async () => {
      const { status, body: result } = await request(ctx.getHttpServer())
        .post(`/agent/sessions/${sessionId}/messages`)
        .send({ content: { blocks: [{ type: 'html', html: '<b>no</b>' }] } });

      expect(status).toBe(400);
      expect(result).toEqual(factory.responses.badRequest([expect.stringContaining('[content.blocks.0.type]')]));
    });

    it('should reject non-text reference blocks from the public append endpoint', async () => {
      const { status, body: result } = await request(ctx.getHttpServer())
        .post(`/agent/sessions/${sessionId}/messages`)
        .send({ content: { blocks: [{ type: 'asset', assetId: factory.uuid() }] } });

      expect(status).toBe(400);
      expect(result).toEqual(factory.responses.badRequest([expect.stringContaining('[content.blocks.0.type]')]));
    });

    it('should reject oversized content payloads', async () => {
      const { status, body: result } = await request(ctx.getHttpServer())
        .post(`/agent/sessions/${sessionId}/messages`)
        .send({
          content: {
            blocks: Array.from({ length: 5 }, (_, index) => ({
              type: 'text',
              text: `${index}-${'x'.repeat(8000)}`,
            })),
          },
        });

      expect(status).toBe(400);
      expect(result).toEqual(factory.responses.badRequest(['[content] content must be 32 KiB or less']));
    });
  });

  describe('GET /agent/sessions/:id/messages', () => {
    it('should be an authenticated route with read permission', async () => {
      service.getMessages.mockResolvedValue([]);

      await request(ctx.getHttpServer()).get(`/agent/sessions/${sessionId}/messages`);

      expect(ctx.authenticate).toHaveBeenCalled();
      expectPermission(Permission.AgentSessionRead);
    });

    it('should call the service with auth and session id', async () => {
      service.getMessages.mockResolvedValue([response]);

      const { status, body: result } = await request(ctx.getHttpServer()).get(`/agent/sessions/${sessionId}/messages`);

      expect(status).toBe(200);
      expect(service.getMessages).toHaveBeenCalledWith(auth, sessionId);
      expect(result).toEqual([{ ...response, createdAt: now.toISOString() }]);
    });

    it('should require a valid session uuid', async () => {
      const { status, body: result } = await request(ctx.getHttpServer()).get('/agent/sessions/not-a-uuid/messages');

      expect(status).toBe(400);
      expect(result).toEqual(factory.responses.badRequest(['[id] Invalid UUID']));
    });
  });
});
```

- [ ] **Step 2: Run controller tests and verify RED**

Run:

```bash
pnpm --dir server test agent-message.controller.spec.ts
```

Expected: FAIL because `AgentMessageController` is still missing.

- [ ] **Step 3: Implement controller**

Create `server/src/controllers/agent-message.controller.ts`:

```ts
import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Endpoint, HistoryBuilder } from 'src/decorators';
import { AgentMessageCreateDto, AgentMessageResponseDto } from 'src/dtos/agent-message.dto';
import { AuthDto } from 'src/dtos/auth.dto';
import { ApiTag, Permission } from 'src/enum';
import { Auth, Authenticated } from 'src/middleware/auth.guard';
import { AgentMessageService } from 'src/services/agent-message.service';
import { UUIDParamDto } from 'src/validation';

@ApiTags(ApiTag.AgentSessions)
@Controller('agent/sessions/:id/messages')
export class AgentMessageController {
  constructor(private readonly service: AgentMessageService) {}

  @Post()
  @Authenticated({ permission: Permission.AgentSessionUpdate })
  @Endpoint({
    summary: 'Append an agent session message',
    description: 'Append a user-authored message to an AI agent session owned by the current user.',
    history: new HistoryBuilder().added('v2.7.5').alpha('v2.7.5'),
  })
  appendAgentSessionMessage(
    @Auth() auth: AuthDto,
    @Param() { id }: UUIDParamDto,
    @Body() dto: AgentMessageCreateDto,
  ): Promise<AgentMessageResponseDto> {
    return this.service.appendUserMessage(auth, id, dto);
  }

  @Get()
  @Authenticated({ permission: Permission.AgentSessionRead })
  @Endpoint({
    summary: 'List agent session messages',
    description: 'Retrieve persisted chat messages for an AI agent session owned by the current user.',
    history: new HistoryBuilder().added('v2.7.5').alpha('v2.7.5'),
  })
  getAgentSessionMessages(@Auth() auth: AuthDto, @Param() { id }: UUIDParamDto): Promise<AgentMessageResponseDto[]> {
    return this.service.getMessages(auth, id);
  }
}
```

Modify `server/src/controllers/index.ts`:

```ts
import { AgentMessageController } from 'src/controllers/agent-message.controller';
```

Add `AgentMessageController` to the `controllers` array next to the other agent controllers.

- [ ] **Step 4: Run controller tests and verify GREEN**

Run:

```bash
pnpm --dir server test agent-message.controller.spec.ts
```

Expected: PASS.

- [ ] **Step 5: Run combined focused server tests**

Run:

```bash
pnpm --dir server test agent-message.controller.spec.ts agent-message.service.spec.ts agent-session.controller.spec.ts agent-session.service.spec.ts
pnpm --dir server test:medium agent-message.repository.spec.ts agent-session.repository.spec.ts
```

Expected: PASS.

- [ ] **Step 6: Commit API**

```bash
git add server/src/controllers/agent-message.controller.ts server/src/controllers/agent-message.controller.spec.ts server/src/controllers/index.ts
git commit -m "feat: add agent message api"
```

---

## Task 5: Generated Artifacts And Revert Coverage

**Files:**

- Modify: `scripts/revert-to-immich.sql`
- Modify: generated OpenAPI, TypeScript SDK, and mobile OpenAPI files.
- Test: generated SQL snapshots under `server/src/queries` if `sync:sql` changes them.

- [ ] **Step 1: Update revert script before generation checks**

Modify `scripts/revert-to-immich.sql`:

Drop `agent_message` before `agent_session`:

```sql
DROP TABLE IF EXISTS "agent_message" CASCADE;
DROP TABLE IF EXISTS "agent_session" CASCADE;
DROP TABLE IF EXISTS "agent_provider_credential" CASCADE;
```

Add migration cleanup entry:

```sql
'1778800000000-AgentMessage',
```

Add sanity check pattern near the existing agent patterns:

```sql
OR "name" LIKE '%AgentMessage%'
```

Add table sanity entry:

```sql
'agent_provider_credential', 'agent_session', 'agent_message'
```

- [ ] **Step 2: Run revert coverage check and verify GREEN**

Run the same coverage logic as `.github/workflows/gallery-revert-to-immich-validation.yml`:

```bash
set -euo pipefail
missing=0
while IFS= read -r file; do
  name=${file##*/}
  name=${name%.ts}
  if ! grep -qF "'${name}'" scripts/revert-to-immich.sql; then
    echo "Missing Gallery migration cleanup entry: ${name}"
    missing=1
  fi
done < <(find server/src/schema/migrations-gallery -maxdepth 1 -type f -name '*.ts' | sort)

UPSTREAM_TAG=v$(jq -r .version server/package.json)
upstream_migrations=$(mktemp)
trap 'rm -f "$upstream_migrations"' EXIT
gh api "repos/immich-app/immich/git/trees/${UPSTREAM_TAG}:server/src/schema/migrations" \
  --jq '.tree[].path' | sort > "$upstream_migrations"

while IFS= read -r file; do
  filename=${file##*/}
  name=${filename%.ts}
  if ! grep -qxF "$filename" "$upstream_migrations" && ! grep -qF "'${name}'" scripts/revert-to-immich.sql; then
    echo "Missing post-${UPSTREAM_TAG} upstream migration cleanup entry: ${name}"
    missing=1
  fi
done < <(find server/src/schema/migrations -maxdepth 1 -type f -name '*.ts' | sort)
exit "$missing"
```

Expected: PASS with no output.

- [ ] **Step 3: Generate API artifacts**

Run:

```bash
make open-api
```

If local `wget` is unavailable, use the same non-persistent shim used during slice 2 babysitting:

```bash
cd open-api
bash -c 'wget() { curl -L -o "$2" "$3"; }; export -f wget; bash ./bin/generate-open-api.sh'
```

Expected changes include:

- `open-api/immich-openapi-specs.json`
- `open-api/typescript-sdk/src/fetch-client.ts`
- mobile OpenAPI files for the new message DTOs and endpoints

- [ ] **Step 4: Run SQL generation**

Run:

```bash
pnpm --dir server sync:sql
```

Expected: generated SQL snapshots either stay unchanged or gain only `agent_message` repository query snapshots.

- [ ] **Step 5: Run final focused verification**

Run:

```bash
pnpm --dir server check
pnpm --dir server test agent-message.controller.spec.ts agent-message.service.spec.ts agent-session.controller.spec.ts agent-session.service.spec.ts
pnpm --dir server test:medium agent-message.repository.spec.ts agent-session.repository.spec.ts
git diff --check
```

Expected: all PASS.

- [ ] **Step 6: Verify generated clients expose the endpoints**

Run:

```bash
rg -n "appendAgentSessionMessage|getAgentSessionMessages|AgentMessageResponseDto|AgentMessageRole" open-api/typescript-sdk/src/fetch-client.ts mobile/openapi/lib mobile/openapi/README.md
```

Expected: results in TypeScript SDK and mobile OpenAPI generated files.

- [ ] **Step 7: Commit generated artifacts**

```bash
git add scripts/revert-to-immich.sql open-api/immich-openapi-specs.json open-api/typescript-sdk/src/fetch-client.ts mobile/openapi server/src/queries
git commit -m "chore: update agent message generated artifacts"
```

---

## Final Verification

Run all focused checks from a clean working tree:

```bash
git status --short --branch
pnpm --dir server check
pnpm --dir server test agent-message.controller.spec.ts agent-message.service.spec.ts agent-session.controller.spec.ts agent-session.service.spec.ts
pnpm --dir server test:medium agent-message.repository.spec.ts agent-session.repository.spec.ts
pnpm --dir server sync:sql
make open-api
git diff --check
```

Expected:

- Working tree clean after generated artifacts are committed.
- Server typecheck passes.
- Controller/service tests pass.
- Medium repository tests pass.
- SQL/OpenAPI generation produces no uncommitted changes.

## Edge Coverage Checklist

This plan covers:

- Empty message block list rejected.
- More than 100 message blocks rejected.
- Blank text rejected after trim.
- Text blocks above 8,000 characters rejected.
- Unknown block type rejected.
- Oversized full content rejected.
- Label/summary length bounded.
- Response/storage content accepts and persists text, tool-call, asset, and plan blocks.
- Cross-user append rejected through session ownership lookup.
- Cross-user list rejected through session ownership lookup.
- Missing session rejected before repository write/list.
- Append allowed only for `created`, `running`, `waiting_for_tool_approval`, `waiting_for_plan_review`, and `interrupted`.
- Append rejected for `applying`, `completed`, `cancelled`, and `failed`.
- Messages listed chronologically by `createdAt`, then `id`, including same-timestamp ties.
- Session deletion cascades message deletion.
- Public append API cannot spoof `assistant`, `system`, or `tool` roles.
- Public append API cannot set `providerMessageId` or `toolCallId`.
- Public append API cannot create unvalidated asset, tool-call, or plan reference blocks.
- Revert script removes table and migration rows.
- Generated clients expose typed message endpoints and DTOs.

## Review Notes

Spec coverage:

- Slice 3 asks for `agent_message` table and APIs: Tasks 1-4.
- Append/list messages: Tasks 2-4.
- Ordering: Task 2 medium tests, including equal-`createdAt` tie-breaking by `id`.
- Ownership: Task 3 service tests and Task 4 route permissions.
- Content shape: Task 1 DTO tests and Task 2 structured JSON persistence test.
- Durable state in Postgres without bulky media bytes: table stores JSON content only, not previews/originals.

Consistency checks:

- The endpoint is nested under `agent/sessions/:id/messages`, matching session ownership semantics.
- `AgentSessionRead` gates list; `AgentSessionUpdate` gates append.
- Service uses `AgentSessionRepository.getById(userId, id)` rather than duplicating ownership logic.
- `providerMessageId` and `toolCallId` are nullable for future runner/tool slices but not user-settable in the public append DTO.
- Response/storage content supports future structured blocks, while the public create DTO is text-only until access-checked asset/tool/plan references exist.

No known gaps remain for slice 3. Runner-authored assistant messages, streaming, tool call correlation, and UI are intentionally deferred to later slices.

Plan complete and saved to `docs/superpowers/plans/2026-05-14-pi-agent-persisted-chat-transcript.md`.
