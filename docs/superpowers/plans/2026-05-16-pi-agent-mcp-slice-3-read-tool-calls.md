# Pi Agent MCP Slice 3 Read Tool Calls Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add MCP `tools/call` support for the six Gallery read tools while preserving existing read-tool approval, denial, audit, retry, and permission behavior.

**Architecture:** `AgentRunnerMcpController` remains the runner-token guarded HTTP boundary and passes the guard-created `AuthDto` plus the route `sessionId` into `AgentMcpService`. `AgentMcpService` becomes async, validates MCP `tools/call` parameters, validates read-tool arguments with the existing Zod DTO schemas exported in Slice 2, delegates to `AgentToolService`, and wraps normal tool results as MCP tool results with matching `structuredContent` and text `content`.

**Tech Stack:** NestJS controllers/services, Vitest, Supertest, Zod v4, existing `AgentToolService`, existing read-tool DTO schemas, JSON-RPC 2.0 over the internal MCP HTTP endpoint.

---

## Design Source

This plan implements `docs/superpowers/specs/2026-05-16-pi-agent-mcp-server-design.md` section `Slice 3: Read Tool Calls Over MCP`.

Slice 3 behavior:

- implement `tools/call` delegation for read tools only;
- preserve existing approval, denial, audit, retry, and permission-plan behavior by delegating to `AgentToolService`;
- map normal tool results to `structuredContent` and text `content`;
- return recoverable DTO argument problems as MCP tool results with `isError: true`;
- return JSON-RPC protocol errors for malformed `tools/call` params, unknown tool names, unsupported planning tools in this slice, and unexpected service failures.

Slice 3 does not implement planning tool calls, apply operations, Pi runner SDK MCP configuration, compose/provisioning changes, or shared-runner deployment changes. Planning tools remain discoverable from Slice 2 and return a protocol error from `tools/call` until Slice 4 implements them.

## Current Starting Point

Slice 2 already added:

- `AgentMcpToolRegistryService` and `tools/list`;
- DTO schema maps:
  - `AgentReadToolRequestSchemas`;
  - `AgentOperationPlanToolRequestSchemas`;
- `initialize` capability advertising for tools;
- runner-token guarded controller tests for `tools/list`.

Current `AgentMcpService.handle(request)` is synchronous and has no authenticated session context. Slice 3 changes it to `handle(auth, sessionId, request)` returning `Promise<AgentMcpHandleResponse>`.

## File Map

- Modify `server/src/types/agent-mcp.types.ts`
  Add MCP tool-call result types, a typed JSON-RPC result alias, and keep existing JSON-RPC response types.

- Modify `server/src/services/agent-mcp.service.spec.ts`
  Convert tests to `await sut.handle(auth, sessionId, request)`, add read-tool delegation tests, result-wrapper tests, retry tests, validation-error tests, unknown/unsupported tool tests, and internal-error redaction tests.

- Modify `server/src/services/agent-mcp.service.ts`
  Inject `AgentToolService`, make `handle` async, add read-tool `tools/call` dispatch, parse DTO arguments, wrap normal results, and format validation/protocol/internal errors.

- Modify `server/src/controllers/agent-runner-mcp.controller.spec.ts`
  Update existing mocked-service expectations for auth/session context and add real MCP service tests for a `tools/call` read tool through runner-token auth.

- Modify `server/src/controllers/agent-runner-mcp.controller.ts`
  Use `@Auth()` and `@Param()` to pass `AuthDto` and `sessionId` into `AgentMcpService.handle`.

## Tool Contract

Slice 3 supports these MCP `tools/call` names:

```ts
[
  AgentToolName.SearchAssets,
  AgentToolName.ReadAssetMetadata,
  AgentToolName.ReadAssetPreviews,
  AgentToolName.ReadAssetOriginals,
  AgentToolName.ListAlbums,
  AgentToolName.ReadAlbum,
];
```

Each supported tool delegates to the existing service method:

```ts
{
  [AgentToolName.SearchAssets]: AgentToolService.searchAssets,
  [AgentToolName.ReadAssetMetadata]: AgentToolService.readAssetMetadata,
  [AgentToolName.ReadAssetPreviews]: AgentToolService.readAssetPreviews,
  [AgentToolName.ReadAssetOriginals]: AgentToolService.readAssetOriginals,
  [AgentToolName.ListAlbums]: AgentToolService.listAlbums,
  [AgentToolName.ReadAlbum]: AgentToolService.readAlbum,
}
```

Normal service results, including `approval-required`, `denied`, and `success`, become MCP tool results:

```ts
{
  content: [{ type: 'text', text: JSON.stringify(result) }],
  structuredContent: result,
}
```

Validation results become MCP tool results:

```ts
{
  content: [{ type: 'text', text: JSON.stringify(structuredContent) }],
  structuredContent: {
    status: 'error',
    error: 'Invalid tool arguments',
    issues: [{ path: 'assetIds', message: 'Invalid UUID' }],
  },
  isError: true,
}
```

JSON-RPC protocol errors:

- malformed `tools/call` `params`: `-32602 Invalid params`;
- unknown tool name: `-32602 Unknown tool`;
- planning tool called before Slice 4: `-32602 Tool not supported in this slice`;
- unexpected service exception: `-32603 Internal error`.

Unexpected service exception responses must not include stack traces, bearer tokens, provider credentials, provider request bodies, or filesystem paths.

## Test And Edge Coverage

This plan covers:

- one delegation test for each read tool;
- exact `auth` and `sessionId` forwarding into `AgentToolService`;
- DTO-parsed arguments, including transformed `searchAssets` defaults;
- success result mapping with `structuredContent`;
- text `content[0].text` exactly matching `JSON.stringify(structuredContent)`;
- `approval-required` result mapping as a normal tool result;
- `denied` result mapping as a normal tool result;
- retry with `toolCallId` passed through unchanged;
- `missing arguments` as `isError: true`;
- `arguments` not an object as `isError: true`;
- strict DTO unknown fields as `isError: true`;
- missing required read-tool fields as `isError: true`;
- wrong primitive types as `isError: true`;
- empty asset arrays as `isError: true`;
- invalid asset ID and invalid album ID as `isError: true`;
- excessive search limit as `isError: true`;
- unknown MCP tool name as JSON-RPC protocol error;
- planning tool call before Slice 4 as JSON-RPC protocol error and no `AgentOperationPlanService` dependency;
- service exceptions as redacted JSON-RPC internal errors;
- controller auth/session propagation for `tools/call`;
- `tools/call` before `initialize` remains accepted because the MCP endpoint is stateless and runner-token scoped;
- existing runner-token failure coverage remains green;
- service-rejected retry `toolCallId` values as redacted JSON-RPC internal errors;
- existing `AgentToolService` tests continue to cover approval retries, access drift, stale approvals, audit records, permission-plan limits, and ownership changes.

## TDD Rules For This Plan

Each behavior bundle starts with failing tests. Do not edit production files for a bundle until its red command fails for the expected reason. After the green command passes, run the task regression command before committing.

### Task 1: Write Failing MCP Service Tests For Read Tool Calls

**Files:**

- Modify: `server/src/services/agent-mcp.service.spec.ts`

- [ ] **Step 1: Add imports and test setup for read-tool calls**

In `server/src/services/agent-mcp.service.spec.ts`, add these imports:

```ts
import type { AuthDto } from 'src/dtos/auth.dto';
import { AgentToolName } from 'src/enum';
import { AgentToolService } from 'src/services/agent-tool.service';
import type { AgentMcpSuccessResponse, AgentMcpToolCallResult } from 'src/types/agent-mcp.types';
import { factory } from 'test/small.factory';
import { automock, type AutoMocked } from 'test/utils';
```

Update the setup:

```ts
let registry: AgentMcpToolRegistryService;
let toolService: AutoMocked<AgentToolService>;
let sut: AgentMcpService;

const sessionId = factory.uuid();
const userId = factory.uuid();
const auth = { user: { id: userId } } as AuthDto;

beforeEach(() => {
  registry = new AgentMcpToolRegistryService();
  toolService = automock(AgentToolService, { strict: false });
  sut = new AgentMcpService(registry, toolService);
});
```

Change every existing `sut.handle(request)` assertion in this spec to `await sut.handle(auth, sessionId, request)` and mark the containing tests `async`. For the initialized notification test, use:

```ts
await expect(
  sut.handle(auth, sessionId, {
    jsonrpc: '2.0',
    method: 'notifications/initialized',
  }),
).resolves.toBeUndefined();
```

Update the existing unsupported-method parameterized test to remove `tools/call`; after Slice 3 it should continue to check only truly unsupported methods such as `resources/list`. Malformed `tools/call` params coverage is added in Task 3.

- [ ] **Step 2: Add read-tool delegation and success wrapper tests**

Append these tests after the existing `tools/list` tests:

```ts
const makeToolCallRequest = (toolName: AgentToolName, args: unknown) => ({
  jsonrpc: '2.0',
  id: `${toolName}-call`,
  method: 'tools/call',
  params: {
    name: toolName,
    arguments: args,
  },
});

const expectToolResult = (response: AgentMcpSuccessResponse, structuredContent: unknown) => {
  const result = response.result as AgentMcpToolCallResult;

  expect(result).toEqual({
    content: [{ type: 'text', text: JSON.stringify(structuredContent) }],
    structuredContent,
  });
};

it.each([
  {
    toolName: AgentToolName.SearchAssets,
    args: { filters: { isFavorite: true }, limit: 5 },
    serviceMethod: 'searchAssets' as const,
    serviceResult: { status: 'success', toolCall: null, assets: [], nextPage: null },
  },
  {
    toolName: AgentToolName.ReadAssetMetadata,
    args: { assetIds: [factory.uuid()] },
    serviceMethod: 'readAssetMetadata' as const,
    serviceResult: { status: 'success', toolCall: null, assets: [] },
  },
  {
    toolName: AgentToolName.ReadAssetPreviews,
    args: { assetIds: [factory.uuid()] },
    serviceMethod: 'readAssetPreviews' as const,
    serviceResult: { status: 'success', toolCall: null, previews: [] },
  },
  {
    toolName: AgentToolName.ReadAssetOriginals,
    args: { assetIds: [factory.uuid()] },
    serviceMethod: 'readAssetOriginals' as const,
    serviceResult: { status: 'success', toolCall: null, originals: [] },
  },
  {
    toolName: AgentToolName.ListAlbums,
    args: {},
    serviceMethod: 'listAlbums' as const,
    serviceResult: { status: 'success', toolCall: null, albums: [] },
  },
  {
    toolName: AgentToolName.ReadAlbum,
    args: { albumId: factory.uuid() },
    serviceMethod: 'readAlbum' as const,
    serviceResult: { status: 'success', toolCall: null, album: { id: factory.uuid(), assetIds: [] } },
  },
])(
  'delegates $toolName to AgentToolService and wraps the result',
  async ({ toolName, args, serviceMethod, serviceResult }) => {
    toolService[serviceMethod].mockResolvedValue(serviceResult as never);

    const response = (await sut.handle(
      auth,
      sessionId,
      makeToolCallRequest(toolName, args),
    )) as AgentMcpSuccessResponse;

    expect(toolService[serviceMethod]).toHaveBeenCalledTimes(1);
    expect(toolService[serviceMethod]).toHaveBeenCalledWith(auth, sessionId, args);
    expectToolResult(response, serviceResult);
  },
);

it('delegates DTO-transformed search defaults instead of raw search arguments', async () => {
  const serviceResult = { status: 'success', toolCall: null, assets: [], nextPage: null };
  toolService.searchAssets.mockResolvedValue(serviceResult as never);

  const response = (await sut.handle(
    auth,
    sessionId,
    makeToolCallRequest(AgentToolName.SearchAssets, {}),
  )) as AgentMcpSuccessResponse;

  expect(toolService.searchAssets).toHaveBeenCalledWith(auth, sessionId, { filters: {}, limit: 10_000 });
  expectToolResult(response, serviceResult);
});
```

- [ ] **Step 3: Add approval, denial, and retry result tests**

Append:

```ts
it('returns approval-required read responses as normal MCP tool results', async () => {
  const serviceResult = {
    status: 'approval-required',
    toolCall: { id: factory.uuid(), status: 'pending-approval' },
  };
  toolService.readAssetPreviews.mockResolvedValue(serviceResult as never);

  const response = (await sut.handle(
    auth,
    sessionId,
    makeToolCallRequest(AgentToolName.ReadAssetPreviews, { assetIds: [factory.uuid()] }),
  )) as AgentMcpSuccessResponse;

  expectToolResult(response, serviceResult);
  expect((response.result as AgentMcpToolCallResult).isError).toBeUndefined();
});

it('returns denied read responses as normal MCP tool results', async () => {
  const serviceResult = {
    status: 'denied',
    reason: 'User denied access',
    toolCall: { id: factory.uuid(), status: 'completed' },
  };
  toolService.readAssetOriginals.mockResolvedValue(serviceResult as never);

  const response = (await sut.handle(
    auth,
    sessionId,
    makeToolCallRequest(AgentToolName.ReadAssetOriginals, { assetIds: [factory.uuid()] }),
  )) as AgentMcpSuccessResponse;

  expectToolResult(response, serviceResult);
  expect((response.result as AgentMcpToolCallResult).isError).toBeUndefined();
});

it('passes retry toolCallId arguments through to the read service', async () => {
  const toolCallId = factory.uuid();
  const serviceResult = { status: 'success', toolCall: { id: toolCallId }, previews: [] };
  toolService.readAssetPreviews.mockResolvedValue(serviceResult as never);

  const response = (await sut.handle(
    auth,
    sessionId,
    makeToolCallRequest(AgentToolName.ReadAssetPreviews, { toolCallId }),
  )) as AgentMcpSuccessResponse;

  expect(toolService.readAssetPreviews).toHaveBeenCalledWith(auth, sessionId, { toolCallId });
  expectToolResult(response, serviceResult);
});
```

- [ ] **Step 4: Run service tests to verify they fail**

Run:

```bash
pnpm --dir server test agent-mcp.service.spec.ts
```

Expected: FAIL because `AgentMcpService` does not accept `auth`, `sessionId`, or `AgentToolService`, and `tools/call` still returns `Method not found`.

### Task 2: Implement Read Tool Delegation And MCP Result Wrapping

**Files:**

- Modify: `server/src/types/agent-mcp.types.ts`
- Modify: `server/src/services/agent-mcp.service.ts`

- [ ] **Step 1: Add MCP tool-result types**

In `server/src/types/agent-mcp.types.ts`, add these types after `AgentMcpToolsListResult`:

```ts
export type AgentMcpToolTextContent = {
  type: 'text';
  text: string;
};

export type AgentMcpToolCallResult = {
  content: AgentMcpToolTextContent[];
  structuredContent?: unknown;
  isError?: boolean;
};
```

- [ ] **Step 2: Update `AgentMcpService` constructor and method signature**

In `server/src/services/agent-mcp.service.ts`, add imports:

```ts
import type { AuthDto } from 'src/dtos/auth.dto';
import { AgentReadToolRequestSchemas } from 'src/dtos/agent-tool.dto';
import { AgentToolName } from 'src/enum';
import { AgentToolService } from 'src/services/agent-tool.service';
import type { AgentMcpSuccessResponse, AgentMcpToolCallResult } from 'src/types/agent-mcp.types';
import type { ZodIssue, ZodType } from 'zod';
```

Change the constructor and `handle` signature:

```ts
  constructor(
    private readonly toolRegistry: AgentMcpToolRegistryService,
    private readonly agentToolService: AgentToolService,
  ) {}

  async handle(auth: AuthDto, sessionId: string, request: unknown): Promise<AgentMcpHandleResponse> {
```

- [ ] **Step 3: Add `tools/call` branch and read-tool dispatcher**

Add this branch after the `tools/list` branch:

```ts
if (request.method === 'tools/call') {
  return this.handleToolCall(auth, sessionId, request.id, request.params);
}
```

Change `AgentMcpRequest` to include params:

```ts
type AgentMcpRequest = {
  jsonrpc: '2.0';
  id: AgentMcpRequestId;
  method: string;
  params?: unknown;
};
```

Add these methods before `initializeResult()`:

```ts
  private async handleToolCall(
    auth: AuthDto,
    sessionId: string,
    id: AgentMcpRequestId,
    params: unknown,
  ): Promise<AgentMcpHandleResponse> {
    if (!this.isToolCallParams(params)) {
      return this.error(id, -32_602, 'Invalid params');
    }

    switch (params.name) {
      case AgentToolName.SearchAssets:
        return this.invokeReadTool(id, params.arguments, AgentReadToolRequestSchemas[params.name], (dto) =>
          this.agentToolService.searchAssets(auth, sessionId, dto),
        );
      case AgentToolName.ReadAssetMetadata:
        return this.invokeReadTool(id, params.arguments, AgentReadToolRequestSchemas[params.name], (dto) =>
          this.agentToolService.readAssetMetadata(auth, sessionId, dto),
        );
      case AgentToolName.ReadAssetPreviews:
        return this.invokeReadTool(id, params.arguments, AgentReadToolRequestSchemas[params.name], (dto) =>
          this.agentToolService.readAssetPreviews(auth, sessionId, dto),
        );
      case AgentToolName.ReadAssetOriginals:
        return this.invokeReadTool(id, params.arguments, AgentReadToolRequestSchemas[params.name], (dto) =>
          this.agentToolService.readAssetOriginals(auth, sessionId, dto),
        );
      case AgentToolName.ListAlbums:
        return this.invokeReadTool(id, params.arguments, AgentReadToolRequestSchemas[params.name], (dto) =>
          this.agentToolService.listAlbums(auth, sessionId, dto),
        );
      case AgentToolName.ReadAlbum:
        return this.invokeReadTool(id, params.arguments, AgentReadToolRequestSchemas[params.name], (dto) =>
          this.agentToolService.readAlbum(auth, sessionId, dto),
        );
      case AgentToolName.ProposeAlbumOperations:
      case AgentToolName.ReviseProposedOperations:
      case AgentToolName.SummarizePlan:
        return this.error(id, -32_602, 'Tool not supported in this slice', { toolName: params.name });
      default:
        return this.error(id, -32_602, 'Unknown tool', { toolName: params.name });
    }
  }

  private async invokeReadTool<TDto>(
    id: AgentMcpRequestId,
    args: unknown,
    schema: ZodType<TDto>,
    delegate: (dto: TDto) => Promise<unknown>,
  ): Promise<AgentMcpHandleResponse> {
    const parsed = schema.safeParse(args);
    if (!parsed.success) {
      return this.success(id, this.validationErrorResult(parsed.error.issues));
    }

    try {
      return this.success(id, this.toolResult(await delegate(parsed.data)));
    } catch {
      return this.error(id, -32_603, 'Internal error');
    }
  }

  private isToolCallParams(params: unknown): params is { name: string; arguments?: unknown } {
    if (!params || typeof params !== 'object') {
      return false;
    }

    const { name } = params as Record<string, unknown>;
    return typeof name === 'string';
  }

  private toolResult(structuredContent: unknown): AgentMcpToolCallResult {
    return {
      content: [{ type: 'text', text: JSON.stringify(structuredContent) }],
      structuredContent,
    };
  }

  private validationErrorResult(issues: ZodIssue[]): AgentMcpToolCallResult {
    const structuredContent = {
      status: 'error',
      error: 'Invalid tool arguments',
      issues: issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    };

    return {
      content: [{ type: 'text', text: JSON.stringify(structuredContent) }],
      structuredContent,
      isError: true,
    };
  }
```

- [ ] **Step 4: Add success helper**

Add this helper near `error()`:

```ts
  private success(id: AgentMcpRequestId, result: unknown): AgentMcpSuccessResponse {
    return {
      jsonrpc: '2.0',
      id,
      result,
    };
  }
```

Replace the inline initialize and tools/list success response objects with `this.success(request.id, ...)`:

```ts
return this.success(request.id, this.initializeResult());
```

```ts
return this.success(request.id, {
  tools: this.toolRegistry.listTools(),
});
```

- [ ] **Step 5: Run service tests to verify the valid read-tool path passes**

Run:

```bash
pnpm --dir server test agent-mcp.service.spec.ts
```

Expected: PASS for initialize, `tools/list`, and valid read-tool call tests added in Task 1.

- [ ] **Step 6: Commit read-tool delegation**

Run:

```bash
git add server/src/types/agent-mcp.types.ts server/src/services/agent-mcp.service.ts server/src/services/agent-mcp.service.spec.ts
git commit -m "feat: delegate mcp read tool calls"
```

### Task 3: Add Failing Edge-Case Tests For Validation And Protocol Errors

**Files:**

- Modify: `server/src/services/agent-mcp.service.spec.ts`

- [ ] **Step 1: Add validation-result assertion helper**

In `server/src/services/agent-mcp.service.spec.ts`, add:

```ts
const expectToolValidationError = (response: AgentMcpSuccessResponse, path: string) => {
  const result = response.result as AgentMcpToolCallResult;

  expect(result.isError).toBe(true);
  expect(result.structuredContent).toMatchObject({
    status: 'error',
    error: 'Invalid tool arguments',
    issues: expect.arrayContaining([expect.objectContaining({ path })]),
  });
  expect(result.content).toEqual([{ type: 'text', text: JSON.stringify(result.structuredContent) }]);
};
```

- [ ] **Step 2: Add malformed-argument tests**

Append:

```ts
it.each([
  {
    name: 'missing arguments',
    args: undefined,
    expectedPath: 'arguments',
  },
  {
    name: 'arguments array',
    args: [factory.uuid()],
    expectedPath: 'arguments',
  },
  {
    name: 'unknown strict DTO field',
    args: { filters: {}, unexpected: true },
    expectedPath: '',
  },
  {
    name: 'missing metadata assetIds or toolCallId',
    args: {},
    expectedPath: '',
    toolName: AgentToolName.ReadAssetMetadata,
  },
  {
    name: 'empty asset id array',
    args: { assetIds: [] },
    expectedPath: 'assetIds',
    toolName: AgentToolName.ReadAssetMetadata,
  },
  {
    name: 'invalid asset id',
    args: { assetIds: ['not-a-uuid'] },
    expectedPath: 'assetIds.0',
    toolName: AgentToolName.ReadAssetMetadata,
  },
  {
    name: 'invalid album id',
    args: { albumId: 'not-a-uuid' },
    expectedPath: 'albumId',
    toolName: AgentToolName.ReadAlbum,
  },
  {
    name: 'wrong primitive search limit',
    args: { limit: 'ten' },
    expectedPath: 'limit',
    toolName: AgentToolName.SearchAssets,
  },
  {
    name: 'excessive search limit',
    args: { limit: 10_001 },
    expectedPath: 'limit',
    toolName: AgentToolName.SearchAssets,
  },
])('returns isError tool result for malformed arguments: $name', async ({ args, expectedPath, toolName }) => {
  const response = (await sut.handle(
    auth,
    sessionId,
    makeToolCallRequest(toolName ?? AgentToolName.SearchAssets, args),
  )) as AgentMcpSuccessResponse;

  expectToolValidationError(response, expectedPath);
  expect(toolService.searchAssets).not.toHaveBeenCalled();
  expect(toolService.readAssetMetadata).not.toHaveBeenCalled();
  expect(toolService.readAlbum).not.toHaveBeenCalled();
});
```

- [ ] **Step 3: Add protocol-error and internal-error tests**

Append:

```ts
it.each([
  ['missing params', undefined],
  ['params is not object', 'bad-params'],
  ['missing name', { arguments: {} }],
  ['non-string name', { name: 12, arguments: {} }],
] as const)('returns invalid params for tools/call when %s', async (_name, params) => {
  await expect(
    sut.handle(auth, sessionId, {
      jsonrpc: '2.0',
      id: 'bad-call',
      method: 'tools/call',
      params,
    }),
  ).resolves.toEqual({
    jsonrpc: '2.0',
    id: 'bad-call',
    error: {
      code: -32_602,
      message: 'Invalid params',
    },
  });
});

it('returns a protocol error for an unknown tool name', async () => {
  await expect(
    sut.handle(auth, sessionId, {
      jsonrpc: '2.0',
      id: 'unknown-tool',
      method: 'tools/call',
      params: { name: 'deleteEverything', arguments: {} },
    }),
  ).resolves.toEqual({
    jsonrpc: '2.0',
    id: 'unknown-tool',
    error: {
      code: -32_602,
      message: 'Unknown tool',
      data: { toolName: 'deleteEverything' },
    },
  });
});

it('returns a protocol error for planning tools until slice 4', async () => {
  await expect(
    sut.handle(auth, sessionId, {
      jsonrpc: '2.0',
      id: 'planning-tool',
      method: 'tools/call',
      params: { name: AgentToolName.ProposeAlbumOperations, arguments: { summary: 'Plan', operations: [] } },
    }),
  ).resolves.toEqual({
    jsonrpc: '2.0',
    id: 'planning-tool',
    error: {
      code: -32_602,
      message: 'Tool not supported in this slice',
      data: { toolName: AgentToolName.ProposeAlbumOperations },
    },
  });
});

it('converts unexpected service failures to redacted JSON-RPC internal errors', async () => {
  toolService.readAssetMetadata.mockRejectedValue(
    new Error('secret bearer token abc /srv/gallery/provider-request.json stacktrace'),
  );

  await expect(
    sut.handle(auth, sessionId, makeToolCallRequest(AgentToolName.ReadAssetMetadata, { assetIds: [factory.uuid()] })),
  ).resolves.toEqual({
    jsonrpc: '2.0',
    id: `${AgentToolName.ReadAssetMetadata}-call`,
    error: {
      code: -32_603,
      message: 'Internal error',
    },
  });
});

it('converts rejected retry toolCallId failures to redacted JSON-RPC internal errors', async () => {
  const toolCallId = factory.uuid();
  toolService.readAssetMetadata.mockRejectedValue(new Error('Agent tool call not found for another session'));

  await expect(
    sut.handle(auth, sessionId, makeToolCallRequest(AgentToolName.ReadAssetMetadata, { toolCallId })),
  ).resolves.toEqual({
    jsonrpc: '2.0',
    id: `${AgentToolName.ReadAssetMetadata}-call`,
    error: {
      code: -32_603,
      message: 'Internal error',
    },
  });
  expect(toolService.readAssetMetadata).toHaveBeenCalledWith(auth, sessionId, { toolCallId });
});
```

- [ ] **Step 4: Run service tests to verify edge tests fail**

Run:

```bash
pnpm --dir server test agent-mcp.service.spec.ts
```

Expected: FAIL because missing and non-object `arguments` still surface generic DTO validation paths instead of the `arguments` path.

### Task 4: Implement Validation And Protocol Error Handling

**Files:**

- Modify: `server/src/services/agent-mcp.service.ts`

- [ ] **Step 1: Add argument validation before schema parsing**

In `invokeReadTool`, replace the direct `schema.safeParse(args)` call with:

```ts
const argumentValidation = this.validateToolArguments(args);
if (!argumentValidation.valid) {
  return this.success(id, this.argumentErrorResult(argumentValidation.path, argumentValidation.message));
}

const parsed = schema.safeParse(argumentValidation.value);
```

Add this helper:

```ts
  private validateToolArguments(
    args: unknown,
  ): { valid: true; value: Record<string, unknown> } | { valid: false; path: string; message: string } {
    if (args === undefined) {
      return { valid: false, path: 'arguments', message: 'arguments is required' };
    }

    if (!args || typeof args !== 'object' || Array.isArray(args)) {
      return { valid: false, path: 'arguments', message: 'arguments must be an object' };
    }

    return { valid: true, value: args as Record<string, unknown> };
  }
```

- [ ] **Step 2: Add argument-error formatter**

`validationErrorResult()` already exists from Task 2. Add this helper next to it:

```ts
  private argumentErrorResult(path: string, message: string): AgentMcpToolCallResult {
    return this.validationErrorResult([{ path: [path], message } as ZodIssue]);
  }
```

- [ ] **Step 3: Ensure service exceptions are redacted**

Keep the `catch` block in `invokeReadTool` as:

```ts
    } catch {
      return this.error(id, -32_603, 'Internal error');
    }
```

Do not include exception messages in the JSON-RPC response.

- [ ] **Step 4: Run service tests to verify all service behavior passes**

Run:

```bash
pnpm --dir server test agent-mcp.service.spec.ts
```

Expected: PASS.

- [ ] **Step 5: Commit validation and protocol errors**

Run:

```bash
git add server/src/services/agent-mcp.service.ts server/src/services/agent-mcp.service.spec.ts
git commit -m "feat: validate mcp read tool calls"
```

### Task 5: Add Controller Auth Context Tests And Wiring

**Files:**

- Modify: `server/src/controllers/agent-runner-mcp.controller.spec.ts`
- Modify: `server/src/controllers/agent-runner-mcp.controller.ts`
- Modify: `server/src/services/agent-mcp.service.spec.ts`

- [ ] **Step 1: Write failing controller tests for MCP service context**

In `server/src/controllers/agent-runner-mcp.controller.spec.ts`, update the mocked-service setup:

```ts
service.handle.mockResolvedValue(initializeResponse);
```

Update existing mocked-service expectations from:

```ts
expect(service.handle).toHaveBeenCalledWith(initializeRequest);
```

to:

```ts
expect(service.handle).toHaveBeenCalledWith(
  expect.objectContaining({ user: { id: userId } }),
  sessionId,
  initializeRequest,
);
```

Update the repeated-request expectations:

```ts
expect(service.handle).toHaveBeenNthCalledWith(
  1,
  expect.objectContaining({ user: { id: userId } }),
  sessionId,
  initializeRequest,
);
expect(service.handle).toHaveBeenNthCalledWith(
  2,
  expect.objectContaining({ user: { id: userId } }),
  sessionId,
  secondRequest,
);
```

For notification test setup, use:

```ts
service.handle.mockResolvedValue(undefined);
```

Update the notification expectation to:

```ts
expect(service.handle).toHaveBeenCalledWith(expect.objectContaining({ user: { id: userId } }), sessionId, notification);
```

- [ ] **Step 2: Add real-service controller test for read `tools/call`**

In `server/src/controllers/agent-runner-mcp.controller.spec.ts`, add:

```ts
import { AgentToolService } from 'src/services/agent-tool.service';
```

Inside `describe('with the real MCP service', ...)`, add:

```ts
const realToolService = automock(AgentToolService, { strict: false });
```

Add `AgentToolService` to the real controller setup:

```ts
        { provide: AgentToolService, useValue: realToolService },
```

Reset it in the nested `beforeEach`:

```ts
realToolService.resetAllMocks();
```

Append this test:

```ts
it('passes runner auth and session id through for read tools/call', async () => {
  const assetId = factory.uuid();
  const serviceResult = { status: 'success', toolCall: null, assets: [], nextPage: null };
  realToolService.searchAssets.mockResolvedValue(serviceResult as never);

  const { status, body } = await request(realCtx.getHttpServer())
    .post(`/agent/internal/mcp/sessions/${sessionId}`)
    .set('Authorization', authorization)
    .send({
      jsonrpc: '2.0',
      id: 'call-1',
      method: 'tools/call',
      params: {
        name: AgentToolName.SearchAssets,
        arguments: { filters: { tagIds: [assetId] }, limit: 10 },
      },
    });

  expect(status).toBe(200);
  expect(tokenService.verify).toHaveBeenCalledWith(token);
  expect(realCtx.authenticate).not.toHaveBeenCalled();
  expect(realToolService.searchAssets).toHaveBeenCalledWith(
    expect.objectContaining({ user: { id: userId } }),
    sessionId,
    { filters: { tagIds: [assetId] }, limit: 10 },
  );
  expect(body).toEqual({
    jsonrpc: '2.0',
    id: 'call-1',
    result: {
      content: [{ type: 'text', text: JSON.stringify(serviceResult) }],
      structuredContent: serviceResult,
    },
  });
});
```

- [ ] **Step 3: Run controller tests to verify they fail**

Run:

```bash
pnpm --dir server test agent-runner-mcp.controller.spec.ts
```

Expected: FAIL because the controller still calls `service.handle(body)` and does not inject `@Auth()` or `@Param()`.

- [ ] **Step 4: Update the MCP controller**

In `server/src/controllers/agent-runner-mcp.controller.ts`, update imports:

```ts
import { Body, Controller, HttpCode, HttpStatus, Param, Post, Res, UseGuards } from '@nestjs/common';
import { AuthDto } from 'src/dtos/auth.dto';
import { Auth } from 'src/middleware/auth.guard';
import { UUIDParamDto } from 'src/validation';
```

Change the handler:

```ts
  async handle(
    @Auth() auth: AuthDto,
    @Param() { id }: UUIDParamDto,
    @Body() body: unknown,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AgentMcpHandleResponse> {
    const result = await this.service.handle(auth, id, body);
    if (result === undefined) {
      response.status(HttpStatus.ACCEPTED);
    }

    return result;
  }
```

- [ ] **Step 5: Run controller and service tests to verify they pass**

Run:

```bash
pnpm --dir server test agent-mcp.service.spec.ts agent-runner-mcp.controller.spec.ts
```

Expected: PASS.

- [ ] **Step 6: Run focused auth/token regressions**

Run:

```bash
pnpm --dir server test agent-runner-tool-token.service.spec.ts agent-runner-tool.controller.spec.ts agent-session.service.spec.ts
```

Expected: PASS.

- [ ] **Step 7: Commit controller wiring**

Run:

```bash
git add server/src/controllers/agent-runner-mcp.controller.ts server/src/controllers/agent-runner-mcp.controller.spec.ts server/src/services/agent-mcp.service.spec.ts
git commit -m "feat: pass mcp auth context to read tools"
```

### Task 6: Final Verification And Review

**Files:**

- Verify only

- [ ] **Step 1: Run full Slice 3 focused server suite**

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
pnpm --dir server exec eslint src/dtos/agent-tool.dto.ts src/services/agent-mcp-tool-registry.service.ts src/services/agent-mcp-tool-registry.service.spec.ts src/services/agent-mcp.service.ts src/services/agent-mcp.service.spec.ts src/controllers/agent-runner-mcp.controller.ts src/controllers/agent-runner-mcp.controller.spec.ts src/types/agent-mcp.types.ts --max-warnings 0
```

Expected: PASS.

- [ ] **Step 4: Verify Slice 3 does not expose apply or direct mutation calls**

Run:

```bash
rg -n "applyAlbumOperations|applyOperations|createAlbum|addAssetsToAlbum|updateAlbum|deleteAlbum|setAlbumCover" server/src/services/agent-mcp-tool-registry.service.ts server/src/services/agent-mcp.service.ts server/src/controllers/agent-runner-mcp.controller.ts
```

Expected: no matches.

- [ ] **Step 5: Verify Slice 3 does not wire planning service yet**

Run:

```bash
rg -n "AgentOperationPlanService|proposeAlbumOperations\\(|reviseProposedOperations\\(|summarizePlan\\(" server/src/services/agent-mcp.service.ts server/src/controllers/agent-runner-mcp.controller.ts
```

Expected: no matches. Planning tool names may appear only as enum names for unsupported-tool protocol errors.

- [ ] **Step 6: Verify read-tool delegation is the only new domain service dependency**

Run:

```bash
rg -n "AgentToolService|tools/call|AgentOperationPlanService" server/src/services/agent-mcp.service.ts server/src/controllers/agent-runner-mcp.controller.ts server/src/controllers/agent-runner-mcp.controller.spec.ts server/src/services/agent-mcp.service.spec.ts
```

Expected: `AgentToolService` and `tools/call` matches are present; `AgentOperationPlanService` has no matches.

- [ ] **Step 7: Check whitespace**

Run:

```bash
git diff --check HEAD~3..HEAD
```

Expected: no output.

- [ ] **Step 8: Review final diff**

Run:

```bash
git status --short
git diff --stat HEAD~3..HEAD
git log --oneline --decorate -8
```

Expected: working tree clean after commits, three Slice 3 implementation commits on top of Slice 2.

## Slice 3 Acceptance Checklist

- [ ] `tools/call` requires a valid runner token through the existing controller guard.
- [ ] Controller passes `AuthDto` and route `sessionId` to `AgentMcpService`.
- [ ] `AgentMcpService.handle` is async and all tests await it.
- [ ] A read `tools/call` succeeds without a prior `initialize` call in the same test process.
- [ ] Each read MCP tool delegates to the matching `AgentToolService` method.
- [ ] Delegation passes exact `auth`, `sessionId`, and DTO-parsed arguments.
- [ ] `searchAssets` default DTO transform is preserved when MCP arguments are `{}`.
- [ ] Successful read-tool results use `structuredContent` equal to the service result.
- [ ] Text content equals `JSON.stringify(structuredContent)`.
- [ ] `approval-required` and `denied` stay normal MCP tool results without `isError`.
- [ ] Validation failures return MCP tool results with `isError: true`.
- [ ] DTO validation covers missing fields, wrong primitive types, empty arrays, invalid asset IDs, invalid album IDs, excessive limits, and unknown strict-object fields.
- [ ] Unknown tools return JSON-RPC protocol errors.
- [ ] Planning tool calls return a JSON-RPC protocol error until Slice 4.
- [ ] Service exceptions return redacted JSON-RPC internal errors.
- [ ] Rejected retry `toolCallId` failures return redacted JSON-RPC internal errors.
- [ ] Existing `AgentToolService` tests remain green for approval, retry, audit, permission-plan limits, and access drift.
- [ ] No apply/direct mutation tool is exposed or callable.
- [ ] `AgentOperationPlanService` is not imported by MCP controller or service in Slice 3.

## Notes For Later Slices

Slice 4 should reuse the MCP result wrapper and JSON-RPC error helpers added here, then add planning tool dispatch with `AgentOperationPlanService`. Slice 4 should remove the unsupported-planning protocol error for `proposeAlbumOperations`, `reviseProposedOperations`, and `summarizePlan`, replacing it with validated delegation and focused planning tests.
