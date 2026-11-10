import { AssetTypeEnum, type AssetFaceResponseDto } from '@immich/sdk';
import '@testing-library/jest-dom';
import { screen, waitFor } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { eventManager } from '$lib/managers/event-manager.svelte';
import { renderWithTooltips } from '$tests/helpers';
import PersonSidePanel from './PersonSidePanel.svelte';

const { getFacesMock, deleteFaceMock, showDialogMock, setAssetIdMock, zoomImageToBase64Mock } = vi.hoisted(() => ({
  getFacesMock: vi.fn(),
  deleteFaceMock: vi.fn(),
  showDialogMock: vi.fn(),
  setAssetIdMock: vi.fn(),
  zoomImageToBase64Mock: vi.fn(),
}));

vi.mock('@immich/sdk', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    getFaces: (...args: unknown[]) => getFacesMock(...args),
    deleteFace: (...args: unknown[]) => deleteFaceMock(...args),
  };
});

vi.mock('@immich/ui', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    modalManager: { ...(actual.modalManager as object), showDialog: showDialogMock },
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
    setAssetId: setAssetIdMock,
  },
}));

const face = (overrides: Partial<AssetFaceResponseDto> = {}): AssetFaceResponseDto =>
  ({
    id: 'face-1',
    boundingBoxX1: 10,
    boundingBoxY1: 10,
    boundingBoxX2: 50,
    boundingBoxY2: 50,
    imageWidth: 1000,
    imageHeight: 1000,
    person: null,
    ...overrides,
  }) as AssetFaceResponseDto;

const renderPanel = () =>
  renderWithTooltips(PersonSidePanel, {
    assetId: 'asset-1',
    assetType: AssetTypeEnum.Image,
    onClose: vi.fn(),
    onRefresh: vi.fn(),
  });

describe('PersonSidePanel', () => {
  beforeEach(() => {
    getFacesMock.mockReset();
    deleteFaceMock.mockReset();
    showDialogMock.mockReset();
    setAssetIdMock.mockReset();
    zoomImageToBase64Mock.mockReset();
    zoomImageToBase64Mock.mockResolvedValue(null);
    setAssetIdMock.mockResolvedValue(undefined);
    deleteFaceMock.mockResolvedValue(undefined);
  });

  it('offers the delete control on an unassigned face', async () => {
    getFacesMock.mockResolvedValue([face({ id: 'face-1', person: null })]);

    renderPanel();

    expect(await screen.findByRole('button', { name: 'delete_face' })).toBeInTheDocument();
  });

  it('deletes an unassigned face after confirmation, without emitting a person event', async () => {
    getFacesMock.mockResolvedValue([face({ id: 'face-1', person: null })]);
    showDialogMock.mockResolvedValue(true);
    const emitSpy = vi.spyOn(eventManager, 'emit');

    renderPanel();

    await userEvent.click(await screen.findByRole('button', { name: 'delete_face' }));

    await waitFor(() =>
      expect(deleteFaceMock).toHaveBeenCalledWith({ id: 'face-1', assetFaceDeleteDto: { force: false } }),
    );
    expect(showDialogMock).toHaveBeenCalledWith(expect.objectContaining({ prompt: 'confirm_delete_unassigned_face' }));
    expect(emitSpy).not.toHaveBeenCalledWith('PersonAssetDelete', expect.anything());
    expect(setAssetIdMock).toHaveBeenCalledWith('asset-1');
    await waitFor(() => expect(screen.queryByRole('button', { name: 'delete_face' })).not.toBeInTheDocument());
    emitSpy.mockRestore();
  });

  it('deletes an assigned face after confirmation and emits the person event', async () => {
    const person = { id: 'person-1', name: 'Bob', isHidden: false, updatedAt: '2026-01-01T00:00:00.000Z' };
    getFacesMock.mockResolvedValue([face({ id: 'face-1', person: person as AssetFaceResponseDto['person'] })]);
    showDialogMock.mockResolvedValue(true);
    const emitSpy = vi.spyOn(eventManager, 'emit');

    renderPanel();

    await userEvent.click(await screen.findByRole('button', { name: 'delete_face' }));

    await waitFor(() =>
      expect(deleteFaceMock).toHaveBeenCalledWith({ id: 'face-1', assetFaceDeleteDto: { force: false } }),
    );
    expect(emitSpy).toHaveBeenCalledWith('PersonAssetDelete', { id: 'person-1', assetId: 'asset-1' });
    emitSpy.mockRestore();
  });

  it('does not delete when the confirmation is cancelled', async () => {
    getFacesMock.mockResolvedValue([face({ id: 'face-1', person: null })]);
    showDialogMock.mockResolvedValue(false);

    renderPanel();

    await userEvent.click(await screen.findByRole('button', { name: 'delete_face' }));

    await waitFor(() => expect(showDialogMock).toHaveBeenCalled());
    expect(deleteFaceMock).not.toHaveBeenCalled();
  });
});
