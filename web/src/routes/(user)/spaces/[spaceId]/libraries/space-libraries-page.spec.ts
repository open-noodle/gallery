import { type SharedSpaceLinkedLibraryDto, type SharedSpaceResponseDto } from '@immich/sdk';
import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import type { Component } from 'svelte';
import { init, register, waitLocale } from 'svelte-i18n';
import { invalidateAll } from '$app/navigation';
import { sdkMock } from '$lib/__mocks__/sdk.mock';
import TestWrapper from '$lib/components/TestWrapper.svelte';
import SpaceLinkLibraryModal from '$lib/modals/SpaceLinkLibraryModal.svelte';
import SpaceLibrariesPage from './+page.svelte';

vi.mock('$app/navigation', () => ({ goto: vi.fn(), invalidateAll: vi.fn() }));

const { modalManagerMock } = vi.hoisted(() => ({
  modalManagerMock: { show: vi.fn(), showDialog: vi.fn() },
}));

vi.mock('@immich/ui', async (importOriginal) => {
  const original = await importOriginal<typeof import('@immich/ui')>();
  return {
    ...original,
    modalManager: modalManagerMock,
    toastManager: { primary: vi.fn(), success: vi.fn(), warning: vi.fn() },
  };
});

function makeLibrary(overrides: Partial<SharedSpaceLinkedLibraryDto> = {}): SharedSpaceLinkedLibraryDto {
  return {
    libraryId: 'lib-1',
    libraryName: 'Family Photos',
    addedById: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function space(linkedLibraries: SharedSpaceLinkedLibraryDto[]): SharedSpaceResponseDto {
  return { id: 'space-1', name: 'Test Space', linkedLibraries } as never;
}

function renderPage(libraries: SharedSpaceLinkedLibraryDto[]) {
  const props = {
    data: {
      space: space(libraries),
      meta: { title: 'Test Space - Libraries' },
    },
  };
  return render(TestWrapper as Component<{ component: typeof SpaceLibrariesPage; componentProps: typeof props }>, {
    component: SpaceLibrariesPage,
    componentProps: props,
  });
}

describe('Space libraries page', () => {
  beforeAll(async () => {
    register('en-US', () => import('$i18n/en.json'));
    await init({ fallbackLocale: 'en-US', initialLocale: 'en-US' });
    await waitLocale('en-US');
  });

  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('renders one row per linked library', () => {
    renderPage([
      makeLibrary({ libraryId: 'a', libraryName: 'Family Photos' }),
      makeLibrary({ libraryId: 'b', libraryName: 'Drone Footage' }),
    ]);
    expect(screen.getAllByTestId('linked-library-row')).toHaveLength(2);
    expect(screen.getByText('Family Photos')).toBeInTheDocument();
    expect(screen.getByText('Drone Footage')).toBeInTheDocument();
  });

  it('always shows the "Link library" button (admin-only route)', () => {
    renderPage([makeLibrary()]);
    expect(screen.getByTestId('link-library-button')).toBeInTheDocument();
  });

  it('shows the empty state with a CTA when no libraries are linked', () => {
    renderPage([]);
    expect(screen.getByTestId('empty-state-message')).toBeInTheDocument();
    expect(screen.getByTestId('empty-link-library-button')).toBeInTheDocument();
  });

  it('clicking "Link library" opens the SpaceLinkLibraryModal with the linked library ids', async () => {
    modalManagerMock.show.mockResolvedValue(undefined);
    renderPage([makeLibrary({ libraryId: 'lib-1' })]);

    await fireEvent.click(screen.getByTestId('link-library-button'));

    await waitFor(() =>
      expect(modalManagerMock.show).toHaveBeenCalledWith(SpaceLinkLibraryModal, {
        spaceId: 'space-1',
        linkedLibraryIds: ['lib-1'],
      }),
    );
  });

  it('invalidates layout data when the modal reports linked libraries', async () => {
    modalManagerMock.show.mockResolvedValue(2);
    renderPage([]);

    await fireEvent.click(screen.getByTestId('empty-link-library-button'));

    await waitFor(() => expect(invalidateAll).toHaveBeenCalled());
  });

  it('does not invalidate when the modal links nothing', async () => {
    modalManagerMock.show.mockResolvedValue(0);
    renderPage([]);

    await fireEvent.click(screen.getByTestId('empty-link-library-button'));

    await waitFor(() => expect(modalManagerMock.show).toHaveBeenCalled());
    expect(invalidateAll).not.toHaveBeenCalled();
  });

  it('unlink: after confirm resolves true, calls unlinkLibrary and invalidates', async () => {
    modalManagerMock.showDialog.mockResolvedValue(true);
    sdkMock.unlinkLibrary.mockResolvedValue(undefined as never);
    renderPage([makeLibrary({ libraryId: 'lib-1', libraryName: 'Family Photos' })]);

    await fireEvent.click(screen.getByTestId('unlink-library-button'));

    await waitFor(() => expect(sdkMock.unlinkLibrary).toHaveBeenCalledWith({ id: 'space-1', libraryId: 'lib-1' }));
    await waitFor(() => expect(invalidateAll).toHaveBeenCalled());
  });

  it('unlink: does nothing when the confirm dialog is dismissed', async () => {
    modalManagerMock.showDialog.mockResolvedValue(false);
    renderPage([makeLibrary({ libraryId: 'lib-1' })]);

    await fireEvent.click(screen.getByTestId('unlink-library-button'));

    await waitFor(() => expect(modalManagerMock.showDialog).toHaveBeenCalled());
    expect(sdkMock.unlinkLibrary).not.toHaveBeenCalled();
  });
});
