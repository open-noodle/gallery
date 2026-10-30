import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:immich_mobile/gallery/cleanup/models/library_cleanup_marks.dart';
import 'package:immich_mobile/gallery/cleanup/models/library_cleanup_queue.dart';
import 'package:immich_mobile/gallery/cleanup/models/library_cleanup_series.dart';

/// Pending marks saved on the device as they are made, so closing the app or a crash loses nothing. One small JSON
/// file per user and day (rewind) or per user and queue, in a fork-owned folder of the app's documents directory.
/// Not the app `Store`: a long queue's pile of marks can be large.
class LibraryCleanupMarksStore {
  LibraryCleanupMarksStore(this._directory);

  final Future<Directory> Function() _directory;

  // Writes for one key run in the order they were asked, so a late small save can never overtake a bigger one.
  Future<void> _tail = Future<void>.value();

  static String rewindKey(String userId, int monthDay) => 'rewind-$userId-$monthDay';

  static String queueKey(String userId, LibraryCleanupQueue queue) => '${queue.slug}-$userId';

  Future<File> _file(String key) async {
    final directory = Directory('${(await _directory()).path}${Platform.pathSeparator}library_cleanup');
    return File('${directory.path}${Platform.pathSeparator}${key.replaceAll(RegExp(r'[^A-Za-z0-9_.-]'), '_')}.json');
  }

  Future<Object?> _read(String key) async {
    try {
      final file = await _file(key);
      return file.existsSync() ? jsonDecode(await file.readAsString()) : null;
    } catch (_) {
      return null;
    }
  }

  /// The saved marks, or null when there are none or the file cannot be read.
  Future<LibraryCleanupMarkBook?> load(String key) async {
    final json = await _read(key);
    if (json == null) {
      return null;
    }
    final book = LibraryCleanupMarkBook.fromJson(json);
    return book.isEmpty ? null : book;
  }

  /// A series queue's saved marks (Bursts, Duplicates), or null when there are none.
  Future<LibraryCleanupSeriesBook?> loadSeries(String key) async {
    final json = await _read(key);
    if (json == null) {
      return null;
    }
    final book = LibraryCleanupSeriesBook.fromJson(json);
    return book.isEmpty ? null : book;
  }

  /// Saves the book (and removes the file when it is empty). Failures are swallowed: saving is a safety net and
  /// must never break deciding.
  Future<void> save(String key, LibraryCleanupMarkBook book) => _write(key, book.isEmpty ? null : book.toJson());

  Future<void> saveSeries(String key, LibraryCleanupSeriesBook book) =>
      _write(key, book.isEmpty ? null : book.toJson());

  Future<void> _write(String key, Map<String, Object?>? value) {
    final json = value == null ? null : jsonEncode(value);
    return _tail = _tail.then((_) async {
      try {
        final file = await _file(key);
        if (json == null) {
          if (file.existsSync()) {
            await file.delete();
          }
          return;
        }
        await file.parent.create(recursive: true);
        final temp = File('${file.path}.tmp');
        await temp.writeAsString(json, flush: true);
        await temp.rename(file.path);
      } catch (_) {}
    });
  }

  Future<void> delete(String key) => save(key, LibraryCleanupMarkBook());

  /// Completes when every save asked so far has been written.
  Future<void> flush() => _tail;
}
