import RoundResult from '#lib/components/games/round-result.svelte';
import { init, register, waitLocale } from 'svelte-i18n';
import { expect } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page, userEvent } from 'vitest/browser';

// Map.svelte pulls in maplibre-gl, which needs a WebGL canvas happy-dom lacks. Copied verbatim
// from location-round.spec.ts (itself copied from map-page.spec.ts:58-61). Note the @test-data
// ALIAS; a relative path to the stub does not resolve.
vi.mock('#lib/components/shared-components/map/Map.svelte', async () => {
  const { default: MockComponent } = await import('#lib/gallery/__mocks__/map-component.stub.svelte');
  return { default: MockComponent };
});

describe('RoundResult', () => {
  beforeAll(async () => {
    // Load the real en bundle so `$t('game_you_were_away', { values: { distance } })` resolves to
    // English ICU output ("You were 7.5 km away") instead of the raw key — the global test setup
    // (src/test-data/setup.ts) uses `fallbackLocale: 'dev'`, which returns bare keys. Same
    // convention as global-search/rows/space-row.spec.ts.
    register('en-US', () => import('#i18n/en.json'));
    await init({ fallbackLocale: 'en-US' });
    await waitLocale('en-US');
  });

  const base = { challengeId: 'c1', index: 0, onNext: () => {} };

  it('renders for a location round with the distance text', async () => {
    await render(RoundResult, {
      ...base,
      type: 'location' as const,
      score: 3200,
      distanceKm: 7.5,
      guess: { lat: 1, lon: 2 },
      answer: { date: null, lat: 10, lon: 20 },
    });

    expect(page.getByTestId('round-result').element()).toBeInTheDocument();
    expect(page.getByText('You were 7.5 km away').element()).toBeInTheDocument();
  });

  it('passes exactly the guess and answer pins to the map, never an unfetched marker set', async () => {
    await render(RoundResult, {
      ...base,
      type: 'location' as const,
      score: 3200,
      distanceKm: 7.5,
      guess: { lat: 1, lon: 2 },
      answer: { date: null, lat: 10, lon: 20 },
    });

    expect(page.getByTestId('map-stub').element()).toHaveAttribute('data-marker-count', '2');
    expect(page.getByTestId('map-stub').element()).toHaveAttribute('data-marker-ids', 'guess,answer');
  });

  // The settings cog on Map.svelte defaults to visible; clicking it isn't an answer leak here (the
  // reveal has already happened), but it would refetch and overwrite mapMarkers, destroying the
  // guess/answer pins mid-reveal. showSettings={false} must be passed explicitly.
  it('never exposes the map settings control on the reveal map', async () => {
    await render(RoundResult, {
      ...base,
      type: 'location' as const,
      score: 3200,
      distanceKm: 7.5,
      guess: { lat: 1, lon: 2 },
      answer: { date: null, lat: 10, lon: 20 },
    });

    expect(page.getByTestId('map-stub').element()).toHaveAttribute('showsettings', 'false');
  });

  it('labels the guess pin so it can be told apart from the identical-looking answer pin', async () => {
    await render(RoundResult, {
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
    expect(page.getByTestId('map-popup').element().textContent).toContain('Guess');
  });

  // The 409-recovery path (task 9's play page) re-shows a result with an answer but no guess of its
  // own - that request never reached the server, so there is nothing to plot for it.
  it('renders an answer-only marker when there is no guess to plot alongside it', async () => {
    await render(RoundResult, {
      ...base,
      type: 'location' as const,
      score: 3200,
      answer: { date: null, lat: 10, lon: 20 },
    });

    expect(page.getByTestId('map-stub').element()).toHaveAttribute('data-marker-count', '1');
    expect(page.getByTestId('map-stub').element()).toHaveAttribute('data-marker-ids', 'answer');
  });

  it('renders for a date round with the offset text', async () => {
    await render(RoundResult, {
      ...base,
      type: 'date' as const,
      score: 4000,
      offsetDays: 3,
      answer: { date: '2026-03-05T00:00:00.000Z', lat: null, lon: null },
    });

    expect(page.getByTestId('round-result').element()).toBeInTheDocument();
    expect(page.getByText('You were 3 days off').element()).toBeInTheDocument();
    // A date round has no coordinates to plot — the map must not render at all.
    expect(page.getByTestId('map-stub').query()).not.toBeInTheDocument();
  });

  it('renders a 0% bar for a score of 0', async () => {
    await render(RoundResult, { ...base, type: 'date' as const, score: 0, offsetDays: 90 });
    expect(page.getByTestId('round-result-bar').element().style.width).toBe('0%');
  });

  it('renders a 100% bar for a perfect score', async () => {
    await render(RoundResult, { ...base, type: 'date' as const, score: 5000, offsetDays: 0 });
    expect(page.getByTestId('round-result-bar').element().style.width).toBe('100%');
  });

  it('calls onNext when the next-round button is clicked', async () => {
    const onNext = vi.fn();
    await render(RoundResult, { ...base, type: 'date' as const, score: 1000, offsetDays: 10, onNext });

    await userEvent.click(page.getByTestId('round-result-next').element());

    expect(onNext).toHaveBeenCalledTimes(1);
  });
});
