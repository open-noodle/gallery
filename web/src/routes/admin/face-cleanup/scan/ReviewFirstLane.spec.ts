import { Route } from '#lib/route.ts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page, userEvent } from 'vitest/browser';
import { recordTranslations } from '../i18n-recorder.test-helpers';
import ReviewFirstLane from './ReviewFirstLane.svelte';
import type { FaceCleanupPerson } from './scan-triage.svelte';

// The review-first lane: a clickable list of clusters the scan could not decide on its own. Each row is an
// <a> to the per-cluster review page (which commits inline); a hover ⋯/dismiss drops one without opening.
// Mocks match the sibling face-cleanup specs (Icon → noop, $t → key passthrough that DROPS {values}).

vi.mock('@immich/ui', async (orig) => {
  const mod = await orig<typeof import('@immich/ui')>();
  const noop = await import('#lib/gallery/__mocks__/noop-component.svelte');
  return { ...mod, Icon: noop.default };
});
// Every (key, options) pair the component asked to translate — the test locale renders keys verbatim
// (dropping {values}), so a test that needs to tell "count: 7" (the routing share) apart from "count: 1204"
// (the destination's own size) asserts on this instead of the rendered text. Same recorder as the sibling
// +page.svelte spec.
const translations = recordTranslations();

vi.mock('#lib/utils/people-utils.js', () => ({
  getAdminFaceThumbnailUrl: (id: string) => `/thumb/${id}`,
  getPeopleThumbnailPath: (id: string) => `/people/${id}/thumbnail`,
}));

beforeEach(() => {
  vi.stubGlobal(
    'confirm',
    vi.fn(() => true),
  );
  translations.length = 0;
});
afterEach(() => vi.unstubAllGlobals());

const rev = (over: Partial<FaceCleanupPerson> & Pick<FaceCleanupPerson, 'personId'>): FaceCleanupPerson => ({
  ownerId: 'owner-1',
  personName: null,
  faceCount: 35,
  thumbnailFaceId: 't',
  eligible: 35,
  flagged: 20,
  flaggedFraction: 0.57,
  // count (routing share) and ownerFaceCount (destination size) deliberately share no digits — a substring
  // match (e.g. `stringContaining('20')`) can't mistake "1,204" for the routing share this way, unlike the
  // original 20/1204 pair, which let a tooltip regression that swapped the two numbers pass unnoticed.
  suspectedOwners: [
    {
      ownerPersonId: 'd',
      ownerName: 'Pierre',
      thumbnailFaceId: 'f',
      count: 7,
      ownerFaceCount: 1204,
      ownerMissing: false,
    },
  ],
  recommendation: 'review-first',
  reviewReasons: ['over-cap'],
  ...over,
});
const users = [
  {
    id: 'owner-1',
    name: 'Owner One',
    email: 'o@e.com',
    profileImagePath: '',
    avatarColor: 'primary',
    profileChangedAt: '',
  },
] as never;

describe('ReviewFirstLane', () => {
  it('renders nothing when there is nothing to review', async () => {
    await render(ReviewFirstLane, { props: { people: [], users, onDismiss: vi.fn() } });
    expect(page.getByTestId('review-lane').query()).not.toBeInTheDocument();
  });

  it('renders each cluster as a row that links to its review page and shows the face count', async () => {
    await render(ReviewFirstLane, { props: { people: [rev({ personId: 'r1' })], users, onDismiss: vi.fn() } });
    const row = page.getByTestId('review-row-r1').element();
    expect(row).toHaveAttribute('href', Route.viewFaceCleanupPerson({ id: 'r1' }));
    expect(row).toMatchTextContent('35');
  });

  it('dismiss button calls onDismiss for that cluster (after confirm)', async () => {
    const onDismiss = vi.fn();
    await render(ReviewFirstLane, { props: { people: [rev({ personId: 'r1' })], users, onDismiss } });
    await userEvent.click(page.getByTestId('review-dismiss-r1').element());
    expect(onDismiss).toHaveBeenCalledWith('r1');
  });

  it('does not call onDismiss when the confirm is declined', async () => {
    vi.stubGlobal(
      'confirm',
      vi.fn(() => false),
    );
    const onDismiss = vi.fn();
    await render(ReviewFirstLane, { props: { people: [rev({ personId: 'r1' })], users, onDismiss } });
    await userEvent.click(page.getByTestId('review-dismiss-r1').element());
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('search filters rows by person name or suspected-owner name', async () => {
    await render(ReviewFirstLane, {
      props: {
        people: [rev({ personId: 'r1', personName: 'Alice' }), rev({ personId: 'r2', personName: 'Bob' })],
        users,
        onDismiss: vi.fn(),
      },
    });
    await userEvent.fill(page.getByTestId('review-search').element(), 'alice');
    expect(page.getByTestId('review-row-r1').element()).toBeInTheDocument();
    expect(page.getByTestId('review-row-r2').query()).not.toBeInTheDocument();
  });

  it('marks a bad-target row as a weak/uncertain destination', async () => {
    await render(ReviewFirstLane, {
      props: { people: [rev({ personId: 'r1', reviewReasons: ['bad-target'] })], users, onDismiss: vi.fn() },
    });
    expect(page.getByTestId('review-row-r1').element()).toMatchTextContent('admin.face_cleanup_bad_target');
  });

  it('renders a header row naming every column', async () => {
    await render(ReviewFirstLane, { props: { people: [rev({ personId: 'r1' })], users, onDismiss: vi.fn() } });
    const header = page.getByTestId('review-header').element();
    expect(header).toMatchTextContent('admin.face_cleanup_col_cluster');
    expect(header).toMatchTextContent('admin.face_cleanup_col_flagged');
    expect(header).toMatchTextContent('admin.face_cleanup_col_destination');
    expect(header).toMatchTextContent('admin.face_cleanup_col_reasons');
  });

  it('a multi-reason row shows the primary pill plus "+N" and lists every reason in the tooltip', async () => {
    await render(ReviewFirstLane, {
      props: {
        people: [rev({ personId: 'r1', reviewReasons: ['large-cluster', 'named'] })],
        users,
        onDismiss: vi.fn(),
      },
    });
    const reasons = page.getByTestId('review-reasons-r1').element();
    expect(reasons).toMatchTextContent('admin.face_cleanup_reason_large_cluster');
    expect(reasons).toMatchTextContent('+1');
    expect(reasons).not.toMatchTextContent('admin.face_cleanup_reason_named');
    expect(reasons).toHaveAttribute(
      'title',
      'admin.face_cleanup_reason_large_cluster · admin.face_cleanup_reason_named',
    );
  });

  it('bad-target wins the primary pill regardless of its position in the reason list', async () => {
    await render(ReviewFirstLane, {
      props: {
        people: [rev({ personId: 'r1', reviewReasons: ['large-cluster', 'bad-target'] })],
        users,
        onDismiss: vi.fn(),
      },
    });
    const reasons = page.getByTestId('review-reasons-r1').element();
    expect(reasons).toMatchTextContent('admin.face_cleanup_reason_bad_target');
    expect(reasons).toMatchTextContent('+1');
  });

  it('an unknown reason id falls back to its raw id in pill and tooltip', async () => {
    await render(ReviewFirstLane, {
      props: { people: [rev({ personId: 'r1', reviewReasons: ['mystery-reason'] })], users, onDismiss: vi.fn() },
    });
    const reasons = page.getByTestId('review-reasons-r1').element();
    expect(reasons).toMatchTextContent('mystery-reason');
    expect(reasons).toHaveAttribute('title', 'mystery-reason');
  });

  it('a row with no reasons still reserves an empty reasons cell', async () => {
    await render(ReviewFirstLane, {
      props: { people: [rev({ personId: 'r1', reviewReasons: [] })], users, onDismiss: vi.fn() },
    });
    expect(page.getByTestId('review-reasons-r1').element()).toBeEmptyDOMElement();
  });

  // Regression guard, not a red test: this PASSES before and after the change. It pins the row content of
  // the % and destination cells so a botched class-constant repoint in Step 4c (e.g. a lost `sm:block`)
  // can't silently blank a column — no other test asserts these cells at all.
  it('keeps the flagged share and destination visible in their fixed columns', async () => {
    await render(ReviewFirstLane, { props: { people: [rev({ personId: 'r1' })], users, onDismiss: vi.fn() } });
    const row = page.getByTestId('review-row-r1').element();
    expect(row).toMatchTextContent('57%');
    expect(row).toMatchTextContent('20/35');
    expect(row).toMatchTextContent('Pierre');
  });

  describe('destination column', () => {
    it("shows the destination's own size beneath its name, not the number of faces routing there", async () => {
      await render(ReviewFirstLane, { props: { people: [rev({ personId: 'p1' })], users, onDismiss: vi.fn() } });

      expect(page.getByText(/1,204/).element()).toBeInTheDocument();
      expect(page.getByText(/^7 /).query()).not.toBeInTheDocument();
    });

    it('keeps the bad-target warning in place of the count', async () => {
      await render(ReviewFirstLane, {
        props: { people: [rev({ personId: 'p1', reviewReasons: ['bad-target'] })], users, onDismiss: vi.fn() },
      });

      expect(page.getByText('admin.face_cleanup_bad_target', { exact: true }).element()).toBeInTheDocument();
      expect(page.getByText(/1,204/).query()).not.toBeInTheDocument();
    });

    it('puts the routing share in the row tooltip, not the destination size', async () => {
      await render(ReviewFirstLane, { props: { people: [rev({ personId: 'p1' })], users, onDismiss: vi.fn() } });

      const title = page.getByTestId('review-destination-p1').element().getAttribute('title');
      // Same key DestinationCards uses for this exact number, so the mocked $t renders it verbatim here too —
      // the literal digits are gone the moment {values} passes through the mock (see `translations` below),
      // so this only pins that the ROUTING key (not some ad hoc string) drives the tooltip.
      expect(title).toContain('admin.face_cleanup_review_dest_routes');
      expect(title).not.toContain('1,204');
      expect(title).not.toContain('1204');

      // Closes what the substring check above can't: the swap this guards against — rendering ownerFaceCount
      // (1204) instead of count (7) — would still contain the same key and pass the checks above. Asserting
      // the actual value handed to $t is the only way this goes red on that swap.
      const call = translations.find((entry) => entry.key === 'admin.face_cleanup_review_dest_routes');
      expect(call?.values).toEqual({ count: 7 });
    });
  });
});
