import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { beforeEach, vi } from 'vitest';
import { buildContextualFilterUrl } from '$lib/utils/filter-target';
import { renderWithTooltips } from '$tests/helpers';
import { assetFactory } from '@test-data/factories/asset-factory';
import { reactivePageMock as mockPage } from '@test-data/mocks/reactive-page.mock.svelte';
import DetailPanelDescription from './DetailPanelDescription.svelte';

// Slice 7 Task 5 — R6: for the owner the description IS a focusable <Textarea> (clicking it places
// the caret), so the filter cannot live on the value. It lives on a ⚗️ icon beside it.

const { gotoMock } = vi.hoisted(() => ({ gotoMock: vi.fn().mockResolvedValue(undefined) }));

vi.mock('$app/navigation', () => ({ goto: gotoMock }));

vi.mock('$app/state', async () => {
  const { reactivePageMock } = await import('@test-data/mocks/reactive-page.mock.svelte');
  return { page: reactivePageMock };
});

beforeEach(() => {
  vi.clearAllMocks();
  gotoMock.mockResolvedValue(undefined);
  mockPage.reset('https://gallery.test/photos/asset-1');
});

describe('DetailPanelDescription', () => {
  it('clears unsaved draft on asset change', async () => {
    const user = userEvent.setup();

    const assetA = assetFactory.build({
      id: 'asset-a',
      exifInfo: { description: '' },
    });
    const assetB = assetFactory.build({
      id: 'asset-b',
      exifInfo: { description: '' },
    });

    const { rerender } = render(DetailPanelDescription, {
      props: {
        asset: assetA,
        isOwner: true,
      },
    });

    const textarea = screen.getByTestId('autogrow-textarea') as HTMLTextAreaElement;
    await user.type(textarea, 'unsaved draft');
    expect(textarea).toHaveValue('unsaved draft');

    await rerender({
      asset: assetB,
      isOwner: true,
    });

    expect(screen.getByTestId('autogrow-textarea')).toHaveValue('');
  });

  it('updates description on asset switch', async () => {
    const assetA = assetFactory.build({
      id: 'asset-a',
      exifInfo: { description: 'first description' },
    });
    const assetB = assetFactory.build({
      id: 'asset-b',
      exifInfo: { description: 'second description' },
    });

    const { rerender } = render(DetailPanelDescription, {
      props: {
        asset: assetA,
        isOwner: true,
      },
    });

    expect(screen.getByTestId('autogrow-textarea')).toHaveValue('first description');

    await rerender({
      asset: assetB,
      isOwner: true,
    });

    expect(screen.getByTestId('autogrow-textarea')).toHaveValue('second description');
  });
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
    const asset = assetFactory.build({ id: 'asset-1', exifInfo: { description: 'Beach day' } });

    renderWithTooltips(DetailPanelDescription, { asset, isOwner: true, canFilter: true });

    await fireEvent.click(await screen.findByLabelText(/^filter_by_description/));

    const expected = buildContextualFilterUrl(mockPage.url, { description: 'Beach day' });
    expect(gotoMock).toHaveBeenCalledWith(expected);
    expect(expected.startsWith(basePath)).toBe(true);
    expect(expected).toContain('description=Beach+day');
    expect(expected).not.toContain('asset-1'); // one goto() closes the asset viewer
  });

  it('offers the ⚗️ to a non-owner too, beside the read-only text', async () => {
    const asset = assetFactory.build({ id: 'asset-1', exifInfo: { description: 'Beach day' } });

    renderWithTooltips(DetailPanelDescription, { asset, isOwner: false, canFilter: true });

    expect(await screen.findByText('Beach day')).toBeInTheDocument();
    await fireEvent.click(screen.getByLabelText(/^filter_by_description/));

    expect(gotoMock).toHaveBeenCalledWith(buildContextualFilterUrl(mockPage.url, { description: 'Beach day' }));
  });

  // R9 — an empty/whitespace-only description trims to nothing: the click would close the viewer and
  // apply no filter at all.
  it.each(['', ' '.repeat(3)])('R9: renders no ⚗️ for an empty description (%j)', async (description) => {
    const asset = assetFactory.build({ id: 'asset-1', exifInfo: { description } });

    renderWithTooltips(DetailPanelDescription, { asset, isOwner: true, canFilter: true });

    await waitFor(() => expect(screen.getByTestId('autogrow-textarea')).toBeInTheDocument());
    expect(screen.queryByLabelText(/^filter_by_description/)).not.toBeInTheDocument();
  });

  // The codec already clamps to 200 CODE POINTS on encode AND decode (filter-url.ts) — the component
  // must NOT re-implement a truncation of its own, and the long description must still be clickable.
  it('does not truncate: the codec clamps the emitted param to 200 code points', async () => {
    const description = 'a'.repeat(250);
    const asset = assetFactory.build({ id: 'asset-1', exifInfo: { description } });

    renderWithTooltips(DetailPanelDescription, { asset, isOwner: true, canFilter: true });

    await fireEvent.click(await screen.findByLabelText(/^filter_by_description/));

    const [url] = gotoMock.mock.calls[0] as [string];
    expect(new URLSearchParams(url.split('?', 2)[1]).get('description')).toBe('a'.repeat(200));
  });

  it('E2: with canFilter false no ⚗️ renders', async () => {
    const asset = assetFactory.build({ id: 'asset-1', exifInfo: { description: 'Beach day' } });

    renderWithTooltips(DetailPanelDescription, { asset, isOwner: true, canFilter: false });

    await waitFor(() => expect(screen.getByTestId('autogrow-textarea')).toBeInTheDocument());
    expect(screen.queryByLabelText(/^filter_by_description/)).not.toBeInTheDocument();
    expect(gotoMock).not.toHaveBeenCalled();
  });
});
