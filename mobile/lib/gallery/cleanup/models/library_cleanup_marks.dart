/// A decision on one photo. Nothing reaches the server until the user applies.
enum LibraryCleanupMark {
  keep,
  favorite,
  trash;

  static LibraryCleanupMark? fromName(Object? name) =>
      LibraryCleanupMark.values.where((mark) => mark.name == name).firstOrNull;
}

/// The local marks of one cleanup session, with a stack of undo steps. A step is one user decision (one photo, or
/// "keep the rest" over many) and records what each id was before, so undoing it puts every one back.
class LibraryCleanupMarkBook {
  LibraryCleanupMarkBook();

  final Map<String, LibraryCleanupMark> _marks = {};
  final List<List<MapEntry<String, LibraryCleanupMark?>>> _history = [];

  /// Marks in the order they were first made.
  Map<String, LibraryCleanupMark> get marks => Map.unmodifiable(_marks);

  bool get isEmpty => _marks.isEmpty;
  int get length => _marks.length;
  bool get canUndo => _history.isNotEmpty;

  LibraryCleanupMark? operator [](String id) => _marks[id];

  int count(LibraryCleanupMark mark) => _marks.values.where((m) => m == mark).length;

  List<String> ids(LibraryCleanupMark mark) => [
    for (final entry in _marks.entries)
      if (entry.value == mark) entry.key,
  ];

  void _set(Iterable<MapEntry<String, LibraryCleanupMark?>> changes) {
    final step = [for (final change in changes) MapEntry(change.key, _marks[change.key])];
    if (step.isEmpty) {
      return;
    }
    _history.add(step);
    _apply(changes);
  }

  void _apply(Iterable<MapEntry<String, LibraryCleanupMark?>> changes) {
    for (final MapEntry(:key, :value) in changes) {
      if (value == null) {
        _marks.remove(key);
      } else {
        _marks[key] = value;
      }
    }
  }

  void mark(String id, LibraryCleanupMark mark) => _set([MapEntry(id, mark)]);

  /// Marks every id as one undo step.
  void markMany(Iterable<String> ids, LibraryCleanupMark mark) => _set([for (final id in ids) MapEntry(id, mark)]);

  /// The grid's tap: none, keep, favourite, trash, none (the web grid's order).
  void cycle(String id) {
    const order = <LibraryCleanupMark?>[
      null,
      LibraryCleanupMark.keep,
      LibraryCleanupMark.favorite,
      LibraryCleanupMark.trash,
    ];
    _set([MapEntry(id, order[(order.indexOf(_marks[id]) + 1) % order.length])]);
  }

  /// Steps back one decision; with nothing to undo it does nothing.
  bool undo() {
    if (_history.isEmpty) {
      return false;
    }
    _apply(_history.removeLast());
    return true;
  }

  /// Forgets the marks and every undo step.
  void clear() {
    _marks.clear();
    _history.clear();
  }

  /// Drops the marks of [ids] after they were applied. Undo steps may point at them, so the history goes too.
  void settle(Iterable<String> ids) {
    ids.forEach(_marks.remove);
    _history.clear();
  }

  /// Keeps only the marks of ids [keep] accepts (marks for photos no longer in the day or queue are ignored).
  void retainWhere(bool Function(String id) keep) {
    _marks.removeWhere((id, _) => !keep(id));
    for (final step in _history) {
      step.removeWhere((entry) => !keep(entry.key));
    }
    _history.removeWhere((step) => step.isEmpty);
  }

  Map<String, Object?> toJson() => {
    'marks': {for (final entry in _marks.entries) entry.key: entry.value.name},
    'history': [
      for (final step in _history)
        [
          for (final entry in step) [entry.key, entry.value?.name],
        ],
    ],
  };

  /// Reads what [toJson] wrote. A malformed entry is skipped rather than failing the whole restore.
  static LibraryCleanupMarkBook fromJson(Object? json) {
    final book = LibraryCleanupMarkBook();
    if (json is! Map) {
      return book;
    }
    final marks = json['marks'];
    if (marks is Map) {
      for (final entry in marks.entries) {
        final mark = LibraryCleanupMark.fromName(entry.value);
        if (entry.key is String && mark != null) {
          book._marks[entry.key as String] = mark;
        }
      }
    }
    final history = json['history'];
    if (history is List) {
      for (final rawStep in history) {
        if (rawStep is! List) {
          continue;
        }
        final step = <MapEntry<String, LibraryCleanupMark?>>[];
        for (final rawEntry in rawStep) {
          if (rawEntry is List && rawEntry.length == 2 && rawEntry[0] is String) {
            step.add(MapEntry(rawEntry[0] as String, LibraryCleanupMark.fromName(rawEntry[1])));
          }
        }
        if (step.isNotEmpty) {
          book._history.add(step);
        }
      }
    }
    return book;
  }
}
