# Space-Albums Remediation — Follow-up Design Spec (2026-07-09)

> **Purpose.** Fix the findings from `SPACE-ALBUMS-REMEDIATION-REVIEW-2026-07-08.md` (the second,
> adversarial review of PR #759) using **test-driven development**, structured so the **critical,
> fix-before-merge** issues are in **Phase 1** (execute now) and the **minor/deferred** issues are in
> **Phase 2** (execute later). Phase 1 is self-contained: PR #759 can ship to production after Phase 1
> alone, with Phase 2 tracked as follow-up.

---

## 0. Meta

- **Source of findings:** `SPACE-ALBUMS-REMEDIATION-REVIEW-2026-07-08.md` (repo root). 48 confirmed
  findings → **40 canonical issues** after dedup; 1 refuted (`R1`). The review's own headline names
  **H1, M1, M2, M11** as fix-before-production. Phase 1 adopts that set **plus M5** (the
  commenter-email PII leak, promoted by decision — see §0.4). **M10 is intentionally out of scope** —
  see §4.
- **Base branch / where these land:** PR #759 (`fix/space-albums-remediation`, base
  `space-albums-onto-main`, HEAD `3dfabc41ca`). **Default: add the Phase-1 commits to the _same_
  branch/PR** so #759 ships production-ready. (Alternative: stack a
  `fix/space-albums-remediation-followup` branch off the tip if you want to merge #759 first and
  follow up — Pierre's call. Phase 2 can be a separate follow-up PR either way.)
- **Line numbers** in this spec are HEAD-relative (`3dfabc41ca`) and were re-confirmed against the
  worktree during authoring. Every slice plan **must still re-confirm** exact lines/symbols before
  editing — treat references as navigation hints.
- **Terminal state of this spec:** feed to `impl-loop`. **For now, run Phase-1 slices only
  (Slices 1–5).** Phase 2 (Slices 6–12) is fully specified but explicitly deferred; do not start it
  until Phase 1 is merged unless the remaining promotion flag (§0.4, M3) moves an item forward.

### 0.1 TDD is mandatory for every fix

Every fix in every slice follows this loop, and each slice plan must show the evidence:

1. **Red** — write the test(s) that encode the desired behavior (leak blocked / write denied /
   convergence reached / 400-not-500). Run them; capture the exact command and the expected failure
   output. A test that passes on first run is a red flag — it isn't exercising the bug.
2. **Green** — make the minimal change to pass. Capture the green command + output.
3. **Refactor** — clean up (extract helpers, dedupe) with tests staying green.

No slice is "done" without red evidence, green evidence, and a final full-suite validation for the
touched package(s). **The review flagged (G/L19/M13) that several existing tests pass _vacuously_** —
so for every negative test, first prove the _positive control_ (the leak/write actually happens
without the fix), then assert the fix blocks it. A negative with no positive control is not accepted.

### 0.2 Test layers (per package)

- **Server** — vitest **unit** (`newTestService()` auto-mocks), vitest **medium** (`test:medium`,
  real Postgres via testcontainers + real `SyncService`/`SyncRepository`), and **e2e** (`e2e/` API
  vitest). Prefer medium/e2e for anything touching SQL predicates, access checks, sync streams, or
  triggers; prefer e2e for the full HTTP→emit→DB→`/sync` seam.
- **Web** — vitest + `@testing-library/svelte`; **Playwright** for affordance/role-gating.
- **Mobile** — `flutter test` (Drift repo + convergence tests). Regenerate l10n/keys first per
  AGENTS.md before running mobile tests.

### 0.3 Cross-cutting conventions

- **Migrations** (Phase-2 Slice 10's M12 migration-file fix — no Phase-1 slice ships a migration):
  fork-only files in `server/src/schema/migrations-gallery/` with round timestamps that don't collide
  (existing tips: `1782000000000`, `1782100000000`, `1782300000000` — use e.g. `1783000000000`+).
  After schema/repo changes, regenerate query SQL (`make sql`) **only against a scratch migrated DB** —
  never the dev-stack DB and never without a running DB (deletes query files). Add a
  `revert-to-immich.sql` `DROP` entry **and** a step-9 guard-list entry per new table (L11 makes this
  checkable).
- **Kysely transactions:** never issue `this.db` queries inside a `transaction()` callback (pool
  deadlock, #595). Thread the `trx` handle.
- **Access-layer fixes route through the service/access layer, not raw SQL, where the review says so**
  (M2, M5, M11): the review is explicit that some of these must be fixed at the access/serialization
  layer, not by patching a shared SQL predicate that other callers depend on.
- **Regenerate SDK** if any server DTO/endpoint changes (`make build-sdk` → `make open-api`) so
  web/mobile typecheck.
- **No Claude co-author trailers** on commits. One commit per fix or per coherent fix-group.

### 0.4 Critical vs. deferred — the split (the core of this restructure)

| Phase                     | Slices | Findings                | Rationale                                                                                                                                                                                                                                 |
| ------------------------- | ------ | ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1 — CRITICAL (do now)** | 1–5    | **H1, M1, M2, M11, M5** | The review's fix-before-production set (one HIGH metadata leak, two person/faces security gaps, a security-adjacent activity-injection/500 regression) **plus M5** (commenter-email PII leak). All server-side, all with clear negatives. |
| **2 — DEFERRED (later)**  | 6–12   | all remaining M/L/I     | Purge-convergence hardening, async-lifecycle durability, mobile parity, migration/self-declaration hygiene, product/UX, and test hardening. Real but not merge-blocking; grouped by root cause per the review's §4.                       |

**Remaining promotion flag (Pierre's call).** M5 was promoted into Phase 1 by decision. One privacy
MEDIUM is still deferred **by default** and can be promoted if desired:

- **M3** (Slice 7) — the #757 visibility-purge is not retry-convergent (a failed request cannot be
  healed by retry → member devices keep hidden bytes). A privacy-convergence hole, but a **larger
  change** (transition-ordering rework across three call sites), so it stays in Phase 2 unless you pull
  it forward. The fix text and tests are identical wherever it runs.

---

## 1. Root causes (Phase-1 relevant)

- **Root cause A — album-granted read scope is missing a `deletedAt` filter and never scoped the
  person/faces/activity surfaces.** `AlbumRead` is granted to any space member
  (`checkSpaceLinkedAlbumReadAccess`); the flat `spaceVisibilityGate` reached the album _content_
  surfaces, but (a) trashed assets are not excluded when the caller controls trash params, (b) the
  person/faces read + representative-face write were never scoped, and (c) asset-level album activity
  still serializes commenter emails to space-only readers. → **H1, M1, M2, M5** (Slices 1–3, 5).
- **Root cause F — a regression from the rbac-6 owner-recourse fix.** The new `unlinkAlbum` owner arm
  authorizes on album ownership only and never checks the album is linked to the space, so it injects
  activity into arbitrary spaces and 500s on a bad `spaceId`. → **M11** (Slice 4).

---

# PHASE 1 — CRITICAL (fix before merging PR #759)

Ordered by severity/blast-radius. Each slice is independently testable; `impl-loop` can stop after any
slice with a coherent safety win. After **Slice 5** every code-level production blocker is closed.
All Phase-1 slices are **server/e2e only** — no web, mobile, or migration changes.

---

## Slice 1 — H1: Trashed album assets leak to space members (HIGH)

**Closes:** H1 (primary + secondary).

**Problem (verified).** Album-granted read scope applies `spaceVisibilityGate` (visibility ∈
{Timeline, Archive}) but has **no `deletedAt` predicate**, and the caller controls the trash filters.

- **Primary (HIGH), search.** `POST /search/metadata` with `albumIds` performs only an `AlbumRead`
  check (granted to any space **Viewer**) and leaves `userIds` unset → the album arm
  (`albumSharedSpaceScope`, `utils/database.ts:609`) runs. Its plain-album branch (`:612-624`) gates
  visibility (`spaceVisibilityGate(eb)` at `:617`) but **not `deletedAt`**. Any of
  `withDeleted`/`trashedAfter`/`trashedBefore`/`isOffline` flips `withDeleted` on (`database.ts:659`),
  which skips the top-level `asset.deletedAt IS NULL` filter (`database.ts:833`). A Viewer calling
  `{ albumIds:[A], withDeleted:true, withExif:true, withPeople:true }` receives full
  `AssetResponseDto`s (id, checksum, originalPath, thumbhash, EXIF incl. GPS, people names) for every
  asset the owner **trashed** out of that album, for the whole trash-retention window — directly
  defeating the #757 tombstoning this branch just built.
- **Secondary (MEDIUM), timeline.** `GET /timeline/buckets|bucket?albumId=A&isTrashed=true` —
  `timeBucketChecks` (`timeline.service.ts:133`) blocks `visibility=hidden/locked` for a space browse
  but not `isTrashed`; the album arm in `withTimeBucketAssetFilters` (`asset.repository.ts:295`, plus
  the inline copies in `getTimeBucket`/`getTimeBucketCovers`) sets no `userId` and has no `deletedAt`
  gate → a member enumerates trashed-asset ids, thumbhashes, coordinates, timestamps (metadata-level;
  binary fetch stays denied).

**Fix (spec-ready).**

1. Add `asset.deletedAt IS NULL` **inside `albumSharedSpaceScope`** (`database.ts`, the plain-album
   `eb.and([...])` branch at `:612-624`, alongside the existing `spaceVisibilityGate(eb)`).
   Parameter-independent — closes both the default and every trash-param path for search. **This is the
   load-bearing fix.**
2. Add `asset.deletedAt IS NULL` to the `albumId` arm of `withTimeBucketAssetFilters`
   (`asset.repository.ts:295`) **and** the inline copies in `getTimeBucket`/`getTimeBucketCovers` — OR
   extend the `spaceBrowse` guard in `timeBucketChecks` to reject `isTrashed=true` whenever
   `albumId`/`spaceId`/`spacePersonId` is set (mirror the existing `visibility=locked → 401` guard).
   Prefer the repo-arm `deletedAt` filter (closes the leak at the data layer regardless of the guard);
   add the `timeBucketChecks` rejection as belt-and-suspenders.
3. **Defense in depth (optional):** in `searchMetadata`, reject
   `withDeleted`/`trashedAfter`/`trashedBefore`/`isOffline` when `albumIds` is the sole access grant
   (mirror the existing `withSharedSpaces` guards).

**Consistency note.** H1's change is purely _additive_ (`deletedAt IS NULL`). Phase-2 Slice 6 (L2) may
later _replace_ the whole plain-album anti-join with a flat gate — that refactor **must preserve the
`deletedAt IS NULL` filter this slice adds**. Called out in both slice plans.

**TDD — write first (red → green):**

- **e2e (required negatives, `e2e/src/specs/server/api/`):** owner uploads asset A into album X, links
  X into a space, trashes A (still `album_asset` member, `deletedAt` set), syncs a Viewer.
  - Viewer `POST /search/metadata { albumIds:[X], withDeleted:true, withExif:true, withPeople:true }`
    → **A absent** (no id, checksum, originalPath, thumbhash, EXIF, people). A non-trashed sibling →
    present (positive control).
  - Viewer `GET /timeline/bucket?albumId=X&isTrashed=true` → **no A id / thumbhash / coords /
    timestamp**. Mirror the existing `albumId+visibility=locked → 401` pin.
  - **Positive control first:** before trashing, assert the Viewer _does_ see A via the same calls, so
    the negative isn't vacuous.
- **Medium (search/timeline repository specs):** the SQL predicate for the album path excludes
  soft-deleted assets for **both** non-owner and owner (flat gate + `deletedAt`), while the non-album
  `userIds` search path is unchanged.
- **Unit:** `timeBucketChecks` returns the elevated-permission requirement (or rejects) when `albumId`
  - `isTrashed=true` is requested.

**Edge cases (each an explicit assertion):**

| Edge case                                                | Expected                                                                                                                                       |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `withDeleted:false` / no trash params (default)          | Unaffected — trashed already excluded by `:833`; assert still excluded after fix (no regression).                                              |
| Owner requesting their own trashed album asset via album | **Absent** (matches the flat, no-owner-exception album grid). Owner still finds it via the non-album `userIds` search path — assert untouched. |
| `trashedBefore`/`trashedAfter` range that matches A      | A still absent (the `deletedAt IS NULL` gate wins over the range predicate).                                                                   |
| Album linked into two spaces; caller in neither          | Nothing; member of one → gated + no trashed.                                                                                                   |
| `albumIds` combined with `personIds`                     | No bypass via the person arm — trashed still excluded.                                                                                         |
| Non-album direct/space search path                       | Regression-assert unchanged.                                                                                                                   |

**Green:** all negatives return no trashed metadata; owner/positive paths and existing search/timeline
suites stay green.

---

## Slice 2 — M1: `GET /people/:id/faces` leaks faces on hidden/never-shared assets (MEDIUM, security)

**Closes:** M1.

**Problem (verified).** `PersonRead` is deliberately widened to space members (rbac-7), gated
correctly at the _grant_. But `getFacesForPicker` (`person.service.ts:322`) then calls
`getRepresentativeFaces` (`person.repository.ts:427`), which filters only `asset_face.deletedAt`,
`isVisible`, `asset.deletedAt`, `asset.isOffline` — **no visibility predicate, no ownership/space-path
scoping** (`:445-451`). A space Viewer paging `GET /people/<id>/faces` receives every face row
(assetId, bounding box, dimensions, fileCreatedAt) for that person across the owner's **entire
library**, including Hidden/Locked and never-shared assets. **Worse:** the join expands through
`face_identity_face → person.identityId` (`:434-440`, no owner column), so a member also receives face
rows for assets owned by **every user** whose person is linked into the same identity. Pixels stay
blocked (`getFaceThumbnail` re-checks `AssetRead` at `:358`), so this is a metadata/existence
disclosure; the person id is discoverable from any shared photo.

**Fix (spec-ready).** In `getFacesForPicker`, distinguish **owner vs. space-granted** caller (mirror
`requireThumbnailAccess`'s owner-vs-space split). Owner keeps the full list. For a non-owner:

- Add an optional `scope` to `RepresentativeFaceListOptions` (e.g.
  `{ memberUserId: string; spaceIds: string[] }`), and in `getRepresentativeFaces` apply, **inside the
  identity-expanded join** (not just the `personId` branch, so identity fan-out is also scoped):
  - `spaceVisibilityGate(eb)` on `asset`, **and**
  - `eb.or(spaceAssetPathBranches(eb, { correlateAssetId: 'asset.id', correlateLibraryId: 'asset.libraryId', scope: { spaceIds } }))`
    so only faces on assets reachable via the caller's space paths are returned.
- Resolve the caller's accessible `spaceIds` the same way the person-read space arm does (the set the
  `PersonRead` grant was derived from), so the scope matches what already authorized the call.

`getFaceThumbnail` needs no change (already `AssetRead`-gated per face).

**TDD — write first:**

- **e2e/medium negatives:** owner has person P appearing on (a) a shared space-album asset, (b) a
  Hidden asset, (c) a never-shared asset; a second user U2 shares the same identity with a face on
  U2's own asset. Sync a space **Viewer**.
  - Viewer `GET /people/P/faces` → returns **only** the face(s) on the space-reachable, visible asset
    (a); **absent:** the Hidden (b), never-shared (c), and cross-user (U2) faces.
  - **Owner** `GET /people/P/faces` → **full** list (positive control the scope only applies to
    non-owners).
- **Unit:** `getFacesForPicker` passes the `scope` to the repo for a non-owner and omits it for the
  owner; the repo query with `scope` excludes non-reachable/hidden/cross-identity faces.

**Edge cases:**

| Edge case                                      | Expected                                                              |
| ---------------------------------------------- | --------------------------------------------------------------------- |
| Owner caller                                   | Full unscoped list (no behavior change).                              |
| Non-owner, person only on Hidden/Locked assets | Empty page (no rows), not a 500.                                      |
| Identity fan-out to another user's assets      | Cross-user faces excluded (scope applied inside the identity branch). |
| Archived (shareable) space asset face          | **Included** (Archive passes `spaceVisibilityGate`).                  |
| Pagination (`page`/`size`) with the scope      | `hasNextPage` reflects the _scoped_ row count, not the raw count.     |
| `getFaceThumbnail` on an excluded face         | Still `AssetRead`-denied (unchanged).                                 |

---

## Slice 3 — M2: Space Viewer can mutate the owner's person cover (MEDIUM, security)

**Closes:** M2.

**Problem (verified).** `updateRepresentativeFace` (`person.service.ts:367`, controller
`person.controller.ts:184`) gates only on `Permission.PersonRead` (`:375`) — whose space arm has **no
role filter**, so a role=**viewer** member qualifies. It then writes `person.faceAssetId` on the
**owner's** person row (`:386`) and, when `identityId` is set, the **identity-level** representative
face (`:387-392`), and queues `PersonGenerateThumbnail` — changing the owner's global People-page cover
for everyone. **Internal contradiction:** the space-side sibling `updateSpacePersonRepresentativeFace`
requires `SharedSpaceRole.Editor` and touches only the space-person profile row; `access.ts:322`'s own
comment says person mutations stay owner-only.

**Fix (spec-ready) — policy decided: Owner ∪ Editor.** Keep `PersonRead` for reachability, then
**additionally** require the caller be the **owner** OR an **Editor/Owner** of a space the person is
shared through. Concretely: after the `PersonRead` check, require `checkOwnerAccess` on the person
**OR** a role-filtered shared-space predicate (add a `role IN (owner, editor)` filter to the
`shared_space_member` join used by the `memberUserId` person scope). A **Viewer is denied.** This
matches how album writes use the Owner/Editor `checkSpaceLinkedAlbumAccess`.

**TDD — write first:**

- **e2e negatives:** owner's person P shared into a space.
  - Space **Viewer** `PUT /people/P/representative-face { assetFaceId }` → **403**; assert
    `person.faceAssetId` unchanged and **no** `PersonGenerateThumbnail` queued.
  - Space **Editor** → **allowed** (positive control the gate admits editors).
  - **Owner** → allowed (unchanged).
- **Unit:** the guard denies a viewer-role member and admits an editor-role member; the `AssetRead`
  check on the chosen face still runs after the role gate.

**Edge cases:**

| Edge case                                                          | Expected                                                        |
| ------------------------------------------------------------------ | --------------------------------------------------------------- |
| Viewer with `PersonRead` but not owner/editor                      | **Denied** (the bug).                                           |
| Editor of a space the person is shared through                     | **Allowed** (decided policy).                                   |
| `identityId` set — identity-level rep face                         | Same gate governs the identity write (not just the person row). |
| Chosen face not reachable by caller                                | Still `AssetRead`-denied (unchanged, runs after the role gate). |
| Owner editing their own person                                     | Allowed, unchanged.                                             |
| Space-person profile write (`updateSpacePersonRepresentativeFace`) | Unchanged — already Editor-gated; assert no regression.         |

---

## Slice 4 — M11: `unlinkAlbum` owner path injects activity into arbitrary spaces + 500s (MEDIUM, security-adjacent)

**Closes:** M11. **Regression introduced by the rbac-6 fix.**

**Problem (verified).** `unlinkAlbum` (`shared-space.service.ts:697`, controller
`shared-space.controller.ts:605`) short-circuits for space Editors; the **owner arm** (`:703-708`)
authorizes on album ownership only (`checkAccess(AlbumDelete)`) and never verifies the album is
actually linked to `spaceId` or that the caller has any relationship to the space. `removeAlbum`
(`:712`) is a silent no-op when no link matches, but `logActivity` (`:713-718`) **unconditionally**
inserts a `SharedSpaceActivityType.AlbumUnlink` row into the target space's member-visible feed. Two
failures:

1. **Activity injection** — a removed ex-member (or anyone with a leaked space UUID) repeatedly calls
   `DELETE /shared-spaces/{spaceId}/albums/{theirOwnAlbumId}` and spams attacker-chosen `albumName`
   strings into that space's feed.
2. **500** — a well-formed but nonexistent `spaceId` passes the owner check and the bare INSERT
   violates the `shared_space_activity.spaceId` FK → Postgres 23503 → HTTP 500.

Before this remediation the Editor-role requirement made both impossible. Blast radius also includes
benign face-cleanup/reconcile churn against the victim space (`:719-726`).

**Fix (spec-ready).** In the non-editor (owner) path, first check `hasAlbumLink(spaceId, albumId)`
(exists at `shared-space.repository.ts:705`) — **or** make `removeAlbum` return the deleted count — and
**return early** (404 for a nonexistent/unlinked space, or a no-op 200) when no link exists, **before**
`logActivity`, the orphaned-face cleanup, and the grant reconcile. The Editor short-circuit is
unchanged (an Editor is a member of an existing space, so the FK is always satisfied and the link is
theirs to curate).

**TDD — write first:**

- **e2e negatives:**
  - Album owner (non-member) `DELETE /shared-spaces/{unlinkedButRealSpace}/albums/{ownAlbum}` → no
    `AlbumUnlink` activity created (assert the feed count unchanged); response is 404/no-op per the
    chosen convention.
  - Album owner `DELETE /shared-spaces/{nonexistentUuid}/albums/{ownAlbum}` → **404, not 500** (assert
    no unhandled 23503).
  - **Positive controls:** owner unlinking a genuinely linked album → succeeds, activity logged once;
    Editor unlinking → unchanged.
- **Unit:** the owner arm calls `hasAlbumLink` and returns early before `logActivity` when unlinked.

**Edge cases:**

| Edge case                                    | Expected                                                                              |
| -------------------------------------------- | ------------------------------------------------------------------------------------- |
| Owner, album genuinely linked                | Unlink succeeds; exactly one `AlbumUnlink` activity; reconcile/face-cleanup run once. |
| Owner, album not linked to this (real) space | No-op; no activity, no cleanup, no reconcile.                                         |
| Nonexistent `spaceId`                        | 404; no FK 500.                                                                       |
| Non-UUID `spaceId`/`albumId`                 | 400 (param DTO — already handled; regression-assert).                                 |
| Editor path                                  | Unchanged short-circuit.                                                              |
| Repeated calls (spam attempt)                | Each is a clean no-op; feed never grows.                                              |

---

## Slice 5 — M5: Asset-level album activity leaks commenter emails to space-only readers (MEDIUM, PII)

**Closes:** M5. **Promoted into Phase 1 by decision** — a live PII leak one endpoint over from the
already-shipped `security-8` redaction.

**Problem (verified against the review).** The C1 fix (shipped in the first remediation) filters out
album-**level** activity for space-only readers but **keeps asset-level activity**, serialized via
`mapActivity → mapUser`, which includes the **full email + name** of every commenter/liker
(`activity.service.ts:39`, `getAll`). A space Viewer (not an album participant) calling
`GET /activities?albumId=A` receives PII the sibling `security-8` fix just stripped from `albumUsers`.
The shipped C1 e2e pins that asset-level entries _are_ returned but asserts nothing about the user
payload.

**Fix (spec-ready) — access/serialization layer, not SQL.** In `getAll`, when `!hasDirectAccess`
(space-only reader), redact `user.email` to `''` (matching `security-8`) — **redact after `mapUser`**
so the `avatarColor` email-fallback still computes — or restrict the serialized payload to
id/name/profileImagePath. Asset-level activity on _visible_ assets is still returned; only the PII
fields are stripped for space-only readers.

**TDD — write first:**

- **e2e:** extend the existing C1 activity e2e — a space **Viewer** (non-participant)
  `GET /activities?albumId=A` on a visible asset with a comment → assert `body[i].user.email === ''`
  (and name/profile per the chosen redaction) for every returned entry; an album **participant** →
  full email/name (positive control). Include a like and a comment (both go through `mapUser`).
- **Unit:** `mapActivity`/`getAll` redacts the user payload iff `!hasDirectAccess`.

**Edge cases:**

| Edge case                                                 | Expected                                                                  |
| --------------------------------------------------------- | ------------------------------------------------------------------------- |
| Album participant who is _also_ a space member            | Full email/name (participant/direct-access path wins).                    |
| `avatarColor` derived from email                          | Still computes (redact after `mapUser`, not before).                      |
| Album-level activity (assetId null) for space-only reader | Already excluded by C1 — regression-assert unchanged.                     |
| Owner / shared-viewer                                     | Full payload (direct access).                                             |
| Related: `getStatistics` counts (I2)                      | Out of scope here — tracked in Phase-2 Slice 6 (aggregate integers only). |

---

# PHASE 2 — DEFERRED (execute after Phase 1 lands)

Fully specified for a later `impl-loop` run. Grouped by root cause (review §4), with the Phase-1 items
removed. **Do not start these until Phase 1 is merged**, unless the §0.4 promotion moves M3 forward.
Each item keeps its review anchor; every fix still follows the §0.1 TDD loop with a positive control.

## Slice 6 — Root cause A residuals: album-read / person / activity minor leaks

**Closes:** L1, L2, L3, I1, I2. _(M5 promoted to Phase-1 Slice 5.)_

- **L1 (LOW)** — `contributorCounts` on `GET /albums/:id` is ungated (`album.service.ts:152`,
  `album.repository.ts:575`): leaks contributor **userIds** and a Hidden-count side channel to
  space-only readers of a shared album. **Fix:** `contributorCounts: isShared && hasDirectAccess ?
... : undefined`, **and** apply `withDefaultVisibility` inside `getContributorCounts`.
- **L2 (LOW)** — `albumSharedSpaceScope` over-restricts album-scoped search (`database.ts:618`):
  library-backed / directly-space-linked album assets the grid shows are silently omitted. **Fix:**
  replace the anti-join with the plain flat gate (`spaceVisibilityGate` + `deletedAt IS NULL`) for
  album-granted scope. **⚠️ Must preserve Slice 1's `deletedAt IS NULL` addition.**
- **L3 (LOW)** — `person.getStatistics` null-identityId path returns library-wide counts to space
  members (`person.service.ts:398-406`, `person.repository.ts:604`). **Fix:** in the null-identityId
  branch, if `auth.user.id !== person.ownerId`, restrict the count to space-reachable assets
  (`spaceAssetPathBranches({ memberUserId })` + gate), mirroring `getAccessiblePersonStatistics`.
- **I1 (INFO)** — filter/exif suggestion `albumId` scope keeps an owner exception
  (`search.repository.ts:1224`), feeding the owner's own Hidden album asset into facets. **Fix:** AND
  the ownerId branch with `spaceVisibilityGate` in the albumId arm only.
- **I2 (INFO)** — `activity.getStatistics` returns album-level comment/like counts to space-only
  readers (`activity.service.ts:48`). **Fix:** mirror `getAll`'s C1 gate, or exclude `assetId IS NULL`
  rows for space-only readers. (Sibling of the Slice-5 M5 fix.)

## Slice 7 — Root cause B: purge convergence

**Closes:** M3, L4, L5.

- **M3 (MED — flagged for promotion, §0.4)** — visibility-purge is not retry-convergent
  (`asset.service.ts:391,441`; `metadata.service.ts:890`): the write commits before the emits, which
  are gated on **prior** visibility, so a failed request's retry sees Hidden-prior → empty purge set →
  silent no-op; member devices keep hidden bytes. **Fix (pick one, fail-closed):** (a) emit purge
  tombstones + run `removeAssetsFromAll` **before** the visibility UPDATE, or (b) drop the
  prior-visibility gate on the **purge** side (emit whenever `next` ∈ {Hidden, Locked}; tombstones are
  idempotent). Apply the same to `metadata.service.ts:890`. Fix the false "recoverable" comment.
  **Test:** medium — force an emit failure mid-transition, retry, assert the member converges.
- **L4 (LOW)** — library-arm hide→restore permanently loses EXIF on member devices
  (`sync.repository.ts:1393`, `asset.service.ts:425`). **Fix:** add `emitLibraryAssetVisibilityRestore`
  bumping `asset_exif.updatedAt` for restored library-linked assets (mirror direct/album restore
  emits).
- **L5 (LOW)** — library sync arm streams the owner's `isFavorite` unmasked (`sync.repository.ts:1295`).
  **Fix:** split `isFavorite` out of `columns.syncAsset` for `LibraryAssetSync.getBackfill/getUpserts`
  and apply the ownership CASE; assert the existing `sync-library-asset.spec.ts:217-251` (unasserted
  today).

## Slice 8 — Root cause C: async lifecycle durability

**Closes:** M6, M7, L6, L7, L8.

- **M6 (MED)** — grant-reconcile job is fire-and-forget (`shared-space.service.ts:1425`;
  `job.repository.ts:490,508`). **Fix:** `removeOnFail:true` on `SharedSpaceAlbumGrantReconcile` +
  `SharedSpaceFaceMatchAll`; make failures re-drivable (nonce'd requeue or a low-frequency cron sweep
  calling `reconcileAlbumGrants` over all linked albums).
- **M7 (MED)** — create-side missing-grant race has no repair; the doc test asserts a false self-heal
  (`shared-space-album-create-triggers.spec.ts:122`, `sync.repository.ts:1466`). **Fix:** make
  `reconcileAlbumGrants` **bidirectional** (INSERT missing grants `ON CONFLICT DO NOTHING`) and enqueue
  from `linkAlbum`/`addMember`; at minimum correct the false RESOLUTION comment.
- **L6 (LOW)** — C2 removal-side reconcile is additive-only; stale `shared_space_person_face` rows
  persist (`shared-space.service.ts:2898,1441`). **Fix:** add a space-path-scoped stale-face sweep to
  the durable reconcile; wrap `cleanupDepartingMemberAlbums` face cleanup in try/catch + enqueue.
- **L7 (LOW)** — member removal not atomic with the departing-member album unlink
  (`shared-space.service.ts:563,583`). **Fix:** wrap the membership delete +
  `removeOwnedAlbumLinksAddedBy` in one repository transaction (thread `trx`); keep face cleanup +
  enqueues outside, re-drivable via L6.
- **L8 (LOW)** — cascade deletion paths fire the raced revocation triggers but never enqueue the
  reconcile (`shared-space.service.ts:1421`). **Fix:** low-frequency scheduled sweep over all albums in
  `shared_space_album_user` (also backstops M6/L7), or enqueue from the user-deletion handler.

## Slice 9 — Root cause D: mobile parity

**Closes:** M4, M8, L12, L13.

- **M4 (MED)** — mobile personal timeline/map/video/place miss the space-**album** arm
  (`viewer_visibility.dart:118`, `merged_asset.drift:60`). **Fix:** add a third arm to
  `viewerVisibilityPredicate`/`buildViewerVisibilityJoins` + `merged_asset.drift`, gating on **both**
  toggles (`shared_space_album_link.show_in_timeline` AND `shared_space_member.show_in_timeline`); add
  entity imports for `.watch()` reactivity; two LEFT JOINs + `isNotNull()` at the six
  `timeline.repository.dart` call sites.
- **M8 (MED)** — rbac-6 owner recourse (view + revoke album space-links) is web-only
  (`AlbumSharedSpaceLinks.svelte`; no mobile consumer). **Fix:** add a "Linked spaces" section to the
  mobile album detail/options sheet for owned albums, fetching `GET /albums/:id` on demand, per-link
  `DELETE /shared-spaces/{spaceId}/albums/{albumId}`.
- **L12 (LOW)** — mobile `sharedSpacePerson` timeline drops archived assets (7th site missed,
  `timeline.repository.dart:971`). **Fix:** `(visibility == timeline | visibility == archive)` at
  `:971` + a repository test.
- **L13 (LOW)** — version gate stays closed on RC/dev servers reporting ≤ 5.0.0
  (`sync_api.repository.dart:114`). **Fix:** validate the branch via a build whose (major,minor,patch)
  strictly exceeds 5.0.0 (e.g. `v5.1.0-rc.0`); fix the misleading gate comment. **L13 and M14 (Slice 10) are the same gate** — coordinate the fix.

## Slice 10 — Root cause E: migration & self-declaration hygiene

**Closes:** M12, M14, L11, L18.

- **M12 (MED)** — `1782000000000` migration's function DDL + `migration_overrides` drift from
  `functions.ts` (`migrations-gallery/1782000000000-...ts:77`) → spurious codegen diffs. **Fix:**
  regenerate both SQL strings byte-identical to
  `asFunctionExpression(album_soft_delete_shared_space_album)` (include the comment lines + `\n  $$;`
  tail, mirror `1782100000000`). Optionally add a unit spec asserting each migrations-gallery override
  literal equals the registered function's expression.
- **M14 (MED)** — the mobile-1 server-side drop-unknown filter was reverted; sync-outage protection
  rests solely on the fragile client version constant (`sync.dto.ts:723`, `sync_api.repository.dart:114`).
  **Fix:** fix the stale mobile comment (`:112-113`); make the release-order assumption enforceable
  (pin the client gate to the actual first-feature-release version at mobile-release time + a
  release-checklist/CI guard); add a Dart guard test that the set of ungated request types equals the
  known-upstream set. Re-landing the server filter was rejected — enforcement is the route.
- **L11 (LOW)** — `revert-to-immich.spec.ts` guard has two blind spots (`:16,34`). **Fix:** derive the
  expected fork-table set from `migrations-gallery` `CREATE TABLE` names (assert each has **both** a
  `DROP TABLE` and a step-9 guard entry); scope the migration-name assertion to the step-8 DELETE
  block.
- **L18 (LOW)** — stale self-declarations: PR #759 body + mobile comment describe reverted defenses
  (`sync_api.repository.dart:112`; PR body). **Fix:** update the PR body (slice 5 → "client version
  gate only; server filter reverted"; slice 3 → "gaps-5 owner-gate on ALBUM + LIBRARY arms only; direct
  arm intentionally ungated"), replace the ⚠️ CI-deferred section with "CI has since validated", correct
  the mobile comment.

## Slice 11 — Root cause F: product / UX completeness

**Closes:** M9, L9, L10, L14, L15, L16, L17.

- **M9 (MED)** — a departing member's **trashed** own album survives departure and re-shares itself on
  restore (`shared-space.repository.ts:596`). **Fix:** drop the `album.deletedAt IS NULL` predicate at
  `:596` (deleting a trashed album's link is safe — grants already revoked by the soft-delete trigger);
  update the `:577-582` comment. **Test:** medium — trash own linked album → leave → restore → album
  does NOT reappear, no grants.
- **L9 (LOW)** — `AlbumSharedSpaceLinks.svelte:17` snapshots links once (`$state` init) → stale list /
  wrong-target unlink across album navigation. **Fix:** `$derived(...)` + a `removedSpaceIds` `$state`,
  and/or `{#key album.id}`.
- **L10 (LOW)** — global `/albums/:id` page shows always-failing manage affordances to space-only
  readers (`+page.svelte:725`). **Fix:** gate the set-as-cover MenuOption behind the existing
  `isEditor` derived (not `isOwned`).
- **L14 (LOW)** — album-in-space UI strings hardcoded English (`space-activity-feed.svelte:75`; mobile
  spaces pages). **Fix:** add `i18n/en.json` keys + route web through `$t`; `.tr()` on mobile.
- **L15 (LOW)** — no "link to a space" entry point from the album itself. **Fix:** add a "Link to
  space" option to the album share/context menu (web) + album options sheet (mobile).
- **L16 (LOW)** — auto-unlink on member departure is invisible (`shared-space.service.ts:564`). **Fix:**
  log one `AlbumUnlink` per auto-removed album; extend `spaces_leave_confirmation` (all locales) with
  an "albums you linked will be removed" note.
- **L17 (LOW)** — space shelf cards show a "broken asset" tile when the album cover is not
  space-visible (`shared-space.repository.ts:608`). **Fix:** in `getLinkedAlbums`, substitute the cover
  per-viewer (COALESCE only when it passes the flat gate + `deletedAt IS NULL`, else newest
  space-visible album asset, else NoCover).

## Slice 12 — Root cause G: test hardening (+ R1 cleanup)

**Closes:** M13, L19; R1 dead-code note.

- **M13 (MED)** — motion-photo hide/show purge is pinned only by mock-called unit tests
  (`asset.service.spec.ts:980`; `metadata.service.spec.ts`). **Fix:** add one medium test (pattern of
  `sync-space-visibility-purge-cross-path.spec.ts`): seed a space-linked library with a Timeline motion
  video, sync+ack a member, emit the real `AssetHide` event, assert the member's next `/sync` carries
  the library-arm delete tombstone; mirror with `AssetShow`.
- **L19 (LOW)** — four soft-spot assertions: `testq-2` (vacuous `assetCount===0`,
  `shared-space-visibility-negatives.e2e-spec.ts:605` — assert no resurrection after PUT back to
  timeline); `testq-4` (member person-filter path untested, `search.service.spec.ts:626` — re-add a
  member-actor forced-empty test); `testq-5` (map-marker negative lacks a positive control, `:481`);
  `testq-6` (creator remove/demote guard is unit-only + fail-open happy path,
  `shared-space.service.spec.ts:2033` — add two e2e negatives; consider making the guard fail-closed).
- **R1 cleanup (not a bug)** — remove/assert the dead `Locked` entry in `visibilityOrder` and the
  `Hidden` fallback in `getSyncMergeResult` (`duplicate.service.ts:307-311`); optionally route the
  keeper's visibility write through the shared transition helper to close the narrow TOCTOU.

---

## 3. Global acceptance criteria

### Phase 1 (merge gate for PR #759)

- **H1, M1, M2, M11, M5 closed** with red→green TDD evidence and a positive control for every negative.
- Full suites green per touched package: `cd server && pnpm test` + `pnpm test:medium`; `cd e2e &&
pnpm test`. (Slices 1–5 are server/e2e only — no web/mobile/migration change in Phase 1.)
- Type/lint gates: `make check-server`, `make lint-server` (zero warnings). SDK regenerated only if a
  DTO changed (none expected in Phase 1 — verify M2's controller signature is unchanged).

### Phase 2 (follow-up gate)

- Every deferred finding in Slices 6–12 closed by a slice with TDD evidence.
- Web suites + Playwright (Slices 9, 11) and `flutter test` (Slices 9, incl. L12) green where touched.
- New migrations (Slice 10) apply + revert cleanly; L11's guard makes the revert list self-checking.
- The remaining promotion flag (M3) is closed here or, if promoted, in Phase 1.

## 4. Explicitly out of scope

- **M10 (removed-creator sync split-brain on already-deployed DBs) — de-scoped by decision.** A
  co-Owner who removed/demoted the space creator _before_ this branch's guard shipped leaves that
  ex-creator syncing the space forever on already-deployed DBs (the immutable `createdById` arm in
  `accessibleSpaces`, `shared-space-album-scope.ts:90`, is never revoked). The prospective guard (HEAD)
  prevents new occurrences; only already-affected RC-fleet DBs are exposed. **Given how few users have
  adopted spaces, this is a low-impact edge case not worth a repair migration.** If it ever matters,
  the fix is the one-off sweep re-inserting the creator as an Owner member (see the review's M10).
- **R1** (duplicate-resolution merge) — refuted; only the dead-code cleanup (Slice 12) is in scope.
- Any behavior change beyond closing a listed finding (no unrelated refactors).
- **On-device** mobile convergence testing (inherently manual — no emulator pass in scope); the Phase-2
  mobile slices approximate it with Drift/convergence unit tests.
- Web realtime for space surfaces (pre-existing fork-wide limitation; not an album-arm regression).
- The Phase-2 backlog is **not** a merge blocker for PR #759 — it ships as a tracked follow-up.
