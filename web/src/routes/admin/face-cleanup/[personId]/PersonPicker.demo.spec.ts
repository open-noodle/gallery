import { getFaceRepairOwnerPeople } from '@immich/sdk';
import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import PersonPicker from './PersonPicker.svelte';

// Read-only demo gate for the picker's "Create new person" row — the one affordance in this modal that
// WRITES (createFaceRepairOwnerPerson, a POST the demo user is refused). Search and row selection are
// deliberately left working: neither mutates anything, and a picker that could not be browsed would make
// the "Move to…" bulk action a dead end for a demo visitor rather than a read-only exhibit.
//
// Kept separate from PersonPicker.spec.ts, which registers the real en.json and asserts on English prose:
// this file mocks the auth manager instead and keys off data-testid, matching the sibling *.demo.spec.ts
// harness (a hoisted mockAuthManager exposing isReadOnlyDemo via a getter).

const mockAuthManager = vi.hoisted(() => ({ isReadOnlyDemo: false }));

vi.mock('$lib/managers/auth-manager.svelte', () => ({
  authManager: {
    get isReadOnlyDemo() {
      return mockAuthManager.isReadOnlyDemo;
    },
  },
}));

vi.mock('@immich/sdk', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@immich/sdk')>();
  return {
    ...actual,
    getFaceRepairOwnerPeople: vi.fn(),
    createFaceRepairOwnerPerson: vi.fn(),
    getPeopleThumbnailPath: (id: string) => `/people/${id}/thumbnail`,
  };
});

// Drain bits-ui Modal's deferred body-scroll-lock cleanup before happy-dom tears down `document` (same
// convention as PersonPicker.spec.ts / AdvancedScanModal.spec.ts).
afterEach(async () => {
  await new Promise((resolve) => setTimeout(resolve, 500));
});

const OWNER_ID = 'owner-user-1';

const makePeopleResponse = () => ({
  people: [{ id: 'p1', name: 'Marco Weber', faceCount: 412, thumbnailFaceId: 'f1' }],
  total: 1,
  hasMore: false,
});

// Types a query, which is what makes the create row eligible to render at all — without it the row is
// absent for everyone and the demo assertion below could not fail.
const renderWithQuery = async () => {
  const result = render(PersonPicker, { props: { ownerId: OWNER_ID, faceCount: 3, onClose: vi.fn() } });
  await waitFor(() => expect(screen.getByTestId('person-picker-search')).toBeInTheDocument());
  await fireEvent.input(screen.getByTestId('person-picker-search'), { target: { value: 'Brand New' } });
  return result;
};

describe('PersonPicker — read-only demo', () => {
  beforeEach(() => {
    mockAuthManager.isReadOnlyDemo = false; // clearMocks resets spies only — this plain object needs its own reset
    vi.mocked(getFaceRepairOwnerPeople).mockResolvedValue(makePeopleResponse());
  });

  it('shows the create-new-person row to a real admin', async () => {
    await renderWithQuery();

    await waitFor(() => expect(screen.getByTestId('person-picker-create')).toBeInTheDocument());
  });

  it('hides the create-new-person row in read-only demo mode', async () => {
    mockAuthManager.isReadOnlyDemo = true;
    await renderWithQuery();

    expect(screen.queryByTestId('person-picker-create')).toBeNull();
  });

  it('leaves search and row selection working in read-only demo mode', async () => {
    mockAuthManager.isReadOnlyDemo = true;
    const onClose = vi.fn();
    render(PersonPicker, { props: { ownerId: OWNER_ID, faceCount: 3, onClose } });

    const row = await screen.findByTestId('person-picker-row-p1');
    await fireEvent.click(row);

    expect(onClose).toHaveBeenCalledWith({ personId: 'p1', name: 'Marco Weber', lock: true });
  });
});
