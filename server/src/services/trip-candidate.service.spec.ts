import { TripCandidateService } from 'src/services/trip-candidate.service';
import { TRIP_PLACE_HINT_MAX_LENGTH } from 'src/services/trip-place-hint';

const cluster = ({
  country,
  city,
  assetCount,
  dayCount,
  firstDate = '2026-04-15T00:00:00Z',
  lastDate = '2026-04-17T00:00:00Z',
}: {
  country: string;
  city: string | null;
  assetCount: number;
  dayCount: number;
  firstDate?: string;
  lastDate?: string;
}) => ({
  country,
  city,
  assetCount,
  dayCount,
  firstDate: new Date(firstDate),
  lastDate: new Date(lastDate),
});

const dayBucket = ({
  localDate,
  country,
  state = null,
  city,
  assetCount,
  firstDate = `${localDate}T09:00:00Z`,
  lastDate = `${localDate}T17:00:00Z`,
}: {
  localDate: string;
  country: string | null;
  state?: string | null;
  city: string | null;
  assetCount: number;
  firstDate?: string;
  lastDate?: string;
}) => ({
  localDate: new Date(`${localDate}T00:00:00Z`),
  country,
  state,
  city,
  assetCount,
  firstDate: new Date(firstDate),
  lastDate: new Date(lastDate),
});

const tripAsset = ({
  id,
  localDateTime = '2026-04-15T09:00:00Z',
  country = 'France',
  state = null,
  city = 'Paris',
  duplicateId = null,
  stackId = null,
  stackPrimaryAssetId = null,
  fileSizeInByte = 100,
  exifValueCount = 1,
}: {
  id: string;
  localDateTime?: string;
  country?: string | null;
  state?: string | null;
  city?: string | null;
  duplicateId?: string | null;
  stackId?: string | null;
  stackPrimaryAssetId?: string | null;
  fileSizeInByte?: number | null;
  exifValueCount?: number;
}) => ({
  id,
  localDateTime: new Date(localDateTime),
  country,
  state,
  city,
  duplicateId,
  stackId,
  stackPrimaryAssetId,
  fileSizeInByte,
  exifValueCount,
});

const setup = () => {
  const assetRepository = {
    getMemoryLocationClusters: vi.fn(),
    getMemoryLocationDayBuckets: vi.fn(),
  };

  return { assetRepository, service: new TripCandidateService(assetRepository) };
};

const setupWithAlbumReady = () => {
  const assetRepository = {
    getMemoryLocationClusters: vi.fn(),
    getMemoryLocationDayBuckets: vi.fn(),
    getTripCandidateAssets: vi.fn().mockResolvedValue([]),
    getDuplicateGroupAssets: vi.fn().mockResolvedValue([]),
  };

  return { assetRepository, service: new TripCandidateService(assetRepository) };
};

describe(TripCandidateService.name, () => {
  it('detects a high-confidence non-home trip from baseline clusters and recent day buckets', async () => {
    const { assetRepository, service } = setup();
    assetRepository.getMemoryLocationClusters.mockResolvedValueOnce([
      cluster({ country: 'Germany', city: 'Berlin', assetCount: 20, dayCount: 12 }),
    ]);
    assetRepository.getMemoryLocationDayBuckets.mockResolvedValueOnce([
      dayBucket({ localDate: '2026-04-15', country: 'France', city: 'Paris', assetCount: 3 }),
      dayBucket({ localDate: '2026-04-16', country: 'France', city: 'Paris', assetCount: 3 }),
      dayBucket({ localDate: '2026-04-17', country: 'France', city: 'Paris', assetCount: 3 }),
    ]);

    const [candidate] = await service.findRecentTripCandidates({
      ownerId: 'user-1',
      targetDate: new Date('2026-04-23T12:00:00Z'),
      lookbackDays: 30,
      maxCandidates: 3,
    });

    expect(assetRepository.getMemoryLocationClusters).toHaveBeenNthCalledWith(1, 'user-1', {
      takenAfter: new Date('2025-12-24T00:00:00.000Z'),
      takenBefore: new Date('2026-03-23T23:59:59.999Z'),
    });
    expect(assetRepository.getMemoryLocationDayBuckets).toHaveBeenCalledWith('user-1', {
      takenAfter: new Date('2026-03-24T00:00:00.000Z'),
      takenBefore: new Date('2026-04-23T23:59:59.999Z'),
    });
    expect(candidate).toMatchObject({
      dedupeKey: 'trip:france:paris:2026-04-15:2026-04-17',
      title: 'Recent trip to Paris, France',
      subtitle: '9 photos over 3 days',
      countries: ['France'],
      states: [],
      cities: ['Paris'],
      assetCount: 9,
      albumAssetCount: 9,
      excludedDuplicateCount: 0,
      dayCount: 3,
      score: 74,
      confidence: 'high',
      placeKey: 'france:paris',
      placeLabel: 'Paris, France',
      source: {
        kind: 'tripCandidate',
        dedupeKey: 'trip:france:paris:2026-04-15:2026-04-17',
        takenAfter: new Date('2026-04-15T09:00:00Z'),
        takenBefore: new Date('2026-04-17T17:00:00Z'),
        places: [{ country: 'France', city: 'Paris' }],
        placeLabels: ['Paris, France'],
      },
    });
  });

  it('falls back to recent location clusters when day buckets are unavailable', async () => {
    const assetRepository = {
      getMemoryLocationClusters: vi
        .fn()
        .mockResolvedValueOnce([cluster({ country: 'Germany', city: 'Berlin', assetCount: 20, dayCount: 12 })])
        .mockResolvedValueOnce([cluster({ country: 'France', city: 'Paris', assetCount: 9, dayCount: 3 })]),
    };
    const service = new TripCandidateService(assetRepository);

    const [candidate] = await service.findRecentTripCandidates({
      ownerId: 'user-1',
      targetDate: new Date('2026-04-23T12:00:00Z'),
      lookbackDays: 30,
    });

    expect(assetRepository.getMemoryLocationClusters).toHaveBeenNthCalledWith(2, 'user-1', {
      takenAfter: new Date('2026-03-24T00:00:00.000Z'),
      takenBefore: new Date('2026-04-23T23:59:59.999Z'),
    });
    expect(candidate).toMatchObject({
      dedupeKey: 'trip:france:paris:2026-04-15:2026-04-17',
      title: 'Recent trip to Paris, France',
      subtitle: '9 photos over 3 days',
      confidence: 'high',
      placeKey: 'france:paris',
    });
  });

  it('returns no candidates for home-only recent day buckets', async () => {
    const { assetRepository, service } = setup();
    assetRepository.getMemoryLocationClusters.mockResolvedValueOnce([
      cluster({ country: 'Germany', city: 'Berlin', assetCount: 20, dayCount: 12 }),
    ]);
    assetRepository.getMemoryLocationDayBuckets.mockResolvedValueOnce([
      dayBucket({ localDate: '2026-04-15', country: 'Germany', city: 'Berlin', assetCount: 4 }),
      dayBucket({ localDate: '2026-04-16', country: 'Germany', city: 'Berlin', assetCount: 4 }),
      dayBucket({ localDate: '2026-04-17', country: 'Germany', city: 'Berlin', assetCount: 3 }),
    ]);

    await expect(service.findRecentTripCandidates({ ownerId: 'user-1' })).resolves.toEqual([]);
  });

  it('returns low-confidence candidates instead of failing when home baseline is ambiguous', async () => {
    const { assetRepository, service } = setup();
    assetRepository.getMemoryLocationClusters.mockResolvedValueOnce([
      cluster({ country: 'Germany', city: 'Berlin', assetCount: 10, dayCount: 6 }),
      cluster({ country: 'Austria', city: 'Vienna', assetCount: 9, dayCount: 6 }),
    ]);
    assetRepository.getMemoryLocationDayBuckets.mockResolvedValueOnce([
      dayBucket({ localDate: '2026-04-15', country: 'France', city: 'Paris', assetCount: 4 }),
      dayBucket({ localDate: '2026-04-16', country: 'France', city: 'Paris', assetCount: 4 }),
    ]);

    const [candidate] = await service.findRecentTripCandidates({
      ownerId: 'user-1',
      targetDate: new Date('2026-04-23T12:00:00Z'),
    });

    expect(candidate).toMatchObject({
      title: 'Recent trip to Paris, France',
      confidence: 'low',
      score: 48,
    });
  });

  it('generates stable dedupe keys from place and trip window rather than evaluation date', async () => {
    const { assetRepository, service } = setup();
    assetRepository.getMemoryLocationClusters
      .mockResolvedValueOnce([cluster({ country: 'Germany', city: 'Berlin', assetCount: 20, dayCount: 12 })])
      .mockResolvedValueOnce([cluster({ country: 'Germany', city: 'Berlin', assetCount: 20, dayCount: 12 })]);
    assetRepository.getMemoryLocationDayBuckets
      .mockResolvedValueOnce([
        dayBucket({ localDate: '2026-04-15', country: 'France', city: 'Paris', assetCount: 3 }),
        dayBucket({ localDate: '2026-04-16', country: 'France', city: 'Paris', assetCount: 3 }),
        dayBucket({ localDate: '2026-04-17', country: 'France', city: 'Paris', assetCount: 3 }),
      ])
      .mockResolvedValueOnce([
        dayBucket({ localDate: '2026-04-15', country: 'France', city: 'Paris', assetCount: 3 }),
        dayBucket({ localDate: '2026-04-16', country: 'France', city: 'Paris', assetCount: 3 }),
        dayBucket({ localDate: '2026-04-17', country: 'France', city: 'Paris', assetCount: 3 }),
      ]);

    const [first] = await service.findRecentTripCandidates({
      ownerId: 'user-1',
      targetDate: new Date('2026-04-23T12:00:00Z'),
    });
    const [second] = await service.findRecentTripCandidates({
      ownerId: 'user-1',
      targetDate: new Date('2026-04-30T12:00:00Z'),
    });

    expect(first?.dedupeKey).toBe('trip:france:paris:2026-04-15:2026-04-17');
    expect(second?.dedupeKey).toBe(first?.dedupeKey);
  });

  it('merges adjacent travel days into one multi-city candidate with deduplicated labels', async () => {
    const { assetRepository, service } = setup();
    assetRepository.getMemoryLocationClusters.mockResolvedValueOnce([
      cluster({ country: 'Germany', city: 'Berlin', assetCount: 30, dayCount: 20 }),
    ]);
    assetRepository.getMemoryLocationDayBuckets.mockResolvedValueOnce([
      dayBucket({ localDate: '2026-04-15', country: 'France', state: 'Ile-de-France', city: 'Paris', assetCount: 3 }),
      dayBucket({
        localDate: '2026-04-16',
        country: 'France',
        state: 'Auvergne-Rhone-Alpes',
        city: 'Lyon',
        assetCount: 4,
      }),
      dayBucket({ localDate: '2026-04-17', country: 'France', state: 'Ile-de-France', city: 'Paris', assetCount: 2 }),
    ]);

    const [candidate] = await service.findRecentTripCandidates({
      ownerId: 'user-1',
      targetDate: new Date('2026-04-23T12:00:00Z'),
    });

    expect(candidate).toMatchObject({
      dedupeKey: 'trip:france:paris+france:lyon:2026-04-15:2026-04-17',
      title: 'Recent trip to France',
      subtitle: '9 photos over 3 days',
      countries: ['France'],
      states: ['Ile-de-France', 'Auvergne-Rhone-Alpes'],
      cities: ['Paris', 'Lyon'],
      assetCount: 9,
      dayCount: 3,
      placeKey: 'france:paris+france:lyon',
      placeLabel: 'France',
      source: {
        places: [
          { country: 'France', state: 'Ile-de-France', city: 'Paris' },
          { country: 'France', state: 'Auvergne-Rhone-Alpes', city: 'Lyon' },
        ],
        placeLabels: ['Paris, France', 'Lyon, France'],
      },
    });
    expect(candidate?.takenAfter).toEqual(new Date('2026-04-15T09:00:00Z'));
    expect(candidate?.takenBefore).toEqual(new Date('2026-04-17T17:00:00Z'));
  });

  it('allows one no-photo day inside one cross-border trip', async () => {
    const { assetRepository, service } = setup();
    assetRepository.getMemoryLocationClusters.mockResolvedValueOnce([
      cluster({ country: 'Germany', city: 'Berlin', assetCount: 30, dayCount: 20 }),
    ]);
    assetRepository.getMemoryLocationDayBuckets.mockResolvedValueOnce([
      dayBucket({ localDate: '2026-04-15', country: 'France', city: 'Paris', assetCount: 4 }),
      dayBucket({ localDate: '2026-04-17', country: 'Italy', city: 'Rome', assetCount: 4 }),
    ]);

    const [candidate] = await service.findRecentTripCandidates({
      ownerId: 'user-1',
      targetDate: new Date('2026-04-23T12:00:00Z'),
    });

    expect(candidate).toMatchObject({
      dedupeKey: 'trip:france:paris+italy:rome:2026-04-15:2026-04-17',
      title: 'Recent trip to France and Italy',
      subtitle: '8 photos over 2 days',
      countries: ['France', 'Italy'],
      cities: ['Paris', 'Rome'],
      assetCount: 8,
      dayCount: 2,
      placeKey: 'france:paris+italy:rome',
      placeLabel: 'France and Italy',
      source: {
        places: [
          { country: 'France', state: null, city: 'Paris' },
          { country: 'Italy', state: null, city: 'Rome' },
        ],
        placeLabels: ['Paris, France', 'Rome, Italy'],
      },
    });
  });

  it('keeps source places distinct when the same city and country appear in different states', async () => {
    const { assetRepository, service } = setup();
    assetRepository.getMemoryLocationClusters.mockResolvedValueOnce([
      cluster({ country: 'Germany', city: 'Berlin', assetCount: 30, dayCount: 20 }),
    ]);
    assetRepository.getMemoryLocationDayBuckets.mockResolvedValueOnce([
      dayBucket({
        localDate: '2026-04-15',
        country: 'USA',
        state: 'Illinois',
        city: 'Springfield',
        assetCount: 4,
      }),
      dayBucket({
        localDate: '2026-04-16',
        country: 'USA',
        state: 'Massachusetts',
        city: 'Springfield',
        assetCount: 4,
      }),
    ]);

    const [candidate] = await service.findRecentTripCandidates({
      ownerId: 'user-1',
      targetDate: new Date('2026-04-23T12:00:00Z'),
    });

    expect(candidate).toMatchObject({
      dedupeKey: 'trip:usa:illinois:springfield+usa:massachusetts:springfield:2026-04-15:2026-04-16',
      states: ['Illinois', 'Massachusetts'],
      cities: ['Springfield'],
      placeKey: 'usa:illinois:springfield+usa:massachusetts:springfield',
      source: {
        places: [
          { country: 'USA', state: 'Illinois', city: 'Springfield' },
          { country: 'USA', state: 'Massachusetts', city: 'Springfield' },
        ],
        placeLabels: ['Springfield, Illinois, USA', 'Springfield, Massachusetts, USA'],
      },
    });
  });

  it('does not treat an in-window home photo day as a no-photo gap', async () => {
    const { assetRepository, service } = setup();
    assetRepository.getMemoryLocationClusters.mockResolvedValueOnce([
      cluster({ country: 'Germany', city: 'Berlin', assetCount: 30, dayCount: 20 }),
    ]);
    assetRepository.getMemoryLocationDayBuckets.mockResolvedValueOnce([
      dayBucket({ localDate: '2026-04-15', country: 'France', city: 'Paris', assetCount: 4 }),
      dayBucket({ localDate: '2026-04-16', country: 'Germany', city: 'Berlin', assetCount: 6 }),
      dayBucket({ localDate: '2026-04-17', country: 'Italy', city: 'Rome', assetCount: 4 }),
      dayBucket({ localDate: '2026-04-18', country: 'Italy', city: 'Rome', assetCount: 4 }),
    ]);

    const candidates = await service.findRecentTripCandidates({
      ownerId: 'user-1',
      targetDate: new Date('2026-04-23T12:00:00Z'),
      maxCandidates: 3,
    });

    expect(candidates.map((candidate) => candidate.dedupeKey)).toEqual(['trip:italy:rome:2026-04-17:2026-04-18']);
  });

  it('keeps clearly separate trips as separate candidates', async () => {
    const { assetRepository, service } = setup();
    assetRepository.getMemoryLocationClusters.mockResolvedValueOnce([
      cluster({ country: 'Germany', city: 'Berlin', assetCount: 30, dayCount: 20 }),
    ]);
    assetRepository.getMemoryLocationDayBuckets.mockResolvedValueOnce([
      dayBucket({ localDate: '2026-04-01', country: 'France', city: 'Paris', assetCount: 4 }),
      dayBucket({ localDate: '2026-04-02', country: 'France', city: 'Paris', assetCount: 4 }),
      dayBucket({ localDate: '2026-04-08', country: 'Italy', city: 'Rome', assetCount: 4 }),
      dayBucket({ localDate: '2026-04-09', country: 'Italy', city: 'Rome', assetCount: 4 }),
    ]);

    const candidates = await service.findRecentTripCandidates({
      ownerId: 'user-1',
      targetDate: new Date('2026-04-23T12:00:00Z'),
      maxCandidates: 3,
    });

    expect(candidates).toHaveLength(2);
    expect(candidates.map((candidate) => candidate.dedupeKey)).toEqual([
      'trip:italy:rome:2026-04-08:2026-04-09',
      'trip:france:paris:2026-04-01:2026-04-02',
    ]);
  });

  it('separates trips to the same place when a larger date gap divides them', async () => {
    const { assetRepository, service } = setup();
    assetRepository.getMemoryLocationClusters.mockResolvedValueOnce([
      cluster({ country: 'Germany', city: 'Berlin', assetCount: 30, dayCount: 20 }),
    ]);
    assetRepository.getMemoryLocationDayBuckets.mockResolvedValueOnce([
      dayBucket({ localDate: '2026-04-01', country: 'France', city: 'Paris', assetCount: 4 }),
      dayBucket({ localDate: '2026-04-02', country: 'France', city: 'Paris', assetCount: 4 }),
      dayBucket({ localDate: '2026-04-10', country: 'France', city: 'Paris', assetCount: 5 }),
      dayBucket({ localDate: '2026-04-11', country: 'France', city: 'Paris', assetCount: 4 }),
    ]);

    const candidates = await service.findRecentTripCandidates({
      ownerId: 'user-1',
      targetDate: new Date('2026-04-23T12:00:00Z'),
      maxCandidates: 3,
    });

    expect(candidates.map((candidate) => candidate.dedupeKey)).toEqual([
      'trip:france:paris:2026-04-10:2026-04-11',
      'trip:france:paris:2026-04-01:2026-04-02',
    ]);
  });

  it('matches USA place hints against accepted country metadata equivalents', async () => {
    const { assetRepository, service } = setup();
    assetRepository.getMemoryLocationClusters.mockResolvedValueOnce([
      cluster({ country: 'Germany', city: 'Berlin', assetCount: 30, dayCount: 20 }),
    ]);
    assetRepository.getMemoryLocationDayBuckets.mockResolvedValueOnce([
      dayBucket({
        localDate: '2026-04-15',
        country: 'United States of America',
        state: 'New York',
        city: 'New York',
        assetCount: 4,
      }),
      dayBucket({
        localDate: '2026-04-16',
        country: 'United States of America',
        state: 'New York',
        city: 'New York',
        assetCount: 4,
      }),
    ]);

    const [candidate] = await service.findRecentTripCandidates({
      ownerId: 'user-1',
      targetDate: new Date('2026-04-23T12:00:00Z'),
      placeHint: 'USA',
    });

    expect(candidate).toMatchObject({
      title: 'Recent trip to New York, United States of America',
      countries: ['United States of America'],
      cities: ['New York'],
      confidence: 'high',
    });
  });

  it('filters trip windows by city hints without geocoding', async () => {
    const { assetRepository, service } = setup();
    assetRepository.getMemoryLocationClusters.mockResolvedValueOnce([
      cluster({ country: 'Germany', city: 'Berlin', assetCount: 30, dayCount: 20 }),
    ]);
    assetRepository.getMemoryLocationDayBuckets.mockResolvedValueOnce([
      dayBucket({ localDate: '2026-04-15', country: 'France', city: 'Paris', assetCount: 4 }),
      dayBucket({ localDate: '2026-04-16', country: 'France', city: 'Paris', assetCount: 4 }),
      dayBucket({ localDate: '2026-04-17', country: 'Italy', city: 'Rome', assetCount: 4 }),
      dayBucket({ localDate: '2026-04-18', country: 'Italy', city: 'Rome', assetCount: 4 }),
    ]);

    const candidates = await service.findRecentTripCandidates({
      ownerId: 'user-1',
      targetDate: new Date('2026-04-23T12:00:00Z'),
      maxCandidates: 3,
      placeHint: 'Paris',
    });

    expect(candidates.map(({ dedupeKey }) => dedupeKey)).toEqual(['trip:france:paris:2026-04-15:2026-04-16']);
  });

  it('returns no candidates for unknown place hints instead of throwing', async () => {
    const { assetRepository, service } = setup();
    assetRepository.getMemoryLocationClusters.mockResolvedValueOnce([
      cluster({ country: 'Germany', city: 'Berlin', assetCount: 30, dayCount: 20 }),
    ]);
    assetRepository.getMemoryLocationDayBuckets.mockResolvedValueOnce([
      dayBucket({ localDate: '2026-04-15', country: 'France', city: 'Paris', assetCount: 4 }),
      dayBucket({ localDate: '2026-04-16', country: 'France', city: 'Paris', assetCount: 4 }),
    ]);

    await expect(
      service.findRecentTripCandidates({
        ownerId: 'user-1',
        targetDate: new Date('2026-04-23T12:00:00Z'),
        placeHint: 'Atlantis',
      }),
    ).resolves.toEqual([]);
  });

  it('allows place hints to find home-city trips with medium confidence', async () => {
    const { assetRepository, service } = setup();
    assetRepository.getMemoryLocationClusters.mockResolvedValueOnce([
      cluster({ country: 'Germany', city: 'Berlin', assetCount: 30, dayCount: 20 }),
    ]);
    assetRepository.getMemoryLocationDayBuckets.mockResolvedValueOnce([
      dayBucket({ localDate: '2026-04-15', country: 'Germany', city: 'Berlin', assetCount: 4 }),
      dayBucket({ localDate: '2026-04-16', country: 'Germany', city: 'Berlin', assetCount: 4 }),
    ]);

    const [candidate] = await service.findRecentTripCandidates({
      ownerId: 'user-1',
      targetDate: new Date('2026-04-23T12:00:00Z'),
      placeHint: 'Berlin',
    });

    expect(candidate).toMatchObject({
      title: 'Recent trip to Berlin, Germany',
      assetCount: 8,
      dayCount: 2,
      confidence: 'medium',
      score: 58,
    });
  });

  it('rejects overlong place hints before repository calls', async () => {
    const { assetRepository, service } = setup();

    await expect(
      service.findRecentTripCandidates({
        ownerId: 'user-1',
        placeHint: 'x'.repeat(TRIP_PLACE_HINT_MAX_LENGTH + 1),
      }),
    ).resolves.toEqual([]);

    expect(assetRepository.getMemoryLocationClusters).not.toHaveBeenCalled();
    expect(assetRepository.getMemoryLocationDayBuckets).not.toHaveBeenCalled();
  });

  it('filters fallback recent clusters by place hints when day buckets are unavailable', async () => {
    const assetRepository = {
      getMemoryLocationClusters: vi
        .fn()
        .mockResolvedValueOnce([cluster({ country: 'Germany', city: 'Berlin', assetCount: 30, dayCount: 20 })])
        .mockResolvedValueOnce([
          cluster({ country: 'France', city: 'Paris', assetCount: 8, dayCount: 2 }),
          cluster({ country: 'Italy', city: 'Rome', assetCount: 8, dayCount: 2 }),
        ]),
    };
    const service = new TripCandidateService(assetRepository);

    const candidates = await service.findRecentTripCandidates({
      ownerId: 'user-1',
      targetDate: new Date('2026-04-23T12:00:00Z'),
      placeHint: 'Rome',
    });

    expect(candidates.map(({ dedupeKey }) => dedupeKey)).toEqual(['trip:italy:rome:2026-04-15:2026-04-17']);
  });

  it('exposes album-ready counts on generic trip candidates without returning asset ids', async () => {
    const { assetRepository, service } = setupWithAlbumReady();
    assetRepository.getMemoryLocationClusters.mockResolvedValueOnce([
      cluster({ country: 'Germany', city: 'Berlin', assetCount: 30, dayCount: 20 }),
    ]);
    assetRepository.getMemoryLocationDayBuckets.mockResolvedValueOnce([
      dayBucket({ localDate: '2026-04-15', country: 'France', city: 'Paris', assetCount: 4 }),
      dayBucket({ localDate: '2026-04-16', country: 'France', city: 'Paris', assetCount: 4 }),
    ]);
    assetRepository.getTripCandidateAssets.mockResolvedValueOnce([
      tripAsset({ id: 'asset-1' }),
      tripAsset({ id: 'asset-2' }),
      tripAsset({ id: 'asset-3' }),
      tripAsset({ id: 'asset-4' }),
      tripAsset({ id: 'asset-5' }),
      tripAsset({ id: 'asset-6' }),
      tripAsset({ id: 'asset-7' }),
      tripAsset({ id: 'asset-8' }),
    ]);

    const [candidate] = await service.findRecentTripCandidates({
      ownerId: 'user-1',
      targetDate: new Date('2026-04-23T12:00:00Z'),
    });

    expect(candidate).toMatchObject({
      assetCount: 8,
      albumAssetCount: 8,
      excludedDuplicateCount: 0,
      excludedStackChildCount: 0,
    });
    expect(candidate).not.toHaveProperty('assetIds');
  });

  it('leaves generic candidate counts unchanged when album asset hydration returns a non-array', async () => {
    const { assetRepository, service } = setupWithAlbumReady();
    assetRepository.getMemoryLocationClusters.mockResolvedValueOnce([
      cluster({ country: 'Germany', city: 'Berlin', assetCount: 30, dayCount: 20 }),
    ]);
    assetRepository.getMemoryLocationDayBuckets.mockResolvedValueOnce([
      dayBucket({ localDate: '2026-04-15', country: 'France', city: 'Paris', assetCount: 4 }),
      dayBucket({ localDate: '2026-04-16', country: 'France', city: 'Paris', assetCount: 4 }),
    ]);
    assetRepository.getTripCandidateAssets.mockImplementationOnce(async () => {});

    const [candidate] = await service.findRecentTripCandidates({
      ownerId: 'user-1',
      targetDate: new Date('2026-04-23T12:00:00Z'),
    });

    expect(candidate).toMatchObject({
      assetCount: 8,
      albumAssetCount: 8,
      excludedDuplicateCount: 0,
      excludedStackChildCount: 0,
    });
  });

  it('keeps all duplicate variants when duplicate group hydration is unavailable', async () => {
    const assetRepository = {
      getMemoryLocationClusters: vi.fn(),
      getTripCandidateAssets: vi
        .fn()
        .mockResolvedValue([
          tripAsset({ id: 'small', duplicateId: 'dup-1', fileSizeInByte: 100 }),
          tripAsset({ id: 'large', duplicateId: 'dup-1', fileSizeInByte: 200 }),
        ]),
    };
    const service = new TripCandidateService(assetRepository);
    const source = {
      kind: 'tripCandidate' as const,
      dedupeKey: 'trip:france:paris:2026-04-15:2026-04-16',
      takenAfter: new Date('2026-04-15T00:00:00Z'),
      takenBefore: new Date('2026-04-16T23:59:59Z'),
      places: [{ country: 'France', city: 'Paris' }],
      placeLabels: ['Paris, France'],
    };

    await expect(service.materializeAlbumReadySelection('user-1', source)).resolves.toEqual({
      assetIds: ['small', 'large'],
      assetCount: 2,
      albumAssetCount: 2,
      excludedDuplicateCount: 0,
      excludedStackChildCount: 0,
      hydrated: true,
    });
  });

  it('materializes album-ready selections by keeping one duplicate variant when the full group is inside the trip', async () => {
    const { assetRepository, service } = setupWithAlbumReady();
    const source = {
      kind: 'tripCandidate' as const,
      dedupeKey: 'trip:france:paris:2026-04-15:2026-04-16',
      takenAfter: new Date('2026-04-15T00:00:00Z'),
      takenBefore: new Date('2026-04-16T23:59:59Z'),
      places: [{ country: 'France', city: 'Paris' }],
      placeLabels: ['Paris, France'],
    };
    const duplicateRows = [
      tripAsset({ id: 'small', duplicateId: 'dup-1', fileSizeInByte: 100, exifValueCount: 8 }),
      tripAsset({ id: 'large', duplicateId: 'dup-1', fileSizeInByte: 200, exifValueCount: 1 }),
    ];
    assetRepository.getTripCandidateAssets.mockResolvedValueOnce([
      ...duplicateRows,
      tripAsset({ id: 'asset-3' }),
      tripAsset({ id: 'asset-4' }),
    ]);
    assetRepository.getDuplicateGroupAssets.mockResolvedValueOnce(duplicateRows);

    await expect(service.materializeAlbumReadySelection('user-1', source)).resolves.toEqual({
      assetIds: ['large', 'asset-3', 'asset-4'],
      assetCount: 4,
      albumAssetCount: 3,
      excludedDuplicateCount: 1,
      excludedStackChildCount: 0,
      hydrated: true,
    });
  });

  it('keeps partial-overlap duplicate groups intact unless the full group is inside the trip', async () => {
    const { assetRepository, service } = setupWithAlbumReady();
    const source = {
      kind: 'tripCandidate' as const,
      dedupeKey: 'trip:france:paris:2026-04-15:2026-04-16',
      takenAfter: new Date('2026-04-15T00:00:00Z'),
      takenBefore: new Date('2026-04-16T23:59:59Z'),
      places: [{ country: 'France', city: 'Paris' }],
      placeLabels: ['Paris, France'],
    };
    assetRepository.getTripCandidateAssets.mockResolvedValueOnce([
      tripAsset({ id: 'in-trip', duplicateId: 'dup-1', fileSizeInByte: 100 }),
      tripAsset({ id: 'asset-2' }),
    ]);
    assetRepository.getDuplicateGroupAssets.mockResolvedValueOnce([
      tripAsset({ id: 'in-trip', duplicateId: 'dup-1', fileSizeInByte: 100 }),
      tripAsset({ id: 'outside-trip', duplicateId: 'dup-1', fileSizeInByte: 300 }),
    ]);

    await expect(service.materializeAlbumReadySelection('user-1', source)).resolves.toEqual({
      assetIds: ['in-trip', 'asset-2'],
      assetCount: 2,
      albumAssetCount: 2,
      excludedDuplicateCount: 0,
      excludedStackChildCount: 0,
      hydrated: true,
    });
  });

  it('excludes stack children only when the stack primary is inside the trip', async () => {
    const { assetRepository, service } = setupWithAlbumReady();
    const source = {
      kind: 'tripCandidate' as const,
      dedupeKey: 'trip:france:paris:2026-04-15:2026-04-16',
      takenAfter: new Date('2026-04-15T00:00:00Z'),
      takenBefore: new Date('2026-04-16T23:59:59Z'),
      places: [{ country: 'France', city: 'Paris' }],
      placeLabels: ['Paris, France'],
    };
    assetRepository.getTripCandidateAssets.mockResolvedValueOnce([
      tripAsset({ id: 'primary', stackId: 'stack-1', stackPrimaryAssetId: 'primary' }),
      tripAsset({ id: 'child', stackId: 'stack-1', stackPrimaryAssetId: 'primary' }),
      tripAsset({ id: 'orphan-child', stackId: 'stack-2', stackPrimaryAssetId: 'outside-primary' }),
    ]);

    await expect(service.materializeAlbumReadySelection('user-1', source)).resolves.toEqual({
      assetIds: ['primary', 'orphan-child'],
      assetCount: 3,
      albumAssetCount: 2,
      excludedDuplicateCount: 0,
      excludedStackChildCount: 1,
      hydrated: true,
    });
  });

  it('distinguishes duplicate and stack-child exclusion counts without mutating assets', async () => {
    const { assetRepository, service } = setupWithAlbumReady();
    const source = {
      kind: 'tripCandidate' as const,
      dedupeKey: 'trip:france:paris:2026-04-15:2026-04-16',
      takenAfter: new Date('2026-04-15T00:00:00Z'),
      takenBefore: new Date('2026-04-16T23:59:59Z'),
      places: [{ country: 'France', city: 'Paris' }],
      placeLabels: ['Paris, France'],
    };
    const duplicateRows = [
      tripAsset({ id: 'dup-small', duplicateId: 'dup-1', fileSizeInByte: 100 }),
      tripAsset({ id: 'dup-large', duplicateId: 'dup-1', fileSizeInByte: 200 }),
    ];
    assetRepository.getTripCandidateAssets.mockResolvedValueOnce([
      ...duplicateRows,
      tripAsset({ id: 'primary', stackId: 'stack-1', stackPrimaryAssetId: 'primary' }),
      tripAsset({ id: 'child', stackId: 'stack-1', stackPrimaryAssetId: 'primary' }),
    ]);
    assetRepository.getDuplicateGroupAssets.mockResolvedValueOnce(duplicateRows);

    await expect(service.materializeAlbumReadySelection('user-1', source)).resolves.toMatchObject({
      assetIds: ['dup-large', 'primary'],
      excludedDuplicateCount: 1,
      excludedStackChildCount: 1,
      hydrated: true,
    });
    expect(assetRepository.getTripCandidateAssets).toHaveBeenCalledTimes(1);
    expect(assetRepository.getDuplicateGroupAssets).toHaveBeenCalledWith('user-1', ['dup-1']);
  });

  it('deduplicates stack primaries after excluding stack children from a full duplicate group', async () => {
    const { assetRepository, service } = setupWithAlbumReady();
    const source = {
      kind: 'tripCandidate' as const,
      dedupeKey: 'trip:france:paris:2026-04-15:2026-04-16',
      takenAfter: new Date('2026-04-15T00:00:00Z'),
      takenBefore: new Date('2026-04-16T23:59:59Z'),
      places: [{ country: 'France', city: 'Paris' }],
      placeLabels: ['Paris, France'],
    };
    const duplicateRows = [
      tripAsset({
        id: 'stack-primary',
        duplicateId: 'dup-1',
        stackId: 'stack-1',
        stackPrimaryAssetId: 'stack-primary',
        fileSizeInByte: 300,
      }),
      tripAsset({
        id: 'stack-child',
        duplicateId: 'dup-1',
        stackId: 'stack-1',
        stackPrimaryAssetId: 'stack-primary',
        fileSizeInByte: 500,
      }),
      tripAsset({ id: 'standalone', duplicateId: 'dup-1', fileSizeInByte: 200 }),
    ];
    assetRepository.getTripCandidateAssets.mockResolvedValueOnce(duplicateRows);
    assetRepository.getDuplicateGroupAssets.mockResolvedValueOnce(duplicateRows);

    await expect(service.materializeAlbumReadySelection('user-1', source)).resolves.toEqual({
      assetIds: ['stack-primary'],
      assetCount: 3,
      albumAssetCount: 1,
      excludedDuplicateCount: 1,
      excludedStackChildCount: 1,
      hydrated: true,
    });
  });
});
