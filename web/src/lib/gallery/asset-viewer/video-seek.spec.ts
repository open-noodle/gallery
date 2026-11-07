import { formatSightingTime, registerSeekableVideo, seekViewerVideo } from './video-seek';

describe('seekViewerVideo', () => {
  it('does nothing without a registered video', () => {
    expect(seekViewerVideo(3)).toBe(false);
  });

  it('pauses the registered video at the time, until it is detached', () => {
    const video = document.createElement('video');
    const pause = vi.spyOn(video, 'pause').mockImplementation(() => {});
    const detach = registerSeekableVideo(video) as () => void;

    expect(seekViewerVideo(12.5)).toBe(true);
    expect(pause).toHaveBeenCalled();
    expect(video.currentTime).toBe(12.5);

    detach();
    expect(seekViewerVideo(1)).toBe(false);
  });

  it('keeps a newer video registered when an older one is detached after it', () => {
    const older = document.createElement('video');
    const newer = document.createElement('video');
    vi.spyOn(newer, 'pause').mockImplementation(() => {});
    const detachOlder = registerSeekableVideo(older) as () => void;
    const detachNewer = registerSeekableVideo(newer) as () => void;

    detachOlder();
    expect(seekViewerVideo(4)).toBe(true);
    expect(newer.currentTime).toBe(4);
    detachNewer();
  });
});

describe('formatSightingTime', () => {
  it.each([
    [0, '0:00'],
    [9.9, '0:09'],
    [65, '1:05'],
    [3600, '1:00:00'],
    [3725.4, '1:02:05'],
  ])('formats %s s as %s', (seconds, expected) => {
    expect(formatSightingTime(seconds)).toBe(expected);
  });
});
