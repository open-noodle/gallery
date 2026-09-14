import 'package:openapi/api.dart';

/// The `DateTime` the generated client ACTUALLY produces for a date-only field such as `dailyOn`.
///
/// The server sends `dailyOn` as `YYYY-MM-DD` — a `to_char`, with no time and no offset — and every
/// date field in the generated models is deserialised with `mapDateTime`, which calls
/// `DateTime.tryParse`. Dart parses an offset-less string in the DEVICE's zone, so what reaches the
/// app is LOCAL midnight, NOT the UTC instant a `DateTime.utc(...)` fixture models. (Contrast
/// `createdAt`, which arrives as `…T12:34:56.000Z` and really is UTC-flagged.)
///
/// Building date-only fixtures as `DateTime.utc(…)` is exactly why a `.toUtc()` applied to this
/// value survived review: under `TZ=UTC` the two shapes are indistinguishable, and only east or
/// west of Greenwich does the conversion move the day. Build every date-only fixture through here,
/// and run the affected suites under a non-UTC `TZ` when changing anything that reads one.
DateTime wireDateOnly(String isoDate) => mapDateTime({'value': isoDate}, 'value')!;
