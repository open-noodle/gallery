import '#lib/gallery/__mocks__/sdk.mock.ts';
import { SharedSpaceRole, type SharedSpaceMemberResponseDto } from '@immich/sdk';
import { expect } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import SpaceMembersModal from './SpaceMembersModal.svelte';

// Mock svelte-persisted-store to avoid localStorage issues in test environment
vi.mock('svelte-persisted-store', async () => {
  const { writable } = await import('svelte/store');
  return {
    persisted: (_key: string, initialValue: unknown) => writable(initialValue),
  };
});

// Mock tunables to avoid direct localStorage access
vi.mock('#lib/utils/tunables.js', () => ({
  TUNABLES: {
    LAYOUT: { WASM: true },
    TIMELINE: { INTERSECTION_EXPAND_TOP: 500, INTERSECTION_EXPAND_BOTTOM: 500 },
  },
}));

describe('SpaceMembersModal', () => {
  const spaceId = 'space-1';
  const onClose = vi.fn();

  const ownerMember: SharedSpaceMemberResponseDto = {
    userId: 'user-owner',
    name: 'Owner User',
    email: 'owner@test.com',
    role: SharedSpaceRole.Owner,
    joinedAt: '2024-01-01T00:00:00.000Z',
    showInTimeline: true,
    sharePersonMetadata: true,
  };

  const editorMember: SharedSpaceMemberResponseDto = {
    userId: 'user-editor',
    name: 'Editor User',
    email: 'editor@test.com',
    role: SharedSpaceRole.Editor,
    joinedAt: '2024-01-02T00:00:00.000Z',
    showInTimeline: true,
    sharePersonMetadata: true,
  };

  const viewerMember: SharedSpaceMemberResponseDto = {
    userId: 'user-viewer',
    name: 'Viewer User',
    email: 'viewer@test.com',
    role: SharedSpaceRole.Viewer,
    joinedAt: '2024-01-03T00:00:00.000Z',
    showInTimeline: false,
    sharePersonMetadata: true,
  };

  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('should render all members with names and emails', async () => {
    await render(SpaceMembersModal, {
      spaceId,
      members: [ownerMember, editorMember],
      isOwner: false,
      onClose,
    });

    await expect.element(page.getByText('Owner User')).toBeInTheDocument();
    await expect.element(page.getByText('owner@test.com')).toBeInTheDocument();
    await expect.element(page.getByText('Editor User')).toBeInTheDocument();
    await expect.element(page.getByText('editor@test.com')).toBeInTheDocument();
  });

  it('should show add member button for owners', async () => {
    await render(SpaceMembersModal, {
      spaceId,
      members: [ownerMember],
      isOwner: true,
      onClose,
    });

    await expect.element(page.getByText('spaces_add_member')).toBeInTheDocument();
  });

  it('should not show add member button for non-owners', async () => {
    await render(SpaceMembersModal, {
      spaceId,
      members: [ownerMember, editorMember],
      isOwner: false,
      onClose,
    });

    await expect.element(page.getByText('spaces_add_member')).not.toBeInTheDocument();
  });

  it('should show role selects to a non-owner when canChangeRoles is set', async () => {
    await render(SpaceMembersModal, {
      spaceId,
      members: [ownerMember, viewerMember],
      isOwner: false,
      canChangeRoles: true,
      onClose,
    });

    await expect.element(page.getByRole('button', { name: 'role_viewer' })).toBeInTheDocument();
  });

  it('should show a badge, never a role select, on owner rows for a non-owner with canChangeRoles', async () => {
    await render(SpaceMembersModal, {
      spaceId,
      members: [ownerMember, viewerMember],
      isOwner: false,
      canChangeRoles: true,
      onClose,
    });

    await expect.element(page.getByTestId('role-badge-owner')).toBeInTheDocument();
    expect(page.getByRole('button', { name: /^role_/ }).elements()).toHaveLength(1);
  });

  it("should not show a role select on the viewer's own row", async () => {
    await render(SpaceMembersModal, {
      spaceId,
      members: [ownerMember, editorMember, viewerMember],
      isOwner: false,
      canChangeRoles: true,
      currentUserId: editorMember.userId,
      onClose,
    });

    await expect.element(page.getByRole('button', { name: 'role_editor' })).not.toBeInTheDocument();
    await expect.element(page.getByRole('button', { name: 'role_viewer' })).toBeInTheDocument();
  });

  it('should keep static roles for a non-owner when canChangeRoles is not set', async () => {
    await render(SpaceMembersModal, { spaceId, members: [ownerMember, viewerMember], isOwner: false, onClose });

    await expect.element(page.getByRole('button', { name: 'role_viewer' })).not.toBeInTheDocument();
  });

  it('should show role badge for owner and select triggers for other members', async () => {
    await render(SpaceMembersModal, {
      spaceId,
      members: [ownerMember, editorMember, viewerMember],
      isOwner: true,
      onClose,
    });

    // Owner shows a static role badge (not a dropdown)
    const ownerBadge = page.getByTestId('role-badge-owner');
    await expect.element(ownerBadge).toBeInTheDocument();
    expect(ownerBadge.element().tagName).toBe('SPAN');

    // Editor/viewer still show select dropdowns
    await expect.element(page.getByRole('button', { name: 'role_editor' })).toBeInTheDocument();
    await expect.element(page.getByRole('button', { name: 'role_viewer' })).toBeInTheDocument();
  });

  it('should show owner role badge instead of dropdown', async () => {
    await render(SpaceMembersModal, {
      spaceId,
      members: [ownerMember, editorMember],
      isOwner: true,
      onClose,
    });

    // Owner row has a role badge, not a button/dropdown
    await expect.element(page.getByTestId('role-badge-owner')).toBeInTheDocument();
    await expect.element(page.getByRole('button', { name: 'owner' })).not.toBeInTheDocument();
  });

  it('should show static role text for non-owners viewing members', async () => {
    await render(SpaceMembersModal, {
      spaceId,
      members: [ownerMember, editorMember],
      isOwner: false,
      onClose,
    });

    // Non-owners should see role badges, not dropdown triggers
    await expect.element(page.getByTestId('role-badge-owner')).toBeInTheDocument();
    await expect.element(page.getByTestId('role-badge-editor')).toBeInTheDocument();
    // Should not have select triggers (no aria-haspopup=listbox buttons)
    await expect.element(page.getByRole('button', { name: 'owner' })).not.toBeInTheDocument();
  });

  it('should have aria-haspopup=listbox on role select triggers', async () => {
    await render(SpaceMembersModal, {
      spaceId,
      members: [ownerMember, editorMember],
      isOwner: true,
      onClose,
    });

    const editorTrigger = page.getByRole('button', { name: 'role_editor' });
    await expect.element(editorTrigger).toHaveAttribute('aria-haspopup', 'listbox');
    await expect.element(editorTrigger).toHaveAttribute('aria-expanded', 'false');
  });

  it('should pass updated members on close', async () => {
    await render(SpaceMembersModal, {
      spaceId,
      members: [ownerMember, editorMember],
      isOwner: true,
      onClose,
    });

    // BasicModal renders multiple close buttons; use the first one
    await page.getByRole('button', { name: 'Close' }).first().click();

    expect(onClose).toHaveBeenCalledWith([ownerMember, editorMember]);
  });
});
