# Pi Agent Visual Plan Review Slice 2 Evidence Ledger Shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current technical Pi operation-plan review stack with an Evidence Ledger shell made of destination cards, human operation rows, compact impact counts, and a sticky apply bar while preserving operation-level selection and the legacy operation-ID apply request.

**Architecture:** Keep `AgentOperationPlanReviewPanel` as the data-loading and mutation container. Move review rendering into small presentational Svelte components that consume the Slice 1 `OperationReviewModel`; the components render human summaries from `item.review`, dispatch toggle/apply callbacks, and do not duplicate dependency or payload-building rules.

**Tech Stack:** Svelte 5, TypeScript, Svelte Testing Library, Vitest, Tailwind utility classes, existing `@immich/sdk` DTO types, existing `@immich/ui` `Button`.

---

## Scope

Implement Slice 2 from `docs/superpowers/specs/2026-05-17-pi-agent-visual-plan-review-design.md`.

This slice covers:

- Evidence Ledger shell layout inside the existing plan review panel.
- Destination-focused cards using `OperationReviewGroup.destination`.
- Human operation rows using `OperationReviewItem.review.summary`.
- Operation-level toggles only.
- Destination-level toggles with checked/mixed/unchecked states.
- Compact plan and destination impact counts.
- Sticky apply bar that summarizes selected changes/assets.
- Technical operation IDs hidden by default behind a details disclosure.
- Raw target IDs, raw operation summaries, raw payloads, and DTO-shaped labels remain hidden by default.
- Existing apply payload remains `{ operationIds }`.
- Existing loading, empty, error, apply success, websocket refresh, and dock/standalone modes remain working.

This slice does not cover:

- Thumbnail strips or image loading.
- Expanded item grids.
- Item-level include/exclude selection.
- Sparse apply payload extensions.
- Inline field overrides.
- Server DTO/API changes.

## File Structure

- Modify `web/src/routes/(user)/assistant/agent-operation-plan-ui.ts`
  - Add `OperationReviewImpactSummary`.
  - Add `buildOperationReviewImpactSummary(model)`.
- Modify `web/src/routes/(user)/assistant/agent-operation-plan-ui.spec.ts`
  - Add focused unit tests for impact counts and selected assets.
- Create `web/src/routes/(user)/assistant/agent-plan-operation-row.svelte`
  - Render one operation row using `item.review.summary`.
  - Dispatch `onToggleOperation(operationId, checked)`.
  - Hide operation ID behind a details disclosure.
- Create `web/src/routes/(user)/assistant/agent-plan-operation-row.spec.ts`
  - Cover human labels, disabled blocked state, callbacks, and hidden technical details.
- Create `web/src/routes/(user)/assistant/agent-plan-destination-card.svelte`
  - Render one destination card and its operation rows.
  - Dispatch `onToggleGroup(group, checked)` and `onToggleOperation(operationId, checked)`.
- Create `web/src/routes/(user)/assistant/agent-plan-destination-card.spec.ts`
  - Cover destination title, compact counts, mixed checkbox state, and group toggle callback.
- Create `web/src/routes/(user)/assistant/agent-plan-apply-bar.svelte`
  - Render sticky selected count summary and apply button.
- Create `web/src/routes/(user)/assistant/agent-plan-evidence-ledger.svelte`
  - Render plan header, destination card list, apply/error/success messages, and apply bar.
- Create `web/src/routes/(user)/assistant/agent-plan-evidence-ledger.spec.ts`
  - Cover header impact summary, destination list, apply action, and empty destination edge state.
- Modify `web/src/routes/(user)/assistant/agent-operation-plan-review-panel.svelte`
  - Replace inline review markup with `AgentPlanEvidenceLedger`.
  - Keep data loading, websocket handling, selection publishing, apply calls, and passive states.
- Modify `web/src/routes/(user)/assistant/agent-operation-plan-review-panel.spec.ts`
  - Update expectations to the new human-facing labels.
  - Add shell assertions for hidden technical IDs and Evidence Ledger impact counts.
- Modify `e2e/src/specs/web/assistant-album-organizer.e2e-spec.ts`
  - Update the full browser flow to assert destination cards, human row labels, hidden technical details, and unchanged apply behavior.
- Modify `i18n/en.json`
  - Add labels for Evidence Ledger counts, destination toggles, details disclosure, and selected apply summary.

---

### Task 1: Add Impact Summary Helpers

**Files:**

- Modify: `web/src/routes/(user)/assistant/agent-operation-plan-ui.spec.ts`
- Modify: `web/src/routes/(user)/assistant/agent-operation-plan-ui.ts`

- [ ] **Step 1: Write the failing unit tests**

In `web/src/routes/(user)/assistant/agent-operation-plan-ui.spec.ts`, add `buildOperationReviewImpactSummary` to the import list:

```ts
import {
  buildApprovedOperationIds,
  buildGroupEnabledState,
  buildOperationReviewImpactSummary,
  buildOperationReviewModel,
  buildSelectionPayload,
  createInitialOperationEnabledState,
  getOperationAssetCount,
} from './agent-operation-plan-ui';
```

Then add these tests near the other model summary tests:

```ts
it('summarizes selected destinations, changes, and assets for the evidence ledger shell', () => {
  const model = buildOperationReviewModel(
    plan([
      operation({
        id: createId,
        type: AgentOperationType.AlbumCreate,
        summary: 'Create Portugal album',
        targetKind: AgentOperationTargetKind.NewAlbum,
        temporaryTargetId: 'album-portugal',
        payload: { albumName: 'Portugal' },
      }),
      operation({
        id: addId,
        type: AgentOperationType.AlbumAddAssets,
        summary: 'Add two assets',
        targetKind: AgentOperationTargetKind.NewAlbum,
        temporaryTargetId: 'album-portugal',
        assetIds: [assetA, assetB],
        dependencyIds: [createId],
        payload: {},
      }),
      operation({
        id: updateId,
        type: AgentOperationType.AlbumUpdateDetails,
        summary: 'Update existing Portugal description',
        targetKind: AgentOperationTargetKind.ExistingAlbum,
        targetId: '00000000-0000-4000-8000-000000000301',
        payload: { description: 'Updated trip notes' },
      }),
    ]),
    { [createId]: true, [addId]: true, [updateId]: true },
  );

  expect(buildOperationReviewImpactSummary(model)).toEqual({
    destinationCount: 2,
    totalOperationCount: 3,
    selectedOperationCount: 3,
    blockedOperationCount: 0,
    totalAssetCount: 2,
    selectedAssetCount: 2,
  });
});

it('excludes disabled and blocked operations from selected evidence ledger impact counts', () => {
  const model = buildOperationReviewModel(
    plan([
      operation({
        id: createId,
        type: AgentOperationType.AlbumCreate,
        summary: 'Create Portugal album',
        targetKind: AgentOperationTargetKind.NewAlbum,
        temporaryTargetId: 'album-portugal',
        payload: { albumName: 'Portugal' },
      }),
      operation({
        id: addId,
        type: AgentOperationType.AlbumAddAssets,
        summary: 'Add two assets',
        targetKind: AgentOperationTargetKind.NewAlbum,
        temporaryTargetId: 'album-portugal',
        assetIds: [assetA, assetB],
        dependencyIds: [createId],
        payload: {},
      }),
      operation({
        id: updateId,
        type: AgentOperationType.AlbumUpdateDetails,
        summary: 'Update existing Portugal description',
        targetKind: AgentOperationTargetKind.ExistingAlbum,
        targetId: '00000000-0000-4000-8000-000000000301',
        payload: { description: 'Updated trip notes' },
      }),
    ]),
    { [createId]: false, [addId]: true, [updateId]: true },
  );

  expect(buildOperationReviewImpactSummary(model)).toEqual({
    destinationCount: 2,
    totalOperationCount: 3,
    selectedOperationCount: 1,
    blockedOperationCount: 1,
    totalAssetCount: 2,
    selectedAssetCount: 0,
  });
});
```

- [ ] **Step 2: Run the focused tests and verify RED**

Run:

```bash
pnpm --dir web test --run "src/routes/(user)/assistant/agent-operation-plan-ui.spec.ts" -t "evidence ledger impact"
```

Expected: FAIL because `buildOperationReviewImpactSummary` does not exist.

- [ ] **Step 3: Implement the helper**

In `web/src/routes/(user)/assistant/agent-operation-plan-ui.ts`, add this type after `OperationReviewModel`:

```ts
export type OperationReviewImpactSummary = {
  destinationCount: number;
  totalOperationCount: number;
  selectedOperationCount: number;
  blockedOperationCount: number;
  totalAssetCount: number;
  selectedAssetCount: number;
};
```

Add this exported function after `buildSelectionPayload`:

```ts
export const buildOperationReviewImpactSummary = (model: OperationReviewModel): OperationReviewImpactSummary => {
  const selectedOperations = model.plan.operations
    .map((operation) => model.operationsById.get(operation.id))
    .filter((operation): operation is OperationReviewItem => operation !== undefined)
    .filter((operation) => operation.enabled && !operation.blocked);

  return {
    destinationCount: model.groups.length,
    totalOperationCount: model.plan.operations.length,
    selectedOperationCount: selectedOperations.length,
    blockedOperationCount: [...model.operationsById.values()].filter((operation) => operation.blocked).length,
    totalAssetCount: getOperationAssetCount(model.plan.operations),
    selectedAssetCount: getOperationAssetCount(selectedOperations.map(({ operation }) => operation)),
  };
};
```

- [ ] **Step 4: Run the focused tests and verify GREEN**

Run:

```bash
pnpm --dir web test --run "src/routes/(user)/assistant/agent-operation-plan-ui.spec.ts" -t "evidence ledger impact"
```

Expected: PASS.

- [ ] **Step 5: Commit this task**

```bash
git add web/src/routes/\(user\)/assistant/agent-operation-plan-ui.ts web/src/routes/\(user\)/assistant/agent-operation-plan-ui.spec.ts
git commit -m "feat: summarize pi plan review impact"
```

---

### Task 2: Add Operation Row Component

**Files:**

- Create: `web/src/routes/(user)/assistant/agent-plan-operation-row.svelte`
- Create: `web/src/routes/(user)/assistant/agent-plan-operation-row.spec.ts`

- [ ] **Step 1: Write the failing component tests**

Create `web/src/routes/(user)/assistant/agent-plan-operation-row.spec.ts` with:

```ts
import {
  AgentOperationPlanStatus,
  AgentOperationRiskLevel,
  AgentOperationStatus,
  AgentOperationTargetKind,
  AgentOperationType,
  type AgentOperationPlanResponseDto,
  type AgentOperationResponseDto,
} from '@immich/sdk';
import { fireEvent, render, screen } from '@testing-library/svelte';
import { readable } from 'svelte/store';
import { buildOperationReviewModel } from './agent-operation-plan-ui';
import AgentPlanOperationRow from './agent-plan-operation-row.svelte';

vi.mock('svelte-i18n', () => {
  const messages: Record<string, string> = {
    assistant_operation_asset_count: '{count} assets',
    assistant_operation_blocked_by: 'Blocked by {dependencies}',
    assistant_operation_detail_id: 'Operation ID',
    assistant_operation_detail_risk: 'Risk',
    assistant_operation_detail_status: 'Status',
    assistant_operation_detail_toggle: 'Details',
    assistant_operation_detail_type: 'Type',
    assistant_operation_risk_low: 'Low risk',
    assistant_operation_status_applied: 'Applied',
    assistant_operation_status_failed: 'Failed',
    assistant_operation_status_skipped: 'Skipped',
    assistant_operation_type_album_add_assets: 'Add assets',
    assistant_operation_type_album_create: 'Create album',
    assistant_operation_type_album_set_cover: 'Set cover',
    assistant_operation_type_album_update_details: 'Update details',
  };

  return {
    t: readable((key: string, options?: { values?: Record<string, string | number> }) =>
      (messages[key] ?? key)
        .replace('{count}', String(options?.values?.count ?? ''))
        .replace('{dependencies}', String(options?.values?.dependencies ?? '')),
    ),
  };
});

const planId = '00000000-0000-4000-8000-000000000100';
const createId = '00000000-0000-4000-8000-000000000101';
const addId = '00000000-0000-4000-8000-000000000102';
const assetA = '00000000-0000-4000-8000-000000000201';
const assetB = '00000000-0000-4000-8000-000000000202';

const baseOperation = {
  planId,
  targetId: null,
  temporaryTargetId: null,
  assetIds: [],
  dependencyIds: [],
  riskLevel: AgentOperationRiskLevel.Low,
  enabled: true,
  status: AgentOperationStatus.Proposed,
  result: null,
  error: null,
  createdAt: '2026-05-15T00:00:00.000Z',
  updatedAt: '2026-05-15T00:00:00.000Z',
} satisfies Omit<AgentOperationResponseDto, 'id' | 'type' | 'summary' | 'targetKind' | 'payload'>;

const operation = (
  operation: Partial<AgentOperationResponseDto> &
    Pick<AgentOperationResponseDto, 'id' | 'type' | 'summary' | 'targetKind' | 'payload'>,
): AgentOperationResponseDto => ({ ...baseOperation, ...operation });

const plan = (operations: AgentOperationResponseDto[]): AgentOperationPlanResponseDto => ({
  id: planId,
  sessionId: '00000000-0000-4000-8000-000000000001',
  revision: 1,
  status: AgentOperationPlanStatus.Proposed,
  summary: 'Organize Portugal holiday',
  operations,
  createdAt: '2026-05-15T00:00:00.000Z',
  updatedAt: '2026-05-15T00:00:00.000Z',
});

const model = (enabledByOperationId = { [createId]: true, [addId]: true }) =>
  buildOperationReviewModel(
    plan([
      operation({
        id: createId,
        type: AgentOperationType.AlbumCreate,
        summary: 'Create Portugal album',
        targetKind: AgentOperationTargetKind.NewAlbum,
        temporaryTargetId: 'album-portugal',
        payload: { albumName: 'Portugal' },
      }),
      operation({
        id: addId,
        type: AgentOperationType.AlbumAddAssets,
        summary: 'Add two assets',
        targetKind: AgentOperationTargetKind.NewAlbum,
        temporaryTargetId: 'album-portugal',
        assetIds: [assetA, assetB],
        dependencyIds: [createId],
        payload: {},
      }),
    ]),
    enabledByOperationId,
  );

describe('AgentPlanOperationRow', () => {
  it('renders a human operation summary and dispatches operation toggle changes', async () => {
    const onToggleOperation = vi.fn();
    render(AgentPlanOperationRow, {
      props: {
        item: model().operationsById.get(addId)!,
        canChangeSelection: true,
        onToggleOperation,
      },
    });

    await fireEvent.click(screen.getByRole('checkbox', { name: 'Add 2 photos' }));

    expect(screen.getByText('Add 2 photos')).toBeInTheDocument();
    expect(screen.getByText('2 assets')).toBeInTheDocument();
    expect(screen.queryByText('Add two assets')).not.toBeInTheDocument();
    expect(screen.queryByText(addId)).not.toBeInTheDocument();
    expect(onToggleOperation).toHaveBeenCalledWith(addId, false);
  });

  it('disables blocked operations and explains the dependency in user language', () => {
    render(AgentPlanOperationRow, {
      props: {
        item: model({ [createId]: false, [addId]: true }).operationsById.get(addId)!,
        canChangeSelection: true,
        onToggleOperation: vi.fn(),
      },
    });

    expect(screen.getByRole('checkbox', { name: 'Add 2 photos' })).toBeDisabled();
    expect(screen.getByText('Blocked by Create Portugal album')).toBeInTheDocument();
  });

  it('keeps technical operation details hidden until the user expands details', async () => {
    render(AgentPlanOperationRow, {
      props: {
        item: model().operationsById.get(addId)!,
        canChangeSelection: true,
        onToggleOperation: vi.fn(),
      },
    });

    expect(screen.queryByText(addId)).not.toBeInTheDocument();

    await fireEvent.click(screen.getByText('Details'));

    expect(screen.getByText('Operation ID')).toBeInTheDocument();
    expect(screen.getByText(addId)).toBeInTheDocument();
    expect(screen.getByText('Add assets')).toBeInTheDocument();
    expect(screen.getByText('Low risk')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the tests and verify RED**

Run:

```bash
pnpm --dir web test --run "src/routes/(user)/assistant/agent-plan-operation-row.spec.ts"
```

Expected: FAIL because `agent-plan-operation-row.svelte` does not exist.

- [ ] **Step 3: Create the operation row component**

Create `web/src/routes/(user)/assistant/agent-plan-operation-row.svelte`:

```svelte
<script lang="ts">
  import { AgentOperationStatus } from '@immich/sdk';
  import { t } from 'svelte-i18n';
  import type { OperationReviewItem } from './agent-operation-plan-ui';

  interface Props {
    item: OperationReviewItem;
    canChangeSelection: boolean;
    onToggleOperation: (operationId: string, checked: boolean) => void;
  }

  let { item, canChangeSelection, onToggleOperation }: Props = $props();
  let detailsOpen = $state(false);
</script>

<div class="flex gap-3 py-3">
  <input
    class="mt-1 size-4 shrink-0"
    type="checkbox"
    aria-label={item.review.summary}
    checked={item.enabled}
    disabled={!canChangeSelection || item.blocked}
    onchange={(event) => onToggleOperation(item.id, event.currentTarget.checked)}
  />

  <div class="min-w-0 flex-1">
    <p class="font-medium leading-5">{item.review.summary}</p>

    <div class="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-sm text-gray-500 dark:text-gray-400">
      {#if item.review.selection.totalCount > 0}
        <span>
          {$t('assistant_operation_asset_count', { values: { count: item.review.selection.totalCount } })}
        </span>
      {/if}
      {#if item.operation.status === AgentOperationStatus.Applied}
        <span>{$t('assistant_operation_status_applied')}</span>
      {:else if item.operation.status === AgentOperationStatus.Failed}
        <span>{$t('assistant_operation_status_failed')}</span>
      {:else if item.operation.status === AgentOperationStatus.Skipped}
        <span>{$t('assistant_operation_status_skipped')}</span>
      {/if}
    </div>

    {#if item.blocked}
      <span class="mt-1 block text-sm text-amber-700 dark:text-amber-300">
        {$t('assistant_operation_blocked_by', { values: { dependencies: item.blockedBy.join(', ') } })}
      </span>
    {/if}

    {#if item.operation.error}
      <span class="mt-1 block text-sm text-red-700 dark:text-red-300">
        {item.operation.error}
      </span>
    {/if}

    <details class="mt-2 text-xs text-gray-500 dark:text-gray-400" bind:open={detailsOpen}>
      <summary class="cursor-pointer select-none">{$t('assistant_operation_detail_toggle')}</summary>
      {#if detailsOpen}
        <dl class="mt-2 grid gap-1 sm:grid-cols-[max-content_1fr]">
          <dt class="font-medium">{$t('assistant_operation_detail_type')}</dt>
          <dd>{$t(item.typeLabelKey)}</dd>
          <dt class="font-medium">{$t('assistant_operation_detail_risk')}</dt>
          <dd>{$t(item.riskLabelKey)}</dd>
          <dt class="font-medium">{$t('assistant_operation_detail_status')}</dt>
          <dd>{item.operation.status}</dd>
          <dt class="font-medium">{$t('assistant_operation_detail_id')}</dt>
          <dd class="break-all">{item.id}</dd>
        </dl>
      {/if}
    </details>
  </div>
</div>
```

- [ ] **Step 4: Run the tests and verify GREEN**

Run:

```bash
pnpm --dir web test --run "src/routes/(user)/assistant/agent-plan-operation-row.spec.ts"
```

Expected: PASS.

- [ ] **Step 5: Commit this task**

```bash
git add web/src/routes/\(user\)/assistant/agent-plan-operation-row.svelte web/src/routes/\(user\)/assistant/agent-plan-operation-row.spec.ts
git commit -m "feat: add pi plan operation row"
```

---

### Task 3: Add Destination Card Component

**Files:**

- Create: `web/src/routes/(user)/assistant/agent-plan-destination-card.svelte`
- Create: `web/src/routes/(user)/assistant/agent-plan-destination-card.spec.ts`

- [ ] **Step 1: Write the failing component tests**

Create `web/src/routes/(user)/assistant/agent-plan-destination-card.spec.ts` with:

```ts
import {
  AgentOperationPlanStatus,
  AgentOperationRiskLevel,
  AgentOperationStatus,
  AgentOperationTargetKind,
  AgentOperationType,
  type AgentOperationPlanResponseDto,
  type AgentOperationResponseDto,
} from '@immich/sdk';
import { fireEvent, render, screen } from '@testing-library/svelte';
import { readable } from 'svelte/store';
import { buildOperationReviewModel } from './agent-operation-plan-ui';
import AgentPlanDestinationCard from './agent-plan-destination-card.svelte';

vi.mock('svelte-i18n', () => {
  const messages: Record<string, string> = {
    assistant_operation_asset_count: '{count} assets',
    assistant_operation_blocked_by: 'Blocked by {dependencies}',
    assistant_operation_destination_selected_summary: '{selected} of {total} changes selected',
    assistant_operation_destination_toggle: 'Select destination {name}',
    assistant_operation_detail_id: 'Operation ID',
    assistant_operation_detail_risk: 'Risk',
    assistant_operation_detail_status: 'Status',
    assistant_operation_detail_toggle: 'Details',
    assistant_operation_detail_type: 'Type',
    assistant_operation_risk_low: 'Low risk',
    assistant_operation_type_album_add_assets: 'Add assets',
    assistant_operation_type_album_create: 'Create album',
  };

  return {
    t: readable((key: string, options?: { values?: Record<string, string | number> }) =>
      (messages[key] ?? key)
        .replace('{count}', String(options?.values?.count ?? ''))
        .replace('{selected}', String(options?.values?.selected ?? ''))
        .replace('{total}', String(options?.values?.total ?? ''))
        .replace('{name}', String(options?.values?.name ?? ''))
        .replace('{dependencies}', String(options?.values?.dependencies ?? '')),
    ),
  };
});

const planId = '00000000-0000-4000-8000-000000000100';
const createId = '00000000-0000-4000-8000-000000000101';
const addId = '00000000-0000-4000-8000-000000000102';
const assetA = '00000000-0000-4000-8000-000000000201';
const assetB = '00000000-0000-4000-8000-000000000202';

const baseOperation = {
  planId,
  targetId: null,
  temporaryTargetId: null,
  assetIds: [],
  dependencyIds: [],
  riskLevel: AgentOperationRiskLevel.Low,
  enabled: true,
  status: AgentOperationStatus.Proposed,
  result: null,
  error: null,
  createdAt: '2026-05-15T00:00:00.000Z',
  updatedAt: '2026-05-15T00:00:00.000Z',
} satisfies Omit<AgentOperationResponseDto, 'id' | 'type' | 'summary' | 'targetKind' | 'payload'>;

const operation = (
  operation: Partial<AgentOperationResponseDto> &
    Pick<AgentOperationResponseDto, 'id' | 'type' | 'summary' | 'targetKind' | 'payload'>,
): AgentOperationResponseDto => ({ ...baseOperation, ...operation });

const plan = (operations: AgentOperationResponseDto[]): AgentOperationPlanResponseDto => ({
  id: planId,
  sessionId: '00000000-0000-4000-8000-000000000001',
  revision: 1,
  status: AgentOperationPlanStatus.Proposed,
  summary: 'Organize Portugal holiday',
  operations,
  createdAt: '2026-05-15T00:00:00.000Z',
  updatedAt: '2026-05-15T00:00:00.000Z',
});

const group = (enabledByOperationId = { [createId]: true, [addId]: true }) =>
  buildOperationReviewModel(
    plan([
      operation({
        id: createId,
        type: AgentOperationType.AlbumCreate,
        summary: 'Create Portugal album',
        targetKind: AgentOperationTargetKind.NewAlbum,
        temporaryTargetId: 'album-portugal',
        payload: { albumName: 'Portugal' },
      }),
      operation({
        id: addId,
        type: AgentOperationType.AlbumAddAssets,
        summary: 'Add two assets',
        targetKind: AgentOperationTargetKind.NewAlbum,
        temporaryTargetId: 'album-portugal',
        assetIds: [assetA, assetB],
        dependencyIds: [createId],
        payload: {},
      }),
    ]),
    enabledByOperationId,
  ).groups[0];

describe('AgentPlanDestinationCard', () => {
  it('renders destination evidence with compact operation and asset counts', () => {
    render(AgentPlanDestinationCard, {
      props: {
        group: group(),
        canChangeSelection: true,
        onToggleGroup: vi.fn(),
        onToggleOperation: vi.fn(),
      },
    });

    expect(screen.getByRole('region', { name: 'Portugal' })).toBeInTheDocument();
    expect(screen.getByText('Portugal')).toBeInTheDocument();
    expect(screen.getByText('New album')).toBeInTheDocument();
    expect(screen.getByText('2 of 2 changes selected')).toBeInTheDocument();
    expect(screen.getByText('2 assets')).toBeInTheDocument();
    expect(screen.getByText('Create album "Portugal"')).toBeInTheDocument();
    expect(screen.getByText('Add 2 photos')).toBeInTheDocument();
  });

  it('sets mixed state when only some operations are selected', () => {
    render(AgentPlanDestinationCard, {
      props: {
        group: group({ [createId]: true, [addId]: false }),
        canChangeSelection: true,
        onToggleGroup: vi.fn(),
        onToggleOperation: vi.fn(),
      },
    });

    const checkbox = screen.getByRole('checkbox', { name: 'Select destination Portugal' }) as HTMLInputElement;
    expect(checkbox).not.toBeChecked();
    expect(checkbox.indeterminate).toBe(true);
    expect(checkbox).toHaveAttribute('aria-checked', 'mixed');
  });

  it('dispatches group toggle changes with the whole group', async () => {
    const currentGroup = group();
    const onToggleGroup = vi.fn();
    render(AgentPlanDestinationCard, {
      props: {
        group: currentGroup,
        canChangeSelection: true,
        onToggleGroup,
        onToggleOperation: vi.fn(),
      },
    });

    await fireEvent.click(screen.getByRole('checkbox', { name: 'Select destination Portugal' }));

    expect(onToggleGroup).toHaveBeenCalledWith(currentGroup, false);
  });
});
```

- [ ] **Step 2: Run the tests and verify RED**

Run:

```bash
pnpm --dir web test --run "src/routes/(user)/assistant/agent-plan-destination-card.spec.ts"
```

Expected: FAIL because `agent-plan-destination-card.svelte` does not exist.

- [ ] **Step 3: Create the destination card component**

Create `web/src/routes/(user)/assistant/agent-plan-destination-card.svelte`:

```svelte
<script lang="ts">
  import { t } from 'svelte-i18n';
  import type { OperationReviewGroup } from './agent-operation-plan-ui';
  import AgentPlanOperationRow from './agent-plan-operation-row.svelte';

  interface Props {
    group: OperationReviewGroup;
    canChangeSelection: boolean;
    onToggleGroup: (group: OperationReviewGroup, checked: boolean) => void;
    onToggleOperation: (operationId: string, checked: boolean) => void;
  }

  let { group, canChangeSelection, onToggleGroup, onToggleOperation }: Props = $props();

  const getDestinationTitle = (reviewGroup: OperationReviewGroup) => {
    if (
      reviewGroup.destination.id &&
      reviewGroup.destination.name === `Existing album ${reviewGroup.destination.id}`
    ) {
      return 'Existing album';
    }

    return reviewGroup.destination.name || reviewGroup.title;
  };

  const destinationTitle = $derived(getDestinationTitle(group));
  const enabledOperationCount = $derived(group.operations.filter((operation) => operation.enabled).length);
  const groupSelectionState = $derived({
    checked: enabledOperationCount === group.operations.length,
    mixed: enabledOperationCount > 0 && enabledOperationCount < group.operations.length,
  });

  const setMixedCheckbox = (node: HTMLInputElement, state: { checked: boolean; mixed: boolean }) => {
    const update = ({ checked, mixed }: { checked: boolean; mixed: boolean }) => {
      node.indeterminate = mixed;
      node.setAttribute('aria-checked', mixed ? 'mixed' : String(checked));
    };

    update(state);

    return { update };
  };
</script>

<section
  class="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-immich-dark-gray"
  aria-label={destinationTitle}
>
  <div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
    <div class="flex min-w-0 gap-3">
      <input
        class="mt-1 size-4 shrink-0"
        type="checkbox"
        aria-label={$t('assistant_operation_destination_toggle', { values: { name: destinationTitle } })}
        checked={groupSelectionState.checked}
        disabled={!canChangeSelection}
        use:setMixedCheckbox={groupSelectionState}
        onchange={(event) => onToggleGroup(group, event.currentTarget.checked)}
      />
      <div class="min-w-0">
        <h3 class="truncate font-medium leading-5">{destinationTitle}</h3>
        {#if group.destination.subtitle}
          <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">{group.destination.subtitle}</p>
        {/if}
      </div>
    </div>

    <div class="flex flex-wrap gap-x-3 gap-y-1 text-sm text-gray-500 dark:text-gray-400 sm:justify-end">
      <span>
        {$t('assistant_operation_destination_selected_summary', {
          values: { selected: enabledOperationCount, total: group.operations.length },
        })}
      </span>
      {#if group.assetCount > 0}
        <span>{$t('assistant_operation_asset_count', { values: { count: group.assetCount } })}</span>
      {/if}
    </div>
  </div>

  <div class="mt-3 flex flex-col divide-y divide-gray-200 dark:divide-gray-700">
    {#each group.operations as item (item.id)}
      <AgentPlanOperationRow {item} {canChangeSelection} {onToggleOperation} />
    {/each}
  </div>
</section>
```

- [ ] **Step 4: Run the tests and verify GREEN**

Run:

```bash
pnpm --dir web test --run "src/routes/(user)/assistant/agent-plan-destination-card.spec.ts"
```

Expected: PASS.

- [ ] **Step 5: Commit this task**

```bash
git add web/src/routes/\(user\)/assistant/agent-plan-destination-card.svelte web/src/routes/\(user\)/assistant/agent-plan-destination-card.spec.ts
git commit -m "feat: add pi plan destination card"
```

---

### Task 4: Add Evidence Ledger And Apply Bar Components

**Files:**

- Create: `web/src/routes/(user)/assistant/agent-plan-apply-bar.svelte`
- Create: `web/src/routes/(user)/assistant/agent-plan-evidence-ledger.svelte`
- Create: `web/src/routes/(user)/assistant/agent-plan-evidence-ledger.spec.ts`

- [ ] **Step 1: Write the failing component tests**

Create `web/src/routes/(user)/assistant/agent-plan-evidence-ledger.spec.ts` with:

```ts
import {
  AgentOperationPlanStatus,
  AgentOperationRiskLevel,
  AgentOperationStatus,
  AgentOperationTargetKind,
  AgentOperationType,
  type AgentOperationPlanResponseDto,
  type AgentOperationResponseDto,
} from '@immich/sdk';
import { fireEvent, render, screen } from '@testing-library/svelte';
import { readable } from 'svelte/store';
import { buildOperationReviewModel } from './agent-operation-plan-ui';
import AgentPlanEvidenceLedger from './agent-plan-evidence-ledger.svelte';

vi.mock('svelte-i18n', () => {
  const messages: Record<string, string> = {
    assistant_operation_apply_applying: 'Applying operations',
    assistant_operation_apply_selected: 'Apply {count} selected',
    assistant_operation_apply_summary: '{changes} changes · {assets} assets selected',
    assistant_operation_asset_count: '{count} assets',
    assistant_operation_blocked_by: 'Blocked by {dependencies}',
    assistant_operation_destination_selected_summary: '{selected} of {total} changes selected',
    assistant_operation_destination_toggle: 'Select destination {name}',
    assistant_operation_detail_id: 'Operation ID',
    assistant_operation_detail_risk: 'Risk',
    assistant_operation_detail_status: 'Status',
    assistant_operation_detail_toggle: 'Details',
    assistant_operation_detail_type: 'Type',
    assistant_operation_plan_destination_count: '{count} destinations',
    assistant_operation_plan_no_destructive_changes: 'No photos will be deleted',
    assistant_operation_plan_review: 'Plan review',
    assistant_operation_plan_selected_asset_count: '{count} selected assets',
    assistant_operation_plan_selected_change_count: '{count} selected changes',
    assistant_operation_risk_low: 'Low risk',
    assistant_operation_type_album_add_assets: 'Add assets',
    assistant_operation_type_album_create: 'Create album',
  };

  return {
    t: readable((key: string, options?: { values?: Record<string, string | number> }) =>
      (messages[key] ?? key)
        .replace('{assets}', String(options?.values?.assets ?? ''))
        .replace('{changes}', String(options?.values?.changes ?? ''))
        .replace('{count}', String(options?.values?.count ?? ''))
        .replace('{dependencies}', String(options?.values?.dependencies ?? ''))
        .replace('{name}', String(options?.values?.name ?? ''))
        .replace('{selected}', String(options?.values?.selected ?? ''))
        .replace('{total}', String(options?.values?.total ?? '')),
    ),
  };
});

const planId = '00000000-0000-4000-8000-000000000100';
const createId = '00000000-0000-4000-8000-000000000101';
const addId = '00000000-0000-4000-8000-000000000102';
const updateId = '00000000-0000-4000-8000-000000000103';
const assetA = '00000000-0000-4000-8000-000000000201';
const assetB = '00000000-0000-4000-8000-000000000202';

const baseOperation = {
  planId,
  targetId: null,
  temporaryTargetId: null,
  assetIds: [],
  dependencyIds: [],
  riskLevel: AgentOperationRiskLevel.Low,
  enabled: true,
  status: AgentOperationStatus.Proposed,
  result: null,
  error: null,
  createdAt: '2026-05-15T00:00:00.000Z',
  updatedAt: '2026-05-15T00:00:00.000Z',
} satisfies Omit<AgentOperationResponseDto, 'id' | 'type' | 'summary' | 'targetKind' | 'payload'>;

const operation = (
  operation: Partial<AgentOperationResponseDto> &
    Pick<AgentOperationResponseDto, 'id' | 'type' | 'summary' | 'targetKind' | 'payload'>,
): AgentOperationResponseDto => ({ ...baseOperation, ...operation });

const plan = (operations: AgentOperationResponseDto[]): AgentOperationPlanResponseDto => ({
  id: planId,
  sessionId: '00000000-0000-4000-8000-000000000001',
  revision: 1,
  status: AgentOperationPlanStatus.Proposed,
  summary: 'Organize Portugal holiday',
  operations,
  createdAt: '2026-05-15T00:00:00.000Z',
  updatedAt: '2026-05-15T00:00:00.000Z',
});

const model = () =>
  buildOperationReviewModel(
    plan([
      operation({
        id: createId,
        type: AgentOperationType.AlbumCreate,
        summary: 'Create Portugal album',
        targetKind: AgentOperationTargetKind.NewAlbum,
        temporaryTargetId: 'album-portugal',
        payload: { albumName: 'Portugal' },
      }),
      operation({
        id: addId,
        type: AgentOperationType.AlbumAddAssets,
        summary: 'Add two assets',
        targetKind: AgentOperationTargetKind.NewAlbum,
        temporaryTargetId: 'album-portugal',
        assetIds: [assetA, assetB],
        dependencyIds: [createId],
        payload: {},
      }),
      operation({
        id: updateId,
        type: AgentOperationType.AlbumUpdateDetails,
        summary: 'Update description',
        targetKind: AgentOperationTargetKind.ExistingAlbum,
        targetId: '00000000-0000-4000-8000-000000000301',
        payload: { description: 'Better notes' },
      }),
    ]),
    { [createId]: true, [addId]: true, [updateId]: true },
  );

describe('AgentPlanEvidenceLedger', () => {
  it('renders the plan header, destination cards, and sticky apply summary', () => {
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
        onApply: vi.fn(),
      },
    });

    expect(screen.getByRole('heading', { name: 'Plan review' })).toBeInTheDocument();
    expect(screen.getByText('Organize Portugal holiday')).toBeInTheDocument();
    expect(screen.getByText('2 destinations')).toBeInTheDocument();
    expect(screen.getByText('3 selected changes')).toBeInTheDocument();
    expect(screen.getByText('2 selected assets')).toBeInTheDocument();
    expect(screen.getByText('No photos will be deleted')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Portugal' })).toBeInTheDocument();
    expect(screen.queryByText('Update description')).not.toBeInTheDocument();
    expect(screen.queryByText('00000000-0000-4000-8000-000000000301')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Apply 3 selected' })).toBeInTheDocument();
    expect(screen.getByText('3 changes · 2 assets selected')).toBeInTheDocument();
  });

  it('dispatches apply from the sticky apply bar', async () => {
    const onApply = vi.fn();
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
        onApply,
      },
    });

    await fireEvent.click(screen.getByRole('button', { name: 'Apply 3 selected' }));

    expect(onApply).toHaveBeenCalledOnce();
  });

  it('can omit the ledger header when embedded inside the collapsible review panel', () => {
    render(AgentPlanEvidenceLedger, {
      props: {
        model: model(),
        selectedOperationIds: [createId, addId, updateId],
        canChangeSelection: true,
        canApply: true,
        applying: false,
        showHeader: false,
        errorMessage: null,
        applyErrorMessage: null,
        applyMessage: null,
        onToggleGroup: vi.fn(),
        onToggleOperation: vi.fn(),
        onApply: vi.fn(),
      },
    });

    expect(screen.queryByRole('heading', { name: 'Plan review' })).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Portugal' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Apply 3 selected' })).toBeInTheDocument();
  });

  it('renders an empty ledger shell without destination cards or an enabled apply action', () => {
    render(AgentPlanEvidenceLedger, {
      props: {
        model: buildOperationReviewModel(plan([]), {}),
        selectedOperationIds: [],
        canChangeSelection: true,
        canApply: false,
        applying: false,
        errorMessage: null,
        applyErrorMessage: null,
        applyMessage: null,
        onToggleGroup: vi.fn(),
        onToggleOperation: vi.fn(),
        onApply: vi.fn(),
      },
    });

    expect(screen.getByText('0 destinations')).toBeInTheDocument();
    expect(screen.getByText('0 selected changes')).toBeInTheDocument();
    expect(screen.getByText('0 selected assets')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Portugal' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Apply 0 selected' })).toBeDisabled();
  });
});
```

- [ ] **Step 2: Run the tests and verify RED**

Run:

```bash
pnpm --dir web test --run "src/routes/(user)/assistant/agent-plan-evidence-ledger.spec.ts"
```

Expected: FAIL because `agent-plan-evidence-ledger.svelte` does not exist.

- [ ] **Step 3: Create the apply bar component**

Create `web/src/routes/(user)/assistant/agent-plan-apply-bar.svelte`:

```svelte
<script lang="ts">
  import { Button } from '@immich/ui';
  import { t } from 'svelte-i18n';
  import type { OperationReviewImpactSummary } from './agent-operation-plan-ui';

  interface Props {
    impact: OperationReviewImpactSummary;
    selectedOperationIds: string[];
    canApply: boolean;
    applying: boolean;
    onApply: () => void;
  }

  let { impact, selectedOperationIds, canApply, applying, onApply }: Props = $props();
</script>

<div
  class="sticky bottom-0 -mx-4 mt-1 flex flex-col gap-3 border-t border-gray-200 bg-white px-4 py-3 dark:border-gray-800 dark:bg-immich-dark-gray sm:flex-row sm:items-center sm:justify-between"
  data-testid="agent-operation-plan-sticky-actions"
>
  <div class="text-sm font-medium text-gray-600 dark:text-gray-300">
    {$t('assistant_operation_apply_summary', {
      values: { changes: impact.selectedOperationCount, assets: impact.selectedAssetCount },
    })}
  </div>
  <Button type="button" disabled={!canApply} onclick={onApply}>
    {applying
      ? $t('assistant_operation_apply_applying')
      : $t('assistant_operation_apply_selected', { values: { count: selectedOperationIds.length } })}
  </Button>
</div>
```

- [ ] **Step 4: Create the Evidence Ledger component**

Create `web/src/routes/(user)/assistant/agent-plan-evidence-ledger.svelte`:

```svelte
<script lang="ts">
  import { t } from 'svelte-i18n';
  import {
    buildOperationReviewImpactSummary,
    type OperationReviewGroup,
    type OperationReviewModel,
  } from './agent-operation-plan-ui';
  import AgentPlanApplyBar from './agent-plan-apply-bar.svelte';
  import AgentPlanDestinationCard from './agent-plan-destination-card.svelte';

  interface Props {
    model: OperationReviewModel;
    selectedOperationIds: string[];
    canChangeSelection: boolean;
    canApply: boolean;
    applying: boolean;
    showHeader?: boolean;
    errorMessage: string | null;
    applyErrorMessage: string | null;
    applyMessage: string | null;
    onToggleGroup: (group: OperationReviewGroup, checked: boolean) => void;
    onToggleOperation: (operationId: string, checked: boolean) => void;
    onApply: () => void;
  }

  let {
    model,
    selectedOperationIds,
    canChangeSelection,
    canApply,
    applying,
    showHeader = true,
    errorMessage,
    applyErrorMessage,
    applyMessage,
    onToggleGroup,
    onToggleOperation,
    onApply,
  }: Props = $props();

  const impact = $derived(buildOperationReviewImpactSummary(model));
</script>

<div class="flex flex-col gap-4">
  {#if showHeader}
    <header class="flex flex-col gap-3 border-b border-gray-200 pb-4 dark:border-gray-800">
      <div class="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 id="assistant-operation-plan-title" class="text-lg font-semibold">
            {$t('assistant_operation_plan_review')}
          </h2>
          <p class="mt-1 text-sm text-gray-600 dark:text-gray-300">{model.plan.summary}</p>
        </div>
        <p class="text-sm font-medium text-gray-600 dark:text-gray-300">
          {$t('assistant_operation_plan_no_destructive_changes')}
        </p>
      </div>

      <div class="flex flex-wrap gap-2 text-sm text-gray-500 dark:text-gray-400">
        <span class="rounded-md bg-gray-100 px-2 py-1 dark:bg-gray-800">
          {$t('assistant_operation_plan_destination_count', { values: { count: impact.destinationCount } })}
        </span>
        <span class="rounded-md bg-gray-100 px-2 py-1 dark:bg-gray-800">
          {$t('assistant_operation_plan_selected_change_count', { values: { count: impact.selectedOperationCount } })}
        </span>
        <span class="rounded-md bg-gray-100 px-2 py-1 dark:bg-gray-800">
          {$t('assistant_operation_plan_selected_asset_count', { values: { count: impact.selectedAssetCount } })}
        </span>
      </div>
    </header>
  {/if}

  <div class="flex flex-col gap-3">
    {#each model.groups as group (group.id)}
      <AgentPlanDestinationCard {group} {canChangeSelection} {onToggleGroup} {onToggleOperation} />
    {/each}
  </div>

  {#if errorMessage}
    <p
      class="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-200"
      role="alert"
    >
      {errorMessage}
    </p>
  {/if}

  {#if applyErrorMessage}
    <p
      class="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-200"
      role="alert"
    >
      {applyErrorMessage}
    </p>
  {/if}

  {#if applyMessage}
    <p
      class="rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-700 dark:border-green-900 dark:bg-green-950 dark:text-green-200"
      role="status"
    >
      {applyMessage}
    </p>
  {/if}

  <AgentPlanApplyBar {impact} {selectedOperationIds} {canApply} {applying} {onApply} />
</div>
```

- [ ] **Step 5: Run the tests and verify GREEN**

Run:

```bash
pnpm --dir web test --run "src/routes/(user)/assistant/agent-plan-evidence-ledger.spec.ts"
```

Expected: PASS.

- [ ] **Step 6: Commit this task**

```bash
git add web/src/routes/\(user\)/assistant/agent-plan-apply-bar.svelte web/src/routes/\(user\)/assistant/agent-plan-evidence-ledger.svelte web/src/routes/\(user\)/assistant/agent-plan-evidence-ledger.spec.ts
git commit -m "feat: add pi plan evidence ledger shell"
```

---

### Task 5: Integrate Evidence Ledger Into The Review Panel

**Files:**

- Modify: `web/src/routes/(user)/assistant/agent-operation-plan-review-panel.svelte`
- Modify: `web/src/routes/(user)/assistant/agent-operation-plan-review-panel.spec.ts`
- Modify: `i18n/en.json`

- [ ] **Step 1: Write failing panel integration assertions**

In `web/src/routes/(user)/assistant/agent-operation-plan-review-panel.spec.ts`, add these mock messages to the existing `messages` object:

```ts
assistant_operation_apply_summary: '{changes} changes · {assets} assets selected',
assistant_operation_destination_selected_summary: '{selected} of {total} changes selected',
assistant_operation_destination_toggle: 'Select destination {name}',
assistant_operation_detail_id: 'Operation ID',
assistant_operation_detail_risk: 'Risk',
assistant_operation_detail_status: 'Status',
assistant_operation_detail_toggle: 'Details',
assistant_operation_detail_type: 'Type',
assistant_operation_plan_destination_count: '{count} destinations',
assistant_operation_plan_no_destructive_changes: 'No photos will be deleted',
assistant_operation_plan_selected_asset_count: '{count} selected assets',
assistant_operation_plan_selected_change_count: '{count} selected changes',
assistant_operation_risk_unknown: 'Unknown risk',
assistant_operation_type_unknown: 'Review change',
```

Update the mock replacement chain to include:

```ts
.replace('{assets}', String(options?.values?.assets ?? ''))
.replace('{changes}', String(options?.values?.changes ?? ''))
.replace('{name}', String(options?.values?.name ?? ''))
.replace('{selected}', String(options?.values?.selected ?? ''))
.replace('{total}', String(options?.values?.total ?? ''))
```

Then update the `loads and renders grouped proposed operations` test body to assert the new shell:

```ts
const region = await screen.findByRole('region', { name: 'Plan review' });
expect(within(region).getByText('Organize Portugal holiday')).toBeInTheDocument();
expect(within(region).getByText('2 destinations')).toBeInTheDocument();
expect(within(region).getByText('3 selected changes')).toBeInTheDocument();
expect(within(region).getByText('2 selected assets')).toBeInTheDocument();
expect(within(region).getByText('No photos will be deleted')).toBeInTheDocument();
expect(within(region).getByRole('region', { name: 'Portugal' })).toBeInTheDocument();
expect(within(region).getByText('Create album "Portugal"')).toBeInTheDocument();
expect(within(region).getByText('Add 2 photos')).toBeInTheDocument();
expect(within(region).getByText('Update album details')).toBeInTheDocument();
expect(within(region).queryByText(addId)).not.toBeInTheDocument();
expect(within(region).queryByText('Add two assets')).not.toBeInTheDocument();
expect(within(region).queryByText('00000000-0000-4000-8000-000000000301')).not.toBeInTheDocument();
expect(within(region).getAllByRole('heading', { name: 'Plan review' })).toHaveLength(1);
expect(within(region).getByText('3 changes · 2 assets selected')).toBeInTheDocument();
await waitFor(() =>
  expect(onSelectionChange).toHaveBeenLastCalledWith({
    planId,
    operationIds: [createId, addId, existingId],
  }),
);
```

Add a new test after it:

```ts
it('reveals technical operation identifiers only inside the row details disclosure', async () => {
  sdkMock.getCurrentOperationPlan.mockResolvedValue(samplePlan());

  render(AgentOperationPlanReviewPanel, { props: { session } });

  const region = await screen.findByRole('region', { name: 'Plan review' });
  expect(within(region).queryByText(addId)).not.toBeInTheDocument();

  await fireEvent.click(within(region).getAllByText('Details')[1]);

  expect(within(region).getByText('Operation ID')).toBeInTheDocument();
  expect(within(region).getByText(addId)).toBeInTheDocument();
});
```

Update existing checkbox/button queries in the file:

```ts
// Old labels -> New labels
'Create Portugal album' -> 'Create album "Portugal"'
'Add two assets' -> 'Add 2 photos'
'Update existing album description' -> 'Update album details'
'New album "Portugal"' group toggle -> 'Select destination Portugal'
```

Keep the apply payload assertions unchanged.

- [ ] **Step 2: Run the focused panel tests and verify RED**

Run:

```bash
pnpm --dir web test --run "src/routes/(user)/assistant/agent-operation-plan-review-panel.spec.ts"
```

Expected: FAIL until the panel renders the new Evidence Ledger shell.

- [ ] **Step 3: Add English translations**

In `i18n/en.json`, add these keys near the existing assistant operation keys:

```json
"assistant_operation_apply_summary": "{changes, plural, one {# change} other {# changes}} · {assets, plural, one {# asset} other {# assets}} selected",
"assistant_operation_destination_selected_summary": "{selected, number} of {total, number} changes selected",
"assistant_operation_destination_toggle": "Select destination {name}",
"assistant_operation_detail_id": "Operation ID",
"assistant_operation_detail_risk": "Risk",
"assistant_operation_detail_status": "Status",
"assistant_operation_detail_toggle": "Details",
"assistant_operation_detail_type": "Type",
"assistant_operation_plan_destination_count": "{count, plural, one {# destination} other {# destinations}}",
"assistant_operation_plan_no_destructive_changes": "No photos will be deleted",
"assistant_operation_plan_selected_asset_count": "{count, plural, one {# selected asset} other {# selected assets}}",
"assistant_operation_plan_selected_change_count": "{count, plural, one {# selected change} other {# selected changes}}",
```

- [ ] **Step 4: Replace inline panel markup with `AgentPlanEvidenceLedger`**

In `web/src/routes/(user)/assistant/agent-operation-plan-review-panel.svelte`:

Remove the unused imports:

```ts
AgentOperationStatus,
Button,
type OperationReviewGroup,
```

Add:

```ts
import AgentPlanEvidenceLedger from './agent-plan-evidence-ledger.svelte';
```

Also add `buildOperationReviewImpactSummary` to the existing import list from `./agent-operation-plan-ui`.

Remove `cardBodyClass`, `getGroupSelectionState`, and `setMixedCheckbox` from the script because those move into child components.

Do not render two visible `Plan review` headers after expansion. The outer panel `<summary>` is the plan header, so it owns the title, plain-language summary, and compact impact chips. The embedded ledger should receive `showHeader={false}`.

Replace the `{:else}` block from the `<section ...>` body with:

```svelte
{:else}
  {@const impact = buildOperationReviewImpactSummary(model)}
  <section class={rootClass} aria-label={$t('assistant_operation_plan_review')}>
    <details class={cardClass} bind:open={planExpanded}>
      <summary class={headerClass}>
        <div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 class="text-lg font-semibold">{$t('assistant_operation_plan_review')}</h2>
            <p class="mt-1 text-sm text-gray-600 dark:text-gray-300">{model.plan.summary}</p>
            <div class="mt-2 flex flex-wrap gap-2 text-sm text-gray-500 dark:text-gray-400">
              <span class="rounded-md bg-gray-100 px-2 py-1 dark:bg-gray-800">
                {$t('assistant_operation_plan_destination_count', { values: { count: impact.destinationCount } })}
              </span>
              <span class="rounded-md bg-gray-100 px-2 py-1 dark:bg-gray-800">
                {$t('assistant_operation_plan_selected_change_count', {
                  values: { count: impact.selectedOperationCount },
                })}
              </span>
              <span class="rounded-md bg-gray-100 px-2 py-1 dark:bg-gray-800">
                {$t('assistant_operation_plan_selected_asset_count', { values: { count: impact.selectedAssetCount } })}
              </span>
            </div>
          </div>
          <div class="text-sm font-medium text-gray-600 dark:text-gray-300">
            {$t('assistant_operation_selected_count', { values: { count: selectedOperationIds.length } })}
          </div>
        </div>
      </summary>

      {#if planExpanded}
        <div class={variant === 'dock' ? 'px-4 pb-4' : ''}>
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
            onApply={applySelectedOperations}
          />
        </div>
      {/if}
    </details>
  </section>
{/if}
```

Preserve the outer `<details>` behavior because existing tests cover collapse and dock mode. Do not move loading/error/empty behavior out of the panel in this slice.

- [ ] **Step 5: Run the panel tests and verify GREEN**

Run:

```bash
pnpm --dir web test --run "src/routes/(user)/assistant/agent-operation-plan-review-panel.spec.ts"
```

Expected: PASS.

- [ ] **Step 6: Commit this task**

```bash
git add i18n/en.json web/src/routes/\(user\)/assistant/agent-operation-plan-review-panel.svelte web/src/routes/\(user\)/assistant/agent-operation-plan-review-panel.spec.ts
git commit -m "feat: render pi plan evidence ledger"
```

---

### Task 6: Update The Browser Flow Coverage

**Files:**

- Modify: `e2e/src/specs/web/assistant-album-organizer.e2e-spec.ts`

- [ ] **Step 1: Write the failing browser assertions**

In `e2e/src/specs/web/assistant-album-organizer.e2e-spec.ts`, update the happy-path plan preview assertions after the deterministic runner proposes the plan:

```ts
await expect(page.getByText('I proposed a Portugal Trip album.')).toBeVisible({ timeout: 10_000 });
await expect(page.getByRole('heading', { name: 'Plan review' })).toBeVisible();
await expect(page.getByText('Create Portugal Trip and add 2 loose assets.')).toBeVisible();
await expect(page.getByText('1 destination')).toBeVisible();
await expect(page.getByText('3 selected changes')).toBeVisible();
await expect(page.getByRole('region', { name: 'Portugal Trip' })).toBeVisible();
await expect(page.getByText('New album')).toBeVisible();
await expect(page.getByLabel('Create album "Portugal Trip"')).toBeChecked();
await expect(page.getByLabel('Add 2 photos')).toBeChecked();
await expect(page.getByLabel('Set cover photo')).toBeChecked();
```

Then assert the old technical-facing labels are gone:

```ts
await expect(page.getByText('Create Portugal Trip', { exact: true })).toHaveCount(0);
await expect(page.getByText('Add selected photos to Portugal Trip')).toHaveCount(0);
await expect(page.getByText('Use first photo as Portugal Trip cover')).toHaveCount(0);
```

After the plan is visible, fetch the current plan through the SDK and assert raw operation IDs are hidden until details are expanded:

```ts
const currentPlan = await getCurrentOperationPlan({ id: session.id }, authOptions(admin.accessToken));
if (!currentPlan) {
  throw new Error('Expected the runner to create an operation plan');
}
const addOperation = currentPlan.operations.find((operation) => operation.type === AgentOperationType.AlbumAddAssets);
expect(addOperation?.id).toEqual(expect.any(String));

await expect(page.getByText(addOperation!.id)).toHaveCount(0);
await page.getByText('Details').nth(1).click();
await expect(page.getByText(addOperation!.id)).toBeVisible();
```

Update the toggle step to use the human-facing row label:

```ts
await page.getByLabel('Set cover photo').uncheck();
await expect(page.getByRole('button', { name: 'Apply 2 selected' })).toBeEnabled();
```

Keep the existing apply response assertion and album verification unchanged. This preserves the key end-to-end behavior: selection is still operation based and the apply request still excludes the unchecked operation.

- [ ] **Step 2: Run the E2E spec and verify RED**

Run:

```bash
pnpm --dir e2e test:web -- assistant-album-organizer.e2e-spec.ts
```

Expected: FAIL until the new Evidence Ledger shell is wired into the browser flow.

- [ ] **Step 3: Implement only the E2E expectation updates needed for Slice 2**

Do not add thumbnail assertions in this slice. Slice 3 owns representative thumbnail rendering and large-plan thumbnail behavior.

- [ ] **Step 4: Run the E2E spec and verify GREEN**

Run:

```bash
pnpm --dir e2e test:web -- assistant-album-organizer.e2e-spec.ts
```

Expected: PASS.

- [ ] **Step 5: Commit this task**

```bash
git add e2e/src/specs/web/assistant-album-organizer.e2e-spec.ts
git commit -m "test: cover pi plan evidence ledger browser flow"
```

---

### Task 7: Run Slice Verification

**Files:**

- Verify: `web/src/routes/(user)/assistant/agent-operation-plan-ui.spec.ts`
- Verify: `web/src/routes/(user)/assistant/agent-plan-operation-row.spec.ts`
- Verify: `web/src/routes/(user)/assistant/agent-plan-destination-card.spec.ts`
- Verify: `web/src/routes/(user)/assistant/agent-plan-evidence-ledger.spec.ts`
- Verify: `web/src/routes/(user)/assistant/agent-operation-plan-review-panel.spec.ts`
- Verify: `web/src/routes/(user)/assistant/agent-session-action-dock.spec.ts`
- Verify: `e2e/src/specs/web/assistant-album-organizer.e2e-spec.ts`
- Verify: web TypeScript
- Verify: web Svelte check

- [ ] **Step 1: Run all Slice 2 unit/component tests**

Run:

```bash
pnpm --dir web test --run \
  "src/routes/(user)/assistant/agent-operation-plan-ui.spec.ts" \
  "src/routes/(user)/assistant/agent-plan-operation-row.spec.ts" \
  "src/routes/(user)/assistant/agent-plan-destination-card.spec.ts" \
  "src/routes/(user)/assistant/agent-plan-evidence-ledger.spec.ts" \
  "src/routes/(user)/assistant/agent-operation-plan-review-panel.spec.ts" \
  "src/routes/(user)/assistant/agent-session-action-dock.spec.ts"
```

Expected: all listed test files pass.

- [ ] **Step 2: Run the browser E2E flow**

Run:

```bash
pnpm --dir e2e test:web -- assistant-album-organizer.e2e-spec.ts
```

Expected: the updated Assistant album organizer browser flow passes.

- [ ] **Step 3: Run TypeScript**

Run:

```bash
pnpm --dir web check:typescript
```

Expected: TypeScript exits 0.

- [ ] **Step 4: Run Svelte check**

Run:

```bash
pnpm --dir web check:svelte
```

Expected: Svelte check exits 0.

- [ ] **Step 5: Run formatting check for changed files**

Run:

```bash
pnpm --dir web exec prettier --check \
  "src/routes/(user)/assistant/agent-operation-plan-ui.ts" \
  "src/routes/(user)/assistant/agent-operation-plan-ui.spec.ts" \
  "src/routes/(user)/assistant/agent-plan-operation-row.svelte" \
  "src/routes/(user)/assistant/agent-plan-operation-row.spec.ts" \
  "src/routes/(user)/assistant/agent-plan-destination-card.svelte" \
  "src/routes/(user)/assistant/agent-plan-destination-card.spec.ts" \
  "src/routes/(user)/assistant/agent-plan-apply-bar.svelte" \
  "src/routes/(user)/assistant/agent-plan-evidence-ledger.svelte" \
  "src/routes/(user)/assistant/agent-plan-evidence-ledger.spec.ts" \
  "src/routes/(user)/assistant/agent-operation-plan-review-panel.svelte" \
  "src/routes/(user)/assistant/agent-operation-plan-review-panel.spec.ts" \
  "../i18n/en.json"
pnpm --dir e2e exec prettier --check "src/specs/web/assistant-album-organizer.e2e-spec.ts"
```

Expected: Prettier exits 0.

- [ ] **Step 6: Commit verification-only fixes if needed**

If verification exposes type, Svelte, formatting, or compatibility fixes, apply the smallest fix and commit it:

```bash
git add i18n/en.json web/src/routes/\(user\)/assistant/agent-operation-plan-ui.ts web/src/routes/\(user\)/assistant/agent-operation-plan-ui.spec.ts web/src/routes/\(user\)/assistant/agent-plan-operation-row.svelte web/src/routes/\(user\)/assistant/agent-plan-operation-row.spec.ts web/src/routes/\(user\)/assistant/agent-plan-destination-card.svelte web/src/routes/\(user\)/assistant/agent-plan-destination-card.spec.ts web/src/routes/\(user\)/assistant/agent-plan-apply-bar.svelte web/src/routes/\(user\)/assistant/agent-plan-evidence-ledger.svelte web/src/routes/\(user\)/assistant/agent-plan-evidence-ledger.spec.ts web/src/routes/\(user\)/assistant/agent-operation-plan-review-panel.svelte web/src/routes/\(user\)/assistant/agent-operation-plan-review-panel.spec.ts e2e/src/specs/web/assistant-album-organizer.e2e-spec.ts
git commit -m "fix: verify pi plan evidence ledger shell"
```

If no fixes were needed, do not create an empty commit.

---

## Final Acceptance Checklist

- [ ] Evidence Ledger shell renders inside `AgentOperationPlanReviewPanel`.
- [ ] Destination cards render destination title, destination subtitle, selected/total operation count, and asset count.
- [ ] Operation rows render `item.review.summary`, not raw operation summaries.
- [ ] Operation IDs, raw target IDs, raw operation summaries, raw payloads, and DTO-shaped labels are hidden by default.
- [ ] Operation IDs are visible only after expanding row details.
- [ ] Expanded panel does not duplicate the `Plan review` header inside the embedded ledger.
- [ ] Operation-level toggles and destination-level toggles still update selection state.
- [ ] Mixed destination checkbox state is accessible with `aria-checked="mixed"`.
- [ ] Sticky apply bar shows selected change/asset counts and keeps the legacy apply button behavior.
- [ ] Existing apply request still sends `{ operationIds }`.
- [ ] Browser E2E covers the destination-card review flow, hidden technical details, operation toggle, and apply behavior.
- [ ] Existing loading, empty, error, success, websocket refresh, collapse, dock mode, and read-only applied states still work.
- [ ] No thumbnails, item-level selection, sparse apply payload, inline overrides, or server API changes were introduced.
- [ ] All Slice 2 test files pass.
- [ ] `pnpm --dir web check:typescript` passes.
- [ ] `pnpm --dir web check:svelte` passes.
