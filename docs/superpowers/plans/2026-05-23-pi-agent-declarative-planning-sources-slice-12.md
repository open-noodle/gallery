# Pi Agent Declarative Planning Sources Slice 12 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make source-backed planning visible in expanded activity, stable in compact activity, and auditable without huge identifier lists.

**Architecture:** The web activity view already derives compact and expanded rows from tool calls and explicit activity events; extend those mappings for the high-level source-backed planning tools and use completed response summaries only for safe source workflow rows. The server operation-plan service already owns planning audit records and apply activity events; add source summary metadata to existing redacted audit metadata and emit terminal `plan-composing` events around successful and unrecovered failed plan preparation.

**Tech Stack:** TypeScript, NestJS services, Vitest, Svelte/web activity view helpers, existing Gallery agent DTOs and enums.

---

## Files

- Modify: `web/src/routes/(user)/assistant/agent-activity-ui.spec.ts`
  - Add failing tests for source-aware expanded ordering, compact coalescing stability, high-level workflow tool labels, and terminal failed planning activity rows.
- Modify: `web/src/routes/(user)/assistant/agent-activity-ui.ts`
  - Add tool activity definitions for high-level source workflow tools.
  - Let safe source workflow tool rows use server response summaries in expanded and compact rows.
  - Surface plan activity event counts.
- Modify: `server/src/services/agent-operation-plan.service.spec.ts`
  - Add failing tests for completed plan activity events with counts, failed source-resolution activity events, and source summary audit metadata without huge ID lists.
- Modify: `server/src/types/agent-tool.types.ts`
  - Add typed `sourceSummaries` entries to planning request audit metadata.
- Modify: `server/src/services/agent-operation-plan.service.ts`
  - Emit `plan-composing` activity events for completed plan creation/revision and unrecovered preparation failures.
  - Add `sourceSummaries` to redacted planning audit metadata.

---

### Task 1: Web Source-Aware Activity Rows

**Files:**

- Modify: `web/src/routes/(user)/assistant/agent-activity-ui.spec.ts`
- Modify: `web/src/routes/(user)/assistant/agent-activity-ui.ts`

- [ ] **Step 1: Write failing source workflow activity tests**

Add these tests in `web/src/routes/(user)/assistant/agent-activity-ui.spec.ts` near the existing verbose/compact activity tests:

```ts
it('shows source-aware planning steps in expanded activity while compact rows stay stable', () => {
  const sourceWorkflowCalls = [
    makeToolCall({
      id: 'resolve-people',
      toolName: AgentToolName.ResolveAssetSearchFilters,
      responseSummary: 'Resolved people: Pierre, Aurelia',
      startedAt: '2026-05-18T10:00:01.000Z',
      completedAt: '2026-05-18T10:00:02.000Z',
    }),
    makeToolCall({
      id: 'search-source',
      toolName: AgentToolName.SearchAssets,
      responseSummary: 'Found 100 matching photos',
      assetCount: 100,
      startedAt: '2026-05-18T10:00:03.000Z',
      completedAt: '2026-05-18T10:00:04.000Z',
    }),
    makeToolCall({
      id: 'prepare-album',
      toolName: AgentToolName.ProposeAlbumFromSearch,
      responseSummary: 'Prepared album plan with 100 photos',
      assetCount: 100,
      startedAt: '2026-05-18T10:00:05.000Z',
      completedAt: '2026-05-18T10:00:06.000Z',
    }),
  ];

  const model = buildModel({ toolCalls: sourceWorkflowCalls });
  const compactBeforePlan = buildModel({ toolCalls: sourceWorkflowCalls.slice(0, 2) });

  expect(
    model.verboseItems.map(({ id, title, summary, status, count }) => ({ id, title, summary, status, count })),
  ).toEqual([
    {
      id: 'tool-resolve-people',
      title: 'Resolving filters',
      summary: 'Resolved people: Pierre, Aurelia',
      status: 'completed',
      count: undefined,
    },
    {
      id: 'tool-search-source',
      title: 'Searching photos',
      summary: 'Found 100 matching photos',
      status: 'completed',
      count: 100,
    },
    {
      id: 'tool-prepare-album',
      title: 'Preparing album plan',
      summary: 'Prepared album plan with 100 photos',
      status: 'completed',
      count: 100,
    },
  ]);
  expect(model.items.map((item) => item.id)).toEqual([
    'tool-resolve-people',
    'tool-search-source',
    'tool-prepare-album',
  ]);
  expect(compactBeforePlan.items.map((item) => item.id)).toEqual(['tool-resolve-people', 'tool-search-source']);
  expect(model.items.find((item) => item.id === 'tool-search-source')).toMatchObject({
    title: 'Searching photos',
    summary: 'Found 100 matching photos',
    count: 100,
  });
});

it('keeps compact source workflow rows stable when repeated searches complete out of order', () => {
  const runningModel = buildModel({
    toolCalls: [
      makeToolCall({
        id: 'search-a',
        toolName: AgentToolName.SearchAssets,
        status: AgentToolCallStatus.Executing,
        responseSummary: null,
        assetCount: 40,
        startedAt: '2026-05-18T10:00:01.000Z',
        completedAt: null,
      }),
      makeToolCall({
        id: 'search-b',
        toolName: AgentToolName.SearchAssets,
        status: AgentToolCallStatus.Completed,
        responseSummary: 'Found 60 matching photos',
        assetCount: 60,
        startedAt: '2026-05-18T10:00:02.000Z',
        completedAt: '2026-05-18T10:00:04.000Z',
      }),
    ],
  });
  const completedModel = buildModel({
    toolCalls: [
      makeToolCall({
        id: 'search-b',
        toolName: AgentToolName.SearchAssets,
        status: AgentToolCallStatus.Completed,
        responseSummary: 'Found 60 matching photos',
        assetCount: 60,
        startedAt: '2026-05-18T10:00:02.000Z',
        completedAt: '2026-05-18T10:00:04.000Z',
      }),
      makeToolCall({
        id: 'search-a',
        toolName: AgentToolName.SearchAssets,
        status: AgentToolCallStatus.Completed,
        responseSummary: 'Found 40 matching photos',
        assetCount: 40,
        startedAt: '2026-05-18T10:00:01.000Z',
        completedAt: '2026-05-18T10:00:05.000Z',
      }),
    ],
  });

  expect(runningModel.items).toHaveLength(1);
  expect(completedModel.items).toHaveLength(1);
  expect(runningModel.items[0].id).toBe('tool-search-search-assets');
  expect(completedModel.items[0].id).toBe('tool-search-search-assets');
  expect(completedModel.items[0]).toMatchObject({
    kind: 'search',
    status: 'completed',
    summary: 'Returned metadata for 100 assets',
    count: 100,
  });
});

it('shows failed source planning as a terminal plan row', () => {
  const model = buildModel({
    toolCalls: [
      makeToolCall({
        id: 'failed-source-plan',
        toolName: AgentToolName.ProposeAlbumFromSearch,
        status: AgentToolCallStatus.Failed,
        responseSummary: null,
        error: 'Search source did not match any assets',
        startedAt: '2026-05-18T10:00:01.000Z',
        completedAt: '2026-05-18T10:00:02.000Z',
      }),
    ],
  });

  expect(model.items).toEqual([
    expect.objectContaining({
      id: 'tool-failed-source-plan',
      kind: 'plan',
      status: 'failed',
      title: 'Preparing album plan',
      summary: 'Plan preparation failed',
      completedAt: '2026-05-18T10:00:02.000Z',
    }),
  ]);
  expect(model.activeItem).toBeNull();
});
```

Extend the existing `it.each([...])('maps %s to safe activity copy')` table with:

```ts
    [AgentToolName.ProposeAlbumFromSearch, 'plan', 'Preparing album plan', 'Prepared album plan'],
    [AgentToolName.ProposeAddAssetsToAlbumFromSearch, 'plan', 'Preparing album plan', 'Prepared album plan'],
    [AgentToolName.ProposeSpaceFromSearch, 'plan', 'Preparing space plan', 'Prepared space plan'],
    [AgentToolName.ProposeAddAssetsToSpaceFromSearch, 'plan', 'Preparing space plan', 'Prepared space plan'],
    [AgentToolName.ProposeAssetBatchFromSearch, 'plan', 'Preparing asset update plan', 'Prepared asset update plan'],
```

Extend the lifecycle activity event test's plan expectation to assert `count` when a `plan-composing` event has counts:

```ts
        makeActivityEvent({
          id: 'plan',
          kind: 'plan-composing',
          status: 'completed',
          totalCount: 5,
          summary: 'system prompt: private provider instructions',
          createdAt: '2026-05-18T10:00:02.000Z',
        }),
```

and:

```ts
        count: 5,
```

- [ ] **Step 2: Run web test to verify the expected red failures**

Run:

```bash
pnpm --dir web exec vitest run 'src/routes/(user)/assistant/agent-activity-ui.spec.ts'
```

Expected: FAIL. The new failures should show `ProposeAlbumFromSearch` mapped as `Working with Gallery`, resolver summaries still using `Matched search filters`, and failed source planning using `Gallery step failed`.

- [ ] **Step 3: Implement web activity mapping**

In `web/src/routes/(user)/assistant/agent-activity-ui.ts`, add high-level source tool definitions to `toolActivityDefinitions`:

```ts
  [AgentToolName.ProposeAlbumFromSearch]: {
    kind: 'plan',
    title: 'Preparing album plan',
    completedSummary: 'Prepared album plan',
    coalesceKey: 'propose-album-from-search',
  },
  [AgentToolName.ProposeAddAssetsToAlbumFromSearch]: {
    kind: 'plan',
    title: 'Preparing album plan',
    completedSummary: 'Prepared album plan',
    coalesceKey: 'propose-add-assets-to-album-from-search',
  },
  [AgentToolName.ProposeSpaceFromSearch]: {
    kind: 'plan',
    title: 'Preparing space plan',
    completedSummary: 'Prepared space plan',
    coalesceKey: 'propose-space-from-search',
  },
  [AgentToolName.ProposeAddAssetsToSpaceFromSearch]: {
    kind: 'plan',
    title: 'Preparing space plan',
    completedSummary: 'Prepared space plan',
    coalesceKey: 'propose-add-assets-to-space-from-search',
  },
  [AgentToolName.ProposeAssetBatchFromSearch]: {
    kind: 'plan',
    title: 'Preparing asset update plan',
    completedSummary: 'Prepared asset update plan',
    coalesceKey: 'propose-asset-batch-from-search',
  },
```

Add this helper near `getDefinitionForTool`:

```ts
const responseSummaryTools = new Set<AgentToolName>([
  AgentToolName.ResolveAssetSearchFilters,
  AgentToolName.SearchAssets,
  AgentToolName.ProposeAlbumFromSearch,
  AgentToolName.ProposeAddAssetsToAlbumFromSearch,
  AgentToolName.ProposeSpaceFromSearch,
  AgentToolName.ProposeAddAssetsToSpaceFromSearch,
  AgentToolName.ProposeAssetBatchFromSearch,
]);
```

Update `getSummaryForStatus` so failed plan tools show terminal plan failure copy and completed source workflow rows can show safe response summaries:

```ts
if (status === 'failed') {
  return definition.kind === 'plan' ? 'Plan preparation failed' : 'Gallery step failed';
}

if (status === 'running') {
  return definition.runningSummary ?? definition.title;
}

if (status === 'skipped') {
  return 'Skipped this step';
}

return status === 'completed' && responseSummaryTools.has(toolName)
  ? (optionalRedacted(responseSummary) ?? definition.completedSummary)
  : definition.completedSummary;
```

Update the `plan-composing` branch in `buildEventActivityItem` to surface `counts.total` without exposing unsafe summaries:

```ts
    case 'plan-composing': {
      const totalCount = event.counts?.total;
      return {
        id: `event-${event.id}`,
        sessionId: event.sessionId,
        kind: 'plan',
        status,
        title: 'Preparing a plan',
        summary:
          status === 'completed'
            ? 'Prepared a plan'
            : status === 'failed'
              ? 'Plan preparation failed'
              : 'Preparing the plan',
        ...(totalCount && totalCount > 0 ? { count: totalCount } : {}),
        startedAt,
        ...(terminal ? { completedAt: startedAt } : {}),
        technical: {
          requestSummary: safeSummary,
          ...(totalCount && totalCount > 0 ? { assetCount: totalCount } : {}),
          startedAt: event.createdAt,
          ...(terminal ? { completedAt: event.createdAt } : {}),
        },
      };
    }
```

- [ ] **Step 4: Run web activity tests to verify green**

Run:

```bash
pnpm --dir web exec vitest run 'src/routes/(user)/assistant/agent-activity-ui.spec.ts'
```

Expected: PASS.

- [ ] **Step 5: Commit web activity polish**

Run:

```bash
git add web/src/routes/\(user\)/assistant/agent-activity-ui.ts web/src/routes/\(user\)/assistant/agent-activity-ui.spec.ts
git commit -m "feat(web): show source planning activity steps"
```

---

### Task 2: Server Planning Activity Events And Source Audit Summaries

**Files:**

- Modify: `server/src/services/agent-operation-plan.service.spec.ts`
- Modify: `server/src/types/agent-tool.types.ts`
- Modify: `server/src/services/agent-operation-plan.service.ts`

- [ ] **Step 1: Write failing server tests**

In `server/src/services/agent-operation-plan.service.spec.ts`, add this assertion to the existing `materializes assetSource.search server-side before storing a plan` test after the `toolCallRepository.create` expectation:

```ts
expect(toolCallRepository.create).toHaveBeenCalledWith(
  expect.objectContaining({
    redactedRequestMetadata: expect.objectContaining({
      sourceSummaries: [
        {
          sourceKind: 'search',
          assetCount: assetIds.length,
          sampleAssetCount: assetIds.length,
          filterKeys: ['country', 'people', 'takenAfter', 'takenBefore'],
          resolvedFilterKeys: ['country', 'personIds', 'personMatchAny', 'takenAfter', 'takenBefore'],
        },
      ],
    }),
  }),
);
const auditMetadata = vi.mocked(toolCallRepository.create).mock.calls.at(-1)?.[0].redactedRequestMetadata as Record<
  string,
  unknown
>;
expect(JSON.stringify(auditMetadata.sourceSummaries)).not.toContain(assetIds[0]);
```

Add a new test near the successful planning tests:

```ts
it('records completed plan activity with materialized asset counts', async () => {
  const auth = AuthFactory.create();
  const session = makeSession({ userId: auth.user.id });
  const assetIds = [newUuid(), newUuid(), newUuid(), newUuid()];
  sessionRepository.getById.mockResolvedValue(session);
  assetSearchFilterResolverService.resolveDeclarativeFilters.mockResolvedValue({
    status: 'success',
    filters: {},
    results: [],
  });
  sharedSpaceRepository.getSpaceIdsForTimeline.mockResolvedValue([]);
  searchRepository.searchMetadata.mockResolvedValue({
    items: assetIds.map((id) => ({ id })),
    hasNextPage: false,
  } as never);
  accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set(assetIds));
  assetRepository.getAgentReadableIds.mockResolvedValue(new Set(assetIds));
  planRepository.createReplacementRevision.mockResolvedValue(
    makePlan({
      sessionId: session.id,
      operations: [
        makeOperation({
          type: AgentOperationType.AlbumCreate,
          targetKind: AgentOperationTargetKind.NewAlbum,
          temporaryTargetId: 'tmp-south-africa',
          payload: { albumName: 'South Africa' },
        }),
        makeOperation({
          type: AgentOperationType.AlbumAddAssets,
          targetKind: AgentOperationTargetKind.NewAlbum,
          temporaryTargetId: 'tmp-south-africa',
          targetId: null,
          assetIds,
          payload: {},
        }),
      ],
    }),
  );

  await sut.proposeAlbumFromSearch(auth, session.id, {
    albumName: 'South Africa',
    assetSource: { kind: 'search', filters: {}, materialization: 'all-matches-with-limit' },
  });

  expect(activityEventService.createSystemEvent).toHaveBeenCalledWith(auth.user.id, session.id, {
    kind: AgentSessionActivityEventKind.PlanComposing,
    status: AgentSessionActivityEventStatus.Completed,
    summary: 'Prepared plan',
    counts: { total: assetIds.length },
  });
  expect(activityEventService.createSystemEvent).not.toHaveBeenCalledWith(
    expect.any(String),
    expect.any(String),
    expect.objectContaining({
      operationIds: expect.anything(),
      assetIds: expect.anything(),
    }),
  );
});
```

Add another test near the source search error tests:

```ts
it('records failed plan activity when source resolution is unrecovered', async () => {
  const auth = AuthFactory.create();
  const session = makeSession({ userId: auth.user.id });
  sessionRepository.getById.mockResolvedValue(session);
  assetSearchFilterResolverService.resolveDeclarativeFilters.mockResolvedValue({
    status: 'success',
    filters: {},
    results: [],
  });
  sharedSpaceRepository.getSpaceIdsForTimeline.mockResolvedValue([]);
  searchRepository.searchMetadata.mockResolvedValue({ items: [], hasNextPage: false } as never);

  await expect(
    sut.proposeAlbumFromSearch(auth, session.id, {
      albumName: 'Empty source',
      assetSource: { kind: 'search', filters: {}, materialization: 'all-matches-with-limit' },
    }),
  ).rejects.toThrow('Search source did not match any assets');

  expect(planRepository.createReplacementRevision).not.toHaveBeenCalled();
  expect(activityEventService.createSystemEvent).toHaveBeenCalledWith(auth.user.id, session.id, {
    kind: AgentSessionActivityEventKind.PlanComposing,
    status: AgentSessionActivityEventStatus.Failed,
    summary: 'Plan preparation failed',
  });
});
```

- [ ] **Step 2: Run server test to verify expected red failures**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-operation-plan.service.spec.ts
```

Expected: FAIL. The new failures should show missing `sourceSummaries` and missing `PlanComposing` activity event calls.

- [ ] **Step 3: Add source summary metadata type**

In `server/src/types/agent-tool.types.ts`, add `sourceSummaries` to `AgentToolOperationPlanRequestMetadata`:

```ts
  sourceSummaries?: Array<{
    sourceKind: 'selectionHandle' | 'previousSearch' | 'search';
    selectionHandleId?: string;
    sourceRef?: AgentSearchSourceRef;
    assetCount: number;
    sampleAssetCount: number;
    filterKeys?: string[];
    resolvedFilterKeys?: string[];
  }>;
```

- [ ] **Step 4: Implement source summaries and planning activity events**

In `server/src/services/agent-operation-plan.service.ts`, add helpers near the existing apply activity helper:

```ts
  private async emitPlanningActivity(
    session: AgentSession,
    status: AgentSessionActivityEventStatus.Completed | AgentSessionActivityEventStatus.Failed,
    options: { total?: number; summary: string },
  ) {
    const total = options.total === undefined ? undefined : Math.min(options.total, 10_000);
    try {
      await this.activityEventService?.createSystemEvent(session.userId, session.id, {
        kind: AgentSessionActivityEventKind.PlanComposing,
        status,
        summary: options.summary,
        ...(total !== undefined ? { counts: { total } } : {}),
      });
    } catch {
      // Activity events are visibility hints and must not block planning.
    }
  }

  private getPlanActivityCount(plan: AgentOperationPlanWithOperations) {
    const assetIds = new Set(plan.operations.flatMap((operation) => operation.assetIds));
    return assetIds.size > 0 ? assetIds.size : plan.operations.length;
  }
```

In `runPlanningTool`, after the successful audit transition and before returning, emit completed activity for plan creation/revision tools but not `summarizePlan`:

```ts
if (toolName !== AgentToolName.SummarizePlan) {
  await this.emitPlanningActivity(session, AgentSessionActivityEventStatus.Completed, {
    summary: 'Prepared plan',
    total: this.getPlanActivityCount(result.plan),
  });
}
```

In `tryCreatePlanningPreparationDeniedAudit`, after the audit create attempt block, emit failed activity:

```ts
await this.emitPlanningActivity(session, AgentSessionActivityEventStatus.Failed, {
  summary: 'Plan preparation failed',
});
```

Add this helper near `redactRequestMetadata`:

```ts
  private buildSourceSummaries(
    selectionHandles: PlanningSelectionAudit | undefined,
  ): AgentToolOperationPlanRequestMetadata['sourceSummaries'] {
    if (!selectionHandles?.length) {
      return undefined;
    }

    return selectionHandles.map((handle) => {
      const filterKeys = handle.declarativeFilters ? Object.keys(handle.declarativeFilters).sort() : undefined;
      const resolvedFilterKeys = handle.resolvedFilters ? Object.keys(handle.resolvedFilters).sort() : undefined;

      return {
        sourceKind: handle.sourceKind ?? 'selectionHandle',
        ...(handle.id ? { selectionHandleId: handle.id } : {}),
        ...(handle.sourceRef ? { sourceRef: handle.sourceRef } : {}),
        assetCount: handle.assetCount,
        sampleAssetCount: handle.sampleAssetIds.length,
        ...(filterKeys?.length ? { filterKeys } : {}),
        ...(resolvedFilterKeys?.length ? { resolvedFilterKeys } : {}),
      };
    });
  }
```

In `redactRequestMetadata`, inside `if (handleDerived)`, set:

```ts
metadata.sourceSummaries = this.buildSourceSummaries(request.selectionHandles);
```

Keep the existing sampled `assetIds`, `assetIdsSample`, and `selectionHandles` fields so existing audit consumers remain compatible; the new `sourceSummaries` is the compact, ID-light metadata field for activity/debug surfaces.

- [ ] **Step 5: Run server tests to verify green**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-operation-plan.service.spec.ts
```

Expected: PASS.

- [ ] **Step 6: Commit server observability**

Run:

```bash
git add server/src/services/agent-operation-plan.service.ts server/src/services/agent-operation-plan.service.spec.ts server/src/types/agent-tool.types.ts
git commit -m "feat(server): record source planning activity"
```

---

### Task 3: Final Verification And Push

**Files:**

- No additional source edits expected.

- [ ] **Step 1: Run focused web verification**

Run:

```bash
pnpm --dir web exec vitest run 'src/routes/(user)/assistant/agent-activity-ui.spec.ts'
```

Expected: PASS.

- [ ] **Step 2: Run focused server verification**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-operation-plan.service.spec.ts src/services/agent-session-activity-event.service.spec.ts src/dtos/agent-session-activity-event.dto.spec.ts
```

Expected: PASS.

- [ ] **Step 3: Run broader checks**

Run:

```bash
pnpm --dir server run check
pnpm --dir web run check
git diff --check
```

Expected: PASS for all commands.

- [ ] **Step 4: Inspect git history and push**

Run:

```bash
git status --short --branch
git log --oneline --decorate -5
git push
```

Expected: clean branch, Slice 12 commits present, push succeeds.

---

## Plan Review

- **Spec coverage:** Covers all Slice 12 bullets: expanded resolver/search/plan ordering, compact coalescing stability, failed source-resolution terminal activity, successful plan activity with counts, and ID-light source summaries in redacted audit metadata.
- **TDD order:** Each behavior has tests before implementation and explicit red/green commands.
- **Scope control:** Does not alter source materialization semantics, plan review UI layout, or MCP docs from earlier slices.
- **Compatibility:** Keeps existing sampled audit metadata fields and adds `sourceSummaries` instead of removing fields consumers may already read.
