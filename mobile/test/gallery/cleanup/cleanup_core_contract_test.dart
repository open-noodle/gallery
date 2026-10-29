import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/gallery/cleanup/cleanup_prefs.dart';
import 'package:immich_mobile/gallery/cleanup/models/library_cleanup_marks.dart';
import 'package:immich_mobile/gallery/cleanup/models/library_cleanup_queue.dart';
import 'package:immich_mobile/gallery/cleanup/models/library_cleanup_session_state.dart';
import 'package:immich_mobile/gallery/cleanup/models/library_cleanup_support.dart';
import 'package:immich_mobile/gallery/cleanup/providers/library_cleanup.providers.dart';
import 'package:immich_mobile/gallery/cleanup/providers/library_cleanup_session.provider.dart';
import 'package:immich_mobile/gallery/cleanup/repositories/library_cleanup.repository.dart';
import 'package:openapi/api.dart';

import 'cleanup_contract_server.dart';
import 'cleanup_test_utils.dart';

// Slice 1 end to end: the real cleanup providers and the real generated OpenAPI client against the strict contract
// server, which answers only what the real server was recorded answering (e2e/src/specs/server/api/
// gallery-cleanup-contract.e2e-spec.ts records every fixture used here). A request no unserved fixture matches (a
// `completeMonthDay` on an apply, a page without its cursor) fails the test.
//
// Scenario, in the order the fixtures were recorded:
//   Given a Gallery server with cleanup      When the app probes   Then the calendar is fetched once, in the device zone
//   Given the rewind of 15 August            When it is opened     Then years, then 2022, then 2020
//   When p1 is kept, p2 favourited, q2 trashed and the user applies and stops
//                                            Then the in-spaces lookup and one commit without completeMonthDay are sent
//   When the trash is undone                 Then exactly q2 is restored
//   When the day is reopened                 Then the photos decided before are skipped
//   When q1 (in a space) is trashed and the rest kept, and the user declines
//                                            Then nothing is committed; confirming commits once with completeMonthDay
//   When the Blurry queue is opened          Then pages come with their cursors as ten cards remain
//   When marks are made, applied and the trash undone, and the filters change
//                                            Then the requests match the fixtures exactly

final ids = cleanupContractIds();
String idOf(String label) => ids[label] ?? (throw StateError('no fixture names $label'));

const timeZone = 'Europe/Lisbon';

void main() {
  setUpAll(initTestStore);

  ProviderContainer containerFor(CleanupContractServer server, {LibraryCleanupServerKind? kind}) {
    final client = ApiClient(basePath: server.endpoint);
    return cleanupContainer(
      repository: LibraryCleanupRepository(
        cleanupApi: CleanupApi(client),
        trashApi: TrashApi(client),
        timeZone: () async => timeZone,
      ),
      directory: tempDirectory(),
      kind: kind ?? LibraryCleanupServerKind.gallery,
      overrides: [libraryCleanupPageSizeProvider.overrideWithValue(4)],
    );
  }

  test('probe, rewind, apply and stop, undo, resume, finish, Blurry, apply, undo, filters', () async {
    final server = await CleanupContractServer.start(
      // Without the no-cleanup view, and without the rewind's loads after the overview, which ask the same as 020–022.
      include: (name) =>
          !name.contains('no-cleanup') &&
          !name.startsWith('019c') &&
          !name.startsWith('019d') &&
          !name.contains('from-overview'),
    );
    addTearDown(server.close);
    final container = containerFor(server);
    container.listen(libraryCleanupSupportProvider, (_, _) {});

    // The probe: one calendar request, in the device zone, and the overview reads the same calendar.
    final support = await container.read(libraryCleanupSupportProvider.future);
    expect(support.status, LibraryCleanupSupportStatus.supported);
    expect(support.calendar!.days, hasLength(366));
    expect(support.calendar!.days.firstWhere((d) => d.monthDay == 1224).reviewedAt, isNotNull);
    expect(support.calendar!.days.firstWhere((d) => d.monthDay == 815).reviewedAt, isNull);
    expect(container.read(libraryCleanupCalendarProvider), same(support.calendar));
    expect(server.served, ['010-calendar']);

    // Rewind of 15 August.
    const rewind = LibraryCleanupSessionRequest.rewind(815);
    container.listen(libraryCleanupSessionProvider(rewind), (_, _) {});
    final session = container.read(libraryCleanupSessionProvider(rewind).notifier);
    await session.settled();
    await server.waitForServed(4);
    expect(server.served[1], '020-rewind-815-years');
    expect(server.served.skip(2).toSet(), {'021-rewind-815-2022', '022-rewind-815-2020'});
    var state = container.read(libraryCleanupSessionProvider(rewind));
    expect(state.assets.map((a) => a.id), ['p1', 'p2', 'q1', 'q2', 'q3'].map((l) => idOf('asset:$l')));
    expect(state.years.map((y) => [y.year, y.assets.length]), [
      [2022, 2],
      [2020, 3],
    ]);

    // Keep p1, favourite p2, trash q2; apply and stop.
    session
      ..keep(idOf('asset:p1'))
      ..favorite(idOf('asset:p2'))
      ..trash(idOf('asset:q2'));
    final stopped = await session.applyAndStop();
    expect(stopped.status, LibraryCleanupApplyStatus.applied);
    expect(stopped.trashed, [idOf('asset:q2')]);
    expect(stopped.dayCompleted, isFalse);
    expect(server.served.skip(4), ['030-in-spaces-q2', '031-commit-apply-and-stop']);

    // The trash undo restores exactly q2.
    expect(await session.restoreTrashed(stopped), [idOf('asset:q2')]);
    expect(server.served.last, '032-restore-q2');

    // Reopen the day: what was decided is skipped, and the restored photo is back.
    container.invalidate(libraryCleanupSessionProvider(rewind));
    await pumpEvents(); // the listener makes the provider rebuild at once
    final reopened = container.read(libraryCleanupSessionProvider(rewind).notifier);
    await reopened.settled();
    await server.waitForServed(10);
    expect(server.served.skip(7).take(3).toSet(), {
      '040-rewind-815-years-resumed',
      '041-rewind-815-2022-resumed',
      '042-rewind-815-2020-resumed',
    });
    state = container.read(libraryCleanupSessionProvider(rewind));
    expect(state.alreadyDone, 2);
    expect(state.assets.map((a) => a.id), ['q1', 'q2', 'q3'].map((l) => idOf('asset:$l')));

    // q1 is in a shared space: declining commits nothing; confirming commits once, with completeMonthDay.
    reopened.trash(idOf('asset:q1'));
    final declined = await reopened.finishDay(keepTheRest: true, confirm: (check) async => false);
    expect(declined.status, LibraryCleanupApplyStatus.cancelled);
    expect(server.served.last, '050-in-spaces-q1');
    expect(container.read(libraryCleanupSessionProvider(rewind)).marks, {idOf('asset:q1'): LibraryCleanupMark.trash});

    LibraryCleanupTrashCheck? asked;
    final finished = await reopened.finishDay(
      keepTheRest: true,
      confirm: (check) async {
        asked = check;
        return true;
      },
    );
    expect(asked!.inSpacesCount, 1);
    expect(finished.status, LibraryCleanupApplyStatus.applied);
    expect(finished.dayCompleted, isTrue);
    expect(finished.trashed, [idOf('asset:q1')]);
    await server.waitForServed(14);
    expect(server.served.skip(11), ['051-in-spaces-q1-again', '052-commit-finish-day', '053-calendar-after-finish']);
    final calendar = container.read(libraryCleanupCalendarProvider)!;
    expect(calendar.days.firstWhere((d) => d.monthDay == 815).reviewedAt, isNotNull);
    expect(calendar.daysReviewed, 2);

    // Blurry: three pages open, the fourth comes as ten cards remain.
    const blurry = LibraryCleanupSessionRequest.queue(LibraryCleanupQueue.blurry);
    container.listen(libraryCleanupSessionProvider(blurry), (_, _) {});
    final queue = container.read(libraryCleanupSessionProvider(blurry).notifier);
    await queue.settled();
    expect(server.served.skip(14), ['060-blurry-page-1', '061-blurry-page-2', '062-blurry-page-3']);
    expect(container.read(libraryCleanupSessionProvider(blurry)).assets, hasLength(12));
    expect(container.read(libraryCleanupSessionProvider(blurry)).hasMore, isTrue);

    String b(int n) => idOf('asset:blurry-${n.toString().padLeft(2, '0')}');
    queue
      ..trash(b(1))
      ..trash(b(2));
    await queue.settled();
    expect(server.served.last, '063-blurry-page-4');
    state = container.read(libraryCleanupSessionProvider(blurry));
    expect(state.assets, hasLength(13));
    expect(state.hasMore, isFalse);
    expect(state.assets.first.reason.orElse(null), CleanupBlurReason.blurry);
    expect(state.assets.last.reason.orElse(null), CleanupBlurReason.dark);

    // Mark all three ways, undo one, apply, undo the trash.
    queue
      ..favorite(b(3))
      ..keep(b(4))
      ..keep(b(5))
      ..undo();
    expect(container.read(libraryCleanupSessionProvider(blurry)).marks.keys, [b(1), b(2), b(3), b(4)]);
    final applied = await queue.applyAndStop();
    expect(applied.status, LibraryCleanupApplyStatus.applied);
    expect(applied.trashed, [b(1), b(2)]);
    expect(server.served.skip(18), ['070-in-spaces-blurry', '071-commit-blurry']);
    expect(await queue.restoreTrashed(applied), [b(1), b(2)]);
    expect(server.served.last, '072-restore-blurry');

    // Other filters: the first page again, with exactly those filters.
    await queue.setFilters(
      container
          .read(libraryCleanupPrefsProvider)
          .filtersFor(LibraryCleanupQueue.blurry)
          .copyWith(strictness: CleanupStrictness.strict, reason: CleanupBlurReason.dark, hideFaces: false),
    );
    expect(server.served.last, '073-blurry-dark-strict');
    state = container.read(libraryCleanupSessionProvider(blurry));
    expect(state.assets.map((a) => a.originalFileName), ['dark-2.png', 'dark-1.png']);
    expect(state.assets.every((a) => a.reason.orElse(null) == CleanupBlurReason.dark), isTrue);

    expect(server.unmatched, isEmpty);
    expect(server.served, hasLength(22));
  });

  test('a server without cleanup answers the probe 404 and nothing else is requested', () async {
    // The 404 fixture records the same request as the probe's 200; serve it alone.
    final alone = await CleanupContractServer.start(include: (name) => name == '011-calendar-no-cleanup');
    addTearDown(alone.close);
    final probed = containerFor(alone);
    probed.listen(libraryCleanupSupportProvider, (_, _) {});

    final support = await probed.read(libraryCleanupSupportProvider.future);
    probed.read(libraryCleanupSupportProvider.notifier).refreshIfFailed();
    await probed.read(libraryCleanupSupportProvider.future);

    expect(support.status, LibraryCleanupSupportStatus.unsupported);
    expect(probed.read(libraryCleanupCalendarProvider), isNull);
    expect(alone.requests, [
      'GET /api/cleanup/calendar',
    ], reason: 'the probe and nothing else, now or on the next Library open');
    expect(alone.unmatched, isEmpty);
  });

  test('a stock Immich server is never asked anything', () async {
    final server = await CleanupContractServer.start();
    addTearDown(server.close);
    final container = containerFor(server, kind: LibraryCleanupServerKind.stock);

    final support = await container.read(libraryCleanupSupportProvider.future);

    expect(support.status, LibraryCleanupSupportStatus.unsupported);
    expect(server.requests, isEmpty);
  });

  test('the contract server is strict: a completeMonthDay on an apply and stop matches no fixture', () async {
    final server = await CleanupContractServer.start();
    addTearDown(server.close);
    final client = ApiClient(basePath: server.endpoint);
    final repository = LibraryCleanupRepository(cleanupApi: CleanupApi(client), trashApi: TrashApi(client));

    await expectLater(
      repository.commit(
        queue: CleanupQueue.rewind,
        trashIds: [idOf('asset:q2')],
        favoriteIds: [idOf('asset:p2')],
        keepIds: [idOf('asset:p1')],
        completeMonthDay: 815,
      ),
      throwsA(isA<ApiException>()),
    );
    expect(server.unmatched, hasLength(1));
    expect(server.served, isEmpty);
  });
}
