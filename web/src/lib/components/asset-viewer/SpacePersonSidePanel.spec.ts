import { AssetTypeEnum, type SharedSpacePersonResponseDto, type SpaceAssetFaceResponseDto } from '@immich/sdk';
import '@testing-library/jest-dom';
import { screen, waitFor } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { renderWithTooltips } from '$tests/helpers';
import SpacePersonSidePanel from './SpacePersonSidePanel.svelte';

const {
  getSpaceAssetFacesMock,
  getSpacePeopleMock,
  attachSpacePersonFaceMock,
  createSpacePersonMock,
  detachSpacePersonFaceMock,
  deleteSpaceAssetFaceMock,
  zoomImageToBase64Mock,
} = vi.hoisted(() => ({
  getSpaceAssetFacesMock: vi.fn(),
  getSpacePeopleMock: vi.fn(),
  attachSpacePersonFaceMock: vi.fn(),
  createSpacePersonMock: vi.fn(),
  detachSpacePersonFaceMock: vi.fn(),
  deleteSpaceAssetFaceMock: vi.fn(),
  zoomImageToBase64Mock: vi.fn(),
}));

vi.mock('@immich/sdk', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    getSpaceAssetFaces: (...args: unknown[]) => getSpaceAssetFacesMock(...args),
    getSpacePeople: (...args: unknown[]) => getSpacePeopleMock(...args),
    attachSpacePersonFace: (...args: unknown[]) => attachSpacePersonFaceMock(...args),
    createSpacePerson: (...args: unknown[]) => createSpacePersonMock(...args),
    detachSpacePersonFace: (...args: unknown[]) => detachSpacePersonFaceMock(...args),
    deleteSpaceAssetFace: (...args: unknown[]) => deleteSpaceAssetFaceMock(...args),
  };
});

// The crop render is not under test here (DetailPanelPeople.spec.ts already pins that behaviour);
// stubbed so every row resolves to a deterministic fallback without needing a real <img>.
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

const face = (overrides: Partial<SpaceAssetFaceResponseDto> = {}): SpaceAssetFaceResponseDto => ({
  id: 'face-1',
  boundingBoxX1: 10,
  boundingBoxY1: 10,
  boundingBoxX2: 50,
  boundingBoxY2: 50,
  imageWidth: 1000,
  imageHeight: 1000,
  spacePersonId: null,
  spacePersonName: null,
  isEditorDrawn: false,
  ...overrides,
});

const spacePerson = (overrides: Partial<SharedSpacePersonResponseDto> = {}): SharedSpacePersonResponseDto =>
  ({
    id: 'sp-1',
    spaceId: 'space-1',
    name: 'Bob',
    thumbnailPath: '',
    isHidden: false,
    representativeFaceSource: 'auto',
    faceCount: 1,
    assetCount: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }) as SharedSpacePersonResponseDto;

const renderPanel = (props: { onClose?: () => void; onRefresh?: () => void } = {}) =>
  renderWithTooltips(SpacePersonSidePanel, {
    spaceId: 'space-1',
    assetId: 'asset-1',
    assetType: AssetTypeEnum.Image,
    onClose: props.onClose ?? vi.fn(),
    onRefresh: props.onRefresh ?? vi.fn(),
  });

describe('SpacePersonSidePanel', () => {
  beforeEach(() => {
    getSpaceAssetFacesMock.mockReset();
    getSpacePeopleMock.mockReset();
    attachSpacePersonFaceMock.mockReset();
    createSpacePersonMock.mockReset();
    detachSpacePersonFaceMock.mockReset();
    deleteSpaceAssetFaceMock.mockReset();
    zoomImageToBase64Mock.mockReset();
    zoomImageToBase64Mock.mockResolvedValue(null);

    getSpaceAssetFacesMock.mockResolvedValue([]);
    getSpacePeopleMock.mockResolvedValue([]);
  });

  it('lists the faces on the asset from the space-scoped read', async () => {
    getSpaceAssetFacesMock.mockResolvedValue([
      face({ id: 'face-1', spacePersonId: 'sp-1', spacePersonName: 'Bob' }),
      face({ id: 'face-2' }),
    ]);

    renderPanel();

    await waitFor(() => expect(getSpaceAssetFacesMock).toHaveBeenCalledWith({ id: 'space-1', assetId: 'asset-1' }));
    expect(await screen.findByText('Bob')).toBeInTheDocument();
    expect(screen.getByText('face_unassigned')).toBeInTheDocument();
  });

  // Field report on #992: an editor opening this panel got a spinner that never resolved. The
  // space-scoped read had returned the same face twice (it was named in a second space too), and a
  // keyed `{#each}` throws `each_key_duplicate` on the repeat — Svelte then abandons the branch
  // swap, leaving the spinner mounted with no error and no way back. The read no longer repeats a
  // face, and this pins that the panel does not go back to depending on that to render at all.
  it('renders one row per face, and no spinner, when the read repeats a face id', async () => {
    getSpaceAssetFacesMock.mockResolvedValue([
      face({ id: 'face-1', spacePersonId: 'sp-1', spacePersonName: 'Bob' }),
      face({ id: 'face-1', spacePersonId: 'sp-2', spacePersonName: 'Bob' }),
      face({ id: 'face-2' }),
    ]);

    renderPanel();

    expect(await screen.findByText('Bob')).toBeInTheDocument();
    expect(screen.getAllByText('Bob')).toHaveLength(1);
    expect(screen.getByText('face_unassigned')).toBeInTheDocument();
    expect(screen.queryByTestId('loading-spinner')).not.toBeInTheDocument();
  });

  it('F-31: shows an error state and no affordances when the faces request rejects', async () => {
    getSpaceAssetFacesMock.mockRejectedValue(new Error('boom'));

    renderPanel();

    await waitFor(() => expect(screen.getByTestId('space-person-panel-error')).toBeInTheDocument());
    expect(screen.queryAllByRole('button', { name: /select_new_face|unassign_face/ })).toHaveLength(0);
  });

  it('attaches an existing space person to an unassigned face', async () => {
    getSpaceAssetFacesMock.mockResolvedValue([face({ id: 'face-1' })]);
    getSpacePeopleMock.mockResolvedValue([spacePerson({ id: 'sp-1', name: 'Bob' })]);
    attachSpacePersonFaceMock.mockResolvedValue({ acted: true });
    const onRefresh = vi.fn();

    renderPanel({ onRefresh });
    await waitFor(() => expect(getSpaceAssetFacesMock).toHaveBeenCalled());

    await userEvent.click(screen.getByRole('button', { name: 'select_new_face' }));
    await waitFor(() => expect(getSpacePeopleMock).toHaveBeenCalledWith({ id: 'space-1', withHidden: false }));

    await userEvent.click(await screen.findByRole('button', { name: /Bob/ }));

    await waitFor(() =>
      expect(attachSpacePersonFaceMock).toHaveBeenCalledWith({
        id: 'space-1',
        personId: 'sp-1',
        assetFaceId: 'face-1',
      }),
    );
    expect(onRefresh).toHaveBeenCalled();
    // The row updates in place to reflect the new attachment.
    expect(await screen.findByText('Bob')).toBeInTheDocument();
  });

  // Field report on #992 (pr-992-rc.3): the picker's only text field was the CREATE-person name
  // box, so typing a name filtered nothing and scrolling was the only way to reach anyone in a
  // space with hundreds of people -- which read as "assigning to an existing person is broken".
  // Both siblings of this picker already search: the owner's AssignFaceSidePanel (PeopleSearch)
  // and the space-flavoured SpaceFaceEditor (normalizeSearchString over its loaded candidates).
  // The one field now does both, so the name you type either finds the person or creates them.
  it('narrows the candidate list to the typed name', async () => {
    getSpaceAssetFacesMock.mockResolvedValue([face({ id: 'face-1' })]);
    getSpacePeopleMock.mockResolvedValue([
      spacePerson({ id: 'sp-1', name: 'Alejandra' }),
      spacePerson({ id: 'sp-2', name: 'Alexandra' }),
      spacePerson({ id: 'sp-3', name: 'Bob' }),
    ]);

    renderPanel();
    await waitFor(() => expect(getSpaceAssetFacesMock).toHaveBeenCalled());
    await userEvent.click(screen.getByRole('button', { name: 'select_new_face' }));
    expect(await screen.findByRole('button', { name: /Alejandra/ })).toBeInTheDocument();

    await userEvent.type(screen.getByRole('textbox'), 'alej');

    expect(screen.getByRole('button', { name: /Alejandra/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Alexandra/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Bob/ })).not.toBeInTheDocument();
  });

  it('matches candidate names regardless of case and accents', async () => {
    getSpaceAssetFacesMock.mockResolvedValue([face({ id: 'face-1' })]);
    getSpacePeopleMock.mockResolvedValue([
      spacePerson({ id: 'sp-1', name: 'Ángela Groß' }),
      spacePerson({ id: 'sp-2', name: 'Bob' }),
    ]);

    renderPanel();
    await waitFor(() => expect(getSpaceAssetFacesMock).toHaveBeenCalled());
    await userEvent.click(screen.getByRole('button', { name: 'select_new_face' }));
    expect(await screen.findByRole('button', { name: /Ángela/ })).toBeInTheDocument();

    await userEvent.type(screen.getByRole('textbox'), 'angela');

    expect(screen.getByRole('button', { name: /Ángela/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Bob/ })).not.toBeInTheDocument();
  });

  it('restores the full candidate list when the search is cleared', async () => {
    getSpaceAssetFacesMock.mockResolvedValue([face({ id: 'face-1' })]);
    getSpacePeopleMock.mockResolvedValue([
      spacePerson({ id: 'sp-1', name: 'Alejandra' }),
      spacePerson({ id: 'sp-3', name: 'Bob' }),
    ]);

    renderPanel();
    await waitFor(() => expect(getSpaceAssetFacesMock).toHaveBeenCalled());
    await userEvent.click(screen.getByRole('button', { name: 'select_new_face' }));
    expect(await screen.findByRole('button', { name: /Bob/ })).toBeInTheDocument();

    await userEvent.type(screen.getByRole('textbox'), 'alej');
    expect(screen.queryByRole('button', { name: /Bob/ })).not.toBeInTheDocument();

    await userEvent.clear(screen.getByRole('textbox'));

    expect(screen.getByRole('button', { name: /Bob/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Alejandra/ })).toBeInTheDocument();
  });

  it('attaches the person picked out of a filtered list', async () => {
    getSpaceAssetFacesMock.mockResolvedValue([face({ id: 'face-1' })]);
    getSpacePeopleMock.mockResolvedValue([
      spacePerson({ id: 'sp-1', name: 'Alejandra' }),
      spacePerson({ id: 'sp-3', name: 'Bob' }),
    ]);
    attachSpacePersonFaceMock.mockResolvedValue({ acted: true });

    renderPanel();
    await waitFor(() => expect(getSpaceAssetFacesMock).toHaveBeenCalled());
    await userEvent.click(screen.getByRole('button', { name: 'select_new_face' }));
    expect(await screen.findByRole('button', { name: /Alejandra/ })).toBeInTheDocument();

    await userEvent.type(screen.getByRole('textbox'), 'alej');
    await userEvent.click(screen.getByRole('button', { name: /Alejandra/ }));

    await waitFor(() =>
      expect(attachSpacePersonFaceMock).toHaveBeenCalledWith({
        id: 'space-1',
        personId: 'sp-1',
        assetFaceId: 'face-1',
      }),
    );
  });

  // The attach had no in-flight state at all: a slow PUT left the card sitting there unchanged,
  // which is indistinguishable from a tap that never registered -- and that is exactly how it was
  // reported on #992.
  it('shows the picker as busy while the attach is in flight', async () => {
    getSpaceAssetFacesMock.mockResolvedValue([face({ id: 'face-1' })]);
    getSpacePeopleMock.mockResolvedValue([spacePerson({ id: 'sp-1', name: 'Bob' })]);
    let settleAttach: (value: unknown) => void = () => {};
    attachSpacePersonFaceMock.mockReturnValue(new Promise((resolve) => (settleAttach = resolve)));

    renderPanel();
    await waitFor(() => expect(getSpaceAssetFacesMock).toHaveBeenCalled());
    await userEvent.click(screen.getByRole('button', { name: 'select_new_face' }));
    await userEvent.click(await screen.findByRole('button', { name: /Bob/ }));

    expect(await screen.findByTestId('loading-spinner')).toBeInTheDocument();
    // And the card is gone with it, so a second impatient tap cannot fire a second attach.
    expect(screen.queryByRole('button', { name: /Bob/ })).not.toBeInTheDocument();

    settleAttach({ acted: true });

    await waitFor(() => expect(screen.queryByTestId('loading-spinner')).not.toBeInTheDocument());
  });

  it('says so when the typed name matches nobody, rather than showing an empty grid', async () => {
    getSpaceAssetFacesMock.mockResolvedValue([face({ id: 'face-1' })]);
    getSpacePeopleMock.mockResolvedValue([spacePerson({ id: 'sp-1', name: 'Alejandra' })]);

    renderPanel();
    await waitFor(() => expect(getSpaceAssetFacesMock).toHaveBeenCalled());
    await userEvent.click(screen.getByRole('button', { name: 'select_new_face' }));
    expect(await screen.findByRole('button', { name: /Alejandra/ })).toBeInTheDocument();

    await userEvent.type(screen.getByRole('textbox'), 'zzz');

    expect(screen.getByText('no_people_found')).toBeInTheDocument();
  });

  it('creates a new space person from a face and attaches it in one call', async () => {
    getSpaceAssetFacesMock.mockResolvedValue([face({ id: 'face-1' })]);
    getSpacePeopleMock.mockResolvedValue([]);
    createSpacePersonMock.mockResolvedValue(spacePerson({ id: 'sp-new', name: 'Carol' }));
    const onRefresh = vi.fn();

    renderPanel({ onRefresh });
    await waitFor(() => expect(getSpaceAssetFacesMock).toHaveBeenCalled());

    await userEvent.click(screen.getByRole('button', { name: 'select_new_face' }));
    await waitFor(() => expect(getSpacePeopleMock).toHaveBeenCalled());

    await userEvent.type(screen.getByRole('textbox'), 'Carol');
    await userEvent.click(screen.getByRole('button', { name: 'create_person' }));

    await waitFor(() =>
      expect(createSpacePersonMock).toHaveBeenCalledWith({
        id: 'space-1',
        sharedSpacePersonCreateDto: { name: 'Carol', assetFaceId: 'face-1' },
      }),
    );
    expect(onRefresh).toHaveBeenCalled();
    expect(await screen.findByText('Carol')).toBeInTheDocument();
  });

  it('detaches a face from its space person', async () => {
    getSpaceAssetFacesMock.mockResolvedValue([face({ id: 'face-1', spacePersonId: 'sp-1', spacePersonName: 'Bob' })]);
    detachSpacePersonFaceMock.mockResolvedValue(undefined);
    const onRefresh = vi.fn();

    renderPanel({ onRefresh });
    await waitFor(() => expect(screen.getByText('Bob')).toBeInTheDocument());

    await userEvent.click(screen.getByRole('button', { name: 'unassign_face' }));

    await waitFor(() =>
      expect(detachSpacePersonFaceMock).toHaveBeenCalledWith({
        id: 'space-1',
        personId: 'sp-1',
        assetFaceId: 'face-1',
      }),
    );
    expect(onRefresh).toHaveBeenCalled();
    expect(await screen.findByText('face_unassigned')).toBeInTheDocument();
  });

  it('never offers the unassign control on a face with no space person', async () => {
    getSpaceAssetFacesMock.mockResolvedValue([face({ id: 'face-1' })]);

    renderPanel();

    await waitFor(() => expect(screen.getByText('face_unassigned')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'unassign_face' })).toBeNull();
  });

  // Slice 9, Task 1 (spec §6.6): the delete-box control is the client's only use of
  // `isEditorDrawn` -- it gates deleting the box outright (destroying it for every space that
  // holds it), which is a different, more destructive action than "unassign" (detach from this
  // space's person, box survives).
  it('offers the delete control for a face the editor drew, and deletes it on click', async () => {
    getSpaceAssetFacesMock.mockResolvedValue([
      face({ id: 'face-1', spacePersonId: 'sp-1', spacePersonName: 'Bob', isEditorDrawn: true }),
    ]);
    deleteSpaceAssetFaceMock.mockResolvedValue(undefined);
    const onRefresh = vi.fn();

    renderPanel({ onRefresh });
    await waitFor(() => expect(screen.getByText('Bob')).toBeInTheDocument());

    await userEvent.click(screen.getByRole('button', { name: 'delete_face' }));

    await waitFor(() =>
      expect(deleteSpaceAssetFaceMock).toHaveBeenCalledWith({ id: 'space-1', assetFaceId: 'face-1' }),
    );
    expect(onRefresh).toHaveBeenCalled();
    // The box is destroyed outright, unlike unassign -- the whole row disappears.
    expect(screen.queryByText('Bob')).toBeNull();
  });

  it('never offers the delete control on a face the editor did not draw', async () => {
    getSpaceAssetFacesMock.mockResolvedValue([
      face({ id: 'face-1', spacePersonId: 'sp-1', spacePersonName: 'Bob', isEditorDrawn: false }),
    ]);

    renderPanel();

    await waitFor(() => expect(screen.getByText('Bob')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'delete_face' })).toBeNull();
  });
});
