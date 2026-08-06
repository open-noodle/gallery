# Pi Agent Visual Plan Review Slice 5 Inline Field Overrides Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users edit simple plan fields inline before applying a Pi visual plan, then submit sparse `fieldOverrides` that the server validates and applies safely.

**Architecture:** Extend the apply request with sparse field overrides keyed by operation ID, and validate those overrides server-side against each operation type before mutating albums. Add a typed view-model layer for editable fields, keep overrides sparse and local until apply, and render a compact inline editor in the operation row without exposing raw DTO details. Current Slice 5 support covers album name, album description, and cover-photo selection for current album operations; target album/space and rotation direction remain Slice 7 because those operation types and picker contracts do not exist yet.

**Tech Stack:** Svelte 5, TypeScript, Svelte Testing Library, Vitest, NestJS, Zod DTOs, existing `@immich/sdk` generated client, Playwright E2E through CI, Tailwind utility classes, existing asset thumbnail URL helpers.

---

## Scope

Implement Slice 5 from `docs/superpowers/specs/2026-05-17-pi-agent-visual-plan-review-design.md`.

This slice covers:

- Inline editing for `album.create` fields:
  - `albumName`
  - `description`
- Inline editing for `album.updateDetails` fields:
  - `albumName`
  - `description`
- Inline cover-photo selection for `album.setCover` when the operation carries one or more candidate `assetIds`.
- Sparse apply payload extension:

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
  fieldOverrides?: Record<string, Record<string, unknown>>;
  planRevision?: number;
};
```

- Server-side validation that:
  - Override operation IDs exist in the current plan.
  - Override operation IDs are included in `operationIds`.
  - Empty override records are rejected.
  - Unsupported fields and unsupported operation types are rejected.
  - Album names trim to 1-200 characters.
  - Descriptions trim and stay within 1,000 characters; empty descriptions are allowed.
  - Cover overrides use a UUID that belongs to the selected candidate set for the cover operation.
  - Stale plan revisions are rejected before claiming the plan.
  - Existing operation selection, sparse item selection, dependency, access, and write-scope validations still run.
- View-model support for:
  - Editable field metadata on operation review items.
  - Sparse override state.
  - Field validation errors that disable apply before the server rejects.
  - Summary, destination title, and apply payload updates after edits.
  - Resetting one field from the UI, with a view-model helper that can reset all fields for one operation.
- Component and E2E coverage for editing album text fields and applying overrides.

This slice does not cover:

- Album or space target pickers. The current branch has no user-facing album/space picker contract for the plan review surface.
- Rotation direction editing. Rotation/image-edit operations are Slice 7.
- Spaces, tags, favorites, archive, trash, remove flows, and image-edit batch destinations. Those are Slice 7.
- Virtualized large item grids, filters, search, and bulk refinement. Those are Slice 6.
- Server-side draft mutation before apply. Overrides remain client-side until the user applies.

## Design Decisions

- Use `fieldOverrides` rather than mutating the stored plan draft. This keeps plan revision semantics simple: Pi owns the proposed plan, the user owns sparse local refinements at apply time.
- Keep `fieldOverrides` generic at the DTO boundary and strict in the service. This lets the OpenAPI contract support future fields while preserving server-owned validation per operation type.
- Treat an override equal to the base value as no override in the view model. The apply payload should stay sparse.
- Recompute human-readable summaries from override values so the preview reflects what will happen.
- Keep raw field keys out of visible UI labels. Labels read as `Album name`, `Description`, and `Cover photo`.
- Expand `album.setCover.assetIds` from exactly one asset to one or more candidate cover assets. Existing plans with one asset remain valid. If no cover override is supplied, apply uses the first selected candidate, preserving current behavior.
- A cover override must point to a selected candidate. If the user excludes that asset through item-level selection, the frontend reports a validation error and the server rejects the request if it is still submitted.
- Do not send field overrides for disabled or blocked operations.
- Run E2E in CI as requested for prior slices; local plan execution should rely on focused unit/component/API tests plus generated SDK checks.

## File Structure

- Modify `server/src/dtos/agent-operation.dto.ts`
  - Add `fieldOverrides` to `AgentOperationPlanApplyRequestSchema`.
  - Add a bounded non-empty field override object schema.
  - Allow `album.setCover` operations to carry one or more unique cover candidate `assetIds`.
- Modify `server/src/dtos/agent-operation.dto.spec.ts`
  - Cover accepted `fieldOverrides`, rejected empty overrides, rejected excessive override fields, multi-candidate cover operations, and duplicate cover candidates.
- Modify `server/src/controllers/agent-operation-plan.controller.spec.ts`
  - Cover controller pass-through of `fieldOverrides` with existing `itemSelections` and `planRevision`.
- Modify `server/src/services/agent-operation-plan.service.ts`
  - Validate field override operation IDs.
  - Normalize per-operation field overrides.
  - Merge text overrides into album create/update payloads.
  - Resolve cover override asset IDs after sparse item selection.
  - Apply overridden payload/asset IDs while preserving access validation.
- Modify `server/src/services/agent-operation-plan.service.spec.ts`
  - Cover apply behavior and validation edge cases.
- Modify `web/src/routes/(user)/assistant/agent-operation-plan-ui.ts`
  - Add editable field types, override state helpers, field validation, and sparse payload output.
  - Recompute summaries and destination labels from override values.
- Modify `web/src/routes/(user)/assistant/agent-operation-plan-ui.spec.ts`
  - Cover model, payload, validation, summary, and edge cases.
- Create `web/src/routes/(user)/assistant/agent-plan-inline-field-editor.svelte`
  - Render compact text, textarea, and cover-photo editors from view-model metadata.
- Create `web/src/routes/(user)/assistant/agent-plan-inline-field-editor.spec.ts`
  - Cover field editing, reset, cover selection, disabled state, invalid field messages, and thumbnail fallbacks.
- Modify `web/src/routes/(user)/assistant/agent-plan-operation-row.svelte`
  - Render inline fields above technical details and below the operation summary.
- Modify `web/src/routes/(user)/assistant/agent-plan-operation-row.spec.ts`
  - Cover row-level editor rendering and callback wiring.
- Modify `web/src/routes/(user)/assistant/agent-plan-destination-card.svelte`
  - Thread field override callbacks through operation rows.
- Modify `web/src/routes/(user)/assistant/agent-plan-destination-card.spec.ts`
  - Cover destination title/count updates after an album-name override.
- Modify `web/src/routes/(user)/assistant/agent-plan-evidence-ledger.svelte`
  - Thread field override callbacks and field validation state.
- Modify `web/src/routes/(user)/assistant/agent-plan-evidence-ledger.spec.ts`
  - Cover apply bar disabled state when an inline field is invalid.
- Modify `web/src/routes/(user)/assistant/agent-operation-plan-review-panel.svelte`
  - Hold field override state, publish updated selections, and send `fieldOverrides` in apply requests.
- Modify `web/src/routes/(user)/assistant/agent-operation-plan-review-panel.spec.ts`
  - Cover local state, published payloads, apply request bodies, reset after apply, and websocket reload behavior.
- Modify `i18n/en.json`
  - Add labels, reset text, validation messages, and cover-photo labels.
- Modify `e2e/src/specs/web/assistant-album-organizer.e2e-spec.ts`
  - Add CI-run coverage for editing album name/description before applying.
- Regenerate OpenAPI/SDK:
  - `open-api/immich-openapi-specs.json`
  - `open-api/typescript-sdk/src/fetch-client.ts`
  - `open-api/typescript-sdk/build/fetch-client.d.ts`

---

### Task 1: Extend DTOs For Field Overrides And Cover Candidates

**Files:**

- Modify: `server/src/dtos/agent-operation.dto.ts`
- Modify: `server/src/dtos/agent-operation.dto.spec.ts`
- Modify: `server/src/controllers/agent-operation-plan.controller.spec.ts`

- [ ] **Step 1: Write failing DTO tests**

In `server/src/dtos/agent-operation.dto.spec.ts`, add tests beside the existing apply request and set-cover DTO tests:

```ts
it('accepts sparse field overrides with item selections and a numeric plan revision', () => {
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
    fieldOverrides: {
      [operationId]: {
        albumName: 'Portugal highlights',
        description: '',
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
    fieldOverrides: {
      [operationId]: {
        albumName: 'Portugal highlights',
        description: '',
      },
    },
    planRevision: 3,
  });
});

it('rejects empty field override objects', () => {
  const operationId = factory.uuid();

  const result = AgentOperationPlanApplyRequestDto.schema.safeParse({
    operationIds: [operationId],
    fieldOverrides: {
      [operationId]: {},
    },
  });

  expect(result.success).toBe(false);
  expect(result.error?.issues).toEqual([expect.objectContaining({ message: 'fieldOverrides must not be empty' })]);
});

it('rejects field override objects with too many fields', () => {
  const operationId = factory.uuid();

  const result = AgentOperationPlanApplyRequestDto.schema.safeParse({
    operationIds: [operationId],
    fieldOverrides: {
      [operationId]: Object.fromEntries(Array.from({ length: 21 }, (_, index) => [`field${index}`, index])),
    },
  });

  expect(result.success).toBe(false);
  expect(result.error?.issues).toEqual([
    expect.objectContaining({ message: 'fieldOverrides may contain at most 20 fields per operation' }),
  ]);
});

it('accepts multiple set-cover candidate asset ids', () => {
  const coverAssetId = factory.uuid();
  const alternateCoverAssetId = factory.uuid();

  const result = AgentProposeAlbumOperationsDto.schema.safeParse({
    summary: 'Pick a cover.',
    operations: [
      {
        type: AgentOperationType.AlbumSetCover,
        summary: 'Set cover',
        targetKind: AgentOperationTargetKind.ExistingAlbum,
        targetId: factory.uuid(),
        assetIds: [coverAssetId, alternateCoverAssetId],
      },
    ],
  });

  expect(result.success).toBe(true);
  expect(result.data.operations[0].assetIds).toEqual([coverAssetId, alternateCoverAssetId]);
});

it('rejects duplicate set-cover candidate asset ids', () => {
  const coverAssetId = factory.uuid();

  const result = AgentProposeAlbumOperationsDto.schema.safeParse({
    summary: 'Pick a cover.',
    operations: [
      {
        type: AgentOperationType.AlbumSetCover,
        summary: 'Set cover',
        targetKind: AgentOperationTargetKind.ExistingAlbum,
        targetId: factory.uuid(),
        assetIds: [coverAssetId, coverAssetId],
      },
    ],
  });

  expect(result.success).toBe(false);
  expect(result.error?.issues).toEqual([expect.objectContaining({ message: 'assetIds must be unique' })]);
});
```

- [ ] **Step 2: Write failing controller pass-through test**

In `server/src/controllers/agent-operation-plan.controller.spec.ts`, add an apply test:

```ts
it('passes field overrides to the operation plan service', async () => {
  const dto: AgentOperationPlanApplyRequestDto = {
    operationIds: [operationId],
    itemSelections: {
      [operationId]: {
        itemKind: 'asset',
        mode: 'only',
        itemIds: [assetId],
      },
    },
    fieldOverrides: {
      [operationId]: {
        albumName: 'Edited Portugal',
      },
    },
    planRevision: 1,
  };

  service.applyApprovedOperations.mockResolvedValue({
    status: AgentOperationApplyStatus.Applied,
    plan: {
      ...plan,
      status: AgentOperationPlanStatus.Applied,
      operations: [{ ...plan.operations[0], status: AgentOperationStatus.Applied }],
    },
    appliedOperationIds: [operationId],
    skippedOperationIds: [],
    failedOperationIds: [],
    summary: 'Applied 1 operation(s), skipped 0, failed 0.',
  });

  await request(app.getHttpServer())
    .post(`/agent/sessions/${session.id}/operation-plan/${plan.id}/apply`)
    .send(dto)
    .expect(201);

  expect(service.applyApprovedOperations).toHaveBeenCalledWith(authStub.admin, session.id, plan.id, dto);
});
```

- [ ] **Step 3: Run DTO/controller tests and verify RED**

Run:

```bash
pnpm --dir server test --run src/dtos/agent-operation.dto.spec.ts src/controllers/agent-operation-plan.controller.spec.ts
```

Expected: FAIL because `fieldOverrides` is not in the apply DTO and set-cover operations still require exactly one asset ID.

- [ ] **Step 4: Implement the DTO schema change**

In `server/src/dtos/agent-operation.dto.ts`, add:

```ts
const fieldOverrideValue = z.unknown();
const AgentOperationFieldOverrideSchema = z
  .record(z.string().trim().min(1).max(80), fieldOverrideValue)
  .superRefine((override, ctx) => {
    const keyCount = Object.keys(override).length;
    if (keyCount === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'fieldOverrides must not be empty',
      });
    }

    if (keyCount > 20) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'fieldOverrides may contain at most 20 fields per operation',
      });
    }
  })
  .meta({ id: 'AgentOperationFieldOverride' });

const uniqueCoverAssetIds = z
  .array(uuid)
  .min(1)
  .max(500)
  .superRefine((assetIds, ctx) => {
    if (new Set(assetIds).size !== assetIds.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'assetIds must be unique',
      });
    }
  });
```

Update `setCoverOperationSchema`:

```ts
assetIds: uniqueCoverAssetIds,
```

Update `AgentOperationPlanApplyRequestSchema`:

```ts
fieldOverrides: z.record(uuid, AgentOperationFieldOverrideSchema).optional(),
```

- [ ] **Step 5: Run DTO/controller tests and verify GREEN**

Run:

```bash
pnpm --dir server test --run src/dtos/agent-operation.dto.spec.ts src/controllers/agent-operation-plan.controller.spec.ts
```

Expected: PASS.

- [ ] **Step 6: Commit DTO contract**

```bash
git add server/src/dtos/agent-operation.dto.ts server/src/dtos/agent-operation.dto.spec.ts server/src/controllers/agent-operation-plan.controller.spec.ts
git commit -m "feat: add pi plan field override dto"
```

---

### Task 2: Validate And Apply Field Overrides Server-Side

**Files:**

- Modify: `server/src/services/agent-operation-plan.service.ts`
- Modify: `server/src/services/agent-operation-plan.service.spec.ts`

- [ ] **Step 1: Write failing service tests for album text overrides**

In `server/src/services/agent-operation-plan.service.spec.ts`, add tests near the existing apply tests:

```ts
it('applies album create field overrides instead of the stored plan payload', async () => {
  const createOperation = makeOperation({
    type: AgentOperationType.AlbumCreate,
    targetKind: AgentOperationTargetKind.NewAlbum,
    temporaryTargetId: 'album-portugal',
    payload: { albumName: 'Portugal Trip', description: 'Original description' },
  });
  const plan = makePlan({ sessionId: session.id, operations: [createOperation] });
  mockCurrentPlan(plan);
  albumService.create.mockResolvedValue({ id: albumId } as never);

  await sut.applyApprovedOperations(auth, session.id, plan.id, {
    operationIds: [createOperation.id],
    fieldOverrides: {
      [createOperation.id]: {
        albumName: 'Edited Portugal',
        description: '',
      },
    },
    planRevision: plan.revision,
  });

  expect(albumService.create).toHaveBeenCalledWith(auth, {
    albumName: 'Edited Portugal',
    description: '',
    assetIds: [],
  });
});

it('applies album update-details field overrides while preserving stored fields not overridden', async () => {
  const updateOperation = makeOperation({
    type: AgentOperationType.AlbumUpdateDetails,
    targetKind: AgentOperationTargetKind.ExistingAlbum,
    targetId: albumId,
    payload: { albumName: 'Portugal Trip', description: 'Original description' },
  });
  const plan = makePlan({ sessionId: session.id, operations: [updateOperation] });
  mockCurrentPlan(plan);
  albumService.update.mockResolvedValue({ id: albumId } as never);

  await sut.applyApprovedOperations(auth, session.id, plan.id, {
    operationIds: [updateOperation.id],
    fieldOverrides: {
      [updateOperation.id]: {
        albumName: 'Edited Portugal',
      },
    },
    planRevision: plan.revision,
  });

  expect(albumService.update).toHaveBeenCalledWith(auth, albumId, {
    albumName: 'Edited Portugal',
    description: 'Original description',
  });
});
```

- [ ] **Step 2: Write failing service tests for cover overrides**

Add:

```ts
it('applies a set-cover override from selected cover candidates', async () => {
  const preferredCoverAssetId = factory.uuid();
  const alternateCoverAssetId = factory.uuid();
  const coverOperation = makeOperation({
    type: AgentOperationType.AlbumSetCover,
    targetKind: AgentOperationTargetKind.ExistingAlbum,
    targetId: albumId,
    assetIds: [preferredCoverAssetId, alternateCoverAssetId],
    payload: {},
  });
  const plan = makePlan({ sessionId: session.id, operations: [coverOperation] });
  mockCurrentPlan(plan);
  assetRepository.getAgentReadableIds.mockResolvedValue(new Set([alternateCoverAssetId]));
  albumService.update.mockResolvedValue({ id: albumId } as never);

  await sut.applyApprovedOperations(auth, session.id, plan.id, {
    operationIds: [coverOperation.id],
    fieldOverrides: {
      [coverOperation.id]: {
        albumThumbnailAssetId: alternateCoverAssetId,
      },
    },
    planRevision: plan.revision,
  });

  expect(albumService.update).toHaveBeenCalledWith(auth, albumId, {
    albumThumbnailAssetId: alternateCoverAssetId,
  });
});

it('rejects a set-cover override for an asset outside the selected candidate set', async () => {
  const preferredCoverAssetId = factory.uuid();
  const alternateCoverAssetId = factory.uuid();
  const coverOperation = makeOperation({
    type: AgentOperationType.AlbumSetCover,
    targetKind: AgentOperationTargetKind.ExistingAlbum,
    targetId: albumId,
    assetIds: [preferredCoverAssetId, alternateCoverAssetId],
    payload: {},
  });
  const plan = makePlan({ sessionId: session.id, operations: [coverOperation] });
  mockCurrentPlan(plan);

  await expect(
    sut.applyApprovedOperations(auth, session.id, plan.id, {
      operationIds: [coverOperation.id],
      itemSelections: {
        [coverOperation.id]: {
          itemKind: 'asset',
          mode: 'only',
          itemIds: [preferredCoverAssetId],
        },
      },
      fieldOverrides: {
        [coverOperation.id]: {
          albumThumbnailAssetId: alternateCoverAssetId,
        },
      },
      planRevision: plan.revision,
    }),
  ).rejects.toThrow('Cover photo override must be one of the selected cover candidates');

  expect(planRepository.claimCurrentForApply).not.toHaveBeenCalled();
  expect(albumService.update).not.toHaveBeenCalled();
});
```

- [ ] **Step 3: Write failing service validation edge-case tests**

Add:

```ts
it('rejects field overrides for operations that are not selected', async () => {
  const createOperation = makeOperation({
    type: AgentOperationType.AlbumCreate,
    targetKind: AgentOperationTargetKind.NewAlbum,
    temporaryTargetId: 'album-portugal',
    payload: { albumName: 'Portugal Trip', description: '' },
  });
  const updateOperation = makeOperation({
    type: AgentOperationType.AlbumUpdateDetails,
    targetKind: AgentOperationTargetKind.ExistingAlbum,
    targetId: albumId,
    payload: { albumName: 'Edited' },
  });
  const plan = makePlan({ sessionId: session.id, operations: [createOperation, updateOperation] });
  mockCurrentPlan(plan);

  await expect(
    sut.applyApprovedOperations(auth, session.id, plan.id, {
      operationIds: [createOperation.id],
      fieldOverrides: {
        [updateOperation.id]: {
          albumName: 'Should not apply',
        },
      },
      planRevision: plan.revision,
    }),
  ).rejects.toThrow('One or more field override operation ids are not selected');
});

it('rejects unknown field override operation ids', async () => {
  const createOperation = makeOperation({
    type: AgentOperationType.AlbumCreate,
    targetKind: AgentOperationTargetKind.NewAlbum,
    temporaryTargetId: 'album-portugal',
    payload: { albumName: 'Portugal Trip', description: '' },
  });
  const plan = makePlan({ sessionId: session.id, operations: [createOperation] });
  mockCurrentPlan(plan);

  await expect(
    sut.applyApprovedOperations(auth, session.id, plan.id, {
      operationIds: [createOperation.id],
      fieldOverrides: {
        [factory.uuid()]: {
          albumName: 'Unknown',
        },
      },
      planRevision: plan.revision,
    }),
  ).rejects.toThrow('One or more field override operation ids are not in the current plan');
});

it('rejects unsupported field override names and operation types', async () => {
  const addOperation = makeOperation({
    type: AgentOperationType.AlbumAddAssets,
    targetKind: AgentOperationTargetKind.ExistingAlbum,
    targetId: albumId,
    assetIds: [assetId],
    payload: {},
  });
  const plan = makePlan({ sessionId: session.id, operations: [addOperation] });
  mockCurrentPlan(plan);

  await expect(
    sut.applyApprovedOperations(auth, session.id, plan.id, {
      operationIds: [addOperation.id],
      fieldOverrides: {
        [addOperation.id]: {
          albumName: 'Unsupported',
        },
      },
      planRevision: plan.revision,
    }),
  ).rejects.toThrow('Field overrides are not supported for one or more operations');
});

it('rejects invalid album field override values before claiming the plan', async () => {
  const createOperation = makeOperation({
    type: AgentOperationType.AlbumCreate,
    targetKind: AgentOperationTargetKind.NewAlbum,
    temporaryTargetId: 'album-portugal',
    payload: { albumName: 'Portugal Trip', description: '' },
  });
  const plan = makePlan({ sessionId: session.id, operations: [createOperation] });
  mockCurrentPlan(plan);

  await expect(
    sut.applyApprovedOperations(auth, session.id, plan.id, {
      operationIds: [createOperation.id],
      fieldOverrides: {
        [createOperation.id]: {
          albumName: '   ',
        },
      },
      planRevision: plan.revision,
    }),
  ).rejects.toThrow('Album name override must be between 1 and 200 characters');

  expect(planRepository.claimCurrentForApply).not.toHaveBeenCalled();
});
```

- [ ] **Step 4: Run service tests and verify RED**

Run:

```bash
pnpm --dir server test --run src/services/agent-operation-plan.service.spec.ts
```

Expected: FAIL because `fieldOverrides` is not validated or applied.

- [ ] **Step 5: Implement service validation and normalization**

In `server/src/services/agent-operation-plan.service.ts`, extend the types:

```ts
type FieldOverride = NonNullable<AgentOperationPlanApplyRequestDto['fieldOverrides']>[string];

type NormalizedOperationOverride = {
  payload?: { albumName?: string; description?: string };
  assetIds?: string[];
};

type ApplySelection = {
  selectedOperationIds: Set<string>;
  selectedAssetIdsByOperationId: Map<string, string[]>;
  operationOverridesByOperationId: Map<string, NormalizedOperationOverride>;
};
```

After sparse item selection validation in `validateApplySelection`, add:

```ts
const operationOverridesByOperationId = new Map<string, NormalizedOperationOverride>();

for (const [operationId, fieldOverride] of Object.entries(dto.fieldOverrides ?? {})) {
  const operation = operationById.get(operationId);
  if (!operation) {
    throw new BadRequestException('One or more field override operation ids are not in the current plan');
  }

  if (!selectedOperationIds.has(operationId)) {
    throw new BadRequestException('One or more field override operation ids are not selected');
  }

  const selectedAssetIds = selectedAssetIdsByOperationId.get(operationId) ?? [...new Set(operation.assetIds)];
  operationOverridesByOperationId.set(
    operationId,
    this.resolveFieldOverride(operation, fieldOverride, selectedAssetIds),
  );
}

return { selectedOperationIds, selectedAssetIdsByOperationId, operationOverridesByOperationId };
```

Add a helper shaped like:

```ts
private resolveFieldOverride(
  operation: AgentOperationPlanWithOperations['operations'][number],
  fieldOverride: FieldOverride,
  selectedAssetIds: string[],
): NormalizedOperationOverride {
  const keys = Object.keys(fieldOverride);

  switch (operation.type) {
    case AgentOperationType.AlbumCreate:
    case AgentOperationType.AlbumUpdateDetails:
      return { payload: this.resolveAlbumPayloadFieldOverride(fieldOverride, keys) };

    case AgentOperationType.AlbumSetCover:
      return { assetIds: this.resolveCoverFieldOverride(fieldOverride, keys, selectedAssetIds) };

    default:
      throw new BadRequestException('Field overrides are not supported for one or more operations');
  }
}
```

Add validation helpers:

```ts
private resolveAlbumPayloadFieldOverride(
  fieldOverride: FieldOverride,
  keys: string[],
): { albumName?: string; description?: string } {
  const allowedKeys = new Set(['albumName', 'description']);
  if (keys.some((key) => !allowedKeys.has(key))) {
    throw new BadRequestException('One or more field overrides are not supported');
  }

  const payload: { albumName?: string; description?: string } = {};
  if ('albumName' in fieldOverride) {
    payload.albumName = this.normalizeAlbumNameOverride(fieldOverride.albumName);
  }

  if ('description' in fieldOverride) {
    payload.description = this.normalizeAlbumDescriptionOverride(fieldOverride.description);
  }

  return payload;
}

private normalizeAlbumNameOverride(value: unknown) {
  if (typeof value !== 'string') {
    throw new BadRequestException('Album name override must be a string');
  }

  const albumName = value.trim();
  if (albumName.length < 1 || albumName.length > 200) {
    throw new BadRequestException('Album name override must be between 1 and 200 characters');
  }

  return albumName;
}

private normalizeAlbumDescriptionOverride(value: unknown) {
  if (typeof value !== 'string') {
    throw new BadRequestException('Album description override must be a string');
  }

  const description = value.trim();
  if (description.length > 1000) {
    throw new BadRequestException('Album description override must be at most 1000 characters');
  }

  return description;
}

private resolveCoverFieldOverride(fieldOverride: FieldOverride, keys: string[], selectedAssetIds: string[]) {
  if (keys.length !== 1 || keys[0] !== 'albumThumbnailAssetId') {
    throw new BadRequestException('One or more field overrides are not supported');
  }

  const albumThumbnailAssetId = fieldOverride.albumThumbnailAssetId;
  if (typeof albumThumbnailAssetId !== 'string') {
    throw new BadRequestException('Cover photo override must be an asset id');
  }

  if (!selectedAssetIds.includes(albumThumbnailAssetId)) {
    throw new BadRequestException('Cover photo override must be one of the selected cover candidates');
  }

  return [albumThumbnailAssetId];
}
```

- [ ] **Step 6: Apply normalized overrides before access checks**

In `applyClaimedPlan`, read `operationOverridesByOperationId` and build `operationForApply` in this order:

```ts
const selectedAssetIds = selectedAssetIdsByOperationId.get(operation.id);
const operationOverride = operationOverridesByOperationId.get(operation.id);
const operationForApply = {
  ...operation,
  ...(selectedAssetIds === undefined ? {} : { assetIds: selectedAssetIds }),
  ...(operationOverride?.assetIds ? { assetIds: operationOverride.assetIds } : {}),
  ...(operationOverride?.payload
    ? {
        payload: {
          ...operation.payload,
          ...operationOverride.payload,
        },
      }
    : {}),
};
```

Keep the existing zero-selected-item skip check after override application:

```ts
if (operationForApply.assetIds.length === 0 && operation.assetIds.length > 0) {
  updates.push(this.skippedOperation(operation.id, 'No selected items for operation'));
  continue;
}
```

- [ ] **Step 7: Run service tests and verify GREEN**

Run:

```bash
pnpm --dir server test --run src/services/agent-operation-plan.service.spec.ts
```

Expected: PASS.

- [ ] **Step 8: Commit service validation**

```bash
git add server/src/services/agent-operation-plan.service.ts server/src/services/agent-operation-plan.service.spec.ts
git commit -m "feat: validate pi plan field overrides"
```

---

### Task 3: Add Field Override State To The Review View Model

**Files:**

- Modify: `web/src/routes/(user)/assistant/agent-operation-plan-ui.ts`
- Modify: `web/src/routes/(user)/assistant/agent-operation-plan-ui.spec.ts`

- [ ] **Step 1: Write failing view-model tests for editable fields and payloads**

In `web/src/routes/(user)/assistant/agent-operation-plan-ui.spec.ts`, add:

```ts
it('exposes editable album fields for album create operations', () => {
  const model = buildOperationReviewModel(
    plan([
      operation({
        id: createId,
        type: AgentOperationType.AlbumCreate,
        summary: 'Create Portugal album',
        targetKind: AgentOperationTargetKind.NewAlbum,
        temporaryTargetId: 'album-portugal',
        payload: { albumName: 'Portugal Trip', description: 'Original description' },
      }),
    ]),
    { [createId]: true },
    {},
    {},
  );

  expect(model.operationsById.get(createId)?.review.editableFields).toEqual([
    expect.objectContaining({
      operationId: createId,
      fieldKey: 'albumName',
      kind: 'text',
      value: 'Portugal Trip',
      labelKey: 'assistant_operation_field_album_name',
      maxLength: 200,
      valid: true,
    }),
    expect.objectContaining({
      operationId: createId,
      fieldKey: 'description',
      kind: 'textarea',
      value: 'Original description',
      labelKey: 'assistant_operation_field_description',
      maxLength: 1000,
      valid: true,
    }),
  ]);
});

it('uses album field overrides in summaries, destination titles, and sparse apply payloads', () => {
  const sourcePlan = plan([
    operation({
      id: createId,
      type: AgentOperationType.AlbumCreate,
      summary: 'Create Portugal album',
      targetKind: AgentOperationTargetKind.NewAlbum,
      temporaryTargetId: 'album-portugal',
      payload: { albumName: 'Portugal Trip', description: 'Original description' },
    }),
  ]);
  const fieldOverrides = setOperationFieldOverride({}, createId, 'albumName', 'Edited Portugal');
  const model = buildOperationReviewModel(sourcePlan, { [createId]: true }, {}, fieldOverrides);

  expect(model.groups[0].destination.name).toBe('Edited Portugal');
  expect(model.operationsById.get(createId)?.review.summary).toBe('Create album "Edited Portugal"');
  expect(buildSelectionPayload(model)).toMatchObject({
    planId,
    planRevision: 1,
    operationIds: [createId],
    fieldOverrides: {
      [createId]: {
        albumName: 'Edited Portugal',
      },
    },
  });
});

it('omits field overrides that match the stored operation payload', () => {
  const sourcePlan = plan([
    operation({
      id: createId,
      type: AgentOperationType.AlbumCreate,
      summary: 'Create Portugal album',
      targetKind: AgentOperationTargetKind.NewAlbum,
      temporaryTargetId: 'album-portugal',
      payload: { albumName: 'Portugal Trip', description: '' },
    }),
  ]);
  const model = buildOperationReviewModel(
    sourcePlan,
    { [createId]: true },
    {},
    setOperationFieldOverride({}, createId, 'albumName', 'Portugal Trip'),
  );

  expect(buildSelectionPayload(model)).not.toHaveProperty('fieldOverrides');
});

it('keeps item selections and field overrides in one sparse payload', () => {
  const sourcePlan = plan([
    operation({
      id: addId,
      type: AgentOperationType.AlbumAddAssets,
      summary: 'Add two assets',
      targetKind: AgentOperationTargetKind.NewAlbum,
      temporaryTargetId: 'album-portugal',
      assetIds: [assetA, assetB],
      payload: {},
    }),
    operation({
      id: updateId,
      type: AgentOperationType.AlbumUpdateDetails,
      summary: 'Update details',
      targetKind: AgentOperationTargetKind.ExistingAlbum,
      targetId: '00000000-0000-4000-8000-000000000301',
      payload: { albumName: 'Portugal Trip' },
    }),
  ]);
  const itemSelections = setOperationItemSelection({}, addId, {
    itemKind: 'asset',
    mode: 'allExcept',
    itemIds: [assetB],
  });
  const fieldOverrides = setOperationFieldOverride({}, updateId, 'description', 'Selected favorites');
  const model = buildOperationReviewModel(
    sourcePlan,
    { [addId]: true, [updateId]: true },
    itemSelections,
    fieldOverrides,
  );

  expect(buildSelectionPayload(model)).toMatchObject({
    itemSelections: {
      [addId]: {
        itemKind: 'asset',
        mode: 'allExcept',
        itemIds: [assetB],
      },
    },
    fieldOverrides: {
      [updateId]: {
        description: 'Selected favorites',
      },
    },
  });
});
```

- [ ] **Step 2: Write failing view-model tests for validation and cover choices**

Add:

```ts
it('marks invalid album name overrides and disables apply through model field errors', () => {
  const sourcePlan = plan([
    operation({
      id: createId,
      type: AgentOperationType.AlbumCreate,
      summary: 'Create Portugal album',
      targetKind: AgentOperationTargetKind.NewAlbum,
      temporaryTargetId: 'album-portugal',
      payload: { albumName: 'Portugal Trip', description: '' },
    }),
  ]);
  const model = buildOperationReviewModel(
    sourcePlan,
    { [createId]: true },
    {},
    setOperationFieldOverride({}, createId, 'albumName', '   '),
  );

  expect(model.fieldErrors).toEqual([
    {
      operationId: createId,
      fieldKey: 'albumName',
      messageKey: 'assistant_operation_field_album_name_invalid',
    },
  ]);
  expect(buildSelectionPayload(model).fieldOverrides).toEqual({
    [createId]: {
      albumName: '   ',
    },
  });
});

it('exposes cover-photo candidates and field override payload for set-cover operations', () => {
  const sourcePlan = plan([
    operation({
      id: coverId,
      type: AgentOperationType.AlbumSetCover,
      summary: 'Set cover',
      targetKind: AgentOperationTargetKind.ExistingAlbum,
      targetId: '00000000-0000-4000-8000-000000000301',
      assetIds: [assetA, assetB],
      payload: {},
    }),
  ]);
  const model = buildOperationReviewModel(
    sourcePlan,
    { [coverId]: true },
    {},
    setOperationFieldOverride({}, coverId, 'albumThumbnailAssetId', assetB),
  );

  expect(model.operationsById.get(coverId)?.review.editableFields).toEqual([
    expect.objectContaining({
      operationId: coverId,
      fieldKey: 'albumThumbnailAssetId',
      kind: 'coverAsset',
      value: assetB,
      candidateAssetIds: [assetA, assetB],
      labelKey: 'assistant_operation_field_cover_photo',
      valid: true,
    }),
  ]);
  expect(buildSelectionPayload(model).fieldOverrides).toEqual({
    [coverId]: {
      albumThumbnailAssetId: assetB,
    },
  });
});

it('flags a cover override when the chosen candidate is excluded by item selection', () => {
  const sourcePlan = plan([
    operation({
      id: coverId,
      type: AgentOperationType.AlbumSetCover,
      summary: 'Set cover',
      targetKind: AgentOperationTargetKind.ExistingAlbum,
      targetId: '00000000-0000-4000-8000-000000000301',
      assetIds: [assetA, assetB],
      payload: {},
    }),
  ]);
  const model = buildOperationReviewModel(
    sourcePlan,
    { [coverId]: true },
    setOperationItemSelection({}, coverId, { itemKind: 'asset', mode: 'only', itemIds: [assetA] }),
    setOperationFieldOverride({}, coverId, 'albumThumbnailAssetId', assetB),
  );

  expect(model.fieldErrors).toEqual([
    {
      operationId: coverId,
      fieldKey: 'albumThumbnailAssetId',
      messageKey: 'assistant_operation_field_cover_photo_not_selected',
    },
  ]);
});

it('does not include field overrides for disabled operations', () => {
  const sourcePlan = plan([
    operation({
      id: createId,
      type: AgentOperationType.AlbumCreate,
      summary: 'Create Portugal album',
      targetKind: AgentOperationTargetKind.NewAlbum,
      temporaryTargetId: 'album-portugal',
      payload: { albumName: 'Portugal Trip', description: '' },
    }),
  ]);
  const model = buildOperationReviewModel(
    sourcePlan,
    { [createId]: false },
    {},
    setOperationFieldOverride({}, createId, 'albumName', 'Edited Portugal'),
  );

  expect(buildSelectionPayload(model)).toEqual({
    planId,
    planRevision: 1,
    operationIds: [],
  });
});

it('resets all field overrides for one operation without touching other operations', () => {
  const state = {
    [createId]: {
      albumName: 'Edited Portugal',
      description: 'Edited description',
    },
    [updateId]: {
      description: 'Keep this override',
    },
  };

  expect(resetOperationFieldOverride(state, createId)).toEqual({
    [updateId]: {
      description: 'Keep this override',
    },
  });
});
```

- [ ] **Step 3: Run view-model tests and verify RED**

Run:

```bash
pnpm --dir web test --run "src/routes/(user)/assistant/agent-operation-plan-ui.spec.ts"
```

Expected: FAIL because editable fields, field override state, and field errors do not exist.

- [ ] **Step 4: Implement view-model types and helpers**

In `agent-operation-plan-ui.ts`, add:

```ts
export type OperationFieldOverrideState = Record<string, Record<string, unknown>>;

export type AgentReviewEditableFieldKind = 'text' | 'textarea' | 'coverAsset';

export type AgentReviewEditableField = {
  operationId: string;
  fieldKey: string;
  kind: AgentReviewEditableFieldKind;
  labelKey: Translations;
  value: string;
  originalValue: string;
  maxLength?: number;
  candidateAssetIds?: string[];
  valid: boolean;
  errorKey?: Translations;
};

export type AgentReviewFieldError = {
  operationId: string;
  fieldKey: string;
  messageKey: Translations;
};
```

Extend `AgentOperationReview`:

```ts
editableFields: AgentReviewEditableField[];
```

Extend `OperationReviewModel`:

```ts
fieldErrors: AgentReviewFieldError[];
```

Extend `AgentOperationSelectionPayload`:

```ts
fieldOverrides?: Record<string, Record<string, unknown>>;
```

Add helpers:

```ts
export const createInitialOperationFieldOverrideState = (
  _plan: AgentOperationPlanResponseDto,
): OperationFieldOverrideState => ({});

export const setOperationFieldOverride = (
  state: OperationFieldOverrideState,
  operationId: string,
  fieldKey: string,
  value: unknown,
): OperationFieldOverrideState => ({
  ...state,
  [operationId]: {
    ...(state[operationId] ?? {}),
    [fieldKey]: value,
  },
});

export const resetOperationFieldOverride = (
  state: OperationFieldOverrideState,
  operationId: string,
  fieldKey?: string,
): OperationFieldOverrideState => {
  if (!fieldKey) {
    const { [operationId]: _removed, ...remaining } = state;
    return remaining;
  }

  const nextFields = { ...(state[operationId] ?? {}) };
  delete nextFields[fieldKey];
  const { [operationId]: _removed, ...remaining } = state;

  return Object.keys(nextFields).length === 0 ? remaining : { ...remaining, [operationId]: nextFields };
};
```

- [ ] **Step 5: Implement editable field derivation and validation**

Thread `fieldOverrideByOperationId` through `buildOperationReviewModel`:

```ts
export const buildOperationReviewModel = (
  plan: AgentOperationPlanResponseDto,
  enabledByOperationId: OperationEnabledState,
  itemSelectionByOperationId: OperationItemSelectionState = {},
  fieldOverrideByOperationId: OperationFieldOverrideState = {},
): OperationReviewModel => {
```

Inside the existing `const items = plan.operations.map((operation) => { ... })` block, read the operation override once and pass it into `buildOperationReview`:

```ts
const fieldOverride = fieldOverrideByOperationId[operation.id];
const review = buildOperationReview(
  operation,
  operationById,
  enabledByOperationId,
  (dependency) => collectBlockingDependencySummaries(dependency).length > 0,
  selected,
  blocked,
  itemSelectionByOperationId[operation.id],
  fieldOverride,
);
```

After `items` is built and `groupsById` has been populated, collect field errors from the same review metadata the UI renders before the final return:

```ts
const fieldErrors = items.flatMap((item) =>
  item.review.editableFields
    .filter((field) => !field.valid && field.errorKey)
    .map((field) => ({
      operationId: item.id,
      fieldKey: field.fieldKey,
      messageKey: field.errorKey as Translations,
    })),
);

return {
  plan,
  groups: [...groupsById.values()],
  operationsById: new Map(items.map((item) => [item.id, item])),
  fieldErrors,
};
```

Add album field builders:

```ts
const getPayloadString = (payload: Record<string, unknown>, fieldKey: string) =>
  typeof payload[fieldKey] === 'string' ? payload[fieldKey] : '';

const getOverrideString = (fieldOverride: Record<string, unknown> | undefined, fieldKey: string, fallback: string) =>
  typeof fieldOverride?.[fieldKey] === 'string' ? fieldOverride[fieldKey] : fallback;

const validateAlbumNameField = (value: string): Translations | undefined => {
  const length = value.trim().length;
  return length >= 1 && length <= 200 ? undefined : ('assistant_operation_field_album_name_invalid' as Translations);
};

const validateDescriptionField = (value: string): Translations | undefined =>
  value.trim().length <= 1000 ? undefined : ('assistant_operation_field_description_invalid' as Translations);
```

Add field metadata for album create/update and cover operations:

```ts
const buildEditableFields = (
  operation: AgentOperationResponseDto,
  selection: AgentReviewSelection,
  fieldOverride?: Record<string, unknown>,
): AgentReviewEditableField[] => {
  if (operation.type === AgentOperationType.AlbumCreate || operation.type === AgentOperationType.AlbumUpdateDetails) {
    const originalAlbumName = getPayloadString(operation.payload, 'albumName');
    const originalDescription = getPayloadString(operation.payload, 'description');
    const albumName = getOverrideString(fieldOverride, 'albumName', originalAlbumName);
    const description = getOverrideString(fieldOverride, 'description', originalDescription);
    const albumNameError = validateAlbumNameField(albumName);
    const descriptionError = validateDescriptionField(description);

    return [
      {
        operationId: operation.id,
        fieldKey: 'albumName',
        kind: 'text',
        labelKey: 'assistant_operation_field_album_name' as Translations,
        value: albumName,
        originalValue: originalAlbumName,
        maxLength: 200,
        valid: albumNameError === undefined,
        ...(albumNameError ? { errorKey: albumNameError } : {}),
      },
      {
        operationId: operation.id,
        fieldKey: 'description',
        kind: 'textarea',
        labelKey: 'assistant_operation_field_description' as Translations,
        value: description,
        originalValue: originalDescription,
        maxLength: 1000,
        valid: descriptionError === undefined,
        ...(descriptionError ? { errorKey: descriptionError } : {}),
      },
    ];
  }

  if (operation.type === AgentOperationType.AlbumSetCover && operation.assetIds.length > 1) {
    const coverAssetId =
      typeof fieldOverride?.albumThumbnailAssetId === 'string'
        ? fieldOverride.albumThumbnailAssetId
        : operation.assetIds[0];
    const selectedAssetIds = new Set(getSelectedAssetIds(operation, selection));
    const errorKey = selectedAssetIds.has(coverAssetId)
      ? undefined
      : ('assistant_operation_field_cover_photo_not_selected' as Translations);

    return [
      {
        operationId: operation.id,
        fieldKey: 'albumThumbnailAssetId',
        kind: 'coverAsset',
        labelKey: 'assistant_operation_field_cover_photo' as Translations,
        value: coverAssetId,
        originalValue: operation.assetIds[0],
        candidateAssetIds: operation.assetIds,
        valid: errorKey === undefined,
        ...(errorKey ? { errorKey } : {}),
      },
    ];
  }

  return [];
};
```

- [ ] **Step 6: Implement sparse field override payload building**

Update `buildSelectionPayload` to include only selected operations and fields whose current value differs from the original:

```ts
const fieldOverrides = Object.fromEntries(
  operationIds
    .map((operationId) => model.operationsById.get(operationId))
    .filter((operation): operation is OperationReviewItem => operation !== undefined)
    .map((operation) => [
      operation.id,
      Object.fromEntries(
        operation.review.editableFields
          .filter((field) => field.value !== field.originalValue)
          .map((field) => [field.fieldKey, field.value]),
      ),
    ])
    .filter(([, fields]) => Object.keys(fields).length > 0),
);

return {
  planId: model.plan.id,
  planRevision: model.plan.revision,
  operationIds,
  ...(Object.keys(itemSelections).length > 0 ? { itemSelections } : {}),
  ...(Object.keys(fieldOverrides).length > 0 ? { fieldOverrides } : {}),
};
```

Update summary/title helpers to read effective album names from field overrides, and pass `fieldOverrideByOperationId[operation.id]` into `getGroupTitle`, `getReviewDestination`, and `getOperationReviewSummary` wherever those helpers derive album text:

```ts
const getAlbumName = (operation: AgentOperationResponseDto, fieldOverride?: Record<string, unknown>) => {
  const overriddenAlbumName = fieldOverride?.albumName;
  if (typeof overriddenAlbumName === 'string' && overriddenAlbumName.trim().length > 0) {
    return overriddenAlbumName.trim();
  }

  const albumName = operation.payload.albumName;
  return typeof albumName === 'string' && albumName.trim().length > 0 ? albumName.trim() : undefined;
};
```

- [ ] **Step 7: Run view-model tests and verify GREEN**

Run:

```bash
pnpm --dir web test --run "src/routes/(user)/assistant/agent-operation-plan-ui.spec.ts"
```

Expected: PASS.

- [ ] **Step 8: Commit view-model changes**

```bash
git add web/src/routes/'(user)'/assistant/agent-operation-plan-ui.ts web/src/routes/'(user)'/assistant/agent-operation-plan-ui.spec.ts
git commit -m "feat: add pi plan field override model"
```

---

### Task 4: Render Inline Field Editors

**Files:**

- Create: `web/src/routes/(user)/assistant/agent-plan-inline-field-editor.svelte`
- Create: `web/src/routes/(user)/assistant/agent-plan-inline-field-editor.spec.ts`
- Modify: `web/src/routes/(user)/assistant/agent-plan-operation-row.svelte`
- Modify: `web/src/routes/(user)/assistant/agent-plan-operation-row.spec.ts`
- Modify: `i18n/en.json`

- [ ] **Step 1: Write failing inline editor component tests**

Create `web/src/routes/(user)/assistant/agent-plan-inline-field-editor.spec.ts`:

```ts
import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { init, register } from 'svelte-i18n';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AgentPlanInlineFieldEditor from './agent-plan-inline-field-editor.svelte';
import type { AgentReviewEditableField } from './agent-operation-plan-ui';

vi.mock('$lib/utils', () => ({
  getAssetMediaUrl: ({ id, size }: { id: string; size: string }) => `/api/assets/${id}/thumbnail?size=${size}`,
}));

const translations = {
  en: {
    assistant_operation_field_album_name: 'Album name',
    assistant_operation_field_description: 'Description',
    assistant_operation_field_cover_photo: 'Cover photo',
    assistant_operation_field_reset: 'Reset',
    assistant_operation_field_album_name_invalid: 'Enter an album name.',
    assistant_operation_field_description_invalid: 'Description is too long.',
    assistant_operation_field_cover_photo_not_selected: 'Choose a selected photo.',
    assistant_operation_field_cover_photo_alt: 'Cover option {index} of {count}',
    assistant_operation_field_cover_photo_unavailable: 'Preview unavailable',
  },
};

register('en', () => Promise.resolve(translations.en));

beforeEach(async () => {
  await init({ fallbackLocale: 'en', initialLocale: 'en' });
});

const textField = (overrides: Partial<AgentReviewEditableField> = {}): AgentReviewEditableField => ({
  operationId: 'operation-1',
  fieldKey: 'albumName',
  kind: 'text',
  labelKey: 'assistant_operation_field_album_name',
  value: 'Portugal Trip',
  originalValue: 'Portugal Trip',
  maxLength: 200,
  valid: true,
  ...overrides,
});

describe('AgentPlanInlineFieldEditor', () => {
  it('renders text fields and dispatches value changes', async () => {
    const onSetFieldOverride = vi.fn();
    render(AgentPlanInlineFieldEditor, {
      fields: [textField()],
      canChangeSelection: true,
      onSetFieldOverride,
      onResetFieldOverride: vi.fn(),
    });

    const input = screen.getByLabelText('Album name');
    await fireEvent.input(input, { target: { value: 'Edited Portugal' } });

    expect(onSetFieldOverride).toHaveBeenCalledWith('operation-1', 'albumName', 'Edited Portugal');
  });

  it('renders validation messages and reset for changed fields', async () => {
    const onResetFieldOverride = vi.fn();
    render(AgentPlanInlineFieldEditor, {
      fields: [
        textField({
          value: '   ',
          originalValue: 'Portugal Trip',
          valid: false,
          errorKey: 'assistant_operation_field_album_name_invalid',
        }),
      ],
      canChangeSelection: true,
      onSetFieldOverride: vi.fn(),
      onResetFieldOverride,
    });

    expect(screen.getByText('Enter an album name.')).toBeInTheDocument();
    await fireEvent.click(screen.getByRole('button', { name: 'Reset Album name' }));
    expect(onResetFieldOverride).toHaveBeenCalledWith('operation-1', 'albumName');
  });

  it('renders cover choices as bounded thumbnail buttons', async () => {
    const onSetFieldOverride = vi.fn();
    render(AgentPlanInlineFieldEditor, {
      fields: [
        textField({
          fieldKey: 'albumThumbnailAssetId',
          kind: 'coverAsset',
          labelKey: 'assistant_operation_field_cover_photo',
          value: 'asset-b',
          originalValue: 'asset-a',
          candidateAssetIds: ['asset-a', 'asset-b'],
        }),
      ],
      canChangeSelection: true,
      onSetFieldOverride,
      onResetFieldOverride: vi.fn(),
    });

    const group = screen.getByRole('group', { name: 'Cover photo' });
    const buttons = within(group).getAllByRole('button');
    expect(buttons).toHaveLength(2);
    expect(buttons[0]).toHaveAttribute('aria-pressed', 'false');
    expect(buttons[1]).toHaveAttribute('aria-pressed', 'true');
    await fireEvent.click(within(group).getByRole('button', { name: 'Cover option 1 of 2' }));

    expect(onSetFieldOverride).toHaveBeenCalledWith('operation-1', 'albumThumbnailAssetId', 'asset-a');
  });

  it('disables inputs and cover buttons when selection cannot change', () => {
    render(AgentPlanInlineFieldEditor, {
      fields: [textField()],
      canChangeSelection: false,
      onSetFieldOverride: vi.fn(),
      onResetFieldOverride: vi.fn(),
    });

    expect(screen.getByLabelText('Album name')).toBeDisabled();
  });
});
```

- [ ] **Step 2: Write failing row integration test**

In `web/src/routes/(user)/assistant/agent-plan-operation-row.spec.ts`, add:

```ts
it('renders inline field editors and forwards override callbacks', async () => {
  const onSetFieldOverride = vi.fn();
  const onResetFieldOverride = vi.fn();
  const item = makeReviewItem({
    review: {
      ...makeReviewItem().review,
      editableFields: [
        {
          operationId: createId,
          fieldKey: 'albumName',
          kind: 'text',
          labelKey: 'assistant_operation_field_album_name',
          value: 'Portugal Trip',
          originalValue: 'Portugal Trip',
          maxLength: 200,
          valid: true,
        },
      ],
    },
  });

  render(AgentPlanOperationRow, {
    item,
    canChangeSelection: true,
    onToggleOperation: vi.fn(),
    onToggleItem: vi.fn(),
    onResetItemSelection: vi.fn(),
    onSetFieldOverride,
    onResetFieldOverride,
  });

  await fireEvent.input(screen.getByLabelText('Album name'), { target: { value: 'Edited Portugal' } });

  expect(onSetFieldOverride).toHaveBeenCalledWith(createId, 'albumName', 'Edited Portugal');
});
```

- [ ] **Step 3: Run component tests and verify RED**

Run:

```bash
pnpm --dir web test --run "src/routes/(user)/assistant/agent-plan-inline-field-editor.spec.ts" "src/routes/(user)/assistant/agent-plan-operation-row.spec.ts"
```

Expected: FAIL because the editor component and row props do not exist.

- [ ] **Step 4: Implement `AgentPlanInlineFieldEditor`**

Create `agent-plan-inline-field-editor.svelte`:

```svelte
<script lang="ts">
  import { getAssetMediaUrl } from '$lib/utils';
  import { AssetMediaSize } from '@immich/sdk';
  import { t } from 'svelte-i18n';
  import type { AgentReviewEditableField } from './agent-operation-plan-ui';

  interface Props {
    fields: AgentReviewEditableField[];
    canChangeSelection: boolean;
    onSetFieldOverride: (operationId: string, fieldKey: string, value: unknown) => void;
    onResetFieldOverride: (operationId: string, fieldKey: string) => void;
  }

  let { fields, canChangeSelection, onSetFieldOverride, onResetFieldOverride }: Props = $props();
  let failedAssetIds = $state(new Set<string>());

  const markFailed = (assetId: string) => {
    if (!failedAssetIds.has(assetId)) {
      failedAssetIds = new Set([...failedAssetIds, assetId]);
    }
  };
</script>

{#if fields.length > 0}
  <div class="mt-3 grid gap-3">
    {#each fields as field (`${field.operationId}:${field.fieldKey}`)}
      <div class="grid gap-1.5">
        {#if field.kind === 'text'}
          <label class="text-sm font-medium text-gray-700 dark:text-gray-200">
            {$t(field.labelKey)}
            <input
              class="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-black shadow-sm outline-none focus:border-immich-primary disabled:cursor-not-allowed disabled:opacity-60 dark:border-gray-700 dark:bg-gray-900 dark:text-white"
              aria-invalid={!field.valid}
              value={field.value}
              maxlength={field.maxLength}
              disabled={!canChangeSelection}
              oninput={(event) => onSetFieldOverride(field.operationId, field.fieldKey, event.currentTarget.value)}
            />
          </label>
        {:else if field.kind === 'textarea'}
          <label class="text-sm font-medium text-gray-700 dark:text-gray-200">
            {$t(field.labelKey)}
            <textarea
              class="mt-1 min-h-20 w-full resize-y rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-black shadow-sm outline-none focus:border-immich-primary disabled:cursor-not-allowed disabled:opacity-60 dark:border-gray-700 dark:bg-gray-900 dark:text-white"
              aria-invalid={!field.valid}
              maxlength={field.maxLength}
              disabled={!canChangeSelection}
              oninput={(event) => onSetFieldOverride(field.operationId, field.fieldKey, event.currentTarget.value)}
            >{field.value}</textarea>
          </label>
        {:else if field.kind === 'coverAsset'}
          <div role="group" aria-label={$t(field.labelKey)} class="grid gap-2">
            <span class="text-sm font-medium text-gray-700 dark:text-gray-200">{$t(field.labelKey)}</span>
            <div class="flex flex-wrap gap-2">
              {#each field.candidateAssetIds ?? [] as assetId, index (assetId)}
                <button
                  type="button"
                  class="relative size-14 overflow-hidden rounded-md border bg-gray-100 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-gray-800"
                  class:border-immich-primary={field.value === assetId}
                  class:border-gray-200={field.value !== assetId}
                  class:dark:border-immich-dark-primary={field.value === assetId}
                  class:dark:border-gray-700={field.value !== assetId}
                  aria-label={$t('assistant_operation_field_cover_photo_alt', {
                    values: { index: index + 1, count: field.candidateAssetIds?.length ?? 0 },
                  })}
                  aria-pressed={field.value === assetId}
                  disabled={!canChangeSelection}
                  onclick={() => onSetFieldOverride(field.operationId, field.fieldKey, assetId)}
                >
                  <img
                    class="size-full object-cover"
                    src={getAssetMediaUrl({ id: assetId, size: AssetMediaSize.Thumbnail })}
                    alt=""
                    loading="lazy"
                    draggable="false"
                    onerror={() => markFailed(assetId)}
                  />
                  {#if failedAssetIds.has(assetId)}
                    <span
                      class="absolute inset-0 flex items-center justify-center bg-gray-200 px-1 text-center text-[10px] leading-tight text-gray-600 dark:bg-gray-800 dark:text-gray-300"
                    >
                      {$t('assistant_operation_field_cover_photo_unavailable')}
                    </span>
                  {/if}
                </button>
              {/each}
            </div>
          </div>
        {/if}

        <div class="flex flex-wrap items-center gap-2 text-xs">
          {#if !field.valid && field.errorKey}
            <span class="text-red-700 dark:text-red-300">{$t(field.errorKey)}</span>
          {/if}
          {#if field.value !== field.originalValue}
            <button
              type="button"
              class="font-medium text-immich-primary hover:underline disabled:cursor-not-allowed disabled:opacity-60 dark:text-immich-dark-primary"
              disabled={!canChangeSelection}
              aria-label={`${$t('assistant_operation_field_reset')} ${$t(field.labelKey)}`}
              onclick={() => onResetFieldOverride(field.operationId, field.fieldKey)}
            >
              {$t('assistant_operation_field_reset')}
            </button>
          {/if}
        </div>
      </div>
    {/each}
  </div>
{/if}
```

- [ ] **Step 5: Render the editor from operation rows**

In `agent-plan-operation-row.svelte`, import the editor and extend props:

```ts
import AgentPlanInlineFieldEditor from './agent-plan-inline-field-editor.svelte';

onSetFieldOverride: (operationId: string, fieldKey: string, value: unknown) => void;
onResetFieldOverride: (operationId: string, fieldKey: string) => void;
```

Render above `<details>`:

```svelte
<AgentPlanInlineFieldEditor
  fields={item.review.editableFields}
  {canChangeSelection}
  {onSetFieldOverride}
  {onResetFieldOverride}
/>
```

- [ ] **Step 6: Add i18n labels**

In `i18n/en.json`, add:

```json
"assistant_operation_field_album_name": "Album name",
"assistant_operation_field_description": "Description",
"assistant_operation_field_cover_photo": "Cover photo",
"assistant_operation_field_reset": "Reset",
"assistant_operation_field_album_name_invalid": "Enter an album name.",
"assistant_operation_field_description_invalid": "Description is too long.",
"assistant_operation_field_cover_photo_not_selected": "Choose a selected photo.",
"assistant_operation_field_cover_photo_alt": "Cover option {index, number} of {count, number}",
"assistant_operation_field_cover_photo_unavailable": "Preview unavailable"
```

- [ ] **Step 7: Run component tests and verify GREEN**

Run:

```bash
pnpm --dir web test --run "src/routes/(user)/assistant/agent-plan-inline-field-editor.spec.ts" "src/routes/(user)/assistant/agent-plan-operation-row.spec.ts"
```

Expected: PASS.

- [ ] **Step 8: Commit inline editor**

```bash
git add web/src/routes/'(user)'/assistant/agent-plan-inline-field-editor.svelte web/src/routes/'(user)'/assistant/agent-plan-inline-field-editor.spec.ts web/src/routes/'(user)'/assistant/agent-plan-operation-row.svelte web/src/routes/'(user)'/assistant/agent-plan-operation-row.spec.ts i18n/en.json
git commit -m "feat: render pi plan field editors"
```

---

### Task 5: Wire Field Overrides Through The Plan Review Panel

**Files:**

- Modify: `web/src/routes/(user)/assistant/agent-plan-destination-card.svelte`
- Modify: `web/src/routes/(user)/assistant/agent-plan-destination-card.spec.ts`
- Modify: `web/src/routes/(user)/assistant/agent-plan-evidence-ledger.svelte`
- Modify: `web/src/routes/(user)/assistant/agent-plan-evidence-ledger.spec.ts`
- Modify: `web/src/routes/(user)/assistant/agent-operation-plan-review-panel.svelte`
- Modify: `web/src/routes/(user)/assistant/agent-operation-plan-review-panel.spec.ts`

- [ ] **Step 1: Write failing panel tests for published payload and apply request**

In `web/src/routes/(user)/assistant/agent-operation-plan-review-panel.spec.ts`, add:

```ts
it('publishes field overrides as the user edits inline fields', async () => {
  const onSelectionChange = vi.fn();
  getCurrentOperationPlanMock.mockResolvedValue(
    makePlan({
      operations: [
        makeOperation({
          id: createId,
          type: AgentOperationType.AlbumCreate,
          summary: 'Create Portugal album',
          targetKind: AgentOperationTargetKind.NewAlbum,
          temporaryTargetId: 'album-portugal',
          payload: { albumName: 'Portugal Trip', description: '' },
        }),
      ],
    }),
  );

  render(AgentOperationPlanReviewPanel, { session, onSelectionChange });
  await screen.findByLabelText('Album name');
  await fireEvent.input(screen.getByLabelText('Album name'), { target: { value: 'Edited Portugal' } });

  expect(onSelectionChange).toHaveBeenLastCalledWith(
    expect.objectContaining({
      operationIds: [createId],
      fieldOverrides: {
        [createId]: {
          albumName: 'Edited Portugal',
        },
      },
    }),
  );
});

it('sends field overrides when applying selected operations', async () => {
  const plan = makePlan({
    operations: [
      makeOperation({
        id: createId,
        type: AgentOperationType.AlbumCreate,
        summary: 'Create Portugal album',
        targetKind: AgentOperationTargetKind.NewAlbum,
        temporaryTargetId: 'album-portugal',
        payload: { albumName: 'Portugal Trip', description: '' },
      }),
    ],
  });
  getCurrentOperationPlanMock.mockResolvedValue(plan);
  applyApprovedOperationsMock.mockResolvedValue({
    status: AgentOperationApplyStatus.Applied,
    plan: { ...plan, status: AgentOperationPlanStatus.Applied },
    appliedOperationIds: [createId],
    skippedOperationIds: [],
    failedOperationIds: [],
    summary: 'Applied 1 operation(s), skipped 0, failed 0.',
  });

  render(AgentOperationPlanReviewPanel, { session });
  await screen.findByLabelText('Album name');
  await fireEvent.input(screen.getByLabelText('Album name'), { target: { value: 'Edited Portugal' } });
  await fireEvent.click(screen.getByRole('button', { name: 'Apply 1 selected' }));

  expect(applyApprovedOperationsMock).toHaveBeenCalledWith({
    id: session.id,
    planId: plan.id,
    agentOperationPlanApplyRequestDto: {
      operationIds: [createId],
      fieldOverrides: {
        [createId]: {
          albumName: 'Edited Portugal',
        },
      },
      planRevision: plan.revision,
    },
  });
});

it('disables apply while an inline field override is invalid', async () => {
  getCurrentOperationPlanMock.mockResolvedValue(
    makePlan({
      operations: [
        makeOperation({
          id: createId,
          type: AgentOperationType.AlbumCreate,
          summary: 'Create Portugal album',
          targetKind: AgentOperationTargetKind.NewAlbum,
          temporaryTargetId: 'album-portugal',
          payload: { albumName: 'Portugal Trip', description: '' },
        }),
      ],
    }),
  );

  render(AgentOperationPlanReviewPanel, { session });
  await screen.findByLabelText('Album name');
  await fireEvent.input(screen.getByLabelText('Album name'), { target: { value: '   ' } });

  expect(screen.getByText('Enter an album name.')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Apply 1 selected' })).toBeDisabled();
});
```

- [ ] **Step 2: Write failing card/ledger tests for callback threading and updated titles**

In `agent-plan-destination-card.spec.ts`, add:

```ts
it('updates destination title from effective album-name overrides', () => {
  const model = buildOperationReviewModel(
    makePlan({
      operations: [
        makeOperation({
          id: createId,
          type: AgentOperationType.AlbumCreate,
          targetKind: AgentOperationTargetKind.NewAlbum,
          temporaryTargetId: 'album-portugal',
          payload: { albumName: 'Portugal Trip', description: '' },
        }),
      ],
    }),
    { [createId]: true },
    {},
    { [createId]: { albumName: 'Edited Portugal' } },
  );

  render(AgentPlanDestinationCard, {
    group: model.groups[0],
    canChangeSelection: true,
    onToggleGroup: vi.fn(),
    onToggleOperation: vi.fn(),
    onToggleItem: vi.fn(),
    onResetItemSelection: vi.fn(),
    onSetFieldOverride: vi.fn(),
    onResetFieldOverride: vi.fn(),
  });

  expect(screen.getByRole('region', { name: 'Edited Portugal' })).toBeInTheDocument();
});
```

In `agent-plan-evidence-ledger.spec.ts`, add:

```ts
it('disables the apply bar when inline field validation fails', () => {
  const model = buildOperationReviewModel(
    makePlan({
      operations: [
        makeOperation({
          id: createId,
          type: AgentOperationType.AlbumCreate,
          targetKind: AgentOperationTargetKind.NewAlbum,
          temporaryTargetId: 'album-portugal',
          payload: { albumName: 'Portugal Trip', description: '' },
        }),
      ],
    }),
    { [createId]: true },
    {},
    { [createId]: { albumName: '   ' } },
  );

  render(AgentPlanEvidenceLedger, {
    model,
    selectedOperationIds: [createId],
    canChangeSelection: true,
    canApply: false,
    applying: false,
    showHeader: true,
    errorMessage: null,
    applyErrorMessage: null,
    applyMessage: null,
    onToggleGroup: vi.fn(),
    onToggleOperation: vi.fn(),
    onToggleItem: vi.fn(),
    onResetItemSelection: vi.fn(),
    onSetFieldOverride: vi.fn(),
    onResetFieldOverride: vi.fn(),
    onApply: vi.fn(),
  });

  expect(screen.getByRole('button', { name: 'Apply 1 selected' })).toBeDisabled();
});
```

- [ ] **Step 3: Run panel/card/ledger tests and verify RED**

Run:

```bash
pnpm --dir web test --run "src/routes/(user)/assistant/agent-plan-destination-card.spec.ts" "src/routes/(user)/assistant/agent-plan-evidence-ledger.spec.ts" "src/routes/(user)/assistant/agent-operation-plan-review-panel.spec.ts"
```

Expected: FAIL because field override callbacks and state are not wired through.

- [ ] **Step 4: Thread callbacks through destination card and ledger**

Add props to `AgentPlanDestinationCard` and forward them to `AgentPlanOperationRow`:

```ts
onSetFieldOverride: (operationId: string, fieldKey: string, value: unknown) => void;
onResetFieldOverride: (operationId: string, fieldKey: string) => void;
```

Add the same props to `AgentPlanEvidenceLedger` and pass them to each destination card.

- [ ] **Step 5: Add panel state and apply payload support**

In `agent-operation-plan-review-panel.svelte`, import:

```ts
createInitialOperationFieldOverrideState,
resetOperationFieldOverride,
setOperationFieldOverride,
type OperationFieldOverrideState,
```

Add state:

```ts
let fieldOverrideByOperationId = $state<OperationFieldOverrideState>({});
```

Build the model with field overrides:

```ts
const model = $derived(
  plan
    ? buildOperationReviewModel(plan, enabledByOperationId, itemSelectionByOperationId, fieldOverrideByOperationId)
    : null,
);
```

Initialize and reset with plan loads and successful applies:

```ts
const nextFieldOverrideByOperationId = nextPlan ? createInitialOperationFieldOverrideState(nextPlan) : {};
fieldOverrideByOperationId = nextFieldOverrideByOperationId;
```

Update `publishSelection` signature to accept field overrides and call:

```ts
buildOperationReviewModel(
  nextPlan,
  nextEnabledByOperationId,
  nextItemSelectionByOperationId,
  nextFieldOverrideByOperationId,
);
```

Compute apply eligibility from field validation:

```ts
const canApply = $derived(
  canChangeSelection && selectedOperationIds.length > 0 && (model?.fieldErrors.length ?? 0) === 0,
);
```

Add handlers:

```ts
const setFieldOverride = (operationId: string, fieldKey: string, value: unknown) => {
  if (!plan || !canChangeSelection) {
    return;
  }

  const nextFieldOverrideByOperationId = setOperationFieldOverride(
    fieldOverrideByOperationId,
    operationId,
    fieldKey,
    value,
  );
  fieldOverrideByOperationId = nextFieldOverrideByOperationId;
  publishSelection(plan, enabledByOperationId, itemSelectionByOperationId, nextFieldOverrideByOperationId);
};

const resetFieldOverride = (operationId: string, fieldKey: string) => {
  if (!plan || !canChangeSelection) {
    return;
  }

  const nextFieldOverrideByOperationId = resetOperationFieldOverride(fieldOverrideByOperationId, operationId, fieldKey);
  fieldOverrideByOperationId = nextFieldOverrideByOperationId;
  publishSelection(plan, enabledByOperationId, itemSelectionByOperationId, nextFieldOverrideByOperationId);
};
```

Include `fieldOverrides` in apply request:

```ts
agentOperationPlanApplyRequestDto: {
  operationIds: selectionPayload.operationIds,
  ...(selectionPayload.itemSelections ? { itemSelections: selectionPayload.itemSelections } : {}),
  ...(selectionPayload.fieldOverrides ? { fieldOverrides: selectionPayload.fieldOverrides } : {}),
  planRevision: selectionPayload.planRevision,
}
```

- [ ] **Step 6: Run panel/card/ledger tests and verify GREEN**

Run:

```bash
pnpm --dir web test --run "src/routes/(user)/assistant/agent-plan-destination-card.spec.ts" "src/routes/(user)/assistant/agent-plan-evidence-ledger.spec.ts" "src/routes/(user)/assistant/agent-operation-plan-review-panel.spec.ts"
```

Expected: PASS.

- [ ] **Step 7: Commit panel wiring**

```bash
git add web/src/routes/'(user)'/assistant/agent-plan-destination-card.svelte web/src/routes/'(user)'/assistant/agent-plan-destination-card.spec.ts web/src/routes/'(user)'/assistant/agent-plan-evidence-ledger.svelte web/src/routes/'(user)'/assistant/agent-plan-evidence-ledger.spec.ts web/src/routes/'(user)'/assistant/agent-operation-plan-review-panel.svelte web/src/routes/'(user)'/assistant/agent-operation-plan-review-panel.spec.ts
git commit -m "feat: submit pi plan field overrides"
```

---

### Task 6: E2E Coverage, SDK Generation, And Verification

**Files:**

- Modify: `e2e/src/specs/web/assistant-album-organizer.e2e-spec.ts`
- Modify through generation: `open-api/immich-openapi-specs.json`
- Modify through generation: `open-api/typescript-sdk/src/fetch-client.ts`
- Modify through generation: `open-api/typescript-sdk/build/fetch-client.d.ts`

- [ ] **Step 1: Write failing E2E assertions for inline edits**

In `e2e/src/specs/web/assistant-album-organizer.e2e-spec.ts`, update the happy-path test before applying:

```ts
await portugalDestination.getByLabel('Album name').fill('Portugal Favorites');
await portugalDestination.getByLabel('Description').fill('Curated favorites from the trip.');
await expect(portugalDestination.getByText('Create album "Portugal Favorites"')).toBeVisible();
```

Update the apply request assertion:

```ts
expect(applyRequest.postDataJSON()).toMatchObject({
  operationIds: expect.arrayContaining([proposedAddOperation!.id]),
  itemSelections: {
    [proposedAddOperation!.id]: {
      itemKind: 'asset',
      mode: 'allExcept',
      itemIds: [excludedAssetId],
    },
  },
  fieldOverrides: {
    [createOperationFromCurrentPlan.id]: {
      albumName: 'Portugal Favorites',
      description: 'Curated favorites from the trip.',
    },
  },
  planRevision: currentPlan.revision,
});
```

Add lookup before the assertion:

```ts
const createOperationFromCurrentPlan = currentPlan.operations.find(
  (operation) => operation.type === AgentOperationType.AlbumCreate,
);
if (!createOperationFromCurrentPlan) {
  throw new Error('Expected the runner to propose an album create operation');
}
expect(createOperationFromCurrentPlan.id).toEqual(expect.any(String));
```

Update final album assertions:

```ts
expect(album.albumName).toBe('Portugal Favorites');
expect(album.description).toBe('Curated favorites from the trip.');
```

- [ ] **Step 2: Run focused tests and verify RED if SDK is stale**

Run:

```bash
pnpm --dir web test --run "src/routes/(user)/assistant/agent-operation-plan-review-panel.spec.ts"
pnpm --dir server test --run src/dtos/agent-operation.dto.spec.ts src/services/agent-operation-plan.service.spec.ts
```

Expected: PASS after Tasks 1-5. Type checks may still fail until generated SDK includes `fieldOverrides`.

- [ ] **Step 3: Regenerate OpenAPI/SDK**

Run:

```bash
make open-api-typescript
```

Expected: generated API and SDK types include `fieldOverrides` and multi-candidate set-cover `assetIds`.

- [ ] **Step 4: Run full local verification for this slice**

Run:

```bash
pnpm --dir server test --run src/dtos/agent-operation.dto.spec.ts src/controllers/agent-operation-plan.controller.spec.ts src/services/agent-operation-plan.service.spec.ts
pnpm --dir web test --run "src/routes/(user)/assistant/agent-operation-plan-ui.spec.ts" "src/routes/(user)/assistant/agent-plan-inline-field-editor.spec.ts" "src/routes/(user)/assistant/agent-plan-operation-row.spec.ts" "src/routes/(user)/assistant/agent-plan-destination-card.spec.ts" "src/routes/(user)/assistant/agent-plan-evidence-ledger.spec.ts" "src/routes/(user)/assistant/agent-operation-plan-review-panel.spec.ts"
pnpm --dir web check:typescript
pnpm --dir web check:svelte
pnpm --filter immich-web run format
pnpm --filter immich run format
```

Expected: all commands PASS with no type or Svelte diagnostics.

- [ ] **Step 5: Commit generated SDK and E2E coverage**

```bash
git add e2e/src/specs/web/assistant-album-organizer.e2e-spec.ts open-api/immich-openapi-specs.json open-api/typescript-sdk/src/fetch-client.ts open-api/typescript-sdk/build/fetch-client.d.ts
git commit -m "test: cover pi plan field override flow"
```

- [ ] **Step 6: Push and use CI for browser/E2E verification**

Run:

```bash
git push
```

Then use CI as the source of truth for the E2E browser run, especially the assistant album organizer flow. If CI fails, diagnose the failing job and add the smallest test-first fix.

---

## Edge Case Coverage Checklist

- [ ] Empty `fieldOverrides[operationId]` is rejected by DTO validation.
- [ ] Too many override fields on one operation is rejected by DTO validation.
- [ ] Unknown override operation ID is rejected before plan claim.
- [ ] Override for an unselected operation is rejected before plan claim.
- [ ] Override for `album.addAssets` is rejected.
- [ ] Unknown override field on a supported operation is rejected.
- [ ] Non-string album name is rejected.
- [ ] Empty/whitespace-only album name is rejected.
- [ ] Album name longer than 200 characters is rejected.
- [ ] Non-string description is rejected.
- [ ] Description longer than 1,000 characters is rejected.
- [ ] Empty description override is accepted and applied.
- [ ] Cover override outside operation candidates is rejected.
- [ ] Cover override excluded by item selection is rejected.
- [ ] Default cover behavior still uses the first selected candidate when no cover override is present.
- [ ] Disabled and blocked operations do not emit field overrides.
- [ ] Field override and item selection can be sent in the same apply request.
- [ ] Stale `planRevision` rejects before field override validation mutates anything.
- [ ] Access and write-scope validation still use the overridden operation payload and asset IDs.
- [ ] Stored plan payload is not mutated by inline edits before apply.
- [ ] Inline edits reset after a new plan loads or an apply completes.
- [ ] Invalid inline fields disable the apply button and show a concise message.
- [ ] Technical field names and operation IDs remain hidden from default UI.
- [ ] E2E verifies the request body and final album state after applying edited fields.

## Self-Review

- Spec coverage: This plan implements Slice 5 inline field overrides, including field override validation server-side, editable fields in the review model, inline editors, apply payload extensions, and tests. It explicitly defers target album/space and rotation direction to Slice 7 because the operation types and picker contracts are not present in the current branch.
- TDD coverage: Every task starts by adding failing tests, includes the exact command to verify RED, then implements minimal code and reruns tests for GREEN.
- Edge coverage: DTO, service, view-model, component, panel, and E2E edge cases are listed and mapped to tasks.
- Type consistency: The plan consistently uses `fieldOverrides`, `OperationFieldOverrideState`, `AgentReviewEditableField`, and `albumThumbnailAssetId`.
- Large-plan consistency: This slice does not add eager rendering. Cover-photo candidates are bounded by the operation candidate list, and large virtualized refinement remains Slice 6.
