# Pi Agent MCP Slice 4 Planning Tool Calls Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add MCP `tools/call` support for Gallery planning tools while preserving the existing operation-plan persistence, audit, websocket, validation, and UI-only apply behavior.

**Architecture:** `AgentMcpService` continues to own JSON-RPC/MCP request validation, tool-result wrapping, and service dispatch for Slice 4, matching the Slice 3 read-tool implementation. Slice 4 adds `AgentOperationPlanService` delegation for the three planning tools, reuses the Slice 3 argument validation and MCP result helpers, and keeps final album mutation out of MCP by not adding or exposing any apply tool. Plan-aware MCP tools carry `planId` in tool arguments, matching the old first-party runner tool contract, while Gallery still passes `planId` to the existing service method separately from the DTO body.

**Tech Stack:** NestJS services/controllers, Vitest, Supertest, Zod v4, existing `AgentOperationPlanService`, existing operation-plan DTO schemas, JSON-RPC 2.0 over the internal runner-token MCP HTTP endpoint.

---

## Design Source

This plan implements `docs/superpowers/specs/2026-05-16-pi-agent-mcp-server-design.md` section `Slice 4: Planning Tool Calls Over MCP`.

Slice 4 behavior:

- delegate MCP `tools/call` for:
  - `proposeAlbumOperations`;
  - `reviseProposedOperations`;
  - `summarizePlan`;
- preserve existing `AgentOperationPlanService` behavior for persisted plans, audit rows, websocket notifications, access validation, current-plan validation, stale-plan rejection, and final apply remaining a Gallery UI action;
- return normal planning service results as MCP tool results with `structuredContent` equal to the service response and text content equal to `JSON.stringify(structuredContent)`;
- return recoverable DTO argument problems as MCP tool results with `isError: true`;
- return redacted JSON-RPC protocol errors for malformed `tools/call` params, unknown tools, and service-thrown planning failures;
- keep apply/direct mutation tools absent from MCP.

Slice 4 does not implement first-party Pi runner MCP configuration, compose/provisioning changes, shared-infra changes, production image packaging, registry-owned service delegate descriptors, or an MCP apply tool. Those remain later slices.

## Delegate Location Decision

The design spec says the MCP registry should eventually own metadata, DTO schemas, and service delegates for each tool. Slice 2 and Slice 3 already established a narrower registry that owns metadata, annotations, and input schemas while `AgentMcpService` owns dispatch. Slice 4 keeps that boundary so planning calls land as a vertical behavior slice without refactoring all read-tool dispatch in the same change.

This is still consistent with the Slice 4 behavior contract because the runner no longer owns Gallery tool names, routes, or schemas, and all delegation remains server-owned. A later registry-refactor slice should move read and planning delegate descriptors into `AgentMcpToolRegistryService` together, with tests proving `AgentMcpService` dispatches through the registry for all nine tools.

## Current Starting Point

Slice 3 already added:

- `AgentMcpService.handle(auth, sessionId, request): Promise<AgentMcpHandleResponse>`;
- `AgentToolService` injection and read-tool `tools/call` dispatch;
- MCP tool result types and helpers:
  - `AgentMcpToolCallResult`;
  - `toolResult()`;
  - `validationErrorResult()`;
  - `argumentErrorResult()`;
- generic top-level `tools/call` param validation;
- argument object validation before DTO schema parsing;
- JSON-RPC `-32602` for malformed params, unknown tools, and planning tools not supported in Slice 3;
- JSON-RPC `-32603 Internal error` for service exceptions without message leakage;
- controller propagation of runner-token auth and route `sessionId` into `AgentMcpService`.

Current planning tool limitation:

- `tools/list` exposes the three planning tools, but `AgentMcpService` returns `Tool not supported in this slice` for them.
- `AgentOperationPlanToolRequestSchemas[AgentToolName.ReviseProposedOperations]` currently derives from the HTTP body DTO and does not include `planId`.
- `AgentOperationPlanToolRequestSchemas[AgentToolName.SummarizePlan]` currently derives from the HTTP body DTO and does not include `planId`.
- The old runner custom tools required `planId` in model arguments for `reviseProposedOperations` and `summarizePlan`, then removed it before posting to the internal path route.

Slice 4 must fix that MCP input contract before enabling planning delegation.

## File Map

- Modify `server/src/dtos/agent-operation.dto.ts`
  Add MCP-specific request schemas for plan-aware planning tools:
  - `reviseProposedOperations`: `{ planId, summary, operations, feedback? }`;
  - `summarizePlan`: `{ planId, focus? }`.
    Keep HTTP DTO classes unchanged.

- Modify `server/src/dtos/agent-operation.dto.spec.ts`
  Add DTO tests proving MCP planning schemas require `planId` for plan-aware tools, reject invalid `planId`, preserve existing operation validation, and keep proposal schema independent of `planId`.

- Modify `server/src/services/agent-mcp-tool-registry.service.spec.ts`
  Add registry tests proving `tools/list` input schemas expose `planId` for `reviseProposedOperations` and `summarizePlan`, do not expose `planId` for `proposeAlbumOperations`, and still do not expose an apply tool.

- Modify `server/src/services/agent-mcp.service.spec.ts`
  Add planning delegation tests, validation tests, service-error redaction tests, and no-apply/no-direct-mutation MCP tests.

- Modify `server/src/services/agent-operation-plan.service.spec.ts`
  Add a characterization test proving `summarizePlan` can summarize an already-applied current plan without reopening apply behavior or mutating albums.

- Modify `server/src/services/agent-mcp.service.ts`
  Inject `AgentOperationPlanService`, replace the Slice 3 unsupported-planning branch with validated delegation, split `planId` from plan-aware tool arguments before calling existing service methods, and keep apply absent.

- Modify `server/src/controllers/agent-runner-mcp.controller.spec.ts`
  Add a real-service controller test proving runner-token auth and route `sessionId` reach `AgentOperationPlanService` through an MCP planning `tools/call`.

## Tool Contract

Slice 4 supports these additional MCP `tools/call` names:

```ts
[AgentToolName.ProposeAlbumOperations, AgentToolName.ReviseProposedOperations, AgentToolName.SummarizePlan];
```

Each supported planning tool delegates to the existing service method:

```ts
{
  [AgentToolName.ProposeAlbumOperations]: AgentOperationPlanService.proposeAlbumOperations,
  [AgentToolName.ReviseProposedOperations]: AgentOperationPlanService.reviseProposedOperations,
  [AgentToolName.SummarizePlan]: AgentOperationPlanService.summarizePlan,
}
```

MCP planning arguments:

```ts
// proposeAlbumOperations
{
  summary: string;
  operations: AgentAlbumOperationInput[];
}

// reviseProposedOperations
{
  planId: string;
  feedback?: string;
  summary: string;
  operations: AgentAlbumOperationInput[];
}

// summarizePlan
{
  planId: string;
  focus?: string;
}
```

Plan-aware service calls split `planId` out of the MCP arguments:

```ts
// reviseProposedOperations
const { planId, ...dto } = parsed.data;
return this.operationPlanService.reviseProposedOperations(auth, sessionId, planId, dto);

// summarizePlan
const { planId, ...dto } = parsed.data;
return this.operationPlanService.summarizePlan(auth, sessionId, planId, dto);
```

Normal service results become MCP tool results:

```ts
{
  content: [{ type: 'text', text: JSON.stringify(result) }],
  structuredContent: result,
}
```

DTO validation results become MCP tool results:

```ts
{
  content: [{ type: 'text', text: JSON.stringify(structuredContent) }],
  structuredContent: {
    status: 'error',
    error: 'Invalid tool arguments',
    issues: [{ path: 'planId', message: 'Invalid UUID' }],
  },
  isError: true,
}
```

JSON-RPC protocol errors:

- malformed `tools/call` `params`: `-32602 Invalid params`;
- unknown tool name: `-32602 Unknown tool`;
- unexpected planning service exception: `-32603 Internal error`;
- stale, missing, unauthorized, or rejected planning service exceptions from `AgentOperationPlanService`: `-32603 Internal error` with no service message leakage.

The existing `AgentOperationPlanService` tests remain responsible for asserting that stale/missing/unauthorized planning failures create the correct denied or failed audit rows before the exception reaches MCP.

## Test And Edge Coverage

This plan covers:

- `tools/list` schema includes `planId` for plan-aware MCP planning tools;
- `tools/list` schema does not require `planId` for `proposeAlbumOperations`;
- DTO schema rejects missing `planId`, invalid `planId`, empty plan summaries, empty operations, too many operations, invalid operation target references, duplicate asset IDs, unknown strict fields, empty summarize focus, and excessive focus text;
- one MCP delegation test for each planning tool;
- exact `auth` and `sessionId` forwarding into `AgentOperationPlanService`;
- exact `planId` forwarding into `reviseProposedOperations` and `summarizePlan`;
- DTO-parsed planning arguments with defaults preserved;
- planning success result mapping with `structuredContent`;
- text `content[0].text` exactly matching `JSON.stringify(structuredContent)`;
- missing `arguments` and non-object `arguments` remain `isError: true` with path `arguments`;
- missing required planning fields as `isError: true`;
- wrong primitive types as `isError: true`;
- invalid UUIDs as `isError: true`;
- strict DTO unknown fields as `isError: true`;
- oversized arrays/text as `isError: true`;
- operation payload validation as `isError: true`;
- service exceptions as redacted JSON-RPC internal errors;
- missing/stale/unauthorized/current-plan failure behavior covered by existing `AgentOperationPlanService` tests and one MCP redaction test for each planning service method;
- already-applied current-plan summary behavior covered by an `AgentOperationPlanService` characterization test;
- controller auth/session propagation for a planning `tools/call`;
- `tools/call` before `initialize` remains accepted because the MCP endpoint is stateless and runner-token scoped;
- existing runner-token failure coverage remains green;
- no apply/direct mutation tool is listed or callable;
- no `applyApprovedOperations` path is imported, delegated, or reachable from MCP.
- registry-owned service delegate descriptors intentionally deferred to a later refactor slice.

## TDD Rules For This Plan

Each behavior bundle starts with failing tests. Do not edit production files for a bundle until its red command fails for the expected reason. After the green command passes, run the task regression command before committing.

### Task 1: Write Failing Planning Schema Tests

**Files:**

- Modify: `server/src/dtos/agent-operation.dto.spec.ts`
- Modify: `server/src/services/agent-mcp-tool-registry.service.spec.ts`

- [ ] **Step 1: Add operation schema imports and helpers**

In `server/src/dtos/agent-operation.dto.spec.ts`, ensure these imports are present:

```ts
import { AgentOperationPlanToolRequestSchemas } from 'src/dtos/agent-operation.dto';
import { AgentToolName } from 'src/enum';
```

Add these helpers near the existing `expectIssue` helper:

```ts
const makeCreateAlbumOperation = () => ({
  type: AgentOperationType.AlbumCreate,
  summary: 'Create Portugal highlights.',
  targetKind: AgentOperationTargetKind.NewAlbum,
  temporaryTargetId: 'tmp-portugal',
  payload: { albumName: 'Portugal highlights', description: '' },
});

const makePlanningToolRequest = () => ({
  summary: 'Create a Portugal highlights album.',
  operations: [makeCreateAlbumOperation()],
});
```

- [ ] **Step 2: Add failing MCP planning schema tests**

Append these tests inside `describe('Agent operation DTOs', ...)`:

```ts
describe('MCP planning tool request schemas', () => {
  it('does not require planId for proposeAlbumOperations', () => {
    const result =
      AgentOperationPlanToolRequestSchemas[AgentToolName.ProposeAlbumOperations].safeParse(makePlanningToolRequest());

    expect(result.success).toBe(true);
  });

  it('requires planId for reviseProposedOperations MCP calls and keeps the body fields', () => {
    const planId = factory.uuid();
    const valid = AgentOperationPlanToolRequestSchemas[AgentToolName.ReviseProposedOperations].safeParse({
      planId,
      feedback: 'Use a shorter title.',
      ...makePlanningToolRequest(),
    });

    expect(valid.success).toBe(true);
    if (valid.success) {
      expect(valid.data).toMatchObject({
        planId,
        feedback: 'Use a shorter title.',
        summary: 'Create a Portugal highlights album.',
        operations: expect.any(Array),
      });
    }

    expectIssue(
      AgentOperationPlanToolRequestSchemas[AgentToolName.ReviseProposedOperations].safeParse(makePlanningToolRequest()),
      ['planId'],
      'Invalid input',
    );
    expectIssue(
      AgentOperationPlanToolRequestSchemas[AgentToolName.ReviseProposedOperations].safeParse({
        planId: 'not-a-uuid',
        ...makePlanningToolRequest(),
      }),
      ['planId'],
      'Invalid UUID',
    );
  });

  it('requires planId for summarizePlan MCP calls and validates focus', () => {
    const planId = factory.uuid();
    const valid = AgentOperationPlanToolRequestSchemas[AgentToolName.SummarizePlan].safeParse({
      planId,
      focus: 'risk',
    });

    expect(valid.success).toBe(true);
    if (valid.success) {
      expect(valid.data).toEqual({ planId, focus: 'risk' });
    }

    expectIssue(
      AgentOperationPlanToolRequestSchemas[AgentToolName.SummarizePlan].safeParse({ focus: 'risk' }),
      ['planId'],
      'Invalid input',
    );
    expectIssue(
      AgentOperationPlanToolRequestSchemas[AgentToolName.SummarizePlan].safeParse({
        planId: 'not-a-uuid',
        focus: 'risk',
      }),
      ['planId'],
      'Invalid UUID',
    );
    expectIssue(
      AgentOperationPlanToolRequestSchemas[AgentToolName.SummarizePlan].safeParse({
        planId,
        focus: '',
      }),
      ['focus'],
      'Too small',
    );
  });

  it('keeps strict object validation for planning MCP tool arguments', () => {
    expectIssue(
      AgentOperationPlanToolRequestSchemas[AgentToolName.ProposeAlbumOperations].safeParse({
        ...makePlanningToolRequest(),
        unexpected: true,
      }),
      [],
      'Unrecognized key',
    );
    expectIssue(
      AgentOperationPlanToolRequestSchemas[AgentToolName.ReviseProposedOperations].safeParse({
        planId: factory.uuid(),
        ...makePlanningToolRequest(),
        unexpected: true,
      }),
      [],
      'Unrecognized key',
    );
    expectIssue(
      AgentOperationPlanToolRequestSchemas[AgentToolName.SummarizePlan].safeParse({
        planId: factory.uuid(),
        focus: 'risk',
        unexpected: true,
      }),
      [],
      'Unrecognized key',
    );
  });
});
```

- [ ] **Step 3: Add failing registry schema tests**

In `server/src/services/agent-mcp-tool-registry.service.spec.ts`, append these tests inside `describe(AgentMcpToolRegistryService.name, ...)`:

```ts
it('exposes planId in plan-aware planning tool input schemas', () => {
  const tools = sut.listTools();
  const revise = tools.find((tool) => tool.name === AgentToolName.ReviseProposedOperations);
  const summarize = tools.find((tool) => tool.name === AgentToolName.SummarizePlan);

  expect(revise?.inputSchema).toMatchObject({
    type: 'object',
    required: expect.arrayContaining(['planId', 'summary', 'operations']),
    properties: expect.objectContaining({
      planId: expect.objectContaining({ type: 'string', format: 'uuid' }),
    }),
  });
  expect(summarize?.inputSchema).toMatchObject({
    type: 'object',
    required: expect.arrayContaining(['planId']),
    properties: expect.objectContaining({
      planId: expect.objectContaining({ type: 'string', format: 'uuid' }),
    }),
  });
});

it('does not require planId for proposal input schema', () => {
  const proposal = sut.listTools().find((tool) => tool.name === AgentToolName.ProposeAlbumOperations);

  expect(proposal?.inputSchema).toMatchObject({
    type: 'object',
    required: expect.not.arrayContaining(['planId']),
    properties: expect.not.objectContaining({
      planId: expect.anything(),
    }),
  });
});
```

- [ ] **Step 4: Run schema tests to verify they fail**

Run:

```bash
pnpm --dir server test agent-operation.dto.spec.ts agent-mcp-tool-registry.service.spec.ts
```

Expected: FAIL because revise and summarize MCP schemas do not include `planId` yet.

### Task 2: Implement Planning MCP Argument Schemas

**Files:**

- Modify: `server/src/dtos/agent-operation.dto.ts`

- [ ] **Step 1: Add plan-aware MCP request schemas**

In `server/src/dtos/agent-operation.dto.ts`, replace the current `AgentOperationPlanToolRequestSchemas` block with:

```ts
const planId = uuid;

const AgentReviseProposedOperationsToolRequestSchema = operationRequest('AgentReviseProposedOperationsToolRequestDto')
  .extend({
    planId,
    feedback: z.string().trim().min(1).max(2000).optional(),
  })
  .meta({ id: 'AgentReviseProposedOperationsToolRequestDto' });

const AgentSummarizePlanToolRequestSchema = AgentOperationPlanSummaryRequestSchema.extend({
  planId,
}).meta({ id: 'AgentSummarizePlanToolRequestDto' });

export const AgentOperationPlanToolRequestSchemas = {
  [AgentToolName.ProposeAlbumOperations]: AgentProposeAlbumOperationsSchema,
  [AgentToolName.ReviseProposedOperations]: AgentReviseProposedOperationsToolRequestSchema,
  [AgentToolName.SummarizePlan]: AgentSummarizePlanToolRequestSchema,
} as const;
```

Keep these DTO classes unchanged:

```ts
export class AgentProposeAlbumOperationsDto extends createZodDto(AgentProposeAlbumOperationsSchema) {}
export class AgentReviseAlbumOperationsDto extends createZodDto(AgentReviseAlbumOperationsSchema) {}
export class AgentOperationPlanSummaryRequestDto extends createZodDto(AgentOperationPlanSummaryRequestSchema) {}
```

The HTTP routes still receive `planId` from the path parameter. Only MCP tool schemas include `planId` in arguments.

- [ ] **Step 2: Run schema tests to verify they pass**

Run:

```bash
pnpm --dir server test agent-operation.dto.spec.ts agent-mcp-tool-registry.service.spec.ts
```

Expected: PASS.

- [ ] **Step 3: Commit planning MCP schemas**

Run:

```bash
git add server/src/dtos/agent-operation.dto.ts server/src/dtos/agent-operation.dto.spec.ts server/src/services/agent-mcp-tool-registry.service.spec.ts
git commit -m "feat: expose mcp planning plan ids"
```

### Task 3: Write Failing MCP Service Tests For Planning Tool Calls And Edge Cases

**Files:**

- Modify: `server/src/services/agent-mcp.service.spec.ts`
- Modify: `server/src/services/agent-operation-plan.service.spec.ts`

- [ ] **Step 1: Add planning service imports and setup**

In `server/src/services/agent-mcp.service.spec.ts`, replace the current `src/enum` import with:

```ts
import { AgentOperationRiskLevel, AgentOperationTargetKind, AgentOperationType, AgentToolName } from 'src/enum';
```

Add the operation-plan service import:

```ts
import { AgentOperationPlanService } from 'src/services/agent-operation-plan.service';
```

Update setup:

```ts
let operationPlanService: AutoMocked<AgentOperationPlanService>;

beforeEach(() => {
  registry = new AgentMcpToolRegistryService();
  toolService = automock(AgentToolService, { strict: false });
  operationPlanService = automock(AgentOperationPlanService, { strict: false });
  sut = new AgentMcpService(registry, toolService, operationPlanService);
});
```

- [ ] **Step 2: Add planning request helpers**

Add these helpers near existing MCP service spec helpers:

```ts
const makeAlbumCreateOperation = () => ({
  type: AgentOperationType.AlbumCreate,
  summary: 'Create Portugal highlights.',
  targetKind: AgentOperationTargetKind.NewAlbum,
  temporaryTargetId: 'tmp-portugal',
  payload: { albumName: 'Portugal highlights' },
});

const makeParsedAlbumCreateOperation = () => ({
  ...makeAlbumCreateOperation(),
  riskLevel: AgentOperationRiskLevel.Low,
  enabled: true,
  payload: { albumName: 'Portugal highlights', description: '' },
});

const makePlanningRequest = () => ({
  summary: 'Create a Portugal highlights album.',
  operations: [makeAlbumCreateOperation()],
});

const makeParsedPlanningRequest = () => ({
  summary: 'Create a Portugal highlights album.',
  operations: [makeParsedAlbumCreateOperation()],
});

const makePlanningServiceResult = (planId = factory.uuid()) => ({
  status: 'success',
  plan: {
    id: planId,
    revision: 1,
    operations: [],
  },
  toolCall: null,
  summary: 'Plan revision 1 is ready for review.',
});
```

- [ ] **Step 3: Add one delegation test per planning tool**

Append these tests after the read-tool tests and before protocol-error tests:

```ts
it.each([
  {
    toolName: AgentToolName.ProposeAlbumOperations,
    args: makePlanningRequest(),
    serviceMethod: 'proposeAlbumOperations' as const,
    expectedArguments: (authValue: AuthDto, sessionIdValue: string) => [
      authValue,
      sessionIdValue,
      makeParsedPlanningRequest(),
    ],
  },
  {
    toolName: AgentToolName.ReviseProposedOperations,
    args: {
      planId: factory.uuid(),
      feedback: 'Use a shorter title.',
      ...makePlanningRequest(),
    },
    serviceMethod: 'reviseProposedOperations' as const,
    expectedArguments: (authValue: AuthDto, sessionIdValue: string, args: Record<string, unknown>) => {
      const { planId } = args;
      return [
        authValue,
        sessionIdValue,
        planId,
        {
          feedback: 'Use a shorter title.',
          ...makeParsedPlanningRequest(),
        },
      ];
    },
  },
  {
    toolName: AgentToolName.SummarizePlan,
    args: {
      planId: factory.uuid(),
      focus: 'risk',
    },
    serviceMethod: 'summarizePlan' as const,
    expectedArguments: (authValue: AuthDto, sessionIdValue: string, args: Record<string, unknown>) => {
      const { planId, ...dto } = args;
      return [authValue, sessionIdValue, planId, dto];
    },
  },
])(
  'delegates planning tool $toolName to AgentOperationPlanService and wraps the result',
  async ({ toolName, args, serviceMethod, expectedArguments }) => {
    const serviceResult = makePlanningServiceResult();
    operationPlanService[serviceMethod].mockResolvedValue(serviceResult as never);

    const response = (await sut.handle(
      auth,
      sessionId,
      makeToolCallRequest(toolName, args),
    )) as AgentMcpSuccessResponse;

    expect(operationPlanService[serviceMethod]).toHaveBeenCalledTimes(1);
    expect(operationPlanService[serviceMethod]).toHaveBeenCalledWith(
      ...expectedArguments(auth, sessionId, args as Record<string, unknown>),
    );
    expectToolResult(response, `${toolName}-call`, serviceResult);
  },
);
```

- [ ] **Step 4: Add planning service error redaction tests**

Append:

```ts
it.each([
  {
    toolName: AgentToolName.ProposeAlbumOperations,
    args: makePlanningRequest(),
    serviceMethod: 'proposeAlbumOperations' as const,
  },
  {
    toolName: AgentToolName.ReviseProposedOperations,
    args: { planId: factory.uuid(), ...makePlanningRequest() },
    serviceMethod: 'reviseProposedOperations' as const,
  },
  {
    toolName: AgentToolName.SummarizePlan,
    args: { planId: factory.uuid(), focus: 'risk' },
    serviceMethod: 'summarizePlan' as const,
  },
])(
  'converts $toolName service failures to redacted JSON-RPC internal errors',
  async ({ toolName, args, serviceMethod }) => {
    operationPlanService[serviceMethod].mockRejectedValue(
      new Error('Agent operation plan not found /srv/gallery/provider-request.json bearer token abc'),
    );

    await expect(sut.handle(auth, sessionId, makeToolCallRequest(toolName, args))).resolves.toEqual({
      jsonrpc: '2.0',
      id: `${toolName}-call`,
      error: {
        code: -32_603,
        message: 'Internal error',
      },
    });
  },
);
```

- [ ] **Step 5: Add no-apply MCP service test**

Append:

```ts
it('does not expose an MCP apply tool call', async () => {
  await expect(
    sut.handle(auth, sessionId, {
      jsonrpc: '2.0',
      id: 'apply-tool',
      method: 'tools/call',
      params: { name: 'applyAlbumOperations', arguments: { planId: factory.uuid(), operationIds: [factory.uuid()] } },
    }),
  ).resolves.toEqual({
    jsonrpc: '2.0',
    id: 'apply-tool',
    error: {
      code: -32_602,
      message: 'Unknown tool',
      data: { toolName: 'applyAlbumOperations' },
    },
  });
  expect(operationPlanService.proposeAlbumOperations).not.toHaveBeenCalled();
  expect(operationPlanService.reviseProposedOperations).not.toHaveBeenCalled();
  expect(operationPlanService.summarizePlan).not.toHaveBeenCalled();
});
```

- [ ] **Step 6: Add malformed planning argument tests**

Append these tests near the existing malformed argument tests:

```ts
describe('planning argument validation', () => {
  const assetId = factory.uuid();

  it.each([
    {
      name: 'planning missing arguments',
      toolName: AgentToolName.ProposeAlbumOperations,
      args: undefined,
      expectedPath: 'arguments',
    },
    {
      name: 'planning array arguments',
      toolName: AgentToolName.ProposeAlbumOperations,
      args: [makeAlbumCreateOperation()],
      expectedPath: 'arguments',
    },
    {
      name: 'proposal wrong primitive summary',
      toolName: AgentToolName.ProposeAlbumOperations,
      args: { summary: 12, operations: [makeAlbumCreateOperation()] },
      expectedPath: 'summary',
    },
    {
      name: 'proposal missing summary',
      toolName: AgentToolName.ProposeAlbumOperations,
      args: { operations: [makeAlbumCreateOperation()] },
      expectedPath: 'summary',
    },
    {
      name: 'proposal empty operations',
      toolName: AgentToolName.ProposeAlbumOperations,
      args: { summary: 'Empty operations.', operations: [] },
      expectedPath: 'operations',
    },
    {
      name: 'proposal too many operations',
      toolName: AgentToolName.ProposeAlbumOperations,
      args: {
        summary: 'Too many operations.',
        operations: Array.from({ length: 501 }, (_, index) => ({
          ...makeAlbumCreateOperation(),
          temporaryTargetId: `tmp-portugal-${index}`,
          payload: { albumName: `Portugal ${index}` },
        })),
      },
      expectedPath: 'operations',
    },
    {
      name: 'proposal duplicate asset ids',
      toolName: AgentToolName.ProposeAlbumOperations,
      args: {
        summary: 'Duplicate assets.',
        operations: [
          {
            type: AgentOperationType.AlbumAddAssets,
            summary: 'Add duplicate assets.',
            targetKind: AgentOperationTargetKind.ExistingAlbum,
            targetId: factory.uuid(),
            assetIds: [assetId, assetId],
          },
        ],
      },
      expectedPath: 'operations.0.assetIds',
    },
    {
      name: 'proposal missing new album temporary target',
      toolName: AgentToolName.ProposeAlbumOperations,
      args: {
        summary: 'Missing temp id.',
        operations: [
          {
            type: AgentOperationType.AlbumCreate,
            summary: 'Create missing temp id.',
            targetKind: AgentOperationTargetKind.NewAlbum,
            payload: { albumName: 'Portugal' },
          },
        ],
      },
      expectedPath: 'operations.0.temporaryTargetId',
    },
    {
      name: 'proposal excessive album name',
      toolName: AgentToolName.ProposeAlbumOperations,
      args: {
        summary: 'Album name too long.',
        operations: [
          {
            ...makeAlbumCreateOperation(),
            payload: { albumName: 'a'.repeat(201) },
          },
        ],
      },
      expectedPath: 'operations.0.payload.albumName',
    },
    {
      name: 'revision missing planId',
      toolName: AgentToolName.ReviseProposedOperations,
      args: makePlanningRequest(),
      expectedPath: 'planId',
    },
    {
      name: 'revision numeric planId',
      toolName: AgentToolName.ReviseProposedOperations,
      args: { planId: 12, ...makePlanningRequest() },
      expectedPath: 'planId',
    },
    {
      name: 'revision invalid planId',
      toolName: AgentToolName.ReviseProposedOperations,
      args: { planId: 'not-a-uuid', ...makePlanningRequest() },
      expectedPath: 'planId',
    },
    {
      name: 'revision excessive feedback',
      toolName: AgentToolName.ReviseProposedOperations,
      args: { planId: factory.uuid(), feedback: 'a'.repeat(2001), ...makePlanningRequest() },
      expectedPath: 'feedback',
    },
    {
      name: 'summary missing planId',
      toolName: AgentToolName.SummarizePlan,
      args: { focus: 'risk' },
      expectedPath: 'planId',
    },
    {
      name: 'summary numeric planId',
      toolName: AgentToolName.SummarizePlan,
      args: { planId: 12, focus: 'risk' },
      expectedPath: 'planId',
    },
    {
      name: 'summary wrong primitive focus',
      toolName: AgentToolName.SummarizePlan,
      args: { planId: factory.uuid(), focus: 12 },
      expectedPath: 'focus',
    },
    {
      name: 'summary invalid focus',
      toolName: AgentToolName.SummarizePlan,
      args: { planId: factory.uuid(), focus: '' },
      expectedPath: 'focus',
    },
    {
      name: 'summary excessive focus',
      toolName: AgentToolName.SummarizePlan,
      args: { planId: factory.uuid(), focus: 'a'.repeat(1001) },
      expectedPath: 'focus',
    },
    {
      name: 'summary unknown strict field',
      toolName: AgentToolName.SummarizePlan,
      args: { planId: factory.uuid(), focus: 'risk', unexpected: true },
      expectedPath: '',
    },
  ])(
    'returns isError tool result for malformed planning arguments: $name',
    async ({ toolName, args, expectedPath }) => {
      const response = (await sut.handle(
        auth,
        sessionId,
        makeToolCallRequest(toolName, args),
      )) as AgentMcpSuccessResponse;

      expectToolValidationError(response, expectedPath);
      expect(operationPlanService.proposeAlbumOperations).not.toHaveBeenCalled();
      expect(operationPlanService.reviseProposedOperations).not.toHaveBeenCalled();
      expect(operationPlanService.summarizePlan).not.toHaveBeenCalled();
    },
  );
});
```

- [ ] **Step 7: Add already-applied summarize characterization coverage**

In `server/src/services/agent-operation-plan.service.spec.ts`, append this test immediately after the existing `summarizes the current plan and writes a completed planning audit row` test:

```ts
it('summarizes an already-applied current plan and writes a completed planning audit row', async () => {
  const auth = AuthFactory.create();
  const session = makeSession({ userId: auth.user.id, status: AgentSessionStatus.Completed });
  const plan = makePlan({ sessionId: session.id, status: AgentOperationPlanStatus.Applied });
  const executingToolCall = makeToolCall({
    sessionId: session.id,
    toolName: AgentToolName.SummarizePlan,
    status: AgentToolCallStatus.Executing,
  });
  const completedToolCall = makeToolCall({ sessionId: session.id, toolName: AgentToolName.SummarizePlan });
  sessionRepository.getById.mockResolvedValue(session);
  planRepository.getByIdForSession.mockResolvedValue(plan);
  planRepository.getCurrentBySessionId.mockResolvedValue(plan);
  toolCallRepository.create.mockResolvedValue(executingToolCall);
  toolCallRepository.transition.mockResolvedValue(completedToolCall);

  const result = await sut.summarizePlan(auth, session.id, plan.id, { focus: 'applied operations' });

  expect(result).toMatchObject({
    status: 'success',
    plan: { id: plan.id, status: AgentOperationPlanStatus.Applied },
    toolCall: { id: completedToolCall.id },
  });
  expect(toolCallRepository.create).toHaveBeenCalledWith(
    expect.objectContaining({
      sessionId: session.id,
      toolName: AgentToolName.SummarizePlan,
      status: AgentToolCallStatus.Executing,
      approvalDecision: AgentToolApprovalDecision.Approved,
      dataClass: AgentToolDataClass.Plan,
      redactedRequestMetadata: { planId: plan.id, operationCount: 0, operationTypes: [], albumIds: [], assetIds: [] },
      redactedResponseMetadata: null,
    }),
  );
  expect(toolCallRepository.transition).toHaveBeenCalledWith(
    session.id,
    executingToolCall.id,
    AgentToolCallStatus.Executing,
    expect.objectContaining({
      status: AgentToolCallStatus.Completed,
      approvalDecision: AgentToolApprovalDecision.Approved,
      redactedResponseMetadata: { planId: plan.id, operationIds: plan.operations.map((operation) => operation.id) },
      error: null,
    }),
  );
});
```

This is a characterization test for behavior that already exists in `AgentOperationPlanService`. It protects the design requirement that `summarizePlan` handles already-applied current plans while Slice 4 routes MCP calls through that service unchanged.

- [ ] **Step 8: Run service tests to verify planning tests fail**

Run:

```bash
pnpm --dir server test agent-mcp.service.spec.ts agent-operation-plan.service.spec.ts
```

Expected: FAIL because `AgentMcpService` does not accept `AgentOperationPlanService`, still returns `Tool not supported in this slice` for planning tools, and validates none of the planning DTO edge cases through MCP.

### Task 4: Implement Planning Tool Delegation

**Files:**

- Modify: `server/src/services/agent-mcp.service.ts`
- Modify: `server/src/services/agent-mcp.service.spec.ts`
- Modify: `server/src/services/agent-operation-plan.service.spec.ts`

- [ ] **Step 1: Inject `AgentOperationPlanService` and operation schemas**

In `server/src/services/agent-mcp.service.ts`, add imports:

```ts
import { AgentOperationPlanToolRequestSchemas } from 'src/dtos/agent-operation.dto';
import { AgentOperationPlanService } from 'src/services/agent-operation-plan.service';
```

Change the constructor:

```ts
  constructor(
    private readonly toolRegistry: AgentMcpToolRegistryService,
    private readonly toolService: AgentToolService,
    private readonly operationPlanService: AgentOperationPlanService,
  ) {}
```

- [ ] **Step 2: Replace unsupported planning branch with planning dispatch**

In `handleToolCall`, replace:

```ts
if (this.planningToolNames.has(name)) {
  return this.error(request.id, -32_602, 'Tool not supported in this slice', { toolName: name });
}

if (!this.isReadToolName(name)) {
  return this.error(request.id, -32_602, 'Unknown tool', { toolName: name });
}
```

with:

```ts
if (this.isPlanningToolName(name)) {
  return this.handlePlanningToolCall(auth, sessionId, request.id, name, args);
}

if (!this.isReadToolName(name)) {
  return this.error(request.id, -32_602, 'Unknown tool', { toolName: name });
}
```

Add this type guard next to `isReadToolName()`:

```ts
  private isPlanningToolName(name: AgentToolName): name is keyof typeof AgentOperationPlanToolRequestSchemas {
    return this.planningToolNames.has(name);
  }
```

- [ ] **Step 3: Add a shared validated invocation helper**

Replace read-only argument parsing in `handleToolCall`:

```ts
const schema = AgentReadToolRequestSchemas[name];
const argumentValidation = this.validateToolArguments(args);
if (!argumentValidation.valid) {
  return this.success(request.id, this.argumentErrorResult(argumentValidation.path, argumentValidation.message));
}

const parseResult = schema.safeParse(argumentValidation.value);
if (!parseResult.success) {
  return this.success(request.id, this.validationErrorResult(parseResult.error));
}

try {
  const result = await this.callReadTool(auth, sessionId, name, parseResult.data);
  return this.success(request.id, this.toolResult(result));
} catch {
  return this.error(request.id, -32_603, 'Internal error');
}
```

with:

```ts
return this.invokeTool(request.id, args, AgentReadToolRequestSchemas[name], (dto) =>
  this.callReadTool(auth, sessionId, name, dto),
);
```

Add this helper before `callReadTool()`:

```ts
  private async invokeTool<TDto>(
    id: AgentMcpRequestId,
    args: unknown,
    schema: z.ZodType<TDto>,
    delegate: (dto: TDto) => Promise<unknown>,
  ): Promise<AgentMcpSuccessResponse | AgentMcpErrorResponse> {
    const argumentValidation = this.validateToolArguments(args);
    if (!argumentValidation.valid) {
      return this.success(id, this.argumentErrorResult(argumentValidation.path, argumentValidation.message));
    }

    const parseResult = schema.safeParse(argumentValidation.value);
    if (!parseResult.success) {
      return this.success(id, this.validationErrorResult(parseResult.error));
    }

    try {
      return this.success(id, this.toolResult(await delegate(parseResult.data)));
    } catch {
      return this.error(id, -32_603, 'Internal error');
    }
  }
```

- [ ] **Step 4: Add planning delegation helper**

Add this method after `invokeTool()`:

```ts
  private async handlePlanningToolCall(
    auth: AuthDto,
    sessionId: string,
    id: AgentMcpRequestId,
    toolName: keyof typeof AgentOperationPlanToolRequestSchemas,
    args: unknown,
  ): Promise<AgentMcpSuccessResponse | AgentMcpErrorResponse> {
    switch (toolName) {
      case AgentToolName.ProposeAlbumOperations: {
        return this.invokeTool(id, args, AgentOperationPlanToolRequestSchemas[toolName], (dto) =>
          this.operationPlanService.proposeAlbumOperations(auth, sessionId, dto),
        );
      }
      case AgentToolName.ReviseProposedOperations: {
        return this.invokeTool(id, args, AgentOperationPlanToolRequestSchemas[toolName], (dto) => {
          const { planId, ...body } = dto;
          return this.operationPlanService.reviseProposedOperations(auth, sessionId, planId, body);
        });
      }
      case AgentToolName.SummarizePlan: {
        return this.invokeTool(id, args, AgentOperationPlanToolRequestSchemas[toolName], (dto) => {
          const { planId, ...body } = dto;
          return this.operationPlanService.summarizePlan(auth, sessionId, planId, body);
        });
      }
    }
  }
```

- [ ] **Step 5: Run service tests to verify they pass**

Run:

```bash
pnpm --dir server test agent-mcp.service.spec.ts agent-operation-plan.service.spec.ts
```

Expected: PASS.

- [ ] **Step 6: Commit planning MCP delegation**

Run:

```bash
git add server/src/services/agent-mcp.service.ts server/src/services/agent-mcp.service.spec.ts server/src/services/agent-operation-plan.service.spec.ts
git commit -m "feat: delegate mcp planning tool calls"
```

### Task 5: Write Failing Controller Coverage For Planning MCP Calls

**Files:**

- Modify: `server/src/controllers/agent-runner-mcp.controller.spec.ts`

- [ ] **Step 1: Add controller planning imports**

In `server/src/controllers/agent-runner-mcp.controller.spec.ts`, replace the current `src/enum` import with:

```ts
import { AgentOperationRiskLevel, AgentOperationTargetKind, AgentOperationType, AgentToolName } from 'src/enum';
```

Add the operation-plan service import:

```ts
import { AgentOperationPlanService } from 'src/services/agent-operation-plan.service';
```

- [ ] **Step 2: Add a real-service planning tools/call test before provider wiring**

Inside `describe('with the real MCP service', ...)`, add the operation-plan mock variable but do not add it to the test module providers yet:

```ts
const realOperationPlanService = automock(AgentOperationPlanService, { strict: false });
```

Append inside `describe('with the real MCP service', ...)`:

```ts
it('passes runner auth and session id through for planning tools/call', async () => {
  const serviceResult = {
    status: 'success',
    plan: { id: factory.uuid(), revision: 1, operations: [] },
    toolCall: null,
    summary: 'Plan revision 1 is ready for review.',
  };
  const body = {
    summary: 'Create Portugal highlights.',
    operations: [
      {
        type: AgentOperationType.AlbumCreate,
        summary: 'Create Portugal highlights.',
        targetKind: AgentOperationTargetKind.NewAlbum,
        temporaryTargetId: 'tmp-portugal',
        riskLevel: AgentOperationRiskLevel.Low,
        enabled: true,
        payload: { albumName: 'Portugal highlights', description: '' },
      },
    ],
  };
  realOperationPlanService.proposeAlbumOperations.mockResolvedValue(serviceResult as never);

  const { status, body: responseBody } = await request(realCtx.getHttpServer())
    .post(`/agent/internal/mcp/sessions/${sessionId}`)
    .set('Authorization', authorization)
    .send({
      jsonrpc: '2.0',
      id: 'planning-call-1',
      method: 'tools/call',
      params: {
        name: AgentToolName.ProposeAlbumOperations,
        arguments: body,
      },
    });

  expect(status).toBe(200);
  expect(tokenService.verify).toHaveBeenCalledWith(token);
  expect(realCtx.authenticate).not.toHaveBeenCalled();
  expect(realOperationPlanService.proposeAlbumOperations).toHaveBeenCalledWith(
    expect.objectContaining({ user: { id: userId } }),
    sessionId,
    body,
  );
  expect(responseBody).toEqual({
    jsonrpc: '2.0',
    id: 'planning-call-1',
    result: {
      content: [{ type: 'text', text: JSON.stringify(serviceResult) }],
      structuredContent: serviceResult,
    },
  });
});
```

- [ ] **Step 3: Run controller tests to verify the new test fails**

Run:

```bash
pnpm --dir server test agent-runner-mcp.controller.spec.ts
```

Expected: FAIL because the real MCP service test module cannot construct `AgentMcpService` with the new `AgentOperationPlanService` dependency, or because the planning call has not reached `AgentOperationPlanService`.

### Task 6: Implement Controller Planning Provider Wiring

**Files:**

- Modify: `server/src/controllers/agent-runner-mcp.controller.spec.ts`

- [ ] **Step 1: Add operation plan service provider to the real-service controller test**

Inside `describe('with the real MCP service', ...)`, add the provider to the real test module setup:

```ts
        { provide: AgentOperationPlanService, useValue: realOperationPlanService },
```

Reset it in `beforeEach()`:

```ts
realOperationPlanService.resetAllMocks();
```

- [ ] **Step 2: Run controller tests to verify they pass**

Run:

```bash
pnpm --dir server test agent-runner-mcp.controller.spec.ts
```

Expected: PASS.

- [ ] **Step 3: Commit controller planning coverage**

Run:

```bash
git add server/src/controllers/agent-runner-mcp.controller.spec.ts
git commit -m "test: cover mcp planning controller auth"
```

### Task 7: Final Verification And Review

**Files:**

- Verify only

- [ ] **Step 1: Run full Slice 4 focused server suite**

Run:

```bash
pnpm --dir server test agent-mcp-tool-registry.service.spec.ts agent-mcp.service.spec.ts agent-runner-mcp.controller.spec.ts agent-runner-tool-token.service.spec.ts agent-runner-tool.controller.spec.ts agent-session.service.spec.ts agent-tool.dto.spec.ts agent-operation.dto.spec.ts agent-tool.service.spec.ts agent-operation-plan.service.spec.ts
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
pnpm --dir server exec eslint src/dtos/agent-operation.dto.ts src/dtos/agent-operation.dto.spec.ts src/dtos/agent-tool.dto.ts src/services/agent-mcp-tool-registry.service.ts src/services/agent-mcp-tool-registry.service.spec.ts src/services/agent-mcp.service.ts src/services/agent-mcp.service.spec.ts src/controllers/agent-runner-mcp.controller.ts src/controllers/agent-runner-mcp.controller.spec.ts src/types/agent-mcp.types.ts --max-warnings 0
```

Expected: PASS.

- [ ] **Step 4: Verify Slice 4 does not expose apply or direct mutation calls**

Run:

```bash
rg -n "applyAlbumOperations|applyOperations|applyApprovedOperations|createAlbum|addAssetsToAlbum|updateAlbum|deleteAlbum|setAlbumCover" server/src/services/agent-mcp-tool-registry.service.ts server/src/services/agent-mcp.service.ts server/src/controllers/agent-runner-mcp.controller.ts
```

Expected: no matches.

- [ ] **Step 5: Verify planning service wiring is limited to MCP service delegation**

Run:

```bash
rg -n "AgentOperationPlanService|proposeAlbumOperations\\(|reviseProposedOperations\\(|summarizePlan\\(|applyApprovedOperations\\(" server/src/services/agent-mcp.service.ts server/src/controllers/agent-runner-mcp.controller.ts server/src/controllers/agent-runner-mcp.controller.spec.ts server/src/services/agent-mcp.service.spec.ts
```

Expected:

- `AgentOperationPlanService` appears only in MCP service constructor/imports and tests;
- `proposeAlbumOperations(`, `reviseProposedOperations(`, and `summarizePlan(` appear in MCP service/tests;
- `applyApprovedOperations(` has no matches.

- [ ] **Step 6: Verify `tools/list` does not expose an apply tool**

Run:

```bash
pnpm --dir server test agent-mcp-tool-registry.service.spec.ts
```

Expected: PASS with existing no-apply registry assertions and new planId schema assertions.

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
git log --oneline --decorate -10
```

Expected: working tree clean after commits, three Slice 4 implementation/test commits on top of the Slice 4 plan commit.

## Slice 4 Acceptance Checklist

- [ ] `tools/list` exposes `planId` in `reviseProposedOperations` and `summarizePlan` input schemas.
- [ ] `tools/list` does not expose or require `planId` for `proposeAlbumOperations`.
- [ ] `AgentMcpService` injects `AgentOperationPlanService`.
- [ ] Planning `tools/call` succeeds without a prior `initialize` call in the same test process.
- [ ] `proposeAlbumOperations` delegates to `AgentOperationPlanService.proposeAlbumOperations`.
- [ ] `reviseProposedOperations` delegates to `AgentOperationPlanService.reviseProposedOperations` with `planId` split from MCP arguments.
- [ ] `summarizePlan` delegates to `AgentOperationPlanService.summarizePlan` with `planId` split from MCP arguments.
- [ ] Delegation passes exact `auth`, `sessionId`, and DTO-parsed planning arguments.
- [ ] Successful planning results use `structuredContent` equal to the service result.
- [ ] Text content equals `JSON.stringify(structuredContent)`.
- [ ] Validation failures return MCP tool results with `isError: true`.
- [ ] DTO validation covers missing fields, wrong primitive types, empty arrays, invalid plan IDs, invalid operation payloads, duplicate asset IDs, excessive limits, excessive text, and unknown strict-object fields.
- [ ] Stale, missing, unauthorized, and already-applied plan cases remain covered by `AgentOperationPlanService` tests.
- [ ] Planning service exceptions return redacted JSON-RPC internal errors from MCP.
- [ ] Controller real-service test proves runner token auth and route session id reach planning service delegation.
- [ ] Existing runner-token failure coverage remains green.
- [ ] Existing operation-plan service tests remain green for persistence, audit rows, websocket events, stale plan handling, access validation, and apply behavior.
- [ ] No apply/direct mutation MCP tool is exposed or callable.
- [ ] `AgentOperationPlanService.applyApprovedOperations` is not imported, referenced, or delegated by MCP service/controller.

## Notes For Later Slices

Slice 5 should replace first-party runner custom Gallery tools with Pi MCP configuration. It should rely on this Slice 4 MCP planning surface instead of `agent-runner/src/gallery-tools.mjs`, keep built-in Pi tools disabled, pass the runner-token MCP gateway URL and Authorization header per session, and preserve one-click provisioning compatibility by accepting a configurable MCP gateway URL rather than assuming tenant-local networking.

A later registry-refactor slice should move service delegate descriptors into `AgentMcpToolRegistryService` for all nine tools in one vertical change. That slice should keep `AgentMcpService` responsible for JSON-RPC validation and result wrapping, but make it resolve tool schemas and delegates through registry definitions instead of hardcoded read/planning dispatch tables.
