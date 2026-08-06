# Pi Agent Visual Plan Review Slice 3 Representative Thumbnails Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render bounded representative photo thumbnails in Pi plan destination cards, including overflow counts and per-thumbnail failure fallback, without rendering every affected photo.

**Architecture:** Keep `AgentOperationPlanReviewPanel` and `AgentPlanEvidenceLedger` unchanged as containers. Add a small thumbnail-strip view-model helper in `agent-operation-plan-ui.ts`, create a focused `AgentPlanThumbnailStrip` component, and compose it inside `AgentPlanDestinationCard` using the Slice 1 `group.thumbnailSummary` contract. The strip renders at most a bounded number of images from `representativeAssetIds`, shows a final overflow tile, and keeps no-preview/failure states local to the strip.

**Tech Stack:** Svelte 5, TypeScript, Svelte Testing Library, Vitest, Playwright E2E through CI, Tailwind utility classes, existing `@immich/sdk` `AssetMediaSize`, existing `$lib/utils.getAssetMediaUrl`.

---

## Scope

Implement Slice 3 from `docs/superpowers/specs/2026-05-17-pi-agent-visual-plan-review-design.md`.

This slice covers:

- Representative thumbnail strips in destination cards.
- Rendering 4-12 available representative thumbnails through a bounded helper, with a default of 6 thumbnails in the collapsed card.
- Overflow count tile such as `+830`.
- No-preview fallback when affected assets exist but no representative thumbnail IDs are available.
- Per-thumbnail load failure fallback that does not hide the rest of the strip or fail the whole plan card.
- Large-plan regression tests that prove the collapsed view does not render every affected asset.
- Browser-flow assertion that a generated Pi plan displays representative thumbnail elements.

This slice does not cover:

- Expanded item grids.
- Item-level include/exclude selection.
- Virtualization/windowing for expanded grids.
- Thumbnail prefetch queues, cancellation, or scroll-based lazy loading beyond native `loading="lazy"` for the bounded collapsed strip.
- Server DTO/API changes.
- Fetching asset metadata beyond the existing asset IDs in operation plans.

## Design Decisions

- Use `group.thumbnailSummary.representativeAssetIds` as the source of truth. Slice 1 already bounds this list at 12; Slice 3 adds a stricter collapsed-card display limit.
- Default visible thumbnail count is 6. The helper clamps caller-provided limits to `0..12`, preserving the design requirement that collapsed strips render only a small bounded amount of UI.
- Use raw asset IDs only to build thumbnail URLs and test IDs. Asset IDs must not be displayed as visible text.
- The overflow count is based on `group.thumbnailSummary.totalCount - renderedThumbnailCount`, not on the representative list length. A 1,000-photo operation with 6 rendered thumbnails therefore shows `+994`.
- If `totalCount > 0` but `representativeAssetIds` is empty, render a compact text fallback instead of an empty strip or a misleading `+N` tile.
- Keep the strip display-only. Selection state and item-level review are Slice 4+.
- Use CI as the source of truth for full browser tests. Component and unit tests still run locally for RED/GREEN TDD.

## File Structure

- Modify `web/src/routes/(user)/assistant/agent-operation-plan-ui.ts`
  - Add thumbnail strip constants.
  - Add `AgentPlanThumbnailStripModel`.
  - Add `buildAgentPlanThumbnailStrip(group, requestedLimit?)`.
- Modify `web/src/routes/(user)/assistant/agent-operation-plan-ui.spec.ts`
  - Add unit tests for bounded thumbnail model, overflow, no-preview fallback, zero limit, and large plans.
- Create `web/src/routes/(user)/assistant/agent-plan-thumbnail-strip.svelte`
  - Render the bounded thumbnail strip, overflow tile, no-preview fallback, and per-item error fallback.
- Create `web/src/routes/(user)/assistant/agent-plan-thumbnail-strip.spec.ts`
  - Cover rendering limit, overflow tile, no-preview state, partial image failure, zero affected photos, and hidden raw asset IDs.
- Modify `web/src/routes/(user)/assistant/agent-plan-destination-card.svelte`
  - Compose `AgentPlanThumbnailStrip` between the card header and operation rows.
- Modify `web/src/routes/(user)/assistant/agent-plan-destination-card.spec.ts`
  - Assert the card renders the thumbnail strip and still renders counts/toggles/operation rows.
- Modify `e2e/src/specs/web/assistant-album-organizer.e2e-spec.ts`
  - Assert the Pi browser flow shows representative thumbnail elements in the destination card.
- Modify `i18n/en.json`
  - Add thumbnail strip labels and fallback copy.

---

### Task 1: Add Thumbnail Strip View-Model Helper

**Files:**

- Modify: `web/src/routes/(user)/assistant/agent-operation-plan-ui.spec.ts`
- Modify: `web/src/routes/(user)/assistant/agent-operation-plan-ui.ts`

- [ ] **Step 1: Write the failing unit tests**

In `web/src/routes/(user)/assistant/agent-operation-plan-ui.spec.ts`, add these imports to the existing import list from `./agent-operation-plan-ui`:

```ts
import {
  AGENT_PLAN_THUMBNAIL_STRIP_DEFAULT_LIMIT,
  AGENT_PLAN_THUMBNAIL_STRIP_MAX_LIMIT,
  buildAgentPlanThumbnailStrip,
} from './agent-operation-plan-ui';
```

Add this helper near the existing test helpers:

```ts
const manyAssetIds = (count: number) =>
  Array.from({ length: count }, (_, index) => `asset-${String(index + 1).padStart(3, '0')}`);

const thumbnailGroup = (assetCount: number) =>
  buildOperationReviewModel(
    plan([
      operation({
        id: addId,
        type: AgentOperationType.AlbumAddAssets,
        summary: `Add ${assetCount} assets`,
        targetKind: AgentOperationTargetKind.NewAlbum,
        temporaryTargetId: 'album-portugal',
        assetIds: manyAssetIds(assetCount),
        payload: {},
      }),
    ]),
    { [addId]: true },
  ).groups[0];
```

Add these tests near the other view-model tests:

```ts
describe('buildAgentPlanThumbnailStrip', () => {
  it('returns a bounded collapsed thumbnail set and overflow count for large plans', () => {
    const strip = buildAgentPlanThumbnailStrip(thumbnailGroup(20), 4);

    expect(strip).toEqual({
      totalCount: 20,
      assetIds: ['asset-001', 'asset-002', 'asset-003', 'asset-004'],
      overflowCount: 16,
      hasMore: true,
      hasThumbnails: true,
    });
  });

  it('uses the default collapsed strip limit and never exceeds the maximum supported strip size', () => {
    const defaultStrip = buildAgentPlanThumbnailStrip(thumbnailGroup(20));
    const oversizedStrip = buildAgentPlanThumbnailStrip(thumbnailGroup(20), 200);

    expect(defaultStrip.assetIds).toHaveLength(AGENT_PLAN_THUMBNAIL_STRIP_DEFAULT_LIMIT);
    expect(oversizedStrip.assetIds).toHaveLength(AGENT_PLAN_THUMBNAIL_STRIP_MAX_LIMIT);
    expect(oversizedStrip.overflowCount).toBe(8);
  });

  it('handles zero and negative limits without rendering thumbnails', () => {
    expect(buildAgentPlanThumbnailStrip(thumbnailGroup(5), 0)).toEqual({
      totalCount: 5,
      assetIds: [],
      overflowCount: 0,
      hasMore: false,
      hasThumbnails: false,
    });

    expect(buildAgentPlanThumbnailStrip(thumbnailGroup(5), -4).assetIds).toHaveLength(0);
  });

  it('returns a no-preview model when assets exist but representative thumbnail IDs are unavailable', () => {
    const group = thumbnailGroup(7);
    const strip = buildAgentPlanThumbnailStrip(
      {
        ...group,
        representativeAssetIds: [],
        thumbnailSummary: {
          totalCount: 7,
          representativeAssetIds: [],
          hasMore: true,
        },
      },
      6,
    );

    expect(strip).toEqual({
      totalCount: 7,
      assetIds: [],
      overflowCount: 0,
      hasMore: false,
      hasThumbnails: false,
    });
  });
});
```

- [ ] **Step 2: Run the focused tests and verify RED**

Run:

```bash
pnpm --dir web test --run "src/routes/(user)/assistant/agent-operation-plan-ui.spec.ts" -t "buildAgentPlanThumbnailStrip"
```

Expected: FAIL because `AGENT_PLAN_THUMBNAIL_STRIP_DEFAULT_LIMIT`, `AGENT_PLAN_THUMBNAIL_STRIP_MAX_LIMIT`, and `buildAgentPlanThumbnailStrip` do not exist.

- [ ] **Step 3: Add the thumbnail strip model helper**

In `web/src/routes/(user)/assistant/agent-operation-plan-ui.ts`, add this type after `OperationReviewImpactSummary`:

```ts
export type AgentPlanThumbnailStripModel = {
  totalCount: number;
  assetIds: string[];
  overflowCount: number;
  hasMore: boolean;
  hasThumbnails: boolean;
};
```

Add these constants near `representativeAssetLimit`:

```ts
export const AGENT_PLAN_THUMBNAIL_STRIP_DEFAULT_LIMIT = 6;
export const AGENT_PLAN_THUMBNAIL_STRIP_MAX_LIMIT = 12;
```

Add this function after `buildOperationReviewImpactSummary`:

```ts
const normalizeThumbnailStripLimit = (requestedLimit: number) =>
  Math.min(AGENT_PLAN_THUMBNAIL_STRIP_MAX_LIMIT, Math.max(0, Math.floor(requestedLimit)));

export const buildAgentPlanThumbnailStrip = (
  group: OperationReviewGroup,
  requestedLimit = AGENT_PLAN_THUMBNAIL_STRIP_DEFAULT_LIMIT,
): AgentPlanThumbnailStripModel => {
  const visibleLimit = normalizeThumbnailStripLimit(requestedLimit);
  const totalCount = group.thumbnailSummary.totalCount;
  const assetIds = group.thumbnailSummary.representativeAssetIds.slice(0, visibleLimit);
  const overflowCount = assetIds.length > 0 ? Math.max(totalCount - assetIds.length, 0) : 0;

  return {
    totalCount,
    assetIds,
    overflowCount,
    hasMore: overflowCount > 0,
    hasThumbnails: assetIds.length > 0,
  };
};
```

- [ ] **Step 4: Run the focused tests and verify GREEN**

Run:

```bash
pnpm --dir web test --run "src/routes/(user)/assistant/agent-operation-plan-ui.spec.ts" -t "buildAgentPlanThumbnailStrip"
```

Expected: PASS.

- [ ] **Step 5: Run the full view-model spec**

Run:

```bash
pnpm --dir web test --run "src/routes/(user)/assistant/agent-operation-plan-ui.spec.ts"
```

Expected: PASS.

- [ ] **Step 6: Commit this task**

```bash
git add web/src/routes/\(user\)/assistant/agent-operation-plan-ui.ts web/src/routes/\(user\)/assistant/agent-operation-plan-ui.spec.ts
git commit -m "feat: model pi plan thumbnail strips"
```

---

### Task 2: Add Thumbnail Strip Component

**Files:**

- Create: `web/src/routes/(user)/assistant/agent-plan-thumbnail-strip.svelte`
- Create: `web/src/routes/(user)/assistant/agent-plan-thumbnail-strip.spec.ts`

- [ ] **Step 1: Write the failing component tests**

Create `web/src/routes/(user)/assistant/agent-plan-thumbnail-strip.spec.ts` with:

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
import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { readable } from 'svelte/store';
import { buildOperationReviewModel, type OperationReviewGroup } from './agent-operation-plan-ui';
import AgentPlanThumbnailStrip from './agent-plan-thumbnail-strip.svelte';

vi.mock('svelte-i18n', () => {
  const messages: Record<string, string> = {
    assistant_operation_thumbnail_alt: 'Photo preview {index} of {count}',
    assistant_operation_thumbnail_empty: '{count} photos without previews',
    assistant_operation_thumbnail_overflow: '+{count}',
    assistant_operation_thumbnail_overflow_label: '{count} more photos',
    assistant_operation_thumbnail_strip_label: '{count} photo previews',
    assistant_operation_thumbnail_unavailable: 'Preview unavailable',
  };

  return {
    t: readable((key: string, options?: { values?: Record<string, string | number> }) =>
      (messages[key] ?? key)
        .replace('{count}', String(options?.values?.count ?? ''))
        .replace('{index}', String(options?.values?.index ?? '')),
    ),
  };
});

const planId = '00000000-0000-4000-8000-000000000100';
const addId = '00000000-0000-4000-8000-000000000101';

const assetIds = (count: number) =>
  Array.from({ length: count }, (_, index) => `asset-${String(index + 1).padStart(3, '0')}`);

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

const group = (count: number) =>
  buildOperationReviewModel(
    plan([
      operation({
        id: addId,
        type: AgentOperationType.AlbumAddAssets,
        summary: `Add ${count} assets`,
        targetKind: AgentOperationTargetKind.NewAlbum,
        temporaryTargetId: 'album-portugal',
        assetIds: assetIds(count),
        payload: {},
      }),
    ]),
    { [addId]: true },
  ).groups[0];

const groupWithoutRepresentatives = (count: number): OperationReviewGroup => {
  const source = group(count);

  return {
    ...source,
    representativeAssetIds: [],
    thumbnailSummary: {
      totalCount: count,
      representativeAssetIds: [],
      hasMore: count > 0,
    },
  };
};

describe('AgentPlanThumbnailStrip', () => {
  it('renders a bounded thumbnail strip with overflow instead of every affected asset', () => {
    render(AgentPlanThumbnailStrip, {
      props: {
        group: group(20),
        maxVisible: 4,
      },
    });

    const strip = screen.getByTestId('agent-plan-thumbnail-strip');
    const images = within(strip).getAllByTestId('agent-plan-thumbnail-image');

    expect(strip).toHaveAttribute('aria-label', '20 photo previews');
    expect(images).toHaveLength(4);
    expect(images[0].getAttribute('src')).toContain('/api/assets/asset-001/thumbnail');
    expect(images[3].getAttribute('src')).toContain('/api/assets/asset-004/thumbnail');
    expect(within(strip).getByText('+16')).toBeInTheDocument();
    expect(within(strip).queryByAltText('Photo preview 5 of 20')).not.toBeInTheDocument();
    expect(screen.queryByText('asset-005')).not.toBeInTheDocument();
  });

  it('renders a compact no-preview fallback when affected assets have no representative thumbnail IDs', () => {
    render(AgentPlanThumbnailStrip, {
      props: {
        group: groupWithoutRepresentatives(7),
      },
    });

    expect(screen.getByText('7 photos without previews')).toBeInTheDocument();
    expect(screen.queryByTestId('agent-plan-thumbnail-image')).not.toBeInTheDocument();
    expect(screen.queryByText('+7')).not.toBeInTheDocument();
  });

  it('keeps the strip usable when one thumbnail fails to load', async () => {
    render(AgentPlanThumbnailStrip, {
      props: {
        group: group(3),
      },
    });

    const strip = screen.getByTestId('agent-plan-thumbnail-strip');
    const images = within(strip).getAllByTestId('agent-plan-thumbnail-image');

    await fireEvent.error(images[1]);

    expect(within(strip).getAllByTestId('agent-plan-thumbnail-image')).toHaveLength(3);
    expect(within(strip).getByText('Preview unavailable')).toBeInTheDocument();
    expect(within(strip).getByAltText('Photo preview 1 of 3')).toBeInTheDocument();
    expect(within(strip).getByAltText('Photo preview 3 of 3')).toBeInTheDocument();
  });

  it('renders nothing for operations with zero affected photos', () => {
    const { container } = render(AgentPlanThumbnailStrip, {
      props: {
        group: group(0),
      },
    });

    expect(container.children).toHaveLength(0);
  });

  it('does not mount every thumbnail for a 1,000-photo plan', () => {
    render(AgentPlanThumbnailStrip, {
      props: {
        group: group(1_000),
      },
    });

    const strip = screen.getByTestId('agent-plan-thumbnail-strip');

    expect(within(strip).getAllByTestId('agent-plan-thumbnail-image')).toHaveLength(6);
    expect(within(strip).getByText('+994')).toBeInTheDocument();
    expect(screen.queryByText('asset-013')).not.toBeInTheDocument();
    expect(within(strip).queryByAltText('Photo preview 13 of 1000')).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the component tests and verify RED**

Run:

```bash
pnpm --dir web test --run "src/routes/(user)/assistant/agent-plan-thumbnail-strip.spec.ts"
```

Expected: FAIL because `agent-plan-thumbnail-strip.svelte` does not exist.

- [ ] **Step 3: Create the thumbnail strip component**

Create `web/src/routes/(user)/assistant/agent-plan-thumbnail-strip.svelte`:

```svelte
<script lang="ts">
  import { getAssetMediaUrl } from '$lib/utils';
  import { AssetMediaSize } from '@immich/sdk';
  import { t } from 'svelte-i18n';
  import {
    buildAgentPlanThumbnailStrip,
    type OperationReviewGroup,
  } from './agent-operation-plan-ui';

  interface Props {
    group: OperationReviewGroup;
    maxVisible?: number;
  }

  let { group, maxVisible }: Props = $props();
  let failedAssetIds = $state(new Set<string>());

  const strip = $derived(buildAgentPlanThumbnailStrip(group, maxVisible));

  const markFailed = (assetId: string) => {
    if (failedAssetIds.has(assetId)) {
      return;
    }

    failedAssetIds = new Set([...failedAssetIds, assetId]);
  };
</script>

{#if strip.totalCount > 0}
  <div
    class="mt-4"
    data-testid="agent-plan-thumbnail-strip"
    aria-label={$t('assistant_operation_thumbnail_strip_label', { values: { count: strip.totalCount } })}
  >
    {#if strip.hasThumbnails}
      <div class="flex flex-wrap gap-1.5">
        {#each strip.assetIds as assetId, index (assetId)}
          <figure
            class="relative size-14 overflow-hidden rounded-md border border-gray-200 bg-gray-100 dark:border-gray-700 dark:bg-gray-800"
            data-testid="agent-plan-thumbnail-tile"
          >
            <img
              class="size-full object-cover"
              data-testid="agent-plan-thumbnail-image"
              src={getAssetMediaUrl({ id: assetId, size: AssetMediaSize.Thumbnail })}
              alt={$t('assistant_operation_thumbnail_alt', {
                values: { index: index + 1, count: strip.totalCount },
              })}
              loading="lazy"
              draggable="false"
              onerror={() => markFailed(assetId)}
            />
            {#if failedAssetIds.has(assetId)}
              <span
                class="absolute inset-0 flex items-center justify-center bg-gray-200 px-1 text-center text-[10px] leading-tight text-gray-600 dark:bg-gray-800 dark:text-gray-300"
              >
                {$t('assistant_operation_thumbnail_unavailable')}
              </span>
            {/if}
          </figure>
        {/each}

        {#if strip.hasMore}
          <div
            class="flex size-14 items-center justify-center rounded-md border border-gray-200 bg-gray-100 text-sm font-semibold text-gray-600 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300"
            aria-label={$t('assistant_operation_thumbnail_overflow_label', {
              values: { count: strip.overflowCount },
            })}
          >
            {$t('assistant_operation_thumbnail_overflow', { values: { count: strip.overflowCount } })}
          </div>
        {/if}
      </div>
    {:else}
      <p class="rounded-md bg-gray-100 px-3 py-2 text-sm text-gray-500 dark:bg-gray-800 dark:text-gray-400">
        {$t('assistant_operation_thumbnail_empty', { values: { count: strip.totalCount } })}
      </p>
    {/if}
  </div>
{/if}
```

- [ ] **Step 4: Run the component tests and verify GREEN**

Run:

```bash
pnpm --dir web test --run "src/routes/(user)/assistant/agent-plan-thumbnail-strip.spec.ts"
```

Expected: PASS.

- [ ] **Step 5: Commit this task**

```bash
git add web/src/routes/\(user\)/assistant/agent-plan-thumbnail-strip.svelte web/src/routes/\(user\)/assistant/agent-plan-thumbnail-strip.spec.ts
git commit -m "feat: add pi plan thumbnail strip"
```

---

### Task 3: Integrate Thumbnail Strip Into Destination Cards

**Files:**

- Modify: `web/src/routes/(user)/assistant/agent-plan-destination-card.svelte`
- Modify: `web/src/routes/(user)/assistant/agent-plan-destination-card.spec.ts`
- Modify: `i18n/en.json`

- [ ] **Step 1: Write failing destination-card assertions**

In `web/src/routes/(user)/assistant/agent-plan-destination-card.spec.ts`, add these messages to the `messages` object:

```ts
assistant_operation_thumbnail_alt: 'Photo preview {index} of {count}',
assistant_operation_thumbnail_empty: '{count} photos without previews',
assistant_operation_thumbnail_overflow: '+{count}',
assistant_operation_thumbnail_overflow_label: '{count} more photos',
assistant_operation_thumbnail_strip_label: '{count} photo previews',
assistant_operation_thumbnail_unavailable: 'Preview unavailable',
```

Add this replacement to the mock translation chain:

```ts
.replace('{index}', String(options?.values?.index ?? ''))
```

Update the existing `renders destination evidence with compact operation and asset counts` test with:

```ts
const thumbnailStrip = screen.getByTestId('agent-plan-thumbnail-strip');
expect(thumbnailStrip).toHaveAttribute('aria-label', '2 photo previews');
expect(within(thumbnailStrip).getAllByTestId('agent-plan-thumbnail-image')).toHaveLength(2);
expect(within(thumbnailStrip).queryByText(/\+\d+/)).not.toBeInTheDocument();
```

Add a large destination-card regression test:

```ts
it('renders bounded thumbnails for a destination with 1,000 affected photos', () => {
  const largeAssetIds = Array.from({ length: 1_000 }, (_, index) => `large-asset-${index + 1}`);
  const largeGroup = buildOperationReviewModel(
    plan([
      operation({
        id: addId,
        type: AgentOperationType.AlbumAddAssets,
        summary: 'Add one thousand assets',
        targetKind: AgentOperationTargetKind.NewAlbum,
        temporaryTargetId: 'album-portugal',
        assetIds: largeAssetIds,
        payload: {},
      }),
    ]),
    { [addId]: true },
  ).groups[0];

  render(AgentPlanDestinationCard, {
    props: {
      group: largeGroup,
      canChangeSelection: true,
      onToggleGroup: vi.fn(),
      onToggleOperation: vi.fn(),
    },
  });

  const thumbnailStrip = screen.getByTestId('agent-plan-thumbnail-strip');
  expect(within(thumbnailStrip).getAllByTestId('agent-plan-thumbnail-image')).toHaveLength(6);
  expect(within(thumbnailStrip).getByText('+994')).toBeInTheDocument();
  expect(screen.queryByText('large-asset-7')).not.toBeInTheDocument();
  expect(screen.queryByText('large-asset-13')).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run the destination-card tests and verify RED**

Run:

```bash
pnpm --dir web test --run "src/routes/(user)/assistant/agent-plan-destination-card.spec.ts"
```

Expected: FAIL because `AgentPlanDestinationCard` does not render `AgentPlanThumbnailStrip`.

- [ ] **Step 3: Add English translations**

In `i18n/en.json`, add these keys near the existing assistant operation keys:

```json
"assistant_operation_thumbnail_alt": "Photo preview {index, number} of {count, number}",
"assistant_operation_thumbnail_empty": "{count, plural, one {# photo without preview} other {# photos without previews}}",
"assistant_operation_thumbnail_overflow": "+{count, number}",
"assistant_operation_thumbnail_overflow_label": "{count, plural, one {# more photo} other {# more photos}}",
"assistant_operation_thumbnail_strip_label": "{count, plural, one {# photo preview} other {# photo previews}}",
"assistant_operation_thumbnail_unavailable": "Preview unavailable"
```

- [ ] **Step 4: Compose the thumbnail strip inside destination cards**

In `web/src/routes/(user)/assistant/agent-plan-destination-card.svelte`, add:

```ts
import AgentPlanThumbnailStrip from './agent-plan-thumbnail-strip.svelte';
```

Render the strip after the destination header and before operation rows:

```svelte
  <AgentPlanThumbnailStrip {group} />

  <div class="mt-3 flex flex-col divide-y divide-gray-200 dark:divide-gray-700">
    {#each group.operations as item (item.id)}
      <AgentPlanOperationRow {item} {canChangeSelection} {onToggleOperation} />
    {/each}
  </div>
```

- [ ] **Step 5: Run destination-card tests and verify GREEN**

Run:

```bash
pnpm --dir web test --run "src/routes/(user)/assistant/agent-plan-destination-card.spec.ts"
```

Expected: PASS.

- [ ] **Step 6: Run strip and destination-card tests together**

Run:

```bash
pnpm --dir web test --run \
  "src/routes/(user)/assistant/agent-plan-thumbnail-strip.spec.ts" \
  "src/routes/(user)/assistant/agent-plan-destination-card.spec.ts"
```

Expected: PASS.

- [ ] **Step 7: Commit this task**

```bash
git add i18n/en.json web/src/routes/\(user\)/assistant/agent-plan-destination-card.svelte web/src/routes/\(user\)/assistant/agent-plan-destination-card.spec.ts
git commit -m "feat: show pi plan destination thumbnails"
```

---

### Task 4: Add Browser-Flow Thumbnail Coverage

**Files:**

- Modify: `e2e/src/specs/web/assistant-album-organizer.e2e-spec.ts`

- [ ] **Step 1: Write the browser-flow assertion**

In `e2e/src/specs/web/assistant-album-organizer.e2e-spec.ts`, update the happy-path test after `portugalDestination` is visible:

```ts
const thumbnailStrip = portugalDestination.getByTestId('agent-plan-thumbnail-strip');
await expect(thumbnailStrip).toBeVisible();
await expect(thumbnailStrip.getByTestId('agent-plan-thumbnail-image')).toHaveCount(2);
await expect(thumbnailStrip.getByText(/\+\d+/)).toHaveCount(0);
```

Keep the existing destination card, operation toggle, hidden technical details, and apply assertions unchanged.

- [ ] **Step 2: Run formatting for the E2E file**

Run:

```bash
pnpm --dir e2e exec prettier --check "src/specs/web/assistant-album-organizer.e2e-spec.ts"
```

Expected: PASS.

- [ ] **Step 3: Commit this task**

```bash
git add e2e/src/specs/web/assistant-album-organizer.e2e-spec.ts
git commit -m "test: cover pi plan thumbnail browser flow"
```

Browser execution for this assertion is verified in Task 5 through CI. Do not spend time on a local Playwright run unless CI fails and local reproduction is useful.

---

### Task 5: Run Slice Verification

**Files:**

- Verify: `web/src/routes/(user)/assistant/agent-operation-plan-ui.spec.ts`
- Verify: `web/src/routes/(user)/assistant/agent-plan-thumbnail-strip.spec.ts`
- Verify: `web/src/routes/(user)/assistant/agent-plan-destination-card.spec.ts`
- Verify: `web/src/routes/(user)/assistant/agent-plan-evidence-ledger.spec.ts`
- Verify: `web/src/routes/(user)/assistant/agent-operation-plan-review-panel.spec.ts`
- Verify: `e2e/src/specs/web/assistant-album-organizer.e2e-spec.ts` through CI
- Verify: web TypeScript
- Verify: web Svelte check
- Verify: formatting

- [ ] **Step 1: Run all Slice 3 unit/component tests locally**

Run:

```bash
pnpm --dir web test --run \
  "src/routes/(user)/assistant/agent-operation-plan-ui.spec.ts" \
  "src/routes/(user)/assistant/agent-plan-thumbnail-strip.spec.ts" \
  "src/routes/(user)/assistant/agent-plan-destination-card.spec.ts" \
  "src/routes/(user)/assistant/agent-plan-evidence-ledger.spec.ts" \
  "src/routes/(user)/assistant/agent-operation-plan-review-panel.spec.ts"
```

Expected: PASS.

- [ ] **Step 2: Run TypeScript**

Run:

```bash
pnpm --dir web check:typescript
```

Expected: PASS.

- [ ] **Step 3: Run Svelte check**

Run:

```bash
pnpm --dir web check:svelte
```

Expected: PASS with 0 warnings.

- [ ] **Step 4: Run formatting checks**

Run:

```bash
pnpm --dir web exec prettier --check \
  "src/routes/(user)/assistant/agent-operation-plan-ui.ts" \
  "src/routes/(user)/assistant/agent-operation-plan-ui.spec.ts" \
  "src/routes/(user)/assistant/agent-plan-thumbnail-strip.svelte" \
  "src/routes/(user)/assistant/agent-plan-thumbnail-strip.spec.ts" \
  "src/routes/(user)/assistant/agent-plan-destination-card.svelte" \
  "src/routes/(user)/assistant/agent-plan-destination-card.spec.ts" \
  "src/routes/(user)/assistant/agent-plan-evidence-ledger.spec.ts" \
  "src/routes/(user)/assistant/agent-operation-plan-review-panel.spec.ts" \
  "../i18n/en.json"
pnpm --dir e2e exec prettier --check "src/specs/web/assistant-album-organizer.e2e-spec.ts"
```

Expected: PASS.

- [ ] **Step 5: Push and use CI for browser verification**

Run:

```bash
git push
gh run list --branch explore/pi-agent-brainstorm --workflow test.yml --limit 5
```

Expected: the latest `test.yml` run starts for the pushed branch and the `e2e-tests-web` job passes. If CI does not start automatically, open the branch/PR checks page and use the existing CI trigger for this repository.

- [ ] **Step 6: Commit verification-only fixes if needed**

If verification exposes type, Svelte, formatting, or selector fixes, apply the smallest fix and commit it:

```bash
git add i18n/en.json web/src/routes/\(user\)/assistant/agent-operation-plan-ui.ts web/src/routes/\(user\)/assistant/agent-operation-plan-ui.spec.ts web/src/routes/\(user\)/assistant/agent-plan-thumbnail-strip.svelte web/src/routes/\(user\)/assistant/agent-plan-thumbnail-strip.spec.ts web/src/routes/\(user\)/assistant/agent-plan-destination-card.svelte web/src/routes/\(user\)/assistant/agent-plan-destination-card.spec.ts e2e/src/specs/web/assistant-album-organizer.e2e-spec.ts
git commit -m "fix: verify pi plan thumbnails"
```

If no fixes were needed, do not create an empty commit.

---

## Final Acceptance Checklist

- [ ] `AgentPlanDestinationCard` renders a representative thumbnail strip when `group.thumbnailSummary.totalCount > 0`.
- [ ] Collapsed destination cards render at most 6 thumbnails by default and never more than 12 through the helper.
- [ ] A large plan with 1,000 affected assets does not render every affected asset into the collapsed DOM.
- [ ] Overflow count tile reflects hidden affected photos, for example `+994` when 6 of 1,000 photos are rendered.
- [ ] No-preview fallback renders when affected assets exist but representative thumbnail IDs are unavailable.
- [ ] Individual thumbnail load failures show a per-item fallback while the remaining thumbnails stay visible.
- [ ] Zero affected photos render no thumbnail strip.
- [ ] Asset IDs are used only in thumbnail URLs/test selectors and are not displayed as visible text.
- [ ] Destination card toggles, operation rows, mixed checkbox state, sticky apply behavior, and legacy `{ operationIds }` payload remain unchanged.
- [ ] Browser-flow coverage asserts thumbnails in the Pi plan preview and CI `e2e-tests-web` is used as the source of truth.
- [ ] No expanded item grid, item-level selection, sparse apply payload, thumbnail queue, or server API change is introduced in this slice.
- [ ] All Slice 3 local unit/component tests pass.
- [ ] `pnpm --dir web check:typescript` passes.
- [ ] `pnpm --dir web check:svelte` passes.
- [ ] Formatting checks pass for changed web, i18n, and E2E files.
