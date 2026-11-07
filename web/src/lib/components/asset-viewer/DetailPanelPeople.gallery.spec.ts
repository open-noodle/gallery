import { AssetTypeEnum, type PersonResponseDto } from '@immich/sdk';
import '@testing-library/jest-dom';
import { screen, waitFor } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { videoPersonSightings } from '$lib/gallery/asset-viewer/video-person-sightings.svelte';
import { renderWithTooltips } from '$tests/helpers';
import { assetFactory } from '@test-data/factories/asset-factory';
import DetailPanelPeople from './DetailPanelPeople.svelte';

// The film button on a video's People tiles and the moments it opens under the grid
// (specs/2026-10-31-video-face-frames-design.md, Phase 2).

const { faceManagerMock, getAssetFaceSightings } = vi.hoisted(() => ({
  faceManagerMock: {
    data: [] as unknown[],
    facesByPersonId: new Map<string, unknown[]>(),
    people: [] as PersonResponseDto[],
  },
  getAssetFaceSightings: vi.fn(),
}));

vi.mock('$lib/stores/face.svelte', () => ({ faceManager: faceManagerMock }));
vi.mock('$lib/utils/people-utils', () => ({ zoomImageToBase64: vi.fn().mockResolvedValue(undefined) }));
vi.mock('$app/navigation', () => ({ goto: vi.fn().mockResolvedValue(undefined) }));
vi.mock('$lib/managers/auth-manager.svelte', () => ({
  authManager: {
    authenticated: true,
    user: { id: 'owner-1' },
    isSharedLink: false,
    params: {},
    preferences: { tags: { enabled: true } },
  },
}));
vi.mock('$lib/managers/asset-viewer-manager.svelte', () => ({
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

const renderPanel = (type: AssetTypeEnum, faces: Record<string, string[]>) => {
  faceManagerMock.people = Object.keys(faces).map((name) => person(name));
  faceManagerMock.facesByPersonId = new Map(
    Object.entries(faces).map(([name, ids]) => [`person-${name}`, ids.map((id) => ({ id }))]),
  );
  faceManagerMock.data = Object.values(faces)
    .flat()
    .map((id) => ({ id }));
  return renderWithTooltips(DetailPanelPeople, {
    asset: assetFactory.build({ id: 'asset-1', ownerId: 'owner-1', type }),
    isOwner: true,
    previousRoute: '/photos',
  });
};

const momentsButton = (name: string) => screen.getByRole('button', { name: `video_person_sightings_show: ${name}` });

describe('DetailPanelPeople, a person’s moments in a video', () => {
  afterEach(() => {
    videoPersonSightings.clear();
    vi.clearAllMocks();
  });

  it('offers no film button on a photo', () => {
    renderPanel(AssetTypeEnum.Image, { Alice: ['face-1'] });
    expect(screen.queryByTestId('person-moments-button')).not.toBeInTheDocument();
  });

  it('offers no film button for a person with no face in this video', () => {
    renderPanel(AssetTypeEnum.Video, { Alice: [] });
    expect(screen.queryByTestId('person-moments-button')).not.toBeInTheDocument();
  });

  it('opens every moment of the person under the grid, across all their faces, and closes on a second click', async () => {
    getAssetFaceSightings.mockImplementation(({ id }: { id: string }) =>
      Promise.resolve({
        sightings: [{ time: id === 'face-1' ? 31.5 : 8.5, score: 0.9, isBest: true, box }],
      }),
    );
    renderPanel(AssetTypeEnum.Video, { Alice: ['face-1', 'face-2'], Bob: ['face-3'] });

    await userEvent.click(momentsButton('Alice'));

    const moments = await screen.findByTestId('video-person-moments');
    expect(moments).toHaveTextContent('Alice');
    await waitFor(() =>
      expect(screen.getAllByRole('button', { name: /^video_face_sightings_show_at/ })).toHaveLength(2),
    );
    expect(getAssetFaceSightings.mock.calls.map(([{ id }]) => id)).toEqual(['face-1', 'face-2']);
    expect(momentsButton('Alice')).toHaveAttribute('aria-pressed', 'true');
    expect(momentsButton('Bob')).toHaveAttribute('aria-pressed', 'false');

    await userEvent.click(momentsButton('Alice'));
    expect(screen.queryByTestId('video-person-moments')).not.toBeInTheDocument();
  });

  it('switches to another person, and closes with its own button', async () => {
    getAssetFaceSightings.mockResolvedValue({ sightings: [{ time: 4, score: 0.9, isBest: true, box }] });
    renderPanel(AssetTypeEnum.Video, { Alice: ['face-1'], Bob: ['face-3'] });

    await userEvent.click(momentsButton('Alice'));
    await userEvent.click(momentsButton('Bob'));
    expect(await screen.findByTestId('video-person-moments')).toHaveTextContent('Bob');
    await waitFor(() => expect(getAssetFaceSightings).toHaveBeenLastCalledWith({ id: 'face-3' }, expect.anything()));

    await userEvent.click(screen.getByRole('button', { name: 'close' }));
    expect(screen.queryByTestId('video-person-moments')).not.toBeInTheDocument();
  });

  it('says so when no moment of the person was recorded', async () => {
    getAssetFaceSightings.mockResolvedValue({ sightings: [] });
    renderPanel(AssetTypeEnum.Video, { Alice: ['face-1'] });

    await userEvent.click(momentsButton('Alice'));
    expect(await screen.findByText('video_person_sightings_none')).toBeInTheDocument();
  });

  it('does not carry the moments over to another asset', () => {
    videoPersonSightings.toggle({ assetId: 'asset-2', personId: 'person-Alice', name: 'Alice', faceIds: ['face-1'] });
    renderPanel(AssetTypeEnum.Video, { Alice: ['face-1'] });

    expect(screen.queryByTestId('video-person-moments')).not.toBeInTheDocument();
    expect(momentsButton('Alice')).toHaveAttribute('aria-pressed', 'false');
  });
});
