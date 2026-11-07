import { sdkMock } from '#lib/gallery/__mocks__/sdk.mock.ts';
import { factory } from '#test/unit/factories.ts';
import { AlbumUserRole, type AlbumResponseDto } from '@immich/sdk';
import { expect } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page, userEvent } from 'vitest/browser';
import SpaceLinkAlbumModal from './SpaceLinkAlbumModal.svelte';

const { mockUser } = vi.hoisted(() => ({
  mockUser: { current: { id: 'u-me', isAdmin: false } },
}));

vi.mock('#lib/managers/auth-manager.svelte.js', () => ({
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
  // eslint-disable-next-line unicorn/no-unnecessary-parameters
  userId = 'u-me',
): AlbumResponseDto =>
  factory.album({
    albumUsers: [{ user: factory.userSummary({ id: userId }), role }],
    ...overrides,
  });

describe('SpaceLinkAlbumModal', () => {
  const onClose = vi.fn();

  beforeEach(() => {
    vi.resetAllMocks();
    mockUser.current = { id: 'u-me', isAdmin: false };
  });

  it('lists albums the user owns or co-edits and hides already-linked + view-only albums', async () => {
    sdkMock.getAllAlbums.mockResolvedValue([
      makeAlbum({ id: 'owned', albumName: 'Owned Album' }, AlbumUserRole.Owner),
      makeAlbum({ id: 'editor', albumName: 'Editor Album' }, AlbumUserRole.Editor),
      makeAlbum({ id: 'viewer', albumName: 'Viewer Album' }, AlbumUserRole.Viewer),
      makeAlbum({ id: 'linked', albumName: 'Linked Album' }, AlbumUserRole.Owner),
    ]);

    await render(SpaceLinkAlbumModal, { spaceId: 'space-1', linkedAlbumIds: ['linked'], onClose });

    await expect.element(page.getByRole('button', { name: /Owned Album/ })).toBeInTheDocument();
    await expect.element(page.getByRole('button', { name: /Editor Album/ })).toBeInTheDocument();
    await expect.element(page.getByText('Viewer Album')).not.toBeInTheDocument();
    await expect.element(page.getByText('Linked Album')).not.toBeInTheDocument();
  });

  it('filters the linkable albums by search text', async () => {
    sdkMock.getAllAlbums.mockResolvedValue([
      makeAlbum({ id: 'a1', albumName: 'Summer Trip' }),
      makeAlbum({ id: 'a2', albumName: 'Winter Holiday' }),
    ]);

    await render(SpaceLinkAlbumModal, { spaceId: 'space-1', linkedAlbumIds: [], onClose });
    await expect.element(page.getByText('Summer Trip')).toBeInTheDocument();

    await userEvent.fill(page.getByRole('textbox'), 'winter');

    await expect.element(page.getByText('Summer Trip')).not.toBeInTheDocument();
    await expect.element(page.getByText('Winter Holiday')).toBeInTheDocument();
  });

  it('shows the no-results message when the search matches nothing', async () => {
    sdkMock.getAllAlbums.mockResolvedValue([makeAlbum({ id: 'a1', albumName: 'Summer Trip' })]);

    await render(SpaceLinkAlbumModal, { spaceId: 'space-1', linkedAlbumIds: [], onClose });
    await expect.element(page.getByText('Summer Trip')).toBeInTheDocument();

    await userEvent.fill(page.getByRole('textbox'), 'nonexistent');

    await expect.element(page.getByText('search_no_result')).toBeInTheDocument();
  });

  it('shows the empty state when there are no linkable albums', async () => {
    sdkMock.getAllAlbums.mockResolvedValue([
      makeAlbum({ id: 'viewer', albumName: 'Viewer Album' }, AlbumUserRole.Viewer),
    ]);

    await render(SpaceLinkAlbumModal, { spaceId: 'space-1', linkedAlbumIds: [], onClose });

    await expect.element(page.getByText('spaces_linked_albums_no_albums')).toBeInTheDocument();
    await expect.element(page.getByRole('textbox')).not.toBeInTheDocument();
  });

  it('shows the empty state when albums fail to load', async () => {
    sdkMock.getAllAlbums.mockRejectedValue(new Error('network'));

    await render(SpaceLinkAlbumModal, { spaceId: 'space-1', linkedAlbumIds: [], onClose });

    await expect.element(page.getByText('spaces_linked_albums_no_albums')).toBeInTheDocument();
  });

  it('links every selected album then closes with the linked count', async () => {
    sdkMock.getAllAlbums.mockResolvedValue([
      makeAlbum({ id: 'a1', albumName: 'Alpha' }),
      makeAlbum({ id: 'a2', albumName: 'Beta' }),
      makeAlbum({ id: 'a3', albumName: 'Gamma' }),
    ]);
    sdkMock.linkAlbum.mockResolvedValue(undefined as never);

    await render(SpaceLinkAlbumModal, { spaceId: 'space-1', linkedAlbumIds: [], onClose });

    await userEvent.click(page.getByRole('button', { name: /Alpha/ }));
    await userEvent.click(page.getByRole('button', { name: /Gamma/ }));
    await userEvent.click(page.getByRole('button', { name: 'link' }));

    await vi.waitFor(() => expect(sdkMock.linkAlbum).toHaveBeenCalledWith({ id: 'space-1', albumId: 'a1' }));
    expect(sdkMock.linkAlbum).toHaveBeenCalledWith({ id: 'space-1', albumId: 'a3' });
    expect(sdkMock.linkAlbum).not.toHaveBeenCalledWith({ id: 'space-1', albumId: 'a2' });
    expect(sdkMock.linkAlbum).toHaveBeenCalledTimes(2);
    await vi.waitFor(() => expect(onClose).toHaveBeenCalledWith(2));
  });

  it('disables the submit button until an album is selected', async () => {
    sdkMock.getAllAlbums.mockResolvedValue([makeAlbum({ id: 'a1', albumName: 'Alpha' })]);

    await render(SpaceLinkAlbumModal, { spaceId: 'space-1', linkedAlbumIds: [], onClose });
    await expect.element(page.getByText('Alpha')).toBeInTheDocument();

    await expect.element(page.getByRole('button', { name: 'link' })).toBeDisabled();

    await userEvent.click(page.getByRole('button', { name: /Alpha/ }));

    await expect.element(page.getByRole('button', { name: 'link' })).toBeEnabled();
  });
});
