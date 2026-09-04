import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/domain/models/feature_message.model.dart';
import 'package:immich_mobile/domain/models/feature_message_gallery.model.dart';
import 'package:immich_mobile/utils/semver.dart';

/// Guards the fork-owned "What's new" batch and the seam it sits behind.
///
/// Nothing else fails when this goes wrong. A missing i18n key renders as the raw key inside the
/// dialog, an empty batch makes `FeatureMessageService.shouldShow()` permanently false, and a
/// release constant that slips at or below upstream's silently stops the dialog firing for
/// everyone who already saw a Gallery batch — none of which throws.
void main() {
  /// Upstream's own stamp (immich-29388). The Gallery release must stay strictly above it, or a
  /// rebase that adopted upstream's constant would go unnoticed.
  const upstreamRelease = SemVer(major: 3, minor: 0, patch: 0);

  Map<String, dynamic> locale(String code) =>
      jsonDecode(File('../i18n/$code.json').readAsStringSync()) as Map<String, dynamic>;

  test("the app shows the Gallery batch, not upstream's own", () {
    expect(featureMessageHighlights, same(galleryFeatureMessageHighlights));
    expect(featureMessageRelease, galleryFeatureMessageRelease);
  });

  test('the batch is non-empty, so the dialog can fire at all', () {
    expect(galleryFeatureMessageHighlights, isNotEmpty);
  });

  test('the Gallery release stays above upstream, so a rebase cannot silence the dialog', () {
    expect(
      galleryFeatureMessageRelease > upstreamRelease,
      isTrue,
      reason:
          'galleryFeatureMessageRelease ($galleryFeatureMessageRelease) must be > $upstreamRelease — '
          'shouldShow() is release > seenRelease, so a lower value never fails loudly, it just '
          'stops the dialog appearing.',
    );
  });

  test('every highlight key exists in en.json', () {
    final en = locale('en');
    for (final highlight in galleryFeatureMessageHighlights) {
      expect(en, contains(highlight.titleKey), reason: '${highlight.titleKey} would render as the raw key');
      expect(en, contains(highlight.bodyKey), reason: '${highlight.bodyKey} would render as the raw key');
    }
  });

  test('every highlight key is translated in all nine maintained locales', () {
    // CLAUDE.md: a user-facing string ships with de/fr/it/nl/pl/es/ru/zh_Hans/zh_Hant in the same
    // commit. A missing one here falls back to English rather than breaking, so only a test
    // catches it.
    const maintained = ['de', 'fr', 'it', 'nl', 'pl', 'es', 'ru', 'zh_Hans', 'zh_Hant'];
    final missing = <String>[];

    for (final code in maintained) {
      final translations = locale(code);
      for (final highlight in galleryFeatureMessageHighlights) {
        for (final key in [highlight.titleKey, highlight.bodyKey]) {
          if (!translations.containsKey(key)) missing.add('$code: $key');
        }
      }
    }

    expect(missing, isEmpty, reason: 'untranslated highlight strings: ${missing.join(', ')}');
  });
}
