# Face Verdict Remediation — Slice 8: The suggestion modal tells the truth — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax. **WEB-ONLY slice.**

**Goal:** Close **D8** (the suggestion modal pages with fixed offsets over a server list its own actions shrink → closes "complete" with ~half the queue unseen; and `act()`'s bare `catch` makes 500s indistinguishable from success) and **D17** (snooze baseline never rebases + keyed per-person not per-user; modal back-nav re-enables acted rows; failed initial page loads render as reassuring empty states; console bulk-apply partial failure skips the refetch).

**Architecture:** Acted items vanish server-side (confirm/reject drain the pending row), so the only stable cursor is the **head of the list**. The modal always refetches **page 1**, keeps a client `actedFaceIds` skip-set for the settle race, closes only when a fresh page-1 fetch yields nothing new, surfaces `act()` errors via `handleError` (only the documented already-resolved case advances silently), and renders acted rows read-only. Snooze keys by `userId:personId` and rebases its baseline down on each banner fetch. The three admin pages gain a distinct `loadError` state (existing red-banner idiom). The console moves its refetch into `finally`.

**Tech Stack:** Svelte 5 runes, `@immich/sdk` (idempotent action endpoints), `@immich/ui` `toastManager`, `handleError`, Vitest + @testing-library/svelte + happy-dom.

## Global Constraints

- Web checks: `cd web && pnpm check:typescript` (authoritative locally) + `pnpm test`. `pnpm check:svelte` can report the "0 FILES" local anomaly and `pnpm lint` aborts on a tscompat crash — **defer both svelte-check and web-lint verdicts to CI** (R6); note them.
- Targeted web test: `cd web && pnpm exec vitest --run <path>`.
- The action endpoints (`confirm/reject/ignore/dismiss`) are documented **idempotent**; `dismiss` = reject alias. A benign "already resolved / no pending row" outcome is the ONLY error case that advances silently — everything else surfaces via `handleError` and does NOT mark the row acted (retry stays possible).
- userId via `authManager.user.id` (`web/src/lib/managers/auth-manager.svelte.ts`), guarded by the `browser` check already in the snooze util.
- Scope: web-only; no server/DTO changes. One commit. No `Co-Authored-By` trailers.

---

## File Structure

- **Modify** `web/src/lib/modals/PersonSuggestionReviewModal.svelte` — refetch-from-page-1 + `actedFaceIds` + close-on-empty-fresh-fetch + `act()` error handling + back-nav read-only.
- **Modify** `web/src/lib/utils/face-suggestion-snooze.ts` — key by `userId:personId`; rebase baseline; read userId internally from `authManager`.
- **Modify** `web/src/routes/admin/face-cleanup/resolutions/+page.svelte`, `.../[personId]/+page.svelte`, `.../+page.svelte` — `loadError` state + red banner on initial-load failure (distinct from empty).
- **Modify** `web/src/routes/admin/face-cleanup/+page.svelte` — `handleApply`: move `fetchLatestScan()` into `finally`.
- **Modify/Create** specs: `PersonSuggestionReviewModal.spec.ts`, `face-suggestion-snooze.spec.ts`, the three page specs (`resolutions/page.spec.ts`, `[personId]/page.spec.ts`, `page.spec.ts`).

---

## Task 1: Red — modal paging + error truthfulness

**Files:** Modify `web/src/lib/modals/PersonSuggestionReviewModal.spec.ts`.

- [ ] **Step 1:** Add (extend the existing `setup(overrides)` + multi-page mock pattern in this file):

```ts
it('shows every face exactly once across a shrinking server list and closes only on an empty fresh fetch', async () => {
  // Model the server draining acted rows: page 1 always returns the NEXT unacted 50 (or fewer), then empty.
  // e.g. loadPage.mockImplementation returns 3 distinct batches of 50/50/20 keyed to a server-side queue that
  // removes a face once confirm/dismiss/ignore is called for it; final page-1 fetch → { total:0, items:[] }.
  // Act through all 120. Assert: each assetFaceId was rendered exactly once (collect current.assetFaceId per step),
  // onClose fires once after the empty fetch, and confirmed count matches the confirms issued.
});
it('surfaces a 500 from an action via handleError, does NOT mark the row acted, and allows retry', async () => {
  // confirm rejects once with a 500-shaped error, then resolves. Assert handleError was called, the SAME face is
  // still current (not advanced), busy cleared, and a second confirm succeeds → advance.
});
it('advances silently on the benign already-resolved error (no handleError toast)', async () => {
  // confirm rejects with the documented already-resolved status → advance, no handleError, face added to acted set.
});
it('marks acted rows read-only on back-navigation (no re-invocation of confirm/dismiss/ignore)', async () => {
  // act on item 1, step back to it, assert its action buttons are disabled / a "reviewed" state shows and
  // pressing confirm again does NOT call confirm.
});
```

Add `vi.mock('$lib/utils/handle-error', () => ({ handleError: vi.fn() }))` and import the mock to assert calls.

- [ ] **Step 2: Run RED** — `cd web && pnpm exec vitest --run src/lib/modals/PersonSuggestionReviewModal.spec.ts`. Expected RED: premature close at ~half (fixed-offset paging), silent 500 (bare catch), back-nav re-invokes. Confirm the file executed.

---

## Task 2: Green — modal refetch-from-0, actedFaceIds, error handling, read-only

**Files:** Modify `web/src/lib/modals/PersonSuggestionReviewModal.svelte`.

- [ ] **Step 1:** Replace the append-paging with head-refetch + skip-set:
  - Add `const actedFaceIds = new SvelteSet<string>();` (or a `$state(new Set())`).
  - `fetchHead()` calls `loadPage({ page: 1, size: PAGE_SIZE })`, sets `total = res.total`, and sets `items` = `res.items.filter((it) => !actedFaceIds.has(it.assetFaceId))`. (Always page 1 — acted rows have drained server-side; the filter drops any not-yet-settled just-acted row.)
  - When the working buffer runs low (`index >= items.length - PREFETCH`), call `fetchHead()` and append only genuinely-new (`!actedFaceIds.has` and not already in `items`) rows.
  - **Close only when a fresh `fetchHead()` yields zero unacted items** (`items` empty after filter) — not on a stale `items.length >= total`.
- [ ] **Step 2: `act()`** — on success: `actedFaceIds.add(face)`, advance. On error: if it's the benign already-resolved case (use `isHttpError(error)` from `@immich/sdk` + the documented status/message — confirm the exact status the server returns for an already-resolved action), `actedFaceIds.add(face)` + advance silently; ELSE `handleError(error, $t('errors.unable_to_...'))`, do NOT add to `actedFaceIds`, do NOT advance, clear `busy` (retry stays possible).
- [ ] **Step 3: back-nav read-only** — a row whose `assetFaceId ∈ actedFaceIds` renders its action controls disabled (and/or a "reviewed" badge); the keyboard/click handlers early-return when `current` is acted.
- [ ] **Step 4:** Run the spec GREEN + `cd web && pnpm check:typescript`.

> Confirm the exact i18n keys used (`errors.unable_to_load_face_suggestions` already exists; add a per-action error key to `i18n/en.json` only if needed — new keys need only `en.json`). Use `SvelteSet` from `svelte/reactivity` if reactivity over the set is needed for the read-only render.

---

## Task 3: Red+Green — snooze user-scoping + rebase

**Files:** Modify `web/src/lib/utils/face-suggestion-snooze.ts`, `face-suggestion-snooze.spec.ts`.

- [ ] **Step 1 (Red):** add tests:

```ts
it('scopes snooze per user — user B is not snoozed by user A on the same browser', () => {
  // set authManager.user.id = 'A', snooze person p1@count5; switch to id 'B'; isSuggestionSnoozed(p1, 5) === false for B.
});
it('resurfaces after reject-elsewhere churn: baseline rebases down, a genuinely-new suggestion re-shows', () => {
  // snooze p1 at total=10; a later banner fetch sees total=6 (4 rejected elsewhere) → rebase baseline to 6;
  // a further fetch sees total=8 → 8 > 6 → NOT snoozed (resurfaces), even though 8 < original 10.
});
```

Mock `authManager` (`vi.mock('$lib/managers/auth-manager.svelte.ts', () => ({ authManager: { authenticated: true, get user() { return { id: currentUserId } } } }))`).

- [ ] **Step 2 (Green):**
  - Key entries by `` `${authManager.user.id}:${personId}` `` (read userId internally, guarded by `browser` + `authManager.authenticated`; if unauthenticated, treat as not-snoozed).
  - Add a rebase in `isSuggestionSnoozed` (or a `rebaseSnooze` called on each banner fetch): when an unexpired entry exists and `total < entry.count`, lower `entry.count = total` (persist). Resurface (return false) when `total > entry.count`. Keep the `until` expiry.
  - Update `person-suggestion-banner.svelte` if it must pass/refresh on each fetch — the `$derived` already re-evaluates `isSuggestionSnoozed(person.id, total)` when `total` changes, so making `isSuggestionSnoozed` perform the rebase-on-read is sufficient; confirm the banner re-derives on `total` prop change.
- [ ] **Step 3:** Run the snooze spec + banner spec GREEN.

---

## Task 4: Red+Green — distinct load-error states on the three pages

**Files:** Modify the three `+page.svelte` + their specs.

- [ ] **Step 1 (Red):** In each page spec, add a test that the INITIAL-load SDK call rejects and the page renders an ERROR state (the red banner text / a retry affordance), NOT the empty-state card. Mock: `vi.mocked(getFaceRepairResolutions).mockRejectedValue(...)` / `getFaceRepairPersonFaces` / (console) `getLatestScan` rejecting on the initial call. Run each spec → RED (today they render the empty card).
- [ ] **Step 2 (Green):** In each page, add a `let loadError = $state(false)` (console: distinguish the INITIAL load from transient poll failures — only set `loadError` when `scan` is still null after the first fetch). In the `catch` of the initial load, set `loadError = true` and call `handleError(error, $t('...'))`. Render the existing red-banner idiom (mirror the `applyError` banner at `+page.svelte:519-528` / `[personId]/+page.svelte:427-436`, with a Retry button re-running the load) when `loadError`, BEFORE the empty-state branch. Keep the empty card only for a genuine zero-result success.
- [ ] **Step 3:** Run the three page specs GREEN + `pnpm check:typescript`.

---

## Task 5: Green — console bulk-apply always refetches

**Files:** Modify `web/src/routes/admin/face-cleanup/+page.svelte`, `page.spec.ts`.

- [ ] **Step 1 (Red):** page spec: `resolvePersonToOwners` rejects for one of several selected persons (partial failure) → assert `fetchLatestScan` (i.e. `getLatestScan`) is STILL called after the apply (the table refreshes) AND `applyError` is shown. Run → RED (today the refetch is skipped on throw).
- [ ] **Step 2 (Green):** move `await fetchLatestScan();` from the end of the `try` into a `finally` block (keep the toast/`applyError` branching in `try`/`catch`).
- [ ] **Step 3:** Run `page.spec.ts` GREEN.

---

## Task 6: Done gate + commit

- [ ] **Step 1:** `cd web && pnpm check:typescript` (clean) + `pnpm test` (run at least the modal, snooze, banner, and three admin page specs — these are the changed surfaces; the modal has wide blast radius). If `pnpm check:svelte` runs cleanly, include it; if it reports "0 FILES", note the anomaly and defer to CI. `pnpm lint` → defer to CI if it aborts.
- [ ] **Step 2: Commit:**

```bash
cd /Users/pierre/dev/gallery/.claude/worktrees/face-unified
git add web/src/lib/modals/PersonSuggestionReviewModal.svelte web/src/lib/utils/face-suggestion-snooze.ts \
        web/src/routes/admin/face-cleanup/+page.svelte \
        web/src/routes/admin/face-cleanup/resolutions/+page.svelte \
        web/src/routes/admin/face-cleanup/'[personId]'/+page.svelte \
        web/src/lib/modals/PersonSuggestionReviewModal.spec.ts web/src/lib/utils/face-suggestion-snooze.spec.ts \
        web/src/routes/admin/face-cleanup/resolutions/page.spec.ts \
        web/src/routes/admin/face-cleanup/'[personId]'/page.spec.ts \
        web/src/routes/admin/face-cleanup/page.spec.ts \
        $(git -C /Users/pierre/dev/gallery/.claude/worktrees/face-unified diff --name-only -- 'i18n/en.json') \
        docs/superpowers/plans/2026-07-23-face-verdict-remediation-slice-8.md
git commit -m "fix(web): suggestion modal paging/error truthfulness; admin pages fail loudly"
```

(Include `i18n/en.json` only if new keys were added; new keys need only `en.json` — never touch de/fr here.)

---

## Edge-case coverage map (spec §Slice 8 → test)

| Behaviour                                                              | Test                |
| ---------------------------------------------------------------------- | ------------------- |
| every face shown once / closes on empty fresh fetch / progress counter | modal Task 1 test 1 |
| 500 surfaces, not marked acted, retry                                  | modal Task 1 test 2 |
| benign already-resolved advances silently                              | modal Task 1 test 3 |
| back-nav read-only                                                     | modal Task 1 test 4 |
| snooze resurfaces after churn                                          | snooze Task 3       |
| two users, one browser, independent snoozes                            | snooze Task 3       |
| failed initial load → error state not empty (×3 pages)                 | page specs Task 4   |
| console bulk-apply partial failure refetches                           | console spec Task 5 |

## Self-review (author)

- **Spec coverage:** D8 (refetch-from-0 + actedFaceIds + close-on-empty + act() error handling) and all four D17 items (snooze user-scope+rebase, back-nav read-only, 3 error states, console finally-refetch) each have a task + red-first test. ✅
- **Placeholder scan:** the modal redesign, snooze rebase, error-state pattern (mirroring the named existing red banner), and the console `finally` move are concrete. The modal test bodies model the shrinking-server-list explicitly. The one "confirm the exact already-resolved status" note is a verification instruction (identify from server), not a placeholder — the benign-vs-surface branch is fully specified otherwise. ⚠️ flag for plan review.
- **Type consistency:** `actedFaceIds`, `loadError`, `isSuggestionSnoozed(personId, total)` (userId read internally) used consistently. ✅
- **Scope:** web-only, no server/DTO changes; svelte-check/web-lint deferred to CI per R6. ✅
