import { sdkMock } from '#lib/gallery/__mocks__/sdk.mock.ts';
import type { LibraryResponseDto } from '@immich/sdk';
import { expect } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page, userEvent } from 'vitest/browser';

// The browser links every static import before any module body runs, so a static import of the
// modal would load the real @immich/sdk before sdk.mock.ts registers its vi.mock. Loading it
// after that registration gives it the mocked module.
const { default: SpaceLinkLibraryModal } = await import('./SpaceLinkLibraryModal.svelte');

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
    vi.resetAllMocks();
  });

  it('lists libraries that are not already linked', async () => {
    sdkMock.getAllLibraries.mockResolvedValue([
      makeLibrary({ id: 'a', name: 'Family Photos' }),
      makeLibrary({ id: 'b', name: 'Drone Footage' }),
      makeLibrary({ id: 'linked', name: 'Old Scans' }),
    ]);

    await render(SpaceLinkLibraryModal, { spaceId: 'space-1', linkedLibraryIds: ['linked'], onClose });

    await expect.element(page.getByRole('button', { name: /Family Photos/ })).toBeInTheDocument();
    await expect.element(page.getByRole('button', { name: /Drone Footage/ })).toBeInTheDocument();
    await expect.element(page.getByText('Old Scans')).not.toBeInTheDocument();
  });

  it('shows the asset count and import path in the row subtitle', async () => {
    sdkMock.getAllLibraries.mockResolvedValue([
      makeLibrary({ id: 'a', name: 'Family Photos', assetCount: 1240, importPaths: ['/mnt/photos'] }),
    ]);

    await render(SpaceLinkLibraryModal, { spaceId: 'space-1', linkedLibraryIds: [], onClose });
    await expect.element(page.getByText('Family Photos')).toBeInTheDocument();

    await expect.element(page.getByText(/\/mnt\/photos/)).toBeInTheDocument();
  });

  it('filters the linkable libraries by search text', async () => {
    sdkMock.getAllLibraries.mockResolvedValue([
      makeLibrary({ id: 'a', name: 'Family Photos' }),
      makeLibrary({ id: 'b', name: 'Drone Footage' }),
    ]);

    await render(SpaceLinkLibraryModal, { spaceId: 'space-1', linkedLibraryIds: [], onClose });
    await expect.element(page.getByText('Family Photos')).toBeInTheDocument();

    await userEvent.fill(page.getByRole('textbox'), 'drone');

    await expect.element(page.getByText('Family Photos')).not.toBeInTheDocument();
    await expect.element(page.getByText('Drone Footage')).toBeInTheDocument();
  });

  it('shows the no-results message when the search matches nothing', async () => {
    sdkMock.getAllLibraries.mockResolvedValue([makeLibrary({ id: 'a', name: 'Family Photos' })]);

    await render(SpaceLinkLibraryModal, { spaceId: 'space-1', linkedLibraryIds: [], onClose });
    await expect.element(page.getByText('Family Photos')).toBeInTheDocument();

    await userEvent.fill(page.getByRole('textbox'), 'nonexistent');

    await expect.element(page.getByText('search_no_result')).toBeInTheDocument();
  });

  it('shows the empty state when every library is already linked', async () => {
    sdkMock.getAllLibraries.mockResolvedValue([makeLibrary({ id: 'a', name: 'Family Photos' })]);

    await render(SpaceLinkLibraryModal, { spaceId: 'space-1', linkedLibraryIds: ['a'], onClose });

    await expect.element(page.getByText('spaces_linked_libraries_no_libraries')).toBeInTheDocument();
    await expect.element(page.getByRole('textbox')).not.toBeInTheDocument();
  });

  it('shows the empty state when libraries fail to load', async () => {
    sdkMock.getAllLibraries.mockRejectedValue(new Error('network'));

    await render(SpaceLinkLibraryModal, { spaceId: 'space-1', linkedLibraryIds: [], onClose });

    await expect.element(page.getByText('spaces_linked_libraries_no_libraries')).toBeInTheDocument();
  });

  it('links every selected library then closes with the linked count', async () => {
    sdkMock.getAllLibraries.mockResolvedValue([
      makeLibrary({ id: 'a', name: 'Alpha' }),
      makeLibrary({ id: 'b', name: 'Beta' }),
      makeLibrary({ id: 'c', name: 'Gamma' }),
    ]);
    sdkMock.linkLibrary.mockResolvedValue(undefined as never);

    await render(SpaceLinkLibraryModal, { spaceId: 'space-1', linkedLibraryIds: [], onClose });

    await userEvent.click(page.getByRole('button', { name: /Alpha/ }));
    await userEvent.click(page.getByRole('button', { name: /Gamma/ }));
    await userEvent.click(page.getByRole('button', { name: 'link' }));

    await vi.waitFor(() =>
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
    await vi.waitFor(() => expect(onClose).toHaveBeenCalledWith(2));
  });

  it('disables the submit button until a library is selected', async () => {
    sdkMock.getAllLibraries.mockResolvedValue([makeLibrary({ id: 'a', name: 'Alpha' })]);

    await render(SpaceLinkLibraryModal, { spaceId: 'space-1', linkedLibraryIds: [], onClose });
    await expect.element(page.getByText('Alpha')).toBeInTheDocument();

    await expect.element(page.getByRole('button', { name: 'link' })).toBeDisabled();

    await userEvent.click(page.getByRole('button', { name: /Alpha/ }));

    await expect.element(page.getByRole('button', { name: 'link' })).not.toBeDisabled();
  });
});
