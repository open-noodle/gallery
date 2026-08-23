# Space-Albums Review Remediation — Design Spec (2026-07-08)

> **Purpose.** Fix every actionable finding from `SPACE-ALBUMS-REVIEW-2026-07-08.md` using
> **test-driven development**, structured as ordered, independently-testable slices for the
> `impl-loop` skill. Each slice defines its fixes, the failing tests to write first, the
> red→green expectation, and full edge-case coverage.

---

## 0. Meta

- **Source of findings:** `SPACE-ALBUMS-REVIEW-2026-07-08.md` (repo root). 44 surviving
  finding-IDs → **~37 distinct code changes** after dedup (see §2). 3 refuted findings excluded.
- **Base branch:** create a new branch off **`origin/space-albums-onto-main`** (tip `e52d882d0c`,
  includes #726 + #757). This is the authoritative reviewed code. **Do not** build on
  `fix/space-albums-review-fixes` — it is a stale strand predating the reviewed code.
  Suggested branch name: `fix/space-albums-remediation`.
- **Line numbers** in this spec and the review are against `e52d882d0c`. Every slice plan
  **must re-confirm** exact lines/symbols against the worktree before editing — treat the
  references as navigation hints, not literal coordinates.
- **Terminal state of this spec:** feed to `impl-loop` (`impl-loop specs/2026-07-08-space-albums-review-remediation-design.md`).

### 0.1 TDD is mandatory for every fix

Every fix in every slice follows this loop, and each slice plan must show the evidence:

1. **Red** — write the test(s) that encode the desired behavior (leak blocked / convergence
   reached / permission denied). Run them; capture the exact command and the expected failure
   output. A test that passes on first run is a red flag — it isn't exercising the bug.
2. **Green** — make the minimal change to pass. Capture the green command + output.
3. **Refactor** — clean up (extract helpers, dedupe) with tests staying green.

No slice is "done" without red evidence, green evidence, and a final full-suite validation for
the touched package(s).

### 0.2 Test layers (per package)

- **Server** — vitest **unit** (`newTestService()` auto-mocks), vitest **medium**
  (`test:medium`, real Postgres via testcontainers + real `SyncService`/`SyncRepository`),
  and **e2e** (`e2e/` API vitest). Prefer medium tests for anything touching SQL predicates,
  sync streams, or triggers; prefer e2e for the full HTTP→emit→DB→`/sync` seam.
- **Web** — vitest + `@testing-library/svelte`; **Playwright** for affordance/role-gating.
- **Mobile** — `flutter test` (Drift repo + convergence tests).

### 0.3 Cross-cutting conventions

- **Migrations** (slices 8–9): fork-only files in `server/src/schema/migrations-gallery/` with
  round timestamps (e.g. `1780000000000`) that don't collide. After schema/repo changes,
  regenerate query SQL (`make sql`) **only against a scratch migrated DB** — never the dev-stack
  DB (wrong schema corrupts search SQL) and never without a running DB (deletes query files).
  Add a `scripts/revert-to-immich.sql` `DROP` entry per new migration.
- **Kysely transactions:** never issue `this.db` queries inside a `transaction()` callback (pool
  deadlock). Use the transaction handle.
- **No Claude co-author trailers** on commits. One commit per fix or per coherent fix-group; the
  slice plan defines exact commit boundaries.
- **Regenerate SDK** if any server DTO/endpoint changes (`make build-sdk` → `make open-api`) so
  web/mobile typecheck.

### 0.4 The reference fix shapes (reused across slices)

Two existing pieces of code are the correct templates the leaky/broken surfaces should copy:

- **`applySuggestionScope`** (`search.repository.ts`) — the template for the album-read
  visibility gate. **Important:** `spaceVisibilityGate(eb, column?)` is a _pure predicate_
  (`visibility IN [Archive,Timeline]`) — it takes **no** `userId`; a caller composes any `own OR gate`
  at the call site. `applySuggestionScope`'s `own OR gate` shape is correct for **filter/facet**
  scoping, but the album **content** read surfaces (search-by-album, timeline bucket, map-markers,
  download) must use a **flat** `spaceVisibilityGate` / `withDefaultVisibility` with **no** owner
  exception: the album grid (`album.repository.ts` `withAssets`→`withDefaultVisibility`) already
  hides the owner's own Hidden/Locked assets, so an `own OR` at these surfaces would let the owner
  see Hidden in map/search/download but not in the grid — an inconsistency. Slices 1–2 add the
  **flat** gate (only the non-album `userIds` search path keeps its existing `own OR`).
- **`LibraryAssetSync`** (`sync.repository.ts`) — the template for a convergent, visibility-gated
  sync stream (gates on the _current_ asset row; restore converges automatically via the `updateId`
  bump, while purge still needs the explicit delete/tombstone arm). Slice 4 makes the link-row
  streams match.

---

## 1. Root causes (why so many findings)

**Root cause A** — `AlbumRead` was widened to "any space member", with no role and no
visibility filter (`access.repository.ts:161-177`, `checkSpaceLinkedAlbumReadAccess`). Several
album-scoped read surfaces never received the `spaceVisibilityGate` the direct/library paths got.
→ Slices **1, 2** (and the `addAssets` consequence in slice 6).

**Root cause B** — the #757 visibility-purge side-effects live only in `AssetService.updateAll`,
and the purge streams/tombstones are not visibility-gated at the link level. The single-asset
`PUT /assets/:id` skips the purge; the link-row streams re-add hidden assets after restore→hide.
→ Slices **3, 4**.

The remaining slices (5–11) close the mobile, RBAC-write, lifecycle, resilience, and low-severity
items that are not pure downstream of A/B.

---

## 2. Dedup map (finding-IDs that collapse to one change)

| Finding ID      | Canonical fix                        | Reason                                                            |
| --------------- | ------------------------------------ | ----------------------------------------------------------------- |
| `rbac-1`        | security-1 + security-3 + security-2 | Review: "consolidated view of security-1/2/3."                    |
| `correctness-2` | security-4                           | Review: "= security-4. Same code, correctness framing."           |
| `albums-1`      | security-4                           | Review: "= security-4/correctness-2."                             |
| `security-6`    | correctness-1                        | Same two streams + same fix (asset join + `spaceVisibilityGate`). |
| `albums-4`      | correctness-3                        | Review: "overlaps correctness-3."                                 |
| `albums-5`      | rbac-4                               | Review: "overlaps rbac-4."                                        |
| `gaps-1`        | mobile-3                             | Review: mobile-3 is "the full-fidelity version of" gaps-1.        |
| `albums-8`      | rbac-5                               | Already a merged finding (`rbac-5 / albums-8`).                   |

**Refuted, excluded entirely:** `gaps-2`, `gaps-3`, `correctness-5 / gaps-6`.

---

## 3. Slice overview

Ordered high→low so `impl-loop` can stop after any slice with a coherent safety win.

| #   | Slice                                            | Sev     | Deduped findings                                                    | Package(s)                   |
| --- | ------------------------------------------------ | ------- | ------------------------------------------------------------------- | ---------------------------- |
| 1   | Album-read visibility gate — HIGH leaks          | HIGH    | security-1, security-3                                              | server + e2e                 |
| 2   | Album-read visibility gate — remaining surfaces  | MED→LOW | security-2, C1, security-8, rbac-7, rbac-8                          | server + e2e                 |
| 3   | #757 purge bypass — asset.service                | HIGH    | security-4 (=corr-2=albums-1), correctness-6, correctness-8, gaps-5 | server + e2e                 |
| 4   | #757 purge bypass — link-row streams             | HIGH    | correctness-1 (=security-6), security-7                             | server (medium) + e2e        |
| 5   | Mobile sync safety                               | HIGH    | mobile-1, mobile-2                                                  | mobile + e2e                 |
| 6   | RBAC escalation + destructive visibility         | HIGH    | rbac-2, rbac-3                                                      | server + e2e                 |
| 7   | Album-link ownership controls                    | MED     | rbac-6, rbac-5/albums-8, C4                                         | server + web                 |
| 8   | Album trash lifecycle (migrations)               | MED     | correctness-3 (=albums-4), albums-2, albums-3, albums-9             | server (migrations) + medium |
| 9   | Membership/creator lifecycle                     | MED     | rbac-4 (=albums-5), albums-6, correctness-4                         | server (migrations) + medium |
| 10  | Mobile hygiene                                   | MED→LOW | mobile-3 (=gaps-1), mobile-4, mobile-5, mobile-6                    | mobile                       |
| 11  | Low correctness/UX + resilience + investigations | MED→LOW | C2, albums-7, correctness-7, gaps-7, C3, C5, C6, security-9         | server + web                 |

**Stop points:** after **slice 6** all HIGH + both escalations are closed; after **slice 9** all
MEDIUM is done; slices 10–11 are the tail.

---

## Slice 1 — Album-read visibility gate: HIGH metadata leaks

**Closes:** security-1, security-3 (and the rbac-1 framing).

**Problem.** Album read surfaces return the owner's Hidden assets (full EXIF/GPS/thumbhash) to any
space member (even a Viewer), because the album read arm lacks the `spaceVisibilityGate` the
direct/library paths have. Bytes stay blocked, but metadata leaks — defeating #754.

- **security-1** — `POST /search/metadata {albumIds:[linked], visibility:hidden|default}`:
  `albumSharedSpaceScope` (`utils/database.ts:609-648,709`) first OR-branch admits any album asset
  with no visibility gate; top-level default visibility (`not-locked`) includes Hidden.
- **security-3** — `GET /timeline/bucket?albumId=<linked>&visibility=hidden`: `timeBucketChecks`
  (`timeline.service.ts:122-146`) rejects Hidden/Locked only for `spaceId`/`spacePersonId`, not
  `albumId`; the repo `albumId` arm (`asset.repository.ts:293-299,1341-1371`) is a bare
  `album_asset` EXISTS with no owner/space gate.

**Fix.** (Use a **flat** `spaceVisibilityGate` — no owner exception — to stay consistent with the
album grid; see §0.4.)

- `albumSharedSpaceScope` (`utils/database.ts`): AND the first OR-branch (the plain-album branch)
  with a flat `spaceVisibilityGate(eb)`, excluding Hidden/Locked album assets for everyone via the
  album path. The non-album `userIds` search path keeps its own `own OR gate` and is unchanged — an
  owner still finds their Hidden assets through a non-album search.
- `timeBucketChecks` (`timeline.service.ts`): include `dto.albumId` in the private-visibility
  (Hidden/Locked) rejection — mirror the existing `spaceId`/`spacePersonId` guard so
  `albumId + visibility=hidden` is refused before it reaches the repo.
- Repo `albumId` arm (`asset.repository.ts`): add a flat `spaceVisibilityGate` so an explicit
  `visibility=Hidden` can't bypass the top-level `withDefaultVisibility` (which only fires when the
  request's `visibility` is undefined).

**TDD — write first (red), then implement (green):**

- **e2e (API), required negatives** (`e2e/src/specs/server/api/`):
  1. Space owner uploads asset A, sets A Hidden, links album containing A into a space. A Viewer
     member `POST /search/metadata {albumIds:[album]}` (default visibility) → **A absent**;
     and with `{visibility:hidden}` → **A absent** / 403-empty. A non-hidden sibling → present.
  2. Same setup: Viewer `GET /timeline/bucket?albumId=<album>&visibility=hidden` → **no A id,
     no thumbhash, no city/country, no lat/lon**. `visibility=default` (timeline) sibling → present.
- **Medium** (`search`/`timeline` repository specs against testcontainers DB): assert the SQL
  predicate excludes Hidden/Locked album assets for **both** non-owner and owner on the album path
  (flat gate), while the non-album `userIds` search path still returns the owner's Hidden assets.
- **Unit:** `timeBucketChecks` returns the elevated-permission requirement when `albumId` +
  private visibility is requested by a non-owner.

**Edge cases (each an explicit assertion):**

- **Owner** requesting their own Hidden assets **via the album path** does **not** see them — this
  matches the album grid (`withDefaultVisibility`), which already hides the owner's Hidden/Locked.
  (The owner still finds them via the non-album `userIds` search path — assert that path is untouched.)
- **Archived** album asset (Timeline vs Archive): visible to members via `spaceVisibilityGate`
  (Archive is shareable) — not accidentally stripped.
- **Locked** album asset: never present (Locked assets are removed from albums; assert none leak).
- Album linked into **two** spaces: caller who is a member of neither → nothing; member of one → gated.
- `albumIds` **combined with** `personId`/other scopes: the gate still applies (no bypass via a
  second scope arm).
- Direct (non-album) space path unchanged — regression assert it still works.

**Green:** all negatives return no Hidden metadata; owner/positive paths unaffected; existing
search/timeline suites stay green.

---

## Slice 2 — Album-read visibility gate: remaining surfaces

**Closes:** security-2, C1, security-8, rbac-7, rbac-8.

Same gate pattern as slice 1, applied to the lower-severity sibling surfaces. Independent of slice
1 (different files) but shares the test harness.

**Fixes:**

- **security-2 (MED)** — `getAlbumMapMarkers` (`map.repository.ts:76-81,174-193`) joins
  `album_asset → asset_exif` with **no** visibility filter at all (the only genuinely ungated album
  content-read surface — the sibling `getMapMarkers` is gated). Apply a **flat** `spaceVisibilityGate`
  (no owner exception, consistent with the grid) so **no one** gets lat/lon + city/state/country of
  Hidden/Locked album assets via this endpoint.
- **C1 (MED, net-new) — fix at the ACCESS layer, not the SQL gate.** `GET /activities?albumId=<space-linked>`
  object-gates on `AlbumRead` (`activity.service.ts:21`), now granted to any space member via
  `checkSpaceLinkedAlbumReadAccess` — the whole historical comment thread + commenter identities +
  like list leaks to non-participant space members. **Patching `activity.repository.search()`'s
  `(… OR asset.id IS NULL)` branch does not work** — album-level comments legitimately have
  `assetId IS NULL` (no asset to gate). Instead, in `activity.service` deny (or strip) activity when
  `AlbumRead` was granted **only** via the space-linked arm (caller is not owner / shared-viewer /
  album participant). Asset-level activity on _visible_ assets is unaffected.
- **security-8 (LOW, PII shape — not a visibility leak)** — `GET /albums/:id`
  (`album.service.ts:99-118`, `mapAlbum`) returns participant id/name/profileImage/role to
  non-participant space members (email already redacted). `getLinkedAlbums` correctly omits
  `albumUsers`. Fix: for space-derived `AlbumRead`, strip `albumUsers` down to the owner's display
  name (match `getLinkedAlbums`).
- **rbac-7 (LOW) — a deny-only fix that WIDENS access, NOT a leak.** `PersonRead` shared-space arm
  (`access.repository.ts:697-727`) uses `visibility = Timeline` equality, which is _stricter_ than
  `spaceVisibilityGate`. A person appearing only on **Archived** space assets shows in the grid but
  is _denied_ `PersonRead` (rep-face picker/thumbnail 403). The fix **widens** to Timeline+Archive
  (`IN spaceVisibleAssetVisibilities`) to match what the grid shows — it grants _more_ and never
  admits Hidden/Locked. Keep it framed as a deny-fix so it isn't lumped with the leak-closing gates.
- **rbac-8 (LOW) — resolved as NO CHANGE (documented).** `downloadAlbumId`
  (`download.repository.ts:28-34`) already applies a flat `spaceVisibilityGate`, so the owner's
  album-archive export omits their own Hidden rows. Adding an `own OR` exception would let the owner
  _download_ Hidden while the grid _hides_ it — an inconsistency. The current flat gate **matches the
  album grid** (`withDefaultVisibility`). Correct resolution: **leave it as-is**, add a one-line
  comment, and pin the behavior with a regression test. (No functional change.)

**TDD — write first:**

- **e2e negatives:**
  - `GET /albums/:id/map-markers` on a space-linked album → **no coordinates** for Hidden/Locked
    assets, for **both** a Viewer member **and** the owner (flat gate, consistent with the grid).
  - Non-participant space member `GET /activities?albumId=<space-linked>` → **no album-level
    comments, no commenter identities**; an owner / shared-viewer / album participant still sees them;
    asset-level activity on a _visible_ asset is unaffected.
  - Non-participant space member `GET /albums/:id` → `albumUsers` reduced to owner display name
    (no other participant ids/roles/profile images); a participant sees the full list.
- **Medium/unit:** `PersonRead` **granted** for a person on Archived-only space assets (rbac-7
  widening); `getPersonsBySpaceId` regression stays gated (no Hidden/Locked). `downloadAlbumId`
  regression test pins the no-change behavior (owner's Hidden omitted, matching the grid).

**Edge cases:**

- Asset-level comments (`assetId` set) on a **visible** asset still returned (don't over-deny C1).
- Album participant who is _also_ a space member: still sees participants/activity (participant
  path wins over space-derived stripping).
- `getLinkedAlbums` output unchanged (already correct — regression only).
- Owner album download **omits** their own Hidden (matches the grid — rbac-8 no-change); **Locked**
  can't be in an album; motion parts still download (unchanged).

---

## Slice 3 — #757 purge bypass: asset.service transition path

**Closes:** security-4 (=correctness-2=albums-1), correctness-6, correctness-8, gaps-5.

**Problem.** All visibility-transition side-effects (`removeAssetsFromAll` on Locked;
`emitDirect/Album/LibraryAssetVisibilityPurge/Restore`) live **only** in `AssetService.updateAll`.
The single-asset `PUT /assets/:id` (`update()`, `asset.service.ts:222-253`) writes visibility
straight through → no tombstones (member devices keep hidden/locked bytes forever) and leaves
Locked assets in albums.

**Fixes:**

- **security-4** — extract the transition block (`asset.service.ts:308-343`) into a private helper
  (`applyVisibilityTransitionSideEffects(prev, next, assetIds)` or similar); call it from **both**
  `updateAll()` and `update()` when `dto.visibility` is set.
- **correctness-8** — the helper compares **prior** visibility to next and only emits for assets
  actually crossing the shareable boundary (fetch prior visibilities first). Prevents duplicate
  tombstones on re-hide and O(join-rows) fan-out on no-op re-affirm (e.g. bulk favorite+visibility).
- **correctness-6** — a single Kysely transaction is **infeasible**: the `UPDATE`,
  `removeAssetsFromAll`, and the `emit*` calls each run on a _different_ repository's own `this.db`
  handle, so wrapping them would hit the `this.db`-inside-`transaction()` pool-deadlock (#595); a
  real transaction would need a `trx` executor threaded through five methods across three repos. So
  do **not** wrap. Instead rely on ordering + **idempotent tombstones** (correctness-8 already makes
  re-emit safe) plus a lightweight reconciliation path (or accept that a re-flip re-emits). Document
  the chosen resiliency approach; drop the transaction requirement.
- **gaps-5** — align **album + direct** purge tombstones to be **owner-gated** like library already
  is: add an `asset.ownerId != userId` filter to `emitAlbumAssetVisibilityPurge` (~`:425`), the
  album `getDeletes` arm (`SharedSpaceAlbumToAssetSync`, ~`:1563` — note the library owner-gate at
  `~:1319` is a _different_ arm), and the direct arm. Effect is to stop **over-purge** (owner
  receiving a delete for their own asset), not a byte leak; unblocks the deferred "owner sees own
  hidden" design.
- **Additional bypass writer (confirmed by review of `metadata.service.ts`)** — the motion-photo
  path writes visibility directly via `assetRepository.update`/`create` and skips the space purge:
  hiding an unlinked motion video (Timeline→Hidden, ~~`:891-894`) and motion assets _created_ Hidden
  (~~`:849-861`). A motion video in a space-linked library going Hidden would therefore never be
  tombstoned. Route these through the same helper (or emit the purge via the existing `AssetHide`
  event). `classification.service` (Archive↔Timeline) and `trash.repository.restoreAll` do **not**
  cross the shareable boundary and need no change.

**TDD — write first:**

- **e2e (the security-4 proof):** owner links album (with asset A) into a space with a synced
  member; owner `PUT /assets/:A {visibility:hidden}` (single endpoint) → member `/sync` receives
  the **same purge tombstone** as the bulk path; `PUT {visibility:locked}` → A removed from all
  the owner's albums **and** tombstoned. Compare byte-for-byte against `updateAll` output.
- **Medium:** helper emits exactly once per boundary-crossing asset; re-hiding an already-Hidden
  asset emits **zero** new tombstones (correctness-8); owner's own device gets **no** delete for
  album/direct assets (gaps-5).
- **Unit:** `update()` invokes the helper iff `dto.visibility` is present and changed; the
  motion-photo hide path (`metadata.service`) also routes through it. A crash simulated between the
  `UPDATE` and the emits leaves a **recoverable** state — assert the reconciliation/idempotency path
  re-emits the tombstone, not transactional atomicity (correctness-6).

**Edge cases:**

- `PUT` with `visibility` **unchanged** → no emit, no album removal.
- Timeline↔Archive transition (both shareable) → **no** purge (not crossing the shareable
  boundary); only Hidden/Locked cross it.
- Restore (Hidden→Timeline) via single endpoint → emits **restore**, re-adds to member devices.
- Bulk `updateAll` with mixed visibility + favorite → only boundary-crossers emit (no fan-out).
- Locked transition removes from albums exactly once; re-locking a Locked asset → no-op.
- Motion video in a space-linked library flipped Hidden → purge tombstone emitted (via the
  helper/`AssetHide` event), same as a bulk flip.

---

## Slice 4 — #757 purge bypass: link-row sync streams

**Closes:** correctness-1 (=security-6), security-7.

**Problem.** `SharedSpaceToAssetSync` and `SharedSpaceAlbumToAssetSync` `getUpserts`/`getBackfill`
(`sync.repository.ts:1108-1143,1539-1582`) stream `(space/album, asset)` link rows with **no
visibility gate**, while handlers stream deletes _before_ upserts. Restore bumps the link
`updateId`; a later hide writes a tombstone; on sync the delete drops the link, then the pending
`updateId`-bumped link row **re-adds** it → the hidden asset stays visible permanently. (Same code
also leaks existence/membership metadata — security-6.)

**Fixes:**

- **correctness-1 / security-6** — add an `asset` inner-join + `spaceVisibilityGate` to **both**
  link-row streams' `getUpserts` and `getBackfill` (mirror `LibraryAssetSync`, which gates on the
  current asset row and converges).
- **security-7** — the library purge arm (`sync.repository.ts:1308-1321`) is gated only by
  `asset.ownerId != userId`; a user who is both the owner's partner **and** a space member gets the
  purge tombstone and drops an asset their partner entitlement still covers. Add
  `AND NOT EXISTS partner(sharedById=asset.ownerId, sharedWithId=userId)` to the library purge arm.

**TDD — write first (medium is the right layer here — real DB + real SyncService):**

- **Medium — convergence:** owner restores then hides asset A within one sync window (two flips,
  no race). Member's simulated client applies the stream in order (deletes before upserts) →
  final state has A **absent**. Assert the link row is not re-added by a stale `updateId`.
- **Medium — metadata:** a member's backfill/upserts for a space/album containing a Hidden asset
  do **not** include that asset's link row (security-6).
- **Medium — partner (security-7):** user P is owner O's partner **and** a member of a space where
  O hides an asset A that P can also see via partner-sharing → P does **not** receive a purge that
  drops A.
- **e2e (seam):** HTTP hide → emit → real DB → HTTP `/sync` returns a convergent stream for a member.

**Edge cases:**

- Album linked into two spaces; asset hidden → gated in both stream instances.
- Asset restored after purge → link row re-appears (restore path still works post-gate).
- Backfill checkpoint after a purge does **not** re-deliver tombstoned ids.
- Non-partner, non-owner member: library purge still drops the asset (don't over-preserve).
- Owner's own stream unaffected (owner sees own — but note gaps-5 owner-gate from slice 3 governs
  the delete direction; assert consistency with slice 3's decision).

---

## Slice 5 — Mobile sync safety

**Closes:** mobile-1, mobile-2. Both cause silent, near-total failures for real users.

**mobile-1 (HIGH) — version skew total sync outage.** The 5 new `SharedSpaceAlbum*` request types
are added to the `/sync/stream` body **unconditionally** (`sync_api.repository.dart:74-127`),
unlike semver-gated types (`assetOcrV1`). An older server's `z.enum` (`sync.dto.ts:717-722`)
rejects unknown values → 400 for the whole request → client throws before any event → **total sync
outage** on app-ahead-of-server (releases are independent).

- **Fix (client):** gate the 5 request types behind a `serverVersion >= SemVer(...)` check,
  mirroring the collection-if pattern (`sync_api.repository.dart:77`, `assetOcrV1`). **The version
  constant must be the fork-server version that shipped the Phase-2B `SharedSpaceAlbum*` request-type
  enum values** — determine it in the slice plan (fork-version-gate precedent exists at
  `sync_stream.service.dart:142`, `> 2.7.5`); do **not** copy `3.0.0` from the OCR gate.
  `serverVersion` comes from the server version endpoint.
- **Fix (server, defense-in-depth):** make the server **filter** unknown request types instead of
  rejecting the whole request (so future skew degrades gracefully). Decide during the slice plan
  whether to ship both; the client gate is mandatory, the server filter is strongly recommended.

**mobile-2 (HIGH) — library sweep deletes album-reachable assets.** `deleteLibrariesV1`'s sweep
(`sync_stream.repository.dart:795-817`) preserves owner/partner/`shared_space_asset` (direct) but
**not** `shared_space_album_asset`. Unlinking a library while an asset is also in a linked album
deletes the shared `remote_asset` row → the asset vanishes from album detail + space timeline. This
is the exact "swap a library link for curated album links" workflow the feature encourages.

- **Fix:** add `AND id NOT IN (SELECT asset_id FROM shared_space_album_asset_entity)` (and the
  adjacent pre-existing gap `remote_album_asset_entity`) to the sweep keep-set.

**TDD — write first:**

- **Mobile (`flutter test`):**
  - `sync_api.repository` builds the request body **without** the 5 types when `serverVersion` is
    below the gate, **with** them at/above it (mock server version both sides).
  - `deleteLibrariesV1` sweep with an asset in both a library and a linked album → asset
    **retained**; asset only in the removed library → deleted.
- **Server e2e/unit (for the filter):** posting an unknown request type to `/sync/stream` on the
  new server → other known types still stream (no 400) if the filter is shipped.

**Edge cases:**

- `serverVersion` exactly equal to the gate boundary → included.
- Missing/unparseable `serverVersion` → treat as old (exclude the 5 types; fail safe).
- Asset in a library + `remote_album_asset` (classic album) → retained (the pre-existing gap).
- Asset in the removed library only, also Hidden → still deleted (no accidental retention).
- Sweep with empty album set → behaves as before (no regression).

---

## Slice 6 — RBAC escalation + destructive visibility

**Closes:** rbac-2, rbac-3.

**rbac-2 (HIGH) — read→re-share→write escalation.** `addAssets` (`shared-space.service.ts:571-576`)
gates `dto.assetIds` on **`AssetRead`**, whose space arm now includes the album branch. A Viewer of
a space linking album X reads X's assets, re-adds them as **direct** assets into a space they own,
then holds `AssetUpdate` over the owner's assets via `checkSpaceEditAccess`. Album-add requires
`AssetShare`; the space path is strictly weaker.

- **Fix:** require `Permission.AssetShare` (owner ∪ partner) on `dto.assetIds` in `addAssets`.

**rbac-3 (HIGH) — Editor flips other members' visibility, fleet-wide destructive.**
`AssetUpdate = owner ∪ checkSpaceEditAccess` (editor/owner over other members' **direct + library**
assets — the library arm is the biggest surface). `visibility` is on the **bulk**
`AssetBulkUpdateBaseSchema` and `livePhotoVideoId` is on the **single-asset** `UpdateAssetSchema`
(`asset.dto.ts`), both with no owner-only restriction. An Editor sets another member's Timeline asset
→ Locked: `removeAssetsFromAll` strips it from all the owner's albums and #757 tombstones it off
every device.

- **Fix — patch BOTH write paths:** `updateAll()` (bulk, `visibility`) **and** `update()` (single,
  `visibility` **and** `livePhotoVideoId`). There is no existing per-asset split — `updateAll` does
  one all-or-nothing `AssetUpdate` check — so compute the **owned** subset explicitly via an
  owner-scoped `checkAccess` (the primitive behind `AssetDelete`/`checkOwnerAccess`; a library-backed
  asset owned by another user is correctly **not** owned). Reject (or strip) `visibility`/
  `livePhotoVideoId` on non-owned ids. **Critically, the split must run BEFORE** `removeAssetsFromAll`
  - the purge emits (`updateAll` ~`:313-343`) — otherwise the destructive cascade fires before the
    guard and the guard is cosmetic. Chosen mechanism: **split the id-set**, not a new permission.
- **Scope note (decision surfaced):** the same `AssetUpdate` gate also lets a space editor write
  non-owned metadata via `upsertBulkMetadata`/`upsertMetadata`/`deleteMetadataByKey`/
  `deleteBulkMetadata`. Whether to also restrict those to owned ids is a scope call — **default here
  is visibility + livePhotoVideoId only** (the review's rbac-3), leaving general metadata-edit as the
  documented, pinned space-editor capability. Flip if you want all structural writes owner-only.

**TDD — write first:**

- **e2e:**
  - Viewer of a space linking album X `POST /shared-spaces/:own/assets {assetIds:[X-asset]}` → **403**
    (was allowed). Owner/partner adding their own assets → still 200.
  - Space Editor `PUT /assets {ids:[other-member-asset], visibility:locked}` (bulk) → **rejected**
    for the non-owned id; the asset stays in the owner's albums, **no** tombstone emitted (assert the
    cascade did not fire). Same via the **single** `PUT /assets/:id {visibility}` and
    `{livePhotoVideoId}` on a non-owned id → rejected.
  - Editor editing a **non-visibility** field on the same asset → behaves per existing policy.
- **Unit:** `addAssets` calls the access check with `AssetShare` not `AssetRead`; the owner-subset
  split partitions owned vs space-edit ids; a **library-backed** non-owned asset is treated as
  non-owned.

**Edge cases:**

- Mixed bulk (`ids` = some owned + some others) with `visibility` set → only owned ids get the
  visibility change; others rejected/skipped deterministically (define which, assert it).
- Owner flipping their own assets → unchanged.
- Partner-shared asset add via `addAssets` → allowed (AssetShare includes partner).
- `livePhotoVideoId` (single-asset path only) mutation on non-owned id → same restriction as visibility.
- Editor editing owned-by-editor asset visibility → allowed.

---

## Slice 7 — Album-link ownership controls

**Closes:** rbac-6, rbac-5/albums-8, C4.

**rbac-6 (MED) — owner can't see or revoke space links; any editor can re-share.** `linkAlbum`
needs only space-Editor + `AlbumUpdate` (owner ∪ album-editor), so an album **editor** can link the
owner's album into any space they edit. **No album-side API exposes the link**, and `unlinkAlbum`
needs current-space Editor membership — so an owner not in the space can't discover or undo it.

- **Fix (chosen policy — keep editor-can-link, add owner control):**
  1. Expose space links on the album response (`album.dto`/`album.service`) — **owner-visible**
     list of `{spaceId, spaceName, linkedById, showInTimeline}`.
  2. Let the **album owner** call `unlinkAlbum` **without** space membership (add an owner arm to
     the unlink access check).
  3. (Minimum) the owner can always see + undo; requiring ownership-to-link is **not** adopted
     (would break the intended editor-curates flow).

**rbac-5 / albums-8 (LOW) — `checkSpaceEditAccess` omits the album arm (deny-only asymmetry).**
Intentional and pinned by `shared-space-album-scope.guard.spec.ts:165-169` (albums never grant
metadata-edit). Residual is only the mixed-bulk UX inconsistency.

- **Fix:** **web only** — hide edit affordances for album-path assets in the space UI (no server
  change). If not hidden, document the 400-on-mixed-bulk behavior.

**TDD — write first:**

- **e2e:** album owner (not a space member) `GET /albums/:id` → sees the space-link list; then
  `DELETE`/unlink the space-album link → succeeds; a non-owner non-space-member → 403. Editor
  linking the owner's album still works (unchanged).
- **Web (Playwright/vitest):** album detail shows linked-spaces to the owner; album-path assets in
  the space view don't render an edit affordance for a space Editor.
- **Web (Playwright, C4):** a space **Viewer** cannot see or trigger link / unlink / unshare / edit
  affordances on space-album controls (server already enforces this — these are the missing
  perceived-authorization/UX assertions the review flagged). Assert the controls are absent for a
  Viewer and present for an Editor/Owner.

**Edge cases:**

- Album linked into multiple spaces → owner sees all links, can unlink each independently.
- Owner **is** a space Editor → both paths work (no double-grant weirdness).
- Unlink by owner does not remove the album from the owner's account (only the space link).
- `showInTimeline` state surfaced correctly per link.
- Non-owner album editor cannot see the link list of an album whose owner they aren't (only the
  owner sees links) — or define the exact visibility policy and assert it.

---

## Slice 8 — Album trash lifecycle (migrations + triggers)

**Closes:** correctness-3 (=albums-4), albums-2, albums-3, albums-9.

Migration- and trigger-heavy. **Scope note:** individual albums are _hard_-deleted; album
**soft-delete only occurs in the user-deletion window** (`user-admin.service.ts` trashes/restores a
user's albums via `softDeleteAll`/`restoreAll` = an `UPDATE deletedAt`). So this slice is really the
_user-delete/restore_ window, not a per-album trash flow — scope the trigger to that transition;
don't invent a per-album trash UI.

**correctness-3 / albums-4 (MED) — soft-delete emits no sync deletes.** Album soft-delete is an
`UPDATE`; grant/audit triggers fire on `DELETE`, none on album `UPDATE`. Members keep the album +
assets until the delayed hard delete (days later); web hides it immediately.
`SharedSpaceAlbumLinkSync.getUpserts` also lacks a `deletedAt` filter.

- **Fix (two distinct pieces, both required):** (a) a new statement trigger
  `AFTER UPDATE OF "deletedAt" ON album` (join `old ⋈ new` on `id`, act only on real NULL↔NOT-NULL
  transitions, since a batch `UPDATE` can carry unchanged rows) that on soft-delete tombstones the
  grants (`shared_space_album_user_audit`) and on restore re-creates them — this piece also carries
  albums-2/albums-3. **AND** (b) add `album.deletedAt IS NULL` to `SharedSpaceAlbumLinkSync.getUpserts`
  (+ a link tombstone / `shared_space_album.updateId` bump on soft-delete) — it is
  `accessibleSpaces`-scoped and **not** grant-driven, so the trigger in (a) does **not** stop it
  streaming a soft-deleted album's link row. Both are needed to hide the album on mobile immediately.

**albums-2 (MED) — grant over-revocation during trash window is irreversible.**
`user_has_album_path` branches 2/3 require `album.deletedAt IS NULL`. A gated delete-side event
during the trash window sees no path → deletes the grant. **No trigger fires on restore** → grant
never re-created → permanently empty album on mobile.

- **Fix:** on album restore, backfill missing `shared_space_album_user` rows (statement trigger on
  `album UPDATE OF deletedAt`, fresh `createId`).

**albums-3 (MED) — backfill permanently skips grants created during the trash window.**
`getCreatedAfter` filters grants through `accessibleSpaceAlbums` (excludes soft-deleted); the
checkpoint advances past a hidden grant's `createId` → after restore it's excluded forever.

- **Fix:** drop the `accessibleSpaceAlbums` filter from `getCreatedAfter` (mirror upstream
  `AlbumSync`), **or** touch grant `createId`s on album restore (the albums-2 restore trigger can do
  both). Prefer the restore-trigger approach if it also fixes albums-2 in one migration.

**albums-9 (LOW) — re-link after unlink reuses old grant `createId`.** `ON CONFLICT DO NOTHING`
keeps the original `createId`; a client past that checkpoint gets no backfill and misses assets
added while unlinked.

- **Fix:** `ON CONFLICT (userId, albumId) DO UPDATE SET createId = immich_uuid_v7(), createdAt = now()`.

**TDD — write first (medium: real DB + triggers + SyncService):**

- **Medium:** soft-delete an owner's trashed album → member `/sync` receives a **link tombstone**
  and grant-delete audit (member's mobile drops it immediately, matching web).
- **Medium:** trash then **restore** an album → grants **re-created** with fresh `createId`; member
  backfill re-delivers the album + all its assets (assert non-empty).
- **Medium:** grant created **during** a trash window, then restore → grant appears in
  `getCreatedAfter` for a client past the old checkpoint (albums-3).
- **Medium:** unlink then re-link an album a client retained another path to → assets added while
  unlinked are delivered after re-link (albums-9).
- **`make sql` regen** for changed decorated queries (scratch DB); add `revert-to-immich.sql` entries.

**Edge cases:**

- Album in **two** spaces, one unlinked during another's trash window → grant survives via the
  other path (no spurious delete), and restore doesn't double-create.
- Restore of an album whose owner is still trashed vs owner restored — define behavior.
- Hard delete after soft delete still emits the final delete (don't double-tombstone).
- `deletedAt` filter on `SharedSpaceAlbumLinkSync` doesn't hide **live** albums.
- Fresh `createId` on re-link doesn't resurrect a legitimately-revoked grant (only when a path
  actually exists).

---

## Slice 9 — Membership / creator lifecycle

**Closes:** rbac-4 (=albums-5), albums-6, correctness-4.

**rbac-4 / albums-5 (MED) — removed creator keeps full sync forever.**
`accessibleSpaces = createdById UNION member` scopes **all** space sync streams; the `createdById`
arm is never revoked. A promoted co-Owner can `removeMember` the creator (no last-owner guard);
REST then denies them but sync keeps delivering. `user_has_album_path` branch 3 also preserves
their grants.

- **Fix (chosen — both parts, or the split-brain persists):** (a) **forbid removing/demoting the
  space creator's membership** (guard in `removeMember`/role-change), **and** (b) drop reliance on the
  immutable `createdById` arm in `accessibleSpaces` (the creator is always inserted as an Owner
  member, so membership alone suffices). Doing only (a) leaves the `createdById` read-path; doing only
  (b) still lets a co-Owner strip the creator's grants while `getCreatedAfter` (keyed on the member
  `createId`) can never re-backfill them — the two paths contradict unless both are fixed. Emit
  member-scoped delete tombstones if any removal path remains reachable.

**albums-6 (MED) — a member's own album stays linked after they leave, unrevokable by them.**
`removeMember` does nothing to `shared_space_album` rows the departing member added; `unlinkAlbum`
needs current-space Editor membership, so the ex-member can't unlink. Remaining members keep read
(and editors keep write) on the album, including future assets.

- **Fix:** on removal/leave, delete `shared_space_album` where `addedById = removed user AND user
owns the album` (or add the owner-side unlink from slice 7 as the recourse — cross-reference).

**correctness-4 (MED) — TOCTOU race in gated grant-revocation triggers.**
`user_has_album_path(...)` is `STABLE LANGUAGE SQL`; under READ COMMITTED it evaluates against the
query snapshot, so a delete-side gate and a concurrent create-side grant INSERT aren't serialized →
grant survives with no delete emitted. Same race in the library path.

- **Fix (broader than a one-liner — weigh against the reconciliation-job alternative):** the lock
  **cannot** go in `user_has_album_path` (SQL + STABLE = no side effects); it goes in the calling
  **plpgsql** triggers. These are `FOR EACH STATEMENT` triggers over transition tables spanning many
  `(albumId, userId)` pairs, so take a **per-pair** `pg_advisory_xact_lock` in a pre-loop iterating
  the pairs in a **deterministic `ORDER BY`** (else two multi-pair statements deadlock), keyed via a
  64-bit `hashtextextended(albumId::text || userId::text, 0)`. The **same** lock must also be taken
  on the **create-side** triggers (grant INSERT) and the new **restore** trigger — locking only the
  delete side does not close the race. Given the complexity, a periodic **reconciliation job**
  (sweep grants vs. live paths) is a legitimate lower-risk alternative; pick one in the slice plan
  and justify. Advisory-lock collisions are benign.

**TDD — write first (medium):**

- **Medium:** attempt to `removeMember` the creator → **rejected**; demote creator → rejected.
- **Medium:** ex-member's own linked album is unlinked on their removal → remaining members lose
  access; the album's future assets don't reach them.
- **Medium — race:** simulate two concurrent transactions (T1 unlink from S1, T2 remove member from
  S2 for an album in both) → exactly one audit/delete emitted; grant does **not** survive; a
  `SharedSpaceAlbumDeleteV1` reaches the device. (Use two DB connections / explicit `BEGIN`s to
  force the interleaving.)
- Regen SQL + `revert-to-immich.sql` entries for any new migration.

**Edge cases:**

- Space with a single owner (the creator) → creator-removal guard doesn't brick legitimate
  space deletion (deleting the space is still allowed; only removing the creator's membership is
  blocked).
- Member who is **not** the album owner leaving → their added links to albums they don't own are
  handled per policy (don't delete someone else's album's link incorrectly).
- Advisory-lock hash collisions are benign (lock is advisory; correctness preserved).
- Library path race covered symmetrically.

---

## Slice 10 — Mobile hygiene

**Closes:** mobile-3 (=gaps-1), mobile-4, mobile-5, mobile-6.

**mobile-3 / gaps-1 (MED) — no client-side GC of orphaned `remote_asset`/`remote_exif`.**
Revocation handlers delete only join rows; `pruneAssets` is disabled and space-unaware. After a
purge/unlink/revocation, the member's Drift DB retains `remote_asset` (filename, checksum,
thumbhash) + `remote_exif` (GPS, city, camera) **forever** — defeating the purge's privacy goal.

- **Fix:** ship a **space-aware `pruneAssets`**: keep-set = owned ∪ partner ∪ `remote_album_asset`
  ∪ `shared_space_asset` ∪ granted `shared_space_album_asset` ∪ library-reachable. Run on
  `syncCompleteV1`. Evict cached thumbnail **bytes** for pruned assets (verify byte eviction, not
  just row deletion — flagged unverified in the review).

**mobile-4 (MED) — `SyncResetV1` doesn't clear the new tables.** `reset()`
(`sync_stream.repository.dart:52-93`) deletes 17 tables but none of the fork space tables (runs
under `foreign_keys=OFF`). A stale `shared_space_album_asset` + link row joined to a re-synced
`remote_asset` wrongly places assets in space timelines after a reset.

- **Fix:** add `sharedSpaceAlbumAsset/Link/Album` (and the older `sharedSpace*`, `library`)
  entities to the `reset()` deleteAll list.

**mobile-5 (LOW) — album membership stream not visibility-gated → inflated counts.** Membership
stream ungated while the asset stream is gated → member gets membership rows for assets Hidden at
link/backfill time but never the asset rows → "42 photos" on the shelf, 37 in detail.

- **Fix (chosen — client-side, safer for checkpoint semantics):** count via a `remote_asset` **join**
  applying the detail view's full predicate (`deletedAt IS NULL` **and** `visibility IN
(timeline, archive)` after mobile-6) rather than counting membership rows directly — otherwise the
  badge still overstates the visible count.

**mobile-6 (LOW) — space queries filter `visibility == timeline`, hiding Archived.** The server
streams Timeline **and** Archive to non-owners; mobile stores archived assets but the space queries
require `visibility == timeline` → archived space/album assets show on web, absent on mobile.

- **Fix:** change the predicate to `visibility IN (timeline, archive)` for the space/space-album
  queries only — **6 predicate sites** in `timeline.repository.dart` (not 5): `_watchSharedSpaceBucket`
  (**both** the `groupBy==none` and `groupBy!=none` branches), `_getSharedSpaceBucketAssets`,
  `_watchSpaceAlbumBucket` (**both** branches), `_getSpaceAlbumBucketAssets`. Missing any one leaves
  that surface dropping archived-but-shared assets.

**TDD — write first (`flutter test`):**

- Drift repo test: after a revocation/purge handler + `pruneAssets`, orphaned `remote_asset`/
  `remote_exif` for a no-longer-reachable asset are **gone**; a still-reachable-via-album asset is
  **kept**.
- `reset()` deletes all three new space tables (assert row counts 0 post-reset).
- Shelf count equals detail count when some membership rows lack visible asset rows (mobile-5).
- Space/album query returns Archived assets (mobile-6); non-space queries unchanged.

**Edge cases:**

- Asset reachable via **multiple** paths (album + direct) → pruned only when **all** paths gone.
- `pruneAssets` never deletes owned/partner assets.
- Thumbnail byte cache eviction verified (or explicitly deferred with a follow-up note if the
  cache layer can't be driven from a unit test).
- `reset()` under `foreign_keys=OFF` doesn't error on the added tables.
- mobile-6 predicate change doesn't leak Hidden (only timeline+archive, never hidden/locked); assert
  **all 6** sites changed (a single missed `==timeline` re-hides archived assets on that surface).
- Full album delete (`deleteAlbumMetadata`) currently leaves orphan `shared_space_album_link_entity`
  rows (masked by the shelf `innerJoin`) — low severity; the fixed `reset()` clears them and the
  server should emit `SharedSpaceAlbumLinkDeleteV1` per link. Note it; fix only if cheap.

---

## Slice 11 — Low correctness / UX / resilience + investigations

**Closes:** C2, albums-7, correctness-7, gaps-7, C3, C5, C6, security-9.

Mixed low-severity fixes plus three explicit **investigation** items that must resolve to either a
proven-safe regression test or a fix.

**C2 (MED) — face-people projection `@OnEvent` handlers swallow all errors.**
`onAlbumAssetsAdd/Remove`, `onAssetDelete`, `onAlbumDelete` (`shared-space.service.ts:2793-2900`)
wrap the whole body in try/catch that only logs → a transient failure leaves space person counts +
face projections permanently diverged, no retry.

- **Fix:** make the handlers idempotently re-drivable and add a reconciliation/backfill path (or a
  dead-letter/retry); don't silently swallow. **Test:** a simulated transient `queueAll`/DB failure
  followed by reconciliation converges the projection; unit test asserts the handler is re-runnable
  without double-counting.

**albums-7 (LOW) — space card metrics diverge from the timeline.**
`getAssetCount`/`getNewAssetCount`/`getRecentAssets` include the album arm **without** the
`showInTimeline` gate; `getLastAssetAddedAt`/`getLastContributor` query only `shared_space_asset`.

- **Fix:** add `shared_space_album.showInTimeline = true` to the three count/preview arms; add
  album/library arms to the recency queries. **Test (medium):** counts/badges match the actual
  timeline for a space with off-timeline album links and album/library-driven recency.

**correctness-7 (LOW) — `revert-to-immich.sql` final guard omits new tables.**
The `DROP` section drops the six album/purge-audit tables, but the closing `fork_tables_left`
guard IN-list wasn't extended (also missing `shared_space_face_match_backfill_target`).

- **Fix:** add the six `shared_space_album*` / `*_asset_audit` tables (+ the face-match backfill
  target) to the final `pg_tables` IN-list. **Test:** a script/lint check (or a medium test) that
  every fork table dropped in the script appears in the guard list.

**gaps-7 (LOW) — member-join trigger fan-out unbounded on large spaces.**
Joining a space inserts a grant per (member × album) and bumps `album.updateId` for every linked
album; `shared_space_album_user` is indexed only `(userId, createId)`.

- **Fix:** add a composite `(albumId, id)` index on the album-asset audit tables; avoid
  re-notifying existing members on join if measurement shows it's needed. **Do the measurement**
  (log/EXPLAIN at target scale) and record the result; add the index regardless as it's cheap.

**C3 (LOW, investigation) — `getSpaceActivities` payload contents unaudited.**
Returns raw activity `data` JSON + actor name/email/profile to any member with no per-role/per-path
filter. **Investigate** each `SharedSpaceActivityType`'s `data` blob for ids a member shouldn't
see; add a redaction + a test if a leak is found, else a regression test documenting it's safe.

**C5 (LOW, investigation) — trash + stack (album path) unreviewed.**
Only direct/library arms were swept for trash/stack behavior. **Investigate** whether a stacked
child or trashed album asset over/under-surfaces for members; add regression tests (and a fix if a
leak/loss is found).

**C6 (LOW, investigation) — partner × space-linked albums/libraries unresolved.**
`accessibleLibraries` unions partner + space paths; the combined outcome for a user who is both
partner and space member (esp. Hidden assets partner-sharing exposes but the space gate strips) was
never traced. **Investigate** end-to-end; add a test pinning the resolved behavior (cross-reference
security-7's partner handling in slice 4).

**security-9 (LOW, hardening) — raw string path params reach `asUuid` → 500 instead of 400.**
Non-UUID input on shared-space routes (`shared-space.controller.ts:167,209-210,363,410-412`) causes
Postgres `22P02` → 500. Note: **these routes pre-exist at merge-base** (the albums branch only added
already-validated routes), so this is pre-existing hardening, not a feature regression — included
because it's cheap and in-file.

- **Fix:** apply zod param DTOs (like `SharedSpaceAlbumParamDto`) to the cited pre-existing routes.
  **Test:** e2e/unit — a non-UUID param returns **400**, not 500.

**TDD — write first:** each item above names its test. The three investigations (C3/C5/C6) are
**not** done until they produce a committed test (proving safe) or a fix + test.

**Edge cases:** enumerated per item inline above; the investigations must each end with an explicit
"resolved: safe / fixed" note and a test, not an open question.

---

## 4. Global acceptance criteria

- Every deduped finding in §3 is closed by a slice, with red→green TDD evidence and edge-case tests.
- All three refuted findings remain **out of scope** (documented, not implemented).
- Full suites green per touched package: `cd server && pnpm test` + `pnpm test:medium`; `cd web &&
pnpm test` + Playwright where affordances changed; `cd e2e && pnpm test`; `cd mobile && flutter test`.
- Type/lint gates: `make check-server`, `make check-web`, `make lint-*` (zero warnings where
  enforced). SDK regenerated if DTOs changed.
- New migrations apply cleanly on a fresh DB and interleave (unordered) on an
  already-migrated DB; `revert-to-immich.sql` extended (correctness-7) and its guard verified.
- The 10 e2e gaps from the review are covered by the negatives assigned to slices 1–9. In
  particular **gaps-4**'s residual "seam" gap (HTTP update → `emit*` → real DB → HTTP `/sync`) is
  closed by slice 4's seam e2e; the only acknowledged remaining gap is **on-device** mobile
  convergence (inherently manual — no emulator pass in scope), which slice 10's Drift/convergence
  tests approximate.

## 5. Explicitly out of scope

- The 3 refuted findings: `gaps-2`, `gaps-3`, `correctness-5 / gaps-6`.
- Any behavior change beyond closing a listed finding (no unrelated refactors).
- The deferred "owner sees own hidden content" **feature** (slice 3's gaps-5 only _unblocks_ it by
  making tombstones owner-gated; it does not build the feature).
