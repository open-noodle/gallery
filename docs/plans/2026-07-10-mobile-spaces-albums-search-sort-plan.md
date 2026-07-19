# Mobile Spaces & Space-Albums Search + Sort — Implementation Plan

> **For agentic workers:** implement one Task (slice) at a time, top to bottom, via `/impl-loop`. Each Task is TDD (write the failing test first) and ends at a green, committable state. Steps use `- [ ]` checkboxes.

**Goal:** Add search-by-name and a reversible sort menu to the mobile Spaces list (`SpacesPage`) and a space's Albums list (`SpaceAlbumsPage`), mirroring the existing Albums page.

**Architecture:** Both lists are already fully loaded on-device, so filtering + sorting are **pure client-side functions**; a shared `CollectionSortButton` + the existing `SearchField` supply the UI; the chosen sort persists per surface through the same `SettingsKey`/`AppConfig` path the Albums page uses. No server, sync, or DB-migration changes.

**Tech Stack:** Flutter, Riverpod (hooks), Drift, `openapi` generated client, `easy_localization`.

**Design spec:** `docs/plans/2026-07-10-mobile-spaces-albums-search-sort-design.md`
**Visual reference (acceptance target):** `docs/plans/2026-07-10-mobile-spaces-albums-search-sort-mock.html`

## Global Constraints

- **Test-first (TDD).** Every Task writes a failing test before implementation; no implementation ahead of a test that pins it.
- **Mobile toolchain:** run tests/analyze with `mise exec -- flutter ...` from `mobile/` (pinned Flutter **3.44.1**). Regenerate l10n/keys once before running tests: `mise exec -- dart run easy_localization:generate -S ../i18n && mise exec -- dart run bin/generate_keys.dart`.
- **CI analysis gate:** `dart analyze --fatal-infos lib test` must be clean (infos are fatal — includes `test/`).
- **i18n:** `i18n/en.json` is the source of truth; regenerate l10n after adding keys. Never hand-edit `mobile/lib/generated/*.g.dart`.
- **No diacritic folding** in search — match the raw name case-insensitively (asserted intentionally).
- **Deterministic sort:** every sort tie-breaks by name (asc) then id, so re-sorts never reshuffle.
- **No changes** to server, sync streams, Drift schema, or the OpenAPI client.

---

### Task 1: Expose `linkedAt` + `updatedAt` on `SpaceAlbum`

Surfaces the two date fields the album date-sorts need. The Drift columns (`shared_space_album_link.createdAt`, `shared_space_album.updatedAt`) already exist and sync — this only widens the model + read.

**Files:**

- Modify: `mobile/lib/domain/models/space_album.model.dart`
- Modify: `mobile/lib/infrastructure/repositories/space_album.repository.dart` (`watchLinkedAlbums`, the `SpaceAlbum(...)` mapping)
- Test: `mobile/test/medium/repositories/space_album_repository_test.dart`

**Interfaces:**

- Produces: `SpaceAlbum` now also carries `final DateTime linkedAt;` and `final DateTime updatedAt;` (both required). Later tasks sort on these.

- [ ] **Step 1: Write the failing test** — add to `space_album_repository_test.dart`, mirroring its existing insert helpers. Insert one link+meta row where the link `createdAt` and the meta `updatedAt` differ, then:

```dart
test('watchLinkedAlbums exposes linkedAt (link.createdAt) and updatedAt (meta.updatedAt)', () async {
  final linked = DateTime.utc(2026, 1, 2);
  final updated = DateTime.utc(2026, 3, 4);
  await insertLink(spaceId: 's1', albumId: 'a1', createdAt: linked);      // helper: sets link.createdAt
  await insertAlbumMeta(id: 'a1', name: 'Alpha', updatedAt: updated);     // helper: sets meta.updatedAt

  final albums = await repo.watchLinkedAlbums('s1').first;

  expect(albums.single.linkedAt, linked);
  expect(albums.single.updatedAt, updated);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd mobile && mise exec -- flutter test test/medium/repositories/space_album_repository_test.dart`
Expected: FAIL — `SpaceAlbum` has no `linkedAt`/`updatedAt` (compile error), or the constructor call is missing them.

- [ ] **Step 3: Add the fields to the model** — `space_album.model.dart`:

```dart
class SpaceAlbum {
  final String id;
  final String name;
  final String? thumbnailAssetId;
  final bool showInTimeline;
  final int assetCount;
  final DateTime linkedAt;
  final DateTime updatedAt;

  const SpaceAlbum({
    required this.id,
    required this.name,
    this.thumbnailAssetId,
    required this.showInTimeline,
    this.assetCount = 0,
    required this.linkedAt,
    required this.updatedAt,
  });
}
```

- [ ] **Step 4: Populate them in `watchLinkedAlbums`** — in the `.map` mapping (both `l` (link) and `m` (meta) are already read via `readTable`), add:

```dart
return SpaceAlbum(
  id: m.id,
  name: m.name,
  thumbnailAssetId: m.thumbnailAssetId,
  showInTimeline: l.showInTimeline,
  assetCount: row.read(assetCountExp) ?? 0,
  linkedAt: l.createdAt,
  updatedAt: m.updatedAt,
);
```

The query-level `..orderBy([OrderingTerm.asc(meta.name)])` stays as a stable default; the pages apply the real sort.

- [ ] **Step 5: Fix any other `SpaceAlbum(...)` construction sites** — search and update fixtures/builders so they compile:

Run: `cd mobile && grep -rn "SpaceAlbum(" lib test | grep -v "SpaceAlbumSort\|SpaceAlbumsPage\|SpaceAlbumRepository"`
For each, add `linkedAt:`/`updatedAt:` (use a fixed `DateTime.utc(2026, 1, 1)` in test fixtures).

- [ ] **Step 6: Run tests + analyze to verify green**

Run: `cd mobile && mise exec -- flutter test test/medium/repositories/space_album_repository_test.dart && mise exec -- dart analyze --fatal-infos lib test`
Expected: PASS, analysis clean.

- [ ] **Step 7: Commit**

```bash
git add mobile/lib/domain/models/space_album.model.dart mobile/lib/infrastructure/repositories/space_album.repository.dart mobile/test/medium/repositories/space_album_repository_test.dart
git commit -m "feat(mobile): expose linkedAt/updatedAt on SpaceAlbum for space-album sorting"
```

---

### Task 2: Sort-mode enums + pure filter/sort helpers

The heart of the feature and where the edge-case matrix lives — all pure functions, no widgets.

**Files:**

- Create: `mobile/lib/pages/library/spaces/collection_sort.dart`
- Test: `mobile/test/pages/library/spaces/collection_sort_test.dart`

**Interfaces:**

- Produces:
  - `enum SpaceAlbumSortMode { name, photoCount, recentlyLinked, recentlyUpdated }` — each with `int storeIndex`, `String label`, `SortOrder defaultOrder`, `SortOrder effectiveOrder(bool isReverse)`.
  - `enum SpaceSortMode { name, recentActivity, dateCreated, members, photos }` — same shape.
  - `List<SpaceAlbum> filterAndSortSpaceAlbums(List<SpaceAlbum> items, String query, SpaceAlbumSortMode mode, bool isReverse)`
  - `List<SharedSpaceResponseDto> filterAndSortSpaces(List<SharedSpaceResponseDto> items, String query, SpaceSortMode mode, bool isReverse)`

- [ ] **Step 1: Write the failing tests** — `collection_sort_test.dart`, one `test(...)` per bullet in the spec's Testing → Filter and Testing → Sort sections. Minimum set:

```dart
// --- filter ---
test('empty query returns all', () { expect(filterAndSortSpaceAlbums(sample, '', SpaceAlbumSortMode.name, false).length, sample.length); });
test('whitespace-only query returns all', () { expect(filterAndSortSpaceAlbums(sample, '   ', SpaceAlbumSortMode.name, false).length, sample.length); });
test('case-insensitive substring', () { expect(names(filterAndSortSpaceAlbums(sample, 'ITA', SpaceAlbumSortMode.name, false)), ['Italy 2022', 'Italy 2022 summary']); });
test('diacritics are NOT folded', () {
  expect(filterAndSortSpaceAlbums(sample, 'säch', SpaceAlbumSortMode.name, false), isNotEmpty);
  expect(filterAndSortSpaceAlbums(sample, 'sach', SpaceAlbumSortMode.name, false), isEmpty);
});
test('regex-meta treated literally', () { expect(filterAndSortSpaceAlbums(sample, '.*', SpaceAlbumSortMode.name, false), isEmpty); });
// --- sort ---
test('photoCount desc by default, reversed asc', () {
  expect(names(filterAndSortSpaceAlbums(sample, '', SpaceAlbumSortMode.photoCount, false)).first, hasHighestCount);
  expect(names(filterAndSortSpaceAlbums(sample, '', SpaceAlbumSortMode.photoCount, true)).first, hasLowestCount);
});
test('recentlyLinked uses linkedAt, recentlyUpdated uses updatedAt (not swapped)', () { /* fixture where they disagree */ });
test('ties break deterministically by name then id', () { /* two equal counts → stable */ });
// --- spaces null-safety ---
test('space with absent lastActivityAt/memberCount/assetCount does not throw and sorts stably', () { /* fixture with Optional.absent */ });
```

Add a `sample` fixture list including the diacritic name "Sächsische Schweiz", two "Italy 2022\*" names, and rows with differing `linkedAt`/`updatedAt`. For spaces, reuse `test/fixtures/shared_space.stub.dart`.

- [ ] **Step 2: Run to verify fail**

Run: `cd mobile && mise exec -- flutter test test/pages/library/spaces/collection_sort_test.dart`
Expected: FAIL — `collection_sort.dart` doesn't exist.

- [ ] **Step 3: Implement `collection_sort.dart`**

```dart
import 'package:immich_mobile/constants/enums.dart';
import 'package:immich_mobile/domain/models/space_album.model.dart';
import 'package:openapi/api.dart';

enum SpaceAlbumSortMode {
  name(0, 'library_page_sort_title', SortOrder.asc),
  photoCount(1, 'library_page_sort_asset_count', SortOrder.desc),
  recentlyLinked(2, 'sort_recently_linked', SortOrder.desc),
  recentlyUpdated(3, 'sort_recently_updated', SortOrder.desc);

  const SpaceAlbumSortMode(this.storeIndex, this.label, this.defaultOrder);
  final int storeIndex;
  final String label;
  final SortOrder defaultOrder;
  SortOrder effectiveOrder(bool isReverse) => isReverse ? defaultOrder.reverse() : defaultOrder;
}

enum SpaceSortMode {
  name(0, 'library_page_sort_title', SortOrder.asc),
  recentActivity(1, 'sort_recent_activity', SortOrder.desc),
  dateCreated(2, 'sort_date_created', SortOrder.desc),
  members(3, 'sort_members', SortOrder.desc),
  photos(4, 'sort_photos', SortOrder.desc);

  const SpaceSortMode(this.storeIndex, this.label, this.defaultOrder);
  final int storeIndex;
  final String label;
  final SortOrder defaultOrder;
  SortOrder effectiveOrder(bool isReverse) => isReverse ? defaultOrder.reverse() : defaultOrder;
}

bool _matches(String name, String query) {
  final q = query.trim().toLowerCase();
  return q.isEmpty || name.toLowerCase().contains(q);
}

int _byName(String a, String b) => a.toLowerCase().compareTo(b.toLowerCase());

List<SpaceAlbum> filterAndSortSpaceAlbums(
  List<SpaceAlbum> items,
  String query,
  SpaceAlbumSortMode mode,
  bool isReverse,
) {
  final sign = mode.effectiveOrder(isReverse) == SortOrder.asc ? 1 : -1;
  final out = items.where((a) => _matches(a.name, query)).toList();
  out.sort((a, b) {
    final c = switch (mode) {
      SpaceAlbumSortMode.name => _byName(a.name, b.name),
      SpaceAlbumSortMode.photoCount => a.assetCount.compareTo(b.assetCount),
      SpaceAlbumSortMode.recentlyLinked => a.linkedAt.compareTo(b.linkedAt),
      SpaceAlbumSortMode.recentlyUpdated => a.updatedAt.compareTo(b.updatedAt),
    };
    if (c != 0) return sign * c;
    final n = _byName(a.name, b.name);
    return n != 0 ? n : a.id.compareTo(b.id);
  });
  return out;
}

// Optional-safe readers. NOTE: verify the generated Optional accessor names
// (`isPresent`/`value`) against openapi's SharedSpaceResponseDto — `.value`
// throws when absent, so always guard with `isPresent`.
num _members(SharedSpaceResponseDto s) => (s.memberCount.isPresent ? s.memberCount.value : null) ?? 0;
num _photos(SharedSpaceResponseDto s) => (s.assetCount.isPresent ? s.assetCount.value : null) ?? 0;
DateTime _activity(SharedSpaceResponseDto s) {
  final la = s.lastActivityAt;
  if (la.isPresent && la.value != null) return DateTime.parse(la.value!);
  return DateTime.parse(s.updatedAt.isNotEmpty ? s.updatedAt : s.createdAt);
}

List<SharedSpaceResponseDto> filterAndSortSpaces(
  List<SharedSpaceResponseDto> items,
  String query,
  SpaceSortMode mode,
  bool isReverse,
) {
  final sign = mode.effectiveOrder(isReverse) == SortOrder.asc ? 1 : -1;
  final out = items.where((s) => _matches(s.name, query)).toList();
  out.sort((a, b) {
    final c = switch (mode) {
      SpaceSortMode.name => _byName(a.name, b.name),
      SpaceSortMode.recentActivity => _activity(a).compareTo(_activity(b)),
      SpaceSortMode.dateCreated => DateTime.parse(a.createdAt).compareTo(DateTime.parse(b.createdAt)),
      SpaceSortMode.members => _members(a).compareTo(_members(b)),
      SpaceSortMode.photos => _photos(a).compareTo(_photos(b)),
    };
    if (c != 0) return sign * c;
    final n = _byName(a.name, b.name);
    return n != 0 ? n : a.id.compareTo(b.id);
  });
  return out;
}
```

- [ ] **Step 4: Add the six new i18n keys** to `i18n/en.json` (keep the file sorted as the tooling expects): `sort_recently_linked` "Recently linked", `sort_recently_updated` "Recently updated", `sort_recent_activity` "Recent activity", `sort_date_created` "Date created", `sort_members` "Members", `sort_photos` "Photos". Regenerate: `cd mobile && mise exec -- dart run easy_localization:generate -S ../i18n && mise exec -- dart run bin/generate_keys.dart`.

- [ ] **Step 5: Run tests + analyze**

Run: `cd mobile && mise exec -- flutter test test/pages/library/spaces/collection_sort_test.dart && mise exec -- dart analyze --fatal-infos lib test`
Expected: PASS, clean.

- [ ] **Step 6: Commit**

```bash
git add mobile/lib/pages/library/spaces/collection_sort.dart mobile/test/pages/library/spaces/collection_sort_test.dart i18n/en.json
git commit -m "feat(mobile): sort-mode enums + pure filter/sort helpers for spaces & space albums"
```

---

### Task 3: Persist sort per surface (SettingsKey + AppConfig)

Adds the four persisted preferences, following the exact Album path. No UI yet — tested through `AppConfig` round-trips.

**Files:**

- Modify: `mobile/lib/domain/models/settings_key.dart` (add keys; import `collection_sort.dart`)
- Modify: `mobile/lib/domain/models/config/app_config.dart` (two sub-configs + read/write arms + defaults)
- Test: `mobile/test/domain/models/config/app_config_test.dart` (create if absent)

**Interfaces:**

- Produces: `AppConfig.spaceAlbums` (`sortMode`, `isReverse`) and `AppConfig.spaces` (`sortMode`, `isReverse`), readable/writable via `SettingsKey.spaceAlbumsSortMode` / `.spaceAlbumsIsReverse` / `.spacesSortMode` / `.spacesIsReverse`.

- [ ] **Step 1: Write the failing test**

```dart
test('space-album + spaces sort prefs round-trip and default correctly', () {
  const c = AppConfig();
  expect(c.spaceAlbums.sortMode, SpaceAlbumSortMode.recentlyLinked); // default
  expect(c.spaces.sortMode, SpaceSortMode.recentActivity);           // default

  final w = c
      .write(SettingsKey.spaceAlbumsSortMode, SpaceAlbumSortMode.name)
      .write(SettingsKey.spaceAlbumsIsReverse, true)
      .write(SettingsKey.spacesSortMode, SpaceSortMode.members);
  expect(w.read(SettingsKey.spaceAlbumsSortMode), SpaceAlbumSortMode.name);
  expect(w.read(SettingsKey.spaceAlbumsIsReverse), true);
  expect(w.read(SettingsKey.spacesSortMode), SpaceSortMode.members);
});
```

- [ ] **Step 2: Run to verify fail**

Run: `cd mobile && mise exec -- flutter test test/domain/models/config/app_config_test.dart`
Expected: FAIL — keys/config sections don't exist.

- [ ] **Step 3: Add the SettingsKeys** — in `settings_key.dart`, import `collection_sort.dart` and add under a `// Spaces` group (mirroring the `// Album` group):

```dart
  // Spaces
  spaceAlbumsSortMode<SpaceAlbumSortMode>(codec: _EnumCodec(SpaceAlbumSortMode.values)),
  spaceAlbumsIsReverse<bool>(),
  spacesSortMode<SpaceSortMode>(codec: _EnumCodec(SpaceSortMode.values)),
  spacesIsReverse<bool>(),
```

- [ ] **Step 4: Add the config sections + switch arms** in `app_config.dart`, mirroring the existing `album` section exactly (a `SpaceAlbumsConfig`/`SpacesConfig` immutable class each with `sortMode` + `isReverse` + `copyWith`, defaulting to `SpaceAlbumSortMode.recentlyLinked` / `SpaceSortMode.recentActivity` and `isReverse: false`); add fields to `AppConfig` + its `copyWith`; add the read arms:

```dart
            .spaceAlbumsSortMode => spaceAlbums.sortMode,
            .spaceAlbumsIsReverse => spaceAlbums.isReverse,
            .spacesSortMode => spaces.sortMode,
            .spacesIsReverse => spaces.isReverse,
```

and the write arms:

```dart
      .spaceAlbumsSortMode => copyWith(spaceAlbums: spaceAlbums.copyWith(sortMode: value as SpaceAlbumSortMode)),
      .spaceAlbumsIsReverse => copyWith(spaceAlbums: spaceAlbums.copyWith(isReverse: value as bool)),
      .spacesSortMode => copyWith(spaces: spaces.copyWith(sortMode: value as SpaceSortMode)),
      .spacesIsReverse => copyWith(spaces: spaces.copyWith(isReverse: value as bool)),
```

- [ ] **Step 5: Run tests + analyze**

Run: `cd mobile && mise exec -- flutter test test/domain/models/config/app_config_test.dart && mise exec -- dart analyze --fatal-infos lib test`
Expected: PASS, clean. (The `switch` over `SettingsKey` is exhaustive — analysis fails if an arm is missing, which is the compiler enforcing full coverage.)

- [ ] **Step 6: Commit**

```bash
git add mobile/lib/domain/models/settings_key.dart mobile/lib/domain/models/config/app_config.dart mobile/test/domain/models/config/app_config_test.dart
git commit -m "feat(mobile): persist spaces & space-album sort prefs via AppConfig"
```

---

### Task 4: Reusable `CollectionSortButton` widget

The shared sort pill + reversible menu, decoupled from any specific enum.

**Files:**

- Create: `mobile/lib/widgets/common/collection_sort_button.dart`
- Test: `mobile/test/widgets/common/collection_sort_button_test.dart`

**Interfaces:**

- Produces: `CollectionSortButton<T>({ required List<CollectionSortOption<T>> options, required T current, required bool isReverse, required void Function(T mode, bool isReverse) onChanged })`, where `CollectionSortOption<T>` is `({ T mode, String label })` (label is an i18n key resolved with `.t(context: context)`). Behavior: shows `Sort: <current label>`; opens a menu of options; tapping a **different** option → `onChanged(option, false)`; tapping the **current** option → `onChanged(current, !isReverse)`; the current option shows a check + an up/down arrow reflecting `isReverse`.

- [ ] **Step 1: Write the failing widget test** — pump the button with 3 options, `current = options[0]`, `isReverse = false`, capturing `onChanged` calls:

```dart
testWidgets('selecting a different mode reports it un-reversed; re-tapping current reverses', (t) async {
  T? gotMode; bool? gotReverse;
  await t.pumpWidget(wrap(CollectionSortButton<int>(
    options: const [(mode: 0, label: 'library_page_sort_title'), (mode: 1, label: 'sort_photos')],
    current: 0, isReverse: false,
    onChanged: (m, r) { gotMode = m; gotReverse = r; },
  )));
  await t.tap(find.byType(CollectionSortButton<int>)); await t.pumpAndSettle();
  await t.tap(find.text('Photos'));                      // a different mode
  expect(gotMode, 1); expect(gotReverse, false);

  await t.tap(find.byType(CollectionSortButton<int>)); await t.pumpAndSettle();
  await t.tap(find.text('Name'));                        // the current mode → reverse
  expect(gotMode, 0); expect(gotReverse, true);
});
```

- [ ] **Step 2: Run to verify fail** — Run: `cd mobile && mise exec -- flutter test test/widgets/common/collection_sort_button_test.dart` → FAIL (widget missing).
- [ ] **Step 3: Implement** the widget, mirroring the menu structure of `_SortButton` / `_QuickSortAndViewMode` in `mobile/lib/presentation/widgets/album/album_selector.widget.dart` (a `MenuAnchor`/`PopupMenuButton` with a check leading-icon on the selected row and an `Icons.arrow_upward`/`arrow_downward` trailing on it). Resolve labels with `label.t(context: context)`.
- [ ] **Step 4: Run to verify pass** — same command → PASS; then `mise exec -- dart analyze --fatal-infos lib test` clean.
- [ ] **Step 5: Commit**

```bash
git add mobile/lib/widgets/common/collection_sort_button.dart mobile/test/widgets/common/collection_sort_button_test.dart
git commit -m "feat(mobile): reusable CollectionSortButton (reversible sort menu)"
```

---

### Task 5: `SpaceAlbumsPage` — search + sort + no-match

Wire it all into the space's albums list. Matches mock frames 1–3.

**Files:**

- Modify: `mobile/lib/pages/library/spaces/space_albums.page.dart`
- Test: `mobile/test/presentation/pages/space_albums_page_test.dart` (new; mirror scaffolding of `test/presentation/pages/space_album_detail_page_test.dart`)

**Interfaces:**

- Consumes: `filterAndSortSpaceAlbums`, `SpaceAlbumSortMode` (Task 2); `CollectionSortButton` (Task 4); `AppConfig.spaceAlbums` + `SettingsKey.spaceAlbums*` (Task 3); existing `SearchField`.

- [ ] **Step 1: Write failing widget tests** — pump `SpaceAlbumsPage` over an overridden `spaceAlbumsProvider` with a fixture list (include a "Hidden"/`showInTimeline:false` album and two "Italy\*"). Cases: typing "ita" in the `SearchField` shrinks the grid to 2; opening `CollectionSortButton` and picking "Photo count" reorders; the no-match state (key `space-albums-no-match`) shows for "zzz" while the genuinely-empty `_EmptyState` (key `space-albums-empty`) shows for an empty provider; the editor **Link** action and card `⋮` menu render only when `canEdit`; a new stream emission re-applies the active filter+sort.
- [ ] **Step 2: Run to verify fail** — Run: `cd mobile && mise exec -- flutter test test/presentation/pages/space_albums_page_test.dart` → FAIL.
- [ ] **Step 3: Implement** — convert to `HookConsumerWidget`; `final query = useState('')`; seed `final sort = useState(ref.read(appConfigProvider).spaceAlbums)`-style state (mode+reverse); on the `albumsAsync.when` `data` branch compute `filterAndSortSpaceAlbums(albums, query.value, mode, isReverse)`; render a column of `SearchField` (hint `space_albums_search_hint`, clears via its ✕) + a result-count + `CollectionSortButton` (options from `SpaceAlbumSortMode.values`) above the existing `_AlbumGrid`; when the filtered list is empty **and** the source list is non-empty render a new `_NoMatch(query)` (key `space-albums-no-match`, string `space_albums_no_match`), else keep `_EmptyState`. On sort change: update state **and** persist via the AppConfig write path used by `album_selector.widget.dart` (`metadata.write(SettingsKey.spaceAlbumsSortMode, ...)` / `.spaceAlbumsIsReverse`). Keep the app-bar `Link` action, card `⋮` menu, and `Hidden` badge exactly as they are.
- [ ] **Step 4: Add i18n keys** — `space_albums_search_hint`, `space_albums_no_match` (`{query}`), `space_albums_result_count`; regenerate l10n.
- [ ] **Step 5: Run to verify pass** — `cd mobile && mise exec -- flutter test test/presentation/pages/space_albums_page_test.dart && mise exec -- dart analyze --fatal-infos lib test` → PASS, clean.
- [ ] **Step 6: Commit**

```bash
git add mobile/lib/pages/library/spaces/space_albums.page.dart mobile/test/presentation/pages/space_albums_page_test.dart i18n/en.json
git commit -m "feat(mobile): search + sort + no-match on the space albums page"
```

---

### Task 6: `SpacesPage` — search + sort + no-match

Same treatment on the spaces list. Matches mock frames 4–5.

**Files:**

- Modify: `mobile/lib/pages/library/spaces/spaces.page.dart`
- Test: `mobile/test/presentation/pages/spaces_page_test.dart` (new)

**Interfaces:**

- Consumes: `filterAndSortSpaces`, `SpaceSortMode` (Task 2); `CollectionSortButton` (Task 4); `AppConfig.spaces` + `SettingsKey.spaces*` (Task 3); existing `SearchField`; `sharedSpacesProvider` (`test/fixtures/shared_space.stub.dart` for fixtures).

- [ ] **Step 1: Write failing widget tests** — override `sharedSpacesProvider` with ≥3 spaces. Cases: typing filters the `SpaceCard` grid; sort menu reorders (e.g. Members); no-match state (key `spaces-no-match`) for a non-matching query vs. the existing empty state for an empty list; the create **＋** FAB stays; the `loading` and `error` branches render **without** the search/sort controls.
- [ ] **Step 2: Run to verify fail** — Run: `cd mobile && mise exec -- flutter test test/presentation/pages/spaces_page_test.dart` → FAIL.
- [ ] **Step 3: Implement** — convert `SpacesPage` to `HookConsumerWidget`; add `query` state + `spaces` sort state (seeded from `appConfigProvider`, persisted on change like Task 5); inside `spacesAsync.when` `data`, wrap the grid with the `SearchField` (hint `spaces_search_hint`) + result count + `CollectionSortButton` (`SpaceSortMode.values`), rendering `filterAndSortSpaces(...)`; add `_NoMatch` (key `spaces-no-match`, string `spaces_no_match`) when filtered-empty over a non-empty list. Keep the FAB, create dialog, empty state, and the `loading`/`error` branches unchanged (no controls in those branches).
- [ ] **Step 4: Add i18n keys** — `spaces_search_hint`, `spaces_no_match` (`{query}`), `spaces_result_count`; regenerate l10n.
- [ ] **Step 5: Run to verify pass** — `cd mobile && mise exec -- flutter test test/presentation/pages/spaces_page_test.dart && mise exec -- dart analyze --fatal-infos lib test` → PASS, clean.
- [ ] **Step 6: Full-suite gate + commit**

```bash
cd mobile && mise exec -- flutter test        # whole mobile suite green
git add mobile/lib/pages/library/spaces/spaces.page.dart mobile/test/presentation/pages/spaces_page_test.dart i18n/en.json
git commit -m "feat(mobile): search + sort + no-match on the spaces page"
```

---

## Self-review

- **Spec coverage:** search (T2/T5/T6), curated sort modes (T2), reversible menu (T4), persistence (T3, wired T5/T6), `linkedAt`/`updatedAt` data (T1), no-match vs empty (T5/T6), i18n (T2/T5/T6), full edge-case + regression tests (each task's Step 1). Design-reference frames map to T5 (1–3) and T6 (4–5). ✓
- **Deferred (not planned):** richer spaces-card subtitle, grouping, view toggle, description search — per spec Out of scope. ✓
- **Type consistency:** `SpaceAlbumSortMode`/`SpaceSortMode`, `filterAndSortSpaceAlbums`/`filterAndSortSpaces`, `CollectionSortButton<T>`, `AppConfig.spaceAlbums`/`.spaces`, `SettingsKey.space*` are used with the same names across tasks. ✓
- **Assumption to verify during T2:** the generated `Optional` accessor names on `SharedSpaceResponseDto` (`isPresent`/`value`); guard every read so an absent field never throws.
