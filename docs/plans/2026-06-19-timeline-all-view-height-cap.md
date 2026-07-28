# Fix: "All" timeline view hard-stops at a fixed date on large libraries (#713)

- **Issue:** [open-noodle/gallery#713](https://github.com/open-noodle/gallery/issues/713)
- **Date:** 2026-06-19
- **Status:** Approved design — ready for implementation plan
- **Area:** `web/` (SvelteKit timeline)

## 1. Problem

On a library with 563k+ assets, the flat **"All"** timeline (the `day` grouping)
stops rendering at a fixed date (≈ December 2008). Older assets (1926–2007) are
never reachable by scrolling, even though they appear correctly in the **Months**
and **Years** views. Navigating to a pre-2008 date in Months/Years and switching
back to "All" snaps the view back to ≈ December 2008.

### Root cause

The "All" view renders one tall scroll container whose height is set **directly**
to the summed pixel height of every month, and positions each month at its absolute
cumulative pixel offset:

- `web/src/lib/components/timeline/Timeline.svelte` — `#virtual-timeline` height is
  `style:height={timelineManager.totalViewerHeight + 'px'}`; each month is placed at
  `translate3d(0, ${timelineMonth.top}px, 0)`.
- `web/src/lib/managers/timeline-manager/timeline-month.svelte.ts` — `#top` is a pure
  cumulative offset (`newTop = previousMonth.#top + previousMonth.#height`).
- `web/src/lib/managers/timeline-manager/internal/layout-support.svelte.ts` — month
  heights are full-resolution justified-layout pixels. **No scaling/compression exists
  anywhere.**

For 563k assets the cumulative height reaches ≈ 30–40M px, which exceeds the
**browser maximum renderable element height** (Firefox ≈ 17.9M px;
Chrome/Safari ≈ 33.5M px). The browser silently clamps the scroll container's
rendered height, so any month positioned past the cap can never be scrolled into
view. "December 2008" is simply where the cumulative height crosses the cap on that
library.

This explains both symptoms:

1. **Fixed date cutoff** — months beyond the clamped height are unreachable. (Note it
   is a fixed _date_, not a fixed _count_; there is no count cap in the code. A clamped
   cumulative height is the only thing that produces a date cutoff.)
2. **Snap-back from Years/Months → All** — `timeline-anchor.ts:getScrollTopForTarget`
   computes the target's logical `top` (up to 30M+), and `scrollTo` writes it straight
   to the element; the browser clamps `scrollTop` to the real (capped) maximum, landing
   at ≈ December 2008.

Months/Years views work because they render far fewer, smaller representative buckets
that stay under the cap.

This is upstream Immich's architecture (the timeline files come from upstream; the
grouping display modes — PR #625 — are fork-only but sit on top of the same flat
day-view scroller). There is no upstream fix to pull.

## 2. Goals / Non-goals

### Goals

- All assets reachable in "All" view regardless of total count, on all supported
  browsers (Firefox included).
- Years/Months → All preserves the navigated position (fixes symptom #2).
- **Zero behavior change for normal-sized libraries** (below the cap): scale is exactly
  `1`, all coordinates and transforms identical to today.
- Minimal, contained, upstream-styled change (rebase-clean; plausibly contributable to
  immich-app/immich). No new manager classes, no architectural rework.

### Non-goals (YAGNI)

- Pixel-precise wheel scrolling at extreme scale. Accepted: above the cap the scrollbar
  represents the whole compressed timeline, so wheel/trackpad scrolling is coarser
  (~1.9× on the reported library under Firefox). The date scrubber, keyboard, and
  jump-to-asset stay exact. Approved during brainstorming.
- Server/data-layer changes. The data is already correct and indexed.
- Reworking the scrubber, justified layout, or month-loading logic.

## 3. Decisions (from brainstorming)

| Decision           | Choice                                                        |
| ------------------ | ------------------------------------------------------------- |
| Divergence         | Minimal & upstreamable — smallest diff to shared scroll logic |
| Mechanism          | Scroll-space scaling (cap DOM height, map scroll ↔ logical)   |
| Cap value          | **Browser-aware**: Firefox → 17,000,000; others → 33,000,000  |
| Precision tradeoff | Coarser scroll only past the cap is acceptable                |

## 4. Design

### 4.1 Coordinate model

Two coordinate spaces:

- **Logical space** — the true cumulative layout (`month.top`, `totalViewerHeight`,
  `maxScroll`). May reach 30M+ px. _All_ existing layout / intersection / proximity /
  scrubber / anchor math stays in logical space, unchanged.
- **DOM space** — what the browser actually scrolls. The scroll element's height is
  capped at a browser-safe maximum so it never exceeds the render limit.

```
maxScrollHeight   = MAX_SCROLL_HEIGHT   // instance $state, overridable in tests; default below

// Module const in VirtualScrollManager. The Firefox UA check is INLINED rather than imported
// from asset-utils (`isFirefox`), because asset-utils imports TimelineManager, which imports
// VirtualScrollManager — importing it here would create a circular dependency.
MAX_SCROLL_HEIGHT = (typeof navigator !== 'undefined' && navigator.userAgent.includes('Firefox'))
                      ? 17_000_000 : 33_000_000
domHeight         = min(totalViewerHeight, maxScrollHeight)   // = #virtual-timeline height
logicalScrollMax  = max(0, totalViewerHeight - viewportHeight)
domScrollMax      = max(0, domHeight - viewportHeight)
scrollScale       = logicalScrollMax > 0 ? domScrollMax / logicalScrollMax : 1   // ≤ 1; exactly 1 below cap

domToLogical(d)   = domScrollMax     > 0 ? d * logicalScrollMax / domScrollMax : 0
logicalToDom(l)   = logicalScrollMax > 0 ? l * domScrollMax / logicalScrollMax : 0
```

Float64 represents integers exactly up to 2^53, far above 33M — no precision loss.

### 4.2 Rendering: position content relative to the live scroll

Content cannot be placed at its absolute logical `top` (might be 25M while the element is
only 17M). Instead each visible child is positioned relative to the current scroll so the
emitted coordinate **stays bounded near the viewport** (never emits a 25M transform,
which can itself glitch renderers):

```
renderOffset = cachedDomScrollTop − cachedLogicalScrollTop   // = #cachedDomScrollTop − #scrollTop (§4.3); 0 when scrollScale == 1
domY(item)   = item.top + renderOffset                       // always ≈ domScrollTop ± viewport
```

DOM changes (all in `Timeline.svelte` unless noted):

- `#virtual-timeline` height → `timelineManager.domHeight` (was `totalViewerHeight`).
- Day-view month divs (skeleton **and** loaded) →
  `translate3d(0, ${timelineMonth.top + timelineManager.renderOffset}px, 0)`.
- Lead-out spacer →
  `translate3d(0, ${topSectionHeight + bodySectionHeight + timelineManager.renderOffset}px, 0)`.
- Representative buckets (`TimelineRepresentativeBuckets.svelte`) — pass `renderOffset`
  as a prop; `translateY(${bucket.top + renderOffset}px)`. (In practice these are always
  under the cap, so `renderOffset == 0`; applied uniformly for correctness.)
- **Top section stays static at DOM `top: 0` (unchanged).** It lives at the very top of
  the scroll element and scrolls away naturally; near the top `renderOffset ≈ 0`, so it
  aligns with the first month (whose logical `top` already includes `topSectionHeight`).
  Giving it `renderOffset` would emit a large negative transform when scrolled far down —
  avoided.

### 4.3 Single source of truth for scroll position

The deeper cause is several call sites reading raw `scrollableElement.scrollTop` (DOM) and
mixing it with logical coordinates. At `scrollScale == 1` they coincide, hiding the bug;
under scaling they diverge. Fix by routing every scroll-position read through one **logical**
accessor.

`VirtualScrollManager` (base — holds the generic scaling math):

- `get domScrollTop()` → raw DOM scroll position. Base returns `0`; overridden by
  `TimelineManager` to read the element.
- `get scrollTop()` → **logical** = `domToLogical(this.domScrollTop)`. (Replaces the base's
  `return 0` and the subclass's raw-DOM override. Identity at scale 1, so every existing
  imperative caller — `timeline-anchor.ts` — keeps working.)
- `maxScrollHeight` — instance `$state` initialized to the browser-aware constant (overridable
  in tests).
- `domHeight`, `domScrollMax`, `logicalScrollMax`, `scrollScale`, `domToLogical`,
  `logicalToDom` — as in §4.1. `maxScroll` / `maxScrollPercent` stay **logical** (unchanged).
- Cached reactive state for rendering: keep the existing `#scrollTop` `$state` (cached
  **logical**) and add `#cachedDomScrollTop` `$state` (cached raw DOM). `updateSlidingWindow`
  sets both from the live values on every scroll:

  ```
  updateSlidingWindow() {
    const domTop = this.domScrollTop;            // live DOM read (non-reactive)
    const logicalTop = this.domToLogical(domTop);
    if (this.#scrollTop !== logicalTop || this.#cachedDomScrollTop !== domTop) {
      this.#cachedDomScrollTop = domTop;
      this.#scrollTop = logicalTop;
      this.updateViewportProximities();
    }
  }
  ```

- `get renderOffset()` → `this.#cachedDomScrollTop − this.#scrollTop` (both `$state` →
  reactive; templates update on scroll). **Reactivity note:** `renderOffset` must read the
  cached `$state`, never `this.domScrollTop` directly — a live DOM property read is not
  reactive in Svelte 5 and the transforms would not update on scroll.
- `visibleWindow` continues to use `#scrollTop` (now guaranteed logical) — unchanged.

`TimelineManager`:

- `override get domScrollTop()` → `this.#scrollableElement?.scrollTop ?? 0` (replaces the old
  `override get scrollTop()`).
- `scrollTo(logicalTop)` → `this.#scrollableElement?.scrollTo({ top: clamp(this.logicalToDom(logicalTop), 0, this.domScrollMax) })`,
  then `updateSlidingWindow()`. (`clamp` is already imported from `lodash-es` in this file; no new import.)
- `scrollBy(logicalDelta)` → `this.scrollTo(this.scrollTop + logicalDelta)` (absolute remap;
  correct under any scale). Replaces the direct `#scrollableElement.scrollBy`.

`Timeline.svelte` — replace logical/DOM mixers with the logical accessor:

- `scrollToAssetPosition`: `const currentTop = scrollableElement?.scrollTop || 0;` →
  `const currentTop = timelineManager.scrollTop;` (compared against logical `assetTop`).
- `handleTimelineScroll`: `let top = scrollableElement.scrollTop;` →
  `let top = timelineManager.scrollTop;` (walks logical month heights).
- `handleTimelineScroll` limited-scroll branch: `scrollableElement.scrollTop / maxScroll` →
  `timelineManager.scrollTop / maxScroll` (both logical; identical at scale 1).

`timeline-anchor.ts` — **no change**. `getScrollTopForTarget` clamps to logical `maxScroll`,
then `scrollTo` maps logical→DOM. This is what fixes symptom #2.

### 4.4 Why this is consistent and minimal

- The only places that touch DOM scroll are `domScrollTop`, `scrollTo`/`scrollBy`,
  `updateSlidingWindow`, and the `renderOffset` transforms. Everything else is logical and
  untouched.
- At `scrollScale == 1`: `domHeight == totalViewerHeight`, conversions are identity,
  `renderOffset == 0`, transforms are byte-for-byte today's. The change is inert below the cap.

## 5. Edge cases (full enumeration)

| #   | Case                                                                         | Behavior                                                                                                                                                                |
| --- | ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `total ≤ cap` (normal libraries)                                             | `scrollScale = 1`, `domHeight = total`, identity conversions, `renderOffset = 0`. No behavior change.                                                                   |
| 2   | `total == cap` exactly                                                       | `domHeight = total`, `scrollScale = 1`.                                                                                                                                 |
| 3   | `total > cap` (large libraries)                                              | `domHeight = cap`, `scrollScale < 1`; oldest month reachable.                                                                                                           |
| 4   | `logicalScrollMax == 0` (content ≤ viewport, empty/tiny)                     | conversions return `0`, `scrollScale = 1`; no divide-by-zero.                                                                                                           |
| 5   | `domScrollMax == 0`                                                          | `domToLogical` returns `0`; no divide-by-zero.                                                                                                                          |
| 6   | `viewportHeight == 0` / `hasEmptyViewport`                                   | existing guards short-circuit geometry; conversions are safe.                                                                                                           |
| 7   | Firefox vs others                                                            | `maxScrollHeight` differs; both browsers reach all assets.                                                                                                              |
| 8   | Resize / column-count change                                                 | month heights recompute → `total`/`domHeight`/`scrollScale`/`renderOffset` recompute; viewport tracked via logical `#scrollTop`.                                        |
| 9   | Async height resolution (estimate → actual)                                  | existing `scrollBy(heightDelta)` compensation keeps the **logical** viewport position stable. Pixel-exact at scale 1; ≤ a few px drift at scale < 1 (accepted, see §7). |
| 10  | `scrollTo(top)` with `top > logicalScrollMax`                                | clamped to `domScrollMax`.                                                                                                                                              |
| 11  | `scrollTo(0)`                                                                | DOM `0`; top reachable.                                                                                                                                                 |
| 12  | Representative Months/Years grouping                                         | far below cap → `scrollScale = 1`, `renderOffset = 0`; unchanged.                                                                                                       |
| 13  | Scrubber drag on large library                                               | `onScrub` computes logical target → `scrollTo` maps to DOM → lands on the right date.                                                                                   |
| 14  | Scrubber arrow-key nudge (`scrollableElement.scrollBy({behavior:'smooth'})`) | DOM-space nudge; `onscroll` → `updateSlidingWindow` converts. Moves ~`delta/scale` logical px (consistent coarsening). No change needed.                                |
| 15  | Deep link `/photos/<id>` to an old asset                                     | `findTimelineMonthForAsset` loads the month; `scrollToAssetPosition` → `scrollTo(logical)` → DOM. Reachable.                                                            |
| 16  | `limitedScroll` (content < 2× viewport)                                      | only triggers when `total` is tiny → `scrollScale` always `1`; path unaffected.                                                                                         |
| 17  | Live asset insert/remove (websocket upsert)                                  | changes `total` → `domHeight`/`scrollScale`/`renderOffset` recompute (same mechanism as resize #8); above-viewport inserts compensated via the `month.height` setter.   |
| 18  | DOM `scrollTop` integer rounding                                             | browser rounds `scrollTop`; at `scrollScale < 1` a landing target is reached within ≤ ~`1/scrollScale` logical px (≪ one row). Reachability unaffected (see §7).        |

## 6. Strict TDD plan

**Discipline:** every change is written test-first. Each numbered item below is a red→green
cycle: write the failing test, run it (`cd web && pnpm test -- --run <file>`), see it fail for
the expected reason, implement the minimum to pass, then refactor. No production line is written
before a failing test demands it. Run the full timeline suite green before moving on.

### 6.1 New `web/src/lib/managers/VirtualScrollManager/VirtualScrollManager.svelte.spec.ts`

Pure scaling math via a minimal test subclass that exposes a settable raw DOM position and lets
heights be set directly (base `topSectionHeight`/`bodySectionHeight`/`bottomSectionHeight` are
writable `$state`):

```ts
class TestScroller extends VirtualScrollManager {
  #dom = 0;
  override get domScrollTop() {
    return this.#dom;
  }
  setDomScrollTop(v: number) {
    this.#dom = v;
  }
}
```

Tests:

1. **Below cap → identity.** body=10_000, viewport=1000, maxScrollHeight=1_000_000 ⇒
   `domHeight == totalViewerHeight`, `scrollScale == 1`, `domToLogical(x) == x`,
   `logicalToDom(x) == x`; after `setDomScrollTop(500); updateSlidingWindow()` ⇒
   `scrollTop == 500`, `renderOffset == 0`.
2. **At cap.** total == maxScrollHeight ⇒ `domHeight == total`, `scrollScale == 1`.
3. **Above cap → clamp + scale.** body=100_000, viewport=1000, maxScrollHeight=10_000 ⇒
   `domHeight == 10_000`, `0 < scrollScale < 1`.
4. **Endpoints reachable.** `logicalToDom(0) == 0`; `logicalToDom(logicalScrollMax) == domScrollMax`.
5. **Round-trip.** `domToLogical(logicalToDom(x)) ≈ x` for x in {0, mid, logicalScrollMax}.
6. **renderOffset bounded near viewport.** at bottom (`setDomScrollTop(domScrollMax)`), an item at
   logical `total` maps to `domY == domHeight` (≤ cap), not a multi-million-px value.
7. **Divide-by-zero guards.** viewport ≥ total ⇒ `logicalScrollMax == 0` ⇒ conversions return `0`,
   `scrollScale == 1`, no `NaN`/`Infinity`.
8. **Reactivity.** `renderOffset` reads cached `$state`: it changes only after
   `updateSlidingWindow()`, not on a bare `setDomScrollTop`.

### 6.2 Additions to `web/src/lib/managers/timeline-manager/timeline-manager.svelte.ts` spec

Reuse the existing fixture (3 buckets, `totalViewerHeight == 8337`, viewport 1588×1000) plus an
injected fake scroll element:

```ts
// `scrollTo` already clamps, so the fake stores the value verbatim. `scrollBy` is unused
// (manager.scrollBy routes through manager.scrollTo → fakeEl.scrollTo).
const fakeEl = {
  scrollTop: 0,
  scrollTo({ top }) {
    this.scrollTop = top;
  },
} as unknown as HTMLElement;
timelineManager.scrollableElement = fakeEl;
```

9. **Default (below cap) is inert.** With default `maxScrollHeight`, `domHeight == 8337`,
   `scrollScale == 1`; `scrollTo(1000)` ⇒ `fakeEl.scrollTop == 1000`, `timelineManager.scrollTop == 1000`,
   `renderOffset == 0`.
10. **Forced scaling reaches the tail (fixes symptom #1).** set `maxScrollHeight = 4000`
    (logicalScrollMax 7337, domScrollMax 3000); `scrollTo(timelineManager.maxScroll)` ⇒
    `fakeEl.scrollTop == 3000` (== domScrollMax) and `timelineManager.scrollTop == 7337`
    (== logical max) — the oldest content is reachable, not clamped short.
11. **scrollTo clamps.** `scrollTo(10 * total)` ⇒ `fakeEl.scrollTop == domScrollMax`.
12. **scrollBy is logical.** under scaling, `scrollBy(d)` ⇒ `scrollTop` increases by ≈ `d` logical.
13. **scrollTop is logical end-to-end.** set `fakeEl.scrollTop = domScrollMax; updateSlidingWindow()`
    ⇒ `timelineManager.scrollTop == logical max`, `visibleWindow.top == logical max`.
14. **Logical scroll stability on height change (edge #9).** Deterministic core: under scaling,
    `scrollBy(Δ)` moves `timelineManager.scrollTop` by exactly `Δ` (logical) — the invariant the
    existing `month.height` compensation depends on (the setter calls `scrollBy(heightDelta)` when
    an earlier month grows, lines 297–298 of `timeline-month.svelte.ts`). Because that magnitude is
    preserved in logical space, the top-visible month stays fixed. (The compensation logic itself
    is unchanged by this fix; only its `scrollBy`/`scrollTo` calls now convert to DOM space.)

### 6.3 Anchor regression (symptom #2)

Add to the timeline-manager spec (real manager + fake element + forced small cap), or extend
`timeline-anchor.spec.ts`:

15. **Years/Months → All preserves deep position.** with `maxScrollHeight` forced small, set a
    temporal anchor on the **oldest** month and call `scrollTimelineToTemporalAnchor`; assert
    `fakeEl.scrollTop == domScrollMax`, the call returns `true`, and `targetIsInViewport` holds —
    i.e. no snap-back to the cap boundary.
16. **Existing anchor unit tests stay green** (clamping to `maxScroll` unchanged).

### 6.4 Component template wiring

17. **`renderOffset` applied to every absolutely-positioned site.** A focused
    `@testing-library/svelte` component test (the project already uses it) renders `Timeline` with
    a stubbed manager forced to `scrollScale < 1` and asserts each rendered month/bucket
    `translate3d` Y equals `top + renderOffset` (skeleton month, loaded month, lead-out spacer,
    representative bucket), and that `#virtual-timeline` height equals `domHeight`. A forgotten
    `renderOffset` on one site misplaces that element only under `scrollScale < 1`, which the
    manager-only tests cannot catch.
    - **Fallback:** if component-level transform assertions prove impractical in this harness, this
      item degrades to manual verification (§9 steps 1–2), which must then be performed **and
      recorded** before merge — not silently skipped.

### 6.5 Coverage boundary (honest accounting)

- **Fully unit-tested (logic):** the scaling model, conversions, `scrollScale`/`domHeight`, logical
  `scrollTop`, `renderOffset` value + reactivity, `scrollTo`/`scrollBy`, clamping, divide-by-zero
  guards, tail reachability (symptom #1), anchor snap-back (symptom #2), logical stability
  invariant.
- **Indirectly covered:** the three `Timeline.svelte` mixer fixes consume
  `timelineManager.scrollTop`, whose logical value is asserted by tests 9 and 13.
- **Template wiring:** covered by item 17 (component test, or recorded manual fallback).

### 6.6 Full-suite regression

18. `cd web && pnpm test -- --run src/lib/managers/timeline-manager` and the new
    `VirtualScrollManager` spec all green.
19. `cd web && pnpm test` (web unit suite) green — confirms no regression in dependent components.
20. `make check-web` (svelte-check + tsc) clean.

## 7. Accepted limitations

- **Scroll coarsening past the cap.** On the reported 563k library: Chrome/Safari unaffected
  (`scrollScale == 1`); Firefox ≈ 1.9× coarser wheel/trackpad. Scrubber/keyboard/jump-to-asset
  remain exact.
- **Sub-pixel scroll drift during async height resolution at `scrollScale < 1`.** The compensation
  keeps the _logical_ viewport position stable; the proportional DOM remap can introduce ≤ a few px
  of visual drift while month heights firm up on huge libraries. Imperceptible in practice and far
  better than total unreachability. Pixel-exact at `scrollScale == 1` (all normal libraries).
- **`scrollTo` landing precision at `scrollScale < 1`.** Browsers round `scrollTop` to an integer
  (device-pixel), so a logical target lands within ≤ ~`1/scrollScale` logical px (≪ one ~235px
  row even at small scale). Reachability and which month/row is shown are unaffected; only exact
  intra-row alignment drifts. Exact at `scrollScale == 1`. (Unit tests use an exact-arithmetic fake
  element, so they assert the ideal mapping.)

## 8. Files touched

| File                                                                              | Change                                                                                                                  |
| --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `web/src/lib/managers/VirtualScrollManager/VirtualScrollManager.svelte.ts`        | scaling model, conversions, logical `scrollTop`, `domScrollTop`, `renderOffset`, cached DOM `$state`, `maxScrollHeight` |
| `web/src/lib/managers/timeline-manager/timeline-manager.svelte.ts`                | override `domScrollTop`; `scrollTo`/`scrollBy` conversion                                                               |
| `web/src/lib/components/timeline/Timeline.svelte`                                 | `domHeight` height; `renderOffset` transforms; 3 logical/DOM mixer fixes                                                |
| `web/src/lib/components/timeline/TimelineRepresentativeBuckets.svelte`            | `renderOffset` prop on `translateY`                                                                                     |
| `web/src/lib/managers/VirtualScrollManager/VirtualScrollManager.svelte.spec.ts`   | **new** — scaling math tests                                                                                            |
| `web/src/lib/managers/timeline-manager/timeline-manager.svelte.spec.ts`           | scroll-conversion + reachability + stability tests                                                                      |
| `web/src/lib/managers/timeline-manager/timeline-anchor.spec.ts` (or manager spec) | symptom-#2 regression                                                                                                   |
| `web/src/lib/components/timeline/Timeline.svelte.spec.ts`                         | **new (or recorded manual fallback)** — item 17 template-wiring test                                                    |

Inlines the Firefox UA check as a module const in `VirtualScrollManager.svelte.ts` — importing
`isFirefox` from `asset-utils.ts` would create a circular dependency (asset-utils → TimelineManager
→ VirtualScrollManager). New files are limited to the two spec files; no new production files, no
new classes, no upstream-file restructuring.

## 9. Manual verification

Requires a large library (or synthetic data exceeding the cap). On `make dev`:

1. "All" view: scroll to the very bottom — the oldest assets (pre-2008) render; no fixed cutoff.
2. Years (or Months) → click a pre-2008 entry → switch to "All": the view stays on that date; no
   snap-back to 2008.
3. Deep-link `/photos/<id>` for a pre-2008 asset: scrolls to and focuses it.
4. Normal-sized library: scrolling, scrubber, and deep-linking behave exactly as before
   (`scrollScale == 1`).
5. Repeat 1–2 in Firefox (lower cap → scaling engages earlier).
