# Slice 7 — Mobile filter-sheet gating (#910)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for
> tracking.

**Goal:** The mobile deep filter sheet stops rendering sections and toggles that cannot filter anything,
using the facets slice 1 added — and, as a prerequisite, starts forwarding the not-in-album filter it
currently drops.

**Architecture:** A derived availability set, computed from `photosFilterSuggestionsProvider`, ANDed with
the existing user-controlled `hiddenSectionsProvider` at render time. The two never merge: one is
persisted, one is derived.

**Tech Stack:** Flutter, Riverpod, mocktail, flutter_test.

- **Spec:** `docs/superpowers/specs/2026-08-04-interdependent-filter-sections-910-design.md` §7
- **Branch:** `fix/910-interdependent-filter-sections`
- **Depends on:** Slice 2 (the regenerated Dart client).
- **Scope:** `mobile/lib/providers/photos_filter/`, `mobile/lib/presentation/widgets/filter_sheet/`, and
  their tests. No server, no web.

## Global Constraints

- Flutter **3.44.8** — the pin is `mobile/mise.toml` (`"aqua:flutter/flutter" = "3.44.8"`). Read the pin
  rather than trusting this line. If `mise install` symlinked an older patch, invoke the binaries directly
  from `~/.local/share/mise/installs/aqua-flutter-flutter/<version>/flutter/bin/{flutter,dart}`.
- Generate localisation and keys once before testing, from `mobile/`:
  `flutter pub get`, then `dart run easy_localization:generate -S ../i18n && dart run bin/generate_keys.dart`.
  The `lib/generated/*.g.dart` files are gitignored.
- Per `feedback_mobile_dart_analyze_ci_fatal_infos`, CI has **two** separate gates:
  `dart analyze --fatal-infos lib test` and `dart format`. Passing one is not passing the other.
- `dart analyze` is not a substitute for `flutter test` — generated-code compile errors only surface when a
  test actually compiles.
- **Do not modify `rating_stars_section.widget.dart` or `media_type_section.widget.dart`.** The former's doc
  comment cites `feedback_no_dynamic_rating_media_hiding` ("Always renders 5 stars"); spec §2.4 keeps that
  true. Gate the sections as wholes, never their contents.

## File Structure

| File                                                                                  | Responsibility                                    |
| ------------------------------------------------------------------------------------- | ------------------------------------------------- |
| `mobile/lib/providers/photos_filter/filter_suggestions.provider.dart`                 | forward `isNotInAlbum`; delete the empty sentinel |
| `mobile/lib/providers/photos_filter/section_availability.provider.dart`               | **new** — the availability set                    |
| `mobile/lib/presentation/widgets/filter_sheet/deep_content.widget.dart`               | gate the section list                             |
| `mobile/lib/presentation/widgets/filter_sheet/deep/toggles_section.widget.dart`       | gate two of the four switches                     |
| `mobile/lib/presentation/widgets/filter_sheet/deep/manage_sections_sheet.widget.dart` | gate the manage list                              |

---

## Task 1: Forward `isNotInAlbum` to the facets request

**Files:**

- Modify: `mobile/lib/providers/photos_filter/filter_suggestions.provider.dart`
- Test: `mobile/test/providers/photos_filter/filter_suggestions_provider_test.dart`

`SearchDisplayFilters` carries `isNotInAlbum` (`search_filter.model.dart:182`) but the provider never sends
it, so every facet ignores the not-in-album toggle. The albums facet would be computed against the wrong
asset set without this.

- [ ] **Step 1: Write the failing test**

Follow the file's existing mocktail setup. Every named argument in the `when(...)` stub must be listed or
mocktail will not match the call, so add `isNotInAlbum: any(named: 'isNotInAlbum')` to the existing stubs
in this file at the same time.

```dart
test('forwards isNotInAlbum so the facets reflect it (#910)', () async {
  when(
    () => mockSearchApi.getFilterSuggestions(
      city: any(named: 'city'),
      country: any(named: 'country'),
      isFavorite: any(named: 'isFavorite'),
      isNotInAlbum: any(named: 'isNotInAlbum'),
      make: any(named: 'make'),
      mediaType: any(named: 'mediaType'),
      model: any(named: 'model'),
      personIds: any(named: 'personIds'),
      rating: any(named: 'rating'),
      spaceId: any(named: 'spaceId'),
      tagIds: any(named: 'tagIds'),
      takenAfter: any(named: 'takenAfter'),
      takenBefore: any(named: 'takenBefore'),
      withSharedSpaces: any(named: 'withSharedSpaces'),
    ),
  ).thenAnswer((_) async => emptySuggestions());

  final filter = SearchFilter.empty().copyWith(
    display: SearchFilter.empty().display.copyWith(isNotInAlbum: true),
  );
  await container.read(photosFilterSuggestionsProvider(filter).future);

  verify(() => mockSearchApi.getFilterSuggestions(isNotInAlbum: true)).called(1);
});
```

`verify` with a subset of named arguments does not match in mocktail — capture the call instead, following
whatever the neighbouring `withSharedSpaces` test in this file does, and assert on the captured value.

Per `feedback_searchfilter_copywith_cascade`, check how `copyWith` composes on `SearchFilter` before
writing that line; the nested-display form above may need the file's own helper.

- [ ] **Step 2: Add the shared fixture — and do NOT "fix" the one hit in `lib/`**

Slice 2 made the three booleans required on the Dart DTO, so every
`FilterSuggestionsResponseDto(hasUnnamedPeople: false)` in the test suite no longer compiles. Add one
helper at the top of the file and replace each **test** literal with it:

```dart
FilterSuggestionsResponseDto emptySuggestions() => FilterSuggestionsResponseDto(
  hasUnnamedPeople: false,
  hasFavorites: false,
  hasAssetsInAlbum: false,
  hasAssetsNotInAlbum: false,
);
```

```bash
cd mobile && grep -rn "FilterSuggestionsResponseDto(" test/ lib/
```

> **⚠ The hit in `lib/` is a trap, and it is the same trap slice 4 exists to defuse on web.**
>
> `filter_suggestions.provider.dart` ends with:
>
> ```dart
> return response ?? FilterSuggestionsResponseDto(hasUnnamedPeople: false);
> ```
>
> That is spec §4.6's failure sentinel in Dart. Adding the three missing `false`s makes it compile and
> **is precisely the bug**: a null response then
> becomes indistinguishable from an empty library and Task 3 would hide six sections at once on a
> transport hiccup. Slice 4 says the same thing about `emptyFilterSuggestions()` — "Do not satisfy
> `tsc` by adding `hasFavorites: false` to the sentinel. That is the bug. Delete it instead."
>
> Delete it here too. Task 1b below does exactly that.

If the generated constructor turns out to take these as optional, stop — that means slice 1 wrote the
Zod fields as `.optional()` and the contract is wrong.

- [ ] **Step 3: Run the test to verify it fails**

```bash
cd mobile && flutter test test/providers/photos_filter/filter_suggestions_provider_test.dart
```

Expected: FAIL — the captured call carries `isNotInAlbum: null`.

- [ ] **Step 4: Forward the value**

In `filter_suggestions.provider.dart`, add to the `getFilterSuggestions` call, next to `isFavorite`:

```dart
    // #910: the albums facet is computed with this filter excluded, but every OTHER facet must still
    // honour it — dropping it here made all of them ignore the not-in-album toggle.
    isNotInAlbum: filter.display.isNotInAlbum ? true : null,
```

`null` rather than `false` for the off state, matching the neighbouring `isFavorite` line: the server
treats an explicit `false` as "only assets that ARE in an album".

- [ ] **Step 5: Run the test to verify it passes**

```bash
cd mobile && flutter test test/providers/photos_filter/
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add mobile/lib/providers/photos_filter/filter_suggestions.provider.dart mobile/test/
git commit -m "fix(mobile): forward isNotInAlbum to the filter-suggestions request (#910)"
```

---

## Task 1b: Make a null facet response an error, not an empty library

**Files:**

- Modify: `mobile/lib/providers/photos_filter/filter_suggestions.provider.dart` (last line)
- Test: `mobile/test/providers/photos_filter/filter_suggestions_provider_test.dart`

Spec §4.6, mobile half. Until this lands, Task 3's gating is unsafe — exactly as web's slice 5 must not
land without slice 4's sentinel removal.

- [ ] **Step 1: Write the failing test**

```dart
test('errors rather than reporting an empty library when the API returns null (#910)', () async {
  when(() => mockSearchApi.getFilterSuggestions(/* …all named args… */)).thenAnswer((_) async => null);

  final result = await container.read(photosFilterSuggestionsProvider(SearchFilter.empty()).future).then(
        (value) => value,
        onError: (Object e) => e,
      );

  expect(result, isA<Exception>());
});
```

Prefer whatever error-assertion shape the neighbouring tests already use (`expectLater(..., throwsA(...))`
against the future) over the `.then/onError` form above if one exists.

- [ ] **Step 2: Run it — expect FAIL**

It resolves with an all-false DTO instead of throwing.

- [ ] **Step 3: Replace the sentinel with a throw**

```dart
  if (response == null) {
    // #910: never fabricate an empty response. `sectionAvailabilityProvider` cannot tell a fabricated
    // empty from a genuinely empty library and would hide six sections at once; an AsyncValue.error
    // makes it fall back to offering everything. Mirrors web's slice-4 sentinel removal (spec §4.6).
    throw Exception('filter suggestions unavailable');
  }
  return response;
```

- [ ] **Step 4: Run the provider tests, then commit**

```bash
cd mobile && flutter test test/providers/photos_filter/
git commit -am "fix(mobile): error instead of faking empty filter facets (#910)"
```

---

## Task 2: The availability provider

**Files:**

- Create: `mobile/lib/providers/photos_filter/section_availability.provider.dart`
- Create: `mobile/test/providers/photos_filter/section_availability_provider_test.dart`

**Mobile takes the same baseline as web.** An earlier draft of this slice used the simpler rule "hidden
when the facet is empty and the section holds no active filter", on the grounds that the active-filter
guard covered the transient case. It does not, and this is worth understanding before writing the code:
that guard only covers a section's **own** filter, while the case spec §4.4 rule 1 exists for is
**cross-section** narrowing. Pick a person who has no rated photos and `ratings` comes back empty while
`rating` holds no filter — so Rating would vanish from the sheet mid-session. That is the pop-in/pop-out
behaviour §2.1 rejected, and a web/mobile divergence §2.3 exists to prevent.

Parity is nearly free here, because the baseline is the _same family provider under a different key_:

```dart
final baselineKey = filter.isEmpty ? filter : SearchFilter.empty();
final baseline = ref.watch(photosFilterSuggestionsProvider(baselineKey));
```

`SearchFilter` implements value equality (`search_filter.model.dart:362-402`), so when nothing is
filtered `baselineKey == filter` and Riverpod hands back the _same_ cached future — zero extra requests
in the common case, one `autoDispose`-cached request while filters are on.

Mobile has no `(0)` grey treatment, so the three verdicts collapse to two renderings: `available` and
`empty` both render the section normally, and only `unavailable` hides it. The rule is therefore
"hidden when the facet is empty **in both** current and baseline, and the section holds no active
filter" — the same predicate as web's, minus the middle rendering.

- [ ] **Step 1: Write the failing tests**

```dart
void main() {
  group('sectionAvailability (#910)', () {
    test('hides a section whose facet is empty in both current and baseline', () {
      final available = availableSections(emptySuggestions(), emptySuggestions(), SearchFilter.empty());

      expect(available.contains(FilterSectionId.rating), isFalse);
      expect(available.contains(FilterSectionId.when), isTrue);
    });

    test('keeps a section available when its facet is populated', () {
      final full = withRatings([5]);
      expect(availableSections(full, full, SearchFilter.empty()).contains(FilterSectionId.rating), isTrue);
    });

    // The parity guard, and the reason mobile has a baseline at all. `rating` holds no filter, so
    // the active-filter rule cannot save it; only the baseline can. Without the baseline watch this
    // test fails and the Rating section vanishes mid-session on web-divergent behaviour (spec §7).
    test('keeps a section whose facet a CROSS-SECTION filter emptied', () {
      final personFilter = SearchFilter.empty().copyWith(people: {aPerson});

      final available = availableSections(emptySuggestions(), withRatings([5]), personFilter);

      expect(available.contains(FilterSectionId.rating), isTrue);
    });

    test('never hides anything while the baseline is unknown', () {
      final available = availableSections(emptySuggestions(), null, SearchFilter.empty());

      expect(available, containsAll(FilterSectionId.values));
    });

    test('keeps people available while unnamed faces exist', () {
      final unnamed = FilterSuggestionsResponseDto(
        hasUnnamedPeople: true,
        hasFavorites: false,
        hasAssetsInAlbum: false,
        hasAssetsNotInAlbum: false,
      );

      expect(availableSections(unnamed, unnamed, SearchFilter.empty()).contains(FilterSectionId.people), isTrue);
    });

    test('needs BOTH photos and videos to keep media available', () {
      bool mediaFor(List<String> types) {
        final f = withMediaTypes(types);
        return availableSections(f, f, SearchFilter.empty()).contains(FilterSectionId.media);
      }

      expect(mediaFor(['IMAGE']), isFalse);
      expect(mediaFor(['VIDEO']), isFalse);
      // A length>=2 rule would wrongly pass this one — AssetType includes AUDIO and OTHER.
      expect(mediaFor(['IMAGE', 'OTHER']), isFalse);
      expect(mediaFor(['IMAGE', 'VIDEO']), isTrue);
      expect(mediaFor(['IMAGE', 'OTHER', 'VIDEO']), isTrue);
    });

    test('never hides a section that holds an active filter', () {
      // `Option<int?>`: none = no filter, some(null) = unrated, some(1-5) = that rating.
      // See search_filter.model.dart:138-140.
      final filter = SearchFilter.empty().copyWith(
        rating: SearchRatingFilter(rating: const Option.some(5)),
      );

      expect(
        availableSections(emptySuggestions(), emptySuggestions(), filter).contains(FilterSectionId.rating),
        isTrue,
      );
    });

    test('always keeps when and toggles available', () {
      final available = availableSections(emptySuggestions(), emptySuggestions(), SearchFilter.empty());

      expect(available.contains(FilterSectionId.when), isTrue);
      expect(available.contains(FilterSectionId.toggles), isTrue);
    });
  });

  group('sectionAvailabilityProvider (#910)', () {
    // Locks the "same key when empty" optimisation: SearchFilter.empty() == an already-empty filter,
    // so Riverpod serves one future, not two.
    test('requests no second facet set when nothing is filtered', () async {
      // …read the provider through a ProviderContainer with the API mocked, then:
      verify(() => mockSearchApi.getFilterSuggestions(/* … */)).called(1);
    });

    test('offers every section while the facets are in error', () async {
      // Task 1b makes a null response throw; the sheet must then show everything.
    });
  });
}
```

`withRatings` / `withMediaTypes` are local builders — the generated DTO has no `copyWith`. Add them next
to `emptySuggestions()`, reading `mobile/openapi/lib/model/filter_suggestions_response_dto.dart` for the
exact parameter names (list fields are typically named constructor parameters defaulting to `const []`).
`aPerson` is any `PersonDto` fixture; the neighbouring picker tests already build one.

```dart
FilterSuggestionsResponseDto withRatings(List<num> ratings) => FilterSuggestionsResponseDto(
  hasUnnamedPeople: false,
  hasFavorites: false,
  hasAssetsInAlbum: false,
  hasAssetsNotInAlbum: false,
  ratings: ratings,
);
```

`Option` and `SearchRatingFilter` come from `package:immich_mobile/utils/option.dart` and
`search_filter.model.dart`. Per `feedback_searchfilter_copywith_cascade`, check how `copyWith` composes on
`SearchFilter` before relying on the nested form.

- [ ] **Step 2: Run to verify it fails**

```bash
cd mobile && flutter test test/providers/photos_filter/section_availability_provider_test.dart
```

Expected: FAIL — the file under test does not exist.

- [ ] **Step 3: Write the provider**

```dart
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/models/search/search_filter.model.dart';
import 'package:immich_mobile/presentation/widgets/filter_sheet/filter_section_id.dart';
import 'package:immich_mobile/providers/photos_filter/filter_suggestions.provider.dart';
import 'package:immich_mobile/providers/photos_filter/photos_filter.provider.dart';
import 'package:openapi/api.dart';

/// Which deep-sheet sections can actually filter something right now (#910).
///
/// Mirrors web's `filter-availability.ts`, minus its structural/transient split: mobile has no
/// baseline request, so an empty facet simply means "not offered". A section holding an active
/// filter is always offered, so the user can never be stranded with a filter they cannot clear.
///
/// This is DERIVED. It is never written to [hiddenSectionsProvider], which is the user's own
/// persisted choice — conflating them would record a section as deliberately hidden the moment its
/// facet went empty, and it would never come back.
/// Whether this section itself currently holds a filter value. Mirrors web's
/// `hasActiveFilter` (`filter-panel.svelte:621-659`) section for section.
bool hasActiveFilterFor(FilterSectionId id, SearchFilter filter) {
  switch (id) {
    case FilterSectionId.people:
      return filter.people.isNotEmpty;
    case FilterSectionId.places:
      return filter.location.country != null || filter.location.state != null || filter.location.city != null;
    case FilterSectionId.tags:
      return (filter.tagIds ?? const []).isNotEmpty;
    case FilterSectionId.camera:
      return filter.camera.make != null || filter.camera.model != null;
    case FilterSectionId.rating:
      return filter.rating.rating.isSome;
    case FilterSectionId.media:
      return filter.mediaType != AssetType.other;
    case FilterSectionId.when:
      return filter.date.takenAfter != null || filter.date.takenBefore != null;
    case FilterSectionId.toggles:
      return filter.display.isFavorite ||
          filter.display.isArchive ||
          filter.display.isNotInAlbum ||
          filter.display.isUntagged;
  }
}

bool _facetEmpty(FilterSectionId id, FilterSuggestionsResponseDto facets) {
  switch (id) {
    case FilterSectionId.people:
      return facets.people.isEmpty && !facets.hasUnnamedPeople;
    case FilterSectionId.places:
      return facets.countries.isEmpty;
    case FilterSectionId.tags:
      return facets.tags.isEmpty;
    case FilterSectionId.camera:
      return facets.cameraMakes.isEmpty;
    case FilterSectionId.rating:
      return facets.ratings.isEmpty;
    case FilterSectionId.media:
      // The control offers All / Photos / Videos, so it needs both of those to discriminate.
      // NOT `length >= 2`: the server returns raw distinct asset.type and AssetType is
      // IMAGE | VIDEO | AUDIO | OTHER, so a photo library with one OTHER asset would pass a
      // length test while the Videos button stays dead. Same rule as web's filter-availability.ts.
      return !(facets.mediaTypes.contains('IMAGE') && facets.mediaTypes.contains('VIDEO'));
    case FilterSectionId.when:
    case FilterSectionId.toggles:
      // `when` mirrors web's Timeline. `toggles` always renders — two of its four switches have no
      // facet at all, so the section as a whole is never useless; see [availableToggles].
      return false;
  }
}

Set<FilterSectionId> availableSections(
  FilterSuggestionsResponseDto facets,
  FilterSuggestionsResponseDto? baseline,
  SearchFilter filter,
) {
  bool offered(FilterSectionId id) {
    // Never strand a filter the user cannot then reach to clear.
    if (hasActiveFilterFor(id, filter)) return true;
    if (!_facetEmpty(id, facets)) return true;
    // A section is never hidden on missing information.
    if (baseline == null) return true;
    // Empty under the current filters but not for the whole scope: transient, so keep it.
    return !_facetEmpty(id, baseline);
  }

  return {
    for (final id in FilterSectionId.values)
      if (offered(id)) id,
  };
}

final sectionAvailabilityProvider = Provider.autoDispose<Set<FilterSectionId>>((ref) {
  final filter = ref.watch(photosFilterProvider);
  final facets = ref.watch(photosFilterSuggestionsProvider(filter));

  // Same family, different key — and the SAME key when nothing is filtered, so the common case
  // costs no extra request. SearchFilter has value equality, which is what makes that true.
  final baselineKey = filter.isEmpty ? filter : SearchFilter.empty();
  final baseline = ref.watch(photosFilterSuggestionsProvider(baselineKey));

  // While a request is in flight or has failed, offer everything. A section is never hidden on
  // missing information — including when Task 1b's throw fires.
  return facets.maybeWhen(
    data: (data) => availableSections(data, baseline.valueOrNull, filter),
    orElse: () => FilterSectionId.values.toSet(),
  );
});
```

`hasActiveFilterFor` is written out above rather than left to discovery: there is no existing mapping to
reuse. `activeChipsFromFilter` (`active_chips.dart`) produces `ChipId`s, and that mapping is not 1:1 with
`FilterSectionId` — `toggles` alone yields four chip ids, and `text` yields chips with no section at all.

Check `filter.rating.rating.isSome` against `utils/option.dart` before relying on it; if the accessor is
named differently, use `!filter.rating.rating.isNone` (`isNone` is used in `SearchFilter.isEmpty`).

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd mobile && flutter test test/providers/photos_filter/section_availability_provider_test.dart
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add mobile/lib/providers/photos_filter/section_availability.provider.dart mobile/test/
git commit -m "feat(mobile): derive which filter sections can filter anything (#910)"
```

---

## Task 3: Gate the sheet, the manage list, and two toggles

**Files:**

- Modify: `mobile/lib/presentation/widgets/filter_sheet/deep_content.widget.dart:96-97`
- Modify: `mobile/lib/presentation/widgets/filter_sheet/deep/manage_sections_sheet.widget.dart:32`
- Modify: `mobile/lib/presentation/widgets/filter_sheet/deep/toggles_section.widget.dart`
- Test: `mobile/test/presentation/widgets/filter_sheet/deep_content_visibility_test.dart`

- [ ] **Step 1: Write the failing tests**

Extend `deep_content_visibility_test.dart`, which already covers the user-hidden path — follow its
`ProviderScope` override setup rather than inventing one.

```dart
testWidgets('does not render a section with no facet (#910)', (tester) async {
  await pumpDeepSheet(tester, availability: {FilterSectionId.when, FilterSectionId.media});

  // Positive first, so a sheet that failed to render cannot pass the negatives.
  expect(find.byKey(const Key('deep-section-media')), findsOneWidget);
  expect(find.byKey(const Key('deep-section-rating')), findsNothing);
});

testWidgets('does not offer an unavailable section in manage sections (#910)', (tester) async {
  await pumpManageSections(tester, availability: {FilterSectionId.when, FilterSectionId.media});

  expect(find.byKey(const Key('manage-section-media')), findsOneWidget);
  expect(find.byKey(const Key('manage-section-rating')), findsNothing);
});

testWidgets('hides the favourites and not-in-album switches when their facets are empty (#910)', (tester) async {
  await pumpDeepSheet(tester, facets: emptySuggestions());

  expect(find.byKey(const Key('toggle-favourites')), findsNothing);
  expect(find.byKey(const Key('toggle-not-in-album')), findsNothing);
  // These two have no facet and must always render — the section itself never disappears.
  expect(find.byKey(const Key('toggle-archived')), findsOneWidget);
  expect(find.byKey(const Key('toggle-untagged')), findsOneWidget);
});

testWidgets('never dims or drops a rating star (#910, feedback_no_dynamic_rating_media_hiding)', (tester) async {
  await pumpDeepSheet(tester, facets: emptySuggestions().copyWithRatings([2]));

  for (var i = 1; i <= 5; i++) {
    expect(find.byKey(Key('rating-star-$i')), findsOneWidget);
  }
});
```

`pumpDeepSheet` / `pumpManageSections` with an `availability` override are shorthand for the file's
existing pump helper plus a `sectionAvailabilityProvider.overrideWithValue(...)`. Read the existing helper
and extend it rather than adding a parallel one.

- [ ] **Step 2: Run them to verify they fail**

```bash
cd mobile && flutter test test/presentation/widgets/filter_sheet/deep_content_visibility_test.dart
```

Expected: FAIL on the first three. The rating-star test passes already — it is the guard.

- [ ] **Step 3: Gate the deep sheet**

`deep_content.widget.dart`, in `build`:

```dart
    final hidden = ref.watch(hiddenSectionsProvider);
    final available = ref.watch(sectionAvailabilityProvider);
```

and the render loop at `:96`:

```dart
              for (final id in FilterSectionId.values)
                // Two independent gates: `hidden` is the user's persisted choice, `available` is
                // derived from the facets. Never merge them — see the provider's doc comment. #910
                if (!hidden.contains(id) && available.contains(id)) _sectionFor(id),
```

- [ ] **Step 4: Gate the manage-sections list**

`manage_sections_sheet.widget.dart:32`:

```dart
            for (final section in FilterSectionId.values)
              if (available.contains(section))
                SwitchListTile.adaptive(
```

with the same `ref.watch(sectionAvailabilityProvider)` above. A section the user cannot see is a switch
that does nothing.

- [ ] **Step 5: Gate the two toggles**

`toggles_section.widget.dart` — wrap only the two switches that have a facet:

```dart
    final facets = ref.watch(photosFilterSuggestionsProvider(ref.watch(photosFilterProvider)));
    // Offer everything while the request is in flight or failed.
    final hasFavorites = facets.valueOrNull?.hasFavorites ?? true;
    final hasUnfiled = facets.valueOrNull?.hasAssetsNotInAlbum ?? true;
```

then guard `toggle-favourites` with `if (hasFavorites || display.isFavorite)` and `toggle-not-in-album`
with `if (hasUnfiled || display.isNotInAlbum)`. The `|| display.…` half is the active-filter rule: never
remove the control that clears a filter the user has on.

Mobile has no "has album" toggle, so `hasAssetsInAlbum` is unused here — that is expected, not an omission.

- [ ] **Step 6: Run the tests to verify they pass**

```bash
cd mobile && flutter test test/presentation/widgets/filter_sheet/
```

Expected: PASS, including every pre-existing visibility test.

- [ ] **Step 7: Full mobile gate**

```bash
cd mobile && flutter test && dart analyze --fatal-infos lib test && dart format --set-exit-if-changed lib test
```

Both analyze and format are separate CI gates; run both.

- [ ] **Step 8: Commit**

```bash
git add mobile/
git commit -m "feat(mobile): hide filter sections and toggles that cannot filter anything (#910)"
```

---

## Done when

- `flutter test`, `dart analyze --fatal-infos lib test` and `dart format` are all green from `mobile/`.
- `git diff --name-only` lists no `rating_stars_section.widget.dart` and no `media_type_section.widget.dart`.
- `grep -rn "FilterSuggestionsResponseDto(" mobile/test` shows no literal missing the new fields, and
  `grep -rn "FilterSuggestionsResponseDto(" mobile/lib` shows **none at all** — Task 1b deleted the only
  one, and re-adding it is the §4.6 bug.
- `hiddenSectionsProvider` is read but never written by any code added in this slice.
- The cross-section parity test in Task 2 passes, which is the only thing proving mobile behaves like web
  rather than popping sections in and out (spec §2.1, §2.3, §7).
- The media rule is `contains('IMAGE') && contains('VIDEO')`, not a length check —
  `grep -n "mediaTypes.length" mobile/lib` returns nothing.
