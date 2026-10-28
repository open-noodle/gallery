import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/models/asset/base_asset.model.dart';
import 'package:immich_mobile/gallery/library_view.model.dart';
import 'package:immich_mobile/gallery/library_view.provider.dart';
import 'package:immich_mobile/gallery/search/search.providers.dart';
import 'package:immich_mobile/gallery/search/search_mode.provider.dart';
import 'package:immich_mobile/gallery/search/search_ui.providers.dart';
import 'package:immich_mobile/providers/asset_viewer/scroll_to_asset_notifier.provider.dart';
import 'package:immich_mobile/providers/asset_viewer/view_in_timeline_action.dart';

/// Records the order of the navigation steps so the sequencing the timeline jump
/// depends on can be asserted without a router.
class _Steps {
  final List<String> calls = [];

  Future<void> pop() async => calls.add('pop');

  Future<void> goToTimeline() async => calls.add('timeline');
}

class _LibraryView extends LibraryViewNotifier {
  @override
  LibraryViewMode build() => LibraryViewMode.personal;

  @override
  Future<void> set(LibraryViewMode view) async => state = view;
}

void main() {
  // Leaving search mode drops its options and results on the next frame.
  TestWidgetsFlutterBinding.ensureInitialized();
  late ProviderContainer container;
  late _Steps steps;

  setUp(() {
    container = ProviderContainer(overrides: [libraryViewProvider.overrideWith(_LibraryView.new)]);
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

  /// Photos search mode with a query: the state "View in timeline" is used from.
  void search() {
    container.read(searchModeProvider.notifier).enter();
    container.read(searchFieldControllerProvider).text = 'bea';
    container.read(searchStateProvider.notifier).submitText('beach');
  }

  bool searching() => container.read(searchModeProvider) || !container.read(searchStateProvider).isEmpty;

  test('leaves search mode so the jump lands on the normal Photos timeline (Slice 5 "View in timeline")', () async {
    // #898: mobile renders search results as the main Photos timeline in search mode, so
    // the timeline route is ALREADY on screen behind the viewer. Popping and navigating to
    // it changes nothing; only leaving search mode turns the results back into the
    // normal Photos timeline.
    search();
    expect(searching(), isTrue, reason: 'precondition: a search is active');

    await run();

    expect(container.read(searchModeProvider), isFalse);
    expect(container.read(searchStateProvider).isEmpty, isTrue);
    expect(container.read(searchFieldControllerProvider).text, isEmpty);
  });

  test('#1038: goes back to both library views, which can hide the photo too', () async {
    await run();

    expect(container.read(libraryViewProvider), LibraryViewMode.both);
  });

  test('closes the viewer before search mode closes under it', () async {
    // The viewer holds the search TimelineService by value; leaving search mode
    // disposes it. Pop first so nothing is torn out from under a live viewer.
    search();
    String? closedAfter;
    container.listen(searchModeProvider, (_, next) {
      closedAfter ??= next ? null : steps.calls.join(',');
    });

    await run();

    expect(closedAfter, 'pop');
  });

  test('latches the scroll target only once search mode is closed', () async {
    // Latching while the search timeline is still the active one lets the drain
    // resolve against the results being left behind and burn the request.
    search();
    bool? closedAtLatch;
    void listener() => closedAtLatch ??= !searching();
    scrollToAssetNotifierProvider.addListener(listener);
    addTearDown(() => scrollToAssetNotifierProvider.removeListener(listener));

    await run();

    expect(closedAtLatch, isTrue);
    expect(scrollToAssetNotifierProvider.value?.asset.heroTag, _asset('a1').heroTag);
  });

  // #1047: the destination timeline has to travel with the request. A Space timeline is
  // pushed OVER the main one, which stays mounted and listening on the same latch, so an
  // unscoped request is drained by whichever is ready first.
  test('latches the Space that must honour the jump', () async {
    await viewAssetInTimeline(
      asset: _asset('a1'),
      read: container.read,
      popViewer: steps.pop,
      goToTimeline: steps.goToTimeline,
      spaceId: 'space-1',
    );

    expect(scrollToAssetNotifierProvider.value?.spaceId, 'space-1');
  });

  // The Space timeline is PUSHED, and auto_route's push future completes when the route
  // is POPPED. A jump that waited for it would latch the request only after the user had
  // already left the Space, so the scroll never happened (#1047).
  test('latches the Space target before the pushed route settles', () async {
    final pushed = Completer<void>();
    final jump = viewAssetInTimeline(
      asset: _asset('a1'),
      read: container.read,
      popViewer: steps.pop,
      goToTimeline: () {
        steps.calls.add('timeline');
        return pushed.future;
      },
      spaceId: 'space-1',
    );
    await pumpEventQueue();

    expect(steps.calls, ['pop', 'timeline'], reason: 'precondition: the Space route is still on screen');
    expect(scrollToAssetNotifierProvider.value?.spaceId, 'space-1');

    pushed.complete();
    await jump;
  });

  test('leaves the request unscoped for a jump to the personal timeline', () async {
    await run();

    expect(scrollToAssetNotifierProvider.value?.spaceId, isNull);
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
