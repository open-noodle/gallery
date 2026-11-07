import { reactivePageMock as mockPage } from '#lib/gallery/__mocks__/reactive-page.mock.svelte.ts';
import { buildContextualFilterUrl } from '#lib/utils/filter-target.ts';
import { factory } from '#test/unit/factories.ts';
import { renderWithTooltips } from '#test/unit/helpers.ts';
import { beforeEach, expect, vi } from 'vitest';
import { page } from 'vitest/browser';
import DetailPanelDescription from './DetailPanelDescription.svelte';

// Slice 7 Task 5 — R6: for the owner the description IS a focusable <Textarea> (clicking it places
// the caret), so the filter cannot live on the value. It lives on a ⚗️ icon beside it.

const { gotoMock } = vi.hoisted(() => ({ gotoMock: vi.fn().mockResolvedValue(undefined) }));

vi.mock('$app/navigation', async () => ({ ...(await import('#test/unit/mocks/app-navigation.ts')), goto: gotoMock }));

vi.mock('$app/state', async () => {
  const { reactivePageMock } = await import('#lib/gallery/__mocks__/reactive-page.mock.svelte.ts');
  return { page: reactivePageMock };
});

beforeEach(() => {
  vi.clearAllMocks();
  gotoMock.mockResolvedValue(undefined);
  mockPage.reset('https://gallery.test/photos/asset-1');
});

describe('DetailPanelDescription filter (R6)', () => {
  const surfaces = [
    { label: '/photos', url: 'https://gallery.test/photos/asset-1', basePath: '/photos' },
    { label: 'a Space', url: 'https://gallery.test/spaces/space-1/photos/asset-1', basePath: '/spaces/space-1' },
    { label: 'an album', url: 'https://gallery.test/albums/album-1/photos/asset-1', basePath: '/albums/album-1' },
    { label: 'the map', url: 'https://gallery.test/map/photos/asset-1', basePath: '/map' },
  ];

  it.each(surfaces)('the ⚗️ icon emits { description } and filters $label', async ({ url, basePath }) => {
    mockPage.reset(url);
    const asset = factory.asset({ id: 'asset-1', exifInfo: { description: 'Beach day' } });

    await renderWithTooltips(DetailPanelDescription, { asset, isOwner: true, canFilter: true });

    await page.getByLabelText(/^filter_by_description/).click();

    const expected = buildContextualFilterUrl(mockPage.url, { description: 'Beach day' });
    expect(gotoMock).toHaveBeenCalledWith(expected);
    expect(expected.startsWith(basePath)).toBe(true);
    expect(expected).toContain('description=Beach+day');
    expect(expected).not.toContain('asset-1'); // one goto() closes the asset viewer
  });

  it('offers the ⚗️ to a non-owner too, beside the read-only text', async () => {
    const asset = factory.asset({ id: 'asset-1', exifInfo: { description: 'Beach day' } });

    await renderWithTooltips(DetailPanelDescription, { asset, isOwner: false, canFilter: true });

    await expect.element(page.getByText('Beach day')).toBeInTheDocument();
    await page.getByLabelText(/^filter_by_description/).click();

    expect(gotoMock).toHaveBeenCalledWith(buildContextualFilterUrl(mockPage.url, { description: 'Beach day' }));
  });

  // R9 — an empty/whitespace-only description trims to nothing: the click would close the viewer and
  // apply no filter at all.
  it.each(['', ' '.repeat(3)])('R9: renders no ⚗️ for an empty description (%j)', async (description) => {
    const asset = factory.asset({ id: 'asset-1', exifInfo: { description } });

    await renderWithTooltips(DetailPanelDescription, { asset, isOwner: true, canFilter: true });

    await expect.element(page.getByTestId('autogrow-textarea')).toBeInTheDocument();
    expect(page.getByLabelText(/^filter_by_description/).query()).toBeNull();
  });

  // The codec already clamps to 200 CODE POINTS on encode AND decode (filter-url.ts) — the component
  // must NOT re-implement a truncation of its own, and the long description must still be clickable.
  it('does not truncate: the codec clamps the emitted param to 200 code points', async () => {
    const description = 'a'.repeat(250);
    const asset = factory.asset({ id: 'asset-1', exifInfo: { description } });

    await renderWithTooltips(DetailPanelDescription, { asset, isOwner: true, canFilter: true });

    await page.getByLabelText(/^filter_by_description/).click();

    const [url] = gotoMock.mock.calls[0] as [string];
    expect(new URLSearchParams(url.split('?', 2)[1]).get('description')).toBe('a'.repeat(200));
  });

  it('E2: with canFilter false no ⚗️ renders', async () => {
    const asset = factory.asset({ id: 'asset-1', exifInfo: { description: 'Beach day' } });

    await renderWithTooltips(DetailPanelDescription, { asset, isOwner: true, canFilter: false });

    await expect.element(page.getByTestId('autogrow-textarea')).toBeInTheDocument();
    expect(page.getByLabelText(/^filter_by_description/).query()).toBeNull();
    expect(gotoMock).not.toHaveBeenCalled();
  });
});
