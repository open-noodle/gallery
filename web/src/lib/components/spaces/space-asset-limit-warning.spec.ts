import SpaceAssetLimitWarning from '#lib/components/spaces/space-asset-limit-warning.svelte';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';

describe('SpaceAssetLimitWarning', () => {
  it('should not render when selectedCount is within the limit', async () => {
    await render(SpaceAssetLimitWarning, { selectedCount: 5000 });
    expect(page.getByTestId('asset-limit-warning').query()).not.toBeInTheDocument();
  });

  it('should not render when selectedCount is exactly at the limit', async () => {
    await render(SpaceAssetLimitWarning, { selectedCount: 50_000 });
    expect(page.getByTestId('asset-limit-warning').query()).not.toBeInTheDocument();
  });

  it('should render warning when selectedCount exceeds the limit', async () => {
    await render(SpaceAssetLimitWarning, { selectedCount: 50_001 });
    expect(page.getByTestId('asset-limit-warning').element()).toBeInTheDocument();
  });

  it('should render warning when selectedCount is way over the limit', async () => {
    await render(SpaceAssetLimitWarning, { selectedCount: 100_000 });
    expect(page.getByTestId('asset-limit-warning').element()).toBeInTheDocument();
  });

  it('should not render when selectedCount is 0', async () => {
    await render(SpaceAssetLimitWarning, { selectedCount: 0 });
    expect(page.getByTestId('asset-limit-warning').query()).not.toBeInTheDocument();
  });
});
