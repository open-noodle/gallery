import { getAssetTrim, isHttpError, removeAssetTrim, updateAssetTrim, type AssetResponseDto } from '@immich/sdk';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TrimManager } from './trim-manager.svelte';

vi.mock('@immich/sdk');

const notFound = { status: 404 };

function mockTrim(startTime: number, endTime: number, originalDuration: number) {
  vi.mocked(getAssetTrim).mockResolvedValue({ startTime, endTime, originalDuration });
}

function assetWithDuration(duration: number): AssetResponseDto {
  return { id: 'asset-1', duration } as unknown as AssetResponseDto;
}

describe('TrimManager', () => {
  let manager: TrimManager;

  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(isHttpError).mockImplementation((error) => error === notFound);
    vi.mocked(getAssetTrim).mockRejectedValue(notFound);
    manager = new TrimManager();
  });

  describe('onActivate', () => {
    it('should initialize from asset duration', async () => {
      await manager.onActivate(assetWithDuration(30_000));
      expect(manager.duration).toBe(30);
      expect(manager.startTime).toBe(0);
      expect(manager.endTime).toBe(30);
      expect(manager.hasChanges).toBe(false);
    });

    it('should restore an existing trim', async () => {
      mockTrim(5, 25, 30);
      await manager.onActivate(assetWithDuration(20_000));
      expect(getAssetTrim).toHaveBeenCalledWith({ id: 'asset-1' });
      expect(manager.startTime).toBe(5);
      expect(manager.endTime).toBe(25);
      expect(manager.hasChanges).toBe(true);
    });

    it('should use originalDuration for timeline range when re-editing a trimmed video', async () => {
      // After trimming, asset.duration is the trimmed duration (10s), but the trim reports the original (30s).
      // The timeline should show the full 30s range so the user can widen the trim.
      mockTrim(10, 20, 30);
      await manager.onActivate(assetWithDuration(10_000));
      expect(manager.duration).toBe(30); // full original range, not 10
      expect(manager.startTime).toBe(10);
      expect(manager.endTime).toBe(20);
      expect(manager.hasChanges).toBe(true);
    });
  });

  describe('handle clamping', () => {
    beforeEach(async () => {
      await manager.onActivate(assetWithDuration(30_000));
    });

    it('should clamp start past end to end - 1', () => {
      manager.setEnd(20);
      manager.setStart(25);
      expect(manager.startTime).toBe(19);
    });

    it('should clamp end before start to start + 1', () => {
      manager.setStart(10);
      manager.setEnd(5);
      expect(manager.endTime).toBe(11);
    });

    it('should clamp start to minimum 0', () => {
      manager.setStart(-5);
      expect(manager.startTime).toBe(0);
    });

    it('should clamp end to maximum duration', () => {
      manager.setEnd(50);
      expect(manager.endTime).toBe(30);
    });
  });

  describe('save', () => {
    it('should never contribute asset edits', async () => {
      await manager.onActivate(assetWithDuration(30_000));
      manager.setStart(5);
      expect(manager.edits).toEqual([]);
    });

    it('should remove the trim when there are no changes', async () => {
      await manager.onActivate(assetWithDuration(30_000));
      await manager.save('asset-1');
      expect(removeAssetTrim).toHaveBeenCalledWith({ id: 'asset-1' });
      expect(updateAssetTrim).not.toHaveBeenCalled();
    });

    it('should store the trim when changed', async () => {
      await manager.onActivate(assetWithDuration(30_000));
      manager.setStart(5);
      await manager.save('asset-1');
      expect(updateAssetTrim).toHaveBeenCalledWith({
        id: 'asset-1',
        assetVideoTrimDto: { startTime: 5, endTime: 30 },
      });
      expect(removeAssetTrim).not.toHaveBeenCalled();
    });
  });

  describe('resetAllChanges', () => {
    it('should reset to full duration', async () => {
      await manager.onActivate(assetWithDuration(30_000));
      manager.setStart(5);
      manager.setEnd(25);
      await manager.resetAllChanges();
      expect(manager.startTime).toBe(0);
      expect(manager.endTime).toBe(30);
      expect(manager.hasChanges).toBe(false);
    });
  });

  describe('constrained playback', () => {
    it('should pause and seek to start when currentTime reaches endTime', async () => {
      await manager.onActivate(assetWithDuration(30_000));
      manager.setStart(5);
      manager.setEnd(20);

      const mockVideo = {
        currentTime: 20,
        pause: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      } as unknown as HTMLVideoElement;

      manager.setVideoElement(mockVideo);

      // Simulate timeupdate firing at endTime
      const addEventListenerMock = vi.mocked(mockVideo.addEventListener);
      const timeupdateCall = addEventListenerMock.mock.calls.find((c) => c[0] === 'timeupdate');
      expect(timeupdateCall).toBeDefined();
      const onTimeUpdate = timeupdateCall![1] as EventListener;
      onTimeUpdate(new Event('timeupdate'));

      expect(mockVideo.pause).toHaveBeenCalled();
      expect(mockVideo.currentTime).toBe(5);
    });
  });

  describe('re-editing trimmed videos', () => {
    it('should allow widening trim beyond current trimmed duration', async () => {
      // Video was 120s, trimmed to 30-90 (60s). asset.duration is now 60s.
      // User re-opens editor — should be able to set start to 10 (before previous start).
      mockTrim(30, 90, 120);
      await manager.onActivate(assetWithDuration(60_000));

      // Can set start earlier than previous trim
      manager.setStart(10);
      expect(manager.startTime).toBe(10);

      // Can set end later than previous trim
      manager.setEnd(100);
      expect(manager.endTime).toBe(100);
    });

    it('should reset to full original duration, not trimmed duration', async () => {
      mockTrim(30, 90, 120);
      await manager.onActivate(assetWithDuration(60_000));

      await manager.resetAllChanges();
      expect(manager.startTime).toBe(0);
      expect(manager.endTime).toBe(120); // original duration, not 60
      expect(manager.hasChanges).toBe(false);
    });

    it('should clamp to original duration, not trimmed duration', async () => {
      mockTrim(10, 20, 30);
      await manager.onActivate(assetWithDuration(10_000));

      // End should clamp to original 30s, not trimmed 10s
      manager.setEnd(50);
      expect(manager.endTime).toBe(30);
    });

    it('should rethrow a failure other than not-trimmed', async () => {
      vi.mocked(getAssetTrim).mockRejectedValue(new Error('offline'));
      await expect(manager.onActivate(assetWithDuration(30_000))).rejects.toThrow('offline');
    });

    it('should store the widened range after widening a previous trim', async () => {
      mockTrim(30, 90, 120);
      await manager.onActivate(assetWithDuration(60_000));

      // Widen the trim
      manager.setStart(10);
      manager.setEnd(110);

      await manager.save('asset-1');
      expect(updateAssetTrim).toHaveBeenCalledWith({
        id: 'asset-1',
        assetVideoTrimDto: { startTime: 10, endTime: 110 },
      });
    });
  });

  describe('derived values', () => {
    it('should compute trimmedDuration correctly', async () => {
      await manager.onActivate(assetWithDuration(30_000));
      manager.setStart(5);
      manager.setEnd(25);
      expect(manager.trimmedDuration).toBe(20);
    });

    it('should compute percentages correctly', async () => {
      await manager.onActivate(assetWithDuration(100_000));
      manager.setStart(25);
      manager.setEnd(75);
      expect(manager.startPercent).toBeCloseTo(0.25);
      expect(manager.endPercent).toBeCloseTo(0.75);
    });

    it('should handle zero duration without division by zero', async () => {
      await manager.onActivate(assetWithDuration(0));
      expect(manager.duration).toBe(0);
      expect(manager.startPercent).toBe(0);
      expect(manager.endPercent).toBe(1);
      expect(manager.currentPercent).toBe(0);
    });
  });

  describe('video element lifecycle', () => {
    it('should clean up listeners on deactivate', async () => {
      await manager.onActivate(assetWithDuration(30_000));

      const mockVideo = {
        currentTime: 0,
        pause: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      } as unknown as HTMLVideoElement;

      manager.setVideoElement(mockVideo);
      expect(mockVideo.addEventListener).toHaveBeenCalledTimes(3); // timeupdate, play, pause

      manager.onDeactivate();

      expect(mockVideo.removeEventListener).toHaveBeenCalledTimes(3);
    });

    it('should handle setVideoElement(undefined) without error', async () => {
      await manager.onActivate(assetWithDuration(30_000));
      expect(() => manager.setVideoElement(undefined)).not.toThrow();
    });

    it('should replace video element cleanly', async () => {
      await manager.onActivate(assetWithDuration(30_000));

      const video1 = {
        currentTime: 0,
        pause: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      } as unknown as HTMLVideoElement;

      const video2 = {
        currentTime: 0,
        pause: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      } as unknown as HTMLVideoElement;

      manager.setVideoElement(video1);
      manager.setVideoElement(video2); // should cleanup video1

      expect(video1.removeEventListener).toHaveBeenCalledTimes(3);
      expect(video2.addEventListener).toHaveBeenCalledTimes(3);
    });
  });

  describe('duration parsing', () => {
    it('should handle null duration', async () => {
      await manager.onActivate({ duration: null } as unknown as AssetResponseDto);
      expect(manager.duration).toBe(0);
    });

    it('should handle undefined duration', async () => {
      await manager.onActivate({} as unknown as AssetResponseDto);
      expect(manager.duration).toBe(0);
    });

    it('should convert milliseconds to seconds', async () => {
      await manager.onActivate(assetWithDuration(5_445_500));
      expect(manager.duration).toBe(3600 + 1800 + 45 + 0.5);
    });

    it('should convert whole-second milliseconds', async () => {
      await manager.onActivate(assetWithDuration(60_000));
      expect(manager.duration).toBe(60);
    });
  });
});
