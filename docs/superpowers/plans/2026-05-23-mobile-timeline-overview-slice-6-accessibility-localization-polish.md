# Mobile Timeline Overview Slice 6 Accessibility, Localization, And Responsive Polish Plan

## Goal

Finish the mobile timeline overview feature by hardening accessibility semantics, localization, reduced-motion behavior, RTL support, and responsive layout for the selector, overview cards, and temporal scope chips introduced in Slices 1-5.

## Slice Source

Spec: `docs/superpowers/specs/2026-05-22-mobile-timeline-overview-design.md`, Slice 6.

Baseline commits:

- Slice 1: `feat(mobile): add timeline grouping selector`
- Slice 2: `feat(mobile): apply timeline temporal scope`
- Slice 3: `feat(mobile): render timeline overview cards`
- Slice 4: `08a8d545b4 feat(mobile): wire timeline overview drilldown`
- Slice 5: `bced6680da feat(mobile): adopt timeline overview on shared routes`

## Architecture

Keep the Slice 6 changes local to the already-shared widgets:

- `TimelineGroupingSelector` owns segmented-control semantics, tap target sizing, reduced-motion behavior, and RTL-safe segment layout.
- `TimelineOverviewCard` owns overview card semantics, localized count/action labels, RTL-safe label anchoring, large-text containment, and an explicit no-nonessential-animation reduced-motion contract.
- `TimelineGroupingHeaderSliver` keeps the selector and temporal chip in one top-of-content row and verifies focus/visual order.
- `ActiveFilterChip` gets a narrow optional semantics override path for temporal scope chips, while preserving existing filter-chip behavior.
- i18n source remains `i18n/en.json`; generated mobile files are updated with the existing mobile translation generation tasks.

Do not change repository queries, route adoption, temporal scope behavior, drilldown behavior, or picker/search/map guardrails in this slice.

## Files

Modify:

- `docs/superpowers/specs/2026-05-22-mobile-timeline-overview-design.md`
- `i18n/en.json`
- `mobile/lib/presentation/widgets/timeline/timeline_grouping_selector.widget.dart`
- `mobile/lib/presentation/widgets/timeline/overview/overview_card.dart`
- `mobile/lib/presentation/widgets/timeline/timeline_grouping_header_sliver.widget.dart`
- `mobile/lib/presentation/widgets/filter_sheet/active_filter_chip.widget.dart`
- `mobile/lib/providers/photos_filter/active_chips.dart`
- `mobile/test/presentation/widgets/timeline/timeline_grouping_selector_test.dart`
- `mobile/test/presentation/widgets/timeline/overview/timeline_overview_card_test.dart`
- `mobile/test/presentation/widgets/timeline/timeline_grouping_header_sliver_test.dart`
- `mobile/test/presentation/pages/dev/main_timeline_page_test.dart`
- `mobile/test/providers/photos_filter/active_temporal_scope_chip_test.dart`

Regenerate locally, but do not commit because `mobile/lib/generated/` is ignored in this repo:

- `mobile/lib/generated/codegen_loader.g.dart`
- `mobile/lib/generated/translations.g.dart`

Only add new test files if the existing test files become too large to read comfortably. Keep new public APIs minimal and covered.

## Task 1: Selector Semantics, Tap Targets, RTL, And Reduced Motion

### TDD Tests First

Edit `mobile/test/presentation/widgets/timeline/timeline_grouping_selector_test.dart`.

Add tests before changing production code:

1. `selected segment exposes button semantics without duplicate child text`
   - Use `SemanticsTester`.
   - Pump `TimelineGroupingSelector` with `Setting.groupAssetsBy = GroupAssetsBy.month.index`.
   - Assert the selector container has label `Timeline grouping`.
   - Assert exactly one semantics node for each visible mode label: `Years`, `Months`, `Days`.
   - Assert the `Months` node has `SemanticsFlag.isSelected`, `SemanticsFlag.isButton`, and is enabled.
   - Assert the unselected `Years` and `Days` nodes are buttons but not selected.
   - Expected red: current semantics can expose text descendants in addition to segment semantics, and selected-state coverage is incomplete.

2. `disabled selector removes actionable semantics and does not write settings`
   - Pump `TimelineGroupingSelector(enabled: false)`.
   - Assert all three mode nodes exist but do not expose a tap action and have disabled semantics.
   - Tap `Years` with `warnIfMissed: false`.
   - Assert `StoreKey.groupAssetsBy` remains `GroupAssetsBy.day.index`.
   - Expected red: disabled visual behavior exists, but semantics/action behavior is not pinned.

3. `segments meet compact mobile tap target inside the app bar slot`
   - Pump `SliverAppBar(actions: [TimelineGroupingSelector()])`.
   - Assert the selector height is at least `48`.
   - Assert each segment semantics box height is at least `48`.
   - Expected red: current selector height is `40`.

4. `large text and narrow width keep all labels inside the selector`
   - Set surface size to `180 x 120`.
   - Wrap selector in `MediaQuery(textScaler: TextScaler.linear(2.0))` and `SizedBox(width: 150)`.
   - Assert no Flutter overflow exception.
   - Assert selector width is `<= 150`.
   - Assert all three segment nodes still exist.
   - Expected red only if the larger tap target or text scaling overflows after the failing tests are added.

5. `reduced motion removes nonessential selector animation`
   - Pump the selector inside `MediaQuery(disableAnimations: true, accessibleNavigation: true)`.
   - Inspect all `AnimatedContainer` widgets under the selector.
   - Assert their `duration == Duration.zero`.
   - Pump normally and assert the same widgets retain a non-zero duration.
   - Expected red: current segment animation always uses `Durations.short3`.

6. `rtl layout preserves tap behavior and directional visual order`
   - Pump with `Directionality(textDirection: TextDirection.rtl)`.
   - Record the global centers for `Years`, `Months`, and `Days`.
   - Assert `Years.dx > Months.dx > Days.dx`.
   - Tap the `Days` key and assert `StoreKey.groupAssetsBy == GroupAssetsBy.day.index`.
   - Expected red only if layout or key targeting breaks under RTL.

7. `landscape tablet app bar keeps a single grouping selector action`
   - Edit `mobile/test/presentation/pages/dev/main_timeline_page_test.dart`.
   - Set surface size to `1024 x 600`.
   - Assert `PhotosTimelineAppBar.actions` contains exactly one widget and it is `TimelineGroupingSelector`.
   - Pump `PhotosTimelineAppBar` in a `CustomScrollView`.
   - Assert exactly one `TimelineGroupingSelector` exists.
   - Assert no extra `IconButton`, search icon, or filter icon exists in the app-bar action area.
   - Expected initial result: this may pass because Slice 4 already replaced the app-bar action; keep it as the explicit landscape/tablet regression required by Slice 6.

Run the red suite:

```bash
cd mobile
mise exec -- flutter test test/presentation/widgets/timeline/timeline_grouping_selector_test.dart test/presentation/pages/dev/main_timeline_page_test.dart
```

### Implementation

Edit `mobile/lib/presentation/widgets/timeline/timeline_grouping_selector.widget.dart`:

- Increase the tappable selector height to `48`.
- Keep the visual pill compact by using horizontal padding only or an internal visual child, but the hit/semantics region must be `48dp` high.
- Wrap visible segment `Text` in `ExcludeSemantics` so the explicit segment semantics are the only labels screen readers see.
- Keep `Semantics(button: true, selected: selected, enabled: enabled, label: localizedLabel)` on each segment.
- Remove the tap action when disabled or already selected.
- Use `MediaQuery.disableAnimationsOf(context)` or equivalent to choose `Duration.zero` for selector animations under reduced-motion settings.
- Keep `Row` directional so RTL places the first logical child at the right edge without changing `GroupAssetsBy` enum order.

Edit `mobile/lib/presentation/widgets/timeline/timeline_grouping_header_sliver.widget.dart`:

- Keep `kTimelineGroupingHeaderSliverHeight = 56.0`.
- Adjust vertical padding if needed so the `48dp` selector fits without overflow.
- Keep selector before temporal chip in the row and do not add bottom floating controls.

Re-run:

```bash
cd mobile
mise exec -- flutter test test/presentation/widgets/timeline/timeline_grouping_selector_test.dart test/presentation/widgets/timeline/timeline_grouping_header_sliver_test.dart test/presentation/pages/dev/main_timeline_page_test.dart
```

Expected green: selector semantics are singular, accessible, disabled correctly, reduced-motion aware, RTL-safe, and responsive.

## Task 2: Overview Card Semantics, Localization, RTL, And Contrast

### TDD Tests First

Edit `mobile/test/presentation/widgets/timeline/overview/timeline_overview_card_test.dart`.

Add tests before production code:

1. `actionable year card exposes localized button semantics`
   - Pump `TimelineOverviewCard` with year `2025`, `assetCount: 1`, `groupBy: GroupAssetsBy.year`, and non-null `onTap`.
   - Use `SemanticsTester`.
   - Assert a button semantics node has label `2025, 1 photo, show months`.
   - Tap the card and assert the callback runs once.
   - Expected red: current card relies on raw child semantics and does not provide the required action label.

2. `actionable month card exposes full localized month and plural count semantics`
   - Pump with date `DateTime(2025, 3)`, `assetCount: 4`, `groupBy: GroupAssetsBy.month`, and non-null `onTap`.
   - Assert visible label remains compact `Mar 2025`.
   - Assert semantics label is `March 2025, 4 photos, show days`.
   - Expected red: current semantics do not expose the action, and visual label is the only date label.

3. `non-actionable cards do not expose button semantics`
   - Pump a zero-count year card with `onTap: null`.
   - Assert period and count text remain visible.
   - Assert no semantics node has both `SemanticsFlag.isButton` and the overview-card label.
   - Expected red only if explicit card semantics are added too broadly during implementation.

4. `fallback card keeps actionable semantics when thumbnail is missing`
   - Pump a month card with `representativeAsset: null`, positive count, and non-null `onTap`.
   - Assert fallback key is present.
   - Assert semantics still includes date, plural count, and action.
   - Expected red: current fallback has visible text but no action semantics.

5. `German locale uses localized month label and English fallback action`
   - Initialize German date formatting.
   - Pump with `EasyLocalization(supportedLocales: [Locale('de'), Locale('en')], fallbackLocale: Locale('en'), startLocale: Locale('de'))`.
   - Use date `DateTime(2025, 3)` and positive count.
   - Assert the visible month label and semantics contain the German month token for March (`Mär` or `März`, depending on skeleton width).
   - Assert the semantics still includes a translated action from fallback English if German does not yet have the new key.
   - Expected red if month formatting or translation fallback is hand-built English.

6. `Arabic locale uses RTL month labels and localized semantics order`
   - Initialize Arabic date formatting.
   - Pump with `EasyLocalization(supportedLocales: [Locale('ar'), Locale('en')], fallbackLocale: Locale('en'), startLocale: Locale('ar'))` and `Directionality(textDirection: TextDirection.rtl)`.
   - Use date `DateTime(2025, 3)`, positive count, and non-null `onTap`.
   - Assert the visible month label is not the English `Mar 2025`.
   - Assert the card semantics include an Arabic month token for March and the localized or fallback action copy.
   - Assert tapping the card still invokes the callback.
   - Expected red if month formatting or semantics are hard-coded to English or if RTL semantics hide the action.

7. `rtl card anchors label group to the directional start edge`
   - Pump inside `Directionality(textDirection: TextDirection.rtl)` and a fixed-width container.
   - Assert the year label right edge is closer to the card right edge than to the card left edge.
   - Expected red if absolute `left` positioning prevents RTL anchoring.

8. `long localized month labels and large text stay within the card`
   - Pump with `TextScaler.linear(2.4)`, a narrow width, and a long month locale such as German September.
   - Assert no overflow exception.
   - Assert the label and count badge are still found.
   - Expected green may occur if existing ellipsis already protects this; keep it as regression coverage.

9. `high contrast fallback preserves legible label and count colors`
   - Pump a fallback card inside `MediaQuery(highContrast: true)` and dark theme.
   - Assert the period label text color is white or high-contrast foreground.
   - Assert the count badge text/background remain contrasting.
   - Expected green may occur if existing colors already satisfy this; keep it as regression coverage.

10. `reduced motion overview card has no nonessential animations`
    - Pump an actionable `TimelineOverviewCard` inside `MediaQuery(disableAnimations: true, accessibleNavigation: true)`.
    - Assert there are no `AnimatedContainer`, `AnimatedOpacity`, `AnimatedSwitcher`, or non-zero animation durations inside the card subtree.
    - Pump normally and assert the same card still has no nonessential animation widgets.
    - Expected initial result: this may pass because overview cards currently use static layout. Keep it as the explicit reduced-motion card contract required by Slice 6.

11. `multiple overview cards expose semantics in visual order`
    - Pump two actionable cards in a vertical `Column`: `2025` then `2024`.
    - Use `SemanticsTester`.
    - Assert the semantics traversal or insertion order exposes the `2025, ... show months` label before `2024, ... show months`.
    - Repeat under `Directionality(textDirection: TextDirection.rtl)` to prove RTL does not reorder a vertical overview list.
    - Expected red if explicit card semantics are merged in a way that loses visual order.

Run the red suite:

```bash
cd mobile
mise exec -- flutter test test/presentation/widgets/timeline/overview/timeline_overview_card_test.dart
```

### Implementation

Edit `i18n/en.json` near existing timeline keys:

```json
"timeline_overview_show_days": "show days",
"timeline_overview_show_months": "show months",
"timeline_overview_card_semantics": "{period}, {countLabel}, {action}",
"timeline_temporal_scope_clear_semantics": "{label}, clear timeline date filter"
```

Keep existing `timeline_overview_photo_count` as the count source. If the formatter requires nested plural lookup for tests, add a tiny local helper in `overview_card.dart`; do not replace the public i18n structure unless needed.

Regenerate mobile localization files. These generated files are ignored by Git in this repo, so this is a local verification step rather than a staged artifact:

```bash
cd mobile
mise exec -- dart run easy_localization:generate -S ../i18n
mise exec -- dart run bin/generate_keys.dart
mise exec -- dart format lib/generated/codegen_loader.g.dart lib/generated/translations.g.dart
```

Edit `mobile/lib/presentation/widgets/timeline/overview/overview_card.dart`:

- Split visual and semantic period labels:
  - visual year: `DateFormat.y(locale)`
  - visual month: `DateFormat.yMMM(locale)`
  - semantic month: `DateFormat.yMMMM(locale)` plus year, or a locale-aware skeleton that speaks a full month and year.
- Use a shared count formatter backed by `timeline_overview_photo_count`.
- Build card semantics with `Semantics(button: onTap != null, enabled: onTap != null, label: localizedSemanticsLabel, child: ExcludeSemantics(child: ...))` only for actionable positive-count cards.
- For non-actionable cards, keep visible labels/counts but avoid exposing a button action.
- Preserve overview cards as static widgets with no nonessential animations; do not add animated thumbnail, label, or overlay transitions in this slice.
- Replace absolute `Positioned(left/right)` label placement with `PositionedDirectional(start/end)` and `CrossAxisAlignment.start`.
- Keep `BoxFit.cover`, fixed `kTimelineOverviewCardHeight`, modest radius, and gradient overlay.
- Add no route-specific behavior.

Re-run:

```bash
cd mobile
mise exec -- flutter test test/presentation/widgets/timeline/overview/timeline_overview_card_test.dart
```

Expected green: card semantics are localized and actionable only when drilldown is possible; visuals remain compact and responsive.

## Task 3: Temporal Scope Chip Semantics And Header Fit

### TDD Tests First

Edit `mobile/test/providers/photos_filter/active_temporal_scope_chip_test.dart`:

1. `year temporal chip has date-filter clear semantics metadata`
   - Call `activeTemporalScopeChip(const TimelineTemporalScope.year(2025), locale: 'en')`.
   - Assert the label is `2025`.
   - Assert the spec has a temporal clear semantics label or marker that the widget can render as `2025, clear timeline date filter`.
   - Expected red: chip specs currently only hold a visible label.

2. `month temporal chip uses localized month label for clear semantics`
   - Use `TimelineTemporalScope.month(year: 2025, month: 3)`.
   - Assert label `Mar 2025`.
   - Assert semantic copy would include `Mar 2025, clear timeline date filter`.
   - Expected red: no temporal-specific semantics metadata exists.

Edit `mobile/test/presentation/widgets/timeline/timeline_grouping_header_sliver_test.dart`:

3. `temporal chip announces a timeline date clear action`
   - Pump the header sliver, set month scope, and use `SemanticsTester`.
   - Assert the selector labels appear before the temporal chip in traversal order if the API exposes stable order; otherwise assert both are present and the chip semantics label is `Mar 2025, clear timeline date filter`.
   - Tap the close icon.
   - Assert only `timelineTemporalScopeProvider` returns to `TimelineTemporalScope.none()`.
   - Expected red: current chip says generic `remove_filter` copy.

4. `header fits selector and chip without overflow at large text`
   - Pump the header in a `MediaQuery(textScaler: TextScaler.linear(2.0))` and width `360`.
   - Set a month scope.
   - Assert no overflow exception.
   - Assert selector and chip remain visible.
   - Expected red only if selector height/padding changes introduce overflow.

Run the red suite:

```bash
cd mobile
mise exec -- flutter test test/providers/photos_filter/active_temporal_scope_chip_test.dart test/presentation/widgets/timeline/timeline_grouping_header_sliver_test.dart
```

### Implementation

Edit `mobile/lib/providers/photos_filter/active_chips.dart`:

- Add a nullable `semanticsLabel` to `ActiveChipSpec`.
- Keep all existing non-temporal chip constructors source-compatible by making the field optional.
- Set `semanticsLabel` in `activeTemporalScopeChip` to the new localized key:
  - `timeline_temporal_scope_clear_semantics`
  - named arg `label: chipLabel`
- Preserve `ChipVisual.when` and `TemporalScopeChipId`.

Edit `mobile/lib/presentation/widgets/filter_sheet/active_filter_chip.widget.dart`:

- Use `spec.semanticsLabel ?? '${spec.label}, ${'remove_filter'.tr()}'` for the outer `Semantics.label`.
- Do not change visual chip layout, remove behavior, avatars, or non-temporal filter semantics.

Edit `mobile/lib/presentation/widgets/timeline/timeline_grouping_header_sliver.widget.dart` if needed:

- Ensure the `48dp` selector fits in the `56dp` sliver.
- Keep temporal chip flexible and ellipsized.
- Preserve hiding behavior under multi-select.

Re-run:

```bash
cd mobile
mise exec -- flutter test test/providers/photos_filter/active_temporal_scope_chip_test.dart test/presentation/widgets/timeline/timeline_grouping_header_sliver_test.dart
```

Expected green: temporal chips have timeline-specific clear semantics and the header remains compact.

## Task 4: Full Slice Verification, Review, Commit, And Push

Run formatting:

```bash
cd mobile
mise exec -- dart format \
  lib/presentation/widgets/timeline/timeline_grouping_selector.widget.dart \
  lib/presentation/widgets/timeline/overview/overview_card.dart \
  lib/presentation/widgets/timeline/timeline_grouping_header_sliver.widget.dart \
  lib/presentation/widgets/filter_sheet/active_filter_chip.widget.dart \
  lib/providers/photos_filter/active_chips.dart \
  test/presentation/widgets/timeline/timeline_grouping_selector_test.dart \
  test/presentation/widgets/timeline/overview/timeline_overview_card_test.dart \
  test/presentation/widgets/timeline/timeline_grouping_header_sliver_test.dart \
  test/presentation/pages/dev/main_timeline_page_test.dart \
  test/providers/photos_filter/active_temporal_scope_chip_test.dart
```

Run the focused Slice 6 suite:

```bash
cd mobile
mise exec -- flutter test \
  test/presentation/widgets/timeline/timeline_grouping_selector_test.dart \
  test/presentation/widgets/timeline/overview/timeline_overview_card_test.dart \
  test/presentation/widgets/timeline/timeline_grouping_header_sliver_test.dart \
  test/presentation/pages/dev/main_timeline_page_test.dart \
  test/providers/photos_filter/active_temporal_scope_chip_test.dart
```

Run key regression suites from Slices 1-5:

```bash
cd mobile
mise exec -- flutter test \
  test/providers/timeline/overview_drilldown_provider_test.dart \
  test/presentation/widgets/timeline/timeline_route_scope_test.dart \
  test/presentation/widgets/timeline/overview/overview_segment_builder_test.dart \
  test/presentation/pages/timeline_route_adoption_test.dart \
  test/presentation/pages/drift_asset_selection_timeline_page_test.dart \
  test/presentation/widgets/bottom_sheet/map_bottom_sheet_timeline_test.dart \
  test/presentation/pages/search/drift_search_page_timeline_guardrail_test.dart \
  test/presentation/pages/cleanup_preview_page_test.dart
```

Run analyzer:

```bash
cd mobile
mise exec -- dart analyze \
  lib/presentation/widgets/timeline/timeline_grouping_selector.widget.dart \
  lib/presentation/widgets/timeline/overview/overview_card.dart \
  lib/presentation/widgets/timeline/timeline_grouping_header_sliver.widget.dart \
  lib/presentation/widgets/filter_sheet/active_filter_chip.widget.dart \
  lib/providers/photos_filter/active_chips.dart
```

Run repository hygiene:

```bash
git diff --check
git status --short
```

Expected final state:

- Selector has a single accessible segmented-control model, `48dp` actionable targets, disabled semantics, RTL visual order, and reduced-motion support.
- Overview cards have localized actionable semantics, no false button semantics when inactive, full month semantics, fallback semantics, RTL label anchoring, and large-text/high-contrast coverage.
- Overview cards have no nonessential animations under normal or reduced-motion media settings, and multiple cards read in visual order.
- Temporal chips clearly announce that they clear timeline date scope.
- No route adoption, query, picker/search/map guardrail, or day-mode behavior changes.
- Generated localization files are regenerated locally and can resolve the new keys; only `i18n/en.json` is committed.

Commit:

```bash
git add \
  docs/superpowers/specs/2026-05-22-mobile-timeline-overview-design.md \
  docs/superpowers/plans/2026-05-23-mobile-timeline-overview-slice-6-accessibility-localization-polish.md \
  i18n/en.json \
  mobile/lib/presentation/widgets/timeline/timeline_grouping_selector.widget.dart \
  mobile/lib/presentation/widgets/timeline/overview/overview_card.dart \
  mobile/lib/presentation/widgets/timeline/timeline_grouping_header_sliver.widget.dart \
  mobile/lib/presentation/widgets/filter_sheet/active_filter_chip.widget.dart \
  mobile/lib/providers/photos_filter/active_chips.dart \
  mobile/test/presentation/widgets/timeline/timeline_grouping_selector_test.dart \
  mobile/test/presentation/widgets/timeline/overview/timeline_overview_card_test.dart \
  mobile/test/presentation/widgets/timeline/timeline_grouping_header_sliver_test.dart \
  mobile/test/presentation/pages/dev/main_timeline_page_test.dart \
  mobile/test/providers/photos_filter/active_temporal_scope_chip_test.dart
git commit -m "fix(mobile): polish timeline overview accessibility"
git push
```

After push, invoke `babysit-codex` for the branch/PR and loop on CI failures until green or genuinely blocked.

## Review Checklist

- TDD order is explicit for every behavior.
- Semantics tests cover selector, actionable cards, non-actionable cards, fallback cards, multi-card traversal order, and temporal chips.
- Localization tests cover singular/plural counts, localized month formatting, actual RTL locale formatting, fallback action translation, and generated key coverage.
- Responsive tests cover narrow width, large text, app-bar/header fit, landscape/tablet no-extra-control behavior, RTL, high contrast, selector reduced motion, and overview-card no-animation reduced motion.
- The design remains consistent with the spec: compact top selector, compact overview cards, no floating bottom control, no extra Photos app-bar search/filter icon, and no full-screen year/month previews.
- Slice 6 does not implement new route adoption or query behavior.
