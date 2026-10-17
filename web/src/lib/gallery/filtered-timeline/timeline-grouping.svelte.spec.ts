import type { TimelineManager } from '$lib/managers/timeline-manager/timeline-manager.svelte';
import { timelineGroupingProps } from './timeline-grouping.svelte';

const { selection, showModal } = vi.hoisted(() => ({
  selection: { selectionActive: false },
  showModal: vi.fn(),
}));

vi.mock('$lib/managers/asset-multi-select-manager.svelte', () => ({ assetMultiSelectManager: selection }));
vi.mock('$lib/gallery/timeline/timeline-anchor', () => ({
  getTimelineTopVisibleAnchor: () => ({ year: 2020 }),
}));
vi.mock('@immich/ui', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@immich/ui')>()),
  modalManager: { show: showModal },
}));

const timeline = (assetCount: number) => ({ isInitialized: true, assetCount }) as TimelineManager;

describe('timelineGroupingProps', () => {
  beforeEach(() => {
    selection.selectionActive = false;
    vi.clearAllMocks();
  });

  it('hides the bar while selecting or once the timeline loaded empty, unless told otherwise', () => {
    expect(timelineGroupingProps(() => timeline(0)).hidden).toBe(true);
    expect(timelineGroupingProps(() => timeline(0), { hideWhenEmpty: false }).hidden).toBe(false);
    expect(timelineGroupingProps(() => timeline(2)).hidden).toBe(false);
    selection.selectionActive = true;
    expect(timelineGroupingProps(() => timeline(2), { hideWhenEmpty: false }).hidden).toBe(true);
  });

  it('zooms into an activated bucket and anchors on a grouping change', () => {
    const sut = timelineGroupingProps(() => timeline(2));
    sut.onTimelineBucketActivate({ grouping: 'year', date: { year: 2015 } });
    expect(sut.timelineProps).toMatchObject({ grouping: 'month', temporalAnchor: { year: 2015 } });
    sut.onTemporalAnchorResolved();
    expect(sut.temporalAnchor).toBeUndefined();
    sut.onGroupingChange('year');
    expect(sut.barProps).toMatchObject({ grouping: 'year', hidden: false });
    expect(sut.temporalAnchor).toEqual({ year: 2020 });
  });

  it('ignores bucket activation while selecting, and withholds the grouping handler when locked', () => {
    selection.selectionActive = true;
    const sut = timelineGroupingProps(() => timeline(2), { lockWhileSelecting: true });
    sut.onTimelineBucketActivate({ grouping: 'year', date: { year: 2015 } });
    expect(sut.grouping).toBe('day');
    expect(sut.timelineProps.onGroupingChange).toBeUndefined();
    expect(timelineGroupingProps(() => timeline(2)).timelineProps.onGroupingChange).toBeTypeOf('function');
  });

  it('offers add-all only with terms, for the timeline count', () => {
    expect(timelineGroupingProps(() => timeline(4)).barProps).not.toHaveProperty('onAddAllToCollection');
    const { barProps } = timelineGroupingProps(() => timeline(4), { addAllTerms: { isFavorite: true } });
    expect(barProps.resultCount).toBe(4);
    barProps.onAddAllToCollection?.();
    expect(showModal).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ terms: { isFavorite: true }, total: 4, smartSearchEnabled: false }),
    );
  });
});
