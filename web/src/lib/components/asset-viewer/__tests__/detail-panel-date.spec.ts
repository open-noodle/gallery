import { type AssetResponseDto } from '@immich/sdk';
import { modalManager } from '@immich/ui';
import '@testing-library/jest-dom';
import { fireEvent, screen, waitFor } from '@testing-library/svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildContextualFilterUrl } from '$lib/utils/filter-target';
import { renderWithTooltips } from '$tests/helpers';
import { assetFactory } from '@test-data/factories/asset-factory';
import { reactivePageMock as mockPage } from '@test-data/mocks/reactive-page.mock.svelte';
import DetailPanelDate from '../DetailPanelDate.svelte';

// Task 4 of Slice 7 (asset-viewer-contextual-filters) — E14.

const { gotoMock } = vi.hoisted(() => ({
  gotoMock: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('$app/navigation', () => ({ goto: gotoMock }));

vi.mock('$app/state', async () => {
  const { reactivePageMock } = await import('@test-data/mocks/reactive-page.mock.svelte');
  return { page: reactivePageMock };
});

vi.mock('@immich/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@immich/ui')>();
  return {
    ...actual,
    modalManager: { show: vi.fn().mockResolvedValue(undefined) },
  };
});

const buildAsset = (overrides: Partial<AssetResponseDto> = {}): AssetResponseDto =>
  assetFactory.build({ id: 'asset-1', ownerId: 'owner-1', ...overrides });

/**
 * E14's load-bearing fixture. The asset was taken at 01:00 on 1 Jan 2026 in Auckland (UTC+13) —
 * i.e. 12:00 on 31 Dec 2025 UTC. The row DISPLAYS 1 Jan 2026 (it prefers exifInfo.dateTimeOriginal
 * + timeZone), so the filter must say 2026-01-01.
 *
 * Note `localDateTime` is deliberately the UTC instant here rather than the naive local wall clock:
 * that is what makes this fixture bite. Any implementation that filters off `localDateTime` — or
 * that re-buckets the displayed DateTime through UTC — yields 2025-12-31 and fails this test. A
 * "straddles midnight" fixture with a naive-local `localDateTime` would pass vacuously.
 */
const AUCKLAND_NEW_YEAR = {
  exifInfo: { dateTimeOriginal: '2026-01-01T01:00:00+13:00', timeZone: 'Pacific/Auckland' },
  fileCreatedAt: '2025-12-31T12:00:00Z',
  localDateTime: '2025-12-31T12:00:00Z',
};

beforeEach(() => {
  vi.clearAllMocks();
  gotoMock.mockResolvedValue(undefined);
  vi.mocked(modalManager.show).mockResolvedValue(undefined as never);
  mockPage.reset('https://gallery.test/photos/asset-1');
});

describe('DetailPanelDate filter (E14)', () => {
  it('filters by the date the row ACTUALLY DISPLAYS, not by a UTC re-bucketing of it', async () => {
    renderWithTooltips(DetailPanelDate, { asset: buildAsset(AUCKLAND_NEW_YEAR), isOwner: true, canFilter: true });

    // What the row shows.
    await waitFor(() => expect(screen.getByText(/Jan 1, 2026/)).toBeInTheDocument());

    await fireEvent.click(screen.getByLabelText(/^filter_by_date/));

    const expected = buildContextualFilterUrl(mockPage.url, { dateAfter: '2026-01-01', dateBefore: '2026-01-01' });
    expect(gotoMock).toHaveBeenCalledWith(expected);

    const [url] = gotoMock.mock.calls[0] as [string];
    const params = new URLSearchParams(url.split('?', 2)[1]);
    expect(params.get('from')).toBe('2026-01-01');
    expect(params.get('to')).toBe('2026-01-01');
  });

  it('falls back to localDateTime when there is no EXIF timestamp', async () => {
    const asset = buildAsset({ exifInfo: {}, localDateTime: '2026-04-16T17:37:26.000Z' });

    renderWithTooltips(DetailPanelDate, { asset, isOwner: true, canFilter: true });

    await fireEvent.click(await screen.findByLabelText(/^filter_by_date/));

    const [url] = gotoMock.mock.calls[0] as [string];
    const params = new URLSearchParams(url.split('?', 2)[1]);
    expect(params.get('from')).toBe('2026-04-16');
    expect(params.get('to')).toBe('2026-04-16');
  });

  it('filters the current surface and closes the viewer', async () => {
    mockPage.reset('https://gallery.test/spaces/space-1/photos/asset-1');

    renderWithTooltips(DetailPanelDate, { asset: buildAsset(AUCKLAND_NEW_YEAR), isOwner: true, canFilter: true });

    await fireEvent.click(await screen.findByLabelText(/^filter_by_date/));

    const [url] = gotoMock.mock.calls[0] as [string];
    expect(url.startsWith('/spaces/space-1')).toBe(true);
    expect(url).not.toContain('asset-1');
  });

  it('E2: a shared link renders no filter affordance', async () => {
    renderWithTooltips(DetailPanelDate, { asset: buildAsset(AUCKLAND_NEW_YEAR), isOwner: false, canFilter: false });

    await waitFor(() => expect(screen.getByText(/Jan 1, 2026/)).toBeInTheDocument());
    expect(screen.queryByLabelText(/^filter_by_date/)).not.toBeInTheDocument();
    expect(gotoMock).not.toHaveBeenCalled();
  });
});

describe('DetailPanelDate edit (R3/R10)', () => {
  // R10 — the Playwright detail-panel spec CLICKS `detail-panel-edit-date-button` to open the date
  // modal. Dismantling the outer <button> moves that testid onto the owner-gated pencil.
  it('the ✏️ carries data-testid="detail-panel-edit-date-button" and opens the change-date modal', async () => {
    renderWithTooltips(DetailPanelDate, { asset: buildAsset(AUCKLAND_NEW_YEAR), isOwner: true, canFilter: true });

    const pencil = await screen.findByTestId('detail-panel-edit-date-button');
    await fireEvent.click(pencil);

    expect(modalManager.show).toHaveBeenCalled();
  });

  it('the row itself is no longer a <button>', async () => {
    renderWithTooltips(DetailPanelDate, { asset: buildAsset(AUCKLAND_NEW_YEAR), isOwner: true, canFilter: true });

    const pencil = await screen.findByTestId('detail-panel-edit-date-button');
    // The testid now identifies the pencil control itself, not a row wrapping the whole date.
    expect(pencil.textContent).not.toContain('Jan 1, 2026');
  });

  it('a non-owner gets no ✏️, but can still filter', async () => {
    renderWithTooltips(DetailPanelDate, { asset: buildAsset(AUCKLAND_NEW_YEAR), isOwner: false, canFilter: true });

    await waitFor(() => expect(screen.getByLabelText(/^filter_by_date/)).toBeInTheDocument());
    expect(screen.queryByTestId('detail-panel-edit-date-button')).not.toBeInTheDocument();
    expect(modalManager.show).not.toHaveBeenCalled();
  });
});
