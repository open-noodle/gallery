# Pi Agent Metadata Assistant Flow Slice 6 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove Pi can turn metadata-edit prompts into reviewable Gallery plans, keep chat usable after applying the plan, and ask for explicit coordinates instead of inventing location metadata.

**Architecture:** Keep metadata writes behind existing MCP planning tools. Teach the compact runner prompt to use `mcp_gallery_proposeAssetBatchFromSearch` for search-backed `asset.updateMetadata` requests and to ask for latitude and longitude when a user gives only a place name or one coordinate. Extend the deterministic e2e runtime as a lightweight regression harness for those prompt patterns, and add an integration test that exercises the real MCP service and operation-plan service.

**Tech Stack:** TypeScript/Nest/Vitest server tests, Node test runner for `agent-runner`, generated MCP prompt sync.

---

## Files

- Modify: `server/src/services/agent-mcp-prompt.service.spec.ts`
  - Add prompt assertions for metadata edit planning, explicit coordinate requirements, and schema-valid metadata prompt examples.
- Modify: `server/src/services/agent-mcp-prompt.service.ts`
  - Select the existing `metadata-search-results` example for prompt rendering.
  - Add a compact metadata guidance line without exceeding the 4200 character prompt cap.
- Modify: `agent-runner/src/generated/gallery-mcp-prompt-cheat-sheet.mjs`
  - Regenerate from `pnpm --dir server run sync:agent-mcp-prompt`.
- Modify: `agent-runner/src/e2e-runtime.test.mjs`
  - Add deterministic prompt-to-plan tests for description and coordinate metadata updates, plus no-plan clarification tests for place names and missing longitude.
- Modify: `agent-runner/src/e2e-runtime.mjs`
  - Add prompt classification and deterministic calls to `searchAssets` plus `proposeAssetBatchFromSearch` for supported metadata edits.
  - Return clarification messages without MCP calls for unsupported location prompts.
- Modify: `server/src/services/agent-runner-flow.integration.spec.ts`
  - Add missing in-memory plan apply methods and asset metadata review/update mocks.
  - Add assistant-flow tests for search-backed metadata plan creation, apply continuation, and place-name clarification with no plan.

## Task 1: Prompt Guidance

**Files:**

- Modify: `server/src/services/agent-mcp-prompt.service.spec.ts`
- Modify: `server/src/services/agent-mcp-prompt.service.ts`
- Modify: `agent-runner/src/generated/gallery-mcp-prompt-cheat-sheet.mjs`

- [ ] **Step 1: Write failing prompt tests**

Add a test near the other prompt-guidance tests in `server/src/services/agent-mcp-prompt.service.spec.ts`:

```ts
it('teaches metadata edits as reviewable search-backed plans with explicit coordinates only', () => {
  const prompt = sut.generatePromptCheatSheet();
  const examples = sut.listPromptExamples();
  const metadataExample = examples.find(
    (example) =>
      example.toolName === AgentToolName.ProposeAssetBatchFromSearch &&
      example.exampleName === 'metadata-search-results',
  );

  expect(metadataExample?.arguments).toMatchObject({
    action: {
      type: 'asset.updateMetadata',
      description: 'Berlin weekend',
      timeZone: 'Europe/Berlin',
    },
    assetSource: { kind: 'search' },
  });
  expect(prompt).toContain('asset.updateMetadata');
  expect(prompt).toContain('mcp_gallery_proposeAssetBatchFromSearch');
  expect(prompt).toMatch(/metadata edits?.*reviewable/i);
  expect(prompt).toMatch(/coordinates?.*latitude.*longitude/i);
  expect(prompt).toMatch(/place names?.*ask/i);
  expect(prompt).not.toContain('placeName');
  expect(prompt.length).toBeLessThanOrEqual(4200);
});
```

- [ ] **Step 2: Run the prompt test and verify RED**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-mcp-prompt.service.spec.ts -t 'metadata edits as reviewable search-backed plans'
```

Expected: FAIL because `metadata-search-results` is not selected by `listPromptExamples()` and the prompt does not include compact metadata/coordinate guidance.

- [ ] **Step 3: Implement prompt guidance**

In `server/src/services/agent-mcp-prompt.service.ts`:

1. Replace the duplicate final `favorite-search-results` entry in `promptExampleSelections` with:

```ts
{ toolName: AgentToolName.ProposeAssetBatchFromSearch, exampleName: 'metadata-search-results' },
```

2. Add a `metadataBatch` prompt example lookup:

```ts
const metadataBatch = this.getPromptExample(
  examples,
  AgentToolName.ProposeAssetBatchFromSearch,
  'metadata-search-results',
);
```

3. Add one compact line after `Default write`:

```ts
`Metadata edits are reviewable plans: ${metadataBatch.piToolName} ${this.formatJson(metadataBatch.arguments)}. Coordinates need explicit latitude+longitude; for place names or one coordinate, ask.`,
```

4. If the prompt exceeds 4200 characters, shorten the line while preserving:
   - `asset.updateMetadata`
   - `mcp_gallery_proposeAssetBatchFromSearch`
   - `latitude`
   - `longitude`
   - `place names`
   - `ask`

- [ ] **Step 4: Run the prompt test and sync generated prompt**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-mcp-prompt.service.spec.ts -t 'metadata edits as reviewable search-backed plans'
pnpm --dir server run build
pnpm --dir server run sync:agent-mcp-prompt
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-mcp-prompt.service.spec.ts
```

Expected: PASS. The generated `agent-runner/src/generated/gallery-mcp-prompt-cheat-sheet.mjs` diff contains the same metadata guidance and no unsafe content.

## Task 2: Deterministic E2E Runtime Metadata Prompts

**Files:**

- Modify: `agent-runner/src/e2e-runtime.test.mjs`
- Modify: `agent-runner/src/e2e-runtime.mjs`

- [ ] **Step 1: Write failing e2e-runtime tests**

In `agent-runner/src/e2e-runtime.test.mjs`, extend the existing `searchAssets` success response so it includes a reusable source reference whenever the runtime asks for a selection handle:

```js
selectionHandle: args.createSelectionHandle
  ? {
      id: '00000000-0000-4000-8000-000000000333',
      sourceRef: 'asset-source:search:00000000-0000-4000-8000-000000000333',
      assetCount: 3,
      sampleAssetIds: [
        '00000000-0000-4000-8000-000000000201',
        '00000000-0000-4000-8000-000000000202',
      ],
    }
  : undefined,
```

Also extend `successHandlers()` with a `proposeAssetBatchFromSearch` handler:

```js
{
  name: 'proposeAssetBatchFromSearch',
  handle: (args, request) => ({
    body: {
      jsonrpc: '2.0',
      id: request.id,
      result: {
        structuredContent: {
          status: 'success',
          summary: 'Stored 1 proposed metadata operation.',
          plan: { id: '00000000-0000-4000-8000-000000000302' },
          received: args,
        },
      },
    },
  }),
},
```

Add tests:

```js
it('proposes a metadata description plan from a newest-photos prompt', async () => {
  const { calls, fetchImplementation } = createFetch(successHandlers());
  const runtime = createE2eRuntime({ fetch: fetchImplementation });
  await runtime.createSession(createSessionBody());

  const events = await collectEvents(runtime, 'Set the description on the 5 newest photos to Test batch.');

  assert.equal(calls.length, 2);
  assert.equal(calls[0].body.params.name, 'searchAssets');
  assert.deepEqual(calls[0].body.params.arguments, {
    filters: {},
    order: 'desc',
    limit: 5,
    detail: 'ids',
    createSelectionHandle: true,
    sampleSize: 2,
  });
  assert.equal(calls[1].body.params.name, 'proposeAssetBatchFromSearch');
  assert.deepEqual(calls[1].body.params.arguments.action, {
    type: 'asset.updateMetadata',
    description: 'Test batch',
  });
  assert.deepEqual(calls[1].body.params.arguments.assetSource, {
    kind: 'previousSearch',
    sourceRef: 'asset-source:search:00000000-0000-4000-8000-000000000333',
  });
  assert.match(events.at(-1).content.blocks[0].text, /metadata/i);
});

it('proposes a metadata coordinate plan only when latitude and longitude are present', async () => {
  const { calls, fetchImplementation } = createFetch(successHandlers());
  const runtime = createE2eRuntime({ fetch: fetchImplementation });
  await runtime.createSession(createSessionBody());

  const events = await collectEvents(runtime, 'Set these photos to latitude 48.8566 and longitude 2.3522.');

  assert.equal(calls.length, 2);
  assert.equal(calls[1].body.params.name, 'proposeAssetBatchFromSearch');
  assert.deepEqual(calls[1].body.params.arguments.action, {
    type: 'asset.updateMetadata',
    latitude: 48.8566,
    longitude: 2.3522,
  });
  assert.match(events.at(-1).content.blocks[0].text, /coordinates/i);
});

it('asks for coordinates instead of planning a place-name metadata edit', async () => {
  const { calls, fetchImplementation } = createFetch(successHandlers());
  const runtime = createE2eRuntime({ fetch: fetchImplementation });
  await runtime.createSession(createSessionBody());

  const events = await collectEvents(runtime, 'Set these photos to Paris.');

  assert.equal(calls.length, 0);
  assert.match(events.at(-1).content.blocks[0].text, /latitude and longitude/i);
});

it('asks for longitude instead of planning an incomplete coordinate edit', async () => {
  const { calls, fetchImplementation } = createFetch(successHandlers());
  const runtime = createE2eRuntime({ fetch: fetchImplementation });
  await runtime.createSession(createSessionBody());

  const events = await collectEvents(runtime, 'Set these photos to latitude 48.8566.');

  assert.equal(calls.length, 0);
  assert.match(events.at(-1).content.blocks[0].text, /longitude/i);
});
```

- [ ] **Step 2: Run tests and verify RED**

Run:

```bash
pnpm --dir agent-runner test
```

Expected: FAIL because the runtime still drafts album plans for these prompts and/or calls the wrong MCP tools.

- [ ] **Step 3: Implement deterministic runtime support**

In `agent-runner/src/e2e-runtime.mjs`:

1. Add helper functions:

```js
const proposeMetadataUpdate = async (client, { action, searchArgs, summary }) => {
  const search = await client.call('searchAssets', searchArgs);
  const sourceRef = search?.selectionHandle?.sourceRef;
  if (typeof sourceRef !== 'string') {
    throw new Error('Metadata update search did not return a reusable sourceRef');
  }

  await client.call('proposeAssetBatchFromSearch', {
    summary,
    action: { type: 'asset.updateMetadata', ...action },
    assetSource: { kind: 'previousSearch', sourceRef },
  });
};

const parseMetadataPrompt = (prompt) => {
  const descriptionMatch = prompt.match(/description on the 5 newest photos to ([^.]+)\.?/i);
  if (descriptionMatch) {
    return {
      kind: 'plan',
      summary: 'Update description on the 5 newest photos.',
      action: { description: descriptionMatch[1].trim() },
      searchArgs: { filters: {}, order: 'desc', limit: 5, detail: 'ids', createSelectionHandle: true, sampleSize: 2 },
      completion: 'I proposed a metadata update plan for the newest photos. Review it before applying.',
    };
  }

  const coordinateMatch = prompt.match(/latitude\s+(-?\d+(?:\.\d+)?)\s+and\s+longitude\s+(-?\d+(?:\.\d+)?)/i);
  if (coordinateMatch) {
    return {
      kind: 'plan',
      summary: 'Update photo coordinates.',
      action: { latitude: Number(coordinateMatch[1]), longitude: Number(coordinateMatch[2]) },
      searchArgs: { filters: {}, limit: 3, detail: 'ids', createSelectionHandle: true, sampleSize: 2 },
      completion: 'I proposed a coordinate metadata update plan. Review it before applying.',
    };
  }

  if (/latitude\s+-?\d+(?:\.\d+)?/i.test(prompt) && !/longitude\s+-?\d+(?:\.\d+)?/i.test(prompt)) {
    return {
      kind: 'clarify',
      text: 'Please provide longitude too. Location metadata needs both latitude and longitude.',
    };
  }

  if (/set these photos to\s+[a-z][a-z\s.'-]*\.?$/i.test(prompt)) {
    return {
      kind: 'clarify',
      text: 'I can update location metadata when you provide explicit latitude and longitude. Gallery will use those coordinates to fill city, state, and country labels.',
    };
  }

  return undefined;
};
```

2. In `sendMessage`, before album planning, call `parseMetadataPrompt(prompt)`. If it returns `clarify`, yield a completion event and return without creating an MCP client call. If it returns `plan`, yield a metadata delta, call `proposeMetadataUpdate`, and complete with the plan message.

- [ ] **Step 4: Run agent-runner tests and verify GREEN**

Run:

```bash
pnpm --dir agent-runner test
```

Expected: PASS.

## Task 3: Real Server Assistant Flow

**Files:**

- Modify: `server/src/services/agent-runner-flow.integration.spec.ts`

- [ ] **Step 1: Write failing integration tests**

Add two tests inside `describe('Pi agent runner flow harness', ...)`:

1. `creates a metadata update plan from an assistant prompt and continues after apply`
   - Configure search to return two asset ids.
   - Configure runner to call `mcpService.handle(...ProposeAssetBatchFromSearch...)` with:

```ts
{
  summary: 'Set description on newest photos.',
  action: { type: AgentOperationType.AssetUpdateMetadata, description: 'Test batch' },
  assetSource: { kind: 'search', filters: {}, materialization: 'all-matches-with-limit' },
}
```

- Assert session reaches `WaitingForPlanReview`.
- Assert one proposed operation exists with type `asset.updateMetadata`, payload `{ description: 'Test batch' }`, `targetKind: asset_batch`, and the materialized asset ids.
- Set asset access mocks before appending the prompt:

```ts
harness.accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set(assetIds));
harness.accessRepository.asset.checkSpaceAccess.mockResolvedValue(new Set());
harness.accessRepository.asset.checkSpaceEditAccess.mockResolvedValue(new Set());
harness.assetRepository.getAgentReadableIds.mockResolvedValue(new Set(assetIds));
```

- Apply the plan with `operationPlanService.applyApprovedOperations(...)`.
- Assert `assetService.updateAll` was called with ids and description, the session is back to `Running`, and a follow-up user message can be appended and answered.

2. `asks for coordinates for a place-name metadata prompt without creating a plan`
   - Configure runner to complete with the expected coordinate clarification text and not call MCP.
   - Append `Set these photos to Paris.`
   - Assert no operation plan exists, no `ProposeAssetBatchFromSearch` tool call exists, and the assistant message mentions latitude and longitude.

- [ ] **Step 2: Run the integration tests and verify RED**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-runner-flow.integration.spec.ts -t 'metadata update plan|place-name metadata'
```

Expected: FAIL. The harness lacks `getAgentMetadataReviewByIds`, `assetService.updateAll`, and in-memory `claimCurrentForApply`/`completeApply`, so apply cannot complete yet.

- [ ] **Step 3: Implement harness support**

In `InMemoryAgentOperationPlanRepository`, add:

```ts
claimCurrentForApply = vi.fn((sessionId: string, planId: string) => {
  const session = this.sessions.sessions.get(sessionId);
  const plan = this.plans.find(
    (candidate) =>
      candidate.sessionId === sessionId &&
      candidate.id === planId &&
      candidate.status === AgentOperationPlanStatus.Proposed,
  );
  if (!session || session.status !== AgentSessionStatus.WaitingForPlanReview || !plan) {
    return Promise.resolve(undefined);
  }

  session.status = AgentSessionStatus.Applying;
  plan.status = AgentOperationPlanStatus.Applied;
  plan.updatedAt = now();
  return Promise.resolve(plan);
});

completeApply = vi.fn(
  (
    planId: string,
    updates: Array<{ id: string; status: AgentOperationStatus; result: unknown; error: string | null }>,
  ) => {
    const plan = this.plans.find((candidate) => candidate.id === planId);
    if (!plan) {
      throw new Error(`Missing plan ${planId}`);
    }
    for (const update of updates) {
      const operation = plan.operations.find((candidate) => candidate.id === update.id);
      if (operation) {
        operation.status = update.status;
        operation.result = update.result as never;
        operation.error = update.error;
        operation.updatedAt = now();
      }
    }
    plan.updatedAt = now();
    return Promise.resolve(plan);
  },
);
```

In `setup()`:

```ts
const assetService = { updateAll: vi.fn(() => Promise.resolve()) };
const assetRepository = {
  getAgentReadableIds: vi.fn((assetIds: Set<string>) => Promise.resolve(new Set(assetIds))),
  getAgentLockedIds: vi.fn(() => Promise.resolve(new Set())),
  getAgentMetadataByIds: vi.fn((assetIds: string[]) => Promise.resolve(assetIds.map((assetId) => metadata(assetId)))),
  getAgentMetadataReviewByIds: vi.fn((assetIds: string[]) =>
    Promise.resolve(
      assetIds.map((assetId) => ({
        id: assetId,
        exifInfo: {
          description: 'Old description',
          rating: null,
          dateTimeOriginal: new Date('2026-05-01T10:00:00.000Z'),
          timeZone: 'UTC',
          latitude: null,
          longitude: null,
        },
      })),
    ),
  ),
};
```

Pass `assetService as never` into `new AgentOperationPlanService(...)` instead of `{}` and return `assetService` from `setup()`.

- [ ] **Step 4: Run the integration tests and verify GREEN**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-runner-flow.integration.spec.ts -t 'metadata update plan|place-name metadata'
```

Expected: PASS.

## Task 4: Full Verification And Commit

**Files:**

- All files modified in Tasks 1-3.

- [ ] **Step 1: Run targeted suites**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-mcp-prompt.service.spec.ts src/services/agent-runner-flow.integration.spec.ts
pnpm --dir agent-runner test
```

Expected: PASS.

- [ ] **Step 2: Run build and generated prompt verification**

Run:

```bash
pnpm --dir server run build
pnpm --dir server run sync:agent-mcp-prompt
git diff --check
```

Expected: PASS. If `sync:agent-mcp-prompt` changes the generated module, include the generated diff in the commit.

- [ ] **Step 3: Review diffs**

Run:

```bash
git diff -- server/src/services/agent-mcp-prompt.service.ts server/src/services/agent-mcp-prompt.service.spec.ts agent-runner/src/e2e-runtime.mjs agent-runner/src/e2e-runtime.test.mjs server/src/services/agent-runner-flow.integration.spec.ts agent-runner/src/generated/gallery-mcp-prompt-cheat-sheet.mjs
```

Expected: Diffs are limited to Slice 6 prompt/runtime/flow coverage, do not add direct mutation tools, and do not expose provider tokens or before-values to MCP prompt responses.

- [ ] **Step 4: Commit and push Slice 6**

Run:

```bash
git add server/src/services/agent-mcp-prompt.service.ts server/src/services/agent-mcp-prompt.service.spec.ts agent-runner/src/e2e-runtime.mjs agent-runner/src/e2e-runtime.test.mjs server/src/services/agent-runner-flow.integration.spec.ts agent-runner/src/generated/gallery-mcp-prompt-cheat-sheet.mjs docs/superpowers/plans/2026-05-25-pi-agent-asset-metadata-edits-slice-6.md
git commit -m "feat: cover pi agent metadata assistant flow"
git push
```

Expected: Commit succeeds and branch `explore/pi-agent-brainstorm` is pushed.

## Plan Review

- Spec coverage: Covers Slice 6 assistant flow requirements, prompt-to-plan behavior, apply continuation, place-name clarification, and missing-coordinate clarification. The remaining capability matrix update stays in Slice 7.
- TDD coverage: Each behavior has a failing-test step with an expected red failure and a green verification command before implementation proceeds.
- Edge cases: Place-name location prompts and latitude-without-longitude prompts return clarifications without creating a plan. Search-backed metadata plans remain reviewable and apply via existing `assetService.updateAll`.
- Scope: Does not add forward geocoding, direct mutation MCP tools, or docs/capability-matrix changes.
