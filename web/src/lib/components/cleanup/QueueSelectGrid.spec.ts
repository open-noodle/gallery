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

const renderGrid = (
  variant: 'blurry' | 'screenshots',
  props: Partial<{ items: CleanupAssetDto[]; size: 'small' | 'medium' | 'large' }> = {},
) => {
  const selected = new SvelteSet<string>();
  const onToggle = vi.fn((id: string) => (selected.has(id) ? selected.delete(id) : selected.add(id)));
  const onOpen = vi.fn();
  const onExpand = vi.fn();
  render(QueueSelectGrid, { items, variant, selected, onToggle, onOpen, onExpand, size: 'medium', ...props });
  return { onToggle, onOpen, onExpand };
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

  it('shows screenshots whole, at their own shape', () => {
    renderGrid('screenshots', { items: [{ ...asset('s'), width: 1080, height: 2340 }] });

    const frame = within(tile('s')).getByTestId('cleanup-tile');
    expect(frame.style.aspectRatio).toBe('1080 / 2340');
    expect(within(frame).getByRole('img')).toHaveClass('object-contain');
  });

  it('falls back to portrait when dimensions are missing', () => {
    renderGrid('screenshots', { items: [{ ...asset('s'), width: null, height: null }] });

    expect(within(tile('s')).getByTestId('cleanup-tile').style.aspectRatio).toBe('9 / 19.5');
  });

  it('keeps blurry tiles square and cropped', () => {
    renderGrid('blurry');

    const frame = within(tile('a')).getByTestId('cleanup-tile');
    expect(frame).toHaveClass('aspect-square');
    expect(within(frame).getByRole('img')).toHaveClass('object-cover');
  });

  it('lays screenshots out in rows, wide ones wider, in reading order', () => {
    renderGrid('screenshots', {
      size: 'large',
      items: [
        { ...asset('tall'), width: 1080, height: 2340 },
        { ...asset('wide'), width: 2340, height: 1080 },
      ],
    });

    const grid = screen.getByTestId('cleanup-select-grid');
    expect(grid).toHaveClass('flex', 'flex-wrap');
    expect(grid.style.columnWidth).toBe('');
    const [tall, wide] = [...grid.children] as HTMLElement[];
    expect(tall.dataset.asset).toBe('tall');
    expect(Number(wide.style.flexBasis.replace('px', ''))).toBeGreaterThan(
      Number(tall.style.flexBasis.replace('px', '')),
    );
    // The size control sets the row height: a portrait screenshot at "large" is 340px wide.
    expect(tall.style.flexBasis).toBe('340px');
  });

  it('opens the photo window from the expand button without toggling the tile', async () => {
    const { onExpand, onToggle } = renderGrid('blurry');

    await fireEvent.click(screen.getByTestId('cleanup-expand-b'));

    expect(onExpand).toHaveBeenCalledWith('b', expect.any(DOMRect));
    expect(onToggle).not.toHaveBeenCalled();
  });
});
