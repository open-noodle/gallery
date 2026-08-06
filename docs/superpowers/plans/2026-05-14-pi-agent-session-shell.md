# Pi Agent Session Shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build vertical slice 2 for the Pi agent by adding durable, user-owned agent sessions with immutable credential/model/permission snapshots and authenticated create/list/get/cancel APIs.

**Architecture:** Gallery server remains the authority for session ownership, selected credential metadata, permission-plan snapshots, approval mode, and session lifecycle. This slice adds only the session shell: no runner dispatch, chat transcript, tool approvals, Pi calls, album operations, or Assistant UI. Sessions reference provider credentials when available, but persist redacted snapshots so existing sessions remain explainable if credentials are later edited or deleted.

**Tech Stack:** NestJS, Kysely, `@immich/sql-tools`, Postgres `jsonb`, Zod DTOs via `nestjs-zod`, Vitest, OpenAPI generation.

---

## Scope

This slice implements:

- `agent_session` table with user ownership and immutable JSON snapshots.
- Create, list, get, and cancel session APIs under `/agent/sessions`.
- Permission presets and custom permission-plan validation, including cross-field limit checks.
- Approval mode snapshots.
- Credential/model snapshots copied from the selected provider credential at create time.
- Runner endpoint plus an initially-null capability snapshot field, so slice 4 can populate runner capabilities without another session-schema redesign.
- User isolation tests for repository, service, and controller layers.

This slice intentionally does not implement:

- Pi runner sidecar calls.
- Chat messages.
- Streaming session events.
- Tool approval prompts or grants.
- Tool-call audit tables.
- Album operation plans or apply behavior.
- Web Assistant UI.

## File Structure

Create:

- `server/src/types/agent-session.types.ts` - shared snapshot types stored in JSON columns and returned through DTOs.
- `server/src/dtos/agent-session.dto.ts` - create and response schemas for the session shell.
- `server/src/schema/tables/agent-session.table.ts` - SQL-tools table for durable session state.
- `server/src/schema/migrations/1777100000000-AgentSession.ts` - migration for `agent_session`.
- `server/src/repositories/agent-session.repository.ts` - user-scoped Kysely create/list/get/update queries.
- `server/test/medium/specs/repositories/agent-session.repository.spec.ts` - DB-backed persistence, scoping, update, cascade, and snapshot coverage.
- `server/src/services/agent-session.service.ts` - session creation, preset resolution, snapshot mapping, list/get/cancel behavior.
- `server/src/services/agent-session.service.spec.ts` - service TDD coverage.
- `server/src/controllers/agent-session.controller.ts` - authenticated REST routes.
- `server/src/controllers/agent-session.controller.spec.ts` - route auth, UUID, DTO validation, and permission coverage.

Modify:

- `server/src/enum.ts` - add agent session enums, permissions, and API tag.
- `server/src/constants.ts` - add API tag text.
- `server/src/schema/index.ts` - register the table and DB interface.
- `server/src/database.ts` - add type and selected column list.
- `server/src/repositories/index.ts` - register repository provider.
- `server/src/services/index.ts` - register service provider.
- `server/src/controllers/index.ts` - register controller.
- Generated OpenAPI/SDK files changed by `make open-api-typescript`.

## API Contracts

Create route:

```text
POST /agent/sessions
```

Create body:

```json
{
  "providerCredentialId": "00000000-0000-0000-0000-000000000000",
  "model": "gpt-5.1",
  "permissionPreset": "visual-organizer",
  "approvalMode": "strict",
  "runnerEndpoint": "http://localhost:4477",
  "initialContext": {
    "entrypoint": "assistant-page"
  }
}
```

Custom create body:

```json
{
  "providerCredentialId": "00000000-0000-0000-0000-000000000000",
  "model": "gpt-5.1",
  "permissionPreset": "custom",
  "approvalMode": "plan-only",
  "permissionPlan": {
    "read": {
      "metadata": true,
      "previews": true,
      "originals": false
    },
    "providerExposure": {
      "metadata": true,
      "previews": true,
      "originals": false,
      "allowOriginalsForExternalProviders": false
    },
    "assetScope": {
      "owned": true,
      "sharedSpaces": true,
      "locked": false
    },
    "writeScope": {
      "createAlbum": true,
      "addAssets": true,
      "updateDetails": true,
      "setCover": true
    },
    "limits": {
      "maxAssetsPerToolCall": 500,
      "maxAssetsPerSession": 5000,
      "maxPreviewsPerToolCall": 100,
      "maxOriginalsPerToolCall": 0,
      "expiresInMinutes": 120
    }
  }
}
```

Response shape:

```json
{
  "id": "00000000-0000-0000-0000-000000000000",
  "status": "created",
  "providerCredentialId": "00000000-0000-0000-0000-000000000000",
  "credentialSnapshot": {
    "id": "00000000-0000-0000-0000-000000000000",
    "providerType": "openai",
    "label": "OpenAI personal",
    "baseUrl": null,
    "models": ["gpt-5.1"],
    "defaultModel": "gpt-5.1"
  },
  "modelSnapshot": {
    "providerCredentialId": "00000000-0000-0000-0000-000000000000",
    "model": "gpt-5.1"
  },
  "permissionPreset": "visual-organizer",
  "permissionPlanSnapshot": {
    "read": {
      "metadata": true,
      "previews": true,
      "originals": false
    },
    "providerExposure": {
      "metadata": true,
      "previews": true,
      "originals": false,
      "allowOriginalsForExternalProviders": false
    },
    "assetScope": {
      "owned": true,
      "sharedSpaces": true,
      "locked": false
    },
    "writeScope": {
      "createAlbum": true,
      "addAssets": true,
      "updateDetails": true,
      "setCover": true
    },
    "limits": {
      "maxAssetsPerToolCall": 500,
      "maxAssetsPerSession": 5000,
      "maxPreviewsPerToolCall": 100,
      "maxOriginalsPerToolCall": 0,
      "expiresInMinutes": 120
    }
  },
  "approvalMode": "strict",
  "runnerEndpoint": "http://localhost:4477",
  "runnerSessionId": null,
  "runnerCapabilitiesSnapshot": null,
  "initialContextSnapshot": {
    "entrypoint": "assistant-page"
  },
  "createdAt": "2026-05-14T00:00:00.000Z",
  "updatedAt": "2026-05-14T00:00:00.000Z",
  "endedAt": null
}
```

Routes:

```text
POST /agent/sessions
GET  /agent/sessions
GET  /agent/sessions/:id
POST /agent/sessions/:id/cancel
```

## Task 1: Contracts And DTO Validation

**Files:**

- Create: `server/src/types/agent-session.types.ts`
- Create: `server/src/dtos/agent-session.dto.ts`
- Modify: `server/src/enum.ts`
- Modify: `server/src/constants.ts`

- [ ] **Step 1: Add enums and permissions**

Add these enum values in `server/src/enum.ts`.

```ts
export enum AgentApprovalMode {
  Strict = 'strict',
  AskOnEscalation = 'ask-on-escalation',
  PlanOnly = 'plan-only',
  DangerouslySkipPermissions = 'dangerously-skip-permissions',
}

export enum AgentPermissionPreset {
  Careful = 'careful',
  VisualOrganizer = 'visual-organizer',
  LocalPowerUser = 'local-power-user',
  Custom = 'custom',
}

export enum AgentSessionStatus {
  Created = 'created',
  Running = 'running',
  WaitingForToolApproval = 'waiting_for_tool_approval',
  WaitingForPlanReview = 'waiting_for_plan_review',
  Applying = 'applying',
  Completed = 'completed',
  Cancelled = 'cancelled',
  Interrupted = 'interrupted',
  Failed = 'failed',
}
```

Add these permission values near the existing `AgentCredential*` permissions.

```ts
  AgentSessionCreate = 'agentSession.create',
  AgentSessionRead = 'agentSession.read',
  AgentSessionUpdate = 'agentSession.update',
```

Add this API tag next to `AgentCredentials`.

```ts
  AgentSessions = 'Agent sessions',
```

Add matching endpoint tag text in `server/src/constants.ts`; this is required because `endpointTags` is an exhaustive `Record<ApiTag, string>`.

```ts
  [ApiTag.AgentSessions]: 'AI agent session management',
```

- [ ] **Step 2: Create shared snapshot types**

Create `server/src/types/agent-session.types.ts`.

```ts
import { AgentPermissionPreset, AgentProviderType } from 'src/enum';

export type AgentCredentialSnapshot = {
  id: string;
  providerType: AgentProviderType;
  label: string;
  baseUrl: string | null;
  models: string[];
  defaultModel: string | null;
};

export type AgentModelSnapshot = {
  providerCredentialId: string;
  model: string;
};

export type AgentRunnerCapabilitiesSnapshot = Record<string, unknown> | null;

export type AgentPermissionPlanSnapshot = {
  read: {
    metadata: boolean;
    previews: boolean;
    originals: boolean;
  };
  providerExposure: {
    metadata: boolean;
    previews: boolean;
    originals: boolean;
    allowOriginalsForExternalProviders: boolean;
  };
  assetScope: {
    owned: boolean;
    sharedSpaces: boolean;
    locked: boolean;
  };
  writeScope: {
    createAlbum: boolean;
    addAssets: boolean;
    updateDetails: boolean;
    setCover: boolean;
  };
  limits: {
    maxAssetsPerToolCall: number;
    maxAssetsPerSession: number;
    maxPreviewsPerToolCall: number;
    maxOriginalsPerToolCall: number;
    expiresInMinutes: number | null;
  };
};

export type AgentInitialContextSnapshot = Record<string, unknown>;

export type AgentPermissionPresetMap = Record<
  Exclude<AgentPermissionPreset, AgentPermissionPreset.Custom>,
  AgentPermissionPlanSnapshot
>;
```

- [ ] **Step 3: Create DTO schemas**

Create `server/src/dtos/agent-session.dto.ts`.

```ts
import { createZodDto } from 'nestjs-zod';
import { AgentApprovalMode, AgentPermissionPreset, AgentProviderType, AgentSessionStatus } from 'src/enum';
import { isoDatetimeToDate } from 'src/validation';
import z from 'zod';

const MAX_INITIAL_CONTEXT_BYTES = 16_384;
const model = z.string().trim().min(1).max(160);
const models = z.array(model);
const jsonByteLength = (value: unknown) => Buffer.byteLength(JSON.stringify(value), 'utf8');

const AgentCredentialSnapshotSchema = z
  .object({
    id: z.uuidv4(),
    providerType: z.enum(AgentProviderType),
    label: z.string().trim().min(1).max(120),
    baseUrl: z.url().nullable(),
    models,
    defaultModel: model.nullable(),
  })
  .meta({ id: 'AgentCredentialSnapshot' });

const AgentModelSnapshotSchema = z
  .object({
    providerCredentialId: z.uuidv4(),
    model,
  })
  .meta({ id: 'AgentModelSnapshot' });

const AgentPermissionPlanSchema = z
  .object({
    read: z.object({
      metadata: z.boolean(),
      previews: z.boolean(),
      originals: z.boolean(),
    }),
    providerExposure: z.object({
      metadata: z.boolean(),
      previews: z.boolean(),
      originals: z.boolean(),
      allowOriginalsForExternalProviders: z.boolean(),
    }),
    assetScope: z.object({
      owned: z.boolean(),
      sharedSpaces: z.boolean(),
      locked: z.boolean(),
    }),
    writeScope: z.object({
      createAlbum: z.boolean(),
      addAssets: z.boolean(),
      updateDetails: z.boolean(),
      setCover: z.boolean(),
    }),
    limits: z.object({
      maxAssetsPerToolCall: z.number().int().min(1).max(10_000),
      maxAssetsPerSession: z.number().int().min(1).max(100_000),
      maxPreviewsPerToolCall: z.number().int().min(0).max(10_000),
      maxOriginalsPerToolCall: z.number().int().min(0).max(1_000),
      expiresInMinutes: z.number().int().min(1).max(10_080).nullable(),
    }),
  })
  .superRefine((value, ctx) => {
    if (value.providerExposure.metadata && !value.read.metadata) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['providerExposure', 'metadata'],
        message: 'metadata exposure requires metadata reads',
      });
    }

    if (value.providerExposure.previews && !value.read.previews) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['providerExposure', 'previews'],
        message: 'preview exposure requires preview reads',
      });
    }

    if (value.providerExposure.originals && !value.read.originals) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['providerExposure', 'originals'],
        message: 'original exposure requires original reads',
      });
    }

    if (value.limits.maxPreviewsPerToolCall > 0 && !value.read.previews) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['limits', 'maxPreviewsPerToolCall'],
        message: 'preview limits require preview reads',
      });
    }

    if (value.limits.maxOriginalsPerToolCall > 0 && !value.read.originals) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['limits', 'maxOriginalsPerToolCall'],
        message: 'original limits require original reads',
      });
    }

    if (value.limits.maxAssetsPerSession < value.limits.maxAssetsPerToolCall) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['limits', 'maxAssetsPerSession'],
        message: 'session asset limit must be at least the per-tool-call asset limit',
      });
    }

    if (value.limits.maxPreviewsPerToolCall > value.limits.maxAssetsPerToolCall) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['limits', 'maxPreviewsPerToolCall'],
        message: 'preview limit cannot exceed the per-tool-call asset limit',
      });
    }

    if (value.limits.maxOriginalsPerToolCall > value.limits.maxAssetsPerToolCall) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['limits', 'maxOriginalsPerToolCall'],
        message: 'original limit cannot exceed the per-tool-call asset limit',
      });
    }
  })
  .meta({ id: 'AgentPermissionPlan' });

const InitialContextSchema = z
  .record(z.string(), z.unknown())
  .refine((value) => jsonByteLength(value) <= MAX_INITIAL_CONTEXT_BYTES, {
    message: 'initialContext must be 16 KiB or less',
  })
  .meta({ id: 'AgentInitialContext' });

const RunnerCapabilitiesSnapshotSchema = z
  .record(z.string(), z.unknown())
  .nullable()
  .meta({ id: 'AgentRunnerCapabilitiesSnapshot' });

const AgentSessionCreateSchema = z
  .object({
    providerCredentialId: z.uuidv4(),
    model,
    permissionPreset: z.enum(AgentPermissionPreset),
    approvalMode: z.enum(AgentApprovalMode),
    permissionPlan: AgentPermissionPlanSchema.optional(),
    runnerEndpoint: z.url().nullable().optional(),
    initialContext: InitialContextSchema.optional(),
  })
  .superRefine((value, ctx) => {
    if (value.permissionPreset === AgentPermissionPreset.Custom && !value.permissionPlan) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['permissionPlan'],
        message: 'permissionPlan is required when permissionPreset is custom',
      });
    }

    if (value.permissionPreset !== AgentPermissionPreset.Custom && value.permissionPlan) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['permissionPlan'],
        message: 'permissionPlan is only accepted when permissionPreset is custom',
      });
    }
  })
  .meta({ id: 'AgentSessionCreateDto' });

const AgentSessionResponseSchema = z
  .object({
    id: z.uuidv4(),
    status: z.enum(AgentSessionStatus),
    providerCredentialId: z.uuidv4().nullable(),
    credentialSnapshot: AgentCredentialSnapshotSchema,
    modelSnapshot: AgentModelSnapshotSchema,
    permissionPreset: z.enum(AgentPermissionPreset),
    permissionPlanSnapshot: AgentPermissionPlanSchema,
    approvalMode: z.enum(AgentApprovalMode),
    runnerEndpoint: z.url().nullable(),
    runnerSessionId: z.string().nullable(),
    runnerCapabilitiesSnapshot: RunnerCapabilitiesSnapshotSchema,
    initialContextSnapshot: InitialContextSchema,
    createdAt: isoDatetimeToDate,
    updatedAt: isoDatetimeToDate,
    endedAt: isoDatetimeToDate.nullable(),
  })
  .meta({ id: 'AgentSessionResponseDto' });

export class AgentSessionCreateDto extends createZodDto(AgentSessionCreateSchema) {}
export class AgentSessionResponseDto extends createZodDto(AgentSessionResponseSchema) {}

export { AgentPermissionPlanSchema };
```

- [ ] **Step 4: Run DTO/type check**

Run:

```bash
pnpm --dir server check
```

Expected: PASS. These contract files are self-contained; any syntax, enum, or Zod type error here should be fixed before moving to storage work.

- [ ] **Step 5: Commit**

```bash
git add server/src/enum.ts server/src/constants.ts server/src/types/agent-session.types.ts server/src/dtos/agent-session.dto.ts docs/superpowers/plans/2026-05-14-pi-agent-session-shell.md
git commit -m "feat: add agent session contracts"
```

## Task 2: Session Table, Migration, And Repository

**Files:**

- Create: `server/src/schema/tables/agent-session.table.ts`
- Create: `server/src/schema/migrations/1777100000000-AgentSession.ts`
- Create: `server/src/repositories/agent-session.repository.ts`
- Create: `server/test/medium/specs/repositories/agent-session.repository.spec.ts`
- Modify: `server/src/schema/index.ts`
- Modify: `server/src/database.ts`
- Modify: `server/src/repositories/index.ts`

- [ ] **Step 1: Write the failing repository test**

Create `server/test/medium/specs/repositories/agent-session.repository.spec.ts`.

```ts
import { Kysely } from 'kysely';
import { AgentApprovalMode, AgentPermissionPreset, AgentProviderType, AgentSessionStatus } from 'src/enum';
import { AgentProviderCredentialRepository } from 'src/repositories/agent-provider-credential.repository';
import { AgentSessionRepository } from 'src/repositories/agent-session.repository';
import { LoggingRepository } from 'src/repositories/logging.repository';
import { DB } from 'src/schema';
import { BaseService } from 'src/services/base.service';
import type {
  AgentCredentialSnapshot,
  AgentInitialContextSnapshot,
  AgentModelSnapshot,
  AgentPermissionPlanSnapshot,
  AgentRunnerCapabilitiesSnapshot,
} from 'src/types/agent-session.types';
import { newMediumService } from 'test/medium.factory';
import { getKyselyDB } from 'test/utils';

let defaultDatabase: Kysely<DB>;

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
    sut: new AgentSessionRepository(database),
  };
};

const permissionPlan: AgentPermissionPlanSnapshot = {
  read: { metadata: true, previews: true, originals: false },
  providerExposure: {
    metadata: true,
    previews: true,
    originals: false,
    allowOriginalsForExternalProviders: false,
  },
  assetScope: { owned: true, sharedSpaces: true, locked: false },
  writeScope: { createAlbum: true, addAssets: true, updateDetails: true, setCover: true },
  limits: {
    maxAssetsPerToolCall: 500,
    maxAssetsPerSession: 5000,
    maxPreviewsPerToolCall: 100,
    maxOriginalsPerToolCall: 0,
    expiresInMinutes: 120,
  },
};

beforeAll(async () => {
  defaultDatabase = await getKyselyDB();
});

describe(AgentSessionRepository.name, () => {
  it('persists sessions and scopes reads and updates by user', async () => {
    const { ctx, credentialRepository, sut } = setup();
    const { user } = await ctx.newUser();
    const { user: otherUser } = await ctx.newUser();
    const credential = await credentialRepository.create({
      userId: user.id,
      providerType: AgentProviderType.OpenAI,
      label: 'OpenAI personal',
      baseUrl: null,
      encryptedSecret: 'v1:encrypted',
      secretVersion: 1,
      models: ['gpt-5.1'],
      defaultModel: 'gpt-5.1',
    });
    const credentialSnapshot: AgentCredentialSnapshot = {
      id: credential.id,
      providerType: credential.providerType,
      label: credential.label,
      baseUrl: credential.baseUrl,
      models: credential.models,
      defaultModel: credential.defaultModel,
    };
    const modelSnapshot: AgentModelSnapshot = {
      providerCredentialId: credential.id,
      model: 'gpt-5.1',
    };
    const initialContextSnapshot: AgentInitialContextSnapshot = { entrypoint: 'medium-test' };
    const runnerCapabilitiesSnapshot: AgentRunnerCapabilitiesSnapshot = null;

    const created = await sut.create({
      userId: user.id,
      providerCredentialId: credential.id,
      credentialSnapshot,
      modelSnapshot,
      permissionPreset: AgentPermissionPreset.VisualOrganizer,
      permissionPlanSnapshot: permissionPlan,
      approvalMode: AgentApprovalMode.Strict,
      runnerEndpoint: 'http://localhost:4477',
      runnerSessionId: null,
      runnerCapabilitiesSnapshot,
      initialContextSnapshot,
      status: AgentSessionStatus.Created,
      createdAt: new Date('2026-05-14T11:00:00Z'),
    });

    expect(created).toMatchObject({
      userId: user.id,
      providerCredentialId: credential.id,
      credentialSnapshot,
      modelSnapshot,
      permissionPreset: AgentPermissionPreset.VisualOrganizer,
      permissionPlanSnapshot: permissionPlan,
      approvalMode: AgentApprovalMode.Strict,
      runnerEndpoint: 'http://localhost:4477',
      runnerSessionId: null,
      runnerCapabilitiesSnapshot,
      initialContextSnapshot,
      status: AgentSessionStatus.Created,
      endedAt: null,
    });
    expect(created.id).toBeDefined();
    expect(created.createdAt).toBeDefined();
    expect(created.updatedAt).toBeDefined();
    expect(created.updateId).toBeDefined();

    const second = await sut.create({
      userId: user.id,
      providerCredentialId: credential.id,
      credentialSnapshot,
      modelSnapshot: { providerCredentialId: credential.id, model: 'gpt-5.1-mini' },
      permissionPreset: AgentPermissionPreset.Careful,
      permissionPlanSnapshot: permissionPlan,
      approvalMode: AgentApprovalMode.PlanOnly,
      runnerEndpoint: null,
      runnerSessionId: null,
      runnerCapabilitiesSnapshot: null,
      initialContextSnapshot: {},
      status: AgentSessionStatus.Created,
      createdAt: new Date('2026-05-14T12:00:00Z'),
    });

    await expect(sut.getById(user.id, created.id)).resolves.toMatchObject({ id: created.id });
    await expect(sut.getById(otherUser.id, created.id)).resolves.toBeUndefined();
    await expect(sut.getByUserId(user.id)).resolves.toEqual([
      expect.objectContaining({ id: second.id }),
      expect.objectContaining({ id: created.id }),
    ]);
    await expect(sut.getByUserId(otherUser.id)).resolves.toEqual([]);

    const endedAt = new Date('2026-05-14T12:00:00Z');
    const updated = await sut.update(user.id, created.id, {
      status: AgentSessionStatus.Cancelled,
      endedAt,
    });

    expect(updated).toMatchObject({
      id: created.id,
      status: AgentSessionStatus.Cancelled,
      endedAt,
    });
    await expect(sut.update(otherUser.id, created.id, { status: AgentSessionStatus.Running })).rejects.toThrow();
  });

  it('keeps session snapshots when the selected provider credential is deleted', async () => {
    const { ctx, credentialRepository, sut } = setup();
    const { user } = await ctx.newUser();
    const credential = await credentialRepository.create({
      userId: user.id,
      providerType: AgentProviderType.Anthropic,
      label: 'Anthropic',
      baseUrl: null,
      encryptedSecret: 'v1:encrypted',
      models: ['claude-sonnet-4.5'],
      defaultModel: 'claude-sonnet-4.5',
    });
    const credentialSnapshot: AgentCredentialSnapshot = {
      id: credential.id,
      providerType: credential.providerType,
      label: credential.label,
      baseUrl: credential.baseUrl,
      models: credential.models,
      defaultModel: credential.defaultModel,
    };

    const created = await sut.create({
      userId: user.id,
      providerCredentialId: credential.id,
      credentialSnapshot,
      modelSnapshot: { providerCredentialId: credential.id, model: 'claude-sonnet-4.5' },
      permissionPreset: AgentPermissionPreset.Careful,
      permissionPlanSnapshot: permissionPlan,
      approvalMode: AgentApprovalMode.PlanOnly,
      runnerEndpoint: null,
      runnerSessionId: null,
      runnerCapabilitiesSnapshot: null,
      initialContextSnapshot: {},
      status: AgentSessionStatus.Created,
    });

    await credentialRepository.delete(user.id, credential.id);

    await expect(sut.getById(user.id, created.id)).resolves.toMatchObject({
      id: created.id,
      providerCredentialId: null,
      credentialSnapshot,
    });
  });

  it('cascades sessions when the owning user is deleted', async () => {
    const { ctx, credentialRepository, sut } = setup();
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
    const credentialSnapshot: AgentCredentialSnapshot = {
      id: credential.id,
      providerType: credential.providerType,
      label: credential.label,
      baseUrl: credential.baseUrl,
      models: credential.models,
      defaultModel: credential.defaultModel,
    };
    const created = await sut.create({
      userId: user.id,
      providerCredentialId: credential.id,
      credentialSnapshot,
      modelSnapshot: { providerCredentialId: credential.id, model: 'gpt-5.1' },
      permissionPreset: AgentPermissionPreset.Careful,
      permissionPlanSnapshot: permissionPlan,
      approvalMode: AgentApprovalMode.Strict,
      runnerEndpoint: null,
      runnerSessionId: null,
      runnerCapabilitiesSnapshot: null,
      initialContextSnapshot: {},
      status: AgentSessionStatus.Created,
    });

    await ctx.database.deleteFrom('user').where('id', '=', user.id).execute();

    await expect(sut.getById(user.id, created.id)).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run repository test to verify it fails**

Run:

```bash
pnpm --dir server test:medium agent-session.repository.spec.ts
```

Expected: FAIL with missing `AgentSessionRepository` or missing `agent_session` table.

- [ ] **Step 3: Add the session table**

Create `server/src/schema/tables/agent-session.table.ts`.

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
import { UpdatedAtTrigger, UpdateIdColumn } from 'src/decorators';
import { AgentApprovalMode, AgentPermissionPreset, AgentSessionStatus } from 'src/enum';
import { AgentProviderCredentialTable } from 'src/schema/tables/agent-provider-credential.table';
import { UserTable } from 'src/schema/tables/user.table';
import type {
  AgentCredentialSnapshot,
  AgentInitialContextSnapshot,
  AgentModelSnapshot,
  AgentPermissionPlanSnapshot,
  AgentRunnerCapabilitiesSnapshot,
} from 'src/types/agent-session.types';

@Index({ columns: ['userId'] })
@Index({ columns: ['userId', 'status'] })
@Table('agent_session')
@UpdatedAtTrigger('agent_session_updatedAt')
export class AgentSessionTable {
  @PrimaryGeneratedColumn()
  id!: Generated<string>;

  @ForeignKeyColumn(() => UserTable, { onUpdate: 'CASCADE', onDelete: 'CASCADE' })
  userId!: string;

  @ForeignKeyColumn(() => AgentProviderCredentialTable, {
    onUpdate: 'CASCADE',
    onDelete: 'SET NULL',
    nullable: true,
  })
  providerCredentialId!: string | null;

  @Column({ type: 'jsonb' })
  credentialSnapshot!: AgentCredentialSnapshot;

  @Column({ type: 'jsonb' })
  modelSnapshot!: AgentModelSnapshot;

  @Column()
  permissionPreset!: AgentPermissionPreset;

  @Column({ type: 'jsonb' })
  permissionPlanSnapshot!: AgentPermissionPlanSnapshot;

  @Column()
  approvalMode!: AgentApprovalMode;

  @Column({ nullable: true })
  runnerEndpoint!: string | null;

  @Column({ nullable: true })
  runnerSessionId!: string | null;

  @Column({ type: 'jsonb', nullable: true })
  runnerCapabilitiesSnapshot!: AgentRunnerCapabilitiesSnapshot;

  @Column({ default: AgentSessionStatus.Created })
  status!: Generated<AgentSessionStatus>;

  @Column({ type: 'jsonb' })
  initialContextSnapshot!: AgentInitialContextSnapshot;

  @CreateDateColumn()
  createdAt!: Generated<Timestamp>;

  @UpdateDateColumn()
  updatedAt!: Generated<Timestamp>;

  @Column({ type: 'timestamp with time zone', nullable: true })
  endedAt!: Timestamp | null;

  @UpdateIdColumn({ index: true })
  updateId!: Generated<string>;
}
```

- [ ] **Step 4: Add the migration**

Create `server/src/schema/migrations/1777100000000-AgentSession.ts`.

```ts
import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE "agent_session" (
      "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
      "userId" uuid NOT NULL,
      "providerCredentialId" uuid,
      "credentialSnapshot" jsonb NOT NULL,
      "modelSnapshot" jsonb NOT NULL,
      "permissionPreset" character varying NOT NULL,
      "permissionPlanSnapshot" jsonb NOT NULL,
      "approvalMode" character varying NOT NULL,
      "runnerEndpoint" character varying,
      "runnerSessionId" character varying,
      "runnerCapabilitiesSnapshot" jsonb,
      "status" character varying NOT NULL DEFAULT 'created',
      "initialContextSnapshot" jsonb NOT NULL,
      "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
      "updatedAt" timestamp with time zone NOT NULL DEFAULT now(),
      "endedAt" timestamp with time zone,
      "updateId" uuid NOT NULL DEFAULT immich_uuid_v7(),
      CONSTRAINT "agent_session_pkey" PRIMARY KEY ("id"),
      CONSTRAINT "agent_session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON UPDATE CASCADE ON DELETE CASCADE,
      CONSTRAINT "agent_session_providerCredentialId_fkey" FOREIGN KEY ("providerCredentialId") REFERENCES "agent_provider_credential"("id") ON UPDATE CASCADE ON DELETE SET NULL
    )
  `.execute(db);

  await sql`CREATE INDEX "agent_session_userId_idx" ON "agent_session" ("userId")`.execute(db);
  await sql`CREATE INDEX "agent_session_userId_status_idx" ON "agent_session" ("userId", "status")`.execute(db);
  await sql`CREATE INDEX "agent_session_updateId_idx" ON "agent_session" ("updateId")`.execute(db);
  await sql`
    CREATE OR REPLACE TRIGGER "agent_session_updatedAt"
    BEFORE UPDATE ON "agent_session"
    FOR EACH ROW
    EXECUTE FUNCTION updated_at()
  `.execute(db);

  await sql`INSERT INTO "migration_overrides" ("name", "value") VALUES ('trigger_agent_session_updatedAt', '{"type":"trigger","name":"agent_session_updatedAt","sql":"CREATE OR REPLACE TRIGGER \\"agent_session_updatedAt\\"\\n  BEFORE UPDATE ON \\"agent_session\\"\\n  FOR EACH ROW\\n  EXECUTE FUNCTION updated_at();"}'::jsonb)`.execute(
    db,
  );
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    DELETE FROM "migration_overrides"
    WHERE "name" = 'trigger_agent_session_updatedAt'
  `.execute(db);

  await sql`DROP TRIGGER IF EXISTS "agent_session_updatedAt" ON "agent_session"`.execute(db);
  await sql`DROP TABLE "agent_session"`.execute(db);
}
```

- [ ] **Step 5: Register schema and database columns**

Modify `server/src/schema/index.ts`.

```ts
import { AgentSessionTable } from 'src/schema/tables/agent-session.table';
```

Add `AgentSessionTable` to the SQL-tools table list.

```ts
    AgentSessionTable,
```

Add the DB mapping.

```ts
agent_session: AgentSessionTable;
```

Modify `server/src/database.ts`.

```ts
import { AgentSessionTable } from 'src/schema/tables/agent-session.table';
```

Add the selectable type.

```ts
export type AgentSession = Selectable<AgentSessionTable>;
```

Add the column list inside `columns`.

```ts
  agentSession: [
    'id',
    'userId',
    'providerCredentialId',
    'credentialSnapshot',
    'modelSnapshot',
    'permissionPreset',
    'permissionPlanSnapshot',
    'approvalMode',
    'runnerEndpoint',
    'runnerSessionId',
    'runnerCapabilitiesSnapshot',
    'status',
    'initialContextSnapshot',
    'createdAt',
    'updatedAt',
    'endedAt',
    'updateId',
  ],
```

- [ ] **Step 6: Add the repository**

Create `server/src/repositories/agent-session.repository.ts`.

```ts
import { Injectable } from '@nestjs/common';
import { Insertable, Kysely, Updateable } from 'kysely';
import { InjectKysely } from 'nestjs-kysely';
import { columns } from 'src/database';
import { DummyValue, GenerateSql } from 'src/decorators';
import { DB } from 'src/schema';
import { AgentSessionTable } from 'src/schema/tables/agent-session.table';
import { asUuid } from 'src/utils/database';

@Injectable()
export class AgentSessionRepository {
  constructor(@InjectKysely() private db: Kysely<DB>) {}

  create(dto: Insertable<AgentSessionTable>) {
    return this.db.insertInto('agent_session').values(dto).returning(columns.agentSession).executeTakeFirstOrThrow();
  }

  @GenerateSql({ params: [DummyValue.UUID] })
  getByUserId(userId: string) {
    return this.db
      .selectFrom('agent_session')
      .select(columns.agentSession)
      .where('userId', '=', userId)
      .orderBy('createdAt', 'desc')
      .execute();
  }

  @GenerateSql({ params: [DummyValue.UUID, DummyValue.UUID] })
  getById(userId: string, id: string) {
    return this.db
      .selectFrom('agent_session')
      .select(columns.agentSession)
      .where('userId', '=', userId)
      .where('id', '=', asUuid(id))
      .executeTakeFirst();
  }

  update(userId: string, id: string, dto: Updateable<AgentSessionTable>) {
    return this.db
      .updateTable('agent_session')
      .set(dto)
      .where('userId', '=', userId)
      .where('id', '=', asUuid(id))
      .returning(columns.agentSession)
      .executeTakeFirstOrThrow();
  }
}
```

Modify `server/src/repositories/index.ts`.

```ts
import { AgentSessionRepository } from 'src/repositories/agent-session.repository';
```

Add the provider.

```ts
  AgentSessionRepository,
```

- [ ] **Step 7: Run repository test to verify it passes**

Run:

```bash
pnpm --dir server test:medium agent-session.repository.spec.ts
```

Expected: PASS with 3 tests.

- [ ] **Step 8: Generate SQL query snapshots**

Run:

```bash
pnpm --dir server run sync:sql
```

Expected: generated query file for `AgentSessionRepository` is created under `server/src/queries/` and no unrelated query files change.

- [ ] **Step 9: Commit**

```bash
git add server/src/schema/tables/agent-session.table.ts server/src/schema/migrations/1777100000000-AgentSession.ts server/src/schema/index.ts server/src/database.ts server/src/repositories/agent-session.repository.ts server/src/repositories/index.ts server/test/medium/specs/repositories/agent-session.repository.spec.ts server/src/queries
git commit -m "feat: add agent session storage"
```

## Task 3: Session Service

**Files:**

- Create: `server/src/services/agent-session.service.ts`
- Create: `server/src/services/agent-session.service.spec.ts`
- Modify: `server/src/services/index.ts`

- [ ] **Step 1: Write the failing service test**

Create `server/src/services/agent-session.service.spec.ts`.

```ts
import { BadRequestException } from '@nestjs/common';
import { AgentSession } from 'src/database';
import { AgentApprovalMode, AgentPermissionPreset, AgentProviderType, AgentSessionStatus } from 'src/enum';
import { AgentSessionRepository } from 'src/repositories/agent-session.repository';
import { AgentProviderCredentialService } from 'src/services/agent-provider-credential.service';
import { AgentSessionService } from 'src/services/agent-session.service';
import type { AgentPermissionPlanSnapshot } from 'src/types/agent-session.types';
import { AuthFactory } from 'test/factories/auth.factory';
import { newUuid } from 'test/small.factory';
import { automock } from 'test/utils';

const now = new Date('2026-05-14T12:00:00.000Z');
const credentialId = newUuid();

const customPlan: AgentPermissionPlanSnapshot = {
  read: { metadata: true, previews: true, originals: false },
  providerExposure: {
    metadata: true,
    previews: true,
    originals: false,
    allowOriginalsForExternalProviders: false,
  },
  assetScope: { owned: true, sharedSpaces: true, locked: false },
  writeScope: { createAlbum: true, addAssets: true, updateDetails: true, setCover: true },
  limits: {
    maxAssetsPerToolCall: 500,
    maxAssetsPerSession: 5000,
    maxPreviewsPerToolCall: 100,
    maxOriginalsPerToolCall: 0,
    expiresInMinutes: 120,
  },
};

const credentialResponse = {
  id: credentialId,
  providerType: AgentProviderType.OpenAI,
  label: 'OpenAI personal',
  baseUrl: null,
  models: ['gpt-5.1', 'gpt-5.1-mini'],
  defaultModel: 'gpt-5.1',
  createdAt: now,
  updatedAt: now,
  lastUsedAt: null,
};

const makeSession = (overrides: Partial<AgentSession> = {}): AgentSession => ({
  id: newUuid(),
  userId: newUuid(),
  providerCredentialId: credentialId,
  credentialSnapshot: {
    id: credentialResponse.id,
    providerType: credentialResponse.providerType,
    label: credentialResponse.label,
    baseUrl: credentialResponse.baseUrl,
    models: credentialResponse.models,
    defaultModel: credentialResponse.defaultModel,
  },
  modelSnapshot: { providerCredentialId: credentialId, model: 'gpt-5.1' },
  permissionPreset: AgentPermissionPreset.VisualOrganizer,
  permissionPlanSnapshot: customPlan,
  approvalMode: AgentApprovalMode.Strict,
  runnerEndpoint: 'http://localhost:4477',
  runnerSessionId: null,
  runnerCapabilitiesSnapshot: null,
  status: AgentSessionStatus.Created,
  initialContextSnapshot: { entrypoint: 'assistant-page' },
  createdAt: now,
  updatedAt: now,
  endedAt: null,
  updateId: newUuid(),
  ...overrides,
});

describe(AgentSessionService.name, () => {
  let sut: AgentSessionService;
  let repository: ReturnType<typeof automock<AgentSessionRepository>>;
  let credentials: ReturnType<typeof automock<AgentProviderCredentialService>>;

  beforeEach(() => {
    repository = automock(AgentSessionRepository);
    credentials = automock(AgentProviderCredentialService, { args: [{} as never, {} as never] });
    sut = new AgentSessionService(repository, credentials);
  });

  it('creates a session with credential, model, permission, approval, and initial context snapshots', async () => {
    const auth = AuthFactory.create();
    const created = makeSession({ userId: auth.user.id });

    credentials.getById.mockResolvedValue(credentialResponse);
    repository.create.mockResolvedValue(created);

    const result = await sut.create(auth, {
      providerCredentialId: credentialId,
      model: 'gpt-5.1',
      permissionPreset: AgentPermissionPreset.VisualOrganizer,
      approvalMode: AgentApprovalMode.Strict,
      runnerEndpoint: 'http://localhost:4477',
      initialContext: { entrypoint: 'assistant-page' },
    });

    expect(credentials.getById).toHaveBeenCalledWith(auth, credentialId);
    expect(repository.create).toHaveBeenCalledWith({
      userId: auth.user.id,
      providerCredentialId: credentialId,
      credentialSnapshot: {
        id: credentialResponse.id,
        providerType: credentialResponse.providerType,
        label: credentialResponse.label,
        baseUrl: credentialResponse.baseUrl,
        models: credentialResponse.models,
        defaultModel: credentialResponse.defaultModel,
      },
      modelSnapshot: { providerCredentialId: credentialId, model: 'gpt-5.1' },
      permissionPreset: AgentPermissionPreset.VisualOrganizer,
      permissionPlanSnapshot: AgentSessionService.permissionPresets[AgentPermissionPreset.VisualOrganizer],
      approvalMode: AgentApprovalMode.Strict,
      runnerEndpoint: 'http://localhost:4477',
      runnerSessionId: null,
      runnerCapabilitiesSnapshot: null,
      initialContextSnapshot: { entrypoint: 'assistant-page' },
      status: AgentSessionStatus.Created,
    });
    expect(result).toEqual({
      id: created.id,
      status: created.status,
      providerCredentialId: created.providerCredentialId,
      credentialSnapshot: created.credentialSnapshot,
      modelSnapshot: created.modelSnapshot,
      permissionPreset: created.permissionPreset,
      permissionPlanSnapshot: created.permissionPlanSnapshot,
      approvalMode: created.approvalMode,
      runnerEndpoint: created.runnerEndpoint,
      runnerSessionId: created.runnerSessionId,
      runnerCapabilitiesSnapshot: created.runnerCapabilitiesSnapshot,
      initialContextSnapshot: created.initialContextSnapshot,
      createdAt: created.createdAt,
      updatedAt: created.updatedAt,
      endedAt: created.endedAt,
    });
  });

  it('creates a custom session only when a full permission plan is supplied', async () => {
    const auth = AuthFactory.create();
    const created = makeSession({
      userId: auth.user.id,
      permissionPreset: AgentPermissionPreset.Custom,
      permissionPlanSnapshot: customPlan,
    });

    credentials.getById.mockResolvedValue(credentialResponse);
    repository.create.mockResolvedValue(created);

    await sut.create(auth, {
      providerCredentialId: credentialId,
      model: 'gpt-5.1',
      permissionPreset: AgentPermissionPreset.Custom,
      permissionPlan: customPlan,
      approvalMode: AgentApprovalMode.PlanOnly,
    });

    expect(repository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        permissionPreset: AgentPermissionPreset.Custom,
        permissionPlanSnapshot: customPlan,
      }),
    );
  });

  it('rejects a custom session without a permission plan', async () => {
    const auth = AuthFactory.create();

    await expect(
      sut.create(auth, {
        providerCredentialId: credentialId,
        model: 'gpt-5.1',
        permissionPreset: AgentPermissionPreset.Custom,
        approvalMode: AgentApprovalMode.PlanOnly,
      }),
    ).rejects.toThrow('permissionPlan is required when permissionPreset is custom');

    expect(credentials.getById).not.toHaveBeenCalled();
    expect(repository.create).not.toHaveBeenCalled();
  });

  it('defaults optional runner endpoint, runner capabilities, and initial context snapshots', async () => {
    const auth = AuthFactory.create();
    const created = makeSession({
      userId: auth.user.id,
      runnerEndpoint: null,
      runnerCapabilitiesSnapshot: null,
      initialContextSnapshot: {},
    });

    credentials.getById.mockResolvedValue(credentialResponse);
    repository.create.mockResolvedValue(created);

    await sut.create(auth, {
      providerCredentialId: credentialId,
      model: 'gpt-5.1',
      permissionPreset: AgentPermissionPreset.Careful,
      approvalMode: AgentApprovalMode.Strict,
    });

    expect(repository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        runnerEndpoint: null,
        runnerCapabilitiesSnapshot: null,
        initialContextSnapshot: {},
      }),
    );
  });

  it('does not create a session when selected credential lookup fails', async () => {
    const auth = AuthFactory.create();

    credentials.getById.mockRejectedValue(new BadRequestException('Agent provider credential not found'));

    await expect(
      sut.create(auth, {
        providerCredentialId: credentialId,
        model: 'gpt-5.1',
        permissionPreset: AgentPermissionPreset.Careful,
        approvalMode: AgentApprovalMode.Strict,
      }),
    ).rejects.toThrow('Agent provider credential not found');

    expect(repository.create).not.toHaveBeenCalled();
  });

  it('rejects a model that is not listed on the selected credential when the credential has model constraints', async () => {
    const auth = AuthFactory.create();

    credentials.getById.mockResolvedValue(credentialResponse);

    await expect(
      sut.create(auth, {
        providerCredentialId: credentialId,
        model: 'gpt-4.1',
        permissionPreset: AgentPermissionPreset.Careful,
        approvalMode: AgentApprovalMode.Strict,
      }),
    ).rejects.toThrow('Model is not listed for the selected credential');

    expect(repository.create).not.toHaveBeenCalled();
  });

  it('allows any model when the selected credential has no model constraints', async () => {
    const auth = AuthFactory.create();
    const unconstrainedCredential = { ...credentialResponse, models: [], defaultModel: null };
    const created = makeSession({
      userId: auth.user.id,
      modelSnapshot: { providerCredentialId: credentialId, model: 'custom-model' },
    });

    credentials.getById.mockResolvedValue(unconstrainedCredential);
    repository.create.mockResolvedValue(created);

    await sut.create(auth, {
      providerCredentialId: credentialId,
      model: 'custom-model',
      permissionPreset: AgentPermissionPreset.Careful,
      approvalMode: AgentApprovalMode.Strict,
    });

    expect(repository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        modelSnapshot: { providerCredentialId: credentialId, model: 'custom-model' },
      }),
    );
  });

  it('lists sessions for the authenticated user and does not re-read credentials', async () => {
    const auth = AuthFactory.create();
    const sessions = [makeSession({ userId: auth.user.id })];

    repository.getByUserId.mockResolvedValue(sessions);

    const result = await sut.getAll(auth);

    expect(repository.getByUserId).toHaveBeenCalledWith(auth.user.id);
    expect(credentials.getById).not.toHaveBeenCalled();
    expect(result).toEqual([expect.objectContaining({ id: sessions[0].id })]);
  });

  it('gets a session by owner and preserves stored snapshots without consulting current credential metadata', async () => {
    const auth = AuthFactory.create();
    const session = makeSession({
      userId: auth.user.id,
      credentialSnapshot: {
        id: credentialId,
        providerType: AgentProviderType.OpenAI,
        label: 'Old label',
        baseUrl: null,
        models: ['old-model'],
        defaultModel: 'old-model',
      },
    });

    repository.getById.mockResolvedValue(session);

    const result = await sut.getById(auth, session.id);

    expect(repository.getById).toHaveBeenCalledWith(auth.user.id, session.id);
    expect(credentials.getById).not.toHaveBeenCalled();
    expect(result.credentialSnapshot.label).toBe('Old label');
  });

  it('throws when fetching a missing session', async () => {
    const auth = AuthFactory.create();
    const id = newUuid();

    repository.getById.mockResolvedValue(void 0);

    await expect(sut.getById(auth, id)).rejects.toThrow(BadRequestException);
    await expect(sut.getById(auth, id)).rejects.toThrow('Agent session not found');
  });

  it.each([
    AgentSessionStatus.Created,
    AgentSessionStatus.Running,
    AgentSessionStatus.WaitingForToolApproval,
    AgentSessionStatus.WaitingForPlanReview,
    AgentSessionStatus.Interrupted,
  ])('cancels an active %s session and sets endedAt', async (status) => {
    const auth = AuthFactory.create();
    const session = makeSession({ userId: auth.user.id, status });
    const cancelled = makeSession({
      ...session,
      status: AgentSessionStatus.Cancelled,
      endedAt: new Date('2026-05-14T12:10:00.000Z'),
    });

    repository.getById.mockResolvedValue(session);
    repository.update.mockResolvedValue(cancelled);

    const result = await sut.cancel(auth, session.id);

    expect(repository.update).toHaveBeenCalledWith(auth.user.id, session.id, {
      status: AgentSessionStatus.Cancelled,
      endedAt: expect.any(Date),
    });
    expect(result.status).toBe(AgentSessionStatus.Cancelled);
    expect(result.endedAt).toEqual(cancelled.endedAt);
  });

  it('returns an already-cancelled session without updating it again', async () => {
    const auth = AuthFactory.create();
    const session = makeSession({ userId: auth.user.id, status: AgentSessionStatus.Cancelled, endedAt: now });

    repository.getById.mockResolvedValue(session);

    await expect(sut.cancel(auth, session.id)).resolves.toMatchObject({
      id: session.id,
      status: AgentSessionStatus.Cancelled,
    });
    expect(repository.update).not.toHaveBeenCalled();
  });

  it.each([AgentSessionStatus.Applying, AgentSessionStatus.Completed, AgentSessionStatus.Failed])(
    'rejects cancelling a non-cancellable %s session',
    async (status) => {
      const auth = AuthFactory.create();
      const session = makeSession({ userId: auth.user.id, status, endedAt: now });

      repository.getById.mockResolvedValue(session);

      await expect(sut.cancel(auth, session.id)).rejects.toThrow(
        'Agent session cannot be cancelled in its current state',
      );
      expect(repository.update).not.toHaveBeenCalled();
    },
  );
});
```

- [ ] **Step 2: Run service test to verify it fails**

Run:

```bash
pnpm --dir server test agent-session.service.spec.ts
```

Expected: FAIL with missing `AgentSessionService`.

- [ ] **Step 3: Add the service implementation**

Create `server/src/services/agent-session.service.ts`.

```ts
import { BadRequestException, Injectable } from '@nestjs/common';
import { AgentSession } from 'src/database';
import { AgentSessionCreateDto, AgentSessionResponseDto } from 'src/dtos/agent-session.dto';
import { AuthDto } from 'src/dtos/auth.dto';
import { AgentPermissionPreset, AgentSessionStatus } from 'src/enum';
import { AgentSessionRepository } from 'src/repositories/agent-session.repository';
import { AgentProviderCredentialService } from 'src/services/agent-provider-credential.service';
import type {
  AgentCredentialSnapshot,
  AgentPermissionPlanSnapshot,
  AgentPermissionPresetMap,
} from 'src/types/agent-session.types';

const nonCancellableStatuses = new Set<AgentSessionStatus>([
  AgentSessionStatus.Applying,
  AgentSessionStatus.Completed,
  AgentSessionStatus.Failed,
]);

@Injectable()
export class AgentSessionService {
  static readonly permissionPresets: AgentPermissionPresetMap = {
    [AgentPermissionPreset.Careful]: {
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
        maxAssetsPerToolCall: 200,
        maxAssetsPerSession: 2000,
        maxPreviewsPerToolCall: 0,
        maxOriginalsPerToolCall: 0,
        expiresInMinutes: 120,
      },
    },
    [AgentPermissionPreset.VisualOrganizer]: {
      read: { metadata: true, previews: true, originals: false },
      providerExposure: {
        metadata: true,
        previews: true,
        originals: false,
        allowOriginalsForExternalProviders: false,
      },
      assetScope: { owned: true, sharedSpaces: true, locked: false },
      writeScope: { createAlbum: true, addAssets: true, updateDetails: true, setCover: true },
      limits: {
        maxAssetsPerToolCall: 500,
        maxAssetsPerSession: 5000,
        maxPreviewsPerToolCall: 100,
        maxOriginalsPerToolCall: 0,
        expiresInMinutes: 120,
      },
    },
    [AgentPermissionPreset.LocalPowerUser]: {
      read: { metadata: true, previews: true, originals: true },
      providerExposure: {
        metadata: true,
        previews: true,
        originals: true,
        allowOriginalsForExternalProviders: false,
      },
      assetScope: { owned: true, sharedSpaces: true, locked: false },
      writeScope: { createAlbum: true, addAssets: true, updateDetails: true, setCover: true },
      limits: {
        maxAssetsPerToolCall: 500,
        maxAssetsPerSession: 5000,
        maxPreviewsPerToolCall: 100,
        maxOriginalsPerToolCall: 25,
        expiresInMinutes: 120,
      },
    },
  };

  constructor(
    private readonly repository: AgentSessionRepository,
    private readonly credentialService: AgentProviderCredentialService,
  ) {}

  async create(auth: AuthDto, dto: AgentSessionCreateDto): Promise<AgentSessionResponseDto> {
    const permissionPlanSnapshot = this.resolvePermissionPlan(dto);
    const credential = await this.credentialService.getById(auth, dto.providerCredentialId);

    if (credential.models.length > 0 && !credential.models.includes(dto.model)) {
      throw new BadRequestException('Model is not listed for the selected credential');
    }

    const credentialSnapshot: AgentCredentialSnapshot = {
      id: credential.id,
      providerType: credential.providerType,
      label: credential.label,
      baseUrl: credential.baseUrl,
      models: credential.models,
      defaultModel: credential.defaultModel,
    };

    const session = await this.repository.create({
      userId: auth.user.id,
      providerCredentialId: credential.id,
      credentialSnapshot,
      modelSnapshot: {
        providerCredentialId: credential.id,
        model: dto.model,
      },
      permissionPreset: dto.permissionPreset,
      permissionPlanSnapshot,
      approvalMode: dto.approvalMode,
      runnerEndpoint: dto.runnerEndpoint ?? null,
      runnerSessionId: null,
      runnerCapabilitiesSnapshot: null,
      initialContextSnapshot: dto.initialContext ?? {},
      status: AgentSessionStatus.Created,
    });

    return this.map(session);
  }

  async getAll(auth: AuthDto): Promise<AgentSessionResponseDto[]> {
    const sessions = await this.repository.getByUserId(auth.user.id);
    return sessions.map((session) => this.map(session));
  }

  async getById(auth: AuthDto, id: string): Promise<AgentSessionResponseDto> {
    const session = await this.getOwned(auth, id);
    return this.map(session);
  }

  async cancel(auth: AuthDto, id: string): Promise<AgentSessionResponseDto> {
    const session = await this.getOwned(auth, id);

    if (session.status === AgentSessionStatus.Cancelled) {
      return this.map(session);
    }

    if (nonCancellableStatuses.has(session.status)) {
      throw new BadRequestException('Agent session cannot be cancelled in its current state');
    }

    const cancelled = await this.repository.update(auth.user.id, id, {
      status: AgentSessionStatus.Cancelled,
      endedAt: new Date(),
    });

    return this.map(cancelled);
  }

  private resolvePermissionPlan(dto: AgentSessionCreateDto): AgentPermissionPlanSnapshot {
    if (dto.permissionPreset === AgentPermissionPreset.Custom) {
      if (!dto.permissionPlan) {
        throw new BadRequestException('permissionPlan is required when permissionPreset is custom');
      }

      return dto.permissionPlan;
    }

    if (dto.permissionPlan) {
      throw new BadRequestException('permissionPlan is only accepted when permissionPreset is custom');
    }

    return AgentSessionService.permissionPresets[dto.permissionPreset];
  }

  private async getOwned(auth: AuthDto, id: string) {
    const session = await this.repository.getById(auth.user.id, id);
    if (!session) {
      throw new BadRequestException('Agent session not found');
    }

    return session;
  }

  private map(session: AgentSession): AgentSessionResponseDto {
    return {
      id: session.id,
      status: session.status,
      providerCredentialId: session.providerCredentialId,
      credentialSnapshot: session.credentialSnapshot,
      modelSnapshot: session.modelSnapshot,
      permissionPreset: session.permissionPreset,
      permissionPlanSnapshot: session.permissionPlanSnapshot,
      approvalMode: session.approvalMode,
      runnerEndpoint: session.runnerEndpoint,
      runnerSessionId: session.runnerSessionId,
      runnerCapabilitiesSnapshot: session.runnerCapabilitiesSnapshot,
      initialContextSnapshot: session.initialContextSnapshot,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      endedAt: session.endedAt,
    };
  }
}
```

- [ ] **Step 4: Register the service provider**

Modify `server/src/services/index.ts`.

```ts
import { AgentSessionService } from 'src/services/agent-session.service';
```

Add the provider.

```ts
  AgentSessionService,
```

- [ ] **Step 5: Run service test to verify it passes**

Run:

```bash
pnpm --dir server test agent-session.service.spec.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/src/services/agent-session.service.ts server/src/services/agent-session.service.spec.ts server/src/services/index.ts
git commit -m "feat: add agent session service"
```

## Task 4: Session Controller And OpenAPI

**Files:**

- Create: `server/src/controllers/agent-session.controller.ts`
- Create: `server/src/controllers/agent-session.controller.spec.ts`
- Modify: `server/src/controllers/index.ts`
- Generated: `open-api/immich-openapi-specs.json`
- Generated: `open-api/typescript-sdk/src/fetch-client.ts`
- Generated: `open-api/typescript-sdk/build/fetch-client.js`
- Generated: `open-api/typescript-sdk/build/fetch-client.d.ts`
- Generated mobile OpenAPI files, if `make open-api-typescript` updates them in this branch.

- [ ] **Step 1: Write the failing controller test**

Create `server/src/controllers/agent-session.controller.spec.ts`.

```ts
import { AgentSessionController } from 'src/controllers/agent-session.controller';
import { AgentApprovalMode, AgentPermissionPreset, AgentProviderType, AgentSessionStatus, Permission } from 'src/enum';
import { AgentSessionService } from 'src/services/agent-session.service';
import request from 'supertest';
import { AuthFactory } from 'test/factories/auth.factory';
import { factory } from 'test/small.factory';
import { automock, ControllerContext, controllerSetup } from 'test/utils';

describe(AgentSessionController.name, () => {
  let ctx: ControllerContext;
  const service = automock(AgentSessionService, { args: [{} as never, {} as never], strict: false });
  const auth = AuthFactory.create();
  const id = factory.uuid();
  const credentialId = factory.uuid();
  const now = new Date('2026-05-14T00:00:00.000Z');
  const permissionPlan = AgentSessionService.permissionPresets[AgentPermissionPreset.VisualOrganizer];
  const response = {
    id,
    status: AgentSessionStatus.Created,
    providerCredentialId: credentialId,
    credentialSnapshot: {
      id: credentialId,
      providerType: AgentProviderType.OpenAI,
      label: 'OpenAI personal',
      baseUrl: null,
      models: ['gpt-5.1'],
      defaultModel: 'gpt-5.1',
    },
    modelSnapshot: { providerCredentialId: credentialId, model: 'gpt-5.1' },
    permissionPreset: AgentPermissionPreset.VisualOrganizer,
    permissionPlanSnapshot: permissionPlan,
    approvalMode: AgentApprovalMode.Strict,
    runnerEndpoint: 'http://localhost:4477',
    runnerSessionId: null,
    runnerCapabilitiesSnapshot: null,
    initialContextSnapshot: { entrypoint: 'assistant-page' },
    createdAt: now,
    updatedAt: now,
    endedAt: null,
  };

  beforeAll(async () => {
    ctx = await controllerSetup(AgentSessionController, [{ provide: AgentSessionService, useValue: service }]);
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

  const expectResponse = (body: Record<string, unknown>) => {
    expect(body).toEqual({
      ...response,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    });
  };

  describe('POST /agent/sessions', () => {
    const body = {
      providerCredentialId: credentialId,
      model: 'gpt-5.1',
      permissionPreset: AgentPermissionPreset.VisualOrganizer,
      approvalMode: AgentApprovalMode.Strict,
      runnerEndpoint: 'http://localhost:4477',
      initialContext: { entrypoint: 'assistant-page' },
    };

    it('should be an authenticated route', async () => {
      service.create.mockResolvedValue(response);

      await request(ctx.getHttpServer()).post('/agent/sessions').send(body);

      expect(ctx.authenticate).toHaveBeenCalled();
      expectPermission(Permission.AgentSessionCreate);
    });

    it('should call the service with auth and body, and return 201', async () => {
      service.create.mockResolvedValue(response);

      const { status, body: result } = await request(ctx.getHttpServer()).post('/agent/sessions').send(body);

      expect(status).toBe(201);
      expect(service.create).toHaveBeenCalledWith(auth, body);
      expectResponse(result);
    });

    it('should require a valid provider credential id', async () => {
      const { status, body: result } = await request(ctx.getHttpServer())
        .post('/agent/sessions')
        .send({
          ...body,
          providerCredentialId: 'not-a-uuid',
        });

      expect(status).toBe(400);
      expect(result).toEqual(factory.responses.badRequest(['[providerCredentialId] Invalid UUID']));
    });

    it('should require permissionPlan for custom sessions', async () => {
      const { status, body: result } = await request(ctx.getHttpServer())
        .post('/agent/sessions')
        .send({
          ...body,
          permissionPreset: AgentPermissionPreset.Custom,
        });

      expect(status).toBe(400);
      expect(result).toEqual(
        factory.responses.badRequest([
          expect.stringContaining('permissionPlan is required when permissionPreset is custom'),
        ]),
      );
    });

    it('should accept a valid custom permission plan', async () => {
      service.create.mockResolvedValue({
        ...response,
        permissionPreset: AgentPermissionPreset.Custom,
        permissionPlanSnapshot: permissionPlan,
      });

      const customBody = {
        ...body,
        permissionPreset: AgentPermissionPreset.Custom,
        permissionPlan,
      };

      const { status } = await request(ctx.getHttpServer()).post('/agent/sessions').send(customBody);

      expect(status).toBe(201);
      expect(service.create).toHaveBeenCalledWith(auth, customBody);
    });

    it('should reject permissionPlan for preset sessions', async () => {
      const { status, body: result } = await request(ctx.getHttpServer())
        .post('/agent/sessions')
        .send({
          ...body,
          permissionPlan,
        });

      expect(status).toBe(400);
      expect(result).toEqual(
        factory.responses.badRequest([
          expect.stringContaining('permissionPlan is only accepted when permissionPreset is custom'),
        ]),
      );
    });

    it('should reject invalid approval mode values', async () => {
      const { status, body: result } = await request(ctx.getHttpServer())
        .post('/agent/sessions')
        .send({
          ...body,
          approvalMode: 'always',
        });

      expect(status).toBe(400);
      expect(result).toEqual(factory.responses.badRequest([expect.stringContaining('[approvalMode] Invalid option')]));
    });

    it('should reject custom permission plans with inconsistent provider exposure and limits', async () => {
      const { status, body: result } = await request(ctx.getHttpServer())
        .post('/agent/sessions')
        .send({
          ...body,
          permissionPreset: AgentPermissionPreset.Custom,
          permissionPlan: {
            ...permissionPlan,
            read: { metadata: false, previews: false, originals: false },
            providerExposure: {
              metadata: true,
              previews: true,
              originals: true,
              allowOriginalsForExternalProviders: false,
            },
            limits: {
              ...permissionPlan.limits,
              maxAssetsPerToolCall: 10,
              maxAssetsPerSession: 5,
              maxPreviewsPerToolCall: 11,
              maxOriginalsPerToolCall: 12,
            },
          },
        });

      expect(status).toBe(400);
      expect(result).toEqual(
        factory.responses.badRequest([
          expect.stringContaining('metadata exposure requires metadata reads'),
          expect.stringContaining('preview exposure requires preview reads'),
          expect.stringContaining('original exposure requires original reads'),
          expect.stringContaining('preview limits require preview reads'),
          expect.stringContaining('original limits require original reads'),
          expect.stringContaining('session asset limit must be at least the per-tool-call asset limit'),
          expect.stringContaining('preview limit cannot exceed the per-tool-call asset limit'),
          expect.stringContaining('original limit cannot exceed the per-tool-call asset limit'),
        ]),
      );
    });

    it('should reject oversized initial context payloads', async () => {
      const { status, body: result } = await request(ctx.getHttpServer())
        .post('/agent/sessions')
        .send({
          ...body,
          initialContext: { note: 'x'.repeat(16_500) },
        });

      expect(status).toBe(400);
      expect(result).toEqual(
        factory.responses.badRequest([expect.stringContaining('initialContext must be 16 KiB or less')]),
      );
    });
  });

  describe('GET /agent/sessions', () => {
    it('should be an authenticated route', async () => {
      service.getAll.mockResolvedValue([]);

      await request(ctx.getHttpServer()).get('/agent/sessions');

      expect(ctx.authenticate).toHaveBeenCalled();
      expectPermission(Permission.AgentSessionRead);
    });

    it('should call the service with auth and return sessions', async () => {
      service.getAll.mockResolvedValue([response]);

      const { status, body: result } = await request(ctx.getHttpServer()).get('/agent/sessions');

      expect(status).toBe(200);
      expect(service.getAll).toHaveBeenCalledWith(auth);
      expect(result).toHaveLength(1);
      expectResponse(result[0]);
    });
  });

  describe('GET /agent/sessions/:id', () => {
    it('should be an authenticated route', async () => {
      service.getById.mockResolvedValue(response);

      await request(ctx.getHttpServer()).get(`/agent/sessions/${id}`);

      expect(ctx.authenticate).toHaveBeenCalled();
      expectPermission(Permission.AgentSessionRead);
    });

    it('should require a valid uuid', async () => {
      const { status, body: result } = await request(ctx.getHttpServer()).get('/agent/sessions/123');

      expect(status).toBe(400);
      expect(result).toEqual(factory.responses.badRequest(['[id] Invalid UUID']));
    });

    it('should call the service with auth and id', async () => {
      service.getById.mockResolvedValue(response);

      const { status, body: result } = await request(ctx.getHttpServer()).get(`/agent/sessions/${id}`);

      expect(status).toBe(200);
      expect(service.getById).toHaveBeenCalledWith(auth, id);
      expectResponse(result);
    });
  });

  describe('POST /agent/sessions/:id/cancel', () => {
    it('should be an authenticated route', async () => {
      service.cancel.mockResolvedValue({ ...response, status: AgentSessionStatus.Cancelled, endedAt: now });

      await request(ctx.getHttpServer()).post(`/agent/sessions/${id}/cancel`);

      expect(ctx.authenticate).toHaveBeenCalled();
      expectPermission(Permission.AgentSessionUpdate);
    });

    it('should require a valid uuid', async () => {
      const { status, body: result } = await request(ctx.getHttpServer()).post('/agent/sessions/123/cancel');

      expect(status).toBe(400);
      expect(result).toEqual(factory.responses.badRequest(['[id] Invalid UUID']));
    });

    it('should call the service with auth and id', async () => {
      const cancelled = { ...response, status: AgentSessionStatus.Cancelled, endedAt: now };
      service.cancel.mockResolvedValue(cancelled);

      const { status, body: result } = await request(ctx.getHttpServer()).post(`/agent/sessions/${id}/cancel`);

      expect(status).toBe(200);
      expect(service.cancel).toHaveBeenCalledWith(auth, id);
      expect(result).toEqual({
        ...cancelled,
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
        endedAt: now.toISOString(),
      });
    });
  });
});
```

- [ ] **Step 2: Run controller test to verify it fails**

Run:

```bash
pnpm --dir server test agent-session.controller.spec.ts
```

Expected: FAIL with missing `AgentSessionController`.

- [ ] **Step 3: Add the controller**

Create `server/src/controllers/agent-session.controller.ts`.

```ts
import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Endpoint, HistoryBuilder } from 'src/decorators';
import { AgentSessionCreateDto, AgentSessionResponseDto } from 'src/dtos/agent-session.dto';
import { AuthDto } from 'src/dtos/auth.dto';
import { ApiTag, Permission } from 'src/enum';
import { Auth, Authenticated } from 'src/middleware/auth.guard';
import { AgentSessionService } from 'src/services/agent-session.service';
import { UUIDParamDto } from 'src/validation';

@ApiTags(ApiTag.AgentSessions)
@Controller('agent/sessions')
export class AgentSessionController {
  constructor(private service: AgentSessionService) {}

  @Post()
  @Authenticated({ permission: Permission.AgentSessionCreate })
  @Endpoint({
    summary: 'Create an agent session',
    description:
      'Create a personal AI agent session with immutable credential, model, permission plan, and approval mode snapshots.',
    history: new HistoryBuilder().added('v2.7.5').alpha('v2.7.5'),
  })
  createAgentSession(@Auth() auth: AuthDto, @Body() dto: AgentSessionCreateDto): Promise<AgentSessionResponseDto> {
    return this.service.create(auth, dto);
  }

  @Get()
  @Authenticated({ permission: Permission.AgentSessionRead })
  @Endpoint({
    summary: 'List agent sessions',
    description: 'Retrieve all AI agent sessions owned by the current user.',
    history: new HistoryBuilder().added('v2.7.5').alpha('v2.7.5'),
  })
  getAgentSessions(@Auth() auth: AuthDto): Promise<AgentSessionResponseDto[]> {
    return this.service.getAll(auth);
  }

  @Get(':id')
  @Authenticated({ permission: Permission.AgentSessionRead })
  @Endpoint({
    summary: 'Retrieve an agent session',
    description: 'Retrieve an AI agent session by ID. The current user must own this session.',
    history: new HistoryBuilder().added('v2.7.5').alpha('v2.7.5'),
  })
  getAgentSession(@Auth() auth: AuthDto, @Param() { id }: UUIDParamDto): Promise<AgentSessionResponseDto> {
    return this.service.getById(auth, id);
  }

  @Post(':id/cancel')
  @Authenticated({ permission: Permission.AgentSessionUpdate })
  @Endpoint({
    summary: 'Cancel an agent session',
    description: 'Cancel an active AI agent session owned by the current user.',
    history: new HistoryBuilder().added('v2.7.5').alpha('v2.7.5'),
  })
  cancelAgentSession(@Auth() auth: AuthDto, @Param() { id }: UUIDParamDto): Promise<AgentSessionResponseDto> {
    return this.service.cancel(auth, id);
  }
}
```

- [ ] **Step 4: Register controller and tag text**

Modify `server/src/controllers/index.ts`.

```ts
import { AgentSessionController } from 'src/controllers/agent-session.controller';
```

Add the controller.

```ts
  AgentSessionController,
```

- [ ] **Step 5: Run controller test to verify it passes**

Run:

```bash
pnpm --dir server test agent-session.controller.spec.ts
```

Expected: PASS.

- [ ] **Step 6: Run slice unit tests together**

Run:

```bash
pnpm --dir server test agent-session.service.spec.ts agent-session.controller.spec.ts agent-provider-credential.service.spec.ts agent-provider-credential.controller.spec.ts
```

Expected: PASS.

- [ ] **Step 7: Generate OpenAPI and SDK artifacts**

Run:

```bash
make open-api-typescript
```

Expected:

- `open-api/immich-openapi-specs.json` includes `/agent/sessions` and `/agent/sessions/{id}/cancel`.
- `open-api/typescript-sdk/src/fetch-client.ts` exports functions for create/list/get/cancel agent sessions.
- `Permission` includes `agentSession.create`, `agentSession.read`, and `agentSession.update`.

- [ ] **Step 8: Commit**

```bash
git add server/src/controllers/agent-session.controller.ts server/src/controllers/agent-session.controller.spec.ts server/src/controllers/index.ts server/src/constants.ts open-api mobile
git commit -m "feat: add agent session api"
```

## Task 5: Final Verification And Slice Handoff

**Files:**

- Verify all files changed in Tasks 1-4.
- Update this plan's checkbox statuses only if the implementer is executing the plan in-place.

- [ ] **Step 1: Run targeted medium tests**

Run:

```bash
pnpm --dir server test:medium agent-provider-credential.repository.spec.ts agent-session.repository.spec.ts
```

Expected: PASS.

- [ ] **Step 2: Run targeted unit/controller tests**

Run:

```bash
pnpm --dir server test encrypted-secret.service.spec.ts agent-provider-credential.service.spec.ts agent-provider-credential.controller.spec.ts agent-session.service.spec.ts agent-session.controller.spec.ts
```

Expected: PASS.

- [ ] **Step 3: Run server static checks**

Run:

```bash
pnpm --dir server run check
pnpm --dir server run lint
pnpm --dir server run format
```

Expected: all PASS.

- [ ] **Step 4: Verify generated artifacts are current**

Run:

```bash
pnpm --dir server run sync:sql
make open-api-typescript
git status --short
```

Expected: `sync:sql` and `make open-api-typescript` do not create additional unstaged changes beyond the files intentionally generated for this slice. `git status --short` only shows planned slice-2 changes before the final commit.

- [ ] **Step 5: Inspect the diff for scope control**

Run:

```bash
git diff --stat origin/explore/pi-agent-brainstorm...HEAD
git diff --name-only origin/explore/pi-agent-brainstorm...HEAD
```

Expected: the diff contains only agent session contracts, storage, service, API, tests, SQL snapshots, and generated OpenAPI/SDK artifacts. It does not include runner, chat, tool-call, album-operation, or web UI changes.

- [ ] **Step 6: Commit verification updates**

If generated artifacts or formatting changed after Task 4, commit them.

```bash
git add server open-api mobile
git commit -m "chore: update agent session generated artifacts"
```

Expected: no commit is created if there are no changes.

## Plan Self-Review

- Spec coverage: this plan covers slice 2 from the approved design: session table and APIs, create/list/get/cancel personal sessions, permission plan and approval mode snapshots, user isolation, and snapshot immutability.
- Deliberate exclusions: chat transcript, runner health, internal tool gate, Pi runtime integration, read tools, YOLO mode behavior, structured album plans, plan review UI, and apply operations stay in later slices.
- Type consistency: `AgentSessionStatus`, `AgentApprovalMode`, `AgentPermissionPreset`, `AgentPermissionPlanSnapshot`, `credentialSnapshot`, `modelSnapshot`, and `initialContextSnapshot` use the same names in DTOs, table, repository, service, controller, and tests.
- Edge coverage: tests cover cross-user repository scoping, owner deletion cascade, provider credential deletion with preserved snapshots, session ordering, credential lookup failure, constrained and unconstrained model selection, custom plan validation, invalid approval modes, oversized initial context payloads, default optional snapshots, idempotent cancel, non-cancellable applying/completed/failed sessions, and route permissions for every endpoint.
- E2E coverage is intentionally deferred: this slice has no web UI, runner, chat, or tool behavior. The API routes are covered at the controller layer, and the first end-to-end assistant flow belongs to slice 14 in the approved roadmap.
- Verification baseline for the planning branch before this plan was written: `pnpm install --frozen-lockfile`, `pnpm --dir server test encrypted-secret.service.spec.ts agent-provider-credential.service.spec.ts agent-provider-credential.controller.spec.ts` (40 tests), `pnpm --dir server check`, and `pnpm --dir server test:medium agent-provider-credential.repository.spec.ts` (2 tests) all passed.

Plan complete and saved to `docs/superpowers/plans/2026-05-14-pi-agent-session-shell.md`.

Execution options:

1. **Subagent-Driven (recommended)** - dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** - execute tasks in this session using executing-plans, with checkpoints for review.
