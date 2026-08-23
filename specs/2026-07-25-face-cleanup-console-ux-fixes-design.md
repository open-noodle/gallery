# Face cleanup console UX fixes: clickable auto-fix chips + review-lane table alignment

**Date:** 2026-07-25
**Branch:** `feat/face-manual-review` (PR #838)
**Scope:** web only — no server, API, or migration changes.

## Problem

Feedback on the current PR #838 console UI (scan page, `/admin/face-cleanup/scan`):

1. **The "Ready to auto-fix" spot-check chips are dead ends.** Expanding the lane shows one chip per
   cluster, but the chip itself is not clickable — the only action is the exclude-X. There is no way to
   see what the auto-fix would actually do to a cluster before approving; the admin can only remove it
   from the batch blind.
2. **The "Needs your review" list misaligns and its columns are unlabeled.** The reason-pill block is
   the only variable-width column and sits between the fixed columns and the row edge, so a row with
   "large cluster +1" pushes the % and destination columns out of line with neighbouring rows. And with
   no column headings, the % value ("57%") has no visible meaning.

## Fix 1 — ConfidentLane chips open the per-cluster review page

Each expanded chip becomes a whole-chip link to `Route.viewFaceCleanupPerson({ id })` — the same
per-cluster review page the review-lane rows and manual review mode use, where the admin can inspect
every flagged face, change destinations, keep faces, or commit. Structure mirrors the anchor pattern
`ReviewFirstLane` already documents (a `<button>` cannot nest inside an `<a>`):

- The chip container turns `relative`; the thumbnail + text wrap in an `<a>` with a hover tint and
  `data-testid="confident-open-{personId}"`. The content keeps right padding to reserve the X slot.
- The exclude-X becomes an absolutely positioned sibling over that slot — **always visible**, same
  `toggleExcluded` behavior, same testid.
- Excluded (dimmed) chips stay clickable: a cluster pulled out of the batch can still be inspected.
- Returning from the review page remounts the scan page, which refetches the latest scan, so a cluster
  resolved on the detail page drops out of the lane by itself — no extra handling needed for that case.
  Spot-check exclusions, however, live in the client-only triage view-model, which the remount rebuilds
  from scratch; without help, that would silently re-include every cluster the admin had excluded before
  clicking through. To survive the round-trip, excluded ids are persisted to `sessionStorage` keyed by scan
  id (`face-cleanup-scan-exclusions:{scanId}`) and reseeded into the rebuilt model on a fresh mount — keyed
  by scan id so a new scan starts clean rather than inheriting a stale exclusion set (final-review finding).

## Fix 2 — ReviewFirstLane fixed columns + header row

- The reasons block gets a fixed width (`w-28`, matching the % column). Pill text truncates inside it,
  the "+N" overflow indicator stays, and the block carries a native `title` tooltip listing **all**
  translated reasons (e.g. "large cluster · named"). Content can no longer shift the % / destination
  columns — the hard requirement is that nothing rendered in this column moves the others.
- The column width + responsive-visibility class strings are extracted to module constants
  (`COL_FLAGGED`, `COL_DEST`, `COL_REASONS`, plus the shared row padding) used by both the rows and the
  new header row, so header and rows cannot drift apart.
- A header row renders between the lane header and the list, matching row padding (`pl-5 pr-12`),
  hidden below `sm` (where only the identity column renders anyway): small uppercase gray labels —
  **Cluster** (flex-1) · **Flagged** (`w-28`) · **Move to** (`w-36`) · **Why flagged** (`w-28`).
- Four new i18n keys, `en.json` only: `admin.face_cleanup_col_cluster`, `admin.face_cleanup_col_flagged`,
  `admin.face_cleanup_col_destination`, `admin.face_cleanup_col_reasons`.

## Testing

Extend the existing component specs:

- `ConfidentLane.spec.ts`: chip renders an anchor with the review-page href; exclude-X still toggles
  exclusion without navigating; an excluded chip keeps its link.
- `ReviewFirstLane.spec.ts`: header row renders all four headings; a multi-reason row shows one pill
  plus "+N" and its `title` contains every reason label.

Gate: `check:typescript`, `check:svelte`, `pnpm lint`, web vitest, prettier.

## Out of scope

The truncated search placeholder in the review-lane header, chip-level tooltips in the confident lane,
and any server-side changes.
