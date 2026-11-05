import 'dart:convert';
import 'dart:io';

import 'package:drift/drift.dart' hide isNull;
import 'package:drift/native.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/data/db/main/database.dart';
import 'package:immich_mobile/domain/models/store.model.dart';
import 'package:immich_mobile/domain/services/store.service.dart';
import 'package:immich_mobile/entities/store.entity.dart';
import 'package:immich_mobile/gallery/video/data_saver_video.dart';
import 'package:immich_mobile/infrastructure/repositories/store.repository.dart';
import 'package:immich_mobile/models/server_info/server_features.model.dart';
import 'package:immich_mobile/platform/connectivity_api.g.dart';
import 'package:immich_mobile/providers/infrastructure/platform.provider.dart';
import 'package:mocktail/mocktail.dart';
import 'package:openapi/api.dart';

import '../../api.mocks.dart';
import '../../widget_tester_extensions.dart';

/// `GET /server/features` as the search contract recorded it from a current Gallery server.
Map<String, dynamic> _recordedFeatures() {
  final fixture = jsonDecode(File('test/fixtures/search_contract/server-features.json').readAsStringSync());
  return Map<String, dynamic>.from(fixture['response']['body'] as Map);
}

/// The user's switch, held in memory, remembering what the settings tile wrote.
class _Preference extends DataSaverVideoPreference {
  _Preference(this._initial);

  final bool _initial;
  final written = <bool>[];

  @override
  bool build() => _initial;

  @override
  void set(bool value) {
    written.add(value);
    state = value;
  }
}

void main() {
  group('ServerFeatures.dataSaverVideo', () {
    ServerFeatures fromJson(Map<String, dynamic> json) => ServerFeatures.fromDto(ServerFeaturesDto.fromJson(json)!);

    test('reads the server flag', () {
      expect(fromJson(_recordedFeatures()..['dataSaverVideo'] = true).dataSaverVideo, isTrue);
      expect(fromJson(_recordedFeatures()..['dataSaverVideo'] = false).dataSaverVideo, isFalse);
    });

    test('is off on a server that predates the flag', () {
      expect(fromJson(_recordedFeatures()..remove('dataSaverVideo')).dataSaverVideo, isFalse);
    });
  });

  group('RemoteVideoRoute', () {
    late MockConnectivityApi connectivity;

    Future<String> route({bool serverOffers = true, bool userWants = true}) {
      final container = ProviderContainer(
        overrides: [
          connectivityApiProvider.overrideWithValue(connectivity),
          dataSaverVideoEnabledProvider.overrideWithValue(serverOffers),
          dataSaverVideoOnMobileDataProvider.overrideWith(() => _Preference(userWants)),
        ],
      );
      addTearDown(container.dispose);
      return container.read(remoteVideoRouteProvider).resolve();
    }

    void networkIs(List<NetworkCapability> capabilities) {
      when(() => connectivity.getCapabilities()).thenAnswer((_) async => capabilities);
    }

    setUp(() => connectivity = MockConnectivityApi());

    test('streams the Data Saver copy on mobile data', () async {
      networkIs([NetworkCapability.cellular]);
      expect(await route(), RemoteVideoRoute.dataSaver);
    });

    test('streams the normal video on Wi-Fi', () async {
      networkIs([NetworkCapability.wifi, NetworkCapability.unmetered]);
      expect(await route(), RemoteVideoRoute.playback);
    });

    test('treats a metered Wi-Fi hotspot as mobile data', () async {
      networkIs([NetworkCapability.wifi]);
      expect(await route(), RemoteVideoRoute.dataSaver);
    });

    test('streams the normal video when the user turned the switch off', () async {
      networkIs([NetworkCapability.cellular]);
      expect(await route(userWants: false), RemoteVideoRoute.playback);
    });

    test('never asks a server that does not offer the copy, nor reads the network for it', () async {
      networkIs([NetworkCapability.cellular]);
      expect(await route(serverOffers: false), RemoteVideoRoute.playback);
      verifyNever(() => connectivity.getCapabilities());
    });

    test('falls back to the normal video when the network cannot be read', () async {
      when(() => connectivity.getCapabilities()).thenThrow(_NetworkUnreadable());
      expect(await route(), RemoteVideoRoute.playback);
    });
  });

  group('DataSaverVideoPreference', () {
    late Drift db;
    late StoreService store;

    setUpAll(() async {
      db = Drift(DatabaseConnection(NativeDatabase.memory(), closeStreamsSynchronously: true));
      store = await StoreService.init(storeRepository: StoreRepository(db), listenUpdates: false);
    });

    tearDownAll(() async {
      await store.dispose();
      await db.close();
    });

    test('is on until the user turns it off, and remembers that', () async {
      await Store.delete(StoreKey.dataSaverVideoOnMobileData);
      final first = ProviderContainer();
      addTearDown(first.dispose);
      expect(first.read(dataSaverVideoOnMobileDataProvider), isTrue);

      first.read(dataSaverVideoOnMobileDataProvider.notifier).set(false);
      await pumpEventQueue();

      final next = ProviderContainer();
      addTearDown(next.dispose);
      expect(next.read(dataSaverVideoOnMobileDataProvider), isFalse);
    });
  });

  group('DataSaverVideoSettingTile', () {
    Future<_Preference> pumpTile(WidgetTester tester, {required bool serverOffers}) async {
      final preference = _Preference(true);
      await tester.pumpConsumerWidget(
        const DataSaverVideoSettingTile(),
        overrides: [
          dataSaverVideoEnabledProvider.overrideWithValue(serverOffers),
          dataSaverVideoOnMobileDataProvider.overrideWith(() => preference),
        ],
      );
      return preference;
    }

    testWidgets('is hidden when the server does not offer the copy', (tester) async {
      await pumpTile(tester, serverOffers: false);
      expect(find.byType(Switch), findsNothing);
    });

    testWidgets('turns the switch off', (tester) async {
      final preference = await pumpTile(tester, serverOffers: true);
      expect(tester.widget<Switch>(find.byType(Switch)).value, isTrue);

      await tester.tap(find.byType(Switch));
      await tester.pumpAndSettle();

      expect(preference.written, [false]);
    });
  });
}

class _NetworkUnreadable implements Exception {}
