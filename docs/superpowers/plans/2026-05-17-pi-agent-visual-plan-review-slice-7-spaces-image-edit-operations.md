# Pi Agent Visual Plan Review Slice 7 Spaces And Image Edit Operations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend Pi's visual plan review from album-only plans to spaces, album/space add-remove flows, asset batches, image rotation, archive/favorite, and tag operations, with server-side apply and validation matching what the UI previews.

**Architecture:** Expand the existing operation-plan contract end-to-end instead of adding a separate review-only vocabulary. The server owns the execution DTO, permissions, validation, apply behavior, and OpenAPI/SDK generation. The frontend view-model continues deriving a stable review model from the plan DTO, grouping operations into album, space, asset-batch, and image-edit destinations without hardcoding raw protocol details in Svelte components.

**Tech Stack:** NestJS, Zod DTOs, Kysely repositories, existing album/shared-space/asset/tag services, generated `@immich/sdk`, Svelte 5, TypeScript, Vitest, Testing Library, Playwright/CI verification.

---

## Scope

This is Slice 7 from `docs/superpowers/specs/2026-05-17-pi-agent-visual-plan-review-design.md`:

- Space destinations: create space, update space details, add photos to spaces, remove photos from spaces.
- Add/remove flows: add/remove photos for albums and spaces.
- Asset-batch destinations: favorite/unfavorite, archive/unarchive, add/remove tags.
- Image-edit destinations: rotate photo batches by 90, 180, or 270 degrees.
- Review UI labels, grouping, thumbnails, sparse item selection, and inline fields for the new operations.
- Server apply behavior must revalidate permissions, affected items, field overrides, stale plan revision, and dependencies before making changes.

Out of scope for this slice:

- Deleting photos, trashing photos, removing spaces, removing albums, or changing shared-space members.
- Crop, mirror, trim, or arbitrary image edits beyond batch rotation.
- A new plan-review endpoint. Keep review metadata derived from the existing plan DTO.

## Operation Contract Decisions

Add operation vocabulary in `server/src/enum.ts`:

- `AgentOperationType.AlbumRemoveAssets = 'album.removeAssets'`
- `AgentOperationType.SpaceCreate = 'space.create'`
- `AgentOperationType.SpaceAddAssets = 'space.addAssets'`
- `AgentOperationType.SpaceRemoveAssets = 'space.removeAssets'`
- `AgentOperationType.SpaceUpdateDetails = 'space.updateDetails'`
- `AgentOperationType.AssetRotate = 'asset.rotate'`
- `AgentOperationType.AssetSetFavorite = 'asset.setFavorite'`
- `AgentOperationType.AssetSetArchive = 'asset.setArchive'`
- `AgentOperationType.AssetAddTag = 'asset.addTag'`
- `AgentOperationType.AssetRemoveTag = 'asset.removeTag'`

Add target kinds:

- `AgentOperationTargetKind.NewSpace = 'new_space'`
- `AgentOperationTargetKind.ExistingSpace = 'existing_space'`
- `AgentOperationTargetKind.AssetBatch = 'asset_batch'`
- `AgentOperationTargetKind.ImageEditBatch = 'image_edit_batch'`

Payload rules:

- Album remove: existing album target, `assetIds`, empty payload.
- Space create/update: `payload.spaceName`, optional `description`, optional `color`.
- Space add/remove: new or existing space target, `assetIds`, empty payload.
- Rotate: image-edit batch target, `assetIds`, `payload.angle` in `90 | 180 | 270`; angle is relative to existing edits.
- Favorite/archive: asset-batch target, `assetIds`, `payload.favorite` or `payload.archived`.
- Tag add: asset-batch target, `assetIds`, exactly one of `payload.tagId` or `payload.tagName`.
- Tag remove: asset-batch target, `assetIds`, `payload.tagId`.

Field override keys:

- Text fields use the payload key directly: `albumName`, `spaceName`, `description`.
- Cover selection remains `albumThumbnailAssetId`.
- Target selection uses `targetAlbumId` or `targetSpaceId` and is only valid for operations that can target an existing album or space; switching away from a new temporary target must drop the temporary target dependency during apply.
- Rotation uses the UI key `rotationAngle`, which the server maps to `payload.angle`. The payload field remains `angle` so the operation contract stays compact and execution-oriented.

Permission snapshot additions:

- Keep existing album fields unchanged: `createAlbum`, `addAssets`, `updateDetails`, `setCover`.
- Add conservative new write-scope fields: `removeAssets`, `createSpace`, `addAssetsToSpaces`, `removeAssetsFromSpaces`, `updateSpaceDetails`, `editAssets`, `favoriteAssets`, `archiveAssets`, `tagAssets`.
- Legacy snapshots missing these fields must normalize them to `false` for existing sessions.
- New presets:
  - `careful`: allow `createSpace`, `addAssetsToSpaces`, `updateSpaceDetails`, `favoriteAssets`, `tagAssets`; deny removals, archive, and edits.
  - `visual-organizer`: allow all new fields except hard deletes, which are out of scope.
  - `local-power-user`: allow all new fields in this slice.

## Test And Edge Case Coverage

Every task below starts with failing tests. Confirm each red state is for the intended missing behavior before implementation.

Required coverage:

- DTO accepts every new valid operation and rejects invalid target/payload combinations.
- DTO rejects invalid rotation angles, duplicate assets, missing tags, both `tagId` and `tagName`, unknown item kinds, and huge/bad sparse selections.
- Permission snapshots validate new write-scope fields and normalize legacy session snapshots safely.
- Propose/revise rejects operations outside session write scope.
- Propose/revise rejects inaccessible existing albums/spaces, inaccessible assets, and invalid new-target dependencies.
- Apply supports legacy operation-only payloads and sparse item selections for the new operation types.
- Apply rejects item IDs outside affected sets, stale revisions, disabled operations, unsupported overrides, missing dependencies, and inaccessible targets.
- Apply performs partial success accounting for album/tag per-asset results and rotate per-asset failures.
- Apply handles stale targets cleanly when an album, space, tag, or asset changed or disappeared between proposal and apply.
- Frontend groups new operations into `album`, `space`, `assetBatch`, and `imageEditBatch` destination cards.
- Frontend labels rows in user terms, for example `Remove 8 photos`, `Create space "Family"`, `Rotate 12 photos clockwise`, `Archive 20 photos`, `Add tag "Receipts"`.
- Frontend preserves sparse selection, field overrides, thumbnail bounds, mixed state, blocked dependencies, and apply payloads for the new operations.
- Component tests cover collapsed cards, expanded item review, disabled/non-selectable states, long names, empty asset sets, no thumbnails, and mobile/narrow layout.
- End-to-end tests cover at least one visual space plan and one visual asset-batch/image-edit plan through approve/apply.

## Task 1: Server DTO Contract And Permission Snapshot

**Files:**

- Modify: `server/src/enum.ts`
- Modify: `server/src/dtos/agent-operation.dto.ts`
- Modify: `server/src/dtos/agent-operation.dto.spec.ts`
- Modify: `server/src/types/agent-operation.types.ts`
- Modify: `server/src/types/agent-session.types.ts`
- Modify: `server/src/dtos/agent-session.dto.ts`
- Modify: `server/src/dtos/agent-session.dto.spec.ts`
- Modify: `server/src/services/agent-session.service.ts`
- Modify: `server/src/services/agent-session.service.spec.ts`
- Add migration if needed: `server/src/schema/migrations/*-BackfillAgentExpandedWriteScope.ts`

- [ ] **Step 1: Write failing DTO tests for the expanded operation vocabulary**

Add tests in `server/src/dtos/agent-operation.dto.spec.ts` that `AgentProposeAlbumOperationsDto.schema.safeParse` accepts:

- `album.removeAssets` with existing album target and asset IDs.
- `space.create` with `new_space`, `temporaryTargetId`, and `payload.spaceName`.
- `space.addAssets` targeting a new space by `temporaryTargetId`.
- `space.addAssets` and `space.removeAssets` targeting an existing space by `targetId`.
- `space.updateDetails` with `payload.spaceName` or `payload.description`.
- `asset.rotate` with `image_edit_batch`, asset IDs, and `payload.angle`.
- `asset.setFavorite`, `asset.setArchive`, `asset.addTag`, and `asset.removeTag` with `asset_batch`.

Add rejection tests for:

- Space create without `temporaryTargetId`.
- Space/album add to a new target with no matching create operation.
- Existing targets without `targetId`.
- Asset-batch/image-edit operations with album or space targets.
- Empty `assetIds` for asset-batch operations.
- Duplicate `assetIds`.
- Rotation angle outside `90 | 180 | 270`.
- Favorite/archive payload missing the boolean.
- Tag add with neither tag field or both tag fields.
- Tag remove without `tagId`.
- More than 500 operations or more than 10,000 affected items.

- [ ] **Step 2: Write failing permission snapshot tests**

In `server/src/dtos/agent-session.dto.spec.ts` and `server/src/services/agent-session.service.spec.ts`, add tests that:

- Custom permission plans must include the new write-scope booleans.
- New preset snapshots include every new write-scope key with the decisions listed above.
- Legacy stored snapshots missing the new keys are normalized to `false` for those keys when returned or reused.
- Provider/read constraints still fail exactly as before when exposure exceeds reads.

- [ ] **Step 3: Run the red tests**

Run:

```bash
pnpm --dir server test --run src/dtos/agent-operation.dto.spec.ts src/dtos/agent-session.dto.spec.ts src/services/agent-session.service.spec.ts
```

Expected: fail because enums, schemas, and permission snapshot keys do not exist yet.

- [ ] **Step 4: Implement DTO and permission snapshot support**

Implementation notes:

- Rename internal schema aliases from album-only names to gallery-operation names, but keep exported DTO class names and existing MCP tool names for backward compatibility in this slice.
- Add discriminated Zod operation schemas per operation type.
- Replace album-specific `validateTarget` with target validators that know album, space, asset-batch, and image-edit rules.
- Expand `AgentOperationItemKindSchema` from `z.literal('asset')` to an enum/schema that supports `asset`, `album`, `space`, `person`, and `tag`.
- Keep apply item selections limited to affected `assetIds` for this slice; other item kinds should parse but be rejected by service validation unless a future operation declares an affected set for them.
- Add permission snapshot normalization for old sessions before DTO response encoding and before permission checks.

- [ ] **Step 5: Verify DTO and permission tests pass**

Run the command from Step 3 again. Then run:

```bash
pnpm --dir server test --run src/services/agent-mcp-tool-registry.service.spec.ts
```

Expected: all pass, with MCP tool schemas now advertising the expanded operation contract.

## Task 2: Server Plan Validation And Apply Execution

**Files:**

- Modify: `server/src/services/agent-operation-plan.service.ts`
- Modify: `server/src/services/agent-operation-plan.service.spec.ts`
- Modify: `server/src/repositories/access.repository.ts`
- Modify: `server/src/types/agent-tool.types.ts`
- Modify: `server/src/dtos/agent-operation.dto.ts`
- Modify: `server/src/services/index.ts` if dependency injection needs new service imports

- [ ] **Step 1: Write failing service tests for propose/revise validation**

In `server/src/services/agent-operation-plan.service.spec.ts`, add tests that:

- Propose stores new operation types with target IDs, temporary IDs, asset IDs, payload, dependencies, risk, and enabled state.
- New space temporary IDs must be unique and referenced only after the corresponding create operation.
- Album/space add/remove operations targeting missing temporary IDs are denied.
- Existing space operations require editor/owner access; add a repository helper such as `accessRepository.sharedSpace.checkRoleAccess`.
- Existing album remove requires writable album access.
- Asset-batch operations validate readable/updateable assets according to the session asset scope and lock rules.
- Write-scope denial produces clear operation-specific errors for each new write-scope field.
- Planning audit redacted metadata includes `spaceIds`, `tagIds`, and `assetIds` without raw payload leakage.

- [ ] **Step 2: Write failing service tests for apply behavior**

Add apply tests that:

- `album.removeAssets` calls `albumService.removeAssets` and records per-asset results.
- `space.create` calls `sharedSpaceService.create` and stores temporary-to-real space ID mapping.
- `space.addAssets` and `space.removeAssets` resolve new and existing space targets and call `sharedSpaceService.addAssets/removeAssets`.
- `space.updateDetails` calls `sharedSpaceService.update`.
- `asset.setFavorite` calls `assetService.updateAll` with `isFavorite`.
- `asset.setArchive` calls `assetService.updateAll` with `AssetVisibility.Archive` or `AssetVisibility.Timeline`.
- `asset.addTag` with `tagName` upserts the tag, then tags selected assets.
- `asset.addTag` with `tagId` tags selected assets after tag access validation.
- `asset.removeTag` untags selected assets.
- `asset.rotate` merges each asset's existing rotate edit with the requested relative angle and calls `assetService.editAsset` or `removeAssetEdits` when the net rotation returns to zero.
- Per-asset failures in tag/album/rotate operations return `failed` or `partially_applied` summary without losing successful asset results.
- Sparse item selections restrict the selected asset IDs for every new asset-based operation.
- Selecting `none` or excluding all items skips the operation with `No selected items for operation`.
- Field overrides for `spaceName`, `description`, `targetAlbumId`, `targetSpaceId`, and `rotationAngle` are validated and applied.
- Unsupported field override keys for each new operation are rejected.
- Apply revalidates write scope and target access immediately before execution.
- Rotate handles existing crop/mirror edits without dropping them, removes the rotate edit when the net angle is 0, and reports non-image or otherwise non-editable assets as per-asset failures.
- Apply rejects or fails cleanly when a target album, target space, tag, or selected asset no longer exists at apply time.

- [ ] **Step 3: Run the red service tests**

Run:

```bash
pnpm --dir server test --run src/services/agent-operation-plan.service.spec.ts
```

Expected: fail because validation and apply are album-only.

- [ ] **Step 4: Implement service validation and apply**

Implementation notes:

- Rename `AgentAlbumOperationInput` to `AgentGalleryOperationInput`, keeping a type alias if it reduces churn.
- Track `createdAlbumIdByTemporaryTargetId` and `createdSpaceIdByTemporaryTargetId` separately.
- Add target helpers: `resolveTargetAlbumId`, `resolveTargetSpaceId`, `requireSpacePayload`, `requireAssetBatchPayload`, `requireRotationPayload`, `requireTagPayload`.
- Inject `SharedSpaceService`, `AssetService`, and `TagService`.
- Reuse existing services instead of writing direct database mutations.
- Add a small server-side `mergeRotationEdits` helper equivalent to the frontend `mergeRotation` behavior, with focused unit coverage inside the service spec.
- Normalize target override fields before execution: `targetAlbumId`/`targetSpaceId` replace the stored target and clear any incompatible temporary target dependency.
- Normalize `rotationAngle` field overrides to `payload.angle`; do not introduce a second rotation key in stored operation payloads.
- Extend `AgentOperationResult` with optional `spaceId`, `tagId`, `assetResults`, and `skippedReason`.
- Keep operation status semantics unchanged: applied, skipped, failed; overall response remains applied, partially applied, or failed.
- Keep legacy album-only plans and operation-only apply payloads working.

- [ ] **Step 5: Verify server service coverage**

Run:

```bash
pnpm --dir server test --run src/services/agent-operation-plan.service.spec.ts src/dtos/agent-operation.dto.spec.ts src/dtos/agent-session.dto.spec.ts src/services/agent-session.service.spec.ts src/services/agent-mcp-tool-registry.service.spec.ts
pnpm --dir server check:typescript
```

Expected: all pass.

## Task 3: OpenAPI And SDK Regeneration

**Files:**

- Generated: `open-api/immich-openapi-specs.json`
- Generated: `open-api/typescript-sdk/**`
- Generated/modified SDK consumers in `web/src/**`

- [ ] **Step 1: Write or update SDK-facing compile tests**

Update existing frontend/server compile expectations so the generated SDK exposes:

- Expanded `AgentOperationType`.
- Expanded `AgentOperationTargetKind`.
- Expanded `AgentOperationItemKind`.
- Expanded apply item selection schema.

- [ ] **Step 2: Generate API artifacts**

Run the repo's established OpenAPI/SDK command. Prefer the existing project command if present; otherwise use the command documented by the repo:

```bash
make open-api-typescript
```

If the repo uses a different local target, inspect `Makefile` and use the matching OpenAPI SDK target.

- [ ] **Step 3: Verify generated types compile**

Run:

```bash
pnpm --dir web check:typescript
pnpm --dir server check:typescript
```

Expected: type errors reveal every frontend/server call site that still assumes album-only operation enums.

## Task 4: Frontend Review Model For Spaces And Asset Batches

**Files:**

- Modify: `web/src/routes/(user)/assistant/agent-operation-plan-ui.ts`
- Modify: `web/src/routes/(user)/assistant/agent-operation-plan-ui.spec.ts`
- Modify: `web/src/routes/(user)/assistant/agent-plan-large-item-review-ui.ts`
- Modify: `web/src/routes/(user)/assistant/agent-plan-large-item-review-ui.spec.ts` if tag/space metadata facets need adjustment

- [ ] **Step 1: Write failing view-model tests**

Add tests in `agent-operation-plan-ui.spec.ts` that:

- Space create/add/update/remove operations group into one `space` destination by temporary or existing space target.
- Asset favorite/archive/tag operations group into `assetBatch` destinations with stable titles.
- Rotation operations group into `imageEditBatch` destinations.
- Album remove assets remains an `album` destination.
- Operation summaries are user-facing:
  - `Remove 3 photos`
  - `Create space "Family"`
  - `Add 12 photos`
  - `Rename space to "Summer"`
  - `Rotate 8 photos clockwise`
  - `Favorite 5 photos`
  - `Unfavorite 5 photos`
  - `Archive 7 photos`
  - `Restore 7 photos to timeline`
  - `Add tag "Receipts" to 9 photos`
  - `Remove tag from 9 photos`
- Unknown future operation types still fall back to `operation.summary`.
- Missing destination metadata falls back to concise non-technical labels.
- Operations with zero affected items are non-selectable but still visible when the operation itself is meaningful, such as create/update space.
- Sparse selection payloads preserve item kind and mode for new operations.
- `toAgentOperationItemSelections` maps all supported item kinds through the generated SDK enum instead of always forcing `Asset`.
- Inline field metadata exists for `spaceName`, `description`, `targetAlbumId`, `targetSpaceId`, and `rotationAngle` when those fields are supported by the operation.
- Field validation catches blank space names, invalid target IDs, and invalid rotation angles.

- [ ] **Step 2: Run the red view-model tests**

Run:

```bash
pnpm --dir web test --run "src/routes/(user)/assistant/agent-operation-plan-ui.spec.ts"
```

Expected: fail because labels, grouping, field support, and SDK item-kind mapping are album-only.

- [ ] **Step 3: Implement frontend view-model support**

Implementation notes:

- Replace album-only label maps with partial maps that include all new operation types plus a fallback.
- Generalize `getGroupId`, `getGroupTitle`, `getReviewDestination`, and `getOperationReviewSummary`.
- Derive destination names from payloads where possible:
  - Album: `albumName`.
  - Space: `spaceName`.
  - Tag: `tagName` or `tagId`.
  - Asset/image batch: summary or generated action label.
- Keep thumbnail summaries bounded through existing representative thumbnail logic.
- Add editable field union variants for `spaceName` and `rotationAngle`.
- Add existing-target selector field variants for `targetAlbumId` and `targetSpaceId`; keep them hidden when the UI lacks enough destination metadata to make a safe choice.
- Update `applyOperationFieldOverrides`, `buildSparseOperationFieldOverrides`, and validation helpers for the new fields.
- Preserve all existing album behavior and tests.

- [ ] **Step 4: Verify view-model tests**

Run:

```bash
pnpm --dir web test --run "src/routes/(user)/assistant/agent-operation-plan-ui.spec.ts" "src/routes/(user)/assistant/agent-plan-large-item-review-ui.spec.ts"
```

Expected: all pass.

## Task 5: Frontend Components And I18n

**Files:**

- Modify: `web/src/routes/(user)/assistant/agent-plan-destination-card.svelte`
- Modify: `web/src/routes/(user)/assistant/agent-plan-operation-row.svelte`
- Modify: `web/src/routes/(user)/assistant/agent-plan-inline-field-editor.svelte` if present, or the component currently rendering editable fields
- Modify: `web/src/routes/(user)/assistant/agent-plan-evidence-ledger.svelte`
- Modify: related component specs under `web/src/routes/(user)/assistant/*.spec.ts`
- Modify: `web/src/lib/i18n/en.json`
- Modify: `web/src/routes/(user)/assistant/agent-operation-plan-i18n.spec.ts`

- [ ] **Step 1: Write failing component tests**

Add/extend component tests that:

- Destination cards render space, asset-batch, and image-edit destination type labels without exposing raw enum strings.
- Operation rows render the new user-facing summaries and counts.
- Thumbnail strips render for new asset-based operations and remain bounded.
- Expanded item review works for rotate/archive/favorite/tag/space add/remove operations.
- Mixed state displays after excluding photos from a new operation type.
- Apply bar counts selected operations/assets across albums, spaces, asset batches, and image edits.
- Inline space name, target album/space, and rotation angle edits update the apply payload.
- Disabled new operations and blocked dependencies disable apply in the same way as album operations.
- Technical details remain hidden by default for the new operation types.
- Long space/tag names wrap without layout overlap.
- Mobile/narrow viewport layout keeps cards and sticky apply bar usable.

- [ ] **Step 2: Run the red component tests**

Run the focused component specs, for example:

```bash
pnpm --dir web test --run "src/routes/(user)/assistant/agent-plan-destination-card.spec.ts" "src/routes/(user)/assistant/agent-plan-operation-row.spec.ts" "src/routes/(user)/assistant/agent-plan-evidence-ledger.spec.ts" "src/routes/(user)/assistant/agent-operation-plan-review-panel.spec.ts" "src/routes/(user)/assistant/agent-operation-plan-i18n.spec.ts"
```

Expected: fail for missing labels, editable controls, and i18n keys.

- [ ] **Step 3: Implement component and i18n updates**

Implementation notes:

- Add concise copy keys for new operation type names, destination kinds, and editable-field labels.
- Avoid adding visible protocol text; keep raw operation IDs only inside existing technical details.
- Use existing controls and visual density from Slices 1-6.
- Do not render every item in collapsed or expanded large-plan views.

- [ ] **Step 4: Verify component tests**

Run the command from Step 2 again.

Expected: all pass.

## Task 6: End-To-End And Regression Coverage

**Files:**

- Add/modify focused E2E specs for assistant plan review, using the existing test location/pattern for assistant flows.
- Modify server integration specs if the repo has an existing medium/integration flow for agent plans.

- [ ] **Step 1: Write failing E2E or integration tests**

Add tests that simulate:

- User asks Pi to create or update a space and add selected photos. The plan preview shows a space destination, user applies it, and the operation status appears in chat.
- User asks Pi to rotate a batch of photos. The plan preview shows an image-edit destination, user excludes one photo, applies, and the sparse selection excludes that photo.
- User asks Pi to favorite/archive/tag a batch. The plan preview shows an asset-batch destination, user applies, and apply results are visible.
- User asks Pi to revise a space or asset-batch plan; the replacement revision is shown and the superseded plan cannot be applied accidentally.
- A stale plan revision is rejected with a refresh/replan state instead of applying old changes.
- A partial apply failure shows applied/skipped/failed operation states in the existing review surface.

- [ ] **Step 2: Run the red flow tests**

Use the repo's focused E2E command for assistant specs. If the flow is covered by server integration tests instead, run the corresponding server test command.

Expected: fail until server and frontend are wired end-to-end.

- [ ] **Step 3: Implement any missing mocks/fixtures/wiring**

Implementation notes:

- Prefer deterministic fake runner/tool responses over real model calls.
- Use small photo fixtures for E2E and unit tests.
- Add a large-plan regression case only where virtualization is observable without excessive runtime.

- [ ] **Step 4: Verify full focused regression set**

Run:

```bash
pnpm --dir server test --run src/dtos/agent-operation.dto.spec.ts src/dtos/agent-session.dto.spec.ts src/services/agent-session.service.spec.ts src/services/agent-operation-plan.service.spec.ts src/services/agent-mcp-tool-registry.service.spec.ts
pnpm --dir web test --run "src/routes/(user)/assistant/agent-operation-plan-ui.spec.ts" "src/routes/(user)/assistant/agent-plan-destination-card.spec.ts" "src/routes/(user)/assistant/agent-plan-operation-row.spec.ts" "src/routes/(user)/assistant/agent-plan-evidence-ledger.spec.ts" "src/routes/(user)/assistant/agent-operation-plan-review-panel.spec.ts" "src/routes/(user)/assistant/agent-operation-plan-i18n.spec.ts"
pnpm --dir server check:typescript
pnpm --dir web check:typescript
pnpm --dir web check:svelte
pnpm --filter immich-web run format
```

Also use CI for the final confidence pass, since this slice touches generated SDK, server DTOs, and frontend components.

## Acceptance Criteria

- Pi can propose and apply valid space, add/remove, rotate, favorite/archive, and tag plans through the first-party MCP planning tool.
- The visual plan review shows user-friendly destination cards and operation rows for every new operation type.
- Sparse item selection and inline field overrides work for the new operation types and are revalidated server-side.
- Permission presets and custom permission plans explicitly cover the new write scopes.
- Legacy album plans and operation-only apply payloads continue to work.
- Unknown future operation types remain displayable without breaking the review UI.
- Focused unit/component/API/E2E coverage is green locally, and CI is used for the final verification pass.
