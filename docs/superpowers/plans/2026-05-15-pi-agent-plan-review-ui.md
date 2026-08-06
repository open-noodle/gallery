# Pi Agent Plan Review UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build slice 12 from `docs/superpowers/specs/2026-05-14-pi-agent-album-assistant-design.md`: show the assistant's proposed album operation plan in the Assistant page with grouped operations, individual toggles, dependency-aware disabled states, and tested selection payloads for the later apply slice.

**Architecture:** Gallery server already owns durable operation-plan storage and emits `operation-plan-ready`; this slice is a web UI slice that consumes the generated SDK, fetches the current plan for a session, and keeps review toggles local until slice 13 adds the apply endpoint. The review component produces a deterministic `{ planId, operationIds }` selection payload, excludes blocked dependent operations, and refreshes itself from websocket plan-ready events without mutating server state.

**Tech Stack:** Svelte 5 runes, existing Assistant route components, `@immich/sdk` generated TypeScript client, Vitest with Testing Library Svelte, `svelte-i18n`, existing Socket.IO websocket event store.

---

## Scope

This plan implements vertical slice 12 only:

- Group and display the current `AgentOperationPlanResponseDto`.
- Let the user enable or disable individual proposed operations and operation groups locally.
- Disable dependent operations when a required dependency is disabled.
- Emit a stable approved operation ID payload for slice 13.
- Refresh the panel when `operation-plan-ready` arrives for the active session.
- Add component and helper tests for individual toggles, group toggles, dependency blocking, payloads, events, and stale loads.

This plan intentionally does not add:

- A server toggle endpoint.
- A final apply endpoint.
- Album mutations.
- Runner or Pi runtime changes.
- Plan revision requests from user feedback.

The server-side slice 11 contracts exist on this branch. The TypeScript SDK is stale relative to `open-api/immich-openapi-specs.json`, so the first task regenerates SDK artifacts before web code imports operation-plan types.

## File Structure

- `open-api/typescript-sdk/src/fetch-client.ts` - generated SDK source; should gain operation-plan DTOs, enums, and functions.
- `open-api/typescript-sdk/build/fetch-client.js` - generated SDK runtime build.
- `open-api/typescript-sdk/build/fetch-client.d.ts` - generated SDK type build.
- `web/src/lib/stores/websocket.ts` - add `operation-plan-ready` to the web event union.
- `web/src/routes/(user)/assistant/agent-session-chat-panel.svelte` - ignore plan-ready events instead of treating them as runner errors.
- `web/src/routes/(user)/assistant/agent-session-chat-panel.spec.ts` - regression test for ignored plan-ready events.
- `web/src/routes/(user)/assistant/agent-operation-plan-ui.ts` - pure helper for grouping, labels, group state updates, dependency blocking, and selection payloads.
- `web/src/routes/(user)/assistant/agent-operation-plan-ui.spec.ts` - pure helper tests.
- `web/src/routes/(user)/assistant/agent-operation-plan-review-panel.svelte` - new review panel component.
- `web/src/routes/(user)/assistant/agent-operation-plan-review-panel.spec.ts` - component tests for loading, grouping, toggles, dependency blocking, events, and errors.
- `web/src/routes/(user)/assistant/agent-session-page-content.svelte` - render the review panel for the created session.
- `web/src/routes/(user)/assistant/agent-session-page-content.spec.ts` - integration coverage that the panel is mounted with the created session.
- `i18n/en.json` - English strings for the new review panel.

---

### Task 1: Regenerate TypeScript SDK Operation-Plan Contracts

**Files:**

- Modify: `open-api/typescript-sdk/src/fetch-client.ts`
- Modify: `open-api/typescript-sdk/build/fetch-client.js`
- Modify: `open-api/typescript-sdk/build/fetch-client.d.ts`
- Modify: `open-api/typescript-sdk/build/index.js`
- Modify: `open-api/typescript-sdk/build/index.d.ts`

- [ ] **Step 1: Generate the TypeScript SDK**

Run:

```bash
make open-api-typescript
```

Expected: command exits `0`; `open-api/typescript-sdk/src/fetch-client.ts` includes generated operation-plan DTOs and functions.

- [ ] **Step 2: Verify the generated contracts exist**

Run:

```bash
rg -n "AgentOperationPlanResponseDto|AgentOperationResponseDto|AgentOperationType|AgentOperationTargetKind|AgentOperationRiskLevel|getCurrentOperationPlan|runnerProposeAlbumOperations|runnerReviseProposedOperations|runnerSummarizePlan" open-api/typescript-sdk/src/fetch-client.ts open-api/typescript-sdk/build/fetch-client.d.ts
```

Expected: matches in both source and build type files.

- [ ] **Step 3: Build the SDK explicitly**

Run:

```bash
pnpm --filter @immich/sdk build
```

Expected: `tsc` exits `0`.

- [ ] **Step 4: Commit SDK regeneration**

```bash
git add open-api/typescript-sdk/src/fetch-client.ts open-api/typescript-sdk/build
git commit -m "chore: regenerate agent operation plan sdk"
```

---

### Task 2: Handle Plan-Ready Websocket Events Without Chat Errors

**Files:**

- Modify: `web/src/lib/stores/websocket.ts`
- Modify: `web/src/routes/(user)/assistant/agent-session-chat-panel.spec.ts`
- Modify: `web/src/routes/(user)/assistant/agent-session-chat-panel.svelte`

- [ ] **Step 1: Write the failing chat-panel regression test**

Add this test near the other websocket-event tests in `web/src/routes/(user)/assistant/agent-session-chat-panel.spec.ts`:

```ts
it('ignores operation plan ready websocket events without interrupting an active response', async () => {
  let handler: Parameters<typeof websocketMock.websocketEvents.on>[1] | undefined;
  websocketMock.websocketEvents.on.mockImplementation((_eventName, nextHandler) => {
    handler = nextHandler;
    return vi.fn();
  });

  render(AgentSessionChatPanel, { props: { session } });
  await screen.findByRole('textbox', { name: 'Message' });

  handler?.({
    type: 'assistant-message-delta',
    sessionId: session.id,
    delta: 'Thinking...',
    sequence: 1,
    createdAt: '2026-05-15T00:00:01.000Z',
  });

  expect(await screen.findByText('Thinking...')).toBeInTheDocument();

  handler?.({
    type: 'operation-plan-ready',
    sessionId: session.id,
    planId: '00000000-0000-4000-8000-000000000300',
    revision: 2,
  });

  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(screen.getByText('Thinking...')).toBeInTheDocument();
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run:

```bash
pnpm --filter immich-web test -- --run -t "ignores operation plan ready websocket events without interrupting an active response"
```

Expected: FAIL because the current chat handler treats unknown session events as errors and clears `streamingText`.

- [ ] **Step 3: Add the web event type**

In `web/src/lib/stores/websocket.ts`, extend `AgentSessionClientEvent`:

```ts
  | {
      type: 'operation-plan-ready';
      sessionId: string;
      planId: string;
      revision: number;
    };
```

- [ ] **Step 4: Ignore plan-ready events in chat**

In `web/src/routes/(user)/assistant/agent-session-chat-panel.svelte`, update `handleSessionEvent` so it exits before the generic error handling:

```ts
if (event.type === 'operation-plan-ready') {
  return;
}

isAssistantActive = false;
streamingText = '';
errorMessage = event.message;
```

- [ ] **Step 5: Run the chat regression test**

Run:

```bash
pnpm --filter immich-web test -- --run -t "ignores operation plan ready websocket events without interrupting an active response"
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add web/src/lib/stores/websocket.ts web/src/routes/\(user\)/assistant/agent-session-chat-panel.svelte web/src/routes/\(user\)/assistant/agent-session-chat-panel.spec.ts
git commit -m "fix(web): ignore agent plan ready chat events"
```

---

### Task 3: Add Pure Operation-Plan Review Helpers

**Files:**

- Create: `web/src/routes/(user)/assistant/agent-operation-plan-ui.spec.ts`
- Create: `web/src/routes/(user)/assistant/agent-operation-plan-ui.ts`

- [ ] **Step 1: Write failing helper tests**

Create `web/src/routes/(user)/assistant/agent-operation-plan-ui.spec.ts`:

```ts
import {
  AgentOperationPlanStatus,
  AgentOperationRiskLevel,
  AgentOperationStatus,
  AgentOperationTargetKind,
  AgentOperationType,
  type AgentOperationPlanResponseDto,
  type AgentOperationResponseDto,
} from '@immich/sdk';
import {
  buildApprovedOperationIds,
  buildGroupEnabledState,
  buildOperationReviewModel,
  buildSelectionPayload,
  createInitialOperationEnabledState,
  getOperationAssetCount,
} from './agent-operation-plan-ui';

const planId = '00000000-0000-4000-8000-000000000100';
const createId = '00000000-0000-4000-8000-000000000101';
const addId = '00000000-0000-4000-8000-000000000102';
const coverId = '00000000-0000-4000-8000-000000000103';
const updateId = '00000000-0000-4000-8000-000000000104';
const assetA = '00000000-0000-4000-8000-000000000201';
const assetB = '00000000-0000-4000-8000-000000000202';

const baseOperation = {
  planId,
  targetId: null,
  temporaryTargetId: null,
  assetIds: [],
  dependencyIds: [],
  riskLevel: AgentOperationRiskLevel.Low,
  enabled: true,
  status: AgentOperationStatus.Proposed,
  result: null,
  error: null,
  createdAt: '2026-05-15T00:00:00.000Z',
  updatedAt: '2026-05-15T00:00:00.000Z',
} satisfies Omit<AgentOperationResponseDto, 'id' | 'type' | 'summary' | 'targetKind' | 'payload'>;

const operation = (
  operation: Partial<AgentOperationResponseDto> &
    Pick<AgentOperationResponseDto, 'id' | 'type' | 'summary' | 'targetKind' | 'payload'>,
): AgentOperationResponseDto => ({
  ...baseOperation,
  ...operation,
});

const plan = (operations: AgentOperationResponseDto[]): AgentOperationPlanResponseDto => ({
  id: planId,
  sessionId: '00000000-0000-4000-8000-000000000001',
  revision: 1,
  status: AgentOperationPlanStatus.Proposed,
  summary: 'Organize Portugal holiday',
  operations,
  createdAt: '2026-05-15T00:00:00.000Z',
  updatedAt: '2026-05-15T00:00:00.000Z',
});

describe('agent operation plan UI helpers', () => {
  it('groups new-album operations by temporary target and keeps operation order', () => {
    const model = buildOperationReviewModel(
      plan([
        operation({
          id: createId,
          type: AgentOperationType.AlbumCreate,
          summary: 'Create Portugal album',
          targetKind: AgentOperationTargetKind.NewAlbum,
          temporaryTargetId: 'album-portugal',
          payload: { albumName: 'Portugal', description: 'Lisbon and Porto' },
        }),
        operation({
          id: addId,
          type: AgentOperationType.AlbumAddAssets,
          summary: 'Add two assets',
          targetKind: AgentOperationTargetKind.NewAlbum,
          temporaryTargetId: 'album-portugal',
          assetIds: [assetA, assetB],
          dependencyIds: [createId],
          payload: {},
        }),
        operation({
          id: coverId,
          type: AgentOperationType.AlbumSetCover,
          summary: 'Set cover',
          targetKind: AgentOperationTargetKind.NewAlbum,
          temporaryTargetId: 'album-portugal',
          assetIds: [assetA],
          dependencyIds: [createId],
          payload: {},
        }),
      ]),
      { [createId]: true, [addId]: true, [coverId]: true },
    );

    expect(model.groups).toHaveLength(1);
    expect(model.groups[0]).toEqual(
      expect.objectContaining({
        id: 'new-album:album-portugal',
        title: 'New album "Portugal"',
        subtitle: '3 operations',
        assetCount: 2,
      }),
    );
    expect(model.groups[0].operations.map((operation) => operation.id)).toEqual([createId, addId, coverId]);
  });

  it('marks dependent operations blocked when their create-album dependency is disabled', () => {
    const model = buildOperationReviewModel(
      plan([
        operation({
          id: createId,
          type: AgentOperationType.AlbumCreate,
          summary: 'Create Portugal album',
          targetKind: AgentOperationTargetKind.NewAlbum,
          temporaryTargetId: 'album-portugal',
          payload: { albumName: 'Portugal' },
        }),
        operation({
          id: addId,
          type: AgentOperationType.AlbumAddAssets,
          summary: 'Add two assets',
          targetKind: AgentOperationTargetKind.NewAlbum,
          temporaryTargetId: 'album-portugal',
          assetIds: [assetA, assetB],
          dependencyIds: [createId],
          payload: {},
        }),
      ]),
      { [createId]: false, [addId]: true },
    );

    const addOperation = model.operationsById.get(addId);
    expect(addOperation).toEqual(
      expect.objectContaining({
        blocked: true,
        enabled: false,
        blockedBy: ['Create Portugal album'],
      }),
    );
    expect(buildApprovedOperationIds(model)).toEqual([]);
  });

  it('blocks transitive dependents when an intermediate dependency is blocked', () => {
    const model = buildOperationReviewModel(
      plan([
        operation({
          id: createId,
          type: AgentOperationType.AlbumCreate,
          summary: 'Create Portugal album',
          targetKind: AgentOperationTargetKind.NewAlbum,
          temporaryTargetId: 'album-portugal',
          payload: { albumName: 'Portugal' },
        }),
        operation({
          id: addId,
          type: AgentOperationType.AlbumAddAssets,
          summary: 'Add two assets',
          targetKind: AgentOperationTargetKind.NewAlbum,
          temporaryTargetId: 'album-portugal',
          assetIds: [assetA, assetB],
          dependencyIds: [createId],
          payload: {},
        }),
        operation({
          id: coverId,
          type: AgentOperationType.AlbumSetCover,
          summary: 'Set cover',
          targetKind: AgentOperationTargetKind.NewAlbum,
          temporaryTargetId: 'album-portugal',
          assetIds: [assetA],
          dependencyIds: [addId],
          payload: {},
        }),
      ]),
      { [createId]: false, [addId]: true, [coverId]: true },
    );

    expect(model.operationsById.get(addId)).toEqual(expect.objectContaining({ blocked: true, enabled: false }));
    expect(model.operationsById.get(coverId)).toEqual(
      expect.objectContaining({
        blocked: true,
        enabled: false,
        blockedBy: ['Add two assets'],
      }),
    );
    expect(buildSelectionPayload(model)).toEqual({ planId, operationIds: [] });
  });

  it('blocks operations that reference a missing dependency', () => {
    const model = buildOperationReviewModel(
      plan([
        operation({
          id: addId,
          type: AgentOperationType.AlbumAddAssets,
          summary: 'Add two assets',
          targetKind: AgentOperationTargetKind.NewAlbum,
          temporaryTargetId: 'album-portugal',
          assetIds: [assetA, assetB],
          dependencyIds: [createId],
          payload: {},
        }),
      ]),
      { [addId]: true },
    );

    expect(model.operationsById.get(addId)).toEqual(
      expect.objectContaining({
        blocked: true,
        enabled: false,
        blockedBy: ['Missing dependency'],
      }),
    );
    expect(buildSelectionPayload(model)).toEqual({ planId, operationIds: [] });
  });

  it('builds group toggle state without changing operations outside the group', () => {
    const initialPlan = plan([
      operation({
        id: createId,
        type: AgentOperationType.AlbumCreate,
        summary: 'Create Portugal album',
        targetKind: AgentOperationTargetKind.NewAlbum,
        temporaryTargetId: 'album-portugal',
        payload: { albumName: 'Portugal' },
      }),
      operation({
        id: addId,
        type: AgentOperationType.AlbumAddAssets,
        summary: 'Add two assets',
        targetKind: AgentOperationTargetKind.NewAlbum,
        temporaryTargetId: 'album-portugal',
        assetIds: [assetA, assetB],
        dependencyIds: [createId],
        payload: {},
      }),
      operation({
        id: updateId,
        type: AgentOperationType.AlbumUpdateDetails,
        summary: 'Update existing Portugal description',
        targetKind: AgentOperationTargetKind.ExistingAlbum,
        targetId: '00000000-0000-4000-8000-000000000301',
        payload: { description: 'Updated trip notes' },
      }),
    ]);
    const initialState = { [createId]: true, [addId]: true, [updateId]: true };
    const initialModel = buildOperationReviewModel(initialPlan, initialState);

    const nextState = buildGroupEnabledState(initialState, initialModel.groups[0], false);
    const nextModel = buildOperationReviewModel(initialPlan, nextState);

    expect(nextState).toEqual({ [createId]: false, [addId]: false, [updateId]: true });
    expect(buildSelectionPayload(nextModel)).toEqual({ planId, operationIds: [updateId] });
  });

  it('preserves independent existing-album operations when a new-album dependency is disabled', () => {
    const model = buildOperationReviewModel(
      plan([
        operation({
          id: createId,
          type: AgentOperationType.AlbumCreate,
          summary: 'Create Portugal album',
          targetKind: AgentOperationTargetKind.NewAlbum,
          temporaryTargetId: 'album-portugal',
          payload: { albumName: 'Portugal' },
        }),
        operation({
          id: updateId,
          type: AgentOperationType.AlbumUpdateDetails,
          summary: 'Update existing Portugal description',
          targetKind: AgentOperationTargetKind.ExistingAlbum,
          targetId: '00000000-0000-4000-8000-000000000301',
          payload: { description: 'Updated trip notes' },
        }),
      ]),
      { [createId]: false, [updateId]: true },
    );

    expect(buildApprovedOperationIds(model)).toEqual([updateId]);
    expect(model.groups.map((group) => group.id)).toEqual([
      'new-album:album-portugal',
      'existing-album:00000000-0000-4000-8000-000000000301',
    ]);
  });

  it('creates the initial enabled state from server operation defaults', () => {
    expect(
      createInitialOperationEnabledState(
        plan([
          operation({
            id: createId,
            type: AgentOperationType.AlbumCreate,
            summary: 'Create album',
            targetKind: AgentOperationTargetKind.NewAlbum,
            temporaryTargetId: 'album-portugal',
            enabled: false,
            payload: { albumName: 'Portugal' },
          }),
          operation({
            id: updateId,
            type: AgentOperationType.AlbumUpdateDetails,
            summary: 'Update album',
            targetKind: AgentOperationTargetKind.ExistingAlbum,
            targetId: '00000000-0000-4000-8000-000000000301',
            enabled: true,
            payload: { description: 'Updated trip notes' },
          }),
        ]),
      ),
    ).toEqual({ [createId]: false, [updateId]: true });
  });

  it('counts unique assets across operations', () => {
    expect(
      getOperationAssetCount([
        operation({
          id: addId,
          type: AgentOperationType.AlbumAddAssets,
          summary: 'Add assets',
          targetKind: AgentOperationTargetKind.ExistingAlbum,
          targetId: '00000000-0000-4000-8000-000000000301',
          assetIds: [assetA, assetB],
          payload: {},
        }),
        operation({
          id: coverId,
          type: AgentOperationType.AlbumSetCover,
          summary: 'Set cover',
          targetKind: AgentOperationTargetKind.ExistingAlbum,
          targetId: '00000000-0000-4000-8000-000000000301',
          assetIds: [assetA],
          payload: {},
        }),
      ]),
    ).toBe(2);
  });
});
```

- [ ] **Step 2: Run helper tests and verify they fail**

Run:

```bash
pnpm --filter immich-web test -- --run -t "agent operation plan UI helpers"
```

Expected: FAIL because `agent-operation-plan-ui.ts` does not exist.

- [ ] **Step 3: Implement the helper**

Create `web/src/routes/(user)/assistant/agent-operation-plan-ui.ts`:

```ts
import {
  AgentOperationRiskLevel,
  AgentOperationTargetKind,
  AgentOperationType,
  type AgentOperationPlanResponseDto,
  type AgentOperationResponseDto,
} from '@immich/sdk';
import type { Translations } from 'svelte-i18n';

export type OperationEnabledState = Record<string, boolean>;

export type AgentOperationSelectionPayload = {
  planId: string;
  operationIds: string[];
};

export type OperationReviewItem = {
  id: string;
  operation: AgentOperationResponseDto;
  enabled: boolean;
  blocked: boolean;
  blockedBy: string[];
  typeLabelKey: Translations;
  riskLabelKey: Translations;
  assetCount: number;
};

export type OperationReviewGroup = {
  id: string;
  title: string;
  subtitle: string;
  assetCount: number;
  operations: OperationReviewItem[];
};

export type OperationReviewModel = {
  plan: AgentOperationPlanResponseDto;
  groups: OperationReviewGroup[];
  operationsById: Map<string, OperationReviewItem>;
};

const typeLabelKeys = {
  [AgentOperationType.AlbumCreate]: 'assistant_operation_type_album_create',
  [AgentOperationType.AlbumAddAssets]: 'assistant_operation_type_album_add_assets',
  [AgentOperationType.AlbumUpdateDetails]: 'assistant_operation_type_album_update_details',
  [AgentOperationType.AlbumSetCover]: 'assistant_operation_type_album_set_cover',
} satisfies Record<AgentOperationType, Translations>;

const riskLabelKeys = {
  [AgentOperationRiskLevel.Low]: 'assistant_operation_risk_low',
  [AgentOperationRiskLevel.Medium]: 'assistant_operation_risk_medium',
  [AgentOperationRiskLevel.High]: 'assistant_operation_risk_high',
} satisfies Record<AgentOperationRiskLevel, Translations>;

export const createInitialOperationEnabledState = (plan: AgentOperationPlanResponseDto): OperationEnabledState =>
  Object.fromEntries(plan.operations.map((operation) => [operation.id, operation.enabled]));

export const getOperationAssetCount = (operations: Pick<AgentOperationResponseDto, 'assetIds'>[]) =>
  new Set(operations.flatMap((operation) => operation.assetIds)).size;

export const buildGroupEnabledState = (
  enabledByOperationId: OperationEnabledState,
  group: OperationReviewGroup,
  enabled: boolean,
): OperationEnabledState => ({
  ...enabledByOperationId,
  ...Object.fromEntries(group.operations.map((operation) => [operation.id, enabled])),
});

export const buildApprovedOperationIds = (model: OperationReviewModel) =>
  model.plan.operations
    .map((operation) => model.operationsById.get(operation.id))
    .filter((operation): operation is OperationReviewItem => Boolean(operation))
    .filter((operation) => operation.enabled && !operation.blocked)
    .map((operation) => operation.id);

export const buildSelectionPayload = (model: OperationReviewModel): AgentOperationSelectionPayload => ({
  planId: model.plan.id,
  operationIds: buildApprovedOperationIds(model),
});

export const buildOperationReviewModel = (
  plan: AgentOperationPlanResponseDto,
  enabledByOperationId: OperationEnabledState,
): OperationReviewModel => {
  const operationById = new Map(plan.operations.map((operation) => [operation.id, operation]));
  const blockedByCache = new Map<string, string[]>();
  const collectBlockingDependencySummaries = (
    operation: AgentOperationResponseDto,
    visitedOperationIds = new Set<string>(),
  ): string[] => {
    if (blockedByCache.has(operation.id)) {
      return blockedByCache.get(operation.id) ?? [];
    }

    const blockedBy: string[] = [];
    for (const dependencyId of operation.dependencyIds) {
      const dependency = operationById.get(dependencyId);
      if (!dependency) {
        blockedBy.push('Missing dependency');
        continue;
      }

      if (visitedOperationIds.has(dependency.id)) {
        blockedBy.push(dependency.summary);
        continue;
      }

      const dependencyBlockedBy = collectBlockingDependencySummaries(
        dependency,
        new Set([...visitedOperationIds, operation.id]),
      );
      const dependencyEnabled = enabledByOperationId[dependency.id] ?? dependency.enabled;
      if (!dependencyEnabled || dependencyBlockedBy.length > 0) {
        blockedBy.push(dependency.summary);
      }
    }

    blockedByCache.set(operation.id, blockedBy);
    return blockedBy;
  };

  const items = plan.operations.map((operation) => {
    const blockedBy = collectBlockingDependencySummaries(operation);
    const blocked = blockedBy.length > 0;

    return {
      id: operation.id,
      operation,
      enabled: !blocked && (enabledByOperationId[operation.id] ?? operation.enabled),
      blocked,
      blockedBy,
      typeLabelKey: typeLabelKeys[operation.type],
      riskLabelKey: riskLabelKeys[operation.riskLevel],
      assetCount: operation.assetIds.length,
    };
  });

  const groupsById = new Map<string, OperationReviewGroup>();

  for (const item of items) {
    const groupId = getGroupId(item.operation);
    const group = groupsById.get(groupId) ?? {
      id: groupId,
      title: getGroupTitle(item.operation),
      subtitle: '',
      assetCount: 0,
      operations: [],
    };

    group.operations.push(item);
    group.subtitle = `${group.operations.length} ${group.operations.length === 1 ? 'operation' : 'operations'}`;
    group.assetCount = getOperationAssetCount(group.operations.map(({ operation }) => operation));
    groupsById.set(groupId, group);
  }

  return {
    plan,
    groups: [...groupsById.values()],
    operationsById: new Map(items.map((item) => [item.id, item])),
  };
};

const getGroupId = (operation: AgentOperationResponseDto) => {
  if (operation.targetKind === AgentOperationTargetKind.NewAlbum) {
    return `new-album:${operation.temporaryTargetId ?? operation.id}`;
  }

  if (operation.targetKind === AgentOperationTargetKind.ExistingAlbum && operation.targetId) {
    return `existing-album:${operation.targetId}`;
  }

  return `operation:${operation.id}`;
};

const getGroupTitle = (operation: AgentOperationResponseDto) => {
  if (operation.targetKind === AgentOperationTargetKind.NewAlbum) {
    return `New album "${getAlbumName(operation) ?? operation.temporaryTargetId ?? 'Untitled album'}"`;
  }

  if (operation.targetKind === AgentOperationTargetKind.ExistingAlbum) {
    return operation.targetId ? `Existing album ${operation.targetId}` : 'Existing album';
  }

  return operation.summary;
};

const getAlbumName = (operation: AgentOperationResponseDto) => {
  const albumName = operation.payload.albumName;
  return typeof albumName === 'string' && albumName.trim().length > 0 ? albumName.trim() : undefined;
};
```

- [ ] **Step 4: Run helper tests**

Run:

```bash
pnpm --filter immich-web test -- --run -t "agent operation plan UI helpers"
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/routes/\(user\)/assistant/agent-operation-plan-ui.ts web/src/routes/\(user\)/assistant/agent-operation-plan-ui.spec.ts
git commit -m "feat(web): add agent operation plan review helpers"
```

---

### Task 4: Build the Plan Review Panel With Loading, Empty, Error, and Event Refresh States

**Files:**

- Create: `web/src/routes/(user)/assistant/agent-operation-plan-review-panel.spec.ts`
- Create: `web/src/routes/(user)/assistant/agent-operation-plan-review-panel.svelte`

- [ ] **Step 1: Write failing component tests**

Create `web/src/routes/(user)/assistant/agent-operation-plan-review-panel.spec.ts`:

```ts
import { sdkMock } from '$lib/__mocks__/sdk.mock';
import {
  AgentApprovalMode,
  AgentOperationPlanStatus,
  AgentOperationRiskLevel,
  AgentOperationStatus,
  AgentOperationTargetKind,
  AgentOperationType,
  AgentPermissionPreset,
  AgentProviderType,
  AgentSessionStatus,
  type AgentOperationPlanResponseDto,
  type AgentOperationResponseDto,
  type AgentSessionResponseDto,
} from '@immich/sdk';
import { websocketMock } from '@test-data/mocks/websocket.mock';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { readable } from 'svelte/store';
import AgentOperationPlanReviewPanel from './agent-operation-plan-review-panel.svelte';

vi.mock('$lib/stores/websocket');

vi.mock('svelte-i18n', () => {
  const messages: Record<string, string> = {
    assistant_operation_asset_count: '{count} assets',
    assistant_operation_blocked_by: 'Blocked by {dependencies}',
    assistant_operation_plan_empty: 'No proposed album plan yet.',
    assistant_operation_plan_error: 'Unable to load proposed album plan',
    assistant_operation_plan_loading: 'Loading proposed album plan',
    assistant_operation_plan_review: 'Plan review',
    assistant_operation_risk_high: 'High risk',
    assistant_operation_risk_low: 'Low risk',
    assistant_operation_risk_medium: 'Medium risk',
    assistant_operation_selected_count: '{count} selected',
    assistant_operation_type_album_add_assets: 'Add assets',
    assistant_operation_type_album_create: 'Create album',
    assistant_operation_type_album_set_cover: 'Set cover',
    assistant_operation_type_album_update_details: 'Update details',
  };

  return {
    t: readable((key: string, options?: { values?: Record<string, string | number> }) =>
      (messages[key] ?? key)
        .replace('{count}', String(options?.values?.count ?? ''))
        .replace('{dependencies}', String(options?.values?.dependencies ?? '')),
    ),
  };
});

const session: AgentSessionResponseDto = {
  id: '00000000-0000-4000-8000-000000000001',
  status: AgentSessionStatus.WaitingForPlanReview,
  providerCredentialId: '00000000-0000-4000-8000-000000000010',
  credentialSnapshot: {
    id: '00000000-0000-4000-8000-000000000010',
    providerType: AgentProviderType.Openai,
    label: 'OpenAI personal',
    baseUrl: null,
    models: ['gpt-5.1'],
    defaultModel: 'gpt-5.1',
  },
  modelSnapshot: { model: 'gpt-5.1', providerCredentialId: '00000000-0000-4000-8000-000000000010' },
  initialContextSnapshot: {},
  permissionPlanSnapshot: {
    assetScope: { locked: true, owned: true, sharedSpaces: false },
    limits: {
      expiresInMinutes: null,
      maxAssetsPerSession: 200,
      maxAssetsPerToolCall: 50,
      maxOriginalsPerToolCall: 10,
      maxPreviewsPerToolCall: 50,
    },
    providerExposure: { allowOriginalsForExternalProviders: false, metadata: true, originals: false, previews: true },
    read: { metadata: true, originals: false, previews: true },
    writeScope: { addAssets: true, createAlbum: true, setCover: true, updateDetails: true },
  },
  permissionPreset: AgentPermissionPreset.VisualOrganizer,
  approvalMode: AgentApprovalMode.PlanOnly,
  runnerCapabilitiesSnapshot: { protocolVersion: '2026-05-14', streaming: true, tools: [], models: [] },
  runnerEndpoint: 'http://agent-runner:4477',
  runnerSessionId: 'runner-session',
  createdAt: '2026-05-15T00:00:00.000Z',
  updatedAt: '2026-05-15T00:00:00.000Z',
  endedAt: null,
};

const planId = '00000000-0000-4000-8000-000000000100';
const createId = '00000000-0000-4000-8000-000000000101';
const addId = '00000000-0000-4000-8000-000000000102';
const existingId = '00000000-0000-4000-8000-000000000103';
const assetA = '00000000-0000-4000-8000-000000000201';
const assetB = '00000000-0000-4000-8000-000000000202';

const baseOperation = {
  planId,
  targetId: null,
  temporaryTargetId: null,
  assetIds: [],
  dependencyIds: [],
  riskLevel: AgentOperationRiskLevel.Low,
  enabled: true,
  status: AgentOperationStatus.Proposed,
  result: null,
  error: null,
  createdAt: '2026-05-15T00:00:00.000Z',
  updatedAt: '2026-05-15T00:00:00.000Z',
} satisfies Omit<AgentOperationResponseDto, 'id' | 'type' | 'summary' | 'targetKind' | 'payload'>;

const operation = (
  operation: Partial<AgentOperationResponseDto> &
    Pick<AgentOperationResponseDto, 'id' | 'type' | 'summary' | 'targetKind' | 'payload'>,
): AgentOperationResponseDto => ({
  ...baseOperation,
  ...operation,
});

const plan = (operations: AgentOperationResponseDto[], revision = 1): AgentOperationPlanResponseDto => ({
  id: planId,
  sessionId: session.id,
  revision,
  status: AgentOperationPlanStatus.Proposed,
  summary: 'Organize Portugal holiday',
  operations,
  createdAt: '2026-05-15T00:00:00.000Z',
  updatedAt: '2026-05-15T00:00:00.000Z',
});

const samplePlan = () =>
  plan([
    operation({
      id: createId,
      type: AgentOperationType.AlbumCreate,
      summary: 'Create Portugal album',
      targetKind: AgentOperationTargetKind.NewAlbum,
      temporaryTargetId: 'album-portugal',
      payload: { albumName: 'Portugal', description: 'Lisbon and Porto' },
    }),
    operation({
      id: addId,
      type: AgentOperationType.AlbumAddAssets,
      summary: 'Add two assets',
      targetKind: AgentOperationTargetKind.NewAlbum,
      temporaryTargetId: 'album-portugal',
      assetIds: [assetA, assetB],
      dependencyIds: [createId],
      payload: {},
    }),
    operation({
      id: existingId,
      type: AgentOperationType.AlbumUpdateDetails,
      summary: 'Update existing album description',
      targetKind: AgentOperationTargetKind.ExistingAlbum,
      targetId: '00000000-0000-4000-8000-000000000301',
      riskLevel: AgentOperationRiskLevel.Medium,
      payload: { description: 'Better description' },
    }),
  ]);

describe(AgentOperationPlanReviewPanel.name, () => {
  beforeEach(() => {
    vi.clearAllMocks();
    websocketMock.websocketEvents.on.mockReturnValue(vi.fn());
  });

  it('does not render a review region when the session has no current plan', async () => {
    sdkMock.getCurrentOperationPlan.mockResolvedValue(null);

    render(AgentOperationPlanReviewPanel, { props: { session } });

    expect(await screen.findByText('No proposed album plan yet.')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Plan review' })).not.toBeInTheDocument();
  });

  it('loads and renders grouped proposed operations', async () => {
    sdkMock.getCurrentOperationPlan.mockResolvedValue(samplePlan());
    const onSelectionChange = vi.fn();

    render(AgentOperationPlanReviewPanel, { props: { session, onSelectionChange } });

    const region = await screen.findByRole('region', { name: 'Plan review' });
    expect(within(region).getByText('Organize Portugal holiday')).toBeInTheDocument();
    expect(within(region).getByText('New album "Portugal"')).toBeInTheDocument();
    expect(within(region).getByText('Create Portugal album')).toBeInTheDocument();
    expect(within(region).getByText('Add two assets')).toBeInTheDocument();
    expect(within(region).getByText('Update existing album description')).toBeInTheDocument();
    expect(within(region).getByText('3 selected')).toBeInTheDocument();
    await waitFor(() =>
      expect(onSelectionChange).toHaveBeenLastCalledWith({
        planId,
        operationIds: [createId, addId, existingId],
      }),
    );
  });

  it('disables dependent operations and removes them from the selection payload', async () => {
    sdkMock.getCurrentOperationPlan.mockResolvedValue(samplePlan());
    const onSelectionChange = vi.fn();

    render(AgentOperationPlanReviewPanel, { props: { session, onSelectionChange } });

    const createToggle = await screen.findByRole('checkbox', { name: 'Create Portugal album' });
    await fireEvent.click(createToggle);

    const addToggle = screen.getByRole('checkbox', { name: 'Add two assets' });
    expect(addToggle).toBeDisabled();
    expect(screen.getByText('Blocked by Create Portugal album')).toBeInTheDocument();
    expect(onSelectionChange).toHaveBeenLastCalledWith({
      planId,
      operationIds: [existingId],
    });
  });

  it('toggles a whole operation group without changing other groups', async () => {
    sdkMock.getCurrentOperationPlan.mockResolvedValue(samplePlan());
    const onSelectionChange = vi.fn();

    render(AgentOperationPlanReviewPanel, { props: { session, onSelectionChange } });

    const groupToggle = await screen.findByRole('checkbox', { name: 'New album "Portugal"' });
    await fireEvent.click(groupToggle);

    expect(screen.getByRole('checkbox', { name: 'Create Portugal album' })).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Add two assets' })).toBeDisabled();
    expect(screen.getByRole('checkbox', { name: 'Update existing album description' })).toBeChecked();
    expect(onSelectionChange).toHaveBeenLastCalledWith({
      planId,
      operationIds: [existingId],
    });
  });

  it('refetches the current plan for same-session plan-ready events', async () => {
    let handler: Parameters<typeof websocketMock.websocketEvents.on>[1] | undefined;
    websocketMock.websocketEvents.on.mockImplementation((_eventName, nextHandler) => {
      handler = nextHandler;
      return vi.fn();
    });
    sdkMock.getCurrentOperationPlan
      .mockResolvedValueOnce(samplePlan())
      .mockResolvedValueOnce({ ...samplePlan(), revision: 2, summary: 'Updated plan' });

    render(AgentOperationPlanReviewPanel, { props: { session } });
    expect(await screen.findByText('Organize Portugal holiday')).toBeInTheDocument();

    handler?.({
      type: 'operation-plan-ready',
      sessionId: session.id,
      planId,
      revision: 2,
    });

    expect(await screen.findByText('Updated plan')).toBeInTheDocument();
    expect(sdkMock.getCurrentOperationPlan).toHaveBeenCalledTimes(2);
  });

  it('ignores stale plan responses when a newer refresh completes first', async () => {
    let handler: Parameters<typeof websocketMock.websocketEvents.on>[1] | undefined;
    let resolveFirstLoad: (plan: AgentOperationPlanResponseDto) => void;
    websocketMock.websocketEvents.on.mockImplementation((_eventName, nextHandler) => {
      handler = nextHandler;
      return vi.fn();
    });
    sdkMock.getCurrentOperationPlan
      .mockReturnValueOnce(
        new Promise<AgentOperationPlanResponseDto>((resolve) => {
          resolveFirstLoad = resolve;
        }),
      )
      .mockResolvedValueOnce({ ...samplePlan(), revision: 2, summary: 'Newer plan' });

    render(AgentOperationPlanReviewPanel, { props: { session } });
    await waitFor(() => expect(handler).toBeDefined());

    handler?.({
      type: 'operation-plan-ready',
      sessionId: session.id,
      planId,
      revision: 2,
    });

    expect(await screen.findByText('Newer plan')).toBeInTheDocument();
    resolveFirstLoad!(samplePlan());

    await waitFor(() => expect(screen.queryByText('Organize Portugal holiday')).not.toBeInTheDocument());
    expect(screen.getByText('Newer plan')).toBeInTheDocument();
  });

  it('ignores plan-ready events for another session', async () => {
    let handler: Parameters<typeof websocketMock.websocketEvents.on>[1] | undefined;
    websocketMock.websocketEvents.on.mockImplementation((_eventName, nextHandler) => {
      handler = nextHandler;
      return vi.fn();
    });
    sdkMock.getCurrentOperationPlan.mockResolvedValue(samplePlan());

    render(AgentOperationPlanReviewPanel, { props: { session } });
    expect(await screen.findByText('Organize Portugal holiday')).toBeInTheDocument();

    handler?.({
      type: 'operation-plan-ready',
      sessionId: '00000000-0000-4000-8000-000000000999',
      planId,
      revision: 2,
    });

    await waitFor(() => expect(sdkMock.getCurrentOperationPlan).toHaveBeenCalledTimes(1));
  });

  it('shows a load error when the plan request fails', async () => {
    sdkMock.getCurrentOperationPlan.mockRejectedValue(new Error('failed'));

    render(AgentOperationPlanReviewPanel, { props: { session } });

    expect(await screen.findByRole('alert')).toHaveTextContent('Unable to load proposed album plan');
  });

  it('cleans up websocket listener on destroy', () => {
    const cleanup = vi.fn();
    sdkMock.getCurrentOperationPlan.mockResolvedValue(samplePlan());
    websocketMock.websocketEvents.on.mockReturnValue(cleanup);

    const { unmount } = render(AgentOperationPlanReviewPanel, { props: { session } });
    unmount();

    expect(cleanup).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the component tests and verify they fail**

Run:

```bash
pnpm --filter immich-web test -- --run -t "AgentOperationPlanReviewPanel"
```

Expected: FAIL because the component does not exist.

- [ ] **Step 3: Implement the component**

Create `web/src/routes/(user)/assistant/agent-operation-plan-review-panel.svelte`:

```svelte
<script lang="ts">
  import { websocketEvents, type AgentSessionClientEvent } from '$lib/stores/websocket';
  import { handleError } from '$lib/utils/handle-error';
  import { getCurrentOperationPlan, type AgentOperationPlanResponseDto, type AgentSessionResponseDto } from '@immich/sdk';
  import { Button } from '@immich/ui';
  import { onDestroy, onMount } from 'svelte';
  import { t } from 'svelte-i18n';
  import {
    buildOperationReviewModel,
    buildGroupEnabledState,
    buildSelectionPayload,
    createInitialOperationEnabledState,
    type AgentOperationSelectionPayload,
    type OperationEnabledState,
    type OperationReviewGroup,
  } from './agent-operation-plan-ui';

  interface Props {
    session: AgentSessionResponseDto;
    onSelectionChange?: (payload: AgentOperationSelectionPayload) => void;
  }

  let { session, onSelectionChange }: Props = $props();

  let plan = $state<AgentOperationPlanResponseDto | null>(null);
  let enabledByOperationId = $state<OperationEnabledState>({});
  let loading = $state(true);
  let errorMessage = $state<string | null>(null);
  let cleanupWebsocketListener: (() => void) | undefined;
  let loadSequence = 0;

  const model = $derived(plan ? buildOperationReviewModel(plan, enabledByOperationId) : null);
  const selectedOperationIds = $derived(model ? buildSelectionPayload(model).operationIds : []);

  const publishSelection = (nextPlan: AgentOperationPlanResponseDto, nextEnabledByOperationId: OperationEnabledState) => {
    onSelectionChange?.(buildSelectionPayload(buildOperationReviewModel(nextPlan, nextEnabledByOperationId)));
  };

  const loadPlan = async () => {
    const sequence = ++loadSequence;
    loading = true;
    errorMessage = null;

    try {
      const nextPlan = await getCurrentOperationPlan({ id: session.id });
      if (sequence !== loadSequence) {
        return;
      }

      const nextEnabledByOperationId = nextPlan ? createInitialOperationEnabledState(nextPlan) : {};
      plan = nextPlan;
      enabledByOperationId = nextEnabledByOperationId;
      if (nextPlan) {
        publishSelection(nextPlan, nextEnabledByOperationId);
      }
    } catch (error) {
      if (sequence !== loadSequence) {
        return;
      }

      errorMessage = $t('assistant_operation_plan_error');
      handleError(error, errorMessage);
    } finally {
      if (sequence === loadSequence) {
        loading = false;
      }
    }
  };

  const handleSessionEvent = (event: AgentSessionClientEvent) => {
    if (event.type !== 'operation-plan-ready' || event.sessionId !== session.id) {
      return;
    }

    void loadPlan();
  };

  const toggleOperation = (operationId: string, checked: boolean) => {
    if (!plan) {
      return;
    }

    const nextEnabledByOperationId = { ...enabledByOperationId, [operationId]: checked };
    enabledByOperationId = nextEnabledByOperationId;
    publishSelection(plan, nextEnabledByOperationId);
  };

  const toggleGroup = (group: OperationReviewGroup, checked: boolean) => {
    if (!plan) {
      return;
    }

    const nextEnabledByOperationId = buildGroupEnabledState(enabledByOperationId, group, checked);
    enabledByOperationId = nextEnabledByOperationId;
    publishSelection(plan, nextEnabledByOperationId);
  };

  onMount(() => {
    cleanupWebsocketListener = websocketEvents.on('on_agent_session_event', handleSessionEvent);
    void loadPlan();
  });

  onDestroy(() => {
    cleanupWebsocketListener?.();
  });
</script>

{#if loading}
  <section class="mx-auto w-full max-w-3xl px-4 pb-10 text-sm text-gray-500 md:px-8">
    {$t('assistant_operation_plan_loading')}
  </section>
{:else if errorMessage}
  <section class="mx-auto w-full max-w-3xl px-4 pb-10 md:px-8">
    <div class="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-200" role="alert">
      {errorMessage}
    </div>
  </section>
{:else if !model}
  <section class="mx-auto w-full max-w-3xl px-4 pb-10 text-sm text-gray-500 md:px-8">
    {$t('assistant_operation_plan_empty')}
  </section>
{:else}
  <section
    class="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 pb-10 text-black dark:text-white md:px-8"
    aria-labelledby="assistant-operation-plan-title"
  >
    <div class="rounded-lg border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-immich-dark-gray">
      <div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 id="assistant-operation-plan-title" class="text-lg font-semibold">{$t('assistant_operation_plan_review')}</h2>
          <p class="mt-1 text-sm text-gray-600 dark:text-gray-300">{model.plan.summary}</p>
        </div>
        <div class="text-sm font-medium text-gray-600 dark:text-gray-300">
          {$t('assistant_operation_selected_count', { values: { count: selectedOperationIds.length } })}
        </div>
      </div>

      <div class="mt-5 flex flex-col gap-4">
        {#each model.groups as group (group.id)}
          <section class="rounded-lg border border-gray-200 p-4 dark:border-gray-700" aria-label={group.title}>
            <div class="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
              <div class="flex gap-3">
                <input
                  class="mt-1 size-4"
                  type="checkbox"
                  aria-label={group.title}
                  checked={group.operations.some((operation) => operation.enabled)}
                  onchange={(event) => toggleGroup(group, event.currentTarget.checked)}
                />
                <div>
                  <h3 class="font-medium">{group.title}</h3>
                  <p class="text-sm text-gray-500 dark:text-gray-400">{group.subtitle}</p>
                </div>
              </div>
              <div class="text-sm text-gray-500 dark:text-gray-400">
                {$t('assistant_operation_asset_count', { values: { count: group.assetCount } })}
              </div>
            </div>

            <div class="mt-3 flex flex-col divide-y divide-gray-200 dark:divide-gray-700">
              {#each group.operations as item (item.id)}
                <label class="flex gap-3 py-3">
                  <input
                    class="mt-1 size-4"
                    type="checkbox"
                    aria-label={item.operation.summary}
                    checked={item.enabled}
                    disabled={item.blocked}
                    onchange={(event) => toggleOperation(item.id, event.currentTarget.checked)}
                  />
                  <span class="min-w-0 flex-1">
                    <span class="block font-medium">{item.operation.summary}</span>
                    <span class="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-sm text-gray-500 dark:text-gray-400">
                      <span>{$t(item.typeLabelKey)}</span>
                      <span>{$t(item.riskLabelKey)}</span>
                      {#if item.assetCount > 0}
                        <span>{$t('assistant_operation_asset_count', { values: { count: item.assetCount } })}</span>
                      {/if}
                    </span>
                    {#if item.blocked}
                      <span class="mt-1 block text-sm text-amber-700 dark:text-amber-300">
                        {$t('assistant_operation_blocked_by', { values: { dependencies: item.blockedBy.join(', ') } })}
                      </span>
                    {/if}
                  </span>
                </label>
              {/each}
            </div>
          </section>
        {/each}
      </div>

      <div class="mt-5">
        <Button type="button" disabled>{selectedOperationIds.length === 0 ? $t('assistant_operation_selected_count', { values: { count: 0 } }) : $t('assistant_operation_selected_count', { values: { count: selectedOperationIds.length } })}</Button>
      </div>
    </div>
  </section>
{/if}
```

- [ ] **Step 4: Run component tests**

Run:

```bash
pnpm --filter immich-web test -- --run -t "AgentOperationPlanReviewPanel"
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/routes/\(user\)/assistant/agent-operation-plan-review-panel.svelte web/src/routes/\(user\)/assistant/agent-operation-plan-review-panel.spec.ts
git commit -m "feat(web): show agent operation plan review"
```

---

### Task 5: Wire the Review Panel Into the Assistant Page

**Files:**

- Modify: `web/src/routes/(user)/assistant/agent-session-page-content.svelte`
- Modify: `web/src/routes/(user)/assistant/agent-session-page-content.spec.ts`

- [ ] **Step 1: Write failing page-content coverage**

In `web/src/routes/(user)/assistant/agent-session-page-content.spec.ts`, add the plan-review empty-state key to the local `svelte-i18n` mock:

```ts
    assistant_operation_plan_empty: 'No proposed album plan yet.',
```

Add this integration test without mocking the review panel:

```ts
it('mounts the operation plan review panel after a session is created', async () => {
  sdkMock.getCurrentOperationPlan.mockResolvedValue(null);

  render(AgentSessionPageContent, { props: { runnerStatus: healthyRunner, credentials } });

  await fireEvent.click(screen.getByRole('button', { name: 'Start session' }));

  expect(await screen.findByText('No proposed album plan yet.')).toBeInTheDocument();
  expect(sdkMock.getCurrentOperationPlan).toHaveBeenCalledWith({ id: createdSession.id });
});
```

- [ ] **Step 2: Run the page-content test and verify it fails**

Run:

```bash
pnpm --filter immich-web test -- --run -t "mounts the operation plan review panel"
```

Expected: FAIL because the panel is not rendered.

- [ ] **Step 3: Render the panel**

In `web/src/routes/(user)/assistant/agent-session-page-content.svelte`, add the import:

```ts
import AgentOperationPlanReviewPanel from './agent-operation-plan-review-panel.svelte';
```

Then render it inside the created-session block after `AgentSessionChatPanel`:

```svelte
    {#key createdSession.id}
      <AgentSessionChatPanel session={createdSession} />
      <AgentOperationPlanReviewPanel session={createdSession} />
    {/key}
```

- [ ] **Step 4: Run page-content test**

Run:

```bash
pnpm --filter immich-web test -- --run -t "mounts the operation plan review panel"
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/routes/\(user\)/assistant/agent-session-page-content.svelte web/src/routes/\(user\)/assistant/agent-session-page-content.spec.ts
git commit -m "feat(web): mount assistant plan review panel"
```

---

### Task 6: Add English Translation Keys

**Files:**

- Modify: `i18n/en.json`

- [ ] **Step 1: Add translation keys**

Add these keys near the existing `assistant_*` keys in `i18n/en.json`, preserving JSON sort order used in the file:

```json
  "assistant_operation_asset_count": "{count, plural, one {# asset} other {# assets}}",
  "assistant_operation_blocked_by": "Blocked by {dependencies}",
  "assistant_operation_plan_empty": "No proposed album plan yet.",
  "assistant_operation_plan_error": "Unable to load proposed album plan",
  "assistant_operation_plan_loading": "Loading proposed album plan",
  "assistant_operation_plan_review": "Plan review",
  "assistant_operation_risk_high": "High risk",
  "assistant_operation_risk_low": "Low risk",
  "assistant_operation_risk_medium": "Medium risk",
  "assistant_operation_selected_count": "{count, plural, one {# selected} other {# selected}}",
  "assistant_operation_type_album_add_assets": "Add assets",
  "assistant_operation_type_album_create": "Create album",
  "assistant_operation_type_album_set_cover": "Set cover",
  "assistant_operation_type_album_update_details": "Update details",
```

- [ ] **Step 2: Run i18n loader test**

Run:

```bash
pnpm --filter immich-web test -- --run -t "i18n"
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add i18n/en.json
git commit -m "feat(web): add assistant plan review translations"
```

---

### Task 7: Run Focused Web Verification

**Files:**

- No code changes.

- [ ] **Step 1: Run Assistant-focused web tests**

Run:

```bash
pnpm --filter immich-web test -- --run -t "agent operation plan|AgentOperationPlanReviewPanel|operation plan ready|mounts the operation plan review panel"
```

Expected: PASS for helper, review-panel, chat event, and page-content tests.

- [ ] **Step 2: Run full web unit suite**

Run:

```bash
pnpm --filter immich-web test -- --run
```

Expected: PASS. Baseline before this plan was `222` files passing, `2878` tests passing, `1` skipped, `8` todo.

- [ ] **Step 3: Run web type and Svelte checks**

Run:

```bash
pnpm --filter immich-web run check:typescript
pnpm --filter immich-web run check:svelte
```

Expected: both commands exit `0`.

- [ ] **Step 4: Run SDK build**

Run:

```bash
pnpm --filter @immich/sdk build
```

Expected: `tsc` exits `0`.

- [ ] **Step 5: Commit verification-only fixes if needed**

If a verification command fails because of this slice, fix the failing task's code and commit the fix with the matching task scope. Do not change unrelated files.

---

### Task 8: Final Review Checklist

**Files:**

- No code changes unless the checklist finds a defect.

- [ ] **Step 1: Inspect the final diff**

Run:

```bash
git status --short
git diff --stat
git diff -- web/src/lib/stores/websocket.ts web/src/routes/\(user\)/assistant i18n/en.json open-api/typescript-sdk
```

Expected:

- The diff contains only SDK regeneration, the new plan-review UI, web event handling, Assistant page wiring, tests, and English strings.
- Existing unrelated changes such as `open-api/immich-openapi-specs.json` are not reverted.

- [ ] **Step 2: Confirm slice boundaries**

Check the diff manually and confirm:

- No server mutation/toggle endpoint was added.
- No apply endpoint was added.
- No album service mutation path is called from the review panel.
- The review panel only calls `getCurrentOperationPlan`.
- The selected operation payload is produced locally as `{ planId, operationIds }`.

- [ ] **Step 3: Commit any final cleanup**

```bash
git add web/src/lib/stores/websocket.ts web/src/routes/\(user\)/assistant i18n/en.json open-api/typescript-sdk
git commit -m "feat(web): add assistant plan review UI"
```

Skip this commit if every task was already committed cleanly and there is no remaining diff.

---

## Self-Review

Spec coverage:

- Slice 12 grouped operation review is covered by Tasks 3 and 4.
- Operation-group toggles are covered at helper and component levels by Tasks 3 and 4.
- Individual toggles are covered by Tasks 3 and 4.
- Dependency-aware disabled states are covered by Tasks 3 and 4, including direct, transitive, and missing dependency edge cases.
- Component tests for initial selection payloads, toggle payload updates, websocket refreshes, stale load protection, load errors, empty state, and listener cleanup are covered by Task 4.
- Websocket refresh from the existing slice 11 server event is covered by Tasks 2 and 4.
- SDK drift from existing OpenAPI changes is covered by Task 1.

Placeholder scan:

- No placeholder implementation steps remain.
- No server-side apply behavior is included in this slice.

Type consistency:

- Plan DTOs are consistently named `AgentOperationPlanResponseDto` and `AgentOperationResponseDto`.
- The selection payload is consistently `{ planId, operationIds }`.
- Operation grouping and dependency checks consistently use `dependencyIds`, `temporaryTargetId`, `targetId`, and `enabled`.

Execution handoff:

Plan complete and saved to `docs/superpowers/plans/2026-05-15-pi-agent-plan-review-ui.md`. Two execution options:

1. **Subagent-Driven (recommended)** - dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** - execute tasks in this session using executing-plans, batch execution with checkpoints.
