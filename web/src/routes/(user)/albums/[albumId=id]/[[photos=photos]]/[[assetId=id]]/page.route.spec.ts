import { sdkMock } from '$lib/__mocks__/sdk.mock';
import { authManager } from '$lib/managers/auth-manager.svelte';
import { albumFactory } from '@test-data/factories/album-factory';
import { preferencesFactory } from '@test-data/factories/preferences-factory';
import { userAdminFactory } from '@test-data/factories/user-factory';
import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AlbumPage from './+page.svelte';

vi.mock('$lib/components/timeline/Timeline.svelte', async () => {
  const { default: MockTimeline } = await import('./mock-timeline.test-wrapper.svelte');
  return { default: MockTimeline };
});

vi.mock('$lib/managers/command-context-manager.svelte', () => ({
  registerAlbumContext: () => {},
}));

function renderPage(album = albumFactory.build({ assetCount: 2 })) {
  authManager.setUser(userAdminFactory.build({ id: album.ownerId }));
  authManager.setPreferences(preferencesFactory.build());

  sdkMock.getFilterSuggestions.mockImplementation(async (request: { albumId?: string } = {}) => {
    if (request.albumId) {
      return {
        countries: [],
        cameraMakes: [],
        tags: [
          { id: 'tag-view', value: 'Album Tag' },
          { id: 'tag-no-match', value: 'No Match' },
        ],
        people: [{ id: 'person-view', name: 'Album Person' }],
        ratings: [5],
        mediaTypes: ['IMAGE'],
        hasUnnamedPeople: false,
      };
    }

    return {
      countries: [],
      cameraMakes: [],
      tags: [{ id: 'tag-picker', value: 'Picker Tag' }],
      people: [{ id: 'person-picker', name: 'Picker Person' }],
      ratings: [5],
      mediaTypes: ['IMAGE'],
      hasUnnamedPeople: false,
    };
  });

  sdkMock.getSearchSuggestions.mockResolvedValue([]);

  return render(AlbumPage, {
    props: {
      data: {
        album,
        asset: undefined,
        error: undefined,
        meta: { title: album.albumName },
      },
    },
  });
}

describe('album detail filter panel', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('renders the filter panel in view mode and select-assets mode', async () => {
    renderPage();

    await waitFor(() => expect(screen.getByTestId('discovery-panel')).toBeInTheDocument());
    await fireEvent.click(screen.getByLabelText('add_photos'));
    await waitFor(() => expect(screen.getByTestId('discovery-panel')).toBeInTheDocument());
  });

  it('hides the filter panel when the active dataset is empty and no filters are active', async () => {
    renderPage(albumFactory.build({ assetCount: 0 }));

    await waitFor(() => expect(screen.queryByTestId('discovery-panel')).not.toBeInTheDocument());
  });

  it('keeps separate filter state for view and select-assets, and reuses view filters for select-thumbnail', async () => {
    renderPage();
    const user = userEvent.setup();

    await waitFor(() => expect(screen.getByTestId('people-item-person-view')).toBeInTheDocument());
    await user.click(screen.getByTestId('people-item-person-view'));
    expect(screen.getByText(/Album Person/)).toBeInTheDocument();

    await fireEvent.click(screen.getByLabelText('add_photos'));
    await waitFor(() => expect(screen.getByTestId('people-item-person-picker')).toBeInTheDocument());
    expect(screen.queryByText(/Album Person/)).not.toBeInTheDocument();

    await user.click(screen.getByTestId('people-item-person-picker'));
    expect(screen.getByText(/Picker Person/)).toBeInTheDocument();

    await fireEvent.click(screen.getByLabelText('go_back'));
    expect(screen.getByText(/Album Person/)).toBeInTheDocument();

    await fireEvent.click(screen.getByLabelText('add_photos'));
    expect(screen.getByText(/Picker Person/)).toBeInTheDocument();

    await fireEvent.click(screen.getByLabelText('go_back'));
    await user.click(screen.getByLabelText('album_options'));
    await user.click(screen.getByText('select_album_cover'));
    expect(screen.getByTestId('discovery-panel')).toBeInTheDocument();
    expect(screen.getByText(/Album Person/)).toBeInTheDocument();
  });

  it('keeps timelineAlbumId in picker options after filters change and shows filtered empty state', async () => {
    renderPage();
    const user = userEvent.setup();

    await fireEvent.click(screen.getByLabelText('add_photos'));
    await waitFor(() => expect(screen.getByTestId('tags-item-tag-no-match')).toBeInTheDocument());
    await user.click(screen.getByTestId('tags-item-tag-no-match'));

    expect(screen.getByTestId('timeline-options').textContent).toContain('"timelineAlbumId"');
    expect(screen.getByText('No photos available to add match your filters')).toBeInTheDocument();
    await user.click(screen.getByText('Clear all filters'));
    await waitFor(() =>
      expect(screen.queryByText('No photos available to add match your filters')).not.toBeInTheDocument(),
    );
  });

  it('resets both filter states and label caches when navigating to another album', async () => {
    const firstAlbum = albumFactory.build({ id: 'album-1', assetCount: 2 });
    const secondAlbum = albumFactory.build({ id: 'album-2', assetCount: 2 });
    const view = renderPage(firstAlbum);
    const user = userEvent.setup();

    await waitFor(() => expect(screen.getByTestId('people-item-person-view')).toBeInTheDocument());
    await user.click(screen.getByTestId('people-item-person-view'));
    expect(screen.getByText(/Album Person/)).toBeInTheDocument();

    await view.rerender({
      data: {
        album: secondAlbum,
        asset: undefined,
        error: undefined,
        meta: { title: secondAlbum.albumName },
      },
    });

    await waitFor(() => expect(screen.queryByText(/Album Person/)).not.toBeInTheDocument());
    expect(screen.queryByTestId('active-chip')).not.toBeInTheDocument();
  });
});
