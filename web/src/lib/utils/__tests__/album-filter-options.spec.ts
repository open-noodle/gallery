import { AssetOrder, AssetTypeEnum, AssetVisibility } from '@immich/sdk';
import { describe, expect, it } from 'vitest';
import { createFilterState } from '$lib/components/filter-panel/filter-panel';
import {
  buildAlbumAssetPickerOptions,
  buildAlbumTimelineOptions,
  buildSpaceAlbumAssetPickerOptions,
} from '$lib/utils/album-filter-options';

describe('buildAlbumTimelineOptions', () => {
  it('maps all supported filters without changing the passed album order', () => {
    const filters = {
      ...createFilterState(),
      personIds: ['person-1'],
      country: 'Germany',
      city: 'Berlin',
      make: 'Sony',
      model: 'A7C',
      tagIds: ['tag-1'],
      rating: 4,
      mediaType: 'image' as const,
      selectedYear: 2024,
      selectedMonth: 2,
      sortOrder: 'desc' as const,
    };

    expect(buildAlbumTimelineOptions('album-1', AssetOrder.Asc, filters)).toEqual({
      albumId: 'album-1',
      order: AssetOrder.Asc,
      personIds: ['person-1'],
      country: 'Germany',
      city: 'Berlin',
      make: 'Sony',
      model: 'A7C',
      tagIds: ['tag-1'],
      rating: 4,
      $type: AssetTypeEnum.Image,
      takenAfter: '2024-02-01T00:00:00.000Z',
      takenBefore: '2024-03-01T00:00:00.000Z',
    });
  });

  it('maps custom dates for album timeline options', () => {
    const filters = { ...createFilterState(), dateAfter: '2024-01-01', dateBefore: '2024-12-31' };

    expect(buildAlbumTimelineOptions('album-1', AssetOrder.Desc, filters)).toEqual(
      expect.objectContaining({
        takenAfter: '2024-01-01T00:00:00.000Z',
        takenBefore: '2025-01-01T00:00:00.000Z',
      }),
    );
  });

  it('maps favorites for album timeline options', () => {
    const filters = { ...createFilterState(), isFavorite: true };

    expect(buildAlbumTimelineOptions('album-1', AssetOrder.Desc, filters)).toEqual(
      expect.objectContaining({
        albumId: 'album-1',
        isFavorite: true,
      }),
    );
  });

  it('forwards lensModel, state and ownerId to the album timeline query', () => {
    const filters = {
      ...createFilterState(),
      lensModel: 'RF24-70mm F2.8 L IS USM',
      state: 'State of Berlin',
      ownerId: 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb',
    };

    expect(buildAlbumTimelineOptions('album-1', AssetOrder.Desc, filters)).toEqual(
      expect.objectContaining({
        lensModel: 'RF24-70mm F2.8 L IS USM',
        state: 'State of Berlin',
        ownerId: 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb',
      }),
    );
  });

  // The album page's route ALREADY scopes the query to its album, and the server's albumId is a
  // scalar driving one inner join — a second album cannot be AND-ed. So an albumId FILTER is
  // meaningless here and must not overwrite the route's album scope.
  it('ignores an albumId filter and keeps the route album', () => {
    const filters = { ...createFilterState(), albumId: 'some-other-album' };

    const options = buildAlbumTimelineOptions('route-album-id', AssetOrder.Desc, filters);

    expect(options.albumId).toBe('route-album-id');
  });

  // Finding (#767c): hydrateAlbumFilters hydrates description/originalFileName/ocr/isInAlbum/
  // isNotInAlbum straight from the URL, getActiveFilterCount counts them, and ActiveFiltersBar
  // renders a removable chip for each — but until now the album TIMELINE query never forwarded
  // them, so `/albums/{id}?description=beach` showed a "1 filter" chip over the entire unfiltered
  // album. The same album's map (buildAlbumMapMarkerOptions) already forwards these.
  it('forwards trimmed description/filename/ocr text filters to the album timeline query', () => {
    const filters = {
      ...createFilterState(),
      description: '  beach  ',
      originalFileName: 'IMG_001',
      ocr: 'invoice',
    };

    const options = buildAlbumTimelineOptions('album-1', AssetOrder.Desc, filters);

    expect(options).toEqual(
      expect.objectContaining({ description: 'beach', originalFileName: 'IMG_001', ocr: 'invoice' }),
    );
  });

  it('omits blank description/filename/ocr text filters from the album timeline query', () => {
    const filters = { ...createFilterState(), description: ' '.repeat(3), originalFileName: '', ocr: undefined };

    const options = buildAlbumTimelineOptions('album-1', AssetOrder.Desc, filters);

    expect(options).not.toHaveProperty('description');
    expect(options).not.toHaveProperty('originalFileName');
    expect(options).not.toHaveProperty('ocr');
  });

  it('forwards isInAlbum/isNotInAlbum to the album timeline query only when true', () => {
    expect(buildAlbumTimelineOptions('album-1', AssetOrder.Desc, { ...createFilterState(), isInAlbum: true })).toEqual(
      expect.objectContaining({ isInAlbum: true }),
    );
    expect(
      buildAlbumTimelineOptions('album-1', AssetOrder.Desc, { ...createFilterState(), isNotInAlbum: true }),
    ).toEqual(expect.objectContaining({ isNotInAlbum: true }));
    expect(
      buildAlbumTimelineOptions('album-1', AssetOrder.Desc, { ...createFilterState(), isInAlbum: false }),
    ).not.toHaveProperty('isInAlbum');
    expect(
      buildAlbumTimelineOptions('album-1', AssetOrder.Desc, { ...createFilterState(), isNotInAlbum: false }),
    ).not.toHaveProperty('isNotInAlbum');
  });
});

describe('buildAlbumAssetPickerOptions', () => {
  it('keeps picker base options and does not add album scope', () => {
    const filters = {
      ...createFilterState(),
      personIds: ['person-1'],
      tagIds: ['tag-1'],
      mediaType: 'video' as const,
      selectedYear: 2023,
    };

    expect(buildAlbumAssetPickerOptions('album-1', filters)).toEqual({
      visibility: AssetVisibility.Timeline,
      withPartners: true,
      timelineAlbumId: 'album-1',
      personIds: ['person-1'],
      tagIds: ['tag-1'],
      $type: AssetTypeEnum.Video,
      takenAfter: '2023-01-01T00:00:00.000Z',
      takenBefore: '2024-01-01T00:00:00.000Z',
    });
  });

  it('maps custom dates for album asset picker options', () => {
    const filters = { ...createFilterState(), dateAfter: '2024-01-01' };

    expect(buildAlbumAssetPickerOptions('album-1', filters)).toEqual(
      expect.objectContaining({ takenAfter: '2024-01-01T00:00:00.000Z' }),
    );
  });

  it('maps favorites and omits partners for album asset picker options', () => {
    const filters = { ...createFilterState(), isFavorite: true };
    const options = buildAlbumAssetPickerOptions('album-1', filters);

    expect(options).toEqual(
      expect.objectContaining({
        timelineAlbumId: 'album-1',
        isFavorite: true,
      }),
    );
    expect(options).not.toHaveProperty('withPartners');
  });

  // Pinned per the #767c Step-3 decision: buildAlbumAssetPickerOptions deliberately does NOT
  // forward lensModel/state/ownerId (unlike buildAlbumTimelineOptions). This is safe only because
  // the picker's sections (album-filter-config.ts) has no control that can ever set these three on
  // its component-local, non-URL-hydrated FilterState. Both configs share ONE `sections` const, so
  // if a future change adds a control that sets one of these fields, this test fails — forcing a
  // conscious choice to forward the field here too, instead of silently reintroducing the same
  // "chip says one thing, query does another" bug fixed above for description/originalFileName/
  // ocr/isInAlbum/isNotInAlbum.
  it('pins the intentional omission of lensModel/state/ownerId from the asset picker query', () => {
    const filters = {
      ...createFilterState(),
      lensModel: 'RF24-70mm F2.8 L IS USM',
      state: 'State of Berlin',
      ownerId: 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb',
    };

    const options = buildAlbumAssetPickerOptions('album-1', filters);

    expect(options).not.toHaveProperty('lensModel');
    expect(options).not.toHaveProperty('state');
    expect(options).not.toHaveProperty('ownerId');
  });
});

/**
 * #802 — album views were missing the "Text" filter section. Both album builders feed
 * TimeBucketDto, which already supports description/originalFileName/ocr server-side.
 */
describe('text filters (#802)', () => {
  const textFilters = {
    ...createFilterState(),
    description: 'birthday cake',
    originalFileName: 'IMG_1234.jpg',
    ocr: 'happy birthday',
  };

  describe('buildAlbumTimelineOptions', () => {
    it('forwards description, filename and OCR text', () => {
      expect(buildAlbumTimelineOptions('album-1', AssetOrder.Desc, textFilters)).toEqual(
        expect.objectContaining({
          albumId: 'album-1',
          description: 'birthday cake',
          originalFileName: 'IMG_1234.jpg',
          ocr: 'happy birthday',
        }),
      );
    });

    it('trims surrounding whitespace before forwarding', () => {
      const options = buildAlbumTimelineOptions('album-1', AssetOrder.Desc, {
        ...createFilterState(),
        description: '  birthday cake  ',
        originalFileName: '\tIMG_1234.jpg\n',
        ocr: ' happy birthday ',
      });

      expect(options).toEqual(
        expect.objectContaining({
          description: 'birthday cake',
          originalFileName: 'IMG_1234.jpg',
          ocr: 'happy birthday',
        }),
      );
    });

    it('omits text filters that are undefined', () => {
      const options = buildAlbumTimelineOptions('album-1', AssetOrder.Desc, createFilterState());

      expect(options).not.toHaveProperty('description');
      expect(options).not.toHaveProperty('originalFileName');
      expect(options).not.toHaveProperty('ocr');
    });

    it('omits text filters that are blank or whitespace only', () => {
      const options = buildAlbumTimelineOptions('album-1', AssetOrder.Desc, {
        ...createFilterState(),
        description: '',
        originalFileName: ' '.repeat(3),
        ocr: '\t\n',
      });

      expect(options).not.toHaveProperty('description');
      expect(options).not.toHaveProperty('originalFileName');
      expect(options).not.toHaveProperty('ocr');
    });

    it('forwards each text field independently of the others', () => {
      const options = buildAlbumTimelineOptions('album-1', AssetOrder.Desc, {
        ...createFilterState(),
        originalFileName: 'DSC_0001.arw',
      });

      expect(options).toEqual(expect.objectContaining({ originalFileName: 'DSC_0001.arw' }));
      expect(options).not.toHaveProperty('description');
      expect(options).not.toHaveProperty('ocr');
    });
  });

  describe('buildAlbumAssetPickerOptions', () => {
    it('forwards description, filename and OCR text', () => {
      expect(buildAlbumAssetPickerOptions('album-1', textFilters)).toEqual(
        expect.objectContaining({
          timelineAlbumId: 'album-1',
          description: 'birthday cake',
          originalFileName: 'IMG_1234.jpg',
          ocr: 'happy birthday',
        }),
      );
    });

    it('forwards the album membership filters the picker can actually use', () => {
      // The picker is not album-scoped server-side, so isInAlbum/isNotInAlbum are meaningful here
      // and are the natural way to surface un-filed photos to add.
      expect(buildAlbumAssetPickerOptions('album-1', { ...createFilterState(), isNotInAlbum: true })).toEqual(
        expect.objectContaining({ isNotInAlbum: true }),
      );
      expect(buildAlbumAssetPickerOptions('album-1', { ...createFilterState(), isInAlbum: true })).toEqual(
        expect.objectContaining({ isInAlbum: true }),
      );
    });

    it('omits album membership filters when they are false', () => {
      const options = buildAlbumAssetPickerOptions('album-1', {
        ...createFilterState(),
        isNotInAlbum: false,
        isInAlbum: false,
      });

      expect(options).not.toHaveProperty('isNotInAlbum');
      expect(options).not.toHaveProperty('isInAlbum');
    });

    it('omits blank text filters', () => {
      const options = buildAlbumAssetPickerOptions('album-1', {
        ...createFilterState(),
        description: '  ',
        ocr: '',
      });

      expect(options).not.toHaveProperty('description');
      expect(options).not.toHaveProperty('ocr');
    });
  });
});

// The Space tab of the space-album picker. Its contract is narrow but load-bearing: `spaceId` is
// the query SCOPE, `timelineAlbumId` is only the already-in-album MARKER, and person filters must
// stay in `personIds` (scoped tokens) rather than being rewritten to the uuid-only
// `spacePersonIds` — the mistake that 400s every bucket request.
describe('buildSpaceAlbumAssetPickerOptions', () => {
  it('scopes by spaceId and keeps timelineAlbumId as the marker', () => {
    const options = buildSpaceAlbumAssetPickerOptions('space-1', 'album-1', createFilterState());

    expect(options).toMatchObject({ spaceId: 'space-1', timelineAlbumId: 'album-1' });
  });

  it('keeps scoped person TOKENS in personIds and never emits spacePersonIds', () => {
    const options = buildSpaceAlbumAssetPickerOptions('space-1', 'album-1', {
      ...createFilterState(),
      personIds: ['person:11111111-1111-4111-8111-111111111111'],
    });

    // `spacePersonIds` is validated server-side as bare uuidv4; a token there is a hard 400.
    expect(options).not.toHaveProperty('spacePersonIds');
    expect(options.personIds).toEqual(['person:11111111-1111-4111-8111-111111111111']);
  });

  it('pins visibility to Timeline so the Space tab does not offer archived photos the My-photos tab hides', () => {
    const options = buildSpaceAlbumAssetPickerOptions('space-1', 'album-1', createFilterState());

    expect(options.visibility).toBe(AssetVisibility.Timeline);
  });

  it('carries the ordinary filters through', () => {
    const options = buildSpaceAlbumAssetPickerOptions('space-1', 'album-1', {
      ...createFilterState(),
      city: 'Berlin',
      tagIds: ['tag-1'],
      rating: 4,
    });

    expect(options).toMatchObject({ city: 'Berlin', tagIds: ['tag-1'], rating: 4 });
  });
});
