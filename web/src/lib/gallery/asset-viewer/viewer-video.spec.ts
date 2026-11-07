import { get } from 'svelte/store';
import { videoViewerVolume } from '$lib/gallery/stores/preferences.store';
import { seekViewerVideo } from './video-seek';
import { galleryViewerVideo } from './viewer-video';

describe('galleryViewerVideo', () => {
  it('persists the volume and makes the video seekable, until detached', async () => {
    videoViewerVolume.set(0.3);
    const video = document.createElement('video');
    vi.spyOn(video, 'play').mockResolvedValue();
    vi.spyOn(video, 'pause').mockImplementation(() => {});
    const detach = galleryViewerVideo(video) as () => void;

    expect(video.volume).toBe(0.3);
    expect(seekViewerVideo(7)).toBe(true);
    await vi.waitFor(() => expect(video.currentTime).toBe(7));

    detach();
    expect(seekViewerVideo(1)).toBe(false);
    videoViewerVolume.set(0.8);
    expect(video.volume).toBe(0.3);
    expect(get(videoViewerVolume)).toBe(0.8);
  });
});
