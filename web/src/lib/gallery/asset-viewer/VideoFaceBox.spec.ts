import { flushSync } from 'svelte';
import { expect } from 'vitest';
import { cleanup, render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import VideoFaceBox from './VideoFaceBox.svelte';
import { videoFaceBox } from './video-face-box.svelte';

const fullHdVideo = () => {
  const video = document.createElement('video');
  Object.defineProperties(video, { videoWidth: { value: 1920 }, videoHeight: { value: 1080 } });
  return video;
};

const pixels = (value: string) => Number(value.replace(/px$/, ''));

const placementOf = ({ style }: HTMLElement | SVGElement) => ({
  left: pixels(style.left),
  top: pixels(style.top),
  width: pixels(style.width),
  height: pixels(style.height),
});

describe('VideoFaceBox', () => {
  afterEach(() => {
    cleanup();
    videoFaceBox.clear();
  });

  it('draws nothing until a sighting is shown', async () => {
    await render(VideoFaceBox, { video: fullHdVideo(), containerWidth: 1000, containerHeight: 1000 });
    expect(page.getByTestId('video-face-box').query()).not.toBeInTheDocument();
  });

  it('draws nothing before the video knows its size', async () => {
    videoFaceBox.show({ x1: 0.1, y1: 0.2, x2: 0.3, y2: 0.5 }, 4);
    await render(VideoFaceBox, { video: undefined, containerWidth: 1000, containerHeight: 1000 });
    expect(page.getByTestId('video-face-box').query()).not.toBeInTheDocument();
  });

  it('places the box on the picture of a letterboxed video', async () => {
    await render(VideoFaceBox, { video: fullHdVideo(), containerWidth: 1000, containerHeight: 1000 });
    videoFaceBox.show({ x1: 0.1, y1: 0.2, x2: 0.3, y2: 0.5 }, 4);
    flushSync();

    // 1920x1080 fitted into 1000x1000 is 1000x562.5, centred 218.75 px down.
    expect(placementOf(page.getByTestId('video-face-box').element())).toEqual({
      left: 0,
      top: 218.75,
      width: 1000,
      height: 562.5,
    });
    expect(placementOf(page.getByTestId('video-face-box-face').element())).toEqual({
      left: 100,
      top: 112.5,
      width: 200,
      height: 168.75,
    });
  });

  it('goes when the sighting is cleared', async () => {
    videoFaceBox.show({ x1: 0.1, y1: 0.2, x2: 0.3, y2: 0.5 }, 4);
    await render(VideoFaceBox, { video: fullHdVideo(), containerWidth: 1000, containerHeight: 1000 });
    expect(page.getByTestId('video-face-box').element()).toBeInTheDocument();

    videoFaceBox.clear();
    flushSync();
    expect(page.getByTestId('video-face-box').query()).not.toBeInTheDocument();
  });
});
