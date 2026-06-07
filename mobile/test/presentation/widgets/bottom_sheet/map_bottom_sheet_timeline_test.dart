import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/models/config/app_config.dart';
import 'package:immich_mobile/domain/models/config/timeline_config.dart';
import 'package:immich_mobile/domain/models/timeline.model.dart';
import 'package:immich_mobile/domain/models/user.model.dart';
import 'package:immich_mobile/domain/services/timeline.service.dart';
import 'package:immich_mobile/infrastructure/repositories/timeline.repository.dart';
import 'package:immich_mobile/domain/services/user.service.dart';
import 'package:immich_mobile/presentation/widgets/bottom_sheet/map_bottom_sheet.widget.dart';
import 'package:immich_mobile/presentation/widgets/map/map.state.dart';
import 'package:immich_mobile/presentation/widgets/timeline/timeline.widget.dart';
import 'package:immich_mobile/providers/infrastructure/readonly_mode.provider.dart';
import 'package:immich_mobile/providers/infrastructure/settings.provider.dart';
import 'package:immich_mobile/providers/infrastructure/timeline.provider.dart';
import 'package:immich_mobile/providers/user.provider.dart';
import 'package:maplibre_gl/maplibre_gl.dart';
import 'package:mocktail/mocktail.dart';

class _MockTimelineFactory extends Mock implements TimelineFactory {}

class _MockTimelineService extends Mock implements TimelineService {}

class _MockUserService extends Mock implements UserService {}

class _StubReadOnlyModeNotifier extends ReadOnlyModeNotifier {
  @override
  bool build() => false;
}

class _StubCurrentUserNotifier extends CurrentUserProvider {
  _StubCurrentUserNotifier(super.service, UserDto user) {
    state = user;
  }
}

UserDto _user(String id) => UserDto(id: id, email: '$id@example.com', name: id, profileChangedAt: DateTime(2024));

void main() {
  setUpAll(() {
    registerFallbackValue(
      TimelineMapOptions(
        bounds: LatLngBounds(northeast: const LatLng(0, 0), southwest: const LatLng(0, 0)),
      ),
    );
  });

  testWidgets('forces day grouping for map factory and timeline', (tester) async {
    final user = _user('user-1');
    final userService = _MockUserService();
    final factory = _MockTimelineFactory();
    final timelineService = _MockTimelineService();
    final mapState = MapState(
      bounds: LatLngBounds(northeast: const LatLng(1, 1), southwest: const LatLng(0, 0)),
    );

    when(() => userService.tryGetMyUser()).thenReturn(user);
    when(() => userService.watchMyUser()).thenAnswer((_) => const Stream<UserDto?>.empty());
    when(() => factory.map([user.id], user.id, any(), groupBy: GroupAssetsBy.day)).thenReturn(timelineService);
    when(timelineService.dispose).thenAnswer((_) async {});

    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          currentUserProvider.overrideWith((ref) => _StubCurrentUserNotifier(userService, user)),
          readonlyModeProvider.overrideWith(() => _StubReadOnlyModeNotifier()),
          appConfigProvider.overrideWithValue(const AppConfig(timeline: TimelineConfig(tilesPerRow: 3))),
          timelineFactoryProvider.overrideWithValue(factory),
          mapStateProvider.overrideWith(() => _FixedMapStateNotifier(mapState)),
        ],
        child: const MaterialApp(home: MapBottomSheetTimeline()),
      ),
    );

    verify(() => factory.map([user.id], user.id, any(), groupBy: GroupAssetsBy.day)).called(1);
    expect(MapBottomSheet.forcedTimelineGroupBy, GroupAssetsBy.day);
    expect(tester.widget<Timeline>(find.byType(Timeline)).groupBy, GroupAssetsBy.day);
  });
}

class _FixedMapStateNotifier extends MapStateNotifier {
  _FixedMapStateNotifier(this._state);

  final MapState _state;

  @override
  MapState build() => _state;
}
