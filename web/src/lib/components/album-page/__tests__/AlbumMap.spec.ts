import { screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { sdkMock } from '$lib/__mocks__/sdk.mock';
import { createFilterState } from '$lib/components/filter-panel/filter-panel';
import { renderWithTooltips } from '$tests/helpers';
import { albumFactory } from '@test-data/factories/album-factory';
import AlbumMap from '../AlbumMap.svelte';

const { handleErrorMock, modalShowMock } = vi.hoisted(() => ({
  handleErrorMock: vi.fn(),
  modalShowMock: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('$lib/utils/handle-error', () => ({ handleError: handleErrorMock }));

vi.mock('$lib/managers/auth-manager.svelte', () => ({
  authManager: { isSharedLink: false, params: {} },
}));

vi.mock('@immich/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@immich/ui')>();
  return { ...actual, modalManager: { show: modalShowMock } };
});

describe('AlbumMap', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    modalShowMock.mockResolvedValue(undefined);
    sdkMock.getAlbumMapMarkers.mockResolvedValue([]);
    sdkMock.getFilteredMapMarkers.mockResolvedValue([]);
  });

  it('fetches album-scoped markers honouring the active filters', async () => {
    const album = albumFactory.build({ id: 'album-1' });

    renderWithTooltips(AlbumMap, { album, filters: { ...createFilterState(), make: 'Apple' } });

    await vi.waitFor(() =>
      expect(sdkMock.getFilteredMapMarkers).toHaveBeenCalledWith(
        expect.objectContaining({ albumId: 'album-1', make: 'Apple' }),
        expect.anything(),
      ),
    );
    expect(sdkMock.getAlbumMapMarkers).not.toHaveBeenCalled();
    expect(screen.getByLabelText('map')).toBeInTheDocument();
  });

  it('refetches when the album filters change', async () => {
    const album = albumFactory.build({ id: 'album-1' });
    const { rerender } = renderWithTooltips(AlbumMap, { album, filters: { ...createFilterState(), make: 'Apple' } });

    await vi.waitFor(() => expect(sdkMock.getFilteredMapMarkers).toHaveBeenCalledTimes(1));

    await rerender({
      component: AlbumMap,
      componentProps: { album, filters: { ...createFilterState(), make: 'Canon' } },
    });

    await vi.waitFor(() =>
      expect(sdkMock.getFilteredMapMarkers).toHaveBeenLastCalledWith(
        expect.objectContaining({ albumId: 'album-1', make: 'Canon' }),
        expect.anything(),
      ),
    );
  });

  // M6: the album page reassigns `albumFilters` (a whole new object) on every keystroke, including
  // into fields that buildAlbumMapMarkerOptions does not even read. Depending on the raw `filters`
  // object identity (rather than the marker-relevant options) would abort and refetch markers on
  // every one of those keystrokes.
  //
  // `sortOrder` is the genuinely-unused pick here: description/filename/ocr used to qualify (M6's
  // original example) but Finding 2 (#767 fresh instance) made them marker-relevant — see the
  // "refetches" test below — so this now has to pick a field the album map truly never reads.
  it('does not refetch markers when a filter the album map does not read changes (e.g. sortOrder)', async () => {
    const album = albumFactory.build({ id: 'album-1' });
    const { rerender } = renderWithTooltips(AlbumMap, { album, filters: { ...createFilterState(), make: 'Apple' } });

    await vi.waitFor(() => expect(sdkMock.getFilteredMapMarkers).toHaveBeenCalledTimes(1));

    await rerender({
      component: AlbumMap,
      componentProps: { album, filters: { ...createFilterState(), make: 'Apple', sortOrder: 'asc' } },
    });

    // Give an (incorrect) effect rerun a chance to fire before asserting it didn't.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(sdkMock.getFilteredMapMarkers).toHaveBeenCalledTimes(1);
  });

  // Finding 2 (#767 fresh instance): description/filename/ocr are now forwarded to the marker
  // query (buildAlbumMapMarkerOptions -> applyCommonMapFilters), so — unlike sortOrder above —
  // changing one of them IS marker-relevant and must trigger a refetch with the new value applied.
  it('refetches markers when the description filter changes (now marker-relevant)', async () => {
    const album = albumFactory.build({ id: 'album-1' });
    const { rerender } = renderWithTooltips(AlbumMap, { album, filters: { ...createFilterState(), make: 'Apple' } });

    await vi.waitFor(() => expect(sdkMock.getFilteredMapMarkers).toHaveBeenCalledTimes(1));

    await rerender({
      component: AlbumMap,
      componentProps: { album, filters: { ...createFilterState(), make: 'Apple', description: 'sunset' } },
    });

    await vi.waitFor(() =>
      expect(sdkMock.getFilteredMapMarkers).toHaveBeenLastCalledWith(
        expect.objectContaining({ albumId: 'album-1', make: 'Apple', description: 'sunset' }),
        expect.anything(),
      ),
    );
    expect(sdkMock.getFilteredMapMarkers).toHaveBeenCalledTimes(2);
  });

  // Markers now load from an $effect, not once from onMount — so every filter change aborts the
  // in-flight request, and the superseded promise REJECTS. Without a guard that rejection reaches
  // handleError and the user gets an error toast for every character they type into a filter.
  it('does not surface an error when a filter change aborts the in-flight request', async () => {
    const album = albumFactory.build({ id: 'album-1' });
    let rejectFirst: (error: unknown) => void = () => {};
    sdkMock.getFilteredMapMarkers
      .mockReturnValueOnce(
        new Promise((_, reject) => {
          rejectFirst = reject;
        }) as never,
      )
      .mockResolvedValueOnce([{ id: 'asset-2', lat: 1, lon: 2 }] as never);

    const { rerender } = renderWithTooltips(AlbumMap, { album, filters: { ...createFilterState(), make: 'Apple' } });
    await vi.waitFor(() => expect(sdkMock.getFilteredMapMarkers).toHaveBeenCalledTimes(1));

    await rerender({
      component: AlbumMap,
      componentProps: { album, filters: { ...createFilterState(), make: 'Canon' } },
    });
    await vi.waitFor(() => expect(sdkMock.getFilteredMapMarkers).toHaveBeenCalledTimes(2));

    // …and only now does the aborted first request settle.
    rejectFirst(new DOMException('The operation was aborted.', 'AbortError'));
    // A flush, not vi.waitFor: vi.waitFor's own first poll runs before the rejection microtask does,
    // so it would trivially satisfy itself and never actually exercise the catch guard it documents
    // (I3 — mutation-checked: deleting the guard left this assertion green).
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(handleErrorMock).not.toHaveBeenCalled();

    // The second response is the one on the map.
    await userEvent.setup().click(screen.getByLabelText('map'));
    expect(modalShowMock).toHaveBeenCalledWith(expect.anything(), {
      mapMarkers: [{ id: 'asset-2', lat: 1, lon: 2 }],
    });
  });

  // The other half of the same race: a superseded request that RESOLVES late must not clobber the
  // markers of the request that replaced it.
  it('ignores a stale response that resolves after a newer one', async () => {
    const album = albumFactory.build({ id: 'album-1' });
    let resolveFirst: (markers: unknown) => void = () => {};
    sdkMock.getFilteredMapMarkers
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveFirst = resolve;
        }) as never,
      )
      .mockResolvedValueOnce([{ id: 'fresh', lat: 1, lon: 2 }] as never);

    const { rerender } = renderWithTooltips(AlbumMap, { album, filters: { ...createFilterState(), make: 'Apple' } });
    await vi.waitFor(() => expect(sdkMock.getFilteredMapMarkers).toHaveBeenCalledTimes(1));

    await rerender({
      component: AlbumMap,
      componentProps: { album, filters: { ...createFilterState(), make: 'Canon' } },
    });
    await vi.waitFor(() => expect(sdkMock.getFilteredMapMarkers).toHaveBeenCalledTimes(2));

    // No handleError assertion here: the stale request RESOLVES (it never throws), so the mock could
    // not be called whether or not the ordering guard exists — it was an inert line. The assertion
    // below is the one that does the work.
    resolveFirst([{ id: 'stale', lat: 9, lon: 9 }]);

    await userEvent.setup().click(screen.getByLabelText('map'));
    expect(modalShowMock).toHaveBeenCalledWith(expect.anything(), { mapMarkers: [{ id: 'fresh', lat: 1, lon: 2 }] });
  });

  // AlbumViewer.svelte (the SHARED-LINK album view) renders AlbumMap with no filters. That path
  // must keep using the album endpoint: /gallery/map/markers has no shared-link auth, and E2 says
  // shared links get no filter affordances at all.
  it('falls back to the album endpoint when no filters are provided', async () => {
    renderWithTooltips(AlbumMap, { album: albumFactory.build({ id: 'album-1' }) });

    await vi.waitFor(() =>
      expect(sdkMock.getAlbumMapMarkers).toHaveBeenCalledWith({ id: 'album-1' }, expect.anything()),
    );
    expect(sdkMock.getFilteredMapMarkers).not.toHaveBeenCalled();
  });
});
