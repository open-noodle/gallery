import { AssetTypeEnum, CleanupBlurReason, type CleanupAssetDto } from '@immich/sdk';
import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { SvelteSet } from 'svelte/reactivity';
import QueueSelectGrid from '$lib/components/cleanup/QueueSelectGrid.svelte';

const asset = (id: string, reason?: CleanupBlurReason): CleanupAssetDto => ({
  id,
  city: null,
  duration: null,
  fileSize: 1000,
  height: 100,
  width: 100,
  inAlbum: false,
  isFavorite: false,
  kept: false,
  localDateTime: '2024-01-01T00:00:00.000Z',
  originalFileName: `${id}.jpg`,
  reason,
  thumbhash: null,
  type: AssetTypeEnum.Image,
});

const items = [
  asset('a', CleanupBlurReason.Blurry),
  asset('b', CleanupBlurReason.Dark),
  asset('c', CleanupBlurReason.Bright),
];

const renderGrid = (variant: 'blurry' | 'screenshots') => {
  const selected = new SvelteSet<string>();
  const onToggle = vi.fn((id: string) => (selected.has(id) ? selected.delete(id) : selected.add(id)));
  const onOpen = vi.fn();
  render(QueueSelectGrid, { items, variant, selected, onToggle, onOpen });
  return { onToggle, onOpen };
};

const tile = (id: string) => screen.getByTestId(`cleanup-item-${id}`);

describe('QueueSelectGrid', () => {
  it('renders the tiles in order', () => {
    renderGrid('blurry');

    expect(screen.getAllByTestId(/^cleanup-item-/).map((el) => el.dataset.testid)).toEqual([
      'cleanup-item-a',
      'cleanup-item-b',
      'cleanup-item-c',
    ]);
  });

  it('toggles the selection on click', async () => {
    const { onToggle } = renderGrid('blurry');
    expect(tile('a')).toHaveAttribute('data-selected', 'false');

    await fireEvent.click(tile('a'));
    expect(onToggle).toHaveBeenCalledWith('a');
    expect(tile('a')).toHaveAttribute('data-selected', 'true');

    await fireEvent.click(tile('a'));
    expect(tile('a')).toHaveAttribute('data-selected', 'false');
  });

  it('opens a tile on double-click', async () => {
    const { onOpen } = renderGrid('screenshots');

    await fireEvent.dblClick(tile('b'));

    expect(onOpen).toHaveBeenCalledWith('b');
  });

  it('shows reason badges in the blurry variant', () => {
    renderGrid('blurry');

    expect(within(tile('a')).getByText('cleanup_reason_blurry')).toBeInTheDocument();
    expect(within(tile('b')).getByText('cleanup_reason_dark')).toBeInTheDocument();
    expect(within(tile('c')).getByText('cleanup_reason_bright')).toBeInTheDocument();
  });

  it('shows no reason badges for screenshots', () => {
    renderGrid('screenshots');

    expect(screen.queryByText(/cleanup_reason_/)).toBeNull();
  });
});
