import type { SharedSpaceMemberResponseDto, SharedSpaceResponseDto } from '@immich/sdk';
import { SharedSpaceRole, UserAvatarColor } from '@immich/sdk';
import { modalManager, toastManager } from '@immich/ui';
import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { sdkMock } from '$lib/__mocks__/sdk.mock';
import SpaceLayout from './+layout.svelte';

const { mockPage, mockAuthManager, gotoMock, invalidateAllMock } = vi.hoisted(() => ({
  mockPage: { url: new URL('https://gallery.test/spaces/s1'), route: { id: '/(user)/spaces/[spaceId]' } },
  mockAuthManager: { user: { id: 'u1', isAdmin: false } },
  gotoMock: vi.fn().mockResolvedValue(undefined),
  invalidateAllMock: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('$app/state', () => ({ page: mockPage }));
vi.mock('$app/navigation', () => ({ goto: gotoMock, invalidateAll: invalidateAllMock }));
vi.mock('$lib/managers/auth-manager.svelte', () => ({ authManager: mockAuthManager }));

// The overflow handlers call into @immich/ui's modalManager (confirm dialogs, link-libraries modal)
// and toastManager — mock those while keeping the real Button/IconButton/Icon/TooltipProvider so the
// rendered overflow menu and its MenuOptions stay interactive (mirrors space-people-page.spec).
vi.mock('@immich/ui', async (importOriginal) => {
  const original = await importOriginal<typeof import('@immich/ui')>();
  return {
    ...original,
    modalManager: { show: vi.fn(), showDialog: vi.fn() },
    toastManager: { danger: vi.fn(), primary: vi.fn(), success: vi.fn(), warning: vi.fn() },
  };
});

// The real UserPageLayout mounts the NavigationBar (which needs a Tooltip provider); the shared
// mock renders the leading/buttons/children snippets inside a TooltipProvider — matching the other
// space page specs — so the app-bar testids are reachable.
vi.mock('$lib/components/layouts/UserPageLayout.svelte', async () => {
  const { default: MockComponent } = await import('$lib/components/spaces/mock-user-page-layout.test-wrapper.svelte');
  return { default: MockComponent };
});

const space = (o: Partial<SharedSpaceResponseDto> = {}): SharedSpaceResponseDto =>
  ({
    id: 's1',
    name: 'Trip',
    assetCount: 35,
    memberCount: 1,
    faceRecognitionEnabled: false,
    hasPets: false,
    petsEnabled: false,
    ...o,
  }) as never;
const member = (o: Partial<SharedSpaceMemberResponseDto> = {}): SharedSpaceMemberResponseDto =>
  ({
    userId: 'u1',
    role: SharedSpaceRole.Owner,
    name: 'Me',
    email: 'me@x.io',
    showInTimeline: true,
    sharePersonMetadata: true,
    ...o,
  }) as never;

function renderLayout(
  role: SharedSpaceRole,
  options: {
    isAdmin?: boolean;
    space?: SharedSpaceResponseDto;
    member?: SharedSpaceMemberResponseDto;
    linkedAlbums?: unknown[];
  } = {},
) {
  const { isAdmin = false } = options;
  mockAuthManager.user = { id: 'u1', isAdmin };
  // `children` is optional; the layout renders `{@render children?.()}`, so omitting it is fine.
  return render(SpaceLayout, {
    data: {
      space: options.space ?? space(),
      members: [options.member ?? member({ role })],
      linkedAlbums: options.linkedAlbums ?? [],
    } as never,
  });
}

// The overflow lives in the shell layout's app bar; open it, then click a MenuOption by its label.
// `svelte-i18n` returns raw keys in the test setup, so the labels match the i18n keys verbatim.
async function openOverflow() {
  const overflow = screen.getByTestId('space-overflow');
  // The trigger is the IconButton inside the overflow wrapper, labelled with the `more` key.
  await fireEvent.click(within(overflow).getByLabelText('more'));
}

async function clickOverflowOption(label: string) {
  await openOverflow();
  // Scoped to the overflow: the hero's ✎ menu also renders a "spaces_edit" option (SpaceHero's
  // ButtonContextMenu keeps its content mounted, just visually hidden, when closed), so an
  // unscoped screen-wide query is ambiguous once both menus offer the same label.
  const overflow = screen.getByTestId('space-overflow');
  await fireEvent.click(await within(overflow).findByText(label));
}

describe('space [spaceId] +layout.svelte', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    invalidateAllMock.mockResolvedValue(undefined);
    gotoMock.mockResolvedValue(undefined);
    mockPage.url = new URL('https://gallery.test/spaces/s1');
    const { spaceUiManager } = await import('$lib/managers/space-ui-manager.svelte');
    spaceUiManager.reset();
  });

  it('shows ＋ Add photos and the overflow for an editor', () => {
    renderLayout(SharedSpaceRole.Editor);
    expect(screen.getByTestId('space-add-photos')).toBeInTheDocument();
    expect(screen.getByTestId('space-overflow')).toBeInTheDocument();
  });

  it('hides ＋ Add photos for a viewer', () => {
    renderLayout(SharedSpaceRole.Viewer);
    expect(screen.queryByTestId('space-add-photos')).not.toBeInTheDocument();
  });

  it('records an add-photos intent and navigates to the Photos route when ＋ is clicked', async () => {
    const { spaceUiManager } = await import('$lib/managers/space-ui-manager.svelte');
    mockPage.url = new URL('https://gallery.test/spaces/s1/members');
    renderLayout(SharedSpaceRole.Editor);
    screen.getByTestId('space-add-photos').click();
    expect(spaceUiManager.intent).toBe('add-assets');
    expect(gotoMock).toHaveBeenCalledWith('/spaces/s1');
  });

  it('records an add-photos intent but does NOT navigate when already on the Photos base route', async () => {
    const { spaceUiManager } = await import('$lib/managers/space-ui-manager.svelte');
    mockPage.url = new URL('https://gallery.test/spaces/s1');
    renderLayout(SharedSpaceRole.Editor);
    screen.getByTestId('space-add-photos').click();
    expect(spaceUiManager.intent).toBe('add-assets');
    expect(gotoMock).not.toHaveBeenCalled();
  });

  describe('overflow handlers', () => {
    it('handleToggleTimeline: hides the space from the timeline and revalidates', async () => {
      renderLayout(SharedSpaceRole.Owner, { member: member({ role: SharedSpaceRole.Owner, showInTimeline: true }) });

      await clickOverflowOption('spaces_hide_from_timeline');

      expect(sdkMock.updateMemberTimeline).toHaveBeenCalledWith({
        id: 's1',
        sharedSpaceMemberTimelineDto: { showInTimeline: false },
      });
      await waitFor(() => expect(invalidateAllMock).toHaveBeenCalled());
    });

    it('handleToggleTimeline: shows the space on the timeline when currently hidden', async () => {
      renderLayout(SharedSpaceRole.Owner, { member: member({ role: SharedSpaceRole.Owner, showInTimeline: false }) });

      await clickOverflowOption('spaces_show_on_timeline');

      expect(sdkMock.updateMemberTimeline).toHaveBeenCalledWith({
        id: 's1',
        sharedSpaceMemberTimelineDto: { showInTimeline: true },
      });
      await waitFor(() => expect(invalidateAllMock).toHaveBeenCalled());
    });

    it('handleTogglePersonMetadataSharing: stops sharing person metadata and revalidates', async () => {
      renderLayout(SharedSpaceRole.Owner, {
        member: member({ role: SharedSpaceRole.Owner, sharePersonMetadata: true }),
      });

      await clickOverflowOption('spaces_stop_sharing_person_metadata');

      expect(sdkMock.updateMemberPreferences).toHaveBeenCalledWith({
        id: 's1',
        sharedSpaceMemberPreferencesDto: { sharePersonMetadata: false },
      });
      await waitFor(() => expect(invalidateAllMock).toHaveBeenCalled());
    });

    it('handleTogglePersonMetadataSharing: resumes sharing person metadata when currently off', async () => {
      renderLayout(SharedSpaceRole.Owner, {
        member: member({ role: SharedSpaceRole.Owner, sharePersonMetadata: false }),
      });

      await clickOverflowOption('spaces_share_person_metadata');

      expect(sdkMock.updateMemberPreferences).toHaveBeenCalledWith({
        id: 's1',
        sharedSpaceMemberPreferencesDto: { sharePersonMetadata: true },
      });
      await waitFor(() => expect(invalidateAllMock).toHaveBeenCalled());
    });

    it('handleDelete: removes the space and navigates to the spaces route when confirmed', async () => {
      vi.mocked(modalManager.showDialog).mockResolvedValue(true);
      renderLayout(SharedSpaceRole.Owner);

      await clickOverflowOption('spaces_delete');

      await waitFor(() => expect(sdkMock.removeSpace).toHaveBeenCalledWith({ id: 's1' }));
      expect(gotoMock).toHaveBeenCalledWith('/spaces');
    });

    it('handleDelete: does nothing when the confirm dialog is dismissed', async () => {
      vi.mocked(modalManager.showDialog).mockResolvedValue(false);
      renderLayout(SharedSpaceRole.Owner);

      await clickOverflowOption('spaces_delete');

      await waitFor(() => expect(modalManager.showDialog).toHaveBeenCalled());
      expect(sdkMock.removeSpace).not.toHaveBeenCalled();
      expect(gotoMock).not.toHaveBeenCalled();
    });

    it('does NOT offer a hide/show people toggle in the overflow', async () => {
      renderLayout(SharedSpaceRole.Owner, { space: space({ faceRecognitionEnabled: false }) });

      await openOverflow();

      expect(screen.queryByText('spaces_show_people')).not.toBeInTheDocument();
      expect(screen.queryByText('spaces_hide_people')).not.toBeInTheDocument();
    });

    it('does NOT offer link-libraries in the overflow for an admin (moved to the Libraries tab)', async () => {
      renderLayout(SharedSpaceRole.Owner, { isAdmin: true });

      await openOverflow();

      expect(screen.queryByText('spaces_link_libraries')).not.toBeInTheDocument();
    });

    it('offers "Leave space" in the overflow for a non-owner member', async () => {
      renderLayout(SharedSpaceRole.Editor, { member: member({ role: SharedSpaceRole.Editor }) });

      await openOverflow();

      expect(screen.getByText('spaces_leave')).toBeInTheDocument();
    });

    it('does NOT offer "Leave space" to the owner', async () => {
      renderLayout(SharedSpaceRole.Owner, { member: member({ role: SharedSpaceRole.Owner }) });

      await openOverflow();

      expect(screen.queryByText('spaces_leave')).not.toBeInTheDocument();
    });

    it('handleLeave: removes the current user from the space and navigates to the spaces list when confirmed', async () => {
      vi.mocked(modalManager.showDialog).mockResolvedValue(true);
      renderLayout(SharedSpaceRole.Editor, { member: member({ role: SharedSpaceRole.Editor }) });

      await clickOverflowOption('spaces_leave');

      await waitFor(() => expect(sdkMock.removeMember).toHaveBeenCalledWith({ id: 's1', userId: 'u1' }));
      expect(gotoMock).toHaveBeenCalledWith('/spaces');
    });

    it('handleLeave: does nothing when the confirm dialog is dismissed', async () => {
      vi.mocked(modalManager.showDialog).mockResolvedValue(false);
      renderLayout(SharedSpaceRole.Editor, { member: member({ role: SharedSpaceRole.Editor }) });

      await clickOverflowOption('spaces_leave');

      await waitFor(() => expect(modalManager.showDialog).toHaveBeenCalled());
      expect(sdkMock.removeMember).not.toHaveBeenCalled();
      expect(gotoMock).not.toHaveBeenCalled();
    });

    it('handleLeave: uses the plain confirmation when the leaving member has no linked albums', async () => {
      vi.mocked(modalManager.showDialog).mockResolvedValue(false);
      renderLayout(SharedSpaceRole.Editor, {
        member: member({ role: SharedSpaceRole.Editor }),
        linkedAlbums: [{ addedById: 'someone-else' }],
      });

      await clickOverflowOption('spaces_leave');

      await waitFor(() =>
        expect(modalManager.showDialog).toHaveBeenCalledWith(
          expect.objectContaining({ prompt: 'spaces_leave_confirmation' }),
        ),
      );
    });

    it('handleLeave: warns that linked albums will be removed when the leaving member linked albums of their own (L16)', async () => {
      vi.mocked(modalManager.showDialog).mockResolvedValue(false);
      renderLayout(SharedSpaceRole.Editor, {
        member: member({ role: SharedSpaceRole.Editor }),
        linkedAlbums: [{ addedById: 'u1' }],
      });

      await clickOverflowOption('spaces_leave');

      await waitFor(() =>
        expect(modalManager.showDialog).toHaveBeenCalledWith(
          expect.objectContaining({ prompt: 'spaces_leave_confirmation_with_albums' }),
        ),
      );
    });

    it('handleBulkAddAssets: bulk-adds assets for an editor when confirmed', async () => {
      vi.mocked(modalManager.showDialog).mockResolvedValue(true);
      renderLayout(SharedSpaceRole.Editor, { member: member({ role: SharedSpaceRole.Editor }) });

      await clickOverflowOption('add_all_photos');

      await waitFor(() => expect(sdkMock.bulkAddAssets).toHaveBeenCalledWith({ id: 's1' }));
      expect(toastManager.success).toHaveBeenCalled();
    });

    it('handleBulkAddAssets: does nothing when the confirm dialog is dismissed', async () => {
      vi.mocked(modalManager.showDialog).mockResolvedValue(false);
      renderLayout(SharedSpaceRole.Editor, { member: member({ role: SharedSpaceRole.Editor }) });

      await clickOverflowOption('add_all_photos');

      await waitFor(() => expect(modalManager.showDialog).toHaveBeenCalled());
      expect(sdkMock.bulkAddAssets).not.toHaveBeenCalled();
    });

    it('handleTogglePets: toggles pet visibility for an owner when face recognition is on and pets exist', async () => {
      renderLayout(SharedSpaceRole.Owner, {
        space: space({ faceRecognitionEnabled: true, hasPets: true, petsEnabled: false }),
      });

      await clickOverflowOption('spaces_show_pets');

      expect(sdkMock.updateSpace).toHaveBeenCalledWith({
        id: 's1',
        sharedSpaceUpdateDto: { petsEnabled: true },
      });
      await waitFor(() => expect(invalidateAllMock).toHaveBeenCalled());
    });
  });

  it('renders the tab bar with badge counts when chrome is shown', () => {
    renderLayout(SharedSpaceRole.Owner);
    expect(screen.getByTestId('space-tabs')).toBeInTheDocument();
    expect(screen.getByTestId('space-tab-photos')).toHaveTextContent('35');
  });

  it('renders the cover (SpaceHero) when chrome is shown', () => {
    renderLayout(SharedSpaceRole.Owner);
    expect(screen.getByTestId('hero-title')).toHaveTextContent('Trip');
  });

  // #1028: a phone gives the space roughly 520 CSS px of page height. The tall cover alone eats
  // 220 of them, which — stacked with the app bar, tabs and the search header — left the results
  // grid a sliver. A search is a results view, so the cover steps down to its compact size the
  // moment results are on screen, before the reader scrolls at all.
  it('shrinks the cover to compact while the photos tab is showing search results', () => {
    mockPage.url = new URL('https://gallery.test/spaces/s1/photos?q=beach');
    renderLayout(SharedSpaceRole.Owner);
    expect(screen.getByTestId('space-hero').style.height).toBe('96px');
  });

  // The counterpart: browsing the space is a cover-first view, and must stay that way.
  it('keeps the cover tall on the photos tab when no search is running', () => {
    mockPage.url = new URL('https://gallery.test/spaces/s1/photos');
    renderLayout(SharedSpaceRole.Owner);
    expect(screen.getByTestId('space-hero').style.height).toBe('220px');
  });

  it('passes a per-space colored gradient to the cover derived from space.color', () => {
    renderLayout(SharedSpaceRole.Owner, { space: space({ color: UserAvatarColor.Pink }) });
    expect(screen.getByTestId('hero-gradient')).toHaveClass('from-pink-300', 'to-pink-500');
  });

  it('defers entirely to the child on a detail route — no nested shell chrome', () => {
    mockPage.url = new URL('https://gallery.test/spaces/s1/albums/al-1');
    renderLayout(SharedSpaceRole.Owner);
    // Detail pages render their OWN UserPageLayout; the shell must render bare children there,
    // otherwise the whole app nests inside itself.
    expect(screen.queryByTestId('space-tabs')).not.toBeInTheDocument();
    expect(screen.queryByTestId('space-add-photos')).not.toBeInTheDocument();
    expect(screen.queryByTestId('space-overflow')).not.toBeInTheDocument();
  });

  it('suppresses the app bar, tabs and cover when chrome is hidden (full-screen selection mode)', async () => {
    const { spaceUiManager } = await import('$lib/managers/space-ui-manager.svelte');
    spaceUiManager.setChromeHidden(true);
    renderLayout(SharedSpaceRole.Owner);
    expect(screen.queryByTestId('space-tabs')).not.toBeInTheDocument();
    expect(screen.queryByTestId('space-add-photos')).not.toBeInTheDocument();
    // The cover (SpaceHero) is gated by the same showChrome flag.
    expect(screen.queryByTestId('hero-title')).not.toBeInTheDocument();
  });

  describe('edit space', () => {
    it('offers Edit space to an owner', async () => {
      renderLayout(SharedSpaceRole.Owner);
      await openOverflow();
      // Scoped to the overflow: the hero's ✎ menu also offers "spaces_edit" for an owner/editor.
      expect(await within(screen.getByTestId('space-overflow')).findByText('spaces_edit')).toBeInTheDocument();
    });

    it('offers Edit space to an editor', async () => {
      renderLayout(SharedSpaceRole.Editor);
      await openOverflow();
      expect(await within(screen.getByTestId('space-overflow')).findByText('spaces_edit')).toBeInTheDocument();
    });

    it('does NOT offer Edit space to a viewer', async () => {
      renderLayout(SharedSpaceRole.Viewer);
      await openOverflow();
      expect(screen.queryByText('spaces_edit')).not.toBeInTheDocument();
    });

    it('opens the modal with the current space and revalidates after a saved edit', async () => {
      vi.mocked(modalManager.show).mockResolvedValue(true as never);
      renderLayout(SharedSpaceRole.Editor);

      await clickOverflowOption('spaces_edit');

      await waitFor(() => {
        expect(modalManager.show).toHaveBeenCalledWith(expect.anything(), {
          space: expect.objectContaining({ id: 's1' }),
        });
      });
      expect(invalidateAllMock).toHaveBeenCalled();
    });

    it('does not revalidate when the edit is cancelled', async () => {
      vi.mocked(modalManager.show).mockResolvedValue(undefined as never);
      renderLayout(SharedSpaceRole.Editor);

      await clickOverflowOption('spaces_edit');

      await waitFor(() => {
        expect(modalManager.show).toHaveBeenCalled();
      });
      expect(invalidateAllMock).not.toHaveBeenCalled();
    });
  });
});
