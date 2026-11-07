import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import TagRow from '../rows/tag-row.svelte';

describe('tag-row', () => {
  it('renders the tag name (not value)', async () => {
    await render(TagRow, {
      props: { item: { id: 't1', name: 'beach', color: null } as never },
    });
    await expect.element(page.getByText('beach')).toBeInTheDocument();
  });

  it('renders a colored dot when tag has a color', async () => {
    const { container } = await render(TagRow, {
      props: { item: { id: 't1', name: 'beach', color: '#ff0000' } as never },
    });
    const dot = container.querySelector('[style*="background-color"]');
    expect(dot).not.toBeNull();
  });

  it('renders the fallback icon when color is null', async () => {
    const { container } = await render(TagRow, {
      props: { item: { id: 't1', name: 'beach', color: null } as never },
    });
    const dot = container.querySelector('[style*="background-color"]');
    expect(dot).toBeNull();
  });

  it('does NOT set role="option"', async () => {
    const { container } = await render(TagRow, {
      props: { item: { id: 't1', name: 'x', color: null } as never },
    });
    expect(container.querySelector('[role="option"]')).toBeNull();
  });
});
