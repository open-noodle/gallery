import RewindYearSection from '#lib/gallery/cleanup/RewindYearSection.svelte';
import type { RewindMark } from '#lib/gallery/cleanup/rewind-session.svelte.ts';
import { pop } from '#lib/gallery/motion/index.ts';
import { AssetTypeEnum, type CleanupAssetDto } from '@immich/sdk';
import { expect } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page, userEvent } from 'vitest/browser';

vi.mock('#lib/gallery/motion/index.js', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  pop: vi.fn(),
}));

const asset = (id: string, overrides: Partial<CleanupAssetDto> = {}): CleanupAssetDto => ({
  id,
  city: 'Lisbon',
  duration: null,
  fileSize: 1000,
  height: 100,
  width: 100,
  inAlbum: false,
  isFavorite: false,
  kept: false,
  localDateTime: '2018-09-23T14:32:00.000Z',
  originalFileName: `${id}.jpg`,
  thumbhash: null,
  type: AssetTypeEnum.Image,
  ...overrides,
});

const setup = async (
  props: Partial<{
    assets: CleanupAssetDto[];
    marks: Map<string, RewindMark>;
    focusedId: string | null;
  }> = {},
) => {
  const handlers = { onCycle: vi.fn(), onOpen: vi.fn(), onKeepRemaining: vi.fn() };
  await render(RewindYearSection, {
    year: 2018,
    yearsAgo: 7,
    count: 3,
    city: 'Lisbon',
    assets: [asset('a'), asset('b'), asset('c')],
    marks: new Map(),
    focusedId: null,
    ...handlers,
    ...props,
  });
  return handlers;
};

describe('RewindYearSection', () => {
  it('renders the year heading and one tile per asset', async () => {
    await setup();

    await expect.element(page.getByRole('heading', { name: '2018' })).toBeVisible();
    await expect.element(page.getByTestId('cleanup-rewind-tile-a')).toBeVisible();
    await expect.element(page.getByTestId('cleanup-rewind-tile-b')).toBeVisible();
    await expect.element(page.getByTestId('cleanup-rewind-tile-c')).toBeVisible();
  });

  it('shows the years-ago, place and count line', async () => {
    await setup();

    const meta = page.getByTestId('cleanup-rewind-year-meta');
    await expect.element(meta).toMatchTextContent('cleanup_years_ago');
    await expect.element(meta).toMatchTextContent('Lisbon');
    await expect.element(meta).toMatchTextContent('items_count');
  });

  it('calls onCycle with the asset id when a tile is clicked', async () => {
    const { onCycle } = await setup();

    await userEvent.click(page.getByTestId('cleanup-rewind-tile-b'));

    expect(onCycle).toHaveBeenCalledWith('b');
  });

  it('opens the asset on double-click', async () => {
    const { onOpen } = await setup();

    await userEvent.dblClick(page.getByTestId('cleanup-rewind-tile-a'));

    expect(onOpen).toHaveBeenCalledWith('a');
  });

  it('reflects each mark on its tile, with a TRASH overlay for trash', async () => {
    await setup({
      marks: new Map<string, RewindMark>([
        ['a', 'keep'],
        ['b', 'fav'],
        ['c', 'trash'],
      ]),
    });

    await expect.element(page.getByTestId('cleanup-rewind-tile-a')).toHaveAttribute('data-mark', 'keep');
    await expect.element(page.getByTestId('cleanup-rewind-tile-b')).toHaveAttribute('data-mark', 'fav');
    const trashed = page.getByTestId('cleanup-rewind-tile-c');
    await expect.element(trashed).toHaveAttribute('data-mark', 'trash');
    await expect.element(trashed.getByText('trash')).toBeVisible();
    expect(page.getByTestId('cleanup-rewind-tile-a').getByText('trash').query()).toBeNull();
  });

  it('marks an unmarked tile as none and a server-kept one as kept', async () => {
    await setup({ assets: [asset('a'), asset('b', { kept: true })] });

    await expect.element(page.getByTestId('cleanup-rewind-tile-a')).toHaveAttribute('data-mark', 'none');
    await expect.element(page.getByTestId('cleanup-rewind-tile-b')).toHaveAttribute('data-mark', 'kept');
  });

  it('flags the focused tile', async () => {
    await setup({ focusedId: 'b' });

    await expect.element(page.getByTestId('cleanup-rewind-tile-b')).toHaveAttribute('data-focused', 'true');
    await expect.element(page.getByTestId('cleanup-rewind-tile-a')).toHaveAttribute('data-focused', 'false');
  });

  // Tailwind 4's outline-none zeroes the style outline-3 reads, so the ring needs outline-solid to show.
  it('draws a visible outline on the focused tile only', async () => {
    await setup({ focusedId: 'b' });

    await expect.element(page.getByTestId('cleanup-rewind-tile-b')).toHaveClass('outline-solid', 'outline-3');
    await expect.element(page.getByTestId('cleanup-rewind-tile-b')).not.toHaveClass('outline-none');
    await expect.element(page.getByTestId('cleanup-rewind-tile-a')).toHaveClass('outline-none');
  });

  it('calls onKeepRemaining with the year', async () => {
    const { onKeepRemaining } = await setup();

    await userEvent.click(page.getByRole('button', { name: 'cleanup_keep_all_remaining' }));

    expect(onKeepRemaining).toHaveBeenCalledWith(2018);
  });

  it('shows "Year reviewed" instead of the button once nothing is left unmarked', async () => {
    await setup({
      assets: [asset('a'), asset('b', { kept: true })],
      marks: new Map<string, RewindMark>([['a', 'trash']]),
    });

    expect(page.getByRole('button', { name: 'cleanup_keep_all_remaining' }).query()).toBeNull();
    await expect.element(page.getByText('cleanup_year_reviewed')).toBeVisible();
  });

  describe('motion', () => {
    const baseProps = {
      year: 2018,
      yearsAgo: 7,
      count: 3,
      city: 'Lisbon',
      assets: [asset('a'), asset('b'), asset('c')],
      focusedId: null,
      onCycle: vi.fn(),
      onOpen: vi.fn(),
      onKeepRemaining: vi.fn(),
    };

    beforeEach(() => vi.mocked(pop).mockClear());

    it('pops a badge when its tile is marked, not when the page loads with marks', async () => {
      const { rerender } = await render(RewindYearSection, {
        ...baseProps,
        marks: new Map([['b', 'fav' as RewindMark]]),
      });
      expect(pop).not.toHaveBeenCalled();

      await rerender({
        marks: new Map([
          ['b', 'fav' as RewindMark],
          ['a', 'keep' as RewindMark],
        ]),
      });

      expect(pop).toHaveBeenCalledTimes(1);
      expect(pop).toHaveBeenCalledWith(page.getByTestId('cleanup-mark-badge-a').element());
    });

    it('pops the "Year reviewed" badge when the last photo is marked, not on load', async () => {
      const all = new Map<string, RewindMark>([
        ['a', 'keep'],
        ['b', 'keep'],
        ['c', 'keep'],
      ]);
      const loaded = await render(RewindYearSection, { ...baseProps, marks: all });
      expect(pop).not.toHaveBeenCalledWith(page.getByTestId('cleanup-year-reviewed').element());
      await loaded.unmount();
      vi.mocked(pop).mockClear();

      const { rerender } = await render(RewindYearSection, {
        ...baseProps,
        marks: new Map<string, RewindMark>([
          ['a', 'keep'],
          ['b', 'keep'],
        ]),
      });
      await rerender({ marks: all });

      expect(pop).toHaveBeenCalledWith(page.getByTestId('cleanup-year-reviewed').element());
    });
  });
});
