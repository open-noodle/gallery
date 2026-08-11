# Space Albums UX Fixes + Spaces-in-Navbar Setting — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix four small UX defects on the space-albums surfaces (two mobile, two web) and add a mobile setting that puts Spaces in the bottom navigation bar in place of Albums, on by default.

**Architecture:** Tasks 1–4 are independent, single-file corrections with their own tests. Tasks 5–10 build the nav setting bottom-up: widen the tab enum and add a pure slot-resolution function, add the persisted setting, derive a provider from it, teach the destination resolver about Spaces, and only then swap the shell's route list. Nothing touches the server, API, DTOs, sync, or database.

**Tech Stack:** Flutter 3.44.8 (Riverpod, hooks_riverpod, auto_route 11.1.0, Drift, easy_localization, mocktail), SvelteKit 5 + TypeScript (Vitest, @testing-library/svelte, happy-dom), shared `i18n/` catalogue.

Source spec: `docs/superpowers/specs/2026-08-11-space-albums-ux-fixes-design.md`.

## Global Constraints

- **Flutter version:** read the pin from `mobile/mise.toml` (currently `"aqua:flutter/flutter" = "3.44.8"`). If a local `mise install` shim self-reports a different patch, invoke the binary directly from `~/.local/share/mise/installs/aqua-flutter-flutter/<version>/flutter/bin/{flutter,dart}`.
- **Mobile test prerequisites**, once per session, from `mobile/`: `flutter pub get`, then `dart run easy_localization:generate -S ../i18n && dart run bin/generate_keys.dart`. The `lib/generated/*.g.dart` files are gitignored, so any new i18n key is invisible to tests until this is re-run.
- **`dart analyze --fatal-infos` must pass.** `withOpacity` is banned; use `withValues(alpha:)`. `mobile/analysis_options.yaml` also enables `require_trailing_commas`, `prefer_const_constructors`, `always_use_package_imports` and `unawaited_futures`, and `flutter_lints` brings `no_leading_underscores_for_local_identifiers` — so no `_`-prefixed local variables or local functions, even in tests. Run `dart format` before committing; it settles the trailing commas.
- **`dart analyze` is not a substitute for `flutter test`.** Enum-exhaustiveness and generated-code breaks only surface when the test compiles.
- **TDD is mandatory.** Every task writes the test first and runs it to observe a real failure. A test that passes before the implementation exists is a defective test, not a completed step.
- **No new i18n keys except the three in Task 7.** F1 reuses the strings already on its buttons, F4 reuses `sort_items`, and the nav label reuses `spaces`.
- **i18n is shared between web and mobile** — one `i18n/` directory at the repo root. Only edit `i18n/en.json`; other locales come from Weblate.
- **Commit after every task.** No `Co-Authored-By` or `Generated-with` trailers.
- **Run lint/format once at the end**, not per task: `make lint-web`, `make format-web`.

---

## File Structure

**Modified — web**

| File                                                           | Responsibility after this plan                                    |
| -------------------------------------------------------------- | ----------------------------------------------------------------- |
| `web/src/lib/components/spaces/space-albums-table.svelte`      | Item-count header renders a real label with a base width (Task 1) |
| `web/src/lib/utils/space-album-folder-dnd.ts`                  | Also owns the custom drag-image helper (Task 2)                   |
| `web/src/lib/components/spaces/space-album-folder-card.svelte` | Sets a label drag image on dragstart (Task 2)                     |

**Modified — mobile**

| File                                                                         | Responsibility after this plan                            |
| ---------------------------------------------------------------------------- | --------------------------------------------------------- |
| `mobile/lib/pages/library/spaces/space_albums.page.dart`                     | App-bar actions are icon-only with tooltips (Task 3)      |
| `mobile/lib/presentation/widgets/spaces/space_albums_shelf.widget.dart`      | Header row is one tap target, always shown (Task 4)       |
| `mobile/lib/providers/gallery_nav/gallery_tab_enum.dart`                     | Enum + pure slot resolution + slots provider (Tasks 5, 8) |
| `mobile/lib/domain/models/settings_key.dart`                                 | Declares `navShowSpaces` (Task 6)                         |
| `mobile/lib/domain/models/config/app_config.dart`                            | Wires `NavConfig` into read/write (Task 6)                |
| `mobile/lib/widgets/settings/preference_settings/preference_setting.dart`    | Lists the new nav setting (Task 7)                        |
| `mobile/lib/presentation/widgets/gallery_nav/gallery_bottom_nav.widget.dart` | Reads slots; tap/readonly/rail keyed off them (Task 8)    |
| `mobile/lib/presentation/widgets/gallery_nav/gallery_nav_pill.widget.dart`   | Renders the slots it is given (Task 8)                    |
| `mobile/lib/presentation/pages/common/gallery_tab_shell.page.dart`           | Slot-aware tab sync + conditional routes (Tasks 8, 10)    |
| `mobile/lib/providers/gallery_nav/gallery_nav_destination.dart`              | Adds the Spaces destination (Task 9)                      |
| `mobile/lib/pages/library/spaces/spaces.page.dart`                           | Localized app-bar title (Task 9)                          |
| `mobile/lib/routing/router.dart`                                             | Declares `SpacesRoute` as a shell child (Task 10)         |

**Created — mobile**

| File                                                               | Responsibility                      |
| ------------------------------------------------------------------ | ----------------------------------- |
| `mobile/lib/domain/models/config/nav_config.dart`                  | `NavConfig { showSpaces }` (Task 6) |
| `mobile/lib/widgets/settings/preference_settings/nav_setting.dart` | The switch tile (Task 7)            |

---

## Task 1: Web — item-count column header (F4)

**Files:**

- Modify: `web/src/lib/components/spaces/space-albums-table.svelte:139-141`
- Test: `web/src/lib/components/spaces/space-albums-table.spec.ts`

**Interfaces:**

- Consumes: nothing from other tasks.
- Produces: nothing other tasks rely on.

**Background.** The header currently formats a plural string with a zero count and strips the digits back off, which yields the lowercase mid-sentence fragment `items`. `/albums` renders `$t('sort_items')` ("Number of items") for the same column via `AlbumsTableHeader.svelte:23`. That string is four times longer, and unlike `/albums` the space table's `<th>` declares no base width — so it also gains `w-4/12`, matching `sortOptionsMetadata`'s entry for `AlbumSortBy.ItemCount` (`web/src/lib/utils/album-utils.ts:68`).

- [ ] **Step 1: Write the failing tests**

Append inside the existing `describe('SpaceAlbumsTable', …)` block in `web/src/lib/components/spaces/space-albums-table.spec.ts`:

```ts
it('labels the item-count column with a proper header, not a stripped plural', () => {
  render(SpaceAlbumsTable, { spaceId: 's-1', albums: [a1], canManage: false });

  const headerTexts = screen.getAllByRole('columnheader').map((header) => header.textContent?.trim());

  expect(headerTexts).toContain('Number of items');
  // The bug rendered the bare fragment; assert on the exact string so a
  // substring match cannot pass against it.
  expect(headerTexts).not.toContain('items');
});

it('gives the item-count column header a base width so the longer label does not wrap', () => {
  render(SpaceAlbumsTable, { spaceId: 's-1', albums: [a1], canManage: false });

  const header = screen
    .getAllByRole('columnheader')
    .find((candidate) => candidate.textContent?.trim() === 'Number of items');

  expect(header).toBeDefined();
  expect(header?.className).toContain('w-4/12');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd web && pnpm test -- --run src/lib/components/spaces/space-albums-table.spec.ts`

Expected: both new tests FAIL. The first reports the received array containing `'items'` and not `'Number of items'`; the second reports `header` is `undefined`. If either passes, stop — the test is not exercising what it claims.

- [ ] **Step 3: Change the header cell**

In `web/src/lib/components/spaces/space-albums-table.svelte`, replace:

```svelte
      <th class="text-md text-center sm:w-2/12 md:w-2/12 xl:w-[15%] 2xl:w-[12%]"
        >{$t('items_count', { values: { count: 0 } }).replace(/\d+\s/, '')}</th
      >
```

with:

```svelte
      <th class="text-md w-4/12 text-center sm:w-2/12 md:w-2/12 xl:w-[15%] 2xl:w-[12%]">{$t('sort_items')}</th>
```

- [ ] **Step 4: Run the whole spec file**

Run: `cd web && pnpm test -- --run src/lib/components/spaces/space-albums-table.spec.ts`

Expected: PASS, including the pre-existing `expect(screen.getByText(/5 items/i))` assertion at line 44 — the row still uses `items_count`, and only the header changed.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/components/spaces/space-albums-table.svelte web/src/lib/components/spaces/space-albums-table.spec.ts
git commit -m "fix(web): label the space albums item-count column properly"
```

---

## Task 2: Web — folder drag image (F3)

**Files:**

- Modify: `web/src/lib/utils/space-album-folder-dnd.ts`
- Modify: `web/src/lib/components/spaces/space-album-folder-card.svelte:69-76`
- Test: `web/src/lib/components/spaces/space-album-folder-card.spec.ts`

**Interfaces:**

- Consumes: `writeDragPayload`, `setActiveDragPayload` (existing exports of `space-album-folder-dnd.ts`).
- Produces: `setDragLabel(dataTransfer: DataTransfer, label: string): void` — exported from `space-album-folder-dnd.ts`. No return value; safe to call with a `DataTransfer` that lacks `setDragImage`.

**Background.** The folder card never calls `setDragImage`, so the browser drags a snapshot of the whole card — a full tile with a four-up collage — which covers the drop targets. Album cards escape this only incidentally: their drag starts on an `<a>`, so Chrome substitutes a link chip. Only folder cards change here.

**Deviation from the spec, deliberate:** the spec describes the chip as "folder glyph + name". This builds it text-only. A Unicode folder glyph renders inconsistently across platforms and an inline SVG inside a detached node adds failure modes for no functional gain — the defect was the size of the drag image, not the absence of an icon.

- [ ] **Step 1: Write the failing tests**

First extend the existing fake at `web/src/lib/components/spaces/space-album-folder-card.spec.ts:27-34` so it records the call:

```ts
const makeDataTransfer = () => {
  const store = new Map<string, string>();
  return {
    setData: (type: string, value: string) => store.set(type, value),
    getData: (type: string) => store.get(type) ?? '',
    types: [...store.keys()],
    setDragImage: vi.fn(),
  } as unknown as DataTransfer;
};
```

Then add these tests to the same file:

```ts
it('dragstart replaces the default drag image with a small label chip', async () => {
  renderWithTooltips(SpaceAlbumFolderCard, defaults);
  const card = screen.getByTestId('space-album-folder-card');
  const dataTransfer = makeDataTransfer();

  await fireEvent.dragStart(card, { dataTransfer });

  expect(dataTransfer.setDragImage).toHaveBeenCalledTimes(1);
  const [chip] = vi.mocked(dataTransfer.setDragImage).mock.calls[0];
  expect((chip as HTMLElement).textContent).toBe('Trips');
});

it('adds the chip to the document for the snapshot and removes it afterwards', async () => {
  vi.useFakeTimers();
  try {
    renderWithTooltips(SpaceAlbumFolderCard, defaults);
    const card = screen.getByTestId('space-album-folder-card');

    await fireEvent.dragStart(card, { dataTransfer: makeDataTransfer() });
    // Present at snapshot time — asserting only the absence below would pass
    // just as happily against an implementation that never builds a chip.
    expect(document.querySelectorAll('[data-space-drag-chip]')).toHaveLength(1);

    vi.runAllTimers();
    expect(document.querySelectorAll('[data-space-drag-chip]')).toHaveLength(0);
  } finally {
    vi.useRealTimers();
  }
});

it('still writes the payload when the DataTransfer has no setDragImage', async () => {
  renderWithTooltips(SpaceAlbumFolderCard, defaults);
  const card = screen.getByTestId('space-album-folder-card');
  const store = new Map<string, string>();
  const dataTransfer = {
    setData: (type: string, value: string) => store.set(type, value),
    getData: (type: string) => store.get(type) ?? '',
    types: [...store.keys()],
  } as unknown as DataTransfer;

  await fireEvent.dragStart(card, { dataTransfer });

  expect(readDragPayload(dataTransfer)).toEqual({ kind: 'folder', id: folder.id });
  expect(getActiveDragPayload()).toEqual({ kind: 'folder', id: folder.id });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd web && pnpm test -- --run src/lib/components/spaces/space-album-folder-card.spec.ts`

Expected: the first two FAIL (`setDragImage` never called; zero chips found). The third PASSES already — it is a regression guard for the guard clause added in Step 3, not a red test. Note that distinction; do not treat its passing as a problem.

- [ ] **Step 3: Add the helper**

Append to `web/src/lib/utils/space-album-folder-dnd.ts`:

```ts
/** Marks the transient node so tests and cleanup can find it unambiguously. */
const DRAG_CHIP_ATTRIBUTE = 'data-space-drag-chip';

/**
 * Replaces the browser's default drag image — a snapshot of the dragged element, which for a folder
 * card is a full tile with a four-up collage that covers the drop targets — with a small text chip.
 *
 * Three constraints, each a real failure if broken:
 *  - The chip must be RENDERED. `display: none` yields no drag image at all, so it is placed
 *    offscreen instead.
 *  - It must be in the DOM when `setDragImage` runs (the snapshot is taken synchronously) and gone
 *    afterwards, hence the next-tick removal rather than an immediate one.
 *  - `setDragImage` must be feature-detected. The unit tests hand-roll a `DataTransfer` with only
 *    `setData`/`getData`/`types`, and jsdom-family DOMs do not implement it either; without the
 *    guard, every dragstart test throws.
 */
export const setDragLabel = (dataTransfer: DataTransfer, label: string): void => {
  if (typeof document === 'undefined' || typeof dataTransfer.setDragImage !== 'function') {
    return;
  }

  const chip = document.createElement('div');
  chip.setAttribute(DRAG_CHIP_ATTRIBUTE, '');
  chip.textContent = label;
  chip.style.cssText = [
    'position:absolute',
    'top:-1000px',
    'inset-inline-start:0',
    // A zero-area element is rejected as a drag image by some browsers, so an
    // empty folder name still has to produce a box.
    'min-width:2rem',
    'max-width:16rem',
    'overflow:hidden',
    'white-space:nowrap',
    'text-overflow:ellipsis',
    'padding:0.25rem 0.5rem',
    'border-radius:0.375rem',
    'font-size:0.875rem',
    'background:#1f2937',
    'color:#ffffff',
  ].join(';');

  document.body.append(chip);
  dataTransfer.setDragImage(chip, 12, 12);
  setTimeout(() => chip.remove(), 0);
};
```

- [ ] **Step 4: Call it from the folder card**

In `web/src/lib/components/spaces/space-album-folder-card.svelte`, add `setDragLabel` to the import from `$lib/utils/space-album-folder-dnd`, then extend `ondragstart`:

```svelte
  ondragstart={(event) => {
    if (!event.dataTransfer) {
      return;
    }
    const payload: DragPayload = { kind: 'folder', id: folder.id };
    writeDragPayload(event.dataTransfer, payload);
    setActiveDragPayload(payload);
    setDragLabel(event.dataTransfer, folder.name);
  }}
```

- [ ] **Step 5: Run the full spec file**

Run: `cd web && pnpm test -- --run src/lib/components/spaces/space-album-folder-card.spec.ts`

Expected: PASS, all cases — including the pre-existing dragstart test at line 104, which is the signal that the guard clause works.

- [ ] **Step 6: Commit**

```bash
git add web/src/lib/utils/space-album-folder-dnd.ts web/src/lib/components/spaces/space-album-folder-card.svelte web/src/lib/components/spaces/space-album-folder-card.spec.ts
git commit -m "fix(web): drag a space album folder by a label chip, not a full-card snapshot"
```

---

## Task 3: Mobile — icon-only app-bar actions (F1)

**Files:**

- Modify: `mobile/lib/pages/library/spaces/space_albums.page.dart:430-449`
- Test: `mobile/test/presentation/pages/space_albums_page_test.dart`

**Interfaces:**

- Consumes: nothing from other tasks.
- Produces: nothing; the widget `Key`s (`space-albums-new-folder-action`, `space-albums-new-album-action`, `space-albums-link-action`) are unchanged, which is what keeps the twelve existing `find.byKey` references green.

- [ ] **Step 1: Write the failing tests**

Add to `mobile/test/presentation/pages/space_albums_page_test.dart`, using the file's existing `pumpPage` helper (declared at line 177):

```dart
  testWidgets('editor app-bar actions are icon-only with tooltips', (tester) async {
    await pumpPage(tester, folders: const [], albums: const []);

    for (final entry in const {
      'space-albums-new-folder-action': 'New folder',
      'space-albums-new-album-action': 'New album',
      'space-albums-link-action': 'Link',
    }.entries) {
      final button = tester.widget<IconButton>(find.byKey(Key(entry.key)));
      expect(button.tooltip, entry.value, reason: '${entry.key} must keep its label as a tooltip');
    }

    // Scoped to the AppBar deliberately: this page also builds TextButtons
    // inside _FolderNameDialog and the delete confirmation, so a bare
    // find.byType(TextButton) would pass only because no dialog is open.
    expect(
      find.descendant(of: find.byType(AppBar), matching: find.byType(TextButton)),
      findsNothing,
    );
  });

  testWidgets('the link action uses the add_link icon', (tester) async {
    await pumpPage(tester, folders: const [], albums: const []);

    final button = tester.widget<IconButton>(find.byKey(const Key('space-albums-link-action')));
    expect((button.icon as Icon).icon, Icons.add_link);
  });
```

`pumpPage`'s signature is `pumpPage(WidgetTester tester, {required List<SpaceAlbumFolder> folders, required List<SpaceAlbum> albums, String? folderId, bool canEdit = true, List<Override> overrides = const []})` — `canEdit` already defaults to `true`, so the calls above need no extra arguments.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd mobile && flutter test test/presentation/pages/space_albums_page_test.dart --plain-name 'icon-only'`

Expected: FAIL with a type error — `TextButton` is not an `IconButton` — from `tester.widget<IconButton>`.

- [ ] **Step 3: Convert the actions**

In `mobile/lib/pages/library/spaces/space_albums.page.dart`, replace the three `TextButton.icon` entries in the `AppBar`'s `actions:` list with:

```dart
          if (canEdit) ...[
            IconButton(
              key: const Key('space-albums-new-folder-action'),
              onPressed: createFolder,
              icon: const Icon(Icons.create_new_folder_outlined),
              tooltip: 'space_album_folder_new'.t(context: context),
            ),
            IconButton(
              key: const Key('space-albums-new-album-action'),
              onPressed: createAlbum,
              icon: const Icon(Icons.photo_album_outlined),
              tooltip: 'space_album_new'.t(context: context),
            ),
            IconButton(
              key: const Key('space-albums-link-action'),
              onPressed: () => onLink(folderId),
              // Was Icons.add. Stripped of its label, a bare plus does not say
              // what it adds; add_link matches web's mdiLinkVariantPlus.
              icon: const Icon(Icons.add_link),
              tooltip: 'link'.t(context: context),
            ),
          ],
```

- [ ] **Step 4: Run the full page test file**

Run: `cd mobile && flutter test test/presentation/pages/space_albums_page_test.dart`

Expected: PASS, including the viewer-gating cases at lines 400, 418, 699 and 798 — those are the regression signal that role gating was not disturbed.

- [ ] **Step 5: Run the neighbouring suites that tap these keys**

Run: `cd mobile && flutter test test/presentation/pages/space_albums_link_wiring_test.dart test/presentation/pages/space_b6_mutations_test.dart`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add mobile/lib/pages/library/spaces/space_albums.page.dart mobile/test/presentation/pages/space_albums_page_test.dart
git commit -m "fix(mobile): make the space albums app-bar actions icon-only"
```

---

## Task 4: Mobile — shelf header as a tap target (F2)

**Files:**

- Modify: `mobile/lib/presentation/widgets/spaces/space_albums_shelf.widget.dart` (`_buildShelf`'s `_HeaderRow(...)` call and the `_HeaderRow` class)
- Test: `mobile/test/presentation/widgets/spaces/space_albums_shelf_test.dart`

**Interfaces:**

- Consumes: nothing from other tasks.
- Produces: nothing. `_HeaderRow` is private to this file; its `showSeeAll` parameter is removed.

**Background.** Only the "See all" `Text` is currently wrapped in a `GestureDetector`, and `showSeeAll: albums.isNotEmpty` hides it entirely when the space has no albums. That second part is a functional hole: `SpaceAlbumsRoute` has exactly two push sites in the app — `space_detail.page.dart:448` (this callback) and `space_albums.page.dart:592` (the page recursing into a subfolder, reachable only from the first) — so a fresh space offers no way to reach the page holding "New album" and "New folder".

No Material chevron is added: `space_albums_see_all` is already `"See all ▸"` in every locale, so an `Icons.chevron_right` beside it would render two arrows.

- [ ] **Step 1: Write the failing tests**

Add to `mobile/test/presentation/widgets/spaces/space_albums_shelf_test.dart`:

```dart
  testWidgets('tapping the header title — not just "See all" — opens the albums page', (tester) async {
    var called = 0;

    await tester.pumpConsumerWidget(
      SpaceAlbumsShelf(
        spaceId: spaceId,
        canEdit: true,
        onLinkTap: () {},
        onAlbumTap: (_) {},
        onSeeAll: () => called++,
      ),
      overrides: _overrides(spaceId: spaceId, albums: [_album(id: 'a1', name: 'Hawaii')]),
    );

    await tester.tap(find.text('Albums (1)'));
    await tester.pumpAndSettle();

    expect(called, 1);
  });

  testWidgets('the header tap target spans the full shelf width', (tester) async {
    await tester.pumpConsumerWidget(
      SpaceAlbumsShelf(
        spaceId: spaceId,
        canEdit: true,
        onLinkTap: () {},
        onAlbumTap: (_) {},
        onSeeAll: () {},
      ),
      overrides: _overrides(spaceId: spaceId, albums: [_album(id: 'a1', name: 'Hawaii')]),
    );

    final inkWell = tester.getSize(find.byKey(const Key('space-albums-shelf-see-all')));
    final shelf = tester.getSize(find.byKey(const Key('space-albums-shelf')));

    expect(inkWell.width, shelf.width);
  });

  testWidgets('an editor with zero albums can still reach the albums page', (tester) async {
    var called = 0;

    await tester.pumpConsumerWidget(
      SpaceAlbumsShelf(
        spaceId: spaceId,
        canEdit: true,
        onLinkTap: () {},
        onAlbumTap: (_) {},
        onSeeAll: () => called++,
      ),
      overrides: _overrides(spaceId: spaceId, albums: const []),
    );

    expect(find.byKey(const Key('space-albums-shelf-see-all')), findsOneWidget);

    await tester.tap(find.byKey(const Key('space-albums-shelf-see-all')));
    await tester.pumpAndSettle();

    expect(called, 1, reason: 'a fresh space has no other route to New album / New folder');
  });

  testWidgets('a null onSeeAll leaves the header inert', (tester) async {
    await tester.pumpConsumerWidget(
      SpaceAlbumsShelf(spaceId: spaceId, canEdit: true, onLinkTap: () {}, onAlbumTap: (_) {}),
      overrides: _overrides(spaceId: spaceId, albums: [_album(id: 'a1', name: 'Hawaii')]),
    );

    await tester.tap(find.byKey(const Key('space-albums-shelf-see-all')));
    await tester.pumpAndSettle();

    expect(tester.takeException(), isNull);
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd mobile && flutter test test/presentation/widgets/spaces/space_albums_shelf_test.dart`

Expected: the four new tests FAIL — the first because tapping the title hits no gesture detector, the rest because `Key('space-albums-shelf-see-all')` does not exist yet.

- [ ] **Step 3: Rewrite `_HeaderRow`**

Replace the whole `_HeaderRow` class in `mobile/lib/presentation/widgets/spaces/space_albums_shelf.widget.dart` with:

```dart
class _HeaderRow extends StatelessWidget {
  const _HeaderRow({required this.count, this.onSeeAll});
  final int count;
  final VoidCallback? onSeeAll;

  @override
  Widget build(BuildContext context) {
    // The whole row, not just the "See all" text: the old target was the text's
    // own bounds. The InkWell adds no height, so kSpaceAlbumsShelfHeight and
    // SpaceTopSliver's reserved height are untouched.
    return InkWell(
      key: const Key('space-albums-shelf-see-all'),
      onTap: onSeeAll,
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 16),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Text(
              'space_albums_shelf_title'.t(context: context, args: {'count': count}),
              style: context.textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w600),
            ),
            // Deliberately unconditional. Gating this on `albums.isNotEmpty`
            // left a space with no linked albums with NO route to the albums
            // page at all — and that page is the only place an editor can
            // create an album or a folder. The viewer-with-no-albums case is
            // already handled one level up, where _buildShelf returns
            // SizedBox.shrink before this widget is built.
            Text(
              'space_albums_see_all'.t(context: context),
              style: context.textTheme.bodySmall?.copyWith(color: context.colorScheme.primary),
            ),
          ],
        ),
      ),
    );
  }
}
```

- [ ] **Step 4: Update the call site**

In `_buildShelf`, replace:

```dart
          _HeaderRow(count: albums.length, showSeeAll: albums.isNotEmpty, onSeeAll: onSeeAll),
```

with:

```dart
          _HeaderRow(count: albums.length, onSeeAll: onSeeAll),
```

- [ ] **Step 5: Run the shelf and top-sliver suites**

Run: `cd mobile && flutter test test/presentation/widgets/spaces/space_albums_shelf_test.dart test/presentation/pages/space_detail_top_sliver_test.dart`

Expected: PASS. The pre-existing `tapping "See all ▸" invokes the onSeeAll callback` test still passes (the text is inside the `InkWell`), and the top-sliver height test confirms `kSpaceAlbumsShelfHeight` did not move.

- [ ] **Step 6: Commit**

```bash
git add mobile/lib/presentation/widgets/spaces/space_albums_shelf.widget.dart mobile/test/presentation/widgets/spaces/space_albums_shelf_test.dart
git commit -m "fix(mobile): make the space albums shelf header a real tap target"
```

---

## Task 5: Mobile — widen the tab enum and add pure slot resolution (F5-a1)

**Files:**

- Modify: `mobile/lib/providers/gallery_nav/gallery_tab_enum.dart`
- Test: `mobile/test/providers/gallery_nav/gallery_tab_enum_test.dart`

**Interfaces:**

- Consumes: nothing.
- Produces:
  - `enum GalleryTabEnum { photos, albums, spaces, library }`
  - `List<GalleryTabEnum> galleryNavSlots({required bool showSpaces})` — always length 3, `[photos, spaces|albums, library]`.
  - `const int kGalleryPhotosIndex = 0; const int kGalleryCollectionIndex = 1; const int kGalleryLibraryIndex = 2;` — `kGalleryAlbumsIndex` is **renamed** to `kGalleryCollectionIndex`, since slot 1 may hold either tab. It has no production call sites.
  - `galleryTabProvider` unchanged.

**Warning — this task breaks two existing tests on purpose.** `gallery_tab_enum_test.dart` currently asserts `GalleryTabEnum.values` equals exactly `[photos, albums, library]` and that each value's `.index` equals the matching constant. Both encode the assumption this change removes: that enum order _is_ slot order. They are rewritten here, not deleted.

- [ ] **Step 1: Rewrite the enum test**

Replace the `group('GalleryTabEnum', …)` block in `mobile/test/providers/gallery_nav/gallery_tab_enum_test.dart` with:

```dart
  group('GalleryTabEnum', () {
    test('carries a value per destination, including Spaces', () {
      expect(GalleryTabEnum.values, [
        GalleryTabEnum.photos,
        GalleryTabEnum.albums,
        GalleryTabEnum.spaces,
        GalleryTabEnum.library,
      ]);
    });

    test('slot constants describe positions, not enum indices', () {
      expect(kGalleryPhotosIndex, 0);
      expect(kGalleryCollectionIndex, 1);
      expect(kGalleryLibraryIndex, 2);
    });
  });

  group('galleryNavSlots', () {
    test('puts Spaces in the middle slot when enabled', () {
      expect(galleryNavSlots(showSpaces: true), [
        GalleryTabEnum.photos,
        GalleryTabEnum.spaces,
        GalleryTabEnum.library,
      ]);
    });

    test('puts Albums in the middle slot when disabled', () {
      expect(galleryNavSlots(showSpaces: false), [
        GalleryTabEnum.photos,
        GalleryTabEnum.albums,
        GalleryTabEnum.library,
      ]);
    });

    test('always yields exactly three slots and never both collection tabs', () {
      for (final showSpaces in [true, false]) {
        final slots = galleryNavSlots(showSpaces: showSpaces);
        expect(slots, hasLength(3));
        expect(slots.toSet(), hasLength(3), reason: 'no slot may repeat');
        expect(
          slots.contains(GalleryTabEnum.albums) && slots.contains(GalleryTabEnum.spaces),
          isFalse,
        );
      }
    });
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd mobile && flutter test test/providers/gallery_nav/gallery_tab_enum_test.dart`

Expected: FAIL to compile — `GalleryTabEnum.spaces`, `galleryNavSlots` and `kGalleryCollectionIndex` are undefined.

- [ ] **Step 3: Widen the enum and add the slot function**

Replace the top of `mobile/lib/providers/gallery_nav/gallery_tab_enum.dart` (keep the existing `galleryTabProvider` at the bottom untouched):

```dart
/// Fork-only tab identity. Distinct from upstream's `TabEnum`
/// (`home/search/spaces/library`) — the bottom nav redesign keeps the
/// upstream enum + constants untouched for rebase hygiene (design §4.6, §6.6).
///
/// NOTE: the declaration order of this enum is NOT the nav slot order, and
/// `.index` must never be used as a router index. There are four values for
/// three slots, because slot 1 holds either Albums or Spaces depending on
/// `SettingsKey.navShowSpaces`. Use [galleryNavSlots] for every conversion
/// between a slot index and the tab occupying it.
enum GalleryTabEnum { photos, albums, spaces, library }

const int kGalleryPhotosIndex = 0;

/// Slot 1 — Albums or Spaces, per the user's preference.
const int kGalleryCollectionIndex = 1;
const int kGalleryLibraryIndex = 2;

/// The three nav slots, in order. The single place slot index and tab identity
/// are related; every call site reads through this rather than `.index` or
/// `.values`.
List<GalleryTabEnum> galleryNavSlots({required bool showSpaces}) => [
  GalleryTabEnum.photos,
  showSpaces ? GalleryTabEnum.spaces : GalleryTabEnum.albums,
  GalleryTabEnum.library,
];
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd mobile && flutter test test/providers/gallery_nav/gallery_tab_enum_test.dart`

Expected: PASS.

- [ ] **Step 5: Add the Spaces destination case, so the tree still compiles**

Widening the enum makes `GalleryNavDestination.forTab`'s `switch` non-exhaustive. That is a **compile error**, not a lint: the method returns a non-nullable `GalleryNavDestination`, so a body that might complete normally fails to build. The case therefore lands in this task rather than Task 9, keeping every commit green.

In `mobile/lib/providers/gallery_nav/gallery_nav_destination.dart`, add to the `switch` in `forTab`, between the `albums` and `library` cases:

```dart
      case GalleryTabEnum.spaces:
        return const GalleryNavDestination._(
          tab: GalleryTabEnum.spaces,
          // The existing `spaces` key, already translated everywhere — not a
          // new `nav_spaces`, which would ship English-only.
          labelKey: 'spaces',
          // Same pair the legacy tab shell uses for its own Spaces tab
          // (tab_shell.page.dart:41-42).
          idleIcon: Icons.workspaces_outlined,
          activeIcon: Icons.workspaces,
          routeBuilder: _spacesRoute,
        );
```

and add the top-level builder beside the others at the bottom of the file:

```dart
SpacesRoute _spacesRoute() => const SpacesRoute();
```

Do **not** add a `default:` clause anywhere to silence exhaustiveness errors — that guarantee is the main safety net for this whole feature. `_onTabTap`'s `switch` in `gallery_bottom_nav.widget.dart` returns `void`, so it does not error here; Task 8 adds its `spaces` case.

- [ ] **Step 6: Confirm the tree compiles and the nav tests still pass**

Run: `cd mobile && dart analyze --fatal-infos lib/providers/gallery_nav lib/presentation/widgets/gallery_nav lib/presentation/pages/common && flutter test test/providers/gallery_nav`

Expected: analyzer clean, all gallery-nav tests PASS.

- [ ] **Step 7: Commit**

```bash
git add mobile/lib/providers/gallery_nav/gallery_tab_enum.dart mobile/lib/providers/gallery_nav/gallery_nav_destination.dart mobile/test/providers/gallery_nav/gallery_tab_enum_test.dart
git commit -m "refactor(mobile): make nav slot order independent of GalleryTabEnum order"
```

---

## Task 6: Mobile — the persisted setting (F5-d, part 1)

**Files:**

- Create: `mobile/lib/domain/models/config/nav_config.dart`
- Modify: `mobile/lib/domain/models/settings_key.dart`
- Modify: `mobile/lib/domain/models/config/app_config.dart`
- Test: `mobile/test/domain/models/config/app_config_test.dart`

**Interfaces:**

- Consumes: `SettingsKey`, `AppConfig` (existing).
- Produces:
  - `class NavConfig { final bool showSpaces; const NavConfig({this.showSpaces = true}); NavConfig copyWith({bool? showSpaces}); }`
  - `SettingsKey.navShowSpaces<bool>()`
  - `AppConfig.nav` of type `NavConfig`, readable via `config.read(SettingsKey.navShowSpaces)` and writable via `config.write(SettingsKey.navShowSpaces, value)`.

**Background.** The default is `true` — Spaces. Note how `SettingsRepository.write` behaves (`settings.repository.dart:62-69`): writing a value equal to the default **deletes** the row rather than storing it. So "on" is represented by the absence of a row and "off" by a stored `false`. Tests assert the effective config value, never a stored row.

- [ ] **Step 1: Write the failing test**

Add to `mobile/test/domain/models/config/app_config_test.dart`:

```dart
  group('AppConfig nav prefs', () {
    test('navShowSpaces defaults to true', () {
      const c = AppConfig();
      expect(c.nav.showSpaces, true);
      expect(c.read(SettingsKey.navShowSpaces), true);
    });

    test('navShowSpaces round-trips both ways', () {
      const c = AppConfig();

      final off = c.write(SettingsKey.navShowSpaces, false);
      expect(off.read(SettingsKey.navShowSpaces), false);

      final backOn = off.write(SettingsKey.navShowSpaces, true);
      expect(backOn.read(SettingsKey.navShowSpaces), true);
    });

    test('an upgrading store with rows for other keys but none for nav still reads true', () {
      // fromEntries is what SettingsRepository._build feeds; a key with no row
      // simply never appears in the map.
      final config = AppConfig.fromEntries({SettingsKey.albumIsGrid: true});

      expect(config.read(SettingsKey.navShowSpaces), true);
      expect(config.read(SettingsKey.albumIsGrid), true);
    });
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd mobile && flutter test test/domain/models/config/app_config_test.dart`

Expected: FAIL to compile — `SettingsKey.navShowSpaces` and `AppConfig.nav` are undefined.

- [ ] **Step 3: Create `NavConfig`**

Create `mobile/lib/domain/models/config/nav_config.dart`:

```dart
/// Bottom-navigation preferences.
///
/// [showSpaces] defaults to TRUE: Spaces occupies the middle nav slot unless the
/// user turns it off, in which case Albums takes it back. Albums remains
/// reachable either way from the Library tab.
class NavConfig {
  final bool showSpaces;

  const NavConfig({this.showSpaces = true});

  NavConfig copyWith({bool? showSpaces}) => NavConfig(showSpaces: showSpaces ?? this.showSpaces);

  @override
  bool operator ==(Object other) => identical(this, other) || (other is NavConfig && other.showSpaces == showSpaces);

  @override
  int get hashCode => showSpaces.hashCode;

  @override
  String toString() => 'NavConfig(showSpaces: $showSpaces)';
}
```

- [ ] **Step 4: Declare the settings key**

In `mobile/lib/domain/models/settings_key.dart`, add a group after the `// Spaces` block:

```dart
  // Navigation
  navShowSpaces<bool>(),
```

- [ ] **Step 5: Wire it into `AppConfig`**

In `mobile/lib/domain/models/config/app_config.dart` make six edits:

1. Add the import: `import 'package:immich_mobile/domain/models/config/nav_config.dart';`
2. Add the field beside the other config fields: `final NavConfig nav;`
3. Add the constructor default: `this.nav = const .new(),`
4. Add to `copyWith`: the parameter `NavConfig? nav,` and the body line `nav: nav ?? this.nav,`
5. Add `other.nav == nav &&` to `operator ==`, `nav,` to `Object.hash(...)`, and `nav: $nav` to `toString()`
6. Add the two switch arms:
   - in `read`: `.navShowSpaces => nav.showSpaces,`
   - in `write`: `.navShowSpaces => copyWith(nav: nav.copyWith(showSpaces: value as bool)),`

Both switches are exhaustive over `SettingsKey` with no `default:` arm, so the compiler refuses to build until step 6 is done. That is the intended safety net — do not add a `default:`.

- [ ] **Step 6: Run the test to verify it passes**

Run: `cd mobile && flutter test test/domain/models/config/app_config_test.dart`

Expected: PASS.

- [ ] **Step 7: Run the settings repository tests**

Run: `cd mobile && flutter test test/unit/repositories/settings_repository_test.dart`

Expected: PASS — the new key must not disturb snapshot building.

- [ ] **Step 8: Commit**

```bash
git add mobile/lib/domain/models/config/nav_config.dart mobile/lib/domain/models/settings_key.dart mobile/lib/domain/models/config/app_config.dart mobile/test/domain/models/config/app_config_test.dart
git commit -m "feat(mobile): add the navShowSpaces setting, defaulting to Spaces"
```

---

## Task 7: Mobile — the settings tile (F5-d, part 2)

**Files:**

- Create: `mobile/lib/widgets/settings/preference_settings/nav_setting.dart`
- Modify: `mobile/lib/widgets/settings/preference_settings/preference_setting.dart:12`
- Modify: `i18n/en.json`
- Test: `mobile/test/widgets/settings/nav_setting_test.dart` (new)

**Interfaces:**

- Consumes: `SettingsKey.navShowSpaces` and `AppConfig.nav` (Task 6); `settingsProvider` / `appConfigProvider` from `mobile/lib/providers/infrastructure/settings.provider.dart`.
- Produces: `class NavSetting extends HookConsumerWidget` with `const NavSetting({super.key})`; switch keyed `Key('nav-show-spaces-switch')`.

**Deviation from the spec, deliberate:** the spec budgeted two new i18n keys. This needs **three** — the section heading as well — because `SettingGroupTitle` is the established shape for every tile in this page and there is no existing "Navigation" string to reuse.

- [ ] **Step 1: Add the i18n strings**

In `i18n/en.json`, add these three keys in alphabetical position:

```json
  "setting_nav_show_spaces": "Show Spaces in the navigation bar",
  "setting_nav_show_spaces_subtitle": "Replaces the Albums tab. Albums stays available from the Library tab.",
  "setting_nav_title": "Navigation",
```

Then regenerate: `cd mobile && dart run easy_localization:generate -S ../i18n && dart run bin/generate_keys.dart`.

- [ ] **Step 2: Write the failing test**

Create `mobile/test/widgets/settings/nav_setting_test.dart`. Model the harness on an existing settings widget test — read `mobile/test/widgets/settings/asset_list_group_settings_test.dart` first and reuse its provider-override and pump helpers rather than inventing new ones.

```dart
  testWidgets('reflects the stored value and round-trips through the effective config', (tester) async {
    // Fresh install: no row, so the default applies.
    await pumpNavSetting(tester);

    final tile = tester.widget<SwitchListTile>(find.byType(SwitchListTile));
    expect(tile.value, true, reason: 'Spaces is the default');

    await tester.tap(find.byKey(const Key('nav-show-spaces-switch')));
    await tester.pumpAndSettle();
    expect(readConfig().read(SettingsKey.navShowSpaces), false);

    await tester.tap(find.byKey(const Key('nav-show-spaces-switch')));
    await tester.pumpAndSettle();
    // Asserts the EFFECTIVE value, not a stored row: SettingsRepository.write
    // clears the row when the value equals the default, so "true" is persisted
    // as the absence of a row.
    expect(readConfig().read(SettingsKey.navShowSpaces), true);
  });
```

Define `pumpNavSetting` and `readConfig` in the test file against whatever fake or real `SettingsRepository` the neighbouring settings tests already use.

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd mobile && flutter test test/widgets/settings/nav_setting_test.dart`

Expected: FAIL to compile — `NavSetting` does not exist.

- [ ] **Step 4: Create the tile**

Create `mobile/lib/widgets/settings/preference_settings/nav_setting.dart`:

```dart
import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_hooks/flutter_hooks.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/models/settings_key.dart';
import 'package:immich_mobile/extensions/translate_extensions.dart';
import 'package:immich_mobile/providers/infrastructure/settings.provider.dart';
import 'package:immich_mobile/widgets/settings/setting_group_title.dart';
import 'package:immich_mobile/widgets/settings/settings_switch_list_tile.dart';

/// Switches the middle bottom-nav slot between Spaces (default) and Albums.
///
/// Reads and writes through `settingsProvider` / `appConfigProvider` rather than
/// the older `AppSettingsEnum` that [HapticSetting] uses — the former is the
/// backend nearly every settings widget already reads, and the latter is a
/// four-entry holdover.
class NavSetting extends HookConsumerWidget {
  const NavSetting({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final showSpaces = ref.watch(appConfigProvider.select((config) => config.nav.showSpaces));
    final valueNotifier = useValueNotifier(showSpaces);

    // Keep the notifier in step when the value changes anywhere else — the
    // notifier is created once, on first build, from the value at that moment.
    useEffect(() {
      valueNotifier.value = showSpaces;
      return null;
    }, [showSpaces]);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        SettingGroupTitle(title: 'setting_nav_title'.t(context: context), icon: Icons.navigation_outlined),
        SettingsSwitchListTile(
          key: const Key('nav-show-spaces-switch'),
          valueNotifier: valueNotifier,
          title: 'setting_nav_show_spaces'.t(context: context),
          subtitle: 'setting_nav_show_spaces_subtitle'.t(context: context),
          onChanged: (value) => unawaited(ref.read(settingsProvider).write(SettingsKey.navShowSpaces, value)),
        ),
      ],
    );
  }
}
```

- [ ] **Step 5: List it on the preferences page**

In `mobile/lib/widgets/settings/preference_settings/preference_setting.dart`, add the import and extend line 12:

```dart
    const preferenceSettings = [ThemeSetting(), NavSetting(), HapticSetting(), ShareSetting()];
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `cd mobile && flutter test test/widgets/settings/nav_setting_test.dart`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add mobile/lib/widgets/settings/preference_settings/nav_setting.dart mobile/lib/widgets/settings/preference_settings/preference_setting.dart mobile/test/widgets/settings/nav_setting_test.dart i18n/en.json
git commit -m "feat(mobile): add a Preferences switch for Spaces in the navigation bar"
```

---

## Task 8: Mobile — derive the nav from slots (F5-a2)

**Files:**

- Modify: `mobile/lib/providers/gallery_nav/gallery_tab_enum.dart` (add the provider)
- Modify: `mobile/lib/presentation/widgets/gallery_nav/gallery_bottom_nav.widget.dart:115-116,134-157,159-184`
- Modify: `mobile/lib/presentation/widgets/gallery_nav/gallery_nav_pill.widget.dart:29-31,168`
- Modify: `mobile/lib/presentation/pages/common/gallery_tab_shell.page.dart:31`
- Modify: `mobile/lib/providers/gallery_nav/gallery_search_action.dart:20,23`
- Test: `mobile/test/presentation/widgets/gallery_nav/gallery_bottom_nav_test.dart`
- Test: `mobile/test/providers/gallery_nav/gallery_search_action_test.dart`

**Interfaces:**

- Consumes: `galleryNavSlots` (Task 5), `AppConfig.nav.showSpaces` (Task 6).
- Produces:
  - `final galleryNavSlotsProvider = Provider.autoDispose<List<GalleryTabEnum>>(...)`
  - `GalleryNavPill` gains a required `List<GalleryTabEnum> slots` parameter.

**Critical detail.** `appConfigProvider` is declared `Provider.autoDispose`. A non-autoDispose provider may not watch an autoDispose one — Riverpod throws at runtime. `galleryNavSlotsProvider` **must** be `Provider.autoDispose` too.

- [ ] **Step 1: Write the failing tests**

Add to `mobile/test/presentation/widgets/gallery_nav/gallery_bottom_nav_test.dart`, importing `package:immich_mobile/domain/models/config/app_config.dart`, `package:immich_mobile/domain/models/config/nav_config.dart` and `package:immich_mobile/providers/infrastructure/settings.provider.dart`. Override `appConfigProvider` with a fixed `AppConfig` to control the setting:

```dart
  // No leading underscore: `no_leading_underscores_for_local_identifiers` is on
  // via flutter_lints, and `dart analyze --fatal-infos` is a gate.
  // `overrideWithValue` with a directly-constructed AppConfig is the pattern
  // every other test in this repo uses (e.g. collection_picker_test.dart:89).
  List<Override> navOverrides({required bool showSpaces}) => [
    appConfigProvider.overrideWithValue(AppConfig(nav: NavConfig(showSpaces: showSpaces))),
  ];

  testWidgets('with Spaces on, the pill renders a Spaces segment and no Albums segment', (tester) async {
    final router = FakeTabsRouter();
    await tester.pumpWidget(
      _wrap(GalleryBottomNav(tabsRouter: router), overrides: navOverrides(showSpaces: true)),
    );
    await tester.pumpAndSettle();

    expect(find.byKey(const Key('gallery-nav-segment-spaces')), findsOneWidget);
    expect(find.byKey(const Key('gallery-nav-segment-albums')), findsNothing);
  });

  testWidgets('with Spaces off, the pill renders an Albums segment and no Spaces segment', (tester) async {
    final router = FakeTabsRouter();
    await tester.pumpWidget(
      _wrap(GalleryBottomNav(tabsRouter: router), overrides: navOverrides(showSpaces: false)),
    );
    await tester.pumpAndSettle();

    expect(find.byKey(const Key('gallery-nav-segment-albums')), findsOneWidget);
    expect(find.byKey(const Key('gallery-nav-segment-spaces')), findsNothing);
  });

  testWidgets('tapping the Spaces segment activates slot 1 and does not refresh albums', (tester) async {
    final router = FakeTabsRouter();
    final albums = _FakeRemoteAlbumNotifier();

    await tester.pumpWidget(
      _wrap(
        GalleryBottomNav(tabsRouter: router),
        overrides: [
          ...navOverrides(showSpaces: true),
          remoteAlbumProvider.overrideWith(() => albums),
        ],
      ),
    );
    await tester.pumpAndSettle();

    await tester.tap(find.byKey(const Key('gallery-nav-segment-spaces')));
    await tester.pumpAndSettle();

    expect(router.setCalls, [1]);
    expect(albums.refreshCalls, 0, reason: 'the albums tab is not on screen');
  });

  testWidgets('tapping the Albums segment still refreshes albums', (tester) async {
    final router = FakeTabsRouter();
    final albums = _FakeRemoteAlbumNotifier();

    await tester.pumpWidget(
      _wrap(
        GalleryBottomNav(tabsRouter: router),
        overrides: [
          ...navOverrides(showSpaces: false),
          remoteAlbumProvider.overrideWith(() => albums),
        ],
      ),
    );
    await tester.pumpAndSettle();

    await tester.tap(find.byKey(const Key('gallery-nav-segment-albums')));
    await tester.pumpAndSettle();

    expect(router.setCalls, [1]);
    expect(albums.refreshCalls, 1);
  });

  testWidgets('readonly mode disables slot 1 whichever tab occupies it', (tester) async {
    final router = FakeTabsRouter();

    await tester.pumpWidget(
      _wrap(
        GalleryBottomNav(tabsRouter: router),
        overrides: [
          ...navOverrides(showSpaces: true),
          readonlyModeProvider.overrideWith(() => _FakeReadonly(true)),
        ],
      ),
    );
    await tester.pumpAndSettle();

    final pill = tester.widget<GalleryNavPill>(find.byType(GalleryNavPill));
    expect(pill.disabledTabs, {GalleryTabEnum.spaces, GalleryTabEnum.library});
  });

  testWidgets('the landscape rail follows the same slots', (tester) async {
    final router = FakeTabsRouter();

    await tester.pumpWidget(
      _wrap(
        GalleryBottomNav(tabsRouter: router),
        overrides: navOverrides(showSpaces: true),
        mq: const MediaQueryData(size: Size(900, 400)),
      ),
    );
    await tester.pumpAndSettle();

    final rail = tester.widget<NavigationRail>(find.byKey(const Key('gallery-bottom-nav-rail')));
    expect(rail.destinations, hasLength(3));
    expect(find.text('Spaces'), findsOneWidget);
    expect(find.text('Albums'), findsNothing);
  });

  testWidgets('the active segment follows the slot occupant after a flip', (tester) async {
    final router = FakeTabsRouter(initialIndex: 1);
    final container = ProviderContainer(
      overrides: [
        readonlyModeProvider.overrideWith(() => _FakeReadonly(false)),
        hapticFeedbackProvider.overrideWith((ref) => _NoOpHaptic(ref)),
        ...navOverrides(showSpaces: true),
      ],
    );
    addTearDown(container.dispose);

    await tester.pumpWidget(
      UncontrolledProviderScope(
        container: container,
        child: MaterialApp(
          home: MediaQuery(
            data: _portraitMq,
            child: Material(child: GalleryBottomNav(tabsRouter: router)),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();

    var pill = tester.widget<GalleryNavPill>(find.byType(GalleryNavPill));
    expect(pill.activeTab, GalleryTabEnum.spaces);

    container.updateOverrides([
      readonlyModeProvider.overrideWith(() => _FakeReadonly(false)),
      hapticFeedbackProvider.overrideWith((ref) => _NoOpHaptic(ref)),
      appConfigProvider.overrideWithValue(const AppConfig(nav: NavConfig(showSpaces: false))),
    ]);
    await tester.pumpAndSettle();

    pill = tester.widget<GalleryNavPill>(find.byType(GalleryNavPill));
    expect(pill.activeTab, GalleryTabEnum.albums, reason: 'slot 1 changed occupant, the index did not');
    expect(pill.slots, [GalleryTabEnum.photos, GalleryTabEnum.albums, GalleryTabEnum.library]);
  });
```

Add to `mobile/test/providers/gallery_nav/gallery_search_action_test.dart`:

```dart
  test('search targets slot 0 regardless of the nav configuration', () {
    for (final showSpaces in [true, false]) {
      expect(galleryNavSlots(showSpaces: showSpaces).first, GalleryTabEnum.photos);
      expect(kGalleryPhotosIndex, 0);
    }
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd mobile && flutter test test/presentation/widgets/gallery_nav/gallery_bottom_nav_test.dart test/providers/gallery_nav/gallery_search_action_test.dart`

Expected: FAIL — `gallery-nav-segment-spaces` is never rendered, and `GalleryNavPill` has no `slots` member.

- [ ] **Step 3: Add the slots provider**

Append to `mobile/lib/providers/gallery_nav/gallery_tab_enum.dart`:

```dart
/// The live nav slots, derived from the user's `navShowSpaces` preference.
///
/// `autoDispose` is required, not stylistic: `appConfigProvider` is itself
/// `autoDispose`, and a non-autoDispose provider watching one throws.
final galleryNavSlotsProvider = Provider.autoDispose<List<GalleryTabEnum>>((ref) {
  final showSpaces = ref.watch(appConfigProvider.select((config) => config.nav.showSpaces));
  return galleryNavSlots(showSpaces: showSpaces);
});
```

Add the import: `import 'package:immich_mobile/providers/infrastructure/settings.provider.dart';`

- [ ] **Step 4: Give the pill its slots**

In `mobile/lib/presentation/widgets/gallery_nav/gallery_nav_pill.widget.dart`:

1. Add the field and constructor parameter:

```dart
  /// The slots to render, in order — see `galleryNavSlots`. Not
  /// `GalleryTabEnum.values`: that has four entries for three slots.
  final List<GalleryTabEnum> slots;

  const GalleryNavPill({
    super.key,
    required this.activeTab,
    required this.onTabTap,
    required this.slots,
    this.disabledTabs = const {},
  });
```

2. **Fix `_measure`, or the indicator silently dies.** Leave the `_keys` field initializer (lines 29-31) as it is — it is keyed by tab, not by position, and cannot read `widget.slots` from a field initializer anyway:

```dart
  final Map<GalleryTabEnum, GlobalKey> _keys = {
    for (final t in GalleryTabEnum.values) t: GlobalKey(debugLabel: 'gallery-nav-segment-${t.name}'),
  };
```

But `_measure` currently walks `_keys.entries` and then gates the write on `rects.length == _keys.length`. Widening the enum makes `_keys.length` 4 while only 3 segments are ever rendered, so `rects.length` is 3, the guard is **never** satisfied, `_segmentRects` stays empty forever and the animated underlay never appears. Nothing would fail loudly — the pill would just lose its indicator.

Replace the body of `_measure` from `final rects = ...` down to the closing `}` of the `if` with:

```dart
    // Iterate the RENDERED slots, not every enum value: there are four values
    // for three slots, so measuring `_keys` and comparing against its length
    // would gate on a count that can never be reached. Driving off
    // `widget.slots` also drops any rect measured under a previous
    // configuration, so a flip cannot leave the underlay on a segment that is
    // no longer on screen.
    final rects = <GalleryTabEnum, Rect>{};
    for (final tab in widget.slots) {
      final ctx = _keys[tab]?.currentContext;
      if (ctx == null) continue;
      final box = ctx.findRenderObject() as RenderBox?;
      if (box == null) continue;
      // Project through the full transform rather than diffing origins: the
      // segments sit inside a `FittedBox` that may scale them down (#909), so
      // their raw `size` is the pre-scale size and would leave the underlay
      // wider than the segment it highlights.
      rects[tab] = MatrixUtils.transformRect(box.getTransformTo(pillBox), Offset.zero & box.size);
    }
    if (rects.length == widget.slots.length && !_rectsEqual(rects, _segmentRects)) {
      setState(() => _segmentRects = rects);
    }
```

3. Replace the render loop at line 168:

```dart
                      for (final tab in widget.slots)
```

- [ ] **Step 5: Move the bottom nav onto slots**

In `mobile/lib/presentation/widgets/gallery_nav/gallery_bottom_nav.widget.dart`:

1. In `build`, after `final isReadonly = ...`, add `final slots = ref.watch(galleryNavSlotsProvider);`
2. Replace the pill construction (lines 113-119):

```dart
                Flexible(
                  child: GalleryNavPill(
                    slots: slots,
                    activeTab: slots[widget.tabsRouter.activeIndex.clamp(0, slots.length - 1)],
                    disabledTabs: isReadonly ? {slots[kGalleryCollectionIndex], slots[kGalleryLibraryIndex]} : const {},
                    onTabTap: (tab) => _onTabTap(tab, slots),
                  ),
                ),
```

3. Change `_onTabTap` to take the slots and resolve the index through them:

```dart
  void _onTabTap(GalleryTabEnum tab, List<GalleryTabEnum> slots) {
    final currentIndex = widget.tabsRouter.activeIndex;

    if (tab == GalleryTabEnum.photos && currentIndex == kGalleryPhotosIndex) {
      EventStream.shared.emit(const ScrollToTopEvent());
    }

    switch (tab) {
      case GalleryTabEnum.photos:
        ref.invalidate(driftMemoryFutureProvider);
        break;
      case GalleryTabEnum.albums:
        unawaited(ref.read(remoteAlbumProvider.notifier).refresh());
        break;
      case GalleryTabEnum.spaces:
        ref.invalidate(sharedSpacesProvider);
        break;
      case GalleryTabEnum.library:
        ref.invalidate(localAlbumProvider);
        ref.invalidate(driftGetAllPeopleProvider);
        ref.invalidate(driftGetAllPeopleWithSharedSpacesProvider);
        break;
    }

    ref.read(hapticFeedbackProvider.notifier).selectionClick();
    widget.tabsRouter.setActiveIndex(slots.indexOf(tab));
  }
```

Add the import: `import 'package:immich_mobile/providers/shared_space.provider.dart';`

4. Change `_landscapeRail` to take the slots and iterate them:

```dart
  Widget _landscapeRail(bool isReadonly, List<GalleryTabEnum> slots) {
    return NavigationRail(
      key: const Key('gallery-bottom-nav-rail'),
      selectedIndex: widget.tabsRouter.activeIndex,
      onDestinationSelected: (i) {
        final tab = slots[i];
        if (isReadonly && tab != GalleryTabEnum.photos) return;
        _onTabTap(tab, slots);
      },
      labelType: NavigationRailLabelType.all,
      destinations: [
        for (final tab in slots)
          NavigationRailDestination(
            icon: Icon(GalleryNavDestination.forTab(tab).idleIcon),
            selectedIcon: Icon(GalleryNavDestination.forTab(tab).activeIcon),
            label: Text(GalleryNavDestination.forTab(tab).labelKey.tr()),
            disabled: isReadonly && tab != GalleryTabEnum.photos,
          ),
      ],
      trailing: IconButton(
        key: const Key('gallery-bottom-nav-rail-search'),
        icon: const Icon(Icons.search),
        onPressed: isReadonly ? null : () => openGallerySearch(widget.tabsRouter, ref.read),
      ),
    );
  }
```

and update its call site to `return _landscapeRail(isReadonly, slots);`.

- [ ] **Step 6: Move the shell's tab sync onto slots**

In `mobile/lib/presentation/pages/common/gallery_tab_shell.page.dart`, replace line 31:

```dart
    final slots = ref.read(galleryNavSlotsProvider);
    ref.read(galleryTabProvider.notifier).state = slots[i.clamp(0, slots.length - 1)];
```

- [ ] **Step 7: Express the search action's index by name**

In `mobile/lib/providers/gallery_nav/gallery_search_action.dart`, replace `GalleryTabEnum.photos.index` at lines 20 and 23 with `kGalleryPhotosIndex`, so no caller reads a slot index off the enum.

- [ ] **Step 8: Run the nav suites**

Run: `cd mobile && flutter test test/presentation/widgets/gallery_nav test/providers/gallery_nav`

Expected: PASS. `gallery_nav_destination.dart` already carries its `spaces` case from Task 5, so the only switch this task completes is `_onTabTap`'s.

- [ ] **Step 9: Commit**

```bash
git add mobile/lib/providers/gallery_nav mobile/lib/presentation/widgets/gallery_nav mobile/lib/presentation/pages/common/gallery_tab_shell.page.dart mobile/test/presentation/widgets/gallery_nav mobile/test/providers/gallery_nav
git commit -m "feat(mobile): drive the bottom nav from configurable slots"
```

---

## Task 9: Mobile — the Spaces destination (F5-b)

**Files:**

- Modify: `mobile/lib/providers/gallery_nav/gallery_nav_destination.dart`
- Modify: `mobile/lib/pages/library/spaces/spaces.page.dart:157`
- Test: `mobile/test/providers/gallery_nav/gallery_nav_destination_test.dart`

**Interfaces:**

- Consumes: `GalleryTabEnum.spaces` (Task 5).
- Produces: `GalleryNavDestination.forTab(GalleryTabEnum.spaces)` returning `labelKey: 'spaces'`, `idleIcon: Icons.workspaces_outlined`, `activeIcon: Icons.workspaces`, `routeBuilder: _spacesRoute`.

**Background.** `Icons.workspaces_outlined` / `Icons.workspaces` is the pair the legacy `tab_shell.page.dart:41-42` already uses for its Spaces tab. The `spaces` i18n key already exists and is translated in every locale, so no new key is needed.

`SpacesPage`'s app bar is currently `AppBar(title: const Text('Spaces'))` — a hardcoded English literal. That was tolerable for a page reached by an explicit push; this change makes it the default second tab, so it gets localized here.

**Read this before starting: two of this task's steps are not red-first, and that is deliberate.**

The destination case itself landed in Task 5, because widening the enum there made `forTab`'s switch non-exhaustive and that is a compile error, not a lint — leaving it for this task would have committed a tree that does not build. So Step 1's test is a **characterization test over code that already exists**, not a red test. Write it anyway: nothing currently pins the label key, the icon pair, or the route builder, and all three are exactly the kind of detail a later edit silently changes.

The title localization has **no test at all**, for a reason worth stating rather than papering over: the `spaces` key's English value is `"Spaces"`, byte-identical to the hardcoded literal it replaces. Any `find.text('Spaces')` assertion passes just as happily before and after — the cannot-fail shape the plan's Global Constraints forbid. The change only has observable effect in non-English locales, and the harness does not switch locales. It is verified by the analyzer and by the existing spaces-page suite continuing to pass. Do not invent a test that appears to cover it.

- [ ] **Step 1: Write the characterization test**

Add to `mobile/test/providers/gallery_nav/gallery_nav_destination_test.dart`:

```dart
    test('spaces destination carries the shared Spaces identity', () {
      final destination = GalleryNavDestination.forTab(GalleryTabEnum.spaces);

      expect(destination.tab, GalleryTabEnum.spaces);
      expect(destination.labelKey, 'spaces');
      expect(destination.idleIcon, Icons.workspaces_outlined);
      expect(destination.activeIcon, Icons.workspaces);
      expect(destination.routeBuilder(), isA<SpacesRoute>());
    });
```

- [ ] **Step 2: Run it and confirm it passes for the right reason**

Run: `cd mobile && flutter test test/providers/gallery_nav/gallery_nav_destination_test.dart`

Expected: PASS. Then prove it is not vacuous: temporarily change the expected `labelKey` to `'nav_spaces'`, re-run, confirm it FAILS, and revert. A characterization test you have not seen fail is decoration.

- [ ] **Step 3: Localize the Spaces page title**

In `mobile/lib/pages/library/spaces/spaces.page.dart`, replace line 157:

```dart
      appBar: AppBar(title: Text('spaces'.t(context: context))),
```

The file already imports `package:immich_mobile/extensions/translate_extensions.dart`; confirm before adding it.

- [ ] **Step 4: Run the destination and spaces-page suites**

Run: `cd mobile && flutter test test/providers/gallery_nav/gallery_nav_destination_test.dart && flutter test test/presentation/widgets/gallery_nav`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add mobile/lib/pages/library/spaces/spaces.page.dart mobile/test/providers/gallery_nav/gallery_nav_destination_test.dart
git commit -m "feat(mobile): add the Spaces nav destination and localize the Spaces title"
```

---

## Task 10: Mobile — swap the shell's tab route (F5-c)

**Files:**

- Modify: `mobile/lib/presentation/pages/common/gallery_tab_shell.page.dart:44`
- Modify: `mobile/lib/routing/router.dart:151-155`
- Test: `mobile/test/presentation/pages/gallery_tab_shell_test.dart` (new)

**Interfaces:**

- Consumes: everything from Tasks 5–9.
- Produces: no new API. `GalleryTabShellRoute` gains `SpacesRoute` as a declared child.

**Background and the one real unknown.** `AutoTabsRouter.routes` is currently a `const` list. It becomes conditional, which means the list's identity at slot 1 changes while the widget stays mounted. Whether auto_route 11.1.0 re-resolves in place is the open question this task settles — the flip tests below are written first precisely so it surfaces before the production change is committed to.

Two pieces of precedent make this narrower than it looks:

- The legacy `TabShellRoute` already declares `SpacesRoute.page` as a tab child with exactly these guards (`router.dart:142`) and drives it as slot 1 of its own `AutoTabsRouter` (`tab_shell.page.dart:73`). Spaces working as a tab root is settled; only the _mutation_ of the list is new.
- Declaring the same page both as a shell child and top-level is already the norm here, not a novelty: `DriftAlbumsRoute` (child `:153`, top-level `:230`) and `DriftLibraryRoute` (child `:154`, top-level `:224`) both do it, and `SpacesRoute` is already top-level at `:167` — which is what `drift_library.page.dart:171,557` resolves against today. Adding the shell child is additive; it does not change how those pushes resolve.

**If the flip test cannot be made to pass**, fall back to resetting the active index to 0 when the setting changes — a visible but safe degradation — and record that in the spec's F5 edge-case list before implementing it. Do not paper over it with a `key:` that force-rebuilds the whole shell; that discards every tab's stack on an unrelated setting change.

- [ ] **Step 1: Write the failing tests**

Create `mobile/test/presentation/pages/gallery_tab_shell_test.dart`. Pump `GalleryTabShellPage` inside a real `AppRouter` — model the harness on `mobile/test/routing/router_test.dart`, which already builds one.

```dart
  testWidgets('slot 1 routes to Spaces when the setting is on', (tester) async {
    await pumpShell(tester, showSpaces: true);

    final tabsRouter = tester.state<dynamic>(find.byType(GalleryTabShellPage));
    expect(currentTabRoutes(tester), [
      isA<MainTimelineRoute>(),
      isA<SpacesRoute>(),
      isA<DriftLibraryRoute>(),
    ]);
  });

  testWidgets('slot 1 routes to Albums when the setting is off', (tester) async {
    await pumpShell(tester, showSpaces: false);

    expect(currentTabRoutes(tester), [
      isA<MainTimelineRoute>(),
      isA<DriftAlbumsRoute>(),
      isA<DriftLibraryRoute>(),
    ]);
  });

  testWidgets('galleryTabProvider reports the slot occupant, not the slot name', (tester) async {
    final container = await pumpShell(tester, showSpaces: true);

    await activateIndex(tester, 1);

    expect(container.read(galleryTabProvider), GalleryTabEnum.spaces);
  });

  testWidgets('flipping the setting while standing on slot 1 keeps the index and swaps the page', (tester) async {
    final container = await pumpShell(tester, showSpaces: true);
    await activateIndex(tester, 1);
    expect(find.byType(SpacesPage), findsOneWidget);

    await setShowSpaces(tester, container, false);

    expect(tester.takeException(), isNull);
    expect(activeIndex(tester), 1);
    expect(find.byType(DriftAlbumsPage), findsOneWidget);
    expect(find.byType(SpacesPage), findsNothing);
  });

  testWidgets('flipping the setting on while standing on slot 1 does the reverse', (tester) async {
    final container = await pumpShell(tester, showSpaces: false);
    await activateIndex(tester, 1);
    expect(find.byType(DriftAlbumsPage), findsOneWidget);

    await setShowSpaces(tester, container, true);

    expect(tester.takeException(), isNull);
    expect(activeIndex(tester), 1);
    expect(find.byType(SpacesPage), findsOneWidget);
  });

  testWidgets('a flip that happens while a pushed page covers the shell lands correctly on pop', (tester) async {
    final container = await pumpShell(tester, showSpaces: false);
    await activateIndex(tester, 1);
    expect(find.byType(DriftAlbumsPage), findsOneWidget);

    await pushRoute(tester, const DriftCreateAlbumRoute());
    await setShowSpaces(tester, container, true);
    await popRoute(tester);

    expect(tester.takeException(), isNull);
    expect(activeIndex(tester), 1);
    expect(find.byType(SpacesPage), findsOneWidget);
  });
```

Write `pumpShell`, `currentTabRoutes`, `activateIndex`, `activeIndex`, `setShowSpaces`, `pushRoute` and `popRoute` as helpers in this file. `setShowSpaces` must go through `container.updateOverrides` on `appConfigProvider` followed by `await tester.pumpAndSettle()`. Both space and album pages hit network/Drift providers on build — override `sharedSpacesProvider` and `remoteAlbumProvider` with fixed empty values so the test exercises routing, not data loading.

**Why the last test pushes over the shell rather than "onto slot 1".** Each tab child is declared as a leaf `AutoRoute` with no `children:` (`router.dart:151-155`), so a tab has no stack of its own — `context.pushRoute` walks up and resolves against the top-level declarations (`DriftCreateAlbumRoute.page` is at `router.dart:231`), producing a page that covers the entire shell, nav bar included. There is therefore no such thing as a stale page buried inside slot 1, and a test asserting one would be asserting a state the router cannot reach. What _can_ happen is a flip landing while the shell is covered, which is what this test drives.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd mobile && flutter test test/presentation/pages/gallery_tab_shell_test.dart`

Expected: the Spaces cases FAIL — the shell's route list is a `const` containing `DriftAlbumsRoute`, and `SpacesRoute` is not a declared child of `GalleryTabShellRoute`, so auto_route cannot resolve it.

- [ ] **Step 3: Declare `SpacesRoute` under the shell**

In `mobile/lib/routing/router.dart`, add one line to the `GalleryTabShellRoute` children, mirroring the legacy declaration at line 142 exactly:

```dart
      children: [
        AutoRoute(page: MainTimelineRoute.page, guards: [_authGuard, _duplicateGuard]),
        AutoRoute(page: DriftAlbumsRoute.page, guards: [_authGuard, _duplicateGuard]),
        // Declared but not always a tab: the `routes:` list in
        // GalleryTabShellPage picks three of these four per the user's
        // navShowSpaces preference. DriftAlbumsRoute stays declared even when
        // Spaces occupies slot 1 — the Library tab pushes it directly.
        AutoRoute(page: SpacesRoute.page, guards: [_authGuard, _duplicateGuard]),
        AutoRoute(page: DriftLibraryRoute.page, guards: [_authGuard, _duplicateGuard]),
      ],
```

- [ ] **Step 4: Make the shell's routes conditional**

In `mobile/lib/presentation/pages/common/gallery_tab_shell.page.dart`, replace line 44:

```dart
    final slots = ref.watch(galleryNavSlotsProvider);
    return AutoTabsRouter(
      routes: [for (final tab in slots) GalleryNavDestination.forTab(tab).routeBuilder()],
```

This reuses `routeBuilder`, so the tab route and the nav destination can never disagree about what slot 1 holds. Add the import for `gallery_nav_destination.dart`.

- [ ] **Step 5: Run the shell tests**

Run: `cd mobile && flutter test test/presentation/pages/gallery_tab_shell_test.dart`

Expected: PASS. If the two flip tests fail with an auto_route assertion, stop and apply the fallback described above rather than working around it locally.

- [ ] **Step 6: Run the routing suite**

Run: `cd mobile && flutter test test/routing/router_test.dart`

Expected: PASS — the added child must not disturb existing route resolution or the duplicate guards.

- [ ] **Step 7: Commit**

```bash
git add mobile/lib/routing/router.dart mobile/lib/presentation/pages/common/gallery_tab_shell.page.dart mobile/test/presentation/pages/gallery_tab_shell_test.dart
git commit -m "feat(mobile): show Spaces in the bottom nav by default"
```

---

## Task 11: Full verification

**Files:** none modified unless a gate fails.

- [ ] **Step 1: Mobile test suite**

Run: `cd mobile && flutter test`

Expected: PASS, whole suite.

- [ ] **Step 2: Mobile analyzer**

Run: `cd mobile && dart analyze --fatal-infos`

Expected: no issues. CI treats infos as fatal.

- [ ] **Step 3: Web tests and type checks**

Run: `cd web && pnpm test -- --run && pnpm check:typescript && pnpm check:svelte`

Expected: PASS all three.

- [ ] **Step 4: Lint and format**

Run: `make lint-web && make format-web`

Expected: clean; commit any formatting changes.

- [ ] **Step 5: Commit any fixes**

```bash
git add -A
git commit -m "chore: apply lint and format fixes"
```

---

## Self-Review Notes

**Spec coverage.** F1 → Task 3. F2 → Task 4. F3 → Task 2. F4 → Task 1. F5 → Tasks 5–10, in the spec's §6 order (a1, d, a2, b, c) with (d) split across Tasks 6 and 7 because the config wiring and the settings UI have independent test cycles. The spec's §5 verification gates are Task 11.

**Two deliberate deviations from the spec, both flagged in place:**

1. Task 2 builds a text-only drag chip; the spec said "folder glyph + name". A Unicode glyph renders inconsistently across platforms and an inline SVG in a detached node adds failure modes for no functional gain.
2. Task 7 adds three i18n keys; the spec budgeted two. `SettingGroupTitle` is the established shape for every tile on that page and there is no existing "Navigation" string to reuse.

**Scenario mapping.** All 32 spec scenarios have a test, except three that are covered structurally rather than by a dedicated case: "a viewer with no albums sees no shelf at all" (already asserted by the pre-existing `count==0 + canEdit=false: renders nothing` test), "Albums stays reachable from the Library tab" (`drift_library.page.dart` pushes `DriftAlbumsRoute`, which stays declared at `router.dart:230` and is untouched by any task), and "the pill highlights the correct segment after a flip" (folded into Task 8's flip test, which asserts `activeTab` and `slots` together).
