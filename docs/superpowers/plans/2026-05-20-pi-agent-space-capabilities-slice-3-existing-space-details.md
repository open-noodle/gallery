# Pi Agent Space Capabilities Slice 3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Pi reliably update existing shared-space details through reviewable plans for renames, description changes, description clears, and color changes.

**Architecture:** Reuse the existing `space.updateDetails` operation type and existing `SharedSpaceService.update` apply path. Tighten MCP examples, prompt guidance, DTO validation, assistant-flow coverage, plan review editable fields, and applied-plan summaries so the first-party runner resolves a visible space before proposing a field-level update plan.

**Tech Stack:** NestJS, Zod DTOs, Vitest, first-party MCP runner prompt generation, Svelte/TypeScript assistant UI, generated MCP docs.

---

## Slice Scope

Implement only `Slice 3: Update Existing Space Details` from `docs/superpowers/specs/2026-05-19-pi-agent-space-capabilities-design.md`.

In scope:

- Existing-space detail update plans using:
  - `space.updateDetails`
- Supported payload fields:
  - `spaceName`
  - `description`
  - `color`
- MCP examples and generated docs for rename, description update/clear, and color update.
- Validation hints for empty update payloads, unsupported fields, missing `targetId`, wrong target kind, and unsupported direct mutation tool names.
- Runner prompt guidance that tells Pi to call `listSpaces` and `readSpace` before proposing existing-space detail changes.
- Assistant-flow coverage for resolving a space by name, avoiding no-op updates when read context shows the requested value already matches, and proposing `space.updateDetails`.
- Server apply tests that prove only supported fields reach `SharedSpaceService.update`.
- Plan review and applied-plan card copy that show changed fields in user language and keep technical ids hidden by default.
- Inline review-field edits for `spaceName`, `description`, and `color` when the plan review UI supports editable fields.

Out of scope:

- Space creation, deletion, member management, asset add/remove, thumbnail/representative face changes, pets, face recognition, linked libraries, and direct mutation MCP tools.
- Adding new permission presets.
- Large-space pagination.

---

## Key Decisions

- Detail updates remain plan-only. Pi must use `mcp_gallery_proposeAlbumOperations` or `mcp_gallery_reviseProposedOperations`; it must not call a direct space update tool.
- `space.updateDetails` always targets `targetKind: "existing_space"` and `targetId` from `listSpaces` or `readSpace`.
- `description: ""` means clear the description. Omitting `description` means leave it unchanged.
- The update payload must contain at least one supported field after validation.
- Color values must be one of Gallery's `UserAvatarColor` values: `primary`, `pink`, `red`, `yellow`, `blue`, `green`, `purple`, `orange`, `gray`, `amber`.
- The runner prompt should tell Pi to compare requested changes with the current `readSpace` values. If the request is already true, Pi should answer in chat instead of proposing a no-op plan.
- Field overrides should be sparse: unchanged inline fields must not be sent in `fieldOverrides`.
- Operation ids and raw space ids stay hidden in the normal review card and only appear in technical details.

---

## Test Matrix

| Layer                 | Cases                                                                                                                                                                                                                                                                                |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| MCP contract examples | Separate examples parse for rename, description update/clear, and color update. Every example uses `targetKind: "existing_space"`, includes `targetId`, has no `temporaryTargetId`, has no `assetIds`, and includes only supported payload fields.                                   |
| MCP validation hints  | Empty payload, wrong target kind, missing target id, direct mutation names, and unsupported fields such as `thumbnail`, `petsEnabled`, `faceRecognitionEnabled`, `libraryIds`, and `delete` produce model-actionable correction hints.                                               |
| Runner prompt         | Prompt includes `mcp_gallery_listSpaces`, `mcp_gallery_readSpace`, `space.updateDetails`, supported field names, color values, no-op guidance, and direct-write prohibition while staying under the prompt size guard.                                                               |
| Generated docs        | Generated MCP docs include focused detail-update examples, common mistakes, supported fields, no-op guidance, and remain in sync with the renderer.                                                                                                                                  |
| DTO validation        | `space.updateDetails` accepts name-only, description-only, color-only, multi-field, and description-clear payloads. It rejects empty payloads, invalid colors, unsupported fields, album/new-space target shapes, missing target id, `temporaryTargetId`, and accidental `assetIds`. |
| Apply service         | Apply calls `SharedSpaceService.update(auth, spaceId, dto)` with only `{ name, description, color }`; field overrides merge into the payload; unsupported overrides fail before claiming the plan; permission denial and stale membership fail before downstream update.             |
| Assistant flow        | Pi lists spaces, resolves the intended visible space, reads current details, proposes a field-level update plan, shows a review card, applies it, shows the applied-plan card, and keeps chat open. Ambiguous/no-match/no-op prompts produce chat guidance instead of guessed plans. |
| Frontend review UI    | Review cards group the update under the space destination, show changed fields without operation ids, expose inline editable fields for `spaceName`, `description`, and `color`, validate edits, and send sparse `fieldOverrides`.                                                   |
| Applied-plan UI       | Applied cards summarize changed fields such as `Renamed to "Family 2026"`, `Updated description`, `Cleared description`, and `Changed color to blue`.                                                                                                                                |
| Edge cases            | Ambiguous space name, no matching space, requested name equals current name, description cleared versus unchanged, invalid color, permission denial, deleted/removed membership before apply, multiple fields changed in one operation.                                              |

---

## Files To Modify

- `server/src/services/agent-mcp-tool-contract.service.ts`
- `server/src/services/agent-mcp-tool-contract.service.spec.ts`
- `server/src/services/agent-mcp-prompt.service.ts`
- `server/src/services/agent-mcp-prompt.service.spec.ts`
- `server/src/services/agent-mcp-docs.service.spec.ts`
- `server/src/services/agent-mcp.service.spec.ts`
- `server/src/dtos/agent-operation.dto.ts`
- `server/src/dtos/agent-operation.dto.spec.ts`
- `server/src/services/agent-operation-plan.service.ts`
- `server/src/services/agent-operation-plan.service.spec.ts`
- `agent-runner/src/generated/gallery-mcp-prompt-cheat-sheet.mjs`
- `docs/superpowers/generated/pi-agent-mcp-tools.md`
- `web/src/routes/(user)/assistant/agent-operation-plan-ui.ts`
- `web/src/routes/(user)/assistant/agent-operation-plan-ui.spec.ts`
- `web/src/routes/(user)/assistant/agent-operation-plan-review-panel.spec.ts`
- `web/src/routes/(user)/assistant/agent-applied-plan-timeline-card.spec.ts`
- `web/src/routes/(user)/assistant/agent-session-chat-panel.spec.ts`
- `web/src/routes/(user)/assistant/agent-plan-inline-field-editor.svelte`
- `web/src/routes/(user)/assistant/agent-plan-inline-field-editor.spec.ts`
- `i18n/en.json`

---

## Task 1: MCP Contract, Prompt, And Generated Docs

**Files:**

- Modify: `server/src/services/agent-mcp-tool-contract.service.ts`
- Modify: `server/src/services/agent-mcp-tool-contract.service.spec.ts`
- Modify: `server/src/services/agent-mcp-prompt.service.ts`
- Modify: `server/src/services/agent-mcp-prompt.service.spec.ts`
- Modify: `server/src/services/agent-mcp-docs.service.spec.ts`
- Modify: `server/src/services/agent-mcp.service.spec.ts`
- Regenerate: `agent-runner/src/generated/gallery-mcp-prompt-cheat-sheet.mjs`
- Regenerate: `docs/superpowers/generated/pi-agent-mcp-tools.md`

- [ ] **Step 1: Write failing contract tests for focused update examples**

Add this test to `server/src/services/agent-mcp-tool-contract.service.spec.ts`.

```ts
it('defines focused existing-space detail update examples with only supported fields', () => {
  const contract = sut.getPlanningToolContract(AgentToolName.ProposeAlbumOperations);
  const expected = [
    { name: 'rename-existing-space', payload: { spaceName: 'Family 2026' } },
    { name: 'update-existing-space-description', payload: { description: 'Photos for everyone.' } },
    { name: 'clear-existing-space-description', payload: { description: '' } },
    { name: 'update-existing-space-color', payload: { color: 'blue' } },
  ];

  for (const expectation of expected) {
    const example = contract?.examples.find((candidate) => candidate.name === expectation.name);

    expect(example, expectation.name).toBeDefined();
    const parsed = AgentOperationPlanToolRequestSchemas[AgentToolName.ProposeAlbumOperations].parse(example?.arguments);
    expect(parsed.operations).toHaveLength(1);
    expect(parsed.operations[0]).toMatchObject({
      type: AgentOperationType.SpaceUpdateDetails,
      targetKind: AgentOperationTargetKind.ExistingSpace,
      targetId: '00000000-0000-4000-8000-000000000020',
      payload: expectation.payload,
    });
    expect(parsed.operations[0]).not.toHaveProperty('temporaryTargetId');
    expect(parsed.operations[0]).not.toHaveProperty('assetIds');
  }
});
```

Add this test near the common-mistake/failure-matrix assertions.

```ts
it('documents actionable correction hints for invalid space detail updates', () => {
  const contract = sut.getPlanningToolContract(AgentToolName.ProposeAlbumOperations);
  const mistakeIds = contract?.commonMistakes.map((mistake) => mistake.id);
  const failureCaseIds = sut.listRuntimeFailureMatrixCases().map((failureCase) => failureCase.id);

  expect(mistakeIds).toEqual(
    expect.arrayContaining([
      'planning-space-update-empty-payload',
      'planning-space-update-unsupported-fields',
      'planning-space-update-missing-target-id',
      'planning-direct-space-mutation',
    ]),
  );
  expect(failureCaseIds).toEqual(
    expect.arrayContaining([
      'planning-space-update-empty-payload',
      'planning-space-update-unsupported-fields',
      'planning-space-update-missing-target-id',
    ]),
  );

  const unsupported = contract?.commonMistakes.find(
    (mistake) => mistake.id === 'planning-space-update-unsupported-fields',
  );
  expect(unsupported?.hint).toMatch(/spaceName/i);
  expect(unsupported?.hint).toMatch(/description/i);
  expect(unsupported?.hint).toMatch(/color/i);
  expect(unsupported?.hint).toMatch(/thumbnail|pets|face|linked|delete/i);
});
```

- [ ] **Step 2: Run the contract test and confirm RED**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-mcp-tool-contract.service.spec.ts
```

Expected: FAIL because the focused examples and correction-hint rows are missing or incomplete.

- [ ] **Step 3: Implement contract examples and correction hints**

In `server/src/services/agent-mcp-tool-contract.service.ts`, add four planning examples for `rename-existing-space`, `update-existing-space-description`, `clear-existing-space-description`, and `update-existing-space-color`. Keep the existing broad `update-space-details` example only if it still adds value, but make the focused examples the ones referenced by mistakes.

Add common mistakes:

```ts
{
  id: 'planning-space-update-empty-payload',
  match: { issuePath: 'operations.0.payload', requestShape: 'tool-arguments' },
  hint: 'space.updateDetails payload must include at least one of spaceName, description, or color.',
  exampleName: 'rename-existing-space',
},
{
  id: 'planning-space-update-unsupported-fields',
  match: { issuePath: 'operations.0.payload', requestShape: 'tool-arguments' },
  hint:
    'space.updateDetails only supports spaceName, description, and color. Do not include thumbnail, pets, face recognition, linked libraries, or deletion fields.',
  exampleName: 'update-existing-space-description',
},
{
  id: 'planning-space-update-missing-target-id',
  match: { issuePath: 'operations.0.targetId', requestShape: 'tool-arguments' },
  hint: 'Existing-space detail updates require targetKind "existing_space" and targetId from listSpaces/readSpace.',
  exampleName: 'rename-existing-space',
},
{
  id: 'planning-direct-space-mutation',
  match: { messageIncludes: 'Unknown tool', requestShape: 'json-rpc' },
  hint: 'Do not call direct space mutation tools. Propose a reviewable space.updateDetails plan instead.',
  exampleName: 'update-existing-space-color',
},
```

Add matching runtime failure-matrix rows for empty payload, unsupported fields, and missing target id using `AgentOperationType.SpaceUpdateDetails`.

- [ ] **Step 4: Write failing prompt and docs tests**

Add to `server/src/services/agent-mcp-prompt.service.spec.ts`.

```ts
it('guides the runner through existing-space detail updates without direct writes', () => {
  const prompt = sut.generatePromptCheatSheet();
  const examples = sut.listPromptExamples();

  expect(examples).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ exampleName: 'rename-existing-space' }),
      expect.objectContaining({ exampleName: 'update-existing-space-description' }),
      expect.objectContaining({ exampleName: 'clear-existing-space-description' }),
      expect.objectContaining({ exampleName: 'update-existing-space-color' }),
    ]),
  );
  expect(prompt).toContain('mcp_gallery_listSpaces');
  expect(prompt).toContain('mcp_gallery_readSpace');
  expect(prompt).toContain('space.updateDetails');
  expect(prompt).toContain('spaceName');
  expect(prompt).toContain('description');
  expect(prompt).toContain('color');
  expect(prompt).toMatch(/already|no-op|no change/i);
  expect(prompt).not.toContain('mcp_gallery_updateSpace');
});
```

Add to `server/src/services/agent-mcp-docs.service.spec.ts`.

```ts
it('documents existing-space detail updates, supported fields, and no-op guidance', () => {
  const markdown = sut.generateMarkdown();

  expect(markdown).toContain('rename-existing-space');
  expect(markdown).toContain('update-existing-space-description');
  expect(markdown).toContain('clear-existing-space-description');
  expect(markdown).toContain('update-existing-space-color');
  expect(markdown).toContain('space.updateDetails');
  expect(markdown).toContain('spaceName');
  expect(markdown).toContain('description');
  expect(markdown).toContain('color');
  expect(markdown).toMatch(/thumbnail|pets|face|linked|delete/i);
});
```

- [ ] **Step 5: Implement prompt/docs guidance and regenerate committed artifacts**

Update `server/src/services/agent-mcp-prompt.service.ts` so the compact prompt includes:

```text
Space detail updates: use listSpaces/readSpace first. Propose space.updateDetails only for existing_space targetId. Supported fields: spaceName, description, color. description "" clears it; omitted fields stay unchanged. If readSpace already matches the requested value, answer without a plan. Do not update thumbnails, pets, face recognition, linked libraries, or delete spaces.
```

Regenerate generated files:

```bash
pnpm --dir server run sync:agent-mcp-docs
pnpm --dir server run sync:agent-mcp-prompt
```

- [ ] **Step 6: Run Task 1 tests and confirm GREEN**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-mcp-tool-contract.service.spec.ts src/services/agent-mcp-prompt.service.spec.ts src/services/agent-mcp-docs.service.spec.ts
```

Expected: PASS.

---

## Task 2: DTO Validation And Model-Actionable Errors

**Files:**

- Modify: `server/src/dtos/agent-operation.dto.ts`
- Modify: `server/src/dtos/agent-operation.dto.spec.ts`
- Modify: `server/src/services/agent-mcp.service.spec.ts`

- [ ] **Step 1: Write failing DTO validation tests**

Add these cases to `server/src/dtos/agent-operation.dto.spec.ts`.

```ts
it('validates supported existing-space detail update payload shapes', () => {
  const spaceId = newUuid();
  const base = {
    summary: 'Update Family space.',
    operations: [
      {
        type: AgentOperationType.SpaceUpdateDetails,
        summary: 'Update Family space.',
        targetKind: AgentOperationTargetKind.ExistingSpace,
        targetId: spaceId,
        payload: {},
      },
    ],
  };

  for (const payload of [
    { spaceName: 'Family 2026' },
    { description: 'Photos for everyone.' },
    { description: '' },
    { color: 'blue' },
    { spaceName: 'Family 2026', description: '', color: 'amber' },
  ]) {
    expect(
      AgentOperationPlanToolRequestSchemas[AgentToolName.ProposeAlbumOperations].safeParse({
        ...base,
        operations: [{ ...base.operations[0], payload }],
      }).success,
    ).toBe(true);
  }
});
```

Add rejection assertions:

```ts
it('rejects invalid existing-space detail update payloads with actionable messages', () => {
  const spaceId = newUuid();
  const parse = (operation: Record<string, unknown>) =>
    AgentOperationPlanToolRequestSchemas[AgentToolName.ProposeAlbumOperations].safeParse({
      summary: 'Update Family space.',
      operations: [operation],
    });
  const base = {
    type: AgentOperationType.SpaceUpdateDetails,
    summary: 'Update Family space.',
    targetKind: AgentOperationTargetKind.ExistingSpace,
    targetId: spaceId,
  };

  const emptyPayload = parse({ ...base, payload: {} });
  expect(emptyPayload.success).toBe(false);
  if (emptyPayload.success) {
    throw new Error('Expected empty space update payload to fail validation');
  }
  expect(z.treeifyError(emptyPayload.error).properties?.operations?.items?.[0]?.properties?.payload?.errors).toContain(
    'Provide spaceName, description, or color',
  );

  for (const payload of [
    { thumbnailAssetId: newUuid() },
    { petsEnabled: false },
    { faceRecognitionEnabled: true },
    { linkedLibraryIds: [newUuid()] },
    { delete: true },
  ]) {
    const result = parse({ ...base, payload });
    expect(result.success).toBe(false);
    if (result.success) {
      throw new Error(`Expected unsupported space update payload ${JSON.stringify(payload)} to fail validation`);
    }
    expect(JSON.stringify(z.treeifyError(result.error))).toMatch(/Unrecognized key|unsupported/i);
  }

  const invalidColor = parse({ ...base, payload: { color: '#80c7ff' } });
  expect(invalidColor.success).toBe(false);
  if (invalidColor.success) {
    throw new Error('Expected invalid space color to fail validation');
  }
  expect(JSON.stringify(z.treeifyError(invalidColor.error))).toMatch(/color/i);
});
```

Add target-shape assertions:

```ts
it('requires existing-space target id and rejects temporary targets or asset ids for detail updates', () => {
  const spaceId = newUuid();
  const base = {
    type: AgentOperationType.SpaceUpdateDetails,
    summary: 'Update Family space.',
    targetKind: AgentOperationTargetKind.ExistingSpace,
    targetId: spaceId,
    payload: { spaceName: 'Family 2026' },
  };

  for (const operation of [
    { ...base, targetId: undefined },
    { ...base, targetKind: AgentOperationTargetKind.NewSpace, temporaryTargetId: 'tmp-space', targetId: undefined },
    { ...base, temporaryTargetId: 'tmp-space' },
    { ...base, assetIds: [newUuid()] },
  ]) {
    expect(
      AgentOperationPlanToolRequestSchemas[AgentToolName.ProposeAlbumOperations].safeParse({
        summary: 'Update Family space.',
        operations: [operation],
      }).success,
    ).toBe(false);
  }
});
```

- [ ] **Step 2: Run DTO tests and confirm RED**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/dtos/agent-operation.dto.spec.ts
```

Expected: FAIL for any missing strictness or unclear empty-payload message.

- [ ] **Step 3: Implement minimal DTO fixes**

In `server/src/dtos/agent-operation.dto.ts`:

- Keep `spaceDetailsPayload` strict.
- Ensure `updateSpaceDetailsOperationSchema` uses `ExistingSpaceTargetKindSchema`.
- Ensure `targetId` is required through `validateSpaceTarget`.
- Ensure `payload` rejects empty objects with exactly `Provide spaceName, description, or color`.
- Ensure `description: ''` is accepted.
- Ensure `color` uses `UserAvatarColorSchema`.
- Do not add `assetIds`, `temporaryTargetId`, or unsupported fields to the allowed schema.

- [ ] **Step 4: Add MCP invalid-shape regression tests for correction hints**

Add malformed-planning cases to the existing `returns isError tool result for malformed planning arguments` table in `server/src/services/agent-mcp.service.spec.ts`:

```ts
{
  name: 'space detail update empty payload',
  toolName: AgentToolName.ProposeAlbumOperations,
  args: {
    summary: 'Update Family.',
    operations: [
      {
        type: AgentOperationType.SpaceUpdateDetails,
        summary: 'Update Family.',
        targetKind: AgentOperationTargetKind.ExistingSpace,
        targetId: factory.uuid(),
        payload: {},
      },
    ],
  },
  expectedPath: 'operations.0.payload',
},
{
  name: 'space detail update unsupported field',
  toolName: AgentToolName.ProposeAlbumOperations,
  args: {
    summary: 'Update Family thumbnail.',
    operations: [
      {
        type: AgentOperationType.SpaceUpdateDetails,
        summary: 'Update Family thumbnail.',
        targetKind: AgentOperationTargetKind.ExistingSpace,
        targetId: factory.uuid(),
        payload: { thumbnailAssetId: factory.uuid() },
      },
    ],
  },
  expectedPath: 'operations.0.payload',
},
```

Add actionable-correction cases to the existing `returns an actionable planning correction for $id` table:

```ts
{
  id: 'planning-space-update-empty-payload',
  hintIncludes: 'spaceName',
  expectedIncludes: 'reviewable Gallery operation plan',
},
{
  id: 'planning-space-update-unsupported-fields',
  hintIncludes: 'thumbnail',
  expectedIncludes: 'reviewable Gallery operation plan',
},
{
  id: 'planning-space-update-missing-target-id',
  hintIncludes: 'targetId',
  expectedIncludes: 'reviewable Gallery operation plan',
},
```

- [ ] **Step 5: Run Task 2 tests and confirm GREEN**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/dtos/agent-operation.dto.spec.ts src/services/agent-mcp.service.spec.ts
```

Expected: PASS.

---

## Task 3: Apply Path, Permissions, Stale-State Handling, And Field Overrides

**Files:**

- Modify: `server/src/services/agent-operation-plan.service.ts`
- Modify: `server/src/services/agent-operation-plan.service.spec.ts`

- [ ] **Step 1: Write failing apply tests for supported fields only**

Add to `server/src/services/agent-operation-plan.service.spec.ts`.

```ts
it('applies existing-space detail updates with only supported shared-space fields', async () => {
  const auth = AuthFactory.create();
  const session = makeSession({
    userId: auth.user.id,
    status: AgentSessionStatus.WaitingForPlanReview,
    permissionPlanSnapshot: expandedPermissionPlanSnapshot,
  });
  const spaceId = newUuid();
  const operation = makeOperation({
    id: newUuid(),
    planId: 'plan-id',
    type: AgentOperationType.SpaceUpdateDetails,
    targetKind: AgentOperationTargetKind.ExistingSpace,
    targetId: spaceId,
    payload: { spaceName: 'Family 2026', description: '', color: UserAvatarColor.Blue },
  });
  const plan = makePlan({ id: 'plan-id', sessionId: session.id, operations: [operation] });
  sessionRepository.getById.mockResolvedValue(session);
  planRepository.getByIdForSession.mockResolvedValue(plan);
  planRepository.getCurrentBySessionId.mockResolvedValue(plan);
  planRepository.claimCurrentForApply.mockResolvedValue({ ...plan, status: AgentOperationPlanStatus.Applied });
  planRepository.completeApply.mockImplementation((planId, updates) =>
    Promise.resolve(applyUpdatesToPlan({ ...plan, id: planId }, updates)),
  );
  accessRepository.sharedSpace.checkRoleAccess.mockResolvedValue(new Set([spaceId]));
  sharedSpaceService.update.mockResolvedValue({ id: spaceId } as never);

  const result = await sut.applyApprovedOperations(auth, session.id, plan.id, { operationIds: [operation.id] });

  expect(result.status).toBe(AgentOperationApplyStatus.Applied);
  expect(sharedSpaceService.update).toHaveBeenCalledWith(auth, spaceId, {
    name: 'Family 2026',
    description: '',
    color: UserAvatarColor.Blue,
  });
});
```

- [ ] **Step 2: Write failing field-override tests**

Add:

```ts
it('merges sparse existing-space field overrides into the apply payload', async () => {
  const auth = AuthFactory.create();
  const session = makeSession({
    userId: auth.user.id,
    status: AgentSessionStatus.WaitingForPlanReview,
    permissionPlanSnapshot: expandedPermissionPlanSnapshot,
  });
  const spaceId = newUuid();
  const operation = makeOperation({
    id: newUuid(),
    planId: 'plan-id',
    type: AgentOperationType.SpaceUpdateDetails,
    targetKind: AgentOperationTargetKind.ExistingSpace,
    targetId: spaceId,
    payload: { spaceName: 'Family', description: 'Old', color: UserAvatarColor.Gray },
  });
  const plan = makePlan({ id: 'plan-id', sessionId: session.id, operations: [operation] });
  sessionRepository.getById.mockResolvedValue(session);
  planRepository.getByIdForSession.mockResolvedValue(plan);
  planRepository.getCurrentBySessionId.mockResolvedValue(plan);
  planRepository.claimCurrentForApply.mockResolvedValue({ ...plan, status: AgentOperationPlanStatus.Applied });
  planRepository.completeApply.mockImplementation((planId, updates) =>
    Promise.resolve(applyUpdatesToPlan({ ...plan, id: planId }, updates)),
  );
  accessRepository.sharedSpace.checkRoleAccess.mockResolvedValue(new Set([spaceId]));
  sharedSpaceService.update.mockResolvedValue({ id: spaceId } as never);

  await sut.applyApprovedOperations(auth, session.id, plan.id, {
    operationIds: [operation.id],
    fieldOverrides: {
      [operation.id]: { spaceName: 'Family 2026', description: '', color: UserAvatarColor.Blue },
    },
  });

  expect(sharedSpaceService.update).toHaveBeenCalledWith(auth, spaceId, {
    name: 'Family 2026',
    description: '',
    color: UserAvatarColor.Blue,
  });
});
```

Add unsupported override assertions:

```ts
it.each([
  { thumbnailAssetId: newUuid() },
  { petsEnabled: 'false' },
  { faceRecognitionEnabled: 'true' },
  { linkedLibraryIds: newUuid() },
  { delete: 'true' },
])('rejects unsupported existing-space field override %o before claiming the plan', async (fieldOverrides) => {
  const auth = AuthFactory.create();
  const session = makeSession({
    userId: auth.user.id,
    status: AgentSessionStatus.WaitingForPlanReview,
    permissionPlanSnapshot: expandedPermissionPlanSnapshot,
  });
  const operation = makeOperation({
    id: newUuid(),
    planId: 'plan-id',
    type: AgentOperationType.SpaceUpdateDetails,
    targetKind: AgentOperationTargetKind.ExistingSpace,
    targetId: newUuid(),
    payload: { spaceName: 'Family' },
  });
  const plan = makePlan({ id: 'plan-id', sessionId: session.id, operations: [operation] });
  sessionRepository.getById.mockResolvedValue(session);
  planRepository.getByIdForSession.mockResolvedValue(plan);
  planRepository.getCurrentBySessionId.mockResolvedValue(plan);

  await expect(
    sut.applyApprovedOperations(auth, session.id, plan.id, {
      operationIds: [operation.id],
      fieldOverrides: { [operation.id]: fieldOverrides as Record<string, string> },
    }),
  ).rejects.toThrow('Unsupported field override for operation type');

  expect(planRepository.claimCurrentForApply).not.toHaveBeenCalled();
  expect(sharedSpaceService.update).not.toHaveBeenCalled();
});
```

- [ ] **Step 3: Write failing permission and stale-state tests**

Add:

```ts
it('denies existing-space detail updates when the agent permission plan disallows them', async () => {
  const auth = AuthFactory.create();
  const session = makeSession({
    userId: auth.user.id,
    permissionPlanSnapshot: {
      ...expandedPermissionPlanSnapshot,
      writeScope: { ...expandedPermissionPlanSnapshot.writeScope, updateSpaceDetails: false },
    },
  });
  sessionRepository.getById.mockResolvedValue(session);

  await expect(
    sut.proposeAlbumOperations(auth, session.id, {
      summary: 'Rename Family.',
      operations: [
        {
          type: AgentOperationType.SpaceUpdateDetails,
          summary: 'Rename Family.',
          targetKind: AgentOperationTargetKind.ExistingSpace,
          targetId: newUuid(),
          payload: { spaceName: 'Family 2026' },
          enabled: true,
          riskLevel: AgentOperationRiskLevel.Low,
        },
      ],
    }),
  ).rejects.toThrow('Agent permission policy does not allow updating space details');
});
```

Add stale access:

```ts
it('fails existing-space detail updates that lose edit access before apply', async () => {
  const auth = AuthFactory.create();
  const session = makeSession({
    userId: auth.user.id,
    status: AgentSessionStatus.WaitingForPlanReview,
    permissionPlanSnapshot: expandedPermissionPlanSnapshot,
  });
  const spaceId = newUuid();
  const operation = makeOperation({
    id: newUuid(),
    planId: 'plan-id',
    type: AgentOperationType.SpaceUpdateDetails,
    targetKind: AgentOperationTargetKind.ExistingSpace,
    targetId: spaceId,
    payload: { description: 'Photos for everyone.' },
  });
  const plan = makePlan({ id: 'plan-id', sessionId: session.id, operations: [operation] });
  sessionRepository.getById.mockResolvedValue(session);
  planRepository.getByIdForSession.mockResolvedValue(plan);
  planRepository.getCurrentBySessionId.mockResolvedValue(plan);
  planRepository.claimCurrentForApply.mockResolvedValue({ ...plan, status: AgentOperationPlanStatus.Applied });
  planRepository.completeApply.mockImplementation((planId, updates) =>
    Promise.resolve(applyUpdatesToPlan({ ...plan, id: planId }, updates)),
  );
  accessRepository.sharedSpace.checkRoleAccess.mockResolvedValue(new Set());

  const result = await sut.applyApprovedOperations(auth, session.id, plan.id, { operationIds: [operation.id] });

  expect(result.status).toBe(AgentOperationApplyStatus.Failed);
  expect(result.failedOperationIds).toEqual([operation.id]);
  expect(sharedSpaceService.update).not.toHaveBeenCalled();
});
```

- [ ] **Step 4: Run apply tests and confirm RED**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-operation-plan.service.spec.ts
```

Expected: FAIL for any missing detail-update apply behavior, permission check, field override, or stale-state handling.

- [ ] **Step 5: Implement minimal service fixes**

In `server/src/services/agent-operation-plan.service.ts`:

- Keep `validateOperationAgainstPermissionPlan` checking `writeScope.updateSpaceDetails`.
- Keep target access validation using `accessRepository.sharedSpace.checkRoleAccess`.
- In `applyOperation`, map `payload.spaceName` to shared-space DTO `name`.
- Preserve `description: ''` and do not coerce it to `undefined`.
- Map `payload.color` to shared-space DTO `color`.
- Ensure `normalizeOperationFieldOverrides` accepts only `spaceName`, `description`, `color`, and `targetSpaceId` for `SpaceUpdateDetails`.
- Reject unsupported overrides before `claimCurrentForApply`.

- [ ] **Step 6: Run Task 3 tests and confirm GREEN**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-operation-plan.service.spec.ts
```

Expected: PASS.

---

## Task 4: Assistant-Flow Regressions For Natural Space Detail Prompts

**Files:**

- Modify: `server/src/services/agent-mcp.service.spec.ts`
- Modify: `server/src/services/agent-mcp-prompt.service.ts`
- Modify: `server/src/services/agent-mcp-prompt.service.spec.ts`

- [ ] **Step 1: Write failing runner sequence tests for rename, description, and color**

Add to `server/src/services/agent-mcp.service.spec.ts`, near the existing first-party runner sequence tests.

```ts
it('supports the first-party runner sequence for updating existing space details', async () => {
  const familySpaceId = '00000000-0000-4000-8000-000000000401';
  const serviceResult = makePlanningServiceResult('plan-space-update');

  toolService.listSpaces.mockResolvedValue({
    status: 'success',
    toolCall: null,
    spaces: [{ id: familySpaceId, name: 'Family', description: 'Old notes', color: 'gray' }],
  } as never);
  toolService.readSpace.mockResolvedValue({
    status: 'success',
    toolCall: null,
    space: {
      id: familySpaceId,
      name: 'Family',
      description: 'Old notes',
      color: 'gray',
      assetIds: [],
      assetIdsReturned: 0,
      assetIdsTruncated: false,
    },
  } as never);
  operationPlanService.proposeAlbumOperations.mockResolvedValue(serviceResult as never);

  await sut.handle(auth, sessionId, makeToolCallRequest(AgentToolName.ListSpaces, {}));
  await sut.handle(auth, sessionId, makeToolCallRequest(AgentToolName.ReadSpace, { spaceId: familySpaceId }));
  const response = (await sut.handle(
    auth,
    sessionId,
    makeToolCallRequest(AgentToolName.ProposeAlbumOperations, {
      summary: 'Update Family space details.',
      operations: [
        {
          type: AgentOperationType.SpaceUpdateDetails,
          summary: 'Rename Family and update its description and color.',
          targetKind: AgentOperationTargetKind.ExistingSpace,
          targetId: familySpaceId,
          payload: { spaceName: 'Family 2026', description: 'Photos for everyone.', color: 'blue' },
        },
      ],
    }),
  )) as AgentMcpSuccessResponse;

  expect(toolService.listSpaces).toHaveBeenCalledWith(auth, sessionId, {});
  expect(toolService.readSpace).toHaveBeenCalledWith(auth, sessionId, { spaceId: familySpaceId });
  expect(operationPlanService.proposeAlbumOperations).toHaveBeenCalledWith(auth, sessionId, {
    summary: 'Update Family space details.',
    operations: [
      expect.objectContaining({
        type: AgentOperationType.SpaceUpdateDetails,
        targetKind: AgentOperationTargetKind.ExistingSpace,
        targetId: familySpaceId,
        payload: { spaceName: 'Family 2026', description: 'Photos for everyone.', color: 'blue' },
      }),
    ],
  });
  expectToolResult(response, `${AgentToolName.ProposeAlbumOperations}-call`, serviceResult);
});
```

- [ ] **Step 2: Write failing no-op and ambiguity prompt tests**

Add to `server/src/services/agent-mcp-prompt.service.spec.ts`.

```ts
it('tells the runner not to propose no-op or ambiguous existing-space detail plans', () => {
  const prompt = sut.generatePromptCheatSheet();

  expect(prompt).toMatch(/ambiguous|ask/i);
  expect(prompt).toMatch(/no matching space|ask/i);
  expect(prompt).toMatch(/already|no change|no-op/i);
  expect(prompt).toMatch(/same name|same description|same color/i);
});
```

- [ ] **Step 3: Implement minimal prompt/flow support**

If `AgentMcpService` already dispatches the parsed tool calls correctly, only prompt/contract changes should be required. Do not add heuristics to server dispatch that try to infer space identity; the LLM must still choose tool calls from prompt guidance.

Update prompt guidance to say:

```text
For ambiguous space names or no matching space, ask a clarifying question. If readSpace shows the requested name, description, or color is already set, answer that nothing needs to change and do not propose an empty plan.
```

- [ ] **Step 4: Run Task 4 tests and confirm GREEN**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-mcp.service.spec.ts src/services/agent-mcp-prompt.service.spec.ts
```

Expected: PASS.

---

## Task 5: Plan Review UI, Inline Edits, And Applied-Plan Cards

**Files:**

- Modify: `web/src/routes/(user)/assistant/agent-operation-plan-ui.ts`
- Modify: `web/src/routes/(user)/assistant/agent-operation-plan-ui.spec.ts`
- Modify: `web/src/routes/(user)/assistant/agent-operation-plan-review-panel.spec.ts`
- Modify: `web/src/routes/(user)/assistant/agent-applied-plan-timeline-card.spec.ts`
- Modify: `web/src/routes/(user)/assistant/agent-session-chat-panel.spec.ts`
- Modify: `web/src/routes/(user)/assistant/agent-plan-inline-field-editor.svelte`
- Modify: `web/src/routes/(user)/assistant/agent-plan-inline-field-editor.spec.ts`
- Modify: `i18n/en.json`

- [ ] **Step 1: Write failing review-model tests for space detail fields**

Add to `web/src/routes/(user)/assistant/agent-operation-plan-ui.spec.ts`.

```ts
it('exposes editable space detail fields and sparse field overrides', () => {
  const spaceUpdateId = 'operation-space-update';
  const model = buildOperationReviewModel(
    plan([
      operation({
        id: spaceUpdateId,
        type: AgentOperationType.SpaceUpdateDetails,
        summary: 'Update Family space',
        targetKind: AgentOperationTargetKind.ExistingSpace,
        targetId: 'space-1',
        payload: { spaceName: 'Family', description: 'Old notes', color: 'gray' },
      }),
    ]),
    { [spaceUpdateId]: true },
    {},
    { [spaceUpdateId]: { spaceName: 'Family 2026', description: '', color: 'blue' } },
  );

  expect(model.operationsById.get(spaceUpdateId)?.editableFields).toEqual([
    {
      key: 'spaceName',
      label: 'Space name',
      input: 'text',
      originalValue: 'Family',
      value: 'Family 2026',
      required: true,
      maxLength: 100,
    },
    {
      key: 'description',
      label: 'Description',
      input: 'textarea',
      originalValue: 'Old notes',
      value: '',
      required: false,
      maxLength: 500,
    },
    {
      key: 'color',
      label: 'Color',
      input: 'select',
      originalValue: 'gray',
      value: 'blue',
      required: false,
      options: ['primary', 'pink', 'red', 'yellow', 'blue', 'green', 'purple', 'orange', 'gray', 'amber'],
    },
  ]);
  expect(model.operationsById.get(spaceUpdateId)?.summary).toBe('Rename space to "Family 2026"');
  expect(buildSelectionPayload(model)).toEqual({
    planId,
    planRevision: 1,
    operationIds: [spaceUpdateId],
    fieldOverrides: {
      [spaceUpdateId]: { spaceName: 'Family 2026', description: '', color: 'blue' },
    },
  });
});
```

Add validation:

```ts
it('validates inline existing-space detail edits before apply', () => {
  const spaceUpdateId = 'operation-space-update';
  const currentPlan = plan([
    operation({
      id: spaceUpdateId,
      type: AgentOperationType.SpaceUpdateDetails,
      summary: 'Update Family space',
      targetKind: AgentOperationTargetKind.ExistingSpace,
      targetId: 'space-1',
      payload: { spaceName: 'Family', description: 'Old notes', color: 'gray' },
    }),
  ]);

  const invalidName = buildOperationReviewModel(
    currentPlan,
    { [spaceUpdateId]: true },
    {},
    {
      [spaceUpdateId]: { spaceName: '' },
    },
  );
  expect(invalidName.operationsById.get(spaceUpdateId)?.fieldErrors).toEqual({
    spaceName: 'Space name is required.',
  });
  expect(buildSelectionPayload(invalidName)).toEqual({
    planId,
    planRevision: 1,
    operationIds: [],
    fieldOverrides: { [spaceUpdateId]: { spaceName: '' } },
  });

  const invalidColor = buildOperationReviewModel(
    currentPlan,
    { [spaceUpdateId]: true },
    {},
    {
      [spaceUpdateId]: { color: '#80c7ff' },
    },
  );
  expect(invalidColor.operationsById.get(spaceUpdateId)?.fieldErrors).toEqual({
    color: 'Choose a valid space color.',
  });
});
```

- [ ] **Step 2: Write failing component tests for review/apply UI**

Add to `web/src/routes/(user)/assistant/agent-operation-plan-review-panel.spec.ts`.

```ts
it('renders existing-space detail updates with editable fields and no raw ids', async () => {
  sdkMock.getCurrentOperationPlan.mockResolvedValue(
    plan([
      operation({
        id: 'operation-space-update',
        type: AgentOperationType.SpaceUpdateDetails,
        summary: 'Rename Family space.',
        targetKind: AgentOperationTargetKind.ExistingSpace,
        targetId: 'space-1',
        payload: { spaceName: 'Family 2026', description: 'Photos for everyone.', color: 'blue' },
      }),
    ]),
  );

  render(AgentOperationPlanReviewPanel, { props: { session } });

  const region = await screen.findByRole('region', { name: 'Plan review' });
  expect(within(region).getByRole('region', { name: 'Family 2026' })).toBeInTheDocument();
  expect(within(region).getByLabelText('Space name')).toHaveValue('Family 2026');
  expect(within(region).getByLabelText('Description')).toHaveValue('Photos for everyone.');
  expect(within(region).getByLabelText('Color')).toHaveValue('blue');
  expect(within(region).queryByText('operation-space-update')).not.toBeInTheDocument();
  expect(within(region).queryByText('space-1')).not.toBeInTheDocument();
});
```

Add to the same file:

```ts
it('applies sparse existing-space detail field overrides from inline edits', async () => {
  sdkMock.getCurrentOperationPlan.mockResolvedValue(
    plan([
      operation({
        id: 'operation-space-update',
        type: AgentOperationType.SpaceUpdateDetails,
        summary: 'Update Family space.',
        targetKind: AgentOperationTargetKind.ExistingSpace,
        targetId: 'space-1',
        payload: { spaceName: 'Family', description: 'Old notes', color: 'gray' },
      }),
    ]),
  );
  sdkMock.applyApprovedOperations.mockResolvedValue({
    status: AgentOperationApplyStatus.Applied,
    plan: appliedPlan(),
    appliedOperationIds: ['operation-space-update'],
    skippedOperationIds: [],
    failedOperationIds: [],
    summary: 'Applied 1 operation(s), skipped 0, failed 0.',
  });

  render(AgentOperationPlanReviewPanel, { props: { session } });

  await screen.findByRole('region', { name: 'Family' });
  await fireEvent.input(screen.getByLabelText('Space name'), { target: { value: 'Family 2026' } });
  await fireEvent.input(screen.getByLabelText('Description'), { target: { value: '' } });
  await fireEvent.change(screen.getByLabelText('Color'), { target: { value: 'blue' } });
  await fireEvent.click(screen.getByRole('button', { name: 'Apply 1 selected' }));

  expect(sdkMock.applyApprovedOperations).toHaveBeenCalledWith({
    id: session.id,
    planId,
    agentOperationPlanApplyRequestDto: {
      operationIds: ['operation-space-update'],
      fieldOverrides: {
        'operation-space-update': { spaceName: 'Family 2026', description: '', color: 'blue' },
      },
      planRevision: 1,
    },
  });
});
```

- [ ] **Step 3: Write failing inline-field editor tests for color select**

Add to `web/src/routes/(user)/assistant/agent-plan-inline-field-editor.spec.ts`.

```ts
it('renders select fields for space colors and publishes changes', async () => {
  const onSetFieldOverride = vi.fn();
  render(AgentPlanInlineFieldEditor, {
    props: {
      item: {
        ...reviewItem,
        editableFields: [
          {
            key: 'color',
            label: 'Color',
            input: 'select',
            originalValue: 'gray',
            value: 'gray',
            required: false,
            options: ['gray', 'blue', 'amber'],
          },
        ],
      },
      canChangeSelection: true,
      onSetFieldOverride,
      onResetFieldOverride: vi.fn(),
    },
  });

  await fireEvent.change(screen.getByLabelText('Color'), { target: { value: 'blue' } });

  expect(onSetFieldOverride).toHaveBeenCalledWith(reviewItem.id, 'color', 'blue');
});
```

- [ ] **Step 4: Write failing applied-card summary tests**

Add to `web/src/routes/(user)/assistant/agent-applied-plan-timeline-card.spec.ts`.

```ts
it('summarizes applied existing-space detail changes in human wording', () => {
  render(AgentAppliedPlanTimelineCard, {
    props: {
      plan: plan([
        operation({
          id: 'operation-space-update',
          type: AgentOperationType.SpaceUpdateDetails,
          summary: 'Update Family space.',
          targetKind: AgentOperationTargetKind.ExistingSpace,
          targetId: 'space-1',
          status: AgentOperationStatus.Applied,
          payload: { spaceName: 'Family 2026', description: '', color: 'blue' },
        }),
      ]),
    },
  });

  expect(screen.getByText('Renamed to "Family 2026"')).toBeInTheDocument();
  expect(screen.getByText('Cleared description')).toBeInTheDocument();
  expect(screen.getByText('Changed color to blue')).toBeInTheDocument();
  expect(screen.queryByText('operation-space-update')).not.toBeInTheDocument();
  expect(screen.queryByText('space-1')).not.toBeInTheDocument();
});
```

- [ ] **Step 5: Write failing chat-continuation test for applied space detail plans**

Add to `web/src/routes/(user)/assistant/agent-session-chat-panel.spec.ts`.

```ts
it('keeps chat usable after an applied existing-space detail plan appears in history', async () => {
  sdkMock.getAgentSessionMessages.mockResolvedValue([
    {
      ...makeMessage('message-user', AgentMessageRole.User, 'Rename Family to Family 2026'),
      createdAt: '2026-05-16T10:00:00.000Z',
    },
    {
      ...makeMessage('message-assistant', AgentMessageRole.Assistant, 'Done. What should we do next?'),
      createdAt: '2026-05-16T10:02:00.000Z',
    },
  ]);
  setAppliedPlanHistory([
    makeAppliedPlan({
      summary: 'Update Family space details',
      updatedAt: '2026-05-16T10:01:00.000Z',
      operations: [
        makeOperation({
          id: 'operation-space-update',
          type: AgentOperationType.SpaceUpdateDetails,
          summary: 'Rename Family space.',
          targetKind: AgentOperationTargetKind.ExistingSpace,
          targetId: 'space-1',
          temporaryTargetId: null,
          payload: { spaceName: 'Family 2026' },
          result: { spaceId: 'space-1' },
        }),
      ],
    }),
  ]);

  render(AgentSessionChatPanel, { props: { session: { ...session, status: AgentSessionStatus.Running } } });

  expect(await screen.findByRole('article', { name: 'Applied plan: Update Family space details' })).toBeInTheDocument();
  expect(screen.getByText('Done. What should we do next?')).toBeInTheDocument();
  expect(screen.getByRole('textbox', { name: 'Message' })).toBeEnabled();
});
```

- [ ] **Step 6: Run UI tests and confirm RED**

Run:

```bash
pnpm --dir web exec vitest --run 'src/routes/(user)/assistant/agent-operation-plan-ui.spec.ts' 'src/routes/(user)/assistant/agent-operation-plan-review-panel.spec.ts' 'src/routes/(user)/assistant/agent-applied-plan-timeline-card.spec.ts' 'src/routes/(user)/assistant/agent-session-chat-panel.spec.ts' 'src/routes/(user)/assistant/agent-plan-inline-field-editor.spec.ts'
```

Expected: FAIL because space fields are not fully editable/rendered yet.

- [ ] **Step 7: Implement UI model and component support**

In `web/src/routes/(user)/assistant/agent-operation-plan-ui.ts`:

- Extend `AgentOperationEditableField` with:

```ts
| {
    key: 'color';
    label: string;
    input: 'select';
    originalValue: string;
    value: string;
    required: boolean;
    options: string[];
  }
```

- Add `SpaceUpdateDetails` to `buildEditableFields` with `spaceName`, `description`, and `color`.
- Add `spaceName` validation using max length `100`.
- Add `description` validation using max length `500` for spaces.
- Add color validation against the allowed color list.
- Update `applyOperationFieldOverrides` to support `SpaceUpdateDetails`.
- Update summary helpers so payloads render as field-level summaries:
  - `spaceName`: `Rename space to "Family 2026"`
  - `description: ""`: `Clear space description`
  - `description: "..."`: `Update space description`
  - `color`: `Change space color to blue`
  - multiple fields: `Update space details`

In `web/src/routes/(user)/assistant/agent-plan-inline-field-editor.svelte`, add an `input === 'select'` branch:

```svelte
{:else if field.input === 'select'}
  <label class="text-xs font-medium text-gray-600 dark:text-gray-300" for={`${item.id}-${field.key}`}>
    {field.label}
  </label>
  <select
    id={`${item.id}-${field.key}`}
    class="w-full rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-sm text-gray-900 disabled:cursor-not-allowed disabled:opacity-60 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
    value={field.value}
    disabled={!canChangeSelection}
    aria-invalid={errors[field.key] ? 'true' : undefined}
    aria-describedby={errors[field.key] ? `${item.id}-${field.key}-error` : undefined}
    onchange={(event) => setFieldOverride(field.key, event.currentTarget.value)}
  >
    {#each field.options as option (option)}
      <option value={option}>{option}</option>
    {/each}
  </select>
{/if}
```

Update applied-card helpers to use the same field-level wording and keep technical details collapsed.

- [ ] **Step 8: Run Task 5 tests and confirm GREEN**

Run:

```bash
pnpm --dir web exec vitest --run 'src/routes/(user)/assistant/agent-operation-plan-ui.spec.ts' 'src/routes/(user)/assistant/agent-operation-plan-review-panel.spec.ts' 'src/routes/(user)/assistant/agent-applied-plan-timeline-card.spec.ts' 'src/routes/(user)/assistant/agent-session-chat-panel.spec.ts' 'src/routes/(user)/assistant/agent-plan-inline-field-editor.spec.ts'
```

Expected: PASS.

---

## Task 6: Final Slice Verification

**Files:**

- All files modified by Tasks 1-5.

- [ ] **Step 1: Run generated-doc sync checks**

Run:

```bash
pnpm --dir server run sync:agent-mcp-docs
pnpm --dir server run sync:agent-mcp-prompt
git diff -- docs/superpowers/generated/pi-agent-mcp-tools.md agent-runner/src/generated/gallery-mcp-prompt-cheat-sheet.mjs
```

Expected: Generated files are updated intentionally and committed with the slice.

- [ ] **Step 2: Run focused server tests**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-mcp-tool-contract.service.spec.ts src/services/agent-mcp-prompt.service.spec.ts src/services/agent-mcp-docs.service.spec.ts src/services/agent-mcp.service.spec.ts src/dtos/agent-operation.dto.spec.ts src/services/agent-operation-plan.service.spec.ts
```

Expected: PASS.

- [ ] **Step 3: Run focused frontend tests**

Run:

```bash
pnpm --dir web exec vitest --run 'src/routes/(user)/assistant/agent-operation-plan-ui.spec.ts' 'src/routes/(user)/assistant/agent-operation-plan-review-panel.spec.ts' 'src/routes/(user)/assistant/agent-applied-plan-timeline-card.spec.ts' 'src/routes/(user)/assistant/agent-session-chat-panel.spec.ts' 'src/routes/(user)/assistant/agent-plan-inline-field-editor.spec.ts'
```

Expected: PASS.

- [ ] **Step 4: Run server typecheck**

Run:

```bash
pnpm --filter immich check
```

Expected: PASS.

- [ ] **Step 5: Run diff hygiene**

Run:

```bash
git diff --check
```

Expected: no whitespace errors.

- [ ] **Step 6: Commit the slice**

Run:

```bash
git status --short
git add server/src/services/agent-mcp-tool-contract.service.ts \
  server/src/services/agent-mcp-tool-contract.service.spec.ts \
  server/src/services/agent-mcp-prompt.service.ts \
  server/src/services/agent-mcp-prompt.service.spec.ts \
  server/src/services/agent-mcp-docs.service.spec.ts \
  server/src/services/agent-mcp.service.spec.ts \
  server/src/dtos/agent-operation.dto.ts \
  server/src/dtos/agent-operation.dto.spec.ts \
  server/src/services/agent-operation-plan.service.ts \
  server/src/services/agent-operation-plan.service.spec.ts \
  agent-runner/src/generated/gallery-mcp-prompt-cheat-sheet.mjs \
  docs/superpowers/generated/pi-agent-mcp-tools.md \
  web/src/routes/\(user\)/assistant/agent-operation-plan-ui.ts \
  web/src/routes/\(user\)/assistant/agent-operation-plan-ui.spec.ts \
  web/src/routes/\(user\)/assistant/agent-operation-plan-review-panel.spec.ts \
  web/src/routes/\(user\)/assistant/agent-applied-plan-timeline-card.spec.ts \
  web/src/routes/\(user\)/assistant/agent-session-chat-panel.spec.ts \
  web/src/routes/\(user\)/assistant/agent-plan-inline-field-editor.svelte \
  web/src/routes/\(user\)/assistant/agent-plan-inline-field-editor.spec.ts \
  i18n/en.json \
  docs/superpowers/plans/2026-05-20-pi-agent-space-capabilities-slice-3-existing-space-details.md
git commit -m "feat: support pi updating existing space details"
```

Expected: commit succeeds. If Slice 1 or Slice 2 changes are still intentionally uncommitted in the same worktree, either include them in their own earlier commits first or skip this commit step until the branch owner asks for `$cp`.

---

## Self-Review Against Spec

- Slice 3 scope is covered: resolving visible spaces, proposing `space.updateDetails`, applying through shared-space update, review UI, inline edits, and applied card summaries.
- TDD is explicit in every task: each implementation task starts by writing failing tests, running them RED, then implementing the smallest change and rerunning GREEN.
- Edge cases are covered: ambiguous names, no match, same existing value/no-op, description clearing, invalid color, unsupported fields, permission denial, stale membership, and multi-field updates.
- Out-of-scope fields are blocked: thumbnail, pets, face recognition, linked libraries, and deletion.
- The plan stays consistent with the design: no direct mutation MCP tools, no bypass of operation-plan review, and no member-management work before Slice 4.
