# Pi Agent MCP Minimal Context Slice 5 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable Pi runner compaction and prevent large Gallery MCP tool results from being replayed into later model turns.

**Architecture:** Keep Gallery MCP result compaction inside `agent-runner`, because that is where Pi SDK session state and approval-resume prompts are assembled. Enable Pi SDK compaction for every Gallery runner session, compact oversized Gallery tool transcript entries before each model call, and compact approved tool results before injecting them into the approval-resume prompt.

**Tech Stack:** Node ESM runner, Pi SDK session/settings APIs, Node test runner, Gallery NestJS runner service tests, SSE runner server tests.

---

## Scope

Slice 5 implements only:

- Pi runner compaction settings for Gallery sessions.
- Runner-owned compaction of large Gallery tool-result transcript entries.
- Compact approval-resume summaries for large approved tool results.
- Actionable context-window and compaction-failure runner errors.
- Regression tests proving streaming deltas and runner activity still pass through.

Slice 5 does not implement:

- new MCP prompt examples or generated docs from Slice 6;
- large selection handles from Slice 7;
- changing MCP response DTOs from Slices 1-4;
- UI changes beyond existing runner-error propagation.

## Decisions

- The runner enables Pi SDK compaction with `SettingsManager.inMemory({ compaction: { enabled: true } })`.
- Gallery also performs a defensive compaction pass because approved tool results and old MCP transcript entries can still be too large before the SDK compactor gets a useful chance to act.
- Compaction keeps the fields the model needs to continue safely: `status`, `summary`, `toolCall.id`, `toolCall.toolName`, `toolCall.status`, `resultSize`, `planId`, `operationIds`, and counts for large arrays.
- Compaction drops row-level metadata, preview payloads, original-file details, filenames, EXIF blobs, and other large arrays once the serialized value is over the runner prompt budget.
- Compaction does not preserve raw result `summary` text for compacted results because summaries can contain filenames, raw paths, or bulky metadata. It synthesizes a bounded summary from status, tool name, counts, and result-size metadata instead.
- The compact summary explicitly tells Pi to request omitted fields with the smallest Gallery MCP read call if it later needs missing detail.
- Approval-required tool results remain parseable after compaction by preserving `status: "approval-required"` and `toolCall.id`.
- Plan references include both top-level `planId`/`operationIds` and nested `plan.id`/`plan.operations[*].id` from actual planning responses.
- Unknown runner sessions after a runner restart keep the phrase `Runner session not found` but add an actionable reconnect hint.
- Context-window and compaction provider failures are normalized to an actionable message and still go through the existing server runner-error path.

## Files

- Modify: `agent-runner/src/pi-runtime.mjs`
  - Enable Pi SDK compaction in session settings.
  - Add helpers for safe JSON stringifying, compact Gallery result summaries, transcript compaction, and actionable context-window error messages. Export only the helpers that tests need directly.
  - Run transcript compaction before `sendMessage()` prompts and before approval resume prompts or continuation calls.
  - Use compact approved-result summaries inside `approvalResumePrompt()`.
- Modify: `agent-runner/src/pi-runtime.test.mjs`
  - Add failing tests for compaction settings, large transcript compaction, pending approval preservation, approval-resume summary compaction, context-window errors, compaction failures, omitted-field guidance, and streaming deltas.
- Modify: `agent-runner/src/server.test.mjs`
  - Add an SSE regression proving activity events and deltas still flow through an approval-resume request that carries a large tool result.
- Modify: `server/src/services/agent-runner.service.spec.ts`
  - Add a focused regression proving actionable context-window runner errors are emitted to the Gallery websocket unchanged.

## Contract

Large tool results are compacted to a shape like:

```js
{
  status: 'success',
  summary: 'Gallery mcp_gallery_readAssetMetadata result (success) was compacted before continuing. 500 items',
  compacted: true,
  compactedReason: 'Large Gallery tool result exceeded runner prompt budget.',
  toolCall: {
    id: '00000000-0000-4000-8000-000000000333',
    toolName: 'mcp_gallery_readAssetMetadata',
    status: 'completed',
    resultSize: {
      returnedItems: 500,
      hasMore: false,
      nextPage: null,
      estimatedBytes: 180000,
      truncated: true,
      omittedFields: ['assets.filename', 'assets.exif'],
    },
  },
  resultSize: {
    returnedItems: 500,
    hasMore: false,
    nextPage: null,
    estimatedBytes: 180000,
    truncated: true,
    omittedFields: ['assets.filename', 'assets.exif'],
  },
  counts: {
    assets: 500,
    albums: 0,
    spaces: 0,
    operationIds: 0,
  },
  ids: {
    assetIdsSample: ['asset-1', 'asset-2'],
    albumIdsSample: [],
    operationIdsSample: [],
  },
  plan: {
    planId: '00000000-0000-4000-8000-000000000444',
    operationCount: 4,
  },
  omittedDetailInstruction:
    'Detailed rows were omitted. If more detail is needed, call the smallest Gallery MCP read tool for specific ids and fields.',
}
```

The exact fields can be smaller when the original result has less information, but the compacted value must stay JSON serializable, safe to inject into a model prompt, and below the runner summary budget for normal inputs.

## Task 1: Enable Pi SDK Compaction

**Files:**

- Modify: `agent-runner/src/pi-runtime.test.mjs`
- Modify: `agent-runner/src/pi-runtime.mjs`

- [ ] **Step 1: Write the failing settings test**

In `agent-runner/src/pi-runtime.test.mjs`, add this assertion to the existing `constructs the Pi resource loader with concrete runtime paths` test after `assert.deepEqual(calls.loaders[0].appendSystemPrompt, []);`:

```js
assert.deepEqual(calls.loaders[0].settingsManager, {
  kind: 'settings-manager',
  settings: { compaction: { enabled: true } },
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run:

```bash
pnpm --dir agent-runner exec node --test src/pi-runtime.test.mjs
```

Expected: the test fails because `settings.compaction.enabled` is currently `false`.

- [ ] **Step 3: Enable compaction in the runner**

In `agent-runner/src/pi-runtime.mjs`, change the settings manager creation:

```js
const settingsManager = sdk.SettingsManager.inMemory({
  compaction: { enabled: true },
});
```

- [ ] **Step 4: Run the focused runner test**

Run:

```bash
pnpm --dir agent-runner exec node --test src/pi-runtime.test.mjs
```

Expected: the settings test passes and existing runner runtime tests still pass.

## Task 2: Compact Large Gallery Tool Transcript Entries Before Model Calls

**Files:**

- Modify: `agent-runner/src/pi-runtime.test.mjs`
- Modify: `agent-runner/src/pi-runtime.mjs`

- [ ] **Step 1: Write failing tests for transcript compaction**

Update the import in `agent-runner/src/pi-runtime.test.mjs`:

```js
import { compactGalleryToolTranscript, createPiRuntime, mapProviderType, redactSecret } from './pi-runtime.mjs';
```

Add these tests near the existing message-streaming tests:

```js
it('compacts large prior Gallery tool result messages before the next user prompt', async () => {
  const { sdk, ai, calls, session } = createFakeDependencies();
  const hugeAssets = Array.from({ length: 300 }, (_, index) => ({
    id: `asset-${index}`,
    filename: `IMG-${index}.jpg`,
    exif: 'x'.repeat(300),
  }));
  session.messages.push({
    role: 'tool',
    content: [
      {
        type: 'text',
        text: JSON.stringify({
          status: 'success',
          summary: 'Returned 300 rows including IMG-299.jpg from /photos/private/originals/IMG-299.jpg',
          toolCall: {
            id: '00000000-0000-4000-8000-000000000333',
            toolName: 'mcp_gallery_readAssetMetadata',
            status: 'completed',
          },
          assets: hugeAssets,
          resultSize: {
            returnedItems: 300,
            hasMore: false,
            nextPage: null,
            estimatedBytes: 120000,
            truncated: false,
            omittedFields: [],
          },
        }),
      },
    ],
  });
  const runtime = createPiRuntime({ sdk, ai });
  await runtime.createSession(createSessionBody());

  await collect(runtime.sendMessage(createMessageRequest()));

  const compacted = JSON.parse(session.messages[0].content[0].text);
  assert.equal(compacted.status, 'success');
  assert.equal(compacted.compacted, true);
  assert.equal(compacted.toolCall.id, '00000000-0000-4000-8000-000000000333');
  assert.equal(compacted.counts.assets, 300);
  assert.match(compacted.omittedDetailInstruction, /smallest Gallery MCP read tool/);
  assert.equal(session.messages[0].content[0].text.includes('IMG-299.jpg'), false);
  assert.equal(session.messages[0].content[0].text.includes('/photos/private/originals'), false);
  assert.ok(session.messages[0].content[0].text.length < 8000);
  assert.deepEqual(calls.prompts, ['Organize my photos.']);
});

it('preserves pending approval state when compacting a large approval-required tool result', () => {
  const messages = [
    {
      role: 'tool',
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            status: 'approval-required',
            summary: 'Approval required to read 300 previews',
            toolCall: {
              id: '00000000-0000-4000-8000-000000000333',
              toolName: 'mcp_gallery_readAssetPreviews',
              status: 'pending-approval',
            },
            previews: Array.from({ length: 300 }, (_, index) => ({
              id: `asset-${index}`,
              thumbhash: 'x'.repeat(300),
            })),
          }),
        },
      ],
    },
  ];

  compactGalleryToolTranscript({ messages });

  const compacted = JSON.parse(messages[0].content[0].text);
  assert.equal(compacted.status, 'approval-required');
  assert.equal(compacted.toolCall.id, '00000000-0000-4000-8000-000000000333');
  assert.equal(compacted.toolCall.status, 'pending-approval');
  assert.equal(compacted.compacted, true);
  assert.equal(messages[0].content[0].text.includes('thumbhash'), false);
});
```

- [ ] **Step 2: Run the tests and verify they fail**

Run:

```bash
pnpm --dir agent-runner exec node --test src/pi-runtime.test.mjs
```

Expected: import fails because `compactGalleryToolTranscript` does not exist, or assertions fail because the huge tool result remains unmodified.

- [ ] **Step 3: Implement compact transcript helpers**

In `agent-runner/src/pi-runtime.mjs`, add helpers above `approvalResumePrompt()`:

```js
const galleryToolResultPromptBudgetBytes = 16_000;
const compactedGalleryToolTextBudgetBytes = 8_000;

const safeJsonStringify = (value) => {
  try {
    return JSON.stringify(value);
  } catch {
    return undefined;
  }
};

const byteLength = (value) => Buffer.byteLength(value, 'utf8');

const countArray = (value, key) => (Array.isArray(value?.[key]) ? value[key].length : 0);
const sampleIds = (items) =>
  Array.isArray(items)
    ? items
        .map((item) => (typeof item === 'string' ? item : item?.id))
        .filter((id) => typeof id === 'string')
        .slice(0, 10)
    : [];

const isGalleryToolResult = (value) =>
  value &&
  typeof value === 'object' &&
  typeof value.status === 'string' &&
  (value.toolCall || value.resultSize || typeof value.summary === 'string');

export const compactGalleryToolResultForPrompt = (toolResult, { force = false } = {}) => {
  const serialized = safeJsonStringify(toolResult);
  if (!force && serialized && byteLength(serialized) <= galleryToolResultPromptBudgetBytes) {
    return toolResult;
  }

  if (!toolResult || typeof toolResult !== 'object') {
    return {
      status: 'success',
      compacted: true,
      summary: 'Gallery returned a non-object tool result that was compacted before continuing.',
      omittedDetailInstruction:
        'Detailed rows were omitted. If more detail is needed, call the smallest Gallery MCP read tool for specific ids and fields.',
    };
  }

  const resultSize = toolResult.resultSize ?? toolResult.toolCall?.resultSize;
  const operationIds = Array.isArray(toolResult.operationIds)
    ? toolResult.operationIds
    : Array.isArray(toolResult.operations)
      ? toolResult.operations.map((operation) => operation?.id).filter((id) => typeof id === 'string')
      : [];

  return {
    status: toolResult.status,
    summary:
      typeof toolResult.summary === 'string'
        ? toolResult.summary
        : 'Gallery tool result was compacted before continuing.',
    compacted: true,
    compactedReason: 'Large Gallery tool result exceeded runner prompt budget.',
    toolCall: toolResult.toolCall
      ? {
          id: toolResult.toolCall.id,
          toolName: toolResult.toolCall.toolName,
          status: toolResult.toolCall.status,
          resultSize: toolResult.toolCall.resultSize,
        }
      : undefined,
    resultSize,
    counts: {
      assets: countArray(toolResult, 'assets') || countArray(toolResult, 'assetIds'),
      albums: countArray(toolResult, 'albums') || countArray(toolResult, 'albumIds'),
      spaces: countArray(toolResult, 'spaces') || countArray(toolResult, 'spaceIds'),
      users: countArray(toolResult, 'users') || countArray(toolResult, 'userIds'),
      operationIds: operationIds.length,
    },
    ids: {
      assetIdsSample: sampleIds(toolResult.assetIds ?? toolResult.assets),
      albumIdsSample: sampleIds(toolResult.albumIds ?? toolResult.albums),
      spaceIdsSample: sampleIds(toolResult.spaceIds ?? toolResult.spaces),
      userIdsSample: sampleIds(toolResult.userIds ?? toolResult.users),
      operationIdsSample: operationIds.slice(0, 10),
    },
    plan:
      typeof toolResult.planId === 'string' || typeof toolResult.plan?.id === 'string'
        ? {
            planId: toolResult.planId ?? toolResult.plan?.id,
            operationCount:
              typeof toolResult.operationCount === 'number'
                ? toolResult.operationCount
                : Array.isArray(toolResult.operations)
                  ? toolResult.operations.length
                  : undefined,
          }
        : undefined,
    omittedDetailInstruction:
      'Detailed rows were omitted. If more detail is needed, call the smallest Gallery MCP read tool for specific ids and fields.',
  };
};

export const compactGalleryToolTranscript = (session) => {
  const messages = Array.isArray(session?.messages) ? session.messages : [];
  for (const message of messages) {
    if (message?.role !== 'tool' || !Array.isArray(message.content)) {
      continue;
    }

    for (const block of message.content) {
      if (block?.type !== 'text' || typeof block.text !== 'string') {
        continue;
      }

      const parsed = parseJsonObject(block.text);
      if (!isGalleryToolResult(parsed)) {
        continue;
      }

      const serialized = safeJsonStringify(parsed);
      if (serialized && byteLength(serialized) <= galleryToolResultPromptBudgetBytes) {
        continue;
      }

      const compacted = compactGalleryToolResultForPrompt(parsed, { force: true });
      const compactedText = safeJsonStringify(compacted);
      block.text =
        compactedText && byteLength(compactedText) <= compactedGalleryToolTextBudgetBytes
          ? compactedText
          : JSON.stringify({
              status: parsed.status,
              summary: parsed.summary ?? 'Gallery tool result was compacted before continuing.',
              compacted: true,
              toolCall: compacted.toolCall,
              resultSize: compacted.resultSize,
              omittedDetailInstruction: compacted.omittedDetailInstruction,
            });
    }
  }
};
```

The implementation may factor helper code differently, but it must preserve the same behavior and exported names used by the tests.

- [ ] **Step 4: Run compaction before model calls**

In `sendMessage()`, immediately before `entry.session.prompt(textPromptFromContent(content))`, add:

```js
compactGalleryToolTranscript(entry.session);
```

In `resumeSession()`, immediately before the `if (resumePrompt) { return entry.session.prompt(resumePrompt); }` branch, add:

```js
compactGalleryToolTranscript(entry.session);
```

- [ ] **Step 5: Run the focused runner tests**

Run:

```bash
pnpm --dir agent-runner exec node --test src/pi-runtime.test.mjs
```

Expected: the new transcript-compaction tests pass and existing runtime tests still pass.

## Task 3: Compact Approved Tool Results In Resume Prompts

**Files:**

- Modify: `agent-runner/src/pi-runtime.test.mjs`
- Modify: `agent-runner/src/pi-runtime.mjs`

- [ ] **Step 1: Write failing approval-resume compaction tests**

Add these tests near the existing approval-resume tests:

```js
it('resumes approval with a compact approved result summary instead of replaying a large raw result', async () => {
  const { sdk, ai, calls } = createFakeDependencies();
  const runtime = createPiRuntime({ sdk, ai });
  await runtime.createSession(createSessionBody());
  const largeResult = {
    status: 'success',
    summary: 'Created plan for 500 photos including IMG-499.jpg from /photos/private/originals/IMG-499.jpg',
    toolCall: {
      id: '00000000-0000-4000-8000-000000000333',
      toolName: 'mcp_gallery_proposeAlbumOperations',
      status: 'completed',
    },
    plan: {
      id: '00000000-0000-4000-8000-000000000444',
      operations: Array.from({ length: 500 }, (_, index) => ({
        id: `operation-${index}`,
        assetId: `asset-${index}`,
        filename: `IMG-${index}.jpg`,
        rationale: 'x'.repeat(300),
      })),
    },
    resultSize: {
      returnedItems: 500,
      hasMore: false,
      nextPage: null,
      estimatedBytes: 220000,
      truncated: false,
      omittedFields: [],
    },
  };

  const events = await collect(
    runtime.resumeSession({
      runnerSessionId: 'pi-00000000-0000-4000-8000-000000000100',
      gallerySessionId: '00000000-0000-4000-8000-000000000100',
      toolCallId: '00000000-0000-4000-8000-000000000333',
      approvalDecision: 'approved',
      toolResult: largeResult,
    }),
  );

  assert.equal(calls.continues, 0);
  assert.equal(calls.prompts.length, 1);
  assert.match(calls.prompts[0], /compact approved tool result summary/i);
  assert.match(calls.prompts[0], /00000000-0000-4000-8000-000000000444/);
  assert.match(calls.prompts[0], /operation-0/);
  assert.match(calls.prompts[0], /"operationIds":500/);
  assert.match(calls.prompts[0], /smallest Gallery MCP read tool/);
  assert.equal(calls.prompts[0].includes('IMG-499.jpg'), false);
  assert.equal(calls.prompts[0].includes('/photos/private/originals'), false);
  assert.ok(calls.prompts[0].length < 10000);
  assert.equal(events[0].type, 'assistant-message-delta');
  assert.equal(events.at(-1).type, 'assistant-message-completed');
});

it('summarizes non-serializable approved results instead of failing approval resume', async () => {
  const { sdk, ai, calls } = createFakeDependencies();
  const runtime = createPiRuntime({ sdk, ai });
  await runtime.createSession(createSessionBody());
  const circularResult = { status: 'success', summary: 'Circular result' };
  circularResult.self = circularResult;

  await collect(
    runtime.resumeSession({
      runnerSessionId: 'pi-00000000-0000-4000-8000-000000000100',
      gallerySessionId: '00000000-0000-4000-8000-000000000100',
      toolCallId: '00000000-0000-4000-8000-000000000333',
      approvalDecision: 'approved',
      toolResult: circularResult,
    }),
  );

  assert.equal(calls.prompts.length, 1);
  assert.match(calls.prompts[0], /compact approved tool result summary/i);
  assert.equal(calls.prompts[0].includes('[Circular]'), false);
});
```

- [ ] **Step 2: Run the tests and verify they fail**

Run:

```bash
pnpm --dir agent-runner exec node --test src/pi-runtime.test.mjs
```

Expected: the large approval prompt contains raw operation filenames or the circular result throws during `JSON.stringify()`.

- [ ] **Step 3: Update `approvalResumePrompt()` to use compact summaries**

In `agent-runner/src/pi-runtime.mjs`, change the approved-result branch:

```js
if (toolResult !== undefined) {
  const compactedToolResult = compactGalleryToolResultForPrompt(toolResult);
  return [
    'This is an internal Gallery resume instruction, not a new user request.',
    `The previous approval-required response for Gallery tool call ${toolCallId} is obsolete.`,
    `The user approved Gallery tool call ${toolCallId}, and Gallery already executed it successfully.`,
    `Use this compact approved tool result summary as authoritative data to continue the user's original request: ${safeJsonStringify(compactedToolResult) ?? JSON.stringify(compactGalleryToolResultForPrompt(undefined, { force: true }))}.`,
    'If the summary says fields were omitted and the original request needs them, call the smallest Gallery MCP read tool for specific ids and fields.',
    'Do not mention pending approval or ask for approval again for this same tool result.',
    'If the original request still needs album details after mcp_gallery_listAlbums, find the matching album id in the approved result and call mcp_gallery_readAlbum. If it needs asset metadata or search, call the next appropriate Gallery MCP read tool.',
  ].join(' ');
}
```

Keep the existing denied branch unchanged.

- [ ] **Step 4: Run the focused runtime tests**

Run:

```bash
pnpm --dir agent-runner exec node --test src/pi-runtime.test.mjs
```

Expected: approval-resume tests pass, including the older small-result test that still sees useful album detail such as `Test Pierre`.

## Task 4: Surface Actionable Context And Compaction Errors

**Files:**

- Modify: `agent-runner/src/pi-runtime.test.mjs`
- Modify: `agent-runner/src/pi-runtime.mjs`
- Modify: `server/src/services/agent-runner.service.spec.ts`

- [ ] **Step 1: Write failing runner error tests**

In `agent-runner/src/pi-runtime.test.mjs`, add:

```js
it('surfaces context-window provider errors as actionable runner errors', async () => {
  const { sdk, ai, session } = createFakeDependencies();
  session.prompt = async () => {
    session.messages.push({
      role: 'assistant',
      content: [],
      stopReason: 'error',
      errorMessage:
        'Your input exceeds the context window of this model. Please adjust your input and try again. sk-openai-secret',
    });
  };
  const runtime = createPiRuntime({ sdk, ai });
  await runtime.createSession(createSessionBody());

  const events = await collect(runtime.sendMessage(createMessageRequest()));

  assert.deepEqual(events, [
    {
      type: 'runner-error',
      sessionId: '00000000-0000-4000-8000-000000000100',
      runnerSessionId: 'pi-00000000-0000-4000-8000-000000000100',
      message:
        'The assistant hit the model context limit while processing Gallery data. Narrow the request or inspect fewer photos at a time.',
    },
  ]);
});

it('keeps runner restart errors actionable while preserving the existing not-found phrase', async () => {
  const { sdk, ai } = createFakeDependencies();
  const runtime = createPiRuntime({ sdk, ai });

  await assert.rejects(
    () =>
      collect(
        runtime.resumeSession({
          runnerSessionId: 'missing',
          gallerySessionId: '00000000-0000-4000-8000-000000000100',
          toolCallId: '00000000-0000-4000-8000-000000000333',
          approvalDecision: 'approved',
        }),
      ),
    /Runner session not found; start a new assistant chat to reconnect/,
  );
});

it('surfaces provider compaction refusal as an actionable runner error', async () => {
  const { sdk, ai, session } = createFakeDependencies();
  session.prompt = async () => {
    session.messages.push({
      role: 'assistant',
      content: [],
      stopReason: 'error',
      errorMessage: 'Provider refused the compaction request after summarization failed.',
    });
  };
  const runtime = createPiRuntime({ sdk, ai });
  await runtime.createSession(createSessionBody());

  const events = await collect(runtime.sendMessage(createMessageRequest()));

  assert.equal(
    events[0].message,
    'The assistant hit the model context limit while processing Gallery data. Narrow the request or inspect fewer photos at a time.',
  );
});
```

In `server/src/services/agent-runner.service.spec.ts`, add near the existing runner-reported provider failure test:

```ts
it('emits actionable context-window runner errors without replacing the runner message', async () => {
  const sessionId = '00000000-0000-4000-8000-000000000100';
  const runnerSessionId = 'runner-session-1';
  const messageId = '00000000-0000-4000-8000-000000000200';
  const content: AgentMessageContent = { blocks: [{ type: 'text', text: 'Find every photo in my library.' }] };
  const runnerMessage =
    'The assistant hit the model context limit while processing Gallery data. Narrow the request or inspect fewer photos at a time.';

  configRepository.getEnv.mockReturnValue({
    agent: {
      runnerUrl: 'http://agent-runner:4477',
      runnerHealthTimeoutMs: 3000,
      runnerMessageStreamTimeoutMs: 120_000,
    },
  } as never);
  agentRunnerRepository.streamMessage.mockReturnValue(
    streamEvents([
      {
        type: 'runner-error',
        sessionId,
        runnerSessionId,
        message: runnerMessage,
      },
    ]),
  );
  sessionRepository.markInterruptedFromActive.mockResolvedValue({} as never);

  await expect(sut.sendMessage({ userId, sessionId, runnerSessionId, messageId, content })).rejects.toThrow(
    runnerMessage,
  );

  expect(websocketRepository.clientSend).toHaveBeenCalledWith('on_agent_session_event', userId, {
    type: 'runner-error',
    sessionId,
    message: runnerMessage,
    createdAt: '2026-05-14T10:00:00.000Z',
  });
});
```

- [ ] **Step 2: Run the tests and verify they fail**

Run:

```bash
pnpm --dir agent-runner exec node --test src/pi-runtime.test.mjs
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-runner.service.spec.ts
```

Expected: the runtime still exposes the raw provider context-window message and unknown sessions only say `Runner session not found`.

- [ ] **Step 3: Implement actionable error mapping**

In `agent-runner/src/pi-runtime.mjs`, add:

```js
const contextWindowErrorPattern =
  /(context window|context length|maximum context|input exceeds|too many tokens|token limit)/i;
const compactionErrorPattern = /(compaction|summarization).*(failed|refused|rejected)/i;

const actionableRunnerErrorMessage = (message) => {
  if (contextWindowErrorPattern.test(message) || compactionErrorPattern.test(message)) {
    return 'The assistant hit the model context limit while processing Gallery data. Narrow the request or inspect fewer photos at a time.';
  }

  return message;
};
```

Change `sanitizedErrorMessageWithSecrets()`:

```js
const sanitizedErrorMessageWithSecrets = (error, secrets) => {
  const message = error instanceof Error ? error.message : String(error);
  const redacted = redactSecrets(message || 'Provider request failed', secrets);
  return actionableRunnerErrorMessage(redacted);
};
```

Change unknown-session errors in `sendMessage()` and `resumeSession()`:

```js
throw new Error('Runner session not found; start a new assistant chat to reconnect.');
```

- [ ] **Step 4: Run focused tests**

Run:

```bash
pnpm --dir agent-runner exec node --test src/pi-runtime.test.mjs
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-runner.service.spec.ts
```

Expected: both focused suites pass.

## Task 5: Verify Streaming And Activity Pass Through With Large Resume Bodies

**Files:**

- Modify: `agent-runner/src/server.test.mjs`

- [ ] **Step 1: Write failing or guarding SSE regression**

In `agent-runner/src/server.test.mjs`, add this test near the existing activity SSE test:

```js
it('passes activity and deltas through the approval resume SSE stream for large approved results', async () => {
  const runtime = createRuntime({
    async *resumeSession(body) {
      assert.equal(body.toolResult.assets.length, 300);
      yield {
        type: 'activity',
        sessionId: body.gallerySessionId,
        runnerSessionId: body.runnerSessionId,
        kind: 'tool-call-completed',
        status: 'running',
        summary: 'Continuing after approved Gallery result',
      };
      yield {
        type: 'assistant-message-delta',
        sessionId: body.gallerySessionId,
        runnerSessionId: body.runnerSessionId,
        delta: 'Continuing',
        sequence: 1,
      };
      yield {
        type: 'assistant-message-completed',
        sessionId: body.gallerySessionId,
        runnerSessionId: body.runnerSessionId,
        providerMessageId: null,
        content: { blocks: [{ type: 'text', text: 'Continuing after approval.' }] },
      };
    },
  });

  await withServer(runtime, async (baseUrl) => {
    await fetch(`${baseUrl}/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(createSessionBody()),
    });

    const response = await fetch(`${baseUrl}/sessions/pi-00000000-0000-4000-8000-000000000100/continue`, {
      method: 'POST',
      headers: { Accept: 'text/event-stream', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        gallerySessionId: '00000000-0000-4000-8000-000000000100',
        toolCallId: '00000000-0000-4000-8000-000000000333',
        approvalDecision: 'approved',
        toolResult: {
          status: 'success',
          assets: Array.from({ length: 300 }, (_, index) => ({ id: `asset-${index}`, filename: `IMG-${index}.jpg` })),
        },
      }),
    });

    assert.equal(response.status, 200);
    assert.deepEqual(await readSse(response), [
      {
        event: 'activity',
        data: {
          type: 'activity',
          sessionId: '00000000-0000-4000-8000-000000000100',
          runnerSessionId: 'pi-00000000-0000-4000-8000-000000000100',
          kind: 'tool-call-completed',
          status: 'running',
          summary: 'Continuing after approved Gallery result',
        },
      },
      {
        event: 'assistant-message-delta',
        data: {
          type: 'assistant-message-delta',
          sessionId: '00000000-0000-4000-8000-000000000100',
          runnerSessionId: 'pi-00000000-0000-4000-8000-000000000100',
          delta: 'Continuing',
          sequence: 1,
        },
      },
      {
        event: 'assistant-message-completed',
        data: {
          type: 'assistant-message-completed',
          sessionId: '00000000-0000-4000-8000-000000000100',
          runnerSessionId: 'pi-00000000-0000-4000-8000-000000000100',
          providerMessageId: null,
          content: { blocks: [{ type: 'text', text: 'Continuing after approval.' }] },
        },
      },
    ]);
  });
});
```

This test may already pass before production changes. Keep it because it locks the requirement that large resume bodies do not break SSE ordering or activity forwarding.

- [ ] **Step 2: Run the runner server tests**

Run:

```bash
pnpm --dir agent-runner exec node --test src/server.test.mjs
```

Expected: the new SSE regression passes.

## Task 6: Final Verification And Commit

**Files:**

- Verify all touched files.

- [ ] **Step 1: Run focused runner and server tests**

Run:

```bash
pnpm --dir agent-runner exec node --test src/pi-runtime.test.mjs src/server.test.mjs
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-runner.service.spec.ts
```

Expected: all focused tests pass.

- [ ] **Step 2: Run package checks**

Run:

```bash
pnpm --dir agent-runner test
pnpm --dir server run check
git diff --check
```

Expected: all commands pass with no whitespace errors.

- [ ] **Step 3: Review edge-case coverage**

Confirm the tests cover every Slice 5 edge case:

- Compaction fails: `summarizes non-serializable approved results instead of failing approval resume`.
- Tool approval is pending during compaction: `preserves pending approval state when compacting a large approval-required tool result`.
- Resume after approval with a large approved result: `resumes approval with a compact approved result summary instead of replaying a large raw result`.
- Session reload after runner restart: `keeps runner restart errors actionable while preserving the existing not-found phrase`.
- Provider refuses the compaction request or context window is exceeded: `surfaces context-window provider errors as actionable runner errors`.
- A compacted session later asks for omitted fields: approval and transcript compaction tests assert `smallest Gallery MCP read tool` guidance.
- Streaming deltas and activity events still flow: runtime approval-resume test asserts deltas, runner server test asserts activity plus delta ordering.

- [ ] **Step 4: Commit Slice 5**

Run:

```bash
git status --short
git add agent-runner/src/pi-runtime.mjs agent-runner/src/pi-runtime.test.mjs agent-runner/src/server.test.mjs server/src/services/agent-runner.service.spec.ts docs/superpowers/plans/2026-05-21-pi-agent-mcp-minimal-context-slice-5.md
git commit -m "feat: compact Pi runner tool context"
git push
```

Expected: commit and push succeed on `explore/pi-agent-brainstorm`.
