import 'dart:async';
import 'dart:io';

import 'package:auto_route/auto_route.dart';
import 'package:easy_localization/easy_localization.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/models/store.model.dart';
import 'package:immich_mobile/entities/store.entity.dart';
import 'package:immich_mobile/gallery/cleanup/models/library_cleanup_marks.dart';
import 'package:immich_mobile/gallery/cleanup/providers/library_cleanup.providers.dart';
import 'package:immich_mobile/gallery/cleanup/providers/library_cleanup_overview.providers.dart';
import 'package:immich_mobile/gallery/cleanup/repositories/library_cleanup.repository.dart';
import 'package:immich_mobile/gallery/cleanup/repositories/library_cleanup_marks_store.dart';
import 'package:immich_mobile/gallery/cleanup/widgets/library_cleanup_button.dart';
import 'package:immich_mobile/gallery/motion/entrance.dart';
import 'package:immich_mobile/routing/router.dart';

import '../../widget_tester_extensions.dart';
import '../search/switch_over_harness.dart' show stubRemoteImages;
import 'cleanup_test_utils.dart';

// Slice 2's screens (specs/2026-10-29-mobile-library-cleanup-design.md, "Slice 2"): the Library entry and the overview,
// under a small router holding the real overview, rewind, queue and year routes. The Library stand-in is the action grid's
// shape: the real `LibraryCleanupButton` under a row of upstream-looking buttons, as `library.page.dart` places it.

const _libraryName = 'CleanupTestLibrary';

class CleanupOverviewRouter extends RootStackRouter {
  late final _library = PageInfo(_libraryName, builder: (_) => const _LibraryStandIn());

  @override
  List<AutoRoute> get routes => [
    AutoRoute(page: _library, initial: true),
    AutoRoute(page: LibraryCleanupOverviewRoute.page),
    AutoRoute(page: LibraryCleanupQueueRoute.page),
    AutoRoute(page: LibraryCleanupRewindRoute.page),
    AutoRoute(page: LibraryCleanupYearRoute.page),
  ];
}

class _LibraryStandIn extends StatelessWidget {
  const _LibraryStandIn();

  @override
  Widget build(BuildContext context) => const Scaffold(
    body: SafeArea(
      child: Padding(
        padding: EdgeInsets.all(16),
        child: Column(
          children: [
            Row(
              children: [
                Expanded(child: Text('Favorites')),
                Expanded(child: Text('Archived')),
              ],
            ),
            LibraryCleanupButton(),
          ],
        ),
      ),
    ),
  );
}

/// 15 August 2026, 10:00: the contract's rewind day.
DateTime august15() => DateTime(2026, 8, 15, 10);

/// The thumbnails' URLs read the server endpoint from the app store.
Future<void> initOverviewStore() async {
  await initTestStore();
  await Store.put(StoreKey.serverEndpoint, 'http://cleanup.test/api');
}

/// A container for the overview: [repository] (or [server]'s), today fixed by [now], marks saved in [directory].
ProviderContainer overviewContainer({
  FakeCleanupServer? server,
  LibraryCleanupRepository? repository,
  required Directory directory,
  DateTime Function() now = august15,
  bool trashEnabled = true,
  LibraryCleanupServerKind kind = LibraryCleanupServerKind.gallery,
  Future<bool> Function()? emptyTrash,
}) => cleanupContainer(
  server: server,
  repository: repository,
  directory: directory,
  trashEnabled: trashEnabled,
  kind: kind,
  overrides: [
    libraryCleanupClockProvider.overrideWithValue(now),
    libraryCleanupEmptyTrashProvider.overrideWithValue(emptyTrash ?? () async => true),
  ],
);

/// Saves pending rewind marks for [monthDay], as a session would have left them.
Future<void> saveDayMarks(
  WidgetTester tester,
  Directory directory,
  int monthDay,
  Map<String, LibraryCleanupMark> marks,
) async {
  final book = LibraryCleanupMarkBook();
  marks.forEach(book.mark);
  final store = LibraryCleanupMarksStore(() async => directory);
  await tester.runAsync(() async {
    await store.save(LibraryCleanupMarksStore.rewindKey('user-1', monthDay), book);
    await store.flush();
  });
}

/// Pumps the Library stand-in under the overview router; with [openOverview] the overview is pushed at once.
Future<CleanupOverviewRouter> pumpCleanup(
  WidgetTester tester,
  ProviderContainer container, {
  bool reduceMotion = false,
  bool openOverview = false,
  bool settle = true,
}) async {
  stubRemoteImages(tester);
  tester.view.physicalSize = const Size(1080, 2340);
  tester.view.devicePixelRatio = 2.75;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
  final router = CleanupOverviewRouter();
  await tester.pumpWidget(
    localizedForTest(
      UncontrolledProviderScope(
        container: container,
        child: Builder(
          builder: (context) => MaterialApp.router(
            localizationsDelegates: context.localizationDelegates,
            supportedLocales: context.supportedLocales,
            locale: context.locale,
            builder: (context, child) => MediaQuery(
              data: MediaQuery.of(context).copyWith(disableAnimations: reduceMotion),
              child: child!,
            ),
            routerConfig: router.config(),
          ),
        ),
      ),
    ),
  );
  await tester.pump();
  if (openOverview) {
    // The future completes when the route is popped, not when it shows.
    unawaited(router.push(const LibraryCleanupOverviewRoute()));
  }
  if (settle) {
    await settleCleanup(tester);
  }
  return router;
}

/// Fake time for frames and timers, real time for file reads and sockets, until both have been quiet for a while.
Future<void> settleCleanup(WidgetTester tester, {int Function()? requests, int frames = 24}) async {
  var quiet = 0;
  var seen = requests?.call() ?? 0;
  for (var i = 0; i < frames * 4 && quiet < frames; i++) {
    await tester.pump(const Duration(milliseconds: 50));
    await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 5)));
    final now = requests?.call() ?? 0;
    if (now == seen) {
      quiet++;
    } else {
      quiet = 0;
      seen = now;
    }
  }
}

/// The text of the widget with [key] (a `Text` or `Text.rich`).
String textOf(WidgetTester tester, String key) {
  final widget = tester.widget<Text>(find.byKey(Key(key)));
  return widget.data ?? widget.textSpan!.toPlainText();
}

/// The opacity each overview section's entrance is at, in page order: today card, quick wins, year teaser.
List<double> entranceOpacities(WidgetTester tester) => [
  for (final entrance in tester.widgetList(find.byType(GalleryEntrance)).indexed)
    tester
        .widget<Opacity>(
          find.descendant(of: find.byType(GalleryEntrance).at(entrance.$1), matching: find.byType(Opacity)).first,
        )
        .opacity,
];
