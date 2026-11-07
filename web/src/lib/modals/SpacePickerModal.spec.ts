import { sdkMock } from '#lib/gallery/__mocks__/sdk.mock.ts';
import { SharedSpaceRole, UserAvatarColor, type SharedSpaceResponseDto } from '@immich/sdk';
import { expect } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page, userEvent } from 'vitest/browser';
import SpacePickerModal from './SpacePickerModal.svelte';

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

const makeSpace = (
  overrides: Partial<SharedSpaceResponseDto> & { role?: SharedSpaceRole; memberUserId?: string } = {},
): SharedSpaceResponseDto => {
  const role = overrides.role ?? SharedSpaceRole.Editor;
  const memberUserId = overrides.memberUserId ?? 'u-me';
  return {
    id: 'space-1',
    name: 'Family Space',
    description: null,
    createdById: role === SharedSpaceRole.Owner ? 'u-me' : 'owner-id',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    color: UserAvatarColor.Primary,
    thumbnailAssetId: null,
    assetCount: 0,
    memberCount: 1,
    members: [
      {
        userId: memberUserId,
        name: 'Current User',
        email: 'me@test.invalid',
        role,
        joinedAt: '2026-01-01T00:00:00.000Z',
        showInTimeline: true,
        sharePersonMetadata: true,
      },
    ],
    recentAssetIds: [],
    recentAssetThumbhashes: [],
    lastActivityAt: null,
    newAssetCount: 0,
    lastViewedAt: null,
    ...overrides,
  };
};

describe('SpacePickerModal', () => {
  const onClose = vi.fn();

  beforeEach(() => {
    vi.resetAllMocks();
    mockUser.current = { id: 'u-me', isAdmin: false };
  });

  it('shows owner and editor spaces and hides viewer spaces', async () => {
    sdkMock.getAllSpaces.mockResolvedValue([
      makeSpace({ id: 'owner-space', name: 'Owner Space', role: SharedSpaceRole.Owner }),
      makeSpace({ id: 'editor-space', name: 'Editor Space', role: SharedSpaceRole.Editor }),
      makeSpace({ id: 'viewer-space', name: 'Viewer Space', role: SharedSpaceRole.Viewer }),
    ]);

    await render(SpacePickerModal, { onClose });

    await expect.element(page.getByRole('button', { name: /Owner Space/ })).toBeInTheDocument();
    await expect.element(page.getByRole('button', { name: /Editor Space/ })).toBeInTheDocument();
    expect(page.getByText('Viewer Space').query()).toBeNull();
  });

  it('treats createdById as an owner fallback when member rows are missing', async () => {
    sdkMock.getAllSpaces.mockResolvedValue([
      makeSpace({ id: 'created-space', name: 'Created Space', createdById: 'u-me', members: [] }),
    ]);

    await render(SpacePickerModal, { onClose });

    await expect.element(page.getByRole('button', { name: /Created Space/ })).toBeInTheDocument();
  });

  it('lists the spaces it is given with their counts and title, without asking the server', async () => {
    await render(SpacePickerModal, {
      onClose,
      title: 'Remove from space',
      spaces: [
        makeSpace({ id: 'family', name: 'Family' }),
        makeSpace({ id: 'trips', name: 'Trips' }),
        makeSpace({ id: 'viewed', name: 'Viewed', role: SharedSpaceRole.Viewer }),
      ],
      counts: { family: 2, trips: 1 },
    });

    await expect.element(page.getByRole('button', { name: /Family/ })).toBeInTheDocument();
    await expect.element(page.getByRole('button', { name: /Trips/ })).toBeInTheDocument();
    expect(page.getByText('Viewed').query()).toBeNull();
    await expect.element(page.getByText('Remove from space')).toBeInTheDocument();
    // The test locale shows keys: a count per row, in place of the role.
    expect(page.getByText('items_count').elements()).toHaveLength(2);
    expect(page.getByText('role_editor').query()).toBeNull();
    expect(sdkMock.getAllSpaces).not.toHaveBeenCalled();
  });

  it("shows each space's colour next to its count", async () => {
    await render(SpacePickerModal, {
      onClose,
      spaces: [
        makeSpace({ id: 'family', name: 'Family', color: UserAvatarColor.Pink }),
        makeSpace({ id: 'trips', name: 'Trips', color: UserAvatarColor.Blue }),
      ],
      counts: { family: 2, trips: 1 },
    });

    await expect.element(page.getByRole('button', { name: /Family/ })).toBeInTheDocument();
    const family = page.getByRole('button', { name: /Family/ }).element();
    expect(family.querySelector(':scope [data-space-color] svg')?.getAttribute('class')).toContain('text-pink-500');
    const trips = page.getByRole('button', { name: /Trips/ }).element();
    expect(trips.querySelector(':scope [data-space-color] svg')?.getAttribute('class')).toContain('text-blue-600');
  });

  it('filters writable spaces by search text', async () => {
    sdkMock.getAllSpaces.mockResolvedValue([
      makeSpace({ id: 'family-space', name: 'Family Space' }),
      makeSpace({ id: 'work-space', name: 'Work Space' }),
    ]);

    await render(SpacePickerModal, { onClose });
    await expect.element(page.getByText('Family Space')).toBeInTheDocument();

    await userEvent.fill(page.getByRole('textbox'), 'work');

    expect(page.getByText('Family Space').query()).toBeNull();
    await expect.element(page.getByText('Work Space')).toBeInTheDocument();
  });

  it('shows an empty state when no writable spaces match', async () => {
    sdkMock.getAllSpaces.mockResolvedValue([makeSpace({ id: 'viewer-space', role: SharedSpaceRole.Viewer })]);

    await render(SpacePickerModal, { onClose });

    await expect.element(page.getByText('spaces_no_writable_spaces')).toBeInTheDocument();
  });

  it('shows the empty state when spaces fail to load', async () => {
    sdkMock.getAllSpaces.mockRejectedValue(new Error('network'));

    await render(SpacePickerModal, { onClose });

    await expect.element(page.getByText('spaces_no_writable_spaces')).toBeInTheDocument();
  });

  it('returns the selected writable space', async () => {
    const target = makeSpace({ id: 'target-space', name: 'Target Space', role: SharedSpaceRole.Editor });
    sdkMock.getAllSpaces.mockResolvedValue([target]);

    await render(SpacePickerModal, { onClose });
    await userEvent.click(page.getByRole('button', { name: /Target Space/ }));

    expect(onClose).toHaveBeenCalledWith(target);
  });
});
