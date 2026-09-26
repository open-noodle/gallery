import type { AlbumResponseDto, AssetResponseDto, PersonResponseDto } from '@immich/sdk';
import '@testing-library/jest-dom';
import { render, screen, waitFor, within } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { sdkMock } from '$lib/__mocks__/sdk.mock';
import SuggestionAssetDetails from '$lib/components/faces-page/suggestion-asset-details.svelte';
import { faceSuggestionContextExpanded as expanded } from '$lib/stores/face-suggestion-context.store';
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

const expand = async () => {
  await userEvent.click(screen.getByTestId('suggestion-context-toggle'));
  await screen.findByTestId('suggestion-context-details');
};

// The open/closed preference is module-level and localStorage-backed BY DESIGN — it has to outlive both the
// candidate and the session. That makes it leak between tests, so every test states the state it starts from.
beforeEach(() => expanded.set(false));

describe('suggestion-asset-details — summary row', () => {
  it('shows the taken date from fileCreatedAt without expanding anything', () => {
    render(SuggestionAssetDetails, { props: { assetId: ASSET_ID, fileCreatedAt: '2015-08-12T14:32:00.000Z' } });

    expect(screen.getByTestId('suggestion-context-date')).toHaveTextContent('Aug 12, 2015');
    expect(screen.queryByTestId('suggestion-context-details')).not.toBeInTheDocument();
  });

  it('omits the date row entirely when the suggestion carries no fileCreatedAt', () => {
    render(SuggestionAssetDetails, { props: { assetId: ASSET_ID } });

    expect(screen.queryByTestId('suggestion-context-date')).not.toBeInTheDocument();
  });

  it('links to the asset in a new tab, outside any space', () => {
    render(SuggestionAssetDetails, { props: { assetId: ASSET_ID, fileCreatedAt: '2015-08-12T14:32:00.000Z' } });

    const link = screen.getByTestId('suggestion-context-open');
    expect(link).toHaveAttribute('href', `/photos/${ASSET_ID}`);
    // The whole point of a new tab: the review queue, its position and the append-only `items` buffer all
    // survive the trip. `noopener` because the opened tab must not get a handle on the review window.
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'));
  });

  it('links into the space when the review is running inside one', () => {
    render(SuggestionAssetDetails, {
      props: { assetId: ASSET_ID, fileCreatedAt: '2015-08-12T14:32:00.000Z', spaceId: SPACE_ID },
    });

    // A space viewer may reach this asset ONLY through the space; /photos/{id} enforces the owner's
    // AssetView and would 403 for them.
    expect(screen.getByTestId('suggestion-context-open')).toHaveAttribute(
      'href',
      `/spaces/${SPACE_ID}/photos/${ASSET_ID}`,
    );
  });
});

describe('suggestion-asset-details — the collapsible block', () => {
  beforeEach(() => {
    getAssetMock.mockReset();
    getAssetMock.mockResolvedValue(loadedAsset());
    sdkMock.getAllAlbums.mockReset();
    sdkMock.getAllAlbums.mockResolvedValue([{ id: 'album-1', albumName: 'Spain 2015' }] as AlbumResponseDto[]);
  });

  it('requests nothing at all while it is collapsed', () => {
    render(SuggestionAssetDetails, { props: { assetId: ASSET_ID, fileCreatedAt: '2015-08-12T14:32:00.000Z' } });

    expect(getAssetMock).not.toHaveBeenCalled();
    expect(sdkMock.getAllAlbums).not.toHaveBeenCalled();
  });

  it('loads the asset on expand and shows place, file, camera and album membership', async () => {
    render(SuggestionAssetDetails, { props: { assetId: ASSET_ID, fileCreatedAt: '2015-08-12T14:32:00.000Z' } });

    await expand();

    expect(getAssetMock).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('suggestion-context-location')).toHaveTextContent('Barcelona');
    expect(screen.getByTestId('suggestion-context-file')).toHaveTextContent('IMG_2841.jpg');
    expect(screen.getByTestId('suggestion-context-file')).toHaveTextContent('4032');
    expect(screen.getByTestId('suggestion-context-camera')).toHaveTextContent('Canon');
    expect(await screen.findByTestId('suggestion-context-albums')).toHaveTextContent('Spain 2015');
  });

  it('names the people already recognised in the frame and counts the unnamed ones', async () => {
    render(SuggestionAssetDetails, { props: { assetId: ASSET_ID, fileCreatedAt: '2015-08-12T14:32:00.000Z' } });

    await expand();

    const people = screen.getByTestId('suggestion-context-people');
    expect(people).toHaveTextContent('Alice');
    expect(people).toHaveTextContent('Bob');
    // An unrecognised face has no name to show — it must collapse into the counter rather than render an
    // empty chip.
    expect(within(people).getAllByTestId('suggestion-context-person')).toHaveLength(2);
    expect(people).toHaveTextContent('face_suggestion_unnamed_faces');
  });

  it('scopes the lookup to the space when the review is running inside one', async () => {
    render(SuggestionAssetDetails, {
      props: { assetId: ASSET_ID, fileCreatedAt: '2015-08-12T14:32:00.000Z', spaceId: SPACE_ID },
    });

    await expand();

    expect(getAssetMock).toHaveBeenCalledWith({ id: ASSET_ID, spaceId: SPACE_ID });
  });

  it('does not re-request the asset when collapsed and expanded again', async () => {
    render(SuggestionAssetDetails, { props: { assetId: ASSET_ID, fileCreatedAt: '2015-08-12T14:32:00.000Z' } });
    await expand();

    await userEvent.click(screen.getByTestId('suggestion-context-toggle'));
    await userEvent.click(screen.getByTestId('suggestion-context-toggle'));

    expect(getAssetMock).toHaveBeenCalledTimes(1);
  });

  it('loads the next candidate’s asset when the review advances', async () => {
    const nextAssetId = 'cccccccc-0000-4000-8000-000000000003';
    const { rerender } = render(SuggestionAssetDetails, {
      props: { assetId: ASSET_ID, fileCreatedAt: '2015-08-12T14:32:00.000Z' },
    });
    await expand();

    await rerender({ assetId: nextAssetId, fileCreatedAt: '2016-01-02T09:00:00.000Z' });

    await waitFor(() => expect(getAssetMock).toHaveBeenCalledTimes(2));
    expect(getAssetMock).toHaveBeenLastCalledWith({ id: nextAssetId, spaceId: undefined });
  });

  it('opens already expanded, and loads, when it was left open last time', async () => {
    // The reviewer who wants context wants it for every candidate — and after a reload. Anything less means
    // re-opening the block 73 times in one pass.
    expanded.set(true);

    render(SuggestionAssetDetails, { props: { assetId: ASSET_ID, fileCreatedAt: '2015-08-12T14:32:00.000Z' } });

    expect(await screen.findByTestId('suggestion-context-details')).toBeInTheDocument();
    await waitFor(() => expect(getAssetMock).toHaveBeenCalledTimes(1));
  });

  it('keeps the date and the link usable when the metadata lookup fails', async () => {
    getAssetMock.mockRejectedValue(new Error('nope'));
    render(SuggestionAssetDetails, { props: { assetId: ASSET_ID, fileCreatedAt: '2015-08-12T14:32:00.000Z' } });

    await userEvent.click(screen.getByTestId('suggestion-context-toggle'));
    await waitFor(() => expect(getAssetMock).toHaveBeenCalled());

    // A failed lookup must not cost the reviewer the two things that never needed a request.
    expect(screen.getByTestId('suggestion-context-date')).toBeInTheDocument();
    expect(screen.getByTestId('suggestion-context-open')).toBeInTheDocument();
    expect(screen.queryByTestId('suggestion-context-location')).not.toBeInTheDocument();
  });
});
