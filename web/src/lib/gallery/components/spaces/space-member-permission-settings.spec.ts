import SpaceMemberPermissionSettings from '#lib/gallery/components/spaces/space-member-permission-settings.svelte';
import type { SharedSpaceResponseDto } from '@immich/sdk';
import { expect } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';

// The real @immich/ui Select wraps a bits-ui listbox that is awkward to drive from a unit test; use the same stand-in the
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
  it('labels the server default with the server value', async () => {
    await render(SpaceMemberPermissionSettings, { space: makeSpace(), onChange: vi.fn() });
    const add = page.getByTestId('role-select').nth(0);
    const roles = page.getByTestId('role-select').nth(1);
    await expect
      .element(add.getByRole('button').first())
      .toHaveTextContent('spaces_member_permission_server_default_off');
    await expect
      .element(roles.getByRole('button').first())
      .toHaveTextContent('spaces_member_permission_server_default_on');
  });

  it('shows the explicit override', async () => {
    await render(SpaceMemberPermissionSettings, {
      space: makeSpace({ editorsCanAddMembers: true }),
      onChange: vi.fn(),
    });
    const add = page.getByTestId('role-select').nth(0);
    await expect.element(add.getByRole('button').first()).toHaveTextContent('spaces_member_permission_on');
  });

  it('sends true for On, false for Off and null for the server default', async () => {
    const onChange = vi.fn().mockResolvedValue(undefined);
    await render(SpaceMemberPermissionSettings, { space: makeSpace({ editorsCanAddMembers: true }), onChange });
    const add = page.getByTestId('role-select').nth(0);
    const roles = page.getByTestId('role-select').nth(1);
    await add.getByTestId('role-option-on').click();
    expect(onChange).toHaveBeenLastCalledWith({ editorsCanAddMembers: true });
    await add.getByTestId('role-option-off').click();
    expect(onChange).toHaveBeenLastCalledWith({ editorsCanAddMembers: false });
    await add.getByTestId('role-option-default').click();
    expect(onChange).toHaveBeenLastCalledWith({ editorsCanAddMembers: null });
    await roles.getByTestId('role-option-off').click();
    expect(onChange).toHaveBeenLastCalledWith({ editorsCanChangeRoles: false });
  });

  it('renders nothing when the server sent no memberManagement block', async () => {
    await render(SpaceMemberPermissionSettings, {
      space: { id: 's1' } as SharedSpaceResponseDto,
      onChange: vi.fn(),
    });
    expect(page.getByTestId('member-permission-settings').query()).toBeNull();
  });
});
