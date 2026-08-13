# Mobile Collection Picker Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Spaces reachable without scrolling past every album in the mobile add-to-collection
picker, render real thumbnails for spaces and space albums, and offer the picker on the two surfaces
that still lack it.

**Architecture:** `CollectionPicker` (fork-owned) composes upstream's `AlbumSelector` with the
fork's `SpaceCollectionSection`. One additive prop on `AlbumSelector` lets the spaces section be
injected between the search bar and the album list, so search still covers both halves. The two
missing entry points are wired by passing `CollectionPicker` into their existing bottom sheets.

**Tech Stack:** Flutter 3.44.8, Riverpod (hooks_riverpod), `sliver_tools` (`MultiSliver`), mocktail,
`flutter_test`.

**Spec:** `docs/superpowers/specs/2026-08-13-mobile-collection-picker-parity-design.md`

## Global Constraints

- **Flutter 3.44.8.** The pin lives in `mobile/mise.toml`. Never call bare `flutter` — the global
  mise pin is older and pub-solve will fail. Invoke
  `~/.local/share/mise/installs/aqua-flutter-flutter/3.44.8/flutter/bin/{flutter,dart}` directly.
- **One-time setup per checkout**, since `lib/generated/*.g.dart` is gitignored. From `mobile/`:
  `flutter pub get`, then
  `dart run easy_localization:generate -S ../i18n && dart run bin/generate_keys.dart`.
  Drift/OpenAPI generated code is committed; `build_runner` is not needed.
- **Two gates, both must pass:** `flutter test <path>` and `dart analyze --fatal-infos`.
  `dart analyze` alone is not sufficient — generated-code compile errors only surface when a test
  actually compiles.
- **No new i18n keys.** Use the existing `albums` and `spaces` keys. Adding a key would require
  updating nine locales in the same commit.
- **`AlbumSelector` is upstream code.** Every change to it must be purely additive with a null
  default, so rebases stay clean. Do not reformat or restructure anything else in that file.
- **Red before green.** Every test step below records the _actual_ expected failure. If a test
  passes before its production change is written, it does not discriminate — rewrite it.
- **Do not commit iOS build churn.** `mobile/ios/Podfile.lock`,
  `Runner.xcodeproj/project.pbxproj` and `Runner.xcworkspace/.../Package.resolved` regenerate on any
  local build. `git checkout --` them before committing.

---

## File Structure

| File                                                                                 | Responsibility                                       | Change                             |
| ------------------------------------------------------------------------------------ | ---------------------------------------------------- | ---------------------------------- |
| `mobile/lib/presentation/widgets/album/album_selector.widget.dart`                   | upstream album list + search                         | **Modify** — one additive prop     |
| `mobile/lib/presentation/widgets/collection/space_collection_section.widget.dart`    | the Spaces half: rows, children, thumbnails, footer  | **Modify** — thumbnails + `footer` |
| `mobile/lib/presentation/widgets/collection/collection_picker.widget.dart`           | composes both halves, owns search state and dispatch | **Modify** — wiring                |
| `mobile/lib/presentation/widgets/bottom_sheet/remote_album_bottom_sheet.widget.dart` | album multi-select sheet                             | **Modify** — remove one gate       |
| `mobile/lib/presentation/widgets/spaces/space_album_bottom_sheet.widget.dart`        | space-album multi-select sheet                       | **Modify** — add the picker        |
| `mobile/test/presentation/widgets/collection/space_collection_section_test.dart`     | section behaviour                                    | **Modify** — T1–T5                 |
| `mobile/test/presentation/widgets/collection/collection_picker_test.dart`            | composition + layout                                 | **Modify** — L1–L6                 |
| `mobile/test/presentation/widgets/bottom_sheet/add_to_collection_surfaces_test.dart` | which sheets offer the picker                        | **Modify** — S1–S5                 |

Tasks 1–2 (thumbnails) are independent of Tasks 3–4 (layout) and can be reviewed separately. Task 3
depends on Task 2 only through the same file, not through behaviour.

---

## Task 1: Space rows render a collage, not a coloured disc

**Files:**

- Modify: `mobile/lib/presentation/widgets/collection/space_collection_section.widget.dart:158`
- Test: `mobile/test/presentation/widgets/collection/space_collection_section_test.dart`

**Interfaces:**

- Consumes: `SpaceCollage({required List<String> recentAssetIds, required List<String> recentAssetThumbhashes, UserAvatarColor? color, required double size})` from `package:immich_mobile/widgets/spaces/space_collage.dart` — already imported in the section for `spaceGradientColors`.
- Produces: nothing new for later tasks.

- [ ] **Step 1: Give the test's `space()` helper recent assets**

In `space_collection_section_test.dart`, the `space(...)` helper currently omits the recent-asset
fields, so the DTO defaults them to `Optional.present(const [])`. Add a parameter so a test can
supply them. Find the `SharedSpaceResponseDto space(` helper and add the parameter to its signature
and body:

```dart
  SharedSpaceResponseDto space(
    String id, {
    SharedSpaceRole role = SharedSpaceRole.owner,
    int albums = 0,
    String? name,
    List<String> recentAssetIds = const [],
  }) => SharedSpaceResponseDto(
    id: id,
    name: name ?? 'Space $id',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    createdById: 'someone-else',
    recentAssetIds: Optional.present(recentAssetIds),
    recentAssetThumbhashes: Optional.present(const []),
```

Leave the rest of the helper body exactly as it is.

- [ ] **Step 2: Write the failing tests (T1, T2)**

Add to `space_collection_section_test.dart`, inside `void main()`:

```dart
  testWidgets('T1: a space with recent assets renders a collage, not a plain colour disc', (tester) async {
    await pump(tester, spaces: [space('s1', recentAssetIds: ['a1', 'a2'])]);

    expect(find.byType(SpaceCollage), findsOneWidget);
    expect(find.byType(CircleAvatar), findsNothing);
  });

  testWidgets('T2: a space with no recent assets still renders the collage on its empty state', (tester) async {
    await pump(tester, spaces: [space('s1', recentAssetIds: const [])]);

    // The collage draws its own gradient fallback when the id list is empty; the row must not
    // silently drop its leading widget in that case.
    expect(find.byType(SpaceCollage), findsOneWidget);
  });
```

Add the import at the top of the test file:

```dart
import 'package:immich_mobile/widgets/spaces/space_collage.dart';
```

- [ ] **Step 3: Run the tests to verify they fail**

```bash
cd mobile && ~/.local/share/mise/installs/aqua-flutter-flutter/3.44.8/flutter/bin/flutter test \
  test/presentation/widgets/collection/space_collection_section_test.dart --plain-name T1
```

Expected: **FAIL** — `Expected: exactly one matching candidate / Actual: _TypeWidgetFinder:<zero widgets with type "SpaceCollage">`. T2 fails the same way. If either passes here, the row already renders a collage and the test is not discriminating — stop and re-read the widget.

- [ ] **Step 4: Replace the CircleAvatar**

In `space_collection_section.widget.dart`, inside `_rowsFor`, replace the `leading:` line:

```dart
        leading: SpaceCollage(
          recentAssetIds: space.recentAssetIds.orElse(null) ?? const [],
          recentAssetThumbhashes: space.recentAssetThumbhashes.orElse(null) ?? const [],
          color: space.color.orElse(null),
          // Matches the `radius: 16` CircleAvatar this replaces, so row height is unchanged.
          size: 32,
        ),
```

Both DTO fields are `Optional<List<String>?>`, hence the double unwrap. `SpaceCollage` keeps using
`color` for the gradient it already falls back to.

- [ ] **Step 5: Run the tests to verify they pass**

```bash
cd mobile && ~/.local/share/mise/installs/aqua-flutter-flutter/3.44.8/flutter/bin/flutter test \
  test/presentation/widgets/collection/space_collection_section_test.dart
```

Expected: **PASS**, including every pre-existing test in the file. A pre-existing failure here means
the leading swap changed layout — investigate rather than adjusting the old test.

- [ ] **Step 6: Commit**

```bash
git add mobile/lib/presentation/widgets/collection/space_collection_section.widget.dart \
        mobile/test/presentation/widgets/collection/space_collection_section_test.dart
git commit -m "fix(mobile): render a space's collage in the collection picker"
```

---

## Task 2: Space-album children render their thumbnail

**Files:**

- Modify: `mobile/lib/presentation/widgets/collection/space_collection_section.widget.dart:204`
- Test: `mobile/test/presentation/widgets/collection/space_collection_section_test.dart`

**Interfaces:**

- Consumes: `Thumbnail.remote({required String remoteId, required String thumbhash})` from `package:immich_mobile/presentation/widgets/images/thumbnail.widget.dart`. `thumbhash` is **required and non-nullable**; `SpaceAlbum` has no thumbhash, so pass `''` — on this constructor the value is only a cache-busting URL parameter, never a blur placeholder (see the spec).
- Consumes: `PresentationContext.create()` from `mobile/test/…` — see Step 1; `Thumbnail.remote` builds a `RemoteImageProvider` that reads `Store.get(StoreKey.serverEndpoint)` in its initializer, which throws in a bare widget test.
- Produces: nothing new for later tasks.

- [ ] **Step 1: Initialize the store for this test file**

`Thumbnail.remote` resolves its URL eagerly, so the file needs a real `StoreService`. Add to the top
of `void main()` in `space_collection_section_test.dart`, mirroring
`test/presentation/widgets/spaces/space_albums_shelf_test.dart:65-68`:

```dart
  setUpAll(() async {
    // PresentationContext.create() runs TestUtils.init() and initializes StoreService, which
    // Thumbnail.remote's RemoteImageProvider reads when it builds its URL.
    await PresentationContext.create();
  });
```

Add the import. `space_collection_section_test.dart` sits at the same depth as
`space_albums_shelf_test.dart` (`test/presentation/widgets/<dir>/`), so the relative path is
identical:

```dart
import '../../../unit/presentation/presentation_context.dart';
```

**Caution:** `PresentationContext` is a broad harness. It is used here **only** to initialize the
store. If any T-test starts passing before its production change, check that the harness has not
stubbed the widget under test — a harness that mocks the layer being tested makes green meaningless.

- [ ] **Step 2: Write the failing tests (T3, T4, T5)**

```dart
  testWidgets('T3: a space album with a thumbnail asset renders it', (tester) async {
    await pump(
      tester,
      spaces: [space('s1', albums: 1)],
      albums: {'s1': [album('al1', 'Hawaii', thumbnailAssetId: 'asset-1')]},
    );
    await tester.tap(find.byKey(const Key('space-row-s1')));
    await tester.pump();

    expect(find.byType(Thumbnail), findsOneWidget);
  });

  testWidgets('T4: a space album with no thumbnail asset falls back to the icon', (tester) async {
    await pump(
      tester,
      spaces: [space('s1', albums: 1)],
      albums: {'s1': [album('al1', 'Hawaii', thumbnailAssetId: null)]},
    );
    await tester.tap(find.byKey(const Key('space-row-s1')));
    await tester.pump();

    expect(find.byIcon(Icons.photo_album_outlined), findsOneWidget);
    expect(find.byType(Thumbnail), findsNothing);
  });

  testWidgets('T5: the pool child keeps its action icon and never becomes a thumbnail', (tester) async {
    await pump(
      tester,
      spaces: [space('s1', albums: 1)],
      albums: {'s1': [album('al1', 'Hawaii', thumbnailAssetId: 'asset-1')]},
    );
    await tester.tap(find.byKey(const Key('space-row-s1')));
    await tester.pump();

    expect(find.byIcon(Icons.workspaces_outline), findsOneWidget);
  });
```

Add the import:

```dart
import 'package:immich_mobile/presentation/widgets/images/thumbnail.widget.dart';
```

The file's `album(...)` helper does not carry a thumbnail today. Replace it (currently at
`space_collection_section_test.dart:59`) with:

```dart
  SpaceAlbum album(String id, String name, {String? thumbnailAssetId}) => SpaceAlbum(
    id: id,
    name: name,
    thumbnailAssetId: thumbnailAssetId,
    showInTimeline: true,
    linkedAt: DateTime(2026, 1, 1),
    updatedAt: DateTime(2026, 1, 1),
    createdAt: DateTime(2026, 1, 1),
  );
```

The added parameter is optional, so every existing call site in the file keeps compiling unchanged.

- [ ] **Step 3: Run the tests to verify they fail**

```bash
cd mobile && ~/.local/share/mise/installs/aqua-flutter-flutter/3.44.8/flutter/bin/flutter test \
  test/presentation/widgets/collection/space_collection_section_test.dart --plain-name T3
```

Expected: **FAIL** — `zero widgets with type "Thumbnail"`, because the child currently always draws
`Icon(Icons.photo_album_outlined)`. T4 and T5 **pass already** — they are the guards on the
fallback and the pool child, and they exist to stay green through Step 4, not to go red.

- [ ] **Step 4: Render the thumbnail when there is one**

In `_childrenFor`, replace the album child's `leading:`:

```dart
            leading: album.thumbnailAssetId == null
                ? const Icon(Icons.photo_album_outlined)
                : SizedBox(
                    width: 32,
                    height: 32,
                    child: ClipRRect(
                      borderRadius: BorderRadius.circular(4),
                      // SpaceAlbum carries no thumbhash; on Thumbnail.remote the value is only a
                      // cache-busting URL param, never a blur placeholder, so '' costs nothing here.
                      child: Thumbnail.remote(remoteId: album.thumbnailAssetId!, thumbhash: ''),
                    ),
                  ),
```

Add the import to the widget file:

```dart
import 'package:immich_mobile/presentation/widgets/images/thumbnail.widget.dart';
```

- [ ] **Step 5: Run the whole file to verify**

```bash
cd mobile && ~/.local/share/mise/installs/aqua-flutter-flutter/3.44.8/flutter/bin/flutter test \
  test/presentation/widgets/collection/space_collection_section_test.dart
```

Expected: **PASS**, all tests including T4 and T5 still green.

- [ ] **Step 6: Commit**

```bash
git add mobile/lib/presentation/widgets/collection/space_collection_section.widget.dart \
        mobile/test/presentation/widgets/collection/space_collection_section_test.dart
git commit -m "fix(mobile): render space album thumbnails in the collection picker"
```

---

## Task 3: Spaces render above albums

**Files:**

- Modify: `mobile/lib/presentation/widgets/album/album_selector.widget.dart:205-214`
- Modify: `mobile/lib/presentation/widgets/collection/space_collection_section.widget.dart` (add `footer`)
- Modify: `mobile/lib/presentation/widgets/collection/collection_picker.widget.dart:132-163`
- Test: `mobile/test/presentation/widgets/collection/collection_picker_test.dart`

**Interfaces:**

- Produces: `AlbumSelector({..., Widget? sliverAfterSearch})` — a **sliver**, rendered between the search bar and the quick-filter row.
- Produces: `SpaceCollectionSection({..., Widget? footer})` — a box widget appended inside the section's `Column`, rendered only on the paths where the section itself renders.

- [ ] **Step 1: Add the `footer` parameter to the section**

In `space_collection_section.widget.dart`, add the field and constructor parameter:

```dart
  /// Rendered at the bottom of the section, and only when the section renders at all — so a caller
  /// can attach a label for whatever follows without duplicating the section's visibility rules
  /// (writable filter, excludeSpaceId, search query).
  final Widget? footer;
```

Add `this.footer,` to the constructor parameter list. Then append it as the last child of the
returned `Column`, after the `if (notice != null) … else for (…)` block:

```dart
        if (footer != null) footer!,
```

Both `SizedBox.shrink()` early returns are above this, so the footer disappears with the section.
It **does** render on the notice path, which is intended — albums still follow it there.

- [ ] **Step 2: Add the additive hook to AlbumSelector**

In `album_selector.widget.dart`, add next to the existing `onSearchChanged` / `searchHint` fields:

```dart
  /// Fork hook: a sliver rendered between the search field and the album list, so a composing
  /// picker can put another section under the shared search box. Null for every upstream call site.
  final Widget? sliverAfterSearch;
```

Add `this.sliverAfterSearch,` to the constructor. Then in `build`, insert into the `MultiSliver`
immediately after `_SearchBar(...)` and before `_QuickFilterButtonRow(...)`:

```dart
          if (widget.sliverAfterSearch != null) widget.sliverAfterSearch!,
```

`MultiSliver.children` is a non-nullable `List<Widget>`, so it must be spread conditionally like
this — assigning the nullable directly will not compile. Change nothing else in this file.

- [ ] **Step 3: Write the failing tests (L1–L5)**

In `collection_picker_test.dart`. The existing composition test already resolves coordinates via
`tester.getTopLeft`; reuse that approach — asserting only on presence would pass regardless of order
and would not discriminate.

```dart
  testWidgets('L1: spaces render above albums, and both below the search field', (tester) async {
    await pumpPicker(tester, spaces: [space('s1', 'Family')]);

    final searchY = tester.getTopLeft(find.byType(SearchField)).dy;
    final spacesY = tester.getTopLeft(find.byKey(const Key('space-collection-header'))).dy;
    final albumsY = tester.getTopLeft(find.byKey(const Key('collection-picker-albums-header'))).dy;

    expect(searchY, lessThan(spacesY));
    expect(spacesY, lessThan(albumsY));
  });

  testWidgets('L2: both section labels render when the user has writable spaces', (tester) async {
    await pumpPicker(tester, spaces: [space('s1', 'Family')]);

    expect(find.byKey(const Key('space-collection-header')), findsOneWidget);
    expect(find.byKey(const Key('collection-picker-albums-header')), findsOneWidget);
  });

  testWidgets('L3: neither label renders when the user has no writable spaces', (tester) async {
    await pumpPicker(tester, spaces: const []);

    expect(find.byKey(const Key('space-collection-header')), findsNothing);
    expect(find.byKey(const Key('collection-picker-albums-header')), findsNothing);
  });
```

`collection_picker_test.dart` has no shared pump helper — each test inlines its overrides. Add one at
the top of `void main()`, lifting the override list from the file's first test so the L-tests can
vary spaces and selection:

```dart
  RemoteAsset asset(String id, {String ownerId = 'user-1'}) => RemoteAsset(
    id: id,
    name: id,
    ownerId: ownerId,
    checksum: id,
    type: AssetType.image,
    createdAt: DateTime(2026, 1, 1),
    updatedAt: DateTime(2026, 1, 1),
    isEdited: false,
  );

  Future<void> pumpPicker(
    WidgetTester tester, {
    List<SharedSpaceResponseDto> spaces = const [],
    List<RemoteAsset> selection = const [],
  }) async {
    final userService = _MockUserService();
    final user = UserStub.user1;
    when(() => userService.tryGetMyUser()).thenReturn(user);
    when(() => userService.watchMyUser()).thenAnswer((_) => const Stream.empty());

    await tester.pumpConsumerWidgetRaw(
      const CustomScrollView(slivers: [CollectionPicker()]),
      overrides: [
        currentUserProvider.overrideWith((ref) => _StubCurrentUserNotifier(userService, user)),
        remoteAlbumProvider.overrideWith(() => _StubRemoteAlbumNotifier()),
        appConfigProvider.overrideWithValue(const AppConfig()),
        sharedSpacesProvider.overrideWith((ref) async => spaces),
        multiSelectProvider.overrideWith(
          () => MultiSelectNotifier(
            MultiSelectState(selectedAssets: selection.toSet(), lockedSelectionAssets: const {}),
          ),
        ),
      ],
    );
    await tester.pump();
  }
```

`_MockUserService`, `_StubCurrentUserNotifier` and `_StubRemoteAlbumNotifier` already exist in this
file. The file's `space(String id, String name)` helper is reused as-is. Add
`import 'package:immich_mobile/domain/models/asset/base_asset.model.dart';` for `RemoteAsset` and
`AssetType` if the file does not already import it.

Leave the existing tests inlining their own overrides — rewriting them onto the helper would mix a
refactor into a behaviour change and obscure which test caught what.

- [ ] **Step 4: Run to verify they fail**

```bash
cd mobile && ~/.local/share/mise/installs/aqua-flutter-flutter/3.44.8/flutter/bin/flutter test \
  test/presentation/widgets/collection/collection_picker_test.dart --plain-name L1
```

Expected: **FAIL** — `zero widgets with key [<'collection-picker-albums-header'>]`, since no albums
label exists yet. L3 may pass for the wrong reason (the key does not exist at all); it only becomes
meaningful after Step 5, which is why L2 must go green in the same step.

- [ ] **Step 5: Wire the picker**

In `collection_picker.widget.dart`, replace the `AlbumSelector` + trailing `SliverToBoxAdapter`
children of the `MultiSliver` with:

```dart
        AlbumSelector(
          onAlbumSelected: _addToAlbum,
          onKeyboardExpanded: widget.onKeyboardExpanded,
          onSearchChanged: (query) => setState(() => _searchQuery = query),
          searchHint: 'search_albums_and_spaces'.t(context: context),
          sliverAfterSearch: SliverToBoxAdapter(
            child: SpaceCollectionSection(
              onTargetSelected: _addToTarget,
              excludeSpaceId: widget.excludeSpaceId,
              isBusy: _isBusy,
              searchQuery: _searchQuery,
              assets: widget.assets,
              // Rides on the section's own visibility so a user in no space never sees a lone
              // "Albums" header over the layout they have today.
              footer: Padding(
                key: const Key('collection-picker-albums-header'),
                padding: const EdgeInsets.fromLTRB(16, 16, 16, 8),
                child: Text('albums'.t(context: context), style: context.textTheme.labelLarge),
              ),
            ),
          ),
        ),
```

`SpaceCollectionSection` is a box widget, so it keeps the `SliverToBoxAdapter` it already had. The
label reuses the existing `albums` i18n key and matches the section header's `labelLarge` style.

- [ ] **Step 6: Run the whole file**

```bash
cd mobile && ~/.local/share/mise/installs/aqua-flutter-flutter/3.44.8/flutter/bin/flutter test \
  test/presentation/widgets/collection/collection_picker_test.dart
```

Expected: **PASS**, and the pre-existing "composes the header, the album selector and the spaces
section, in that order" test passes **unmodified**. Do not edit it. It asserts
`headerY < albumsY` where `albumsY` is `getTopLeft(find.byType(SearchField))` — the search field is
still `AlbumSelector`'s first sliver after this change, so the relation holds. Its other two
assertions (`find.byType(AlbumSelector)` and `find.byType(SpaceCollectionSection)` each finding one)
also still hold: the section is now a descendant of `AlbumSelector` rather than its sibling, and
`find.byType` does not care.

That test's local variable is now misleadingly named — `albumsY` marks where the _search field_
starts, and albums no longer begin there. Renaming it to `selectorY` is optional and cosmetic; if you
do, change only the identifier, never the assertion.

- [ ] **Step 7: Commit**

```bash
git add mobile/lib/presentation/widgets/album/album_selector.widget.dart \
        mobile/lib/presentation/widgets/collection/space_collection_section.widget.dart \
        mobile/lib/presentation/widgets/collection/collection_picker.widget.dart \
        mobile/test/presentation/widgets/collection/collection_picker_test.dart
git commit -m "feat(mobile): put spaces above albums in the add-to-collection picker"
```

---

## Task 4: The search box survives becoming the spaces section's parent

**Files:**

- Test: `mobile/test/presentation/widgets/collection/collection_picker_test.dart`

**Interfaces:**

- Consumes: `AlbumSelector.sliverAfterSearch` and `SpaceCollectionSection.footer` from Task 3.
- Produces: nothing.

This task adds no production code. Task 3 turned the spaces section from `AlbumSelector`'s _sibling_
into its _child_, so a keystroke now rebuilds the widget that owns `searchController` and
`searchFocusNode`. These tests are **green before and after** — they earn their place by being run
against the restructure, not by going red.

- [ ] **Step 1: Write L4 and L5**

```dart
  testWidgets('L4: a query matching albums but no space collapses the section and both labels', (tester) async {
    await pumpPicker(tester, spaces: [space('s1', 'Family')]);

    await tester.enterText(find.byType(SearchField), 'zzz-no-space-matches');
    await tester.pump();

    // Intended: with only one section left, section labels are noise. Do not "fix" this.
    expect(find.byKey(const Key('space-collection-header')), findsNothing);
    expect(find.byKey(const Key('collection-picker-albums-header')), findsNothing);
  });

  testWidgets('L5: the notice path still renders the albums label below it', (tester) async {
    // A selection containing a non-owned asset drives the section's notice branch: header and
    // notice render, space rows do not — and albums still follow.
    await pumpPicker(
      tester,
      spaces: [space('s1', 'Family')],
      selection: [asset('a1', ownerId: 'someone-else')],
    );

    expect(find.byKey(const Key('space-collection-notice')), findsOneWidget);
    expect(find.byKey(const Key('space-row-s1')), findsNothing);
    expect(find.byKey(const Key('collection-picker-albums-header')), findsOneWidget);
  });
```

`pumpPicker` needs a `selection` parameter that overrides `multiSelectProvider`, mirroring the
`MultiSelectNotifier(MultiSelectState(selectedAssets: {...}, lockedSelectionAssets: {}))` override
already used in this file's first test.

- [ ] **Step 2: Write L6, the focus guard**

```dart
  testWidgets('L6: typing keeps the search field focused and narrows the spaces section', (tester) async {
    await pumpPicker(tester, spaces: [space('s1', 'Family'), space('s2', 'Holiday')]);

    // enterText focuses the field itself (it calls showKeyboard), so no explicit tap is needed --
    // and the focus assertion below is therefore NOT "did typing acquire focus" but "did focus
    // SURVIVE the rebuild that the keystroke triggered". That is the regression this task guards:
    // onSearchChanged -> setState -> AlbumSelector is handed a new child.
    await tester.enterText(find.byType(SearchField), 'Fam');
    await tester.pump();

    expect(find.byKey(const Key('space-row-s1')), findsOneWidget);
    expect(find.byKey(const Key('space-row-s2')), findsNothing);

    // Asserting only on the narrowed rows would pass even if every keystroke dropped focus.
    final editable = tester.widget<EditableText>(find.descendant(
      of: find.byType(SearchField),
      matching: find.byType(EditableText),
    ));
    expect(editable.focusNode.hasFocus, isTrue);
  });
```

- [ ] **Step 3: Run the file**

```bash
cd mobile && ~/.local/share/mise/installs/aqua-flutter-flutter/3.44.8/flutter/bin/flutter test \
  test/presentation/widgets/collection/collection_picker_test.dart
```

Expected: **PASS**, and critically the pre-existing "typing in the search field narrows the spaces
section too" test passes **unmodified**. If it needs editing, the restructure broke the search wiring
— fix the wiring, not the test.

- [ ] **Step 4: Commit**

```bash
git add mobile/test/presentation/widgets/collection/collection_picker_test.dart
git commit -m "test(mobile): pin picker label collapse, notice path and search focus"
```

---

## Task 5: The space-album page offers the picker

**Files:**

- Modify: `mobile/lib/presentation/widgets/spaces/space_album_bottom_sheet.widget.dart:55-72`
- Test: `mobile/test/presentation/widgets/bottom_sheet/add_to_collection_surfaces_test.dart`

**Interfaces:**

- Consumes: `CollectionPicker({Function? onKeyboardExpanded, String? excludeSpaceId, ActionSource source, Iterable<BaseAsset>? assets, VoidCallback? onCompleted})`.
- Produces: nothing.

- [ ] **Step 1: Write the failing tests (S1, S2)**

**Do not assert with `find.byType(CollectionPicker)`.** This file already documents why
(`add_to_collection_surfaces_test.dart:118-124`): these sheets open at 0.18–0.4 of the screen, so the
picker's sliver is below the viewport and never built. A rendered-tree assertion therefore passes or
fails on sheet height rather than on wiring. This sheet opens at **0.18**, the smallest of them all.
Use the file's `expectPickerMounted(tester)` helper, which reads
`BaseBottomSheet.slivers` directly. `pumpSheet(WidgetTester, Widget)` already exists.

```dart
  testWidgets('S1: the space album sheet offers the collection picker', (tester) async {
    await pumpSheet(tester, const SpaceAlbumBottomSheet(canEdit: true, albumId: 'al1'));
    expectPickerMounted(tester);
  });

  testWidgets('S2: the space album sheet does not exclude its own space', (tester) async {
    await pumpSheet(tester, const SpaceAlbumBottomSheet(canEdit: true, albumId: 'al1'));

    // Assert on the wiring, not on rendered rows: the space list lives inside the picker, which is
    // below this sheet's 0.18 viewport and never built. A null excludeSpaceId is exactly what keeps
    // the current space reachable, so moving a photo between two albums of one space works.
    final slivers = tester.widget<BaseBottomSheet>(find.byType(BaseBottomSheet)).slivers ?? const <Widget>[];
    final picker = slivers.whereType<CollectionPicker>().single;
    expect(picker.excludeSpaceId, isNull);
  });
```

- [ ] **Step 2: Run to verify they fail**

```bash
cd mobile && ~/.local/share/mise/installs/aqua-flutter-flutter/3.44.8/flutter/bin/flutter test \
  test/presentation/widgets/bottom_sheet/add_to_collection_surfaces_test.dart --plain-name S1
```

Expected: **FAIL** — `Expected: an object with length of <1> / Actual: <0>`. The sheet passes no `slivers:`
today.

- [ ] **Step 3: Add the picker to the sheet**

In `space_album_bottom_sheet.widget.dart`, add a keyboard-expand callback inside `build` above the
`return`:

```dart
    Future<void> onKeyboardExpand() {
      // 0.85 is this sheet's maxChildSize.
      return sheetController.animateTo(0.85, duration: const Duration(milliseconds: 200), curve: Curves.easeInOut);
    }
```

Then add to the `BaseBottomSheet(...)` call, after `actions:`:

```dart
      // The same picker every other multi-select surface offers. No excludeSpaceId: this sheet has
      // no spaceId, and the current space is a legitimate target from inside one of its albums.
      slivers: [CollectionPicker(onKeyboardExpanded: onKeyboardExpand)],
```

The sheet's actions all dispatch against `ActionSource.timeline`, so the picker takes the default
`source` and omits `assets`, reading the timeline multiselect as the other sheets do.

- [ ] **Step 4: Run to verify they pass**

```bash
cd mobile && ~/.local/share/mise/installs/aqua-flutter-flutter/3.44.8/flutter/bin/flutter test \
  test/presentation/widgets/bottom_sheet/add_to_collection_surfaces_test.dart
```

Expected: **PASS**, all surfaces.

- [ ] **Step 5: Commit**

```bash
git add mobile/lib/presentation/widgets/spaces/space_album_bottom_sheet.widget.dart \
        mobile/test/presentation/widgets/bottom_sheet/add_to_collection_surfaces_test.dart
git commit -m "feat(mobile): offer add-to-collection on the space album page"
```

---

## Task 6: An album you do not own offers the picker

**Files:**

- Modify: `mobile/lib/presentation/widgets/bottom_sheet/remote_album_bottom_sheet.widget.dart:98`
- Test: `mobile/test/presentation/widgets/bottom_sheet/add_to_collection_surfaces_test.dart`

**Interfaces:**

- Consumes: nothing new.
- Produces: nothing.

Web gates this on view mode only (`canAddToAlbum: () => viewMode === AlbumPageViewMode.VIEW`), with
no ownership test, so the mobile `ownsAlbum` gate on `slivers:` is stricter than web. Adding assets
somewhere needs rights over the **destination**, which the picker and the server already enforce.

- [ ] **Step 1: Write the failing tests (S3, S4, S5)**

Again use `expectPickerMounted(tester)`, never `find.byType`. The file has `ownedAlbum()` but no
non-owned equivalent; add one beside it, using the same factory:

```dart
  RemoteAlbum foreignAlbum() =>
      RemoteAlbumFactory.create(ownerId: 'someone-else', ownerName: 'Someone Else', assetCount: 1);
```

```dart
  testWidgets('S3: an album the user does not own still offers the picker', (tester) async {
    await pumpSheet(tester, RemoteAlbumBottomSheet(album: foreignAlbum()));
    expectPickerMounted(tester);
  });

  testWidgets('S5: an album the user owns still offers the picker', (tester) async {
    await pumpSheet(tester, RemoteAlbumBottomSheet(album: ownedAlbum()));
    expectPickerMounted(tester);
  });
```

**S4 is deliberately not written here.** The spec asks that a non-owned album holding non-owned
assets keep the album half usable while the spaces half self-censors behind its notice — but that
notice lives _inside_ the picker, below this sheet's viewport, so it cannot honestly be asserted at
the sheet level. Task 4's L5 already pins the notice path against the picker directly, which is where
that behaviour belongs. Asserting it here would mean either a test that cannot fail or one that
passes on sheet height. The sheet's own responsibility is only "is the picker wired up", which S3
covers.

Note the existing first test, "a selection inside an owned album offers spaces", already uses
`ownedAlbum()` and duplicates S5. Keep both: S5 is named as the regression guard for the branch being
deleted in Step 3, and its cost is one line.

- [ ] **Step 2: Run to verify**

```bash
cd mobile && ~/.local/share/mise/installs/aqua-flutter-flutter/3.44.8/flutter/bin/flutter test \
  test/presentation/widgets/bottom_sheet/add_to_collection_surfaces_test.dart --plain-name S3
```

Expected: S3 **FAILS** — `Expected: an object with length of <1> / Actual: <0>`, because `ownsAlbum`
is false for a foreign album so the sheet is handed `slivers: null`. S5 **passes already**: it is the
regression guard proving Step 3 does not change owner behaviour.

- [ ] **Step 3: Remove the ownership gate**

In `remote_album_bottom_sheet.widget.dart`, change the `slivers:` argument:

```dart
      // #965 follow-up: adding assets to a collection needs rights over the DESTINATION, never over
      // the source album -- the picker and the server both enforce that. Web gates this on view mode
      // only, with no ownership test. Every other ownsAlbum branch above is deliberately unchanged.
      slivers: [CollectionPicker(onKeyboardExpanded: onKeyboardExpand)],
```

Do not touch any other `ownsAlbum` branch — remove-from-album, set-cover, archive, trash and the
edit actions remain owner-only.

- [ ] **Step 4: Run to verify they pass**

```bash
cd mobile && ~/.local/share/mise/installs/aqua-flutter-flutter/3.44.8/flutter/bin/flutter test \
  test/presentation/widgets/bottom_sheet/add_to_collection_surfaces_test.dart
```

Expected: **PASS**, S5 still green.

- [ ] **Step 5: Run the full mobile suite and both gates**

```bash
cd mobile && ~/.local/share/mise/installs/aqua-flutter-flutter/3.44.8/flutter/bin/flutter test
cd mobile && ~/.local/share/mise/installs/aqua-flutter-flutter/3.44.8/flutter/bin/dart analyze --fatal-infos
```

Expected: all tests pass, `No issues found!`. `dart analyze` alone is not a substitute for the suite.

- [ ] **Step 6: Commit**

```bash
git checkout -- mobile/ios/Podfile.lock \
  mobile/ios/Runner.xcodeproj/project.pbxproj \
  mobile/ios/Runner.xcworkspace/xcshareddata/swiftpm/Package.resolved 2>/dev/null || true
git add mobile/lib/presentation/widgets/bottom_sheet/remote_album_bottom_sheet.widget.dart \
        mobile/test/presentation/widgets/bottom_sheet/add_to_collection_surfaces_test.dart
git commit -m "fix(mobile): offer add-to-collection on an album you do not own"
```

---

## Manual verification

Automated tests cannot see layout on a real device or a real photo library. On the iOS simulator or
a device pointed at an instance where you own a space with linked albums:

1. Timeline → select photos → add to collection. Spaces sit directly under the search box; albums
   follow under an "Albums" label.
2. Space rows show photo collages; expanded space albums show cover thumbnails, and an album with no
   cover still shows the icon.
3. Type a query matching an album but no space — both labels disappear, album results remain.
4. Open an album you do not own → select → the picker appears.
5. Open a space album → select → the picker appears and offers that same space.
6. A user in no spaces sees the picker exactly as before, with no stray "Albums" label.
