import { render, screen } from '@testing-library/svelte';
import DailyChallengeCard from '$lib/components/games/daily-challenge-card.svelte';

describe('DailyChallengeCard', () => {
  const challenge = {
    id: 'daily-1',
    roundCount: 5,
    locationRoundCount: 3,
    answered: 0,
    total: 0,
  };

  const href = '/spaces/s1/games/daily-1';

  it('invites you to play when the daily has not been started', () => {
    render(DailyChallengeCard, { challenge, href, now: new Date('2026-08-16T12:00:00.000Z') });

    expect(screen.getByTestId('daily-challenge-play')).toBeInTheDocument();
    expect(screen.queryByTestId('daily-challenge-score')).not.toBeInTheDocument();
  });

  // Finishing the daily is the point of the one-shot rule, so the card has to switch from a call to
  // action to a result - otherwise a played daily still reads as "Play" and invites a click that
  // can only show an already-finished game.
  it('shows the score instead of a play action once every round is answered', () => {
    render(DailyChallengeCard, {
      challenge: { ...challenge, answered: 5, total: 18_420 },
      href,
      now: new Date('2026-08-16T12:00:00.000Z'),
    });

    expect(screen.getByTestId('daily-challenge-score')).toHaveTextContent('18,420');
    expect(screen.queryByTestId('daily-challenge-play')).not.toBeInTheDocument();
  });

  it('offers to continue a daily that was started but not finished', () => {
    render(DailyChallengeCard, {
      challenge: { ...challenge, answered: 2, total: 7000 },
      href,
      now: new Date('2026-08-16T12:00:00.000Z'),
    });

    expect(screen.getByTestId('daily-challenge-play')).toBeInTheDocument();
    expect(screen.queryByTestId('daily-challenge-score')).not.toBeInTheDocument();
  });

  // Only that the countdown is SHOWN once the daily is finished - the value itself is
  // timeUntilNextDaily's job and is tested directly in utils/game.spec.ts, because $t() returns the
  // raw key in this environment (no locale catalog) so an interpolated time can never be asserted
  // through the rendered text.
  it('shows a countdown to the next daily once this one is finished', () => {
    render(DailyChallengeCard, {
      challenge: { ...challenge, answered: 5, total: 100 },
      href,
      now: new Date('2026-08-16T21:45:00.000Z'),
    });

    expect(screen.getByTestId('daily-challenge-countdown')).toBeInTheDocument();
  });

  it('reports the daily as unavailable when the space cannot produce one', () => {
    render(DailyChallengeCard, { challenge: null, href, now: new Date('2026-08-16T12:00:00.000Z') });

    expect(screen.getByTestId('daily-challenge-unavailable')).toBeInTheDocument();
    expect(screen.queryByTestId('daily-challenge-play')).not.toBeInTheDocument();
  });

  // Design §5.1 - failure phrasing is per-scope. The default wording tells the player to add photos
  // "to this space", which is nonsense for a solo player who may not be in one, so the caller
  // supplies the remedy that actually applies to it.
  it('lets the caller phrase the unavailable message for its own scope', () => {
    render(DailyChallengeCard, {
      challenge: null,
      href,
      now: new Date('2026-08-16T12:00:00.000Z'),
      unavailableMessage: 'Nothing to play on your own yet',
    });

    expect(screen.getByTestId('daily-challenge-unavailable')).toHaveTextContent('Nothing to play on your own yet');
  });

  // $t() returns the raw key in this environment, so the key name is what the default renders as.
  it('keeps the space wording when the caller supplies no message', () => {
    render(DailyChallengeCard, { challenge: null, href, now: new Date('2026-08-16T12:00:00.000Z') });

    expect(screen.getByTestId('daily-challenge-unavailable')).toHaveTextContent('game_daily_unavailable');
  });
});
