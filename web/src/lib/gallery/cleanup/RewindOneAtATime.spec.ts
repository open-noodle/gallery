import RewindOneAtATime from '#lib/gallery/cleanup/RewindOneAtATime.svelte';
import { AssetTypeEnum, CleanupBlurReason, type AssetResponseDto, type CleanupAssetDto } from '@immich/sdk';
import { expect } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';

const mocks = vi.hoisted(() => ({
  getAssetInfo: vi.fn(),
  getAllAlbums: vi.fn(),
}));

vi.mock('@immich/sdk', async (importOriginal) => ({ ...(await importOriginal<object>()), ...mocks }));

beforeEach(() => {
  mocks.getAssetInfo.mockReset().mockReturnValue(new Promise(() => {}));
  mocks.getAllAlbums.mockReset().mockResolvedValue([]);
});

const asset = (overrides: Partial<CleanupAssetDto> = {}): CleanupAssetDto => ({
  id: 'a',
  city: null,
  duration: null,
  fileSize: 100,
  height: 100,
  width: 100,
  inAlbum: false,
  isFavorite: false,
  kept: false,
  localDateTime: '2024-09-23T10:00:00.000Z',
  originalFileName: 'a.jpg',
  thumbhash: null,
  type: AssetTypeEnum.Image,
  ...overrides,
});

const renderOne = async (current: CleanupAssetDto, inBurst = false) =>
  await render(RewindOneAtATime, {
    asset: current,
    index: 1,
    total: 1,
    upNext: [],
    marks: new Map(),
    inBurst,
    onTrash: vi.fn(),
    onSkip: vi.fn(),
    onFavorite: vi.fn(),
    onKeep: vi.fn(),
    onSelect: vi.fn(),
    onOpen: vi.fn(),
  });

describe('RewindOneAtATime hints', () => {
  it('shows no hints card when no hint applies', async () => {
    await renderOne(asset());

    expect(page.getByTestId('cleanup-rewind-hints').query()).toBeNull();
  });

  it('links a burst photo to the Bursts queue', async () => {
    await renderOne(asset(), true);

    const burst = page.getByTestId('cleanup-hint-burst');
    await expect.element(burst).toMatchTextContent('cleanup_hint_burst');
    await expect.element(burst.getByRole('link')).toHaveAttribute('href', '/utilities/cleanup/bursts');
    expect(page.getByTestId('cleanup-hint-quality').query()).toBeNull();
  });

  it.each([
    [CleanupBlurReason.Blurry, 'cleanup_hint_blurry'],
    [CleanupBlurReason.Dark, 'cleanup_hint_dark'],
    [CleanupBlurReason.Bright, 'cleanup_hint_bright'],
  ])('links a photo flagged %s to the Blurry queue', async (reason, label) => {
    await renderOne(asset({ reason }));

    const hint = page.getByTestId('cleanup-hint-quality');
    await expect.element(hint).toMatchTextContent(label);
    await expect.element(hint.getByRole('link')).toHaveAttribute('href', '/utilities/cleanup/blurry');
    expect(page.getByTestId('cleanup-hint-burst').query()).toBeNull();
  });

  it('shows both hints together', async () => {
    await renderOne(asset({ reason: CleanupBlurReason.Blurry }), true);

    const card = page.getByTestId('cleanup-rewind-hints');
    expect(
      card
        .getByRole('link')
        .elements()
        .map((link) => link.getAttribute('href')),
    ).toEqual(['/utilities/cleanup/bursts', '/utilities/cleanup/blurry']);
  });
});

describe('RewindOneAtATime layout', () => {
  it('sizes the stage to the photo, so a portrait photo is not boxed into 4:3', async () => {
    await renderOne(asset({ id: 'tall', width: 3000, height: 4000 }));
    expect(page.getByTestId('cleanup-rewind-stage-tall').element().style.aspectRatio).toMatch(/^0.75/);
  });

  it('links to the photo in a new tab', async () => {
    await renderOne(asset({ id: 'p1' }));
    const link = page.getByTestId('cleanup-rewind-open-new-tab');
    await expect.element(link).toHaveAttribute('target', '_blank');
    expect(link.element().getAttribute('href')).toContain('p1');
  });

  it('shows the date and the named people from the full record, read-only', async () => {
    mocks.getAssetInfo.mockResolvedValue({
      id: 'p2',
      ownerId: 'someone-else',
      originalFileName: 'p2.jpg',
      localDateTime: '2016-10-29T14:32:00.000Z',
      people: [
        { id: 'anna', name: 'Anna', faces: [] },
        { id: 'x', name: '', faces: [] },
      ],
      tags: [],
      exifInfo: {},
    } as unknown as AssetResponseDto);
    await renderOne(asset({ id: 'p2', localDateTime: '2016-10-29T14:32:00.000Z' }));

    await expect.element(page.getByTestId('cleanup-rewind-info-date')).toMatchTextContent('2016');
    const people = page.getByTestId('cleanup-rewind-info-people');
    await expect.element(people).toBeInTheDocument();
    await expect.element(people).toMatchTextContent('Anna');
    await expect.element(people.getByRole('button')).not.toBeInTheDocument();
  });
});
