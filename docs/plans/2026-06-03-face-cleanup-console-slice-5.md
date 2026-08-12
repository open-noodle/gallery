# Face Cleanup Console — Slice 5 (list / triage page) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use
> checkbox (`- [ ]`) syntax. TDD where practical (component tests first for logic; markup follows the mockup).

**Goal:** An admin page at `/admin/face-cleanup` that triggers a scan, polls its progress, renders the flagged
persons grouped (review-first pinned, confident auto-selected), and bulk-approves selected persons via
`applyFaceRepair`.

**Architecture:** A SvelteKit admin route (`+page.ts` loader + `+page.svelte`) using `AdminPageLayout`, Svelte 5
runes, `@immich/ui`, `svelte-i18n`, and the generated `@immich/sdk` (`triggerScan`, `getLatestScan`,
`applyFaceRepair`). Pure presentation/selection logic is extracted into a small testable module so it can be
unit-tested without a DOM.

**Tech Stack:** SvelteKit, Svelte 5 runes, `@immich/ui`, `@immich/sdk`, Vitest + `@testing-library/svelte`.

**Visual contract:** [`face-cleanup-console-mockup.html`](../../face-cleanup-console-mockup.html) — reproduce its
layout, grouping, colour semantics (review-first amber / confident indigo / bad-target red), columns, stat
strip, selection bar — rebuilt with `@immich/ui` primitives (it is hand-rolled HTML; match the _look_, not the
markup).

**Spec:** [`2026-06-03-face-cleanup-console-design.md`](2026-06-03-face-cleanup-console-design.md) §"List / triage page" + §Testing/Slice 5.

---

## File Structure

- Create `web/src/routes/admin/face-cleanup/+page.ts` — loader returning `{ meta: { title } }` (mirror
  `web/src/routes/admin/queues/+page.ts`; same admin-guard mechanism the other admin routes use).
- Create `web/src/routes/admin/face-cleanup/+page.svelte` — the page (uses `AdminPageLayout`).
- Create `web/src/routes/admin/face-cleanup/face-cleanup.svelte.ts` — a small runes-based view-model OR plain
  helpers (selection state, grouping, derived counts) — the unit-testable core.
- Create `web/src/routes/admin/face-cleanup/face-cleanup.spec.ts` — logic unit tests.
- Create `web/src/routes/admin/face-cleanup/FaceCleanupTable.svelte` (+ row component) — presentational, driven
  by props; optional `.spec.ts` with `@testing-library/svelte` for the guardrail behavior.
- Modify the i18n locale (`web/src/lib/i18n/en.json` or wherever `admin.*` keys live — grep `admin.queues`) to
  add the new strings.
- Add a nav entry to the admin sidebar (find where `admin.queues`/`admin.users` nav items are declared —
  likely a sidebar component or the admin layout — and add a "Face cleanup" item linking to
  `/admin/face-cleanup`).

> Confirm the exact admin-route auth pattern + nav declaration by reading `web/src/routes/admin/queues/` and the
> admin sidebar/layout. Mirror them. Do not invent route guards.

---

## Task 1: Selection / grouping view-model (unit, TDD)

Extract the pure logic so it's testable without a DOM. The page binds to it.

**Files:** `face-cleanup.svelte.ts`, `face-cleanup.spec.ts`

The view-model takes the latest scan's `persons` (`FaceRepairScanStatusDto['persons']`, from `@immich/sdk`) and
exposes: `reviewFirst` + `confident` groups (review-first sorted first), a `selected: Set<string>` initialised
to all `confident` person ids, `opened: Set<string>` (review-first rows become selectable once opened),
`toggle(id)`, `open(id)`, `clear()`, `selectedCount`, and `canSelect(id)` (review-first not openable until
opened).

- [ ] **Step 1: Write the failing tests** (`face-cleanup.spec.ts`, plain Vitest — no DOM):

```ts
const person = (over) => ({
  personId: 'p',
  ownerId: 'o',
  personName: null,
  faceCount: 10,
  thumbnailFaceId: null,
  eligible: 10,
  flagged: 8,
  flaggedFraction: 0.8,
  suspectedOwners: [],
  recommendation: 'confident',
  reviewReasons: [],
  ...over,
});

it('groups review-first before confident and pre-selects confident only', () => {
  const vm = createFaceCleanupModel([
    person({ personId: 'c1', recommendation: 'confident' }),
    person({ personId: 'r1', recommendation: 'review-first', reviewReasons: ['named'], personName: 'Jula' }),
  ]);
  expect(vm.reviewFirst.map((p) => p.personId)).toEqual(['r1']);
  expect(vm.confident.map((p) => p.personId)).toEqual(['c1']);
  expect(vm.selected.has('c1')).toBe(true);
  expect(vm.selected.has('r1')).toBe(false);
});

it('review-first not selectable until opened; opening enables it', () => {
  const vm = createFaceCleanupModel([person({ personId: 'r1', recommendation: 'review-first' })]);
  expect(vm.canSelect('r1')).toBe(false);
  vm.open('r1');
  expect(vm.canSelect('r1')).toBe(true);
  vm.toggle('r1');
  expect(vm.selected.has('r1')).toBe(true);
});

it('toggle + clear update selectedCount', () => {
  const vm = createFaceCleanupModel([person({ personId: 'c1' }), person({ personId: 'c2' })]);
  expect(vm.selectedCount).toBe(2);
  vm.toggle('c1');
  expect(vm.selectedCount).toBe(1);
  vm.clear();
  expect(vm.selectedCount).toBe(0);
});
```

- [ ] **Step 2: red → implement `createFaceCleanupModel` (Svelte 5 `$state` runes in a `.svelte.ts`) → green**

Run: `cd web && npx vitest run src/routes/admin/face-cleanup/face-cleanup.spec.ts` (red then green).

- [ ] **Step 3: Commit**

```bash
git add web/src/routes/admin/face-cleanup/face-cleanup.svelte.ts web/src/routes/admin/face-cleanup/face-cleanup.spec.ts
git commit -m "feat(web): face-cleanup list selection/grouping view-model"
```

---

## Task 2: The page + table (component, follows the mockup)

**Files:** `+page.ts`, `+page.svelte`, `FaceCleanupTable.svelte` (+ row), i18n, admin nav

- [ ] **Step 1: Build the route + page**

- `+page.ts`: mirror `admin/queues/+page.ts` (admin guard + `meta.title`).
- `+page.svelte`: `AdminPageLayout` with breadcrumb "Face cleanup". On mount, `getLatestScan()`. If `status` is
  `running`/`pending`, poll `getLatestScan()` on an interval (~2s) and show progress (`progress.scanned/total`);
  stop polling on `completed`/`failed`. A **Re-scan** button calls `triggerScan()` then starts polling. Render
  the **stat strip** (Eligible / Flagged / Auto-repaired / Needs decision / Unattributable) from `totals` +
  `reviewOnlyByReason`. Render `FaceCleanupTable` from the view-model. A **selection bar** shows
  `selectedCount` + a **Re-attribute selected** button → `applyFaceRepair({ faceRepairApplyRequestDto: { approvedPersonIds: [...vm.selected] } })`,
  then re-scan / refetch. Handle the apply **409** (recognition/scan active) with a non-destructive toast/error,
  keep the selection, and disable the button while in flight (no double-submit).
- `FaceCleanupTable.svelte`: the grouped table (review-first group amber header, confident group), columns per
  the mockup (checkbox, person thumbnail+name/"Unnamed cluster", owner, flagged % + bar + fraction, →
  suspected owner thumbnail+name+count, status chip + reasons, **Review** link → `/admin/face-cleanup/{personId}`
  (Slice 6)). Confident checkboxes checked; review-first checkboxes disabled until the row's **Review** is
  opened (call `vm.open(id)` on navigate/open). Use thumbnails via the existing people-thumbnail URL helper
  (grep `getPeopleThumbnailUrl`); `thumbnailFaceId` maps to a face/person thumbnail — use the same helper other
  people UI uses, or the person thumbnail by `personId`.

> Reproduce the mockup's visual grouping + colours with `@immich/ui` + Tailwind classes (`bg-warning`-ish for
> review-first, primary for selection). Match the _look_.

- [ ] **Step 2: i18n + admin nav**

Add the new strings to the locale file (grep `"admin"` in `web/src/lib/i18n/en.json`); add a **Face cleanup**
admin-sidebar entry linking to `/admin/face-cleanup` next to the other admin links.

- [ ] **Step 3: Component tests** (`@testing-library/svelte`) — the spec's Slice-5 behaviors:

- renders review-first group before confident regardless of input order.
- confident rows pre-checked; review-first checkbox disabled until opened.
- selection count + "Re-attribute selected (N)" reflect checkbox state; Clear empties it.
- bulk-approve calls `applyFaceRepair` with the checked `approvedPersonIds` (mock the SDK fn / provider; assert
  the body).
- scan states: `running` → progress shown + polling; `completed` → table; `failed` → error + retry.
- **no scan ever** → "Run a scan to begin" empty state; **completed empty** (0 flagged) → "nothing to clean up".
- apply **409** → non-destructive error, selection kept, button disabled while in-flight.

> Mock the `@immich/sdk` functions (`getLatestScan`, `triggerScan`, `applyFaceRepair`) — follow the web test
> pattern used by other admin specs (e.g. `system-settings/*.spec.ts`); override the SDK module with
> `vi.mock('@immich/sdk', ...)` or the project's provider-override pattern. Use `web`'s `getPeopleThumbnailUrl`
> mock if thumbnails error in happy-dom.

- [ ] **Step 4: Verify + commit**

Run: `cd web && npx vitest run src/routes/admin/face-cleanup/` → green.
Run (the CI gate locally as far as possible): `cd .. && make build-sdk` (if SDK not built) then
`cd web && pnpm check 2>/dev/null || true` (note: `check:svelte` is a local no-op — rely on CI Lint Web/Test Web).
Run `cd web && pnpm lint` → clean.

```bash
git add web/src/routes/admin/face-cleanup web/src/lib/i18n <nav file>
git commit -m "feat(web): face-cleanup admin list/triage page"
```

---

## Self-Review

- **Spec coverage (Slice 5):** grouped review-first-first (T1/T3) ✓; confident pre-checked + review-first
  guarded until opened (T1/T3) ✓; selection count + Clear (T1/T3) ✓; bulk-approve posts checked ids (T3) ✓;
  scan running/completed/failed states (T3) ✓; never-scanned vs empty-report states (T3) ✓; apply 409 +
  no-double-submit (T3) ✓. (Filters/sort from the spec: include simple filter chips if time permits; the
  grouping + selection are the load-bearing behaviors — if filters are deferred, note it and cover grouping.)
- **Placeholders:** the markup is intentionally specified by behavior + the mockup visual contract rather than
  line-by-line Svelte (too verbose to pin); every BEHAVIOR has a concrete test. The "verify against codebase"
  notes (admin guard, nav declaration, thumbnail helper, SDK-mock pattern) each say exactly what to read.
- **Carry-forward:** Slice 6 is the review page the **Review** link opens (`/admin/face-cleanup/{personId}`).
