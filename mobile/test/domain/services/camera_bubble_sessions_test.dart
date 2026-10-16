import 'package:drift/drift.dart' as drift;
import 'package:drift/native.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/data/db/main/database.dart';
import 'package:immich_mobile/domain/services/camera_bubble.service.dart';
import 'package:immich_mobile/domain/services/store.service.dart';
import 'package:immich_mobile/entities/store.entity.dart';
import 'package:immich_mobile/infrastructure/repositories/store.repository.dart';

const _album = CameraBubbleTarget(kind: CameraBubbleTargetKind.album, id: 'album-1', name: 'Trip | "2026"');
const _space = CameraBubbleTarget(kind: CameraBubbleTargetKind.space, id: 'space-1', name: 'Family');

/// Windows are stamped with `DateTime.now()` at millisecond precision; step past each edge.
Future<DateTime> _tick() async {
  await Future<void>.delayed(const Duration(milliseconds: 5));
  final now = DateTime.now();
  await Future<void>.delayed(const Duration(milliseconds: 5));
  return now;
}

void main() {
  late Drift db;

  setUpAll(() async {
    TestWidgetsFlutterBinding.ensureInitialized();
    db = Drift(drift.DatabaseConnection(NativeDatabase.memory(), closeStreamsSynchronously: true));
    await StoreService.init(storeRepository: StoreRepository(db));
  });

  tearDown(() => Store.clear());

  tearDownAll(() => db.close());

  group('CameraBubbleTarget', () {
    test('round-trips through its encoding, including names with delimiters', () {
      expect(CameraBubbleTarget.decode(_album.encoded), _album);
      expect(CameraBubbleTarget.decode(_space.encoded), _space);
    });

    test('decodes garbage and unknown kinds to null', () {
      expect(CameraBubbleTarget.decode('not json'), isNull);
      expect(CameraBubbleTarget.decode('["planet","id","name"]'), isNull);
      expect(CameraBubbleTarget.decode('["album","id"]'), isNull);
    });
  });

  group('CameraBubbleSessions', () {
    test('routes nothing before anything is selected', () async {
      expect(CameraBubbleSessions.targetsForCaptureTime(DateTime.now()), isEmpty);
    });

    test('routes a photo by the selection at capture time, not at upload time', () async {
      final beforeAny = await _tick();
      await CameraBubbleSessions.replaceSelection([_album]);
      final duringAlbum = await _tick();
      await CameraBubbleSessions.replaceSelection([_album, _space]);
      final duringBoth = await _tick();

      // The current selection is album + space; a photo taken earlier still gets only the album.
      expect(CameraBubbleSessions.targetsForCaptureTime(beforeAny), isEmpty);
      expect(CameraBubbleSessions.targetsForCaptureTime(duringAlbum), [_album]);
      expect(CameraBubbleSessions.targetsForCaptureTime(duringBoth), [_album, _space]);
      expect(CameraBubbleSessions.currentSelection(), [_album, _space]);
    });

    test('clearing the selection stops routing, but keeps earlier photos routed', () async {
      await CameraBubbleSessions.replaceSelection([_space]);
      final duringSpace = await _tick();
      await CameraBubbleSessions.replaceSelection(const []);
      final afterClear = await _tick();

      expect(CameraBubbleSessions.targetsForCaptureTime(duringSpace), [_space]);
      expect(CameraBubbleSessions.targetsForCaptureTime(afterClear), isEmpty);
      expect(CameraBubbleSessions.currentSelection(), isEmpty);
    });
  });
}
