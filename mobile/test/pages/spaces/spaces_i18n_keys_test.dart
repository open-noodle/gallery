import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

/// Guards every `'some_key'.t(...)` literal in the spaces feature against `i18n/en.json`.
///
/// Keys are plain strings here — nothing in Dart checks them, and `easy_localization` renders a
/// missing key as the raw key itself. So a typo, or a key that was renamed on the web side, shows
/// up in the UI as `space_album_unlink_title` rather than "Unlink album?" and nothing fails. That
/// is exactly how `space_album_unlink_title` shipped missing: referenced twice, defined nowhere.
///
/// Direction matters. This checks referenced ⊆ defined, never the reverse: a key defined in
/// en.json but not found here is perfectly normal (web uses it, or it is built at runtime from a
/// slug), and asserting the other way round would fail on those.
void main() {
  // Scoped to the directories this feature owns. Widening it to all of lib/ would be a much
  // bigger, noisier assertion about code this test has no business policing.
  const scannedDirs = ['lib/pages/library/spaces', 'lib/presentation/widgets/spaces'];

  // `'key'.t(` and `'key'.tr(`, the two call shapes used in these files. A key must be a bare
  // single-quoted literal to be caught — an interpolated key (`'$prefix_x'.t()`) is invisible
  // here by design, since its value is not knowable statically.
  final callPattern = RegExp(r"'([a-z0-9_]+)'\.tr?\(");

  test('every localisation key referenced in the spaces feature exists in en.json', () {
    final en = jsonDecode(File('../i18n/en.json').readAsStringSync()) as Map<String, dynamic>;

    final missing = <String, Set<String>>{};
    var scannedFiles = 0;

    for (final dir in scannedDirs) {
      final directory = Directory(dir);
      expect(directory.existsSync(), isTrue, reason: '$dir moved — update scannedDirs');

      for (final entity in directory.listSync(recursive: true)) {
        if (entity is! File || !entity.path.endsWith('.dart')) {
          continue;
        }
        scannedFiles++;

        for (final match in callPattern.allMatches(entity.readAsStringSync())) {
          final key = match.group(1)!;
          if (!en.containsKey(key)) {
            missing.putIfAbsent(key, () => <String>{}).add(entity.path);
          }
        }
      }
    }

    // A guard that silently scans nothing is worse than no guard: it passes forever.
    expect(scannedFiles, greaterThan(5), reason: 'scanned too few files — the pattern or the paths are wrong');

    expect(
      missing,
      isEmpty,
      reason:
          'these keys are used in the spaces UI but are not defined in i18n/en.json, so they '
          'render as the raw key: ${missing.entries.map((e) => '${e.key} (${e.value.join(', ')})').join('; ')}',
    );
  });

  // Proves the check above can actually fail — otherwise a broken regex or a bad path would make
  // it green regardless of what the source contains.
  test('the key pattern matches the call shape used in these files', () {
    final matches = callPattern.allMatches("Text('space_album_folder_new'.t(context: ctx))").toList();

    expect(matches, hasLength(1));
    expect(matches.single.group(1), 'space_album_folder_new');
    // And an interpolated key is deliberately NOT matched.
    expect(callPattern.allMatches(r"'$prefix_suffix'.t()"), isEmpty);
  });
}
