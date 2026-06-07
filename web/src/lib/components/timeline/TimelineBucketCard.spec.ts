import { AssetMediaSize } from '@immich/sdk';
import { fireEvent, render, screen, within } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { tick } from 'svelte';
import TimelineBucketCard from '$lib/components/timeline/TimelineBucketCard.svelte';
import type { ActivatableTimelineBucket } from '$lib/utils/timeline-zoom-navigation';

const utilsMock = vi.hoisted(() => ({
  getAssetMediaUrl: vi.fn(({ id }: { id: string }) => `/thumbnail/${id}`),
}));

vi.mock('$lib/utils', async (importOriginal) => ({
  ...((await importOriginal()) as Record<string, unknown>),
  getAssetMediaUrl: utilsMock.getAssetMediaUrl,
}));

vi.mock('$lib/components/Thumbhash.svelte', async () => {
  const module = await import('@test-data/mocks/noop-component.svelte');
  return { default: module.default };
});

type TimelineBucketCardBucket = ActivatableTimelineBucket & {
  timeBucket: string;
  count: number;
  representativeAssetId?: string | null;
  representativeThumbhash?: string | null;
  representativeRatio?: number | null;
};

const makeBucket = (overrides: Partial<TimelineBucketCardBucket> = {}): TimelineBucketCardBucket => ({
  grouping: 'year',
  date: { year: 2015 },
  timeBucket: '2015-01-01T00:00:00.000Z',
  count: 438,
  representativeAssetId: 'asset-2015',
  representativeThumbhash: 'thumbhash-2015',
  representativeRatio: 1.5,
  ...overrides,
});

describe('TimelineBucketCard component', () => {
  beforeEach(() => {
    utilsMock.getAssetMediaUrl.mockClear();
  });

  it('renders a year bucket with a localized count and representative image', () => {
    render(TimelineBucketCard, {
      bucket: makeBucket(),
      onActivate: vi.fn(),
    });

    expect(screen.getByRole('button', { name: /2015, 438 photos/i })).toBeInTheDocument();
    expect(screen.getByText('2015')).toBeInTheDocument();
    expect(screen.getByText('438 photos')).toBeInTheDocument();
    expect(screen.getByTestId('timeline-bucket-card')).toHaveAttribute('data-state', 'image');
    const image = screen.getByTestId('timeline-bucket-card-image');
    expect(image).toHaveAttribute('src', '/thumbnail/asset-2015');
    expect(image).toHaveAttribute('alt', '');
    expect(image).toHaveAttribute('draggable', 'false');
    expect(utilsMock.getAssetMediaUrl).toHaveBeenCalledWith({
      id: 'asset-2015',
      size: AssetMediaSize.Thumbnail,
      cacheKey: 'thumbhash-2015',
    });
  });

  it('keeps year labels in an always-visible overlay over representative images', () => {
    render(TimelineBucketCard, {
      bucket: makeBucket(),
      onActivate: vi.fn(),
    });

    const overlay = screen.getByTestId('timeline-bucket-card-overlay');
    expect(overlay).toHaveClass('absolute', 'inset-x-0', 'bottom-0');
    expect(within(overlay).getByTestId('timeline-bucket-card-title')).toHaveTextContent('2015');
    expect(within(overlay).getByTestId('timeline-bucket-card-count')).toHaveTextContent('438 photos');
  });

  it('renders a month bucket with a locale-specific title', () => {
    render(TimelineBucketCard, {
      bucket: makeBucket({
        grouping: 'month',
        date: { year: 2015, month: 8 },
        timeBucket: '2015-08-01T00:00:00.000Z',
        count: 23,
      }),
      locale: 'en-US',
      onActivate: vi.fn(),
    });

    expect(screen.getByRole('button', { name: /Aug 2015, 23 photos/i })).toBeInTheDocument();
    expect(screen.getByText('Aug 2015')).toBeInTheDocument();
    expect(screen.getByText('23 photos')).toBeInTheDocument();
  });

  it('keeps month labels in the representative card overlay', () => {
    render(TimelineBucketCard, {
      bucket: makeBucket({
        grouping: 'month',
        date: { year: 2015, month: 8 },
        timeBucket: '2015-08-01T00:00:00.000Z',
        count: 23,
      }),
      locale: 'en-US',
      onActivate: vi.fn(),
    });

    const overlay = screen.getByTestId('timeline-bucket-card-overlay');
    expect(within(overlay).getByTestId('timeline-bucket-card-title')).toHaveTextContent('Aug 2015');
    expect(within(overlay).getByTestId('timeline-bucket-card-count')).toHaveTextContent('23 photos');
  });

  it('crops portrait representatives inside fixed bucket geometry', () => {
    render(TimelineBucketCard, {
      bucket: makeBucket({ representativeRatio: 0.5 }),
      onActivate: vi.fn(),
    });

    expect(screen.getByTestId('timeline-bucket-card')).toHaveClass('relative', 'h-full', 'min-h-56');
    expect(screen.getByTestId('timeline-bucket-card-media')).toHaveClass('absolute', 'inset-0');
    expect(screen.getByTestId('timeline-bucket-card-media')).not.toHaveAttribute(
      'style',
      expect.stringContaining('aspect-ratio'),
    );
    expect(screen.getByTestId('timeline-bucket-card-image')).toHaveClass('object-cover');
  });

  it('uses a singular count label for one photo', () => {
    render(TimelineBucketCard, {
      bucket: makeBucket({ count: 1 }),
      onActivate: vi.fn(),
    });

    expect(screen.getByRole('button', { name: /2015, 1 photo/i })).toBeInTheDocument();
    expect(screen.getByText('1 photo')).toBeInTheDocument();
  });

  it('announces representative bucket activation as timeline zoom navigation, not filtering', async () => {
    const { rerender } = render(TimelineBucketCard, {
      bucket: makeBucket(),
      onActivate: vi.fn(),
    });

    const yearCard = screen.getByRole('button', { name: '2015, 438 photos, show months' });
    expect(yearCard).toBeInTheDocument();
    expect(yearCard).not.toHaveAccessibleName(/filter/i);

    await rerender({
      bucket: makeBucket({
        grouping: 'month',
        date: { year: 2015, month: 8 },
        timeBucket: '2015-08-01T00:00:00.000Z',
        count: 23,
      }),
      locale: 'en-US',
      onActivate: vi.fn(),
    });

    const monthCard = screen.getByRole('button', {
      name: 'Aug 2015, 23 photos, show all photos from this point',
    });
    expect(monthCard).toBeInTheDocument();
    expect(monthCard).not.toHaveAccessibleName(/filter/i);
  });

  it('activates by click, Enter, and Space with the bucket grouping and date', async () => {
    const user = userEvent.setup();
    const onActivate = vi.fn();

    render(TimelineBucketCard, {
      bucket: makeBucket(),
      onActivate,
    });

    const card = screen.getByTestId('timeline-bucket-card');
    await user.click(card);
    await user.keyboard('{Enter}');
    await user.keyboard(' ');

    expect(onActivate).toHaveBeenCalledTimes(3);
    expect(onActivate).toHaveBeenNthCalledWith(1, { grouping: 'year', date: { year: 2015 } });
    expect(onActivate).toHaveBeenNthCalledWith(2, { grouping: 'year', date: { year: 2015 } });
    expect(onActivate).toHaveBeenNthCalledWith(3, { grouping: 'year', date: { year: 2015 } });
  });

  it('does not activate when disabled', async () => {
    const user = userEvent.setup();
    const onActivate = vi.fn();

    render(TimelineBucketCard, {
      bucket: makeBucket(),
      disabled: true,
      onActivate,
    });

    const card = screen.getByTestId('timeline-bucket-card');
    await user.click(card);
    await user.keyboard('{Enter}');
    await user.keyboard(' ');

    expect(card).toBeDisabled();
    expect(onActivate).not.toHaveBeenCalled();
  });

  it('renders fallback without requesting a URL when no representative asset exists', () => {
    render(TimelineBucketCard, {
      bucket: makeBucket({
        representativeAssetId: null,
        representativeThumbhash: null,
      }),
      onActivate: vi.fn(),
    });

    expect(screen.getByTestId('timeline-bucket-card')).toHaveAttribute('data-state', 'fallback');
    expect(screen.getByTestId('timeline-bucket-card-fallback')).toHaveTextContent('2015');
    expect(screen.queryByTestId('timeline-bucket-card-image')).not.toBeInTheDocument();
    expect(utilsMock.getAssetMediaUrl).not.toHaveBeenCalled();
  });

  it('keeps the zoom label and activation when a representative image fails', async () => {
    const user = userEvent.setup();
    const onActivate = vi.fn();

    render(TimelineBucketCard, {
      bucket: makeBucket(),
      onActivate,
    });

    await fireEvent.error(screen.getByTestId('timeline-bucket-card-image'));
    await tick();

    const card = screen.getByRole('button', { name: '2015, 438 photos, show months' });
    expect(card).toHaveAttribute('data-state', 'fallback');

    await user.click(card);

    expect(onActivate).toHaveBeenCalledWith({ grouping: 'year', date: { year: 2015 } });
  });

  it('renders the loading fallback without requesting a representative image URL', () => {
    render(TimelineBucketCard, {
      bucket: makeBucket(),
      loading: true,
      onActivate: vi.fn(),
    });

    expect(screen.getByTestId('timeline-bucket-card')).toHaveAttribute('data-state', 'loading');
    expect(screen.getByTestId('timeline-bucket-card-fallback')).toHaveTextContent('2015');
    expect(screen.queryByTestId('timeline-bucket-card-image')).not.toBeInTheDocument();
    expect(utilsMock.getAssetMediaUrl).not.toHaveBeenCalled();
  });

  it('renders a thumbhash placeholder until the representative image loads', async () => {
    render(TimelineBucketCard, {
      bucket: makeBucket(),
      onActivate: vi.fn(),
    });

    expect(screen.getByTestId('noop-component')).toBeInTheDocument();
    expect(screen.getByTestId('noop-component')).toHaveAttribute('data-prop-count');

    await fireEvent.load(screen.getByTestId('timeline-bucket-card-image'));
    await tick();

    expect(screen.queryByTestId('noop-component')).not.toBeInTheDocument();
  });

  it('shows the next image thumbhash placeholder after a previously loaded image changes', async () => {
    const { rerender } = render(TimelineBucketCard, {
      bucket: makeBucket(),
      onActivate: vi.fn(),
    });

    await fireEvent.load(screen.getByTestId('timeline-bucket-card-image'));
    await tick();

    expect(screen.queryByTestId('noop-component')).not.toBeInTheDocument();

    await rerender({
      bucket: makeBucket({
        representativeAssetId: 'asset-2016',
        representativeThumbhash: 'thumbhash-2016',
      }),
      onActivate: vi.fn(),
    });

    expect(screen.getByTestId('timeline-bucket-card-image')).toHaveAttribute('src', '/thumbnail/asset-2016');
    expect(screen.getByTestId('noop-component')).toBeInTheDocument();
  });

  it('ignores stale load events from a previous representative image', async () => {
    const { rerender } = render(TimelineBucketCard, {
      bucket: makeBucket(),
      onActivate: vi.fn(),
    });

    const previousImage = screen.getByTestId('timeline-bucket-card-image');

    await rerender({
      bucket: makeBucket({
        representativeAssetId: 'asset-2016',
        representativeThumbhash: 'thumbhash-2016',
      }),
      onActivate: vi.fn(),
    });

    await fireEvent.load(previousImage);
    await tick();

    expect(screen.getByTestId('timeline-bucket-card-image')).toHaveAttribute('src', '/thumbnail/asset-2016');
    expect(screen.getByTestId('noop-component')).toBeInTheDocument();
  });

  it('falls back when the representative image errors', async () => {
    render(TimelineBucketCard, {
      bucket: makeBucket(),
      onActivate: vi.fn(),
    });

    await fireEvent.error(screen.getByTestId('timeline-bucket-card-image'));
    await tick();

    expect(screen.getByTestId('timeline-bucket-card')).toHaveAttribute('data-state', 'fallback');
    expect(screen.getByTestId('timeline-bucket-card-fallback')).toHaveTextContent('2015');
  });

  it('shows the next representative image after a previously errored image changes', async () => {
    const { rerender } = render(TimelineBucketCard, {
      bucket: makeBucket(),
      onActivate: vi.fn(),
    });

    await fireEvent.error(screen.getByTestId('timeline-bucket-card-image'));
    await tick();

    expect(screen.getByTestId('timeline-bucket-card')).toHaveAttribute('data-state', 'fallback');

    await rerender({
      bucket: makeBucket({
        representativeAssetId: 'asset-2016',
        representativeThumbhash: 'thumbhash-2016',
      }),
      onActivate: vi.fn(),
    });

    expect(screen.getByTestId('timeline-bucket-card')).toHaveAttribute('data-state', 'image');
    expect(screen.getByTestId('timeline-bucket-card-image')).toHaveAttribute('src', '/thumbnail/asset-2016');
    expect(screen.queryByTestId('timeline-bucket-card-fallback')).not.toBeInTheDocument();
  });

  it('ignores stale error events from a previous representative image', async () => {
    const { rerender } = render(TimelineBucketCard, {
      bucket: makeBucket(),
      onActivate: vi.fn(),
    });

    const previousImage = screen.getByTestId('timeline-bucket-card-image');

    await rerender({
      bucket: makeBucket({
        representativeAssetId: 'asset-2016',
        representativeThumbhash: 'thumbhash-2016',
      }),
      onActivate: vi.fn(),
    });

    await fireEvent.error(previousImage);
    await tick();

    expect(screen.getByTestId('timeline-bucket-card')).toHaveAttribute('data-state', 'image');
    expect(screen.getByTestId('timeline-bucket-card-image')).toHaveAttribute('src', '/thumbnail/asset-2016');
    expect(screen.queryByTestId('timeline-bucket-card-fallback')).not.toBeInTheDocument();
  });

  it('keeps stable full-height crop geometry when the representative ratio is missing', () => {
    render(TimelineBucketCard, {
      bucket: makeBucket({ representativeRatio: null }),
      onActivate: vi.fn(),
    });

    expect(screen.getByTestId('timeline-bucket-card')).toHaveClass('h-full', 'min-h-56');
    expect(screen.getByTestId('timeline-bucket-card-media')).toHaveClass('absolute', 'inset-0');
    expect(screen.getByTestId('timeline-bucket-card-media')).not.toHaveAttribute(
      'style',
      expect.stringContaining('aspect-ratio'),
    );
  });
});
