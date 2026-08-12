# Face Cleanup Console UX Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the "Ready to auto-fix" spot-check chips open the per-cluster review page, and give the "Needs your review" list fixed, labelled columns that never shift.

**Architecture:** Two isolated Svelte-component changes on the admin face-cleanup scan page. `ConfidentLane.svelte` chips adopt the anchor-plus-absolute-button pattern `ReviewFirstLane.svelte` already documents. `ReviewFirstLane.svelte` pins every column to a fixed width via shared class constants used by both a new header row and the data rows.

**Tech Stack:** Svelte 5 (runes), Tailwind CSS 4, svelte-i18n, Vitest + @testing-library/svelte (happy-dom).

**Spec:** `docs/superpowers/specs/2026-07-25-face-cleanup-console-ux-fixes-design.md`

## Global Constraints

- **Work in the existing worktree** `/Users/pierre/dev/gallery/.claude/worktrees/face-unified`, branch `feat/face-manual-review` (PR #838). Do NOT create a new worktree. All commands below run from that directory unless a `cd` says otherwise.
- Web only — no server, API, SDK, or migration changes.
- New i18n keys go in `i18n/en.json` ONLY (other locales are translated separately).
- Run single test files with `pnpm exec vitest run <path>` from `web/`. Never `pnpm test -- --run <path>` — that silently drops the path filter and runs everything.
- Prettier: 120-char lines, single quotes; ESLint zero-warnings policy. Defer the full lint/format pass to Task 3 — don't run full-package lint per task.
- Commit messages: conventional style (`fix(web): …`, `feat(web): …`). No Co-Authored-By or Generated-with trailers.
- `web check:svelte` has been seen scanning 0 files locally — treat a 0-file result as an anomaly to note, not as a pass.

---

### Task 1: ReviewFirstLane — fixed columns + header row

**Files:**

- Modify: `web/src/routes/admin/face-cleanup/scan/ReviewFirstLane.svelte`
- Modify: `i18n/en.json` (4 new keys)
- Test: `web/src/routes/admin/face-cleanup/scan/ReviewFirstLane.spec.ts`

**Interfaces:**

- Consumes: existing `FaceCleanupPerson` shape from `./scan-triage.svelte` (notably `reviewReasons: string[]`), existing `reasonKeys` map inside the component, existing i18n mock in the spec file (`$t` → key passthrough).
- Produces: `data-testid="review-header"` on the header row and `data-testid="review-reasons-{personId}"` on the reasons cell (rendered even when the person has zero reasons). Task 2 does not depend on this task; the two are independent.

- [ ] **Step 1: Write the failing tests**

Append these tests inside the existing `describe('ReviewFirstLane', …)` block in `web/src/routes/admin/face-cleanup/scan/ReviewFirstLane.spec.ts` (the file's existing `rev()` factory and mocks are reused as-is; the `$t` mock renders raw keys, which is why assertions match key strings):

```ts
it('renders a header row naming every column', () => {
  render(ReviewFirstLane, { props: { people: [rev({ personId: 'r1' })], users, onDismiss: vi.fn() } });
  const header = screen.getByTestId('review-header');
  expect(header).toHaveTextContent('admin.face_cleanup_col_cluster');
  expect(header).toHaveTextContent('admin.face_cleanup_col_flagged');
  expect(header).toHaveTextContent('admin.face_cleanup_col_destination');
  expect(header).toHaveTextContent('admin.face_cleanup_col_reasons');
});

it('a multi-reason row shows the primary pill plus "+N" and lists every reason in the tooltip', () => {
  render(ReviewFirstLane, {
    props: {
      people: [rev({ personId: 'r1', reviewReasons: ['large-cluster', 'named'] })],
      users,
      onDismiss: vi.fn(),
    },
  });
  const reasons = screen.getByTestId('review-reasons-r1');
  expect(reasons).toHaveTextContent('admin.face_cleanup_reason_large_cluster');
  expect(reasons).toHaveTextContent('+1');
  expect(reasons).not.toHaveTextContent('admin.face_cleanup_reason_named');
  expect(reasons).toHaveAttribute('title', 'admin.face_cleanup_reason_large_cluster · admin.face_cleanup_reason_named');
});

it('bad-target wins the primary pill regardless of its position in the reason list', () => {
  render(ReviewFirstLane, {
    props: {
      people: [rev({ personId: 'r1', reviewReasons: ['large-cluster', 'bad-target'] })],
      users,
      onDismiss: vi.fn(),
    },
  });
  const reasons = screen.getByTestId('review-reasons-r1');
  expect(reasons).toHaveTextContent('admin.face_cleanup_reason_bad_target');
  expect(reasons).toHaveTextContent('+1');
});

it('an unknown reason id falls back to its raw id in pill and tooltip', () => {
  render(ReviewFirstLane, {
    props: { people: [rev({ personId: 'r1', reviewReasons: ['mystery-reason'] })], users, onDismiss: vi.fn() },
  });
  const reasons = screen.getByTestId('review-reasons-r1');
  expect(reasons).toHaveTextContent('mystery-reason');
  expect(reasons).toHaveAttribute('title', 'mystery-reason');
});

it('a row with no reasons still reserves an empty reasons cell', () => {
  render(ReviewFirstLane, {
    props: { people: [rev({ personId: 'r1', reviewReasons: [] })], users, onDismiss: vi.fn() },
  });
  expect(screen.getByTestId('review-reasons-r1')).toBeEmptyDOMElement();
});

// Regression guard, not a red test: this PASSES before and after the change. It pins the row content of
// the % and destination cells so a botched class-constant repoint in Step 4c (e.g. a lost `sm:block`)
// can't silently blank a column — no other test asserts these cells at all.
it('keeps the flagged share and destination visible in their fixed columns', () => {
  render(ReviewFirstLane, { props: { people: [rev({ personId: 'r1' })], users, onDismiss: vi.fn() } });
  const row = screen.getByTestId('review-row-r1');
  expect(row).toHaveTextContent('57%');
  expect(row).toHaveTextContent('20/35');
  expect(row).toHaveTextContent('Pierre');
});
```

- [ ] **Step 2: Run the spec file to verify the new tests fail**

Run: `cd web && pnpm exec vitest run src/routes/admin/face-cleanup/scan/ReviewFirstLane.spec.ts`
Expected: 5 of the 6 new tests FAIL (`Unable to find an element by: [data-testid="review-header"]` / `…review-reasons-r1`); the regression-guard test (`keeps the flagged share…`) and the 6 pre-existing tests PASS.

- [ ] **Step 3: Add the four i18n keys**

In `i18n/en.json`, the admin block keeps keys alphabetically sorted. Around the existing `face_cleanup_col_owner` line (~148), insert so the block reads:

```json
    "face_cleanup_col_cluster": "Cluster",
    "face_cleanup_col_destination": "Move to",
    "face_cleanup_col_flagged": "Flagged",
    "face_cleanup_col_owner": "Owner",
    "face_cleanup_col_reasons": "Why flagged",
```

(`face_cleanup_col_owner` already exists — add the other four around it, preserving alphabetical order.)

- [ ] **Step 4: Implement the component changes**

In `web/src/routes/admin/face-cleanup/scan/ReviewFirstLane.svelte`:

**4a.** Add shared column constants in the `<script>` block, directly after the `reasonKeys` map:

```ts
// Column layout shared by the header row and every cluster row — width + responsive visibility live in one
// place so the header cannot drift out of alignment with the rows it labels. The reasons column is
// fixed-width on purpose: content truncates inside it instead of pushing the % / destination columns around.
const COL_FLAGGED = 'hidden w-28 flex-none sm:block';
const COL_DEST = 'hidden w-36 flex-none md:flex';
const COL_REASONS = 'hidden w-28 flex-none lg:flex';
const COL_HEADING = 'text-[11px] font-semibold tracking-wide text-gray-400 uppercase';
```

**4b.** Insert the header row as the first child of the list container (the `<div class="border-t border-gray-200 dark:border-gray-700">` that wraps the `{#each}`), before the `{#each visible as person (person.personId)}` line. The `w-10` spacer mirrors the rows' `size-10` thumbnail; `gap-4`, `pr-12`, `pl-5` mirror the rows' spacing; the whole row hides below `sm`, where only the identity column renders anyway:

```svelte
<div
  class="hidden items-center gap-4 border-b border-gray-200 bg-gray-50/60 py-2 pr-12 pl-5 sm:flex dark:border-gray-700 dark:bg-gray-900/30"
  data-testid="review-header"
>
  <div class="w-10 flex-none" aria-hidden="true"></div>
  <div class="min-w-0 flex-1 {COL_HEADING}">{$t('admin.face_cleanup_col_cluster')}</div>
  <div class="{COL_FLAGGED} {COL_HEADING}">{$t('admin.face_cleanup_col_flagged')}</div>
  <div class="{COL_DEST} {COL_HEADING}">{$t('admin.face_cleanup_col_destination')}</div>
  <div class="{COL_REASONS} {COL_HEADING}">{$t('admin.face_cleanup_col_reasons')}</div>
</div>
```

**4c.** Repoint the two existing fixed columns at the constants so they can't drift from the header:

- The % cell `<div class="hidden w-28 flex-none sm:block">` becomes `<div class={COL_FLAGGED}>`.
- The destination cell `<div class="hidden w-36 flex-none items-center gap-2 md:flex">` becomes `<div class="{COL_DEST} items-center gap-2">`.

**4d.** Replace the whole reasons block (the current `{#if person.reviewReasons.length > 0}` … `{/if}` with its explanatory comment, lines ~156–175) with:

```svelte
<!-- Fixed-width reasons column: one primary pill (bad-target wins) truncating inside it plus a "+N",
     with EVERY reason spelled out in the title tooltip. The width is constant — including the
     no-reason placeholder — so this column can never push % / destination out of line across rows. -->
{#if person.reviewReasons.length > 0}
  {@const primaryReason = bad ? 'bad-target' : person.reviewReasons[0]}
  {@const reasonLabels = person.reviewReasons.map((r) => (reasonKeys[r] ? $t(reasonKeys[r] as Translations) : r))}
  <div
    class="{COL_REASONS} items-center gap-1.5"
    title={reasonLabels.join(' · ')}
    data-testid={`review-reasons-${person.personId}`}
  >
    <span
      class={[
        'min-w-0 truncate rounded-md px-1.5 py-0.5 text-[10px]',
        primaryReason === 'bad-target'
          ? 'bg-red-50 text-red-500 dark:bg-red-900/20 dark:text-red-400'
          : 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400',
      ].join(' ')}
    >
      {reasonKeys[primaryReason] ? $t(reasonKeys[primaryReason] as Translations) : primaryReason}
    </span>
    {#if person.reviewReasons.length > 1}
      <span class="flex-none text-[10px] font-medium text-gray-400">+{person.reviewReasons.length - 1}</span>
    {/if}
  </div>
{:else}
  <div class={COL_REASONS} aria-hidden="true" data-testid={`review-reasons-${person.personId}`}></div>
{/if}
```

Notes for the implementer: the old pill's `whitespace-nowrap` is replaced by `truncate` (which implies nowrap and adds the ellipsis); `min-w-0` is what lets the pill shrink inside the fixed flex cell. The `{:else}` placeholder is load-bearing — without it a reason-less row would render no cell and shift the % / destination columns, the exact bug this task fixes.

- [ ] **Step 5: Run the spec file to verify all tests pass**

Run: `cd web && pnpm exec vitest run src/routes/admin/face-cleanup/scan/ReviewFirstLane.spec.ts`
Expected: all 12 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add web/src/routes/admin/face-cleanup/scan/ReviewFirstLane.svelte \
  web/src/routes/admin/face-cleanup/scan/ReviewFirstLane.spec.ts i18n/en.json
git commit -m "fix(web): align the review-lane columns and give them headings"
```

---

### Task 2: ConfidentLane — chips open the per-cluster review page

**Files:**

- Modify: `web/src/routes/admin/face-cleanup/scan/ConfidentLane.svelte`
- Test: `web/src/routes/admin/face-cleanup/scan/ConfidentLane.spec.ts`

**Interfaces:**

- Consumes: `Route.viewFaceCleanupPerson({ id })` from `$lib/route` (→ `/admin/face-cleanup/{id}`), existing `ScanTriageModel` (`isExcluded` / `toggleExcluded`).
- Produces: `data-testid="confident-open-{personId}"` on each chip's anchor. Existing `confident-exclude-{personId}` testids and behavior are preserved — `page.spec.ts` and the e2e suite rely on them.

- [ ] **Step 1: Write the failing tests**

In `web/src/routes/admin/face-cleanup/scan/ConfidentLane.spec.ts`, add to the imports:

```ts
import { Route } from '$lib/route';
```

Append these tests inside the existing `describe('ConfidentLane', …)` block:

```ts
it('each spot-check card is a link to the per-cluster review page', async () => {
  const model = createScanTriageModel([conf('c1')]);
  render(ConfidentLane, { props: { model, applying: false, onApprove: vi.fn() } });
  await fireEvent.click(screen.getByTestId('confident-toggle'));
  expect(screen.getByTestId('confident-open-c1')).toHaveAttribute('href', Route.viewFaceCleanupPerson({ id: 'c1' }));
});

it('excluding a cluster keeps its card clickable', async () => {
  const model = createScanTriageModel([conf('c1')]);
  render(ConfidentLane, { props: { model, applying: false, onApprove: vi.fn() } });
  await fireEvent.click(screen.getByTestId('confident-toggle'));
  await fireEvent.click(screen.getByTestId('confident-exclude-c1'));
  expect(model.isExcluded('c1')).toBe(true);
  expect(screen.getByTestId('confident-open-c1')).toHaveAttribute('href', Route.viewFaceCleanupPerson({ id: 'c1' }));
});
```

- [ ] **Step 2: Run the spec file to verify the new tests fail**

Run: `cd web && pnpm exec vitest run src/routes/admin/face-cleanup/scan/ConfidentLane.spec.ts`
Expected: the 2 new tests FAIL (`Unable to find an element by: [data-testid="confident-open-c1"]`); the 7 pre-existing tests still PASS.

- [ ] **Step 3: Implement the chip restructure**

In `web/src/routes/admin/face-cleanup/scan/ConfidentLane.svelte`:

**3a.** Add to the script imports:

```ts
import { Route } from '$lib/route';
```

**3b.** Replace the chip markup inside the `{#each model.confident as person (person.personId)}` block (the current `<div class={['flex items-center gap-2.5 …>` … `</div>` including the img, text, and exclude button) with:

```svelte
<!-- Whole-chip link to the same per-cluster review page the review lane uses, so an admin can see
     exactly what the auto-fix will do to a cluster before approving it. The exclude button cannot nest
     inside the anchor, so it overlays the anchor's reserved right padding as an absolute sibling (same
     pattern as ReviewFirstLane's dismiss). Excluded chips stay clickable — dimmed, not dead. -->
<div
  class={[
    'relative rounded-xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800',
    excluded ? 'opacity-40' : '',
  ].join(' ')}
>
  <a
    href={Route.viewFaceCleanupPerson({ id: person.personId })}
    class="flex items-center gap-2.5 rounded-xl p-2.5 pr-10 transition-colors hover:bg-gray-50 dark:hover:bg-gray-700/50"
    data-testid={`confident-open-${person.personId}`}
  >
    <img
      src={getAdminFaceThumbnailUrl(person.thumbnailFaceId ?? '')}
      alt=""
      loading="lazy"
      class="size-8 flex-none rounded-lg bg-gray-100 object-cover dark:bg-gray-700"
    />
    <div class="min-w-0 flex-1">
      <div class="truncate text-xs font-semibold text-gray-900 dark:text-white">
        {person.personName ?? $t('admin.face_cleanup_unnamed')} · {person.faceCount}
      </div>
      <div class="truncate text-[11px] text-gray-400">
        {Math.round(person.flaggedFraction * 100)}% → {dest?.ownerName ?? $t('admin.face_cleanup_unnamed')}
      </div>
    </div>
  </a>
  <button
    type="button"
    class="absolute top-1/2 right-2.5 z-10 flex size-6 -translate-y-1/2 items-center justify-center rounded-md bg-gray-100 text-gray-400 hover:text-gray-600 dark:bg-gray-700 dark:hover:text-gray-200"
    aria-pressed={excluded}
    aria-label={$t('admin.face_cleanup_confident_exclude')}
    title={$t('admin.face_cleanup_confident_exclude')}
    onclick={() => model.toggleExcluded(person.personId)}
    data-testid={`confident-exclude-${person.personId}`}
  >
    <Icon icon={mdiClose} size="14" />
  </button>
</div>
```

The `{@const excluded = …}` and `{@const dest = …}` lines above the chip stay exactly as they are. Layout notes: the chip's former `p-2.5` padding moves onto the anchor with `pr-10` reserving the exclude-button slot; `opacity-40` stays on the outer wrapper so an excluded chip dims as a whole while both the link and the button keep working. No extra state handling is needed for stale lanes: returning from the review page remounts the scan page, which refetches the latest scan (`loadInitial` in `scan/+page.svelte`), so a cluster resolved on the detail page drops out of the lane by itself.

- [ ] **Step 4: Run the spec file to verify all tests pass**

Run: `cd web && pnpm exec vitest run src/routes/admin/face-cleanup/scan/ConfidentLane.spec.ts`
Expected: all 9 tests PASS — including the pre-existing exclude-toggle tests, which prove the restructure didn't break `toggleExcluded`.

- [ ] **Step 5: Commit**

```bash
git add web/src/routes/admin/face-cleanup/scan/ConfidentLane.svelte \
  web/src/routes/admin/face-cleanup/scan/ConfidentLane.spec.ts
git commit -m "feat(web): make auto-fix spot-check chips open the per-cluster review page"
```

---

### Task 3: Full verification gate

**Files:**

- Modify: none expected (formatting fallout only, if any).

**Interfaces:**

- Consumes: Tasks 1–2 committed.
- Produces: a green local gate for the branch.

- [ ] **Step 1: Prettier over the touched files**

Run from the worktree root:

```bash
pnpm exec prettier --write \
  web/src/routes/admin/face-cleanup/scan/ReviewFirstLane.svelte \
  web/src/routes/admin/face-cleanup/scan/ReviewFirstLane.spec.ts \
  web/src/routes/admin/face-cleanup/scan/ConfidentLane.svelte \
  web/src/routes/admin/face-cleanup/scan/ConfidentLane.spec.ts \
  i18n/en.json
git status --short
```

Expected: no files change (`git status` clean). If prettier rewrote anything, re-run the two spec files (`cd web && pnpm exec vitest run src/routes/admin/face-cleanup/scan/ReviewFirstLane.spec.ts src/routes/admin/face-cleanup/scan/ConfidentLane.spec.ts`), then commit the fallout as `style(web): prettier fallout on face-cleanup scan lanes`.

- [ ] **Step 2: Scan-directory unit tests**

Run: `cd web && pnpm exec vitest run src/routes/admin/face-cleanup/`
Expected: all spec files in the directory PASS (`ConfidentLane`, `ReviewFirstLane`, `AdvancedScanModal`, `page.spec`, `scan-triage`, plus the `[personId]` and `people` specs) — this catches cross-component fallout like `page.spec.ts` relying on the lanes' testids.

- [ ] **Step 3: Type check**

Run: `cd web && pnpm run check:typescript`
Expected: exit 0, no errors. This also proves the new `$t('admin.face_cleanup_col_*')` keys resolve against the generated translation types from `i18n/en.json`.

- [ ] **Step 4: Svelte check**

Run: `cd web && pnpm run check:svelte`
Expected: exit 0. If it reports scanning 0 files, note that in the task report as the known local anomaly — CI is the real gate for this check.

- [ ] **Step 5: Lint**

Run: `cd web && pnpm lint`
Expected: exit 0 with zero warnings.

- [ ] **Step 6: Full web unit suite**

Run: `cd web && pnpm exec vitest run`
Expected: all tests PASS.

- [ ] **Step 7: Report**

Nothing to commit in this task unless Step 1 produced formatting fallout. Report gate results; pushing the branch and dispatching CI (`gh workflow run test.yml --ref feat/face-manual-review` — feature branches get no automatic CI) stays with Pierre.
