# Pi Agent Expanded Activity Debug Slice 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render `Activity preview: Expanded` as the full verbose activity stream for normal-sized turns while keeping very large turns inspectable through bounded latest-window paging.

**Architecture:** Keep `AgentActivityBlock.svelte` as the only component changed for behavior. Compact mode continues to render `model.items` through `selectCompactItems`. Expanded mode renders `model.verboseItems` through a new latest-window selector with `Show older activity` / `Show newer activity` controls and a visible row count. The selector keeps the active/running row visible even when it falls outside the current latest window.

**Tech Stack:** Svelte 5, TypeScript, Vitest, Testing Library for Svelte, root `i18n/en.json`.

---

## Spec Reference

Spec: `docs/superpowers/specs/2026-05-22-pi-agent-expanded-activity-debug-design.md`

Slice 2 requirements:

- Expanded block renders every row for a moderate burst such as 50 calls.
- Compact block still renders at most the compact limit for the same burst.
- Expanded block with more than the initial window exposes `Show older activity` and `Show newer activity` controls as needed.
- The active/running row is visible even when it is outside the latest bounded window.
- Technical details disclosure still works for verbose rows.
- Edge cases: 500+ rows, running row in the middle of long history, all rows terminal, narrow viewport, keyboard focus remains on activated controls.

## Files

- Modify: `web/src/routes/(user)/assistant/agent-activity-block.svelte`
- Modify: `web/src/routes/(user)/assistant/agent-activity-block.spec.ts`
- Modify: `i18n/en.json`

## Task 1: Add Failing Expanded Paging Tests

**Files:**

- Modify: `web/src/routes/(user)/assistant/agent-activity-block.spec.ts`

- [x] **Step 1: Add new mocked translation keys**

In the `vi.mock('svelte-i18n', ...)` `messages` object, add:

```ts
assistant_activity_show_newer: 'Show newer activity',
assistant_activity_show_older: 'Show older activity',
assistant_activity_window_summary: 'Showing {visible} of {total} actions',
```

Then replace the mocked `t` helper:

```ts
t: readable((key: string, options?: { values?: Record<string, string | number> }) =>
  (messages[key] ?? key).replace('{count}', String(options?.values?.count ?? '')),
),
```

with a helper that can interpolate the new `{visible}` and `{total}` values:

```ts
t: readable((key: string, options?: { values?: Record<string, string | number> }) => {
  let message = messages[key] ?? key;

  for (const [name, value] of Object.entries(options?.values ?? {})) {
    message = message.replaceAll(`{${name}}`, String(value));
  }

  return message;
}),
```

- [x] **Step 2: Add a helper for large verbose item lists**

Add this helper near `activityModel`:

```ts
const verboseActivityItems = (count: number, runningIndex: number | null = null) =>
  Array.from({ length: count }, (_, index) =>
    activityItem({
      id: `verbose-${index}`,
      title: `Verbose activity ${index}`,
      summary: `Verbose summary ${index}`,
      status: index === runningIndex ? 'running' : 'completed',
      startedAt: `2026-05-18T10:${String(Math.floor(index / 60)).padStart(2, '0')}:${String(index % 60).padStart(2, '0')}.000Z`,
      technical: {
        toolName: index % 2 === 0 ? 'searchAssets' : 'readAssetMetadata',
        toolCallIds: [`tool-call-${index}`],
      },
    }),
  );
```

- [x] **Step 3: Replace the hard-cap test with bounded paging expectations**

Replace the existing `caps expanded verbose rows to a bounded DOM count` test with:

```ts
it('renders expanded moderate bursts as a full verbose activity stream', () => {
  const verboseItems = verboseActivityItems(50);
  const { container } = render(AgentActivityBlock, {
    props: {
      visibilityMode: 'expanded',
      model: activityModel([activityItem({ id: 'compact', title: 'Searching photos' })], verboseItems),
    },
  });

  expect(container.querySelectorAll('[data-activity-row]')).toHaveLength(50);
  expect(screen.getByText('Verbose activity 0')).toBeInTheDocument();
  expect(screen.getByText('Verbose activity 49')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Show older activity' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Show newer activity' })).not.toBeInTheDocument();
});

it('pages expanded large verbose streams while keeping the active row visible', async () => {
  const verboseItems = verboseActivityItems(250, 120);
  const { container } = render(AgentActivityBlock, {
    props: {
      visibilityMode: 'expanded',
      model: activityModel([activityItem({ id: 'compact', title: 'Searching photos' })], verboseItems),
    },
  });

  expect(container.querySelectorAll('[data-activity-row]')).toHaveLength(100);
  expect(screen.getByText('Showing 100 of 250 actions')).toBeInTheDocument();
  expect(screen.getByText('Verbose activity 120')).toBeInTheDocument();
  expect(screen.getByText('Verbose activity 249')).toBeInTheDocument();
  expect(screen.queryByText('Verbose activity 0')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Show newer activity' })).not.toBeInTheDocument();

  const showOlder = screen.getByRole('button', { name: 'Show older activity' });
  await fireEvent.click(showOlder);

  expect(screen.getByText('Verbose activity 50')).toBeInTheDocument();
  expect(screen.getByText('Verbose activity 149')).toBeInTheDocument();
  expect(screen.getByText('Verbose activity 120')).toBeInTheDocument();
  expect(screen.queryByText('Verbose activity 249')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Show older activity' })).toHaveFocus();
  expect(screen.getByRole('button', { name: 'Show newer activity' })).toBeInTheDocument();

  await fireEvent.click(screen.getByRole('button', { name: 'Show newer activity' }));

  expect(screen.getByText('Verbose activity 249')).toBeInTheDocument();
  expect(screen.queryByText('Verbose activity 50')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Show older activity' })).toHaveFocus();
});
```

- [x] **Step 4: Add a 500+ row all-terminal edge-case test**

Add this test after the paging test:

```ts
it('keeps all-terminal expanded streams bounded and inspectable', async () => {
  const verboseItems = verboseActivityItems(501);
  const { container } = render(AgentActivityBlock, {
    props: {
      visibilityMode: 'expanded',
      model: activityModel([activityItem({ id: 'compact', title: 'Searching photos' })], verboseItems),
    },
  });

  expect(container.querySelectorAll('[data-activity-row]')).toHaveLength(100);
  expect(screen.getByText('Showing 100 of 501 actions')).toBeInTheDocument();
  expect(screen.getByText('Verbose activity 500')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Show older activity' })).toBeInTheDocument();

  await fireEvent.click(screen.getByRole('button', { name: 'Show older activity' }));

  expect(container.querySelectorAll('[data-activity-row]')).toHaveLength(100);
  expect(screen.getByText('Verbose activity 400')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Show newer activity' })).toBeInTheDocument();
});
```

- [x] **Step 5: Add paging focus edge-case tests**

Add these tests after the all-terminal paging test:

```ts
it('moves focus to show newer activity when paging to the oldest window', async () => {
  const verboseItems = verboseActivityItems(250);
  render(AgentActivityBlock, {
    props: {
      visibilityMode: 'expanded',
      model: activityModel([activityItem({ id: 'compact', title: 'Searching photos' })], verboseItems),
    },
  });

  await fireEvent.click(screen.getByRole('button', { name: 'Show older activity' }));
  await fireEvent.click(screen.getByRole('button', { name: 'Show older activity' }));

  expect(screen.getByText('Verbose activity 0')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Show older activity' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Show newer activity' })).toHaveFocus();
});

it('keeps paging focus scoped to the activity block that was clicked', async () => {
  const verboseItems = verboseActivityItems(250);
  const model = activityModel([activityItem({ id: 'compact', title: 'Searching photos' })], verboseItems);

  render(AgentActivityBlock, { props: { visibilityMode: 'expanded', model } });
  render(AgentActivityBlock, { props: { visibilityMode: 'expanded', model } });

  const [firstBlock, secondBlock] = screen.getAllByRole('article', { name: 'Activity summary' });
  await fireEvent.click(within(firstBlock).getByRole('button', { name: 'Show older activity' }));
  await fireEvent.click(within(secondBlock).getByRole('button', { name: 'Show older activity' }));
  await fireEvent.click(within(secondBlock).getByRole('button', { name: 'Show newer activity' }));

  expect(within(firstBlock).getByRole('button', { name: 'Show older activity' })).not.toHaveFocus();
  expect(within(secondBlock).getByRole('button', { name: 'Show older activity' })).toHaveFocus();
});
```

- [x] **Step 6: Add a technical-details-after-paging test**

Add this test near the technical details tests:

```ts
it('keeps technical details available for verbose rows after paging', async () => {
  const verboseItems = verboseActivityItems(150);
  render(AgentActivityBlock, {
    props: {
      visibilityMode: 'expanded',
      model: activityModel([activityItem({ id: 'compact', title: 'Searching photos' })], verboseItems),
    },
  });

  await fireEvent.click(screen.getByRole('button', { name: 'Show older activity' }));
  const row = screen.getByText('Verbose activity 50').closest('[data-activity-row]');
  expect(row).not.toBeNull();

  await fireEvent.click(within(row as HTMLElement).getByRole('button', { name: 'Technical details' }));

  expect(within(row as HTMLElement).getByText('Tool name')).toBeInTheDocument();
  expect(within(row as HTMLElement).getByText('searchAssets')).toBeInTheDocument();
  expect(within(row as HTMLElement).getByText('tool-call-50')).toBeInTheDocument();
});
```

- [x] **Step 7: Run focused component tests and verify the expected red failures**

Run:

```bash
pnpm --filter immich-web exec vitest run 'src/routes/(user)/assistant/agent-activity-block.spec.ts'
```

Expected red result:

- Fails because `Show older activity`, `Show newer activity`, and `Showing {visible} of {total} actions` are not rendered yet.
- After the initial paging implementation exists, the focus edge-case tests fail until focus is moved after DOM updates and scoped to the current activity block.
- Existing expanded rendering tests may still pass.

## Task 2: Implement Expanded Latest-Window Paging

**Files:**

- Modify: `web/src/routes/(user)/assistant/agent-activity-block.svelte`

- [x] **Step 1: Add expanded page state and helpers**

Near the existing component state:

```ts
let expandedWindowStart = $state<number | null>(null);
```

Add helper functions after `selectCompactItems`:

```ts
const clampNumber = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

function getVerboseWindowStart(items: AgentActivityItem[], limit: number, requestedStart: number | null) {
  if (limit <= 0 || items.length <= limit) {
    return 0;
  }

  const maxStart = Math.max(0, items.length - limit);
  return clampNumber(requestedStart ?? maxStart, 0, maxStart);
}

function includeActiveItemInWindow(
  selected: AgentActivityItem[],
  activeItem: AgentActivityItem | null,
  limit: number,
): AgentActivityItem[] {
  if (!activeItem || selected.some((item) => item.id === activeItem.id) || limit <= 0) {
    return selected;
  }

  const nextSelected = selected.slice(0, limit);
  if (nextSelected.length >= limit) {
    nextSelected.shift();
  }
  nextSelected.push(activeItem);

  return nextSelected.sort((first, second) => first.startedAt.localeCompare(second.startedAt));
}
```

- [x] **Step 2: Replace `selectVerboseItems` with latest-window behavior**

Replace the current `selectVerboseItems` implementation with:

```ts
function selectVerboseItems(
  items: AgentActivityItem[],
  activeItem: AgentActivityItem | null,
  limit: number,
  requestedStart: number | null,
): AgentActivityItem[] {
  if (limit <= 0) {
    return [];
  }

  if (items.length <= limit) {
    return items;
  }

  const start = getVerboseWindowStart(items, limit, requestedStart);
  const selected = items.slice(start, start + limit);

  return includeActiveItemInWindow(selected, activeItem, limit);
}
```

- [x] **Step 3: Add derived expanded window metadata**

Replace:

```ts
const expandedItems = $derived(selectVerboseItems(model.verboseItems, model.verboseActiveItem, verboseLimit));
const visibleItems = $derived(isExpanded ? expandedItems : compactItems);
```

with:

```ts
const expandedWindowStartIndex = $derived(getVerboseWindowStart(model.verboseItems, verboseLimit, expandedWindowStart));
const expandedItems = $derived(
  selectVerboseItems(model.verboseItems, model.verboseActiveItem, verboseLimit, expandedWindowStart),
);
const visibleItems = $derived(isExpanded ? expandedItems : compactItems);
const hasExpandedPaging = $derived(isExpanded && model.verboseItems.length > verboseLimit && verboseLimit > 0);
const canShowOlderActivity = $derived(hasExpandedPaging && expandedWindowStartIndex > 0);
const canShowNewerActivity = $derived(
  hasExpandedPaging && expandedWindowStartIndex + verboseLimit < model.verboseItems.length,
);
const visibleExpandedCount = $derived(Math.min(expandedItems.length, model.verboseItems.length));
```

- [x] **Step 4: Reset stale page state when collapsing**

Add this effect after the derived values:

```ts
$effect(() => {
  if (!isExpanded) {
    expandedWindowStart = null;
  }
});
```

- [x] **Step 5: Add paging actions**

Import `tick` from Svelte and add functions near `toggleTechnicalRow`:

```ts
import { tick } from 'svelte';
```

```ts
async function focusPagingButton(buttonName: 'older' | 'newer') {
  await tick();
  articleElement?.querySelector<HTMLButtonElement>(`[data-activity-paging-button="${buttonName}"]`)?.focus();
}

function showOlderActivity() {
  const nextWindowStart = Math.max(0, expandedWindowStartIndex - verboseLimit);
  expandedWindowStart = nextWindowStart;
  void focusPagingButton(nextWindowStart > 0 ? 'older' : 'newer');
}

function showNewerActivity() {
  const maxStart = Math.max(0, model.verboseItems.length - verboseLimit);
  const nextWindowStart = Math.min(maxStart, expandedWindowStartIndex + verboseLimit);
  expandedWindowStart = nextWindowStart;
  void focusPagingButton(nextWindowStart + verboseLimit < model.verboseItems.length ? 'newer' : 'older');
}
```

Add an `articleElement` component reference and `bind:this={articleElement}` on the `<article>` so focus lookup is scoped to the block that was clicked:

```ts
let articleElement = $state<HTMLElement | null>(null);
```

```svelte
<article
  bind:this={articleElement}
```

`Show older activity` moves focus to itself when it remains available, or to `Show newer activity` when it disappears at the oldest window. `Show newer activity` moves focus to itself when it remains available, or to `Show older activity` when it disappears at the latest window. The lookup must be scoped through `articleElement`, not `document.querySelector`, because multiple activity blocks can be visible in one chat.

- [x] **Step 6: Render expanded row count and paging controls**

Between the block header and the rows `<div id={rowsId} ...>`, add:

```svelte
    {#if hasExpandedPaging}
      <div class="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-gray-500 dark:text-gray-400">
        <span>
          {$t('assistant_activity_window_summary', {
            values: { visible: visibleExpandedCount, total: model.verboseItems.length },
          })}
        </span>
        <div class="flex flex-wrap items-center gap-2">
          {#if canShowOlderActivity}
            <button
              type="button"
              class="rounded-full border border-gray-200 bg-white px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-immich-primary dark:border-neutral-800 dark:bg-neutral-900 dark:text-gray-200 dark:hover:bg-neutral-800"
              data-activity-paging-button="older"
              onclick={showOlderActivity}
            >
              {$t('assistant_activity_show_older')}
            </button>
          {/if}
          {#if canShowNewerActivity}
            <button
              type="button"
              class="rounded-full border border-gray-200 bg-white px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-immich-primary dark:border-neutral-800 dark:bg-neutral-900 dark:text-gray-200 dark:hover:bg-neutral-800"
              data-activity-paging-button="newer"
              onclick={showNewerActivity}
            >
              {$t('assistant_activity_show_newer')}
            </button>
          {/if}
        </div>
      </div>
    {/if}
```

The row count says how many rows are currently rendered out of the full verbose stream. If the active row is inserted from outside the current latest window, the rendered count is still bounded by `verboseLimit`.

- [x] **Step 7: Run focused component tests and verify green**

Run:

```bash
pnpm --filter immich-web exec vitest run 'src/routes/(user)/assistant/agent-activity-block.spec.ts'
```

Expected green result:

- `agent-activity-block.spec.ts` passes.

## Task 3: Add Production English Strings

**Files:**

- Modify: `i18n/en.json`

- [x] **Step 1: Add new English translation keys**

In `i18n/en.json`, near the existing `assistant_activity_*` keys, add:

```json
"assistant_activity_show_newer": "Show newer activity",
"assistant_activity_show_older": "Show older activity",
"assistant_activity_window_summary": "Showing {visible, number} of {total, number} actions",
```

Keep JSON sorted according to the surrounding file's existing key order.

- [x] **Step 2: Run focused tests**

Run:

```bash
pnpm --filter immich-web exec vitest run 'src/routes/(user)/assistant/agent-activity-block.spec.ts'
```

Expected green result:

- Component tests still pass.

## Task 4: Integration Verification And Commit Slice 2

**Files:**

- Review: `web/src/routes/(user)/assistant/agent-activity-block.svelte`
- Review: `web/src/routes/(user)/assistant/agent-activity-block.spec.ts`
- Review: `i18n/en.json`
- Review: `docs/superpowers/plans/2026-05-22-pi-agent-expanded-activity-debug-slice-2.md`

- [x] **Step 1: Run affected assistant tests**

Run:

```bash
pnpm --filter immich-web exec vitest run \
  'src/routes/(user)/assistant/agent-activity-block.spec.ts' \
  'src/routes/(user)/assistant/agent-session-chat-panel.spec.ts'
```

Expected green result:

- Activity block tests pass.
- Chat panel tests pass, proving the expanded block integration still works.

- [x] **Step 2: Run web checks**

Run:

```bash
pnpm --filter immich-web run check:svelte
pnpm --filter immich-web run check:typescript
```

Expected green result:

- Svelte check passes with 0 errors and 0 warnings.
- TypeScript check passes.

- [x] **Step 3: Check the diff**

Run:

```bash
git diff -- web/src/routes/\(user\)/assistant/agent-activity-block.svelte \
  web/src/routes/\(user\)/assistant/agent-activity-block.spec.ts \
  i18n/en.json \
  docs/superpowers/plans/2026-05-22-pi-agent-expanded-activity-debug-slice-2.md
git diff --check
```

Expected:

- Only Slice 2 files are changed.
- No whitespace errors.
- No Slice 3 refresh/timeline code is changed.

- [x] **Step 4: Commit**

Run:

```bash
git add web/src/routes/\(user\)/assistant/agent-activity-block.svelte \
  web/src/routes/\(user\)/assistant/agent-activity-block.spec.ts \
  i18n/en.json \
  docs/superpowers/plans/2026-05-22-pi-agent-expanded-activity-debug-slice-2.md
git commit -m "feat: page expanded Pi activity rows"
```

Expected:

- Commit succeeds.
- Working tree is clean after commit.

## Plan Review Checklist

- TDD is explicit: Task 1 writes failing component tests and requires red verification before implementation.
- Every Slice 2 spec test is represented:
  - moderate 50-row expanded stream renders all rows;
  - compact mode still stays capped by existing compact tests;
  - large expanded streams expose older/newer controls;
  - active row remains visible when outside the latest window;
  - technical details still work after paging.
- Every Slice 2 edge case is represented:
  - 500+ rows;
  - running row in the middle;
  - all-terminal rows;
  - focus remains predictable after paging, including when the activated `Show newer activity` control disappears;
  - existing wrapping/responsive tests cover narrow text behavior.
- Scope does not implement Slice 3 refresh flicker handling or modify `AgentSessionChatPanel.svelte`.
