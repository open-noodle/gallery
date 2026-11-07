import '@testing-library/jest-dom';
import { cleanup, render, screen, waitFor } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { createRawSnippet } from 'svelte';
import VideoFaceSightings from './VideoFaceSightings.svelte';
import { videoFaceBox } from './video-face-box.svelte';

const box = { x1: 0.1, y1: 0.2, x2: 0.3, y2: 0.5 };

vi.mock('svelte-i18n', () => ({
  t: {
    subscribe: (run: (f: (k: string, o?: { values?: Record<string, unknown> }) => string) => void) => (
      run((k, o) => (o?.values ? `${k} ${JSON.stringify(o.values)}` : k)),
      () => {}
    ),
  },
}));

const { getAssetFaceSightings, removeAssetFaceSighting, restoreAssetFaceSighting, toastPrimary, handleError } =
  vi.hoisted(() => ({
    getAssetFaceSightings: vi.fn(),
    removeAssetFaceSighting: vi.fn(),
    restoreAssetFaceSighting: vi.fn(),
    toastPrimary: vi.fn(),
    handleError: vi.fn(),
  }));
vi.mock('@immich/sdk', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@immich/sdk')>()),
  getAssetFaceSightings,
  removeAssetFaceSighting,
  restoreAssetFaceSighting,
}));
vi.mock('@immich/ui', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@immich/ui')>()),
  toastManager: { primary: toastPrimary },
}));
vi.mock('$lib/utils/handle-error', () => ({ handleError }));

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
    render(VideoFaceSightings, { faceIds: ['face-1'] });

    await waitFor(() => expect(getAssetFaceSightings).toHaveBeenCalled());
    expect(screen.queryByTestId('video-face-sightings')).not.toBeInTheDocument();
  });

  it('shows nothing when the server has no such route or fails', async () => {
    getAssetFaceSightings.mockRejectedValue(new Error('404'));
    render(VideoFaceSightings, { faceIds: ['face-1'] });

    await waitFor(() => expect(getAssetFaceSightings).toHaveBeenCalled());
    expect(screen.queryByTestId('video-face-sightings')).not.toBeInTheDocument();
  });

  it('shows every sighting in time order, with the best one starred and lazy crops keyed by time', async () => {
    getAssetFaceSightings.mockResolvedValue({
      sightings: [
        { time: 2.5, score: 0.8, isBest: false, box },
        { time: 42, score: 0.95, isBest: true, box },
        { time: 3725, score: 0.7, isBest: false, box },
      ],
    });
    render(VideoFaceSightings, { faceIds: ['face-1'] });

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

  it('seeks the video to a sighting with its face box when it is clicked, and marks it', async () => {
    getAssetFaceSightings.mockResolvedValue({
      sightings: [
        { time: 2.5, score: 0.8, isBest: false, box },
        { time: 42, score: 0.95, isBest: true, box },
      ],
    });
    seekViewerVideo.mockReturnValue(true);
    render(VideoFaceSightings, { faceIds: ['face-1'] });

    const [first, second] = await screen.findAllByRole('button');
    await userEvent.click(second);

    expect(seekViewerVideo).toHaveBeenCalledWith(42, box);
    expect(second).toHaveAttribute('aria-pressed', 'true');
    expect(first).toHaveAttribute('aria-pressed', 'false');
  });

  it('takes the face box away when the strip closes', async () => {
    getAssetFaceSightings.mockResolvedValue({ sightings: [{ time: 42, score: 0.95, isBest: true, box }] });
    const { unmount } = render(VideoFaceSightings, { faceIds: ['face-1'] });
    await screen.findByRole('button');
    videoFaceBox.show(box, 42);

    unmount();
    expect(videoFaceBox.current).toBeUndefined();
  });

  it('lists the moments of several faces together in time order, each crop cut from its own face', async () => {
    getAssetFaceSightings.mockImplementation(({ id }: { id: string }) =>
      Promise.resolve({
        sightings:
          id === 'face-1'
            ? [
                { time: 8.5, score: 0.8, isBest: true, box },
                { time: 33.5, score: 0.7, isBest: false, box },
              ]
            : [{ time: 31.5, score: 0.9, isBest: true, box }],
      }),
    );
    render(VideoFaceSightings, { faceIds: ['face-1', 'face-2'] });

    const buttons = await screen.findAllByRole('button');
    expect(buttons.map((button) => button.textContent?.trim())).toEqual(['0:08', '0:31', '0:33']);
    const sources = screen.getAllByRole('presentation', { hidden: true }).map((image) => image.getAttribute('src'));
    expect(sources[0]).toMatch(/\/faces\/face-1\//);
    expect(sources[1]).toMatch(/\/faces\/face-2\//);
    expect(sources[2]).toMatch(/\/faces\/face-1\//);
  });

  it('still lists one face when another fails', async () => {
    getAssetFaceSightings.mockImplementation(({ id }: { id: string }) =>
      id === 'face-1'
        ? Promise.reject(new Error('404'))
        : Promise.resolve({ sightings: [{ time: 31.5, score: 0.9, isBest: true, box }] }),
    );
    render(VideoFaceSightings, { faceIds: ['face-1', 'face-2'] });

    expect(await screen.findAllByRole('button')).toHaveLength(1);
  });

  it('shows what it is given for nothing found, but only once it has looked', async () => {
    let answer = (_: { sightings: [] }) => {};
    getAssetFaceSightings.mockReturnValue(new Promise((resolve) => (answer = resolve)));
    const empty = createRawSnippet(() => ({ render: () => '<p>nothing here</p>' }));
    render(VideoFaceSightings, { faceIds: ['face-1'], empty });

    expect(screen.queryByText('nothing here')).not.toBeInTheDocument();
    answer({ sightings: [] });
    expect(await screen.findByText('nothing here')).toBeInTheDocument();
  });

  describe('removing a moment', () => {
    const early = { time: 8.5, score: 0.9, isBest: true, box };
    const late = { time: 31.5, score: 0.8, isBest: false, box };

    const tilesShown = () =>
      screen.getAllByRole('button', { name: /^video_face_sightings_show_at/ }).map((b) => b.textContent?.trim());

    it('offers no remove button without permission', async () => {
      getAssetFaceSightings.mockResolvedValue({ sightings: [early, late] });
      render(VideoFaceSightings, { faceIds: ['face-1'] });

      await screen.findAllByRole('button');
      expect(screen.queryByTestId('remove-sighting')).not.toBeInTheDocument();
    });

    it("offers it on each moment of a face with more than one, and keeps a face's last moment", async () => {
      getAssetFaceSightings.mockImplementation(({ id }: { id: string }) =>
        Promise.resolve({ sightings: id === 'face-1' ? [early, late] : [{ ...late, time: 40 }] }),
      );
      render(VideoFaceSightings, { faceIds: ['face-1', 'face-2'], canRemove: true });

      await waitFor(() => expect(tilesShown()).toEqual(['0:08', '0:31', '0:40']));
      expect(screen.getAllByTestId('remove-sighting')).toHaveLength(2);
    });

    it('takes the moment out, moves the star to what the server says, and offers to undo it', async () => {
      getAssetFaceSightings.mockResolvedValue({ sightings: [early, late] });
      removeAssetFaceSighting.mockResolvedValue({ sightings: [{ ...late, isBest: true }] });
      restoreAssetFaceSighting.mockResolvedValue({ sightings: [early, late] });
      render(VideoFaceSightings, { faceIds: ['face-1'], canRemove: true });

      const [removeEarly] = await screen.findAllByTestId('remove-sighting');
      await userEvent.click(removeEarly);

      expect(removeAssetFaceSighting).toHaveBeenCalledWith({ id: 'face-1', time: 8.5 });
      await waitFor(() => expect(tilesShown()).toEqual(['0:31']));
      expect(screen.getByTestId('best').closest('button')).toHaveTextContent('0:31');
      expect(screen.queryByTestId('remove-sighting')).not.toBeInTheDocument();

      const [[toast, options]] = toastPrimary.mock.calls;
      expect(toast.description).toBe('video_face_sighting_removed');
      expect(options).toEqual({ timeout: 5000 });
      await toast.button.onclick();

      expect(restoreAssetFaceSighting).toHaveBeenCalledWith({ id: 'face-1', time: 8.5 });
      await waitFor(() => expect(tilesShown()).toEqual(['0:08', '0:31']));
    });

    it('takes the face box away with the moment it was drawn for', async () => {
      getAssetFaceSightings.mockResolvedValue({ sightings: [early, late] });
      removeAssetFaceSighting.mockResolvedValue({ sightings: [{ ...late, isBest: true }] });
      seekViewerVideo.mockReturnValue(true);
      render(VideoFaceSightings, { faceIds: ['face-1'], canRemove: true });

      const [shownTile] = await screen.findAllByRole('button', { name: /^video_face_sightings_show_at/ });
      await userEvent.click(shownTile);
      videoFaceBox.show(box, 8.5);
      await userEvent.click(screen.getAllByTestId('remove-sighting')[0]);

      await waitFor(() => expect(videoFaceBox.current).toBeUndefined());
    });

    it('reports a failure and keeps the moment, with nothing to undo', async () => {
      getAssetFaceSightings.mockResolvedValue({ sightings: [early, late] });
      removeAssetFaceSighting.mockRejectedValue(new Error('500'));
      render(VideoFaceSightings, { faceIds: ['face-1'], canRemove: true });

      const [removeEarly] = await screen.findAllByTestId('remove-sighting');
      await userEvent.click(removeEarly);

      await waitFor(() =>
        expect(handleError).toHaveBeenCalledWith(expect.any(Error), 'video_face_sighting_remove_failed'),
      );
      expect(tilesShown()).toEqual(['0:08', '0:31']);
      expect(toastPrimary).not.toHaveBeenCalled();
    });
  });
});
