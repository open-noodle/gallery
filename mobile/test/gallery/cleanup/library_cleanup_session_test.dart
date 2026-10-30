import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/gallery/cleanup/models/library_cleanup_marks.dart';
import 'package:immich_mobile/gallery/cleanup/models/library_cleanup_queue.dart';
import 'package:immich_mobile/gallery/cleanup/models/library_cleanup_session_state.dart';
import 'package:immich_mobile/gallery/cleanup/providers/library_cleanup.providers.dart';
import 'package:immich_mobile/gallery/cleanup/providers/library_cleanup_session.provider.dart';
import 'package:immich_mobile/gallery/cleanup/repositories/library_cleanup_marks_store.dart';

import 'cleanup_test_utils.dart';

// Slice 1, the rewind session. Given/When/Then, in the order of the spec's Behaviours list:
//
// Rewind load
//   Given 15 August with photos in 2022 and 2020, one already decided (kept: true)
//   When the session opens   Then it asks for the years, then each year (newest first); the decided photo is skipped and counted as done
// Session marks
//   When keep, favourite, trash, undo are made   Then the pending marks follow, and nothing at all is sent
//   When undo is called first                    Then nothing changes
//   When the grid cycles one photo and the deck marks another   Then both marks are there (deck and grid share one state)
// Apply and stop
//   Given more marks than fit one request   When applied and stopped   Then trash, favourite and keep ids are chunked at 1000 and no chunk has completeMonthDay
// Finish
//   When the day is finished   Then completeMonthDay is on the last chunk only
//   When "keep the rest" is chosen   Then every untouched photo is added to the keeps
// Skipped ids   When the server skips some   Then the result reports them
// Failed chunk  When the second request fails   Then the first stays applied, the rest stays pending, and the count says how many went through
// Trash confirmation
//   When a trashed photo is in a space    Then the caller is asked first; declining commits nothing and keeps every mark
//   When a trashed photo is from an external library   Then the caller is asked first, even with the trash on
//   When the trash is off                 Then the caller is always asked, and no undo is offered
//   When the lookup fails                 Then nothing is committed
//   When nothing needs confirming         Then it is not asked
// Undo of the trash   Then exactly the ids the server trashed are restored (a skipped one is not)
// Saved marks
//   When marks are made   Then they are saved for this user and day, and a new session restores them ("restoredMarks")
//   When a saved mark is for a photo no longer in the day   Then it is ignored
//   When applied or discarded   Then the saved copy is dropped

class DayServer {
  DayServer(this.byYear);

  /// Photos per year, as the server holds them (oldest first within a year).
  final Map<int, List<Map<String, Object?>>> byYear;

  /// Ids that are in a shared space.
  final Set<String> inSpaces = {};

  /// Ids from an external library.
  final Set<String> external = {};
  bool lookupFails = false;

  /// Zero-based index of the commit that fails with a 500, or -1.
  int failCommit = -1;

  /// Trash ids the server skips.
  final Set<String> skipTrash = {};
  final commits = <SeenRequest>[];

  FakeResponse? call(SeenRequest request) {
    final route = request.route;
    if (route == 'GET /cleanup/rewind/815') {
      final years = byYear.keys.toList()..sort((a, b) => b.compareTo(a));
      return FakeResponse({
        'years': [
          for (final year in years) {'year': year, 'count': byYear[year]!.length},
        ],
      });
    }
    final year = RegExp(r'^GET /cleanup/rewind/815/(\d+)$').firstMatch(route)?.group(1);
    if (year != null) {
      return FakeResponse({'assets': byYear[int.parse(year)]});
    }
    if (route == 'POST /cleanup/in-spaces') {
      if (lookupFails) {
        return const FakeResponse({'message': 'boom'}, 500);
      }
      final asked = ((request.body! as Map)['assetIds'] as List).cast<String>();
      return FakeResponse({
        'assetIds': asked.where(inSpaces.contains).toList(),
        'externalAssetIds': asked.where(external.contains).toList(),
      });
    }
    if (route == 'POST /cleanup/commit') {
      commits.add(request);
      if (commits.length - 1 == failCommit) {
        return const FakeResponse({'message': 'boom'}, 500);
      }
      final body = request.body! as Map;
      final trash = (body['trashIds'] as List).cast<String>();
      final skipped = trash.where(skipTrash.contains).toList();
      return FakeResponse(
        commitJson(
          trashed: trash.where((id) => !skipTrash.contains(id)).toList(),
          favorited: (body['favoriteIds'] as List).length,
          kept: (body['keepIds'] as List).length + (body['favoriteIds'] as List).length,
          skipped: [
            for (final id in skipped) {'id': id, 'reason': 'already_trashed'},
          ],
        ),
      );
    }
    if (route == 'POST /trash/restore/assets') {
      return FakeResponse({'count': ((request.body! as Map)['ids'] as List).length});
    }
    if (route == 'GET /cleanup/calendar') {
      return FakeResponse(calendarJson());
    }
    return null;
  }
}

Map<int, List<Map<String, Object?>>> twoYears({String? keptId}) => {
  2022: [
    for (final id in ['p1', 'p2']) assetJson(id, localDateTime: '2022-08-15T10:00:00.000Z'),
  ],
  2020: [
    for (final id in ['q1', 'q2', 'q3']) assetJson(id, kept: id == keptId, localDateTime: '2020-08-15T10:00:00.000Z'),
  ],
};

void main() {
  late Directory directory;

  setUpAll(initTestStore);

  setUp(() {
    directory = tempDirectory();
  });

  const rewind = LibraryCleanupSessionRequest.rewind(815);

  Future<(ProviderContainer, LibraryCleanupSessionNotifier, FakeCleanupServer)> open(
    DayServer day, {
    bool trashEnabled = true,
    ProviderContainer? container,
  }) async {
    final server = FakeCleanupServer(day.call);
    final c = container ?? cleanupContainer(server: server, directory: directory, trashEnabled: trashEnabled);
    c.listen(libraryCleanupSessionProvider(rewind), (_, _) {});
    final notifier = c.read(libraryCleanupSessionProvider(rewind).notifier);
    await notifier.settled();
    return (c, notifier, server);
  }

  LibraryCleanupSessionState stateOf(ProviderContainer c) => c.read(libraryCleanupSessionProvider(rewind));

  group('rewind load', () {
    test('asks for the years, then each year newest first, and skips what an earlier visit decided', () async {
      final day = DayServer(twoYears(keptId: 'q2'));

      final (container, _, server) = await open(day);

      expect(server.routes.first, 'GET /cleanup/rewind/815');
      expect(server.routes.skip(1), unorderedEquals(['GET /cleanup/rewind/815/2022', 'GET /cleanup/rewind/815/2020']));
      final state = stateOf(container);
      expect(state.isReady, isTrue);
      expect(state.assets.map((a) => a.id), ['p1', 'p2', 'q1', 'q3'], reason: '2022 first, q2 was kept already');
      expect(state.years.map((y) => [y.year, y.count, y.assets.map((a) => a.id).toList()]), [
        [
          2022,
          2,
          ['p1', 'p2'],
        ],
        [
          2020,
          3,
          ['q1', 'q3'],
        ],
      ]);
      expect(state.alreadyDone, 1);
      expect(state.decided, 1, reason: 'the progress counts the photo decided before');
      expect(state.total, 5);
    });

    test('a failing load is an error state that retry recovers from', () async {
      var failing = true;
      final day = DayServer(twoYears());
      final server = FakeCleanupServer((r) => failing ? const FakeResponse({'message': 'x'}, 500) : day.call(r));
      final container = cleanupContainer(server: server, directory: directory);
      container.listen(libraryCleanupSessionProvider(rewind), (_, _) {});
      final notifier = container.read(libraryCleanupSessionProvider(rewind).notifier);
      await notifier.ready;
      expect(stateOf(container).status, LibraryCleanupLoadStatus.error);

      failing = false;
      await notifier.retry();

      expect(stateOf(container).status, LibraryCleanupLoadStatus.ready);
      expect(stateOf(container).assets, hasLength(5));
    });
  });

  group('session marks', () {
    test('keep, favourite, trash and undo build the pending marks in order and send nothing', () async {
      final (container, notifier, server) = await open(DayServer(twoYears()));
      final loadRequests = server.requests.length;

      notifier
        ..keep('p1')
        ..favorite('p2')
        ..trash('q1');
      expect(stateOf(container).marks.entries.map((e) => '${e.key}:${e.value.name}'), [
        'p1:keep',
        'p2:favorite',
        'q1:trash',
      ]);
      expect(stateOf(container).pendingCount, 3);
      expect(stateOf(container).undecided.map((a) => a.id), ['q2', 'q3']);

      notifier.undo();
      expect(stateOf(container).marks.keys, ['p1', 'p2']);
      notifier
        ..undo()
        ..undo();
      expect(stateOf(container).marks, isEmpty);
      expect(stateOf(container).canUndo, isFalse);
      expect(server.requests, hasLength(loadRequests), reason: 'marking and undoing are local');
    });

    test('undo with nothing to undo changes nothing', () async {
      final (container, notifier, _) = await open(DayServer(twoYears()));

      notifier.undo();

      expect(stateOf(container).marks, isEmpty);
      expect(stateOf(container).canUndo, isFalse);
    });

    test('the grid and the deck share one set of marks', () async {
      final (container, notifier, _) = await open(DayServer(twoYears()));

      notifier.trash('p1'); // the deck
      notifier
        ..cycle('p2') // the grid: none to keep
        ..cycle('p2'); // keep to favourite

      expect(stateOf(container).marks, {'p1': LibraryCleanupMark.trash, 'p2': LibraryCleanupMark.favorite});
    });

    test('keep the rest of a year marks only its untouched photos, as one step', () async {
      final (container, notifier, _) = await open(DayServer(twoYears()));
      notifier.trash('q2');

      notifier.keepTheRest(year: 2020);

      expect(stateOf(container).marks, {
        'q2': LibraryCleanupMark.trash,
        'q1': LibraryCleanupMark.keep,
        'q3': LibraryCleanupMark.keep,
      });
      notifier.undo();
      expect(stateOf(container).marks.keys, ['q2']);
    });
  });

  group('applying', () {
    test('apply and stop chunks every list at 1000 ids and never sends completeMonthDay', () async {
      final ids2020 = [for (var i = 1; i <= 2400; i++) 'a$i'];
      final day = DayServer({
        2020: [for (final id in ids2020) assetJson(id)],
      });
      final (container, notifier, server) = await open(day);
      // 1100 to trash, 1050 favourites, 150 keeps, 100 untouched.
      notifier
        ..markMany(ids2020.sublist(0, 1100), LibraryCleanupMark.trash)
        ..markMany(ids2020.sublist(1100, 2150), LibraryCleanupMark.favorite)
        ..markMany(ids2020.sublist(2150, 2300), LibraryCleanupMark.keep);

      final result = await notifier.applyAndStop();

      expect(result.status, LibraryCleanupApplyStatus.applied);
      expect(day.commits, hasLength(2));
      List<String> list(int commit, String key) => ((day.commits[commit].body! as Map)[key] as List).cast<String>();
      expect(
        [
          for (final k in ['trashIds', 'favoriteIds', 'keepIds']) list(0, k).length,
        ],
        [1000, 1000, 150],
      );
      expect(
        [
          for (final k in ['trashIds', 'favoriteIds', 'keepIds']) list(1, k).length,
        ],
        [100, 50, 0],
      );
      for (final commit in day.commits) {
        expect((commit.body! as Map).containsKey('completeMonthDay'), isFalse);
        expect((commit.body! as Map)['queue'], 'rewind');
      }
      expect(result.chunksApplied, 2);
      expect(stateOf(container).marks, isEmpty);
      expect(stateOf(container).assets.map((a) => a.id), ids2020.sublist(2300), reason: 'the untouched stay');
      expect(server.routes.where((r) => r == 'GET /cleanup/calendar'), isEmpty, reason: 'the day is not finished');
    });

    test('apply and stop keeps what it applied counted as done', () async {
      final (container, notifier, _) = await open(DayServer(twoYears()));
      notifier
        ..keep('p1')
        ..favorite('p2')
        ..trash('q1');

      await notifier.applyAndStop();

      final state = stateOf(container);
      expect(state.assets.map((a) => a.id), ['q2', 'q3']);
      expect(state.alreadyDone, 2, reason: 'p1 and p2 are kept on the server now; q1 is gone');
      expect(state.total, 4);
    });

    test('finishing sends completeMonthDay on the last chunk only, then refreshes the calendar', () async {
      final ids2020 = [for (var i = 1; i <= 2100; i++) 'a$i'];
      final day = DayServer({
        2020: [for (final id in ids2020) assetJson(id)],
      });
      final (container, notifier, server) = await open(day);
      notifier.markMany(ids2020, LibraryCleanupMark.keep);
      container.listen(libraryCleanupSupportProvider, (_, _) {});
      await container.read(libraryCleanupSupportProvider.future);

      final result = await notifier.finishDay();
      await pumpEvents();

      expect(day.commits.map((c) => (c.body! as Map)['completeMonthDay']), [null, null, 815]);
      expect(result.dayCompleted, isTrue);
      expect(
        server.routes.where((r) => r == 'GET /cleanup/calendar'),
        hasLength(2),
        reason: 'the probe, then after the finish',
      );
    });

    test('finishing with nothing marked still sends the one request that completes the day', () async {
      final day = DayServer(twoYears());
      final (_, notifier, _) = await open(day);

      await notifier.finishDay();

      expect(day.commits, hasLength(1));
      final body = day.commits.single.body! as Map;
      expect([body['trashIds'], body['favoriteIds'], body['keepIds'], body['completeMonthDay']], [[], [], [], 815]);
    });

    test('keep the rest adds every untouched photo to the keeps and finishes the day', () async {
      final day = DayServer(twoYears());
      final (container, notifier, _) = await open(day);
      notifier
        ..trash('p1')
        ..keep('q2');

      await notifier.finishDay(keepTheRest: true);

      final body = day.commits.single.body! as Map;
      expect(body['trashIds'], ['p1']);
      expect(body['keepIds'], ['q2', 'p2', 'q1', 'q3'], reason: 'the keep mark, then every untouched id');
      expect(body['completeMonthDay'], 815);
      expect(stateOf(container).marks, isEmpty);
    });

    test('a queue has no day to finish', () async {
      final server = FakeCleanupServer((_) => FakeResponse(pageJson(['b1'])));
      final container = cleanupContainer(server: server, directory: directory);
      const blurry = LibraryCleanupSessionRequest.queue(LibraryCleanupQueue.blurry);
      container.listen(libraryCleanupSessionProvider(blurry), (_, _) {});

      expect(() => container.read(libraryCleanupSessionProvider(blurry).notifier).finishDay(), throwsStateError);
    });

    test('ids the server skipped are reported', () async {
      final day = DayServer(twoYears())..skipTrash.add('q1');
      final (_, notifier, _) = await open(day);
      notifier
        ..trash('q1')
        ..trash('q2');

      final result = await notifier.applyAndStop();

      expect(result.skipped.map((s) => [s.id, s.reason.toJson()]), [
        ['q1', 'already_trashed'],
      ]);
      expect(result.trashed, ['q2']);
    });

    test('a failed chunk keeps the rest pending and says how many were applied', () async {
      final ids = [for (var i = 1; i <= 1500; i++) 'a$i'];
      final day = DayServer({
        2020: [for (final id in ids) assetJson(id)],
      })..failCommit = 1;
      final (container, notifier, _) = await open(day);
      notifier.markMany(ids, LibraryCleanupMark.trash);

      final result = await notifier.finishDay();

      expect(result.status, LibraryCleanupApplyStatus.failed);
      expect(result.chunksApplied, 1);
      expect(result.chunksTotal, 2);
      expect(result.dayCompleted, isFalse);
      expect(result.error, isNotNull);
      final state = stateOf(container);
      expect(state.marks.keys, ids.sublist(1000), reason: 'chunk 1 is applied, chunk 2 is still pending');
      expect(state.assets.map((a) => a.id), ids.sublist(1000));
      expect(state.applying, isNull);

      // The retry sends only what is left, and now it is the last chunk, so it completes the day.
      day.failCommit = -1;
      day.commits.clear();
      final retry = await notifier.finishDay();
      expect(retry.status, LibraryCleanupApplyStatus.applied);
      expect(day.commits.single.body, containsPair('completeMonthDay', 815));
      expect((day.commits.single.body! as Map)['trashIds'] as List, hasLength(500));
    });
  });

  group('trash confirmation', () {
    test('a trashed photo that is in a shared space is confirmed first, and declining commits nothing', () async {
      final day = DayServer(twoYears())..inSpaces.add('q1');
      final (container, notifier, _) = await open(day);
      notifier
        ..trash('q1')
        ..trash('q2')
        ..keep('p1');
      LibraryCleanupTrashCheck? asked;

      final result = await notifier.applyAndStop(
        confirm: (check) async {
          asked = check;
          return false;
        },
      );

      expect(
        [asked!.trashCount, asked!.inSpacesCount, asked!.trashEnabled, asked!.needsConfirmation],
        [2, 1, true, true],
      );
      expect(result.status, LibraryCleanupApplyStatus.cancelled);
      expect(day.commits, isEmpty);
      expect(stateOf(container).marks, hasLength(3), reason: 'every mark intact');
    });

    test('confirming goes ahead with the commit', () async {
      final day = DayServer(twoYears())..inSpaces.add('q1');
      final (_, notifier, _) = await open(day);
      notifier.trash('q1');

      final result = await notifier.applyAndStop(confirm: (_) async => true);

      expect(result.status, LibraryCleanupApplyStatus.applied);
      expect(day.commits, hasLength(1));
    });

    test('with the trash off the caller is always asked, and no undo is offered', () async {
      final day = DayServer(twoYears());
      final (_, notifier, server) = await open(day, trashEnabled: false);
      notifier.trash('q1');
      LibraryCleanupTrashCheck? asked;

      final result = await notifier.applyAndStop(
        confirm: (check) async {
          asked = check;
          return true;
        },
      );

      expect([asked!.inSpacesCount, asked!.trashEnabled, asked!.needsConfirmation], [0, false, true]);
      expect(result.trashed, ['q1']);
      expect(result.trashUndoAvailable, isFalse);
      expect(await notifier.restoreTrashed(result), isEmpty);
      expect(server.routes, isNot(contains('POST /trash/restore/assets')));
    });

    test('a failing lookup commits nothing', () async {
      final day = DayServer(twoYears())..lookupFails = true;
      final (container, notifier, _) = await open(day);
      notifier.trash('q1');

      final result = await notifier.applyAndStop(confirm: (_) async => true);

      expect(result.status, LibraryCleanupApplyStatus.lookupFailed);
      expect(result.error, isNotNull);
      expect(day.commits, isEmpty);
      expect(stateOf(container).marks.keys, ['q1']);
    });

    test('a trashed photo from an external library is confirmed first, even with the trash on', () async {
      final day = DayServer(twoYears())..external.addAll(['q2', 'q3']);
      final (_, notifier, _) = await open(day);
      notifier
        ..trash('q1')
        ..trash('q2')
        ..trash('q3');
      LibraryCleanupTrashCheck? asked;

      final result = await notifier.applyAndStop(
        confirm: (check) async {
          asked = check;
          return false;
        },
      );

      expect(
        [asked!.trashCount, asked!.inSpacesCount, asked!.externalCount, asked!.needsConfirmation],
        [3, 0, 2, true],
      );
      expect(result.status, LibraryCleanupApplyStatus.cancelled);
      expect(day.commits, isEmpty);
    });

    test('nothing is asked when no trashed photo is in a space and the trash is on', () async {
      final day = DayServer(twoYears());
      final (_, notifier, _) = await open(day);
      notifier.trash('q1');
      var asked = false;

      final result = await notifier.applyAndStop(
        confirm: (_) async {
          asked = true;
          return true;
        },
      );

      expect(asked, isFalse);
      expect(result.status, LibraryCleanupApplyStatus.applied);
    });

    test('a commit with no trash does not even ask the server about spaces', () async {
      final day = DayServer(twoYears());
      final (_, notifier, server) = await open(day);
      notifier
        ..keep('q1')
        ..favorite('q2');

      await notifier.applyAndStop();

      expect(server.routes, isNot(contains('POST /cleanup/in-spaces')));
    });

    test('a confirmation that is needed but has no one to ask is a decline', () async {
      final day = DayServer(twoYears())..inSpaces.add('q1');
      final (_, notifier, _) = await open(day);
      notifier.trash('q1');

      final result = await notifier.applyAndStop();

      expect(result.status, LibraryCleanupApplyStatus.cancelled);
      expect(day.commits, isEmpty);
    });

    test('the lookup is chunked at 1000 ids, and both counts are summed across the chunks', () async {
      final ids = [for (var i = 1; i <= 1200; i++) 'a$i'];
      final day =
          DayServer({
              2020: [for (final id in ids) assetJson(id)],
            })
            ..inSpaces.addAll(['a3', 'a1003'])
            ..external.addAll(['a5', 'a6', 'a1100']);
      final (_, notifier, server) = await open(day);
      notifier.markMany(ids, LibraryCleanupMark.trash);
      LibraryCleanupTrashCheck? asked;

      await notifier.applyAndStop(
        confirm: (check) async {
          asked = check;
          return false;
        },
      );

      final lookups = server.requests.where((r) => r.route == 'POST /cleanup/in-spaces');
      expect(lookups.map((r) => ((r.body! as Map)['assetIds'] as List).length), [1000, 200]);
      expect([asked!.inSpacesCount, asked!.externalCount], [2, 3]);
    });
  });

  group('undo of the trash', () {
    test('restores exactly the ids the server trashed, and puts the photos back in the session', () async {
      final day = DayServer(twoYears())..skipTrash.add('q1');
      final (container, notifier, server) = await open(day);
      notifier
        ..trash('q1')
        ..trash('q2');
      final result = await notifier.applyAndStop();
      expect(result.trashUndoAvailable, isTrue);
      expect(stateOf(container).assets.map((a) => a.id), ['p1', 'p2', 'q3']);

      final restored = await notifier.restoreTrashed(result);

      expect(restored, ['q2']);
      final restore = server.requests.singleWhere((r) => r.route == 'POST /trash/restore/assets');
      expect(restore.body, {
        'ids': ['q2'],
      });
      expect(stateOf(container).assets.map((a) => a.id), ['p1', 'p2', 'q2', 'q3'], reason: 'back in its place');
    });
  });

  group('saved marks', () {
    String key() => LibraryCleanupMarksStore.rewindKey('user-1', 815);

    test('marks are saved as they are made and restored by a new session', () async {
      final day = DayServer(twoYears());
      final (first, notifier, _) = await open(day);
      notifier
        ..keep('p1')
        ..trash('q1')
        ..favorite('q2');
      await first.read(libraryCleanupMarksStoreProvider).flush();
      first.dispose();

      final (second, reopened, _) = await open(DayServer(twoYears()));

      final state = stateOf(second);
      expect(state.marks, {
        'p1': LibraryCleanupMark.keep,
        'q1': LibraryCleanupMark.trash,
        'q2': LibraryCleanupMark.favorite,
      });
      expect(state.restoredMarks, isTrue);
      expect(state.decided, 3);
      expect(state.canUndo, isTrue, reason: 'the undo steps came back too');
      reopened.undo();
      expect(stateOf(second).marks.keys, ['p1', 'q1']);
    });

    test('a session with no saved marks says nothing was restored', () async {
      final (container, _, _) = await open(DayServer(twoYears()));

      expect(stateOf(container).restoredMarks, isFalse);
    });

    test('marks for a photo no longer in the day are ignored', () async {
      final (first, notifier, _) = await open(DayServer(twoYears()));
      notifier
        ..keep('p1')
        ..trash('q1');
      await first.read(libraryCleanupMarksStoreProvider).flush();
      first.dispose();

      // q1 was trashed on another device meanwhile.
      final shrunk = twoYears()..[2020]!.removeWhere((a) => a['id'] == 'q1');
      final (second, _, _) = await open(DayServer(shrunk));

      expect(stateOf(second).marks, {'p1': LibraryCleanupMark.keep});
    });

    test('marks of another user or another day are not restored', () async {
      final (first, notifier, _) = await open(DayServer(twoYears()));
      notifier.keep('p1');
      await first.read(libraryCleanupMarksStoreProvider).flush();
      first.dispose();

      final server = FakeCleanupServer(DayServer(twoYears()).call);
      final other = cleanupContainer(
        server: server,
        directory: directory,
        overrides: [libraryCleanupUserIdProvider.overrideWithValue('user-2')],
      );
      final (c, _, _) = await open(DayServer(twoYears()), container: other);

      expect(stateOf(c).marks, isEmpty);
    });

    test('applied marks are dropped from the device', () async {
      final (container, notifier, _) = await open(DayServer(twoYears()));
      notifier.keep('p1');
      await container.read(libraryCleanupMarksStoreProvider).flush();
      expect(await container.read(libraryCleanupMarksStoreProvider).load(key()), isNotNull);

      await notifier.applyAndStop();
      await container.read(libraryCleanupMarksStoreProvider).flush();

      expect(await container.read(libraryCleanupMarksStoreProvider).load(key()), isNull);
    });

    test('discarded marks are dropped from the device', () async {
      final (container, notifier, _) = await open(DayServer(twoYears()));
      notifier.keep('p1');
      await container.read(libraryCleanupMarksStoreProvider).flush();

      notifier.discard();
      await container.read(libraryCleanupMarksStoreProvider).flush();

      expect(stateOf(container).marks, isEmpty);
      expect(await container.read(libraryCleanupMarksStoreProvider).load(key()), isNull);
    });

    test('marks left pending by a failed chunk stay saved', () async {
      final ids = [for (var i = 1; i <= 1100; i++) 'a$i'];
      final day = DayServer({
        2020: [for (final id in ids) assetJson(id)],
      })..failCommit = 1;
      final (container, notifier, _) = await open(day);
      notifier.markMany(ids, LibraryCleanupMark.keep);

      await notifier.applyAndStop();
      await container.read(libraryCleanupMarksStoreProvider).flush();

      final saved = await container.read(libraryCleanupMarksStoreProvider).load(key());
      expect(saved!.marks.keys, ids.sublist(1000));
    });
  });
}
