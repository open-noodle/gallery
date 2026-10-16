import { modalManager } from '@immich/ui';
import { get } from 'svelte/store';
import { getTimelineTopVisibleAnchor } from '$lib/gallery/timeline/timeline-anchor';
import { assetMultiSelectManager } from '$lib/managers/asset-multi-select-manager.svelte';
import type { TimelineManager } from '$lib/managers/timeline-manager/timeline-manager.svelte';
import type { TimelineGrouping, TimelineTemporalAnchor } from '$lib/managers/timeline-manager/types';
import SearchAddAllToCollectionModal from '$lib/modals/SearchAddAllToCollectionModal.svelte';
import type { SearchTerms } from '$lib/services/search.service';
import { lang } from '$lib/stores/preferences.store';
import { getTimelineBucketZoomTarget, type ActivatableTimelineBucket } from '$lib/utils/timeline-zoom-navigation';

type TimelineGroupingOptions = {
  /** Hide the grouping bar once the timeline has loaded empty. Default true. */
  hideWhenEmpty?: boolean;
  /** Withhold `onGroupingChange` from `<Timeline>` while a selection is active (the map panel). */
  lockWhileSelecting?: boolean;
  /** The route is itself an implicit filter: the bar offers "Add all N to…" for these terms. */
  addAllTerms?: SearchTerms;
};

/**
 * Day/month/year grouping and bucket zoom for a plain route timeline (archive, favorites, ...).
 * The route keeps upstream's `<Timeline>` and adds `grouping: timelineGrouping.grouping` to its options (the
 * grouping is what re-buckets), `{...barProps}` on `TimelineRouteGroupingBar` and `{...timelineProps}` on `<Timeline>`.
 */
export class TimelineGroupingProps {
  grouping = $state<TimelineGrouping>('day');
  temporalAnchor = $state<TimelineTemporalAnchor | undefined>();
  readonly #getTimelineManager: () => TimelineManager | undefined;
  readonly #options: TimelineGroupingOptions;

  constructor(getTimelineManager: () => TimelineManager | undefined, options: TimelineGroupingOptions = {}) {
    this.#getTimelineManager = getTimelineManager;
    this.#options = options;
  }

  get hidden() {
    const timelineManager = this.#getTimelineManager();
    return (
      assetMultiSelectManager.selectionActive ||
      (this.#options.hideWhenEmpty !== false && !!timelineManager?.isInitialized && timelineManager.assetCount === 0)
    );
  }

  get barProps() {
    const { addAllTerms } = this.#options;
    return {
      grouping: this.grouping,
      hidden: this.hidden,
      onGroupingChange: this.onGroupingChange,
      ...(addAllTerms && {
        resultCount: this.#getTimelineManager()?.assetCount ?? 0,
        onAddAllToCollection: () => this.#addAll(addAllTerms),
      }),
    };
  }

  get timelineProps() {
    const locked = this.#options.lockWhileSelecting && assetMultiSelectManager.selectionActive;
    return {
      temporalAnchor: this.temporalAnchor,
      onTimelineBucketActivate: this.onTimelineBucketActivate,
      onTemporalAnchorResolved: this.onTemporalAnchorResolved,
      grouping: this.grouping,
      onGroupingChange: locked ? undefined : this.onGroupingChange,
    };
  }

  onGroupingChange = (grouping: TimelineGrouping) => {
    const anchor = getTimelineTopVisibleAnchor(this.#getTimelineManager() as TimelineManager);
    this.grouping = grouping;
    this.temporalAnchor = anchor;
  };

  onTimelineBucketActivate = (bucket: ActivatableTimelineBucket) => {
    if (assetMultiSelectManager.selectionActive) {
      return;
    }

    const result = getTimelineBucketZoomTarget(bucket);
    if (!result) {
      return;
    }

    this.grouping = result.grouping;
    this.temporalAnchor = result.anchor;
  };

  onTemporalAnchorResolved = () => {
    this.temporalAnchor = undefined;
  };

  #addAll(terms: SearchTerms) {
    void modalManager.show(SearchAddAllToCollectionModal, {
      terms,
      total: this.#getTimelineManager()?.assetCount ?? 0,
      smartSearchEnabled: false,
      language: get(lang),
    });
  }
}

export const timelineGroupingProps = (
  getTimelineManager: () => TimelineManager | undefined,
  options?: TimelineGroupingOptions,
) => new TimelineGroupingProps(getTimelineManager, options);
