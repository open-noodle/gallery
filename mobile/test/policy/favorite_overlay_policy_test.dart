// Static regression gate (#763): the mobile app must not write favorites through the owner-only
// bulk asset-update endpoint.
//
// Since #763, favorites are a per-user overlay (`asset_favorite`) rather than an owner-scoped
// column on the asset. A read-only space Viewer may favorite another member's asset, so the write
// has to go through `PUT /assets/favorites` (`AssetApiRepository.updateFavorite` ->
// `updateAssetFavorites`). The consolidated update path — `AssetService.update(...)` ->
// `AssetApiRepository.update(...)` -> `AssetBulkUpdateDto` -> `PUT /assets` — is owner-gated, so
// routing a favorite through it silently restores owner-only favoriting and breaks the Viewer case.
//
// Both consolidated signatures still declare an `isFavorite` parameter: they are upstream Immich
// shapes, kept as-is so rebases stay clean. Nothing passes it today — `AssetService.update` has no
// callers at all, so the path is dead for favorites — but it is exactly the wrong thing to reach
// for when wiring the heart icon to the consolidated action, which is what this gate stops.
//
// Two frozen inventories, not flat bans:
//
//   1. The CHOKE POINT. Every possible route to owner-only favoriting has to construct an
//      `AssetBulkUpdateDto` carrying `isFavorite`. Only two such sites may exist: the dead
//      consolidated `update`, and the deliberate `updateFavorite` fallback for fork servers
//      <= 5.2.0 that predate `PUT /assets/favorites` (see the comment at that call site).
//   2. The CALLER inventory. No `.update(...)` call may pass `isFavorite:` beyond the two internal
//      forwards inside `AssetService.update`'s own body. Weaker than (1) — it only sees
//      receiver-qualified calls, so a bare in-class `update(...)` would slip past it — but it names
//      the offending call site directly, which makes a failure faster to act on.
//
// This lives in the MOBILE suite on purpose. The server has an equivalent guard
// (`server/src/utils/favorite-grep-gate.spec.ts`), but CI gates the server unit job on `server/**`
// changes, so a mobile-only PR — precisely the shape of the regression being guarded — would never
// run it. The `mobile-unit-tests` job is gated on `mobile/**`, so this one always runs when it
// matters.
//
// Matching operates on code only: comments and string-literal contents are blanked before
// scanning, and `isFavorite:` must appear at the TOP level of an argument list, so nested
// companion/DTO constructors (`batch.update(table, Companion(isFavorite: ...))`) never match.
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

/// Blanks comments and string-literal contents, preserving length so offsets and line numbers still
/// line up with the original source.
String stripNonCode(String source) {
  final out = source.split('');

  void blank(int from, int to) {
    for (var i = from; i < to && i < source.length; i++) {
      if (source[i] != '\n') {
        out[i] = ' ';
      }
    }
  }

  var i = 0;
  while (i < source.length) {
    if (source.startsWith('//', i)) {
      final end = source.indexOf('\n', i);
      final stop = end == -1 ? source.length : end;
      blank(i, stop);
      i = stop;
      continue;
    }

    // Block comments nest in Dart.
    if (source.startsWith('/*', i)) {
      final start = i;
      var depth = 0;
      while (i < source.length) {
        if (source.startsWith('/*', i)) {
          depth++;
          i += 2;
        } else if (source.startsWith('*/', i)) {
          depth--;
          i += 2;
          if (depth == 0) {
            break;
          }
        } else {
          i++;
        }
      }
      blank(start, i);
      continue;
    }

    // String literal, optionally raw (`r'...'`).
    var quoteStart = i;
    var isRaw = false;
    if (source[i] == 'r' && i + 1 < source.length && (source[i + 1] == '"' || source[i + 1] == "'")) {
      isRaw = true;
      quoteStart = i + 1;
    }
    final quoteChar = source[quoteStart];
    if (quoteChar == '"' || quoteChar == "'") {
      final triple = quoteChar * 3;
      final isTriple = source.startsWith(triple, quoteStart);
      final delimiter = isTriple ? triple : quoteChar;
      var j = quoteStart + delimiter.length;
      while (j < source.length) {
        if (!isRaw && source[j] == r'\') {
          j += 2;
          continue;
        }
        if (source.startsWith(delimiter, j)) {
          j += delimiter.length;
          break;
        }
        if (!isTriple && source[j] == '\n') {
          break; // Unterminated single-line string — bail rather than swallow the rest of the file.
        }
        j++;
      }
      blank(quoteStart + delimiter.length, j - delimiter.length);
      i = j;
      continue;
    }

    i++;
  }

  return out.join();
}

/// Index of the bracket matching the one at [open], over code with strings/comments already blanked.
int matchingBracket(String code, int open) {
  var depth = 0;
  for (var i = open; i < code.length; i++) {
    switch (code[i]) {
      case '(':
      case '[':
      case '{':
        depth++;
      case ')':
      case ']':
      case '}':
        depth--;
        if (depth == 0) {
          return i;
        }
    }
  }
  return -1;
}

int _depthAt(String code, int from, int to) {
  var depth = 0;
  for (var i = from; i < to; i++) {
    switch (code[i]) {
      case '(':
      case '[':
      case '{':
        depth++;
      case ')':
      case ']':
      case '}':
        depth--;
    }
  }
  return depth;
}

/// True when `isFavorite:` appears as a top-level named argument inside the brackets.
bool hasTopLevelIsFavorite(String code, int open, int close) {
  for (final match in RegExp(r'isFavorite\s*:').allMatches(code, open + 1)) {
    if (match.start >= close) {
      return false;
    }
    if (_depthAt(code, open + 1, match.start) == 0) {
      return true;
    }
  }
  return false;
}

/// Name of the class member enclosing [offset]. Matches `<return type> <name>(` at EXACTLY
/// two-space indentation — where class members sit in this codebase — which is enough to key an
/// inventory entry stably against unrelated line churn. `(?=\S)` is what keeps it from matching
/// deeper-indented statements such as `if (`.
final _memberDeclaration = RegExp(r'^  (?=\S)[\w<>,?\[\]$.]+(?: +[\w<>,?\[\]$.]+)*? +([\w$]+) *\(', multiLine: true);

String enclosingMember(String code, int offset) {
  var name = '<top level>';
  for (final match in _memberDeclaration.allMatches(code)) {
    if (match.start >= offset) {
      break;
    }
    name = match.group(1)!;
  }
  return name;
}

bool isGenerated(String path) =>
    path.endsWith('.g.dart') ||
    path.endsWith('.drift.dart') ||
    path.endsWith('.steps.dart') ||
    path.endsWith('.freezed.dart') ||
    path.contains('/generated/');

List<({String path, String code})> loadLibSources() {
  final files = Directory('lib')
      .listSync(recursive: true)
      .whereType<File>()
      .where((file) => file.path.endsWith('.dart') && !isGenerated(file.path))
      .toList();

  // A gate that silently inspects nothing (wrong cwd, moved directory) would pass forever.
  expect(files.length, greaterThan(100), reason: 'expected to scan the mobile lib/ tree');

  return [for (final file in files) (path: file.path, code: stripNonCode(file.readAsStringSync()))]
    ..sort((a, b) => a.path.compareTo(b.path));
}

/// Every `<callee>(` whose top-level arguments include `isFavorite:`, keyed by enclosing member.
List<String> findIsFavoriteCallSites(RegExp callee) {
  final found = <String>[];
  for (final source in loadLibSources()) {
    for (final match in callee.allMatches(source.code)) {
      final open = match.end - 1;
      final close = matchingBracket(source.code, open);
      if (close == -1 || !hasTopLevelIsFavorite(source.code, open, close)) {
        continue;
      }
      found.add('${source.path} -> ${enclosingMember(source.code, match.start)}() -> ${match.group(1)}');
    }
  }
  return found..sort();
}

void main() {
  const chokePointRemedy =
      'A new AssetBulkUpdateDto carrying isFavorite means a new route to the OWNER-ONLY bulk '
      'endpoint PUT /assets. Since #763 favorites are a per-user overlay (asset_favorite) that a '
      "read-only space Viewer may set on another member's asset, so the write must go through "
      'PUT /assets/favorites — call AssetApiRepository.updateFavorite (which already handles the '
      'pre-5.2.0 server fallback) instead of adding another bulk-update site.';

  const callerRemedy =
      'Something now passes isFavorite into the consolidated update path (AssetService.update -> '
      'AssetApiRepository.update), which writes favorites through the OWNER-ONLY bulk endpoint '
      'PUT /assets. Since #763 favorites are a per-user overlay (asset_favorite) that a read-only '
      "space Viewer may set on another member's asset: call AssetService.updateFavorite / "
      'AssetApiRepository.updateFavorite instead. If you deliberately removed the dead isFavorite '
      'parameter from the consolidated path, update the expected list in this test to match.';

  test('only the two sanctioned sites send isFavorite to the owner-only bulk endpoint (#763)', () {
    // AssetApiRepository.update  — the dead consolidated path (no caller passes isFavorite).
    // AssetApiRepository.updateFavorite — deliberate fallback for fork servers <= 5.2.0.
    const expected = <String>[
      'lib/repositories/asset_api.repository.dart -> update() -> AssetBulkUpdateDto',
      'lib/repositories/asset_api.repository.dart -> updateFavorite() -> AssetBulkUpdateDto',
    ];

    expect(findIsFavoriteCallSites(RegExp(r'\b(AssetBulkUpdateDto)\s*\(')), expected, reason: chokePointRemedy);
  });

  test('no caller passes isFavorite into the consolidated asset update path (#763)', () {
    // Both entries are AssetService.update forwarding to its own collaborators — the dead path
    // itself. Any third entry is a new caller.
    const expected = <String>[
      'lib/domain/services/asset.service.dart -> update() -> _apiRepository.update',
      'lib/domain/services/asset.service.dart -> update() -> _remoteRepository.update',
    ];

    expect(
      findIsFavoriteCallSites(RegExp(r'\b([A-Za-z0-9_$]+(?:\.[A-Za-z0-9_$]+)*\.update)\s*\(')),
      expected,
      reason: callerRemedy,
    );
  });
}
