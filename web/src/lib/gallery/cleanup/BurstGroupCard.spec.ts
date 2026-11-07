import BurstGroupCard from '#lib/gallery/cleanup/BurstGroupCard.svelte';
import { AssetTypeEnum, CleanupBurstSource, type CleanupAssetDto, type CleanupBurstGroupDto } from '@immich/sdk';
import { addMessages } from 'svelte-i18n';
import { SvelteMap } from 'svelte/reactivity';
import { expect } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page, userEvent } from 'vitest/browser';

const asset = (id: string, second: number): CleanupAssetDto => ({
  id,
  city: 'Lisbon',
  duration: null,
  fileSize: 4_000_000,
  height: 3000,
  width: 4000,
  inAlbum: false,
  isFavorite: false,
  kept: false,
  localDateTime: `2024-08-12T14:03:${String(second).padStart(2, '0')}.000Z`,
  originalFileName: `${id}.jpg`,
  thumbhash: null,
  type: AssetTypeEnum.Image,
});

const group: CleanupBurstGroupDto = {
  groupId: 'g1',
  source: CleanupBurstSource.BurstId,
  suggestedKeepId: 'c',
  assets: [asset('a', 21), asset('b', 22), asset('c', 23), asset('d', 24)],
};

const renderCard = async (overrides: Partial<CleanupBurstGroupDto> = {}) => {
  const marks = new SvelteMap<string, 'keep' | 'trash'>();
  const handlers = {
    onToggle: vi.fn((id: string) => {
      const current = marks.get(id) ?? (id === group.suggestedKeepId ? 'keep' : 'trash');
      marks.set(id, current === 'keep' ? 'trash' : 'keep');
    }),
    onKeepAll: vi.fn(),
    onStack: vi.fn(),
    onResolve: vi.fn(),
    onOpen: vi.fn(),
    onExpand: vi.fn(),
    onFocus: vi.fn(),
  };
  await render(BurstGroupCard, { group: { ...group, ...overrides }, marks, ...handlers });
  return handlers;
};

const tile = (id: string) => page.getByTestId(`cleanup-item-${id}`);

describe('BurstGroupCard', () => {
  beforeAll(() => {
    addMessages('dev', { cleanup_keep_n_trash_m: 'Keep {keep}, trash {trash}' });
  });

  it('marks the suggested pick as keep with the sharpest badge, and the others as trash', async () => {
    await renderCard();

    await expect.element(tile('c')).toHaveAttribute('data-mark', 'keep');
    await expect.element(tile('c').getByText(/★/)).toBeInTheDocument();
    for (const id of ['a', 'b', 'd']) {
      await expect.element(tile(id)).toHaveAttribute('data-mark', 'trash');
      expect(tile(id).getByText(/★/).query()).toBeNull();
    }
  });

  it('toggles a photo between keep and trash on click', async () => {
    const { onToggle } = await renderCard();

    await userEvent.click(tile('a'));
    expect(onToggle).toHaveBeenCalledWith('a');
    await expect.element(tile('a')).toHaveAttribute('data-mark', 'keep');

    await userEvent.click(tile('a'));
    await expect.element(tile('a')).toHaveAttribute('data-mark', 'trash');
  });

  it('counts the current marks on the resolve button', async () => {
    await renderCard();
    const resolve = page.getByTestId('cleanup-burst-resolve');
    await expect.element(resolve).toMatchTextContent('Keep 1, trash 3');

    await userEvent.click(tile('b'));

    await expect.element(resolve).toMatchTextContent('Keep 2, trash 2');
  });

  it('calls the group actions', async () => {
    const { onKeepAll, onStack, onResolve } = await renderCard();

    await userEvent.click(page.getByTestId('cleanup-burst-keep-all'));
    await userEvent.click(page.getByTestId('cleanup-burst-stack'));
    await userEvent.click(page.getByTestId('cleanup-burst-resolve'));

    expect(onKeepAll).toHaveBeenCalledTimes(1);
    expect(onStack).toHaveBeenCalledTimes(1);
    expect(onResolve).toHaveBeenCalledTimes(1);
  });

  it('opens a photo on double-click', async () => {
    const { onOpen } = await renderCard();

    await userEvent.dblClick(tile('b'));

    expect(onOpen).toHaveBeenCalledWith('b');
  });

  it('labels the source and shows a warning tone for time-window groups', async () => {
    await renderCard({ source: CleanupBurstSource.TimeWindow });

    const source = page.getByTestId('cleanup-burst-source');
    await expect.element(source).toHaveTextContent('cleanup_source_time_window');
    await expect.element(source).toHaveAttribute('data-tone', 'warning');
  });

  describe('big frame and filmstrip', () => {
    const frame = () => page.getByTestId('cleanup-burst-frame-g1');

    it('starts on the suggested frame', async () => {
      await renderCard();

      await expect.element(frame()).toHaveAttribute('data-shown-id', 'c');
      await expect.element(frame()).toMatchTextContent('cleanup_frame_position');
    });

    it('shows a filmstrip frame large on hover', async () => {
      await renderCard();

      await userEvent.hover(tile('a'));

      await expect.element(frame()).toHaveAttribute('data-shown-id', 'a');
    });

    it('makes the hovered frame the focused one, so K and Delete act on the frame shown', async () => {
      const { onFocus } = await renderCard();

      await userEvent.hover(tile('a'));
      expect(onFocus).toHaveBeenLastCalledWith('a');

      await userEvent.hover(page.getByTestId('cleanup-burst-sharpness-row-d'));
      expect(onFocus).toHaveBeenLastCalledWith('d');
      await expect.element(frame()).toHaveAttribute('data-shown-id', 'd');
    });

    it('moves the shown frame with the arrow keys while the card has focus', async () => {
      await renderCard();
      // Park the cursor off the frames: the previous test left it over a sharpness row, and
      // Chromium re-fires mouseenter there when the layout shifts, which would show that frame.
      await userEvent.hover(page.getByTestId('cleanup-burst-source'));

      (tile('c').element() as HTMLElement).focus();
      await userEvent.keyboard('{ArrowRight}');
      await expect.element(frame()).toHaveAttribute('data-shown-id', 'd');
      (tile('d').element() as HTMLElement).focus();
      await userEvent.keyboard('{ArrowLeft}');
      (tile('c').element() as HTMLElement).focus();
      await userEvent.keyboard('{ArrowLeft}');
      await expect.element(frame()).toHaveAttribute('data-shown-id', 'b');
    });

    it("toggles the shown frame's mark when the big frame is clicked", async () => {
      const { onToggle } = await renderCard();

      await userEvent.click(page.getByTestId('cleanup-burst-frame-toggle-g1'));

      expect(onToggle).toHaveBeenCalledWith('c');
    });

    it('opens the shown frame in the photo window', async () => {
      const { onExpand } = await renderCard();

      await userEvent.click(page.getByTestId('cleanup-expand-c'));

      expect(onExpand).toHaveBeenCalledWith('c', expect.any(DOMRect));
    });

    it('ranks the frames by sharpness, best first, and frames without a score show no bar', async () => {
      await renderCard({
        assets: [
          { ...asset('a', 21), sharpness: 40 },
          { ...asset('b', 22), sharpness: null },
          { ...asset('c', 23), sharpness: 90 },
          { ...asset('d', 24), sharpness: 70 },
        ],
      });

      const rows = page
        .getByTestId('cleanup-burst-sharpness')
        .getByTestId(/^cleanup-burst-sharpness-row-/)
        .elements();
      expect(rows.map((row) => (row as HTMLElement).dataset.testid)).toEqual([
        'cleanup-burst-sharpness-row-c',
        'cleanup-burst-sharpness-row-d',
        'cleanup-burst-sharpness-row-a',
        'cleanup-burst-sharpness-row-b',
      ]);
      await expect.element(page.getByTestId('cleanup-burst-sharpness-bar-b')).not.toBeInTheDocument();
      await expect.element(page.getByTestId('cleanup-burst-sharpness-bar-c')).toBeInTheDocument();
    });
  });
});
