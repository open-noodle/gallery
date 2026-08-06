# Pi Agent Strict Recent Trip Album Slice 5 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Route supported `create_recent_trip_album` prompts through the deterministic strict workflow in production `pi-runtime` before Pi provider orchestration.

**Architecture:** Production `pi-runtime` will keep the Pi SDK session for unsupported prompts, but matched strict recent-trip album turns will call the Gallery MCP JSON-RPC gateway directly with the shared strict workflow executor. The strict path emits the same runner event shapes as normal messages, stores a minimal user/assistant transcript on the Pi session, and returns to the existing open provider flow for unsupported prompts and later turns. This slice does not implement durable pending candidate state or approval resume persistence; those remain Slice 6.

**Tech Stack:** Node.js ESM, `node:test`, `node:assert/strict`, existing Pi runtime fake SDK tests, Gallery MCP JSON-RPC `tools/call`.

---

## Spec Scope

Implements Slice 5 from `docs/superpowers/specs/2026-05-28-pi-agent-strict-recent-trip-album-design.md`.

Covered requirements:

- Production `pi-runtime` routes strict recent-trip album prompts before calling the provider session.
- Unsupported prompts still reach open provider orchestration.
- A strict handled turn persists assistant output in the in-memory Pi session transcript and leaves the runner session usable for future messages.
- A strict handled turn produces the same user-visible strict recent-trip behavior as the e2e runtime.
- A successful strict handled turn creates a reviewable plan through `proposeAlbumFromSelection` and assistant copy says to review before applying.
- Strict direct MCP calls are abortable when a runner session is disposed or replaced.
- Direct MCP transport/protocol/tool errors use generic user-facing messages with status/code/tool name only, without raw response bodies, JSON-RPC messages, tool error text, or credential-like strings.
- Structured non-success planning results from `proposeAlbumFromSelection` use generic status/tool text and do not expose raw `reason`, `error`, or `message` fields.

Not included in this slice:

- Durable pending state for `ask_user` candidate selection.
- Approval resume continuation for strict workflow pauses.
- Server/websocket/database `operation-plan-ready` assertions.
- Direct apply/write behavior.

## File Structure

- Modify `agent-runner/src/pi-runtime.mjs`
  - Import `matchStrictWorkflow` and `runCreateRecentTripAlbumWorkflow`.
  - Add a small direct Gallery MCP JSON-RPC client for `tools/call`.
  - Store the `mcpGateway` object in each runtime session entry.
  - Add a strict workflow fast path in `sendMessage` before provider subscription/prompting.
  - Attach an `AbortController` to the strict fast path and clear it after completion.
  - Sanitize direct MCP failures to generic status/code/tool-name messages.
  - Append minimal strict user/assistant transcript messages for completed strict turns.
- Modify `agent-runner/src/pi-runtime.test.mjs`
  - Add MCP fetch helpers for strict workflow tests.
  - Add production runtime tests for strict routing, unsupported fallback, session continuity, and approval pause event shape.
  - Add strict dispose/replacement abort coverage and direct MCP error hardening coverage for HTTP non-OK, invalid JSON, JSON-RPC error, and MCP `isError` responses.
- Modify `agent-runner/src/strict-workflows.mjs`
  - Accept an optional `signal` and forward it to `findTripCandidates` and `proposeAlbumFromSelection`.
  - Convert non-success structured planning results to generic `proposeAlbumFromSelection` status text.
- Modify `agent-runner/src/strict-workflows.test.mjs`
  - Prove strict workflow execution forwards the same signal to both direct MCP calls.
  - Prove structured planning denial/error details are not copied into assistant output.

## Task 1: Production Strict Workflow Routing

**Files:**

- Modify: `agent-runner/src/pi-runtime.mjs`
- Modify: `agent-runner/src/pi-runtime.test.mjs`

- [x] **Step 1: Add failing production runtime tests**

In `agent-runner/src/pi-runtime.test.mjs`, add these helpers near the existing top-level test helpers, after `collect`:

```js
const strictTripCandidateHandleId = '00000000-0000-4000-8000-000000000921';
const strictTripPlanId = '00000000-0000-4000-8000-000000000923';

const makeStrictTripCandidate = (overrides = {}) => ({
  dedupeKey: 'trip:usa:new-york:2026-05-03:2026-05-12',
  title: 'Recent trip to New York, USA',
  subtitle: '28 photos over 10 days',
  takenAfter: '2026-05-03T00:00:00.000Z',
  takenBefore: '2026-05-12T23:59:59.000Z',
  albumAssetCount: 28,
  excludedDuplicateCount: 3,
  excludedStackChildCount: 1,
  placeLabels: ['New York, USA'],
  selectionHandle: {
    id: strictTripCandidateHandleId,
    sourceRef: `asset-source:search:${strictTripCandidateHandleId}`,
    assetCount: 28,
  },
  ...overrides,
});

const createStrictWorkflowFetch = ({
  candidates = [makeStrictTripCandidate()],
  recommendation = {
    action: 'use_top_candidate',
    candidateDedupeKey: 'trip:usa:new-york:2026-05-03:2026-05-12',
    reason: 'The only readable trip candidate is high confidence.',
  },
  planResponse = {
    status: 'success',
    summary: 'Stored proposed album from selection.',
    plan: { id: strictTripPlanId },
  },
} = {}) => {
  const calls = [];
  const fetchImplementation = async (url, init) => {
    const body = init?.body ? JSON.parse(init.body) : {};
    calls.push({ url: String(url), headers: init?.headers, body });
    const requestId = body.id;
    const name = body?.params?.name;
    const args = body?.params?.arguments ?? {};

    if (name === 'findTripCandidates') {
      assert.deepEqual(args, { placeHint: 'USA' });
      return new Response(
        JSON.stringify({
          jsonrpc: '2.0',
          id: requestId,
          result: {
            structuredContent: {
              status: 'success',
              summary: `Found ${candidates.length} trip candidate(s) matching "USA".`,
              recommendation,
              candidates,
            },
          },
        }),
      );
    }

    if (name === 'proposeAlbumFromSelection') {
      assert.equal(args.albumName, 'USA Trip');
      assert.equal(args.selectionHandleId, strictTripCandidateHandleId);
      assert.equal(JSON.stringify(args).includes('assetIds'), false);
      return new Response(
        JSON.stringify({
          jsonrpc: '2.0',
          id: requestId,
          result: {
            structuredContent: planResponse,
          },
        }),
      );
    }

    return new Response(
      JSON.stringify({
        jsonrpc: '2.0',
        id: requestId,
        error: { code: -32601, message: `Unexpected tool ${name}` },
      }),
      { status: 200 },
    );
  };

  return { calls, fetchImplementation };
};
```

Append these tests inside `describe('pi runtime adapter', ...)` near the existing message-streaming tests:

```js
it('routes strict recent-trip album prompts through MCP before provider orchestration', async () => {
  const { sdk, ai, calls, session } = createFakeDependencies({
    mcpToolNames: ['mcp_gallery_findTripCandidates', 'mcp_gallery_proposeAlbumFromSelection'],
  });
  const { calls: mcpCalls, fetchImplementation } = createStrictWorkflowFetch();
  const runtime = createPiRuntime({ sdk, ai, fetch: fetchImplementation });
  await runtime.createSession(createSessionBody({ mcpGateway: createMcpGateway() }));

  const events = await collect(
    runtime.sendMessage(
      createMessageRequest({
        content: { blocks: [{ type: 'text', text: 'Create an album for my recent trip to USA' }] },
      }),
    ),
  );

  assert.equal(calls.prompts.length, 0);
  assert.equal(mcpCalls.map((call) => call.body.params.name).join(','), 'findTripCandidates,proposeAlbumFromSelection');
  assert.deepEqual(
    mcpCalls.map((call) => call.body.method),
    ['tools/call', 'tools/call'],
  );
  assert.equal(mcpCalls[0].headers.Authorization, 'Bearer mcp-token-secret');
  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'assistant-message-completed');
  assert.equal(events[0].sessionId, '00000000-0000-4000-8000-000000000100');
  assert.equal(events[0].runnerSessionId, 'pi-00000000-0000-4000-8000-000000000100');
  assert.equal(events[0].providerMessageId, null);
  assert.match(events[0].content.blocks[0].text, /May 3-12, 2026/);
  assert.match(events[0].content.blocks[0].text, /28 assets/);
  assert.match(events[0].content.blocks[0].text, /skipped 3 known duplicate variants and 1 stack child/i);
  assert.match(events[0].content.blocks[0].text, /Review the plan before applying it/);
  assert.equal(
    session.messages.some(
      (message) => message.role === 'user' && message.content[0].text.includes('recent trip to USA'),
    ),
    true,
  );
  assert.equal(
    session.messages.some(
      (message) => message.role === 'assistant' && message.content[0].text.includes('Review the plan'),
    ),
    true,
  );
});

it('leaves unsupported prompts on open provider orchestration', async () => {
  const { sdk, ai, calls } = createFakeDependencies({
    mcpToolNames: ['mcp_gallery_findTripCandidates', 'mcp_gallery_proposeAlbumFromSelection'],
  });
  const { calls: mcpCalls, fetchImplementation } = createStrictWorkflowFetch();
  const runtime = createPiRuntime({ sdk, ai, fetch: fetchImplementation });
  await runtime.createSession(createSessionBody({ mcpGateway: createMcpGateway() }));

  const events = await collect(
    runtime.sendMessage(createMessageRequest({ content: { blocks: [{ type: 'text', text: 'Organize my photos.' }] } })),
  );

  assert.deepEqual(mcpCalls, []);
  assert.deepEqual(calls.prompts, ['Organize my photos.']);
  assert.equal(events.at(-1).type, 'assistant-message-completed');
});

it('keeps a strict handled Pi runner session usable for a later open prompt', async () => {
  const { sdk, ai, calls } = createFakeDependencies({
    mcpToolNames: ['mcp_gallery_findTripCandidates', 'mcp_gallery_proposeAlbumFromSelection'],
  });
  const { fetchImplementation } = createStrictWorkflowFetch();
  const runtime = createPiRuntime({ sdk, ai, fetch: fetchImplementation });
  await runtime.createSession(createSessionBody({ mcpGateway: createMcpGateway() }));

  const strictEvents = await collect(
    runtime.sendMessage(
      createMessageRequest({
        content: { blocks: [{ type: 'text', text: 'Create an album for my recent trip to USA' }] },
      }),
    ),
  );
  const openEvents = await collect(
    runtime.sendMessage(
      createMessageRequest({
        messageId: '00000000-0000-4000-8000-000000000201',
        content: { blocks: [{ type: 'text', text: 'How many albums do I have?' }] },
      }),
    ),
  );

  assert.equal(strictEvents.at(-1).type, 'assistant-message-completed');
  assert.deepEqual(calls.prompts, ['How many albums do I have?']);
  assert.equal(openEvents.at(-1).type, 'assistant-message-completed');
});

it('pauses production strict recent-trip planning when the proposal needs approval', async () => {
  const { sdk, ai, calls } = createFakeDependencies({
    mcpToolNames: ['mcp_gallery_findTripCandidates', 'mcp_gallery_proposeAlbumFromSelection'],
  });
  const { calls: mcpCalls, fetchImplementation } = createStrictWorkflowFetch({
    planResponse: {
      status: 'approval-required',
      toolCall: { id: '00000000-0000-4000-8000-000000000999' },
    },
  });
  const runtime = createPiRuntime({ sdk, ai, fetch: fetchImplementation });
  await runtime.createSession(createSessionBody({ mcpGateway: createMcpGateway() }));

  const events = await collect(
    runtime.sendMessage(
      createMessageRequest({
        content: { blocks: [{ type: 'text', text: 'Create an album for my recent trip to USA' }] },
      }),
    ),
  );

  assert.equal(calls.prompts.length, 0);
  assert.equal(mcpCalls.map((call) => call.body.params.name).join(','), 'findTripCandidates,proposeAlbumFromSelection');
  assert.deepEqual(events, [
    {
      type: 'tool-approval-needed',
      sessionId: '00000000-0000-4000-8000-000000000100',
      runnerSessionId: 'pi-00000000-0000-4000-8000-000000000100',
      toolCallId: '00000000-0000-4000-8000-000000000999',
    },
  ]);
});
```

- [x] **Step 1a: Add strict hardening regression tests**

Added TDD coverage for review hardening findings:

- `strict-workflows.test.mjs` proves `runCreateRecentTripAlbumWorkflow` forwards an optional abort signal to both `findTripCandidates` and `proposeAlbumFromSelection`.
- `pi-runtime.test.mjs` proves disposing a runner session aborts an in-flight strict MCP fetch and that a deterministic replacement session can be created and used afterward.
- `pi-runtime.test.mjs` proves direct MCP HTTP non-OK bodies, invalid JSON response text, JSON-RPC error messages, and MCP `isError` text do not leak raw `Bearer other-secret` or `api_key=raw-key` strings through runner events.
- Planning-call variants of the same four MCP error paths prove workflow-converted assistant failure text is generic and secret-free.
- Structured planning failure tests prove `proposeAlbumFromSelection` `status: "denied"` and `status: "error"` results do not leak raw `reason`, `message`, or `error` fields to assistant output.

- [x] **Step 2: Run tests and verify red**

Run:

```bash
pnpm --dir agent-runner test
```

Expected: FAIL. The new tests fail because `createPiRuntime` does not accept an injected `fetch`, strict prompts still call `session.prompt`, and no production direct MCP client exists.

- [x] **Step 3: Import strict workflow helpers**

At the top of `agent-runner/src/pi-runtime.mjs`, add:

```js
import { matchStrictWorkflow, runCreateRecentTripAlbumWorkflow } from './strict-workflows.mjs';
```

- [x] **Step 4: Add direct MCP JSON-RPC helper functions**

In `agent-runner/src/pi-runtime.mjs`, add these helpers near `redactSecrets` / content parsing helpers:

```js
const extractMcpTextContent = (result) =>
  result?.content
    ?.filter((part) => part?.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text)
    .join('\n')
    .trim() ?? '';

const parseGalleryMcpToolResult = (result, name, gateway) => {
  if (result?.isError) {
    const message = extractMcpTextContent(result) || `MCP tool ${name} returned an error`;
    throw new Error(redactSecret(message, gateway?.token));
  }

  if (result?.structuredContent !== undefined) {
    return result.structuredContent;
  }

  const text = extractMcpTextContent(result);
  if (text.length === 0) {
    return {};
  }

  try {
    return JSON.parse(text);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(redactSecret(`Invalid MCP tool result JSON for ${name}: ${message}: ${text}`, gateway?.token));
  }
};

const createGalleryMcpClient = ({ gateway, fetch: fetchImplementation }) => {
  let nextId = 1;

  return {
    async call(name, args, { signal } = {}) {
      const id = nextId++;
      const response = await fetchImplementation(gateway.url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${gateway.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id,
          method: 'tools/call',
          params: { name, arguments: args ?? {} },
        }),
        signal,
      });

      const text = await response.text();
      if (!response.ok) {
        const bodyDetails = text.length === 0 ? '' : `: ${text}`;
        throw new Error(
          redactSecret(`Gallery MCP request failed with status ${response.status}${bodyDetails}`, gateway.token),
        );
      }

      let envelope;
      try {
        envelope = text.length === 0 ? {} : JSON.parse(text);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(redactSecret(`Invalid Gallery MCP JSON-RPC response: ${message}: ${text}`, gateway.token));
      }

      if (envelope?.error) {
        const code = envelope.error.code === undefined ? 'unknown' : envelope.error.code;
        const message = envelope.error.message ?? JSON.stringify(envelope.error);
        throw new Error(redactSecret(`Gallery MCP JSON-RPC error ${code}: ${message}`, gateway.token));
      }

      return parseGalleryMcpToolResult(envelope?.result, name, gateway);
    },
  };
};
```

- [x] **Step 5: Add strict transcript and event helpers**

In `agent-runner/src/pi-runtime.mjs`, add:

```js
const appendStrictWorkflowTranscript = (session, prompt, assistantText) => {
  if (!Array.isArray(session.messages)) {
    return;
  }

  session.messages.push({ role: 'user', content: [{ type: 'text', text: prompt }] });
  if (assistantText) {
    session.messages.push({ role: 'assistant', content: [{ type: 'text', text: assistantText }] });
  }
};

const strictCompletedEvent = ({ gallerySessionId, runnerSessionId, text }) => ({
  type: 'assistant-message-completed',
  sessionId: gallerySessionId,
  runnerSessionId,
  providerMessageId: null,
  content: { blocks: [{ type: 'text', text }] },
});

const strictApprovalEvent = ({ gallerySessionId, runnerSessionId, toolCallId }) => ({
  type: 'tool-approval-needed',
  sessionId: gallerySessionId,
  runnerSessionId,
  toolCallId,
});
```

- [x] **Step 6: Store gateway and inject fetch**

Change the runtime factory signature in `agent-runner/src/pi-runtime.mjs`:

```js
export const createPiRuntime = ({
  sdk = defaultDependencies.sdk,
  ai = defaultDependencies.ai,
  fetch: fetchImplementation = fetch,
} = {}) => {
```

In the `sessions.set(...)` object in `createSession`, add:

```js
            mcpGateway,
```

- [x] **Step 7: Add the strict workflow fast path in `sendMessage`**

Inside `sendMessage`, immediately after `entry.inFlight = true;`, add:

```js
      const promptText = textPromptFromContent(content);
      const strictWorkflow = matchStrictWorkflow(promptText);
      if (strictWorkflow.kind === 'create_recent_trip_album' && entry.mcpGateway) {
        try {
          const workflowResult = await runCreateRecentTripAlbumWorkflow({
            client: createGalleryMcpClient({ gateway: entry.mcpGateway, fetch: fetchImplementation }),
            workflow: strictWorkflow,
          });

          if (workflowResult.status === 'approval_required') {
            yield strictApprovalEvent({
              gallerySessionId,
              runnerSessionId,
              toolCallId: workflowResult.toolCallId,
            });
            return;
          }

          appendStrictWorkflowTranscript(entry.session, promptText, workflowResult.text);
          yield strictCompletedEvent({
            gallerySessionId,
            runnerSessionId,
            text: workflowResult.text,
          });
          return;
        } catch (error) {
          yield {
            type: 'runner-error',
            sessionId: gallerySessionId,
            runnerSessionId,
            message: sanitizeSessionError(error, entry),
          };
          return;
        } finally {
          entry.inFlight = false;
        }
      }
```

Then replace the provider prompt call later in `sendMessage`:

```js
return entry.session.prompt(textPromptFromContent(content));
```

with:

```js
return entry.session.prompt(promptText);
```

Important control-flow requirement: this strict fast path must run before `entry.session.subscribe(...)` so no provider deltas or provider prompt happen for strict handled turns. The existing provider path `finally` must continue to clear `entry.inFlight`; the strict fast path clears it in its own `finally`.

- [x] **Step 8: Run tests and verify green**

Run:

```bash
pnpm --dir agent-runner test
```

Expected: PASS. Production strict prompt tests pass, existing Pi streaming/approval tests still pass, and strict workflow/e2e tests stay green.

- [x] **Step 9: Check for future-slice drift**

Run:

```bash
git diff -- agent-runner/src/pi-runtime.mjs agent-runner/src/pi-runtime.test.mjs
```

Expected:

- No durable pending candidate selection state.
- No strict follow-up candidate selection implementation.
- No strict approval resume implementation beyond emitting `tool-approval-needed`.
- No direct apply/write tool.
- Unsupported prompts still use `entry.session.prompt(...)`.

- [x] **Step 10: Commit Slice 5**

Run:

```bash
git add agent-runner/src/pi-runtime.mjs agent-runner/src/pi-runtime.test.mjs docs/superpowers/plans/2026-05-28-pi-agent-strict-recent-trip-album-slice-5.md
git commit -m "feat: route strict recent trip workflow in pi runtime"
```

Expected: commit succeeds.

## Plan Self-Review

- Spec coverage: every Slice 5 requirement maps to a production `pi-runtime` test.
- TDD order: tests are added before production routing/client code, with an explicit red run.
- Scope: no Slice 6 durable continuation state or candidate follow-up handling is included.
- Type consistency: workflow statuses remain `planned`, `needs_input`, `failed`, and `approval_required`; tool names are unprefixed MCP contract names (`findTripCandidates`, `proposeAlbumFromSelection`) because JSON-RPC `tools/call` expects `AgentToolName` values.
- Placeholder scan: no TODO/TBD placeholders.
