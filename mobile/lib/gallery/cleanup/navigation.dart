import 'package:auto_route/auto_route.dart';
import 'package:flutter/widgets.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/routing/router.dart';

/// Opens a date's rewind ([monthDay] is month*100+day). Your year's day sheet opens every rewind through this one
/// function, so tests can watch it ([libraryCleanupRewindOpenerProvider]).
Future<void> openLibraryCleanupRewind(BuildContext context, int monthDay) =>
    ProviderScope.containerOf(context, listen: false).read(libraryCleanupRewindOpenerProvider)(context, monthDay);

typedef LibraryCleanupRewindOpener = Future<void> Function(BuildContext context, int monthDay);

final libraryCleanupRewindOpenerProvider = Provider<LibraryCleanupRewindOpener>((ref) => _pushRewind);

Future<void> _pushRewind(BuildContext context, int monthDay) =>
    context.pushRoute(LibraryCleanupRewindRoute(monthDay: monthDay));

/// "Show that day" from the details sheet: opens every photo taken on [day] (its wall-clock date) and completes when
/// the user comes back. A provider so tests can watch it.
typedef LibraryCleanupDayOpener = Future<void> Function(BuildContext context, DateTime day);

final libraryCleanupShowDayProvider = Provider<LibraryCleanupDayOpener>((ref) => _pushDay);

String _two(int value) => value.toString().padLeft(2, '0');

Future<void> _pushDay(BuildContext context, DateTime day) => context.pushRoute(
  LibraryCleanupDayPhotosRoute(date: '${day.year.toString().padLeft(4, '0')}-${_two(day.month)}-${_two(day.day)}'),
);
