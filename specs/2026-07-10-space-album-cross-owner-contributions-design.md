# Collaborative Cross-Owner Contributions to Space Albums — Design Spec (2026-07-10)

> **Purpose.** Let any space **Editor** add _any space-visible photo_ — including photos they do
> not own — to a space-linked album, collaboratively, while keeping every contributed photo
> tethered to live space access (it vanishes the instant the contributor's/viewer's space access
> ends or the album is unlinked, and it never becomes a permanent grant the album owner can carry
> out of the space). Fixes issue **#764** as a byproduct.
>
> **Method.** Test-driven, behavior-first. Every slice lists its **BDD scenarios (Given/When/Then)**
> first, turns each into a **failing test (red)**, then implements the minimum to pass (**green**),
> then refactors. Slices are **vertical** and independently implementable via `/impl-loop`.

---

## 0. Meta

- **Base branch:** `feat/space-albums-collab-contrib`, branched off **`origin/space-albums-onto-main`**
  (PR #752 head, tip `8071b039ca`). Ships as a **separate, stacked PR** whose base is the #752
  branch — folded into the space-albums feature set but reviewable on its own.
- **Depends on #752.** Everything here builds on machinery #752 already introduced: the
  `shared_space_album` link, the revocable `shared_space_album_user` grant (auto-removed on leave
  via `shared_space_member_delete_album_audit`), the space-aware `AlbumAssetCreate` case, the
  `shared-space-album-scope.ts` visibility helpers, and the `SharedSpaceAlbum*Sync` streams. **Do
  not** start until #752 is stable.
- **Line numbers** are navigation hints against `8071b039ca`; **every slice re-confirms symbols in
  the worktree before editing** — treat references as navigation, not literal coordinates.
- **Terminal state:** feed to `/impl-loop` slice-by-slice (Slice 0 first; it's independent).

### 0.1 TDD is mandatory for every slice

Each fix follows this loop, and each `/impl-loop` run must show the evidence:

1. **Red** — write the test(s) encoding the BDD scenario (contribution rendered / leak blocked /
   permission denied). Run them; capture the exact command and the expected failure. A test that
   passes on first run is a red flag — it isn't exercising the new behavior.
2. **Green** — minimal change to pass. Capture the green command + output.
3. **Refactor** — extract/dedupe with tests staying green.

No slice is "done" without red evidence, green evidence, and a full-suite validation for the
touched package(s).

### 0.2 Test layers (per package)

- **Server** — vitest **unit** (`newTestService()` auto-mocks deps, `test/utils.ts`), vitest
  **medium** (`test:medium`, real Postgres via testcontainers, real `SyncService`/`SyncRepository`;
  a new repository must be hand-registered in `test/medium.factory.ts`'s `newRealRepository`
  switch), and **e2e** (`e2e/src/specs/server/api/*.e2e-spec.ts`, vitest against a running stack).
  Prefer **medium** for anything touching SQL predicates / sync streams / triggers; **e2e** for the
  full HTTP→emit→DB→`/sync` seam. There is already `e2e/src/specs/server/api/shared-space-album.e2e-spec.ts`
  to extend.
- **Web** — vitest + `@testing-library/svelte` (happy-dom) for unit; **Playwright**
  (`e2e/src/specs/web/`, e.g. `spaces-albums.e2e-spec.ts`) for affordance/role-gating.
- **Mobile** — `flutter test` (Drift repo + convergence). Regenerate l10n/keys first per CLAUDE.md.

### 0.3 Cross-cutting conventions

- **Migrations:** fork-only files in `server/src/schema/migrations-gallery/` with round timestamps
  (e.g. `1783000000000`) that don't collide. Add a `scripts/revert-to-immich.sql` DROP entry per new
  table. After schema/repo changes, regenerate query SQL with `make sql` **only against a scratch
  migrated DB** — never the dev-stack DB, never without a running DB (deletes query files).
- **Kysely transactions:** never issue `this.db` queries inside a `transaction()` callback (pool
  deadlock).
- **BaseService:** if a new repository is added, wire it in **all three** sites — import, constructor,
  and the positional `static create()` list — or plugin-host services get shifted repos.
- **SDK regen:** if any server DTO/endpoint shape changes, `make build-sdk` → `make open-api` so
  web/mobile typecheck.
- **No Claude co-author trailers.** One commit per slice (or per coherent fix-group within a slice).

---

## 1. Problem

Reported in **#764**: a non-admin **Editor** in a shared space creates an album inside the space,
tries to add a photo, and gets a green **"Successful"** toast whose body says **"cannot be added
to the album"** — and the photo is not added. Two distinct defects stacked:

1. **The lying toast.** `web/src/lib/services/album.service.ts` `notifyAddToAlbum` always calls
   `toastManager.primary(...)` (green "Successful") regardless of result counts. The server returns
   **HTTP 200 with per-asset failures**, so the web `catch` never fires and a failure renders as
   success.
2. **The add is genuinely blocked for non-owned assets.** `addAssets` (`server/src/utils/asset.util.ts`)
   gates every asset on `Permission.AssetShare`, which resolves (`server/src/utils/access.ts`) through
   **owner + partner only** — no space path (unlike `AssetRead`/`AssetView`/`AssetDownload` →
   `checkSpaceAccess`, and `AssetUpdate` → `checkSpaceEditAccess`). #752 made the _album-level_
   `AlbumAssetCreate` space-aware, but the _per-asset_ `AssetShare` gate is untouched. So a space
   Editor can add **only their own** photos to a space album; anyone else's photo returns
   `NO_PERMISSION` for every asset.

### 1.1 The trap we must avoid

`AssetShare` is owner-only **by design** — it also gates **public shared links** and **memories**.
Adding `checkSpaceAccess` to the global `AssetShare` case would let any space member mint a public
link of another member's photo. **We must not widen `AssetShare`.** The fix is a narrow,
album-scoped add path.

### 1.2 The new risk collaborative add introduces

The moment Bob can add _Carol's_ photo to _Alice's_ album, Carol's photo sits in an album Alice
**owns**. In upstream Immich, being in an album you own is a **permanent** view grant
(`checkAlbumAccess`). Space _members_ are safe (their album grant is revoked on leave), but the
album **owner** — and any direct `album_user` participant — keeps access forever and can carry it
**out of the space** (unlink the album, add an external album user, mint a public link). Carol only
ever consented to _space_ sharing. Closing this is the reason for a dedicated table (§4).

---

## 2. Goals & non-goals

**Goals**

- A space **Editor** may add any asset **space-visible to them via the album's space** to that
  space-linked album, regardless of who owns the asset.
- Contributed (non-owned) photos are **inert bookmarks**: access is re-derived from live space
  membership + the live album↔space link on every read; they never grant permanent access via
  `checkAlbumAccess`.
- Leaving the space, unlinking the album, deleting the asset, or deleting the space each removes the
  contribution from view (for everyone, including the album owner). Re-joining / re-linking restores it.
- The add-to-album toast tells the truth (success / partial / failure).

**Non-goals (this feature)**

- No change to personal (non-space) albums or normal shared albums.
- No widening of `AssetShare`, shared-link, or memory permissions.
- **Viewers** stay read-only (contribute = Editor+), matching #752's `AlbumAssetCreate` role gate.
- Not solving siblings #763 (favorite for members) / #765 (fix-match no-op), though they share the
  "members can't curate in a space" theme.

---

## 3. The core invariant

> A **cross-owner contribution** is a pointer `(album, asset, space)` that renders for a viewer **iff**
> the album is still linked to that space **and** the viewer is a live member of that space. It is
> never stored in `album_asset`, so `checkAlbumAccess` can never turn it into a permanent grant.

The adder's **own** photos are _not_ contributions — they take the ordinary `album_asset` path
(standard "I shared my photo into a collaborative album"). The new table only ever holds the
"photo I don't own" case.

---

## 4. Data model

New fork table `album_space_asset` (`server/src/schema/tables/album-space-asset.table.ts`) plus its
own delete-audit table `album_space_asset_audit` (drives the sync delete stream), plus a migration.

```
album_space_asset  — a live-gated cross-owner contribution of a space photo into a linked album
────────────────────────────────────────────────────────────────────────────────────
  albumId    FK → album          (PK)   onDelete CASCADE   the collaborative album
  assetId    FK → asset          (PK)   onDelete CASCADE   the contributed photo (owner unchanged)
  spaceId    FK → shared_space          onDelete CASCADE   provenance + tether
  addedById  FK → user (nullable)       onDelete SET NULL  who contributed it (any Editor)
  addedAt    timestamp
  createId / updateId / createdAt / updatedAt              fork sync watermarks (mirror shared_space_asset)
```

- **Not** `album_asset`, **not** `album_user`, **not** an access grant — a bookmark whose validity
  is recomputed on every read.
- `spaceId` disambiguates albums linked to multiple spaces, drives the "from _Space_" affordance,
  and pins add-eligibility (the Editor must be an Editor of _that_ space, and the asset must be
  visible via _that_ space).
- Sync columns because mobile must receive/drop these rows (§7.2).

> **Naming caution.** #752 already ships `shared_space_album_asset_audit` — that audits deletions of
> **normal `album_asset`** membership in linked albums, feeding `SharedSpaceAlbumToAssetSync`. It is
> **unrelated** to this table. Keep `album_space_asset` / `album_space_asset_audit` distinct.

---

## 5. Access, role & visibility model (RBAC)

### 5.0 Role & visibility matrix (the security contract)

Two **independent** role systems: **space** `SharedSpaceRole` = Owner / Editor / Viewer
(`shared_space_member.role`) and **album** `AlbumUserRole` = Owner / Editor / Viewer (`album_user`).

| Operation                                                             | Allowed for                                                                                                                                   | Enforced by                                                                                                                                                |
| --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **View** a contribution (grid / count / timeline / download / search) | any **live member** of the album's linked space — Owner/Editor/**Viewer**                                                                     | read arm joins `shared_space_member` with **no role filter** (mirrors `checkSpaceLinkedAlbumReadAccess`, `access.repository.ts:165`)                       |
| **Contribute** a **non-owned** photo                                  | space **Owner/Editor** of the album's linked space **S**, _and_ the asset is space-visible to them via **S** _and_ passes the visibility gate | album-level `AlbumAssetCreate` (#752 `role IN [owner,editor]`, `access.repository.ts:158` — **throws 403 for Viewers**) **+** per-asset eligibility (§5.1) |
| **Contribute** an **owned** photo                                     | space **Owner/Editor** (album-level gate) → normal `album_asset`                                                                              | `AlbumAssetCreate` + `AssetShare` (owner)                                                                                                                  |
| **Remove** a contribution                                             | album **Owner/Editor** OR live space **Owner/Editor** of S                                                                                    | `AlbumAssetDelete` (#752 made it space-editor-aware) + row delete                                                                                          |
| **Link / unlink** album ↔ space                                       | out of scope (#752)                                                                                                                           | —                                                                                                                                                          |

**Non-bypass rules (assert each as an explicit negative test):**

- **Viewers never write.** A space Viewer is hard-blocked at `AlbumAssetCreate` (403) _before_ any
  per-asset logic runs — they can contribute neither their own nor others' photos.
- **Album role ≠ space rights.** A direct `album_user` **editor** who is **not** a space member
  cannot contribute non-owned space assets (own → `album_asset`; others' → `NO_PERMISSION`). Album
  ownership does **not** bypass the space-Editor requirement for pulling in others' photos.
- **Same space for all three.** Eligibility requires a _single_ space **S** where the album is
  linked to S, the adder is Owner/Editor of S, **and** the asset is space-visible via S. An asset
  visible only via a _different_ space the adder edits is **not** contributable here — no
  cross-space smuggling.

**Visibility gate (critical — a leak vector if missed).** The space-visibility arms
(`spaceAssetPathBranches`) do **not** exclude Hidden/Locked assets on their own — `spaceVisibilityGate`
(`[Archive, Timeline]` only; `shared-space-album-scope.ts:42`) is applied _separately_ at each call
site (this was #752 remediation Slice 1). Therefore:

- **Add:** eligibility MUST `AND` the flat `spaceVisibilityGate` into the visibility check — an Editor
  must never contribute an asset its owner marked **Hidden/Locked** (which the Editor cannot even
  see). No owner exception (contributions are cross-owner by definition).
- **Read:** `spaceContributedAssetExists` MUST be composed with `spaceVisibilityGate(eb, 'asset.visibility')`
  at every read site (like the album arm), so an asset marked Hidden _after_ it was contributed is
  defensively excluded going forward.

### 5.1 Adding (the #764 fix) — `AlbumService.addAssets`

Two-bucket split _inside the album-add path only_ (no change to generic `asset.util.ts` used by
shared-links/memories):

1. Resolve the album's live space link(s) the adder is an **Editor** of:
   `shared_space_album ⋈ shared_space_member(role ∈ {owner, editor})` for `auth.user.id`.
2. Per requested asset, in precedence order:
   - **Owned / AssetShare-eligible** → normal `album_asset` insert (unchanged path).
   - **Not owned, but space-visible to the adder via an eligible space `S`** → insert
     `album_space_asset(album, asset, S, addedById=auth.user.id)`. "Space-visible via S" reuses
     `shared-space-album-scope.ts` `spaceAssetPathBranches` (direct `shared_space_asset` ∪
     linked-library ∪ linked-album arms) scoped to
     `{ memberUserId: auth.user.id, memberRole: [owner, editor], spaceId: S }`, **AND**ed with the
     flat `spaceVisibilityGate` (§5.0) so Hidden/Locked assets are never eligible. The role filter
     ties the contribution to a space **S** where the adder is Owner/Editor.
   - **Already in** `album_asset` _or_ `album_space_asset` → `DUPLICATE`.
   - **Otherwise** → `NO_PERMISSION`.
3. Return a merged `BulkIdResponseDto[]` across both buckets (per-asset outcome preserved).

An asset never lands in both tables (each asset has one owner → one eligible path).

### 5.2 Reading — extend the album visibility arm

Add `spaceContributedAssetExists(eb, { correlateAssetId, scope })` to `shared-space-album-scope.ts`
as a **fourth arm** parallel to `spaceDirectAssetExists` / `spaceLibraryAssetExists` /
`spaceAlbumAssetExists`:

```
EXISTS (
  SELECT 1 FROM album_space_asset asa
  JOIN shared_space_album ssa ON ssa.albumId = asa.albumId AND ssa.spaceId = asa.spaceId   -- link live
  JOIN album a                ON a.id = asa.albumId AND a.deletedAt IS NULL
  [membership scope]          JOIN shared_space_member m ON m.spaceId = asa.spaceId
                                AND m.userId = :viewer  [AND m.role IN (:roles)]
  WHERE asa.assetId = <correlateAssetId>
    [AND asa.spaceId = :scopeSpaceId]
)
```

The membership join uses **any-role** membership (no `memberRole` filter) — Viewers must see
contributions — and every read site **composes it with `spaceVisibilityGate`** (§5.0) exactly as it
already does for the album arm. Because the row is _not_ in `album_asset`, the owner's
`checkAlbumAccess` never sees it → no permanent grant. **Album contents** =
`album_asset ∪ spaceContributedAssetExists(...)`, deduped by `assetId`. Wire into every consumer of
`spaceAlbumAssetExists` / `spaceAssetPathBranches`: album detail/grid, asset count, thumbnail, the
space aggregated timeline (respecting `showInTimeline`), download, activity, in-album search
(Largest surface — Slices 2–3). At each site, confirm the visibility gate is present for the new arm
— do not replicate any site that is still missing it.

### 5.3 Removing — `AlbumService.removeAssets`

Removing a contribution = delete the `album_space_asset` row (never touches the asset). Gate it on
the **same `AlbumAssetDelete`** access #752 already defines — which resolves to _album Owner/Editor_
**or** _space Owner/Editor_ of the linked space (`checkSpaceLinkedAlbumAccess`, `role IN [owner,editor]`).
This is symmetric with the add gate and needs no new permission. A space **Viewer** cannot remove.

We deliberately **do not** add a standalone "the contributor may always remove" allowance: a
contributor who is still an Editor is already covered, and one demoted to Viewer _should_ lose write
ability — a bespoke allowance would reintroduce a role-transition bypass. Removing an ordinary
`album_asset` row is unchanged.

---

## 6. Lifecycle & edge cases (assertion source for the slices)

| Event                                                                                            | Effect on a contribution `(album L, asset A, space S)`                      |
| ------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------- |
| Viewer leaves space S                                                                            | Hidden for that viewer (no `shared_space_member`). Rejoin → reappears.      |
| Album L unlinked from S                                                                          | Hidden for everyone (no `shared_space_album`). Re-link → reappears.         |
| Space S deleted                                                                                  | Row deleted (FK `spaceId` CASCADE).                                         |
| Album L deleted                                                                                  | Row deleted (FK `albumId` CASCADE).                                         |
| Asset A deleted                                                                                  | Row deleted (FK `assetId` CASCADE).                                         |
| Owner un-shares A from the space's **general pool** (`shared_space_asset` delete), A not deleted | **Row stays** (§8 default 1); A still renders in L for members.             |
| `addedById` user deleted                                                                         | Row survives (`SET NULL`); affordance shows "unknown".                      |
| Album L shared outside S (external `album_user` / public link)                                   | Non-space viewers **never** see A.                                          |
| Owner opens L after leaving S / after unlink                                                     | A is gone for the owner too (reaches contributions only via the space arm). |

---

## 7. Surfaces

### 7.1 Web

- **Add flow:** the existing "Add to album or space" picker + `addAssetsToAlbums` already targets
  space-linked albums; no picker change — the server now accepts non-owned assets for eligible albums.
- **Toast (fixes #764's literal title):** `notifyAddToAlbum` branches on result counts — success
  (all added), info/warning (partial), warning/error (none) — instead of unconditional
  `toastManager.primary`. **Standalone** (Slice 0).
- **Legibility:** a "from _Space name_" affordance on contributed tiles (we have `spaceId` → space
  name), so "these can disappear" is understood. Contributed tiles are non-owned → respect existing
  non-owner asset affordances.

### 7.2 Mobile / sync

- Contributions are album→asset **membership edges**: extend **`SharedSpaceAlbumToAssetSync`**
  (`sync.repository.ts:1609`) to union `album_space_asset` inserts, deletes driven by the new
  `album_space_asset_audit` stream. The contributed asset's **payload + exif** (owned by another
  member) must also reach the client: include `album_space_asset`-reachable assets in
  **`SharedSpaceAlbumAssetSync`** (`:1689`) and **`SharedSpaceAlbumAssetExifSync`** (`:1763`),
  mirroring how the linked-album arm streams `album_asset`-reachable assets. Add a distinct
  `SyncEntityType`/`SyncRequestType` pair if the edge needs its own stream from
  `SharedSpaceAlbumToAssetsV1`.
- Contributions render read-through-space; tap-through respects existing owner/role gating.

---

## 8. Open sub-decisions (defaults chosen; confirm at review)

1. **Un-share vs. curated life.** Owner removes A from the space's _general pool_ but not delete →
   **Default: A stays** in albums it was curated into (contribution tethered to S, not to the source
   arm). Alternative: also require A independently space-visible at read time (stronger for the
   owner, fragile curation). _If flipped, the read arm in §5.2 gains an extra `spaceAssetPath`
   existence condition and the Slice 3 lifecycle test inverts._
2. **Contributions into externally-shared albums.** Allowed — per-viewer arm keeps it safe.
3. **Multi-space albums.** `spaceId` pins provenance; visible to members of _its_ space; each link
   gated independently; dedup by `assetId` at read time.

---

## 9. Slice overview

| #   | Slice                                                                    | Layers                 | Depends on | Independent ship? |
| --- | ------------------------------------------------------------------------ | ---------------------- | ---------- | ----------------- |
| 0   | Honest add-to-album toast (fixes #764 title)                             | web unit               | —          | ✅ land anytime   |
| 1   | Schema foundation: `album_space_asset` + audit + migration               | server medium          | —          | foundation        |
| 2   | Contribute a non-owned space photo (add path + album grid & count)       | server e2e + medium    | 1          | ✅ vertical MVP   |
| 3   | Contributions across remaining album surfaces + leak/lifecycle negatives | server medium + e2e    | 2          | extends 2         |
| 4   | Remove a contribution                                                    | server e2e + medium    | 2          | ✅ vertical       |
| 5   | Mobile sync of contributions                                             | server medium + mobile | 2, 3       | ✅ vertical       |
| 6   | Web legibility affordance + role-gating                                  | web unit + Playwright  | 2          | ✅ vertical       |

Ordering: **0** anytime; **1 → 2 → {3, 4, 5, 6}**. Each `/impl-loop` run does one slice, TDD.

---

## Slice 0 — Honest add-to-album toast

**Delivers.** #764's literal title: a failed or partial add never renders as a green "Successful".
Pure web; independent of the backend feature.

**Behavior (BDD)**

- _Given_ an add-to-album request where the server returns **0 successes** (all `NO_PERMISSION`),
  _When_ `notifyAddToAlbum` runs, _Then_ a **non-success** toast (warning/error) shows "…cannot be
  added…" — never the green success heading.
- _Given_ a result where **all assets were duplicates**, _When_ it runs, _Then_ an **info** toast
  says "already in the album".
- _Given_ a **partial** result (some success, some fail), _When_ it runs, _Then_ an **info/warning**
  toast states the partial count.
- _Given_ **all** assets succeed, _When_ it runs, _Then_ the success toast + "View album" button
  (unchanged behavior).

**TDD — red first**

- **Web unit** (`web/src/lib/services/album.service.spec.ts`): mock `toastManager`; feed
  `notifyAddToAlbum` each result shape; assert the **method called** (`error`/`warning`/`info`/`primary`)
  and message key. Red today because the current code always calls `.primary`.

**Fix (green).** Branch `notifyAddToAlbum` on `successCount` / `duplicateCount` / `assetIds.length`
to select the toast severity + message; keep "View album" on any run that produced ≥1 success.

**Edge cases (explicit assertions)**

- 0 success, 0 duplicate → error/warning (not primary).
- 0 success, all duplicate → info "already part of album".
- Mixed success + duplicate + no-permission → partial wording, "View album" present.
- All success → primary + "View album" (regression).
- `notifyAddToAlbums` (multi-album path) audited for the same lie; fix if present.

**Green.** All shapes assert the correct severity; existing album.service web tests stay green;
`pnpm --filter immich-web test` + `check:typescript` clean.

---

## Slice 1 — Schema foundation: `album_space_asset` (+ audit, migration)

**Delivers.** The storage substrate + cascade/audit guarantees. No user-facing behavior yet
(the one non-vertical slice); fully covered by medium tests on the live schema.

**Behavior (BDD)**

- _Given_ a linked album, asset, and space, _When_ an `album_space_asset` row is inserted, _Then_ it
  persists with sync watermarks and is readable by `(albumId, assetId)`.
- _Given_ an `album_space_asset` row, _When_ its **album** / **asset** / **space** is deleted,
  _Then_ the row is **cascade-deleted**; _When_ its `addedById` user is deleted, _Then_ the row
  **survives** with `addedById = NULL`.
- _Given_ an `album_space_asset` row is deleted, _When_ the delete commits, _Then_ an
  `album_space_asset_audit` row is emitted (for the sync delete stream in Slice 5).

**TDD — red first**

- **Medium** (`server/test/medium/specs/…`): create the table via migration on the testcontainers
  DB; assert insert/read; assert each FK cascade/SET-NULL; assert the audit row on delete. Red
  because table/trigger don't exist.

**Fix (green).**

- `album-space-asset.table.ts` + `album-space-asset-audit.table.ts` (mirror `shared_space_asset` +
  its audit trigger pattern).
- Migration in `migrations-gallery/` (round timestamp); `revert-to-immich.sql` DROP entries for both
  tables; register the repository (if any) in `medium.factory.ts` and BaseService (all three sites).
- Regenerate query SQL against a scratch migrated DB.

**Edge cases**

- Duplicate `(albumId, assetId)` insert → PK conflict handled (`onConflict do nothing`), not a 500.
- Audit trigger fires on **statement**-level bulk delete (not just row) — assert multi-row delete.
- Migration applies cleanly on a DB that already has all #752 migrations (unordered-migration path).

**Green.** Medium schema suite green; `make sql` diff limited to the new tables; server `check` clean.

---

## Slice 2 — Contribute a non-owned space photo (add path + album grid & count)

**Delivers.** The core loop end-to-end: an Editor adds a photo they don't own to a space-linked
album and **sees it in the album grid**, gated on live membership. This is the #764 capability.

**Behavior (BDD)** — space S; Alice owns album L linked to S; Bob is an Editor of S; asset X is in S
owned by Carol.

- _Given_ Bob (Editor), _When_ Bob adds X to L, _Then_ the response is `success:true` for X and an
  `album_space_asset(L, X, S, addedBy=Bob)` row exists — **not** an `album_asset` row.
- _Given_ the contribution exists, _When_ any live member of S opens L, _Then_ X appears in the grid
  and the asset **count includes** X.
- _Given_ Bob adds **his own** asset Y (in S) to L, _When_ it runs, _Then_ Y takes the **`album_asset`**
  path (`success:true`), unchanged.
- _Given_ a **Viewer** V of S, _When_ V tries to add X (or their _own_ asset) to L, _Then_ the add
  is **denied with 403** — `AlbumAssetCreate` throws _before_ any per-asset logic; no row created.
- _Given_ asset Z **not in S**, _When_ Bob adds Z to L, _Then_ **`NO_PERMISSION`** for Z — no row.
- _Given_ asset H owned by Carol but **Hidden/Locked**, _When_ Bob adds H to L, _Then_
  **`NO_PERMISSION`** (visibility gate) — no row, and H never becomes visible to any member via L.
- _Given_ Dave is a direct `album_user` **editor** of L but **not** a member of S, _When_ Dave adds
  non-owned X to L, _Then_ **`NO_PERMISSION`** (album role ≠ space rights); his _own_ asset → `album_asset`.
- _Given_ X is already in L (as contribution or owned), _When_ Bob adds X again, _Then_ **`DUPLICATE`**.
- _Given_ a mixed batch {X (non-owned, in S), Y (Bob-owned, in S), Z (not in S)}, _When_ Bob adds
  them, _Then_ per-asset `{X:success, Y:success, Z:no_permission}` and a partial `BulkIdResponse`.

**TDD — red first**

- **e2e** (`shared-space-album.e2e-spec.ts`): the seven scenarios above through the real HTTP add
  endpoint + a follow-up album read asserting X present/absent. Red because add returns
  `NO_PERMISSION` for non-owned assets today.
- **Medium**: the read arm `spaceContributedAssetExists` returns X for a member and **not** for a
  non-member; album count reflects it.
- **Unit** (`album.service.spec.ts`): the two-bucket split routes owned→`album_asset`,
  non-owned-space-visible→`album_space_asset`, others→`NO_PERMISSION`.

**Fix (green).**

- `AlbumService.addAssets` two-bucket split (§5.1) + an `albumSpaceAsset` repository insert.
- `spaceContributedAssetExists` helper (§5.2); wire into the album **grid** query and **asset count**.
- Emit `AlbumAssetsAdd` for contributed ids too (event parity with the owned path).

**Edge cases (explicit assertions)**

- Asset visible to Bob via **each** arm — direct pool, linked library, linked album — is all eligible.
- Asset visible to Bob only via a **different** space T (album L not linked to T) → `NO_PERMISSION`
  (eligibility requires visibility via **L's** space).
- Album linked to **no** space Bob edits → non-owned add → `NO_PERMISSION` (owner-only unchanged).
- **Visibility-gate leak negative (critical):** an Editor cannot contribute a Hidden/Locked asset
  (above); additionally assert the resulting `album_space_asset` set never contains a Hidden/Locked
  asset id, so no member's album read can surface one.
- **Leak negative (critical):** setup Alice as an **Editor member** of S (not the creator) who owns
  album L and links it into S. After Bob contributes X, Alice's `checkAlbumAccess`-backed reads of X
  resolve **only while she is a live member of S** — assert Alice loses X the moment she is removed
  from S while L stays linked (other members still see X), proving no permanent `album_asset` grant.
  Complementary assertion via **unlink** (L removed from S) — owner loses contributions too.
- Concurrent duplicate add (two editors add X at once) → one row, one `success`, one `DUPLICATE`;
  no 500.

**Green.** All e2e/medium/unit above green; existing album + space-album suites green.

---

## Slice 3 — Contributions across remaining album surfaces + leak/lifecycle negatives

**Delivers.** Contributions behave correctly everywhere a space album is read, and every
lifecycle/leak guarantee from §6 is asserted.

**Behavior (BDD)**

- _Given_ a contribution X in L with `showInTimeline=true`, _When_ a member views the **space
  timeline**, _Then_ X appears; _When_ `showInTimeline=false`, _Then_ X is absent.
- _Given_ a member **downloads** L, _When_ the archive builds, _Then_ X is included; a non-member's
  download excludes it.
- _Given_ a member **searches within** L, _When_ the query matches X, _Then_ X is returned.
- _Given_ L's **thumbnail** is a contributed asset and the viewer is a non-member, _When_ L renders
  in a list, _Then_ no 500 and no leaked thumbnail (falls back gracefully).
- _Given_ **album activity** (comments/likes), _When_ a space-only reader loads L, _Then_ activity
  still respects #752's direct-access gate (contributions don't widen it).
- **Lifecycle negatives:** _leave S_ → X hidden; _rejoin_ → X visible; _unlink L from S_ → X hidden
  for all incl. owner; _relink_ → visible; _delete X / L / S_ → row gone; _owner un-shares X from
  general pool but keeps it_ → X **stays** in L (§8 default 1).
- **External-share negative:** _Given_ Alice shares L via public link / external `album_user`, _When_
  a non-space viewer opens it, _Then_ contributions are **absent** (owned assets still present).
- **Contributed-then-Hidden negative:** _Given_ contribution X is visible, _When_ X's owner marks X
  **Hidden/Locked**, _Then_ the `spaceVisibilityGate` on the read arm excludes X from every album
  surface for every member (defense-in-depth against post-hoc visibility changes).

**TDD — red first**

- **Medium/e2e** per surface (timeline, download, activity, search, thumbnail) + the full lifecycle
  and external-share negatives. Red because those surfaces only union `album_asset` today.

**Fix (green).** Wire `spaceContributedAssetExists` into each remaining consumer of
`spaceAlbumAssetExists` / `spaceAssetPathBranches`; make thumbnail selection resilient when the only
candidates are contributions the viewer can't currently see.

**Edge cases**

- Dedup: an asset present in both `album_asset` and `album_space_asset` (shouldn't happen, but assert
  read returns it **once**).
- `showInTimeline` toggled after contribution → timeline visibility flips accordingly.
- Count/thumbnail recompute correctly after a contribution is hidden by leave/unlink.
- Activity gate (security-8 from #752) unchanged for space-only readers.

**Green.** All surface + lifecycle + leak negatives green; #752 visibility-hardening suites green.

---

## Slice 4 — Remove a contribution

**Delivers.** Collaborative removal, correctly role-gated.

**Behavior (BDD)** — contribution `(L, X, S)` by Bob. Gate = `AlbumAssetDelete` (album Owner/Editor
**or** space Owner/Editor).

- _Given_ Alice (album **owner**), _When_ she removes X from L, _Then_ the `album_space_asset` row is
  deleted, X leaves L, and asset X itself is untouched.
- _Given_ another live space **Editor** Dave, _When_ he removes X, _Then_ deleted.
- _Given_ Bob (the contributor) who is **still an Editor**, _When_ he removes X, _Then_ deleted (via
  the Editor path — no special contributor rule).
- _Given_ Bob was **demoted to Viewer** (or left S), _When_ he tries to remove his own X, _Then_
  **denied** — he no longer has write rights.
- _Given_ a space **Viewer** V (who is not the album owner), _When_ V tries to remove X, _Then_
  **denied**; row stays.
- _Given_ a **non-member**, _When_ they try, _Then_ **denied**.
- _Given_ removal of an **owned** `album_asset` row, _When_ it runs, _Then_ unchanged behavior.

**TDD — red first**

- **e2e/medium**: the six cases through the remove endpoint; assert row presence/absence and that
  the asset row persists. Red because the current remove path has no `album_space_asset` branch.

**Fix (green).** Space-aware branch in `AlbumService.removeAssets` gated on the existing
`AlbumAssetDelete` access (album Owner/Editor ∨ space Owner/Editor of the linked space — no new
permission, no bespoke contributor rule): if the caller has `AlbumAssetDelete` on L, delete the
`album_space_asset` row (emit `AlbumAssetsRemove` + audit).

**Edge cases**

- Removing X that is **not present** → `NOT_FOUND` (not 500).
- Editor of a **different** space (not L's) → denied.
- Album **Viewer** who is _also_ the album owner? Not possible (owner role ≠ viewer); the album owner
  always has `AlbumAssetDelete`. A space **Viewer** who does not own L → denied.
- A caller with `AlbumAssetDelete` removes an owned `album_asset` **and** a contributed
  `album_space_asset` in one batch → both handled, correct per-asset results.

**Green.** All cases green; existing remove suite green.

---

## Slice 5 — Mobile sync of contributions

**Delivers.** Contributions appear/disappear on mobile via the sync streams, with payload+exif.

**Behavior (BDD)**

- _Given_ a new contribution `(L, X, S)`, _When_ a member's client syncs, _Then_ the membership edge
  **and** X's payload + exif arrive; X renders in L on device.
- _Given_ the contribution is removed (Slice 4) or the member leaves S, _When_ the client syncs,
  _Then_ the edge is deleted via the audit stream and X leaves L on device.
- _Given_ a member **joins** S which already has contributions, _When_ they sync from scratch,
  _Then_ they **backfill** all contributions (watermark `createId` walk).

**TDD — red first**

- **Medium** (`SyncService`/`SyncRepository` against testcontainers): assert
  `SharedSpaceAlbumToAssetSync` emits the contribution edge; `SharedSpaceAlbumAssetSync` /
  `…ExifSync` emit X's payload/exif; the audit stream emits the delete; backfill covers pre-existing
  rows. Red because these streams only union `album_asset` today.
- **Mobile** (`flutter test`): a convergence test — apply insert then delete events, assert the Drift
  album membership converges (X present then absent).

**Fix (green).** Union `album_space_asset` into the three sync classes (§7.2); wire
`album_space_asset_audit` into the delete stream; register any new `SyncEntityType`/`RequestType`.

**Edge cases**

- Leaving S removes edges via audit **without** deleting X's underlying asset payload if X is still
  visible via another path (assert no spurious asset deletion).
- Re-link / re-join re-emits the edges (idempotent apply on device).
- Ack-watermark monotonicity: no duplicate emissions after ack.

**Green.** Medium sync + mobile convergence green; existing space-album sync suites green.

---

## Slice 6 — Web legibility affordance + role-gating

**Delivers.** Contributed tiles are legible and the add affordance is correctly role-gated in the UI.

**Behavior (BDD)**

- _Given_ a member views L, _When_ a tile is a contribution, _Then_ it shows a **"from _Space_"**
  affordance (source space name) and the standard **non-owner** asset affordances (no owner-only
  actions).
- _Given_ an **Editor** in the space, _When_ they open the add-to-album flow for a space photo they
  don't own, _Then_ the add **succeeds** (end-to-end).
- _Given_ a **Viewer**, _When_ they view space assets, _Then_ the "add to this album" affordance is
  **absent/disabled** (no dead-end).

**TDD — red first**

- **Web unit**: the tile renders the "from _Space_" label when given a contributed asset with a
  `spaceId`/space name.
- **Playwright** (`spaces-albums.e2e-spec.ts`): Editor add succeeds and the tile shows the badge;
  Viewer has no add affordance. (Role-badge assertions use `{ ignoreCase: true }` per the known
  lowercase-enum + CSS-capitalize gotcha.)

**Fix (green).** Thread the source-space name onto contributed tiles; render the affordance; ensure
the add action is hidden/disabled for Viewers.

**Edge cases**

- `addedById = NULL` (contributor deleted) → affordance still renders (space name only).
- Contribution that becomes hidden mid-session (owner unlink) → tile disappears on refresh without error.
- Album shared externally opened by a non-space viewer → no badge, no contribution tiles.

**Green.** Web unit + Playwright green; `pnpm --filter immich-web lint` (tolerated tailwind warnings)

- `check:typescript` clean.

---

## 10. Global acceptance criteria

- **Role matrix (§5.0) holds exactly:** _view_ = any live space member (incl. Viewer); _contribute_
  = space Owner/Editor of the album's space; _remove_ = `AlbumAssetDelete` (album Owner/Editor ∨
  space Owner/Editor). Every non-bypass rule has a passing negative test: Viewer 403 hard-block,
  album-editor-not-space-member denied, no cross-space smuggling.
- **No Hidden/Locked leak:** a Hidden/Locked asset is never contributable (add-time flat
  `spaceVisibilityGate`) and never rendered via a contribution (read-time gate at every surface),
  including when an asset is marked Hidden _after_ being contributed.
- Contributed photos render in every album surface for live members and **nowhere** for
  non-members — including the album owner once their space access ends, and including external
  album shares / public links.
- Leaving/unlinking/deleting behaves exactly per the §6 table; re-join/re-link is reversible.
- The add-to-album toast never reports success when nothing was added.
- Mobile converges with contribution insert/delete/backfill.
- Full-suite green for every touched package; **no widening of `AssetShare`/shared-link/memory
  permissions** (assert an unrelated shared-link e2e still owner-gates — a space member still cannot
  mint a public link of another member's photo).

## 11. Out of scope

- Personal (non-space) album cross-owner adds; normal shared-album semantics.
- Issues #763 / #765 (separate "member curation" work).
- Any change to who may **link/unlink** an album to a space (that's #752's remit).
