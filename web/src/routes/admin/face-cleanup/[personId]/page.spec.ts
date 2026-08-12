import {
  getFaceRepairClusterFaces,
  getFaceRepairPersonFaces,
  getLatestScan,
  resolveFaces,
  type FaceRepairClusterFacesResponseDto,
  type FaceRepairPersonFacesDto,
} from '@immich/sdk';
import { ConfirmModal, modalManager, toastManager } from '@immich/ui';
import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { goto } from '$app/navigation';
import FaceActionsHelpModal from '$lib/components/face-cleanup/FaceActionsHelpModal.svelte';
import { Route } from '$lib/route';
import Page from './+page.svelte';
import type { SuspectedOwner } from './destination';

// Mock @immich/sdk before any imports that use it
vi.mock('@immich/sdk', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@immich/sdk')>();
  return {
    ...actual,
    getLatestScan: vi.fn(),
    resolveFaces: vi.fn(),
    getFaceRepairPersonFaces: vi.fn(),
    getFaceRepairClusterFaces: vi.fn(),
    getPeopleThumbnailPath: (id: string) => `/people/${id}/thumbnail`,
    // `getServerErrorMessage` gates on `isHttpError`, whose real implementation is an `instanceof HttpError`
    // check against a class the web package cannot import (it is a transitive dep of the SDK). Same marker
    // stand-in the other web specs that exercise server-error text use.
    isHttpError: (error: unknown) => !!(error as { __http?: boolean })?.__http,
  };
});

// An API failure shaped the way the server actually returns one, tagged for the `isHttpError` stand-in above.
const httpError = (status: number, data: Record<string, unknown>) =>
  Object.assign(new Error(`HTTP ${status}`), { __http: true, status, data });

vi.mock('@immich/ui', async (original) => {
  const mod = await original<typeof import('@immich/ui')>();
  const noop = await import('@test-data/mocks/noop-component.svelte');
  return {
    ...mod,
    Icon: noop.default,
    toastManager: {
      primary: vi.fn(),
      success: vi.fn(),
      danger: vi.fn(),
    },
    IconButton: mod.Button,
    // The person-picker modal itself is covered end-to-end by PersonPicker.spec.ts; here we only need to
    // verify the bulk action opens it with the right props and routes back whatever it resolves with.
    modalManager: { show: vi.fn() },
  };
});

// Every (key, options) pair the page asked to translate, so a test can assert which STRING was chosen and what
// was interpolated into it — the difference between "shows a translated reason" and "echoes English server text"
// is invisible otherwise, since the mock below renders keys verbatim.
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

// The reason interpolated into the apply banner, or undefined if the banner was never rendered.
const bannerReason = () =>
  translations.findLast((entry) => entry.key === 'admin.face_cleanup_review_apply_error_reason')?.values?.reason;

// Mock $app/navigation
vi.mock('$app/navigation', () => ({
  goto: vi.fn(),
  afterNavigate: vi.fn(),
  beforeNavigate: vi.fn(),
  onNavigate: vi.fn(),
}));

// Mock $app/stores
vi.mock('$app/stores', () => ({
  page: {
    subscribe: vi.fn((run) => {
      run({ url: new URL('http://localhost/admin/face-cleanup/person-1') });
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

// Mock people-utils thumbnail helper
vi.mock('$lib/utils/people-utils', () => ({
  getAdminFaceThumbnailUrl: (assetFaceId: string) => `/api/admin/face-repair/faces/${assetFaceId}/thumbnail`,
  getSpacePersonFaceThumbnailUrl: vi.fn(),
}));

// ---- helpers ----

const PERSON_ID = 'person-1';
const OWNER_A_ID = 'owner-a';
const OWNER_B_ID = 'owner-b';

// A mixed cluster: two faces suspect owner A, one suspects owner B (E14) — exercises the per-face grouping
// (W1) all the way through the rendered page and into the resolveFaces call (P4).
const makeFlaggedFaces = () => [
  { assetFaceId: 'face-1', suspectedOwnerId: OWNER_A_ID },
  { assetFaceId: 'face-2', suspectedOwnerId: OWNER_A_ID },
  { assetFaceId: 'face-3', suspectedOwnerId: OWNER_B_ID },
];

const makeScanPerson = (
  over: Partial<{
    personId: string;
    personName: string | null;
    faceCount: number;
    suspectedOwners: SuspectedOwner[];
  }> = {},
) => ({
  personId: PERSON_ID,
  ownerId: 'owner-user-1',
  personName: 'Jula',
  faceCount: 10,
  thumbnailFaceId: null,
  eligible: 10,
  flagged: 3,
  flaggedFraction: 0.3,
  suspectedOwners: [
    {
      ownerPersonId: OWNER_A_ID,
      ownerName: 'Armin',
      thumbnailFaceId: 'thumb-a',
      count: 2,
      ownerFaceCount: 1204,
      ownerMissing: false,
    },
    {
      ownerPersonId: OWNER_B_ID,
      ownerName: 'Berta',
      thumbnailFaceId: null,
      count: 1,
      ownerFaceCount: 88,
      ownerMissing: false,
    },
  ],
  recommendation: 'confident' as const,
  reviewReasons: [] as string[],
  ...over,
});

const makeCompletedScan = (persons = [makeScanPerson()]) => ({
  id: 'scan-1',
  status: 'completed' as const,
  progress: { scanned: 100, total: 100 },
  totals: null,
  persons,
  error: null,
  startedAt: new Date().toISOString(),
  finishedAt: new Date().toISOString(),
  createdAt: new Date().toISOString(),
});

const makePageData = (personId = PERSON_ID) => ({
  personId,
  meta: { title: 'Review person' },
});

const emptyRest = () => ({ faces: [], total: 0, hasMore: false }) as unknown as FaceRepairClusterFacesResponseDto;

// `modalManager.show` is a generic overloaded method (its return type depends on the component passed in),
// so `vi.mocked(modalManager.show)` can't infer a concrete signature at this call site. Cast once to a plain
// mock of the shape the picker's `onClose` actually resolves with (see PersonPicker.svelte). The union also
// covers ConfirmModal (a boolean), the other modal this page opens through the same mock.
const showModal = modalManager.show as unknown as ReturnType<
  typeof vi.fn<
    (...args: unknown[]) => Promise<boolean | { personId: string; name: string; lock?: boolean } | undefined>
  >
>;

describe('+page.svelte (face-cleanup review — Model B)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    translations.length = 0;
    vi.mocked(getLatestScan).mockResolvedValue(makeCompletedScan() as unknown as object);
    vi.mocked(getFaceRepairPersonFaces).mockResolvedValue({
      personId: PERSON_ID,
      flaggedFaces: makeFlaggedFaces(),
    } as unknown as FaceRepairPersonFacesDto);
    vi.mocked(resolveFaces).mockResolvedValue({
      moved: 0,
      declined: 0,
      locked: 0,
      detached: 0,
      unknown: 0,
      skipped: 0,
    });
    vi.mocked(getFaceRepairClusterFaces).mockResolvedValue(emptyRest());
    showModal.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders one flagged-grid tile per flagged face, defaulting to the owner state', async () => {
    render(Page, { props: { data: makePageData() } });

    await waitFor(() => {
      expect(screen.getByTestId('flagged-grid')).toBeInTheDocument();
      const tiles = screen.getAllByTestId('face-tile');
      expect(tiles).toHaveLength(3);
      for (const tile of tiles) {
        expect(tile).toHaveAttribute('data-state', 'owner');
      }
    });
  });

  // ---- P1: selection — click toggle, shift-click range, select-all, clear ----

  describe('P1 selection', () => {
    it('click toggles a single tile selected, and toggling again deselects it', async () => {
      render(Page, { props: { data: makePageData() } });
      await waitFor(() => expect(screen.getAllByTestId('face-tile')).toHaveLength(3));

      const tiles = screen.getAllByTestId('face-tile');
      await fireEvent.click(tiles[0]);
      await waitFor(() => expect(screen.getByTestId('face-bulk-bar')).toBeInTheDocument());

      await fireEvent.click(tiles[0]);
      await waitFor(() => expect(screen.queryByTestId('face-bulk-bar')).not.toBeInTheDocument());
    });

    it('shift-click selects the whole range between the last click and this one', async () => {
      render(Page, { props: { data: makePageData() } });
      await waitFor(() => expect(screen.getAllByTestId('face-tile')).toHaveLength(3));

      const tiles = screen.getAllByTestId('face-tile');
      await fireEvent.click(tiles[0]);
      await fireEvent.click(tiles[2], { shiftKey: true });

      await waitFor(() => {
        expect(screen.getByTestId('face-bulk-bar')).toHaveTextContent('3');
      });
    });

    it('Select all selects every tile', async () => {
      render(Page, { props: { data: makePageData() } });
      await waitFor(() => expect(screen.getAllByTestId('face-tile')).toHaveLength(3));

      await fireEvent.click(screen.getByTestId('select-all'));

      await waitFor(() => {
        expect(screen.getByTestId('face-bulk-bar')).toHaveTextContent('3');
      });
    });

    it('Clear empties the selection and swaps the dock back to the summary', async () => {
      render(Page, { props: { data: makePageData() } });
      await waitFor(() => expect(screen.getAllByTestId('face-tile')).toHaveLength(3));

      await fireEvent.click(screen.getByTestId('select-all'));
      await waitFor(() => expect(screen.getByTestId('face-bulk-bar')).toBeInTheDocument());

      await fireEvent.click(screen.getByTestId('face-bulk-clear'));

      await waitFor(() => {
        expect(screen.queryByTestId('face-bulk-bar')).not.toBeInTheDocument();
        expect(screen.getByTestId('tally')).toBeInTheDocument();
      });
    });

    it('Reset returns every tile to the owner state and clears the selection', async () => {
      render(Page, { props: { data: makePageData() } });
      await waitFor(() => expect(screen.getAllByTestId('face-tile')).toHaveLength(3));

      await fireEvent.click(screen.getByTestId('select-all'));
      await waitFor(() => expect(screen.getByTestId('face-bulk-bar')).toBeInTheDocument());

      await fireEvent.click(screen.getByTestId('reset'));

      await waitFor(() => {
        expect(screen.queryByTestId('face-bulk-bar')).not.toBeInTheDocument();
        for (const tile of screen.getAllByTestId('face-tile')) {
          expect(tile).toHaveAttribute('data-state', 'owner');
        }
      });
    });
  });

  // ---- P2: dock swaps summary ↔ bulk bar on selection count ----

  describe('P2 dock swap', () => {
    it('shows the summary (tally + apply-btn) when nothing is selected', async () => {
      render(Page, { props: { data: makePageData() } });

      await waitFor(() => {
        expect(screen.getByTestId('face-dock')).toBeInTheDocument();
        expect(screen.getByTestId('tally')).toBeInTheDocument();
        expect(screen.getByTestId('apply-btn')).toBeInTheDocument();
        expect(screen.queryByTestId('face-bulk-bar')).not.toBeInTheDocument();
      });
    });

    it('swaps to the bulk bar once at least one tile is selected, hiding the summary', async () => {
      render(Page, { props: { data: makePageData() } });
      await waitFor(() => expect(screen.getAllByTestId('face-tile')).toHaveLength(3));

      await fireEvent.click(screen.getAllByTestId('face-tile')[0]);

      await waitFor(() => {
        expect(screen.getByTestId('face-bulk-bar')).toBeInTheDocument();
        expect(screen.queryByTestId('apply-btn')).not.toBeInTheDocument();
      });
    });

    it('swaps back to the summary once the selection is cleared', async () => {
      render(Page, { props: { data: makePageData() } });
      await waitFor(() => expect(screen.getAllByTestId('face-tile')).toHaveLength(3));

      await fireEvent.click(screen.getAllByTestId('face-tile')[0]);
      await waitFor(() => expect(screen.getByTestId('face-bulk-bar')).toBeInTheDocument());

      await fireEvent.click(screen.getByTestId('face-bulk-clear'));

      await waitFor(() => {
        expect(screen.getByTestId('apply-btn')).toBeInTheDocument();
        expect(screen.queryByTestId('face-bulk-bar')).not.toBeInTheDocument();
      });
    });
  });

  // ---- P4: Apply posts { faceRepairResolveRequestDto } matching on-screen state ----

  describe('P4 Apply', () => {
    it('posts resolveFaces with every flagged face grouped by its own suspected owner (default, untouched state)', async () => {
      render(Page, { props: { data: makePageData() } });
      await waitFor(() => expect(screen.getAllByTestId('face-tile')).toHaveLength(3));

      await fireEvent.click(screen.getByTestId('apply-btn'));

      await waitFor(() => {
        expect(resolveFaces).toHaveBeenCalledWith({
          faceRepairResolveRequestDto: {
            personId: PERSON_ID,
            // owner-state groups never auto-lock (Slice 3, move-and-lock).
            moveToPerson: [
              { destinationPersonId: OWNER_A_ID, faceIds: ['face-1', 'face-2'], lock: false },
              { destinationPersonId: OWNER_B_ID, faceIds: ['face-3'], lock: false },
            ],
            stay: [],
            lock: [],
            detach: [],
            unknown: [],
          },
        });
      });
    });

    it('never calls resolveFaces with an undefined body', async () => {
      render(Page, { props: { data: makePageData() } });
      await waitFor(() => expect(screen.getAllByTestId('face-tile')).toHaveLength(3));

      await fireEvent.click(screen.getByTestId('apply-btn'));

      await waitFor(() => expect(resolveFaces).toHaveBeenCalledTimes(1));
      const [arg] = vi.mocked(resolveFaces).mock.calls[0];
      expect(arg).toBeDefined();
      expect(arg.faceRepairResolveRequestDto).toBeDefined();
    });

    // Regression guard for the onMount-awaits-rejected-promise anti-pattern (advanced-scan notes): the
    // rejection is only produced once the test explicitly triggers it, well after the click — never as an
    // immediately-rejected promise handed to a fire-and-forget onMount await.
    it('shows a conflict message on 409 without navigating away, preserving on-screen state', async () => {
      let rejectApply!: () => void;
      vi.mocked(resolveFaces).mockReturnValueOnce(
        new Promise((_, reject) => {
          rejectApply = () => reject(Object.assign(new Error('conflict'), { status: 409 }));
        }),
      );

      render(Page, { props: { data: makePageData() } });
      await waitFor(() => expect(screen.getAllByTestId('face-tile')).toHaveLength(3));

      const applyBtn = screen.getByTestId('apply-btn');
      await fireEvent.click(applyBtn);
      expect(applyBtn).toBeDisabled();

      rejectApply();

      await waitFor(() => {
        expect(screen.getByText('admin.face_cleanup_review_apply_conflict')).toBeInTheDocument();
      });
      expect(screen.getAllByTestId('face-tile')).toHaveLength(3);
    });

    // Every non-409 failure used to collapse into one reason-less sentence, so a PERMANENT failure (the resolve
    // DTO's face ceiling, which no retry can ever satisfy) was indistinguishable from a transient one. A real
    // 2382-face cluster hit exactly that and the admin was left retrying a request that could never succeed.
    it('surfaces the server validation reason on a 400 instead of the reason-less banner', async () => {
      vi.mocked(resolveFaces).mockRejectedValueOnce(
        httpError(400, {
          message: 'Validation failed',
          statusCode: 400,
          errors: [
            {
              code: 'too_big',
              maximum: 25_000,
              path: ['moveToPerson', 0, 'faceIds'],
              message: 'Too big: expected array to have <=25000 items',
            },
          ],
        }),
      );

      render(Page, { props: { data: makePageData() } });
      await waitFor(() => expect(screen.getAllByTestId('face-tile')).toHaveLength(3));

      await fireEvent.click(screen.getByTestId('apply-btn'));

      await waitFor(() => {
        expect(screen.getByText('admin.face_cleanup_review_apply_error_reason')).toBeInTheDocument();
      });
      // The reason is a translation key, NOT the server's English Zod text — this is exactly what makes a
      // German admin see a German sentence. The server's own limit is carried through as a value.
      expect(bannerReason()).toBe('admin.face_cleanup_review_apply_reason_too_many');
      expect(
        translations.find((entry) => entry.key === 'admin.face_cleanup_review_apply_reason_too_many')?.values,
      ).toEqual({ max: 25_000 });
      expect(screen.queryByText('admin.face_cleanup_review_apply_error')).not.toBeInTheDocument();
      expect(goto).not.toHaveBeenCalled();
    });

    // A stale page is the likeliest 400 in normal use, so its reason must be translated rather than echoed as
    // the server's developer-facing English. The `code` is the stable contract that makes that possible.
    it.each([
      ['face-repair:faces-not-in-snapshot', 'Some faces are not in the flagged snapshot for this person'],
      ['face-repair:faces-not-eligible', 'Some faces are not eligible for this person'],
      ['face-repair:person-not-found', 'Reviewed person not found'],
      ['face-repair:destination-missing', 'Destination person x does not exist'],
    ])('translates the %s failure instead of echoing the server text', async (code, message) => {
      vi.mocked(resolveFaces).mockRejectedValueOnce(httpError(400, { message, code, statusCode: 400 }));

      render(Page, { props: { data: makePageData() } });
      await waitFor(() => expect(screen.getAllByTestId('face-tile')).toHaveLength(3));

      await fireEvent.click(screen.getByTestId('apply-btn'));

      await waitFor(() => {
        expect(screen.getByText('admin.face_cleanup_review_apply_error_reason')).toBeInTheDocument();
      });
      // A translation key, not the server's English sentence: the code is what buys the translated banner.
      expect(bannerReason()).toMatch(/^admin\.face_cleanup_review_apply_reason_/);
      expect(bannerReason()).not.toBe(message);
    });

    // No code and no recognisable issue: the raw server message is still better than a reason-less banner, even
    // though it stays English. Reachable only via failures the UI itself cannot produce.
    it('falls back to the raw server message when the failure carries no code', async () => {
      const message = 'entireCluster cannot be combined with per-face resolution buckets';
      vi.mocked(resolveFaces).mockRejectedValueOnce(httpError(400, { message, statusCode: 400 }));

      render(Page, { props: { data: makePageData() } });
      await waitFor(() => expect(screen.getAllByTestId('face-tile')).toHaveLength(3));

      await fireEvent.click(screen.getByTestId('apply-btn'));

      await waitFor(() => {
        expect(screen.getByText('admin.face_cleanup_review_apply_error_reason')).toBeInTheDocument();
      });
      expect(bannerReason()).toBe(message);
    });

    // A failure the server did not explain (a dropped connection, a proxy 502) has no reason to show, so the
    // generic banner has to stay reachable rather than rendering an empty "…: ." sentence.
    it('falls back to the generic banner when the failure carries no server message', async () => {
      vi.mocked(resolveFaces).mockRejectedValueOnce(new Error('network down'));

      render(Page, { props: { data: makePageData() } });
      await waitFor(() => expect(screen.getAllByTestId('face-tile')).toHaveLength(3));

      await fireEvent.click(screen.getByTestId('apply-btn'));

      await waitFor(() => {
        expect(screen.getByText('admin.face_cleanup_review_apply_error')).toBeInTheDocument();
      });
      expect(screen.queryByText('admin.face_cleanup_review_apply_error_reason')).not.toBeInTheDocument();
    });
  });

  // ---- Slice 2: "Keep here" bulk action (soft-stay) — W1/W2 exercised through the rendered page ----

  describe('Bulk actions — Keep here (stay)', () => {
    it('tags the selected tile stay (green ribbon) and updates the tally, clearing the selection', async () => {
      render(Page, { props: { data: makePageData() } });
      await waitFor(() => expect(screen.getAllByTestId('face-tile')).toHaveLength(3));

      const tiles = screen.getAllByTestId('face-tile');
      await fireEvent.click(tiles[0]);
      await waitFor(() => expect(screen.getByTestId('face-bulk-bar')).toBeInTheDocument());

      await fireEvent.click(screen.getByTestId('bulk-stay'));

      await waitFor(() => {
        // Bulk actions clear the selection, swapping the dock back to the summary.
        expect(screen.queryByTestId('face-bulk-bar')).not.toBeInTheDocument();
        expect(screen.getByTestId('tally')).toBeInTheDocument();
      });

      const refreshedTiles = screen.getAllByTestId('face-tile');
      expect(refreshedTiles[0]).toHaveAttribute('data-state', 'stay');
      expect(screen.getByText('admin.face_cleanup_review_tile_stay_ribbon')).toBeInTheDocument();

      // The tally's "Keep" chip now reads 1 and is no longer dimmed (opacity-40 = zero-count).
      const tally = screen.getByTestId('tally');
      const stayLabel = within(tally).getByText('admin.face_cleanup_review_tally_stay');
      const stayChip = stayLabel.parentElement!;
      expect(stayChip).not.toHaveClass('opacity-40');
      expect(stayChip).toHaveTextContent('1');
    });

    it('includes the kept face in `stay` and excludes it from `moveToPerson` on Apply', async () => {
      render(Page, { props: { data: makePageData() } });
      await waitFor(() => expect(screen.getAllByTestId('face-tile')).toHaveLength(3));

      const tiles = screen.getAllByTestId('face-tile');
      await fireEvent.click(tiles[0]); // face-1, suspected owner-a
      await fireEvent.click(screen.getByTestId('bulk-stay'));

      await fireEvent.click(screen.getByTestId('apply-btn'));

      await waitFor(() => {
        expect(resolveFaces).toHaveBeenCalledWith({
          faceRepairResolveRequestDto: {
            personId: PERSON_ID,
            moveToPerson: [
              { destinationPersonId: OWNER_A_ID, faceIds: ['face-2'], lock: false },
              { destinationPersonId: OWNER_B_ID, faceIds: ['face-3'], lock: false },
            ],
            stay: ['face-1'],
            lock: [],
            detach: [],
            unknown: [],
          },
        });
      });
    });
  });

  // ---- Slice 3: "Confirm / lock" bulk action (owner-agnostic lock) — mirrors the Keep here (stay) wiring ----

  describe('Bulk actions — Confirm / lock', () => {
    it('tags the selected tile lock (violet ribbon) and updates the tally, clearing the selection', async () => {
      render(Page, { props: { data: makePageData() } });
      await waitFor(() => expect(screen.getAllByTestId('face-tile')).toHaveLength(3));

      const tiles = screen.getAllByTestId('face-tile');
      await fireEvent.click(tiles[0]);
      await waitFor(() => expect(screen.getByTestId('face-bulk-bar')).toBeInTheDocument());

      await fireEvent.click(screen.getByTestId('bulk-lock'));

      await waitFor(() => {
        // Bulk actions clear the selection, swapping the dock back to the summary.
        expect(screen.queryByTestId('face-bulk-bar')).not.toBeInTheDocument();
        expect(screen.getByTestId('tally')).toBeInTheDocument();
      });

      const refreshedTiles = screen.getAllByTestId('face-tile');
      expect(refreshedTiles[0]).toHaveAttribute('data-state', 'lock');
      expect(screen.getByText('admin.face_cleanup_review_tile_lock_ribbon')).toBeInTheDocument();

      // The tally's "Locked" chip now reads 1 and is no longer dimmed (opacity-40 = zero-count).
      const tally = screen.getByTestId('tally');
      const lockLabel = within(tally).getByText('admin.face_cleanup_review_tally_lock');
      const lockChip = lockLabel.parentElement!;
      expect(lockChip).not.toHaveClass('opacity-40');
      expect(lockChip).toHaveTextContent('1');
    });

    it('includes the locked face in `lock` and excludes it from `moveToPerson` on Apply', async () => {
      render(Page, { props: { data: makePageData() } });
      await waitFor(() => expect(screen.getAllByTestId('face-tile')).toHaveLength(3));

      const tiles = screen.getAllByTestId('face-tile');
      await fireEvent.click(tiles[0]); // face-1, suspected owner-a
      await fireEvent.click(screen.getByTestId('bulk-lock'));

      await fireEvent.click(screen.getByTestId('apply-btn'));

      await waitFor(() => {
        expect(resolveFaces).toHaveBeenCalledWith({
          faceRepairResolveRequestDto: {
            personId: PERSON_ID,
            moveToPerson: [
              { destinationPersonId: OWNER_A_ID, faceIds: ['face-2'], lock: false },
              { destinationPersonId: OWNER_B_ID, faceIds: ['face-3'], lock: false },
            ],
            stay: [],
            lock: ['face-1'],
            detach: [],
            unknown: [],
          },
        });
      });
    });
  });

  // ---- Slice 4: "Move → person…" bulk action (owner-scoped picker) ----
  // The picker component itself (list/search/create-new/E8) is covered by PersonPicker.spec.ts; here we
  // verify the bulk-bar action opens it with the right props and routes whatever it resolves with into the
  // review model, matching the "Keep here"/"Confirm / lock" wiring above.

  describe('Bulk actions — Move to person (other)', () => {
    it('opens the picker with the owner id, selection count and the scan-suggested owner', async () => {
      render(Page, { props: { data: makePageData() } });
      await waitFor(() => expect(screen.getAllByTestId('face-tile')).toHaveLength(3));

      const tiles = screen.getAllByTestId('face-tile');
      await fireEvent.click(tiles[0]);
      await waitFor(() => expect(screen.getByTestId('face-bulk-bar')).toBeInTheDocument());

      await fireEvent.click(screen.getByTestId('bulk-other'));

      await waitFor(() => {
        expect(showModal).toHaveBeenCalledWith(
          expect.anything(),
          expect.objectContaining({ ownerId: 'owner-user-1', faceCount: 1, suggestedPersonId: OWNER_A_ID }),
        );
      });
    });

    it('tags the selected tile "other" (amber ribbon) with the chosen destination, and tallies it under "→ other"', async () => {
      showModal.mockResolvedValueOnce({ personId: 'chosen-1', name: 'Chosen Person' });

      render(Page, { props: { data: makePageData() } });
      await waitFor(() => expect(screen.getAllByTestId('face-tile')).toHaveLength(3));

      const tiles = screen.getAllByTestId('face-tile');
      await fireEvent.click(tiles[0]);
      await waitFor(() => expect(screen.getByTestId('face-bulk-bar')).toBeInTheDocument());

      await fireEvent.click(screen.getByTestId('bulk-other'));

      await waitFor(() => {
        expect(screen.queryByTestId('face-bulk-bar')).not.toBeInTheDocument();
        expect(screen.getByTestId('tally')).toBeInTheDocument();
      });

      const refreshedTiles = screen.getAllByTestId('face-tile');
      expect(refreshedTiles[0]).toHaveAttribute('data-state', 'other');
      // Scoped to the tile itself: the 'owner'-state tiles reuse the same `..._tile_dest` key, so an
      // unscoped query would match more than one element.
      expect(within(refreshedTiles[0]).getByText('admin.face_cleanup_review_tile_dest')).toBeInTheDocument();

      const tally = screen.getByTestId('tally');
      const otherLabel = within(tally).getByText('admin.face_cleanup_review_tally_other');
      const otherChip = otherLabel.parentElement!;
      expect(otherChip).not.toHaveClass('opacity-40');
      expect(otherChip).toHaveTextContent('1');
    });

    it('groups the chosen destination into its own moveToPerson entry on Apply', async () => {
      showModal.mockResolvedValueOnce({ personId: 'chosen-1', name: 'Chosen Person' });

      render(Page, { props: { data: makePageData() } });
      await waitFor(() => expect(screen.getAllByTestId('face-tile')).toHaveLength(3));

      const tiles = screen.getAllByTestId('face-tile');
      await fireEvent.click(tiles[0]); // face-1, suspected owner-a
      await fireEvent.click(screen.getByTestId('bulk-other'));
      await waitFor(() => expect(screen.queryByTestId('face-bulk-bar')).not.toBeInTheDocument());

      await fireEvent.click(screen.getByTestId('apply-btn'));

      await waitFor(() => {
        expect(resolveFaces).toHaveBeenCalledWith({
          faceRepairResolveRequestDto: {
            personId: PERSON_ID,
            // The mock resolves without `lock` — same as an unchecked picker toggle — so the chosen-person
            // group defaults to lock:false, same as the untouched owner-state groups (Slice 3).
            moveToPerson: [
              { destinationPersonId: 'chosen-1', faceIds: ['face-1'], lock: false },
              { destinationPersonId: OWNER_A_ID, faceIds: ['face-2'], lock: false },
              { destinationPersonId: OWNER_B_ID, faceIds: ['face-3'], lock: false },
            ],
            stay: [],
            lock: [],
            detach: [],
            unknown: [],
          },
        });
      });
    });

    // ---- Slice 3 (move-and-lock): the picker's lock toggle rides through +page.svelte's wiring ----
    it("W1: threads the picker's lock:true onto the chosen-person group only, never onto owner-state groups", async () => {
      showModal.mockResolvedValueOnce({ personId: 'chosen-1', name: 'Chosen Person', lock: true });

      render(Page, { props: { data: makePageData() } });
      await waitFor(() => expect(screen.getAllByTestId('face-tile')).toHaveLength(3));

      const tiles = screen.getAllByTestId('face-tile');
      await fireEvent.click(tiles[0]); // face-1, suspected owner-a
      await fireEvent.click(screen.getByTestId('bulk-other'));
      await waitFor(() => expect(screen.queryByTestId('face-bulk-bar')).not.toBeInTheDocument());

      await fireEvent.click(screen.getByTestId('apply-btn'));

      await waitFor(() => {
        expect(resolveFaces).toHaveBeenCalledWith({
          faceRepairResolveRequestDto: {
            personId: PERSON_ID,
            moveToPerson: [
              { destinationPersonId: 'chosen-1', faceIds: ['face-1'], lock: true },
              { destinationPersonId: OWNER_A_ID, faceIds: ['face-2'], lock: false },
              { destinationPersonId: OWNER_B_ID, faceIds: ['face-3'], lock: false },
            ],
            stay: [],
            lock: [],
            detach: [],
            unknown: [],
          },
        });
      });
    });

    it('leaves the selection untouched if the picker is closed without choosing a destination', async () => {
      showModal.mockResolvedValueOnce(undefined);

      render(Page, { props: { data: makePageData() } });
      await waitFor(() => expect(screen.getAllByTestId('face-tile')).toHaveLength(3));

      const tiles = screen.getAllByTestId('face-tile');
      await fireEvent.click(tiles[0]);
      await fireEvent.click(screen.getByTestId('bulk-other'));

      await waitFor(() => expect(showModal).toHaveBeenCalled());

      // Selection (and its "owner" state) survives an uncommitted picker — the bulk bar is still showing.
      expect(screen.getByTestId('face-bulk-bar')).toBeInTheDocument();
      expect(screen.getAllByTestId('face-tile')[0]).toHaveAttribute('data-state', 'owner');
    });
  });

  // ---- Slice 5: "Not a face" bulk action (detach) — mirrors the Keep here (stay) / Confirm-lock wiring ----

  describe('Bulk actions — Not a face (detach)', () => {
    it('tags the selected tile detach (slate ribbon, grayscale) and updates the tally, clearing the selection', async () => {
      render(Page, { props: { data: makePageData() } });
      await waitFor(() => expect(screen.getAllByTestId('face-tile')).toHaveLength(3));

      const tiles = screen.getAllByTestId('face-tile');
      await fireEvent.click(tiles[0]);
      await waitFor(() => expect(screen.getByTestId('face-bulk-bar')).toBeInTheDocument());

      await fireEvent.click(screen.getByTestId('bulk-detach'));

      await waitFor(() => {
        // Bulk actions clear the selection, swapping the dock back to the summary.
        expect(screen.queryByTestId('face-bulk-bar')).not.toBeInTheDocument();
        expect(screen.getByTestId('tally')).toBeInTheDocument();
      });

      const refreshedTiles = screen.getAllByTestId('face-tile');
      expect(refreshedTiles[0]).toHaveAttribute('data-state', 'detach');
      expect(screen.getByText('admin.face_cleanup_review_tile_detach_ribbon')).toBeInTheDocument();

      // The tile's thumbnail is grayed out (mockup: filter: grayscale(1) opacity(0.55)). alt="" gives the
      // image role="presentation" (no accessible name), so query it directly rather than via getByRole.
      const image = refreshedTiles[0].querySelector('img');
      expect(image).not.toBeNull();
      expect(image?.getAttribute('style')).toContain('grayscale(1)');
      expect(image?.getAttribute('style')).toContain('opacity(0.55)');

      // The tally's "Detach" chip now reads 1 and is no longer dimmed (opacity-40 = zero-count).
      const tally = screen.getByTestId('tally');
      const detachLabel = within(tally).getByText('admin.face_cleanup_review_tally_detach');
      const detachChip = detachLabel.parentElement!;
      expect(detachChip).not.toHaveClass('opacity-40');
      expect(detachChip).toHaveTextContent('1');
    });

    it('includes the detached face in `detach` and excludes it from `moveToPerson` on Apply', async () => {
      render(Page, { props: { data: makePageData() } });
      await waitFor(() => expect(screen.getAllByTestId('face-tile')).toHaveLength(3));

      const tiles = screen.getAllByTestId('face-tile');
      await fireEvent.click(tiles[0]); // face-1, suspected owner-a
      await fireEvent.click(screen.getByTestId('bulk-detach'));

      // Detaching is irreversible, so Apply routes through the confirmation first.
      showModal.mockResolvedValueOnce(true);
      await fireEvent.click(screen.getByTestId('apply-btn'));

      await waitFor(() => {
        expect(resolveFaces).toHaveBeenCalledWith({
          faceRepairResolveRequestDto: {
            personId: PERSON_ID,
            moveToPerson: [
              { destinationPersonId: OWNER_A_ID, faceIds: ['face-2'], lock: false },
              { destinationPersonId: OWNER_B_ID, faceIds: ['face-3'], lock: false },
            ],
            stay: [],
            lock: [],
            detach: ['face-1'],
            unknown: [],
          },
        });
      });
    });
  });

  // "Not a face" is the only action on this page that cannot be undone — it retires the detected face for good,
  // and nothing in the app brings it back. It also sits one button away from "Unknown person", which means the
  // OPPOSITE thing. These tests pin the guard against that slip.
  //
  // S12.4: the confirmation is a real `modalManager.show(ConfirmModal, …)` dialog, not a hand-rolled overlay —
  // Escape/backdrop dismissal and focus handling are ConfirmModal's own responsibility (covered where that
  // component is itself tested); what this page owns and must prove is: it opens the dialog with the right
  // copy, a decline (`onClose(false)` — exactly what Escape and the Cancel button both produce) issues no
  // `resolveFaces` call, and a confirm (`onClose(true)`) issues exactly one with the expected payload.
  describe('Destructive Apply — confirmation before discarding faces', () => {
    const stageDetach = async () => {
      render(Page, { props: { data: makePageData() } });
      await waitFor(() => expect(screen.getAllByTestId('face-tile')).toHaveLength(3));
      await fireEvent.click(screen.getAllByTestId('face-tile')[0]);
      await fireEvent.click(screen.getByTestId('bulk-detach'));
    };

    it('does NOT commit anything when Apply carries a detached face — it asks first, with the right copy', async () => {
      let settleConfirm!: (confirmed: boolean) => void;
      showModal.mockReturnValueOnce(
        new Promise((resolve) => {
          settleConfirm = resolve as (confirmed: boolean) => void;
        }) as never,
      );
      await stageDetach();

      await fireEvent.click(screen.getByTestId('apply-btn'));

      await waitFor(() =>
        expect(showModal).toHaveBeenCalledWith(
          ConfirmModal,
          expect.objectContaining({
            title: 'admin.face_cleanup_review_detach_confirm_title',
            prompt: 'admin.face_cleanup_review_detach_confirm_body',
            confirmText: 'admin.face_cleanup_review_detach_confirm_cta',
            confirmColor: 'danger',
          }),
        ),
      );
      // The whole point: the destructive resolve has NOT been sent yet — the dialog is still pending.
      expect(resolveFaces).not.toHaveBeenCalled();
      expect(goto).not.toHaveBeenCalled();

      // F31 item 4: this message doesn't reference {count} at all — it must not be handed one, the exact
      // "argument the message never interpolates" defect the item calls out.
      const bodyTranslation = translations.findLast((t) => t.key === 'admin.face_cleanup_review_detach_confirm_body');
      expect(bodyTranslation?.values?.count).toBeUndefined();

      settleConfirm(false);
      await waitFor(() => expect(resolveFaces).not.toHaveBeenCalled());
    });

    it('cancelling (Escape/backdrop/Cancel all resolve false) commits nothing and leaves the staged review intact', async () => {
      showModal.mockResolvedValueOnce(false);
      await stageDetach();

      await fireEvent.click(screen.getByTestId('apply-btn'));

      await waitFor(() => expect(showModal).toHaveBeenCalledWith(ConfirmModal, expect.anything()));
      expect(resolveFaces).not.toHaveBeenCalled();
      // The staged decision survives the cancel — the admin returns to their review, not to a blank slate.
      expect(screen.getAllByTestId('face-tile')[0]).toHaveAttribute('data-state', 'detach');
    });

    it('confirming issues exactly one resolveFaces call carrying the detached face', async () => {
      showModal.mockResolvedValueOnce(true);
      await stageDetach();

      await fireEvent.click(screen.getByTestId('apply-btn'));

      await waitFor(() => expect(resolveFaces).toHaveBeenCalledTimes(1));
      expect(resolveFaces).toHaveBeenCalledWith({
        faceRepairResolveRequestDto: {
          personId: PERSON_ID,
          moveToPerson: [
            { destinationPersonId: OWNER_A_ID, faceIds: ['face-2'], lock: false },
            { destinationPersonId: OWNER_B_ID, faceIds: ['face-3'], lock: false },
          ],
          stay: [],
          lock: [],
          detach: ['face-1'],
          unknown: [],
        },
      });
      // S11 (slice 12d): a successful apply on the GUIDED page navigates back to the scan console — its OWN
      // destination, Route.faceCleanupScan(), which differs from the manual sibling's Route.faceCleanupPeople().
      // Every other goto assertion on this page is negative (error/pending paths); this is the positive control.
      await waitFor(() => expect(goto).toHaveBeenCalledWith(Route.faceCleanupScan()));
    });

    it('does NOT ask when nothing is being discarded — a routine Apply goes straight through', async () => {
      render(Page, { props: { data: makePageData() } });
      await waitFor(() => expect(screen.getAllByTestId('face-tile')).toHaveLength(3));

      // Every face stays in the default `owner` state: nothing destructive, so no confirmation. Prompting on
      // every Apply would train the admin to click past the one prompt that matters.
      await fireEvent.click(screen.getByTestId('apply-btn'));

      await waitFor(() => expect(resolveFaces).toHaveBeenCalled());
      expect(showModal).not.toHaveBeenCalledWith(ConfirmModal, expect.anything());
    });

    it('does NOT ask for the Unknown person action — parking a stranger is reversible', async () => {
      render(Page, { props: { data: makePageData() } });
      await waitFor(() => expect(screen.getAllByTestId('face-tile')).toHaveLength(3));
      await fireEvent.click(screen.getAllByTestId('face-tile')[0]);
      await fireEvent.click(screen.getByTestId('bulk-unknown'));

      await fireEvent.click(screen.getByTestId('apply-btn'));

      await waitFor(() => expect(resolveFaces).toHaveBeenCalled());
      expect(showModal).not.toHaveBeenCalledWith(ConfirmModal, expect.anything());
    });
  });

  // ---- "Unknown person": a real face the admin cannot name (the case that made the review unfinishable) ----

  describe('Bulk actions — Unknown person', () => {
    it('tags the selected tile unknown WITHOUT graying it out (it is a real face) and updates the tally', async () => {
      render(Page, { props: { data: makePageData() } });
      await waitFor(() => expect(screen.getAllByTestId('face-tile')).toHaveLength(3));

      await fireEvent.click(screen.getAllByTestId('face-tile')[0]);
      await waitFor(() => expect(screen.getByTestId('face-bulk-bar')).toBeInTheDocument());

      await fireEvent.click(screen.getByTestId('bulk-unknown'));

      await waitFor(() => expect(screen.queryByTestId('face-bulk-bar')).not.toBeInTheDocument());

      const refreshedTiles = screen.getAllByTestId('face-tile');
      expect(refreshedTiles[0]).toHaveAttribute('data-state', 'unknown');
      expect(screen.getByText('admin.face_cleanup_review_tile_unknown_ribbon')).toBeInTheDocument();

      // Unlike "Not a face", the crop is NOT desaturated — this face is a real person, just an unnamed one.
      const image = refreshedTiles[0].querySelector('img');
      expect(image?.getAttribute('style') ?? '').not.toContain('grayscale(1)');

      const tally = screen.getByTestId('tally');
      const unknownChip = within(tally).getByText('admin.face_cleanup_review_tally_unknown').parentElement!;
      expect(unknownChip).not.toHaveClass('opacity-40');
      expect(unknownChip).toHaveTextContent('1');
    });

    it('sends the face in `unknown` and excludes it from `moveToPerson` on Apply', async () => {
      render(Page, { props: { data: makePageData() } });
      await waitFor(() => expect(screen.getAllByTestId('face-tile')).toHaveLength(3));

      await fireEvent.click(screen.getAllByTestId('face-tile')[0]); // face-1, suspected owner-a
      await fireEvent.click(screen.getByTestId('bulk-unknown'));
      await fireEvent.click(screen.getByTestId('apply-btn'));

      await waitFor(() => {
        expect(resolveFaces).toHaveBeenCalledWith({
          faceRepairResolveRequestDto: {
            personId: PERSON_ID,
            moveToPerson: [
              { destinationPersonId: OWNER_A_ID, faceIds: ['face-2'], lock: false },
              { destinationPersonId: OWNER_B_ID, faceIds: ['face-3'], lock: false },
            ],
            stay: [],
            lock: [],
            detach: [],
            unknown: ['face-1'],
          },
        });
      });
    });
  });

  // ---- Rest-of-cluster (own self-contained flow, now also posting through `resolve` — Slice 6) ----

  describe('Rest-of-cluster via resolve', () => {
    // S12.5: same three assertions as the detach confirmation (S12.4) — a real ConfirmModal, a decline that
    // posts nothing, a confirm that posts exactly once with the expected payload.
    it('Move entire cluster: opens a ConfirmModal with the right copy and posts nothing until confirmed', async () => {
      let settleConfirm!: (confirmed: boolean) => void;
      showModal.mockReturnValueOnce(
        new Promise((resolve) => {
          settleConfirm = resolve as (confirmed: boolean) => void;
        }) as never,
      );

      render(Page, { props: { data: makePageData() } });
      await waitFor(() => expect(screen.getAllByTestId('face-tile')).toHaveLength(3));

      await fireEvent.click(screen.getByTestId('move-entire-btn'));

      await waitFor(() =>
        expect(showModal).toHaveBeenCalledWith(
          ConfirmModal,
          expect.objectContaining({
            title: 'admin.face_cleanup_review_move_entire_confirm_title',
            prompt: 'admin.face_cleanup_review_move_entire_confirm_body',
            confirmText: 'admin.face_cleanup_review_move_entire_confirm_cta',
          }),
        ),
      );
      expect(resolveFaces).not.toHaveBeenCalled();

      settleConfirm(false);
      await waitFor(() => expect(resolveFaces).not.toHaveBeenCalled());
    });

    it('Move entire cluster: confirming the modal calls resolveFaces exactly once with entireCluster', async () => {
      showModal.mockResolvedValueOnce(true);
      render(Page, { props: { data: makePageData() } });
      await waitFor(() => expect(screen.getAllByTestId('face-tile')).toHaveLength(3));

      await fireEvent.click(screen.getByTestId('move-entire-btn'));

      await waitFor(() => expect(resolveFaces).toHaveBeenCalledTimes(1));
      expect(resolveFaces).toHaveBeenCalledWith({
        faceRepairResolveRequestDto: {
          personId: PERSON_ID,
          entireCluster: { destinationPersonId: OWNER_A_ID },
        },
      });
    });

    // The rest-of-cluster section used to COMMIT its own independent resolve, which drained the person from the
    // console while every staged flagged decision was silently discarded (and came back on the next scan).
    // Ticking a rest face now only STAGES it into the one terminal Apply.
    it('has no separate rest-move commit button — the rest selection is staged, not committed', async () => {
      vi.mocked(getFaceRepairClusterFaces).mockResolvedValue({
        faces: [{ assetFaceId: 'rest-1' }, { assetFaceId: 'rest-2' }],
        total: 2,
        hasMore: false,
      } as unknown as FaceRepairClusterFacesResponseDto);

      render(Page, { props: { data: makePageData() } });
      await waitFor(() => expect(screen.getAllByTestId('rest-tile')).toHaveLength(2));

      await fireEvent.click(screen.getAllByTestId('rest-tile')[0]);

      expect(resolveFaces).not.toHaveBeenCalled();
    });

    it('folds the staged rest faces into the single Apply, in ONE resolve alongside the flagged faces', async () => {
      vi.mocked(getFaceRepairClusterFaces).mockResolvedValue({
        faces: [{ assetFaceId: 'rest-1' }, { assetFaceId: 'rest-2' }],
        total: 2,
        hasMore: false,
      } as unknown as FaceRepairClusterFacesResponseDto);

      render(Page, { props: { data: makePageData() } });
      await waitFor(() => expect(screen.getAllByTestId('rest-tile')).toHaveLength(2));

      await fireEvent.click(screen.getAllByTestId('rest-tile')[0]);

      // The dock now tells the admin the added face is part of what Apply will do — it swaps to the
      // "+ N added" label and tallies the addition (this spec's t() echoes keys, so the count itself is
      // asserted on the chip, which renders it literally).
      await waitFor(() => {
        expect(screen.getByTestId('apply-btn')).toHaveTextContent('admin.face_cleanup_review_apply_label_added');
        expect(screen.getByTestId('tally-added')).toHaveTextContent('+1');
      });

      await fireEvent.click(screen.getByTestId('apply-btn'));

      await waitFor(() => expect(resolveFaces).toHaveBeenCalledTimes(1));
      const request = vi.mocked(resolveFaces).mock.calls[0][0].faceRepairResolveRequestDto;
      // face-1/face-2 (flagged, suspecting owner A) and the staged rest face all ride the owner-A group.
      const ownerAGroup = request.moveToPerson?.find((group) => group.destinationPersonId === OWNER_A_ID);
      expect(ownerAGroup?.faceIds.sort()).toEqual(['face-1', 'face-2', 'rest-1'].sort());
      // ...and the mixed cluster's owner-B face still rides its own group — the rest face never lands there.
      const ownerBGroup = request.moveToPerson?.find((group) => group.destinationPersonId === OWNER_B_ID);
      expect(ownerBGroup?.faceIds).toEqual(['face-3']);
    });

    // The bug that ate a whole-cluster move: the server refuses a resolve while a scan is running (409), and
    // the client swallowed it — no banner, nothing moved, and the admin believed it had worked.
    it('surfaces a rejected Move entire cluster instead of swallowing it, and does not navigate away', async () => {
      vi.mocked(resolveFaces).mockRejectedValue({ status: 409 });
      showModal.mockResolvedValueOnce(true);

      render(Page, { props: { data: makePageData() } });
      await waitFor(() => expect(screen.getAllByTestId('face-tile')).toHaveLength(3));

      await fireEvent.click(screen.getByTestId('move-entire-btn'));

      await waitFor(() => {
        expect(screen.getByText('admin.face_cleanup_review_apply_conflict')).toBeInTheDocument();
      });
      expect(goto).not.toHaveBeenCalled();
    });

    it('reports what the server actually did after a successful apply', async () => {
      vi.mocked(resolveFaces).mockResolvedValue({
        moved: 2,
        declined: 1,
        locked: 0,
        detached: 0,
        unknown: 0,
        skipped: 0,
      });

      render(Page, { props: { data: makePageData() } });
      await waitFor(() => expect(screen.getAllByTestId('face-tile')).toHaveLength(3));

      await fireEvent.click(screen.getByTestId('apply-btn'));

      await waitFor(() => {
        expect(toastManager.primary).toHaveBeenCalledWith(
          expect.stringContaining('admin.face_cleanup_review_apply_summary'),
        );
      });
    });
  });

  // ---- F25: a failed rest-of-cluster load must not leave "Move entire cluster" naming a count it can't back up ----
  describe('Rest-load failure disables the whole-cluster action (F25)', () => {
    it('S11.9: with the rest-load failed, the whole-cluster action is disabled with an explanation, and the flagged grid still renders', async () => {
      vi.mocked(getFaceRepairClusterFaces).mockRejectedValue(new Error('network blip'));

      render(Page, { props: { data: makePageData() } });
      await waitFor(() => expect(screen.getAllByTestId('face-tile')).toHaveLength(3));

      await waitFor(() => expect(screen.getByTestId('move-entire-btn')).toBeDisabled());
      expect(screen.getByTestId('rest-load-error')).toBeInTheDocument();
      // Positive control: the flagged grid (unrelated to the rest-of-cluster load) still renders normally —
      // the failure is scoped to the rest section, not a full-page failure.
      expect(screen.getAllByTestId('face-tile')).toHaveLength(3);
    });

    it('retrying a failed rest-load re-enables the whole-cluster action once it succeeds', async () => {
      vi.mocked(getFaceRepairClusterFaces)
        .mockRejectedValueOnce(new Error('network blip'))
        .mockResolvedValueOnce({
          faces: [{ assetFaceId: 'rest-1' }],
          total: 1,
          hasMore: false,
        } as unknown as FaceRepairClusterFacesResponseDto);

      render(Page, { props: { data: makePageData() } });
      await waitFor(() => expect(screen.getByTestId('rest-load-error')).toBeInTheDocument());
      expect(screen.getByTestId('move-entire-btn')).toBeDisabled();

      await fireEvent.click(screen.getByTestId('rest-load-error-retry'));

      await waitFor(() => expect(screen.queryByTestId('rest-load-error')).not.toBeInTheDocument());
      expect(screen.getByTestId('move-entire-btn')).toBeEnabled();
    });

    // S11.10 (pin): with a successful rest load, the confirm copy's count is restTotal + flagged.length (2 rest
    // + 3 flagged = 5) — not just the flagged count alone. Mutated/reverted below to prove this can fail.
    it('S11.10 (pin): with a successful rest load, the confirm copy shows restTotal + flagged.length', async () => {
      vi.mocked(getFaceRepairClusterFaces).mockResolvedValue({
        faces: [{ assetFaceId: 'rest-1' }, { assetFaceId: 'rest-2' }],
        total: 2,
        hasMore: false,
      } as unknown as FaceRepairClusterFacesResponseDto);
      showModal.mockResolvedValueOnce(true);

      render(Page, { props: { data: makePageData() } });
      await waitFor(() => expect(screen.getByTestId('move-entire-btn')).toBeEnabled());

      await fireEvent.click(screen.getByTestId('move-entire-btn'));

      await waitFor(() =>
        expect(
          translations.some(
            // B3: a NUMBER, not '5'. The count used to be pre-formatted with toLocaleString(), which made
            // ICU compute `#` as `"2,952" - 0` = NaN on any cluster past a thousand faces.
            (t) => t.key === 'admin.face_cleanup_review_move_entire_confirm_body' && t.values?.count === 5,
          ),
        ).toBe(true),
      );
    });
  });

  // ---- Actions help: two entry points, one modal ----
  // The bulk bar only exists once a face is selected, so the banner (i) is the one a confused admin finds
  // before touching anything; the bulk-bar (i) is the one they reach for mid-task. The modal's own content is
  // covered by FaceActionsHelpModal.spec.ts — here we only verify both buttons open it.

  describe('Actions help modal', () => {
    it('opens the help modal from the review banner, before anything is selected', async () => {
      render(Page, { props: { data: makePageData() } });
      await waitFor(() => expect(screen.getAllByTestId('face-tile')).toHaveLength(3));

      expect(screen.queryByTestId('face-bulk-bar')).not.toBeInTheDocument();
      await fireEvent.click(screen.getByTestId('banner-help'));

      expect(showModal).toHaveBeenCalledWith(FaceActionsHelpModal, expect.objectContaining({ mode: 'guided' }));
    });

    it('opens the same help modal from the bulk bar once a face is selected', async () => {
      render(Page, { props: { data: makePageData() } });
      await waitFor(() => expect(screen.getAllByTestId('face-tile')).toHaveLength(3));

      await fireEvent.click(screen.getAllByTestId('face-tile')[0]);
      await waitFor(() => expect(screen.getByTestId('face-bulk-bar')).toBeInTheDocument());

      await fireEvent.click(screen.getByTestId('face-bulk-help'));

      expect(showModal).toHaveBeenCalledWith(FaceActionsHelpModal, expect.objectContaining({ mode: 'guided' }));
    });

    it('keeps the selection intact when the help modal is dismissed', async () => {
      render(Page, { props: { data: makePageData() } });
      await waitFor(() => expect(screen.getAllByTestId('face-tile')).toHaveLength(3));

      await fireEvent.click(screen.getAllByTestId('face-tile')[0]);
      await waitFor(() => expect(screen.getByTestId('face-bulk-bar')).toBeInTheDocument());
      await fireEvent.click(screen.getByTestId('face-bulk-help'));

      // The bar only renders while something is selected, so its survival IS the selection surviving.
      expect(screen.getByTestId('face-bulk-bar')).toBeInTheDocument();
      expect(screen.getByTestId('face-bulk-bar')).toHaveTextContent('1');
      expect(screen.getAllByTestId('face-tile')[0]).toHaveAttribute('data-state', 'owner');
    });
  });

  // ---- bonus: existing graceful empty state preserved (design §8.5 P5) ----

  it('gracefully shows "no flagged faces" when getFaceRepairPersonFaces returns empty', async () => {
    vi.mocked(getFaceRepairPersonFaces).mockResolvedValue({
      personId: PERSON_ID,
      flaggedFaces: [],
    } as unknown as FaceRepairPersonFacesDto);

    render(Page, { props: { data: makePageData() } });

    await waitFor(() => {
      expect(screen.getByText('admin.face_cleanup_review_no_flagged')).toBeInTheDocument();
    });
    expect(screen.queryAllByTestId('face-tile')).toHaveLength(0);
    expect(screen.queryByTestId('face-dock')).not.toBeInTheDocument();

    // S11 (slice 12d): the empty state's back button is the OTHER goto call site on this page (handleCancel) —
    // unconditional, unlike the Apply success path above.
    await fireEvent.click(screen.getByRole('button', { name: 'admin.face_cleanup_mode_guided' }));
    expect(goto).toHaveBeenCalledWith(Route.faceCleanupScan());
  });

  // ---- D17: a failed INITIAL load must not render as the reassuring "no flagged faces" empty state ----

  it('shows a load-error state (not the graceful empty state) when the initial load fails, and Retry re-fetches', async () => {
    vi.mocked(getFaceRepairPersonFaces).mockRejectedValueOnce(new Error('network down'));

    render(Page, { props: { data: makePageData() } });

    await waitFor(() => {
      expect(screen.getByTestId('load-error-banner')).toBeInTheDocument();
    });
    expect(screen.queryByText('admin.face_cleanup_review_no_flagged')).not.toBeInTheDocument();

    vi.mocked(getFaceRepairPersonFaces).mockResolvedValueOnce({
      personId: PERSON_ID,
      flaggedFaces: makeFlaggedFaces(),
    } as unknown as FaceRepairPersonFacesDto);
    await fireEvent.click(screen.getByTestId('load-error-retry'));

    await waitFor(() => {
      expect(screen.getAllByTestId('face-tile')).toHaveLength(3);
      expect(screen.queryByTestId('load-error-banner')).not.toBeInTheDocument();
    });
  });

  describe('Destination identity', () => {
    const cards = () => screen.getAllByTestId('destination-card');

    it('identifies each destination by thumbnail, name and its own face count', async () => {
      render(Page, { props: { data: makePageData() } });

      await waitFor(() => expect(cards()).toHaveLength(2));
      const first = cards()[0];
      // Not getByRole('img'): every other person/face thumbnail in this admin console (ConfidentLane,
      // people/+page, the reviewed-person header on this very page) pairs an `alt=""` decorative <img> with
      // adjacent visible text, which the accessibility tree maps to role "presentation", not "img" — querying
      // the element directly matches that established convention instead of asserting an accessible name this
      // thumbnail was never meant to have.
      const image = first.querySelector('img');
      expect(image).toHaveAttribute('src', '/api/admin/face-repair/faces/thumb-a/thumbnail');
      expect(within(first).getByText('Armin')).toBeInTheDocument();
      expect(
        translations.some((t) => t.key === 'admin.face_cleanup_review_dest_size' && t.values?.count === 1204),
      ).toBe(true);
    });

    it('states the routing share separately from the destination size', async () => {
      render(Page, { props: { data: makePageData() } });

      await waitFor(() => expect(cards()).toHaveLength(2));
      expect(translations.some((t) => t.key === 'admin.face_cleanup_review_dest_routes' && t.values?.count === 2)).toBe(
        true,
      );
    });

    it('links each destination to its cluster page in a new tab, so staged decisions survive', async () => {
      render(Page, { props: { data: makePageData() } });

      await waitFor(() => expect(cards()).toHaveLength(2));
      const link = within(cards()[0]).getByTestId('destination-open');
      expect(link).toHaveAttribute('href', `/admin/face-cleanup/people/${OWNER_A_ID}`);
      expect(link).toHaveAttribute('target', '_blank');
      expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'));
    });

    it('lists the largest routing share first and collapses past the third', async () => {
      const many = makeScanPerson({
        suspectedOwners: Array.from({ length: 5 }, (_, i) => ({
          ownerPersonId: `owner-${i}`,
          ownerName: `Owner ${i}`,
          thumbnailFaceId: null,
          count: i + 1,
          ownerFaceCount: 10,
          ownerMissing: false,
        })),
      });
      vi.mocked(getLatestScan).mockResolvedValue(makeCompletedScan([many]) as unknown as object);

      render(Page, { props: { data: makePageData() } });

      await waitFor(() => expect(cards()).toHaveLength(3));
      expect(within(cards()[0]).getByText('Owner 4')).toBeInTheDocument();

      await fireEvent.click(screen.getByTestId('destination-more'));
      await waitFor(() => expect(cards()).toHaveLength(5));
    });

    it('orders two equally-sized destinations deterministically', async () => {
      const tied = makeScanPerson({
        suspectedOwners: [
          {
            ownerPersonId: 'zzz',
            ownerName: 'Zoe',
            thumbnailFaceId: null,
            count: 5,
            ownerFaceCount: 1,
            ownerMissing: false,
          },
          {
            ownerPersonId: 'aaa',
            ownerName: 'Ada',
            thumbnailFaceId: null,
            count: 5,
            ownerFaceCount: 1,
            ownerMissing: false,
          },
        ],
      });
      vi.mocked(getLatestScan).mockResolvedValue(makeCompletedScan([tied]) as unknown as object);

      render(Page, { props: { data: makePageData() } });

      await waitFor(() => expect(cards()).toHaveLength(2));
      expect(within(cards()[0]).getByText('Ada')).toBeInTheDocument();
    });

    it('names no destination at all when the scan could not attribute the faces', async () => {
      const orphan = makeScanPerson({ suspectedOwners: [] });
      vi.mocked(getLatestScan).mockResolvedValue(makeCompletedScan([orphan]) as unknown as object);

      render(Page, { props: { data: makePageData() } });

      await waitFor(() => expect(screen.getByTestId('destination-none')).toBeInTheDocument());
      expect(screen.queryAllByTestId('destination-card')).toHaveLength(0);
      // No card means no destination is named. Do NOT assert that the "unnamed cluster" KEY went untranslated:
      // the page's ownerName/destinationName derivations still fall back to it for the tile ribbons, so that
      // assertion would fail for a reason unrelated to what this test is about.
    });

    it('warns that a destination no longer exists instead of rendering it as usable', async () => {
      const gone = makeScanPerson({
        suspectedOwners: [
          {
            ownerPersonId: OWNER_A_ID,
            ownerName: null,
            thumbnailFaceId: null,
            count: 2,
            ownerFaceCount: 0,
            ownerMissing: true,
          },
        ],
      });
      vi.mocked(getLatestScan).mockResolvedValue(makeCompletedScan([gone]) as unknown as object);

      render(Page, { props: { data: makePageData() } });

      await waitFor(() => expect(screen.getByTestId('destination-gone')).toBeInTheDocument());
      expect(screen.queryByTestId('destination-open')).not.toBeInTheDocument();
    });

    it('renders a placeholder rather than a broken image when a destination has no thumbnail', async () => {
      render(Page, { props: { data: makePageData() } });

      await waitFor(() => expect(cards()).toHaveLength(2));
      // Owner B has thumbnailFaceId: null. The person-scoped fallback 403s for a cluster the admin does not
      // own, so there must be no <img> at all. Not queryByRole('img'): an <img alt=""> (this component's own
      // placeholder-less thumbnail markup, and the convention used everywhere else in this admin console) maps
      // to role "presentation", not "img" — queryByRole('img') returns null whether or not an <img> is
      // present, so it can never catch a broken image slipping back in here. A direct DOM query has teeth.
      expect(cards()[1].querySelector('img')).toBeNull();
      expect(within(cards()[1]).getByTestId('destination-placeholder')).toBeInTheDocument();
    });
  });

  describe('Destination chooser', () => {
    const chooser = () => screen.getByTestId('destination-select') as HTMLSelectElement;
    const restFace = (id: string) => ({ assetFaceId: id });

    beforeEach(() => {
      vi.mocked(getFaceRepairClusterFaces).mockResolvedValue({
        faces: [restFace('rest-1'), restFace('rest-2')],
        total: 2,
        hasMore: false,
      } as unknown as FaceRepairClusterFacesResponseDto);
    });

    it('defaults to the destination most flagged faces route to', async () => {
      render(Page, { props: { data: makePageData() } });
      await waitFor(() => expect(chooser().value).toBe(OWNER_A_ID));
    });

    it("sends staged rest-of-cluster faces to the chosen destination, not the scan's first guess", async () => {
      render(Page, { props: { data: makePageData() } });
      await waitFor(() => expect(screen.getByTestId('select-all-btn')).toBeEnabled());

      await fireEvent.change(chooser(), { target: { value: OWNER_B_ID } });
      await fireEvent.click(screen.getByTestId('select-all-btn'));
      await fireEvent.click(screen.getByTestId('apply-btn'));

      await waitFor(() => expect(resolveFaces).toHaveBeenCalled());
      const request = vi.mocked(resolveFaces).mock.calls[0][0].faceRepairResolveRequestDto;
      const group = request.moveToPerson!.find((g) => g.faceIds.includes('rest-1'))!;
      expect(group.destinationPersonId).toBe(OWNER_B_ID);
    });

    it('re-routes already-staged faces when the destination changes, and says so on the dock chip', async () => {
      render(Page, { props: { data: makePageData() } });
      await waitFor(() => expect(screen.getByTestId('select-all-btn')).toBeEnabled());

      await fireEvent.click(screen.getByTestId('select-all-btn'));
      await waitFor(() => expect(screen.getByTestId('tally-added')).toBeInTheDocument());
      await fireEvent.change(chooser(), { target: { value: OWNER_B_ID } });

      await waitFor(() =>
        expect(
          translations.some((t) => t.key === 'admin.face_cleanup_review_tally_added' && t.values?.name === 'Berta'),
        ).toBe(true),
      );
    });

    it('names the chosen destination in the move-entire confirmation', async () => {
      showModal.mockResolvedValueOnce(true);
      render(Page, { props: { data: makePageData() } });
      await waitFor(() => expect(screen.getByTestId('move-entire-btn')).toBeEnabled());

      await fireEvent.change(chooser(), { target: { value: OWNER_B_ID } });
      await fireEvent.click(screen.getByTestId('move-entire-btn'));

      await waitFor(() => expect(resolveFaces).toHaveBeenCalled());
      const request = vi.mocked(resolveFaces).mock.calls[0][0].faceRepairResolveRequestDto;
      expect(request.entireCluster).toEqual({ destinationPersonId: OWNER_B_ID });
      expect(
        translations.some(
          (t) => t.key === 'admin.face_cleanup_review_move_entire_confirm_body' && t.values?.owner === 'Berta',
        ),
      ).toBe(true);
    });

    it('offers no destination that no longer exists', async () => {
      const gone = makeScanPerson({
        suspectedOwners: [
          {
            ownerPersonId: OWNER_A_ID,
            ownerName: 'Armin',
            thumbnailFaceId: null,
            count: 2,
            ownerFaceCount: 0,
            ownerMissing: true,
          },
          {
            ownerPersonId: OWNER_B_ID,
            ownerName: 'Berta',
            thumbnailFaceId: null,
            count: 1,
            ownerFaceCount: 88,
            ownerMissing: false,
          },
        ],
      });
      vi.mocked(getLatestScan).mockResolvedValue(makeCompletedScan([gone]) as unknown as object);

      render(Page, { props: { data: makePageData() } });

      await waitFor(() => expect(chooser()).toBeInTheDocument());
      const values = [...chooser().options].map((o) => o.value);
      expect(values).not.toContain(OWNER_A_ID);
      // …and the default moved on to the surviving suggestion rather than a doomed one.
      expect(chooser().value).toBe(OWNER_B_ID);
    });

    it('leaves both bulk actions disabled until a destination is picked, when none survives', async () => {
      const allGone = makeScanPerson({
        suspectedOwners: [
          {
            ownerPersonId: OWNER_A_ID,
            ownerName: 'Armin',
            thumbnailFaceId: null,
            count: 2,
            ownerFaceCount: 0,
            ownerMissing: true,
          },
        ],
      });
      vi.mocked(getLatestScan).mockResolvedValue(makeCompletedScan([allGone]) as unknown as object);

      render(Page, { props: { data: makePageData() } });

      await waitFor(() => expect(screen.getByTestId('move-entire-btn')).toBeDisabled());
      expect(screen.getByTestId('select-all-btn')).toBeDisabled();
    });

    it('enables the bulk actions on an unattributable cluster once a person is chosen', async () => {
      const orphan = makeScanPerson({ suspectedOwners: [] });
      vi.mocked(getLatestScan).mockResolvedValue(makeCompletedScan([orphan]) as unknown as object);
      showModal.mockResolvedValue({ personId: 'chosen-1', name: 'Chosen', lock: false });

      render(Page, { props: { data: makePageData() } });

      await waitFor(() => expect(screen.getByTestId('move-entire-btn')).toBeDisabled());
      await fireEvent.click(screen.getByTestId('destination-choose-other'));
      await waitFor(() => expect(screen.getByTestId('move-entire-btn')).toBeEnabled());
    });

    it('refuses to move a cluster into itself, explaining why', async () => {
      showModal.mockResolvedValue({ personId: PERSON_ID, name: 'Jula', lock: false });

      render(Page, { props: { data: makePageData() } });
      await waitFor(() => expect(screen.getByTestId('move-entire-btn')).toBeEnabled());

      await fireEvent.click(screen.getByTestId('destination-choose-other'));

      await waitFor(() => expect(screen.getByTestId('move-entire-btn')).toBeDisabled());
      expect(screen.getByTestId('destination-self-warning')).toBeInTheDocument();
    });

    // A self-move is refused, but individual rest tiles (unlike select-all-btn) were never gated on the same
    // guard — ticking one staged a face the ribbon and the dock chip both named a real destination for, even
    // though buildApplyRequest's own guard would drop it from the resolve. The UI must never affirmatively
    // claim a destination Apply will not honour. This covers the ADD-only half of the gate: the tile was never
    // selected to begin with, so there is nothing to un-stage — only new staging is at stake here.
    it('refuses to newly stage a rest-of-cluster face while the chosen destination cannot be honoured', async () => {
      vi.mocked(getFaceRepairClusterFaces).mockResolvedValue({
        faces: [restFace('rest-1'), restFace('rest-2')],
        total: 2,
        hasMore: false,
      } as unknown as FaceRepairClusterFacesResponseDto);
      showModal.mockResolvedValue({ personId: PERSON_ID, name: 'Jula', lock: false });

      render(Page, { props: { data: makePageData() } });
      await waitFor(() => expect(screen.getAllByTestId('rest-tile')).toHaveLength(2));

      await fireEvent.click(screen.getByTestId('destination-choose-other'));
      await waitFor(() => expect(screen.getByTestId('destination-self-warning')).toBeInTheDocument());

      // The tile now also carries its own inert affordance (disabled + dimmed) — before this, the clicks at
      // least appeared to work even though they silently did nothing.
      await waitFor(() => expect(screen.getAllByTestId('rest-tile')[0]).toBeDisabled());

      await fireEvent.click(screen.getAllByTestId('rest-tile')[0]);

      expect(screen.getAllByTestId('rest-tile')[0]).toHaveAttribute('data-selected', 'false');
      expect(screen.queryByTestId('tally-added')).not.toBeInTheDocument();
    });

    // Reproduces the exact sequence the review found live: stage rest faces onto a VALID destination first,
    // then invalidate that destination (self-move). A prior version of this test asserted the faces got
    // silently un-staged — that contract was rejected outright (a mis-click into a self-move must not destroy
    // a page of deliberate selection), so the faces now stay staged, the chip stops naming the (unusable)
    // destination, and Apply refuses to proceed until the admin resolves the mismatch.
    it('keeps already-staged rest faces when their destination becomes invalid, and blocks Apply instead of dropping them', async () => {
      vi.mocked(getFaceRepairClusterFaces).mockResolvedValue({
        faces: [restFace('rest-1'), restFace('rest-2')],
        total: 2,
        hasMore: false,
      } as unknown as FaceRepairClusterFacesResponseDto);

      render(Page, { props: { data: makePageData() } });
      await waitFor(() => expect(screen.getByTestId('select-all-btn')).toBeEnabled());

      await fireEvent.click(screen.getByTestId('select-all-btn'));
      await waitFor(() => expect(screen.getByTestId('tally-added')).toHaveTextContent('+2'));

      showModal.mockResolvedValue({ personId: PERSON_ID, name: 'Jula', lock: false });
      await fireEvent.click(screen.getByTestId('destination-choose-other'));

      await waitFor(() => expect(screen.getByTestId('destination-self-warning')).toBeInTheDocument());

      // Kept, not discarded.
      expect(screen.getByTestId('tally-added')).toHaveTextContent('+2');
      // ...and the chip stops affirmatively naming a destination Apply will not use.
      expect(
        within(screen.getByTestId('tally-added')).getByText('admin.face_cleanup_review_tally_added_pending'),
      ).toBeInTheDocument();

      // Closes a gap where this test passed on EITHER guard alone: handleApply's own early return on
      // restBlocked, or the button's `disabled` attribute. A click never reaches the handler on a disabled
      // button, so deleting only `disabled` would ship a visually-enabled Apply that silently does nothing —
      // and this test would still stay green without this assertion.
      expect(screen.getByTestId('apply-btn')).toBeDisabled();

      await fireEvent.click(screen.getByTestId('apply-btn'));

      expect(resolveFaces).not.toHaveBeenCalled();
      expect(screen.getByTestId('apply-blocked-reason')).toBeInTheDocument();
    });

    // The gate only ever blocks NEW staging — deselecting must always work, or the admin would be stranded
    // with no way out of a blocked state short of finding a valid destination.
    it('still allows un-staging an already-added rest face while destination staging is blocked', async () => {
      vi.mocked(getFaceRepairClusterFaces).mockResolvedValue({
        faces: [restFace('rest-1'), restFace('rest-2')],
        total: 2,
        hasMore: false,
      } as unknown as FaceRepairClusterFacesResponseDto);

      render(Page, { props: { data: makePageData() } });
      await waitFor(() => expect(screen.getByTestId('select-all-btn')).toBeEnabled());
      await fireEvent.click(screen.getByTestId('select-all-btn'));
      await waitFor(() => expect(screen.getAllByTestId('rest-tile')[0]).toHaveAttribute('data-selected', 'true'));

      showModal.mockResolvedValue({ personId: PERSON_ID, name: 'Jula', lock: false });
      await fireEvent.click(screen.getByTestId('destination-choose-other'));
      await waitFor(() => expect(screen.getByTestId('destination-self-warning')).toBeInTheDocument());

      // Already-selected tiles are never disabled — only staging NEW ones is gated.
      expect(screen.getAllByTestId('rest-tile')[0]).toBeEnabled();

      await fireEvent.click(screen.getAllByTestId('rest-tile')[0]);

      await waitFor(() => expect(screen.getAllByTestId('rest-tile')[0]).toHaveAttribute('data-selected', 'false'));
    });

    // Item 5 from the review: the no-destination path (an orphan cluster, or every suggestion ownerMissing)
    // used to leave the rest grid looking exactly as clickable as normal while silently doing nothing, with no
    // explanation anywhere. The self-move warning slot now also covers this distinct case.
    it('explains why staging is blocked, and disables the tiles, when no destination has been picked yet', async () => {
      const orphan = makeScanPerson({ suspectedOwners: [] });
      vi.mocked(getLatestScan).mockResolvedValue(makeCompletedScan([orphan]) as unknown as object);
      vi.mocked(getFaceRepairClusterFaces).mockResolvedValue({
        faces: [restFace('rest-1')],
        total: 1,
        hasMore: false,
      } as unknown as FaceRepairClusterFacesResponseDto);

      render(Page, { props: { data: makePageData() } });

      await waitFor(() => expect(screen.getByTestId('destination-pick-warning')).toBeInTheDocument());
      expect(screen.queryByTestId('destination-self-warning')).not.toBeInTheDocument();
      expect(screen.getByTestId('rest-tile')).toBeDisabled();
    });

    // The Promise.all in loadPersonData can land getFaceRepairPersonFaces on one scan and getLatestScan on
    // another, and withCurrentNames drops a person whose live flagged count is 0 while the frozen flaggedFaces
    // snapshot still lists it — either way scanPerson can be null even though there ARE flagged faces to
    // review. handleChooseOtherDestination early-returns with no scanPerson.ownerId to scope the picker to, so
    // the button must stop looking clickable rather than silently doing nothing while the page tells the admin
    // to pick a destination.
    it('disables "Choose someone else…" when scanPerson failed to resolve, even with flagged faces present', async () => {
      vi.mocked(getLatestScan).mockResolvedValue(makeCompletedScan([]) as unknown as object);

      render(Page, { props: { data: makePageData() } });

      await waitFor(() => expect(screen.getByTestId('destination-pick-warning')).toBeInTheDocument());
      expect(screen.getByTestId('destination-choose-other')).toBeDisabled();
    });

    // A prior version of this test only re-chose the default (OWNER_A_ID) after a dismiss with nothing ever
    // chosen first — that passes even with the dismiss-guard deleted, because `destinationId` falls back to
    // `selectable[0]` regardless. This version establishes a destination the fallback would NOT reproduce
    // (`chosen-1`, not one of the scan's own suggestions) before dismissing a second picker, so only a real
    // "leave it exactly as it was" guard can keep the assertion true.
    it('leaves an already-chosen destination in place when a later picker is dismissed', async () => {
      showModal.mockResolvedValueOnce({ personId: 'chosen-1', name: 'Chosen', lock: false });

      render(Page, { props: { data: makePageData() } });
      await waitFor(() => expect(chooser().value).toBe(OWNER_A_ID));

      await fireEvent.click(screen.getByTestId('destination-choose-other'));
      await waitFor(() => expect(chooser().value).toBe('chosen-1'));

      showModal.mockResolvedValueOnce(undefined);
      await fireEvent.click(screen.getByTestId('destination-choose-other'));

      await waitFor(() => expect(chooser().value).toBe('chosen-1'));
    });

    it('opens the destination picker without the re-flag lock it cannot honour', async () => {
      render(Page, { props: { data: makePageData() } });
      await waitFor(() => expect(screen.getByTestId('move-entire-btn')).toBeEnabled());

      await fireEvent.click(screen.getByTestId('destination-choose-other'));

      await waitFor(() => expect(showModal).toHaveBeenCalled());
      const props = showModal.mock.calls.at(-1)![1] as { showLock?: boolean };
      expect(props.showLock).toBe(false);
    });

    it('labels the tally generically when faces are bound for several destinations', async () => {
      render(Page, { props: { data: makePageData() } });

      await waitFor(() => expect(screen.getByTestId('tally')).toBeInTheDocument());
      expect(translations.some((t) => t.key === 'admin.face_cleanup_review_tally_owner_multi')).toBe(true);
    });

    it('keeps naming the owner in the tally when there is only one destination', async () => {
      const single = makeScanPerson({
        suspectedOwners: [
          {
            ownerPersonId: OWNER_A_ID,
            ownerName: 'Armin',
            thumbnailFaceId: null,
            count: 3,
            ownerFaceCount: 12,
            ownerMissing: false,
          },
        ],
      });
      vi.mocked(getLatestScan).mockResolvedValue(makeCompletedScan([single]) as unknown as object);

      render(Page, { props: { data: makePageData() } });

      await waitFor(() => expect(screen.getByTestId('tally')).toBeInTheDocument());
      expect(
        translations.some((t) => t.key === 'admin.face_cleanup_review_tally_owner' && t.values?.name === 'Armin'),
      ).toBe(true);
    });
  });

  describe('shared dock', () => {
    const renderAndLoad = async () => {
      render(Page, { props: { data: makePageData() } });
      await waitFor(() => expect(screen.getAllByTestId('face-tile')).toHaveLength(3));
    };

    const selectFirstTile = async () => {
      await fireEvent.click(screen.getAllByTestId('face-tile')[0]);
      await waitFor(() => expect(screen.getByTestId('face-bulk-bar')).toBeInTheDocument());
    };

    // G5 — the one button in either bar that had no testid before this change.
    it('routes the owner action from its own testid', async () => {
      await renderAndLoad();
      await selectFirstTile();

      await fireEvent.click(screen.getByTestId('bulk-owner'));

      expect(screen.getAllByTestId('face-tile')[0]).toHaveAttribute('data-state', 'owner');
    });

    // G1
    it('explains an action on hover, in the bar itself', async () => {
      await renderAndLoad();
      await selectFirstTile();

      await fireEvent.mouseEnter(screen.getByTestId('bulk-lock'));

      expect(screen.getByTestId('face-bulk-popover')).toHaveTextContent('admin.face_cleanup_action_lock_tip');
      expect(screen.getByTestId('face-bulk-hint')).toHaveTextContent('admin.face_cleanup_review_bulk_hint_effect');
    });

    // G4 — the page passes guided mode. Paired with the manual page's M5, this is what proves the two pages
    // diverge; the component spec alone would pass even if both pages hard-coded one mode.
    it('opens the help modal in guided mode, with guided’s six actions', async () => {
      await renderAndLoad();

      await fireEvent.click(screen.getByTestId('banner-help'));

      expect(showModal).toHaveBeenCalledWith(
        FaceActionsHelpModal,
        expect.objectContaining({
          mode: 'guided',
          actions: ['owner', 'stay', 'lock', 'other', 'unknown', 'detach'],
        }),
      );
    });

    // G2 + G3
    it('opens the same modal from the bulk bar as from the banner', async () => {
      await renderAndLoad();

      await fireEvent.click(screen.getByTestId('banner-help'));
      const fromBanner = showModal.mock.calls.at(-1);

      await selectFirstTile();
      await fireEvent.click(screen.getByTestId('face-bulk-help'));
      const fromBar = showModal.mock.calls.at(-1);

      // `.at(-1)` alone can't tell "the bar's launcher opened its own call" from "the bar's launcher is
      // dead and this is still the banner's call" — pin down the call count too.
      expect(showModal).toHaveBeenCalledTimes(2);
      expect(fromBar).toEqual(fromBanner);
    });

    // R11 at the level where testids actually live — the registry has none.
    it('gives every dock action a distinct testid', async () => {
      await renderAndLoad();
      await selectFirstTile();

      const ids = ['bulk-owner', 'bulk-stay', 'bulk-lock', 'bulk-other', 'bulk-unknown', 'bulk-detach'];
      for (const id of ids) {
        expect(screen.getAllByTestId(id)).toHaveLength(1);
      }
    });
  });

  it('renders a three-level breadcrumb trail with a working root and guided link', async () => {
    vi.mocked(getLatestScan).mockResolvedValue(
      makeCompletedScan([makeScanPerson({ personName: 'Aurelia' })]) as unknown as object,
    );

    render(Page, { props: { data: makePageData() } });

    const trail = () => within(screen.getByTestId('breadcrumbs'));

    await waitFor(() => {
      expect(trail().getByText('Aurelia')).toBeInTheDocument();
    });

    // The root must go to the landing page — it used to be labelled "Face cleanup" while pointing at /scan.
    expect(trail().getByRole('link', { name: 'admin.face_cleanup' })).toHaveAttribute('href', Route.faceCleanup());
    // The guided level used to be missing from this trail entirely.
    expect(trail().getByRole('link', { name: 'admin.face_cleanup_mode_guided' })).toHaveAttribute(
      'href',
      Route.faceCleanupScan(),
    );
    expect(trail().getAllByRole('link')).toHaveLength(2);
  });

  it.each([
    ['an empty name', ''],
    // `' '.repeat(3)` rather than a literal '   ' — the zero-warnings lint gate's unicorn/prefer-string-repeat.
    ['a whitespace-only name', ' '.repeat(3)],
  ])('falls back to the unnamed label for %s rather than a blank crumb', async (_label, personName) => {
    vi.mocked(getLatestScan).mockResolvedValue(
      makeCompletedScan([makeScanPerson({ personName })]) as unknown as object,
    );

    render(Page, { props: { data: makePageData() } });

    // Wait for the scan to RESOLVE before asserting. `waitFor` runs its first attempt synchronously, so an
    // assertion made straight after `render` is satisfied by the transient pre-resolution fallback (what the
    // loading-state test below pins) and would pass whether or not the name guard exists at all.
    await waitFor(() => expect(screen.getByTestId('flagged-grid')).toBeInTheDocument());

    expect(
      within(screen.getByTestId('breadcrumbs')).getByText('admin.face_cleanup_review_unnamed'),
    ).toBeInTheDocument();
  });

  it('shows the unnamed fallback in the trail until the scan resolves', async () => {
    vi.mocked(getLatestScan).mockResolvedValue(
      makeCompletedScan([makeScanPerson({ personName: 'Aurelia' })]) as unknown as object,
    );

    render(Page, { props: { data: makePageData() } });

    // Accepted pre-existing behaviour, pinned so a later refactor cannot turn the transient leaf into an
    // empty crumb. Mirrors the sibling assertion on people/[personId].
    expect(
      within(screen.getByTestId('breadcrumbs')).getByText('admin.face_cleanup_review_unnamed'),
    ).toBeInTheDocument();

    await waitFor(() => {
      expect(within(screen.getByTestId('breadcrumbs')).getByText('Aurelia')).toBeInTheDocument();
    });
  });

  // Not `async`: the back link is rendered unconditionally, so nothing here awaits, and the zero-warnings
  // lint gate's @typescript-eslint/require-await rejects an async function with no await.
  it('labels the in-page back link with where it actually goes', () => {
    vi.mocked(getLatestScan).mockResolvedValue(
      makeCompletedScan([makeScanPerson({ personName: 'Aurelia' })]) as unknown as object,
    );

    render(Page, { props: { data: makePageData() } });

    // Two links share this name and href by design — the crumb and the in-page back link. Exclude the trail
    // and assert on what is left, so this test is about the in-page link specifically.
    const backLinks = screen
      .getAllByRole('link', { name: 'admin.face_cleanup_mode_guided' })
      .filter((link) => !screen.getByTestId('breadcrumbs').contains(link));

    expect(backLinks).toHaveLength(1);
    expect(backLinks[0]).toHaveAttribute('href', Route.faceCleanupScan());
  });
});
