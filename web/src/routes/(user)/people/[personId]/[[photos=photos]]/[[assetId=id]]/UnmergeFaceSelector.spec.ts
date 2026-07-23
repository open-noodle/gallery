import { Type, type PeopleResponseDto, type PersonResponseDto } from '@immich/sdk';
import { toastManager } from '@immich/ui';
import '@testing-library/jest-dom';
import { render, screen, waitFor } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import type { Component } from 'svelte';
import { getAnimateMock } from '$lib/__mocks__/animate.mock';
import { sdkMock } from '$lib/__mocks__/sdk.mock';
import TestWrapper from '$lib/components/TestWrapper.svelte';
import UnmergeFaceSelector from './UnmergeFaceSelector.svelte';

const { formatMessage } = vi.hoisted(() => {
  const formatMessage = (key: string, options?: { values?: Record<string, unknown> }) => {
    if (!options?.values) {
      return key;
    }
    return `${key}:${JSON.stringify(options.values)}`;
  };
  return { formatMessage };
});

vi.mock('svelte-i18n', () => ({
  t: {
    subscribe: (run: (formatter: typeof formatMessage) => void) => {
      run(formatMessage);
      return () => {};
    },
  },
}));

vi.mock('@immich/ui', async (importOriginal) => {
  const original = await importOriginal<typeof import('@immich/ui')>();
  return {
    ...original,
    toastManager: { primary: vi.fn(), success: vi.fn(), warning: vi.fn(), danger: vi.fn() },
  };
});

vi.mock('$lib/components/assets/thumbnail/ImageThumbnail.svelte', async () => {
  const { default: MockComponent } = await import('@test-data/mocks/image-thumbnail.stub.svelte');
  return { default: MockComponent };
});

function makePerson(overrides: Partial<PersonResponseDto> = {}): PersonResponseDto {
  const id = overrides.id ?? 'person-1';
  return {
    id,
    name: 'Alice',
    birthDate: null,
    thumbnailPath: '/thumb.jpg',
    isHidden: false,
    isFavorite: false,
    color: undefined,
    updatedAt: '2026-01-02T00:00:00.000Z',
    type: 'person',
    species: null,
    // A real owned person always carries a user-person primaryProfile; keep it present so a guard
    // rewritten as `!!personAssets.primaryProfile` would still correctly treat this as personal.
    primaryProfile: { type: Type.UserPerson, id },
    ...overrides,
  };
}

// A person opened through /people/{scopedId} whose primaryProfile is a space-person: the source
// space-person id ('space-person-1') deliberately differs from the outer person.id
// ('space-person-src') so a test asserting the SDK call used primaryProfile.id (not person.id)
// actually proves the fix rather than passing by coincidence.
function makeSpacePerson(overrides: Partial<PersonResponseDto> = {}): PersonResponseDto {
  return makePerson({
    id: 'space-person-src',
    name: 'Space Source',
    primaryProfile: { type: Type.SpacePerson, id: 'space-person-1', spaceId: 'space-9' },
    ...overrides,
  });
}

function makeSpaceCandidate(): PersonResponseDto {
  return makePerson({
    id: 'candidate-space-1',
    name: 'Bob',
    primaryProfile: { type: Type.SpacePerson, id: 'sp-candidate-1', spaceId: 'space-9' },
  });
}

// Same trick as makeSpacePerson: person.id ('candidate-personal-1') deliberately differs from
// primaryProfile.id ('candidate-personal-profile-1') so a test asserting the SDK call used
// primaryProfile.id proves the fix rather than passing by coincidence.
function makePersonalCandidate(): PersonResponseDto {
  return makePerson({
    id: 'candidate-personal-1',
    name: 'Carol',
    primaryProfile: { type: Type.UserPerson, id: 'candidate-personal-profile-1' },
  });
}

function peopleResponse(people: PersonResponseDto[]): PeopleResponseDto {
  return { people, total: people.length, hidden: 0 };
}

function renderSelector({
  assetIds = ['asset-1', 'asset-2'],
  personAssets = makePerson(),
}: {
  assetIds?: string[];
  personAssets?: PersonResponseDto;
} = {}) {
  const onConfirm = vi.fn();
  const onClose = vi.fn();
  const props = { assetIds, personAssets, onConfirm, onClose };

  render(TestWrapper as Component<{ component: typeof UnmergeFaceSelector; componentProps: typeof props }>, {
    component: UnmergeFaceSelector,
    componentProps: props,
  });

  return { onConfirm, onClose };
}

describe('UnmergeFaceSelector', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    Element.prototype.animate = getAnimateMock();
    Element.prototype.getAnimations = vi.fn().mockReturnValue([]);
    sdkMock.getAllPeople.mockResolvedValue(peopleResponse([]));
  });

  it('loads reassign candidates with shared spaces included (space member picker must not be empty)', async () => {
    renderSelector({ personAssets: makeSpacePerson() });

    await waitFor(() =>
      expect(sdkMock.getAllPeople).toHaveBeenCalledWith({ withHidden: false, withSharedSpaces: true }),
    );
  });

  it('does not request shared-space candidates for a normal owned-person source (would recreate #765 in reverse)', async () => {
    renderSelector({ personAssets: makePerson() });

    await waitFor(() => expect(sdkMock.getAllPeople).toHaveBeenCalled());
    expect(sdkMock.getAllPeople).toHaveBeenCalledWith({ withHidden: false });
  });

  it('routes "Create new person" to the space reassign endpoint for a space-scoped source person', async () => {
    sdkMock.reassignSpacePersonFaces.mockResolvedValue({ reassigned: 2 });

    const { onConfirm } = renderSelector({
      assetIds: ['asset-1', 'asset-2'],
      personAssets: makeSpacePerson(),
    });

    await userEvent.click(screen.getByText('create_new_person'));

    await waitFor(() => expect(sdkMock.reassignSpacePersonFaces).toHaveBeenCalled());
    expect(sdkMock.reassignSpacePersonFaces).toHaveBeenCalledWith({
      id: 'space-9',
      personId: 'space-person-1',
      sharedSpacePersonReassignDto: { assetIds: ['asset-1', 'asset-2'], target: { type: 'new' } },
    });
    expect(sdkMock.createPerson).not.toHaveBeenCalled();
    expect(sdkMock.reassignFaces).not.toHaveBeenCalled();
    expect(onConfirm).toHaveBeenCalled();
  });

  it('routes "Reassign" to the space endpoint with a space-scoped candidate profile ref', async () => {
    const candidate = makeSpaceCandidate();
    sdkMock.getAllPeople.mockResolvedValue(peopleResponse([candidate]));
    sdkMock.reassignSpacePersonFaces.mockResolvedValue({ reassigned: 1 });

    renderSelector({ assetIds: ['asset-1'], personAssets: makeSpacePerson() });

    await userEvent.click(await screen.findByText('Bob'));
    await userEvent.click(screen.getByText('reassign'));

    await waitFor(() =>
      expect(sdkMock.reassignSpacePersonFaces).toHaveBeenCalledWith({
        id: 'space-9',
        personId: 'space-person-1',
        sharedSpacePersonReassignDto: {
          assetIds: ['asset-1'],
          target: { type: 'existing', profile: { type: 'space-person', id: 'sp-candidate-1', spaceId: 'space-9' } },
        },
      }),
    );
    expect(sdkMock.reassignFaces).not.toHaveBeenCalled();
  });

  it('maps a personal candidate profile ref to the "person" enum, not "user-person" (would otherwise 400)', async () => {
    const candidate = makePersonalCandidate();
    sdkMock.getAllPeople.mockResolvedValue(peopleResponse([candidate]));
    sdkMock.reassignSpacePersonFaces.mockResolvedValue({ reassigned: 1 });

    renderSelector({ assetIds: ['asset-1'], personAssets: makeSpacePerson() });

    await userEvent.click(await screen.findByText('Carol'));
    await userEvent.click(screen.getByText('reassign'));

    await waitFor(() =>
      expect(sdkMock.reassignSpacePersonFaces).toHaveBeenCalledWith({
        id: 'space-9',
        personId: 'space-person-1',
        sharedSpacePersonReassignDto: {
          assetIds: ['asset-1'],
          target: { type: 'existing', profile: { type: 'person', id: 'candidate-personal-profile-1' } },
        },
      }),
    );
    expect(sdkMock.reassignFaces).not.toHaveBeenCalled();
  });

  it('keeps the personal (owned-person) reassign path on createPerson + global reassignFaces', async () => {
    sdkMock.createPerson.mockResolvedValue(makePerson({ id: 'new-person-1', name: '' }));
    sdkMock.reassignFaces.mockResolvedValue([]);

    const personalPerson = makePerson({ id: 'person-1' });
    const { onConfirm } = renderSelector({ assetIds: ['asset-1', 'asset-2'], personAssets: personalPerson });

    await userEvent.click(screen.getByText('create_new_person'));

    await waitFor(() => expect(sdkMock.createPerson).toHaveBeenCalledWith({ personCreateDto: {} }));
    expect(sdkMock.reassignFaces).toHaveBeenCalledWith({
      id: 'new-person-1',
      assetFaceUpdateDto: {
        data: [
          { assetId: 'asset-1', personId: 'person-1' },
          { assetId: 'asset-2', personId: 'person-1' },
        ],
      },
    });
    expect(sdkMock.reassignSpacePersonFaces).not.toHaveBeenCalled();
    expect(toastManager.primary).toHaveBeenCalled();
    expect(onConfirm).toHaveBeenCalled();
  });

  it('does not show a success toast when the space reassign moves zero faces, and surfaces an error instead', async () => {
    sdkMock.reassignSpacePersonFaces.mockResolvedValue({ reassigned: 0 });

    const { onConfirm } = renderSelector({ assetIds: ['asset-1'], personAssets: makeSpacePerson() });

    await userEvent.click(screen.getByText('create_new_person'));

    await waitFor(() => expect(sdkMock.reassignSpacePersonFaces).toHaveBeenCalled());
    expect(toastManager.primary).not.toHaveBeenCalled();
    expect(toastManager.danger).toHaveBeenCalledWith('errors.unable_to_reassign_assets_new_person');
    // A zero-result must not drive the caller's optimistic removal (+page.svelte's onConfirm ->
    // timelineManager.removeAssets): that would empty the grid of assets that never moved,
    // compounding the danger toast with a UI lie.
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('invokes onConfirm when the space reassign (create path) moves at least one face', async () => {
    sdkMock.reassignSpacePersonFaces.mockResolvedValue({ reassigned: 1 });

    const { onConfirm } = renderSelector({ assetIds: ['asset-1'], personAssets: makeSpacePerson() });

    await userEvent.click(screen.getByText('create_new_person'));

    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));
  });

  it('does not show a success toast or call onConfirm when a "Reassign" to an existing person moves zero faces', async () => {
    const candidate = makeSpaceCandidate();
    sdkMock.getAllPeople.mockResolvedValue(peopleResponse([candidate]));
    sdkMock.reassignSpacePersonFaces.mockResolvedValue({ reassigned: 0 });

    const { onConfirm } = renderSelector({ assetIds: ['asset-1'], personAssets: makeSpacePerson() });

    await userEvent.click(await screen.findByText('Bob'));
    await userEvent.click(screen.getByText('reassign'));

    await waitFor(() => expect(sdkMock.reassignSpacePersonFaces).toHaveBeenCalled());
    expect(toastManager.primary).not.toHaveBeenCalled();
    expect(toastManager.danger).toHaveBeenCalledWith(
      formatMessage('errors.unable_to_reassign_assets_existing_person', { values: { name: 'Bob' } }),
    );
    expect(sdkMock.reassignFaces).not.toHaveBeenCalled();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('shows a success toast keyed on the server-reported reassigned count, not assetIds.length', async () => {
    sdkMock.reassignSpacePersonFaces.mockResolvedValue({ reassigned: 2 });

    renderSelector({ assetIds: ['asset-1', 'asset-2', 'asset-3'], personAssets: makeSpacePerson() });

    await userEvent.click(screen.getByText('create_new_person'));

    await waitFor(() => expect(sdkMock.reassignSpacePersonFaces).toHaveBeenCalled());
    expect(toastManager.danger).not.toHaveBeenCalled();
    expect(toastManager.primary).toHaveBeenCalledWith(
      formatMessage('reassigned_assets_to_new_person', { values: { count: 2 } }),
    );
  });

  it('does not call onConfirm when the space reassign (create path) throws', async () => {
    sdkMock.reassignSpacePersonFaces.mockRejectedValue(new Error('403 forbidden'));

    const { onConfirm } = renderSelector({ assetIds: ['asset-1'], personAssets: makeSpacePerson() });

    await userEvent.click(screen.getByText('create_new_person'));

    await waitFor(() => expect(toastManager.danger).toHaveBeenCalled());
    // A rejection means nothing we can rely on moved. Firing onConfirm would drive the caller's
    // optimistic removal (+page.svelte -> timelineManager.removeAssets) and vanish the photos behind
    // the error toast — #765's exact symptom, relocated to the throw path. Newly reachable because
    // the space endpoint rejects outright on the Editor gate and the assetIds cap.
    expect(onConfirm).not.toHaveBeenCalled();
    expect(toastManager.primary).not.toHaveBeenCalled();
  });

  it('does not call onConfirm when a "Reassign" to an existing person throws', async () => {
    const candidate = makeSpaceCandidate();
    sdkMock.getAllPeople.mockResolvedValue(peopleResponse([candidate]));
    sdkMock.reassignSpacePersonFaces.mockRejectedValue(new Error('403 forbidden'));

    const { onConfirm } = renderSelector({ assetIds: ['asset-1'], personAssets: makeSpacePerson() });

    await userEvent.click(await screen.findByText('Bob'));
    await userEvent.click(screen.getByText('reassign'));

    await waitFor(() => expect(toastManager.danger).toHaveBeenCalled());
    expect(onConfirm).not.toHaveBeenCalled();
    expect(toastManager.primary).not.toHaveBeenCalled();
  });

  it('chunks a >100 asset selection into capped batches and sums the reported counts', async () => {
    // SharedSpacePersonReassignDto.assetIds is max(100) server-side, and "Select all" sits on this
    // toolbar unbounded — an unchunked call would 400 the whole reassign.
    const assetIds = Array.from({ length: 250 }, (_, index) => `asset-${index}`);
    sdkMock.reassignSpacePersonFaces
      .mockResolvedValueOnce({ reassigned: 100 })
      .mockResolvedValueOnce({ reassigned: 90 })
      .mockResolvedValueOnce({ reassigned: 50 });

    renderSelector({ assetIds, personAssets: makeSpacePerson() });

    await userEvent.click(screen.getByText('create_new_person'));

    await waitFor(() => expect(sdkMock.reassignSpacePersonFaces).toHaveBeenCalledTimes(3));
    const batches = sdkMock.reassignSpacePersonFaces.mock.calls.map(
      ([{ sharedSpacePersonReassignDto }]) => sharedSpacePersonReassignDto.assetIds,
    );
    expect(batches.map((batch: string[]) => batch.length)).toEqual([100, 100, 50]);
    // Every id is sent exactly once, in order — a chunker that dropped or duplicated a slice would
    // still produce three calls of the right sizes.
    expect(batches.flat()).toEqual(assetIds);
    expect(toastManager.primary).toHaveBeenCalledWith(
      formatMessage('reassigned_assets_to_new_person', { values: { count: 240 } }),
    );
  });

  it('treats a failing chunk as a failed reassign: danger toast, no optimistic removal', async () => {
    const assetIds = Array.from({ length: 150 }, (_, index) => `asset-${index}`);
    sdkMock.reassignSpacePersonFaces
      .mockResolvedValueOnce({ reassigned: 100 })
      .mockRejectedValueOnce(new Error('500 boom'));

    const { onConfirm } = renderSelector({ assetIds, personAssets: makeSpacePerson() });

    await userEvent.click(screen.getByText('create_new_person'));

    await waitFor(() => expect(sdkMock.reassignSpacePersonFaces).toHaveBeenCalledTimes(2));
    expect(toastManager.danger).toHaveBeenCalled();
    expect(toastManager.primary).not.toHaveBeenCalled();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('invokes onConfirm after a successful space reassign instead of refreshing a possibly-emptied source person', async () => {
    sdkMock.reassignSpacePersonFaces.mockResolvedValue({ reassigned: 2 });

    const { onConfirm } = renderSelector({ assetIds: ['asset-1', 'asset-2'], personAssets: makeSpacePerson() });

    await userEvent.click(screen.getByText('create_new_person'));

    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));
    // The component delegates any "source now empty" cleanup/navigation to the caller via
    // onConfirm; it must not try to re-fetch the (possibly deleted) source person itself.
    expect(sdkMock.getPerson).not.toHaveBeenCalled();
  });
});
