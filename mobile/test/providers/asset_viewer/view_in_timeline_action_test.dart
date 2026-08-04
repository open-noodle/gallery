import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/models/asset/base_asset.model.dart';
import 'package:immich_mobile/providers/asset_viewer/scroll_to_asset_notifier.provider.dart';
import 'package:immich_mobile/providers/asset_viewer/view_in_timeline_action.dart';
import 'package:immich_mobile/providers/photos_filter/filter_sheet.provider.dart';
import 'package:immich_mobile/providers/photos_filter/photos_filter.provider.dart';

/// Records the order of the navigation steps so the sequencing the timeline jump
/// depends on can be asserted without a router.
class _Steps {
  final List<String> calls = [];

  Future<void> pop() async => calls.add('pop');

  Future<void> goToTimeline() async => calls.add('timeline');
}

void main() {
  late ProviderContainer container;
  late _Steps steps;

  setUp(() {
    container = ProviderContainer();
    steps = _Steps();
    // The notifier is a process-wide singleton; drop anything a previous test left.
    scrollToAssetNotifierProvider.consume();
  });

  tearDown(() {
    container.dispose();
    scrollToAssetNotifierProvider.consume();
  });

  Future<void> run() => viewAssetInTimeline(
    asset: _asset('a1'),
    read: container.read,
    popViewer: steps.pop,
    goToTimeline: steps.goToTimeline,
  );

  test('clears an active Photos filter so the jump leaves the search results', () async {
    // #898: mobile renders search results as the main Photos timeline with a filter
    // applied, so the timeline route is ALREADY on screen behind the viewer. Popping
    // and navigating to it changes nothing — only clearing the filter turns those
    // results back into the global timeline.
    container.read(photosFilterProvider.notifier).setText('beach');
    expect(container.read(photosFilterProvider).isEmpty, isFalse, reason: 'precondition: a search is active');

    await run();

    expect(container.read(photosFilterProvider).isEmpty, isTrue);
  });

  test('hides the filter sheet so it cannot cover the photo it lands on', () async {
    container.read(photosFilterSheetProvider.notifier).state = FilterSheetSnap.browse;

    await run();

    expect(container.read(photosFilterSheetProvider), FilterSheetSnap.hidden);
  });

  test('closes the viewer before the filter clears out of under it', () async {
    // The viewer holds the search TimelineService by value; clearing the filter
    // disposes it. Pop first so nothing is torn out from under a live viewer.
    container.read(photosFilterProvider.notifier).setText('beach');
    String? filterClearedAfter;
    container.listen(photosFilterProvider, (_, next) {
      filterClearedAfter ??= next.isEmpty ? steps.calls.join(',') : null;
    });

    await run();

    expect(filterClearedAfter, 'pop');
  });

  test('latches the scroll target only once the filter is already cleared', () async {
    // Latching while the search timeline is still the active one lets the drain
    // resolve against the results being left behind and burn the request.
    container.read(photosFilterProvider.notifier).setText('beach');
    bool? filterWasEmptyAtLatch;
    void listener() => filterWasEmptyAtLatch ??= container.read(photosFilterProvider).isEmpty;
    scrollToAssetNotifierProvider.addListener(listener);
    addTearDown(() => scrollToAssetNotifierProvider.removeListener(listener));

    await run();

    expect(filterWasEmptyAtLatch, isTrue);
    expect(scrollToAssetNotifierProvider.value?.asset.heroTag, _asset('a1').heroTag);
  });

  test('activates the main timeline route after closing the viewer', () async {
    await run();

    expect(steps.calls, ['pop', 'timeline']);
  });
}

RemoteAsset _asset(String id) => RemoteAsset(
  id: id,
  name: '$id.jpg',
  ownerId: 'owner-1',
  checksum: 'checksum-$id',
  type: AssetType.image,
  createdAt: DateTime(2026, 4, 3, 12),
  updatedAt: DateTime(2026, 4, 3, 12),
  isEdited: false,
);
