export { generateTimelineData } from './timeline/model-objects.js';

export { createDefaultTimelineConfig, validateTimelineConfig } from './timeline/timeline-config.js';

export type {
  MockAlbum,
  MonthSpec,
  SerializedTimelineData,
  MockTimelineAsset as TimelineAssetConfig,
  TimelineConfig,
  MockTimelineData as TimelineData,
} from './timeline/timeline-config.js';

export {
  getAlbum,
  getAsset,
  getTimeBucket,
  getTimeBucketCovers,
  getTimeBuckets,
  toAssetResponseDto,
  toColumnarFormat,
} from './timeline/rest-response.js';

export type { Changes } from './timeline/rest-response.js';

export { randomImage, randomImageFromString, randomPreview, randomThumbnail } from './timeline/images.js';

export {
  SeededRandom,
  getMockAsset,
  parseTimeBucketKey,
  selectRandom,
  selectRandomDays,
  selectRandomMultiple,
} from './timeline/utils.js';

export { ASSET_DISTRIBUTION, DAY_DISTRIBUTION } from './timeline/distribution-patterns.js';
export type { DayPattern, MonthDistribution } from './timeline/distribution-patterns.js';
