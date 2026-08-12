import { type AssetResponseDto } from '@immich/sdk';
import '@testing-library/jest-dom';
import { fireEvent, screen, waitFor } from '@testing-library/svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildContextualFilterUrl } from '$lib/utils/filter-target';
import { renderWithTooltips } from '$tests/helpers';
import { assetFactory } from '@test-data/factories/asset-factory';
import { reactivePageMock as mockPage } from '@test-data/mocks/reactive-page.mock.svelte';
import DetailPanelTags from '../DetailPanelTags.svelte';

// Task 5 of Slice 7 (asset-viewer-contextual-filters). Per R5 this is a dedicated child spec —
// detail-panel.spec.ts noop-mocks DetailPanelTags, so it cannot see this row at all.
//
// R10 — the tag VALUE must stay a link, and stay the FIRST link in the row:
// e2e/src/ui/specs/asset-viewer/stack.e2e-spec.ts does
//   getByTestId('detail-panel-tags').getByRole('link').first() → toHaveText('test/1')
// Turning the value into a <button>, or rendering the ↗ link before it, goes red there.

const { gotoMock, removeTagMock, getAssetInfoMock } = vi.hoisted(() => ({
  gotoMock: vi.fn().mockResolvedValue(undefined),
  removeTagMock: vi.fn(),
  getAssetInfoMock: vi.fn(),
}));

vi.mock('$app/navigation', () => ({ goto: gotoMock }));

vi.mock('$app/state', async () => {
  const { reactivePageMock } = await import('@test-data/mocks/reactive-page.mock.svelte');
  return { page: reactivePageMock };
});

vi.mock('@immich/sdk', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@immich/sdk')>();
  return { ...actual, getAssetInfo: getAssetInfoMock };
});

vi.mock('$lib/utils/asset-utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('$lib/utils/asset-utils')>();
  return { ...actual, removeTag: removeTagMock };
});

const authManagerMock = vi.hoisted(() => ({
  authenticated: true,
  user: { id: 'owner-1' },
  isSharedLink: false,
  params: {},
  preferences: { tags: { enabled: true } },
}));

vi.mock('$lib/managers/auth-manager.svelte', () => ({ authManager: authManagerMock }));

// getAssetActions (the owner-only "+ tag" HeaderActionButton) reads the feature flags on render.
vi.mock('$lib/managers/feature-flags-manager.svelte', () => ({
  featureFlagsManager: { value: { map: false, smartSearch: false, search: false, trash: true } },
}));

const TAGS = [
  { id: 'tag-1', value: 'test/1', name: '1', createdAt: '', updatedAt: '' },
  { id: 'tag-2', value: 'test/2', name: '2', createdAt: '', updatedAt: '' },
];

const buildAsset = (): AssetResponseDto =>
  assetFactory.build({ id: 'asset-1', ownerId: 'owner-1', tags: TAGS as AssetResponseDto['tags'] });

beforeEach(() => {
  vi.clearAllMocks();
  gotoMock.mockResolvedValue(undefined);
  removeTagMock.mockResolvedValue(['asset-1']);
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

    renderWithTooltips(DetailPanelTags, { asset: buildAsset(), isOwner: true, canFilter: true });

    const link = await screen.findByLabelText('filter_by_tag: test/1');
    const expected = buildContextualFilterUrl(mockPage.url, { tagIds: ['tag-1'] });

    expect(link.getAttribute('href')).toBe(expected);
    expect(expected.startsWith(basePath)).toBe(true);
    expect(expected).not.toContain('asset-1'); // one navigation closes the asset viewer
    expect(expected).toContain('tags=tag-1');
  });

  // R10 — the exact locator the stack Playwright spec uses.
  it('R10: the FIRST link of the row is still the tag value (a real <a> with the tag text)', async () => {
    renderWithTooltips(DetailPanelTags, { asset: buildAsset(), isOwner: true, canFilter: true });

    const row = await screen.findByTestId('detail-panel-tags');
    const links = row.querySelectorAll('a');

    expect(links[0]?.tagName).toBe('A');
    expect(links[0]?.textContent?.trim()).toBe('test/1');
  });

  // E25 — the tagIds array is REPLACED, never appended. tagIds is OR-ed server-side while personIds
  // is AND-ed, so appending would make two adjacent rows of the same panel move the result set in
  // OPPOSITE directions. One click = one tag.
  it('E25: the tag link REPLACES an already-active tag filter rather than appending to it', async () => {
    mockPage.reset('https://gallery.test/photos/asset-1?tags=tag-9');

    renderWithTooltips(DetailPanelTags, { asset: buildAsset(), isOwner: true, canFilter: true });

    const link = await screen.findByLabelText('filter_by_tag: test/2');
    const href = link.getAttribute('href') ?? '';
    const params = new URLSearchParams(href.split('?', 2)[1]);

    expect(params.get('tags')).toBe('tag-2');
    expect(href).not.toContain('tag-9');
  });

  // The old /tags navigation is not lost — it moves to a ↗ link AFTER the value.
  it('keeps a ↗ link to the tag page, rendered after the value', async () => {
    renderWithTooltips(DetailPanelTags, { asset: buildAsset(), isOwner: true, canFilter: true });

    const openTag = await screen.findByLabelText('view_tag: test/1');
    expect(openTag.getAttribute('href')).toContain('/tags?path=test%2F1');

    const row = screen.getByTestId('detail-panel-tags');
    const links = [...row.querySelectorAll('a')];
    expect(links.indexOf(openTag as HTMLAnchorElement)).toBeGreaterThan(0);
  });

  it('the owner-only close ✕ still removes the tag', async () => {
    renderWithTooltips(DetailPanelTags, { asset: buildAsset(), isOwner: true, canFilter: true });

    const closeButtons = await screen.findAllByLabelText('remove_tag');
    await fireEvent.click(closeButtons[0]);

    await waitFor(() => expect(removeTagMock).toHaveBeenCalledWith(expect.objectContaining({ tagIds: ['tag-1'] })));
    expect(gotoMock).not.toHaveBeenCalled();
  });

  // E2 — canFilter is false on a shared link. The value stays a link (it is one today), but it
  // points at the tag page, and no filter URL is offered.
  it('E2: with canFilter false the value links to the tag page and no filter affordance renders', async () => {
    renderWithTooltips(DetailPanelTags, { asset: buildAsset(), isOwner: true, canFilter: false });

    await waitFor(() => expect(screen.getByTestId('detail-panel-tags')).toBeInTheDocument());
    expect(screen.queryByLabelText(/^filter_by_tag/)).not.toBeInTheDocument();

    const links = [...screen.getByTestId('detail-panel-tags').querySelectorAll('a')];
    expect(links[0]?.getAttribute('href')).toContain('/tags?path=test%2F1');
    expect(links.every((link) => !link.getAttribute('href')?.startsWith('/photos'))).toBe(true);
  });
});
