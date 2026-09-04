import { modalManager } from '@immich/ui';
import '@testing-library/jest-dom';
import { screen, waitFor } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { init, register, waitLocale } from 'svelte-i18n';
// The sdk mock MUST be imported before AlbumSharedSpaceLinks.svelte so `vi.mock('@immich/sdk', ...)`
// registers before the component's own `@immich/sdk` import resolves (see SpaceLinkAlbumModal.spec.ts).
import '$lib/__mocks__/sdk.mock';
import { sdkMock } from '$lib/__mocks__/sdk.mock';
import AlbumSharedSpaceLinks from '$lib/components/album-page/AlbumSharedSpaceLinks.svelte';
import { renderWithTooltips } from '$tests/helpers';
import { albumFactory } from '@test-data/factories/album-factory';

vi.mock('@immich/ui', async (importOriginal) => {
  const original = await importOriginal<typeof import('@immich/ui')>();
  return {
    ...original,
    modalManager: { show: vi.fn(), showDialog: vi.fn() },
  };
});

describe('AlbumSharedSpaceLinks', () => {
  beforeAll(async () => {
    await init({ fallbackLocale: 'en-US' });
    register('en-US', () => import('$i18n/en.json'));
    await waitLocale('en-US');
  });

  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(modalManager.showDialog).mockResolvedValue(true);
  });

  it('renders one row per space link with the space name', () => {
    renderWithTooltips(AlbumSharedSpaceLinks, {
      album: albumFactory.build({
        id: 'album-1',
        sharedSpaceLinks: [
          { spaceId: 'space-1', spaceName: 'Trip', linkedById: 'e1', showInTimeline: true },
          { spaceId: 'space-2', spaceName: 'Zoo', linkedById: 'e2', showInTimeline: false },
        ],
      }),
    });

    expect(screen.getByText('Trip')).toBeInTheDocument();
    expect(screen.getByText('Zoo')).toBeInTheDocument();
    expect(screen.getAllByTestId('album-space-link-unlink')).toHaveLength(2);
  });

  // link.showInTimeline is the shared, editor-controlled flag (the space's own Photos tab), so the
  // indicator must be the space-photos badge — never space_albums_hidden_from_timeline, which is
  // now reserved for the caller's own per-member "my timeline" preference (#1041 §2).
  it('shows the "hidden from the space\'s photos" indicator only for links with showInTimeline=false', () => {
    renderWithTooltips(AlbumSharedSpaceLinks, {
      album: albumFactory.build({
        id: 'album-1',
        sharedSpaceLinks: [
          { spaceId: 'space-1', spaceName: 'Trip', linkedById: 'e1', showInTimeline: true },
          { spaceId: 'space-2', spaceName: 'Zoo', linkedById: 'e2', showInTimeline: false },
        ],
      }),
    });

    expect(screen.getAllByText("Hidden from the space's photos", { exact: false })).toHaveLength(1);
  });

  it('calls unlinkAlbum with the space id + album id after confirming', async () => {
    renderWithTooltips(AlbumSharedSpaceLinks, {
      album: albumFactory.build({
        id: 'album-1',
        sharedSpaceLinks: [{ spaceId: 'space-1', spaceName: 'Trip', linkedById: 'e1', showInTimeline: true }],
      }),
    });

    await userEvent.click(screen.getByTestId('album-space-link-unlink'));

    expect(modalManager.showDialog).toHaveBeenCalled();
    await waitFor(() => {
      expect(sdkMock.unlinkAlbum).toHaveBeenCalledWith({ id: 'space-1', albumId: 'album-1' });
    });
    expect(screen.queryByText('Trip')).not.toBeInTheDocument();
  });

  it('does NOT call unlinkAlbum when the confirmation is declined', async () => {
    vi.mocked(modalManager.showDialog).mockResolvedValue(false);
    renderWithTooltips(AlbumSharedSpaceLinks, {
      album: albumFactory.build({
        id: 'album-1',
        sharedSpaceLinks: [{ spaceId: 'space-1', spaceName: 'Trip', linkedById: 'e1', showInTimeline: true }],
      }),
    });

    await userEvent.click(screen.getByTestId('album-space-link-unlink'));

    expect(sdkMock.unlinkAlbum).not.toHaveBeenCalled();
    expect(screen.getByText('Trip')).toBeInTheDocument();
  });

  it('renders nothing when there are no links', () => {
    const { container } = renderWithTooltips(AlbumSharedSpaceLinks, {
      album: albumFactory.build({ id: 'album-1', sharedSpaceLinks: undefined }),
    });

    expect(container.querySelector('[data-testid="album-space-links"]')).toBeNull();
  });

  it("does NOT render the previous album's links after navigating to a different album (L9)", async () => {
    const { rerender } = renderWithTooltips(AlbumSharedSpaceLinks, {
      album: albumFactory.build({
        id: 'album-1',
        sharedSpaceLinks: [{ spaceId: 'space-1', spaceName: 'Trip', linkedById: 'e1', showInTimeline: true }],
      }),
    });

    expect(screen.getByText('Trip')).toBeInTheDocument();

    // Simulate SvelteKit reusing this component instance across album navigation: only the `album`
    // prop changes, no remount.
    await rerender({
      component: AlbumSharedSpaceLinks,
      componentProps: {
        album: albumFactory.build({
          id: 'album-2',
          sharedSpaceLinks: [{ spaceId: 'space-2', spaceName: 'Zoo', linkedById: 'e2', showInTimeline: true }],
        }),
      },
    });

    expect(screen.queryByText('Trip')).not.toBeInTheDocument();
    expect(screen.getByText('Zoo')).toBeInTheDocument();
  });

  it('unlinking on one album does not affect a same-spaceId link rendered after navigating to another album (L9)', async () => {
    const { rerender } = renderWithTooltips(AlbumSharedSpaceLinks, {
      album: albumFactory.build({
        id: 'album-1',
        sharedSpaceLinks: [{ spaceId: 'space-1', spaceName: 'Trip', linkedById: 'e1', showInTimeline: true }],
      }),
    });

    await userEvent.click(screen.getByTestId('album-space-link-unlink'));
    await waitFor(() => {
      expect(sdkMock.unlinkAlbum).toHaveBeenCalledWith({ id: 'space-1', albumId: 'album-1' });
    });
    expect(screen.queryByText('Trip')).not.toBeInTheDocument();

    // Navigate to a different album that happens to be linked to the SAME space id. The
    // optimistic removal tracked for album-1 must not leak into album-2's rendering.
    await rerender({
      component: AlbumSharedSpaceLinks,
      componentProps: {
        album: albumFactory.build({
          id: 'album-2',
          sharedSpaceLinks: [{ spaceId: 'space-1', spaceName: 'Trip', linkedById: 'e1', showInTimeline: true }],
        }),
      },
    });

    expect(screen.getByText('Trip')).toBeInTheDocument();
  });
});
