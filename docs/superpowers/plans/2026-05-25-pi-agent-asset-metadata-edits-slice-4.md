# Pi Agent Asset Metadata Edits Slice 4 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply approved `asset.updateMetadata` operations through Gallery's existing bulk asset update path, preserving operation-level success/failure semantics.

**Architecture:** Add an apply switch case that validates the stored metadata payload, builds an `AssetBulkUpdateDto`-compatible object, and calls `assetService.updateAll(auth, dto)`. Existing apply orchestration already rechecks write scope and writable asset access before each operation, catches per-operation errors, persists failed operations, emits aggregate progress, and returns the session to a usable running state after operation-level failures.

**Tech Stack:** TypeScript, NestJS service layer, existing `AssetService.updateAll`, Vitest.

---

## Scope

This is Slice 4 from `docs/superpowers/specs/2026-05-25-pi-agent-asset-metadata-edits-design.md`.

Implement only:

- Apply `AgentOperationType.AssetUpdateMetadata` by calling `assetService.updateAll(auth, dto)`.
- Pass the selected/materialized operation asset ids as `dto.ids`.
- Pass only supported metadata fields:
  - `description`
  - `rating`
  - `dateTimeOriginal`
  - `dateTimeRelative`
  - `timeZone`
  - `latitude`
  - `longitude`
- Preserve empty-string descriptions and `rating: null` clear operations.
- Pass explicit coordinate updates to `AssetService.updateAll` so the existing reverse-geocode behavior remains centralized there.
- Reuse existing apply-time `validateWriteScope` and writable asset access checks from Slice 3.
- Mark a metadata operation applied as a whole when `assetService.updateAll` resolves.
- Mark a metadata operation failed as a whole when `assetService.updateAll` rejects, including reverse-geocode or sidecar-write failures raised by the existing bulk update path.
- Continue applying sibling operations after a metadata operation fails, using the existing apply orchestration.

Do not implement:

- UI before/after metadata rendering.
- Activity copy changes beyond existing aggregate apply progress.
- Assistant prompt-flow tests.
- Capability matrix/docs updates.
- Forward geocoding/place-name resolution.
- Location clearing.
- Per-asset metadata payloads.
- Provider-facing before-values.
- New direct MCP mutation tools.

## Files

- Modify: `server/src/services/agent-operation-plan.service.ts`
  - Add an `AssetUpdateMetadata` apply case.
  - Add a defensive `requireAssetUpdateMetadataPayload()` helper.
  - Add a small supported-field key list for building the bulk update DTO.
- Modify: `server/src/services/agent-operation-plan.service.spec.ts`
  - Add apply success, clear-value, selection, apply-time access, operation failure, and sibling-continuation tests.
- Modify if branch type-check fixtures require backfill: `server/src/controllers/agent-session.controller.spec.ts`
  - Add the existing metadata write-scope flag to controller test permission fixtures.

## Task 1: Successful Metadata Apply Through `AssetService.updateAll`

**Files:**

- Modify: `server/src/services/agent-operation-plan.service.ts`
- Test: `server/src/services/agent-operation-plan.service.spec.ts`

- [ ] **Step 1: Write failing success tests**

In `server/src/services/agent-operation-plan.service.spec.ts`, add this test near the existing asset apply tests:

```ts
it('applies asset.updateMetadata through AssetService.updateAll', async () => {
  const auth = AuthFactory.create();
  const session = makeSession({
    userId: auth.user.id,
    status: AgentSessionStatus.WaitingForPlanReview,
    permissionPlanSnapshot: expandedPermissionPlanSnapshot,
  });
  const assetIds = [newUuid(), newUuid()];
  const payload = {
    description: 'Berlin weekend',
    rating: 5,
    dateTimeOriginal: '1998-06-01T12:00:00.000Z',
    timeZone: 'Europe/Berlin',
    latitude: 52.52,
    longitude: 13.405,
  };
  const operation = makeOperation({
    id: newUuid(),
    planId: 'plan-id',
    type: AgentOperationType.AssetUpdateMetadata,
    targetKind: AgentOperationTargetKind.AssetBatch,
    targetId: null,
    temporaryTargetId: null,
    assetIds,
    payload,
  });
  const plan = makePlan({ id: 'plan-id', sessionId: session.id, operations: [operation] });
  sessionRepository.getById.mockResolvedValue(session);
  planRepository.getByIdForSession.mockResolvedValue(plan);
  planRepository.getCurrentBySessionId.mockResolvedValue(plan);
  planRepository.claimCurrentForApply.mockResolvedValue({ ...plan, status: AgentOperationPlanStatus.Applied });
  planRepository.completeApply.mockImplementation((planId, updates) =>
    Promise.resolve(applyUpdatesToPlan({ ...plan, id: planId }, updates)),
  );
  accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set(assetIds));
  accessRepository.asset.checkSpaceEditAccess.mockResolvedValue(new Set(assetIds));
  assetRepository.getAgentReadableIds.mockResolvedValue(new Set(assetIds));
  assetService.updateAll.mockResolvedValue(undefined as never);

  const result = await sut.applyApprovedOperations(auth, session.id, plan.id, { operationIds: [operation.id] });

  expect(result.status).toBe(AgentOperationApplyStatus.Applied);
  expect(result.appliedOperationIds).toEqual([operation.id]);
  expect(assetService.updateAll).toHaveBeenCalledWith(auth, {
    ids: assetIds,
    description: 'Berlin weekend',
    rating: 5,
    dateTimeOriginal: '1998-06-01T12:00:00.000Z',
    timeZone: 'Europe/Berlin',
    latitude: 52.52,
    longitude: 13.405,
  });
  expect(planRepository.completeApply).toHaveBeenCalledWith(plan.id, [
    expect.objectContaining({
      id: operation.id,
      status: AgentOperationStatus.Applied,
      result: { assetIds },
      error: null,
    }),
  ]);
});
```

Add a focused clear-values test:

```ts
it('applies asset.updateMetadata clear values without dropping them', async () => {
  const auth = AuthFactory.create();
  const session = makeSession({
    userId: auth.user.id,
    status: AgentSessionStatus.WaitingForPlanReview,
    permissionPlanSnapshot: expandedPermissionPlanSnapshot,
  });
  const assetIds = [newUuid()];
  const operation = makeOperation({
    id: newUuid(),
    planId: 'plan-id',
    type: AgentOperationType.AssetUpdateMetadata,
    targetKind: AgentOperationTargetKind.AssetBatch,
    targetId: null,
    temporaryTargetId: null,
    assetIds,
    payload: { description: '', rating: null },
  });
  const plan = makePlan({ id: 'plan-id', sessionId: session.id, operations: [operation] });
  sessionRepository.getById.mockResolvedValue(session);
  planRepository.getByIdForSession.mockResolvedValue(plan);
  planRepository.getCurrentBySessionId.mockResolvedValue(plan);
  planRepository.claimCurrentForApply.mockResolvedValue({ ...plan, status: AgentOperationPlanStatus.Applied });
  planRepository.completeApply.mockImplementation((planId, updates) =>
    Promise.resolve(applyUpdatesToPlan({ ...plan, id: planId }, updates)),
  );
  accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set(assetIds));
  accessRepository.asset.checkSpaceEditAccess.mockResolvedValue(new Set(assetIds));
  assetRepository.getAgentReadableIds.mockResolvedValue(new Set(assetIds));
  assetService.updateAll.mockResolvedValue(undefined as never);

  await expect(
    sut.applyApprovedOperations(auth, session.id, plan.id, { operationIds: [operation.id] }),
  ).resolves.toMatchObject({ status: AgentOperationApplyStatus.Applied });

  expect(assetService.updateAll).toHaveBeenCalledWith(auth, {
    ids: assetIds,
    description: '',
    rating: null,
  });
});
```

Add a defensive stored-payload validation test:

```ts
it('fails asset.updateMetadata with an invalid stored payload before calling AssetService.updateAll', async () => {
  const auth = AuthFactory.create();
  const session = makeSession({
    userId: auth.user.id,
    status: AgentSessionStatus.WaitingForPlanReview,
    permissionPlanSnapshot: expandedPermissionPlanSnapshot,
  });
  const assetId = newUuid();
  const operation = makeOperation({
    id: newUuid(),
    planId: 'plan-id',
    type: AgentOperationType.AssetUpdateMetadata,
    targetKind: AgentOperationTargetKind.AssetBatch,
    targetId: null,
    temporaryTargetId: null,
    assetIds: [assetId],
    payload: { dateTimeOriginal: '1998-06-01T12:00:00.000Z', dateTimeRelative: 60 },
  });
  const plan = makePlan({ id: 'plan-id', sessionId: session.id, operations: [operation] });
  sessionRepository.getById.mockResolvedValue(session);
  planRepository.getByIdForSession.mockResolvedValue(plan);
  planRepository.getCurrentBySessionId.mockResolvedValue(plan);
  planRepository.claimCurrentForApply.mockResolvedValue({ ...plan, status: AgentOperationPlanStatus.Applied });
  planRepository.completeApply.mockImplementation((planId, updates) =>
    Promise.resolve(applyUpdatesToPlan({ ...plan, id: planId }, updates)),
  );
  accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set([assetId]));
  accessRepository.asset.checkSpaceEditAccess.mockResolvedValue(new Set([assetId]));
  assetRepository.getAgentReadableIds.mockResolvedValue(new Set([assetId]));

  const result = await sut.applyApprovedOperations(auth, session.id, plan.id, { operationIds: [operation.id] });

  expect(result.status).toBe(AgentOperationApplyStatus.Failed);
  expect(assetService.updateAll).not.toHaveBeenCalled();
  expect(planRepository.completeApply).toHaveBeenCalledWith(plan.id, [
    expect.objectContaining({
      id: operation.id,
      status: AgentOperationStatus.Failed,
      error: 'Invalid asset metadata payload for Set description.',
    }),
  ]);
});
```

Add a second defensive stored-payload validation test:

```ts
it('fails asset.updateMetadata with an invalid stored ISO date before calling AssetService.updateAll', async () => {
  // Same setup as the invalid stored payload test, but use:
  // payload: { dateTimeOriginal: 'June 1st, 1998' }
  // summary: 'Set capture date.'
  //
  // Assert:
  // - result.status is Failed
  // - assetService.updateAll is not called
  // - the failed operation error is:
  //   'Invalid asset metadata payload for Set capture date.'
});
```

- [ ] **Step 2: Run the apply service tests and confirm red**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-operation-plan.service.spec.ts
```

Expected: FAIL because `asset.updateMetadata` currently falls through to the unsupported apply branch.

- [ ] **Step 3: Add the minimal apply implementation**

In `server/src/services/agent-operation-plan.service.ts`, add this key list near the existing `assetUpdateMetadataWorkflowPayloadKeys` constant:

```ts
const assetUpdateMetadataApplyPayloadKeys = [
  'description',
  'rating',
  'dateTimeOriginal',
  'dateTimeRelative',
  'timeZone',
  'latitude',
  'longitude',
] as const;
```

Add a switch case after `AssetSetArchive`:

```ts
      case AgentOperationType.AssetUpdateMetadata: {
        const payload = this.requireAssetUpdateMetadataPayload(operation.payload, operation.summary);
        await this.assetService.updateAll(auth, { ids: operation.assetIds, ...payload });
        return this.appliedOperation(operation.id, { assetIds: operation.assetIds });
      }
```

Add this helper near the other `require*Payload` helpers:

```ts
  private requireAssetUpdateMetadataPayload(
    payload: unknown,
    summary: string,
  ): {
    description?: string;
    rating?: 1 | 2 | 3 | 4 | 5 | null;
    dateTimeOriginal?: string;
    dateTimeRelative?: number;
    timeZone?: string;
    latitude?: number;
    longitude?: number;
  } {
    const objectPayload = this.requireObjectPayload(payload);
    const unsupportedFields = Object.keys(objectPayload).filter(
      (field) => !assetUpdateMetadataApplyPayloadKeys.includes(field as (typeof assetUpdateMetadataApplyPayloadKeys)[number]),
    );
    if (unsupportedFields.length > 0) {
      throw new BadRequestException(`Invalid asset metadata payload for ${summary}`);
    }

    const suppliedFieldCount = assetUpdateMetadataApplyPayloadKeys.filter(
      (field) => objectPayload[field] !== undefined,
    ).length;
    if (suppliedFieldCount === 0) {
      throw new BadRequestException(`Invalid asset metadata payload for ${summary}`);
    }
    if (objectPayload.dateTimeOriginal !== undefined && objectPayload.dateTimeRelative !== undefined) {
      throw new BadRequestException(`Invalid asset metadata payload for ${summary}`);
    }
    if (objectPayload.dateTimeRelative === 0 && suppliedFieldCount === 1) {
      throw new BadRequestException(`Invalid asset metadata payload for ${summary}`);
    }
    if (Number(objectPayload.latitude !== undefined) + Number(objectPayload.longitude !== undefined) === 1) {
      throw new BadRequestException(`Invalid asset metadata payload for ${summary}`);
    }

    const metadata: {
      description?: string;
      rating?: 1 | 2 | 3 | 4 | 5 | null;
      dateTimeOriginal?: string;
      dateTimeRelative?: number;
      timeZone?: string;
      latitude?: number;
      longitude?: number;
    } = {};

    if (objectPayload.description !== undefined) {
      if (typeof objectPayload.description !== 'string' || objectPayload.description.length > 1000) {
        throw new BadRequestException(`Invalid asset metadata payload for ${summary}`);
      }
      metadata.description = objectPayload.description;
    }

    if (objectPayload.rating !== undefined) {
      if (
        objectPayload.rating !== null &&
        objectPayload.rating !== 1 &&
        objectPayload.rating !== 2 &&
        objectPayload.rating !== 3 &&
        objectPayload.rating !== 4 &&
        objectPayload.rating !== 5
      ) {
        throw new BadRequestException(`Invalid asset metadata payload for ${summary}`);
      }
      metadata.rating = objectPayload.rating;
    }

    if (objectPayload.dateTimeOriginal !== undefined) {
      if (
        typeof objectPayload.dateTimeOriginal !== 'string' ||
        !z.iso.datetime().safeParse(objectPayload.dateTimeOriginal).success
      ) {
        throw new BadRequestException(`Invalid asset metadata payload for ${summary}`);
      }
      metadata.dateTimeOriginal = objectPayload.dateTimeOriginal;
    }

    if (objectPayload.dateTimeRelative !== undefined) {
      if (!Number.isInteger(objectPayload.dateTimeRelative)) {
        throw new BadRequestException(`Invalid asset metadata payload for ${summary}`);
      }
      metadata.dateTimeRelative = objectPayload.dateTimeRelative;
    }

    if (objectPayload.timeZone !== undefined) {
      if (typeof objectPayload.timeZone !== 'string' || objectPayload.timeZone.trim().length === 0) {
        throw new BadRequestException(`Invalid asset metadata payload for ${summary}`);
      }
      try {
        Intl.DateTimeFormat(undefined, { timeZone: objectPayload.timeZone });
      } catch {
        throw new BadRequestException(`Invalid asset metadata payload for ${summary}`);
      }
      metadata.timeZone = objectPayload.timeZone;
    }

    if (objectPayload.latitude !== undefined) {
      if (
        typeof objectPayload.latitude !== 'number' ||
        !Number.isFinite(objectPayload.latitude) ||
        objectPayload.latitude < -90 ||
        objectPayload.latitude > 90
      ) {
        throw new BadRequestException(`Invalid asset metadata payload for ${summary}`);
      }
      metadata.latitude = objectPayload.latitude;
    }

    if (objectPayload.longitude !== undefined) {
      if (
        typeof objectPayload.longitude !== 'number' ||
        !Number.isFinite(objectPayload.longitude) ||
        objectPayload.longitude < -180 ||
        objectPayload.longitude > 180
      ) {
        throw new BadRequestException(`Invalid asset metadata payload for ${summary}`);
      }
      metadata.longitude = objectPayload.longitude;
    }

    return metadata;
  }
```

- [ ] **Step 4: Run the apply service tests again**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-operation-plan.service.spec.ts
```

Expected: PASS for the new success and clear-value tests.

## Task 2: Apply Selection And Access Drift

**Files:**

- Test: `server/src/services/agent-operation-plan.service.spec.ts`
- Modify only if required: `server/src/services/agent-operation-plan.service.ts`

- [ ] **Step 1: Write failing selection/access tests**

Add this selection test:

```ts
it('applies asset.updateMetadata only to selected assets', async () => {
  const auth = AuthFactory.create();
  const session = makeSession({
    userId: auth.user.id,
    status: AgentSessionStatus.WaitingForPlanReview,
    permissionPlanSnapshot: expandedPermissionPlanSnapshot,
  });
  const keptAssetId = newUuid();
  const removedAssetId = newUuid();
  const operation = makeOperation({
    id: newUuid(),
    planId: 'plan-id',
    type: AgentOperationType.AssetUpdateMetadata,
    targetKind: AgentOperationTargetKind.AssetBatch,
    targetId: null,
    temporaryTargetId: null,
    assetIds: [keptAssetId, removedAssetId],
    payload: { dateTimeRelative: 120 },
  });
  const plan = makePlan({ id: 'plan-id', sessionId: session.id, operations: [operation] });
  sessionRepository.getById.mockResolvedValue(session);
  planRepository.getByIdForSession.mockResolvedValue(plan);
  planRepository.getCurrentBySessionId.mockResolvedValue(plan);
  planRepository.claimCurrentForApply.mockResolvedValue({ ...plan, status: AgentOperationPlanStatus.Applied });
  planRepository.completeApply.mockImplementation((planId, updates) =>
    Promise.resolve(applyUpdatesToPlan({ ...plan, id: planId }, updates)),
  );
  accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set([keptAssetId]));
  accessRepository.asset.checkSpaceEditAccess.mockResolvedValue(new Set([keptAssetId]));
  assetRepository.getAgentReadableIds.mockResolvedValue(new Set([keptAssetId]));
  assetService.updateAll.mockResolvedValue(undefined as never);

  await expect(
    sut.applyApprovedOperations(auth, session.id, plan.id, {
      operationIds: [operation.id],
      itemSelections: {
        [operation.id]: { itemKind: 'asset', mode: 'only', itemIds: [keptAssetId] },
      },
    }),
  ).resolves.toMatchObject({ status: AgentOperationApplyStatus.Applied });

  expect(assetService.updateAll).toHaveBeenCalledWith(auth, {
    ids: [keptAssetId],
    dateTimeRelative: 120,
  });
});
```

Add this apply-time access drift test:

```ts
it('fails asset.updateMetadata when apply-time asset access no longer passes', async () => {
  const auth = AuthFactory.create();
  const session = makeSession({
    userId: auth.user.id,
    status: AgentSessionStatus.WaitingForPlanReview,
    permissionPlanSnapshot: expandedPermissionPlanSnapshot,
  });
  const assetId = newUuid();
  const operation = makeOperation({
    id: newUuid(),
    planId: 'plan-id',
    type: AgentOperationType.AssetUpdateMetadata,
    targetKind: AgentOperationTargetKind.AssetBatch,
    targetId: null,
    temporaryTargetId: null,
    assetIds: [assetId],
    payload: { description: 'Hidden' },
  });
  const plan = makePlan({ id: 'plan-id', sessionId: session.id, operations: [operation] });
  sessionRepository.getById.mockResolvedValue(session);
  planRepository.getByIdForSession.mockResolvedValue(plan);
  planRepository.getCurrentBySessionId.mockResolvedValue(plan);
  planRepository.claimCurrentForApply.mockResolvedValue({ ...plan, status: AgentOperationPlanStatus.Applied });
  planRepository.completeApply.mockImplementation((planId, updates) =>
    Promise.resolve(applyUpdatesToPlan({ ...plan, id: planId }, updates)),
  );
  accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set());
  accessRepository.asset.checkSpaceEditAccess.mockResolvedValue(new Set());
  assetRepository.getAgentReadableIds.mockResolvedValue(new Set());

  const result = await sut.applyApprovedOperations(auth, session.id, plan.id, { operationIds: [operation.id] });

  expect(result.status).toBe(AgentOperationApplyStatus.Failed);
  expect(result.failedOperationIds).toEqual([operation.id]);
  expect(assetService.updateAll).not.toHaveBeenCalled();
  expect(planRepository.completeApply).toHaveBeenCalledWith(plan.id, [
    expect.objectContaining({
      id: operation.id,
      status: AgentOperationStatus.Failed,
      error: 'One or more assets are not editable',
    }),
  ]);
});
```

- [ ] **Step 2: Run the apply service tests**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-operation-plan.service.spec.ts
```

Expected: PASS. Slice 3 already made metadata operations participate in the existing selected-asset and writable-access paths; if this fails, keep the implementation scoped to those shared helpers.

## Task 3: Operation-Level Failure And Sibling Continuation

**Files:**

- Test: `server/src/services/agent-operation-plan.service.spec.ts`
- Modify only if required: `server/src/services/agent-operation-plan.service.ts`

- [ ] **Step 1: Write failing operation-failure tests**

Add this test for reverse-geocode/sidecar-write failures raised by `AssetService.updateAll`:

```ts
it('marks asset.updateMetadata failed when the bulk metadata update path throws', async () => {
  const auth = AuthFactory.create();
  const session = makeSession({
    userId: auth.user.id,
    status: AgentSessionStatus.WaitingForPlanReview,
    permissionPlanSnapshot: expandedPermissionPlanSnapshot,
  });
  const assetId = newUuid();
  const operation = makeOperation({
    id: newUuid(),
    planId: 'plan-id',
    type: AgentOperationType.AssetUpdateMetadata,
    targetKind: AgentOperationTargetKind.AssetBatch,
    targetId: null,
    temporaryTargetId: null,
    assetIds: [assetId],
    payload: { latitude: 52.52, longitude: 13.405 },
  });
  const plan = makePlan({ id: 'plan-id', sessionId: session.id, operations: [operation] });
  sessionRepository.getById.mockResolvedValue(session);
  planRepository.getByIdForSession.mockResolvedValue(plan);
  planRepository.getCurrentBySessionId.mockResolvedValue(plan);
  planRepository.claimCurrentForApply.mockResolvedValue({ ...plan, status: AgentOperationPlanStatus.Applied });
  planRepository.completeApply.mockImplementation((planId, updates) =>
    Promise.resolve(applyUpdatesToPlan({ ...plan, id: planId }, updates)),
  );
  accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set([assetId]));
  accessRepository.asset.checkSpaceEditAccess.mockResolvedValue(new Set([assetId]));
  assetRepository.getAgentReadableIds.mockResolvedValue(new Set([assetId]));
  assetService.updateAll.mockRejectedValue(new Error('reverse geocode failed'));

  const result = await sut.applyApprovedOperations(auth, session.id, plan.id, { operationIds: [operation.id] });

  expect(result.status).toBe(AgentOperationApplyStatus.Failed);
  expect(result.failedOperationIds).toEqual([operation.id]);
  expect(assetService.updateAll).toHaveBeenCalledWith(auth, {
    ids: [assetId],
    latitude: 52.52,
    longitude: 13.405,
  });
  expect(planRepository.completeApply).toHaveBeenCalledWith(plan.id, [
    expect.objectContaining({
      id: operation.id,
      status: AgentOperationStatus.Failed,
      result: null,
      error: 'reverse geocode failed',
    }),
  ]);
  expect(sessionRepository.update).toHaveBeenCalledWith(auth.user.id, session.id, {
    status: AgentSessionStatus.Running,
    endedAt: null,
  });
});
```

Add this sibling-continuation test:

```ts
it('continues applying sibling operations after asset.updateMetadata fails', async () => {
  const auth = AuthFactory.create();
  const session = makeSession({
    userId: auth.user.id,
    status: AgentSessionStatus.WaitingForPlanReview,
    permissionPlanSnapshot: expandedPermissionPlanSnapshot,
  });
  const metadataAssetId = newUuid();
  const favoriteAssetId = newUuid();
  const metadataOperation = makeOperation({
    id: newUuid(),
    planId: 'plan-id',
    type: AgentOperationType.AssetUpdateMetadata,
    targetKind: AgentOperationTargetKind.AssetBatch,
    targetId: null,
    temporaryTargetId: null,
    assetIds: [metadataAssetId],
    payload: { latitude: 52.52, longitude: 13.405 },
  });
  const favoriteOperation = makeOperation({
    id: newUuid(),
    planId: 'plan-id',
    position: 1,
    type: AgentOperationType.AssetSetFavorite,
    targetKind: AgentOperationTargetKind.AssetBatch,
    targetId: null,
    temporaryTargetId: null,
    assetIds: [favoriteAssetId],
    payload: { favorite: true },
  });
  const plan = makePlan({
    id: 'plan-id',
    sessionId: session.id,
    operations: [metadataOperation, favoriteOperation],
  });
  sessionRepository.getById.mockResolvedValue(session);
  planRepository.getByIdForSession.mockResolvedValue(plan);
  planRepository.getCurrentBySessionId.mockResolvedValue(plan);
  planRepository.claimCurrentForApply.mockResolvedValue({ ...plan, status: AgentOperationPlanStatus.Applied });
  planRepository.completeApply.mockImplementation((planId, updates) =>
    Promise.resolve(applyUpdatesToPlan({ ...plan, id: planId }, updates)),
  );
  accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set([metadataAssetId, favoriteAssetId]));
  accessRepository.asset.checkSpaceEditAccess.mockResolvedValue(new Set([metadataAssetId, favoriteAssetId]));
  assetRepository.getAgentReadableIds.mockResolvedValue(new Set([metadataAssetId, favoriteAssetId]));
  assetService.updateAll
    .mockRejectedValueOnce(new Error('sidecar write failed'))
    .mockResolvedValueOnce(undefined as never);

  const result = await sut.applyApprovedOperations(auth, session.id, plan.id, {
    operationIds: [metadataOperation.id, favoriteOperation.id],
  });

  expect(result.status).toBe(AgentOperationApplyStatus.PartiallyApplied);
  expect(result.failedOperationIds).toEqual([metadataOperation.id]);
  expect(result.appliedOperationIds).toEqual([favoriteOperation.id]);
  expect(assetService.updateAll).toHaveBeenNthCalledWith(1, auth, {
    ids: [metadataAssetId],
    latitude: 52.52,
    longitude: 13.405,
  });
  expect(assetService.updateAll).toHaveBeenNthCalledWith(2, auth, {
    ids: [favoriteAssetId],
    isFavorite: true,
  });
  expect(planRepository.completeApply).toHaveBeenCalledWith(plan.id, [
    expect.objectContaining({
      id: metadataOperation.id,
      status: AgentOperationStatus.Failed,
      error: 'sidecar write failed',
    }),
    expect.objectContaining({
      id: favoriteOperation.id,
      status: AgentOperationStatus.Applied,
      result: { assetIds: [favoriteAssetId] },
    }),
  ]);
});
```

- [ ] **Step 2: Run the apply service tests**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-operation-plan.service.spec.ts
```

Expected: PASS. Existing apply orchestration should already catch operation-level failures and continue.

## Task 4: Slice Verification And Commit

**Files:**

- All files modified by Tasks 1-3.

- [ ] **Step 1: Run targeted server tests**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-operation-plan.service.spec.ts
```

Expected: PASS.

- [ ] **Step 2: Run build and whitespace checks**

Run:

```bash
pnpm --dir server run build
pnpm --dir server exec tsc --noEmit --pretty false
git diff --check
```

Expected: PASS.

- [ ] **Step 3: Commit Slice 4**

Run:

```bash
git status --short
git add docs/superpowers/plans/2026-05-25-pi-agent-asset-metadata-edits-slice-4.md server/src/services/agent-operation-plan.service.ts server/src/services/agent-operation-plan.service.spec.ts
git commit -m "feat: apply pi agent metadata updates"
git status --short --branch
```

Expected: commit succeeds and the worktree is clean.

## Plan Review

- Spec coverage: This plan covers Slice 4 apply requirements: delegate to `assetService.updateAll`, preserve operation-level all-or-failed status, surface reverse-geocode/sidecar-write failures raised by the existing bulk update path, continue sibling operations, and recheck apply-time asset access.
- Edge cases covered: empty description clears, `rating: null` clears, coordinates are delegated to the central reverse-geocoding path, selected item changes narrow the asset ids, apply-time access drift fails the operation, and thrown bulk update errors are persisted as concise operation errors while the session returns to running.
- Placeholder scan: The plan names exact files, test cases, implementation snippets, commands, expected red failures, and commit message.
- Type consistency: `asset.updateMetadata` remains an `asset_batch` operation; the apply DTO passes `ids` plus the existing metadata field names expected by `AssetBulkUpdateDto`.
