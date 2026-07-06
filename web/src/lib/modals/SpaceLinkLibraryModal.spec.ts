import { type LibraryResponseDto } from '@immich/sdk';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { getAnimateMock } from '$lib/__mocks__/animate.mock';
import { getIntersectionObserverMock } from '$lib/__mocks__/intersection-observer.mock';
import '$lib/__mocks__/sdk.mock';
import { sdkMock } from '$lib/__mocks__/sdk.mock';
import { getVisualViewportMock } from '$lib/__mocks__/visual-viewport.mock';
import SpaceLinkLibraryModal from './SpaceLinkLibraryModal.svelte';

const makeLibrary = (overrides: Partial<LibraryResponseDto> = {}): LibraryResponseDto => ({
  id: 'lib-1',
  name: 'Library',
  ownerId: 'owner-1',
  assetCount: 0,
  importPaths: [],
  exclusionPatterns: [],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  refreshedAt: null,
  ...overrides,
});

describe('SpaceLinkLibraryModal', () => {
  const onClose = vi.fn();

  beforeEach(() => {
    vi.stubGlobal('IntersectionObserver', getIntersectionObserverMock());
    vi.stubGlobal('visualViewport', getVisualViewportMock());
    vi.resetAllMocks();
    Element.prototype.animate = getAnimateMock();
  });

  afterAll(async () => {
    await waitFor(() => {
      expect(document.body.style.pointerEvents).not.toBe('none');
    });
  });

  it('lists libraries that are not already linked', async () => {
    sdkMock.getAllLibraries.mockResolvedValue([
      makeLibrary({ id: 'a', name: 'Family Photos' }),
      makeLibrary({ id: 'b', name: 'Drone Footage' }),
      makeLibrary({ id: 'linked', name: 'Old Scans' }),
    ]);

    render(SpaceLinkLibraryModal, { spaceId: 'space-1', linkedLibraryIds: ['linked'], onClose });

    expect(await screen.findByRole('button', { name: /Family Photos/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Drone Footage/ })).toBeInTheDocument();
    expect(screen.queryByText('Old Scans')).not.toBeInTheDocument();
  });

  it('shows the asset count and import path in the row subtitle', async () => {
    sdkMock.getAllLibraries.mockResolvedValue([
      makeLibrary({ id: 'a', name: 'Family Photos', assetCount: 1240, importPaths: ['/mnt/photos'] }),
    ]);

    render(SpaceLinkLibraryModal, { spaceId: 'space-1', linkedLibraryIds: [], onClose });
    await screen.findByText('Family Photos');

    expect(screen.getByText(/\/mnt\/photos/)).toBeInTheDocument();
  });

  it('filters the linkable libraries by search text', async () => {
    sdkMock.getAllLibraries.mockResolvedValue([
      makeLibrary({ id: 'a', name: 'Family Photos' }),
      makeLibrary({ id: 'b', name: 'Drone Footage' }),
    ]);

    render(SpaceLinkLibraryModal, { spaceId: 'space-1', linkedLibraryIds: [], onClose });
    await screen.findByText('Family Photos');

    await fireEvent.input(screen.getByRole('textbox'), { target: { value: 'drone' } });

    expect(screen.queryByText('Family Photos')).not.toBeInTheDocument();
    expect(screen.getByText('Drone Footage')).toBeInTheDocument();
  });

  it('shows the no-results message when the search matches nothing', async () => {
    sdkMock.getAllLibraries.mockResolvedValue([makeLibrary({ id: 'a', name: 'Family Photos' })]);

    render(SpaceLinkLibraryModal, { spaceId: 'space-1', linkedLibraryIds: [], onClose });
    await screen.findByText('Family Photos');

    await fireEvent.input(screen.getByRole('textbox'), { target: { value: 'nonexistent' } });

    expect(screen.getByText('search_no_result')).toBeInTheDocument();
  });

  it('shows the empty state when every library is already linked', async () => {
    sdkMock.getAllLibraries.mockResolvedValue([makeLibrary({ id: 'a', name: 'Family Photos' })]);

    render(SpaceLinkLibraryModal, { spaceId: 'space-1', linkedLibraryIds: ['a'], onClose });

    expect(await screen.findByText('spaces_linked_libraries_no_libraries')).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('shows the empty state when libraries fail to load', async () => {
    sdkMock.getAllLibraries.mockRejectedValue(new Error('network'));

    render(SpaceLinkLibraryModal, { spaceId: 'space-1', linkedLibraryIds: [], onClose });

    expect(await screen.findByText('spaces_linked_libraries_no_libraries')).toBeInTheDocument();
  });

  it('links every selected library then closes with the linked count', async () => {
    sdkMock.getAllLibraries.mockResolvedValue([
      makeLibrary({ id: 'a', name: 'Alpha' }),
      makeLibrary({ id: 'b', name: 'Beta' }),
      makeLibrary({ id: 'c', name: 'Gamma' }),
    ]);
    sdkMock.linkLibrary.mockResolvedValue(undefined as never);

    render(SpaceLinkLibraryModal, { spaceId: 'space-1', linkedLibraryIds: [], onClose });

    await userEvent.click(await screen.findByRole('button', { name: /Alpha/ }));
    await userEvent.click(screen.getByRole('button', { name: /Gamma/ }));
    await userEvent.click(screen.getByRole('button', { name: 'link' }));

    await waitFor(() =>
      expect(sdkMock.linkLibrary).toHaveBeenCalledWith({
        id: 'space-1',
        sharedSpaceLibraryLinkDto: { libraryId: 'a' },
      }),
    );
    expect(sdkMock.linkLibrary).toHaveBeenCalledWith({
      id: 'space-1',
      sharedSpaceLibraryLinkDto: { libraryId: 'c' },
    });
    expect(sdkMock.linkLibrary).not.toHaveBeenCalledWith({
      id: 'space-1',
      sharedSpaceLibraryLinkDto: { libraryId: 'b' },
    });
    expect(sdkMock.linkLibrary).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(onClose).toHaveBeenCalledWith(2));
  });

  it('disables the submit button until a library is selected', async () => {
    sdkMock.getAllLibraries.mockResolvedValue([makeLibrary({ id: 'a', name: 'Alpha' })]);

    render(SpaceLinkLibraryModal, { spaceId: 'space-1', linkedLibraryIds: [], onClose });
    await screen.findByText('Alpha');

    expect(screen.getByRole('button', { name: 'link' })).toBeDisabled();

    await userEvent.click(screen.getByRole('button', { name: /Alpha/ }));

    expect(screen.getByRole('button', { name: 'link' })).not.toBeDisabled();
  });
});
