import { MemoryType } from 'src/enum';
import {
  buildDefaultMemoryTypeMap,
  getAdminAvailableMemoryTypeKeys,
  getMemoryTypeKeyForMemory,
  getMemoryTypeMetadata,
  isMemoryTypeEnabledForUser,
  MEMORY_TYPE_KEYS,
  MEMORY_TYPE_METADATA,
} from 'src/services/memory-rules/memory-type.metadata';

describe('memory-type.metadata', () => {
  describe('MEMORY_TYPE_METADATA', () => {
    it('has unique keys', () => {
      const keys = MEMORY_TYPE_METADATA.map((m) => m.key);
      expect(new Set(keys).size).toBe(keys.length);
    });

    it('contains the current types with expected attributes', () => {
      expect(MEMORY_TYPE_METADATA).toEqual([
        { key: 'on_this_day', kind: 'on_this_day', defaultEnabled: true, adminConfigurable: true },
        { key: 'birthday', kind: 'rule', defaultEnabled: true, adminConfigurable: true },
        { key: 'recent_trip', kind: 'rule', defaultEnabled: true, adminConfigurable: true },
        { key: 'month_recap', kind: 'rule', defaultEnabled: true, adminConfigurable: true },
        { key: 'favorites_throwback', kind: 'rule', defaultEnabled: true, adminConfigurable: true },
        { key: 'on_this_day_place', kind: 'rule', defaultEnabled: true, adminConfigurable: true },
        { key: 'season_recap', kind: 'rule', defaultEnabled: true, adminConfigurable: true },
        { key: 'people_together', kind: 'rule', defaultEnabled: true, adminConfigurable: true },
        { key: 'video_moments', kind: 'rule', defaultEnabled: true, adminConfigurable: true },
        { key: 'trip_anniversary', kind: 'rule', defaultEnabled: true, adminConfigurable: true },
        { key: 'themed', kind: 'rule', defaultEnabled: true, adminConfigurable: true },
        { key: 'person_throwback', kind: 'rule', defaultEnabled: true, adminConfigurable: true },
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
});
