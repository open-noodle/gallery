import type { SharedSpaceResponseDto } from '@immich/sdk';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import SpaceListItem from './space-list-item.svelte';

const base = {
  id: 's1',
  name: 'Family',
  memberCount: 2,
  assetCount: 5,
  members: [],
  createdById: 'u1',
  createdAt: '2024-01-01T00:00:00Z',
};
const props = (over = {}) => ({
  space: { ...base, ...over } as unknown as SharedSpaceResponseDto,
  selected: false,
  onSpaceClick: vi.fn(),
  onMultiSelect: vi.fn(),
});

describe('SpaceListItem', () => {
  it('renders the people badge and empty collage when no recent assets', async () => {
    const screen = await render(SpaceListItem, props({ recentAssetIds: [] }));
    expect(screen.getByTestId('space-row-badge').query()).not.toBeNull();
    expect(screen.getByTestId('collage-empty').query()).not.toBeNull();
  });

  it('renders a 4-tile collage when 4 recent assets', async () => {
    const screen = await render(SpaceListItem, props({ recentAssetIds: ['1', '2', '3', '4'] }));
    expect(screen.getByTestId('collage-grid').query()).not.toBeNull();
  });

  it('calls onSpaceClick when the row is clicked', async () => {
    const p = props({ recentAssetIds: [] });
    const screen = await render(SpaceListItem, p);
    await screen.getByTestId('space-row').click();
    expect(p.onSpaceClick).toHaveBeenCalledOnce();
  });

  it('shows a checkmark and calls onMultiSelect when multiSelected', async () => {
    const p = { ...props({ recentAssetIds: [] }), multiSelected: true };
    const screen = await render(SpaceListItem, p);
    await screen.getByRole('checkbox').click();
    expect(p.onMultiSelect).toHaveBeenCalledOnce();
  });

  it('shows only the member count (no separator) when assetCount is absent', async () => {
    const screen = await render(SpaceListItem, props({ recentAssetIds: [], assetCount: undefined, memberCount: 3 }));
    const details = screen.getByTestId('space-row-details').element();
    expect(details.textContent).toContain('3');
    expect(details.textContent).not.toContain('·'); // separator only renders when both counts exist
  });

  it('highlights the matching slice of the space name', async () => {
    const screen = await render(SpaceListItem, { ...props({ recentAssetIds: [] }), searchQuery: 'mil' }); // "Family" → Fa[mil]y
    const bold = screen.getByTestId('space-row').element().querySelector('b');
    expect(bold?.textContent?.toLowerCase()).toBe('mil');
  });
});
