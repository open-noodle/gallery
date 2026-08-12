import { createFaceRepairOwnerPerson, getFaceRepairOwnerPeople } from '@immich/sdk';
import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { init, register, waitLocale } from 'svelte-i18n';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import PersonPicker from './PersonPicker.svelte';

// Slice 4 (move to a chosen person — owner-scoped picker). Mirrors the mockup
// (docs/plans/2026-07-10-face-cleanup-resolution-mockup.html): search owner-scoped people, pick a row, or
// create a new person under the owner. §8.5 P3 / E8.
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
// convention as AdvancedScanModal.spec.ts / RepresentativeFacePickerModal.spec.ts).
afterEach(async () => {
  await new Promise((resolve) => setTimeout(resolve, 500));
});

beforeAll(async () => {
  register('en', () => import('$i18n/en.json'));
  await init({ fallbackLocale: 'en', initialLocale: 'en' });
  await waitLocale('en');
});

const OWNER_ID = 'owner-user-1';
const SUGGESTED_ID = 'person-suggested';

const makePeopleResponse = (
  people: { id: string; name: string; faceCount: number; thumbnailFaceId: string | null }[],
) => ({ people, total: people.length, hasMore: false });

describe('PersonPicker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('lists the owner-scoped people on mount', async () => {
    vi.mocked(getFaceRepairOwnerPeople).mockResolvedValue(
      makePeopleResponse([
        { id: 'p1', name: 'Marco Weber', faceCount: 412, thumbnailFaceId: 'f1' },
        { id: 'p2', name: 'Lena Hofer', faceCount: 1204, thumbnailFaceId: 'f2' },
      ]),
    );

    render(PersonPicker, { props: { ownerId: OWNER_ID, faceCount: 3, onClose: vi.fn() } });

    await waitFor(() => {
      expect(getFaceRepairOwnerPeople).toHaveBeenCalledWith({ ownerId: OWNER_ID, page: 0, query: undefined });
      expect(screen.getByText('Marco Weber')).toBeInTheDocument();
      expect(screen.getByText('Lena Hofer')).toBeInTheDocument();
    });

    expect(screen.getByText('Move 3 faces to…')).toBeInTheDocument();
    expect(
      screen.getByText("Any person or cluster in the library — not just this scan's suggestion."),
    ).toBeInTheDocument();
  });

  it('marks the scan-suggested person with "this scan\'s suggestion" instead of a face count', async () => {
    vi.mocked(getFaceRepairOwnerPeople).mockResolvedValue(
      makePeopleResponse([
        { id: SUGGESTED_ID, name: 'Paul Friedrich Meischner', faceCount: 20_711, thumbnailFaceId: 'f1' },
        { id: 'p2', name: 'Sofia Neumann', faceCount: 88, thumbnailFaceId: 'f2' },
      ]),
    );

    render(PersonPicker, {
      props: { ownerId: OWNER_ID, faceCount: 3, suggestedPersonId: SUGGESTED_ID, onClose: vi.fn() },
    });

    const suggestedRow = await screen.findByTestId(`person-picker-row-${SUGGESTED_ID}`);
    expect(within(suggestedRow).getByText("this scan's suggestion")).toBeInTheDocument();

    const otherRow = screen.getByTestId('person-picker-row-p2');
    expect(within(otherRow).getByText('88 faces')).toBeInTheDocument();
  });

  it('shows the face count and a short id for unnamed clusters', async () => {
    vi.mocked(getFaceRepairOwnerPeople).mockResolvedValue(
      makePeopleResponse([{ id: 'unnamed-cluster-12345678', name: '', faceCount: 920, thumbnailFaceId: 'f9' }]),
    );

    render(PersonPicker, { props: { ownerId: OWNER_ID, faceCount: 3, onClose: vi.fn() } });

    await waitFor(() => {
      expect(screen.getByText('Unnamed cluster')).toBeInTheDocument();
      expect(screen.getByText('920 faces · unnamed-')).toBeInTheDocument();
    });
  });

  it('re-fetches from the owner-scoped endpoint as the search query changes', async () => {
    vi.mocked(getFaceRepairOwnerPeople).mockResolvedValueOnce(
      makePeopleResponse([{ id: 'p1', name: 'Marco Weber', faceCount: 412, thumbnailFaceId: 'f1' }]),
    );

    render(PersonPicker, { props: { ownerId: OWNER_ID, faceCount: 3, onClose: vi.fn() } });
    await screen.findByText('Marco Weber');

    vi.mocked(getFaceRepairOwnerPeople).mockResolvedValueOnce(
      makePeopleResponse([{ id: 'p2', name: 'Lena Hofer', faceCount: 1204, thumbnailFaceId: 'f2' }]),
    );

    await fireEvent.input(screen.getByTestId('person-picker-search'), { target: { value: 'Lena' } });

    await waitFor(() => {
      expect(getFaceRepairOwnerPeople).toHaveBeenCalledWith({ ownerId: OWNER_ID, page: 0, query: 'Lena' });
      expect(screen.getByText('Lena Hofer')).toBeInTheDocument();
      expect(screen.queryByText('Marco Weber')).not.toBeInTheDocument();
    });
  });

  it('shows "No matches" only when there is no query and nothing matched', async () => {
    vi.mocked(getFaceRepairOwnerPeople).mockResolvedValue(makePeopleResponse([]));

    render(PersonPicker, { props: { ownerId: OWNER_ID, faceCount: 3, onClose: vi.fn() } });

    await waitFor(() => expect(screen.getByText('No matches')).toBeInTheDocument());
  });

  it('selecting an existing person routes the selection via onClose', async () => {
    vi.mocked(getFaceRepairOwnerPeople).mockResolvedValue(
      makePeopleResponse([{ id: 'p1', name: 'Marco Weber', faceCount: 412, thumbnailFaceId: 'f1' }]),
    );
    const onClose = vi.fn();

    render(PersonPicker, { props: { ownerId: OWNER_ID, faceCount: 3, onClose } });
    await fireEvent.click(await screen.findByText('Marco Weber'));

    // lock:true — the "Lock so it won't re-flag" checkbox defaults to checked (P1).
    expect(onClose).toHaveBeenCalledWith({ personId: 'p1', name: 'Marco Weber', lock: true });
    expect(createFaceRepairOwnerPerson).not.toHaveBeenCalled();
  });

  // ---- P1 (Slice 3, move-and-lock): the "Lock so it won't re-flag" checkbox ----

  it('P1: renders the lock checkbox checked by default', () => {
    vi.mocked(getFaceRepairOwnerPeople).mockResolvedValue(makePeopleResponse([]));

    render(PersonPicker, { props: { ownerId: OWNER_ID, faceCount: 3, onClose: vi.fn() } });

    expect(screen.getByText("Lock so it won't re-flag")).toBeInTheDocument();
    const checkbox = screen.getByRole('checkbox');
    expect(checkbox).toBeChecked();
  });

  it('P1: unchecking the lock checkbox routes the selection with lock:false', async () => {
    vi.mocked(getFaceRepairOwnerPeople).mockResolvedValue(
      makePeopleResponse([{ id: 'p1', name: 'Marco Weber', faceCount: 412, thumbnailFaceId: 'f1' }]),
    );
    const onClose = vi.fn();

    render(PersonPicker, { props: { ownerId: OWNER_ID, faceCount: 3, onClose } });
    await fireEvent.click(await screen.findByRole('checkbox'));
    await fireEvent.click(await screen.findByText('Marco Weber'));

    expect(onClose).toHaveBeenCalledWith({ personId: 'p1', name: 'Marco Weber', lock: false });
  });

  it('shows a "Create new person" row once there is a search query, and it creates + routes the selection', async () => {
    vi.mocked(getFaceRepairOwnerPeople).mockResolvedValue(makePeopleResponse([]));
    vi.mocked(createFaceRepairOwnerPerson).mockResolvedValue({ id: 'new-person-1' });
    const onClose = vi.fn();

    render(PersonPicker, { props: { ownerId: OWNER_ID, faceCount: 3, onClose } });
    await waitFor(() => expect(getFaceRepairOwnerPeople).toHaveBeenCalled());

    await fireEvent.input(screen.getByTestId('person-picker-search'), { target: { value: 'Brand New' } });
    const createRow = await screen.findByText('Create new person "Brand New"');

    await fireEvent.click(createRow);

    await waitFor(() => {
      expect(createFaceRepairOwnerPerson).toHaveBeenCalledWith({
        ownerId: OWNER_ID,
        faceRepairOwnerPersonCreateRequestDto: { name: 'Brand New' },
      });
      // lock:true — the "Lock so it won't re-flag" checkbox defaults to checked (P1).
      expect(onClose).toHaveBeenCalledWith({ personId: 'new-person-1', name: 'Brand New', lock: true });
    });
  });

  // E8: create-new-person race / empty name — if creation fails, the selection is untouched (nothing
  // applied) and the error surfaces in the picker.
  it('E8: surfaces the error and applies nothing when creating a new person fails', async () => {
    vi.mocked(getFaceRepairOwnerPeople).mockResolvedValue(makePeopleResponse([]));
    vi.mocked(createFaceRepairOwnerPerson).mockRejectedValue(new Error('boom'));
    const onClose = vi.fn();

    render(PersonPicker, { props: { ownerId: OWNER_ID, faceCount: 3, onClose } });
    await waitFor(() => expect(getFaceRepairOwnerPeople).toHaveBeenCalled());

    await fireEvent.input(screen.getByTestId('person-picker-search'), { target: { value: 'Brand New' } });
    const createRow = await screen.findByText('Create new person "Brand New"');
    await fireEvent.click(createRow);

    await waitFor(() => {
      expect(screen.getByText('Failed to create the new person. Please try again.')).toBeInTheDocument();
    });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('offers the re-flag lock by default', async () => {
    render(PersonPicker, { props: { ownerId: 'owner-1', faceCount: 3, onClose: vi.fn() } });
    await waitFor(() => expect(screen.getByTestId('person-picker-lock-toggle')).toBeInTheDocument());
  });

  it('hides the re-flag lock when the caller cannot honour it', async () => {
    render(PersonPicker, { props: { ownerId: 'owner-1', faceCount: 3, showLock: false, onClose: vi.fn() } });
    await waitFor(() => expect(screen.getByTestId('person-picker-search')).toBeInTheDocument());
    expect(screen.queryByTestId('person-picker-lock-toggle')).not.toBeInTheDocument();
  });

  // The internal `lockOnMove` state defaults to true and is unreachable with the toggle hidden — without its
  // own guard, a caller reading `.lock` off the resolved destination would silently get `true` despite never
  // having any way to see or set it.
  it('reports lock:false when the re-flag lock is hidden, regardless of its unreachable default', async () => {
    vi.mocked(getFaceRepairOwnerPeople).mockResolvedValue(
      makePeopleResponse([{ id: 'p1', name: 'Marco Weber', faceCount: 412, thumbnailFaceId: 'f1' }]),
    );
    const onClose = vi.fn();

    render(PersonPicker, { props: { ownerId: OWNER_ID, faceCount: 3, showLock: false, onClose } });
    await fireEvent.click(await screen.findByText('Marco Weber'));

    expect(onClose).toHaveBeenCalledWith({ personId: 'p1', name: 'Marco Weber', lock: false });
  });
});
