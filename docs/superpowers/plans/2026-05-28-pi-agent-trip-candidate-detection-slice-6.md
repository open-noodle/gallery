# Pi Agent Trip Candidate Detection Slice 6 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Teach Pi to create generic recent-trip albums and trip highlight albums from `findTripCandidates` handles without asking for dates first or exposing raw asset IDs.

**Architecture:** This slice closes the remaining contract gap by adding `recommendation.action` to the `findTripCandidates` success response, then updates model-facing guidance and the deterministic e2e runner to follow that server recommendation. Generic trip albums pass the selected candidate handle directly to `proposeAlbumFromSelection`; explicit top/best/highlight trip requests use the candidate handle as the bounded source for `curateSelection` before proposing. The runner remains an orchestrator: it follows the tool recommendation, creates reviewable plans, asks only after the detector runs, and never sees or forwards raw trip asset IDs.

**Tech Stack:** TypeScript, NestJS/Zod DTOs, existing agent read-tool descriptor pipeline, generated MCP prompt/docs artifacts, Node e2e runner tests, Vitest, node:test.

---

## Scope

Spec: `docs/superpowers/specs/2026-05-28-pi-agent-trip-candidate-detection-design.md`

Slice 6 implements:

- `findTripCandidates` success responses include `recommendation.action`.
- The recommendation is classified after candidate materialization/readability filtering.
- Runner and generated prompt guidance say to call `findTripCandidates` before asking for trip dates.
- Generic trip album requests use the album-ready candidate handle directly and do not call `curateSelection`.
- Explicit trip highlight requests call `findTripCandidates -> curateSelection -> proposeAlbumFromSelection`.
- Explicit trip highlights default to 10 when no count is provided.
- Recent trip requests without a place hint call `findTripCandidates` with `{}` and follow its recommendation.
- Invalid explicit trip-highlight counts still call `findTripCandidates` first, then ask for a valid count without creating a plan.
- `recommendation.action = ask_user` produces one clarifying question with concrete candidate labels and no plan.
- `recommendation.action = none` produces one concrete follow-up question and no plan.
- Final copy discloses assumptions and duplicate/stack exclusions when non-zero.
- Provider-visible tool calls and transcripts do not contain raw trip asset IDs.

Out of scope:

- No album suggestions or background suggestion persistence.
- No visual/preview quality analysis or `analyzeAssetQuality`.
- No geocoding or place-name-to-coordinate resolution.
- No rewrite of completed Slice 5 validation bounds. The completed contract uses `lookbackDays` 1-365, `maxCandidates` 1-10, and `placeHint` max 80; this slice treats those as baseline unless a focused test exposes a blocker.
- No broad natural-language trip parser. The deterministic runtime only needs to cover the requested "recent trip" and "recent trip to USA" e2e flows.

## Files

- Modify: `server/src/dtos/agent-tool.dto.ts`
- Modify: `server/src/dtos/agent-tool.dto.spec.ts`
- Modify: `server/src/services/agent-tool.service.ts`
- Modify: `server/src/services/agent-tool.service.spec.ts`
- Modify: `server/src/services/agent-mcp.service.spec.ts`
- Modify: `server/src/services/agent-mcp-tool-contract.service.ts`
- Modify: `server/src/services/agent-mcp-tool-contract.service.spec.ts`
- Modify: `server/src/services/agent-mcp-prompt.service.ts`
- Modify: `server/src/services/agent-mcp-prompt.service.spec.ts`
- Modify: `agent-runner/src/pi-runtime.mjs`
- Modify: `agent-runner/src/pi-runtime.test.mjs`
- Modify: `agent-runner/src/e2e-runtime.mjs`
- Modify: `agent-runner/src/e2e-runtime.test.mjs`
- Generated: `agent-runner/src/generated/gallery-mcp-prompt-cheat-sheet.mjs`
- Generated: `docs/superpowers/generated/pi-agent-mcp-tools.md`
- Generated: `open-api/immich-openapi-specs.json`
- Generated as needed by the repo generator: `open-api/typescript-sdk/**`

## Recommendation Shape

Add this response shape to `server/src/dtos/agent-tool.dto.ts` near `AgentTripCandidateSummarySchema`:

```ts
const AgentTripCandidateRecommendationSchema = z
  .discriminatedUnion('action', [
    z
      .strictObject({
        action: z.literal('use_top_candidate'),
        candidateDedupeKey: z.string().trim().min(1).max(300),
        reason: z.string().trim().min(1).max(300),
      })
      .meta({ id: 'AgentTripCandidateUseTopRecommendation' }),
    z
      .strictObject({
        action: z.enum(['ask_user', 'none']),
        reason: z.string().trim().min(1).max(300),
      })
      .meta({ id: 'AgentTripCandidateNonAutoRecommendation' }),
  ])
  .meta({ id: 'AgentTripCandidateRecommendation' });
```

Then add `recommendation: AgentTripCandidateRecommendationSchema` to `AgentFindTripCandidatesToolSuccessResponse`.

Recommendation rules in `AgentToolService`:

```ts
type AgentTripCandidateRecommendation =
  | { action: 'use_top_candidate'; candidateDedupeKey: string; reason: string }
  | { action: 'ask_user' | 'none'; reason: string };

private buildTripCandidateRecommendation(candidates: AgentTripCandidateToolResult[]): AgentTripCandidateRecommendation {
  const [top, runnerUp] = candidates;
  if (!top) {
    return { action: 'none', reason: 'No readable trip candidates matched the request.' };
  }

  if (top.confidence !== 'high') {
    return { action: 'ask_user', reason: 'The best matching trip candidate is not high confidence.' };
  }

  if (!runnerUp) {
    return {
      action: 'use_top_candidate',
      candidateDedupeKey: top.dedupeKey,
      reason: 'The only readable trip candidate is high confidence.',
    };
  }

  const scoreDelta = top.score - runnerUp.score;
  const clearsRelativeGap = runnerUp.score <= 0 ? scoreDelta > 0 : top.score >= runnerUp.score * 1.2;
  if (scoreDelta >= 15 || clearsRelativeGap) {
    return {
      action: 'use_top_candidate',
      candidateDedupeKey: top.dedupeKey,
      reason: 'The top trip candidate is high confidence and clearly ahead of the runner-up.',
    };
  }

  return { action: 'ask_user', reason: 'Multiple plausible trip candidates are close together.' };
}
```

## Task 1: Add Trip Candidate Recommendations To The Tool Contract

**Files:**

- Modify: `server/src/dtos/agent-tool.dto.ts`
- Modify: `server/src/dtos/agent-tool.dto.spec.ts`
- Modify: `server/src/services/agent-tool.service.ts`
- Modify: `server/src/services/agent-tool.service.spec.ts`
- Modify: `server/src/services/agent-mcp.service.spec.ts`
- Modify: `server/src/services/agent-mcp-tool-contract.service.ts`
- Modify: `server/src/services/agent-mcp-tool-contract.service.spec.ts`

- [ ] **Step 1: Write failing DTO recommendation tests**

In `server/src/dtos/agent-tool.dto.spec.ts`, inside `describe(AgentFindTripCandidatesToolRequestDto.name, ...)`, add:

```ts
it('accepts trip candidate response recommendations and requires a top candidate key for auto-use', () => {
  const successResponse = {
    status: 'success',
    toolCall: makeEncodedToolCall(),
    summary: 'Found 1 trip candidate matching "USA".',
    recommendation: {
      action: 'use_top_candidate',
      candidateDedupeKey: 'trip:usa:new-york:2026-04-15:2026-04-16',
      reason: 'The only readable trip candidate is high confidence.',
    },
    candidates: [],
    resultSize: makeResultSize(),
  };

  expect(AgentFindTripCandidatesToolResponseDto.schema.safeParse(successResponse).success).toBe(true);

  const missingKey = AgentFindTripCandidatesToolResponseDto.schema.safeParse({
    ...successResponse,
    recommendation: { action: 'use_top_candidate', reason: 'Missing key.' },
  });
  expectIssue(missingKey, ['recommendation', 'candidateDedupeKey'], 'Invalid input');

  const noneWithKey = AgentFindTripCandidatesToolResponseDto.schema.safeParse({
    ...successResponse,
    recommendation: { action: 'none', candidateDedupeKey: 'trip:usa', reason: 'No match.' },
  });
  expectIssue(noneWithKey, ['recommendation'], 'Unrecognized key');
});
```

- [ ] **Step 2: Run DTO test and verify it fails**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/dtos/agent-tool.dto.spec.ts -t "trip candidate response recommendations" --run
```

Expected: FAIL because `recommendation` is not in `AgentFindTripCandidatesToolSuccessResponse`.

- [ ] **Step 3: Write failing service recommendation tests**

In `server/src/services/agent-tool.service.spec.ts`, add tests near the existing `findTripCandidates` tests:

```ts
it('findTripCandidates recommends the clear high-confidence top candidate after materialization', async () => {
  const auth = AuthFactory.create();
  const assetIds = [newUuid(), newUuid()];
  const session = makeSession({ userId: auth.user.id, approvalMode: AgentApprovalMode.PlanOnly });
  const top = makeTripCandidate({ score: 80, confidence: 'high' });
  const runnerUp = makeTripCandidate({
    dedupeKey: 'trip:usa:boston:2026-04-20:2026-04-22',
    title: 'Recent trip to Boston, USA',
    score: 60,
    confidence: 'high',
  });

  sessionRepository.getById.mockResolvedValue(session);
  tripCandidateService.findRecentTripCandidates.mockResolvedValue([top, runnerUp]);
  tripCandidateService.materializeAlbumReadySelection.mockResolvedValue(makeTripSelection(assetIds));
  accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set(assetIds));
  assetRepository.getAgentReadableIds.mockResolvedValue(new Set(assetIds));

  const result = await sut.findTripCandidates(auth, session.id, {
    placeHint: 'USA',
    lookbackDays: 180,
    maxCandidates: 3,
  });

  expect(result.status).toBe('success');
  if (result.status === 'success') {
    expect(result.recommendation).toEqual({
      action: 'use_top_candidate',
      candidateDedupeKey: top.dedupeKey,
      reason: 'The top trip candidate is high confidence and clearly ahead of the runner-up.',
    });
  }
});

it('findTripCandidates asks the user when candidates are close or not high confidence and returns none for empty results', async () => {
  const auth = AuthFactory.create();
  const assetIds = [newUuid(), newUuid()];
  const session = makeSession({ userId: auth.user.id, approvalMode: AgentApprovalMode.PlanOnly });
  sessionRepository.getById.mockResolvedValue(session);
  tripCandidateService.materializeAlbumReadySelection.mockResolvedValue(makeTripSelection(assetIds));
  accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set(assetIds));
  assetRepository.getAgentReadableIds.mockResolvedValue(new Set(assetIds));

  tripCandidateService.findRecentTripCandidates.mockResolvedValueOnce([
    makeTripCandidate({ score: 80, confidence: 'high' }),
    makeTripCandidate({ dedupeKey: 'trip:usa:close', score: 70, confidence: 'high' }),
  ]);
  const closeResult = await sut.findTripCandidates(auth, session.id, {
    placeHint: 'USA',
    lookbackDays: 180,
    maxCandidates: 3,
  });
  expect(closeResult.status).toBe('success');
  if (closeResult.status === 'success') {
    expect(closeResult.recommendation).toMatchObject({ action: 'ask_user' });
  }

  tripCandidateService.findRecentTripCandidates.mockResolvedValueOnce([
    makeTripCandidate({ score: 90, confidence: 'medium' }),
  ]);
  const mediumResult = await sut.findTripCandidates(auth, session.id, { lookbackDays: 180, maxCandidates: 3 });
  expect(mediumResult.status).toBe('success');
  if (mediumResult.status === 'success') {
    expect(mediumResult.recommendation).toMatchObject({ action: 'ask_user' });
  }

  tripCandidateService.findRecentTripCandidates.mockResolvedValueOnce([]);
  const noneResult = await sut.findTripCandidates(auth, session.id, { lookbackDays: 180, maxCandidates: 3 });
  expect(noneResult.status).toBe('success');
  if (noneResult.status === 'success') {
    expect(noneResult.recommendation).toEqual({
      action: 'none',
      reason: 'No readable trip candidates matched the request.',
    });
  }
});
```

- [ ] **Step 4: Run service test and verify it fails**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-tool.service.spec.ts -t "findTripCandidates recommends|findTripCandidates asks" --run
```

Expected: FAIL because service responses do not include `recommendation`.

- [ ] **Step 5: Implement DTO schema and service classification**

In `server/src/dtos/agent-tool.dto.ts`, add `AgentTripCandidateRecommendationSchema` from "Recommendation Shape" and include it in `AgentFindTripCandidatesToolSuccessResponse`.

In `server/src/services/agent-tool.service.ts`:

1. Add `AgentTripCandidateRecommendation` near `AgentTripCandidateToolResult`.
2. Change the descriptor result type from:

```ts
{
  summary: string;
  candidates: AgentTripCandidateToolResult[];
}
```

to:

```ts
{
  summary: string;
  recommendation: AgentTripCandidateRecommendation;
  candidates: AgentTripCandidateToolResult[];
}
```

3. In `execute`, return:

```ts
return {
  summary: this.getFindTripCandidatesSummary(mappedCandidates.length, request.placeHint),
  recommendation: this.buildTripCandidateRecommendation(mappedCandidates),
  candidates: mappedCandidates,
};
```

4. Add `buildTripCandidateRecommendation()` from "Recommendation Shape" below `getFindTripCandidatesSummary()`.

- [ ] **Step 6: Update mocked MCP service responses and contract wording**

In `server/src/services/agent-mcp.service.spec.ts`, add this helper near the test cases if no local helper exists:

```ts
const noTripCandidateRecommendation = {
  action: 'none' as const,
  reason: 'No readable trip candidates matched the request.',
};
```

Add `recommendation: noTripCandidateRecommendation` to every mocked `findTripCandidates` success response.

In `server/src/services/agent-mcp-tool-contract.service.ts`, update the `findTripCandidatesContract.usage` string to mention:

```ts
'Follow recommendation.action: use_top_candidate means use candidateDedupeKey, ask_user means ask one question with candidate labels, and none means ask for one concrete source before planning.';
```

In `server/src/services/agent-mcp-tool-contract.service.spec.ts`, extend the existing trip candidate workflow test so it asserts the contract documents `recommendation.action`, `use_top_candidate`, `ask_user`, and `none`.

- [ ] **Step 7: Run focused server tests**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/dtos/agent-tool.dto.spec.ts src/services/agent-tool.service.spec.ts src/services/agent-mcp.service.spec.ts src/services/agent-mcp-tool-contract.service.spec.ts --run
```

Expected: PASS.

- [ ] **Step 8: Commit Task 1**

```bash
git add server/src/dtos/agent-tool.dto.ts server/src/dtos/agent-tool.dto.spec.ts server/src/services/agent-tool.service.ts server/src/services/agent-tool.service.spec.ts server/src/services/agent-mcp.service.spec.ts server/src/services/agent-mcp-tool-contract.service.ts server/src/services/agent-mcp-tool-contract.service.spec.ts
git commit -m "feat: add trip candidate recommendations"
```

## Task 2: Update Prompt Guidance For Recent Trip Albums

**Files:**

- Modify: `server/src/services/agent-mcp-prompt.service.ts`
- Modify: `server/src/services/agent-mcp-prompt.service.spec.ts`
- Modify: `agent-runner/src/pi-runtime.mjs`
- Modify: `agent-runner/src/pi-runtime.test.mjs`

- [ ] **Step 1: Write failing prompt-service tests**

In `server/src/services/agent-mcp-prompt.service.spec.ts`, add:

```ts
it('teaches the handle-first recent trip album workflow', () => {
  const prompt = sut.generatePromptCheatSheet();

  expect(prompt).toContain('Trip albums: findTripCandidates first');
  expect(prompt).toContain('recommendation.action');
  expect(prompt).toContain('use_top_candidate');
  expect(prompt).toContain('ask_user');
  expect(prompt).toContain('none');
  expect(prompt).toContain('generic handle->proposeAlbumFromSelection');
  expect(prompt).toContain('highlights default 10->curateSelection');
  expect(prompt).not.toMatch(/trip album requests.*searchAssets/i);
  expect(prompt).not.toMatch(/copy .*assetIds/i);
  expect(prompt.length).toBeLessThanOrEqual(maxPromptLength);
});
```

- [ ] **Step 2: Run prompt-service test and verify it fails**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-mcp-prompt.service.spec.ts -t "recent trip album workflow" --run
```

Expected: FAIL because the generated cheat sheet does not contain the new trip workflow line.

- [ ] **Step 3: Write failing Pi runtime prompt tests**

Update `agent-runner/src/pi-runtime.test.mjs` in the system prompt test:

Replace the old assertions:

```js
assert.equal(calls.loaders[0].systemPrompt.includes('metadata-only trip album requests'), true);
assert.equal(
  calls.loaders[0].systemPrompt.includes('use mcp_gallery_searchAssets with location and taken-date metadata'),
  true,
);
assert.equal(
  calls.loaders[0].systemPrompt.includes('If a metadata-only trip search returns more than 250 candidate assets'),
  true,
);
```

with:

```js
assert.equal(
  calls.loaders[0].systemPrompt.includes(
    'For recent trip album requests, call mcp_gallery_findTripCandidates before asking for dates',
  ),
  true,
);
assert.equal(calls.loaders[0].systemPrompt.includes('Follow findTripCandidates.recommendation.action'), true);
assert.equal(
  calls.loaders[0].systemPrompt.includes(
    'Generic trip albums pass candidate selectionHandle.id directly to mcp_gallery_proposeAlbumFromSelection',
  ),
  true,
);
assert.equal(calls.loaders[0].systemPrompt.includes('explicit top/best/highlights default to 10'), true);
assert.equal(
  calls.loaders[0].systemPrompt.includes('use mcp_gallery_searchAssets with location and taken-date metadata'),
  false,
);
assert.equal(
  calls.loaders[0].systemPrompt.includes('If a metadata-only trip search returns more than 250 candidate assets'),
  false,
);
```

- [ ] **Step 4: Run Pi runtime prompt test and verify it fails**

Run:

```bash
pnpm --dir agent-runner test -- --test-name-pattern "passes Gallery MCP guidance"
```

Expected: FAIL because `runnerBehaviorPrompt` still teaches search-based trip albums.

- [ ] **Step 5: Implement prompt guidance**

In `server/src/services/agent-mcp-prompt.service.ts`, add this compact line after the curation lines:

```ts
        'Trip albums: findTripCandidates first; follow recommendation.action use_top_candidate/ask_user/none; generic handle->proposeAlbumFromSelection; highlights default 10->curateSelection->proposeAlbumFromSelection; disclose duplicate/stack exclusions; never asset IDs.',
```

If `maxPromptLength` fails, shorten older redundant text instead of removing any trip requirements. Keep the whole prompt under 4700 characters.

In `agent-runner/src/pi-runtime.mjs`, replace the three old trip-search lines in `runnerBehaviorPrompt` with:

```js
  'For recent trip album requests, call mcp_gallery_findTripCandidates before asking for dates; include placeHint when the user names a place and omit it otherwise.',
  'Follow findTripCandidates.recommendation.action: use_top_candidate means create a reviewable plan for candidateDedupeKey, ask_user means ask one question with candidate labels, and none means ask for one concrete source before planning.',
  'Generic trip albums pass candidate selectionHandle.id directly to mcp_gallery_proposeAlbumFromSelection; explicit top/best/highlights default to 10 and use mcp_gallery_curateSelection before proposing.',
  'For trip album final copy, disclose the assumed trip window and duplicate/stack exclusions; disclose metadata-only curation only for explicit highlights.',
```

- [ ] **Step 6: Run prompt tests**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-mcp-prompt.service.spec.ts --run
pnpm --dir agent-runner test -- --test-name-pattern "passes Gallery MCP guidance"
```

Expected: PASS.

- [ ] **Step 7: Commit Task 2**

```bash
git add server/src/services/agent-mcp-prompt.service.ts server/src/services/agent-mcp-prompt.service.spec.ts agent-runner/src/pi-runtime.mjs agent-runner/src/pi-runtime.test.mjs
git commit -m "docs: guide pi recent trip album flows"
```

## Task 3: Implement Deterministic Runner Recent-Trip Flow

**Files:**

- Modify: `agent-runner/src/e2e-runtime.mjs`
- Modify: `agent-runner/src/e2e-runtime.test.mjs`

- [ ] **Step 1: Add trip candidate e2e helpers**

In `agent-runner/src/e2e-runtime.test.mjs`, replace `usaTripHandleFirstHandlers` with a trip-candidate helper or add this new helper next to it:

```js
const tripCandidateHandleId = '00000000-0000-4000-8000-000000000921';
const tripCandidateCuratedHandleId = '00000000-0000-4000-8000-000000000922';

const makeTripCandidateSummary = (overrides = {}) => ({
  dedupeKey: 'trip:usa:new-york:2026-05-03:2026-05-12',
  title: 'Recent trip to New York, USA',
  subtitle: '28 photos over 10 days',
  countries: ['USA'],
  states: ['New York'],
  cities: ['New York'],
  takenAfter: '2026-05-03T00:00:00.000Z',
  takenBefore: '2026-05-12T23:59:59.000Z',
  assetCount: 32,
  albumAssetCount: 28,
  excludedDuplicateCount: 3,
  excludedStackChildCount: 1,
  dayCount: 10,
  score: 90,
  confidence: 'high',
  placeLabels: ['New York, USA'],
  selectionHandle: {
    id: tripCandidateHandleId,
    sourceRef: `asset-source:search:${tripCandidateHandleId}`,
    assetCount: 28,
  },
  ...overrides,
});

const tripCandidateHandlers = ({
  candidates = [makeTripCandidateSummary()],
  recommendation = {
    action: 'use_top_candidate',
    candidateDedupeKey: 'trip:usa:new-york:2026-05-03:2026-05-12',
    reason: 'The only readable trip candidate is high confidence.',
  },
  expectedPlaceHint = 'USA',
  expectedAlbumName = 'USA Trip',
  expectedHighlightCount = 10,
  selectedAssetCount = expectedHighlightCount,
} = {}) => [
  {
    name: 'findTripCandidates',
    handle: (args, request) => {
      assert.deepEqual(args, expectedPlaceHint === null ? {} : { placeHint: expectedPlaceHint });
      return {
        body: {
          jsonrpc: '2.0',
          id: request.id,
          result: {
            structuredContent: {
              status: 'success',
              summary:
                candidates.length === 0
                  ? 'No trip candidates found matching "USA".'
                  : `Found ${candidates.length} trip candidate(s) matching "USA".`,
              recommendation,
              candidates,
            },
          },
        },
      };
    },
  },
  {
    name: 'curateSelection',
    handle: (args, request) => {
      assert.deepEqual(args, {
        selectionHandleId: tripCandidateHandleId,
        targetCount: expectedHighlightCount,
        strategy: 'metadata-highlights',
        criteria: 'top metadata-only highlights from USA Trip',
        sampleSize: 10,
      });
      return {
        body: {
          jsonrpc: '2.0',
          id: request.id,
          result: {
            structuredContent: {
              status: 'success',
              selectionHandle: { id: tripCandidateCuratedHandleId, assetCount: selectedAssetCount },
              selectedAssetCount,
              sourceAssetCount: candidates[0]?.selectionHandle?.assetCount ?? 0,
              criteriaSummary: ['metadata-only highlights from the trip candidate handle'],
            },
          },
        },
      };
    },
  },
  {
    name: 'proposeAlbumFromSelection',
    handle: (args, request) => ({
      body: {
        jsonrpc: '2.0',
        id: request.id,
        result: {
          structuredContent: {
            status: 'success',
            summary: 'Stored proposed album from selection.',
            plan: { id: '00000000-0000-4000-8000-000000000923' },
            received: args,
          },
        },
      },
    }),
  },
];
```

- [ ] **Step 2: Write failing generic trip album e2e test**

Replace the old search-based USA trip test or add:

```js
it('creates a generic USA recent-trip album from the trip candidate handle without asking for dates', async () => {
  const { calls, fetchImplementation } = createFetch(tripCandidateHandlers());
  const runtime = createE2eRuntime({ fetch: fetchImplementation });
  await runtime.createSession(createSessionBody());

  const events = await collectEvents(runtime, 'Create an album for my recent trip to USA');

  assert.equal(calls.map((call) => call.body.params.name).join(','), 'findTripCandidates,proposeAlbumFromSelection');
  assert.deepEqual(calls[0].body.params.arguments, { placeHint: 'USA' });
  assert.equal(calls[1].body.params.arguments.albumName, 'USA Trip');
  assert.equal(calls[1].body.params.arguments.selectionHandleId, tripCandidateHandleId);
  assert.equal(JSON.stringify(calls).includes('assetIds'), false);
  assert.doesNotMatch(events.at(-1).content.blocks[0].text, /need.*date|rough dates/i);
  assert.match(events.at(-1).content.blocks[0].text, /May 3-12, 2026/i);
  assert.match(events.at(-1).content.blocks[0].text, /skipped 3 known duplicate variants and 1 stack child/i);
  assert.match(events.at(-1).content.blocks[0].text, /Review/i);
});

it('creates a recent-trip album without a place hint after calling the detector with no arguments', async () => {
  const { calls, fetchImplementation } = createFetch(
    tripCandidateHandlers({ expectedPlaceHint: null, expectedAlbumName: 'Recent Trip' }),
  );
  const runtime = createE2eRuntime({ fetch: fetchImplementation });
  await runtime.createSession(createSessionBody());

  const events = await collectEvents(runtime, 'Create an album for my recent trip');

  assert.equal(calls.map((call) => call.body.params.name).join(','), 'findTripCandidates,proposeAlbumFromSelection');
  assert.deepEqual(calls[0].body.params.arguments, {});
  assert.equal(calls[1].body.params.arguments.albumName, 'Recent Trip');
  assert.match(events.at(-1).content.blocks[0].text, /Review/i);
});
```

- [ ] **Step 3: Write failing highlight trip e2e tests**

Add:

```js
it('creates trip highlights through findTripCandidates, curation, and a reviewable album plan', async () => {
  const { calls, fetchImplementation } = createFetch(
    tripCandidateHandlers({ expectedHighlightCount: 15, selectedAssetCount: 15 }),
  );
  const runtime = createE2eRuntime({ fetch: fetchImplementation });
  await runtime.createSession(createSessionBody());

  const events = await collectEvents(
    runtime,
    'Create an album of the top 15 highlights for my recent trip to USA called USA Highlights.',
  );

  assert.equal(
    calls.map((call) => call.body.params.name).join(','),
    'findTripCandidates,curateSelection,proposeAlbumFromSelection',
  );
  assert.equal(calls[1].body.params.arguments.selectionHandleId, tripCandidateHandleId);
  assert.equal(calls[1].body.params.arguments.targetCount, 15);
  assert.equal(calls[2].body.params.arguments.albumName, 'USA Highlights');
  assert.equal(calls[2].body.params.arguments.selectionHandleId, tripCandidateCuratedHandleId);
  assert.equal(JSON.stringify(calls).includes('assetIds'), false);
  assert.match(events.at(-1).content.blocks[0].text, /15 metadata-only suggested highlights/i);
  assert.match(events.at(-1).content.blocks[0].text, /Review/i);
});

it('defaults recent-trip highlights to 10 when no count is provided', async () => {
  const { calls, fetchImplementation } = createFetch(tripCandidateHandlers());
  const runtime = createE2eRuntime({ fetch: fetchImplementation });
  await runtime.createSession(createSessionBody());

  await collectEvents(runtime, 'Create an album of the top highlights for my recent trip to USA');

  assert.equal(
    calls.map((call) => call.body.params.name).join(','),
    'findTripCandidates,curateSelection,proposeAlbumFromSelection',
  );
  assert.equal(calls[1].body.params.arguments.targetCount, 10);
});

it('detects the recent trip before asking for a valid explicit highlight count', async () => {
  const { calls, fetchImplementation } = createFetch(tripCandidateHandlers());
  const runtime = createE2eRuntime({ fetch: fetchImplementation });
  await runtime.createSession(createSessionBody());

  const events = await collectEvents(runtime, 'Create an album of the top 0 highlights for my recent trip to USA');

  assert.equal(calls.map((call) => call.body.params.name).join(','), 'findTripCandidates');
  assert.match(events.at(-1).content.blocks[0].text, /positive count/i);
});
```

- [ ] **Step 4: Write failing ask/none recommendation e2e tests**

Add:

```js
it('asks one question with candidate labels when the trip tool recommends asking the user', async () => {
  const candidates = [
    makeTripCandidateSummary({ title: 'Recent trip to New York, USA', dedupeKey: 'trip:ny', score: 95 }),
    makeTripCandidateSummary({
      title: 'Recent trip to California, USA',
      dedupeKey: 'trip:ca',
      placeLabels: ['California, USA'],
      score: 40,
    }),
  ];
  const { calls, fetchImplementation } = createFetch(
    tripCandidateHandlers({
      candidates,
      recommendation: { action: 'ask_user', reason: 'Multiple plausible trip candidates are close together.' },
    }),
  );
  const runtime = createE2eRuntime({ fetch: fetchImplementation });
  await runtime.createSession(createSessionBody());

  const events = await collectEvents(runtime, 'Create an album for my recent trip to USA');

  assert.equal(calls.map((call) => call.body.params.name).join(','), 'findTripCandidates');
  assert.match(events.at(-1).content.blocks[0].text, /New York, USA/i);
  assert.match(events.at(-1).content.blocks[0].text, /California, USA/i);
  assert.match(events.at(-1).content.blocks[0].text, /\?$/);
});

it('does not plan when no trip candidate is found and asks for one concrete source', async () => {
  const { calls, fetchImplementation } = createFetch(
    tripCandidateHandlers({
      candidates: [],
      recommendation: { action: 'none', reason: 'No readable trip candidates matched the request.' },
    }),
  );
  const runtime = createE2eRuntime({ fetch: fetchImplementation });
  await runtime.createSession(createSessionBody());

  const events = await collectEvents(runtime, 'Create an album for my recent trip to USA');

  assert.equal(calls.map((call) => call.body.params.name).join(','), 'findTripCandidates');
  assert.match(events.at(-1).content.blocks[0].text, /could not find a likely recent trip/i);
  assert.match(events.at(-1).content.blocks[0].text, /date range or place/i);
  assert.doesNotMatch(events.at(-1).content.blocks[0].text, /Review the plan/i);
});
```

The `ask_user` test intentionally gives a much higher top score and still expects no plan. That proves the runner follows `recommendation.action` instead of independently interpreting scores.

- [ ] **Step 5: Run e2e tests and verify they fail**

Run:

```bash
pnpm --dir agent-runner test -- --test-name-pattern "recent-trip|trip highlights|trip tool recommends|no trip candidate"
```

Expected: FAIL because the runner does not parse these trip flows yet and old USA highlight tests still use `searchAssets`.

- [ ] **Step 6: Implement recent trip parsing and flow**

In `agent-runner/src/e2e-runtime.mjs`, add helpers before `parseHighlightPrompt`:

```js
const parseRecentTripPrompt = (prompt) => {
  if (!/\brecent\s+trip\b/i.test(prompt) || !/\balbum\b/i.test(prompt)) {
    return null;
  }

  const placeHint = /\b(?:USA|United States|U\.S\.)\b/i.test(prompt) ? 'USA' : null;
  const countMatch =
    prompt.match(/(?:^|\s)(-?\d+)\s+(?:best\s+)?(?:highlights?|photos?)\b/i) ??
    prompt.match(/\b(?:best|top|pick|choose|suggest)\s+(-?\d+)\s+(?:highlights?|photos?)\b/i);
  const requestedCount = countMatch ? Number(countMatch[1]) : null;
  const highlights = /\b(top|best|highlights?)\b/i.test(prompt);
  const albumName = /called\b/i.test(prompt)
    ? extractAlbumName(prompt)
    : highlights
      ? `${placeHint ?? 'Trip'} Highlights`
      : `${placeHint ?? 'Recent'} Trip`;

  return {
    placeHint,
    highlights,
    requestedCount,
    effectiveCount: highlights ? (requestedCount ?? defaultHighlightCount) : null,
    albumName,
  };
};

const tripCandidateDateRange = (candidate) => {
  const after = new Date(candidate.takenAfter);
  const before = new Date(candidate.takenBefore);
  const month = after.toLocaleString('en-US', { month: 'long', timeZone: 'UTC' });
  const startDay = after.getUTCDate();
  const endDay = before.getUTCDate();
  const year = before.getUTCFullYear();
  return `${month} ${startDay}-${endDay}, ${year}`;
};

const tripCandidateLabel = (candidate) =>
  Array.isArray(candidate.placeLabels) && candidate.placeLabels.length > 0
    ? candidate.placeLabels.join(' and ')
    : candidate.title?.replace(/^Recent trip to\s+/i, '') || candidate.subtitle || 'that trip';

const duplicateExclusionText = (candidate) => {
  const duplicateCount = candidate.excludedDuplicateCount ?? 0;
  const stackCount = candidate.excludedStackChildCount ?? 0;
  if (duplicateCount === 0 && stackCount === 0) return '';
  const parts = [];
  if (duplicateCount > 0) parts.push(`${duplicateCount} known duplicate variant${duplicateCount === 1 ? '' : 's'}`);
  if (stackCount > 0) parts.push(`${stackCount} stack child${stackCount === 1 ? '' : 'ren'}`);
  return ` I skipped ${parts.join(' and ')}.`;
};
```

Add proposal helper near `proposeMetadataHighlightAlbumFromSelection`:

```js
const proposeTripAlbumFromSelection = async (
  client,
  { albumName, selectionHandleId, assetCount, candidate, highlights },
) => {
  const label = tripCandidateLabel(candidate);
  await client.call('proposeAlbumFromSelection', {
    summary: highlights
      ? `Create ${albumName} with ${assetCount} metadata-only curated highlights from ${label}.`
      : `Create ${albumName} with ${assetCount} trip assets from ${label}.`,
    albumName,
    description: highlights
      ? 'Trip highlights selected from metadata signals. No previews were inspected.'
      : `Album-ready trip selection from ${label}. Known duplicate variants and stack children were excluded when detected.`,
    selectionHandleId,
  });
};
```

In `sendMessage`, before `const highlightPrompt = parseHighlightPrompt(prompt);`, add:

```js
      const tripPrompt = parseRecentTripPrompt(prompt);
      if (tripPrompt) {
        const tripResult = await client.call('findTripCandidates', tripPrompt.placeHint ? { placeHint: tripPrompt.placeHint } : {});
        assertMcpResultSuccess(tripResult, 'Trip candidate lookup');
        const candidates = Array.isArray(tripResult.candidates) ? tripResult.candidates : [];
        const recommendation = tripResult.recommendation;

        if (tripPrompt.highlights && tripPrompt.requestedCount !== null && tripPrompt.requestedCount <= 0) {
          yield completedEvent({ gallerySessionId, runnerSessionId, text: 'Please choose a positive count before I suggest trip highlights.' });
          return;
        }

        if (tripPrompt.highlights && tripPrompt.effectiveCount > metadataHighlightCandidateLimit) {
          yield completedEvent({ gallerySessionId, runnerSessionId, text: 'Please choose 1000 or fewer trip highlights, or narrow the source before curation.' });
          return;
        }

        if (recommendation?.action === 'none' || candidates.length === 0) {
          yield completedEvent({
            gallerySessionId,
            runnerSessionId,
            text: 'I could not find a likely recent trip from the available date and location metadata. Which date range or place should I use for the album?',
          });
          return;
        }

        if (recommendation?.action === 'ask_user') {
          const labels = candidates.map(tripCandidateLabel).slice(0, 5).join('; ');
          yield completedEvent({
            gallerySessionId,
            runnerSessionId,
            text: `I found multiple possible recent trips: ${labels}. Which one should I use?`,
          });
          return;
        }

        const candidate =
          candidates.find((item) => item.dedupeKey === recommendation?.candidateDedupeKey) ?? candidates[0];
        const selectionHandleId = candidate?.selectionHandle?.id;
        if (!candidate || !selectionHandleId) {
          yield completedEvent({
            gallerySessionId,
            runnerSessionId,
            text: 'I found a trip candidate but could not get an album-ready selection handle. Please try again or give me a date range.',
          });
          return;
        }

        if (tripPrompt.highlights) {
          const curated = await curateMetadataHighlights(
            client,
            selectionHandleId,
            tripPrompt.effectiveCount,
            `top metadata-only highlights from ${tripPrompt.albumName}`,
          );
          const selectedCount =
            typeof curated.selectedAssetCount === 'number'
              ? curated.selectedAssetCount
              : curated.selectionHandle.assetCount ?? tripPrompt.effectiveCount;
          await proposeTripAlbumFromSelection(client, {
            albumName: tripPrompt.albumName,
            selectionHandleId: curated.selectionHandle.id,
            assetCount: selectedCount,
            candidate,
            highlights: true,
          });
          yield completedEvent({
            gallerySessionId,
            runnerSessionId,
            text: `I found a likely ${tripCandidateLabel(candidate)} trip from ${tripCandidateDateRange(candidate)} and proposed ${selectedCount} metadata-only suggested highlights for ${tripPrompt.albumName}. Review the plan before applying it.`,
          });
          return;
        }

        const assetCount = candidate.selectionHandle.assetCount ?? candidate.albumAssetCount ?? 0;
        await proposeTripAlbumFromSelection(client, {
          albumName: tripPrompt.albumName,
          selectionHandleId,
          assetCount,
          candidate,
          highlights: false,
        });
        yield completedEvent({
          gallerySessionId,
          runnerSessionId,
          text: `I found a likely ${tripCandidateLabel(candidate)} trip from ${tripCandidateDateRange(candidate)} and proposed ${tripPrompt.albumName} with ${assetCount} assets.${duplicateExclusionText(candidate)} Review the plan before applying it.`,
        });
        return;
      }
```

- [ ] **Step 7: Run e2e tests**

Run:

```bash
pnpm --dir agent-runner test -- --test-name-pattern "recent-trip|trip highlights|trip tool recommends|no trip candidate"
```

Expected: PASS.

- [ ] **Step 8: Run the full agent-runner test suite**

Run:

```bash
pnpm --dir agent-runner test
```

Expected: PASS.

- [ ] **Step 9: Commit Task 3**

```bash
git add agent-runner/src/e2e-runtime.mjs agent-runner/src/e2e-runtime.test.mjs
git commit -m "feat: route recent trip albums through trip candidates"
```

## Task 4: Regenerate Artifacts And Final Verification

**Files:**

- Generated: `agent-runner/src/generated/gallery-mcp-prompt-cheat-sheet.mjs`
- Generated: `docs/superpowers/generated/pi-agent-mcp-tools.md`
- Generated: `open-api/immich-openapi-specs.json`
- Generated as needed: `open-api/typescript-sdk/**`

- [ ] **Step 1: Build server before sync scripts**

Run:

```bash
pnpm --dir server build
```

Expected: PASS.

- [ ] **Step 2: Regenerate prompt, MCP docs, and OpenAPI artifacts**

Run:

```bash
pnpm --dir server run sync:agent-mcp-prompt
pnpm --dir server run sync:agent-mcp-docs
pnpm --dir server run sync:open-api
cd open-api && ./bin/generate-open-api.sh typescript
```

Expected:

- `agent-runner/src/generated/gallery-mcp-prompt-cheat-sheet.mjs` contains the compact trip guidance line.
- `docs/superpowers/generated/pi-agent-mcp-tools.md` documents `recommendation`.
- `open-api/immich-openapi-specs.json` includes `AgentTripCandidateRecommendation`.
- TypeScript SDK changes only if the OpenAPI generator emits them.

- [ ] **Step 3: Verify generated artifacts**

Run:

```bash
rg -n "recommendation|AgentTripCandidateRecommendation|use_top_candidate|ask_user|none" docs/superpowers/generated/pi-agent-mcp-tools.md open-api/immich-openapi-specs.json agent-runner/src/generated/gallery-mcp-prompt-cheat-sheet.mjs
rg -n "Trip albums: findTripCandidates first" agent-runner/src/generated/gallery-mcp-prompt-cheat-sheet.mjs server/src/services/agent-mcp-prompt.service.ts
```

Expected: Both commands find the new contract/guidance.

- [ ] **Step 4: Run full focused verification**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/dtos/agent-tool.dto.spec.ts src/controllers/agent-tool.controller.spec.ts src/services/agent-tool.service.spec.ts src/services/agent-mcp.service.spec.ts src/services/agent-mcp-tool-registry.service.spec.ts src/services/agent-mcp-tool-contract.service.spec.ts src/services/agent-mcp-prompt.service.spec.ts src/services/agent-mcp-docs.service.spec.ts src/services/agent-runner-flow.integration.spec.ts --run
pnpm --dir agent-runner test
pnpm --dir server check
git diff --check
```

Expected: PASS.

- [ ] **Step 5: Run no-raw-ID guard**

Run:

```bash
rg -n "assetIds|sampleAssetIds" server/src/dtos/agent-tool.dto.ts server/src/services/agent-tool.service.ts docs/superpowers/generated/pi-agent-mcp-tools.md | rg "TripCandidate|findTripCandidates|AgentFindTripCandidates" || true
```

Expected: no output. If generated docs include generic unrelated asset ID guidance on the same line, inspect manually and only accept it when the `findTripCandidates` response shape itself has no raw asset IDs.

- [ ] **Step 6: Commit generated artifacts**

```bash
git add agent-runner/src/generated/gallery-mcp-prompt-cheat-sheet.mjs docs/superpowers/generated/pi-agent-mcp-tools.md open-api/immich-openapi-specs.json open-api/typescript-sdk
git commit -m "docs: regenerate trip candidate tool artifacts"
```

- [ ] **Step 7: Final status and push**

Run:

```bash
git status --short --branch
git log --oneline --decorate -6
git push
```

Expected: branch is clean after push and `origin/explore/pi-agent-brainstorm` contains the Slice 6 commits.

## Plan Self-Review

- Spec coverage: covers all Slice 6 tests, including generic trip album, explicit highlights, default 10, no date-first question, ask-user, none, recommendation-following, duplicate/stack disclosure, and no raw asset IDs.
- Contract gap: resolved by adding `recommendation.action` before runner work, so the runner does not interpret scores.
- TDD: every behavior starts with failing tests and expected red output before implementation.
- Edge cases: handles no candidates, low-confidence/close candidates, invalid highlight counts, missing selection handles, duplicate/stack exclusion copy, no place hint, and provider-visible ID avoidance.
- Scope: does not implement future album suggestions, visual quality scoring, or broad trip NLP.
