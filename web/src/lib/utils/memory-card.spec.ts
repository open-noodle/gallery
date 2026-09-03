import { MemoryType, type MemoryResponseDto } from '@immich/sdk';
import { IntlMessageFormat } from 'intl-messageformat';
import type { MessageFormatter } from 'svelte-i18n';
import en from '$i18n/en.json';
import { getMemorySubtitle, getMemoryTitle } from '$lib/utils/memory-card';

/**
 * Formats the *real* `en.json` message for the key under test, so a renamed key or a
 * placeholder the rule never puts in `context` fails here rather than reaching a user as a
 * raw key or an "undefined".
 */
const translate = ((key: string, payload?: { values?: Record<string, unknown> }) => {
  const message = (en as unknown as Record<string, string>)[key];
  if (message === undefined) {
    throw new Error(`en.json has no key "${key}"`);
  }

  return new IntlMessageFormat(message, 'en').format(payload?.values ?? {}) as string;
}) as unknown as MessageFormatter;

const ruleMemory = (ruleId: string, context: Record<string, unknown>): MemoryResponseDto =>
  ({
    assets: [],
    createdAt: '2026-04-23T00:00:00Z',
    data: { ruleId, context },
    id: 'memory-id',
    isSaved: false,
    memoryAt: '2026-04-23T00:00:00Z',
    ownerId: 'owner-id',
    type: MemoryType.Rule,
    updatedAt: '2026-04-23T00:00:00Z',
  }) as MemoryResponseDto;

const now = new Date('2026-04-23T00:00:00Z');
const titleOf = (ruleId: string, context: Record<string, unknown>) =>
  getMemoryTitle(ruleMemory(ruleId, context), translate, now, 'en');
const subtitleOf = (ruleId: string, context: Record<string, unknown>) =>
  getMemorySubtitle(ruleMemory(ruleId, context), translate, 'en');

describe('memory card text', () => {
  describe(getMemoryTitle.name, () => {
    it('prefers a title the server baked in, so memories generated before this change still read', () => {
      const memory = { ...ruleMemory('month_recap', { year: 2025, month: 9 }), title: 'September 2025' };
      expect(getMemoryTitle(memory, translate, now, 'en')).toBe('September 2025');
    });

    it('localizes an on-this-day memory from its year', () => {
      const memory = {
        ...ruleMemory('', {}),
        type: MemoryType.OnThisDay,
        data: { year: 2024 },
      } as MemoryResponseDto;
      expect(getMemoryTitle(memory, translate, now, 'en')).toBe('2 years ago');
    });

    it('builds a month recap title as a locale-formatted month and year', () => {
      expect(titleOf('month_recap', { year: 2025, month: 9, count: 12 })).toBe('September 2025');
    });

    it('builds a season recap title from the season key, not a baked English label', () => {
      expect(titleOf('season_recap', { seasonYear: 2025, season: 'autumn', count: 20 })).toBe('Autumn 2025');
    });

    it('builds a trip anniversary title from the place label', () => {
      expect(titleOf('trip_anniversary', { placeLabel: 'Munich, Germany', yearsAgo: 2 })).toBe(
        'Your trip to Munich, Germany',
      );
    });

    it('builds a recent trip title from the place label', () => {
      expect(titleOf('recent_trip', { placeLabel: 'Paris, France' })).toBe('Recent trip to Paris, France');
    });

    it('builds a birthday title from the person name', () => {
      expect(titleOf('birthday', { personName: 'Alice', variant: 'across_years' })).toBe('Happy birthday, Alice');
    });

    it('builds a favorites throwback title from the month and year', () => {
      expect(titleOf('favorites_throwback', { year: 2023, month: 7, count: 6 })).toBe(
        'Favorite moments from July 2023',
      );
    });

    it('builds an on-this-day-in-a-place title from the city', () => {
      expect(titleOf('on_this_day_place', { city: 'Lisbon', count: 11, years: [2021, 2023] })).toBe(
        'On this day in Lisbon',
      );
    });

    it('builds a people-together title from both names', () => {
      expect(titleOf('people_together', { personAName: 'Anna', personBName: 'Ben', count: 6 })).toBe('Anna & Ben');
    });

    it('builds a video moments title from the month and year', () => {
      expect(titleOf('video_moments', { year: 2023, month: 7, count: 9 })).toBe('Video moments from July 2023');
    });

    it('builds a themed title from the theme key, not a baked English label', () => {
      expect(titleOf('themed', { year: 2023, theme: 'sunset', count: 18 })).toBe('Sunsets from 2023');
    });

    it('builds a person throwback title from the person name', () => {
      expect(titleOf('person_throwback', { personName: 'Anna', count: 23, month: 8, year: 2023 })).toBe(
        'Times with Anna',
      );
    });

    it('falls back to unknown for a rule it has no title for', () => {
      expect(titleOf('some_future_rule', {})).toBe('Unknown');
    });
  });

  describe(getMemorySubtitle.name, () => {
    it('prefers a subtitle the server baked in', () => {
      const memory = { ...ruleMemory('month_recap', { count: 12 }), subtitle: '12 photos' };
      expect(getMemorySubtitle(memory, translate, 'en')).toBe('12 photos');
    });

    it('counts the photos in a month recap', () => {
      expect(subtitleOf('month_recap', { year: 2025, month: 9, count: 12 })).toBe('12 photos');
    });

    it('counts a single photo in the singular', () => {
      expect(subtitleOf('month_recap', { year: 2025, month: 9, count: 1 })).toBe('1 photo');
    });

    it('counts the photos in a season recap', () => {
      expect(subtitleOf('season_recap', { seasonYear: 2025, season: 'autumn', count: 20 })).toBe('20 photos');
    });

    it('counts favorites, not photos, in a favorites throwback', () => {
      expect(subtitleOf('favorites_throwback', { year: 2023, month: 7, count: 6 })).toBe('6 favorites');
    });

    it('counts videos, not photos, in a video moments memory', () => {
      expect(subtitleOf('video_moments', { year: 2023, month: 7, count: 9 })).toBe('9 videos');
    });

    it('names both years of a two-year on-this-day-in-a-place memory', () => {
      expect(subtitleOf('on_this_day_place', { city: 'Lisbon', count: 11, years: [2021, 2023] })).toBe(
        '11 photos from 2021 and 2023',
      );
    });

    it('names all three years of a three-year on-this-day-in-a-place memory', () => {
      expect(subtitleOf('on_this_day_place', { city: 'Lisbon', count: 12, years: [2019, 2021, 2023] })).toBe(
        '12 photos from 2019, 2021 and 2023',
      );
    });

    it('counts the years instead of naming them beyond three', () => {
      expect(subtitleOf('on_this_day_place', { city: 'Lisbon', count: 16, years: [2020, 2021, 2022, 2023] })).toBe(
        '16 photos across 4 years',
      );
    });

    it('just counts the photos when only one year is listed', () => {
      expect(subtitleOf('on_this_day_place', { city: 'Lisbon', count: 4, years: [2023] })).toBe('4 photos');
    });

    it('reads the across-years birthday variant', () => {
      expect(subtitleOf('birthday', { personName: 'Alice', variant: 'across_years' })).toBe(
        'Photos from different years',
      );
    });

    it('reads the recent-photos birthday variant, which names the person', () => {
      expect(subtitleOf('birthday', { personName: 'Pierre', variant: 'recent' })).toBe('Recent photos of Pierre');
    });

    it('counts the photos and dates a people-together memory', () => {
      expect(subtitleOf('people_together', { year: 2023, month: 6, count: 6 })).toBe('6 photos together · June 2023');
    });

    it('counts the photos and dates a person throwback', () => {
      expect(subtitleOf('person_throwback', { personName: 'Anna', count: 23, month: 8, year: 2023 })).toBe(
        '23 photos · August 2023',
      );
    });

    it('pluralizes every part of a trip anniversary subtitle', () => {
      expect(subtitleOf('trip_anniversary', { yearsAgo: 3, assetCount: 8, dayCount: 3 })).toBe(
        '3 years ago · 8 photos over 3 days',
      );
      expect(subtitleOf('trip_anniversary', { yearsAgo: 1, assetCount: 1, dayCount: 1 })).toBe(
        '1 year ago · 1 photo over 1 day',
      );
    });

    it('counts the photos and days in a recent trip', () => {
      expect(subtitleOf('recent_trip', { placeLabel: 'Paris, France', assetCount: 9, dayCount: 3 })).toBe(
        '9 photos over 3 days',
      );
    });

    it('counts the photos in a themed memory', () => {
      expect(subtitleOf('themed', { year: 2023, theme: 'sunset', count: 18 })).toBe('18 photos');
    });

    it('falls back to an empty string for a rule it has no subtitle for', () => {
      expect(subtitleOf('some_future_rule', {})).toBe('');
    });
  });

  describe('localization', () => {
    it('formats the month recap month name in the requested locale', () => {
      const memory = ruleMemory('month_recap', { year: 2025, month: 9, count: 12 });
      expect(getMemoryTitle(memory, translate, now, 'de')).toBe('September 2025');
      expect(getMemoryTitle(memory, translate, now, 'fr')).toBe('septembre 2025');
    });
  });
});
