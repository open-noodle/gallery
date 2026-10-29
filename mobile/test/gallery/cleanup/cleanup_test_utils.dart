import 'dart:convert';
import 'dart:io';

import 'package:drift/drift.dart';
import 'package:drift/native.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:immich_mobile/data/db/main/database.dart';
import 'package:immich_mobile/domain/services/store.service.dart';
import 'package:immich_mobile/entities/store.entity.dart';
import 'package:immich_mobile/gallery/cleanup/providers/library_cleanup.providers.dart';
import 'package:immich_mobile/gallery/cleanup/repositories/library_cleanup.repository.dart';
import 'package:immich_mobile/infrastructure/repositories/store.repository.dart';
import 'package:openapi/api.dart';

/// One request as it left the generated client.
class SeenRequest {
  final String method;
  final String path;
  final Map<String, List<String>> query;
  final Object? body;

  const SeenRequest(this.method, this.path, this.query, this.body);

  /// `METHOD /path` without the `/api` prefix.
  String get route => '$method ${path.replaceFirst('/api', '')}';

  @override
  String toString() => '$route $query ${jsonEncode(body)}';
}

class FakeResponse {
  final int status;
  final Object? body;

  const FakeResponse(this.body, [this.status = 200]);
}

/// The real generated client over an in-memory HTTP client that records every request and answers from [respond].
/// A request [respond] has no answer for (null) is a failed test.
class FakeCleanupServer {
  FakeCleanupServer(this.respond, {this.gate}) {
    client = ApiClient(basePath: 'http://cleanup.test/api')..client = MockClient(_handle);
  }

  final requests = <SeenRequest>[];
  final FakeResponse? Function(SeenRequest request) respond;

  /// Holds a response back until the future it returns completes (null: answer at once).
  final Future<void>? Function(SeenRequest request)? gate;
  late final ApiClient client;

  Future<http.Response> _handle(http.Request request) async {
    final seen = SeenRequest(
      request.method,
      request.url.path,
      request.url.queryParametersAll,
      request.body.isEmpty ? null : jsonDecode(request.body),
    );
    requests.add(seen);
    await gate?.call(seen);
    final response = respond(seen);
    if (response == null) {
      throw StateError('unexpected request: $seen');
    }
    return http.Response(
      jsonEncode(response.body),
      response.status,
      headers: {'content-type': 'application/json; charset=utf-8'},
    );
  }

  List<String> get routes => [for (final request in requests) request.route];

  LibraryCleanupRepository repository({LibraryCleanupTimeZoneReader? timeZone}) => LibraryCleanupRepository(
    cleanupApi: CleanupApi(client),
    trashApi: TrashApi(client),
    timeZone: timeZone ?? () async => 'Europe/Lisbon',
  );
}

Map<String, Object?> assetJson(
  String id, {
  bool kept = false,
  String localDateTime = '2020-08-15T12:00:00.000Z',
  String? city,
  double fileSize = 1000,
}) => {
  'id': id,
  'type': 'IMAGE',
  'originalFileName': '$id.jpg',
  'localDateTime': localDateTime,
  'thumbhash': null,
  'width': 100,
  'height': 100,
  'duration': null,
  'fileSize': fileSize,
  'isFavorite': false,
  'inAlbum': false,
  'city': city,
  'kept': kept,
};

Map<String, Object?> calendarJson({List<Map<String, Object?>>? days}) => {
  'days': days ?? [dayJson(815, 5)],
  'daysReviewed': 0,
  'streak': 0,
};

Map<String, Object?> dayJson(int monthDay, int count, {String? reviewedAt}) => {
  'monthDay': monthDay,
  'assetCount': count,
  'reviewedAt': reviewedAt,
};

Map<String, Object?> commitJson({
  List<String> trashed = const [],
  int favorited = 0,
  int kept = 0,
  List<Map<String, Object?>> skipped = const [],
}) => {'trashed': trashed, 'favorited': favorited, 'kept': kept, 'skipped': skipped};

Map<String, Object?> pageJson(List<String> ids, {String? nextCursor}) => {
  'items': [for (final id in ids) assetJson(id)],
  'groups': <Object>[],
  'nextCursor': nextCursor,
};

/// The in-memory app `Store` the prefs live in, once per test file.
Future<void> initTestStore() async {
  final db = Drift(DatabaseConnection(NativeDatabase.memory(), closeStreamsSynchronously: true));
  await StoreService.init(storeRepository: StoreRepository(db), listenUpdates: false);
  addTearDown(() async {
    await Store.clear();
  });
}

/// A container whose cleanup providers talk to [server] and keep their saved marks in [directory].
ProviderContainer cleanupContainer({
  FakeCleanupServer? server,
  LibraryCleanupRepository? repository,
  required Directory directory,
  bool trashEnabled = true,
  LibraryCleanupServerKind kind = LibraryCleanupServerKind.gallery,
  LibraryCleanupTimeZoneReader? timeZone,
  List<Override> overrides = const [],
}) {
  final container = ProviderContainer(
    overrides: [
      libraryCleanupRepositoryProvider.overrideWithValue(repository ?? server!.repository(timeZone: timeZone)),
      libraryCleanupMarksDirectoryProvider.overrideWithValue(() async => directory),
      libraryCleanupUserIdProvider.overrideWithValue('user-1'),
      libraryCleanupTrashEnabledProvider.overrideWithValue(trashEnabled),
      libraryCleanupServerKindProvider.overrideWithValue(kind),
      ...overrides,
    ],
  );
  addTearDown(container.dispose);
  return container;
}

Directory tempDirectory() {
  final directory = Directory.systemTemp.createTempSync('library_cleanup_test');
  addTearDown(() => directory.deleteSync(recursive: true));
  return directory;
}

/// Ids `a1`…`aN`.
List<String> ids(String prefix, int count) => [for (var i = 1; i <= count; i++) '$prefix$i'];

/// Lets pending microtasks and zero-delay timers run, so fire-and-forget saves and loads finish.
Future<void> pumpEvents() => Future<void>.delayed(const Duration(milliseconds: 20));

/// Fails the test when something was sent that [allowed] does not name.
void expectOnlyRoutes(FakeCleanupServer server, List<String> allowed) {
  expect(server.routes.where((route) => !allowed.contains(route)), isEmpty, reason: 'requests: ${server.requests}');
}
