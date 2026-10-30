import type { CleanupAssetDto } from '@immich/sdk';
import { render, screen, within } from '@testing-library/svelte';
import CleanupDayBanner from '$lib/gallery/cleanup/CleanupDayBanner.svelte';

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

  it("shows today's eyebrow, counts, estimate and busiest year with its city", () => {
    renderBanner();

    const banner = within(screen.getByTestId('cleanup-day-banner'));
    expect(banner.getByText('cleanup_banner_today')).toBeVisible();
    expect(banner.getByText('cleanup_banner_photos_years')).toBeVisible();
    expect(banner.getByTestId('cleanup-banner-detail')).toHaveTextContent('cleanup_banner_estimate');
    expect(banner.getByTestId('cleanup-banner-detail')).toHaveTextContent('cleanup_banner_busiest_city');
    expect(screen.getByTestId('cleanup-banner-start')).toHaveTextContent('cleanup_start_todays_rewind');
    expect(screen.getByTestId('cleanup-banner-start')).toHaveAttribute('href', '/utilities/cleanup/rewind/1028');
  });

  it('omits the estimate below one minute, and the city when unknown', () => {
    renderBanner({ peek: peek({ photos: 7, busiest: { year: 2019, city: null } }) });

    const detail = screen.getByTestId('cleanup-banner-detail');
    expect(detail).not.toHaveTextContent('cleanup_banner_estimate');
    expect(detail).toHaveTextContent('cleanup_banner_busiest');
    expect(detail).not.toHaveTextContent('cleanup_banner_busiest_city');
  });

  it('shows a hovered day by its date with "Rewind this day"', () => {
    renderBanner({ monthDay: 314, isToday: false });

    expect(screen.getByTestId('cleanup-day-banner')).toHaveTextContent('March 14');
    expect(screen.queryByText('cleanup_banner_today')).not.toBeInTheDocument();
    expect(screen.getByTestId('cleanup-banner-start')).toHaveTextContent('cleanup_rewind_this_day');
    expect(screen.getByTestId('cleanup-banner-start')).toHaveAttribute('href', '/utilities/cleanup/rewind/314');
  });

  it('says so plainly and disables the button for a date without photos', () => {
    renderBanner({ peek: peek({ photos: 0, years: 0, busiest: undefined }) });

    expect(screen.getByText('cleanup_banner_empty')).toBeVisible();
    expect(screen.getByTestId('cleanup-banner-start')).toBeDisabled();
    expect(screen.getByTestId('cleanup-banner-start')).not.toHaveAttribute('href');
  });

  it('shows the reviewed state instead of the estimate, and still links to the date', () => {
    renderBanner({ reviewed: true });

    expect(screen.getByTestId('cleanup-banner-detail')).toHaveTextContent('cleanup_banner_reviewed');
    expect(screen.getByTestId('cleanup-banner-detail')).not.toHaveTextContent('cleanup_banner_estimate');
    expect(screen.getByTestId('cleanup-banner-start')).toHaveAttribute('href', '/utilities/cleanup/rewind/1028');
  });

  it('shows four photos and "+N" in the collage when there are more than five', () => {
    renderBanner();

    const collage = screen.getByTestId('cleanup-banner-collage');
    expect(collage.querySelectorAll('img')).toHaveLength(4);
    expect(within(collage).getByText('+38')).toBeVisible();
    expect(collage).toHaveAttribute('data-shared-element', 'cleanup-day-photos');
  });

  it('shows up to five photos without a "+N" cell when they all fit', () => {
    renderBanner({ peek: { ...peek({ photos: 5 }), assets: assets.slice(0, 5) } });

    const collage = screen.getByTestId('cleanup-banner-collage');
    expect(collage.querySelectorAll('img')).toHaveLength(5);
    expect(within(collage).queryByText(/^\+/)).not.toBeInTheDocument();
  });

  it('shows skeletons while the day loads', () => {
    renderBanner({ peek: undefined });

    expect(screen.getByTestId('cleanup-banner-loading')).toBeInTheDocument();
  });

  it('condenses into the slim bar when pinned', () => {
    renderBanner({ pinned: true });

    expect(screen.getByTestId('cleanup-day-banner')).toHaveAttribute('data-pinned', 'true');
    expect(screen.getByTestId('cleanup-banner-slim')).toBeInTheDocument();
  });
});
