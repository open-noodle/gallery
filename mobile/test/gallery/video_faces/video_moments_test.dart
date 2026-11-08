import 'dart:convert';

import 'package:drift/drift.dart' as drift;
import 'package:drift/native.dart';
import 'package:easy_localization/easy_localization.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:immich_mobile/data/db/main/database.dart';
import 'package:immich_mobile/domain/models/asset/base_asset.model.dart';
import 'package:immich_mobile/domain/models/person.model.dart';
import 'package:immich_mobile/domain/models/store.model.dart';
import 'package:immich_mobile/domain/services/store.service.dart';
import 'package:immich_mobile/entities/store.entity.dart';
import 'package:immich_mobile/gallery/video_faces/video_moments.dart';
import 'package:immich_mobile/gallery/video_faces/video_moments.providers.dart';
import 'package:immich_mobile/gallery/video_faces/video_moments.repository.dart';
import 'package:immich_mobile/gallery/video_faces/video_moments.widgets.dart';
import 'package:immich_mobile/infrastructure/repositories/store.repository.dart';
import 'package:immich_mobile/providers/asset_viewer/video_player_provider.dart';
import 'package:openapi/api.dart';

import '../../unit/factories/remote_asset_factory.dart';
import '../../widget_tester_extensions.dart';

const _box = {'x1': 0.25, 'y1': 0.1, 'x2': 0.5, 'y2': 0.6};

Map<String, Object?> _sighting(double time, {double score = 0.8, bool isBest = false}) => {
  'time': time,
  'score': score,
  'isBest': isBest,
  'box': _box,
};

VideoMoment _moment(String faceId, double time, {double score = 0.8, bool isBest = false}) => VideoMoment(
  faceId: faceId,
  time: time,
  score: score,
  isBest: isBest,
  box: const VideoMomentBox(x1: 0.25, y1: 0.1, x2: 0.5, y2: 0.6),
);

/// The real generated faces API over an in-memory server answering from [routes] (`GET /path` → status and body).
class _FakeFacesServer {
  _FakeFacesServer(this.routes) {
    client = ApiClient(basePath: 'http://moments.test/api')..client = MockClient(_handle);
  }

  final Map<String, (int, Object?)> routes;
  final requests = <String>[];
  late final ApiClient client;

  Future<http.Response> _handle(http.Request request) async {
    final route = '${request.method} ${request.url.path.replaceFirst('/api', '')}';
    requests.add(route);
    final (status, body) = routes[route] ?? (404, {'message': 'Cannot ${request.method} ${request.url.path}'});
    return http.Response(jsonEncode(body), status, headers: {'content-type': 'application/json; charset=utf-8'});
  }

  VideoMomentsRepository get repository => VideoMomentsRepository(FacesApi(client));
}

Map<String, Object?> _face(String id, {String? personId}) => {
  'id': id,
  'boundingBoxX1': 0,
  'boundingBoxY1': 0,
  'boundingBoxX2': 10,
  'boundingBoxY2': 10,
  'imageWidth': 100,
  'imageHeight': 100,
  'person': personId == null
      ? null
      : {
          'id': personId,
          'name': 'Alex',
          'birthDate': null,
          'thumbnailPath': '',
          'isHidden': false,
          'isFavorite': false,
          'updatedAt': '2026-01-01T00:00:00.000Z',
        },
};

/// A player that records what the moments row asks of it.
class _FakePlayer extends VideoPlayerNotifier {
  final calls = <String>[];

  @override
  void seekTo(Duration position) {
    calls.add('seek ${position.inMilliseconds}');
    state = state.copyWith(position: position);
  }

  @override
  Future<void> pause() async {
    calls.add('pause');
    state = state.copyWith(status: VideoPlaybackStatus.paused);
  }

  void report(VideoPlayerState next) => state = next;
}

void main() {
  late Drift db;

  setUpAll(() async {
    TestWidgetsFlutterBinding.ensureInitialized();
    db = Drift(drift.DatabaseConnection(NativeDatabase.memory(), closeStreamsSynchronously: true));
    await StoreService.init(storeRepository: StoreRepository(db), listenUpdates: false);
    await Store.put(StoreKey.serverEndpoint, 'http://moments.test/api');
    // The player releases its wakelock when disposed; tests have no platform side to answer.
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger.setMockMessageHandler(
      'dev.flutter.pigeon.wakelock_plus_platform_interface.WakelockPlusApi.toggle',
      (_) async => const StandardMessageCodec().encodeMessage(<Object?>[null]),
    );
  });

  tearDownAll(() async => db.close());

  group('moments', () {
    test('merge across faces in time order', () {
      final merged = mergeMoments([
        [_moment('a', 8.5), _moment('a', 33.5)],
        [_moment('b', 31.5)],
      ]);
      expect(merged.map((m) => m.key), ['a:8.5', 'b:31.5', 'a:33.5']);
    });

    test('star one moment: the best view the detector was surest of', () {
      final moments = [
        _moment('a', 8.5, score: 0.8, isBest: true),
        _moment('b', 31.5, score: 0.9, isBest: true),
        _moment('b', 33.5, score: 0.95),
      ];
      expect(starredMomentKey(moments), 'b:31.5');
      expect(starredMomentKey([_moment('a', 1)]), isNull);
    });

    test('times read as the player shows them', () {
      expect(formatMomentTime(0), '0:00');
      expect(formatMomentTime(9.9), '0:09');
      expect(formatMomentTime(65), '1:05');
      expect(formatMomentTime(3725.4), '1:02:05');
    });

    test('a position more than 2 s from the moment has left it', () {
      expect(hasLeftMoment(const Duration(milliseconds: 31700), 31.5), isFalse);
      expect(hasLeftMoment(const Duration(seconds: 40), 31.5), isTrue);
    });

    test('the box is the frame fractions of the picture it is drawn on', () {
      const painter = VideoFaceBoxPainter(VideoMomentBox(x1: 0.25, y1: 0.1, x2: 0.5, y2: 0.6));
      expect(painter.faceRect(const Size(400, 200)), const Rect.fromLTRB(100, 20, 200, 120));
    });
  });

  group('repository', () {
    test('groups a video’s faces by person, leaving unassigned faces out', () async {
      final server = _FakeFacesServer({
        'GET /faces': (
          200,
          [_face('f1', personId: 'p1'), _face('f2', personId: 'p1'), _face('f3', personId: 'p2'), _face('f4')],
        ),
      });
      expect(await server.repository.faceIdsByPerson('asset-1'), {
        'p1': ['f1', 'f2'],
        'p2': ['f3'],
      });
    });

    test('knows the server lists moments only when the route answers', () async {
      final supported = _FakeFacesServer({
        'GET /faces/f1/sightings': (200, {'sightings': []}),
      });
      expect(await supported.repository.supportsMoments('f1'), isTrue);
      expect(await _FakeFacesServer({}).repository.supportsMoments('f1'), isFalse);
    });

    test('lists every moment of the faces together, skipping a face it cannot read', () async {
      final server = _FakeFacesServer({
        'GET /faces/f1/sightings': (
          200,
          {
            'sightings': [_sighting(33.5), _sighting(8.5, isBest: true)],
          },
        ),
        'GET /faces/f2/sightings': (
          200,
          {
            'sightings': [_sighting(31.5)],
          },
        ),
        'GET /faces/f3/sightings': (500, {'message': 'boom'}),
      });
      final moments = await server.repository.moments(['f1', 'f2', 'f3']);
      expect(moments.map((m) => m.key), ['f1:8.5', 'f2:31.5', 'f1:33.5']);
      expect(moments.first.box, const VideoMomentBox(x1: 0.25, y1: 0.1, x2: 0.5, y2: 0.6));
    });

    test('cuts each crop by the time the server listed it at', () {
      expect(
        VideoMomentsRepository.thumbnailUrl(_moment('f1', 31.5)),
        'http://moments.test/api/faces/f1/sightings/thumbnail?time=31.5',
      );
    });

    test('shows no badges on a server without moments', () async {
      final server = _FakeFacesServer({
        'GET /faces': (200, [_face('f1', personId: 'p1')]),
      });
      final container = ProviderContainer(
        overrides: [videoMomentsRepositoryProvider.overrideWithValue(server.repository)],
      );
      addTearDown(container.dispose);
      expect(await container.read(videoFacesByPersonProvider('asset-1').future), isEmpty);
    });
  });

  group('in the asset viewer', () {
    final video = RemoteAssetFactory.create(id: 'video-1', type: AssetType.video);
    final photo = RemoteAssetFactory.create(id: 'photo-1');
    const alex = Person(id: 'p1', name: 'Alex');
    const bob = Person(id: 'p2', name: 'Bob');
    final badge = find.byKey(const ValueKey('video-moments-badge'));

    late _FakePlayer player;

    Future<ProviderContainer> pump(
      WidgetTester tester, {
      required RemoteAsset asset,
      Map<String, List<String>> faces = const {
        'p1': ['f1', 'f2'],
      },
      List<VideoMoment>? moments,
    }) async {
      player = _FakePlayer();
      final container = ProviderContainer(
        overrides: [
          videoFacesByPersonProvider.overrideWith((ref, _) async => faces),
          videoMomentsProvider.overrideWith(
            (ref, _) async =>
                moments ?? [_moment('f1', 8.5, isBest: true, score: 0.9), _moment('f2', 31.5, isBest: true)],
          ),
          videoPlayerProvider.overrideWith((ref, _) => player),
        ],
      );
      addTearDown(container.dispose);
      await tester.pumpWidget(
        localizedForTest(
          UncontrolledProviderScope(
            container: container,
            child: Builder(
              builder: (context) => MaterialApp(
                localizationsDelegates: context.localizationDelegates,
                supportedLocales: context.supportedLocales,
                locale: context.locale,
                home: Scaffold(
                  body: Column(
                    children: [
                      SizedBox(
                        height: 140,
                        child: Row(
                          children: withVideoMomentsBadges(
                            asset,
                            [alex, bob],
                            [
                              const SizedBox(width: 80, height: 96, child: Text('Alex')),
                              const SizedBox(width: 80, height: 96, child: Text('Bob')),
                            ],
                          ),
                        ),
                      ),
                      VideoPersonMoments(asset: asset),
                      SizedBox(
                        width: 400,
                        height: 200,
                        child: Stack(children: [VideoFaceBoxOverlay(assetId: asset.id)]),
                      ),
                    ],
                  ),
                ),
              ),
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
      return container;
    }

    testWidgets('puts a film badge on a video’s people who have a face in it', (tester) async {
      await pump(tester, asset: video);
      expect(badge, findsOneWidget);
    });

    testWidgets('puts no film badge on a photo', (tester) async {
      await pump(tester, asset: photo);
      expect(badge, findsNothing);
    });

    testWidgets('opens the person’s moments with one star, and closes them on a second tap', (tester) async {
      final container = await pump(tester, asset: video);

      await tester.tap(badge);
      await tester.pumpAndSettle();

      expect(container.read(videoPersonSelectionProvider), (assetId: 'video-1', personId: 'p1', name: 'Alex'));
      expect(find.byKey(const ValueKey('video-person-moments')), findsOneWidget);
      expect(find.byKey(const ValueKey('video-moment-f1:8.5')), findsOneWidget);
      expect(find.byKey(const ValueKey('video-moment-f2:31.5')), findsOneWidget);
      expect(find.byKey(const ValueKey('video-moment-best')), findsOneWidget);
      expect(find.text('0:08'), findsOneWidget);
      expect(find.text('0:31'), findsOneWidget);

      await tester.tap(badge);
      await tester.pumpAndSettle();
      expect(container.read(videoPersonSelectionProvider), isNull);
      expect(find.byKey(const ValueKey('video-person-moments')), findsNothing);
    });

    testWidgets('says so when no moment was recorded', (tester) async {
      await pump(tester, asset: video, moments: const []);
      await tester.tap(badge);
      await tester.pumpAndSettle();

      expect(find.text('video_person_sightings_none'.tr()), findsOneWidget);
    });

    testWidgets('pauses the video at a tapped moment and boxes the face, until it plays', (tester) async {
      final container = await pump(tester, asset: video);
      await tester.tap(badge);
      await tester.pumpAndSettle();

      await tester.tap(find.byKey(const ValueKey('video-moment-f2:31.5')));
      await tester.pumpAndSettle();

      expect(player.calls, ['seek 31500', 'pause']);
      expect(container.read(videoFaceBoxProvider)?.time, 31.5);
      expect(find.byKey(const ValueKey('video-face-box')), findsOneWidget);

      player.report(player.state.copyWith(status: VideoPlaybackStatus.playing));
      await tester.pumpAndSettle();
      expect(container.read(videoFaceBoxProvider), isNull);
      expect(find.byKey(const ValueKey('video-face-box')), findsNothing);
    });

    testWidgets('takes the box away when the video is scrubbed off the moment, or the row closes', (tester) async {
      final container = await pump(tester, asset: video);
      await tester.tap(badge);
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const ValueKey('video-moment-f2:31.5')));
      await tester.pumpAndSettle();

      player.report(player.state.copyWith(position: const Duration(milliseconds: 31800)));
      await tester.pumpAndSettle();
      expect(find.byKey(const ValueKey('video-face-box')), findsOneWidget);

      player.report(player.state.copyWith(position: const Duration(seconds: 50)));
      await tester.pumpAndSettle();
      expect(container.read(videoFaceBoxProvider), isNull);

      await tester.tap(find.byKey(const ValueKey('video-moment-f1:8.5')));
      await tester.pumpAndSettle();
      expect(find.byKey(const ValueKey('video-face-box')), findsOneWidget);
      await tester.tap(find.byIcon(Icons.close));
      await tester.pumpAndSettle();
      expect(find.byKey(const ValueKey('video-face-box')), findsNothing);
    });
  });
}
