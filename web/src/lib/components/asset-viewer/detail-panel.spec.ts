import {
  AssetTypeEnum,
  AssetVisibility,
  type AssetFaceResponseDto,
  type AssetResponseDto,
  type PersonResponseDto,
} from '@immich/sdk';
import '@testing-library/jest-dom';
import { screen, waitFor, within } from '@testing-library/svelte';
import { getAppleMapsUrl, getGoogleMapsUrl, getOpenStreetMapUrl } from '$lib/utils/exif-utils';
import { renderWithTooltips } from '$tests/helpers';
import { assetFactory } from '@test-data/factories/asset-factory';
import DetailPanel from './DetailPanel.svelte';

const { authManagerMock, faceManagerMock, getAllAlbumsMock, getAssetInfoMock, zoomImageToBase64Mock } = vi.hoisted(
  () => ({
    authManagerMock: {
      authenticated: true,
      user: { id: 'owner-1' },
      isSharedLink: false,
      params: {},
      preferences: {
        tags: { enabled: false },
        ratings: { enabled: false },
      },
    },
    faceManagerMock: {
      data: [] as AssetFaceResponseDto[],
      facesByPersonId: new Map<string, AssetFaceResponseDto[]>(),
      people: [] as PersonResponseDto[],
    },
    getAllAlbumsMock: vi.fn(),
    getAssetInfoMock: vi.fn(),
    zoomImageToBase64Mock: vi.fn(),
  }),
);

vi.mock('@immich/sdk', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@immich/sdk')>();
  return {
    ...actual,
    getAllAlbums: getAllAlbumsMock,
    getAssetInfo: getAssetInfoMock,
  };
});

vi.mock('$app/navigation', () => ({ goto: vi.fn().mockResolvedValue(undefined) }));

vi.mock('$lib/utils/people-utils', () => ({
  zoomImageToBase64: zoomImageToBase64Mock,
}));

vi.mock('$lib/stores/face.svelte', () => ({
  faceManager: faceManagerMock,
}));

vi.mock('$lib/managers/auth-manager.svelte', () => ({ authManager: authManagerMock }));

vi.mock('$lib/managers/asset-viewer-manager.svelte', () => ({
  assetViewerManager: {
    closeDetailPanel: vi.fn(),
    closeEditFacesPanel: vi.fn(),
    clearHighlightedFaces: vi.fn(),
    highlightedFaces: [],
    isEditFacesPanelOpen: false,
    isShowAssetPath: false,
    openEditFacesPanel: vi.fn(),
    setHighlightedFaces: vi.fn(),
    toggleAssetPath: vi.fn(),
    toggleFaceEditMode: vi.fn(),
  },
}));

vi.mock('$lib/managers/feature-flags-manager.svelte', () => ({
  featureFlagsManager: {
    value: {
      map: true,
      smartSearch: false,
    },
  },
}));

vi.mock('$lib/components/shared-components/map/Map.svelte', async () => {
  const { default: MockComponent } = await import('@test-data/mocks/map-component.stub.svelte');
  return { default: MockComponent };
});

// #734: these five stand in for the row-probe stub (echoes `isOwner`/`canEdit` as data
// attributes) rather than the plain noop, so the editability-propagation tests below can assert
// on what DetailPanel actually threaded down to each row.
vi.mock('$lib/components/asset-viewer/DetailPanelDate.svelte', async () => {
  const { default: MockComponent } = await import('@test-data/mocks/detail-panel-row-probe.stub.svelte');
  return { default: MockComponent };
});

vi.mock('$lib/components/asset-viewer/DetailPanelDescription.svelte', async () => {
  const { default: MockComponent } = await import('@test-data/mocks/detail-panel-row-probe.stub.svelte');
  return { default: MockComponent };
});

vi.mock('$lib/components/asset-viewer/DetailPanelLocation.svelte', async () => {
  const { default: MockComponent } = await import('@test-data/mocks/detail-panel-row-probe.stub.svelte');
  return { default: MockComponent };
});

vi.mock('$lib/components/asset-viewer/DetailPanelStarRating.svelte', async () => {
  const { default: MockComponent } = await import('@test-data/mocks/detail-panel-row-probe.stub.svelte');
  return { default: MockComponent };
});

vi.mock('$lib/components/asset-viewer/DetailPanelTags.svelte', async () => {
  const { default: MockComponent } = await import('@test-data/mocks/detail-panel-row-probe.stub.svelte');
  return { default: MockComponent };
});

vi.mock('$lib/components/faces-page/person-side-panel.svelte', async () => {
  const { default: MockComponent } = await import('@test-data/mocks/noop-component.svelte');
  return { default: MockComponent };
});

vi.mock('$lib/components/OnEvents.svelte', async () => {
  const { default: MockComponent } = await import('@test-data/mocks/noop-component.svelte');
  return { default: MockComponent };
});

vi.mock('$lib/components/shared-components/UserAvatar.svelte', async () => {
  const { default: MockComponent } = await import('@test-data/mocks/noop-component.svelte');
  return { default: MockComponent };
});

vi.mock('$lib/components/asset-viewer/AlbumListItemDetails.svelte', async () => {
  const { default: MockComponent } = await import('@test-data/mocks/noop-component.svelte');
  return { default: MockComponent };
});

vi.mock('$lib/components/shared-components/LoadingSpinner.svelte', async () => {
  const { default: MockComponent } = await import('@test-data/mocks/noop-component.svelte');
  return { default: MockComponent };
});

describe('DetailPanel', () => {
  const makeFace = (
    id: string,
    person: PersonResponseDto,
    bounds: Pick<AssetFaceResponseDto, 'boundingBoxX1' | 'boundingBoxX2' | 'boundingBoxY1' | 'boundingBoxY2'>,
  ): AssetFaceResponseDto => ({
    id,
    imageWidth: 1000,
    imageHeight: 800,
    ...bounds,
    person,
  });

  beforeEach(() => {
    vi.clearAllMocks();
    authManagerMock.user = { id: 'owner-1' };
    authManagerMock.preferences.tags.enabled = false;
    authManagerMock.preferences.ratings.enabled = false;
    faceManagerMock.data = [];
    faceManagerMock.facesByPersonId = new Map();
    faceManagerMock.people = [];
    getAllAlbumsMock.mockResolvedValue([]);
    getAssetInfoMock.mockResolvedValue(undefined);
    zoomImageToBase64Mock.mockResolvedValue(null);
  });

  it('uses the detected face crop instead of the shared-space person thumbnail when spacePersonId is present', async () => {
    zoomImageToBase64Mock.mockResolvedValue('data:image/jpeg;base64,current-face');

    const person: PersonResponseDto = {
      id: 'global-person-1',
      name: 'Alice',
      thumbnailPath: '/ignored.jpg',
      updatedAt: '2026-01-02T00:00:00.000Z',
      isHidden: false,
      birthDate: null,
      type: 'person',
      spacePersonId: 'space-person-1',
    };
    const face = makeFace('face-1', person, {
      boundingBoxX1: 100,
      boundingBoxY1: 200,
      boundingBoxX2: 300,
      boundingBoxY2: 400,
    });
    faceManagerMock.data = [face];
    faceManagerMock.people = [person];
    faceManagerMock.facesByPersonId = new Map([[person.id, [face]]]);

    const asset: AssetResponseDto = {
      id: 'asset-1',
      ownerId: 'owner-1',
      libraryId: 'library-1',
      type: AssetTypeEnum.Image,
      originalPath: '/library/asset-1.jpg',
      originalFileName: 'asset-1.jpg',
      originalMimeType: 'image/jpeg',
      thumbhash: 'thumbhash',
      createdAt: '2026-01-01T00:00:00.000Z',
      fileCreatedAt: '2026-01-01T00:00:00.000Z',
      fileModifiedAt: '2026-01-01T00:00:00.000Z',
      localDateTime: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      isFavorite: false,
      isArchived: false,
      isTrashed: false,
      duration: null,
      checksum: 'checksum',
      isOffline: false,
      hasMetadata: false,
      visibility: AssetVisibility.Timeline,
      width: 1000,
      height: 800,
      isEdited: false,
      people: [person],
    };

    const { container } = renderWithTooltips(DetailPanel, {
      asset,
      currentAlbum: null,
      spaceId: 'space-1',
    });

    await waitFor(() => expect(zoomImageToBase64Mock).toHaveBeenCalledWith(face, asset.id, asset.type, undefined));

    const croppedFace = container.querySelector('img[src="data:image/jpeg;base64,current-face"]');
    expect(croppedFace).toBeTruthy();
    expect(container.querySelector('img[src*="/shared-spaces/space-1/people/space-person-1/thumbnail"]')).toBeNull();
  });

  it('renders distinct detected face crops when multiple people resolve to the same space person', async () => {
    zoomImageToBase64Mock
      .mockResolvedValueOnce('data:image/jpeg;base64,first-face')
      .mockResolvedValueOnce('data:image/jpeg;base64,second-face');

    const alice: PersonResponseDto = {
      id: 'global-person-1',
      name: 'Alice',
      thumbnailPath: '/ignored-1.jpg',
      updatedAt: '2026-01-02T00:00:00.000Z',
      isHidden: false,
      birthDate: null,
      type: 'person',
      spacePersonId: 'space-person-1',
    };
    const bob: PersonResponseDto = {
      id: 'global-person-2',
      name: 'Bob',
      thumbnailPath: '/ignored-2.jpg',
      updatedAt: '2026-01-03T00:00:00.000Z',
      isHidden: false,
      birthDate: null,
      type: 'person',
      spacePersonId: 'space-person-1',
    };
    const aliceFace = makeFace('face-1', alice, {
      boundingBoxX1: 100,
      boundingBoxY1: 200,
      boundingBoxX2: 300,
      boundingBoxY2: 400,
    });
    const bobFace = makeFace('face-2', bob, {
      boundingBoxX1: 500,
      boundingBoxY1: 200,
      boundingBoxX2: 700,
      boundingBoxY2: 400,
    });
    faceManagerMock.data = [aliceFace, bobFace];
    faceManagerMock.people = [alice, bob];
    faceManagerMock.facesByPersonId = new Map([
      [alice.id, [aliceFace]],
      [bob.id, [bobFace]],
    ]);

    const asset: AssetResponseDto = {
      id: 'asset-1',
      ownerId: 'owner-1',
      libraryId: 'library-1',
      type: AssetTypeEnum.Image,
      originalPath: '/library/asset-1.jpg',
      originalFileName: 'asset-1.jpg',
      originalMimeType: 'image/jpeg',
      thumbhash: 'thumbhash',
      createdAt: '2026-01-01T00:00:00.000Z',
      fileCreatedAt: '2026-01-01T00:00:00.000Z',
      fileModifiedAt: '2026-01-01T00:00:00.000Z',
      localDateTime: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      isFavorite: false,
      isArchived: false,
      isTrashed: false,
      duration: null,
      checksum: 'checksum',
      isOffline: false,
      hasMetadata: false,
      visibility: AssetVisibility.Timeline,
      width: 1000,
      height: 800,
      isEdited: false,
      people: [alice, bob],
    };

    const { container } = renderWithTooltips(DetailPanel, {
      asset,
      currentAlbum: null,
      spaceId: 'space-1',
    });

    await waitFor(() => expect(zoomImageToBase64Mock).toHaveBeenCalledTimes(2));

    expect(container.querySelector('img[src="data:image/jpeg;base64,first-face"]')).toBeTruthy();
    expect(container.querySelector('img[src="data:image/jpeg;base64,second-face"]')).toBeTruthy();
    expect(
      container.querySelectorAll('img[src*="/shared-spaces/space-1/people/space-person-1/thumbnail"]'),
    ).toHaveLength(0);
  });

  // #808: for the owner the People section renders `faceManager.people` (GET /faces), not
  // `asset.people`. The server now resolves a birthday that only lives on a shared-space profile
  // onto that payload, so the age must appear here. The birth date is asserted via the title
  // attribute because it is locale-formatted by luxon rather than translated.
  it('renders the age for a person whose birthday arrives on the faces payload', async () => {
    const person: PersonResponseDto = {
      id: 'global-person-1',
      name: 'Karolin',
      thumbnailPath: '/person.jpg',
      updatedAt: '2026-01-02T00:00:00.000Z',
      isHidden: false,
      birthDate: '2014-02-14',
      type: 'person',
    };
    const face = makeFace('face-1', person, {
      boundingBoxX1: 100,
      boundingBoxY1: 200,
      boundingBoxX2: 300,
      boundingBoxY2: 400,
    });
    faceManagerMock.data = [face];
    faceManagerMock.people = [person];
    faceManagerMock.facesByPersonId = new Map([[person.id, [face]]]);

    const asset = assetFactory.build({
      ownerId: 'owner-1',
      localDateTime: '2026-01-01T00:00:00.000Z',
      people: [],
    });

    const { container } = renderWithTooltips(DetailPanel, { asset, currentAlbum: null });

    await waitFor(() => expect(screen.getByText('Karolin')).toBeInTheDocument());
    expect(container.querySelector('p[title="February 14, 2014"]')).toBeTruthy();
  });

  it('renders no age for a person without a birthday', async () => {
    const person: PersonResponseDto = {
      id: 'global-person-1',
      name: 'Karolin',
      thumbnailPath: '/person.jpg',
      updatedAt: '2026-01-02T00:00:00.000Z',
      isHidden: false,
      birthDate: null,
      type: 'person',
    };
    const face = makeFace('face-1', person, {
      boundingBoxX1: 100,
      boundingBoxY1: 200,
      boundingBoxX2: 300,
      boundingBoxY2: 400,
    });
    faceManagerMock.data = [face];
    faceManagerMock.people = [person];
    faceManagerMock.facesByPersonId = new Map([[person.id, [face]]]);

    const asset = assetFactory.build({
      ownerId: 'owner-1',
      localDateTime: '2026-01-01T00:00:00.000Z',
      people: [],
    });

    const { container } = renderWithTooltips(DetailPanel, { asset, currentAlbum: null });

    await waitFor(() => expect(screen.getByText('Karolin')).toBeInTheDocument());
    expect(container.querySelector('p[title*="2014"]')).toBeNull();
  });

  it('renders no age when the birthday is after the photo was taken', async () => {
    const person: PersonResponseDto = {
      id: 'global-person-1',
      name: 'Karolin',
      thumbnailPath: '/person.jpg',
      updatedAt: '2026-01-02T00:00:00.000Z',
      isHidden: false,
      birthDate: '2027-02-14',
      type: 'person',
    };
    const face = makeFace('face-1', person, {
      boundingBoxX1: 100,
      boundingBoxY1: 200,
      boundingBoxX2: 300,
      boundingBoxY2: 400,
    });
    faceManagerMock.data = [face];
    faceManagerMock.people = [person];
    faceManagerMock.facesByPersonId = new Map([[person.id, [face]]]);

    const asset = assetFactory.build({
      ownerId: 'owner-1',
      localDateTime: '2026-01-01T00:00:00.000Z',
      people: [],
    });

    const { container } = renderWithTooltips(DetailPanel, { asset, currentAlbum: null });

    await waitFor(() => expect(screen.getByText('Karolin')).toBeInTheDocument());
    expect(container.querySelector('p[title*="2027"]')).toBeNull();
  });

  // #732's camera/lens `withSharedSpaces` tests used to live here. They asserted on the `/search`
  // anchors, which this branch retires in favour of contextual filtering — see
  // __tests__/detail-panel-filters.spec.ts, which carries the same shared-space guarantee against
  // the affordances that replaced them.

  it('renders Google, Apple, and OpenStreetMap links in the image info panel map popup', async () => {
    const lat = 48.85341;
    const lon = 2.3488;
    const asset = assetFactory.build({
      id: 'asset-with-location',
      ownerId: 'owner-1',
      exifInfo: {
        latitude: lat,
        longitude: lon,
        city: 'Paris',
        country: 'France',
      },
    });

    renderWithTooltips(DetailPanel, { asset });

    await waitFor(() => expect(screen.getByTestId('map-popup')).toBeInTheDocument());

    const googleLink = screen.getByRole('link', { name: 'open_in_google_maps' });
    const appleLink = screen.getByRole('link', { name: 'open_in_apple_maps' });
    const openStreetMapLink = screen.getByRole('link', { name: 'open_in_openstreetmap' });

    expect(googleLink).toHaveAttribute('href', getGoogleMapsUrl(lat, lon));
    expect(appleLink).toHaveAttribute('href', getAppleMapsUrl(lat, lon));
    expect(openStreetMapLink).toHaveAttribute('href', getOpenStreetMapUrl(lat, lon));

    for (const link of [googleLink, appleLink, openStreetMapLink]) {
      expect(link).toHaveAttribute('target', '_blank');
      expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    }
  });

  // #734: DetailPanel derives `canEdit` (server-authoritative `asset.canEdit`, ownership
  // fallback) and threads it into five metadata rows in place of `isOwner`. Description, Rating,
  // Date, Location and Tags's "add tag" affordance are asserted here via the row-probe stub
  // (`detail-panel-row-probe.stub.svelte`), which echoes the `isOwner`/`canEdit` prop it actually
  // received as data attributes — this is the only way to observe the value DetailPanel threaded
  // down, since the real row components are mocked away elsewhere in this file. Row order in the
  // DOM mirrors DetailPanel.svelte's fixed template order: Description, Rating, [People — real
  // component, not part of this probe list], Date, Location, Tags.
  describe('editability propagation to child rows (#734)', () => {
    it('widens description/rating/date/location and tags-add to a non-owner space editor when canEdit is true', async () => {
      authManagerMock.preferences.tags.enabled = true;
      const asset = assetFactory.build({ ownerId: 'someone-else', canEdit: true, tags: [] });

      renderWithTooltips(DetailPanel, { asset, currentAlbum: null });

      await waitFor(() => expect(screen.getAllByTestId('detail-panel-row-probe')).toHaveLength(5));
      const [descriptionProbe, ratingProbe, dateProbe, locationProbe, tagsProbe] =
        screen.getAllByTestId('detail-panel-row-probe');

      for (const probe of [descriptionProbe, ratingProbe, dateProbe, locationProbe]) {
        expect(probe).toHaveAttribute('data-is-owner', 'true');
      }
      // Tags is the one row fed BOTH values: real ownership stays false (per-tag remove must
      // stay gated on it — fix #1), while the add-tag affordance widens via `canEdit`.
      expect(tagsProbe).toHaveAttribute('data-is-owner', 'false');
      expect(tagsProbe).toHaveAttribute('data-can-edit', 'true');
    });

    it('keeps the rows real-owner-gated for a non-owner when canEdit is false', async () => {
      authManagerMock.preferences.tags.enabled = true;
      const asset = assetFactory.build({ ownerId: 'someone-else', canEdit: false, tags: [] });

      renderWithTooltips(DetailPanel, { asset, currentAlbum: null });

      await waitFor(() => expect(screen.getAllByTestId('detail-panel-row-probe')).toHaveLength(5));
      const [descriptionProbe, ratingProbe, dateProbe, locationProbe, tagsProbe] =
        screen.getAllByTestId('detail-panel-row-probe');

      // Only Tags receives an explicit `canEdit` prop (DetailPanel.svelte:546); Description,
      // Rating, Date and Location receive `isOwner={canEdit}` with no separate `canEdit` prop, so
      // the stub's `data-can-edit` for those four is `String(!!undefined)` === 'false' regardless
      // of state — asserting it there would pass either way (fix #7). Assert it only where the
      // prop is actually threaded.
      for (const probe of [descriptionProbe, ratingProbe, dateProbe, locationProbe]) {
        expect(probe).toHaveAttribute('data-is-owner', 'false');
      }
      expect(tagsProbe).toHaveAttribute('data-is-owner', 'false');
      expect(tagsProbe).toHaveAttribute('data-can-edit', 'false');
    });

    // W-18, the hard rule of this task: `canEdit` must never reach the people row. It keeps the
    // real `isOwner`, so a non-owner space editor still gets no add-face affordance even though
    // every other row on this same asset just widened.
    it('W-18: keeps the people row read-only for a non-owner space editor even when canEdit is true', async () => {
      const person: PersonResponseDto = {
        id: 'global-person-1',
        name: 'Nora',
        thumbnailPath: '/person.jpg',
        updatedAt: '2026-01-02T00:00:00.000Z',
        isHidden: false,
        birthDate: null,
        type: 'person',
      };
      faceManagerMock.people = [person];

      const asset = assetFactory.build({ ownerId: 'someone-else', canEdit: true });

      renderWithTooltips(DetailPanel, { asset, currentAlbum: null });

      const peopleSection = await screen.findByTestId('detail-panel-people');
      expect(within(peopleSection).getByText('Nora')).toBeInTheDocument();
      expect(within(peopleSection).queryByLabelText('tag_people')).toBeNull();
    });
  });
});
