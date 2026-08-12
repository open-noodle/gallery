import { type AssetResponseDto } from '@immich/sdk';
import { modalManager } from '@immich/ui';
import '@testing-library/jest-dom';
import { fireEvent, screen, waitFor } from '@testing-library/svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildContextualFilterUrl } from '$lib/utils/filter-target';
import { renderWithTooltips } from '$tests/helpers';
import { assetFactory } from '@test-data/factories/asset-factory';
import { reactivePageMock as mockPage } from '@test-data/mocks/reactive-page.mock.svelte';
import DetailPanelLocation from '../DetailPanelLocation.svelte';

// Task 3 of Slice 7 (asset-viewer-contextual-filters). DetailPanelLocation had NO spec file at all
// (plan R5), and it has TWO branches — the value row AND the "add a location" button, which is the
// only entry point to the geo picker for a GPS-less asset and is likewise untested. Both are pinned
// here BEFORE the row's outer <button> is dismantled (R3), so that "fixing" the row cannot silently
// delete the second branch.

const { gotoMock } = vi.hoisted(() => ({
  gotoMock: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('$app/navigation', () => ({ goto: gotoMock }));

// The map pin resolves the CURRENT surface (space / album / map / photos) from `page.url`, so the
// page has to be a reactive, per-test-settable stand-in. See reactive-page.mock.svelte.ts.
vi.mock('$app/state', async () => {
  const { reactivePageMock } = await import('@test-data/mocks/reactive-page.mock.svelte');
  return { page: reactivePageMock };
});

// Keep the real Icon/IconButton (the affordances under test render through them); stub only the
// modal manager, which is what the owner-gated ✏️ opens.
vi.mock('@immich/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@immich/ui')>();
  return {
    ...actual,
    modalManager: { show: vi.fn().mockResolvedValue(undefined) },
  };
});

const buildAsset = (exifInfo: AssetResponseDto['exifInfo']): AssetResponseDto =>
  assetFactory.build({ id: 'asset-1', ownerId: 'owner-1', exifInfo });

const BERLIN = {
  city: 'Berlin',
  state: 'State of Berlin',
  country: 'Germany',
  latitude: 52.52,
  longitude: 13.405,
};

beforeEach(() => {
  vi.clearAllMocks();
  gotoMock.mockResolvedValue(undefined);
  vi.mocked(modalManager.show).mockResolvedValue(undefined as never);
  mockPage.reset('https://gallery.test/photos/asset-1');
});

// R3 — the three branches of this component, pinned so nobody deletes the second one by accident.
describe('DetailPanelLocation branches', () => {
  it('renders the value row when country is set', async () => {
    renderWithTooltips(DetailPanelLocation, { asset: buildAsset(BERLIN), isOwner: true, canFilter: true });

    await waitFor(() => expect(screen.getByTestId('detail-panel-location')).toBeInTheDocument());
    expect(screen.getByText('Berlin')).toBeInTheDocument();
    expect(screen.getByText('State of Berlin')).toBeInTheDocument();
    expect(screen.getByText('Germany')).toBeInTheDocument();
  });

  // The LIVE, previously untested second branch: an owner looking at an asset with no location at
  // all still gets the "Add a location" button — the ONLY way into the geo picker for such an asset.
  it('still renders the add-a-location button for an owner with no city and no country', async () => {
    renderWithTooltips(DetailPanelLocation, { asset: buildAsset({}), isOwner: true, canFilter: true });

    await waitFor(() => expect(screen.getByTestId('detail-panel-location')).toBeInTheDocument());
    expect(screen.getByText('add_a_location')).toBeInTheDocument();
  });

  it('add-a-location still opens the geo picker', async () => {
    renderWithTooltips(DetailPanelLocation, { asset: buildAsset({}), isOwner: true, canFilter: true });

    await fireEvent.click(await screen.findByText('add_a_location'));

    expect(modalManager.show).toHaveBeenCalled();
  });

  it('renders nothing for a non-owner with no location', async () => {
    renderWithTooltips(DetailPanelLocation, { asset: buildAsset({}), isOwner: false, canFilter: true });

    await waitFor(() => expect(screen.queryByTestId('detail-panel-location')).not.toBeInTheDocument());
  });

  // The genuinely dead case: a city but no country renders neither branch.
  it('renders nothing when there is a city but no country', async () => {
    renderWithTooltips(DetailPanelLocation, {
      asset: buildAsset({ city: 'Berlin' }),
      isOwner: true,
      canFilter: true,
    });

    await waitFor(() => expect(screen.queryByTestId('detail-panel-location')).not.toBeInTheDocument());
  });
});

describe('DetailPanelLocation filter grammar', () => {
  const surfaces = [
    { label: '/photos', url: 'https://gallery.test/photos/asset-1', basePath: '/photos' },
    { label: 'a Space', url: 'https://gallery.test/spaces/space-1/photos/asset-1', basePath: '/spaces/space-1' },
    { label: 'an album', url: 'https://gallery.test/albums/album-1/photos/asset-1', basePath: '/albums/album-1' },
    { label: 'the map', url: 'https://gallery.test/map/photos/asset-1', basePath: '/map' },
  ];

  it.each(surfaces)('clicking the city filters $label and closes the viewer', async ({ url, basePath }) => {
    mockPage.reset(url);

    renderWithTooltips(DetailPanelLocation, { asset: buildAsset(BERLIN), isOwner: true, canFilter: true });

    await fireEvent.click(await screen.findByLabelText('filter_by_location: Berlin'));

    // §5.5 — the city patch carries the COUNTRY too, to disambiguate same-named cities.
    const expected = buildContextualFilterUrl(mockPage.url, { city: 'Berlin', country: 'Germany' });
    expect(gotoMock).toHaveBeenCalledWith(expected);
    expect(expected.startsWith(basePath)).toBe(true);
    expect(expected).not.toContain('asset-1'); // one goto() closes the asset viewer
    expect(expected).toContain('city=Berlin');
    expect(expected).toContain('country=Germany');
  });

  it('clicking the state emits { state, country }', async () => {
    mockPage.reset('https://gallery.test/spaces/space-1/photos/asset-1');

    renderWithTooltips(DetailPanelLocation, { asset: buildAsset(BERLIN), isOwner: true, canFilter: true });

    await fireEvent.click(await screen.findByLabelText('filter_by_location: State of Berlin'));

    const expected = buildContextualFilterUrl(mockPage.url, { state: 'State of Berlin', country: 'Germany' });
    expect(gotoMock).toHaveBeenCalledWith(expected);
    expect(expected).toContain('state=');
    expect(expected).toContain('country=Germany');
    expect(expected).not.toContain('city=');
  });

  it('clicking the country emits { country } only', async () => {
    mockPage.reset('https://gallery.test/spaces/space-1/photos/asset-1');

    renderWithTooltips(DetailPanelLocation, { asset: buildAsset(BERLIN), isOwner: true, canFilter: true });

    await fireEvent.click(await screen.findByLabelText('filter_by_location: Germany'));

    const expected = buildContextualFilterUrl(mockPage.url, { country: 'Germany' });
    expect(gotoMock).toHaveBeenCalledWith(expected);
    expect(expected).toContain('country=Germany');
    expect(expected).not.toContain('city=');
    expect(expected).not.toContain('state=');
  });

  // Location is ONE dimension everywhere else (counted once, one folded chip, removed as a unit), so a
  // location click must REPLACE the whole location dimension — not AND with a stale sibling left over
  // from a previous, different-level location filter. Otherwise clicking a state while a city is active
  // yields `city=X AND state=Y`, which the server ANDs to (almost always) zero results with an
  // incoherent chip. Camera avoids this by always emitting BOTH make and model; location must too.
  it('clicking the city clears a stale state/country from a prior location filter', async () => {
    mockPage.reset('https://gallery.test/photos/asset-1?state=Bavaria&country=Austria');

    renderWithTooltips(DetailPanelLocation, { asset: buildAsset(BERLIN), isOwner: true, canFilter: true });

    await fireEvent.click(await screen.findByLabelText('filter_by_location: Berlin'));

    const url = gotoMock.mock.calls[0][0] as string;
    expect(url).toContain('city=Berlin');
    expect(url).toContain('country=Germany'); // the clicked asset's country replaces the stale one
    expect(url).not.toContain('Austria'); // stale country gone
    expect(url).not.toContain('state='); // stale state gone
  });

  it('clicking the state clears a stale city from a prior location filter', async () => {
    mockPage.reset('https://gallery.test/photos/asset-1?city=Munich&country=Germany');

    renderWithTooltips(DetailPanelLocation, { asset: buildAsset(BERLIN), isOwner: true, canFilter: true });

    await fireEvent.click(await screen.findByLabelText('filter_by_location: State of Berlin'));

    const url = gotoMock.mock.calls[0][0] as string;
    expect(url).toContain('state=');
    expect(url).toContain('country=Germany');
    expect(url).not.toContain('city='); // stale city gone
    expect(url).not.toContain('Munich');
  });

  it('clicking the country clears a stale city and state from a prior location filter', async () => {
    mockPage.reset('https://gallery.test/photos/asset-1?city=Munich&state=Bavaria&country=Germany');

    renderWithTooltips(DetailPanelLocation, { asset: buildAsset(BERLIN), isOwner: true, canFilter: true });

    await fireEvent.click(await screen.findByLabelText('filter_by_location: Germany'));

    const url = gotoMock.mock.calls[0][0] as string;
    expect(url).toContain('country=Germany');
    expect(url).not.toContain('city='); // stale city gone
    expect(url).not.toContain('state='); // stale state gone
    expect(url).not.toContain('Munich');
    expect(url).not.toContain('Bavaria');
  });

  // R9/E7 — a whitespace-only value trims to nothing, so a click would close the viewer and apply
  // NO filter. It must not be clickable at all (the country line still is).
  it('R9: a whitespace-only city line is not clickable', async () => {
    renderWithTooltips(DetailPanelLocation, {
      asset: buildAsset({ city: ' '.repeat(3), country: 'Germany' }),
      isOwner: true,
      canFilter: true,
    });

    await waitFor(() => expect(screen.getByLabelText('filter_by_location: Germany')).toBeInTheDocument());
    expect(screen.queryByLabelText(/filter_by_location: \s+$/)).not.toBeInTheDocument();
    expect(screen.getAllByLabelText(/^filter_by_location/)).toHaveLength(1);
  });
});

describe('DetailPanelLocation map pin (E10)', () => {
  it('carries the Space scope AND the active filters, centered on the asset', async () => {
    mockPage.reset('https://gallery.test/spaces/space-1/photos/asset-1?make=Apple');

    renderWithTooltips(DetailPanelLocation, { asset: buildAsset(BERLIN), isOwner: true, canFilter: true });

    const pin = await screen.findByLabelText('view_in_map');
    const href = pin.getAttribute('href') ?? '';

    expect(href.startsWith('/map?')).toBe(true);
    expect(href).toContain('spaceId=space-1');
    expect(href).toContain('make=Apple');
    expect(href).toContain('#12.5/52.52/13.405');
  });

  it('lands on the global map with the active filters from /photos', async () => {
    mockPage.reset('https://gallery.test/photos/asset-1?make=Apple');

    renderWithTooltips(DetailPanelLocation, { asset: buildAsset(BERLIN), isOwner: true, canFilter: true });

    const pin = await screen.findByLabelText('view_in_map');
    const href = pin.getAttribute('href') ?? '';

    expect(href.startsWith('/map?')).toBe(true);
    expect(href).toContain('make=Apple');
    expect(href).not.toContain('spaceId');
  });

  it('keeps the space scope when the viewer was opened from the space map', async () => {
    mockPage.reset('https://gallery.test/map/photos/asset-1?spaceId=space-1&country=Germany');

    renderWithTooltips(DetailPanelLocation, { asset: buildAsset(BERLIN), isOwner: true, canFilter: true });

    const pin = await screen.findByLabelText('view_in_map');
    const href = pin.getAttribute('href') ?? '';

    expect(href).toContain('spaceId=space-1');
    expect(href).toContain('country=Germany');
  });

  // DECISION (E10 only specifies the Space case): there is NO album-map URL — AlbumMap is a modal.
  // A pin on an album would land on the GLOBAL map carrying the album's filters but NOT its album
  // scope: a silent widening from "this album" to "the whole library". We drop the pin instead.
  it('is NOT offered on an album surface (no album-map URL exists — would silently widen scope)', async () => {
    mockPage.reset('https://gallery.test/albums/album-1/photos/asset-1?make=Apple');

    renderWithTooltips(DetailPanelLocation, { asset: buildAsset(BERLIN), isOwner: true, canFilter: true });

    await waitFor(() => expect(screen.getByTestId('detail-panel-location')).toBeInTheDocument());
    expect(screen.queryByLabelText('view_in_map')).not.toBeInTheDocument();
  });

  it('still links to the map for an asset without coordinates (no center)', async () => {
    mockPage.reset('https://gallery.test/photos/asset-1');

    renderWithTooltips(DetailPanelLocation, {
      asset: buildAsset({ city: 'Berlin', country: 'Germany' }),
      isOwner: true,
      canFilter: true,
    });

    const pin = await screen.findByLabelText('view_in_map');
    const href = pin.getAttribute('href') ?? '';

    expect(href.startsWith('/map')).toBe(true);
    expect(href).not.toContain('#');
  });
});

describe('DetailPanelLocation edit + gating', () => {
  it('the owner-gated ✏️ still opens the geo picker', async () => {
    renderWithTooltips(DetailPanelLocation, { asset: buildAsset(BERLIN), isOwner: true, canFilter: true });

    await fireEvent.click(await screen.findByLabelText('edit_location'));

    expect(modalManager.show).toHaveBeenCalled();
  });

  // E8 — a non-owner (e.g. a Space member) can FILTER but cannot EDIT. And, critically, the row is
  // no longer an inert focusable <button> for them (it was, with onclick={undefined}).
  it('E8: a non-owner sees the values and the pin, but no pencil, and the row is not a button', async () => {
    mockPage.reset('https://gallery.test/spaces/space-1/photos/asset-1');

    renderWithTooltips(DetailPanelLocation, { asset: buildAsset(BERLIN), isOwner: false, canFilter: true });

    const row = await screen.findByTestId('detail-panel-location');
    expect(row.tagName).not.toBe('BUTTON');
    expect(screen.getByLabelText('filter_by_location: Berlin')).toBeInTheDocument();
    expect(screen.getByLabelText('view_in_map')).toBeInTheDocument();
    expect(screen.queryByLabelText('edit_location')).not.toBeInTheDocument();
  });

  // E2 — a shared link gets NO filter affordance at all (values render as plain text).
  it('E2: a shared link renders no filter affordance and no map pin', async () => {
    mockPage.reset('https://gallery.test/share/abc/photos/asset-1');

    renderWithTooltips(DetailPanelLocation, { asset: buildAsset(BERLIN), isOwner: false, canFilter: false });

    await waitFor(() => expect(screen.getByTestId('detail-panel-location')).toBeInTheDocument());
    expect(screen.getByText('Berlin')).toBeInTheDocument();
    expect(screen.queryByLabelText(/^filter_by_location/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText('view_in_map')).not.toBeInTheDocument();
    expect(gotoMock).not.toHaveBeenCalled();
  });
});
