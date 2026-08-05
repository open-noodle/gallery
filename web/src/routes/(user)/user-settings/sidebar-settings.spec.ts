import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import type { Component } from 'svelte';
import { getIntersectionObserverMock } from '$lib/__mocks__/intersection-observer.mock';
import { getVisualViewportMock } from '$lib/__mocks__/visual-viewport.mock';
import TestWrapper from '$lib/components/TestWrapper.svelte';
import { sidebarModeStore } from '$lib/stores/sidebar-mode.svelte';
import SidebarSettings from './sidebar-settings.svelte';

const mocks = vi.hoisted(() => ({ sidebarMedia: { isFullSidebar: true, isWideSidebar: true } }));
vi.mock('$lib/stores/sidebar-media.svelte', () => ({ sidebarMedia: mocks.sidebarMedia }));

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
    // Combobox positions its dropdown off these two browser APIs, which happy-dom doesn't
    // implement; stub them the same way the other Combobox-rendering specs do.
    vi.stubGlobal('IntersectionObserver', getIntersectionObserverMock());
    vi.stubGlobal('visualViewport', getVisualViewportMock());
  });

  it('offers all three modes in the combobox', async () => {
    const user = userEvent.setup();
    renderSidebarSettings();

    await user.click(screen.getByRole('combobox', { name: 'sidebar_mode' }));

    const options = screen.getAllByRole('option').map((option) => option.textContent);
    expect(options).toEqual(['sidebar_mode_auto', 'sidebar_mode_expanded', 'sidebar_mode_rail']);
  });

  it('shows the current mode as the selected option', () => {
    sidebarModeStore.mode = 'expanded';

    renderSidebarSettings();

    expect(screen.getByRole('combobox', { name: 'sidebar_mode' })).toHaveValue('sidebar_mode_expanded');
  });

  // The store setter itself is already covered by sidebar-mode.spec.ts ("writes the mode
  // through to the persisted store"); this drives the actual rendered control so it can only
  // pass if SidebarSettings wires selection through to the store.
  it('writes the selected mode and re-resolves the layout', async () => {
    const user = userEvent.setup();
    renderSidebarSettings();

    await user.click(screen.getByRole('combobox', { name: 'sidebar_mode' }));
    await user.click(screen.getByRole('option', { name: 'sidebar_mode_rail' }));

    expect(sidebarModeStore.mode).toBe('rail');
    // isWideSidebar is true, so only an explicit rail choice produces a rail here.
    expect(sidebarModeStore.layout).toBe('rail');
  });
});
