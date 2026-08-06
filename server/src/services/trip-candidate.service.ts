import { DateTime } from 'luxon';
import {
  AssetRepository,
  MemoryLocationCluster,
  MemoryLocationDayBucket,
  TripCandidateAssetRow,
} from 'src/repositories/asset.repository';
import type { TripPlaceHint } from 'src/services/trip-place-hint';
import { parseTripPlaceHint, tripPlaceMatchesHint } from 'src/services/trip-place-hint';
import { suggestDuplicateByMetadata } from 'src/utils/duplicate';

type TripCandidateRepository = Pick<AssetRepository, 'getMemoryLocationClusters'> &
  Partial<Pick<AssetRepository, 'getMemoryLocationDayBuckets' | 'getTripCandidateAssets' | 'getDuplicateGroupAssets'>>;

type HomeBaseline = { cluster?: MemoryLocationCluster; ambiguous: boolean };

type TravelWindow = {
  buckets: MemoryLocationDayBucket[];
  dayKeys: Set<string>;
  assetCount: number;
  firstDate: Date;
  lastDate: Date;
  places: Array<{ country: string; state: string | null; city: string | null }>;
};

export type TripCandidateConfidence = 'high' | 'medium' | 'low';

export interface TripCandidateRequest {
  ownerId: string;
  targetDate?: Date;
  lookbackDays?: number;
  baselineDays?: number;
  maxCandidates?: number;
  placeHint?: string;
}

export interface TripCandidateSource {
  kind: 'tripCandidate';
  dedupeKey: string;
  takenAfter: Date;
  takenBefore: Date;
  places: Array<{ country: string; state?: string | null; city?: string | null }>;
  placeLabels: string[];
}

export interface TripCandidate {
  dedupeKey: string;
  title: string;
  subtitle: string;
  countries: string[];
  states: string[];
  cities: string[];
  takenAfter: Date;
  takenBefore: Date;
  assetCount: number;
  albumAssetCount: number;
  excludedDuplicateCount: number;
  excludedStackChildCount: number;
  dayCount: number;
  score: number;
  confidence: TripCandidateConfidence;
  source: TripCandidateSource;
  placeKey: string;
  placeLabel: string;
}

export interface TripCandidateAlbumSelection {
  assetIds: string[];
  assetCount: number;
  albumAssetCount: number;
  excludedDuplicateCount: number;
  excludedStackChildCount: number;
  hydrated: boolean;
}

export class TripCandidateService {
  private static readonly HOME_DOMINANCE_RATIO = 1.25;
  private static readonly MAX_NO_PHOTO_GAP_DAYS = 1;

  constructor(private assetRepository: TripCandidateRepository) {}

  async findRecentTripCandidates({
    ownerId,
    targetDate,
    lookbackDays = 30,
    baselineDays = 90,
    maxCandidates = 3,
    placeHint,
  }: TripCandidateRequest): Promise<TripCandidate[]> {
    const parsedPlaceHint = parseTripPlaceHint(placeHint);
    if (parsedPlaceHint.status === 'invalid') {
      return [];
    }
    const matchedPlaceHint = parsedPlaceHint.status === 'valid' ? parsedPlaceHint.hint : undefined;

    const target = DateTime.fromJSDate(targetDate ?? new Date(), { zone: 'utc' }).endOf('day');
    const recentFrom = target.minus({ days: lookbackDays }).startOf('day');
    const baselineFrom = recentFrom.minus({ days: baselineDays });
    const baselineTo = recentFrom.minus({ days: 1 }).endOf('day');
    const recentRange = {
      takenAfter: recentFrom.toJSDate(),
      takenBefore: target.toJSDate(),
    };
    const dayBucketPromise = this.assetRepository.getMemoryLocationDayBuckets?.(ownerId, recentRange);

    const [baseline, dayBuckets] = await Promise.all([
      this.assetRepository.getMemoryLocationClusters(ownerId, {
        takenAfter: baselineFrom.toJSDate(),
        takenBefore: baselineTo.toJSDate(),
      }),
      dayBucketPromise,
    ]);

    const home = this.resolveHomeBaseline(baseline);
    const candidates = Array.isArray(dayBuckets)
      ? this.findWindowCandidates(dayBuckets, home, matchedPlaceHint)
      : this.findClusterCandidates(
          await this.assetRepository.getMemoryLocationClusters(ownerId, recentRange),
          home,
          matchedPlaceHint,
        );

    const albumReadyCandidates = await Promise.all(
      candidates.map((candidate) => this.withAlbumReadyCounts(ownerId, candidate)),
    );

    return albumReadyCandidates
      .toSorted((left, right) => right.score - left.score || right.takenAfter.getTime() - left.takenAfter.getTime())
      .slice(0, maxCandidates);
  }

  private async withAlbumReadyCounts(ownerId: string, candidate: TripCandidate): Promise<TripCandidate> {
    if (!this.assetRepository.getTripCandidateAssets) {
      return candidate;
    }

    const selection = await this.materializeAlbumReadySelection(ownerId, candidate.source);
    if (!selection.hydrated) {
      return candidate;
    }

    return {
      ...candidate,
      albumAssetCount: selection.albumAssetCount,
      excludedDuplicateCount: selection.excludedDuplicateCount,
      excludedStackChildCount: selection.excludedStackChildCount,
    };
  }

  private resolveHomeBaseline(baseline: MemoryLocationCluster[]): HomeBaseline {
    const [home, runnerUp] = baseline;
    const ambiguous =
      !home?.country ||
      (!!runnerUp &&
        runnerUp.country !== home.country &&
        runnerUp.assetCount >= home.assetCount / TripCandidateService.HOME_DOMINANCE_RATIO);

    return { cluster: home?.country ? home : undefined, ambiguous };
  }

  private findClusterCandidates(
    recent: MemoryLocationCluster[],
    home: HomeBaseline,
    placeHint?: TripPlaceHint,
  ): TripCandidate[] {
    return recent
      .filter((item) => this.isQualifyingCluster(item))
      .filter((item) => !placeHint || this.matchesPlaceHint(item, placeHint))
      .filter((item) => !!placeHint || !home.cluster || home.ambiguous || this.isAwayFromHome(item, home.cluster))
      .map((item) => this.toClusterTripCandidate(item, this.getPlaceConfidence(item, home, placeHint)));
  }

  private findWindowCandidates(
    recent: MemoryLocationDayBucket[],
    home: HomeBaseline,
    placeHint?: TripPlaceHint,
  ): TripCandidate[] {
    const qualifyingBuckets = recent
      .filter((item) => this.isQualifyingTravelBucket(item))
      .filter((item) => !placeHint || this.matchesPlaceHint(item, placeHint))
      .toSorted(
        (left, right) => left.localDate.getTime() - right.localDate.getTime() || right.assetCount - left.assetCount,
      );
    const blockedGapDayKeys = new Set<string>();
    const travelBuckets = qualifyingBuckets.filter((item) => {
      if (placeHint || this.isTravelBucket(item, home)) {
        return true;
      }

      blockedGapDayKeys.add(this.dayKey(item.localDate));
      return false;
    });

    return this.buildTravelWindows(travelBuckets, blockedGapDayKeys)
      .filter((window) => window.assetCount >= 7 && window.dayKeys.size >= 2)
      .map((window) => this.toWindowTripCandidate(window, this.getWindowConfidence(window, home, placeHint)));
  }

  private matchesPlaceHint(
    place: { country: string | null; state?: string | null; city: string | null },
    hint: TripPlaceHint,
  ) {
    return tripPlaceMatchesHint(place, hint);
  }

  private getWindowConfidence(
    window: TravelWindow,
    home: HomeBaseline,
    placeHint?: TripPlaceHint,
  ): TripCandidateConfidence {
    if (home.ambiguous) {
      return 'low';
    }

    if (placeHint && window.places.some((place) => this.overlapsHomePlace(place, home.cluster))) {
      return 'medium';
    }

    return 'high';
  }

  private getPlaceConfidence(
    place: { country: string | null; city: string | null },
    home: HomeBaseline,
    placeHint?: TripPlaceHint,
  ): TripCandidateConfidence {
    if (home.ambiguous) {
      return 'low';
    }

    if (placeHint && this.overlapsHomePlace(place, home.cluster)) {
      return 'medium';
    }

    return 'high';
  }

  private overlapsHomePlace(
    place: { country: string | null; city?: string | null },
    home?: { country: string | null; city: string | null },
  ) {
    if (!home?.country || place.country !== home.country) {
      return false;
    }

    if (home.city && place.city) {
      return place.city === home.city;
    }

    return true;
  }

  private isQualifyingTravelBucket(item: MemoryLocationDayBucket) {
    return !!item.country && item.assetCount > 0;
  }

  private isTravelBucket(item: MemoryLocationDayBucket, home: HomeBaseline) {
    return !home.cluster || home.ambiguous || this.isAwayFromHome(item, home.cluster);
  }

  private buildTravelWindows(
    buckets: MemoryLocationDayBucket[],
    blockedGapDayKeys = new Set<string>(),
  ): TravelWindow[] {
    const windows: TravelWindow[] = [];
    let current: TravelWindow | undefined;
    let lastDay: DateTime | undefined;

    for (const bucket of buckets) {
      const bucketDay = DateTime.fromJSDate(bucket.localDate, { zone: 'utc' }).startOf('day');
      const gapDays = lastDay ? bucketDay.diff(lastDay, 'days').days - 1 : 0;

      if (
        !current ||
        gapDays > TripCandidateService.MAX_NO_PHOTO_GAP_DAYS ||
        this.hasBlockedGapDay(lastDay, bucketDay, blockedGapDayKeys)
      ) {
        current = this.createWindow(bucket);
        windows.push(current);
      } else {
        this.addBucketToWindow(current, bucket);
      }

      lastDay = bucketDay;
    }

    return windows;
  }

  private hasBlockedGapDay(lastDay: DateTime | undefined, bucketDay: DateTime, blockedGapDayKeys: Set<string>) {
    if (!lastDay || blockedGapDayKeys.size === 0) {
      return false;
    }

    for (let day = lastDay.plus({ days: 1 }); day < bucketDay; day = day.plus({ days: 1 })) {
      if (blockedGapDayKeys.has(day.toFormat('yyyy-MM-dd'))) {
        return true;
      }
    }

    return false;
  }

  private createWindow(bucket: MemoryLocationDayBucket): TravelWindow {
    const window: TravelWindow = {
      buckets: [],
      dayKeys: new Set<string>(),
      assetCount: 0,
      firstDate: bucket.firstDate,
      lastDate: bucket.lastDate,
      places: [],
    };

    this.addBucketToWindow(window, bucket);
    return window;
  }

  private addBucketToWindow(window: TravelWindow, bucket: MemoryLocationDayBucket) {
    window.buckets.push(bucket);
    window.assetCount += bucket.assetCount;
    window.dayKeys.add(this.dayKey(bucket.localDate));
    window.firstDate = new Date(Math.min(window.firstDate.getTime(), bucket.firstDate.getTime()));
    window.lastDate = new Date(Math.max(window.lastDate.getTime(), bucket.lastDate.getTime()));

    if (bucket.country) {
      const place = { country: bucket.country, state: bucket.state ?? null, city: bucket.city ?? null };
      const key = this.sourcePlaceKey(place);
      if (!window.places.some((item) => this.sourcePlaceKey(item) === key)) {
        window.places.push(place);
      }
    }
  }

  private isQualifyingCluster(item: MemoryLocationCluster) {
    return !!item.country && item.assetCount >= 7 && item.dayCount >= 2;
  }

  private isAwayFromHome(
    item: { country: string | null; city: string | null },
    home: { country: string | null; city: string | null },
  ) {
    if (item.country !== home.country) {
      return true;
    }

    return !!home.city && !!item.city && item.city !== home.city;
  }

  private toClusterTripCandidate(item: MemoryLocationCluster, confidence: TripCandidateConfidence): TripCandidate {
    const country = item.country!;
    const city = item.city ?? null;
    const place = { country, city };
    const placeKey = this.placeKey([place]);
    const placeLabel = this.labelPlace(place);
    const firstDate = this.dayKey(item.firstDate);
    const lastDate = this.dayKey(item.lastDate);
    const dedupeKey = `trip:${placeKey}:${firstDate}:${lastDate}`;
    const score = this.scoreCandidate(item, confidence);

    return {
      dedupeKey,
      title: `Recent trip to ${placeLabel}`,
      subtitle: `${item.assetCount} photos over ${item.dayCount} days`,
      countries: [country],
      states: [],
      cities: city ? [city] : [],
      takenAfter: item.firstDate,
      takenBefore: item.lastDate,
      assetCount: item.assetCount,
      albumAssetCount: item.assetCount,
      excludedDuplicateCount: 0,
      excludedStackChildCount: 0,
      dayCount: item.dayCount,
      score,
      confidence,
      source: {
        kind: 'tripCandidate',
        dedupeKey,
        takenAfter: item.firstDate,
        takenBefore: item.lastDate,
        places: [{ country, city }],
        placeLabels: [placeLabel],
      },
      placeKey,
      placeLabel,
    };
  }

  private toWindowTripCandidate(window: TravelWindow, confidence: TripCandidateConfidence): TripCandidate {
    const countries = this.uniqueValues(window.places.map((place) => place.country));
    const states = this.uniqueValues(
      window.places.map((place) => place.state).filter((value): value is string => !!value),
    );
    const cities = this.uniqueValues(
      window.places.map((place) => place.city).filter((value): value is string => !!value),
    );
    const placeLabels = this.uniqueValues(
      window.places.map((place) => this.labelPlace(place, this.needsStateDisambiguation(place, window.places))),
    );
    const placeKey = this.placeKey(window.places);
    const placeLabel = this.labelWindow(countries, cities);
    const firstDate = this.dayKey(window.firstDate);
    const lastDate = this.dayKey(window.lastDate);
    const dedupeKey = `trip:${placeKey}:${firstDate}:${lastDate}`;
    const dayCount = window.dayKeys.size;
    const score = this.scoreCandidate({ assetCount: window.assetCount, dayCount }, confidence);

    return {
      dedupeKey,
      title: `Recent trip to ${placeLabel}`,
      subtitle: `${window.assetCount} photos over ${dayCount} days`,
      countries,
      states,
      cities,
      takenAfter: window.firstDate,
      takenBefore: window.lastDate,
      assetCount: window.assetCount,
      albumAssetCount: window.assetCount,
      excludedDuplicateCount: 0,
      excludedStackChildCount: 0,
      dayCount,
      score,
      confidence,
      source: {
        kind: 'tripCandidate',
        dedupeKey,
        takenAfter: window.firstDate,
        takenBefore: window.lastDate,
        places: window.places,
        placeLabels,
      },
      placeKey,
      placeLabel,
    };
  }

  async materializeAlbumReadySelection(
    ownerId: string,
    source: TripCandidateSource,
  ): Promise<TripCandidateAlbumSelection> {
    if (!this.assetRepository.getTripCandidateAssets) {
      return {
        assetIds: [],
        assetCount: 0,
        albumAssetCount: 0,
        excludedDuplicateCount: 0,
        excludedStackChildCount: 0,
        hydrated: false,
      };
    }

    const sourceAssets = await this.assetRepository.getTripCandidateAssets(ownerId, {
      takenAfter: source.takenAfter,
      takenBefore: source.takenBefore,
      places: source.places,
    });
    if (!Array.isArray(sourceAssets)) {
      return {
        assetIds: [],
        assetCount: 0,
        albumAssetCount: 0,
        excludedDuplicateCount: 0,
        excludedStackChildCount: 0,
        hydrated: false,
      };
    }

    const sourceIds = new Set(sourceAssets.map(({ id }) => id));
    const { assets: stackFilteredAssets, excludedStackChildCount } = this.excludeStackChildren(sourceAssets, sourceIds);
    const { assetIds, excludedDuplicateCount } = await this.excludeDuplicateVariants(
      ownerId,
      stackFilteredAssets,
      sourceIds,
    );

    return {
      assetIds,
      assetCount: sourceAssets.length,
      albumAssetCount: assetIds.length,
      excludedDuplicateCount,
      excludedStackChildCount,
      hydrated: true,
    };
  }

  private excludeStackChildren(assets: TripCandidateAssetRow[], sourceIds: Set<string>) {
    const kept: TripCandidateAssetRow[] = [];
    let excludedStackChildCount = 0;

    for (const asset of assets) {
      const isStackChild = !!asset.stackId && !!asset.stackPrimaryAssetId && asset.id !== asset.stackPrimaryAssetId;
      if (isStackChild && sourceIds.has(asset.stackPrimaryAssetId!)) {
        excludedStackChildCount++;
        continue;
      }

      kept.push(asset);
    }

    return { assets: kept, excludedStackChildCount };
  }

  private async excludeDuplicateVariants(ownerId: string, assets: TripCandidateAssetRow[], sourceIds: Set<string>) {
    const duplicateIds = this.uniqueValues(
      assets.map((asset) => asset.duplicateId).filter((duplicateId): duplicateId is string => !!duplicateId),
    );
    if (!this.assetRepository.getDuplicateGroupAssets || duplicateIds.length === 0) {
      return { assetIds: assets.map(({ id }) => id), excludedDuplicateCount: 0 };
    }

    const groupAssets = await this.assetRepository.getDuplicateGroupAssets(ownerId, duplicateIds);
    if (!Array.isArray(groupAssets)) {
      return { assetIds: assets.map(({ id }) => id), excludedDuplicateCount: 0 };
    }

    const assetsByDuplicateId = this.groupByDuplicateId(assets);
    const fullGroupsByDuplicateId = this.groupByDuplicateId(groupAssets);
    const excludedIds = new Set<string>();

    for (const [duplicateId, candidateGroup] of assetsByDuplicateId) {
      const fullGroup = fullGroupsByDuplicateId.get(duplicateId) ?? [];
      if (
        candidateGroup.length <= 1 ||
        fullGroup.length <= 1 ||
        !this.isFullDuplicateGroupInsideSource(fullGroup, sourceIds)
      ) {
        continue;
      }

      const keeper = suggestDuplicateByMetadata(candidateGroup, {
        getFileSizeInByte: (asset) => asset.fileSizeInByte,
        getExifCount: (asset) => asset.exifValueCount,
      });
      if (!keeper) {
        continue;
      }

      for (const asset of candidateGroup) {
        if (asset.id !== keeper.id) {
          excludedIds.add(asset.id);
        }
      }
    }

    return {
      assetIds: assets.filter(({ id }) => !excludedIds.has(id)).map(({ id }) => id),
      excludedDuplicateCount: excludedIds.size,
    };
  }

  private groupByDuplicateId(assets: TripCandidateAssetRow[]) {
    const groups = new Map<string, TripCandidateAssetRow[]>();
    for (const asset of assets) {
      if (!asset.duplicateId) {
        continue;
      }

      groups.set(asset.duplicateId, [...(groups.get(asset.duplicateId) ?? []), asset]);
    }

    return groups;
  }

  private isFullDuplicateGroupInsideSource(fullGroup: TripCandidateAssetRow[], sourceIds: Set<string>) {
    return fullGroup.every(({ id }) => sourceIds.has(id));
  }

  private labelWindow(countries: string[], cities: string[]): string {
    if (countries.length === 1 && cities.length === 1) {
      return `${cities[0]}, ${countries[0]}`;
    }

    return this.joinLabels(countries);
  }

  private labelPlace(place: { country: string; state?: string | null; city?: string | null }, includeState = false) {
    if (place.city && includeState && place.state) {
      return `${place.city}, ${place.state}, ${place.country}`;
    }

    if (place.city) {
      return `${place.city}, ${place.country}`;
    }

    if (includeState && place.state) {
      return `${place.state}, ${place.country}`;
    }

    return place.country;
  }

  private placeKey(places: Array<{ country: string; state?: string | null; city?: string | null }>) {
    return places
      .map((place) => {
        const baseKey = `${place.country}:${place.city ?? ''}`;
        if (place.state && this.needsStateDisambiguation(place, places)) {
          return `${place.country}:${place.state}:${place.city ?? ''}`.toLowerCase();
        }

        return baseKey.toLowerCase();
      })
      .join('+');
  }

  private sourcePlaceKey(place: { country: string; state?: string | null; city?: string | null }) {
    return `${place.country}:${place.state ?? ''}:${place.city ?? ''}`.toLowerCase();
  }

  private needsStateDisambiguation(
    place: { country: string; state?: string | null; city?: string | null },
    places: Array<{ country: string; state?: string | null; city?: string | null }>,
  ) {
    const cityKey = `${place.country}:${place.city ?? ''}`.toLowerCase();
    return places.filter((item) => `${item.country}:${item.city ?? ''}`.toLowerCase() === cityKey).length > 1;
  }

  private joinLabels(values: string[]) {
    if (values.length <= 2) {
      return values.join(' and ');
    }

    return `${values.slice(0, -1).join(', ')} and ${values.at(-1)}`;
  }

  private uniqueValues(values: string[]) {
    return [...new Set(values)];
  }

  private dayKey(date: Date) {
    return DateTime.fromJSDate(date, { zone: 'utc' }).toFormat('yyyy-MM-dd');
  }

  private scoreCandidate(item: { assetCount: number; dayCount: number }, confidence: TripCandidateConfidence) {
    const baseScore = 50 + item.dayCount * 5 + Math.min(item.assetCount, 20);
    if (confidence === 'low') {
      return Math.max(1, baseScore - 20);
    }

    if (confidence === 'medium') {
      return Math.max(1, baseScore - 10);
    }

    return baseScore;
  }
}
