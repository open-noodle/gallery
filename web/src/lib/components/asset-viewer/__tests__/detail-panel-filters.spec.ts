import { AssetTypeEnum, AssetVisibility, type AlbumResponseDto, type AssetResponseDto } from '@immich/sdk';
import '@testing-library/jest-dom';
import { fireEvent, screen, waitFor } from '@testing-library/svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildContextualFilterUrl } from '$lib/utils/filter-target';
import { renderWithTooltips } from '$tests/helpers';
import { assetFactory } from '@test-data/factories/asset-factory';
import { reactivePageMock as mockPage } from '@test-data/mocks/reactive-page.mock.svelte';
import DetailPanel from '../DetailPanel.svelte';

// Task 2 of Slice 7 (asset-viewer-contextual-filters). Per the plan's R5, this is a NEW, dedicated
// spec file — the existing detail-panel.spec.ts noop-mocks several children this branch's later
// tasks rewrite, so it is the wrong place to grow filter-grammar coverage. Camera and lens live
// INLINE in DetailPanel.svelte (not their own child components), so they need no such mock here.

const { gotoMock, getAllAlbumsMock, getAssetInfoMock } = vi.hoisted(() => ({
  gotoMock: vi.fn().mockResolvedValue(undefined),
  getAllAlbumsMock: vi.fn(),
  getAssetInfoMock: vi.fn(),
}));

vi.mock('@immich/sdk', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@immich/sdk')>();
  return {
    ...actual,
    getAllAlbums: getAllAlbumsMock,
    getAssetInfo: getAssetInfoMock,
  };
});

vi.mock('$app/navigation', () => ({ goto: gotoMock }));

// applyContextualFilter (via resolveFilterTarget) reads the reactive `page` from $app/state. A
// plain vi.hoisted literal registers no signal and — more importantly here — can't be reset to a
// different URL per test the way driving four different FilterTarget surfaces requires. See
// reactive-page.mock.svelte.ts's own docs for why this needs to be the shared $state stand-in.
vi.mock('$app/state', async () => {
  const { reactivePageMock } = await import('@test-data/mocks/reactive-page.mock.svelte');
  return { page: reactivePageMock };
});

const authManagerMock = vi.hoisted(() => ({
  authenticated: true,
  user: { id: 'owner-1' },
  isSharedLink: false,
  params: {},
  preferences: { tags: { enabled: false }, ratings: { enabled: false } },
}));

vi.mock('$lib/managers/auth-manager.svelte', () => ({
  authManager: authManagerMock,
}));

vi.mock('$lib/managers/asset-viewer-manager.svelte', () => ({
  assetViewerManager: {
    closeDetailPanel: vi.fn(),
    closeEditFacesPanel: vi.fn(),
    isEditFacesPanelOpen: false,
    isShowAssetPath: false,
    openEditFacesPanel: vi.fn(),
    toggleAssetPath: vi.fn(),
    toggleFaceEditMode: vi.fn(),
  },
}));

const featureFlagsMock = vi.hoisted(() => ({ value: { map: false, smartSearch: false } }));

vi.mock('$lib/managers/feature-flags-manager.svelte', () => ({
  featureFlagsManager: featureFlagsMock,
}));

// The embedded map is a dynamic import; the stub exposes its "open in map view" control as a button.
vi.mock('$lib/components/shared-components/map/Map.svelte', async () => {
  const { default: MockComponent } = await import('@test-data/mocks/map-component.stub.svelte');
  return { default: MockComponent };
});

vi.mock('$lib/components/shared-components/UserAvatar.svelte', async () => {
  const { default: MockComponent } = await import('@test-data/mocks/noop-component.svelte');
  return { default: MockComponent };
});

vi.mock('$lib/components/asset-viewer/AlbumListItemDetails.svelte', async () => {
  const { default: MockComponent } = await import('@test-data/mocks/noop-component.svelte');
  return { default: MockComponent };
});

const buildAsset = (overrides: Partial<AssetResponseDto> = {}): AssetResponseDto =>
  assetFactory.build({
    id: 'asset-1',
    ownerId: 'owner-1',
    type: AssetTypeEnum.Image,
    visibility: AssetVisibility.Timeline,
    ...overrides,
  });

beforeEach(() => {
  vi.clearAllMocks();
  gotoMock.mockResolvedValue(undefined);
  getAllAlbumsMock.mockResolvedValue([]);
  getAssetInfoMock.mockResolvedValue(undefined);
  authManagerMock.isSharedLink = false;
  featureFlagsMock.value.map = false;
});

describe('DetailPanel camera filter', () => {
  // The four FilterTarget kinds resolveFilterTarget understands (filter-target.ts).
  const surfaces = [
    { label: '/photos', url: 'https://gallery.test/photos/asset-1', basePath: '/photos' },
    { label: 'a Space', url: 'https://gallery.test/spaces/space-1/photos/asset-1', basePath: '/spaces/space-1' },
    { label: 'an album', url: 'https://gallery.test/albums/album-1/photos/asset-1', basePath: '/albums/album-1' },
    { label: 'the map', url: 'https://gallery.test/map/photos/asset-1', basePath: '/map' },
  ];

  it.each(surfaces)(
    'clicking the value emits { make, model } TOGETHER and filters $label, closing the viewer',
    async ({ url, basePath }) => {
      mockPage.reset(url);
      const asset = buildAsset({ exifInfo: { make: 'Apple', model: 'iPhone 17 Pro Max' } });

      renderWithTooltips(DetailPanel, { asset, currentAlbum: null });

      await fireEvent.click(await screen.findByLabelText(/filter_by_camera/));

      // Computed via the REAL (unmocked) buildContextualFilterUrl against the same mocked page.url
      // applyContextualFilter reads — this is the wiring test, not a re-test of the pure builder.
      const expected = buildContextualFilterUrl(mockPage.url, { make: 'Apple', model: 'iPhone 17 Pro Max' });
      expect(gotoMock).toHaveBeenCalledWith(expected);
      expect(expected.startsWith(basePath)).toBe(true);
      expect(expected).not.toContain('asset-1'); // a single goto() closes the asset viewer
      expect(expected).toContain('make=Apple');
      expect(expected).toContain('model=');
    },
  );

  // R2 — the camera anchor is ONE control for make+model TOGETHER, never split. A model-only asset
  // must still expose exactly one clickable camera affordance (not a separate make-only control),
  // and its patch still carries both keys (make simply absent when there is none).
  it('R2: is a single affordance for make+model together, even when only one is present', async () => {
    mockPage.reset('https://gallery.test/photos/asset-1');
    const asset = buildAsset({ exifInfo: { model: 'iPhone 17 Pro Max', make: undefined } });

    renderWithTooltips(DetailPanel, { asset, currentAlbum: null });

    await waitFor(() => expect(screen.getByTestId('detail-panel-camera')).toBeInTheDocument());
    expect(screen.getAllByLabelText(/filter_by_camera/)).toHaveLength(1);

    await fireEvent.click(screen.getByLabelText(/filter_by_camera/));

    const [url] = gotoMock.mock.calls[0] as [string];
    expect(url).toContain('model=');
  });

  // P1 (soft check here; Task 6 generalises this into a full property test across every row and
  // surface). The patch emitted from clicking must be exactly the asset's own EXIF values, or the
  // resulting filter could exclude the very asset it was clicked on.
  it('P1: the emitted patch matches the asset’s own EXIF make/model', async () => {
    mockPage.reset('https://gallery.test/photos/asset-1');
    const asset = buildAsset({ exifInfo: { make: 'Canon', model: 'EOS R5' } });

    renderWithTooltips(DetailPanel, { asset, currentAlbum: null });

    await fireEvent.click(await screen.findByLabelText(/filter_by_camera/));

    const [url] = gotoMock.mock.calls[0] as [string];
    const decoded = new URLSearchParams(url.split('?', 2)[1]);
    expect(decoded.get('make')).toBe(asset.exifInfo?.make);
    expect(decoded.get('model')).toBe(asset.exifInfo?.model);
  });

  it('the 🔍 icon applies the same patch with { global: true }, landing on /photos carrying nothing over', async () => {
    mockPage.reset(
      'https://gallery.test/spaces/space-1/photos/asset-1?q=beach&sort=asc&people=space-person:p1&city=Berlin',
    );
    const asset = buildAsset({ exifInfo: { make: 'Apple', model: 'iPhone 17 Pro Max' } });

    renderWithTooltips(DetailPanel, { asset, currentAlbum: null });

    await fireEvent.click(await screen.findByLabelText(/search_everywhere/));

    const [url] = gotoMock.mock.calls[0] as [string];
    expect(url.startsWith('/photos')).toBe(true);
    expect(url).toContain('make=Apple');
    expect(url).not.toContain('/spaces');
    expect(url).not.toContain('q=');
    expect(url).not.toContain('city=');
    expect(url).not.toContain('space-person');
  });

  // E5 — the global icon would be a no-op on /photos (the primary click already lands there).
  it('E5: hides the 🔍 icon when already on /photos', async () => {
    mockPage.reset('https://gallery.test/photos/asset-1');
    const asset = buildAsset({ exifInfo: { make: 'Apple', model: 'iPhone 17 Pro Max' } });

    renderWithTooltips(DetailPanel, { asset, currentAlbum: null });

    await screen.findByLabelText(/filter_by_camera/);
    expect(screen.queryByLabelText(/search_everywhere/)).not.toBeInTheDocument();
  });

  // Elsewhere the icon is shown.
  it('shows the 🔍 icon on non-/photos surfaces', async () => {
    mockPage.reset('https://gallery.test/spaces/space-1/photos/asset-1');
    const asset = buildAsset({ exifInfo: { make: 'Apple', model: 'iPhone 17 Pro Max' } });

    renderWithTooltips(DetailPanel, { asset, currentAlbum: null });

    await waitFor(() => expect(screen.getByLabelText(/search_everywhere/)).toBeInTheDocument());
  });

  // R9/E6/E7 — make is truthy as a whitespace-only string ('   '), so the OLD `{#if make || model}`
  // guard alone would render it as a clickable filter — but the patch trims to nothing, so the click
  // would close the viewer and apply no filter. Must not be rendered as clickable at all.
  it('R9: a whitespace-only value is not rendered as clickable', async () => {
    mockPage.reset('https://gallery.test/photos/asset-1');
    const asset = buildAsset({ exifInfo: { make: ' '.repeat(3), model: undefined } });

    renderWithTooltips(DetailPanel, { asset, currentAlbum: null });

    await waitFor(() => expect(screen.getByTestId('detail-panel-camera')).toBeInTheDocument());
    expect(screen.queryByLabelText(/filter_by_camera/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/search_everywhere/)).not.toBeInTheDocument();
  });

  // E2 — a shared link gets NO filter affordance at all, and the old Route.search(...) anchors
  // (which leak today, R4) must not exist regardless.
  it('E2: a shared link renders no filter affordance and no /search anchor', async () => {
    authManagerMock.isSharedLink = true;
    mockPage.reset('https://gallery.test/share/abc/photos/asset-1');
    const asset = buildAsset({ exifInfo: { make: 'Apple', model: 'iPhone 17 Pro Max' } });

    const { container } = renderWithTooltips(DetailPanel, { asset, currentAlbum: null });

    await waitFor(() => expect(screen.getByTestId('detail-panel-camera')).toBeInTheDocument());
    expect(screen.queryByLabelText(/filter_by_camera/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/search_everywhere/)).not.toBeInTheDocument();
    expect(container.querySelector('a[href*="/search"]')).toBeNull();
    expect(gotoMock).not.toHaveBeenCalled();
  });
});

// #732, restated for the mechanism that replaced the /search links. The old bug: the camera
// anchor jumped to /search, whose metadata search is scoped to own + partner assets, so a Space
// member clicking the camera of a photo ANOTHER member shared into the Space got zero results —
// not even the photo they had just clicked on. #927 fixed that by sending withSharedSpaces:true
// on the anchor; this branch deletes the anchor instead, so that fix has to be re-proven here.
//
// It holds for a different reason now: the click filters the surface you are standing on, and the
// Space timeline already contains every member's contributions. The photo you clicked cannot fall
// out of scope, because the scope IS the Space. The 🔍 escape to /photos keeps the co-member's
// photo too — buildPhotosTimelineOptions sends withSharedSpaces there (pinned in
// utils/__tests__/photos-filter-options.spec.ts), which is the same guarantee #927 asserted.
describe('DetailPanel shared-space coverage (#732)', () => {
  it('a co-member’s photo in a Space filters the Space, not the owner-scoped /search', async () => {
    mockPage.reset('https://gallery.test/spaces/space-1/photos/asset-1');
    const asset = buildAsset({ ownerId: 'someone-else', exifInfo: { make: 'Apple', model: 'iPhone 17 Pro' } });

    const { container } = renderWithTooltips(DetailPanel, { asset, currentAlbum: null });

    await fireEvent.click(await screen.findByLabelText(/filter_by_camera/));

    const [target] = gotoMock.mock.calls.at(-1) as [string];
    expect(target.startsWith('/spaces/space-1')).toBe(true);
    expect(target).toContain('make=Apple');
    // The owner-scoped page the bug sent people to. Nothing may route there any more.
    expect(target).not.toContain('/search');
    expect(container.querySelector('a[href*="/search"]')).toBeNull();
  });

  it('the same holds for the lens row', async () => {
    mockPage.reset('https://gallery.test/spaces/space-1/photos/asset-1');
    const asset = buildAsset({ ownerId: 'someone-else', exifInfo: { lensModel: 'iPhone 17 Pro front camera' } });

    const { container } = renderWithTooltips(DetailPanel, { asset, currentAlbum: null });

    await fireEvent.click(await screen.findByLabelText(/filter_by_lens/));

    const [target] = gotoMock.mock.calls.at(-1) as [string];
    expect(target.startsWith('/spaces/space-1')).toBe(true);
    // `lensModel` is the FilterState key; the URL codec spells it `lens` (filter-url.ts).
    expect(target).toContain('lens=iPhone');
    expect(target).not.toContain('/search');
    expect(container.querySelector('a[href*="/search"]')).toBeNull();
  });
});

// Task 4 — the filename row lives inline in DetailPanel.svelte too. The patch is the basename
// WITHOUT its extension: that is what surfaces a RAW/JPEG pair (IMG_1234.CR3 + IMG_1234.jpg) and
// edited variants of the same shot.
describe('DetailPanel filename filter', () => {
  it.each([
    { originalFileName: 'IMG_1234.jpg', basename: 'IMG_1234' },
    { originalFileName: 'my.photo.v2.jpg', basename: 'my.photo.v2' },
    { originalFileName: 'IMG_1234', basename: 'IMG_1234' },
  ])('clicking $originalFileName emits { originalFileName: $basename }', async ({ originalFileName, basename }) => {
    mockPage.reset('https://gallery.test/spaces/space-1/photos/asset-1');
    const asset = buildAsset({ originalFileName });

    renderWithTooltips(DetailPanel, { asset, currentAlbum: null });

    await fireEvent.click(await screen.findByLabelText(`filter_by_filename: ${basename}`));

    const expected = buildContextualFilterUrl(mockPage.url, { originalFileName: basename });
    expect(gotoMock).toHaveBeenCalledWith(expected);
    expect(expected.startsWith('/spaces/space-1')).toBe(true);
    expect(expected).not.toContain('asset-1'); // one goto() closes the asset viewer

    const params = new URLSearchParams(expected.split('?', 2)[1]);
    expect(params.get('filename')).toBe(basename);
  });

  // R9/E7 — a leading-dot name has an EMPTY basename, so the patch would trim to nothing: the click
  // would close the viewer and apply no filter at all. Not clickable.
  it('R9: a name whose basename is empty (".jpg") is not clickable', async () => {
    mockPage.reset('https://gallery.test/photos/asset-1');
    const asset = buildAsset({ originalFileName: '.jpg' });

    renderWithTooltips(DetailPanel, { asset, currentAlbum: null });

    await waitFor(() => expect(screen.getByTestId('detail-panel-filename')).toBeInTheDocument());
    expect(screen.queryByLabelText(/^filter_by_filename/)).not.toBeInTheDocument();
    expect(screen.getByText('.jpg')).toBeInTheDocument();
  });

  // R6/R9 — the path toggle lives inside the SAME <p> as the filename text. Only the text becomes
  // the filter trigger; the toggle must keep working (detail-panel-path.spec.ts covers it too).
  it('keeps the file-location toggle working next to the filter trigger', async () => {
    mockPage.reset('https://gallery.test/photos/asset-1');
    const asset = buildAsset({ originalFileName: 'IMG_1234.jpg', originalPath: '/photos/IMG_1234.jpg' });

    renderWithTooltips(DetailPanel, { asset, currentAlbum: null });

    await waitFor(() => expect(screen.getByLabelText('show_file_location')).toBeInTheDocument());
    await fireEvent.click(screen.getByLabelText('show_file_location'));

    expect(gotoMock).not.toHaveBeenCalled();
  });

  it('E2: a shared link renders no filename filter affordance', async () => {
    authManagerMock.isSharedLink = true;
    mockPage.reset('https://gallery.test/share/abc/photos/asset-1');
    const asset = buildAsset({ originalFileName: 'IMG_1234.jpg' });

    renderWithTooltips(DetailPanel, { asset, currentAlbum: null });

    await waitFor(() => expect(screen.getByTestId('detail-panel-filename')).toBeInTheDocument());
    expect(screen.getByText('IMG_1234.jpg')).toBeInTheDocument();
    expect(screen.queryByLabelText(/^filter_by_filename/)).not.toBeInTheDocument();
    expect(gotoMock).not.toHaveBeenCalled();
  });
});

describe('DetailPanel lens filter', () => {
  it('clicking the value emits { lensModel } and filters the current surface', async () => {
    mockPage.reset('https://gallery.test/spaces/space-1/photos/asset-1');
    const asset = buildAsset({ exifInfo: { lensModel: 'RF 24-70mm f/2.8L' } });

    renderWithTooltips(DetailPanel, { asset, currentAlbum: null });

    await fireEvent.click(await screen.findByLabelText(/filter_by_lens/));

    const expected = buildContextualFilterUrl(mockPage.url, { lensModel: 'RF 24-70mm f/2.8L' });
    expect(gotoMock).toHaveBeenCalledWith(expected);
    expect(expected.startsWith('/spaces/space-1')).toBe(true);
    expect(expected).toContain('lens=');
  });

  it('the 🔍 icon applies { lensModel } with { global: true }, landing on /photos', async () => {
    mockPage.reset('https://gallery.test/spaces/space-1/photos/asset-1?city=Berlin');
    const asset = buildAsset({ exifInfo: { lensModel: 'RF 24-70mm f/2.8L' } });

    renderWithTooltips(DetailPanel, { asset, currentAlbum: null });

    await fireEvent.click(await screen.findByLabelText(/search_everywhere/));

    const [url] = gotoMock.mock.calls[0] as [string];
    expect(url.startsWith('/photos')).toBe(true);
    expect(url).toContain('lens=');
    expect(url).not.toContain('city=');
  });

  // E5 for the lens row too.
  it('E5: hides the 🔍 icon when already on /photos', async () => {
    mockPage.reset('https://gallery.test/photos/asset-1');
    const asset = buildAsset({ exifInfo: { lensModel: 'RF 24-70mm f/2.8L' } });

    renderWithTooltips(DetailPanel, { asset, currentAlbum: null });

    await screen.findByLabelText(/filter_by_lens/);
    expect(screen.queryByLabelText(/search_everywhere/)).not.toBeInTheDocument();
  });

  it('R9: a whitespace-only lensModel is not rendered as clickable', async () => {
    mockPage.reset('https://gallery.test/photos/asset-1');
    const asset = buildAsset({ exifInfo: { lensModel: ' '.repeat(3) } });

    renderWithTooltips(DetailPanel, { asset, currentAlbum: null });

    await waitFor(() => expect(screen.getByTestId('detail-panel-lens')).toBeInTheDocument());
    expect(screen.queryByLabelText(/filter_by_lens/)).not.toBeInTheDocument();
  });

  it('E2: a shared link renders no filter affordance and no /search anchor', async () => {
    authManagerMock.isSharedLink = true;
    mockPage.reset('https://gallery.test/share/abc/photos/asset-1');
    const asset = buildAsset({ exifInfo: { lensModel: 'RF 24-70mm f/2.8L' } });

    const { container } = renderWithTooltips(DetailPanel, { asset, currentAlbum: null });

    await waitFor(() => expect(screen.getByTestId('detail-panel-lens')).toBeInTheDocument());
    expect(screen.queryByLabelText(/filter_by_lens/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/search_everywhere/)).not.toBeInTheDocument();
    expect(container.querySelector('a[href*="/search"]')).toBeNull();
    expect(gotoMock).not.toHaveBeenCalled();
  });
});

// Task 5 — the rows that live inline in DetailPanel.svelte: "shared by", "appears in", and the
// embedded map's "open in map view" control.

const OWNER = {
  id: 'owner-2',
  name: 'Bob',
  email: 'bob@example.com',
  profileImagePath: '',
  avatarColor: 'primary',
  profileChangedAt: '2026-01-01T00:00:00.000Z',
} as AssetResponseDto['owner'];

// Two albumUsers, not one: DetailPanel only renders the "shared by" row for an album shared with
// more than one person (upstream #30187 — a single-member album has nobody to attribute it to).
const currentAlbum = {
  id: 'album-1',
  albumName: 'Trip',
  albumUsers: [
    { role: 'editor', user: OWNER },
    { role: 'viewer', user: { ...OWNER, id: 'owner-1', name: 'Me', email: 'me@example.com' } },
  ],
} as unknown as AlbumResponseDto;

const albumDto = (id: string, albumName: string) =>
  ({ id, albumName, albumThumbnailAssetId: null, albumUsers: [], assetCount: 3 }) as unknown as AlbumResponseDto;

describe('DetailPanel shared-by filter', () => {
  it('the owner name is a button that emits { ownerId }', async () => {
    mockPage.reset('https://gallery.test/albums/album-1/photos/asset-1');
    const asset = buildAsset({ owner: OWNER });

    renderWithTooltips(DetailPanel, { asset, currentAlbum });

    await fireEvent.click(await screen.findByLabelText('filter_by_owner: Bob'));

    const expected = buildContextualFilterUrl(mockPage.url, { ownerId: 'owner-2' });
    expect(gotoMock).toHaveBeenCalledWith(expected);
    expect(expected.startsWith('/albums/album-1')).toBe(true);
    expect(expected).toContain('owner=owner-2');
  });

  // E2 — this row is NOT shared-link-suppressed today (unlike tags/people/rating/albums), so its
  // gate is the one that actually matters.
  it('E2: a shared link renders the name as plain text, with no filter affordance', async () => {
    authManagerMock.isSharedLink = true;
    mockPage.reset('https://gallery.test/share/abc/photos/asset-1');
    const asset = buildAsset({ owner: OWNER });

    renderWithTooltips(DetailPanel, { asset, currentAlbum });

    expect(await screen.findByText('Bob')).toBeInTheDocument();
    expect(screen.queryByLabelText(/^filter_by_owner/)).not.toBeInTheDocument();
    expect(gotoMock).not.toHaveBeenCalled();
  });
});

describe('DetailPanel appears-in album filter', () => {
  it('the ⚗️ icon emits { albumId } for an album the asset appears in', async () => {
    mockPage.reset('https://gallery.test/photos/asset-1');
    getAllAlbumsMock.mockResolvedValue([albumDto('album-7', 'Iceland')]);

    renderWithTooltips(DetailPanel, { asset: buildAsset(), currentAlbum: null });

    await fireEvent.click(await screen.findByLabelText('filter_by_album: Iceland'));

    const expected = buildContextualFilterUrl(mockPage.url, { albumId: 'album-7' });
    expect(gotoMock).toHaveBeenCalledWith(expected);
    expect(expected).toContain('albumId=album-7');
  });

  // The card is an <a>; a button nested inside an anchor is invalid HTML.
  it('renders the ⚗️ BESIDE the album card link, never inside it', async () => {
    mockPage.reset('https://gallery.test/photos/asset-1');
    getAllAlbumsMock.mockResolvedValue([albumDto('album-7', 'Iceland')]);

    renderWithTooltips(DetailPanel, { asset: buildAsset(), currentAlbum: null });

    const button = await screen.findByLabelText('filter_by_album: Iceland');
    expect(button.tagName).toBe('BUTTON');
    expect(button.closest('a')).toBeNull();
  });

  // E9 — an album surface offers NO album ⚗️ AT ALL, for any album (not merely for the album you
  // are in). buildAlbumTimelineOptions never forwards `albumId` (the route already scopes the
  // query), while getActiveFilterCount counts it and a chip renders. So on /albums/A, filtering by
  // album B would show a "1 filter" badge and a removable B chip over a grid that is still the whole
  // of A — the exact counted-but-not-applied lie this branch keeps killing. P1 cannot catch it (the
  // asset IS still in the result set), so it is pinned here.
  it('E9: an album surface offers no album ⚗️ at all — not for this album, not for another', async () => {
    mockPage.reset('https://gallery.test/albums/album-7/photos/asset-1');
    getAllAlbumsMock.mockResolvedValue([albumDto('album-7', 'Iceland'), albumDto('album-8', 'Norway')]);

    renderWithTooltips(DetailPanel, { asset: buildAsset(), currentAlbum: albumDto('album-7', 'Iceland') });

    // The cards still render (they navigate to the album) — only the filter affordance is withheld.
    await waitFor(() => expect(screen.getByText('Norway')).toBeInTheDocument());
    expect(screen.queryByLabelText('filter_by_album: Iceland')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('filter_by_album: Norway')).not.toBeInTheDocument();
  });

  it('E2: a shared link renders no album filter affordance', async () => {
    authManagerMock.isSharedLink = true;
    mockPage.reset('https://gallery.test/share/abc/photos/asset-1');
    // getAllAlbums is never called on a shared link (refreshAlbums returns [] early), but pin the
    // affordance's absence regardless of what the fetch would have returned.
    getAllAlbumsMock.mockResolvedValue([albumDto('album-7', 'Iceland')]);

    renderWithTooltips(DetailPanel, { asset: buildAsset(), currentAlbum: null });

    await waitFor(() => expect(screen.getByTestId('detail-panel-filename')).toBeInTheDocument());
    expect(screen.queryByLabelText(/^filter_by_album/)).not.toBeInTheDocument();
  });

  // E9b — a SPACE-scoped map drops an albumId filter (space ∩ album is unsatisfiable, the server
  // 400s it — see hydrateMapFilters / buildContextualMapUrl), so offering the album ⚗️ there would
  // be a dead affordance: the grid never filters and no chip appears. Withhold it, like E9's album
  // surface. P1 cannot catch this (the clicked asset stays in the result set).
  it('E9b: a space-scoped map offers no album ⚗️ — albumId is unsupported there', async () => {
    mockPage.reset('https://gallery.test/map/photos/asset-1?spaceId=space-1');
    getAllAlbumsMock.mockResolvedValue([albumDto('album-7', 'Iceland')]);

    renderWithTooltips(DetailPanel, { asset: buildAsset(), currentAlbum: null });

    // The album card still renders (it navigates); only the filter affordance is withheld.
    await waitFor(() => expect(screen.getByText('Iceland')).toBeInTheDocument());
    expect(screen.queryByLabelText('filter_by_album: Iceland')).not.toBeInTheDocument();
  });

  // Reverse guard: a GLOBAL (non-space) map is a legitimate album scope (/map?albumId=X), so the
  // album ⚗️ must remain there — the suppression is space-scoped only.
  it('a global (non-space) map still offers the album ⚗️', async () => {
    mockPage.reset('https://gallery.test/map/photos/asset-1');
    getAllAlbumsMock.mockResolvedValue([albumDto('album-7', 'Iceland')]);

    renderWithTooltips(DetailPanel, { asset: buildAsset(), currentAlbum: null });

    expect(await screen.findByLabelText('filter_by_album: Iceland')).toBeInTheDocument();
  });
});

// #767 class — the embedded map's "open in map view" control called Route.map({...latlng}) directly,
// dropping the Space scope AND every active filter. It reuses buildContextualMapUrl now, exactly
// like the location row's pin (Task 3).
describe('DetailPanel embedded map: open in map view', () => {
  const BERLIN = { latitude: 52.52, longitude: 13.405, city: 'Berlin', country: 'Germany' };

  it('carries the Space scope AND the active filters to the map view', async () => {
    featureFlagsMock.value.map = true;
    mockPage.reset('https://gallery.test/spaces/space-1/photos/asset-1?make=Apple');

    renderWithTooltips(DetailPanel, { asset: buildAsset({ exifInfo: BERLIN }), currentAlbum: null });

    await fireEvent.click(await screen.findByTestId('map-stub-open-in-map-view'));

    const [url] = gotoMock.mock.calls[0] as [string];
    expect(url.startsWith('/map?')).toBe(true);
    expect(url).toContain('spaceId=space-1');
    expect(url).toContain('make=Apple');
    expect(url).toContain('#12.5/52.52/13.405');
  });

  // Same rule as the location pin: there is no album-map URL, so the control would silently widen
  // "this album" to "the whole library".
  it('offers no map-view control on an album surface', async () => {
    featureFlagsMock.value.map = true;
    mockPage.reset('https://gallery.test/albums/album-1/photos/asset-1');

    renderWithTooltips(DetailPanel, { asset: buildAsset({ exifInfo: BERLIN }), currentAlbum: null });

    await waitFor(() => expect(screen.getByTestId('map-stub')).toBeInTheDocument());
    expect(screen.queryByTestId('map-stub-open-in-map-view')).not.toBeInTheDocument();
  });

  it('E2: a shared link gets no map-view control', async () => {
    authManagerMock.isSharedLink = true;
    featureFlagsMock.value.map = true;
    mockPage.reset('https://gallery.test/share/abc/photos/asset-1');

    renderWithTooltips(DetailPanel, { asset: buildAsset({ exifInfo: BERLIN }), currentAlbum: null });

    await waitFor(() => expect(screen.getByTestId('map-stub')).toBeInTheDocument());
    expect(screen.queryByTestId('map-stub-open-in-map-view')).not.toBeInTheDocument();
  });
});
