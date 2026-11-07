import QueueSelectGrid from '#lib/gallery/cleanup/QueueSelectGrid.svelte';
import { AssetTypeEnum, CleanupBlurReason, type CleanupAssetDto } from '@immich/sdk';
import { SvelteSet } from 'svelte/reactivity';
import { expect } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page, userEvent } from 'vitest/browser';

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

const renderGrid = async (
  variant: 'blurry' | 'screenshots',
  props: Partial<{ items: CleanupAssetDto[]; size: 'small' | 'medium' | 'large' }> = {},
) => {
  const selected = new SvelteSet<string>();
  const onToggle = vi.fn((id: string) => (selected.has(id) ? selected.delete(id) : selected.add(id)));
  const onOpen = vi.fn();
  const onExpand = vi.fn();
  await render(QueueSelectGrid, { items, variant, selected, onToggle, onOpen, onExpand, size: 'medium', ...props });
  return { onToggle, onOpen, onExpand };
};

const tile = (id: string) => page.getByTestId(`cleanup-item-${id}`);

describe('QueueSelectGrid', () => {
  it('renders the tiles in order', async () => {
    await renderGrid('blurry');

    expect(
      page
        .getByTestId(/^cleanup-item-/)
        .elements()
        .map((el) => el.dataset.testid),
    ).toEqual(['cleanup-item-a', 'cleanup-item-b', 'cleanup-item-c']);
  });

  it('toggles the selection on click', async () => {
    const { onToggle } = await renderGrid('blurry');
    await expect.element(tile('a')).toHaveAttribute('data-selected', 'false');

    await userEvent.click(tile('a'));
    expect(onToggle).toHaveBeenCalledWith('a');
    await expect.element(tile('a')).toHaveAttribute('data-selected', 'true');

    await userEvent.click(tile('a'));
    await expect.element(tile('a')).toHaveAttribute('data-selected', 'false');
  });

  it('opens a tile on double-click', async () => {
    const { onOpen } = await renderGrid('screenshots');

    await userEvent.dblClick(tile('b'));

    expect(onOpen).toHaveBeenCalledWith('b');
  });

  it('shows reason badges in the blurry variant', async () => {
    await renderGrid('blurry');

    await expect.element(tile('a').getByText('cleanup_reason_blurry')).toBeInTheDocument();
    await expect.element(tile('b').getByText('cleanup_reason_dark')).toBeInTheDocument();
    await expect.element(tile('c').getByText('cleanup_reason_bright')).toBeInTheDocument();
  });

  it('shows no reason badges for screenshots', async () => {
    await renderGrid('screenshots');

    expect(page.getByText(/cleanup_reason_/).query()).toBeNull();
  });

  it('shows screenshots whole, at their own shape', async () => {
    await renderGrid('screenshots', { items: [{ ...asset('s'), width: 1080, height: 2340 }] });

    const frame = tile('s').getByTestId('cleanup-tile');
    expect(frame.element().style.aspectRatio).toBe('1080 / 2340');
    await expect.element(frame.getByRole('img')).toHaveClass('object-contain');
  });

  it('falls back to portrait when dimensions are missing', async () => {
    await renderGrid('screenshots', { items: [{ ...asset('s'), width: null, height: null }] });

    expect(tile('s').getByTestId('cleanup-tile').element().style.aspectRatio).toBe('9 / 19.5');
  });

  it('keeps blurry tiles square and cropped', async () => {
    await renderGrid('blurry');

    const frame = tile('a').getByTestId('cleanup-tile');
    await expect.element(frame).toHaveClass('aspect-square');
    await expect.element(frame.getByRole('img')).toHaveClass('object-cover');
  });

  it('lays screenshots out in rows, wide ones wider, in reading order', async () => {
    await renderGrid('screenshots', {
      size: 'large',
      items: [
        { ...asset('tall'), width: 1080, height: 2340 },
        { ...asset('wide'), width: 2340, height: 1080 },
      ],
    });

    const grid = page.getByTestId('cleanup-select-grid');
    await expect.element(grid).toHaveClass('flex', 'flex-wrap');
    expect(grid.element().style.columnWidth).toBe('');
    const [tall, wide] = [...grid.element().children] as HTMLElement[];
    expect(tall.dataset.asset).toBe('tall');
    expect(Number(wide.style.flexBasis.replace('px', ''))).toBeGreaterThan(
      Number(tall.style.flexBasis.replace('px', '')),
    );
    // The size control sets the row height: a portrait screenshot at "large" is 340px wide.
    expect(tall.style.flexBasis).toBe('340px');
  });

  it('opens the photo window from the expand button without toggling the tile', async () => {
    const { onExpand, onToggle } = await renderGrid('blurry');

    await userEvent.click(page.getByTestId('cleanup-expand-b'));

    expect(onExpand).toHaveBeenCalledWith('b', expect.any(DOMRect));
    expect(onToggle).not.toHaveBeenCalled();
  });
});
