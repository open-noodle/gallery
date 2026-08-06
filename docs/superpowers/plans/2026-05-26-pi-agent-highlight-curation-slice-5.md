# Pi Agent Highlight Curation Slice 5 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make highlight curation criteria visible in the existing photo-first plan review UI and preserve sparse apply behavior for user-edited highlight selections.

**Architecture:** Reuse the existing agent operation plan review model, destination cards, thumbnail strip, photo review modal, and sparse `itemSelections` apply payload. Add a small derived `curationCriteria` field for highlight groups, render it in the destination card, and add focused regression tests for selected count, thumbnails, review controls, and sparse apply.

**Tech Stack:** Svelte 5, Vitest, Testing Library Svelte, existing Gallery agent operation plan DTOs.

---

## Scope Boundaries

This plan implements only Slice 5 from `docs/superpowers/specs/2026-05-26-pi-agent-highlight-curation-design.md`.

In scope:

- Show bounded highlight curation criteria in the existing plan review surface.
- Keep the current photo-first destination card stage as the approval surface.
- Keep the existing `Review photos` modal as the per-item inclusion/exclusion control.
- Add highlight-specific sparse apply coverage proving excluded suggested highlight assets are sent as `itemSelections`.
- Add English i18n for the new criteria label.

Out of scope:

- No new curation wizard.
- No new server operation type or DTO field.
- No new image scoring, duplicate clustering, `analyzeAssetQuality`, or original reads.
- No Slice 6 capability matrix, acceptance E2E, or docs completion.

## Current Codebase Notes

The existing UI already satisfies most Slice 5 behavior:

- `web/src/routes/(user)/assistant/agent-plan-photo-stage.svelte` shows selected count, thumbnails, and `Review photos`.
- `web/src/routes/(user)/assistant/agent-plan-photo-review-modal.svelte` and `agent-plan-item-review.svelte` support excluding selected assets.
- `web/src/routes/(user)/assistant/agent-operation-plan-review-panel.svelte` sends sparse `itemSelections` to `applyApprovedOperations`.
- Existing tests cover generic sparse apply and large virtualized selections.

The missing user-facing behavior is criteria visibility for highlight plans. The review model currently derives human row summaries such as `Add 2 photos` and hides raw operation summaries, so criteria like `metadata-only suggested highlights prioritized existing favorites...` can be lost unless the plan-level summary is read.

## Files

- Modify: `web/src/routes/(user)/assistant/agent-operation-plan-ui.ts`
  - Add `curationCriteria?: string` to `OperationReviewGroup`.
  - Derive highlight criteria from the plan or operation summaries only when a group contains a suggested-highlight operation.
- Modify: `web/src/routes/(user)/assistant/agent-operation-plan-ui.spec.ts`
  - Add a failing model test for criteria extraction.
- Modify: `web/src/routes/(user)/assistant/agent-plan-destination-card.svelte`
  - Render the group curation criteria below the destination subtitle.
- Modify: `web/src/routes/(user)/assistant/agent-plan-destination-card.spec.ts`
  - Add a failing component test that criteria text is visible alongside selected count and thumbnails.
- Modify: `web/src/routes/(user)/assistant/agent-operation-plan-review-panel.spec.ts`
  - Add a highlight-specific sparse apply regression test.
- Modify: `web/src/routes/(user)/assistant/agent-operation-plan-i18n.spec.ts`
  - Assert the new English key exists.
- Modify: `i18n/en.json`
  - Add `assistant_operation_curation_criteria`.

## Task 1: Add Red Criteria Visibility Tests

**Files:**

- Modify: `web/src/routes/(user)/assistant/agent-operation-plan-ui.spec.ts`
- Modify: `web/src/routes/(user)/assistant/agent-plan-destination-card.spec.ts`
- Modify: `web/src/routes/(user)/assistant/agent-operation-plan-i18n.spec.ts`
- Test: `web/src/routes/(user)/assistant/agent-operation-plan-ui.spec.ts`
- Test: `web/src/routes/(user)/assistant/agent-plan-destination-card.spec.ts`
- Test: `web/src/routes/(user)/assistant/agent-operation-plan-i18n.spec.ts`

- [ ] **Step 1: Add the review-model criteria extraction test**

In `agent-operation-plan-ui.spec.ts`, add this test near the other `buildOperationReviewModel` summary tests:

```ts
it('extracts highlight curation criteria from suggested-highlight plan summaries', () => {
  const model = buildOperationReviewModel(
    {
      ...plan([
        operation({
          id: createId,
          type: AgentOperationType.AlbumCreate,
          summary: 'Create Highlights',
          targetKind: AgentOperationTargetKind.NewAlbum,
          temporaryTargetId: 'album-highlights',
          payload: { albumName: 'Highlights' },
        }),
        operation({
          id: addId,
          type: AgentOperationType.AlbumAddAssets,
          summary: 'Add 2 preview-assisted suggested highlights to Highlights.',
          targetKind: AgentOperationTargetKind.NewAlbum,
          temporaryTargetId: 'album-highlights',
          assetIds: [assetA, assetB],
          dependencyIds: [createId],
          payload: {},
        }),
      ]),
      summary:
        'Create Highlights with 2 preview-assisted suggested highlights considered previews, existing favorites, ratings, dates, tags, and location.',
    },
    { [createId]: true, [addId]: true },
  );

  expect(model.groups[0].curationCriteria).toBe(
    'Preview-assisted suggested highlights considered previews, existing favorites, ratings, dates, tags, and location.',
  );
});
```

- [ ] **Step 2: Add the destination card visible criteria test**

In `agent-plan-destination-card.spec.ts`, add the i18n mock key:

```ts
    assistant_operation_curation_criteria: 'Criteria: {criteria}',
```

Also add `.replace('{criteria}', String(options?.values?.criteria ?? ''))` to the mock formatter.

Add this helper after `group()`:

```ts
const highlightGroup = () =>
  buildOperationReviewModel(
    {
      ...plan([
        operation({
          id: createId,
          type: AgentOperationType.AlbumCreate,
          summary: 'Create Highlights',
          targetKind: AgentOperationTargetKind.NewAlbum,
          temporaryTargetId: 'album-highlights',
          payload: { albumName: 'Highlights' },
        }),
        operation({
          id: addId,
          type: AgentOperationType.AlbumAddAssets,
          summary: 'Add 2 metadata-only suggested highlights to Highlights.',
          targetKind: AgentOperationTargetKind.NewAlbum,
          temporaryTargetId: 'album-highlights',
          assetIds: [assetA, assetB],
          dependencyIds: [createId],
          payload: {},
        }),
      ]),
      summary:
        'Create Highlights with 2 metadata-only suggested highlights prioritized existing favorites, ratings, dates, tags, and location; no previews were inspected.',
    },
    { [createId]: true, [addId]: true },
  ).groups[0];
```

Add this test:

```ts
it('shows highlight curation criteria with selected count and thumbnails', () => {
  render(AgentPlanDestinationCard, {
    props: {
      group: highlightGroup(),
      canChangeSelection: true,
      onToggleGroup: vi.fn(),
      onToggleOperation: vi.fn(),
      onSetFieldOverride: vi.fn(),
      onResetFieldOverride: vi.fn(),
    },
  });

  const destinationRegion = screen.getByRole('region', { name: 'Highlights' });
  expect(
    within(destinationRegion).getByText(/Criteria: Metadata-only suggested highlights prioritized/i),
  ).toBeInTheDocument();
  expect(within(destinationRegion).getByText(/no previews were inspected/i)).toBeInTheDocument();
  expect(within(destinationRegion).getByText('2 selected trip photos')).toBeInTheDocument();
  expect(within(destinationRegion).getByRole('button', { name: 'Review photos' })).toBeInTheDocument();
  expect(within(destinationRegion).getByTestId('agent-plan-thumbnail-strip')).toBeInTheDocument();
});
```

- [ ] **Step 3: Add the i18n key assertion**

In `agent-operation-plan-i18n.spec.ts`, add a dedicated plan-review copy test near the other operation-plan i18n tests:

```ts
it('defines curation criteria English copy for highlight plan review', () => {
  expect(en).toEqual(
    expect.objectContaining({
      assistant_operation_curation_criteria: 'Criteria: {criteria}',
    }),
  );
});
```

- [ ] **Step 4: Run the focused tests and verify red**

Run:

```bash
pnpm --dir web test -- --run 'src/routes/(user)/assistant/agent-operation-plan-ui.spec.ts' 'src/routes/(user)/assistant/agent-plan-destination-card.spec.ts' 'src/routes/(user)/assistant/agent-operation-plan-i18n.spec.ts'
```

Expected: FAIL. The model test should fail because `OperationReviewGroup` has no `curationCriteria`; the destination card test should fail because criteria is not rendered; the i18n test should fail until `i18n/en.json` is updated.

## Task 2: Implement Criteria Extraction In The Review Model

**Files:**

- Modify: `web/src/routes/(user)/assistant/agent-operation-plan-ui.ts`
- Test: `web/src/routes/(user)/assistant/agent-operation-plan-ui.spec.ts`

- [ ] **Step 1: Add the group field**

In `OperationReviewGroup`, add:

```ts
  curationCriteria?: string;
```

- [ ] **Step 2: Add helper functions near `getGroupTitle()`**

Add:

```ts
const highlightCriteriaPattern =
  /\b((?:metadata-only|preview-assisted) suggested highlights? (?:prioritized|prioritizing|considered) [^.]+)(?:\.|$)/i;

const normalizeCriteriaSentence = (criteria: string) => {
  const normalized = criteria.trim().replace(/\s+/g, ' ');
  return `${normalized.charAt(0).toUpperCase()}${normalized.slice(1).replace(/\.$/, '')}.`;
};

const getHighlightCurationCriteria = (summaries: string[]) => {
  for (const summary of summaries) {
    const match = summary.match(highlightCriteriaPattern);
    if (match?.[1]) {
      return normalizeCriteriaSentence(match[1]);
    }
  }
};

const groupHasSuggestedHighlights = (operations: OperationReviewItem[]) =>
  operations.some(({ operation }) => /\bsuggested highlights?\b/i.test(operation.summary));
```

- [ ] **Step 3: Attach criteria when building groups**

Inside the `for (const item of items)` grouping loop, after:

```ts
const operations = [...group.operations, item];
```

add:

```ts
const curationCriteria = groupHasSuggestedHighlights(operations)
  ? (group.curationCriteria ??
    getHighlightCurationCriteria([model.plan.summary, ...operations.map(({ operation }) => operation.summary)]))
  : undefined;
```

Because this code is inside `buildOperationReviewModel`, use `plan.summary`, not `model.plan.summary`:

```ts
const curationCriteria = groupHasSuggestedHighlights(operations)
  ? (group.curationCriteria ??
    getHighlightCurationCriteria([plan.summary, ...operations.map(({ operation }) => operation.summary)]))
  : undefined;
```

Add `curationCriteria` to the object passed to `groupsById.set()`:

```ts
      curationCriteria,
```

Also set the initial group shape to include:

```ts
      curationCriteria: undefined,
```

- [ ] **Step 4: Run the model test and verify green for model behavior**

Run:

```bash
pnpm --dir web test -- --run 'src/routes/(user)/assistant/agent-operation-plan-ui.spec.ts'
```

Expected: PASS for `agent-operation-plan-ui.spec.ts`.

## Task 3: Render Criteria In The Existing Destination Card

**Files:**

- Modify: `web/src/routes/(user)/assistant/agent-plan-destination-card.svelte`
- Modify: `i18n/en.json`
- Test: `web/src/routes/(user)/assistant/agent-plan-destination-card.spec.ts`
- Test: `web/src/routes/(user)/assistant/agent-operation-plan-i18n.spec.ts`

- [ ] **Step 1: Add English i18n**

In `i18n/en.json`, add near the other `assistant_operation_*` review keys:

```json
  "assistant_operation_curation_criteria": "Criteria: {criteria}",
```

- [ ] **Step 2: Render the criteria text**

In `agent-plan-destination-card.svelte`, below the destination subtitle block:

```svelte
        {#if group.curationCriteria}
          <p
            class="mt-2 break-words text-sm text-gray-600 dark:text-gray-300"
            data-testid="agent-plan-curation-criteria"
          >
            {$t('assistant_operation_curation_criteria', { values: { criteria: group.curationCriteria } })}
          </p>
        {/if}
```

- [ ] **Step 3: Run destination and i18n tests**

Run:

```bash
pnpm --dir web test -- --run 'src/routes/(user)/assistant/agent-plan-destination-card.spec.ts' 'src/routes/(user)/assistant/agent-operation-plan-i18n.spec.ts'
```

Expected: PASS.

## Task 4: Add Highlight-Specific Sparse Apply Regression

**Files:**

- Modify: `web/src/routes/(user)/assistant/agent-operation-plan-review-panel.spec.ts`
- Test: `web/src/routes/(user)/assistant/agent-operation-plan-review-panel.spec.ts`

- [ ] **Step 1: Add one more asset ID fixture**

Near `assetA` and `assetB`, add:

```ts
const assetC = '00000000-0000-4000-8000-000000000203';
```

- [ ] **Step 2: Add a highlight plan fixture**

After `samplePlan()`, add:

```ts
const highlightPlan = () =>
  plan(
    [
      operation({
        id: createId,
        type: AgentOperationType.AlbumCreate,
        summary: 'Create Highlights',
        targetKind: AgentOperationTargetKind.NewAlbum,
        temporaryTargetId: 'album-highlights',
        payload: { albumName: 'Highlights', description: 'Suggested highlights selected from metadata signals.' },
      }),
      operation({
        id: addId,
        type: AgentOperationType.AlbumAddAssets,
        summary: 'Add 3 metadata-only suggested highlights to Highlights.',
        targetKind: AgentOperationTargetKind.NewAlbum,
        temporaryTargetId: 'album-highlights',
        assetIds: [assetA, assetB, assetC],
        dependencyIds: [createId],
        payload: {},
      }),
    ],
    1,
    'Create Highlights with 3 metadata-only suggested highlights prioritized existing favorites, ratings, dates, tags, and location; no previews were inspected.',
  );
```

This requires changing the local `plan()` helper signature from:

```ts
const plan = (operations: AgentOperationResponseDto[], revision = 1): AgentOperationPlanResponseDto => ({
```

to:

```ts
const plan = (
  operations: AgentOperationResponseDto[],
  revision = 1,
  summary = 'Organize Portugal holiday',
): AgentOperationPlanResponseDto => ({
```

and replacing the hardcoded `summary: 'Organize Portugal holiday',` with `summary,`.

- [ ] **Step 3: Add mock i18n key support**

In the `svelte-i18n` mock messages in `agent-operation-plan-review-panel.spec.ts`, add:

```ts
    assistant_operation_curation_criteria: 'Criteria: {criteria}',
```

and add:

```ts
        .replace('{criteria}', String(options?.values?.criteria ?? ''))
```

to the formatter chain.

- [ ] **Step 4: Add the highlight sparse apply test**

Add this test near the existing sparse item selection tests:

```ts
it('applies sparse user exclusions to a suggested highlight album plan', async () => {
  sdkMock.getCurrentOperationPlan.mockResolvedValue(highlightPlan());
  sdkMock.applyApprovedOperations.mockResolvedValue({
    status: AgentOperationApplyStatus.Applied,
    plan: appliedPlan(),
    appliedOperationIds: [createId, addId],
    skippedOperationIds: [],
    failedOperationIds: [],
    summary: 'Applied 2 operation(s), skipped 0, failed 0.',
  });

  render(AgentOperationPlanReviewPanel, { props: { session } });

  const region = await screen.findByRole('region', { name: 'Plan review' });
  expect(within(region).getByText(/Criteria: Metadata-only suggested highlights prioritized/i)).toBeInTheDocument();
  expect(within(region).getByText('3 selected trip photos')).toBeInTheDocument();
  expect(within(region).getByTestId('agent-plan-thumbnail-strip')).toBeInTheDocument();

  await fireEvent.click(within(region).getByRole('button', { name: 'Review photos' }));
  const dialog = screen.getByRole('dialog', { name: 'Review photos for Add 3 photos' });
  await fireEvent.click(within(dialog).getByRole('checkbox', { name: 'Include photo 2' }));
  await fireEvent.click(within(dialog).getByRole('button', { name: 'Done reviewing' }));

  expect(screen.getAllByText('2 of 3 photos selected')).toHaveLength(2);
  expect(screen.getByText('2 changes · 2 assets selected')).toBeInTheDocument();

  await fireEvent.click(screen.getByRole('button', { name: 'Apply 2 selected' }));

  expect(sdkMock.applyApprovedOperations).toHaveBeenCalledWith({
    id: session.id,
    planId,
    agentOperationPlanApplyRequestDto: {
      operationIds: [createId, addId],
      itemSelections: {
        [addId]: { itemKind: 'asset', mode: 'allExcept', itemIds: [assetB] },
      },
      planRevision: 1,
    },
  });
});
```

- [ ] **Step 5: Run the review panel test**

Run:

```bash
pnpm --dir web test -- --run 'src/routes/(user)/assistant/agent-operation-plan-review-panel.spec.ts'
```

Expected: PASS.

## Task 5: Focused Verification And Commit

**Files:**

- Test: `web/src/routes/(user)/assistant/agent-operation-plan-ui.spec.ts`
- Test: `web/src/routes/(user)/assistant/agent-plan-destination-card.spec.ts`
- Test: `web/src/routes/(user)/assistant/agent-operation-plan-review-panel.spec.ts`
- Test: `web/src/routes/(user)/assistant/agent-operation-plan-i18n.spec.ts`

- [ ] **Step 1: Run focused web tests**

Run:

```bash
pnpm --dir web test -- --run 'src/routes/(user)/assistant/agent-operation-plan-ui.spec.ts' 'src/routes/(user)/assistant/agent-plan-destination-card.spec.ts' 'src/routes/(user)/assistant/agent-operation-plan-review-panel.spec.ts' 'src/routes/(user)/assistant/agent-operation-plan-i18n.spec.ts'
```

Expected: PASS.

- [ ] **Step 2: Run TypeScript verification**

Run:

```bash
pnpm --dir web check:typescript
```

Expected: PASS.

- [ ] **Step 3: Run diff whitespace checks**

Run:

```bash
git diff --check
```

Expected: no output.

- [ ] **Step 4: Inspect final diff for scope creep**

Run:

```bash
git diff -- web/src/routes/'(user)'/assistant/agent-operation-plan-ui.ts web/src/routes/'(user)'/assistant/agent-operation-plan-ui.spec.ts web/src/routes/'(user)'/assistant/agent-plan-destination-card.svelte web/src/routes/'(user)'/assistant/agent-plan-destination-card.spec.ts web/src/routes/'(user)'/assistant/agent-operation-plan-review-panel.spec.ts web/src/routes/'(user)'/assistant/agent-operation-plan-i18n.spec.ts i18n/en.json docs/superpowers/plans/2026-05-26-pi-agent-highlight-curation-slice-5.md
```

Expected:

- Criteria is derived only for groups whose operations mention suggested highlights.
- Existing generic operation summaries remain hidden unless they are criteria text.
- Destination cards show selected count, thumbnails, review controls, and criteria for highlight groups.
- Sparse apply payloads still use `itemSelections` and do not eagerly expand selected IDs.
- No new curation wizard, server DTO, E2E, capability matrix, or quality scoring work is present.

- [ ] **Step 5: Commit**

Run:

```bash
git status --short
git add web/src/routes/'(user)'/assistant/agent-operation-plan-ui.ts web/src/routes/'(user)'/assistant/agent-operation-plan-ui.spec.ts web/src/routes/'(user)'/assistant/agent-plan-destination-card.svelte web/src/routes/'(user)'/assistant/agent-plan-destination-card.spec.ts web/src/routes/'(user)'/assistant/agent-operation-plan-review-panel.spec.ts web/src/routes/'(user)'/assistant/agent-operation-plan-i18n.spec.ts i18n/en.json docs/superpowers/plans/2026-05-26-pi-agent-highlight-curation-slice-5.md
git commit -m "feat: surface highlight curation review criteria"
```

Expected: commit succeeds.

## Self-Review Checklist

- Highlight criteria is visible in the existing plan review UI.
- Selected count and thumbnails remain visible for highlight album plans.
- `Review photos` still opens the existing photo review modal.
- Excluding a suggested highlight before apply sends sparse `itemSelections`.
- Existing sparse-selection tests still pass.
- No new curation wizard or server schema is added.
- No Slice 6 capability matrix/docs/E2E work is included.
