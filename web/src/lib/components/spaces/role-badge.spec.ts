import RoleBadge from '#lib/components/spaces/role-badge.svelte';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';

describe('RoleBadge', () => {
  it('should render owner badge with data-testid', async () => {
    await render(RoleBadge, { role: 'owner' });
    expect(page.getByTestId('role-badge-owner').element()).toBeInTheDocument();
  });

  it('should render editor badge with data-testid', async () => {
    await render(RoleBadge, { role: 'editor' });
    expect(page.getByTestId('role-badge-editor').element()).toBeInTheDocument();
  });

  it('should render viewer badge with data-testid', async () => {
    await render(RoleBadge, { role: 'viewer' });
    expect(page.getByTestId('role-badge-viewer').element()).toBeInTheDocument();
  });

  it('should display translated label for owner', async () => {
    await render(RoleBadge, { role: 'owner' });
    expect(page.getByTestId('role-badge-owner').element()).toMatchTextContent('owner');
  });

  it('should display translated label for editor', async () => {
    await render(RoleBadge, { role: 'editor' });
    expect(page.getByTestId('role-badge-editor').element()).toMatchTextContent('role_editor');
  });

  it('should display translated label for viewer', async () => {
    await render(RoleBadge, { role: 'viewer' });
    expect(page.getByTestId('role-badge-viewer').element()).toMatchTextContent('role_viewer');
  });

  it('should apply filled styling for owner role', async () => {
    await render(RoleBadge, { role: 'owner' });
    const badge = page.getByTestId('role-badge-owner').element();
    expect(badge.className).toContain('bg-primary');
    expect(badge.className).toContain('text-white');
  });

  it('should apply outlined styling for editor role', async () => {
    await render(RoleBadge, { role: 'editor' });
    const badge = page.getByTestId('role-badge-editor').element();
    expect(badge.className).toContain('border');
    expect(badge.className).toContain('border-primary');
    expect(badge.className).toContain('text-primary');
  });

  it('should apply gray styling for viewer role', async () => {
    await render(RoleBadge, { role: 'viewer' });
    const badge = page.getByTestId('role-badge-viewer').element();
    expect(badge.className).toContain('bg-gray-200');
    expect(badge.className).toContain('text-gray-600');
  });

  it('should use space color for owner filled style', async () => {
    await render(RoleBadge, { role: 'owner', spaceColor: 'blue' });
    const badge = page.getByTestId('role-badge-owner').element();
    expect(badge.className).toContain('bg-blue-500');
  });

  it('should use space color for editor outlined style', async () => {
    await render(RoleBadge, { role: 'editor', spaceColor: 'blue' });
    const badge = page.getByTestId('role-badge-editor').element();
    expect(badge.className).toContain('border-blue-500');
    expect(badge.className).toContain('text-blue-500');
  });

  it('should fall back to primary when spaceColor is null', async () => {
    await render(RoleBadge, { role: 'owner', spaceColor: null });
    const badge = page.getByTestId('role-badge-owner').element();
    expect(badge.className).toContain('bg-primary');
  });

  it('should fall back to primary for unknown color', async () => {
    await render(RoleBadge, { role: 'owner', spaceColor: 'nonexistent' });
    const badge = page.getByTestId('role-badge-owner').element();
    expect(badge.className).toContain('bg-primary');
  });

  it('should apply sm size classes', async () => {
    await render(RoleBadge, { role: 'owner', size: 'sm' });
    const badge = page.getByTestId('role-badge-owner').element();
    expect(badge.className).toContain('px-2');
    expect(badge.className).toContain('py-0.5');
    expect(badge.className).toContain('text-xs');
  });

  it('should apply md size classes by default', async () => {
    await render(RoleBadge, { role: 'owner' });
    const badge = page.getByTestId('role-badge-owner').element();
    expect(badge.className).toContain('px-2.5');
    expect(badge.className).toContain('text-xs');
  });

  it('should always have rounded-full and font-medium', async () => {
    await render(RoleBadge, { role: 'viewer' });
    const badge = page.getByTestId('role-badge-viewer').element();
    expect(badge.className).toContain('rounded-full');
    expect(badge.className).toContain('font-medium');
  });

  it('should ignore space color for viewer role (always gray)', async () => {
    await render(RoleBadge, { role: 'viewer', spaceColor: 'red' });
    const badge = page.getByTestId('role-badge-viewer').element();
    expect(badge.className).toContain('bg-gray-200');
    expect(badge.className).not.toContain('bg-red');
  });
});
