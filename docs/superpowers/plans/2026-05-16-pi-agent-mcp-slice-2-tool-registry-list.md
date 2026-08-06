# Pi Agent MCP Slice 2 Tool Registry And List Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the second MCP vertical slice: a Gallery-owned MCP tool registry for the nine initial Pi tools and expose it through authenticated `tools/list`.

**Architecture:** The server owns a focused `AgentMcpToolRegistryService` that turns existing Zod DTO request schemas into MCP JSON Schema `inputSchema` objects and attaches model-facing metadata plus MCP annotations. `AgentMcpService` remains the JSON-RPC protocol boundary and delegates `tools/list` to the registry; the existing runner-token guarded controller continues to protect every MCP method at `POST /api/agent/internal/mcp/sessions/:id`.

**Tech Stack:** NestJS services/controllers, Vitest, Supertest, Zod v4 `toJSONSchema`, existing `nestjs-zod` DTO classes and `AgentToolName` enum.

---

## Design Source

This plan implements `docs/superpowers/specs/2026-05-16-pi-agent-mcp-server-design.md` section `Slice 2: Server-Owned Tool Registry And tools/list`.

Slice 2 behavior:

- add a server-owned registry for the nine initial tools;
- expose names, titles, descriptions, schemas, and annotations through `tools/list`;
- keep apply/direct mutation tools out of the MCP list.

Slice 2 does not implement `tools/call`, service delegation, runner Pi MCP configuration, compose/provisioning changes, shared-infra wiring, or any apply operation.

The design notes that `outputSchema` is optional but preferred for current discriminated response shapes. This plan intentionally defers `outputSchema` until Slice 3 and Slice 4, where the MCP tool-result wrapper and read/planning service delegation are implemented and tested. Slice 2 treats `inputSchema` as the discoverability schema required for `tools/list`.

## Current Starting Point

Slice 1 already added:

- `server/src/services/agent-mcp.service.ts`
- `server/src/services/agent-mcp.service.spec.ts`
- `server/src/controllers/agent-runner-mcp.controller.ts`
- `server/src/controllers/agent-runner-mcp.controller.spec.ts`
- `server/src/types/agent-mcp.types.ts`

`tools/list` currently returns JSON-RPC `-32601 Method not found`. `initialize` currently returns `capabilities: {}`. This slice changes both behaviors.

## File Map

- Modify `server/src/dtos/agent-tool.dto.ts`
  Export the six existing read-tool request schemas in a stable map keyed by `AgentToolName`.

- Modify `server/src/dtos/agent-operation.dto.ts`
  Export the three existing planning-tool request schemas in a stable map keyed by `AgentToolName`.

- Create `server/src/services/agent-mcp-tool-registry.service.ts`
  Own the MCP registry: names, titles, model-facing descriptions, schema conversion, annotations, defensive copies.

- Create `server/src/services/agent-mcp-tool-registry.service.spec.ts`
  Focused registry tests for exact names, missing apply/direct-write tools, object schemas, annotation hints, DTO schema drift, model-facing descriptions, and defensive copy behavior.

- Modify `server/src/types/agent-mcp.types.ts`
  Add MCP tool/list result types for the registry, then change `initialize` capabilities from an empty-only object to a tools-capable object when `tools/list` is wired.

- Modify `server/src/services/agent-mcp.service.ts`
  Inject the registry, advertise `tools: {}` in initialize, and return the registry from `tools/list`.

- Modify `server/src/services/agent-mcp.service.spec.ts`
  Update initialize expectations, add `tools/list` JSON-RPC tests, keep `tools/call` unsupported.

- Modify `server/src/services/index.ts`
  Register `AgentMcpToolRegistryService` with the server service providers.

- Modify `server/src/controllers/agent-runner-mcp.controller.spec.ts`
  Add one authenticated integration-style controller test with the real MCP service and real registry so `tools/list` is proven to pass through runner-token auth.

## Tool Contract

The exact tool order returned by `tools/list` is:

```ts
[
  AgentToolName.SearchAssets,
  AgentToolName.ReadAssetMetadata,
  AgentToolName.ReadAssetPreviews,
  AgentToolName.ReadAssetOriginals,
  AgentToolName.ListAlbums,
  AgentToolName.ReadAlbum,
  AgentToolName.ProposeAlbumOperations,
  AgentToolName.ReviseProposedOperations,
  AgentToolName.SummarizePlan,
];
```

No MCP result may include an apply/direct mutation tool name such as `applyAlbumOperations`, `createAlbum`, `addAssetsToAlbum`, `updateAlbum`, `deleteAlbum`, or `setAlbumCover`.

Read tool annotations:

```ts
{
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
}
```

Planning tool annotations:

```ts
{
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
}
```

`idempotentHint` is false for all nine tools because Gallery can create or revise persistent tool-call and plan state even when a tool is read-only from the user's gallery-content perspective.

## Test And Edge Coverage

This plan covers:

- exact nine-tool registry order;
- no apply/direct-write tools in the registry;
- every tool has a non-empty title and model-facing description;
- descriptions do not reveal internal routes, bearer-token mechanics, or HTTP endpoint details;
- every `inputSchema` is a JSON object schema;
- every `inputSchema` is generated from the exported DTO schema map using Zod's input side;
- every tool exposes expected read-only, destructive, idempotent, and open-world hints;
- returned registry objects are defensive copies, so one caller cannot mutate the process-owned registry for the next caller;
- `initialize` advertises `{ tools: {} }` once `tools/list` exists;
- `tools/list` preserves string and numeric JSON-RPC ids;
- `tools/call` remains unsupported in Slice 2;
- `tools/list` goes through the existing runner-token controller guard;
- missing, malformed, expired, wrong-signature, and wrong-session bearer token coverage remains in the existing controller/token suites.

## TDD Rules For This Plan

Each task below starts with a failing test. Do not edit production files for a task until its red command fails for the expected reason. After the green command passes, run the task regression command before committing.

### Task 1: Write Failing Registry Tests

**Files:**

- Create: `server/src/services/agent-mcp-tool-registry.service.spec.ts`
- Modify: none

- [ ] **Step 1: Write the failing registry test file**

Create `server/src/services/agent-mcp-tool-registry.service.spec.ts` with this content:

```ts
import { AgentOperationPlanToolRequestSchemas } from 'src/dtos/agent-operation.dto';
import { AgentReadToolRequestSchemas } from 'src/dtos/agent-tool.dto';
import { AgentToolName } from 'src/enum';
import { AgentMcpToolRegistryService } from 'src/services/agent-mcp-tool-registry.service';
import z from 'zod';

const expectedToolNames = [
  AgentToolName.SearchAssets,
  AgentToolName.ReadAssetMetadata,
  AgentToolName.ReadAssetPreviews,
  AgentToolName.ReadAssetOriginals,
  AgentToolName.ListAlbums,
  AgentToolName.ReadAlbum,
  AgentToolName.ProposeAlbumOperations,
  AgentToolName.ReviseProposedOperations,
  AgentToolName.SummarizePlan,
];

const expectedReadToolNames = [
  AgentToolName.SearchAssets,
  AgentToolName.ReadAssetMetadata,
  AgentToolName.ReadAssetPreviews,
  AgentToolName.ReadAssetOriginals,
  AgentToolName.ListAlbums,
  AgentToolName.ReadAlbum,
];

const expectedPlanningToolNames = [
  AgentToolName.ProposeAlbumOperations,
  AgentToolName.ReviseProposedOperations,
  AgentToolName.SummarizePlan,
];

const forbiddenToolNames = [
  'applyAlbumOperations',
  'applyOperations',
  'createAlbum',
  'addAssetsToAlbum',
  'updateAlbum',
  'deleteAlbum',
  'setAlbumCover',
];

const toExpectedInputSchema = (schema: z.ZodType): Record<string, unknown> => {
  const inputSchema = {
    ...(z.toJSONSchema(schema, { target: 'draft-2020-12', io: 'input' }) as Record<string, unknown>),
  };
  delete inputSchema['~standard'];
  return inputSchema;
};

describe(AgentMcpToolRegistryService.name, () => {
  let sut: AgentMcpToolRegistryService;

  beforeEach(() => {
    sut = new AgentMcpToolRegistryService();
  });

  it('returns exactly the initial nine Gallery MCP tools in stable order', () => {
    expect(sut.listTools().map((tool) => tool.name)).toEqual(expectedToolNames);
  });

  it('does not expose apply or direct gallery mutation tools', () => {
    const toolNames = sut.listTools().map((tool) => tool.name);

    for (const forbiddenToolName of forbiddenToolNames) {
      expect(toolNames).not.toContain(forbiddenToolName);
    }
    expect(toolNames.filter((toolName) => /apply/i.test(toolName))).toEqual([]);
  });

  it('publishes model-facing titles and descriptions without internal route details', () => {
    for (const tool of sut.listTools()) {
      expect(tool.title).toEqual(expect.any(String));
      expect(tool.title.trim().length).toBeGreaterThan(0);
      expect(tool.description).toEqual(expect.any(String));
      expect(tool.description.trim().length).toBeGreaterThan(20);
      expect(tool.description).not.toMatch(/\/api|agent\/internal|bearer|token|http|endpoint|route/i);
    }
  });

  it('marks read tools as read-only, non-destructive, non-idempotent, and closed-world', () => {
    const tools = sut.listTools().filter((tool) => expectedReadToolNames.includes(tool.name));

    expect(tools).toHaveLength(expectedReadToolNames.length);
    for (const tool of tools) {
      expect(tool.annotations).toEqual({
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      });
    }
  });

  it('marks planning tools as non-read-only, non-destructive, non-idempotent, and closed-world', () => {
    const tools = sut.listTools().filter((tool) => expectedPlanningToolNames.includes(tool.name));

    expect(tools).toHaveLength(expectedPlanningToolNames.length);
    for (const tool of tools) {
      expect(tool.annotations).toEqual({
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      });
    }
  });

  it('exposes object input schemas for every tool', () => {
    for (const tool of sut.listTools()) {
      expect(tool.inputSchema).toEqual(expect.any(Object));
      expect(tool.inputSchema).toMatchObject({ type: 'object' });
      expect(tool.inputSchema).not.toHaveProperty('~standard');
    }
  });

  it('derives read tool input schemas from the existing read tool DTO schemas', () => {
    const toolsByName = new Map(sut.listTools().map((tool) => [tool.name, tool]));

    for (const toolName of expectedReadToolNames) {
      expect(toolsByName.get(toolName)?.inputSchema).toEqual(
        toExpectedInputSchema(AgentReadToolRequestSchemas[toolName]),
      );
    }
  });

  it('derives planning tool input schemas from the existing planning tool DTO schemas', () => {
    const toolsByName = new Map(sut.listTools().map((tool) => [tool.name, tool]));

    for (const toolName of expectedPlanningToolNames) {
      expect(toolsByName.get(toolName)?.inputSchema).toEqual(
        toExpectedInputSchema(AgentOperationPlanToolRequestSchemas[toolName]),
      );
    }
  });

  it('returns defensive copies of registry metadata', () => {
    const firstList = sut.listTools();
    firstList[0].description = 'mutated description';
    firstList[0].inputSchema.properties = { mutated: true };
    firstList[0].annotations.readOnlyHint = false;

    const secondList = sut.listTools();

    expect(secondList[0].description).not.toBe('mutated description');
    expect(secondList[0].inputSchema.properties).not.toEqual({ mutated: true });
    expect(secondList[0].annotations.readOnlyHint).toBe(true);
  });
});
```

- [ ] **Step 2: Run registry tests to verify they fail**

Run:

```bash
pnpm --dir server test agent-mcp-tool-registry.service.spec.ts
```

Expected: FAIL because `src/services/agent-mcp-tool-registry.service`, `AgentReadToolRequestSchemas`, and `AgentOperationPlanToolRequestSchemas` are not exported yet.

### Task 2: Implement DTO Schema Exports And Registry

**Files:**

- Modify: `server/src/dtos/agent-tool.dto.ts`
- Modify: `server/src/dtos/agent-operation.dto.ts`
- Modify: `server/src/types/agent-mcp.types.ts`
- Create: `server/src/services/agent-mcp-tool-registry.service.ts`

- [ ] **Step 1: Export read-tool request schema map**

In `server/src/dtos/agent-tool.dto.ts`, add this export after `AgentReadAlbumToolRequestSchema` and before response schemas:

```ts
export const AgentReadToolRequestSchemas = {
  [AgentToolName.SearchAssets]: AgentSearchAssetsToolRequestSchema,
  [AgentToolName.ReadAssetMetadata]: AgentReadAssetMetadataToolRequestSchema,
  [AgentToolName.ReadAssetPreviews]: AgentReadAssetPreviewsToolRequestSchema,
  [AgentToolName.ReadAssetOriginals]: AgentReadAssetOriginalsToolRequestSchema,
  [AgentToolName.ListAlbums]: AgentListAlbumsToolRequestSchema,
  [AgentToolName.ReadAlbum]: AgentReadAlbumToolRequestSchema,
} as const;
```

- [ ] **Step 2: Export planning-tool request schema map**

In `server/src/dtos/agent-operation.dto.ts`, add `AgentToolName` to the enum import:

```ts
import {
  AgentOperationApplyStatus,
  AgentOperationPlanStatus,
  AgentOperationRiskLevel,
  AgentOperationStatus,
  AgentOperationTargetKind,
  AgentOperationType,
  AgentToolName,
} from 'src/enum';
```

Then add this export after `AgentOperationPlanSummaryRequestSchema`:

```ts
export const AgentOperationPlanToolRequestSchemas = {
  [AgentToolName.ProposeAlbumOperations]: AgentProposeAlbumOperationsSchema,
  [AgentToolName.ReviseProposedOperations]: AgentReviseAlbumOperationsSchema,
  [AgentToolName.SummarizePlan]: AgentOperationPlanSummaryRequestSchema,
} as const;
```

- [ ] **Step 3: Add MCP registry types**

In `server/src/types/agent-mcp.types.ts`, add this import at the top:

```ts
import type { AgentToolName } from 'src/enum';
```

Add these types after `AgentMcpRequestId`:

```ts
export type AgentMcpJsonObject = Record<string, unknown>;

export type AgentMcpToolAnnotations = {
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
};

export type AgentMcpToolDefinition = {
  name: AgentToolName;
  title: string;
  description: string;
  inputSchema: AgentMcpJsonObject;
  annotations: AgentMcpToolAnnotations;
};

export type AgentMcpToolsListResult = {
  tools: AgentMcpToolDefinition[];
};
```

Keep `AgentMcpInitializeResult.capabilities` as `Record<string, never>` in this task. Task 4 changes it after `tools/list` is wired.

- [ ] **Step 4: Create the registry service**

Create `server/src/services/agent-mcp-tool-registry.service.ts` with this content:

```ts
import { Injectable } from '@nestjs/common';
import { AgentOperationPlanToolRequestSchemas } from 'src/dtos/agent-operation.dto';
import { AgentReadToolRequestSchemas } from 'src/dtos/agent-tool.dto';
import { AgentToolName } from 'src/enum';
import type { AgentMcpToolAnnotations, AgentMcpToolDefinition } from 'src/types/agent-mcp.types';
import z, { type ZodType } from 'zod';

const readToolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
} as const satisfies AgentMcpToolAnnotations;

const planningToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
} as const satisfies AgentMcpToolAnnotations;

type AgentMcpToolDefinitionInput = Omit<AgentMcpToolDefinition, 'inputSchema'> & {
  schema: ZodType;
};

const toInputSchema = (schema: ZodType): Record<string, unknown> => {
  const inputSchema = {
    ...(z.toJSONSchema(schema, { target: 'draft-2020-12', io: 'input' }) as Record<string, unknown>),
  };
  delete inputSchema['~standard'];

  if (inputSchema.type !== 'object') {
    throw new Error('MCP tool inputSchema must be a JSON object schema');
  }

  return inputSchema;
};

const defineTool = ({ schema, ...tool }: AgentMcpToolDefinitionInput): AgentMcpToolDefinition => ({
  ...tool,
  inputSchema: toInputSchema(schema),
});

const cloneTool = (tool: AgentMcpToolDefinition): AgentMcpToolDefinition => structuredClone(tool);

const buildTools = (): AgentMcpToolDefinition[] => [
  defineTool({
    name: AgentToolName.SearchAssets,
    title: 'Search assets',
    description:
      'Search the photo library by date, place, camera metadata, favorites, media type, rating, tags, albums, and result limit.',
    schema: AgentReadToolRequestSchemas[AgentToolName.SearchAssets],
    annotations: readToolAnnotations,
  }),
  defineTool({
    name: AgentToolName.ReadAssetMetadata,
    title: 'Read asset metadata',
    description:
      'Read metadata for selected assets, including timestamps, location labels, camera fields, rating, favorites, visibility, and tags.',
    schema: AgentReadToolRequestSchemas[AgentToolName.ReadAssetMetadata],
    annotations: readToolAnnotations,
  }),
  defineTool({
    name: AgentToolName.ReadAssetPreviews,
    title: 'Read asset previews',
    description: 'Read preview media references for selected assets after Gallery approval when approval is required.',
    schema: AgentReadToolRequestSchemas[AgentToolName.ReadAssetPreviews],
    annotations: readToolAnnotations,
  }),
  defineTool({
    name: AgentToolName.ReadAssetOriginals,
    title: 'Read asset originals',
    description: 'Read original media references for selected assets after Gallery approval when approval is required.',
    schema: AgentReadToolRequestSchemas[AgentToolName.ReadAssetOriginals],
    annotations: readToolAnnotations,
  }),
  defineTool({
    name: AgentToolName.ListAlbums,
    title: 'List albums',
    description: 'List albums visible to the authenticated session user.',
    schema: AgentReadToolRequestSchemas[AgentToolName.ListAlbums],
    annotations: readToolAnnotations,
  }),
  defineTool({
    name: AgentToolName.ReadAlbum,
    title: 'Read album',
    description: 'Read one visible album with its summary fields and asset identifiers.',
    schema: AgentReadToolRequestSchemas[AgentToolName.ReadAlbum],
    annotations: readToolAnnotations,
  }),
  defineTool({
    name: AgentToolName.ProposeAlbumOperations,
    title: 'Propose album operations',
    description: 'Create a proposed album operation plan for user review without applying gallery changes.',
    schema: AgentOperationPlanToolRequestSchemas[AgentToolName.ProposeAlbumOperations],
    annotations: planningToolAnnotations,
  }),
  defineTool({
    name: AgentToolName.ReviseProposedOperations,
    title: 'Revise proposed operations',
    description: 'Create a revised album operation plan from feedback without applying gallery changes.',
    schema: AgentOperationPlanToolRequestSchemas[AgentToolName.ReviseProposedOperations],
    annotations: planningToolAnnotations,
  }),
  defineTool({
    name: AgentToolName.SummarizePlan,
    title: 'Summarize plan',
    description: 'Summarize the current proposed album operation plan for user review.',
    schema: AgentOperationPlanToolRequestSchemas[AgentToolName.SummarizePlan],
    annotations: planningToolAnnotations,
  }),
];

@Injectable()
export class AgentMcpToolRegistryService {
  private readonly tools = buildTools();

  listTools(): AgentMcpToolDefinition[] {
    return this.tools.map(cloneTool);
  }
}
```

- [ ] **Step 5: Run registry tests to verify they pass**

Run:

```bash
pnpm --dir server test agent-mcp-tool-registry.service.spec.ts
```

Expected: PASS.

- [ ] **Step 6: Run focused DTO regressions**

Run:

```bash
pnpm --dir server test agent-tool.dto.spec.ts agent-operation.dto.spec.ts
```

Expected: PASS. Exporting schema maps must not change DTO validation behavior.

- [ ] **Step 7: Commit registry slice**

Run:

```bash
git add server/src/dtos/agent-tool.dto.ts server/src/dtos/agent-operation.dto.ts server/src/types/agent-mcp.types.ts server/src/services/agent-mcp-tool-registry.service.ts server/src/services/agent-mcp-tool-registry.service.spec.ts
git commit -m "feat: add agent mcp tool registry"
```

### Task 3: Write Failing MCP Service And Controller Tests For `tools/list`

**Files:**

- Modify: `server/src/services/agent-mcp.service.spec.ts`
- Modify: `server/src/controllers/agent-runner-mcp.controller.spec.ts`

- [ ] **Step 1: Update MCP service tests for Slice 2 behavior**

In `server/src/services/agent-mcp.service.spec.ts`, add the registry import:

```ts
import { AgentMcpToolRegistryService } from 'src/services/agent-mcp-tool-registry.service';
```

Change the setup to inject the registry:

```ts
let registry: AgentMcpToolRegistryService;
let sut: AgentMcpService;

beforeEach(() => {
  registry = new AgentMcpToolRegistryService();
  sut = new AgentMcpService(registry);
});
```

Rename the first initialize test to:

```ts
  it('returns the MCP initialize result and advertises tools once tools/list exists', () => {
```

In both initialize response expectations, change:

```ts
        capabilities: {},
```

to:

```ts
        capabilities: {
          tools: {},
        },
```

Then replace the current unsupported-method test with these tests:

```ts
it('returns the registered Gallery MCP tools for tools/list', () => {
  const response = sut.handle({
    jsonrpc: '2.0',
    id: 'tools-1',
    method: 'tools/list',
  });

  expect(response).toEqual({
    jsonrpc: '2.0',
    id: 'tools-1',
    result: {
      tools: registry.listTools(),
    },
  });
});

it('preserves numeric JSON-RPC request ids for tools/list', () => {
  expect(
    sut.handle({
      jsonrpc: '2.0',
      id: 9,
      method: 'tools/list',
    }),
  ).toEqual({
    jsonrpc: '2.0',
    id: 9,
    result: {
      tools: registry.listTools(),
    },
  });
});

it.each(['tools/call', 'resources/list'] as const)('returns method-not-found for %s', (method) => {
  expect(
    sut.handle({
      jsonrpc: '2.0',
      id: 7,
      method,
    }),
  ).toEqual({
    jsonrpc: '2.0',
    id: 7,
    error: {
      code: -32_601,
      message: 'Method not found',
      data: { method },
    },
  });
});
```

- [ ] **Step 2: Add a real-service controller test for authenticated `tools/list`**

In `server/src/controllers/agent-runner-mcp.controller.spec.ts`, add:

```ts
import { AgentMcpToolRegistryService } from 'src/services/agent-mcp-tool-registry.service';
```

Then append this `describe` block inside the top-level `describe(AgentRunnerMcpController.name, () => { ... })`, after the existing tests:

```ts
describe('with the real MCP service', () => {
  let realCtx: ControllerContext;

  beforeAll(async () => {
    realCtx = await controllerSetup(AgentRunnerMcpController, [
      AgentRunnerToolGuard,
      { provide: AgentRunnerToolTokenService, useValue: tokenService },
      AgentMcpToolRegistryService,
      AgentMcpService,
    ]);
    return () => realCtx.close();
  });

  beforeEach(() => {
    tokenService.resetAllMocks();
    realCtx.reset();
    tokenService.verify.mockReturnValue({
      sessionId,
      userId,
      expiresAt: new Date('2026-05-16T12:00:00.000Z'),
    });
  });

  it('requires a valid runner token and returns tools/list from the real MCP service', async () => {
    const toolsListRequest = {
      jsonrpc: '2.0',
      id: 'tools-1',
      method: 'tools/list',
    };

    const { status, body } = await request(realCtx.getHttpServer())
      .post(`/agent/internal/mcp/sessions/${sessionId}`)
      .set('Authorization', authorization)
      .send(toolsListRequest);

    expect(status).toBe(200);
    expect(tokenService.verify).toHaveBeenCalledWith(token);
    expect(realCtx.authenticate).not.toHaveBeenCalled();
    expect(body).toMatchObject({
      jsonrpc: '2.0',
      id: 'tools-1',
      result: {
        tools: expect.any(Array),
      },
    });
    expect(body.result.tools.map((tool: { name: string }) => tool.name)).toEqual([
      AgentToolName.SearchAssets,
      AgentToolName.ReadAssetMetadata,
      AgentToolName.ReadAssetPreviews,
      AgentToolName.ReadAssetOriginals,
      AgentToolName.ListAlbums,
      AgentToolName.ReadAlbum,
      AgentToolName.ProposeAlbumOperations,
      AgentToolName.ReviseProposedOperations,
      AgentToolName.SummarizePlan,
    ]);
  });
});
```

Add `AgentToolName` to the controller spec imports:

```ts
import { AgentToolName } from 'src/enum';
```

- [ ] **Step 3: Run service and controller tests to verify they fail**

Run:

```bash
pnpm --dir server test agent-mcp.service.spec.ts agent-runner-mcp.controller.spec.ts
```

Expected: FAIL because `AgentMcpService` does not accept `AgentMcpToolRegistryService`, `initialize` still returns empty capabilities, and `tools/list` still returns `Method not found`.

### Task 4: Implement `tools/list` Protocol Wiring

**Files:**

- Modify: `server/src/types/agent-mcp.types.ts`
- Modify: `server/src/services/agent-mcp.service.ts`
- Modify: `server/src/services/index.ts`

- [ ] **Step 1: Change initialize capabilities type**

In `server/src/types/agent-mcp.types.ts`, replace the existing `AgentMcpInitializeResult` type with:

```ts
export type AgentMcpInitializeResult = {
  protocolVersion: string;
  serverInfo: {
    name: string;
    version: string;
  };
  capabilities: {
    tools: Record<string, never>;
  };
};
```

- [ ] **Step 2: Wire the registry into the MCP service**

In `server/src/services/agent-mcp.service.ts`, add this import:

```ts
import { AgentMcpToolRegistryService } from 'src/services/agent-mcp-tool-registry.service';
```

Change the class start to:

```ts
@Injectable()
export class AgentMcpService {
  constructor(private readonly toolRegistry: AgentMcpToolRegistryService) {}

  handle(request: unknown): AgentMcpHandleResponse {
```

Add `tools/list` handling immediately after the `initialize` branch:

```ts
if (request.method === 'tools/list') {
  return {
    jsonrpc: '2.0',
    id: request.id,
    result: {
      tools: this.toolRegistry.listTools(),
    },
  };
}
```

Change initialize capabilities to:

```ts
      capabilities: {
        tools: {},
      },
```

- [ ] **Step 3: Register the registry provider**

In `server/src/services/index.ts`, add:

```ts
import { AgentMcpToolRegistryService } from 'src/services/agent-mcp-tool-registry.service';
```

Add `AgentMcpToolRegistryService` to the exported `services` provider array.

- [ ] **Step 4: Run focused MCP tests to verify they pass**

Run:

```bash
pnpm --dir server test agent-mcp-tool-registry.service.spec.ts agent-mcp.service.spec.ts agent-runner-mcp.controller.spec.ts
```

Expected: PASS.

- [ ] **Step 5: Run existing focused auth/token regressions**

Run:

```bash
pnpm --dir server test agent-runner-tool-token.service.spec.ts agent-runner-tool.controller.spec.ts agent-session.service.spec.ts
```

Expected: PASS. Slice 2 must not weaken the runner token/session behavior added before MCP.

- [ ] **Step 6: Commit protocol wiring**

Run:

```bash
git add server/src/types/agent-mcp.types.ts server/src/services/agent-mcp.service.ts server/src/services/agent-mcp.service.spec.ts server/src/services/index.ts server/src/controllers/agent-runner-mcp.controller.spec.ts
git commit -m "feat: expose agent mcp tools list"
```

### Task 5: Final Verification And Review

**Files:**

- Verify only

- [ ] **Step 1: Run full Slice 2 focused server suite**

Run:

```bash
pnpm --dir server test agent-mcp-tool-registry.service.spec.ts agent-mcp.service.spec.ts agent-runner-mcp.controller.spec.ts agent-runner-tool-token.service.spec.ts agent-runner-tool.controller.spec.ts agent-session.service.spec.ts agent-tool.dto.spec.ts agent-operation.dto.spec.ts agent-tool.service.spec.ts
```

Expected: PASS.

- [ ] **Step 2: Run TypeScript check**

Run:

```bash
pnpm --dir server check
```

Expected: PASS.

- [ ] **Step 3: Run focused lint**

Run:

```bash
pnpm --dir server exec eslint src/dtos/agent-tool.dto.ts src/dtos/agent-operation.dto.ts src/services/agent-mcp-tool-registry.service.ts src/services/agent-mcp-tool-registry.service.spec.ts src/services/agent-mcp.service.ts src/services/agent-mcp.service.spec.ts src/controllers/agent-runner-mcp.controller.spec.ts src/types/agent-mcp.types.ts --max-warnings 0
```

Expected: PASS.

- [ ] **Step 4: Verify no direct apply/mutation MCP exposure exists**

Run:

```bash
rg -n "applyAlbumOperations|applyOperations|createAlbum|addAssetsToAlbum|updateAlbum|deleteAlbum|setAlbumCover" server/src/services/agent-mcp-tool-registry.service.ts server/src/services/agent-mcp.service.ts server/src/controllers/agent-runner-mcp.controller.ts
```

Expected: no matches.

- [ ] **Step 5: Verify Slice 2 does not add tool-call delegation yet**

Run:

```bash
rg -n "AgentToolService|AgentOperationPlanService|tools/call" server/src/services/agent-mcp-tool-registry.service.ts server/src/services/agent-mcp.service.ts server/src/controllers/agent-runner-mcp.controller.ts
```

Expected: no matches. `tools/call` appears only in tests as an unsupported method.

- [ ] **Step 6: Check whitespace**

Run:

```bash
git diff --check HEAD~2..HEAD
```

Expected: no output.

- [ ] **Step 7: Review final diff**

Run:

```bash
git status --short
git diff --stat HEAD~2..HEAD
git log --oneline --decorate -5
```

Expected: working tree clean after commits, two Slice 2 commits on top of the Slice 1 branch commits.

## Slice 2 Acceptance Checklist

- [ ] `tools/list` requires a valid runner token through the existing controller guard.
- [ ] `tools/list` returns exactly nine tools in the specified order.
- [ ] No apply/direct mutation tool is returned.
- [ ] Each tool has `name`, `title`, `description`, `inputSchema`, and `annotations`.
- [ ] `outputSchema` is explicitly deferred to the read/planning `tools/call` slices, where response wrappers are defined.
- [ ] Each `inputSchema` is a JSON object schema derived from the existing DTO request schema using Zod input conversion.
- [ ] Read tools have `readOnlyHint: true`, `destructiveHint: false`, `idempotentHint: false`, `openWorldHint: false`.
- [ ] Planning tools have `readOnlyHint: false`, `destructiveHint: false`, `idempotentHint: false`, `openWorldHint: false`.
- [ ] Descriptions are model-facing and do not expose internal routes, bearer token behavior, or HTTP endpoint details.
- [ ] `initialize` advertises `capabilities.tools`.
- [ ] `tools/call` remains unsupported with JSON-RPC `-32601`.
- [ ] Existing runner token/session tests remain green.
- [ ] Existing agent tool service tests remain green.

## Notes For Later Slices

Slice 3 should reuse `AgentMcpToolRegistryService` instead of re-declaring tool names or schemas. Slice 3 owns `tools/call` delegation for read tools and should add DTO validation-to-MCP-tool-result conversion. Slice 4 owns planning-tool `tools/call` delegation. Slice 5 owns first-party Pi runner MCP configuration and keeps compatibility with one-click provisioning by accepting an MCP gateway URL instead of hardcoding local network topology.
