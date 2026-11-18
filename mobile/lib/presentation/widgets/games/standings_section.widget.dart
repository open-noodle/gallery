import 'package:flutter/material.dart';
import 'package:immich_mobile/extensions/translate_extensions.dart';
import 'package:immich_mobile/utils/game_format.dart';
import 'package:openapi/api.dart';

/// One board row. A widget rather than a builder so tests can read `userId`, `rank` and `value`
/// without scraping text.
class StandingsRow extends StatelessWidget {
  const StandingsRow({
    super.key,
    required this.userId,
    required this.rank,
    required this.name,
    required this.detail,
    required this.value,
    required this.isMe,
  });

  final String userId;
  final int rank;
  final String name;
  final String detail;
  final String value;
  final bool isMe;

  @override
  Widget build(BuildContext context) {
    return ListTile(
      leading: Text('$rank'),
      title: Text(name, style: isMe ? const TextStyle(fontWeight: FontWeight.bold) : null),
      subtitle: Text(detail),
      trailing: Text(value),
    );
  }
}

/// Today's daily board and the monthly board.
///
/// [today] is the DAILY CHALLENGE's own leaderboard, not part of the standings response, so it is
/// null whenever the space has no daily today — and then there are no tabs at all.
///
/// Neither board is sorted here. GameService already applies `compareStandings` before responding,
/// and re-sorting by total would break the rule that a member who played and scored zero still
/// outranks one who never turned up.
///
/// Every entry the server returned is rendered, with no cross-check against the space's member
/// list. Web filters on membership only to resolve an avatar; [StandingsRow] shows a rank, the
/// name the server already sent and a score — no avatar — so a lookup would buy nothing here
/// except a silently empty board whenever the member list happened to be slow, stale or failed.
class StandingsSection extends StatefulWidget {
  const StandingsSection({
    super.key,
    required this.today,
    required this.todayRoundCount,
    required this.month,
    required this.currentUserId,
  });

  final GameLeaderboardResponseDto? today;
  final int todayRoundCount;
  final GameStandingsResponseDto month;
  final String currentUserId;

  @override
  State<StandingsSection> createState() => _StandingsSectionState();
}

class _StandingsSectionState extends State<StandingsSection> {
  bool _showToday = true;

  @override
  Widget build(BuildContext context) {
    final hasToday = widget.today != null;
    // Falls back to the monthly board whenever there is no daily, so the section always shows the
    // thing the player can act on.
    final showToday = hasToday && _showToday;

    final rows = showToday
        ? [
            for (final entry in widget.today!.entries)
              (
                userId: entry.userId,
                name: entry.name,
                total: entry.total,
                played: entry.answered,
                detail: entry.answered == 0
                    ? 'game_not_played'.t(context: context)
                    : 'game_rounds_answered'.t(
                        context: context,
                        args: {'answered': '${entry.answered}', 'total': '${widget.todayRoundCount}'},
                      ),
              ),
          ]
        : [
            for (final entry in widget.month.entries)
              (
                userId: entry.userId,
                name: entry.name,
                total: entry.total,
                played: entry.daysPlayed,
                // `game_days_played` is an ICU plural keyed on `count`, so it takes a NUMBER
                // under `count` — not a pre-stringified `days`. A wrong arg name renders the raw
                // key, silently.
                detail: entry.daysPlayed == 0
                    ? 'game_not_played'.t(context: context)
                    : 'game_days_played'.t(context: context, args: {'count': entry.daysPlayed}),
              ),
          ];

    final ranks = competitionRanks([for (final row in rows) row.total]);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            // Flexible, because the heading and the tabs share this Row unconstrained: at 360dp
            // (or in a longer locale) the pair does not fit, and the heading is the half that
            // should yield. Without this the Row overflows instead.
            Flexible(
              child: Text(
                'game_leaderboard'.t(context: context),
                style: Theme.of(context).textTheme.titleMedium,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
              ),
            ),
            if (hasToday)
              SegmentedButton<bool>(
                // No leading check on the selected segment. It is what made the SELECTED segment
                // wider than the unselected one, so picking the longer label ("August 2026") blew
                // the Row by ~6px on a 402dp phone while "Today" looked fine - and it resized the
                // control on every toggle. The filled background still shows the selection.
                // Matches media_type_section and free_up_space_settings.
                showSelectedIcon: false,
                segments: [
                  ButtonSegment(
                    value: true,
                    label: Text('game_standings_today'.t(context: context), key: const Key('standings-tab-today')),
                  ),
                  ButtonSegment(
                    value: false,
                    label: Text(formatStandingsMonth(widget.month.month), key: const Key('standings-tab-month')),
                  ),
                ],
                selected: {showToday},
                onSelectionChanged: (selection) => setState(() => _showToday = selection.first),
              ),
          ],
        ),
        for (var i = 0; i < rows.length; i++)
          StandingsRow(
            key: Key('standings-row-${rows[i].userId}'),
            userId: rows[i].userId,
            rank: ranks[i],
            name: rows[i].name,
            detail: rows[i].detail,
            value: rows[i].played == 0 ? '—' : 'game_points'.t(context: context, args: {'score': '${rows[i].total}'}),
            isMe: rows[i].userId == widget.currentUserId,
          ),
      ],
    );
  }
}
