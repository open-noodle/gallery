# Assistant Photo-first Plan Review UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rework the Assistant plan review UI so photo plans are thumbnail-first, rounded, collapsible in chat, and backed by a modal photo selection review while preserving existing plan execution behavior.

**Architecture:** Keep the existing operation plan DTOs and selection state. Add focused Svelte UI components around the current `OperationReviewModel`: a photo stage, a photo review modal, and rounded plan/timeline shells. The plan review panel owns plan collapse state; the evidence ledger owns the active photo-review modal state; operation rows expose photo review and technical details as separate controls.

**Tech Stack:** Svelte 5 runes, Tailwind utility classes, `@testing-library/svelte`, Vitest, existing `@immich/sdk` DTOs, existing `svelte-i18n` strings.

---

## File Structure

- Create `web/src/routes/(user)/assistant/agent-plan-photo-stage.svelte`
  - Renders the prominent thumbnail mosaic/strip, selected count, match context, and `Review photos` action for one destination group.
- Create `web/src/routes/(user)/assistant/agent-plan-photo-review-modal.svelte`
  - Renders the modal dialog and reuses `AgentPlanItemReview` for the virtualized thumbnail grid.
- Create `web/src/routes/(user)/assistant/agent-plan-photo-review-modal.spec.ts`
  - Covers dialog accessibility, close behavior, callbacks, and the embedded selection grid.
- Modify `web/src/routes/(user)/assistant/agent-operation-plan-review-panel.svelte`
  - Replaces the utilitarian details card with a rounded plan sheet and explicit collapse/expand controls.
- Modify `web/src/routes/(user)/assistant/agent-plan-evidence-ledger.svelte`
  - Adds modal state and passes `onOpenItemReview` down to destination cards and operation rows.
- Modify `web/src/routes/(user)/assistant/agent-plan-destination-card.svelte`
  - Uses the photo stage above the operation list and passes the modal opener to operation rows.
- Modify `web/src/routes/(user)/assistant/agent-plan-thumbnail-strip.svelte`
  - Adds a `variant` prop for `strip`, `mosaic`, and `compact` thumbnail presentations.
- Modify `web/src/routes/(user)/assistant/agent-plan-operation-row.svelte`
  - Splits `Change selection` from `Technical details`; removes inline photo grid expansion from the technical-details button.
- Modify `web/src/routes/(user)/assistant/agent-plan-item-review.svelte`
  - Adds a `variant` prop so the same grid can render inside the modal with larger dimensions.
- Modify `web/src/routes/(user)/assistant/agent-plan-technical-details.svelte`
  - Keeps the disclosure optional and updates styling to rounded pills/panels.
- Modify `web/src/routes/(user)/assistant/agent-plan-apply-bar.svelte`
  - Replaces the full-width block footer with a rounded apply dock.
- Modify `web/src/routes/(user)/assistant/agent-session-chat-panel.svelte`
  - Allows plan/activity items to use a wider transcript lane while preserving narrow text messages.
- Modify `web/src/routes/(user)/assistant/agent-session-header.svelte`
  - Updates header action buttons to rounded pill styling.
- Modify `web/src/routes/(user)/assistant/agent-activity-visibility-menu.svelte`
  - Matches the header button shape.
- Modify `web/src/routes/(user)/assistant/agent-activity-block.svelte`
  - Converts activity rows into a rounded timeline rail.
- Modify `i18n/en.json`
  - Adds English labels for photo review, collapse/expand, and modal actions.
- Modify existing component specs in `web/src/routes/(user)/assistant/*.spec.ts`
  - Updates expectations for new controls and adds regression coverage.

---

## Task 1: Rounded Plan Sheet And Collapsed Chat Summary

**Files:**

- Modify: `web/src/routes/(user)/assistant/agent-operation-plan-review-panel.svelte`
- Modify: `web/src/routes/(user)/assistant/agent-operation-plan-review-panel.spec.ts`
- Modify: `i18n/en.json`

- [ ] **Step 1: Write the failing tests for explicit collapse/expand controls**

In `web/src/routes/(user)/assistant/agent-operation-plan-review-panel.spec.ts`, update the collapse test so it clicks explicit buttons instead of the summary text and checks the compact thumbnail/count/safety summary:

```ts
it('collapses the plan sheet to a compact thumbnail summary without losing selected operations', async () => {
  sdkMock.getCurrentOperationPlan.mockResolvedValue(samplePlan());

  render(AgentOperationPlanReviewPanel, { props: { session, variant: 'dock' } });

  await fireEvent.click(await screen.findByRole('checkbox', { name: 'Update album details' }));
  expect(screen.getByRole('button', { name: 'Apply 2 selected' })).toBeInTheDocument();

  await fireEvent.click(screen.getByRole('button', { name: 'Collapse plan' }));

  expect(screen.queryByRole('checkbox', { name: 'Update album details' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Apply 2 selected' })).not.toBeInTheDocument();
  expect(screen.getByText('Plan collapsed')).toBeInTheDocument();
  expect(screen.getByText('2 selected changes')).toBeInTheDocument();
  expect(screen.getByText('2 selected assets')).toBeInTheDocument();
  expect(screen.getByText('No photos will be deleted')).toBeInTheDocument();
  const collapsedSummary = screen.getByTestId('agent-operation-plan-collapsed-summary');
  expect(collapsedSummary).toBeInTheDocument();
  expect(within(collapsedSummary).getByTestId('agent-plan-thumbnail-strip')).toBeInTheDocument();

  await fireEvent.click(screen.getByRole('button', { name: 'Expand plan' }));

  expect(screen.getByRole('checkbox', { name: 'Update album details' })).not.toBeChecked();
  expect(screen.getByRole('button', { name: 'Apply 2 selected' })).toBeInTheDocument();
});
```

Add these strings to the local mocked messages in the same spec:

```ts
assistant_operation_plan_collapse: 'Collapse plan',
assistant_operation_plan_collapsed: 'Plan collapsed',
assistant_operation_plan_expand: 'Expand plan',
```

- [ ] **Step 2: Run the focused failing test**

Run:

```bash
pnpm --dir web exec vitest run 'src/routes/(user)/assistant/agent-operation-plan-review-panel.spec.ts' -t 'collapses the plan sheet'
```

Expected: FAIL because `Collapse plan`, `Expand plan`, and `agent-operation-plan-collapsed-summary` do not exist yet.

- [ ] **Step 3: Implement the rounded plan shell and compact collapsed state**

In `web/src/routes/(user)/assistant/agent-operation-plan-review-panel.svelte`, import the compact thumbnail strip:

```ts
import AgentPlanThumbnailStrip from './agent-plan-thumbnail-strip.svelte';
```

Add a derived group for the compact collapsed summary:

```ts
const collapsedThumbnailGroup = $derived(model?.groups.find((group) => group.assetCount > 0) ?? null);
```

In `web/src/routes/(user)/assistant/agent-operation-plan-review-panel.svelte`, replace the `cardClass` definition with rounded sheet classes and remove the old `headerClass` derived value because the plan sheet no longer uses a native `<summary>`:

```ts
const rootClass = $derived(
  variant === 'dock'
    ? 'flex w-full flex-col gap-3 text-black dark:text-white'
    : 'mx-auto flex w-full max-w-5xl flex-col gap-4 px-4 pb-10 text-black dark:text-white md:px-8',
);

const cardClass = $derived(
  [
    'overflow-hidden rounded-3xl border border-gray-200 bg-white shadow-xl shadow-black/5',
    'dark:border-neutral-800 dark:bg-neutral-950 dark:shadow-black/40',
    variant === 'dock' ? '' : 'p-0',
  ]
    .filter(Boolean)
    .join(' '),
);
```

Replace the current `<details>` block in the final `{:else}` branch with this explicit article structure:

```svelte
<div class={rootClass} role="region" aria-labelledby="assistant-operation-plan-title">
  <article class={cardClass} data-testid="agent-operation-plan-sheet">
    <header class="flex flex-col gap-4 border-b border-gray-200 p-4 dark:border-neutral-800 sm:p-5">
      <div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div class="min-w-0">
          <p class="text-xs font-semibold uppercase tracking-wide text-immich-primary dark:text-immich-dark-primary">
            {$t('assistant_operation_plan_review')}
          </p>
          <h2 id="assistant-operation-plan-title" class="mt-1 break-words text-2xl font-semibold leading-tight">
            {model.plan.summary}
          </h2>
          <div class="mt-3 flex flex-wrap gap-2 text-sm text-gray-600 dark:text-gray-300">
            <span class="rounded-full bg-gray-100 px-3 py-1 dark:bg-neutral-900">
              {$t('assistant_operation_plan_destination_count', { values: { count: impact.destinationCount } })}
            </span>
            <span class="rounded-full bg-gray-100 px-3 py-1 dark:bg-neutral-900">
              {$t('assistant_operation_plan_selected_change_count', {
                values: { count: impact.selectedOperationCount },
              })}
            </span>
            <span class="rounded-full bg-gray-100 px-3 py-1 dark:bg-neutral-900">
              {$t('assistant_operation_plan_selected_asset_count', { values: { count: impact.selectedAssetCount } })}
            </span>
          </div>
        </div>

        <div class="flex shrink-0 flex-col items-start gap-3 sm:items-end">
          <div class="rounded-2xl border border-green-200 bg-green-50 px-4 py-3 text-sm font-medium text-green-800 dark:border-green-900/70 dark:bg-green-950/30 dark:text-green-200">
            <div>{$t('assistant_operation_plan_no_destructive_changes')}</div>
            <div>{$t('assistant_operation_selected_count', { values: { count: selectedOperationIds.length } })}</div>
          </div>
          <button
            type="button"
            class="rounded-full border border-gray-300 px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-immich-primary dark:border-neutral-700 dark:text-neutral-100 dark:hover:bg-neutral-900"
            aria-expanded={planExpanded}
            onclick={() => (planExpanded = !planExpanded)}
          >
            {$t(planExpanded ? 'assistant_operation_plan_collapse' : 'assistant_operation_plan_expand')}
          </button>
        </div>
      </div>
    </header>

    {#if planExpanded}
      <div class={variant === 'dock' ? 'px-4 pb-4 pt-4' : 'p-4 sm:p-5'}>
        <AgentPlanEvidenceLedger
          {model}
          {selectedOperationIds}
          {canChangeSelection}
          {canApply}
          {applying}
          {errorMessage}
          {applyErrorMessage}
          {applyMessage}
          showHeader={false}
          onToggleGroup={toggleGroup}
          onToggleOperation={toggleOperation}
          onToggleItem={toggleItem}
          onBulkSetItems={bulkSetItems}
          onSetOnlyItems={setOnlyItems}
          onResetItemSelection={resetItemSelection}
          onSetFieldOverride={setFieldOverride}
          onResetFieldOverride={resetFieldOverride}
          onApply={applySelectedOperations}
        />
      </div>
    {:else}
      <div
        class="m-4 grid gap-3 rounded-2xl border border-gray-200 bg-gray-50 p-4 text-sm dark:border-neutral-800 dark:bg-neutral-900/60 sm:grid-cols-[auto_1fr_auto] sm:items-center"
        data-testid="agent-operation-plan-collapsed-summary"
      >
        {#if collapsedThumbnailGroup}
          <div class="min-w-0">
            <AgentPlanThumbnailStrip group={collapsedThumbnailGroup} maxVisible={3} />
          </div>
        {/if}
        <div class="min-w-0">
          <p class="font-semibold text-gray-900 dark:text-neutral-50">
            {$t('assistant_operation_plan_collapsed')}
          </p>
          <div class="mt-2 flex flex-wrap gap-2 text-gray-600 dark:text-gray-300">
            <span class="rounded-full bg-white px-3 py-1 dark:bg-neutral-950">
              {$t('assistant_operation_plan_selected_change_count', {
                values: { count: impact.selectedOperationCount },
              })}
            </span>
            <span class="rounded-full bg-white px-3 py-1 dark:bg-neutral-950">
              {$t('assistant_operation_plan_selected_asset_count', {
                values: { count: impact.selectedAssetCount },
              })}
            </span>
            <span class="rounded-full bg-white px-3 py-1 dark:bg-neutral-950">
              {$t('assistant_operation_plan_no_destructive_changes')}
            </span>
          </div>
        </div>
        <button
          type="button"
          class="rounded-full bg-immich-primary px-4 py-2 text-sm font-semibold text-white hover:bg-immich-primary/90 focus:outline-none focus:ring-2 focus:ring-immich-primary"
          aria-expanded={planExpanded}
          onclick={() => (planExpanded = true)}
        >
          {$t('assistant_operation_plan_expand')}
        </button>
      </div>
    {/if}
  </article>
</div>
```

Add English strings to `i18n/en.json`:

```json
"assistant_operation_plan_collapse": "Collapse plan",
"assistant_operation_plan_collapsed": "Plan collapsed",
"assistant_operation_plan_expand": "Expand plan"
```

- [ ] **Step 4: Run the focused tests**

Run:

```bash
pnpm --dir web exec vitest run 'src/routes/(user)/assistant/agent-operation-plan-review-panel.spec.ts'
```

Expected: PASS for `agent-operation-plan-review-panel.spec.ts`.

- [ ] **Step 5: Commit Task 1**

```bash
git add web/src/routes/\(user\)/assistant/agent-operation-plan-review-panel.svelte web/src/routes/\(user\)/assistant/agent-operation-plan-review-panel.spec.ts i18n/en.json
git commit -m "feat: add rounded assistant plan shell"
```

---

## Task 2: Photo-first Destination Stage

**Files:**

- Create: `web/src/routes/(user)/assistant/agent-plan-photo-stage.svelte`
- Modify: `web/src/routes/(user)/assistant/agent-plan-destination-card.svelte`
- Modify: `web/src/routes/(user)/assistant/agent-plan-thumbnail-strip.svelte`
- Modify: `web/src/routes/(user)/assistant/agent-plan-destination-card.spec.ts`
- Modify: `web/src/routes/(user)/assistant/agent-plan-thumbnail-strip.spec.ts`
- Modify: `i18n/en.json`

- [ ] **Step 1: Write failing destination-card tests for the photo stage**

In `agent-plan-destination-card.spec.ts`, add these mocked strings:

```ts
assistant_operation_photo_stage_title: 'Photos in this plan',
assistant_operation_photo_stage_review: 'Review photos',
assistant_operation_photo_stage_summary: '{count} selected trip photos',
```

Add this test:

```ts
it('puts photo evidence before change rows for photo-affecting plans', async () => {
  const onOpenItemReview = vi.fn();
  render(AgentPlanDestinationCard, {
    props: {
      group: group(),
      canChangeSelection: true,
      onToggleGroup: vi.fn(),
      onToggleOperation: vi.fn(),
      onToggleItem: vi.fn(),
      onBulkSetItems: vi.fn(),
      onSetOnlyItems: vi.fn(),
      onResetItemSelection: vi.fn(),
      onSetFieldOverride: vi.fn(),
      onResetFieldOverride: vi.fn(),
      onOpenItemReview,
    },
  });

  const stage = screen.getByTestId('agent-plan-photo-stage');
  const addRow = screen.getByText('Add 2 photos');
  expect(stage).toHaveTextContent('Photos in this plan');
  expect(stage).toHaveTextContent('2 selected trip photos');
  expect(stage.compareDocumentPosition(addRow) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

  await fireEvent.click(within(stage).getByRole('button', { name: 'Review photos' }));

  expect(onOpenItemReview).toHaveBeenCalledWith(addId);
});
```

- [ ] **Step 2: Write failing thumbnail variant tests**

In `agent-plan-thumbnail-strip.spec.ts`, add:

```ts
it('renders a mosaic variant with a larger first thumbnail and bounded overflow', () => {
  render(AgentPlanThumbnailStrip, {
    props: {
      group: group(20),
      variant: 'mosaic',
      maxVisible: 7,
    },
  });

  const strip = screen.getByTestId('agent-plan-thumbnail-strip');
  const tiles = within(strip).getAllByTestId('agent-plan-thumbnail-tile');
  expect(tiles).toHaveLength(7);
  expect(tiles[0]).toHaveClass('sm:col-span-2', 'sm:row-span-2');
  expect(within(strip).getByText('+13')).toBeInTheDocument();
});
```

- [ ] **Step 3: Run the focused failing tests**

Run:

```bash
pnpm --dir web exec vitest run 'src/routes/(user)/assistant/agent-plan-destination-card.spec.ts' 'src/routes/(user)/assistant/agent-plan-thumbnail-strip.spec.ts'
```

Expected: FAIL because `AgentPlanPhotoStage`, `variant="mosaic"`, and `onOpenItemReview` do not exist.

- [ ] **Step 4: Add the photo stage component**

Create `web/src/routes/(user)/assistant/agent-plan-photo-stage.svelte`:

```svelte
<script lang="ts">
  import { t } from 'svelte-i18n';
  import type { OperationReviewGroup, OperationReviewItem } from './agent-operation-plan-ui';
  import AgentPlanThumbnailStrip from './agent-plan-thumbnail-strip.svelte';

  interface Props {
    group: OperationReviewGroup;
    primaryItem?: OperationReviewItem;
    canChangeSelection: boolean;
    onOpenItemReview: (operationId: string) => void;
  }

  let { group, primaryItem, canChangeSelection, onOpenItemReview }: Props = $props();

  const selectedAssetCount = $derived(
    new Set(
      group.operations
        .filter((operation) => operation.enabled && !operation.blocked)
        .flatMap((operation) => operation.selectedAssetIds),
    ).size,
  );
  const canReviewPhotos = $derived(Boolean(primaryItem?.review.selection.supportsItemSelection));
</script>

{#if group.assetCount > 0}
  <section
    class="mt-4 grid gap-4 rounded-3xl border border-gray-200 bg-gray-50 p-3 dark:border-neutral-800 dark:bg-neutral-950/70 lg:grid-cols-[minmax(0,1fr)_16rem]"
    data-testid="agent-plan-photo-stage"
    aria-label={$t('assistant_operation_photo_stage_title')}
  >
    <AgentPlanThumbnailStrip {group} variant="mosaic" maxVisible={7} />

    <aside class="flex min-w-0 flex-col justify-between gap-4 rounded-2xl border border-gray-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
      <div>
        <p class="text-xs font-semibold uppercase tracking-wide text-immich-primary dark:text-immich-dark-primary">
          {$t('assistant_operation_photo_stage_title')}
        </p>
        <p class="mt-2 text-3xl font-semibold leading-none text-gray-950 dark:text-neutral-50">
          {selectedAssetCount}
        </p>
        <p class="mt-2 text-sm text-gray-600 dark:text-gray-300">
          {$t('assistant_operation_photo_stage_summary', { values: { count: selectedAssetCount } })}
        </p>
      </div>

      {#if canReviewPhotos && primaryItem}
        <button
          type="button"
          class="rounded-full bg-immich-primary px-4 py-2 text-sm font-semibold text-white hover:bg-immich-primary/90 focus:outline-none focus:ring-2 focus:ring-immich-primary disabled:cursor-not-allowed disabled:opacity-60"
          disabled={!canChangeSelection}
          onclick={() => onOpenItemReview(primaryItem.id)}
        >
          {$t('assistant_operation_photo_stage_review')}
        </button>
      {/if}
    </aside>
  </section>
{/if}
```

- [ ] **Step 5: Add thumbnail variants**

In `agent-plan-thumbnail-strip.svelte`, change props and wrapper classes:

```ts
interface Props {
  group: OperationReviewGroup;
  maxVisible?: number;
  variant?: 'strip' | 'mosaic' | 'compact';
}

let { group, maxVisible, variant = 'strip' }: Props = $props();

const wrapperClass = $derived.by(() => {
  if (variant === 'mosaic') {
    return 'grid grid-cols-3 gap-2 sm:grid-cols-4';
  }

  if (variant === 'compact') {
    return 'flex flex-wrap gap-1';
  }

  return 'flex flex-wrap gap-1.5';
});

const tileClass = (index: number) =>
  [
    'relative overflow-hidden border border-gray-200 bg-gray-100 dark:border-gray-700 dark:bg-gray-800',
    variant === 'mosaic'
      ? 'aspect-square rounded-2xl'
      : variant === 'compact'
        ? 'size-10 rounded-xl'
        : 'size-14 rounded-md',
    variant === 'mosaic' && index === 0 ? 'sm:col-span-2 sm:row-span-2' : '',
  ]
    .filter(Boolean)
    .join(' ');
```

Use those classes in the markup:

```svelte
<div class={wrapperClass}>
  {#each strip.assetIds as assetId, index (assetId)}
    <figure class={tileClass(index)} data-testid="agent-plan-thumbnail-tile">
      ...
    </figure>
  {/each}
</div>
```

For the overflow tile, use:

```svelte
class={[
  'flex items-center justify-center border border-gray-200 bg-gray-100 font-semibold text-gray-600 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300',
  variant === 'mosaic' ? 'aspect-square rounded-2xl text-base' : variant === 'compact' ? 'size-10 rounded-xl text-xs' : 'size-14 rounded-md text-sm',
].join(' ')}
```

- [ ] **Step 6: Wire the photo stage into destination cards**

In `agent-plan-destination-card.svelte`, import the component:

```ts
import AgentPlanPhotoStage from './agent-plan-photo-stage.svelte';
```

Remove the old `AgentPlanThumbnailStrip` import from this file; the strip is now owned by `AgentPlanPhotoStage`.

Add the optional prop:

```ts
onOpenItemReview?: (operationId: string) => void;
```

Add it to `$props()` with a no-op default:

```ts
onOpenItemReview = () => {},
```

Add a derived primary review item:

```ts
const primaryPhotoReviewItem = $derived(
  group.operations.find((operation) => operation.review.selection.supportsItemSelection && operation.assetCount > 0),
);
```

Replace the existing direct strip render:

```svelte
<AgentPlanPhotoStage
  {group}
  primaryItem={primaryPhotoReviewItem}
  {canChangeSelection}
  {onOpenItemReview}
/>
```

- [ ] **Step 7: Add English strings**

In `i18n/en.json`, add:

```json
"assistant_operation_photo_stage_review": "Review photos",
"assistant_operation_photo_stage_summary": "{count, plural, one {# selected photo} other {{count, number} selected photos}}",
"assistant_operation_photo_stage_title": "Photos in this plan"
```

- [ ] **Step 8: Run focused tests**

Run:

```bash
pnpm --dir web exec vitest run 'src/routes/(user)/assistant/agent-plan-destination-card.spec.ts' 'src/routes/(user)/assistant/agent-plan-thumbnail-strip.spec.ts'
```

Expected: PASS.

- [ ] **Step 9: Commit Task 2**

```bash
git add web/src/routes/\(user\)/assistant/agent-plan-photo-stage.svelte web/src/routes/\(user\)/assistant/agent-plan-destination-card.svelte web/src/routes/\(user\)/assistant/agent-plan-thumbnail-strip.svelte web/src/routes/\(user\)/assistant/agent-plan-destination-card.spec.ts web/src/routes/\(user\)/assistant/agent-plan-thumbnail-strip.spec.ts i18n/en.json
git commit -m "feat: add photo-first plan stage"
```

---

## Task 3: Modal Photo Review

**Files:**

- Create: `web/src/routes/(user)/assistant/agent-plan-photo-review-modal.svelte`
- Create: `web/src/routes/(user)/assistant/agent-plan-photo-review-modal.spec.ts`
- Modify: `web/src/routes/(user)/assistant/agent-operation-plan-review-panel.spec.ts`
- Modify: `web/src/routes/(user)/assistant/agent-plan-evidence-ledger.svelte`
- Modify: `web/src/routes/(user)/assistant/agent-plan-evidence-ledger.spec.ts`
- Modify: `web/src/routes/(user)/assistant/agent-plan-item-review.svelte`
- Modify: `web/src/routes/(user)/assistant/agent-plan-item-review.spec.ts`
- Modify: `i18n/en.json`

- [ ] **Step 1: Write failing modal component tests**

Create `agent-plan-photo-review-modal.spec.ts`:

```ts
import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { readable } from 'svelte/store';
import type { OperationReviewItem } from './agent-operation-plan-ui';
import AgentPlanPhotoReviewModal from './agent-plan-photo-review-modal.svelte';

vi.mock('$lib/utils', () => ({
  getAssetMediaUrl: ({ id, size }: { id: string; size: string }) => `/api/assets/${id}/thumbnail?size=${size}`,
}));

vi.mock('svelte-i18n', () => {
  const messages: Record<string, string> = {
    assistant_operation_photo_review_close: 'Close',
    assistant_operation_photo_review_done: 'Done reviewing',
    assistant_operation_photo_review_keep_original: 'Keep original selection',
    assistant_operation_photo_review_selection: 'Selection',
    assistant_operation_photo_review_title: 'Review photos for {summary}',
    assistant_operation_photo_stage_title: 'Photos in this plan',
    assistant_operation_item_review_label: 'Review photos for {summary}',
    assistant_operation_item_selected_count: '{selected} of {total} selected',
    assistant_operation_item_excluded_count: '{count} excluded',
    assistant_operation_item_reset: 'Reset selection',
    assistant_operation_item_filter_label: 'Filter photos',
    assistant_operation_item_filter_placeholder: 'Filter photos',
    assistant_operation_item_empty_filter: 'No matching photos',
    assistant_operation_item_toolbar_label: 'Photo review controls',
    assistant_operation_item_media_all: 'All',
    assistant_operation_item_media_photos: 'Photos',
    assistant_operation_item_media_videos: 'Videos',
    assistant_operation_item_thumbnail_alt: 'Photo {index} of {count}',
    assistant_operation_item_thumbnail_unavailable: 'Preview unavailable',
    assistant_operation_item_toggle: 'Include photo {index}',
    assistant_operation_item_virtual_summary: 'Showing {visible} of {total} photos',
    assistant_operation_item_exclude_visible: 'Exclude visible',
    assistant_operation_item_include_visible: 'Include visible',
    assistant_operation_item_select_all_filtered: 'Select all filtered',
    assistant_operation_item_deselect_all_filtered: 'Deselect all filtered',
  };

  return {
    t: readable((key: string, options?: { values?: Record<string, string | number> }) =>
      (messages[key] ?? key)
        .replace('{summary}', String(options?.values?.summary ?? ''))
        .replace('{selected}', String(options?.values?.selected ?? ''))
        .replace('{total}', String(options?.values?.total ?? ''))
        .replace('{count}', String(options?.values?.count ?? ''))
        .replace('{index}', String(options?.values?.index ?? ''))
        .replace('{visible}', String(options?.values?.visible ?? '')),
    ),
  };
});

const item: OperationReviewItem = {
  id: 'operation-1',
  enabled: true,
  operation: { assetIds: ['asset-1', 'asset-2'] },
  review: {
    summary: 'Add 2 photos',
    selection: {
      itemKind: 'asset',
      totalCount: 2,
      selectedCount: 2,
      mode: 'all',
      supportsItemSelection: true,
    },
  },
  excludedAssetCount: 0,
} as OperationReviewItem;

describe('AgentPlanPhotoReviewModal', () => {
  it('renders a named dialog with the reusable photo grid and close actions', async () => {
    const onClose = vi.fn();
    render(AgentPlanPhotoReviewModal, {
      props: {
        item,
        canChangeSelection: true,
        onClose,
        onToggleItem: vi.fn(),
        onBulkSetItems: vi.fn(),
        onSetOnlyItems: vi.fn(),
        onResetSelection: vi.fn(),
      },
    });

    const dialog = screen.getByRole('dialog', { name: 'Review photos for Add 2 photos' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(within(dialog).getByRole('group', { name: 'Review photos for Add 2 photos' })).toBeInTheDocument();
    expect(within(dialog).getByText('Selection')).toBeInTheDocument();
    expect(within(dialog).getByText('2 of 2 selected')).toBeInTheDocument();

    await fireEvent.click(within(dialog).getByRole('button', { name: 'Done reviewing' }));

    expect(onClose).toHaveBeenCalledOnce();
  });

  it('closes on Escape and restores focus when the modal unmounts', async () => {
    const trigger = document.createElement('button');
    trigger.textContent = 'Open review';
    document.body.append(trigger);
    trigger.focus();
    const onClose = vi.fn();

    const view = render(AgentPlanPhotoReviewModal, {
      props: {
        item,
        canChangeSelection: true,
        onClose,
        onToggleItem: vi.fn(),
        onBulkSetItems: vi.fn(),
        onSetOnlyItems: vi.fn(),
        onResetSelection: vi.fn(),
      },
    });

    expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus();

    await fireEvent.keyDown(window, { key: 'Escape' });

    expect(onClose).toHaveBeenCalledOnce();

    view.unmount();
    expect(trigger).toHaveFocus();
    trigger.remove();
  });
});
```

- [ ] **Step 2: Write failing ledger and panel integration tests**

In `agent-plan-evidence-ledger.spec.ts`, add mocked modal strings and this test:

```ts
it('opens the photo review modal from the destination photo stage', async () => {
  render(AgentPlanEvidenceLedger, {
    props: {
      model: model(),
      selectedOperationIds: [createId, addId, updateId],
      canChangeSelection: true,
      canApply: true,
      applying: false,
      errorMessage: null,
      applyErrorMessage: null,
      applyMessage: null,
      onToggleGroup: vi.fn(),
      onToggleOperation: vi.fn(),
      onToggleItem: vi.fn(),
      onBulkSetItems: vi.fn(),
      onSetOnlyItems: vi.fn(),
      onResetItemSelection: vi.fn(),
      onApply: vi.fn(),
    },
  });

  await fireEvent.click(screen.getByRole('button', { name: 'Review photos' }));

  expect(screen.getByRole('dialog', { name: 'Review photos for Add 2 photos' })).toBeInTheDocument();
  expect(screen.getByTestId('agent-plan-item-review-grid')).toBeInTheDocument();

  await fireEvent.click(screen.getByRole('button', { name: 'Done reviewing' }));

  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});
```

In `agent-operation-plan-review-panel.spec.ts`, update the existing sparse item-selection tests that open row details for the photo grid. Those tests should open the modal through `Review photos` or `Change selection` instead of clicking `Details`. Keep at least this end-to-end assertion so the modal is proven to update parent selection state and the apply payload:

Add these mocked strings to the panel spec before adding the test:

```ts
assistant_operation_item_change_selection: 'Change selection',
assistant_operation_photo_review_close: 'Close',
assistant_operation_photo_review_done: 'Done reviewing',
assistant_operation_photo_review_keep_original: 'Keep original selection',
assistant_operation_photo_review_selection: 'Selection',
assistant_operation_photo_review_title: 'Review photos for {summary}',
assistant_operation_photo_stage_review: 'Review photos',
assistant_operation_photo_stage_summary: '{count} selected photos',
assistant_operation_photo_stage_title: 'Photos in this plan',
```

```ts
it('publishes and applies sparse item selections from the photo review modal', async () => {
  sdkMock.getCurrentOperationPlan.mockResolvedValue(samplePlan());
  sdkMock.applyApprovedOperations.mockResolvedValue({
    status: AgentOperationApplyStatus.Applied,
    plan: appliedPlan(),
    appliedOperationIds: [createId, addId, existingId],
    skippedOperationIds: [],
    failedOperationIds: [],
    summary: 'Applied 3 operation(s), skipped 0, failed 0.',
  });
  const onSelectionChange = vi.fn();

  render(AgentOperationPlanReviewPanel, { props: { session, onSelectionChange } });

  await fireEvent.click(await screen.findByRole('button', { name: 'Review photos' }));
  await fireEvent.click(screen.getByRole('checkbox', { name: 'Include photo 2' }));
  await fireEvent.click(screen.getByRole('button', { name: 'Done reviewing' }));

  expect(onSelectionChange).toHaveBeenLastCalledWith({
    planId,
    planRevision: 1,
    operationIds: [createId, addId, existingId],
    itemSelections: {
      [addId]: { itemKind: 'asset', mode: 'allExcept', itemIds: [assetB] },
    },
  });
  expect(screen.getAllByText('1 of 2 photos selected')).toHaveLength(2);
  expect(screen.getByText('3 changes · 1 assets selected')).toBeInTheDocument();

  await fireEvent.click(screen.getByRole('button', { name: 'Apply 3 selected' }));

  expect(sdkMock.applyApprovedOperations).toHaveBeenCalledWith({
    id: session.id,
    planId,
    agentOperationPlanApplyRequestDto: {
      operationIds: [createId, addId, existingId],
      itemSelections: {
        [addId]: { itemKind: 'asset', mode: 'allExcept', itemIds: [assetB] },
      },
      planRevision: 1,
    },
  });
});
```

- [ ] **Step 3: Run failing tests**

Run:

```bash
pnpm --dir web exec vitest run 'src/routes/(user)/assistant/agent-plan-photo-review-modal.spec.ts' 'src/routes/(user)/assistant/agent-plan-evidence-ledger.spec.ts' 'src/routes/(user)/assistant/agent-operation-plan-review-panel.spec.ts'
```

Expected: FAIL because the modal component, ledger state, and panel modal-selection path are missing.

- [ ] **Step 4: Add modal variant to item review**

In `agent-plan-item-review.svelte`, add a `variant` prop:

```ts
variant?: 'inline' | 'modal';
```

Add it to `$props()`:

```ts
variant = 'inline',
```

Add derived classes:

```ts
const sectionClass = $derived(
  variant === 'modal'
    ? 'rounded-2xl border border-gray-200 bg-white p-3 dark:border-neutral-800 dark:bg-neutral-950'
    : 'mt-3 rounded-md border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-900/40',
);

const gridClass = $derived(
  variant === 'modal'
    ? 'mt-2 max-h-[min(62vh,34rem)] overflow-y-auto rounded-2xl border border-gray-200 bg-gray-100 dark:border-neutral-800 dark:bg-neutral-900'
    : 'mt-2 max-h-[min(65vh,28rem)] overflow-y-auto rounded-md border border-gray-200 bg-gray-100 dark:border-gray-700 dark:bg-gray-800',
);

const tileClass = (selected: boolean) =>
  [
    'group relative aspect-square overflow-hidden border bg-gray-100 dark:bg-gray-800',
    variant === 'modal' ? 'rounded-2xl' : 'rounded-md',
    selected
      ? 'border-immich-primary ring-2 ring-immich-primary/20 dark:border-immich-dark-primary dark:ring-immich-dark-primary/20'
      : 'border-gray-200 opacity-55 dark:border-gray-700',
  ].join(' ');
```

Use them in the section and grid:

```svelte
<section class={sectionClass} ...>
...
<div bind:this={gridElement} use:measureGrid class={gridClass} ...>
```

Inside the tile loop, replace the static label class with `class={tileClass(selected)}` and add a selected-state mark that is visible in the modal:

```svelte
<label class={tileClass(selected)} data-testid="agent-plan-item-thumbnail" data-selected={selected}>
  ...
  {#if variant === 'modal'}
    <span
      class="absolute right-2 top-2 flex size-6 items-center justify-center rounded-full bg-black/60 text-xs font-bold text-white backdrop-blur"
      class:bg-immich-primary={selected}
      class:text-white={selected}
      aria-hidden="true"
    >
      {selected ? '✓' : '-'}
    </span>
  {/if}
  <input ... />
</label>
```

In `agent-plan-item-review.spec.ts`, add this regression test:

```ts
it('shows clear selected and excluded tile states in modal review mode', () => {
  const baseItem = item(['asset-1', 'asset-2']);

  render(AgentPlanItemReview, {
    props: defaultProps({
      item: {
        ...baseItem,
        review: {
          ...baseItem.review,
          selection: {
            itemKind: 'asset',
            totalCount: 2,
            selectedCount: 1,
            mode: 'allExcept',
            itemIds: ['asset-2'],
            supportsItemSelection: true,
          },
        },
        excludedAssetCount: 1,
      },
      variant: 'modal',
    }),
  });

  const tiles = screen.getAllByTestId('agent-plan-item-thumbnail');
  expect(tiles[0]).toHaveAttribute('data-selected', 'true');
  expect(tiles[0]).toHaveClass('ring-2');
  expect(tiles[1]).toHaveAttribute('data-selected', 'false');
  expect(tiles[1]).toHaveClass('opacity-55');
});
```

- [ ] **Step 5: Implement the modal component**

Create `agent-plan-photo-review-modal.svelte`:

```svelte
<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { t } from 'svelte-i18n';
  import type { OperationReviewItem } from './agent-operation-plan-ui';
  import AgentPlanItemReview from './agent-plan-item-review.svelte';

  interface Props {
    item: OperationReviewItem;
    canChangeSelection: boolean;
    onClose: () => void;
    onToggleItem: (operationId: string, assetId: string, selected: boolean) => void;
    onBulkSetItems: (operationId: string, assetIds: string[], selected: boolean) => void;
    onSetOnlyItems: (operationId: string, assetIds: string[]) => void;
    onResetSelection: (operationId: string) => void;
  }

  let { item, canChangeSelection, onClose, onToggleItem, onBulkSetItems, onSetOnlyItems, onResetSelection }: Props =
    $props();

  const titleId = $props.id();
  let closeButton: HTMLButtonElement | undefined = $state();
  let previousFocusedElement: HTMLElement | null = null;

  onMount(() => {
    previousFocusedElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    void tick().then(() => closeButton?.focus());
    return () => previousFocusedElement?.focus();
  });

  const handleKeydown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
    }
  };
</script>

<svelte:window onkeydown={handleKeydown} />

<div
  class="fixed inset-0 z-50 flex items-end justify-center p-3 sm:items-center sm:p-6"
  role="presentation"
>
  <button
    type="button"
    class="absolute inset-0 bg-black/60 backdrop-blur-md"
    aria-label={$t('assistant_operation_photo_review_close')}
    onclick={onClose}
  ></button>
  <section
    class="relative grid max-h-[calc(100vh-1.5rem)] w-full max-w-6xl grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden rounded-3xl border border-neutral-700 bg-white text-black shadow-2xl dark:bg-neutral-950 dark:text-white"
    role="dialog"
    aria-modal="true"
    aria-labelledby={titleId}
  >
    <header class="flex flex-col gap-4 border-b border-gray-200 p-4 dark:border-neutral-800 sm:flex-row sm:items-start sm:justify-between sm:p-5">
      <div class="min-w-0">
        <p class="text-xs font-semibold uppercase tracking-wide text-immich-primary dark:text-immich-dark-primary">
          {$t('assistant_operation_photo_stage_title')}
        </p>
        <h2 id={titleId} class="mt-1 break-words text-2xl font-semibold leading-tight">
          {$t('assistant_operation_photo_review_title', { values: { summary: item.review.summary } })}
        </h2>
      </div>
      <button
        bind:this={closeButton}
        type="button"
        class="rounded-full border border-gray-300 px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-immich-primary dark:border-neutral-700 dark:text-neutral-100 dark:hover:bg-neutral-900"
        onclick={onClose}
      >
        {$t('assistant_operation_photo_review_close')}
      </button>
    </header>

    <div class="grid min-h-0 gap-0 overflow-hidden lg:grid-cols-[minmax(0,1fr)_18rem]">
      <div class="min-h-0 overflow-auto p-4">
        <AgentPlanItemReview
          {item}
          {canChangeSelection}
          {onToggleItem}
          {onBulkSetItems}
          {onSetOnlyItems}
          {onResetSelection}
          variant="modal"
        />
      </div>

      <aside class="border-t border-gray-200 bg-gray-50 p-4 dark:border-neutral-800 dark:bg-neutral-900/60 lg:border-l lg:border-t-0">
        <section class="rounded-2xl border border-gray-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-950">
          <h3 class="font-semibold">{$t('assistant_operation_photo_review_selection')}</h3>
          <p class="mt-2 text-3xl font-semibold">{item.review.selection.selectedCount}</p>
          <p class="mt-1 text-sm text-gray-600 dark:text-gray-300">
            {$t('assistant_operation_item_selected_count', {
              values: {
                selected: item.review.selection.selectedCount,
                total: item.review.selection.totalCount,
              },
            })}
          </p>
        </section>
      </aside>
    </div>

    <footer class="flex flex-col gap-2 border-t border-gray-200 bg-gray-50 p-4 dark:border-neutral-800 dark:bg-neutral-900 sm:flex-row sm:items-center sm:justify-end">
      <button
        type="button"
        class="rounded-full border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-white focus:outline-none focus:ring-2 focus:ring-immich-primary dark:border-neutral-700 dark:text-neutral-100 dark:hover:bg-neutral-950"
        onclick={() => onResetSelection(item.id)}
        disabled={!canChangeSelection || item.review.selection.mode === 'all'}
      >
        {$t('assistant_operation_photo_review_keep_original')}
      </button>
      <button
        type="button"
        class="rounded-full bg-immich-primary px-4 py-2 text-sm font-semibold text-white hover:bg-immich-primary/90 focus:outline-none focus:ring-2 focus:ring-immich-primary"
        onclick={onClose}
      >
        {$t('assistant_operation_photo_review_done')}
      </button>
    </footer>
  </section>
</div>
```

- [ ] **Step 6: Wire modal state into the evidence ledger**

In `agent-plan-evidence-ledger.svelte`, import the modal:

```ts
import AgentPlanPhotoReviewModal from './agent-plan-photo-review-modal.svelte';
```

Add state and derived item:

```ts
let activeReviewOperationId = $state<string | null>(null);

const activeReviewItem = $derived(
  activeReviewOperationId ? (model.operationsById.get(activeReviewOperationId) ?? null) : null,
);

$effect(() => {
  if (activeReviewOperationId && !model.operationsById.has(activeReviewOperationId)) {
    activeReviewOperationId = null;
  }
});
```

Pass the opener to each destination card:

```svelte
onOpenItemReview={(operationId) => (activeReviewOperationId = operationId)}
```

Render the modal after the apply bar:

```svelte
{#if activeReviewItem}
  <AgentPlanPhotoReviewModal
    item={activeReviewItem}
    {canChangeSelection}
    onClose={() => (activeReviewOperationId = null)}
    {onToggleItem}
    {onBulkSetItems}
    {onSetOnlyItems}
    onResetSelection={onResetItemSelection}
  />
{/if}
```

- [ ] **Step 7: Add English strings**

In `i18n/en.json`, add:

```json
"assistant_operation_photo_review_close": "Close",
"assistant_operation_photo_review_done": "Done reviewing",
"assistant_operation_photo_review_keep_original": "Keep original selection",
"assistant_operation_photo_review_selection": "Selection",
"assistant_operation_photo_review_title": "Review photos for {summary}"
```

- [ ] **Step 8: Run focused tests**

Run:

```bash
pnpm --dir web exec vitest run 'src/routes/(user)/assistant/agent-plan-photo-review-modal.spec.ts' 'src/routes/(user)/assistant/agent-plan-evidence-ledger.spec.ts' 'src/routes/(user)/assistant/agent-operation-plan-review-panel.spec.ts' 'src/routes/(user)/assistant/agent-plan-item-review.spec.ts'
```

Expected: PASS.

- [ ] **Step 9: Commit Task 3**

```bash
git add web/src/routes/\(user\)/assistant/agent-plan-photo-review-modal.svelte web/src/routes/\(user\)/assistant/agent-plan-photo-review-modal.spec.ts web/src/routes/\(user\)/assistant/agent-operation-plan-review-panel.spec.ts web/src/routes/\(user\)/assistant/agent-plan-evidence-ledger.svelte web/src/routes/\(user\)/assistant/agent-plan-evidence-ledger.spec.ts web/src/routes/\(user\)/assistant/agent-plan-item-review.svelte web/src/routes/\(user\)/assistant/agent-plan-item-review.spec.ts i18n/en.json
git commit -m "feat: add assistant photo review modal"
```

---

## Task 4: Separate Change Selection From Technical Details

**Files:**

- Modify: `web/src/routes/(user)/assistant/agent-plan-operation-row.svelte`
- Modify: `web/src/routes/(user)/assistant/agent-plan-operation-row.spec.ts`
- Modify: `web/src/routes/(user)/assistant/agent-plan-technical-details.svelte`
- Modify: `web/src/routes/(user)/assistant/agent-plan-technical-details.spec.ts`
- Modify: `web/src/routes/(user)/assistant/agent-plan-destination-card.svelte`
- Modify: `i18n/en.json`

- [ ] **Step 1: Update operation-row tests for separate controls**

In `agent-plan-operation-row.spec.ts`, add the string:

```ts
assistant_operation_item_change_selection: 'Change selection',
```

Replace the existing "renders item review before technical details" test with:

```ts
it('opens photo selection separately from technical details', async () => {
  const onOpenItemReview = vi.fn();
  render(AgentPlanOperationRow, {
    props: {
      item: model().operationsById.get(addId)!,
      canChangeSelection: true,
      onToggleOperation: vi.fn(),
      onToggleItem: vi.fn(),
      onBulkSetItems: vi.fn(),
      onSetOnlyItems: vi.fn(),
      onResetItemSelection: vi.fn(),
      onSetFieldOverride: vi.fn(),
      onResetFieldOverride: vi.fn(),
      onOpenItemReview,
    },
  });

  await fireEvent.click(screen.getByRole('button', { name: 'Change selection' }));

  expect(onOpenItemReview).toHaveBeenCalledWith(addId);
  expect(screen.queryByRole('group', { name: 'Review photos for Add 2 photos' })).not.toBeInTheDocument();
  expect(screen.queryByText('Operation ID')).not.toBeInTheDocument();

  await fireEvent.click(screen.getByRole('button', { name: 'Show technical details' }));

  expect(screen.getByText('Operation ID')).toBeInTheDocument();
  expect(screen.queryByRole('group', { name: 'Review photos for Add 2 photos' })).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run the failing operation-row test**

Run:

```bash
pnpm --dir web exec vitest run 'src/routes/(user)/assistant/agent-plan-operation-row.spec.ts' -t 'opens photo selection separately'
```

Expected: FAIL because `Change selection` and `onOpenItemReview` do not exist yet.

- [ ] **Step 3: Refactor operation row state**

In `agent-plan-operation-row.svelte`, remove the inline import:

```ts
import AgentPlanItemReview from './agent-plan-item-review.svelte';
```

Add this prop:

```ts
onOpenItemReview?: (operationId: string) => void;
```

Add it to `$props()`:

```ts
onOpenItemReview = () => {},
```

Rename state:

```ts
let technicalDetailsOpen = $state(false);
const canOpenItemReview = $derived(item.review.selection.supportsItemSelection && item.assetCount > 0);
```

Replace the old details/item-review block with:

```svelte
<div class="mt-3 flex flex-wrap gap-2">
  {#if canOpenItemReview}
    <button
      type="button"
      class="rounded-full border border-gray-200 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-immich-primary disabled:cursor-not-allowed disabled:opacity-60 dark:border-neutral-800 dark:bg-neutral-950 dark:text-neutral-100 dark:hover:bg-neutral-900"
      disabled={!canChangeSelection}
      onclick={() => onOpenItemReview(item.id)}
    >
      {$t('assistant_operation_item_change_selection')}
    </button>
  {/if}

  <button
    type="button"
    class="rounded-full border border-gray-200 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-immich-primary dark:border-neutral-800 dark:bg-neutral-950 dark:text-neutral-100 dark:hover:bg-neutral-900"
    aria-expanded={technicalDetailsOpen}
    onclick={() => (technicalDetailsOpen = !technicalDetailsOpen)}
  >
    {$t(technicalDetailsOpen ? 'assistant_operation_detail_hide' : 'assistant_operation_detail_show')}
  </button>
</div>

<AgentPlanTechnicalDetails {item} expanded={technicalDetailsOpen} showToggle={false} />
```

Update row wrapper styling while there:

```svelte
<div class="grid gap-3 py-4 sm:grid-cols-[auto_minmax(0,1fr)]">
```

- [ ] **Step 4: Pass modal opener through destination card**

In `agent-plan-destination-card.svelte`, pass the prop to `AgentPlanOperationRow`:

```svelte
onOpenItemReview={onOpenItemReview}
```

- [ ] **Step 5: Refresh technical details styling**

In `agent-plan-technical-details.svelte`, keep existing data rows and change the expanded panel class to a rounded low-contrast panel:

```svelte
class="mt-3 grid gap-2 rounded-2xl border border-gray-200 bg-gray-50 p-3 text-xs dark:border-neutral-800 dark:bg-neutral-950"
```

If `showToggle` renders its own button, use this class:

```svelte
class="rounded-full border border-gray-200 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-immich-primary dark:border-neutral-800 dark:bg-neutral-950 dark:text-neutral-100 dark:hover:bg-neutral-900"
```

- [ ] **Step 6: Add English string**

In `i18n/en.json`, add:

```json
"assistant_operation_item_change_selection": "Change selection"
```

- [ ] **Step 7: Run focused tests**

Run:

```bash
pnpm --dir web exec vitest run 'src/routes/(user)/assistant/agent-plan-operation-row.spec.ts' 'src/routes/(user)/assistant/agent-plan-technical-details.spec.ts' 'src/routes/(user)/assistant/agent-plan-destination-card.spec.ts'
```

Expected: PASS.

- [ ] **Step 8: Commit Task 4**

```bash
git add web/src/routes/\(user\)/assistant/agent-plan-operation-row.svelte web/src/routes/\(user\)/assistant/agent-plan-operation-row.spec.ts web/src/routes/\(user\)/assistant/agent-plan-technical-details.svelte web/src/routes/\(user\)/assistant/agent-plan-technical-details.spec.ts web/src/routes/\(user\)/assistant/agent-plan-destination-card.svelte i18n/en.json
git commit -m "feat: separate photo review from technical details"
```

---

## Task 5: Rounded Header, Apply Dock, Chat Width, And Activity Timeline

**Files:**

- Modify: `web/src/routes/(user)/assistant/agent-session-header.svelte`
- Modify: `web/src/routes/(user)/assistant/agent-session-header.spec.ts`
- Modify: `web/src/routes/(user)/assistant/agent-activity-visibility-menu.svelte`
- Modify: `web/src/routes/(user)/assistant/agent-plan-apply-bar.svelte`
- Modify: `web/src/routes/(user)/assistant/agent-plan-apply-bar.spec.ts`
- Modify: `web/src/routes/(user)/assistant/agent-session-chat-panel.svelte`
- Modify: `web/src/routes/(user)/assistant/agent-session-chat-panel.spec.ts`
- Modify: `web/src/routes/(user)/assistant/agent-activity-block.svelte`
- Modify: `web/src/routes/(user)/assistant/agent-activity-block.spec.ts`

- [ ] **Step 1: Write focused styling contract tests**

In `agent-session-header.spec.ts`, add:

```ts
it('uses rounded pill action controls in the assistant header', () => {
  renderHeader({ onCancel: vi.fn(), activityVisibilityMode: 'expanded', onActivityVisibilityModeChange: vi.fn() });

  expect(screen.getByRole('button', { name: 'Cancel' })).toHaveClass('rounded-full');
  expect(screen.getByRole('button', { name: 'Details' })).toHaveClass('rounded-full');
  expect(screen.getByRole('button', { name: 'New chat' })).toHaveClass('rounded-full');
  expect(screen.getByRole('button', { name: /Activity preview/i })).toHaveClass('rounded-full');
});
```

In `agent-plan-apply-bar.spec.ts`, add:

```ts
it('renders the apply actions as a rounded dock instead of a block footer', () => {
  render(AgentPlanApplyBar, {
    props: {
      impact,
      selectedOperationIds: ['operation-1', 'operation-2'],
      canApply: true,
      applying: false,
      onApply: vi.fn(),
    },
  });

  const applyRegion = screen.getByRole('region', { name: 'Review selected plan actions' });
  expect(applyRegion).toHaveClass('rounded-3xl');
  expect(applyRegion).not.toHaveClass('border-t');
});
```

In `agent-activity-block.spec.ts`, update the first expanded test to assert the timeline rail:

```ts
expect(block.querySelector('[data-activity-rail]')).toBeInTheDocument();
expect(block.querySelectorAll('[data-activity-row]')[0]).toHaveClass('rounded-2xl');
```

- [ ] **Step 2: Run failing style-contract tests**

Run:

```bash
pnpm --dir web exec vitest run 'src/routes/(user)/assistant/agent-session-header.spec.ts' 'src/routes/(user)/assistant/agent-plan-apply-bar.spec.ts' 'src/routes/(user)/assistant/agent-activity-block.spec.ts'
```

Expected: FAIL because the target rounded classes are not present.

- [ ] **Step 3: Update header and activity visibility controls**

In `agent-session-header.svelte`, change the action container to wrap on small widths:

```svelte
<div class="flex shrink-0 flex-wrap items-center justify-end gap-2">
```

Use these button classes:

```svelte
class="rounded-full border border-red-300 px-3.5 py-2 text-sm font-semibold text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-red-800 dark:text-red-300 dark:hover:bg-red-950"
```

```svelte
class="rounded-full border border-gray-300 px-3.5 py-2 text-sm font-semibold text-black hover:bg-gray-50 dark:border-gray-700 dark:text-white dark:hover:bg-gray-800"
```

```svelte
class="rounded-full bg-immich-primary px-3.5 py-2 text-sm font-semibold text-white hover:bg-immich-primary/90"
```

In `agent-activity-visibility-menu.svelte`, update the trigger:

```svelte
class="rounded-full border border-gray-300 px-3.5 py-2 text-sm font-semibold text-black hover:bg-gray-50 dark:border-gray-700 dark:text-white dark:hover:bg-gray-800"
```

- [ ] **Step 4: Update the apply dock**

In `agent-plan-apply-bar.svelte`, replace the region class with:

```svelte
class="sticky bottom-3 z-10 mt-3 flex flex-col items-stretch gap-3 rounded-3xl border border-gray-200 bg-white/95 p-3 shadow-xl shadow-black/10 backdrop-blur dark:border-neutral-800 dark:bg-neutral-950/95 dark:shadow-black/40 sm:flex-row sm:items-center sm:justify-between"
```

Replace the `Button` import and usage with a native rounded button:

```svelte
<button
  type="button"
  class="rounded-full bg-immich-primary px-4 py-2 text-sm font-semibold text-white hover:bg-immich-primary/90 focus:outline-none focus:ring-2 focus:ring-immich-primary disabled:cursor-not-allowed disabled:opacity-60"
  disabled={!canApply}
  onclick={onApply}
>
  {applying
    ? $t('assistant_operation_apply_applying')
    : $t('assistant_operation_apply_selected', { values: { count: selectedOperationIds.length } })}
</button>
```

- [ ] **Step 5: Widen plan/activity chat lane without widening prose**

In `agent-session-chat-panel.svelte`, change the transcript max width:

```svelte
class="mx-auto flex min-h-full w-full max-w-5xl flex-col gap-4 px-4 pb-36 pt-6 md:px-0"
```

Keep message bubbles at the existing `max-w-[80%]`. For tool-call and activity blocks, use larger max widths:

```svelte
class="mr-auto w-full max-w-4xl rounded-2xl border ..."
```

The goal is that plan/action components can breathe while assistant prose stays readable.

- [ ] **Step 6: Convert activity block to timeline rail styling**

In `agent-activity-block.svelte`, update the article and row container:

```svelte
class="mr-auto w-full max-w-4xl rounded-3xl border border-gray-200 bg-gray-50 p-4 text-sm text-slate-800 shadow-sm dark:border-neutral-800 dark:bg-neutral-950 dark:text-neutral-100"
```

Add a status-to-dot helper near the existing helper functions:

```ts
const getActivityDotClass = (status: AgentActivityStatus) => {
  switch (status) {
    case 'completed': {
      return 'before:bg-green-500';
    }

    case 'running': {
      return 'before:bg-blue-500';
    }

    case 'pending':
    case 'blocked': {
      return 'before:bg-amber-500';
    }

    case 'failed': {
      return 'before:bg-red-500';
    }

    default: {
      return 'before:bg-gray-400';
    }
  }
};
```

Change the rows wrapper:

```svelte
<div
  id={rowsId}
  class="relative mt-4 flex flex-col gap-3 pl-5 before:absolute before:left-1.5 before:top-2 before:h-[calc(100%-1rem)] before:w-px before:bg-gray-200 dark:before:bg-neutral-800"
  data-activity-rail
  role={isActive ? 'status' : undefined}
  aria-live={isActive ? 'polite' : undefined}
>
```

Change each row:

```svelte
<div
  data-activity-row
  class={[
    'relative min-w-0 rounded-2xl border border-gray-200 bg-white px-3 py-3 shadow-sm before:absolute before:-left-[1.35rem] before:top-4 before:size-3 before:rounded-full before:border-2 before:border-white dark:border-neutral-800 dark:bg-neutral-900 dark:before:border-neutral-950',
    getActivityDotClass(item.status),
  ].join(' ')}
>
```

Keep the existing technical-details disclosure behavior.

- [ ] **Step 7: Run focused tests**

Run:

```bash
pnpm --dir web exec vitest run 'src/routes/(user)/assistant/agent-session-header.spec.ts' 'src/routes/(user)/assistant/agent-plan-apply-bar.spec.ts' 'src/routes/(user)/assistant/agent-activity-block.spec.ts' 'src/routes/(user)/assistant/agent-session-chat-panel.spec.ts'
```

Expected: PASS.

- [ ] **Step 8: Commit Task 5**

```bash
git add web/src/routes/\(user\)/assistant/agent-session-header.svelte web/src/routes/\(user\)/assistant/agent-session-header.spec.ts web/src/routes/\(user\)/assistant/agent-activity-visibility-menu.svelte web/src/routes/\(user\)/assistant/agent-plan-apply-bar.svelte web/src/routes/\(user\)/assistant/agent-plan-apply-bar.spec.ts web/src/routes/\(user\)/assistant/agent-session-chat-panel.svelte web/src/routes/\(user\)/assistant/agent-session-chat-panel.spec.ts web/src/routes/\(user\)/assistant/agent-activity-block.svelte web/src/routes/\(user\)/assistant/agent-activity-block.spec.ts
git commit -m "style: polish assistant plan review surfaces"
```

---

## Task 6: Full Verification And Visual Check

**Files:**

- Modify only files needed to fix failures found by this task.

- [ ] **Step 1: Run all assistant frontend tests**

Run:

```bash
pnpm --dir web exec vitest run 'src/routes/(user)/assistant'
```

Expected: PASS.

- [ ] **Step 2: Run Svelte and TypeScript checks**

Run:

```bash
pnpm --dir web run check:svelte
pnpm --dir web run check:typescript
```

Expected: both commands exit 0.

- [ ] **Step 3: Run formatting check on changed files**

Run:

```bash
pnpm --dir web exec prettier --check 'src/routes/(user)/assistant/**/*.{svelte,ts}' '../i18n/en.json'
```

Expected: PASS. If this fails only for formatting, run:

```bash
pnpm --dir web exec prettier --write 'src/routes/(user)/assistant/**/*.{svelte,ts}' '../i18n/en.json'
```

Then rerun the check command.

- [ ] **Step 4: Start the dev server for manual visual verification**

Run:

```bash
pnpm --dir web run dev -- --host 0.0.0.0 --port 3000
```

Expected: Vite prints a local URL on port 3000. If port 3000 is already in use, use port 3001:

```bash
pnpm --dir web run dev -- --host 0.0.0.0 --port 3001
```

- [ ] **Step 5: Manually verify the approved UI states**

In the browser, verify:

- The active plan card uses the rounded plan sheet styling.
- The expanded plan shows the photo stage before operation rows.
- `Review photos` opens the modal.
- `Change selection` opens the same modal.
- `Technical details` expands raw context without opening the photo grid.
- `Collapse plan` hides the plan body and leaves the compact summary visible.
- `Expand plan` restores the selected operations and counts.
- Header actions and activity visibility controls are rounded pills.
- Activity expanded mode uses the timeline rail.
- Mobile width does not overlap text, buttons, thumbnails, modal content, or the apply dock.

- [ ] **Step 6: Commit verification fixes**

If Step 1, Step 2, Step 3, or Step 5 required fixes, commit them:

```bash
git add web/src/routes/\(user\)/assistant i18n/en.json
git commit -m "fix: harden assistant plan review polish"
```

If no fixes were required, do not create an empty commit.
