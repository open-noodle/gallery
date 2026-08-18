import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/utils/game_format.dart';
import 'package:openapi/api.dart';

GameRoundDetailResponseDto _round(int index, {num? score}) => GameRoundDetailResponseDto(
  index: index,
  type: GameRoundType.location,
  score: score == null ? const Optional.absent() : Optional.present(score),
);

void main() {
  group('wrapLongitude', () {
    test('wraps values maplibre produces past the antimeridian', () {
      // The server's longitudeSchema is min(-180).max(180) and 400s outside it.
      expect(wrapLongitude(200), closeTo(-160, 1e-9));
      expect(wrapLongitude(-230), closeTo(130, 1e-9));
    });

    test('leaves in-range values alone', () {
      expect(wrapLongitude(0), 0);
      // 180 and -180 are the same meridian; the modulo formula normalises the exact boundary to
      // -180 (matches web's game.spec.ts `normalises the antimeridian boundary to -180`).
      expect(wrapLongitude(180), closeTo(-180, 1e-9));
      expect(wrapLongitude(-180), closeTo(-180, 1e-9));
    });

    test('a full extra turn still lands in range', () {
      expect(wrapLongitude(540).abs(), lessThanOrEqualTo(180));
      expect(wrapLongitude(-540).abs(), lessThanOrEqualTo(180));
    });
  });

  group('formatDistanceKm', () {
    test('uses metres below a kilometre, with no decimals', () {
      expect(formatDistanceKm(0.38), '380 m');
    });

    test('a zero distance is metres, never 0.0 km', () {
      expect(formatDistanceKm(0), '0 m');
    });

    test('one decimal between 1 and 10 km', () {
      expect(formatDistanceKm(4.25), '4.3 km');
    });

    test('rounds above 10 km', () {
      expect(formatDistanceKm(38.4), '38 km');
    });
  });

  group('scorePercent', () {
    test('clamps below zero', () => expect(scorePercent(-10), 0));
    test('clamps above the maximum', () => expect(scorePercent(kMaxRoundScore + 1000), 100));
    test('scales linearly', () => expect(scorePercent(kMaxRoundScore ~/ 2), 50));
  });

  group('competitionRanks', () {
    test('is empty for an empty board', () => expect(competitionRanks(const []), isEmpty));

    test('gives every player rank 1 when all totals tie', () {
      expect(competitionRanks(const [10, 10, 10]), [1, 1, 1]);
    });

    test('numbers a tie 1, 2, 2, 4 rather than inventing a winner', () {
      expect(competitionRanks(const [30, 20, 20, 10]), [1, 2, 2, 4]);
    });
  });

  group('formatStandingsMonth', () {
    test('renders the UTC month, not the local one', () {
      expect(formatStandingsMonth('2026-08', locale: 'en_US'), 'August 2026');
      expect(formatStandingsMonth('2026-01', locale: 'en_US'), 'January 2026');
    });
  });

  group('shouldShowStandings', () {
    test('is hidden while nobody has been asked, even with history', () {
      expect(shouldShowStandings(null, const [3]), isFalse);
    });

    test('is shown when disabled but history exists — disabling deletes nothing', () {
      expect(shouldShowStandings(false, const [3]), isTrue);
    });

    test('is hidden when disabled with no history', () {
      expect(shouldShowStandings(false, const [0, 0]), isFalse);
    });

    test('is shown whenever enabled', () {
      expect(shouldShowStandings(true, const []), isTrue);
    });
  });

  group('timeUntilNextDaily', () {
    test('counts to the next UTC midnight', () {
      expect(timeUntilNextDaily(DateTime.utc(2026, 8, 18, 17, 48)), '6h 12m');
    });

    test('never goes negative at the boundary', () {
      expect(timeUntilNextDaily(DateTime.utc(2026, 8, 18, 23, 59, 59)), '0h 0m');
    });
  });

  group('firstUnansweredIndex', () {
    test('is 0 when nothing is answered', () {
      expect(firstUnansweredIndex([_round(0), _round(1)]), 0);
    });

    test('skips answered rounds', () {
      expect(firstUnansweredIndex([_round(0, score: 10), _round(1, score: 0), _round(2)]), 2);
    });

    test('a zero score counts as answered — it is a real result, not a missing one', () {
      expect(firstUnansweredIndex([_round(0, score: 0)]), isNull);
    });

    test('is null when every round is answered', () {
      expect(firstUnansweredIndex([_round(0, score: 5), _round(1, score: 5)]), isNull);
    });

    test('is null for an empty round list', () {
      expect(firstUnansweredIndex(const []), isNull);
    });
  });
}
