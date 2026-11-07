import SpacesTable from '#lib/components/spaces/spaces-table.svelte';
import { SharedSpaceRole, type SharedSpaceResponseDto } from '@immich/sdk';
import { expect } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { userEvent } from 'vitest/browser';

vi.mock('#lib/route.js', () => ({
  Route: {
    viewSpace: ({ id }: { id: string }) => `/spaces/${id}`,
  },
}));

const makeSpace = (overrides: Partial<SharedSpaceResponseDto> = {}): SharedSpaceResponseDto => ({
  id: 'space-1',
  name: 'Alpha',
  description: null,
  createdById: 'user-1',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  thumbnailAssetId: null,
  lastActivityAt: null,
  assetCount: 0,
  memberCount: 1,
  recentAssetIds: [],
  recentAssetThumbhashes: [],
  members: [],
  ...overrides,
});

const currentUserId = 'user-1';

describe('SpacesTable', () => {
  it('renders space name', async () => {
    const spaces = [makeSpace({ name: 'My Space' })];
    const screen = await render(SpacesTable, { props: { spaces, currentUserId: 'user-1' } });
    await expect.element(screen.getByText('My Space', { exact: true })).toBeInTheDocument();
  });

  it('renders asset count as a number', async () => {
    const spaces = [makeSpace({ assetCount: 42 })];
    const screen = await render(SpacesTable, { props: { spaces, currentUserId: 'user-1' } });
    await expect.element(screen.getByText('42', { exact: true })).toBeInTheDocument();
  });

  it('renders member count as a number', async () => {
    const spaces = [makeSpace({ memberCount: 5 })];
    const screen = await render(SpacesTable, { props: { spaces, currentUserId: 'user-1' } });
    await expect.element(screen.getByText('5', { exact: true })).toBeInTheDocument();
  });

  it('renders new-badge when newAssetCount > 0', async () => {
    const spaces = [makeSpace({ id: 'sp1', newAssetCount: 3 })];
    const screen = await render(SpacesTable, { props: { spaces, currentUserId: 'user-1' } });
    await expect.element(screen.getByTestId('new-badge-sp1')).toBeInTheDocument();
  });

  it('renders em-dash in new-cell when newAssetCount === 0', async () => {
    const spaces = [makeSpace({ id: 'sp2', newAssetCount: 0 })];
    const screen = await render(SpacesTable, { props: { spaces, currentUserId: 'user-1' } });
    const cell = screen.getByTestId('new-cell-sp2');
    expect(cell.element().textContent).toContain('—');
  });

  it('renders em-dash in new-cell when newAssetCount is undefined', async () => {
    const spaces = [makeSpace({ id: 'sp3', newAssetCount: undefined })];
    const screen = await render(SpacesTable, { props: { spaces, currentUserId: 'user-1' } });
    const cell = screen.getByTestId('new-cell-sp3');
    expect(cell.element().textContent).toContain('—');
  });

  it('renders role badge for the current user (owner)', async () => {
    const spaces = [
      makeSpace({
        id: 'sp4',
        members: [
          {
            userId: 'user-1',
            name: 'Alice',
            email: 'alice@example.com',
            role: SharedSpaceRole.Owner,
            showInTimeline: true,
            sharePersonMetadata: true,
            joinedAt: '2026-01-01T00:00:00.000Z',
          },
        ],
      }),
    ];
    const screen = await render(SpacesTable, { props: { spaces, currentUserId: 'user-1' } });
    await expect.element(screen.getByTestId('role-badge-owner')).toBeInTheDocument();
  });

  it('renders color-bar for each space', async () => {
    const spaces = [makeSpace({ id: 'sp5' })];
    const screen = await render(SpacesTable, { props: { spaces, currentUserId: 'user-1' } });
    await expect.element(screen.getByTestId('color-bar-sp5')).toBeInTheDocument();
  });

  it('renders correct number of rows for multiple spaces', async () => {
    const spaces = [
      makeSpace({ id: 's1', name: 'A' }),
      makeSpace({ id: 's2', name: 'B' }),
      makeSpace({ id: 's3', name: 'C' }),
    ];
    const screen = await render(SpacesTable, { props: { spaces, currentUserId: 'user-1' } });
    expect(screen.getByTestId('space-row').elements()).toHaveLength(3);
  });

  it('should show pin icon in name cell when pinned', async () => {
    const space = makeSpace({ id: 'pinned-1' });
    const screen = await render(SpacesTable, {
      props: { spaces: [space], currentUserId, pinnedIds: ['pinned-1'], onTogglePin: vi.fn() },
    });
    await expect.element(screen.getByTestId('pin-icon-pinned-1')).toBeInTheDocument();
  });

  it('should not show pin icon when not pinned', async () => {
    const space = makeSpace({ id: 'unpinned-1' });
    const screen = await render(SpacesTable, {
      props: { spaces: [space], currentUserId, pinnedIds: [], onTogglePin: vi.fn() },
    });
    expect(screen.getByTestId('pin-icon-unpinned-1').query()).toBeNull();
  });

  it('should show three-dot menu button on row hover', async () => {
    const space = makeSpace({ id: 'hover-1' });
    const screen = await render(SpacesTable, {
      props: { spaces: [space], currentUserId, pinnedIds: [], onTogglePin: vi.fn() },
    });
    expect(screen.getByTestId('row-menu-button-hover-1').query()).toBeNull();
    await userEvent.hover(screen.getByTestId('space-row'));
    await expect.element(screen.getByTestId('row-menu-button-hover-1')).toBeInTheDocument();
  });

  it('should call onTogglePin when Pin to top clicked in row menu', async () => {
    const onTogglePin = vi.fn();
    const space = makeSpace({ id: 'pin-1' });
    const screen = await render(SpacesTable, {
      props: { spaces: [space], currentUserId, pinnedIds: [], onTogglePin },
    });
    await userEvent.hover(screen.getByTestId('space-row'));
    await userEvent.click(screen.getByTestId('row-menu-button-pin-1'));
    await userEvent.click(screen.getByText('spaces_pin_to_top', { exact: true }));
    expect(onTogglePin).toHaveBeenCalledWith('pin-1');
  });
});
