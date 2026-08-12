# Face-cleanup scan two-lane redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. This plan is sliced for `impl-loop`: Slices 1–3 add new, isolated, independently-green files; Slice 4 is the atomic swap that wires them in and deletes the old UI.

**Goal:** Replace the cluttered guided face-cleanup scan console with a two-lane triage layout — a confident "Approve all" bulk with spot-check exclusions, and a clickable review-first list — killing the disabled checkboxes and the checklist/stat-strip/filter/selection clutter.

**Architecture:** A new selection model (`createScanTriageModel`) reduces selection to an _exclusion set_ over the confident clusters (default: approve all). Two presentational lane components (`ConfidentLane`, `ReviewFirstLane`) consume it. The scan page composes the lanes and keeps every existing load/scan/apply/dismiss handler and non-completed state. The old `ScanChecklist`, `FaceCleanupTable`, and `face-cleanup.svelte.ts` model are deleted in the final slice.

**Tech Stack:** SvelteKit + Svelte 5 runes, `@immich/ui`, Tailwind 4 (gallery-theme tokens), `@immich/sdk`, Vitest + @testing-library/svelte (happy-dom).

**Design spec:** `docs/superpowers/specs/2026-07-24-face-cleanup-scan-two-lane-redesign-design.md`
**Visual source of truth (exact colours/spacing):** https://claude.ai/code/artifact/b624de73-bd82-4717-a371-2f2f0a306a41

## Global Constraints

- **Svelte 5 runes** (`$props`, `$state`, `$derived`, `$effect`); match the idiom of the surrounding files.
- **No relative imports** across `src/` in web — use `$lib/...`; same-directory route imports use `./`.
- **Prettier**: 120 cols, single quotes, trailing commas, semicolons. Run `pnpm exec prettier --write` on every changed file.
- **ESLint**: zero warnings — `pnpm exec eslint <files> --max-warnings 0` must pass (the `better-tailwindcss` plugin reorders/​canonicalises classes; run `eslint --fix`).
- **`check:svelte` is blind locally** (push-only gate) — keep script types clean by hand; do not rely on local svelte-check.
- **i18n**: new keys go in `i18n/en.json` only; before deleting a key, grep BOTH `web/` and `mobile/` (shared dir).
- **Styling** follows the approved mockup and reuses existing gallery-theme utility patterns already in `FaceCleanupTable.svelte` / `ScanChecklist.svelte` (`rounded-2xl`, `border-gray-200 dark:border-gray-700`, `bg-white dark:bg-gray-800`, `text-primary`, amber/green/red semantics, `dark:` on everything).
- **Safety semantics unchanged**: review-first clusters are never in the confident bulk; the confident bulk commit is the existing `resolvePersonToOwners` per approved cluster.
- **Test commands** (from `web/`): single file `pnpm exec vitest run <path>`; never `pnpm test -- --run <path>` (drops the filter). `[personId]` paths must be single-quoted in zsh.
- **Frequent commits**: one commit per completed step-group as marked.

---

## File Structure

- **Create** `web/src/routes/admin/face-cleanup/scan/scan-triage.svelte.ts` — the exclusion-set selection model + `FaceCleanupPerson` type (moved from the old model file).
- **Create** `web/src/routes/admin/face-cleanup/scan/scan-triage.spec.ts` — model unit tests.
- **Create** `web/src/routes/admin/face-cleanup/scan/ConfidentLane.svelte` — confident bulk lane (Approve all + spot-check exclude).
- **Create** `web/src/routes/admin/face-cleanup/scan/ConfidentLane.spec.ts`.
- **Create** `web/src/routes/admin/face-cleanup/scan/ReviewFirstLane.svelte` — review-first clickable list + search + dismiss.
- **Create** `web/src/routes/admin/face-cleanup/scan/ReviewFirstLane.spec.ts`.
- **Modify** `web/src/routes/admin/face-cleanup/scan/+page.svelte` — compose the lanes; drop checklist/stat-strip/filter/selection markup; keep every handler + non-completed state.
- **Rewrite** `web/src/routes/admin/face-cleanup/scan/page.spec.ts` — two-lane assertions + surviving state tests.
- **Modify** `i18n/en.json` — add lane keys, remove dead checklist/filter/selection keys.
- **Delete** `web/src/routes/admin/face-cleanup/scan/ScanChecklist.svelte`, `ScanChecklist.spec.ts`, `FaceCleanupTable.svelte`, `face-cleanup.svelte.ts`, `face-cleanup.spec.ts`.

---

## Task 1: Selection model — exclusion set

**Files:**

- Create: `web/src/routes/admin/face-cleanup/scan/scan-triage.svelte.ts`
- Test: `web/src/routes/admin/face-cleanup/scan/scan-triage.spec.ts`

**Interfaces:**

- Consumes: nothing.
- Produces:
  - `interface FaceCleanupPerson` (fields: `personId, ownerId, personName: string|null, faceCount, thumbnailFaceId: string|null, eligible, flagged, flaggedFraction, suspectedOwners: {ownerPersonId, ownerName: string|null, thumbnailFaceId: string|null, count}[], recommendation: 'confident'|'review-first', reviewReasons: string[]`).
  - `interface ScanTriageModel { readonly confident: FaceCleanupPerson[]; readonly reviewFirst: FaceCleanupPerson[]; readonly excluded: Set<string>; readonly approvedIds: string[]; readonly approvedCount: number; isExcluded(id: string): boolean; toggleExcluded(id: string): void; reset(): void }`.
  - `interface ScanTriageModelOptions { prev?: ScanTriageModel | null }`.
  - `function createScanTriageModel(persons: FaceCleanupPerson[], options?: ScanTriageModelOptions): ScanTriageModel`.

- [ ] **Step 1: Write the failing model spec**

Create `scan-triage.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { createScanTriageModel, type FaceCleanupPerson } from './scan-triage.svelte';

const person = (
  over: Partial<FaceCleanupPerson> & Pick<FaceCleanupPerson, 'personId' | 'recommendation'>,
): FaceCleanupPerson => ({
  ownerId: 'owner-1',
  personName: null,
  faceCount: 10,
  thumbnailFaceId: 'face-1',
  eligible: 10,
  flagged: 3,
  flaggedFraction: 0.3,
  suspectedOwners: [{ ownerPersonId: 'dest-1', ownerName: 'Dest', thumbnailFaceId: 'f', count: 3 }],
  reviewReasons: [],
  ...over,
});

const conf = (id: string) => person({ personId: id, recommendation: 'confident' });
const rev = (id: string) => person({ personId: id, recommendation: 'review-first' });

describe('createScanTriageModel', () => {
  it('splits confident and review-first clusters', () => {
    const m = createScanTriageModel([conf('c1'), rev('r1'), conf('c2')]);
    expect(m.confident.map((p) => p.personId)).toEqual(['c1', 'c2']);
    expect(m.reviewFirst.map((p) => p.personId)).toEqual(['r1']);
  });

  it('approves every confident cluster by default (no exclusions)', () => {
    const m = createScanTriageModel([conf('c1'), conf('c2'), rev('r1')]);
    expect(m.excluded.size).toBe(0);
    expect(m.approvedIds).toEqual(['c1', 'c2']);
    expect(m.approvedCount).toBe(2);
  });

  it('excluding a confident cluster drops it from the approved set and count', () => {
    const m = createScanTriageModel([conf('c1'), conf('c2')]);
    m.toggleExcluded('c1');
    expect(m.isExcluded('c1')).toBe(true);
    expect(m.approvedIds).toEqual(['c2']);
    expect(m.approvedCount).toBe(1);
  });

  it('re-including a previously excluded cluster restores it', () => {
    const m = createScanTriageModel([conf('c1'), conf('c2')]);
    m.toggleExcluded('c1');
    m.toggleExcluded('c1');
    expect(m.isExcluded('c1')).toBe(false);
    expect(m.approvedIds).toEqual(['c1', 'c2']);
  });

  it('never lets a review-first id enter the exclusion set (it is not in the bulk)', () => {
    const m = createScanTriageModel([conf('c1'), rev('r1')]);
    m.toggleExcluded('r1');
    expect(m.excluded.size).toBe(0);
    expect(m.approvedIds).toEqual(['c1']);
  });

  it('reset() clears all exclusions (approve all again)', () => {
    const m = createScanTriageModel([conf('c1'), conf('c2')]);
    m.toggleExcluded('c1');
    m.reset();
    expect(m.excluded.size).toBe(0);
    expect(m.approvedIds).toEqual(['c1', 'c2']);
  });

  it('carries exclusions across a rebuild via prev, dropping ones whose cluster no longer exists', () => {
    const first = createScanTriageModel([conf('c1'), conf('c2'), conf('c3')]);
    first.toggleExcluded('c1');
    first.toggleExcluded('c3');
    // c3 was dismissed/re-homed and is gone from the new snapshot.
    const second = createScanTriageModel([conf('c1'), conf('c2')], { prev: first });
    expect(second.isExcluded('c1')).toBe(true);
    expect([...second.excluded]).toEqual(['c1']); // c3 dropped
    expect(second.approvedIds).toEqual(['c2']);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm exec vitest run src/routes/admin/face-cleanup/scan/scan-triage.spec.ts`
Expected: FAIL — cannot find module `./scan-triage.svelte`.

- [ ] **Step 3: Write the model**

Create `scan-triage.svelte.ts`:

```ts
import { SvelteSet } from 'svelte/reactivity';

// Moved verbatim from the deleted face-cleanup.svelte.ts model — the row shape the scan snapshot's persons
// deserialise into.
export interface FaceCleanupPerson {
  personId: string;
  ownerId: string;
  personName: string | null;
  faceCount: number;
  thumbnailFaceId: string | null;
  eligible: number;
  flagged: number;
  flaggedFraction: number;
  suspectedOwners: { ownerPersonId: string; ownerName: string | null; thumbnailFaceId: string | null; count: number }[];
  recommendation: 'confident' | 'review-first';
  reviewReasons: string[];
}

export interface ScanTriageModel {
  readonly confident: FaceCleanupPerson[];
  readonly reviewFirst: FaceCleanupPerson[];
  readonly excluded: Set<string>;
  readonly approvedIds: string[];
  readonly approvedCount: number;
  isExcluded(id: string): boolean;
  toggleExcluded(id: string): void;
  reset(): void;
}

export interface ScanTriageModelOptions {
  // The previous model, when rebuilding after a refetch/dismiss: the admin's exclusions carry over,
  // intersected with the confident clusters that survived, so a dismissed/re-homed cluster leaves no
  // dangling exclusion.
  prev?: ScanTriageModel | null;
}

export function createScanTriageModel(persons: FaceCleanupPerson[], options?: ScanTriageModelOptions): ScanTriageModel {
  const confident = persons.filter((p) => p.recommendation === 'confident');
  const reviewFirst = persons.filter((p) => p.recommendation === 'review-first');
  const confidentIds = new SvelteSet(confident.map((p) => p.personId));

  const excluded: SvelteSet<string> = new SvelteSet(
    [...(options?.prev?.excluded ?? [])].filter((id) => confidentIds.has(id)),
  );

  return {
    confident,
    reviewFirst,
    excluded,
    get approvedIds() {
      return confident.filter((p) => !excluded.has(p.personId)).map((p) => p.personId);
    },
    get approvedCount() {
      return this.approvedIds.length;
    },
    isExcluded(id: string): boolean {
      return excluded.has(id);
    },
    toggleExcluded(id: string): void {
      // Only confident clusters can be excluded — review-first is never part of the bulk.
      if (!confidentIds.has(id)) {
        return;
      }
      if (excluded.has(id)) {
        excluded.delete(id);
      } else {
        excluded.add(id);
      }
    },
    reset(): void {
      excluded.clear();
    },
  };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm exec vitest run src/routes/admin/face-cleanup/scan/scan-triage.spec.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Lint + format + commit**

```bash
pnpm exec prettier --write src/routes/admin/face-cleanup/scan/scan-triage.svelte.ts src/routes/admin/face-cleanup/scan/scan-triage.spec.ts
pnpm exec eslint --fix src/routes/admin/face-cleanup/scan/scan-triage.svelte.ts src/routes/admin/face-cleanup/scan/scan-triage.spec.ts
pnpm exec eslint src/routes/admin/face-cleanup/scan/scan-triage.svelte.ts src/routes/admin/face-cleanup/scan/scan-triage.spec.ts --max-warnings 0
git add src/routes/admin/face-cleanup/scan/scan-triage.svelte.ts src/routes/admin/face-cleanup/scan/scan-triage.spec.ts
git commit -m "feat(web): add exclusion-set selection model for scan triage"
```

---

## Task 2: ConfidentLane component

**Files:**

- Create: `web/src/routes/admin/face-cleanup/scan/ConfidentLane.svelte`
- Test: `web/src/routes/admin/face-cleanup/scan/ConfidentLane.spec.ts`

**Interfaces:**

- Consumes: `ScanTriageModel` from Task 1; `getAdminFaceThumbnailUrl` from `$lib/utils/people-utils`.
- Produces (props): `{ model: ScanTriageModel; applying: boolean; onApprove: () => void }`. Renders nothing if `model.confident.length === 0`. Testids: `confident-lane`, `confident-approve` (button, text `admin.face_cleanup_confident_approve` with `{count}` = `approvedCount`), `confident-toggle` (expand/collapse), `confident-spotcheck` (grid, only when expanded), `confident-exclude-<personId>` (per-card exclude button).

- [ ] **Step 1: Write the failing spec**

Create `ConfidentLane.spec.ts`. Reuse the sibling mock pattern (Icon → noop, `$t` → key passthrough):

```ts
import '@testing-library/jest-dom';
import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import ConfidentLane from './ConfidentLane.svelte';
import { createScanTriageModel, type FaceCleanupPerson } from './scan-triage.svelte';

vi.mock('@immich/ui', async (orig) => {
  const mod = await orig<typeof import('@immich/ui')>();
  const noop = await import('@test-data/mocks/noop-component.svelte');
  return { ...mod, Icon: noop.default };
});
vi.mock('svelte-i18n', async (orig) => {
  const actual = await orig<typeof import('svelte-i18n')>();
  return {
    ...actual,
    t: {
      subscribe: (run: (fn: (k: string, o?: unknown) => string) => void) => {
        run((k) => k);
        return () => {};
      },
    },
  };
});
vi.mock('$lib/utils/people-utils', () => ({ getAdminFaceThumbnailUrl: (id: string) => `/thumb/${id}` }));

const conf = (id: string): FaceCleanupPerson => ({
  personId: id,
  ownerId: 'o',
  personName: null,
  faceCount: 10,
  thumbnailFaceId: `t-${id}`,
  eligible: 10,
  flagged: 2,
  flaggedFraction: 0.2,
  suspectedOwners: [{ ownerPersonId: 'd', ownerName: 'Dest', thumbnailFaceId: 'f', count: 2 }],
  recommendation: 'confident',
  reviewReasons: [],
});

describe('ConfidentLane', () => {
  it('renders nothing when there are no confident clusters', () => {
    const model = createScanTriageModel([{ ...conf('r'), recommendation: 'review-first' }]);
    render(ConfidentLane, { props: { model, applying: false, onApprove: vi.fn() } });
    expect(screen.queryByTestId('confident-lane')).not.toBeInTheDocument();
  });

  it('offers to approve every confident cluster by default', () => {
    const model = createScanTriageModel([conf('c1'), conf('c2'), conf('c3')]);
    render(ConfidentLane, { props: { model, applying: false, onApprove: vi.fn() } });
    expect(screen.getByTestId('confident-approve')).toHaveTextContent('3');
  });

  it('approve button invokes onApprove', async () => {
    const model = createScanTriageModel([conf('c1')]);
    const onApprove = vi.fn();
    render(ConfidentLane, { props: { model, applying: false, onApprove } });
    await fireEvent.click(screen.getByTestId('confident-approve'));
    expect(onApprove).toHaveBeenCalledTimes(1);
  });

  it('approve button is disabled while applying', () => {
    const model = createScanTriageModel([conf('c1')]);
    render(ConfidentLane, { props: { model, applying: true, onApprove: vi.fn() } });
    expect(screen.getByTestId('confident-approve')).toBeDisabled();
  });

  it('expanding reveals a spot-check card per confident cluster', async () => {
    const model = createScanTriageModel([conf('c1'), conf('c2')]);
    render(ConfidentLane, { props: { model, applying: false, onApprove: vi.fn() } });
    expect(screen.queryByTestId('confident-spotcheck')).not.toBeInTheDocument();
    await fireEvent.click(screen.getByTestId('confident-toggle'));
    const grid = screen.getByTestId('confident-spotcheck');
    expect(within(grid).getByTestId('confident-exclude-c1')).toBeInTheDocument();
    expect(within(grid).getByTestId('confident-exclude-c2')).toBeInTheDocument();
  });

  it('excluding a cluster drops the approve count and re-including restores it', async () => {
    const model = createScanTriageModel([conf('c1'), conf('c2')]);
    render(ConfidentLane, { props: { model, applying: false, onApprove: vi.fn() } });
    await fireEvent.click(screen.getByTestId('confident-toggle'));
    await fireEvent.click(screen.getByTestId('confident-exclude-c1'));
    expect(model.approvedIds).toEqual(['c2']);
    expect(screen.getByTestId('confident-approve')).toHaveTextContent('1');
    await fireEvent.click(screen.getByTestId('confident-exclude-c1'));
    expect(model.approvedIds).toEqual(['c1', 'c2']);
    expect(screen.getByTestId('confident-approve')).toHaveTextContent('2');
  });

  it('disables approve when every cluster is excluded', async () => {
    const model = createScanTriageModel([conf('c1')]);
    render(ConfidentLane, { props: { model, applying: false, onApprove: vi.fn() } });
    await fireEvent.click(screen.getByTestId('confident-toggle'));
    await fireEvent.click(screen.getByTestId('confident-exclude-c1'));
    expect(screen.getByTestId('confident-approve')).toBeDisabled();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm exec vitest run src/routes/admin/face-cleanup/scan/ConfidentLane.spec.ts`
Expected: FAIL — cannot find `./ConfidentLane.svelte`.

- [ ] **Step 3: Write the component**

Create `ConfidentLane.svelte`. Full logic below; apply the mockup's green-identity styling using the existing gallery-theme utilities (green tile, `bg-white dark:bg-gray-800`, `rounded-2xl border-gray-200 dark:border-gray-700`). Face thumbs via `getAdminFaceThumbnailUrl`.

```svelte
<script lang="ts">
  import { getAdminFaceThumbnailUrl } from '$lib/utils/people-utils';
  import { Icon } from '@immich/ui';
  import { mdiArrowRight, mdiCheckCircle, mdiChevronDown, mdiClose } from '@mdi/js';
  import { t } from 'svelte-i18n';
  import type { ScanTriageModel } from './scan-triage.svelte';

  type Props = { model: ScanTriageModel; applying: boolean; onApprove: () => void };
  const { model, applying, onApprove }: Props = $props();

  let expanded = $state(false);
  const excludedCount = $derived(model.confident.length - model.approvedCount);
</script>

{#if model.confident.length > 0}
  <section
    class="relative overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800"
    data-testid="confident-lane"
  >
    <div class="flex flex-wrap items-center gap-4 p-5">
      <div
        class="flex size-11 flex-none items-center justify-center rounded-2xl bg-green-50 text-green-600 ring-1 ring-inset ring-green-100 dark:bg-green-900/25 dark:text-green-400 dark:ring-green-900/40"
      >
        <Icon icon={mdiCheckCircle} size="22" />
      </div>
      <div class="min-w-0 flex-1">
        <div class="flex items-baseline gap-2.5">
          <h2 class="text-base font-semibold text-gray-900 dark:text-white">{$t('admin.face_cleanup_confident_title')}</h2>
          <span class="text-sm font-bold text-gray-500 tabular-nums">
            {$t('admin.face_cleanup_confident_count', { values: { count: model.confident.length } })}
          </span>
        </div>
        <p class="mt-0.5 text-sm text-gray-500 dark:text-gray-400">{$t('admin.face_cleanup_confident_sub')}</p>
      </div>
      <div class="flex items-center gap-3">
        <button
          type="button"
          class="inline-flex items-center gap-1.5 text-sm font-semibold text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
          onclick={() => (expanded = !expanded)}
          data-testid="confident-toggle"
        >
          {expanded ? $t('admin.face_cleanup_confident_hide') : $t('admin.face_cleanup_confident_review')}
          <Icon icon={mdiChevronDown} size="16" class={expanded ? 'rotate-180 transition-transform' : 'transition-transform'} />
        </button>
        <button
          type="button"
          class="inline-flex items-center gap-2 rounded-full bg-green-600 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-green-700 disabled:opacity-40"
          disabled={applying || model.approvedCount === 0}
          onclick={onApprove}
          data-testid="confident-approve"
        >
          {$t('admin.face_cleanup_confident_approve', { values: { count: model.approvedCount } })}
          <Icon icon={mdiArrowRight} size="17" />
        </button>
      </div>
    </div>

    {#if expanded}
      <div class="border-t border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-900/40" data-testid="confident-spotcheck">
        <div class="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {#each model.confident as person (person.personId)}
            {@const excluded = model.isExcluded(person.personId)}
            {@const dest = person.suspectedOwners[0]}
            <div
              class={[
                'flex items-center gap-2.5 rounded-xl border border-gray-200 bg-white p-2.5 dark:border-gray-700 dark:bg-gray-800',
                excluded ? 'opacity-40' : '',
              ].join(' ')}
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
              <button
                type="button"
                class="flex size-6 flex-none items-center justify-center rounded-md bg-gray-100 text-gray-400 hover:text-gray-600 dark:bg-gray-700 dark:hover:text-gray-200"
                aria-pressed={excluded}
                aria-label={$t('admin.face_cleanup_confident_exclude')}
                title={$t('admin.face_cleanup_confident_exclude')}
                onclick={() => model.toggleExcluded(person.personId)}
                data-testid={`confident-exclude-${person.personId}`}
              >
                <Icon icon={mdiClose} size="14" />
              </button>
            </div>
          {/each}
        </div>
        <div class="mt-3 text-xs text-gray-500 dark:text-gray-400" data-testid="confident-spotcheck-summary">
          {$t('admin.face_cleanup_confident_summary', {
            values: { approved: model.approvedCount, total: model.confident.length, excluded: excludedCount },
          })}
        </div>
      </div>
    {/if}
  </section>
{/if}
```

- [ ] **Step 4: Add i18n keys**

In `i18n/en.json`, add (adjust copy to taste; keep names verbatim):

```json
"face_cleanup_confident_title": "Ready to auto-fix",
"face_cleanup_confident_count": "{count} clusters",
"face_cleanup_confident_sub": "Single clean owner, unnamed — safe to re-home their flagged faces in one pass.",
"face_cleanup_confident_approve": "Approve all {count}",
"face_cleanup_confident_review": "Review them",
"face_cleanup_confident_hide": "Hide",
"face_cleanup_confident_exclude": "Exclude from this batch",
"face_cleanup_confident_summary": "{approved} of {total} will be approved · {excluded} excluded"
```

- [ ] **Step 5: Run tests, lint, format, commit**

```bash
pnpm exec vitest run src/routes/admin/face-cleanup/scan/ConfidentLane.spec.ts   # PASS (7)
pnpm exec prettier --write src/routes/admin/face-cleanup/scan/ConfidentLane.svelte src/routes/admin/face-cleanup/scan/ConfidentLane.spec.ts ../i18n/en.json
pnpm exec eslint --fix src/routes/admin/face-cleanup/scan/ConfidentLane.svelte src/routes/admin/face-cleanup/scan/ConfidentLane.spec.ts
pnpm exec eslint src/routes/admin/face-cleanup/scan/ConfidentLane.svelte src/routes/admin/face-cleanup/scan/ConfidentLane.spec.ts --max-warnings 0
git add -A && git commit -m "feat(web): add ConfidentLane with approve-all + spot-check exclude"
```

---

## Task 3: ReviewFirstLane component

**Files:**

- Create: `web/src/routes/admin/face-cleanup/scan/ReviewFirstLane.svelte`
- Test: `web/src/routes/admin/face-cleanup/scan/ReviewFirstLane.spec.ts`

**Interfaces:**

- Consumes: `FaceCleanupPerson` (Task 1); `Route.viewFaceCleanupPerson` from `$lib/route`; `UserAdminResponseDto` from `@immich/sdk`; `getAdminFaceThumbnailUrl`, `getPeopleThumbnailPath`; `UserAvatar` from `$lib/components/shared-components/UserAvatar.svelte`.
- Produces (props): `{ people: FaceCleanupPerson[]; users: UserAdminResponseDto[]; onDismiss: (personId: string) => void }`. Renders nothing when `people.length === 0`. Testids: `review-lane`, `review-search`, `review-row-<personId>` (an `<a>` with `href` = review route), `review-dismiss-<personId>` (button). Rows with `reviewReasons.includes('bad-target')` get red flagged-bar + red suspected-owner text.

- [ ] **Step 1: Write the failing spec**

Create `ReviewFirstLane.spec.ts`:

```ts
import '@testing-library/jest-dom';
import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import { Route } from '$lib/route';
import ReviewFirstLane from './ReviewFirstLane.svelte';
import type { FaceCleanupPerson } from './scan-triage.svelte';

vi.mock('@immich/ui', async (orig) => {
  const mod = await orig<typeof import('@immich/ui')>();
  const noop = await import('@test-data/mocks/noop-component.svelte');
  return { ...mod, Icon: noop.default };
});
vi.mock('svelte-i18n', async (orig) => {
  const actual = await orig<typeof import('svelte-i18n')>();
  return {
    ...actual,
    t: {
      subscribe: (run: (fn: (k: string, o?: unknown) => string) => void) => {
        run((k) => k);
        return () => {};
      },
    },
  };
});
vi.mock('$lib/utils/people-utils', () => ({
  getAdminFaceThumbnailUrl: (id: string) => `/thumb/${id}`,
  getPeopleThumbnailPath: (id: string) => `/people/${id}/thumbnail`,
}));
// Stub the confirm() the dismiss uses.
beforeEach(() =>
  vi.stubGlobal(
    'confirm',
    vi.fn(() => true),
  ),
);
afterEach(() => vi.unstubAllGlobals());

const rev = (over: Partial<FaceCleanupPerson> & Pick<FaceCleanupPerson, 'personId'>): FaceCleanupPerson => ({
  ownerId: 'owner-1',
  personName: null,
  faceCount: 35,
  thumbnailFaceId: 't',
  eligible: 35,
  flagged: 20,
  flaggedFraction: 0.57,
  suspectedOwners: [{ ownerPersonId: 'd', ownerName: 'Pierre', thumbnailFaceId: 'f', count: 20 }],
  recommendation: 'review-first',
  reviewReasons: ['over-cap'],
  ...over,
});
const users = [
  {
    id: 'owner-1',
    name: 'Owner One',
    email: 'o@e.com',
    profileImagePath: '',
    avatarColor: 'primary',
    profileChangedAt: '',
  },
] as never;

describe('ReviewFirstLane', () => {
  it('renders nothing when there is nothing to review', () => {
    render(ReviewFirstLane, { props: { people: [], users, onDismiss: vi.fn() } });
    expect(screen.queryByTestId('review-lane')).not.toBeInTheDocument();
  });

  it('renders each cluster as a row that links to its review page', () => {
    render(ReviewFirstLane, { props: { people: [rev({ personId: 'r1' })], users, onDismiss: vi.fn() } });
    const row = screen.getByTestId('review-row-r1');
    expect(row).toHaveAttribute('href', Route.viewFaceCleanupPerson({ id: 'r1' }));
    expect(row).toHaveTextContent('35'); // face count
  });

  it('dismiss button calls onDismiss for that cluster (after confirm)', async () => {
    const onDismiss = vi.fn();
    render(ReviewFirstLane, { props: { people: [rev({ personId: 'r1' })], users, onDismiss } });
    await fireEvent.click(screen.getByTestId('review-dismiss-r1'));
    expect(onDismiss).toHaveBeenCalledWith('r1');
  });

  it('search filters rows by person name or suspected-owner name', async () => {
    render(ReviewFirstLane, {
      props: {
        people: [rev({ personId: 'r1', personName: 'Alice' }), rev({ personId: 'r2', personName: 'Bob' })],
        users,
        onDismiss: vi.fn(),
      },
    });
    await fireEvent.input(screen.getByTestId('review-search'), { target: { value: 'alice' } });
    expect(screen.getByTestId('review-row-r1')).toBeInTheDocument();
    expect(screen.queryByTestId('review-row-r2')).not.toBeInTheDocument();
  });

  it('marks a bad-target row as a weak/uncertain destination', () => {
    render(ReviewFirstLane, {
      props: { people: [rev({ personId: 'r1', reviewReasons: ['bad-target'] })], users, onDismiss: vi.fn() },
    });
    expect(screen.getByTestId('review-row-r1')).toHaveTextContent('admin.face_cleanup_bad_target');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm exec vitest run src/routes/admin/face-cleanup/scan/ReviewFirstLane.spec.ts`
Expected: FAIL — cannot find `./ReviewFirstLane.svelte`.

- [ ] **Step 3: Write the component**

Create `ReviewFirstLane.svelte`. The clickable area is a **stretched `<a>`** (`absolute inset-0`) so the whole row navigates; the dismiss button sits above it with `relative z-10`. Port the row internals (flagged bar, suspected owner, reason tags) from the deleted `FaceCleanupTable.svelte`. Apply the mockup's amber-identity lane styling.

```svelte
<script lang="ts">
  import UserAvatar from '$lib/components/shared-components/UserAvatar.svelte';
  import { Route } from '$lib/route';
  import { getAdminFaceThumbnailUrl, getPeopleThumbnailPath } from '$lib/utils/people-utils';
  import type { UserAdminResponseDto } from '@immich/sdk';
  import { Icon } from '@immich/ui';
  import { mdiAlertCircle, mdiArrowRight, mdiChevronRight, mdiClose, mdiMagnify } from '@mdi/js';
  import { t, type Translations } from 'svelte-i18n';
  import type { FaceCleanupPerson } from './scan-triage.svelte';

  type Props = { people: FaceCleanupPerson[]; users: UserAdminResponseDto[]; onDismiss: (personId: string) => void };
  const { people, users, onDismiss }: Props = $props();

  const usersById = $derived(new Map(users.map((u) => [u.id, u])));
  let query = $state('');

  const thumbUrl = (personId: string, thumbnailFaceId: string | null) =>
    thumbnailFaceId ? getAdminFaceThumbnailUrl(thumbnailFaceId) : `/api${getPeopleThumbnailPath(personId)}`;

  const reasonKeys: Record<string, string> = {
    'over-cap': 'admin.face_cleanup_reason_over_cap',
    named: 'admin.face_cleanup_reason_named',
    'large-cluster': 'admin.face_cleanup_reason_large_cluster',
    'multiple-owners': 'admin.face_cleanup_reason_multiple_owners',
    'bad-target': 'admin.face_cleanup_reason_bad_target',
  };

  const matches = (p: FaceCleanupPerson) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    const name = (p.personName ?? '').toLowerCase();
    const owner = p.suspectedOwners.map((o) => (o.ownerName ?? '').toLowerCase()).join(' ');
    return name.includes(q) || owner.includes(q);
  };
  const visible = $derived(people.filter(matches));

  const handleDismiss = (p: FaceCleanupPerson) => {
    if (confirm($t('admin.face_cleanup_dismiss_confirm', { values: { name: p.personName ?? p.personId } }))) {
      onDismiss(p.personId);
    }
  };
</script>

{#if people.length > 0}
  <section
    class="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800"
    data-testid="review-lane"
  >
    <div class="flex flex-wrap items-center gap-4 p-5">
      <div
        class="flex size-11 flex-none items-center justify-center rounded-2xl bg-amber-50 text-amber-600 ring-1 ring-inset ring-amber-100 dark:bg-amber-900/25 dark:text-amber-400 dark:ring-amber-900/40"
      >
        <Icon icon={mdiAlertCircle} size="22" />
      </div>
      <div class="min-w-0 flex-1">
        <div class="flex items-baseline gap-2.5">
          <h2 class="text-base font-semibold text-gray-900 dark:text-white">{$t('admin.face_cleanup_review_lane_title')}</h2>
          <span class="text-sm font-bold text-gray-500 tabular-nums">
            {$t('admin.face_cleanup_confident_count', { values: { count: people.length } })}
          </span>
        </div>
        <p class="mt-0.5 text-sm text-gray-500 dark:text-gray-400">{$t('admin.face_cleanup_review_lane_sub')}</p>
      </div>
      {#if people.length > 6}
        <div class="flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-1.5 dark:border-gray-700 dark:bg-gray-900/40">
          <Icon icon={mdiMagnify} size="16" class="flex-none text-gray-300" />
          <input
            bind:value={query}
            placeholder={$t('admin.face_cleanup_people_search_placeholder')}
            class="w-40 bg-transparent text-sm focus:outline-none"
            data-testid="review-search"
          />
        </div>
      {/if}
    </div>

    <div class="border-t border-gray-200 dark:border-gray-700">
      {#each visible as person (person.personId)}
        {@const dest = person.suspectedOwners[0]}
        {@const owner = usersById.get(person.ownerId)}
        {@const bad = person.reviewReasons.includes('bad-target')}
        {@const pct = Math.round(person.flaggedFraction * 100)}
        <div
          class="relative flex items-center gap-4 border-b border-gray-200 px-5 py-3 transition-colors last:border-b-0 hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800/50 [&:hover_[data-dismiss]]:opacity-100"
        >
          <!-- Stretched link makes the whole row navigate; the dismiss button below sits above it. -->
          <a
            href={Route.viewFaceCleanupPerson({ id: person.personId })}
            aria-label={$t('admin.face_cleanup_review')}
            class="absolute inset-0"
            data-testid={`review-row-${person.personId}`}
          ></a>

          <img src={thumbUrl(person.personId, person.thumbnailFaceId)} alt="" loading="lazy" class="size-10 flex-none rounded-xl bg-gray-100 object-cover dark:bg-gray-700" />
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-2">
              <span class={person.personName ? 'truncate text-sm font-semibold' : 'truncate text-sm font-medium text-gray-400 italic'}>
                {person.personName ?? $t('admin.face_cleanup_unnamed')}
              </span>
              {#if owner}
                <span class="inline-flex items-center gap-1 text-xs text-gray-400"><UserAvatar user={owner} size="tiny" />{owner.name}</span>
              {/if}
            </div>
            <div class="mt-0.5 font-mono text-xs text-gray-400">{person.personId.slice(0, 8)} · {person.faceCount} {$t('admin.face_cleanup_faces')}</div>
          </div>

          <div class="hidden w-32 flex-none sm:block">
            <div class="flex items-baseline justify-between"><span class="text-sm font-bold tabular-nums">{pct}%</span><span class="text-xs text-gray-400 tabular-nums">{person.flagged}/{person.faceCount}</span></div>
            <div class="mt-1 h-1.5 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-700">
              <div class={['h-full rounded-full', bad ? 'bg-red-500' : 'bg-amber-400'].join(' ')} style={`width:${pct}%`}></div>
            </div>
          </div>

          <div class="hidden w-36 flex-none items-center gap-2 md:flex">
            {#if dest}
              <Icon icon={mdiArrowRight} size="16" class="flex-none text-gray-300" />
              <div class="min-w-0">
                <div class="truncate text-sm font-semibold">{dest.ownerName ?? $t('admin.face_cleanup_unnamed')}</div>
                <div class={bad ? 'text-xs text-red-500' : 'text-xs text-green-600'}>
                  {bad ? $t('admin.face_cleanup_bad_target') : `${dest.count} ${$t('admin.face_cleanup_faces')}`}
                </div>
              </div>
            {:else}
              <span class="text-xs text-gray-400">{$t('admin.face_cleanup_unattributable')}</span>
            {/if}
          </div>

          <div class="hidden max-w-[10rem] flex-wrap justify-end gap-1 lg:flex">
            {#each person.reviewReasons as reason (reason)}
              <span class={['rounded-md px-1.5 py-0.5 text-[10px]', reason === 'bad-target' ? 'bg-red-50 text-red-500 dark:bg-red-900/20 dark:text-red-400' : 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400'].join(' ')}>
                {reasonKeys[reason] ? $t(reasonKeys[reason] as Translations) : reason}
              </span>
            {/each}
          </div>

          <button
            type="button"
            class="relative z-10 flex size-8 flex-none items-center justify-center rounded-lg text-gray-400 opacity-0 transition-opacity hover:bg-gray-100 hover:text-gray-600 focus:opacity-100 dark:hover:bg-gray-700"
            aria-label={$t('admin.face_cleanup_dismiss')}
            title={$t('admin.face_cleanup_dismiss')}
            data-dismiss
            onclick={() => handleDismiss(person)}
            data-testid={`review-dismiss-${person.personId}`}
          >
            <Icon icon={mdiClose} size="16" />
          </button>
          <span class="relative z-0 flex-none text-gray-300"><Icon icon={mdiChevronRight} size="18" /></span>
        </div>
      {/each}
      {#if visible.length === 0}
        <div class="px-6 py-8 text-center text-sm text-gray-400">{$t('admin.face_cleanup_no_results')}</div>
      {/if}
    </div>
  </section>
{/if}
```

- [ ] **Step 4: Add i18n keys**

Add to `i18n/en.json`:

```json
"face_cleanup_review_lane_title": "Needs your review",
"face_cleanup_review_lane_sub": "Named, large, or an uncertain owner — open each to decide. Nothing here is touched until you do."
```

- [ ] **Step 5: Run tests, lint, format, commit**

```bash
pnpm exec vitest run src/routes/admin/face-cleanup/scan/ReviewFirstLane.spec.ts   # PASS (5)
pnpm exec prettier --write src/routes/admin/face-cleanup/scan/ReviewFirstLane.svelte src/routes/admin/face-cleanup/scan/ReviewFirstLane.spec.ts ../i18n/en.json
pnpm exec eslint --fix src/routes/admin/face-cleanup/scan/ReviewFirstLane.svelte src/routes/admin/face-cleanup/scan/ReviewFirstLane.spec.ts
pnpm exec eslint src/routes/admin/face-cleanup/scan/ReviewFirstLane.svelte src/routes/admin/face-cleanup/scan/ReviewFirstLane.spec.ts --max-warnings 0
git add -A && git commit -m "feat(web): add ReviewFirstLane clickable review list"
```

---

## Task 4: Integrate lanes into the scan page; delete old UI

**Files:**

- Modify: `web/src/routes/admin/face-cleanup/scan/+page.svelte`
- Rewrite: `web/src/routes/admin/face-cleanup/scan/page.spec.ts`
- Modify: `i18n/en.json`
- Delete: `ScanChecklist.svelte`, `ScanChecklist.spec.ts`, `FaceCleanupTable.svelte`, `face-cleanup.svelte.ts`, `face-cleanup.spec.ts`

**Interfaces:**

- Consumes: `createScanTriageModel`, `ScanTriageModel`, `FaceCleanupPerson` (Task 1); `ConfidentLane` (Task 2); `ReviewFirstLane` (Task 3).
- Produces: the reworked page. New/kept testids the spec asserts: `confident-lane`, `confident-approve`, `review-lane`, `review-row-<id>`, `review-dismiss-<id>`, plus existing state testids (`load-error-banner`, `load-error-retry`).

- [ ] **Step 1: Rewrite the page script to use the triage model**

In `+page.svelte`, replace the `createFaceCleanupModel` import and view-model wiring with the triage model, and delete filter/search/selection state. Keep `FaceCleanupScan`/`ScanPerson`/`ScanTotals`/`ScanProgress` types, polling, `runScan`/`handleRescan`/`handleAdvanced`, `resolvePersonToOwners`, `handleDismiss`, `loadInitial`/`fetchLatestScan`, and all non-completed states.

Key script changes:

```ts
import ConfidentLane from './ConfidentLane.svelte';
import ReviewFirstLane from './ReviewFirstLane.svelte';
import { createScanTriageModel, type FaceCleanupPerson, type ScanTriageModel } from './scan-triage.svelte';

// ...keep the scan types, loading/scanning/applying/pollTimer state...
let vm = $state<ScanTriageModel | null>(null);

const setScan = (next: FaceCleanupScan | null) => {
  scan = next;
  vm =
    next?.persons && next.persons.length > 0
      ? createScanTriageModel(next.persons as FaceCleanupPerson[], { prev: vm })
      : null;
};

// Bulk-approve the confident lane's approved (non-excluded) clusters. Same per-person resolve as before,
// now driven by vm.approvedIds instead of a checkbox selection set.
const handleApprove = async () => {
  if (!vm || vm.approvedCount === 0 || applying) {
    return;
  }
  applying = true;
  applyError = null;
  try {
    const ids = vm.approvedIds;
    await Promise.all(ids.map((personId) => resolvePersonToOwners(personId)));
    toastManager.success($t('admin.face_cleanup_apply_success', { values: { count: ids.length } }));
  } catch (error: unknown) {
    const status = (error as { status?: number }).status;
    applyError = status === 409 ? $t('admin.face_cleanup_apply_conflict') : $t('admin.face_cleanup_apply_error');
  } finally {
    await fetchLatestScan();
    applying = false;
  }
};
```

Delete: `filter`, `FILTER_LABEL_KEYS`, `searchQuery`, `openedStorageKey`/`readPersistedOpened`/`persistOpened`, `handleOpen`, `handleApply`, `filterCounts`, and the `sessionStorage` opened logic (the review-first gate is gone). `resolvePersonToOwners` stays verbatim.

- [ ] **Step 2: Rewrite the completed-state markup**

Replace the checklist + stat strip + filter toolbar + selection bar + `<FaceCleanupTable>` block (the `scan.status === 'completed'` branch) with the header summary, the two lanes, and the footnotes. Keep the loading/no-scan/running/failed branches and the outer header actions (View resolutions / Advanced / Re-scan) unchanged.

```svelte
{:else if scan.status === 'completed'}
  {#if !vm || (vm.confident.length === 0 && vm.reviewFirst.length === 0)}
    <div class="rounded-2xl border border-dashed border-gray-200 py-20 text-center dark:border-gray-700">
      <div class="text-lg font-medium text-gray-500">{$t('admin.face_cleanup_empty_clean')}</div>
      <p class="mt-2 text-sm text-gray-400">{$t('admin.face_cleanup_empty_clean_sub')}</p>
    </div>
  {:else}
    {#if applyError}
      <div class="mb-4 flex items-center gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/30 dark:bg-red-900/10 dark:text-red-400">
        <span class="flex-1">{applyError}</span>
        <button type="button" onclick={() => (applyError = null)} class="flex-none text-red-400 hover:text-red-600"><Icon icon={mdiClose} size="16" /></button>
      </div>
    {/if}

    <div class="flex flex-col gap-4">
      <ConfidentLane model={vm} {applying} onApprove={handleApprove} />
      <ReviewFirstLane people={vm.reviewFirst} users={data.users} onDismiss={handleDismiss} />
    </div>

    {#if scan.totals}
      {@const tot = scan.totals}
      <div class="mt-4 flex flex-wrap gap-x-6 gap-y-1 px-1">
        <span class="inline-flex items-center gap-2 text-xs text-gray-400">
          <span class="size-1.5 rounded-full bg-green-500"></span>
          {$t('admin.face_cleanup_footnote_repaired', { values: { count: tot.toRepair } })}
        </span>
        <span class="inline-flex items-center gap-2 text-xs text-gray-400">
          <span class="size-1.5 rounded-full bg-red-500"></span>
          {$t('admin.face_cleanup_footnote_unattributable', { values: { count: tot.reviewOnlyByReason?.unAttributable ?? 0 } })}
        </span>
      </div>
    {/if}
  {/if}
{/if}
```

Update the header block so the summary line reads from `scan.totals` (flagged + affectedPersons) when completed:

```svelte
<h1 class="text-2xl font-semibold tracking-tight">{$t('admin.face_cleanup')}</h1>
{#if scan?.status === 'completed' && scan.totals}
  <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">
    {$t('admin.face_cleanup_summary', { values: { flagged: scan.totals.flaggedFaces, people: scan.totals.affectedPersons } })}
  </p>
{/if}
```

- [ ] **Step 3: Add page-level i18n keys**

Add to `i18n/en.json`:

```json
"face_cleanup_summary": "{flagged} flagged faces across {people} people",
"face_cleanup_footnote_repaired": "{count} faces re-homed automatically by the scan.",
"face_cleanup_footnote_unattributable": "{count} faces had no clear owner — left untouched."
```

- [ ] **Step 4: Delete the old files**

```bash
git rm src/routes/admin/face-cleanup/scan/ScanChecklist.svelte \
       src/routes/admin/face-cleanup/scan/ScanChecklist.spec.ts \
       src/routes/admin/face-cleanup/scan/FaceCleanupTable.svelte \
       src/routes/admin/face-cleanup/scan/face-cleanup.svelte.ts \
       src/routes/admin/face-cleanup/scan/face-cleanup.spec.ts
```

- [ ] **Step 5: Remove dead i18n keys**

From `i18n/en.json`, remove the checklist/filter/selection keys that no longer have a reference. First confirm each is unused across both dirs, then delete:

```bash
for k in face_cleanup_steps_title face_cleanup_steps_subtitle face_cleanup_steps_review_title \
  face_cleanup_steps_review_body face_cleanup_steps_review_progress face_cleanup_steps_review_done \
  face_cleanup_steps_confident_title face_cleanup_steps_confident_body face_cleanup_steps_confident_none \
  face_cleanup_steps_apply_title face_cleanup_steps_apply_body face_cleanup_steps_apply_none \
  face_cleanup_filter_all face_cleanup_filter_review_first face_cleanup_filter_confident face_cleanup_filter_named \
  face_cleanup_selected face_cleanup_selected_hint face_cleanup_clear face_cleanup_apply \
  face_cleanup_group_review face_cleanup_group_review_sub face_cleanup_group_confident face_cleanup_group_confident_sub \
  face_cleanup_chip_review face_cleanup_chip_confident face_cleanup_stat_eligible face_cleanup_stat_eligible_sub \
  face_cleanup_stat_flagged face_cleanup_stat_flagged_sub face_cleanup_stat_repaired face_cleanup_stat_repaired_sub \
  face_cleanup_stat_needs_decision face_cleanup_stat_needs_decision_sub face_cleanup_stat_unattributable face_cleanup_stat_unattributable_sub \
  face_cleanup_col_person face_cleanup_col_owner face_cleanup_col_flagged face_cleanup_col_suspected_owner face_cleanup_col_status \
  face_cleanup_footnote; do
  echo "== $k =="; grep -rn "$k" ../../web/src ../../mobile/lib 2>/dev/null | grep -v en.json | head -2
done
```

Keep any key that still shows a reference (e.g. `face_cleanup_col_owner` is reused by the review page — verify before removing). Remove only the truly-dead ones.

- [ ] **Step 6: Rewrite `page.spec.ts` for the two lanes**

Keep the mock block and helpers verbatim (`makeTotals`, `makeScan`, `makePerson`, `makePageData`). Keep the state tests unchanged: `no scan empty state`, `nothing to clean up`, `progress when running`, `polls while running`, `error state when failed`, `Re-scan calls triggerScan`, `load-error + Retry`, `transient poll failure`. **Delete** the checklist tests, `renders review-first group before confident group`, `owner column`, `confident rows render pre-checked; review-first checkboxes render disabled`, `selection count … Clear`, `stat strip`, `filter buttons`. **Replace** the bulk-approve tests with lane-driven versions and **add** the two-lane render + dismiss tests. Full replacements:

```ts
it('renders the confident lane and the review lane after a scan with both kinds', async () => {
  vi.mocked(getLatestScan).mockResolvedValue(
    makeScan({
      persons: [
        makePerson({ personId: 'c1', recommendation: 'confident' }),
        makePerson({ personId: 'r1', recommendation: 'review-first', reviewReasons: ['large-cluster'] }),
      ],
    }) as never,
  );
  render(Page, { props: { data: makePageData() } });
  await waitFor(() => expect(screen.getByTestId('confident-lane')).toBeInTheDocument());
  expect(screen.getByTestId('review-lane')).toBeInTheDocument();
  expect(screen.getByTestId('review-row-r1')).toHaveAttribute('href', Route.viewFaceCleanupPerson({ id: 'r1' }));
});

it('Approve all re-attributes every confident cluster, grouping flagged faces by suspectedOwnerId', async () => {
  vi.mocked(getLatestScan).mockResolvedValue(
    makeScan({
      persons: [
        makePerson({ personId: 'c1', recommendation: 'confident' }),
        makePerson({ personId: 'c2', recommendation: 'confident' }),
      ],
    }) as never,
  );
  vi.mocked(getFaceRepairPersonFaces).mockResolvedValue({
    flaggedFaces: [
      { assetFaceId: 'a1', suspectedOwnerId: 'own1' },
      { assetFaceId: 'a2', suspectedOwnerId: 'own2' },
    ],
  } as unknown as FaceRepairPersonFacesDto);
  vi.mocked(resolveFaces).mockResolvedValue({} as never);
  render(Page, { props: { data: makePageData() } });
  await waitFor(() => expect(screen.getByTestId('confident-approve')).toBeInTheDocument());
  await fireEvent.click(screen.getByTestId('confident-approve'));
  await waitFor(() => expect(resolveFaces).toHaveBeenCalledTimes(2));
  expect(resolveFaces).toHaveBeenCalledWith({
    faceRepairResolveRequestDto: {
      personId: 'c1',
      moveToPerson: [
        { destinationPersonId: 'own1', faceIds: ['a1'] },
        { destinationPersonId: 'own2', faceIds: ['a2'] },
      ],
    },
  });
});

it('excluding a confident cluster in the spot-check drops it from the approve batch', async () => {
  vi.mocked(getLatestScan).mockResolvedValue(
    makeScan({
      persons: [
        makePerson({ personId: 'c1', recommendation: 'confident' }),
        makePerson({ personId: 'c2', recommendation: 'confident' }),
      ],
    }) as never,
  );
  vi.mocked(getFaceRepairPersonFaces).mockResolvedValue({
    flaggedFaces: [{ assetFaceId: 'a1', suspectedOwnerId: 'own1' }],
  } as unknown as FaceRepairPersonFacesDto);
  vi.mocked(resolveFaces).mockResolvedValue({} as never);
  render(Page, { props: { data: makePageData() } });
  await waitFor(() => expect(screen.getByTestId('confident-toggle')).toBeInTheDocument());
  await fireEvent.click(screen.getByTestId('confident-toggle'));
  await fireEvent.click(screen.getByTestId('confident-exclude-c1'));
  await fireEvent.click(screen.getByTestId('confident-approve'));
  await waitFor(() => expect(resolveFaces).toHaveBeenCalledTimes(1));
  expect(resolveFaces).toHaveBeenCalledWith(
    expect.objectContaining({ faceRepairResolveRequestDto: expect.objectContaining({ personId: 'c2' }) }),
  );
});

it('Dismiss on a review row reflects the server-removed person after a refetch', async () => {
  vi.mocked(getLatestScan)
    .mockResolvedValueOnce(
      makeScan({ persons: [makePerson({ personId: 'r1', recommendation: 'review-first' })] }) as never,
    )
    .mockResolvedValueOnce(makeScan({ persons: [] }) as never);
  vi.mocked(declineFaceRepair).mockResolvedValue({} as never);
  vi.stubGlobal(
    'confirm',
    vi.fn(() => true),
  );
  render(Page, { props: { data: makePageData() } });
  await waitFor(() => expect(screen.getByTestId('review-row-r1')).toBeInTheDocument());
  await fireEvent.click(screen.getByTestId('review-dismiss-r1'));
  await waitFor(() => expect(declineFaceRepair).toHaveBeenCalled());
  await waitFor(() => expect(screen.queryByTestId('review-row-r1')).not.toBeInTheDocument());
  vi.unstubAllGlobals();
});

it('apply 409 shows a non-destructive error and does not double-submit', async () => {
  vi.mocked(getLatestScan).mockResolvedValue(
    makeScan({ persons: [makePerson({ personId: 'c1', recommendation: 'confident' })] }) as never,
  );
  vi.mocked(getFaceRepairPersonFaces).mockResolvedValue({
    flaggedFaces: [{ assetFaceId: 'a1', suspectedOwnerId: 'own1' }],
  } as unknown as FaceRepairPersonFacesDto);
  vi.mocked(resolveFaces).mockRejectedValue({ status: 409 });
  render(Page, { props: { data: makePageData() } });
  await waitFor(() => expect(screen.getByTestId('confident-approve')).toBeInTheDocument());
  await fireEvent.click(screen.getByTestId('confident-approve'));
  await waitFor(() => expect(screen.getByText('admin.face_cleanup_apply_conflict')).toBeInTheDocument());
});
```

Add `import { Route } from '$lib/route';` to the spec if not present. Ensure `makePerson`/`makeScan` accept `recommendation` and `reviewReasons` overrides (they already spread `...over`).

- [ ] **Step 7: Run the full face-cleanup suite**

Run:

```bash
pnpm exec vitest run src/routes/admin/face-cleanup src/lib/components/shared-components/infinite-scroll-sentinel.spec.ts
```

Expected: PASS (all files). Fix any lane/page wiring until green.

- [ ] **Step 8: Lint, format, check, commit**

```bash
pnpm exec prettier --write src/routes/admin/face-cleanup/scan/+page.svelte src/routes/admin/face-cleanup/scan/page.spec.ts ../i18n/en.json
pnpm exec eslint --fix src/routes/admin/face-cleanup/scan/+page.svelte src/routes/admin/face-cleanup/scan/page.spec.ts
pnpm exec eslint src/routes/admin/face-cleanup/scan/+page.svelte src/routes/admin/face-cleanup/scan/page.spec.ts --max-warnings 0
git add -A
git commit -m "feat(web): two-lane triage scan page; drop checklist/table/filter/selection UI"
```

- [ ] **Step 9: Full web verification before hand-off**

```bash
pnpm exec vitest run src/routes/admin/face-cleanup    # whole feature green
pnpm exec eslint src/routes/admin/face-cleanup --max-warnings 0
pnpm exec prettier --check "src/routes/admin/face-cleanup/**/*.{svelte,ts}"
```

`check:svelte` is a push-only gate — rely on CI after push (net-new errors must be zero; the branch's baseline `PageData.error` spec errors are pre-existing).

---

## Self-Review

**Spec coverage:**

- Two lanes → Tasks 2 (confident), 3 (review), 4 (compose). ✓
- Approve-all + spot-check exclude → Task 2 + model Task 1. ✓
- Clickable rows → review page → Task 3 (`review-row` stretched link). ✓
- ⋯/hover dismiss → Task 3 (`review-dismiss`). ✓
- Kill disabled checkboxes → old table deleted (Task 4); no checkbox anywhere. ✓
- Cut stats/checklist/filters/selection bar → Task 4 markup + deletions. ✓
- Footnotes (auto-repaired / unattributable) + summary line → Task 4. ✓
- States preserved (loading/no-scan/running/failed/empty) → Task 4 keeps those branches; spec keeps their tests. ✓
- Behaviour change 1 (review-first decided in its own page) → no on-list gate; row links out (Task 3). ✓
- Behaviour change 2 (approve-all + exclusions) → model (Task 1) + lane (Task 2). ✓
- i18n add/remove → Tasks 2, 3, 4. ✓

**Placeholder scan:** No TBD/TODO; every step has real code or a real command. i18n removals are gated behind a grep-first check (Task 4 Step 5) rather than a blind delete.

**Type consistency:** `ScanTriageModel` members (`confident`, `reviewFirst`, `excluded`, `approvedIds`, `approvedCount`, `isExcluded`, `toggleExcluded`, `reset`) are used identically in Tasks 2 and 4. `FaceCleanupPerson` shape is shared from Task 1. `onApprove: () => void`, `onDismiss: (id) => void` match between the lanes (Tasks 2/3) and the page wiring (Task 4). `resolvePersonToOwners` is reused verbatim from the existing page.

---

## Corrections applied during execution

Defects caught by the TDD/review gates and fixed in the landed code (this section supersedes the affected snippets above):

1. **ConfidentLane approve button (Task 2):** the sibling `svelte-i18n` mock is a key-passthrough that drops `{values}`, so an assertable count can't live solely inside `$t()`. The button renders `model.approvedCount` as a **plain-text node** beside a static label, and the i18n key split into `face_cleanup_confident_approve_all` ("Approve all", nothing excluded) + `face_cleanup_confident_approve` ("Approve", some excluded).
2. **ReviewFirstLane row (Task 3):** the whole-row `<a>` **wraps the content** (so the `review-row-<id>` element carries both `href` and the face-count text), with the dismiss `<button>` an absolute sibling on top — not an empty stretched overlay. The lane search is **always rendered** (the `>6` gate made it untestable). `getPeopleThumbnailPath` is imported from **`@immich/sdk`**, not `people-utils`. `UserAvatar` uses `size="sm"` (its `Size` has no `tiny`).
3. **page.spec.ts (Task 4):** existing helper names are `makeScanPerson` / `makeCompletedScan` / `makeTotals` / `makePageData` (not the `makePerson`/`makeScan` used in the Task 4 snippet); the dismiss test drives a **review-first** person (dismiss lives on the review lane). The `PageData.error` svelte-check errors on `makePageData` are pre-existing (unchanged from the original spec; CI-green).
4. **i18n prune (Task 4):** `face_cleanup_stat_flagged` / `_sub` are **kept** (used by the redesigned chooser), as is `face_cleanup_col_owner` (manual review page); 40 other checklist/filter/selection/stat/col/footnote keys removed after a grep-verified dead check.
