# Face-cleanup scan page — two-lane triage redesign

**Date:** 2026-07-24
**Status:** Approved (design), pending implementation
**Mockup:** https://claude.ai/code/artifact/b624de73-bd82-4717-a371-2f2f0a306a41
**Supersedes the layout of:** `2026-07-13-face-cleanup-scan-checklist-design.md` (the 3-step checklist is removed)

## Problem

The post-scan console (`/admin/face-cleanup/scan`) is overwhelming: a 3-step "What to do now"
checklist, five stat cards, four filter tabs + search, a "90 selected" bar, and a dense seven-column
grouped table. Three specific pain points:

1. Too much on screen — hard to know what to do.
2. Rows aren't clickable; you must aim for the small "Review" button at the far right.
3. Review-first rows show **disabled** checkboxes (you can't tick them), which reads as broken. They're
   disabled because review-first clusters are deliberately excluded from the bulk until you open them.

## Direction (approved): two lanes

Reframe the page around the split the model already makes — confident vs. review-first — because that
split _is_ the mental model. Two stacked lanes replace the checklist + stats + filters + selection bar +
table.

### Header

Title + a one-line summary (`306 flagged faces across 116 people · 222 already re-homed automatically ·
last scan …`). Keep the existing action cluster: **View resolutions**, **Advanced**, **Re-scan**. The
five stat cards are gone; the two non-actionable numbers survive as quiet footnotes below the lanes
(`222 re-homed automatically`, `10 had no clear owner — left untouched`).

### Lane ① — Ready to auto-fix (confident)

- Header: icon tile (green), "Ready to auto-fix", cluster count, one-line safety subtitle.
- Primary action **Approve all N** (the existing per-cluster `resolvePersonToOwners` bulk, run over the
  confident set minus exclusions). A secondary **Review them ▸** expands an inline spot-check grid.
- Spot-check grid: one compact card per confident cluster (thumb, `→ owner`, face %), each with a single
  **✕ to exclude**. Footer shows `M of N will be approved` and the button becomes **Approve M**.
- This one control replaces both the pre-selected checkboxes and the "N selected" bar.

### Lane ② — Needs your review (review-first)

- Header: icon tile (amber), "Needs your review", cluster count, subtitle ("open each to decide — nothing
  here is touched until you do").
- A list of clickable rows. **The whole row navigates to the review page** (`Route.viewFaceCleanupPerson`),
  which already commits inline (`resolveFaces` / dismiss). Each row: cluster thumb + name/unnamed + face
  count, owner chip, flagged % + bar, `→ suspected owner` (thumb + name + count, red for weak/bad target),
  and the "why" tags (over capacity / large cluster / multiple owners / named / bad target).
- A **⋯ menu on hover** offers **Dismiss** (existing `declineFaceRepair` + refetch), so a cluster can be
  dropped without opening it.
- An optional **search** in the lane header filters this list by person/owner name (the old global search,
  scoped here). The four filter tabs are dropped — the two lanes are the split.

### States (unchanged behaviour)

Loading, initial load-error (+ Retry), no-scan-yet, scan pending/running (progress bar), scan failed
(+ Retry), completed-with-nothing-flagged (graceful empty), completed-with-data (the two lanes). Scan
polling with backoff, and the Advanced-scan modal, are untouched.

## Behaviour changes (signed off)

1. **Review-first clusters are decided in their own review page**, not opened-then-ticked-back-into-the-
   bulk here. The review page already commits inline, so this removes the on-list selection gate entirely.
   Trade-off: committing several reviewed clusters is now one commit each, not one batched commit.
2. **The confident bulk defaults to "approve all" with opt-out exclusions**, instead of everything
   pre-checked and opt-out by un-checking. Same result; the model drops per-row select/deselect toggling in
   favour of an exclusion set.

## Components

- **New** `scan/ConfidentLane.svelte` — header + Approve action + expandable spot-check grid (exclude).
- **New** `scan/ReviewFirstLane.svelte` — header + optional search + clickable rows + ⋯ dismiss menu.
  Row internals (thumb, flagged bar, suspected owner, why-tags) port from the current `FaceCleanupTable`.
- **Reworked** `scan/+page.svelte` — drops the checklist/stat-strip/filter-toolbar/selection-bar markup;
  composes the two lanes; keeps every load/scan/apply/dismiss handler and every non-completed state.
- **Reworked** `scan/face-cleanup.svelte.ts` (model) — `confident` / `reviewFirst` lists stay. Selection
  collapses to a confident-only commit set defaulting to _all confident_; the only mutation is
  include/exclude. Remove `opened` / `canSelect` (the review-first gate). Carry exclusions (not selections)
  across refetch/dismiss via `prev`.
- **Deleted** `scan/ScanChecklist.svelte` and `scan/FaceCleanupTable.svelte` (+ their specs).

## Tests (TDD)

- New specs for `ConfidentLane` (approve-all count, exclude toggles the count + commit set, expand/collapse,
  empty confident) and `ReviewFirstLane` (row → correct review href, ⋯ dismiss calls back, search filters,
  weak-target styling).
- Rewrite `scan/page.spec.ts` around the two lanes and the surviving states; delete the checklist/table/
  filter/selection assertions.
- Rewrite the model spec (`face-cleanup.spec.ts`) for the exclusion semantics; drop the `opened`/`canSelect`
  cases.
- Full `admin/face-cleanup` suite must stay green; eslint `--max-warnings 0`, prettier, `check:svelte` clean.

## i18n

Add lane keys (titles, subtitles, "Approve all", "Approve N", "Review them", spot-check footer, "Needs your
review", dismiss). Remove the now-dead checklist-step, filter-label, and selection-bar keys from `en.json`
(grep both `web` and `mobile` first — shared dir). Keep review-reason keys (still used by the rows) and
`face_cleanup_review_load_more` (still used by the review page).

## Out of scope

The per-cluster review page (`scan/[personId]`), the manual flow (`people/*`), the chooser, scan internals,
and all server/RBAC/commit logic. This is a scan-page presentation + selection-model change only.
