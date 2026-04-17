import { render, screen } from '@testing-library/svelte';
import { init, register, waitLocale } from 'svelte-i18n';
import { beforeAll, describe, expect, it, vi } from 'vitest';
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
    register('en-US', () => import('$i18n/en.json'));
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

  it('renders space name', () => {
    render(SpaceRow, { props: baseProps as never });
    expect(screen.getByText('Family')).toBeInTheDocument();
  });

  it('renders member-count pill with ICU plural (singular)', () => {
    render(SpaceRow, {
      props: { ...baseProps, item: { ...baseProps.item, memberCount: 1 } } as never,
    });
    expect(screen.getByText(/1 member\b/)).toBeInTheDocument();
  });

  it('renders member-count pill with ICU plural (plural)', () => {
    render(SpaceRow, { props: baseProps as never });
    expect(screen.getByText(/3 members/)).toBeInTheDocument();
  });

  it('renders pending style when isPending=true', () => {
    const { container } = render(SpaceRow, {
      props: { ...baseProps, isPending: true } as never,
    });
    expect(container.querySelector('.opacity-50')).toBeInTheDocument();
    expect(container.querySelector('[data-testid="pending-spinner"]')).toBeInTheDocument();
  });
});
