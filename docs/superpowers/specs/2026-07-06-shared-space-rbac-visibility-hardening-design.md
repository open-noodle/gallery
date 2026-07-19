# Shared-Space RBAC Visibility Hardening — Design Spec

> **For agentic workers:** REQUIRED SUB-SKILL: drive this with `impl-loop` (spec review → per-slice `superpowers:writing-plans` → `superpowers:subagent-driven-development`). Steps use checkbox (`- [ ]`) syntax. Every slice is TDD: failing test first (red), minimal fix (green), refactor.
>
> **Rev 2 (2026-07-06):** incorporates two independent code-grounded reviews. Changes vs rev 1: S4 split into query-filter (4.A) + purge-propagation (4.B) with honest matrix cells; S4 album-asset sync corrected to a _grant_ surface (no `requireShowInTimeline`); EXIF builders flagged as needing an `asset` join; `downloadAlbumId` added to S2; S10 narrowed to search + edit-gate (map/memory/view stay Timeline-only by design); S11 guard rewritten as a _new_ visibility scan + allowlist reconciliation; anchors corrected throughout; edge-case lists completed (livePhoto video part, `isOffline`, soft-deleted album, added-then-flipped replay); own-M3 (column F) corrected for memory/view.

**Goal:** Close every confirmed way a shared-space member can reach a photo (bytes, thumbnail, EXIF, or existence/metadata) that its owner has made non-shareable (Hidden/Locked), and make the space visibility rule consistent across every surface — enforced by tests that cover the full RBAC matrix.

**Architecture:** A shared-space grants members access to assets via three paths — direct (`shared_space_asset`), library (`shared_space_library`), and linked album (`shared_space_album`). The fork already has a correct reference gate in `searchAssetBuilder` and in `shared-space.repository.ts` reads (`visibility IN (Archive, Timeline)`), but ~10 surfaces bypass it. This spec adds one canonical visibility predicate in `shared-space-album-scope.ts`, routes every space-scoped read through it, adds the missing `requireShowInTimeline` capability to the raw-SQL album helper, strips PII from the linked-albums DTO, closes the sync purge-on-hide gap, and adds a structural regression guard plus an exhaustive negative-test matrix.

**Tech stack:** NestJS 11, Kysely (type-safe SQL), Vitest (unit + medium/testcontainers), Playwright/Vitest (e2e), `@immich/sdk` (regenerated when a DTO changes).

**Base branch:** `space-albums-onto-main` (HEAD `92ed82afb6` = PR #752). Create fix branch `fix/space-albums-rbac-visibility` off it. Do **not** merge to `main` or `#752` without explicit instruction.

---

## Global Constraints

Every task's requirements implicitly include this section.

1. **Canonical space visibility set — the single source of truth:**
   `spaceVisibleAssetVisibilities = [AssetVisibility.Archive, AssetVisibility.Timeline]`.
   Hidden and Locked are **never** shareable through a space. Archive **is** shareable (matches `bulkAddUserAssets`, `shared-space.repository.ts:314`, which only admits `[Archive, Timeline]` into a space). This value exists today as **three declarations under two names** — `visibleSpaceAssetVisibilities` (`shared-space.repository.ts:42`) and `peopleAssetVisibilities` (`face-identity.repository.ts:160`, `person.repository.ts:63`). Slice 1 consolidates them into one exported constant and aliases both names to it (grep the names; don't line-match).

2. **The canonical gate** — every space-membership asset read MUST AND its asset rows with all of:
   - `asset.deletedAt IS NULL`
   - library arm: `asset.isOffline = false`
   - album arm: `album.deletedAt IS NULL` (A1) **and**, on personal-timeline/projection surfaces (timeline, memory, folder view, people list, statistics), `shared_space_album.showInTimeline = true` (`requireShowInTimeline`). **Not** on explicit browse/grant surfaces (album-asset sync, direct album download/read) — those intentionally expose the whole shared album.
   - **`asset.visibility IN (Archive, Timeline)`** (the canonical set)
     Where a surface merges the **caller's own** assets through a **separate** `asset.ownerId = caller` branch (search, timeline via `userIds`, sync album-user grant, map), that branch keeps the caller's own resolved visibility (own elevation, M3); only the space-membership branch is restricted to the canonical set. **Surfaces without a separate own branch** (memory, folder view) gate own+space uniformly — see Slice 10 note; they have no own-M3 elevation and are intentionally Timeline-only.

3. **Visibility-model scope (decision, 2026-07-06, refined in rev 2):** the canonical set closes the Hidden/Locked leaks on **every** surface. For the _Archive-consistency_ question: **browse/access surfaces** (timeline, search, download, by-ID read, sync, facets, faces, tags, folder-asset access) expose other members' `Archive`; **resurfacing surfaces** (memory "on this day", map markers) keep `Archive` excluded, matching upstream personal-library behavior. Concretely, Slice 10 aligns only `searchAssetBuilder` (to match the space timeline) and tightens the edit gate; **map/memory/view stay Timeline-only for the space path** (safe — stricter than canonical — and consistent with upstream). This is a deliberate narrowing of the literal "uniform everywhere" because those surfaces gate own+partner+space with a single term and loosening them would both restructure the query and resurface archived content against upstream norms. If full uniformity is later desired, restructure each to give the space path its own gate (tracked, not in this spec).

4. **TDD, strictly:** each behavior gets a failing test first, verified red, then the minimal fix, verified green. Negative assertions (Hidden/Locked seeded → asserted absent) are mandatory. Every slice below lists its explicit red step.

5. **DTO changes require SDK regen:** Slice 7 changes `SharedSpaceLinkedAlbumDto`. After it: `pnpm build` (server) → `pnpm sync:open-api` → `make open-api`, then fix web/dart call sites. Web must never pass `undefined` for a required body arg.

6. **Medium test infra:** use `newTestService()` / the `ctx` factory (`ctx.newUser`, `ctx.newSharedSpace`, `ctx.newSharedSpaceMember`, `ctx.newSharedSpaceAsset`, `ctx.newSharedSpaceLibrary`, `ctx.newSharedSpaceAlbum({ showInTimeline })`, `ctx.newAlbum`, `ctx.newAlbumAsset`, `ctx.newAsset({ visibility })`, `ctx.newExif`). Any new repo referenced by a medium test must be registered in `test/medium.factory.ts`.

7. **No `Co-Authored-By` / `Generated-with` trailers. No unrelated refactors.** Keep diffs minimal and fork-isolated (new test files are fork-only and rebase-safe).

8. **Verification loop:** per touched package — `pnpm check:typescript`, unit `pnpm test -- --run <file>`, medium `pnpm test:medium -- --run <file>`, eslint 0 warnings on touched files. E2e via the running stack / CI + babysit.

---

## The Canonical Visibility Model (implement once in Slice 1, reuse everywhere)

Add to `server/src/utils/shared-space-album-scope.ts`:

```ts
export const spaceVisibleAssetVisibilities = [AssetVisibility.Archive, AssetVisibility.Timeline];

/**
 * The space-membership visibility gate. AND this into every space-scoped asset read.
 * Default column presumes the query is rooted on / joined to `asset`; pass an explicit
 * column for other roots. NOT usable on an `asset`-less builder (add an `asset` join first).
 */
export function spaceVisibilityGate(
  eb: ExpressionBuilder<DB, keyof DB>,
  column: ReferenceExpression<DB, keyof DB> = 'asset.visibility',
): Expression<SqlBool> {
  return eb(column, 'in', spaceVisibleAssetVisibilities);
}
```

Raw-SQL surfaces (face-identity) use the equivalent fragment
`sql\`"asset"."visibility" IN (${sql.join(spaceVisibleAssetVisibilities)})\``— this exactly matches the existing pattern at`shared-space.repository.ts:932`.

`spaceAlbumAssetExistsSql` gains a `requireShowInTimeline?: boolean` option (default `false`, preserving legacy behavior) that, when true, appends `AND "shared_space_album"."showInTimeline" = true`, matching the Kysely `spaceAlbumAssetExists`.

---

## RBAC Coverage Matrix — the binding contract

Target state **after** all slices. Every non-trivial cell must be **enforced in code AND proven by a test** (the S11 matrix spec is the machine-checked record). `n/a` = not meaningful for that surface. Columns:

- **A — non-member → ∅/403.**
- **B — member sees shared:** direct + library + linked-album(`showInTimeline=true`, not deleted) assets, visibility ∈ `{Timeline, Archive}` (resurfacing surfaces #5/#6: `{Timeline}` only, by design).
- **C — other member's Hidden/Locked BLOCKED** (incl. added-while-Timeline-then-flipped). **The key leak column.**
- **D — showInTimeline=false album BLOCKED** on projection surfaces (`n/a` on grant/browse surfaces that intentionally expose the whole album).
- **E — soft-deleted album BLOCKED.**
- **F — own M3 elevation** (own archived/hidden/locked per own elevation, hidden from others; `n/a` where a surface has no own-elevation branch).

| #   | Surface (file)                                                                                                       | A   | B             | C (Hidden/Locked)                              | D (showInTimeline=false) | E (soft-del album) | F (own M3) | Closed by                          |
| --- | -------------------------------------------------------------------------------------------------------------------- | --- | ------------- | ---------------------------------------------- | ------------------------ | ------------------ | ---------- | ---------------------------------- |
| 1   | timeline / bucket (`asset.repository.ts` getTimeBucket)                                                              | ✅  | ✅            | ✅                                             | ✅                       | ✅                 | ✅         | existing + S9 (faces path)         |
| 2   | search results (`utils/database.ts` searchAssetBuilder, two `=Timeline` terms `:673`,`:685`)                         | ✅  | ✅            | ✅                                             | ✅                       | ✅                 | ✅         | existing + **S10** (Archive align) |
| 3   | facets / suggestions / tags (`search.repository.ts`, `tag.repository.ts`)                                            | ✅  | ✅            | **S5**                                         | **S5**                   | ✅                 | ✅         | **S5**                             |
| 4   | space people-facets (`search.repository.ts` people via `buildFilteredAssetIds`)                                      | ✅  | ✅            | **S5**                                         | **S5**                   | ✅                 | n/a        | **S5**                             |
| 5   | map markers (`map.repository.ts`) — **resurfacing: Timeline-only by design**                                         | ✅  | ✅ (Timeline) | ✅                                             | ✅                       | ✅                 | n/a        | existing                           |
| 6   | memory (`memory.repository.ts`) — **resurfacing: Timeline-only by design**                                           | ✅  | ✅ (Timeline) | ✅                                             | **S9**                   | ✅                 | n/a        | existing + **S9**                  |
| 7   | view / folders (`view-repository.ts`) — **Timeline-only (no own branch)**                                            | ✅  | ✅ (Timeline) | ✅                                             | **S9**                   | ✅                 | n/a        | existing + **S9**                  |
| 8   | people / faces list (`face-identity.repository.ts`, `shared-space.repository.ts`)                                    | ✅  | ✅            | ✅                                             | **S9**                   | ✅                 | ✅         | existing + **S9**                  |
| 9   | face rep-thumbnail (`shared-space.repository.ts` isFaceInSpace `:2480`)                                              | ✅  | ✅            | **S6**                                         | **S6**                   | **S6**             | n/a        | **S6**                             |
| 10  | asset read/view/download by ID (`access.repository.ts` checkSpaceAccess `:270`)                                      | ✅  | ✅            | **S3**                                         | n/a (browse)             | ✅                 | ✅         | **S3**                             |
| 11  | download-space zip (`download.repository.ts` downloadSpaceId `:41`)                                                  | ✅  | ✅            | **S2**                                         | n/a                      | ✅                 | ✅         | **S2**                             |
| 11b | album download via space grant (`download.repository.ts` downloadAlbumId `:27`, `AlbumDownload` via `access.ts:240`) | ✅  | ✅            | **S2** (Hidden; Locked already album-stripped) | n/a (browse)             | ✅                 | ✅         | **S2**                             |
| 12  | mobile sync — asset (`sync.repository.ts` SharedSpaceAssetSync `:981` + Exif `:1060`)                                | ✅  | ✅            | **S4.A** future / **S4.B** purge               | n/a                      | ✅                 | ✅         | **S4**                             |
| 13  | mobile sync — album asset (grant) (`sync.repository.ts` SharedSpaceAlbumAssetSync `:1528` + Exif `:1599`)            | ✅  | ✅            | **S4.A** future / **S4.B** purge               | n/a (grant surface)      | ✅                 | ✅         | **S4**                             |
| 14  | getLinkedAlbums (`shared-space.service.ts:697`) — PII                                                                | ✅  | ✅            | n/a                                            | n/a                      | ✅                 | n/a        | **S7** (strip albumUsers/email)    |
| 15  | getPersonAssetIds (`shared-space.repository.ts:1774`)                                                                | ✅  | ✅            | **S8**                                         | **S8**                   | **S8**             | ✅         | **S8**                             |
| 16  | attach space people to detail (`access.repository.ts` checkSpaceAccessForSpace `:341`)                               | ✅  | ✅            | **S8**                                         | n/a                      | ✅                 | ✅         | **S8**                             |
| 17  | people/face statistics (`face-identity.repository.ts` getAccessiblePeople\*Statistics)                               | ✅  | ✅            | ✅                                             | **S9**                   | ✅                 | n/a        | existing + **S9**                  |
| 18  | asset write via space (`access.repository.ts` checkSpaceEditAccess `:415`)                                           | ✅  | editor+       | **S10**                                        | n/a                      | ✅                 | ✅         | **S10**                            |

**Note on #12/#13-C (honesty):** S4.A closes the leak for any **new/full** device sync (the upsert/backfill streams). S4.B closes the **already-synced-then-hidden** purge (a delete/tombstone on visibility flip). If S4.B's mobile consumption needs a client change, the server-side delete emission is still implemented + tested and the client half is a tracked follow-up — the matrix cell is only fully ✅ once both land.

**Album detail read via space (`GET /albums/:id`, `album.repository.getById` + `withAssets`) is SAFE** — `withAssets` already applies `withDefaultVisibility` (`[Archive, Timeline]`), so it never returns Hidden/Locked. Only the album _download_ stream (`downloadAlbumId`, row 11b) lacked the filter. `AlbumRead`/`AlbumDownload` are space-grantable via `checkSpaceLinkedAlbumReadAccess` (`access.ts:189/240`); S11's guard/matrix asserts both.

**Provably safe today (regression-guard only):** scope helper, `shared-space.repository` reads, `PersonAccess.checkSharedSpaceAccess`, `linkAlbum`/`unlinkAlbum`/`updateAlbumLink` authorization (Editor + `AlbumUpdate`, cannot self-satisfy via space grant), the "absorbed invariant" (space-linked album absent from plain `GET /albums`), soft-delete face-retention (4 original holes closed; remaining two are S6/S8), token resolution fail-closed. Slice 11 adds a static guard so these cannot regress.

---

## Slices

Order = severity-first; Slice 1 (foundation) enables the rest. Each slice is independently testable and pushed on completion.

### Slice 1 — Canonical visibility helper + raw-SQL `requireShowInTimeline` (foundation)

**Closes:** none directly; enables S2–S10 and the S11 guard. **Files:**

- Modify `server/src/utils/shared-space-album-scope.ts`: add `spaceVisibleAssetVisibilities`, `spaceVisibilityGate()`, and a `requireShowInTimeline?: boolean` (default `false`) option in `spaceAlbumAssetExistsSql`.
- Modify `shared-space.repository.ts` / `face-identity.repository.ts` / `person.repository.ts`: replace the three local constant declarations (two names) with an import/alias of the new constant (pure relocation, no behavior change).
- Test: `server/src/utils/shared-space-album-scope.guard.spec.ts` (extend) + `server/test/medium/specs/utils/shared-space-album-scope-sql.medium.spec.ts` (extend for the new option).

**TDD steps:**

- [ ] **Red (behavioral):** write a medium equivalence test — `spaceAlbumAssetExistsSql({ requireShowInTimeline: true })` produces SQL equal to the Kysely `spaceAlbumAssetExists({ requireShowInTimeline: true })` for a fixture with one `showInTimeline=true` and one `showInTimeline=false` linked album: the raw variant must **exclude** the false one; with the option absent/false, both are included (unchanged legacy behavior). Run red (option does not exist yet).
- [ ] **Red (relocation guard):** unit assertions that `spaceVisibilityGate(eb)` compiles to `"asset"."visibility" in ('archive','timeline')`, the constant equals `[Archive, Timeline]`, and the two old names resolve to the **same array reference** (`===`) post-consolidation.
- [ ] Implement helper + option + constant consolidation → green.
- [ ] Regression: run the existing `*-sql.medium.spec.ts`; confirm `make sql` diff is empty except the intended `requireShowInTimeline` variant. `pnpm check:typescript`; eslint 0. Commit `feat(spaces): canonical space visibility gate + raw-SQL showInTimeline option`.

**Edge cases:** option defaults to `false` (legacy preserved); constant consolidation must not change any existing query's SQL (verified via the sql medium spec + `make sql`).

---

### Slice 2 — L1: download visibility filter — `downloadSpaceId` **and** `downloadAlbumId` (🔴 Critical) — matrix #11, #11b

**Closes:** #11-C, #11b-C. **Files:** `server/src/repositories/download.repository.ts` — `downloadSpaceId` (`:41`, all three arms) and `downloadAlbumId` (`:27`, add the visibility gate to match `withAssets`/`withDefaultVisibility`). Test: `server/test/medium/specs/repositories/download.repository.spec.ts` (create if absent).

**TDD steps:**

- [ ] **Red (space zip):** seed a space (owner + member); owner adds assets of each visibility (`Timeline`, `Archive`, `Hidden`, `Locked`) via **each** path (direct, library, album). Stream `downloadSpaceId(space.id)`; assert the returned id set = the `{Timeline, Archive}` assets only, across all three arms; `Hidden`/`Locked` absent. Run red (all four returned).
- [ ] **Red (album via space):** a space member calls the album-download path (`AlbumDownload` satisfied via `checkSpaceLinkedAlbumReadAccess`); `downloadAlbumId(linkedAlbumId)` must return only `{Timeline, Archive}` album assets — a `Hidden` album asset absent. (`Locked` is already stripped from albums by `asset.service.ts:313` — assert it isn't present, documenting that invariant.)
- [ ] Implement: add `spaceVisibilityGate(eb)` to each `downloadSpaceId` arm; add `withDefaultVisibility`/`spaceVisibilityGate` to `downloadAlbumId`. → green.
- [ ] Commit `fix(spaces): space + linked-album downloads exclude hidden/locked assets`.

**Edge cases:** (a) **added-then-locked/hidden replay** — asset added while `Timeline`, then flipped: excluded (proves read-time gating vs the un-pruned `shared_space_asset` row). (b) **live-photo video part** (`livePhotoVideoId`) inherits the parent's exclusion. (c) **soft-deleted album** arm excluded via `album.deletedAt IS NULL` — assert. (d) library arm keeps `isOffline = false` — seed an offline library asset, assert absent.

---

### Slice 3 — L2: `checkSpaceAccess` visibility filter (🔴 High) — matrix #10

**Closes:** #10-C. **Files:** `server/src/repositories/access.repository.ts` (`checkSpaceAccess` `:270`, all three union arms; gates `AssetRead`/`AssetView`/`AssetDownload` per `access.ts:120/137/148`, always **after** `checkOwnerAccess`). Test: `server/test/medium/specs/repositories/access.repository.spec.ts` + e2e `e2e/src/specs/server/api/shared-space.e2e-spec.ts`.

**TDD steps:**

- [ ] **Red (medium):** member + another member's assets of each visibility via each path. `checkSpaceAccess(member.id, allIds)` returns only `{Timeline, Archive}`; `Hidden`/`Locked` absent. Run red.
- [ ] **Red (e2e):** as a plain member, `GET /assets/:id`, `GET /assets/:id/original`, `GET /assets/:id/thumbnail` for another member's `Locked`/`Hidden` in-space asset → `400`/`403`; for `Timeline`/`Archive` → `200`.
- [ ] Implement: AND `spaceVisibilityGate(eb)` into each union arm (keep `deletedAt`, `isOffline`, `album.deletedAt`). → green.
- [ ] Commit `fix(spaces): space asset read/view/download gate excludes hidden/locked`.

**Edge cases:** (a) **`livePhotoVideoId`** — the function returns both `id` and `livePhotoVideoId` and OR-matches on both (`:283/298/315`); a `Locked` parent's video part must not be reachable — add an explicit assertion. (b) **own asset still reachable** via `checkOwnerAccess` (not `checkSpaceAccess`): assert the caller can still read their OWN `Locked` asset with elevation (own-M3, cell F) so the fix doesn't over-block. (c) **added-then-locked replay**. (d) **`isOffline=true`** library asset excluded. (e) **soft-deleted album** asset excluded.

---

### Slice 4 — L3: mobile sync — query filter (4.A) + purge-on-hide (4.B) (🔴 High) — matrix #12, #13

**Anchors (corrected):** `SharedSpaceAssetSync` (`sync.repository.ts:981`) has `getBackfill` (`:988`), `getCreates` (`:1012`), `getUpdates` (`:1037`) — **no `getDeletes`**; `SharedSpaceAssetExifSync` (`:1060`) joins **only** `asset_exif`; `SharedSpaceAlbumAssetSync` (`:1528`, a `shared_space_album_user` **grant** stream) + `SharedSpaceAlbumAssetExifSync` (`:1599`). Row-removal deletes are emitted by the separate `SharedSpaceToAssetSync.getDeletes` (`:1113`, reads `shared_space_asset_audit`) and `SharedSpaceAlbumToAssetSync.getDeletes` (reads `album_asset_audit`), which fire on **row deletion only**, not visibility flips.

#### Slice 4.A — Gate the sync read streams (closes future/full-sync leak)

**Closes:** #12-C / #13-C for any new or full re-sync. **Files:** `sync.repository.ts` — add `spaceVisibilityGate` to `SharedSpaceAssetSync.{getBackfill,getCreates,getUpdates}` and `SharedSpaceAlbumAssetSync` equivalents; for **both EXIF builders**, first add `innerJoin('asset', 'asset.id', '<exif>.assetId')` (they currently have no `asset` join) **then** apply the gate. **Do NOT** apply `requireShowInTimeline` to the album-asset stream — it is an explicit browse/grant surface (`shared_space_album_user`); hiding `showInTimeline=false` assets there would wrongly deny a directly-granted member. Test: `server/test/medium/specs/repositories/sync.repository*.spec.ts`.

**TDD steps:**

- [ ] **Red:** seed a space + two members; member A has assets of each visibility (direct) and album-linked assets. Drive the shared-space asset + album-asset sync (+ EXIF) for member B; assert only `{Timeline, Archive}` appear, with EXIF/GPS only for those; `Hidden`/`Locked` absent. Run red.
- [ ] Implement (add `asset` joins to EXIF builders, apply gate) → green.
- [ ] Commit `fix(spaces): shared-space sync streams exclude hidden/locked assets and exif`.

**Edge cases:** live-photo video part excluded; `isOffline=true` library asset excluded; `isFavorite` masking unchanged; **no** `showInTimeline` filter on the album-asset grant stream (assert a `showInTimeline=false` album asset still syncs to a grant-holder, only visibility-gated).

#### Slice 4.B — Purge on visibility flip (closes already-synced leak)

**Closes:** #12-C / #13-C for the added-then-hidden device-purge case. **Files:** `server/src/services/asset.service.ts` (`updateAll` `~:312`, where `Locked` already triggers `albumRepository.removeAssetsFromAll`) — on a visibility change **out of** `[Archive, Timeline]` for any in-space asset, emit the sync delete/tombstone so `SharedSpaceToAssetSync.getDeletes` (and the album equivalent) purge the device. Test: `sync.repository`/`asset.service` medium specs.

**TDD steps:**

- [ ] **Red:** member B fully syncs member A's `Timeline` in-space asset (device holds it). Member A flips it to `Hidden` (and separately `Locked`). Drive member B's sync `getDeletes`/checkpoint; assert a **delete/tombstone** event for that asset appears (device would purge). Run red (no delete emitted today).
- [ ] Implement the tombstone emission on visibility-out-of-set. **Investigation sub-task:** determine the minimal mechanism (insert a `shared_space_asset_audit`/`album_asset_audit` tombstone without deleting the live `shared_space_asset` row, so un-hide restores; or an equivalent checkpoint). If the mobile client cannot consume this without a client change, ship + test the **server-side** emission and open a tracked mobile follow-up — do **not** silently drop the purge. → green.
- [ ] Commit `fix(spaces): purge shared-space assets from member devices when hidden/locked`.

**Edge cases:** un-hide (`Hidden→Timeline`) restores the asset on next sync (live row never deleted); `Locked` path already calls `removeAssetsFromAll` (album purge) — ensure the space-asset tombstone is additive; own device (owner) still updates via normal AssetSync.

---

### Slice 5 — L5: facets / suggestions / tags / people-facets visibility gate (🟠 Medium) — matrix #3, #4

**Closes:** #3-C/#3-D, #4-C/#4-D. **Anchors (corrected):** `applySuggestionScope` (`search.repository.ts:1186`), `getAccessibleTags` (`:1099`), the people-facet **producer** `buildFilteredAssetIds` (used by `getFilteredIdentityPeople` `:1506`; the consumer `buildFilteredSpacePeopleQuery` `:1467` only filters on the produced id set — the gate belongs in the producer), and `tag.repository.ts getAll` (`:73`, space arms `:94`/`:115`). Test: `search.service.spec.ts`, `search.repository.spec.ts`, `tag.repository.spec.ts`.

**TDD steps:**

- [ ] **Red, per surface** (`getSearchSuggestions` city/country/state/camera-make/model/lens, `getFilterSuggestions`, tag suggestions, `getAccessibleTags`, `tag.getAll`, space people-facets): seed another member's `Hidden` (and, for an elevated caller, `Locked`) asset with a **distinct** city/tag/person/camera; assert that value is **absent**. Seed `Timeline` and `Archive` with distinct values → **present**. Seed a `showInTimeline=false` linked-album asset with a distinct value → **absent**. Run red.
- [ ] Implement: for the space-membership branch in each builder, AND `spaceVisibilityGate(eb)` and pass `requireShowInTimeline: true` on the album arm (`spaceAssetPathBranches({ requireShowInTimeline: true })`). The caller's own branch (e.g. the `timelineSpaceIds` `ownerId` term) keeps caller visibility. → green.
- [ ] Commit `fix(spaces): filter suggestions/facets/tags to shareable space assets`.

**Edge cases:** (a) **elevated session** — the caller's own `Locked` values may appear (own M3), but another member's `Locked`/`Hidden` must not. (b) the existing positive album-suggestion tests (`search.service.spec.ts:276-356`) stay green (their assets are `Timeline`). (c) `hasUnnamedPeople` must not flip true solely due to another member's hidden asset. (d) **added-then-flipped replay** — a facet/person derived while the asset was `Timeline`, then flipped `Hidden`: must disappear (read-time gating).

---

### Slice 6 — L4: `isFaceInSpace` rep-face thumbnail guards (🟠 Medium) — matrix #9

**Closes:** #9-C/D/E. **Files:** `server/src/repositories/shared-space.repository.ts` (`isFaceInSpace` `:2480`). The **direct** arm (`:2484`) has **no `asset` join at all** (only `asset_face.deletedAt`) — add an `asset` join + full gate (`deletedAt`, visibility). The **library** arm (`:2491`) already has `asset.deletedAt`+`isOffline` — add visibility. The **album** arm — add visibility + `album.deletedAt` + `showInTimeline` (projection surface). Mirror the fully-guarded `isAssetInSpace` (`:2433`). Test: `shared-space.repository.spec.ts` + a service test for `getSpacePersonThumbnail` auto path.

**TDD steps:**

- [ ] **Red:** a space person whose representative face's **only** source asset is (per case) another member's `Hidden`, `Locked`, soft-deleted direct asset, or a `showInTimeline=false`/soft-deleted album asset. `isFaceInSpace(space.id, faceId)` returns `false` for each; the auto rep-face thumbnail (`getSpacePersonThumbnail`) is not served. For a face on a `Timeline`/`Archive` asset → `true`. Run red.
- [ ] Implement → green. Commit `fix(spaces): representative-face thumbnail only from shareable space assets`.

**Edge cases:** the **manual** rep-face path is already scoped — add a regression assertion it still works. `Archive` rep-face still serves. **Added-then-flipped replay** — a rep-face chosen while the asset was `Timeline`, then flipped `Hidden`: no longer served.

---

### Slice 7 — L6: `getLinkedAlbums` strips album-user PII (🟠 Medium) — matrix #14

**Closes:** #14 PII. **Files:** `shared-space.repository.ts` (`getLinkedAlbums` `:450`, drop `withSpaceAlbumUsers` `:23`), `server/src/dtos/shared-space.dto.ts` (`SharedSpaceLinkedAlbumSchema` `:142` currently extends `AlbumResponseSchema` whose `albumUsers` is **required** and carries `email`; use `.omit({ albumUsers: true })` or a projection schema), `shared-space.service.ts` (`getLinkedAlbums` `:697` mapping). Then SDK regen + web/dart call-site check. Test: `shared-space-album.service.spec.ts` + e2e `shared-space-album.e2e-spec.ts`.

**TDD steps:**

- [ ] **Red:** `getLinkedAlbums` for a viewer returns each linked album **without** `albumUsers` and **without** any `email`, while still returning the fields the web UI uses (`id`, `albumName`, `assetCount`, `showInTimeline`, `addedById`, `linkedAt`, thumbnail). Run red.
- [ ] Implement projection/omit → green.
- [ ] Regenerate SDK (`pnpm build` → `pnpm sync:open-api` → `make open-api`); `check-web`. Commit `fix(spaces): linked-albums endpoint no longer exposes album-user emails` + a follow-up commit for regenerated SDK/dart.

**Edge cases:** (a) e2e "absorbed invariant" + existing `getLinkedAlbums` tests stay green. (b) web `web/src/routes/(user)/spaces/[spaceId]/albums/+page.svelte` (and list/table) do not read `albumUsers`/`owner`/`email` (verified — `SpaceLinkAlbumModal` reads `albumUsers` only from the regular `getAllAlbums()` DTO, unaffected). (c) dart SDK consumers compile.

---

### Slice 8 — L7: `getPersonAssetIds` scoping + `checkSpaceAccessForSpace` visibility (🟡 Low) — matrix #15, #16

**Closes:** #15-C/D/E, #16-C. **Files:** `shared-space.repository.ts` (`getPersonAssetIds` `:1774` — add the OR-of-three-paths membership + `deletedAt`/`isOffline`/`album.deletedAt`/`showInTimeline` + `spaceVisibilityGate`), `access.repository.ts` (`checkSpaceAccessForSpace` `:341` — add `spaceVisibilityGate` to its arms; note it also re-adds `livePhotoVideoId` at `:405/461`). Test: `shared-space.repository.spec.ts`, `access.repository.spec.ts`.

**TDD steps:**

- [ ] **Red:** a `shared_space_person_face` row whose asset is another member's `Hidden`/`Locked`, soft-deleted, or in a `showInTimeline=false`/soft-deleted album → `getPersonAssetIds` must not enumerate its id; `Timeline`/`Archive` → enumerated. `checkSpaceAccessForSpace` excludes non-shareable ids (incl. the `livePhotoVideoId` of a `Locked` parent). Run red.
- [ ] Implement → green. Commit `fix(spaces): scope person-asset ids and space-asset attach to shareable assets`.

**Edge cases:** person-detail page still loads its content (remaining ids are shareable); no empty-people regression for `Timeline`/`Archive` faces. **Added-then-flipped replay** (the `shared_space_person_face` projection survives the flip). **`isOffline=true`** library asset excluded. **live-photo video part** of a `Locked` parent excluded from `checkSpaceAccessForSpace`.

---

### Slice 9 — Hardening: `requireShowInTimeline` on projection face/memory/view surfaces + prune/recount on `showInTimeline` flip — matrix #6-D, #7-D, #8-D, #17-D

**Closes:** the `showInTimeline=false` (D) column on memory, view, people/faces, statistics; and stored-counter staleness. **Files:** `face-identity.repository.ts` (the `spaceAlbumAssetExistsSql` call sites `:902/1021/1162/1642/1787/1902` — pass `requireShowInTimeline: true` where the surface is a **personal-timeline projection**), `memory.repository.ts` + `view-repository.ts` (album arm → `requireShowInTimeline: true`), `shared-space.service.ts` (`updateAlbumLink` `:687` — prune/recount `shared_space_person_face` + `faceCount`/`assetCount` when `showInTimeline` flips false, re-add when true). Test: `face-identity.repository.spec.ts`, `memory.repository.spec.ts`, `view-repository` spec, `shared-space-album.service.spec.ts`.

**TDD steps:**

- [ ] **Red:** a `showInTimeline=false` linked album's faces/people do **not** surface in the People tab, memory, or folder view; toggling `showInTimeline` false→true→false updates the people list AND stored counters consistently; after `→false`, `getPersonAssetIds` (S8 surface) no longer enumerates those album assets. Run red.
- [ ] Implement → green. Commit `fix(spaces): de-timelined albums stop feeding faces/memory/view and recount on toggle`.

**Edge cases:** distinguish **projection** surfaces (require `showInTimeline`) from **grant/browse** surfaces (do not — album-asset sync, direct album download/read). Statistics counters reflect the toggle. Soft-delete (A1) remains enforced everywhere. **Cross-link:** the toggle-prune interacts with S8's `getPersonAssetIds` — assert the intersection here.

---

### Slice 10 — Consistency: align `searchAssetBuilder` to `[Archive, Timeline]` + tighten `checkSpaceEditAccess` — matrix #2, #18

**Closes:** #2 (Archive alignment on search — a browse surface, to match the space timeline), #18-C. **Files:**

- `server/src/utils/database.ts` — `searchAssetBuilder` space branch: change the other-member term from `= Timeline` to `spaceVisibilityGate` at **both** sites (`:673` spaceId path **and** `:685` timelineSpaceIds path).
- `server/src/repositories/access.repository.ts` — `checkSpaceEditAccess` (`:415`, two arms, no album arm) — AND `spaceVisibilityGate` so an editor cannot `AssetUpdate` another member's Hidden/Locked (can't see it → can't edit it).

**Explicitly NOT changed** (see Global Constraint #3): `map.repository.ts` (Archive is owner-only by design via the top-level `isArchived` filter `:99-101` — a per-arm change would be dominated by it and would not surface Archive), `memory.repository.ts` (`= Timeline` at `:65` gates own+partner+space together — a resurfacing surface, Archive stays excluded per upstream), `view-repository.ts` (`= Timeline` at `:19/:39` over `ownedOrSpaceAccessible`, no own branch). These stay Timeline-only: safe (stricter than canonical) and upstream-consistent.

Test: `search.service.spec.ts`, `access.repository.spec.ts`.

**TDD steps:**

- [ ] **Red (search):** another member's `Archive` asset in the space now **appears** in `searchMetadata`/`searchLargeAssets` results (previously excluded); `Hidden`/`Locked` still excluded; the caller's own assets resolve per own elevation unchanged (searchAssetBuilder has a separate `userIds`/owner branch — verify). Run red.
- [ ] **Red (edit):** a space editor cannot `AssetUpdate` another member's `Hidden`/`Locked` in-space asset; can update a `Timeline`/`Archive` one per role. Include the live-photo video part of a `Locked` parent. Run red.
- [ ] Implement (both `=Timeline` terms in search; edit gate) → green.
- [ ] Commit `refactor(spaces): search shows shared archive (match timeline); edit gate matches read gate`.

**Edge cases:** the space-people sub-filters (`hasSpacePeople`) riding on `searchAssetBuilder` inherit the change — assert other-member `Archive`-only faces now appear consistently with the timeline. `userIds`-undefined (pure space browse) path handled at both sites. `checkSpaceEditAccess` live-photo video part gated.

---

### Slice 11 — Structural guard + exhaustive negative-test matrix (regression lock) — the "double-check"

**Closes:** proves every risky cell and prevents any future surface from forgetting the gate. **Files:** extend `server/src/utils/shared-space-album-scope.guard.spec.ts`; create `server/test/medium/specs/repositories/shared-space-visibility-matrix.medium.spec.ts`; extend e2e `shared-space*.e2e-spec.ts`.

**TDD steps:**

- [ ] **Add a NEW, second static scan** to the guard spec (the existing scan checks that a `shared_space_library` arm has a sibling `shared_space_album` arm — a _different_ invariant; do not conflate). The new scan: for every repository query that space-scopes an asset read (joins `shared_space_asset`/`shared_space_library`/`shared_space_album` and returns/selects asset rows), assert it references the visibility gate (`spaceVisibilityGate`/`spaceVisibleAssetVisibilities`/`visibility IN`), or is on the **new visibility allowlist** with a one-line reason. Give the new scan its **own** allowlist (the album-marker allowlist is separate). **Prune the stale entry:** the existing album-marker allowlist entry `getMapMarkers: 'omit album path (pre-existing)'` is now FALSE (`map.repository.ts:160` has the album leg with `requireShowInTimeline: true`) — remove it. Document which allowlist governs `checkSpaceEditAccess` (visibility-gated by S10 but still no album arm → stays on the album-marker allowlist, off the visibility allowlist), `findSpaceForAssetAndUser`, `getPersonalThumbnailForSpacePerson`.
- [ ] **Write the matrix medium spec:** a parametrized fixture seeding `{Timeline, Archive, Hidden, Locked}` × `{direct, library, album(showInTimeline=true), album(showInTimeline=false), soft-deleted-album}`, asserting the correct visible set on **every** surface the slices touch: download-space, download-album-via-space, `checkSpaceAccess`, `checkSpaceAccessForSpace`, sync (asset + album), facets/tags, space people-facets, `isFaceInSpace`, `getPersonAssetIds`, timeline, statistics, map, memory, view, `checkSpaceEditAccess`. Each 🔴 cell in the matrix has an assertion here (map/memory/view assert Timeline-only per Global Constraint #3).
- [ ] **Add e2e negatives** for the HTTP-reachable content leaks: download-space and download-album-via-space and `GET /assets/:id`/original for a Hidden/Locked in-space asset as a non-owner member.
- [ ] Run the whole matrix green. Commit `test(spaces): exhaustive RBAC visibility matrix + structural regression guard`.

**Edge cases:** each allowlist lists every intentional omission with a one-line reason, so an unexplained omission fails CI. The matrix fixture includes the added-then-flipped replay for the projection surfaces (`shared_space_person_face`, `shared_space_asset`).

---

## Post-Implementation Verification (mandatory — the "double-check after implementing")

After all slices are green and pushed:

1. **Re-run the coverage matrix as code:** `pnpm test:medium -- --run shared-space-visibility-matrix` passes every cell; `pnpm test -- --run shared-space-album-scope.guard` (both scans) green.
2. **Re-audit adversarially:** re-dispatch the 5 read-only RBAC audit agents (scope-helper, cross-surface visibility, search, faces/endpoint, coverage) against the fixed tree; confirm zero remaining Hidden/Locked content/thumbnail/EXIF/existence leaks at confidence ≥8 and no unclosed 🔴 cell — **including** the two paths added in rev 2 (`downloadAlbumId` via space grant, S4.B device purge).
3. **Trace every matrix row** to a passing assertion in the matrix spec / guard; any row without one is a gap to close before merge.
4. **CI green** on the full gating set (Test&Lint Server, Medium Tests, E2E Server&CLI, Test Web) via babysit; the recurring mise 403 flake is a re-run, not a code fix.
5. Report the before/after matrix; do not merge to `#752`/`main` without explicit instruction.

---

## Self-Review (rev 2)

- **Spec coverage:** every confirmed leak (L1–L7, plus `downloadAlbumId`) and every hardening/consistency item maps to a slice; every matrix cell maps to a closing slice and a test; S11 is the machine-checked record. ✅
- **Consistency:** one canonical set + one gate helper; browse surfaces expose Archive, resurfacing surfaces (map/memory) stay Timeline-only by design (documented, upstream-consistent); no surface leaks Hidden/Locked. ✅
- **TDD:** every slice is red-first with explicit negative assertions; the relocation-only Slice 1 states its genuine red (the `requireShowInTimeline` option + constant identity). ✅
- **Anchors:** corrected against HEAD `92ed82afb6` (sync method names, S5 line numbers, isFaceInSpace direct arm, S1 sql-spec path under `utils/`, S7 web route group, two `=Timeline` search terms). ✅
- **Honesty:** S4.B device-purge is a committed server-side slice with a tracked mobile follow-up if needed; the matrix flags #12/#13-C as two-part rather than over-claiming. ✅
