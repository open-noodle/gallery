import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { init, register, waitLocale } from 'svelte-i18n';
import RoundResult from '$lib/components/games/round-result.svelte';

// Map.svelte pulls in maplibre-gl, which needs a WebGL canvas happy-dom lacks. Copied verbatim
// from location-round.spec.ts (itself copied from map-page.spec.ts:58-61). Note the @test-data
// ALIAS; a relative path to the stub does not resolve.
vi.mock('$lib/components/shared-components/map/Map.svelte', async () => {
  const { default: MockComponent } = await import('@test-data/mocks/map-component.stub.svelte');
  return { default: MockComponent };
});

describe('RoundResult', () => {
  beforeAll(async () => {
    // Load the real en bundle so `$t('game_you_were_away', { values: { distance } })` resolves to
    // English ICU output ("You were 7.5 km away") instead of the raw key — the global test setup
    // (src/test-data/setup.ts) uses `fallbackLocale: 'dev'`, which returns bare keys. Same
    // convention as global-search/rows/space-row.spec.ts.
    register('en-US', () => import('$i18n/en.json'));
    await init({ fallbackLocale: 'en-US' });
    await waitLocale('en-US');
  });

  const base = { challengeId: 'c1', index: 0, onNext: () => {} };

  it('renders for a location round with the distance text', () => {
    render(RoundResult, {
      ...base,
      type: 'location' as const,
      score: 3200,
      distanceKm: 7.5,
      guess: { lat: 1, lon: 2 },
      answer: { date: null, lat: 10, lon: 20 },
    });

    expect(screen.getByTestId('round-result')).toBeInTheDocument();
    expect(screen.getByText('You were 7.5 km away')).toBeInTheDocument();
  });

  it('passes exactly the guess and answer pins to the map, never an unfetched marker set', () => {
    render(RoundResult, {
      ...base,
      type: 'location' as const,
      score: 3200,
      distanceKm: 7.5,
      guess: { lat: 1, lon: 2 },
      answer: { date: null, lat: 10, lon: 20 },
    });

    expect(screen.getByTestId('map-stub')).toHaveAttribute('data-marker-count', '2');
    expect(screen.getByTestId('map-stub')).toHaveAttribute('data-marker-ids', 'guess,answer');
  });

  // The settings cog on Map.svelte defaults to visible; clicking it isn't an answer leak here (the
  // reveal has already happened), but it would refetch and overwrite mapMarkers, destroying the
  // guess/answer pins mid-reveal. showSettings={false} must be passed explicitly.
  it('never exposes the map settings control on the reveal map', () => {
    render(RoundResult, {
      ...base,
      type: 'location' as const,
      score: 3200,
      distanceKm: 7.5,
      guess: { lat: 1, lon: 2 },
      answer: { date: null, lat: 10, lon: 20 },
    });

    expect(screen.getByTestId('map-stub')).toHaveAttribute('showsettings', 'false');
  });

  it('labels the guess pin so it can be told apart from the identical-looking answer pin', () => {
    render(RoundResult, {
      ...base,
      type: 'location' as const,
      score: 3200,
      distanceKm: 7.5,
      guess: { lat: 1, lon: 2 },
      answer: { date: null, lat: 10, lon: 20 },
    });

    // The stub only renders the popup snippet for mapMarkers[0] (map-component.stub.svelte:49-53),
    // which is the guess marker given our ['guess', 'answer'] ordering — so this proves the popup
    // snippet actually branches on marker id rather than always showing the same label.
    expect(screen.getByTestId('map-popup')).toHaveTextContent('Guess');
  });

  // The 409-recovery path (task 9's play page) re-shows a result with an answer but no guess of its
  // own - that request never reached the server, so there is nothing to plot for it.
  it('renders an answer-only marker when there is no guess to plot alongside it', () => {
    render(RoundResult, {
      ...base,
      type: 'location' as const,
      score: 3200,
      answer: { date: null, lat: 10, lon: 20 },
    });

    expect(screen.getByTestId('map-stub')).toHaveAttribute('data-marker-count', '1');
    expect(screen.getByTestId('map-stub')).toHaveAttribute('data-marker-ids', 'answer');
  });

  it('renders for a date round with the offset text', () => {
    render(RoundResult, {
      ...base,
      type: 'date' as const,
      score: 4000,
      offsetDays: 3,
      answer: { date: '2026-03-05T00:00:00.000Z', lat: null, lon: null },
    });

    expect(screen.getByTestId('round-result')).toBeInTheDocument();
    expect(screen.getByText('You were 3 days off')).toBeInTheDocument();
    // A date round has no coordinates to plot — the map must not render at all.
    expect(screen.queryByTestId('map-stub')).not.toBeInTheDocument();
  });

  it('renders a 0% bar for a score of 0', () => {
    render(RoundResult, { ...base, type: 'date' as const, score: 0, offsetDays: 90 });
    expect(screen.getByTestId('round-result-bar').style.width).toBe('0%');
  });

  it('renders a 100% bar for a perfect score', () => {
    render(RoundResult, { ...base, type: 'date' as const, score: 5000, offsetDays: 0 });
    expect(screen.getByTestId('round-result-bar').style.width).toBe('100%');
  });

  it('calls onNext when the next-round button is clicked', async () => {
    const onNext = vi.fn();
    render(RoundResult, { ...base, type: 'date' as const, score: 1000, offsetDays: 10, onNext });

    await userEvent.click(screen.getByTestId('round-result-next'));

    expect(onNext).toHaveBeenCalledTimes(1);
  });
});
