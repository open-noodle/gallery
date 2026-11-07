import '@testing-library/jest-dom';
import { cleanup, render, screen, waitFor, within } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { createRawSnippet } from 'svelte';
import { renderWithTooltips } from '$tests/helpers';
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

const sdk = vi.hoisted(() => ({
  getAssetFaceSightings: vi.fn(),
  removeAssetFaceSighting: vi.fn(),
  restoreAssetFaceSighting: vi.fn(),
  splitAssetFaceSighting: vi.fn(),
  reassignFacesById: vi.fn(),
  createPerson: vi.fn(),
  deleteFace: vi.fn(),
}));
const { getAssetFaceSightings, removeAssetFaceSighting, restoreAssetFaceSighting } = sdk;
const { toastPrimary, showModal, handleError } = vi.hoisted(() => ({
  toastPrimary: vi.fn(),
  showModal: vi.fn(),
  handleError: vi.fn(),
}));
vi.mock('@immich/sdk', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@immich/sdk')>()),
  ...sdk,
}));
vi.mock('@immich/ui', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@immich/ui')>()),
  toastManager: { primary: toastPrimary },
  modalManager: { show: showModal },
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

  describe('editing a moment', () => {
    const early = { time: 8.5, score: 0.9, isBest: true, box };
    const late = { time: 31.5, score: 0.8, isBest: false, box };

    const tilesShown = () =>
      screen.getAllByRole('button', { name: /^video_face_sightings_show_at/ }).map((b) => b.textContent?.trim());

    /** Opens the menu of the moment at `index` and picks the item whose text starts with `item`. */
    const choose = async (index: number, item: string) => {
      const menus = await screen.findAllByTestId('sighting-menu');
      const menu = menus[index];
      await userEvent.click(within(menu).getByRole('button', { name: 'video_face_sighting_options' }));
      await userEvent.click(await within(menu).findByRole('menuitem', { name: new RegExp(`^${item}`) }));
    };

    const lastToast = () => {
      const [toast, options] = toastPrimary.mock.calls.at(-1)!;
      return { ...toast, options } as {
        description: string;
        options: { timeout: number };
        button: { onclick: () => Promise<void> };
      };
    };

    it('offers no menu without permission', async () => {
      getAssetFaceSightings.mockResolvedValue({ sightings: [early, late] });
      renderWithTooltips(VideoFaceSightings, { faceIds: ['face-1'] });

      await screen.findAllByRole('button');
      expect(screen.queryByTestId('sighting-menu')).not.toBeInTheDocument();
    });

    it("offers it on each moment of a face with more than one, and leaves a face's last moment alone", async () => {
      getAssetFaceSightings.mockImplementation(({ id }: { id: string }) =>
        Promise.resolve({ sightings: id === 'face-1' ? [early, late] : [{ ...late, time: 40 }] }),
      );
      renderWithTooltips(VideoFaceSightings, { faceIds: ['face-1', 'face-2'], canEdit: true });

      await waitFor(() => expect(tilesShown()).toEqual(['0:08', '0:31', '0:40']));
      expect(screen.getAllByTestId('sighting-menu')).toHaveLength(2);
    });

    describe('removing', () => {
      it('takes the moment out, moves the star to what the server says, and offers to undo it', async () => {
        getAssetFaceSightings.mockResolvedValue({ sightings: [early, late] });
        removeAssetFaceSighting.mockResolvedValue({ sightings: [{ ...late, isBest: true }] });
        restoreAssetFaceSighting.mockResolvedValue({ sightings: [early, late] });
        renderWithTooltips(VideoFaceSightings, { faceIds: ['face-1'], canEdit: true });

        await choose(0, 'video_face_sighting_remove');

        expect(removeAssetFaceSighting).toHaveBeenCalledWith({ id: 'face-1', time: 8.5 });
        await waitFor(() => expect(tilesShown()).toEqual(['0:31']));
        expect(screen.getByTestId('best').closest('button')).toHaveTextContent('0:31');
        expect(screen.queryByTestId('sighting-menu')).not.toBeInTheDocument();

        const toast = lastToast();
        expect(toast.description).toBe('video_face_sighting_removed');
        expect(toast.options).toEqual({ timeout: 5000 });
        await toast.button.onclick();

        expect(restoreAssetFaceSighting).toHaveBeenCalledWith({ id: 'face-1', time: 8.5 });
        await waitFor(() => expect(tilesShown()).toEqual(['0:08', '0:31']));
      });

      it('takes the face box away with the moment it was drawn for', async () => {
        getAssetFaceSightings.mockResolvedValue({ sightings: [early, late] });
        removeAssetFaceSighting.mockResolvedValue({ sightings: [{ ...late, isBest: true }] });
        seekViewerVideo.mockReturnValue(true);
        renderWithTooltips(VideoFaceSightings, { faceIds: ['face-1'], canEdit: true });

        const [shownTile] = await screen.findAllByRole('button', { name: /^video_face_sightings_show_at/ });
        await userEvent.click(shownTile);
        videoFaceBox.show(box, 8.5);
        await choose(0, 'video_face_sighting_remove');

        await waitFor(() => expect(videoFaceBox.current).toBeUndefined());
      });

      it('reports a failure and keeps the moment, with nothing to undo', async () => {
        getAssetFaceSightings.mockResolvedValue({ sightings: [early, late] });
        removeAssetFaceSighting.mockRejectedValue(new Error('500'));
        renderWithTooltips(VideoFaceSightings, { faceIds: ['face-1'], canEdit: true });

        await choose(0, 'video_face_sighting_remove');

        await waitFor(() =>
          expect(handleError).toHaveBeenCalledWith(expect.any(Error), 'video_face_sighting_remove_failed'),
        );
        expect(tilesShown()).toEqual(['0:08', '0:31']);
        expect(toastPrimary).not.toHaveBeenCalled();
      });
    });

    describe('moving', () => {
      beforeEach(() => {
        getAssetFaceSightings.mockResolvedValue({ sightings: [early, late] });
        sdk.splitAssetFaceSighting.mockResolvedValue({ faceId: 'new-face', sightings: [early] });
        sdk.reassignFacesById.mockResolvedValue([]);
        sdk.createPerson.mockResolvedValue({ id: 'person-new' });
        sdk.deleteFace.mockResolvedValue(undefined);
        restoreAssetFaceSighting.mockResolvedValue({ sightings: [early, late] });
      });

      it('moves the moment to a person picked from the others, then refreshes the faces', async () => {
        showModal.mockResolvedValue([{ id: 'person-bob', name: 'Bob' }]);
        const onFacesChanged = vi.fn();
        renderWithTooltips(VideoFaceSightings, {
          faceIds: ['face-1'],
          canEdit: true,
          personId: 'person-alice',
          onFacesChanged,
        });

        await choose(1, 'video_face_sighting_move_person');

        expect(showModal).toHaveBeenCalledWith(expect.anything(), { excludedIds: ['person-alice'] });
        await waitFor(() =>
          expect(sdk.reassignFacesById).toHaveBeenCalledWith({ id: 'person-bob', faceDto: { id: 'new-face' } }),
        );
        expect(sdk.splitAssetFaceSighting).toHaveBeenCalledWith({ id: 'face-1', time: 31.5 });
        expect(tilesShown()).toEqual(['0:08']);
        expect(onFacesChanged).toHaveBeenCalled();
        expect(lastToast().description).toBe('video_face_sighting_moved_person {"name":"Bob"}');
      });

      it('moves nothing when the picker is closed without a choice', async () => {
        showModal.mockResolvedValue(undefined);
        renderWithTooltips(VideoFaceSightings, { faceIds: ['face-1'], canEdit: true });

        await choose(1, 'video_face_sighting_move_person');

        await waitFor(() => expect(showModal).toHaveBeenCalled());
        expect(sdk.splitAssetFaceSighting).not.toHaveBeenCalled();
        expect(tilesShown()).toEqual(['0:08', '0:31']);
      });

      it('moves the moment to a new person', async () => {
        renderWithTooltips(VideoFaceSightings, { faceIds: ['face-1'], canEdit: true });

        await choose(1, 'video_face_sighting_move_new');

        await waitFor(() =>
          expect(sdk.reassignFacesById).toHaveBeenCalledWith({ id: 'person-new', faceDto: { id: 'new-face' } }),
        );
        expect(sdk.createPerson).toHaveBeenCalledWith({ personCreateDto: {} });
        expect(lastToast().description).toBe('video_face_sighting_moved_new');
      });

      it('moves the moment to unassigned: a face of its own, given to nobody', async () => {
        renderWithTooltips(VideoFaceSightings, { faceIds: ['face-1'], canEdit: true });

        await choose(1, 'video_face_sighting_move_unassigned');

        await waitFor(() => expect(lastToast().description).toBe('video_face_sighting_moved_unassigned'));
        expect(sdk.splitAssetFaceSighting).toHaveBeenCalledWith({ id: 'face-1', time: 31.5 });
        expect(sdk.reassignFacesById).not.toHaveBeenCalled();
        expect(sdk.createPerson).not.toHaveBeenCalled();
      });

      it('undoes a move by deleting the new face and bringing the moment back', async () => {
        const onFacesChanged = vi.fn();
        renderWithTooltips(VideoFaceSightings, { faceIds: ['face-1'], canEdit: true, onFacesChanged });
        await choose(1, 'video_face_sighting_move_unassigned');
        await waitFor(() => expect(toastPrimary).toHaveBeenCalled());
        onFacesChanged.mockClear();

        await lastToast().button.onclick();

        expect(sdk.deleteFace).toHaveBeenCalledWith({ id: 'new-face', assetFaceDeleteDto: { force: true } });
        expect(restoreAssetFaceSighting).toHaveBeenCalledWith({ id: 'face-1', time: 31.5 });
        await waitFor(() => expect(tilesShown()).toEqual(['0:08', '0:31']));
        expect(onFacesChanged).toHaveBeenCalled();
      });

      it('leaves the moment moved but unassigned when giving it to the person fails, still with an undo', async () => {
        showModal.mockResolvedValue([{ id: 'person-bob', name: 'Bob' }]);
        sdk.reassignFacesById.mockRejectedValue(new Error('500'));
        renderWithTooltips(VideoFaceSightings, { faceIds: ['face-1'], canEdit: true });

        await choose(1, 'video_face_sighting_move_person');

        await waitFor(() => expect(lastToast().description).toBe('video_face_sighting_moved_unassigned'));
        expect(handleError).toHaveBeenCalledWith(expect.any(Error), 'video_face_sighting_move_failed');
      });

      it('reports a failed split and moves nothing', async () => {
        sdk.splitAssetFaceSighting.mockRejectedValue(new Error('500'));
        renderWithTooltips(VideoFaceSightings, { faceIds: ['face-1'], canEdit: true });

        await choose(1, 'video_face_sighting_move_unassigned');

        await waitFor(() =>
          expect(handleError).toHaveBeenCalledWith(expect.any(Error), 'video_face_sighting_move_failed'),
        );
        expect(tilesShown()).toEqual(['0:08', '0:31']);
        expect(toastPrimary).not.toHaveBeenCalled();
      });
    });
  });
});
