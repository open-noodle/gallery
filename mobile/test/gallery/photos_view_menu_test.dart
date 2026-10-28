import 'package:drift/drift.dart' as drift;
import 'package:drift/native.dart';
import 'package:easy_localization/easy_localization.dart' hide TextDirection;
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/data/db/main/database.dart';
import 'package:immich_mobile/domain/models/store.model.dart';
import 'package:immich_mobile/domain/models/timeline_grouping.model.dart';
import 'package:immich_mobile/domain/services/store.service.dart';
import 'package:immich_mobile/entities/store.entity.dart';
import 'package:immich_mobile/gallery/library_view.model.dart';
import 'package:immich_mobile/gallery/library_view.provider.dart';
import 'package:immich_mobile/gallery/photos_view_menu.widget.dart';
import 'package:immich_mobile/infrastructure/repositories/store.repository.dart';
import 'package:immich_mobile/providers/timeline/timeline_grouping.provider.dart';

import '../widget_tester_extensions.dart';

void main() {
  late Drift db;

  setUpAll(() async {
    TestWidgetsFlutterBinding.ensureInitialized();
    db = Drift(drift.DatabaseConnection(NativeDatabase.memory(), closeStreamsSynchronously: true));
    await StoreService.init(storeRepository: StoreRepository(db), listenUpdates: false);
  });

  setUp(() async => Store.clear());

  tearDownAll(() async => db.close());

  final button = find.byKey(const Key('photos-view-menu-button'));
  final menu = find.byKey(const Key('photos-view-menu'));
  Finder item(String key) => find.byKey(Key(key));
  ProviderContainer container(WidgetTester tester) => ProviderScope.containerOf(tester.element(button));

  /// The button where the Photos app bar puts it: at the end, before the backup and profile actions.
  Future<ValueNotifier<int>> pumpButton(
    WidgetTester tester, {
    bool hasTimelineSpace = true,
    Size size = const Size(412, 900),
    TextDirection direction = TextDirection.ltr,
  }) async {
    final generation = ValueNotifier(0);
    addTearDown(generation.dispose);
    // The view, not just the surface, so MediaQuery reports the same size the menu is laid out in.
    tester.view.physicalSize = size;
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    await tester.pumpWidget(
      localizedForTest(
        ProviderScope(
          overrides: [hasTimelineSpaceProvider.overrideWith((ref) => Stream.value(hasTimelineSpace))],
          child: Builder(
            builder: (context) => MaterialApp(
              localizationsDelegates: context.localizationDelegates,
              supportedLocales: context.supportedLocales,
              locale: context.locale,
              builder: (context, child) => Directionality(textDirection: direction, child: child!),
              home: Scaffold(
                body: Align(
                  alignment: AlignmentDirectional.topEnd,
                  child: Padding(
                    padding: const EdgeInsetsDirectional.only(top: 40, end: 104),
                    child: ValueListenableBuilder(
                      valueListenable: generation,
                      builder: (_, value, _) => PhotosViewMenuButton(key: ValueKey(value)),
                    ),
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
    return generation;
  }

  Future<void> open(WidgetTester tester) async {
    await tester.tap(button);
    await tester.pumpAndSettle();
  }

  Future<void> tapItem(WidgetTester tester, String key) async {
    await tester.tap(item(key));
    await tester.pumpAndSettle();
  }

  Finder buttonIcon(IconData icon) => find.descendant(of: button, matching: find.byIcon(icon));

  testWidgets('shows the view that narrows the timeline', (tester) async {
    await pumpButton(tester);
    expect(buttonIcon(Icons.more_horiz_rounded), findsOneWidget);

    await container(tester).read(libraryViewProvider.notifier).set(LibraryViewMode.personal);
    await tester.pumpAndSettle();
    expect(buttonIcon(Icons.person_outline_rounded), findsOneWidget);
    expect(tester.getSemantics(button), isSemantics(value: 'Personal'));

    await container(tester).read(libraryViewProvider.notifier).set(LibraryViewMode.spaces);
    await tester.pumpAndSettle();
    // The Spaces tab's icon.
    expect(buttonIcon(Icons.workspaces_outlined), findsOneWidget);
    expect(tester.getSemantics(button), isSemantics(value: 'Spaces'));
  });

  testWidgets('shows no view without a space on the timeline', (tester) async {
    await Store.put(StoreKey.photosLibraryView, LibraryViewMode.spaces.name);
    await pumpButton(tester, hasTimelineSpace: false);
    expect(buttonIcon(Icons.more_horiz_rounded), findsOneWidget);

    await open(tester);
    expect(item('photos-view-library-both'), findsNothing);
    expect(item('photos-view-grouping-all'), findsOneWidget);
  });

  testWidgets('offers no filters, which live in search mode', (tester) async {
    await pumpButton(tester);
    await open(tester);

    expect(item('photos-view-library-both'), findsOneWidget);
    expect(find.text('Favorites'), findsNothing);
    expect(find.text('Not in album'), findsNothing);
  });

  testWidgets('stays open while each choice applies, and closes on a tap outside', (tester) async {
    await pumpButton(tester);
    await open(tester);
    final ref = container(tester);

    await tapItem(tester, 'photos-view-library-spaces');
    expect(ref.read(libraryViewProvider), LibraryViewMode.spaces);
    expect(menu, findsOneWidget);

    await tapItem(tester, 'photos-view-grouping-years');
    expect(ref.read(timelineOverviewModeProvider), TimelineOverviewMode.years);
    expect(menu, findsOneWidget);

    await tester.tapAt(const Offset(20, 850));
    await tester.pumpAndSettle();
    expect(menu, findsNothing);
  });

  testWidgets('keeps working when the app bar rebuilds the button under it', (tester) async {
    final generation = await pumpButton(tester);
    await open(tester);

    generation.value++;
    await tester.pumpAndSettle();
    await tapItem(tester, 'photos-view-library-personal');

    expect(menu, findsOneWidget);
    expect(container(tester).read(libraryViewProvider), LibraryViewMode.personal);
    expect(buttonIcon(Icons.person_outline_rounded), findsOneWidget);
  });

  testWidgets('fits a 360-dp phone and right-to-left layouts', (tester) async {
    for (final (size, direction) in [
      (const Size(360, 800), TextDirection.ltr),
      (const Size(412, 900), TextDirection.rtl),
    ]) {
      await pumpButton(tester, size: size, direction: direction);
      await open(tester);

      final rect = tester.getRect(menu);
      expect(tester.takeException(), isNull, reason: '$size $direction');
      expect(rect.left, greaterThanOrEqualTo(8), reason: '$size $direction');
      expect(rect.right, lessThanOrEqualTo(size.width - 8), reason: '$size $direction');
      expect(rect.top, greaterThan(tester.getRect(button).bottom), reason: '$size $direction');

      await tester.tapAt(Offset(size.width / 2, size.height - 20));
      await tester.pumpAndSettle();
    }
  });

  testWidgets('tells screen readers which choice of each set is selected', (tester) async {
    final semantics = tester.ensureSemantics();
    await pumpButton(tester);
    await open(tester);

    expect(
      tester.getSemantics(item('photos-view-library-both')),
      isSemantics(isSelected: true, isInMutuallyExclusiveGroup: true),
    );
    expect(
      tester.getSemantics(item('photos-view-library-personal')),
      isSemantics(isSelected: false, isInMutuallyExclusiveGroup: true),
    );

    await tapItem(tester, 'photos-view-library-personal');
    expect(tester.getSemantics(item('photos-view-library-personal')), isSemantics(isSelected: true));
    expect(tester.getSemantics(item('photos-view-library-both')), isSemantics(isSelected: false));
    semantics.dispose();
  });
}
