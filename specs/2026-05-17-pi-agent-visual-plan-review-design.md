# Pi Agent Visual Plan Review Design

## Context

Pi can now propose structured gallery operation plans before applying changes. The current review UI is functional, but it reads like a technical operation log: it exposes operation names, counts, and details without making the proposed gallery changes visually obvious.

For photo workflows, users need to quickly answer:

- What is Pi about to change?
- Which photos are affected?
- Does the selection look right?
- Can I exclude the few wrong items without restarting the whole request?
- Is this safe to apply?

The plan preview should feel like a native gallery review surface, not a JSON debugger or a full photo editor.

## Goals

- Make proposed changes visually understandable before apply.
- Preserve a fast path: users should usually approve the whole plan with one action.
- Support operation-level enable/disable and item-level refinement.
- Scale to hundreds or thousands of affected photos without rendering or selecting every item eagerly.
- Support current album operations and leave a clear path for spaces, asset removal, tagging, favorites, archive/trash, image rotation, and future edits.
- Keep apply behavior trustworthy by revalidating permissions, stale state, dependencies, and overrides server-side.

## Non-Goals

- Build a drag-and-drop visual canvas in the first implementation.
- Build a full manual photo editor.
- Prefetch or render every thumbnail for large plans.
- Trust client-provided selections or field overrides without server validation.
- Replace chat-based plan revision for complex intent changes.

## Recommended UX: Evidence Ledger

Use an Evidence Ledger layout: destination-focused cards with visual evidence, concise operation rows, expandable details, and a sticky apply summary.

This direction balances confidence and speed:

- Users see the destinations Pi will change, such as albums, spaces, or edit batches.
- Each destination shows representative thumbnails and compact impact counts.
- Each operation can be toggled on/off.
- Expanded operation details expose affected items, rationale, and technical details only when needed.
- Simple fields can be edited inline.
- Complex changes should go back through chat as a plan revision.

The UI should remain calm, dense enough for review, and photo-native. It should avoid making the plan preview feel like a modal spreadsheet or a separate editor application.

## Core Layout

### Plan Header

The header summarizes the whole plan:

- Plain-language title, for example `Create 3 trip albums`.
- One-line explanation of Pi's intent.
- Impact summary, for example `3 albums · 842 photos · 2 cover updates`.
- Risk summary, for example `No photos will be deleted`.
- Optional status chips for plan freshness, permission requirements, and warnings.

The header should not expose protocol details, operation IDs, DTO names, or runner internals.

### Destination Cards

Group operations by the destination or affected entity:

- Album destination: create/update album, add/remove photos, set cover.
- Space destination: create/update space, add/remove photos or members.
- Asset batch: rotate, tag, favorite, archive, or metadata edits across many photos.
- Library batch: broader operations that affect multiple destinations.

Each destination card should include:

- Destination name and type.
- Operation count and selected item count.
- Representative thumbnail strip.
- Warning or dependency summary when relevant.
- Collapsed operation rows by default.
- Expand affordance for item-level review.

Destination cards should be repeated items. Page sections should remain unframed, with a constrained content column and a sticky apply bar.

### Operation Rows

Each operation row should be phrased in human terms:

- `Create album "Berlin Weekend"`
- `Add 248 photos`
- `Set cover photo`
- `Rotate 12 photos clockwise`
- `Remove 8 screenshots`

Rows should show:

- Checkbox/toggle for included/excluded.
- Mixed state when only some affected items are selected.
- Count of selected and excluded items.
- Risk indicator only when it changes user decision-making.
- Dependency state when disabling one operation changes another.
- Status after apply: applied, skipped, failed, partially applied.

Technical details can be behind an expandable details control:

- Tool name.
- Operation ID.
- Raw parameters.
- Dependency IDs.
- Server validation errors.

### Representative Thumbnail Strip

Default collapsed cards must show only a bounded representative strip:

- Use 4-12 thumbnails depending on viewport.
- Choose representative items by relevance, chronology, diversity, or server-provided preview ordering.
- Show a final count tile like `+830`.
- Do not render every photo in the collapsed view.

If thumbnails fail or are not available, the card should still be understandable through counts, filenames, dates, and summary text.

### Expanded Item Review

Expanded details should support item-level refinement without overwhelming the user:

- Virtualized grid for large item sets.
- Lazy thumbnail loading with cancellation.
- Search/filter within affected items.
- Bulk actions: select all, deselect all, reset, exclude visible, include visible.
- Smart filters when metadata exists: screenshots, duplicates, date range, people, tags, location, file type, videos.
- Clear selected/excluded counts.

Item tiles should show:

- Thumbnail.
- Selection state.
- Small metadata only when useful: date, album/source, duplicate marker, warning marker.
- Fallback label if preview cannot load.

### Inline Edits

Allow direct inline edits for simple, high-confidence fields:

- Album name.
- Space name.
- Target album or space.
- Cover photo.
- Rotation direction or angle.
- Simple remove/add mode where the operation supports it.

Complex intent changes should remain chat-based:

- Splitting one proposed album into several albums.
- Asking Pi to choose a different theme.
- Re-ranking photos by quality.
- Replanning around people, places, events, or subjective criteria.

The UI should make this distinction explicit through affordances, not explanatory copy. Editable fields look editable; non-trivial revision actions go through the composer.

### Sticky Apply Bar

The sticky apply bar should summarize exactly what will happen:

- `Apply 7 changes to 842 selected photos`
- Warnings if some operations are disabled or partially selected.
- Primary action: apply selected changes.
- Secondary actions: ask Pi to revise, discard plan.

The apply action should be disabled when required dependencies or validations are unresolved.

## Large Plan Behavior

Plans with hundreds or thousands of photos must stay fast and understandable.

### Default View

The default view should render a small, bounded amount of UI:

- Destination summaries.
- Operation rows.
- Representative thumbnail strips.
- Counts and risk summaries.

It must not render all affected assets into the DOM.

### Expanded View

Expanded item review should use windowing/virtualization. Only visible items and a small overscan buffer should be mounted.

Thumbnail fetching should be:

- Lazy.
- Bounded by viewport and overscan.
- Cancelled when the user collapses the section, changes filters, or scrolls away.
- Resilient to individual thumbnail failures.

### Selection Model

Use sparse selection state, not eager lists of every affected item.

Recommended modes:

- `all`: every item in the operation remains selected.
- `allExcept`: every item is selected except listed item IDs.
- `only`: only listed item IDs are selected.
- `none`: operation is disabled or no items are selected.

The UI should automatically choose compact representations:

- Start large operations as `all`.
- Excluding a few items changes to `allExcept`.
- Manually selecting a small subset can use `only`.
- Reset returns to `all`.

The apply payload should preserve these sparse semantics so large plans do not require sending thousands of unchanged IDs.

### Bulk Refinement

Large plans need high-leverage refinement tools:

- Select/exclude visible filtered results.
- Exclude screenshots.
- Exclude duplicates.
- Exclude videos or include only videos.
- Filter by date range.
- Filter by source album.
- Filter by person/tag/location where available.

Bulk changes should update counts immediately and keep the operation in a clear mixed state.

## Data Contract Direction

The raw operation DTO should remain execution-oriented. The review UI should consume a display/review model derived from the plan.

Add review metadata to operations or expose it through a plan-review endpoint. The model should be stable enough for the UI to render current and future operations without hardcoding every detail into Svelte components.

Recommended fields:

```ts
type AgentOperationReview = {
  operationId: string;
  operationType: string;
  destination?: AgentReviewDestination;
  summary: string;
  detail?: string;
  riskLevel: 'low' | 'medium' | 'high';
  selection?: AgentReviewSelection;
  thumbnails?: AgentReviewThumbnailSummary;
  editableFields?: AgentReviewEditableField[];
  evidence?: AgentReviewEvidence[];
  dependencies?: AgentReviewDependency[];
};
```

Destinations should generalize beyond albums:

```ts
type AgentReviewDestination = {
  kind: 'album' | 'space' | 'assetBatch' | 'library' | 'imageEditBatch';
  id?: string;
  temporaryId?: string;
  name: string;
  subtitle?: string;
};
```

Selection should be item-kind aware:

```ts
type AgentReviewSelection = {
  itemKind: 'asset' | 'album' | 'space' | 'person' | 'tag';
  totalCount: number;
  selectedCount: number;
  mode: 'all' | 'allExcept' | 'only' | 'none';
  itemIds?: string[];
  supportsItemSelection: boolean;
};
```

Thumbnail summaries should stay bounded:

```ts
type AgentReviewThumbnailSummary = {
  totalCount: number;
  representativeAssetIds: string[];
  hasMore: boolean;
};
```

Apply requests should evolve from operation IDs only to sparse selections and simple field overrides:

```ts
type AgentOperationApplyRequest = {
  operationIds: string[];
  itemSelections?: Record<
    string,
    {
      itemKind: 'asset' | 'album' | 'space' | 'person' | 'tag';
      mode: 'all' | 'allExcept' | 'only' | 'none';
      itemIds?: string[];
    }
  >;
  fieldOverrides?: Record<string, Record<string, unknown>>;
  planRevision?: string;
};
```

Server apply must revalidate:

- Plan ownership.
- Plan status and revision.
- Operation dependencies.
- Selected operation IDs.
- Item IDs belong to the operation's affected set.
- Field override schema and permissions.
- Asset visibility and library permissions.
- Stale target state where relevant.

## Component Architecture

Keep `AgentOperationPlanReviewPanel` as the container, but split rendering into smaller components:

- `AgentPlanEvidenceLedger`: top-level layout and apply bar.
- `AgentPlanDestinationCard`: destination grouping, representative thumbnails, operation rows.
- `AgentPlanOperationRow`: operation summary, toggle, mixed state, status.
- `AgentPlanItemStrip`: bounded representative thumbnail strip.
- `AgentPlanItemGrid`: virtualized expanded item review.
- `AgentPlanInlineFieldEditor`: simple field overrides.
- `AgentPlanApplyBar`: selected impact summary and apply actions.
- `AgentPlanTechnicalDetails`: expandable low-priority diagnostics.

Expand `agent-operation-plan-ui.ts` into a view-model layer responsible for:

- Grouping operations into destinations.
- Building human-readable labels.
- Managing operation and item selection state.
- Computing mixed states and counts.
- Building sparse apply payloads.
- Handling dependency visibility and blocking states.

Svelte components should render the view model and dispatch user intent. They should not duplicate operation dependency rules or payload-building logic.

## Accessibility

- Operation checkboxes must support checked, unchecked, and mixed states.
- Expanded item grids must be keyboard navigable.
- Thumbnail tiles need useful accessible labels, such as filename/date or `Selected photo from May 2026`.
- Do not rely on color alone for risk, status, or selection.
- Bulk selection changes should update visible counts and be announced through accessible status text.
- The sticky apply action must remain reachable by keyboard and screen readers.

## Edge Cases

- Empty plan: show a clear empty state and keep apply disabled.
- No thumbnails: use counts, filenames, dates, and target names.
- Partial thumbnail failures: show per-item fallback, not a whole-plan failure.
- Huge operation: render bounded default content and virtualized expanded content.
- Duplicate assets across operations: make repeated use visible where it matters and validate independently per operation.
- Disabled dependency: dependent operations become disabled or blocked with concise explanation.
- Non-selectable operation: show it as an all-or-nothing operation.
- Non-editable field: render as text, not a disabled form field unless needed.
- Stale plan revision: require refresh or Pi replanning before apply.
- Apply partially fails: show applied/skipped/failed states by destination and operation.
- Mobile: use compact cards and open expanded item review in a full-height sheet.

## TDD And Test Coverage

Implementation should be test-driven. Each slice should start with failing tests that describe user-visible behavior and model rules.

For every implementation slice:

- Write the failing tests first.
- Confirm the tests fail for the intended reason before implementation.
- Implement the smallest behavior needed to make them pass.
- Keep regression tests focused on the slice's public contract, not incidental DOM or styling details.
- Treat the slice as incomplete until unit, component, API, and end-to-end coverage relevant to that slice is green.

### View Model Tests

Cover:

- Groups album operations into destination cards.
- Groups future space and asset-batch operations without UI changes.
- Builds human-readable operation summaries.
- Computes selected/excluded counts.
- Computes mixed state after item exclusions.
- Keeps disabled operations out of apply payloads.
- Blocks dependent operations when prerequisites are disabled.
- Preserves sparse `allExcept` and `only` selection payloads.
- Resets selection state correctly.

Edge cases:

- Empty operation list.
- Unknown operation type.
- Missing destination metadata.
- Operation with zero affected items.
- Operation with thousands of affected items.

### Component Tests

Cover:

- Plan header shows plain-language summary and impact counts.
- Destination cards render representative thumbnails and count overflow.
- Collapsed view does not render every affected item for large plans.
- Operation toggles update counts and apply button state.
- Mixed operation state is visible after item-level exclusion.
- Expanding an operation shows item review.
- Thumbnail failures render item fallbacks.
- Inline editable fields update preview summary and apply payload.
- Technical details are hidden by default and visible on expand.
- Apply bar reflects selected operations, selected items, warnings, and disabled state.

Edge cases:

- No representative thumbnails.
- One destination with many operations.
- Many destinations with small operations.
- Long album/space names.
- Narrow/mobile viewport behavior.

### Server/API Tests

Cover:

- Apply accepts legacy operation-only payloads during transition.
- Apply validates sparse item selections.
- Apply rejects item IDs outside the operation affected set.
- Apply rejects unsupported field overrides.
- Apply rejects stale plan revisions.
- Apply rejects dependency-invalid selections.
- Apply revalidates permissions and target ownership.
- Partial apply reports operation-level success/failure.

Edge cases:

- `allExcept` excludes all items.
- `only` contains duplicate IDs.
- Unknown item kind.
- Huge selection payload is bounded or rejected with a clear error.
- Operation changed between plan creation and apply.

### End-To-End Flow Tests

Cover:

- User receives a visual plan after asking Pi to organize photos.
- Plan preview shows destination cards, representative thumbnails, and a clear apply action.
- User disables an operation and the apply request excludes it.
- User expands an operation, excludes individual photos, and the apply request includes sparse item-selection overrides.
- User applies the selected plan and sees applied/skipped/failed operation status in chat.
- User asks Pi to revise the plan instead of applying it and the old plan is no longer applied accidentally.
- User opens technical details only on demand; operation IDs and raw payloads are hidden by default.
- Large plan with hundreds or thousands of photos remains usable without rendering every item.

Edge cases:

- Apply fails after some operations succeed.
- Plan becomes stale before apply.
- User lacks permission for one destination or asset.
- Network failure while loading thumbnails or applying the plan.
- User changes selection, collapses the card, reopens it, and selection state is preserved.

### Performance Tests

Cover:

- Rendering a plan with 1,000+ affected assets mounts only bounded collapsed content.
- Expanding a large operation mounts only the virtualized window and overscan.
- Selection count updates do not require iterating through every selected item on each render.
- Thumbnail loading is not started for every asset at once.

## Implementation Slices

### Slice 1: Review Model Contract

Add a test-driven view-model layer and review metadata contract for destination grouping, operation summaries, representative thumbnails, and operation-level selection. Preserve current apply behavior with operation IDs.

### Slice 2: Evidence Ledger Shell

Replace the current technical card stack with destination cards, operation rows, compact counts, and a sticky apply bar. Keep item-level selection out of scope for this slice.

### Slice 3: Representative Thumbnails

Render bounded representative thumbnail strips with overflow counts and failure fallbacks. Add tests that large plans do not render every affected photo.

### Slice 4: Item-Level Selection

Add sparse item selection state, expanded item review, mixed operation state, and apply payload extensions. Include server validation for sparse selections.

### Slice 5: Inline Field Overrides

Support inline edits for simple fields such as album name, target album/space, cover photo, and rotation direction. Include field override validation server-side.

### Slice 6: Large-Plan Refinement

Add virtualized expanded grids, lazy thumbnail loading, filters, and bulk selection actions for plans with hundreds or thousands of photos.

### Slice 7: Spaces And Image Edit Operations

Extend the review model and UI to cover spaces, add/remove flows, rotation, archive/favorite/tag operations, and asset-batch destinations.

### Slice 8: Polish And Hardening

Finish accessibility, mobile expanded review, partial apply states, technical details disclosure, and performance regression tests.

## Open Decisions For Slice Planning

- Whether review metadata is embedded directly in the existing plan DTO or fetched from a dedicated plan-review endpoint.
- Which virtualized grid helper to use in Svelte, or whether to implement a small local virtualization utility.
- Whether field overrides should mutate the plan draft server-side before apply or remain client-side overrides submitted only at apply time.
- How much preview evidence Pi should generate versus how much the server should derive deterministically from operation payloads.

The recommended default is to keep review metadata deterministic and server-derived where possible, while allowing Pi to provide optional rationale/evidence text that is rendered as secondary detail.
