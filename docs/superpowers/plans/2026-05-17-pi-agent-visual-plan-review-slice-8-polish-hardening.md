# Pi Agent Visual Plan Review Slice 8 Polish And Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the Pi visual plan review with accessible, mobile-friendly, low-noise review states, on-demand technical details, and regression coverage proving large plans stay fast.

**Architecture:** Keep Slice 8 as a frontend-led hardening slice on top of the Slice 1-7 model, component, server apply, and operation-vocabulary work. Add small pure helper functions for status summaries and technical-detail redaction, then wire those helpers into existing Svelte components without introducing a new plan-review endpoint or new operation types. Use focused component/unit tests first, then add deterministic Playwright coverage for the critical user flows.

**Tech Stack:** Svelte 5, TypeScript, Vitest, Svelte Testing Library, Playwright web E2E, generated `@immich/sdk`, existing operation-plan DTOs, existing deterministic e2e runner.

---

## Prerequisites

Implement this slice after Slice 7 is functionally complete:

- `docs/superpowers/plans/2026-05-17-pi-agent-visual-plan-review-slice-7-spaces-image-edit-operations.md` tasks 1-6 are implemented.
- Generated OpenAPI/SDK artifacts include the Slice 7 operation vocabulary.
- Focused Slice 7 server and web tests are green.

If this plan is started while Slice 7 is partially implemented, do not rework unfinished Slice 7 behavior inside Slice 8. Finish Slice 7 first, then return to this plan.

## Scope

This is Slice 8 from `docs/superpowers/specs/2026-05-17-pi-agent-visual-plan-review-design.md`:

- Accessibility polish for the review panel, destination cards, operation rows, expanded item review, and sticky apply bar.
- Mobile expanded review usability for narrow viewports.
- Partial apply states that are visible and understandable after apply.
- Technical details disclosure that keeps operation IDs, raw payloads, and raw errors hidden by default.
- Performance regression tests for collapsed and expanded large plans.
- Deterministic E2E coverage for the final user-facing plan review behavior.

Out of scope:

- New Pi operation types.
- New server-side plan-review endpoint.
- New image edit operations beyond Slice 7 rotation.
- Deleting/trashing photos, deleting spaces, deleting albums, or changing space members.
- A visual redesign of the assistant page outside the plan-review surface.

## Existing Code Context

- `web/src/routes/(user)/assistant/agent-operation-plan-ui.ts`
  - Builds `OperationReviewModel`, `OperationReviewItem`, destination groups, selection payloads, field overrides, and review summaries.
- `web/src/routes/(user)/assistant/agent-plan-evidence-ledger.svelte`
  - Renders the plan header, destination cards, status/error/success messages, and sticky apply bar.
- `web/src/routes/(user)/assistant/agent-plan-destination-card.svelte`
  - Renders grouped operations for a destination and group-level selection state.
- `web/src/routes/(user)/assistant/agent-plan-operation-row.svelte`
  - Renders one operation, inline fields, expanded item review, and basic technical details.
- `web/src/routes/(user)/assistant/agent-plan-item-review.svelte`
  - Renders the virtualized expanded item review for affected photos.
- `web/src/routes/(user)/assistant/agent-plan-large-item-review-ui.ts`
  - Owns virtual-window, filtering, and sparse bulk-selection helpers.
- `web/src/routes/(user)/assistant/agent-operation-plan-review-panel.svelte`
  - Loads the current plan, owns local selection/override state, applies the plan, and reacts to websocket plan events.
- `i18n/en.json`
  - English strings used by assistant plan review components.
- `e2e/src/specs/web/assistant-album-organizer.e2e-spec.ts`
  - Deterministic browser flow for proposal, preview, user edits, sparse item selection, apply, and denied proposals.

## File Structure

- Modify: `web/src/routes/(user)/assistant/agent-operation-plan-ui.ts`
  - Add pure status-summary and technical-detail model helpers.
- Modify: `web/src/routes/(user)/assistant/agent-operation-plan-ui.spec.ts`
  - Unit tests for partial apply, skipped states, field errors, technical-detail redaction, and large-plan summary invariants.
- Create: `web/src/routes/(user)/assistant/agent-plan-technical-details.svelte`
  - On-demand disclosure for operation type, risk, status, ID, dependencies, selected item count, sanitized payload, sanitized result, and error.
- Create: `web/src/routes/(user)/assistant/agent-plan-technical-details.spec.ts`
  - Component tests proving technical details are hidden by default, accessible when opened, and sanitized.
- Modify: `web/src/routes/(user)/assistant/agent-plan-operation-row.svelte`
  - Replace inline `<details>` technical block with the new technical-details component.
  - Add clearer status chips and partial/failed/skipped result messaging.
- Modify: `web/src/routes/(user)/assistant/agent-plan-operation-row.spec.ts`
  - Tests for status chips, keyboard disclosure, hidden technical details, partial failures, and disabled states.
- Modify: `web/src/routes/(user)/assistant/agent-plan-destination-card.svelte`
  - Add stronger region labelling, mobile layout data hooks, and status summary copy per destination.
- Modify: `web/src/routes/(user)/assistant/agent-plan-destination-card.spec.ts`
  - Tests for accessible regions, mixed selection state, mobile-safe classes, and destination status summaries.
- Modify: `web/src/routes/(user)/assistant/agent-plan-evidence-ledger.svelte`
  - Add partial apply summary banner, accessible plan-region labelling, and apply bar landmarks.
- Modify: `web/src/routes/(user)/assistant/agent-plan-evidence-ledger.spec.ts`
  - Tests for partial apply banners, alert/status roles, no raw technical text by default, and apply bar semantics.
- Modify: `web/src/routes/(user)/assistant/agent-plan-apply-bar.svelte`
  - Add explicit accessible label, selected-change summary, and narrow viewport class hooks.
- Create: `web/src/routes/(user)/assistant/agent-plan-apply-bar.spec.ts`
  - Focused tests for apply bar semantics, disabled state, applying state, and narrow viewport class hooks.
- Modify: `web/src/routes/(user)/assistant/agent-plan-item-review.svelte`
  - Improve mobile grid controls, focus labels, selected/excluded announcements, and no-thumbnail failure text.
- Modify: `web/src/routes/(user)/assistant/agent-plan-item-review.spec.ts`
  - Tests for mobile/narrow layout hooks, keyboard selection, filtered empty states, disabled controls, and bounded rendering.
- Modify: `web/src/routes/(user)/assistant/agent-operation-plan-review-panel.svelte`
  - Preserve selection/override state across collapse/reopen and show stale/apply/network failures without clearing an existing plan.
- Modify: `web/src/routes/(user)/assistant/agent-operation-plan-review-panel.spec.ts`
  - Tests for stale plan rejection, partial apply response, network failure while applying, selection persistence, and websocket refresh behavior.
- Modify: `web/src/routes/(user)/assistant/agent-operation-plan-i18n.spec.ts`
  - Coverage for every new user-visible English key.
- Modify: `i18n/en.json`
  - Add final Slice 8 copy keys.
- Modify: `e2e/src/specs/web/assistant-album-organizer.e2e-spec.ts`
  - Add deterministic web coverage for technical-details disclosure, mobile expanded review, revise/superseded plan handling, thumbnail failure fallback, and partial/stale apply states.

## Test And Edge Case Coverage

Every task starts with failing tests. Confirm each red state is for the intended missing behavior before implementation.

Required coverage:

- Review panel has an accessible labelled region and does not rely on color alone for status.
- Destination cards expose stable region names and mixed checkbox state through `aria-checked="mixed"`.
- Operation rows expose clear status chips for proposed, applied, skipped, failed, and partial states.
- Technical details are hidden by default and operation IDs/raw payloads/raw results are not visible until disclosure opens.
- Technical details disclosure is keyboard reachable and has an accessible name.
- Technical details sanitize large arrays and payloads so the UI does not render thousands of IDs.
- Partial apply shows applied/skipped/failed counts and per-operation states.
- A failed operation with successful per-asset results is described as partial, not as total success.
- Skipped operations show user-facing skipped reasons such as dependency not applied or no selected items.
- Stale plan rejection shows a refresh/replan state without clearing the current plan.
- Network failure while applying keeps the loaded plan visible and exposes a retry-safe error.
- Collapsing and reopening a plan preserves operation, item, and field override state.
- Mobile/narrow layout keeps destination cards, item review filters, virtual grid, and sticky apply bar usable.
- Expanded item review works with keyboard selection and disabled state.
- Empty filtered result sets are announced and do not break bulk controls.
- Thumbnail load/network failures show fallback UI for mounted thumbnails only and do not block selection or apply.
- Rendering a 1,000+ asset collapsed plan mounts bounded thumbnails.
- Expanding a 1,000+ asset operation mounts only the virtual window and overscan.
- Selection count and impact summary helpers do not enumerate rendered DOM nodes.
- Permission or target-ownership rejection keeps the current plan visible and uses user-facing failure copy.
- Asking Pi to revise or supersede a plan prevents the old plan from being applied accidentally.
- E2E covers the happy path with real apply status in chat, on-demand technical details, mobile expanded review, revise/superseded plan handling, thumbnail failure fallback, and one stale/partial apply path.

## Task 1: Review Status And Technical Detail Model

**Files:**

- Modify: `web/src/routes/(user)/assistant/agent-operation-plan-ui.ts`
- Modify: `web/src/routes/(user)/assistant/agent-operation-plan-ui.spec.ts`

- [ ] **Step 1: Write failing pure-model tests**

Add tests in `agent-operation-plan-ui.spec.ts` for:

```ts
it('summarizes partial apply states without treating failed per-asset rows as success', () => {
  const model = buildOperationReviewModel(
    plan([
      operation({ id: createId, status: AgentOperationStatus.Applied, result: { albumId } }),
      operation({
        id: addId,
        type: AgentOperationType.AlbumAddAssets,
        targetKind: AgentOperationTargetKind.ExistingAlbum,
        targetId: albumId,
        assetIds: [assetA, assetB],
        status: AgentOperationStatus.Failed,
        result: {
          albumId,
          assetIds: [assetA],
          assetResults: [
            { id: assetA, success: true },
            { id: assetB, success: false, errorMessage: 'Asset no longer exists' },
          ],
        },
        error: 'Failed to add 1 asset(s)',
      }),
    ]),
    { [createId]: true, [addId]: true },
    {},
  );

  expect(buildOperationReviewApplyStateSummary(model)).toEqual({
    appliedCount: 1,
    skippedCount: 0,
    failedCount: 1,
    partialCount: 1,
    hasFailures: true,
  });
  expect(model.operationsById.get(addId)?.applyState).toMatchObject({
    kind: 'partial',
    appliedAssetCount: 1,
    failedAssetCount: 1,
  });
});

it('builds sanitized technical details with bounded arrays', () => {
  const item = buildOperationReviewModel(
    plan([
      operation({
        id: addId,
        type: AgentOperationType.AlbumAddAssets,
        targetKind: AgentOperationTargetKind.ExistingAlbum,
        targetId: albumId,
        assetIds: Array.from({ length: 1000 }, (_, index) => `asset-${index}`),
        payload: {},
      }),
    ]),
    { [addId]: true },
    {},
  ).operationsById.get(addId)!;

  expect(buildOperationTechnicalDetails(item)).toMatchObject({
    operationId: addId,
    operationType: AgentOperationType.AlbumAddAssets,
    assetIdPreview: expect.arrayContaining(['asset-0']),
    assetOverflowCount: 980,
  });
});
```

Also add edge tests for:

- `AgentOperationStatus.Skipped` with `result.skippedReason`.
- `AgentOperationStatus.Failed` with no `assetResults`.
- Unknown/future result shapes.
- Empty `assetIds`.
- Existing field errors still disable apply.

- [ ] **Step 2: Run red tests**

Run:

```bash
pnpm --dir web test --run "src/routes/(user)/assistant/agent-operation-plan-ui.spec.ts"
```

Expected: fail because `buildOperationReviewApplyStateSummary`, `OperationReviewItem.applyState`, and `buildOperationTechnicalDetails` do not exist.

- [ ] **Step 3: Implement pure helpers**

Implementation notes:

- Add a local `OperationApplyState` union:
  - `proposed`
  - `applied`
  - `partial`
  - `failed`
  - `skipped`
- Derive `partial` when an operation is failed but `result.assetResults` contains at least one successful item.
- Keep technical-detail arrays bounded to 20 visible IDs and an overflow count.
- Do not stringify raw payloads in the helper. Return structured sanitized fields so Svelte can render them safely.

- [ ] **Step 4: Verify pure-model tests pass**

Run:

```bash
pnpm --dir web test --run "src/routes/(user)/assistant/agent-operation-plan-ui.spec.ts"
```

Expected: pass.

- [ ] **Step 5: Commit Task 1**

```bash
git add web/src/routes/(user)/assistant/agent-operation-plan-ui.ts web/src/routes/(user)/assistant/agent-operation-plan-ui.spec.ts
git commit -m "test(web): harden assistant plan review state model"
```

## Task 2: Partial Apply And Technical Details UI

**Files:**

- Create: `web/src/routes/(user)/assistant/agent-plan-technical-details.svelte`
- Create: `web/src/routes/(user)/assistant/agent-plan-technical-details.spec.ts`
- Modify: `web/src/routes/(user)/assistant/agent-plan-operation-row.svelte`
- Modify: `web/src/routes/(user)/assistant/agent-plan-operation-row.spec.ts`
- Modify: `web/src/routes/(user)/assistant/agent-plan-evidence-ledger.svelte`
- Modify: `web/src/routes/(user)/assistant/agent-plan-evidence-ledger.spec.ts`
- Modify: `i18n/en.json`
- Modify: `web/src/routes/(user)/assistant/agent-operation-plan-i18n.spec.ts`

- [ ] **Step 1: Write failing technical details component tests**

Add `agent-plan-technical-details.spec.ts` covering:

- Operation ID is hidden while details are closed.
- Opening the disclosure shows operation ID, type, risk, status, bounded asset ID preview, and overflow count.
- Payload/result arrays are bounded and do not render every asset ID.
- Failed operation details show sanitized error text only inside the disclosure.
- Disclosure button is reachable by role and toggles via keyboard.

Use assertions like:

```ts
expect(screen.queryByText(addId)).not.toBeInTheDocument();
await user.keyboard('{Tab}{Enter}');
expect(screen.getByText(addId)).toBeInTheDocument();
expect(screen.getByText('980 more asset IDs')).toBeInTheDocument();
```

- [ ] **Step 2: Write failing row and ledger tests**

Extend existing specs to cover:

- `AgentPlanOperationRow` renders `Partially applied` for failed operations with successful per-asset results.
- `AgentPlanOperationRow` renders `Skipped: Dependency was not applied` for skipped operations with `result.skippedReason`.
- `AgentPlanEvidenceLedger` renders a partial apply banner with applied/skipped/failed counts.
- Raw operation IDs and raw payload values are absent before opening technical details.
- Applied plans keep selection controls disabled.

- [ ] **Step 3: Run red component tests**

Run:

```bash
pnpm --dir web test --run "src/routes/(user)/assistant/agent-plan-technical-details.spec.ts" "src/routes/(user)/assistant/agent-plan-operation-row.spec.ts" "src/routes/(user)/assistant/agent-plan-evidence-ledger.spec.ts" "src/routes/(user)/assistant/agent-operation-plan-i18n.spec.ts"
```

Expected: fail because the component and copy keys do not exist and rows still render only basic status text.

- [ ] **Step 4: Implement technical details and partial states**

Implementation notes:

- Use a `<button type="button">` disclosure instead of relying only on native `<summary>` behavior, so tests and screen readers have consistent `aria-expanded`.
- Render technical details in a named component to keep `agent-plan-operation-row.svelte` readable.
- Use user-facing status labels:
  - `Proposed`
  - `Applied`
  - `Partially applied`
  - `Failed`
  - `Skipped`
- Keep raw IDs and raw payloads out of the default row body.
- Add English keys:
  - `assistant_operation_status_partial`
  - `assistant_operation_skipped_reason`
  - `assistant_operation_partial_asset_summary`
  - `assistant_operation_detail_show`
  - `assistant_operation_detail_hide`
  - `assistant_operation_detail_assets_preview`
  - `assistant_operation_detail_assets_overflow`
  - `assistant_operation_apply_partial_summary`

- [ ] **Step 5: Verify component tests pass**

Run the command from Step 3 again.

Expected: pass.

- [ ] **Step 6: Commit Task 2**

```bash
git add web/src/routes/(user)/assistant/agent-plan-technical-details.svelte web/src/routes/(user)/assistant/agent-plan-technical-details.spec.ts web/src/routes/(user)/assistant/agent-plan-operation-row.svelte web/src/routes/(user)/assistant/agent-plan-operation-row.spec.ts web/src/routes/(user)/assistant/agent-plan-evidence-ledger.svelte web/src/routes/(user)/assistant/agent-plan-evidence-ledger.spec.ts web/src/routes/(user)/assistant/agent-operation-plan-i18n.spec.ts i18n/en.json
git commit -m "feat(web): polish assistant plan apply states"
```

## Task 3: Accessibility And Keyboard Hardening

**Files:**

- Modify: `web/src/routes/(user)/assistant/agent-plan-evidence-ledger.svelte`
- Modify: `web/src/routes/(user)/assistant/agent-plan-evidence-ledger.spec.ts`
- Modify: `web/src/routes/(user)/assistant/agent-plan-destination-card.svelte`
- Modify: `web/src/routes/(user)/assistant/agent-plan-destination-card.spec.ts`
- Modify: `web/src/routes/(user)/assistant/agent-plan-operation-row.svelte`
- Modify: `web/src/routes/(user)/assistant/agent-plan-operation-row.spec.ts`
- Modify: `web/src/routes/(user)/assistant/agent-plan-apply-bar.svelte`
- Create: `web/src/routes/(user)/assistant/agent-plan-apply-bar.spec.ts`
- Modify: `web/src/routes/(user)/assistant/agent-operation-plan-review-panel.spec.ts`
- Modify: `i18n/en.json`

- [ ] **Step 1: Write failing accessibility tests**

Add component tests for:

- Review panel container has `role="region"` and `aria-labelledby="assistant-operation-plan-title"` when the header is visible.
- Destination cards use `role="region"` and keep the destination title as the accessible label.
- Mixed destination and operation checkbox states expose `aria-checked="mixed"`.
- Apply bar has an accessible label such as `Review selected plan actions`.
- Alert and status messages use `role="alert"` and `role="status"` respectively.
- Keyboard users can toggle operation selection and details disclosure without a mouse.
- Disabled controls remain focusable only when native browser behavior allows it; no fake disabled buttons.

Example assertion:

```ts
expect(screen.getByRole('region', { name: 'Plan review' })).toBeInTheDocument();
expect(screen.getByRole('region', { name: 'Portugal Trip' })).toBeInTheDocument();
expect(screen.getByRole('checkbox', { name: 'Select destination Portugal Trip' })).toHaveAttribute(
  'aria-checked',
  'mixed',
);
```

- [ ] **Step 2: Run red accessibility tests**

Run:

```bash
pnpm --dir web test --run "src/routes/(user)/assistant/agent-plan-evidence-ledger.spec.ts" "src/routes/(user)/assistant/agent-plan-destination-card.spec.ts" "src/routes/(user)/assistant/agent-plan-operation-row.spec.ts" "src/routes/(user)/assistant/agent-plan-apply-bar.spec.ts" "src/routes/(user)/assistant/agent-operation-plan-review-panel.spec.ts"
```

Expected: fail where landmarks, labels, or keyboard disclosure behavior are missing.

- [ ] **Step 3: Implement accessibility improvements**

Implementation notes:

- Prefer native controls for checkboxes and buttons.
- Use `aria-labelledby` where visible headings already exist.
- Use `aria-describedby` for apply bar summary and field errors.
- Do not add visible explanatory text about keyboard shortcuts.
- Keep technical labels concise and user-facing.

- [ ] **Step 4: Verify accessibility tests pass**

Run the command from Step 2 again.

Expected: pass.

- [ ] **Step 5: Commit Task 3**

```bash
git add web/src/routes/(user)/assistant/agent-plan-evidence-ledger.svelte web/src/routes/(user)/assistant/agent-plan-evidence-ledger.spec.ts web/src/routes/(user)/assistant/agent-plan-destination-card.svelte web/src/routes/(user)/assistant/agent-plan-destination-card.spec.ts web/src/routes/(user)/assistant/agent-plan-operation-row.svelte web/src/routes/(user)/assistant/agent-plan-operation-row.spec.ts web/src/routes/(user)/assistant/agent-plan-apply-bar.svelte web/src/routes/(user)/assistant/agent-plan-apply-bar.spec.ts web/src/routes/(user)/assistant/agent-operation-plan-review-panel.spec.ts i18n/en.json
git commit -m "feat(web): harden assistant plan accessibility"
```

## Task 4: Mobile Expanded Review Polish

**Files:**

- Modify: `web/src/routes/(user)/assistant/agent-plan-item-review.svelte`
- Modify: `web/src/routes/(user)/assistant/agent-plan-item-review.spec.ts`
- Modify: `web/src/routes/(user)/assistant/agent-plan-destination-card.svelte`
- Modify: `web/src/routes/(user)/assistant/agent-plan-destination-card.spec.ts`
- Modify: `web/src/routes/(user)/assistant/agent-plan-apply-bar.svelte`
- Modify: `web/src/routes/(user)/assistant/agent-plan-evidence-ledger.spec.ts`
- Modify: `i18n/en.json`

- [ ] **Step 1: Write failing mobile component tests**

Add tests that assert:

- Expanded item review exposes a stable `data-testid="agent-plan-item-review-grid"` and `data-testid="agent-plan-item-review-toolbar"`.
- Toolbar controls wrap and remain grouped on narrow layouts.
- Virtual grid uses responsive columns and a bounded height instead of fixed desktop-only dimensions.
- Empty filter result renders `No matching photos` and disables filtered bulk actions.
- One mounted thumbnail failure renders fallback tile text and does not disable selection or bulk controls.
- Sticky apply bar uses classes compatible with narrow screens and still exposes the same apply button name.
- Long destination names and tag/space names wrap instead of truncating into controls.

Use jsdom-friendly assertions against roles, text, data test IDs, and class hooks. Do not depend on measured layout in unit tests.

- [ ] **Step 2: Run red mobile tests**

Run:

```bash
pnpm --dir web test --run "src/routes/(user)/assistant/agent-plan-item-review.spec.ts" "src/routes/(user)/assistant/agent-plan-destination-card.spec.ts" "src/routes/(user)/assistant/agent-plan-evidence-ledger.spec.ts"
```

Expected: fail because the explicit mobile hooks and empty-filter state are missing.

- [ ] **Step 3: Implement mobile polish**

Implementation notes:

- Keep controls dense and utilitarian.
- Use responsive Tailwind utilities already used in the assistant surface.
- Avoid nested cards.
- Use stable grid sizing:
  - bounded scroll container height;
  - responsive column min width;
  - fixed thumbnail aspect ratio;
  - no text overlap.
- Add English keys:
  - `assistant_operation_item_empty_filter`
  - `assistant_operation_item_toolbar_label`

- [ ] **Step 4: Verify mobile component tests pass**

Run the command from Step 2 again.

Expected: pass.

- [ ] **Step 5: Commit Task 4**

```bash
git add web/src/routes/(user)/assistant/agent-plan-item-review.svelte web/src/routes/(user)/assistant/agent-plan-item-review.spec.ts web/src/routes/(user)/assistant/agent-plan-destination-card.svelte web/src/routes/(user)/assistant/agent-plan-destination-card.spec.ts web/src/routes/(user)/assistant/agent-plan-apply-bar.svelte web/src/routes/(user)/assistant/agent-plan-evidence-ledger.spec.ts i18n/en.json
git commit -m "feat(web): polish assistant plan mobile review"
```

## Task 5: Performance Regression Tests

**Files:**

- Modify: `web/src/routes/(user)/assistant/agent-plan-large-item-review-ui.spec.ts`
- Modify: `web/src/routes/(user)/assistant/agent-plan-thumbnail-strip.spec.ts`
- Modify: `web/src/routes/(user)/assistant/agent-plan-thumbnail-strip.svelte`
- Modify: `web/src/routes/(user)/assistant/agent-plan-item-review.spec.ts`
- Modify: `web/src/routes/(user)/assistant/agent-plan-item-review.svelte`
- Modify: `web/src/routes/(user)/assistant/agent-operation-plan-review-panel.spec.ts`

- [ ] **Step 1: Write failing or strengthening performance tests**

Add tests for:

- `buildAgentPlanItemVirtualWindow` with 10,000 assets remains bounded and deterministic.
- Collapsed destination cards with 1,000 assets mount at most `AGENT_PLAN_THUMBNAIL_STRIP_MAX_LIMIT` thumbnail images.
- Expanded item review with 1,000 assets mounts only the virtual-window image count plus overscan.
- Thumbnail `src` generation is called only for mounted thumbnails.
- Updating one sparse selection does not require rendering all 1,000 assets.
- Reopening a collapsed operation keeps the sparse selection and restores the bounded virtual window.

Example component assertion:

```ts
render(AgentPlanItemReview, { props: largeItemReviewProps({ assetCount: 1000 }) });
expect(screen.getAllByTestId('agent-plan-item-thumbnail')).toHaveLength(60);
expect(screen.queryByLabelText('Include photo 1000')).not.toBeInTheDocument();
```

- [ ] **Step 2: Run red or strengthening tests**

Run:

```bash
pnpm --dir web test --run "src/routes/(user)/assistant/agent-plan-large-item-review-ui.spec.ts" "src/routes/(user)/assistant/agent-plan-thumbnail-strip.spec.ts" "src/routes/(user)/assistant/agent-plan-item-review.spec.ts" "src/routes/(user)/assistant/agent-operation-plan-review-panel.spec.ts"
```

Expected: at least one new assertion fails until missing test hooks or guardrails are added. Assertions that already pass stay as regression coverage.

- [ ] **Step 3: Implement only the missing performance guardrails**

Implementation notes:

- Do not add a new virtualization library unless the current helper cannot satisfy the tests.
- Keep thumbnail limits centralized in existing constants.
- Add data test IDs only where they pin a regression invariant.
- Do not render hidden images for off-window assets.

- [ ] **Step 4: Verify performance tests pass**

Run the command from Step 2 again.

Expected: pass.

- [ ] **Step 5: Commit Task 5**

```bash
git add web/src/routes/(user)/assistant/agent-plan-large-item-review-ui.spec.ts web/src/routes/(user)/assistant/agent-plan-thumbnail-strip.spec.ts web/src/routes/(user)/assistant/agent-plan-item-review.spec.ts web/src/routes/(user)/assistant/agent-operation-plan-review-panel.spec.ts web/src/routes/(user)/assistant/agent-plan-item-review.svelte web/src/routes/(user)/assistant/agent-plan-thumbnail-strip.svelte
git commit -m "test(web): lock assistant plan performance bounds"
```

## Task 6: Review Panel Failure And State Preservation

**Files:**

- Modify: `web/src/routes/(user)/assistant/agent-operation-plan-review-panel.svelte`
- Modify: `web/src/routes/(user)/assistant/agent-operation-plan-review-panel.spec.ts`
- Modify: `i18n/en.json`
- Modify: `web/src/routes/(user)/assistant/agent-operation-plan-i18n.spec.ts`

- [ ] **Step 1: Write failing panel state tests**

Add tests that cover:

- Stale plan apply rejection shows `This plan changed. Review the latest plan before applying.` and reloads the latest plan when available.
- Apply network failure keeps the current plan visible and keeps user selections intact for retry.
- Refresh network failure while a plan is loaded shows an alert but does not blank the plan.
- Permission or target ownership rejection shows user-facing failure copy and keeps the current plan visible.
- Collapsing and reopening the review preserves:
  - disabled operations;
  - sparse item selections;
  - field overrides;
  - opened technical details reset to closed, so raw IDs are hidden again.
- A successful partial apply resets local edit state to the applied plan and disables further mutation.

- [ ] **Step 2: Run red panel tests**

Run:

```bash
pnpm --dir web test --run "src/routes/(user)/assistant/agent-operation-plan-review-panel.spec.ts" "src/routes/(user)/assistant/agent-operation-plan-i18n.spec.ts"
```

Expected: fail where stale/retry copy and state-preservation behavior are missing.

- [ ] **Step 3: Implement panel hardening**

Implementation notes:

- Do not clear `plan`, `enabledByOperationId`, `itemSelectionByOperationId`, or `fieldOverrideByOperationId` on apply failure.
- Detect stale errors by status/message shape from the SDK error when available; otherwise keep the generic apply error.
- Keep websocket refresh semantics from earlier slices intact.
- Keep `planExpanded` true for errors so users can see and retry.

- [ ] **Step 4: Verify panel tests pass**

Run the command from Step 2 again.

Expected: pass.

- [ ] **Step 5: Commit Task 6**

```bash
git add web/src/routes/(user)/assistant/agent-operation-plan-review-panel.svelte web/src/routes/(user)/assistant/agent-operation-plan-review-panel.spec.ts web/src/routes/(user)/assistant/agent-operation-plan-i18n.spec.ts i18n/en.json
git commit -m "feat(web): preserve assistant plan review state on failures"
```

## Task 7: Deterministic E2E And Final Verification

**Files:**

- Modify: `e2e/src/specs/web/assistant-album-organizer.e2e-spec.ts`

- [ ] **Step 1: Write failing Playwright coverage**

Extend `assistant-album-organizer.e2e-spec.ts` with focused tests:

1. Existing real-server happy path still shows applied/skipped/failed operation status in chat after apply.
2. Technical details are hidden by default and appear only after opening details.
3. Mobile viewport can expand item review, exclude one photo, and apply the sparse selection.
4. User asks Pi to revise or supersede the plan before applying; the old plan apply action is gone or disabled and only the latest plan can be applied.
5. A mounted thumbnail request fails and the fallback tile appears while the plan remains selectable and applicable.
6. Stale apply response shows the stale/review-latest message and does not clear the visible plan.
7. Partial apply response shows applied/skipped/failed states and keeps operation IDs hidden until details are opened.

Use the deterministic runner and existing helper style for the happy, mobile, thumbnail-failure, and revise/superseded-plan paths. Do not use route interception for the normal apply or revise/superseded-plan assertions; those tests must exercise the real app/server path. For stale and partial apply UI edge-case assertions, intercept only the apply `POST` with `page.route` and fulfill a deterministic SDK-shaped response so the browser behavior is stable without adding runner branches:

```ts
await page.route(
  (url) =>
    url.pathname.includes(`/api/agent/sessions/${session.id}/operation-plan/`) && url.pathname.endsWith('/apply'),
  async (route) =>
    route.fulfill({
      status: 409,
      contentType: 'application/json',
      body: JSON.stringify({ message: 'Agent operation plan revision is stale' }),
    }),
);
```

Use one route override per test and remove the route after the assertion so the existing real-server apply path remains covered by the happy-path and revise/superseded-plan tests. Keep route-fulfilled partial apply response shapes copied from the server apply DTO fixtures; if the DTO changes, update the component, server, and E2E fixtures in the same task.

- [ ] **Step 2: Run red E2E**

Run the focused web spec:

```bash
pnpm --dir e2e test:web -- assistant-album-organizer.e2e-spec.ts
```

Expected: fail until the web UI and deterministic scenario support the new assertions.

- [ ] **Step 3: Implement deterministic scenario support**

Implementation notes:

- Prefer API setup in the Playwright test over adding runner behavior.
- For stale and partial apply assertions, use route-level apply responses scoped to that test rather than changing the deterministic runner.
- Avoid sleeps. Use `expect.poll`, response waits, and visible UI assertions.
- Keep tests independent through `utils.resetDatabase()` in `beforeEach`.

- [ ] **Step 4: Run focused unit and component verification**

Run:

```bash
pnpm --dir web test --run "src/routes/(user)/assistant/agent-operation-plan-ui.spec.ts" "src/routes/(user)/assistant/agent-plan-technical-details.spec.ts" "src/routes/(user)/assistant/agent-plan-operation-row.spec.ts" "src/routes/(user)/assistant/agent-plan-destination-card.spec.ts" "src/routes/(user)/assistant/agent-plan-evidence-ledger.spec.ts" "src/routes/(user)/assistant/agent-plan-apply-bar.spec.ts" "src/routes/(user)/assistant/agent-plan-item-review.spec.ts" "src/routes/(user)/assistant/agent-plan-thumbnail-strip.spec.ts" "src/routes/(user)/assistant/agent-plan-large-item-review-ui.spec.ts" "src/routes/(user)/assistant/agent-operation-plan-review-panel.spec.ts" "src/routes/(user)/assistant/agent-operation-plan-i18n.spec.ts"
pnpm --dir web check:typescript
pnpm --dir web check:svelte
```

- [ ] **Step 5: Run server and E2E verification**

Run:

```bash
pnpm --dir server test --run src/dtos/agent-operation.dto.spec.ts src/dtos/agent-session.dto.spec.ts src/services/agent-session.service.spec.ts src/services/agent-operation-plan.service.spec.ts src/services/agent-mcp-tool-registry.service.spec.ts
pnpm --dir server check
pnpm --dir e2e check
pnpm --dir e2e test:web -- assistant-album-organizer.e2e-spec.ts
```

Expected: all pass.

- [ ] **Step 6: Use CI for final confidence**

Push the branch and use CI as the final confidence pass because this slice touches browser behavior, generated SDK consumers, and deterministic E2E.

- [ ] **Step 7: Commit Task 7**

```bash
git add e2e/src/specs/web/assistant-album-organizer.e2e-spec.ts
git commit -m "test(e2e): harden assistant visual plan review"
```

## Acceptance Criteria

- The visual plan review can be used with keyboard and screen reader semantics.
- Mobile users can expand item review, filter, select/exclude photos, and apply without layout overlap.
- Partial apply results are visible at the plan, destination, and operation levels.
- Technical details remain hidden by default and are available on demand.
- Raw operation IDs, raw payloads, and raw result arrays never appear in default review UI.
- Stale apply and network failures preserve the current plan and user selection state.
- Large plans with 1,000+ assets remain bounded in collapsed and expanded rendering.
- Focused unit/component tests, server apply regressions, web type checks, Svelte checks, and deterministic E2E pass.
- CI is used before merging this final polish slice.

## Self-Review Checklist

- TDD is explicit in every task: each task starts with failing tests and red-state verification.
- Accessibility, mobile expanded review, partial apply states, technical details disclosure, and performance regressions are all covered by at least one task.
- Edge cases from the spec are mapped to unit/component/E2E tests.
- The plan does not add new operation vocabulary or a new endpoint outside Slice 8 scope.
- Technical details are structured and bounded instead of dumping raw JSON.
- Existing Slice 1-7 behavior remains preserved through focused regression commands.
