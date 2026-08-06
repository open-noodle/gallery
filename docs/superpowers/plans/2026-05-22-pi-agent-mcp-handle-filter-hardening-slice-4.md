# Pi Agent MCP Tool Failure Retry Guidance Slice 4 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Teach Pi that recoverable Gallery MCP validation/denied tool results should be retried with corrected arguments before telling the user there was an internal Gallery issue, while preserving approval pauses and surfacing unrecoverable provider errors as runner errors.

**Architecture:** This slice is guidance and runner-context hardening only. Do not auto-substitute handles server-side and do not add an automatic retry loop outside the model. Add compact retry guidance to the generated MCP prompt and the runner system prompt, and add runner adapter tests proving recoverable tool error context stays available to Pi.

**Tech Stack:** TypeScript/Nest prompt renderer tests, Node test runner for `agent-runner`, generated runner prompt module sync.

---

## Spec Context

Spec: `docs/superpowers/specs/2026-05-22-pi-agent-mcp-handle-filter-hardening-design.md`

Slice 4 requires:

- Runner guidance says validation/denied MCP results with correction hints are recoverable.
- Pi should retry `proposeAlbumOperations` with corrected arguments, especially the exact valid `selectionHandle.id`, before saying Gallery had an internal issue.
- First-pass validation mistakes must not be summarized as "internal Gallery issue".
- Approval-required tool results still pause the turn instead of prompting an immediate retry.
- Repeated corrected failure should produce a concise user-facing explanation.
- Unrecoverable provider errors must still surface as actionable runner errors.

## Files

- Modify: `server/src/services/agent-mcp-prompt.service.ts`
- Test: `server/src/services/agent-mcp-prompt.service.spec.ts`
- Generated: `agent-runner/src/generated/gallery-mcp-prompt-cheat-sheet.mjs`
- Modify: `agent-runner/src/pi-runtime.mjs`
- Test: `agent-runner/src/pi-runtime.test.mjs`

## Baseline

- [ ] **Step 1: Confirm Slice 3 baseline is green**

Run:

```bash
pnpm --dir server test src/services/agent-mcp-prompt.service.spec.ts src/services/agent-mcp.service.spec.ts src/services/agent-operation-plan.service.spec.ts
pnpm --dir agent-runner exec node --test src/pi-runtime.test.mjs
```

Expected: all tests pass before Slice 4 edits.

---

## Task 1: Add Prompt-Level Recoverable Retry Guidance

**Files:**

- Modify: `server/src/services/agent-mcp-prompt.service.spec.ts`
- Modify: `server/src/services/agent-mcp-prompt.service.ts`
- Generated: `agent-runner/src/generated/gallery-mcp-prompt-cheat-sheet.mjs`

- [ ] **Step 1: Write failing prompt tests**

Add a focused test near the existing validation recovery prompt coverage:

```ts
it('teaches Pi to retry recoverable validation and denied tool results before reporting internal failures', () => {
  const prompt = sut.generatePromptCheatSheet();

  expect(prompt).toContain('retry with corrected arguments');
  expect(prompt).toContain('Retry mcp_gallery_proposeAlbumOperations with the exact handle');
  expect(prompt).toContain('<selectionHandle.id from searchAssets>');
  expect(prompt).toContain('Do not call this an internal Gallery issue on the first failure');
  expect(prompt).toContain('If the corrected retry fails again, explain what is missing or blocked');
  expect(prompt).toContain('approval-required still pauses');
  expect(prompt.length).toBeLessThanOrEqual(3800);
});
```

In the same red phase, add the runner system prompt test from Task 2 Step 1 before changing production prompt text. This ensures both the prompt renderer and the Pi runner adapter fail for the missing guidance before implementation starts.

Run:

```bash
pnpm --dir server test src/services/agent-mcp-prompt.service.spec.ts
pnpm --dir agent-runner exec node --test src/pi-runtime.test.mjs
```

Expected red failure: the new retry guidance strings are missing from `AgentMcpPromptService` and the runner system prompt. Also update the generated-file sync test expectation if needed so it fails until the generated module is refreshed.

- [ ] **Step 2: Implement compact prompt guidance**

In `AgentMcpPromptService.generatePromptCheatSheet()`, replace the current broad validation line:

```ts
this.renderValidationRecoveryGuidance(validationMistake),
```

with a compact line from `renderValidationRecoveryGuidance()` that explicitly says:

- validation/denied results with `retryable`, `hint`, `exampleArguments`, or `recovery` are recoverable;
- retry with corrected arguments once when the correction is obvious;
- for invalid selection handles, retry `mcp_gallery_proposeAlbumOperations` with the exact valid `<selectionHandle.id from searchAssets>`;
- approval-required still pauses and must not be auto-retried;
- do not call first-pass validation mistakes an internal Gallery issue;
- after a corrected retry fails again, explain the missing or blocked condition.

Keep the prompt under the existing `3800` character limit. Prefer one concise line, for example:

```text
Recoverable errors: validation/denied with retryable+hint/exampleArguments/recovery -> retry with corrected arguments once. Invalid handle: Retry mcp_gallery_proposeAlbumOperations with the exact handle <selectionHandle.id from searchAssets>. approval-required still pauses. Do not call this an internal Gallery issue on first failure; if corrected retry fails again, explain what is missing or blocked.
```

Keep the existing correction hint from `validationMistake.hint` if it fits, or abbreviate it without dropping the `params.arguments` guidance.

- [ ] **Step 3: Regenerate the runner prompt module**

Run:

```bash
pnpm --dir server run sync:agent-mcp-prompt
```

If `dist/bin/sync-agent-mcp-prompt.js` is stale or missing, run `pnpm --dir server build` first, then rerun the sync script.

- [ ] **Step 4: Verify prompt tests are green**

Run:

```bash
pnpm --dir server test src/services/agent-mcp-prompt.service.spec.ts
```

Expected green result: new retry guidance appears in the rendered prompt and generated module stays in sync.

---

## Task 2: Add Runner System Prompt And Context Preservation Coverage

**Files:**

- Modify: `agent-runner/src/pi-runtime.test.mjs`
- Modify: `agent-runner/src/pi-runtime.mjs`

- [ ] **Step 1: Add or verify runner prompt test**

This test should already have been added during Task 1's red phase. If it was not, add it now, run it before production edits, and confirm it fails. Extend `constructs the Pi resource loader with concrete runtime paths` or add a separate test:

```mjs
it('passes recoverable Gallery MCP retry guidance to the Pi system prompt', async () => {
  const { sdk, ai, calls } = createFakeDependencies();
  const runtime = createPiRuntime({ sdk, ai });

  await runtime.createSession(createSessionBody({ mcpGateway: createMcpGateway() }));

  assert.match(calls.loaders[0].systemPrompt, /retry with corrected arguments/i);
  assert.match(calls.loaders[0].systemPrompt, /exact handle <selectionHandle\.id from searchAssets>/i);
  assert.match(calls.loaders[0].systemPrompt, /not an internal Gallery issue/i);
  assert.match(calls.loaders[0].systemPrompt, /approval-required.*pauses/i);
});
```

Run:

```bash
pnpm --dir agent-runner exec node --test src/pi-runtime.test.mjs
```

Expected red before implementation and green after Task 1: the runner behavior prompt or generated cheat sheet contains direct retry/internal-issue guidance.

- [ ] **Step 2: Write failing runner adapter context test**

Add a test that seeds a prior MCP tool message with an invalid-handle recoverable error, sends a new message, and asserts the correction context remains in the Pi session transcript before the prompt is called:

```mjs
it('keeps invalid-handle correction context available before the next Pi prompt', async () => {
  const { sdk, ai, calls, session } = createFakeDependencies();
  const realHandleId = '11111111-1111-4111-8111-111111111111';
  session.messages.push({
    role: 'tool',
    content: [
      {
        type: 'text',
        text: JSON.stringify({
          status: 'error',
          error: 'Selection handle is expired or not available for this session',
          toolName: 'proposeAlbumOperations',
          retryable: true,
          hint: `Retry proposeAlbumOperations with the exact handle ${realHandleId} if that is the intended search selection.`,
          recovery: {
            kind: 'invalid-selection-handle',
            attemptedSelectionHandleId: '00000000-0000-4000-8000-000000000333',
            looksLikeExamplePlaceholder: true,
            availableSelectionHandles: [
              {
                id: realHandleId,
                assetCount: 42,
                sourceToolCallId: null,
                createdAt: '2026-05-22T07:00:00.000Z',
                expiresAt: '2026-05-22T08:00:00.000Z',
              },
            ],
            instruction: 'Retry proposeAlbumOperations with a valid same-session selection handle.',
          },
        }),
      },
    ],
  });
  const originalPrompt = session.prompt.bind(session);
  session.prompt = async (text) => {
    const correction = JSON.parse(session.messages[0].content[0].text);
    assert.equal(correction.retryable, true);
    assert.equal(correction.recovery.availableSelectionHandles[0].id, realHandleId);
    assert.match(correction.hint, /Retry proposeAlbumOperations with the exact handle/);
    return originalPrompt(text);
  };
  const runtime = createPiRuntime({ sdk, ai });
  await runtime.createSession(createSessionBody({ mcpGateway: createMcpGateway() }));

  await collect(runtime.sendMessage(createMessageRequest()));

  assert.equal(calls.prompts[0], 'Organize my photos.');
});
```

Expected red failure if current transcript compaction drops `recovery` or `hint`. If this test is already green, keep it as regression coverage and note the prompt test as the red driver for this task.

- [ ] **Step 3: Implement runner behavior guidance only if needed**

If generated prompt guidance alone satisfies the runner system prompt test after Task 1, do not duplicate text in `runnerBehaviorPrompt`.

If the generated cheat sheet must stay more compact than the full behavior instruction, add one short line to `runnerBehaviorPrompt`:

```mjs
'Gallery MCP validation or denied results with retryable correction hints are recoverable: retry with corrected arguments once, but approval-required results pause for Gallery approval. Do not call first-pass tool validation mistakes an internal Gallery issue.',
```

Do not add any runner-side automatic retry logic. Pi must make the corrected tool call itself.

- [ ] **Step 4: Verify runner tests are green**

Run:

```bash
pnpm --dir agent-runner exec node --test src/pi-runtime.test.mjs
```

Expected green result: system prompt contains retry guidance, invalid-handle recovery context is preserved, approval-required pause tests still pass, and provider-error tests still pass.

---

## Task 3: Preserve Approval And Provider Error Behavior

**Files:**

- Test: `agent-runner/src/pi-runtime.test.mjs`

- [ ] **Step 1: Add or strengthen approval pause assertion**

In the existing `pauses without assistant completion when a Gallery tool returns approval-required` test, add assertions that no prompt retry is issued after the approval-required tool message:

```mjs
assert.equal(session.messages.filter((message) => message.role === 'assistant').length, 0);
```

Keep the expected event list exactly one `tool-approval-needed` event.

Run:

```bash
pnpm --dir agent-runner exec node --test src/pi-runtime.test.mjs
```

Expected red/green: this may already be green, but it locks the Slice 4 edge case that approval-required still pauses instead of being retried or completed.

- [ ] **Step 2: Add or strengthen unrecoverable provider error assertion**

In the existing provider-error coverage (`returns a runner-error when Pi completes with an assistant error message` and context-window/compaction tests), assert that unrecoverable provider errors still produce `runner-error` and are not rewritten as recoverable MCP validation:

```mjs
assert.equal(events[0].type, 'runner-error');
assert.equal(events[0].message, 'provider rejected tool schema');
assert.doesNotMatch(events[0].message, /retry with corrected arguments/i);
```

Run:

```bash
pnpm --dir agent-runner exec node --test src/pi-runtime.test.mjs
```

Expected green result: provider errors keep their actionable runner-error path.

---

## Task 4: Broader Verification And Commit

- [ ] **Step 1: Run relevant server and runner suites**

Run:

```bash
pnpm --dir server test src/services/agent-mcp-prompt.service.spec.ts src/services/agent-mcp.service.spec.ts src/services/agent-operation-plan.service.spec.ts
pnpm --dir agent-runner exec node --test src/pi-runtime.test.mjs
pnpm --dir server format
pnpm --dir server lint
pnpm --dir server check
git diff --check
```

Expected: all pass. If `agent-runner` has its own lint/check script, run the narrow relevant one if available.

- [ ] **Step 2: Review before commit**

Review:

- Prompt stays under `3800` chars and uses readable words, not compressed unreadable tokens.
- Generated `agent-runner/src/generated/gallery-mcp-prompt-cheat-sheet.mjs` matches `AgentMcpPromptService`.
- No automatic handle substitution or hidden retry loop was introduced.
- Approval-required behavior still pauses.
- Provider/infrastructure errors still surface as runner errors.
- No fixture UUIDs leak back into model-facing prompt examples.

- [ ] **Step 3: Commit and push**

Commit:

```bash
git add server/src/services/agent-mcp-prompt.service.ts server/src/services/agent-mcp-prompt.service.spec.ts agent-runner/src/generated/gallery-mcp-prompt-cheat-sheet.mjs agent-runner/src/pi-runtime.mjs agent-runner/src/pi-runtime.test.mjs docs/superpowers/plans/2026-05-22-pi-agent-mcp-handle-filter-hardening-slice-4.md
git commit -m "fix: teach Pi to recover MCP tool failures"
git push
```

Expected: branch `explore/pi-agent-brainstorm` is pushed after Slice 4.
