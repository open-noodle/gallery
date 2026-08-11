# Space albums UX fixes + Spaces-in-navbar setting

**Date:** 2026-08-11
**Branch:** `feat/space-album-folders-mobile`
**Status:** approved, ready for planning

## 1. Context

User feedback on the space-album-folders branch produced nine reports. Five are in scope here; the rest are
triaged in §8. Four are small, mechanical corrections to surfaces this branch already introduced. The fifth is
a new, self-contained mobile feature: a setting that puts **Spaces** in the bottom navigation bar in place of
**Albums**.

Nothing here changes the server, the API, the database, or any sync path. Items 1–4 are confined to four
existing files plus their specs; item 5 touches the fork-only gallery bottom-nav stack and the settings
plumbing.

### In scope

| ID  | Platform | Summary                                                              |
| --- | -------- | -------------------------------------------------------------------- |
| F1  | mobile   | Space albums app-bar actions become icon-only                        |
| F2  | mobile   | Reaching the space albums/folder view is a real tap target           |
| F3  | web      | Dragging a folder shows a small label chip, not a full-card snapshot |
| F4  | web      | Space albums list header reads "Number of items", not "items"        |
| F5  | mobile   | Spaces in the bottom nav by default, switchable back to Albums       |

### Out of scope

Deferred by explicit decision, not oversight — see §8 for each.

## 2. Method: TDD and BDD

Every change below follows the same loop, and no production line is written before the test that fails
without it.

1. **Red** — write the scenario from §3 as a test. Run it. Confirm it fails, and that it fails for the stated
   reason rather than a harness error (a widget test that throws "no MaterialApp" is not a red test).
2. **Green** — write the minimum production code that makes it pass.
3. **Refactor** — tidy with the test still green.

Scenarios are written Given/When/Then and map 1:1 onto test cases. A scenario that cannot be expressed as an
assertion on observable behaviour is not a scenario — it is a note, and belongs in prose.

**Two harness rules this repo has been bitten by**, both of which apply directly to the tests below:

- An assertion that passes whether or not the code is correct is worse than no assertion. `queryBy…` returning
  `null` for a widget that never existed, or a `find.byKey` on a key the widget never had, both go green
  against an unimplemented feature. Each new test must be observed failing first.
- `dart analyze` is not a substitute for `flutter test`. Generated-code and enum-exhaustiveness breaks only
  surface when the test actually compiles.

## 3. The changes

### F1 — Icon-only actions on the space albums app bar

**Current.** `mobile/lib/pages/library/spaces/space_albums.page.dart:430-449` renders three `TextButton.icon`
actions — New folder, New album, Link — each with a full text label. On a narrow phone the three labels plus
the page title crowd the bar.

**Change.** Each becomes an `IconButton` carrying the former label as its `tooltip`. Keys are unchanged, so
all twelve existing `find.byKey` references keep working. Icons stay `create_new_folder_outlined` and
`photo_album_outlined`; **Link changes from `Icons.add` to `Icons.add_link`** — stripped of its label, a bare
`+` no longer says what it adds, and `add_link` matches web's `mdiLinkVariantPlus`. Icon-only unconditionally:
no width breakpoint, no tablet special case.

**Scenarios.**

```gherkin
Scenario: an editor sees three icon-only actions
  Given the space albums page rendered with canEdit true
  Then the New folder, New album and Link actions are each an IconButton
  And no TextButton is present in the app bar

Scenario: each action keeps its label as a tooltip
  Given the space albums page rendered with canEdit true
  Then the New folder action's tooltip is the space_album_folder_new string
  And the New album action's tooltip is the space_album_new string
  And the Link action's tooltip is the link string

Scenario: a viewer sees no actions
  Given the space albums page rendered with canEdit false
  Then none of the three action keys are present

Scenario: tapping an icon still triggers its action
  Given the space albums page rendered with canEdit true
  When the New folder action is tapped
  Then the folder-name dialog is shown
```

**Edge cases.** The viewer case is already covered at `space_albums_page_test.dart:400,418,699,798` and must
stay green unchanged — that is the regression signal that gating was not disturbed. Tooltips must be asserted
by looking up the `IconButton`'s `tooltip` property, not by pumping a long-press and searching for text: the
latter is slow and flakes on overlay timing.

The "no `TextButton` in the app bar" assertion must be scoped to the app bar. This page also builds
`TextButton`s inside `_FolderNameDialog` and the delete-confirmation dialog; a bare `find.byType(TextButton)`
happens to pass at rest only because no dialog is open, which makes it a coincidence rather than an assertion.
Scope the finder with `find.descendant(of: find.byType(AppBar), …)`.

### F2 — Getting into the space albums / folder view

**Current.** `_HeaderRow.build` in `mobile/lib/presentation/widgets/spaces/space_albums_shelf.widget.dart`
wraps only the "See all" `Text` in a `GestureDetector`, so the tap target is the text's own bounds — a
`bodySmall` line, far below the 48dp minimum. Worse, `_buildShelf` passes `showSeeAll: albums.isNotEmpty`, so
the affordance disappears entirely when the space has no linked albums.

That second part is a functional hole, not a polish item: with zero linked albums, mobile has **no route at
all** to the space albums page. Verified — `SpaceAlbumsRoute` has exactly two push sites in the app,
`space_detail.page.dart:448` (this callback) and `space_albums.page.dart:592` (the page recursing into a
subfolder), and the latter is only reachable from the former. The shelf's only other control is the Link tile,
which links an album that already exists. So an editor cannot create an album, and cannot create a folder,
from a fresh space on mobile — the page holding those actions is unreachable.

**Change.**

1. The whole header row becomes one tap target: `_HeaderRow`'s `Row` is wrapped in an `InkWell` carrying the
   existing `onSeeAll` callback.

   No Material chevron is added. `space_albums_see_all` is already `"See all ▸"` — the glyph is in the
   translated string, and every locale's translation carries it — so an `Icons.chevron_right` beside it would
   render two chevrons everywhere. Changing the English value to drop the glyph would leave every other locale
   double-chevroned until re-translated, and a new key would ship English-only. The affordance the report was
   missing is the tap target, not the arrow.

2. `showSeeAll` becomes unconditional. Case 3 of `_buildShelf` (viewer with no albums) already returns
   `SizedBox.shrink` before this point, so "whenever the shelf renders" is the correct condition — an editor
   with an empty space gets the entry, a viewer with an empty space still sees nothing, which is right because
   there is nothing to browse.

No app-bar icon: `space_detail.page.dart`'s `SliverAppBar` already carries three `IconButton`s (visibility,
add-photos for editors, members) plus `SpaceDetailKebab`, and a fifth control would squeeze the space title on
a phone.

**Scenarios.**

```gherkin
Scenario: tapping anywhere on the header row opens the albums page
  Given the shelf rendered with two albums
  When the header row is tapped at the "Albums (2)" title
  Then onSeeAll is called exactly once

Scenario: the tap target spans the full header row
  Given the shelf rendered with two albums in a 400pt-wide viewport
  Then the header row's InkWell is as wide as the shelf

Scenario: an editor with no albums can still reach the albums page
  Given the shelf rendered with zero albums and canEdit true
  Then the See all affordance is rendered
  When it is tapped
  Then onSeeAll is called exactly once

Scenario: a viewer with no albums sees no shelf at all
  Given the shelf rendered with zero albums and canEdit false
  Then the shelf is not rendered

Scenario: a null onSeeAll leaves the row inert
  Given the shelf rendered with two albums and onSeeAll null
  When the header row is tapped
  Then nothing is called and no exception is thrown
```

**Edge cases.** `kSpaceAlbumsShelfHeight` (196.0) is consumed by `SpaceTopSliver._topSliverHeight`
(`space_top_sliver.widget.dart:87,89`) and does not change. The header keeps its 32px allocation: the `InkWell`
wraps the existing `Row` without adding height.

That caps the target at roughly 32dp tall rather than the 48dp Material minimum — a deliberate trade. Reaching
48 would mean growing the shelf to 212 and moving `kSpaceAlbumsShelfHeight`, `SpaceTopSliver`, and
`space_detail_top_sliver_test.dart` in lockstep, for 16 vertical pixels on a target whose width goes from ~50pt
to the full shelf. The width was the defect; take that now and leave the height contract alone.

`SpaceTopSliver`'s height condition (`(albums.isNotEmpty || canEdit)`) already matches the shelf's own render
condition, so making "See all" unconditional does not desynchronise the reserved height from what is drawn.

### F3 — Folder drag image on web

**Current.** `web/src/lib/components/spaces/space-album-folder-card.svelte:69-76` writes the drag payload but
never calls `setDragImage`, so the browser snapshots the whole card — a full-width tile with a four-up collage
— and drags that under the cursor, covering the drop targets. Album cards look different only incidentally:
their drag starts on an `<a>`, so Chrome substitutes its native link chip.

**Change.** A `setDragLabel(event, label)` helper in `web/src/lib/utils/space-album-folder-dnd.ts` builds a
small chip (folder glyph + name), appends it to `document.body` positioned offscreen, calls
`dataTransfer.setDragImage(chip, x, y)`, and removes it on the next tick. Called from the folder card's
`ondragstart` only — album cards are deliberately untouched.

Three implementation constraints, each of which is a real failure if ignored:

- The chip must be **rendered**, not hidden. `display: none` produces no drag image at all; `position:
absolute; top: -1000px` renders it offscreen, which is what the API needs.
- The chip must stay in the DOM at the moment `setDragImage` is called and be removed afterwards — a
  `setTimeout(…, 0)` removal, not a synchronous one.
- The call must be guarded on `typeof dataTransfer.setDragImage === 'function'`. The existing spec's
  `makeDataTransfer` (`space-album-folder-card.spec.ts:27-34`) is a hand-rolled object with only `setData`,
  `getData` and `types`; without the guard, the already-passing dragstart test at line 104 starts throwing.

**Scenarios.**

```gherkin
Scenario: dragging a folder sets a small label drag image
  Given a folder card for "Trips" with canManage true
  When dragstart fires with a DataTransfer that records setDragImage
  Then setDragImage is called once
  And the element it was called with has text content "Trips"

Scenario: the payload is still written
  Given a folder card for "Trips" with canManage true
  When dragstart fires
  Then the DataTransfer carries the folder payload
  And the active-drag slot holds the folder payload

Scenario: a DataTransfer without setDragImage does not break the drag
  Given a folder card and a DataTransfer with no setDragImage method
  When dragstart fires
  Then no exception is thrown
  And the payload is still written

Scenario: the chip is added for the snapshot and then removed
  Given a folder card
  When dragstart fires
  Then a drag-chip element is present in document.body
  When the pending timers are flushed
  Then no drag-chip element is present in document.body

Scenario: a viewer cannot start a drag
  Given a folder card with canManage false
  Then the card is not draggable
```

**Edge cases.** A folder whose name is long must not produce a chip wider than the viewport — the chip caps its
width and truncates. An empty-string name still yields a chip rather than an empty element with zero size,
which some browsers reject as a drag image. The helper never assumes `document` is available at module scope,
so it stays importable under SSR.

The cleanup scenario is written present-then-absent deliberately. Asserting only "no chip in the document"
after the fact is the cannot-fail shape §2 warns about: it passes identically against a correct
implementation, against one that never creates a chip, and against one where `setDragImage` was never called.
The test must therefore drive the removal explicitly — `vi.useFakeTimers()` with `vi.runAllTimers()`, or an
awaited macrotask — rather than hoping the timer has fired by assertion time, which would flake.

### F4 — "items" list header on web

**Current.** `web/src/lib/components/spaces/space-albums-table.svelte:139-141` derives the header text by
formatting a plural string with a zero count and stripping the digits back off:
`$t('items_count', { values: { count: 0 } }).replace(/\d+\s/, '')` → the lowercase, mid-sentence fragment
"items".

**Change.** Use `$t('sort_items')` — "Number of items" — the same string `/albums` renders for that column
(`AlbumsTableHeader.svelte:23`, via `sortOptionsMetadata`). Reusing the existing key means every locale is
already translated; no new i18n key, no untranslated English leaking into other languages.

The two tables' column classes are **not** identical, which matters here. `/albums` gives the item-count
column a base width (`w-4/12 m:w-2/12 md:w-2/12 …` — the `m:` is an upstream typo, so the base width is what
actually applies below `md`), whereas the space table's header cell declares no base width at all
(`sm:w-2/12 md:w-2/12 …`). "Number of items" is four times longer than "items", so on the narrowest
breakpoint the space header can wrap where it previously did not. The change therefore also adds the matching
base width to that `<th>`, and the wrap case gets a scenario.

The other three headers keep their current keys. Issue #972 ("Space album table headers are static and
non-clickable, unlike /albums") wants this whole `<thead>` replaced by the sortable header buttons, and that is
the change that should align the rest — doing half of it here would only create a merge conflict with itself.

**Scenarios.**

```gherkin
Scenario: the item-count column header is a proper label
  Given the space albums table rendered with one album
  Then a column header reading "Number of items" is present
  And no column header reads exactly "items"

Scenario: album rows still show their own counts
  Given the space albums table rendered with an album of 5 assets
  Then a cell reading "5 items" is present

Scenario: the header column carries a base width
  Given the space albums table rendered with one album
  Then the item-count header cell declares a base width class
```

**Edge cases.** The row-level assertion (`space-albums-table.spec.ts:44`, `/5 items/i`) must keep passing — the
row still uses `items_count`, and only the header changed. The header assertion is written to distinguish the
two: a substring match on "items" would pass against the current buggy output, so the header test asserts the
full string and the negative case asserts no header equals exactly `items`.

### F5 — Setting: Spaces instead of Albums in the mobile navbar

**Current.** The fork-only bottom nav has three fixed slots. `GalleryTabEnum { photos, albums, library }`
doubles as the slot map: `GalleryTabEnum.values[activeIndex]` converts router index to tab
(`gallery_bottom_nav.widget.dart:115,164`, `gallery_tab_shell.page.dart:31`) and `tab.index` converts back
(`gallery_bottom_nav.widget.dart:137,156`). `GalleryTabShellPage` declares
`routes: const [MainTimelineRoute(), DriftAlbumsRoute(), DriftLibraryRoute()]` (line 44), matched against the
children declared under `GalleryTabShellRoute` in `router.dart:149-156`.

Spaces is reachable today only by pushing `SpacesRoute` from inside the Library tab
(`drift_library.page.dart:171,557`).

**Change, in four parts.**

**(a) The slot map stops being the enum's index.** `GalleryTabEnum` gains a fourth value, `spaces`, and a
single function becomes the only place index and tab are converted:

```dart
List<GalleryTabEnum> galleryNavSlots({required bool showSpaces}) => [
  GalleryTabEnum.photos,
  showSpaces ? GalleryTabEnum.spaces : GalleryTabEnum.albums,
  GalleryTabEnum.library,
];
```

exposed as `galleryNavSlotsProvider`, derived from `appConfigProvider`. Every `GalleryTabEnum.values[i]`
becomes `slots[i]`, every `tab.index` becomes `slots.indexOf(tab)`, and the pill and rail iterate `slots`
rather than `values`. `gallery_search_action.dart` keeps working unchanged because it targets slot 0, whose
occupant never varies — but it moves onto `slots` too, so no caller is left assuming the old identity.

**(b) The destination gains a Spaces case.** `GalleryNavDestination.forTab(GalleryTabEnum.spaces)` returns
label key `spaces` (existing, translated), `Icons.workspaces_outlined` / `Icons.workspaces` — the pair the
legacy `tab_shell.page.dart:41-42` already uses for its Spaces tab — and `routeBuilder: _spacesRoute`.

**(c) The shell routes conditionally.** `GalleryTabShellPage.routes` becomes
`[MainTimelineRoute(), showSpaces ? SpacesRoute() : DriftAlbumsRoute(), DriftLibraryRoute()]`, and
`router.dart` adds `AutoRoute(page: SpacesRoute.page, guards: [_authGuard, _duplicateGuard])` as a **fourth
declared child** of `GalleryTabShellRoute`. Declared children define what is routable under the shell; the
`routes:` list picks which three are tabs. `_onTabTap` gains a `spaces` case that invalidates
`sharedSpacesProvider`, mirroring what the `albums` case does with `remoteAlbumProvider`. Readonly mode
disables whichever tabs occupy slots 1 and 2, expressed as `{slots[1], slots[2]}` rather than a hardcoded set.

**(d) The setting.** `SettingsKey.navShowSpaces<bool>()` under a new `// Navigation` group, **default `true`**,
backed by a `NavConfig { bool showSpaces }` wired into `AppConfig` — field, constructor, `copyWith`, `==`,
`hashCode`, `toString`, and both the `read` and `write` switches. Those switches are exhaustive over
`SettingsKey`, so the compiler refuses to build until the wiring is complete. `appConfigProvider` is
stream-backed (`settings.provider.dart:7-12`), so a flip re-renders the nav with no restart.

One property of `SettingsRepository.write` shapes how the persistence scenarios below must be written:
writing a value equal to the default does not store it, it **deletes** the row (`return clear([key])`). With
the default at `true`, "on" is therefore represented by the _absence_ of a row and "off" by a stored `false`.
Nothing about the effective config changes — `_build` skips absent keys and `AppConfig.fromEntries` falls back
to `defaultConfig` — but a test asserting "toggling on stores true" would assert something the repository
deliberately never does. Persistence scenarios assert the effective `appConfig.read(navShowSpaces)`, not the
row.

Spaces is the default because it is the surface users reach for most; Albums is one tap away in the Library
tab either way. The switch is therefore phrased positively and ships **on** — "Show Spaces in the navigation
bar" — and turning it off restores Albums.

The UI is a `SettingsSwitchListTile` in a new `nav_setting.dart` under
`mobile/lib/widgets/settings/preference_settings/`, added to `PreferenceSetting`'s list. It follows
`HapticSetting`'s shape but reads and writes through `settingsProvider` / `appConfigProvider`, the newer of the
two settings backends and the one nearly every settings widget already uses — `AppSettingsEnum` is a
four-entry legacy holdover. Two new i18n keys carry the tile's title and subtitle; the subtitle states that
Albums remains available from the Library tab, which is the sentence that has to carry the upgrade case
described below.

**Scenarios.**

```gherkin
Scenario: an upgrading install with rows for other keys but none for this one gets Spaces
  Given a settings store carrying other keys and no navShowSpaces row
  Then appConfig.read(navShowSpaces) is true
  And galleryNavSlots yields [photos, spaces, library]
  And the shell's tab routes are [MainTimeline, Spaces, DriftLibrary]

Scenario: turning the setting off restores Albums
  Given navShowSpaces is false
  Then galleryNavSlots yields [photos, albums, library]
  And the shell's tab routes are [MainTimeline, DriftAlbums, DriftLibrary]

Scenario: the pill renders the Spaces label and icon
  Given navShowSpaces is true
  Then the nav pill shows a Spaces segment with the workspaces icon
  And no Albums segment is rendered

Scenario: tapping slot 1 with Spaces on activates index 1 and refreshes spaces
  Given navShowSpaces is true and the active index is 0
  When the Spaces segment is tapped
  Then the tabs router active index becomes 1
  And sharedSpacesProvider is invalidated
  And remoteAlbumProvider is not refreshed

Scenario: tapping slot 1 with Spaces off still refreshes albums
  Given navShowSpaces is false and the active index is 0
  When the Albums segment is tapped
  Then the tabs router active index becomes 1
  And remoteAlbumProvider is refreshed

Scenario: the active-tab provider reports the occupant of the slot, not the slot's old name
  Given navShowSpaces is true
  When the tabs router active index becomes 1
  Then galleryTabProvider holds GalleryTabEnum.spaces

Scenario: the pill highlights the correct segment after a flip
  Given navShowSpaces is true and the active index is 1
  When navShowSpaces becomes false
  Then the Albums segment is the active one
  And no segment rect from the previous configuration is retained

Scenario: a tab with a pushed stack survives a flip
  Given navShowSpaces is false and slot 1 has a route pushed onto its stack
  When navShowSpaces becomes true
  Then no exception is thrown
  And slot 1 shows the Spaces root rather than the stale pushed route

Scenario: flipping the setting off while standing on slot 1
  Given navShowSpaces is true and the active index is 1
  When navShowSpaces becomes false
  Then the active index is still 1
  And the slot 1 destination is the DriftAlbums route
  And no exception is thrown

Scenario: flipping the setting on while standing on slot 1
  Given navShowSpaces is false and the active index is 1
  When navShowSpaces becomes true
  Then the active index is still 1
  And the slot 1 destination is the Spaces route
  And no exception is thrown

Scenario: readonly mode disables slot 1 whichever tab occupies it
  Given readonly mode is on and navShowSpaces is true
  Then the Spaces and Library segments are disabled
  And the Photos segment is enabled

Scenario: the landscape rail follows the same slots
  Given navShowSpaces is true and the orientation is landscape
  Then the rail's second destination is labelled Spaces

Scenario: search still targets slot 0
  Given navShowSpaces is true and the active index is 1
  When the search blob is tapped
  Then the tabs router active index becomes 0

Scenario: the settings tile round-trips
  Given the preference settings page on a fresh install
  Then the nav tile is shown enabled
  When the tile is toggled off
  Then appConfig.read(navShowSpaces) is false
  When the tile is toggled back on
  Then appConfig.read(navShowSpaces) is true

Scenario: Albums stays reachable from the Library tab
  Given navShowSpaces is true
  When the Library tab's Albums entry is tapped
  Then DriftAlbumsRoute is pushed
```

**Edge cases and risks.**

- **This is an upgrade-visible change.** Because the default is `true` and existing installs have no stored
  row, everyone's second tab becomes Spaces on the next release — the setting cannot distinguish "never
  chose" from "chose Albums". That is the intended trade (the alternative, defaulting off, means nobody
  discovers it), but it makes two things load-bearing rather than cosmetic: Albums must stay one tap away in
  the Library tab, and the settings tile must be findable in Preferences. Both are covered by scenarios. The
  release notes should mention it.
- **`AutoTabsRouter` with a changed `routes` list.** This is the one genuinely uncertain interaction: the list
  changes identity at slot 1 while the widget stays mounted. The "flipping while standing on slot 1" scenario
  is the guard, and it is a red-first test — if `AutoTabsRouter` cannot re-resolve in place, this surfaces
  before any production code is committed to. Fallback if it cannot: reset the active index to 0 on flip,
  which is a visible but safe degradation, and would then get its own scenario.
- **`GalleryNavPill._keys`** is built from `GalleryTabEnum.values` and gains a `spaces` entry that is only
  measured when rendered — `_measure` skips entries with no `currentContext`. Keys must move to `slots` so a
  stale segment rect from the previous configuration cannot survive a flip.
- **`galleryTabProvider`** holds a `GalleryTabEnum`; with the enum widened, any consumer switching on it must
  stay exhaustive. The compiler enforces this.
- **Deep links and pushes to `DriftAlbumsRoute`** are unaffected: it remains declared as a top-level route
  (`router.dart:230`), which is what the Library-tab pushes resolve against.
- **A malformed stored value is _not_ handled, and this change does not fix that.** `CachedKeyValueRepository._build`
  calls `decodeValue` with no guard, so a corrupt row throws while building the whole snapshot — a global
  failure, not one scoped to this key. Do not write a scenario claiming a fallback that does not exist;
  hardening that path is shared infrastructure work and out of scope here.
- **`SpacesPage`'s app-bar title is a hardcoded English `Text('Spaces')`** (`spaces.page.dart:157`). That is
  tolerable for a page reached by an explicit push; it is not tolerable for the default second tab, which is
  what this change makes it. Localize it to the existing `spaces` key as part of (b).
- **Rollback.** The whole feature is inside the `>>> fork-only gallery-bottom-nav` block plus one settings key.
  The rollback note already at `router.dart:147-148` stays accurate.

## 4. Test inventory

Every file below already exists; each entry is an extension unless marked new.

| File                                                                        | Cases                                                                                           |
| --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `mobile/test/presentation/pages/space_albums_page_test.dart`                | F1: icon-only, tooltips, viewer gating, tap still fires                                         |
| `mobile/test/presentation/widgets/spaces/space_albums_shelf_test.dart`      | F2: row tap target, chevron, empty-editor, viewer, null callback                                |
| `mobile/test/presentation/pages/space_detail_top_sliver_test.dart`          | F2: shelf height unchanged                                                                      |
| `web/src/lib/components/spaces/space-album-folder-card.spec.ts`             | F3: drag image, payload, missing API, cleanup, viewer                                           |
| `web/src/lib/components/spaces/space-albums-table.spec.ts`                  | F4: header string, row count untouched                                                          |
| `mobile/test/providers/gallery_nav/gallery_tab_enum_test.dart`              | F5: slot derivation both ways                                                                   |
| `mobile/test/providers/gallery_nav/gallery_nav_destination_test.dart`       | F5: Spaces label, icons, route builder                                                          |
| `mobile/test/presentation/widgets/gallery_nav/gallery_bottom_nav_test.dart` | F5: pill contents, tap side effects, readonly, rail, both flip directions, indicator after flip |
| `mobile/test/providers/gallery_nav/gallery_search_action_test.dart`         | F5: search targets slot 0 under both configurations                                             |
| `mobile/test/domain/models/config/app_config_test.dart`                     | F5: read/write round-trip, default true, missing-row fallback                                   |
| `mobile/test/presentation/pages/gallery_tab_shell_test.dart` (new)          | F5: tab routes per configuration, galleryTabProvider identity, pushed-stack flip                |
| `mobile/test/widgets/settings/nav_setting_test.dart` (new)                  | F5: tile reflects and round-trips through the effective config                                  |

## 5. Verification gates

Local, before any push:

- `cd mobile && flutter test` — the pinned Flutter from `mobile/mise.toml`, with localization and keys
  generated first (`dart run easy_localization:generate -S ../i18n && dart run bin/generate_keys.dart`).
- `cd mobile && dart analyze --fatal-infos` — CI treats infos as fatal.
- `cd web && pnpm test`, `pnpm check:typescript`, `pnpm check:svelte`.
- `make lint-web` and `make format-web` once, at the end, not per task.
- Prettier over this document — CI Docs Build is strict about markdown under `docs/`.

## 6. Sequencing

F1–F4 are independent of each other and of F5; any order works.

F5's order is constrained by a dependency that the earlier draft of this section had backwards: the slots
_provider_ reads `appConfigProvider`, so the config must exist before the provider can. Splitting (a) in two
resolves it:

1. **(a1)** the pure `galleryNavSlots({required bool showSpaces})` function plus the widened enum — no
   settings dependency, testable on its own.
2. **(d)** `SettingsKey.navShowSpaces`, `NavConfig`, the `AppConfig` wiring, and the settings tile.
3. **(a2)** `galleryNavSlotsProvider` over `appConfigProvider`, and the call sites moving off `.values` /
   `.index`.
4. **(b)** the Spaces destination, including localizing `SpacesPage`'s title.
5. **(c)** the shell's conditional `routes:` and the router's fourth declared child.

(c) lands last because it depends on everything above and carries the one real unknown. Its precedent is
reassuring: the legacy `TabShellRoute` already declares `SpacesRoute.page` as a tab child with exactly the
guards proposed here (`router.dart:142`), and drives it as slot 1 of its own `AutoTabsRouter`.

## 7. What this does not do

- No new i18n keys except the two for F5's settings tile. F1 reuses the strings already on its buttons, F4
  reuses `sort_items`, and F5's nav label reuses `spaces`.
- No server, API, DTO, sync or schema change.
- No change to album-card drag behaviour on web (F3 is folder-cards-only, by decision).
- No change to the other three space albums table headers (F4), which belong to issue #972.

## 8. Deferred, with reasons

| Report                                                     | Disposition                                                                                                                                                                                                |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Folder navigation when moving between folders (web+mobile) | Skipped. Both pickers already render the whole tree indented, so the report could not be mapped onto a behaviour; awaiting a repro.                                                                        |
| List rows uneven, selection checkboxes offset (web)        | Skipped. No checkbox exists in any album list view searched; awaiting a screenshot.                                                                                                                        |
| Mobile asset options in space albums are limited           | Deferred. Real parity gap — web offers Favorite, Archive, Visibility, Delete, Set-cover, Remove; mobile offers three. Needs an ownership-gating decision for mixed-owner albums.                           |
| Mobile album list view                                     | Deferred. Well-precedented by `album_selector.widget.dart`'s persisted `isGrid` toggle, but a feature in its own right.                                                                                    |
| Bouncing scroll at the end of a short space timeline (web) | Deferred. `SpaceOnboardingBanner` is injected inside the virtualised `Timeline`, so it changes the scroll container's height after measurement — plausible, unconfirmed. Needs reproduction before design. |
