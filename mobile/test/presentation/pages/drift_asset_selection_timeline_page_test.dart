import 'package:drift/drift.dart' as drift;
import 'package:drift/native.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/data/db/main/database.dart';
import 'package:immich_mobile/domain/models/asset/base_asset.model.dart';
import 'package:immich_mobile/domain/models/config/app_config.dart';
import 'package:immich_mobile/domain/models/config/timeline_config.dart';
import 'package:immich_mobile/domain/models/store.model.dart';
import 'package:immich_mobile/domain/models/timeline.model.dart';
import 'package:immich_mobile/domain/models/user.model.dart';
import 'package:immich_mobile/domain/services/store.service.dart';
import 'package:immich_mobile/domain/services/timeline.service.dart';
import 'package:immich_mobile/domain/services/user.service.dart';
import 'package:immich_mobile/entities/store.entity.dart';
import 'package:immich_mobile/infrastructure/repositories/store.repository.dart';
import 'package:immich_mobile/models/cast/cast_manager_state.dart';
import 'package:immich_mobile/presentation/pages/asset_selection_timeline.page.dart';
import 'package:immich_mobile/presentation/widgets/timeline/timeline.widget.dart';
import 'package:immich_mobile/providers/cast.provider.dart';
import 'package:immich_mobile/providers/infrastructure/readonly_mode.provider.dart';
import 'package:immich_mobile/providers/infrastructure/settings.provider.dart';
import 'package:immich_mobile/providers/infrastructure/timeline.provider.dart';
import 'package:immich_mobile/providers/user.provider.dart';
import 'package:immich_mobile/services/server_info.service.dart';
import 'package:mocktail/mocktail.dart';

import '../../test_utils.dart';
import '../../widget_tester_extensions.dart';

class _MockTimelineFactory extends Mock implements TimelineFactory {}

class _MockUserService extends Mock implements UserService {}

class _MockServerInfoService extends Mock implements ServerInfoService {}

class _StubCastNotifier extends StateNotifier<CastManagerState> implements CastNotifier {
  _StubCastNotifier()
    : super(
        const CastManagerState(
          isCasting: false,
          receiverName: '',
          castState: CastState.idle,
          currentTime: Duration.zero,
          duration: Duration.zero,
        ),
      );

  @override
  List<(String, CastDestinationType, dynamic)> discovered = const [];

  @override
  Future<void> connect(CastDestinationType type, device) async {}

  @override
  Future<void> disconnect() async {}

  @override
  Future<List<(String, CastDestinationType, dynamic)>> getDevices() async => discovered;

  @override
  void loadMedia(RemoteAsset asset, bool reload) {}

  @override
  void pause() {}

  @override
  void play() {}

  @override
  void seekTo(Duration position) {}

  @override
  void stop() {}

  @override
  void toggle() {}
}

class _StubReadOnlyModeNotifier extends ReadOnlyModeNotifier {
  @override
  bool build() => true;
}

class _StubCurrentUserNotifier extends CurrentUserProvider {
  _StubCurrentUserNotifier(super.service, UserDto user) {
    state = user;
  }
}

UserDto _user(String id) => UserDto(id: id, email: '$id@example.com', name: id, profileChangedAt: DateTime(2024));

void main() {
  late Drift db;

  setUpAll(() async {
    TestWidgetsFlutterBinding.ensureInitialized();
    TestUtils.init();
    db = Drift(drift.DatabaseConnection(NativeDatabase.memory(), closeStreamsSynchronously: true));
    await StoreService.init(storeRepository: StoreRepository(db), listenUpdates: false);
  });

  setUp(() async {
    await Store.clear();
    await Store.put(StoreKey.serverEndpoint, 'http://localhost');
  });

  tearDownAll(() async {
    await Store.clear();
    await db.close();
  });

  testWidgets('forces day grouping for remote asset selection factory and timeline', (tester) async {
    final user = _user('user-1');
    final userService = _MockUserService();
    final factory = _MockTimelineFactory();
    final timelineService = TimelineService((
      bucketSource: () => const Stream<List<Bucket>>.empty(),
      assetSource: (offset, count) async => const <BaseAsset>[],
      origin: TimelineOrigin.remoteAssets,
    ));
    final serverInfoService = _MockServerInfoService();

    when(() => userService.tryGetMyUser()).thenReturn(user);
    when(() => userService.watchMyUser()).thenAnswer((_) => const Stream<UserDto?>.empty());
    when(() => factory.main([], user.id, groupBy: GroupAssetsBy.day)).thenReturn(timelineService);
    addTearDown(timelineService.dispose);

    await tester.pumpWidget(
      localizedForTest(
        ProviderScope(
          overrides: [
            currentUserProvider.overrideWith((ref) => _StubCurrentUserNotifier(userService, user)),
            readonlyModeProvider.overrideWith(() => _StubReadOnlyModeNotifier()),
            appConfigProvider.overrideWithValue(const AppConfig(timeline: TimelineConfig(tilesPerRow: 3))),
            timelineFactoryProvider.overrideWithValue(factory),
            castProvider.overrideWith((ref) => _StubCastNotifier()),
            serverInfoServiceProvider.overrideWithValue(serverInfoService),
          ],
          child: MaterialApp(home: withStubRouter(const AssetSelectionTimelinePage())),
        ),
      ),
    );

    verify(() => factory.main([], user.id, groupBy: GroupAssetsBy.day)).called(1);
    expect(AssetSelectionTimelinePage.forcedGroupBy, GroupAssetsBy.day);
    expect(tester.widget<Timeline>(find.byType(Timeline)).groupBy, GroupAssetsBy.day);
  });
}
