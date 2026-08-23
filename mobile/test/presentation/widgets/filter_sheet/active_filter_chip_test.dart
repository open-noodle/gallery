import 'package:drift/drift.dart' as drift;
import 'package:drift/native.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/models/store.model.dart';
import 'package:immich_mobile/domain/services/store.service.dart';
import 'package:immich_mobile/entities/store.entity.dart';
import 'package:immich_mobile/infrastructure/repositories/db.repository.dart';
import 'package:immich_mobile/infrastructure/repositories/store.repository.dart';
import 'package:immich_mobile/models/photos_filter/filter_person.model.dart';
import 'package:immich_mobile/presentation/widgets/filter_sheet/active_filter_chip.widget.dart';
import 'package:immich_mobile/presentation/widgets/images/remote_image_provider.dart';
import 'package:immich_mobile/providers/photos_filter/active_chips.dart';
import 'package:immich_mobile/providers/photos_filter/chip_id.dart';
import 'package:immich_mobile/providers/photos_filter/photos_filter.provider.dart';

import '../../../widget_tester_extensions.dart';

const _alice = FilterPerson(id: 'a', name: 'Alice');

void main() {
  late Drift db;
  setUpAll(() async {
    TestWidgetsFlutterBinding.ensureInitialized();
    db = Drift(drift.DatabaseConnection(NativeDatabase.memory(), closeStreamsSynchronously: true));
    await StoreService.init(storeRepository: StoreRepository(db));
    await Store.put(StoreKey.serverEndpoint, 'http://localhost:0');
  });
  tearDownAll(() async {
    await Store.clear();
    await db.close();
  });

  group('ActiveFilterChip', () {
    // The chip avatar had the same gray-circle bug as the picker: a shared-space person's tokenized
    // id 404s the owner endpoint. With the spaceId threaded through the spec it routes to the space
    // endpoint.
    testWidgets('shared-space person avatar routes to the space thumbnail endpoint', (tester) async {
      const spec = ActiveChipSpec(
        id: PersonChipId('space-person:sp-1'),
        label: 'Zoe',
        visual: ChipVisual.person,
        avatarPersonIds: ['space-person:sp-1'],
        avatarPersonSpaceIds: ['space-1'],
      );
      await tester.pumpConsumerWidget(const ActiveFilterChip(spec: spec));
      await tester.pumpAndSettle();
      final avatar = tester.widget<CircleAvatar>(find.byType(CircleAvatar));
      expect(
        (avatar.backgroundImage! as RemoteImageProvider).url,
        'http://localhost:0/shared-spaces/space-1/people/sp-1/thumbnail',
      );
    });

    testWidgets('personal person avatar routes to the owner thumbnail endpoint', (tester) async {
      const spec = ActiveChipSpec(
        id: PersonChipId('person:p-1'),
        label: 'Alice',
        visual: ChipVisual.person,
        avatarPersonIds: ['person:p-1'],
        avatarPersonSpaceIds: [null],
      );
      await tester.pumpConsumerWidget(const ActiveFilterChip(spec: spec));
      await tester.pumpAndSettle();
      final avatar = tester.widget<CircleAvatar>(find.byType(CircleAvatar));
      expect((avatar.backgroundImage! as RemoteImageProvider).url, 'http://localhost:0/people/p-1/thumbnail');
    });

    testWidgets('renders label + close icon', (tester) async {
      const spec = ActiveChipSpec(
        id: LocationChipId(),
        label: 'Paris',
        visual: ChipVisual.location,
        icon: Icons.place_rounded,
      );

      await tester.pumpConsumerWidget(const ActiveFilterChip(spec: spec));
      await tester.pumpAndSettle();

      expect(find.text('Paris'), findsOneWidget);
      expect(find.byIcon(Icons.close_rounded), findsOneWidget);
    });

    // activeChipsFromFilter is a pure Dart helper with no BuildContext, so
    // toggle/media/fallback specs carry an i18n *key* (labelIsKey: true)
    // rather than resolved text — the widget must translate it before
    // display, or the raw key ("filter_sheet_favourites") leaks to the user.
    testWidgets('labelIsKey spec renders the translated string, not the raw key', (tester) async {
      const spec = ActiveChipSpec(
        id: FavouriteChipId(),
        label: 'filter_sheet_favourites',
        labelIsKey: true,
        visual: ChipVisual.toggle,
        icon: Icons.favorite_rounded,
      );

      await tester.pumpConsumerWidget(const ActiveFilterChip(spec: spec));
      await tester.pumpAndSettle();

      expect(find.text('Favourites'), findsOneWidget);
      expect(find.text('filter_sheet_favourites'), findsNothing);
    });

    testWidgets('tag spec renders leading dot with key', (tester) async {
      const spec = ActiveChipSpec(id: TagChipId('t1'), label: 'wedding', visual: ChipVisual.tag, tagDotSeed: 42);

      await tester.pumpConsumerWidget(const ActiveFilterChip(spec: spec));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('tag-dot')), findsOneWidget);
    });

    testWidgets('camera spec renders Icons.photo_camera_rounded leading', (tester) async {
      const spec = ActiveChipSpec(
        id: CameraChipId(),
        label: 'Canon · R5',
        visual: ChipVisual.camera,
        icon: Icons.photo_camera_rounded,
      );

      await tester.pumpConsumerWidget(const ActiveFilterChip(spec: spec));
      await tester.pumpAndSettle();
      expect(find.text('Canon · R5'), findsOneWidget);
      expect(find.byIcon(Icons.photo_camera_rounded), findsOneWidget);
    });

    testWidgets('location spec renders Icons.place_rounded leading', (tester) async {
      const spec = ActiveChipSpec(
        id: LocationChipId(),
        label: 'France',
        visual: ChipVisual.location,
        icon: Icons.place_rounded,
      );

      await tester.pumpConsumerWidget(const ActiveFilterChip(spec: spec));
      await tester.pumpAndSettle();
      expect(find.byIcon(Icons.place_rounded), findsOneWidget);
    });

    testWidgets('tap on close invokes removeChip with matching ChipId', (tester) async {
      const spec = ActiveChipSpec(id: TagChipId('t1'), label: 'wedding', visual: ChipVisual.tag);

      await tester.pumpConsumerWidget(const ActiveFilterChip(spec: spec));
      await tester.pumpAndSettle();

      final container = ProviderScope.containerOf(tester.element(find.byType(ActiveFilterChip)));
      container.read(photosFilterProvider.notifier).toggleTag('t1'); // seed state
      expect(container.read(photosFilterProvider).tagIds, ['t1']);

      await tester.tap(find.byIcon(Icons.close_rounded));
      await tester.pumpAndSettle();

      expect(container.read(photosFilterProvider).tagIds, anyOf(isNull, isEmpty));
    });

    testWidgets('close removes person with matching id (id-based equality)', (tester) async {
      const spec = ActiveChipSpec(id: PersonChipId('a'), label: 'Alice', visual: ChipVisual.person);

      await tester.pumpConsumerWidget(const ActiveFilterChip(spec: spec));
      await tester.pumpAndSettle();

      final container = ProviderScope.containerOf(tester.element(find.byType(ActiveFilterChip)));
      container.read(photosFilterProvider.notifier).togglePerson(_alice);

      await tester.tap(find.byIcon(Icons.close_rounded));
      await tester.pumpAndSettle();

      expect(container.read(photosFilterProvider).people, isEmpty);
    });

    testWidgets('tap on close invokes custom remove callback when provided', (tester) async {
      const spec = ActiveChipSpec(id: TagChipId('t1'), label: 'wedding', visual: ChipVisual.tag);
      var removed = 0;

      await tester.pumpConsumerWidget(ActiveFilterChip(spec: spec, onRemove: () => removed++));
      await tester.pumpAndSettle();

      final container = ProviderScope.containerOf(tester.element(find.byType(ActiveFilterChip)));
      container.read(photosFilterProvider.notifier).toggleTag('t1');
      expect(container.read(photosFilterProvider).tagIds, ['t1']);

      await tester.tap(find.byIcon(Icons.close_rounded));
      await tester.pumpAndSettle();

      expect(removed, 1);
      expect(container.read(photosFilterProvider).tagIds, ['t1']);
    });
  });
}
