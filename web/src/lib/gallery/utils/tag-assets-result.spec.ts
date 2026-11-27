import { notifyTagAssets } from '#lib/gallery/utils/tag-assets-result.ts';
import { toastManager } from '@immich/ui';
import type { MessageFormatter } from 'svelte-i18n';

const $t = ((key: string, options?: { values?: Record<string, unknown> }) =>
  `${key}${options?.values ? ` ${JSON.stringify(options.values)}` : ''}`) as MessageFormatter;

describe('notifyTagAssets', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(toastManager, 'primary').mockReturnValue(undefined as never);
    vi.spyOn(toastManager, 'info').mockReturnValue(undefined as never);
    vi.spyOn(toastManager, 'warning').mockReturnValue(undefined as never);
  });

  const onlyCalled = (method: 'primary' | 'info' | 'warning', message: string) => {
    expect(toastManager[method]).toHaveBeenCalledExactlyOnceWith(message);
    for (const other of ['primary', 'info', 'warning'] as const) {
      if (other !== method) {
        expect(toastManager[other]).not.toHaveBeenCalled();
      }
    }
  };

  it('keeps the upstream toast when the server does not report the new fields', () => {
    notifyTagAssets($t, ['a', 'b'], { count: 3 });

    onlyCalled('primary', 'tagged_assets {"count":3}');
  });

  it('reports success when nothing was skipped', () => {
    notifyTagAssets($t, ['a', 'b'], { count: 1, taggedAssetIds: ['a', 'b'], skippedAssetIds: [], skippedTagIds: [] });

    onlyCalled('primary', 'tagged_assets {"count":2}');
  });

  it('reports assets that were not tagged as info when others were tagged', () => {
    notifyTagAssets($t, ['a', 'b', 'c'], {
      count: 1,
      taggedAssetIds: ['a'],
      skippedAssetIds: ['b', 'c'],
      skippedTagIds: [],
    });

    onlyCalled('info', 'tagged_assets_with_skipped {"tagged":1,"skipped":2}');
  });

  it('reports tags that could not be added as info when every asset was tagged', () => {
    notifyTagAssets($t, ['a', 'b'], {
      count: 4,
      taggedAssetIds: ['a', 'b'],
      skippedAssetIds: [],
      skippedTagIds: ['foreign-tag'],
    });

    onlyCalled('info', 'tagged_assets_with_skipped_tags {"tagged":2,"tags":1}');
  });

  it('reports skipped assets and tags together as info when something was tagged', () => {
    notifyTagAssets($t, ['a', 'b'], {
      count: 1,
      taggedAssetIds: ['a'],
      skippedAssetIds: ['b'],
      skippedTagIds: ['foreign-tag'],
    });

    onlyCalled('info', 'tagged_assets_with_skipped_assets_and_tags {"tagged":1,"skipped":1,"tags":1}');
  });

  it('warns when assets were skipped and nothing was tagged', () => {
    notifyTagAssets($t, ['a', 'a', 'b'], {
      count: 0,
      taggedAssetIds: [],
      skippedAssetIds: ['a', 'b'],
      skippedTagIds: [],
    });

    onlyCalled('warning', 'tagged_assets_with_skipped {"tagged":0,"skipped":2}');
  });

  it('warns, and never reports success, when every requested tag was skipped', () => {
    notifyTagAssets($t, ['a', 'b'], {
      count: 0,
      taggedAssetIds: [],
      skippedAssetIds: [],
      skippedTagIds: ['foreign-tag'],
    });

    onlyCalled('warning', 'tagged_assets_with_skipped_assets_and_tags {"tagged":0,"skipped":2,"tags":1}');
  });
});
