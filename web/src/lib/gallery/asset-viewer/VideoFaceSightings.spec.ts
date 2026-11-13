import { renderWithTooltips } from '#test/unit/helpers.ts';
import { createRawSnippet } from 'svelte';
import { addMessages } from 'svelte-i18n';
import { expect } from 'vitest';
import { cleanup, render } from 'vitest-browser-svelte';
import { page, userEvent, type Locator } from 'vitest/browser';
import VideoFaceSightings from './VideoFaceSightings.svelte';
import { videoFaceBox } from './video-face-box.svelte';

const findOne = async (locator: Locator) => {
  await expect.element(locator).toBeInTheDocument();
  return locator.element() as HTMLElement;
};

const findAll = async (locator: Locator) => {
  await vi.waitFor(() => expect(locator.elements().length).toBeGreaterThan(0));
  return locator.elements() as HTMLElement[];
};

const box = { x1: 0.1, y1: 0.2, x2: 0.3, y2: 0.5 };

// Browser mode loads the real svelte-i18n in the test setup, before a spec-level mock could apply, and its `dev`
// locale renders bare keys. The two interpolated messages are registered so the values they carry can be asserted.
addMessages('dev', {
  video_face_sightings_count: 'video_face_sightings_count count={count}',
  video_face_sighting_moved_person: 'video_face_sighting_moved_person name={name}',
});

const sdk = vi.hoisted(() => ({
  getAssetFaceSightings: vi.fn(),
  removeAssetFaceSighting: vi.fn(),
  restoreAssetFaceSighting: vi.fn(),
  splitAssetFaceSighting: vi.fn(),
  moveAssetFaceSighting: vi.fn(),
  isHttpError: vi.fn((error: unknown) => typeof (error as { status?: unknown })?.status === 'number'),
  reassignFacesById: vi.fn(),
  createPerson: vi.fn(),
  deleteFace: vi.fn(),
}));
const { getAssetFaceSightings, removeAssetFaceSighting, restoreAssetFaceSighting } = sdk;
const { toastPrimary, showModal, showDialog, handleError } = vi.hoisted(() => ({
  toastPrimary: vi.fn(),
  showModal: vi.fn(),
  showDialog: vi.fn(),
  handleError: vi.fn(),
}));
vi.mock('@immich/sdk', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@immich/sdk')>()),
  ...sdk,
}));
vi.mock('@immich/ui', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@immich/ui')>()),
  toastManager: { primary: toastPrimary },
  modalManager: { show: showModal, showDialog },
}));
vi.mock('#lib/utils/handle-error.ts', () => ({ handleError }));
const faceManagerMock = vi.hoisted(() => ({ facesByPersonId: new Map<string, { id: string }[]>() }));
vi.mock('#lib/stores/face.svelte.ts', () => ({ faceManager: faceManagerMock }));

const seekViewerVideo = vi.hoisted(() => vi.fn());
vi.mock('#lib/gallery/asset-viewer/video-seek.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('#lib/gallery/asset-viewer/video-seek.ts')>()),
  seekViewerVideo,
}));

describe('VideoFaceSightings', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('shows nothing for a face without sightings', async () => {
    getAssetFaceSightings.mockResolvedValue({ sightings: [] });
    await render(VideoFaceSightings, { faceIds: ['face-1'] });

    await vi.waitFor(() => expect(getAssetFaceSightings).toHaveBeenCalled());
    expect(page.getByTestId('video-face-sightings').query()).not.toBeInTheDocument();
  });

  it('shows nothing when the server has no such route or fails', async () => {
    getAssetFaceSightings.mockRejectedValue(new Error('404'));
    await render(VideoFaceSightings, { faceIds: ['face-1'] });

    await vi.waitFor(() => expect(getAssetFaceSightings).toHaveBeenCalled());
    expect(page.getByTestId('video-face-sightings').query()).not.toBeInTheDocument();
  });

  it('shows every sighting in time order, with the best one starred and lazy crops keyed by time', async () => {
    getAssetFaceSightings.mockResolvedValue({
      sightings: [
        { time: 2.5, score: 0.8, isBest: false, box },
        { time: 42, score: 0.95, isBest: true, box },
        { time: 3725, score: 0.7, isBest: false, box },
      ],
    });
    await render(VideoFaceSightings, { faceIds: ['face-1'] });

    const buttons = await findAll(page.getByRole('button'));
    expect(getAssetFaceSightings).toHaveBeenCalledWith({ id: 'face-1' }, expect.anything());
    expect(buttons.map((button) => button.textContent?.trim())).toEqual(['0:02', '0:42', '1:02:05']);
    expect(page.getByText(/video_face_sightings_count/).element()).toHaveTextContent(
      'video_face_sightings_count count=3',
    );

    const images = page.getByRole('presentation', { includeHidden: true }).elements();
    expect(images).toHaveLength(3);
    expect(images[1]).toHaveAttribute('loading', 'lazy');
    expect(images[1].getAttribute('src')).toMatch(/\/faces\/face-1\/sightings\/thumbnail\?.*time=42/);

    expect(page.getByTestId('best').elements()).toHaveLength(1);
    expect(buttons[1]).toContainElement(page.getByTestId('best').element());
  });

  it('seeks the video to a sighting with its face box when it is clicked, and marks it', async () => {
    getAssetFaceSightings.mockResolvedValue({
      sightings: [
        { time: 2.5, score: 0.8, isBest: false, box },
        { time: 42, score: 0.95, isBest: true, box },
      ],
    });
    seekViewerVideo.mockReturnValue(true);
    await render(VideoFaceSightings, { faceIds: ['face-1'] });

    const [first, second] = await findAll(page.getByRole('button'));
    await userEvent.click(second);

    expect(seekViewerVideo).toHaveBeenCalledWith(42, box);
    expect(second).toHaveAttribute('aria-pressed', 'true');
    expect(first).toHaveAttribute('aria-pressed', 'false');
  });

  it('takes the face box away when the strip closes', async () => {
    getAssetFaceSightings.mockResolvedValue({ sightings: [{ time: 42, score: 0.95, isBest: true, box }] });
    const { unmount } = await render(VideoFaceSightings, { faceIds: ['face-1'] });
    await findOne(page.getByRole('button'));
    videoFaceBox.show(box, 42);

    await unmount();
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
    await render(VideoFaceSightings, { faceIds: ['face-1', 'face-2'] });

    const buttons = await findAll(page.getByRole('button'));
    expect(buttons.map((button) => button.textContent?.trim())).toEqual(['0:08', '0:31', '0:33']);
    const sources = page
      .getByRole('presentation', { includeHidden: true })
      .elements()
      .map((image) => image.getAttribute('src'));
    expect(sources[0]).toMatch(/\/faces\/face-1\//);
    expect(sources[1]).toMatch(/\/faces\/face-2\//);
    expect(sources[2]).toMatch(/\/faces\/face-1\//);
  });

  it('stars one moment across several faces: the best view the detector was surest of', async () => {
    getAssetFaceSightings.mockImplementation(({ id }: { id: string }) =>
      Promise.resolve({
        sightings:
          id === 'face-1'
            ? [{ time: 8.5, score: 0.8, isBest: true, box }]
            : [
                { time: 31.5, score: 0.9, isBest: true, box },
                { time: 33.5, score: 0.95, isBest: false, box },
              ],
      }),
    );
    await render(VideoFaceSightings, { faceIds: ['face-1', 'face-2'] });

    await vi.waitFor(() => expect(page.getByRole('button').elements()).toHaveLength(3));
    expect(page.getByTestId('best').elements()).toHaveLength(1);
    expect(page.getByTestId('best').element().closest('button')).toHaveTextContent('0:31');
  });

  it('still lists one face when another fails', async () => {
    getAssetFaceSightings.mockImplementation(({ id }: { id: string }) =>
      id === 'face-1'
        ? Promise.reject(new Error('404'))
        : Promise.resolve({ sightings: [{ time: 31.5, score: 0.9, isBest: true, box }] }),
    );
    await render(VideoFaceSightings, { faceIds: ['face-1', 'face-2'] });

    expect(await findAll(page.getByRole('button'))).toHaveLength(1);
  });

  it('shows what it is given for nothing found, but only once it has looked', async () => {
    let answer = (_: { sightings: [] }) => {};
    getAssetFaceSightings.mockReturnValue(new Promise((resolve) => (answer = resolve)));
    const empty = createRawSnippet(() => ({ render: () => '<p>nothing here</p>' }));
    await render(VideoFaceSightings, { faceIds: ['face-1'], empty });

    expect(page.getByText('nothing here').query()).not.toBeInTheDocument();
    answer({ sightings: [] });
    expect(await findOne(page.getByText('nothing here'))).toBeInTheDocument();
  });

  describe('editing a moment', () => {
    const early = { time: 8.5, score: 0.9, isBest: true, box };
    const late = { time: 31.5, score: 0.8, isBest: false, box };

    const tilesShown = () =>
      page
        .getByRole('button', { name: /^video_face_sightings_show_at/ })
        .elements()
        .map((b) => b.textContent?.trim());

    /** Opens the menu of the moment at `index` and picks the item whose text starts with `item`. */
    const choose = async (index: number, item: string) => {
      const menus = await findAll(page.getByTestId('sighting-menu'));
      const menu = menus[index];
      await userEvent.click(page.elementLocator(menu).getByRole('button', { name: 'video_face_sighting_options' }));
      await userEvent.click(page.elementLocator(menu).getByRole('menuitem', { name: new RegExp(`^${item}`) }));
    };

    type ToastButton = { onclick: () => Promise<void> };
    const lastToast = () => {
      const [toast, options] = toastPrimary.mock.calls.at(-1)!;
      // The button is built with the toast's close, so clicking Undo also closes it.
      const close = vi.fn();
      const { button } = toast as { button: ToastButton | ((close: () => void) => ToastButton) };
      return { ...toast, options, close, button: typeof button === 'function' ? button(close) : button } as {
        description: string;
        options: { timeout: number };
        close: ReturnType<typeof vi.fn>;
        button: ToastButton;
      };
    };

    it('offers no menu without permission', async () => {
      getAssetFaceSightings.mockResolvedValue({ sightings: [early, late] });
      await renderWithTooltips(VideoFaceSightings, { faceIds: ['face-1'] });

      await findAll(page.getByRole('button'));
      expect(page.getByTestId('sighting-menu').query()).not.toBeInTheDocument();
    });

    it("offers it on each moment of a face with more than one, and in the picker leaves a face's last moment alone", async () => {
      getAssetFaceSightings.mockImplementation(({ id }: { id: string }) =>
        Promise.resolve({ sightings: id === 'face-1' ? [early, late] : [{ ...late, time: 40 }] }),
      );
      await renderWithTooltips(VideoFaceSightings, { faceIds: ['face-1', 'face-2'], canEdit: true });

      await vi.waitFor(() => expect(tilesShown()).toEqual(['0:08', '0:31', '0:40']));
      expect(page.getByTestId('sighting-menu').elements()).toHaveLength(2);
    });

    describe('removing', () => {
      it('takes the moment out, moves the star to what the server says, and offers to undo it', async () => {
        getAssetFaceSightings.mockResolvedValue({ sightings: [early, late] });
        removeAssetFaceSighting.mockResolvedValue({ sightings: [{ ...late, isBest: true }] });
        restoreAssetFaceSighting.mockResolvedValue({ sightings: [early, late] });
        await renderWithTooltips(VideoFaceSightings, { faceIds: ['face-1'], canEdit: true });

        await choose(0, 'video_face_sighting_remove');

        expect(removeAssetFaceSighting).toHaveBeenCalledWith({ id: 'face-1', time: 8.5 });
        await vi.waitFor(() => expect(tilesShown()).toEqual(['0:31']));
        expect(page.getByTestId('best').element().closest('button')).toHaveTextContent('0:31');
        expect(page.getByTestId('sighting-menu').query()).not.toBeInTheDocument();

        const toast = lastToast();
        expect(toast.description).toBe('video_face_sighting_removed');
        expect(toast.options).toEqual({ timeout: 5000 });
        await toast.button.onclick();

        expect(toast.close).toHaveBeenCalledOnce();
        expect(restoreAssetFaceSighting).toHaveBeenCalledWith({ id: 'face-1', time: 8.5 });
        await vi.waitFor(() => expect(tilesShown()).toEqual(['0:08', '0:31']));
      });

      it('takes the face box away with the moment it was drawn for', async () => {
        getAssetFaceSightings.mockResolvedValue({ sightings: [early, late] });
        removeAssetFaceSighting.mockResolvedValue({ sightings: [{ ...late, isBest: true }] });
        seekViewerVideo.mockReturnValue(true);
        await renderWithTooltips(VideoFaceSightings, { faceIds: ['face-1'], canEdit: true });

        const [shownTile] = await findAll(page.getByRole('button', { name: /^video_face_sightings_show_at/ }));
        await userEvent.click(shownTile);
        videoFaceBox.show(box, 8.5);
        await choose(0, 'video_face_sighting_remove');

        await vi.waitFor(() => expect(videoFaceBox.current).toBeUndefined());
      });

      it('reports a failure and keeps the moment, with nothing to undo', async () => {
        getAssetFaceSightings.mockResolvedValue({ sightings: [early, late] });
        removeAssetFaceSighting.mockRejectedValue(new Error('500'));
        await renderWithTooltips(VideoFaceSightings, { faceIds: ['face-1'], canEdit: true });

        await choose(0, 'video_face_sighting_remove');

        await vi.waitFor(() =>
          expect(handleError).toHaveBeenCalledWith(expect.any(Error), 'video_face_sighting_remove_failed'),
        );
        expect(tilesShown()).toEqual(['0:08', '0:31']);
        expect(toastPrimary).not.toHaveBeenCalled();
      });
    });

    describe("a face's only moment", () => {
      const only = { time: 40, score: 0.7, isBest: true, box };
      const menuItems = (menu: Element) =>
        page
          .elementLocator(menu)
          .getByRole('menuitem', { includeHidden: true })
          .elements()
          .map((item) => item.textContent?.trim());

      beforeEach(() => {
        getAssetFaceSightings.mockImplementation(({ id }: { id: string }) =>
          Promise.resolve({ sightings: id === 'face-1' ? [early, late] : [only] }),
        );
        sdk.reassignFacesById.mockResolvedValue([]);
        sdk.createPerson.mockResolvedValue({ id: 'person-new' });
        sdk.deleteFace.mockResolvedValue(undefined);
      });

      const renderStrip = (onFacesChanged = vi.fn()) =>
        renderWithTooltips(VideoFaceSightings, {
          faceIds: ['face-1', 'face-2'],
          canEdit: true,
          personId: 'person-alice',
          onFacesChanged,
        });

      it('gets a menu for the whole face: move it, or delete it, but not split it off', async () => {
        await renderStrip();

        await vi.waitFor(() => expect(page.getByTestId('sighting-menu').elements()).toHaveLength(3));
        const [splittable, , wholeFace] = page.getByTestId('sighting-menu').elements();
        expect(menuItems(wholeFace)).toEqual([
          'video_face_sighting_move_person',
          'video_face_sighting_move_new',
          'video_face_sighting_delete_face',
        ]);
        expect(menuItems(splittable)).toContain('video_face_sighting_move_unassigned');
      });

      it('moves the whole face to a picked person, and gives it back on undo', async () => {
        showModal.mockResolvedValue([{ id: 'person-bob', name: 'Bob' }]);
        const onFacesChanged = vi.fn();
        await renderStrip(onFacesChanged);

        await choose(2, 'video_face_sighting_move_person');

        await vi.waitFor(() =>
          expect(sdk.reassignFacesById).toHaveBeenCalledWith({ id: 'person-bob', faceDto: { id: 'face-2' } }),
        );
        expect(sdk.splitAssetFaceSighting).not.toHaveBeenCalled();
        expect(tilesShown()).toEqual(['0:08', '0:31']);
        expect(onFacesChanged).toHaveBeenCalled();
        expect(lastToast().description).toBe('video_face_sighting_moved_person name=Bob');

        await lastToast().button.onclick();

        expect(sdk.reassignFacesById).toHaveBeenLastCalledWith({ id: 'person-alice', faceDto: { id: 'face-2' } });
        await vi.waitFor(() => expect(tilesShown()).toEqual(['0:08', '0:31', '0:40']));
      });

      it('moves the whole face to a new person', async () => {
        await renderStrip();

        await choose(2, 'video_face_sighting_move_new');

        await vi.waitFor(() =>
          expect(sdk.reassignFacesById).toHaveBeenCalledWith({ id: 'person-new', faceDto: { id: 'face-2' } }),
        );
        expect(lastToast().description).toBe('video_face_sighting_moved_new');
      });

      it('deletes the face once confirmed, as the face editor does, and not otherwise', async () => {
        showDialog.mockResolvedValueOnce(false);
        await renderStrip();

        await choose(2, 'video_face_sighting_delete_face');
        await vi.waitFor(() => expect(showDialog).toHaveBeenCalled());
        expect(sdk.deleteFace).not.toHaveBeenCalled();

        showDialog.mockResolvedValueOnce(true);
        await choose(2, 'video_face_sighting_delete_face');

        await vi.waitFor(() =>
          expect(sdk.deleteFace).toHaveBeenCalledWith({ id: 'face-2', assetFaceDeleteDto: { force: false } }),
        );
        expect(tilesShown()).toEqual(['0:08', '0:31']);
        expect(toastPrimary).toHaveBeenCalledWith('video_face_sighting_face_deleted');
      });
    });

    describe('moving to a person who already has a face in the video', () => {
      beforeEach(() => {
        getAssetFaceSightings.mockResolvedValue({ sightings: [early, late] });
        faceManagerMock.facesByPersonId = new Map([['person-bob', [{ id: 'face-bob' }]]]);
        showModal.mockResolvedValue([{ id: 'person-bob', name: 'Bob' }]);
        sdk.moveAssetFaceSighting.mockResolvedValue({ sightings: [early], targetSightings: [late] });
        sdk.splitAssetFaceSighting.mockResolvedValue({ faceId: 'new-face', sightings: [early] });
        sdk.reassignFacesById.mockResolvedValue([]);
      });

      afterEach(() => {
        faceManagerMock.facesByPersonId = new Map();
      });

      it('joins that face instead of making one, and moves it back on undo', async () => {
        const onFacesChanged = vi.fn();
        await renderWithTooltips(VideoFaceSightings, {
          faceIds: ['face-1'],
          canEdit: true,
          personId: 'person-alice',
          onFacesChanged,
        });

        await choose(1, 'video_face_sighting_move_person');

        await vi.waitFor(() =>
          expect(sdk.moveAssetFaceSighting).toHaveBeenCalledWith({ id: 'face-1', time: 31.5, toFaceId: 'face-bob' }),
        );
        expect(sdk.splitAssetFaceSighting).not.toHaveBeenCalled();
        expect(sdk.reassignFacesById).not.toHaveBeenCalled();
        expect(tilesShown()).toEqual(['0:08']);
        expect(onFacesChanged).toHaveBeenCalled();
        expect(lastToast().description).toBe('video_face_sighting_moved_person name=Bob');

        sdk.moveAssetFaceSighting.mockResolvedValue({ sightings: [], targetSightings: [early, late] });
        await lastToast().button.onclick();

        expect(sdk.moveAssetFaceSighting).toHaveBeenLastCalledWith({ id: 'face-bob', time: 31.5, toFaceId: 'face-1' });
        await vi.waitFor(() => expect(tilesShown()).toEqual(['0:08', '0:31']));
      });

      it("joins it with a face's only moment too, and on undo splits the moment out back to the strip's person", async () => {
        getAssetFaceSightings.mockImplementation(({ id }: { id: string }) =>
          Promise.resolve({ sightings: id === 'face-1' ? [early, late] : [{ ...late, time: 40 }] }),
        );
        sdk.moveAssetFaceSighting.mockResolvedValue({ sightings: [], targetSightings: [{ ...late, time: 40 }] });
        await renderWithTooltips(VideoFaceSightings, {
          faceIds: ['face-1', 'face-2'],
          canEdit: true,
          personId: 'person-alice',
        });

        await choose(2, 'video_face_sighting_move_person');

        await vi.waitFor(() =>
          expect(sdk.moveAssetFaceSighting).toHaveBeenCalledWith({ id: 'face-2', time: 40, toFaceId: 'face-bob' }),
        );
        expect(sdk.reassignFacesById).not.toHaveBeenCalled();
        await vi.waitFor(() => expect(tilesShown()).toEqual(['0:08', '0:31']));

        await lastToast().button.onclick();

        expect(sdk.splitAssetFaceSighting).toHaveBeenCalledWith({ id: 'face-bob', time: 40 });
        expect(sdk.reassignFacesById).toHaveBeenCalledWith({ id: 'person-alice', faceDto: { id: 'new-face' } });
      });

      it('falls back to a face of its own when the server refuses that face', async () => {
        sdk.moveAssetFaceSighting.mockRejectedValue(Object.assign(new Error('400'), { status: 400 }));
        await renderWithTooltips(VideoFaceSightings, { faceIds: ['face-1'], canEdit: true, personId: 'person-alice' });

        await choose(1, 'video_face_sighting_move_person');

        await vi.waitFor(() =>
          expect(sdk.reassignFacesById).toHaveBeenCalledWith({ id: 'person-bob', faceDto: { id: 'new-face' } }),
        );
        expect(sdk.splitAssetFaceSighting).toHaveBeenCalledWith({ id: 'face-1', time: 31.5 });
        expect(handleError).not.toHaveBeenCalled();
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
        await renderWithTooltips(VideoFaceSightings, {
          faceIds: ['face-1'],
          canEdit: true,
          personId: 'person-alice',
          onFacesChanged,
        });

        await choose(1, 'video_face_sighting_move_person');

        expect(showModal).toHaveBeenCalledWith(expect.anything(), { excludedIds: ['person-alice'] });
        await vi.waitFor(() =>
          expect(sdk.reassignFacesById).toHaveBeenCalledWith({ id: 'person-bob', faceDto: { id: 'new-face' } }),
        );
        expect(sdk.splitAssetFaceSighting).toHaveBeenCalledWith({ id: 'face-1', time: 31.5 });
        expect(tilesShown()).toEqual(['0:08']);
        expect(onFacesChanged).toHaveBeenCalled();
        expect(lastToast().description).toBe('video_face_sighting_moved_person name=Bob');
      });

      it('moves nothing when the picker is closed without a choice', async () => {
        showModal.mockResolvedValue(undefined);
        await renderWithTooltips(VideoFaceSightings, { faceIds: ['face-1'], canEdit: true });

        await choose(1, 'video_face_sighting_move_person');

        await vi.waitFor(() => expect(showModal).toHaveBeenCalled());
        expect(sdk.splitAssetFaceSighting).not.toHaveBeenCalled();
        expect(tilesShown()).toEqual(['0:08', '0:31']);
      });

      it('moves the moment to a new person', async () => {
        await renderWithTooltips(VideoFaceSightings, { faceIds: ['face-1'], canEdit: true });

        await choose(1, 'video_face_sighting_move_new');

        await vi.waitFor(() =>
          expect(sdk.reassignFacesById).toHaveBeenCalledWith({ id: 'person-new', faceDto: { id: 'new-face' } }),
        );
        expect(sdk.createPerson).toHaveBeenCalledWith({ personCreateDto: {} });
        expect(lastToast().description).toBe('video_face_sighting_moved_new');
      });

      it('moves the moment to unassigned: a face of its own, given to nobody', async () => {
        await renderWithTooltips(VideoFaceSightings, { faceIds: ['face-1'], canEdit: true });

        await choose(1, 'video_face_sighting_move_unassigned');

        await vi.waitFor(() => expect(lastToast().description).toBe('video_face_sighting_moved_unassigned'));
        expect(sdk.splitAssetFaceSighting).toHaveBeenCalledWith({ id: 'face-1', time: 31.5 });
        expect(sdk.reassignFacesById).not.toHaveBeenCalled();
        expect(sdk.createPerson).not.toHaveBeenCalled();
      });

      it('undoes a move by deleting the new face and bringing the moment back', async () => {
        const onFacesChanged = vi.fn();
        await renderWithTooltips(VideoFaceSightings, { faceIds: ['face-1'], canEdit: true, onFacesChanged });
        await choose(1, 'video_face_sighting_move_unassigned');
        await vi.waitFor(() => expect(toastPrimary).toHaveBeenCalled());
        onFacesChanged.mockClear();

        await lastToast().button.onclick();

        expect(sdk.deleteFace).toHaveBeenCalledWith({ id: 'new-face', assetFaceDeleteDto: { force: true } });
        expect(restoreAssetFaceSighting).toHaveBeenCalledWith({ id: 'face-1', time: 31.5 });
        await vi.waitFor(() => expect(tilesShown()).toEqual(['0:08', '0:31']));
        expect(onFacesChanged).toHaveBeenCalled();
      });

      it('leaves the moment moved but unassigned when giving it to the person fails, still with an undo', async () => {
        showModal.mockResolvedValue([{ id: 'person-bob', name: 'Bob' }]);
        sdk.reassignFacesById.mockRejectedValue(new Error('500'));
        await renderWithTooltips(VideoFaceSightings, { faceIds: ['face-1'], canEdit: true });

        await choose(1, 'video_face_sighting_move_person');

        await vi.waitFor(() => expect(lastToast().description).toBe('video_face_sighting_moved_unassigned'));
        expect(handleError).toHaveBeenCalledWith(expect.any(Error), 'video_face_sighting_move_failed');
      });

      it('reports a failed split and moves nothing', async () => {
        sdk.splitAssetFaceSighting.mockRejectedValue(new Error('500'));
        await renderWithTooltips(VideoFaceSightings, { faceIds: ['face-1'], canEdit: true });

        await choose(1, 'video_face_sighting_move_unassigned');

        await vi.waitFor(() =>
          expect(handleError).toHaveBeenCalledWith(expect.any(Error), 'video_face_sighting_move_failed'),
        );
        expect(tilesShown()).toEqual(['0:08', '0:31']);
        expect(toastPrimary).not.toHaveBeenCalled();
      });
    });
  });
});
