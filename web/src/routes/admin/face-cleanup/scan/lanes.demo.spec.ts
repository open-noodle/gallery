import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import ConfidentLane from './ConfidentLane.svelte';
import ReviewFirstLane from './ReviewFirstLane.svelte';
import { createScanTriageModel, type FaceCleanupPerson } from './scan-triage.svelte';

// Read-only demo gate for the two triage lanes rendered inside the face-cleanup scan page (ConfidentLane's
// approve action, ReviewFirstLane's dismiss action). Mirrors the harness in
// ../../maintenance/maintenance-page.spec.ts: a hoisted mockAuthManager and the auth-manager.svelte mock
// exposing isReadOnlyDemo via a getter. These are components, not pages, so no AdminPageLayout stub is needed.

const mockAuthManager = vi.hoisted(() => ({ isReadOnlyDemo: false }));

vi.mock('#lib/managers/auth-manager.svelte.ts', () => ({
  authManager: {
    get isReadOnlyDemo() {
      return mockAuthManager.isReadOnlyDemo;
    },
  },
}));

vi.mock('@immich/ui', async (orig) => {
  const mod = await orig<typeof import('@immich/ui')>();
  const noop = await import('#lib/gallery/__mocks__/noop-component.svelte');
  return { ...mod, Icon: noop.default };
});

vi.mock('svelte-i18n', async (orig) => {
  const actual = await orig<typeof import('svelte-i18n')>();
  return {
    ...actual,
    t: {
      subscribe: (run: (fn: (k: string, o?: unknown) => string) => void) => {
        run((k: string) => k);
        return () => {};
      },
    },
  };
});

vi.mock('#lib/utils/people-utils.ts', () => ({
  getAdminFaceThumbnailUrl: (id: string) => `/thumb/${id}`,
  getPeopleThumbnailPath: (id: string) => `/people/${id}/thumbnail`,
}));

// Minimal FaceCleanupPerson, shared base for both lane fixtures below.
const basePerson = (id: string): FaceCleanupPerson => ({
  personId: id,
  ownerId: 'owner-1',
  personName: null,
  faceCount: 10,
  thumbnailFaceId: `t-${id}`,
  eligible: 10,
  flagged: 2,
  flaggedFraction: 0.2,
  suspectedOwners: [
    { ownerPersonId: 'd', ownerName: 'Dest', thumbnailFaceId: 'f', count: 2, ownerFaceCount: 2, ownerMissing: false },
  ],
  recommendation: 'confident',
  reviewReasons: [],
});

// ConfidentLane's Props are `{ model: ScanTriageModel; ... }`, not a raw person list — build the model the
// same way the scan page does, via the real factory.
const laneModel = () => createScanTriageModel([basePerson('c1')]);

// ReviewFirstLane's Props take `people: FaceCleanupPerson[]` directly.
const reviewPerson = (): FaceCleanupPerson => ({
  ...basePerson('r1'),
  recommendation: 'review-first',
  reviewReasons: ['over-cap'],
});

describe('face-cleanup triage lanes — read-only demo', () => {
  beforeEach(() => {
    mockAuthManager.isReadOnlyDemo = false; // clearMocks resets spies only — this plain object needs its own reset
  });

  it('ConfidentLane shows the approve action to a real admin', async () => {
    await render(ConfidentLane, { props: { model: laneModel(), applying: false, onApprove: vi.fn() } });
    await expect.element(page.getByRole('button', { name: /apply|approve/i })).toBeInTheDocument();
  });

  it('ConfidentLane hides the approve action in read-only demo mode', async () => {
    mockAuthManager.isReadOnlyDemo = true;
    await render(ConfidentLane, { props: { model: laneModel(), applying: false, onApprove: vi.fn() } });
    await expect.element(page.getByRole('button', { name: /apply|approve/i })).not.toBeInTheDocument();
  });

  it('ReviewFirstLane shows the dismiss action to a real admin', async () => {
    await render(ReviewFirstLane, { props: { people: [reviewPerson()], users: [], onDismiss: vi.fn() } });
    await expect.element(page.getByRole('button', { name: /dismiss/i })).toBeInTheDocument();
  });

  it('ReviewFirstLane hides the dismiss action in read-only demo mode', async () => {
    mockAuthManager.isReadOnlyDemo = true;
    await render(ReviewFirstLane, { props: { people: [reviewPerson()], users: [], onDismiss: vi.fn() } });
    await expect.element(page.getByRole('button', { name: /dismiss/i })).not.toBeInTheDocument();
  });
});
