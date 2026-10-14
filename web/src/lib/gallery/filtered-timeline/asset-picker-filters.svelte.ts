import { SvelteMap } from 'svelte/reactivity';
import {
  clearFilters,
  createFilterState,
  getActiveFilterCount,
  type FilterPanelConfig,
} from '$lib/components/filter-panel/filter-panel';
import { withNameCapture } from '$lib/utils/filter-name-capture';
import { handlePhotosRemoveFilter } from '$lib/utils/photos-filter-options';

/** Filter state of an "add photos" picker: local only, never in the URL, never searched. */
export class AssetPickerFilters {
  filters = $state(createFilterState());
  readonly personNames = new SvelteMap<string, string>();
  readonly tagNames = new SvelteMap<string, string>();
  readonly config: FilterPanelConfig;
  readonly activeCount = $derived(getActiveFilterCount(this.filters));

  constructor(config: FilterPanelConfig) {
    this.config = withNameCapture(config, this.personNames, this.tagNames);
  }

  onRemoveFilter = (type: string, id?: string) => {
    this.filters = handlePhotosRemoveFilter(this.filters, type, id);
  };

  onClearAll = () => {
    this.filters = clearFilters(this.filters);
  };

  reset() {
    this.filters = createFilterState();
    this.personNames.clear();
    this.tagNames.clear();
  }
}
