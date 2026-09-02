import type { SharedSpacePersonResponseDto } from '@immich/sdk';
import '@testing-library/jest-dom';
import { screen, waitFor } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { renderWithTooltips } from '$tests/helpers';
import SpaceFaceEditor from './SpaceFaceEditor.svelte';

const { getSpacePeopleMock, createSpaceAssetFaceMock, modalShowMock } = vi.hoisted(() => ({
  getSpacePeopleMock: vi.fn(),
  createSpaceAssetFaceMock: vi.fn(),
  modalShowMock: vi.fn(),
}));

const refreshAssetPeopleMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

vi.mock('$lib/utils/refresh-asset-people', () => ({ refreshAssetPeople: refreshAssetPeopleMock }));

vi.mock('@immich/sdk', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    getSpacePeople: (...args: unknown[]) => getSpacePeopleMock(...args),
    createSpaceAssetFace: (...args: unknown[]) => createSpaceAssetFaceMock(...args),
  };
});

vi.mock('@immich/ui', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    modalManager: { show: modalShowMock, showDialog: vi.fn() },
    toastManager: { danger: vi.fn(), primary: vi.fn(), success: vi.fn(), warning: vi.fn() },
  };
});

// Fabric.js draws to a real 2D canvas context, which happy-dom does not implement. The drag
// GEOMETRY itself is covered directly and exhaustively by face-box-drag.spec.ts (the module this
// component and the owner FaceEditor both call into) -- this stub only needs to let the component
// mount and let getBoundingRect() return a stable box so the "which person did you pick" wiring
// under test here can run without a real canvas.
vi.mock('fabric', () => {
  class FakeRect {
    left = 200;
    top = 200;
    width = 112;
    height = 112;
    padding = 0;
    constructor(props: Record<string, unknown> = {}) {
      Object.assign(this, props);
    }
    set(props: Record<string, unknown>) {
      Object.assign(this, props);
    }
    setCoords() {}
    getBoundingRect() {
      return { left: this.left, top: this.top, width: this.width, height: this.height };
    }
    on() {}
    off() {}
  }
  class FakeCanvas {
    width = 0;
    height = 0;
    constructor(_el?: unknown) {}
    add() {}
    setActiveObject() {}
    setDimensions(dims: { width: number; height: number }) {
      this.width = dims.width;
      this.height = dims.height;
    }
    on() {}
    off() {}
  }
  return {
    Canvas: FakeCanvas,
    Rect: FakeRect,
    InteractiveFabricObject: { ownDefaults: {} },
  };
});

const image = (naturalWidth: number, naturalHeight: number) =>
  ({ naturalWidth, naturalHeight }) as unknown as HTMLImageElement;

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

const renderEditor = (props: { onClose?: () => void } = {}) =>
  renderWithTooltips(SpaceFaceEditor, {
    htmlElement: image(2000, 1000),
    containerWidth: 1000,
    containerHeight: 1000,
    assetId: 'asset-1',
    spaceId: 'space-1',
    onClose: props.onClose ?? vi.fn(),
  });

describe('SpaceFaceEditor', () => {
  beforeEach(() => {
    getSpacePeopleMock.mockReset();
    createSpaceAssetFaceMock.mockReset();
    modalShowMock.mockReset();
    refreshAssetPeopleMock.mockClear();
    getSpacePeopleMock.mockResolvedValue([]);
  });

  it('loads the space candidate list from getSpacePeople, not getAllPeople', async () => {
    getSpacePeopleMock.mockResolvedValue([spacePerson()]);

    renderEditor();

    await waitFor(() => expect(getSpacePeopleMock).toHaveBeenCalledWith({ id: 'space-1', withHidden: false }));
    expect(await screen.findByText('Bob')).toBeInTheDocument();
  });

  it('draws a box and attaches it to the selected space person', async () => {
    getSpacePeopleMock.mockResolvedValue([spacePerson({ id: 'sp-1', name: 'Bob' })]);
    createSpaceAssetFaceMock.mockResolvedValue({ id: 'new-face' });
    const onClose = vi.fn();

    renderEditor({ onClose });
    await screen.findByText('Bob');

    await userEvent.click(screen.getByRole('button', { name: 'Bob' }));

    await waitFor(() => expect(createSpaceAssetFaceMock).toHaveBeenCalled());
    const call = createSpaceAssetFaceMock.mock.calls[0][0];
    expect(call.id).toBe('space-1');
    expect(call.assetId).toBe('asset-1');
    expect(call.spaceAssetFaceCreateDto).toMatchObject({ spacePersonId: 'sp-1' });
    expect(onClose).toHaveBeenCalled();
  });

  it('filters the candidate list by search term', async () => {
    getSpacePeopleMock.mockResolvedValue([
      spacePerson({ id: 'sp-1', name: 'Bob' }),
      spacePerson({ id: 'sp-2', name: 'Carol' }),
    ]);

    renderEditor();
    await screen.findByText('Bob');
    expect(screen.getByText('Carol')).toBeInTheDocument();

    await userEvent.type(screen.getByPlaceholderText('search_people'), 'Car');

    expect(screen.queryByText('Bob')).toBeNull();
    expect(screen.getByText('Carol')).toBeInTheDocument();
  });

  it('opens the create-new-person modal instead of drawing an unassigned box', async () => {
    modalShowMock.mockResolvedValue(true);
    const onClose = vi.fn();

    renderEditor({ onClose });
    await waitFor(() => expect(getSpacePeopleMock).toHaveBeenCalled());

    await userEvent.click(screen.getByRole('button', { name: 'create_person' }));

    await waitFor(() => expect(modalShowMock).toHaveBeenCalled());
    const [, modalProps] = modalShowMock.mock.calls[0] as [unknown, Record<string, unknown>];
    expect(modalProps.spaceId).toBe('space-1');
    expect(modalProps.assetId).toBe('asset-1');
    // Never calls createSpaceAssetFace directly with no spacePersonId -- §6.5 requires one, so
    // creating a new person is delegated entirely to the modal (create person, then draw attached).
    expect(createSpaceAssetFaceMock).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  /**
   * The reported bug: tagging from the ON-PHOTO editor left both the People row and the face boxes
   * over the photo showing their pre-tag contents until a full page reload. This component simply
   * called `onClose()` and told nothing to re-read.
   *
   * Asserting the refresh happens BEFORE `onClose` matters -- closing first unmounts the editor,
   * and a refresh fired after that races the teardown.
   */
  it('refreshes the asset people after attaching to an existing space person', async () => {
    getSpacePeopleMock.mockResolvedValue([spacePerson({ id: 'sp-1', name: 'Bob' })]);
    createSpaceAssetFaceMock.mockResolvedValue({ id: 'new-face' });
    const onClose = vi.fn();

    renderEditor({ onClose });
    await screen.findByText('Bob');
    await userEvent.click(screen.getByRole('button', { name: 'Bob' }));

    await waitFor(() => expect(refreshAssetPeopleMock).toHaveBeenCalledWith('asset-1', 'space-1'));
    expect(refreshAssetPeopleMock.mock.invocationCallOrder[0]).toBeLessThan(onClose.mock.invocationCallOrder[0]);
  });

  it('refreshes the asset people after creating a brand new person', async () => {
    modalShowMock.mockResolvedValue(true);
    const onClose = vi.fn();

    renderEditor({ onClose });
    await waitFor(() => expect(getSpacePeopleMock).toHaveBeenCalled());
    await userEvent.click(screen.getByRole('button', { name: 'create_person' }));

    await waitFor(() => expect(refreshAssetPeopleMock).toHaveBeenCalledWith('asset-1', 'space-1'));
    expect(refreshAssetPeopleMock.mock.invocationCallOrder[0]).toBeLessThan(onClose.mock.invocationCallOrder[0]);
  });

  it('does not refresh when the create-person modal is dismissed', async () => {
    modalShowMock.mockResolvedValue(false);

    renderEditor();
    await waitFor(() => expect(getSpacePeopleMock).toHaveBeenCalled());
    await userEvent.click(screen.getByRole('button', { name: 'create_person' }));

    await waitFor(() => expect(modalShowMock).toHaveBeenCalled());
    expect(refreshAssetPeopleMock).not.toHaveBeenCalled();
  });

  it('cancels without creating anything', async () => {
    const onClose = vi.fn();

    renderEditor({ onClose });
    await waitFor(() => expect(getSpacePeopleMock).toHaveBeenCalled());

    await userEvent.click(screen.getByRole('button', { name: 'cancel' }));

    expect(onClose).toHaveBeenCalled();
    expect(createSpaceAssetFaceMock).not.toHaveBeenCalled();
    expect(modalShowMock).not.toHaveBeenCalled();
  });
});
