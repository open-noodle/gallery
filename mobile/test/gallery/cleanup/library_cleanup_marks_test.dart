import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/gallery/cleanup/models/library_cleanup_marks.dart';

// Slice 1, "Session marks" (specs/2026-10-29-mobile-library-cleanup-design.md).
//
// Given a session with no marks
//   When keep, favourite and trash are made in order   Then the marks hold them in that order
//   When undo is called after each                      Then the decisions come back off in reverse order
//   When undo is called with nothing to undo            Then nothing happens
//   When one decision marks many ("keep the rest")      Then one undo takes all of them back
//   When a photo is re-marked and undone                Then it returns to its earlier mark, not to none
//   When the grid taps a photo repeatedly               Then it cycles none, keep, favourite, trash, none
// Given marks that were applied
//   When they are settled                               Then they are gone and undo has nothing left
// Given marks saved as JSON
//   When read back                                      Then marks and undo history are the same
//   When the JSON is damaged                            Then the good entries survive and the rest are skipped
//   When retained for the photos still in the day       Then marks for other photos are dropped, with their undo steps

void main() {
  const keep = LibraryCleanupMark.keep;
  const favorite = LibraryCleanupMark.favorite;
  const trash = LibraryCleanupMark.trash;

  test('keep, favourite and trash build the marks in order, and undo takes them back in reverse', () {
    final book = LibraryCleanupMarkBook()
      ..mark('a', keep)
      ..mark('b', favorite)
      ..mark('c', trash);

    expect(book.marks.entries.map((e) => '${e.key}:${e.value.name}'), ['a:keep', 'b:favorite', 'c:trash']);
    expect(book.ids(trash), ['c']);
    expect(book.count(keep), 1);

    expect(book.undo(), isTrue);
    expect(book.marks.keys, ['a', 'b']);
    book.undo();
    expect(book.marks.keys, ['a']);
    book.undo();
    expect(book.isEmpty, isTrue);
    expect(book.canUndo, isFalse);
  });

  test('undo of the first action with nothing to undo is a no-op', () {
    final book = LibraryCleanupMarkBook();

    expect(book.undo(), isFalse);
    expect(book.isEmpty, isTrue);
  });

  test('marking many photos is one decision for undo', () {
    final book = LibraryCleanupMarkBook()
      ..mark('a', trash)
      ..markMany(['b', 'c', 'd'], keep);

    expect(book.length, 4);
    book.undo();
    expect(book.marks.keys, ['a']);
  });

  test('undoing a re-mark restores the earlier mark, not none', () {
    final book = LibraryCleanupMarkBook()
      ..mark('a', keep)
      ..mark('a', trash);

    expect(book['a'], trash);
    book.undo();
    expect(book['a'], keep);
  });

  test('the grid tap cycles none, keep, favourite, trash, none', () {
    final book = LibraryCleanupMarkBook();
    final seen = <LibraryCleanupMark?>[];
    for (var i = 0; i < 5; i++) {
      book.cycle('a');
      seen.add(book['a']);
    }

    expect(seen, [keep, favorite, trash, null, keep]);
  });

  test('settled marks are gone and take the undo steps with them', () {
    final book = LibraryCleanupMarkBook()
      ..mark('a', keep)
      ..mark('b', trash);

    book.settle(['a']);

    expect(book.marks.keys, ['b']);
    expect(book.canUndo, isFalse);
  });

  test('marks and undo steps survive a JSON round trip', () {
    final book = LibraryCleanupMarkBook()
      ..mark('a', keep)
      ..mark('a', favorite)
      ..mark('b', trash);

    final restored = LibraryCleanupMarkBook.fromJson(book.toJson());

    expect(restored.marks, book.marks);
    restored.undo();
    restored.undo();
    expect(restored.marks.keys, ['a']);
    expect(restored['a'], keep);
  });

  test('damaged saved marks lose only the damaged entries', () {
    final restored = LibraryCleanupMarkBook.fromJson({
      'marks': {'a': 'keep', 'b': 'nonsense', 'c': 'trash'},
      'history': [
        [
          ['a', null],
        ],
        'junk',
        [
          [7, 'keep'],
        ],
      ],
    });

    expect(restored.marks, {'a': keep, 'c': trash});
    expect(restored.canUndo, isTrue);
    expect(LibraryCleanupMarkBook.fromJson('not a map').isEmpty, isTrue);
  });

  test('marks for photos no longer in the day are dropped, with their undo steps', () {
    final book = LibraryCleanupMarkBook()
      ..mark('a', keep)
      ..mark('gone', trash);

    book.retainWhere((id) => id == 'a');

    expect(book.marks.keys, ['a']);
    expect(book.undo(), isTrue, reason: 'the undo step of "a" remains');
    expect(book.isEmpty, isTrue);
    expect(book.canUndo, isFalse, reason: 'the undo step of "gone" went with it');
  });
}
