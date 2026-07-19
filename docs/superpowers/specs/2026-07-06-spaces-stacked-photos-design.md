# Support of stacked photos in Spaces — Design

- **Discussion:** [open-noodle/gallery #751 — "Support of stacked photos in Spaces"](https://github.com/open-noodle/gallery/discussions/751)
- **Date:** 2026-07-06
- **Base branch:** `space-albums-onto-main` (HEAD `92ed82afb6`)
- **Status:** Approved design, ready for implementation plan

## Problem

When a photo **stack** (RAW+JPEG, burst) is added to a shared **Space**, only the stack's
primary (cover) frame becomes a member. Worse, if the user later promotes a different frame
to primary, the stack disappears from the Space entirely — neither the old nor the new
primary is shown.

### Root cause

Two facts in the code are **independent of each other**, and their mismatch is the bug:

1. **Direct Space membership is per-asset-id.** `SharedSpaceService.addAssets`
   (`server/src/services/shared-space.service.ts:571`) inserts exactly the asset ids passed
   into `shared_space_asset` — no stack expansion
   (`SharedSpaceRepository.addAssets`, `server/src/repositories/shared-space.repository.ts:322`).
   Because the timeline UI collapses stacks, a user adding a stack only ever sends the **cover
   id**, so only the cover becomes a member.

2. **The Space timeline collapses stacks by the _global_ primary**, not by what's in the Space.
   The Space timeline query filters to `visibility = Timeline` and drops any asset where
   `stack.primaryAssetId != asset.id` (`server/src/repositories/asset.repository.ts:1389`, and
   the count builder at `:325`). This is keyed on **global** stack membership and is a separate,
   ANDed `.$if(...)` clause — completely independent of the Space-membership filter.

Promoting a new primary only writes `stack.primaryAssetId` (`stack.service.ts` →
`stack.repository.ts`); it touches **no** `shared_space_asset` rows. So:

| Step                      | Old primary                                                           | New primary                                                              |
| ------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Stack added to Space      | ✅ member, ✅ is global primary → **shows**                           | ❌ not a member                                                          |
| User promotes new primary | ✅ still member, but now ❌ non-primary → **dropped by stack filter** | ✅ now global primary, but ❌ not a member → **dropped by Space filter** |

→ neither shows. This reproduces the discussion word-for-word.

### Membership model on this base (`space-albums-onto-main`)

An asset is visible in a Space via a **3-way union**, centralized in
`server/src/utils/shared-space-album-scope.ts` → `spaceAssetPathBranches(eb, …)`:

1. **Direct** — `shared_space_asset` (asset id). _This is the path #751 is about._
2. **Library** — `shared_space_library` (by `asset.libraryId`).
3. **Album (new)** — `shared_space_album` (`spaceId`, `albumId`, `showInTimeline`) → assets
   by-reference via `album_asset`. No copy into `shared_space_asset`.

Critically, the direct path is **structurally identical to `main`** (still per-asset-id, still
zero stack awareness), and the Space filter and the `withStacked` stack-collapse filter are
still separate, ANDed `.$if` calls. The core bug and its fix are therefore unchanged by the
albums work; only line numbers moved.

## Goals

- Adding a stack to a Space (via the direct add-to-space action) puts **all of the stack's
  frames** into the Space, so it collapses to its cover exactly like the main timeline: correct
  stack-count badge, tap-in shows every frame, and promoting any frame to primary "just works"
  because every frame is already a member.
- Removing a stack from a Space removes **all** of its frames.
- The Space timeline renders the stack **collapsed to its cover** on every surface — server,
  web, and mobile.

## Non-goals (explicitly out of scope)

- **Album-path stack completeness.** If a user _links an album_ that itself contains only a
  stack's cover (because adding a stack to an album adds only the cover — longstanding upstream
  album behavior), the Space shows a partial stack via the album path. Fixing that means
  changing upstream album-stacking semantics, far outside #751. We fix the **direct
  add-to-space path** only. (The _display_ collapse fix still benefits album-linked stacks for
  free, since the timeline unions all paths before collapsing.)
- **Space-album _detail_ view collapse.** The per-album detail view inside a Space intentionally
  does **not** collapse stacks — it mirrors normal album behavior (web `album-filter-options.ts`
  never sets `withStacked`; the space-album detail page shows every frame). We keep it that way
  on all platforms.
- **Reconciling membership when a stack's composition changes _after_ it's in a Space**
  (re-stacking, adding a frame to an in-Space stack). MVP scope — see Accepted Limitations.
- **Backfilling existing partial stacks** already in Spaces. MVP scope — see Accepted Limitations.

## Design decisions (locked)

| Decision                | Choice                                                                             |
| ----------------------- | ---------------------------------------------------------------------------------- |
| Target behavior         | Whole stack lives in the Space (the discussion's "Better" ask; subsumes "Minimum") |
| Where expansion happens | **Server-side only** — single source of truth for web, mobile, and CLI             |
| Sync depth              | Expand on **add and remove only** (MVP)                                            |
| Platforms               | Server + web + mobile                                                              |
| Legacy data             | **No backfill migration**                                                          |
| Remove semantics        | Removing any frame of a stack removes the **whole stack** from the Space           |

## Development approach — TDD (mandatory)

Every slice is implemented **test-first**, red → green → refactor:

1. **Red** — write the unit / medium / widget test(s) for the slice's behavior and edge cases
   first, and run them to confirm they **fail for the right reason** (asserting the missing
   behavior, not a compile error or a missing fixture).
2. **Green** — write the minimum implementation to make those tests pass.
3. **Refactor** — clean up with tests green.

No implementation code is written before a failing test exists for it. A slice is "done" only
when its **full verification gate** (listed per slice) passes when _you_ run it — a subagent
reporting "green" is not sufficient; run the real gate (server `tsc` + unit + the slice's medium
spec; mobile `flutter test`; web `check` + unit) yourself. Notes that bite in this repo:

- New `@GenerateSql`-decorated repository methods require `make sql` **with a running DB** to
  refresh query docs, or CI's SQL-docs check fails. **Never** run `make sql` without a DB — it
  deletes all query files.
- We add **methods to existing repositories** (no new injected repository), so there is **no**
  `BaseService` constructor / `BaseService.create()` positional-list / medium-factory
  `newRealRepository` change to make. If a medium test throws "Unable to create repository
  instance," that is a signal something was mis-wired — not expected here.
- Mobile tests run on the pinned **Flutter 3.44.1** (`mobile/pubspec.yaml`); bootstrap once with
  `flutter pub get`, generate localization + keys
  (`dart run easy_localization:generate -S ../i18n && dart run bin/generate_keys.dart`), then
  `flutter test <path>`. Drift generated code is committed, so no `build_runner` is needed.

## Detailed design

### 1. Server — stack-closure expansion (the load-bearing change)

Introduce a small, isolated, testable unit that expands a set of asset ids to include their
stack siblings, and wire it into the direct add/remove paths. No schema change.

**Add-time expansion (`SharedSpaceService.addAssets`, `shared-space.service.ts:571`)**

- After the existing role/permission checks, expand `dto.assetIds` to the stack closure via a
  new repository query, producing `expandedAssetIds`.
- **RBAC filter on the auto-pulled siblings:** only expand to siblings that are
  **`ownerId = auth.user.id`**, **`visibility IN visibleSpaceAssetVisibilities`**, and
  **`deletedAt IS NULL`**. `visibleSpaceAssetVisibilities` is the existing repo constant
  `[AssetVisibility.Archive, AssetVisibility.Timeline]` (`shared-space.repository.ts:42`) already
  used by `bulkAddUserAssets` and `getAssetCount` as the canonical "space-eligible" set —
  reusing it keeps stack expansion consistent with existing direct membership (archived frames
  are legitimately space-eligible; the view-time `visibility = Timeline` scope hides them from
  the aggregated Space timeline). The set **excludes Hidden and Locked** — the RBAC-sensitive
  tiers we must never pull into a shared Space (aligned with the in-flight #753/#754 hardening).
  The owner restriction guarantees the adder already has `AssetRead` on every expanded id (stacks
  are single-owner), so no additional permission check is needed and there is no throw risk.
  Explicitly-selected seed ids are always retained even if they are not space-eligible — only the
  _auto-pulled siblings_ are filtered.
- Use `expandedAssetIds` for **both** the `shared_space_asset` insert **and** the
  `SharedSpaceFaceMatch` job fan-out (`:590`), so faces are matched on all added frames. The
  activity-log `count` continues to reflect `inserted.length` (newly-inserted rows only).

**Remove-time expansion (`SharedSpaceService.removeAssets`, `shared-space.service.ts:761`)**

- Expand `dto.assetIds` to the sibling frames of the same stack(s) that are **direct members of
  this Space**, producing `expandedAssetIds`. (Space-scoped rather than owner-scoped: any editor
  curating the Space should be able to remove the whole stack; the existing delete is already
  `spaceId`-scoped so passing extra non-member ids is a harmless no-op.)
- Use `expandedAssetIds` for the delete (`:768`), the thumbnail-reset check (`:775`), and the
  face-orphan computation `getAssetIdsWithoutOtherSpacePath` (`:788`). Because the three
  membership paths are independent, a frame still visible via a linked album correctly **stays**
  visible after its direct row is removed — `getAssetIdsWithoutOtherSpacePath` already accounts
  for this.

**Repository queries** — both live in `server/src/repositories/shared-space.repository.ts` next
to their only callers (`addAssets` / `removeAssets`), each `@GenerateSql`-decorated:

- Add path: `getOwnedStackSiblingIds(userId, assetIds) → assetId[]` — sibling ids
  sharing a non-null `stackId` with any seed, filtered to `ownerId = userId`,
  `visibility IN visibleSpaceAssetVisibilities`, `deletedAt IS NULL`. The service unions the
  result with the original seed ids.
- Remove path: `getStackSiblingIdsInSpace(spaceId, assetIds) → assetId[]` — sibling ids sharing a
  stack with any seed that are current direct members (`shared_space_asset`) of `spaceId`.

**No change needed** to `queueBulkAdd` / `bulkAddUserAssets` (`:598` / repo `:303`): it already
inserts _all_ of a user's timeline-visible assets, so stacks are naturally whole there.

### 2. Web — no code change expected (verify only)

The Space timeline already sends `withStacked: true`
(`web/src/lib/utils/space-filter-options.ts:6`) and collapses on the server query. Once all
frames are members, the cover shows, the badge count becomes **correct** (it was over-counting
before), and tap-to-expand shows every frame. The direct add-to-space action
(`web/src/lib/services/space.service.ts` → `addAssets`) passes the selected cover ids; the
server expands. **Verify** there is no client-side spot that assumed only-the-cover-is-a-member;
none is expected. The space-album _detail_ view stays uncollapsed by design (see Non-goals).

### 3. Mobile — collapse the aggregated-Space timeline (two Drift builders)

The mobile Space timeline is a local Drift query that omits stack-collapse
(`mobile/lib/infrastructure/repositories/timeline.repository.dart`). After the server fix, all
frames sync into local `shared_space_asset`, so without this change mobile would show N flat
tiles.

Add the same collapse the main timeline uses (`mobile/lib/infrastructure/entities/merged_asset.drift`
`stack_id IS NULL OR remote_asset.id = primary_asset_id`) — `LEFT JOIN stack_entity ON stack_id = id`
plus that predicate — to **both** the aggregated-Space asset query and its count query:

| Mobile method                                                       | Collapse?              |
| ------------------------------------------------------------------- | ---------------------- |
| `_watchSharedSpaceBucket` (`:452`) — aggregated Space bucket counts | **Yes — add collapse** |
| `_getSharedSpaceBucketAssets` (`:570`) — aggregated Space assets    | **Yes — add collapse** |
| `_watchSpaceAlbumBucket` (`:638`) — space-album detail counts       | No — leave as-is       |
| `_getSpaceAlbumBucketAssets` (`:698`) — space-album detail assets   | No — leave as-is       |

This keeps parity with web (aggregated Space collapses via `withStacked: true`; album-detail
does not) and with normal album behavior. Tap-to-expand (`asset_stack.provider.dart`) already
fetches stack children by `stackId` globally, so it works unchanged once frames are members.
**Verify** the `shared_space_asset` sync stream propagates the newly-inserted member rows to the
device.

## After-fix behavior walkthrough

With every frame a direct member:

| Step                  | Behavior                                                                                                     |
| --------------------- | ------------------------------------------------------------------------------------------------------------ |
| Add stack to Space    | All frames inserted; timeline collapses to global primary (a member) → **cover shows**, badge count accurate |
| Promote a new primary | New primary already a member → **shows instantly**; old primary collapsed under it                           |
| Tap the cover         | All frames shown — all are members                                                                           |
| Remove the stack      | All frames removed (unless still visible via a linked album)                                                 |

## Accepted limitations (MVP — documented, not silently dropped)

- **Composition drift after add.** If a stack's members change _after_ it's in a Space
  (re-stacking, adding a frame to an in-Space stack), the Space is not auto-reconciled.
  Workaround: re-add the stack.
- **Legacy partial stacks.** Stacks added to Spaces _before_ this change keep only their cover
  as a member until re-added. No backfill migration ships.
- **Album-linked partial stacks** are not completed (see Non-goals).
- **Mobile collapse is best-effort for non-owned stacks.** The mobile stack-collapse reads the
  local `stack_entity` table, which only syncs for the viewer's own and partners' stacks — there
  is no shared-space stack sync. So when a viewer opens a Space containing **another member's**
  stack, the client can't know which frame is the cover and shows the stack's frames **flat**
  (all of them) rather than collapsed. This is strictly better than pre-feature behavior (the
  frames are all present via S1's membership fix) and never hides them; full mobile collapse for
  non-owned stacks would require a new shared-space stack sync stream (out of scope). Owned
  stacks collapse normally. The collapse predicate therefore keeps any asset whose `stack_entity`
  row is absent locally.

These limitations follow from the locked decisions (add/remove-only sync depth; no backfill) and
the mobile owner-scoped sync model.

## Follow-ups (out of scope for this change)

- **Main-timeline sibling of the mobile collapse guard.** The viewer's **main** timeline
  (`mobile/lib/infrastructure/entities/merged_asset.drift`) also merges in a Space's assets when
  the viewer enables space-timeline integration, and applies the same
  `stack_id IS NULL OR rae.id = se.primary_asset_id` collapse **without** the `se.id IS NULL`
  fallback this change added to the aggregated-Space builders. So a non-owned Space stack can
  still vanish from the _main_ timeline for a viewer who integrated the Space. This is
  **pre-existing** (that file is untouched here; on the base branch only the cover was a member
  and it was already filtered the same way) and out of scope for #751, but the same one-line
  `se.id IS NULL` guard (plus a regression test of the same shape) should be applied there as a
  follow-up so the "no non-owned stack vanishes on mobile" guarantee is uniform.

## Edge-case coverage matrix

Every row below has a dedicated test in the slice noted. This is the definition of "full
coverage" for this feature.

| #   | Case                                                                                   | Expected behavior                                                                                                                                                                                                                                                                                                                                                 | Slice       |
| --- | -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| E1  | Add a stack **cover** owned by the adder                                               | All timeline-visible siblings of the stack become direct members                                                                                                                                                                                                                                                                                                  | S1          |
| E2  | Add a **non-primary** frame owned by the adder                                         | All siblings **incl. the primary** become members                                                                                                                                                                                                                                                                                                                 | S1          |
| E3  | Add an asset **with no stack**                                                         | Only that asset is added (expansion is a no-op)                                                                                                                                                                                                                                                                                                                   | S1          |
| E4  | Add an asset **not owned** by the adder (shared to them)                               | No expansion — only that asset is added (owner-scoped guard)                                                                                                                                                                                                                                                                                                      | S1          |
| E5  | A sibling is **Hidden or Locked**                                                      | Excluded from expansion — never pulled into a shared Space                                                                                                                                                                                                                                                                                                        | S1          |
| E5b | A sibling is **Archived**                                                              | **Included** — archived is space-eligible (`visibleSpaceAssetVisibilities`); it is a member but stays hidden from the Timeline-scoped Space view                                                                                                                                                                                                                  | S1          |
| E6  | A sibling is **soft-deleted** (`deletedAt` set / trashed)                              | Excluded from expansion                                                                                                                                                                                                                                                                                                                                           | S1          |
| E7  | The **seed itself** is non-timeline-visible but explicitly selected                    | Retained (only auto-pulled siblings are filtered)                                                                                                                                                                                                                                                                                                                 | S1          |
| E8  | **Two seeds from the same stack** in one request                                       | Expansion dedupes → each frame inserted once                                                                                                                                                                                                                                                                                                                      | S1          |
| E9  | **Mixed batch** (some stacked, some standalone)                                        | Correct union: standalone kept as-is, stacks expanded                                                                                                                                                                                                                                                                                                             | S1          |
| E10 | **Re-add** a stack already partly in the Space                                         | `onConflict doNothing`; idempotent; `inserted.length` counts only new rows                                                                                                                                                                                                                                                                                        | S1          |
| E11 | Empty `assetIds`                                                                       | No-op; no sibling query issued                                                                                                                                                                                                                                                                                                                                    | S1          |
| E12 | `faceRecognitionEnabled` on the Space                                                  | `SharedSpaceFaceMatch` queued for **every** expanded frame; disabled → none                                                                                                                                                                                                                                                                                       | S1          |
| E13 | Add cover, then **promote a different frame to primary**                               | Space timeline still shows the stack (new primary already a member)                                                                                                                                                                                                                                                                                               | S1 (medium) |
| E14 | Remove the **cover**                                                                   | All direct-member frames of the stack are removed                                                                                                                                                                                                                                                                                                                 | S2          |
| E15 | Remove a **non-cover** frame                                                           | The whole stack's direct members are removed                                                                                                                                                                                                                                                                                                                      | S2          |
| E16 | A removed frame is **also a member via a linked album**                                | Its direct row is deleted, but it **remains a space member** via the album path, so `getAssetIdsWithoutOtherSpacePath` does **not** flag it as a face-orphan (its faces are preserved). NB: whether it still renders in the aggregated timeline is subject to the album-partial-stack non-goal — E16 asserts the face-orphan correctness, not timeline visibility | S2          |
| E17 | The Space **thumbnail** was an expanded (not directly-passed) frame                    | Thumbnail reset to `null`                                                                                                                                                                                                                                                                                                                                         | S2          |
| E18 | Passed siblings that are **not members** of the Space                                  | Delete is a harmless no-op                                                                                                                                                                                                                                                                                                                                        | S2          |
| E19 | Face-orphan cleanup after remove                                                       | Runs over the **expanded** set; persons/faces removed only when no other Space path remains                                                                                                                                                                                                                                                                       | S2          |
| E20 | Mobile: Space with a 3-frame stack (all members)                                       | **One** collapsed cover tile; bucket count == 1                                                                                                                                                                                                                                                                                                                   | S3          |
| E21 | Mobile: **space-album detail** view                                                    | Unchanged — shows all 3 frames (parity with albums)                                                                                                                                                                                                                                                                                                               | S3          |
| E22 | Mobile: **legacy partial stack** (only non-primary frames are members, primary absent) | Collapse yields **0** tiles — consistent with server/web timeline; documented limitation                                                                                                                                                                                                                                                                          | S3          |
| E23 | Mobile: bucket-count query and asset query agree after collapse                        | Same collapsed cardinality                                                                                                                                                                                                                                                                                                                                        | S3          |
| E24 | Web: Space view after all frames are members                                           | Renders the collapsed cover with the **correct** count                                                                                                                                                                                                                                                                                                            | S4          |
| E25 | Web: space-album detail view                                                           | Still uncollapsed (asserts `withStacked` is **not** sent — guards the non-goal)                                                                                                                                                                                                                                                                                   | S4          |

**Known consistent edge (not a bug, not fixed):** a stack whose **primary is non-timeline**
(e.g. archived) vanishes from the Space timeline entirely (non-primaries collapsed out, primary
filtered by visibility) — this is identical to how the **main** timeline already behaves. No
special handling.

## Implementation slices (for `/impl-loop`)

Four vertical slices, each independently implementable, test-first, and shippable. Order:
S1 → S2 → S3 → S4 (S3/S4 are independently testable via fixtures but describe behavior that S1
produces in production).

### Slice S1 — Server: adding a stack adds the whole stack

- **Goal:** adding any frame of a stack via add-to-space brings in all the adder's
  timeline-visible frames of that stack.
- **Code:**
  - `server/src/repositories/shared-space.repository.ts` — add `getOwnedStackSiblingIds(userId, assetIds)` (`@GenerateSql`).
  - `server/src/services/shared-space.service.ts` — in `addAssets` (`:571`), expand `dto.assetIds`
    → `expandedAssetIds` (union of seeds + owned/space-eligible/non-deleted siblings); feed it to
    the `shared_space_asset` insert **and** the `SharedSpaceFaceMatch` fan-out (`:590`). Add a
    default `mocks.sharedSpace.getOwnedStackSiblingIds.mockResolvedValue([])` to the service
    spec's `beforeEach` so existing `addAssets` tests keep passing.
- **Tests (write first):**
  - Unit — `server/src/services/shared-space.service.spec.ts`: `addAssets` expands and inserts the
    expanded set; face-match jobs cover the expanded set; empty input short-circuits. Covers
    E4, E11, E12 (behavioral), E13 wiring.
  - Medium — new `server/test/medium/specs/repositories/shared-space-stack-expansion.medium.spec.ts`:
    the `getOwnedStackSiblingIds` filters (owner E4, Hidden/Locked E5, Archived-included E5b,
    deleted E6, seed retention E7, dedupe E8, mixed E9, no-stack E3, cover E1, non-primary E2,
    empty E11). Composition E2E: seed a stack, expand + `addAssets` via the repo, then
    `ctx.get(AssetRepository).getTimeBuckets({ spaceId, visibility: Timeline, withStacked: true })`
    returns one collapsed cover; re-add idempotency (E10); promote-a-different-primary via
    `StackRepository.update` keeps the stack visible (E13).
- **Verification gate:** `cd server && pnpm check` (tsc) · `pnpm test -- --run src/services/shared-space.service.spec.ts` · `pnpm test:medium` for the two specs · `make sql` (running DB) to refresh docs for the new `@GenerateSql` method.
- **Acceptance:** E1–E13 green; adding a stack cover in a real Space makes every frame a member and the Space timeline shows one cover with the correct badge count.

### Slice S2 — Server: removing a stack removes the whole stack

- **Goal:** removing any frame removes all of that stack's direct members from the Space, with
  correct face-orphan and thumbnail handling, while album-visible frames survive.
- **Code:**
  - `server/src/repositories/shared-space.repository.ts` — add `getStackSiblingIdsInSpace(spaceId, assetIds)` (`@GenerateSql`).
  - `server/src/services/shared-space.service.ts` — in `removeAssets` (`:761`), expand
    `dto.assetIds` → `expandedAssetIds`; feed it to the delete (`:768`), the thumbnail-reset
    check (`:775`), and `getAssetIdsWithoutOtherSpacePath` (`:788`).
- **Tests (write first):**
  - Unit — `shared-space.service.spec.ts`: `removeAssets` expands and feeds delete + thumbnail +
    orphan computation the expanded set.
  - Medium — `shared-space-stack-expansion.medium.spec.ts`: `getStackSiblingIdsInSpace` returns
    only same-stack **direct members** of the given Space (E18). Composition E2E: remove cover →
    all gone (E14); remove non-cover → all gone (E15); frame kept alive by a linked album stays
    visible & is not a face-orphan (E16, E19); thumbnail reset when an expanded frame was the
    thumbnail (E17).
- **Verification gate:** same shape as S1 (tsc · unit · the two medium specs · `make sql`).
- **Acceptance:** E14–E19 green; removing one frame of an in-Space stack clears the whole stack,
  except frames still reachable via a linked album.

### Slice S3 — Mobile: collapse the aggregated-Space timeline

- **Goal:** the mobile Space timeline renders a stack as one cover-with-badge; the space-album
  detail view stays uncollapsed.
- **Code:** `mobile/lib/infrastructure/repositories/timeline.repository.dart` — add
  `LEFT JOIN stack_entity ON stack_id = id` + `(stack_id IS NULL OR remote_asset.id = primary_asset_id)`
  to `_watchSharedSpaceBucket` (`:452`) and `_getSharedSpaceBucketAssets` (`:570`). **Do not**
  touch `_watchSpaceAlbumBucket` / `_getSpaceAlbumBucketAssets`.
- **Tests (write first):** `mobile/test/infrastructure/repositories/timeline_repository_test.dart`
  (and/or `mobile/test/medium/repositories/timeline_repository_test.dart`) — seed a Space with a
  3-frame stack: aggregated-Space query returns one cover and count == 1 (E20, E23); space-album
  detail query still returns all 3 (E21); a Space with only non-primary frames returns 0 (E22);
  non-stacked assets unaffected.
- **Verification gate:** Flutter 3.44.1 bootstrap (pub get + gen l10n/keys), then
  `flutter test test/infrastructure/repositories/timeline_repository_test.dart`.
- **Acceptance:** E20–E23 green.

### Slice S4 — Web guard test + user docs

- **Goal:** lock in web's correct behavior (no production code change expected) and document the
  MVP workarounds.
- **Code:** none expected in web app code. Docs: add a short note to the Spaces user doc
  (`docs/docs/` — run prettier; Docs Build is strict) that (a) stacks are added/removed as a
  whole, and (b) stacks added before this release, or re-stacked afterward, may need re-adding.
- **Tests (write first):** `web/src/routes/(user)/spaces/[spaceId]/[[photos=photos]]/[[assetId=id]]/spaces-page.spec.ts`
  (or the timeline-manager spec) — Space view passes `withStacked: true` and renders the
  collapsed cover with the correct count once all frames are members (E24); space-album detail
  builds options **without** `withStacked` (E25). If no web app change is truly needed, S4 is
  test + docs only.
- **Verification gate:** `cd web && pnpm check:typescript && pnpm check:svelte && pnpm lint` ·
  `pnpm test -- --run <spec>` · prettier on any touched markdown.
- **Acceptance:** E24–E25 green; docs note merged.

## Files touched (summary)

| File                                                                                      | Change                                   | Slice  |
| ----------------------------------------------------------------------------------------- | ---------------------------------------- | ------ |
| `server/src/repositories/shared-space.repository.ts`                                      | two `@GenerateSql` stack-closure queries | S1, S2 |
| `server/src/services/shared-space.service.ts`                                             | expand in `addAssets` / `removeAssets`   | S1, S2 |
| `server/src/services/shared-space.service.spec.ts`                                        | unit tests                               | S1, S2 |
| `server/test/medium/specs/repositories/shared-space.repository.spec.ts`                   | query medium tests                       | S1, S2 |
| `server/test/medium/specs/repositories/shared-space-stack-expansion.medium.spec.ts` (new) | query + composition E2E medium tests     | S1, S2 |
| `mobile/lib/infrastructure/repositories/timeline.repository.dart`                         | collapse two aggregated-Space builders   | S3     |
| `mobile/test/infrastructure/repositories/timeline_repository_test.dart`                   | Drift collapse tests                     | S3     |
| `web/src/routes/(user)/spaces/[spaceId]/.../spaces-page.spec.ts`                          | guard tests                              | S4     |
| `docs/docs/…` (Spaces user doc)                                                           | re-add-workaround note                   | S4     |
