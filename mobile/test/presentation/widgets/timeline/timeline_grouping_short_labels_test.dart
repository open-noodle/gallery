import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/generated/codegen_loader.g.dart';

/// The compact app-bar grouping chip (#1030) paints one glyph instead of the whole mode name.
///
/// The obvious implementation — slice the first character off the full label — is wrong: in
/// zh_Hans the labels are "按年" / "按月" and in zh_Hant "依年份" / "依月份", so Years and Months
/// would both render as 按 / 依 and the chip would stop telling you anything. The initials are
/// therefore hand-translated per locale, which means they need a guard of their own.
void main() {
  const shortKeys = ['timeline_grouping_years_short', 'timeline_grouping_months_short', 'timeline_grouping_all_short'];

  // The locales the fork hand-maintains (AGENTS.md); the rest fall back to English.
  const maintainedLocales = ['en', 'de', 'fr', 'it', 'nl', 'pl', 'es', 'ru', 'zh_Hans', 'zh_Hant'];

  group('compact grouping chip initials', () {
    for (final locale in maintainedLocales) {
      test('$locale defines all three and keeps them distinguishable', () {
        final translations = CodegenLoader.mapLocales[locale];
        expect(translations, isNotNull, reason: '$locale is missing from the generated loader');

        final values = <String>[];
        for (final key in shortKeys) {
          final value = translations![key];
          expect(value, isA<String>(), reason: '$locale is missing $key');
          expect((value as String).trim(), isNotEmpty, reason: '$locale has a blank $key');
          values.add(value);
        }

        expect(
          values.toSet(),
          hasLength(values.length),
          reason: '$locale reuses a glyph across modes ($values) — the chip could not tell them apart',
        );

        // The chip is 48px wide; anything longer than a glyph or two gets scaled down to
        // illegibility rather than truncated, which is worse than picking a different letter.
        for (var i = 0; i < values.length; i++) {
          expect(
            values[i].length,
            lessThanOrEqualTo(2),
            reason: '$locale ${shortKeys[i]} is "${values[i]}" — too long for the compact chip',
          );
        }
      });
    }
  });
}
