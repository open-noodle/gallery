# Pi Agent Highlight Curation Slice 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add deterministic read-only guardrails for highlight curation prompts that are unbounded, invalidly counted, oversized, or empty, without creating any highlight write plans.

**Architecture:** Real Pi behavior is guided by `agent-runner/src/pi-runtime.mjs` system prompt instructions. Deterministic acceptance behavior lives in `agent-runner/src/e2e-runtime.mjs`, where this slice adds a small highlight prompt parser and read-only response path before the existing album/metadata planning path. The e2e runtime may call `searchAssets` for bounded candidate checks, but it must never call `proposeAlbumOperations` or `proposeAssetBatchFromSearch` for highlight prompts in this slice.

**Tech Stack:** Node ESM runner, Node built-in test runner, Gallery MCP JSON-RPC tool calls.

---

## Scope Boundaries

This plan implements only Slice 2 from `docs/superpowers/specs/2026-05-26-pi-agent-highlight-curation-design.md`.

In scope:

- Unbounded "best/highlights" prompts ask for a bounded source and create no plan.
- Missing count on a clearly bounded highlight prompt uses default count `10` for the read-only candidate check and explains the default.
- Zero and negative counts ask for a positive count and create no plan.
- Requested count greater than the metadata-only candidate limit asks for a smaller count or narrower source and creates no plan.
- Candidate sets larger than the metadata-only limit ask the user to narrow and create no plan.
- No matching candidates returns a direct answer and creates no plan.
- Pi runtime prompt includes the same guardrail contract for real model sessions.

Out of scope:

- No metadata-only highlight album/favorite plans. That starts in Slice 3.
- No preview-assisted curation. That starts in Slice 4.
- No cover suggestions. That starts in Slice 4.
- No UI or sparse apply work. That starts in Slice 5.
- No fewer-candidates-than-requested plan behavior. That starts in Slice 3.
- No server-side natural-language preflight parser in `AgentMessageService`; the first-party runner remains responsible for assistant behavior.

## Files

- Modify: `agent-runner/src/e2e-runtime.test.mjs`
  - Add red tests for no-scope, missing count default, unresolved bounded source, invalid counts, oversized requested count, oversized candidate set, known total above limit, ordinary pagination, and no candidates.
- Modify: `agent-runner/src/e2e-runtime.mjs`
  - Add highlight prompt parsing and read-only guardrail responses before album planning.
- Modify: `agent-runner/src/pi-runtime.mjs`
  - Add real Pi system prompt instructions for bounded source, count limits, no-candidate, and no-write behavior for guardrails.
- Modify: `agent-runner/src/pi-runtime.test.mjs`
  - Assert the Pi system prompt contains the Slice 2 guardrail instructions.

## Constants And Behavior

Use these constants in `agent-runner/src/e2e-runtime.mjs`:

```js
const defaultHighlightCount = 10;
const metadataHighlightCandidateLimit = 500;
```

Do not introduce the preview limit in executable e2e behavior yet. Slice 4 owns preview-assisted paths and the `250` preview limit.

Highlight prompt detection is intentionally narrow for deterministic tests:

- It must match prompts containing `best` or `highlight`.
- It must treat `my library`, `entire library`, `whole library`, `all photos`, or `everything` as unbounded.
- It must treat prompts with `this album`, `album`, `space`, `last weekend`, `weekend`, `from`, `selected`, or `selection` as syntactically bounded.
- Only `last weekend` / `weekend` has concrete deterministic filters in Slice 2. Other bounded phrases such as `this album` are unresolved in the deterministic runner and must ask for a concrete searchable source instead of searching with empty filters.
- It must parse integer counts immediately before `highlight(s)` or `photo(s)`, including `0` and negative numbers.

The e2e runner response order for highlight prompts:

1. If unbounded, complete with a clarification text and make no MCP calls.
2. If count is `0` or negative, complete with a positive-count clarification and make no MCP calls.
3. If requested count is greater than `500`, complete with a smaller-count/narrower-source clarification and make no MCP calls.
4. If bounded but the deterministic runner cannot resolve a concrete searchable source, ask which concrete source to use and make no MCP calls.
5. If bounded and count is missing, use `10` for the read-only search.
6. Search bounded candidates with `searchAssets`.
7. If candidate count is `0`, complete with a no-matches answer and no plan call.
8. If a known candidate count or total is greater than `500`, complete with a narrow-source answer and no plan call; ordinary pagination by itself is not oversized.
9. Otherwise, complete with a read-only answer that states the candidate count and default count if applicable. Do not create a plan.

## Task 1: Add E2E Runtime Red Tests

**Files:**

- Modify: `agent-runner/src/e2e-runtime.test.mjs`
- Test: `agent-runner/src/e2e-runtime.test.mjs`

- [ ] **Step 1: Add tests for read-only highlight guardrails**

Add these tests after `it('asks for longitude instead of planning an incomplete coordinate edit', ...)`:

```js
it('asks for a bounded source before curating best photos from the whole library', async () => {
  const { calls, fetchImplementation } = createFetch(successHandlers());
  const runtime = createE2eRuntime({ fetch: fetchImplementation });
  await runtime.createSession(createSessionBody());

  const events = await collectEvents(runtime, 'Pick the best photos from my library.');

  assert.equal(calls.length, 0);
  assert.equal(events.at(-1).type, 'assistant-message-completed');
  assert.match(events.at(-1).content.blocks[0].text, /bounded source/i);
  assert.match(events.at(-1).content.blocks[0].text, /album|shared space|date range|selected photos/i);
});

it('uses a default count of 10 for bounded highlight prompts without creating a plan', async () => {
  const { calls, fetchImplementation } = createFetch(successHandlers());
  const runtime = createE2eRuntime({ fetch: fetchImplementation });
  await runtime.createSession(createSessionBody());

  const events = await collectEvents(runtime, 'Suggest highlights from last weekend.');

  assert.equal(calls.length, 1);
  assert.equal(calls[0].body.params.name, 'searchAssets');
  assert.deepEqual(calls[0].body.params.arguments, {
    filters: {
      takenAfter: '2026-05-23T00:00:00.000Z',
      takenBefore: '2026-05-24T23:59:59.999Z',
    },
    detail: 'ids',
    limit: 10,
  });
  assert.match(events.at(-1).content.blocks[0].text, /default/i);
  assert.match(events.at(-1).content.blocks[0].text, /\b10\b/);
  assert.match(events.at(-1).content.blocks[0].text, /3 candidate/i);
});

it('asks for a concrete searchable source instead of searching all assets for unresolved album highlights', async () => {
  const { calls, fetchImplementation } = createFetch(successHandlers());
  const runtime = createE2eRuntime({ fetch: fetchImplementation });
  await runtime.createSession(createSessionBody());

  const events = await collectEvents(runtime, 'Suggest 10 highlights from this album.');

  assert.equal(calls.length, 0);
  assert.match(events.at(-1).content.blocks[0].text, /concrete searchable source/i);
  assert.match(events.at(-1).content.blocks[0].text, /\?/);
});

it('asks for a positive highlight count for zero or negative requests without creating a plan', async () => {
  for (const prompt of ['Suggest 0 highlights from this album.', 'Pick -3 best photos from this album.']) {
    const { calls, fetchImplementation } = createFetch(successHandlers());
    const runtime = createE2eRuntime({ fetch: fetchImplementation });
    await runtime.createSession(createSessionBody());

    const events = await collectEvents(runtime, prompt);

    assert.equal(calls.length, 0);
    assert.match(events.at(-1).content.blocks[0].text, /positive count/i);
  }
});

it('asks to narrow oversized highlight requests without creating a plan', async () => {
  const { calls, fetchImplementation } = createFetch(successHandlers());
  const runtime = createE2eRuntime({ fetch: fetchImplementation });
  await runtime.createSession(createSessionBody());

  const events = await collectEvents(runtime, 'Suggest 501 highlights from this album.');

  assert.equal(calls.length, 0);
  assert.match(events.at(-1).content.blocks[0].text, /500 or fewer/i);
  assert.match(events.at(-1).content.blocks[0].text, /narrow/i);
});

it('asks to narrow oversized bounded candidate sets without creating a plan', async () => {
  const { calls, fetchImplementation } = createFetch([
    {
      name: 'searchAssets',
      handle: (_args, request) => ({
        body: {
          jsonrpc: '2.0',
          id: request.id,
          result: {
            structuredContent: {
              status: 'success',
              assetIds: ['00000000-0000-4000-8000-000000000201'],
              returnedCount: 501,
              hasMore: true,
            },
          },
        },
      }),
    },
    successHandlers()[1],
    successHandlers()[2],
  ]);
  const runtime = createE2eRuntime({ fetch: fetchImplementation });
  await runtime.createSession(createSessionBody());

  const events = await collectEvents(runtime, 'Suggest 10 highlights from last weekend.');

  assert.equal(calls.length, 1);
  assert.equal(calls[0].body.params.name, 'searchAssets');
  assert.match(events.at(-1).content.blocks[0].text, /too many/i);
  assert.match(events.at(-1).content.blocks[0].text, /narrow/i);
});

it('asks to narrow when Gallery reports a known highlight total above the candidate limit', async () => {
  const { calls, fetchImplementation } = createFetch([
    {
      name: 'searchAssets',
      handle: (_args, request) => ({
        body: {
          jsonrpc: '2.0',
          id: request.id,
          result: {
            structuredContent: {
              status: 'success',
              assetIds: ['00000000-0000-4000-8000-000000000201', '00000000-0000-4000-8000-000000000202'],
              returnedCount: 10,
              totalCount: 501,
              hasMore: true,
            },
          },
        },
      }),
    },
    successHandlers()[1],
    successHandlers()[2],
  ]);
  const runtime = createE2eRuntime({ fetch: fetchImplementation });
  await runtime.createSession(createSessionBody());

  const events = await collectEvents(runtime, 'Suggest 10 highlights from last weekend.');

  assert.equal(calls.length, 1);
  assert.equal(calls[0].body.params.name, 'searchAssets');
  assert.match(events.at(-1).content.blocks[0].text, /too many/i);
  assert.match(events.at(-1).content.blocks[0].text, /narrow/i);
});

it('does not treat ordinary pagination as an oversized highlight candidate set', async () => {
  const { calls, fetchImplementation } = createFetch([
    {
      name: 'searchAssets',
      handle: (_args, request) => ({
        body: {
          jsonrpc: '2.0',
          id: request.id,
          result: {
            structuredContent: {
              status: 'success',
              assetIds: ['00000000-0000-4000-8000-000000000201', '00000000-0000-4000-8000-000000000202'],
              returnedCount: 10,
              hasMore: true,
            },
          },
        },
      }),
    },
    successHandlers()[1],
    successHandlers()[2],
  ]);
  const runtime = createE2eRuntime({ fetch: fetchImplementation });
  await runtime.createSession(createSessionBody());

  const events = await collectEvents(runtime, 'Suggest 10 highlights from last weekend.');

  assert.equal(calls.length, 1);
  assert.equal(calls[0].body.params.name, 'searchAssets');
  assert.doesNotMatch(events.at(-1).content.blocks[0].text, /too many/i);
  assert.match(events.at(-1).content.blocks[0].text, /10 candidate/i);
  assert.match(events.at(-1).content.blocks[0].text, /did not create a plan/i);
});

it('answers directly when a bounded highlight source has no candidates without creating a plan', async () => {
  const { calls, fetchImplementation } = createFetch([
    {
      name: 'searchAssets',
      handle: (_args, request) => ({
        body: {
          jsonrpc: '2.0',
          id: request.id,
          result: {
            structuredContent: {
              status: 'success',
              assetIds: [],
              returnedCount: 0,
              hasMore: false,
            },
          },
        },
      }),
    },
    successHandlers()[1],
    successHandlers()[2],
  ]);
  const runtime = createE2eRuntime({ fetch: fetchImplementation });
  await runtime.createSession(createSessionBody());

  const events = await collectEvents(runtime, 'Suggest 10 highlights from last weekend.');

  assert.equal(calls.length, 1);
  assert.equal(calls[0].body.params.name, 'searchAssets');
  assert.match(events.at(-1).content.blocks[0].text, /no matching/i);
  assert.match(events.at(-1).content.blocks[0].text, /did not create a plan/i);
});
```

- [ ] **Step 2: Run the e2e runtime tests and verify red**

Run:

```bash
pnpm --dir agent-runner test
```

Expected: FAIL. The new highlight tests should fail because the current e2e runtime falls through to `proposePortugalTrip()` and creates album plans for these prompts.

## Task 2: Implement E2E Runtime Highlight Guardrails

**Files:**

- Modify: `agent-runner/src/e2e-runtime.mjs`
- Test: `agent-runner/src/e2e-runtime.test.mjs`

- [ ] **Step 1: Add highlight parser helpers**

Add these helpers after `parseMetadataPrompt()`:

```js
const defaultHighlightCount = 10;
const metadataHighlightCandidateLimit = 500;

const parseHighlightPrompt = (prompt) => {
  if (!/\b(best|highlights?)\b/i.test(prompt)) {
    return null;
  }

  const countMatch =
    prompt.match(/(?:^|\s)(-?\d+)\s+(?:best\s+)?(?:highlights?|photos?)\b/i) ??
    prompt.match(/\b(?:best|top|pick|choose|suggest)\s+(-?\d+)\s+(?:highlights?|photos?)\b/i);
  const requestedCount = countMatch ? Number(countMatch[1]) : null;
  const unbounded = /\b(my|entire|whole)?\s*library\b/i.test(prompt) || /\b(all photos|everything)\b/i.test(prompt);
  const bounded =
    !unbounded && /\b(this album|album|space|last weekend|weekend|from|selected|selection)\b/i.test(prompt);
  const filters = /\b(last weekend|weekend)\b/i.test(prompt)
    ? {
        takenAfter: '2026-05-23T00:00:00.000Z',
        takenBefore: '2026-05-24T23:59:59.999Z',
      }
    : null;

  return {
    bounded,
    filters,
    requestedCount,
    effectiveCount: requestedCount ?? defaultHighlightCount,
    usedDefaultCount: requestedCount === null,
  };
};

const highlightCandidateCount = (result, assetIds) => {
  if (typeof result.totalCount === 'number') {
    return result.totalCount;
  }

  if (typeof result.approximateTotal === 'number') {
    return result.approximateTotal;
  }

  if (typeof result.selectionHandle?.assetCount === 'number') {
    return result.selectionHandle.assetCount;
  }

  if (typeof result.returnedCount === 'number') {
    return result.returnedCount;
  }

  return assetIds.length;
};

const readHighlightCandidates = async (client, highlightPrompt) => {
  const result = await client.call('searchAssets', {
    filters: highlightPrompt.filters,
    detail: 'ids',
    limit: highlightPrompt.effectiveCount,
  });
  if (result.status !== 'success') {
    throw new Error(`Asset search did not complete successfully: ${result.status}`);
  }

  const assetIds = compactAssetIdsFromResult(result);
  return {
    assetIds,
    candidateCount: highlightCandidateCount(result, assetIds),
  };
};
```

- [ ] **Step 2: Add the read-only highlight branch before album planning**

In `sendMessage`, after metadata `place-name` and `missing-longitude` checks and before the first `yield deltaEvent(...)`, add:

```js
      const highlightPrompt = parseHighlightPrompt(prompt);
      if (highlightPrompt) {
        if (!highlightPrompt.bounded) {
          yield completedEvent({
            gallerySessionId,
            runnerSessionId,
            text: 'I can suggest highlights when you give me a bounded source, such as an album, shared space, date range, search/filter, or selected photos. Which set should I use?',
          });
          return;
        }

        if (highlightPrompt.requestedCount !== null && highlightPrompt.requestedCount <= 0) {
          yield completedEvent({
            gallerySessionId,
            runnerSessionId,
            text: 'Please choose a positive count before I suggest highlights.',
          });
          return;
        }

        if (highlightPrompt.effectiveCount > metadataHighlightCandidateLimit) {
          yield completedEvent({
            gallerySessionId,
            runnerSessionId,
            text: 'Please choose 500 or fewer highlights, or narrow the source before curation.',
          });
          return;
        }

        if (!highlightPrompt.filters) {
          yield completedEvent({
            gallerySessionId,
            runnerSessionId,
            text: 'I need a concrete searchable source for this read-only highlight check, such as a date range, search/filter, or selected photos. Which set should I use?',
          });
          return;
        }

        try {
          const { candidateCount } = await readHighlightCandidates(client, highlightPrompt);
          if (candidateCount === 0) {
            yield completedEvent({
              gallerySessionId,
              runnerSessionId,
              text: 'I found no matching candidates in that bounded source, so I did not create a plan.',
            });
            return;
          }

          if (candidateCount > metadataHighlightCandidateLimit) {
            yield completedEvent({
              gallerySessionId,
              runnerSessionId,
              text: 'That source has too many candidate assets for this read-only highlight pass. Please narrow the album, space, date range, search/filter, or selected photos.',
            });
            return;
          }

          yield completedEvent({
            gallerySessionId,
            runnerSessionId,
            text: highlightPrompt.usedDefaultCount
              ? `I found ${candidateCount} candidate assets. I would use the default count of 10 for suggested highlights from this bounded source. I did not create a plan.`
              : `I found ${candidateCount} candidate assets for ${highlightPrompt.effectiveCount} suggested highlights. I did not create a plan.`,
          });
          return;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          yield completedEvent({
            gallerySessionId,
            runnerSessionId,
            text: `Gallery could not inspect highlight candidates: ${redactGatewayToken(message, gateway)}`,
          });
          return;
        }
      }
```

Do not call `proposeAlbumOperations` or `proposeAssetBatchFromSearch` from this branch.

- [ ] **Step 3: Run the e2e runtime tests and verify green for new behavior**

Run:

```bash
pnpm --dir agent-runner test
```

Expected: PASS for all agent-runner tests.

## Task 3: Add Pi Runtime Prompt Guardrail Tests

**Files:**

- Modify: `agent-runner/src/pi-runtime.test.mjs`
- Test: `agent-runner/src/pi-runtime.test.mjs`

- [ ] **Step 1: Add prompt assertions**

In `it('constructs the Pi resource loader with concrete runtime paths', ...)`, after the existing assertion for `Best/highlights require bounded source`, add:

```js
assert.equal(calls.loaders[0].systemPrompt.includes('default to 10 only when the source is bounded'), true);
assert.equal(calls.loaders[0].systemPrompt.includes('zero, negative, or above 500'), true);
assert.equal(calls.loaders[0].systemPrompt.includes('known count or total is above 500'), true);
assert.equal(
  calls.loaders[0].systemPrompt.includes(
    'Slice 2 is read-only: do not create album, favorite, or cover plans for highlight requests yet',
  ),
  true,
);
assert.equal(
  calls.loaders[0].systemPrompt.includes('No matching highlight candidates: answer directly and do not create a plan'),
  true,
);
assert.equal(calls.loaders[0].systemPrompt.includes('Except for best/highlight requests during Slice 2'), true);
```

- [ ] **Step 2: Run agent-runner tests and verify red**

Run:

```bash
pnpm --dir agent-runner test
```

Expected: FAIL in `constructs the Pi resource loader with concrete runtime paths` because the Pi runtime prompt does not yet contain these Slice 2 guardrail instructions.

## Task 4: Add Pi Runtime Prompt Guardrail Instructions

**Files:**

- Modify: `agent-runner/src/pi-runtime.mjs`
- Test: `agent-runner/src/pi-runtime.test.mjs`

- [ ] **Step 1: Add one compact runner behavior prompt line**

In `runnerBehaviorPrompt`, add this line after the existing metadata-only trip search limit line:

```js
  'For best/highlight requests, require a bounded source; default to 10 only when the source is bounded and no count is specified; zero, negative, or above 500 counts ask for a valid smaller count; ask to narrow only when known count or total is above 500. Slice 2 is read-only: do not create album, favorite, or cover plans for highlight requests yet. No matching highlight candidates: answer directly and do not create a plan.',
```

Then update the generic album-creation instruction so it does not contradict the Slice 2 read-only highlight rule:

```js
  'Except for best/highlight requests during Slice 2, when a user asks you to create or fill an album and metadata candidates are found, call mcp_gallery_proposeAlbumOperations with album.create and album.addAssets operations. A chat-only answer is not enough for album creation requests.',
```

- [ ] **Step 2: Run agent-runner tests and verify green**

Run:

```bash
pnpm --dir agent-runner test
```

Expected: PASS for all agent-runner tests.

## Task 5: Run Focused Verification

**Files:**

- Test: `agent-runner/src/e2e-runtime.test.mjs`
- Test: `agent-runner/src/pi-runtime.test.mjs`

- [ ] **Step 1: Run the full agent-runner suite**

Run:

```bash
pnpm --dir agent-runner test
```

Expected: PASS, including the new highlight guardrail tests.

- [ ] **Step 2: Run diff whitespace checks**

Run:

```bash
git diff --check
```

Expected: no output.

- [ ] **Step 3: Inspect the final diff for scope creep**

Run:

```bash
git diff -- agent-runner/src/e2e-runtime.mjs agent-runner/src/e2e-runtime.test.mjs agent-runner/src/pi-runtime.mjs agent-runner/src/pi-runtime.test.mjs docs/superpowers/plans/2026-05-26-pi-agent-highlight-curation-slice-2.md
```

Expected:

- e2e runtime only adds read-only highlight parsing and response paths.
- no highlight branch calls proposal tools.
- Pi runtime only adds prompt guidance.
- Tests cover every Slice 2 guardrail.
- No Slice 3 metadata-only write plan behavior is present.

## Task 6: Commit Slice 2

**Files:**

- Stage files modified in this plan.

- [ ] **Step 1: Review git status**

Run:

```bash
git status --short
```

Expected changed files:

```text
 M agent-runner/src/e2e-runtime.mjs
 M agent-runner/src/e2e-runtime.test.mjs
 M agent-runner/src/pi-runtime.mjs
 M agent-runner/src/pi-runtime.test.mjs
?? docs/superpowers/plans/2026-05-26-pi-agent-highlight-curation-slice-2.md
```

- [ ] **Step 2: Commit**

Run:

```bash
git add agent-runner/src/e2e-runtime.mjs agent-runner/src/e2e-runtime.test.mjs agent-runner/src/pi-runtime.mjs agent-runner/src/pi-runtime.test.mjs docs/superpowers/plans/2026-05-26-pi-agent-highlight-curation-slice-2.md
git commit -m "feat: add highlight curation guardrails"
```

Expected: commit succeeds.

## Self-Review Checklist

- No-scope prompt asks for bounded source and makes zero MCP calls.
- Missing count on bounded source uses default count `10` for read-only search.
- Unresolved bounded phrases such as `this album` ask for a concrete searchable source and make zero MCP calls.
- Zero and negative counts ask for a positive count and make zero MCP calls.
- Requested count above `500` asks to narrow or choose a smaller count and makes zero MCP calls.
- Oversized candidate set or known total above `500` asks to narrow and does not call proposal tools.
- Ordinary pagination alone does not trigger the oversized-source response.
- No candidates answers directly and does not call proposal tools.
- No album/favorite/cover plans are introduced.
- Fewer-candidates-than-requested planning remains unimplemented for Slice 3.
- Pi runtime prompt guidance matches the deterministic guardrails.
