# Pi Agent Apply Approved Operations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build slice 13 from `docs/superpowers/specs/2026-05-14-pi-agent-album-assistant-design.md`: apply the user's approved album operation IDs, revalidate access and policy at apply time, execute through existing album services, persist per-operation results, and expose the apply action in the Assistant plan review UI.

**Architecture:** Gallery server remains the only writer. The browser posts `{ operationIds }` to a user-authenticated apply endpoint; the service claims the current proposed plan, executes selected operations in stored order through `AlbumService`, skips unselected or dependency-blocked operations, and saves `applied`/`skipped`/`failed` statuses back to the operation plan. The runner still has no apply tool and no direct album mutation path.

**Tech Stack:** NestJS controllers/services/repositories, Zod DTOs, Kysely/Postgres, existing `AlbumService`, generated OpenAPI/TypeScript SDK, Svelte 5 runes, Vitest with Testing Library Svelte, `svelte-i18n`.

---

## Scope

This plan implements vertical slice 13 only:

- Add a browser apply endpoint for the current proposed operation plan.
- Accept the slice 12 selection payload shape: `{ planId, operationIds }`, with `planId` in the route.
- Reject unknown operation IDs, duplicate operation IDs, stored-disabled operation IDs, non-current plans, already-applied plans, non-reviewing sessions, and sessions not owned by the caller.
- Revalidate session write scope, existing album access, asset access, locked-asset policy, and current album/asset state while applying.
- Execute these MVP operation types through existing album service behavior:
  - `album.create`
  - `album.addAssets`
  - `album.updateDetails`
  - `album.setCover`
- Resolve new-album temporary targets from successful `album.create` operations.
- Mark unselected operations as `skipped`.
- Skip selected dependents when a dependency was not applied.
- Persist per-operation `status`, `result`, and `error`.
- Mark the plan `applied` so a second apply request cannot write twice.
- Add an Assistant review-panel apply button wired to the generated SDK endpoint.

This plan intentionally does not add:

- Runner apply/write tools.
- Plan revision from UI feedback.
- Album deletes, removals, tags, ratings, archive/favorite, or metadata edits.
- Full e2e album organizer coverage; that is slice 14.

## File Structure

- `server/src/enum.ts` - add `AgentOperationApplyStatus`.
- `server/src/types/agent-operation.types.ts` - extend stored operation result shape for apply results.
- `server/src/dtos/agent-operation.dto.ts` - add apply request/response DTOs.
- `server/src/dtos/agent-operation.dto.spec.ts` - DTO coverage for request validation and response encoding.
- `server/src/repositories/agent-operation-plan.repository.ts` - claim a proposed plan for apply and persist operation results.
- `server/test/medium/specs/repositories/agent-operation-plan.repository.spec.ts` - medium tests for claim/result persistence and no double apply.
- `server/src/services/agent-operation-plan.service.ts` - apply orchestration, revalidation, dependency handling, `AlbumService` calls, session status transitions, websocket notification.
- `server/src/services/agent-operation-plan.service.spec.ts` - TDD for happy path, all operation types, unselected skips, dependency skips, partial failures, access drift, stored-disabled operations, claim races, unknown IDs, and no unapproved writes.
- `server/src/controllers/agent-operation-plan.controller.ts` - browser `POST :planId/apply` route.
- `server/src/controllers/agent-operation-plan.controller.spec.ts` - route/auth/OpenAPI/date serialization tests.
- `server/src/repositories/websocket.repository.ts` - add `operation-plan-applied` event variant.
- `web/src/lib/stores/websocket.ts` - add matching websocket event type.
- `open-api/immich-openapi-specs.json`, `open-api/typescript-sdk/**`, `mobile/openapi/**` - generated API artifacts.
- `web/src/routes/(user)/assistant/agent-operation-plan-review-panel.svelte` - apply button, in-flight state, success/partial/error feedback, response plan refresh.
- `web/src/routes/(user)/assistant/agent-operation-plan-review-panel.spec.ts` - component apply-flow tests.
- `web/src/routes/(user)/assistant/agent-session-page-content.spec.ts` - i18n mock additions for new apply strings.
- `i18n/en.json` - English strings for the apply action and result summary.

---

### Task 1: Add Apply DTO Contracts

**Files:**

- Modify: `server/src/enum.ts`
- Modify: `server/src/types/agent-operation.types.ts`
- Modify: `server/src/dtos/agent-operation.dto.spec.ts`
- Modify: `server/src/dtos/agent-operation.dto.ts`

- [ ] **Step 1: Add DTO tests first**

In `server/src/dtos/agent-operation.dto.spec.ts`, extend the import from `src/dtos/agent-operation.dto`:

```ts
  AgentOperationPlanApplyRequestDto,
  AgentOperationPlanApplyResponseDto,
```

Extend the enum import from `src/enum`:

```ts
  AgentOperationApplyStatus,
```

Add these tests near the existing operation-plan response tests:

```ts
it('accepts a unique apply operation id list', () => {
  const firstOperationId = factory.uuid();
  const secondOperationId = factory.uuid();

  const result = AgentOperationPlanApplyRequestDto.schema.safeParse({
    operationIds: [firstOperationId, secondOperationId],
  });

  expect(result.success).toBe(true);
  expect(result.data).toEqual({ operationIds: [firstOperationId, secondOperationId] });
});

it('rejects duplicate apply operation ids', () => {
  const operationId = factory.uuid();

  const result = AgentOperationPlanApplyRequestDto.schema.safeParse({
    operationIds: [operationId, operationId],
  });

  expect(result.success).toBe(false);
  expect(result.error?.issues).toEqual([expect.objectContaining({ message: 'operationIds must be unique' })]);
});

it('rejects an empty apply operation id list', () => {
  const result = AgentOperationPlanApplyRequestDto.schema.safeParse({ operationIds: [] });

  expect(result.success).toBe(false);
});

it('accepts an apply response with per-operation result groups', () => {
  const planId = factory.uuid();
  const operationId = factory.uuid();
  const createdAt = '2026-05-16T12:00:00.000Z';
  const updatedAt = '2026-05-16T12:00:01.000Z';

  const result = AgentOperationPlanApplyResponseDto.schema.safeParse({
    status: AgentOperationApplyStatus.Applied,
    plan: {
      id: planId,
      sessionId: factory.uuid(),
      revision: 1,
      status: AgentOperationPlanStatus.Applied,
      summary: 'Portugal plan.',
      operations: [
        {
          id: operationId,
          planId,
          type: AgentOperationType.AlbumCreate,
          summary: 'Create Portugal.',
          targetKind: AgentOperationTargetKind.NewAlbum,
          targetId: null,
          temporaryTargetId: 'tmp-portugal',
          assetIds: [],
          payload: { albumName: 'Portugal' },
          dependencyIds: [],
          riskLevel: AgentOperationRiskLevel.Low,
          enabled: true,
          status: AgentOperationStatus.Applied,
          result: { albumId: factory.uuid() },
          error: null,
          createdAt,
          updatedAt,
        },
      ],
      createdAt,
      updatedAt,
    },
    appliedOperationIds: [operationId],
    skippedOperationIds: [],
    failedOperationIds: [],
    summary: 'Applied 1 operation.',
  });

  expect(result.success).toBe(true);
  expect(result.data?.plan.operations[0].createdAt).toEqual(new Date(createdAt));
});
```

- [ ] **Step 2: Run DTO tests and verify they fail**

Run:

```bash
pnpm --dir server test src/dtos/agent-operation.dto.spec.ts
```

Expected: FAIL because the apply DTO classes and apply status enum do not exist.

- [ ] **Step 3: Add the apply status enum**

In `server/src/enum.ts`, add this enum after `AgentOperationPlanStatus`:

```ts
export enum AgentOperationApplyStatus {
  Applied = 'applied',
  PartiallyApplied = 'partially_applied',
  Failed = 'failed',
}
```

- [ ] **Step 4: Extend the stored operation result type**

In `server/src/types/agent-operation.types.ts`, replace `AgentOperationResult` with:

```ts
export type AgentOperationAssetResult = {
  id: string;
  success: boolean;
  error?: string;
  errorMessage?: string;
};

export type AgentOperationResult = {
  albumId?: string;
  assetIds?: string[];
  assetResults?: AgentOperationAssetResult[];
  skippedReason?: string;
};
```

- [ ] **Step 5: Implement the DTOs**

In `server/src/dtos/agent-operation.dto.ts`, import `AgentOperationApplyStatus` from `src/enum`.

Add the apply status schema next to the existing plan status schema:

```ts
const AgentOperationApplyStatusSchema = z.enum(AgentOperationApplyStatus).meta({ id: 'AgentOperationApplyStatus' });
```

Add the unique operation ID schema after `uniqueAssetIds`:

```ts
const uniqueOperationIds = z
  .array(uuid)
  .min(1)
  .max(500)
  .superRefine((operationIds, ctx) => {
    if (new Set(operationIds).size !== operationIds.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'operationIds must be unique',
      });
    }
  });
```

Add the apply request and response schemas after `AgentOperationPlanToolResponseSchema`:

```ts
const AgentOperationPlanApplyRequestSchema = z
  .strictObject({
    operationIds: uniqueOperationIds,
  })
  .meta({ id: 'AgentOperationPlanApplyRequestDto' });

const AgentOperationPlanApplyResponseSchema = z
  .object({
    status: AgentOperationApplyStatusSchema,
    plan: AgentOperationPlanResponseSchema,
    appliedOperationIds: z.array(uuid),
    skippedOperationIds: z.array(uuid),
    failedOperationIds: z.array(uuid),
    summary,
  })
  .meta({ id: 'AgentOperationPlanApplyResponseDto' });
```

Export the DTO classes at the bottom:

```ts
export class AgentOperationPlanApplyRequestDto extends createZodDto(AgentOperationPlanApplyRequestSchema) {}
export class AgentOperationPlanApplyResponseDto extends createZodDto(AgentOperationPlanApplyResponseSchema) {}
```

- [ ] **Step 6: Run DTO tests**

Run:

```bash
pnpm --dir server test src/dtos/agent-operation.dto.spec.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add server/src/enum.ts server/src/types/agent-operation.types.ts server/src/dtos/agent-operation.dto.ts server/src/dtos/agent-operation.dto.spec.ts
git commit -m "feat(server): add agent operation apply dto contracts"
```

---

### Task 2: Persist Apply Claims And Operation Results

**Files:**

- Modify: `server/test/medium/specs/repositories/agent-operation-plan.repository.spec.ts`
- Modify: `server/src/repositories/agent-operation-plan.repository.ts`

- [ ] **Step 1: Write failing repository medium tests**

Add these tests to `server/test/medium/specs/repositories/agent-operation-plan.repository.spec.ts`:

```ts
it('claims a current proposed plan for apply by marking it applied', async () => {
  const { ctx, credentialRepository, sessionRepository, sut } = setup();
  const { session } = await createSession(ctx, credentialRepository, sessionRepository);
  const plan = await sut.createRevision(
    planRevisionInput(session.id, {
      revision: 1,
      summary: 'Apply me',
      operations: [createAlbumOperation('apply-album'), addAssetsOperation('apply-album')],
    }),
  );

  const claimed = await sut.claimCurrentForApply(session.id, plan.id);

  expect(claimed).toMatchObject({
    id: plan.id,
    sessionId: session.id,
    status: AgentOperationPlanStatus.Applied,
  });
  expect(claimed?.operations.map((operation) => operation.id)).toEqual(
    plan.operations.map((operation) => operation.id),
  );
  await expect(sut.getCurrentBySessionId(session.id)).resolves.toBeUndefined();
});

it('does not claim an already applied plan twice', async () => {
  const { ctx, credentialRepository, sessionRepository, sut } = setup();
  const { session } = await createSession(ctx, credentialRepository, sessionRepository);
  const plan = await sut.createRevision(
    planRevisionInput(session.id, {
      revision: 1,
      summary: 'Apply once',
      operations: [createAlbumOperation('once-album')],
    }),
  );

  await expect(sut.claimCurrentForApply(session.id, plan.id)).resolves.toMatchObject({ id: plan.id });
  await expect(sut.claimCurrentForApply(session.id, plan.id)).resolves.toBeUndefined();
});

it('persists operation apply statuses, results, and errors', async () => {
  const { ctx, credentialRepository, sessionRepository, sut } = setup();
  const { session } = await createSession(ctx, credentialRepository, sessionRepository);
  const plan = await sut.createRevision(
    planRevisionInput(session.id, {
      revision: 1,
      summary: 'Persist results',
      operations: [createAlbumOperation('result-album'), addAssetsOperation('result-album')],
    }),
  );
  const [createOperation, addOperation] = plan.operations;
  await sut.claimCurrentForApply(session.id, plan.id);

  const updated = await sut.completeApply(plan.id, [
    {
      id: createOperation.id,
      status: AgentOperationStatus.Applied,
      result: { albumId: factory.uuid() },
      error: null,
    },
    {
      id: addOperation.id,
      status: AgentOperationStatus.Skipped,
      result: { skippedReason: 'Dependency was not applied' },
      error: null,
    },
  ]);

  expect(updated.status).toBe(AgentOperationPlanStatus.Applied);
  expect(updated.operations).toEqual([
    expect.objectContaining({ id: createOperation.id, status: AgentOperationStatus.Applied, error: null }),
    expect.objectContaining({
      id: addOperation.id,
      status: AgentOperationStatus.Skipped,
      result: { skippedReason: 'Dependency was not applied' },
    }),
  ]);
});
```

- [ ] **Step 2: Run repository medium tests and verify they fail**

Run:

```bash
pnpm --dir server test:medium test/medium/specs/repositories/agent-operation-plan.repository.spec.ts
```

Expected: FAIL because `claimCurrentForApply()` and `completeApply()` do not exist.

- [ ] **Step 3: Add repository update types**

In `server/src/repositories/agent-operation-plan.repository.ts`, extend the type import from `src/types/agent-operation.types`:

```ts
import { AgentAlbumOperationInput, AgentOperationResult } from 'src/types/agent-operation.types';
```

Add this type near the existing repository DTO types:

```ts
export type AgentOperationApplyUpdate = {
  id: string;
  status: AgentOperationStatus;
  result: AgentOperationResult | null;
  error: string | null;
};
```

- [ ] **Step 4: Implement apply claim and result persistence**

Add these public methods to `AgentOperationPlanRepository`:

```ts
  async claimCurrentForApply(
    sessionId: string,
    planId: string,
  ): Promise<AgentOperationPlanWithOperations | undefined> {
    return this.db.transaction().execute(async (trx) => {
      await this.lockSession(trx, sessionId);
      const plan = await trx
        .selectFrom('agent_operation_plan')
        .select(columns.agentOperationPlan)
        .where('sessionId', '=', asUuid(sessionId))
        .where('id', '=', asUuid(planId))
        .where('status', '=', AgentOperationPlanStatus.Proposed)
        .forUpdate()
        .executeTakeFirst();

      if (!plan) {
        return undefined;
      }

      const appliedPlan = await trx
        .updateTable('agent_operation_plan')
        .set({ status: AgentOperationPlanStatus.Applied })
        .where('id', '=', asUuid(plan.id))
        .returning(columns.agentOperationPlan)
        .executeTakeFirstOrThrow();

      return this.withOperationsFrom(trx, appliedPlan);
    });
  }

  async completeApply(planId: string, updates: AgentOperationApplyUpdate[]) {
    return this.db.transaction().execute(async (trx) => {
      for (const update of updates) {
        await trx
          .updateTable('agent_operation')
          .set({
            status: update.status,
            result: update.result,
            error: update.error,
          })
          .where('planId', '=', asUuid(planId))
          .where('id', '=', asUuid(update.id))
          .execute();
      }

      const plan = await trx
        .selectFrom('agent_operation_plan')
        .select(columns.agentOperationPlan)
        .where('id', '=', asUuid(planId))
        .executeTakeFirstOrThrow();

      return this.withOperationsFrom(trx, plan);
    });
  }
```

Replace the existing `withOperations()` body with a transaction-capable helper:

```ts
  private withOperations(plan: AgentOperationPlanRow): Promise<AgentOperationPlanWithOperations> {
    return this.withOperationsFrom(this.db, plan);
  }

  private async withOperationsFrom(
    db: DatabaseOrTransaction,
    plan: AgentOperationPlanRow,
  ): Promise<AgentOperationPlanWithOperations> {
    const operations = await db
      .selectFrom('agent_operation')
      .select(columns.agentOperation)
      .where('planId', '=', asUuid(plan.id))
      .orderBy('position', 'asc')
      .execute();

    return { ...plan, operations };
  }
```

- [ ] **Step 5: Run repository medium tests**

Run:

```bash
pnpm --dir server test:medium test/medium/specs/repositories/agent-operation-plan.repository.spec.ts
```

Expected: PASS.

- [ ] **Step 6: Run the repository SQL snapshot guard**

Run:

```bash
pnpm --dir server sql:generate
git diff -- server/src/queries/agent.operation.plan.repository.sql
```

Expected: command exits `0`; `agent.operation.plan.repository.sql` has no diff. The new apply repository paths run inside transactions and are covered by the medium repository tests instead of generated SQL snapshots.

- [ ] **Step 7: Commit**

```bash
git add server/src/repositories/agent-operation-plan.repository.ts server/test/medium/specs/repositories/agent-operation-plan.repository.spec.ts
git commit -m "feat(server): persist agent operation apply results"
```

---

### Task 3: Apply Operations Through AlbumService

**Files:**

- Modify: `server/src/services/agent-operation-plan.service.spec.ts`
- Modify: `server/src/services/agent-operation-plan.service.ts`
- Modify: `server/src/repositories/websocket.repository.ts`

- [ ] **Step 1: Write failing service tests**

In `server/src/services/agent-operation-plan.service.spec.ts`, add imports:

```ts
import { BulkIdErrorReason } from 'src/dtos/asset-ids.response.dto';
import { AgentOperationApplyStatus } from 'src/enum';
import { AlbumService } from 'src/services/album.service';
```

Extend the test-utils import:

```ts
import { automock, mockBaseService } from 'test/utils';
```

Add an `albumService` mock in the `describe` block:

```ts
let albumService: ReturnType<typeof automock<AlbumService>>;
```

Create it in `beforeEach()` before `sut`:

```ts
albumService = mockBaseService(AlbumService);
```

Pass it to the service constructor immediately after `assetRepository`:

```ts
      albumService,
```

Add these tests after the existing `summarizes the current plan` test:

```ts
it('applies selected album operations in stored order and marks the session completed', async () => {
  const auth = AuthFactory.create();
  const session = makeSession({ userId: auth.user.id, status: AgentSessionStatus.WaitingForPlanReview });
  const albumId = newUuid();
  const assetId = newUuid();
  const createOperation = makeOperation({
    id: newUuid(),
    planId: 'plan-id',
    position: 0,
    type: AgentOperationType.AlbumCreate,
    temporaryTargetId: 'tmp-portugal',
    payload: { albumName: 'Portugal', description: 'Lisbon and Porto' },
  });
  const addOperation = makeOperation({
    id: newUuid(),
    planId: 'plan-id',
    position: 1,
    type: AgentOperationType.AlbumAddAssets,
    targetKind: AgentOperationTargetKind.NewAlbum,
    temporaryTargetId: 'tmp-portugal',
    assetIds: [assetId],
    payload: {},
    dependencyIds: [createOperation.id],
  });
  const plan = makePlan({ id: 'plan-id', sessionId: session.id, operations: [createOperation, addOperation] });
  const appliedPlan = makePlan({
    ...plan,
    status: AgentOperationPlanStatus.Applied,
    operations: [
      { ...createOperation, status: AgentOperationStatus.Applied, result: { albumId } },
      { ...addOperation, status: AgentOperationStatus.Applied, result: { albumId, assetIds: [assetId] } },
    ],
  });
  sessionRepository.getById.mockResolvedValue(session);
  planRepository.getByIdForSession.mockResolvedValue(plan);
  planRepository.getCurrentBySessionId.mockResolvedValue(plan);
  planRepository.claimCurrentForApply.mockResolvedValue({ ...plan, status: AgentOperationPlanStatus.Applied });
  planRepository.completeApply.mockResolvedValue(appliedPlan);
  accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set([assetId]));
  assetRepository.getAgentReadableIds.mockResolvedValue(new Set([assetId]));
  albumService.create.mockResolvedValue({ id: albumId } as never);
  albumService.addAssets.mockResolvedValue([{ id: assetId, success: true }]);

  const result = await sut.applyApprovedOperations(auth, session.id, plan.id, {
    operationIds: [createOperation.id, addOperation.id],
  });

  expect(result).toMatchObject({
    status: AgentOperationApplyStatus.Applied,
    appliedOperationIds: [createOperation.id, addOperation.id],
    skippedOperationIds: [],
    failedOperationIds: [],
    plan: { id: plan.id, status: AgentOperationPlanStatus.Applied },
  });
  expect(sessionRepository.update).toHaveBeenNthCalledWith(1, auth.user.id, session.id, {
    status: AgentSessionStatus.Applying,
  });
  expect(albumService.create).toHaveBeenCalledWith(auth, {
    albumName: 'Portugal',
    description: 'Lisbon and Porto',
    assetIds: [],
  });
  expect(albumService.addAssets).toHaveBeenCalledWith(auth, albumId, { ids: [assetId] });
  expect(planRepository.completeApply).toHaveBeenCalledWith(plan.id, [
    expect.objectContaining({ id: createOperation.id, status: AgentOperationStatus.Applied }),
    expect.objectContaining({ id: addOperation.id, status: AgentOperationStatus.Applied }),
  ]);
  expect(sessionRepository.update).toHaveBeenLastCalledWith(auth.user.id, session.id, {
    status: AgentSessionStatus.Completed,
    endedAt: expect.any(Date),
  });
  expect(websocketRepository.clientSend).toHaveBeenCalledWith('on_agent_session_event', auth.user.id, {
    type: 'operation-plan-applied',
    sessionId: session.id,
    planId: plan.id,
    status: AgentOperationApplyStatus.Applied,
    appliedCount: 2,
    skippedCount: 0,
    failedCount: 0,
  });
});

it('skips unselected operations and selected dependents whose dependency was not applied', async () => {
  const auth = AuthFactory.create();
  const session = makeSession({ userId: auth.user.id, status: AgentSessionStatus.WaitingForPlanReview });
  const createOperation = makeOperation({ id: newUuid(), planId: 'plan-id', temporaryTargetId: 'tmp-portugal' });
  const addOperation = makeOperation({
    id: newUuid(),
    planId: 'plan-id',
    position: 1,
    type: AgentOperationType.AlbumAddAssets,
    targetKind: AgentOperationTargetKind.NewAlbum,
    temporaryTargetId: 'tmp-portugal',
    assetIds: [newUuid()],
    payload: {},
    dependencyIds: [createOperation.id],
  });
  const plan = makePlan({ id: 'plan-id', sessionId: session.id, operations: [createOperation, addOperation] });
  sessionRepository.getById.mockResolvedValue(session);
  planRepository.getByIdForSession.mockResolvedValue(plan);
  planRepository.getCurrentBySessionId.mockResolvedValue(plan);
  planRepository.claimCurrentForApply.mockResolvedValue({ ...plan, status: AgentOperationPlanStatus.Applied });
  planRepository.completeApply.mockResolvedValue({
    ...plan,
    status: AgentOperationPlanStatus.Applied,
    operations: [
      {
        ...createOperation,
        status: AgentOperationStatus.Skipped,
        result: { skippedReason: 'Operation was not selected for apply' },
      },
      {
        ...addOperation,
        status: AgentOperationStatus.Skipped,
        result: { skippedReason: 'Dependency was not applied' },
      },
    ],
  });

  const result = await sut.applyApprovedOperations(auth, session.id, plan.id, { operationIds: [addOperation.id] });

  expect(result.status).toBe(AgentOperationApplyStatus.Failed);
  expect(result.appliedOperationIds).toEqual([]);
  expect(result.skippedOperationIds).toEqual([createOperation.id, addOperation.id]);
  expect(albumService.create).not.toHaveBeenCalled();
  expect(albumService.addAssets).not.toHaveBeenCalled();
});

it('rejects unknown operation ids before claiming the plan', async () => {
  const auth = AuthFactory.create();
  const session = makeSession({ userId: auth.user.id, status: AgentSessionStatus.WaitingForPlanReview });
  const plan = makePlan({ sessionId: session.id });
  sessionRepository.getById.mockResolvedValue(session);
  planRepository.getByIdForSession.mockResolvedValue(plan);
  planRepository.getCurrentBySessionId.mockResolvedValue(plan);

  await expect(sut.applyApprovedOperations(auth, session.id, plan.id, { operationIds: [newUuid()] })).rejects.toThrow(
    'One or more operation ids are not in the current plan',
  );
  expect(planRepository.claimCurrentForApply).not.toHaveBeenCalled();
  expect(albumService.create).not.toHaveBeenCalled();
});

it('rejects non-current plans before claiming the plan', async () => {
  const auth = AuthFactory.create();
  const session = makeSession({ userId: auth.user.id, status: AgentSessionStatus.WaitingForPlanReview });
  const staleOperation = makeOperation();
  const stalePlan = makePlan({ id: newUuid(), sessionId: session.id, operations: [staleOperation] });
  const currentPlan = makePlan({ id: newUuid(), sessionId: session.id, revision: 2 });
  sessionRepository.getById.mockResolvedValue(session);
  planRepository.getByIdForSession.mockResolvedValue(stalePlan);
  planRepository.getCurrentBySessionId.mockResolvedValue(currentPlan);

  await expect(
    sut.applyApprovedOperations(auth, session.id, stalePlan.id, { operationIds: [staleOperation.id] }),
  ).rejects.toBeInstanceOf(NotFoundException);
  expect(planRepository.claimCurrentForApply).not.toHaveBeenCalled();
  expect(albumService.create).not.toHaveBeenCalled();
});

it('rejects stored-disabled operation ids before claiming the plan', async () => {
  const auth = AuthFactory.create();
  const session = makeSession({ userId: auth.user.id, status: AgentSessionStatus.WaitingForPlanReview });
  const disabledOperation = makeOperation({ enabled: false });
  const plan = makePlan({ sessionId: session.id, operations: [disabledOperation] });
  sessionRepository.getById.mockResolvedValue(session);
  planRepository.getByIdForSession.mockResolvedValue(plan);
  planRepository.getCurrentBySessionId.mockResolvedValue(plan);

  await expect(
    sut.applyApprovedOperations(auth, session.id, plan.id, { operationIds: [disabledOperation.id] }),
  ).rejects.toThrow('One or more operation ids are disabled in the current plan');
  expect(planRepository.claimCurrentForApply).not.toHaveBeenCalled();
  expect(albumService.create).not.toHaveBeenCalled();
});

it('rejects apply requests unless the session is waiting for plan review', async () => {
  const auth = AuthFactory.create();
  const session = makeSession({ userId: auth.user.id, status: AgentSessionStatus.Running });
  const operation = makeOperation();
  const plan = makePlan({ sessionId: session.id, operations: [operation] });
  sessionRepository.getById.mockResolvedValue(session);
  planRepository.getByIdForSession.mockResolvedValue(plan);
  planRepository.getCurrentBySessionId.mockResolvedValue(plan);

  await expect(
    sut.applyApprovedOperations(auth, session.id, plan.id, { operationIds: [operation.id] }),
  ).rejects.toThrow('Agent session is not waiting for plan review');
  expect(planRepository.claimCurrentForApply).not.toHaveBeenCalled();
  expect(albumService.create).not.toHaveBeenCalled();
});

it('does not mutate albums when the apply claim loses a race after validation', async () => {
  const auth = AuthFactory.create();
  const session = makeSession({ userId: auth.user.id, status: AgentSessionStatus.WaitingForPlanReview });
  const operation = makeOperation();
  const plan = makePlan({ sessionId: session.id, operations: [operation] });
  sessionRepository.getById.mockResolvedValue(session);
  planRepository.getByIdForSession.mockResolvedValue(plan);
  planRepository.getCurrentBySessionId.mockResolvedValue(plan);
  planRepository.claimCurrentForApply.mockResolvedValue(void 0);

  await expect(
    sut.applyApprovedOperations(auth, session.id, plan.id, { operationIds: [operation.id] }),
  ).rejects.toBeInstanceOf(NotFoundException);
  expect(sessionRepository.update).not.toHaveBeenCalledWith(auth.user.id, session.id, {
    status: AgentSessionStatus.Applying,
  });
  expect(albumService.create).not.toHaveBeenCalled();
  expect(planRepository.completeApply).not.toHaveBeenCalled();
});

it('applies existing-album detail and cover operations through AlbumService.update', async () => {
  const auth = AuthFactory.create();
  const session = makeSession({ userId: auth.user.id, status: AgentSessionStatus.WaitingForPlanReview });
  const albumId = newUuid();
  const coverAssetId = newUuid();
  const updateOperation = makeOperation({
    id: newUuid(),
    planId: 'plan-id',
    type: AgentOperationType.AlbumUpdateDetails,
    targetKind: AgentOperationTargetKind.ExistingAlbum,
    targetId: albumId,
    temporaryTargetId: null,
    payload: { albumName: 'Portugal highlights', description: 'Edited description' },
  });
  const coverOperation = makeOperation({
    id: newUuid(),
    planId: 'plan-id',
    position: 1,
    type: AgentOperationType.AlbumSetCover,
    targetKind: AgentOperationTargetKind.ExistingAlbum,
    targetId: albumId,
    temporaryTargetId: null,
    assetIds: [coverAssetId],
    payload: {},
  });
  const plan = makePlan({ id: 'plan-id', sessionId: session.id, operations: [updateOperation, coverOperation] });
  const appliedPlan = makePlan({
    ...plan,
    status: AgentOperationPlanStatus.Applied,
    operations: [
      { ...updateOperation, status: AgentOperationStatus.Applied, result: { albumId } },
      { ...coverOperation, status: AgentOperationStatus.Applied, result: { albumId, assetIds: [coverAssetId] } },
    ],
  });
  sessionRepository.getById.mockResolvedValue(session);
  planRepository.getByIdForSession.mockResolvedValue(plan);
  planRepository.getCurrentBySessionId.mockResolvedValue(plan);
  planRepository.claimCurrentForApply.mockResolvedValue({ ...plan, status: AgentOperationPlanStatus.Applied });
  planRepository.completeApply.mockResolvedValue(appliedPlan);
  accessRepository.album.checkOwnerAccess.mockResolvedValue(new Set([albumId]));
  accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set([coverAssetId]));
  assetRepository.getAgentReadableIds.mockResolvedValue(new Set([coverAssetId]));
  albumService.update.mockResolvedValue({ id: albumId } as never);

  await expect(
    sut.applyApprovedOperations(auth, session.id, plan.id, {
      operationIds: [updateOperation.id, coverOperation.id],
    }),
  ).resolves.toMatchObject({ status: AgentOperationApplyStatus.Applied });
  expect(albumService.update).toHaveBeenNthCalledWith(1, auth, albumId, {
    albumName: 'Portugal highlights',
    description: 'Edited description',
  });
  expect(albumService.update).toHaveBeenNthCalledWith(2, auth, albumId, { albumThumbnailAssetId: coverAssetId });
});

it('reports partial success when one independent selected operation applies and another fails', async () => {
  const auth = AuthFactory.create();
  const session = makeSession({ userId: auth.user.id, status: AgentSessionStatus.WaitingForPlanReview });
  const albumId = newUuid();
  const createOperation = makeOperation({ id: newUuid(), planId: 'plan-id', temporaryTargetId: 'tmp-portugal' });
  const updateOperation = makeOperation({
    id: newUuid(),
    planId: 'plan-id',
    position: 1,
    type: AgentOperationType.AlbumUpdateDetails,
    targetKind: AgentOperationTargetKind.ExistingAlbum,
    targetId: albumId,
    temporaryTargetId: null,
    payload: { albumName: 'Existing renamed' },
  });
  const plan = makePlan({ id: 'plan-id', sessionId: session.id, operations: [createOperation, updateOperation] });
  sessionRepository.getById.mockResolvedValue(session);
  planRepository.getByIdForSession.mockResolvedValue(plan);
  planRepository.getCurrentBySessionId.mockResolvedValue(plan);
  planRepository.claimCurrentForApply.mockResolvedValue({ ...plan, status: AgentOperationPlanStatus.Applied });
  planRepository.completeApply.mockResolvedValue({
    ...plan,
    status: AgentOperationPlanStatus.Applied,
    operations: [
      { ...createOperation, status: AgentOperationStatus.Applied, result: { albumId: newUuid() } },
      { ...updateOperation, status: AgentOperationStatus.Failed, error: 'album update failed' },
    ],
  });
  accessRepository.album.checkOwnerAccess.mockResolvedValue(new Set([albumId]));
  albumService.create.mockResolvedValue({ id: newUuid() } as never);
  albumService.update.mockRejectedValue(new Error('album update failed'));

  const result = await sut.applyApprovedOperations(auth, session.id, plan.id, {
    operationIds: [createOperation.id, updateOperation.id],
  });

  expect(result.status).toBe(AgentOperationApplyStatus.PartiallyApplied);
  expect(result.appliedOperationIds).toEqual([createOperation.id]);
  expect(result.failedOperationIds).toEqual([updateOperation.id]);
});

it('records album add-asset bulk failures without treating failed assets as applied', async () => {
  const auth = AuthFactory.create();
  const session = makeSession({ userId: auth.user.id, status: AgentSessionStatus.WaitingForPlanReview });
  const albumId = newUuid();
  const successfulAssetId = newUuid();
  const failedAssetId = newUuid();
  const addOperation = makeOperation({
    id: newUuid(),
    planId: 'plan-id',
    type: AgentOperationType.AlbumAddAssets,
    targetKind: AgentOperationTargetKind.ExistingAlbum,
    targetId: albumId,
    temporaryTargetId: null,
    assetIds: [successfulAssetId, failedAssetId],
    payload: {},
  });
  const plan = makePlan({ id: 'plan-id', sessionId: session.id, operations: [addOperation] });
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
        status: AgentOperationStatus.Failed,
        result: {
          albumId,
          assetIds: [successfulAssetId],
          assetResults: [
            { id: successfulAssetId, success: true },
            { id: failedAssetId, success: false, error: BulkIdErrorReason.DUPLICATE },
          ],
        },
        error: 'Failed to add 1 asset(s)',
      },
    ],
  });
  accessRepository.album.checkOwnerAccess.mockResolvedValue(new Set([albumId]));
  accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set([successfulAssetId, failedAssetId]));
  assetRepository.getAgentReadableIds.mockResolvedValue(new Set([successfulAssetId, failedAssetId]));
  albumService.addAssets.mockResolvedValue([
    { id: successfulAssetId, success: true },
    { id: failedAssetId, success: false, error: BulkIdErrorReason.DUPLICATE },
  ]);

  const result = await sut.applyApprovedOperations(auth, session.id, plan.id, { operationIds: [addOperation.id] });

  expect(result.status).toBe(AgentOperationApplyStatus.Failed);
  expect(result.failedOperationIds).toEqual([addOperation.id]);
  expect(planRepository.completeApply).toHaveBeenCalledWith(plan.id, [
    expect.objectContaining({
      id: addOperation.id,
      status: AgentOperationStatus.Failed,
      result: expect.objectContaining({ assetIds: [successfulAssetId] }),
      error: 'Failed to add 1 asset(s)',
    }),
  ]);
});

it('persists a partial failure and skips dependents when an album mutation fails', async () => {
  const auth = AuthFactory.create();
  const session = makeSession({ userId: auth.user.id, status: AgentSessionStatus.WaitingForPlanReview });
  const createOperation = makeOperation({ id: newUuid(), planId: 'plan-id', temporaryTargetId: 'tmp-portugal' });
  const addOperation = makeOperation({
    id: newUuid(),
    planId: 'plan-id',
    position: 1,
    type: AgentOperationType.AlbumAddAssets,
    targetKind: AgentOperationTargetKind.NewAlbum,
    temporaryTargetId: 'tmp-portugal',
    assetIds: [newUuid()],
    payload: {},
    dependencyIds: [createOperation.id],
  });
  const plan = makePlan({ id: 'plan-id', sessionId: session.id, operations: [createOperation, addOperation] });
  sessionRepository.getById.mockResolvedValue(session);
  planRepository.getByIdForSession.mockResolvedValue(plan);
  planRepository.getCurrentBySessionId.mockResolvedValue(plan);
  planRepository.claimCurrentForApply.mockResolvedValue({ ...plan, status: AgentOperationPlanStatus.Applied });
  planRepository.completeApply.mockResolvedValue({
    ...plan,
    status: AgentOperationPlanStatus.Applied,
    operations: [
      { ...createOperation, status: AgentOperationStatus.Failed, error: 'album create failed' },
      {
        ...addOperation,
        status: AgentOperationStatus.Skipped,
        result: { skippedReason: 'Dependency was not applied' },
      },
    ],
  });
  albumService.create.mockRejectedValue(new Error('album create failed'));

  const result = await sut.applyApprovedOperations(auth, session.id, plan.id, {
    operationIds: [createOperation.id, addOperation.id],
  });

  expect(result.status).toBe(AgentOperationApplyStatus.Failed);
  expect(result.failedOperationIds).toEqual([createOperation.id]);
  expect(result.skippedOperationIds).toEqual([addOperation.id]);
  expect(planRepository.completeApply).toHaveBeenCalledWith(plan.id, [
    expect.objectContaining({
      id: createOperation.id,
      status: AgentOperationStatus.Failed,
      error: 'album create failed',
    }),
    expect.objectContaining({ id: addOperation.id, status: AgentOperationStatus.Skipped }),
  ]);
});

it('fails only the drifted operation when apply-time asset access no longer passes', async () => {
  const auth = AuthFactory.create();
  const session = makeSession({ userId: auth.user.id, status: AgentSessionStatus.WaitingForPlanReview });
  const assetId = newUuid();
  const albumId = newUuid();
  const addOperation = makeOperation({
    id: newUuid(),
    planId: 'plan-id',
    type: AgentOperationType.AlbumAddAssets,
    targetKind: AgentOperationTargetKind.ExistingAlbum,
    targetId: albumId,
    assetIds: [assetId],
    payload: {},
  });
  const plan = makePlan({ id: 'plan-id', sessionId: session.id, operations: [addOperation] });
  sessionRepository.getById.mockResolvedValue(session);
  planRepository.getByIdForSession.mockResolvedValue(plan);
  planRepository.getCurrentBySessionId.mockResolvedValue(plan);
  planRepository.claimCurrentForApply.mockResolvedValue({ ...plan, status: AgentOperationPlanStatus.Applied });
  planRepository.completeApply.mockResolvedValue({
    ...plan,
    status: AgentOperationPlanStatus.Applied,
    operations: [
      { ...addOperation, status: AgentOperationStatus.Failed, error: 'One or more assets are not accessible' },
    ],
  });
  accessRepository.album.checkOwnerAccess.mockResolvedValue(new Set([albumId]));
  accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set());

  const result = await sut.applyApprovedOperations(auth, session.id, plan.id, { operationIds: [addOperation.id] });

  expect(result.status).toBe(AgentOperationApplyStatus.Failed);
  expect(albumService.addAssets).not.toHaveBeenCalled();
});

it('fails an apply-time asset check when a shared-space asset is locked by current policy', async () => {
  const auth = AuthFactory.create();
  const session = makeSession({
    userId: auth.user.id,
    status: AgentSessionStatus.WaitingForPlanReview,
    permissionPlanSnapshot: {
      ...permissionPlanSnapshot,
      assetScope: { owned: false, sharedSpaces: true, locked: false },
    },
  });
  const assetId = newUuid();
  const albumId = newUuid();
  const addOperation = makeOperation({
    id: newUuid(),
    planId: 'plan-id',
    type: AgentOperationType.AlbumAddAssets,
    targetKind: AgentOperationTargetKind.ExistingAlbum,
    targetId: albumId,
    assetIds: [assetId],
    payload: {},
  });
  const plan = makePlan({ id: 'plan-id', sessionId: session.id, operations: [addOperation] });
  sessionRepository.getById.mockResolvedValue(session);
  planRepository.getByIdForSession.mockResolvedValue(plan);
  planRepository.getCurrentBySessionId.mockResolvedValue(plan);
  planRepository.claimCurrentForApply.mockResolvedValue({ ...plan, status: AgentOperationPlanStatus.Applied });
  planRepository.completeApply.mockResolvedValue({
    ...plan,
    status: AgentOperationPlanStatus.Applied,
    operations: [
      { ...addOperation, status: AgentOperationStatus.Failed, error: 'One or more assets are not accessible' },
    ],
  });
  accessRepository.album.checkSharedAlbumAccess.mockResolvedValue(new Set([albumId]));
  accessRepository.asset.checkSpaceAccess.mockResolvedValue(new Set([assetId]));
  assetRepository.getAgentLockedIds.mockResolvedValue(new Set([assetId]));
  assetRepository.getAgentReadableIds.mockResolvedValue(new Set());

  const result = await sut.applyApprovedOperations(auth, session.id, plan.id, { operationIds: [addOperation.id] });

  expect(result.status).toBe(AgentOperationApplyStatus.Failed);
  expect(albumService.addAssets).not.toHaveBeenCalled();
});

it('fails an existing-album operation when apply-time album access no longer passes', async () => {
  const auth = AuthFactory.create();
  const session = makeSession({ userId: auth.user.id, status: AgentSessionStatus.WaitingForPlanReview });
  const albumId = newUuid();
  const updateOperation = makeOperation({
    id: newUuid(),
    planId: 'plan-id',
    type: AgentOperationType.AlbumUpdateDetails,
    targetKind: AgentOperationTargetKind.ExistingAlbum,
    targetId: albumId,
    temporaryTargetId: null,
    payload: { description: 'Should not apply' },
  });
  const plan = makePlan({ id: 'plan-id', sessionId: session.id, operations: [updateOperation] });
  sessionRepository.getById.mockResolvedValue(session);
  planRepository.getByIdForSession.mockResolvedValue(plan);
  planRepository.getCurrentBySessionId.mockResolvedValue(plan);
  planRepository.claimCurrentForApply.mockResolvedValue({ ...plan, status: AgentOperationPlanStatus.Applied });
  planRepository.completeApply.mockResolvedValue({
    ...plan,
    status: AgentOperationPlanStatus.Applied,
    operations: [
      {
        ...updateOperation,
        status: AgentOperationStatus.Failed,
        error: 'One or more target albums are not accessible',
      },
    ],
  });
  accessRepository.album.checkOwnerAccess.mockResolvedValue(new Set());

  const result = await sut.applyApprovedOperations(auth, session.id, plan.id, {
    operationIds: [updateOperation.id],
  });

  expect(result.status).toBe(AgentOperationApplyStatus.Failed);
  expect(albumService.update).not.toHaveBeenCalled();
});

it('does not expose an apply path to the runner planning tools', () => {
  expect(Object.values(AgentToolName)).not.toContain('applyAlbumOperations');
});
```

- [ ] **Step 2: Run service tests and verify they fail**

Run:

```bash
pnpm --dir server test src/services/agent-operation-plan.service.spec.ts
```

Expected: FAIL because `applyApprovedOperations()` and the new constructor dependency do not exist.

- [ ] **Step 3: Add the websocket event type**

In `server/src/repositories/websocket.repository.ts`, extend `AgentSessionClientEvent`:

```ts
  | {
      type: 'operation-plan-applied';
      sessionId: string;
      planId: string;
      status: AgentOperationApplyStatus;
      appliedCount: number;
      skippedCount: number;
      failedCount: number;
    };
```

Add the import:

```ts
import { AgentOperationApplyStatus } from 'src/enum';
```

- [ ] **Step 4: Inject AlbumService**

In `server/src/services/agent-operation-plan.service.ts`, add imports:

```ts
import { BulkIdResponseDto } from 'src/dtos/asset-ids.response.dto';
import { AgentOperationPlanApplyRequestDto, AgentOperationPlanApplyResponseDto } from 'src/dtos/agent-operation.dto';
import { AgentOperationApplyStatus, AgentOperationStatus } from 'src/enum';
import { AgentOperationApplyUpdate } from 'src/repositories/agent-operation-plan.repository';
import { AlbumService } from 'src/services/album.service';
import { AgentOperationResult } from 'src/types/agent-operation.types';
```

Add `albumService` to the constructor after `assetRepository`:

```ts
    private readonly albumService: AlbumService,
```

- [ ] **Step 5: Implement the public apply method**

Add this method after `summarizePlan()`:

```ts
  async applyApprovedOperations(
    auth: AuthDto,
    sessionId: string,
    planId: string,
    dto: AgentOperationPlanApplyRequestDto,
  ): Promise<AgentOperationPlanApplyResponseDto> {
    const session = await this.getOwnedSession(auth, sessionId, { requireActive: true });
    if (session.status !== AgentSessionStatus.WaitingForPlanReview) {
      throw new BadRequestException('Agent session is not waiting for plan review');
    }

    const currentPlan = await this.requireCurrentProposedPlan(session.id, planId);
    this.validateApplyOperationIds(currentPlan, dto.operationIds);

    const claimedPlan = await this.planRepository.claimCurrentForApply(session.id, planId);
    if (!claimedPlan) {
      throw new NotFoundException('Agent operation plan not found');
    }

    await this.sessionRepository.update(auth.user.id, session.id, { status: AgentSessionStatus.Applying });

    const selectedOperationIds = new Set(dto.operationIds);
    const applyUpdates = await this.applyClaimedPlan(auth, session, claimedPlan, selectedOperationIds);
    const appliedPlan = await this.planRepository.completeApply(claimedPlan.id, applyUpdates);
    const response = this.buildApplyResponse(this.mapPlan(appliedPlan), selectedOperationIds);

    await this.sessionRepository.update(auth.user.id, session.id, {
      status: AgentSessionStatus.Completed,
      endedAt: new Date(),
    });
    this.websocketRepository.clientSend('on_agent_session_event', auth.user.id, {
      type: 'operation-plan-applied',
      sessionId: session.id,
      planId: appliedPlan.id,
      status: response.status,
      appliedCount: response.appliedOperationIds.length,
      skippedCount: response.skippedOperationIds.length,
      failedCount: response.failedOperationIds.length,
    });

    return response;
  }
```

- [ ] **Step 6: Add apply validation and execution helpers**

Add these private helpers before `createPlanningAudit()`:

```ts
  private validateApplyOperationIds(plan: AgentOperationPlanWithOperations, operationIds: string[]) {
    const operationById = new Map(plan.operations.map((operation) => [operation.id, operation]));

    if (operationIds.some((operationId) => !operationById.has(operationId))) {
      throw new BadRequestException('One or more operation ids are not in the current plan');
    }

    if (operationIds.some((operationId) => operationById.get(operationId)?.enabled === false)) {
      throw new BadRequestException('One or more operation ids are disabled in the current plan');
    }
  }

  private async applyClaimedPlan(
    auth: AuthDto,
    session: AgentSession,
    plan: AgentOperationPlanWithOperations,
    selectedOperationIds: Set<string>,
  ): Promise<AgentOperationApplyUpdate[]> {
    const appliedOperationIds = new Set<string>();
    const createdAlbumIdByTemporaryTargetId = new Map<string, string>();
    const updates: AgentOperationApplyUpdate[] = [];

    for (const operation of plan.operations) {
      if (!selectedOperationIds.has(operation.id)) {
        updates.push(this.skippedOperation(operation.id, 'Operation was not selected for apply'));
        continue;
      }

      const dependencyApplied = operation.dependencyIds.every((dependencyId) => appliedOperationIds.has(dependencyId));
      if (!dependencyApplied) {
        updates.push(this.skippedOperation(operation.id, 'Dependency was not applied'));
        continue;
      }

      try {
        await this.validateApplyAccess(auth, session, operation);
        const update = await this.applySingleOperation(auth, operation, createdAlbumIdByTemporaryTargetId);
        updates.push(update);
        if (update.status === AgentOperationStatus.Applied) {
          appliedOperationIds.add(operation.id);
        }
      } catch (error) {
        updates.push({
          id: operation.id,
          status: AgentOperationStatus.Failed,
          result: null,
          error: error instanceof Error ? error.message : 'Agent operation apply failed',
        });
      }
    }

    return updates;
  }

  private async validateApplyAccess(
    auth: AuthDto,
    session: AgentSession,
    operation: AgentOperationPlanWithOperations['operations'][number],
  ) {
    this.validateWriteScope(session, operation.type);
    await this.validateNormalAccess(auth, session, [
      {
        type: operation.type,
        summary: operation.summary,
        targetKind: operation.targetKind,
        targetId: operation.targetId ?? undefined,
        temporaryTargetId: operation.temporaryTargetId ?? undefined,
        assetIds: operation.assetIds,
        payload: operation.payload,
        riskLevel: operation.riskLevel,
        enabled: operation.enabled,
      },
    ]);
  }

  private skippedOperation(id: string, skippedReason: string): AgentOperationApplyUpdate {
    return {
      id,
      status: AgentOperationStatus.Skipped,
      result: { skippedReason },
      error: null,
    };
  }
```

- [ ] **Step 7: Add per-operation album mutations**

Add these helpers after `validateApplyAccess()`:

```ts
  private async applySingleOperation(
    auth: AuthDto,
    operation: AgentOperationPlanWithOperations['operations'][number],
    createdAlbumIdByTemporaryTargetId: Map<string, string>,
  ): Promise<AgentOperationApplyUpdate> {
    switch (operation.type) {
      case AgentOperationType.AlbumCreate: {
        const payload = this.requireAlbumPayload(operation.payload, operation.summary);
        if (!payload.albumName) {
          throw new BadRequestException('album.create requires albumName');
        }

        const album = await this.albumService.create(auth, {
          albumName: payload.albumName,
          description: payload.description ?? '',
          assetIds: [],
        });
        if (operation.temporaryTargetId) {
          createdAlbumIdByTemporaryTargetId.set(operation.temporaryTargetId, album.id);
        }

        return this.appliedOperation(operation.id, { albumId: album.id });
      }

      case AgentOperationType.AlbumAddAssets: {
        const albumId = this.resolveTargetAlbumId(operation, createdAlbumIdByTemporaryTargetId);
        const results = await this.albumService.addAssets(auth, albumId, { ids: operation.assetIds });
        const successfulAssetIds = results.filter((result) => result.success).map((result) => result.id);
        const failedAssetCount = results.length - successfulAssetIds.length;

        if (failedAssetCount > 0) {
          return {
            id: operation.id,
            status: AgentOperationStatus.Failed,
            result: this.assetResult(albumId, successfulAssetIds, results),
            error: `Failed to add ${failedAssetCount} asset(s)`,
          };
        }

        return this.appliedOperation(operation.id, this.assetResult(albumId, successfulAssetIds, results));
      }

      case AgentOperationType.AlbumUpdateDetails: {
        const payload = this.requireAlbumPayload(operation.payload, operation.summary);
        const albumId = this.resolveTargetAlbumId(operation, createdAlbumIdByTemporaryTargetId);
        const album = await this.albumService.update(auth, albumId, {
          albumName: payload.albumName,
          description: payload.description,
        });

        return this.appliedOperation(operation.id, { albumId: album.id });
      }

      case AgentOperationType.AlbumSetCover: {
        const albumId = this.resolveTargetAlbumId(operation, createdAlbumIdByTemporaryTargetId);
        const [albumThumbnailAssetId] = operation.assetIds;
        if (!albumThumbnailAssetId) {
          throw new BadRequestException('album.setCover requires one asset id');
        }

        const album = await this.albumService.update(auth, albumId, { albumThumbnailAssetId });
        return this.appliedOperation(operation.id, { albumId: album.id, assetIds: [albumThumbnailAssetId] });
      }
    }
  }

  private appliedOperation(id: string, result: AgentOperationResult): AgentOperationApplyUpdate {
    return {
      id,
      status: AgentOperationStatus.Applied,
      result,
      error: null,
    };
  }

  private assetResult(albumId: string, assetIds: string[], assetResults: BulkIdResponseDto[]): AgentOperationResult {
    return {
      albumId,
      assetIds,
      assetResults: assetResults.map(({ id, success, error, errorMessage }) => ({ id, success, error, errorMessage })),
    };
  }

  private resolveTargetAlbumId(
    operation: AgentOperationPlanWithOperations['operations'][number],
    createdAlbumIdByTemporaryTargetId: Map<string, string>,
  ) {
    if (operation.targetId) {
      return operation.targetId;
    }

    if (operation.temporaryTargetId) {
      const albumId = createdAlbumIdByTemporaryTargetId.get(operation.temporaryTargetId);
      if (albumId) {
        return albumId;
      }
    }

    throw new BadRequestException(`No applied album exists for operation ${operation.id}`);
  }

  private requireAlbumPayload(payload: unknown, summary: string): { albumName?: string; description?: string } {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new BadRequestException(`Invalid album payload for ${summary}`);
    }

    const { albumName, description } = payload as { albumName?: unknown; description?: unknown };
    return {
      albumName: typeof albumName === 'string' ? albumName : undefined,
      description: typeof description === 'string' ? description : undefined,
    };
  }
```

- [ ] **Step 8: Build the apply response**

Add this helper after `mapPlan()`:

```ts
  private buildApplyResponse(
    plan: AgentOperationPlanResponseDto,
    selectedOperationIds: Set<string>,
  ): AgentOperationPlanApplyResponseDto {
    const appliedOperationIds = plan.operations
      .filter((operation) => operation.status === AgentOperationStatus.Applied)
      .map((operation) => operation.id);
    const skippedOperationIds = plan.operations
      .filter((operation) => operation.status === AgentOperationStatus.Skipped)
      .map((operation) => operation.id);
    const failedOperationIds = plan.operations
      .filter((operation) => operation.status === AgentOperationStatus.Failed)
      .map((operation) => operation.id);
    const selectedSkippedOperationIds = skippedOperationIds.filter((operationId) => selectedOperationIds.has(operationId));
    const status =
      appliedOperationIds.length === 0
        ? AgentOperationApplyStatus.Failed
        : failedOperationIds.length > 0 || selectedSkippedOperationIds.length > 0
          ? AgentOperationApplyStatus.PartiallyApplied
          : AgentOperationApplyStatus.Applied;

    return {
      status,
      plan,
      appliedOperationIds,
      skippedOperationIds,
      failedOperationIds,
      summary: `Applied ${appliedOperationIds.length} operation(s), skipped ${skippedOperationIds.length}, failed ${failedOperationIds.length}.`,
    };
  }
```

- [ ] **Step 9: Run service tests**

Run:

```bash
pnpm --dir server test src/services/agent-operation-plan.service.spec.ts
```

Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add server/src/services/agent-operation-plan.service.ts server/src/services/agent-operation-plan.service.spec.ts server/src/repositories/websocket.repository.ts
git commit -m "feat(server): apply approved agent album operations"
```

---

### Task 4: Expose The Browser Apply Endpoint

**Files:**

- Modify: `server/src/controllers/agent-operation-plan.controller.spec.ts`
- Modify: `server/src/controllers/agent-operation-plan.controller.ts`

- [ ] **Step 1: Write failing controller tests**

In `server/src/controllers/agent-operation-plan.controller.spec.ts`, extend DTO imports:

```ts
  AgentOperationPlanApplyRequestDto,
  AgentOperationPlanApplyResponseDto,
```

Extend enum imports:

```ts
  AgentOperationApplyStatus,
```

Add `['applyApprovedOperations', AgentOperationPlanApplyResponseDto, 'AgentOperationPlanApplyResponseDto', 201]` to the typed response DTO `it.each`.

Update the `automock(AgentOperationPlanService, { args: [...] })` setup at the top of the spec to pass seven constructor placeholders after adding `AlbumService` to the service constructor:

```ts
    args: [{} as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never],
```

Add this route test after the summary route tests:

```ts
describe('POST /agent/sessions/:id/operation-plan/:planId/apply', () => {
  const dto: AgentOperationPlanApplyRequestDto = { operationIds: [operationId] };

  it('applies approved operations with update permission and serializes dates', async () => {
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

    const { status, body } = await request(ctx.getHttpServer())
      .post(`/agent/sessions/${sessionId}/operation-plan/${planId}/apply`)
      .send(dto);

    expect(status).toBe(201);
    expectPermission(Permission.AgentSessionUpdate);
    expect(service.applyApprovedOperations).toHaveBeenCalledWith(auth, sessionId, planId, dto);
    expect(body.plan.createdAt).toBe(createdAt.toISOString());
    expect(body.plan.operations[0].createdAt).toBe(createdAt.toISOString());
  });

  it('validates apply params and body before calling the service', async () => {
    const { status } = await request(ctx.getHttpServer())
      .post(`/agent/sessions/${sessionId}/operation-plan/not-a-uuid/apply`)
      .send({ operationIds: [] });

    expect(status).toBe(400);
    expect(service.applyApprovedOperations).not.toHaveBeenCalled();
  });

  it('returns the apply response directly from the controller method', async () => {
    const response = {
      status: AgentOperationApplyStatus.Applied,
      plan: { ...plan, status: AgentOperationPlanStatus.Applied },
      appliedOperationIds: [operationId],
      skippedOperationIds: [],
      failedOperationIds: [],
      summary: 'Applied 1 operation(s), skipped 0, failed 0.',
    };
    service.applyApprovedOperations.mockResolvedValue(response);
    const controller = new AgentOperationPlanController(service);

    await expect(controller.applyApprovedOperations(auth, { id: sessionId, planId }, dto)).resolves.toBe(response);
  });
});
```

- [ ] **Step 2: Run controller tests and verify they fail**

Run:

```bash
pnpm --dir server test src/controllers/agent-operation-plan.controller.spec.ts
```

Expected: FAIL because the route and service method are not exposed by the controller.

- [ ] **Step 3: Implement the controller route**

In `server/src/controllers/agent-operation-plan.controller.ts`, import:

```ts
  AgentOperationPlanApplyRequestDto,
  AgentOperationPlanApplyResponseDto,
```

Add this method after `summarizePlan()`:

```ts
  @Post(':planId/apply')
  @Authenticated({ permission: Permission.AgentSessionUpdate })
  @ApiCreatedResponse({ type: AgentOperationPlanApplyResponseDto })
  @Endpoint({
    summary: 'Apply approved agent album operations',
    description: 'Apply selected album operations from the current proposed agent operation plan.',
    history: new HistoryBuilder().added('v2.7.5').alpha('v2.7.5'),
  })
  applyApprovedOperations(
    @Auth() auth: AuthDto,
    @Param() { id, planId }: AgentOperationPlanParamsDto,
    @Body() dto: AgentOperationPlanApplyRequestDto,
  ): Promise<AgentOperationPlanApplyResponseDto> {
    return this.service.applyApprovedOperations(auth, id, planId, dto);
  }
```

- [ ] **Step 4: Run controller tests**

Run:

```bash
pnpm --dir server test src/controllers/agent-operation-plan.controller.spec.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/controllers/agent-operation-plan.controller.ts server/src/controllers/agent-operation-plan.controller.spec.ts
git commit -m "feat(server): expose agent operation plan apply endpoint"
```

---

### Task 5: Regenerate API And SDK Artifacts

**Files:**

- Modify: `open-api/immich-openapi-specs.json`
- Modify: `open-api/typescript-sdk/src/fetch-client.ts`
- Modify: `open-api/typescript-sdk/build/fetch-client.js`
- Modify: `open-api/typescript-sdk/build/fetch-client.d.ts`
- Modify: `open-api/typescript-sdk/build/index.js`
- Modify: `open-api/typescript-sdk/build/index.d.ts`
- Modify: `mobile/openapi/**`

- [ ] **Step 1: Generate API artifacts**

Run:

```bash
make open-api
make open-api-typescript
make open-api-dart
```

Expected: commands exit `0`.

- [ ] **Step 2: Verify apply contracts are generated**

Run:

```bash
rg -n "AgentOperationPlanApplyRequestDto|AgentOperationPlanApplyResponseDto|AgentOperationApplyStatus|applyApprovedOperations" open-api/immich-openapi-specs.json open-api/typescript-sdk/src/fetch-client.ts open-api/typescript-sdk/build/fetch-client.d.ts mobile/openapi
```

Expected: matches in OpenAPI, TypeScript SDK source/types, and mobile generated artifacts.

- [ ] **Step 3: Build the SDK**

Run:

```bash
pnpm --filter @immich/sdk build
```

Expected: `tsc` exits `0`.

- [ ] **Step 4: Commit generated artifacts**

```bash
git add open-api/immich-openapi-specs.json open-api/typescript-sdk mobile/openapi
git commit -m "chore: regenerate agent operation apply api artifacts"
```

---

### Task 6: Wire Apply Into The Review Panel

**Files:**

- Modify: `web/src/lib/stores/websocket.ts`
- Modify: `web/src/routes/(user)/assistant/agent-operation-plan-review-panel.spec.ts`
- Modify: `web/src/routes/(user)/assistant/agent-operation-plan-review-panel.svelte`

- [ ] **Step 1: Write failing component tests**

In `web/src/routes/(user)/assistant/agent-operation-plan-review-panel.spec.ts`, add SDK imports:

```ts
  AgentOperationApplyStatus,
```

Add i18n mock messages:

```ts
    assistant_operation_apply_applying: 'Applying operations',
    assistant_operation_apply_error: 'Unable to apply proposed operations',
    assistant_operation_apply_selected: 'Apply {count} selected',
    assistant_operation_apply_success: 'Applied {applied} operations. {failed} failed.',
```

Update the mock formatter to replace `{applied}` and `{failed}`.

Add these tests before the websocket tests:

```ts
it('applies the current approved operation selection', async () => {
  sdkMock.getCurrentOperationPlan.mockResolvedValue(samplePlan());
  sdkMock.applyApprovedOperations.mockResolvedValue({
    status: AgentOperationApplyStatus.Applied,
    plan: {
      ...samplePlan(),
      status: AgentOperationPlanStatus.Applied,
      operations: samplePlan().operations.map((operation) => ({
        ...operation,
        status: AgentOperationStatus.Applied,
        result: { albumId: '00000000-0000-4000-8000-000000000400' },
      })),
    },
    appliedOperationIds: [createId, addId, existingId],
    skippedOperationIds: [],
    failedOperationIds: [],
    summary: 'Applied 3 operation(s), skipped 0, failed 0.',
  });

  render(AgentOperationPlanReviewPanel, { props: { session } });

  await fireEvent.click(await screen.findByRole('button', { name: 'Apply 3 selected' }));

  expect(sdkMock.applyApprovedOperations).toHaveBeenCalledWith({
    id: session.id,
    planId,
    agentOperationPlanApplyRequestDto: { operationIds: [createId, addId, existingId] },
  });
  expect(await screen.findByRole('status')).toHaveTextContent('Applied 3 operations. 0 failed.');
  expect(screen.getByRole('button', { name: 'Apply 3 selected' })).toBeDisabled();
});

it('sends only enabled and unblocked operation ids when applying', async () => {
  sdkMock.getCurrentOperationPlan.mockResolvedValue(samplePlan());
  sdkMock.applyApprovedOperations.mockResolvedValue({
    status: AgentOperationApplyStatus.PartiallyApplied,
    plan: samplePlan(),
    appliedOperationIds: [existingId],
    skippedOperationIds: [createId, addId],
    failedOperationIds: [],
    summary: 'Applied 1 operation(s), skipped 2, failed 0.',
  });

  render(AgentOperationPlanReviewPanel, { props: { session } });

  await fireEvent.click(await screen.findByRole('checkbox', { name: 'New album "Portugal"' }));
  await fireEvent.click(screen.getByRole('button', { name: 'Apply 1 selected' }));

  expect(sdkMock.applyApprovedOperations).toHaveBeenCalledWith(
    expect.objectContaining({
      agentOperationPlanApplyRequestDto: { operationIds: [existingId] },
    }),
  );
});

it('disables apply when no operations are selected', async () => {
  sdkMock.getCurrentOperationPlan.mockResolvedValue(samplePlan());

  render(AgentOperationPlanReviewPanel, { props: { session } });

  await fireEvent.click(await screen.findByRole('checkbox', { name: 'New album "Portugal"' }));
  await fireEvent.click(screen.getByRole('checkbox', { name: 'Update existing album description' }));

  expect(screen.getByRole('button', { name: 'Apply 0 selected' })).toBeDisabled();
  expect(sdkMock.applyApprovedOperations).not.toHaveBeenCalled();
});

it('shows an apply error without clearing the loaded plan', async () => {
  sdkMock.getCurrentOperationPlan.mockResolvedValue(samplePlan());
  sdkMock.applyApprovedOperations.mockRejectedValue(new Error('failed'));

  render(AgentOperationPlanReviewPanel, { props: { session } });

  await fireEvent.click(await screen.findByRole('button', { name: 'Apply 3 selected' }));

  expect(await screen.findByRole('alert')).toHaveTextContent('Unable to apply proposed operations');
  expect(screen.getByText('Organize Portugal holiday')).toBeInTheDocument();
});

it('refetches the current plan for same-session plan-applied events from another client', async () => {
  let handler: Parameters<typeof websocketMock.websocketEvents.on>[1] | undefined;
  websocketMock.websocketEvents.on.mockImplementation((_eventName, nextHandler) => {
    handler = nextHandler;
    return vi.fn();
  });
  sdkMock.getCurrentOperationPlan.mockResolvedValueOnce(samplePlan()).mockResolvedValueOnce(null);

  render(AgentOperationPlanReviewPanel, { props: { session } });
  expect(await screen.findByText('Organize Portugal holiday')).toBeInTheDocument();

  handler?.({
    type: 'operation-plan-applied',
    sessionId: session.id,
    planId,
    status: AgentOperationApplyStatus.Applied,
    appliedCount: 3,
    skippedCount: 0,
    failedCount: 0,
  });

  expect(await screen.findByText('No proposed album plan yet.')).toBeInTheDocument();
  expect(sdkMock.getCurrentOperationPlan).toHaveBeenCalledTimes(2);
});
```

- [ ] **Step 2: Run component tests and verify they fail**

Run:

```bash
pnpm --filter immich-web test -- --run -t "AgentOperationPlanReviewPanel"
```

Expected: FAIL because the apply button does not call the SDK.

- [ ] **Step 3: Add the web event type**

In `web/src/lib/stores/websocket.ts`, extend `AgentSessionClientEvent`:

```ts
  | {
      type: 'operation-plan-applied';
      sessionId: string;
      planId: string;
      status: AgentOperationApplyStatus;
      appliedCount: number;
      skippedCount: number;
      failedCount: number;
    };
```

Add the SDK type import:

```ts
  AgentOperationApplyStatus,
```

- [ ] **Step 4: Implement apply state and SDK call**

In `web/src/routes/(user)/assistant/agent-operation-plan-review-panel.svelte`, extend SDK imports:

```ts
    AgentOperationPlanStatus,
    applyApprovedOperations,
```

Add state:

```ts
let applying = $state(false);
let applyMessage = $state<string | null>(null);
let applyErrorMessage = $state<string | null>(null);
```

Add a derived apply guard:

```ts
const canApply = $derived(
  model !== null &&
    model.plan.status === AgentOperationPlanStatus.Proposed &&
    selectedOperationIds.length > 0 &&
    !applying,
);
```

Clear apply state in `loadPlan()` before calling `getCurrentOperationPlan()`:

```ts
applyMessage = null;
applyErrorMessage = null;
```

Add this function before `toggleOperation()`:

```ts
const applySelectedOperations = async () => {
  if (!model || !canApply) {
    return;
  }

  applying = true;
  errorMessage = null;
  applyMessage = null;
  applyErrorMessage = null;

  try {
    const response = await applyApprovedOperations({
      id: session.id,
      planId: model.plan.id,
      agentOperationPlanApplyRequestDto: { operationIds: selectedOperationIds },
    });
    plan = response.plan;
    enabledByOperationId = createInitialOperationEnabledState(response.plan);
    applyMessage = $t('assistant_operation_apply_success', {
      values: {
        applied: response.appliedOperationIds.length,
        failed: response.failedOperationIds.length,
      },
    });
  } catch (error) {
    applyErrorMessage = $t('assistant_operation_apply_error');
    handleError(error, applyErrorMessage);
  } finally {
    applying = false;
  }
};
```

Update `handleSessionEvent` so the panel refreshes for direct plan-ready events and for an apply event emitted by another browser tab:

```ts
const handleSessionEvent = (event: AgentSessionClientEvent) => {
  if (
    (event.type !== 'operation-plan-ready' && event.type !== 'operation-plan-applied') ||
    event.sessionId !== session.id
  ) {
    return;
  }

  void loadPlan();
};
```

Replace the disabled footer button with:

```svelte
      {#if applyErrorMessage}
        <p
          class="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-200"
          role="alert"
        >
          {applyErrorMessage}
        </p>
      {/if}

      {#if applyMessage}
        <p
          class="mt-4 rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-700 dark:border-green-900 dark:bg-green-950 dark:text-green-200"
          role="status"
        >
          {applyMessage}
        </p>
      {/if}

      <div class="mt-5">
        <Button type="button" disabled={!canApply} onclick={applySelectedOperations}>
          {applying
            ? $t('assistant_operation_apply_applying')
            : $t('assistant_operation_apply_selected', { values: { count: selectedOperationIds.length } })}
        </Button>
      </div>
```

- [ ] **Step 5: Run component tests**

Run:

```bash
pnpm --filter immich-web test -- --run -t "AgentOperationPlanReviewPanel"
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add web/src/lib/stores/websocket.ts web/src/routes/\(user\)/assistant/agent-operation-plan-review-panel.svelte web/src/routes/\(user\)/assistant/agent-operation-plan-review-panel.spec.ts
git commit -m "feat(web): apply selected assistant album operations"
```

---

### Task 7: Add Apply Translation Keys

**Files:**

- Create: `web/src/routes/(user)/assistant/agent-operation-plan-i18n.spec.ts`
- Modify: `i18n/en.json`
- Modify: `web/src/routes/(user)/assistant/agent-session-page-content.spec.ts`

- [ ] **Step 1: Write failing English-key coverage**

Create `web/src/routes/(user)/assistant/agent-operation-plan-i18n.spec.ts`:

```ts
import en from '$i18n/en.json';

describe('agent operation plan i18n', () => {
  it('defines the apply action English strings used by the review panel', () => {
    expect(en).toEqual(
      expect.objectContaining({
        assistant_operation_apply_applying: 'Applying operations',
        assistant_operation_apply_error: 'Unable to apply proposed operations',
        assistant_operation_apply_selected: 'Apply {count, plural, one {# selected} other {# selected}}',
        assistant_operation_apply_success: 'Applied {applied, number} operations. {failed, number} failed.',
      }),
    );
  });
});
```

- [ ] **Step 2: Run the i18n test and verify it fails**

Run:

```bash
pnpm --filter immich-web test -- --run -t "agent operation plan i18n"
```

Expected: FAIL because `i18n/en.json` does not contain the apply translation keys.

- [ ] **Step 3: Add English strings**

Add these keys near the existing `assistant_operation_*` keys in `i18n/en.json`:

```json
  "assistant_operation_apply_applying": "Applying operations",
  "assistant_operation_apply_error": "Unable to apply proposed operations",
  "assistant_operation_apply_selected": "Apply {count, plural, one {# selected} other {# selected}}",
  "assistant_operation_apply_success": "Applied {applied, number} operations. {failed, number} failed.",
```

- [ ] **Step 4: Update page-content i18n mock**

In `web/src/routes/(user)/assistant/agent-session-page-content.spec.ts`, add these messages to the local `svelte-i18n` mock:

```ts
    assistant_operation_apply_applying: 'Applying operations',
    assistant_operation_apply_error: 'Unable to apply proposed operations',
    assistant_operation_apply_selected: 'Apply {count} selected',
    assistant_operation_apply_success: 'Applied {applied} operations. {failed} failed.',
```

Extend the formatter options type to accept numbers and replace `{count}`, `{applied}`, and `{failed}`:

```ts
      options?: { values?: Record<string, string | number> },
```

```ts
        .replace('{count}', String(options?.values?.count ?? ''))
        .replace('{applied}', String(options?.values?.applied ?? ''))
        .replace('{failed}', String(options?.values?.failed ?? ''))
```

- [ ] **Step 5: Run focused web tests**

Run:

```bash
pnpm --filter immich-web test -- --run -t "i18n|AgentOperationPlanReviewPanel|mounts the operation plan review panel"
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add i18n/en.json web/src/routes/\(user\)/assistant/agent-operation-plan-i18n.spec.ts web/src/routes/\(user\)/assistant/agent-session-page-content.spec.ts
git commit -m "feat(web): add assistant operation apply translations"
```

---

### Task 8: Focused Verification

**Files:**

- No code changes unless verification finds a defect.

- [ ] **Step 1: Run focused server tests**

Run:

```bash
pnpm --dir server test src/dtos/agent-operation.dto.spec.ts src/services/agent-operation-plan.service.spec.ts src/controllers/agent-operation-plan.controller.spec.ts src/controllers/agent-runner-tool.controller.spec.ts
pnpm --dir server test:medium test/medium/specs/repositories/agent-operation-plan.repository.spec.ts
pnpm --dir agent-runner test
```

Expected: PASS.

- [ ] **Step 2: Run focused web tests**

Run:

```bash
pnpm --filter immich-web test -- --run -t "i18n|AgentOperationPlanReviewPanel|agent operation plan UI helpers|operation plan ready|mounts the operation plan review panel"
```

Expected: PASS.

- [ ] **Step 3: Run type checks**

Run:

```bash
pnpm --dir server typecheck
pnpm --filter immich-web run check:typescript
pnpm --filter immich-web run check:svelte
pnpm --filter @immich/sdk build
```

Expected: all commands exit `0`.

- [ ] **Step 4: Inspect the final diff**

Run:

```bash
git status --short
git diff --stat
git diff -- server/src/dtos/agent-operation.dto.ts server/src/services/agent-operation-plan.service.ts server/src/repositories/agent-operation-plan.repository.ts server/src/controllers/agent-operation-plan.controller.ts web/src/routes/\(user\)/assistant/agent-operation-plan-review-panel.svelte agent-runner/src
```

Expected:

- Server changes are limited to apply DTOs, repository persistence, service apply orchestration, controller route, websocket event typing, generated SQL if any, and tests.
- Web changes are limited to the review-panel apply action, websocket event typing, i18n mocks, and translations.
- Generated API artifacts contain the new browser apply endpoint and DTOs.
- `agent-runner/src` has no diff and no apply/write tool was added.

- [ ] **Step 5: Confirm slice boundaries**

Check the diff manually and confirm:

- The endpoint is user-authenticated with `Permission.AgentSessionUpdate`.
- The runner cannot call the apply endpoint through `AgentRunnerToolController`.
- The service rejects operation IDs that are not in the current plan before claiming the plan.
- The repository claims a proposed plan before album mutations, so repeat apply requests cannot write twice.
- Unselected operations are persisted as `skipped`.
- Selected dependents are skipped when dependencies were unselected, skipped, or failed.
- Album mutations go through `AlbumService.create()`, `AlbumService.addAssets()`, and `AlbumService.update()`.
- Apply-time access checks still use the session permission plan and normal Gallery access repositories.

- [ ] **Step 6: Commit verification-only fixes**

If a verification command fails because of this slice, fix the smallest owning task and commit with the matching scope. Leave unrelated local changes untouched.

---

## Self-Review

Spec coverage:

- Slice 13 server apply endpoint is covered by Tasks 1, 3, and 4.
- Apply-time permission/current-state revalidation is covered by Task 3 service tests and implementation.
- Album mutations execute through existing services in Task 3, with coverage for create, add assets, update details, and set cover.
- Partial failures are persisted in Task 3 and repository result persistence is covered in Task 2.
- Dependency handling is covered in Task 3 for unselected dependencies and failed dependencies.
- No unapproved writes are covered by unknown-ID validation, stored-disabled operation rejection, empty-payload rejection, unselected skips, dependency skips, and no runner apply tool.
- Web apply flow is covered by Task 6, including successful apply, filtered operation IDs, empty selection, apply errors, and cross-tab apply events.

Edge-case coverage:

| Edge Case                                                   | Covered By                                                                      |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Empty apply payload                                         | DTO and controller validation tests in Tasks 1 and 4                            |
| Duplicate operation IDs                                     | DTO validation test in Task 1                                                   |
| Operation ID not in current plan                            | Service validation test in Task 3                                               |
| Stored-disabled operation ID submitted by a tampered client | Service validation test in Task 3                                               |
| Stale/non-current plan ID                                   | Service current-plan validation test in Task 3                                  |
| Session not waiting for plan review                         | Service status validation test in Task 3                                        |
| Current plan changes between validation and claim           | Service claim-race test in Task 3 and repository no-double-claim test in Task 2 |
| Already-applied plan is applied again                       | Repository no-double-claim test in Task 2                                       |
| Unselected operations                                       | Service skip test in Task 3                                                     |
| Selected dependent whose dependency was not applied         | Service dependency skip test in Task 3                                          |
| Independent selected operation partially fails              | Service partial-success test in Task 3                                          |
| Bulk add-assets returns per-asset failure                   | Service bulk-result test in Task 3                                              |
| Existing album access drift or album deletion               | Service album-access drift test in Task 3                                       |
| Asset access drift                                          | Service asset-access drift test in Task 3                                       |
| Locked-asset policy change                                  | Service locked shared-space asset test in Task 3                                |
| Runner accidentally gains write/apply tool                  | Service enum assertion in Task 3 plus runner/controller verification in Task 8  |
| User clicks apply with zero selected operations             | Web component test in Task 6                                                    |
| Another tab applies the plan                                | Web websocket refresh test in Task 6                                            |

Placeholder scan:

- No placeholder-marker or deferred implementation steps remain.
- Every code-changing step names exact files and includes the code shape to add.

Type consistency:

- Apply request DTO is consistently named `AgentOperationPlanApplyRequestDto`.
- Apply response DTO is consistently named `AgentOperationPlanApplyResponseDto`.
- Generated SDK call is consistently expected as `applyApprovedOperations({ id, planId, agentOperationPlanApplyRequestDto })`.
- Apply status enum is consistently `AgentOperationApplyStatus`.

Execution handoff:

Plan complete and saved to `docs/superpowers/plans/2026-05-16-pi-agent-apply-approved-operations.md`. Two execution options:

1. **Subagent-Driven (recommended)** - dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** - execute tasks in this session using executing-plans, batch execution with checkpoints.
