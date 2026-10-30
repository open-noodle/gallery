import type { SharedSpaceResponseDto } from '@immich/sdk';
import { fireEvent, render, screen, within } from '@testing-library/svelte';
import SpaceMemberPermissionSettings from '$lib/gallery/components/spaces/space-member-permission-settings.svelte';

// The real @immich/ui Select wraps a bits-ui listbox that cannot be driven in jsdom; use the same stand-in the
// members page spec uses (trigger named after the selected option, one click target per option).
vi.mock('@immich/ui', async (importOriginal) => {
  const original = await importOriginal<typeof import('@immich/ui')>();
  const { default: MockSelect } =
    await import('../../../../routes/(user)/spaces/[spaceId]/members/mock-select.test-wrapper.svelte');
  return { ...original, Select: MockSelect };
});

const makeSpace = (management: Partial<NonNullable<SharedSpaceResponseDto['memberManagement']>> = {}) =>
  ({
    id: 's1',
    memberManagement: {
      editorsCanAddMembers: null,
      editorsCanChangeRoles: null,
      serverEditorsCanAddMembers: false,
      serverEditorsCanChangeRoles: true,
      canAddMembers: true,
      canChangeRoles: true,
      ...management,
    },
  }) as SharedSpaceResponseDto;

describe('SpaceMemberPermissionSettings', () => {
  it('labels the server default with the server value', () => {
    render(SpaceMemberPermissionSettings, { space: makeSpace(), onChange: vi.fn() });
    const [add, roles] = screen.getAllByTestId('role-select');
    expect(within(add).getAllByRole('button')[0]).toHaveTextContent('spaces_member_permission_server_default_off');
    expect(within(roles).getAllByRole('button')[0]).toHaveTextContent('spaces_member_permission_server_default_on');
  });

  it('shows the explicit override', () => {
    render(SpaceMemberPermissionSettings, { space: makeSpace({ editorsCanAddMembers: true }), onChange: vi.fn() });
    const [add] = screen.getAllByTestId('role-select');
    expect(within(add).getAllByRole('button')[0]).toHaveTextContent('spaces_member_permission_on');
  });

  it('sends true for On, false for Off and null for the server default', async () => {
    const onChange = vi.fn().mockResolvedValue(undefined);
    render(SpaceMemberPermissionSettings, { space: makeSpace({ editorsCanAddMembers: true }), onChange });
    const [add, roles] = screen.getAllByTestId('role-select');
    await fireEvent.click(within(add).getByTestId('role-option-on'));
    expect(onChange).toHaveBeenLastCalledWith({ editorsCanAddMembers: true });
    await fireEvent.click(within(add).getByTestId('role-option-off'));
    expect(onChange).toHaveBeenLastCalledWith({ editorsCanAddMembers: false });
    await fireEvent.click(within(add).getByTestId('role-option-default'));
    expect(onChange).toHaveBeenLastCalledWith({ editorsCanAddMembers: null });
    await fireEvent.click(within(roles).getByTestId('role-option-off'));
    expect(onChange).toHaveBeenLastCalledWith({ editorsCanChangeRoles: false });
  });

  it('renders nothing when the server sent no memberManagement block', () => {
    render(SpaceMemberPermissionSettings, {
      space: { id: 's1' } as SharedSpaceResponseDto,
      onChange: vi.fn(),
    });
    expect(screen.queryByTestId('member-permission-settings')).not.toBeInTheDocument();
  });
});
