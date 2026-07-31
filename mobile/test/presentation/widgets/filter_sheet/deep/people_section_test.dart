import 'package:drift/drift.dart' as drift;
import 'package:drift/native.dart';
import 'package:easy_localization/easy_localization.dart' hide TextDirection;
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/models/person.model.dart';
import 'package:immich_mobile/domain/models/store.model.dart';
import 'package:immich_mobile/domain/services/store.service.dart';
import 'package:immich_mobile/entities/store.entity.dart';
import 'package:immich_mobile/infrastructure/repositories/db.repository.dart';
import 'package:immich_mobile/infrastructure/repositories/store.repository.dart';
import 'package:immich_mobile/presentation/widgets/filter_sheet/deep/people_section.widget.dart';
import 'package:immich_mobile/presentation/widgets/images/remote_image_provider.dart';
import 'package:immich_mobile/providers/photos_filter/filter_suggestions.provider.dart';
import 'package:immich_mobile/providers/photos_filter/photos_filter.provider.dart';
import 'package:openapi/api.dart';

import '../../../../widget_tester_extensions.dart';

FilterSuggestionsResponseDto _sugg({List<FilterSuggestionsPersonDto>? people}) =>
    FilterSuggestionsResponseDto(hasUnnamedPeople: false, people: people ?? const []);

void main() {
  late Drift db;
  setUpAll(() async {
    TestWidgetsFlutterBinding.ensureInitialized();
    db = Drift(drift.DatabaseConnection(NativeDatabase.memory(), closeStreamsSynchronously: true));
    await StoreService.init(storeRepository: DriftStoreRepository(db));
    await Store.put(StoreKey.serverEndpoint, 'http://localhost:0');
  });
  tearDownAll(() async {
    await Store.clear();
    await db.close();
  });

  group('PeopleSectionDeep', () {
    testWidgets('renders section title + "Search N people →" header when suggestions > 0', (tester) async {
      await tester.pumpConsumerWidget(
        const Material(child: PeopleSectionDeep(onOpenPicker: null)),
        overrides: [
          photosFilterSuggestionsProvider.overrideWith(
            (ref, filter) => Future.value(
              _sugg(
                people: [
                  FilterSuggestionsPersonDto(id: 'p1', name: 'Emma'),
                  FilterSuggestionsPersonDto(id: 'p2', name: 'Lars'),
                ],
              ),
            ),
          ),
        ],
      );
      await tester.pumpAndSettle();

      // DeepSectionScaffold renders the title as .tr().toUpperCase(); the
      // localized pump resolves it, so assert on the same value.
      expect(find.text('filter_sheet_deep_people_section'.tr().toUpperCase()), findsOneWidget);
      expect(find.text('Emma'), findsOneWidget);
      expect(find.text('Lars'), findsOneWidget);
      expect(find.byKey(const Key('people-section-search-more')), findsOneWidget);
    });

    testWidgets('tap avatar toggles togglePerson in photosFilterProvider', (tester) async {
      await tester.pumpConsumerWidget(
        const Material(child: PeopleSectionDeep(onOpenPicker: null)),
        overrides: [
          photosFilterSuggestionsProvider.overrideWith(
            (ref, filter) => Future.value(
              _sugg(
                people: [FilterSuggestionsPersonDto(id: 'p1', name: 'Emma')],
              ),
            ),
          ),
        ],
      );
      await tester.pumpAndSettle();

      final container = ProviderScope.containerOf(tester.element(find.byType(PeopleSectionDeep)));
      await tester.tap(find.byKey(const Key('people-tile-p1')));
      await tester.pumpAndSettle();

      expect(container.read(photosFilterProvider).people.any((p) => p.id == 'p1'), isTrue);
    });

    // With withSharedSpaces the server returns a tokenized id + a space-person primaryProfile.
    // The avatar must route off the profile to the membership-gated space endpoint, not the
    // tokenized id (which would 404 through the owner /people/{id} endpoint). Mirrors #737.
    testWidgets('space-person avatar routes to the membership-gated space thumbnail endpoint', (tester) async {
      await tester.pumpConsumerWidget(
        const Material(child: PeopleSectionDeep(onOpenPicker: null)),
        overrides: [
          photosFilterSuggestionsProvider.overrideWith(
            (ref, filter) => Future.value(
              _sugg(
                people: [
                  FilterSuggestionsPersonDto(
                    id: 'space-person:profile-1',
                    name: 'Alice',
                    primaryProfile: Optional.present(
                      ScopedPrimaryProfile(
                        id: 'profile-1',
                        spaceId: const Optional.present('space-1'),
                        type: ScopedPrimaryProfileTypeEnum.spacePerson,
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ],
      );
      await tester.pumpAndSettle();

      final avatar = tester.widget<CircleAvatar>(find.byType(CircleAvatar));
      final provider = avatar.backgroundImage! as RemoteImageProvider;
      expect(provider.url, 'http://localhost:0/shared-spaces/space-1/people/profile-1/thumbnail');
    });

    testWidgets('empty list → section auto-collapses with "(0)", no "Search N" affordance', (tester) async {
      await tester.pumpConsumerWidget(
        const Material(child: PeopleSectionDeep(onOpenPicker: null)),
        overrides: [photosFilterSuggestionsProvider.overrideWith((ref, filter) => Future.value(_sugg(people: [])))],
      );
      await tester.pumpAndSettle();

      expect(find.textContaining('(0)'), findsOneWidget);
      expect(find.byKey(const Key('deep-section-empty')), findsNothing);
      expect(find.byKey(const Key('people-section-search-more')), findsNothing);
    });

    testWidgets('onOpenPicker callback fires when "Search N →" tapped', (tester) async {
      var opened = false;
      await tester.pumpConsumerWidget(
        Material(child: PeopleSectionDeep(onOpenPicker: () => opened = true)),
        overrides: [
          photosFilterSuggestionsProvider.overrideWith(
            (ref, filter) => Future.value(
              _sugg(
                people: [FilterSuggestionsPersonDto(id: 'p1', name: 'Emma')],
              ),
            ),
          ),
        ],
      );
      await tester.pumpAndSettle();

      await tester.tap(find.byKey(const Key('people-section-search-more')));
      expect(opened, isTrue);
    });

    testWidgets('null onOpenPicker does NOT show a SnackBar when "Search N →" tapped', (tester) async {
      await tester.pumpConsumerWidget(
        const Material(child: PeopleSectionDeep(onOpenPicker: null)),
        overrides: [
          photosFilterSuggestionsProvider.overrideWith(
            (ref, filter) => Future.value(
              _sugg(
                people: [FilterSuggestionsPersonDto(id: 'p1', name: 'Emma')],
              ),
            ),
          ),
        ],
      );
      await tester.pumpAndSettle();

      await tester.tap(find.byKey(const Key('people-section-search-more')));
      await tester.pumpAndSettle();
      expect(find.byType(SnackBar), findsNothing);
    });

    testWidgets('selected avatar renders primary-colored ring in dark theme', (tester) async {
      await tester.pumpConsumerWidgetDark(
        const Material(child: PeopleSectionDeep(onOpenPicker: null)),
        overrides: [
          photosFilterSuggestionsProvider.overrideWith(
            (ref, filter) => Future.value(
              _sugg(
                people: [FilterSuggestionsPersonDto(id: 'p1', name: 'Emma')],
              ),
            ),
          ),
        ],
      );
      await tester.pumpAndSettle();
      final container = ProviderScope.containerOf(tester.element(find.byType(PeopleSectionDeep)));
      container
          .read(photosFilterProvider.notifier)
          .togglePerson(const PersonDto(id: 'p1', name: 'Emma', isHidden: false, thumbnailPath: ''));
      await tester.pumpAndSettle();

      final ring = tester.widget<AnimatedContainer>(find.byKey(const Key('people-tile-ring-p1')));
      final decoration = ring.decoration as BoxDecoration;
      expect(decoration.border, isNotNull);
    });

    // Slice 3: cap the preview to 6 avatars + move "Search N →" from the header to a body row.
    testWidgets('caps preview to 6 avatars + renders "Search N →" in the body (not the header)', (tester) async {
      final people = [for (var i = 0; i < 10; i++) FilterSuggestionsPersonDto(id: 'p$i', name: 'P$i')];
      await tester.pumpConsumerWidget(
        const Material(child: PeopleSectionDeep(onOpenPicker: null)),
        overrides: [
          photosFilterSuggestionsProvider.overrideWith((ref, filter) => Future.value(_sugg(people: people))),
        ],
      );
      await tester.pumpAndSettle();

      for (var i = 0; i < 6; i++) {
        expect(find.byKey(Key('people-tile-p$i')), findsOneWidget);
      }
      for (var i = 6; i < 10; i++) {
        expect(find.byKey(Key('people-tile-p$i')), findsNothing);
      }

      expect(
        find.descendant(
          of: find.byKey(const Key('collapsible-body-people')),
          matching: find.byKey(const Key('people-section-search-more')),
        ),
        findsOneWidget,
      );
      expect(
        find.descendant(
          of: find.byKey(const Key('collapsible-header-people')),
          matching: find.byKey(const Key('people-section-search-more')),
        ),
        findsNothing,
      );
    });

    testWidgets('pins a selected person beyond the first 6', (tester) async {
      final people = [for (var i = 0; i < 10; i++) FilterSuggestionsPersonDto(id: 'p$i', name: 'P$i')];
      await tester.pumpConsumerWidget(
        const Material(child: PeopleSectionDeep(onOpenPicker: null)),
        overrides: [
          photosFilterSuggestionsProvider.overrideWith((ref, filter) => Future.value(_sugg(people: people))),
        ],
      );
      await tester.pumpAndSettle();

      final container = ProviderScope.containerOf(tester.element(find.byType(PeopleSectionDeep)));
      container.read(photosFilterProvider.notifier).togglePerson(
        const PersonDto(id: 'p7', name: 'P7', isHidden: false, thumbnailPath: ''),
      );
      await tester.pumpAndSettle();

      // Pinned beyond the cap because it's selected.
      expect(find.byKey(const Key('people-tile-p7')), findsOneWidget);
      // The remaining, unselected overflow stays hidden.
      expect(find.byKey(const Key('people-tile-p8')), findsNothing);
      expect(find.byKey(const Key('people-tile-p9')), findsNothing);

      final ring = tester.widget<AnimatedContainer>(find.byKey(const Key('people-tile-ring-p7')));
      final decoration = ring.decoration as BoxDecoration;
      expect(decoration.border, isNotNull, reason: 'pinned tile should render selected state');
    });

    testWidgets('≤6 people renders all, no over-cap', (tester) async {
      final people = [for (var i = 0; i < 4; i++) FilterSuggestionsPersonDto(id: 'p$i', name: 'P$i')];
      await tester.pumpConsumerWidget(
        const Material(child: PeopleSectionDeep(onOpenPicker: null)),
        overrides: [
          photosFilterSuggestionsProvider.overrideWith((ref, filter) => Future.value(_sugg(people: people))),
        ],
      );
      await tester.pumpAndSettle();

      for (var i = 0; i < 4; i++) {
        expect(find.byKey(Key('people-tile-p$i')), findsOneWidget);
      }
    });

    testWidgets('avatar tile hit area ≥ 44×44 pt', (tester) async {
      await tester.pumpConsumerWidget(
        const Material(child: PeopleSectionDeep(onOpenPicker: null)),
        overrides: [
          photosFilterSuggestionsProvider.overrideWith(
            (ref, filter) => Future.value(
              _sugg(
                people: [FilterSuggestionsPersonDto(id: 'p1', name: 'Emma')],
              ),
            ),
          ),
        ],
      );
      await tester.pumpAndSettle();
      final size = tester.getSize(find.byKey(const Key('people-tile-p1')));
      expect(size.width, greaterThanOrEqualTo(44));
      expect(size.height, greaterThanOrEqualTo(44));
    });
  });
}
