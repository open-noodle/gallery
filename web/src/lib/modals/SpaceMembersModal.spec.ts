import { getAnimateMock } from '$lib/__mocks__/animate.mock';
import { getIntersectionObserverMock } from '$lib/__mocks__/intersection-observer.mock';
import '$lib/__mocks__/sdk.mock';
import { getVisualViewportMock } from '$lib/__mocks__/visual-viewport.mock';

// Mock svelte-persisted-store to avoid localStorage issues in test environment
vi.mock('svelte-persisted-store', async () => {
  const { writable } = await import('svelte/store');
  return {
    persisted: (_key: string, initialValue: unknown) => writable(initialValue),
  };
});

// Mock tunables to avoid direct localStorage access
vi.mock('$lib/utils/tunables', () => ({
  TUNABLES: {
    LAYOUT: { WASM: true },
    TIMELINE: { INTERSECTION_EXPAND_TOP: 500, INTERSECTION_EXPAND_BOTTOM: 500 },
  },
}));

import { Role, type SharedSpaceMemberResponseDto } from '@immich/sdk';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import SpaceMembersModal from './SpaceMembersModal.svelte';

describe('SpaceMembersModal', () => {
  const spaceId = 'space-1';
  const onClose = vi.fn();

  const ownerMember: SharedSpaceMemberResponseDto = {
    userId: 'user-owner',
    name: 'Owner User',
    email: 'owner@test.com',
    role: Role.Owner,
    joinedAt: '2024-01-01T00:00:00.000Z',
    showInTimeline: true,
  };

  const editorMember: SharedSpaceMemberResponseDto = {
    userId: 'user-editor',
    name: 'Editor User',
    email: 'editor@test.com',
    role: Role.Editor,
    joinedAt: '2024-01-02T00:00:00.000Z',
    showInTimeline: true,
  };

  const viewerMember: SharedSpaceMemberResponseDto = {
    userId: 'user-viewer',
    name: 'Viewer User',
    email: 'viewer@test.com',
    role: Role.Viewer,
    joinedAt: '2024-01-03T00:00:00.000Z',
    showInTimeline: false,
  };

  beforeEach(() => {
    vi.stubGlobal('IntersectionObserver', getIntersectionObserverMock());
    vi.stubGlobal('visualViewport', getVisualViewportMock());
    vi.resetAllMocks();
    Element.prototype.animate = getAnimateMock();
  });

  afterAll(async () => {
    await waitFor(() => {
      expect(document.body.style.pointerEvents).not.toBe('none');
    });
  });

  it('should render all members with names and emails', () => {
    render(SpaceMembersModal, {
      spaceId,
      members: [ownerMember, editorMember],
      isOwner: false,
      onClose,
    });

    expect(screen.getByText('Owner User')).toBeInTheDocument();
    expect(screen.getByText('owner@test.com')).toBeInTheDocument();
    expect(screen.getByText('Editor User')).toBeInTheDocument();
    expect(screen.getByText('editor@test.com')).toBeInTheDocument();
  });

  it('should show add member button for owners', () => {
    render(SpaceMembersModal, {
      spaceId,
      members: [ownerMember],
      isOwner: true,
      onClose,
    });

    expect(screen.getByText('spaces_add_member')).toBeInTheDocument();
  });

  it('should not show add member button for non-owners', () => {
    render(SpaceMembersModal, {
      spaceId,
      members: [ownerMember, editorMember],
      isOwner: false,
      onClose,
    });

    expect(screen.queryByText('spaces_add_member')).not.toBeInTheDocument();
  });

  it('should show role select triggers for owners viewing members', () => {
    render(SpaceMembersModal, {
      spaceId,
      members: [ownerMember, editorMember, viewerMember],
      isOwner: true,
      onClose,
    });

    // Owner's disabled dropdown shows "owner", editor/viewer show translated role labels
    const ownerTrigger = screen.getByRole('button', { name: 'owner' });
    expect(ownerTrigger).toHaveAttribute('aria-expanded', 'false');

    const editorTrigger = screen.getByRole('button', { name: 'role_editor' });
    expect(editorTrigger).toBeInTheDocument();

    const viewerTrigger = screen.getByRole('button', { name: 'role_viewer' });
    expect(viewerTrigger).toBeInTheDocument();
  });

  it('should disable the owner role dropdown', () => {
    render(SpaceMembersModal, {
      spaceId,
      members: [ownerMember, editorMember],
      isOwner: true,
      onClose,
    });

    const ownerTrigger = screen.getByRole('button', { name: 'owner' });
    expect(ownerTrigger).toBeDisabled();
  });

  it('should show static role text for non-owners viewing members', () => {
    render(SpaceMembersModal, {
      spaceId,
      members: [ownerMember, editorMember],
      isOwner: false,
      onClose,
    });

    // Non-owners should see plain text role labels, not dropdown triggers
    expect(screen.getByText('owner')).toBeInTheDocument();
    expect(screen.getByText('editor')).toBeInTheDocument();
    // Should not have select triggers (no aria-haspopup=listbox buttons)
    expect(screen.queryByRole('button', { name: 'owner' })).not.toBeInTheDocument();
  });

  it('should have aria-haspopup=listbox on role select triggers', () => {
    render(SpaceMembersModal, {
      spaceId,
      members: [ownerMember, editorMember],
      isOwner: true,
      onClose,
    });

    const editorTrigger = screen.getByRole('button', { name: 'role_editor' });
    expect(editorTrigger).toHaveAttribute('aria-haspopup', 'listbox');
    expect(editorTrigger).toHaveAttribute('aria-expanded', 'false');
  });

  it('should pass updated members on close', async () => {
    render(SpaceMembersModal, {
      spaceId,
      members: [ownerMember, editorMember],
      isOwner: true,
      onClose,
    });

    // BasicModal renders multiple close buttons; use the first one
    const closeButtons = screen.getAllByRole('button', { name: 'Close' });
    await fireEvent.click(closeButtons[0]);

    expect(onClose).toHaveBeenCalledWith([ownerMember, editorMember]);
  });
});
