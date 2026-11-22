import { renderWithTooltips } from '#test/unit/helpers.ts';
import { AssetTypeEnum, Type, type AssetFaceResponseDto, type PersonResponseDto } from '@immich/sdk';
import { expect } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import AssignFaceSidePanel from './AssignFaceSidePanel.svelte';

const { getAllPeopleMock, getAssetFaceSightingsMock, searchPersonMock, zoomImageToBase64Mock } = vi.hoisted(() => ({
  getAllPeopleMock: vi.fn(),
  getAssetFaceSightingsMock: vi.fn(),
  searchPersonMock: vi.fn(),
  zoomImageToBase64Mock: vi.fn(),
}));

vi.mock('@immich/sdk', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    getAllPeople: (...args: unknown[]) => getAllPeopleMock(...args),
    getAssetFaceSightings: (...args: unknown[]) => getAssetFaceSightingsMock(...args),
    searchPerson: (...args: unknown[]) => searchPersonMock(...args),
  };
});

vi.mock('#lib/utils/people-utils.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, zoomImageToBase64: zoomImageToBase64Mock };
});

vi.mock('#lib/managers/asset-viewer-manager.svelte.js', () => ({
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

const renderPanel = (
  props: { onReassign?: (person: PersonResponseDto) => void; assetType?: AssetTypeEnum; onClose?: () => void } = {},
) =>
  renderWithTooltips(AssignFaceSidePanel, {
    editedFace,
    assetId: 'asset-1',
    assetType: props.assetType ?? AssetTypeEnum.Image,
    onClose: props.onClose ?? vi.fn(),
    onCreatePerson: vi.fn(),
    onReassign: props.onReassign ?? vi.fn(),
  });

const gridCaptions = async () => {
  const grid = page.getByTestId('person-picker-grid');
  await expect.element(grid).toBeInTheDocument();
  return grid
    .getByRole('button')
    .elements()
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
    getAssetFaceSightingsMock.mockReset();
    getAssetFaceSightingsMock.mockResolvedValue({ sightings: [{ time: 4, score: 0.9, isBest: true }] });
  });

  // Field report against pr-992-rc.8: the list "doesn't seem to follow any clear sort order,
  // neither alphabetical nor by frequency", which on a library with several hundred people makes it
  // impossible to scroll to anyone. It was ordered by resemblance to the tapped face -- upstream's
  // `closestAssetId`, a name suggestion that is useful for a handful of rows and noise after them.
  // Asking without it takes `getAllForUser`'s alphabetical branch, the same order every other
  // people list in the fork serves.
  it('asks for the alphabetical list, not the one ordered by resemblance', async () => {
    await renderPanel();

    await vi.waitFor(() => expect(getAllPeopleMock).toHaveBeenCalled());
    expect(getAllPeopleMock.mock.calls[0][0]).not.toHaveProperty('closestAssetId');
  });

  // #1287: a name given to someone inside a space lives on the space's profile and is resolved
  // per face identity at read time; it is never written back to the owner's `person` row. The
  // owner-only list (`withSharedSpaces` unset) hands back that raw row, so the owner tagging a face
  // on their own photo saw every space-named person unnamed, sorted into the unnamed tail, and
  // the Info panel only showed the name after the pick because `getFacesById` resolves it.
  describe('names set inside a space (#1287)', () => {
    const ownedProfile = (id: string) => ({ type: Type.UserPerson, id });
    const spaceProfile = (id: string) => ({ type: Type.SpacePerson, id, spaceId: 'space-1' });

    // What the server answers: the owner-only branch returns the raw `person` row, the identity
    // branch returns the same person with the name its space profile carries.
    const serveBothBranches = (identityPeople: PersonResponseDto[], rawPeople: PersonResponseDto[]) =>
      getAllPeopleMock.mockImplementation((dto: { withSharedSpaces?: boolean }) =>
        Promise.resolve({ people: dto.withSharedSpaces ? identityPeople : rawPeople }),
      );

    it('lists the name the person was given inside a space', async () => {
      serveBothBranches(
        [person({ id: 'p-1', name: 'Ann', primaryProfile: ownedProfile('p-1') })],
        [person({ id: 'p-1', name: '' })],
      );

      await renderPanel();

      await vi.waitFor(async () => expect(await gridCaptions()).toEqual(['Ann']));
    });

    // A face on the owner's photo can only be reassigned to a person the owner holds, so an
    // identity seen only through a space's profile is not a candidate here.
    it('leaves out people who only exist as a space profile', async () => {
      serveBothBranches(
        [
          person({ id: 'p-1', name: 'Ann', primaryProfile: ownedProfile('p-1') }),
          person({ id: 'sp-2', name: 'Zed', primaryProfile: spaceProfile('sp-2') }),
        ],
        [person({ id: 'p-1', name: '' })],
      );

      await renderPanel();

      await vi.waitFor(async () => expect(await gridCaptions()).toEqual(['Ann']));
    });

    it('finds a person by the name they were given inside a space', async () => {
      searchPersonMock.mockImplementation((dto: { withSharedSpaces?: boolean }) =>
        Promise.resolve(
          dto.withSharedSpaces
            ? [
                person({ id: 'p-1', name: 'Ann', primaryProfile: ownedProfile('p-1') }),
                person({ id: 'sp-2', name: 'Annika', primaryProfile: spaceProfile('sp-2') }),
              ]
            : [],
        ),
      );

      await renderPanel();
      await userEvent.type(page.getByPlaceholder('search_people'), 'an');

      await expect.element(page.getByText('Ann', { exact: true })).toBeInTheDocument();
      expect(page.getByText('Annika').query()).not.toBeInTheDocument();
    });

    // The identity search stops at 50 rows, half of `maximumLengthSearchPeople`. A full page means
    // the server may have more, so a longer query must ask again rather than narrow locally, even
    // when filtering out the space-only rows left fewer than that on screen.
    it('asks the server again when the identity search came back full', async () => {
      const full = Array.from({ length: 50 }, (_, index) =>
        index === 0
          ? person({ id: 'p-0', name: 'Al', primaryProfile: ownedProfile('p-0') })
          : person({ id: `sp-${index}`, name: `Al ${index}`, primaryProfile: spaceProfile(`sp-${index}`) }),
      );
      searchPersonMock.mockResolvedValue(full);

      await renderPanel();
      const field = page.getByPlaceholder('search_people');

      await userEvent.type(field, 'a');
      await vi.waitFor(() => expect(searchPersonMock).toHaveBeenCalledTimes(1));

      await userEvent.type(field, 'l');

      await vi.waitFor(() => expect(searchPersonMock).toHaveBeenCalledTimes(2));
    });
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

    await renderPanel();

    await vi.waitFor(async () => {
      const captions = await gridCaptions();
      expect(captions.slice(0, 2)).toEqual(['Bob', 'Carol']);
    });
  });

  // The search was behind a magnifier icon, so the first thing this panel showed on a large
  // library was the wall of unnamed clusters with no visible way to narrow it. Its space-flavoured
  // sibling has always shown the field outright.
  it('shows the search field without needing a magnifier first', async () => {
    await renderPanel();

    await expect.element(page.getByPlaceholder('search_people')).toBeInTheDocument();
  });

  // The field is focused on open, and `PersonSidePanel`'s document-level Escape skips keys typed
  // into a text field, so the picker's own field has to hand Escape back as a close.
  it('focuses the search field on open and closes on Escape', async () => {
    const onClose = vi.fn();
    await renderPanel({ onClose });
    await expect.element(page.getByPlaceholder('search_people')).toHaveFocus();

    await userEvent.keyboard('{Escape}');

    expect(onClose).toHaveBeenCalledOnce();
  });

  // `getAllPeople` serves one page, so filtering the loaded list client-side would silently stop
  // finding anyone past it. The query goes to the server, exactly as the magnifier used to.
  it('searches the server rather than filtering the loaded page', async () => {
    getAllPeopleMock.mockResolvedValue({ people: [person({ id: 'p-2', name: 'Bob' })] });
    searchPersonMock.mockResolvedValue([person({ id: 'p-9', name: 'Alice' })]);

    await renderPanel();

    await userEvent.type(page.getByPlaceholder('search_people'), 'a');

    await vi.waitFor(() =>
      expect(searchPersonMock).toHaveBeenCalledWith({ name: 'a', withSharedSpaces: true }, expect.anything()),
    );
    await expect.element(page.getByText('Alice')).toBeInTheDocument();
    await expect.element(page.getByText('Bob')).not.toBeInTheDocument();
  });

  // `PeopleSearch` short-circuited a growing query against an unsaturated result set, so typing a
  // name cost one request rather than one per letter. Issuing the request from here instead must
  // not quietly give that up.
  it('narrows an unsaturated result set without a second request', async () => {
    searchPersonMock.mockResolvedValue([person({ id: 'p-9', name: 'Alice' }), person({ id: 'p-8', name: 'Albert' })]);

    await renderPanel();
    const field = page.getByPlaceholder('search_people');

    await userEvent.type(field, 'a');
    await vi.waitFor(() => expect(searchPersonMock).toHaveBeenCalledTimes(1));

    await userEvent.type(field, 'lb');

    await expect.element(page.getByText('Alice')).not.toBeInTheDocument();
    await expect.element(page.getByText('Albert')).toBeInTheDocument();
    expect(searchPersonMock).toHaveBeenCalledTimes(1);
  });

  it('hands the clicked person back to the caller', async () => {
    const onReassign = vi.fn();
    getAllPeopleMock.mockResolvedValue({ people: [person({ id: 'p-2', name: 'Bob' })] });

    await renderPanel({ onReassign });

    await userEvent.click(page.getByRole('button', { name: /Bob/ }));

    expect(onReassign).toHaveBeenCalledWith(expect.objectContaining({ id: 'p-2', name: 'Bob' }));
  });

  it("shows where a video face's person was seen", async () => {
    await renderPanel({ assetType: AssetTypeEnum.Video });

    await expect.element(page.getByTestId('video-face-sightings')).toBeInTheDocument();
    expect(getAssetFaceSightingsMock).toHaveBeenCalledWith({ id: 'face-1' }, expect.anything());
  });

  it('asks for no sightings on a photo', async () => {
    await renderPanel();

    await expect.element(page.getByTestId('person-picker-panel')).toBeInTheDocument();
    expect(getAssetFaceSightingsMock).not.toHaveBeenCalled();
    expect(page.getByTestId('video-face-sightings').query()).not.toBeInTheDocument();
  });
});
