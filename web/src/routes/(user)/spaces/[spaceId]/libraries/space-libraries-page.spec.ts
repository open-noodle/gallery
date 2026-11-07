import TestWrapper from '#lib/components/TestWrapper.svelte';
import { sdkMock } from '#lib/gallery/__mocks__/sdk.mock.ts';
import SpaceLinkLibraryModal from '#lib/modals/SpaceLinkLibraryModal.svelte';
import { type SharedSpaceLinkedLibraryDto, type SharedSpaceResponseDto } from '@immich/sdk';
import type { Component } from 'svelte';
import { init, register, waitLocale } from 'svelte-i18n';
import { expect } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page, userEvent } from 'vitest/browser';
import { invalidateAll } from '$app/navigation';
import SpaceLibrariesPage from './+page.svelte';

vi.mock('$app/navigation', async () => ({
  ...(await import('#test/unit/mocks/app-navigation.ts')),
  goto: vi.fn(),
  invalidateAll: vi.fn(),
}));

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
    register('en-US', () => import('#i18n/en.json'));
    await init({ fallbackLocale: 'en-US', initialLocale: 'en-US' });
    await waitLocale('en-US');
  });

  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('renders one row per linked library', async () => {
    await renderPage([
      makeLibrary({ libraryId: 'a', libraryName: 'Family Photos' }),
      makeLibrary({ libraryId: 'b', libraryName: 'Drone Footage' }),
    ]);
    expect(page.getByTestId('linked-library-row').elements()).toHaveLength(2);
    await expect.element(page.getByText('Family Photos')).toBeInTheDocument();
    await expect.element(page.getByText('Drone Footage')).toBeInTheDocument();
  });

  it('always shows the "Link library" button (admin-only route)', async () => {
    await renderPage([makeLibrary()]);
    await expect.element(page.getByTestId('link-library-button')).toBeInTheDocument();
  });

  it('shows the empty state with a CTA when no libraries are linked', async () => {
    await renderPage([]);
    await expect.element(page.getByTestId('empty-state-message')).toBeInTheDocument();
    await expect.element(page.getByTestId('empty-link-library-button')).toBeInTheDocument();
  });

  it('clicking "Link library" opens the SpaceLinkLibraryModal with the linked library ids', async () => {
    modalManagerMock.show.mockResolvedValue(undefined);
    await renderPage([makeLibrary({ libraryId: 'lib-1' })]);

    await userEvent.click(page.getByTestId('link-library-button'));

    await vi.waitFor(() =>
      expect(modalManagerMock.show).toHaveBeenCalledWith(SpaceLinkLibraryModal, {
        spaceId: 'space-1',
        linkedLibraryIds: ['lib-1'],
      }),
    );
  });

  it('invalidates layout data when the modal reports linked libraries', async () => {
    modalManagerMock.show.mockResolvedValue(2);
    await renderPage([]);

    await userEvent.click(page.getByTestId('empty-link-library-button'));

    await vi.waitFor(() => expect(invalidateAll).toHaveBeenCalled());
  });

  it('does not invalidate when the modal links nothing', async () => {
    modalManagerMock.show.mockResolvedValue(0);
    await renderPage([]);

    await userEvent.click(page.getByTestId('empty-link-library-button'));

    await vi.waitFor(() => expect(modalManagerMock.show).toHaveBeenCalled());
    expect(invalidateAll).not.toHaveBeenCalled();
  });

  it('unlink: after confirm resolves true, calls unlinkLibrary and invalidates', async () => {
    modalManagerMock.showDialog.mockResolvedValue(true);
    sdkMock.unlinkLibrary.mockResolvedValue(undefined as never);
    await renderPage([makeLibrary({ libraryId: 'lib-1', libraryName: 'Family Photos' })]);

    await userEvent.click(page.getByTestId('unlink-library-button'));

    await vi.waitFor(() => expect(sdkMock.unlinkLibrary).toHaveBeenCalledWith({ id: 'space-1', libraryId: 'lib-1' }));
    await vi.waitFor(() => expect(invalidateAll).toHaveBeenCalled());
  });

  it('unlink: does nothing when the confirm dialog is dismissed', async () => {
    modalManagerMock.showDialog.mockResolvedValue(false);
    await renderPage([makeLibrary({ libraryId: 'lib-1' })]);

    await userEvent.click(page.getByTestId('unlink-library-button'));

    await vi.waitFor(() => expect(modalManagerMock.showDialog).toHaveBeenCalled());
    expect(sdkMock.unlinkLibrary).not.toHaveBeenCalled();
  });
});
