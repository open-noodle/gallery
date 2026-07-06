// Mutable timeline-manager stub shared between the Timeline mock and the spec. Tests set the shape
// (empty vs non-empty) BEFORE rendering; the Timeline mock snapshots it on mount. Default is
// non-empty so the timeline renders and the FilterPanel is visible unless a test opts into empty.
export interface MockTimelineState {
  isInitialized: boolean;
  scrollTop: number;
  grouping: string;
  months: unknown[];
  assetCount: number;
  removeAssets: (assetIds: string[]) => void;
  upsertAssets: (assets: unknown[]) => void;
}

export const mockTimelineState: MockTimelineState = {
  isInitialized: true,
  scrollTop: 0,
  grouping: 'day',
  months: [{}],
  assetCount: 12,
  removeAssets: vi.fn(),
  upsertAssets: vi.fn(),
};

export function resetMockTimelineState(): void {
  mockTimelineState.isInitialized = true;
  mockTimelineState.scrollTop = 0;
  mockTimelineState.grouping = 'day';
  mockTimelineState.months = [{}];
  mockTimelineState.assetCount = 12;
  mockTimelineState.removeAssets = vi.fn();
  mockTimelineState.upsertAssets = vi.fn();
}

export function setMockTimelineEmpty(): void {
  mockTimelineState.months = [];
  mockTimelineState.assetCount = 0;
}
