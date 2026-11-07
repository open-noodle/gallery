import TimelineRepresentativeBuckets from '#lib/components/timeline/TimelineRepresentativeBuckets.svelte';
import type { TimelineGrouping } from '#lib/managers/timeline-manager/types.ts';
import type { ActivatableTimelineBucket } from '#lib/utils/timeline-zoom-navigation.ts';
import { tick } from 'svelte';
import { expect } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';

// The fixture thumbhashes are labels, not valid base64; the real decoder (`atob`) rejects them.
vi.mock('#lib/components/Thumbhash.svelte', async () => {
  const module = await import('#lib/gallery/__mocks__/noop-component.svelte');
  return { default: module.default };
});

type RepresentativeTimelineBucket = ActivatableTimelineBucket & {
  viewId: string;
  timeBucket: string;
  top: number;
  height: number;
  isLoaded: boolean;
  count: number;
  representativeAssetId: string | null;
  representativeThumbhash: string | null;
  representativeRatio: number | null;
};

const bucket = (
  year: number,
  top: number,
  overrides: Partial<RepresentativeTimelineBucket> = {},
): RepresentativeTimelineBucket => ({
  grouping: 'year',
  viewId: `year:${year}-01-01`,
  timeBucket: `${year}-01-01`,
  date: { year },
  count: 100 + year,
  top,
  height: 296,
  isLoaded: true,
  representativeAssetId: `asset-${year}`,
  representativeThumbhash: `thumbhash-${year}`,
  representativeRatio: 1.5,
  ...overrides,
});

const monthBucket = (
  year: number,
  month: number,
  top: number,
  overrides: Partial<RepresentativeTimelineBucket> = {},
): RepresentativeTimelineBucket => ({
  grouping: 'month',
  viewId: `month:${year}-${String(month).padStart(2, '0')}-01`,
  timeBucket: `${year}-${String(month).padStart(2, '0')}-01`,
  date: { year, month },
  count: month * 10,
  top,
  height: 296,
  isLoaded: true,
  representativeAssetId: `asset-${year}-${month}`,
  representativeThumbhash: `thumbhash-${year}-${month}`,
  representativeRatio: 1.5,
  ...overrides,
});

describe('TimelineRepresentativeBuckets', () => {
  it('renders visible representative buckets at absolute positions and marks wrapper grouping', async () => {
    await render(TimelineRepresentativeBuckets, {
      grouping: 'year',
      buckets: [bucket(2016, 120), bucket(2015, 460)],
      visibleWindow: { top: 100, bottom: 600 },
    });

    const wrapper = page.getByTestId('timeline-representative-buckets');
    await expect.element(wrapper).toHaveAttribute('data-grouping', 'year');

    const shell2016 = page.getByTestId('timeline-bucket-shell-2016-01-01');
    const shell2015 = page.getByTestId('timeline-bucket-shell-2015-01-01');
    await expect.element(shell2016).toHaveStyle({ position: 'absolute', height: '296px', width: '100%' });
    await expect.element(shell2016).toHaveStyle('transform: translateY(120px)');
    await expect.element(shell2015).toHaveStyle('transform: translateY(460px)');
    await expect
      .element(shell2016.getByTestId('timeline-bucket-card').getByTestId('timeline-bucket-card-title'))
      .toHaveTextContent('2016');
    await expect
      .element(shell2015.getByTestId('timeline-bucket-card').getByTestId('timeline-bucket-card-title'))
      .toHaveTextContent('2015');
  });

  it('passes the fixed shell height through to each representative card', async () => {
    await render(TimelineRepresentativeBuckets, {
      grouping: 'year',
      buckets: [bucket(2016, 120, { representativeRatio: 0.5 })],
      visibleWindow: { top: 100, bottom: 600 },
    });

    const shell = page.getByTestId('timeline-bucket-shell-2016-01-01');
    const frame = shell.getByTestId('timeline-bucket-frame');
    await expect.element(frame).toHaveClass('h-full');
    await expect.element(frame.getByTestId('timeline-bucket-card')).toHaveClass('size-full');
  });

  it('does not render a bucket outside the overscan window', async () => {
    await render(TimelineRepresentativeBuckets, {
      grouping: 'year',
      buckets: [bucket(2016, 120), bucket(2001, 2000)],
      visibleWindow: { top: 100, bottom: 600 },
    });

    await expect.element(page.getByTestId('timeline-bucket-shell-2016-01-01')).toBeInTheDocument();
    await expect.element(page.getByTestId('timeline-bucket-shell-2001-01-01')).not.toBeInTheDocument();
  });

  it('renders an empty DOM in day mode', async () => {
    const { container } = await render(TimelineRepresentativeBuckets, {
      grouping: 'day',
      buckets: [bucket(2016, 120, { grouping: 'day', date: { year: 2016, month: 1, day: 1 } })],
      visibleWindow: { top: 0, bottom: 1000 },
    });

    expect(container.children).toHaveLength(0);
    await expect.element(page.getByTestId('timeline-representative-buckets')).not.toBeInTheDocument();
  });

  it('forwards bucket activation payloads', async () => {
    const activations: ActivatableTimelineBucket[] = [];

    await render(TimelineRepresentativeBuckets, {
      grouping: 'year',
      buckets: [bucket(2016, 120)],
      visibleWindow: { top: 0, bottom: 1000 },
      onTimelineBucketActivate: (activation: ActivatableTimelineBucket) => {
        activations.push(activation);
      },
    });

    await expect.element(page.getByRole('button', { name: 'timeline_overview_card_semantics' })).toBeInTheDocument();

    await page.getByTestId('timeline-bucket-card').click();

    expect(activations).toEqual([{ grouping: 'year', date: { year: 2016 } }]);
  });

  it('renders unloaded bucket cards in loading state', async () => {
    await render(TimelineRepresentativeBuckets, {
      grouping: 'year',
      buckets: [bucket(2016, 120, { isLoaded: false })],
      visibleWindow: { top: 0, bottom: 1000 },
    });

    await expect.element(page.getByTestId('timeline-bucket-card')).toHaveAttribute('data-state', 'loading');
  });

  it('passes locale through to month bucket cards', async () => {
    await render(TimelineRepresentativeBuckets, {
      grouping: 'month',
      buckets: [monthBucket(2015, 8, 120)],
      visibleWindow: { top: 0, bottom: 1000 },
      locale: 'de-DE',
    });

    await expect.element(page.getByText('Aug. 2015')).toBeInTheDocument();
    await expect.element(page.getByRole('button', { name: 'timeline_overview_card_semantics' })).toBeInTheDocument();
  });

  it('disables cards without forwarding activation', async () => {
    const onTimelineBucketActivate = vi.fn();

    await render(TimelineRepresentativeBuckets, {
      grouping: 'year' as TimelineGrouping,
      buckets: [bucket(2016, 120)],
      visibleWindow: { top: 0, bottom: 1000 },
      disabled: true,
      onTimelineBucketActivate,
    });

    const card = page.getByTestId('timeline-bucket-card');
    // A disabled button is not actionable for a real user click, so dispatch the click directly.
    card.element().dispatchEvent(new MouseEvent('click', { bubbles: true }));

    await expect.element(card).toBeDisabled();
    expect(onTimelineBucketActivate).not.toHaveBeenCalled();
  });

  it('keeps a large bucket list bounded to the viewport overscan', async () => {
    const buckets = Array.from({ length: 2500 }, (_, index) => bucket(1900 + index, index * 328));

    await render(TimelineRepresentativeBuckets, {
      grouping: 'year',
      buckets,
      visibleWindow: { top: 0, bottom: 600 },
      onTimelineBucketActivate: () => {},
    });

    expect(page.getByTestId('timeline-bucket-card').elements().length).toBeLessThan(10);
  });

  it('calls onRequestCovers with visible bucket timeBuckets on mount', async () => {
    const onRequestCovers = vi.fn();

    await render(TimelineRepresentativeBuckets, {
      grouping: 'year',
      buckets: [bucket(2016, 120), bucket(2015, 460), bucket(2001, 2000)],
      visibleWindow: { top: 100, bottom: 600 },
      onRequestCovers,
    });
    await tick();

    // Only the two visible buckets (not the out-of-overscan bucket at top=2000)
    expect(onRequestCovers).toHaveBeenCalledTimes(1);
    expect(onRequestCovers).toHaveBeenCalledWith(['2016-01-01', '2015-01-01']);
  });

  it('does not call onRequestCovers in day mode', async () => {
    const onRequestCovers = vi.fn();

    await render(TimelineRepresentativeBuckets, {
      grouping: 'day',
      buckets: [bucket(2016, 120, { grouping: 'day', date: { year: 2016, month: 1, day: 1 } })],
      visibleWindow: { top: 0, bottom: 1000 },
      onRequestCovers,
    });
    await tick();

    expect(onRequestCovers).not.toHaveBeenCalled();
  });

  it('does not call onRequestCovers when no buckets are visible', async () => {
    const onRequestCovers = vi.fn();

    await render(TimelineRepresentativeBuckets, {
      grouping: 'year',
      buckets: [bucket(2001, 2000)],
      visibleWindow: { top: 0, bottom: 100 },
      onRequestCovers,
    });
    await tick();

    expect(onRequestCovers).not.toHaveBeenCalled();
  });

  it('offsets bucket transforms by renderOffset', async () => {
    await render(TimelineRepresentativeBuckets, {
      grouping: 'year',
      buckets: [bucket(2016, 120)],
      visibleWindow: { top: 100, bottom: 600 },
      renderOffset: 50,
    });

    await expect
      .element(page.getByTestId('timeline-bucket-shell-2016-01-01'))
      .toHaveStyle('transform: translateY(170px)');
  });
});
