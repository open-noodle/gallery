import { reactivePageMock as mockPage } from '#lib/gallery/__mocks__/reactive-page.mock.svelte.ts';
import { buildContextualFilterUrl } from '#lib/utils/filter-target.ts';
import { factory } from '#test/unit/factories.ts';
import { renderWithTooltips } from '#test/unit/helpers.ts';
import { type AssetResponseDto } from '@immich/sdk';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import DetailPanelTags from '../DetailPanelTags.svelte';

// Task 5 of Slice 7 (asset-viewer-contextual-filters). Per R5 this is a dedicated child spec —
// detail-panel.spec.ts noop-mocks DetailPanelTags, so it cannot see this row at all.
//
// R10 — the tag VALUE must stay a link, and stay the FIRST link in the row:
// e2e/src/ui/specs/asset-viewer/stack.e2e-spec.ts does
//   getByTestId('detail-panel-tags').getByRole('link').first() → toHaveText('test/1')
// Turning the value into a <button>, or rendering the ↗ link before it, goes red there.

const { gotoMock, untagAssetsMock, getAssetInfoMock } = vi.hoisted(() => ({
  gotoMock: vi.fn().mockResolvedValue(undefined),
  untagAssetsMock: vi.fn(),
  getAssetInfoMock: vi.fn(),
}));

vi.mock('$app/navigation', async () => ({
  ...(await import('#test/unit/mocks/app-navigation.ts')),
  goto: gotoMock,
}));

vi.mock('$app/state', async () => {
  const { reactivePageMock } = await import('#lib/gallery/__mocks__/reactive-page.mock.svelte.ts');
  return { ...(await import('#test/unit/mocks/app-state.svelte.ts')), page: reactivePageMock };
});

vi.mock('@immich/sdk', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@immich/sdk')>();
  // removeTag (asset-utils.ts) runs for real and calls untagAssets once per tag. Mocking asset-utils
  // itself with importOriginal deadlocks in browser mode: it sits in an import cycle with this tree.
  return { ...actual, getAssetInfo: getAssetInfoMock, untagAssets: untagAssetsMock };
});

const authManagerMock = vi.hoisted(() => ({
  authenticated: true,
  user: { id: 'owner-1' },
  isSharedLink: false,
  params: {},
  preferences: { tags: { enabled: true } },
}));

vi.mock('#lib/managers/auth-manager.svelte.js', () => ({ authManager: authManagerMock }));

// getAssetActions (the owner-only "+ tag" HeaderActionButton) reads the feature flags on render.
vi.mock('#lib/managers/feature-flags-manager.svelte.js', () => ({
  featureFlagsManager: { value: { map: false, smartSearch: false, search: false, trash: true } },
}));

const TAGS = [
  { id: 'tag-1', value: 'test/1', name: '1', createdAt: '', updatedAt: '' },
  { id: 'tag-2', value: 'test/2', name: '2', createdAt: '', updatedAt: '' },
];

const buildAsset = (): AssetResponseDto =>
  factory.asset({ id: 'asset-1', ownerId: 'owner-1', tags: TAGS as AssetResponseDto['tags'] });

beforeEach(() => {
  vi.clearAllMocks();
  gotoMock.mockResolvedValue(undefined);
  untagAssetsMock.mockResolvedValue([]);
  getAssetInfoMock.mockResolvedValue(buildAsset());
  authManagerMock.isSharedLink = false;
  mockPage.reset('https://gallery.test/photos/asset-1');
});

describe('DetailPanelTags filter grammar', () => {
  const surfaces = [
    { label: '/photos', url: 'https://gallery.test/photos/asset-1', basePath: '/photos' },
    { label: 'a Space', url: 'https://gallery.test/spaces/space-1/photos/asset-1', basePath: '/spaces/space-1' },
    { label: 'an album', url: 'https://gallery.test/albums/album-1/photos/asset-1', basePath: '/albums/album-1' },
    { label: 'the map', url: 'https://gallery.test/map/photos/asset-1', basePath: '/map' },
  ];

  it.each(surfaces)('the tag value links to the $label filter URL, closing the viewer', async ({ url, basePath }) => {
    mockPage.reset(url);

    await renderWithTooltips(DetailPanelTags, { asset: buildAsset(), isOwner: true, canFilter: true });

    const link = page.getByLabelText('filter_by_tag: test/1');
    const expected = buildContextualFilterUrl(mockPage.url, { tagIds: ['tag-1'] });

    await expect.element(link).toHaveAttribute('href', expected);
    expect(expected.startsWith(basePath)).toBe(true);
    expect(expected).not.toContain('asset-1'); // one navigation closes the asset viewer
    expect(expected).toContain('tags=tag-1');
  });

  // R10 — the exact locator the stack Playwright spec uses.
  it('R10: the FIRST link of the row is still the tag value (a real <a> with the tag text)', async () => {
    await renderWithTooltips(DetailPanelTags, { asset: buildAsset(), isOwner: true, canFilter: true });

    await expect.element(page.getByTestId('detail-panel-tags')).toBeInTheDocument();
    const links = page.getByTestId('detail-panel-tags').element().querySelectorAll('a');

    expect(links[0]?.tagName).toBe('A');
    expect(links[0]?.textContent?.trim()).toBe('test/1');
  });

  // E25 — the tagIds array is REPLACED, never appended. tagIds is OR-ed server-side while personIds
  // is AND-ed, so appending would make two adjacent rows of the same panel move the result set in
  // OPPOSITE directions. One click = one tag.
  it('E25: the tag link REPLACES an already-active tag filter rather than appending to it', async () => {
    mockPage.reset('https://gallery.test/photos/asset-1?tags=tag-9');

    await renderWithTooltips(DetailPanelTags, { asset: buildAsset(), isOwner: true, canFilter: true });

    const link = page.getByLabelText('filter_by_tag: test/2');
    await expect.element(link).toBeInTheDocument();
    const href = link.element().getAttribute('href') ?? '';
    const params = new URLSearchParams(href.split('?', 2)[1]);

    expect(params.get('tags')).toBe('tag-2');
    expect(href).not.toContain('tag-9');
  });

  // The old /tags navigation is not lost — it moves to a ↗ link AFTER the value.
  it('keeps a ↗ link to the tag page, rendered after the value', async () => {
    await renderWithTooltips(DetailPanelTags, { asset: buildAsset(), isOwner: true, canFilter: true });

    const openTag = page.getByLabelText('view_tag: test/1');
    await expect.element(openTag).toHaveAttribute('href', expect.stringContaining('/tags?path=test%2F1'));

    const links = [...page.getByTestId('detail-panel-tags').element().querySelectorAll('a')];
    expect(links.indexOf(openTag.element() as HTMLAnchorElement)).toBeGreaterThan(0);
  });

  it('the owner-only close ✕ still removes the tag', async () => {
    await renderWithTooltips(DetailPanelTags, { asset: buildAsset(), isOwner: true, canFilter: true });

    await page.getByLabelText('remove_tag').first().click();

    await vi.waitFor(() =>
      expect(untagAssetsMock).toHaveBeenCalledWith({ id: 'tag-1', bulkIdsDto: { ids: ['asset-1'] } }),
    );
    expect(untagAssetsMock).toHaveBeenCalledTimes(1);
    expect(gotoMock).not.toHaveBeenCalled();
  });

  // E2 — canFilter is false on a shared link. The value stays a link (it is one today), but it
  // points at the tag page, and no filter URL is offered.
  it('E2: with canFilter false the value links to the tag page and no filter affordance renders', async () => {
    await renderWithTooltips(DetailPanelTags, { asset: buildAsset(), isOwner: true, canFilter: false });

    await expect.element(page.getByTestId('detail-panel-tags')).toBeInTheDocument();
    await expect.element(page.getByLabelText(/^filter_by_tag/)).not.toBeInTheDocument();

    const links = [...page.getByTestId('detail-panel-tags').element().querySelectorAll('a')];
    expect(links[0]?.getAttribute('href')).toContain('/tags?path=test%2F1');
    expect(links.every((link) => !link.getAttribute('href')?.startsWith('/photos'))).toBe(true);
  });
});
