# Mobile Filter Parity — Slice 5: Tags picker + cap — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Spec:** `docs/superpowers/specs/2026-07-07-mobile-filter-parity-design.md` (Slice 5 row; "BDD — Slice 5: Tags"; "UI anatomy → Tags picker" `#mockup-tags-picker`).

**Goal:** Add a full-screen **Tags picker** — flat list from the full `tagProvider` (`Set<Tag>`), client-side substring search over the full-path `value`, MULTI-select, each row showing leaf name + full-path subtitle, windowed (`ListView.builder`) for tens of thousands; a "Selected · N" chip strip. Cap the Tags deep section + browse strip and wire "Search N tags →" to the picker.

**Architecture:** New `@RoutePage() TagsPickerPage` mirroring `person_picker.page.dart` (AppBar + CustomScrollView + windowed list, single "MATCHES" bucket, no alpha scrubber). New `tags_picker.provider.dart` (query + filtered over `tagProvider`). New `SelectedTagsStrip` (resolves `tagId → value` via `tagProvider`, `InputChip`s → `toggleTag`). Register route → `mise run codegen`. Cap the Tags deep section Wrap + header trailing "Search N tags →"; wire `deep_content` Tags entry to `TagsPickerRoute`; cap the strip + trailing tile.

**Tech Stack:** Flutter 3.44.1, `hooks_riverpod`, `auto_route` (+ codegen), `easy_localization`.

## Global Constraints

- Package `package:immich_mobile/...`; Flutter 3.44.1 via `mise exec --`; CI `dart analyze --fatal-infos` over lib AND test.
- **Route codegen:** after editing `router.dart`, run `mise run codegen` from `mobile/`; commit `router.dart` + regenerated `router.gr.dart` together. Never hand-edit `router.gr.dart`.
- Tag model: `Tag { String id; String value; }` where `value` is the **full hierarchical path** (e.g. `Travel/Italy/Rome`). Leaf = `value.split('/').last`; subtitle = the parent path (`value.split('/')` minus last, joined `' / '`); if no `/`, leaf = value and NO subtitle.
- Picker sources the FULL list `ref.watch(tagProvider)` (`AsyncValue<Set<Tag>>`), NOT the context-narrowed `photosFilterSuggestionsProvider.tags` (which the section/strip keep using).
- **Multi-select** via `ref.read(photosFilterProvider.notifier).toggleTag(id)`; selection read `f.tagIds?.contains(id) == true`.
- Deep "Search N tags →" goes in the section HEADER `trailingHeader` (mirror When); browse strip capped (10) + trailing tile.
- Windowed picker list = `ListView.builder` (never a `Wrap`/`Column` over all tags).
- Must NOT change People (Slice 3) / Places (Slice 4) / collapse / visibility / Camera.
- Worktree branch `worktree-mobile-filter-parity`. No trailers.

## Baseline

Slices 1–4 complete (Places picker + route pattern established; use it + When/Person as mirrors). `tagProvider` (`Set<Tag>`), `TagsSectionDeep`, `TagsStrip`, `toggleTag` exist (anchors in the Slice 5 research).

## File Structure

**Create:**

- `mobile/lib/presentation/pages/photos_filter/tags_picker.page.dart` — `@RoutePage() TagsPickerPage`.
- `mobile/lib/presentation/pages/photos_filter/widgets/tags_picker_list.widget.dart` — windowed list (MATCHES bucket + rows).
- `mobile/lib/presentation/pages/photos_filter/widgets/tags_picker_search_header.widget.dart` — pinned search header (mirror `person_picker_search_header` / `when_picker_search_header`, hint "Search tags…").
- `mobile/lib/presentation/pages/photos_filter/widgets/selected_tags_strip.widget.dart` — `SelectedTagsStrip` (InputChips of selected tags, full-path label, delete → toggleTag).
- `mobile/lib/providers/photos_filter/tags_picker.provider.dart` — `tagsPickerQueryProvider` + `tagsPickerFilteredProvider`.
- Tests: `tags_picker_test.dart`, `tags_picker_list_test.dart`, `selected_tags_strip_test.dart`, `tags_picker_provider_test.dart`; extend `tags_section_test.dart` and `strips_test.dart` (`TagsStrip` group).

**Modify:**

- `mobile/lib/routing/router.dart` (import + AutoRoute), regen `router.gr.dart`.
- `mobile/lib/presentation/widgets/filter_sheet/deep/tags_section.widget.dart` (add `onOpenPicker`, cap Wrap to 10 + pin selected-beyond-cap, header trailing "Search N tags →").
- `mobile/lib/presentation/widgets/filter_sheet/deep_content.widget.dart` (wrap Tags entry in a `Builder` → `TagsPickerRoute`).
- `mobile/lib/presentation/widgets/filter_sheet/strips/tags_strip.widget.dart` (cap + trailing tile → picker).
- `i18n/en.json` (+ `filter_sheet_deep_search_n_tags` {one/other}, `filter_sheet_picker_tags_title`, `filter_sheet_picker_search_tags_hint`, `filter_sheet_picker_tags_matches`).

---

### Task 1: i18n keys

- [ ] **Step 1:** In `i18n/en.json` add (match existing plural/picker-key JSON shapes, alphabetical):

```json
"filter_sheet_deep_search_n_tags": { "one": "Search {count} tag →", "other": "Search {count} tags →" },
"filter_sheet_picker_tags_title": "Tags",
"filter_sheet_picker_search_tags_hint": "Search tags…",
"filter_sheet_picker_tags_matches": "Matches",
```

- [ ] **Step 2: Regenerate** — from `mobile/`: `mise exec -- dart run easy_localization:generate -S ../i18n && mise exec -- dart run bin/generate_keys.dart`.
- [ ] **Step 3: Commit** — `git add ../i18n/en.json && git commit -m "feat(mobile-filter): add tags-picker i18n keys (slice 5)"`.

---

### Task 2: `tags_picker.provider.dart`

**Files:** Create `mobile/lib/providers/photos_filter/tags_picker.provider.dart`; Test `mobile/test/providers/photos_filter/tags_picker_provider_test.dart`.

**Interfaces:** `tagsPickerQueryProvider = StateProvider.autoDispose<String>((ref) => '')`; `tagsPickerFilteredProvider = FutureProvider.autoDispose<List<Tag>>` sourcing `await ref.watch(tagProvider.future)` (→ `Set<Tag>`), sorted by `value` (case-insensitive), filtered by the query (substring over `value.toLowerCase()`).

- [ ] **Step 1: Write failing test.** Mirror `people_picker_provider_test.dart`: `ProviderContainer` overriding `tagProvider` (an `AsyncNotifierProvider` — override with `overrideWith(() => _FakeTagNotifier({...}))` OR override the `tagServiceProvider`; read the file to match the correct override style) to yield tags with values `['Travel/Italy/Rome','Travel/France','Food']`. Assert: empty query → all 3 sorted; query `'rom'` → `['Travel/Italy/Rome']`; query `'travel'` → the two Travel tags; case-insensitive.

- [ ] **Step 2: Run → RED.**

- [ ] **Step 3: Implement.**

```dart
// mobile/lib/providers/photos_filter/tags_picker.provider.dart
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/models/tag.model.dart';
import 'package:immich_mobile/providers/infrastructure/tag.provider.dart';

final tagsPickerQueryProvider = StateProvider.autoDispose<String>((ref) => '');

final tagsPickerFilteredProvider = FutureProvider.autoDispose<List<Tag>>((ref) async {
  final all = (await ref.watch(tagProvider.future)).toList()
    ..sort((a, b) => a.value.toLowerCase().compareTo(b.value.toLowerCase()));
  final query = ref.watch(tagsPickerQueryProvider).trim().toLowerCase();
  if (query.isEmpty) return all;
  return all.where((t) => t.value.toLowerCase().contains(query)).toList();
});
```

- [ ] **Step 4: Run → GREEN.**
- [ ] **Step 5: Analyze & commit** — `dart analyze` the two files; `git commit -m "feat(mobile-filter): tags picker query+filtered providers (slice 5)"`.

---

### Task 3: `SelectedTagsStrip`

**Files:** Create `mobile/lib/presentation/pages/photos_filter/widgets/selected_tags_strip.widget.dart`; Test `mobile/test/presentation/pages/photos_filter/widgets/selected_tags_strip_test.dart`.

**Interfaces:** `SelectedTagsStrip extends ConsumerWidget` — horizontal `ListView` of `InputChip`s, one per id in `f.tagIds`, `key: Key('selected-tag-chip-<id>')`, label = the tag's full-path `value` (resolved via `tagProvider`; if unresolved/loading, fall back to a short label or skip), `deleteIcon: Icons.close_rounded`, `onDeleted: () => toggleTag(id)`. Collapses to zero height when `tagIds` empty. Mirror `selected_people_strip.widget.dart`.

- [ ] **Step 1: Write failing test** (`pumpConsumerWidget`, override `tagProvider` + seed `photosFilterProvider` with `tagIds: ['t1']`): assert `selected-tag-chip-t1` present with the resolved value text; tapping its delete removes it from `photosFilterProvider.tagIds`; empty `tagIds` → strip renders nothing/zero-height.

- [ ] **Step 2: Run → RED.**

- [ ] **Step 3: Implement** mirroring `selected_people_strip.widget.dart`, resolving id→value from `ref.watch(tagProvider).valueOrNull` (a `{id: value}` lookup); if a selected id isn't resolvable, show `filter_sheet_tag_fallback` ("Tag") as the label so it stays removable.

- [ ] **Step 4: Run → GREEN.**
- [ ] **Step 5: Analyze & commit** — `git commit -m "feat(mobile-filter): add SelectedTagsStrip (slice 5)"`.

---

### Task 4: `TagsPickerPage` + windowed list + route (codegen)

**Files:** Create `tags_picker.page.dart`, `tags_picker_list.widget.dart`, `tags_picker_search_header.widget.dart`; Modify `router.dart` (+ regen); Tests: `tags_picker_test.dart`, `tags_picker_list_test.dart`.

**Interfaces:** `@RoutePage() class TagsPickerPage extends ConsumerStatefulWidget` → generates `TagsPickerRoute`. AppBar: back / `filter_sheet_picker_tags_title` / Done (`Key('tags-picker-done')`). Body `CustomScrollView`: pinned `TagsPickerSearchHeader` (hint `filter_sheet_picker_search_tags_hint`, writes `tagsPickerQueryProvider`), `SelectedTagsStrip`, then `TagsPickerList`. `TagsPickerList` builds `[MATCHES header, ...rows]` and renders via `ListView.builder` (`Key('tags-picker-list')`); each row `Key('tag-row-<id>')` = leaf title + full-path subtitle + trailing check when selected; tap → `toggleTag(id)`. Empty/no-match → a no-results panel (mirror person picker's `_NoResultsPanel`).

- [ ] **Step 1: Read mirrors** — `person_picker.page.dart`, `person_picker_list.widget.dart`, `person_picker_search_header.widget.dart`, `places_picker.page.dart` (Slice 4, now present) for the routed-page + search-header idioms.

- [ ] **Step 2: Write failing widget tests** (`pumpConsumerWidget`, override `tagsPickerFilteredProvider` or `tagProvider`):
  - AppBar title "Tags" + `tags-picker-done`.
  - Given tags `['Travel/Italy/Rome','Food']` → rows `tag-row-<id>` render; the Rome row shows leaf "Rome" + subtitle containing "Travel / Italy"; the Food row shows "Food" and NO subtitle.
  - Tapping a row toggles `photosFilterProvider.tagIds` (multi-select: tap two → both present; tap again → removed).
  - Search: set `tagsPickerQueryProvider` to `'rom'` → only the Rome row.
  - Large list smoke: 5000 tags → uses `ListView.builder` (assert only a subset of `tag-row-*` are in the tree, i.e. windowed — e.g. `find.byKey(Key('tag-row-t4999'))` findsNothing without scrolling).

- [ ] **Step 3: Run → RED.**
- [ ] **Step 4: Implement** the three widgets. Register route in `router.dart` (import + `AutoRoute(page: TagsPickerRoute.page, guards: [_authGuard, _duplicateGuard])`).
- [ ] **Step 5: Regenerate** — `mise run codegen`; confirm `TagsPickerRoute` in `router.gr.dart`.
- [ ] **Step 6: Run → GREEN.**
- [ ] **Step 7: Analyze & commit** (include regenerated router) — `git commit -m "feat(mobile-filter): add Tags picker page + route (slice 5)"`.

---

### Task 5: Cap the Tags deep section + wire picker

**Files:** Modify `tags_section.widget.dart`, `deep_content.widget.dart`; Test: extend `tags_section_test.dart`.

**Interfaces:** `TagsSectionDeep` gains `final VoidCallback? onOpenPicker;`. Its `DeepSectionScaffold` gains `trailingHeader:` = `TextButton(key: Key('tags-section-search-more'), onPressed: onOpenPicker, child: Text(_searchMoreTagsLabel(count)))` when `count > 0`. The `childBuilder` caps to first 10 tags + pins selected-beyond-cap (mirror People's `firstN` + `overflowSelected` where selected = `f.tagIds?.contains(tag.id)`). `deep_content` wraps the Tags entry in a `Builder` with `onOpenPicker: () => context.pushRoute(const TagsPickerRoute())`.

- [ ] **Step 1: Write failing tests** (extend `tags_section_test.dart`): 15 tags none selected → ≤10 `tag-chip-*` + `tags-section-search-more` trailing, tap fires `onOpenPicker`; 12th selected → still shown; ≤10 → all shown.
- [ ] **Step 2: Run → RED.**
- [ ] **Step 3: Implement** (add `onOpenPicker` + `_searchMoreTagsLabel` using `filter_sheet_deep_search_n_tags`; cap+pin in childBuilder; trailingHeader when non-empty; wire deep_content Tags entry like People/When).
- [ ] **Step 4: Run → GREEN.**
- [ ] **Step 5: Analyze & commit** — `git commit -m "feat(mobile-filter): cap tags section + wire picker (slice 5)"`.

---

### Task 6: Cap the Tags browse strip + trailing tile

**Files:** Modify `tags_strip.widget.dart`; Test: extend `strips_test.dart` (`TagsStrip` group), reusing the RootStackRouter nav harness.

**Interfaces:** Strip renders ≤10 tag chips + trailing `Key('tags-strip-more')` "+N" tile (when `>10`) → `context.pushRoute(const TagsPickerRoute())` (add router imports).

- [ ] **Step 1: Write failing tests** — 15 tags → ≤10 + `tags-strip-more` present, tap navigates to `TagsPickerPage`; ≤10 → no more-tile.
- [ ] **Step 2: Run → RED.**
- [ ] **Step 3: Implement** (mirror the People/Places strip cap + trailing tile).
- [ ] **Step 4: Run → GREEN.**
- [ ] **Step 5: Analyze & commit** — `git commit -m "feat(mobile-filter): cap tags browse strip + more tile (slice 5)"`.

---

### Task 7: Full green + analyze + reconcile

- [ ] **Step 1: Run** — `mise exec -- flutter test test/presentation/widgets/filter_sheet/ test/presentation/pages/photos_filter/ test/providers/photos_filter/`.
- [ ] **Step 2: Fix breakage** preserving intent (deep_content Tags entry now a Builder; tags_section empty/selected cases).
- [ ] **Step 3: Re-run until green** — All tests passed (≥ prior baseline + Slice 5's new tests).
- [ ] **Step 4: Full analyze** — `mise exec -- dart analyze lib test` → No issues found!
- [ ] **Step 5: Commit** — `git commit -m "test(mobile-filter): reconcile tags picker/section/strip (slice 5)"`.

---

## Self-Review (completed by plan author)

- **Spec coverage (Slice 5 BDD):** preview capped (T5), picker loads full flat list w/ full-path (T4), search filters (T2/T4), multi-select toggles (T3/T4/T5), selected-but-hidden stays removable (T3 SelectedTagsStrip + T5 pin), large list windowed (T4 `ListView.builder` + test), offline (tagProvider AsyncError → picker error/empty; T4). Mockup `#mockup-tags-picker` (search, Selected chip cloud full-path, MATCHES bucket, rows leaf+subtitle+checkbox) reproduced (T3/T4).
- **Route codegen** explicit (T4 Step 5).
- **Placeholder scan:** "read mirror"/"read the file to match override style" point to concrete files; novel logic (value split, filtered provider, cap+pin, SelectedTagsStrip resolution) has concrete code/specs.
- **Type consistency:** `TagsPickerRoute`, `tagsPickerQueryProvider`, `tagsPickerFilteredProvider`, `SelectedTagsStrip`, keys `tag-row-*`/`selected-tag-chip-*`/`tags-section-search-more`/`tags-strip-more` consistent.
- **Out of scope:** no People/Places/Camera/collapse/visibility changes; section/strip keep the countless suggestions source (only the picker uses `tagProvider`).
