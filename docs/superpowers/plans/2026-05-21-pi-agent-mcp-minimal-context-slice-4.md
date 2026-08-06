# Pi Agent MCP Minimal Context Slice 4 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add MCP read-tool response size telemetry and per-tool budget guards so Pi sees compact, truncation-aware tool results before a model context overflow.

**Architecture:** Introduce a shared `AgentToolResultSize` object that is returned on every successful read-tool response, persisted in `agent_tool_call.redactedResponseMetadata`, and projected onto `AgentToolCallResponseDto` for UI activity/details. The service decorates read-tool results after permissions and repository filtering have completed, truncates only allowed result payloads when estimated JSON bytes exceed a conservative budget, and preserves stable result ordering.

**Tech Stack:** NestJS service layer, Kysely repository tests, Zod DTOs via `nestjs-zod`, generated TypeScript SDK/OpenAPI, Svelte 5 activity/detail UI, Vitest unit/integration tests.

---

## Scope

Slice 4 implements only:

- shared response-size metadata;
- persisted compact telemetry in existing `redactedResponseMetadata`;
- a per-tool response budget guard for `searchAssets` and `readAssetMetadata`;
- UI technical-detail rows that surface size/truncation information in activity and tool-call details.

Slice 4 does not implement:

- runner transcript compaction from Slice 5;
- prompt/example changes from Slice 6;
- server-side selection handles from Slice 7;
- model-context bucket calculations beyond per-result byte estimates.

## Decisions

- `estimatedBytes` is an estimated UTF-8 byte count of the JSON response payload after redaction/truncation. It is nullable because estimation can fail for unexpected non-serializable values.
- `resultSize` is required on read-tool success responses and optional on `AgentToolCallResponseDto`.
- Approval-required and denied read-tool calls store an empty result-size record:

```ts
{
  returnedItems: 0,
  hasMore: false,
  nextPage: null,
  estimatedBytes: null,
  truncated: false,
  omittedFields: [],
}
```

This avoids pretending a payload exists while still making the absence of a result explicit in the UI and audit response.

- The response budget is checked after permission checks, search filtering, stable sorting, paging, and metadata hydration. Budget truncation can remove returned rows or nested field groups, but it must never add hidden inaccessible items or bypass denials.
- `searchAssets` truncation preserves the original returned order and trims `assetIds`, `sample`, or `assets` from the end of the page. Top-level search paging fields keep repository paging semantics; `resultSize.truncated` and `resultSize.omittedFields` explain budget truncation.
- `readAssetMetadata` truncation preserves requested ID order and trims from the end of `assets`. If a single row is still too large, it omits the heavy row payload and reports `omittedFields: ['assets']`.
- The global initial budget constant is `64_000` bytes. Tests override it by spying on `getReadToolResponseBudgetBytes()` rather than changing production configuration.

## Files

- Modify: `server/src/types/agent-tool.types.ts`
  - Add `AgentToolResultSize`.
  - Add `resultSize?: AgentToolResultSize` to `AgentToolResponseIdsMetadata`.
- Modify: `server/src/dtos/agent-tool.dto.ts`
  - Add `AgentToolResultSizeSchema`.
  - Add optional `resultSize` to `AgentToolCallResponseSchema`.
  - Add required `resultSize` to every read-tool success response schema.
- Modify: `server/src/dtos/agent-tool.dto.spec.ts`
  - Add result-size DTO tests for success, pending, denied, nullable estimates, invalid negative fields, exact budget metadata, and search/metadata responses.
- Modify: `server/src/repositories/agent-tool-call.repository.ts`
  - Preserve provided `redactedResponseMetadata` when `transitionWithSessionLimit()` denies a claimed execution because of session limits.
- Create: `server/src/repositories/agent-tool-call.repository.spec.ts`
  - Add a focused mocked-Kysely repository test that proves limit-denied transitions keep compact response metadata.
- Modify: `server/src/services/agent-tool.service.ts`
  - Decorate read-tool results with `resultSize`.
  - Persist `resultSize` in response metadata.
  - Add budget truncation helpers for `searchAssets` and `readAssetMetadata`.
  - Preserve pending/denied empty result-size metadata where no result payload exists.
  - Map persisted `resultSize` onto `AgentToolCallResponseDto`.
- Modify: `server/src/services/agent-tool.service.spec.ts`
  - Add service tests for persisted size metadata, truncation, permission safety, stable ordering, nullable estimates, exact budget, one-over-budget, approval-required, and denied calls.
- Modify: `server/src/services/agent-runner-flow.integration.spec.ts`
  - Add integration coverage that a large MCP read result is truncated with `omittedFields` and does not leak inaccessible assets.
- Modify: `server/src/controllers/agent-tool.controller.spec.ts`
  - Update expected tool-call DTO shape where exact assertions include `resultSize`.
- Modify: `open-api/immich-openapi-specs.json`
  - Regenerate after DTO changes.
- Modify: `open-api/typescript-sdk/src/fetch-client.ts`
  - Regenerate after DTO changes so web code can access `toolCall.resultSize`.
- Modify: `open-api/typescript-sdk/build/fetch-client.d.ts`
  - Regenerate by building the SDK after TypeScript SDK generation.
- Modify: `web/src/routes/(user)/assistant/agent-activity-ui.ts`
  - Include result-size technical details in activity rows.
- Modify: `web/src/routes/(user)/assistant/agent-activity-ui.spec.ts`
  - Test technical rows for response size, truncation, omitted fields, and redaction safety.
- Modify: `web/src/routes/(user)/assistant/agent-activity-block.spec.ts`
  - Test expanded technical details render the result-size rows.
- Modify: `web/src/routes/(user)/assistant/agent-session-chat-panel.svelte`
  - Show response-size rows in expanded inline tool-call details.
- Modify: `web/src/routes/(user)/assistant/agent-session-chat-panel.spec.ts`
  - Test inline completed tool-call details show response size and truncation state.
- Modify: `web/src/routes/(user)/assistant/agent-tool-approval-card.svelte`
  - Show "No result yet" or result-size metadata in approval-card details when present.
- Modify: `web/src/routes/(user)/assistant/agent-tool-approval-card.spec.ts`
  - Test approval-required cards show useful size metadata only after details are expanded.

## Contract

```ts
type AgentToolResultSize = {
  returnedItems: number;
  hasMore: boolean;
  nextPage: string | null;
  estimatedBytes: number | null;
  truncated: boolean;
  omittedFields: string[];
};
```

Read success responses include:

```ts
{
  status: 'success',
  toolCall: AgentToolCallResponseDto,
  resultSize: AgentToolResultSize,
  // existing tool-specific fields...
}
```

Tool-call list responses include optional persisted telemetry:

```ts
{
  id: string,
  status: AgentToolCallStatus,
  requestSummary: string,
  responseSummary: string | null,
  resultSize?: AgentToolResultSize,
}
```

Response metadata stores only IDs plus compact telemetry:

```ts
{
  assetIds?: string[],
  albumIds?: string[],
  spaceIds?: string[],
  userIds?: string[],
  resultSize?: AgentToolResultSize,
}
```

## Task 1: Add DTO And Type Coverage

**Files:**

- Modify: `server/src/types/agent-tool.types.ts`
- Modify: `server/src/dtos/agent-tool.dto.ts`
- Modify: `server/src/dtos/agent-tool.dto.spec.ts`

- [ ] **Step 1: Write failing DTO tests for `AgentToolResultSize`**

In `server/src/dtos/agent-tool.dto.spec.ts`, inside `describe(AgentToolCallResponseDto.name, ...)`, add:

```ts
it('serializes optional result-size telemetry on tool calls', () => {
  const result = AgentToolCallResponseDto.schema.safeEncode(
    makeToolCall({
      resultSize: {
        returnedItems: 2,
        hasMore: true,
        nextPage: '2',
        estimatedBytes: 1536,
        truncated: true,
        omittedFields: ['assets'],
      },
    }),
  );

  expect(result.success).toBe(true);
  if (result.success) {
    expect(result.data.resultSize).toEqual({
      returnedItems: 2,
      hasMore: true,
      nextPage: '2',
      estimatedBytes: 1536,
      truncated: true,
      omittedFields: ['assets'],
    });
  }
});

it('accepts unavailable result-size estimates', () => {
  const result = AgentToolCallResponseDto.schema.safeEncode(
    makeToolCall({
      resultSize: {
        returnedItems: 0,
        hasMore: false,
        nextPage: null,
        estimatedBytes: null,
        truncated: false,
        omittedFields: [],
      },
    }),
  );

  expect(result.success).toBe(true);
  if (result.success) {
    expect(result.data.resultSize?.estimatedBytes).toBeNull();
  }
});

it('rejects invalid negative result-size values', () => {
  const result = AgentToolCallResponseDto.schema.safeParse({
    ...makeEncodedToolCall(),
    resultSize: {
      returnedItems: -1,
      hasMore: false,
      nextPage: null,
      estimatedBytes: -5,
      truncated: false,
      omittedFields: [],
    },
  });

  expectIssue(result, ['resultSize', 'returnedItems'], 'Too small');
  expectIssue(result, ['resultSize', 'estimatedBytes'], 'Too small');
});
```

Update the local `makeToolCall()` helper type by letting `overrides` include the future optional `resultSize`.

- [ ] **Step 2: Write failing response DTO tests for success responses**

Update the existing search and metadata success response tests so every success fixture includes a `resultSize`.

For compact search:

```ts
        resultSize: {
          returnedItems: 1,
          hasMore: false,
          nextPage: null,
          estimatedBytes: 512,
          truncated: false,
          omittedFields: [],
        },
```

For field-selected metadata:

```ts
        resultSize: {
          returnedItems: 1,
          hasMore: false,
          nextPage: null,
          estimatedBytes: 768,
          truncated: false,
          omittedFields: [],
        },
```

Then add a search-specific truncation DTO test in `describe('expanded agent tool response DTOs', ...)`:

```ts
it('encodes and parses truncated search responses with omitted fields', () => {
  const assetId = factory.uuid();
  const encoded = AgentSearchAssetsToolResponseDto.schema.safeEncode({
    status: 'success',
    toolCall: makeToolCall({ toolName: AgentToolName.SearchAssets }),
    summary: 'Returned 1 asset id; response was truncated by budget',
    detail: 'ids',
    assetIds: [assetId],
    returnedCount: 1,
    hasMore: false,
    nextPage: null,
    resultSize: {
      returnedItems: 1,
      hasMore: true,
      nextPage: null,
      estimatedBytes: 64000,
      truncated: true,
      omittedFields: ['assetIds'],
    },
  });

  expect(encoded.success).toBe(true);
  if (!encoded.success || encoded.data.status !== 'success') {
    return;
  }

  expect(encoded.data.resultSize.truncated).toBe(true);
  expect(encoded.data.resultSize.omittedFields).toEqual(['assetIds']);
  expect(AgentSearchAssetsToolResponseDto.schema.safeParse(encoded.data).success).toBe(true);
});
```

- [ ] **Step 3: Write failing response DTO tests for pending and denied tool calls**

In `describe(AgentReadAssetMetadataToolResponseDto.name, ...)`, update approval-required and denied fixtures so the embedded tool call includes empty telemetry:

```ts
        toolCall: makeToolCall({
          status: AgentToolCallStatus.PendingApproval,
          completedAt: null,
          resultSize: {
            returnedItems: 0,
            hasMore: false,
            nextPage: null,
            estimatedBytes: null,
            truncated: false,
            omittedFields: [],
          },
        }),
```

Assert:

```ts
expect(result.data.toolCall.resultSize).toEqual({
  returnedItems: 0,
  hasMore: false,
  nextPage: null,
  estimatedBytes: null,
  truncated: false,
  omittedFields: [],
});
```

- [ ] **Step 4: Run DTO tests and verify they fail**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/dtos/agent-tool.dto.spec.ts
```

Expected: fails because `resultSize` is not in the DTO schemas and success responses do not require it.

- [ ] **Step 5: Implement DTO/type schemas**

In `server/src/types/agent-tool.types.ts`, add:

```ts
export type AgentToolResultSize = {
  returnedItems: number;
  hasMore: boolean;
  nextPage: string | null;
  estimatedBytes: number | null;
  truncated: boolean;
  omittedFields: string[];
};
```

Update `AgentToolResponseIdsMetadata`:

```ts
export type AgentToolResponseIdsMetadata = {
  assetIds?: string[];
  albumIds?: string[];
  spaceIds?: string[];
  userIds?: string[];
  resultSize?: AgentToolResultSize;
};
```

In `server/src/dtos/agent-tool.dto.ts`, add near the other shared schemas:

```ts
const AgentToolResultSizeSchema = z
  .object({
    returnedItems: z.number().int().min(0),
    hasMore: z.boolean(),
    nextPage: z.string().nullable(),
    estimatedBytes: z.number().int().min(0).nullable(),
    truncated: z.boolean(),
    omittedFields: z.array(z.string().trim().min(1)).max(50),
  })
  .meta({ id: 'AgentToolResultSize' });
```

Add to `AgentToolCallResponseSchema`:

```ts
    resultSize: AgentToolResultSizeSchema.optional(),
```

Add `resultSize: AgentToolResultSizeSchema` to every read-tool success response object:

- `AgentReadAssetMetadataToolSuccessResponseSchema`
- `AgentSearchAssetsToolSuccessResponseSchema`
- resolve filters success
- previews success
- originals success
- list/read albums success
- list/read spaces success
- search users success

- [ ] **Step 6: Run DTO tests and verify they pass**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/dtos/agent-tool.dto.spec.ts
```

Expected: pass.

## Task 2: Add Service And Repository Telemetry Tests

**Files:**

- Modify: `server/src/repositories/agent-tool-call.repository.spec.ts`
- Modify: `server/src/services/agent-tool.service.spec.ts`

- [ ] **Step 1: Add repository test for preserving metadata on session-limit denial**

Create `server/src/repositories/agent-tool-call.repository.spec.ts` with a minimal mocked Kysely transaction that captures the update payload. The test does not need a real database because the regression is specifically that `transitionWithSessionLimit()` overwrites the metadata passed to `.set(...)`.

```ts
import {
  AgentProviderType,
  AgentToolApprovalDecision,
  AgentToolCallStatus,
  AgentToolDataClass,
  AgentToolName,
} from 'src/enum';
import { AgentToolCallRepository } from 'src/repositories/agent-tool-call.repository';

const uuid = (suffix: string) => `00000000-0000-4000-8000-${suffix.padStart(12, '0')}`;

describe(AgentToolCallRepository.name, () => {
  it('preserves response metadata when transitionWithSessionLimit denies a claimed tool call', async () => {
    const sessionId = uuid('1');
    const toolCallId = uuid('2');
    const responseMetadata = {
      resultSize: {
        returnedItems: 0,
        hasMore: false,
        nextPage: null,
        estimatedBytes: null,
        truncated: false,
        omittedFields: [],
      },
    };

    let capturedUpdate: Record<string, unknown> | undefined;
    const toolCall = {
      id: toolCallId,
      sessionId,
      toolName: AgentToolName.ReadAssetMetadata,
      status: AgentToolCallStatus.Denied,
      approvalDecision: AgentToolApprovalDecision.Denied,
      requestSummary: 'Read metadata',
      responseSummary: null,
      redactedRequestMetadata: { assetIds: [uuid('3')] },
      redactedResponseMetadata: responseMetadata,
      dataClass: AgentToolDataClass.Metadata,
      assetCount: 0,
      albumCount: 0,
      providerSnapshot: {
        providerCredentialId: null,
        providerType: AgentProviderType.OpenAI,
        label: 'OpenAI',
        baseUrl: null,
        model: 'gpt-5.1',
      },
      startedAt: new Date('2026-05-21T09:00:00.000Z'),
      completedAt: new Date('2026-05-21T10:00:00.000Z'),
      error: 'Session policy allows at most 1 assets per session',
    };

    const selectSessionChain = {
      select: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      forUpdate: vi.fn().mockReturnThis(),
      executeTakeFirstOrThrow: vi.fn().mockResolvedValue({ id: sessionId }),
    };
    const selectCountChain = {
      select: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      executeTakeFirstOrThrow: vi.fn().mockResolvedValue({ assetCount: 1 }),
    };
    const updateChain = {
      set: vi.fn((update: Record<string, unknown>) => {
        capturedUpdate = update;
        return updateChain;
      }),
      where: vi.fn().mockReturnThis(),
      returning: vi.fn().mockReturnThis(),
      executeTakeFirst: vi.fn().mockResolvedValue(toolCall),
    };
    const trx = {
      selectFrom: vi.fn((table: string) => (table === 'agent_session' ? selectSessionChain : selectCountChain)),
      updateTable: vi.fn(() => updateChain),
    };
    const db = {
      transaction: vi.fn(() => ({
        execute: vi.fn((callback) => callback(trx)),
      })),
    };
    const sut = new AgentToolCallRepository(db as never);

    const result = await sut.transitionWithSessionLimit(
      sessionId,
      toolCallId,
      AgentToolCallStatus.Executing,
      {
        status: AgentToolCallStatus.Completed,
        approvalDecision: AgentToolApprovalDecision.Approved,
        responseSummary: 'Would have returned metadata',
        redactedResponseMetadata: responseMetadata,
        assetCount: 2,
        albumCount: 0,
        completedAt: new Date('2026-05-21T10:00:00.000Z'),
        error: null,
      },
      AgentToolDataClass.Metadata,
      1,
    );

    expect(result.status).toBe('limit-exceeded');
    expect(capturedUpdate).toEqual(
      expect.objectContaining({
        status: AgentToolCallStatus.Denied,
        approvalDecision: AgentToolApprovalDecision.Denied,
        redactedResponseMetadata: responseMetadata,
      }),
    );
  });
});
```

Keep the production repository import; do not test the in-memory runner-flow fake here.

The core assertion is:

```ts
expect(capturedUpdate?.redactedResponseMetadata).toEqual(responseMetadata);
```

- [ ] **Step 2: Add service test for successful persisted result-size metadata**

In `server/src/services/agent-tool.service.spec.ts`, add near the existing compact metadata success tests:

```ts
it('returns and persists result-size telemetry for metadata reads', async () => {
  const assetId = newUuid();
  const session = makeSession({ approvalMode: AgentApprovalMode.PlanOnly });
  sessionRepository.getById.mockResolvedValue(session);
  accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set([assetId]));
  assetRepository.getAgentReadableIds.mockResolvedValue(new Set([assetId]));
  assetRepository.getAgentMetadataByIds.mockResolvedValue([makeAssetMetadata({ id: assetId })]);
  toolCallRepository.create.mockResolvedValue(
    makeToolCall({ id: 'tool-call-1', status: AgentToolCallStatus.Executing }),
  );
  toolCallRepository.transition.mockImplementation(async (_sessionId, _id, _expected, update) =>
    makeToolCall({
      id: 'tool-call-1',
      status: update.status,
      approvalDecision: update.approvalDecision,
      responseSummary: update.responseSummary,
      redactedResponseMetadata: update.redactedResponseMetadata,
      assetCount: update.assetCount ?? 1,
      completedAt: update.completedAt ?? null,
    }),
  );

  const result = await sut.readAssetMetadata(auth, session.id, { assetIds: [assetId], fields: ['filename'] });

  expect(result.status).toBe('success');
  if (result.status !== 'success') {
    return;
  }

  expect(result.resultSize).toMatchObject({
    returnedItems: 1,
    hasMore: false,
    nextPage: null,
    truncated: false,
    omittedFields: [],
  });
  expect(result.resultSize.estimatedBytes).toBeGreaterThan(0);
  expect(toolCallRepository.transition).toHaveBeenCalledWith(
    session.id,
    'tool-call-1',
    AgentToolCallStatus.Executing,
    expect.objectContaining({
      redactedResponseMetadata: expect.objectContaining({
        assetIds: [assetId],
        resultSize: result.resultSize,
      }),
    }),
  );
});
```

- [ ] **Step 3: Add service tests for exact budget and one-over-budget**

Add two tests near search metadata result tests:

```ts
it('does not truncate when the estimated result is exactly at the read-tool budget', async () => {
  vi.spyOn(
    sut as unknown as { getReadToolResponseBudgetBytes: () => number },
    'getReadToolResponseBudgetBytes',
  ).mockReturnValue(128);
  vi.spyOn(
    sut as unknown as { estimateJsonBytes: (value: unknown) => number | null },
    'estimateJsonBytes',
  ).mockReturnValueOnce(128);

  const result = await sut.searchAssets(auth, session.id, { filters: {}, limit: 2, detail: 'ids' });

  expect(result.status).toBe('success');
  if (result.status === 'success') {
    expect(result.resultSize.truncated).toBe(false);
    expect(result.assetIds).toEqual([firstAssetId, secondAssetId]);
  }
});

it('truncates search asset IDs after paging while preserving returned order when one item exceeds the budget', async () => {
  vi.spyOn(
    sut as unknown as { getReadToolResponseBudgetBytes: () => number },
    'getReadToolResponseBudgetBytes',
  ).mockReturnValue(120);
  vi.spyOn(sut as unknown as { estimateJsonBytes: (value: unknown) => number | null }, 'estimateJsonBytes')
    .mockReturnValueOnce(121)
    .mockReturnValueOnce(100);

  const result = await sut.searchAssets(auth, session.id, { filters: {}, limit: 2, page: 1, detail: 'ids' });

  expect(result.status).toBe('success');
  if (result.status !== 'success') {
    return;
  }

  expect(result.assetIds).toEqual([firstAssetId]);
  expect(result.returnedCount).toBe(1);
  expect(result.resultSize).toMatchObject({
    returnedItems: 1,
    truncated: true,
    omittedFields: ['assetIds'],
  });
  expect(accessRepository.asset.checkOwnerAccess).toHaveBeenCalledWith(
    auth.user.id,
    new Set([firstAssetId, secondAssetId]),
    false,
  );
});
```

Use the existing search test setup variables in the file. If those IDs have different local names, keep the same assertions with the local fixtures.

- [ ] **Step 4: Add service test for nested metadata budget truncation**

Add:

```ts
it('omits metadata row payloads when nested selected fields still exceed the budget', async () => {
  vi.spyOn(
    sut as unknown as { getReadToolResponseBudgetBytes: () => number },
    'getReadToolResponseBudgetBytes',
  ).mockReturnValue(64);
  vi.spyOn(sut as unknown as { estimateJsonBytes: (value: unknown) => number | null }, 'estimateJsonBytes')
    .mockReturnValueOnce(1000)
    .mockReturnValueOnce(900)
    .mockReturnValueOnce(40);

  const result = await sut.readAssetMetadata(auth, session.id, {
    assetIds: [assetId],
    detail: 'allSafe',
  });

  expect(result.status).toBe('success');
  if (result.status !== 'success') {
    return;
  }

  expect(result.assets).toEqual([]);
  expect(result.resultSize).toMatchObject({
    returnedItems: 0,
    hasMore: true,
    truncated: true,
    omittedFields: ['assets'],
  });
});
```

- [ ] **Step 5: Add permission-safety truncation tests**

Add:

```ts
it('runs permission checks before truncating and never returns inaccessible search assets', async () => {
  const visibleAssetId = newUuid();
  const hiddenAssetId = newUuid();
  sessionRepository.getById.mockResolvedValue(makeSession({ approvalMode: AgentApprovalMode.PlanOnly }));
  searchRepository.searchMetadata.mockResolvedValue({
    items: [makeSearchAsset({ id: visibleAssetId }), makeSearchAsset({ id: hiddenAssetId })],
    hasNextPage: false,
  });
  accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set([visibleAssetId]));
  assetRepository.getAgentReadableIds.mockResolvedValue(new Set([visibleAssetId]));

  const result = await sut.searchAssets(auth, session.id, { filters: {}, limit: 2, detail: 'ids' });

  expect(result).toEqual(
    expect.objectContaining({
      status: 'denied',
      reason: 'One or more assets are not accessible',
    }),
  );
  if (result.status === 'success') {
    expect(result.assetIds).not.toContain(hiddenAssetId);
  }
});
```

This locks the ordering of access validation before budget truncation.

- [ ] **Step 6: Add approval-required and denied metadata tests**

Add:

```ts
it('stores empty result-size telemetry for approval-required read calls', async () => {
  const session = makeSession({ approvalMode: AgentApprovalMode.Strict });
  sessionRepository.getById.mockResolvedValue(session);
  accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set(assetIds));
  assetRepository.getAgentReadableIds.mockResolvedValue(new Set(assetIds));

  const result = await sut.readAssetMetadata(auth, session.id, { assetIds });

  expect(result.status).toBe('approval-required');
  expect(result.toolCall.resultSize).toEqual(emptyResultSize());
  expect(toolCallRepository.create).toHaveBeenCalledWith(
    expect.objectContaining({
      redactedResponseMetadata: { resultSize: emptyResultSize() },
    }),
  );
});

it('keeps empty result-size telemetry when a pending read call is denied by the user', async () => {
  const pending = makeToolCall({
    status: AgentToolCallStatus.PendingApproval,
    redactedResponseMetadata: { resultSize: emptyResultSize() },
  });
  sessionRepository.getById.mockResolvedValue(makeSession({ approvalMode: AgentApprovalMode.Strict }));
  toolCallRepository.getByIdForSession.mockResolvedValue(pending);
  toolCallRepository.transition.mockResolvedValue(
    makeToolCall({
      ...pending,
      status: AgentToolCallStatus.Denied,
      approvalDecision: AgentToolApprovalDecision.Denied,
      redactedResponseMetadata: { resultSize: emptyResultSize() },
    }),
  );

  const result = await sut.approveToolCall(auth, pending.sessionId, pending.id, {
    decision: AgentToolApprovalDecision.Denied,
    reason: 'Too broad',
  });

  expect(result.resultSize).toEqual(emptyResultSize());
  expect(toolCallRepository.transition).toHaveBeenCalledWith(
    pending.sessionId,
    pending.id,
    AgentToolCallStatus.PendingApproval,
    expect.objectContaining({
      redactedResponseMetadata: { resultSize: emptyResultSize() },
    }),
  );
});
```

Use the local factory helper for `emptyResultSize()` or add one near test helpers:

```ts
const emptyResultSize = () => ({
  returnedItems: 0,
  hasMore: false,
  nextPage: null,
  estimatedBytes: null,
  truncated: false,
  omittedFields: [],
});
```

- [ ] **Step 7: Run service/repository tests and verify they fail**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/repositories/agent-tool-call.repository.spec.ts src/services/agent-tool.service.spec.ts
```

Expected: fails because service/repository telemetry and truncation are not implemented.

## Task 3: Implement Service Telemetry And Budget Guards

**Files:**

- Modify: `server/src/repositories/agent-tool-call.repository.ts`
- Modify: `server/src/services/agent-tool.service.ts`

- [ ] **Step 1: Preserve metadata on repository session-limit denials**

In `AgentToolCallRepository.transitionWithSessionLimit()`, change the limit-exceeded update from:

```ts
            redactedResponseMetadata: null,
```

to:

```ts
            redactedResponseMetadata: dto.redactedResponseMetadata ?? null,
```

- [ ] **Step 2: Add result-size types to the service**

In `server/src/services/agent-tool.service.ts`, import `AgentToolResultSize` and update the generic response type:

```ts
type AgentReadToolResponse<TResult extends Record<string, unknown>> =
  | { status: 'approval-required'; toolCall: AgentToolCallResponseDto }
  | { status: 'denied'; reason: string; toolCall: AgentToolCallResponseDto }
  | ({ status: 'success'; toolCall: AgentToolCallResponseDto; resultSize: AgentToolResultSize } & TResult);
```

Add descriptor hooks:

```ts
  resultSize: (result: TResult) => Pick<AgentToolResultSize, 'returnedItems' | 'hasMore' | 'nextPage'>;
  truncateForBudget?: (
    result: TResult,
    budgetBytes: number,
  ) => { result: TResult; omittedFields: string[] };
```

- [ ] **Step 3: Add shared telemetry helpers**

Add these private helpers near `getReturnedMetadataSummary()`:

```ts
  private getReadToolResponseBudgetBytes(): number {
    return 64_000;
  }

  private emptyResultSize(): AgentToolResultSize {
    return {
      returnedItems: 0,
      hasMore: false,
      nextPage: null,
      estimatedBytes: null,
      truncated: false,
      omittedFields: [],
    };
  }

  private estimateJsonBytes(value: unknown): number | null {
    try {
      return Buffer.byteLength(JSON.stringify(value), 'utf8');
    } catch {
      return null;
    }
  }

  private withResultSize<TResult extends Record<string, unknown>>(
    result: TResult,
    descriptor: AgentReadToolDescriptor<unknown, TResult>,
  ): TResult & { resultSize: AgentToolResultSize } {
    const budgetBytes = this.getReadToolResponseBudgetBytes();
    let nextResult = result;
    let omittedFields: string[] = [];
    const initialBytes = this.estimateJsonBytes(nextResult);

    if (descriptor.truncateForBudget && initialBytes !== null && initialBytes > budgetBytes) {
      const truncated = descriptor.truncateForBudget(nextResult, budgetBytes);
      nextResult = truncated.result;
      omittedFields = truncated.omittedFields;
    }

    const finalBytes = this.estimateJsonBytes(nextResult);
    const base = descriptor.resultSize(nextResult);
    const truncated = omittedFields.length > 0;

    return {
      ...nextResult,
      resultSize: {
        returnedItems: base.returnedItems,
        hasMore: base.hasMore || truncated,
        nextPage: base.nextPage,
        estimatedBytes: finalBytes,
        truncated,
        omittedFields,
      },
    };
  }

  private withResultSizeMetadata(
    metadata: AgentToolResponseMetadata | null,
    resultSize: AgentToolResultSize,
  ): AgentToolResponseMetadata {
    return { ...(metadata ?? {}), resultSize };
  }
```

If TypeScript rejects `AgentReadToolDescriptor<unknown, TResult>` variance, make `withResultSize` generic in both `TRequest` and `TResult`:

```ts
  private withResultSize<TRequest, TResult extends Record<string, unknown>>(
    result: TResult,
    descriptor: AgentReadToolDescriptor<TRequest, TResult>,
  ): TResult & { resultSize: AgentToolResultSize } {
```

- [ ] **Step 4: Decorate successful read results**

In `executeClaimedRead()`, replace:

```ts
const result = await descriptor.execute(auth, session, request, toolCallId);
const completed = await this.transitionExecuting(auth, session, toolCallId, {
  status: AgentToolCallStatus.Completed,
  approvalDecision: AgentToolApprovalDecision.Approved,
  responseSummary: descriptor.responseSummary(result),
  redactedResponseMetadata: descriptor.responseMetadata(result),
  assetCount: descriptor.resultAssetCount(result),
  albumCount: descriptor.resultAlbumCount(result),
  completedAt: new Date(),
  error: null,
});

return { status: 'success', toolCall: this.mapToolCall(completed), ...result };
```

with:

```ts
const rawResult = await descriptor.execute(auth, session, request, toolCallId);
const result = this.withResultSize(rawResult, descriptor);
const completed = await this.transitionExecuting(auth, session, toolCallId, {
  status: AgentToolCallStatus.Completed,
  approvalDecision: AgentToolApprovalDecision.Approved,
  responseSummary: descriptor.responseSummary(result),
  redactedResponseMetadata: this.withResultSizeMetadata(descriptor.responseMetadata(result), result.resultSize),
  assetCount: descriptor.resultAssetCount(result),
  albumCount: descriptor.resultAlbumCount(result),
  completedAt: new Date(),
  error: null,
});

return { status: 'success', toolCall: this.mapToolCall(completed), ...result };
```

- [ ] **Step 5: Store empty telemetry for pending and denied audits**

In `createPendingAudit()`, set both `pendingDto.redactedResponseMetadata` and `deniedDto.redactedResponseMetadata` to:

```ts
this.withResultSizeMetadata(null, this.emptyResultSize());
```

In `createDeniedAudit()` and `createExecutingAuditWithSessionLimit()` denied DTOs, set:

```ts
redactedResponseMetadata: this.withResultSizeMetadata(null, this.emptyResultSize()),
```

In the denial branch of `approveToolCall()`, preserve the pending metadata:

```ts
            redactedResponseMetadata: toolCall.redactedResponseMetadata,
```

In `executeApprovedRead()` denial updates and `AgentToolDeniedError` handling, use the same empty metadata object instead of `null`.

- [ ] **Step 6: Map persisted result-size telemetry to API DTOs**

In `mapToolCall()`, compute:

```ts
const resultSize =
  toolCall.redactedResponseMetadata &&
  'resultSize' in toolCall.redactedResponseMetadata &&
  toolCall.redactedResponseMetadata.resultSize
    ? toolCall.redactedResponseMetadata.resultSize
    : undefined;
```

Return:

```ts
      ...(resultSize ? { resultSize } : {}),
```

- [ ] **Step 7: Add descriptor `resultSize` hooks**

For each read descriptor, add:

```ts
      resultSize: (result) => ({
        returnedItems: result.assetIds.length,
        hasMore: result.hasMore,
        nextPage: result.nextPage,
      }),
```

for `searchAssets`.

For `readAssetMetadata`:

```ts
      resultSize: (result) => ({
        returnedItems: result.assets.length,
        hasMore: false,
        nextPage: null,
      }),
```

For resolve/list/search-user tools, use array lengths and no paging:

```ts
      resultSize: (result) => ({
        returnedItems: result.results.length,
        hasMore: false,
        nextPage: null,
      }),
```

For previews/originals, use media-reference length. For read album/space, use `1` returned item.

- [ ] **Step 8: Add search and metadata truncation helpers**

Add:

```ts
  private truncateSearchAssetsResult<TResult extends {
    assetIds: string[];
    sample?: AgentSearchAssetResult[];
    assets?: AgentSearchAssetResult[];
    returnedCount: number;
  }>(result: TResult, budgetBytes: number): { result: TResult; omittedFields: string[] } {
    const omittedFields = new Set<string>();
    let nextResult = { ...result };

    const trimOne = () => {
      if (nextResult.assets && nextResult.assets.length > 0) {
        nextResult = {
          ...nextResult,
          assetIds: nextResult.assetIds.slice(0, -1),
          assets: nextResult.assets.slice(0, -1),
        };
        omittedFields.add('assets');
      } else if (nextResult.sample && nextResult.sample.length > 0) {
        nextResult = { ...nextResult, sample: nextResult.sample.slice(0, -1) };
        omittedFields.add('sample');
      } else if (nextResult.assetIds.length > 0) {
        nextResult = { ...nextResult, assetIds: nextResult.assetIds.slice(0, -1) };
        omittedFields.add('assetIds');
      } else {
        return false;
      }

      nextResult.returnedCount = nextResult.assetIds.length;
      return true;
    };

    while ((this.estimateJsonBytes(nextResult) ?? 0) > budgetBytes && trimOne()) {}

    return { result: nextResult, omittedFields: [...omittedFields] };
  }

  private truncateAssetMetadataResult<TResult extends { assets: AgentAssetMetadataResult[] }>(
    result: TResult,
    budgetBytes: number,
  ): { result: TResult; omittedFields: string[] } {
    let nextResult = { ...result, assets: result.assets };

    while ((this.estimateJsonBytes(nextResult) ?? 0) > budgetBytes && nextResult.assets.length > 0) {
      nextResult = { ...nextResult, assets: nextResult.assets.slice(0, -1) };
    }

    if ((this.estimateJsonBytes(nextResult) ?? 0) > budgetBytes) {
      nextResult = { ...nextResult, assets: [] };
    }

    return { result: nextResult, omittedFields: ['assets'] };
  }
```

Wire these into descriptors:

```ts
      truncateForBudget: (result, budgetBytes) => this.truncateSearchAssetsResult(result, budgetBytes),
```

and:

```ts
      truncateForBudget: (result, budgetBytes) => this.truncateAssetMetadataResult(result, budgetBytes),
```

- [ ] **Step 9: Run service/repository tests and verify they pass**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/repositories/agent-tool-call.repository.spec.ts src/services/agent-tool.service.spec.ts
```

Expected: pass.

## Task 4: Add Integration Coverage For Large Result Truncation

**Files:**

- Modify: `server/src/services/agent-runner-flow.integration.spec.ts`

- [ ] **Step 1: Write failing integration tests**

Add tests near the existing `Pi agent runner flow harness` tests. Use the existing `setup()` harness directly; do not invent a new MCP helper. The goal is to exercise the real `AgentToolService` instance wired to the in-memory runner-flow repositories.

```ts
it('returns truncated metadata results with omitted fields without leaking inaccessible assets', async () => {
  const harness = setup();
  const visibleAssetIds = [newUuid(), newUuid(), newUuid()];
  const inaccessibleAssetId = newUuid();
  const session = await harness.sessionService.create(harness.auth, {
    providerCredentialId: '00000000-0000-4000-8000-000000000201',
    model: 'gpt-5.1',
    permissionPreset: AgentPermissionPreset.VisualOrganizer,
    approvalMode: AgentApprovalMode.PlanOnly,
    initialContext: {},
  });

  harness.accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set(visibleAssetIds));
  harness.accessRepository.asset.checkSpaceAccess.mockResolvedValue(new Set());
  harness.assetRepository.getAgentReadableIds.mockResolvedValue(new Set(visibleAssetIds));
  harness.assetRepository.getAgentMetadataByIds.mockResolvedValue(visibleAssetIds.map((id) => metadata(id)) as never);
  vi.spyOn(
    harness.toolService as unknown as { getReadToolResponseBudgetBytes: () => number },
    'getReadToolResponseBudgetBytes',
  ).mockReturnValue(256);

  const result = await harness.toolService.readAssetMetadata(harness.auth, session.id, {
    assetIds: visibleAssetIds,
    detail: 'allSafe',
  });

  expect(result.status).toBe('success');
  if (result.status !== 'success') {
    return;
  }

  expect(result.resultSize).toEqual(
    expect.objectContaining({
      truncated: true,
      omittedFields: ['assets'],
    }),
  );
  expect(JSON.stringify(result)).not.toContain(inaccessibleAssetId);

  const denied = await harness.toolService.readAssetMetadata(harness.auth, session.id, {
    assetIds: [visibleAssetIds[0], inaccessibleAssetId],
    detail: 'basic',
  });

  expect(denied.status).toBe('denied');
  expect(JSON.stringify(denied)).not.toContain(inaccessibleAssetId);
});
```

Add a second integration test for multiple pages:

```ts
it('keeps stable paging order when multiple compact search pages accumulate size telemetry', async () => {
  const harness = setup();
  const pageOneIds = [newUuid(), newUuid()];
  const pageTwoIds = [newUuid()];
  const allAssetIds = [...pageOneIds, ...pageTwoIds];
  const session = await harness.sessionService.create(harness.auth, {
    providerCredentialId: '00000000-0000-4000-8000-000000000201',
    model: 'gpt-5.1',
    permissionPreset: AgentPermissionPreset.VisualOrganizer,
    approvalMode: AgentApprovalMode.PlanOnly,
    initialContext: {},
  });

  harness.searchRepository.searchMetadata
    .mockResolvedValueOnce({
      items: pageOneIds.map((id) => ({ id })) as never,
      hasNextPage: true,
    })
    .mockResolvedValueOnce({
      items: pageTwoIds.map((id) => ({ id })) as never,
      hasNextPage: false,
    });
  harness.accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set(allAssetIds));
  harness.accessRepository.asset.checkSpaceAccess.mockResolvedValue(new Set());
  harness.assetRepository.getAgentReadableIds.mockResolvedValue(new Set(allAssetIds));

  const first = await harness.toolService.searchAssets(harness.auth, session.id, {
    filters: {},
    limit: 2,
    page: 1,
    detail: 'ids',
  });
  const second = await harness.toolService.searchAssets(harness.auth, session.id, {
    filters: {},
    limit: 2,
    page: 2,
    detail: 'ids',
  });

  expect(first.status).toBe('success');
  expect(second.status).toBe('success');
  if (first.status !== 'success' || second.status !== 'success') {
    return;
  }

  expect(first.assetIds).toEqual(pageOneIds);
  expect(first.resultSize).toMatchObject({ returnedItems: 2, hasMore: true, nextPage: '2' });
  expect(second.assetIds).toEqual(pageTwoIds);
  expect(second.resultSize).toMatchObject({ returnedItems: 1, hasMore: false, nextPage: null });
});
```

- [ ] **Step 2: Run integration test and verify it fails**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-runner-flow.integration.spec.ts
```

Expected: fails because `resultSize` is not returned and the budget override has no truncation behavior yet.

- [ ] **Step 3: Keep the harness unchanged unless TypeScript requires a narrow cast**

The tests should use the existing `setup()` return value. If TypeScript rejects the private budget spy, keep the cast inline in the test:

```ts
vi.spyOn(
  harness.toolService as unknown as { getReadToolResponseBudgetBytes: () => number },
  'getReadToolResponseBudgetBytes',
).mockReturnValue(256);
```

Do not add new production test hooks.

- [ ] **Step 4: Run integration test and verify it passes**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-runner-flow.integration.spec.ts
```

Expected: pass.

## Task 5: Add UI Technical Detail Coverage

**Files:**

- Modify: `web/src/routes/(user)/assistant/agent-activity-ui.ts`
- Modify: `web/src/routes/(user)/assistant/agent-activity-ui.spec.ts`
- Modify: `web/src/routes/(user)/assistant/agent-activity-block.spec.ts`
- Modify: `web/src/routes/(user)/assistant/agent-session-chat-panel.svelte`
- Modify: `web/src/routes/(user)/assistant/agent-session-chat-panel.spec.ts`
- Modify: `web/src/routes/(user)/assistant/agent-tool-approval-card.svelte`
- Modify: `web/src/routes/(user)/assistant/agent-tool-approval-card.spec.ts`

- [ ] **Step 1: Write failing helper tests for activity technical rows**

In `agent-activity-ui.spec.ts`, add:

```ts
it('adds response-size telemetry to technical rows', () => {
  const rows = buildAgentActivityTechnicalRows({
    id: 'item-1',
    sessionId,
    kind: 'search',
    status: 'completed',
    title: 'Searching photos',
    startedAt: '2026-05-18T10:00:05.000Z',
    technical: {
      toolName: AgentToolName.SearchAssets,
      toolCallIds: ['tool-call-1'],
      resultSize: {
        returnedItems: 12,
        hasMore: true,
        nextPage: '2',
        estimatedBytes: 42000,
        truncated: true,
        omittedFields: ['assets', 'sample'],
      },
    },
  });

  expect(rows).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        id: 'result-size',
        labelKey: 'assistant_activity_technical_result_size',
        value: '42 KB',
      }),
      expect.objectContaining({
        id: 'result-items',
        labelKey: 'assistant_activity_technical_result_items',
        value: '12',
      }),
      expect.objectContaining({
        id: 'result-truncated',
        labelKey: 'assistant_activity_technical_truncated',
        value: 'yes',
      }),
      expect.objectContaining({
        id: 'result-omitted-fields',
        labelKey: 'assistant_activity_technical_omitted_fields',
        value: 'assets, sample',
      }),
      expect.objectContaining({
        id: 'result-next-page',
        labelKey: 'assistant_activity_technical_next_page',
        value: '2',
      }),
    ]),
  );
});
```

Add a nullable-estimate test:

```ts
it('shows unavailable result-size estimates without crashing', () => {
  const rows = buildAgentActivityTechnicalRows({
    id: 'item-1',
    sessionId,
    kind: 'metadata',
    status: 'blocked',
    title: 'Waiting for approval',
    startedAt: '2026-05-18T10:00:05.000Z',
    technical: {
      resultSize: {
        returnedItems: 0,
        hasMore: false,
        nextPage: null,
        estimatedBytes: null,
        truncated: false,
        omittedFields: [],
      },
    },
  });

  expect(rows).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ id: 'result-size', value: 'not estimated' }),
      expect.objectContaining({ id: 'result-items', value: '0' }),
    ]),
  );
});
```

- [ ] **Step 2: Implement activity technical rows**

In `agent-activity-ui.ts`, extend `AgentActivityTechnicalDetails`:

```ts
  resultSize?: AgentToolCallResponseDto['resultSize'];
```

Add helpers:

```ts
const formatBytes = (bytes: number | null | undefined) => {
  if (bytes === null || bytes === undefined) {
    return 'not estimated';
  }

  if (bytes < 1024) {
    return `${bytes} B`;
  }

  return `${Math.round(bytes / 1024)} KB`;
};
```

In `buildAgentActivityTechnicalRows()`, after response summary:

```ts
    technicalTextRow('result-size', 'assistant_activity_technical_result_size', formatBytes(technical.resultSize?.estimatedBytes), 'number'),
    technicalTextRow('result-items', 'assistant_activity_technical_result_items', technical.resultSize?.returnedItems, 'number'),
    technicalTextRow(
      'result-truncated',
      'assistant_activity_technical_truncated',
      technical.resultSize ? (technical.resultSize.truncated ? 'yes' : 'no') : undefined,
    ),
    technicalTextRow(
      'result-omitted-fields',
      'assistant_activity_technical_omitted_fields',
      technical.resultSize?.omittedFields.length ? technical.resultSize.omittedFields.join(', ') : undefined,
    ),
    technicalTextRow('result-next-page', 'assistant_activity_technical_next_page', technical.resultSize?.nextPage),
```

In `buildToolActivityCandidate()`, set:

```ts
      ...(toolCall.resultSize ? { resultSize: toolCall.resultSize } : {}),
```

In `coalesceToolActivities()`, prefer the first available result size and include it in the coalesced technical details:

```ts
const resultSize = sortedGroup.find((item) => item.technical?.resultSize)?.technical?.resultSize;
```

and:

```ts
        ...(resultSize ? { resultSize } : {}),
```

- [ ] **Step 3: Write failing activity block render test**

In `agent-activity-block.spec.ts`, extend the `svelte-i18n` mock messages:

```ts
    assistant_activity_technical_result_size: 'Response size',
    assistant_activity_technical_result_items: 'Returned items',
    assistant_activity_technical_truncated: 'Truncated',
    assistant_activity_technical_omitted_fields: 'Omitted fields',
    assistant_activity_technical_next_page: 'Next page',
```

Add:

```ts
it('renders result-size technical rows when expanded', async () => {
  render(AgentActivityBlock, {
    props: {
      visibilityMode: 'expanded',
      model: {
        activeItem: null,
        summary: null,
        items: [
          {
            id: 'search-1',
            sessionId,
            kind: 'search',
            status: 'completed',
            title: 'Searching photos',
            startedAt: '2026-05-18T10:00:05.000Z',
            technical: {
              resultSize: {
                returnedItems: 4,
                hasMore: false,
                nextPage: null,
                estimatedBytes: 2048,
                truncated: true,
                omittedFields: ['assets'],
              },
            },
          },
        ],
      },
    },
  });

  await fireEvent.click(screen.getByRole('button', { name: 'Show technical details' }));

  expect(screen.getByText('Response size')).toBeInTheDocument();
  expect(screen.getByText('2 KB')).toBeInTheDocument();
  expect(screen.getByText('Omitted fields')).toBeInTheDocument();
  expect(screen.getByText('assets')).toBeInTheDocument();
});
```

Use the exact existing button label from the mock in this spec if it differs.

- [ ] **Step 4: Write failing chat-panel and approval-card tests**

In `agent-session-chat-panel.spec.ts`, add to a completed tool-call details test:

```ts
        resultSize: {
          returnedItems: 4,
          hasMore: true,
          nextPage: '2',
          estimatedBytes: 4096,
          truncated: true,
          omittedFields: ['assets'],
        },
```

After expanding `Details`, assert:

```ts
expect(screen.getByText('Response size')).toBeInTheDocument();
expect(screen.getByText('4 KB')).toBeInTheDocument();
expect(screen.getByText('Truncated')).toBeInTheDocument();
expect(screen.getByText('yes')).toBeInTheDocument();
```

In `agent-tool-approval-card.spec.ts`, add a pending-call details test:

```ts
it('shows no-result telemetry in expanded approval details', async () => {
  render(AgentToolApprovalCard, {
    props: {
      session,
      toolCall: toolCall({
        resultSize: {
          returnedItems: 0,
          hasMore: false,
          nextPage: null,
          estimatedBytes: null,
          truncated: false,
          omittedFields: [],
        },
      }),
      onApprove: vi.fn(),
      onDeny: vi.fn(),
    },
  });

  expect(screen.queryByText('Response size')).not.toBeInTheDocument();

  await fireEvent.click(screen.getByRole('button', { name: 'Details' }));

  expect(screen.getByText('Response size')).toBeInTheDocument();
  expect(screen.getByText('not estimated')).toBeInTheDocument();
  expect(screen.getByText('Returned items')).toBeInTheDocument();
  expect(screen.getByText('0')).toBeInTheDocument();
});
```

- [ ] **Step 5: Implement chat-panel and approval-card displays**

In both Svelte files, add small local helpers if no shared helper is available:

```ts
const formatResultSizeBytes = (bytes: number | null | undefined) => {
  if (bytes === null || bytes === undefined) {
    return 'not estimated';
  }

  if (bytes < 1024) {
    return `${bytes} B`;
  }

  return `${Math.round(bytes / 1024)} KB`;
};
```

In expanded details `<dl>`, add conditional rows when `toolCall.resultSize` exists:

```svelte
                  {#if toolCall.resultSize}
                    <div>
                      <dt class="font-medium text-gray-500 dark:text-gray-400">Response size</dt>
                      <dd>{formatResultSizeBytes(toolCall.resultSize.estimatedBytes)}</dd>
                    </div>
                    <div>
                      <dt class="font-medium text-gray-500 dark:text-gray-400">Returned items</dt>
                      <dd>{toolCall.resultSize.returnedItems}</dd>
                    </div>
                    <div>
                      <dt class="font-medium text-gray-500 dark:text-gray-400">Truncated</dt>
                      <dd>{toolCall.resultSize.truncated ? 'yes' : 'no'}</dd>
                    </div>
                    {#if toolCall.resultSize.omittedFields.length > 0}
                      <div>
                        <dt class="font-medium text-gray-500 dark:text-gray-400">Omitted fields</dt>
                        <dd>{toolCall.resultSize.omittedFields.join(', ')}</dd>
                      </div>
                    {/if}
                  {/if}
```

Keep this in expanded details only so normal chat cards remain low-info.

- [ ] **Step 6: Run focused web tests and verify they pass**

Run:

```bash
pnpm --dir web exec vitest --config vitest.config.ts src/routes/'(user)'/assistant/agent-activity-ui.spec.ts src/routes/'(user)'/assistant/agent-activity-block.spec.ts src/routes/'(user)'/assistant/agent-session-chat-panel.spec.ts src/routes/'(user)'/assistant/agent-tool-approval-card.spec.ts
```

Expected: pass.

## Task 6: Regenerate SDK/OpenAPI And Verify

**Files:**

- Modify: `open-api/immich-openapi-specs.json`
- Modify: `open-api/typescript-sdk/src/fetch-client.ts`
- Modify: `open-api/typescript-sdk/build/fetch-client.d.ts`

- [ ] **Step 1: Regenerate OpenAPI and TypeScript SDK**

Run:

```bash
make open-api-typescript
pnpm --dir open-api/typescript-sdk build
```

Expected: `AgentToolResultSize` appears in `open-api/typescript-sdk/src/fetch-client.ts`, `AgentToolCallResponseDto` has optional `resultSize`, and all read success response types have required `resultSize`.

- [ ] **Step 2: Verify generated SDK diff**

Run:

```bash
git diff -- open-api/immich-openapi-specs.json open-api/typescript-sdk/src/fetch-client.ts open-api/typescript-sdk/build/fetch-client.d.ts | rg 'AgentToolResultSize|resultSize'
```

Expected: output includes the new schema/type and `resultSize` fields only. If unrelated generated churn appears, inspect it and keep only deterministic generated output from the command.

- [ ] **Step 3: Run server and web checks**

Run:

```bash
pnpm --dir server check
pnpm --dir web check
```

Expected: both pass.

## Task 7: Final Focused Verification And Commit

**Files:**

- All files changed in this slice.

- [ ] **Step 1: Run focused regression suite**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/dtos/agent-tool.dto.spec.ts src/repositories/agent-tool-call.repository.spec.ts src/services/agent-tool.service.spec.ts src/services/agent-runner-flow.integration.spec.ts src/controllers/agent-tool.controller.spec.ts
pnpm --dir web exec vitest --config vitest.config.ts src/routes/'(user)'/assistant/agent-activity-ui.spec.ts src/routes/'(user)'/assistant/agent-activity-block.spec.ts src/routes/'(user)'/assistant/agent-session-chat-panel.spec.ts src/routes/'(user)'/assistant/agent-tool-approval-card.spec.ts
```

Expected: all focused tests pass.

- [ ] **Step 2: Run lint/check command requested by the user**

Run:

```bash
pnpm --dir server check
pnpm --dir web check
```

Expected: both pass. If `web check` fails only because the local generated SDK build is stale, rerun:

```bash
pnpm --dir open-api/typescript-sdk build
pnpm --dir web check
```

- [ ] **Step 3: Inspect diff for scope**

Run:

```bash
git diff --stat
git diff --check
```

Expected: no whitespace errors; changes are limited to Slice 4 plan, server tool telemetry/truncation, generated SDK/OpenAPI, and assistant UI technical details.

- [ ] **Step 4: Commit and push Slice 4**

Run:

```bash
git add docs/superpowers/plans/2026-05-21-pi-agent-mcp-minimal-context-slice-4.md \
  server/src/types/agent-tool.types.ts \
  server/src/dtos/agent-tool.dto.ts \
  server/src/dtos/agent-tool.dto.spec.ts \
  server/src/repositories/agent-tool-call.repository.ts \
  server/src/repositories/agent-tool-call.repository.spec.ts \
  server/src/services/agent-tool.service.ts \
  server/src/services/agent-tool.service.spec.ts \
  server/src/services/agent-runner-flow.integration.spec.ts \
  server/src/controllers/agent-tool.controller.spec.ts \
  open-api/immich-openapi-specs.json \
  open-api/typescript-sdk/src/fetch-client.ts \
  open-api/typescript-sdk/build/fetch-client.d.ts \
  web/src/routes/'(user)'/assistant/agent-activity-ui.ts \
  web/src/routes/'(user)'/assistant/agent-activity-ui.spec.ts \
  web/src/routes/'(user)'/assistant/agent-activity-block.spec.ts \
  web/src/routes/'(user)'/assistant/agent-session-chat-panel.svelte \
  web/src/routes/'(user)'/assistant/agent-session-chat-panel.spec.ts \
  web/src/routes/'(user)'/assistant/agent-tool-approval-card.svelte \
  web/src/routes/'(user)'/assistant/agent-tool-approval-card.spec.ts
git commit -m "feat: add MCP result size guardrails"
git push
```

Expected: branch `explore/pi-agent-brainstorm` is pushed with the Slice 4 commit.

## Self-Review Checklist

- TDD order is explicit: every behavior starts with failing DTO/service/integration/UI tests, then implementation, then green verification.
- Spec test coverage is included:
  - persisted size metadata: Tasks 2 and 3;
  - response `resultSize` DTOs: Task 1;
  - UI technical-detail display: Task 5;
  - large result truncation with `omittedFields`: Tasks 2 and 4;
  - permission checks before truncation: Task 2;
  - approval-required and denied calls with no payload: Tasks 1 and 2.
- Spec edge cases are included:
  - estimate unavailable: Tasks 1 and 5;
  - exactly at budget: Task 2;
  - one item over budget: Task 2;
  - multiple pages and transcript accumulation signal: Task 4;
  - truncation after sorting/paging and stable ordering: Tasks 2 and 4;
  - nested field budget overflow: Task 2.
- The plan intentionally does not implement Slice 5 compaction, Slice 6 examples, or Slice 7 handles.
