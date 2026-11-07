import TestWrapper from '#lib/components/TestWrapper.svelte';
import { sdkMock } from '#lib/gallery/__mocks__/sdk.mock.ts';
import { showAddSpaceMembersModal } from '#lib/gallery/spaces/add-space-members.ts';
import { SharedSpaceRole, type SharedSpaceMemberResponseDto, type SharedSpaceResponseDto } from '@immich/sdk';
import { modalManager } from '@immich/ui';
import type { Component } from 'svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page, userEvent } from 'vitest/browser';
import MembersPage from './+page.svelte';

const { mockAuthManager } = vi.hoisted(() => ({ mockAuthManager: { user: { id: 'u1', isAdmin: false } } }));
vi.mock('#lib/managers/auth-manager.svelte.js', () => ({ authManager: mockAuthManager }));
vi.mock('$app/navigation', async () => ({
  ...(await import('#test/unit/mocks/app-navigation.ts')),
  goto: vi.fn(),
  invalidateAll: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('#lib/gallery/spaces/add-space-members.js', () => ({ showAddSpaceMembersModal: vi.fn() }));

// The page drives @immich/ui's modalManager (invite modal + remove-confirm dialog). It also renders
// the @immich/ui <Select> for role changes, whose real bits-ui listbox is portalled and opened through
// pointer gestures (the SpaceMembersModal spec asserts the trigger but never opens it either).
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

  it('lists members', async () => {
    await renderPage(SharedSpaceRole.Owner, [
      member(),
      member({ userId: 'u2', role: SharedSpaceRole.Editor, name: 'Ann' }),
    ]);
    await expect.element(page.getByText('Me')).toBeInTheDocument();
    await expect.element(page.getByText('Ann')).toBeInTheDocument();
  });

  it('shows the invite button to an owner', async () => {
    await renderPage(SharedSpaceRole.Owner);
    await expect.element(page.getByTestId('members-invite')).toBeInTheDocument();
  });

  it('hides the invite button from a non-owner', async () => {
    await renderPage(SharedSpaceRole.Viewer);
    await expect.element(page.getByTestId('members-invite')).not.toBeInTheDocument();
  });

  it('does not render the activity feed (moved to the Activity tab)', async () => {
    await renderPage(SharedSpaceRole.Owner);
    await expect.element(page.getByTestId('members-activity')).not.toBeInTheDocument();
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

    it('shows the permission settings to an owner, labelled with the server default', async () => {
      await renderPage(SharedSpaceRole.Owner, [member(), member({ userId: 'u2', role: SharedSpaceRole.Editor })], {
        space: space({ memberManagement: management({ canAddMembers: true, canChangeRoles: true }) }),
      });
      await expect.element(page.getByTestId('member-permission-settings')).toBeInTheDocument();
      const selects = page.getByTestId('member-permission-settings').getByTestId('role-select').all();
      expect(selects).toHaveLength(2);
      for (const select of selects) {
        await expect
          .element(select.getByRole('button').first())
          .toHaveTextContent('spaces_member_permission_server_default_off');
      }
    });

    it('gives an owner today’s screen and no settings when memberManagement is absent', async () => {
      await renderPage(SharedSpaceRole.Owner, [member(), member({ userId: 'u2', role: SharedSpaceRole.Editor })]);
      await expect.element(page.getByTestId('member-permission-settings')).not.toBeInTheDocument();
      await expect.element(page.getByTestId('members-invite')).toBeInTheDocument();
      expect(page.getByTestId('role-select').elements()).toHaveLength(1);
    });

    it('shows the invite button to an editor who can add members, but no settings', async () => {
      await renderPage(SharedSpaceRole.Editor, roster, {
        space: space({ memberManagement: management({ canAddMembers: true }) }),
      });
      await expect.element(page.getByTestId('members-invite')).toBeInTheDocument();
      await expect.element(page.getByTestId('member-permission-settings')).not.toBeInTheDocument();
      await expect.element(page.getByTestId('role-select')).not.toBeInTheDocument();
    });

    it('shows the role select to an editor who can change roles only for non-owner, non-self rows, without remove', async () => {
      await renderPage(SharedSpaceRole.Editor, roster, {
        space: space({ memberManagement: management({ canChangeRoles: true }) }),
      });
      await expect.element(page.getByTestId('members-invite')).not.toBeInTheDocument();
      const selects = page.getByTestId('role-select').all();
      expect(selects).toHaveLength(1);
      await expect.element(selects[0].getByRole('button').first()).toHaveTextContent('role_viewer');
      await expect.element(page.getByTestId('role-option-remove')).not.toBeInTheDocument();
    });

    it('shows neither control to a plain editor', async () => {
      await renderPage(SharedSpaceRole.Editor, roster, { space: space({ memberManagement: management() }) });
      await expect.element(page.getByTestId('members-invite')).not.toBeInTheDocument();
      await expect.element(page.getByTestId('role-select')).not.toBeInTheDocument();
    });

    it('shows neither control to a viewer', async () => {
      const viewerRoster = [
        member({ userId: 'o1', role: SharedSpaceRole.Owner, name: 'Olivia' }),
        member({ userId: 'u1', role: SharedSpaceRole.Viewer, name: 'Me' }),
      ];
      await renderPage(SharedSpaceRole.Viewer, viewerRoster, { space: space({ memberManagement: management() }) });
      await expect.element(page.getByTestId('members-invite')).not.toBeInTheDocument();
      await expect.element(page.getByTestId('role-select')).not.toBeInTheDocument();
    });

    it('gives an editor nothing when memberManagement is absent (older server)', async () => {
      await renderPage(SharedSpaceRole.Editor, roster);
      await expect.element(page.getByTestId('members-invite')).not.toBeInTheDocument();
      await expect.element(page.getByTestId('role-select')).not.toBeInTheDocument();
      await expect.element(page.getByTestId('member-permission-settings')).not.toBeInTheDocument();
    });

    it('saves a changed setting through updateSpace and revalidates', async () => {
      await renderPage(SharedSpaceRole.Owner, [member(), member({ userId: 'u2', role: SharedSpaceRole.Editor })], {
        space: space({ memberManagement: management({ canAddMembers: true, canChangeRoles: true }) }),
      });
      const { invalidateAll } = await import('$app/navigation');
      const settings = page.getByTestId('member-permission-settings');
      await userEvent.click(settings.getByTestId('role-option-on').elements()[0]);
      await vi.waitFor(() =>
        expect(sdkMock.updateSpace).toHaveBeenCalledWith({
          id: 's1',
          sharedSpaceUpdateDto: { editorsCanAddMembers: true },
        }),
      );
      await vi.waitFor(() => expect(invalidateAll).toHaveBeenCalled());
    });
  });

  describe('role Select vs RoleBadge rendering', () => {
    it('shows a role Select for a non-owner member but a RoleBadge for the owner’s own row when current user is owner', async () => {
      await renderPage(SharedSpaceRole.Owner, [
        member(), // u1 = current user (owner)
        member({ userId: 'u2', role: SharedSpaceRole.Editor, name: 'Ann' }),
      ]);

      // Exactly one editable Select trigger — for the non-owner member.
      const selects = page.getByTestId('role-select').elements();
      expect(selects).toHaveLength(1);
      // The trigger reflects the member's current role and exposes the listbox affordance.
      const trigger = selects[0].querySelector('button[aria-haspopup="listbox"]');
      expect(trigger).not.toBeNull();
      await expect.element(page.elementLocator(trigger!)).toHaveTextContent('role_editor');

      // The owner's own row shows a static badge, not a Select.
      await expect.element(page.getByTestId('role-badge-owner')).toBeInTheDocument();
      // The non-owner row has no badge (it has the Select instead).
      await expect.element(page.getByTestId('role-badge-editor')).not.toBeInTheDocument();
    });

    it('shows only RoleBadges (no Select) for every row when the current user is a non-owner', async () => {
      await renderPage(
        SharedSpaceRole.Viewer,
        [
          member(), // owner
          member({ userId: 'u2', role: SharedSpaceRole.Viewer, name: 'Ann' }), // current user (viewer)
        ],
        { currentUserId: 'u2' },
      );

      await expect.element(page.getByTestId('role-select')).not.toBeInTheDocument();
      await expect.element(page.getByTestId('role-badge-owner')).toBeInTheDocument();
      await expect.element(page.getByTestId('role-badge-viewer')).toBeInTheDocument();
    });
  });

  describe('change role', () => {
    it('selecting Viewer updates the member role and revalidates', async () => {
      await renderPage(SharedSpaceRole.Owner, [
        member(),
        member({ userId: 'u2', role: SharedSpaceRole.Editor, name: 'Ann' }),
      ]);
      const { invalidateAll } = await import('$app/navigation');

      await userEvent.click(page.getByTestId(`role-option-${SharedSpaceRole.Viewer}`));

      expect(sdkMock.updateMember).toHaveBeenCalledWith({
        id: 's1',
        userId: 'u2',
        sharedSpaceMemberUpdateDto: { role: SharedSpaceRole.Viewer },
      });
      await vi.waitFor(() => expect(invalidateAll).toHaveBeenCalled());
      expect(sdkMock.removeMember).not.toHaveBeenCalled();
    });

    it('selecting Editor updates the member role and revalidates', async () => {
      await renderPage(SharedSpaceRole.Owner, [
        member(),
        member({ userId: 'u2', role: SharedSpaceRole.Viewer, name: 'Ann' }),
      ]);
      const { invalidateAll } = await import('$app/navigation');

      await userEvent.click(page.getByTestId(`role-option-${SharedSpaceRole.Editor}`));

      expect(sdkMock.updateMember).toHaveBeenCalledWith({
        id: 's1',
        userId: 'u2',
        sharedSpaceMemberUpdateDto: { role: SharedSpaceRole.Editor },
      });
      await vi.waitFor(() => expect(invalidateAll).toHaveBeenCalled());
    });
  });

  describe('remove member', () => {
    it('confirms then removes the member and revalidates', async () => {
      vi.mocked(modalManager.showDialog as (...args: unknown[]) => Promise<boolean>).mockResolvedValue(true);
      await renderPage(SharedSpaceRole.Owner, [
        member(),
        member({ userId: 'u2', role: SharedSpaceRole.Editor, name: 'Ann' }),
      ]);
      const { invalidateAll } = await import('$app/navigation');

      await userEvent.click(page.getByTestId('role-option-remove'));

      await vi.waitFor(() => expect(modalManager.showDialog).toHaveBeenCalled());
      await vi.waitFor(() => expect(sdkMock.removeMember).toHaveBeenCalledWith({ id: 's1', userId: 'u2' }));
      await vi.waitFor(() => expect(invalidateAll).toHaveBeenCalled());
      expect(sdkMock.updateMember).not.toHaveBeenCalled();
    });

    it('does NOT remove the member when the confirm dialog is dismissed', async () => {
      vi.mocked(modalManager.showDialog as (...args: unknown[]) => Promise<boolean>).mockResolvedValue(false);
      await renderPage(SharedSpaceRole.Owner, [
        member(),
        member({ userId: 'u2', role: SharedSpaceRole.Editor, name: 'Ann' }),
      ]);

      await userEvent.click(page.getByTestId('role-option-remove'));

      await vi.waitFor(() => expect(modalManager.showDialog).toHaveBeenCalled());
      expect(sdkMock.removeMember).not.toHaveBeenCalled();
    });
  });

  describe('invite', () => {
    it('opens the add-member modal and revalidates when it added someone', async () => {
      vi.mocked(showAddSpaceMembersModal).mockResolvedValue([member({ userId: 'u3' })]);
      await renderPage(SharedSpaceRole.Owner, [
        member(),
        member({ userId: 'u2', role: SharedSpaceRole.Editor, name: 'Ann' }),
      ]);
      const { invalidateAll } = await import('$app/navigation');

      await userEvent.click(page.getByTestId('members-invite'));

      await vi.waitFor(() => expect(showAddSpaceMembersModal).toHaveBeenCalledWith('s1', ['u1', 'u2']));
      await vi.waitFor(() => expect(invalidateAll).toHaveBeenCalled());
    });

    it('does not revalidate when the add-member modal added no one', async () => {
      vi.mocked(showAddSpaceMembersModal).mockResolvedValue([]);
      await renderPage(SharedSpaceRole.Owner);
      const { invalidateAll } = await import('$app/navigation');

      await userEvent.click(page.getByTestId('members-invite'));

      await vi.waitFor(() => expect(showAddSpaceMembersModal).toHaveBeenCalled());
      expect(invalidateAll).not.toHaveBeenCalled();
    });
  });
});
