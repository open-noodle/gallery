import type { SharedSpaceResponseDto } from '@immich/sdk';
import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
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
  it('renders the people badge and empty collage when no recent assets', () => {
    render(SpaceListItem, props({ recentAssetIds: [] }));
    expect(screen.queryByTestId('space-row-badge')).not.toBeNull();
    expect(screen.queryByTestId('collage-empty')).not.toBeNull();
  });

  it('renders a 4-tile collage when 4 recent assets', () => {
    render(SpaceListItem, props({ recentAssetIds: ['1', '2', '3', '4'] }));
    expect(screen.queryByTestId('collage-grid')).not.toBeNull();
  });

  it('calls onSpaceClick when the row is clicked', async () => {
    const p = props({ recentAssetIds: [] });
    render(SpaceListItem, p);
    await fireEvent.click(screen.getByTestId('space-row'));
    expect(p.onSpaceClick).toHaveBeenCalledOnce();
  });

  it('shows a checkmark and calls onMultiSelect when multiSelected', async () => {
    const p = { ...props({ recentAssetIds: [] }), multiSelected: true };
    render(SpaceListItem, p);
    const checkbox = screen.getByRole('checkbox');
    await fireEvent.click(checkbox);
    expect(p.onMultiSelect).toHaveBeenCalledOnce();
  });

  it('shows only the member count (no separator) when assetCount is absent', () => {
    render(SpaceListItem, props({ recentAssetIds: [], assetCount: undefined, memberCount: 3 }));
    const details = screen.getByTestId('space-row-details');
    expect(details.textContent).toContain('3');
    expect(details.textContent).not.toContain('·'); // separator only renders when both counts exist
  });

  it('highlights the matching slice of the space name', () => {
    render(SpaceListItem, { ...props({ recentAssetIds: [] }), searchQuery: 'mil' }); // "Family" → Fa[mil]y
    const bold = screen.getByTestId('space-row').querySelector('b');
    expect(bold?.textContent?.toLowerCase()).toBe('mil');
  });
});
