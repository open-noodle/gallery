import { videoPersonSightings } from '#lib/gallery/asset-viewer/video-person-sightings.svelte.ts';
import { factory } from '#test/unit/factories.ts';
import { renderWithTooltips } from '#test/unit/helpers.ts';
import { AssetTypeEnum, type PersonResponseDto } from '@immich/sdk';
import { expect } from 'vitest';
import { page, userEvent, type Locator } from 'vitest/browser';
import DetailPanelPeople from './DetailPanelPeople.svelte';

const findOne = async (locator: Locator) => {
  await expect.element(locator).toBeInTheDocument();
  return locator.element() as HTMLElement;
};

const findAll = async (locator: Locator) => {
  await vi.waitFor(() => expect(locator.elements().length).toBeGreaterThan(0));
  return locator.elements() as HTMLElement[];
};

// The film button on a video's People tiles and the moments it opens under the grid
// (specs/2026-10-31-video-face-frames-design.md, Phase 2).

const {
  faceManagerMock,
  getAssetFaceSightings,
  splitAssetFaceSighting,
  createPerson,
  reassignFacesById,
  mergeVideoFaces,
} = vi.hoisted(() => ({
  faceManagerMock: {
    data: [] as unknown[],
    facesByPersonId: new Map<string, unknown[]>(),
    people: [] as PersonResponseDto[],
    clear: vi.fn(),
    getAssetFaces: vi.fn(),
  },
  getAssetFaceSightings: vi.fn(),
  splitAssetFaceSighting: vi.fn(),
  createPerson: vi.fn(),
  reassignFacesById: vi.fn(),
  mergeVideoFaces: vi.fn(),
}));

vi.mock('#lib/stores/face.svelte.ts', () => ({ faceManager: faceManagerMock }));
vi.mock('#lib/utils/people-utils.ts', () => ({ zoomImageToBase64: vi.fn().mockResolvedValue(undefined) }));
vi.mock('#lib/managers/auth-manager.svelte.ts', () => ({
  authManager: {
    authenticated: true,
    user: { id: 'owner-1' },
    isSharedLink: false,
    params: {},
    preferences: { tags: { enabled: true } },
  },
}));
vi.mock('#lib/managers/asset-viewer-manager.svelte.ts', () => ({
  assetViewerManager: {
    clearHighlightedFaces: vi.fn(),
    highlightedFaces: [],
    imgRef: undefined,
    isShowingHiddenPeople: false,
    openEditFacesPanel: vi.fn(),
    setHighlightedFaces: vi.fn(),
    toggleFaceEditMode: vi.fn(),
    toggleHiddenPeople: vi.fn(),
  },
}));
vi.mock('@immich/sdk', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@immich/sdk')>()),
  getAssetFaceSightings,
  splitAssetFaceSighting,
  createPerson,
  reassignFacesById,
  mergeVideoFaces,
}));

const box = { x1: 0.1, y1: 0.2, x2: 0.3, y2: 0.5 };

const person = (name: string): PersonResponseDto =>
  ({
    id: `person-${name}`,
    name,
    birthDate: null,
    thumbnailPath: '',
    isHidden: false,
    isFavorite: false,
    updatedAt: '2026-01-01T00:00:00.000Z',
  }) as unknown as PersonResponseDto;

const renderPanel = async (type: AssetTypeEnum, faces: Record<string, string[]>, isOwner = true) => {
  faceManagerMock.people = Object.keys(faces).map((name) => person(name));
  faceManagerMock.facesByPersonId = new Map(
    Object.entries(faces).map(([name, ids]) => [`person-${name}`, ids.map((id) => ({ id }))]),
  );
  faceManagerMock.data = Object.values(faces)
    .flat()
    .map((id) => ({ id }));
  return await renderWithTooltips(DetailPanelPeople, {
    asset: factory.asset({ id: 'asset-1', ownerId: 'owner-1', type }),
    isOwner,
    previousRoute: '/photos',
  });
};

const momentsButton = (name: string) =>
  page.getByRole('button', { name: `video_person_sightings_show: ${name}` }).element();

describe('DetailPanelPeople, a person’s moments in a video', () => {
  afterEach(() => {
    videoPersonSightings.clear();
    vi.clearAllMocks();
  });

  it('offers no film button on a photo', async () => {
    await renderPanel(AssetTypeEnum.Image, { Alice: ['face-1'] });
    expect(page.getByTestId('person-moments-button').query()).not.toBeInTheDocument();
  });

  it('offers no film button for a person with no face in this video', async () => {
    await renderPanel(AssetTypeEnum.Video, { Alice: [] });
    expect(page.getByTestId('person-moments-button').query()).not.toBeInTheDocument();
  });

  it('opens every moment of the person under the grid, across all their faces, and closes on a second click', async () => {
    getAssetFaceSightings.mockImplementation(({ id }: { id: string }) =>
      Promise.resolve({
        sightings: [{ time: id === 'face-1' ? 31.5 : 8.5, score: 0.9, isBest: true, box }],
      }),
    );
    await renderPanel(AssetTypeEnum.Video, { Alice: ['face-1', 'face-2'], Bob: ['face-3'] });

    await userEvent.click(momentsButton('Alice'));

    const moments = await findOne(page.getByTestId('video-person-moments'));
    expect(moments.textContent).toContain('Alice');
    await vi.waitFor(() =>
      expect(page.getByRole('button', { name: /^video_face_sightings_show_at/ }).elements()).toHaveLength(2),
    );
    expect(getAssetFaceSightings.mock.calls.map(([{ id }]) => id)).toEqual(['face-1', 'face-2']);
    expect(momentsButton('Alice')).toHaveAttribute('aria-pressed', 'true');
    expect(momentsButton('Bob')).toHaveAttribute('aria-pressed', 'false');

    await userEvent.click(momentsButton('Alice'));
    expect(page.getByTestId('video-person-moments').query()).not.toBeInTheDocument();
  });

  it('switches to another person, and closes with its own button', async () => {
    getAssetFaceSightings.mockResolvedValue({ sightings: [{ time: 4, score: 0.9, isBest: true, box }] });
    await renderPanel(AssetTypeEnum.Video, { Alice: ['face-1'], Bob: ['face-3'] });

    await userEvent.click(momentsButton('Alice'));
    await userEvent.click(momentsButton('Bob'));
    const moments = await findOne(page.getByTestId('video-person-moments'));
    expect(moments.textContent).toContain('Bob');
    await vi.waitFor(() => expect(getAssetFaceSightings).toHaveBeenLastCalledWith({ id: 'face-3' }, expect.anything()));

    await userEvent.click(page.getByRole('button', { name: 'close' }).element());
    expect(page.getByTestId('video-person-moments').query()).not.toBeInTheDocument();
  });

  it('says so when no moment of the person was recorded', async () => {
    getAssetFaceSightings.mockResolvedValue({ sightings: [] });
    await renderPanel(AssetTypeEnum.Video, { Alice: ['face-1'] });

    await userEvent.click(momentsButton('Alice'));
    expect(await findOne(page.getByText('video_person_sightings_none'))).toBeInTheDocument();
  });

  it('does not carry the moments over to another asset', async () => {
    videoPersonSightings.toggle({ assetId: 'asset-2', personId: 'person-Alice', name: 'Alice', faceIds: ['face-1'] });
    await renderPanel(AssetTypeEnum.Video, { Alice: ['face-1'] });

    expect(page.getByTestId('video-person-moments').query()).not.toBeInTheDocument();
    expect(momentsButton('Alice')).toHaveAttribute('aria-pressed', 'false');
  });

  it('lets only the owner move or remove a moment', async () => {
    const sightings = [
      { time: 4, score: 0.9, isBest: true, box },
      { time: 9, score: 0.8, isBest: false, box },
    ];
    getAssetFaceSightings.mockResolvedValue({ sightings });
    const owner = await renderPanel(AssetTypeEnum.Video, { Alice: ['face-1'] });
    await userEvent.click(momentsButton('Alice'));
    await vi.waitFor(() => expect(page.getByTestId('sighting-menu').elements()).toHaveLength(2));
    await owner.unmount();
    videoPersonSightings.clear();

    await renderPanel(AssetTypeEnum.Video, { Alice: ['face-1'] }, false);
    await userEvent.click(momentsButton('Alice'));
    await vi.waitFor(() =>
      expect(page.getByRole('button', { name: /^video_face_sightings_show_at/ }).elements()).toHaveLength(2),
    );
    expect(page.getByTestId('sighting-menu').query()).not.toBeInTheDocument();
  });

  it('reloads the faces of the asset after a move, so the People grid shows where the moment went', async () => {
    getAssetFaceSightings.mockResolvedValue({
      sightings: [
        { time: 4, score: 0.9, isBest: true, box },
        { time: 9, score: 0.8, isBest: false, box },
      ],
    });
    splitAssetFaceSighting.mockResolvedValue({
      faceId: 'new-face',
      sightings: [{ time: 4, score: 0.9, isBest: true, box }],
    });
    await renderPanel(AssetTypeEnum.Video, { Alice: ['face-1'] });
    await userEvent.click(momentsButton('Alice'));

    const [, menu] = await findAll(page.getByTestId('sighting-menu'));
    await userEvent.click(page.elementLocator(menu).getByRole('button', { name: 'video_face_sighting_options' }));
    await userEvent.click(
      page.elementLocator(menu).getByRole('menuitem', { name: 'video_face_sighting_move_unassigned' }),
    );

    await vi.waitFor(() => expect(faceManagerMock.getAssetFaces).toHaveBeenCalledWith('asset-1'));
    expect(faceManagerMock.clear).toHaveBeenCalled();
  });

  it("closes a person's moments once their only face in the video has gone to someone else", async () => {
    getAssetFaceSightings.mockResolvedValue({ sightings: [{ time: 4, score: 0.9, isBest: true, box }] });
    createPerson.mockResolvedValue({ id: 'person-new' });
    reassignFacesById.mockResolvedValue([]);
    faceManagerMock.getAssetFaces.mockImplementation(() => {
      faceManagerMock.people = [];
      faceManagerMock.facesByPersonId = new Map();
      return Promise.resolve();
    });
    await renderPanel(AssetTypeEnum.Video, { Alice: ['face-1'] });
    await userEvent.click(momentsButton('Alice'));

    const menu = await findOne(page.getByTestId('sighting-menu'));
    await userEvent.click(page.elementLocator(menu).getByRole('button', { name: 'video_face_sighting_options' }));
    await userEvent.click(page.elementLocator(menu).getByRole('menuitem', { name: 'video_face_sighting_move_new' }));

    await vi.waitFor(() =>
      expect(reassignFacesById).toHaveBeenCalledWith({ id: 'person-new', faceDto: { id: 'face-1' } }),
    );
    await vi.waitFor(() => expect(videoPersonSightings.current).toBeUndefined());
  });

  describe('combining a person’s faces', () => {
    const combineButton = () => page.getByRole('button', { name: 'video_person_faces_combine' }).query();

    beforeEach(() => {
      getAssetFaceSightings.mockResolvedValue({ sightings: [{ time: 4, score: 0.9, isBest: true, box }] });
    });

    it('offers the owner to combine several faces of the person into one, and follows the faces left', async () => {
      mergeVideoFaces.mockResolvedValue({ faceId: 'face-1', sightings: [] });
      faceManagerMock.getAssetFaces.mockImplementation(() => {
        faceManagerMock.facesByPersonId = new Map([['person-Alice', [{ id: 'face-1' }]]]);
        return Promise.resolve();
      });
      await renderPanel(AssetTypeEnum.Video, { Alice: ['face-1', 'face-2', 'face-3'] });
      await userEvent.click(momentsButton('Alice'));

      await userEvent.click(combineButton()!);

      expect(mergeVideoFaces).toHaveBeenCalledWith({ videoFaceMergeDto: { faceIds: ['face-1', 'face-2', 'face-3'] } });
      await vi.waitFor(() => expect(videoPersonSightings.current?.faceIds).toEqual(['face-1']));
      expect(combineButton()).not.toBeInTheDocument();
    });

    it('offers nothing to combine for one face, or to anyone but the owner', async () => {
      const single = await renderPanel(AssetTypeEnum.Video, { Alice: ['face-1'] });
      await userEvent.click(momentsButton('Alice'));
      expect(combineButton()).not.toBeInTheDocument();
      await single.unmount();
      videoPersonSightings.clear();

      await renderPanel(AssetTypeEnum.Video, { Alice: ['face-1', 'face-2'] }, false);
      await userEvent.click(momentsButton('Alice'));
      expect(combineButton()).not.toBeInTheDocument();
    });
  });
});
