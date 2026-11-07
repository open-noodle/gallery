import '@testing-library/jest-dom';
import { cleanup, render, screen, waitFor } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import VideoFaceSightings from './VideoFaceSightings.svelte';

vi.mock('svelte-i18n', () => ({
  t: {
    subscribe: (run: (f: (k: string, o?: { values?: Record<string, unknown> }) => string) => void) => (
      run((k, o) => (o?.values ? `${k} ${JSON.stringify(o.values)}` : k)),
      () => {}
    ),
  },
}));

const getAssetFaceSightings = vi.hoisted(() => vi.fn());
vi.mock('@immich/sdk', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@immich/sdk')>()),
  getAssetFaceSightings,
}));

const seekViewerVideo = vi.hoisted(() => vi.fn());
vi.mock('$lib/gallery/asset-viewer/video-seek', async (importOriginal) => ({
  ...(await importOriginal<typeof import('$lib/gallery/asset-viewer/video-seek')>()),
  seekViewerVideo,
}));

describe('VideoFaceSightings', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('shows nothing for a face without sightings', async () => {
    getAssetFaceSightings.mockResolvedValue({ sightings: [] });
    render(VideoFaceSightings, { faceId: 'face-1' });

    await waitFor(() => expect(getAssetFaceSightings).toHaveBeenCalled());
    expect(screen.queryByTestId('video-face-sightings')).not.toBeInTheDocument();
  });

  it('shows nothing when the server has no such route or fails', async () => {
    getAssetFaceSightings.mockRejectedValue(new Error('404'));
    render(VideoFaceSightings, { faceId: 'face-1' });

    await waitFor(() => expect(getAssetFaceSightings).toHaveBeenCalled());
    expect(screen.queryByTestId('video-face-sightings')).not.toBeInTheDocument();
  });

  it('shows every sighting in the given order, with the best one starred and lazy crops keyed by time', async () => {
    getAssetFaceSightings.mockResolvedValue({
      sightings: [
        { time: 2.5, score: 0.8, isBest: false },
        { time: 42, score: 0.95, isBest: true },
        { time: 3725, score: 0.7, isBest: false },
      ],
    });
    render(VideoFaceSightings, { faceId: 'face-1' });

    const buttons = await screen.findAllByRole('button');
    expect(getAssetFaceSightings).toHaveBeenCalledWith({ id: 'face-1' }, expect.anything());
    expect(buttons.map((button) => button.textContent?.trim())).toEqual(['0:02', '0:42', '1:02:05']);
    expect(screen.getByText(/video_face_sightings_count/)).toHaveTextContent('{"count":3}');

    const images = screen.getAllByRole('presentation', { hidden: true });
    expect(images).toHaveLength(3);
    expect(images[1]).toHaveAttribute('loading', 'lazy');
    expect(images[1].getAttribute('src')).toMatch(/\/faces\/face-1\/sightings\/thumbnail\?.*time=42/);

    expect(screen.getAllByTestId('best')).toHaveLength(1);
    expect(buttons[1]).toContainElement(screen.getByTestId('best'));
  });

  it('seeks the video to a sighting when it is clicked, and marks it', async () => {
    getAssetFaceSightings.mockResolvedValue({
      sightings: [
        { time: 2.5, score: 0.8, isBest: false },
        { time: 42, score: 0.95, isBest: true },
      ],
    });
    seekViewerVideo.mockReturnValue(true);
    render(VideoFaceSightings, { faceId: 'face-1' });

    const [first, second] = await screen.findAllByRole('button');
    await userEvent.click(second);

    expect(seekViewerVideo).toHaveBeenCalledWith(42);
    expect(second).toHaveAttribute('aria-pressed', 'true');
    expect(first).toHaveAttribute('aria-pressed', 'false');
  });
});
