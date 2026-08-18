import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/presentation/widgets/games/standings_section.widget.dart';
import 'package:openapi/api.dart';

import '../../../widget_tester_extensions.dart';

SharedSpaceMemberResponseDto _member(String id) => SharedSpaceMemberResponseDto(
  userId: id,
  name: id,
  email: '$id@example.com',
  role: SharedSpaceRole.viewer,
  joinedAt: '2026-01-01T00:00:00Z',
  sharePersonMetadata: true,
  showInTimeline: true,
);

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

  Future<void> pump(WidgetTester tester, {GameLeaderboardResponseDto? today}) => tester.pumpConsumerWidget(
    StandingsSection(
      today: today,
      todayRoundCount: 5,
      month: month,
      members: [_member('a'), _member('b'), _member('c'), _member('d')],
      currentUserId: 'a',
    ),
  );

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

  testWidgets('an entry with no matching member is skipped rather than rendered nameless', (tester) async {
    await tester.pumpConsumerWidget(
      StandingsSection(today: null, todayRoundCount: 5, month: month, members: [_member('a')], currentUserId: 'a'),
    );

    expect(find.byType(StandingsRow), findsNWidgets(1));
  });
}
