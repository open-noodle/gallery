import {
  declineFaceRepair,
  getFaceRepairPersonFaces,
  getLatestScan,
  resolveFaces,
  triggerScan,
  type FaceRepairPersonFacesDto,
} from '@immich/sdk';
import { ConfirmModal, modalManager } from '@immich/ui';
import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Route } from '$lib/route';
import Page from './+page.svelte';

// The post-scan console, retriaged into two lanes (design
// specs/2026-07-24-face-cleanup-scan-two-lane-redesign-design.md): a confident bulk
// (ConfidentLane, approve-all + spot-check exclude) and a clickable review-first list (ReviewFirstLane).
// The lanes' own behaviours are covered by ConfidentLane.spec.ts / ReviewFirstLane.spec.ts; here we verify
// the page composes them, wires the bulk-approve/dismiss handlers, and keeps every non-completed state.

// Mock @immich/sdk before any imports that use it
vi.mock('@immich/sdk', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@immich/sdk')>();
  return {
    ...actual,
    getLatestScan: vi.fn(),
    triggerScan: vi.fn(),
    resolveFaces: vi.fn(),
    getFaceRepairPersonFaces: vi.fn(),
    declineFaceRepair: vi.fn(),
    getPeopleThumbnailPath: (id: string) => `/people/${id}/thumbnail`,
  };
});

vi.mock('@immich/ui', async (original) => {
  const mod = await original<typeof import('@immich/ui')>();
  const noop = await import('@test-data/mocks/noop-component.svelte');
  return {
    ...mod,
    // Stub Icon to a no-op to avoid undefined-path errors in happy-dom
    Icon: noop.default,
    toastManager: {
      primary: vi.fn(),
      success: vi.fn(),
      danger: vi.fn(),
    },
    // Avoid tooltip/context provider issues in tests
    IconButton: mod.Button,
    // S11.11/F26: bulk approve now gates on a real ConfirmModal, same pattern as [personId]/+page.svelte's
    // Move-entire-cluster confirmation.
    modalManager: { show: vi.fn() },
  };
});

// Every (key, options) pair the page asked to translate — same tracker as
// [personId]/page.spec.ts — so a test can assert what was INTERPOLATED (e.g. the cluster count in the
// bulk-approve confirmation), not just which key rendered. The returned string is still just the bare key
// (opts dropped), so every existing `getByText('admin.some_key')` assertion is unaffected.
const { translations } = vi.hoisted(() => ({
  translations: [] as { key: string; values?: Record<string, unknown> }[],
}));

// Mock svelte-i18n: return the key as the translation
vi.mock('svelte-i18n', async (orig) => {
  const actual = await orig<typeof import('svelte-i18n')>();
  return {
    ...actual,
    t: {
      subscribe: (run: (fn: (key: string, opts?: unknown) => string) => void) => {
        run((key: string, opts?: unknown) => {
          translations.push({ key, values: (opts as { values?: Record<string, unknown> })?.values });
          return key;
        });
        return () => {};
      },
    },
  };
});

// Mock $app/navigation to avoid SvelteKit runtime in tests
vi.mock('$app/navigation', () => ({
  goto: vi.fn(),
  afterNavigate: vi.fn(),
  beforeNavigate: vi.fn(),
  onNavigate: vi.fn(),
}));

// Mock $app/stores to avoid SvelteKit runtime in tests
vi.mock('$app/stores', () => ({
  page: {
    subscribe: vi.fn((run) => {
      run({ url: new URL('http://localhost/admin/face-cleanup/scan') });
      return () => {};
    }),
  },
  navigating: {
    subscribe: vi.fn((run) => {
      run(null);
      return () => {};
    }),
  },
  updated: {
    subscribe: vi.fn((run) => {
      run(false);
      return () => {};
    }),
  },
}));

// Mock AdminPageLayout to a simple pass-through that renders children
vi.mock('$lib/components/layouts/AdminPageLayout.svelte', async () => {
  const { default: stub } = await import('@test-data/mocks/admin-page-layout.stub.svelte');
  return { default: stub };
});

// ---- helpers ----

const makeScanPerson = (
  over: Partial<{
    personId: string;
    ownerId: string;
    personName: string | null;
    faceCount: number;
    recommendation: 'confident' | 'review-first';
    reviewReasons: string[];
    flagged: number;
    flaggedFraction: number;
  }> = {},
) => ({
  personId: 'p1',
  ownerId: 'owner1',
  personName: null,
  faceCount: 50,
  thumbnailFaceId: null,
  eligible: 50,
  flagged: 30,
  flaggedFraction: 0.6,
  suspectedOwners: [
    {
      ownerPersonId: 'owner-person',
      ownerName: 'Alice',
      thumbnailFaceId: null,
      count: 30,
      ownerFaceCount: 30,
      ownerMissing: false,
    },
  ],
  recommendation: 'confident' as const,
  reviewReasons: [] as string[],
  ...over,
});

const makeTotals = () => ({
  eligibleFaces: 1000,
  flaggedFaces: 200,
  toRepair: 50,
  reviewOnlyFaces: 150,
  reviewOnlyPersons: 10,
  affectedPersons: 12,
  reviewOnlyByReason: { overCap: 5, badTarget: 3, unAttributable: 2 },
});

const makeCompletedScan = (persons = [makeScanPerson()]) => ({
  id: 'scan-1',
  status: 'completed' as const,
  progress: { scanned: 1000, total: 1000 },
  totals: makeTotals(),
  persons,
  error: null,
  startedAt: new Date().toISOString(),
  finishedAt: new Date().toISOString(),
  createdAt: new Date().toISOString(),
});

const flagged = (assetFaceId: string, suspectedOwnerId: string) => ({ assetFaceId, suspectedOwnerId });
const mockFlaggedFaces = (faces: { assetFaceId: string; suspectedOwnerId: string }[]) =>
  vi.mocked(getFaceRepairPersonFaces).mockResolvedValue({
    personId: 'x',
    flaggedFaces: faces,
  } as unknown as FaceRepairPersonFacesDto);

const makePageData = () => ({ users: [], meta: { title: 'Guided cleanup' } });

// Same cast rationale as [personId]/page.spec.ts: modalManager.show's return type depends on which component
// is passed, so a single concrete signature has to be asserted at this call site.
const showModal = modalManager.show as unknown as ReturnType<typeof vi.fn<(...args: unknown[]) => Promise<boolean>>>;

describe('+page.svelte (face cleanup)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    translations.length = 0;
    sessionStorage.clear();
    vi.useFakeTimers();
    vi.mocked(getLatestScan).mockResolvedValue(null as unknown as object);
    vi.mocked(triggerScan).mockResolvedValue({ scanId: 'new-scan' });
    vi.mocked(getFaceRepairPersonFaces).mockResolvedValue({
      personId: 'c1',
      flaggedFaces: [{ assetFaceId: 'f1', suspectedOwnerId: 'owner-person' }],
    } as unknown as FaceRepairPersonFacesDto);
    vi.mocked(resolveFaces).mockResolvedValue({
      moved: 1,
      declined: 0,
      locked: 0,
      detached: 0,
      unknown: 0,
      skipped: 0,
    });
    vi.mocked(declineFaceRepair).mockResolvedValue({ created: 1 });
    // Default: confirm the bulk-approve gate so the pre-existing tests below (written before F26 added the
    // confirmation) keep exercising what happens AFTER confirmation. Tests about the gate itself override this.
    showModal.mockResolvedValue(true);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    sessionStorage.clear();
  });

  // ---- empty states ----

  it('shows "no scan" empty state when no scan has run', async () => {
    vi.mocked(getLatestScan).mockResolvedValue(null as unknown as object);
    render(Page, { props: { data: makePageData() } });

    await waitFor(() => {
      expect(screen.getByText('admin.face_cleanup_empty_no_scan')).toBeInTheDocument();
    });
  });

  // An instance that has never scanned was told to "Re-scan", by a button in the opposite corner from the
  // sentence saying so. `scan === null` is the first-run signal, so the action must name itself for what it
  // is — and it reuses the chooser's own label, so the button an admin was just told to click is called the
  // same thing on both pages.
  it('calls the first-run action "run first scan", never "re-scan"', async () => {
    vi.mocked(getLatestScan).mockResolvedValue(null as unknown as object);
    render(Page, { props: { data: makePageData() } });

    await waitFor(() => {
      expect(screen.getByTestId('first-scan-cta')).toBeInTheDocument();
    });
    expect(screen.getAllByText('admin.face_cleanup_mode_run_first_scan').length).toBeGreaterThan(0);
    expect(screen.queryByText('admin.face_cleanup_rescan')).not.toBeInTheDocument();
  });

  // Once a scan exists the label flips back — otherwise this would just be renaming the button outright.
  it('still calls it "re-scan" once a scan exists', async () => {
    vi.mocked(getLatestScan).mockResolvedValue(makeCompletedScan([]) as unknown as object);
    render(Page, { props: { data: makePageData() } });

    await waitFor(() => {
      expect(screen.getByText('admin.face_cleanup_rescan')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('first-scan-cta')).not.toBeInTheDocument();
  });

  it('shows "nothing to clean up" when completed scan has 0 flagged persons', async () => {
    vi.mocked(getLatestScan).mockResolvedValue(makeCompletedScan([]) as unknown as object);
    render(Page, { props: { data: makePageData() } });

    await waitFor(() => {
      expect(screen.getByText('admin.face_cleanup_empty_clean')).toBeInTheDocument();
    });
  });

  // ---- scan states ----

  it('shows progress when scan is running', async () => {
    vi.mocked(getLatestScan).mockResolvedValue({
      id: 'scan-1',
      status: 'running',
      progress: { scanned: 400, total: 1000 },
      totals: null,
      persons: [],
      error: null,
      startedAt: new Date().toISOString(),
      finishedAt: null,
      createdAt: new Date().toISOString(),
    } as unknown as object);

    render(Page, { props: { data: makePageData() } });

    // Flush microtasks from onMount (the getLatestScan promise)
    await vi.advanceTimersByTimeAsync(0);

    expect(screen.getByText('admin.face_cleanup_scan_running')).toBeInTheDocument();
    // Progress numbers are shown; use a regex match to be locale-flexible
    expect(screen.getByText(/400/)).toBeInTheDocument();
  });

  it('polls while scan is running and stops when completed', async () => {
    const runningScan = {
      id: 'scan-1',
      status: 'running',
      progress: { scanned: 500, total: 1000 },
      totals: null,
      persons: [],
      error: null,
      startedAt: new Date().toISOString(),
      finishedAt: null,
      createdAt: new Date().toISOString(),
    };
    const completedScan = makeCompletedScan([makeScanPerson()]);
    vi.mocked(getLatestScan)
      .mockResolvedValueOnce(runningScan as unknown as object)
      .mockResolvedValueOnce(runningScan as unknown as object)
      .mockResolvedValue(completedScan as unknown as object);

    render(Page, { props: { data: makePageData() } });

    // Initial load shows running
    await waitFor(() => {
      expect(screen.getByText('admin.face_cleanup_scan_running')).toBeInTheDocument();
    });

    // Advance timer to trigger polls. First poll fires at +2000ms (POLL_MIN_MS) and still reports running,
    // which grows the backoff to round(2000*1.5) = 3000ms — so the SECOND poll (the one that finally sees
    // the completed scan) fires at +5000ms total, not +4000ms.
    await vi.advanceTimersByTimeAsync(2000);
    await vi.advanceTimersByTimeAsync(3000);

    // Positive control: polling DID run (initial load + two polls, the second of which returned the
    // completed scan) before it stopped.
    const callsAtCompletion = vi.mocked(getLatestScan).mock.calls.length;
    expect(callsAtCompletion).toBe(3);

    // The real assertion: once the scan is no longer active, the self-rescheduling poll must not schedule
    // itself again. Advance well past POLL_MAX_MS (15000ms) — if stopPolling() were skipped on this branch,
    // the backoff-capped loop would still be firing and this would pick up more calls.
    await vi.advanceTimersByTimeAsync(20_000);
    expect(vi.mocked(getLatestScan).mock.calls.length).toBe(callsAtCompletion);
  });

  // S11.13/F27: stopPolling() only clears the pending setTimeout — a fetchLatestScan() call that had ALREADY
  // fired and is awaiting its network response is untouched by that clearTimeout, and its `.then` unconditionally
  // re-arms the next poll. Unmounting mid-flight therefore used to leave polling running forever after the page
  // was gone.
  it('S11.13/F27: stops polling for good on unmount, even when a fetch was already in flight', async () => {
    const runningScan = {
      id: 'scan-1',
      status: 'running',
      progress: { scanned: 500, total: 1000 },
      totals: null,
      persons: [],
      error: null,
      startedAt: new Date().toISOString(),
      finishedAt: null,
      createdAt: new Date().toISOString(),
    };
    let resolveInFlight!: (value: object) => void;
    vi.mocked(getLatestScan)
      .mockResolvedValueOnce(runningScan as unknown as object) // initial load
      .mockImplementationOnce(
        () =>
          new Promise<object>((resolve) => {
            resolveInFlight = resolve;
          }),
      ); // first poll — deliberately left unsettled to simulate "in flight at unmount"

    const { unmount } = render(Page, { props: { data: makePageData() } });
    await waitFor(() => expect(screen.getByText('admin.face_cleanup_scan_running')).toBeInTheDocument());

    // Fire the first poll's setTimeout — its fetchLatestScan() call is now in flight (the mock above never
    // resolves on its own).
    await vi.advanceTimersByTimeAsync(2000);
    await waitFor(() => expect(vi.mocked(getLatestScan).mock.calls.length).toBe(2));

    unmount();
    const callsAtUnmount = vi.mocked(getLatestScan).mock.calls.length;

    // Only NOW does the in-flight call settle — its `.then` is exactly where the old code unconditionally
    // re-armed the next poll.
    resolveInFlight(runningScan);
    await vi.advanceTimersByTimeAsync(0);

    // Advance well past several poll intervals: a re-armed timer would have fired again by now.
    await vi.advanceTimersByTimeAsync(60_000);
    expect(vi.mocked(getLatestScan).mock.calls.length).toBe(callsAtUnmount);
  });

  it('shows error state when scan failed', async () => {
    vi.mocked(getLatestScan).mockResolvedValue({
      id: 'scan-1',
      status: 'failed',
      progress: null,
      totals: null,
      persons: [],
      error: 'Some error occurred',
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    } as unknown as object);

    render(Page, { props: { data: makePageData() } });

    await waitFor(() => {
      expect(screen.getByText('admin.face_cleanup_scan_failed')).toBeInTheDocument();
      expect(screen.getByText('Some error occurred')).toBeInTheDocument();
      expect(screen.getByText('admin.face_cleanup_retry_scan')).toBeInTheDocument();
    });
  });

  // ---- two-lane layout ----

  it('renders the confident lane and the review lane after a scan with both kinds', async () => {
    const persons = [
      makeScanPerson({ personId: 'c1', recommendation: 'confident' }),
      makeScanPerson({ personId: 'r1', recommendation: 'review-first', reviewReasons: ['large-cluster'] }),
    ];
    vi.mocked(getLatestScan).mockResolvedValue(makeCompletedScan(persons) as unknown as object);

    render(Page, { props: { data: makePageData() } });

    await waitFor(() => expect(screen.getByTestId('confident-lane')).toBeInTheDocument());
    expect(screen.getByTestId('review-lane')).toBeInTheDocument();
    // The whole review row is the link to the per-cluster review page.
    expect(screen.getByTestId('review-row-r1')).toHaveAttribute('href', Route.viewFaceCleanupPerson({ id: 'r1' }));
  });

  // ---- confident bulk approve ----

  it('Approve all re-attributes every confident cluster, grouping flagged faces by suspectedOwnerId', async () => {
    const persons = [
      makeScanPerson({ personId: 'c1', recommendation: 'confident' }),
      makeScanPerson({ personId: 'c2', recommendation: 'confident', ownerId: 'owner2' }),
    ];
    vi.mocked(getLatestScan).mockResolvedValue(makeCompletedScan(persons) as unknown as object);
    mockFlaggedFaces([flagged('a1', 'own1'), flagged('a2', 'own2'), flagged('a3', 'own1')]);

    render(Page, { props: { data: makePageData() } });
    await waitFor(() => expect(screen.getByTestId('confident-approve')).toBeInTheDocument());
    await fireEvent.click(screen.getByTestId('confident-approve'));

    await waitFor(() => expect(resolveFaces).toHaveBeenCalledTimes(2));
    expect(resolveFaces).toHaveBeenCalledWith({
      faceRepairResolveRequestDto: {
        personId: 'c1',
        moveToPerson: [
          { destinationPersonId: 'own1', faceIds: ['a1', 'a3'] },
          { destinationPersonId: 'own2', faceIds: ['a2'] },
        ],
      },
    });
  });

  it('Approve all skips a confident cluster with zero flagged faces (no resolveFaces call, no error)', async () => {
    const persons = [makeScanPerson({ personId: 'c1', recommendation: 'confident' })];
    vi.mocked(getLatestScan).mockResolvedValue(makeCompletedScan(persons) as unknown as object);
    mockFlaggedFaces([]);

    render(Page, { props: { data: makePageData() } });
    await waitFor(() => expect(screen.getByTestId('confident-approve')).toBeInTheDocument());
    await fireEvent.click(screen.getByTestId('confident-approve'));

    await waitFor(() => expect(getFaceRepairPersonFaces).toHaveBeenCalledWith({ personId: 'c1' }));
    expect(resolveFaces).not.toHaveBeenCalled();
  });

  it('excluding a confident cluster in the spot-check drops it from the approve batch', async () => {
    const persons = [
      makeScanPerson({ personId: 'c1', recommendation: 'confident' }),
      makeScanPerson({ personId: 'c2', recommendation: 'confident', ownerId: 'owner2' }),
    ];
    vi.mocked(getLatestScan).mockResolvedValue(makeCompletedScan(persons) as unknown as object);
    mockFlaggedFaces([flagged('a1', 'own1')]);

    render(Page, { props: { data: makePageData() } });
    await waitFor(() => expect(screen.getByTestId('confident-toggle')).toBeInTheDocument());
    await fireEvent.click(screen.getByTestId('confident-toggle'));
    await fireEvent.click(screen.getByTestId('confident-exclude-c1'));
    await fireEvent.click(screen.getByTestId('confident-approve'));

    await waitFor(() => expect(resolveFaces).toHaveBeenCalledTimes(1));
    expect(resolveFaces).toHaveBeenCalledWith(
      expect.objectContaining({ faceRepairResolveRequestDto: expect.objectContaining({ personId: 'c2' }) }),
    );
  });

  // ---- persisted exclusions across a chip click-through remount (final-review finding) ----

  it('persists a confident-lane exclusion across a remount for the same scan id', async () => {
    const persons = [
      makeScanPerson({ personId: 'c1', recommendation: 'confident' }),
      makeScanPerson({ personId: 'c2', recommendation: 'confident', ownerId: 'owner2' }),
    ];
    vi.mocked(getLatestScan).mockResolvedValue(makeCompletedScan(persons) as unknown as object);

    const { unmount } = render(Page, { props: { data: makePageData() } });
    await waitFor(() => expect(screen.getByTestId('confident-toggle')).toBeInTheDocument());
    await fireEvent.click(screen.getByTestId('confident-toggle'));
    await fireEvent.click(screen.getByTestId('confident-exclude-c1'));

    await waitFor(() => expect(screen.getByTestId('confident-approve')).toHaveTextContent('1'));
    unmount();

    // Simulates navigating to the per-cluster review page and clicking back: the scan page remounts and
    // refetches the same completed scan (same id), so the exclusion must survive.
    render(Page, { props: { data: makePageData() } });
    await waitFor(() => expect(screen.getByTestId('confident-toggle')).toBeInTheDocument());
    await fireEvent.click(screen.getByTestId('confident-toggle'));

    await waitFor(() => expect(screen.getByTestId('confident-exclude-c1')).toHaveAttribute('aria-pressed', 'true'));
    expect(screen.getByTestId('confident-approve')).toHaveTextContent('1');
  });

  it('a different scan id starts clean (does not inherit exclusions stored for a previous scan)', async () => {
    sessionStorage.setItem('face-cleanup-scan-exclusions:scan-old', JSON.stringify(['c1']));
    const persons = [
      makeScanPerson({ personId: 'c1', recommendation: 'confident' }),
      makeScanPerson({ personId: 'c2', recommendation: 'confident', ownerId: 'owner2' }),
    ];
    const scan = { ...makeCompletedScan(persons), id: 'scan-new' };
    vi.mocked(getLatestScan).mockResolvedValue(scan as unknown as object);

    render(Page, { props: { data: makePageData() } });
    await waitFor(() => expect(screen.getByTestId('confident-toggle')).toBeInTheDocument());
    await fireEvent.click(screen.getByTestId('confident-toggle'));

    await waitFor(() => expect(screen.getByTestId('confident-exclude-c1')).toHaveAttribute('aria-pressed', 'false'));
    expect(screen.getByTestId('confident-approve')).toHaveTextContent('2');
  });

  it('ignores a malformed stored exclusions value and renders with nothing excluded', async () => {
    sessionStorage.setItem('face-cleanup-scan-exclusions:scan-1', 'not-json');
    const persons = [makeScanPerson({ personId: 'c1', recommendation: 'confident' })];
    vi.mocked(getLatestScan).mockResolvedValue(makeCompletedScan(persons) as unknown as object);

    render(Page, { props: { data: makePageData() } });
    await waitFor(() => expect(screen.getByTestId('confident-toggle')).toBeInTheDocument());
    await fireEvent.click(screen.getByTestId('confident-toggle'));

    await waitFor(() => expect(screen.getByTestId('confident-exclude-c1')).toHaveAttribute('aria-pressed', 'false'));
    expect(screen.getByTestId('confident-approve')).toHaveTextContent('1');
  });

  it('Approve all 409 shows a non-destructive error and keeps the lanes', async () => {
    const persons = [makeScanPerson({ personId: 'c1', recommendation: 'confident' })];
    vi.mocked(getLatestScan).mockResolvedValue(makeCompletedScan(persons) as unknown as object);
    mockFlaggedFaces([flagged('a1', 'own1')]);
    vi.mocked(resolveFaces).mockRejectedValue({ status: 409 });

    render(Page, { props: { data: makePageData() } });
    await waitFor(() => expect(screen.getByTestId('confident-approve')).toBeInTheDocument());
    await fireEvent.click(screen.getByTestId('confident-approve'));

    await waitFor(() => expect(screen.getByText('admin.face_cleanup_apply_conflict')).toBeInTheDocument());
    expect(screen.getByTestId('confident-lane')).toBeInTheDocument();
  });

  // S11.12/F26: Promise.all used to reject on the FIRST failure, so a genuine partial success (2 of 3 applied)
  // was reported as a blanket failure. Promise.allSettled lets every call finish, and the banner now says
  // exactly what happened instead of hiding the clusters that DID apply.
  it('S11.12/F26: refetches the scan and reports "N applied, M failed" (listing the failure) on a partial failure', async () => {
    const persons = [
      makeScanPerson({ personId: 'c1', recommendation: 'confident' }),
      makeScanPerson({ personId: 'c2', recommendation: 'confident', ownerId: 'owner2' }),
    ];
    vi.mocked(getLatestScan).mockResolvedValue(makeCompletedScan(persons) as unknown as object);
    mockFlaggedFaces([flagged('a1', 'own1')]);
    vi.mocked(resolveFaces)
      .mockRejectedValueOnce({ status: 500 })
      .mockResolvedValue({ moved: 1, declined: 0, locked: 0, detached: 0, unknown: 0, skipped: 0 });

    render(Page, { props: { data: makePageData() } });
    await waitFor(() => expect(screen.getByTestId('confident-approve')).toBeInTheDocument());
    const before = vi.mocked(getLatestScan).mock.calls.length;
    await fireEvent.click(screen.getByTestId('confident-approve'));

    // handleApprove's finally refetches even after a partial failure.
    await waitFor(() => expect(vi.mocked(getLatestScan).mock.calls.length).toBeGreaterThan(before));
    // Both calls actually ran (allSettled, not all-or-nothing) — c2 applied despite c1 rejecting.
    expect(resolveFaces).toHaveBeenCalledTimes(2);
    await waitFor(() =>
      expect(
        translations.some(
          (t) =>
            t.key === 'admin.face_cleanup_confident_approve_partial' &&
            t.values?.applied === 1 &&
            t.values?.failed === 1 &&
            t.values?.names === 'c1',
        ),
      ).toBe(true),
    );
  });

  // ---- F26: a real confirmation before bulk-approving, and an honest partial-failure report ----
  describe('Bulk approve confirmation (F26)', () => {
    it('S11.11: shows a confirm naming the cluster count; cancelling issues zero resolveFaces calls', async () => {
      const persons = [
        makeScanPerson({ personId: 'c1', recommendation: 'confident' }),
        makeScanPerson({ personId: 'c2', recommendation: 'confident', ownerId: 'owner2' }),
        makeScanPerson({ personId: 'c3', recommendation: 'confident', ownerId: 'owner3' }),
      ];
      vi.mocked(getLatestScan).mockResolvedValue(makeCompletedScan(persons) as unknown as object);
      showModal.mockResolvedValueOnce(false); // decline

      render(Page, { props: { data: makePageData() } });
      await waitFor(() => expect(screen.getByTestId('confident-approve')).toBeInTheDocument());
      await fireEvent.click(screen.getByTestId('confident-approve'));

      await waitFor(() =>
        expect(showModal).toHaveBeenCalledWith(
          ConfirmModal,
          expect.objectContaining({
            title: 'admin.face_cleanup_confident_approve_confirm_title',
            prompt: 'admin.face_cleanup_confident_approve_confirm_body',
            confirmText: 'admin.face_cleanup_confident_approve_confirm_cta',
          }),
        ),
      );
      // Names the cluster count (3) in the prompt/CTA interpolation.
      expect(
        translations.some(
          (t) => t.key === 'admin.face_cleanup_confident_approve_confirm_body' && t.values?.count === 3,
        ),
      ).toBe(true);
      expect(resolveFaces).not.toHaveBeenCalled();
      expect(getFaceRepairPersonFaces).not.toHaveBeenCalled();
    });

    it('confirming proceeds with the approve batch exactly as before', async () => {
      const persons = [makeScanPerson({ personId: 'c1', recommendation: 'confident' })];
      vi.mocked(getLatestScan).mockResolvedValue(makeCompletedScan(persons) as unknown as object);
      mockFlaggedFaces([flagged('a1', 'own1')]);
      showModal.mockResolvedValueOnce(true);

      render(Page, { props: { data: makePageData() } });
      await waitFor(() => expect(screen.getByTestId('confident-approve')).toBeInTheDocument());
      await fireEvent.click(screen.getByTestId('confident-approve'));

      await waitFor(() => expect(resolveFaces).toHaveBeenCalledTimes(1));
    });
  });

  // ---- re-scan ----

  // Seeded with a COMPLETED scan, not null: "Re-scan" only exists once there is a scan to repeat. This test
  // used to mock `getLatestScan` to null while asserting the re-scan label — the very state that made the
  // button's wording wrong for a first-time admin.
  it('clicking Re-scan calls triggerScan and starts polling', async () => {
    vi.mocked(getLatestScan).mockResolvedValue(makeCompletedScan([]) as unknown as object);
    vi.mocked(triggerScan).mockResolvedValue({ scanId: 'new-scan-id' });

    render(Page, { props: { data: makePageData() } });

    await waitFor(() => {
      expect(screen.getByText('admin.face_cleanup_rescan')).toBeInTheDocument();
    });

    const rescanBtn = screen.getByText('admin.face_cleanup_rescan');
    await fireEvent.click(rescanBtn);

    await waitFor(() => {
      expect(triggerScan).toHaveBeenCalled();
    });
  });

  it('triggers the scan from the first-run empty state itself, not only the toolbar', async () => {
    vi.mocked(getLatestScan).mockResolvedValue(null as unknown as object);
    vi.mocked(triggerScan).mockResolvedValue({ scanId: 'new-scan-id' });

    render(Page, { props: { data: makePageData() } });

    await fireEvent.click(await screen.findByTestId('first-scan-cta'));

    await waitFor(() => {
      expect(triggerScan).toHaveBeenCalled();
    });
  });

  // ---- dismiss (P2, E11) ----

  it('Dismiss on a review row reflects the server-removed person after a refetch, not just a client filter', async () => {
    const persons = [makeScanPerson({ personId: 'r1', recommendation: 'review-first', reviewReasons: ['named'] })];
    // The server drains the dismissed person from the latest scan (M9 medium test); the SECOND getLatestScan
    // (the post-dismiss refetch this page must trigger) returns a snapshot that already omits it.
    vi.mocked(getLatestScan)
      .mockResolvedValueOnce(makeCompletedScan(persons) as unknown as object)
      .mockResolvedValueOnce(makeCompletedScan([]) as unknown as object);
    vi.mocked(declineFaceRepair).mockResolvedValue({ created: 1 });
    vi.stubGlobal('confirm', () => true);

    render(Page, { props: { data: makePageData() } });

    await waitFor(() => expect(screen.getByTestId('review-dismiss-r1')).toBeInTheDocument());
    await fireEvent.click(screen.getByTestId('review-dismiss-r1'));

    await waitFor(() => {
      expect(declineFaceRepair).toHaveBeenCalledWith({
        faceRepairDeclineRequestDto: { persons: [{ personId: 'r1', suspectedOwnerIds: ['owner-person'] }] },
      });
    });

    await waitFor(() => {
      expect(getLatestScan).toHaveBeenCalledTimes(2);
      expect(screen.getByText('admin.face_cleanup_empty_clean')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('review-dismiss-r1')).not.toBeInTheDocument();
  });

  // ---- D17: a failed INITIAL load must not render as the reassuring "no scan yet" empty state ----

  it('shows a load-error state (not the empty state) when the initial scan fetch fails, and Retry re-fetches', async () => {
    vi.mocked(getLatestScan).mockRejectedValueOnce(new Error('network down'));

    render(Page, { props: { data: makePageData() } });

    await waitFor(() => {
      expect(screen.getByTestId('load-error-banner')).toBeInTheDocument();
    });
    expect(screen.queryByText('admin.face_cleanup_empty_no_scan')).not.toBeInTheDocument();

    vi.mocked(getLatestScan).mockResolvedValueOnce(null as unknown as object);
    await fireEvent.click(screen.getByTestId('load-error-retry'));

    await waitFor(() => {
      expect(screen.getByText('admin.face_cleanup_empty_no_scan')).toBeInTheDocument();
      expect(screen.queryByTestId('load-error-banner')).not.toBeInTheDocument();
    });
  });

  it('does NOT show the load-error state for a transient poll failure once the initial load succeeded', async () => {
    const runningScan = {
      id: 'scan-1',
      status: 'running',
      progress: { scanned: 500, total: 1000 },
      totals: null,
      persons: [],
      error: null,
      startedAt: new Date().toISOString(),
      finishedAt: null,
      createdAt: new Date().toISOString(),
    };
    vi.mocked(getLatestScan)
      .mockResolvedValueOnce(runningScan as unknown as object) // initial load: succeeds
      .mockRejectedValueOnce(new Error('blip')); // first poll: transient failure

    render(Page, { props: { data: makePageData() } });

    await waitFor(() => expect(screen.getByText('admin.face_cleanup_scan_running')).toBeInTheDocument());

    await vi.advanceTimersByTimeAsync(2000);

    await waitFor(() => expect(getLatestScan).toHaveBeenCalledTimes(2));
    // Still showing the running-scan state, not a load-error banner, despite the poll blip.
    expect(screen.getByText('admin.face_cleanup_scan_running')).toBeInTheDocument();
    expect(screen.queryByTestId('load-error-banner')).not.toBeInTheDocument();
  });

  it('renders a breadcrumb trail back to the face cleanup landing page', () => {
    render(Page, { props: { data: makePageData() } });

    const trail = within(screen.getByTestId('breadcrumbs'));

    // The whole trail, in order — not merely "a link exists somewhere". A partial assertion would pass with
    // the guided level missing, which is half of what this change fixes.
    const root = trail.getByRole('link', { name: 'admin.face_cleanup' });
    expect(root).toHaveAttribute('href', Route.faceCleanup());

    expect(trail.getByText('admin.face_cleanup_mode_guided')).toBeInTheDocument();
    expect(trail.getAllByRole('link')).toHaveLength(1); // the leaf is not a link
  });
});
