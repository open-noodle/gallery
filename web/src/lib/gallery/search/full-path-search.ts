import { createFilterState, type FilterState } from '#lib/components/filter-panel/filter-panel.ts';
import { libraryViewOptions } from '#lib/gallery/library-view/library-view.svelte.ts';
import { parseScope, type ParsedQuery } from '#lib/managers/cmdk-prefix.ts';
import { Route } from '#lib/route.ts';
import { filterStateToSearchTerms } from '#lib/utils/filter-search-terms.ts';
import { getSearchablePageBasePath } from '#lib/utils/searchable-page-search.ts';
import { parseTypedSearch, type TypedSearchParseResult } from '#lib/utils/typed-search/typed-search-parser.ts';
import { AssetVisibility, type MetadataSearchDto } from '@immich/sdk';
import { mdiFolderSearchOutline } from '@mdi/js';

export const SEARCH_MODES = ['smart', 'metadata', 'description', 'ocr', 'fullPath'] as const;
export type PaletteSearchMode = (typeof SEARCH_MODES)[number];

export const nextSearchMode = (mode: PaletteSearchMode): PaletteSearchMode =>
  SEARCH_MODES[(SEARCH_MODES.indexOf(mode) + 1) % SEARCH_MODES.length];

export const fullPathSearchOption = {
  value: 'fullPath',
  labelKey: 'full_path_or_folder',
  icon: mdiFolderSearchOutline,
} as const;

/** A leading slash, @, # or a drive-letter colon is part of a path, not palette grammar. */
export const parsePaletteScope = (text: string, mode: PaletteSearchMode): ParsedQuery =>
  mode === 'fullPath' ? { scope: 'all', payload: text.trim() } : parseScope(text);

export const parsePaletteDraft = (text: string, mode: PaletteSearchMode): TypedSearchParseResult =>
  mode === 'fullPath'
    ? {
        raw: text,
        queryText: text.trim(),
        scalarTokens: [],
        resolutionTokens: [],
        displayTokens: [],
        issues: [],
        tokens: [],
      }
    : parseTypedSearch(text, { mode: 'draft' });

/** Reuse the existing metadata endpoint and full-result page; timeline buckets have no path filter. */
export const buildFullPathSearchTerms = (
  text: string,
  url: URL,
  filters: FilterState = createFilterState(),
): MetadataSearchDto => {
  const terms: MetadataSearchDto = {
    ...filterStateToSearchTerms(filters),
    originalPath: text.trim(),
    visibility: AssetVisibility.Timeline,
    withSharedSpaces: true,
  };
  const parts = getSearchablePageBasePath(url.pathname)?.split('/').filter(Boolean) ?? [];
  if (parts[0] === 'photos') {
    Object.assign(terms, libraryViewOptions());
  } else if (parts[0] === 'recently-added') {
    terms.withSharedSpaces = false;
  }
  // Space albums are album-scoped, exactly like createAlbumTimeline.collectTerms.
  const albumId =
    parts[0] === 'albums' ? parts[1] : parts[0] === 'spaces' && parts[2] === 'albums' ? parts[3] : undefined;
  if (albumId) {
    terms.albumIds = [albumId];
    terms.withSharedSpaces = false;
  } else if (parts[0] === 'spaces' && parts[1]) {
    terms.spaceId = parts[1];
    terms.withSharedSpaces = false;
    // Space timelines carry bare space-person ids, unlike album and personal timelines.
    if (terms.personIds) {
      terms.spacePersonIds = terms.personIds;
      delete terms.personIds;
    }
  }
  return terms;
};

/**
The one deliberate palette landing on the existing metadata results screen. That page already searches Timeline
visibility by default, so the URL leaves it out: written there, it would surface as a misleading "In archive" chip.
*/
export const buildFullPathSearchUrl = (text: string, url: URL, filters?: FilterState): string => {
  const terms = buildFullPathSearchTerms(text, url, filters);
  if (terms.visibility === AssetVisibility.Timeline) {
    delete terms.visibility;
  }
  return Route.search(terms);
};
