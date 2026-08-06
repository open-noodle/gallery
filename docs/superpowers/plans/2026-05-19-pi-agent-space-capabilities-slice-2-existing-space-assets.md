# Pi Agent Space Capabilities Slice 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Pi reliably add and remove photos from existing shared spaces through reviewable plans that use the correct space target shape, apply only selected assets, and keep the chat open after apply.

**Architecture:** Reuse the existing `space.addAssets` and `space.removeAssets` operation types. Tighten MCP examples, prompt guidance, validation hints, server apply tests, assistant-flow coverage, and frontend plan/applied-card presentation so the first-party runner uses `listSpaces` and `readSpace` before proposing existing-space mutations.

**Tech Stack:** NestJS, Zod DTOs, Vitest, first-party MCP runner prompt generation, Svelte/TypeScript assistant UI, generated MCP docs.

---

## Slice Scope

Implement only `Slice 2: Add And Remove Photos In Existing Spaces` from `docs/superpowers/specs/2026-05-19-pi-agent-space-capabilities-design.md`.

In scope:

- Existing-space plans using:
  - `space.addAssets`
  - `space.removeAssets`
- MCP contract examples and generated docs that show `targetKind: "existing_space"` plus `targetId`.
- Validation hints for wrong target kinds and missing existing-space ids.
- Runner prompt guidance that tells Pi to call `listSpaces` and `readSpace` before planning existing-space asset changes.
- Server tests that prove apply uses `SharedSpaceService.addAssets` / `removeAssets` with only selected asset ids.
- Plan review and applied-plan card labels for existing-space add/remove operations.
- Assistant-flow coverage for "find space -> inspect membership -> find assets -> propose plan -> apply plan -> chat remains open".

Out of scope:

- Creating spaces. That is covered by later/other slices.
- Updating space names, descriptions, colors, members, roles, or invitations.
- Adding direct mutation MCP tools. All writes still go through Gallery plan review.
- New database schema.
- New frontend session-management behavior.

---

## Key Decisions

- Do not add direct MCP write tools. Pi still proposes plans with `mcp_gallery_proposeAlbumOperations`; Gallery applies selected plan operations after user review.
- `readSpace.assetIdsTruncated === false` is the only signal that Pi can treat `readSpace.assetIds` as complete membership.
- For `space.addAssets`, when membership is complete, Pi should exclude candidate assets that are already in the space.
- For `space.removeAssets`, when membership is complete, Pi should only include candidate assets that are currently in the space.
- When `readSpace.assetIdsTruncated === true`, Pi must not use absence from `assetIds` as proof that a photo is not in the space. It should narrow the candidate set, ask a clarifying question, or present a cautious plan that does not claim complete membership knowledge.
- Existing-space operations require `targetKind: AgentOperationTargetKind.ExistingSpace` and `targetId`; they must not use album target kinds or `temporaryTargetId`.
- User-excluded assets and disabled operations must never reach `SharedSpaceService.addAssets` or `SharedSpaceService.removeAssets`.
- Large selections should stay reviewable with capped thumbnails plus counts; do not render thousands of thumbnails.

---

## Test Matrix

| Layer                 | Cases                                                                                                                                                                                                                              |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| MCP contract examples | Existing-space add/remove examples parse through `AgentOperationPlanToolRequestSchemas`, use `targetKind: "existing_space"`, include `targetId`, include asset ids, and do not include `temporaryTargetId`.                        |
| MCP validation hints  | Album target kinds for space operations return an actionable correction hint. Existing-space operations missing `targetId` or carrying `temporaryTargetId` return hints that explain the right shape.                              |
| Runner prompt         | Prompt includes `mcp_gallery_listSpaces`, `mcp_gallery_readSpace`, existing-space add/remove plan examples, and membership guidance for `assetIdsTruncated`. Prompt stays compact and does not expose direct apply/write tools.    |
| Generated docs        | Generated MCP docs include existing-space add/remove examples, common mistakes, and membership guidance. Generated prompt module matches `AgentMcpPromptService`.                                                                  |
| Plan apply            | Existing-space add/remove apply calls `SharedSpaceService.addAssets` / `removeAssets` with selected asset ids only. Disabled operations, unselected operations, and user-excluded assets are skipped.                              |
| Access and failures   | Lack of space editor access is denied before downstream mutation. A stale/inaccessible asset produces a failed operation without mutating. One successful operation plus one failed operation reports partial success.             |
| Assistant flow        | Pi lists spaces, reads the chosen space, searches/reads candidate assets, proposes an existing-space asset plan, the UI shows a plan card, apply creates an applied-plan card, and the session returns to active chat state.       |
| Frontend plan UI      | Review cards label space destinations as spaces, show `Add N photos` / `Remove N photos`, support item selection, cap thumbnails, and do not leak raw operation ids unless technical details are expanded.                         |
| Edge cases            | Ambiguous space names, no matching space, no matching assets, all add candidates already present, no remove candidates present, truncated membership, permission denial, partial apply, and hundreds/thousands of affected assets. |

---

## Files To Modify

- `server/src/services/agent-mcp-tool-contract.service.ts`
- `server/src/services/agent-mcp-tool-contract.service.spec.ts`
- `server/src/services/agent-mcp-prompt.service.ts`
- `server/src/services/agent-mcp-prompt.service.spec.ts`
- `server/src/services/agent-mcp-docs.service.spec.ts`
- `server/src/services/agent-mcp.service.spec.ts`
- `server/src/dtos/agent-operation.dto.spec.ts`
- `server/src/services/agent-operation-plan.service.spec.ts`
- `agent-runner/src/generated/gallery-mcp-prompt-cheat-sheet.mjs`
- `docs/superpowers/generated/pi-agent-mcp-tools.md`
- `web/src/routes/(user)/assistant/agent-operation-plan-ui.ts`
- `web/src/routes/(user)/assistant/agent-operation-plan-ui.spec.ts`
- `web/src/routes/(user)/assistant/agent-operation-plan-review-panel.spec.ts`
- `web/src/routes/(user)/assistant/agent-applied-plan-timeline-card.spec.ts`
- `web/src/routes/(user)/assistant/agent-session-chat-panel.spec.ts`
- `i18n/en.json`

---

## Task 1: MCP Contract And Prompt Examples

**Files:**

- Modify: `server/src/services/agent-mcp-tool-contract.service.ts`
- Modify: `server/src/services/agent-mcp-tool-contract.service.spec.ts`
- Modify: `server/src/services/agent-mcp-prompt.service.ts`
- Modify: `server/src/services/agent-mcp-prompt.service.spec.ts`
- Modify: `server/src/services/agent-mcp-docs.service.spec.ts`
- Modify: `server/src/services/agent-mcp.service.spec.ts`

- [ ] **Step 1: Write failing contract tests for existing-space examples**

Add these assertions to `server/src/services/agent-mcp-tool-contract.service.spec.ts`.

```ts
it('defines existing-space asset planning examples with targetId and no temporary target', () => {
  const contract = sut.getPlanningToolContract(AgentToolName.ProposeAlbumOperations);

  for (const exampleName of ['add-assets-to-existing-space', 'remove-assets-from-existing-space'] as const) {
    const example = contract?.examples.find((candidate) => candidate.name === exampleName);

    expect(example, exampleName).toBeDefined();
    AgentOperationPlanToolRequestSchemas[AgentToolName.ProposeAlbumOperations].parse(example?.arguments);

    const operation = example?.arguments.operations[0];
    expect(operation).toMatchObject({
      targetKind: AgentOperationTargetKind.ExistingSpace,
      targetId: '00000000-0000-4000-8000-000000000020',
      payload: {},
    });
    expect(operation).not.toHaveProperty('temporaryTargetId');
  }
});
```

Add a validation-failure assertion near the existing failure matrix tests.

```ts
it('provides actionable correction hints for wrong existing-space asset target shapes', () => {
  const contract = sut.getPlanningToolContract(AgentToolName.ProposeAlbumOperations);
  const mistakeIds = contract?.commonMistakes.map((mistake) => mistake.id);
  const failureCaseIds = sut.listRuntimeFailureMatrixCases().map((failureCase) => failureCase.id);

  expect(mistakeIds).toEqual(
    expect.arrayContaining([
      'planning-wrong-space-target-kind',
      'planning-existing-space-missing-target-id',
      'planning-existing-space-with-temporary-target',
    ]),
  );
  expect(failureCaseIds).toEqual(
    expect.arrayContaining([
      'planning-wrong-space-target-kind',
      'planning-existing-space-missing-target-id',
      'planning-existing-space-with-temporary-target',
    ]),
  );

  const wrongKind = contract?.commonMistakes.find((mistake) => mistake.id === 'planning-wrong-space-target-kind');
  expect(wrongKind?.hint).toMatch(/existing_space/i);
  expect(wrongKind?.hint).toMatch(/targetId/i);
});
```

- [ ] **Step 2: Run the contract test and confirm it fails for missing guidance**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-mcp-tool-contract.service.spec.ts
```

Expected: FAIL if missing failure-matrix rows or if examples include the wrong target shape.

- [ ] **Step 3: Implement the contract updates**

In `server/src/services/agent-mcp-tool-contract.service.ts`, keep the existing add/remove examples if they already parse, then add or tighten these `planningCommonMistakes` entries.

```ts
{
  id: 'planning-existing-space-missing-target-id',
  match: { issuePath: 'operations.0.targetId', requestShape: 'tool-arguments' },
  hint: 'Existing-space asset operations require targetKind "existing_space" and targetId from listSpaces/readSpace.',
  exampleName: 'add-assets-to-existing-space',
},
{
  id: 'planning-existing-space-with-temporary-target',
  match: { issuePath: 'operations.0.temporaryTargetId', requestShape: 'tool-arguments' },
  hint: 'Use targetId for existing spaces. Use temporaryTargetId only for new spaces created earlier in the same plan.',
  exampleName: 'remove-assets-from-existing-space',
},
```

Tighten the existing `planning-wrong-space-target-kind` hint to say:

```ts
hint: 'Space operations must use targetKind "existing_space" with targetId from listSpaces/readSpace, or targetKind "new_space" with temporaryTargetId from a prior space.create operation.',
```

Add matching entries to `slice4PlanningFailureMatrixCases`:

```ts
{
  id: 'planning-existing-space-missing-target-id',
  category: 'planning-target',
  description: 'Model proposes an existing-space asset operation without targetId.',
  toolName: AgentToolName.ProposeAlbumOperations,
  request: toolCallRequest('planning-existing-space-missing-target-id', AgentToolName.ProposeAlbumOperations, {
    summary: 'Add photos to Family space.',
    operations: [
      {
        type: AgentOperationType.SpaceAddAssets,
        summary: 'Add photos to Family space.',
        targetKind: AgentOperationTargetKind.ExistingSpace,
        assetIds: [exampleAssetId],
        payload: {},
      },
    ],
  }),
  expectedResult: { kind: 'tool-validation', expectedIssuePath: 'operations.0.targetId' },
  expectedContractMistakeId: 'planning-existing-space-missing-target-id',
},
{
  id: 'planning-existing-space-with-temporary-target',
  category: 'planning-target',
  description: 'Model uses temporaryTargetId on an existing-space asset operation.',
  toolName: AgentToolName.ProposeAlbumOperations,
  request: toolCallRequest('planning-existing-space-with-temporary-target', AgentToolName.ProposeAlbumOperations, {
    summary: 'Remove photos from Family space.',
    operations: [
      {
        type: AgentOperationType.SpaceRemoveAssets,
        summary: 'Remove photos from Family space.',
        targetKind: AgentOperationTargetKind.ExistingSpace,
        targetId: exampleSpaceId,
        temporaryTargetId: 'tmp-family-space',
        assetIds: [exampleAssetId],
        payload: {},
      },
    ],
  }),
  expectedResult: { kind: 'tool-validation', expectedIssuePath: 'operations.0.temporaryTargetId' },
  expectedContractMistakeId: 'planning-existing-space-with-temporary-target',
},
```

- [ ] **Step 4: Write failing prompt tests for lookup-before-plan and membership guidance**

Add to `server/src/services/agent-mcp-prompt.service.spec.ts`.

```ts
it('includes existing-space asset plan examples and membership guidance', () => {
  const prompt = sut.generatePromptCheatSheet();
  const examples = sut.listPromptExamples();

  expect(examples).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        toolName: AgentToolName.ProposeAlbumOperations,
        exampleName: 'add-assets-to-existing-space',
      }),
      expect.objectContaining({
        toolName: AgentToolName.ProposeAlbumOperations,
        exampleName: 'remove-assets-from-existing-space',
      }),
    ]),
  );

  expect(prompt).toContain('mcp_gallery_listSpaces');
  expect(prompt).toContain('mcp_gallery_readSpace');
  expect(prompt).toContain('space.addAssets');
  expect(prompt).toContain('space.removeAssets');
  expect(prompt).toContain('"targetKind":"existing_space"');
  expect(prompt).toContain('assetIdsTruncated');
  expect(prompt).toMatch(/exclude .*already .*space/i);
  expect(prompt).toMatch(/only remove .*already .*space/i);
  expect(prompt).toMatch(/ambiguous|multiple spaces/i);
  expect(prompt).toMatch(/no matching space|no space/i);
  expect(prompt).toMatch(/no matching assets|no photos/i);
});
```

- [ ] **Step 5: Implement prompt selections and compact guidance**

In `server/src/services/agent-mcp-prompt.service.ts`, add the two existing-space examples to `promptExampleSelections`.

```ts
{ toolName: AgentToolName.ProposeAlbumOperations, exampleName: 'add-assets-to-existing-space' },
{ toolName: AgentToolName.ProposeAlbumOperations, exampleName: 'remove-assets-from-existing-space' },
```

In `generatePromptCheatSheet()`, fetch those examples:

```ts
const addToSpace = this.getPromptExample(
  examples,
  AgentToolName.ProposeAlbumOperations,
  'add-assets-to-existing-space',
);
const removeFromSpace = this.getPromptExample(
  examples,
  AgentToolName.ProposeAlbumOperations,
  'remove-assets-from-existing-space',
);
```

Insert compact guidance after the existing space lookup line:

```ts
'Existing-space asset plans: use listSpaces/readSpace first. If a space name is ambiguous or missing, ask before planning. If no assets match, explain without proposing an empty plan. If readSpace.assetIdsTruncated is false, exclude add candidates already in the space and only remove candidates already in the space. If assetIdsTruncated is true, narrow the request or ask before claiming membership is complete.',
`Plan ${addToSpace.piToolName} (${addToSpace.exampleName}):`,
this.formatJson(addToSpace.arguments),
`Plan ${removeFromSpace.piToolName} (${removeFromSpace.exampleName}):`,
this.formatJson(removeFromSpace.arguments),
```

If the prompt exceeds its existing compact length test, shorten prose rather than dropping the examples.

- [ ] **Step 6: Write docs and MCP validation tests**

Add to `server/src/services/agent-mcp-docs.service.spec.ts`.

```ts
it('documents existing-space add and remove asset plans with membership cautions', () => {
  const markdown = sut.generateMarkdown();

  expect(markdown).toContain('add-assets-to-existing-space');
  expect(markdown).toContain('remove-assets-from-existing-space');
  expect(markdown).toContain('"targetKind": "existing_space"');
  expect(markdown).toContain('"targetId"');
  expect(markdown).toContain('assetIdsTruncated');
  expect(markdown).toMatch(/listSpaces.*readSpace/is);
});
```

Add to `server/src/services/agent-mcp.service.spec.ts` a bad-argument case for album target kinds on space asset operations:

```ts
it('returns a correction hint when a space asset operation uses an album target kind', async () => {
  const response = (await sut.handle(
    auth,
    sessionId,
    makeToolCallRequest(AgentToolName.ProposeAlbumOperations, {
      summary: 'Add photos to a space.',
      operations: [
        {
          type: AgentOperationType.SpaceAddAssets,
          summary: 'Add photos to Family.',
          targetKind: AgentOperationTargetKind.ExistingAlbum,
          targetId: '00000000-0000-4000-8000-000000000010',
          assetIds: ['00000000-0000-4000-8000-000000000001'],
          payload: {},
        },
      ],
    }),
  )) as AgentMcpSuccessResponse;

  expectEnrichedToolValidationError(response, {
    toolName: AgentToolName.ProposeAlbumOperations,
    path: 'operations.0.targetKind',
    hintIncludes: 'existing_space',
  });
});
```

- [ ] **Step 7: Run Task 1 tests**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs \
  src/services/agent-mcp-tool-contract.service.spec.ts \
  src/services/agent-mcp-prompt.service.spec.ts \
  src/services/agent-mcp-docs.service.spec.ts \
  src/services/agent-mcp.service.spec.ts
```

Expected: PASS.

- [ ] **Step 8: Commit Task 1**

```bash
git add server/src/services/agent-mcp-tool-contract.service.ts \
  server/src/services/agent-mcp-tool-contract.service.spec.ts \
  server/src/services/agent-mcp-prompt.service.ts \
  server/src/services/agent-mcp-prompt.service.spec.ts \
  server/src/services/agent-mcp-docs.service.spec.ts \
  server/src/services/agent-mcp.service.spec.ts
git commit -m "test: harden existing-space MCP planning guidance"
```

---

## Task 2: Operation Validation And Apply Behavior

**Files:**

- Modify: `server/src/dtos/agent-operation.dto.spec.ts`
- Modify: `server/src/services/agent-operation-plan.service.spec.ts`
- Modify only if tests expose a gap: `server/src/dtos/agent-operation.dto.ts`
- Modify only if tests expose a gap: `server/src/services/agent-operation-plan.service.ts`

- [ ] **Step 1: Write failing DTO tests for existing-space target shape**

Add to `server/src/dtos/agent-operation.dto.spec.ts`.

```ts
it('requires existing-space asset operations to use targetId without temporaryTargetId', () => {
  const targetId = '00000000-0000-4000-8000-000000000020';
  const assetId = '00000000-0000-4000-8000-000000000001';

  expect(
    AgentOperationPlanToolRequestSchemas[AgentToolName.ProposeAlbumOperations].parse({
      summary: 'Add selected photos to Family.',
      operations: [
        {
          type: AgentOperationType.SpaceAddAssets,
          summary: 'Add selected photos to Family.',
          targetKind: AgentOperationTargetKind.ExistingSpace,
          targetId,
          assetIds: [assetId],
          payload: {},
        },
      ],
    }).operations[0],
  ).toMatchObject({ targetKind: AgentOperationTargetKind.ExistingSpace, targetId });

  expectIssue(
    AgentOperationPlanToolRequestSchemas[AgentToolName.ProposeAlbumOperations].safeParse({
      summary: 'Add selected photos to Family.',
      operations: [
        {
          type: AgentOperationType.SpaceAddAssets,
          summary: 'Add selected photos to Family.',
          targetKind: AgentOperationTargetKind.ExistingAlbum,
          targetId,
          assetIds: [assetId],
          payload: {},
        },
      ],
    }),
    ['operations', 0, 'targetKind'],
    'space operations require a space target',
  );

  expectIssue(
    AgentOperationPlanToolRequestSchemas[AgentToolName.ProposeAlbumOperations].safeParse({
      summary: 'Remove selected photos from Family.',
      operations: [
        {
          type: AgentOperationType.SpaceRemoveAssets,
          summary: 'Remove selected photos from Family.',
          targetKind: AgentOperationTargetKind.ExistingSpace,
          targetId,
          temporaryTargetId: 'tmp-family',
          assetIds: [assetId],
          payload: {},
        },
      ],
    }),
    ['operations', 0, 'temporaryTargetId'],
    'Use targetId for existing spaces',
  );
});
```

- [ ] **Step 2: Run the DTO test and confirm failure or coverage**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/dtos/agent-operation.dto.spec.ts
```

Expected: FAIL if the schema still accepts an existing-space `temporaryTargetId` or gives unclear errors. If it already passes, keep the test as regression coverage and continue.

- [ ] **Step 3: Implement minimal DTO fixes if needed**

If the new test fails, update `server/src/dtos/agent-operation.dto.ts` in `validateSpaceTarget()` or `spaceAssetsOperationSchema()` so:

```ts
if (operation.targetKind === AgentOperationTargetKind.ExistingSpace && operation.temporaryTargetId) {
  ctx.addIssue({
    code: z.ZodIssueCode.custom,
    path: ['temporaryTargetId'],
    message: 'Use targetId for existing spaces; temporaryTargetId is only for new spaces',
  });
}
```

Keep existing new-space behavior intact.

- [ ] **Step 4: Write failing apply tests for selected asset ids**

Add focused tests to `server/src/services/agent-operation-plan.service.spec.ts`.

```ts
it('applies existing-space add/remove operations with only selected asset ids', async () => {
  const auth = AuthFactory.create();
  const session = makeSession({
    userId: auth.user.id,
    status: AgentSessionStatus.WaitingForPlanReview,
    permissionPlanSnapshot: expandedPermissionPlanSnapshot,
  });
  const spaceId = newUuid();
  const keepAssetId = newUuid();
  const excludedAssetId = newUuid();
  const removeAssetId = newUuid();
  const removeExcludedAssetId = newUuid();

  accessRepository.asset.checkOwnerAccess.mockResolvedValue(
    new Set([keepAssetId, excludedAssetId, removeAssetId, removeExcludedAssetId]),
  );
  accessRepository.asset.checkSpaceEditAccess.mockResolvedValue(
    new Set([keepAssetId, excludedAssetId, removeAssetId, removeExcludedAssetId]),
  );
  accessRepository.sharedSpace.checkRoleAccess.mockResolvedValue(new Set([spaceId]));

  const addOperation = makeOperation({
    id: newUuid(),
    type: AgentOperationType.SpaceAddAssets,
    summary: 'Add selected photos to Family.',
    targetKind: AgentOperationTargetKind.ExistingSpace,
    targetId: spaceId,
    assetIds: [keepAssetId, excludedAssetId],
    payload: {},
  });
  const removeOperation = makeOperation({
    id: newUuid(),
    type: AgentOperationType.SpaceRemoveAssets,
    summary: 'Remove selected photos from Family.',
    targetKind: AgentOperationTargetKind.ExistingSpace,
    targetId: spaceId,
    assetIds: [removeAssetId, removeExcludedAssetId],
    payload: {},
    position: 1,
  });
  const plan = makePlan({ sessionId: session.id, operations: [addOperation, removeOperation] });
  sessionRepository.getById.mockResolvedValue(session);
  planRepository.getByIdForSession.mockResolvedValue(plan);
  planRepository.getCurrentBySessionId.mockResolvedValue(plan);
  planRepository.claimCurrentForApply.mockResolvedValue({ ...plan, status: AgentOperationPlanStatus.Applied });
  planRepository.completeApply.mockResolvedValue({
    ...plan,
    status: AgentOperationPlanStatus.Applied,
    operations: [
      { ...addOperation, status: AgentOperationStatus.Applied, result: { spaceId, assetIds: [keepAssetId] } },
      { ...removeOperation, status: AgentOperationStatus.Applied, result: { spaceId, assetIds: [removeAssetId] } },
    ],
  });
  sharedSpaceService.addAssets.mockResolvedValue(undefined as never);
  sharedSpaceService.removeAssets.mockResolvedValue(undefined as never);

  await sut.applyApprovedOperations(auth, session.id, plan.id, {
    operationIds: [addOperation.id, removeOperation.id],
    itemSelections: {
      [addOperation.id]: { itemKind: 'asset', mode: 'only', itemIds: [keepAssetId] },
      [removeOperation.id]: {
        itemKind: 'asset',
        mode: 'allExcept',
        itemIds: [removeExcludedAssetId],
      },
    },
  });

  expect(sharedSpaceService.addAssets).toHaveBeenCalledWith(auth, spaceId, { assetIds: [keepAssetId] });
  expect(sharedSpaceService.removeAssets).toHaveBeenCalledWith(auth, spaceId, { assetIds: [removeAssetId] });
  expect(sessionRepository.update).toHaveBeenCalledWith(auth.user.id, session.id, {
    status: AgentSessionStatus.Running,
    endedAt: null,
  });
  expect(sessionRepository.update).not.toHaveBeenCalledWith(
    auth.user.id,
    session.id,
    expect.objectContaining({ status: AgentSessionStatus.Completed }),
  );
});
```

Add disabled/unselected coverage:

```ts
it('does not call shared-space mutation services for disabled or unselected existing-space operations', async () => {
  const auth = AuthFactory.create();
  const session = makeSession({
    userId: auth.user.id,
    status: AgentSessionStatus.WaitingForPlanReview,
    permissionPlanSnapshot: expandedPermissionPlanSnapshot,
  });
  const selectedId = newUuid();
  const disabledId = newUuid();
  const unselectedId = newUuid();
  const spaceId = newUuid();
  const assetId = newUuid();

  accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set([assetId]));
  accessRepository.asset.checkSpaceEditAccess.mockResolvedValue(new Set([assetId]));
  accessRepository.sharedSpace.checkRoleAccess.mockResolvedValue(new Set([spaceId]));

  const selected = makeOperation({
    id: selectedId,
    type: AgentOperationType.SpaceAddAssets,
    targetKind: AgentOperationTargetKind.ExistingSpace,
    targetId: spaceId,
    assetIds: [assetId],
    payload: {},
  });
  const disabled = makeOperation({
    id: disabledId,
    type: AgentOperationType.SpaceRemoveAssets,
    targetKind: AgentOperationTargetKind.ExistingSpace,
    targetId: spaceId,
    assetIds: [assetId],
    payload: {},
    enabled: false,
    position: 1,
  });
  const unselected = makeOperation({
    id: unselectedId,
    type: AgentOperationType.SpaceRemoveAssets,
    targetKind: AgentOperationTargetKind.ExistingSpace,
    targetId: spaceId,
    assetIds: [assetId],
    payload: {},
    position: 2,
  });
  const plan = makePlan({ sessionId: session.id, operations: [selected, disabled, unselected] });
  sessionRepository.getById.mockResolvedValue(session);
  planRepository.getByIdForSession.mockResolvedValue(plan);
  planRepository.getCurrentBySessionId.mockResolvedValue(plan);
  planRepository.claimCurrentForApply.mockResolvedValue({ ...plan, status: AgentOperationPlanStatus.Applied });
  planRepository.completeApply.mockResolvedValue({
    ...plan,
    status: AgentOperationPlanStatus.Applied,
    operations: [
      { ...selected, status: AgentOperationStatus.Applied, result: { spaceId, assetIds: [assetId] } },
      {
        ...disabled,
        status: AgentOperationStatus.Skipped,
        result: { skippedReason: 'Operation was not selected for apply' },
      },
      {
        ...unselected,
        status: AgentOperationStatus.Skipped,
        result: { skippedReason: 'Operation was not selected for apply' },
      },
    ],
  });
  sharedSpaceService.addAssets.mockResolvedValue(undefined as never);

  await sut.applyApprovedOperations(auth, session.id, plan.id, { operationIds: [selected.id] });

  expect(sharedSpaceService.addAssets).toHaveBeenCalledTimes(1);
  expect(sharedSpaceService.removeAssets).not.toHaveBeenCalled();
});
```

- [ ] **Step 5: Write failing access and partial-failure tests**

Add a permission denial test if the current one only covers one operation type.

```ts
it.each([AgentOperationType.SpaceAddAssets, AgentOperationType.SpaceRemoveAssets])(
  'denies %s when the user cannot edit the existing space',
  async (operationType) => {
    const auth = AuthFactory.create();
    const session = makeSession({ userId: auth.user.id, permissionPlanSnapshot: expandedPermissionPlanSnapshot });
    const spaceId = newUuid();
    const assetId = newUuid();
    sessionRepository.getById.mockResolvedValue(session);
    toolCallRepository.create.mockResolvedValue(
      makeToolCall({ sessionId: session.id, status: AgentToolCallStatus.Executing }),
    );
    accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set([assetId]));
    accessRepository.asset.checkSpaceEditAccess.mockResolvedValue(new Set([assetId]));
    accessRepository.sharedSpace.checkRoleAccess.mockResolvedValue(new Set());

    await expect(
      sut.proposeAlbumOperations(auth, session.id, {
        summary: 'Change Family space.',
        operations: [
          {
            type: operationType,
            summary: 'Change Family space.',
            targetKind: AgentOperationTargetKind.ExistingSpace,
            targetId: spaceId,
            assetIds: [assetId],
            payload: {},
          },
        ],
      }),
    ).rejects.toThrow(/space/i);
  },
);
```

Add operation-level partial apply coverage.

```ts
it('reports partial success when one existing-space operation applies and another becomes inaccessible', async () => {
  const auth = AuthFactory.create();
  const session = makeSession({
    userId: auth.user.id,
    status: AgentSessionStatus.WaitingForPlanReview,
    permissionPlanSnapshot: expandedPermissionPlanSnapshot,
  });
  const spaceId = newUuid();
  const allowedAssetId = newUuid();
  const staleAssetId = newUuid();

  accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set([allowedAssetId]));
  accessRepository.asset.checkSpaceEditAccess.mockResolvedValue(new Set([allowedAssetId]));
  accessRepository.sharedSpace.checkRoleAccess.mockResolvedValue(new Set([spaceId]));

  const addOperation = makeOperation({
    id: newUuid(),
    type: AgentOperationType.SpaceAddAssets,
    targetKind: AgentOperationTargetKind.ExistingSpace,
    targetId: spaceId,
    assetIds: [allowedAssetId],
    payload: {},
  });
  const removeOperation = makeOperation({
    id: newUuid(),
    type: AgentOperationType.SpaceRemoveAssets,
    targetKind: AgentOperationTargetKind.ExistingSpace,
    targetId: spaceId,
    assetIds: [staleAssetId],
    payload: {},
    position: 1,
  });
  const plan = makePlan({ sessionId: session.id, operations: [addOperation, removeOperation] });
  sessionRepository.getById.mockResolvedValue(session);
  planRepository.getByIdForSession.mockResolvedValue(plan);
  planRepository.getCurrentBySessionId.mockResolvedValue(plan);
  planRepository.claimCurrentForApply.mockResolvedValue({ ...plan, status: AgentOperationPlanStatus.Applied });
  planRepository.completeApply.mockResolvedValue({
    ...plan,
    status: AgentOperationPlanStatus.Applied,
    operations: [
      { ...addOperation, status: AgentOperationStatus.Applied, result: { spaceId, assetIds: [allowedAssetId] } },
      { ...removeOperation, status: AgentOperationStatus.Failed, error: 'Asset permissions changed before apply' },
    ],
  });
  sharedSpaceService.addAssets.mockResolvedValue(undefined as never);

  const result = await sut.applyApprovedOperations(auth, session.id, plan.id, {
    operationIds: [addOperation.id, removeOperation.id],
  });

  expect(result.status).toBe(AgentOperationApplyStatus.PartiallyApplied);
  expect(result.appliedOperationIds).toEqual([addOperation.id]);
  expect(result.failedOperationIds).toEqual([removeOperation.id]);
  expect(sharedSpaceService.addAssets).toHaveBeenCalledWith(auth, spaceId, { assetIds: [allowedAssetId] });
  expect(sharedSpaceService.removeAssets).not.toHaveBeenCalled();
});
```

- [ ] **Step 6: Implement minimal apply fixes if tests fail**

If selected asset ids are not respected, adjust `server/src/services/agent-operation-plan.service.ts` in the existing selection preparation path so `preparedOperation.assetIds` is already filtered before `applyOperation()` sees it. The final `SpaceAddAssets` and `SpaceRemoveAssets` cases should remain simple:

```ts
case AgentOperationType.SpaceAddAssets: {
  const spaceId = this.resolveTargetSpaceId(operation, createdSpaceIdByTemporaryTargetId);
  await this.sharedSpaceService.addAssets(auth, spaceId, { assetIds: operation.assetIds });
  return this.appliedOperation(operation.id, { spaceId, assetIds: operation.assetIds });
}

case AgentOperationType.SpaceRemoveAssets: {
  const spaceId = this.resolveTargetSpaceId(operation, createdSpaceIdByTemporaryTargetId);
  await this.sharedSpaceService.removeAssets(auth, spaceId, { assetIds: operation.assetIds });
  return this.appliedOperation(operation.id, { spaceId, assetIds: operation.assetIds });
}
```

If access denial is only checked for one of add/remove, update the existing normal-access branch so both operation types require editor access.

- [ ] **Step 7: Run Task 2 tests**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs \
  src/dtos/agent-operation.dto.spec.ts \
  src/services/agent-operation-plan.service.spec.ts
```

Expected: PASS.

- [ ] **Step 8: Commit Task 2**

```bash
git add server/src/dtos/agent-operation.dto.ts \
  server/src/dtos/agent-operation.dto.spec.ts \
  server/src/services/agent-operation-plan.service.ts \
  server/src/services/agent-operation-plan.service.spec.ts
git commit -m "test: cover existing-space plan apply behavior"
```

---

## Task 3: MCP Runner Flow Coverage

**Files:**

- Modify: `server/src/services/agent-mcp.service.spec.ts`
- Modify: `server/src/services/agent-mcp-prompt.service.spec.ts`
- Modify only if tests expose a gap: `server/src/services/agent-mcp.service.ts`
- Modify only if tests expose a gap: `server/src/services/agent-tool.service.ts`
- Modify only if tests expose a gap: `server/src/services/agent-operation-plan.service.ts`

- [ ] **Step 1: Write a failing MCP sequence test for add-to-existing-space**

Add this to `server/src/services/agent-mcp.service.spec.ts`. It exercises the same gateway the first-party runner uses: list spaces, read one space, search candidate assets, then propose an existing-space plan.

```ts
it('supports the first-party runner sequence for adding assets to an existing space', async () => {
  const familySpaceId = '00000000-0000-4000-8000-000000000401';
  const alreadyInSpaceAssetId = '00000000-0000-4000-8000-000000000501';
  const newCandidateAssetId = '00000000-0000-4000-8000-000000000502';
  const secondNewCandidateAssetId = '00000000-0000-4000-8000-000000000503';

  toolService.listSpaces.mockResolvedValue({
    status: 'success',
    toolCall: null,
    spaces: [
      {
        id: familySpaceId,
        name: 'Family',
        description: null,
        color: 'blue',
        createdById: userId,
        assetCount: 1,
        memberCount: 1,
        thumbnailAssetId: null,
        recentAssetIds: [],
      },
    ],
  } as never);
  toolService.readSpace.mockResolvedValue({
    status: 'success',
    toolCall: null,
    space: {
      id: familySpaceId,
      name: 'Family',
      description: null,
      color: 'blue',
      createdById: userId,
      assetCount: 1,
      memberCount: 1,
      thumbnailAssetId: null,
      recentAssetIds: [],
      assetIds: [alreadyInSpaceAssetId],
      assetIdsReturned: 1,
      assetIdsTruncated: false,
      members: [{ userId, name: 'Pierre', role: 'owner', avatarColor: null, profileImagePath: null }],
    },
  } as never);
  toolService.searchAssets.mockResolvedValue({
    status: 'success',
    toolCall: null,
    assets: [{ id: alreadyInSpaceAssetId }, { id: newCandidateAssetId }, { id: secondNewCandidateAssetId }],
    total: 3,
  } as never);
  operationPlanService.proposeAlbumOperations.mockResolvedValue(makePlanningServiceResult('plan-space-add') as never);

  await sut.handle(auth, sessionId, makeToolCallRequest(AgentToolName.ListSpaces, {}));
  await sut.handle(auth, sessionId, makeToolCallRequest(AgentToolName.ReadSpace, { spaceId: familySpaceId }));
  await sut.handle(
    auth,
    sessionId,
    makeToolCallRequest(AgentToolName.SearchAssets, { filters: { city: 'Berlin' }, limit: 50 }),
  );
  const response = (await sut.handle(
    auth,
    sessionId,
    makeToolCallRequest(AgentToolName.ProposeAlbumOperations, {
      summary: 'Add recent Berlin photos to Family space.',
      operations: [
        {
          type: AgentOperationType.SpaceAddAssets,
          summary: 'Add 2 Berlin photos to Family space.',
          targetKind: AgentOperationTargetKind.ExistingSpace,
          targetId: familySpaceId,
          assetIds: [newCandidateAssetId, secondNewCandidateAssetId],
          payload: {},
        },
      ],
    }),
  )) as AgentMcpSuccessResponse;

  expect(toolService.listSpaces).toHaveBeenCalledWith(auth, sessionId, {});
  expect(toolService.readSpace).toHaveBeenCalledWith(auth, sessionId, { spaceId: familySpaceId });
  expect(toolService.searchAssets).toHaveBeenCalledWith(auth, sessionId, {
    filters: { city: 'Berlin' },
    limit: 50,
  });
  expect(operationPlanService.proposeAlbumOperations).toHaveBeenCalledWith(auth, sessionId, {
    summary: 'Add recent Berlin photos to Family space.',
    operations: [
      expect.objectContaining({
        type: AgentOperationType.SpaceAddAssets,
        targetKind: AgentOperationTargetKind.ExistingSpace,
        targetId: familySpaceId,
        assetIds: [newCandidateAssetId, secondNewCandidateAssetId],
        payload: {},
      }),
    ],
  });
  expectToolResult(
    response,
    `${AgentToolName.ProposeAlbumOperations}-call`,
    makePlanningServiceResult('plan-space-add'),
  );
});
```

Keep the important assertion that `alreadyInSpaceAssetId` is not in the proposed add operation. The scripted runner response is what encodes the model's deduping decision after seeing complete `readSpace` membership.

- [ ] **Step 2: Write a failing MCP sequence test for remove-from-existing-space**

Add a paired test in `server/src/services/agent-mcp.service.spec.ts`.

```ts
it('supports the first-party runner sequence for removing assets from an existing space', async () => {
  const familySpaceId = '00000000-0000-4000-8000-000000000401';
  const inSpaceAssetId = '00000000-0000-4000-8000-000000000501';
  const absentAssetId = '00000000-0000-4000-8000-000000000502';

  toolService.listSpaces.mockResolvedValue({
    status: 'success',
    toolCall: null,
    spaces: [{ id: familySpaceId, name: 'Family' }],
  } as never);
  toolService.readSpace.mockResolvedValue({
    status: 'success',
    toolCall: null,
    space: {
      id: familySpaceId,
      name: 'Family',
      assetIds: [inSpaceAssetId],
      assetIdsReturned: 1,
      assetIdsTruncated: false,
    },
  } as never);
  toolService.searchAssets.mockResolvedValue({
    status: 'success',
    toolCall: null,
    assets: [{ id: inSpaceAssetId }, { id: absentAssetId }],
    total: 2,
  } as never);
  operationPlanService.proposeAlbumOperations.mockResolvedValue(
    makePlanningServiceResult('plan-space-remove') as never,
  );

  await sut.handle(auth, sessionId, makeToolCallRequest(AgentToolName.ListSpaces, {}));
  await sut.handle(auth, sessionId, makeToolCallRequest(AgentToolName.ReadSpace, { spaceId: familySpaceId }));
  await sut.handle(
    auth,
    sessionId,
    makeToolCallRequest(AgentToolName.SearchAssets, { filters: { type: 'screenshot' }, limit: 50 }),
  );
  await sut.handle(
    auth,
    sessionId,
    makeToolCallRequest(AgentToolName.ProposeAlbumOperations, {
      summary: 'Remove screenshots from Family space.',
      operations: [
        {
          type: AgentOperationType.SpaceRemoveAssets,
          summary: 'Remove screenshots from Family space.',
          targetKind: AgentOperationTargetKind.ExistingSpace,
          targetId: familySpaceId,
          assetIds: [inSpaceAssetId],
          payload: {},
        },
      ],
    }),
  );

  expect(operationPlanService.proposeAlbumOperations).toHaveBeenCalledWith(auth, sessionId, {
    summary: 'Remove screenshots from Family space.',
    operations: [
      expect.objectContaining({
        type: AgentOperationType.SpaceRemoveAssets,
        targetKind: AgentOperationTargetKind.ExistingSpace,
        targetId: familySpaceId,
        assetIds: [inSpaceAssetId],
      }),
    ],
  });
});
```

The test documents the expected runner behavior: `absentAssetId` is not sent in `space.removeAssets` when `readSpace.assetIdsTruncated` is false.

- [ ] **Step 3: Add prompt tests for edge-case user-facing behavior**

Add to `server/src/services/agent-mcp-prompt.service.spec.ts`. These tests protect the parts that are model behavior rather than deterministic server code.

```ts
it('tells the runner what to do when existing-space membership is complete or truncated', () => {
  const prompt = sut.generatePromptCheatSheet();

  expect(prompt).toMatch(/assetIdsTruncated.*false/i);
  expect(prompt).toMatch(/exclude .*already .*space/i);
  expect(prompt).toMatch(/only remove .*already .*space/i);
  expect(prompt).toMatch(/assetIdsTruncated.*true/i);
  expect(prompt).toMatch(/narrow|ask/i);
});
```

- [ ] **Step 4: Add no-plan guidance tests for already-present and absent assets**

Add to `server/src/services/agent-mcp-prompt.service.spec.ts`.

```ts
it('guides the runner not to propose empty existing-space asset plans', () => {
  const prompt = sut.generatePromptCheatSheet();

  expect(prompt).toMatch(/all .*already .*space|already .*in .*space/i);
  expect(prompt).toMatch(/none .*in .*space|not .*in .*space/i);
  expect(prompt).toMatch(/no matching assets|no photos/i);
});

it('guides the runner to ask before planning ambiguous or missing spaces', () => {
  const prompt = sut.generatePromptCheatSheet();

  expect(prompt).toMatch(/ambiguous|multiple spaces/i);
  expect(prompt).toMatch(/no matching space|no space/i);
  expect(prompt).toMatch(/ask before planning|ask/i);
});
```

- [ ] **Step 5: Implement minimal MCP or prompt fixes if tests fail**

For MCP sequence failures, keep production behavior unchanged unless the gateway rejects valid `space.addAssets` / `space.removeAssets` requests. Valid calls should already dispatch through:

```ts
operationPlanService.proposeAlbumOperations(auth, sessionId, parsedDto);
```

For prompt failures, update `server/src/services/agent-mcp-prompt.service.ts` with compact guidance from Task 1. Do not add a new tool or server-side membership-deduping pass in this slice; the operation planner cannot know the model's prior `readSpace` result.

- [ ] **Step 6: Run Task 3 tests**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs \
  src/services/agent-mcp.service.spec.ts \
  src/services/agent-mcp-prompt.service.spec.ts
```

Expected: PASS.

- [ ] **Step 7: Commit Task 3**

```bash
git add server/src/services/agent-mcp.service.spec.ts \
  server/src/services/agent-mcp-prompt.service.spec.ts \
  server/src/services/agent-mcp.service.ts \
  server/src/services/agent-tool.service.ts \
  server/src/services/agent-operation-plan.service.ts
git commit -m "test: cover existing-space MCP runner flow"
```

---

## Task 4: Plan Review And Applied-Plan UI

**Files:**

- Modify: `web/src/routes/(user)/assistant/agent-operation-plan-ui.ts`
- Modify: `web/src/routes/(user)/assistant/agent-operation-plan-ui.spec.ts`
- Modify: `web/src/routes/(user)/assistant/agent-operation-plan-review-panel.spec.ts`
- Modify: `web/src/routes/(user)/assistant/agent-applied-plan-timeline-card.spec.ts`
- Modify: `web/src/routes/(user)/assistant/agent-session-chat-panel.spec.ts`
- Modify: `i18n/en.json`

- [ ] **Step 1: Write failing view-model tests for existing-space destination labels**

Add to `web/src/routes/(user)/assistant/agent-operation-plan-ui.spec.ts`.

```ts
it('groups existing-space add and remove operations under a human space destination', () => {
  const spaceId = '00000000-0000-4000-8000-000000000020';
  const addId = '00000000-0000-4000-8000-000000000101';
  const removeId = '00000000-0000-4000-8000-000000000102';
  const assetA = '00000000-0000-4000-8000-000000000201';
  const assetB = '00000000-0000-4000-8000-000000000202';

  const model = buildOperationReviewModel(
    plan([
      operation({
        id: addId,
        type: AgentOperationType.SpaceAddAssets,
        summary: 'Add Berlin photos to Family space.',
        targetKind: AgentOperationTargetKind.ExistingSpace,
        targetId: spaceId,
        assetIds: [assetA, assetB],
        payload: {},
      }),
      operation({
        id: removeId,
        type: AgentOperationType.SpaceRemoveAssets,
        summary: 'Remove screenshots from Family space.',
        targetKind: AgentOperationTargetKind.ExistingSpace,
        targetId: spaceId,
        assetIds: [assetA],
        payload: {},
        position: 1,
      }),
    ]),
    { [addId]: true, [removeId]: true },
  );

  expect(model.groups).toHaveLength(1);
  expect(model.groups[0].destination).toEqual(
    expect.objectContaining({
      kind: 'space',
      id: spaceId,
      subtitle: 'Existing space',
    }),
  );
  expect(model.operationsById.get(addId)?.summary).toBe('Add 2 photos');
  expect(model.operationsById.get(removeId)?.summary).toBe('Remove 1 photo');
  expect(model.operationsById.get(addId)?.review.selection).toMatchObject({
    itemKind: 'asset',
    totalCount: 2,
    selectedCount: 2,
    supportsItemSelection: true,
  });
});
```

Add capped-thumbnail coverage for large space selections.

```ts
it('caps representative thumbnails for large existing-space selections', () => {
  const assetIds = Array.from(
    { length: 1000 },
    (_, index) => `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
  );
  const addId = '00000000-0000-4000-8000-000000000101';

  const model = buildOperationReviewModel(
    plan([
      operation({
        id: addId,
        type: AgentOperationType.SpaceAddAssets,
        summary: 'Add many photos to Family.',
        targetKind: AgentOperationTargetKind.ExistingSpace,
        targetId: '00000000-0000-4000-8000-000000000020',
        assetIds,
        payload: {},
      }),
    ]),
    { [addId]: true },
  );

  expect(model.groups[0].thumbnailSummary.totalCount).toBe(1000);
  expect(model.groups[0].thumbnailSummary.representativeAssetIds).toHaveLength(12);
  expect(model.groups[0].thumbnailSummary.hasMore).toBe(true);
});
```

- [ ] **Step 2: Implement UI model support for space operation titles and destinations**

In `web/src/routes/(user)/assistant/agent-operation-plan-ui.ts`, extend `typeLabelKeys`:

```ts
[AgentOperationType.SpaceAddAssets]: 'assistant_operation_type_space_add_assets' as Translations,
[AgentOperationType.SpaceRemoveAssets]: 'assistant_operation_type_space_remove_assets' as Translations,
```

Add operation-title cases in `getOperationReviewSummary()` or the local title helper that currently handles album operations.

```ts
case AgentOperationType.SpaceAddAssets:
  return `Add ${formatPhotoCount(operation.assetIds.length)}`;
case AgentOperationType.SpaceRemoveAssets:
  return `Remove ${formatPhotoCount(operation.assetIds.length)}`;
```

Add `getGroupId()` space branches before the fallback:

```ts
if (operation.targetKind === AgentOperationTargetKind.NewSpace && operation.temporaryTargetId) {
  return `new-space:${operation.temporaryTargetId}`;
}

if (operation.targetKind === AgentOperationTargetKind.ExistingSpace && operation.targetId) {
  return `existing-space:${operation.targetId}`;
}
```

Then update `getGroupTitle()` so space groups do not fall back to raw operation ids:

```ts
if (operation.targetKind === AgentOperationTargetKind.NewSpace) {
  return `New space "${getSpaceName(operation) ?? operation.temporaryTargetId ?? 'Untitled space'}"`;
}

if (operation.targetKind === AgentOperationTargetKind.ExistingSpace) {
  return getSpaceName(operation) ?? stripSpaceActionPrefix(operation.summary);
}
```

Update `getReviewDestination()` space handling:

```ts
if (
  operation.targetKind === AgentOperationTargetKind.NewSpace ||
  operation.targetKind === AgentOperationTargetKind.ExistingSpace
) {
  const createOperation =
    operation.temporaryTargetId === null
      ? undefined
      : [...operationById.values()].find(
          (candidate) =>
            candidate.type === AgentOperationType.SpaceCreate &&
            candidate.temporaryTargetId === operation.temporaryTargetId,
        );
  const spaceName = getSpaceName(operation) ?? (createOperation ? getSpaceName(createOperation) : undefined);
  const destination: AgentReviewDestination = {
    kind: 'space',
    name: spaceName ?? stripSpaceActionPrefix(operation.summary),
    subtitle: operation.targetKind === AgentOperationTargetKind.NewSpace ? 'New space' : 'Existing space',
  };

  if (operation.targetId) {
    destination.id = operation.targetId;
  }

  if (operation.temporaryTargetId) {
    destination.temporaryId = operation.temporaryTargetId;
  }

  return destination;
}
```

Add helpers near `getAlbumName()`:

```ts
const getSpaceName = (operation: AgentOperationResponseDto) => {
  const value = operation.payload.spaceName;
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
};

const stripSpaceActionPrefix = (summary: string) =>
  summary
    .replace(/^add\s+.*?photos?\s+to\s+/i, '')
    .replace(/^remove\s+.*?photos?\s+from\s+/i, '')
    .replace(/\s+space\.?$/i, ' space')
    .trim() || summary;
```

Keep the helper conservative: if it cannot infer a name, use `operation.summary`.

- [ ] **Step 3: Add i18n keys**

In `i18n/en.json`, add:

```json
"assistant_operation_type_space_add_assets": "Add photos to space",
"assistant_operation_type_space_remove_assets": "Remove photos from space"
```

Use the file's existing ordering and JSON style.

- [ ] **Step 4: Write failing component tests for plan card and applied card**

Add to `web/src/routes/(user)/assistant/agent-operation-plan-review-panel.spec.ts`.

```ts
it('renders an existing-space asset plan with clear labels and bounded thumbnails', async () => {
  render(AgentOperationPlanReviewPanel, {
    props: {
      plan: plan([
        operation({
          id: addId,
          type: AgentOperationType.SpaceAddAssets,
          summary: 'Add Berlin photos to Family space.',
          targetKind: AgentOperationTargetKind.ExistingSpace,
          targetId: spaceId,
          assetIds: [assetA, assetB],
          payload: {},
        }),
      ]),
      assetThumbnails: new Map([
        [assetA, { id: assetA, url: '/api/assets/a/thumbnail' }],
        [assetB, { id: assetB, url: '/api/assets/b/thumbnail' }],
      ]),
      applying: false,
      onApply: vi.fn(),
    },
  });

  expect(await screen.findByText('Add 2 photos')).toBeInTheDocument();
  expect(screen.getByText('Existing space')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /apply/i })).toBeEnabled();
});
```

Add to `web/src/routes/(user)/assistant/agent-applied-plan-timeline-card.spec.ts`.

```ts
it('renders applied existing-space operations as a read-only card', () => {
  render(AgentAppliedPlanTimelineCard, {
    props: {
      appliedPlan: appliedPlan({
        operations: [
          operation({
            id: addId,
            type: AgentOperationType.SpaceAddAssets,
            summary: 'Add Berlin photos to Family space.',
            targetKind: AgentOperationTargetKind.ExistingSpace,
            targetId: spaceId,
            assetIds: [assetA, assetB],
            status: AgentOperationStatus.Applied,
            result: { spaceId, assetIds: [assetA, assetB] },
            payload: {},
          }),
        ],
      }),
    },
  });

  expect(screen.getByText(/applied plan/i)).toBeInTheDocument();
  expect(screen.getByText('Add 2 photos')).toBeInTheDocument();
  expect(screen.getByText(/Existing space/i)).toBeInTheDocument();
});
```

Add to `web/src/routes/(user)/assistant/agent-session-chat-panel.spec.ts` if no existing coverage proves applied cards remain separate from chat messages:

```ts
it('shows an applied existing-space plan card and keeps the composer available', async () => {
  sdkMock.getAgentSessionMessages.mockResolvedValue([
    makeMessage('message-user', AgentMessageRole.User, 'Add photos to Family'),
    makeMessage('message-assistant', AgentMessageRole.Assistant, 'Applied.'),
  ]);
  setAppliedPlanHistory([
    makeAppliedPlan({
      summary: 'Add photos to Family space.',
      operations: [
        makeOperation({
          id: 'operation-space-add',
          type: AgentOperationType.SpaceAddAssets,
          summary: 'Add photos to Family space.',
          targetKind: AgentOperationTargetKind.ExistingSpace,
          targetId: spaceId,
          temporaryTargetId: null,
          assetIds: [assetA],
          status: AgentOperationStatus.Applied,
          result: { spaceId, assetIds: [assetA] },
          payload: {},
        }),
      ],
    }),
  ]);

  render(AgentSessionChatPanel, { props: { session } });

  expect(await screen.findByRole('article', { name: 'Applied plan: Add photos to Family space.' })).toBeInTheDocument();
  expect(screen.getByRole('textbox', { name: 'Message' })).toBeEnabled();
});
```

Use the existing `makeMessage`, `makeOperation`, `makeAppliedPlan`, and `setAppliedPlanHistory` helpers in this spec file; do not introduce a second test factory style.

- [ ] **Step 5: Run Task 4 frontend tests**

Run:

```bash
pnpm --dir web exec vitest --run \
  'src/routes/(user)/assistant/agent-operation-plan-ui.spec.ts' \
  'src/routes/(user)/assistant/agent-operation-plan-review-panel.spec.ts' \
  'src/routes/(user)/assistant/agent-applied-plan-timeline-card.spec.ts' \
  'src/routes/(user)/assistant/agent-session-chat-panel.spec.ts'
```

Expected: PASS.

- [ ] **Step 6: Commit Task 4**

```bash
git add web/src/routes/\(user\)/assistant/agent-operation-plan-ui.ts \
  web/src/routes/\(user\)/assistant/agent-operation-plan-ui.spec.ts \
  web/src/routes/\(user\)/assistant/agent-operation-plan-review-panel.spec.ts \
  web/src/routes/\(user\)/assistant/agent-applied-plan-timeline-card.spec.ts \
  web/src/routes/\(user\)/assistant/agent-session-chat-panel.spec.ts \
  i18n/en.json
git commit -m "feat: present existing-space asset plans clearly"
```

---

## Task 5: Generated Artifacts And End-To-End Verification

**Files:**

- Modify: `agent-runner/src/generated/gallery-mcp-prompt-cheat-sheet.mjs`
- Modify: `docs/superpowers/generated/pi-agent-mcp-tools.md`

- [ ] **Step 1: Regenerate MCP docs and runner prompt**

Run the existing sync scripts used by the repo:

```bash
pnpm --dir server run sync:agent-mcp-docs
pnpm --dir server run sync:agent-mcp-prompt
```

Expected:

- `docs/superpowers/generated/pi-agent-mcp-tools.md` changes if contract/docs changed.
- `agent-runner/src/generated/gallery-mcp-prompt-cheat-sheet.mjs` changes if prompt guidance changed.

- [ ] **Step 2: Verify generated files contain Slice 2 guidance**

Run:

```bash
rg -n "add-assets-to-existing-space|remove-assets-from-existing-space|assetIdsTruncated|existing_space" \
  docs/superpowers/generated/pi-agent-mcp-tools.md \
  agent-runner/src/generated/gallery-mcp-prompt-cheat-sheet.mjs
```

Expected: Matches in both generated files.

- [ ] **Step 3: Run targeted server tests**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs \
  src/services/agent-mcp-tool-contract.service.spec.ts \
  src/services/agent-mcp-prompt.service.spec.ts \
  src/services/agent-mcp-docs.service.spec.ts \
  src/services/agent-mcp.service.spec.ts \
  src/dtos/agent-operation.dto.spec.ts \
  src/services/agent-operation-plan.service.spec.ts
```

Expected: PASS.

- [ ] **Step 4: Run targeted frontend tests**

Run:

```bash
pnpm --dir web exec vitest --run \
  'src/routes/(user)/assistant/agent-operation-plan-ui.spec.ts' \
  'src/routes/(user)/assistant/agent-operation-plan-review-panel.spec.ts' \
  'src/routes/(user)/assistant/agent-applied-plan-timeline-card.spec.ts' \
  'src/routes/(user)/assistant/agent-session-chat-panel.spec.ts'
```

Expected: PASS.

- [ ] **Step 5: Run lint/check on CI-friendly scope**

Run:

```bash
pnpm --filter immich check
git diff --check
```

Expected: PASS and no whitespace errors.

- [ ] **Step 6: Manual smoke test**

With `make dev` running and a session configured:

1. Open `/assistant`.
2. Ask: `Add my latest Berlin photos to the Family space.`
3. Confirm activity shows space lookup/read activity before a plan.
4. Confirm the plan card labels the destination as a space and shows `Add N photos`.
5. Exclude one asset and apply.
6. Confirm only selected assets are added to the space.
7. Confirm an applied-plan card appears in chat.
8. Send a follow-up message in the same chat and confirm the session continues.
9. Ask: `Remove screenshots from the Family space.`
10. Confirm the remove plan only contains assets that are currently in the space when `readSpace.assetIdsTruncated` is false.

- [ ] **Step 7: Commit generated artifacts and verification fixes**

```bash
git add agent-runner/src/generated/gallery-mcp-prompt-cheat-sheet.mjs \
  docs/superpowers/generated/pi-agent-mcp-tools.md
git commit -m "docs: update MCP guidance for existing-space asset plans"
```

---

## Self-Review Checklist

- [ ] The plan starts with failing tests before implementation for every behavior change.
- [ ] Existing-space add/remove examples use `targetKind: "existing_space"` and `targetId`.
- [ ] Album target kinds for space operations have correction hints.
- [ ] The assistant flow covers list spaces, read space, candidate asset lookup, proposed plan, apply, applied card, and chat continuation.
- [ ] Apply tests cover selected asset ids, disabled operations, user-excluded assets, permission denial, and partial failure.
- [ ] Prompt/docs cover ambiguous or missing spaces, no matching assets, already-in-space add dedupe, remove-only-membership behavior, and truncated membership caution.
- [ ] Frontend tests cover labels, destination grouping, item selection, applied cards, and large thumbnail caps.
- [ ] No direct MCP write/apply tool is added.
- [ ] Generated docs and prompt are regenerated and checked in.
