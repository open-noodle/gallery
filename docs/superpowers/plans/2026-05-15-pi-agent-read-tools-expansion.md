# Pi Agent Read Tools Expansion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build slice 9 from `docs/superpowers/specs/2026-05-14-pi-agent-album-assistant-design.md`: expand the assistant's read tools to search assets, list albums, read albums, read previews, and enforce metadata, preview, and original-read permission boundaries across approval modes.

**Architecture:** Gallery remains the policy and audit authority. The server generalizes the existing strict-only `readAssetMetadata` tool gate into a read-tool executor that validates session ownership, normal asset/album access, permission-plan read flags, provider-exposure flags, approval mode, limits, and drift at execution time; the runner receives only session-scoped, bearer-authenticated access to those server tools. Pi keeps all built-in tools disabled and exposes only Gallery read custom tools, with no write tools and no direct database, filesystem, storage, or normal album mutation API access.

**Tech Stack:** NestJS services/controllers/repositories with Zod DTOs, Kysely/Postgres query projections, existing websocket/session infrastructure, Node.js `agent-runner` with Pi custom tools via `defineTool()`, TypeBox schemas, Vitest server tests, Node `node:test` runner tests, generated OpenAPI/SDK artifacts.

---

## Design Source

The approved design defines slice 9 as:

```text
Read tools expansion
- search assets, list albums, read album, read previews;
- permission plan enforcement for metadata/previews/originals;
- tests for each data class and approval mode.
```

This plan also closes the slice-8 gap called out in
`docs/superpowers/plans/2026-05-15-pi-agent-pi-runtime-integration.md`: the Pi runtime currently uses `noTools: "all"`, `tools: []`, and `customTools: []`. Slice 9 keeps built-in tools disabled, adds only narrow Gallery read custom tools, and still exposes no write tools.

## Scope

This slice implements:

- Server read-tool names:
  - `searchAssets`
  - `readAssetMetadata`
  - `readAssetPreviews`
  - `readAssetOriginals`
  - `listAlbums`
  - `readAlbum`
- Browser/internal typed routes for the expanded read tools.
- A runner-only internal tool gateway authenticated with a short-lived HMAC bearer token.
- Pi custom tools that call the runner-only server gateway.
- Permission-plan enforcement for:
  - metadata reads;
  - preview reads;
  - original-reference reads;
  - owned/shared-space/locked asset scope;
  - per-tool and per-session exposure limits.
- Approval behavior for `strict`, `ask-on-escalation`, and `plan-only`.
- Explicit "not in slice 9" denial for `dangerously-skip-permissions`, with tests proving normal policy checks are not bypassed. Slice 10 owns actual YOLO read-mode behavior.
- Audit rows for all tool calls with summaries, ids, counts, provider snapshot, data class, and no media bytes or provider payloads.

This slice intentionally does not implement:

- Album operation proposal/storage/review/apply behavior.
- Any write tool.
- Tool grants such as "allow matching request" or persisted session grants.
- Binary media transfer into multimodal provider messages. Preview/original tools return server-owned media references and metadata only; audit never stores bytes or filesystem paths.
- YOLO auto-approval behavior. `dangerously-skip-permissions` remains unavailable until slice 10.

## File Structure

- `server/src/enum.ts` - add expanded read tool names and `previews`/`originals` data classes.
- `server/src/types/agent-session.types.ts` - add preview/original per-session limits to permission snapshots.
- `server/src/dtos/agent-session.dto.ts` - validate the new limit fields and provider/read consistency.
- `server/src/services/agent-session.service.ts` - update permission presets with preview/original per-session limits.
- `server/src/services/agent-session.service.spec.ts` - cover preset snapshots and custom-plan validation updates.
- `server/src/types/agent-tool.types.ts` - add typed request/response metadata and result projections for search assets, albums, previews, and originals.
- `server/src/dtos/agent-tool.dto.ts` - add request/response DTO schemas for the expanded tools.
- `server/src/dtos/agent-tool.dto.spec.ts` - TDD coverage for request validation, response encoding, and edge-case payloads.
- `server/src/schema/tables/agent-tool-call.table.ts` - generalize audit metadata JSON types beyond the metadata-only tool.
- `server/src/repositories/agent-tool-call.repository.ts` - generalize counted exposure totals and allow completion transitions to update counts.
- `server/test/medium/specs/repositories/agent-tool-call.repository.spec.ts` - medium tests for counted totals by data class and guarded count updates.
- `server/src/repositories/asset.repository.ts` - add agent-focused search, preview reference, and original reference projections.
- `server/test/medium/specs/repositories/asset.repository.spec.ts` - medium tests for projection redaction, ordering, locked filtering inputs, and generated SQL.
- `server/src/repositories/album.repository.ts` - add agent-focused album list/detail projections.
- `server/test/medium/specs/repositories/album.repository.spec.ts` - medium tests for owned/shared album projections and deleted album exclusion.
- `server/src/services/agent-tool.service.ts` - refactor the current metadata-only flow into a generic read-tool gate and implement the six read tools.
- `server/src/services/agent-tool.service.spec.ts` - core service TDD for approval matrix, policy denial, limits, access, audit, execution drift, and race cases.
- `server/src/controllers/agent-tool.controller.ts` - add browser-authenticated expanded read-tool routes for typed API/SDK use.
- `server/src/controllers/agent-tool.controller.spec.ts` - route auth, validation, service delegation, and date serialization tests.
- `server/src/services/agent-runner-tool-token.service.ts` - create and verify runner-only HMAC bearer tokens.
- `server/src/services/agent-runner-tool-token.service.spec.ts` - token tamper, expiry, session mismatch, and missing key tests.
- `server/src/controllers/agent-runner-tool.controller.ts` - runner-only internal gateway for Pi custom tools.
- `server/src/controllers/agent-runner-tool.controller.spec.ts` - bearer auth and gateway dispatch tests.
- `server/src/controllers/index.ts` and `server/src/services/index.ts` - register the new controller/service.
- `server/src/types/agent-runner.types.ts` - add optional `toolGateway` to runner create-session requests.
- `server/src/services/agent-runner.service.ts` - include tool gateway URL/token in runner session creation.
- `server/src/services/agent-runner.service.spec.ts` - verify gateway token handoff and no secret leakage.
- `server/src/dtos/env.dto.ts`, `server/src/repositories/config.repository.ts`, and `server/src/repositories/config.repository.spec.ts` - add `IMMICH_AGENT_TOOL_GATEWAY_URL`.
- `agent-runner/package.json` - add direct `typebox` dependency for custom tool schemas.
- `agent-runner/src/gallery-tool-client.mjs` - runner-side HTTP client for Gallery tool gateway.
- `agent-runner/src/gallery-tool-client.test.mjs` - client tests for success, approval-required, denial, invalid JSON, and bearer redaction.
- `agent-runner/src/gallery-tools.mjs` - Pi custom tool definitions for the six read tools.
- `agent-runner/src/gallery-tools.test.mjs` - custom-tool schema, execution, and no-write registry tests.
- `agent-runner/src/pi-runtime.mjs` - enable Gallery read custom tools when a tool gateway is present.
- `agent-runner/src/pi-runtime.test.mjs` - verify built-in tools stay disabled and read custom tools are active.
- `agent-runner/src/server.mjs` and `agent-runner/src/server.test.mjs` - validate/create-session passthrough of `toolGateway` and updated capabilities.
- `open-api/immich-openapi-specs.json`, `open-api/typescript-sdk/**`, `mobile/openapi/**` - generated API artifacts from existing generation commands.

## Contracts

### Tool Names And Data Classes

Use these enum values exactly:

```typescript
export enum AgentToolName {
  SearchAssets = 'searchAssets',
  ReadAssetMetadata = 'readAssetMetadata',
  ReadAssetPreviews = 'readAssetPreviews',
  ReadAssetOriginals = 'readAssetOriginals',
  ListAlbums = 'listAlbums',
  ReadAlbum = 'readAlbum',
}

export enum AgentToolDataClass {
  Metadata = 'metadata',
  Previews = 'previews',
  Originals = 'originals',
}
```

`searchAssets`, `readAssetMetadata`, `listAlbums`, and `readAlbum` are metadata-class tools. `readAssetPreviews` is preview-class. `readAssetOriginals` is original-class and returns original media references only when the permission plan and provider exposure allow originals.

### Approval Matrix

```text
strict:
  metadata tools -> approval-required, then execute by toolCallId
  preview tools  -> approval-required, then execute by toolCallId
  original tools -> approval-required, then execute by toolCallId

ask-on-escalation:
  metadata tools -> execute immediately and audit completed
  preview tools  -> approval-required, then execute by toolCallId
  original tools -> approval-required, then execute by toolCallId

plan-only:
  metadata tools -> execute immediately and audit completed
  preview tools  -> execute immediately if plan allows previews
  original tools -> execute immediately if plan allows originals and provider exposure allows this provider

dangerously-skip-permissions:
  all read tools -> denied with "YOLO read mode is implemented in slice 10"
```

Every path still validates normal Gallery access, selected permission plan, provider exposure, data-class limits, and active session state before returning data. Strict approved execution repeats the validation to handle drift.

### Runner Tool Gateway

Server creates session requests with:

```typescript
export type AgentRunnerToolGateway = {
  url: string;
  token: string;
};

export type AgentRunnerCreateSessionRequest = {
  gallerySessionId: string;
  credential: AgentRunnerCredentialMaterial;
  model: string;
  permissionPreset: AgentPermissionPreset;
  permissionPlan: AgentPermissionPlanSnapshot;
  approvalMode: AgentApprovalMode;
  initialContext: Record<string, unknown>;
  toolGateway: AgentRunnerToolGateway | null;
};
```

`toolGateway.url` comes from `IMMICH_AGENT_TOOL_GATEWAY_URL`. In local compose this should point at the Gallery server as reachable from the runner, for example `http://immich-server:2283/api/agent/internal/tools`. If it is not configured, the runner session still starts, but reports no tools and Pi custom tools remain disabled.

The bearer token payload is:

```typescript
type AgentRunnerToolTokenClaims = {
  sessionId: string;
  userId: string;
  expiresAt: string;
};
```

The token format is:

```text
v1.<base64url-json-claims>.<base64url-hmac-sha256>
```

The HMAC key uses the same `IMMICH_AGENT_SECRET_KEY` configuration value that protects agent credential encryption. Tokens expire at the session permission plan expiration when present, otherwise two hours after runner session creation.

### Tool Result Shape

All expanded tool routes return the existing discriminated status shape:

```typescript
type AgentReadToolResponse<T> =
  | { status: 'approval-required'; toolCall: AgentToolCallResponseDto }
  | { status: 'denied'; reason: string; toolCall: AgentToolCallResponseDto }
  | ({ status: 'success'; toolCall: AgentToolCallResponseDto } & T);
```

The successful payload keys are:

```typescript
type SearchAssetsPayload = { assets: AgentAssetMetadata[]; nextPage: string | null };
type ReadAssetMetadataPayload = { assets: AgentAssetMetadata[] };
type ReadAssetPreviewsPayload = { previews: AgentAssetMediaReference[] };
type ReadAssetOriginalsPayload = { originals: AgentAssetMediaReference[] };
type ListAlbumsPayload = { albums: AgentAlbumSummary[] };
type ReadAlbumPayload = { album: AgentAlbumDetail };
```

Media references must not include filesystem paths, signed secrets, raw bytes, or provider payloads:

```typescript
export type AgentAssetMediaReference = {
  assetId: string;
  mediaUrl: string;
  mimeType: string;
  fileName: string;
  width: number | null;
  height: number | null;
};
```

Use relative API URLs in service responses:

```text
/api/assets/<assetId>/thumbnail?size=preview
/api/assets/<assetId>/original
```

The runner can send these references to Pi as text/details. It must not download media bytes in this slice.

## Task 1: Permission Snapshot And Enum Expansion

**Files:**

- Modify: `server/src/enum.ts`
- Modify: `server/src/types/agent-session.types.ts`
- Modify: `server/src/dtos/agent-session.dto.ts`
- Modify: `server/src/services/agent-session.service.ts`
- Test: `server/src/dtos/agent-session.dto.spec.ts`
- Test: `server/src/services/agent-session.service.spec.ts`

- [ ] **Step 1: Write failing DTO tests for preview/original session limits**

Add these tests to `server/src/dtos/agent-session.dto.spec.ts` in the `AgentPermissionPlanSchema` describe block:

```typescript
it('accepts preview and original per-session limits when matching reads are enabled', () => {
  const result = AgentPermissionPlanSchema.safeParse({
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
      maxPreviewsPerSession: 500,
      maxOriginalsPerToolCall: 25,
      maxOriginalsPerSession: 50,
      expiresInMinutes: 120,
    },
  });

  expect(result.success).toBe(true);
});

it('rejects preview and original session limits that exceed total asset session limits', () => {
  const result = AgentPermissionPlanSchema.safeParse({
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
      maxAssetsPerToolCall: 100,
      maxAssetsPerSession: 100,
      maxPreviewsPerToolCall: 10,
      maxPreviewsPerSession: 101,
      maxOriginalsPerToolCall: 5,
      maxOriginalsPerSession: 101,
      expiresInMinutes: 120,
    },
  });

  expect(result.success).toBe(false);
  expect(result.error?.issues.map((issue) => issue.message)).toEqual(
    expect.arrayContaining([
      'preview session limit cannot exceed the asset session limit',
      'original session limit cannot exceed the asset session limit',
    ]),
  );
});
```

- [ ] **Step 2: Run DTO tests and confirm failure**

Run:

```bash
pnpm --dir server test src/dtos/agent-session.dto.spec.ts
```

Expected: FAIL because `maxPreviewsPerSession` and `maxOriginalsPerSession` are not accepted by the permission plan schema yet.

- [ ] **Step 3: Expand enums and permission snapshot types**

Update `server/src/enum.ts`:

```typescript
export enum AgentToolName {
  SearchAssets = 'searchAssets',
  ReadAssetMetadata = 'readAssetMetadata',
  ReadAssetPreviews = 'readAssetPreviews',
  ReadAssetOriginals = 'readAssetOriginals',
  ListAlbums = 'listAlbums',
  ReadAlbum = 'readAlbum',
}

export enum AgentToolDataClass {
  Metadata = 'metadata',
  Previews = 'previews',
  Originals = 'originals',
}
```

Update `server/src/types/agent-session.types.ts` limits:

```typescript
limits: {
  maxAssetsPerToolCall: number;
  maxAssetsPerSession: number;
  maxPreviewsPerToolCall: number;
  maxPreviewsPerSession: number;
  maxOriginalsPerToolCall: number;
  maxOriginalsPerSession: number;
  expiresInMinutes: number | null;
}
```

- [ ] **Step 4: Expand permission plan validation and presets**

Update the `limits` schema in `server/src/dtos/agent-session.dto.ts`:

```typescript
limits: z.object({
  maxAssetsPerToolCall: z.number().int().min(1).max(10_000),
  maxAssetsPerSession: z.number().int().min(1).max(100_000),
  maxPreviewsPerToolCall: z.number().int().min(0).max(10_000),
  maxPreviewsPerSession: z.number().int().min(0).max(100_000),
  maxOriginalsPerToolCall: z.number().int().min(0).max(1000),
  maxOriginalsPerSession: z.number().int().min(0).max(10_000),
  expiresInMinutes: z.number().int().min(1).max(10_080).nullable(),
}),
```

Add these `superRefine` checks:

```typescript
if (value.limits.maxPreviewsPerSession > 0 && !value.read.previews) {
  ctx.addIssue({
    code: z.ZodIssueCode.custom,
    path: ['limits', 'maxPreviewsPerSession'],
    message: 'preview session limits require preview reads',
  });
}

if (value.limits.maxOriginalsPerSession > 0 && !value.read.originals) {
  ctx.addIssue({
    code: z.ZodIssueCode.custom,
    path: ['limits', 'maxOriginalsPerSession'],
    message: 'original session limits require original reads',
  });
}

if (value.limits.maxPreviewsPerSession < value.limits.maxPreviewsPerToolCall) {
  ctx.addIssue({
    code: z.ZodIssueCode.custom,
    path: ['limits', 'maxPreviewsPerSession'],
    message: 'preview session limit must be at least the preview per-tool-call limit',
  });
}

if (value.limits.maxOriginalsPerSession < value.limits.maxOriginalsPerToolCall) {
  ctx.addIssue({
    code: z.ZodIssueCode.custom,
    path: ['limits', 'maxOriginalsPerSession'],
    message: 'original session limit must be at least the original per-tool-call limit',
  });
}

if (value.limits.maxPreviewsPerSession > value.limits.maxAssetsPerSession) {
  ctx.addIssue({
    code: z.ZodIssueCode.custom,
    path: ['limits', 'maxPreviewsPerSession'],
    message: 'preview session limit cannot exceed the asset session limit',
  });
}

if (value.limits.maxOriginalsPerSession > value.limits.maxAssetsPerSession) {
  ctx.addIssue({
    code: z.ZodIssueCode.custom,
    path: ['limits', 'maxOriginalsPerSession'],
    message: 'original session limit cannot exceed the asset session limit',
  });
}
```

Update `AgentSessionService.permissionPresets`:

```typescript
// Careful
maxPreviewsPerToolCall: 0,
maxPreviewsPerSession: 0,
maxOriginalsPerToolCall: 0,
maxOriginalsPerSession: 0,

// Visual Organizer
maxPreviewsPerToolCall: 100,
maxPreviewsPerSession: 500,
maxOriginalsPerToolCall: 0,
maxOriginalsPerSession: 0,

// Local Power User
maxPreviewsPerToolCall: 100,
maxPreviewsPerSession: 500,
maxOriginalsPerToolCall: 25,
maxOriginalsPerSession: 50,
```

- [ ] **Step 5: Run permission tests**

Run:

```bash
pnpm --dir server test src/dtos/agent-session.dto.spec.ts src/services/agent-session.service.spec.ts
```

Expected: PASS.

- [ ] **Step 6: Commit permission snapshot expansion**

```bash
git add server/src/enum.ts server/src/types/agent-session.types.ts server/src/dtos/agent-session.dto.ts server/src/dtos/agent-session.dto.spec.ts server/src/services/agent-session.service.ts server/src/services/agent-session.service.spec.ts
git commit -m "feat: expand agent read permission limits"
```

## Task 2: Expanded Tool DTOs And Types

**Files:**

- Modify: `server/src/types/agent-tool.types.ts`
- Modify: `server/src/dtos/agent-tool.dto.ts`
- Modify: `server/src/schema/tables/agent-tool-call.table.ts`
- Test: `server/src/dtos/agent-tool.dto.spec.ts`

- [ ] **Step 1: Write failing DTO tests for expanded read-tool requests**

Add these focused cases to `server/src/dtos/agent-tool.dto.spec.ts`:

```typescript
it('validates search assets request filters and limit', () => {
  const result = AgentSearchAssetsToolRequestDto.schema.safeParse({
    filters: {
      takenAfter: '2026-05-01T00:00:00.000Z',
      takenBefore: '2026-06-01T00:00:00.000Z',
      city: 'Lisbon',
      country: 'Portugal',
      isFavorite: true,
      isNotInAlbum: true,
    },
    limit: 50,
  });

  expect(result.success).toBe(true);
});

it('rejects search assets requests with both direct filters and toolCallId', () => {
  const result = AgentSearchAssetsToolRequestDto.schema.safeParse({
    filters: { city: 'Lisbon' },
    limit: 50,
    toolCallId: factory.uuid(),
  });

  expect(result.success).toBe(false);
  expect(result.error?.issues.map((issue) => issue.message)).toContain(
    'Provide either search filters or toolCallId, not both',
  );
});

it('rejects expanded asset read requests with both assetIds and toolCallId', () => {
  const assetId = factory.uuid();
  const toolCallId = factory.uuid();

  for (const schema of [AgentReadAssetPreviewsToolRequestDto.schema, AgentReadAssetOriginalsToolRequestDto.schema]) {
    const result = schema.safeParse({ assetIds: [assetId], toolCallId });
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.message)).toContain(
      'Provide either assetIds or toolCallId, not both',
    );
  }
});

it('rejects duplicate asset ids for preview and original reads', () => {
  const assetId = factory.uuid();

  for (const schema of [AgentReadAssetPreviewsToolRequestDto.schema, AgentReadAssetOriginalsToolRequestDto.schema]) {
    const result = schema.safeParse({ assetIds: [assetId, assetId] });
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.message)).toContain('assetIds must be unique');
  }
});

it('validates read album request requires albumId or toolCallId', () => {
  const result = AgentReadAlbumToolRequestDto.schema.safeParse({});

  expect(result.success).toBe(false);
  expect(result.error?.issues.map((issue) => issue.message)).toContain(
    'Provide albumId for a new tool request or toolCallId for an approved request',
  );
});

it('rejects read album requests with both albumId and toolCallId', () => {
  const result = AgentReadAlbumToolRequestDto.schema.safeParse({ albumId: factory.uuid(), toolCallId: factory.uuid() });

  expect(result.success).toBe(false);
  expect(result.error?.issues.map((issue) => issue.message)).toContain(
    'Provide either albumId or toolCallId, not both',
  );
});
```

- [ ] **Step 2: Run DTO tests and confirm failure**

Run:

```bash
pnpm --dir server test src/dtos/agent-tool.dto.spec.ts
```

Expected: FAIL because the new DTO classes are missing.

- [ ] **Step 3: Add expanded tool types**

Add these exported types to `server/src/types/agent-tool.types.ts`:

```typescript
export type AgentToolSearchAssetsRequestMetadata = {
  filters: AgentSearchAssetsFilters;
  limit: number;
};

export type AgentToolReadAssetIdsRequestMetadata = {
  assetIds: string[];
};

export type AgentToolReadAlbumRequestMetadata = {
  albumId: string;
};

export type AgentToolListAlbumsRequestMetadata = Record<string, never>;

export type AgentToolResponseIdsMetadata = {
  assetIds?: string[];
  albumIds?: string[];
};

export type AgentSearchAssetsFilters = {
  takenAfter?: Date;
  takenBefore?: Date;
  city?: string | null;
  state?: string | null;
  country?: string | null;
  make?: string | null;
  model?: string | null;
  lensModel?: string | null;
  isFavorite?: boolean;
  isNotInAlbum?: boolean;
  type?: AssetType;
  rating?: number | null;
  tagIds?: string[];
  albumIds?: string[];
};

export type AgentAssetMediaReference = {
  assetId: string;
  mediaUrl: string;
  mimeType: string;
  fileName: string;
  width: number | null;
  height: number | null;
};

export type AgentAlbumSummary = {
  id: string;
  albumName: string;
  description: string;
  ownerId: string;
  assetCount: number;
  startDate: Date | null;
  endDate: Date | null;
  albumThumbnailAssetId: string | null;
};

export type AgentAlbumDetail = AgentAlbumSummary & {
  assetIds: string[];
};
```

Update `AgentToolReadAssetMetadataRequestMetadata` to reuse `AgentToolReadAssetIdsRequestMetadata`, and update `AgentToolReadAssetMetadataResponseMetadata` to reuse `AgentToolResponseIdsMetadata`.
Add generic audit metadata unions and update the tool-call table to use them:

```typescript
export type AgentToolRequestMetadata =
  | AgentToolSearchAssetsRequestMetadata
  | AgentToolReadAssetIdsRequestMetadata
  | AgentToolReadAlbumRequestMetadata
  | AgentToolListAlbumsRequestMetadata;

export type AgentToolResponseMetadata = AgentToolResponseIdsMetadata;
```

In `server/src/schema/tables/agent-tool-call.table.ts`:

```typescript
redactedRequestMetadata!: AgentToolRequestMetadata;
redactedResponseMetadata!: AgentToolResponseMetadata | null;
```

- [ ] **Step 4: Add request and response DTO schemas**

In `server/src/dtos/agent-tool.dto.ts`, add reusable helpers:

```typescript
const MAX_TOOL_LIMIT = 10_000;
const assetIdRequest = (schemaId: string, missingMessage: string) =>
  z
    .object({
      assetIds: z.array(uuid).min(1).max(MAX_ASSET_IDS_PER_TOOL_CALL).optional(),
      toolCallId: uuid.optional(),
    })
    .superRefine((value, ctx) => {
      if (value.assetIds && value.toolCallId) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Provide either assetIds or toolCallId, not both' });
      }

      if (!value.assetIds && !value.toolCallId) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: missingMessage });
      }

      if (value.assetIds && new Set(value.assetIds).size !== value.assetIds.length) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['assetIds'], message: 'assetIds must be unique' });
      }
    })
    .meta({ id: schemaId });

const AgentSearchAssetsFiltersSchema = z
  .object({
    takenAfter: isoDatetimeToDate.optional(),
    takenBefore: isoDatetimeToDate.optional(),
    city: z.string().trim().nullable().optional(),
    state: z.string().trim().nullable().optional(),
    country: z.string().trim().nullable().optional(),
    make: z.string().trim().nullable().optional(),
    model: z.string().trim().nullable().optional(),
    lensModel: z.string().trim().nullable().optional(),
    isFavorite: z.boolean().optional(),
    isNotInAlbum: z.boolean().optional(),
    type: AssetTypeSchema.optional(),
    rating: z.number().int().min(1).max(5).nullable().optional(),
    tagIds: z.array(uuid).optional(),
    albumIds: z.array(uuid).optional(),
  })
  .default({})
  .meta({ id: 'AgentSearchAssetsFilters' });
```

Define direct-or-approved request schemas for non-asset-id tools:

- `AgentSearchAssetsToolRequestSchema` accepts either `{ filters, limit }` for a new request or `{ toolCallId }` for approved strict execution, but rejects both together. It defaults `filters` to `{}` and `limit` to `MAX_TOOL_LIMIT` only for new requests.
- `AgentListAlbumsToolRequestSchema` accepts `{}` for a new request or `{ toolCallId }` for approved strict execution, and rejects unknown keys.
- `AgentReadAlbumToolRequestSchema` accepts either `{ albumId }` or `{ toolCallId }`, rejects both, and rejects neither.

Add DTO classes:

```typescript
export class AgentSearchAssetsToolRequestDto extends createZodDto(AgentSearchAssetsToolRequestSchema) {}
export class AgentReadAssetPreviewsToolRequestDto extends createZodDto(AgentReadAssetPreviewsToolRequestSchema) {}
export class AgentReadAssetOriginalsToolRequestDto extends createZodDto(AgentReadAssetOriginalsToolRequestSchema) {}
export class AgentListAlbumsToolRequestDto extends createZodDto(AgentListAlbumsToolRequestSchema) {}
export class AgentReadAlbumToolRequestDto extends createZodDto(AgentReadAlbumToolRequestSchema) {}
```

Add response DTO type exports:

```typescript
export const AgentSearchAssetsToolResponseDto = createZodDto(AgentSearchAssetsToolResponseSchema);
export type AgentSearchAssetsToolResponseDto = z.output<typeof AgentSearchAssetsToolResponseSchema>;
export const AgentReadAssetPreviewsToolResponseDto = createZodDto(AgentReadAssetPreviewsToolResponseSchema);
export type AgentReadAssetPreviewsToolResponseDto = z.output<typeof AgentReadAssetPreviewsToolResponseSchema>;
export const AgentReadAssetOriginalsToolResponseDto = createZodDto(AgentReadAssetOriginalsToolResponseSchema);
export type AgentReadAssetOriginalsToolResponseDto = z.output<typeof AgentReadAssetOriginalsToolResponseSchema>;
export const AgentListAlbumsToolResponseDto = createZodDto(AgentListAlbumsToolResponseSchema);
export type AgentListAlbumsToolResponseDto = z.output<typeof AgentListAlbumsToolResponseSchema>;
export const AgentReadAlbumToolResponseDto = createZodDto(AgentReadAlbumToolResponseSchema);
export type AgentReadAlbumToolResponseDto = z.output<typeof AgentReadAlbumToolResponseSchema>;
```

- [ ] **Step 5: Run tool DTO tests**

Run:

```bash
pnpm --dir server test src/dtos/agent-tool.dto.spec.ts
```

Expected: PASS.

- [ ] **Step 6: Commit expanded tool DTOs**

```bash
git add server/src/types/agent-tool.types.ts server/src/dtos/agent-tool.dto.ts server/src/dtos/agent-tool.dto.spec.ts server/src/schema/tables/agent-tool-call.table.ts
git commit -m "feat: define expanded agent read tool DTOs"
```

## Task 3: Repository Projections And Audit Counting

**Files:**

- Modify: `server/src/repositories/agent-tool-call.repository.ts`
- Modify: `server/test/medium/specs/repositories/agent-tool-call.repository.spec.ts`
- Modify: `server/src/repositories/asset.repository.ts`
- Modify: `server/test/medium/specs/repositories/asset.repository.spec.ts`
- Modify: `server/src/repositories/album.repository.ts`
- Modify: `server/test/medium/specs/repositories/album.repository.spec.ts`

- [ ] **Step 1: Write failing audit counting tests**

Add medium tests to `server/test/medium/specs/repositories/agent-tool-call.repository.spec.ts`:

```typescript
it('counts completed exposures by session and data class', async () => {
  const session = await fixtures.agentSession();
  await fixtures.agentToolCall({
    sessionId: session.id,
    toolName: AgentToolName.ReadAssetMetadata,
    dataClass: AgentToolDataClass.Metadata,
    status: AgentToolCallStatus.Completed,
    assetCount: 10,
  });
  await fixtures.agentToolCall({
    sessionId: session.id,
    toolName: AgentToolName.ReadAssetPreviews,
    dataClass: AgentToolDataClass.Previews,
    status: AgentToolCallStatus.Completed,
    assetCount: 3,
  });

  await expect(sut.getCountedAssetCountBySessionAndDataClass(session.id, AgentToolDataClass.Metadata)).resolves.toBe(
    10,
  );
  await expect(sut.getCountedAssetCountBySessionAndDataClass(session.id, AgentToolDataClass.Previews)).resolves.toBe(3);
});

it('updates asset and album counts only during guarded transitions', async () => {
  const session = await fixtures.agentSession();
  const toolCall = await fixtures.agentToolCall({
    sessionId: session.id,
    status: AgentToolCallStatus.Executing,
    assetCount: 0,
    albumCount: 0,
  });

  const updated = await sut.transition(session.id, toolCall.id, AgentToolCallStatus.Executing, {
    status: AgentToolCallStatus.Completed,
    approvalDecision: AgentToolApprovalDecision.Approved,
    responseSummary: 'Returned 2 albums',
    redactedResponseMetadata: { albumIds: [factory.uuid(), factory.uuid()] },
    assetCount: 0,
    albumCount: 2,
    completedAt: new Date(),
    error: null,
  });

  expect(updated).toEqual(expect.objectContaining({ assetCount: 0, albumCount: 2 }));
});
```

- [ ] **Step 2: Run audit repository tests and confirm failure**

Run:

```bash
pnpm --dir server test:medium agent-tool-call.repository.spec.ts
```

Expected: FAIL because counted totals are not data-class aware and transition updates do not accept counts.

- [ ] **Step 3: Generalize audit counting**

Update `AgentToolCallUpdate` in `server/src/repositories/agent-tool-call.repository.ts`:

```typescript
type AgentToolCallUpdate = Pick<
  Updateable<AgentToolCallTable>,
  | 'status'
  | 'approvalDecision'
  | 'responseSummary'
  | 'redactedResponseMetadata'
  | 'assetCount'
  | 'albumCount'
  | 'completedAt'
  | 'error'
>;
```

Add:

```typescript
@GenerateSql(
  { name: 'including all', params: [DummyValue.UUID, AgentToolDataClass.Metadata] },
  { name: 'excluding tool call', params: [DummyValue.UUID, AgentToolDataClass.Previews, DummyValue.UUID] },
)
async getCountedAssetCountBySessionAndDataClass(
  sessionId: string,
  dataClass: AgentToolDataClass,
  excludedToolCallId?: string,
): Promise<number> {
  const result = await this.db
    .selectFrom('agent_tool_call')
    .select((eb) => sql<number>`coalesce(sum(${eb.ref('assetCount')}), 0)::int`.as('assetCount'))
    .where('sessionId', '=', asUuid(sessionId))
    .where('dataClass', '=', dataClass)
    .where('status', 'in', AgentToolCallRepository.countedStatuses)
    .$if(Boolean(excludedToolCallId), (qb) => qb.where('id', '!=', asUuid(excludedToolCallId!)))
    .executeTakeFirstOrThrow();

  return result.assetCount;
}
```

Keep `getCountedAssetCountBySession()` for existing metadata tests by delegating to the new method with `AgentToolDataClass.Metadata`.

- [ ] **Step 4: Add agent asset projection tests**

Add these medium tests to `server/test/medium/specs/repositories/asset.repository.spec.ts`:

```typescript
it('searches agent asset metadata without paths or media file rows', async () => {
  const { user, asset } = await fixtures.assetWithExif({ city: 'Lisbon', country: 'Portugal' });

  const result = await sut.searchAgentMetadata({
    userId: user.id,
    filters: { city: 'Lisbon', country: 'Portugal' },
    limit: 10,
  });

  expect(result.assets).toEqual([expect.objectContaining({ id: asset.id, originalFileName: asset.originalFileName })]);
  expect(JSON.stringify(result.assets)).not.toContain(asset.originalPath);
});

it('returns preview references in requested order without filesystem paths', async () => {
  const first = await fixtures.assetWithPreview();
  const second = await fixtures.assetWithPreview();

  const result = await sut.getAgentPreviewReferencesByIds([second.asset.id, first.asset.id]);

  expect(result.map((item) => item.assetId)).toEqual([second.asset.id, first.asset.id]);
  expect(result[0].mediaUrl).toBe(`/api/assets/${second.asset.id}/thumbnail?size=preview`);
  expect(JSON.stringify(result)).not.toContain(second.previewPath);
});

it('returns original references without filesystem paths', async () => {
  const { asset } = await fixtures.assetWithOriginal({ originalFileName: 'porto.jpg' });

  const result = await sut.getAgentOriginalReferencesByIds([asset.id]);

  expect(result).toEqual([
    expect.objectContaining({
      assetId: asset.id,
      mediaUrl: `/api/assets/${asset.id}/original`,
      fileName: 'porto.jpg',
    }),
  ]);
  expect(JSON.stringify(result)).not.toContain(asset.originalPath);
});
```

Also add repository-scope edge cases:

- owned-only search excludes shared-space assets when `scope.sharedSpaces` is false;
- shared-space search includes visible shared-space assets when `scope.sharedSpaces` is true;
- locked assets are excluded unless `scope.locked` is true;
- preview/original reference methods preserve requested order while omitting missing ids.

- [ ] **Step 5: Add agent album projection tests**

Add these medium tests to `server/test/medium/specs/repositories/album.repository.spec.ts`:

```typescript
it('lists owned and shared albums for agent reads without deleted albums', async () => {
  const owner = await fixtures.user();
  const sharedUser = await fixtures.user();
  const owned = await fixtures.album({ ownerId: owner.id, albumName: 'Owned' });
  const shared = await fixtures.sharedAlbum({ ownerId: sharedUser.id, userId: owner.id, albumName: 'Shared' });
  await fixtures.album({ ownerId: owner.id, albumName: 'Deleted', deletedAt: new Date() });

  const result = await sut.getAgentAlbums(owner.id);

  expect(result.map((album) => album.id)).toEqual(expect.arrayContaining([owned.id, shared.id]));
  expect(result.map((album) => album.albumName)).not.toContain('Deleted');
});

it('reads an agent album with ordered asset ids and summary metadata', async () => {
  const { user, album, assets } = await fixtures.albumWithAssets({ assetCount: 2 });

  const result = await sut.getAgentAlbumById(user.id, album.id);

  expect(result).toEqual(
    expect.objectContaining({
      id: album.id,
      albumName: album.albumName,
      ownerId: user.id,
      assetCount: 2,
      assetIds: assets.map((asset) => asset.id),
    }),
  );
});
```

- [ ] **Step 6: Run repository tests and confirm projection failures**

Run:

```bash
pnpm --dir server test:medium asset.repository.spec.ts album.repository.spec.ts agent-tool-call.repository.spec.ts
```

Expected: FAIL because projection methods are missing.

- [ ] **Step 7: Implement repository projections**

Add these method signatures:

```typescript
// server/src/repositories/asset.repository.ts
searchAgentMetadata(options: {
  userId: string;
  filters: AgentSearchAssetsFilters;
  limit: number;
  scope: {
    owned: boolean;
    sharedSpaces: boolean;
    locked: boolean;
  };
}): Promise<{ assets: AgentAssetMetadata[]; nextPage: string | null }>;

getAgentPreviewReferencesByIds(ids: string[]): Promise<AgentAssetMediaReference[]>;

getAgentOriginalReferencesByIds(ids: string[]): Promise<AgentAssetMediaReference[]>;

// server/src/repositories/album.repository.ts
getAgentAlbums(userId: string): Promise<AgentAlbumSummary[]>;

getAgentAlbumById(userId: string, albumId: string): Promise<AgentAlbumDetail | null>;
```

Implementation details:

- `searchAgentMetadata()` must reuse the same selected fields as `getAgentMetadataByIds()`, include `withAgentExif`, include tags, apply filters directly in Kysely, exclude deleted/offline assets, and apply the explicit `scope` input. The service derives `scope.owned`, `scope.sharedSpaces`, and `scope.locked` from the permission plan plus elevated-auth checks; the repository enforces that owned/shared/locked scope in SQL, including rows visible through `shared_space_asset` or `shared_space_library` only when `scope.sharedSpaces` is true.
- `getAgentPreviewReferencesByIds()` reads preview `asset_file` rows and returns relative `/api/assets/:id/thumbnail?size=preview` references. It must not return `asset_file.path`.
- `getAgentOriginalReferencesByIds()` reads `asset.originalFileName`, MIME metadata, dimensions from exif when available, and returns relative `/api/assets/:id/original`. It must not return `asset.originalPath`.
- `getAgentAlbums()` returns owned albums and albums shared through `album_user` or `shared_link`, deduped by album id.
- `getAgentAlbumById()` returns `null` when the album is deleted or inaccessible to the user.

- [ ] **Step 8: Run repository tests**

Run:

```bash
pnpm --dir server test:medium asset.repository.spec.ts album.repository.spec.ts agent-tool-call.repository.spec.ts
```

Expected: PASS.

- [ ] **Step 9: Commit repository projections**

```bash
git add server/src/repositories/agent-tool-call.repository.ts server/test/medium/specs/repositories/agent-tool-call.repository.spec.ts server/src/repositories/asset.repository.ts server/test/medium/specs/repositories/asset.repository.spec.ts server/src/repositories/album.repository.ts server/test/medium/specs/repositories/album.repository.spec.ts
git commit -m "feat: add agent read repository projections"
```

## Task 4: Generic Read Tool Gate Service

**Files:**

- Modify: `server/src/services/agent-tool.service.ts`
- Test: `server/src/services/agent-tool.service.spec.ts`

- [ ] **Step 1: Write failing approval matrix service tests**

Add table-driven tests to `server/src/services/agent-tool.service.spec.ts`:

```typescript
it.each([
  { mode: AgentApprovalMode.Strict, method: 'searchAssets', expected: 'approval-required' },
  { mode: AgentApprovalMode.Strict, method: 'readAssetPreviews', expected: 'approval-required' },
  { mode: AgentApprovalMode.AskOnEscalation, method: 'searchAssets', expected: 'success' },
  { mode: AgentApprovalMode.AskOnEscalation, method: 'readAssetPreviews', expected: 'approval-required' },
  { mode: AgentApprovalMode.PlanOnly, method: 'searchAssets', expected: 'success' },
  { mode: AgentApprovalMode.PlanOnly, method: 'readAssetPreviews', expected: 'success' },
] as const)('applies approval mode $mode to $method', async ({ mode, method, expected }) => {
  const auth = AuthFactory.create();
  const assetIds = [newUuid()];
  const session = makeSession({
    userId: auth.user.id,
    approvalMode: mode,
    permissionPlanSnapshot: makePlan({
      read: { metadata: true, previews: true, originals: false },
      providerExposure: {
        metadata: true,
        previews: true,
        originals: false,
        allowOriginalsForExternalProviders: false,
      },
      limits: {
        ...permissionPlanSnapshot.limits,
        maxPreviewsPerToolCall: 10,
        maxPreviewsPerSession: 100,
      },
    }),
  });

  sessionRepository.getById.mockResolvedValue(session);
  accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set(assetIds));
  assetRepository.searchAgentMetadata.mockResolvedValue({
    assets: [makeMetadata(assetIds[0])],
    nextPage: null,
  } as never);
  assetRepository.getAgentPreviewReferencesByIds.mockResolvedValue([
    {
      assetId: assetIds[0],
      mediaUrl: `/api/assets/${assetIds[0]}/thumbnail?size=preview`,
      mimeType: 'image/jpeg',
      fileName: 'preview.jpg',
      width: 1024,
      height: 768,
    },
  ] as never);

  const result =
    method === 'searchAssets'
      ? await sut.searchAssets(auth, session.id, { filters: {}, limit: 1 })
      : await sut.readAssetPreviews(auth, session.id, { assetIds });

  expect(result.status).toBe(expected);
});
```

- [ ] **Step 2: Add failing policy and edge-case service tests**

Add these cases:

```typescript
it('denies original reads for external providers unless explicitly allowed', async () => {
  const auth = AuthFactory.create();
  const assetIds = [newUuid()];
  const session = makeSession({
    userId: auth.user.id,
    permissionPlanSnapshot: makePlan({
      read: { metadata: true, previews: true, originals: true },
      providerExposure: {
        metadata: true,
        previews: true,
        originals: true,
        allowOriginalsForExternalProviders: false,
      },
      limits: {
        ...permissionPlanSnapshot.limits,
        maxOriginalsPerToolCall: 1,
        maxOriginalsPerSession: 1,
      },
    }),
  });

  sessionRepository.getById.mockResolvedValue(session);

  const result = await sut.readAssetOriginals(auth, session.id, { assetIds });

  expect(result).toEqual({
    status: 'denied',
    reason: 'Agent provider exposure policy only allows originals for local or self-hosted providers',
    toolCall: expect.objectContaining({ dataClass: AgentToolDataClass.Originals }),
  });
  expect(accessRepository.asset.checkOwnerAccess).not.toHaveBeenCalled();
});

it('allows original reads for openai-compatible credentials when the policy allows originals', async () => {
  const auth = AuthFactory.create();
  const assetIds = [newUuid()];
  const session = makeSession({
    userId: auth.user.id,
    approvalMode: AgentApprovalMode.PlanOnly,
    credentialSnapshot: {
      id: newUuid(),
      providerType: AgentProviderType.OpenAICompatible,
      label: 'Local model',
      baseUrl: 'http://localhost:11434/v1',
      models: ['llama-local'],
      defaultModel: 'llama-local',
    },
    modelSnapshot: { providerCredentialId: newUuid(), model: 'llama-local' },
    permissionPlanSnapshot: makePlan({
      read: { metadata: true, previews: true, originals: true },
      providerExposure: {
        metadata: true,
        previews: true,
        originals: true,
        allowOriginalsForExternalProviders: false,
      },
      limits: {
        ...permissionPlanSnapshot.limits,
        maxOriginalsPerToolCall: 1,
        maxOriginalsPerSession: 1,
      },
    }),
  });

  sessionRepository.getById.mockResolvedValue(session);
  accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set(assetIds));
  assetRepository.getAgentOriginalReferencesByIds.mockResolvedValue([
    {
      assetId: assetIds[0],
      mediaUrl: `/api/assets/${assetIds[0]}/original`,
      mimeType: 'image/jpeg',
      fileName: 'image.jpg',
      width: 4000,
      height: 3000,
    },
  ] as never);

  const result = await sut.readAssetOriginals(auth, session.id, { assetIds });

  expect(result.status).toBe('success');
});

it('denies YOLO mode until slice 10 without executing the repository read', async () => {
  const auth = AuthFactory.create();
  const session = makeSession({ userId: auth.user.id, approvalMode: AgentApprovalMode.DangerouslySkipPermissions });

  sessionRepository.getById.mockResolvedValue(session);

  const result = await sut.searchAssets(auth, session.id, { filters: {}, limit: 10 });

  expect(result).toEqual({
    status: 'denied',
    reason: 'YOLO read mode is implemented in slice 10',
    toolCall: expect.objectContaining({ status: AgentToolCallStatus.Denied }),
  });
  expect(assetRepository.searchAgentMetadata).not.toHaveBeenCalled();
});
```

Add table-driven edge tests proving the same gate applies to every asset read path:

- `searchAssets`, `readAssetMetadata`, `readAssetPreviews`, and `readAssetOriginals` all deny inaccessible asset ids before returning data.
- Shared-space assets are returned only when `permissionPlan.assetScope.sharedSpaces` is true.
- Locked assets require both `permissionPlan.assetScope.locked` and elevated auth; runner gateway auth is not elevated.
- Per-session limits are counted by `AgentToolDataClass` and exclude the current approved tool call during strict re-execution.
- Search filters using album/tag ids are visibility-constrained and do not leak inaccessible ids through counts or errors.
- Missing preview/original reference rows return only available references and audit the returned count, not the requested count.
- `readAlbum` denies albums whose asset count would exceed `maxAssetsPerToolCall`.

- [ ] **Step 3: Run service tests and confirm failure**

Run:

```bash
pnpm --dir server test src/services/agent-tool.service.spec.ts
```

Expected: FAIL because the expanded methods and generic approval matrix are missing.

- [ ] **Step 4: Refactor service around a generic read-tool executor**

In `server/src/services/agent-tool.service.ts`, add this internal descriptor type:

```typescript
type AgentReadToolDescriptor<TRequest, TResult> = {
  toolName: AgentToolName;
  dataClass: AgentToolDataClass;
  requestSummary: (request: TRequest) => string;
  requestMetadata: (request: TRequest) => AgentToolCall['redactedRequestMetadata'];
  requestedAssetCount: (request: TRequest) => number;
  requestedAlbumCount: (request: TRequest) => number;
  perToolLimit: (plan: AgentPermissionPlanSnapshot) => number;
  perSessionLimit: (plan: AgentPermissionPlanSnapshot) => number;
  validateAccess: (auth: AuthDto, session: AgentSession, request: TRequest) => Promise<string | null>;
  execute: (auth: AuthDto, session: AgentSession, request: TRequest) => Promise<TResult>;
  responseSummary: (result: TResult) => string;
  responseMetadata: (result: TResult) => AgentToolCall['redactedResponseMetadata'];
  resultAssetCount: (result: TResult) => number;
  resultAlbumCount: (result: TResult) => number;
};
```

Add public methods:

```typescript
searchAssets(auth: AuthDto, sessionId: string, dto: AgentSearchAssetsToolRequestDto): Promise<AgentSearchAssetsToolResponse>;
readAssetPreviews(auth: AuthDto, sessionId: string, dto: AgentReadAssetPreviewsToolRequestDto): Promise<AgentReadAssetPreviewsToolResponse>;
readAssetOriginals(auth: AuthDto, sessionId: string, dto: AgentReadAssetOriginalsToolRequestDto): Promise<AgentReadAssetOriginalsToolResponse>;
listAlbums(auth: AuthDto, sessionId: string, dto: AgentListAlbumsToolRequestDto): Promise<AgentListAlbumsToolResponse>;
readAlbum(auth: AuthDto, sessionId: string, dto: AgentReadAlbumToolRequestDto): Promise<AgentReadAlbumToolResponse>;
```

Keep `readAssetMetadata()` as a public method, but route it through the same executor.
Approved execution by `toolCallId` must load the stored pending call for the same session, rehydrate the original request metadata, claim it with a guarded transition to `Executing`, and then re-run session ownership, policy, normal access, provider exposure, limits, and active-session checks before executing. This is the drift/race protection required by the design.

- [ ] **Step 5: Implement policy helpers**

Add exact helper behavior:

```typescript
private getPolicyDenial(
  session: AgentSession,
  dataClass: AgentToolDataClass,
): string | null {
  if (session.approvalMode === AgentApprovalMode.DangerouslySkipPermissions) {
    return 'YOLO read mode is implemented in slice 10';
  }

  const plan = session.permissionPlanSnapshot;
  if (dataClass === AgentToolDataClass.Metadata && !plan.read.metadata) {
    return 'Agent permission policy does not allow metadata reads';
  }
  if (dataClass === AgentToolDataClass.Previews && !plan.read.previews) {
    return 'Agent permission policy does not allow preview reads';
  }
  if (dataClass === AgentToolDataClass.Originals && !plan.read.originals) {
    return 'Agent permission policy does not allow original reads';
  }

  if (dataClass === AgentToolDataClass.Metadata && !plan.providerExposure.metadata) {
    return 'Agent provider exposure policy does not allow metadata reads';
  }
  if (dataClass === AgentToolDataClass.Previews && !plan.providerExposure.previews) {
    return 'Agent provider exposure policy does not allow preview reads';
  }
  if (dataClass === AgentToolDataClass.Originals && !plan.providerExposure.originals) {
    return 'Agent provider exposure policy does not allow original reads';
  }
  if (
    dataClass === AgentToolDataClass.Originals &&
    !plan.providerExposure.allowOriginalsForExternalProviders &&
    session.credentialSnapshot.providerType !== AgentProviderType.OpenAICompatible
  ) {
    return 'Agent provider exposure policy only allows originals for local or self-hosted providers';
  }

  return null;
}

private requiresApproval(session: AgentSession, dataClass: AgentToolDataClass): boolean {
  if (session.approvalMode === AgentApprovalMode.Strict) {
    return true;
  }
  if (session.approvalMode === AgentApprovalMode.AskOnEscalation) {
    return dataClass !== AgentToolDataClass.Metadata;
  }
  if (session.approvalMode === AgentApprovalMode.PlanOnly) {
    return false;
  }
  return true;
}
```

- [ ] **Step 6: Implement expanded tools**

The tool implementations must satisfy:

- `searchAssets`: validates metadata policy, limit `<= maxAssetsPerToolCall`, derives repository scope from `permissionPlan.assetScope` plus elevated auth, executes `assetRepository.searchAgentMetadata({ scope })`, orders by repository result, and audits returned asset ids.
- `readAssetMetadata`: preserves existing response shape and tests, but no longer denies `AskOnEscalation` or `PlanOnly`.
- `readAssetPreviews`: validates preview read flags, provider exposure, `maxPreviewsPerToolCall`, `maxPreviewsPerSession`, normal asset access, and returns ordered preview references.
- `readAssetOriginals`: validates original read flags, provider exposure, external-provider restriction, `maxOriginalsPerToolCall`, `maxOriginalsPerSession`, normal asset access, and returns ordered original references.
- `listAlbums`: validates metadata policy, returns owned/shared album summaries, and audits album ids/counts.
- `readAlbum`: validates metadata policy, normal album access, album asset count `<= maxAssetsPerToolCall`, and returns album detail.

- [ ] **Step 7: Preserve existing strict metadata behavior**

Run the existing metadata-specific tests:

```bash
pnpm --dir server test src/services/agent-tool.service.spec.ts -t "metadata"
```

Expected: PASS after updating assertions that previously expected non-strict approval modes to be denied. Replace those assertions with the approval matrix above.

- [ ] **Step 8: Run full agent tool service tests**

Run:

```bash
pnpm --dir server test src/services/agent-tool.service.spec.ts
```

Expected: PASS.

- [ ] **Step 9: Commit generic read tool gate**

```bash
git add server/src/services/agent-tool.service.ts server/src/services/agent-tool.service.spec.ts
git commit -m "feat: expand agent read tool gate"
```

## Task 5: Browser Routes And Runner Tool Gateway

**Files:**

- Modify: `server/src/controllers/agent-tool.controller.ts`
- Modify: `server/src/controllers/agent-tool.controller.spec.ts`
- Create: `server/src/services/agent-runner-tool-token.service.ts`
- Create: `server/src/services/agent-runner-tool-token.service.spec.ts`
- Create: `server/src/controllers/agent-runner-tool.controller.ts`
- Create: `server/src/controllers/agent-runner-tool.controller.spec.ts`
- Modify: `server/src/controllers/index.ts`
- Modify: `server/src/services/index.ts`

- [ ] **Step 1: Write failing controller tests for expanded browser routes**

Add route cases to `server/src/controllers/agent-tool.controller.spec.ts`:

```typescript
it.each([
  ['searchAssets', 'post', `/agent/sessions/${sessionId}/tools/search-assets`, { filters: {}, limit: 25 }],
  ['readAssetPreviews', 'post', `/agent/sessions/${sessionId}/tools/read-asset-previews`, { assetIds: [assetId] }],
  ['readAssetOriginals', 'post', `/agent/sessions/${sessionId}/tools/read-asset-originals`, { assetIds: [assetId] }],
  ['listAlbums', 'post', `/agent/sessions/${sessionId}/tools/list-albums`, {}],
  ['readAlbum', 'post', `/agent/sessions/${sessionId}/tools/read-album`, { albumId: factory.uuid() }],
] as const)('routes %s through update-authenticated tool endpoint', async (method, httpMethod, path, body) => {
  service[method].mockResolvedValue({ status: 'approval-required', toolCall });

  await request(ctx.getHttpServer())[httpMethod](path).send(body);

  expect(ctx.authenticate).toHaveBeenCalled();
  expectPermission(Permission.AgentSessionUpdate);
  expect(service[method]).toHaveBeenCalledWith(auth, sessionId, body);
});
```

- [ ] **Step 2: Write failing runner gateway token tests**

Create `server/src/services/agent-runner-tool-token.service.spec.ts`:

```typescript
describe(AgentRunnerToolTokenService.name, () => {
  const configRepository = { getEnv: vi.fn() };
  let sut: AgentRunnerToolTokenService;

  beforeEach(() => {
    configRepository.getEnv.mockReturnValue({ agent: { secretKey: 'test-agent-secret' } });
    sut = new AgentRunnerToolTokenService(configRepository as never);
  });

  it('creates and verifies a session-scoped token', () => {
    const token = sut.create({ sessionId: 'session-1', userId: 'user-1', expiresAt: new Date('2026-05-15T15:00:00Z') });

    expect(sut.verify(token, new Date('2026-05-15T14:00:00Z'))).toEqual({
      sessionId: 'session-1',
      userId: 'user-1',
      expiresAt: new Date('2026-05-15T15:00:00.000Z'),
    });
  });

  it('rejects tampered tokens', () => {
    const token = sut.create({ sessionId: 'session-1', userId: 'user-1', expiresAt: new Date('2026-05-15T15:00:00Z') });
    const tampered = `${token.slice(0, -1)}${token.endsWith('a') ? 'b' : 'a'}`;

    expect(() => sut.verify(tampered, new Date('2026-05-15T14:00:00Z'))).toThrow('Invalid agent runner tool token');
  });

  it('rejects expired tokens', () => {
    const token = sut.create({ sessionId: 'session-1', userId: 'user-1', expiresAt: new Date('2026-05-15T15:00:00Z') });

    expect(() => sut.verify(token, new Date('2026-05-15T15:00:01Z'))).toThrow('Agent runner tool token expired');
  });

  it('rejects token creation when the agent secret key is missing', () => {
    configRepository.getEnv.mockReturnValue({ agent: { secretKey: '' } });
    sut = new AgentRunnerToolTokenService(configRepository as never);

    expect(() =>
      sut.create({ sessionId: 'session-1', userId: 'user-1', expiresAt: new Date('2026-05-15T15:00:00Z') }),
    ).toThrow('Agent credential encryption key is not configured');
  });
});
```

- [ ] **Step 3: Write failing runner gateway controller tests**

Create `server/src/controllers/agent-runner-tool.controller.spec.ts`:

```typescript
it('authenticates runner bearer token and dispatches searchAssets', async () => {
  tokenService.verify.mockReturnValue({ sessionId, userId: auth.user.id, expiresAt: new Date('2026-05-15T15:00:00Z') });
  service.searchAssets.mockResolvedValue({ status: 'success', toolCall, assets: [], nextPage: null });

  const { status, body } = await request(ctx.getHttpServer())
    .post(`/agent/internal/tools/sessions/${sessionId}/search-assets`)
    .set('Authorization', 'Bearer token-1')
    .send({ filters: {}, limit: 10 });

  expect(status).toBe(201);
  expect(body.status).toBe('success');
  expect(service.searchAssets).toHaveBeenCalledWith(
    expect.objectContaining({ user: expect.objectContaining({ id: auth.user.id }) }),
    sessionId,
    { filters: {}, limit: 10 },
  );
});

it('rejects a token for a different session id', async () => {
  tokenService.verify.mockReturnValue({
    sessionId: factory.uuid(),
    userId: auth.user.id,
    expiresAt: new Date('2026-05-15T15:00:00Z'),
  });

  const { status } = await request(ctx.getHttpServer())
    .post(`/agent/internal/tools/sessions/${sessionId}/search-assets`)
    .set('Authorization', 'Bearer token-1')
    .send({ filters: {}, limit: 10 });

  expect(status).toBe(401);
  expect(service.searchAssets).not.toHaveBeenCalled();
});
```

- [ ] **Step 4: Run controller/token tests and confirm failure**

Run:

```bash
pnpm --dir server test src/controllers/agent-tool.controller.spec.ts src/controllers/agent-runner-tool.controller.spec.ts src/services/agent-runner-tool-token.service.spec.ts
```

Expected: FAIL because new routes/services are missing.

- [ ] **Step 5: Implement expanded browser routes**

Add POST routes to `AgentToolController`:

```typescript
@Post('tools/search-assets')
@Authenticated({ permission: Permission.AgentSessionUpdate })
searchAssets(@Auth() auth: AuthDto, @Param() { id }: UUIDParamDto, @Body() dto: AgentSearchAssetsToolRequestDto) {
  return this.service.searchAssets(auth, id, dto);
}

@Post('tools/read-asset-previews')
@Authenticated({ permission: Permission.AgentSessionUpdate })
readAssetPreviews(@Auth() auth: AuthDto, @Param() { id }: UUIDParamDto, @Body() dto: AgentReadAssetPreviewsToolRequestDto) {
  return this.service.readAssetPreviews(auth, id, dto);
}

@Post('tools/read-asset-originals')
@Authenticated({ permission: Permission.AgentSessionUpdate })
readAssetOriginals(@Auth() auth: AuthDto, @Param() { id }: UUIDParamDto, @Body() dto: AgentReadAssetOriginalsToolRequestDto) {
  return this.service.readAssetOriginals(auth, id, dto);
}

@Post('tools/list-albums')
@Authenticated({ permission: Permission.AgentSessionUpdate })
listAlbums(@Auth() auth: AuthDto, @Param() { id }: UUIDParamDto, @Body() dto: AgentListAlbumsToolRequestDto) {
  return this.service.listAlbums(auth, id, dto);
}

@Post('tools/read-album')
@Authenticated({ permission: Permission.AgentSessionUpdate })
readAlbum(@Auth() auth: AuthDto, @Param() { id }: UUIDParamDto, @Body() dto: AgentReadAlbumToolRequestDto) {
  return this.service.readAlbum(auth, id, dto);
}
```

Use `HistoryBuilder().added('v2.7.5').internal('v2.7.5')` for tool execution endpoints, matching the existing metadata route.

- [ ] **Step 6: Implement runner token service**

Create `server/src/services/agent-runner-tool-token.service.ts`:

```typescript
import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { ConfigRepository } from 'src/repositories/config.repository';

type CreateTokenInput = { sessionId: string; userId: string; expiresAt: Date };
type VerifiedToken = CreateTokenInput;

const base64url = (value: Buffer | string) => Buffer.from(value).toString('base64url');

@Injectable()
export class AgentRunnerToolTokenService {
  constructor(private readonly configRepository: ConfigRepository) {}

  create(input: CreateTokenInput): string {
    const claims = JSON.stringify({
      sessionId: input.sessionId,
      userId: input.userId,
      expiresAt: input.expiresAt.toISOString(),
    });
    const encodedClaims = base64url(claims);
    return `v1.${encodedClaims}.${this.sign(encodedClaims)}`;
  }

  verify(token: string, now = new Date()): VerifiedToken {
    const [version, encodedClaims, signature] = token.split('.');
    if (version !== 'v1' || !encodedClaims || !signature) {
      throw new UnauthorizedException('Invalid agent runner tool token');
    }

    const expected = this.sign(encodedClaims);
    if (!this.safeEqual(signature, expected)) {
      throw new UnauthorizedException('Invalid agent runner tool token');
    }

    let claims: {
      sessionId?: unknown;
      userId?: unknown;
      expiresAt?: unknown;
    };
    try {
      claims = JSON.parse(Buffer.from(encodedClaims, 'base64url').toString('utf8')) as typeof claims;
    } catch {
      throw new UnauthorizedException('Invalid agent runner tool token');
    }
    if (
      typeof claims.sessionId !== 'string' ||
      typeof claims.userId !== 'string' ||
      typeof claims.expiresAt !== 'string'
    ) {
      throw new UnauthorizedException('Invalid agent runner tool token');
    }

    const expiresAt = new Date(claims.expiresAt);
    if (Number.isNaN(expiresAt.getTime())) {
      throw new UnauthorizedException('Invalid agent runner tool token');
    }
    if (expiresAt <= now) {
      throw new UnauthorizedException('Agent runner tool token expired');
    }

    return { sessionId: claims.sessionId, userId: claims.userId, expiresAt };
  }

  private sign(encodedClaims: string): string {
    const secretKey = this.configRepository.getEnv().agent.secretKey;
    if (!secretKey) {
      throw new BadRequestException('Agent credential encryption key is not configured');
    }
    return createHmac('sha256', secretKey).update(encodedClaims).digest('base64url');
  }

  private safeEqual(left: string, right: string) {
    const leftBuffer = Buffer.from(left);
    const rightBuffer = Buffer.from(right);
    return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
  }
}
```

- [ ] **Step 7: Implement runner gateway controller**

Create `server/src/controllers/agent-runner-tool.controller.ts`:

```typescript
@ApiTags(ApiTag.AgentSessions)
@Controller('agent/internal/tools/sessions/:id')
export class AgentRunnerToolController {
  constructor(
    private readonly tokenService: AgentRunnerToolTokenService,
    private readonly toolService: AgentToolService,
  ) {}

  private authFromRequest(sessionId: string, authorization?: string): AuthDto {
    const token = authorization?.startsWith('Bearer ') ? authorization.slice('Bearer '.length) : '';
    const claims = this.tokenService.verify(token);
    if (claims.sessionId !== sessionId) {
      throw new UnauthorizedException('Invalid agent runner tool token');
    }

    return {
      user: {
        id: claims.userId,
        isAdmin: false,
        name: 'Agent runner',
        email: '',
        quotaUsageInBytes: 0,
        quotaSizeInBytes: null,
      },
    };
  }
}
```

Add one `@Post()` method per tool that calls `authFromRequest()` and delegates to `AgentToolService`. Mark these endpoints with `HistoryBuilder().added('v2.7.5').internal('v2.7.5')`.

- [ ] **Step 8: Run route and token tests**

Run:

```bash
pnpm --dir server test src/controllers/agent-tool.controller.spec.ts src/controllers/agent-runner-tool.controller.spec.ts src/services/agent-runner-tool-token.service.spec.ts
```

Expected: PASS.

- [ ] **Step 9: Commit controller and runner gateway**

```bash
git add server/src/controllers/agent-tool.controller.ts server/src/controllers/agent-tool.controller.spec.ts server/src/controllers/agent-runner-tool.controller.ts server/src/controllers/agent-runner-tool.controller.spec.ts server/src/controllers/index.ts server/src/services/agent-runner-tool-token.service.ts server/src/services/agent-runner-tool-token.service.spec.ts server/src/services/index.ts
git commit -m "feat: expose agent read tool gateway"
```

## Task 6: Runner Tool Gateway Handoff

**Files:**

- Modify: `server/src/dtos/env.dto.ts`
- Modify: `server/src/repositories/config.repository.ts`
- Modify: `server/src/repositories/config.repository.spec.ts`
- Modify: `server/src/types/agent-runner.types.ts`
- Modify: `server/src/services/agent-runner.service.ts`
- Modify: `server/src/services/agent-runner.service.spec.ts`

- [ ] **Step 1: Write failing config tests**

Add to `server/src/repositories/config.repository.spec.ts`:

```typescript
it('parses the agent tool gateway URL', () => {
  process.env.IMMICH_AGENT_TOOL_GATEWAY_URL = 'http://immich-server:2283/api/agent/internal/tools';

  expect(getEnv().agent).toEqual(
    expect.objectContaining({
      toolGatewayUrl: 'http://immich-server:2283/api/agent/internal/tools',
    }),
  );
});

it('rejects non-http agent tool gateway URLs', () => {
  process.env.IMMICH_AGENT_TOOL_GATEWAY_URL = 'ftp://immich-server/tools';

  expect(() => getEnv()).toThrowError('[IMMICH_AGENT_TOOL_GATEWAY_URL] Tool gateway URL must use http or https');
});
```

- [ ] **Step 2: Write failing runner service handoff test**

Add to `server/src/services/agent-runner.service.spec.ts`:

```typescript
it('includes a short-lived tool gateway token when the gateway URL is configured', async () => {
  configRepository.getEnv.mockReturnValue({
    agent: {
      runnerUrl: 'http://agent-runner:4477',
      runnerHealthTimeoutMs: 3000,
      toolGatewayUrl: 'http://immich-server:2283/api/agent/internal/tools',
    },
  });
  tokenService.create.mockReturnValue('tool-token-1');
  agentRunnerRepository.createSession.mockResolvedValue({
    runnerSessionId: 'runner-session-1',
    capabilities: { streaming: true, tools: ['searchAssets'] },
  });

  const body = { ...createSessionBody, userId: 'user-1' };
  const result = await sut.createSession(body);

  expect(tokenService.create).toHaveBeenCalledWith(
    expect.objectContaining({
      sessionId: body.gallerySessionId,
      userId: 'user-1',
    }),
  );

  expect(agentRunnerRepository.createSession).toHaveBeenCalledWith(
    expect.objectContaining({
      body: expect.objectContaining({
        toolGateway: {
          url: 'http://immich-server:2283/api/agent/internal/tools',
          token: 'tool-token-1',
        },
      }),
    }),
  );
  expect(JSON.stringify(result)).not.toContain('tool-token-1');
});

it('passes a null tool gateway when the gateway URL is not configured', async () => {
  configRepository.getEnv.mockReturnValue({
    agent: {
      runnerUrl: 'http://agent-runner:4477',
      runnerHealthTimeoutMs: 3000,
      toolGatewayUrl: undefined,
    },
  });
  agentRunnerRepository.createSession.mockResolvedValue({
    runnerSessionId: 'runner-session-1',
    capabilities: { streaming: true, tools: [] },
  });

  await sut.createSession({ ...createSessionBody, userId: 'user-1' });

  expect(tokenService.create).not.toHaveBeenCalled();
  expect(agentRunnerRepository.createSession).toHaveBeenCalledWith(
    expect.objectContaining({
      body: expect.objectContaining({ toolGateway: null }),
    }),
  );
});
```

- [ ] **Step 3: Run tests and confirm failure**

Run:

```bash
pnpm --dir server test src/repositories/config.repository.spec.ts src/services/agent-runner.service.spec.ts
```

Expected: FAIL because `toolGatewayUrl` and token handoff are missing.

- [ ] **Step 4: Add config and type fields**

Add to `server/src/dtos/env.dto.ts`:

```typescript
const agentToolGatewayUrl = z.url().refine((value) => /^https?:\/\//i.test(value), {
  message: 'Tool gateway URL must use http or https',
});

// ...
IMMICH_AGENT_TOOL_GATEWAY_URL: agentToolGatewayUrl.optional(),
```

Add `toolGatewayUrl?: string` to `ConfigRepository` agent env shape and map `dto.IMMICH_AGENT_TOOL_GATEWAY_URL`.

Update `server/src/types/agent-runner.types.ts` with `AgentRunnerToolGateway`, nullable `toolGateway`, and a service-only input type:

```typescript
export type AgentRunnerCreateSessionInput = AgentRunnerCreateSessionRequest & {
  userId: string;
};
```

- [ ] **Step 5: Include tool gateway token in runner session creation**

Inject `AgentRunnerToolTokenService` into `AgentRunnerService` and compute expiry:

```typescript
const expiresAt = body.permissionPlan.limits.expiresInMinutes
  ? new Date(Date.now() + body.permissionPlan.limits.expiresInMinutes * 60_000)
  : new Date(Date.now() + 2 * 60 * 60_000);

const toolGateway = toolGatewayUrl
  ? {
      url: toolGatewayUrl,
      token: this.agentRunnerToolTokenService.create({
        sessionId: body.gallerySessionId,
        userId,
        expiresAt,
      }),
    }
  : null;
```

Change `AgentRunnerService.createSession()` to accept `AgentRunnerCreateSessionInput`, destructure `userId` out before calling the runner repository, and pass only the runner protocol body plus `toolGateway`:

```typescript
async createSession({ userId, ...body }: AgentRunnerCreateSessionInput) {
  // ...
  await this.agentRunnerRepository.createSession({
    url: runnerUrl,
    timeoutMs: runnerHealthTimeoutMs,
    body: { ...body, toolGateway },
  });
}
```

Pass `userId: auth.user.id` from `AgentSessionService.create()`. Do not add `userId` to the runner protocol payload.

- [ ] **Step 6: Run server handoff tests**

Run:

```bash
pnpm --dir server test src/repositories/config.repository.spec.ts src/services/agent-runner.service.spec.ts src/services/agent-session.service.spec.ts
```

Expected: PASS.

- [ ] **Step 7: Commit runner handoff**

```bash
git add server/src/dtos/env.dto.ts server/src/repositories/config.repository.ts server/src/repositories/config.repository.spec.ts server/src/types/agent-runner.types.ts server/src/services/agent-runner.service.ts server/src/services/agent-runner.service.spec.ts server/src/services/agent-session.service.ts server/src/services/agent-session.service.spec.ts
git commit -m "feat: pass agent read tool gateway to runner"
```

## Task 7: Agent Runner Custom Tools

**Files:**

- Modify: `agent-runner/package.json`
- Create: `agent-runner/src/gallery-tool-client.mjs`
- Create: `agent-runner/src/gallery-tool-client.test.mjs`
- Create: `agent-runner/src/gallery-tools.mjs`
- Create: `agent-runner/src/gallery-tools.test.mjs`
- Modify: `agent-runner/src/pi-runtime.mjs`
- Modify: `agent-runner/src/pi-runtime.test.mjs`
- Modify: `agent-runner/src/server.mjs`
- Modify: `agent-runner/src/server.test.mjs`
- Modify: `pnpm-lock.yaml`

- [ ] **Step 1: Add failing runner tool client tests**

Create `agent-runner/src/gallery-tool-client.test.mjs`:

```javascript
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createGalleryToolClient, redactGatewayToken } from './gallery-tool-client.mjs';

describe('gallery tool client', () => {
  it('posts tool requests with the runner bearer token', async () => {
    const calls = [];
    const client = createGalleryToolClient({
      fetch: async (url, init) => {
        calls.push({ url: String(url), init });
        return new Response(
          JSON.stringify({ status: 'success', toolCall: { id: 'tool-1' }, assets: [], nextPage: null }),
          {
            status: 201,
            headers: { 'Content-Type': 'application/json' },
          },
        );
      },
      gateway: { url: 'http://gallery/api/agent/internal/tools', token: 'runner-token-1' },
      gallerySessionId: 'gallery-session-1',
    });

    const result = await client.call('search-assets', { filters: {}, limit: 10 });

    assert.equal(result.status, 'success');
    assert.equal(calls[0].url, 'http://gallery/api/agent/internal/tools/sessions/gallery-session-1/search-assets');
    assert.equal(calls[0].init.headers.Authorization, 'Bearer runner-token-1');
  });

  it('redacts tool gateway tokens from errors', async () => {
    assert.equal(redactGatewayToken('failed runner-token-1', 'runner-token-1'), 'failed [redacted]');
  });

  it('passes approval-required and denied responses through unchanged', async () => {
    for (const responseBody of [
      { status: 'approval-required', toolCall: { id: 'tool-1' } },
      { status: 'denied', reason: 'policy denied', toolCall: { id: 'tool-2' } },
    ]) {
      const client = createGalleryToolClient({
        fetch: async () => new Response(JSON.stringify(responseBody), { status: 201 }),
        gateway: { url: 'http://gallery/api/agent/internal/tools', token: 'runner-token-1' },
        gallerySessionId: 'gallery-session-1',
      });

      assert.deepEqual(await client.call('search-assets', { filters: {}, limit: 10 }), responseBody);
    }
  });

  it('redacts the bearer token from invalid JSON errors', async () => {
    const client = createGalleryToolClient({
      fetch: async () => new Response('not-json runner-token-1', { status: 201 }),
      gateway: { url: 'http://gallery/api/agent/internal/tools', token: 'runner-token-1' },
      gallerySessionId: 'gallery-session-1',
    });

    await assert.rejects(
      () => client.call('search-assets', { filters: {}, limit: 10 }),
      (error) => {
        assert.equal(error.message.includes('runner-token-1'), false);
        return true;
      },
    );
  });
});
```

- [ ] **Step 2: Add failing custom tool registry tests**

Create `agent-runner/src/gallery-tools.test.mjs`:

```javascript
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createGalleryReadTools, galleryReadToolNames } from './gallery-tools.mjs';

describe('gallery read tools', () => {
  it('defines only read tools and no write tools', () => {
    assert.deepEqual(galleryReadToolNames, [
      'searchAssets',
      'readAssetMetadata',
      'readAssetPreviews',
      'readAssetOriginals',
      'listAlbums',
      'readAlbum',
    ]);
    assert.equal(
      galleryReadToolNames.some((name) => name.toLowerCase().includes('write')),
      false,
    );
    assert.equal(
      galleryReadToolNames.some((name) => name.toLowerCase().includes('albumoperation')),
      false,
    );
  });

  it('executes searchAssets through the Gallery tool client', async () => {
    const calls = [];
    const tools = createGalleryReadTools({
      call: async (path, body) => {
        calls.push({ path, body });
        return { status: 'success', assets: [], nextPage: null, toolCall: { id: 'tool-1' } };
      },
    });

    const tool = tools.find((item) => item.name === 'searchAssets');
    const result = await tool.execute('pi-tool-call-1', { filters: {}, limit: 10 });

    assert.deepEqual(calls, [{ path: 'search-assets', body: { filters: {}, limit: 10 } }]);
    assert.deepEqual(result.details.status, 'success');
    assert.equal(result.content[0].text.includes('searchAssets returned success'), true);
  });

  it('maps every read tool to its server route', async () => {
    const calls = [];
    const tools = createGalleryReadTools({
      call: async (path, body) => {
        calls.push({ path, body });
        return { status: 'success', toolCall: { id: `tool-${calls.length}` } };
      },
    });

    const cases = [
      ['searchAssets', 'search-assets', { filters: {}, limit: 10 }],
      ['readAssetMetadata', 'read-asset-metadata', { assetIds: ['asset-1'] }],
      ['readAssetPreviews', 'read-asset-previews', { assetIds: ['asset-1'] }],
      ['readAssetOriginals', 'read-asset-originals', { assetIds: ['asset-1'] }],
      ['listAlbums', 'list-albums', {}],
      ['readAlbum', 'read-album', { albumId: 'album-1' }],
    ];

    for (const [name, path, body] of cases) {
      const tool = tools.find((item) => item.name === name);
      await tool.execute(`pi-${name}`, body);
      assert.deepEqual(calls.at(-1), { path, body });
    }
  });
});
```

- [ ] **Step 3: Run runner tests and confirm failure**

Run:

```bash
pnpm --dir agent-runner test
```

Expected: FAIL because the new runner modules are missing.

- [ ] **Step 4: Add direct TypeBox dependency**

Update `agent-runner/package.json`:

```json
"dependencies": {
  "@earendil-works/pi-ai": "^0.74.0",
  "@earendil-works/pi-coding-agent": "^0.74.0",
  "typebox": "^1.1.38"
}
```

Run:

```bash
pnpm install --lockfile-only
```

Expected: `pnpm-lock.yaml` records `typebox` for the `agent-runner` importer.

- [ ] **Step 5: Implement gallery tool client**

Create `agent-runner/src/gallery-tool-client.mjs`:

```javascript
export const redactGatewayToken = (message, token) => {
  if (!token) {
    return message;
  }
  return message.split(token).join('[redacted]');
};

export const createGalleryToolClient = ({ fetch: fetchImpl = fetch, gateway, gallerySessionId }) => ({
  async call(path, body, signal) {
    const url = new URL(
      `${gateway.url.replace(/\/$/, '')}/sessions/${encodeURIComponent(gallerySessionId)}/${path.replace(/^\//, '')}`,
    );
    const response = await fetchImpl(url, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${gateway.token}`,
      },
      body: JSON.stringify(body),
      signal,
    });

    if (!response.ok) {
      throw new Error(`Gallery tool request failed with status ${response.status}`);
    }

    try {
      return await response.json();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(redactGatewayToken(message, gateway.token));
    }
  },
});
```

- [ ] **Step 6: Implement Gallery read custom tools**

Create `agent-runner/src/gallery-tools.mjs`:

```javascript
import { defineTool } from '@earendil-works/pi-coding-agent';
import * as Type from 'typebox';

export const galleryReadToolNames = [
  'searchAssets',
  'readAssetMetadata',
  'readAssetPreviews',
  'readAssetOriginals',
  'listAlbums',
  'readAlbum',
];

const toolResult = (name, result) => ({
  content: [{ type: 'text', text: `${name} returned ${result.status}. ${JSON.stringify(result)}` }],
  details: result,
});

export const createGalleryReadTools = (client) => [
  defineTool({
    name: 'searchAssets',
    label: 'Search Assets',
    description: 'Search the user accessible Gallery library using metadata filters.',
    promptSnippet: 'searchAssets filters accessible photos by metadata and returns redacted asset metadata.',
    promptGuidelines: ['Use Gallery read tools only to inspect photos; never claim album writes were applied.'],
    parameters: Type.Object({
      filters: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
      limit: Type.Optional(Type.Number({ minimum: 1, maximum: 1000 })),
      toolCallId: Type.Optional(Type.String()),
    }),
    execute: async (_toolCallId, params, signal) =>
      toolResult('searchAssets', await client.call('search-assets', params, signal)),
  }),
  defineTool({
    name: 'readAssetMetadata',
    label: 'Read Asset Metadata',
    description: 'Read redacted metadata for specific Gallery asset ids.',
    parameters: Type.Object({
      assetIds: Type.Optional(Type.Array(Type.String(), { minItems: 1 })),
      toolCallId: Type.Optional(Type.String()),
    }),
    execute: async (_toolCallId, params, signal) =>
      toolResult('readAssetMetadata', await client.call('read-asset-metadata', params, signal)),
  }),
  defineTool({
    name: 'readAssetPreviews',
    label: 'Read Asset Previews',
    description: 'Read preview media references for specific Gallery asset ids when policy allows previews.',
    parameters: Type.Object({
      assetIds: Type.Optional(Type.Array(Type.String(), { minItems: 1 })),
      toolCallId: Type.Optional(Type.String()),
    }),
    execute: async (_toolCallId, params, signal) =>
      toolResult('readAssetPreviews', await client.call('read-asset-previews', params, signal)),
  }),
  defineTool({
    name: 'readAssetOriginals',
    label: 'Read Asset Originals',
    description: 'Read original media references for specific Gallery asset ids when policy allows originals.',
    parameters: Type.Object({
      assetIds: Type.Optional(Type.Array(Type.String(), { minItems: 1 })),
      toolCallId: Type.Optional(Type.String()),
    }),
    execute: async (_toolCallId, params, signal) =>
      toolResult('readAssetOriginals', await client.call('read-asset-originals', params, signal)),
  }),
  defineTool({
    name: 'listAlbums',
    label: 'List Albums',
    description: 'List albums accessible to the user with redacted summary metadata.',
    parameters: Type.Object({ toolCallId: Type.Optional(Type.String()) }),
    execute: async (_toolCallId, params, signal) =>
      toolResult('listAlbums', await client.call('list-albums', params, signal)),
  }),
  defineTool({
    name: 'readAlbum',
    label: 'Read Album',
    description: 'Read one accessible album summary and its asset ids.',
    parameters: Type.Object({ albumId: Type.Optional(Type.String()), toolCallId: Type.Optional(Type.String()) }),
    execute: async (_toolCallId, params, signal) =>
      toolResult('readAlbum', await client.call('read-album', params, signal)),
  }),
];
```

- [ ] **Step 7: Enable custom tools in Pi runtime when gateway is present**

Update `agent-runner/src/pi-runtime.mjs`:

```javascript
import { createGalleryToolClient } from './gallery-tool-client.mjs';
import { createGalleryReadTools, galleryReadToolNames } from './gallery-tools.mjs';
```

Inside `createSession(body)` before `sdk.createAgentSession()`:

```javascript
const customTools = body.toolGateway
  ? createGalleryReadTools(
      createGalleryToolClient({
        gateway: body.toolGateway,
        gallerySessionId: body.gallerySessionId,
      }),
    )
  : [];
```

Pass:

```javascript
const { session } = await sdk.createAgentSession({
  model,
  authStorage,
  modelRegistry,
  sessionManager: sdk.SessionManager.inMemory(),
  settingsManager,
  resourceLoader,
  noTools: 'builtin',
  tools: [],
  customTools,
});
```

Return capabilities:

```javascript
tools: body.toolGateway ? galleryReadToolNames : [],
```

Built-in tools remain disabled because `noTools: 'builtin'`, `tools: []`, and `customTools` contains only the Gallery read tools.

- [ ] **Step 8: Update runner HTTP validation and capabilities**

Update `agent-runner/src/server.mjs`:

- `validateCreateSessionBody()` accepts `toolGateway: null | { url: string, token: string }`.
- `normalizeRuntimeCreateSessionResponse()` continues filtering response fields and permits expanded `capabilities.tools`.
- Health capabilities stay static `tools: []`, because tools are session-scoped and depend on server gateway configuration.

Add tests in `agent-runner/src/server.test.mjs` proving:

- `POST /sessions` passes `toolGateway` to runtime.
- responses never include `toolGateway.token`;
- missing `toolGateway.token` returns `400`;
- session capabilities include read tool names when runtime returns them.

- [ ] **Step 9: Run runner tests**

Run:

```bash
pnpm --dir agent-runner test
```

Expected: PASS.

- [ ] **Step 10: Commit runner custom tools**

```bash
git add agent-runner/package.json agent-runner/src/gallery-tool-client.mjs agent-runner/src/gallery-tool-client.test.mjs agent-runner/src/gallery-tools.mjs agent-runner/src/gallery-tools.test.mjs agent-runner/src/pi-runtime.mjs agent-runner/src/pi-runtime.test.mjs agent-runner/src/server.mjs agent-runner/src/server.test.mjs pnpm-lock.yaml
git commit -m "feat: add Gallery read tools to pi runner"
```

## Task 8: Generated Artifacts And Verification

**Files:**

- Modify: `open-api/immich-openapi-specs.json`
- Modify: `open-api/typescript-sdk/**`
- Modify: `mobile/openapi/**`
- Modify: generated SQL files under `server/src/queries/**` if the repo generator updates them.

- [ ] **Step 1: Generate API and SQL artifacts**

Run the repo's existing generation commands:

```bash
pnpm --dir server build
pnpm api:generate
```

Expected: OpenAPI/SDK artifacts include expanded agent tool DTOs and routes. Generated SQL artifacts include new agent repository projection queries.

- [ ] **Step 2: Run focused verification**

Run:

```bash
pnpm --dir server test src/dtos/agent-session.dto.spec.ts src/dtos/agent-tool.dto.spec.ts src/services/agent-tool.service.spec.ts src/controllers/agent-tool.controller.spec.ts src/controllers/agent-runner-tool.controller.spec.ts src/services/agent-runner-tool-token.service.spec.ts src/services/agent-runner.service.spec.ts
pnpm --dir server test:medium agent-tool-call.repository.spec.ts asset.repository.spec.ts album.repository.spec.ts
pnpm --dir agent-runner test
```

Expected: PASS for all focused suites. If local medium tests are not feasible in the current environment, push and use CI as the full verification source.

- [ ] **Step 3: Review edge-case coverage before final push**

Confirm the tests cover:

- Strict mode pauses every read tool and creates a pending `agent_tool_call`.
- Ask-on-escalation auto-executes metadata tools and pauses preview/original tools.
- Plan-only auto-executes metadata, preview, and original tools when the selected permission plan allows the data class.
- YOLO mode is denied in slice 9 and does not bypass access or permission plans.
- Metadata, preview, and original read flags deny their matching data class.
- Provider exposure flags deny their matching data class.
- Originals require local/self-hosted provider unless `allowOriginalsForExternalProviders` is true.
- Owned/shared-space/locked asset scope is enforced.
- Locked assets require policy support and elevated auth; runner gateway auth is not elevated.
- Per-tool and per-session limits are enforced by data class.
- Strict approved execution revalidates access, policy, and limits.
- Execution claim races do not double-read or double-complete a tool call.
- Search/list/read album tools audit returned asset and album ids without storing media bytes.
- Preview/original tool responses do not include filesystem paths.
- Runner bearer token rejects tampering, expiry, missing secret key, and session mismatch.
- Runner capabilities list only read tools when a tool gateway is configured.
- Pi built-in tools remain disabled and no write tools are registered.
- Provider secrets and runner tool tokens are redacted from errors and responses.

- [ ] **Step 4: Commit generated artifacts and verification fixes**

```bash
git add open-api mobile server/src/queries agent-runner server pnpm-lock.yaml
git commit -m "chore: update agent read tool generated artifacts"
```

- [ ] **Step 5: Push and rely on CI for the full matrix**

Run:

```bash
git push origin explore/pi-agent-brainstorm
```

Expected: PR #574 updates. Use GitHub CI for the full test matrix, including server, web, runner, generated-artifact, and E2E jobs.

## Self-Review

- Spec coverage: This plan implements slice 9 read-tool expansion: search assets, list albums, read album, read previews, and permission enforcement for metadata, previews, and originals. It adds runner custom tools so the Pi runtime can request those reads through Gallery's server gate while keeping write tools unavailable.
- TDD discipline: Every task starts with failing tests, includes the minimal implementation steps needed to pass them, and ends with a focused commit. Service tests explicitly cover each approval mode and data class.
- Edge cases: The plan covers access drift, approval-time drift, race claims, duplicate ids, invalid DTO combinations, locked assets, external-provider original denial, per-tool limits, per-session limits, missing media references, missing/deleted albums, runner token expiry/tamper/session mismatch, and secret/token redaction.
- Deferred scope: YOLO auto-approval remains slice 10. Tool grants, album operation plans, plan review UI, apply behavior, and write tools remain out of scope.
- Type consistency: Tool names use camelCase enum values across DTOs, audits, service descriptors, controller routes, runner capabilities, and Pi custom tools. Data classes use `metadata`, `previews`, and `originals` consistently across permission checks and audit counts.
- Security: The runner gets a short-lived bearer token scoped to one agent session, no direct DB/storage/filesystem access, no normal album mutation API access, and no built-in Pi tools. Audit rows store summaries, ids, counts, provider snapshots, and errors only; previews/originals are returned as server media references, never stored as bytes or filesystem paths.
