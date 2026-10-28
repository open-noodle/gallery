import { AssetTypeEnum, type CleanupAssetDto } from '@immich/sdk';
import { fireEvent, render, screen, within } from '@testing-library/svelte';
import RewindYearSection from '$lib/components/cleanup/RewindYearSection.svelte';
import { pop } from '$lib/gallery/motion';
import type { RewindMark } from '$lib/managers/rewind-session.svelte';

vi.mock('$lib/gallery/motion', async (importOriginal) => ({ ...(await importOriginal<object>()), pop: vi.fn() }));

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

const setup = (
  props: Partial<{
    assets: CleanupAssetDto[];
    marks: Map<string, RewindMark>;
    focusedId: string | null;
  }> = {},
) => {
  const handlers = { onCycle: vi.fn(), onOpen: vi.fn(), onKeepRemaining: vi.fn() };
  render(RewindYearSection, {
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
  it('renders the year heading and one tile per asset', () => {
    setup();

    expect(screen.getByRole('heading', { name: '2018' })).toBeVisible();
    expect(screen.getByTestId('cleanup-rewind-tile-a')).toBeVisible();
    expect(screen.getByTestId('cleanup-rewind-tile-b')).toBeVisible();
    expect(screen.getByTestId('cleanup-rewind-tile-c')).toBeVisible();
  });

  it('shows the years-ago, place and count line', () => {
    setup();

    const meta = screen.getByTestId('cleanup-rewind-year-meta');
    expect(meta).toHaveTextContent('cleanup_years_ago');
    expect(meta).toHaveTextContent('Lisbon');
    expect(meta).toHaveTextContent('items_count');
  });

  it('calls onCycle with the asset id when a tile is clicked', async () => {
    const { onCycle } = setup();

    await fireEvent.click(screen.getByTestId('cleanup-rewind-tile-b'));

    expect(onCycle).toHaveBeenCalledWith('b');
  });

  it('opens the asset on double-click', async () => {
    const { onOpen } = setup();

    await fireEvent.dblClick(screen.getByTestId('cleanup-rewind-tile-a'));

    expect(onOpen).toHaveBeenCalledWith('a');
  });

  it('reflects each mark on its tile, with a TRASH overlay for trash', () => {
    setup({
      marks: new Map<string, RewindMark>([
        ['a', 'keep'],
        ['b', 'fav'],
        ['c', 'trash'],
      ]),
    });

    expect(screen.getByTestId('cleanup-rewind-tile-a')).toHaveAttribute('data-mark', 'keep');
    expect(screen.getByTestId('cleanup-rewind-tile-b')).toHaveAttribute('data-mark', 'fav');
    const trashed = screen.getByTestId('cleanup-rewind-tile-c');
    expect(trashed).toHaveAttribute('data-mark', 'trash');
    expect(within(trashed).getByText('trash')).toBeVisible();
    expect(within(screen.getByTestId('cleanup-rewind-tile-a')).queryByText('trash')).toBeNull();
  });

  it('marks an unmarked tile as none and a server-kept one as kept', () => {
    setup({ assets: [asset('a'), asset('b', { kept: true })] });

    expect(screen.getByTestId('cleanup-rewind-tile-a')).toHaveAttribute('data-mark', 'none');
    expect(screen.getByTestId('cleanup-rewind-tile-b')).toHaveAttribute('data-mark', 'kept');
  });

  it('flags the focused tile', () => {
    setup({ focusedId: 'b' });

    expect(screen.getByTestId('cleanup-rewind-tile-b')).toHaveAttribute('data-focused', 'true');
    expect(screen.getByTestId('cleanup-rewind-tile-a')).toHaveAttribute('data-focused', 'false');
  });

  it('calls onKeepRemaining with the year', async () => {
    const { onKeepRemaining } = setup();

    await fireEvent.click(screen.getByRole('button', { name: 'cleanup_keep_all_remaining' }));

    expect(onKeepRemaining).toHaveBeenCalledWith(2018);
  });

  it('shows "Year reviewed" instead of the button once nothing is left unmarked', () => {
    setup({
      assets: [asset('a'), asset('b', { kept: true })],
      marks: new Map<string, RewindMark>([['a', 'trash']]),
    });

    expect(screen.queryByRole('button', { name: 'cleanup_keep_all_remaining' })).toBeNull();
    expect(screen.getByText('cleanup_year_reviewed')).toBeVisible();
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
      const { rerender } = render(RewindYearSection, { ...baseProps, marks: new Map([['b', 'fav' as RewindMark]]) });
      expect(pop).not.toHaveBeenCalled();

      await rerender({
        marks: new Map([
          ['b', 'fav' as RewindMark],
          ['a', 'keep' as RewindMark],
        ]),
      });

      expect(pop).toHaveBeenCalledTimes(1);
      expect(pop).toHaveBeenCalledWith(screen.getByTestId('cleanup-mark-badge-a'));
    });

    it('pops the "Year reviewed" badge when the last photo is marked, not on load', async () => {
      const all = new Map<string, RewindMark>([
        ['a', 'keep'],
        ['b', 'keep'],
        ['c', 'keep'],
      ]);
      const loaded = render(RewindYearSection, { ...baseProps, marks: all });
      expect(pop).not.toHaveBeenCalledWith(screen.getByTestId('cleanup-year-reviewed'));
      loaded.unmount();
      vi.mocked(pop).mockClear();

      const { rerender } = render(RewindYearSection, {
        ...baseProps,
        marks: new Map<string, RewindMark>([
          ['a', 'keep'],
          ['b', 'keep'],
        ]),
      });
      await rerender({ marks: all });

      expect(pop).toHaveBeenCalledWith(screen.getByTestId('cleanup-year-reviewed'));
    });
  });
});
