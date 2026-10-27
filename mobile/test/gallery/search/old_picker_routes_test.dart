import 'dart:io';

import 'package:auto_route/auto_route.dart';
import 'package:drift/drift.dart' show DatabaseConnection;
import 'package:drift/native.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/data/db/main/database.dart';
import 'package:immich_mobile/domain/services/store.service.dart';
import 'package:immich_mobile/infrastructure/repositories/store.repository.dart';
import 'package:immich_mobile/routing/router.dart';
import 'package:immich_mobile/services/api.service.dart';
import 'package:immich_mobile/services/auth.service.dart';
import 'package:immich_mobile/services/local_auth.service.dart';
import 'package:immich_mobile/services/secure_storage.service.dart';
import 'package:mocktail/mocktail.dart';

class _MockApiService extends Mock implements ApiService {}

class _MockAuthService extends Mock implements AuthService {}

class _MockSecureStorageService extends Mock implements SecureStorageService {}

class _MockLocalAuthService extends Mock implements LocalAuthService {}

// Slice 5, "Router" (specs/2026-10-23-mobile-search-redesign-design.md): the old filter sheet's five full-screen
// pickers are gone from the route table, and no code navigates to them.
const oldPickerRoutes = [
  'PersonPickerRoute',
  'WhenPickerRoute',
  'PlacesPickerRoute',
  'TagsPickerRoute',
  'CameraPickerRoute',
];

Iterable<String> _names(List<AutoRoute> routes) sync* {
  for (final route in routes) {
    yield route.name;
    yield* _names(route.children ?? const []);
  }
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test('the five old picker routes are not in the route table', () async {
    final db = Drift(DatabaseConnection(NativeDatabase.memory()));
    addTearDown(db.close);
    await StoreService.init(storeRepository: StoreRepository(db), listenUpdates: false);
    final router = AppRouter(
      _MockApiService(),
      _MockAuthService(),
      _MockSecureStorageService(),
      _MockLocalAuthService(),
    );

    final names = _names(router.routes).toSet();
    expect(names, contains(MainTimelineRoute.name), reason: 'precondition: the walk sees the app routes');
    for (final picker in oldPickerRoutes) {
      expect(names, isNot(contains(picker)));
    }
  });

  test('no code navigates to them', () {
    final hits = <String>[];
    for (final file in Directory('lib').listSync(recursive: true).whereType<File>()) {
      // The generated router is gitignored and rebuilt from router.dart; a stale copy is not the app's code.
      if (!file.path.endsWith('.dart') || file.path.endsWith('.gr.dart')) {
        continue;
      }
      final source = file.readAsStringSync();
      for (final picker in oldPickerRoutes) {
        if (source.contains(picker)) {
          hits.add('${file.path}: $picker');
        }
      }
    }
    expect(hits, isEmpty);
  });
}
