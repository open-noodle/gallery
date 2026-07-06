# Space Albums — Phase 2B: Mobile Implementation — Design

Companion to [`2026-06-09-space-albums-design.md`](./2026-06-09-space-albums-design.md) (master),
[`2026-06-15-space-albums-phase2-mobile-design.md`](./2026-06-15-space-albums-phase2-mobile-design.md)
(the **target mobile UX** + the B0–B7 decomposition), and
[`2026-06-15-space-albums-phase2a-server-sync-design.md`](./2026-06-15-space-albums-phase2a-server-sync-design.md)
(Sub-project A — the server offline-sync subsystem, **shipped** in PR #696).

This spec is the **`/impl-loop`-ready implementation design for Sub-project B (the Flutter app)**. It
takes the Phase-2 mobile design's target UX as given and pins it to the **wire contract Phase 2A
actually shipped** (15 `SharedSpaceAlbum*V1` entity types; metadata/asset/exif reuse
`SyncAlbumV2`/`SyncAssetV2`/`SyncAssetExifV1`; only the two `SyncSharedSpaceAlbumLink(Delete)V1` DTOs
are new). It resolves the four "open items" the mobile design left for spec time, fixes the exact
Drift schema + sync-dispatch + timeline-query touchpoints against the current code, and decomposes the
work into RED→GREEN slices.

Implemented **test-first (TDD mandatory)** per the master doc and Phase 2A — every Drift/dispatch
behavior and every surface's role-gating is pinned by a **failing test before** the production code
exists (RED → GREEN → REFACTOR). §10 is the **authoritative coverage contract**: the implementation
plan must carry every row in it into a RED test, and the UI slices must carry the layouts from the
[Phase-2 mobile design](./2026-06-15-space-albums-phase2-mobile-design.md) §Surfaces (§7 ties each
slice to its mockup). `dart analyze --fatal-infos lib test` is the hard CI gate (per
`feedback_mobile_dart_analyze_ci_fatal_infos`).

## 1. Scope & non-goals

**In scope (Sub-project B):**

- Mobile Drift schema for space albums (three entities: metadata, link, membership) + DAOs + a Drift
  migration, plus the `spaceAlbum()` timeline query and the third `sharedSpace()` union branch.
- Sync wiring: the five new request types, the 15-case dispatch switch, the stream handlers, and the
  `_kResponseMap` deserialization entries — all routing `SharedSpaceAlbum*V1` into the new space
  tables, **never** the personal `remote_album` tables (the absorbed invariant on device).
- The five mobile surfaces from the mobile design (Albums shelf, list/manage page, album detail page,
  link picker, timeline composition), role-gated on **space** role.
- Editor mutations (link / unlink / toggle `showInTimeline` / add / remove photos) via the Phase-1
  endpoints + the established sync-nudge, with viewer read-only end-to-end.
- Mobile tests (Drift, dispatch, widget) + the `dart analyze` gate + an on-device verify pass.

**Out of scope (unchanged from the master / mobile designs):** album _creation_ inside a space;
per-member `showInTimeline` for linked albums; People/Map/Activity/Libraries mobile surfaces; any
server change (Phase 2A is shipped — this consumes its contract); any web change.

## 2. Decision record (from the 2026-06-16 brainstorm)

These refine the mobile design and are binding for this spec.

### D1 — Client metadata is stored **normalized** (mirrors the server's two-stream split)

The server splits the album into a **grant-keyed metadata** stream (`SharedSpaceAlbumV1`, keyed by
`albumId`) and a **space-keyed link** stream (`SharedSpaceAlbumLinkV1`, keyed by `(spaceId,
albumId)`). The client mirrors that with **two tables**, not one denormalized row:

- `shared_space_album` — keyed by `albumId`, holds album **metadata** (fed by `SharedSpaceAlbumV1`).
- `shared_space_album_link` — keyed by `(spaceId, albumId)`, holds the **link** fields
  (`showInTimeline`, `addedById`, `createdAt`/`updatedAt`; fed by `SharedSpaceAlbumLinkV1`).

This avoids duplicating album metadata when an album is linked to **two** spaces (the metadata stream
delivers it once, keyed by album; each space contributes its own link row). _Rejected alternative:_ a
single denormalized `(spaceId, albumId)` row holding both — simpler joins, but the metadata-delete and
metadata-upsert handlers would have to fan out across every linking space, and metadata would be
duplicated.

### D2 — The Albums shelf **composes** with the sync banner inside one top sliver

`Timeline` accepts a **single** `topSliverWidget` + `topSliverWidgetHeight`
(`mobile/lib/presentation/widgets/timeline/timeline.widget.dart`). Rather than extend Timeline's
public API to a list (which would also touch the scrubber-offset math), B2 builds **one combined
header sliver** (sync banner stacked above the Albums shelf) and passes it as the single
`topSliverWidget` with a summed height. Timeline is untouched.

### D3 — Editor write affordances gate on **space role**, at the button, not the action layer

The `addToAlbum` / `removeFromAlbum` action providers
(`mobile/lib/providers/infrastructure/action.provider.dart`,
`mobile/lib/services/action.service.dart`) do **not** client-gate on album ownership — they call the
endpoint and rely on server enforcement (Phase 1 already permits space editors). The existing
`RemoteAlbumBottomSheet` gates the _button_ on `ownsAlbum`. The space album detail page therefore
gates the same buttons on **`role >= SharedSpaceRole.editor`** instead of `ownsAlbum`. **No
action-provider change** — only button visibility.

### D4 — Cover fallback reuses the existing album-tile pattern

`album_tile.dart` already renders a `FutureBuilder` over the cover asset with an `Icons.photo_album_*`
fallback in a `surfaceContainer` tile when the cover asset is not yet synced locally. The shelf/list
covers reuse this pattern verbatim (icon `Icons.photo_album_outlined`), covering the "cover asset not
synced yet" case — the same no-FK reason `shared_space_asset` already lives with.

## 3. What's already in place (the reconciliation result)

Confirmed on `feat/space-albums` (the exploration that grounded this spec):

- **Dart SDK is ready.** `mobile/openapi/lib/model/sync_entity_type.dart` carries all **15**
  `SharedSpaceAlbum*V1` enum values. `SyncSharedSpaceAlbumLinkV1` (`{spaceId, albumId, showInTimeline,
addedById?, createdAt, updatedAt}`) and `SyncSharedSpaceAlbumLinkDeleteV1` (`{spaceId, albumId}`)
  model classes exist. The metadata/asset/exif streams **reuse** `SyncAlbumV2` / `SyncAssetV2` /
  `SyncAssetExifV1`, so B1's dispatch reuses existing deserialization — no new model classes.
- **The blueprint to clone is exact.** Every album touchpoint mirrors a `shared_space_library` one
  that already exists:
  - Drift entity — `mobile/lib/infrastructure/entities/shared_space_library.entity.dart` (composite PK
    `(spaceId, libraryId)`, **no FK** on the loose id, FK + cascade on `spaceId`).
  - Dispatch — `mobile/lib/domain/services/sync_stream.service.dart` (the `SyncEntityType` switch,
    ~lines 325–372).
  - Handlers — `mobile/lib/infrastructure/repositories/sync_stream.repository.dart`
    (`updateSharedSpaceLibrariesV1` / `deleteSharedSpaceLibrariesV1`, and the asset/exif handlers that
    **delegate** to `updateAssetsV1` / `updateAssetsExifV1` — the shared `remote_asset` store).
  - Timeline union — `mobile/lib/infrastructure/repositories/timeline.repository.dart` (`sharedSpace()`
    LEFT-JOINs `shared_space_asset` ∪ `shared_space_library`).
  - Request list + deserialization map — `mobile/lib/infrastructure/repositories/sync_api.repository.dart`
    (the `SyncRequestType` list and `_kResponseMap`).
- **DB registration** — `mobile/lib/infrastructure/repositories/db.repository.dart` (`@DriftDatabase`).

Nothing album-specific exists on the mobile side yet; B0–B7 fill exactly the gaps the library path
already models.

## 4. Client data model (Drift)

Three new entities + one query change. This refines the mobile design's two-entity sketch
(`shared_space_album` + `shared_space_album_asset`) into **three** per D1 (metadata split from link).

> **Naming note.** The client tables mirror the **wire entity families** the client consumes, not the
> server's physical tables. So `shared_space_album` here is the **metadata** table (mirroring the
> `SharedSpaceAlbumV1` family), and `shared_space_album_link` is the link table (mirroring
> `SharedSpaceAlbumLinkV1`) — deliberately the **opposite** mapping from the server, whose physical
> `shared_space_album` Postgres table is the _link_. Cross-reference by wire entity type, not table name.

**No FK** on `albumId`/`assetId` columns (same ordering rationale as
`shared_space_asset`/`shared_space_library`: the referenced row may not be locally synced when the
join row arrives). `spaceId` keeps its FK + cascade to the space entity.

### 4.1 `shared_space_album` (metadata, keyed by album)

```
shared_space_album
  albumId            text  PK            -- no FK (loose ref)
  name               text
  description        text?
  thumbnailAssetId   text?               -- no FK; cover may be unsynced (D4 fallback)
  createdAt          datetime
  updatedAt          datetime
  isActivityEnabled  boolean
  order              text/int            -- album sort order (matches SyncAlbumV2)
```

Fed by `SharedSpaceAlbumV1` (deserialized as `SyncAlbumV2`). Upsert keyed by `albumId`.

### 4.2 `shared_space_album_link` (link, keyed by space+album)

```
shared_space_album_link
  spaceId         text  PK  FK → shared_space (ON DELETE CASCADE)
  albumId         text  PK            -- no FK
  showInTimeline  boolean NOT NULL
  addedById       text?
  createdAt       datetime
  updatedAt       datetime
```

Fed by `SharedSpaceAlbumLinkV1`. Composite PK `(spaceId, albumId)`. Carries the per-space
`showInTimeline` that the timeline branch filters on.

### 4.3 `shared_space_album_asset` (membership, keyed by album+asset)

```
shared_space_album_asset
  albumId  text  PK            -- no FK
  assetId  text  PK            -- no FK (asset row may be unsynced)
```

Fed by `SharedSpaceAlbumToAssetV1` (`{albumId, assetId}`). Keyed by `(albumId, assetId)` — membership
is per-album (not per-space), so an album linked to two spaces dedupes here. The asset **blobs**
themselves land in the shared `remote_asset` table via the asset/exif handlers (delegated, exactly as
the library/space-asset path does) — there is **no** separate space-album asset table.

### 4.4 Delete-cleanup semantics (important — differs from libraries)

- `SharedSpaceAlbumLinkDeleteV1 {spaceId, albumId}` → delete the `shared_space_album_link` row for
  `(spaceId, albumId)`. The shelf entry for that space drops; metadata/membership untouched (the album
  may remain via another space).
- `SharedSpaceAlbumDeleteV1 {albumId}` (the **gated** metadata delete — the album is fully gone for
  this user) → delete the `shared_space_album` metadata row **and sweep** `shared_space_album_asset`
  for that `albumId`. **The server sends no per-asset membership deletes on revocation** (the
  `album_asset` rows still exist server-side; only the user's grant was revoked), so the client must
  sweep the membership join itself when the album metadata is revoked. The `remote_asset` blobs are
  **not** swept (shared, possibly reachable by another path) — matching the library handler's
  "no-sweep" rule for asset rows.
- `SharedSpaceAlbumToAssetDeleteV1 {albumId, assetId}` (a photo actually removed from the album) →
  delete the matching `shared_space_album_asset` row; the photo leaves the album grid and the space
  timeline (unless retained by another path).

## 5. Sync wiring

### 5.1 Request types

Add the five Phase-2A request types to the client subscription list
(`mobile/lib/infrastructure/repositories/sync_api.repository.dart`, the `SyncRequestType` list,
**after** `sharedSpaceLibrariesV1`):

```
SyncRequestType.sharedSpaceAlbumsV1            // metadata
SyncRequestType.sharedSpaceAlbumLinksV1        // link
SyncRequestType.sharedSpaceAlbumToAssetsV1     // membership
SyncRequestType.sharedSpaceAlbumAssetsV1       // asset blobs
SyncRequestType.sharedSpaceAlbumAssetExifsV1   // exif
```

Order matches the server's `SYNC_TYPES_ORDER` (metadata → link → membership → assets → exif): the
membership stream must be requested before the asset stream so the client knows the assets the asset
stream references.

### 5.2 `_kResponseMap` (deserialization)

Add 15 entity-type → `fromJson` entries to `_kResponseMap`, reusing existing models:

| Entity type(s)                                                   | Deserialized as                    |
| ---------------------------------------------------------------- | ---------------------------------- |
| `SharedSpaceAlbumV1`, `SharedSpaceAlbumBackfillV1`               | `SyncAlbumV2`                      |
| `SharedSpaceAlbumDeleteV1`                                       | `SyncAlbumDeleteV1`                |
| `SharedSpaceAlbumLinkV1`, `SharedSpaceAlbumLinkBackfillV1`       | `SyncSharedSpaceAlbumLinkV1`       |
| `SharedSpaceAlbumLinkDeleteV1`                                   | `SyncSharedSpaceAlbumLinkDeleteV1` |
| `SharedSpaceAlbumToAssetV1`, `SharedSpaceAlbumToAssetBackfillV1` | `SyncAlbumToAssetV1`               |
| `SharedSpaceAlbumToAssetDeleteV1`                                | `SyncAlbumToAssetDeleteV1`         |
| `SharedSpaceAlbumAssetCreateV1`, `…UpdateV1`, `…BackfillV1`      | `SyncAssetV2`                      |
| `SharedSpaceAlbumAssetExifCreateV1`, `…UpdateV1`, `…BackfillV1`  | `SyncAssetExifV1`                  |

(`SharedSpaceAlbumBackfillV1` is in the contract for symmetry but is never emitted by the server — see
the 2A enum note; a no-op map entry is harmless and keeps the switch exhaustive.)

### 5.3 Dispatch switch + handlers

Add the 15 cases to `sync_stream.service.dart`, cloning the library/space-asset shape, and the
handlers to `sync_stream.repository.dart`:

| Entity type(s)                                      | Handler                                                                                        |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `SharedSpaceAlbumV1` / `…BackfillV1`                | `updateSharedSpaceAlbumsV1` → upsert `shared_space_album` (metadata)                           |
| `SharedSpaceAlbumDeleteV1`                          | `deleteSharedSpaceAlbumsV1` → delete metadata + **sweep** membership (§4.4)                    |
| `SharedSpaceAlbumLinkV1` / `…BackfillV1`            | `updateSharedSpaceAlbumLinksV1` → upsert `shared_space_album_link`                             |
| `SharedSpaceAlbumLinkDeleteV1`                      | `deleteSharedSpaceAlbumLinksV1` → delete link row                                              |
| `SharedSpaceAlbumToAssetV1` / `…BackfillV1`         | `updateSharedSpaceAlbumToAssetsV1` → upsert `shared_space_album_asset` (onConflict DoNothing)  |
| `SharedSpaceAlbumToAssetDeleteV1`                   | `deleteSharedSpaceAlbumToAssetsV1` → delete membership row                                     |
| `SharedSpaceAlbumAssetCreate/Update/BackfillV1`     | delegate to existing `updateAssetsV1` (shared `remote_asset`) with a `space-album` debug label |
| `SharedSpaceAlbumAssetExifCreate/Update/BackfillV1` | delegate to existing `updateAssetsExifV1`                                                      |

**Absorbed invariant on device:** none of these handlers touch the personal `remote_album` /
`remote_album_asset` tables. A test asserts the personal album list is unaffected by space-album sync.

## 6. Timeline composition

### 6.1 Space timeline — third union branch

`sharedSpace()` (`timeline.repository.dart`) today LEFT-JOINs `shared_space_asset` ∪
`shared_space_library`. Phase 2B adds a third branch through the **membership** table (albums are
many-to-many — there is no `remote_asset.albumId` analogue to the library's `libraryId`):

```
LEFT JOIN shared_space_album_asset ssaa ON ssaa.assetId = remote_asset.id
LEFT JOIN shared_space_album_link  ssal ON ssal.albumId  = ssaa.albumId
                                       AND ssal.spaceId   = :spaceId
                                       AND ssal.showInTimeline = TRUE
```

…and extend the `WHERE` predicate to include `ssal.albumId IS NOT NULL` (alongside the existing
`shared_space_asset` / `shared_space_library` not-null checks). Keep the existing `COUNT(DISTINCT
remote_asset.id)` so an asset reachable by multiple paths is counted once. Drift's reactive watch
makes the grid update live when a `showInTimeline` toggle's `PATCH` + sync-nudge lands.

### 6.2 Space-album detail query — `spaceAlbum(spaceId, albumId)`

Add `spaceAlbum({required String spaceId, required String albumId, …})` to `TimelineFactory`
(`mobile/lib/domain/services/timeline.service.dart`) + the backing repository query: assets in
`shared_space_album_asset WHERE albumId = :albumId` joined to `remote_asset`. **No** `showInTimeline`
filter here — the detail page shows all the album's photos regardless of the timeline toggle. `spaceId`
is carried for the header (`{count} photos · in {space.name}`) and role gating.

## 7. UI surfaces

**Frontend source of truth.** The five surfaces' full layouts (the ASCII mockups, tile dimensions,
spacing, the dim+⊘ off-timeline treatment, card grids, kebab/bottom-sheet orderings, empty states) are
specified in the [Phase-2 mobile design §Surfaces 1–5](./2026-06-15-space-albums-phase2-mobile-design.md#surfaces)
and the **Design language** section there (GoogleSans, Material 3 `ColorScheme`, card radius 16,
`surfaceContainer*` layering, `withValues(alpha:)` never `withOpacity`, `ImmichToast`, `AlertDialog`
confirms). **Those sections are binding** — each UI slice below (B2–B5) carries its named mockup into
the plan verbatim; this spec pins only the implementation decisions and reuse points that were settled
at spec time:

1. **Albums shelf** (B2 — mobile design §Surface 1) — a combined top sliver (D2) on `SpaceDetailPage`
   (`mobile/lib/pages/library/spaces/space_detail.page.dart`): sync banner stacked above a horizontal
   album shelf (cover tile ≈100–112px, radius 16, name below; "Albums (N) · See all ▸" header row).
   Backed by a `spaceAlbumsProvider.family<List<…>, String>(spaceId)` watching the `shared_space_album`
   ⋈ `shared_space_album_link` Drift join. **Visibility rules:** count>0 → full shelf + (editor) Link
   tile; count==0 & editor → slim one-row Link-tile shelf; count==0 & viewer → shelf **hidden**.
   Off-timeline (`showInTimeline=false`) tile dimmed (~60%) + `Icons.visibility_off` ⊘.
2. **List / manage page** (B3 — mobile design §Surface 2) — `SpaceAlbumsRoute(spaceId)`; 2-column
   responsive grid (radius 16), card ⋮ (Show/Hide-in-timeline, Unlink-with-confirm) and "＋ Link"
   app-bar action gated on editor; centered empty state (`Icons.photo_album_outlined` + editor CTA).
3. **Album detail page** (B4 — mobile design §Surface 3) — `SpaceAlbumDetailRoute(spaceId, albumId)`;
   a near-clone of `RemoteAlbumPage` (`mobile/lib/presentation/pages/drift_remote_album.page.dart`)
   using `timelineFactoryProvider.spaceAlbum(...)`, header `{count} photos · in {space.name}`, with a
   **reduced** kebab + bottom sheet gated on **space role** (D3): kebab = Add photos / Show-Hide in
   timeline / Unlink; bottom sheet = Download / Share / Remove-from-album. **Absent**: Delete /
   Add-users / Shared-link / Set-cover / Favorite / Archive / Trash / Lock. Viewer sees no kebab.
4. **Link picker** (B5 — mobile design §Surface 4) — `SpaceLinkAlbumRoute(spaceId, linkedAlbumIds)`,
   slide-up matching `SpaceMemberSelectionRoute`; clones the searchable multi-select `AlbumSelector`
   (`mobile/lib/presentation/widgets/album/album_selector.widget.dart`), candidate list = albums the
   user owns/can edit (existing `getUserRole`), **excluding** already-linked ids; "Link (N)" loops the
   Phase-1 `PUT /shared-spaces/:id/albums/:albumId` + sync-nudge → toast → pop.
5. **Timeline composition** (mobile design §Surface 5; folded into B0/B6) — §6.1.

## 8. Role → UI mapping

Per the mobile design's role matrix (client mirrors it; the server is authoritative). Viewer:
read-only (see shelf/list/detail/synced photos, no link/unlink/toggle/add/remove). Editor & Owner:
full parity (link/unlink/toggle/add/remove). Link additionally requires the actor to own/edit the
album (picker candidate filter + server). Album _deletion_ is never offered in-space.

## 9. Edge cases & invariants (→ tests)

| Case                                           | Handling                                                                                                  |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Absorbed invariant (on device)                 | space-album sync never writes `remote_album*`; album appears only in the space surfaces.                  |
| Member joins space with pre-linked albums      | backfill streams (`…BackfillV1`) deliver metadata + link + membership + asset/exif; surfaces populate.    |
| Album linked to two spaces                     | one `shared_space_album` metadata row + one `shared_space_album_asset` per asset; two `…_link` rows.      |
| Unlink from one of two spaces                  | `LinkDeleteV1` drops that space's `…_link` row only; metadata/membership retained (other space).          |
| Full revocation (leave / last unlink)          | `LinkDeleteV1` drops the link **and** `AlbumDeleteV1` drops metadata + sweeps membership (§4.4).          |
| Photo removed from album                       | `ToAssetDeleteV1` drops the membership row; photo leaves grid + timeline unless retained by another path. |
| `showInTimeline = false`                       | album browsable in shelf/list/detail; **excluded** from the timeline branch (§6.1); cover dimmed + ⊘.     |
| Toggle `showInTimeline`                        | `PATCH` + sync-nudge → `…_link.showInTimeline` flips → reactive watch flips photos in/out of the grid.    |
| Cover asset not synced locally                 | `Icons.photo_album_outlined` fallback (D4).                                                               |
| Viewer attempts a mutation                     | no affordance shown (D3); server would also reject.                                                       |
| Editor who is not the album owner adds/removes | allowed (D3 — Phase-1 server permits; no client ownership gate).                                          |

## 10. Testing strategy (TDD mandatory — authoritative coverage contract)

Every row below is **RED-first** (a failing test before the production code). This list is the
coverage contract: the implementation plan **must** turn each row into a concrete test in its slice,
and it covers **every** §9 edge case and the §8 role matrix. Tests clone the existing
`shared_space_library` Drift/dispatch test patterns and the existing space/album widget tests.

### 10.1 B0 — Drift (in-memory DB)

- upsert + delete for **each** of the three entities (`shared_space_album`, `shared_space_album_link`,
  `shared_space_album_asset`).
- **metadata-delete sweep** (§4.4, the highest-risk divergence): deleting a `shared_space_album` row
  also removes that album's `shared_space_album_asset` rows, and leaves `remote_asset` blobs intact.
- link-delete drops only the `(spaceId, albumId)` row; membership/metadata untouched.
- `spaceAlbum(spaceId, albumId)` returns exactly the album's assets (no `showInTimeline` filter).
- `sharedSpace()` union: includes an album's assets **iff** its `…_link.showInTimeline = true`;
  **excludes** them when false; an album asset that is **also** direct-added or library-linked is
  counted **once** (multi-path `COUNT(DISTINCT)`).
- **two-spaces dedup**: an album linked to two spaces → one metadata row, one `…_album_asset` per
  asset, two `…_link` rows; the asset appears once in each space's timeline.

### 10.2 B1 — Sync dispatch

- each of the **15** entity types routes to the correct handler/table; the three `*BackfillV1` variants
  route **identically** to their create/upsert counterparts (backfill scenario, §9).
- asset / exif types **delegate** to `updateAssetsV1` / `updateAssetsExifV1` → land in `remote_asset`,
  never a space-album table.
- deletes: link-delete → drop `…_link` row; metadata-delete → drop metadata **and sweep** membership;
  membership-delete (`ToAssetDeleteV1`) → drop the `…_album_asset` row.
- **absorbed invariant**: a full space-album sync leaves personal `remote_album` / `remote_album_asset`
  untouched (assert the personal album list is unaffected) — the on-device analogue of the server's
  absorbed test.

### 10.3 B2–B5 — Widget (one suite per surface; render × role × state)

- **B2 shelf**: renders linked albums; the **three visibility cases** — count>0 (full shelf + editor
  Link tile) / count==0 & editor (slim Link-tile row) / count==0 & viewer (shelf **hidden**);
  off-timeline album rendered dimmed + `visibility_off` ⊘; **cover-not-synced** shows the
  `Icons.photo_album_outlined` fallback (D4); the combined top sliver composes with the sync banner
  (D2 — both render, summed height).
- **B3 list/manage**: editor sees card ⋮ (toggle/unlink) + "＋ Link"; viewer sees **neither**; empty
  state renders (editor CTA vs viewer plain).
- **B4 detail**: kebab + bottom-sheet actions gated on **space role** (D3) — editor/owner see
  Add-photos / Show-Hide / Unlink + Download / Share / Remove-from-album; viewer sees **no** mutating
  actions and **no** kebab; the excluded actions (Delete / Add-users / Shared-link / Set-cover /
  Favorite / Archive / Trash / Lock) are **absent** for everyone.
- **B5 link picker**: candidate list = albums the user owns/can edit, **excluding** already-linked ids;
  search filters; multi-select returns N; empty state ("No albums to link").

### 10.4 B6 — Mutations + gating (each mutation + its negative)

- link / unlink / toggle `showInTimeline` / add-photos / remove-photos each hit the Phase-1 endpoint
  **and** fire the sync-nudge (`backgroundSyncProvider.syncRemote()`) — assert the nudge each time.
- **reactive toggle flip**: after the toggle's `PATCH` + nudge flips `…_link.showInTimeline`, the space
  timeline grid adds/removes the album's photos live (Drift reactive watch).
- **role matrix** (§8): for **each** affordance (link / unlink / toggle / add / remove), viewer is
  denied (no affordance), editor & owner allowed; album-delete is offered to **no one** in-space.

### 10.5 CI gates + on-device verify (B7)

- **Real gates** (per `feedback_mobile_dart_analyze_ci_fatal_infos` and the master/2A gate lists):
  `dart analyze --fatal-infos lib test` clean (unawaited futures, `withOpacity`, dead null-aware ops);
  the mobile widget/unit-test job green; `make open-api` already current (no client drift — Phase 2A
  regenerated it); the app builds.
- **Manual on-device verify** against a real synced space: a member sees a linked album's photos
  offline; toggle reactivity; off-timeline dimming; the absorbed invariant on device (album not in the
  personal list); add/remove round-trips; a member joining a space with pre-linked albums backfilling.

## 11. Decomposition into `/impl-loop` slices

Strictly sequential B0 → B7 (single workstream; the mobile design's parallel "compression option" does
not apply). Each slice is **RED → GREEN → REFACTOR** — write the slice's §10 tests first, watch them
fail, then implement. The `RED:` pointer on each slice names the §10 rows that gate it.

- **B0 — Drift schema + queries.** The three entities (§4) + DAOs + Drift migration + DB registration;
  the `spaceAlbum()` query (§6.2) and the third `sharedSpace()` union branch (§6.1). **RED: §10.1**
  (all entity upsert/delete, the metadata-delete sweep, the `showInTimeline` union, multi-path dedup,
  two-spaces dedup).
- **B1 — Sync wiring.** The 5 request types (§5.1), the 15 `_kResponseMap` entries (§5.2 — verified
  against the shipped server `sync.dto.ts`), the dispatch switch + handlers (§5.3) including the
  metadata-delete sweep. **RED: §10.2** (15-type routing, backfill variants, asset/exif delegation,
  the three delete handlers, absorbed invariant). **This is the data foundation — verifiable
  end-to-end by sync tests before any UI exists.**
- **B2 — Albums shelf** (combined top sliver, D2; layout = mobile design §Surface 1) +
  `spaceAlbumsProvider`. **RED: §10.3 B2** (render, the three visibility cases, off-timeline dim+⊘,
  cover-not-synced fallback, banner+shelf composition).
- **B3 — List / manage page** (`SpaceAlbumsRoute`; layout = mobile design §Surface 2). **RED: §10.3
  B3** (editor-vs-viewer affordances, empty state).
- **B4 — Album detail page** (`SpaceAlbumDetailRoute`, role-gated kebab/bottom-sheet, D3; layout =
  mobile design §Surface 3). **RED: §10.3 B4** (role-gated kebab/bottom-sheet, excluded actions absent).
- **B5 — Link picker** (`SpaceLinkAlbumRoute`, clone `AlbumSelector`; layout = mobile design
  §Surface 4). **RED: §10.3 B5** (candidate filter own/edit + exclude-linked, multi-link, empty state).
- **B6 — Editor mutations + gating.** link/unlink/toggle/add/remove → Phase-1 APIs + sync-nudge;
  viewer read-only throughout; the timeline toggle's reactive flip. **RED: §10.4** (each mutation +
  the sync-nudge, the reactive flip, the full role matrix viewer-denied/editor-allowed).
- **B7 — Gate + verify.** **RED/gate: §10.5** — `dart analyze --fatal-infos lib test`, the widget/unit
  test job, the app build, then the on-device verify pass.

Sequencing note: B0+B1 land the foundation and unblock the rest. B2–B5 are independent UI surfaces
(could be built in any order once B0/B1 land). B6 wires mutations across them; B7 is the join.

## 12. Open items to confirm during the plan

- **Mobile test harness for Drift/dispatch.** Confirm the existing mobile Drift/sync test setup
  (in-memory DB, the pattern the `shared_space_library` entity/handler tests use) and register any new
  DAO/provider the tests need — the mobile analogue of 2A's `test/medium.factory.ts` registration item.
- **`order` column type** on `shared_space_album` — match whatever `SyncAlbumV2.order` deserializes to
  (string vs int) so the Drift column type is exact.
- **Drift migration number** — pick the next mobile Drift schema version; confirm no collision with an
  in-flight migration.
- **`spaceAlbumsProvider` shape** — confirm the family key (`spaceId`) and whether the shelf needs the
  per-album asset **count** (a `COUNT` subquery over `shared_space_album_asset`) eagerly or lazily.
- **Route registration** — the three new `auto_route` routes (`SpaceAlbumsRoute`,
  `SpaceAlbumDetailRoute`, `SpaceLinkAlbumRoute`) and codegen.
- **Final i18n keys** — reuse `add_photos`/`cancel`/`items_count`/`owned`; add
  `space_albums`/`space_album`/`link_album`/`space_album_count` (confirm exact wording at plan time).

## 13. Rollback

Additive and client-only. The new Drift tables sit unused under an app rollback (the server keeps
emitting the streams harmlessly; an older client simply doesn't request them). No server coordination.
The Drift migration's `down()` drops the three tables. Safe to roll forward/back.
