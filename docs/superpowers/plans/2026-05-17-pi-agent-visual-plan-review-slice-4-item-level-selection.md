# Pi Agent Visual Plan Review Slice 4 Item-Level Selection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users expand a proposed plan operation, exclude individual affected photos, see mixed selection state, and apply a sparse item-selection payload that the server validates before mutating albums.

**Architecture:** Extend the existing deterministic review-model layer with sparse per-operation item selection state, then pass that state through `AgentOperationPlanReviewPanel` into destination cards and operation rows. Add a small bounded expanded item-review component for Slice 4 so the default and expanded views still avoid mounting hundreds or thousands of photos. Extend the apply DTO and service with validated sparse item selections, and apply filtered asset IDs instead of trusting the client.

**Tech Stack:** Svelte 5, TypeScript, Svelte Testing Library, Vitest, NestJS, Zod DTOs, existing `@immich/sdk` generated client, Playwright E2E through CI, Tailwind utility classes, existing asset thumbnail URL helpers.

---

## Scope

Implement Slice 4 from `docs/superpowers/specs/2026-05-17-pi-agent-visual-plan-review-design.md`.

This slice covers:

- Sparse item selection state for asset-backed operations.
- Expanded item review for affected assets with bounded rendering.
- Operation checkbox mixed state when some affected assets are excluded.
- Selected/excluded counts in operation rows and apply summaries.
- Apply payload extensions:

```ts
type AgentOperationApplyRequest = {
  operationIds: string[];
  itemSelections?: Record<
    string,
    {
      itemKind: 'asset';
      mode: 'all' | 'allExcept' | 'only' | 'none';
      itemIds?: string[];
    }
  >;
  planRevision?: number;
};
```

- Server-side validation that operation selection keys, item kinds, item IDs, selected operation IDs, dependencies, and plan revision are valid for the current plan.
- Apply-time album mutations that use filtered selected asset IDs.
- E2E coverage, run by CI, that verifies excluding one photo sends an `allExcept` sparse selection.

This slice does not cover:

- Inline field overrides. That is Slice 5.
- Virtualized large grids, filters, search, and bulk refinement tools. That is Slice 6.
- Spaces, image edit operations, tagging, archive, trash, favorite, or remove flows. That is Slice 7.
- Rendering every affected photo in the expanded review. Slice 4 renders a bounded review set and count overflow so plans with 1,000+ photos stay fast.

## Design Decisions

- Use sparse state keyed by operation ID, not eager selected ID lists.
- Keep operation-level enabled state separate from item selection. Operation-level unchecked means the operation is omitted. Item-level exclusion means the operation stays selected but may become mixed.
- Asset-backed operations start as `all`. Excluding one photo changes the override to `allExcept`.
- Re-including the last excluded photo removes the override and returns the operation to default `all`.
- `only` is supported in the view model and server validation so future bulk/filter UI can use it without another API migration.
- If all affected assets for an operation are excluded, the operation is omitted from the frontend `operationIds` payload. The server still accepts `mode: 'none'` and `allExcept` with every asset excluded, but treats those operations as skipped instead of mutating albums.
- `planRevision` uses a number because `AgentOperationPlanResponseDto.revision` is already a number in this codebase. The design spec shows a string for the future contract, but changing the existing revision type would create inconsistency and SDK churn.
- Bounded expanded review uses `AGENT_PLAN_ITEM_REVIEW_VISIBLE_LIMIT = 48`. It is large enough to be useful for small plans and still proves that large plans do not mount every thumbnail.
- Thumbnail failures are handled per tile. Raw asset IDs stay hidden from visible UI.
- Browser/E2E verification should run in CI. Local RED/GREEN loops use unit, component, DTO, and service tests.

## File Structure

- Modify `server/src/dtos/agent-operation.dto.ts`
  - Add item-selection schemas and extend `AgentOperationPlanApplyRequestSchema`.
- Modify `server/src/dtos/agent-operation.dto.spec.ts`
  - Cover direct schema parsing for sparse selections, duplicate item IDs, unsupported item kinds, and revision.
- Modify `server/src/controllers/agent-operation-plan.controller.spec.ts`
  - Cover controller validation for sparse item selections and numeric plan revisions.
- Modify `server/src/services/agent-operation-plan.service.ts`
  - Validate sparse item selections against the current plan before claiming apply.
  - Normalize selected asset IDs per operation.
  - Apply filtered asset IDs to album add and cover operations.
- Modify `server/src/services/agent-operation-plan.service.spec.ts`
  - Cover legacy apply payloads, filtered add-assets apply, cover exclusion, invalid IDs, invalid item kind, stale revision, duplicate IDs, all-excluded selections, and dependency skips.
- Modify `web/src/routes/(user)/assistant/agent-operation-plan-ui.ts`
  - Add item-selection state types, helpers, sparse payload builder, mixed state, selected item counts, and bounded item-review helper.
- Modify `web/src/routes/(user)/assistant/agent-operation-plan-ui.spec.ts`
  - Cover sparse selection transitions, `allExcept`, `only`, reset, selected counts, mixed state, disabled/blocked operations, and 1,000-asset bounded models.
- Create `web/src/routes/(user)/assistant/agent-plan-item-review.svelte`
  - Render bounded selectable thumbnails for an expanded operation.
- Create `web/src/routes/(user)/assistant/agent-plan-item-review.spec.ts`
  - Cover checkboxes, exclusion callbacks, reset, overflow count, per-thumbnail failure fallback, and hidden raw asset IDs.
- Modify `web/src/routes/(user)/assistant/agent-plan-operation-row.svelte`
  - Show selected/excluded counts, mixed checkbox state, and expanded item review.
- Modify `web/src/routes/(user)/assistant/agent-plan-operation-row.spec.ts`
  - Cover mixed state and item-review callbacks.
- Modify `web/src/routes/(user)/assistant/agent-plan-destination-card.svelte`
  - Pass item-selection callbacks to operation rows and use selected asset counts.
- Modify `web/src/routes/(user)/assistant/agent-plan-destination-card.spec.ts`
  - Cover destination counts after item exclusion and large-plan bounded expanded content.
- Modify `web/src/routes/(user)/assistant/agent-plan-evidence-ledger.svelte`
  - Thread item-selection callbacks from panel to destination cards.
- Modify `web/src/routes/(user)/assistant/agent-plan-evidence-ledger.spec.ts`
  - Cover apply bar selected asset counts after an item exclusion.
- Modify `web/src/routes/(user)/assistant/agent-operation-plan-review-panel.svelte`
  - Hold item-selection state, publish sparse payloads, and send the extended apply body.
- Modify `web/src/routes/(user)/assistant/agent-operation-plan-review-panel.spec.ts`
  - Cover selection publishing and apply request bodies with `itemSelections` and `planRevision`.
- Modify `i18n/en.json`
  - Add user-facing labels for item selection, selected/excluded counts, reset, item review, and overflow.
- Modify `e2e/src/specs/web/assistant-album-organizer.e2e-spec.ts`
  - Add CI-run browser coverage for excluding one photo from a visual plan and applying the sparse selection.
- Modify generated OpenAPI/SDK files through `make open-api-typescript`
  - Update `open-api/immich-openapi-specs.json`.
  - Update `open-api/typescript-sdk/src/fetch-client.ts`.
  - Update `open-api/typescript-sdk/build/fetch-client.d.ts`.

---

### Task 1: Extend Apply DTO For Sparse Item Selections

**Files:**

- Modify: `server/src/dtos/agent-operation.dto.ts`
- Modify: `server/src/dtos/agent-operation.dto.spec.ts`
- Modify: `server/src/controllers/agent-operation-plan.controller.spec.ts`

- [ ] **Step 1: Write the failing DTO and controller tests**

In `server/src/dtos/agent-operation.dto.spec.ts`, add these tests beside the existing apply request DTO tests:

```ts
it('accepts sparse apply item selections and a numeric plan revision', () => {
  const operationId = factory.uuid();
  const assetId = factory.uuid();

  const result = AgentOperationPlanApplyRequestDto.schema.safeParse({
    operationIds: [operationId],
    itemSelections: {
      [operationId]: {
        itemKind: 'asset',
        mode: 'allExcept',
        itemIds: [assetId],
      },
    },
    planRevision: 3,
  });

  expect(result.success).toBe(true);
  expect(result.data).toEqual({
    operationIds: [operationId],
    itemSelections: {
      [operationId]: {
        itemKind: 'asset',
        mode: 'allExcept',
        itemIds: [assetId],
      },
    },
    planRevision: 3,
  });
});

it('rejects duplicate sparse item ids', () => {
  const operationId = factory.uuid();
  const assetId = factory.uuid();

  const result = AgentOperationPlanApplyRequestDto.schema.safeParse({
    operationIds: [operationId],
    itemSelections: {
      [operationId]: {
        itemKind: 'asset',
        mode: 'only',
        itemIds: [assetId, assetId],
      },
    },
  });

  expect(result.success).toBe(false);
  expect(result.error?.issues).toEqual([expect.objectContaining({ message: 'itemIds must be unique' })]);
});

it('rejects unsupported sparse item kinds', () => {
  const operationId = factory.uuid();

  const result = AgentOperationPlanApplyRequestDto.schema.safeParse({
    operationIds: [operationId],
    itemSelections: {
      [operationId]: {
        itemKind: 'photo',
        mode: 'none',
      },
    },
  });

  expect(result.success).toBe(false);
});
```

In `server/src/controllers/agent-operation-plan.controller.spec.ts`, add this constant beside the existing `operationId` test data:

```ts
const assetId = factory.uuid();
```

Add this test inside `describe('POST /agent/sessions/:id/operation-plan/:planId/apply', () => { ... })`:

```ts
it('accepts sparse item selections and plan revision in the apply body', async () => {
  const dto: AgentOperationPlanApplyRequestDto = {
    operationIds: [operationId],
    itemSelections: {
      [operationId]: {
        itemKind: 'asset',
        mode: 'allExcept',
        itemIds: [assetId],
      },
    },
    planRevision: 1,
  };

  service.applyApprovedOperations.mockResolvedValue({
    status: AgentOperationApplyStatus.Applied,
    plan: {
      ...plan,
      status: AgentOperationPlanStatus.Applied,
      operations: [
        { ...plan.operations[0], status: AgentOperationStatus.Applied, result: { albumId: factory.uuid() } },
      ],
    },
    appliedOperationIds: [operationId],
    skippedOperationIds: [],
    failedOperationIds: [],
    summary: 'Applied 1 operation(s), skipped 0, failed 0.',
  });

  const { status } = await request(ctx.getHttpServer())
    .post(`/agent/sessions/${sessionId}/operation-plan/${planId}/apply`)
    .send(dto);

  expect(status).toBe(201);
  expect(service.applyApprovedOperations).toHaveBeenCalledWith(auth, sessionId, planId, dto);
});
```

Add this validation test after the existing invalid body test:

```ts
it('rejects invalid sparse item selections before calling the service', async () => {
  const { status } = await request(ctx.getHttpServer())
    .post(`/agent/sessions/${sessionId}/operation-plan/${planId}/apply`)
    .send({
      operationIds: [operationId],
      itemSelections: {
        [operationId]: {
          itemKind: 'photo',
          mode: 'allExcept',
          itemIds: [assetId],
        },
      },
      planRevision: 1,
    });

  expect(status).toBe(400);
  expect(service.applyApprovedOperations).not.toHaveBeenCalled();
});
```

Add this duplicate-ID validation test beside it:

```ts
it('rejects duplicate sparse item ids before calling the service', async () => {
  const { status } = await request(ctx.getHttpServer())
    .post(`/agent/sessions/${sessionId}/operation-plan/${planId}/apply`)
    .send({
      operationIds: [operationId],
      itemSelections: {
        [operationId]: {
          itemKind: 'asset',
          mode: 'only',
          itemIds: [assetId, assetId],
        },
      },
      planRevision: 1,
    });

  expect(status).toBe(400);
  expect(service.applyApprovedOperations).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run the focused controller tests and verify RED**

Run:

```bash
pnpm --dir server test --run src/dtos/agent-operation.dto.spec.ts src/controllers/agent-operation-plan.controller.spec.ts -t "sparse item selections|invalid sparse|duplicate sparse|unsupported sparse|plan revision"
```

Expected: FAIL because `AgentOperationPlanApplyRequestDto` does not accept `itemSelections` or `planRevision`.

- [ ] **Step 3: Extend the DTO schema**

In `server/src/dtos/agent-operation.dto.ts`, add these schemas below `uniqueOperationIds`:

```ts
const uniqueSelectionItemIds = (schema = z.array(uuid).max(10_000)) =>
  schema.superRefine((itemIds, ctx) => {
    if (new Set(itemIds).size !== itemIds.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'itemIds must be unique',
      });
    }
  });

const requiredUniqueSelectionItemIds = uniqueSelectionItemIds(z.array(uuid).min(1).max(10_000));

const AgentOperationItemKindSchema = z.literal('asset').meta({ id: 'AgentOperationItemKind' });

const AgentOperationItemSelectionSchema = z
  .discriminatedUnion('mode', [
    z.strictObject({
      itemKind: AgentOperationItemKindSchema,
      mode: z.literal('all'),
      itemIds: z.array(uuid).length(0).optional(),
    }),
    z.strictObject({
      itemKind: AgentOperationItemKindSchema,
      mode: z.literal('allExcept'),
      itemIds: requiredUniqueSelectionItemIds,
    }),
    z.strictObject({
      itemKind: AgentOperationItemKindSchema,
      mode: z.literal('only'),
      itemIds: requiredUniqueSelectionItemIds,
    }),
    z.strictObject({
      itemKind: AgentOperationItemKindSchema,
      mode: z.literal('none'),
      itemIds: z.array(uuid).length(0).optional(),
    }),
  ])
  .meta({ id: 'AgentOperationItemSelection' });
```

Replace `AgentOperationPlanApplyRequestSchema` with:

```ts
const AgentOperationPlanApplyRequestSchema = z
  .strictObject({
    operationIds: uniqueOperationIds,
    itemSelections: z.record(uuid, AgentOperationItemSelectionSchema).optional(),
    planRevision: z.number().int().min(1).optional(),
  })
  .meta({ id: 'AgentOperationPlanApplyRequestDto' });
```

- [ ] **Step 4: Run the focused controller tests and verify GREEN**

Run:

```bash
pnpm --dir server test --run src/dtos/agent-operation.dto.spec.ts src/controllers/agent-operation-plan.controller.spec.ts -t "sparse item selections|invalid sparse|duplicate sparse|unsupported sparse|validates apply params|plan revision"
```

Expected: PASS. The existing invalid `operationIds: []` test must still return `400`.

- [ ] **Step 5: Commit**

```bash
git add server/src/dtos/agent-operation.dto.ts server/src/dtos/agent-operation.dto.spec.ts server/src/controllers/agent-operation-plan.controller.spec.ts
git commit -m "feat: accept sparse pi plan item selections"
```

---

### Task 2: Validate And Normalize Sparse Selections Server-Side

**Files:**

- Modify: `server/src/services/agent-operation-plan.service.spec.ts`
- Modify: `server/src/services/agent-operation-plan.service.ts`

- [ ] **Step 1: Write failing service validation tests**

In `server/src/services/agent-operation-plan.service.spec.ts`, add this helper near the other helpers:

```ts
const makeAddAssetsPlan = (auth: AuthDto, assetIds: string[]) => {
  const session = makeSession({ userId: auth.user.id, status: AgentSessionStatus.WaitingForPlanReview });
  const albumId = newUuid();
  const operation = makeOperation({
    id: newUuid(),
    planId: 'plan-id',
    type: AgentOperationType.AlbumAddAssets,
    targetKind: AgentOperationTargetKind.ExistingAlbum,
    targetId: albumId,
    temporaryTargetId: null,
    assetIds,
    payload: {},
  });
  const plan = makePlan({ id: 'plan-id', sessionId: session.id, operations: [operation] });

  return { session, albumId, operation, plan };
};
```

Add these tests in the `applyApprovedOperations` describe block before the first successful mutation test:

```ts
it('rejects stale plan revisions before claiming the plan', async () => {
  const auth = AuthFactory.create();
  const { session, operation, plan } = makeAddAssetsPlan(auth, [newUuid()]);
  sessionRepository.getById.mockResolvedValue(session);
  planRepository.getByIdForSession.mockResolvedValue(plan);
  planRepository.getCurrentBySessionId.mockResolvedValue(plan);

  await expect(
    sut.applyApprovedOperations(auth, session.id, plan.id, {
      operationIds: [operation.id],
      planRevision: plan.revision + 1,
    }),
  ).rejects.toThrow('Agent operation plan revision is stale');

  expect(planRepository.claimCurrentForApply).not.toHaveBeenCalled();
  expect(albumService.addAssets).not.toHaveBeenCalled();
});

it('rejects sparse selections for operation ids outside the selected operation set', async () => {
  const auth = AuthFactory.create();
  const assetId = newUuid();
  const { session, operation, plan } = makeAddAssetsPlan(auth, [assetId]);
  sessionRepository.getById.mockResolvedValue(session);
  planRepository.getByIdForSession.mockResolvedValue(plan);
  planRepository.getCurrentBySessionId.mockResolvedValue(plan);

  await expect(
    sut.applyApprovedOperations(auth, session.id, plan.id, {
      operationIds: [operation.id],
      itemSelections: {
        [newUuid()]: { itemKind: 'asset', mode: 'allExcept', itemIds: [assetId] },
      },
    }),
  ).rejects.toThrow('One or more item selection operation ids are not selected');

  expect(planRepository.claimCurrentForApply).not.toHaveBeenCalled();
});

it('rejects sparse selections containing asset ids outside the operation affected set', async () => {
  const auth = AuthFactory.create();
  const assetId = newUuid();
  const { session, operation, plan } = makeAddAssetsPlan(auth, [assetId]);
  sessionRepository.getById.mockResolvedValue(session);
  planRepository.getByIdForSession.mockResolvedValue(plan);
  planRepository.getCurrentBySessionId.mockResolvedValue(plan);

  await expect(
    sut.applyApprovedOperations(auth, session.id, plan.id, {
      operationIds: [operation.id],
      itemSelections: {
        [operation.id]: { itemKind: 'asset', mode: 'only', itemIds: [newUuid()] },
      },
    }),
  ).rejects.toThrow('One or more selected item ids are not affected by the operation');

  expect(planRepository.claimCurrentForApply).not.toHaveBeenCalled();
});

it('rejects sparse selections for operations without affected assets', async () => {
  const auth = AuthFactory.create();
  const session = makeSession({ userId: auth.user.id, status: AgentSessionStatus.WaitingForPlanReview });
  const createOperation = makeOperation({ id: newUuid(), planId: 'plan-id', temporaryTargetId: 'tmp-portugal' });
  const plan = makePlan({ id: 'plan-id', sessionId: session.id, operations: [createOperation] });
  sessionRepository.getById.mockResolvedValue(session);
  planRepository.getByIdForSession.mockResolvedValue(plan);
  planRepository.getCurrentBySessionId.mockResolvedValue(plan);

  await expect(
    sut.applyApprovedOperations(auth, session.id, plan.id, {
      operationIds: [createOperation.id],
      itemSelections: {
        [createOperation.id]: { itemKind: 'asset', mode: 'only', itemIds: [newUuid()] },
      },
    }),
  ).rejects.toThrow('Item selection is not supported for one or more operations');

  expect(planRepository.claimCurrentForApply).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run the focused service tests and verify RED**

Run:

```bash
pnpm --dir server test --run src/services/agent-operation-plan.service.spec.ts -t "stale plan revisions|operation ids outside|outside the operation affected set|without affected assets"
```

Expected: FAIL because the service does not inspect `planRevision` or `itemSelections`.

- [ ] **Step 3: Add selection validation types and helpers**

In `server/src/services/agent-operation-plan.service.ts`, add these types below `PlanningAuditCreate`:

```ts
type SparseItemSelection = NonNullable<AgentOperationPlanApplyRequestDto['itemSelections']>[string];

type ApplySelection = {
  selectedOperationIds: Set<string>;
  selectedAssetIdsByOperationId: Map<string, string[]>;
};
```

Replace the validation and selection lines in `applyApprovedOperations`:

```ts
const currentPlan = await this.requireCurrentProposedPlan(session.id, planId);
this.validateApplyOperationIds(currentPlan, dto.operationIds);
```

with:

```ts
const currentPlan = await this.requireCurrentProposedPlan(session.id, planId);
const applySelection = this.validateApplySelection(currentPlan, dto);
```

Replace:

```ts
const selectedOperationIds = new Set(dto.operationIds);
const applyUpdates = await this.applyClaimedPlan(auth, session, claimedPlan, selectedOperationIds);
const appliedPlan = await this.planRepository.completeApply(claimedPlan.id, applyUpdates);
const response = this.buildApplyResponse(this.mapPlan(appliedPlan), selectedOperationIds);
```

with:

```ts
const applyUpdates = await this.applyClaimedPlan(auth, session, claimedPlan, applySelection);
const appliedPlan = await this.planRepository.completeApply(claimedPlan.id, applyUpdates);
const response = this.buildApplyResponse(this.mapPlan(appliedPlan), applySelection.selectedOperationIds);
```

Add these methods near `validateApplyOperationIds`:

```ts
private validateApplySelection(
  plan: AgentOperationPlanWithOperations,
  dto: AgentOperationPlanApplyRequestDto,
): ApplySelection {
  if (dto.planRevision !== undefined && dto.planRevision !== plan.revision) {
    throw new BadRequestException('Agent operation plan revision is stale');
  }

  this.validateApplyOperationIds(plan, dto.operationIds);

  const selectedOperationIds = new Set(dto.operationIds);
  const operationById = new Map(plan.operations.map((operation) => [operation.id, operation]));
  const selectedAssetIdsByOperationId = new Map<string, string[]>();

  for (const [operationId, selection] of Object.entries(dto.itemSelections ?? {})) {
    if (!selectedOperationIds.has(operationId)) {
      throw new BadRequestException('One or more item selection operation ids are not selected');
    }

    const operation = operationById.get(operationId);
    if (!operation) {
      throw new BadRequestException('One or more item selection operation ids are not in the current plan');
    }

    const selectedAssetIds = this.resolveSelectedAssetIds(operation, selection);
    selectedAssetIdsByOperationId.set(operationId, selectedAssetIds);
  }

  return { selectedOperationIds, selectedAssetIdsByOperationId };
}

private resolveSelectedAssetIds(
  operation: AgentOperationPlanWithOperations['operations'][number],
  selection: SparseItemSelection,
) {
  if (selection.itemKind !== 'asset' || operation.assetIds.length === 0) {
    throw new BadRequestException('Item selection is not supported for one or more operations');
  }

  const affectedAssetIds = [...new Set(operation.assetIds)];
  const affectedAssetIdSet = new Set(affectedAssetIds);
  const itemIds = selection.itemIds ?? [];

  if (itemIds.some((itemId) => !affectedAssetIdSet.has(itemId))) {
    throw new BadRequestException('One or more selected item ids are not affected by the operation');
  }

  switch (selection.mode) {
    case 'all':
      return affectedAssetIds;
    case 'allExcept': {
      const excludedAssetIds = new Set(itemIds);
      return affectedAssetIds.filter((assetId) => !excludedAssetIds.has(assetId));
    }
    case 'only':
      return affectedAssetIds.filter((assetId) => itemIds.includes(assetId));
    case 'none':
      return [];
  }
}
```

- [ ] **Step 4: Run the focused service validation tests and verify GREEN**

Run:

```bash
pnpm --dir server test --run src/services/agent-operation-plan.service.spec.ts -t "stale plan revisions|operation ids outside|outside the operation affected set|without affected assets"
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/services/agent-operation-plan.service.ts server/src/services/agent-operation-plan.service.spec.ts
git commit -m "feat: validate sparse pi plan selections"
```

---

### Task 3: Apply Filtered Asset IDs On The Server

**Files:**

- Modify: `server/src/services/agent-operation-plan.service.spec.ts`
- Modify: `server/src/services/agent-operation-plan.service.ts`

- [ ] **Step 1: Write failing apply behavior tests**

In `server/src/services/agent-operation-plan.service.spec.ts`, add these tests in the apply describe block:

```ts
it('applies add-assets operations with filtered allExcept asset ids', async () => {
  const auth = AuthFactory.create();
  const keptAssetId = newUuid();
  const excludedAssetId = newUuid();
  const { session, albumId, operation, plan } = makeAddAssetsPlan(auth, [keptAssetId, excludedAssetId]);
  sessionRepository.getById.mockResolvedValue(session);
  planRepository.getByIdForSession.mockResolvedValue(plan);
  planRepository.getCurrentBySessionId.mockResolvedValue(plan);
  planRepository.claimCurrentForApply.mockResolvedValue({ ...plan, status: AgentOperationPlanStatus.Applied });
  planRepository.completeApply.mockResolvedValue({
    ...plan,
    status: AgentOperationPlanStatus.Applied,
    operations: [
      {
        ...operation,
        status: AgentOperationStatus.Applied,
        result: { albumId, assetIds: [keptAssetId], assetResults: [{ id: keptAssetId, success: true }] },
      },
    ],
  });
  accessRepository.album.checkOwnerAccess.mockResolvedValue(new Set([albumId]));
  accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set([keptAssetId]));
  assetRepository.getAgentReadableIds.mockResolvedValue(new Set([keptAssetId]));
  albumService.addAssets.mockResolvedValue([{ id: keptAssetId, success: true }]);

  const result = await sut.applyApprovedOperations(auth, session.id, plan.id, {
    operationIds: [operation.id],
    itemSelections: {
      [operation.id]: { itemKind: 'asset', mode: 'allExcept', itemIds: [excludedAssetId] },
    },
    planRevision: plan.revision,
  });

  expect(result.status).toBe(AgentOperationApplyStatus.Applied);
  expect(accessRepository.asset.checkOwnerAccess).toHaveBeenCalledWith(auth.user.id, new Set([keptAssetId]), true);
  expect(albumService.addAssets).toHaveBeenCalledWith(auth, albumId, { ids: [keptAssetId] });
});

it('skips an asset operation when sparse selection leaves no selected assets', async () => {
  const auth = AuthFactory.create();
  const assetId = newUuid();
  const { session, operation, plan } = makeAddAssetsPlan(auth, [assetId]);
  sessionRepository.getById.mockResolvedValue(session);
  planRepository.getByIdForSession.mockResolvedValue(plan);
  planRepository.getCurrentBySessionId.mockResolvedValue(plan);
  planRepository.claimCurrentForApply.mockResolvedValue({ ...plan, status: AgentOperationPlanStatus.Applied });
  planRepository.completeApply.mockResolvedValue({
    ...plan,
    status: AgentOperationPlanStatus.Applied,
    operations: [
      {
        ...operation,
        status: AgentOperationStatus.Skipped,
        result: { skippedReason: 'No selected items for operation' },
      },
    ],
  });

  const result = await sut.applyApprovedOperations(auth, session.id, plan.id, {
    operationIds: [operation.id],
    itemSelections: {
      [operation.id]: { itemKind: 'asset', mode: 'allExcept', itemIds: [assetId] },
    },
  });

  expect(result.status).toBe(AgentOperationApplyStatus.Failed);
  expect(result.skippedOperationIds).toEqual([operation.id]);
  expect(albumService.addAssets).not.toHaveBeenCalled();
});

it('skips a dependent operation when its dependency has no selected items', async () => {
  const auth = AuthFactory.create();
  const assetId = newUuid();
  const session = makeSession({ userId: auth.user.id, status: AgentSessionStatus.WaitingForPlanReview });
  const addOperation = makeOperation({
    id: newUuid(),
    planId: 'plan-id',
    type: AgentOperationType.AlbumAddAssets,
    targetKind: AgentOperationTargetKind.ExistingAlbum,
    targetId: newUuid(),
    temporaryTargetId: null,
    assetIds: [assetId],
    payload: {},
  });
  const coverOperation = makeOperation({
    id: newUuid(),
    planId: 'plan-id',
    position: 1,
    type: AgentOperationType.AlbumSetCover,
    targetKind: AgentOperationTargetKind.ExistingAlbum,
    targetId: addOperation.targetId,
    temporaryTargetId: null,
    assetIds: [assetId],
    payload: {},
    dependencyIds: [addOperation.id],
  });
  const plan = makePlan({ id: 'plan-id', sessionId: session.id, operations: [addOperation, coverOperation] });
  sessionRepository.getById.mockResolvedValue(session);
  planRepository.getByIdForSession.mockResolvedValue(plan);
  planRepository.getCurrentBySessionId.mockResolvedValue(plan);
  planRepository.claimCurrentForApply.mockResolvedValue({ ...plan, status: AgentOperationPlanStatus.Applied });
  planRepository.completeApply.mockResolvedValue({
    ...plan,
    status: AgentOperationPlanStatus.Applied,
    operations: [
      {
        ...addOperation,
        status: AgentOperationStatus.Skipped,
        result: { skippedReason: 'No selected items for operation' },
      },
      {
        ...coverOperation,
        status: AgentOperationStatus.Skipped,
        result: { skippedReason: 'Dependency was not applied' },
      },
    ],
  });

  const result = await sut.applyApprovedOperations(auth, session.id, plan.id, {
    operationIds: [addOperation.id, coverOperation.id],
    itemSelections: {
      [addOperation.id]: { itemKind: 'asset', mode: 'none' },
    },
  });

  expect(result.skippedOperationIds).toEqual([addOperation.id, coverOperation.id]);
  expect(albumService.addAssets).not.toHaveBeenCalled();
  expect(albumService.update).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run the focused server tests and verify RED**

Run:

```bash
pnpm --dir server test --run src/services/agent-operation-plan.service.spec.ts -t "filtered allExcept|leaves no selected assets|dependency has no selected items"
```

Expected: FAIL because apply still uses the original operation asset IDs.

- [ ] **Step 3: Use normalized selected assets during apply**

In `server/src/services/agent-operation-plan.service.ts`, change `applyClaimedPlan` signature:

```ts
private async applyClaimedPlan(
  auth: AuthDto,
  session: AgentSession,
  plan: AgentOperationPlanWithOperations,
  applySelection: ApplySelection,
): Promise<AgentOperationApplyUpdate[]> {
```

Inside `applyClaimedPlan`, add:

```ts
const { selectedOperationIds, selectedAssetIdsByOperationId } = applySelection;
```

Before `try { await this.validateApplyAccess(...) }`, add:

```ts
const selectedAssetIds = selectedAssetIdsByOperationId.get(operation.id);
const operationForApply =
  selectedAssetIds === undefined
    ? operation
    : {
        ...operation,
        assetIds: selectedAssetIds,
      };

if (selectedAssetIds?.length === 0) {
  updates.push(this.skippedOperation(operation.id, 'No selected items for operation'));
  continue;
}
```

Replace the two apply calls in the `try` block:

```ts
await this.validateApplyAccess(auth, session, operation);
const update = await this.applySingleOperation(auth, operation, createdAlbumIdByTemporaryTargetId);
```

with:

```ts
await this.validateApplyAccess(auth, session, operationForApply);
const update = await this.applySingleOperation(auth, operationForApply, createdAlbumIdByTemporaryTargetId);
```

- [ ] **Step 4: Run server apply tests and verify GREEN**

Run:

```bash
pnpm --dir server test --run src/services/agent-operation-plan.service.spec.ts -t "filtered allExcept|leaves no selected assets|dependency has no selected items|applies a selected new-album plan"
```

Expected: PASS. The legacy apply test proves operation-only payloads still work.

- [ ] **Step 5: Commit**

```bash
git add server/src/services/agent-operation-plan.service.ts server/src/services/agent-operation-plan.service.spec.ts
git commit -m "feat: apply filtered pi plan assets"
```

---

### Task 4: Add Sparse Selection Helpers To The Frontend View Model

**Files:**

- Modify: `web/src/routes/(user)/assistant/agent-operation-plan-ui.spec.ts`
- Modify: `web/src/routes/(user)/assistant/agent-operation-plan-ui.ts`

- [ ] **Step 1: Write failing view-model tests**

In `web/src/routes/(user)/assistant/agent-operation-plan-ui.spec.ts`, add these imports from `./agent-operation-plan-ui`:

```ts
import {
  buildOperationItemSelectionState,
  createInitialOperationItemSelectionState,
  resetOperationItemSelection,
  setOperationItemSelection,
} from './agent-operation-plan-ui';
```

Add these tests near the existing selection payload tests:

```ts
it('builds sparse allExcept payloads and mixed selection counts after excluding one asset', () => {
  const currentPlan = plan([
    operation({
      id: addId,
      type: AgentOperationType.AlbumAddAssets,
      summary: 'Add two assets',
      targetKind: AgentOperationTargetKind.ExistingAlbum,
      targetId: '00000000-0000-4000-8000-000000000301',
      assetIds: [assetA, assetB],
      payload: {},
    }),
  ]);
  const initialItemState = createInitialOperationItemSelectionState(currentPlan);
  const itemSelectionState = buildOperationItemSelectionState(currentPlan, initialItemState, addId, assetB, false);
  const model = buildOperationReviewModel(currentPlan, { [addId]: true }, itemSelectionState);

  expect(model.operationsById.get(addId)?.review.selection).toEqual({
    itemKind: 'asset',
    totalCount: 2,
    selectedCount: 1,
    mode: 'allExcept',
    itemIds: [assetB],
    supportsItemSelection: true,
  });
  expect(model.operationsById.get(addId)).toEqual(
    expect.objectContaining({
      selected: true,
      enabled: true,
      mixed: true,
      excludedAssetCount: 1,
    }),
  );
  expect(buildSelectionPayload(model)).toEqual({
    planId,
    planRevision: 1,
    operationIds: [addId],
    itemSelections: {
      [addId]: { itemKind: 'asset', mode: 'allExcept', itemIds: [assetB] },
    },
  });
});

it('omits an operation when all selectable assets are excluded', () => {
  const currentPlan = plan([
    operation({
      id: addId,
      type: AgentOperationType.AlbumAddAssets,
      summary: 'Add two assets',
      targetKind: AgentOperationTargetKind.ExistingAlbum,
      targetId: '00000000-0000-4000-8000-000000000301',
      assetIds: [assetA, assetB],
      payload: {},
    }),
  ]);
  const itemSelectionState = setOperationItemSelection({}, addId, {
    itemKind: 'asset',
    mode: 'allExcept',
    itemIds: [assetA, assetB],
  });
  const model = buildOperationReviewModel(currentPlan, { [addId]: true }, itemSelectionState);

  expect(model.operationsById.get(addId)).toEqual(
    expect.objectContaining({
      enabled: false,
      mixed: false,
      excludedAssetCount: 2,
    }),
  );
  expect(buildApprovedOperationIds(model)).toEqual([]);
  expect(buildSelectionPayload(model)).toEqual({ planId, planRevision: 1, operationIds: [] });
});

it('preserves sparse only selections in the apply payload', () => {
  const currentPlan = plan([
    operation({
      id: addId,
      type: AgentOperationType.AlbumAddAssets,
      summary: 'Add two assets',
      targetKind: AgentOperationTargetKind.ExistingAlbum,
      targetId: '00000000-0000-4000-8000-000000000301',
      assetIds: [assetA, assetB],
      payload: {},
    }),
  ]);
  const itemSelectionState = setOperationItemSelection({}, addId, {
    itemKind: 'asset',
    mode: 'only',
    itemIds: [assetA],
  });
  const model = buildOperationReviewModel(currentPlan, { [addId]: true }, itemSelectionState);

  expect(model.operationsById.get(addId)?.review.selection.selectedCount).toBe(1);
  expect(buildSelectionPayload(model)).toEqual({
    planId,
    planRevision: 1,
    operationIds: [addId],
    itemSelections: {
      [addId]: { itemKind: 'asset', mode: 'only', itemIds: [assetA] },
    },
  });
});

it('resets item selection overrides back to default all selection', () => {
  const currentPlan = plan([
    operation({
      id: addId,
      type: AgentOperationType.AlbumAddAssets,
      summary: 'Add two assets',
      targetKind: AgentOperationTargetKind.ExistingAlbum,
      targetId: '00000000-0000-4000-8000-000000000301',
      assetIds: [assetA, assetB],
      payload: {},
    }),
  ]);
  const excludedState = buildOperationItemSelectionState(
    currentPlan,
    createInitialOperationItemSelectionState(currentPlan),
    addId,
    assetB,
    false,
  );
  const resetState = resetOperationItemSelection(excludedState, addId);
  const model = buildOperationReviewModel(currentPlan, { [addId]: true }, resetState);

  expect(resetState[addId]).toBeUndefined();
  expect(model.operationsById.get(addId)?.review.selection).toEqual({
    itemKind: 'asset',
    totalCount: 2,
    selectedCount: 2,
    mode: 'all',
    supportsItemSelection: true,
  });
  expect(buildSelectionPayload(model)).toEqual({ planId, planRevision: 1, operationIds: [addId] });
});

it('keeps large operations sparse without creating an eager selected id list', () => {
  const assetIds = Array.from(
    { length: 1_000 },
    (_, index) => `00000000-0000-4000-8000-${index.toString().padStart(12, '0')}`,
  );
  const currentPlan = plan([
    operation({
      id: addId,
      type: AgentOperationType.AlbumAddAssets,
      summary: 'Add many assets',
      targetKind: AgentOperationTargetKind.ExistingAlbum,
      targetId: '00000000-0000-4000-8000-000000000301',
      assetIds,
      payload: {},
    }),
  ]);
  const itemSelectionState = buildOperationItemSelectionState(
    currentPlan,
    createInitialOperationItemSelectionState(currentPlan),
    addId,
    assetIds[999],
    false,
  );
  const model = buildOperationReviewModel(currentPlan, { [addId]: true }, itemSelectionState);

  expect(model.operationsById.get(addId)?.review.selection.selectedCount).toBe(999);
  expect(model.operationsById.get(addId)?.review.selection.itemIds).toEqual([assetIds[999]]);
  expect(buildSelectionPayload(model).itemSelections?.[addId].itemIds).toHaveLength(1);
});
```

- [ ] **Step 2: Run focused view-model tests and verify RED**

Run:

```bash
pnpm --dir web test --run "src/routes/(user)/assistant/agent-operation-plan-ui.spec.ts" -t "sparse allExcept|all selectable assets|sparse only|resets item selection|large operations sparse"
```

Expected: FAIL because the sparse item-selection helpers and mixed fields do not exist.

- [ ] **Step 3: Add sparse selection types and helpers**

In `web/src/routes/(user)/assistant/agent-operation-plan-ui.ts`, replace `AgentOperationSelectionPayload` with:

```ts
export type AgentOperationItemSelectionPayload = {
  itemKind: AgentReviewItemKind;
  mode: AgentReviewSelectionMode;
  itemIds?: string[];
};

export type AgentOperationSelectionPayload = {
  planId: string;
  planRevision: number;
  operationIds: string[];
  itemSelections?: Record<string, AgentOperationItemSelectionPayload>;
};
```

Add these types below `OperationEnabledState`:

```ts
export type OperationItemSelectionState = Record<string, AgentOperationItemSelectionPayload>;
```

Extend `OperationReviewItem` with:

```ts
  mixed: boolean;
  excludedAssetCount: number;
  selectedAssetIds: string[];
```

Add these helpers near `createInitialOperationEnabledState`:

```ts
export const createInitialOperationItemSelectionState = (
  _plan: AgentOperationPlanResponseDto,
): OperationItemSelectionState => ({});

export const setOperationItemSelection = (
  state: OperationItemSelectionState,
  operationId: string,
  selection: AgentOperationItemSelectionPayload,
): OperationItemSelectionState => ({
  ...state,
  [operationId]: normalizeSelection(selection),
});

export const resetOperationItemSelection = (
  state: OperationItemSelectionState,
  operationId: string,
): OperationItemSelectionState => {
  const { [operationId]: _removed, ...remaining } = state;
  return remaining;
};

export const buildOperationItemSelectionState = (
  plan: AgentOperationPlanResponseDto,
  state: OperationItemSelectionState,
  operationId: string,
  assetId: string,
  selected: boolean,
): OperationItemSelectionState => {
  const operation = plan.operations.find((candidate) => candidate.id === operationId);
  if (!operation || !operation.assetIds.includes(assetId)) {
    return state;
  }

  const currentSelection = state[operationId] ?? { itemKind: 'asset', mode: 'all' };
  const currentItemIds = currentSelection.itemIds ?? [];

  if (currentSelection.mode === 'all') {
    return selected
      ? state
      : setOperationItemSelection(state, operationId, {
          itemKind: 'asset',
          mode: 'allExcept',
          itemIds: [assetId],
        });
  }

  if (currentSelection.mode === 'allExcept') {
    const nextItemIds = selected
      ? currentItemIds.filter((itemId) => itemId !== assetId)
      : normalizeItemIds([...currentItemIds, assetId]);

    return nextItemIds.length === 0
      ? resetOperationItemSelection(state, operationId)
      : setOperationItemSelection(state, operationId, {
          itemKind: 'asset',
          mode: 'allExcept',
          itemIds: nextItemIds,
        });
  }

  if (currentSelection.mode === 'only') {
    const nextItemIds = selected
      ? normalizeItemIds([...currentItemIds, assetId])
      : currentItemIds.filter((itemId) => itemId !== assetId);

    return nextItemIds.length === 0
      ? setOperationItemSelection(state, operationId, { itemKind: 'asset', mode: 'none' })
      : setOperationItemSelection(state, operationId, {
          itemKind: 'asset',
          mode: 'only',
          itemIds: nextItemIds,
        });
  }

  return selected
    ? setOperationItemSelection(state, operationId, { itemKind: 'asset', mode: 'only', itemIds: [assetId] })
    : state;
};

const normalizeItemIds = (itemIds: string[]) => [...new Set(itemIds)];

const normalizeSelection = (selection: AgentOperationItemSelectionPayload): AgentOperationItemSelectionPayload => {
  const itemIds = selection.itemIds ? normalizeItemIds(selection.itemIds) : undefined;
  return itemIds ? { ...selection, itemIds } : selection;
};
```

- [ ] **Step 4: Thread item selection through the review model**

Change the signature:

```ts
export const buildOperationReviewModel = (
  plan: AgentOperationPlanResponseDto,
  enabledByOperationId: OperationEnabledState,
  itemSelectionByOperationId: OperationItemSelectionState = {},
): OperationReviewModel => {
```

Before `collectBlockingDependencySummaries`, add:

```ts
const getBaseSelection = (operation: AgentOperationResponseDto) =>
  buildOperationReviewSelection(
    operation,
    enabledByOperationId[operation.id] ?? operation.enabled,
    itemSelectionByOperationId[operation.id],
  );

const isOperationRequested = (operation: AgentOperationResponseDto) => {
  const enabled = enabledByOperationId[operation.id] ?? operation.enabled;
  if (!enabled) {
    return false;
  }

  const selection = getBaseSelection(operation);
  return selection.supportsItemSelection ? selection.selectedCount > 0 : true;
};
```

Inside `collectBlockingDependencySummaries`, replace:

```ts
const dependencyEnabled = enabledByOperationId[dependency.id] ?? dependency.enabled;

if (!dependencyEnabled || dependencyBlockedBy.length > 0) {
```

with:

```ts
if (!isOperationRequested(dependency) || dependencyBlockedBy.length > 0) {
```

When building `items`, pass `itemSelectionByOperationId[operation.id]` into `buildOperationReview`.

Replace the returned item fields:

```ts
      selected,
      enabled: !blocked && selected,
```

with:

```ts
      selected,
      enabled: !blocked && selected && (!review.selection.supportsItemSelection || review.selection.selectedCount > 0),
      mixed:
        review.selection.supportsItemSelection &&
        review.selection.selectedCount > 0 &&
        review.selection.selectedCount < review.selection.totalCount,
      excludedAssetCount: Math.max(review.selection.totalCount - review.selection.selectedCount, 0),
      selectedAssetIds: getSelectedAssetIds(operation, review.selection),
```

Change `buildOperationReview` to accept `itemSelection`:

```ts
const buildOperationReview = (
  operation: AgentOperationResponseDto,
  operationById: Map<string, AgentOperationResponseDto>,
  enabledByOperationId: OperationEnabledState,
  isOperationBlocked: (operation: AgentOperationResponseDto) => boolean,
  selected: boolean,
  blocked: boolean,
  itemSelection?: AgentOperationItemSelectionPayload,
): AgentOperationReview => ({
```

and call:

```ts
selection: buildOperationReviewSelection(operation, selected && !blocked, itemSelection),
```

Replace `buildOperationReviewSelection` with:

```ts
const buildOperationReviewSelection = (
  operation: Pick<AgentOperationResponseDto, 'assetIds'>,
  included: boolean,
  itemSelection?: AgentOperationItemSelectionPayload,
): AgentReviewSelection => {
  const assetIds = [...new Set(operation.assetIds)];
  const totalCount = assetIds.length;
  const supportsItemSelection = totalCount > 0;

  if (!included) {
    return {
      itemKind: 'asset',
      totalCount,
      selectedCount: 0,
      mode: 'none',
      supportsItemSelection,
    };
  }

  if (!supportsItemSelection) {
    return {
      itemKind: 'asset',
      totalCount,
      selectedCount: 0,
      mode: 'all',
      supportsItemSelection: false,
    };
  }

  const selection = itemSelection ?? { itemKind: 'asset', mode: 'all' as const };
  const itemIds = (selection.itemIds ?? []).filter((itemId) => assetIds.includes(itemId));

  if (selection.mode === 'allExcept') {
    return {
      itemKind: 'asset',
      totalCount,
      selectedCount: Math.max(totalCount - itemIds.length, 0),
      mode: 'allExcept',
      itemIds,
      supportsItemSelection: true,
    };
  }

  if (selection.mode === 'only') {
    return {
      itemKind: 'asset',
      totalCount,
      selectedCount: itemIds.length,
      mode: 'only',
      itemIds,
      supportsItemSelection: true,
    };
  }

  if (selection.mode === 'none') {
    return {
      itemKind: 'asset',
      totalCount,
      selectedCount: 0,
      mode: 'none',
      supportsItemSelection: true,
    };
  }

  return {
    itemKind: 'asset',
    totalCount,
    selectedCount: totalCount,
    mode: 'all',
    supportsItemSelection: true,
  };
};
```

Add:

```ts
const getSelectedAssetIds = (
  operation: Pick<AgentOperationResponseDto, 'assetIds'>,
  selection: AgentReviewSelection,
) => {
  const assetIds = [...new Set(operation.assetIds)];

  if (!selection.supportsItemSelection) {
    return assetIds;
  }

  if (selection.mode === 'all') {
    return assetIds;
  }

  if (selection.mode === 'allExcept') {
    const excludedAssetIds = new Set(selection.itemIds ?? []);
    return assetIds.filter((assetId) => !excludedAssetIds.has(assetId));
  }

  if (selection.mode === 'only') {
    const includedAssetIds = new Set(selection.itemIds ?? []);
    return assetIds.filter((assetId) => includedAssetIds.has(assetId));
  }

  return [];
};
```

- [ ] **Step 5: Include sparse selection in payloads and counts**

Replace `buildApprovedOperationIds` with:

```ts
export const buildApprovedOperationIds = (model: OperationReviewModel) =>
  model.plan.operations
    .map((operation) => model.operationsById.get(operation.id))
    .filter((operation): operation is OperationReviewItem => operation !== undefined)
    .filter((operation) => operation.enabled && !operation.blocked)
    .map((operation) => operation.id);
```

Replace `buildSelectionPayload` with:

```ts
export const buildSelectionPayload = (model: OperationReviewModel): AgentOperationSelectionPayload => {
  const operationIds = buildApprovedOperationIds(model);
  const itemSelections = Object.fromEntries(
    operationIds
      .map((operationId) => model.operationsById.get(operationId))
      .filter((operation): operation is OperationReviewItem => operation !== undefined)
      .filter((operation) => operation.review.selection.supportsItemSelection)
      .filter((operation) => operation.review.selection.mode !== 'all')
      .map((operation) => [
        operation.id,
        {
          itemKind: operation.review.selection.itemKind,
          mode: operation.review.selection.mode,
          ...(operation.review.selection.itemIds ? { itemIds: operation.review.selection.itemIds } : {}),
        },
      ]),
  );

  return {
    planId: model.plan.id,
    planRevision: model.plan.revision,
    operationIds,
    ...(Object.keys(itemSelections).length > 0 ? { itemSelections } : {}),
  };
};
```

In `buildOperationReviewImpactSummary`, compute selected assets from `selectedOperations.flatMap((operation) => operation.selectedAssetIds)` and unique them:

```ts
selectedAssetCount: new Set(selectedOperations.flatMap((operation) => operation.selectedAssetIds)).size,
```

- [ ] **Step 6: Run the view-model tests and verify GREEN**

Run:

```bash
pnpm --dir web test --run "src/routes/(user)/assistant/agent-operation-plan-ui.spec.ts"
```

Expected: PASS after updating existing payload expectations to include `planRevision: 1`.

- [ ] **Step 7: Commit**

```bash
git add web/src/routes/\(user\)/assistant/agent-operation-plan-ui.ts web/src/routes/\(user\)/assistant/agent-operation-plan-ui.spec.ts
git commit -m "feat: model sparse pi plan item selection"
```

---

### Task 5: Add Bounded Expanded Item Review Component

**Files:**

- Create: `web/src/routes/(user)/assistant/agent-plan-item-review.svelte`
- Create: `web/src/routes/(user)/assistant/agent-plan-item-review.spec.ts`
- Modify: `web/src/routes/(user)/assistant/agent-operation-plan-ui.ts`
- Modify: `i18n/en.json`

- [ ] **Step 1: Write failing component tests**

Create `web/src/routes/(user)/assistant/agent-plan-item-review.spec.ts`:

```ts
import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { readable } from 'svelte/store';
import type { OperationReviewItem } from './agent-operation-plan-ui';
import AgentPlanItemReview from './agent-plan-item-review.svelte';

vi.mock('$lib/utils', () => ({
  getAssetMediaUrl: ({ id, size }: { id: string; size: string }) => `/api/assets/${id}/thumbnail?size=${size}`,
}));

vi.mock('svelte-i18n', () => {
  const messages: Record<string, string> = {
    assistant_operation_item_review_label: 'Review photos for {summary}',
    assistant_operation_item_selected_count: '{selected} of {total} selected',
    assistant_operation_item_excluded_count: '{count} excluded',
    assistant_operation_item_reset: 'Reset selection',
    assistant_operation_item_thumbnail_alt: 'Photo {index} of {count}',
    assistant_operation_item_toggle: 'Include photo {index}',
    assistant_operation_item_overflow: '+{count} not shown',
    assistant_operation_item_overflow_label: '{count} more affected photos are not shown',
    assistant_operation_item_thumbnail_unavailable: 'Preview unavailable',
  };

  return {
    t: readable((key: string, options?: { values?: Record<string, string | number> }) =>
      (messages[key] ?? key)
        .replace('{summary}', String(options?.values?.summary ?? ''))
        .replace('{selected}', String(options?.values?.selected ?? ''))
        .replace('{total}', String(options?.values?.total ?? ''))
        .replace('{count}', String(options?.values?.count ?? ''))
        .replace('{index}', String(options?.values?.index ?? '')),
    ),
  };
});

const item = (assetIds: string[]): OperationReviewItem =>
  ({
    id: 'operation-1',
    operation: { assetIds },
    review: {
      summary: 'Add photos',
      selection: {
        itemKind: 'asset',
        totalCount: assetIds.length,
        selectedCount: assetIds.length,
        mode: 'all',
        supportsItemSelection: true,
      },
    },
  }) as OperationReviewItem;

describe('AgentPlanItemReview', () => {
  it('renders selectable thumbnails and dispatches item toggles', async () => {
    const onToggleItem = vi.fn();
    render(AgentPlanItemReview, {
      props: {
        item: item(['asset-1', 'asset-2']),
        canChangeSelection: true,
        onToggleItem,
        onResetSelection: vi.fn(),
      },
    });

    const review = screen.getByRole('group', { name: 'Review photos for Add photos' });
    expect(within(review).getByText('2 of 2 selected')).toBeInTheDocument();
    expect(within(review).getAllByTestId('agent-plan-item-review-image')).toHaveLength(2);
    expect(within(review).queryByText('asset-1')).not.toBeInTheDocument();

    await fireEvent.click(within(review).getByRole('checkbox', { name: 'Include photo 2' }));

    expect(onToggleItem).toHaveBeenCalledWith('operation-1', 'asset-2', false);
  });

  it('shows excluded counts and reset action for partial selection', async () => {
    const onResetSelection = vi.fn();
    render(AgentPlanItemReview, {
      props: {
        item: {
          ...item(['asset-1', 'asset-2']),
          review: {
            ...item(['asset-1', 'asset-2']).review,
            selection: {
              itemKind: 'asset',
              totalCount: 2,
              selectedCount: 1,
              mode: 'allExcept',
              itemIds: ['asset-2'],
              supportsItemSelection: true,
            },
          },
          excludedAssetCount: 1,
        },
        canChangeSelection: true,
        onToggleItem: vi.fn(),
        onResetSelection,
      },
    });

    expect(screen.getByText('1 excluded')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Include photo 2' })).not.toBeChecked();

    await fireEvent.click(screen.getByRole('button', { name: 'Reset selection' }));

    expect(onResetSelection).toHaveBeenCalledWith('operation-1');
  });

  it('renders only a bounded number of thumbnails for large operations', () => {
    const assetIds = Array.from({ length: 1_000 }, (_, index) => `asset-${index + 1}`);
    render(AgentPlanItemReview, {
      props: {
        item: item(assetIds),
        canChangeSelection: true,
        onToggleItem: vi.fn(),
        onResetSelection: vi.fn(),
      },
    });

    expect(screen.getAllByTestId('agent-plan-item-review-image')).toHaveLength(48);
    expect(screen.getByText('+952 not shown')).toBeInTheDocument();
    expect(screen.queryByText('asset-49')).not.toBeInTheDocument();
  });

  it('shows a per-thumbnail fallback when an image fails', async () => {
    render(AgentPlanItemReview, {
      props: {
        item: item(['asset-1']),
        canChangeSelection: true,
        onToggleItem: vi.fn(),
        onResetSelection: vi.fn(),
      },
    });

    await fireEvent.error(screen.getByTestId('agent-plan-item-review-image'));

    expect(screen.getByText('Preview unavailable')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the component tests and verify RED**

Run:

```bash
pnpm --dir web test --run "src/routes/(user)/assistant/agent-plan-item-review.spec.ts"
```

Expected: FAIL because `agent-plan-item-review.svelte` does not exist.

- [ ] **Step 3: Add item review helper and component**

In `web/src/routes/(user)/assistant/agent-operation-plan-ui.ts`, add:

```ts
export const AGENT_PLAN_ITEM_REVIEW_VISIBLE_LIMIT = 48;

export const buildAgentPlanItemReviewAssetIds = (
  item: OperationReviewItem,
  requestedLimit = AGENT_PLAN_ITEM_REVIEW_VISIBLE_LIMIT,
) => item.operation.assetIds.slice(0, Math.max(0, Math.floor(requestedLimit)));

export const isAssetSelectedForOperation = (item: OperationReviewItem, assetId: string) => {
  const selection = item.review.selection;
  if (!selection.supportsItemSelection) {
    return item.enabled;
  }

  if (selection.mode === 'all') {
    return true;
  }

  if (selection.mode === 'allExcept') {
    return !(selection.itemIds ?? []).includes(assetId);
  }

  if (selection.mode === 'only') {
    return (selection.itemIds ?? []).includes(assetId);
  }

  return false;
};
```

Create `web/src/routes/(user)/assistant/agent-plan-item-review.svelte`:

```svelte
<script lang="ts">
  import { getAssetMediaUrl } from '$lib/utils';
  import { AssetMediaSize } from '@immich/sdk';
  import { t } from 'svelte-i18n';
  import {
    buildAgentPlanItemReviewAssetIds,
    isAssetSelectedForOperation,
    type OperationReviewItem,
  } from './agent-operation-plan-ui';

  interface Props {
    item: OperationReviewItem;
    canChangeSelection: boolean;
    onToggleItem: (operationId: string, assetId: string, selected: boolean) => void;
    onResetSelection: (operationId: string) => void;
  }

  let { item, canChangeSelection, onToggleItem, onResetSelection }: Props = $props();
  let failedAssetIds = $state(new Set<string>());

  const visibleAssetIds = $derived(buildAgentPlanItemReviewAssetIds(item));
  const overflowCount = $derived(Math.max(item.review.selection.totalCount - visibleAssetIds.length, 0));

  const markFailed = (assetId: string) => {
    if (failedAssetIds.has(assetId)) {
      return;
    }

    failedAssetIds = new Set([...failedAssetIds, assetId]);
  };
</script>

{#if item.review.selection.supportsItemSelection}
  <section
    class="mt-3 rounded-md border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-900/40"
    role="group"
    aria-label={$t('assistant_operation_item_review_label', { values: { summary: item.review.summary } })}
  >
    <div class="flex flex-wrap items-center justify-between gap-2 text-sm text-gray-600 dark:text-gray-300">
      <div class="flex flex-wrap gap-2">
        <span>
          {$t('assistant_operation_item_selected_count', {
            values: { selected: item.review.selection.selectedCount, total: item.review.selection.totalCount },
          })}
        </span>
        {#if item.excludedAssetCount > 0}
          <span>
            {$t('assistant_operation_item_excluded_count', { values: { count: item.excludedAssetCount } })}
          </span>
        {/if}
      </div>

      {#if item.review.selection.mode !== 'all'}
        <button
          type="button"
          class="rounded-md px-2 py-1 text-sm font-medium text-immich-primary hover:bg-gray-100 dark:text-immich-dark-primary dark:hover:bg-gray-800"
          disabled={!canChangeSelection}
          onclick={() => onResetSelection(item.id)}
        >
          {$t('assistant_operation_item_reset')}
        </button>
      {/if}
    </div>

    <div class="mt-3 grid grid-cols-4 gap-2 sm:grid-cols-6 md:grid-cols-8">
      {#each visibleAssetIds as assetId, index (assetId)}
        {@const selected = isAssetSelectedForOperation(item, assetId)}
        <label
          class="group relative aspect-square overflow-hidden rounded-md border border-gray-200 bg-gray-100 dark:border-gray-700 dark:bg-gray-800"
        >
          <img
            class="size-full object-cover opacity-100"
            class:opacity-40={!selected}
            data-testid="agent-plan-item-review-image"
            src={getAssetMediaUrl({ id: assetId, size: AssetMediaSize.Thumbnail })}
            alt={$t('assistant_operation_item_thumbnail_alt', {
              values: { index: index + 1, count: item.review.selection.totalCount },
            })}
            loading="lazy"
            draggable="false"
            onerror={() => markFailed(assetId)}
          />
          {#if failedAssetIds.has(assetId)}
            <span
              class="absolute inset-0 flex items-center justify-center bg-gray-200 px-1 text-center text-[10px] leading-tight text-gray-600 dark:bg-gray-800 dark:text-gray-300"
            >
              {$t('assistant_operation_item_thumbnail_unavailable')}
            </span>
          {/if}
          <input
            class="absolute left-1.5 top-1.5 size-4"
            type="checkbox"
            aria-label={$t('assistant_operation_item_toggle', { values: { index: index + 1 } })}
            checked={selected}
            disabled={!canChangeSelection}
            onchange={(event) => onToggleItem(item.id, assetId, event.currentTarget.checked)}
          />
        </label>
      {/each}

      {#if overflowCount > 0}
        <div
          class="flex aspect-square items-center justify-center rounded-md border border-gray-200 bg-gray-100 px-2 text-center text-sm font-medium text-gray-600 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300"
          aria-label={$t('assistant_operation_item_overflow_label', { values: { count: overflowCount } })}
        >
          {$t('assistant_operation_item_overflow', { values: { count: overflowCount } })}
        </div>
      {/if}
    </div>
  </section>
{/if}
```

- [ ] **Step 4: Add translations**

Add these keys to `i18n/en.json`:

```json
"assistant_operation_item_review_label": "Review photos for {summary}",
"assistant_operation_item_selected_count": "{selected} of {total} selected",
"assistant_operation_item_excluded_count": "{count} excluded",
"assistant_operation_item_reset": "Reset selection",
"assistant_operation_item_thumbnail_alt": "Photo {index} of {count}",
"assistant_operation_item_toggle": "Include photo {index}",
"assistant_operation_item_overflow": "+{count} not shown",
"assistant_operation_item_overflow_label": "{count} more affected photos are not shown",
"assistant_operation_item_thumbnail_unavailable": "Preview unavailable"
```

- [ ] **Step 5: Run item-review tests and verify GREEN**

Run:

```bash
pnpm --dir web test --run "src/routes/(user)/assistant/agent-plan-item-review.spec.ts"
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add web/src/routes/\(user\)/assistant/agent-operation-plan-ui.ts web/src/routes/\(user\)/assistant/agent-plan-item-review.svelte web/src/routes/\(user\)/assistant/agent-plan-item-review.spec.ts i18n/en.json
git commit -m "feat: add pi plan item review grid"
```

---

### Task 6: Integrate Item Selection Into Plan Review UI

**Files:**

- Modify: `web/src/routes/(user)/assistant/agent-plan-operation-row.svelte`
- Modify: `web/src/routes/(user)/assistant/agent-plan-operation-row.spec.ts`
- Modify: `web/src/routes/(user)/assistant/agent-plan-destination-card.svelte`
- Modify: `web/src/routes/(user)/assistant/agent-plan-destination-card.spec.ts`
- Modify: `web/src/routes/(user)/assistant/agent-plan-evidence-ledger.svelte`
- Modify: `web/src/routes/(user)/assistant/agent-plan-evidence-ledger.spec.ts`
- Modify: `i18n/en.json`

- [ ] **Step 1: Write failing row tests**

In `web/src/routes/(user)/assistant/agent-plan-operation-row.spec.ts`, add i18n messages:

```ts
assistant_operation_asset_selection_summary: '{selected} of {total} photos selected',
assistant_operation_item_review_label: 'Review photos for {summary}',
assistant_operation_item_selected_count: '{selected} of {total} selected',
assistant_operation_item_excluded_count: '{count} excluded',
assistant_operation_item_reset: 'Reset selection',
assistant_operation_item_thumbnail_alt: 'Photo {index} of {count}',
assistant_operation_item_toggle: 'Include photo {index}',
assistant_operation_item_overflow: '+{count} not shown',
assistant_operation_item_overflow_label: '{count} more affected photos are not shown',
assistant_operation_item_thumbnail_unavailable: 'Preview unavailable',
```

Add this test:

```ts
it('shows mixed operation state and expanded item review for partial asset selections', async () => {
  const onToggleItem = vi.fn();
  const currentPlan = plan([
    operation({
      id: addId,
      type: AgentOperationType.AlbumAddAssets,
      summary: 'Add two assets',
      targetKind: AgentOperationTargetKind.NewAlbum,
      temporaryTargetId: 'album-portugal',
      assetIds: [assetA, assetB],
      payload: {},
    }),
  ]);
  const reviewModel = buildOperationReviewModel(
    currentPlan,
    { [addId]: true },
    { [addId]: { itemKind: 'asset', mode: 'allExcept', itemIds: [assetB] } },
  );

  render(AgentPlanOperationRow, {
    props: {
      item: reviewModel.operationsById.get(addId)!,
      canChangeSelection: true,
      onToggleOperation: vi.fn(),
      onToggleItem,
      onResetItemSelection: vi.fn(),
    },
  });

  const checkbox = screen.getByRole('checkbox', { name: 'Add 2 photos' }) as HTMLInputElement;
  expect(checkbox.indeterminate).toBe(true);
  expect(checkbox).toHaveAttribute('aria-checked', 'mixed');
  expect(screen.getByText('1 of 2 photos selected')).toBeInTheDocument();

  await fireEvent.click(screen.getByText('Details'));
  await fireEvent.click(screen.getByRole('checkbox', { name: 'Include photo 2' }));

  expect(onToggleItem).toHaveBeenCalledWith(addId, assetB, true);
});
```

- [ ] **Step 2: Run row tests and verify RED**

Run:

```bash
pnpm --dir web test --run "src/routes/(user)/assistant/agent-plan-operation-row.spec.ts" -t "mixed operation state"
```

Expected: FAIL because row props, mixed state, and item review are not wired.

- [ ] **Step 3: Update operation row**

In `web/src/routes/(user)/assistant/agent-plan-operation-row.svelte`, import:

```ts
import AgentPlanItemReview from './agent-plan-item-review.svelte';
```

Extend props:

```ts
onToggleItem: (operationId: string, assetId: string, selected: boolean) => void;
onResetItemSelection: (operationId: string) => void;
```

Destructure those props.

Add a checkbox action:

```ts
const setMixedCheckbox = (node: HTMLInputElement, state: { checked: boolean; mixed: boolean }) => {
  const update = ({ checked, mixed }: { checked: boolean; mixed: boolean }) => {
    node.indeterminate = mixed;
    node.setAttribute('aria-checked', mixed ? 'mixed' : String(checked));
  };

  update(state);

  return { update };
};
```

Update the operation checkbox:

```svelte
checked={item.enabled}
use:setMixedCheckbox={{ checked: item.enabled, mixed: item.mixed }}
```

Replace the asset count span with selected-count language when item selection is supported:

```svelte
{#if item.review.selection.supportsItemSelection}
  <span>
    {$t('assistant_operation_asset_selection_summary', {
      values: {
        selected: item.review.selection.selectedCount,
        total: item.review.selection.totalCount,
      },
    })}
  </span>
{:else if item.review.selection.totalCount > 0}
  <span>
    {$t('assistant_operation_asset_count', { values: { count: item.review.selection.totalCount } })}
  </span>
{/if}
```

Inside the open details block, render item review before technical details:

```svelte
<AgentPlanItemReview
  {item}
  {canChangeSelection}
  onToggleItem={onToggleItem}
  onResetSelection={onResetItemSelection}
/>
```

- [ ] **Step 4: Thread callbacks through destination card and ledger**

In `agent-plan-destination-card.svelte`, add props:

```ts
onToggleItem: (operationId: string, assetId: string, selected: boolean) => void;
onResetItemSelection: (operationId: string) => void;
```

Pass them to `AgentPlanOperationRow`.

In `agent-plan-evidence-ledger.svelte`, add the same props and pass them to `AgentPlanDestinationCard`.

- [ ] **Step 5: Add translations**

Add to `i18n/en.json`:

```json
"assistant_operation_asset_selection_summary": "{selected} of {total} photos selected"
```

- [ ] **Step 6: Update component tests and verify GREEN**

Update existing `AgentPlanOperationRow`, `AgentPlanDestinationCard`, and `AgentPlanEvidenceLedger` test renders to pass no-op callbacks:

```ts
onToggleItem: vi.fn(),
onResetItemSelection: vi.fn(),
```

Run:

```bash
pnpm --dir web test --run "src/routes/(user)/assistant/agent-plan-operation-row.spec.ts" "src/routes/(user)/assistant/agent-plan-destination-card.spec.ts" "src/routes/(user)/assistant/agent-plan-evidence-ledger.spec.ts"
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add web/src/routes/\(user\)/assistant/agent-plan-operation-row.svelte web/src/routes/\(user\)/assistant/agent-plan-operation-row.spec.ts web/src/routes/\(user\)/assistant/agent-plan-destination-card.svelte web/src/routes/\(user\)/assistant/agent-plan-destination-card.spec.ts web/src/routes/\(user\)/assistant/agent-plan-evidence-ledger.svelte web/src/routes/\(user\)/assistant/agent-plan-evidence-ledger.spec.ts i18n/en.json
git commit -m "feat: show pi plan mixed item selection"
```

---

### Task 7: Send Sparse Apply Payload From The Review Panel

**Files:**

- Modify: `web/src/routes/(user)/assistant/agent-operation-plan-review-panel.svelte`
- Modify: `web/src/routes/(user)/assistant/agent-operation-plan-review-panel.spec.ts`

- [ ] **Step 1: Write failing review-panel tests**

In `web/src/routes/(user)/assistant/agent-operation-plan-review-panel.spec.ts`, update existing selection payload expectations to include `planRevision: 1`.

Add this test:

```ts
it('publishes and applies sparse item selections after a user excludes one photo', async () => {
  sdkMock.getCurrentOperationPlan.mockResolvedValue(samplePlan());
  sdkMock.applyApprovedOperations.mockResolvedValue({
    status: AgentOperationApplyStatus.Applied,
    plan: appliedPlan(),
    appliedOperationIds: [createId, addId, existingId],
    skippedOperationIds: [],
    failedOperationIds: [],
    summary: 'Applied 3 operation(s), skipped 0, failed 0.',
  });
  const onSelectionChange = vi.fn();

  render(AgentOperationPlanReviewPanel, { props: { session, onSelectionChange } });

  await fireEvent.click((await screen.findAllByText('Details'))[1]);
  await fireEvent.click(screen.getByRole('checkbox', { name: 'Include photo 2' }));

  expect(onSelectionChange).toHaveBeenLastCalledWith({
    planId,
    planRevision: 1,
    operationIds: [createId, addId, existingId],
    itemSelections: {
      [addId]: { itemKind: 'asset', mode: 'allExcept', itemIds: [assetB] },
    },
  });
  expect(screen.getByText('1 of 2 photos selected')).toBeInTheDocument();
  expect(screen.getByText('3 changes · 1 assets selected')).toBeInTheDocument();

  await fireEvent.click(screen.getByRole('button', { name: 'Apply 3 selected' }));

  expect(sdkMock.applyApprovedOperations).toHaveBeenCalledWith({
    id: session.id,
    planId,
    agentOperationPlanApplyRequestDto: {
      operationIds: [createId, addId, existingId],
      itemSelections: {
        [addId]: { itemKind: 'asset', mode: 'allExcept', itemIds: [assetB] },
      },
      planRevision: 1,
    },
  });
});
```

- [ ] **Step 2: Run the focused panel test and verify RED**

Run:

```bash
pnpm --dir web test --run "src/routes/(user)/assistant/agent-operation-plan-review-panel.spec.ts" -t "sparse item selections"
```

Expected: FAIL because panel state and apply body are still operation-ID-only.

- [ ] **Step 3: Add item-selection state to the panel**

In `agent-operation-plan-review-panel.svelte`, import:

```ts
buildOperationItemSelectionState,
createInitialOperationItemSelectionState,
resetOperationItemSelection,
type OperationItemSelectionState,
```

Add state:

```ts
let itemSelectionByOperationId = $state<OperationItemSelectionState>({});
```

Change model derivation:

```ts
const model = $derived(plan ? buildOperationReviewModel(plan, enabledByOperationId, itemSelectionByOperationId) : null);
const selectionPayload = $derived(model ? buildSelectionPayload(model) : null);
const selectedOperationIds = $derived(selectionPayload?.operationIds ?? []);
```

Update `publishSelection` signature:

```ts
const publishSelection = (
  nextPlan: AgentOperationPlanResponseDto,
  nextEnabledByOperationId: OperationEnabledState,
  nextItemSelectionByOperationId: OperationItemSelectionState,
) => {
  if (destroyed) {
    return;
  }

  onSelectionChange?.(
    buildSelectionPayload(
      buildOperationReviewModel(nextPlan, nextEnabledByOperationId, nextItemSelectionByOperationId),
    ),
  );
};
```

When loading a plan or applying a response, reset item selections:

```ts
const nextItemSelectionByOperationId = nextPlan ? createInitialOperationItemSelectionState(nextPlan) : {};
itemSelectionByOperationId = nextItemSelectionByOperationId;
```

Update all `publishSelection` calls to pass `itemSelectionByOperationId`.

Add handlers:

```ts
const toggleItem = (operationId: string, assetId: string, selected: boolean) => {
  if (!plan || !canChangeSelection) {
    return;
  }

  const nextItemSelectionByOperationId = buildOperationItemSelectionState(
    plan,
    itemSelectionByOperationId,
    operationId,
    assetId,
    selected,
  );
  itemSelectionByOperationId = nextItemSelectionByOperationId;
  publishSelection(plan, enabledByOperationId, nextItemSelectionByOperationId);
};

const resetItemSelection = (operationId: string) => {
  if (!plan || !canChangeSelection) {
    return;
  }

  const nextItemSelectionByOperationId = resetOperationItemSelection(itemSelectionByOperationId, operationId);
  itemSelectionByOperationId = nextItemSelectionByOperationId;
  publishSelection(plan, enabledByOperationId, nextItemSelectionByOperationId);
};
```

Pass to `AgentPlanEvidenceLedger`:

```svelte
onToggleItem={toggleItem}
onResetItemSelection={resetItemSelection}
```

- [ ] **Step 4: Send the extended apply request body**

In `applySelectedOperations`, replace:

```ts
agentOperationPlanApplyRequestDto: { operationIds: selectedOperationIds },
```

with:

```ts
agentOperationPlanApplyRequestDto: {
  operationIds: selectionPayload.operationIds,
  ...(selectionPayload.itemSelections ? { itemSelections: selectionPayload.itemSelections } : {}),
  planRevision: selectionPayload.planRevision,
},
```

Guard before applying:

```ts
if (!model || !canApply || !selectionPayload) {
  return;
}
```

- [ ] **Step 5: Run panel tests and verify GREEN**

Run:

```bash
pnpm --dir web test --run "src/routes/(user)/assistant/agent-operation-plan-review-panel.spec.ts"
```

Expected: PASS after existing expectations include `planRevision: 1`.

- [ ] **Step 6: Commit**

```bash
git add web/src/routes/\(user\)/assistant/agent-operation-plan-review-panel.svelte web/src/routes/\(user\)/assistant/agent-operation-plan-review-panel.spec.ts
git commit -m "feat: submit sparse pi plan selections"
```

---

### Task 8: Regenerate OpenAPI And TypeScript SDK

**Files:**

- Modify: `open-api/immich-openapi-specs.json`
- Modify: `open-api/typescript-sdk/src/fetch-client.ts`
- Modify: `open-api/typescript-sdk/build/fetch-client.d.ts`

- [ ] **Step 1: Regenerate the TypeScript SDK from the server DTO**

Run:

```bash
make open-api-typescript
```

Expected: PASS and generated files change because `AgentOperationPlanApplyRequestDto` now includes `itemSelections` and `planRevision`.

- [ ] **Step 2: Verify the generated SDK exposes the extended apply request**

Run:

```bash
rg -n "itemSelections|planRevision|AgentOperationPlanApplyRequestDto" open-api/immich-openapi-specs.json open-api/typescript-sdk/src/fetch-client.ts open-api/typescript-sdk/build/fetch-client.d.ts
```

Expected output includes:

```ts
export type AgentOperationPlanApplyRequestDto = {
  itemSelections?: { [key: string]: AgentOperationItemSelection };
  operationIds: string[];
  planRevision?: number;
};
```

The exact generated helper type name may differ, but the request DTO must expose optional `itemSelections` and optional numeric `planRevision`.

- [ ] **Step 3: Run SDK-aware web type checks**

Run:

```bash
pnpm --dir web check:typescript
```

Expected: PASS. This proves the frontend `applyApprovedOperations` call can use the regenerated `@immich/sdk` type.

- [ ] **Step 4: Commit**

```bash
git add open-api/immich-openapi-specs.json open-api/typescript-sdk/src/fetch-client.ts open-api/typescript-sdk/build/fetch-client.d.ts
git commit -m "chore: update pi plan apply sdk"
```

---

### Task 9: Add CI-Run E2E Coverage For Excluding A Photo

**Files:**

- Modify: `e2e/src/specs/web/assistant-album-organizer.e2e-spec.ts`

- [ ] **Step 1: Write the failing E2E assertion**

In `e2e/src/specs/web/assistant-album-organizer.e2e-spec.ts`, in the first visual plan review test, add this immediately after `expect(proposedAddOperation?.id).toEqual(expect.any(String));`:

```ts
const excludedAssetId = proposedAddOperation!.assetIds[1];
expect(excludedAssetId).toEqual(expect.any(String));
```

After the existing details expansion:

```ts
await expect(page.getByText(proposedAddOperation!.id)).toBeVisible();
```

add:

```ts
await portugalDestination.getByRole('checkbox', { name: 'Include photo 2' }).uncheck();
await expect(page.getByText('1 of 2 photos selected')).toBeVisible();
```

Replace the existing `applyResponsePromise` block with request and response waits:

```ts
const applyRequestPromise = page.waitForRequest(
  (request) =>
    request.method() === 'POST' &&
    request.url().includes(`/api/agent/sessions/${session.id}/operation-plan/`) &&
    request.url().endsWith('/apply'),
);

const applyResponsePromise = page.waitForResponse(
  (response) =>
    response.url().includes(`/api/agent/sessions/${session.id}/operation-plan/`) &&
    response.url().endsWith('/apply') &&
    response.status() === 201,
);

await page.getByRole('button', { name: /Apply .* selected/ }).click();
const applyRequest = await applyRequestPromise;
expect(applyRequest.postDataJSON()).toMatchObject({
  operationIds: expect.arrayContaining([proposedAddOperation!.id]),
  itemSelections: {
    [proposedAddOperation!.id]: {
      itemKind: 'asset',
      mode: 'allExcept',
      itemIds: [excludedAssetId],
    },
  },
  planRevision: currentPlan.revision,
});

const applyResponse = await applyResponsePromise;
const { plan: appliedPlan } = (await applyResponse.json()) as AgentOperationPlanApplyResponseDto;
```

Keep the existing cover-operation toggle in this test. The final album count should change from `2` to `1` because the second photo was excluded:

```ts
expect(album.assetCount).toBe(1);
```

- [ ] **Step 2: Run local non-browser test coverage**

Run:

```bash
pnpm --dir web test --run "src/routes/(user)/assistant/agent-operation-plan-ui.spec.ts" "src/routes/(user)/assistant/agent-plan-item-review.spec.ts" "src/routes/(user)/assistant/agent-plan-operation-row.spec.ts" "src/routes/(user)/assistant/agent-plan-destination-card.spec.ts" "src/routes/(user)/assistant/agent-plan-evidence-ledger.spec.ts" "src/routes/(user)/assistant/agent-operation-plan-review-panel.spec.ts"
pnpm --dir server test --run src/dtos/agent-operation.dto.spec.ts src/controllers/agent-operation-plan.controller.spec.ts src/services/agent-operation-plan.service.spec.ts
make open-api-typescript
pnpm --dir web check:typescript
pnpm --dir web check:svelte
```

Expected: PASS.

- [ ] **Step 3: Push and use CI for browser verification**

Run:

```bash
git add e2e/src/specs/web/assistant-album-organizer.e2e-spec.ts
git commit -m "test: cover pi plan item exclusion flow"
git push
```

Use the branch CI run as the browser source of truth for Playwright E2E. The expected CI result is a green E2E job that proves the item exclusion interaction sends sparse `itemSelections`.

---

## Full Verification

After all tasks are complete, run:

```bash
pnpm --dir web test --run "src/routes/(user)/assistant/agent-operation-plan-ui.spec.ts" "src/routes/(user)/assistant/agent-plan-item-review.spec.ts" "src/routes/(user)/assistant/agent-plan-operation-row.spec.ts" "src/routes/(user)/assistant/agent-plan-destination-card.spec.ts" "src/routes/(user)/assistant/agent-plan-evidence-ledger.spec.ts" "src/routes/(user)/assistant/agent-operation-plan-review-panel.spec.ts"
pnpm --dir server test --run src/dtos/agent-operation.dto.spec.ts src/controllers/agent-operation-plan.controller.spec.ts src/services/agent-operation-plan.service.spec.ts
make open-api-typescript
pnpm --dir web check:typescript
pnpm --dir web check:svelte
pnpm --dir web format:check
pnpm --dir server format:check
git status --short
```

Expected:

- All listed tests pass.
- TypeScript and Svelte checks pass.
- Format checks pass.
- `git status --short` shows only expected changes before each commit and is clean after the final commit.
- CI browser/E2E checks pass after push.

## Self-Review

- Spec coverage: This plan implements Slice 4 item-level selection, sparse state, expanded review, mixed operation state, apply payload extensions, and server validation. It intentionally leaves virtualized grids, filters, search, and bulk actions to Slice 6, matching the implementation-slice split in the design spec.
- TDD coverage: Every task starts with failing tests, verifies RED, implements the smallest behavior needed, verifies GREEN, and commits.
- Edge cases covered: empty and legacy apply payloads, stale plan revision, item IDs outside affected set, operation selection keys outside `operationIds`, unsupported non-asset operations, all assets excluded, `only` selections, duplicate item IDs via DTO validation, large 1,000-asset plans with sparse payloads, partial thumbnail failures, blocked dependencies, and hidden raw asset IDs.
- Type consistency: `planRevision` is numeric end-to-end to match the current `revision: number` DTO; item selections are asset-only in Slice 4; field overrides are excluded from this slice and remain unsupported by the strict DTO.
