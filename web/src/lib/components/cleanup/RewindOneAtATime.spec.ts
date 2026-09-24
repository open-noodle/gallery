import { AssetTypeEnum, CleanupBlurReason, type CleanupAssetDto } from '@immich/sdk';
import '@testing-library/jest-dom';
import { render, screen, within } from '@testing-library/svelte';
import RewindOneAtATime from '$lib/components/cleanup/RewindOneAtATime.svelte';

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
