import '@testing-library/jest-dom';
import { cleanup, render, screen } from '@testing-library/svelte';
import { flushSync } from 'svelte';
import VideoFaceBox from './VideoFaceBox.svelte';
import { videoFaceBox } from './video-face-box.svelte';

const videoOfSize = (width: number, height: number) => {
  const video = document.createElement('video');
  Object.defineProperties(video, { videoWidth: { value: width }, videoHeight: { value: height } });
  return video;
};

const pixels = (value: string) => Number(value.replace(/px$/, ''));

const placementOf = ({ style }: HTMLElement) => ({
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

  it('draws nothing until a sighting is shown', () => {
    render(VideoFaceBox, { video: videoOfSize(1920, 1080), containerWidth: 1000, containerHeight: 1000 });
    expect(screen.queryByTestId('video-face-box')).not.toBeInTheDocument();
  });

  it('draws nothing before the video knows its size', () => {
    videoFaceBox.show({ x1: 0.1, y1: 0.2, x2: 0.3, y2: 0.5 }, 4);
    render(VideoFaceBox, { video: undefined, containerWidth: 1000, containerHeight: 1000 });
    expect(screen.queryByTestId('video-face-box')).not.toBeInTheDocument();
  });

  it('places the box on the picture of a letterboxed video', () => {
    render(VideoFaceBox, { video: videoOfSize(1920, 1080), containerWidth: 1000, containerHeight: 1000 });
    videoFaceBox.show({ x1: 0.1, y1: 0.2, x2: 0.3, y2: 0.5 }, 4);
    flushSync();

    // 1920x1080 fitted into 1000x1000 is 1000x562.5, centred 218.75 px down.
    expect(placementOf(screen.getByTestId('video-face-box'))).toEqual({
      left: 0,
      top: 218.75,
      width: 1000,
      height: 562.5,
    });
    expect(placementOf(screen.getByTestId('video-face-box-face'))).toEqual({
      left: 100,
      top: 112.5,
      width: 200,
      height: 168.75,
    });
  });

  it('goes when the sighting is cleared', () => {
    videoFaceBox.show({ x1: 0.1, y1: 0.2, x2: 0.3, y2: 0.5 }, 4);
    render(VideoFaceBox, { video: videoOfSize(1920, 1080), containerWidth: 1000, containerHeight: 1000 });
    expect(screen.getByTestId('video-face-box')).toBeInTheDocument();

    videoFaceBox.clear();
    flushSync();
    expect(screen.queryByTestId('video-face-box')).not.toBeInTheDocument();
  });
});
