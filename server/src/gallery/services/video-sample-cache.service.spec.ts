import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defaults } from 'src/dtos/config.dto.js';
import { VideoSampleCacheService } from 'src/gallery/services/video-sample-cache.service.js';
import { videoSampleCache } from 'src/gallery/utils/video-sample-cache.js';
import { newTestService } from 'test/utils.js';

describe('VideoSampleCacheService', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(videoSampleCache, 'configure').mockResolvedValue();
  });

  it('applies saved or file-based settings on worker initialization', async () => {
    const { sut } = newTestService(VideoSampleCacheService);
    const config = structuredClone(defaults);
    config.server.videoSampleCache = { maxSizeGiB: 8, retentionHours: 72 };
    await sut.onConfigInit({ newConfig: config });
    expect(videoSampleCache.configure).toHaveBeenCalledWith({ maxSizeGiB: 8, retentionHours: 72 });
  });

  it('applies settings updates without restarting the worker', async () => {
    const { sut } = newTestService(VideoSampleCacheService);
    const config = structuredClone(defaults);
    config.server.videoSampleCache = { maxSizeGiB: 0, retentionHours: 1 };
    await sut.onConfigUpdate({ oldConfig: defaults, newConfig: config });
    expect(videoSampleCache.configure).toHaveBeenCalledWith({ maxSizeGiB: 0, retentionHours: 1 });
  });

  it('uses defaults when an older config has no cache block', async () => {
    const { sut } = newTestService(VideoSampleCacheService);
    const config = structuredClone(defaults);
    delete config.server.videoSampleCache;
    await sut.onConfigInit({ newConfig: config });
    expect(videoSampleCache.configure).toHaveBeenCalledWith({ maxSizeGiB: 2, retentionHours: 24 });
  });

  it('does not fail startup or config saves when optional cleanup fails', async () => {
    const { sut, mocks } = newTestService(VideoSampleCacheService);
    vi.mocked(videoSampleCache.configure).mockRejectedValue(new Error('disk unavailable'));
    await expect(sut.onConfigInit({ newConfig: defaults })).resolves.toBeUndefined();
    expect(mocks.logger.warn).toHaveBeenCalledWith(expect.stringContaining('disk unavailable'));
  });
});
