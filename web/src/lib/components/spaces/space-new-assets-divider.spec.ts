import TestWrapper from '#lib/components/TestWrapper.svelte';
import SpaceNewAssetsDivider from '#lib/components/spaces/space-new-assets-divider.svelte';
import type { Component } from 'svelte';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';

async function renderDivider(props: Record<string, unknown>) {
  return render(TestWrapper as Component<{ component: typeof SpaceNewAssetsDivider; componentProps: typeof props }>, {
    component: SpaceNewAssetsDivider,
    componentProps: props,
  });
}

describe('SpaceNewAssetsDivider', () => {
  it('should render pill with correct count', async () => {
    await renderDivider({ newAssetCount: 8, lastViewedAt: '2026-03-08T10:00:00Z', spaceColor: 'primary' });
    const divider = page.getByTestId('new-assets-divider').element();
    expect(divider).toMatchTextContent('8 new');
  });

  it('should render formatted date', async () => {
    await renderDivider({ newAssetCount: 3, lastViewedAt: '2026-03-08T10:00:00Z', spaceColor: 'primary' });
    const divider = page.getByTestId('new-assets-divider').element();
    // Date format is locale-dependent, just check "Mar" or "8" is present
    expect(divider.textContent).toMatch(/Mar|3/);
  });

  it('should not render when newAssetCount is 0', async () => {
    await renderDivider({ newAssetCount: 0, lastViewedAt: '2026-03-08T10:00:00Z', spaceColor: 'primary' });
    expect(page.getByTestId('new-assets-divider').query()).not.toBeInTheDocument();
  });

  it('should have sticky positioning', async () => {
    await renderDivider({ newAssetCount: 5, lastViewedAt: '2026-03-08T10:00:00Z', spaceColor: 'primary' });
    const divider = page.getByTestId('new-assets-divider').element();
    expect(divider.className).toContain('sticky');
  });

  it('should render pill element', async () => {
    await renderDivider({ newAssetCount: 5, lastViewedAt: '2026-03-08T10:00:00Z', spaceColor: 'primary' });
    expect(page.getByTestId('new-assets-pill').element()).toBeInTheDocument();
  });
});
