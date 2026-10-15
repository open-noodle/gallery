import { AssetTypeEnum, CleanupBurstSource, type CleanupAssetDto, type CleanupBurstGroupDto } from '@immich/sdk';
import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { addMessages } from 'svelte-i18n';
import { SvelteMap } from 'svelte/reactivity';
import BurstGroupCard from '$lib/components/cleanup/BurstGroupCard.svelte';

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

const renderCard = (overrides: Partial<CleanupBurstGroupDto> = {}) => {
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
  };
  render(BurstGroupCard, { group: { ...group, ...overrides }, marks, ...handlers });
  return handlers;
};

const tile = (id: string) => screen.getByTestId(`cleanup-item-${id}`);

describe('BurstGroupCard', () => {
  beforeAll(() => {
    addMessages('dev', { cleanup_keep_n_trash_m: 'Keep {keep}, trash {trash}' });
  });

  it('marks the suggested pick as keep with the sharpest badge, and the others as trash', () => {
    renderCard();

    expect(tile('c')).toHaveAttribute('data-mark', 'keep');
    expect(within(tile('c')).getByText(/★/)).toBeInTheDocument();
    for (const id of ['a', 'b', 'd']) {
      expect(tile(id)).toHaveAttribute('data-mark', 'trash');
      expect(within(tile(id)).queryByText(/★/)).toBeNull();
    }
  });

  it('toggles a photo between keep and trash on click', async () => {
    const { onToggle } = renderCard();

    await fireEvent.click(tile('a'));
    expect(onToggle).toHaveBeenCalledWith('a');
    expect(tile('a')).toHaveAttribute('data-mark', 'keep');

    await fireEvent.click(tile('a'));
    expect(tile('a')).toHaveAttribute('data-mark', 'trash');
  });

  it('counts the current marks on the resolve button', async () => {
    renderCard();
    const resolve = screen.getByTestId('cleanup-burst-resolve');
    expect(resolve).toHaveTextContent('Keep 1, trash 3');

    await fireEvent.click(tile('b'));

    expect(resolve).toHaveTextContent('Keep 2, trash 2');
  });

  it('calls the group actions', async () => {
    const { onKeepAll, onStack, onResolve } = renderCard();

    await fireEvent.click(screen.getByTestId('cleanup-burst-keep-all'));
    await fireEvent.click(screen.getByTestId('cleanup-burst-stack'));
    await fireEvent.click(screen.getByTestId('cleanup-burst-resolve'));

    expect(onKeepAll).toHaveBeenCalledTimes(1);
    expect(onStack).toHaveBeenCalledTimes(1);
    expect(onResolve).toHaveBeenCalledTimes(1);
  });

  it('opens a photo on double-click', async () => {
    const { onOpen } = renderCard();

    await fireEvent.dblClick(tile('b'));

    expect(onOpen).toHaveBeenCalledWith('b');
  });

  it('labels the source and shows a warning tone for time-window groups', () => {
    renderCard({ source: CleanupBurstSource.TimeWindow });

    const source = screen.getByTestId('cleanup-burst-source');
    expect(source).toHaveTextContent('cleanup_source_time_window');
    expect(source).toHaveAttribute('data-tone', 'warning');
  });
});
