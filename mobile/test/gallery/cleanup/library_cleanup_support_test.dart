import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/gallery/cleanup/models/library_cleanup_support.dart';
import 'package:immich_mobile/gallery/cleanup/providers/library_cleanup.providers.dart';
import 'package:immich_mobile/gallery/cleanup/repositories/library_cleanup.repository.dart';
import 'package:immich_mobile/utils/semver.dart';
import 'package:openapi/api.dart';

import 'cleanup_test_utils.dart';

// Slice 1, "Support probe" and "Time zone".
//
// Given a Gallery server with cleanup     When the probe runs   Then it is supported, and the overview reads the same calendar with no second request
// Given a 404 or a 403                    When the probe runs   Then unsupported
// Given a stock Immich server             When the probe would run   Then no request is sent and it is unsupported
// Given the version is still 0.0.0        When Library opens    Then no request is sent; once the version is known, the probe runs
// Given a network error or a 5xx          When the probe runs   Then unsupported for now ("unavailable"), and asked again on the next Library open
// Given any calendar request              Then it carries the device's IANA zone, or UTC when the plugin fails
//
// And the server kind rule: declared sync types win; else a fork version above 5.0.0 is Gallery.

void main() {
  const calendarRoute = 'GET /cleanup/calendar';

  FakeResponse? calendarOnly(SeenRequest request) =>
      request.route == calendarRoute ? FakeResponse(calendarJson()) : null;

  ProviderContainer containerFor(
    FakeCleanupServer server, {
    LibraryCleanupServerKind kind = LibraryCleanupServerKind.gallery,
    Future<String> Function()? timeZone,
  }) => cleanupContainer(server: server, directory: tempDirectory(), kind: kind, timeZone: timeZone);

  test('a Gallery server with cleanup is supported, and the overview reuses the probe calendar', () async {
    final server = FakeCleanupServer(calendarOnly);
    final container = containerFor(server);

    final support = await container.read(libraryCleanupSupportProvider.future);

    expect(support.status, LibraryCleanupSupportStatus.supported);
    expect(support.calendar!.days.single.monthDay, 815);
    expect(container.read(libraryCleanupCalendarProvider), same(support.calendar));
    expect(server.routes, [calendarRoute], reason: 'one probe, no second request for the overview');
  });

  for (final code in [404, 403]) {
    test('a $code answer means unsupported for good', () async {
      final server = FakeCleanupServer((_) => FakeResponse({'message': 'no'}, code));
      final container = containerFor(server);

      final support = await container.read(libraryCleanupSupportProvider.future);

      expect(support.status, LibraryCleanupSupportStatus.unsupported);
      container.read(libraryCleanupSupportProvider.notifier).refreshIfFailed();
      await container.read(libraryCleanupSupportProvider.future);
      expect(server.requests, hasLength(1), reason: 'a lasting no is not asked again');
    });
  }

  test('a stock Immich server is never asked', () async {
    final server = FakeCleanupServer((_) => null);
    final container = containerFor(server, kind: LibraryCleanupServerKind.stock);

    final support = await container.read(libraryCleanupSupportProvider.future);

    expect(support.status, LibraryCleanupSupportStatus.unsupported);
    expect(server.requests, isEmpty);
  });

  test(
    'nothing is sent while the server version is the 0.0.0 placeholder, and the probe runs once it is known',
    () async {
      final server = FakeCleanupServer(calendarOnly);
      final kind = StateProvider<LibraryCleanupServerKind>((ref) => LibraryCleanupServerKind.unknown);
      final container = cleanupContainer(
        server: server,
        directory: tempDirectory(),
        overrides: [libraryCleanupServerKindProvider.overrideWith((ref) => ref.watch(kind))],
      );

      final before = await container.read(libraryCleanupSupportProvider.future);
      expect(before.status, LibraryCleanupSupportStatus.unknown);
      expect(server.requests, isEmpty);

      container.read(kind.notifier).state = LibraryCleanupServerKind.gallery;
      final after = await container.read(libraryCleanupSupportProvider.future);

      expect(after.status, LibraryCleanupSupportStatus.supported);
      expect(server.routes, [calendarRoute]);
    },
  );

  for (final failure in <String, FakeResponse? Function(SeenRequest)>{
    'a 500': (_) => const FakeResponse({'message': 'boom'}, 500),
    'a 502': (_) => const FakeResponse({'message': 'bad gateway'}, 502),
    'a network error': (_) => throw const SocketException('offline'),
  }.entries) {
    test('${failure.key} hides the entry for now, and Library asks again when it next opens', () async {
      var healthy = false;
      final server = FakeCleanupServer((request) => healthy ? calendarOnly(request) : failure.value(request));
      final container = containerFor(server);
      container.listen(libraryCleanupSupportProvider, (_, _) {});

      final first = await container.read(libraryCleanupSupportProvider.future);
      expect(first.status, LibraryCleanupSupportStatus.unavailable);
      expect(first.isSupported, isFalse);

      healthy = true;
      container.read(libraryCleanupSupportProvider.notifier).refreshIfFailed();
      final second = await container.read(libraryCleanupSupportProvider.future);

      expect(second.status, LibraryCleanupSupportStatus.supported);
      expect(server.requests, hasLength(2));
    });
  }

  test('a supported server is not probed again when Library opens', () async {
    final server = FakeCleanupServer(calendarOnly);
    final container = containerFor(server);
    container.listen(libraryCleanupSupportProvider, (_, _) {});
    await container.read(libraryCleanupSupportProvider.future);

    container.read(libraryCleanupSupportProvider.notifier).refreshIfFailed();
    await container.read(libraryCleanupSupportProvider.future);

    expect(server.requests, hasLength(1));
  });

  test('the calendar request carries the device time zone, read again on every request', () async {
    final server = FakeCleanupServer(calendarOnly);
    var zone = 'Europe/Lisbon';
    final container = containerFor(server, timeZone: () async => zone);
    container.listen(libraryCleanupSupportProvider, (_, _) {});
    await container.read(libraryCleanupSupportProvider.future);

    zone = 'Asia/Tokyo';
    await container.read(libraryCleanupSupportProvider.notifier).refreshCalendar();

    expect(server.requests.map((r) => r.query['tz']), [
      ['Europe/Lisbon'],
      ['Asia/Tokyo'],
    ]);
  });

  test('a failing time zone plugin sends UTC', () async {
    // The plugin's method channel has no host in a unit test, which is a plugin failure.
    TestWidgetsFlutterBinding.ensureInitialized();
    final server = FakeCleanupServer(calendarOnly);

    await server.repository(timeZone: readDeviceTimeZone).calendar();

    expect(server.requests.single.query['tz'], ['UTC']);
  });

  group('server kind', () {
    const galleryVersion = SemVer(major: 5, minor: 8, patch: 0);
    const immichBase = SemVer(major: 3, minor: 3, patch: 3);
    const placeholder = SemVer(major: 0, minor: 0, patch: 0);

    test('declared sync types decide: shared spaces means Gallery, anything else stock', () {
      expect(
        libraryCleanupServerKind(immichBase, {SyncRequestType.sharedSpacesV1.toJson()}),
        LibraryCleanupServerKind.gallery,
      );
      expect(
        libraryCleanupServerKind(galleryVersion, {SyncRequestType.assetsV1.toJson()}),
        LibraryCleanupServerKind.stock,
      );
      expect(
        libraryCleanupServerKind(placeholder, {SyncRequestType.assetsV1.toJson()}),
        LibraryCleanupServerKind.stock,
      );
    });

    test('without declared types the version decides, and the placeholder waits', () {
      expect(libraryCleanupServerKind(placeholder, null), LibraryCleanupServerKind.unknown);
      expect(libraryCleanupServerKind(immichBase, null), LibraryCleanupServerKind.stock);
      expect(
        libraryCleanupServerKind(const SemVer(major: 5, minor: 0, patch: 0), null),
        LibraryCleanupServerKind.stock,
      );
      expect(libraryCleanupServerKind(galleryVersion, null), LibraryCleanupServerKind.gallery);
    });
  });
}
