import { getFaceRepairResolutions, removeFaceRepairResolutions } from '@immich/sdk';
import { toastManager } from '@immich/ui';
import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { init, locale, register, waitLocale } from 'svelte-i18n';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Route } from '$lib/route';
import Page from './+page.svelte';

// Unified resolutions manage page: NEGATIVE verdicts only ("this face is not that person"), from BOTH
// engines, with a source filter. Human placements are not listed here (undone in context on the review page).
vi.mock('@immich/sdk', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@immich/sdk')>();
  return {
    ...actual,
    getFaceRepairResolutions: vi.fn(),
    removeFaceRepairResolutions: vi.fn(),
    getPeopleThumbnailPath: (id: string) => `/people/${id}/thumbnail`,
  };
});

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
  };
});

// Render against the REAL translations (matches PersonPicker.spec.ts / *ActionsHelpModal.spec.ts). The
// previous key-passthrough mock accepted only the key and dropped `{ values }`, so every attribution
// assertion collapsed to the same constant string, identical for every row — targetName() could return the
// wrong person and every test would still pass. Real interpolation is what makes those assertions
// discriminating.
beforeAll(async () => {
  register('en', () => import('$i18n/en.json'));
  await init({ fallbackLocale: 'en', initialLocale: 'en' });
  await waitLocale('en');
});

vi.mock('$app/navigation', () => ({
  goto: vi.fn(),
  afterNavigate: vi.fn(),
  beforeNavigate: vi.fn(),
  onNavigate: vi.fn(),
}));

vi.mock('$app/stores', () => ({
  page: {
    subscribe: vi.fn((run) => {
      run({ url: new URL('http://localhost/admin/face-cleanup/resolutions') });
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

vi.mock('$lib/components/layouts/AdminPageLayout.svelte', async () => {
  const { default: stub } = await import('@test-data/mocks/admin-page-layout.stub.svelte');
  return { default: stub };
});

// ---- fixtures ----

const CLEANUP_ROW = {
  id: 'verdict-1',
  assetFaceId: 'face-1',
  status: 'rejected',
  source: 'cleanup',
  personId: 'person-1',
  personName: 'Berta',
  personThumbnailFaceId: null,
  spacePersonId: null,
  spacePersonName: null,
  spaceName: null,
  actorId: 'admin-1',
  actorName: 'Admin',
  createdAt: '2026-07-01T00:00:00.000Z',
};

const SUGGESTION_ROW = {
  id: 'verdict-2',
  assetFaceId: 'face-2',
  status: 'ignored',
  source: 'suggestion',
  personId: 'person-2',
  personName: 'Armin',
  personThumbnailFaceId: null,
  spacePersonId: null,
  spacePersonName: null,
  spaceName: null,
  actorId: 'user-1',
  actorName: 'Jula',
  createdAt: '2026-07-02T00:00:00.000Z',
};

// A verdict recorded against a shared-space person, never a personal person — must render with the space
// named (D15 1.4a). Also carries a representativeFaceId projection (F23/S11.17) so it can render a
// thumbnail the same way a personal target's row already does.
const SPACE_PERSON_ROW = {
  id: 'verdict-3',
  assetFaceId: 'face-3',
  status: 'rejected',
  source: 'cleanup',
  personId: null,
  personName: null,
  personThumbnailFaceId: null,
  spacePersonId: 'space-person-1',
  spacePersonName: 'Casper',
  spacePersonThumbnailFaceId: 'repr-face-1',
  spaceName: 'Family Trip',
  actorId: 'admin-1',
  actorName: 'Admin',
  createdAt: '2026-07-03T00:00:00.000Z',
};

// A fully-orphaned verdict: the suspected owner AND its identity were both GC'd/degraded away after the
// verdict was recorded (personId + spacePersonId both SET NULL, no identity survives either) — the row must
// still render as a valid row (as a deleted target), never throw (D15 1.4b).
const ORPHANED_ROW = {
  id: 'verdict-4',
  assetFaceId: 'face-4',
  status: 'ignored',
  source: 'suggestion',
  personId: null,
  personName: null,
  personThumbnailFaceId: null,
  spacePersonId: null,
  spacePersonName: null,
  spaceName: null,
  actorId: null,
  actorName: null,
  createdAt: '2026-07-04T00:00:00.000Z',
};

describe('+page.svelte (face-cleanup resolutions)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getFaceRepairResolutions).mockResolvedValue({
      total: 2,
      resolutions: [CLEANUP_ROW, SUGGESTION_ROW],
    } as unknown as Awaited<ReturnType<typeof getFaceRepairResolutions>>);
    vi.mocked(removeFaceRepairResolutions).mockResolvedValue({ removed: 1 });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('lists verdicts from both engines with their source, target and actor', async () => {
    render(Page, { props: { data: { meta: { title: 'Resolutions' } } } });

    await waitFor(() => expect(screen.getAllByTestId('resolution-row')).toHaveLength(2));

    const rows = screen.getAllByTestId('resolution-row');
    expect(rows.map((r) => r.dataset.source).sort((a, b) => (a ?? '').localeCompare(b ?? ''))).toEqual([
      'cleanup',
      'suggestion',
    ]);

    const cleanupRow = rows.find((r) => r.dataset.source === 'cleanup')!;
    const suggestionRow = rows.find((r) => r.dataset.source === 'suggestion')!;

    // Target name resolves to the ACTUAL person on each row (Berta / Armin), not a shared constant —
    // discriminating per row. With the old key-passthrough i18n mock both rows rendered the identical
    // literal key string regardless of which person the row was actually about.
    expect(within(cleanupRow).getByText('not Berta')).toBeInTheDocument();
    expect(within(suggestionRow).getByText('not Armin')).toBeInTheDocument();

    // Source label + actor, per row — both previously unqueried by any test. The actor span renders as
    // "· by <name>" (a leading bullet separator), hence the substring match.
    expect(within(cleanupRow).getByTestId('source-label')).toHaveTextContent('Admin cleanup');
    expect(within(cleanupRow).getByText(/by Admin/)).toBeInTheDocument();
    expect(within(suggestionRow).getByTestId('source-label')).toHaveTextContent('User review');
    expect(within(suggestionRow).getByText(/by Jula/)).toBeInTheDocument();
  });

  // The page lists NEGATIVE verdicts only, and that scope used to live solely in a source comment. An admin
  // who cleans up a person by moving/confirming faces writes no negative verdict at all (only "keep here"
  // does — face-repair.service.ts, the sole `source: 'cleanup'` writer), so they arrive here to a list that
  // looks like it lost their work. The subtitle is the only thing on the page that explains that, so it must
  // render whether or not there are rows — the empty states are exactly when it is needed most.
  it('states the page scope in a subtitle, alongside rows', async () => {
    render(Page, { props: { data: { meta: { title: 'Resolutions' } } } });

    await waitFor(() => expect(screen.getAllByTestId('resolution-row')).toHaveLength(2));

    const subtitle = screen.getByTestId('resolutions-subtitle');
    expect(subtitle).toHaveTextContent('Only "not this person" decisions appear here');
    expect(subtitle).toHaveTextContent("undone on that person's review page");
  });

  it('keeps the scope subtitle in the empty state, where it explains the emptiness', async () => {
    vi.mocked(getFaceRepairResolutions).mockResolvedValue({ total: 0, resolutions: [] } as unknown as Awaited<
      ReturnType<typeof getFaceRepairResolutions>
    >);

    render(Page, { props: { data: { meta: { title: 'Resolutions' } } } });

    await waitFor(() => expect(screen.getByText('No decisions recorded yet')).toBeInTheDocument());
    expect(screen.getByTestId('resolutions-subtitle')).toHaveTextContent(
      'Only "not this person" decisions appear here',
    );
  });

  it('renders a space-person verdict with its space named, and a fully-orphaned verdict as a deleted target', async () => {
    vi.mocked(getFaceRepairResolutions).mockResolvedValue({
      total: 2,
      resolutions: [SPACE_PERSON_ROW, ORPHANED_ROW],
    } as unknown as Awaited<ReturnType<typeof getFaceRepairResolutions>>);

    render(Page, { props: { data: { meta: { title: 'Resolutions' } } } });

    await waitFor(() => expect(screen.getAllByTestId('resolution-row')).toHaveLength(2));

    const rows = screen.getAllByTestId('resolution-row');
    const spacePersonRow = rows.find((r) => r.dataset.source === 'cleanup')!;
    const orphanedRow = rows.find((r) => r.dataset.source === 'suggestion')!;

    // (a) space-person row: target name resolves to the SPACE PERSON (Casper), not the personal fallback,
    // and the space is named alongside it.
    expect(within(spacePersonRow).getByText('not Casper')).toBeInTheDocument();
    expect(within(spacePersonRow).getByText('in Family Trip')).toBeInTheDocument();

    // (b) fully-orphaned row: no crash, and reads as a deleted target — a positive control that the
    // no-target branch itself renders correctly, not just that SOME text is present.
    expect(within(orphanedRow).getByText('not Deleted target')).toBeInTheDocument();
    // No actor for the orphaned row (actorId/actorName both null) — the positive control for "by <actor>"
    // rendering at all is the cleanup row's "by Admin" assertion in the previous test.
    expect(within(orphanedRow).queryByText(/^by /)).not.toBeInTheDocument();
  });

  // S12.7/F30: "the target row still exists but was never named" and "the target row is gone" must read
  // differently, and each must get the label that matches its own state.
  //
  // Which fixture shapes are legal is fixed by the schema, not by taste: `person.name` /
  // `shared_space_person.name` are NOT NULL DEFAULT '', and both target FKs are ON DELETE SET NULL. So
  // listNegativeVerdicts can only ever emit (a) an intact id beside an EMPTY-STRING name — a live cluster
  // nobody has named — or (b) a NULL id, meaning the target row was deleted out from under the verdict. A
  // non-null `personId` beside `personName: null` is unreachable, so a fixture using that shape pins
  // nothing.
  it('labels a live unnamed target "unnamed" and a target-deleted verdict "deleted"', async () => {
    const liveUnnamedRow = {
      ...CLEANUP_ROW,
      id: 'verdict-5',
      assetFaceId: 'face-5',
      personId: 'person-5',
      personName: '',
    };

    vi.mocked(getFaceRepairResolutions).mockResolvedValue({
      total: 2,
      resolutions: [liveUnnamedRow, ORPHANED_ROW],
    } as unknown as Awaited<ReturnType<typeof getFaceRepairResolutions>>);

    render(Page, { props: { data: { meta: { title: 'Resolutions' } } } });

    await waitFor(() => expect(screen.getAllByTestId('resolution-row')).toHaveLength(2));

    const rows = screen.getAllByTestId('resolution-row');
    const liveRow = rows.find((r) => r.dataset.source === 'cleanup')!;
    const orphanedRow = rows.find((r) => r.dataset.source === 'suggestion')!;

    // The person still exists — it just has no name. Calling that "deleted" tells the admin the opposite
    // of the truth.
    expect(within(liveRow).getByText('not Unnamed cluster')).toBeInTheDocument();
    expect(within(liveRow).queryByText('not Deleted target')).not.toBeInTheDocument();

    // Positive control, same code path, opposite input: nothing survived here, so this is the row that
    // earns the "deleted" label. The two states use different i18n keys, not just different data.
    expect(within(orphanedRow).getByText('not Deleted target')).toBeInTheDocument();
    expect(within(orphanedRow).queryByText('not Unnamed cluster')).not.toBeInTheDocument();
  });

  it('filters by source', async () => {
    render(Page, { props: { data: { meta: { title: 'Resolutions' } } } });

    await waitFor(() => expect(screen.getAllByTestId('resolution-row')).toHaveLength(2));

    const cleanupFilter = screen.getAllByTestId('source-filter-option').find((el) => el.dataset.value === 'cleanup')!;
    await fireEvent.click(cleanupFilter);

    await waitFor(() => {
      const rows = screen.getAllByTestId('resolution-row');
      expect(rows).toHaveLength(1);
      expect(rows[0]).toHaveAttribute('data-source', 'cleanup');
    });
  });

  it('undoing a row posts removeFaceRepairResolutions with verdictIds and refreshes', async () => {
    render(Page, { props: { data: { meta: { title: 'Resolutions' } } } });

    await waitFor(() => expect(screen.getAllByTestId('resolution-row')).toHaveLength(2));

    const firstRow = screen.getAllByTestId('resolution-row')[0];
    await fireEvent.click(within(firstRow).getByTestId('undo-button'));

    await waitFor(() => {
      expect(removeFaceRepairResolutions).toHaveBeenCalledWith({
        faceRepairResolutionsRemoveRequestDto: {
          verdictIds: [firstRow.dataset.source === 'cleanup' ? 'verdict-1' : 'verdict-2'],
        },
      });
      expect(toastManager.success).toHaveBeenCalled();
      expect(getFaceRepairResolutions).toHaveBeenCalledTimes(2);
    });
  });

  // Slice 11 (F23): the server now paginates (see face-person-verdict.repository.ts listNegativeVerdicts) —
  // the page renders page 1, offers a "Load more" once more exist, and a space-person row (previously a KNOWN
  // GAP left by Slice 12) renders a thumbnail via the same face-keyed admin route a personal row already
  // uses.
  it('S11.18: renders page 1, loads more on demand, tracks the server total, and a space-person row renders a thumbnail', async () => {
    const page2Row = { ...SUGGESTION_ROW, id: 'verdict-page2', assetFaceId: 'face-page2', personName: 'Zed' };
    vi.mocked(getFaceRepairResolutions)
      .mockResolvedValueOnce({
        total: 3,
        resolutions: [SPACE_PERSON_ROW, CLEANUP_ROW],
      } as unknown as Awaited<ReturnType<typeof getFaceRepairResolutions>>)
      .mockResolvedValueOnce({
        total: 3,
        resolutions: [page2Row],
      } as unknown as Awaited<ReturnType<typeof getFaceRepairResolutions>>);

    render(Page, { props: { data: { meta: { title: 'Resolutions' } } } });

    await waitFor(() => expect(screen.getAllByTestId('resolution-row')).toHaveLength(2));
    // Total matches the server total (3), not just what's loaded so far (2).
    expect(screen.getByTestId('resolutions-load-more')).toHaveTextContent('1');
    // S11b: the FIRST load asks for page 1 explicitly. Until the SDK carried page/size, this page
    // re-requested the server's default page every time and de-duplicated by id, so "Load more" was a
    // silent no-op that this test could not tell apart from working pagination.
    expect(getFaceRepairResolutions).toHaveBeenNthCalledWith(1, expect.objectContaining({ page: 1 }));

    // The space-person row (Casper) renders a thumbnail — the KNOWN GAP the comment in this file used to
    // describe. Positive control in the same test: the personal row (Berta) already renders one too, via the
    // SAME face-keyed helper, proving the assertion actually distinguishes "has an img" from "doesn't".
    const rows = screen.getAllByTestId('resolution-row');
    const spaceRow = rows.find((r) => within(r).queryByText('not Casper'))!;
    const personalRow = rows.find((r) => within(r).queryByText('not Berta'))!;
    expect(within(spaceRow).getByTestId('target-thumbnail')).toHaveAttribute(
      'src',
      expect.stringContaining('repr-face-1'),
    );
    expect(within(personalRow).getByTestId('target-thumbnail')).toBeInTheDocument();

    await fireEvent.click(screen.getByTestId('resolutions-load-more'));

    await waitFor(() => expect(getFaceRepairResolutions).toHaveBeenCalledTimes(2));
    // S11b: and "Load more" asks for page 2 — the assertion that actually distinguishes real paging from
    // re-fetching page 1 and filtering duplicates out client-side.
    expect(getFaceRepairResolutions).toHaveBeenNthCalledWith(2, expect.objectContaining({ page: 2 }));
    await waitFor(() => expect(screen.getAllByTestId('resolution-row')).toHaveLength(3));
    // Page 1's rows are still there — load-more APPENDS, it does not replace.
    expect(screen.getByText('not Casper')).toBeInTheDocument();
    expect(screen.getByText('not Berta')).toBeInTheDocument();
    expect(screen.getByText('not Zed')).toBeInTheDocument();
    // Every row now loaded — the "Load more" affordance is gone.
    expect(screen.queryByTestId('resolutions-load-more')).not.toBeInTheDocument();
  });

  it('shows the empty state when there are no verdicts', async () => {
    vi.mocked(getFaceRepairResolutions).mockResolvedValue({ total: 0, resolutions: [] } as unknown as Awaited<
      ReturnType<typeof getFaceRepairResolutions>
    >);

    render(Page, { props: { data: { meta: { title: 'Resolutions' } } } });

    await waitFor(() => {
      expect(screen.getByText('No decisions recorded yet')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('resolution-row')).not.toBeInTheDocument();
  });

  it('sends the empty-state button to the console landing page', async () => {
    vi.mocked(getFaceRepairResolutions).mockResolvedValue({ total: 0, resolutions: [] } as unknown as Awaited<
      ReturnType<typeof getFaceRepairResolutions>
    >);

    render(Page, { props: { data: { meta: { title: 'Resolutions' } } } });

    // Real en.json is loaded in this file — 'No decisions recorded yet' is the actual value of
    // admin.face_cleanup_resolutions_empty, matching the sibling empty-state test above.
    await waitFor(() => {
      expect(screen.getByText('No decisions recorded yet')).toBeInTheDocument();
    });

    // The button used to point at /scan while being labelled "Face cleanup". Exclude the trail so this is
    // about the button, not the crumb that now shares its name and href.
    const buttons = screen
      .getAllByRole('link', { name: 'Face cleanup' })
      .filter((link) => !screen.getByTestId('breadcrumbs').contains(link));

    expect(buttons).toHaveLength(1);
    expect(buttons[0]).toHaveAttribute('href', Route.faceCleanup());
  });

  // S12.6/F30: the empty state used to branch on the FILTERED list alone, so a filter that excludes every row
  // rendered the same "no decisions recorded yet" as a genuinely empty account — telling the admin their
  // filter selection had erased history that is actually still there. Positive control (never-recorded) is
  // the previous test; this test's own body also covers it via `rows-present-then-filtered`.
  it('shows a distinct "filter excluded everything" message when rows exist but none match the active filter', async () => {
    vi.mocked(getFaceRepairResolutions).mockResolvedValue({
      total: 1,
      resolutions: [CLEANUP_ROW],
    } as unknown as Awaited<ReturnType<typeof getFaceRepairResolutions>>);

    render(Page, { props: { data: { meta: { title: 'Resolutions' } } } });
    await waitFor(() => expect(screen.getAllByTestId('resolution-row')).toHaveLength(1));

    const suggestionFilter = screen
      .getAllByTestId('source-filter-option')
      .find((el) => el.dataset.value === 'suggestion')!;
    await fireEvent.click(suggestionFilter);

    await waitFor(() => {
      expect(screen.queryByTestId('resolution-row')).not.toBeInTheDocument();
      // The never-recorded message must NOT appear here — the row IS there, just filtered out. The whole list
      // is loaded (total === 1), so the state names the empty source rather than the neutral wording.
      expect(screen.queryByText('No decisions recorded yet')).not.toBeInTheDocument();
      expect(screen.getByText('No user review decisions yet')).toBeInTheDocument();
    });
  });

  // The filtered-empty state has to answer the question the admin actually has ("where did my work go?"),
  // so when the whole list is loaded it names the empty source, counts what the filter is hiding, and offers
  // one click back. "Loaded" is the load-bearing qualifier: `filtered` derives from `resolutions`, which holds
  // only the pages fetched so far, so this precise claim is only sound when there is nothing left to fetch.
  it('names the empty source and counts the hidden rows once the whole list is loaded', async () => {
    vi.mocked(getFaceRepairResolutions).mockResolvedValue({
      total: 1,
      resolutions: [SUGGESTION_ROW],
    } as unknown as Awaited<ReturnType<typeof getFaceRepairResolutions>>);

    render(Page, { props: { data: { meta: { title: 'Resolutions' } } } });
    await waitFor(() => expect(screen.getAllByTestId('resolution-row')).toHaveLength(1));

    const cleanupFilter = screen.getAllByTestId('source-filter-option').find((el) => el.dataset.value === 'cleanup')!;
    await fireEvent.click(cleanupFilter);

    await waitFor(() => expect(screen.queryByTestId('resolution-row')).not.toBeInTheDocument());
    expect(screen.getByText('No admin cleanup decisions yet')).toBeInTheDocument();
    expect(screen.getByText('1 decision from the other source is hidden by this filter')).toBeInTheDocument();
    // Never the never-recorded message: the rows ARE there.
    expect(screen.queryByText('No decisions recorded yet')).not.toBeInTheDocument();

    // One click back to the full list.
    await fireEvent.click(screen.getByTestId('empty-filtered-show-all'));
    await waitFor(() => expect(screen.getAllByTestId('resolution-row')).toHaveLength(1));
  });

  // The inverse, and the reason the precise copy is conditional: with pages still unfetched, a source with no
  // match among the LOADED rows may still have matches further down, so claiming "none yet" would be a lie of
  // exactly the kind this page keeps producing. Falls back to the neutral wording, and — since the rows branch
  // owns the Load more button — must surface its own, or the filter is a dead end with no way to fetch on.
  it('does not claim a source is empty while pages are still unloaded, and still offers Load more', async () => {
    vi.mocked(getFaceRepairResolutions).mockResolvedValue({
      total: 5,
      resolutions: [SUGGESTION_ROW],
    } as unknown as Awaited<ReturnType<typeof getFaceRepairResolutions>>);

    render(Page, { props: { data: { meta: { title: 'Resolutions' } } } });
    await waitFor(() => expect(screen.getAllByTestId('resolution-row')).toHaveLength(1));

    const cleanupFilter = screen.getAllByTestId('source-filter-option').find((el) => el.dataset.value === 'cleanup')!;
    await fireEvent.click(cleanupFilter);

    await waitFor(() => expect(screen.queryByTestId('resolution-row')).not.toBeInTheDocument());
    expect(screen.queryByText('No admin cleanup decisions yet')).not.toBeInTheDocument();
    expect(screen.getByText('No decisions match this filter')).toBeInTheDocument();
    expect(screen.getByTestId('resolutions-load-more')).toBeInTheDocument();
  });

  // ---- D17: a failed INITIAL load must not render as the reassuring "no verdicts" empty state ----

  it('shows a load-error state (not the empty state) when the initial fetch fails, and Retry re-fetches', async () => {
    vi.mocked(getFaceRepairResolutions).mockRejectedValueOnce(new Error('network down'));

    render(Page, { props: { data: { meta: { title: 'Resolutions' } } } });

    await waitFor(() => {
      expect(screen.getByTestId('load-error-banner')).toBeInTheDocument();
    });
    expect(screen.queryByText('No decisions recorded yet')).not.toBeInTheDocument();

    vi.mocked(getFaceRepairResolutions).mockResolvedValueOnce({
      total: 2,
      resolutions: [CLEANUP_ROW, SUGGESTION_ROW],
    } as unknown as Awaited<ReturnType<typeof getFaceRepairResolutions>>);
    await fireEvent.click(screen.getByTestId('load-error-retry'));

    await waitFor(() => {
      expect(screen.getAllByTestId('resolution-row')).toHaveLength(2);
      expect(screen.queryByTestId('load-error-banner')).not.toBeInTheDocument();
    });
  });

  it('renders a breadcrumb trail back to the face cleanup landing page', async () => {
    render(Page, { props: { data: { meta: { title: 'Resolutions' } } } });

    const trail = within(screen.getByTestId('breadcrumbs'));

    // Real en.json is loaded in this file, so these are English strings, not raw keys.
    // The root used to point at /scan; Resolutions is a peer of the two modes, not a child of guided.
    await waitFor(() => {
      expect(trail.getByRole('link', { name: 'Face cleanup' })).toHaveAttribute('href', Route.faceCleanup());
    });

    expect(trail.getByText('Resolutions')).toBeInTheDocument();
    expect(trail.getAllByRole('link')).toHaveLength(1);
  });

  // S12.8/F30: the three filter-chip labels were built once, at component init, into a plain (non-reactive)
  // array — so switching locale mid-session left them stuck in whatever language was active on first render.
  afterEach(async () => {
    // Always leave the shared svelte-i18n `locale` store back on 'en' for the next test in this file, even if
    // the assertion above throws.
    await locale.set('en');
    await waitLocale('en');
  });

  it('updates the three filter chip labels when the locale changes', async () => {
    register('resolutions-test-locale', () =>
      Promise.resolve({
        admin: {
          face_cleanup_resolutions_filter_all: 'Toutes les sources',
          face_cleanup_resolutions_filter_cleanup: 'Nettoyage admin',
          face_cleanup_resolutions_filter_suggestion: 'Avis utilisateur',
        },
      }),
    );

    render(Page, { props: { data: { meta: { title: 'Resolutions' } } } });
    await waitFor(() => expect(screen.getAllByTestId('resolution-row')).toHaveLength(2));

    // Scoped to the filter-chip strip: `source-label` spans in the rows below also say "Admin cleanup" /
    // "User review(s)", which would otherwise make these queries ambiguous.
    const filterStrip = () => within(screen.getByTestId('source-filter'));

    // Positive control: the English labels render first, under the locale active at mount.
    expect(filterStrip().getByText('All sources')).toBeInTheDocument();
    expect(filterStrip().getByText('Admin cleanup')).toBeInTheDocument();
    expect(filterStrip().getByText('User reviews')).toBeInTheDocument();

    await locale.set('resolutions-test-locale');
    await waitLocale('resolutions-test-locale');

    await waitFor(() => {
      expect(filterStrip().getByText('Toutes les sources')).toBeInTheDocument();
      expect(filterStrip().getByText('Nettoyage admin')).toBeInTheDocument();
      expect(filterStrip().getByText('Avis utilisateur')).toBeInTheDocument();
    });
    expect(filterStrip().queryByText('All sources')).not.toBeInTheDocument();
    expect(filterStrip().queryByText('Admin cleanup')).not.toBeInTheDocument();
    expect(filterStrip().queryByText('User reviews')).not.toBeInTheDocument();
  });
});
