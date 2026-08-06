# Pi Agent Visual Plan Review Slice 1 Review Model Contract Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the Slice 1 review-model contract for Pi visual plan previews: deterministic destination grouping, human-readable operation summaries, bounded representative thumbnails, and operation-level selection while preserving the existing operation-ID apply flow.

**Architecture:** This slice is a frontend view-model contract slice. The existing server operation plan DTO remains unchanged; `web/src/routes/(user)/assistant/agent-operation-plan-ui.ts` derives stable review metadata from `AgentOperationPlanResponseDto` so the current review panel keeps working and later slices can render the Evidence Ledger without hardcoding raw operation DTOs in components.

**Tech Stack:** TypeScript, Svelte route helpers, Vitest, existing `@immich/sdk` generated DTO types.

---

## Scope

Implement Slice 1 from `docs/superpowers/specs/2026-05-17-pi-agent-visual-plan-review-design.md`.

This slice covers:

- a typed `AgentOperationReview` model with destination, summary, risk, selection, thumbnails, and dependencies;
- deterministic album destination metadata for new and existing album operations;
- resilient fallback destination metadata for future operation/target kinds;
- human-readable operation summaries for the current album operation types;
- bounded representative asset IDs and `hasMore` metadata for large operations;
- operation-level selection state with future-compatible `all` and `none` modes;
- dependency review metadata that marks missing or disabled dependencies as blocked;
- explicit empty-plan behavior;
- legacy-compatible `buildSelectionPayload()` returning only `{ planId, operationIds }`.

This slice does not cover:

- Evidence Ledger Svelte layout changes;
- thumbnail image loading;
- expanded item review;
- item-level include/exclude state;
- sparse apply payload extensions;
- inline field overrides;
- server DTO or API changes.

## File Structure

- Modify `web/src/routes/(user)/assistant/agent-operation-plan-ui.ts`
  - Add spec-shaped review model types.
  - Add deterministic helpers for destinations, summaries, operation-level selection, thumbnail summaries, and dependency metadata.
  - Preserve existing exported helpers and legacy fields used by `agent-operation-plan-review-panel.svelte`.
- Modify `web/src/routes/(user)/assistant/agent-operation-plan-ui.spec.ts`
  - Add failing tests first for the new review contract.
  - Keep existing tests passing.
- No server files are changed in this slice.

---

### Task 1: Add Spec-Shaped Review Contract Types

**Files:**

- Modify: `web/src/routes/(user)/assistant/agent-operation-plan-ui.spec.ts`
- Modify: `web/src/routes/(user)/assistant/agent-operation-plan-ui.ts`

- [ ] **Step 1: Write the failing test**

In `web/src/routes/(user)/assistant/agent-operation-plan-ui.spec.ts`, add this test near the top of the `describe('agent operation plan UI helpers', () => { ... })` block, before existing grouping tests:

```ts
it('builds spec-shaped review metadata for album operations', () => {
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
    ]),
    { [createId]: true, [addId]: true },
  );

  expect(model.operationsById.get(createId)?.review).toEqual({
    operationId: createId,
    operationType: AgentOperationType.AlbumCreate,
    destination: {
      kind: 'album',
      temporaryId: 'album-portugal',
      name: 'Portugal',
      subtitle: 'New album',
    },
    summary: 'Create album "Portugal"',
    riskLevel: AgentOperationRiskLevel.Low,
    selection: {
      itemKind: 'asset',
      totalCount: 0,
      selectedCount: 0,
      mode: 'all',
      supportsItemSelection: false,
    },
    thumbnails: {
      totalCount: 0,
      representativeAssetIds: [],
      hasMore: false,
    },
    dependencies: [],
  });
  expect(model.operationsById.get(addId)?.review).toEqual({
    operationId: addId,
    operationType: AgentOperationType.AlbumAddAssets,
    destination: {
      kind: 'album',
      temporaryId: 'album-portugal',
      name: 'Portugal',
      subtitle: 'New album',
    },
    summary: 'Add 2 photos',
    riskLevel: AgentOperationRiskLevel.Low,
    selection: {
      itemKind: 'asset',
      totalCount: 2,
      selectedCount: 2,
      mode: 'all',
      supportsItemSelection: false,
    },
    thumbnails: {
      totalCount: 2,
      representativeAssetIds: [assetA, assetB],
      hasMore: false,
    },
    dependencies: [{ operationId: createId, summary: 'Create Portugal album', blocked: false }],
  });
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
pnpm --dir web test --run "src/routes/(user)/assistant/agent-operation-plan-ui.spec.ts" -t "builds spec-shaped review metadata for album operations"
```

Expected: FAIL because `OperationReviewItem` does not yet expose the complete `review` object.

- [ ] **Step 3: Add the contract types and review builder**

In `web/src/routes/(user)/assistant/agent-operation-plan-ui.ts`, add these exported types after `AgentOperationSelectionPayload`:

```ts
export type AgentReviewDestinationKind = 'album' | 'space' | 'assetBatch' | 'library' | 'imageEditBatch';

export type AgentReviewDestination = {
  kind: AgentReviewDestinationKind;
  id?: string;
  temporaryId?: string;
  name: string;
  subtitle?: string;
};

export type AgentReviewItemKind = 'asset' | 'album' | 'space' | 'person' | 'tag';

export type AgentReviewSelectionMode = 'all' | 'allExcept' | 'only' | 'none';

export type AgentReviewSelection = {
  itemKind: AgentReviewItemKind;
  totalCount: number;
  selectedCount: number;
  mode: AgentReviewSelectionMode;
  itemIds?: string[];
  supportsItemSelection: boolean;
};

export type AgentReviewThumbnailSummary = {
  totalCount: number;
  representativeAssetIds: string[];
  hasMore: boolean;
};

export type AgentReviewDependency = {
  operationId: string;
  summary: string;
  blocked: boolean;
};

export type AgentOperationReview = {
  operationId: string;
  operationType: string;
  destination: AgentReviewDestination;
  summary: string;
  riskLevel: AgentOperationRiskLevel | string;
  selection: AgentReviewSelection;
  thumbnails: AgentReviewThumbnailSummary;
  dependencies: AgentReviewDependency[];
};
```

Then update the existing compatibility type to retain fields used by the panel while using the new destination contract:

```ts
export type OperationReviewDestination = AgentReviewDestination & {
  title: string;
  subtitle: string;
};
```

Add `review` to `OperationReviewItem`:

```ts
export type OperationReviewItem = {
  id: string;
  operation: AgentOperationResponseDto;
  review: AgentOperationReview;
  summary: string;
  risk: AgentOperationRiskLevel | string;
  selected: boolean;
  enabled: boolean;
  blocked: boolean;
  blockedBy: string[];
  typeLabelKey: Translations;
  riskLabelKey: Translations;
  assetCount: number;
  representativeAssetIds: string[];
};
```

Add these helpers near the existing private helper functions:

```ts
const buildOperationReview = (
  operation: AgentOperationResponseDto,
  operationById: Map<string, AgentOperationResponseDto>,
  enabledByOperationId: OperationEnabledState,
  selected: boolean,
  blocked: boolean,
): AgentOperationReview => ({
  operationId: operation.id,
  operationType: operation.type,
  destination: getReviewDestination(operation, operationById),
  summary: getOperationReviewSummary(operation),
  riskLevel: operation.riskLevel,
  selection: buildOperationReviewSelection(operation, selected && !blocked),
  thumbnails: getThumbnailSummary([operation]),
  dependencies: operation.dependencyIds.map((operationId) => {
    const dependency = operationById.get(operationId);
    const dependencySelected = dependency ? (enabledByOperationId[dependency.id] ?? dependency.enabled) : false;

    return {
      operationId,
      summary: dependency?.summary ?? 'Missing dependency',
      blocked: dependency === undefined || !dependencySelected,
    };
  }),
});

const buildOperationReviewSelection = (
  operation: Pick<AgentOperationResponseDto, 'assetIds'>,
  included: boolean,
): AgentReviewSelection => {
  const totalCount = getOperationAssetCount([operation]);

  return {
    itemKind: 'asset',
    totalCount,
    selectedCount: included ? totalCount : 0,
    mode: included ? 'all' : 'none',
    supportsItemSelection: false,
  };
};
```

Inside the `items = plan.operations.map(...)` block, after `const selected = ...`, create the review and set the legacy fields from it:

```ts
const review = buildOperationReview(operation, operationById, enabledByOperationId, selected, blocked);

return {
  id: operation.id,
  operation,
  review,
  summary: review.summary,
  risk: review.riskLevel,
  selected,
  enabled: !blocked && selected,
  blocked,
  blockedBy,
  typeLabelKey: typeLabelKeys[operation.type] ?? fallbackTypeLabelKey,
  riskLabelKey: riskLabelKeys[operation.riskLevel] ?? fallbackRiskLabelKey,
  assetCount: review.selection.totalCount,
  representativeAssetIds: review.thumbnails.representativeAssetIds,
};
```

- [ ] **Step 4: Run the focused test and verify GREEN**

Run:

```bash
pnpm --dir web test --run "src/routes/(user)/assistant/agent-operation-plan-ui.spec.ts" -t "builds spec-shaped review metadata for album operations"
```

Expected: PASS.

- [ ] **Step 5: Commit this task**

```bash
git add web/src/routes/\(user\)/assistant/agent-operation-plan-ui.ts web/src/routes/\(user\)/assistant/agent-operation-plan-ui.spec.ts
git commit -m "test: cover pi plan review metadata contract"
```

---

### Task 2: Derive Destinations And Human Summaries Deterministically

**Files:**

- Modify: `web/src/routes/(user)/assistant/agent-operation-plan-ui.spec.ts`
- Modify: `web/src/routes/(user)/assistant/agent-operation-plan-ui.ts`

- [ ] **Step 1: Write the failing tests**

Add these tests after the Task 1 test:

```ts
it('derives human-readable summaries for current album operation types', () => {
  const existingAlbumId = '00000000-0000-4000-8000-000000000301';
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
        summary: 'Add assets',
        targetKind: AgentOperationTargetKind.ExistingAlbum,
        targetId: existingAlbumId,
        assetIds: [assetA],
        payload: {},
      }),
      operation({
        id: coverId,
        type: AgentOperationType.AlbumSetCover,
        summary: 'Set cover',
        targetKind: AgentOperationTargetKind.ExistingAlbum,
        targetId: existingAlbumId,
        assetIds: [assetA],
        payload: {},
      }),
      operation({
        id: updateId,
        type: AgentOperationType.AlbumUpdateDetails,
        summary: 'Update details',
        targetKind: AgentOperationTargetKind.ExistingAlbum,
        targetId: existingAlbumId,
        payload: { albumName: 'Portugal Archive' },
      }),
    ]),
    { [createId]: true, [addId]: true, [coverId]: true, [updateId]: true },
  );

  expect(model.operationsById.get(createId)?.review.summary).toBe('Create album "Portugal"');
  expect(model.operationsById.get(addId)?.review.summary).toBe('Add 1 photo');
  expect(model.operationsById.get(coverId)?.review.summary).toBe('Set cover photo');
  expect(model.operationsById.get(updateId)?.review.summary).toBe('Rename album to "Portugal Archive"');
});

it('maps future target kinds into stable review destination kinds without throwing', () => {
  const futureOperation = operation({
    id: updateId,
    type: 'asset.rotate' as AgentOperationType,
    summary: 'Rotate landscape photos',
    targetKind: 'asset_batch' as AgentOperationTargetKind,
    assetIds: [assetA, assetB],
    payload: { angle: 90 },
  });

  expect(() => buildOperationReviewModel(plan([futureOperation]), { [updateId]: true })).not.toThrow();

  const model = buildOperationReviewModel(plan([futureOperation]), { [updateId]: true });
  expect(model.operationsById.get(updateId)?.review.destination).toEqual({
    kind: 'assetBatch',
    name: 'Rotate landscape photos',
  });
  expect(model.operationsById.get(updateId)?.review.summary).toBe('Rotate landscape photos');
});
```

- [ ] **Step 2: Run the focused tests and verify RED**

Run:

```bash
pnpm --dir web test --run "src/routes/(user)/assistant/agent-operation-plan-ui.spec.ts" -t "derives human-readable summaries|maps future target kinds"
```

Expected: FAIL until deterministic summary and normalized destination helpers exist.

- [ ] **Step 3: Implement summary and destination helpers**

In `web/src/routes/(user)/assistant/agent-operation-plan-ui.ts`, add:

```ts
const getOperationReviewSummary = (operation: AgentOperationResponseDto) => {
  switch (operation.type) {
    case AgentOperationType.AlbumCreate:
      return `Create album "${getAlbumName(operation) ?? operation.temporaryTargetId ?? 'Untitled album'}"`;
    case AgentOperationType.AlbumAddAssets:
      return `Add ${formatPhotoCount(getOperationAssetCount([operation]))}`;
    case AgentOperationType.AlbumSetCover:
      return 'Set cover photo';
    case AgentOperationType.AlbumUpdateDetails: {
      const albumName = getAlbumName(operation);
      if (albumName) {
        return `Rename album to "${albumName}"`;
      }

      return 'Update album details';
    }
    default:
      return operation.summary;
  }
};

const formatPhotoCount = (count: number) => `${count} ${count === 1 ? 'photo' : 'photos'}`;
```

Add a normalized destination helper:

```ts
const getReviewDestination = (
  operation: AgentOperationResponseDto,
  operationById: Map<string, AgentOperationResponseDto>,
): AgentReviewDestination => {
  if (
    operation.targetKind === AgentOperationTargetKind.NewAlbum ||
    operation.targetKind === AgentOperationTargetKind.ExistingAlbum
  ) {
    const createOperation =
      operation.temporaryTargetId === null
        ? undefined
        : [...operationById.values()].find(
            (candidate) =>
              candidate.type === AgentOperationType.AlbumCreate &&
              candidate.temporaryTargetId === operation.temporaryTargetId,
          );
    const albumName = getAlbumName(operation) ?? (createOperation ? getAlbumName(createOperation) : undefined);
    const destination: AgentReviewDestination = {
      kind: 'album',
      name: albumName ?? getGroupTitle(operation),
      subtitle: operation.targetKind === AgentOperationTargetKind.NewAlbum ? 'New album' : 'Existing album',
    };

    if (operation.targetId) {
      destination.id = operation.targetId;
    }

    if (operation.temporaryTargetId) {
      destination.temporaryId = operation.temporaryTargetId;
    }

    return destination;
  }

  const rawTargetKind = String(operation.targetKind);
  if (rawTargetKind.includes('space')) {
    return { kind: 'space', name: operation.summary };
  }

  if (rawTargetKind.includes('asset') || rawTargetKind.includes('image')) {
    return { kind: rawTargetKind.includes('image') ? 'imageEditBatch' : 'assetBatch', name: operation.summary };
  }

  return { kind: 'library', name: operation.summary };
};
```

Then update `getDestination()` so the existing group destination is built from the normalized review destination:

```ts
const getDestination = (
  operation: AgentOperationResponseDto,
  operationById: Map<string, AgentOperationResponseDto>,
  subtitle: string,
): OperationReviewDestination => ({
  ...getReviewDestination(operation, operationById),
  title: getGroupTitle(operation),
  subtitle,
});
```

Update the group initialization call from:

```ts
destination: getDestination(item.operation, ''),
```

to:

```ts
destination: getDestination(item.operation, operationById, ''),
```

- [ ] **Step 4: Run the focused tests and verify GREEN**

Run:

```bash
pnpm --dir web test --run "src/routes/(user)/assistant/agent-operation-plan-ui.spec.ts" -t "derives human-readable summaries|maps future target kinds"
```

Expected: PASS.

- [ ] **Step 5: Commit this task**

```bash
git add web/src/routes/\(user\)/assistant/agent-operation-plan-ui.ts web/src/routes/\(user\)/assistant/agent-operation-plan-ui.spec.ts
git commit -m "feat: derive pi plan review summaries"
```

---

### Task 3: Add Thumbnail Summary And Selection Edge Coverage

**Files:**

- Modify: `web/src/routes/(user)/assistant/agent-operation-plan-ui.spec.ts`
- Modify: `web/src/routes/(user)/assistant/agent-operation-plan-ui.ts`

- [ ] **Step 1: Write the failing tests**

Add these tests after the Task 2 tests:

```ts
it('exposes bounded thumbnail summaries for large operations and groups', () => {
  const assetIds = Array.from(
    { length: 1_000 },
    (_, index) => `00000000-0000-4000-8000-${index.toString().padStart(12, '0')}`,
  );
  const model = buildOperationReviewModel(
    plan([
      operation({
        id: addId,
        type: AgentOperationType.AlbumAddAssets,
        summary: 'Add many assets',
        targetKind: AgentOperationTargetKind.ExistingAlbum,
        targetId: '00000000-0000-4000-8000-000000000301',
        assetIds,
        payload: {},
      }),
    ]),
    { [addId]: true },
  );

  expect(model.operationsById.get(addId)?.review.thumbnails).toEqual({
    totalCount: 1_000,
    representativeAssetIds: assetIds.slice(0, 12),
    hasMore: true,
  });
  expect(model.groups[0].thumbnailSummary).toEqual({
    totalCount: 1_000,
    representativeAssetIds: assetIds.slice(0, 12),
    hasMore: true,
  });
});

it('marks disabled and blocked operations as unselected in review selection metadata', () => {
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

  expect(model.operationsById.get(createId)?.review.selection).toEqual({
    itemKind: 'asset',
    totalCount: 0,
    selectedCount: 0,
    mode: 'none',
    supportsItemSelection: false,
  });
  expect(model.operationsById.get(addId)?.review.selection).toEqual({
    itemKind: 'asset',
    totalCount: 2,
    selectedCount: 0,
    mode: 'none',
    supportsItemSelection: false,
  });
  expect(model.operationsById.get(addId)?.review.dependencies).toEqual([
    { operationId: createId, summary: 'Create Portugal album', blocked: true },
  ]);
});
```

- [ ] **Step 2: Run the focused tests and verify RED**

Run:

```bash
pnpm --dir web test --run "src/routes/(user)/assistant/agent-operation-plan-ui.spec.ts" -t "thumbnail summaries|unselected in review selection metadata"
```

Expected: FAIL until `thumbnailSummary` exists on groups, blocked/disabled review selection is normalized to `none`, and disabled dependencies are reflected in `review.dependencies`.

- [ ] **Step 3: Implement thumbnail summaries and selected-count normalization**

In `web/src/routes/(user)/assistant/agent-operation-plan-ui.ts`, add `thumbnailSummary` to `OperationReviewGroup`:

```ts
export type OperationReviewGroup = {
  id: string;
  title: string;
  subtitle: string;
  destination: OperationReviewDestination;
  assetCount: number;
  thumbnailSummary: AgentReviewThumbnailSummary;
  representativeAssetIds: string[];
  operations: OperationReviewItem[];
};
```

Replace the current representative-only helper with:

```ts
const getThumbnailSummary = (
  operations: Pick<AgentOperationResponseDto, 'assetIds'>[],
): AgentReviewThumbnailSummary => {
  const totalCount = getOperationAssetCount(operations);
  const representativeAssetIds = getRepresentativeAssetIds(operations);

  return {
    totalCount,
    representativeAssetIds,
    hasMore: totalCount > representativeAssetIds.length,
  };
};
```

When initializing a group, include:

```ts
thumbnailSummary: { totalCount: 0, representativeAssetIds: [], hasMore: false },
```

When updating a group, compute one summary and use it for both legacy and new fields:

```ts
const thumbnailSummary = getThumbnailSummary(operations.map(({ operation }) => operation));

groupsById.set(groupId, {
  ...group,
  subtitle,
  destination: {
    ...group.destination,
    subtitle,
  },
  assetCount: getOperationAssetCount(operations.map(({ operation }) => operation)),
  thumbnailSummary,
  representativeAssetIds: thumbnailSummary.representativeAssetIds,
  operations,
});
```

Ensure `buildOperationReview()` receives `included = selected && !blocked`, so disabled and blocked operations use `mode: 'none'` and `selectedCount: 0`. Also pass `enabledByOperationId` into `buildOperationReview()` so dependency metadata can mark missing or disabled dependencies as `blocked: true`.

- [ ] **Step 4: Run the focused tests and verify GREEN**

Run:

```bash
pnpm --dir web test --run "src/routes/(user)/assistant/agent-operation-plan-ui.spec.ts" -t "thumbnail summaries|unselected in review selection metadata"
```

Expected: PASS.

- [ ] **Step 5: Commit this task**

```bash
git add web/src/routes/\(user\)/assistant/agent-operation-plan-ui.ts web/src/routes/\(user\)/assistant/agent-operation-plan-ui.spec.ts
git commit -m "feat: add pi plan thumbnail review metadata"
```

---

### Task 4: Add Empty Plan Edge Coverage

**Files:**

- Modify: `web/src/routes/(user)/assistant/agent-operation-plan-ui.spec.ts`
- Modify: `web/src/routes/(user)/assistant/agent-operation-plan-ui.ts` only if the test fails

- [ ] **Step 1: Write the failing edge-case test**

Add this test near the other model edge-case tests:

```ts
it('builds an empty review model and legacy empty selection payload for an empty operation plan', () => {
  const model = buildOperationReviewModel(plan([]), {});

  expect(model.groups).toEqual([]);
  expect(model.operationsById.size).toBe(0);
  expect(buildApprovedOperationIds(model)).toEqual([]);
  expect(buildSelectionPayload(model)).toEqual({ planId, operationIds: [] });
});
```

- [ ] **Step 2: Run the focused test and verify RED or existing GREEN**

Run:

```bash
pnpm --dir web test --run "src/routes/(user)/assistant/agent-operation-plan-ui.spec.ts" -t "empty review model"
```

Expected:

- RED if empty operation lists currently throw or produce non-empty derived state.
- GREEN if empty plans are already handled. Keep the test either way because it locks the edge case from the design spec.

- [ ] **Step 3: Implement the minimal fix if RED**

If the test fails, update `buildOperationReviewModel()` to return an empty model naturally when `plan.operations` is empty:

```ts
return {
  plan,
  groups: [...groupsById.values()],
  operationsById: new Map(items.map((item) => [item.id, item])),
};
```

Do not add special UI behavior in this slice. The existing panel empty state remains responsible for rendering an empty plan.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run:

```bash
pnpm --dir web test --run "src/routes/(user)/assistant/agent-operation-plan-ui.spec.ts" -t "empty review model"
```

Expected: PASS.

- [ ] **Step 5: Commit this task**

```bash
git add web/src/routes/\(user\)/assistant/agent-operation-plan-ui.ts web/src/routes/\(user\)/assistant/agent-operation-plan-ui.spec.ts
git commit -m "test: cover empty pi plan review model"
```

---

### Task 5: Preserve Existing Panel Compatibility And Apply Payload

**Files:**

- Modify: `web/src/routes/(user)/assistant/agent-operation-plan-ui.spec.ts`
- Modify: `web/src/routes/(user)/assistant/agent-operation-plan-ui.ts`

- [ ] **Step 1: Write the failing compatibility test**

Add this test near the existing `keeps selection payload legacy-compatible...` test:

```ts
it('keeps legacy operation-id apply payload while exposing the richer review model', () => {
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
    { [createId]: true, [addId]: true },
  );

  expect(buildSelectionPayload(model)).toEqual({ planId, operationIds: [createId, addId] });
  expect(model.groups[0]).toEqual(
    expect.objectContaining({
      id: 'new-album:album-portugal',
      title: 'New album "Portugal"',
      subtitle: '2 operations',
      assetCount: 2,
      representativeAssetIds: [assetA, assetB],
    }),
  );
  expect(model.operationsById.get(addId)).toEqual(
    expect.objectContaining({
      id: addId,
      summary: 'Add 2 photos',
      assetCount: 2,
      representativeAssetIds: [assetA, assetB],
    }),
  );
});
```

- [ ] **Step 2: Run the focused test and verify RED or existing GREEN**

Run:

```bash
pnpm --dir web test --run "src/routes/(user)/assistant/agent-operation-plan-ui.spec.ts" -t "keeps legacy operation-id apply payload"
```

Expected:

- RED if earlier tasks changed the compatibility fields incorrectly.
- GREEN if compatibility is already preserved.

- [ ] **Step 3: Restore compatibility fields if RED**

If the test fails, make sure `buildSelectionPayload()` remains:

```ts
export const buildSelectionPayload = (model: OperationReviewModel): AgentOperationSelectionPayload => ({
  planId: model.plan.id,
  operationIds: buildApprovedOperationIds(model),
});
```

Make sure `OperationReviewItem` still includes `summary`, `assetCount`, and `representativeAssetIds`, and make sure `OperationReviewGroup` still includes `title`, `subtitle`, `assetCount`, and `representativeAssetIds`.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run:

```bash
pnpm --dir web test --run "src/routes/(user)/assistant/agent-operation-plan-ui.spec.ts" -t "keeps legacy operation-id apply payload"
```

Expected: PASS.

- [ ] **Step 5: Commit this task**

```bash
git add web/src/routes/\(user\)/assistant/agent-operation-plan-ui.ts web/src/routes/\(user\)/assistant/agent-operation-plan-ui.spec.ts
git commit -m "test: preserve pi plan operation id apply payload"
```

---

### Task 6: Run Slice Verification

**Files:**

- Verify: `web/src/routes/(user)/assistant/agent-operation-plan-ui.spec.ts`
- Verify: `web/src/routes/(user)/assistant/agent-operation-plan-review-panel.spec.ts`
- Verify: `web/src/routes/(user)/assistant/agent-session-action-dock.spec.ts`
- Verify: web TypeScript

- [ ] **Step 1: Run the full helper test file**

Run:

```bash
pnpm --dir web test --run "src/routes/(user)/assistant/agent-operation-plan-ui.spec.ts"
```

Expected: all tests in `agent-operation-plan-ui.spec.ts` pass.

- [ ] **Step 2: Run panel compatibility tests**

Run:

```bash
pnpm --dir web test --run "src/routes/(user)/assistant/agent-operation-plan-review-panel.spec.ts" "src/routes/(user)/assistant/agent-session-action-dock.spec.ts"
```

Expected: all tests pass. These protect the existing review panel and action dock from model-shape regressions.

- [ ] **Step 3: Run TypeScript check**

Run:

```bash
pnpm --dir web check:typescript
```

Expected: TypeScript exits 0.

- [ ] **Step 4: Commit verification-only fixes if needed**

If verification exposes type or compatibility fixes, apply the smallest fix and commit it:

```bash
git add web/src/routes/\(user\)/assistant/agent-operation-plan-ui.ts web/src/routes/\(user\)/assistant/agent-operation-plan-ui.spec.ts web/src/routes/\(user\)/assistant/agent-operation-plan-review-panel.spec.ts web/src/routes/\(user\)/assistant/agent-session-action-dock.spec.ts
git commit -m "fix: keep pi plan review model compatible"
```

If no fixes were needed, do not create an empty commit.

---

## Final Acceptance Checklist

- [ ] `OperationReviewItem.review` exposes `AgentOperationReview`.
- [ ] `AgentOperationReview.destination.kind` uses stable review kinds such as `album` and `assetBatch`, not raw DTO target-kind strings.
- [ ] Current album operations produce human-readable summaries.
- [ ] Operation-level selection metadata uses `all` for included operations and `none` for disabled or blocked operations.
- [ ] Dependency review metadata marks missing or disabled dependencies as blocked.
- [ ] Empty plans produce no groups, an empty operation map, and an empty legacy selection payload.
- [ ] Representative thumbnails are bounded to 12 IDs and include `hasMore`.
- [ ] Future operation/target kinds fall back without throwing.
- [ ] `buildSelectionPayload()` still sends only operation IDs.
- [ ] No server API or DTO changes were introduced.
- [ ] Focused helper tests pass.
- [ ] Existing panel/action-dock tests pass.
- [ ] `pnpm --dir web check:typescript` passes.
