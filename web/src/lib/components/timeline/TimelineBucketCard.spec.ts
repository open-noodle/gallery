import TimelineBucketCard from '#lib/components/timeline/TimelineBucketCard.svelte';
import type { ActivatableTimelineBucket } from '#lib/utils/timeline-zoom-navigation.ts';
import { AssetMediaSize } from '@immich/sdk';
import { tick } from 'svelte';
import { expect } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page, userEvent } from 'vitest/browser';

vi.mock('#lib/components/Thumbhash.svelte', async () => {
  const module = await import('#lib/gallery/__mocks__/noop-component.svelte');
  return { default: module.default };
});

// The test images never load (unit pages serve no media), so the browser fires a real `error` on each
// one. Swallow those trusted events so the test alone decides when an image loads or fails.
const swallowNetworkImageEvents = (event: Event) => {
  if (event.isTrusted && event.target instanceof HTMLImageElement) {
    event.stopImmediatePropagation();
  }
};

beforeAll(() => {
  addEventListener('error', swallowNetworkImageEvents, { capture: true });
  addEventListener('load', swallowNetworkImageEvents, { capture: true });
});

afterAll(() => {
  removeEventListener('error', swallowNetworkImageEvents, { capture: true });
  removeEventListener('load', swallowNetworkImageEvents, { capture: true });
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
  it('renders a year bucket with a localized count and representative image', async () => {
    await render(TimelineBucketCard, {
      bucket: makeBucket(),
      onActivate: vi.fn(),
    });

    await expect.element(page.getByRole('button', { name: 'timeline_overview_card_semantics' })).toBeInTheDocument();
    await expect.element(page.getByText('2015')).toBeInTheDocument();
    await expect.element(page.getByText('timeline_overview_photo_count')).toBeInTheDocument();
    await expect.element(page.getByTestId('timeline-bucket-card')).toHaveAttribute('data-state', 'image');
    const image = page.getByTestId('timeline-bucket-card-image');
    await expect.element(image).toHaveAttribute('alt', '');
    await expect.element(image).toHaveAttribute('draggable', 'false');
    // The thumbnail URL is the representative asset's thumbnail, keyed by its thumbhash.
    const src = new URL(image.element().getAttribute('src')!, location.origin);
    expect(src.pathname).toBe('/api/assets/asset-2015/thumbnail');
    expect(src.searchParams.get('size')).toBe(AssetMediaSize.Thumbnail);
    expect(src.searchParams.get('c')).toBe('thumbhash-2015');
  });

  it('keeps year labels in an always-visible overlay over representative images', async () => {
    await render(TimelineBucketCard, {
      bucket: makeBucket(),
      onActivate: vi.fn(),
    });

    const overlay = page.getByTestId('timeline-bucket-card-overlay');
    await expect.element(overlay).toHaveClass('absolute', 'inset-x-0', 'bottom-0');
    await expect.element(overlay.getByTestId('timeline-bucket-card-title')).toHaveTextContent('2015');
    await expect
      .element(overlay.getByTestId('timeline-bucket-card-count'))
      .toHaveTextContent('timeline_overview_photo_count');
  });

  it('renders a month bucket with a locale-specific title', async () => {
    await render(TimelineBucketCard, {
      bucket: makeBucket({
        grouping: 'month',
        date: { year: 2015, month: 8 },
        timeBucket: '2015-08-01T00:00:00.000Z',
        count: 23,
      }),
      locale: 'en-US',
      onActivate: vi.fn(),
    });

    await expect.element(page.getByRole('button', { name: 'timeline_overview_card_semantics' })).toBeInTheDocument();
    await expect.element(page.getByText('Aug 2015')).toBeInTheDocument();
    await expect.element(page.getByText('timeline_overview_photo_count')).toBeInTheDocument();
  });

  it('keeps month labels in the representative card overlay', async () => {
    await render(TimelineBucketCard, {
      bucket: makeBucket({
        grouping: 'month',
        date: { year: 2015, month: 8 },
        timeBucket: '2015-08-01T00:00:00.000Z',
        count: 23,
      }),
      locale: 'en-US',
      onActivate: vi.fn(),
    });

    const overlay = page.getByTestId('timeline-bucket-card-overlay');
    await expect.element(overlay.getByTestId('timeline-bucket-card-title')).toHaveTextContent('Aug 2015');
    await expect
      .element(overlay.getByTestId('timeline-bucket-card-count'))
      .toHaveTextContent('timeline_overview_photo_count');
  });

  it('crops portrait representatives inside fixed bucket geometry', async () => {
    await render(TimelineBucketCard, {
      bucket: makeBucket({ representativeRatio: 0.5 }),
      onActivate: vi.fn(),
    });

    await expect.element(page.getByTestId('timeline-bucket-card')).toHaveClass('relative', 'size-full', 'min-h-56');
    await expect.element(page.getByTestId('timeline-bucket-card-media')).toHaveClass('absolute', 'inset-0');
    await expect
      .element(page.getByTestId('timeline-bucket-card-media'))
      .not.toHaveAttribute('style', expect.stringContaining('aspect-ratio'));
    await expect.element(page.getByTestId('timeline-bucket-card-image')).toHaveClass('object-cover');
  });

  it('uses a singular count label for one photo', async () => {
    await render(TimelineBucketCard, {
      bucket: makeBucket({ count: 1 }),
      onActivate: vi.fn(),
    });

    await expect.element(page.getByRole('button', { name: 'timeline_overview_card_semantics' })).toBeInTheDocument();
    await expect.element(page.getByText('timeline_overview_photo_count')).toBeInTheDocument();
  });

  it('announces representative bucket activation as timeline zoom navigation, not filtering', async () => {
    const { rerender } = await render(TimelineBucketCard, {
      bucket: makeBucket(),
      onActivate: vi.fn(),
    });

    const yearCard = page.getByRole('button', { name: 'timeline_overview_card_semantics' });
    await expect.element(yearCard).toBeInTheDocument();
    await expect.element(yearCard).not.toHaveAccessibleName(/filter/i);

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

    const monthCard = page.getByRole('button', {
      name: 'timeline_overview_card_semantics',
    });
    await expect.element(monthCard).toBeInTheDocument();
    await expect.element(monthCard).not.toHaveAccessibleName(/filter/i);
  });

  it('activates by click, Enter, and Space with the bucket grouping and date', async () => {
    const onActivate = vi.fn();

    await render(TimelineBucketCard, {
      bucket: makeBucket(),
      onActivate,
    });

    const card = page.getByTestId('timeline-bucket-card');
    await card.click();
    await userEvent.keyboard('{Enter}');
    await userEvent.keyboard(' ');

    expect(onActivate).toHaveBeenCalledTimes(3);
    expect(onActivate).toHaveBeenNthCalledWith(1, { grouping: 'year', date: { year: 2015 } });
    expect(onActivate).toHaveBeenNthCalledWith(2, { grouping: 'year', date: { year: 2015 } });
    expect(onActivate).toHaveBeenNthCalledWith(3, { grouping: 'year', date: { year: 2015 } });
  });

  it('does not activate when disabled', async () => {
    const onActivate = vi.fn();

    await render(TimelineBucketCard, {
      bucket: makeBucket(),
      disabled: true,
      onActivate,
    });

    const card = page.getByTestId('timeline-bucket-card');
    // A disabled button is not actionable for a real user click, so dispatch the click directly.
    card.element().dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await userEvent.keyboard('{Enter}');
    await userEvent.keyboard(' ');

    await expect.element(card).toBeDisabled();
    expect(onActivate).not.toHaveBeenCalled();
  });

  it('renders a loading placeholder without a centred title or URL request while the cover is not yet loaded', async () => {
    await render(TimelineBucketCard, {
      bucket: makeBucket({
        representativeAssetId: null,
        representativeThumbhash: null,
      }),
      onActivate: vi.fn(),
    });

    await expect.element(page.getByTestId('timeline-bucket-card')).toHaveAttribute('data-state', 'loading');
    await expect.element(page.getByTestId('timeline-bucket-card-loading')).toBeInTheDocument();
    // The period label lives only in the bottom-left overlay — no big centred title to flash.
    await expect.element(page.getByTestId('timeline-bucket-card-fallback')).not.toBeInTheDocument();
    await expect.element(page.getByTestId('timeline-bucket-card-image')).not.toBeInTheDocument();
  });

  it('keeps the zoom label and activation when a representative image fails', async () => {
    const onActivate = vi.fn();

    await render(TimelineBucketCard, {
      bucket: makeBucket(),
      onActivate,
    });

    page.getByTestId('timeline-bucket-card-image').element().dispatchEvent(new Event('error'));
    await tick();

    const card = page.getByRole('button', { name: 'timeline_overview_card_semantics' });
    await expect.element(card).toHaveAttribute('data-state', 'fallback');

    await card.click();

    expect(onActivate).toHaveBeenCalledWith({ grouping: 'year', date: { year: 2015 } });
  });

  it('renders a loading placeholder without a centred title while the loading prop is set', async () => {
    await render(TimelineBucketCard, {
      bucket: makeBucket(),
      loading: true,
      onActivate: vi.fn(),
    });

    await expect.element(page.getByTestId('timeline-bucket-card')).toHaveAttribute('data-state', 'loading');
    await expect.element(page.getByTestId('timeline-bucket-card-loading')).toBeInTheDocument();
    await expect.element(page.getByTestId('timeline-bucket-card-fallback')).not.toBeInTheDocument();
    await expect.element(page.getByTestId('timeline-bucket-card-image')).not.toBeInTheDocument();
  });

  it('renders a thumbhash placeholder until the representative image loads', async () => {
    await render(TimelineBucketCard, {
      bucket: makeBucket(),
      onActivate: vi.fn(),
    });

    await expect.element(page.getByTestId('noop-component')).toBeInTheDocument();
    await expect.element(page.getByTestId('noop-component')).toHaveAttribute('data-prop-count');

    page.getByTestId('timeline-bucket-card-image').element().dispatchEvent(new Event('load'));
    await tick();

    await expect.element(page.getByTestId('noop-component')).not.toBeInTheDocument();
  });

  it('shows the next image thumbhash placeholder after a previously loaded image changes', async () => {
    const { rerender } = await render(TimelineBucketCard, {
      bucket: makeBucket(),
      onActivate: vi.fn(),
    });

    page.getByTestId('timeline-bucket-card-image').element().dispatchEvent(new Event('load'));
    await tick();

    await expect.element(page.getByTestId('noop-component')).not.toBeInTheDocument();

    await rerender({
      bucket: makeBucket({
        representativeAssetId: 'asset-2016',
        representativeThumbhash: 'thumbhash-2016',
      }),
      onActivate: vi.fn(),
    });

    await expect
      .element(page.getByTestId('timeline-bucket-card-image'))
      .toHaveAttribute('src', expect.stringContaining('/api/assets/asset-2016/thumbnail?'));
    await expect.element(page.getByTestId('noop-component')).toBeInTheDocument();
  });

  it('ignores stale load events from a previous representative image', async () => {
    const { rerender } = await render(TimelineBucketCard, {
      bucket: makeBucket(),
      onActivate: vi.fn(),
    });

    const previousImage = page.getByTestId('timeline-bucket-card-image').element();

    await rerender({
      bucket: makeBucket({
        representativeAssetId: 'asset-2016',
        representativeThumbhash: 'thumbhash-2016',
      }),
      onActivate: vi.fn(),
    });

    previousImage.dispatchEvent(new Event('load'));
    await tick();

    await expect
      .element(page.getByTestId('timeline-bucket-card-image'))
      .toHaveAttribute('src', expect.stringContaining('/api/assets/asset-2016/thumbnail?'));
    await expect.element(page.getByTestId('noop-component')).toBeInTheDocument();
  });

  it('falls back when the representative image errors', async () => {
    await render(TimelineBucketCard, {
      bucket: makeBucket(),
      onActivate: vi.fn(),
    });

    page.getByTestId('timeline-bucket-card-image').element().dispatchEvent(new Event('error'));
    await tick();

    await expect.element(page.getByTestId('timeline-bucket-card')).toHaveAttribute('data-state', 'fallback');
    await expect.element(page.getByTestId('timeline-bucket-card-fallback')).toHaveTextContent('2015');
  });

  it('shows the next representative image after a previously errored image changes', async () => {
    const { rerender } = await render(TimelineBucketCard, {
      bucket: makeBucket(),
      onActivate: vi.fn(),
    });

    page.getByTestId('timeline-bucket-card-image').element().dispatchEvent(new Event('error'));
    await tick();

    await expect.element(page.getByTestId('timeline-bucket-card')).toHaveAttribute('data-state', 'fallback');

    await rerender({
      bucket: makeBucket({
        representativeAssetId: 'asset-2016',
        representativeThumbhash: 'thumbhash-2016',
      }),
      onActivate: vi.fn(),
    });

    await expect.element(page.getByTestId('timeline-bucket-card')).toHaveAttribute('data-state', 'image');
    await expect
      .element(page.getByTestId('timeline-bucket-card-image'))
      .toHaveAttribute('src', expect.stringContaining('/api/assets/asset-2016/thumbnail?'));
    await expect.element(page.getByTestId('timeline-bucket-card-fallback')).not.toBeInTheDocument();
  });

  it('ignores stale error events from a previous representative image', async () => {
    const { rerender } = await render(TimelineBucketCard, {
      bucket: makeBucket(),
      onActivate: vi.fn(),
    });

    const previousImage = page.getByTestId('timeline-bucket-card-image').element();

    await rerender({
      bucket: makeBucket({
        representativeAssetId: 'asset-2016',
        representativeThumbhash: 'thumbhash-2016',
      }),
      onActivate: vi.fn(),
    });

    previousImage.dispatchEvent(new Event('error'));
    await tick();

    await expect.element(page.getByTestId('timeline-bucket-card')).toHaveAttribute('data-state', 'image');
    await expect
      .element(page.getByTestId('timeline-bucket-card-image'))
      .toHaveAttribute('src', expect.stringContaining('/api/assets/asset-2016/thumbnail?'));
    await expect.element(page.getByTestId('timeline-bucket-card-fallback')).not.toBeInTheDocument();
  });

  it('keeps stable full-height crop geometry when the representative ratio is missing', async () => {
    await render(TimelineBucketCard, {
      bucket: makeBucket({ representativeRatio: null }),
      onActivate: vi.fn(),
    });

    await expect.element(page.getByTestId('timeline-bucket-card')).toHaveClass('size-full', 'min-h-56');
    await expect.element(page.getByTestId('timeline-bucket-card-media')).toHaveClass('absolute', 'inset-0');
    await expect
      .element(page.getByTestId('timeline-bucket-card-media'))
      .not.toHaveAttribute('style', expect.stringContaining('aspect-ratio'));
  });

  it('transitions from loading skeleton to cover image when representative is applied', async () => {
    const { rerender } = await render(TimelineBucketCard, {
      bucket: makeBucket({ representativeAssetId: null, representativeThumbhash: null }),
      loading: true,
      onActivate: vi.fn(),
    });

    await expect.element(page.getByTestId('timeline-bucket-card')).toHaveAttribute('data-state', 'loading');
    await expect.element(page.getByTestId('timeline-bucket-card-image')).not.toBeInTheDocument();

    await rerender({
      bucket: makeBucket({ representativeAssetId: 'asset-2015', representativeThumbhash: 'thumbhash-2015' }),
      loading: false,
      onActivate: vi.fn(),
    });

    await expect.element(page.getByTestId('timeline-bucket-card')).toHaveAttribute('data-state', 'image');
    await expect
      .element(page.getByTestId('timeline-bucket-card-image'))
      .toHaveAttribute('src', expect.stringContaining('/api/assets/asset-2015/thumbnail?'));
  });
});
