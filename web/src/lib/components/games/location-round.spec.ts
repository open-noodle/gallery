import { fireEvent, render, screen } from '@testing-library/svelte';
import LocationRound from '$lib/components/games/location-round.svelte';

// Map.svelte pulls in maplibre-gl, which needs a WebGL canvas happy-dom lacks.
// This is the repo's canonical incantation - copied verbatim from
// src/routes/(user)/map/[[photos=photos]]/[[assetId=id]]/map-page.spec.ts:58-61.
// Note the @test-data ALIAS; a relative path to the stub does not resolve.
vi.mock('$lib/components/shared-components/map/Map.svelte', async () => {
  const { default: MockComponent } = await import('@test-data/mocks/map-component.stub.svelte');
  return { default: MockComponent };
});

describe('LocationRound', () => {
  const base = { challengeId: 'c1', index: 0, onGuess: () => {} };

  it('renders the round surface', () => {
    render(LocationRound, base);
    expect(screen.getByTestId('location-round')).toBeInTheDocument();
  });

  it('disables the guess button until a pin is placed', () => {
    render(LocationRound, base);
    expect(screen.getByTestId('location-round-guess')).toBeDisabled();
  });

  // The settings cog on Map.svelte defaults to visible and, when clicked, refetches and
  // overwrites mapMarkers with the player's entire geotagged library (bypassing the mapMarkers={[]}
  // guard, since mapMarkers is $bindable()) — on a location round that can repopulate the guessing
  // map with pins that include the round's answer. showSettings={false} must be passed explicitly.
  it('never exposes the map settings control, which can leak the answer', () => {
    render(LocationRound, base);
    expect(screen.getByTestId('map-stub')).toHaveAttribute('showsettings', 'false');
  });

  // maplibre's lngLat is not wrapped to [-180, 180]; panning across the antimeridian on a world
  // guessing map routinely yields values like 200, which the server's longitudeSchema rejects.
  // Reproduces the reported 200 -> -160 case end to end through the real onClickPoint -> pin ->
  // onGuess wiring, not just the underlying wrapLongitude helper in isolation.
  it('wraps an out-of-range longitude before handing the guess to onGuess', async () => {
    const onGuess = vi.fn();
    render(LocationRound, { ...base, onGuess });

    await fireEvent.click(screen.getByTestId('map-stub-click-point-antimeridian'));
    await fireEvent.click(screen.getByTestId('location-round-guess'));

    expect(onGuess).toHaveBeenCalledWith({ lat: 5, lon: -160 });
  });
});
