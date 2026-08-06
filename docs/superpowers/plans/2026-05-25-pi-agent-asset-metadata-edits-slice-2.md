# Pi Agent Asset Metadata Edits Slice 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the `updateAssetMetadata` write-scope permission flag to agent permission snapshots, presets, legacy normalization, custom-plan validation, and generated OpenAPI/TypeScript SDK contracts.

**Architecture:** This slice extends the existing permission-plan contract without adding metadata operation planning or apply behavior. The new flag is required for normalized/custom permission plans, optional on legacy stored snapshots, conservatively backfilled to `false`, and preset to `false` for `Careful` and `true` for `VisualOrganizer` and `LocalPowerUser`.

**Tech Stack:** TypeScript, NestJS DTOs, Zod 4, Vitest, generated OpenAPI JSON, generated `@immich/sdk` TypeScript client.

---

## Scope

This is Slice 2 from `docs/superpowers/specs/2026-05-25-pi-agent-asset-metadata-edits-design.md`.

Implement only:

- Add `writeScope.updateAssetMetadata` to permission snapshot TypeScript types.
- Require `updateAssetMetadata` in expanded/custom permission plans.
- Backfill `updateAssetMetadata: false` for legacy stored permission plans and legacy response DTOs.
- Set permission presets:
  - `Careful`: `false`
  - `VisualOrganizer`: `true`
  - `LocalPowerUser`: `true`
- Keep `AgentOperationPlanService` legacy normalization aware of the new flag so future operation checks see normalized permissions.
- Regenerate OpenAPI and TypeScript SDK artifacts so `AgentPermissionPlan.writeScope.updateAssetMetadata` is required in generated contracts.
- Update tests and typed fixtures that fail because the expanded write-scope key set changed.

Do not implement:

- Plan creation checks for `asset.updateMetadata`.
- Apply-time checks or calls to `assetService.updateAll`.
- UI, assistant-flow, capability-matrix, or docs changes.
- Place-name/geocoding behavior.
- Any change to the existing meaning of `editAssets`, `favoriteAssets`, `archiveAssets`, or `tagAssets`.

## Files

- Modify: `server/src/types/agent-session.types.ts`
  - Add `updateAssetMetadata?: boolean` to `AgentPermissionPlanSnapshot.writeScope`.
  - Add required `updateAssetMetadata: boolean` to `AgentNormalizedPermissionPlanSnapshot.writeScope`.
- Modify: `server/src/dtos/agent-session.dto.ts`
  - Add `updateAssetMetadata: false` to `legacyWriteScopeDefaults`.
  - Add `updateAssetMetadata: z.boolean()` to `expandedWriteScopeShape`.
- Modify: `server/src/services/agent-session.service.ts`
  - Add `updateAssetMetadata: false` to legacy defaults.
  - Add preset values `false`, `true`, and `true`.
- Modify: `server/src/services/agent-operation-plan.service.ts`
  - Add `updateAssetMetadata: false` to operation-plan legacy write-scope defaults.
  - Keep the operation-plan legacy defaults fully normalized for shared-space member flags while touching this normalization map.
- Modify: `server/src/dtos/agent-session.dto.spec.ts`
  - Add the new key to write-scope helpers.
  - Add missing-key validation focused on `updateAssetMetadata`.
  - Add legacy response normalization coverage.
  - Keep generated OpenAPI/SDK contract coverage passing for the new key.
- Modify: `server/src/services/agent-session.service.spec.ts`
  - Add the new key to expected preset and legacy-normalization fixtures.
- Modify: `server/src/services/agent-operation-plan.service.spec.ts`
  - Add the new key to operation-plan legacy-normalization expectations.
- Modify generated files:
  - `open-api/immich-openapi-specs.json`
  - `open-api/typescript-sdk/src/fetch-client.ts`
- Modify only if typecheck/test failures require it:
  - Web or server fixtures containing fully typed `AgentPermissionPlan.writeScope` objects.

## Task 1: DTO And Type Permission Contract

**Files:**

- Modify: `server/src/types/agent-session.types.ts`
- Modify: `server/src/dtos/agent-session.dto.ts`
- Test: `server/src/dtos/agent-session.dto.spec.ts`

- [ ] **Step 1: Write the failing DTO/type tests**

In `server/src/dtos/agent-session.dto.spec.ts`, add `updateAssetMetadata` to `fullWriteScope`:

```ts
const fullWriteScope = {
  createAlbum: true,
  addAssets: true,
  updateDetails: true,
  setCover: true,
  removeAssets: true,
  createSpace: true,
  addAssetsToSpaces: true,
  removeAssetsFromSpaces: true,
  updateSpaceDetails: true,
  editAssets: true,
  favoriteAssets: true,
  archiveAssets: true,
  tagAssets: true,
  updateAssetMetadata: true,
  addMembersToSpaces: true,
  removeMembersFromSpaces: true,
  updateSpaceMemberRoles: true,
};
```

Add `updateAssetMetadata` to `expandedWriteScopeKeys`:

```ts
const expandedWriteScopeKeys = [
  'removeAssets',
  'createSpace',
  'addAssetsToSpaces',
  'removeAssetsFromSpaces',
  'updateSpaceDetails',
  'editAssets',
  'favoriteAssets',
  'archiveAssets',
  'tagAssets',
  'updateAssetMetadata',
  'addMembersToSpaces',
  'removeMembersFromSpaces',
  'updateSpaceMemberRoles',
];
```

Update the custom-plan required-key test to prove the new key is required:

```ts
it('requires custom permission plans to include updateAssetMetadata', () => {
  const missingUpdateAssetMetadata = {
    ...fullWriteScope,
    updateAssetMetadata: undefined,
  };

  const result = AgentPermissionPlanSchema.safeParse({
    read: { metadata: true, previews: true, originals: true },
    providerExposure: {
      metadata: true,
      previews: true,
      originals: true,
      allowOriginalsForExternalProviders: false,
    },
    assetScope: { owned: true, sharedSpaces: true, locked: false },
    writeScope: missingUpdateAssetMetadata,
    limits: {
      maxAssetsPerToolCall: 500,
      maxAssetsPerSession: 5000,
      maxPreviewsPerToolCall: 100,
      maxPreviewsPerSession: 500,
      maxOriginalsPerToolCall: 25,
      maxOriginalsPerSession: 50,
      expiresInMinutes: 120,
    },
  });

  expect(result.success).toBe(false);
  expect(result.error?.issues).toEqual([
    expect.objectContaining({
      path: ['writeScope', 'updateAssetMetadata'],
      message: 'Invalid input: expected boolean, received undefined',
    }),
  ]);
});
```

In `AgentSessionResponseDto` legacy normalization coverage, add:

```ts
expect(result.data?.permissionPlanSnapshot.writeScope).toMatchObject({
  updateAssetMetadata: false,
});
```

- [ ] **Step 2: Run the DTO tests and confirm the expected red failure**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/dtos/agent-session.dto.spec.ts
```

Expected: FAIL because `writeScope.updateAssetMetadata` is not in `expandedWriteScopeShape`, legacy response normalization does not backfill it, and generated OpenAPI/SDK files do not yet expose it.

- [ ] **Step 3: Add the minimal DTO/type implementation**

In `server/src/types/agent-session.types.ts`, extend the legacy and normalized write-scope types:

```ts
    tagAssets?: boolean;
    updateAssetMetadata?: boolean;
```

```ts
tagAssets: boolean;
updateAssetMetadata: boolean;
```

In `server/src/dtos/agent-session.dto.ts`, extend both write-scope maps:

```ts
  tagAssets: false,
  updateAssetMetadata: false,
```

```ts
  tagAssets: z.boolean(),
  updateAssetMetadata: z.boolean(),
```

- [ ] **Step 4: Run the DTO tests again**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/dtos/agent-session.dto.spec.ts
```

Expected after Task 1 implementation but before generated artifacts: DTO parsing and normalization assertions pass; generated contract assertions may still fail until Task 4 regenerates OpenAPI/SDK.

## Task 2: Session Presets And Legacy Backfill

**Files:**

- Modify: `server/src/services/agent-session.service.ts`
- Test: `server/src/services/agent-session.service.spec.ts`

- [ ] **Step 1: Write the failing service tests**

In `server/src/services/agent-session.service.spec.ts`, add `updateAssetMetadata` to the existing write-scope helper objects. The careful helper should include:

```ts
updateAssetMetadata: false,
```

The expanded/local-power-user helper should include:

```ts
updateAssetMetadata: true,
```

Update the existing preset assertion for `AgentSessionService.permissionPresets` so exact `writeScope` comparisons expect:

```ts
expect(AgentSessionService.permissionPresets[AgentPermissionPreset.Careful].writeScope.updateAssetMetadata).toBe(false);
expect(
  AgentSessionService.permissionPresets[AgentPermissionPreset.VisualOrganizer].writeScope.updateAssetMetadata,
).toBe(true);
expect(AgentSessionService.permissionPresets[AgentPermissionPreset.LocalPowerUser].writeScope.updateAssetMetadata).toBe(
  true,
);
```

Update the legacy custom-plan runner handoff expected object to include:

```ts
updateAssetMetadata: false,
```

Update the legacy stored-session response expected object to include:

```ts
updateAssetMetadata: false,
```

- [ ] **Step 2: Run the service tests and confirm the expected red failure**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-session.service.spec.ts
```

Expected: FAIL because `AgentSessionService.permissionPresets` and `AgentSessionService.backfillPermissionPlan()` do not yet set `updateAssetMetadata`.

- [ ] **Step 3: Add the minimal service implementation**

In `server/src/services/agent-session.service.ts`, add the conservative legacy default:

```ts
    tagAssets: false,
    updateAssetMetadata: false,
```

Add preset values:

```ts
        tagAssets: true,
        updateAssetMetadata: false,
```

```ts
        tagAssets: true,
        updateAssetMetadata: true,
```

```ts
        tagAssets: true,
        updateAssetMetadata: true,
```

- [ ] **Step 4: Run the service tests again**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-session.service.spec.ts
```

Expected: PASS for the session service suite.

## Task 3: Operation-Plan Legacy Normalization Only

**Files:**

- Modify: `server/src/services/agent-operation-plan.service.ts`
- Test: `server/src/services/agent-operation-plan.service.spec.ts`

- [ ] **Step 1: Write the failing operation-plan normalization test**

In `server/src/services/agent-operation-plan.service.spec.ts`, add `updateAssetMetadata` to the expanded helper used by current operation-plan permission tests:

```ts
const expandedWriteScope = {
  ...permissionPlanSnapshot.writeScope,
  removeAssets: true,
  createSpace: true,
  addAssetsToSpaces: true,
  removeAssetsFromSpaces: true,
  updateSpaceDetails: true,
  addMembersToSpaces: true,
  removeMembersFromSpaces: true,
  updateSpaceMemberRoles: true,
  editAssets: true,
  favoriteAssets: true,
  archiveAssets: true,
  tagAssets: true,
  updateAssetMetadata: true,
};
```

In `normalizes missing expanded write-scope keys to false before operation permission checks`, prove the operation-plan normalizer backfills the new key before the existing public denial assertion:

```ts
expect((sut as any).normalizePermissionPlanSnapshot(legacyPermissionPlan).writeScope).toMatchObject({
  removeAssets: false,
  updateAssetMetadata: false,
});
```

Keep the existing public behavior assertion in the same test:

```ts
await expect(
  sut.proposeAlbumOperations(auth, session.id, {
    summary: 'Denied plan.',
    operations: [
      {
        type: AgentOperationType.AlbumRemoveAssets,
        summary: 'Remove from existing album.',
        targetKind: AgentOperationTargetKind.ExistingAlbum,
        targetId: albumId,
        assetIds: [assetId],
        payload: {},
        enabled: true,
        riskLevel: AgentOperationRiskLevel.Low,
      },
    ],
  }),
).rejects.toThrow('Agent permission policy does not allow removing assets from albums');
expect(planRepository.createReplacementRevision).not.toHaveBeenCalled();
```

- [ ] **Step 2: Run the operation-plan test and confirm the expected red failure**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-operation-plan.service.spec.ts
```

Expected: FAIL in legacy-normalization expectations because the service does not yet add `updateAssetMetadata: false`.

- [ ] **Step 3: Add the minimal operation-plan normalization implementation**

In `server/src/services/agent-operation-plan.service.ts`, add:

```ts
    addMembersToSpaces: false,
    removeMembersFromSpaces: false,
    updateSpaceMemberRoles: false,
    tagAssets: false,
    updateAssetMetadata: false,
```

Do not add any `AgentOperationType.AssetUpdateMetadata` permission check in this task. That belongs to Slice 3 when plan creation/materialization is implemented.

- [ ] **Step 4: Run the operation-plan test again**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-operation-plan.service.spec.ts
```

Expected: PASS for operation-plan legacy normalization and existing permission checks.

## Task 4: Generated OpenAPI And SDK Contracts

**Files:**

- Modify: `open-api/immich-openapi-specs.json`
- Modify: `open-api/typescript-sdk/src/fetch-client.ts`
- Modify only if generated types expose fixture gaps:
  - `web/src/**/*.spec.ts`
  - `server/src/**/*.spec.ts`

- [ ] **Step 1: Run contract generation**

Run from the repository root:

```bash
cd open-api && ./bin/generate-open-api.sh typescript
```

Expected: PASS. Generated OpenAPI and SDK files include `updateAssetMetadata`.

Because the generator emits the full current server contract, these generated files will also pick up the `asset.updateMetadata` DTO contract that was added in Slice 1. Keep those generated changes if they are produced by the generator; they are contract sync for already-present source, not Slice 3 plan-creation or apply behavior.

If generation fails because of an existing environment issue unrelated to this slice, run these narrower commands and record the failure:

```bash
SHARP_IGNORE_GLOBAL_LIBVIPS=true pnpm --filter immich build
pnpm --filter immich sync:open-api
cd open-api && pnpm dlx oazapfts --optimistic --argumentStyle=object --useEnumType --allSchemas immich-openapi-specs.json typescript-sdk/src/fetch-client.ts
pnpm --filter @immich/sdk build
```

- [ ] **Step 2: Verify generated contract tests**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/dtos/agent-session.dto.spec.ts
```

Expected: PASS, including:

- OpenAPI `AgentPermissionPlan.properties.writeScope.required` contains `updateAssetMetadata`.
- SDK source contains `updateAssetMetadata: boolean`.

- [ ] **Step 3: Fix typed fixture fallout only where required**

If TypeScript or tests fail because fully typed fixture permission plans are missing the new required key, update only those fixture objects by adding the intended value:

```ts
updateAssetMetadata: false,
```

for careful/legacy/restricted snapshots, or:

```ts
updateAssetMetadata: true,
```

for visual-organizer/local-power-user/full-write snapshots.

Do not alter UI behavior or add metadata operation rendering in this slice.

## Task 5: Slice Verification And Commit

**Files:**

- All files modified by Tasks 1-4.

- [ ] **Step 1: Run targeted verification**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/dtos/agent-session.dto.spec.ts src/services/agent-session.service.spec.ts src/services/agent-operation-plan.service.spec.ts
```

Expected: PASS.

- [ ] **Step 2: Run type/build verification**

Run:

```bash
pnpm --dir server run build
pnpm --dir open-api/typescript-sdk run build
```

Expected: PASS.

If web fixture changes were required in Task 4, also run:

```bash
pnpm --dir web run check:typescript
```

Expected: PASS.

- [ ] **Step 3: Verify generated files are stable**

Run:

```bash
cd open-api && ./bin/generate-open-api.sh typescript
cd ..
git diff --exit-code -- open-api/immich-openapi-specs.json open-api/typescript-sdk/src/fetch-client.ts
```

Expected: PASS with no diff after regenerating.

- [ ] **Step 4: Run whitespace review**

Run:

```bash
git diff --check
```

Expected: PASS.

- [ ] **Step 5: Commit Slice 2**

Run:

```bash
git status --short
git add docs/superpowers/plans/2026-05-25-pi-agent-asset-metadata-edits-slice-2.md server/src/types/agent-session.types.ts server/src/dtos/agent-session.dto.ts server/src/services/agent-session.service.ts server/src/services/agent-operation-plan.service.ts server/src/dtos/agent-session.dto.spec.ts server/src/services/agent-session.service.spec.ts server/src/services/agent-operation-plan.service.spec.ts open-api/immich-openapi-specs.json open-api/typescript-sdk/src/fetch-client.ts
git add web/src server/src
git commit -m "feat: add pi agent metadata write scope"
git status --short --branch
```

Expected: commit succeeds and the worktree is clean.

Before staging with `git add web/src server/src`, inspect `git status --short` and stage only fixture files that were actually changed for this slice. Do not stage unrelated user changes.

## Plan Review

- Spec coverage: This plan covers Slice 2 requirements for `updateAssetMetadata` in snapshots, presets, legacy backfill, OpenAPI required fields, and custom-plan validation. It intentionally defers plan creation/apply permission enforcement to Slice 3.
- Edge cases covered: custom plans missing the new key, legacy stored snapshots missing the key, legacy custom permission plans handed to the runner, conservative backfill default, and generated-contract drift.
- Placeholder scan: The plan contains no open-ended implementation placeholders; conditional fixture edits are bounded to type/test failures caused by the new required key.
- Type consistency: The property name is consistently `updateAssetMetadata` across TypeScript types, Zod schema, service defaults, tests, OpenAPI, and SDK.
- Generated contract consistency: OpenAPI/SDK generation is whole-contract generation. If generated files include the Slice 1 `asset.updateMetadata` operation schema, keep it rather than manually narrowing generated artifacts and creating drift.
