import { describe, expect, it, vi } from 'vitest';
import { ALL_FILTER_SECTIONS, type FilterSection } from '$lib/components/filter-panel/filter-panel';
import { buildAlbumAssetPickerFilterConfig, buildAlbumDetailFilterConfig } from '$lib/utils/album-filter-config';
import { buildMapFilterConfig } from '$lib/utils/map-filter-config';
import { buildRecentlyAddedFilterConfig } from '$lib/utils/recently-added-filter-config';

vi.mock('@immich/sdk', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@immich/sdk')>();
  return {
    ...actual,
    getFilterSuggestions: vi.fn().mockResolvedValue({
      countries: [],
      cameraMakes: [],
      tags: [],
      people: [],
      ratings: [],
      mediaTypes: [],
      hasUnnamedPeople: false,
    }),
    getSearchSuggestions: vi.fn().mockResolvedValue([]),
  };
});

/**
 * Regression guard for #802 — "Filter panel options differ between views".
 *
 * Every surface renders the same filter sections in the same order, derived from the single
 * `ALL_FILTER_SECTIONS` source of truth. A surface may only drop a section when the server
 * physically cannot honour it there; each such exclusion is listed below with its reason, so a
 * new divergence has to be argued for in code review rather than appearing by omission.
 */
const DOCUMENTED_EXCLUSIONS: Record<string, { sections: FilterSection[]; reason: string }> = {
  'album detail': {
    sections: ['albums'],
    // asset.repository.ts guards both isInAlbum and isNotInAlbum with `&& !options.albumId`, so
    // inside a single album they are silently dropped by the server. isInAlbum would be a
    // tautology and isNotInAlbum an always-empty set — rendering them would be a dead control.
    reason: 'server drops isInAlbum/isNotInAlbum when scoped to one album',
  },
};

describe('filter section parity (#802)', () => {
  it('exposes every section on the map view', () => {
    expect(buildMapFilterConfig().sections).toEqual([...ALL_FILTER_SECTIONS]);
  });

  it('exposes every section on the map view when scoped to a space', () => {
    expect(buildMapFilterConfig('space-1').sections).toEqual([...ALL_FILTER_SECTIONS]);
  });

  it('exposes every section on the album asset picker', () => {
    // The picker is NOT album-scoped server-side: `timelineAlbumId` is stripped from the request
    // (timeline-manager/internal/request-options.ts), so isInAlbum/isNotInAlbum work here and are
    // in fact the most useful way to find un-filed photos to add.
    expect(buildAlbumAssetPickerFilterConfig().sections).toEqual([...ALL_FILTER_SECTIONS]);
  });

  it('exposes every section on the Recently Added view', () => {
    // Recently Added (#805) landed after this guard was written; it is own+partner scoped but
    // otherwise unrestricted, so it carries the full list like Photos does.
    expect(buildRecentlyAddedFilterConfig().sections).toEqual([...ALL_FILTER_SECTIONS]);
  });

  it('exposes every section except the documented exclusion on album detail', () => {
    const excluded = new Set(DOCUMENTED_EXCLUSIONS['album detail'].sections);

    expect(buildAlbumDetailFilterConfig('album-1').sections).toEqual(
      ALL_FILTER_SECTIONS.filter((section) => !excluded.has(section)),
    );
  });

  it('includes the text section on every surface that is not documented as excluding it', () => {
    // The concrete #802 report: Map showed 9 sections, Photos showed 10 — "Text" was missing.
    for (const sections of [
      buildMapFilterConfig().sections,
      buildMapFilterConfig('space-1').sections,
      buildAlbumDetailFilterConfig('album-1').sections,
      buildAlbumAssetPickerFilterConfig().sections,
      buildRecentlyAddedFilterConfig().sections,
    ]) {
      expect(sections).toContain('text');
    }
  });

  it('keeps every surface ordered consistently with the canonical list', () => {
    for (const sections of [
      buildMapFilterConfig().sections,
      buildAlbumDetailFilterConfig('album-1').sections,
      buildAlbumAssetPickerFilterConfig().sections,
      buildRecentlyAddedFilterConfig().sections,
    ]) {
      const canonicalPositions = sections.map((section) => ALL_FILTER_SECTIONS.indexOf(section));

      expect(canonicalPositions).toEqual([...canonicalPositions].sort((a, b) => a - b));
      expect(canonicalPositions).not.toContain(-1);
    }
  });

  it('never lets a surface invent a section outside the canonical list', () => {
    const canonical = new Set<string>(ALL_FILTER_SECTIONS);

    for (const sections of [
      buildMapFilterConfig().sections,
      buildAlbumDetailFilterConfig('album-1').sections,
      buildAlbumAssetPickerFilterConfig().sections,
      buildRecentlyAddedFilterConfig().sections,
    ]) {
      for (const section of sections) {
        expect(canonical.has(section)).toBe(true);
      }
    }
  });
});
