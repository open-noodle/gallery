# Slice 6 — Manual people browser at `/admin/face-cleanup/people`

Spec: §6.3. Branch: `feat/face-manual-review`. Depends on slice 5 (`Route.faceCleanupPeople()`).

## Goal

Admin picks an owner, browses/searches that owner's people, clicks one to review. **Zero new server
endpoints** — everything here already exists.

## Endpoints used (all existing)

- `searchUsersAdmin({ withDeleted: true })` — owner list (same call the dashboard already makes)
- `getFaceRepairOwnerPeople({ ownerId, page, query })` → `{ people: [{id,name,faceCount,thumbnailFaceId}], total, hasMore }`
  — `query` is **optional**, so omitting it lists all of an owner's people
- face crops via the admin face-thumbnail route (same helper the guided review page uses —
  `faceThumbnailUrl`; reuse it, do not hand-roll a URL)

## Step 1 — RED: `web/src/routes/admin/face-cleanup/people/page.spec.ts`

1. **owner selector lists users** from the load data.
2. **single-user instance auto-selects** that owner and immediately lists their people (no empty
   "pick an owner" state on a one-user install — that would be pure friction).
3. **multi-user shows the selector** and lists the first/selected owner's people.
4. **grid renders** name, `faceCount`, and a thumbnail for each row.
5. **unnamed person** renders the fallback label rather than an empty cell.
6. **null `thumbnailFaceId`** renders a placeholder, not a broken image.
7. **search** re-fetches with `query` and renders the filtered rows.
8. **no results** for a query renders an explicit empty state (distinct from "this owner has no
   people").
9. **pagination** — `hasMore: true` shows a Load more control; clicking it fetches the next page and
   **appends** (does not replace).
10. **click a person** navigates to `/admin/face-cleanup/people/{id}`.
11. **load error** renders an error + Retry, distinct from the empty state.
12. **hidden / non-`person`-type rows**: assert the grid renders exactly what
    `getFaceRepairOwnerPeople` returns — this slice does **not** add client-side filtering. Pin the
    passthrough so a later server-side change is visible here rather than silently masked.

Run: `cd web && pnpm exec vitest --run src/routes/admin/face-cleanup/people/page.spec.ts`

## Step 2 — GREEN

- `people/+page.ts`: `authenticate(url, { admin: true })` + `searchUsersAdmin({ withDeleted: true })`.
  Do **not** fetch people in `load` — owner selection drives that client-side.
- `people/+page.svelte`: owner `<select>` (auto-select when `users.length === 1`), search input
  (debounced), responsive grid of person tiles, Load more, empty/no-results/error states.
- Reuse the dashboard's card/tile vocabulary and the dashed empty treatment.

Fetch state must be **per-owner**: switching owner resets page to 0 and clears the list, otherwise
rows from two owners interleave.

## Step 3 — Verify

`cd web && pnpm exec vitest --run src/routes/admin/face-cleanup/` · `pnpm check:typescript` ·
`pnpm check:svelte` · `pnpm lint`

## Commit

`feat(web): add the manual face-cleanup people browser`

## Out of scope

The manual review page itself (slices 7-10). No server changes.
