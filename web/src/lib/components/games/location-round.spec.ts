import { render, screen } from '@testing-library/svelte';
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
});
