import { AlbumUserRole, type AlbumResponseDto } from '@immich/sdk';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { getAnimateMock } from '$lib/__mocks__/animate.mock';
import { getIntersectionObserverMock } from '$lib/__mocks__/intersection-observer.mock';
import '$lib/__mocks__/sdk.mock';
import { sdkMock } from '$lib/__mocks__/sdk.mock';
import { getVisualViewportMock } from '$lib/__mocks__/visual-viewport.mock';
import { albumFactory } from '@test-data/factories/album-factory';
import { userFactory } from '@test-data/factories/user-factory';
import SpaceLinkAlbumModal from './SpaceLinkAlbumModal.svelte';

const { mockUser } = vi.hoisted(() => ({
  mockUser: { current: { id: 'u-me', isAdmin: false } },
}));

vi.mock('$lib/managers/auth-manager.svelte', () => ({
  authManager: {
    get authenticated() {
      return mockUser.current !== null;
    },
    get user() {
      return mockUser.current;
    },
  },
}));

const makeAlbum = (
  overrides: Partial<AlbumResponseDto> = {},
  role: AlbumUserRole = AlbumUserRole.Owner,
  userId = 'u-me',
): AlbumResponseDto =>
  albumFactory.build({
    albumUsers: [{ user: userFactory.build({ id: userId }), role }],
    ...overrides,
  });

describe('SpaceLinkAlbumModal', () => {
  const onClose = vi.fn();

  beforeEach(() => {
    vi.stubGlobal('IntersectionObserver', getIntersectionObserverMock());
    vi.stubGlobal('visualViewport', getVisualViewportMock());
    vi.resetAllMocks();
    Element.prototype.animate = getAnimateMock();
    mockUser.current = { id: 'u-me', isAdmin: false };
  });

  afterAll(async () => {
    await waitFor(() => {
      expect(document.body.style.pointerEvents).not.toBe('none');
    });
  });

  it('lists albums the user owns or co-edits and hides already-linked + view-only albums', async () => {
    sdkMock.getAllAlbums.mockResolvedValue([
      makeAlbum({ id: 'owned', albumName: 'Owned Album' }, AlbumUserRole.Owner),
      makeAlbum({ id: 'editor', albumName: 'Editor Album' }, AlbumUserRole.Editor),
      makeAlbum({ id: 'viewer', albumName: 'Viewer Album' }, AlbumUserRole.Viewer),
      makeAlbum({ id: 'linked', albumName: 'Linked Album' }, AlbumUserRole.Owner),
    ]);

    render(SpaceLinkAlbumModal, { spaceId: 'space-1', linkedAlbumIds: ['linked'], onClose });

    expect(await screen.findByRole('button', { name: /Owned Album/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Editor Album/ })).toBeInTheDocument();
    expect(screen.queryByText('Viewer Album')).not.toBeInTheDocument();
    expect(screen.queryByText('Linked Album')).not.toBeInTheDocument();
  });

  it('filters the linkable albums by search text', async () => {
    sdkMock.getAllAlbums.mockResolvedValue([
      makeAlbum({ id: 'a1', albumName: 'Summer Trip' }),
      makeAlbum({ id: 'a2', albumName: 'Winter Holiday' }),
    ]);

    render(SpaceLinkAlbumModal, { spaceId: 'space-1', linkedAlbumIds: [], onClose });
    await screen.findByText('Summer Trip');

    await fireEvent.input(screen.getByRole('textbox'), { target: { value: 'winter' } });

    expect(screen.queryByText('Summer Trip')).not.toBeInTheDocument();
    expect(screen.getByText('Winter Holiday')).toBeInTheDocument();
  });

  it('shows the no-results message when the search matches nothing', async () => {
    sdkMock.getAllAlbums.mockResolvedValue([makeAlbum({ id: 'a1', albumName: 'Summer Trip' })]);

    render(SpaceLinkAlbumModal, { spaceId: 'space-1', linkedAlbumIds: [], onClose });
    await screen.findByText('Summer Trip');

    await fireEvent.input(screen.getByRole('textbox'), { target: { value: 'nonexistent' } });

    expect(screen.getByText('search_no_result')).toBeInTheDocument();
  });

  it('shows the empty state when there are no linkable albums', async () => {
    sdkMock.getAllAlbums.mockResolvedValue([
      makeAlbum({ id: 'viewer', albumName: 'Viewer Album' }, AlbumUserRole.Viewer),
    ]);

    render(SpaceLinkAlbumModal, { spaceId: 'space-1', linkedAlbumIds: [], onClose });

    expect(await screen.findByText('spaces_linked_albums_no_albums')).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('shows the empty state when albums fail to load', async () => {
    sdkMock.getAllAlbums.mockRejectedValue(new Error('network'));

    render(SpaceLinkAlbumModal, { spaceId: 'space-1', linkedAlbumIds: [], onClose });

    expect(await screen.findByText('spaces_linked_albums_no_albums')).toBeInTheDocument();
  });

  it('links every selected album then closes with the linked count', async () => {
    sdkMock.getAllAlbums.mockResolvedValue([
      makeAlbum({ id: 'a1', albumName: 'Alpha' }),
      makeAlbum({ id: 'a2', albumName: 'Beta' }),
      makeAlbum({ id: 'a3', albumName: 'Gamma' }),
    ]);
    sdkMock.linkAlbum.mockResolvedValue(undefined as never);

    render(SpaceLinkAlbumModal, { spaceId: 'space-1', linkedAlbumIds: [], onClose });

    await userEvent.click(await screen.findByRole('button', { name: /Alpha/ }));
    await userEvent.click(screen.getByRole('button', { name: /Gamma/ }));
    await userEvent.click(screen.getByRole('button', { name: 'link' }));

    await waitFor(() => expect(sdkMock.linkAlbum).toHaveBeenCalledWith({ id: 'space-1', albumId: 'a1' }));
    expect(sdkMock.linkAlbum).toHaveBeenCalledWith({ id: 'space-1', albumId: 'a3' });
    expect(sdkMock.linkAlbum).not.toHaveBeenCalledWith({ id: 'space-1', albumId: 'a2' });
    expect(sdkMock.linkAlbum).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(onClose).toHaveBeenCalledWith(2));
  });

  it('disables the submit button until an album is selected', async () => {
    sdkMock.getAllAlbums.mockResolvedValue([makeAlbum({ id: 'a1', albumName: 'Alpha' })]);

    render(SpaceLinkAlbumModal, { spaceId: 'space-1', linkedAlbumIds: [], onClose });
    await screen.findByText('Alpha');

    expect(screen.getByRole('button', { name: 'link' })).toBeDisabled();

    await userEvent.click(screen.getByRole('button', { name: /Alpha/ }));

    expect(screen.getByRole('button', { name: 'link' })).not.toBeDisabled();
  });
});
