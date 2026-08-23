# Face Recognition Suggestions — Phase 4 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Ship the **personal web UI** for face suggestions — a per-person header banner
("Faces found that could be this person: N") and a guided one-at-a-time review modal
(full photo + candidate-face highlight, Same/Different), with a client-side localStorage
snooze — consuming the Phase-3 owner-only HTTP API. End-to-end usable in a browser.

**Architecture:** Two new Svelte 5 components mounted on the existing person detail page.
`PersonSuggestionBanner.svelte` reads `{ total, items }` from `getPersonFaceSuggestions`
(size 5) and renders nothing when `total === 0` (the Phase-1 server read-gate already
returns `0` for feature-off / non-scannable / non-owner persons — edges 7, 13, 18 — so the
client does **not** re-implement the gate) or when the person is snoozed in localStorage.
`PersonSuggestionReviewModal.svelte` is a focused queue: it paginates suggestions, shows the
full asset photo with the candidate face boxed, a side-by-side reference (the named person's
thumbnail) vs. candidate crop, and advances on every Same (`confirm`) / Different (`dismiss`)
— treating idempotent `200`s **and** stale-item errors (edges 9/10/11) as "advance". The
candidate face crop is rendered **client-side** from the asset preview + bounding box (Phase
3 returns `assetId`, image dims and `boundingBox*`) because no server endpoint crops an
_unassigned_ face — `/people/:id/faces/:faceId/thumbnail` 404s for a face not yet assigned to
that person (verified: `person.service.ts:388 getFaceThumbnail` requires the face to belong
to the person).

**Tech Stack:** SvelteKit + Svelte 5 runes (`$state`/`$derived`/`$effect`/`$props`),
`@immich/ui` (`Modal`, `Button`, `modalManager`, `toastManager`), generated `@immich/sdk`
(`getPersonFaceSuggestions`, `confirmPersonFaceSuggestion`, `dismissPersonFaceSuggestion`,
`PersonFaceSuggestionResponseDto`), Vitest + `@testing-library/svelte` + happy-dom unit
tests, Playwright web E2E (`e2e/`).

**Design reference:** `specs/2026-05-15-face-recognition-suggestions-design.md`
("Web UI", "Lifecycle & state transitions", "Authorization", Edge cases 1, 7, 9–13).
**Phase 3 output this builds on (already committed):** the three owner-only endpoints and
their generated SDK functions/types — `getPersonFaceSuggestions({ id, page, size }) → {
total, items: PersonFaceSuggestionResponseDto[] }`, `confirmPersonFaceSuggestion({ id,
assetFaceId }) → void`, `dismissPersonFaceSuggestion({ id, assetFaceId }) → void`.
`PersonFaceSuggestionResponseDto = { assetFaceId, assetId, distance, imageWidth,
imageHeight, boundingBoxX1, boundingBoxX2, boundingBoxY1, boundingBoxY2, fileCreatedAt? }`
(`open-api/typescript-sdk/src/fetch-client.ts:1596`).

**Edge cases covered by this phase (UI side):** 1 (user-facing doc note), 7 (banner hidden
when server returns 0), 9 + 10 (deleted person/face mid-review → benign advance), 11
(face auto-assigned between scan and review → benign advance), 13 (feature toggled off →
no banner). **Out of scope:** shared-space suggestions + RBAC (Phase 5 — banner is gated
off for space-scoped persons here), mobile (Phase 6), any server change (no API/DTO/OpenAPI
change in Phase 4 → **do not run `make open-api` or `make sql`**).

**Conventions for every task:** strict TDD (write the failing test, run it, watch it fail
for the expected reason, write the minimal code, run it green, commit). No `--no-verify`.
Run all commands from `/home/pierre/dev/gallery/.worktrees/face-recognition-suggestions`.
Web commands run in `web/`.

- Web unit test: `cd web && pnpm test -- --run <file>`
- Web type check: `make check-web` (svelte-check + tsc)
- Web E2E (needs a running `make dev` stack on :2283): `make e2e-web-dev`
  (single file: `cd e2e && npx playwright test <file>` against the dev stack)

**Memory-derived guardrails (apply throughout):**

- The named person's reference face uses **`getPeopleThumbnailUrl(person)`** from
  `$lib/utils`, **never** `getAssetMediaUrl({ id: faceAssetId })` — `PersonResponseDto` has
  no `faceAssetId` (memory `feedback_people_thumbnail_url`). The _candidate_ crop legitimately
  uses `getAssetMediaUrl` (it is an asset image + bbox, not a person thumbnail).
- Any spec that mounts `@immich/ui` `Modal` MUST add an `afterEach` 50 ms drain or CI fails
  with a bits-ui body-scroll-lock `document is not defined` teardown error (memory
  `feedback_bits_ui_body_scroll_lock_drain`).
- Never mutate `$state` inside `$derived`/`$derived.by` — load suggestion data from an
  `$effect`, not a derived (memory `feedback_svelte_derived_no_mutation`).
- New UI uses Gallery design tokens (`bg-light`, `dark:` prefix, `@immich/ui` primitives) —
  no hardcoded hex (memory `feedback_match_gallery_design`).
- Web ESLint: `unicorn/no-negated-condition` is enforced (memory
  `feedback_web_lint_negated_condition`); numeric literals ≥ 5 digits need `_` separators
  and only `eslint --fix` adds them (memory `feedback_unicorn_numeric_separators`) — but CI
  runs lint, **do not run lint locally**, only `make check-web` (memory
  `feedback_lint_sequential`).
- E2E `waitForQueueFinish` requires an admin token; create the person/asset as **admin**
  so the same token drains queues (memory `feedback_e2e_admin_only_queues`).

---

## Component contract (read before Task 5/6/7)

```
+page.svelte  (person detail — personal only; space-scoped persons skipped, Phase 5)
  │  $effect on person.id:
  │     if isSpaceScopedPerson(person) → total=0          (Phase 5 handles space)
  │     else getPersonFaceSuggestions({id, page:1, size:5})
  │            → suggestionTotal, suggestionPreviews        (server read-gate ⇒ 0 ⇒ hidden)
  │
  ├─ <PersonSuggestionBanner person total={suggestionTotal} previews={suggestionPreviews}
  │       referenceThumbnailUrl={getPeopleThumbnailUrl(person)}  // memory regression (banner side)
  │       onReview={openReviewModal} />
  │        • renders nothing if total===0 OR isSuggestionSnoozed(person.id, total)
  │        • shows [reference avatar] + count + ≤5 <FaceCrop> previews + "Review" + "Not now"
  │        • "Not now" → snoozeSuggestions(person.id, total) → re-evaluates → hides
  │
  └─ openReviewModal():
        const { confirmed } = await modalManager.show(PersonSuggestionReviewModal, {
            person,
            referenceThumbnailUrl: getPeopleThumbnailUrl(person),   // memory regression
            loadPage:  ({page,size}) => getPersonFaceSuggestions({ id: person.id, page, size }),
            confirm:   (assetFaceId) => confirmPersonFaceSuggestion({ id: person.id, assetFaceId }),
            dismiss:   (assetFaceId) => dismissPersonFaceSuggestion({ id: person.id, assetFaceId }),
        });
        await loadSuggestionSummary();          // refresh banner count
        if (confirmed > 0) { await invalidateAll(); thumbnailData = …Date.now()… }  // faces/feature photo changed
```

The modal owns the queue (`items`, `index`, `page`, `total`, `hasNextPage`). Same →
`confirm` then advance; Different → `dismiss` then advance. **Every** resolution advances:
idempotent `200` (edge 12 sibling already resolved) and a thrown error for a vanished
person/face (edges 9, 10) or a face auto-assigned since the scan (edge 11) are all caught
and treated as advance. Lazy-load the next page when within `PREFETCH = 3` of the end while
`items.length < total`. When the queue is exhausted, close with `{ confirmed }`.

**Design-doc-mandated UX (do not drop — these were missing from the first draft and the
design's Phase 4 "TDD coverage" list requires them):**

- The modal exposes **non-destructive Previous / Next** stepping (design Web UI:
  "prev/next; `k / N` counter"). Prev/Next move `index` without calling confirm/dismiss so a
  user can re-examine an item they mis-judged before acting. Same/Different still
  auto-advance. Prev is disabled at index 0; Next is disabled at the end of the loaded
  queue (it does not force a fetch — only Same/Different/auto-advance trigger prefetch).
- The full photo uses the **dim-outside-the-box** treatment already proven in
  `web/src/lib/components/asset-viewer/photo-viewer.svelte:255-263` (an SVG mask that
  darkens everything except the candidate face, plus the white border). This is the single
  biggest "which face am I judging?" clarity win and keeps us visually consistent with the
  existing face-highlight UX — not a new aesthetic.
- The reference (known person) and candidate are rendered at **identical size and shape**
  (same square, same `rounded-lg`) for true like-for-like comparison — comparing a circle
  avatar to a square crop makes "same person?" harder than it needs to be.
- **Keyboard**: a guided one-at-a-time reviewer must be fast. `→` = Same, `←` = Different,
  `[` = Prev, `]` = Next. Esc-to-close is already provided by `@immich/ui` `Modal`.
- The `k / N` counter is `aria-live="polite"` so screen-reader users hear it advance.

This is still **utilitarian**: `@immich/ui` `Modal`/`Button`, Tailwind/`@immich/ui` design
tokens, dark-mode parity, and an interaction pattern lifted verbatim from existing Gallery
code. No custom fonts, gradients, or bespoke chrome.

---

### Task 1: i18n keys

Add every user-facing string up front so components reference real keys (the unit-test `t`
stub returns the key, but `make check-web` and the E2E need the real catalogue; keys are
alphabetically sorted in `i18n/en.json`).

**Files:**

- Modify: `i18n/en.json` (insert each key in its existing alphabetical position)

**Step 1: Add the keys**

Insert these keys into `i18n/en.json`, each at the correct alphabetical location (the file
is one flat alphabetically-sorted object — find the neighbouring key and slot it in):

```json
"face_suggestion_banner_title": "Faces found that could be {name}",
"face_suggestion_banner_title_unnamed": "Faces found that could be this person",
"face_suggestion_count": "{count, plural, one {# face found} other {# faces found}}",
"face_suggestion_not_now": "Not now",
"face_suggestion_review": "Review",
"face_suggestion_modal_title": "Is this {name}?",
"face_suggestion_modal_title_unnamed": "Is this the same person?",
"face_suggestion_same": "Same person",
"face_suggestion_different": "Different person",
"face_suggestion_progress": "{current} of {total}",
"face_suggestion_reference": "Known photo",
"face_suggestion_candidate": "Suggested face",
"face_suggestion_all_done": "All suggestions reviewed",
"face_suggestion_confirmed_toast": "{count, plural, one {# face added} other {# faces added}}",
"errors.unable_to_load_face_suggestions": "Unable to load face suggestions"
```

(Match the existing ICU/`{name}` interpolation style already used elsewhere in the file —
e.g. `assets_count`, `merge_people`. If a `errors` object is nested rather than
dotted-keyed, follow the file's actual convention for the `unable_to_load_face_suggestions`
entry — inspect a neighbouring `errors.unable_to_*` key first and mirror it exactly.)

**Step 2: Verify the catalogue still parses**

Run: `cd web && node -e "JSON.parse(require('fs').readFileSync('../i18n/en.json','utf8')); console.log('ok')"`
Expected: prints `ok` (no JSON syntax error).

**Step 3: Prettier the catalogue**

Run: `cd web && pnpm exec prettier --write ../i18n/en.json`
Expected: no diff beyond formatting (CI Docs/format is strict — memory `feedback_format_docs`
is about `docs/`, but `i18n/en.json` is formatted by the web prettier config used here).

**Step 4: Commit**

```bash
git add i18n/en.json
git commit -m "feat(web): add i18n strings for face-suggestion banner and review modal"
```

---

### Task 2: `getFaceCropTransform` pure helper

A pure function that maps a face bounding box (in original-image pixel space) to CSS
`background-size` / `background-position` percentages that reveal exactly that sub-rectangle
in a square container. This is the canonical CSS background-percentage crop technique;
deterministic and unit-testable with exact expected strings. Slight non-uniform scaling is
acceptable for a small preview crop — the modal additionally shows the **undistorted full
photo** with an accurate highlight, so context is never distorted. Lives next to the
existing `getBoundingBox` in `people-utils.ts`.

**Files:**

- Modify: `web/src/lib/utils/people-utils.ts` (add `getFaceCropTransform` + a `FaceBox` type
  near `getBoundingBox`, ~line 66-80)
- Test: `web/src/lib/utils/people-utils.spec.ts` (create — there is no existing spec for
  this file; if one exists, append a `describe` instead)

**Step 1: Write the failing test**

Create `web/src/lib/utils/people-utils.spec.ts`:

```ts
import { getFaceCropTransform } from '$lib/utils/people-utils';
import { describe, expect, it } from 'vitest';

describe('getFaceCropTransform', () => {
  it('centres a half-size box: scales 200% and positions at 50%/50%', () => {
    // box occupies x:[2500,7500] of 10000 wide, y:[1500,4500] of 6000 tall
    // → normalized bw=0.5, bh=0.5 ; size = 100/0.5 = 200%
    // → posX = (0.25 / (1-0.5)) * 100 = 50 ; posY = (0.25 / (1-0.5)) * 100 = 50
    const t = getFaceCropTransform({
      imageWidth: 10_000,
      imageHeight: 6000,
      boundingBoxX1: 2500,
      boundingBoxX2: 7500,
      boundingBoxY1: 1500,
      boundingBoxY2: 4500,
    });
    expect(t).toEqual({ backgroundSize: '200% 200%', backgroundPosition: '50% 50%' });
  });

  it('top-left full-width-tall box maps to 0% position', () => {
    const t = getFaceCropTransform({
      imageWidth: 1000,
      imageHeight: 1000,
      boundingBoxX1: 0,
      boundingBoxX2: 250,
      boundingBoxY1: 0,
      boundingBoxY2: 250,
    });
    // bw=bh=0.25 → size 400% ; posX=posY=(0/(1-0.25))*100 = 0
    expect(t).toEqual({ backgroundSize: '400% 400%', backgroundPosition: '0% 0%' });
  });

  it('degenerate (zero-area / full-frame) box falls back to cover/center', () => {
    expect(
      getFaceCropTransform({
        imageWidth: 100,
        imageHeight: 100,
        boundingBoxX1: 0,
        boundingBoxX2: 0,
        boundingBoxY1: 0,
        boundingBoxY2: 0,
      }),
    ).toEqual({ backgroundSize: 'cover', backgroundPosition: 'center' });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd web && pnpm test -- --run src/lib/utils/people-utils.spec.ts`
Expected: FAIL — `getFaceCropTransform` is not exported.

**Step 3: Write minimal implementation**

In `web/src/lib/utils/people-utils.ts`, add after `getBoundingBox` (~line 80):

```ts
export type FaceBox = {
  imageWidth: number;
  imageHeight: number;
  boundingBoxX1: number;
  boundingBoxX2: number;
  boundingBoxY1: number;
  boundingBoxY2: number;
};

export type FaceCropTransform = { backgroundSize: string; backgroundPosition: string };

/**
 * CSS background size/position that reveals exactly the face sub-rectangle of an image
 * inside a square container. Non-uniform scale is intentional for compact preview crops;
 * the review modal shows the undistorted full photo separately.
 */
export const getFaceCropTransform = (face: FaceBox): FaceCropTransform => {
  const bw = (face.boundingBoxX2 - face.boundingBoxX1) / face.imageWidth;
  const bh = (face.boundingBoxY2 - face.boundingBoxY1) / face.imageHeight;

  if (!(bw > 0) || !(bh > 0) || bw >= 1 || bh >= 1) {
    return { backgroundSize: 'cover', backgroundPosition: 'center' };
  }

  const nx1 = face.boundingBoxX1 / face.imageWidth;
  const ny1 = face.boundingBoxY1 / face.imageHeight;
  const posX = (nx1 / (1 - bw)) * 100;
  const posY = (ny1 / (1 - bh)) * 100;

  return {
    backgroundSize: `${100 / bw}% ${100 / bh}%`,
    backgroundPosition: `${posX}% ${posY}%`,
  };
};
```

**Step 4: Run test to verify it passes**

Run: `cd web && pnpm test -- --run src/lib/utils/people-utils.spec.ts`
Then: `make check-web`
Expected: PASS (3 tests); no type errors.

**Step 5: Commit**

```bash
git add web/src/lib/utils/people-utils.ts web/src/lib/utils/people-utils.spec.ts
git commit -m "feat(web): add getFaceCropTransform crop-math helper"
```

---

### Task 3: `face-suggestion-snooze.ts` localStorage util

Per-person "Not now" snooze. Mirrors the existing `space-hero-storage.ts` pattern exactly
(single localStorage key holding a `Record<personId, …>`, `browser` guard, try/catch around
corrupt JSON). The snooze stores the suggestion **count at snooze time** and an **expiry
timestamp** so the banner reappears when the count grows (new suggestions arrived) or after
~30 days (design: "reappears after expiry or when count increases").

**Files:**

- Create: `web/src/lib/utils/face-suggestion-snooze.ts`
- Test: `web/src/lib/utils/face-suggestion-snooze.spec.ts`

**Step 1: Write the failing test**

Create `web/src/lib/utils/face-suggestion-snooze.spec.ts`:

```ts
import { SUGGESTION_SNOOZE_MS, isSuggestionSnoozed, snoozeSuggestions } from '$lib/utils/face-suggestion-snooze';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('face-suggestion-snooze', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.useRealTimers());

  it('is not snoozed when nothing is stored', () => {
    expect(isSuggestionSnoozed('p1', 3)).toBe(false);
  });

  it('snoozes a person at a given count and hides until the count grows', () => {
    snoozeSuggestions('p1', 3);
    expect(isSuggestionSnoozed('p1', 3)).toBe(true);
    expect(isSuggestionSnoozed('p1', 3 /* unchanged */)).toBe(true);
    // more suggestions than at snooze time → resurface
    expect(isSuggestionSnoozed('p1', 4)).toBe(false);
  });

  it('a fewer/equal count stays snoozed; other people are unaffected', () => {
    snoozeSuggestions('p1', 5);
    expect(isSuggestionSnoozed('p1', 2)).toBe(true);
    expect(isSuggestionSnoozed('p2', 1)).toBe(false);
  });

  it('expires after SUGGESTION_SNOOZE_MS', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-16T00:00:00Z'));
    snoozeSuggestions('p1', 3);
    expect(isSuggestionSnoozed('p1', 3)).toBe(true);

    vi.setSystemTime(new Date(Date.now() + SUGGESTION_SNOOZE_MS + 1000));
    expect(isSuggestionSnoozed('p1', 3)).toBe(false);
  });

  it('survives corrupt JSON without throwing', () => {
    localStorage.setItem('gallery-face-suggestion-snooze', '{not json');
    expect(isSuggestionSnoozed('p1', 1)).toBe(false);
    expect(() => snoozeSuggestions('p1', 1)).not.toThrow();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd web && pnpm test -- --run src/lib/utils/face-suggestion-snooze.spec.ts`
Expected: FAIL — module/exports do not exist.

**Step 3: Write minimal implementation**

Create `web/src/lib/utils/face-suggestion-snooze.ts` (mirror `space-hero-storage.ts`):

```ts
import { browser } from '$app/environment';

const STORAGE_KEY = 'gallery-face-suggestion-snooze';

export const SUGGESTION_SNOOZE_MS = 30 * 24 * 60 * 60 * 1000; // ~30 days

type SnoozeRecord = Record<string, { until: number; count: number }>;

const read = (): SnoozeRecord => {
  if (!browser) {
    return {};
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as SnoozeRecord) : {};
  } catch {
    return {};
  }
};

export function isSuggestionSnoozed(personId: string, total: number): boolean {
  const entry = read()[personId];
  if (!entry) {
    return false;
  }
  if (Date.now() >= entry.until) {
    return false;
  }
  // resurface as soon as there are more suggestions than when the user snoozed
  return total <= entry.count;
}

export function snoozeSuggestions(personId: string, total: number): void {
  if (!browser) {
    return;
  }
  try {
    const record = read();
    record[personId] = { until: Date.now() + SUGGESTION_SNOOZE_MS, count: total };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(record));
  } catch {
    /* localStorage unavailable */
  }
}
```

> Note: vitest/happy-dom sets `browser` true. The corrupt-JSON `snoozeSuggestions` test
> passes because `JSON.parse` failure is caught in `read()`, `record` becomes `{}`, and the
> subsequent `setItem` succeeds (overwriting the corrupt value) — assert only that it does
> not throw, which the test does.

**Step 4: Run test to verify it passes**

Run: `cd web && pnpm test -- --run src/lib/utils/face-suggestion-snooze.spec.ts`
Then: `make check-web`
Expected: PASS (5 tests); no type errors.

**Step 5: Commit**

```bash
git add web/src/lib/utils/face-suggestion-snooze.ts web/src/lib/utils/face-suggestion-snooze.spec.ts
git commit -m "feat(web): add localStorage snooze for face suggestions"
```

---

### Task 4: `FaceCrop.svelte` component

A square `div` whose `background-image` is the asset preview and whose
`background-size`/`background-position` come from `getFaceCropTransform`, so an unassigned
candidate face renders as a crop with **no server endpoint** (a candidate face is not yet
assigned to any person; `getFaceThumbnail` 404s — see plan header). Uses `getAssetMediaUrl`
(legitimate: this is an asset image, not a person thumbnail).

**Files:**

- Create: `web/src/lib/components/faces-page/face-crop.svelte`
- Test: `web/src/lib/components/faces-page/face-crop.spec.ts`

**Step 1: Write the failing test**

Create `web/src/lib/components/faces-page/face-crop.spec.ts`:

```ts
import FaceCrop from '$lib/components/faces-page/face-crop.svelte';
import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';

const face = {
  assetId: 'asset-1',
  imageWidth: 1000,
  imageHeight: 1000,
  boundingBoxX1: 0,
  boundingBoxX2: 250,
  boundingBoxY1: 0,
  boundingBoxY2: 250,
};

describe('FaceCrop', () => {
  it('renders a labelled image element backed by the asset media URL and crop transform', () => {
    render(FaceCrop, { props: { face, label: 'Suggested face' } });
    const el = screen.getByRole('img', { name: 'Suggested face' });
    const style = el.getAttribute('style') ?? '';
    // getFaceCropTransform({...,0.25}) → 400% / 0% 0%
    expect(style).toContain('background-size: 400% 400%');
    expect(style).toContain('background-position: 0% 0%');
    // asset media URL (NOT a person thumbnail) — assert the asset id is in the url
    expect(style).toContain('asset-1');
    expect(style).toContain('background-image');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd web && pnpm test -- --run src/lib/components/faces-page/face-crop.spec.ts`
Expected: FAIL — component file does not exist.

**Step 3: Write minimal implementation**

Create `web/src/lib/components/faces-page/face-crop.svelte`:

```svelte
<script lang="ts">
  import { getAssetMediaUrl } from '$lib/utils';
  import { getFaceCropTransform, type FaceBox } from '$lib/utils/people-utils';
  import { AssetMediaSize } from '@immich/sdk';

  interface Props {
    face: FaceBox & { assetId: string };
    label: string;
    class?: string;
  }

  let { face, label, class: className = '' }: Props = $props();

  const url = $derived(getAssetMediaUrl({ id: face.assetId, size: AssetMediaSize.Preview }));
  const transform = $derived(getFaceCropTransform(face));
</script>

<div
  role="img"
  aria-label={label}
  data-testid="face-crop"
  class="aspect-square w-full overflow-hidden rounded-lg bg-gray-200 bg-no-repeat dark:bg-gray-800 {className}"
  style="background-image: url('{url}'); background-size: {transform.backgroundSize}; background-position: {transform.backgroundPosition};"
></div>
```

`AssetMediaSize` is exported by `@immich/sdk` (used widely, e.g. `web/src/lib/utils.ts`).

**Step 4: Run test to verify it passes**

Run: `cd web && pnpm test -- --run src/lib/components/faces-page/face-crop.spec.ts`
Then: `make check-web`
Expected: PASS (1 test); no type errors.

**Step 5: Commit**

```bash
git add web/src/lib/components/faces-page/face-crop.svelte web/src/lib/components/faces-page/face-crop.spec.ts
git commit -m "feat(web): add client-side FaceCrop component for unassigned candidate faces"
```

---

### Task 5: `PersonSuggestionBanner.svelte`

Header banner. Renders nothing when `total === 0` (server read-gate already collapses
feature-off / non-scannable / non-owner to `0` — edges 7, 13, 18) **or** when snoozed.
Otherwise: the named person's **reference thumbnail** (so the user instantly sees _who_
"could be" — the design's Phase 4 TDD list mandates a `getPeopleThumbnailUrl`-not-
`getAssetMediaUrl` regression test on the banner; memory `feedback_people_thumbnail_url`),
a count line, ≤5 `FaceCrop` candidate previews, **Review** and **Not now** buttons. "Not
now" snoozes and re-evaluates so the banner disappears immediately. The reference URL is
computed by the parent page (`getPeopleThumbnailUrl(person)`) and passed in — the banner
never builds a person-thumbnail URL itself.

> **Before hand-rolling the card:** grep `@immich/ui` and `web/src/lib/components` for an
> existing inline-notification / alert / banner primitive (e.g. `Alert`, `Notification`,
> `Card`) and reuse it for visual consistency if one fits. The classes below are a
> token-only fallback (`bg-light`, `border-gray-*`, `dark:`) if none exists — utilitarian,
> not a new style language.

**Files:**

- Create: `web/src/lib/components/faces-page/person-suggestion-banner.svelte`
- Test: `web/src/lib/components/faces-page/person-suggestion-banner.spec.ts`

**Step 1: Write the failing test**

Create `web/src/lib/components/faces-page/person-suggestion-banner.spec.ts`:

```ts
import PersonSuggestionBanner from '$lib/components/faces-page/person-suggestion-banner.svelte';
import { snoozeSuggestions } from '$lib/utils/face-suggestion-snooze';
import type { PersonFaceSuggestionResponseDto, PersonResponseDto } from '@immich/sdk';
import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('svelte-i18n', () => ({
  t: { subscribe: (run: (f: (k: string) => string) => void) => (run((k) => k), () => {}) },
}));

const person = { id: 'p1', name: 'Alice', isHidden: false, type: 'person' } as PersonResponseDto;
const REF = '/api/people/p1/thumbnail?updatedAt=x'; // what getPeopleThumbnailUrl(person) returns

function previews(n: number): PersonFaceSuggestionResponseDto[] {
  return Array.from({ length: n }, (_, i) => ({
    assetFaceId: `f${i}`,
    assetId: `a${i}`,
    distance: 0.6,
    imageWidth: 100,
    imageHeight: 100,
    boundingBoxX1: 10,
    boundingBoxX2: 40,
    boundingBoxY1: 10,
    boundingBoxY2: 40,
  }));
}

const base = (over: Record<string, unknown> = {}) => ({
  person,
  total: 3,
  previews: previews(3),
  referenceThumbnailUrl: REF,
  onReview: vi.fn(),
  ...over,
});

describe('PersonSuggestionBanner', () => {
  beforeEach(() => localStorage.clear());
  afterEach(async () => {
    await new Promise((r) => setTimeout(r, 50));
  });

  it('renders nothing when total is 0', () => {
    render(PersonSuggestionBanner, { props: base({ total: 0, previews: [] }) });
    expect(screen.queryByTestId('person-suggestion-banner')).not.toBeInTheDocument();
  });

  it('shows the count and at most 5 preview crops when total > 0', () => {
    render(PersonSuggestionBanner, { props: base({ total: 9, previews: previews(8) }) });
    expect(screen.getByTestId('person-suggestion-banner')).toBeInTheDocument();
    expect(screen.getAllByTestId('face-crop')).toHaveLength(5);
  });

  it('renders the reference avatar from the passed-in person-thumbnail URL, NOT an asset URL (regression — feedback_people_thumbnail_url)', () => {
    render(PersonSuggestionBanner, { props: base() });
    const ref = screen.getByTestId('suggestion-banner-reference') as HTMLImageElement;
    expect(ref.getAttribute('src')).toBe(REF);
    // never an asset-media URL for the person reference
    expect(ref.getAttribute('src')).not.toContain('/assets/');
  });

  it('Review fires onReview', async () => {
    const onReview = vi.fn();
    render(PersonSuggestionBanner, { props: base({ onReview }) });
    await userEvent.click(screen.getByTestId('suggestion-review-btn'));
    expect(onReview).toHaveBeenCalledOnce();
  });

  it('Not now snoozes and hides the banner', async () => {
    render(PersonSuggestionBanner, { props: base() });
    await userEvent.click(screen.getByTestId('suggestion-snooze-btn'));
    expect(screen.queryByTestId('person-suggestion-banner')).not.toBeInTheDocument();
  });

  it('stays hidden while snoozed at the same count but reappears when the count grows', () => {
    snoozeSuggestions('p1', 3);
    const { unmount } = render(PersonSuggestionBanner, { props: base() });
    expect(screen.queryByTestId('person-suggestion-banner')).not.toBeInTheDocument();
    unmount();
    render(PersonSuggestionBanner, { props: base({ total: 5, previews: previews(5) }) });
    expect(screen.getByTestId('person-suggestion-banner')).toBeInTheDocument();
  });
});
```

(The final assertion uses a fresh `render` after `unmount` to avoid Svelte 5 prop-rerender
subtleties.)

**Step 2: Run test to verify it fails**

Run: `cd web && pnpm test -- --run src/lib/components/faces-page/person-suggestion-banner.spec.ts`
Expected: FAIL — component does not exist.

**Step 3: Write minimal implementation**

Create `web/src/lib/components/faces-page/person-suggestion-banner.svelte`:

```svelte
<script lang="ts">
  import FaceCrop from '$lib/components/faces-page/face-crop.svelte';
  import { isSuggestionSnoozed, snoozeSuggestions } from '$lib/utils/face-suggestion-snooze';
  import type { PersonFaceSuggestionResponseDto, PersonResponseDto } from '@immich/sdk';
  import { Button } from '@immich/ui';
  import { mdiAccountQuestionOutline } from '@mdi/js';
  import { t } from 'svelte-i18n';

  interface Props {
    person: PersonResponseDto;
    total: number;
    previews: PersonFaceSuggestionResponseDto[];
    referenceThumbnailUrl: string;
    onReview: () => void;
  }

  let { person, total, previews, referenceThumbnailUrl, onReview }: Props = $props();

  let snoozeTick = $state(0);
  const visible = $derived(total > 0 && (snoozeTick, !isSuggestionSnoozed(person.id, total)));
  const shownPreviews = $derived(previews.slice(0, 5));

  const title = $derived(
    person.name
      ? $t('face_suggestion_banner_title', { values: { name: person.name } })
      : $t('face_suggestion_banner_title_unnamed'),
  );

  const snooze = () => {
    snoozeSuggestions(person.id, total);
    snoozeTick++; // force re-evaluation of `visible`
  };
</script>

{#if visible}
  <div
    data-testid="person-suggestion-banner"
    class="mx-4 my-3 flex flex-col gap-3 rounded-2xl border border-gray-200 bg-light p-4 sm:mx-6 dark:border-gray-700"
  >
    <div class="flex items-center justify-between gap-3">
      <div class="flex min-w-0 items-center gap-3">
        <img
          data-testid="suggestion-banner-reference"
          src={referenceThumbnailUrl}
          alt={person.name || $t('face_suggestion_reference')}
          class="h-9 w-9 shrink-0 rounded-full object-cover"
        />
        <p class="truncate font-medium text-primary">{title}</p>
      </div>
      <p class="shrink-0 text-sm text-gray-500 dark:text-gray-400">
        {$t('face_suggestion_count', { values: { count: total } })}
      </p>
    </div>

    <div class="flex gap-2">
      {#each shownPreviews as item (item.assetFaceId)}
        <div class="w-14">
          <FaceCrop face={item} label={$t('face_suggestion_candidate')} />
        </div>
      {/each}
    </div>

    <div class="flex gap-2">
      <Button
        size="small"
        shape="round"
        leadingIcon={mdiAccountQuestionOutline}
        data-testid="suggestion-review-btn"
        onclick={onReview}
      >
        {$t('face_suggestion_review')}
      </Button>
      <Button
        size="small"
        shape="round"
        color="secondary"
        data-testid="suggestion-snooze-btn"
        onclick={snooze}
      >
        {$t('face_suggestion_not_now')}
      </Button>
    </div>
  </div>
{/if}
```

> The `(snoozeTick, !isSuggestionSnoozed(...))` comma keeps `snoozeTick` as a tracked
> dependency so clicking "Not now" re-runs the snooze check without an `$effect` mutating
> `$state` (memory `feedback_svelte_derived_no_mutation`). If `make check-web` /
> `svelte-check` dislikes the comma expression, replace with an explicit
> `$derived.by(() => { void snoozeTick; return total > 0 && !isSuggestionSnoozed(person.id, total); })`
> (`void` so `no-unused-expressions` does not reject the bare dependency read).

**Step 4: Run test to verify it passes**

Run: `cd web && pnpm test -- --run src/lib/components/faces-page/person-suggestion-banner.spec.ts`
Then: `make check-web`
Expected: PASS (6 tests); no type errors.

**Step 5: Commit**

```bash
git add web/src/lib/components/faces-page/person-suggestion-banner.svelte web/src/lib/components/faces-page/person-suggestion-banner.spec.ts
git commit -m "feat(web): add PersonSuggestionBanner with snooze"
```

---

### Task 6: `PersonSuggestionReviewModal.svelte`

The focused queue. Loads page 1 on mount; shows the full asset photo with everything
**dimmed except the candidate face** (the proven `photo-viewer.svelte` SVG-mask pattern),
a same-size **reference (named person thumbnail via `getPeopleThumbnailUrl` — memory
regression) beside the candidate `FaceCrop`** for like-for-like comparison, an
`aria-live` `current/total` counter, non-destructive **Prev / Next** stepping, and
**Same person** (confirm) / **Different person** (dismiss). Same/Different advance;
idempotent `200`s and stale-item errors (edges 9/10/11) are caught and **still advance**.
Keyboard: `→`=Same, `←`=Different, `]`=Next, `[`=Prev (Esc-close via `@immich/ui`
`Modal`). Lazy-loads the next page within `PREFETCH` of the end. Exhausted queue →
`onClose({ confirmed })`.

**Files:**

- Create: `web/src/lib/modals/PersonSuggestionReviewModal.svelte`
- Test: `web/src/lib/modals/PersonSuggestionReviewModal.spec.ts`

**Step 1: Write the failing test**

Create `web/src/lib/modals/PersonSuggestionReviewModal.spec.ts`:

```ts
import PersonSuggestionReviewModal from '$lib/modals/PersonSuggestionReviewModal.svelte';
import type { PersonFaceSuggestionPageResponseDto, PersonResponseDto } from '@immich/sdk';
import '@testing-library/jest-dom';
import { render, screen, waitFor } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('svelte-i18n', () => ({
  t: { subscribe: (run: (f: (k: string) => string) => void) => (run((k) => k), () => {}) },
}));

const person = { id: 'p1', name: 'Alice', updatedAt: '2026-01-01T00:00:00.000Z' } as PersonResponseDto;

function item(id: string) {
  return {
    assetFaceId: id,
    assetId: `asset-${id}`,
    distance: 0.6,
    imageWidth: 100,
    imageHeight: 100,
    boundingBoxX1: 10,
    boundingBoxX2: 40,
    boundingBoxY1: 10,
    boundingBoxY2: 40,
  };
}
const page1: PersonFaceSuggestionPageResponseDto = { total: 2, items: [item('f1'), item('f2')] };

function setup(
  overrides: Partial<{
    loadPage: ReturnType<typeof vi.fn>;
    confirm: ReturnType<typeof vi.fn>;
    dismiss: ReturnType<typeof vi.fn>;
    onClose: ReturnType<typeof vi.fn>;
  }> = {},
) {
  const props = {
    person,
    referenceThumbnailUrl: '/api/people/p1/thumbnail',
    loadPage: overrides.loadPage ?? vi.fn().mockResolvedValue(page1),
    confirm: overrides.confirm ?? vi.fn().mockResolvedValue(undefined),
    dismiss: overrides.dismiss ?? vi.fn().mockResolvedValue(undefined),
    onClose: overrides.onClose ?? vi.fn(),
  };
  render(PersonSuggestionReviewModal, { props });
  return props;
}

describe('PersonSuggestionReviewModal', () => {
  afterEach(async () => {
    await new Promise((r) => setTimeout(r, 50)); // bits-ui scroll-lock drain
  });

  it('loads page 1 and shows the first candidate + reference + counter', async () => {
    setup();
    await waitFor(() =>
      expect(screen.getByTestId('suggestion-progress')).toHaveTextContent('face_suggestion_progress'),
    );
    expect(screen.getByTestId('suggestion-full-photo')).toBeInTheDocument();
    expect(screen.getByTestId('suggestion-highlight')).toBeInTheDocument();
    // reference image uses getPeopleThumbnailUrl output, NOT an asset media url
    const ref = screen.getByTestId('suggestion-reference') as HTMLImageElement;
    expect(ref.getAttribute('src')).toContain('/api/people/p1/thumbnail');
  });

  it('Same person calls confirm then advances; last item closes with confirmed count', async () => {
    const confirm = vi.fn().mockResolvedValue(undefined);
    const onClose = vi.fn();
    setup({ confirm, onClose });
    await waitFor(() => screen.getByTestId('suggestion-same-btn'));

    await userEvent.click(screen.getByTestId('suggestion-same-btn'));
    expect(confirm).toHaveBeenCalledWith('f1');
    await userEvent.click(screen.getByTestId('suggestion-same-btn'));
    expect(confirm).toHaveBeenCalledWith('f2');

    await waitFor(() => expect(onClose).toHaveBeenCalledWith({ confirmed: 2 }));
  });

  it('Different person calls dismiss and advances', async () => {
    const dismiss = vi.fn().mockResolvedValue(undefined);
    setup({ dismiss });
    await waitFor(() => screen.getByTestId('suggestion-different-btn'));
    await userEvent.click(screen.getByTestId('suggestion-different-btn'));
    expect(dismiss).toHaveBeenCalledWith('f1');
  });

  it('Next then Prev step the queue WITHOUT confirm/dismiss; Prev disabled at start', async () => {
    const confirm = vi.fn();
    const dismiss = vi.fn();
    setup({ confirm, dismiss });
    await waitFor(() => screen.getByTestId('suggestion-progress'));

    // at index 0 → Prev disabled
    expect(screen.getByTestId('suggestion-prev-btn')).toBeDisabled();

    await userEvent.click(screen.getByTestId('suggestion-next-btn'));
    expect(screen.getByTestId('suggestion-progress')).toHaveTextContent('2'); // moved to 2 of 2
    await userEvent.click(screen.getByTestId('suggestion-prev-btn'));
    expect(screen.getByTestId('suggestion-progress')).toHaveTextContent('1');

    expect(confirm).not.toHaveBeenCalled();
    expect(dismiss).not.toHaveBeenCalled();
  });

  it('keyboard: ArrowRight confirms, ArrowLeft dismisses', async () => {
    const confirm = vi.fn().mockResolvedValue(undefined);
    const dismiss = vi.fn().mockResolvedValue(undefined);
    setup({ confirm, dismiss });
    await waitFor(() => screen.getByTestId('suggestion-same-btn'));
    await userEvent.keyboard('{ArrowRight}'); // f1 → confirm
    expect(confirm).toHaveBeenCalledWith('f1');
    await userEvent.keyboard('{ArrowLeft}'); // f2 → dismiss
    expect(dismiss).toHaveBeenCalledWith('f2');
  });

  it('a stale item (confirm rejects — edges 9/10/11) still advances', async () => {
    const confirm = vi.fn().mockRejectedValue(new Error('404'));
    const onClose = vi.fn();
    setup({ confirm, onClose });
    await waitFor(() => screen.getByTestId('suggestion-same-btn'));
    await userEvent.click(screen.getByTestId('suggestion-same-btn')); // f1 errors
    await userEvent.click(screen.getByTestId('suggestion-same-btn')); // f2
    await waitFor(() => expect(onClose).toHaveBeenCalledWith({ confirmed: 1 }));
  });

  it('a stale item (dismiss rejects — edges 9/10/11) still advances (symmetry)', async () => {
    const dismiss = vi.fn().mockRejectedValue(new Error('404'));
    const onClose = vi.fn();
    setup({ dismiss, onClose });
    await waitFor(() => screen.getByTestId('suggestion-different-btn'));
    await userEvent.click(screen.getByTestId('suggestion-different-btn')); // f1 errors
    await userEvent.click(screen.getByTestId('suggestion-different-btn')); // f2
    await waitFor(() => expect(onClose).toHaveBeenCalledWith({ confirmed: 0 }));
  });

  it('closes immediately with confirmed:0 when the first page is empty', async () => {
    const onClose = vi.fn();
    setup({ loadPage: vi.fn().mockResolvedValue({ total: 0, items: [] }), onClose });
    await waitFor(() => expect(onClose).toHaveBeenCalledWith({ confirmed: 0 }));
  });

  it('lazily loads the next page as the queue nears its end', async () => {
    const loadPage = vi
      .fn()
      .mockResolvedValueOnce({ total: 4, items: [item('f1'), item('f2'), item('f3')] })
      .mockResolvedValueOnce({ total: 4, items: [item('f4')] });
    setup({ loadPage });
    await waitFor(() => screen.getByTestId('suggestion-same-btn'));
    await userEvent.click(screen.getByTestId('suggestion-same-btn')); // advance to index 1 (within PREFETCH of end)
    await waitFor(() => expect(loadPage).toHaveBeenCalledTimes(2));
    expect(loadPage).toHaveBeenLastCalledWith({ page: 2, size: 50 });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd web && pnpm test -- --run src/lib/modals/PersonSuggestionReviewModal.spec.ts`
Expected: FAIL — modal does not exist.

**Step 3: Write minimal implementation**

Create `web/src/lib/modals/PersonSuggestionReviewModal.svelte`:

```svelte
<script lang="ts">
  import FaceCrop from '$lib/components/faces-page/face-crop.svelte';
  import { getAssetMediaUrl } from '$lib/utils';
  import { getContentMetrics } from '$lib/utils/container-utils';
  import { handleError } from '$lib/utils/handle-error';
  import { getBoundingBox } from '$lib/utils/people-utils';
  import {
    AssetMediaSize,
    type PersonFaceSuggestionPageResponseDto,
    type PersonFaceSuggestionResponseDto,
    type PersonResponseDto,
  } from '@immich/sdk';
  import { Button, IconButton, Modal, ModalBody, ModalFooter } from '@immich/ui';
  import {
    mdiAccountCheckOutline,
    mdiAccountRemoveOutline,
    mdiChevronLeft,
    mdiChevronRight,
  } from '@mdi/js';
  import { onMount } from 'svelte';
  import { t } from 'svelte-i18n';

  type PageReq = { page: number; size: number };

  interface Props {
    person: PersonResponseDto;
    referenceThumbnailUrl: string;
    loadPage: (req: PageReq) => Promise<PersonFaceSuggestionPageResponseDto>;
    confirm: (assetFaceId: string) => Promise<void>;
    dismiss: (assetFaceId: string) => Promise<void>;
    onClose: (result: { confirmed: number }) => void;
  }

  let { person, referenceThumbnailUrl, loadPage, confirm, dismiss, onClose }: Props = $props();

  const PAGE_SIZE = 50;
  const PREFETCH = 3;

  let items = $state<PersonFaceSuggestionResponseDto[]>([]);
  let total = $state(0);
  let index = $state(0);
  let pageNumber = $state(0);
  let loading = $state(true);
  let busy = $state(false);
  let confirmed = $state(0);

  let imgEl = $state<HTMLImageElement>();
  let imgReady = $state(false);

  const current = $derived(items[index]);
  const photoUrl = $derived(current ? getAssetMediaUrl({ id: current.assetId, size: AssetMediaSize.Preview }) : '');

  const highlight = $derived.by(() => {
    if (!current || !imgReady || !imgEl) {
      return undefined;
    }
    return getBoundingBox(
      [
        {
          id: current.assetFaceId,
          imageWidth: current.imageWidth,
          imageHeight: current.imageHeight,
          boundingBoxX1: current.boundingBoxX1,
          boundingBoxX2: current.boundingBoxX2,
          boundingBoxY1: current.boundingBoxY1,
          boundingBoxY2: current.boundingBoxY2,
        },
      ],
      getContentMetrics(imgEl),
    )[0];
  });

  async function fetchPage(next: number) {
    const res = await loadPage({ page: next, size: PAGE_SIZE });
    total = res.total;
    items = next === 1 ? res.items : [...items, ...res.items];
    pageNumber = next;
  }

  onMount(async () => {
    try {
      await fetchPage(1);
    } catch (error) {
      handleError(error, $t('errors.unable_to_load_face_suggestions'));
      onClose({ confirmed });
      return;
    } finally {
      loading = false;
    }
    if (items.length === 0) {
      onClose({ confirmed });
    }
  });

  async function maybePrefetch() {
    if (items.length < total && index >= items.length - PREFETCH) {
      try {
        await fetchPage(pageNumber + 1);
      } catch {
        /* keep what we have; user can still finish the loaded queue */
      }
    }
  }

  async function advance() {
    index++;
    if (index >= items.length && items.length >= total) {
      onClose({ confirmed });
      return;
    }
    await maybePrefetch();
    if (index >= items.length) {
      onClose({ confirmed });
    }
  }

  async function act(kind: 'confirm' | 'dismiss') {
    if (busy || !current) {
      return;
    }
    busy = true;
    const face = current.assetFaceId;
    try {
      if (kind === 'confirm') {
        await confirm(face);
        confirmed++;
      } else {
        await dismiss(face);
      }
    } catch {
      // edges 9/10/11: person/face vanished or face already assigned — benign, advance anyway
    } finally {
      busy = false;
    }
    await advance();
  }

  // Non-destructive stepping: re-examine without acting. Never forces a fetch — only
  // Same/Different (auto-advance) drive prefetch.
  const canPrev = $derived(index > 0);
  const canNext = $derived(index < items.length - 1);

  function step(delta: number) {
    if (busy) {
      return;
    }
    const next = index + delta;
    if (next >= 0 && next < items.length) {
      index = next;
    }
  }

  // Reset the per-image "loaded" flag whenever the candidate changes so the highlight
  // recomputes against the NEW image's content metrics ($effect may mutate state;
  // $derived may not — memory feedback_svelte_derived_no_mutation).
  $effect(() => {
    void current?.assetFaceId;
    imgReady = false;
  });

  function onKeydown(event: KeyboardEvent) {
    if (loading) {
      return;
    }
    switch (event.key) {
      case 'ArrowRight': {
        event.preventDefault();
        void act('confirm');
        break;
      }
      case 'ArrowLeft': {
        event.preventDefault();
        void act('dismiss');
        break;
      }
      case ']': {
        step(1);
        break;
      }
      case '[': {
        step(-1);
        break;
      }
    }
  }
</script>

<svelte:window onkeydown={onKeydown} />

<Modal title={person.name
    ? $t('face_suggestion_modal_title', { values: { name: person.name } })
    : $t('face_suggestion_modal_title_unnamed')}
  size="large"
  onClose={() => onClose({ confirmed })}
>
  <ModalBody>
    <div class="min-h-96">
      {#if loading}
        <div data-testid="suggestion-loading" class="h-96 animate-pulse rounded-lg bg-gray-200 dark:bg-gray-800"></div>
      {:else if current}
        <div class="flex flex-col gap-4">
          <p
            data-testid="suggestion-progress"
            aria-live="polite"
            class="text-center text-sm text-gray-500 dark:text-gray-400"
          >
            {$t('face_suggestion_progress', { values: { current: index + 1, total } })}
          </p>

          <!-- Full photo, everything dimmed except the candidate face — the proven
               photo-viewer.svelte:255-263 SVG-mask pattern (consistency, not a new style). -->
          <div class="relative mx-auto max-h-[60vh]">
            <img
              bind:this={imgEl}
              data-testid="suggestion-full-photo"
              src={photoUrl}
              alt={$t('face_suggestion_candidate')}
              class="max-h-[60vh] w-auto rounded-lg object-contain"
              onload={() => (imgReady = true)}
            />
            {#if highlight}
              <svg class="pointer-events-none absolute inset-0 h-full w-full">
                <defs>
                  <mask id="suggestion-dim-mask">
                    <rect width="100%" height="100%" fill="white" />
                    <rect
                      x={highlight.left}
                      y={highlight.top}
                      width={highlight.width}
                      height={highlight.height}
                      rx="8"
                      fill="black"
                    />
                  </mask>
                </defs>
                <rect width="100%" height="100%" fill="rgba(0,0,0,0.55)" mask="url(#suggestion-dim-mask)" />
              </svg>
              <div
                data-testid="suggestion-highlight"
                class="pointer-events-none absolute rounded-lg border-3 border-solid border-white"
                style="top: {highlight.top}px; left: {highlight.left}px; width: {highlight.width}px; height: {highlight.height}px;"
              ></div>
            {:else}
              <div data-testid="suggestion-highlight" class="hidden"></div>
            {/if}
          </div>

          <!-- Like-for-like comparison: same square, same rounding, same size -->
          <div class="mx-auto flex items-end gap-6">
            <div class="flex flex-col items-center gap-1">
              <img
                data-testid="suggestion-reference"
                src={referenceThumbnailUrl}
                alt={$t('face_suggestion_reference')}
                class="h-24 w-24 rounded-lg object-cover"
              />
              <span class="text-xs text-gray-500 dark:text-gray-400">{$t('face_suggestion_reference')}</span>
            </div>
            <div class="flex flex-col items-center gap-1">
              <div class="h-24 w-24">
                <FaceCrop face={current} label={$t('face_suggestion_candidate')} />
              </div>
              <span class="text-xs text-gray-500 dark:text-gray-400">{$t('face_suggestion_candidate')}</span>
            </div>
          </div>
        </div>
      {/if}
    </div>
  </ModalBody>

  <ModalFooter>
    <div class="flex w-full items-center justify-between gap-3">
      <IconButton
        variant="ghost"
        shape="round"
        icon={mdiChevronLeft}
        aria-label={$t('previous')}
        disabled={busy || !canPrev}
        data-testid="suggestion-prev-btn"
        onclick={() => step(-1)}
      />
      <div class="flex justify-center gap-3">
        <Button
          shape="round"
          color="secondary"
          disabled={busy || !current}
          leadingIcon={mdiAccountRemoveOutline}
          data-testid="suggestion-different-btn"
          onclick={() => act('dismiss')}
        >
          {$t('face_suggestion_different')}
        </Button>
        <Button
          shape="round"
          disabled={busy || !current}
          leadingIcon={mdiAccountCheckOutline}
          data-testid="suggestion-same-btn"
          onclick={() => act('confirm')}
        >
          {$t('face_suggestion_same')}
        </Button>
      </div>
      <IconButton
        variant="ghost"
        shape="round"
        icon={mdiChevronRight}
        aria-label={$t('next')}
        disabled={busy || !canNext}
        data-testid="suggestion-next-btn"
        onclick={() => step(1)}
      />
    </div>
  </ModalFooter>
</Modal>
```

> happy-dom does not lay out images, so `getContentMetrics(imgEl)` returns zeros and
> `highlight` may be falsy in unit tests — that is why the test asserts the
> `suggestion-highlight` element merely _exists_ (the `{:else}` hidden stub guarantees it),
> not its pixel geometry, and the dim-mask `<svg>` only renders when `highlight` is truthy
> (real geometry is exercised by the existing `getBoundingBox` tests + Task 8 browser
> verification). `getContentMetrics` is exported from `$lib/utils/container-utils` (used by
> `photo-viewer.svelte`). `IconButton`, `previous`, `next` already exist in `@immich/ui` /
> `i18n/en.json` — verify the exact `@immich/ui` icon-button export name and `variant`
> values against an existing usage (e.g. grep `IconButton` in `web/src`) and match it; if
> the project wraps icon buttons differently, mirror that wrapper instead.

**Step 4: Run test to verify it passes**

Run: `cd web && pnpm test -- --run src/lib/modals/PersonSuggestionReviewModal.spec.ts`
Then: `make check-web`
Expected: PASS (9 tests); no type errors. If the lazy-prefetch test is timing-sensitive,
keep `PREFETCH = 3` and a 3-item first page so advancing once (index 1) satisfies
`index >= items.length - PREFETCH` (1 ≥ 3-3) — deterministic, no fake timers.

**Step 5: Commit**

```bash
git add web/src/lib/modals/PersonSuggestionReviewModal.svelte web/src/lib/modals/PersonSuggestionReviewModal.spec.ts
git commit -m "feat(web): add PersonSuggestionReviewModal guided review queue"
```

---

### Task 7: Wire banner + modal into the person detail page

Mount the banner on the personal person detail page and open the modal from it. Personal
only — space-scoped persons are explicitly skipped (Phase 5). After a review session,
refresh the banner count; if anything was confirmed, `invalidateAll()` (re-runs `+page.ts`
→ fresh statistics) and bust the thumbnail (faces/feature photo changed).

**Files:**

- Modify: `web/src/routes/(user)/people/[personId]/[[photos=photos]]/[[assetId=id]]/+page.svelte`
- Test: `web/src/routes/(user)/people/[personId]/[[photos=photos]]/[[assetId=id]]/person-detail-page.spec.ts`
  (extend — do not rewrite; add a `describe('face suggestions')`)

**Step 1: Write the failing test**

Append to `person-detail-page.spec.ts` (reuse its `renderPage`, `makePerson`, `sdkMock`,
`beforeEach`). Add the SDK mocks the new code calls; the file already mocks
`$lib/modals/RepresentativeFacePickerModal.svelte` as noop — add the same noop mock for the
new modal so the page test never mounts the real modal:

```ts
vi.mock('$lib/modals/PersonSuggestionReviewModal.svelte', async () => {
  const { default: MockComponent } = await import('@test-data/mocks/noop-component.svelte');
  return { default: MockComponent };
});

describe('face suggestions', () => {
  it('renders the banner when the API returns suggestions for a named owned person', async () => {
    sdkMock.getPersonFaceSuggestions.mockResolvedValue({
      total: 4,
      items: [
        {
          assetFaceId: 'f1',
          assetId: 'a1',
          distance: 0.6,
          imageWidth: 100,
          imageHeight: 100,
          boundingBoxX1: 10,
          boundingBoxX2: 40,
          boundingBoxY1: 10,
          boundingBoxY2: 40,
        },
      ],
    });
    renderPage({ person: makePerson({ name: 'Alice' }) });
    await screen.findByTestId('person-suggestion-banner');
    expect(sdkMock.getPersonFaceSuggestions).toHaveBeenCalledWith({ id: 'person-1', page: 1, size: 5 });
  });

  it('renders no banner when the API returns total 0 (server read-gate: edges 7/13)', async () => {
    sdkMock.getPersonFaceSuggestions.mockResolvedValue({ total: 0, items: [] });
    renderPage({ person: makePerson({ name: 'Alice' }) });
    // allow the onMount/$effect microtask to settle
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByTestId('person-suggestion-banner')).not.toBeInTheDocument();
  });

  it('does not query suggestions for a space-scoped person (Phase 5 scope)', async () => {
    renderPage({
      person: makePerson({
        name: 'Alice',
        primaryProfile: { type: 'space-person', id: 'sp1', spaceId: 'space-1' },
      } as never),
    });
    await new Promise((r) => setTimeout(r, 0));
    expect(sdkMock.getPersonFaceSuggestions).not.toHaveBeenCalled();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd web && pnpm test -- --run "src/routes/(user)/people/[personId]/[[photos=photos]]/[[assetId=id]]/person-detail-page.spec.ts"`
Expected: FAIL — `sdkMock.getPersonFaceSuggestions` is undefined / banner never renders
(`getPersonFaceSuggestions` not imported/called by the page).

**Step 3: Write minimal implementation**

In `+page.svelte`:

3a. Add SDK imports to the existing `from '@immich/sdk'` block:

```ts
    getPersonFaceSuggestions,
    confirmPersonFaceSuggestion,
    dismissPersonFaceSuggestion,
    type PersonFaceSuggestionResponseDto,
```

3b. Import the banner + modal (with the other component imports near the top):

```ts
import PersonSuggestionBanner from '$lib/components/faces-page/person-suggestion-banner.svelte';
import PersonSuggestionReviewModal from '$lib/modals/PersonSuggestionReviewModal.svelte';
```

3c. Add state + loader + open handler (place near the other `$state`/handlers, after
`thumbnailData` is declared so `getScopedThumbnailUrl` is in scope):

```ts
let suggestionTotal = $state(0);
let suggestionPreviews = $state<PersonFaceSuggestionResponseDto[]>([]);

const loadSuggestionSummary = async () => {
  if (isSpaceScopedPerson(person)) {
    suggestionTotal = 0;
    suggestionPreviews = [];
    return;
  }
  try {
    const res = await getPersonFaceSuggestions({ id: person.id, page: 1, size: 5 });
    suggestionTotal = res.total;
    suggestionPreviews = res.items;
  } catch {
    suggestionTotal = 0;
    suggestionPreviews = [];
  }
};

$effect(() => {
  void person.id; // re-run when navigating between people
  void loadSuggestionSummary();
});

const openSuggestionReview = async () => {
  const result = await modalManager.show(PersonSuggestionReviewModal, {
    person,
    referenceThumbnailUrl: getPeopleThumbnailUrl(person),
    loadPage: ({ page, size }: { page: number; size: number }) =>
      getPersonFaceSuggestions({ id: person.id, page, size }),
    confirm: (assetFaceId: string) => confirmPersonFaceSuggestion({ id: person.id, assetFaceId }),
    dismiss: (assetFaceId: string) => dismissPersonFaceSuggestion({ id: person.id, assetFaceId }),
  });
  await loadSuggestionSummary();
  if (result && result.confirmed > 0) {
    await invalidateAll();
    thumbnailData = getScopedThumbnailUrl(person, Date.now().toString());
  }
};
```

`isSpaceScopedPerson`, `getPeopleThumbnailUrl`, `modalManager`, `invalidateAll` are already
imported in this file.

3d. Mount the banner inside the `VIEW_ASSETS` block, immediately after the closing `</div>`
of the "Person information block" (`+page.svelte:557`, just before `{/if}` that closes
`viewMode === PersonPageViewMode.VIEW_ASSETS`):

```svelte
        <PersonSuggestionBanner
          {person}
          total={suggestionTotal}
          previews={suggestionPreviews}
          referenceThumbnailUrl={getPeopleThumbnailUrl(person)}
          onReview={openSuggestionReview}
        />
```

**Step 4: Run test to verify it passes**

Run: `cd web && pnpm test -- --run "src/routes/(user)/people/[personId]/[[photos=photos]]/[[assetId=id]]/person-detail-page.spec.ts"`
Then: `make check-web`
Expected: PASS (existing person-detail-page tests still green + 3 new); no type errors.

> If `$effect` causes a `state_unsafe_mutation`/`effect_update_depth` svelte-check error,
> switch the loader trigger to `onMount(() => { void loadSuggestionSummary(); })` plus an
> explicit re-load in `afterNavigate` — but `$effect` reading `person.id` and calling an
> async function that assigns `$state` is the idiomatic Svelte 5 pattern and should pass.

**Step 5: Commit**

```bash
git add "web/src/routes/(user)/people/[personId]/[[photos=photos]]/[[assetId=id]]/+page.svelte" "web/src/routes/(user)/people/[personId]/[[photos=photos]]/[[assetId=id]]/person-detail-page.spec.ts"
git commit -m "feat(web): mount face-suggestion banner + review modal on person page"
```

---

### Task 8: Playwright web E2E (seeded fixtures, ML disabled)

End-to-end golden path against a running stack. ML is not available in the e2e/dev stack, so
suggestions are **seeded via raw SQL** (same strategy as the Phase-3 API e2e
`e2e/src/specs/server/api/person-face-suggestions.e2e-spec.ts`). The owner is **admin** so
the same token can `waitForQueueFinish` (memory `feedback_e2e_admin_only_queues`). A real
asset is uploaded so the candidate crop / full photo actually render.

**Files:**

- Create: `e2e/src/specs/web/person-face-suggestions.e2e-spec.ts`

**Step 1: Write the failing E2E**

Create `e2e/src/specs/web/person-face-suggestions.e2e-spec.ts` (model imports/structure on
`e2e/src/specs/web/photos-filter-panel.e2e-spec.ts`; reuse the two tiny seed helpers from
the Phase-3 API spec verbatim):

```ts
import { updateConfig } from '@immich/sdk';
import type { LoginResponseDto } from '@immich/sdk';
import { expect, test } from '@playwright/test';
import { asBearerAuth, utils } from 'src/utils';

test.describe('Person face suggestions (web)', () => {
  let admin: LoginResponseDto;
  let personId: string;

  test.beforeAll(async () => {
    utils.initSdk();
    await utils.resetDatabase();
    admin = await utils.adminSetup();

    // open the read-gate: suggestionMaxDistance (0.8) > maxDistance (0.5)
    const config = await utils.getSystemConfig(admin.accessToken);
    config.machineLearning.facialRecognition.suggestionMaxDistance = 0.8;
    await updateConfig({ systemConfigDto: config }, { headers: asBearerAuth(admin.accessToken) });

    const person = await utils.createPerson(admin.accessToken, { name: 'E2E Suggest Target' });
    personId = person.id;

    const asset = await utils.createAsset(admin.accessToken);
    await utils.waitForQueueFinish(admin.accessToken, 'thumbnailGeneration');

    const db = await utils.connectDatabase();
    const mkFace = async () => {
      const r = await db.query<{ id: string }>(`INSERT INTO asset_face ("assetId") VALUES ($1) RETURNING id`, [
        asset.id,
      ]);
      return r.rows[0].id;
    };
    for (const distance of [0.55, 0.6, 0.65]) {
      const faceId = await mkFace();
      await db.query(`INSERT INTO person_face_suggestion ("personId", "assetFaceId", distance) VALUES ($1, $2, $3)`, [
        personId,
        faceId,
        distance,
      ]);
    }
  });

  test.afterAll(async () => {
    const cfg = await utils.getSystemConfig(admin.accessToken);
    cfg.machineLearning.facialRecognition.suggestionMaxDistance = 0;
    await updateConfig({ systemConfigDto: cfg }, { headers: asBearerAuth(admin.accessToken) });
  });

  test('banner shows the count and opens the review modal; Same person confirms', async ({ context, page }) => {
    await utils.setAuthCookies(context, admin.accessToken);
    await page.goto(`/people/${personId}`);
    await page.evaluate(() => localStorage.clear());
    await page.reload();

    const banner = page.locator('[data-testid="person-suggestion-banner"]');
    await expect(banner).toBeVisible();

    await page.locator('[data-testid="suggestion-review-btn"]').click();
    await expect(page.locator('[data-testid="suggestion-progress"]')).toBeVisible();

    await page.locator('[data-testid="suggestion-same-btn"]').click(); // confirm face 1
    // queue advances; progress still visible for remaining items
    await expect(page.locator('[data-testid="suggestion-progress"]')).toBeVisible();

    // server-side proof: one fewer pending suggestion
    const res = await fetch(
      `${process.env.IMMICH_INSTANCE_URL ?? 'http://127.0.0.1:2283/api'}/people/${personId}/face-suggestions`,
      {
        headers: { Authorization: `Bearer ${admin.accessToken}` },
      },
    );
    const body = await res.json();
    expect(body.total).toBeLessThan(3);
  });

  test('Not now snoozes the banner across reloads', async ({ context, page }) => {
    await utils.setAuthCookies(context, admin.accessToken);
    await page.goto(`/people/${personId}`);
    await page.evaluate(() => localStorage.clear());
    await page.reload();

    await expect(page.locator('[data-testid="person-suggestion-banner"]')).toBeVisible();
    await page.locator('[data-testid="suggestion-snooze-btn"]').click();
    await expect(page.locator('[data-testid="person-suggestion-banner"]')).toBeHidden();

    await page.reload();
    await expect(page.locator('[data-testid="person-suggestion-banner"]')).toBeHidden();
  });
});
```

> Verify the exact API base-URL helper used by sibling specs (some use `app` from
> `src/utils`, some `request(app)` via supertest). Prefer importing `{ app }` from
> `src/utils` and using `request(app)` (supertest) for the server-side assertion, exactly
> like the Phase-3 API spec, instead of raw `fetch` + an env guess — adjust the assertion
> block to match the sibling pattern you find. The two `db.query` seed snippets are copied
> from the Phase-3 API spec; if that spec exports reusable helpers, import them instead of
> duplicating.

**Step 2: Run E2E to verify it fails (then drives the feature)**

With a dev stack up (`make dev`), run:
`cd e2e && npx playwright test src/specs/web/person-face-suggestions.e2e-spec.ts`
Expected: FAIL the first time only if Tasks 1–7 are not yet built; after Tasks 1–7 it
should drive any remaining wiring gaps (selectors, route). Fix wiring until green. Do **not**
add retries to mask flakes (memory `feedback_no_flake_allowance`,
`feedback_never_skip_tests`).

**Step 3: Make it pass**

Iterate on selectors/route only; no production logic should change beyond `data-testid`s
already added in Tasks 5–6. Confirm `thumbnailGeneration` is a valid
`QueuesResponseLegacyDto` key (grep `waitForQueueFinish` callers in `e2e/src/utils.ts`); if
the queue name differs, use the correct one (e.g. `'thumbnailGeneration'` vs `'thumbnail'`).

**Step 4: Run the full web E2E once to check for regressions**

Run: `make e2e-web-dev` (or the project's standard web E2E command). Expected: the new spec
green, no sibling regressions.

**Step 5: Commit**

```bash
git add e2e/src/specs/web/person-face-suggestions.e2e-spec.ts
git commit -m "test(e2e): web E2E for face-suggestion banner, review confirm and snooze"
```

---

### Task 9: User-facing docs note (edge 1) + final gates + browser verification

Edge case 1 is "deliberate, documented": Dismiss suppresses _suggestions only_ — a later
within-`maxDistance` match still auto-assigns the face (zero-regression promise). The design
mandates this be surfaced in user-facing docs.

**Files:**

- Modify: the people/face-recognition user doc under `docs/docs/` (locate it:
  `grep -ril "facial recognition\|people" docs/docs | head` — likely
  `docs/docs/features/facial-recognition.md` or the features index; add a short subsection.
  If no suitable page exists, add a concise note to the most relevant existing features page
  rather than creating a new file — do not create new docs files unless unavoidable).

**Step 1: Add the doc note**

Add a short subsection, e.g.:

```markdown
### Face suggestions

When a named person has near-miss faces (similar but below the auto-assign threshold),
Gallery surfaces them as **suggestions** on that person's page. Review them one at a time:

- **Same person** assigns the face to the person (and improves future matching).
- **Different person** dismisses the suggestion — it will never be suggested for this
  person again. The face itself stays unassigned.

> Dismissing only hides the _suggestion_. If a future, more confident match puts that same
> face within the automatic-recognition threshold, it can still be auto-assigned — by design,
> so dismissing a suggestion never blocks normal recognition.
```

**Step 2: Prettier the docs**

Run: `cd docs && pnpm exec prettier --write <changed-file>`
(Use the `docs` package's own prettier — memory `feedback_format_docs`: wrong cwd passes
locally but fails CI Docs Build.)
Expected: formatting only.

**Step 3: Final gates**

Run, sequentially (memory `feedback_no_parallel_tests`):

- `make check-web` → clean (svelte-check + tsc)
- `cd web && pnpm test -- --run src/lib/utils/people-utils.spec.ts src/lib/utils/face-suggestion-snooze.spec.ts src/lib/components/faces-page/face-crop.spec.ts src/lib/components/faces-page/person-suggestion-banner.spec.ts src/lib/modals/PersonSuggestionReviewModal.spec.ts "src/routes/(user)/people/[personId]/[[photos=photos]]/[[assetId=id]]/person-detail-page.spec.ts"`
  → all green
- Do **not** run `make open-api` / `make sql` (no server change in Phase 4).
- Do **not** run lint locally (CI handles it — memory `feedback_lint_sequential`); ensure
  no negated conditions / unseparated long numerics were introduced (the code above already
  complies).

**Step 4: Browser verification (REQUIRED before claiming done)**

With `make dev` running, in a real browser (golden path + edge cases — design Phase 4 exit
criteria mandates this):

1. Enable the feature: Admin → Machine Learning → Facial Recognition → set
   `suggestionMaxDistance` above `maxDistance` (e.g. 0.7 vs 0.5), save.
2. Seed suggestions for a named person you own (run the scan job, or raw-SQL seed as in the
   E2E) and open that person's page.
3. **Banner**: the person reference avatar renders (real face, not a blank circle — proves
   the `getPeopleThumbnailUrl` path) **and** ≤5 candidate crops render (not blank — proves
   `FaceCrop` reads the asset preview; the memory `feedback_people_thumbnail_url` failure
   mode would show empty circles).
4. **Review**: full photo loads with everything **dimmed except the candidate face**; the
   highlight box is accurate (resize the window — the box + dim mask track the letterboxed
   image via `getContentMetrics`); reference and candidate render at the same size/shape
   side-by-side for a clean comparison.
5. **Prev/Next**: stepping forward then back does **not** confirm/dismiss; the `k/N` counter
   updates; Prev is disabled on the first item. **Keyboard**: `→` confirms, `←` dismisses,
   `]`/`[` step — verify each.
6. **Same person** → toast / face assigned; queue advances; at the end the modal closes,
   banner count drops, the timeline/statistics refresh (`invalidateAll`).
7. **Different person** → advances; reload the scan → the dismissed face is **not**
   re-suggested (Phase-1 conditional upsert).
8. **Not now** → banner disappears; reload → still gone; (optionally) lower then re-raise
   the count by seeding more → banner returns.
9. **Edge 13**: set `suggestionMaxDistance` back to `0` → reload person page → no banner.
10. Note in the turn summary exactly what was exercised. If any step cannot be verified in a
    browser, say so explicitly — do not claim success (CLAUDE.md UI rule).

**Step 5: Commit**

```bash
git add docs/docs
git commit -m "docs: document face-suggestion review and the dismiss/auto-assign behavior"
```

---

## Phase 4 exit criteria

- `PersonSuggestionBanner.svelte`: renders nothing when the API returns `total === 0`
  (server read-gate already collapses feature-off / non-scannable / non-owner to 0 — the
  client does not re-implement the gate; edges 7, 13, 18) **or** when snoozed; otherwise
  the named person's **reference avatar from the passed-in `getPeopleThumbnailUrl` URL**
  (regression-tested it is NOT an asset-media URL — memory `feedback_people_thumbnail_url`,
  design-mandated), count + ≤5 `FaceCrop` previews + Review/Not now; "Not now" persists a
  ~30-day localStorage snooze that resurfaces when the count grows.
- `PersonSuggestionReviewModal.svelte`: paginated queue, full asset photo **dimmed except
  the candidate face** (the proven `photo-viewer.svelte` SVG-mask pattern) with an accurate
  highlight (`getBoundingBox` + `getContentMetrics`), a **same-size like-for-like** reference
  (via **`getPeopleThumbnailUrl`** — memory regression, never `getAssetMediaUrl`) beside the
  candidate `FaceCrop`, an `aria-live` `current/total` counter, **non-destructive Prev/Next**
  stepping (design-mandated; Prev disabled at index 0, Next at queue end, neither forces a
  fetch), **keyboard** (`→`=Same, `←`=Different, `]`/`[`=Next/Prev), Same→`confirm`+advance,
  Different→`dismiss`+advance, lazy next-page within `PREFETCH` of the end, exhausted→
  `onClose({ confirmed })`. Idempotent 200s and stale-item errors (edges 9, 10, 11) are
  caught and **still advance** — proven for **both** confirm and dismiss. Specs include the
  bits-ui `afterEach` 50 ms drain.
- Candidate faces render client-side via `FaceCrop` + `getFaceCropTransform` (no server crop
  endpoint exists for an unassigned face — verified against `getFaceThumbnail`).
- Person detail page mounts the banner (personal only — space-scoped persons skipped for
  Phase 5), opens the modal, refreshes the count after review and `invalidateAll()`s +
  busts the thumbnail when ≥1 confirm occurred.
- Web unit suites green; `make check-web` clean; Prettier-clean (`i18n/en.json` via web
  prettier, docs via the `docs` package prettier).
- Playwright web E2E: seeded rows → banner visible → Review → Same confirms (server-side
  total drops) → Not now snoozes across reloads. No retry/flake allowances.
- User docs state the deliberate edge-1 behavior (dismiss suppresses suggestions only;
  auto-assign still applies).
- **Verified in a running browser** (golden path + edges 7/13/9-11), explicitly reported.

**Not in this phase:** shared-space suggestions + RBAC matrix and the space-scoped banner
(Phase 5 — the banner is deliberately gated off for `isSpaceScopedPerson` here), mobile
(Phase 6). No server/API/OpenAPI/SQL change in Phase 4.

```

```
