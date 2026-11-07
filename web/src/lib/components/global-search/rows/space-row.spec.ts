import { init, register, waitLocale } from 'svelte-i18n';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import SpaceRow from './space-row.svelte';

vi.mock('@immich/ui', async (orig) => ({
  ...(await (orig as () => Promise<Record<string, unknown>>)()),
  IconButton: vi.fn(() => ({ $$typeof: Symbol.for('svelte.component') })),
}));

describe('space-row', () => {
  beforeAll(async () => {
    // Load the real en bundle so `$t('cmdk_preview_member_count', { values: { count } })`
    // resolves to English ICU output ("1 member" / "3 members") instead of the raw key
    // (global test setup uses `fallbackLocale: 'dev'` which returns keys).
    register('en-US', () => import('#i18n/en.json'));
    await init({ fallbackLocale: 'en-US' });
    await waitLocale('en-US');
  });

  const baseProps = {
    item: {
      id: 's1',
      name: 'Family',
      memberCount: 3,
      assetCount: 420,
      color: 'primary',
      recentAssetIds: [],
    },
    isPending: false,
  };

  it('renders space name', async () => {
    await render(SpaceRow, { props: baseProps as never });
    await expect.element(page.getByText('Family')).toBeInTheDocument();
  });

  it('renders member-count pill with ICU plural (singular)', async () => {
    await render(SpaceRow, {
      props: { ...baseProps, item: { ...baseProps.item, memberCount: 1 } } as never,
    });
    await expect.element(page.getByText(/1 member\b/)).toBeInTheDocument();
  });

  it('renders member-count pill with ICU plural (plural)', async () => {
    await render(SpaceRow, { props: baseProps as never });
    await expect.element(page.getByText(/3 members/)).toBeInTheDocument();
  });

  it('renders pending style when isPending=true', async () => {
    const { container } = await render(SpaceRow, {
      props: { ...baseProps, isPending: true } as never,
    });
    expect(container.querySelector('.opacity-50')).not.toBeNull();
    await expect.element(page.getByTestId('pending-spinner')).toBeInTheDocument();
  });
});
