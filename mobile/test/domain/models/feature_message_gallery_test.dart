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

  /// ROLLING: upstream (immich-31038) made [FeatureHighlight] an enum, so a batch entry is a
  /// member rather than a const construction and the copy lives in the enum's title/body switch.
  /// The keys are still derivable from the member name — the same convention that switch follows —
  /// so the i18n guarantees below are unchanged.
  String snake(String camel) => camel.replaceAllMapped(RegExp('[A-Z]'), (m) => '_${m[0]!.toLowerCase()}');
  String titleKey(FeatureHighlight h) => '${snake(h.name)}_title';
  String bodyKey(FeatureHighlight h) => '${snake(h.name)}_body';

  test("the app shows the Gallery batch, not upstream's own", () {
    // Reverting `visibleFeatureMessageHighlights` to `FeatureHighlight.values` would re-show
    // upstream's six Immich 3.0 cards; every visible entry must come from the fork's batch.
    for (final highlight in visibleFeatureMessageHighlights) {
      expect(galleryFeatureMessageHighlights, contains(highlight));
    }
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
      expect(en, contains(titleKey(highlight)), reason: '${titleKey(highlight)} would render as the raw key');
      expect(en, contains(bodyKey(highlight)), reason: '${bodyKey(highlight)} would render as the raw key');
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
        for (final key in [titleKey(highlight), bodyKey(highlight)]) {
          if (!translations.containsKey(key)) {
            missing.add('$code: $key');
          }
        }
      }
    }

    expect(missing, isEmpty, reason: 'untranslated highlight strings: ${missing.join(', ')}');
  });
}
