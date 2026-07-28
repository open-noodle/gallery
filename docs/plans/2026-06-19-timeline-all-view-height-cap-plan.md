# Timeline "All" view height-cap fix — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every asset reachable in the flat "All" timeline on libraries large enough to exceed the browser's maximum element height, without changing behavior for normal-sized libraries.

**Architecture:** Introduce scroll-space scaling in `VirtualScrollManager`: cap the scroll element's DOM height at a browser-safe maximum, and map scroll positions between a true "logical" space and the capped "DOM" space. Content is positioned relative to the live scroll via a `renderOffset` so no coordinate ever exceeds the cap. Scale is exactly `1` below the cap, so the change is inert for normal libraries.

**Tech Stack:** SvelteKit + Svelte 5 runes (`$state`/`$derived`), TypeScript, Vitest + `@testing-library/svelte` (happy-dom).

**Spec:** `docs/plans/2026-06-19-timeline-all-view-height-cap.md` (read it first — this plan implements it verbatim).

## Global Constraints

- **TDD, red→green, every change.** Write the failing test, run it, see it fail for the expected reason, implement the minimum, see it pass, commit. (Spec §6.)
- **Zero behavior change at `scrollScale == 1`** (all libraries below the cap): `domHeight == totalViewerHeight`, conversions are identity, `renderOffset == 0`. Existing tests must stay green unchanged. (Spec §2, §4.4.)
- **Cap value:** `MAX_SCROLL_HEIGHT = isFirefox ? 17_000_000 : 33_000_000`, where the Firefox UA check is **inlined** in `VirtualScrollManager.svelte.ts` (NOT imported from `asset-utils`, which would create the circular import `asset-utils → TimelineManager → VirtualScrollManager`). (Spec §3, §8.)
- **`clamp` is already imported** from `lodash-es` in `timeline-manager.svelte.ts` (line 40) — do not add a new import.
- **No relative imports** — use the `$lib/` alias. **TypeScript strict.** **ESLint zero-warnings** (full `lint` runs once as the final gate, not per-task).
- **Run a single spec:** `cd web && pnpm test -- --run <path>`. **Type/Svelte check:** `make check-web`. **Lint:** `make lint-web`.
- Prettier any touched markdown under `docs/` before committing.

---

## File Structure

| File                                                                            | Responsibility                                                                          | Action |
| ------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | ------ |
| `web/src/lib/managers/VirtualScrollManager/VirtualScrollManager.svelte.ts`      | Generic scaling engine: cap, conversions, logical/DOM scroll position, `renderOffset`   | Modify |
| `web/src/lib/managers/VirtualScrollManager/VirtualScrollManager.svelte.spec.ts` | Unit tests for the scaling engine                                                       | Create |
| `web/src/lib/managers/timeline-manager/timeline-manager.svelte.ts`              | Override `domScrollTop`; convert `scrollTo`/`scrollBy`                                  | Modify |
| `web/src/lib/managers/timeline-manager/timeline-manager.svelte.spec.ts`         | Scroll-conversion, reachability (symptom #1), anchor (symptom #2), stability            | Modify |
| `web/src/lib/components/timeline/Timeline.svelte`                               | `domHeight` height; `renderOffset` transforms; route mixers through logical `scrollTop` | Modify |
| `web/src/lib/components/timeline/Timeline.spec.ts`                              | Component transform/height assertions                                                   | Modify |
| `web/src/lib/components/timeline/TimelineRepresentativeBuckets.svelte`          | `renderOffset` prop on bucket transform                                                 | Modify |
| `web/src/lib/components/timeline/TimelineRepresentativeBuckets.spec.ts`         | Bucket transform assertion                                                              | Modify |

`timeline-anchor.ts` is **not** modified — its snap-back symptom is fixed entirely by `scrollTo` converting logical→DOM (verified by a test, Task 2).

---

## Task 1: Scaling engine in `VirtualScrollManager`

Adds the cap, conversions, logical scroll position, and `renderOffset`. Fully unit-tested with a minimal test subclass (no DOM, no SvelteKit).

**Files:**

- Modify: `web/src/lib/managers/VirtualScrollManager/VirtualScrollManager.svelte.ts`
- Test: `web/src/lib/managers/VirtualScrollManager/VirtualScrollManager.svelte.spec.ts` (create)

**Interfaces:**

- Consumes: existing `totalViewerHeight`, `viewportHeight`, `#scrollTop` (`$state`), `updateViewportProximities()`.
- Produces (used by Task 2 and Task 3):
  - `maxScrollHeight: number` (public `$state`, overridable in tests)
  - `get domHeight(): number`
  - `get logicalScrollMax(): number`
  - `get domScrollMax(): number`
  - `get scrollScale(): number`
  - `domToLogical(dom: number): number`
  - `logicalToDom(logical: number): number`
  - `get domScrollTop(): number` (base returns `0`; subclass overrides)
  - `get scrollTop(): number` (now **logical**)
  - `get renderOffset(): number`

- [ ] **Step 1: Write the failing math + scroll-position tests**

Create `web/src/lib/managers/VirtualScrollManager/VirtualScrollManager.svelte.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { VirtualScrollManager } from './VirtualScrollManager.svelte';

class TestScroller extends VirtualScrollManager {
  #dom = 0;
  override get domScrollTop() {
    return this.#dom;
  }
  setDomScrollTop(value: number) {
    this.#dom = value;
  }
}

function makeScroller({ body, viewport, cap }: { body: number; viewport: number; cap?: number }) {
  const scroller = new TestScroller();
  scroller.bodySectionHeight = body;
  scroller.viewportHeight = viewport;
  if (cap !== undefined) {
    scroller.maxScrollHeight = cap;
  }
  return scroller;
}

describe('VirtualScrollManager scaling', () => {
  it('1. is identity below the cap', () => {
    const s = makeScroller({ body: 10_000, viewport: 1000, cap: 1_000_000 });
    expect(s.domHeight).toBe(10_000); // == totalViewerHeight
    expect(s.scrollScale).toBe(1);
    expect(s.domToLogical(500)).toBe(500);
    expect(s.logicalToDom(500)).toBe(500);

    s.setDomScrollTop(500);
    s.updateSlidingWindow();
    expect(s.scrollTop).toBe(500); // logical
    expect(s.renderOffset).toBe(0);
  });

  it('2. leaves scale at 1 exactly at the cap', () => {
    const s = makeScroller({ body: 10_000, viewport: 1000, cap: 10_000 });
    expect(s.domHeight).toBe(10_000);
    expect(s.scrollScale).toBe(1);
  });

  it('3. clamps domHeight and scales above the cap', () => {
    const s = makeScroller({ body: 100_000, viewport: 1000, cap: 10_000 });
    expect(s.domHeight).toBe(10_000);
    expect(s.scrollScale).toBeGreaterThan(0);
    expect(s.scrollScale).toBeLessThan(1);
  });

  it('4. maps both endpoints so the tail is reachable', () => {
    const s = makeScroller({ body: 100_000, viewport: 1000, cap: 10_000 });
    expect(s.logicalToDom(0)).toBe(0);
    expect(s.logicalToDom(s.logicalScrollMax)).toBeCloseTo(s.domScrollMax, 6);
  });

  it('5. round-trips dom↔logical', () => {
    const s = makeScroller({ body: 100_000, viewport: 1000, cap: 10_000 });
    for (const x of [0, 50_000, s.logicalScrollMax]) {
      expect(s.domToLogical(s.logicalToDom(x))).toBeCloseTo(x, 6);
    }
  });

  it('6. keeps the bottom item bounded within the capped DOM height', () => {
    const s = makeScroller({ body: 100_000, viewport: 1000, cap: 10_000 });
    s.setDomScrollTop(s.domScrollMax);
    s.updateSlidingWindow();
    expect(s.scrollTop).toBeCloseTo(s.logicalScrollMax, 6); // 99_000
    expect(s.renderOffset).toBeCloseTo(-90_000, 6);
    // an item at logical top == total lands exactly at domHeight, not at 100_000px
    expect(s.totalViewerHeight + s.renderOffset).toBeCloseTo(s.domHeight, 6);
  });

  it('7. guards against divide-by-zero and NaN at the geometry edges', () => {
    // (a) content fits the viewport → logicalScrollMax == 0 (spec edge #4/#5)
    const fits = makeScroller({ body: 500, viewport: 1000, cap: 10_000 });
    expect(fits.logicalScrollMax).toBe(0);
    expect(fits.domToLogical(123)).toBe(0);
    expect(fits.logicalToDom(123)).toBe(0);
    expect(fits.scrollScale).toBe(1);
    expect(Number.isFinite(fits.domToLogical(123))).toBe(true);

    // (b) zero-height viewport (transient, before layout) → no NaN/Infinity (spec edge #6)
    const noViewport = makeScroller({ body: 100_000, viewport: 0, cap: 10_000 });
    expect(noViewport.domHeight).toBe(10_000);
    expect(Number.isFinite(noViewport.domToLogical(5000))).toBe(true);
    expect(Number.isFinite(noViewport.logicalToDom(50_000))).toBe(true);
    expect(Number.isFinite(noViewport.scrollScale)).toBe(true);
  });

  it('8. renderOffset reads cached state, updating only after updateSlidingWindow', () => {
    const s = makeScroller({ body: 100_000, viewport: 1000, cap: 10_000 });
    s.setDomScrollTop(s.domScrollMax);
    expect(s.renderOffset).toBe(0); // cached state not yet refreshed
    s.updateSlidingWindow();
    expect(s.renderOffset).toBeCloseTo(-90_000, 6);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd web && pnpm test -- --run src/lib/managers/VirtualScrollManager/VirtualScrollManager.svelte.spec.ts`
Expected: FAIL — e.g. `s.domHeight` is `undefined` / `s.domToLogical is not a function` / `s.maxScrollHeight` setter has no effect.

- [ ] **Step 3: Implement the scaling engine**

In `web/src/lib/managers/VirtualScrollManager/VirtualScrollManager.svelte.ts`:

Add a module const directly below the existing `import { debounce } from 'lodash-es';` line:

```ts
// Largest element height the browser renders before clamping the scroll container: Firefox ≈ 17.9M,
// Chrome/Safari ≈ 33.5M. The Firefox check is inlined (not imported from asset-utils's `isFirefox`)
// to avoid the circular import asset-utils → TimelineManager → VirtualScrollManager.
const MAX_SCROLL_HEIGHT =
  typeof navigator !== 'undefined' && navigator.userAgent.includes('Firefox') ? 17_000_000 : 33_000_000;
```

Add a public `$state` field and a private cached-DOM `$state` field next to the existing `#scrollTop = $state(0);` declaration:

```ts
  maxScrollHeight = $state(MAX_SCROLL_HEIGHT);
  #cachedDomScrollTop = $state(0);
```

Replace the existing placeholder getter:

```ts
  get scrollTop() {
    return 0;
  }
```

with the logical accessor plus the DOM accessor and the scaling getters/methods:

```ts
  get domScrollTop(): number {
    return 0;
  }

  get scrollTop(): number {
    return this.domToLogical(this.domScrollTop);
  }

  get renderOffset(): number {
    return this.#cachedDomScrollTop - this.#scrollTop;
  }

  get domHeight(): number {
    return Math.min(this.totalViewerHeight, this.maxScrollHeight);
  }

  get logicalScrollMax(): number {
    return Math.max(0, this.totalViewerHeight - this.viewportHeight);
  }

  get domScrollMax(): number {
    return Math.max(0, this.domHeight - this.viewportHeight);
  }

  get scrollScale(): number {
    return this.logicalScrollMax > 0 ? this.domScrollMax / this.logicalScrollMax : 1;
  }

  domToLogical(dom: number): number {
    return this.domScrollMax > 0 ? (dom * this.logicalScrollMax) / this.domScrollMax : 0;
  }

  logicalToDom(logical: number): number {
    return this.logicalScrollMax > 0 ? (logical * this.domScrollMax) / this.logicalScrollMax : 0;
  }
```

Replace the existing `updateSlidingWindow()` body so it caches both the logical and raw-DOM scroll positions:

```ts
  updateSlidingWindow() {
    const domScrollTop = this.domScrollTop;
    const scrollTop = this.domToLogical(domScrollTop);
    if (this.#scrollTop !== scrollTop || this.#cachedDomScrollTop !== domScrollTop) {
      this.#cachedDomScrollTop = domScrollTop;
      this.#scrollTop = scrollTop;
      this.updateViewportProximities();
    }
  }
```

Leave `maxScroll` and `maxScrollPercent` unchanged (they remain logical).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd web && pnpm test -- --run src/lib/managers/VirtualScrollManager/VirtualScrollManager.svelte.spec.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/managers/VirtualScrollManager/VirtualScrollManager.svelte.ts \
        web/src/lib/managers/VirtualScrollManager/VirtualScrollManager.svelte.spec.ts
git commit -m "feat(web): scroll-space scaling engine in VirtualScrollManager (#713)"
```

---

## Task 2: `TimelineManager` scroll conversion + reachability/anchor tests

Routes the timeline's DOM element through the scaling engine: `domScrollTop` reads the element, `scrollTo`/`scrollBy` convert logical→DOM. Proves symptom #1 (tail reachable) and symptom #2 (no anchor snap-back).

**Files:**

- Modify: `web/src/lib/managers/timeline-manager/timeline-manager.svelte.ts:162-178`
- Test: `web/src/lib/managers/timeline-manager/timeline-manager.svelte.spec.ts`

**Interfaces:**

- Consumes: Task 1's `logicalToDom`, `domToLogical`, `domScrollMax`, `scrollTop`, `renderOffset`, `maxScrollHeight`.
- Produces: `scrollTo`/`scrollBy` operate in logical coordinates; `get domScrollTop()` returns the element's raw `scrollTop`. (`scrollTop` inherited from base is now logical.)

- [ ] **Step 1: Write the failing scroll-conversion tests**

Append to `web/src/lib/managers/timeline-manager/timeline-manager.svelte.spec.ts` (the file already imports `sdkMock`, `timelineAssetFactory`, `toResponseDto`, `fromISODateTimeUTCToObject`, `tick`, and `TimelineManager`). Also add this import near the top with the other imports:

```ts
import { scrollTimelineToTemporalAnchor } from '$lib/managers/timeline-manager/timeline-anchor';
```

Then add the describe block:

```ts
describe('TimelineManager scroll scaling', () => {
  let timelineManager: TimelineManager;
  let fakeEl: { scrollTop: number; scrollTo: (o: { top: number }) => void };

  function deriveLocalDateTime(arg: TimelineAsset): TimelineAsset {
    return { ...arg, localDateTime: arg.fileCreatedAt };
  }

  const bucketAssets: Record<string, TimelineAsset[]> = {
    '2024-03-01': timelineAssetFactory
      .buildList(1)
      .map((asset) =>
        deriveLocalDateTime({ ...asset, fileCreatedAt: fromISODateTimeUTCToObject('2024-03-01T00:00:00.000Z') }),
      ),
    '2024-02-01': timelineAssetFactory
      .buildList(100)
      .map((asset) =>
        deriveLocalDateTime({ ...asset, fileCreatedAt: fromISODateTimeUTCToObject('2024-02-01T00:00:00.000Z') }),
      ),
    '2024-01-01': timelineAssetFactory
      .buildList(3)
      .map((asset) =>
        deriveLocalDateTime({ ...asset, fileCreatedAt: fromISODateTimeUTCToObject('2024-01-01T00:00:00.000Z') }),
      ),
  };
  const bucketAssetsResponse: Record<string, TimeBucketAssetResponseDto> = Object.fromEntries(
    Object.entries(bucketAssets).map(([key, assets]) => [key, toResponseDto(...assets)]),
  );

  beforeEach(async () => {
    vi.resetAllMocks();
    timelineManager = new TimelineManager();
    sdkMock.getTimeBuckets.mockResolvedValue([
      { count: 1, timeBucket: '2024-03-01' },
      { count: 100, timeBucket: '2024-02-01' },
      { count: 3, timeBucket: '2024-01-01' },
    ]);
    sdkMock.getTimeBucket.mockImplementation(({ timeBucket }) => Promise.resolve(bucketAssetsResponse[timeBucket]));
    await timelineManager.updateViewport({ width: 1588, height: 1000 });
    await tick();

    fakeEl = {
      scrollTop: 0,
      scrollTo({ top }: { top: number }) {
        this.scrollTop = top; // manager already clamped; store verbatim
      },
    };
    timelineManager.scrollableElement = fakeEl as unknown as HTMLElement;
  });

  it('9. is inert below the cap', () => {
    // totalViewerHeight == 8337, viewport == 1000, default cap is huge
    expect(timelineManager.domHeight).toBe(timelineManager.totalViewerHeight);
    expect(timelineManager.scrollScale).toBe(1);
    timelineManager.scrollTo(1000);
    expect(fakeEl.scrollTop).toBe(1000);
    expect(timelineManager.scrollTop).toBe(1000);
    expect(timelineManager.renderOffset).toBe(0);
  });

  it('10. reaches the tail under forced scaling (symptom #1)', () => {
    timelineManager.maxScrollHeight = 4000; // domHeight 4000, domScrollMax 3000, logicalScrollMax 7337
    timelineManager.scrollTo(timelineManager.maxScroll); // 7337
    expect(fakeEl.scrollTop).toBeCloseTo(timelineManager.domScrollMax, 6); // 3000
    expect(timelineManager.scrollTop).toBeCloseTo(timelineManager.maxScroll, 6); // 7337
  });

  it('11. clamps scrollTo to [0, domScrollMax]', () => {
    timelineManager.maxScrollHeight = 4000;
    timelineManager.scrollTo(10 * timelineManager.totalViewerHeight);
    expect(fakeEl.scrollTop).toBeCloseTo(timelineManager.domScrollMax, 6); // clamped to bottom
    timelineManager.scrollTo(0); // top reachable (spec edge #11)
    expect(fakeEl.scrollTop).toBe(0);
    timelineManager.scrollTo(-5000); // negative clamped to 0
    expect(fakeEl.scrollTop).toBe(0);
  });

  it('12. scrollBy moves the logical position by the given delta', () => {
    timelineManager.maxScrollHeight = 4000;
    timelineManager.scrollTo(2000);
    timelineManager.scrollBy(1000);
    expect(timelineManager.scrollTop).toBeCloseTo(3000, 6);
  });

  it('13. exposes a logical scrollTop end-to-end', () => {
    timelineManager.maxScrollHeight = 4000;
    fakeEl.scrollTop = timelineManager.domScrollMax; // 3000 (raw DOM)
    timelineManager.updateSlidingWindow();
    expect(timelineManager.scrollTop).toBeCloseTo(timelineManager.maxScroll, 6); // 7337
    expect(timelineManager.visibleWindow.top).toBeCloseTo(timelineManager.maxScroll, 6);
  });

  it('14. scrollBy preserves the logical delta the height compensation relies on', () => {
    timelineManager.maxScrollHeight = 4000;
    timelineManager.scrollTo(1500);
    const before = timelineManager.scrollTop;
    timelineManager.scrollBy(500); // mirrors month.height setter compensation
    expect(timelineManager.scrollTop - before).toBeCloseTo(500, 6);
  });

  it('15. preserves a deep anchor across Years/Months → All (symptom #2)', () => {
    timelineManager.maxScrollHeight = 4000;
    const reached = scrollTimelineToTemporalAnchor(timelineManager, { year: 2024, month: 1 });
    expect(fakeEl.scrollTop).toBeCloseTo(timelineManager.domScrollMax, 6); // 3000, reachable — not clamped short
    expect(reached).toBe(true);
  });
});
```

Add these named imports to the existing `@immich/sdk` import (it already imports `AssetVisibility`, `TimeBucketSize`, `AssetResponseDto`, `TimeBucketAssetResponseDto`) — `TimeBucketAssetResponseDto` is already imported, so no change is needed there. Confirm `TimelineAsset` is imported (it is, from `./types`).

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd web && pnpm test -- --run src/lib/managers/timeline-manager/timeline-manager.svelte.spec.ts -t "scroll scaling"`
Expected: tests **10–15 FAIL**. Before this task `scrollTo` still writes the raw logical value (no logical→DOM conversion) and there is no `domScrollTop` override, so under a forced small `maxScrollHeight` the element receives the un-scaled value — concretely "expected 7337 to be close to 3000". Test **9 ("inert below the cap") passes already** — it is a regression guard asserting scale-1 behavior is unchanged, not a red driver; it must stay green before and after.

- [ ] **Step 3: Implement the conversion in `TimelineManager`**

In `web/src/lib/managers/timeline-manager/timeline-manager.svelte.ts`, replace lines 162-178:

```ts
  override get scrollTop(): number {
    return this.#scrollableElement?.scrollTop ?? 0;
  }

  set scrollableElement(element: HTMLElement | undefined) {
    this.#scrollableElement = element;
  }

  scrollTo(top: number) {
    this.#scrollableElement?.scrollTo({ top });
    this.updateSlidingWindow();
  }

  scrollBy(y: number) {
    this.#scrollableElement?.scrollBy(0, y);
    this.updateSlidingWindow();
  }
```

with:

```ts
  override get domScrollTop(): number {
    return this.#scrollableElement?.scrollTop ?? 0;
  }

  set scrollableElement(element: HTMLElement | undefined) {
    this.#scrollableElement = element;
  }

  scrollTo(top: number) {
    this.#scrollableElement?.scrollTo({ top: clamp(this.logicalToDom(top), 0, this.domScrollMax) });
    this.updateSlidingWindow();
  }

  scrollBy(y: number) {
    this.scrollTo(this.scrollTop + y);
  }
```

(`scrollTop` is now inherited from the base as `domToLogical(domScrollTop)`. `clamp` is already imported from `lodash-es` at line 40.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd web && pnpm test -- --run src/lib/managers/timeline-manager/timeline-manager.svelte.spec.ts`
Expected: PASS — the new "scroll scaling" block (7 tests) and all pre-existing TimelineManager tests.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/managers/timeline-manager/timeline-manager.svelte.ts \
        web/src/lib/managers/timeline-manager/timeline-manager.svelte.spec.ts
git commit -m "feat(web): map timeline scroll between logical and capped DOM space (#713)"
```

---

## Task 3: Template wiring — `renderOffset` + `domHeight` in the components

Applies the engine to the DOM: caps the scroll element height, offsets every absolutely-positioned child by `renderOffset`, and routes the three logical/DOM mixer reads through the logical `scrollTop`. Adds `data-testid`s so the transforms are assertable.

**Files:**

- Modify: `web/src/lib/components/timeline/TimelineRepresentativeBuckets.svelte`
- Modify: `web/src/lib/components/timeline/Timeline.svelte`
- Test: `web/src/lib/components/timeline/TimelineRepresentativeBuckets.spec.ts`
- Test: `web/src/lib/components/timeline/Timeline.spec.ts`

**Interfaces:**

- Consumes: `timelineManager.domHeight`, `timelineManager.renderOffset`, `timelineManager.scrollTop` (logical).
- Produces: `TimelineRepresentativeBuckets` gains a `renderOffset?: number` prop (default `0`).

- [ ] **Step 1: Write the failing representative-bucket test**

In `web/src/lib/components/timeline/TimelineRepresentativeBuckets.spec.ts`, add a test inside the existing `describe`:

```ts
it('offsets bucket transforms by renderOffset', () => {
  render(TimelineRepresentativeBuckets, {
    grouping: 'year',
    buckets: [bucket(2016, 120)],
    visibleWindow: { top: 100, bottom: 600 },
    renderOffset: 50,
  });

  expect(screen.getByTestId('timeline-bucket-shell-2016-01-01')).toHaveStyle('transform: translateY(170px)');
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd web && pnpm test -- --run src/lib/components/timeline/TimelineRepresentativeBuckets.spec.ts -t "renderOffset"`
Expected: FAIL — `transform: translateY(120px)` (renderOffset ignored), "expected … translateY(170px)".

- [ ] **Step 3: Add the `renderOffset` prop to `TimelineRepresentativeBuckets.svelte`**

Add to the `Props` interface (after `disabled?: boolean;`):

```ts
    renderOffset?: number;
```

Add to the destructure (after `disabled = false,`):

```ts
    renderOffset = 0,
```

Change the bucket shell `style` (line 70) from:

```svelte
        style={`position: absolute; height: ${bucket.height}px; width: 100%; transform: translateY(${bucket.top}px);`}
```

to:

```svelte
        style={`position: absolute; height: ${bucket.height}px; width: 100%; transform: translateY(${bucket.top + renderOffset}px);`}
```

- [ ] **Step 4: Run the representative-bucket spec to verify it passes**

Run: `cd web && pnpm test -- --run src/lib/components/timeline/TimelineRepresentativeBuckets.spec.ts`
Expected: PASS — the new test plus all existing ones (default `renderOffset = 0` keeps `translateY(120px)` etc.).

- [ ] **Step 5: Write the failing Timeline component tests**

In `web/src/lib/components/timeline/Timeline.spec.ts`:

Add `domHeight` and `renderOffset` to the hoisted `testState` (after `maxScroll: 1,`):

```ts
  domHeight: 296,
  renderOffset: 0,
```

Add matching getters to the `TimelineManagerMock` class (after the `totalViewerHeight = 296;` line):

```ts
    get domHeight() {
      return testState.domHeight;
    }
    get renderOffset() {
      return testState.renderOffset;
    }
```

Reset them in the top-level `beforeEach` (alongside the other `testState` resets):

```ts
testState.domHeight = 296;
testState.renderOffset = 0;
```

Add a new describe block at the end of the file:

```ts
describe('Timeline scroll-space scaling', () => {
  beforeEach(() => {
    testState.grouping = 'day';
    testState.assetCount = 1;
    testState.viewportHeight = 600;
    testState.viewportWidth = 390;
    testState.domHeight = 296;
    testState.renderOffset = 0;
    testState.months = [];
  });

  it('sizes the virtual timeline to domHeight, not totalViewerHeight', () => {
    testState.domHeight = 200; // < totalViewerHeight (296)
    const { container } = renderTimeline();
    const virtual = container.querySelector('#virtual-timeline') as HTMLElement;
    expect(virtual).toHaveStyle({ height: '200px' });
  });

  it('offsets the month skeleton transform by renderOffset', () => {
    testState.renderOffset = 50;
    testState.months = [
      {
        viewId: 'month:2015-01',
        isInOrNearViewport: false,
        isLoaded: false,
        top: 1200,
        height: 240,
        title: 'Jan 2015',
      },
    ];
    renderTimeline();
    // assert on the raw inline style so CSS normalization (e.g. `0`→`0px`) can't cause a false negative;
    // the template emits exactly `translate3d(0,${top + renderOffset}px,0)`
    const skeleton = screen.getByTestId('timeline-month-skeleton');
    expect(skeleton.getAttribute('style')).toMatch(/translate3d\(\s*0(?:px)?\s*,\s*1250px\s*,\s*0(?:px)?\s*\)/);
  });

  it('offsets the lead-out spacer transform by renderOffset', () => {
    // topSectionHeight 0 + bodySectionHeight 296 + renderOffset 50 = 346
    testState.renderOffset = 50;
    const { getByTestId } = renderTimeline();
    expect(getByTestId('timeline-leadout').getAttribute('style')).toMatch(
      /translate3d\(\s*0(?:px)?\s*,\s*346px\s*,\s*0(?:px)?\s*\)/,
    );
  });
});
```

- [ ] **Step 6: Run them to verify they fail**

Run: `cd web && pnpm test -- --run src/lib/components/timeline/Timeline.spec.ts -t "scroll-space scaling"`
Expected: FAIL — `#virtual-timeline` still uses `totalViewerHeight`; no `timeline-month-skeleton`/`timeline-leadout` testids; transforms omit `renderOffset`.

- [ ] **Step 7: Apply the `Timeline.svelte` template changes**

`web/src/lib/components/timeline/Timeline.svelte`:

a. The `#virtual-timeline` height (line 733):

```svelte
    style:height={timelineManager.totalViewerHeight + 'px'}
```

→

```svelte
    style:height={timelineManager.domHeight + 'px'}
```

b. The shared month offset const (line 762):

```svelte
        {@const absoluteHeight = timelineMonth.top}
```

→

```svelte
        {@const absoluteHeight = timelineMonth.top + timelineManager.renderOffset}
```

c. Add a `data-testid` to the skeleton wrapper div (the `{#if !timelineMonth.isLoaded}` block, the `<div>` opening at line 765):

```svelte
          <div
            data-testid="timeline-month-skeleton"
            style:height={timelineMonth.height + 'px'}
```

d. Pass `renderOffset` to the representative buckets (in the `<TimelineRepresentativeBuckets …>` props, near line 750):

```svelte
        visibleWindow={timelineManager.visibleWindow}
        renderOffset={timelineManager.renderOffset}
```

e. The lead-out spacer (line 831-837): add the `data-testid` and the `renderOffset` term:

```svelte
    <div
      data-testid="timeline-leadout"
      style:height={timelineManager.bottomSectionHeight + 'px'}
      style:position="absolute"
      style:left="0"
      style:right="0"
      style:transform={`translate3d(0,${timelineManager.topSectionHeight + timelineManager.bodySectionHeight + timelineManager.renderOffset}px,0)`}
    ></div>
```

f. Route the three mixer reads through the logical `scrollTop`:

- Line 231: `const currentTop = scrollableElement?.scrollTop || 0;` → `const currentTop = timelineManager.scrollTop;`
- Line 420: `timelineScrollPercent = Math.min(1, scrollableElement.scrollTop / maxScroll);` → `timelineScrollPercent = Math.min(1, timelineManager.scrollTop / maxScroll);`
- Line 426: `let top = scrollableElement.scrollTop;` → `let top = timelineManager.scrollTop;`

> The mixer edits (f) are identity at `scrollScale == 1`, so existing `Timeline.spec.ts` tests stay green; under scaling they read the correct logical position. They are verified indirectly by the logical-`scrollTop` tests in Task 2 (tests 9, 13) and by manual verification (Task 4 / Spec §9), since `handleTimelineScroll`/`scrollToAssetPosition` are driven by real scroll events not exercised by the manager-only harness.

- [ ] **Step 8: Run the component tests to verify they pass**

Run: `cd web && pnpm test -- --run src/lib/components/timeline/Timeline.spec.ts src/lib/components/timeline/TimelineRepresentativeBuckets.spec.ts`
Expected: PASS — new scaling tests plus all pre-existing component tests.

- [ ] **Step 9: Commit**

```bash
git add web/src/lib/components/timeline/Timeline.svelte \
        web/src/lib/components/timeline/Timeline.spec.ts \
        web/src/lib/components/timeline/TimelineRepresentativeBuckets.svelte \
        web/src/lib/components/timeline/TimelineRepresentativeBuckets.spec.ts
git commit -m "feat(web): render timeline content in capped DOM space via renderOffset (#713)"
```

---

## Task 4: Regression gate + recorded manual verification

Confirms the whole web suite is green, types/Svelte check pass, lint passes, and the user-facing behavior is verified on a large library (the one path the unit tests cannot exercise).

**Files:** none (verification only).

- [ ] **Step 1: Run the timeline-area specs**

Run: `cd web && pnpm test -- --run src/lib/managers/timeline-manager src/lib/managers/VirtualScrollManager src/lib/components/timeline`
Expected: PASS — all timeline manager, scaling-engine, and component specs.

- [ ] **Step 2: Run the full web unit suite**

Run: `cd web && pnpm test -- --run`
Expected: PASS — no regressions in dependent components (especially `timeline-anchor.spec.ts`, which is unchanged).

- [ ] **Step 3: Type/Svelte check**

Run: `make check-web`
Expected: 0 errors (svelte-check + `tsc --noEmit`).

- [ ] **Step 4: Lint (final gate)**

Run: `make lint-web`
Expected: 0 warnings/errors.

- [ ] **Step 5: Recorded manual verification (Spec §9)**

Requires a library large enough to exceed the cap (≈ 300k+ assets, or temporarily lower `maxScrollHeight` in dev to force scaling). On `make dev`, perform and record the result of each:

1. "All" view → scroll to the very bottom: the oldest assets render; no fixed-date cutoff.
2. Years (or Months) → open a pre-cutoff date → switch to "All": stays on that date; no snap-back.
3. Deep-link `/photos/<id>` for an old asset: scrolls to and focuses it.
4. Normal-sized library: scrolling, scrubber, deep-linking behave exactly as before (`scrollScale == 1`).
5. Repeat 1–2 in Firefox (lower cap engages scaling sooner).

Record pass/fail for each in the PR description. If forced to skip (no large library available), say so explicitly — do not imply coverage that was not performed.

- [ ] **Step 6: Commit any final formatting**

```bash
git add -A
git commit -m "chore(web): finalize #713 height-cap fix" --allow-empty
```

---

## Self-Review (completed by plan author)

**Spec coverage:**

- §4.1 coordinate model → Task 1 (Steps 3, code: `domHeight`/`logicalScrollMax`/`domScrollMax`/`scrollScale`/`domToLogical`/`logicalToDom`, cap const).
- §4.2 rendering / `renderOffset` → Task 1 (`renderOffset` getter) + Task 3 (transforms, `domHeight` height, representative `renderOffset`, top section left static).
- §4.3 single logical source → Task 1 (logical `scrollTop`, cached `updateSlidingWindow`) + Task 2 (`domScrollTop` override, `scrollTo`/`scrollBy`) + Task 3 (mixers f).
- §4.4 inert below cap → Tasks 1 (test 1), 2 (test 9), 3 (default props), 4 (full suite).
- §5 edge cases, item by item:
  - 1 (below cap) → Task 1 test 1, Task 2 test 9.
  - 2 (at cap) → Task 1 test 2.
  - 3 (above cap) → Task 1 test 3, Task 2 test 10.
  - 4 (`logicalScrollMax == 0`) → Task 1 test 7(a).
  - 5 (`domScrollMax == 0`) → Task 1 test 7(a).
  - 6 (zero-height viewport) → Task 1 test 7(b).
  - 7 (Firefox vs others) → **not unit-tested by design**: a module-eval UA ternary; tests override `maxScrollHeight` instead, and reachability under a small cap is proven (Task 2 test 10). The per-browser cap value is a trivial constant.
  - 8 (resize) → covered by behavior (heights recompute → derived `domHeight`/`scrollScale`/`renderOffset`); not separately unit-tested.
  - 9 (async height stability) → Task 2 test 14 (logical-delta invariant).
  - 10 (`scrollTo > max`) → Task 2 test 11.
  - 11 (`scrollTo(0)` / negative) → Task 2 test 11.
  - 12 (representative grouping) → Task 3 (representative renderOffset test; scale 1 in practice).
  - 13 (scrubber drag) / 15 (deep link) → behavior + recorded manual (Task 4 Step 5).
  - 14 (scrubber arrow nudge) / 17 (live insert) → no code path change; behavior + manual.
  - 16 (`limitedScroll`) → **not unit-tested by design**: only fires when content < 2× viewport, where `scrollScale` is always 1, so the existing path is provably unaffected; the inert-below-cap tests (Task 1 test 1, Task 2 test 9) cover scale-1 behavior.
  - 18 (DOM rounding) → §7 limitation; unit tests use an exact-arithmetic fake element.
- §6 TDD plan → Tasks 1–4 follow red→green; coverage boundary §6.5 reflected in Task 3 Step 7 note + Task 4 Step 5.
- §7 limitations → documented; tests use exact-arithmetic fake element (no DOM rounding), consistent with §7.
- §8 files touched → matches the File Structure table; circular-import avoidance honored (Task 1 inline const).

**Placeholder scan:** none — every code/test step contains complete content.

**Type consistency:** method/getter names are identical across tasks — `domHeight`, `domScrollMax`, `logicalScrollMax`, `scrollScale`, `domToLogical`, `logicalToDom`, `domScrollTop`, `scrollTop`, `renderOffset`, `maxScrollHeight`. `TimelineRepresentativeBuckets` prop `renderOffset` matches the Timeline.svelte pass-through. Test fixture mirrors the existing `init` describe (3 buckets → `totalViewerHeight == 8337`).
