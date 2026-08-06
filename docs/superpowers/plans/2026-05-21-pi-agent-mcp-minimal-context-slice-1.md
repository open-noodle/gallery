# Pi Agent MCP Minimal Context Slice 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop duplicating MCP tool payloads by returning short human-readable `content[0].text` while preserving the full machine-readable result once in `structuredContent`.

**Architecture:** Keep the JSON-RPC and MCP response envelope unchanged, but change `AgentMcpService.toolResult()` to derive bounded text from `summary`, status, validation errors, or a generic fallback. Tests first update the MCP service contract so every successful tool call still has valid `content` and `structuredContent`, but large nested data is not JSON-stringified into `content[0].text`.

**Tech Stack:** NestJS service tests with Vitest, TypeScript DTO/service layer, existing MCP JSON-RPC types in `server/src/types/agent-mcp.types.ts`.

---

## Scope

Slice 1 only changes the MCP `tools/call` response text wrapper. It does not change `searchAssets`, `readAssetMetadata`, runner compaction, response-size telemetry, prompts, or selection handles.

## Files

- Modify: `server/src/services/agent-mcp.service.spec.ts`
  - Update MCP result helpers.
  - Add failing tests for summary text, large nested results, fallback text, approval-required responses, and validation errors.
- Modify: `server/src/services/agent-mcp.service.ts`
  - Replace `JSON.stringify(structuredContent)` text with compact derived text.
  - Add a small max text constant and helper methods local to the service.
- Optional test fixture cleanup if needed: `server/src/controllers/agent-runner-mcp.controller.spec.ts`
  - Only update fixtures if a controller test hardcodes duplicated JSON text for a mocked service result.

## Contract

`AgentMcpToolCallResult` remains:

```ts
{
  content: [{ type: 'text', text: string }],
  structuredContent: unknown,
  isError?: boolean,
}
```

New text rules:

- `content[0].text` is always a string no longer than `500` characters.
- If `structuredContent.summary` is a non-empty string, text uses that summary.
- If `structuredContent.status === 'approval-required'`, text mentions approval and includes `toolCall.requestSummary` when available.
- If `structuredContent.status === 'denied'`, text mentions denial and includes `reason` when available.
- If `structuredContent.status === 'error'` and `error` is a string, text uses that error and the first issue path/message when available.
- Otherwise text falls back to `Tool result returned.`.
- For object results, text must not equal `JSON.stringify(structuredContent)`.
- `structuredContent` must be unchanged.

## Task 1: Write The Failing MCP Text Contract Tests

**Files:**

- Modify: `server/src/services/agent-mcp.service.spec.ts`

- [ ] **Step 1: Add a local max-text constant and update `expectToolResult`**

Replace the existing `expectToolResult` helper with this stricter contract helper:

```ts
const MCP_TOOL_TEXT_MAX_CHARS = 500;

const expectedToolTextIncludes = (structuredContent: unknown, override?: string): string => {
  if (override) {
    return override;
  }

  if (!structuredContent || typeof structuredContent !== 'object' || Array.isArray(structuredContent)) {
    return 'Tool result returned.';
  }

  const result = structuredContent as Record<string, unknown>;
  if (typeof result.summary === 'string' && result.summary.trim() !== '') {
    return result.summary.trim();
  }

  if (result.status === 'approval-required') {
    const toolCall = result.toolCall as Record<string, unknown> | undefined;
    const requestSummary = toolCall && typeof toolCall.requestSummary === 'string' ? toolCall.requestSummary : '';
    return requestSummary ? `Approval required: ${requestSummary}` : 'Approval required.';
  }

  if (result.status === 'denied') {
    return typeof result.reason === 'string' ? `Tool call denied: ${result.reason}` : 'Tool call denied.';
  }

  if (result.status === 'error') {
    return typeof result.error === 'string' ? result.error : 'Tool error';
  }

  return 'Tool result returned.';
};

const expectToolResult = (
  response: AgentMcpSuccessResponse,
  requestId: AgentMcpSuccessResponse['id'],
  structuredContent: unknown,
  expectedTextIncludes?: string,
) => {
  const result = response.result as AgentMcpToolCallResult;
  const text = result.content[0]?.text ?? '';

  expect(response).toMatchObject({
    jsonrpc: '2.0',
    id: requestId,
  });
  expect(result.structuredContent).toEqual(structuredContent);
  expect(result.content).toEqual([{ type: 'text', text: expect.any(String) }]);
  expect(text).toEqual(expect.stringContaining(expectedToolTextIncludes(structuredContent, expectedTextIncludes)));
  expect(text.length).toBeLessThanOrEqual(MCP_TOOL_TEXT_MAX_CHARS);

  if (structuredContent && typeof structuredContent === 'object') {
    expect(text).not.toBe(JSON.stringify(structuredContent));
  }
};
```

This immediately makes existing wrapper tests fail because the implementation still serializes the full object as text.

- [ ] **Step 2: Update validation helper expectations**

At the end of `expectEnrichedToolValidationError`, replace the exact JSON text assertion with:

```ts
const text = result.content[0]?.text;

expect(result.content).toEqual([{ type: 'text', text: expect.any(String) }]);
expect(text).toEqual(expect.stringContaining('Invalid tool arguments'));
expect(text.length).toBeLessThanOrEqual(MCP_TOOL_TEXT_MAX_CHARS);
expect(text).not.toBe(JSON.stringify(result.structuredContent));
```

- [ ] **Step 3: Add compact summary test**

Add this test near the existing `delegates ... and wraps the result` tests:

```ts
it('uses result summary as compact MCP text while preserving structured content', async () => {
  const serviceResult = {
    status: 'success',
    toolCall: null,
    summary: 'Returned 2 albums.',
    albums: [
      { id: factory.uuid(), name: 'Portugal' },
      { id: factory.uuid(), name: 'Berlin' },
    ],
  };
  toolService.listAlbums.mockResolvedValue(serviceResult as never);

  const response = (await sut.handle(
    auth,
    sessionId,
    makeToolCallRequest(AgentToolName.ListAlbums, {}),
  )) as AgentMcpSuccessResponse;

  expectToolResult(response, `${AgentToolName.ListAlbums}-call`, serviceResult, 'Returned 2 albums.');
});
```

- [ ] **Step 4: Add large nested result test**

Add this test near the compact summary test:

```ts
it('keeps MCP text compact for large nested structured results', async () => {
  const serviceResult = {
    status: 'success',
    toolCall: null,
    summary: 'Returned 250 compact asset IDs; more results available on page 2.',
    data: {
      assetIds: Array.from({ length: 250 }, (_, index) => `asset-${index}`),
      nested: {
        rows: Array.from({ length: 25 }, (_, index) => ({
          id: `nested-${index}`,
          metadata: 'x'.repeat(200),
        })),
      },
    },
  };
  toolService.searchAssets.mockResolvedValue(serviceResult as never);

  const response = (await sut.handle(
    auth,
    sessionId,
    makeToolCallRequest(AgentToolName.SearchAssets, { limit: 250 }),
  )) as AgentMcpSuccessResponse;
  const result = response.result as AgentMcpToolCallResult;
  const text = result.content[0].text;

  expectToolResult(response, `${AgentToolName.SearchAssets}-call`, serviceResult, 'Returned 250 compact asset IDs');
  expect(text).not.toContain('asset-249');
  expect(text).not.toContain('"nested"');
});
```

- [ ] **Step 5: Add fallback test for results without summary**

Add this test near the compact summary test:

```ts
it('uses a compact fallback for results without a summary', async () => {
  const serviceResult = {
    status: 'success',
    toolCall: null,
    albums: [{ id: factory.uuid(), name: 'No summary album', assetIds: [factory.uuid()] }],
    nested: { rows: [{ value: 'x'.repeat(1000) }] },
  };
  toolService.listAlbums.mockResolvedValue(serviceResult as never);

  const response = (await sut.handle(
    auth,
    sessionId,
    makeToolCallRequest(AgentToolName.ListAlbums, {}),
  )) as AgentMcpSuccessResponse;
  const result = response.result as AgentMcpToolCallResult;

  expectToolResult(response, `${AgentToolName.ListAlbums}-call`, serviceResult, 'Tool result returned.');
  expect(result.content[0].text).not.toContain('No summary album');
  expect(result.content[0].text).not.toContain('"nested"');
});
```

- [ ] **Step 6: Strengthen approval-required text test**

In `returns approval-required read responses as normal MCP tool results`, change the `serviceResult` to include a request summary:

```ts
const serviceResult = {
  status: 'approval-required',
  toolCall: {
    id: factory.uuid(),
    status: 'pending-approval',
    requestSummary: 'Read previews for 1 asset.',
  },
};
```

Change its helper assertion to:

```ts
expectToolResult(
  response,
  `${AgentToolName.ReadAssetPreviews}-call`,
  serviceResult,
  'Approval required: Read previews for 1 asset.',
);
```

- [ ] **Step 7: Replace remaining exact JSON text assertions**

Search in `server/src/services/agent-mcp.service.spec.ts` for:

```bash
rg -n "JSON.stringify\\(result\\.structuredContent\\)|JSON.stringify\\(structuredContent\\)" server/src/services/agent-mcp.service.spec.ts
```

For each assertion that expects `content[0].text` to equal serialized structured content, replace it with the compact validation assertion:

```ts
expect(result.content).toEqual([{ type: 'text', text: expect.any(String) }]);
expect(result.content[0].text).toEqual(expect.stringContaining('Invalid tool arguments'));
expect(result.content[0].text.length).toBeLessThanOrEqual(MCP_TOOL_TEXT_MAX_CHARS);
expect(result.content[0].text).not.toBe(JSON.stringify(result.structuredContent));
```

Keep tests that serialize `structuredContent` only to check size or secret leakage.

- [ ] **Step 8: Run focused tests and verify red**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-mcp.service.spec.ts
```

Expected red failure examples:

- `expected text not to be JSON.stringify(structuredContent)`
- `expected text to contain "Returned 2 albums."`
- `expected text.length to be less than or equal 500`

If these tests pass before implementation, inspect whether production code was already changed by another agent and update this plan with the observed baseline before continuing.

## Task 2: Implement Compact MCP Tool Text

**Files:**

- Modify: `server/src/services/agent-mcp.service.ts`

- [ ] **Step 1: Add max constant near `MCP_PROTOCOL_VERSION`**

Add:

```ts
const MCP_TOOL_TEXT_MAX_CHARS = 500;
```

- [ ] **Step 2: Replace `toolResult()` with derived text**

Replace the current method:

```ts
  private toolResult(structuredContent: unknown): AgentMcpToolCallResult {
    return {
      content: [{ type: 'text', text: JSON.stringify(structuredContent) }],
      structuredContent,
    };
  }
```

with:

```ts
  private toolResult(structuredContent: unknown): AgentMcpToolCallResult {
    return {
      content: [{ type: 'text', text: this.toolResultText(structuredContent) }],
      structuredContent,
    };
  }
```

- [ ] **Step 3: Add compact text helpers below `toolResult()`**

Add:

```ts
  private toolResultText(structuredContent: unknown): string {
    if (!structuredContent || typeof structuredContent !== 'object' || Array.isArray(structuredContent)) {
      return this.compactToolText('Tool result returned.');
    }

    const result = structuredContent as Record<string, unknown>;
    const summary = this.nonEmptyString(result.summary);
    if (summary) {
      return this.compactToolText(summary);
    }

    const status = this.nonEmptyString(result.status);
    if (status === 'approval-required') {
      const toolCall = this.recordValue(result.toolCall);
      const requestSummary = toolCall ? this.nonEmptyString(toolCall.requestSummary) : undefined;
      return this.compactToolText(requestSummary ? `Approval required: ${requestSummary}` : 'Approval required.');
    }

    if (status === 'denied') {
      const reason = this.nonEmptyString(result.reason);
      return this.compactToolText(reason ? `Tool call denied: ${reason}` : 'Tool call denied.');
    }

    if (status === 'error') {
      const error = this.nonEmptyString(result.error) ?? 'Tool error';
      const issue = this.firstValidationIssueText(result.issues);
      return this.compactToolText(issue ? `${error}: ${issue}` : error);
    }

    return this.compactToolText('Tool result returned.');
  }

  private firstValidationIssueText(issues: unknown): string | undefined {
    if (!Array.isArray(issues)) {
      return;
    }

    const [issue] = issues;
    if (!issue || typeof issue !== 'object' || Array.isArray(issue)) {
      return;
    }

    const issueRecord = issue as Record<string, unknown>;
    const path = this.nonEmptyString(issueRecord.path);
    const message = this.nonEmptyString(issueRecord.message);
    if (path && message) {
      return `${path} ${message}`;
    }

    return message ?? path;
  }

  private recordValue(value: unknown): Record<string, unknown> | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return;
    }

    return value as Record<string, unknown>;
  }

  private nonEmptyString(value: unknown): string | undefined {
    if (typeof value !== 'string') {
      return;
    }

    const trimmed = value.trim();
    return trimmed === '' ? undefined : trimmed;
  }

  private compactToolText(text: string): string {
    if (text.length <= MCP_TOOL_TEXT_MAX_CHARS) {
      return text;
    }

    return `${text.slice(0, MCP_TOOL_TEXT_MAX_CHARS - 3)}...`;
  }
```

These helpers deliberately do not inspect arbitrary nested result arrays, so large structured data stays out of `content[0].text`.

- [ ] **Step 4: Run focused test and verify green**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-mcp.service.spec.ts
```

Expected: all tests in `src/services/agent-mcp.service.spec.ts` pass.

## Task 3: Update Any Controller Fixture Drift

**Files:**

- Inspect: `server/src/controllers/agent-runner-mcp.controller.spec.ts`
- Modify only if needed.

- [ ] **Step 1: Search for hardcoded duplicated result text**

Run:

```bash
rg -n "JSON.stringify|structuredContent|content: \\[\\{ type: 'text'" server/src/controllers/agent-runner-mcp.controller.spec.ts
```

- [ ] **Step 2: Patch stale mocked MCP service result fixtures if present**

If a fixture constructs an `AgentMcpToolCallResult` with `content[0].text = JSON.stringify(structuredContent)`, replace only the mock text with a compact summary:

```ts
content: [{ type: 'text', text: 'Returned 1 album.' }],
structuredContent: { status: 'success', summary: 'Returned 1 album.', albums: [] },
```

Do not change controller behavior. The controller should still pass through the service result unchanged.

- [ ] **Step 3: Run controller MCP tests if changed**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/controllers/agent-runner-mcp.controller.spec.ts
```

Expected: all tests in the controller spec pass.

## Task 4: Final Validation And Commit

**Files:**

- Modified tests and service from previous tasks.

- [ ] **Step 1: Run all related tests**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-mcp.service.spec.ts src/controllers/agent-runner-mcp.controller.spec.ts
```

Expected: both specs pass. If the controller spec was not changed and is slow or unavailable, still run it because it verifies the HTTP MCP passthrough surface.

- [ ] **Step 2: Inspect diff**

Run:

```bash
git diff -- server/src/services/agent-mcp.service.ts server/src/services/agent-mcp.service.spec.ts server/src/controllers/agent-runner-mcp.controller.spec.ts
```

Expected:

- No response duplication remains in `AgentMcpService.toolResult()`.
- Tests assert compact text and unchanged `structuredContent`.
- No future-slice fields such as `detail`, `fields`, `resultSize`, or `selectionHandle` are implemented.

- [ ] **Step 3: Commit**

Run:

```bash
git add server/src/services/agent-mcp.service.ts server/src/services/agent-mcp.service.spec.ts server/src/controllers/agent-runner-mcp.controller.spec.ts docs/superpowers/plans/2026-05-21-pi-agent-mcp-minimal-context-slice-1.md
git commit -m "feat: compact MCP tool result text"
```

Expected: commit succeeds with Slice 1 implementation and plan.

- [ ] **Step 4: Push**

Run:

```bash
git push
```

Expected: `explore/pi-agent-brainstorm` pushes to `origin/explore/pi-agent-brainstorm`.

## Plan Review Checklist

- TDD is explicit: tests are changed and run red before implementation.
- Every Slice 1 spec test is covered:
  - small useful text: `uses result summary as compact MCP text`;
  - large result not stringified: `keeps MCP text compact for large nested structured results`;
  - max text length: helper and large-result test;
  - validation compatibility: updated validation helper and matrix tests;
  - approval-required text: strengthened approval-required read response test;
  - valid `content` and `structuredContent`: updated `expectToolResult`.
- Every Slice 1 edge case is covered:
  - no summary: fallback test;
  - nested arrays: large nested result test;
  - `status: approval-required`: strengthened read approval test;
  - validation errors: validation helper and runtime failure matrix.
- Future slices are excluded.
