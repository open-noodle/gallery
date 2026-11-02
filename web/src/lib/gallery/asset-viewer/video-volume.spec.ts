import { get } from 'svelte/store';
import { videoViewerMuted, videoViewerVolume } from '$lib/gallery/stores/preferences.store';
import { persistVideoVolume } from './video-volume';

describe('persistVideoVolume', () => {
  beforeEach(() => {
    videoViewerMuted.set(true);
    videoViewerVolume.set(0.4);
  });

  it('applies the stored state, follows store changes and persists element changes until detached', () => {
    const video = document.createElement('video');
    const detach = persistVideoVolume(video) as () => void;

    expect(video.muted).toBe(true);
    expect(video.volume).toBe(0.4);

    videoViewerVolume.set(0.6);
    expect(video.volume).toBe(0.6);

    video.muted = false;
    video.volume = 0.2;
    video.dispatchEvent(new Event('volumechange'));
    expect(get(videoViewerMuted)).toBe(false);
    expect(get(videoViewerVolume)).toBe(0.2);

    detach();
    videoViewerVolume.set(0.9);
    video.volume = 0.1;
    video.dispatchEvent(new Event('volumechange'));
    expect(video.volume).toBe(0.1);
    expect(get(videoViewerVolume)).toBe(0.9);
  });
});
