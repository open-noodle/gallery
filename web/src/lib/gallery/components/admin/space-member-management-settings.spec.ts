import type { AdminConfigServerDto } from '@immich/sdk';
import { fireEvent, render, screen } from '@testing-library/svelte';
import SpaceMemberManagementSettings from '$lib/gallery/components/admin/space-member-management-settings.svelte';

const makeServer = () =>
  ({ spaceEditorsCanAddMembers: false, spaceEditorsCanChangeRoles: false }) as AdminConfigServerDto;

describe('SpaceMemberManagementSettings', () => {
  it('renders both switches with their titles', () => {
    render(SpaceMemberManagementSettings, { server: makeServer(), disabled: false });
    expect(screen.getByText('admin.server_space_editors_can_add_members')).toBeInTheDocument();
    expect(screen.getByText('admin.server_space_editors_can_change_roles')).toBeInTheDocument();
    expect(screen.getAllByRole('switch')).toHaveLength(2);
  });

  it('updates the bound object when toggled', async () => {
    const server = makeServer();
    render(SpaceMemberManagementSettings, { server, disabled: false });
    const [add, roles] = screen.getAllByRole('switch');
    await fireEvent.click(add);
    expect(server.spaceEditorsCanAddMembers).toBe(true);
    expect(server.spaceEditorsCanChangeRoles).toBe(false);
    await fireEvent.click(roles);
    expect(server.spaceEditorsCanChangeRoles).toBe(true);
  });

  it('disables both switches when disabled', () => {
    render(SpaceMemberManagementSettings, { server: makeServer(), disabled: true });
    for (const s of screen.getAllByRole('switch')) {
      expect(s).toBeDisabled();
    }
  });
});
