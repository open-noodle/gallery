import { videoFaceBox } from './video-face-box.svelte';
import { formatSightingTime, registerSeekableVideo, seekViewerVideo } from './video-seek';

const box = { x1: 0.1, y1: 0.2, x2: 0.3, y2: 0.5 };

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

describe('the face box', () => {
  let video: HTMLVideoElement;
  let detach: () => void;

  beforeEach(() => {
    video = document.createElement('video');
    vi.spyOn(video, 'pause').mockImplementation(() => {});
    detach = registerSeekableVideo(video) as () => void;
  });

  afterEach(() => {
    detach();
    videoFaceBox.clear();
  });

  it('is shown at the moment a seek with a box holds the video on', () => {
    seekViewerVideo(12.5, box);
    expect(videoFaceBox.current).toEqual({ box, time: 12.5 });
  });

  it('is cleared by a seek without one', () => {
    seekViewerVideo(12.5, box);
    seekViewerVideo(3);
    expect(videoFaceBox.current).toBeUndefined();
  });

  it('stays while the video settles on its moment, and goes when it is scrubbed away', () => {
    seekViewerVideo(12.5, box);
    video.dispatchEvent(new Event('seeking'));
    expect(videoFaceBox.current).toBeDefined();

    video.currentTime = 40;
    video.dispatchEvent(new Event('seeking'));
    expect(videoFaceBox.current).toBeUndefined();
  });

  it('goes when the video plays', () => {
    seekViewerVideo(12.5, box);
    video.dispatchEvent(new Event('play'));
    expect(videoFaceBox.current).toBeUndefined();
  });

  it('goes with the video it was drawn on', () => {
    seekViewerVideo(12.5, box);
    detach();
    expect(videoFaceBox.current).toBeUndefined();
    detach = () => {};
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
