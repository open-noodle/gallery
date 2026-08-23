# Adding photos to a specific Shared Space album, from every entry point (#965)

Status: draft 2026-08-10. Closes the entry-point gap left by
`2026-07-25-space-add-to-collection-design.md` (web `CollectionPickerModal`) and
`2026-07-26-mobile-spaces-ux-design.md` (mobile `CollectionPicker`).

## Problem

Whether "add this photo to that Shared Space album" is possible depends on which screen the user
started from, and the two clients disagree about which screens work.

| Entry point                              | Personal album | Space pool | **Album inside a space** |
| ---------------------------------------- | -------------- | ---------- | ------------------------ |
| Web — any surface (one shared picker)    | yes            | yes        | **no**                   |
| Mobile — main timeline / search / person | yes            | yes        | yes                      |
| Mobile — inside a personal album         | yes            | **no**     | **no**                   |
| Mobile — favorites, archive, local album | yes            | **no**     | **no**                   |
| Mobile — asset viewer `+` → Album        | yes            | **no**     | **no**                   |

Two independent causes:

1. **Web never lists space-linked albums at all.** `CollectionPickerModal` loads personal albums
   (`getAllAlbums`) plus writable spaces (`getAllSpaces`) and stops there. The only place it lists a
   space's linked albums is `restrictToSpaceId` mode — reached solely from a space surface with a
   non-owned selection (#764 contribution). So the target simply does not exist in the normal picker,
   on any web surface.
2. **Mobile has two different pickers and only one of them knows about spaces.** The fork's
   `CollectionPicker` (album selector **+** `SpaceCollectionSection`) is wired into
   `general_bottom_sheet` and `space_bottom_sheet`; every other add-to-collection surface still
   mounts upstream's bare `AlbumSelector`.

Note that the web gap is uniform — every web surface is equally broken — while the mobile gap is
per-surface. That is why the issue reads as "inconsistent depending on entry point" on mobile and
"missing everywhere" on web.

## What the server already permits — no server change

`Permission.AlbumAssetCreate` has a `checkSpaceLinkedAlbumAccess` arm
(`server/src/utils/access.ts:195`, `access.repository.ts:147`): **every album linked to a space where
the caller is Owner or Editor** grants add-permission, even when the caller is neither album owner
nor album user. `POST /albums/:id/assets` is therefore the one and only call needed; a space-linked
album is dispatched exactly like a personal album.

`GET /shared-spaces/:id/albums` (`SharedSpaceRead`) lists a space's linked albums, and
`GET /shared-spaces` already returns `albumCount` per space (`shared-space.service.ts:143`), which is
what lets a client know a space is expandable without fetching its albums.

So this is a pure client change on both platforms.

## Design

### Guiding rule: one picker per platform, same shape on both

The fix is not "add space albums to N places". It is "there is exactly one add-to-collection picker
per platform, and it offers albums, spaces, and space albums". Web already has one picker used
everywhere, so web needs only the missing rows. Mobile has the right picker already built — it just
is not mounted on every surface.

### Row shape — accordion, mirroring mobile

Mobile's `SpaceCollectionSection` is the reference: a space row with linked albums is expandable;
expanding reveals an "Add to space" child (the pool) plus one child row per linked album. At most one
space is expanded at a time. Web adopts the same shape rather than a flat "Space › Album" list,
because:

- it keeps the picker short when a user has many spaces with many albums;
- it avoids fanning out `getSharedSpaceAlbums` for every space on modal open — the call happens once,
  lazily, when a space is expanded, and is cached for the life of the modal;
- it is the interaction users already know from mobile.

A space with `albumCount === 0` stays a plain row whose click adds to the pool — unchanged from
today, and identical to mobile.

**Accepted wart (web):** a space can appear twice, once under `RECENT` and once under `ALL`.
Expansion is keyed by space id, so both occurrences expand together and render the same children.
The alternative — expandable only in `ALL` — would give the same visual row two different click
behaviours, which is worse.

### Search

Search filters **top-level rows only**, on both platforms: album names/descriptions and space
names. Children of an expanded space are not filtered. This is mobile's current behaviour and is kept
verbatim on web so the two stay in step. Making search reach into space albums requires eagerly
loading every space's albums (web: N requests; mobile: N live Drift subscriptions, which
`SpaceCollectionSection` deliberately bounds to one) and is out of scope.

### Web changes

`web/src/lib/components/shared-components/collection-selection/collection-selection-utils.ts`

- `CollectionModalRow` gains `expandable?`, `expanded?`, `indented?`.
- New row type `SPACE_POOL_CHILD` — selectable, carries the space collection, rendered indented
  under an expanded space row. Added to `isSelectableRowType` so keyboard nav counts it.
- `toModalRows` gains `expandedSpaceId?` and `expandedSpaceAlbums?: PickerCollection[]`. After
  pushing a space row whose id matches `expandedSpaceId` it pushes: the pool child, then one indented
  `COLLECTION_ITEM` per linked album, or a `MESSAGE` row (`no_albums_in_space_yet`) when the space has
  none. `expandedSpaceAlbums === undefined` means the fetch is still in flight and is deliberately
  distinct from `[]` — only the pool child renders, so "this space has no albums yet" never flashes
  before the answer is known.
- Children are pushed inside `pushItem` so the running `index` — and therefore arrow-key order —
  stays a single flat sequence over visible selectable rows.

`web/src/lib/modals/CollectionPickerModal.svelte`

- `expandedSpaceId = $state<string | null>(null)` and
  `spaceAlbumCache = $state<Record<string, PickerCollection[]>>({})`.
- Clicking a space row: `albumCount > 0` → toggle expansion (fetching + caching
  `getSharedSpaceAlbums` on first expand, `handleError` on failure and collapse); otherwise → select
  the pool, as today.
- Multi-select on a space row still means the pool. Space-album children participate in multi-select
  like any album row.
- Restricted mode (`restrictToSpaceId`) is untouched — it already lists exactly one space's albums
  and never lists spaces.

`web/src/lib/components/shared-components/collection-selection/space-list-item.svelte`

- New `expandable` / `expanded` props render a chevron and set `aria-expanded`.

Dispatch (`collection.service.ts`) needs **no change**: a space-linked album arrives as
`{ kind: 'album' }` and goes through `addAssetsToAlbums`, which is `POST /albums/:id/assets` — the
endpoint that carries the space-linked permission arm.

### Mobile changes

Replace the bare `AlbumSelector` with `CollectionPicker` on every add-to-collection surface:

| File                                                 | Surface                   |
| ---------------------------------------------------- | ------------------------- |
| `bottom_sheet/remote_album_bottom_sheet.widget.dart` | selection inside an album |
| `bottom_sheet/favorite_bottom_sheet.widget.dart`     | favorites                 |
| `bottom_sheet/archive_bottom_sheet.widget.dart`      | archive                   |
| `bottom_sheet/local_album_bottom_sheet.widget.dart`  | on-device album           |
| `action_buttons/add_action_button.widget.dart`       | asset viewer `+` → Album  |

To make that possible `CollectionPicker` gains three things:

- **`source` (`ActionSource`, default `timeline`)** — the asset viewer dispatches against
  `ActionSource.viewer`, and `_addToAlbum` / `_addToTarget` must pass it through instead of
  hard-coding `timeline`.
- **`assets`** — `SpaceCollectionSection` currently reads `multiSelectProvider.selectedAssets` to
  decide its notices (non-owned / locked / over-cap). In the asset viewer the multiselect is empty,
  which would read as "nothing non-owned" and wrongly offer space targets for someone else's photo.
  `CollectionPicker` resolves the asset set from `source` (timeline → multiselect, viewer →
  `assetViewerProvider.currentAsset`) and passes it down; `SpaceCollectionSection` takes an optional
  `assets` and falls back to the multiselect so its existing tests and callers are unaffected.
- **`onCompleted`** (optional) — the asset viewer needs its existing post-add behaviour preserved:
  invalidate `albumsContainingAssetProvider` (the info panel's "Appears in" list) and pop the sheet.

**Deliberately excluded: `partner_detail_bottom_sheet`** — but not for the reason first given here.

An earlier draft of this spec claimed a partner's asset "can never reach any space target" and that
"web hides the `+` entirely there". Both were wrong, and checking the code settled it:

- `Permission.AssetShare` is owner **∪ partner**, not owner-only — `access.ts:127-131` unions
  `checkPartnerAccess`. So `POST /shared-spaces/:id/assets` accepts a partner's assets.
- Web's partner route does not consult `getSelectionCapabilities` at all; it renders
  `<ActionButton action={Actions.AddToAlbum} />` unconditionally
  (`routes/(user)/partners/[userId]/…/+page.svelte:99`).

The real reason to leave the sheet alone is mobile-side and pre-existing: `selectionHasNonOwned`
(`utils/selection_targets.dart`) treats any asset whose `ownerId` differs from the current user as
unreachable, so mounting the picker on a partner surface would render a Spaces section that is
always collapsed behind a notice — and that notice is itself **stricter than the server**. Relaxing
the rule needs mobile to know which owners are partners, which is a behaviour change to every
surface the rule already governs, not an entry-point fix. Tracked as follow-up; out of scope here.

Note the same rule now reaches one new surface as a side effect of this change: viewing a partner's
photo in the asset viewer shows the notice where previously there was no Spaces section at all. That
is consistent with the timeline's existing behaviour rather than a new class of bug, but it is the
clearest remaining web/mobile divergence.

`drift_album.page.dart` also mounts `AlbumSelector`, but as an album **browser** (tap navigates to the
album), not a picker. Out of scope.

## Known remaining divergences

Found by reviewing the finished change against the goal of parity. None block #965; all are
pre-existing shapes this change did not create.

|                                   | Web                                                         | Mobile                                       |
| --------------------------------- | ----------------------------------------------------------- | -------------------------------------------- |
| Partner surface                   | offers spaces and space albums, and the server accepts them | album-only (see above)                       |
| Space-album page                  | add-to-collection available                                 | `space_album_bottom_sheet` passes no slivers |
| Album you can edit but do not own | add-to-collection available                                 | gated on `ownsAlbum`                         |
| Current space as a target         | offered, so its own albums are reachable from inside it     | filtered out via `excludeSpaceId`            |
| Child-album source                | live `GET /shared-spaces/:id/albums`                        | local Drift, so sync-gated                   |
| Child ordering                    | server order (`album.createdAt DESC`)                       | album name ascending                         |
| Searching a space album by name   | no match — children are not searchable                      | same                                         |

## Out of scope

**Selections over `MAX_SPACE_ASSETS_PER_REQUEST` (50 000).** Web already hides every space row above
that cap, with a notice, because `POST /shared-spaces/:id/assets` cannot take the request. Space
albums go through the album endpoint and are not capped, but they are only reachable by expanding a
space row — so above the cap they disappear along with the spaces. Adding a second, uncapped route to
them would complicate the picker for a case that needs a 50 000-asset selection to reach; the notice
already explains why the section is gone.

**Duplicate rows for an album you own that is linked to a space.** It appears both as a personal
album at the top level and as a child of its space. Mobile has behaved this way since the spaces
section shipped, and the nesting is informative rather than wrong.

The issue's closing note — extending the Album filter from `All / Has album / Has no album` to
"filter by a specific album" so photos can be found from a Space album surface — is a separate
feature request against the filter system, not an entry-point inconsistency. Tracked separately.

Issue #966 (album sort options differing between web and mobile inside a Space) is a different
parity bug and is not touched here.

## Test plan

TDD, red first, per platform.

**Web** — `CollectionPickerModal.spec.ts`, `collection-selection-utils` converter spec:

1. a space with `albumCount > 0` renders as expandable and does **not** immediately fetch its albums;
2. clicking it calls `getSharedSpaceAlbums({ id })` once and renders one child row per linked album
   plus the "Add to space" pool child;
3. clicking a space-album child confirms with `{ kind: 'album', id: <albumId> }`;
4. clicking the pool child confirms with `{ kind: 'space', id: <spaceId> }`;
5. expanding a second space collapses the first, and re-expanding the first does not re-fetch;
6. a space with `albumCount === 0` is not expandable and its click still confirms with the space;
7. a failed `getSharedSpaceAlbums` calls `handleError` and leaves the row collapsed;
8. arrow-key order walks the children in visual order;
9. restricted mode is unchanged (existing suite must stay green).

**Mobile** — `collection_picker_test.dart`, `space_collection_section_test.dart`, plus one test per
newly-wired surface:

1. `CollectionPicker` dispatches against the `source` it was given (viewer vs timeline);
2. `CollectionPicker` passes viewer assets to `SpaceCollectionSection`, so a non-owned asset in the
   viewer shows the notice and offers no space target;
3. `SpaceCollectionSection` with an explicit `assets` argument ignores the multiselect;
4. `onCompleted` fires after a successful add and not after a failure;
5. each rewired surface renders the collection-picker header (`collection-picker-header`) rather than
   a bare `AlbumSelector`.
