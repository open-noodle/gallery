import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/presentation/widgets/filter_sheet/deep/toggles_section.widget.dart';
import 'package:immich_mobile/providers/photos_filter/photos_filter.provider.dart';

import '../../../../widget_tester_extensions.dart';

void main() {
  group('TogglesSection', () {
    testWidgets('3 switches rendered: favourites / archived / not-in-album', (tester) async {
      await tester.pumpConsumerWidget(const Material(child: TogglesSection()));
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('toggle-favourites')), findsOneWidget);
      expect(find.byKey(const Key('toggle-archived')), findsOneWidget);
      expect(find.byKey(const Key('toggle-not-in-album')), findsOneWidget);
    });

    testWidgets('favourites toggle flips independently', (tester) async {
      await tester.pumpConsumerWidget(const Material(child: TogglesSection()));
      final container = ProviderScope.containerOf(tester.element(find.byType(TogglesSection)));

      await tester.tap(find.byKey(const Key('toggle-favourites')));
      await tester.pumpAndSettle();

      expect(container.read(photosFilterProvider).display.isFavorite, isTrue);
      expect(container.read(photosFilterProvider).display.isArchive, isFalse);
      expect(container.read(photosFilterProvider).display.isNotInAlbum, isFalse);
    });

    testWidgets('archived toggle flips independently', (tester) async {
      await tester.pumpConsumerWidget(const Material(child: TogglesSection()));
      final container = ProviderScope.containerOf(tester.element(find.byType(TogglesSection)));

      await tester.tap(find.byKey(const Key('toggle-archived')));
      await tester.pumpAndSettle();

      expect(container.read(photosFilterProvider).display.isArchive, isTrue);
      expect(container.read(photosFilterProvider).display.isFavorite, isFalse);
    });

    testWidgets('not-in-album toggle flips independently', (tester) async {
      await tester.pumpConsumerWidget(const Material(child: TogglesSection()));
      final container = ProviderScope.containerOf(tester.element(find.byType(TogglesSection)));

      await tester.tap(find.byKey(const Key('toggle-not-in-album')));
      await tester.pumpAndSettle();

      expect(container.read(photosFilterProvider).display.isNotInAlbum, isTrue);
    });

    testWidgets('initial switch state reflects provider', (tester) async {
      await tester.pumpConsumerWidget(const Material(child: TogglesSection()));
      final container = ProviderScope.containerOf(tester.element(find.byType(TogglesSection)));
      container.read(photosFilterProvider.notifier).setFavouritesOnly(true);
      await tester.pumpAndSettle();

      final favSwitch = tester.widget<SwitchListTile>(find.byKey(const Key('toggle-favourites')));
      expect(favSwitch.value, isTrue);
    });

    testWidgets('each switch tile meets 48pt tap target', (tester) async {
      await tester.pumpConsumerWidget(const Material(child: TogglesSection()));
      await tester.pumpAndSettle();
      expectTapTargetMin(tester, find.byKey(const Key('toggle-favourites')));
      expectTapTargetMin(tester, find.byKey(const Key('toggle-archived')));
      expectTapTargetMin(tester, find.byKey(const Key('toggle-not-in-album')));
    });

    testWidgets('renders correctly in dark theme', (tester) async {
      await tester.pumpConsumerWidgetDark(const Material(child: TogglesSection()));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('toggle-favourites')), findsOneWidget);
      expect(find.byKey(const Key('toggle-archived')), findsOneWidget);
      expect(find.byKey(const Key('toggle-not-in-album')), findsOneWidget);
    });
  });
}
