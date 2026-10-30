import { AssetTypeEnum, CleanupBlurReason, type AssetResponseDto, type CleanupAssetDto } from '@immich/sdk';
import '@testing-library/jest-dom';
import { render, screen, within } from '@testing-library/svelte';
import RewindOneAtATime from '$lib/gallery/cleanup/RewindOneAtATime.svelte';

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

const renderOne = (current: CleanupAssetDto, inBurst = false) =>
  render(RewindOneAtATime, {
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
  it('shows no hints card when no hint applies', () => {
    renderOne(asset());

    expect(screen.queryByTestId('cleanup-rewind-hints')).toBeNull();
  });

  it('links a burst photo to the Bursts queue', () => {
    renderOne(asset(), true);

    const burst = screen.getByTestId('cleanup-hint-burst');
    expect(burst).toHaveTextContent('cleanup_hint_burst');
    expect(within(burst).getByRole('link')).toHaveAttribute('href', '/utilities/cleanup/bursts');
    expect(screen.queryByTestId('cleanup-hint-quality')).toBeNull();
  });

  it.each([
    [CleanupBlurReason.Blurry, 'cleanup_hint_blurry'],
    [CleanupBlurReason.Dark, 'cleanup_hint_dark'],
    [CleanupBlurReason.Bright, 'cleanup_hint_bright'],
  ])('links a photo flagged %s to the Blurry queue', (reason, label) => {
    renderOne(asset({ reason }));

    const hint = screen.getByTestId('cleanup-hint-quality');
    expect(hint).toHaveTextContent(label);
    expect(within(hint).getByRole('link')).toHaveAttribute('href', '/utilities/cleanup/blurry');
    expect(screen.queryByTestId('cleanup-hint-burst')).toBeNull();
  });

  it('shows both hints together', () => {
    renderOne(asset({ reason: CleanupBlurReason.Blurry }), true);

    const card = screen.getByTestId('cleanup-rewind-hints');
    expect(
      within(card)
        .getAllByRole('link')
        .map((link) => link.getAttribute('href')),
    ).toEqual(['/utilities/cleanup/bursts', '/utilities/cleanup/blurry']);
  });
});

describe('RewindOneAtATime layout', () => {
  it('sizes the stage to the photo, so a portrait photo is not boxed into 4:3', () => {
    renderOne(asset({ id: 'tall', width: 3000, height: 4000 }));
    expect(screen.getByTestId('cleanup-rewind-stage-tall').style.aspectRatio).toMatch(/^0.75/);
  });

  it('links to the photo in a new tab', () => {
    renderOne(asset({ id: 'p1' }));
    const link = screen.getByTestId('cleanup-rewind-open-new-tab');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link.getAttribute('href')).toContain('p1');
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
    renderOne(asset({ id: 'p2', localDateTime: '2016-10-29T14:32:00.000Z' }));

    expect(screen.getByTestId('cleanup-rewind-info-date')).toHaveTextContent('2016');
    const people = await screen.findByTestId('cleanup-rewind-info-people');
    expect(people).toHaveTextContent('Anna');
    expect(within(people).queryByRole('button')).not.toBeInTheDocument();
  });
});
