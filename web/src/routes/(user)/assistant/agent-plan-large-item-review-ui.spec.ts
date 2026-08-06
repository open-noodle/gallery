import { describe, expect, it } from 'vitest';
import type { OperationItemSelectionState } from './agent-operation-plan-ui';
import {
  applyAgentPlanBulkItemSelection,
  buildAgentPlanItemVirtualWindow,
  buildAgentPlanReviewAssets,
  filterAgentPlanReviewAssets,
  getAgentPlanAvailableFilterFacets,
  getAgentPlanSparseSelectedCount,
  setAgentPlanOnlyItemSelection,
  type AgentPlanItemFilterState,
  type AgentPlanReviewAssetMetadata,
} from './agent-plan-large-item-review-ui';

const assetIds = (count: number) =>
  Array.from({ length: count }, (_, index) => `asset-${index.toString().padStart(4, '0')}`);

const emptyFilter = (overrides: Partial<AgentPlanItemFilterState> = {}): AgentPlanItemFilterState => ({
  query: '',
  kind: 'all',
  ...overrides,
});

describe('agent plan large item review UI helpers', () => {
  it('builds a virtual window for 1,000 assets at the top', () => {
    const window = buildAgentPlanItemVirtualWindow({
      assetIds: assetIds(1000),
      scrollTop: 0,
      viewportHeight: 360,
      itemSize: 96,
      columnCount: 6,
      overscanRows: 1,
    });

    expect(window.totalAssetCount).toBe(1000);
    expect(window.totalRows).toBe(167);
    expect(window.startIndex).toBe(0);
    expect(window.endIndex).toBe(30);
    expect(window.visibleAssetIds).toHaveLength(30);
    expect(window.beforeHeight).toBe(0);
    expect(window.afterHeight).toBe((167 - 5) * 96);
  });

  it('builds a virtual window after scrolling', () => {
    const window = buildAgentPlanItemVirtualWindow({
      assetIds: assetIds(1000),
      scrollTop: 960,
      viewportHeight: 360,
      itemSize: 96,
      columnCount: 6,
      overscanRows: 1,
    });

    expect(window.startIndex).toBe(54);
    expect(window.endIndex).toBe(90);
    expect(window.visibleAssetIds[0]).toBe('asset-0054');
    expect(window.beforeHeight).toBe(9 * 96);
  });

  it('keeps virtual window output bounded and deterministic for 10,000 assets', () => {
    const ids = assetIds(10_000);
    const input = {
      assetIds: ids,
      scrollTop: 48_000,
      viewportHeight: 360,
      itemSize: 96,
      columnCount: 6,
      overscanRows: 1,
    };
    const firstWindow = buildAgentPlanItemVirtualWindow(input);
    const secondWindow = buildAgentPlanItemVirtualWindow(input);

    expect(firstWindow).toEqual(secondWindow);
    expect(firstWindow.totalAssetCount).toBe(10_000);
    expect(firstWindow.totalRows).toBe(1667);
    expect(firstWindow.visibleAssetIds).toHaveLength(36);
    expect(firstWindow.startIndex).toBe(2994);
    expect(firstWindow.endIndex).toBe(3030);
    expect(firstWindow.visibleAssetIds[0]).toBe('asset-2994');
    expect(firstWindow.visibleAssetIds.at(-1)).toBe('asset-3029');
    expect(firstWindow.beforeHeight).toBe(499 * 96);
    expect(firstWindow.afterHeight).toBe((1667 - 505) * 96);
    expect(firstWindow.visibleAssetIds.length).toBeLessThan(50);
  });

  it('clamps negative and oversized scroll for short lists', () => {
    const ids = assetIds(10);
    const baseInput = {
      assetIds: ids,
      viewportHeight: 360,
      itemSize: 96,
      columnCount: 6,
      overscanRows: 1,
    };

    expect(buildAgentPlanItemVirtualWindow({ ...baseInput, scrollTop: -96 })).toMatchObject({
      startIndex: 0,
      endIndex: 10,
      visibleAssetIds: ids,
      beforeHeight: 0,
      afterHeight: 0,
    });
    expect(buildAgentPlanItemVirtualWindow({ ...baseInput, scrollTop: 100_000 })).toMatchObject({
      startIndex: 0,
      endIndex: 10,
      visibleAssetIds: ids,
      beforeHeight: 0,
      afterHeight: 0,
    });
  });

  it('builds review assets without letting metadata overwrite source ids', () => {
    expect(
      buildAgentPlanReviewAssets(['asset-1', 'asset-2'], {
        'asset-1': { id: 'metadata-id', label: 'Cover image' },
      }),
    ).toEqual([{ id: 'asset-1', label: 'Cover image' }, { id: 'asset-2' }]);
  });

  it('matches query across all searchable text fields', () => {
    const assets = buildAgentPlanReviewAssets(
      ['asset-id', 'asset-label', 'asset-file', 'asset-album', 'asset-person', 'asset-tag', 'asset-place'],
      {
        'asset-label': { id: 'asset-label', label: 'Birthday Cake' },
        'asset-file': { id: 'asset-file', filename: 'IMG_1234.JPG' },
        'asset-album': { id: 'asset-album', sourceAlbumName: 'Family Archive' },
        'asset-person': { id: 'asset-person', personNames: ['Ada Lovelace'] },
        'asset-tag': { id: 'asset-tag', tagNames: ['Receipts'] },
        'asset-place': { id: 'asset-place', locationLabel: 'Berlin Mitte' },
      },
    );

    expect(filterAgentPlanReviewAssets(assets, emptyFilter({ query: 'ASSET-ID' })).map(({ id }) => id)).toEqual([
      'asset-id',
    ]);
    expect(filterAgentPlanReviewAssets(assets, emptyFilter({ query: 'cake' })).map(({ id }) => id)).toEqual([
      'asset-label',
    ]);
    expect(filterAgentPlanReviewAssets(assets, emptyFilter({ query: '1234' })).map(({ id }) => id)).toEqual([
      'asset-file',
    ]);
    expect(filterAgentPlanReviewAssets(assets, emptyFilter({ query: 'archive' })).map(({ id }) => id)).toEqual([
      'asset-album',
    ]);
    expect(filterAgentPlanReviewAssets(assets, emptyFilter({ query: 'ada' })).map(({ id }) => id)).toEqual([
      'asset-person',
    ]);
    expect(filterAgentPlanReviewAssets(assets, emptyFilter({ query: 'receipt' })).map(({ id }) => id)).toEqual([
      'asset-tag',
    ]);
    expect(filterAgentPlanReviewAssets(assets, emptyFilter({ query: 'mitte' })).map(({ id }) => id)).toEqual([
      'asset-place',
    ]);
  });

  it('filters by kind while keeping unknown assets only in all', () => {
    const assets = buildAgentPlanReviewAssets(['image-1', 'video-1', 'unknown-1'], {
      'image-1': { id: 'image-1', kind: 'image' },
      'video-1': { id: 'video-1', kind: 'video' },
      'unknown-1': { id: 'unknown-1', kind: 'unknown' },
    });

    expect(filterAgentPlanReviewAssets(assets, emptyFilter({ kind: 'all' })).map(({ id }) => id)).toEqual([
      'image-1',
      'video-1',
      'unknown-1',
    ]);
    expect(filterAgentPlanReviewAssets(assets, emptyFilter({ kind: 'image' })).map(({ id }) => id)).toEqual([
      'image-1',
    ]);
    expect(filterAgentPlanReviewAssets(assets, emptyFilter({ kind: 'video' })).map(({ id }) => id)).toEqual([
      'video-1',
    ]);
  });

  it('applies inclusive date, album, people, tag, and location filters', () => {
    const assets = buildAgentPlanReviewAssets(['before', 'match-start', 'match-end', 'after', 'wrong-album'], {
      before: richMetadata({ id: 'before', createdAt: '2026-04-30T23:59:59.000Z' }),
      'match-start': richMetadata({ id: 'match-start', createdAt: '2026-05-01T00:00:00.000Z' }),
      'match-end': richMetadata({ id: 'match-end', createdAt: '2026-05-31T23:59:59.000Z' }),
      after: richMetadata({ id: 'after', createdAt: '2026-06-01T00:00:00.000Z' }),
      'wrong-album': richMetadata({ id: 'wrong-album', sourceAlbumName: 'Inbox' }),
    });

    expect(
      filterAgentPlanReviewAssets(
        assets,
        emptyFilter({
          dateFrom: '2026-05-01',
          dateTo: '2026-05-31',
          sourceAlbumName: 'Camera Roll',
          personName: 'Ada Lovelace',
          tagName: 'Receipt',
          locationLabel: 'Berlin',
        }),
      ).map(({ id }) => id),
    ).toEqual(['match-start', 'match-end']);
  });

  it('applies screenshot and duplicate quick filters', () => {
    const assets = buildAgentPlanReviewAssets(['screenshot', 'duplicate-a', 'duplicate-b', 'single'], {
      screenshot: { id: 'screenshot', isScreenshot: true },
      'duplicate-a': { id: 'duplicate-a', duplicateKey: 'dup-1' },
      'duplicate-b': { id: 'duplicate-b', duplicateKey: 'dup-1' },
      single: { id: 'single', duplicateKey: 'single-1' },
    });

    expect(
      filterAgentPlanReviewAssets(assets, emptyFilter({ quickFilter: 'screenshots' })).map(({ id }) => id),
    ).toEqual(['screenshot']);
    expect(filterAgentPlanReviewAssets(assets, emptyFilter({ quickFilter: 'duplicates' })).map(({ id }) => id)).toEqual(
      ['duplicate-a', 'duplicate-b'],
    );
  });

  it('returns available facet booleans for rich metadata', () => {
    const assets = buildAgentPlanReviewAssets(['image-1', 'video-1', 'duplicate-a', 'duplicate-b'], {
      'image-1': richMetadata({ id: 'image-1', kind: 'image', isScreenshot: true, duplicateKey: 'single' }),
      'video-1': richMetadata({ id: 'video-1', kind: 'video' }),
      'duplicate-a': richMetadata({ id: 'duplicate-a', duplicateKey: 'dup-1' }),
      'duplicate-b': richMetadata({ id: 'duplicate-b', duplicateKey: 'dup-1' }),
    });

    expect(getAgentPlanAvailableFilterFacets(assets)).toEqual({
      hasKind: true,
      hasDates: true,
      hasSourceAlbums: true,
      hasPeople: true,
      hasTags: true,
      hasLocations: true,
      hasScreenshots: true,
      hasDuplicates: true,
    });
  });

  it('returns unavailable facet booleans for ID-only assets', () => {
    expect(getAgentPlanAvailableFilterFacets(buildAgentPlanReviewAssets(['asset-1', 'asset-2']))).toEqual({
      hasKind: false,
      hasDates: false,
      hasSourceAlbums: false,
      hasPeople: false,
      hasTags: false,
      hasLocations: false,
      hasScreenshots: false,
      hasDuplicates: false,
    });
  });

  it('excludes visible assets from implicit all selection', () => {
    const allAssetIds = assetIds(10);
    const state = applyAgentPlanBulkItemSelection({
      state: {},
      operationId: 'operation-1',
      allAssetIds,
      targetAssetIds: ['asset-0001', 'asset-0002'],
      selected: false,
    });

    expect(state['operation-1']).toEqual({
      itemKind: 'asset',
      mode: 'allExcept',
      itemIds: ['asset-0001', 'asset-0002'],
    });
    expect(getAgentPlanSparseSelectedCount(allAssetIds.length, state['operation-1'])).toBe(8);
  });

  it('keeps 10,000 asset exclusions sparse when a user revises a large plan', () => {
    const ids = assetIds(10_000);
    const excludedIds = ['asset-0001', 'asset-0999', 'asset-4999', 'asset-7000', 'asset-9999'];
    const state = applyAgentPlanBulkItemSelection({
      state: {},
      operationId: 'operation-1',
      allAssetIds: ids,
      targetAssetIds: excludedIds,
      selected: false,
    });

    expect(state['operation-1']).toEqual({
      itemKind: 'asset',
      mode: 'allExcept',
      itemIds: excludedIds,
    });
    expect(getAgentPlanSparseSelectedCount(ids.length, state['operation-1'])).toBe(9995);
  });

  it('includes exclusions back into allExcept selection', () => {
    const allAssetIds = assetIds(10);
    const initialState: OperationItemSelectionState = {
      'operation-1': { itemKind: 'asset', mode: 'allExcept', itemIds: ['asset-0001', 'asset-0002'] },
    };
    const state = applyAgentPlanBulkItemSelection({
      state: initialState,
      operationId: 'operation-1',
      allAssetIds,
      targetAssetIds: ['asset-0001', 'asset-0002'],
      selected: true,
    });

    expect(state['operation-1']).toBeUndefined();
    expect(getAgentPlanSparseSelectedCount(allAssetIds.length, state['operation-1'])).toBe(10);
  });

  it('selects a subset from none selection', () => {
    const allAssetIds = assetIds(10);
    const state = applyAgentPlanBulkItemSelection({
      state: { 'operation-1': { itemKind: 'asset', mode: 'none' } },
      operationId: 'operation-1',
      allAssetIds,
      targetAssetIds: ['asset-0004', 'asset-0005'],
      selected: true,
    });

    expect(state['operation-1']).toEqual({
      itemKind: 'asset',
      mode: 'only',
      itemIds: ['asset-0004', 'asset-0005'],
    });
    expect(getAgentPlanSparseSelectedCount(allAssetIds.length, state['operation-1'])).toBe(2);
  });

  it('deselects every asset', () => {
    const allAssetIds = assetIds(10);
    const state = applyAgentPlanBulkItemSelection({
      state: {},
      operationId: 'operation-1',
      allAssetIds,
      targetAssetIds: allAssetIds,
      selected: false,
    });

    expect(state['operation-1']).toEqual({ itemKind: 'asset', mode: 'none' });
    expect(getAgentPlanSparseSelectedCount(allAssetIds.length, state['operation-1'])).toBe(0);
  });

  it('ignores unknown target ids and deduplicates incoming target ids', () => {
    const state = applyAgentPlanBulkItemSelection({
      state: {},
      operationId: 'operation-1',
      allAssetIds: assetIds(10),
      targetAssetIds: ['asset-0001', 'asset-0001', 'asset-9999'],
      selected: false,
    });

    expect(state['operation-1']).toEqual({
      itemKind: 'asset',
      mode: 'allExcept',
      itemIds: ['asset-0001'],
    });
  });

  it('deduplicates operation asset ids before building sparse state', () => {
    const state = applyAgentPlanBulkItemSelection({
      state: {},
      operationId: 'operation-1',
      allAssetIds: ['asset-0001', 'asset-0001', 'asset-0002'],
      targetAssetIds: ['asset-0001'],
      selected: false,
    });

    expect(state['operation-1']).toEqual({
      itemKind: 'asset',
      mode: 'only',
      itemIds: ['asset-0002'],
    });
  });

  it('replaces current selection with only filtered target ids', () => {
    const state = setAgentPlanOnlyItemSelection({
      state: {},
      operationId: 'operation-1',
      allAssetIds: assetIds(10),
      targetAssetIds: ['asset-0004', 'asset-0005'],
    });

    expect(state['operation-1']).toEqual({
      itemKind: 'asset',
      mode: 'only',
      itemIds: ['asset-0004', 'asset-0005'],
    });
  });

  it('clears sparse state when only replacement target is every known asset', () => {
    const allAssetIds = assetIds(10);
    const state = setAgentPlanOnlyItemSelection({
      state: { 'operation-1': { itemKind: 'asset', mode: 'only', itemIds: ['asset-0004'] } },
      operationId: 'operation-1',
      allAssetIds,
      targetAssetIds: allAssetIds,
    });

    expect(state['operation-1']).toBeUndefined();
  });

  it('stores none when only replacement target has no known assets', () => {
    const state = setAgentPlanOnlyItemSelection({
      state: {},
      operationId: 'operation-1',
      allAssetIds: assetIds(10),
      targetAssetIds: ['asset-9999'],
    });

    expect(state['operation-1']).toEqual({ itemKind: 'asset', mode: 'none' });
  });

  it('keeps allExcept compact when excluding a small subset from implicit all', () => {
    const allAssetIds = assetIds(100);
    const state = applyAgentPlanBulkItemSelection({
      state: {},
      operationId: 'operation-1',
      allAssetIds,
      targetAssetIds: ['asset-0001', 'asset-0002', 'asset-0003'],
      selected: false,
    });

    expect(state['operation-1']).toEqual({
      itemKind: 'asset',
      mode: 'allExcept',
      itemIds: ['asset-0001', 'asset-0002', 'asset-0003'],
    });
  });
});

const richMetadata = (overrides: Partial<AgentPlanReviewAssetMetadata>): AgentPlanReviewAssetMetadata => ({
  id: 'asset-1',
  kind: 'image',
  createdAt: '2026-05-15T12:00:00.000Z',
  sourceAlbumName: 'Camera Roll',
  personNames: ['Ada Lovelace'],
  tagNames: ['Receipt'],
  locationLabel: 'Berlin',
  ...overrides,
});
