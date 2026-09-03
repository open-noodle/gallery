import { MemoryType } from 'src/enum';
import * as favoritesThrowback from 'src/services/memory-rules/favorites-throwback.rule';
import {
  buildDefaultMemoryTypeMap,
  getAdminAvailableMemoryTypeKeys,
  getMemoryTypeFloor,
  getMemoryTypeKeyForMemory,
  getMemoryTypeMetadata,
  isMemoryTypeEnabledForUser,
  MEMORY_TYPE_KEYS,
  MEMORY_TYPE_METADATA,
} from 'src/services/memory-rules/memory-type.metadata';
import * as monthRecap from 'src/services/memory-rules/month-recap.rule';
import * as onThisDayPlace from 'src/services/memory-rules/on-this-day-place.rule';
import * as peopleTogether from 'src/services/memory-rules/people-together.rule';
import * as personThrowback from 'src/services/memory-rules/person-throwback.rule';
import * as recentTrip from 'src/services/memory-rules/recent-trip.rule';
import * as seasonRecap from 'src/services/memory-rules/season-recap.rule';
import * as themed from 'src/services/memory-rules/themed.rule';
import * as tripAnniversary from 'src/services/memory-rules/trip-anniversary.rule';
import { curateTripAssets } from 'src/services/memory-rules/trip.util';
import * as videoMoments from 'src/services/memory-rules/video-moments.rule';

/**
 * The smallest asset count each rule can actually emit. This is NOT always its pool gate:
 * the trip rules burst-collapse before sampling, so a 7-asset trip can emit 2. See spec §6.4.
 */
const SMALLEST_EMITTED_SAMPLE: Record<string, number> = {
  on_this_day: 1, // no gate at all — the defect in spec §2.3
  birthday: 4, // fallback path requires exactly 4
  recent_trip: 2, // burst-collapsed, see the dedicated test below
  month_recap: monthRecap.MIN_ASSETS,
  favorites_throwback: favoritesThrowback.MIN_FAVORITES,
  on_this_day_place: onThisDayPlace.MIN_ASSETS,
  season_recap: seasonRecap.MIN_ASSETS,
  people_together: peopleTogether.MIN_ASSETS,
  video_moments: videoMoments.MIN_ASSETS,
  trip_anniversary: 2, // same burst-collapse as recent_trip
  themed: themed.MIN_ASSETS,
  person_throwback: personThrowback.MIN_CHAPTER_ASSETS,
};

/** Fixture helper: an asset at `day 2025-09-<day>` at the given minute past 12:00 UTC. */
const burst = (day: number, minute: number) => ({
  id: `${day}-${minute}`,
  localDateTime: new Date(Date.UTC(2025, 8, day, 12, minute)),
});

describe('memory-type.metadata', () => {
  describe('MEMORY_TYPE_METADATA', () => {
    it('has unique keys', () => {
      const keys = MEMORY_TYPE_METADATA.map((m) => m.key);
      expect(new Set(keys).size).toBe(keys.length);
    });

    it('contains the current types with expected attributes', () => {
      expect(MEMORY_TYPE_METADATA).toEqual([
        { key: 'on_this_day', kind: 'on_this_day', defaultEnabled: true, adminConfigurable: true, minAssets: 3 },
        { key: 'birthday', kind: 'rule', defaultEnabled: true, adminConfigurable: true, minAssets: 3 },
        { key: 'recent_trip', kind: 'rule', defaultEnabled: true, adminConfigurable: true, minAssets: 2 },
        { key: 'month_recap', kind: 'rule', defaultEnabled: true, adminConfigurable: true, minAssets: 8 },
        { key: 'favorites_throwback', kind: 'rule', defaultEnabled: true, adminConfigurable: true, minAssets: 3 },
        { key: 'on_this_day_place', kind: 'rule', defaultEnabled: true, adminConfigurable: true, minAssets: 3 },
        { key: 'season_recap', kind: 'rule', defaultEnabled: true, adminConfigurable: true, minAssets: 10 },
        { key: 'people_together', kind: 'rule', defaultEnabled: true, adminConfigurable: true, minAssets: 4 },
        { key: 'video_moments', kind: 'rule', defaultEnabled: true, adminConfigurable: true, minAssets: 3 },
        { key: 'trip_anniversary', kind: 'rule', defaultEnabled: true, adminConfigurable: true, minAssets: 2 },
        { key: 'themed', kind: 'rule', defaultEnabled: true, adminConfigurable: true, minAssets: 5 },
        { key: 'person_throwback', kind: 'rule', defaultEnabled: true, adminConfigurable: true, minAssets: 4 },
      ]);
    });

    it('every rule-kind entry has a non-empty key', () => {
      const ruleEntries = MEMORY_TYPE_METADATA.filter((m) => m.kind === 'rule');
      for (const meta of ruleEntries) {
        expect(typeof meta.key).toBe('string');
        expect(meta.key.length).toBeGreaterThan(0);
      }
    });

    it('MEMORY_TYPE_KEYS lists keys in registry order', () => {
      expect(MEMORY_TYPE_KEYS).toEqual([
        'on_this_day',
        'birthday',
        'recent_trip',
        'month_recap',
        'favorites_throwback',
        'on_this_day_place',
        'season_recap',
        'people_together',
        'video_moments',
        'trip_anniversary',
        'themed',
        'person_throwback',
      ]);
    });
  });

  describe('buildDefaultMemoryTypeMap', () => {
    it('returns all keys enabled', () => {
      expect(buildDefaultMemoryTypeMap()).toEqual({
        on_this_day: true,
        birthday: true,
        recent_trip: true,
        month_recap: true,
        favorites_throwback: true,
        on_this_day_place: true,
        season_recap: true,
        people_together: true,
        video_moments: true,
        trip_anniversary: true,
        themed: true,
        person_throwback: true,
      });
    });
  });

  describe('getMemoryTypeMetadata', () => {
    it('returns the entry for a known key', () => {
      expect(getMemoryTypeMetadata('birthday')?.kind).toBe('rule');
    });

    it('returns undefined for an unknown key', () => {
      expect(getMemoryTypeMetadata('nope')).toBeUndefined();
    });
  });

  describe('getMemoryTypeKeyForMemory', () => {
    it('maps OnThisDay to on_this_day', () => {
      expect(getMemoryTypeKeyForMemory(MemoryType.OnThisDay, { year: 2020 })).toBe('on_this_day');
    });

    it('maps Rule to its ruleId', () => {
      expect(getMemoryTypeKeyForMemory(MemoryType.Rule, { ruleId: 'birthday' })).toBe('birthday');
    });

    it('maps Rule to people_together', () => {
      expect(getMemoryTypeKeyForMemory(MemoryType.Rule, { ruleId: 'people_together' })).toBe('people_together');
    });

    it('returns undefined for Rule without a string ruleId', () => {
      expect(getMemoryTypeKeyForMemory(MemoryType.Rule, {})).toBeUndefined();
      expect(getMemoryTypeKeyForMemory(MemoryType.Rule, null)).toBeUndefined();
      expect(getMemoryTypeKeyForMemory(MemoryType.Rule, { ruleId: 42 })).toBeUndefined();
    });
  });

  describe('getAdminAvailableMemoryTypeKeys', () => {
    it('returns all types when no overrides', () => {
      expect(getAdminAvailableMemoryTypeKeys({})).toEqual(
        new Set([
          'on_this_day',
          'birthday',
          'recent_trip',
          'month_recap',
          'favorites_throwback',
          'on_this_day_place',
          'season_recap',
          'people_together',
          'video_moments',
          'trip_anniversary',
          'themed',
          'person_throwback',
        ]),
      );
    });

    it('adds month_recap as a rule type mapping to its ruleId', () => {
      expect(getMemoryTypeKeyForMemory(MemoryType.Rule, { ruleId: 'month_recap' })).toBe('month_recap');
      expect(getMemoryTypeMetadata('month_recap')).toEqual({
        key: 'month_recap',
        kind: 'rule',
        defaultEnabled: true,
        adminConfigurable: true,
        minAssets: 8,
      });
    });

    it('honors an explicit types override', () => {
      const result = getAdminAvailableMemoryTypeKeys({ types: { recent_trip: false } });
      expect(result.has('recent_trip')).toBe(false);
      expect(result.has('birthday')).toBe(true);
      expect(result.has('on_this_day')).toBe(true);
    });

    it('honors a legacy bool when there is no types override', () => {
      const result = getAdminAvailableMemoryTypeKeys({ birthday: false });
      expect(result.has('birthday')).toBe(false);
      expect(result.has('recent_trip')).toBe(true);
    });

    it('prefers an explicit types value over the legacy bool', () => {
      const result = getAdminAvailableMemoryTypeKeys({ birthday: false, types: { birthday: true } });
      expect(result.has('birthday')).toBe(true);
    });

    it('ignores unknown keys in the types map', () => {
      expect(getAdminAvailableMemoryTypeKeys({ types: { unknown_key: true } })).toEqual(
        new Set([
          'on_this_day',
          'birthday',
          'recent_trip',
          'month_recap',
          'favorites_throwback',
          'on_this_day_place',
          'season_recap',
          'people_together',
          'video_moments',
          'trip_anniversary',
          'themed',
          'person_throwback',
        ]),
      );
    });
  });

  describe('isMemoryTypeEnabledForUser', () => {
    it('defaults to enabled for a known key', () => {
      expect(isMemoryTypeEnabledForUser(undefined, 'birthday')).toBe(true);
    });

    it('defaults to enabled for people_together', () => {
      expect(isMemoryTypeEnabledForUser(undefined, 'people_together')).toBe(true);
    });

    it('honors an explicit override', () => {
      expect(isMemoryTypeEnabledForUser({ birthday: false }, 'birthday')).toBe(false);
    });

    it('falls back to the default when the key is absent from the map', () => {
      expect(isMemoryTypeEnabledForUser({}, 'recent_trip')).toBe(true);
    });

    it('returns false for an unknown key', () => {
      expect(isMemoryTypeEnabledForUser(undefined, 'unknown_key')).toBe(false);
    });
  });

  describe('minAssets floors', () => {
    it('declares a positive integer floor for every registry key', () => {
      for (const meta of MEMORY_TYPE_METADATA) {
        expect(Number.isSafeInteger(meta.minAssets), `${meta.key} minAssets must be an integer`).toBe(true);
        expect(meta.minAssets, `${meta.key} minAssets must be positive`).toBeGreaterThan(0);
      }
    });

    it('covers every registry key in SMALLEST_EMITTED_SAMPLE — a new rule without a floor fails here', () => {
      expect(Object.keys(SMALLEST_EMITTED_SAMPLE).toSorted()).toEqual([...MEMORY_TYPE_KEYS].toSorted());
    });

    it('never sets a floor above what the rule can emit, except on_this_day', () => {
      for (const meta of MEMORY_TYPE_METADATA) {
        if (meta.key === 'on_this_day') {
          continue;
        }
        expect(meta.minAssets, `${meta.key} floor exceeds its smallest emitted sample`).toBeLessThanOrEqual(
          SMALLEST_EMITTED_SAMPLE[meta.key]!,
        );
      }
    });

    it('never sets a floor above the rule cap that bounds the sample', () => {
      const caps: Record<string, number> = {
        birthday: 12, // birthday.rule.ts slices to 12
        recent_trip: recentTrip.ASSET_CAP,
        month_recap: monthRecap.ASSET_CAP,
        favorites_throwback: favoritesThrowback.ASSET_CAP,
        on_this_day_place: onThisDayPlace.ASSET_CAP,
        season_recap: seasonRecap.ASSET_CAP,
        people_together: peopleTogether.ASSET_CAP,
        video_moments: videoMoments.ASSET_CAP,
        trip_anniversary: tripAnniversary.ASSET_CAP,
        themed: themed.ASSET_CAP,
        person_throwback: personThrowback.ASSET_CAP,
      };

      for (const [key, cap] of Object.entries(caps)) {
        expect(getMemoryTypeFloor(key), `${key} floor exceeds its ASSET_CAP`).toBeLessThanOrEqual(cap);
      }
    });

    it('sets on_this_day deliberately above what it can emit — that is the point (spec §2.3)', () => {
      expect(getMemoryTypeFloor('on_this_day')).toBeGreaterThan(SMALLEST_EMITTED_SAMPLE.on_this_day!);
    });

    it('keeps trip floors under what burst collapse can produce', () => {
      // Seven assets in two tight bursts on two days collapse to two representatives.
      const assets = [burst(1, 0), burst(1, 1), burst(1, 2), burst(1, 3), burst(2, 0), burst(2, 1), burst(2, 2)];

      const curated = curateTripAssets(assets, 10);

      expect(curated.length).toBeLessThanOrEqual(SMALLEST_EMITTED_SAMPLE.recent_trip!);
      expect(getMemoryTypeFloor('recent_trip')).toBeLessThanOrEqual(curated.length);
      expect(getMemoryTypeFloor('trip_anniversary')).toBeLessThanOrEqual(curated.length);
    });

    it('returns 0 for an unknown key so it is never removed for size', () => {
      expect(getMemoryTypeFloor('not_a_rule')).toBe(0);
      expect(getMemoryTypeFloor(undefined)).toBe(0);
    });
  });
});
