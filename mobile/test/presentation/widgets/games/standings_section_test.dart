import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/presentation/widgets/games/standings_section.widget.dart';
import 'package:openapi/api.dart';

import '../../../widget_tester_extensions.dart';

void main() {
  // Deliberately "wrongly sorted looking": a zero-score player ABOVE a never-played one. That is
  // exactly what the server sends, and any client-side re-sort by total would reorder these two.
  final month = GameStandingsResponseDto(
    month: '2026-08',
    entries: [
      GameStandingsResponseDtoEntriesInner(userId: 'a', name: 'Ana', total: 30, daysPlayed: 2),
      GameStandingsResponseDtoEntriesInner(userId: 'b', name: 'Bo', total: 30, daysPlayed: 3),
      GameStandingsResponseDtoEntriesInner(userId: 'c', name: 'Cy', total: 0, daysPlayed: 1),
      GameStandingsResponseDtoEntriesInner(userId: 'd', name: 'Di', total: 0, daysPlayed: 0),
    ],
  );

  Future<void> pump(WidgetTester tester, {GameLeaderboardResponseDto? today}) =>
      tester.pumpConsumerWidget(StandingsSection(today: today, todayRoundCount: 5, month: month, currentUserId: 'a'));

  // No `today` is passed, so there are no tabs and the monthly board renders directly. Tapping a
  // tab here would fail: the segmented button only exists when a daily exists.
  testWidgets('renders rows in the order the server sent them', (tester) async {
    await pump(tester);

    final rows = tester.widgetList(find.byType(StandingsRow)).cast<StandingsRow>().toList();
    expect(rows.map((row) => row.userId), [
      'a',
      'b',
      'c',
      'd',
    ], reason: 'A client-side sort by total would move Cy below Di');
  });

  // Fixture correction: the brief asserted [1, 2, 2, 4] here, but that pattern needs a unique top
  // and a unique bottom with only the middle pair tied. This fixture ties BOTH ends — a/b share
  // total 30, c/d share total 0 (c/d must stay tied at 0 to keep the "zero-score player above a
  // never-played one" property the order test above depends on) — which competitionRanks correctly
  // renders as two separate tie groups: 1, 1, 3, 3. Verified competitionRanks itself is correct
  // elsewhere (competitionRanks([100, 90, 90, 80]) does give [1, 2, 2, 4]); this fixture just
  // doesn't shape into that pattern.
  testWidgets('ranks ties without inventing a winner (1, 1, 3, 3)', (tester) async {
    await pump(tester);

    final rows = tester.widgetList(find.byType(StandingsRow)).cast<StandingsRow>().toList();
    expect(rows.map((row) => row.rank), [1, 1, 3, 3]);
  });

  testWidgets('a member who has not played shows a dash', (tester) async {
    await pump(tester);

    final di = tester.widget<StandingsRow>(find.byKey(const Key('standings-row-d')));
    expect(di.value, '—');
  });

  // Proves the {score} and {count}/{answered}/{total} placeholders actually resolved rather than
  // `.t()` silently falling back to the raw key on a wrong args name — including the ICU plural's
  // "one" branch (Cy's single day) versus its "other" branch (Bo's three days).
  testWidgets('resolves the points and days-played placeholders in the monthly board', (tester) async {
    await pump(tester);

    expect(find.text('30 pts'), findsNWidgets(2), reason: 'Ana and Bo both scored 30');
    expect(find.text('2 days'), findsOneWidget, reason: "Ana's daysPlayed");
    expect(find.text('3 days'), findsOneWidget, reason: "Bo's daysPlayed");
    expect(find.text('1 day'), findsOneWidget, reason: "Cy's daysPlayed — ICU plural 'one' branch");
  });

  testWidgets('resolves the rounds-answered placeholder in the daily board', (tester) async {
    await pump(
      tester,
      today: GameLeaderboardResponseDto(
        entries: [GameLeaderboardResponseDtoEntriesInner(userId: 'a', name: 'Ana', total: 4000, answered: 5)],
      ),
    );

    expect(find.text('4000 pts'), findsOneWidget);
    expect(find.text('5 of 5 rounds answered'), findsOneWidget);
  });

  testWidgets('with no daily today there are no tabs, only the monthly board', (tester) async {
    await pump(tester);

    expect(find.byKey(const Key('standings-tab-today')), findsNothing);
    expect(find.byType(StandingsRow), findsNWidgets(4));
  });

  testWidgets('with a daily it opens on Today', (tester) async {
    await pump(
      tester,
      today: GameLeaderboardResponseDto(
        entries: [GameLeaderboardResponseDtoEntriesInner(userId: 'a', name: 'Ana', total: 4000, answered: 5)],
      ),
    );

    expect(find.byKey(const Key('standings-tab-today')), findsOneWidget);
    expect(find.byType(StandingsRow), findsNWidgets(1));
  });

  testWidgets('tapping the month tab switches boards, and tapping back returns to Today', (tester) async {
    await pump(
      tester,
      today: GameLeaderboardResponseDto(
        entries: [GameLeaderboardResponseDtoEntriesInner(userId: 'a', name: 'Ana', total: 4000, answered: 5)],
      ),
    );

    // Opens on Today, per the existing "opens on Today" test — just the starting point here.
    expect(find.byType(StandingsRow), findsNWidgets(1));
    expect(tester.widget<StandingsRow>(find.byType(StandingsRow)).userId, 'a');

    await tester.tap(find.byKey(const Key('standings-tab-month')));
    await tester.pumpAndSettle();

    final monthRows = tester.widgetList(find.byType(StandingsRow)).cast<StandingsRow>().toList();
    expect(
      monthRows.map((row) => row.userId),
      ['a', 'b', 'c', 'd'],
      reason: 'An inverted showToday computation would still show the 1-row daily board here',
    );

    await tester.tap(find.byKey(const Key('standings-tab-today')));
    await tester.pumpAndSettle();

    expect(find.byType(StandingsRow), findsNWidgets(1));
    expect(
      tester.widget<StandingsRow>(find.byType(StandingsRow)).userId,
      'a',
      reason: 'A selection.first bug (e.g. reading the wrong side of the Set) would strand it on month',
    );
  });

  // The tie-focused `month` fixture above is already in the exact order a descending-total sort
  // produces (30, 30, 0, 0 — non-increasing), so a `sort((a, b) => b.total.compareTo(a.total))`
  // mutation is a no-op on it BY CONSTRUCTION, not merely because Dart's sort happens to be stable
  // for small lists. Real standings always arrive highest-first, so no realistic fixture can ever
  // catch that specific accidental re-sort. This fixture is deliberately non-monotonic — total
  // INCREASES from the first entry to the second, which a real server would never send — precisely
  // so a re-sort has something to visibly disturb.
  testWidgets(
    'renders in arrival order even when totals are non-monotonic (synthetic — a real server never sends this)',
    (tester) async {
      final nonMonotonic = GameStandingsResponseDto(
        month: '2026-08',
        entries: [
          GameStandingsResponseDtoEntriesInner(userId: 'x', name: 'Xen', total: 10, daysPlayed: 1),
          GameStandingsResponseDtoEntriesInner(userId: 'y', name: 'Yara', total: 50, daysPlayed: 1),
        ],
      );

      await tester.pumpConsumerWidget(
        StandingsSection(today: null, todayRoundCount: 5, month: nonMonotonic, currentUserId: 'x'),
      );

      final rows = tester.widgetList(find.byType(StandingsRow)).cast<StandingsRow>().toList();
      expect(
        rows.map((row) => row.userId),
        ['x', 'y'],
        reason: 'A descending-total sort would swap these — the widget must trust array order unconditionally',
      );
    },
  );

  // The heading and the tabs share one unconstrained Row, so the pair has to fit the phone. The
  // MONTH selection is the failing case, not Today: Material draws a leading check on the SELECTED
  // segment, so selecting the longer label ("August 2026" vs "Today") adds the icon's width on top
  // of the longer text. Reported as a 5.9px overflow on a 402dp iPhone; 360dp is the narrow-phone
  // class the daily card is also pinned against.
  group('narrow phone', () {
    Future<void> pumpNarrow(WidgetTester tester) async {
      tester.view.devicePixelRatio = 1;
      tester.view.physicalSize = const Size(360, 800);
      addTearDown(tester.view.reset);

      await tester.pumpConsumerWidget(
        StandingsSection(
          today: GameLeaderboardResponseDto(
            entries: [GameLeaderboardResponseDtoEntriesInner(userId: 'a', name: 'Ana', total: 4000, answered: 5)],
          ),
          todayRoundCount: 5,
          month: month,
          currentUserId: 'a',
        ),
      );
    }

    testWidgets('the month tab selected does not overflow at 360dp', (tester) async {
      await pumpNarrow(tester);

      await tester.tap(find.byKey(const Key('standings-tab-month')));
      await tester.pumpAndSettle();

      expect(tester.takeException(), isNull);
    });

    testWidgets('the Today tab selected does not overflow at 360dp either', (tester) async {
      await pumpNarrow(tester);

      expect(tester.takeException(), isNull);
    });
  });

  // Replaces an assertion that the previous behaviour was correct: entries used to be dropped
  // unless they matched the space's member list, which meant a slow, stale or failed
  // `sharedSpaceMembersProvider` rendered the heading and tabs above an empty board — no error, no
  // retry, no rows. The filter bought nothing on mobile: StandingsRow shows a rank, the name the
  // server already sent and a score, and no avatar (the only thing web's member lookup resolves).
  testWidgets('renders every entry the server returned, member list or not', (tester) async {
    await pump(tester);

    expect(
      find.byType(StandingsRow),
      findsNWidgets(4),
      reason: 'A member-list cross-check would silently drop real players whenever that list did not load',
    );
    expect(find.text('Ana'), findsOneWidget);
    expect(find.text('Di'), findsOneWidget);
  });
}
