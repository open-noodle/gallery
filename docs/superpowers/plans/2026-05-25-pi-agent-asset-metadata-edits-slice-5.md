# Slice 5 Plan: Metadata Review UI and Activity Copy

> **For <PRIVATE_PERSON>:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan.

**Goal:** Make `asset.updateMetadata` plans reviewable in the web UI with clear operation copy, changed-field summaries, representative before/after values, coordinate warnings, selection edits, and metadata-specific activity/approval text where the tool call is clearly a metadata update.

**Constraints:**

- Follow TDD: write failing tests before implementation for each behavior cluster.
- Keep before-values out of MCP planning tool responses unless a future provider-exposure design explicitly allows them.
- Do not globally relabel generic asset batch operations as metadata changes; favorite/archive/tag/rotate still use existing asset-update copy.
- Keep UI styling restrained and consistent with the existing assistant plan-review surfaces.
- Preserve existing selection edit behavior: removing review items must affect the `itemSelections` payload and therefore the applied asset set.
- Unknown future metadata fields that reach the UI from older/newer servers must not crash the panel. Planning/apply validation must still reject unsupported payload fields such as `title`, `city`, `country`, and `placeName`.
- Apply responses and applied-plan history must preserve the pre-apply review snapshot. They must not re-read post-apply metadata and present it as the previous value.

## Phase 1: Server Review Metadata Contract

**Files:**

- `server/src/dtos/agent-operation.dto.ts`
- `server/src/repositories/asset.repository.ts`
- `server/src/queries/asset.repository.sql`
- `server/src/services/agent-operation-plan.service.ts`
- `server/src/services/agent-operation-plan.service.spec.ts`
- `server/src/types/agent-operation.types.ts`
- `open-api/immich-openapi-specs.json`
- `open-api/typescript-sdk/src/fetch-client.ts`

**Tests first:**

Add service tests proving:

1. `getCurrentPlan()` enriches `asset.updateMetadata` operations with representative metadata review values for changed fields.
2. `applyApprovedOperations()` returns the pre-apply review metadata in the response plan after apply, even when the write succeeds.
3. `getAppliedPlans()` returns the persisted pre-apply review metadata snapshot after apply, rather than querying current post-apply metadata.
4. `proposeAssetBatchFromSearch()` tool responses do **not** include review metadata.
5. Description clears, rating clears, date changes, timezone changes, and latitude/longitude changes are represented distinctly.
6. Missing asset metadata rows or deleted/unreadable sample assets do not fail plan rendering; they produce unknown previous values.
7. Unknown payload fields on already-stored operations are ignored by server review enrichment rather than throwing, while existing validation still rejects new unsupported planning/apply payloads.
8. Metadata planning audit request summaries include “metadata” for `asset.updateMetadata` plans and keep the existing generic copy for non-metadata asset batch plans.

**Implementation:**

1. Add an optional `reviewMetadata` field to `AgentOperationResponseSchema`.
2. Shape:

   ```ts
   reviewMetadata?: {
     assetMetadata?: {
       fields: Array<{
         key: string;
         label: string;
         previousValues: Array<{ assetId: string; value: string | number | null; valueKind: 'known' | 'empty' | 'unknown' }>;
         proposedValue: string | number | null;
         proposedValueKind: 'known' | 'empty' | 'clear' | 'relative' | 'unknown';
       }>;
       sampleAssetIds: string[];
       warnings: string[];
     };
   };
   ```

3. Keep the value type intentionally JSON-simple. Dates can be ISO strings, coordinates can be formatted as a single field value such as `"52.52, 13.405"`, and clears use `null` with a clear/empty kind.
4. Add an async `mapPlanForUserReview()` path used by:
   - `getCurrentPlan()`
   - `getAppliedPlans()`
   - `applyApprovedOperations()`

5. Leave `runPlanningTool()` on the existing plain `mapPlan()` so MCP tool responses do not receive before-values.
6. Add a bounded metadata sample size, using the same representative assets already used by the UI where possible. Five assets is enough for before/after review and limits query size.
7. Fetch only needed review fields for sampled assets via a new narrow repository helper or a direct existing repository helper if available. Prefer a narrow helper so adding `description` and `timeZone` does not broaden MCP read-tool metadata exposure.
8. Review field mapping:
   - `description`: previous `asset_exif.description`; empty string/null are shown as empty.
   - `rating`: previous `asset_exif.rating`; `null` proposed value is a clear.
   - `dateTimeOriginal`: previous `asset_exif.dateTimeOriginal`; proposed ISO string is known.
   - `dateTimeRelative`: previous `asset_exif.dateTimeOriginal`; proposed numeric minutes is relative.
   - `timeZone`: previous `asset_exif.timeZone`.
   - `latitude` + `longitude`: combine into one `location` review field with previous `"lat, lon"` and proposed `"lat, lon"`.

9. During apply, build the review metadata snapshot from the claimed plan **before** calling `applyClaimedPlan()`. Attach that snapshot to the response plan after statuses/results are updated.
10. Persist the pre-apply review snapshot in each applied metadata operation result, for example as `result.reviewMetadata`, so `getAppliedPlans()` can render history without re-reading current metadata.
11. Add server-side metadata planning summary support:

- `createPlanningAudit()` should produce request summaries such as `Store 1 proposed metadata operation(s)` when all operations are `asset.updateMetadata`.
- Mixed or non-metadata asset batch plans should keep generic/non-metadata wording.
- This gives the web activity/approval detection a reliable production signal instead of relying only on test fixture text.

12. Server may include a general coordinate warning marker, but the final visible warning is computed in the web model from current selected asset count so it updates after user deselection.

## Phase 2: Web Model Formatting

**Files:**

- `web/src/routes/(user)/assistant/agent-operation-plan-ui.ts`
- `web/src/routes/(user)/assistant/agent-operation-plan-ui.spec.ts`

**Tests first:**

1. `asset.updateMetadata` gets a metadata operation type label key.
2. Proposed metadata plan summaries read `Update metadata for N photos`.
3. Applied metadata plan summaries read `Updated metadata for N photos`.
4. Field review model includes changed field names and previous/proposed values from `reviewMetadata`.
5. Empty descriptions and cleared ratings are formatted clearly.
6. Latitude/longitude render as one location field.
7. Multi-asset coordinate warnings are exposed on the item model.
8. Unknown future metadata fields from payload or review metadata are safe and do not throw.
9. Deselecting assets updates metadata review samples and coordinate warnings based on the current selected asset set.

**Implementation:**

1. Add `AgentOperationMetadataReview` and `AgentOperationMetadataFieldReview` UI types.
2. Add `metadataReview?: AgentOperationMetadataReview` to `OperationReviewItem`.
3. Build metadata review from `operation.reviewMetadata?.assetMetadata` when present.
4. Add payload-only fallback for changed field names if a test fixture or older server response lacks `reviewMetadata`; previous values should be displayed as unavailable rather than crashing.
5. Add type label key `assistant_operation_type_asset_update_metadata`.
6. Add metadata-specific summaries:
   - proposed/pending: `Update metadata for N photos`
   - applied: `Updated metadata for N photos`

7. Keep `buildSelectionPayload()` unchanged unless tests show a gap; existing generic item-selection code should already support metadata operations.
8. Filter review samples and `previousValues` to the operation’s current selected asset IDs. If all sampled assets were deselected, show proposed values with current values unavailable rather than stale deselected values.
9. Compute the coordinate multi-asset warning from `selectedAssetIds.length > 1` and the presence of a location update, not only from server-provided warnings.

## Phase 3: Plan Row Rendering and Selection Review

**Files:**

- `web/src/routes/(user)/assistant/agent-plan-operation-row.svelte`
- `web/src/routes/(user)/assistant/agent-plan-operation-row.spec.ts`
- `web/src/routes/(user)/assistant/agent-operation-plan-review-panel.spec.ts`

**Tests first:**

1. Operation rows render metadata changed fields with before/after values.
2. Empty description and cleared rating display as explicit empty/clear states.
3. Coordinate updates show latitude/longitude together.
4. Coordinate updates for multiple selected assets show a warning, and the warning disappears after the user reduces selection to one asset.
5. Clicking `Change selection`, deselecting an asset, and applying sends `itemSelections` for `asset.updateMetadata`.
6. An operation-level apply failure renders the failed metadata card while successful sibling cards remain visible.

**Implementation:**

1. In `agent-plan-operation-row.svelte`, render a metadata review block when `item.metadataReview` exists.
2. Place the metadata changed-field block immediately after status/errors/blocked messages and before inline field editors, selection controls, and technical details. The changed fields are the primary review content for this operation type.
3. Use a compact table/list:
   - field label
   - current value sample
   - proposed value

4. Use existing text scale and status classes; do not add nested cards or large decorative panels.
5. Keep technical details and selection controls in their existing positions after the metadata review content.
6. Reuse existing item-review modal selection handlers; no metadata-specific selection state should be added.

## Phase 4: Applied Timeline Card

**Files:**

- `web/src/routes/(user)/assistant/agent-applied-plan-timeline-card.svelte`
- `web/src/routes/(user)/assistant/agent-applied-plan-timeline-card.spec.ts`

**Tests first:**

1. Applied metadata operations render `Updated metadata for N photos`.
2. Failed metadata operations render as failed without hiding successful sibling operation cards.

**Implementation:**

The timeline card should work from the model summary/apply state. Only update the component if the tests expose missing rendering.

## Phase 5: Activity and Approval Copy

**Files:**

- `web/src/routes/(user)/assistant/agent-activity-ui.ts`
- `web/src/routes/(user)/assistant/agent-activity-ui.spec.ts`
- `web/src/routes/(user)/assistant/agent-tool-approval-ui.ts`
- `web/src/routes/(user)/assistant/agent-tool-approval-ui.spec.ts`

**Tests first:**

1. Pending `ProposeAssetBatchFromSearch` tool calls whose request/response summaries clearly mention metadata show `Pi wants to draft metadata changes.`
2. Completed metadata planning tool calls show `Pi drafted metadata changes.`
3. Metadata planning activity shows `Preparing metadata update plan`.
4. Existing non-metadata `ProposeAssetBatchFromSearch` calls still show the previous generic asset-update copy.
5. Real service-created metadata planning audits include “metadata” in request summaries; the web tests should include fixtures shaped like those server summaries.

**Implementation:**

1. Add the server-side planning audit summary support described in Phase 1 before relying on web detection.
2. Add a small web helper that detects metadata planning from `toolCall.requestSummary`, `toolCall.responseSummary`, or technical summary text using a conservative `/metadata/i` check.
3. In approval copy helpers, return metadata-specific copy only when the helper matches.
4. In activity UI, clone the generic asset-batch definition with metadata title/completed summary only when the helper matches.
5. Keep response-summary override behavior for completed plan tools.

## Phase 6: Verification

Run these before committing:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-operation-plan.service.spec.ts
pnpm --dir server run build
cd open-api && ./bin/generate-open-api.sh typescript
git diff --exit-code -- open-api/immich-openapi-specs.json open-api/typescript-sdk/src/fetch-client.ts
pnpm --dir open-api/typescript-sdk run build
pnpm --dir web exec vitest run 'src/routes/(user)/assistant/agent-operation-plan-ui.spec.ts' 'src/routes/(user)/assistant/agent-plan-operation-row.spec.ts' 'src/routes/(user)/assistant/agent-operation-plan-review-panel.spec.ts' 'src/routes/(user)/assistant/agent-applied-plan-timeline-card.spec.ts' 'src/routes/(user)/assistant/agent-activity-ui.spec.ts' 'src/routes/(user)/assistant/agent-tool-approval-ui.spec.ts'
pnpm --dir web run check:svelte
pnpm --dir web run check:typescript
git diff --check
```

If OpenAPI generation changes SDK enum/type formatting outside the expected DTO addition, inspect before committing.

## Commit

After tests pass and both review gates approve:

```bash
git add docs/superpowers/plans/2026-05-25-pi-agent-asset-metadata-edits-slice-5.md server/src/dtos/agent-operation.dto.ts server/src/repositories/asset.repository.ts server/src/queries/asset.repository.sql server/src/services/agent-operation-plan.service.ts server/src/services/agent-operation-plan.service.spec.ts server/src/types/agent-operation.types.ts open-api/immich-openapi-specs.json open-api/typescript-sdk/src/fetch-client.ts web/src/routes/\\(user\\)/assistant/agent-operation-plan-ui.ts web/src/routes/\\(user\\)/assistant/agent-operation-plan-ui.spec.ts web/src/routes/\\(user\\)/assistant/agent-plan-operation-row.svelte web/src/routes/\\(user\\)/assistant/agent-plan-operation-row.spec.ts web/src/routes/\\(user\\)/assistant/agent-operation-plan-review-panel.spec.ts web/src/routes/\\(user\\)/assistant/agent-applied-plan-timeline-card.svelte web/src/routes/\\(user\\)/assistant/agent-applied-plan-timeline-card.spec.ts web/src/routes/\\(user\\)/assistant/agent-activity-ui.ts web/src/routes/\\(user\\)/assistant/agent-activity-ui.spec.ts web/src/routes/\\(user\\)/assistant/agent-tool-approval-ui.ts web/src/routes/\\(user\\)/assistant/agent-tool-approval-ui.spec.ts
git commit -m "feat: review pi agent metadata updates"
git push
```
