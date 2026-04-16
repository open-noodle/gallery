import { render, screen } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import SpaceRow from './space-row.svelte';

vi.mock('@immich/ui', async (orig) => ({
  ...(await (orig as () => Promise<Record<string, unknown>>)()),
  IconButton: vi.fn(() => ({ $$typeof: Symbol.for('svelte.component') })),
}));

describe('space-row', () => {
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
