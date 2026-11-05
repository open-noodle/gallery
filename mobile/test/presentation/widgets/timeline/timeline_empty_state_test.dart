import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/gallery/library_view.model.dart';
import 'package:immich_mobile/gallery/library_view.provider.dart';
import 'package:immich_mobile/gallery/search/search.providers.dart';
import 'package:immich_mobile/gallery/search/search_mode.provider.dart';
import 'package:immich_mobile/gallery/search/search_state.model.dart';
import 'package:immich_mobile/gallery/search/search_state.notifier.dart';
import 'package:immich_mobile/gallery/search/search_ui.providers.dart';
import 'package:immich_mobile/generated/translations.g.dart';
import 'package:immich_mobile/presentation/widgets/timeline/timeline_empty_state.widget.dart';
import 'package:immich_mobile/providers/sync_status.provider.dart';
import 'package:immich_mobile/widgets/common/immich_loading_indicator.dart';

import '../../../widget_tester_extensions.dart';

/// Search state override that starts from a fixed state, while keeping the real reset() behaviour.
class _FixedState extends SearchStateNotifier {
  _FixedState(this._initial);

  final SearchState _initial;

  @override
  SearchState build() => _initial;
}

class _Searching extends SearchModeNotifier {
  @override
  bool build() => true;
}

/// Results that never load anything: [loading] is whether a request is still in flight.
class _FixedResults extends SearchResultsNotifier {
  _FixedResults({required this.loading});

  final bool loading;

  @override
  SearchResults build() => SearchResults(loading: loading);
}

class _FixedSync extends SyncStatusNotifier {
  _FixedSync(this._initial);

  final SyncStatusState _initial;

  @override
  SyncStatusState build() => _initial;
}

/// 1×1 transparent PNG so Image.asset resolves without the real asset bundle.
final _transparentPng = base64Decode(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
);

class _FakeAssetBundle extends CachingAssetBundle {
  final ByteData _emptyManifest = const StandardMessageCodec().encodeMessage(<String, Object>{})!;

  @override
  Future<ByteData> load(String key) async {
    // Image.asset first resolves the binary asset manifest; serving PNG bytes
    // for it corrupts the decode, so return a valid empty manifest instead.
    if (key == 'AssetManifest.bin' || key == 'AssetManifest.bin.json' || key == 'AssetManifest.json') {
      return _emptyManifest;
    }
    return ByteData.view(Uint8List.fromList(_transparentPng).buffer);
  }

  @override
  Future<String> loadString(String key, {bool cache = true}) async => '';
}

void main() {
  Widget withFakeAssets(Widget child) => DefaultAssetBundle(bundle: _FakeAssetBundle(), child: child);

  const beach = SearchState(query: SearchQuery.text('beach'), sort: SearchSort.relevance);

  /// Search mode with [state], and results that are [loading] or settled.
  List<Override> searching(SearchState state, {required bool loading}) => [
    searchModeProvider.overrideWith(_Searching.new),
    searchStateProvider.overrideWith(() => _FixedState(state)),
    searchResultsProvider.overrideWith(() => _FixedResults(loading: loading)),
  ];

  testWidgets('an empty library view shows no results, without the filter actions', (tester) async {
    await tester.pumpConsumerWidget(
      const TimelineEmptyState(),
      overrides: [
        activeLibraryViewProvider.overrideWithValue(LibraryViewMode.personal),
        syncStatusProvider.overrideWith(() => _FixedSync(const SyncStatusState())),
      ],
    );
    await tester.pump();

    expect(find.text(StaticTranslations.instance.timeline_empty_filtered_title), findsOneWidget);
    expect(find.text(StaticTranslations.instance.timeline_empty_clear_filters), findsNothing);
    expect(find.text(StaticTranslations.instance.timeline_empty_title), findsNothing);
  });

  testWidgets('first-run state shows the onboarding title and an Enable Backup action', (tester) async {
    await tester.pumpConsumerWidget(
      withFakeAssets(const TimelineEmptyState()),
      overrides: [
        activeLibraryViewProvider.overrideWithValue(LibraryViewMode.both),
        syncStatusProvider.overrideWith(() => _FixedSync(const SyncStatusState())),
      ],
    );
    await tester.pumpAndSettle();

    expect(find.text(StaticTranslations.instance.timeline_empty_title), findsOneWidget);
    expect(find.byType(FilledButton), findsOneWidget);
    expect(find.byType(ImmichLoadingIndicator), findsNothing);
  });

  testWidgets('while the initial remote sync runs it shows a loader, not the onboarding', (tester) async {
    await tester.pumpConsumerWidgetRaw(
      const TimelineEmptyState(),
      overrides: [
        activeLibraryViewProvider.overrideWithValue(LibraryViewMode.both),
        syncStatusProvider.overrideWith(() => _FixedSync(const SyncStatusState(remoteSyncStatus: SyncStatus.syncing))),
      ],
    );
    await tester.pump();

    expect(find.byType(ImmichLoadingIndicator), findsOneWidget);
    expect(find.text('timeline_empty_title'), findsNothing);
  });

  // #901: the empty state can be built while the results request is still in flight.
  // It must not claim there is nothing to find before the server has answered.
  testWidgets('while the filtered search is still in flight it shows a loader, not the no-results state', (
    tester,
  ) async {
    await tester.pumpConsumerWidgetRaw(
      const TimelineEmptyState(),
      overrides: [
        ...searching(beach, loading: true),
        activeLibraryViewProvider.overrideWithValue(LibraryViewMode.both),
        syncStatusProvider.overrideWith(() => _FixedSync(const SyncStatusState())),
      ],
    );
    await tester.pump();

    expect(find.byType(ImmichLoadingIndicator), findsOneWidget);
    expect(find.text('timeline_empty_filtered_title'), findsNothing);
    expect(find.text('timeline_empty_clear_filters'), findsNothing);
  });

  testWidgets('a search with no matches shows the no-results state, and its action clears every filter and the query '
      'while search mode stays open (Slice 5 "Empty state")', (tester) async {
    await tester.pumpConsumerWidget(
      const TimelineEmptyState(),
      overrides: [
        ...searching(beach.copyWith(filters: const SearchFilters(favoritesOnly: true, minRating: 4)), loading: false),
        // syncing so that after the reset we deterministically land on the loader
        // (no asset/router needed) rather than the first-run state.
        activeLibraryViewProvider.overrideWithValue(LibraryViewMode.both),
        syncStatusProvider.overrideWith(() => _FixedSync(const SyncStatusState(remoteSyncStatus: SyncStatus.syncing))),
      ],
    );
    await tester.pump();
    final container = ProviderScope.containerOf(tester.element(find.byType(TimelineEmptyState)));
    container.read(searchFieldControllerProvider).text = 'bea';

    expect(find.text(StaticTranslations.instance.timeline_empty_filtered_title), findsOneWidget);
    expect(find.text(StaticTranslations.instance.timeline_empty_clear_filters), findsOneWidget);

    await tester.tap(find.text(StaticTranslations.instance.timeline_empty_clear_filters));
    await tester.pump();

    expect(find.text(StaticTranslations.instance.timeline_empty_filtered_title), findsNothing);
    expect(find.byType(ImmichLoadingIndicator), findsOneWidget);
    expect(container.read(searchStateProvider).isEmpty, isTrue, reason: 'filters and query cleared');
    expect(container.read(searchFieldControllerProvider).text, isEmpty);
    expect(container.read(searchModeProvider), isTrue, reason: 'search mode stays open, as with Clear all');
  });

  testWidgets('search mode with no filter yet is not a filtered search', (tester) async {
    await tester.pumpConsumerWidgetRaw(
      const TimelineEmptyState(),
      overrides: [
        ...searching(const SearchState(), loading: false),
        activeLibraryViewProvider.overrideWithValue(LibraryViewMode.both),
        syncStatusProvider.overrideWith(() => _FixedSync(const SyncStatusState(remoteSyncStatus: SyncStatus.syncing))),
      ],
    );
    await tester.pump();

    expect(find.text('timeline_empty_filtered_title'), findsNothing);
    expect(find.byType(ImmichLoadingIndicator), findsOneWidget);
  });
}
