import type { CleanupAssetDto } from '@immich/sdk';

/** What the hub's banner shows for one date: its counts, its busiest year and a few of its photos. */
export type DayPeek = {
  photos: number;
  years: number;
  /** The year with the most photos on the date, with its most common city when known. */
  busiest?: { year: number; city: string | null };
  assets: CleanupAssetDto[];
};
