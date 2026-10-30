import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/gallery/cleanup/models/library_cleanup_marks.dart';
import 'package:immich_mobile/gallery/cleanup/models/library_cleanup_queue.dart';
import 'package:immich_mobile/gallery/cleanup/repositories/library_cleanup_marks_store.dart';

import 'cleanup_test_utils.dart';

// Slice 1, "Saved marks" (the file side; the session side is in library_cleanup_session_test.dart).
//
// Given marks saved for user 1's 15 August         When read back   Then they are the same
// Given marks for another user, day or queue       When read        Then they are not mixed in
// Given an emptied book                            When saved       Then the file is removed (applied or discarded)
// Given an unreadable file                         When read        Then there are no marks, and no error
// Given two saves in quick succession              When flushed     Then the later one is what is on disk

void main() {
  late LibraryCleanupMarksStore store;
  late Directory directory;

  setUp(() {
    directory = tempDirectory();
    store = LibraryCleanupMarksStore(() async => directory);
  });

  List<File> files() {
    final folder = Directory('${directory.path}/library_cleanup');
    return folder.existsSync() ? folder.listSync().whereType<File>().toList() : [];
  }

  LibraryCleanupMarkBook book(Map<String, LibraryCleanupMark> marks) {
    final result = LibraryCleanupMarkBook();
    marks.forEach(result.mark);
    return result;
  }

  test('marks are saved per user and day, and read back as they were', () async {
    final key = LibraryCleanupMarksStore.rewindKey('user-1', 815);
    await store.save(key, book({'a': LibraryCleanupMark.trash, 'b': LibraryCleanupMark.favorite}));

    final loaded = await store.load(key);

    expect(loaded!.marks, {'a': LibraryCleanupMark.trash, 'b': LibraryCleanupMark.favorite});
    expect(loaded.canUndo, isTrue);
  });

  test('another user, another day and a queue each have their own marks', () async {
    final mine = LibraryCleanupMarksStore.rewindKey('user-1', 815);
    await store.save(mine, book({'a': LibraryCleanupMark.keep}));
    await store.save(LibraryCleanupMarksStore.rewindKey('user-2', 815), book({'b': LibraryCleanupMark.keep}));
    await store.save(LibraryCleanupMarksStore.rewindKey('user-1', 816), book({'c': LibraryCleanupMark.keep}));
    await store.save(
      LibraryCleanupMarksStore.queueKey('user-1', LibraryCleanupQueue.blurry),
      book({'d': LibraryCleanupMark.keep}),
    );

    expect((await store.load(mine))!.marks.keys, ['a']);
    expect((await store.load(LibraryCleanupMarksStore.queueKey('user-1', LibraryCleanupQueue.blurry)))!.marks.keys, [
      'd',
    ]);
    expect(await store.load(LibraryCleanupMarksStore.rewindKey('user-3', 815)), isNull);
  });

  test('saving an empty book removes the file', () async {
    final key = LibraryCleanupMarksStore.rewindKey('user-1', 815);
    await store.save(key, book({'a': LibraryCleanupMark.keep}));
    expect(await store.load(key), isNotNull);

    await store.save(key, LibraryCleanupMarkBook());

    expect(await store.load(key), isNull);
    expect(files(), isEmpty, reason: 'no empty file is left behind');
  });

  test('an unreadable file is no marks', () async {
    final directory = tempDirectory();
    final broken = LibraryCleanupMarksStore(() async => directory);
    final key = LibraryCleanupMarksStore.rewindKey('user-1', 815);
    await broken.save(key, book({'a': LibraryCleanupMark.keep}));
    final file = Directory('${directory.path}/library_cleanup').listSync().whereType<File>().single;
    file.writeAsStringSync('{ not json');

    expect(await broken.load(key), isNull);
  });

  test('the last save wins even when saves are asked back to back', () async {
    final key = LibraryCleanupMarksStore.rewindKey('user-1', 815);
    final marks = LibraryCleanupMarkBook();
    for (var i = 1; i <= 30; i++) {
      marks.mark('a$i', LibraryCleanupMark.keep);
      // Not awaited, as the session saves after every mark.
      // ignore: unawaited_futures
      store.save(key, marks);
    }
    await store.flush();

    expect((await store.load(key))!.length, 30);
  });
}
