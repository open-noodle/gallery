import { AssetTypeEnum, AssetVisibility } from '@immich/sdk';
import { createFilterState } from '$lib/components/filter-panel/filter-panel';
import {
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
      isFavorite: true,
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
      isFavorite: true,
      isNotInAlbum: true,
      $type: AssetTypeEnum.Video,
      takenAfter: '2015-03-01T00:00:00.000Z',
      takenBefore: '2015-04-01T00:00:00.000Z',
    });
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

  it('omits partners when favorites filter is selected for global map cluster timelines', () => {
    const filters = {
      ...createFilterState(),
      isFavorite: true,
    };
    const selectedClusterIds = new Set(['asset-1']);

    const options = buildMapTimelineOptions(filters, '1,2,3,4', selectedClusterIds, undefined, {
      withPartners: true,
    });

    expect(options).toEqual(
      expect.objectContaining({
        isFavorite: true,
      }),
    );
    expect(options).not.toHaveProperty('withPartners');
  });

  it('omits partners when map favorites setting is enabled for global map cluster timelines', () => {
    const selectedClusterIds = new Set(['asset-1']);

    const options = buildMapTimelineOptions(createFilterState(), '1,2,3,4', selectedClusterIds, undefined, {
      onlyFavorites: true,
      withPartners: true,
    });

    expect(options).toEqual(
      expect.objectContaining({
        isFavorite: true,
      }),
    );
    expect(options).not.toHaveProperty('withPartners');
  });

  it('keeps partners when global map cluster timelines are not narrowed to favorites', () => {
    const selectedClusterIds = new Set(['asset-1']);

    const options = buildMapTimelineOptions(createFilterState(), '1,2,3,4', selectedClusterIds, undefined, {
      withPartners: true,
    });

    expect(options).toEqual(
      expect.objectContaining({
        withPartners: true,
      }),
    );
    expect(options).not.toHaveProperty('isFavorite');
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
