import { render, screen, within } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import TimelineRepresentativeBuckets from '$lib/components/timeline/TimelineRepresentativeBuckets.svelte';
import type { TimelineGrouping } from '$lib/managers/timeline-manager/types';
import type { ActivatableTimelineBucket } from '$lib/utils/timeline-zoom-navigation';

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
  it('renders visible representative buckets at absolute positions and marks wrapper grouping', () => {
    render(TimelineRepresentativeBuckets, {
      grouping: 'year',
      buckets: [bucket(2016, 120), bucket(2015, 460)],
      visibleWindow: { top: 100, bottom: 600 },
    });

    const wrapper = screen.getByTestId('timeline-representative-buckets');
    expect(wrapper).toHaveAttribute('data-grouping', 'year');

    const shell2016 = screen.getByTestId('timeline-bucket-shell-2016-01-01');
    const shell2015 = screen.getByTestId('timeline-bucket-shell-2015-01-01');
    expect(shell2016).toHaveStyle({ position: 'absolute', height: '296px', width: '100%' });
    expect(shell2016).toHaveStyle('transform: translateY(120px)');
    expect(shell2015).toHaveStyle('transform: translateY(460px)');
    expect(within(shell2016).getByTestId('timeline-bucket-card')).toHaveTextContent('2016');
    expect(within(shell2015).getByTestId('timeline-bucket-card')).toHaveTextContent('2015');
  });

  it('passes the fixed shell height through to each representative card', () => {
    render(TimelineRepresentativeBuckets, {
      grouping: 'year',
      buckets: [bucket(2016, 120, { representativeRatio: 0.5 })],
      visibleWindow: { top: 100, bottom: 600 },
    });

    const shell = screen.getByTestId('timeline-bucket-shell-2016-01-01');
    const frame = within(shell).getByTestId('timeline-bucket-frame');
    expect(frame).toHaveClass('h-full');
    expect(within(frame).getByTestId('timeline-bucket-card')).toHaveClass('h-full');
  });

  it('does not render a bucket outside the overscan window', () => {
    render(TimelineRepresentativeBuckets, {
      grouping: 'year',
      buckets: [bucket(2016, 120), bucket(2001, 2000)],
      visibleWindow: { top: 100, bottom: 600 },
    });

    expect(screen.getByTestId('timeline-bucket-shell-2016-01-01')).toBeInTheDocument();
    expect(screen.queryByTestId('timeline-bucket-shell-2001-01-01')).not.toBeInTheDocument();
  });

  it('renders an empty DOM in day mode', () => {
    const { container } = render(TimelineRepresentativeBuckets, {
      grouping: 'day',
      buckets: [bucket(2016, 120, { grouping: 'day', date: { year: 2016, month: 1, day: 1 } })],
      visibleWindow: { top: 0, bottom: 1000 },
    });

    expect(container.children).toHaveLength(0);
    expect(screen.queryByTestId('timeline-representative-buckets')).not.toBeInTheDocument();
  });

  it('forwards bucket activation payloads', async () => {
    const user = userEvent.setup();
    const activations: ActivatableTimelineBucket[] = [];

    render(TimelineRepresentativeBuckets, {
      grouping: 'year',
      buckets: [bucket(2016, 120)],
      visibleWindow: { top: 0, bottom: 1000 },
      onTimelineBucketActivate: (activation: ActivatableTimelineBucket) => activations.push(activation),
    });

    expect(screen.getByRole('button', { name: /2016, .+ photos, show months/i })).toBeInTheDocument();

    await user.click(screen.getByTestId('timeline-bucket-card'));

    expect(activations).toEqual([{ grouping: 'year', date: { year: 2016 } }]);
  });

  it('renders unloaded bucket cards in loading state', () => {
    render(TimelineRepresentativeBuckets, {
      grouping: 'year',
      buckets: [bucket(2016, 120, { isLoaded: false })],
      visibleWindow: { top: 0, bottom: 1000 },
    });

    expect(screen.getByTestId('timeline-bucket-card')).toHaveAttribute('data-state', 'loading');
  });

  it('passes locale through to month bucket cards', () => {
    render(TimelineRepresentativeBuckets, {
      grouping: 'month',
      buckets: [monthBucket(2015, 8, 120)],
      visibleWindow: { top: 0, bottom: 1000 },
      locale: 'de-DE',
    });

    expect(screen.getByText('Aug. 2015')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /Aug\. 2015, 80 photos, show all photos from this point/i }),
    ).toBeInTheDocument();
  });

  it('disables cards without forwarding activation', async () => {
    const user = userEvent.setup();
    const onTimelineBucketActivate = vi.fn();

    render(TimelineRepresentativeBuckets, {
      grouping: 'year' as TimelineGrouping,
      buckets: [bucket(2016, 120)],
      visibleWindow: { top: 0, bottom: 1000 },
      disabled: true,
      onTimelineBucketActivate,
    });

    const card = screen.getByTestId('timeline-bucket-card');
    await user.click(card);

    expect(card).toBeDisabled();
    expect(onTimelineBucketActivate).not.toHaveBeenCalled();
  });

  it('keeps a large bucket list bounded to the viewport overscan', () => {
    const buckets = Array.from({ length: 2500 }, (_, index) => bucket(1900 + index, index * 328));

    render(TimelineRepresentativeBuckets, {
      grouping: 'year',
      buckets,
      visibleWindow: { top: 0, bottom: 600 },
      onTimelineBucketActivate: () => {},
    });

    expect(screen.getAllByTestId('timeline-bucket-card').length).toBeLessThan(10);
  });
});
