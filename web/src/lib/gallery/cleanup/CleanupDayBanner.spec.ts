import CleanupDayBanner from '#lib/gallery/cleanup/CleanupDayBanner.svelte';
import type { CleanupAssetDto } from '@immich/sdk';
import { expect } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';

const asset = (id: string) => ({ id, thumbhash: null, originalFileName: `${id}.jpg` }) as unknown as CleanupAssetDto;
const assets = Array.from({ length: 14 }, (_, i) => asset(`a${i}`));

const peek = (
  overrides: Partial<{ photos: number; years: number; busiest: { year: number; city: string | null } }> = {},
) => ({
  photos: 42,
  years: 6,
  busiest: { year: 2019, city: 'Lisbon' },
  assets,
  ...overrides,
});

const stubReducedMotion = () => vi.stubGlobal('matchMedia', () => ({ matches: true }));

const renderBanner = (props: Record<string, unknown> = {}) =>
  render(CleanupDayBanner, {
    monthDay: 1028,
    isToday: true,
    peek: peek(),
    reviewed: false,
    pinned: false,
    direction: 0,
    ...props,
  });

describe('CleanupDayBanner', () => {
  beforeEach(stubReducedMotion);
  afterEach(() => vi.unstubAllGlobals());

  it("shows today's eyebrow, counts, estimate and busiest year with its city", async () => {
    await renderBanner();

    const banner = page.getByTestId('cleanup-day-banner');
    await expect.element(banner.getByText('cleanup_banner_today')).toBeVisible();
    await expect.element(banner.getByText('cleanup_banner_photos_years')).toBeVisible();
    await expect.element(banner.getByTestId('cleanup-banner-detail')).toMatchTextContent('cleanup_banner_estimate');
    await expect.element(banner.getByTestId('cleanup-banner-detail')).toMatchTextContent('cleanup_banner_busiest_city');
    await expect.element(page.getByTestId('cleanup-banner-start')).toMatchTextContent('cleanup_start_todays_rewind');
    await expect
      .element(page.getByTestId('cleanup-banner-start'))
      .toHaveAttribute('href', '/utilities/cleanup/rewind/1028');
  });

  it('omits the estimate below one minute, and the city when unknown', async () => {
    await renderBanner({ peek: peek({ photos: 7, busiest: { year: 2019, city: null } }) });

    const detail = page.getByTestId('cleanup-banner-detail');
    await expect.element(detail).not.toMatchTextContent('cleanup_banner_estimate');
    await expect.element(detail).toMatchTextContent('cleanup_banner_busiest');
    await expect.element(detail).not.toMatchTextContent('cleanup_banner_busiest_city');
  });

  it('shows a hovered day by its date with "Rewind this day"', async () => {
    await renderBanner({ monthDay: 314, isToday: false });

    await expect.element(page.getByTestId('cleanup-day-banner')).toMatchTextContent('March 14');
    await expect.element(page.getByText('cleanup_banner_today')).not.toBeInTheDocument();
    await expect.element(page.getByTestId('cleanup-banner-start')).toMatchTextContent('cleanup_rewind_this_day');
    await expect
      .element(page.getByTestId('cleanup-banner-start'))
      .toHaveAttribute('href', '/utilities/cleanup/rewind/314');
  });

  it('says so plainly and disables the button for a date without photos', async () => {
    await renderBanner({ peek: peek({ photos: 0, years: 0, busiest: undefined }) });

    await expect.element(page.getByText('cleanup_banner_empty')).toBeVisible();
    await expect.element(page.getByTestId('cleanup-banner-start')).toBeDisabled();
    await expect.element(page.getByTestId('cleanup-banner-start')).not.toHaveAttribute('href');
  });

  it('shows the reviewed state instead of the estimate, and still links to the date', async () => {
    await renderBanner({ reviewed: true });

    await expect.element(page.getByTestId('cleanup-banner-detail')).toMatchTextContent('cleanup_banner_reviewed');
    await expect.element(page.getByTestId('cleanup-banner-detail')).not.toMatchTextContent('cleanup_banner_estimate');
    await expect
      .element(page.getByTestId('cleanup-banner-start'))
      .toHaveAttribute('href', '/utilities/cleanup/rewind/1028');
  });

  it('shows four photos and "+N" in the collage when there are more than five', async () => {
    await renderBanner();

    const collage = page.getByTestId('cleanup-banner-collage');
    expect(collage.element().querySelectorAll('img')).toHaveLength(4);
    await expect.element(collage.getByText('+38')).toBeVisible();
    await expect.element(collage).toHaveAttribute('data-shared-element', 'cleanup-day-photos');
  });

  it('shows up to five photos without a "+N" cell when they all fit', async () => {
    await renderBanner({ peek: { ...peek({ photos: 5 }), assets: assets.slice(0, 5) } });

    const collage = page.getByTestId('cleanup-banner-collage');
    expect(collage.element().querySelectorAll('img')).toHaveLength(5);
    await expect.element(collage.getByText(/^\+/)).not.toBeInTheDocument();
  });

  it('shows skeletons while the day loads', async () => {
    await renderBanner({ peek: undefined });

    await expect.element(page.getByTestId('cleanup-banner-loading')).toBeInTheDocument();
  });

  it('condenses into the slim bar when pinned', async () => {
    await renderBanner({ pinned: true });

    await expect.element(page.getByTestId('cleanup-day-banner')).toHaveAttribute('data-pinned', 'true');
    await expect.element(page.getByTestId('cleanup-banner-slim')).toBeInTheDocument();
  });
});
