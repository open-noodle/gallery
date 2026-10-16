import type { AlbumResponseDto, AssetResponseDto, PersonResponseDto } from '@immich/sdk';
import '@testing-library/jest-dom';
import { render, screen, waitFor, within } from '@testing-library/svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { sdkMock } from '$lib/__mocks__/sdk.mock';
import SuggestionAssetDetails from '$lib/gallery/people/suggestion-asset-details.svelte';
import { assetFactory } from '@test-data/factories/asset-factory';

vi.mock('svelte-i18n', () => ({
  t: { subscribe: (run: (f: (k: string) => string) => void) => (run((k) => k), () => {}) },
  locale: { subscribe: (run: (v: string) => void) => (run('en-US'), () => {}) },
}));

const getAssetMock = vi.hoisted(() => vi.fn());
vi.mock('$lib/managers/AssetCacheManager.svelte', () => ({ assetCacheManager: { getAsset: getAssetMock } }));

const ASSET_ID = 'aaaaaaaa-0000-4000-8000-000000000001';
const SPACE_ID = 'bbbbbbbb-0000-4000-8000-000000000002';

const person = (name: string): PersonResponseDto =>
  ({ id: `person-${name || 'unnamed'}`, name, updatedAt: '2026-01-01T00:00:00.000Z' }) as PersonResponseDto;

const loadedAsset = (overrides: Partial<AssetResponseDto> = {}): AssetResponseDto =>
  assetFactory.build({
    id: ASSET_ID,
    originalFileName: 'IMG_2841.jpg',
    localDateTime: '2015-08-12T14:32:00.000Z',
    people: [person('Alice'), person('Bob'), person('')],
    exifInfo: {
      city: 'Barcelona',
      state: 'Catalonia',
      country: 'Spain',
      make: 'Canon',
      model: 'EOS R6',
      exifImageWidth: 4032,
      exifImageHeight: 3024,
      fileSizeInByte: 4_100_000,
      dateTimeOriginal: '2015-08-12T14:32:00.000Z',
    },
    ...overrides,
  });

describe('suggestion-asset-details', () => {
  beforeEach(() => {
    getAssetMock.mockReset();
    getAssetMock.mockResolvedValue(loadedAsset());
    sdkMock.getAllAlbums.mockReset();
    sdkMock.getAllAlbums.mockResolvedValue([{ id: 'album-1', albumName: 'Spain 2015' }] as AlbumResponseDto[]);
  });

  it('loads the asset and shows place, file, camera and album membership', async () => {
    render(SuggestionAssetDetails, { props: { assetId: ASSET_ID } });

    await screen.findByTestId('suggestion-context-location');
    expect(getAssetMock).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('suggestion-context-location')).toHaveTextContent('Barcelona');
    expect(screen.getByTestId('suggestion-context-file')).toHaveTextContent('IMG_2841.jpg');
    expect(screen.getByTestId('suggestion-context-file')).toHaveTextContent('4032');
    expect(screen.getByTestId('suggestion-context-camera')).toHaveTextContent('Canon');
    expect(await screen.findByTestId('suggestion-context-albums')).toHaveTextContent('Spain 2015');
  });

  it('names the people already recognised in the frame and counts the unnamed ones', async () => {
    render(SuggestionAssetDetails, { props: { assetId: ASSET_ID } });

    const people = await screen.findByTestId('suggestion-context-people');
    expect(people).toHaveTextContent('Alice');
    expect(people).toHaveTextContent('Bob');
    // An unrecognised face has no name to show — it must collapse into the counter rather than render an
    // empty chip.
    expect(within(people).getAllByTestId('suggestion-context-person')).toHaveLength(2);
    expect(people).toHaveTextContent('face_suggestion_unnamed_faces');
  });

  it('scopes the lookup to the space when the review is running inside one', async () => {
    render(SuggestionAssetDetails, {
      props: { assetId: ASSET_ID, spaceId: SPACE_ID },
    });

    await waitFor(() => expect(getAssetMock).toHaveBeenCalledWith({ id: ASSET_ID, spaceId: SPACE_ID }));
  });

  // Asset detail read through a space resolves each face to the space's person and says so with `spacePersonId`;
  // that profile's face lives behind the space thumbnail route, as the Info panel renders it.
  it('shows a space person with the space profile’s face', async () => {
    getAssetMock.mockResolvedValueOnce(
      loadedAsset({ people: [{ ...person('Alice'), spacePersonId: 'space-alice' } as PersonResponseDto] }),
    );
    render(SuggestionAssetDetails, {
      props: { assetId: ASSET_ID, spaceId: SPACE_ID },
    });

    const avatar = within(await screen.findByTestId('suggestion-context-person')).getByRole('presentation');
    expect(avatar.getAttribute('src')).toContain(`/shared-spaces/${SPACE_ID}/people/space-alice/thumbnail`);
  });

  it('loads the next candidate’s asset when the review advances', async () => {
    const nextAssetId = 'cccccccc-0000-4000-8000-000000000003';
    const { rerender } = render(SuggestionAssetDetails, { props: { assetId: ASSET_ID } });
    await waitFor(() => expect(getAssetMock).toHaveBeenCalledTimes(1));

    await rerender({ assetId: nextAssetId });

    await waitFor(() => expect(getAssetMock).toHaveBeenCalledTimes(2));
    expect(getAssetMock).toHaveBeenLastCalledWith({ id: nextAssetId, spaceId: undefined });
  });

  it('stays empty, without throwing, when the metadata lookup fails', async () => {
    getAssetMock.mockRejectedValue(new Error('nope'));
    render(SuggestionAssetDetails, { props: { assetId: ASSET_ID } });

    await waitFor(() => expect(getAssetMock).toHaveBeenCalled());

    // The summary row's date and link never needed this request; the panel just has nothing to show.
    expect(screen.getByTestId('suggestion-context-details')).toBeInTheDocument();
    expect(screen.queryByTestId('suggestion-context-location')).not.toBeInTheDocument();
  });
});
