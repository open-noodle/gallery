import { Type, type PersonResponseDto } from '@immich/sdk';
import { modalManager, toastManager } from '@immich/ui';
import '@testing-library/jest-dom';
import { render, screen, waitFor } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { afterEach } from 'vitest';
import { sdkMock } from '$lib/__mocks__/sdk.mock';
import PersonMergeSuggestionModal from './PersonMergeSuggestionModal.svelte';

vi.mock('../components/assets/thumbnail/ImageThumbnail.svelte', async () => {
  const { default: MockComponent } = await import('@test-data/mocks/image-thumbnail.stub.svelte');
  return { default: MockComponent };
});

vi.mock('@immich/ui', async (importOriginal) => {
  const original = await importOriginal<typeof import('@immich/ui')>();
  return {
    ...original,
    modalManager: { show: vi.fn(), showDialog: vi.fn() },
    toastManager: { primary: vi.fn(), danger: vi.fn() },
  };
});

const httpError = (status: number, data: Record<string, unknown>) => ({ __http: true, status, data, message: 'raw' });

// Drain bits-ui Modal's deferred body-scroll-lock cleanup before happy-dom tears
// down `document`. Otherwise CI can report an unhandled `document is not defined`
// after all assertions in this file have passed.
afterEach(async () => {
  await new Promise((resolve) => setTimeout(resolve, 500));
});

function person(overrides: Partial<PersonResponseDto> = {}): PersonResponseDto {
  return {
    id: 'person-1',
    name: 'Person',
    birthDate: null,
    thumbnailPath: '',
    isHidden: false,
    isFavorite: false,
    color: undefined,
    type: 'person',
    species: null,
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('PersonMergeSuggestionModal', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('uses scoped identity repair when either side is a space primary profile', async () => {
    render(PersonMergeSuggestionModal, {
      personToMerge: person({
        id: 'space-visible-person',
        primaryProfile: { type: Type.SpacePerson, id: 'space-person-1', spaceId: 'space-1' },
      }),
      personToBeMergedInto: person({ id: 'person-target' }),
      potentialMergePeople: [],
      onClose: vi.fn(),
    });

    await userEvent.click(screen.getByRole('button', { name: 'yes' }));

    await waitFor(() =>
      expect(sdkMock.mergeScopedPeople).toHaveBeenCalledWith({
        mergeScopedPeopleDto: {
          target: { type: 'person', id: 'person-target' },
          sources: [{ type: 'space-person', id: 'space-person-1', spaceId: 'space-1' }],
        },
      }),
    );
    expect(sdkMock.mergePerson).not.toHaveBeenCalled();
  });

  it('keeps legacy personal merge when both sides are personal profiles', async () => {
    render(PersonMergeSuggestionModal, {
      personToMerge: person({ id: 'person-source' }),
      personToBeMergedInto: person({ id: 'person-target' }),
      potentialMergePeople: [],
      onClose: vi.fn(),
    });

    await userEvent.click(screen.getByRole('button', { name: 'yes' }));

    await waitFor(() =>
      expect(sdkMock.mergePerson).toHaveBeenCalledWith({
        id: 'person-target',
        mergePersonDto: { ids: ['person-source'] },
      }),
    );
    expect(sdkMock.mergeScopedPeople).not.toHaveBeenCalled();
  });

  it('shows the descriptive message and does not close when a classic merge is blocked across owners', async () => {
    vi.mocked(sdkMock.isHttpError).mockImplementation((error) => !!(error as { __http?: boolean })?.__http);
    sdkMock.mergePerson.mockRejectedValueOnce(
      httpError(403, { code: 'cross_owner_merge_blocked', message: 'An administrator can enable it.' }),
    );
    const onClose = vi.fn();

    render(PersonMergeSuggestionModal, {
      personToMerge: person({ id: 'person-source' }),
      personToBeMergedInto: person({ id: 'person-target' }),
      potentialMergePeople: [],
      onClose,
    });

    await userEvent.click(screen.getByRole('button', { name: 'yes' }));

    await waitFor(() => expect(toastManager.danger).toHaveBeenCalled());
    expect(onClose).not.toHaveBeenCalled();
    expect(sdkMock.mergePerson).toHaveBeenCalledTimes(1);
  });

  it('re-runs a classic merge with the cross-owner acknowledgement once the user confirms', async () => {
    vi.mocked(sdkMock.isHttpError).mockImplementation((error) => !!(error as { __http?: boolean })?.__http);
    sdkMock.mergePerson
      .mockRejectedValueOnce(httpError(409, { code: 'cross_owner_merge_confirmation_required', impactedOwnerCount: 1 }))
      .mockResolvedValueOnce([{ id: 'person-source', success: true }]);
    vi.mocked(modalManager.showDialog).mockResolvedValue(true);
    const onClose = vi.fn();

    render(PersonMergeSuggestionModal, {
      personToMerge: person({ id: 'person-source' }),
      personToBeMergedInto: person({ id: 'person-target' }),
      potentialMergePeople: [],
      onClose,
    });

    await userEvent.click(screen.getByRole('button', { name: 'yes' }));

    await waitFor(() => expect(sdkMock.mergePerson).toHaveBeenCalledTimes(2));
    expect(sdkMock.mergePerson).toHaveBeenNthCalledWith(1, {
      id: 'person-target',
      mergePersonDto: { ids: ['person-source'] },
    });
    expect(sdkMock.mergePerson).toHaveBeenNthCalledWith(2, {
      id: 'person-target',
      mergePersonDto: { ids: ['person-source'], confirmCrossOwner: true },
    });
    expect(onClose).toHaveBeenCalled();
  });

  it('renders the shared-space thumbnail for a space-primary candidate instead of the owner-only url', () => {
    render(PersonMergeSuggestionModal, {
      personToMerge: person({
        id: 'space-visible-person',
        name: 'Space Candidate',
        updatedAt: '2026-01-05T00:00:00.000Z',
        primaryProfile: { type: Type.SpacePerson, id: 'space-person-1', spaceId: 'space-1' },
      }),
      personToBeMergedInto: person({ id: 'person-target', name: 'Target' }),
      potentialMergePeople: [],
      onClose: vi.fn(),
    });

    const src = screen.getByAltText('Space Candidate').getAttribute('src') ?? '';
    expect(src).toContain('/shared-spaces/space-1/people/space-person-1/thumbnail');
    expect(src).not.toContain('/people/space-visible-person/thumbnail');
  });
});
