import {
  OFFER_TIMEOUT,
  facesToCombine,
  offerVideoFaceCombine,
} from '#lib/gallery/asset-viewer/video-face-combine-offer.ts';
import { videoPersonSightings } from '#lib/gallery/asset-viewer/video-person-sightings.svelte.ts';
import { AssetTypeEnum, type AssetFaceResponseDto } from '@immich/sdk';
import { toastManager } from '@immich/ui';

const { getFacesMock, mergeVideoFacesMock, refreshAssetPeopleMock, handleErrorMock } = vi.hoisted(() => ({
  getFacesMock: vi.fn(),
  mergeVideoFacesMock: vi.fn(),
  refreshAssetPeopleMock: vi.fn().mockResolvedValue(undefined),
  handleErrorMock: vi.fn(),
}));

vi.mock('#lib/utils/handle-error.js', () => ({ handleError: handleErrorMock }));
vi.mock('#lib/utils/refresh-asset-people.js', () => ({ refreshAssetPeople: refreshAssetPeopleMock }));

vi.mock('@immich/sdk', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    getFaces: (...args: unknown[]) => getFacesMock(...args),
    mergeVideoFaces: (...args: unknown[]) => mergeVideoFacesMock(...args),
  };
});

vi.mock('@immich/ui', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    toastManager: { danger: vi.fn(), primary: vi.fn(), success: vi.fn(), warning: vi.fn() },
  };
});

const face = (id: string, person?: { id: string; name: string }) =>
  ({ id, person: person ? { ...person } : null }) as unknown as AssetFaceResponseDto;

const carol = { id: 'person-c', name: 'Carol' };
const dan = { id: 'person-d', name: 'Dan' };

type OfferToast = { description: string; button: { label: string; onclick: () => Promise<void> } };
const offers = () =>
  vi
    .mocked(toastManager.primary)
    .mock.calls.filter(([toast]) => typeof toast === 'object' && 'button' in toast)
    .map(([toast, options]) => ({ toast: toast as OfferToast, options }));

describe('facesToCombine', () => {
  it('lists only the given people who have more than one face', () => {
    const faces = [face('f1', carol), face('f2', carol), face('f3', dan), face('f4', dan), face('f5'), face('f6', dan)];

    expect(facesToCombine(faces, ['person-c'])).toEqual([['person-c', { name: 'Carol', faceIds: ['f1', 'f2'] }]]);
    expect(facesToCombine([face('f1', carol), face('f3', dan)], ['person-c', 'person-d'])).toEqual([]);
  });
});

describe('offerVideoFaceCombine', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    videoPersonSightings.clear();
  });

  it('does nothing for a photo or when no face went to an existing person', async () => {
    await offerVideoFaceCombine({ assetId: 'a1', assetType: AssetTypeEnum.Image, personIds: ['person-c'] });
    await offerVideoFaceCombine({ assetId: 'a1', assetType: AssetTypeEnum.Video, personIds: [] });

    expect(getFacesMock).not.toHaveBeenCalled();
    expect(offers()).toHaveLength(0);
  });

  it('offers to combine a person who now has two faces in the video, and combines on click', async () => {
    getFacesMock.mockResolvedValue([face('f1', carol), face('f2', carol), face('f3', dan)]);
    mergeVideoFacesMock.mockResolvedValue({ faceId: 'f2', sightings: [] });
    videoPersonSightings.current = { assetId: 'a1', personId: 'person-c', name: 'Carol', faceIds: ['f1'] };

    await offerVideoFaceCombine({ assetId: 'a1', assetType: AssetTypeEnum.Video, personIds: ['person-c', 'person-d'] });

    expect(getFacesMock).toHaveBeenCalledWith({ id: 'a1' });
    const [offer] = offers();
    expect(offers()).toHaveLength(1);
    expect(offer.options).toEqual({ timeout: OFFER_TIMEOUT });
    expect(mergeVideoFacesMock).not.toHaveBeenCalled();

    await offer.toast.button.onclick();

    expect(mergeVideoFacesMock).toHaveBeenCalledWith({ videoFaceMergeDto: { faceIds: ['f1', 'f2'] } });
    expect(refreshAssetPeopleMock).toHaveBeenCalledWith('a1');
    expect(videoPersonSightings.current?.faceIds).toEqual(['f2']);
  });

  it('does not offer a split the edit did not touch', async () => {
    getFacesMock.mockResolvedValue([face('f1', carol), face('f2', carol), face('f3', dan)]);

    await offerVideoFaceCombine({ assetId: 'a1', assetType: AssetTypeEnum.Video, personIds: ['person-d'] });

    expect(offers()).toHaveLength(0);
  });

  it('stays quiet when the faces cannot be read', async () => {
    getFacesMock.mockRejectedValue(new Error('offline'));

    await expect(
      offerVideoFaceCombine({ assetId: 'a1', assetType: AssetTypeEnum.Video, personIds: ['person-c'] }),
    ).resolves.toBeUndefined();
    expect(offers()).toHaveLength(0);
  });

  it('reports a failed combine and still refreshes the people', async () => {
    getFacesMock.mockResolvedValue([face('f1', carol), face('f2', carol)]);
    mergeVideoFacesMock.mockRejectedValue(new Error('nope'));

    await offerVideoFaceCombine({ assetId: 'a1', assetType: AssetTypeEnum.Video, personIds: ['person-c'] });
    await offers()[0].toast.button.onclick();

    expect(handleErrorMock).toHaveBeenCalledOnce();
    expect(refreshAssetPeopleMock).toHaveBeenCalledWith('a1');
  });
});
