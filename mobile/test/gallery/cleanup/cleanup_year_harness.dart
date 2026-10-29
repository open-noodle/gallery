import 'package:auto_route/auto_route.dart';
import 'package:easy_localization/easy_localization.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/gallery/cleanup/navigation.dart';
import 'package:immich_mobile/gallery/motion/hero_scope.dart';
import 'package:immich_mobile/routing/router.dart';

import '../../widget_tester_extensions.dart';
import '../search/switch_over_harness.dart' show stubRemoteImages;
import 'cleanup_overview_harness.dart';

// Slice 8's screens (specs/2026-10-29-mobile-library-cleanup-design.md, "Slice 8") under a small router holding the
// real overview, year, month and placeholder routes, with the app's hero controller.

class CleanupYearRouter extends RootStackRouter {
  CleanupYearRouter({required this.startAtOverview});

  final bool startAtOverview;

  @override
  List<AutoRoute> get routes => [
    AutoRoute(page: LibraryCleanupOverviewRoute.page, initial: startAtOverview),
    AutoRoute(page: LibraryCleanupYearRoute.page, initial: !startAtOverview),
    AutoRoute(page: LibraryCleanupMonthRoute.page),
    AutoRoute(page: LibraryCleanupPlaceholderRoute.page),
  ];
}

/// Records every rewind the screens open, and opens the placeholder as the real function does on this branch.
class RewindSpy {
  final opened = <int>[];

  Override get override => libraryCleanupRewindOpenerProvider.overrideWithValue((context, monthDay) {
    opened.add(monthDay);
    return context.pushRoute(LibraryCleanupPlaceholderRoute(title: 'rewind $monthDay'));
  });
}

/// Pumps Your year (or the overview, with [startAtOverview]) at a phone's size, [width] logical pixels wide.
Future<CleanupYearRouter> pumpYear(
  WidgetTester tester,
  ProviderContainer container, {
  bool startAtOverview = false,
  bool reduceMotion = false,
  double width = 392.7,
  bool settle = true,
  Brightness brightness = Brightness.light,
}) async {
  stubRemoteImages(tester);
  tester.view.devicePixelRatio = 2.75;
  tester.view.physicalSize = Size(width * 2.75, 2340);
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
  final router = CleanupYearRouter(startAtOverview: startAtOverview);
  await tester.pumpWidget(
    localizedForTest(
      UncontrolledProviderScope(
        container: container,
        child: Builder(
          builder: (context) => MaterialApp.router(
            theme: ThemeData(brightness: brightness, colorSchemeSeed: const Color(0xFF4250AF)),
            localizationsDelegates: context.localizationDelegates,
            supportedLocales: context.supportedLocales,
            locale: context.locale,
            builder: (context, child) => MediaQuery(
              data: MediaQuery.of(context).copyWith(disableAnimations: reduceMotion),
              child: GalleryHeroScope(child: child!),
            ),
            routerConfig: router.config(),
          ),
        ),
      ),
    ),
  );
  await tester.pump();
  if (settle) {
    await settleCleanup(tester);
  }
  return router;
}

/// Opens a month from the year screen by tapping its card.
Future<void> openMonth(WidgetTester tester, int month, {Future<void> Function()? settle}) async {
  final card = find.byKey(Key('cleanup-month-card-$month'));
  await tester.ensureVisible(card);
  await (settle?.call() ?? settleCleanup(tester));
  await tester.tap(card);
  await (settle?.call() ?? settleCleanup(tester));
  expect(find.byKey(Key('cleanup-month-grid-$month')), findsOneWidget);
}

/// Taps a day cell on the month screen.
Future<void> tapDay(WidgetTester tester, int monthDay, {Future<void> Function()? settle}) async {
  await tester.tap(find.byKey(Key('cleanup-day-$monthDay')));
  await (settle?.call() ?? settleCleanup(tester));
}

/// Fake time only, for animations in flight: no file reads or sockets wait on it.
Future<void> pumpFrames(WidgetTester tester, Duration total, {Duration step = const Duration(milliseconds: 16)}) async {
  for (var elapsed = Duration.zero; elapsed < total; elapsed += step) {
    await tester.pump(step);
  }
}
