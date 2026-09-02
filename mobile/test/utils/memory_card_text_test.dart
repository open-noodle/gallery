import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/domain/models/memory.model.dart';
import 'package:immich_mobile/utils/memory_card_text.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'package:intl/message_format.dart';

/// Formats the *real* shared `en.json` message, so a key this file names but `en.json` does not
/// have — or a placeholder no memory rule actually stores — fails here instead of reaching a
/// user as a raw key.
final Map<String, dynamic> _en = json.decode(File('../i18n/en.json').readAsStringSync()) as Map<String, dynamic>;

String _translate(String key, {Map<String, Object>? args}) {
  final message = _en[key];
  if (message is! String) {
    throw StateError('en.json has no key "$key"');
  }
  return MessageFormat(message, locale: 'en').format(args ?? const {});
}

DriftMemory _ruleMemory(String ruleId, Map<String, dynamic> context, {String? title}) => DriftMemory(
  id: 'memory-id',
  createdAt: DateTime.utc(2026, 4, 23),
  updatedAt: DateTime.utc(2026, 4, 23),
  ownerId: 'owner-id',
  type: MemoryTypeEnum.rule,
  data: MemoryData({'ruleId': ruleId, 'context': context, if (title != null) 'title': title}),
  isSaved: false,
  memoryAt: DateTime.utc(2026, 4, 23),
  assets: const [],
);

final _now = DateTime.utc(2026, 4, 23);

String _titleOf(String ruleId, Map<String, dynamic> context) =>
    buildMemoryTitle(_ruleMemory(ruleId, context), translate: _translate, locale: 'en', now: _now);

void main() {
  // main.dart does the same before the app renders; DateFormat.yMMMM(locale) throws without it.
  setUpAll(initializeDateFormatting);

  group('buildMemoryTitle', () {
    test('prefers a title the server baked in, so memories generated before this change still read', () {
      final memory = _ruleMemory('month_recap', {'year': 2025, 'month': 9}, title: 'September 2025');
      expect(buildMemoryTitle(memory, translate: _translate, locale: 'en', now: _now), 'September 2025');
    });

    test('localizes an on-this-day memory from its year', () {
      final memory = DriftMemory(
        id: 'memory-id',
        createdAt: DateTime.utc(2026, 4, 23),
        updatedAt: DateTime.utc(2026, 4, 23),
        ownerId: 'owner-id',
        type: MemoryTypeEnum.onThisDay,
        data: const MemoryData({'year': 2024}),
        isSaved: false,
        memoryAt: DateTime.utc(2026, 4, 23),
        assets: const [],
      );
      expect(buildMemoryTitle(memory, translate: _translate, locale: 'en', now: _now), '2 years ago');
    });

    test('builds a month recap title as a locale-formatted month and year', () {
      expect(_titleOf('month_recap', {'year': 2025, 'month': 9, 'count': 12}), 'September 2025');
    });

    test('builds a season recap title from the season key, not a baked English label', () {
      expect(_titleOf('season_recap', {'seasonYear': 2025, 'season': 'autumn', 'count': 20}), 'Autumn 2025');
    });

    test('builds a trip anniversary title from the place label', () {
      expect(
        _titleOf('trip_anniversary', {'placeLabel': 'Munich, Germany', 'yearsAgo': 2}),
        'Your trip to Munich, Germany',
      );
    });

    test('builds a recent trip title from the place label', () {
      expect(_titleOf('recent_trip', {'placeLabel': 'Paris, France'}), 'Recent trip to Paris, France');
    });

    test('builds a birthday title from the person name', () {
      expect(_titleOf('birthday', {'personName': 'Alice', 'variant': 'across_years'}), 'Happy birthday, Alice');
    });

    test('builds a favorites throwback title from the month and year', () {
      expect(
        _titleOf('favorites_throwback', {'year': 2023, 'month': 7, 'count': 6}),
        'Favorite moments from July 2023',
      );
    });

    test('builds an on-this-day-in-a-place title from the city', () {
      expect(
        _titleOf('on_this_day_place', {
          'city': 'Lisbon',
          'count': 11,
          'years': [2021, 2023],
        }),
        'On this day in Lisbon',
      );
    });

    test('builds a people-together title from both names', () {
      expect(_titleOf('people_together', {'personAName': 'Anna', 'personBName': 'Ben', 'count': 6}), 'Anna & Ben');
    });

    test('builds a video moments title from the month and year', () {
      expect(_titleOf('video_moments', {'year': 2023, 'month': 7, 'count': 9}), 'Video moments from July 2023');
    });

    test('builds a themed title from the theme key, not a baked English label', () {
      expect(_titleOf('themed', {'year': 2023, 'theme': 'sunset', 'count': 18}), 'Sunsets from 2023');
    });

    test('builds a person throwback title from the person name', () {
      expect(
        _titleOf('person_throwback', {'personName': 'Anna', 'count': 23, 'month': 8, 'year': 2023}),
        'Times with Anna',
      );
    });

    test('falls back to the generic memory label for a rule it has no title for', () {
      expect(_titleOf('some_future_rule', const {}), 'Memory');
    });

    test('falls back to the generic memory label when the context is missing the fields it needs', () {
      expect(_titleOf('season_recap', const {'count': 20}), 'Memory');
    });
  });
}
