import SpaceMemberManagementSettings from '#lib/gallery/components/admin/space-member-management-settings.svelte';
import type { AdminConfigServerDto } from '@immich/sdk';
import { expect } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';

const makeServer = () =>
  ({ spaceEditorsCanAddMembers: false, spaceEditorsCanChangeRoles: false }) as AdminConfigServerDto;

describe('SpaceMemberManagementSettings', () => {
  it('renders both switches with their titles', async () => {
    await render(SpaceMemberManagementSettings, { server: makeServer(), disabled: false });
    await expect
      .element(page.getByText('admin.server_space_editors_can_add_members', { exact: true }))
      .toBeInTheDocument();
    await expect
      .element(page.getByText('admin.server_space_editors_can_change_roles', { exact: true }))
      .toBeInTheDocument();
    expect(page.getByRole('switch').elements()).toHaveLength(2);
  });

  it('updates the bound object when toggled', async () => {
    const server = makeServer();
    await render(SpaceMemberManagementSettings, { server, disabled: false });
    const switches = page.getByRole('switch');
    await switches.nth(0).click();
    expect(server.spaceEditorsCanAddMembers).toBe(true);
    expect(server.spaceEditorsCanChangeRoles).toBe(false);
    await switches.nth(1).click();
    expect(server.spaceEditorsCanChangeRoles).toBe(true);
  });

  it('disables both switches when disabled', async () => {
    await render(SpaceMemberManagementSettings, { server: makeServer(), disabled: true });
    const switches = page.getByRole('switch');
    expect(switches.elements()).toHaveLength(2);
    await expect.element(switches.nth(0)).toBeDisabled();
    await expect.element(switches.nth(1)).toBeDisabled();
  });
});
