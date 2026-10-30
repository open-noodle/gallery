import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/gallery/cleanup/cleanup_prefs.dart';
import 'package:immich_mobile/gallery/cleanup/models/library_cleanup_calendar.dart';
import 'package:immich_mobile/gallery/cleanup/models/library_cleanup_filters.dart';
import 'package:immich_mobile/gallery/cleanup/models/library_cleanup_marks.dart';
import 'package:immich_mobile/gallery/cleanup/models/library_cleanup_queue.dart';
import 'package:immich_mobile/gallery/cleanup/models/library_cleanup_session_state.dart';
import 'package:immich_mobile/gallery/cleanup/providers/library_cleanup.providers.dart';
import 'package:immich_mobile/gallery/cleanup/providers/library_cleanup_session.provider.dart';
import 'package:openapi/api.dart';

import 'cleanup_test_utils.dart';

// Slice 1, the generic queue session, "Queue pager", "Queue marks" and "Next day".
//
// Queue pager
//   When the queue opens                         Then the first page is asked for with the queue's filters, as the web sends them
//   When ten undecided cards remain              Then the next page is asked for with the previous nextCursor
//   When the cursor is null                      Then nothing more is asked
//   When filters change                          Then paging starts again with exactly those filters, the marks stay, and they are remembered
// Queue marks
//   When photos are marked and undone            Then nothing is sent
//   When applied                                 Then trash/favourite/keep ids go in chunks of 1000, queue = the queue, never completeMonthDay
//   When a chunk fails                           Then the rest stay pending and the result says how many went through
//   When the trash is undone                     Then exactly the ids the server trashed are restored
//   When the app is killed with marks pending    Then a new session restores them, reading on to the page they sit in
// Next day
//   Given the calendar   When asked for the day after 28 Oct   Then the next unreviewed day with photos, wrapping at year end; none when all done

/// A queue of [total] photos `b1…bN`, served [size] at a time with cursors `c1`, `c2`, …
class QueueServer {
  QueueServer(this.total);

  final int total;
  final pages = <SeenRequest>[];
  final commits = <SeenRequest>[];
  int failCommit = -1;
  final Set<String> skipTrash = {};

  FakeResponse? call(SeenRequest request) {
    final route = request.route;
    if (route.startsWith('GET /cleanup/queues/')) {
      pages.add(request);
      final size = int.parse(request.query['limit']!.single);
      final cursor = request.query['cursor']?.single;
      final start = cursor == null ? 0 : int.parse(cursor.substring(1)) * size;
      final end = (start + size).clamp(0, total);
      return FakeResponse(
        pageJson([for (var i = start + 1; i <= end; i++) 'b$i'], nextCursor: end >= total ? null : 'c${end ~/ size}'),
      );
    }
    if (route == 'POST /cleanup/in-spaces') {
      return const FakeResponse({'assetIds': <String>[]});
    }
    if (route == 'POST /cleanup/commit') {
      commits.add(request);
      if (commits.length - 1 == failCommit) {
        return const FakeResponse({'message': 'boom'}, 500);
      }
      final body = request.body! as Map;
      final trash = (body['trashIds'] as List).cast<String>();
      return FakeResponse(
        commitJson(
          trashed: trash.where((id) => !skipTrash.contains(id)).toList(),
          favorited: (body['favoriteIds'] as List).length,
          kept: (body['keepIds'] as List).length,
          skipped: [
            for (final id in trash.where(skipTrash.contains)) {'id': id, 'reason': 'already_trashed'},
          ],
        ),
      );
    }
    if (route == 'POST /trash/restore/assets') {
      return FakeResponse({'count': ((request.body! as Map)['ids'] as List).length});
    }
    return null;
  }
}

void main() {
  late Directory directory;

  setUpAll(initTestStore);

  setUp(() {
    directory = tempDirectory();
  });

  Future<(ProviderContainer, LibraryCleanupSessionNotifier, FakeCleanupServer)> open(
    QueueServer queue, {
    LibraryCleanupQueue which = LibraryCleanupQueue.blurry,
    int pageSize = 4,
    ProviderContainer? reuse,
    bool trashEnabled = true,
  }) async {
    final server = FakeCleanupServer(queue.call);
    final container =
        reuse ??
        cleanupContainer(
          server: server,
          directory: directory,
          trashEnabled: trashEnabled,
          overrides: [libraryCleanupPageSizeProvider.overrideWithValue(pageSize)],
        );
    final request = LibraryCleanupSessionRequest.queue(which);
    container.listen(libraryCleanupSessionProvider(request), (_, _) {});
    final notifier = container.read(libraryCleanupSessionProvider(request).notifier);
    await notifier.settled();
    return (container, notifier, server);
  }

  LibraryCleanupSessionState stateOf(ProviderContainer c, [LibraryCleanupQueue q = LibraryCleanupQueue.blurry]) =>
      c.read(libraryCleanupSessionProvider(LibraryCleanupSessionRequest.queue(q)));

  group('queue pager', () {
    test('the first page is asked for with the web\'s Blurry filters', () async {
      final queue = QueueServer(30);

      final (container, _, _) = await open(queue);

      expect(queue.pages.first.route, 'GET /cleanup/queues/blurry');
      expect(queue.pages.first.query, {
        'limit': ['4'],
        'strictness': ['balanced'],
        'reason': ['all'],
        'hideFaces': ['true'],
      });
      expect(stateOf(container).isReady, isTrue);
    });

    test('Space hogs sends its type and minimum size, Screenshots and Bursts send no filters', () async {
      final hogs = QueueServer(3);
      await open(hogs, which: LibraryCleanupQueue.spaceHogs);
      expect(hogs.pages.single.query, {
        'limit': ['4'],
        'type': ['video'],
        'minSize': ['104857600'],
      });

      for (final which in [LibraryCleanupQueue.screenshots, LibraryCleanupQueue.bursts]) {
        final queue = QueueServer(3);
        await open(queue, which: which);
        expect(queue.pages.single.query, {
          'limit': ['4'],
        }, reason: which.name);
        expect(queue.pages.single.path, '/api/cleanup/queues/${which.slug}');
      }
    });

    test('the next page is asked for, with the previous cursor, when ten undecided cards remain', () async {
      final queue = QueueServer(40);
      // Twelve loaded (three pages of four): more than ten remain, so no more is asked for yet.
      final (container, notifier, _) = await open(queue, pageSize: 6);
      expect(stateOf(container).assets, hasLength(12));
      expect(queue.pages, hasLength(2));

      // Two cards decided: ten remain, so the next page comes.
      notifier
        ..keep('b1')
        ..keep('b2');
      await notifier.settled();

      expect(queue.pages, hasLength(3));
      expect(queue.pages.last.query['cursor'], ['c2']);
      expect(stateOf(container).assets, hasLength(18));
    });

    test('short pages chain until more than ten cards are loaded', () async {
      final queue = QueueServer(40);

      final (container, _, _) = await open(queue, pageSize: 4);

      expect(queue.pages, hasLength(3), reason: '4 and 8 cards are not enough, 12 are');
      expect(stateOf(container).assets, hasLength(12));
    });

    test('a session opened again after a rebuild loads afresh', () async {
      final queue = QueueServer(30);
      final (container, _, _) = await open(queue, pageSize: 6);
      container.invalidate(
        libraryCleanupSessionProvider(const LibraryCleanupSessionRequest.queue(LibraryCleanupQueue.blurry)),
      );
      await pumpEvents();
      await container
          .read(
            libraryCleanupSessionProvider(
              const LibraryCleanupSessionRequest.queue(LibraryCleanupQueue.blurry),
            ).notifier,
          )
          .settled();

      expect(stateOf(container).isReady, isTrue);
      expect(stateOf(container).assets, hasLength(12));
      expect(queue.pages.where((r) => !r.query.containsKey('cursor')), hasLength(2), reason: 'the first page twice');
    });

    test('marks do not ask for more while many cards remain', () async {
      final queue = QueueServer(100);
      final (_, notifier, _) = await open(queue, pageSize: 6);
      final pages = queue.pages.length;

      notifier.keep('b1');
      await notifier.settled();

      expect(queue.pages, hasLength(pages));
    });

    test('paging stops at a null cursor', () async {
      final queue = QueueServer(9);

      final (container, notifier, _) = await open(queue, pageSize: 4);
      notifier.keep('b1');
      await notifier.settled();

      expect(stateOf(container).hasMore, isFalse);
      expect(stateOf(container).assets, hasLength(9));
      expect(queue.pages, hasLength(3), reason: '4 + 4 + 1, then done');
      await notifier.loadMore();
      expect(queue.pages, hasLength(3));
    });

    test('a failing later page is reported and the loaded cards stay', () async {
      final queue = QueueServer(30);
      var failing = false;
      final server = FakeCleanupServer(
        (r) => failing && r.query.containsKey('cursor') ? const FakeResponse({'m': 'x'}, 500) : queue.call(r),
      );
      final container = cleanupContainer(
        server: server,
        directory: directory,
        overrides: [libraryCleanupPageSizeProvider.overrideWithValue(6)],
      );
      const request = LibraryCleanupSessionRequest.queue(LibraryCleanupQueue.blurry);
      container.listen(libraryCleanupSessionProvider(request), (_, _) {});
      final notifier = container.read(libraryCleanupSessionProvider(request).notifier);
      await notifier.ready;
      failing = true;
      await notifier.loadMore();

      final state = stateOf(container);
      expect(state.pagingError, isNotNull);
      expect(state.status, LibraryCleanupLoadStatus.ready);
      expect(state.assets, hasLength(6));
    });

    test(
      'changed filters page again from the start with exactly those filters, keep the marks and are remembered',
      () async {
        final queue = QueueServer(30);
        final (container, notifier, _) = await open(queue, pageSize: 20);
        notifier.trash('b1');
        queue.pages.clear();

        await notifier.setFilters(
          LibraryCleanupFilters.defaults(
            LibraryCleanupQueue.blurry,
          ).copyWith(strictness: CleanupStrictness.strict, reason: CleanupBlurReason.dark, hideFaces: false),
        );

        expect(queue.pages.single.query, {
          'limit': ['20'],
          'strictness': ['strict'],
          'reason': ['dark'],
          'hideFaces': ['false'],
        });
        expect(stateOf(container).marks, {'b1': LibraryCleanupMark.trash});
        final prefs = container.read(libraryCleanupPrefsProvider);
        expect(prefs.filtersFor(LibraryCleanupQueue.blurry).reason, CleanupBlurReason.dark);
      },
    );

    test('a queue opens with the filters remembered for it', () async {
      final queue = QueueServer(3);
      final server = FakeCleanupServer(queue.call);
      final container = cleanupContainer(
        server: server,
        directory: directory,
        overrides: [libraryCleanupPageSizeProvider.overrideWithValue(4)],
      );
      container
          .read(libraryCleanupPrefsProvider.notifier)
          .setFilters(
            LibraryCleanupFilters.defaults(
              LibraryCleanupQueue.spaceHogs,
            ).copyWith(type: CleanupAssetTypeFilter.all, minSize: 524288000),
          );

      await open(queue, which: LibraryCleanupQueue.spaceHogs, reuse: container);

      expect(queue.pages.single.query['type'], ['all']);
      expect(queue.pages.single.query['minSize'], ['524288000']);
    });
  });

  group('queue marks', () {
    test('marks and local undo send nothing', () async {
      final queue = QueueServer(8);
      final (container, notifier, server) = await open(queue);
      final requests = server.requests.length;

      notifier
        ..trash('b1')
        ..favorite('b2')
        ..keep('b3')
        ..undo();

      expect(stateOf(container).marks.keys, ['b1', 'b2']);
      expect(server.requests, hasLength(requests));
    });

    test('apply sends the queue\'s ids in chunks of 1000, under its own queue, and never completeMonthDay', () async {
      final queue = QueueServer(2300);
      final (container, notifier, _) = await open(queue, pageSize: 2300);
      final ids = stateOf(container).assets.map((a) => a.id).toList();
      notifier
        ..markMany(ids.sublist(0, 1200), LibraryCleanupMark.trash)
        ..markMany(ids.sublist(1200, 1300), LibraryCleanupMark.favorite)
        ..markMany(ids.sublist(1300, 2300), LibraryCleanupMark.keep);

      final result = await notifier.applyAndStop();

      expect(result.status, LibraryCleanupApplyStatus.applied);
      expect(queue.commits, hasLength(2));
      for (final commit in queue.commits) {
        final body = commit.body! as Map;
        expect(body['queue'], 'blurry');
        expect(body.containsKey('completeMonthDay'), isFalse);
      }
      List<String> list(int commit, String key) => ((queue.commits[commit].body! as Map)[key] as List).cast<String>();
      expect(list(0, 'trashIds'), ids.sublist(0, 1000));
      expect(list(1, 'trashIds'), ids.sublist(1000, 1200));
      expect(list(0, 'favoriteIds'), ids.sublist(1200, 1300));
      expect(list(0, 'keepIds'), ids.sublist(1300, 2300));
      expect(stateOf(container).assets, isEmpty, reason: 'applied photos leave the queue');
    });

    test('applied photos leave the queue and the rest are still there', () async {
      final queue = QueueServer(8);
      final (container, notifier, _) = await open(queue, pageSize: 8);
      notifier
        ..trash('b1')
        ..keep('b2');

      await notifier.applyAndStop();

      expect(stateOf(container).assets.map((a) => a.id), ['b3', 'b4', 'b5', 'b6', 'b7', 'b8']);
    });

    test('a failed chunk leaves the rest pending and reports how many went through', () async {
      final queue = QueueServer(1500)..failCommit = 1;
      final (container, notifier, _) = await open(queue, pageSize: 1500);
      final ids = stateOf(container).assets.map((a) => a.id).toList();
      notifier.markMany(ids, LibraryCleanupMark.trash);

      final result = await notifier.applyAndStop();

      expect(result.status, LibraryCleanupApplyStatus.failed);
      expect([result.chunksApplied, result.chunksTotal], [1, 2]);
      expect(result.trashed, ids.sublist(0, 1000));
      expect(stateOf(container).marks.keys, ids.sublist(1000));
    });

    test('the trash undo restores exactly the ids the server trashed', () async {
      final queue = QueueServer(8)..skipTrash.add('b2');
      final (container, notifier, server) = await open(queue, pageSize: 8);
      notifier
        ..trash('b1')
        ..trash('b2')
        ..trash('b3');
      final result = await notifier.applyAndStop();

      final restored = await notifier.restoreTrashed(result);

      expect(restored, ['b1', 'b3']);
      expect(server.requests.last.body, {
        'ids': ['b1', 'b3'],
      });
      expect(stateOf(container).assets.map((a) => a.id).take(3), [
        'b1',
        'b3',
        'b4',
      ], reason: 'b2 was skipped, not trashed');
    });

    test('with the trash off there is nothing to restore', () async {
      final queue = QueueServer(4);
      final (_, notifier, server) = await open(queue, trashEnabled: false);
      notifier.trash('b1');

      final result = await notifier.applyAndStop(confirm: (_) async => true);

      expect(result.trashUndoAvailable, isFalse);
      expect(await notifier.restoreTrashed(result), isEmpty);
      expect(server.routes, isNot(contains('POST /trash/restore/assets')));
    });

    test('killing the app with pending marks restores them, reading on to the page they sit in', () async {
      final first = await open(QueueServer(30), pageSize: 6);
      // b20 is on the fourth page; the first session got there by deciding the cards in front of it.
      first.$2
        ..keep('b1')
        ..trash('b2');
      await first.$2.settled();
      final deep = stateOf(first.$1).assets.last.id;
      first.$2.favorite(deep);
      await first.$1.read(libraryCleanupMarksStoreProvider).flush();
      first.$1.dispose();

      final (container, _, server) = await open(QueueServer(30), pageSize: 6);

      final state = stateOf(container);
      expect(state.marks.keys, containsAll(['b1', 'b2', deep]));
      expect(state.restoredMarks, isTrue);
      expect(state.assets.map((a) => a.id), contains(deep), reason: 'the page holding it was read');
      expect(server.requests, isNotEmpty);
    });

    test('a saved mark for a photo no longer in the queue is ignored', () async {
      final first = await open(QueueServer(10), pageSize: 10);
      first.$2
        ..keep('b1')
        ..trash('b9');
      await first.$1.read(libraryCleanupMarksStoreProvider).flush();
      first.$1.dispose();

      // b9 left the queue meanwhile: the server has 8.
      final (container, _, _) = await open(QueueServer(8), pageSize: 10);

      expect(stateOf(container).marks.keys, ['b1']);
    });
  });

  group('next day', () {
    CleanupCalendarDayDto day(int monthDay, int count, {bool reviewed = false}) => CleanupCalendarDayDto(
      monthDay: monthDay,
      assetCount: count,
      reviewedAt: reviewed ? '2026-01-01T00:00:00.000Z' : null,
    );

    final days = [
      day(101, 3, reviewed: true),
      day(615, 2),
      day(1028, 5),
      day(1029, 0),
      day(1030, 4, reviewed: true),
      day(1115, 1),
      day(1224, 6),
    ];

    test('is the next unreviewed day with photos after the one given', () {
      expect(libraryCleanupNextUnreviewedDay(days, 1028), 1115);
      expect(libraryCleanupNextUnreviewedDay(days, 1115), 1224);
    });

    test('wraps at the end of the year', () {
      expect(libraryCleanupNextUnreviewedDay(days, 1224), 615);
    });

    test('skips empty and reviewed days, and the day itself', () {
      expect(libraryCleanupNextUnreviewedDay(days, 615), 1028);
      expect(libraryCleanupNextUnreviewedDay([day(615, 2)], 615), isNull);
    });

    test('is none when every day is reviewed or empty', () {
      expect(libraryCleanupNextUnreviewedDay([day(101, 3, reviewed: true), day(102, 0)], 101), isNull);
      expect(libraryCleanupNextUnreviewedDay(const [], 101), isNull);
    });
  });
}
