import 'package:easy_localization/easy_localization.dart' show StringTranslateExtension;
import 'package:flutter/widgets.dart';
import 'package:immich_mobile/domain/models/memory.model.dart';
import 'package:intl/intl.dart';
import 'package:intl/message_format.dart';

/// Titles for generated memory cards.
///
/// Memory rules deliberately persist no prose: a memory is generated once by the server and then
/// read for days by clients in whatever language each viewer picked, so any English baked in at
/// generation time is stuck (#1045). Each rule instead stores structured facts in `data.context`,
/// and the card title is assembled here, in the viewer's language, every render. This mirrors
/// `web/src/lib/utils/memory-card.ts` — keep the two in step when a rule is added.
///
/// Memories generated before that change still carry `title`, so that wins when present: an old
/// card keeps reading as it did rather than falling back to the generic label.

typedef Translate = String Function(String key, {Map<String, Object>? args});

/// Explicit maps, not `'memory_season_$key'` — a constructed key is invisible to a grep for
/// unused strings, and an unknown key would surface to the user verbatim.
const _seasonKeys = {
  'spring': 'memory_season_spring',
  'summer': 'memory_season_summer',
  'autumn': 'memory_season_autumn',
  'winter': 'memory_season_winter',
};

const _themeKeys = {
  'sunset': 'memory_theme_sunset',
  'beach': 'memory_theme_beach',
  'food': 'memory_theme_food',
  'mountains': 'memory_theme_mountains',
  'snow': 'memory_theme_snow',
  'city_night': 'memory_theme_city_night',
};

String? _string(Map<String, dynamic> context, String key) {
  final value = context[key];
  return value is String ? value : null;
}

int? _int(Map<String, dynamic> context, String key) {
  final value = context[key];
  return value is int ? value : (value is num ? value.toInt() : null);
}

/// "September 2025" / "septembre 2025". Built with [DateFormat] rather than an i18n message, so
/// month names come from the locale data instead of needing twelve translated strings.
String _monthYear(String locale, int year, int month) => DateFormat.yMMMM(locale).format(DateTime(year, month));

String? _monthYearOf(Map<String, dynamic> context, String locale) {
  final year = _int(context, 'year');
  final month = _int(context, 'month');
  return year == null || month == null ? null : _monthYear(locale, year, month);
}

/// Years go through as strings: as numbers, ICU would group them into "2,023".
String _yearLabel(int year) => year.toString();

String? _buildTitle(String ruleId, Map<String, dynamic> context, Translate translate, String locale) {
  switch (ruleId) {
    case 'birthday':
      final name = _string(context, 'personName');
      return name == null ? null : translate('memory_birthday_title', args: {'name': name});

    case 'recent_trip':
      final location = _string(context, 'placeLabel');
      return location == null ? null : translate('memory_recent_trip_title', args: {'location': location});

    case 'trip_anniversary':
      final location = _string(context, 'placeLabel');
      return location == null ? null : translate('memory_trip_anniversary_title', args: {'location': location});

    // The whole title is the month and year, so there is no message to wrap it in.
    case 'month_recap':
      return _monthYearOf(context, locale);

    case 'favorites_throwback':
      final monthYear = _monthYearOf(context, locale);
      return monthYear == null ? null : translate('memory_favorites_throwback_title', args: {'monthYear': monthYear});

    case 'video_moments':
      final monthYear = _monthYearOf(context, locale);
      return monthYear == null ? null : translate('memory_video_moments_title', args: {'monthYear': monthYear});

    case 'season_recap':
      final seasonKey = _seasonKeys[_string(context, 'season')];
      final seasonYear = _int(context, 'seasonYear');
      return seasonKey == null || seasonYear == null
          ? null
          : translate(
              'memory_season_recap_title',
              args: {'season': translate(seasonKey), 'year': _yearLabel(seasonYear)},
            );

    case 'themed':
      final themeKey = _themeKeys[_string(context, 'theme')];
      final year = _int(context, 'year');
      return themeKey == null || year == null
          ? null
          : translate('memory_themed_title', args: {'theme': translate(themeKey), 'year': _yearLabel(year)});

    case 'on_this_day_place':
      final city = _string(context, 'city');
      return city == null ? null : translate('memory_on_this_day_place_title', args: {'city': city});

    case 'people_together':
      final nameA = _string(context, 'personAName');
      final nameB = _string(context, 'personBName');
      return nameA == null || nameB == null
          ? null
          : translate('memory_people_together_title', args: {'nameA': nameA, 'nameB': nameB});

    case 'person_throwback':
      final name = _string(context, 'personName');
      return name == null ? null : translate('memory_person_throwback_title', args: {'name': name});

    default:
      return null;
  }
}

/// The localized title for [memory]. Pure, so it can be tested without a widget tree; use
/// [getMemoryTitle] from UI code.
String buildMemoryTitle(Memory memory, {required Translate translate, required String locale, DateTime? now}) {
  final serverTitle = memory.data.title;
  if (serverTitle != null && serverTitle.isNotEmpty) {
    return serverTitle;
  }

  if (memory.type == MemoryTypeEnum.onThisDay) {
    final year = memory.data.year;
    if (year != null) {
      final yearsAgo = (now ?? DateTime.now()).year - year;
      return translate('years_ago', args: {'years': yearsAgo});
    }
  }

  final ruleId = memory.data.ruleId;
  final context = memory.data.raw['context'];
  if (ruleId != null && context is Map<String, dynamic>) {
    final title = _buildTitle(ruleId, context, translate, locale);
    if (title != null) {
      return title;
    }
  }

  return translate('memory');
}

/// What the deleted `String.t()` extension did (immich-30672 removed it in favour of a typed
/// accessor): look the key up, then run the result through ICU MessageFormat when there are args.
/// The typed accessor cannot be used here because the key is chosen at runtime from the rule id.
String _translate(BuildContext context, String key, {Map<String, Object>? args}) {
  try {
    final message = key.tr(context: context);
    return args == null ? message : MessageFormat(message, locale: Intl.defaultLocale ?? 'en').format(args);
  } catch (_) {
    // Same fallback the deleted helper had: with no EasyLocalization ancestor (widget tests, an
    // early frame) return the key rather than throwing out of a title getter.
    return key;
  }
}

String getMemoryTitle(BuildContext context, Memory memory) => buildMemoryTitle(
  memory,
  translate: (key, {args}) => _translate(context, key, args: args),
  // Same source easy_localization's own MessageFormat call uses, so dates and messages agree.
  locale: Intl.defaultLocale ?? 'en',
);
