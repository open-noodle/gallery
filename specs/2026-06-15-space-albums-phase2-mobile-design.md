# Space Albums — Phase 2 Mobile Experience & Decomposition — Design

Companion to [`2026-06-09-space-albums-design.md`](./2026-06-09-space-albums-design.md). That doc
specifies the feature and its server/web Phase 1. This doc designs the **Phase 2 mobile experience**
(the target UX) and proposes the **Phase 2 decomposition + sequencing** (server offline-sync
subsystem vs the Flutter app). No production code yet — this is the agreed target before we
brainstorm → spec → `/impl-loop` each sub-project.

## The framing decision: mobile is not web's tab bar

The shipped **web** space is a 7-tab screen (Photos / People / Albums / Map / Members / Activity /
Libraries). The **mobile** space is structurally different and we keep it that way:

- `SpaceDetailPage` (`mobile/lib/pages/library/spaces/space_detail.page.dart`) **is** the shared
  `Timeline` widget — `TimelineRouteScope` → `timelineFactoryProvider.sharedSpace(spaceId, …)`, with a
  floating `SliverAppBar` passed _into_ Timeline (actions: per-member visibility toggle, add-photos,
  Members icon, owner kebab). There is **no tab scaffold**, and there are **no** People/Map/Activity/
  Libraries surfaces on mobile. "Members" is a **pushed subpage** reached from an app-bar icon.
- Regular album detail (`mobile/lib/presentation/pages/drift_remote_album.page.dart`,
  `RemoteAlbumPage`) is the **same shape**: Timeline → `timelineFactoryProvider.remoteAlbum(albumId)`,
  plus a sliver app bar and a bottom sheet, with `addAssets` pushing `DriftAssetSelectionTimelineRoute`.

So "parity with web" on mobile means **the same capabilities expressed in mobile's single-scroll +
pushed-subpage idiom**, not a tab bar. Two product decisions (agreed 2026-06-15):

1. **Placement** — the in-space Albums section is an **"Albums" shelf rendered as a header sliver at
   the top of the space timeline** (Google-Photos style), with a count, a "See all" affordance, and
   (for editors) a Link tile. Not a tab, not a buried icon.
2. **Editor scope** — **full parity**: editors/owners can **link** (searchable picker), **unlink**,
   **toggle per-album `showInTimeline`**, and **add/remove photos** in a linked album. Viewers are
   strictly read-only.

## Surfaces

There are five mobile surfaces. All reuse existing app primitives (Timeline, the album sliver app
bar, bottom-sheet action buttons, `DriftAssetSelectionTimelineRoute`, `AlbumSelector`, `ImmichToast`,
`AlertDialog` confirmations) and the established **sync-nudge** pattern
(`backgroundSyncProvider.syncRemote()` after every mutation, exactly as `SpaceDetailPage` already
does for add-photos / remove / member-timeline).

### 1 — The Albums shelf (header sliver on the space timeline)

A horizontal shelf at the very top of the space's scrolling timeline, below the sync banner and above
the photo grid. It **scrolls away** with the content (it is a top sliver, like the sync banner — it
is not pinned).

```
┌──────────────────────────────────┐
│ [<]  Beach Trip      [👁] [＋] [⋮] │   ← existing floating SliverAppBar
├──────────────────────────────────┤
│ Albums (3)              See all ▸ │   ← section header row (tap "See all" → list/manage page)
│ ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐  │
│ │cover│ │cover│ │ ⊘   │ │  ＋  │  │   ← horizontal scroll; "＋" Link tile = editors only
│ └─────┘ └─────┘ └cvr ┘ └─────┘  │
│ Hawaii  Sunset  Reef    Link      │
├──────────────────────────────────┤
│ ▓▓▓ ▓▓▓ ▓▓▓   ← space timeline    │
│ ▓▓▓ ▓▓▓ ▓▓▓     (photos)          │
│ ▓▓▓ ▓▓▓ ▓▓▓                       │
└──────────────────────────────────┘
```

- **Cover tile** ≈ 100–112px square, card radius 16, cover from `album.thumbnailAssetId` via the
  existing remote-asset thumbnail widget; fallback `Icons.photo_album_outlined` on
  `surfaceContainerHighest` when the cover asset is not yet synced locally. Album name below, 1 line,
  ellipsis.
- **Off-timeline indicator** — for a linked album whose `showInTimeline = false`, dim the cover
  (~60% opacity) and overlay a small `Icons.visibility_off` (⊘) badge. Mirrors web's dimming + "hidden
  from timeline" label. The album is still browsable; it is simply excluded from the timeline grid.
- **Tap** a cover → push the **Space Album detail** page.
- **Long-press** a cover (editors) → context menu: _Show/Hide in timeline_, _Unlink from space_.
- **Link tile** (last tile, editors only): dashed `surfaceContainer` tile with `Icons.add` →
  opens the **Link picker**.
- **Visibility rules:**
  - linked count > 0 → shelf shows all linked albums + (editor) the Link tile.
  - count == 0 && **editor** → slim one-row shelf with just the Link tile + "Link an album" label
    (don't steal vertical space with a big empty state).
  - count == 0 && **viewer** → shelf is **hidden** entirely.
- **"See all ▸"** (shown whenever count > 0) → pushes the **Space Albums list/manage page**.

> **Integration note (flag for spec):** `Timeline` currently accepts a single `topSliverWidget` +
> `topSliverWidgetHeight` (used today for `SyncStatusBannerSliver`). The shelf must **compose** with
> the banner — either extend `Timeline` to accept an ordered list of top slivers, or build one
> combined header sliver (banner + shelf) with a summed height. This is the main mobile integration
> risk; size it in the slice.

### 2 — Space Albums list / manage page

Pushed via a new `SpaceAlbumsRoute(spaceId)` (standard slide-right). This is the web "Albums tab"
re-expressed as a pushed page, and the comfortable home for management actions.

```
┌──────────────────────────────────┐
│ [<]  Albums                        │
│      Beach Trip · 3        [＋ Link]│   ← "＋ Link" = editors only
├─────────────────┬─────────────────┤
│ ┌─────────────┐ │ ┌─────────────┐ │
│ │    cover    │ │ │    cover    │ │
│ └─────────────┘ │ └─────────────┘ │
│ Hawaii 2024 ⋮   │ Sunsets      ⋮  │   ← ⋮ overflow = editors only
│ 142 photos      │ 38 photos       │
│                 │                 │
│ ┌─────────────┐ │                 │
│ │ cover (dim) │ │                 │
│ │      ⊘      │ │                 │
│ └─────────────┘ │                 │
│ Reef dives  ⋮   │                 │
│ 12 · Hidden     │                 │
└─────────────────┴─────────────────┘
```

- 2-column responsive grid (card radius 16). Card = square cover, name (2-line clamp), metadata line
  `{count} photos` and `· Hidden from timeline` when off-timeline (cover dimmed + ⊘, as on the shelf).
- **Card ⋮ overflow** (editors): _Show/Hide in timeline_, _Unlink from space_ (with confirm dialog).
- **App-bar "＋ Link"** (editors) → Link picker.
- **Empty state** (centered): `Icons.photo_album_outlined` + "No albums yet" + (editor) "Link album"
  button.

### 3 — Space Album detail page

Pushed via `SpaceAlbumDetailRoute(spaceId, albumId)`. A near-clone of `RemoteAlbumPage`, **gated on
space role** (not album role) and with a **reduced** action set (the album is "absorbed" — no
personal-sharing affordances).

```
┌──────────────────────────────────┐
│  ⟨ cover art (expanded header) ⟩  │   ← RemoteAlbumSliverAppBar clone; name fades in on scroll
│  Hawaii 2024                  [⋮] │   ← kebab = editors/owners only
│  142 photos · in Beach Trip       │
├──────────────────────────────────┤
│ ▓▓▓ ▓▓▓ ▓▓▓   ← album's photos    │
│ ▓▓▓ ▓▓▓ ▓▓▓     (Timeline grid)   │
│ ▓▓▓ ▓▓▓ ▓▓▓                       │
└──────────────────────────────────┘
        ⋮ kebab (editor):           multiselect bottom sheet (editor):
        • Add photos                  • Download
        • Show/Hide in timeline       • Share
        • Unlink from space           • Remove from album
        (no Delete / Add users /      (no Favorite/Archive/Trash/
         Shared link / Set cover)      Lock/Set-cover)
```

- `TimelineRouteScope` → a **new** `timelineFactoryProvider.spaceAlbum(spaceId, albumId, …)` Drift
  query (joins the new `shared_space_album_asset` membership → `remote_asset`). Header description
  shows `{count} photos · in {space.name}`.
- **Kebab** (space owner/editor): _Add photos_ → `addAssets` pushes
  `DriftAssetSelectionTimelineRoute(lockedSelectionAssets: albumAssets)` then a sync nudge;
  _Show/Hide in timeline_ (the per-album toggle); _Unlink from space_ (confirm). **No** Delete album,
  Add users, Create shared link, Set cover, or album-order — those stay with the album owner outside
  the space. Viewers see no kebab.
- **Bottom sheet** (multiselect): a reduced `RemoteAlbumBottomSheet` — Download, Share, and (editors)
  **Remove from album** via the existing `RemoveFromAlbumActionButton` /
  `actionProvider.removeFromAlbum(source, albumId)`, which calls the album-asset DELETE endpoint that
  Phase 1 already permits for space editors. **No** Favorite/Archive/Trash/Lock/Set-cover.

> **Action-layer note (flag for spec):** confirm `addToAlbum` / `removeFromAlbum` action providers
> don't hard-gate on personal album ownership **client-side** before hitting the (Phase-1-permitted)
> endpoint. If they do, add a space-role-aware path. The server already allows it; the client gate is
> the risk.

### 4 — Link picker (full parity)

Pushed via `SpaceLinkAlbumRoute(spaceId, linkedAlbumIds)` (slide-up, matching
`SpaceMemberSelectionRoute`). Mirrors web's `SpaceLinkAlbumModal`.

```
┌──────────────────────────────────┐
│ [✕]  Link albums         [Link 2] │
├──────────────────────────────────┤
│ 🔍 Search                          │
├──────────────────────────────────┤
│ ☑ ▣ Hawaii 2024        142 photos │
│ ☐ ▣ Sunsets             38 photos │
│ ☑ ▣ Reef dives          12 photos │
│ ☐ ▣ Family 2023        310 photos │
└──────────────────────────────────┘
```

- Searchable multi-select. Tiles reuse the `AlbumSelector` pattern (leading checkbox + thumbnail +
  name + count).
- **Candidate list** = the user's albums they **own or can edit** (from the already-synced personal
  `remote_album` Drift; role via the existing `getUserRole`), **excluding** already-linked ids.
- **Empty state:** "No albums to link."
- **Confirm "Link (N)"** → loop the Phase-1 `PUT /shared-spaces/:id/albums/:albumId` per selection →
  toast → sync nudge → pop with the linked count.

### 5 — Timeline composition (`showInTimeline` photos in the space grid)

Not a new UI surface — a Drift query change. The `sharedSpace()` timeline query
(`mobile/lib/infrastructure/repositories/timeline.repository.dart`) today unions: direct-added
(`shared_space_asset`) ∪ library-linked (`shared_space_library`). Phase 2 adds a third branch:

```
∪  assets in shared_space_album_asset
   WHERE the album's space-link shared_space_album.showInTimeline = true
```

(implemented as a `LEFT JOIN`, matching the existing reactive-watch pattern). Effects:

- Linked-album photos appear in the main space timeline grid **indistinguishable** from direct-added
  assets — **no marker** (matches web).
- Flipping the per-album toggle flips those photos in/out of the timeline; Drift's reactive watch
  updates the grid live after the toggle's `PATCH` + sync nudge.
- This is **distinct** from the existing **per-member** `showInTimeline` (the eye toggle in the space
  app bar), which decides whether the whole space bleeds into the member's _personal_ main timeline.
  The two compose; neither changes the other.

## Role → UI mapping (mobile)

Derived from the master doc's role matrix; the client mirrors it for affordance visibility (the server
is authoritative).

| Capability                                | Viewer | Editor | Owner | Surface                                       |
| ----------------------------------------- | :----: | :----: | :---: | --------------------------------------------- |
| See shelf / list / detail / synced photos |   ✅   |   ✅   |  ✅   | shelf, list page, detail, timeline            |
| Link album                                |   ❌   |  ✅¹   |  ✅¹  | Link tile / "＋ Link" → picker                |
| Unlink album                              |   ❌   |   ✅   |  ✅   | shelf long-press / card ⋮ / detail kebab      |
| Toggle per-album `showInTimeline`         |   ❌   |   ✅   |  ✅   | shelf long-press / card ⋮ / detail kebab      |
| Add photos to a linked album              |   ❌   |   ✅   |  ✅   | detail kebab → asset picker                   |
| Remove photos from a linked album         |   ❌   |   ✅   |  ✅   | detail multiselect bottom sheet               |
| Delete the album                          |   ❌   |   ❌   |  ❌   | not offered in-space (stays with album owner) |

¹ Link also requires the actor to **own or edit** the album being linked — enforced by the picker's
candidate filter _and_ the server.

## Design language

Reuse the app's system verbatim: GoogleSans, Material 3 `ColorScheme`, card radius 16, `surfaceContainer*`
layering, `context.primaryColor` accents, `context.colorScheme.error` for destructive, `withValues(alpha:)`
(never `withOpacity`), `ImmichToast` for feedback, `AlertDialog` confirms (matching `_deleteSpace` /
`deleteAlbum`). New strings go through the i18n pipeline (`.t(context:)`), reusing existing keys where
they exist (`add_photos`, `cancel`, `link`, `items_count`, the `spaces_*` / `space_albums_*` keys the web
already defines) and adding mobile-specific ones as needed. **CI gate:** `dart analyze --fatal-infos lib
test` must be clean (watch unawaited futures, `withOpacity`, dead null-aware ops).

## Phase 2 decomposition & sequencing

Phase 2 is two sub-projects. **Sub-project A (server sync)** is the correctness-/security-critical
half and is fully testable with medium + E2E tests, no client. **Sub-project B (mobile)** consumes
A's wire contract. The wire contract is the coupling point, so we lock it first.

### Step 0 — Lock the wire contract (short spec / mobile consult)

Resolves the master doc's open question: _"Exact `SharedSpaceAlbum*V1` entity-type set and whether any
can reuse existing album wire shapes without leaking into the personal album list."_ Output: the field
shapes of `SharedSpaceAlbumV1` / `SharedSpaceAlbumAssetV1` / `SharedSpaceAlbumAssetExifV1` /
`SharedSpaceAlbumToAssetV1`, and the matching mobile Drift schema. **Recommendation:** distinct entity
types (per the master design) that route into new space-album Drift tables — never the personal
`remote_album` tables — to preserve the "absorbed" invariant. Everything downstream keys off this.

### Sub-project A — Server offline-sync subsystem (TDD; tests RED first)

| Slice  | Scope                                                                                                                                                                                                                         | Authoritative tests                                                                                                                                    |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **A1** | `shared_space_album_user` grant table migration (mirror `library_user`) + schema-tools registration + reversible `down()`.                                                                                                    | grant-table shape; FK cascades                                                                                                                         |
| **A2** | Create-side triggers: `shared_space_album_after_insert_user` (link → grant all members + bump album `updateId`); `shared_space_member_after_insert_album` (join → grant for all linked albums).                               | fan-out counts, multi-path dedup (`ON CONFLICT DO NOTHING`), `updateId` re-delivery, zero-member/zero-album no-ops                                     |
| **A3** | Delete-side: `user_has_album_path()` + `shared_space_album_audit` fan-out (unlink / member-leave / space-delete / album-delete cascade) + consumer `shared_space_album_user_delete_after_audit`.                              | revoke iff no other path; **manual `album_user` untouched**; cascade correctness; `excludeSpaceId` gating; every path branch                           |
| **A4** | Sync repos `SharedSpaceAlbumSync` / `…AssetSync` / `…AssetExifSync` / `…ToAssetSync`, keyed off grant `createId` (backfill) + `accessibleSpaces`-style upsert scoping. **Locks the wire contract** (Step 0 realized in code). | `getCreatedAfter` ordering/filtering; `getUpserts` re-delivery (asserted independently); set-equality vs the read predicate; concurrency-race doc test |
| **A5** | Register entity types in the sync dispatch/checkpoint registry; **OpenAPI regen (TS + Dart)** so the client SDK gets the wire types.                                                                                          | Sync E2E — 3 `library_user` scenarios re-cast for albums; **assert NOT delivered as personal `AlbumV1`** (absorbed invariant)                          |

### Sub-project B — Mobile app (consumes A's contract; `dart analyze` clean per slice)

| Slice  | Scope                                                                                                                                                                                                                                                                                                  | Tests                                                           |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------- |
| **B0** | Drift schema: `shared_space_album` (album metadata + space link + `showInTimeline`) and `shared_space_album_asset` (membership) entities + DAOs + Drift migration; new `spaceAlbum()` query and the `sharedSpace()` union branch. (No FK on asset ids — same ordering reason as `shared_space_asset`.) | upsert/delete; grouping query; union-branch correctness         |
| **B1** | Sync dispatch handlers routing `SharedSpaceAlbum*V1` → the new Drift tables (never personal `remote_album`).                                                                                                                                                                                           | dispatch routes to space tables; personal album list unaffected |
| **B2** | Albums **shelf** header sliver on `SpaceDetailPage` + `Timeline` top-sliver composition with the sync banner; `spaceAlbumsProvider.family<List<SpaceAlbum>, String>` watching Drift; cards, empty/CTA, dim+⊘ off-timeline.                                                                             | renders linked albums; visibility rules by role/count           |
| **B3** | Space Albums **list/manage page** (`SpaceAlbumsRoute`): grid, card ⋮ (toggle/unlink), "＋ Link", empty state.                                                                                                                                                                                          | editor vs viewer affordances; empty state                       |
| **B4** | Space Album **detail page** (`SpaceAlbumDetailRoute`): `RemoteAlbumPage` clone, space-role-gated kebab + reduced bottom sheet.                                                                                                                                                                         | role-gated kebab/bottom-sheet; add/remove wiring                |
| **B5** | **Link picker** (`SpaceLinkAlbumRoute`): searchable multi-select of own/editable albums, exclude linked, link action + sync nudge.                                                                                                                                                                     | candidate filter (own/edit, exclude linked); multi-link         |
| **B6** | Editor **mutations + gating**: link/unlink/toggle/add/remove → Phase-1 APIs + sync nudge; space-role gating throughout; viewer read-only end-to-end.                                                                                                                                                   | each mutation; viewer denied client-side                        |
| **B7** | **Gate + verify**: `dart analyze --fatal-infos lib test` clean; widget tests; manual verify against a real synced space (toggle reactivity, off-timeline dimming, absorbed invariant on device).                                                                                                       | full gate                                                       |

### Recommended order

**Sequential-with-an-early-contract** (recommended): **Step 0 → A1–A3 → A4 (contract) → A5 → B0–B7.**
A1–A3 are the security core and land first; A4 realizes the contract; the mobile half then builds
against the **shipped, regenerated Dart SDK** rather than a guessed shape. Full-stack verify (Sync E2E

- on-device) is the join point.

**Compression option:** once **Step 0** locks the contract, **B0–B5** (Drift schema + UI shells driven
by seeded/mock local data) can proceed **in parallel** with **A2–A5**, since they need only the wire
shape, not running triggers. Join at **B6/B7** (live mutations + on-device verify) after A5 ships.
Take this only if two workstreams are actually available; otherwise the sequential order is lower-risk.

## Out of scope (Phase 2)

- **Album _creation_ inside a space** (create-then-link in one step) — deferred; v1 links existing
  albums only (master doc's "lean: link-only first").
- **Per-member `showInTimeline` for linked albums** — the toggle stays space-level.
- People / Map / Activity / Libraries mobile surfaces — unchanged; not part of this work.

## Open items to settle during spec

- `Timeline` top-sliver composition (banner + shelf): extend the API vs combined header sliver.
- Whether `addToAlbum` / `removeFromAlbum` action providers gate on personal album ownership
  client-side (need a space-role-aware path if so).
- Cover-thumbnail fallback when the album cover asset hasn't synced locally yet (icon fallback;
  same no-FK concern as `shared_space_asset`).
- Final i18n key reuse vs new mobile keys.
