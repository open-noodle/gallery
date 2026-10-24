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

function renderPage(
  role: SharedSpaceRole,
  members = [member({ role })],
  options: { currentUserId?: string; space?: SharedSpaceResponseDto } = {},
) {
  mockAuthManager.user = { id: options.currentUserId ?? 'u1', isAdmin: false };
  const props: PageProps = {
    data: {
      space: options.space ?? space(),
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

  describe('member management by editors', () => {
    const management = (o: Partial<NonNullable<SharedSpaceResponseDto['memberManagement']>> = {}) => ({
      editorsCanAddMembers: null,
      editorsCanChangeRoles: null,
      serverEditorsCanAddMembers: false,
      serverEditorsCanChangeRoles: false,
      canAddMembers: false,
      canChangeRoles: false,
      ...o,
    });
    const roster = [
      member({ userId: 'o1', role: SharedSpaceRole.Owner, name: 'Olivia' }),
      member({ userId: 'u1', role: SharedSpaceRole.Editor, name: 'Me' }),
      member({ userId: 'u2', role: SharedSpaceRole.Viewer, name: 'Ann' }),
    ];

    it('shows the permission settings to an owner, labelled with the server default', () => {
      renderPage(SharedSpaceRole.Owner, [member(), member({ userId: 'u2', role: SharedSpaceRole.Editor })], {
        space: space({ memberManagement: management({ canAddMembers: true, canChangeRoles: true }) }),
      });
      expect(screen.getByTestId('member-permission-settings')).toBeInTheDocument();
      const triggers = within(screen.getByTestId('member-permission-settings'))
        .getAllByTestId('role-select')
        .map((select) => within(select).getAllByRole('button')[0]);
      expect(triggers).toHaveLength(2);
      for (const trigger of triggers) {
        expect(trigger).toHaveTextContent('spaces_member_permission_server_default_off');
      }
    });

    it('gives an owner today’s screen and no settings when memberManagement is absent', () => {
      renderPage(SharedSpaceRole.Owner, [member(), member({ userId: 'u2', role: SharedSpaceRole.Editor })]);
      expect(screen.queryByTestId('member-permission-settings')).not.toBeInTheDocument();
      expect(screen.getByTestId('members-invite')).toBeInTheDocument();
      expect(screen.getAllByTestId('role-select')).toHaveLength(1);
    });

    it('shows the invite button to an editor who can add members, but no settings', () => {
      renderPage(SharedSpaceRole.Editor, roster, {
        space: space({ memberManagement: management({ canAddMembers: true }) }),
      });
      expect(screen.getByTestId('members-invite')).toBeInTheDocument();
      expect(screen.queryByTestId('member-permission-settings')).not.toBeInTheDocument();
      expect(screen.queryByTestId('role-select')).not.toBeInTheDocument();
    });

    it('shows the role select to an editor who can change roles only for non-owner, non-self rows, without remove', () => {
      renderPage(SharedSpaceRole.Editor, roster, {
        space: space({ memberManagement: management({ canChangeRoles: true }) }),
      });
      expect(screen.queryByTestId('members-invite')).not.toBeInTheDocument();
      const selects = screen.getAllByTestId('role-select');
      expect(selects).toHaveLength(1);
      expect(within(selects[0]).getAllByRole('button')[0]).toHaveTextContent('role_viewer');
      expect(screen.queryByTestId('role-option-remove')).not.toBeInTheDocument();
    });

    it('shows neither control to a plain editor', () => {
      renderPage(SharedSpaceRole.Editor, roster, { space: space({ memberManagement: management() }) });
      expect(screen.queryByTestId('members-invite')).not.toBeInTheDocument();
      expect(screen.queryByTestId('role-select')).not.toBeInTheDocument();
    });

    it('shows neither control to a viewer', () => {
      const viewerRoster = [
        member({ userId: 'o1', role: SharedSpaceRole.Owner, name: 'Olivia' }),
        member({ userId: 'u1', role: SharedSpaceRole.Viewer, name: 'Me' }),
      ];
      renderPage(SharedSpaceRole.Viewer, viewerRoster, { space: space({ memberManagement: management() }) });
      expect(screen.queryByTestId('members-invite')).not.toBeInTheDocument();
      expect(screen.queryByTestId('role-select')).not.toBeInTheDocument();
    });

    it('gives an editor nothing when memberManagement is absent (older server)', () => {
      renderPage(SharedSpaceRole.Editor, roster);
      expect(screen.queryByTestId('members-invite')).not.toBeInTheDocument();
      expect(screen.queryByTestId('role-select')).not.toBeInTheDocument();
      expect(screen.queryByTestId('member-permission-settings')).not.toBeInTheDocument();
    });

    it('saves a changed setting through updateSpace and revalidates', async () => {
      renderPage(SharedSpaceRole.Owner, [member(), member({ userId: 'u2', role: SharedSpaceRole.Editor })], {
        space: space({ memberManagement: management({ canAddMembers: true, canChangeRoles: true }) }),
      });
      const { invalidateAll } = await import('$app/navigation');
      const settings = screen.getByTestId('member-permission-settings');
      await fireEvent.click(within(settings).getAllByTestId('role-option-on')[0]);
      await waitFor(() =>
        expect(sdkMock.updateSpace).toHaveBeenCalledWith({
          id: 's1',
          sharedSpaceUpdateDto: { editorsCanAddMembers: true },
        }),
      );
      await waitFor(() => expect(invalidateAll).toHaveBeenCalled());
    });
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
