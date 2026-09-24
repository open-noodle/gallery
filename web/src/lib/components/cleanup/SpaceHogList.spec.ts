import { AssetTypeEnum, type CleanupAssetDto } from '@immich/sdk';
import { fireEvent, render, screen, within } from '@testing-library/svelte';
import SpaceHogList from '$lib/components/cleanup/SpaceHogList.svelte';

const asset = (id: string, fileSize: number, overrides: Partial<CleanupAssetDto> = {}): CleanupAssetDto => ({
  id,
  city: null,
  duration: 702_000,
  fileSize,
  height: 2160,
  width: 3840,
  inAlbum: false,
  isFavorite: false,
  kept: false,
  localDateTime: '2019-07-12T10:00:00.000Z',
  originalFileName: `${id}.mp4`,
  thumbhash: null,
  type: AssetTypeEnum.Video,
  ...overrides,
});

const items = [
  asset('a', 4000, { inAlbum: true }),
  asset('b', 2000, { isFavorite: true }),
  asset('c', 1000, { type: AssetTypeEnum.Image, duration: null }),
];

const renderList = () => {
  const handlers = { onKeep: vi.fn(), onTrash: vi.fn(), onOpen: vi.fn() };
  render(SpaceHogList, { items, ...handlers });
  return handlers;
};

const row = (id: string) => within(screen.getByTestId(`cleanup-hog-row-${id}`));

describe('SpaceHogList', () => {
  it('keeps the given order', () => {
    renderList();

    expect(screen.getAllByTestId(/^cleanup-hog-row-/).map((el) => el.dataset.testid)).toEqual([
      'cleanup-hog-row-a',
      'cleanup-hog-row-b',
      'cleanup-hog-row-c',
    ]);
  });

  it('sizes each bar relative to the first row', () => {
    renderList();

    const widths = ['a', 'b', 'c'].map((id) => row(id).getByTestId('cleanup-hog-bar').style.width);
    expect(widths).toEqual(['100%', '50%', '25%']);
  });

  it('shows the file details and the album and favourite signals', () => {
    renderList();

    expect(row('a').getByText('a.mp4')).toBeInTheDocument();
    expect(row('a').getByTestId('cleanup-hog-signals')).toHaveTextContent(
      'video · 3840×2160 · 11:42 · 2019 · cleanup_in_album',
    );
    expect(row('b').getByTestId('cleanup-hog-signals')).toHaveTextContent('♥ favorite');
    expect(row('c').getByTestId('cleanup-hog-signals')).toHaveTextContent('cleanup_photo · 3840×2160 · 2019');
    expect(row('c').getByTestId('cleanup-hog-signals')).not.toHaveTextContent('cleanup_in_album');
  });

  it('calls the keep, trash and open handlers', async () => {
    const { onKeep, onTrash, onOpen } = renderList();

    await fireEvent.click(screen.getByTestId('cleanup-hog-keep-b'));
    await fireEvent.click(screen.getByTestId('cleanup-hog-trash-c'));
    await fireEvent.click(screen.getByTestId('cleanup-hog-open-a'));

    expect(onKeep).toHaveBeenCalledWith('b');
    expect(onTrash).toHaveBeenCalledWith('c');
    expect(onOpen).toHaveBeenCalledWith('a');
  });
});
