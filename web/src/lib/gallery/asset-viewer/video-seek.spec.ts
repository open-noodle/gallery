import { videoFaceBox } from './video-face-box.svelte';
import { formatSightingTime, registerSeekableVideo, seekViewerVideo } from './video-seek';

const box = { x1: 0.1, y1: 0.2, x2: 0.3, y2: 0.5 };

/** A viewer video whose play starts at once (or as `play` says) and whose pause is recorded. */
const viewerVideo = (play: () => Promise<void> = () => Promise.resolve()) => {
  const video = document.createElement('video');
  const calls: string[] = [];
  vi.spyOn(video, 'play').mockImplementation(() => {
    calls.push(`play muted=${video.muted}`);
    return play();
  });
  vi.spyOn(video, 'pause').mockImplementation(() => {
    calls.push('pause');
  });
  return { video, calls };
};

describe('seekViewerVideo', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('does nothing without a registered video', () => {
    expect(seekViewerVideo(3)).toBe(false);
  });

  it('pauses the registered video at the time, until it is detached', async () => {
    const { video, calls } = viewerVideo();
    const detach = registerSeekableVideo(video) as () => void;

    expect(seekViewerVideo(12.5)).toBe(true);
    await vi.waitFor(() => expect(video.currentTime).toBe(12.5));
    expect(calls.at(-1)).toBe('pause');

    detach();
    expect(seekViewerVideo(1)).toBe(false);
  });

  it('plays muted for a moment first, so Safari draws the new frame, and gives the mute back', async () => {
    const { video, calls } = viewerVideo();
    video.muted = false;
    const detach = registerSeekableVideo(video) as () => void;

    seekViewerVideo(12.5);
    await vi.waitFor(() => expect(video.currentTime).toBe(12.5));
    expect(calls).toEqual(['play muted=true', 'pause']);
    expect(video.muted).toBe(false);
    detach();
  });

  it('lands on the latest of several quick seeks, with one play', async () => {
    let start = () => {};
    const { video, calls } = viewerVideo(() => new Promise((resolve) => (start = resolve)));
    video.muted = false;
    const detach = registerSeekableVideo(video) as () => void;

    seekViewerVideo(12.5, box);
    seekViewerVideo(30, box);
    start();
    await vi.waitFor(() => expect(video.currentTime).toBe(30));
    expect(calls).toEqual(['play muted=true', 'pause']);
    expect(video.muted).toBe(false);
    expect(videoFaceBox.current).toEqual({ box, time: 30 });
    detach();
    videoFaceBox.clear();
  });

  it('still seeks when the play never starts', async () => {
    vi.useFakeTimers();
    const { video } = viewerVideo(() => new Promise(() => {}));
    const detach = registerSeekableVideo(video) as () => void;

    seekViewerVideo(12.5);
    await vi.advanceTimersByTimeAsync(300);
    expect(video.currentTime).toBe(12.5);
    detach();
  });

  it('still seeks when the play is refused', async () => {
    const { video } = viewerVideo(() => Promise.reject(new DOMException('', 'NotAllowedError')));
    const detach = registerSeekableVideo(video) as () => void;

    seekViewerVideo(12.5);
    await vi.waitFor(() => expect(video.currentTime).toBe(12.5));
    detach();
  });

  it('keeps a newer video registered when an older one is detached after it', async () => {
    const older = viewerVideo().video;
    const newer = viewerVideo().video;
    const detachOlder = registerSeekableVideo(older) as () => void;
    const detachNewer = registerSeekableVideo(newer) as () => void;

    detachOlder();
    expect(seekViewerVideo(4)).toBe(true);
    await vi.waitFor(() => expect(newer.currentTime).toBe(4));
    detachNewer();
  });

  it('drops a seek whose video went away before it landed', async () => {
    let start = () => {};
    const { video } = viewerVideo(() => new Promise((resolve) => (start = resolve)));
    const detach = registerSeekableVideo(video) as () => void;

    seekViewerVideo(12.5, box);
    detach();
    start();
    await vi.waitFor(() => expect(video.pause).toHaveBeenCalled());
    expect(video.currentTime).toBe(0);
    expect(videoFaceBox.current).toBeUndefined();
  });
});

describe('the face box', () => {
  let video: HTMLVideoElement;
  let detach: () => void;

  const seekTo = async (time: number, withBox?: typeof box) => {
    seekViewerVideo(time, withBox);
    await vi.waitFor(() => expect(video.currentTime).toBe(time));
  };

  beforeEach(() => {
    video = viewerVideo().video;
    detach = registerSeekableVideo(video) as () => void;
  });

  afterEach(() => {
    detach();
    videoFaceBox.clear();
  });

  it('is shown at the moment a seek with a box holds the video on', async () => {
    await seekTo(12.5, box);
    expect(videoFaceBox.current).toEqual({ box, time: 12.5 });
  });

  it('is cleared by a seek without one', async () => {
    await seekTo(12.5, box);
    seekViewerVideo(3);
    expect(videoFaceBox.current).toBeUndefined();
    await seekTo(3);
    expect(videoFaceBox.current).toBeUndefined();
  });

  it('stays while the video settles on its moment, and goes when it is scrubbed away', async () => {
    await seekTo(12.5, box);
    video.dispatchEvent(new Event('seeking'));
    expect(videoFaceBox.current).toBeDefined();

    video.currentTime = 40;
    video.dispatchEvent(new Event('seeking'));
    expect(videoFaceBox.current).toBeUndefined();
  });

  it('goes when the video plays', async () => {
    await seekTo(12.5, box);
    video.dispatchEvent(new Event('play'));
    expect(videoFaceBox.current).toBeUndefined();
  });

  it('goes with the video it was drawn on', async () => {
    await seekTo(12.5, box);
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
