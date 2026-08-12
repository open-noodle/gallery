# Slice 8 — Manual review page: shell, grid, paging

Spec: §6.4. Branch: `feat/face-manual-review`. Depends on slice 3 (metadata endpoint), slice 6
(navigated in from), slice 7 (the model).

## Route

`web/src/routes/admin/face-cleanup/people/[personId]/+page.svelte` (+ `+page.ts`)

## Data

- person name / `ownerId` / `faceCount` from slice 3's `GET admin/face-repair/person/:personId`.
  **Fetch from the URL param, not navigation state**, so refresh and deep-links work.
- faces from `getFaceRepairClusterFaces({ personId, excludeFaceIds: [], page, size })` — scan-free.
  Confirm the generated SDK function name; the guided page calls the same endpoint.

## Step 1 — RED: `people/[personId]/page.spec.ts`

1. **loads all cluster faces with no scan in existence** — the core capability; assert tiles render
   from `getFaceRepairClusterFaces` with `excludeFaceIds: []`.
2. **header** shows the person name, owner, and `showing N of M`.
3. **unnamed person** renders the fallback heading (do not render an empty title).
4. **hard refresh / deep link** resolves name + owner purely from the URL param (assert the metadata
   call is made with the route param, with no reliance on navigation state).
5. **`keep` tiles are clean** — no state badge, no ribbon. This is §6.4's visual inversion and must be
   asserted, not assumed: a tile in the default state must not carry `[data-state-icon]` or a ribbon.
6. **marked tiles carry badge + ribbon** using the shared `STATE_COLOR`/`STATE_ICON`.
7. **selection**: click selects; shift-click selects a range; clear works.
8. **`Select all loaded (N)`** selects exactly the loaded faces and its label reports the **loaded**
   count, never `total`. Assert the label text contains the loaded count when `total` is larger — this
   is the honesty requirement from §6.4.
9. **Load more appends and PRESERVES staged marks and selection** — mark faces, load the next page,
   assert both the marks and the selection survive. This is the regression guard for the guided
   page's `$derived` defect; it is the most important test in this slice.
10. **zero-face person** renders the dashed empty treatment.
11. **load error** renders an error + Retry — **distinct** from the empty state (defect D17 on the
    guided page conflated them; do not repeat it).
12. **a person the scan flagged shows NO flagged badging** — manual ignores scan state entirely
    (§7). Seed a completed scan flagging this person and assert no flagged affordance appears.

Run: `cd web && pnpm exec vitest --run "src/routes/admin/face-cleanup/people/**"`

## Step 2 — GREEN

Compose `createManualReviewModel` (slice 7) with the tile markup copied from the guided page
(`[personId]/+page.svelte:491-531`) minus the unconditional badge/ribbon: render those **only when
`state !== 'keep'`**. Keep `detach`'s `grayscale(1) opacity(0.55)` crop treatment and the
selection ring/overlay exactly as guided has them.

Reuse the guided `faceThumbnailUrl` helper (admin face-thumbnail route) — it is join-free and
tombstone-inclusive, which the user-scoped person thumbnail routes are not.

Paging calls `appendFaces(faces, total)`; never reassign the model.

## Step 3 — Verify

`cd web && pnpm exec vitest --run src/routes/admin/face-cleanup/` · `pnpm check:typescript` ·
`pnpm check:svelte` · `pnpm lint`

## Commit

`feat(web): add the manual face-review page with server-paged cluster faces`

## Out of scope

Bulk actions and Apply (slice 9); entire-cluster move and help modal (slice 10). The page may render
the dock shell but its actions land in slice 9.
