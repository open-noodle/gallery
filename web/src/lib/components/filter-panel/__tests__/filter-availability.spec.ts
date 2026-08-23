import { describe, expect, it } from 'vitest';
import { getSectionAvailability, type AvailabilityInput } from '../filter-availability';
import type { FilterSection, FilterSuggestionsResponse } from '../filter-panel';

/** A scope in which every section is usable. Individual tests knock out one dimension at a time. */
const full = (): FilterSuggestionsResponse => ({
  countries: ['Germany'],
  cameraMakes: ['Canon'],
  tags: [{ id: 'tag-1', name: 'Vacation' }],
  people: [{ id: 'person-1', name: 'Alice' }],
  ratings: [5],
  mediaTypes: ['IMAGE', 'VIDEO'],
  hasUnnamedPeople: false,
  hasFavorites: true,
  hasAssetsInAlbum: true,
  hasAssetsNotInAlbum: true,
});

/** A scope in which no section can filter anything. */
const barren = (): FilterSuggestionsResponse => ({
  countries: [],
  cameraMakes: [],
  tags: [],
  people: [],
  ratings: [],
  mediaTypes: ['IMAGE'],
  hasUnnamedPeople: false,
  hasFavorites: false,
  hasAssetsInAlbum: false,
  hasAssetsNotInAlbum: true,
});

const input = (overrides: Partial<AvailabilityInput> = {}): AvailabilityInput => ({
  current: full(),
  baseline: full(),
  hasActiveFilter: false,
  timeBucketCount: 3,
  ...overrides,
});

const GATED: FilterSection[] = ['people', 'location', 'camera', 'tags', 'rating', 'media', 'favorites', 'albums'];

describe('getSectionAvailability', () => {
  describe('the three verdicts', () => {
    it.each(GATED)('reports %s available when its facet is populated', (section) => {
      expect(getSectionAvailability(section, input())).toBe('available');
    });

    it.each(GATED)('reports %s empty when only the current facet is bare', (section) => {
      expect(getSectionAvailability(section, input({ current: barren() }))).toBe('empty');
    });

    it.each(GATED)('reports %s unavailable when both facets are bare', (section) => {
      expect(getSectionAvailability(section, input({ current: barren(), baseline: barren() }))).toBe('unavailable');
    });
  });

  describe('per-section emptiness rules', () => {
    it('treats a single media type as unusable', () => {
      const single = { ...full(), mediaTypes: ['IMAGE'] };
      expect(getSectionAvailability('media', input({ current: single, baseline: single }))).toBe('unavailable');
    });

    it('treats photos plus videos as usable', () => {
      expect(getSectionAvailability('media', input())).toBe('available');
    });

    // `getFilteredMediaTypes` returns raw `distinct asset.type`, and AssetType is
    // IMAGE | VIDEO | AUDIO | OTHER. A length>=2 rule would call this section usable while the
    // Videos button is still dead — the exact thing #910 exists to stop.
    it.each([['OTHER'], ['AUDIO']])('does not count %s towards a usable media section', (other) => {
      const noVideo = { ...full(), mediaTypes: ['IMAGE', other] };
      expect(getSectionAvailability('media', input({ current: noVideo, baseline: noVideo }))).toBe('unavailable');
    });

    it('keeps media usable when an extra type accompanies both photos and videos', () => {
      const extra = { ...full(), mediaTypes: ['IMAGE', 'OTHER', 'VIDEO'] };
      expect(getSectionAvailability('media', input({ current: extra, baseline: extra }))).toBe('available');
    });

    it('treats videos-only as unusable, mirroring photos-only', () => {
      const single = { ...full(), mediaTypes: ['VIDEO'] };
      expect(getSectionAvailability('media', input({ current: single, baseline: single }))).toBe('unavailable');
    });

    it('keeps people available when unnamed faces exist', () => {
      const unnamed = { ...barren(), hasUnnamedPeople: true };
      expect(getSectionAvailability('people', input({ current: unnamed, baseline: unnamed }))).toBe('available');
    });

    it('hides people when there are none at all', () => {
      expect(getSectionAvailability('people', input({ current: barren(), baseline: barren() }))).toBe('unavailable');
    });

    it('hides albums when nothing is filed', () => {
      const none = { ...full(), hasAssetsInAlbum: false };
      expect(getSectionAvailability('albums', input({ current: none, baseline: none }))).toBe('unavailable');
    });

    it('hides albums when everything is filed', () => {
      const all = { ...full(), hasAssetsNotInAlbum: false };
      expect(getSectionAvailability('albums', input({ current: all, baseline: all }))).toBe('unavailable');
    });

    it('keeps albums available only when both sides exist', () => {
      expect(getSectionAvailability('albums', input())).toBe('available');
    });

    it('hides favorites when nothing is favourited', () => {
      const none = { ...full(), hasFavorites: false };
      expect(getSectionAvailability('favorites', input({ current: none, baseline: none }))).toBe('unavailable');
    });
  });

  describe('overriding rules', () => {
    it.each(GATED)('never hides or greys %s while it has an active filter', (section) => {
      const state = input({ current: barren(), baseline: barren(), hasActiveFilter: true });
      expect(getSectionAvailability(section, state)).toBe('available');
    });

    it.each(GATED)('never hides %s while the baseline is unknown', (section) => {
      expect(getSectionAvailability(section, input({ current: barren(), baseline: undefined }))).toBe('empty');
    });

    // Slice 3 review gap: every existing baseline-undefined case above pairs it with a BARREN
    // current, so the current-emptiness check and the baseline-undefined check are never both live at
    // once — swapping their order would leave every test above green. A populated current with an
    // unknown baseline is the case that actually exercises the order: it must resolve on the
    // current-emptiness check alone and never even look at `baseline`.
    it.each(GATED)(
      'reports %s available when the current facet is populated but the baseline is unknown',
      (section) => {
        expect(getSectionAvailability(section, input({ baseline: undefined }))).toBe('available');
      },
    );
  });

  describe('exempt sections', () => {
    it('greys timeline on an empty bucket list but never hides it', () => {
      const state = input({ current: barren(), baseline: barren(), timeBucketCount: 0 });
      expect(getSectionAvailability('timeline', state)).toBe('empty');
    });

    it('keeps timeline available while it has buckets', () => {
      expect(getSectionAvailability('timeline', input())).toBe('available');
    });

    it('keeps timeline available while a date filter is active', () => {
      const state = input({ timeBucketCount: 0, hasActiveFilter: true });
      expect(getSectionAvailability('timeline', state)).toBe('available');
    });

    it('always reports text available', () => {
      const state = input({ current: barren(), baseline: barren(), timeBucketCount: 0 });
      expect(getSectionAvailability('text', state)).toBe('available');
    });

    // The `default:` branch of isSectionEmpty. A section added to FilterSection in future must
    // default to visible, not silently vanish because nobody wrote it a rule.
    it('reports an unrecognised section available rather than hiding it', () => {
      const state = input({ current: barren(), baseline: barren() });
      expect(getSectionAvailability('newcomer' as FilterSection, state)).toBe('available');
    });
  });
});
