// Retained by the fork after immich-30672 deleted it upstream.
//
// Upstream migrated every one of its own call sites to the generated `context.t.<key>` accessor and
// then dropped this file. The game surfaces (15 files, ~98 call sites) still key translations by
// string, including one site that picks the key at runtime
// (`(bannerHidden ? 'a' : 'b').t(context: context)`), which a static accessor cannot express. Both
// `easy_localization` and the raw `.tr()` it wraps are still live dependencies here, so the helper
// keeps working exactly as before.
//
// Follow-up: migrate the game surfaces onto `context.t.<key>` and delete this again. DCM bans
// `String.tr()`, but DCM needs a licence key and is skipped on the fork, so nothing enforces that
// today.

import 'package:easy_localization/easy_localization.dart';
import 'package:flutter/material.dart';
import 'package:immich_mobile/utils/debug_print.dart';
import 'package:intl/message_format.dart';

extension StringTranslateExtension on String {
  String t({BuildContext? context, Map<String, Object>? args}) {
    return _translateHelper(context, this, args);
  }
}

extension TextTranslateExtension on Text {
  Text t({BuildContext? context, Map<String, Object>? args}) {
    return Text(
      _translateHelper(context, data ?? '', args),
      key: key,
      style: style,
      strutStyle: strutStyle,
      textAlign: textAlign,
      textDirection: textDirection,
      locale: locale,
      softWrap: softWrap,
      overflow: overflow,
      textScaler: textScaler,
      maxLines: maxLines,
      semanticsLabel: semanticsLabel,
      textWidthBasis: textWidthBasis,
      textHeightBehavior: textHeightBehavior,
    );
  }
}

String _translateHelper(BuildContext? context, String key, [Map<String, Object>? args]) {
  if (key.isEmpty) {
    return '';
  }
  try {
    final translatedMessage = key.tr(context: context);
    return args != null
        ? MessageFormat(translatedMessage, locale: Intl.defaultLocale ?? 'en').format(args)
        : translatedMessage;
  } catch (e) {
    dPrint(() => 'Translation failed for key "$key". Error: $e');
    return key;
  }
}
