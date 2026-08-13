# Mobile add-to-collection picker: reachable spaces, real thumbnails, and the last two entry points

Follow-up to #965 / PR #970, which made a space album reachable from every add-to-collection
surface. Using that picker on a real library surfaced two presentation problems, and #970's own
design note recorded two entry points it deliberately left alone. This change closes all four.

## The problems

**1. Spaces sit below every album.** `CollectionPicker` stacks `AlbumSelector` then
`SpaceCollectionSection`. On a library with dozens of albums the Spaces section is several screens
down, so the destination #970 existed to expose is effectively unreachable by scrolling.

**2. Spaces and space albums render placeholder icons.** A space row draws a bare
`CircleAvatar` filled with its gradient colour — a flat coloured disc. A space-album child draws a
static `Icon(Icons.photo_album_outlined)`. Personal albums, one section below, draw real photo
thumbnails, so the two halves of the same sheet look like they belong to different apps. The data
to do better is already on the wire and unused.

**3. No picker on the space-album page.** `SpaceAlbumBottomSheet` passes no `slivers:` at all.

**4. No picker on an album you do not own.** `RemoteAlbumBottomSheet` gates the picker on
`ownsAlbum`.

## Decisions

### Layout: keep two sections, put Spaces first

Chosen over interleaving albums and spaces into one sorted list. Interleaving reads as the most
literal "show them together", but it requires injecting fork rows into upstream's album list, and it
lets a space sink into the middle of a long alphabetical run — reintroducing the very problem being
fixed. Two labelled sections with Spaces on top keeps spaces above the fold unconditionally, and
keeps the sections visually distinct, which is honest: a space row expands and carries different
permissions, an album row does not.

### The search field forces a hook, not a reorder

The naive fix — swapping the two children of `CollectionPicker`'s `MultiSliver` — is wrong.
`AlbumSelector`'s own `MultiSliver` is `[_SearchBar, _QuickFilterButtonRow, _QuickSortAndViewMode,
…albums]`, so the search field lives **inside** the upstream widget. Reordering would put the Spaces
section above the search box that filters it.

Spaces must land _between_ `_SearchBar` and `_QuickFilterButtonRow`. Of the three ways to do that:

- **Add one additive prop to `AlbumSelector`** — chosen. The fork already carries exactly this shape
  of additive hook on this widget (`onSearchChanged`, `searchHint`), so this is a one-line insertion
  into upstream code and stays trivially rebasable.
- Lift `_SearchBar` into `CollectionPicker` — drags `searchController`, `searchFocusNode`,
  `clearSearch` and `filterMode` across the fork boundary for no extra benefit.
- Pin the Spaces section as a sticky sliver — solves the problem only while scrolled to the top, and
  adds sliver complexity.

Both labels must appear and disappear together: `SpaceCollectionSection` already collapses to
`SizedBox.shrink()` when the user has no writable spaces, and a user in no space must not be shown a
lone `ALBUMS` header over the layout they see today.

Only `SpaceCollectionSection` knows whether it rendered — that verdict depends on the writable-space
filter, `excludeSpaceId` and the search query, and recomputing it in `CollectionPicker` would
duplicate logic that could then drift. So the section takes an optional `Widget? footer` and renders
it only on the path where it renders itself; `CollectionPicker` passes the `ALBUMS` label as that
footer. The section keeps owning the `SPACES` label it already renders, and stays ignorant of what
the footer contains.

### The album gate is removed, not widened

Web's album route gates the add action on `canAddToAlbum: () => viewMode === AlbumPageViewMode.VIEW`
(`web/src/routes/(user)/albums/[albumId=id]/…/+page.svelte:289`) — view mode only, **no ownership
test**. Mobile's `ownsAlbum` gate is therefore stricter than web, and the parity fix is to drop it,
not to widen it to editors.

This is also correct on the merits: adding assets to a collection requires rights over the
**destination**, never over the source album. The picker already enforces destination rights — the
spaces section hides itself behind a notice for a non-owned selection, and the server enforces
`Permission.AlbumAssetCreate` regardless. `ownsAlbum` continues to gate the genuinely
ownership-bound actions in that sheet (remove-from-album, set-cover, delete); only the `slivers:`
argument changes.

### The current space is offered from inside its own album

`excludeSpaceId` exists so a space is not offered as a destination for its own pool assets. On the
space-album page the useful action is the opposite: moving a photo from one album to another inside
the same space. Web already offers the current space for this reason, so the space-album sheet
passes no `excludeSpaceId`. This closes a third row of #970's divergence table as a side effect.

## Changes

### `mobile/lib/presentation/widgets/album/album_selector.widget.dart` (upstream, additive)

- New optional `Widget? sliverAfterSearch`, rendered in the `MultiSliver` immediately after
  `_SearchBar` and before `_QuickFilterButtonRow`. Null by default, so upstream behaviour and every
  other call site — including `drift_album.page.dart`, which mounts `AlbumSelector` as a browser
  rather than a picker — is untouched.
- `MultiSliver.children` is a non-nullable `List<Widget>`, so the prop is spread conditionally
  (`if (widget.sliverAfterSearch != null) widget.sliverAfterSearch!`) rather than dropped into the
  list, which would not compile.
- The prop takes a **sliver**, as its name says. `SpaceCollectionSection` is a box widget returning a
  `Column`, so `CollectionPicker` keeps wrapping it in the `SliverToBoxAdapter` it already uses
  today. `AlbumSelector` stays ignorant of that.

### `mobile/lib/presentation/widgets/collection/collection_picker.widget.dart`

- Stop appending `SpaceCollectionSection` after `AlbumSelector`. Pass it through the new
  `sliverAfterSearch`, handing it the `ALBUMS` label as its `footer` so the label shares the
  section's visibility.
- The label reuses the existing `albums` i18n key, as the section's header already reuses `spaces`.
  No new keys, so this change adds no nine-locale translation work.
- **This does not introduce a new rebuild loop — `AlbumSelector` was already reconstructed on every
  keystroke.** `_searchQuery` lives in `CollectionPicker`; in the old `build`, `AlbumSelector(...)`
  was already a direct, non-const child of the same `MultiSliver` as `SpaceCollectionSection`'s
  `SliverToBoxAdapter` sibling, so `onSearchChanged` → `setState` → `CollectionPicker` rebuilds →
  a fresh `AlbumSelector` widget → `Element.update` → `_AlbumSelectorState.build` was already
  happening before this change, and `searchController` / `searchFocusNode` were already surviving
  that rebuild by element identity. What actually changes here is only the **tree position** of
  `SpaceCollectionSection`'s element: it moves from being `AlbumSelector`'s sibling to being its
  child (passed in as `sliverAfterSearch`). That position change is still worth guarding — a
  mistake in the new wiring could plausibly disrupt `AlbumSelector`'s element identity in a way the
  old sibling layout could not — so the existing `collection_picker_test.dart` case "typing in the
  search field narrows the spaces section too" must stay green unmodified: treat any need to edit
  it as evidence the restructure broke something, not as test maintenance.

### `mobile/lib/presentation/widgets/collection/space_collection_section.widget.dart`

- Space row `leading`: `CircleAvatar` → `SpaceCollage`. Its `recentAssetIds` /
  `recentAssetThumbhashes` are **required non-null `List<String>`**, while the DTO exposes
  `Optional<List<String>?>`, so each unwraps as `space.recentAssetIds.orElse(null) ?? const []`.
  `size` is also required and has no default: pass **32**, matching the `radius: 16` `CircleAvatar`
  being replaced, so row height does not shift. `color` keeps feeding the existing gradient, which is
  what `SpaceCollage` already falls back to when the id list is empty. `SpaceCollage` is already
  imported in this file for `spaceGradientColors`.
- Space-album child `leading`: `Icon(Icons.photo_album_outlined)` → `Thumbnail.remote(...)` when
  `album.thumbnailAssetId` is non-null, falling back to the icon when null.

  `Thumbnail.remote` requires **both** `remoteId` and a non-nullable `thumbhash`, and `SpaceAlbum`
  carries no thumbhash. `AlbumSelector` obtains one for personal albums by wrapping the widget in a
  `FutureBuilder` over `assetServiceProvider.getRemoteAsset(...)`. This change deliberately does
  **not** copy that: it passes `thumbhash: ''`.

  Note what the thumbhash actually does on this constructor, because it is not what the name
  suggests. `Thumbnail.remote` sets `thumbhashProvider = null`
  (`thumbnail.widget.dart:31`), so it renders **no** blur placeholder; the placeholder path belongs
  to the other constructor, which derives it from a `RemoteAsset`. Here the value is passed straight
  to `getThumbnailUrlForRemoteId`, which appends it as a **cache-busting query parameter**
  (`image_url_builder.dart:16` — `'$url&c=${Uri.encodeComponent(thumbhash)}'`). An empty string is
  non-null, so the URL simply ends in `&c=`; nothing decodes it and nothing throws.

  So passing `''` costs no placeholder, because this constructor never draws one. The real cost is
  narrow and worth stating: with a constant `c=`, the URL for a given asset id never changes, so a
  client-cached thumbnail can survive the server regenerating that asset's thumbnail. Picking a
  different album cover changes `thumbnailAssetId` and therefore the URL, so only re-generation of
  the _same_ asset goes stale. That is a better trade than one asset fetch per space-album row on
  every expand. Giving `SpaceAlbum` a real thumbhash (Drift column plus sync-stream field) is the
  honest fix and is out of scope here.

- The "Add to space" pool child keeps its icon. It is an action, not a collection.
- New optional `Widget? footer`, appended inside the `Column` on the paths where the section renders
  and therefore skipped by both `SizedBox.shrink()` early returns. It **does** render on the notice
  path (non-owned selection, locked selection, or over the asset cap), where the section draws its
  header and notice but no space rows — albums still follow it there. Keeps the existing `SPACES`
  label as-is.

  A consequence worth naming, because it looks like a bug on first sight and must not be "fixed"
  later: a search query matching some albums but **no** space collapses the whole section, so the
  `ALBUMS` label disappears while the album list stays. That is intended — with one section left, a
  section label is noise — and it is pinned by a test below.

### `mobile/lib/presentation/widgets/bottom_sheet/remote_album_bottom_sheet.widget.dart`

- `slivers: ownsAlbum ? [CollectionPicker(...)] : null` → always pass the picker. Every other
  `ownsAlbum` branch in the file is unchanged.

### `mobile/lib/presentation/widgets/spaces/space_album_bottom_sheet.widget.dart`

- Pass `slivers: [CollectionPicker(onKeyboardExpanded: …)]`, with no `excludeSpaceId`. The sheet's
  constructor is `{canEdit, albumId, onRemoved}` and carries **no `spaceId` at all**, so offering the
  current space is not merely the chosen behaviour but the one needing no new plumbing.
- The keyboard-expand callback animates to **0.85**, this sheet's `maxChildSize`, as the other sheets
  animate to theirs.
- Its existing actions all dispatch against `ActionSource.timeline`, so the picker takes the default
  `source` and omits `assets`, reading the timeline multiselect exactly as the other multi-select
  sheets do.

## Testing

**Test-first, one behaviour at a time.** For each behaviour below: write the test, run it, and
**record the actual red failure message** — not "it should fail" — then write the smallest change
that turns it green, then move to the next. A test that passes before its production change is
written is not evidence of anything and must be rewritten until it discriminates. #970 established
this bar: its second commit was a set of regressions each confirmed red against the unfixed code,
and its own review found a test that asserted `limit: 1000` and thereby locked a bug in.

Two failure modes to guard against specifically, both of which have bitten this repo:

- **Assertions that cannot fail.** `queryBy…` returning null passes whether or not the widget exists.
  Assert on presence with `findsOneWidget` / `findsNothing` against a key, and for ordering assert on
  resolved coordinates as the existing `headerY < albumsY` test does.
- **Mocking the layer under test.** These are widget tests over real `SpaceCollectionSection` /
  `CollectionPicker` composition; stub the providers, never the widget whose layout is the subject.

### `collection_picker_test.dart` — layout

| #   | Given                                  | When                                    | Then                                                                                          |
| --- | -------------------------------------- | --------------------------------------- | --------------------------------------------------------------------------------------------- |
| L1  | a user with writable spaces and albums | the picker builds                       | the Spaces section resolves **above** the album list, and both sit **below** the search field |
| L2  | the same                               | the picker builds                       | `SPACES` and `ALBUMS` labels both render                                                      |
| L3  | a user with **no** writable spaces     | the picker builds                       | neither label renders, and the album list is the only section                                 |
| L4  | writable spaces exist                  | a query matches albums but **no** space | the section and **both** labels collapse; album results still render                          |
| L5  | a non-owned selection (notice path)    | the picker builds                       | header, notice and the `ALBUMS` footer all render, with no space rows                         |

| L6 | the picker is mounted | text is typed into the search field | the field keeps its text **and its focus**, and the spaces section narrows |

L1 is the behaviour the change exists for; it must be red against today's ordering before the hook is
added. L4 pins the emergent collapse described above so it is not later "fixed" into a bug.

L6 is the regression guard on the rebuild loop, and it behaves unlike every other row here: it is
**green before and after**, so it demonstrates nothing on its own and earns its place only by being
run against the restructure. The pre-existing case "typing in the search field narrows the spaces
section too" already covers the narrowing half and must stay green **unmodified**. Extend it with an
explicit focus assertion (that the field's `EditableText` still holds focus), because asserting only
on the narrowed rows would pass even if focus were dropped on every keystroke — which is precisely
the failure the new loop makes possible, and which no other test here would catch.

### `space_collection_section_test.dart` — thumbnails

| #   | Given                                            | When                | Then                                                                                           |
| --- | ------------------------------------------------ | ------------------- | ---------------------------------------------------------------------------------------------- |
| T1  | a space with recent asset ids                    | the row renders     | `SpaceCollage` renders, and no bare `CircleAvatar` remains                                     |
| T2  | a space with an **empty** recent-asset list      | the row renders     | `SpaceCollage` still renders, on its gradient empty state — the widget is present, not skipped |
| T3  | a space album **with** `thumbnailAssetId`        | the child renders   | `Thumbnail` renders in the leading slot                                                        |
| T4  | a space album with a **null** `thumbnailAssetId` | the child renders   | the `photo_album_outlined` icon renders and no `Thumbnail` is built                            |
| T5  | an expanded space                                | the children render | the "Add to space" pool child still shows its icon, not a thumbnail                            |

T2 and T4 are the null/empty boundaries; T5 guards the pool child from being swept into the
thumbnail change.

### `add_to_collection_surfaces_test.dart` — the two new entry points

| #   | Given                                                      | When              | Then                                                                                                   |
| --- | ---------------------------------------------------------- | ----------------- | ------------------------------------------------------------------------------------------------------ |
| S1  | the space-album sheet                                      | it builds         | it offers the picker (it renders none today — this is the red test)                                    |
| S2  | the space-album sheet for a space the user can write to    | the picker builds | that same space **is** offered as a target                                                             |
| S3  | an album the user does **not** own                         | the sheet builds  | the picker renders                                                                                     |
| S4  | a non-owned album whose selected assets are also non-owned | the sheet builds  | the picker renders, with the spaces section showing its non-owned notice — the album half stays usable |
| S5  | an album the user **does** own                             | the sheet builds  | the picker still renders — the ungating changed no owner behaviour                                     |

S4 is the combination the ungating newly makes reachable: it is the case most likely to be wrong and
is invisible to S3 alone. S5 is the regression guard on the branch being removed.

## Out of scope

- **Capping the spaces list.** With a handful of spaces it is unnecessary; a "show all" affordance is
  complexity to add only if it bites.
- **A thumbhash for space albums.** Their thumbnails render without a blur placeholder because
  `SpaceAlbum` has no thumbhash to give (see above). Carrying one would mean a Drift column plus a
  sync-stream field, which is a data change, not a presentation one.
- **The partner-surface rule.** Mobile's `selectionHasNonOwned` remains stricter than the server.
  Relaxing it needs mobile to learn which owners are partners, which changes every surface that rule
  governs — unchanged from #970's assessment.
- **Child-album source and ordering.** Space-album children still come from local Drift in name
  order, where web uses a live endpoint in `createdAt DESC`.
- **Searching a space album by name.** Children are still not searchable, on either platform.
