import { AssetOrder, AssetTypeEnum, AssetVisibility, type AlbumResponseDto, type AssetResponseDto } from '@immich/sdk';
import '@testing-library/jest-dom';
import { fireEvent, screen, waitFor } from '@testing-library/svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createFilterState, type FilterState } from '$lib/components/filter-panel/filter-panel';
import { buildAlbumTimelineOptions } from '$lib/utils/album-filter-options';
import { decodeFilterParams } from '$lib/utils/filter-url';
import { buildMapTimeBucketOptions } from '$lib/utils/map-filter-options';
import { buildPhotosTimelineOptions } from '$lib/utils/photos-filter-options';
import { buildSpaceTimelineOptions } from '$lib/utils/space-filter-options';
import { renderWithTooltips } from '$tests/helpers';
import { assetFactory } from '@test-data/factories/asset-factory';
import { reactivePageMock as mockPage } from '@test-data/mocks/reactive-page.mock.svelte';
import DetailPanel from '../DetailPanel.svelte';

/**
 * P1 (spec §5.6) — THE property of the whole feature:
 *
 *   > After clicking a metadata value on asset A, the resulting filtered result set CONTAINS A.
 *
 * i.e. the filter you clicked can never hide the photo you clicked it on.
 *
 * WHY THIS IS NOT "decode(encode(patch)) === patch":
 * there is no result set client-side, so the naive version of this test is a TAUTOLOGY that passes
 * for every bug it exists to catch — including R8 (a `space-person:<uuid>` token in `spacePersonIds`,
 * which the server rejects outright: 400, the whole Space timeline errors out). So this file runs the
 * REAL pipeline, end to end, and then judges the result against the SERVER'S OWN predicates:
 *
 *   the row's own patch, built by the REAL component (never re-implemented here — that is the point:
 *   an append-instead-of-replace or a wrong id shape lives in the component, and a harness that
 *   builds its own patch would never see it)
 *     → applyContextualFilter / buildContextualFilterUrl  (the real URL the click navigates to)
 *     → decodeFilterParams                                (the real hydration the destination does)
 *     → the surface's REAL options builder                (buildPhotos/Space/Album/MapTimeBucketOptions)
 *     → expectOptionsToMatchSubject                       (a mirror of withTimeBucketAssetFilters)
 *
 * The matcher mirrors `server/src/repositories/asset.repository.ts` `withTimeBucketAssetFilters`,
 * which is the ONE query behind all four surfaces' timelines:
 *   - make / model / lensModel / city / state / country / ownerId → `=`      (exact)
 *   - description / originalFileName                              → ILIKE %…% (substring)
 *   - rating                                                      → `>=`
 *   - tagIds                                                      → withAnyTagId  (ANY-OF)
 *   - personIds (hasPeople) / spacePersonIds (hasSpacePeople)     → AND (every id must be on the asset)
 *   - albumId                                                     → inner join album_asset
 *   - takenAfter <= asset.localDateTime <= takenBefore
 *
 * And `expectServerIdShapes` mirrors `time-bucket.dto.ts`'s zod: every id the query carries must be
 * the shape the server accepts, or the request is a 400 rather than a wrong result. `spacePersonIds`
 * is `z.array(z.uuidv4())` — a BARE uuid — while `personIds` is the only field that takes a scoped
 * token. That single assertion is what catches R8.
 */

const { gotoMock, getAllAlbumsMock, getAssetInfoMock, faceManagerMock, zoomImageToBase64Mock } = vi.hoisted(() => ({
  gotoMock: vi.fn().mockResolvedValue(undefined),
  getAllAlbumsMock: vi.fn(),
  getAssetInfoMock: vi.fn(),
  faceManagerMock: {
    data: [] as unknown[],
    people: [] as unknown[],
    facesByPersonId: new Map<string, unknown[]>(),
  },
  zoomImageToBase64Mock: vi.fn(),
}));

vi.mock('@immich/sdk', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@immich/sdk')>();
  return { ...actual, getAllAlbums: getAllAlbumsMock, getAssetInfo: getAssetInfoMock };
});

vi.mock('$app/navigation', () => ({ goto: gotoMock }));

vi.mock('$app/state', async () => {
  const { reactivePageMock } = await import('@test-data/mocks/reactive-page.mock.svelte');
  return { page: reactivePageMock };
});

vi.mock('$lib/stores/face.svelte', () => ({ faceManager: faceManagerMock }));
vi.mock('$lib/utils/people-utils', () => ({ zoomImageToBase64: zoomImageToBase64Mock }));

const authManagerMock = vi.hoisted(() => ({
  authenticated: true,
  user: { id: '11111111-0000-4000-8000-000000000001' },
  isSharedLink: false,
  params: {},
  preferences: { tags: { enabled: true }, ratings: { enabled: true } },
}));

vi.mock('$lib/managers/auth-manager.svelte', () => ({ authManager: authManagerMock }));

vi.mock('$lib/managers/asset-viewer-manager.svelte', () => ({
  assetViewerManager: {
    clearHighlightedFaces: vi.fn(),
    closeDetailPanel: vi.fn(),
    closeEditFacesPanel: vi.fn(),
    highlightedFaces: [] as unknown[],
    imgRef: undefined,
    isEditFacesPanelOpen: false,
    isShowAssetPath: false,
    isShowingHiddenPeople: false,
    openEditFacesPanel: vi.fn(),
    setHighlightedFaces: vi.fn(),
    toggleAssetPath: vi.fn(),
    toggleFaceEditMode: vi.fn(),
    toggleHiddenPeople: vi.fn(),
  },
}));

vi.mock('$lib/managers/feature-flags-manager.svelte', () => ({
  featureFlagsManager: { value: { map: false, smartSearch: false, search: false, trash: true } },
}));

vi.mock('$lib/components/shared-components/map/Map.svelte', async () => {
  const { default: MockComponent } = await import('@test-data/mocks/map-component.stub.svelte');
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

// Every id the timeline DTO carries is a uuid v4 server-side (time-bucket.dto.ts), so the fixtures
// are uuids too: a fixture like 'tag-1' would make the shape assertions below meaningless.
const VIEWER_ID = '11111111-0000-4000-8000-000000000001';
const ASSET_OWNER_ID = '22222222-0000-4000-8000-000000000002';
const SPACE_ID = '33333333-0000-4000-8000-000000000003';
const CURRENT_ALBUM_ID = '44444444-0000-4000-8000-000000000004';
const OTHER_ALBUM_ID = '55555555-0000-4000-8000-000000000005';
const TAG_ID = '66666666-0000-4000-8000-000000000006';
const OTHER_TAG_ID = '77777777-0000-4000-8000-000000000007';
const PERSON_ID = '88888888-0000-4000-8000-000000000008';
const SPACE_PERSON_ID = '99999999-0000-4000-8000-000000000009';
const OTHER_SPACE_PERSON_ID = 'aaaaaaaa-0000-4000-8000-00000000000a';

const CAMERA_LABEL = 'Canon EOS R5';
const LENS = 'RF 24-70mm f/2.8L';
const CITY = 'Berlin';
const STATE = 'Brandenburg';
const COUNTRY = 'Germany';
const DESCRIPTION = 'Sunrise over the harbour';
const FILENAME = 'IMG_1234.jpg';
const FILENAME_BASENAME = 'IMG_1234';
const RATING = 4;
const PERSON_NAME = 'Alice';
const OWNER_NAME = 'Bob';

const OWNER = {
  id: ASSET_OWNER_ID,
  name: OWNER_NAME,
  email: 'bob@example.com',
  profileImagePath: '',
  avatarColor: 'primary',
  profileChangedAt: '2026-01-01T00:00:00.000Z',
} as AssetResponseDto['owner'];

// `spacePersonId` is the fork's asset-viewer-only extension to the person shape (asset.service.ts
// resolves it for a space member); it is not on the generated PersonResponseDto, hence the cast.
const SPACE_PERSON = {
  id: PERSON_ID,
  spacePersonId: SPACE_PERSON_ID,
  name: PERSON_NAME,
  birthDate: null,
  isHidden: false,
  thumbnailPath: '/thumb',
  updatedAt: '2026-01-01T00:00:00.000Z',
  faces: [],
} as unknown as NonNullable<AssetResponseDto['people']>[number];

/**
 * The one asset every row is clicked on: a SHARED-SPACE asset (owned by someone else, in a space I
 * am a member of). That is deliberate — it is the only fixture on which every row, INCLUDING the
 * person row, renders an affordance on all four surfaces, and it is the exact shape R8 is about: the
 * same person must go out as a bare `spacePersonId` inside the Space and as a `space-person:` token
 * on /photos.
 *
 * E14 — the date fixture is the plan's: 01:00 on 1 Jan in Auckland is 31 Dec in UTC, and
 * `localDateTime` is the naive local wall clock stamped `Z` (what the server buckets on). A patch
 * derived from anything but the DISPLAYED day (a UTC re-bucketing, or fileCreatedAt) yields
 * 2025-12-31, whose day range then excludes this asset's own localDateTime → P1 goes red.
 */
const buildSubjectAsset = (): AssetResponseDto =>
  assetFactory.build({
    id: 'a5e70000-0000-4000-8000-00000000000f',
    ownerId: ASSET_OWNER_ID,
    owner: OWNER,
    type: AssetTypeEnum.Image,
    visibility: AssetVisibility.Timeline,
    originalFileName: FILENAME,
    originalPath: `/photos/${FILENAME}`,
    localDateTime: '2026-01-01T01:00:00.000Z',
    fileCreatedAt: '2025-12-31T12:00:00.000Z',
    resolvedSpaceId: SPACE_ID,
    tags: [{ id: TAG_ID, value: 'holiday/2026', name: '2026', createdAt: '', updatedAt: '' }],
    people: [SPACE_PERSON],
    exifInfo: {
      make: 'Canon',
      model: 'EOS R5',
      lensModel: LENS,
      city: CITY,
      state: STATE,
      country: COUNTRY,
      latitude: 52.52,
      longitude: 13.405,
      dateTimeOriginal: '2026-01-01T01:00:00+13:00',
      timeZone: 'Pacific/Auckland',
      rating: RATING,
      description: DESCRIPTION,
    },
  });

const albumDto = (id: string, albumName: string) =>
  ({ id, albumName, albumThumbnailAssetId: null, albumUsers: [], assetCount: 3 }) as unknown as AlbumResponseDto;

// `albumUsers` is what makes the "shared by" row render at all (DetailPanel gates on it) — and it
// needs MORE THAN ONE member: upstream #30187 suppresses the row on a single-member album.
const CURRENT_ALBUM = {
  id: CURRENT_ALBUM_ID,
  albumName: 'Trip',
  albumUsers: [
    { role: 'editor', user: OWNER },
    { role: 'viewer', user: { ...OWNER, id: VIEWER_ID, name: 'Me', email: 'me@example.com' } },
  ],
} as unknown as AlbumResponseDto;

const OTHER_ALBUM = albumDto(OTHER_ALBUM_ID, 'Iceland');

/**
 * The asset as the SERVER sees it — the ground truth the emitted query is judged against. Kept
 * separate from the DTO because the people a row renders come from two different places (the
 * asset's own `people` for a shared-space asset, `faceManager` for an owned one), while the server
 * only ever sees `asset_face.personId` / `shared_space_person_face.personId`.
 */
type Subject = {
  asset: AssetResponseDto;
  personIds: string[];
  spacePersonIds: string[];
  albumIds: string[];
};

const UUID_SOURCE = String.raw`[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}`;
const BARE_UUID = new RegExp(`^${UUID_SOURCE}$`, 'i');
const SCOPED_PERSON_TOKEN = new RegExp(`^(?:${UUID_SOURCE}|person:${UUID_SOURCE}|space-person:${UUID_SOURCE})$`, 'i');

const asArray = (value: unknown): string[] => (Array.isArray(value) ? (value as string[]) : []);

/**
 * Step 3 of P1 — THE ASSERTION THAT CATCHES R8.
 *
 * Mirrors time-bucket.dto.ts's zod. A wrong id shape here is not a wrong result set, it is a **400**:
 * `spacePersonIds` is `z.array(z.uuidv4())`, so a `space-person:<uuid>` token there makes the Space
 * timeline error out entirely. `personIds` is the only field that accepts the scoped token.
 */
function expectServerIdShapes(options: Record<string, unknown>) {
  for (const id of asArray(options.spacePersonIds)) {
    expect(id, `spacePersonIds is z.array(z.uuidv4()) — a bare uuid, never a scoped token`).toMatch(BARE_UUID);
  }
  for (const token of asArray(options.personIds)) {
    expect(token, `personIds is z.array(ScopedPersonTokenSchema)`).toMatch(SCOPED_PERSON_TOKEN);
  }
  for (const id of asArray(options.tagIds)) {
    expect(id, 'tagIds is z.array(z.uuidv4())').toMatch(BARE_UUID);
  }
  for (const key of ['albumId', 'ownerId', 'spaceId', 'userId'] as const) {
    if (options[key] !== undefined) {
      expect(String(options[key]), `${key} is z.uuidv4()`).toMatch(BARE_UUID);
    }
  }
}

/**
 * P1 itself: run the SERVER'S predicates over the source asset and require it to survive them.
 * Every key the query can carry is checked, so a row that quietly emits a foreign value (a different
 * album, a person that is not on the asset, tomorrow's date) fails here.
 */
function expectOptionsToMatchSubject(options: Record<string, unknown>, subject: Subject) {
  const { asset } = subject;
  const exif = asset.exifInfo ?? {};

  // `=` — exact
  const exact: Array<[string, unknown]> = [
    ['make', exif.make],
    ['model', exif.model],
    ['lensModel', exif.lensModel],
    ['city', exif.city],
    ['state', exif.state],
    ['country', exif.country],
  ];
  for (const [key, assetValue] of exact) {
    if (options[key] !== undefined) {
      expect(options[key], `${key} must equal the asset's own value`).toBe(assetValue);
    }
  }
  if (options.ownerId !== undefined) {
    expect(options.ownerId).toBe(asset.ownerId);
  }

  // ILIKE '%…%' — substring, case-insensitive
  if (options.description !== undefined) {
    expect((exif.description ?? '').toLowerCase()).toContain(String(options.description).toLowerCase());
  }
  if (options.originalFileName !== undefined) {
    expect(asset.originalFileName.toLowerCase()).toContain(String(options.originalFileName).toLowerCase());
  }

  // `>=` — the server treats rating as a MINIMUM
  if (options.rating !== undefined) {
    expect(exif.rating ?? -1).toBeGreaterThanOrEqual(Number(options.rating));
  }

  // withAnyTagId — ANY-OF
  if (options.tagIds !== undefined) {
    const assetTagIds = new Set((asset.tags ?? []).map((tag) => tag.id));
    expect(asArray(options.tagIds).some((id) => assetTagIds.has(id))).toBe(true);
  }

  // hasPeople / hasSpacePeople — AND: EVERY id must be on the asset
  const personTokens = new Set([
    ...subject.personIds,
    ...subject.personIds.map((id) => `person:${id}`),
    ...subject.spacePersonIds.map((id) => `space-person:${id}`),
  ]);
  for (const token of asArray(options.personIds)) {
    expect([...personTokens], `personIds is AND-ed — every person must be on the asset`).toContain(token);
  }
  for (const id of asArray(options.spacePersonIds)) {
    expect(subject.spacePersonIds, `spacePersonIds is AND-ed — every person must be on the asset`).toContain(id);
  }

  // inner join album_asset
  if (options.albumId !== undefined) {
    expect(subject.albumIds).toContain(options.albumId);
  }

  // takenAfter <= asset.localDateTime <= takenBefore (buildFilterContext expands a date-only `to`
  // into the exclusive next-day UTC end, which is what lets a single-day filter match at all).
  const localDateTime = new Date(asset.localDateTime).getTime();
  if (options.takenAfter !== undefined) {
    expect(localDateTime).toBeGreaterThanOrEqual(new Date(String(options.takenAfter)).getTime());
  }
  if (options.takenBefore !== undefined) {
    expect(localDateTime).toBeLessThanOrEqual(new Date(String(options.takenBefore)).getTime());
  }
}

type Surface = {
  label: string;
  url: string;
  basePath: string;
  personKey: 'personIds' | 'spacePersonIds';
  forwardsAlbumId: boolean;
  buildOptions: (filters: FilterState) => Record<string, unknown>;
};

const SURFACES: Surface[] = [
  {
    label: '/photos',
    url: 'https://gallery.test/photos/a5e70000-0000-4000-8000-00000000000f',
    basePath: '/photos',
    personKey: 'personIds',
    forwardsAlbumId: true,
    buildOptions: (filters) => buildPhotosTimelineOptions(filters, VIEWER_ID),
  },
  {
    label: 'a Space',
    url: `https://gallery.test/spaces/${SPACE_ID}/photos/a5e70000-0000-4000-8000-00000000000f`,
    basePath: `/spaces/${SPACE_ID}`,
    personKey: 'spacePersonIds',
    forwardsAlbumId: true,
    buildOptions: (filters) => buildSpaceTimelineOptions(SPACE_ID, filters),
  },
  {
    label: 'an album',
    url: `https://gallery.test/albums/${CURRENT_ALBUM_ID}/photos/a5e70000-0000-4000-8000-00000000000f`,
    basePath: `/albums/${CURRENT_ALBUM_ID}`,
    personKey: 'personIds',
    // The route already scopes the query to its own album, so buildAlbumTimelineOptions deliberately
    // refuses to forward a second albumId (album-filter-options.ts).
    forwardsAlbumId: false,
    buildOptions: (filters) => buildAlbumTimelineOptions(CURRENT_ALBUM_ID, AssetOrder.Desc, filters),
  },
  {
    label: 'the global map',
    url: 'https://gallery.test/map/photos/a5e70000-0000-4000-8000-00000000000f',
    basePath: '/map',
    personKey: 'personIds',
    forwardsAlbumId: true,
    buildOptions: (filters) => buildMapTimeBucketOptions(filters),
  },
  {
    label: 'the space map',
    url: `https://gallery.test/map/photos/a5e70000-0000-4000-8000-00000000000f?spaceId=${SPACE_ID}`,
    basePath: '/map',
    personKey: 'spacePersonIds',
    // A space-scoped map cannot express an album filter — space ∩ album is unsatisfiable, the server
    // 400s it, and DetailPanel (albumFilterUnsupported) + hydrateMapFilters + buildContextualMapUrl
    // all withhold/drop it. So, like the album surface, the album ⚗️ row is not offered here.
    forwardsAlbumId: false,
    buildOptions: (filters) => buildMapTimeBucketOptions(filters, SPACE_ID),
  },
];

const filterUrlFromClick = async (label: string | RegExp) => {
  await fireEvent.click(await screen.findByLabelText(label));
  expect(gotoMock).toHaveBeenCalledTimes(1);
  return gotoMock.mock.calls[0][0] as string;
};

const filterUrlFromLink = async (label: string | RegExp) => {
  const link = await screen.findByLabelText(label);
  const href = link.getAttribute('href');
  expect(href).toBeTruthy();
  return href as string;
};

type Row = {
  name: string;
  /** The URL the REAL affordance navigates to — a goto() argument, or a link's href. */
  filterUrl: () => Promise<string>;
  /** The server field(s) this row must actually reach, so P1 can never pass by filtering nothing. */
  keys: (surface: Surface) => string[];
  /** Surfaces that deliberately do not OFFER this row's affordance at all (E9). */
  skipOn?: (surface: Surface) => boolean;
};

const ROWS: Row[] = [
  {
    name: 'camera',
    filterUrl: () => filterUrlFromClick(`filter_by_camera: ${CAMERA_LABEL}`),
    keys: () => ['make', 'model'],
  },
  { name: 'lens', filterUrl: () => filterUrlFromClick(`filter_by_lens: ${LENS}`), keys: () => ['lensModel'] },
  { name: 'city', filterUrl: () => filterUrlFromClick(`filter_by_location: ${CITY}`), keys: () => ['city', 'country'] },
  {
    name: 'state',
    filterUrl: () => filterUrlFromClick(`filter_by_location: ${STATE}`),
    keys: () => ['state', 'country'],
  },
  { name: 'country', filterUrl: () => filterUrlFromClick(`filter_by_location: ${COUNTRY}`), keys: () => ['country'] },
  { name: 'date', filterUrl: () => filterUrlFromClick(/^filter_by_date/), keys: () => ['takenAfter', 'takenBefore'] },
  {
    name: 'filename',
    filterUrl: () => filterUrlFromClick(`filter_by_filename: ${FILENAME_BASENAME}`),
    keys: () => ['originalFileName'],
  },
  { name: 'tag', filterUrl: () => filterUrlFromLink('filter_by_tag: holiday/2026'), keys: () => ['tagIds'] },
  {
    name: 'person',
    filterUrl: () => filterUrlFromLink(`filter_by_person: ${PERSON_NAME}`),
    keys: (surface) => [surface.personKey],
  },
  { name: 'owner', filterUrl: () => filterUrlFromClick(`filter_by_owner: ${OWNER_NAME}`), keys: () => ['ownerId'] },
  { name: 'rating', filterUrl: () => filterUrlFromClick(`filter_by_rating: ${RATING}`), keys: () => ['rating'] },
  {
    name: 'description',
    filterUrl: () => filterUrlFromClick(`filter_by_description: ${DESCRIPTION}`),
    keys: () => ['description'],
  },
  {
    name: 'album',
    // E9 — the album surface offers no album ⚗️ at all (see the dedicated describe below), so there
    // is nothing to click there. Everywhere else it forwards albumId and must satisfy P1.
    skipOn: (surface) => !surface.forwardsAlbumId,
    filterUrl: () => filterUrlFromClick('filter_by_album: Iceland'),
    keys: () => ['albumId'],
  },
];

let subject: Subject;

const optionsFor = (surface: Surface, url: string): Record<string, unknown> => {
  const filters: FilterState = {
    ...createFilterState(),
    ...decodeFilterParams(new URL(url, 'https://gallery.test')),
  };
  return surface.buildOptions(filters);
};

beforeEach(() => {
  vi.clearAllMocks();
  gotoMock.mockResolvedValue(undefined);
  zoomImageToBase64Mock.mockResolvedValue(undefined);
  getAssetInfoMock.mockResolvedValue(undefined);
  getAllAlbumsMock.mockResolvedValue([CURRENT_ALBUM, OTHER_ALBUM]);
  faceManagerMock.data = [];
  faceManagerMock.people = [];
  faceManagerMock.facesByPersonId = new Map();
  authManagerMock.isSharedLink = false;
  authManagerMock.user = { id: VIEWER_ID };

  subject = {
    asset: buildSubjectAsset(),
    personIds: [PERSON_ID],
    spacePersonIds: [SPACE_PERSON_ID],
    albumIds: [CURRENT_ALBUM_ID, OTHER_ALBUM_ID],
  };
});

describe.each(SURFACES)(
  'P1 on $label: the filter you clicked still contains the asset you clicked it on',
  (surface) => {
    it.each(ROWS)('the $name row', async (row) => {
      if (row.skipOn?.(surface)) {
        // The affordance is deliberately not offered here (E9) — the dedicated describe below pins
        // its ABSENCE, which is the honest behavior. There is nothing to click, so P1 is vacuous.
        return;
      }

      mockPage.reset(surface.url);

      renderWithTooltips(DetailPanel, { asset: subject.asset, currentAlbum: CURRENT_ALBUM });

      const url = await row.filterUrl();

      // The click filters THIS surface, and one navigation closes the viewer.
      expect(url.startsWith(surface.basePath)).toBe(true);
      expect(url).not.toContain(subject.asset.id);

      const options = optionsFor(surface, url);

      expectServerIdShapes(options);

      // P1 must not pass vacuously: the row's filter has to REACH the query.
      for (const key of row.keys(surface)) {
        expect(options[key], `the ${row.name} row must reach the query as \`${key}\``).toBeDefined();
      }

      expectOptionsToMatchSubject(options, subject);
    });
  },
);

// E9 — the album surface is the one place an albumId filter cannot be expressed at all, so the
// affordance is WITHHELD there rather than offered and quietly ignored.
//
// buildAlbumTimelineOptions never forwards `albumId` (the route already scopes the query), while
// getActiveFilterCount counts it and a chip renders. So offering the ⚗️ here would produce a
// "1 filter" badge and a removable chip over a grid that never changed — counted, chipped, and
// never applied. P1 CANNOT catch that (the asset is still in the result set), which is exactly why
// it is pinned here instead.
describe('P1 — the album surface withholds the album filter rather than lying about it', () => {
  it('offers no album ⚗️ at all: not for this album, and not for another', async () => {
    const surface = SURFACES.find((s) => s.label === 'an album')!;
    mockPage.reset(surface.url);

    renderWithTooltips(DetailPanel, { asset: subject.asset, currentAlbum: CURRENT_ALBUM });

    // The album cards still render — they navigate. Only the filter affordance is withheld.
    await waitFor(() => expect(screen.getByText('Iceland')).toBeInTheDocument());
    expect(screen.queryByLabelText('filter_by_album: Iceland')).not.toBeInTheDocument();
    expect(screen.queryByLabelText(`filter_by_album: ${CURRENT_ALBUM.albumName}`)).not.toBeInTheDocument();
  });
});

describe('P1 under merge semantics (§5.6, E25)', () => {
  const spaceSurface = SURFACES.find((s) => s.label === 'a Space')!;

  it('preserves an unrelated active filter the asset also satisfies', async () => {
    mockPage.reset(`${spaceSurface.url}?make=Canon`);

    renderWithTooltips(DetailPanel, { asset: subject.asset, currentAlbum: CURRENT_ALBUM });

    const url = await filterUrlFromClick(`filter_by_location: ${CITY}`);
    const options = optionsFor(spaceSurface, url);

    expect(options.make).toBe('Canon');
    expect(options.city).toBe(CITY);
    expectOptionsToMatchSubject(options, subject);
  });

  /**
   * E25 — array patches REPLACE, they never append. This is the case where P1 itself does the work:
   * `spacePersonIds` (and `personIds`) are AND-ed server-side, so an APPENDING person patch keeps the
   * already-active person — who is not on this asset — in the query, and the asset drops out of the
   * very filter that was clicked on it.
   */
  it('E25: a person click REPLACES an active person filter (appending would AND in a stranger)', async () => {
    mockPage.reset(`${spaceSurface.url}?people=${OTHER_SPACE_PERSON_ID}`);

    renderWithTooltips(DetailPanel, { asset: subject.asset, currentAlbum: CURRENT_ALBUM });

    const url = await filterUrlFromLink(`filter_by_person: ${PERSON_NAME}`);
    const options = optionsFor(spaceSurface, url);

    // P1 itself first: an appended stranger is AND-ed into the query and evicts the asset here,
    // before the shape/equality checks below get a chance to explain it more precisely.
    expectOptionsToMatchSubject(options, subject);
    expectServerIdShapes(options);
    expect(options.spacePersonIds).toEqual([SPACE_PERSON_ID]);
  });

  /**
   * The tag half of E25 needs its own assertion rather than leaning on P1: `tagIds` is ANY-OF
   * server-side (withAnyTagId), so an appended tag cannot by itself evict the asset from its own
   * filter — but it still silently widens a filter the user asked to be narrowed, and it makes two
   * adjacent rows of the same panel move the result set in opposite directions.
   */
  it('E25: a tag click REPLACES an active tag filter rather than appending to it', async () => {
    mockPage.reset(`${spaceSurface.url}?tags=${OTHER_TAG_ID}`);

    renderWithTooltips(DetailPanel, { asset: subject.asset, currentAlbum: CURRENT_ALBUM });

    const url = await filterUrlFromLink('filter_by_tag: holiday/2026');
    const options = optionsFor(spaceSurface, url);

    expect(options.tagIds).toEqual([TAG_ID]);
    expectOptionsToMatchSubject(options, subject);
  });
});

/**
 * The other half of the person story (R8): an OWN person on an OWN asset. There is no space person
 * to scope to, so the query carries the `person:<uuid>` token — and P1 says that uuid has to be one
 * the asset actually has a face for.
 *
 * The token is scoped rather than bare so it matches what `getPhotosPersonFilterId` derives for the
 * same person, which is what the chip's `personNames` map and the panel's people options are keyed
 * by; the server accepts both forms.
 */
describe('P1 — an own person on an own asset', () => {
  const ownedSurfaces = SURFACES.filter((s) => s.label === '/photos' || s.label === 'an album');

  beforeEach(() => {
    subject = {
      asset: assetFactory.build({
        ...buildSubjectAsset(),
        ownerId: VIEWER_ID,
        resolvedSpaceId: undefined,
        people: [],
      }),
      personIds: [PERSON_ID],
      spacePersonIds: [],
      albumIds: [CURRENT_ALBUM_ID, OTHER_ALBUM_ID],
    };
    faceManagerMock.people = [
      { id: PERSON_ID, name: PERSON_NAME, birthDate: null, isHidden: false, thumbnailPath: '/thumb' },
    ];
  });

  it.each(ownedSurfaces)('carries the scoped person token on $label', async (surface) => {
    mockPage.reset(surface.url);

    renderWithTooltips(DetailPanel, { asset: subject.asset, currentAlbum: CURRENT_ALBUM });

    const url = await filterUrlFromLink(`filter_by_person: ${PERSON_NAME}`);
    const options = optionsFor(surface, url);

    expect(options.personIds).toEqual([`person:${PERSON_ID}`]);
    expectServerIdShapes(options);
    expectOptionsToMatchSubject(options, subject);
  });
});
