# Pi Agent Strict Recent Trip Album Slice 7 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add end-to-end server regression coverage proving a strict recent-trip album request creates a persisted reviewable plan from the trip candidate handle and that failed planning shows no plan card or success copy.

**Architecture:** Extend the existing in-memory `AgentRunnerService` flow harness in `server/src/services/agent-runner-flow.integration.spec.ts`. The runner handler will exercise the real Gallery MCP service with the strict tool sequence (`findTripCandidates`, then `proposeAlbumFromSelection`) while a test-only trip candidate service feeds deterministic trip candidates into the real `AgentToolService` and `AgentOperationPlanService` pipeline.

**Tech Stack:** Vitest, Nest service units, in-memory repositories, Gallery MCP JSON-RPC request helpers, existing agent runner flow harness.

---

## Spec Scope

Implements Slice 7 from `docs/superpowers/specs/2026-05-28-pi-agent-strict-recent-trip-album-design.md`.

Covered requirements:

- Prompt: `Create an album for my recent trip to USA`.
- Tool sequence: `findTripCandidates,proposeAlbumFromSelection`.
- No `searchAssets` call.
- `agent_operation_plan` row exists after the turn, represented in the flow harness by `harness.operationPlans.plans`.
- UI/session activity includes `operation-plan-ready`.
- Persisted plan contains exactly album create and album add-assets operations, with add-assets resolved from the trip candidate selection handle.
- Assistant text includes the trip date range and selected asset count.
- Assistant text does not ask for dates before running the detector.
- Failed planning produces no plan card and no success copy.

Not included:

- Real external agent-runner HTTP process.
- Browser Playwright UI flow.
- Applying the generated plan.

## File Structure

- Modify `server/src/services/agent-runner-flow.integration.spec.ts`
  - Import the `TripCandidate` type.
  - Add local test helpers for deterministic trip candidates.
  - Add a successful strict recent-trip flow regression.
  - Add a failed-planning strict recent-trip regression.

## Task 1: Strict Recent Trip Success Regression

**Files:**

- Modify: `server/src/services/agent-runner-flow.integration.spec.ts`

- [ ] **Step 1: Add the failing integration test and helper references**

Add this import near the existing service imports:

```ts
import type { TripCandidate } from 'src/services/trip-candidate.service';
```

Add this test near the top of `describe('Pi agent runner flow harness', () => {`, before the existing South Africa regression:

```ts
it('creates a strict recent-trip album plan from the trip candidate handle', async () => {
  const harness = setup();
  const tripAssetIds = [newUuid(), newUuid(), newUuid(), newUuid()];
  const { candidate } = configureRecentTripCandidateHarness(harness, { assetIds: tripAssetIds });
  let tripCandidateSelectionHandleId: string | undefined;

  harness.configureRunnerMessage(async function* ({ body }) {
    const prompt = body.content.blocks
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('\n');
    expect(prompt).toBe('Create an album for my recent trip to USA');

    const tripResult = getMcpToolResult(
      await harness.mcpService.handle(
        harness.auth,
        body.gallerySessionId,
        makeMcpToolCallRequest(AgentToolName.FindTripCandidates, { placeHint: 'USA' }),
      ),
    );
    expect(tripResult.isError).not.toBe(true);
    const tripContent = tripResult.structuredContent as {
      recommendation: { action: string; candidateDedupeKey?: string };
      candidates: Array<{
        dedupeKey: string;
        selectionHandle: { id: string; assetCount: number };
      }>;
    };
    expect(tripContent.recommendation).toMatchObject({
      action: 'use_top_candidate',
      candidateDedupeKey: candidate.dedupeKey,
    });
    expect(tripContent.candidates).toHaveLength(1);
    tripCandidateSelectionHandleId = tripContent.candidates[0].selectionHandle.id;
    expect(tripContent.candidates[0].selectionHandle.assetCount).toBe(tripAssetIds.length);

    const created = getMcpToolResult(
      await harness.mcpService.handle(
        harness.auth,
        body.gallerySessionId,
        makeMcpToolCallRequest(AgentToolName.ProposeAlbumFromSelection, {
          summary: `Create USA Trip with ${tripAssetIds.length} trip assets from New York, USA.`,
          albumName: 'USA Trip',
          description: 'Album-ready trip selection from New York, USA.',
          selectionHandleId: tripCandidateSelectionHandleId,
        }),
      ),
    );
    expect(created.isError).not.toBe(true);
    expect((created.structuredContent as { plan: { id: string } }).plan.id).toEqual(expect.any(String));

    yield {
      type: 'assistant-message-completed',
      sessionId: body.gallerySessionId,
      runnerSessionId: 'runner-session-1',
      providerMessageId: 'provider-message-strict-trip-plan',
      content: {
        blocks: [
          {
            type: 'text',
            text: `I found a likely New York, USA trip from May 3-12, 2026 and proposed USA Trip with ${tripAssetIds.length} assets. Review the plan before applying it.`,
          },
        ],
      },
    };
  });

  const session = await harness.sessionService.create(harness.auth, {
    providerCredentialId: '00000000-0000-4000-8000-000000000201',
    model: 'gpt-5.1',
    permissionPreset: AgentPermissionPreset.VisualOrganizer,
    approvalMode: AgentApprovalMode.PlanOnly,
    initialContext: { entrypoint: 'assistant-page' },
  });

  await harness.messageService.appendUserMessage(harness.auth, session.id, {
    content: {
      blocks: [{ type: 'text', text: 'Create an album for my recent trip to USA' }],
    },
  });

  await waitFor(async () => {
    const messages = await harness.messageService.getMessages(harness.auth, session.id);
    const reloadedSession = await harness.sessions.getById(harness.auth.user.id, session.id);
    expect(reloadedSession?.status).toBe(AgentSessionStatus.WaitingForPlanReview);
    expect(messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: AgentMessageRole.Assistant,
          providerMessageId: 'provider-message-strict-trip-plan',
          content: {
            blocks: [
              expect.objectContaining({
                type: 'text',
                text: expect.stringMatching(/May 3-12, 2026.*4 assets.*Review the plan/i),
              }),
            ],
          },
        }),
      ]),
    );
  });

  expect(tripCandidateSelectionHandleId).toEqual(expect.any(String));
  expect(harness.toolCalls.toolCalls.map((toolCall) => toolCall.toolName)).toEqual([
    AgentToolName.FindTripCandidates,
    AgentToolName.ProposeAlbumFromSelection,
  ]);
  expect(harness.toolCalls.toolCalls.map((toolCall) => toolCall.toolName)).not.toContain(AgentToolName.SearchAssets);
  expect(harness.searchRepository.searchMetadata).not.toHaveBeenCalled();
  expect(harness.searchRepository.searchSmart).not.toHaveBeenCalled();

  expect(harness.selectionHandles.handles).toHaveLength(1);
  expect(harness.selectionHandles.handles[0]).toMatchObject({
    id: tripCandidateSelectionHandleId,
    assetIds: tripAssetIds,
    assetCount: tripAssetIds.length,
  });

  expect(harness.operationPlans.plans).toHaveLength(1);
  const [plan] = harness.operationPlans.plans;
  expect(plan.status).toBe(AgentOperationPlanStatus.Proposed);
  expect(plan.operations).toHaveLength(2);
  expect(plan.operations[0]).toMatchObject({
    type: AgentOperationType.AlbumCreate,
    targetKind: AgentOperationTargetKind.NewAlbum,
    temporaryTargetId: 'tmp-album-from-selection',
    payload: { albumName: 'USA Trip', description: 'Album-ready trip selection from New York, USA.' },
  });
  expect(plan.operations[1]).toMatchObject({
    type: AgentOperationType.AlbumAddAssets,
    targetKind: AgentOperationTargetKind.NewAlbum,
    temporaryTargetId: 'tmp-album-from-selection',
    assetIds: tripAssetIds,
    payload: {},
  });
  expect(plan.operations[1]).not.toHaveProperty('assetSelectionHandleId');

  expect(harness.websocketEvents.map(({ event }) => event.type)).toContain('operation-plan-ready');

  const assistantMessages = await harness.messageService.getMessages(harness.auth, session.id);
  const assistantText = assistantMessages
    .filter((message) => message.role === AgentMessageRole.Assistant)
    .flatMap((message) => message.content.blocks)
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('\n');
  expect(assistantText).not.toMatch(/rough dates|start and end|what dates|date range before/i);
});
```

This test intentionally references `configureRecentTripCandidateHarness` before it exists.

- [ ] **Step 2: Run the test and verify red**

Run:

```bash
pnpm --dir server test -- src/services/agent-runner-flow.integration.spec.ts --run
```

Expected: FAIL at TypeScript/test compile time because `configureRecentTripCandidateHarness` is not defined.

- [ ] **Step 3: Implement the deterministic trip-candidate helper**

Add these helpers above `describe('Pi agent runner flow harness', () => {`:

```ts
type AgentRunnerFlowHarness = ReturnType<typeof setup>;

const makeRecentUsaTripCandidate = (overrides: Partial<TripCandidate> = {}): TripCandidate => ({
  dedupeKey: 'trip:usa:new-york:2026-05-03:2026-05-12',
  title: 'Recent trip to New York, USA',
  subtitle: '4 photos over 10 days',
  countries: ['USA'],
  states: ['New York'],
  cities: ['New York'],
  takenAfter: new Date('2026-05-03T00:00:00.000Z'),
  takenBefore: new Date('2026-05-12T23:59:59.000Z'),
  assetCount: 4,
  albumAssetCount: 4,
  excludedDuplicateCount: 0,
  excludedStackChildCount: 0,
  dayCount: 10,
  score: 90,
  confidence: 'high',
  source: {
    kind: 'tripCandidate',
    dedupeKey: 'trip:usa:new-york:2026-05-03:2026-05-12',
    takenAfter: new Date('2026-05-03T00:00:00.000Z'),
    takenBefore: new Date('2026-05-12T23:59:59.000Z'),
    places: [{ country: 'USA', state: 'New York', city: 'New York' }],
    placeLabels: ['New York, USA'],
  },
  placeKey: 'USA|New York|New York',
  placeLabel: 'New York, USA',
  ...overrides,
});

const configureRecentTripCandidateHarness = (
  harness: AgentRunnerFlowHarness,
  options: { assetIds: string[]; candidate?: TripCandidate },
) => {
  const { assetIds } = options;
  const candidate =
    options.candidate ?? makeRecentUsaTripCandidate({ assetCount: assetIds.length, albumAssetCount: assetIds.length });

  harness.accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set(assetIds));
  harness.accessRepository.asset.checkSpaceAccess.mockResolvedValue(new Set());
  harness.assetRepository.getAgentReadableIds.mockResolvedValue(new Set(assetIds));
  (
    harness.toolService as unknown as {
      tripCandidateService: {
        findRecentTripCandidates: ReturnType<typeof vi.fn>;
        materializeAlbumReadySelection: ReturnType<typeof vi.fn>;
      };
    }
  ).tripCandidateService = {
    findRecentTripCandidates: vi.fn((request: { ownerId: string; placeHint?: string }) => {
      expect(request.ownerId).toBe(harness.auth.user.id);
      expect(request.placeHint).toBe('USA');
      return Promise.resolve([candidate]);
    }),
    materializeAlbumReadySelection: vi.fn((ownerId: string, source: TripCandidate['source']) => {
      expect(ownerId).toBe(harness.auth.user.id);
      expect(source.dedupeKey).toBe(candidate.dedupeKey);
      return Promise.resolve({
        assetIds,
        assetCount: assetIds.length,
        albumAssetCount: assetIds.length,
        excludedDuplicateCount: candidate.excludedDuplicateCount,
        excludedStackChildCount: candidate.excludedStackChildCount,
        hydrated: true,
      });
    }),
  };

  return { candidate };
};
```

- [ ] **Step 4: Run the integration test and verify green**

Run:

```bash
pnpm --dir server test -- src/services/agent-runner-flow.integration.spec.ts --run
```

Expected: PASS for the new test and existing file.

## Task 2: Strict Recent Trip Failed Planning Regression

**Files:**

- Modify: `server/src/services/agent-runner-flow.integration.spec.ts`

- [ ] **Step 1: Add the failing failed-planning test**

Add this test after the success regression:

```ts
it('does not show a strict recent-trip plan card or success copy when planning fails', async () => {
  const harness = setup();
  const tripAssetIds = [newUuid(), newUuid()];
  configureRecentTripCandidateHarness(harness, { assetIds: tripAssetIds });

  harness.configureRunnerMessage(async function* ({ body }) {
    const tripResult = getMcpToolResult(
      await harness.mcpService.handle(
        harness.auth,
        body.gallerySessionId,
        makeMcpToolCallRequest(AgentToolName.FindTripCandidates, { placeHint: 'USA' }),
      ),
    );
    expect(tripResult.isError).not.toBe(true);

    const denied = getMcpToolResult(
      await harness.mcpService.handle(
        harness.auth,
        body.gallerySessionId,
        makeMcpToolCallRequest(AgentToolName.ProposeAlbumFromSelection, {
          summary: 'Create USA Trip with an invalid trip handle.',
          albumName: 'USA Trip',
          description: 'Album-ready trip selection from New York, USA.',
          selectionHandleId: '00000000-0000-4000-8000-000000009999',
        }),
      ),
    );
    expect(denied.isError).toBe(true);

    yield {
      type: 'assistant-message-completed',
      sessionId: body.gallerySessionId,
      runnerSessionId: 'runner-session-1',
      providerMessageId: 'provider-message-strict-trip-failed-plan',
      content: {
        blocks: [
          {
            type: 'text',
            text: 'I could not create a reviewable album plan. Please try again or provide a more specific date range or place.',
          },
        ],
      },
    };
  });

  const session = await harness.sessionService.create(harness.auth, {
    providerCredentialId: '00000000-0000-4000-8000-000000000201',
    model: 'gpt-5.1',
    permissionPreset: AgentPermissionPreset.VisualOrganizer,
    approvalMode: AgentApprovalMode.PlanOnly,
    initialContext: { entrypoint: 'assistant-page' },
  });

  await harness.messageService.appendUserMessage(harness.auth, session.id, {
    content: {
      blocks: [{ type: 'text', text: 'Create an album for my recent trip to USA' }],
    },
  });

  await waitFor(async () => {
    const messages = await harness.messageService.getMessages(harness.auth, session.id);
    expect(messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: AgentMessageRole.Assistant,
          providerMessageId: 'provider-message-strict-trip-failed-plan',
        }),
      ]),
    );
  });

  const reloadedSession = await harness.sessions.getById(harness.auth.user.id, session.id);
  expect(reloadedSession?.status).toBe(AgentSessionStatus.Interrupted);
  expect(harness.operationPlans.plans).toHaveLength(0);
  expect(harness.websocketEvents.map(({ event }) => event.type)).not.toContain('operation-plan-ready');
  expect(harness.toolCalls.toolCalls.map((toolCall) => toolCall.toolName)).toEqual([
    AgentToolName.FindTripCandidates,
    AgentToolName.ProposeAlbumFromSelection,
  ]);
  expect(harness.toolCalls.toolCalls.map((toolCall) => toolCall.toolName)).not.toContain(AgentToolName.SearchAssets);

  const assistantMessages = await harness.messageService.getMessages(harness.auth, session.id);
  const assistantText = assistantMessages
    .filter((message) => message.role === AgentMessageRole.Assistant)
    .flatMap((message) => message.content.blocks)
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('\n');
  expect(assistantText).toMatch(/could not create a reviewable album plan/i);
  expect(assistantText).not.toMatch(/plan is ready|I created|I proposed|Review the plan/i);
});
```

- [ ] **Step 2: Run the test and verify red**

Run:

```bash
pnpm --dir server test -- src/services/agent-runner-flow.integration.spec.ts --run
```

Expected: PASS if the existing failed-planning path is already correct after Slices 4-6. The session should be `Interrupted`, matching the existing same-turn Gallery tool failure cleanup behavior while preserving the assistant failure response. This step is regression coverage for Slice 7; do not change production code unless the test exposes a real failure such as a persisted plan, `operation-plan-ready` activity, or success copy.

- [ ] **Step 3: Implement minimal fix if red**

If the failed-planning test fails, fix only the responsible production path. Do not alter the strict workflow semantics from earlier slices. Likely fixes are limited to:

- `server/src/services/agent-runner.service.ts` if runner failure events are incorrectly translated into plan-ready state.
- `server/src/services/agent-operation-plan.service.ts` if an invalid selection handle creates a partial plan before validation.

Run the test after each fix.

- [ ] **Step 4: Run final verification**

Run:

```bash
pnpm --dir server test -- src/services/agent-runner-flow.integration.spec.ts --run
pnpm --dir agent-runner test
git diff --check
```

Expected:

- Server flow integration file passes.
- Agent runner unit/e2e suite still passes.
- No whitespace errors.

## Commit

After tests pass:

```bash
git add server/src/services/agent-runner-flow.integration.spec.ts docs/superpowers/plans/2026-05-28-pi-agent-strict-recent-trip-album-slice-7.md
git commit -m "test: cover strict recent trip album flow"
```
