import SpaceHogList from '#lib/gallery/cleanup/SpaceHogList.svelte';
import { AssetTypeEnum, type CleanupAssetDto } from '@immich/sdk';
import { expect } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page, userEvent } from 'vitest/browser';

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

const renderList = async () => {
  const handlers = { onKeep: vi.fn(), onTrash: vi.fn(), onOpen: vi.fn() };
  await render(SpaceHogList, { items, ...handlers });
  return handlers;
};

const row = (id: string) => page.getByTestId(`cleanup-hog-row-${id}`);

describe('SpaceHogList', () => {
  it('keeps the given order', async () => {
    await renderList();

    expect(
      page
        .getByTestId(/^cleanup-hog-row-/)
        .elements()
        .map((el) => el.dataset.testid),
    ).toEqual(['cleanup-hog-row-a', 'cleanup-hog-row-b', 'cleanup-hog-row-c']);
  });

  it('sizes each bar relative to the first row', async () => {
    await renderList();

    const widths = ['a', 'b', 'c'].map((id) => row(id).getByTestId('cleanup-hog-bar').element().style.width);
    expect(widths).toEqual(['100%', '50%', '25%']);
  });

  it('shows the file details and the album and favourite signals', async () => {
    await renderList();

    await expect.element(row('a').getByText('a.mp4')).toBeInTheDocument();
    await expect
      .element(row('a').getByTestId('cleanup-hog-signals'))
      .toMatchTextContent('video · 3840×2160 · 11:42 · 2019 · cleanup_in_album');
    await expect.element(row('b').getByTestId('cleanup-hog-signals')).toMatchTextContent('♥ favorite');
    await expect
      .element(row('c').getByTestId('cleanup-hog-signals'))
      .toMatchTextContent('cleanup_photo · 3840×2160 · 2019');
    await expect.element(row('c').getByTestId('cleanup-hog-signals')).not.toMatchTextContent('cleanup_in_album');
  });

  it('calls the keep, trash and open handlers', async () => {
    const { onKeep, onTrash, onOpen } = await renderList();

    await userEvent.click(page.getByTestId('cleanup-hog-keep-b'));
    await userEvent.click(page.getByTestId('cleanup-hog-trash-c'));
    await userEvent.click(page.getByTestId('cleanup-hog-open-a'));

    expect(onKeep).toHaveBeenCalledWith('b');
    expect(onTrash).toHaveBeenCalledWith('c');
    expect(onOpen).toHaveBeenCalledWith('a');
  });
});
