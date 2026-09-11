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

  const mapPanel = () => screen.getByTestId('location-round-map');
  /** Puts the map in its expanded state the way a mouse user does, so a click can place a pin. */
  const hoverMapWithMouse = () => fireEvent.pointerEnter(mapPanel(), { pointerType: 'mouse' });

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

    // The map must be expanded first - a click on the collapsed map is spent expanding it and
    // never reaches the pin (see the expand/collapse tests below).
    await hoverMapWithMouse();
    await fireEvent.click(screen.getByTestId('map-stub-click-point-antimeridian'));
    await fireEvent.click(screen.getByTestId('location-round-guess'));

    expect(onGuess).toHaveBeenCalledWith({ lat: 5, lon: -160 });
  });

  // Placing a pin is mouse/touch-only, so the Guess button's enabled state was changing with
  // nothing announced to a screen reader. The aria-live region must be empty beforehand (an
  // aria-live region only announces a CHANGE) and populated with the placed coordinates once a
  // pin lands - genuinely informative content, not just a state-change tone (no i18n key needed
  // since it's numbers, not a translated sentence).
  it('announces the placed coordinates once a pin is placed', async () => {
    render(LocationRound, base);

    const announcement = screen.getByTestId('location-round-pin-announcement');
    expect(announcement).toHaveAttribute('aria-live', 'polite');
    expect(announcement).toHaveTextContent('');

    // map-component.stub.svelte's click-point button fires { lat: 12.5, lng: 45.5 }.
    await hoverMapWithMouse();
    await fireEvent.click(screen.getByTestId('map-stub-click-point'));

    expect(announcement).toHaveTextContent('12.50, 45.50');
  });

  // GeoGuessr-style expand-on-hover. The map is a small inset while the player studies the photo
  // and grows to a usable size the moment the pointer reaches it, so no click is spent opening it.
  describe('expanding the guess map', () => {
    it('expands while a mouse pointer is over the map and collapses when it leaves', async () => {
      render(LocationRound, base);
      expect(mapPanel()).toHaveAttribute('data-expanded', 'false');

      await hoverMapWithMouse();
      expect(mapPanel()).toHaveAttribute('data-expanded', 'true');

      await fireEvent.pointerLeave(mapPanel(), { pointerType: 'mouse' });
      expect(mapPanel()).toHaveAttribute('data-expanded', 'false');
    });

    // Load-bearing pointerType check. Touch browsers fire an emulated pointerenter on tap, right
    // before the click. If that emulated enter expanded the map, the very same tap would then land
    // as a pin - dropping a guess wherever the player happened to touch a 288px-wide map, which is
    // exactly what expand-on-tap exists to prevent. Only a real mouse may expand by hovering.
    it('ignores a touch pointerenter, so one tap cannot both expand the map and drop a pin', async () => {
      render(LocationRound, base);

      await fireEvent.pointerEnter(mapPanel(), { pointerType: 'touch' });

      expect(mapPanel()).toHaveAttribute('data-expanded', 'false');
    });

    // The touch path: with no hover available, the first tap is spent expanding the map. Asserting
    // the guess button stays disabled proves the tap really did not reach the pin - a data-expanded
    // assertion alone would still pass if the tap both expanded the map AND placed a pin.
    it('spends a tap on the collapsed map expanding it, placing no pin', async () => {
      render(LocationRound, base);

      await fireEvent.click(screen.getByTestId('map-stub-click-point'));

      expect(mapPanel()).toHaveAttribute('data-expanded', 'true');
      expect(screen.getByTestId('location-round-guess')).toBeDisabled();
      expect(screen.getByTestId('location-round-pin-announcement')).toHaveTextContent('');
    });

    it('places the pin on the second tap, once the first has expanded the map', async () => {
      render(LocationRound, base);

      // The full touch sequence, asserted step by step. Checking the button is still disabled
      // between the two taps is what makes this fail against an ungated map, where the first tap
      // already places the pin - without it the test passes either way and proves nothing.
      await fireEvent.click(screen.getByTestId('map-stub-click-point'));
      expect(screen.getByTestId('location-round-guess')).toBeDisabled();

      await fireEvent.click(screen.getByTestId('map-stub-click-point'));
      expect(screen.getByTestId('location-round-guess')).toBeEnabled();
      expect(screen.getByTestId('location-round-pin-announcement')).toHaveTextContent('12.50, 45.50');
    });
  });
});
