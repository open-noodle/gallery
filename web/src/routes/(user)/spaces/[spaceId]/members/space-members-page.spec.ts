import type { SharedSpaceMemberResponseDto, SharedSpaceResponseDto } from '@immich/sdk';
import { SharedSpaceRole } from '@immich/sdk';
import { modalManager } from '@immich/ui';
import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import type { Component } from 'svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { sdkMock } from '$lib/__mocks__/sdk.mock';
import TestWrapper from '$lib/components/TestWrapper.svelte';
import MembersPage from './+page.svelte';

const { mockAuthManager } = vi.hoisted(() => ({ mockAuthManager: { user: { id: 'u1', isAdmin: false } } }));
vi.mock('$lib/managers/auth-manager.svelte', () => ({ authManager: mockAuthManager }));
vi.mock('$app/navigation', () => ({ goto: vi.fn(), invalidateAll: vi.fn().mockResolvedValue(undefined) }));

// The page drives @immich/ui's modalManager (invite modal + remove-confirm dialog). It also renders
// the @immich/ui <Select> for role changes, whose real bits-ui listbox cannot have an option selected
// in jsdom (the SpaceMembersModal spec asserts the trigger but never opens it for the same reason).
// We replace only those two surfaces and keep the rest of @immich/ui real. The Select stub reproduces
// the observable contract the page relies on — a `button[aria-haspopup=listbox]` whose accessible name
// is the selected option's label (matching the real component) plus per-option click targets exposing
// onChange — so role rendering is asserted against the same contract and onChange can be driven.
vi.mock('@immich/ui', async (importOriginal) => {
  const original = await importOriginal<typeof import('@immich/ui')>();
  const { default: MockSelect } = await import('./mock-select.test-wrapper.svelte');
  return {
    ...original,
    Select: MockSelect,
    modalManager: { show: vi.fn(), showDialog: vi.fn() },
  };
});

const space = (o: Partial<SharedSpaceResponseDto> = {}): SharedSpaceResponseDto =>
  ({ id: 's1', name: 'Trip', color: 'primary', ...o }) as never;
const member = (o: Partial<SharedSpaceMemberResponseDto> = {}): SharedSpaceMemberResponseDto =>
  ({ userId: 'u1', role: SharedSpaceRole.Owner, name: 'Me', email: 'me@x.io', contributionCount: 0, ...o }) as never;

type PageProps = {
  data: {
    space: SharedSpaceResponseDto;
    members: SharedSpaceMemberResponseDto[];
    linkedAlbums: never[];
  };
};

function renderPage(role: SharedSpaceRole, members = [member({ role })], options: { currentUserId?: string } = {}) {
  mockAuthManager.user = { id: options.currentUserId ?? 'u1', isAdmin: false };
  const props: PageProps = {
    data: {
      space: space(),
      members,
      linkedAlbums: [],
    },
  };
  return render(TestWrapper as Component<{ component: typeof MembersPage; componentProps: PageProps }>, {
    component: MembersPage,
    componentProps: props,
  });
}

describe('Members tab', () => {
  beforeEach(() => vi.clearAllMocks());

  it('lists members', () => {
    renderPage(SharedSpaceRole.Owner, [member(), member({ userId: 'u2', role: SharedSpaceRole.Editor, name: 'Ann' })]);
    expect(screen.getByText('Me')).toBeInTheDocument();
    expect(screen.getByText('Ann')).toBeInTheDocument();
  });

  it('shows the invite button to an owner', () => {
    renderPage(SharedSpaceRole.Owner);
    expect(screen.getByTestId('members-invite')).toBeInTheDocument();
  });

  it('hides the invite button from a non-owner', () => {
    renderPage(SharedSpaceRole.Viewer);
    expect(screen.queryByTestId('members-invite')).not.toBeInTheDocument();
  });

  it('does not render the activity feed (moved to the Activity tab)', () => {
    renderPage(SharedSpaceRole.Owner);
    expect(screen.queryByTestId('members-activity')).not.toBeInTheDocument();
    // The Members page must not fetch activities anymore — that's the Activity tab's job.
    expect(sdkMock.getSpaceActivities).not.toHaveBeenCalled();
  });

  describe('role Select vs RoleBadge rendering', () => {
    it('shows a role Select for a non-owner member but a RoleBadge for the owner’s own row when current user is owner', () => {
      renderPage(SharedSpaceRole.Owner, [
        member(), // u1 = current user (owner)
        member({ userId: 'u2', role: SharedSpaceRole.Editor, name: 'Ann' }),
      ]);

      // Exactly one editable Select trigger — for the non-owner member.
      const selects = screen.getAllByTestId('role-select');
      expect(selects).toHaveLength(1);
      // The trigger reflects the member's current role and exposes the listbox affordance.
      const trigger = within(selects[0])
        .getAllByRole('button')
        .find((b) => b.getAttribute('aria-haspopup') === 'listbox');
      expect(trigger).toHaveTextContent('role_editor');

      // The owner's own row shows a static badge, not a Select.
      expect(screen.getByTestId('role-badge-owner')).toBeInTheDocument();
      // The non-owner row has no badge (it has the Select instead).
      expect(screen.queryByTestId('role-badge-editor')).not.toBeInTheDocument();
    });

    it('shows only RoleBadges (no Select) for every row when the current user is a non-owner', () => {
      renderPage(
        SharedSpaceRole.Viewer,
        [
          member(), // owner
          member({ userId: 'u2', role: SharedSpaceRole.Viewer, name: 'Ann' }), // current user (viewer)
        ],
        { currentUserId: 'u2' },
      );

      expect(screen.queryByTestId('role-select')).not.toBeInTheDocument();
      expect(screen.getByTestId('role-badge-owner')).toBeInTheDocument();
      expect(screen.getByTestId('role-badge-viewer')).toBeInTheDocument();
    });
  });

  describe('change role', () => {
    it('selecting Viewer updates the member role and revalidates', async () => {
      renderPage(SharedSpaceRole.Owner, [
        member(),
        member({ userId: 'u2', role: SharedSpaceRole.Editor, name: 'Ann' }),
      ]);
      const { invalidateAll } = await import('$app/navigation');

      await fireEvent.click(screen.getByTestId(`role-option-${SharedSpaceRole.Viewer}`));

      expect(sdkMock.updateMember).toHaveBeenCalledWith({
        id: 's1',
        userId: 'u2',
        sharedSpaceMemberUpdateDto: { role: SharedSpaceRole.Viewer },
      });
      await waitFor(() => expect(invalidateAll).toHaveBeenCalled());
      expect(sdkMock.removeMember).not.toHaveBeenCalled();
    });

    it('selecting Editor updates the member role and revalidates', async () => {
      renderPage(SharedSpaceRole.Owner, [
        member(),
        member({ userId: 'u2', role: SharedSpaceRole.Viewer, name: 'Ann' }),
      ]);
      const { invalidateAll } = await import('$app/navigation');

      await fireEvent.click(screen.getByTestId(`role-option-${SharedSpaceRole.Editor}`));

      expect(sdkMock.updateMember).toHaveBeenCalledWith({
        id: 's1',
        userId: 'u2',
        sharedSpaceMemberUpdateDto: { role: SharedSpaceRole.Editor },
      });
      await waitFor(() => expect(invalidateAll).toHaveBeenCalled());
    });
  });

  describe('remove member', () => {
    it('confirms then removes the member and revalidates', async () => {
      vi.mocked(modalManager.showDialog).mockResolvedValue(true);
      renderPage(SharedSpaceRole.Owner, [
        member(),
        member({ userId: 'u2', role: SharedSpaceRole.Editor, name: 'Ann' }),
      ]);
      const { invalidateAll } = await import('$app/navigation');

      await fireEvent.click(screen.getByTestId('role-option-remove'));

      await waitFor(() => expect(modalManager.showDialog).toHaveBeenCalled());
      await waitFor(() => expect(sdkMock.removeMember).toHaveBeenCalledWith({ id: 's1', userId: 'u2' }));
      await waitFor(() => expect(invalidateAll).toHaveBeenCalled());
      expect(sdkMock.updateMember).not.toHaveBeenCalled();
    });

    it('does NOT remove the member when the confirm dialog is dismissed', async () => {
      vi.mocked(modalManager.showDialog).mockResolvedValue(false);
      renderPage(SharedSpaceRole.Owner, [
        member(),
        member({ userId: 'u2', role: SharedSpaceRole.Editor, name: 'Ann' }),
      ]);

      await fireEvent.click(screen.getByTestId('role-option-remove'));

      await waitFor(() => expect(modalManager.showDialog).toHaveBeenCalled());
      expect(sdkMock.removeMember).not.toHaveBeenCalled();
    });
  });

  describe('invite', () => {
    it('opens the add-member modal and revalidates when it resolves truthy', async () => {
      vi.mocked(modalManager.show).mockResolvedValue(true as never);
      renderPage(SharedSpaceRole.Owner, [
        member(),
        member({ userId: 'u2', role: SharedSpaceRole.Editor, name: 'Ann' }),
      ]);
      const { invalidateAll } = await import('$app/navigation');
      const addMemberModalModule = await import('$lib/modals/SpaceAddMemberModal.svelte');
      const SpaceAddMemberModal = addMemberModalModule.default;

      await fireEvent.click(screen.getByTestId('members-invite'));

      await waitFor(() =>
        expect(modalManager.show).toHaveBeenCalledWith(SpaceAddMemberModal, {
          spaceId: 's1',
          existingMemberIds: ['u1', 'u2'],
        }),
      );
      await waitFor(() => expect(invalidateAll).toHaveBeenCalled());
    });

    it('does not revalidate when the add-member modal resolves falsy', async () => {
      vi.mocked(modalManager.show).mockResolvedValue(false as never);
      renderPage(SharedSpaceRole.Owner);
      const { invalidateAll } = await import('$app/navigation');

      await fireEvent.click(screen.getByTestId('members-invite'));

      await waitFor(() => expect(modalManager.show).toHaveBeenCalled());
      expect(invalidateAll).not.toHaveBeenCalled();
    });
  });
});
