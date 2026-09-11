import { AssetTypeEnum, type AssetFaceResponseDto, type PersonResponseDto } from '@immich/sdk';
import '@testing-library/jest-dom';
import { screen, waitFor, within } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { renderWithTooltips } from '$tests/helpers';
import AssignFaceSidePanel from './AssignFaceSidePanel.svelte';

const { getAllPeopleMock, searchPersonMock, zoomImageToBase64Mock } = vi.hoisted(() => ({
  getAllPeopleMock: vi.fn(),
  searchPersonMock: vi.fn(),
  zoomImageToBase64Mock: vi.fn(),
}));

vi.mock('@immich/sdk', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    getAllPeople: (...args: unknown[]) => getAllPeopleMock(...args),
    searchPerson: (...args: unknown[]) => searchPersonMock(...args),
  };
});

vi.mock('$lib/utils/people-utils', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, zoomImageToBase64: zoomImageToBase64Mock };
});

vi.mock('$lib/managers/asset-viewer-manager.svelte', () => ({
  assetViewerManager: {
    imgRef: undefined,
    highlightedFaces: [],
    setHighlightedFaces: vi.fn(),
    clearHighlightedFaces: vi.fn(),
  },
}));

const person = (overrides: Partial<PersonResponseDto> = {}): PersonResponseDto =>
  ({
    id: 'p-1',
    name: 'Bob',
    thumbnailPath: '',
    isHidden: false,
    isFavorite: false,
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }) as PersonResponseDto;

const editedFace = {
  id: 'face-1',
  imageWidth: 1000,
  imageHeight: 1000,
  boundingBoxX1: 10,
  boundingBoxY1: 10,
  boundingBoxX2: 50,
  boundingBoxY2: 50,
  sourceType: 'machine-learning',
} as AssetFaceResponseDto;

const renderPanel = (props: { onReassign?: (person: PersonResponseDto) => void } = {}) =>
  renderWithTooltips(AssignFaceSidePanel, {
    editedFace,
    assetId: 'asset-1',
    assetType: AssetTypeEnum.Image,
    onClose: vi.fn(),
    onCreatePerson: vi.fn(),
    onReassign: props.onReassign ?? vi.fn(),
  });

const gridCaptions = async () => {
  const grid = await screen.findByTestId('person-picker-grid');
  return within(grid)
    .getAllByRole('button')
    .map((button) => button.textContent?.trim() ?? '');
};

describe('AssignFaceSidePanel', () => {
  beforeEach(() => {
    getAllPeopleMock.mockReset();
    searchPersonMock.mockReset();
    zoomImageToBase64Mock.mockReset();
    zoomImageToBase64Mock.mockResolvedValue(null);

    getAllPeopleMock.mockResolvedValue({ people: [] });
    searchPersonMock.mockResolvedValue([]);
  });

  // Field report against pr-992-rc.8: the list "doesn't seem to follow any clear sort order,
  // neither alphabetical nor by frequency", which on a library with several hundred people makes it
  // impossible to scroll to anyone. It was ordered by resemblance to the tapped face -- upstream's
  // `closestAssetId`, a name suggestion that is useful for a handful of rows and noise after them.
  // Asking without it takes `getAllForUser`'s alphabetical branch, the same order every other
  // people list in the fork serves.
  it('asks for the alphabetical list, not the one ordered by resemblance', async () => {
    renderPanel();

    await waitFor(() => expect(getAllPeopleMock).toHaveBeenCalledWith({ withHidden: true }));
  });

  // Field report against pr-992-rc.5: the admin -- who owns the photos, so lands here rather than
  // on the space-flavoured picker -- got "an unstructured list of unlabeled faces instead of the
  // named people list". The server sorts named people first now; this is the rendering-side
  // backstop for that, and it must not disturb the alphabetical order it arrives in.
  it('lists named people ahead of the unnamed clusters', async () => {
    getAllPeopleMock.mockResolvedValue({
      people: [
        person({ id: 'p-1', name: '' }),
        person({ id: 'p-2', name: 'Bob' }),
        person({ id: 'p-3', name: '' }),
        person({ id: 'p-4', name: 'Carol' }),
      ],
    });

    renderPanel();

    await waitFor(async () => {
      const captions = await gridCaptions();
      expect(captions.slice(0, 2)).toEqual(['Bob', 'Carol']);
    });
  });

  // The search was behind a magnifier icon, so the first thing this panel showed on a large
  // library was the wall of unnamed clusters with no visible way to narrow it. Its space-flavoured
  // sibling has always shown the field outright.
  it('shows the search field without needing a magnifier first', async () => {
    renderPanel();

    expect(await screen.findByPlaceholderText('search_people')).toBeInTheDocument();
  });

  // `getAllPeople` serves one page, so filtering the loaded list client-side would silently stop
  // finding anyone past it. The query goes to the server, exactly as the magnifier used to.
  it('searches the server rather than filtering the loaded page', async () => {
    getAllPeopleMock.mockResolvedValue({ people: [person({ id: 'p-2', name: 'Bob' })] });
    searchPersonMock.mockResolvedValue([person({ id: 'p-9', name: 'Alice' })]);

    renderPanel();

    await userEvent.type(await screen.findByPlaceholderText('search_people'), 'a');

    await waitFor(() => expect(searchPersonMock).toHaveBeenCalledWith({ name: 'a' }, expect.anything()));
    expect(await screen.findByText('Alice')).toBeInTheDocument();
    expect(screen.queryByText('Bob')).not.toBeInTheDocument();
  });

  // `PeopleSearch` short-circuited a growing query against an unsaturated result set, so typing a
  // name cost one request rather than one per letter. Issuing the request from here instead must
  // not quietly give that up.
  it('narrows an unsaturated result set without a second request', async () => {
    searchPersonMock.mockResolvedValue([person({ id: 'p-9', name: 'Alice' }), person({ id: 'p-8', name: 'Albert' })]);

    renderPanel();
    const field = await screen.findByPlaceholderText('search_people');

    await userEvent.type(field, 'a');
    await waitFor(() => expect(searchPersonMock).toHaveBeenCalledTimes(1));

    await userEvent.type(field, 'lb');

    await waitFor(() => expect(screen.queryByText('Alice')).not.toBeInTheDocument());
    expect(screen.getByText('Albert')).toBeInTheDocument();
    expect(searchPersonMock).toHaveBeenCalledTimes(1);
  });

  it('hands the clicked person back to the caller', async () => {
    const onReassign = vi.fn();
    getAllPeopleMock.mockResolvedValue({ people: [person({ id: 'p-2', name: 'Bob' })] });

    renderPanel({ onReassign });

    await userEvent.click(await screen.findByRole('button', { name: /Bob/ }));

    expect(onReassign).toHaveBeenCalledWith(expect.objectContaining({ id: 'p-2', name: 'Bob' }));
  });
});
