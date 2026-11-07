import TestWrapper from '#lib/components/TestWrapper.svelte';
import { sidebarModeStore } from '#lib/stores/sidebar-mode.svelte.ts';
import type { Component } from 'svelte';
import { expect } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page, userEvent } from 'vitest/browser';
import SidebarSettings from './sidebar-settings.svelte';

const mocks = vi.hoisted(() => ({ sidebarMedia: { isFullSidebar: true, isWideSidebar: true } }));
vi.mock('#lib/stores/sidebar-media.svelte.js', () => ({ sidebarMedia: mocks.sidebarMedia }));

// SettingCombobox's Combobox always renders a "clear" IconButton (selectedOption is never
// undefined here), and @immich/ui's IconButton unconditionally wraps in a Tooltip that needs
// a TooltipProvider context - supplied in the real app by the root layout, but not present
// when mounting the component in isolation.
function renderSidebarSettings() {
  return render(
    TestWrapper as Component<{ component: typeof SidebarSettings; componentProps: Record<string, never> }>,
    {
      component: SidebarSettings,
      componentProps: {},
    },
  );
}

describe('sidebar-settings', () => {
  beforeEach(() => {
    localStorage.clear();
    sidebarModeStore.mode = 'auto';
  });

  it('offers all three modes in the combobox', async () => {
    await renderSidebarSettings();

    await userEvent.click(page.getByRole('combobox', { name: 'sidebar_mode' }));

    await expect.element(page.getByRole('option').first()).toBeInTheDocument();
    const options = page
      .getByRole('option')
      .elements()
      .map((option) => option.textContent);
    expect(options).toEqual(['sidebar_mode_auto', 'sidebar_mode_expanded', 'sidebar_mode_rail']);
  });

  it('shows the current mode as the selected option', async () => {
    sidebarModeStore.mode = 'expanded';

    await renderSidebarSettings();

    await expect.element(page.getByRole('combobox', { name: 'sidebar_mode' })).toHaveValue('sidebar_mode_expanded');
  });

  // The store setter itself is already covered by sidebar-mode.spec.ts ("writes the mode
  // through to the persisted store"); this drives the actual rendered control so it can only
  // pass if SidebarSettings wires selection through to the store.
  it('writes the selected mode and re-resolves the layout', async () => {
    await renderSidebarSettings();

    await userEvent.click(page.getByRole('combobox', { name: 'sidebar_mode' }));
    await userEvent.click(page.getByRole('option', { name: 'sidebar_mode_rail' }));

    await expect.poll(() => sidebarModeStore.mode).toBe('rail');
    // isWideSidebar is true, so only an explicit rail choice produces a rail here.
    expect(sidebarModeStore.layout).toBe('rail');
  });
});
