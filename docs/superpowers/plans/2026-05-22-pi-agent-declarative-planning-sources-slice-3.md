# Pi Agent Declarative Planning Sources Slice 3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend `searchAssets(createSelectionHandle: true)` so Pi receives a typed `sourceRef` that points at the created search selection handle without copying raw asset IDs.

**Architecture:** Keep selection handles as the backing storage for Slice 3. Add `sourceRef` as a model-facing field on the existing `selectionHandle` response object, derived deterministically from the handle ID using the `asset-source:search:<token>` contract introduced in Slice 1. Do not add source-ref resolution or planning behavior until Slice 4.

**Tech Stack:** NestJS services, TypeScript, Zod DTO schemas, Vitest, existing `AgentSelectionHandleRepository`.

---

## Scope

This is Slice 3 from `docs/superpowers/specs/2026-05-22-pi-agent-declarative-planning-sources-design.md`.

Implement only:

- Add `sourceRef` to successful `searchAssets` responses when `createSelectionHandle: true`.
- Preserve the existing `selectionHandle.id`, counts, sample IDs, source tool call ID, and expiration.
- Ensure the `sourceRef` is typed as `asset-source:search:<token>` and is not just a bare UUID.
- Ensure compact `ids`, `summary`, and `metadata` detail modes preserve `sourceRef`.
- Ensure budget truncation never removes `sourceRef` or corrupts handle counts.

Do not implement `assetSource.previousSearch` resolution, source-ref validation, plan creation from source refs, declarative search filters, or high-level workflow tools in this slice.

## Files

- Modify: `server/src/types/agent-tool.types.ts`
  - Add `sourceRef: AgentSearchSourceRef` to `AgentSearchAssetsSelectionHandle`.
  - Add `sourceRefs?: AgentSearchSourceRef[]` to `AgentToolResponseIdsMetadata` for tool-call audit metadata.
- Modify: `server/src/dtos/agent-asset-source.dto.ts`
  - Export `AgentSearchSourceRefSchema` so `agent-tool.dto.ts` can validate the response field.
- Modify: `server/src/dtos/agent-tool.dto.ts`
  - Validate `selectionHandle.sourceRef` with `AgentSearchSourceRefSchema`.
- Modify: `server/src/services/agent-tool.service.ts`
  - Build `sourceRef` when a selection handle is created.
  - Include source refs in response metadata if metadata already records selection-handle fields.
- Test: `server/src/dtos/agent-tool.dto.spec.ts`
  - Add DTO tests for valid typed source refs and bare UUID rejection.
- Test: `server/src/services/agent-tool.service.spec.ts`
  - Add/extend service tests for `ids`, `summary`, `metadata`, and truncation paths.

## Source Ref Format

Use this exact format:

```ts
sourceRef = `asset-source:search:${selectionHandle.id}`;
```

The value is not a bare UUID because the model sees the `asset-source:search:` domain prefix. Slice 4 will resolve this typed source reference back to the backing selection handle and enforce user/session/expiration rules.

## Task 1: DTO Contract For Search Source Refs

**Files:**

- Modify: `server/src/dtos/agent-asset-source.dto.ts`
- Modify: `server/src/dtos/agent-tool.dto.ts`
- Modify: `server/src/types/agent-tool.types.ts`
- Test: `server/src/dtos/agent-tool.dto.spec.ts`

- [ ] **Step 1: Write failing DTO tests**

In `server/src/dtos/agent-tool.dto.spec.ts`, update the existing test `encodes and parses search responses with selection handles` so the response includes a source ref:

```ts
const sourceRef = `asset-source:search:${handleId}` as const;
// ...
selectionHandle: {
  id: handleId,
  sourceRef,
  assetCount: 3,
  sampleAssetIds: assetIds.slice(0, 2),
  sourceToolCallId: toolCallId,
  expiresAt: new Date('2026-05-21T12:30:00.000Z'),
},
// ...
expect(encoded.data.selectionHandle).toMatchObject({
  id: handleId,
  sourceRef,
  assetCount: 3,
  sampleAssetIds: assetIds.slice(0, 2),
  sourceToolCallId: toolCallId,
});
expect(encoded.data.selectionHandle?.sourceRef).not.toBe(handleId);
expect(encoded.data.selectionHandle?.sourceRef).toMatch(/^asset-source:search:/);
```

Add a new rejection test near that same block:

```ts
it('rejects bare UUID source refs in search selection handles', () => {
  const assetIds = [factory.uuid()];
  const handleId = factory.uuid();
  const toolCallId = factory.uuid();

  const result = AgentSearchAssetsToolResponseDto.schema.safeParse({
    status: 'success',
    toolCall: makeToolCall({ id: toolCallId, toolName: AgentToolName.SearchAssets }),
    summary: 'Created a selection handle for 1 asset',
    detail: 'ids',
    assetIds,
    returnedCount: 1,
    hasMore: false,
    nextPage: null,
    resultSize: makeResultSize({ returnedItems: 1 }),
    selectionHandle: {
      id: handleId,
      sourceRef: handleId,
      assetCount: 1,
      sampleAssetIds: assetIds,
      sourceToolCallId: toolCallId,
      expiresAt: new Date('2026-05-21T12:30:00.000Z'),
    },
  });

  expect(result.success).toBe(false);
  expectIssue(result, ['selectionHandle', 'sourceRef'], 'sourceRef must use the asset-source:search:<token> format');
});
```

- [ ] **Step 2: Run the focused DTO test and verify it is red**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/dtos/agent-tool.dto.spec.ts -t "selection handles|bare UUID source refs"
```

Expected: FAIL because `AgentSearchAssetsSelectionHandleSchema` does not yet accept/require `sourceRef`.

- [ ] **Step 3: Export the search source-ref schema**

In `server/src/dtos/agent-asset-source.dto.ts`, change:

```ts
const AgentSearchSourceRefSchema = z;
```

to:

```ts
export const AgentSearchSourceRefSchema = z;
```

- [ ] **Step 4: Add `sourceRef` to the search selection-handle type**

In `server/src/types/agent-tool.types.ts`, import `AgentSearchSourceRef` from `src/types/agent-asset-source.types` and update:

```ts
export type AgentSearchAssetsSelectionHandle = {
  id: string;
  sourceRef: AgentSearchSourceRef;
  assetCount: number;
  sampleAssetIds: string[];
  sourceToolCallId: string | null;
  expiresAt: Date;
};
```

Extend `AgentToolResponseIdsMetadata`:

```ts
sourceRefs?: AgentSearchSourceRef[];
```

- [ ] **Step 5: Validate source refs in the response DTO**

In `server/src/dtos/agent-tool.dto.ts`, import `AgentSearchSourceRefSchema` from `src/dtos/agent-asset-source.dto` and update `AgentSearchAssetsSelectionHandleSchema`:

```ts
const AgentSearchAssetsSelectionHandleSchema = z
  .object({
    id: uuid,
    sourceRef: AgentSearchSourceRefSchema,
    assetCount: z.number().int().min(0),
    sampleAssetIds: z.array(uuid).max(MAX_SEARCH_SAMPLE_SIZE),
    sourceToolCallId: uuid.nullable(),
    expiresAt: isoDatetimeToDate,
  })
  .meta({ id: 'AgentSearchAssetsSelectionHandle' });
```

- [ ] **Step 6: Run the focused DTO test and verify green**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/dtos/agent-tool.dto.spec.ts -t "selection handles|bare UUID source refs"
```

Expected: PASS.

## Task 2: Add Source Refs To `searchAssets` Selection Handle Responses

**Files:**

- Modify: `server/src/services/agent-tool.service.ts`
- Test: `server/src/services/agent-tool.service.spec.ts`

- [ ] **Step 1: Write failing service tests for normal and metadata search paths**

In `server/src/services/agent-tool.service.spec.ts`, update `searchAssets creates a selection handle and returns only compact sample ids when requested`:

```ts
const sourceRef = `asset-source:search:${handle.id}`;
// ...
expect(result.selectionHandle).toMatchObject({
  id: handle.id,
  sourceRef,
  assetCount: 60,
  sampleAssetIds: assetIds.slice(0, 25),
  sourceToolCallId: handle.sourceToolCallId,
  expiresAt: handle.expiresAt,
});
expect(result.selectionHandle?.sourceRef).not.toBe(handle.id);
expect(result.selectionHandle?.sourceRef).toMatch(/^asset-source:search:/);
expect(result.toolCall.redactedResponseMetadata).toEqual(
  expect.objectContaining({
    selectionHandleIds: [handle.id],
    sourceRefs: [sourceRef],
    selectionHandleAssetCount: 60,
    selectionHandleSampleAssetIds: assetIds.slice(0, 25),
  }),
);
```

In `searchAssets with a selection handle only hydrates metadata for compact samples`, add:

```ts
expect(result.selectionHandle?.sourceRef).toBe(`asset-source:search:${handle.id}`);
expect(result.selectionHandle?.expiresAt).toEqual(handle.expiresAt);
```

Add a summary-mode regression near the same tests:

```ts
it('searchAssets summary detail preserves sourceRef when a selection handle is created', async () => {
  const auth = AuthFactory.create();
  const assetIds = Array.from({ length: 4 }, () => newUuid());
  const session = makeSession({ userId: auth.user.id, approvalMode: AgentApprovalMode.PlanOnly });
  const handle = {
    id: newUuid(),
    sessionId: session.id,
    userId: auth.user.id,
    sourceToolCallId: newUuid(),
    assetIds,
    assetCount: assetIds.length,
    sampleAssetIds: assetIds.slice(0, 4),
    expiresAt: new Date(now.getTime() + 60 * 60_000),
    createdAt: now,
    updateId: newUuid(),
  };
  sessionRepository.getById.mockResolvedValue(session);
  searchRepository.searchMetadata.mockResolvedValue({
    items: assetIds.map((id) => ({ id })) as never,
    hasNextPage: false,
  });
  accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set(assetIds));
  assetRepository.getAgentReadableIds.mockResolvedValue(new Set(assetIds));
  selectionHandleRepository.create.mockResolvedValue(handle);
  assetRepository.getAgentMetadataByIds.mockResolvedValue(assetIds.slice(0, 2).map((id) => makeMetadata(id)) as never);

  const result = await sut.searchAssets(auth, session.id, {
    filters: {},
    limit: 4,
    detail: 'summary',
    createSelectionHandle: true,
    sampleSize: 2,
  });

  expect(result.status).toBe('success');
  if (result.status === 'success') {
    expect(result.selectionHandle?.sourceRef).toBe(`asset-source:search:${handle.id}`);
    expect(result.selectionHandle?.assetCount).toBe(4);
    expect(result.sample?.map((asset) => asset.id)).toEqual(assetIds.slice(0, 2));
  }
});
```

Add a small non-handle regression near these tests:

```ts
it('searchAssets omits sourceRef when no selection handle is created', async () => {
  const auth = AuthFactory.create();
  const assetId = newUuid();
  const session = makeSession({ userId: auth.user.id, approvalMode: AgentApprovalMode.PlanOnly });
  sessionRepository.getById.mockResolvedValue(session);
  searchRepository.searchMetadata.mockResolvedValue({ items: [{ id: assetId }] as never, hasNextPage: false });
  accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set([assetId]));
  assetRepository.getAgentReadableIds.mockResolvedValue(new Set([assetId]));

  const result = await sut.searchAssets(auth, session.id, { filters: {}, limit: 1, detail: 'ids' });

  expect(result.status).toBe('success');
  if (result.status === 'success') {
    expect(result.selectionHandle).toBeUndefined();
    expect(JSON.stringify(result)).not.toContain('asset-source:search:');
  }
});
```

- [ ] **Step 2: Run the focused service tests and verify red**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-tool.service.spec.ts -t "selection handle|omits sourceRef"
```

Expected: FAIL because `sourceRef` is not present on selection-handle responses or metadata.

- [ ] **Step 3: Build and attach source refs in `searchAssetsDescriptor()`**

In `server/src/services/agent-tool.service.ts`, import `buildAgentSourceRef` from `src/dtos/agent-asset-source.dto` and add:

```ts
private buildSearchSourceRef(selectionHandleId: string) {
  return buildAgentSourceRef('search', selectionHandleId);
}
```

When mapping `selectionHandle` in `pageResult`, include:

```ts
sourceRef: this.buildSearchSourceRef(selectionHandle.id),
```

The full mapped object should remain:

```ts
selectionHandle: {
  id: selectionHandle.id,
  sourceRef: this.buildSearchSourceRef(selectionHandle.id),
  assetCount: selectionHandle.assetCount,
  sampleAssetIds: selectionHandle.sampleAssetIds,
  sourceToolCallId: selectionHandle.sourceToolCallId,
  expiresAt: selectionHandle.expiresAt,
}
```

- [ ] **Step 4: Preserve source refs in tool-call response metadata**

Update `responseMetadata` for search results with selection handles:

```ts
responseMetadata: (result) =>
  result.selectionHandle
    ? {
        selectionHandleIds: [result.selectionHandle.id],
        sourceRefs: [result.selectionHandle.sourceRef],
        selectionHandleAssetCount: result.selectionHandle.assetCount,
        selectionHandleSampleAssetIds: result.selectionHandle.sampleAssetIds,
      }
    : { assetIds: result.assetIds },
```

Update any test-specific `toolCallRepository.transitionWithSessionLimit` mocks that hardcode `redactedResponseMetadata` for selection-handle search results so they include the expected `sourceRefs: [sourceRef]`.

- [ ] **Step 5: Run the focused service tests and verify green**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-tool.service.spec.ts -t "selection handle|omits sourceRef"
```

Expected: PASS.

## Task 3: Preserve Source Refs Through Truncation

**Files:**

- Modify: `server/src/services/agent-tool.service.spec.ts`
- Modify implementation only if the test fails after Task 2.

- [ ] **Step 1: Write failing truncation regression**

Update `searchAssets creates handles from budget-truncated search output without truncating handle counts`:

```ts
expect(result.selectionHandle?.assetCount).toBe(500);
expect(result.selectionHandle?.sourceRef).toMatch(/^asset-source:search:/);
expect(result.selectionHandle?.sourceRef).toContain(result.selectionHandle.id);
expect(result.resultSize.truncated).toBe(true);
expect(result.resultSize.omittedFields).toContain('assetIds');
expect(JSON.stringify(result)).toContain(result.selectionHandle!.sourceRef);
```

Also assert metadata keeps it:

```ts
expect(result.toolCall.redactedResponseMetadata).toEqual(
  expect.objectContaining({
    sourceRefs: [result.selectionHandle!.sourceRef],
    selectionHandleAssetCount: 500,
  }),
);
```

- [ ] **Step 2: Run the focused truncation test and verify red or baseline**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-tool.service.spec.ts -t "budget-truncated search output"
```

Expected before implementation: FAIL if Task 2 has not implemented source refs yet. If it passes after Task 2, record that as green evidence because the truncation helper already preserves `selectionHandle`.

- [ ] **Step 3: Fix truncation only if needed**

If the truncation test fails because `selectionHandle` is dropped, update `truncateSearchAssetsResult()` to include `selectionHandle?: AgentSearchAssetsSelectionHandle` in its generic bound and ensure trimming only removes `assets`, `sample`, and `assetIds`. Do not trim `selectionHandle` or `selectionHandle.sourceRef`.

- [ ] **Step 4: Run the focused truncation test and verify green**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-tool.service.spec.ts -t "budget-truncated search output"
```

Expected: PASS.

## Task 4: Full Slice Verification And Commit

**Files:**

- Verify all files modified in this slice.

- [ ] **Step 1: Run focused affected suites**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/dtos/agent-tool.dto.spec.ts src/services/agent-tool.service.spec.ts
```

Expected: PASS.

- [ ] **Step 2: Run adjacent source-contract regression suites**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/dtos/agent-asset-source.dto.spec.ts src/types/agent-asset-source.types.spec.ts
```

Expected: PASS.

- [ ] **Step 3: Run static checks**

Run:

```bash
pnpm --dir server run lint
pnpm --dir server exec tsc --noEmit --pretty false
git diff --check
```

Expected: PASS.

- [ ] **Step 4: Confirm Slice 3 edge cases**

Inspect the diff and test assertions to verify:

- `createSelectionHandle: true` returns both `selectionHandle.id` and `selectionHandle.sourceRef`.
- `sourceRef` starts with `asset-source:search:` and is not a bare UUID.
- `sourceRef` is derived from the backing selection handle, so it is scoped to the same user/session/expiration lifecycle as that handle.
- `ids`, `summary`, and `metadata` details preserve `sourceRef` when a handle exists.
- Truncation preserves `sourceRef`, `selectionHandle.assetCount`, and `selectionHandle.sampleAssetIds`.
- Search responses without a selection handle do not include `sourceRef`.

- [ ] **Step 5: Commit and push**

Run:

```bash
git status --short
git add server/src/types/agent-tool.types.ts \
  server/src/dtos/agent-asset-source.dto.ts \
  server/src/dtos/agent-tool.dto.ts \
  server/src/services/agent-tool.service.ts \
  server/src/dtos/agent-tool.dto.spec.ts \
  server/src/services/agent-tool.service.spec.ts \
  docs/superpowers/plans/2026-05-22-pi-agent-declarative-planning-sources-slice-3.md
git commit -m "feat(server): return Pi search source refs"
git push
```

Expected: commit succeeds and branch `explore/pi-agent-brainstorm` is pushed.

## Plan Self-Review

- TDD order is explicit: every behavior starts with tests and focused red command before implementation steps.
- Slice 3 spec coverage is complete:
  - search with selection handle returns `sourceRef`, handle ID, counts, sample IDs, and result size;
  - `sourceRef` is not a bare UUID and encodes `asset-source:search`;
  - source refs are scoped to the backing selection handle lifecycle by derivation from handle ID and existing handle session/user/expiration;
  - compact/summary/metadata modes are covered by service tests;
  - truncation keeps `sourceRef` and counts.
- The plan intentionally avoids Slice 4+ behavior: it does not resolve source refs, create plans from source refs, or change apply behavior.
