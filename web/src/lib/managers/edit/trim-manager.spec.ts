import type { EditActions } from '$lib/managers/edit/edit-manager.svelte';
import { AssetEditAction, type AssetResponseDto } from '@immich/sdk';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TrimManager } from './trim-manager.svelte';

function assetWithDuration(duration: string): AssetResponseDto {
  return { duration } as AssetResponseDto;
}

describe('TrimManager', () => {
  let manager: TrimManager;

  beforeEach(() => {
    manager = new TrimManager();
  });

  describe('onActivate', () => {
    it('should initialize from asset duration', async () => {
      await manager.onActivate(assetWithDuration('0:00:30.000000'), []);
      expect(manager.duration).toBe(30);
      expect(manager.startTime).toBe(0);
      expect(manager.endTime).toBe(30);
      expect(manager.hasChanges).toBe(false);
    });

    it('should restore existing trim edits', async () => {
      const edits: EditActions = [
        { action: AssetEditAction.Trim, parameters: { startTime: 5, endTime: 25 } },
      ];
      await manager.onActivate(assetWithDuration('0:00:30.000000'), edits);
      expect(manager.startTime).toBe(5);
      expect(manager.endTime).toBe(25);
      expect(manager.hasChanges).toBe(true);
    });
  });

  describe('handle clamping', () => {
    beforeEach(async () => {
      await manager.onActivate(assetWithDuration('0:00:30.000000'), []);
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

  describe('edits', () => {
    it('should return empty when no changes', async () => {
      await manager.onActivate(assetWithDuration('0:00:30.000000'), []);
      expect(manager.edits).toEqual([]);
    });

    it('should return trim edit when changed', async () => {
      await manager.onActivate(assetWithDuration('0:00:30.000000'), []);
      manager.setStart(5);
      expect(manager.edits).toHaveLength(1);
      expect(manager.edits[0]).toEqual({
        action: 'trim',
        parameters: { startTime: 5, endTime: 30 },
      });
    });
  });

  describe('resetAllChanges', () => {
    it('should reset to full duration', async () => {
      await manager.onActivate(assetWithDuration('0:00:30.000000'), []);
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
      await manager.onActivate(assetWithDuration('0:00:30.000000'), []);
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

  describe('duration parsing', () => {
    it('should handle null duration', async () => {
      await manager.onActivate({ duration: null } as unknown as AssetResponseDto, []);
      expect(manager.duration).toBe(0);
    });

    it('should handle undefined duration', async () => {
      await manager.onActivate({} as unknown as AssetResponseDto, []);
      expect(manager.duration).toBe(0);
    });

    it('should parse hours correctly', async () => {
      await manager.onActivate(assetWithDuration('1:30:45.500000'), []);
      expect(manager.duration).toBe(3600 + 1800 + 45 + 0.5);
    });

    it('should parse duration without fractional seconds', async () => {
      await manager.onActivate(assetWithDuration('0:01:00'), []);
      expect(manager.duration).toBe(60);
    });
  });
});
