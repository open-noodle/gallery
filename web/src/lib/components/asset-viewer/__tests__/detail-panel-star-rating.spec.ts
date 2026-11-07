import { reactivePageMock as mockPage } from '#lib/gallery/__mocks__/reactive-page.mock.svelte.ts';
import { buildContextualFilterUrl } from '#lib/utils/filter-target.ts';
import { factory } from '#test/unit/factories.ts';
import { renderWithTooltips } from '#test/unit/helpers.ts';
import { type AssetResponseDto } from '@immich/sdk';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import DetailPanelStarRating from '../DetailPanelStarRating.svelte';

// Task 5 of Slice 7. R6 — the stars ARE the editing control (a star click means "set rating to N"),
// so the filter cannot live on the value. It lives on a separate ⚗️ icon beside it.

const { gotoMock, updateAssetMock } = vi.hoisted(() => ({
  gotoMock: vi.fn().mockResolvedValue(undefined),
  updateAssetMock: vi.fn(),
}));

vi.mock('$app/navigation', async () => ({
  ...(await import('#test/unit/mocks/app-navigation.ts')),
  goto: gotoMock,
}));

vi.mock('$app/state', async () => {
  const { reactivePageMock } = await import('#lib/gallery/__mocks__/reactive-page.mock.svelte.ts');
  return { ...(await import('#test/unit/mocks/app-state.svelte.ts')), page: reactivePageMock };
});

vi.mock('@immich/sdk', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@immich/sdk')>();
  return { ...actual, updateAsset: updateAssetMock };
});

const authManagerMock = vi.hoisted(() => ({
  authenticated: true,
  user: { id: 'owner-1' },
  isSharedLink: false,
  params: {},
  preferences: { ratings: { enabled: true } },
}));

vi.mock('#lib/managers/auth-manager.svelte.js', () => ({ authManager: authManagerMock }));

const buildAsset = (rating: number | null): AssetResponseDto =>
  factory.asset({ id: 'asset-1', ownerId: 'owner-1', exifInfo: { rating } });

beforeEach(() => {
  vi.clearAllMocks();
  gotoMock.mockResolvedValue(undefined);
  updateAssetMock.mockResolvedValue(undefined);
  authManagerMock.isSharedLink = false;
  mockPage.reset('https://gallery.test/photos/asset-1');
});

describe('DetailPanelStarRating filter (R6)', () => {
  const surfaces = [
    { label: '/photos', url: 'https://gallery.test/photos/asset-1', basePath: '/photos' },
    { label: 'a Space', url: 'https://gallery.test/spaces/space-1/photos/asset-1', basePath: '/spaces/space-1' },
    { label: 'an album', url: 'https://gallery.test/albums/album-1/photos/asset-1', basePath: '/albums/album-1' },
    { label: 'the map', url: 'https://gallery.test/map/photos/asset-1', basePath: '/map' },
  ];

  it.each(surfaces)('the ⚗️ icon emits { rating } and filters $label', async ({ url, basePath }) => {
    mockPage.reset(url);

    await renderWithTooltips(DetailPanelStarRating, { asset: buildAsset(4), isOwner: true, canFilter: true });

    await page.getByLabelText(/^filter_by_rating/).click();

    const expected = buildContextualFilterUrl(mockPage.url, { rating: 4 });
    expect(gotoMock).toHaveBeenCalledWith(expected);
    expect(expected.startsWith(basePath)).toBe(true);
    expect(expected).toContain('rating=4');
    expect(expected).not.toContain('asset-1'); // one goto() closes the asset viewer
  });

  // R9 — parseRating rejects anything outside 1..5, so an unrated asset's ⚗️ would close the viewer
  // and apply NOTHING. It must not be rendered at all.
  it.each([0, null])('R9: renders no ⚗️ for an unrated asset (rating %s)', async (rating) => {
    await renderWithTooltips(DetailPanelStarRating, { asset: buildAsset(rating), isOwner: true, canFilter: true });

    await expect.element(page.getByTestId('detail-panel-rating')).toBeInTheDocument();
    await expect.element(page.getByLabelText(/^filter_by_rating/)).not.toBeInTheDocument();
  });

  it('keeps the stars as the EDITING control (clicking a star rates, it does not filter)', async () => {
    await renderWithTooltips(DetailPanelStarRating, { asset: buildAsset(2), isOwner: true, canFilter: true });

    await page.getByTestId('star').nth(4).click();

    expect(gotoMock).not.toHaveBeenCalled();
  });

  it('E2: with canFilter false no ⚗️ renders', async () => {
    await renderWithTooltips(DetailPanelStarRating, { asset: buildAsset(4), isOwner: true, canFilter: false });

    await expect.element(page.getByTestId('detail-panel-rating')).toBeInTheDocument();
    await expect.element(page.getByLabelText(/^filter_by_rating/)).not.toBeInTheDocument();
    expect(gotoMock).not.toHaveBeenCalled();
  });

  // E8 — a non-owner (a Space member) cannot RATE, but can still filter by the rating.
  it('E8: a non-owner still gets the ⚗️', async () => {
    mockPage.reset('https://gallery.test/spaces/space-1/photos/asset-1');

    await renderWithTooltips(DetailPanelStarRating, { asset: buildAsset(5), isOwner: false, canFilter: true });

    await page.getByLabelText(/^filter_by_rating/).click();

    expect(gotoMock).toHaveBeenCalledWith(buildContextualFilterUrl(mockPage.url, { rating: 5 }));
  });
});
