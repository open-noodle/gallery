import TestWrapper from '$lib/components/TestWrapper.svelte';
import SpaceMembersPanel from '$lib/components/spaces/space-members-panel.svelte';
import { Role, type SharedSpaceMemberResponseDto, type SharedSpaceResponseDto } from '@immich/sdk';
import { fireEvent, render, screen } from '@testing-library/svelte';
import type { Component } from 'svelte';

function renderPanel(props: Record<string, unknown>) {
  return render(TestWrapper as Component<{ component: typeof SpaceMembersPanel; componentProps: typeof props }>, {
    component: SpaceMembersPanel,
    componentProps: props,
  });
}

const makeMember = (overrides: Partial<SharedSpaceMemberResponseDto> = {}): SharedSpaceMemberResponseDto => ({
  userId: 'user-1',
  name: 'Alice',
  email: 'alice@test.com',
  role: Role.Editor,
  joinedAt: '2026-01-01T00:00:00.000Z',
  showInTimeline: false,
  contributionCount: 0,
  ...overrides,
});

const makeSpace = (overrides: Partial<SharedSpaceResponseDto> = {}): SharedSpaceResponseDto => ({
  id: 'space-1',
  name: 'Family Photos',
  description: 'Our family memories',
  createdById: 'user-1',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  memberCount: 3,
  assetCount: 42,
  thumbnailAssetId: null,
  recentAssetIds: [],
  recentAssetThumbhashes: [],
  lastActivityAt: null,
  newAssetCount: 0,
  lastContributor: null,
  members: [],
  ...overrides,
});

describe('SpaceMembersPanel', () => {
  const defaultProps = {
    space: makeSpace(),
    members: [
      makeMember({ userId: 'u1', name: 'Alice', role: Role.Owner }),
      makeMember({ userId: 'u2', name: 'Bob', role: Role.Editor }),
      makeMember({ userId: 'u3', name: 'Carol', role: Role.Viewer }),
    ],
    currentUserId: 'u1',
    isOwner: true,
    open: true,
    onClose: vi.fn(),
    onMembersChanged: vi.fn(),
  };

  it('should have translate-x-full class when open is false', () => {
    renderPanel({ ...defaultProps, open: false });
    const panel = screen.getByTestId('members-panel');
    expect(panel.className).toContain('translate-x-full');
  });

  it('should have translate-x-0 class when open is true', () => {
    renderPanel({ ...defaultProps, open: true });
    const panel = screen.getByTestId('members-panel');
    expect(panel.className).toContain('translate-x-0');
  });

  it('should show "Members (N)" in header with correct count', () => {
    renderPanel({ ...defaultProps });
    const header = screen.getByTestId('panel-header');
    expect(header).toHaveTextContent('Members (3)');
  });

  it('should call onClose when close button is clicked', async () => {
    const onClose = vi.fn();
    renderPanel({ ...defaultProps, onClose });
    const closeButton = screen.getByTestId('panel-close');
    await fireEvent.click(closeButton);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('should show add member button when isOwner is true', () => {
    renderPanel({ ...defaultProps, isOwner: true });
    expect(screen.getByTestId('add-member-button')).toBeInTheDocument();
  });

  it('should NOT show add member button when isOwner is false', () => {
    renderPanel({ ...defaultProps, isOwner: false });
    expect(screen.queryByTestId('add-member-button')).not.toBeInTheDocument();
  });

  it('should render all members passed via props', () => {
    renderPanel({ ...defaultProps });
    const memberList = screen.getByTestId('member-list');
    expect(memberList).toHaveTextContent('Alice');
    expect(memberList).toHaveTextContent('Bob');
    expect(memberList).toHaveTextContent('Carol');
  });

  it('should show contribution count for members with contributions', () => {
    const members = [makeMember({ userId: 'u1', name: 'Alice', role: Role.Owner, contributionCount: 15 })];
    renderPanel({ ...defaultProps, members });
    expect(screen.getByTestId('member-list')).toHaveTextContent('15 photos added');
  });

  it('should show "No photos added yet" for members with 0 contributions', () => {
    const members = [makeMember({ userId: 'u1', name: 'Alice', role: Role.Owner, contributionCount: 0 })];
    renderPanel({ ...defaultProps, members });
    expect(screen.getByTestId('member-list')).toHaveTextContent('No photos added yet');
  });
});
