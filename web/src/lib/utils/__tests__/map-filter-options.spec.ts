import { AssetTypeEnum, AssetVisibility } from '@immich/sdk';
import { createFilterState } from '$lib/components/filter-panel/filter-panel';
import {
  buildAlbumMapMarkerOptions,
  buildMapMarkerOptions,
  buildMapTimeBucketOptions,
  buildMapTimelineOptions,
} from '$lib/utils/map-filter-options';

describe('buildMapMarkerOptions', () => {
  it('includes custom dates in map marker options', () => {
    const filters = { ...createFilterState(), dateAfter: '2024-01-01', dateBefore: '2024-12-31' };

    expect(buildMapMarkerOptions(filters)).toEqual(
      expect.objectContaining({
        takenAfter: '2024-01-01T00:00:00.000Z',
        takenBefore: '2025-01-01T00:00:00.000Z',
      }),
    );
  });

  it('includes has-no-album in map marker options', () => {
    const filters = { ...createFilterState(), isNotInAlbum: true };

    expect(buildMapMarkerOptions(filters)).toEqual(expect.objectContaining({ isNotInAlbum: true }));
  });

  it('omits has-no-album from map marker options when false', () => {
    const filters = { ...createFilterState(), isNotInAlbum: false };

    expect(buildMapMarkerOptions(filters)).not.toHaveProperty('isNotInAlbum');
  });

  it('includes has-album in map marker options', () => {
    const filters = { ...createFilterState(), isInAlbum: true };

    expect(buildMapMarkerOptions(filters)).toEqual(expect.objectContaining({ isInAlbum: true }));
  });

  it('omits has-album from map marker options when false', () => {
    const filters = { ...createFilterState(), isInAlbum: false };

    expect(buildMapMarkerOptions(filters)).not.toHaveProperty('isInAlbum');
  });

  // The map-markers DTO now exposes albumId (server forwards it as albumIds: [albumId] to
  // searchAssetBuilder's inAlbums()), so it must be forwarded here too — otherwise the map's pins
  // would ignore the album filter that the map's own timeline picker honours (a fresh instance of #767).
  it('forwards lensModel/state/ownerId/albumId', () => {
    const options = buildMapMarkerOptions(
      { ...createFilterState(), lensModel: 'RF24', state: 'Hamburg', ownerId: 'u1', albumId: 'a1' },
      undefined,
    );

    expect(options).toMatchObject({ lensModel: 'RF24', state: 'Hamburg', ownerId: 'u1', albumId: 'a1' });
  });

  // Finding 2 (#767 fresh instance): a Space filtered by description/filename/OCR carries those
  // filters to the map via encodeFilterParams — the map hydrates them, counts them, and shows a
  // chip for each — but the marker query silently dropped all three, so the map showed EVERY pin
  // in the space while claiming the filter was active. Forward them for real.
  it('forwards description/filename/ocr filters carried from a space', () => {
    const options = buildMapMarkerOptions({
      ...createFilterState(),
      description: 'sunset',
      originalFileName: 'IMG_1234',
      ocr: 'stop sign',
    });

    expect(options).toMatchObject({ description: 'sunset', originalFileName: 'IMG_1234', ocr: 'stop sign' });
  });
});

describe('buildMapTimeBucketOptions', () => {
  it('includes active global map filters in time bucket requests', () => {
    const filters = {
      ...createFilterState(),
      personIds: ['person-1'],
      make: 'Canon',
      model: 'EOS R6',
      tagIds: ['tag-1'],
      rating: 4,
      mediaType: 'video' as const,
      isNotInAlbum: true,
      selectedYear: 2015,
      selectedMonth: 3,
    };

    expect(buildMapTimeBucketOptions(filters)).toEqual({
      visibility: AssetVisibility.Timeline,
      withSharedSpaces: true,
      personIds: ['person-1'],
      make: 'Canon',
      model: 'EOS R6',
      tagIds: ['tag-1'],
      rating: 4,
      isNotInAlbum: true,
      $type: AssetTypeEnum.Video,
      takenAfter: '2015-03-01T00:00:00.000Z',
      takenBefore: '2015-04-01T00:00:00.000Z',
    });
  });

  // The favourites chip 400s the map's temporal picker: timeline.service.ts (timeBucketChecks)
  // REJECTS withSharedSpaces together with isFavorite — "a favourite is the asset owner's flag" —
  // so sending both errored getTimeBuckets and the cluster panel while the markers answered fine.
  // Mirror buildPhotosTimelineOptions: it drops withPartners/withSharedSpaces for a favourites
  // query, which also matches what the marker endpoint does (it does NOT widen a favourites query
  // to shared spaces either), so the two surfaces still agree.
  it('drops withSharedSpaces for a favourites time-bucket query (the server 400s the combination)', () => {
    const options = buildMapTimeBucketOptions({ ...createFilterState(), isFavorite: true });

    expect(options).toMatchObject({ visibility: AssetVisibility.Timeline, isFavorite: true });
    expect(options).not.toHaveProperty('withSharedSpaces');
  });

  it('drops withSharedSpaces for an explicitly non-favourite time-bucket query too', () => {
    const options = buildMapTimeBucketOptions({ ...createFilterState(), isFavorite: false });

    expect(options).toMatchObject({ isFavorite: false });
    expect(options).not.toHaveProperty('withSharedSpaces');
  });

  it('keeps withSharedSpaces when the favourites chip is off', () => {
    expect(buildMapTimeBucketOptions(createFilterState())).toMatchObject({ withSharedSpaces: true });
  });

  it('uses the current space instead of global timeline visibility when spaceId is present', () => {
    const filters = {
      ...createFilterState(),
      country: 'Australia',
      mediaType: 'image' as const,
    };

    expect(buildMapTimeBucketOptions(filters, 'space-123')).toEqual({
      spaceId: 'space-123',
      country: 'Australia',
      $type: AssetTypeEnum.Image,
    });
  });

  it('includes has-no-album in space map time bucket requests', () => {
    const filters = {
      ...createFilterState(),
      isNotInAlbum: true,
    };

    expect(buildMapTimeBucketOptions(filters, 'space-123')).toEqual({
      spaceId: 'space-123',
      isNotInAlbum: true,
    });
  });

  it('uses space-scoped person filters for space map time bucket requests', () => {
    const filters = {
      ...createFilterState(),
      personIds: ['space-person-1'],
    };

    expect(buildMapTimeBucketOptions(filters, 'space-123')).toEqual({
      spaceId: 'space-123',
      spacePersonIds: ['space-person-1'],
    });
  });

  it('includes custom dates in map time bucket options', () => {
    const filters = { ...createFilterState(), dateBefore: '2024-12-31' };

    expect(buildMapTimeBucketOptions(filters)).toEqual(
      expect.objectContaining({ takenBefore: '2025-01-01T00:00:00.000Z' }),
    );
  });

  it('forwards the new filter dimensions to the map time bucket query', () => {
    const filters = {
      ...createFilterState(),
      lensModel: 'RF24-70mm F2.8 L IS USM',
      state: 'State of Berlin',
      albumId: 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',
      ownerId: 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb',
    };

    expect(buildMapTimeBucketOptions(filters)).toMatchObject({
      lensModel: 'RF24-70mm F2.8 L IS USM',
      state: 'State of Berlin',
      albumId: 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',
      ownerId: 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb',
    });
  });

  // Finding 2: the temporal picker's time buckets must agree with the marker pins — both read the
  // same active filters, so a Space's description/filename/OCR filter must narrow both alike.
  it('forwards description/filename/ocr filters to the map time bucket query', () => {
    const filters = {
      ...createFilterState(),
      description: 'sunset',
      originalFileName: 'IMG_1234',
      ocr: 'stop sign',
    };

    expect(buildMapTimeBucketOptions(filters)).toMatchObject({
      description: 'sunset',
      originalFileName: 'IMG_1234',
      ocr: 'stop sign',
    });
  });
});

describe('buildMapTimelineOptions', () => {
  it('includes shared spaces for global map cluster timelines', () => {
    const filters = {
      ...createFilterState(),
      personIds: ['person-1'],
      tagIds: ['tag-1'],
      rating: 4,
      isNotInAlbum: true,
      mediaType: 'image' as const,
      selectedYear: 2024,
      selectedMonth: 7,
    };
    const selectedClusterIds = new Set(['asset-1', 'asset-2']);

    expect(buildMapTimelineOptions(filters, '1,2,3,4', selectedClusterIds)).toEqual({
      bbox: '1,2,3,4',
      visibility: AssetVisibility.Timeline,
      withSharedSpaces: true,
      assetFilter: selectedClusterIds,
      personIds: ['person-1'],
      tagIds: ['tag-1'],
      rating: 4,
      isNotInAlbum: true,
      $type: AssetTypeEnum.Image,
      takenAfter: '2024-07-01T00:00:00.000Z',
      takenBefore: '2024-08-01T00:00:00.000Z',
    });
  });

  it('uses space-scoped person filters for space map cluster timelines', () => {
    const filters = {
      ...createFilterState(),
      personIds: ['space-person-1'],
      isNotInAlbum: true,
    };
    const selectedClusterIds = new Set(['asset-1']);

    expect(buildMapTimelineOptions(filters, '1,2,3,4', selectedClusterIds, 'space-1')).toEqual({
      bbox: '1,2,3,4',
      spaceId: 'space-1',
      assetFilter: selectedClusterIds,
      spacePersonIds: ['space-person-1'],
      isNotInAlbum: true,
    });
  });

  // Task 11 Step 2: the cluster panel's asset scope must be EXACTLY the marker query's scope. The
  // marker endpoint (FilteredMapMarkerDto) has no partner scope at all — it is owner-scoped plus the
  // caller's timeline-enabled spaces — so a partner asset can never be a pin, and the panel asking
  // for withPartners could only ever list an asset the map has no pin for. Today that is masked by
  // the client-side assetFilter (the panel is constrained to ids taken from the markers); it
  // surfaces the moment that constraint is relaxed. Same for onlyFavorites, which the markers also
  // ignore — as a settings-derived narrowing it made the panel show FEWER assets than the cluster's
  // own pin count. The legacy $mapSettings asset-scope toggles feed the legacy /map/markers endpoint
  // only; the filter panel is the single source of truth for this map's scope.
  it('never asks the cluster timeline for partner assets (the markers have no partner scope, so a partner asset has no pin)', () => {
    const options = buildMapTimelineOptions(createFilterState(), '1,2,3,4', new Set(['asset-1']));

    expect(options).not.toHaveProperty('withPartners');
  });

  it('does not narrow the cluster timeline to favourites unless the FILTERS say so (the markers do not)', () => {
    const options = buildMapTimelineOptions(createFilterState(), '1,2,3,4', new Set(['asset-1']));

    expect(options).not.toHaveProperty('isFavorite');
  });

  it('forwards the favourites FILTER to the cluster timeline (the markers honour it too)', () => {
    const options = buildMapTimelineOptions(
      { ...createFilterState(), isFavorite: true },
      '1,2,3,4',
      new Set(['asset-1']),
    );

    expect(options).toEqual(expect.objectContaining({ isFavorite: true }));
    expect(options).not.toHaveProperty('withPartners');
  });

  // Same 400 as the temporal picker above: the cluster panel is a timeline query, so it must not
  // send withSharedSpaces beside isFavorite.
  it('drops withSharedSpaces for a favourites cluster timeline (the server 400s the combination)', () => {
    const options = buildMapTimelineOptions({ ...createFilterState(), isFavorite: true }, '1,2,3,4', new Set(['a1']));

    expect(options).toMatchObject({ visibility: AssetVisibility.Timeline, isFavorite: true });
    expect(options).not.toHaveProperty('withSharedSpaces');
  });

  it('keeps withSharedSpaces on the cluster timeline when the favourites chip is off', () => {
    expect(buildMapTimelineOptions(createFilterState(), '1,2,3,4', new Set(['a1']))).toMatchObject({
      withSharedSpaces: true,
    });
  });
});

/**
 * #802 — the Map view was missing the "Text" filter section entirely. These cover the option
 * builders forwarding the three text fields the section produces. The map timeline hits
 * TimeBucketDto (which already supports them); markers hit FilteredMapMarkerDto.
 */
describe('text filters (#802)', () => {
  const textFilters = {
    ...createFilterState(),
    description: 'birthday cake',
    originalFileName: 'IMG_1234.jpg',
    ocr: 'happy birthday',
  };

  describe('buildMapMarkerOptions', () => {
    it('forwards description, filename and OCR text to map markers', () => {
      expect(buildMapMarkerOptions(textFilters)).toEqual(
        expect.objectContaining({
          description: 'birthday cake',
          originalFileName: 'IMG_1234.jpg',
          ocr: 'happy birthday',
        }),
      );
    });

    it('forwards text filters when scoped to a space', () => {
      expect(buildMapMarkerOptions(textFilters, 'space-1')).toEqual(
        expect.objectContaining({
          spaceId: 'space-1',
          description: 'birthday cake',
          originalFileName: 'IMG_1234.jpg',
          ocr: 'happy birthday',
        }),
      );
    });

    it('trims surrounding whitespace before forwarding', () => {
      const filters = {
        ...createFilterState(),
        description: '  birthday cake  ',
        originalFileName: '\tIMG_1234.jpg\n',
        ocr: '  happy birthday ',
      };

      expect(buildMapMarkerOptions(filters)).toEqual(
        expect.objectContaining({
          description: 'birthday cake',
          originalFileName: 'IMG_1234.jpg',
          ocr: 'happy birthday',
        }),
      );
    });

    it('omits text filters that are undefined', () => {
      const options = buildMapMarkerOptions(createFilterState());

      expect(options).not.toHaveProperty('description');
      expect(options).not.toHaveProperty('originalFileName');
      expect(options).not.toHaveProperty('ocr');
    });

    it('omits text filters that are empty strings', () => {
      const options = buildMapMarkerOptions({
        ...createFilterState(),
        description: '',
        originalFileName: '',
        ocr: '',
      });

      expect(options).not.toHaveProperty('description');
      expect(options).not.toHaveProperty('originalFileName');
      expect(options).not.toHaveProperty('ocr');
    });

    it('omits text filters that are whitespace only', () => {
      const options = buildMapMarkerOptions({
        ...createFilterState(),
        description: ' '.repeat(3),
        originalFileName: '\t\n',
        ocr: ' ',
      });

      expect(options).not.toHaveProperty('description');
      expect(options).not.toHaveProperty('originalFileName');
      expect(options).not.toHaveProperty('ocr');
    });

    it('forwards each text field independently of the others', () => {
      const options = buildMapMarkerOptions({ ...createFilterState(), ocr: 'receipt total' });

      expect(options).toEqual(expect.objectContaining({ ocr: 'receipt total' }));
      expect(options).not.toHaveProperty('description');
      expect(options).not.toHaveProperty('originalFileName');
    });
  });

  describe('buildMapTimeBucketOptions', () => {
    it('forwards description, filename and OCR text', () => {
      expect(buildMapTimeBucketOptions(textFilters)).toEqual(
        expect.objectContaining({
          description: 'birthday cake',
          originalFileName: 'IMG_1234.jpg',
          ocr: 'happy birthday',
        }),
      );
    });

    it('forwards text filters when scoped to a space', () => {
      expect(buildMapTimeBucketOptions(textFilters, 'space-1')).toEqual(
        expect.objectContaining({
          spaceId: 'space-1',
          description: 'birthday cake',
          ocr: 'happy birthday',
        }),
      );
    });

    it('omits blank text filters', () => {
      const options = buildMapTimeBucketOptions({ ...createFilterState(), description: '  ', ocr: '' });

      expect(options).not.toHaveProperty('description');
      expect(options).not.toHaveProperty('ocr');
    });
  });

  describe('buildMapTimelineOptions', () => {
    it('forwards description, filename and OCR text', () => {
      expect(buildMapTimelineOptions(textFilters, '1,2,3,4', new Set())).toEqual(
        expect.objectContaining({
          description: 'birthday cake',
          originalFileName: 'IMG_1234.jpg',
          ocr: 'happy birthday',
        }),
      );
    });

    it('forwards text filters when scoped to a space', () => {
      expect(buildMapTimelineOptions(textFilters, '1,2,3,4', new Set(), 'space-1')).toEqual(
        expect.objectContaining({
          spaceId: 'space-1',
          description: 'birthday cake',
          ocr: 'happy birthday',
        }),
      );
    });

    it('omits text filters when the filter state is undefined', () => {
      const options = buildMapTimelineOptions(undefined, '1,2,3,4', new Set());

      expect(options).not.toHaveProperty('description');
      expect(options).not.toHaveProperty('originalFileName');
      expect(options).not.toHaveProperty('ocr');
    });

    it('omits blank text filters', () => {
      const options = buildMapTimelineOptions(
        { ...createFilterState(), description: ' '.repeat(3), originalFileName: '', ocr: '\t' },
        '1,2,3,4',
        new Set(),
      );

      expect(options).not.toHaveProperty('description');
      expect(options).not.toHaveProperty('originalFileName');
      expect(options).not.toHaveProperty('ocr');
    });
  });
});

describe('buildAlbumMapMarkerOptions', () => {
  it('scopes to the album and forwards the active filters', () => {
    const options = buildAlbumMapMarkerOptions('album-1', {
      ...createFilterState(),
      make: 'Apple',
      rating: 4,
      lensModel: 'RF24-70mm',
    });

    expect(options).toMatchObject({ albumId: 'album-1', make: 'Apple', rating: 4, lensModel: 'RF24-70mm' });
  });

  it('sends the album scope alone — no spaceId, no withSharedSpaces, no owner scope', () => {
    // The server derives everything else from albumId: it checks AlbumRead, leaves userIds unset,
    // and computes timelineSpaceIds itself so albumSharedSpaceScope can keep unreachable space
    // assets out (R4). The client must NOT try to help by adding withSharedSpaces — that flag also
    // widens person-token resolution scope in SharedSpaceService.getFilteredMapMarkers
    // (server/src/services/shared-space.service.ts), which is not what an album query wants.
    expect(buildAlbumMapMarkerOptions('album-1', createFilterState())).toEqual({ albumId: 'album-1' });
  });

  // Finding 2: description/filename/OCR must narrow the album map the same way they narrow the
  // album grid — this is also what AlbumMap's marker-options refetch key now keys on.
  it('forwards description/filename/ocr filters', () => {
    const options = buildAlbumMapMarkerOptions('album-1', {
      ...createFilterState(),
      description: 'sunset',
      originalFileName: 'IMG_1234',
      ocr: 'stop sign',
    });

    expect(options).toMatchObject({
      albumId: 'album-1',
      description: 'sunset',
      originalFileName: 'IMG_1234',
      ocr: 'stop sign',
    });
  });
});
