import { sdkMock } from '$lib/__mocks__/sdk.mock';
import TestWrapper from '$lib/components/TestWrapper.svelte';
import { authManager } from '$lib/managers/auth-manager.svelte';
import {
  RepresentativeFaceSource,
  SharedSpaceRole,
  type PersonFaceSuggestionPageResponseDto,
  type PersonFaceSuggestionResponseDto,
  type PersonStatisticsResponseDto,
  type SharedSpaceMemberResponseDto,
  type SharedSpacePersonResponseDto,
  type SharedSpaceResponseDto,
} from '@immich/sdk';
import { modalManager } from '@immich/ui';
import { preferencesFactory } from '@test-data/factories/preferences-factory';
import { userAdminFactory } from '@test-data/factories/user-factory';
import '@testing-library/jest-dom';
import { render, screen, waitFor } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import type { Component } from 'svelte';
import { load } from './+page';
import SpacePersonDetailPage from './+page.svelte';

const { gotoMock, invalidateAllMock, authenticateMock, featureFlagsMock, formatMessage, mockAssetMultiSelectManager } =
  vi.hoisted(() => {
    const formatCount = (count: unknown, singular: string, plural: string) => {
      const value = Number(count);
      return `${value.toLocaleString('en-US')} ${value === 1 ? singular : plural}`;
    };

    const formatMessage = (key: string, options?: { values?: Record<string, unknown> }) => {
      if (key === 'assets_count') {
        return formatCount(options?.values?.count, 'asset', 'assets');
      }

      if (key === 'faces_count') {
        return formatCount(options?.values?.count, 'face', 'faces');
      }

      return key;
    };

    return {
      gotoMock: vi.fn(),
      invalidateAllMock: vi.fn(),
      authenticateMock: vi.fn(),
      featureFlagsMock: { value: { peopleStatistics: true } },
      formatMessage,
      mockAssetMultiSelectManager: {
        selectionActive: false,
        assets: [],
        clear: vi.fn(),
        isAllUserOwned: true,
        isAllFavorite: false,
        isAllArchived: false,
      },
    };
  });

vi.mock('$app/navigation', () => ({ goto: gotoMock, invalidateAll: invalidateAllMock }));
vi.mock('$lib/utils/auth', () => ({ authenticate: authenticateMock }));
vi.mock('$lib/managers/feature-flags-manager.svelte', () => ({
  featureFlagsManager: featureFlagsMock,
}));
vi.mock('$lib/managers/asset-multi-select-manager.svelte', () => ({
  assetMultiSelectManager: mockAssetMultiSelectManager,
}));

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
  const { default: MockContextMenuButton } = await import('@test-data/mocks/action-context-menu.stub.svelte');
  return {
    ...original,
    ContextMenuButton: MockContextMenuButton,
    modalManager: { show: vi.fn(), showDialog: vi.fn() },
    toastManager: { primary: vi.fn(), success: vi.fn() },
  };
});

vi.mock('$lib/components/timeline/Timeline.svelte', async () => {
  const { default: MockComponent } = await import('./mock-space-person-timeline.test-wrapper.svelte');
  return { default: MockComponent };
});

vi.mock('$lib/components/assets/thumbnail/image-thumbnail.svelte', async () => {
  const { default: MockComponent } = await import('@test-data/mocks/noop-component.svelte');
  return { default: MockComponent };
});

vi.mock('$lib/components/people/people-merge-selector.svelte', async () => {
  const { default: MockComponent } = await import('@test-data/mocks/space-people-merge-selector.stub.svelte');
  return { default: MockComponent };
});

vi.mock('$lib/modals/RepresentativeFacePickerModal.svelte', async () => {
  const { default: MockComponent } = await import('@test-data/mocks/noop-component.svelte');
  return { default: MockComponent };
});

function makeSpace(overrides: Partial<SharedSpaceResponseDto> = {}): SharedSpaceResponseDto {
  return {
    id: 'space-1',
    name: 'Test Space',
    createdAt: '2026-01-01T00:00:00.000Z',
    createdById: 'owner-user-id',
    ...overrides,
  } as SharedSpaceResponseDto;
}

function makeMember(overrides: Partial<SharedSpaceMemberResponseDto> = {}): SharedSpaceMemberResponseDto {
  return {
    userId: 'current-user-id',
    email: 'user@example.com',
    name: 'Current User',
    role: SharedSpaceRole.Editor,
    showInTimeline: false,
    joinedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  } as SharedSpaceMemberResponseDto;
}

function makePerson(overrides: Partial<SharedSpacePersonResponseDto> = {}): SharedSpacePersonResponseDto {
  return {
    id: 'person-1',
    name: 'Alice',
    alias: null,
    assetCount: 5,
    faceCount: 10,
    isHidden: false,
    birthDate: null,
    thumbnailPath: '/thumb.jpg',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
    spaceId: 'space-1',
    ...overrides,
  } as SharedSpacePersonResponseDto;
}

function makeSuggestion(overrides: Partial<PersonFaceSuggestionResponseDto> = {}): PersonFaceSuggestionResponseDto {
  return {
    assetFaceId: 'face-1',
    assetId: 'asset-1',
    distance: 0.62,
    imageWidth: 100,
    imageHeight: 100,
    boundingBoxX1: 10,
    boundingBoxX2: 40,
    boundingBoxY1: 10,
    boundingBoxY2: 40,
    ...overrides,
  };
}

function renderPage({
  members = [makeMember()],
  person = makePerson(),
  statistics = { assets: person.assetCount, faces: person.faceCount },
  action = null,
  previousRoute = null,
}: {
  members?: SharedSpaceMemberResponseDto[];
  person?: SharedSpacePersonResponseDto;
  statistics?: PersonStatisticsResponseDto;
  action?: string | null;
  previousRoute?: string | null;
} = {}) {
  const currentUser = userAdminFactory.build({ id: 'current-user-id' });
  authManager.setUser(currentUser);
  authManager.setPreferences(preferencesFactory.build());

  const props = {
    data: {
      space: makeSpace(),
      members,
      person,
      statistics,
      action,
      previousRoute,
      meta: { title: 'Alice - Test Space' },
    },
  };

  return render(TestWrapper as Component<{ component: typeof SpacePersonDetailPage; componentProps: typeof props }>, {
    component: SpacePersonDetailPage,
    componentProps: props,
  });
}

describe('Spaces person detail page', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    gotoMock.mockResolvedValue(undefined);
    invalidateAllMock.mockResolvedValue(undefined);
    authenticateMock.mockResolvedValue(undefined);
    mockAssetMultiSelectManager.selectionActive = false;
    mockAssetMultiSelectManager.assets = [];
    featureFlagsMock.value.peopleStatistics = true;
  });

  it('loads person metadata without fetching a separate asset id grid', async () => {
    const space = makeSpace();
    const members = [makeMember()];
    const person = makePerson();
    sdkMock.getSpace.mockResolvedValue(space);
    sdkMock.getMembers.mockResolvedValue(members);
    sdkMock.getSpacePerson.mockResolvedValue(person);

    const result = await load({
      url: new URL('https://gallery.test/spaces/space-1/people/person-1'),
      params: { spaceId: 'space-1', personId: 'person-1' },
    } as never);

    expect(result).toMatchObject({ space, members, person, action: null });
    expect(sdkMock.getSpacePersonAssets).not.toHaveBeenCalled();
  });

  it('loads a safe previous route for contextual back navigation', async () => {
    const space = makeSpace();
    const members = [makeMember()];
    const person = makePerson();
    sdkMock.getSpace.mockResolvedValue(space);
    sdkMock.getMembers.mockResolvedValue(members);
    sdkMock.getSpacePerson.mockResolvedValue(person);

    const result = await load({
      url: new URL('https://gallery.test/spaces/space-1/people/person-1?previousRoute=%2Fpeople'),
      params: { spaceId: 'space-1', personId: 'person-1' },
    } as never);

    expect(result).toMatchObject({ previousRoute: '/people' });
  });

  it('ignores external previous routes', async () => {
    const space = makeSpace();
    const members = [makeMember()];
    const person = makePerson();
    sdkMock.getSpace.mockResolvedValue(space);
    sdkMock.getMembers.mockResolvedValue(members);
    sdkMock.getSpacePerson.mockResolvedValue(person);

    const result = await load({
      url: new URL(
        'https://gallery.test/spaces/space-1/people/person-1?previousRoute=https%3A%2F%2Fevil.test%2Fpeople',
      ),
      params: { spaceId: 'space-1', personId: 'person-1' },
    } as never);

    expect(result).toMatchObject({ previousRoute: null });
  });

  it('returns to the previous route when opened from global people', async () => {
    renderPage({ previousRoute: '/people' });

    await userEvent.click(screen.getByLabelText('close'));

    expect(gotoMock).toHaveBeenCalledWith('/people');
  });

  it('uses the shared timeline surface for space person photos', () => {
    renderPage();

    expect(screen.getByTestId('space-person-timeline')).toHaveAttribute('data-enable-routing', 'true');
    expect(screen.getByTestId('space-person-timeline')).toHaveAttribute('data-space-id', 'space-1');
    expect(JSON.parse(screen.getByTestId('timeline-options').textContent ?? '{}')).toEqual({
      spaceId: 'space-1',
      spacePersonId: 'person-1',
      withStacked: true,
    });
    expect(screen.queryByTestId('person-asset-asset-1')).not.toBeInTheDocument();
  });

  it('renders space-scoped asset and face counts in the person header', () => {
    renderPage({
      person: makePerson({ assetCount: 999, faceCount: 999 }),
      statistics: { assets: 5, faces: 10 },
    });

    expect(screen.getByText('5 assets')).toBeInTheDocument();
    expect(screen.getByText('10 faces')).toBeInTheDocument();
    expect(screen.queryByText('999 assets')).not.toBeInTheDocument();
  });

  it('hides the face count line when the peopleStatistics feature flag is disabled', () => {
    featureFlagsMock.value.peopleStatistics = false;
    renderPage({
      person: makePerson({ assetCount: 999, faceCount: 999 }),
      statistics: { assets: 5, faces: 10 },
    });

    expect(screen.getByText('5 assets')).toBeInTheDocument();
    expect(screen.queryByText('10 faces')).not.toBeInTheDocument();
  });

  it('updates the displayed space-scoped asset count after removing selected assets', async () => {
    mockAssetMultiSelectManager.selectionActive = true;
    mockAssetMultiSelectManager.assets = [{ id: 'asset-1' }, { id: 'asset-2' }] as never[];
    vi.mocked(modalManager.showDialog).mockResolvedValue(true);

    renderPage({ statistics: { assets: 5, faces: 10 } });

    await userEvent.click(screen.getByLabelText('remove_from_space'));

    await waitFor(() => {
      expect(sdkMock.removeAssets).toHaveBeenCalledWith({
        id: 'space-1',
        sharedSpaceAssetRemoveDto: { assetIds: ['asset-1', 'asset-2'] },
      });
    });
    expect(await screen.findByText('3 assets')).toBeInTheDocument();
    expect(screen.getByText('10 faces')).toBeInTheDocument();
    expect(invalidateAllMock).toHaveBeenCalled();
  });

  it('does not expose person actions to viewers', () => {
    renderPage({ members: [makeMember({ role: SharedSpaceRole.Viewer })] });

    expect(screen.queryByLabelText('show_person_options')).not.toBeInTheDocument();
    expect(screen.queryByText('set_date_of_birth')).not.toBeInTheDocument();
    expect(screen.queryByText('merge_people')).not.toBeInTheDocument();
    expect(screen.queryByText('separate_from_grouped_person')).not.toBeInTheDocument();
  });

  it('opens the representative face picker for editors', async () => {
    renderPage({ person: makePerson({ representativeFaceSource: RepresentativeFaceSource.Auto }) });

    await userEvent.click(screen.getByText('select_representative_face'));

    expect(modalManager.show).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        title: 'select_representative_face',
        loadFaces: expect.any(Function),
        updateFace: expect.any(Function),
        resetFace: undefined,
        canUpdate: true,
      }),
    );
  });

  it('does not show the representative face picker action for viewers', () => {
    renderPage({ members: [makeMember({ role: SharedSpaceRole.Viewer })] });

    expect(screen.queryByText('select_representative_face')).not.toBeInTheDocument();
  });

  it('passes a reset callback for manual space representative face overrides', async () => {
    renderPage({ person: makePerson({ representativeFaceSource: RepresentativeFaceSource.Manual }) });

    await userEvent.click(screen.getByText('select_representative_face'));

    expect(modalManager.show).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ resetFace: expect.any(Function) }),
    );
  });

  it('uses exact-face SDK calls for space representative face selection and reset', async () => {
    const person = makePerson({ representativeFaceSource: RepresentativeFaceSource.Manual });
    sdkMock.getSpacePersonFaces.mockResolvedValue({ faces: [], hasNextPage: false });
    sdkMock.updateSpacePersonRepresentativeFace.mockResolvedValue({
      ...person,
      representativeFaceSource: RepresentativeFaceSource.Auto,
    });
    renderPage({ person });

    await userEvent.click(screen.getByText('select_representative_face'));
    const props = vi.mocked(modalManager.show).mock.calls[0][1] as unknown as {
      loadFaces: (request: { page: number; size: number }) => Promise<unknown>;
      updateFace: (faceId: string) => Promise<unknown>;
      resetFace: () => Promise<unknown>;
    };

    await props.loadFaces({ page: 1, size: 50 });
    await props.updateFace('face-1');
    await props.resetFace();

    expect(sdkMock.getSpacePersonFaces).toHaveBeenCalledWith({
      id: 'space-1',
      personId: 'person-1',
      page: 1,
      size: 50,
    });
    expect(sdkMock.updateSpacePersonRepresentativeFace).toHaveBeenCalledWith({
      id: 'space-1',
      personId: 'person-1',
      spaceRepresentativeFaceUpdateDto: { assetFaceId: 'face-1' },
    });
    expect(sdkMock.updateSpacePersonRepresentativeFace).toHaveBeenCalledWith({
      id: 'space-1',
      personId: 'person-1',
      spaceRepresentativeFaceUpdateDto: { assetFaceId: null },
    });
  });

  it('ignores a forced merge action for viewers', () => {
    renderPage({ members: [makeMember({ role: SharedSpaceRole.Viewer })], action: 'merge' });

    expect(screen.queryByTestId('people-merge-selector')).not.toBeInTheDocument();
  });

  it('opens the shared merge flow for editors', () => {
    renderPage({ action: 'merge' });

    expect(screen.getByTestId('people-merge-selector')).toHaveAttribute('data-person-id', 'person-1');
  });

  it('uses same-person repair for a space person merged with a personal candidate', async () => {
    renderPage({ action: 'merge' });

    await userEvent.click(screen.getByTestId('merge-personal-candidate'));

    expect(sdkMock.mergeScopedPeople).toHaveBeenCalledWith({
      mergeScopedPeopleDto: {
        target: { type: 'space-person', id: 'person-1', spaceId: 'space-1' },
        sources: [{ type: 'person', id: 'person-candidate' }],
      },
    });
    expect(sdkMock.mergeSpacePeople).not.toHaveBeenCalled();
  });

  it('searches merge candidates with shared spaces enabled', async () => {
    renderPage({ action: 'merge' });

    await userEvent.click(screen.getByTestId('search-merge-candidates'));

    expect(sdkMock.searchPerson).toHaveBeenCalledWith({ name: 'Alice', withHidden: true, withSharedSpaces: true });
  });

  it('edits the space person name from the detail header', async () => {
    const person = makePerson({ name: '' });
    sdkMock.updateSpacePerson.mockResolvedValue({ ...person, name: 'Alice' });
    renderPage({ person });

    await userEvent.click(screen.getByText('add_a_name'));
    const input = screen.getByPlaceholderText('add_a_name');
    await userEvent.type(input, 'Alice');
    await userEvent.keyboard('{Enter}');

    expect(sdkMock.updateSpacePerson).toHaveBeenCalledWith({
      id: 'space-1',
      personId: 'person-1',
      sharedSpacePersonUpdateDto: { name: 'Alice' },
    });
    expect(await screen.findByText('Alice')).toBeInTheDocument();
  });

  it('shows matching named space people while editing an unnamed person', async () => {
    const person = makePerson({ id: 'person-1', name: '' });
    const existingPerson = makePerson({ id: 'person-2', name: 'Alice Existing' });
    sdkMock.getSpacePeople.mockResolvedValue([existingPerson]);
    renderPage({ person });

    await userEvent.click(screen.getByText('add_a_name'));
    await userEvent.type(screen.getByPlaceholderText('add_a_name'), 'Ali');

    await waitFor(() => {
      expect(sdkMock.getSpacePeople).toHaveBeenCalledWith(
        { id: 'space-1', name: 'Ali', named: true, limit: 5 },
        expect.any(Object),
      );
    });
    expect(await screen.findByRole('button', { name: 'Alice Existing' })).toBeInTheDocument();
  });

  it('updates birthdate from the detail page and reopens with the saved value', async () => {
    const person = makePerson({ birthDate: null });
    sdkMock.updateSpacePerson.mockResolvedValue({ ...person, birthDate: null });
    renderPage({ person });

    await userEvent.click(screen.getByText('set_date_of_birth'));
    const modalProps = vi.mocked(modalManager.show).mock.calls[0][1] as unknown as {
      birthDate: string | null;
      onSave: (birthDate: string) => Promise<boolean>;
    };
    expect(modalProps.birthDate).toBeNull();

    await modalProps.onSave('1990-06-15');

    expect(sdkMock.updateSpacePerson).toHaveBeenCalledWith({
      id: 'space-1',
      personId: 'person-1',
      sharedSpacePersonUpdateDto: { birthDate: '1990-06-15' },
    });
    expect(invalidateAllMock).not.toHaveBeenCalled();

    await userEvent.click(screen.getByText('set_date_of_birth'));
    const reopenedModalProps = vi.mocked(modalManager.show).mock.calls[1][1] as unknown as {
      birthDate: string | null;
    };
    expect(reopenedModalProps.birthDate).toBe('1990-06-15');
  });

  it('hides a space person from the detail page action menu', async () => {
    const person = makePerson({ isHidden: false });
    sdkMock.updateSpacePerson.mockResolvedValue({ ...person, isHidden: true });
    renderPage({ person });

    await userEvent.click(screen.getByText('hide_person'));

    expect(sdkMock.updateSpacePerson).toHaveBeenCalledWith({
      id: 'space-1',
      personId: 'person-1',
      sharedSpacePersonUpdateDto: { isHidden: true },
    });
    expect(gotoMock).toHaveBeenCalledWith('/spaces/space-1/people');
  });

  it('detaches a space person for owner or editor members after confirmation', async () => {
    vi.mocked(modalManager.showDialog).mockResolvedValue(true);
    renderPage();

    await userEvent.click(screen.getByText('separate_from_grouped_person'));

    expect(sdkMock.detachScopedPerson).toHaveBeenCalledWith({
      detachScopedPersonDto: { profile: { type: 'space-person', id: 'person-1', spaceId: 'space-1' } },
    });
    expect(invalidateAllMock).toHaveBeenCalled();
  });

  it('navigates to the surviving person after an autosuggest merge without reloading the deleted route', async () => {
    const person = makePerson({ id: 'person-1', name: '' });
    const existingPerson = makePerson({ id: 'person-2', name: 'Alice Existing' });
    sdkMock.getSpacePeople.mockResolvedValue([existingPerson]);
    vi.mocked(modalManager.showDialog).mockResolvedValue(true);
    renderPage({ person });

    await userEvent.click(screen.getByText('add_a_name'));
    await userEvent.type(screen.getByPlaceholderText('add_a_name'), 'Ali');
    await userEvent.click(await screen.findByRole('button', { name: 'Alice Existing' }));

    await waitFor(() => {
      expect(sdkMock.mergeSpacePeople).toHaveBeenCalledWith({
        id: 'space-1',
        personId: 'person-2',
        sharedSpacePersonMergeDto: { ids: ['person-1'] },
      });
    });
    expect(gotoMock).toHaveBeenCalledWith('/spaces/space-1/people/person-2', { replaceState: true });
    expect(invalidateAllMock).not.toHaveBeenCalled();
  });

  it('navigates to the surviving target after a swapped merge instead of reloading the deleted route person', async () => {
    renderPage({ action: 'merge' });

    await userEvent.click(screen.getByTestId('merge-swapped-space-candidate'));

    await waitFor(() => {
      expect(sdkMock.mergeScopedPeople).toHaveBeenCalled();
    });
    expect(gotoMock).toHaveBeenCalledWith('/spaces/space-2/people/space-person-candidate', { replaceState: true });
    expect(invalidateAllMock).not.toHaveBeenCalled();
  });

  describe('face suggestions', () => {
    beforeEach(() => {
      localStorage.clear();
      sdkMock.getSpacePersonFaceSuggestions.mockResolvedValue({ total: 0, items: [] });
      sdkMock.confirmSpacePersonFaceSuggestion.mockResolvedValue(undefined as never);
      sdkMock.dismissSpacePersonFaceSuggestion.mockResolvedValue(undefined as never);
      sdkMock.ignoreSpacePersonFaceSuggestion.mockResolvedValue(undefined as never);
    });

    it('renders the reused banner for editors and uses the space-person thumbnail URL', async () => {
      sdkMock.getSpacePersonFaceSuggestions.mockResolvedValue({
        total: 2,
        items: [makeSuggestion()],
      });

      renderPage();

      await screen.findByTestId('person-suggestion-banner');
      expect(sdkMock.getSpacePersonFaceSuggestions).toHaveBeenCalledWith({
        id: 'space-1',
        personId: 'person-1',
        page: 1,
        size: 5,
      });
      const src = screen.getByTestId('suggestion-banner-reference').getAttribute('src') ?? '';
      expect(src).toContain('/shared-spaces/space-1/people/person-1/thumbnail');
      expect(src).not.toContain('/api/people/person-1/thumbnail');
    });

    it('relies on the server read-gate for viewers and hides when the API returns zero', async () => {
      sdkMock.getSpacePersonFaceSuggestions.mockResolvedValue({ total: 0, items: [] });

      renderPage({ members: [makeMember({ role: SharedSpaceRole.Viewer })] });

      await waitFor(() => {
        expect(sdkMock.getSpacePersonFaceSuggestions).toHaveBeenCalledWith({
          id: 'space-1',
          personId: 'person-1',
          page: 1,
          size: 5,
        });
      });
      expect(screen.queryByTestId('person-suggestion-banner')).not.toBeInTheDocument();
      expect(screen.queryByTestId('suggestion-review-btn')).not.toBeInTheDocument();
    });

    it('hides the banner if the shared-space suggestion summary request fails', async () => {
      sdkMock.getSpacePersonFaceSuggestions.mockRejectedValue(new Error('not a member'));

      renderPage();

      await waitFor(() => {
        expect(sdkMock.getSpacePersonFaceSuggestions).toHaveBeenCalledWith({
          id: 'space-1',
          personId: 'person-1',
          page: 1,
          size: 5,
        });
      });
      expect(screen.queryByTestId('person-suggestion-banner')).not.toBeInTheDocument();
    });

    it('opens the review modal with shared-space SDK actions and refreshes after a confirm', async () => {
      const firstSuggestion = makeSuggestion({ assetFaceId: 'face-1' });
      let closeModal!: (value: { confirmed: number }) => void;
      sdkMock.getSpacePersonFaceSuggestions
        .mockResolvedValueOnce({ total: 1, items: [firstSuggestion] })
        .mockResolvedValueOnce({ total: 1, items: [firstSuggestion] })
        .mockResolvedValueOnce({ total: 0, items: [] });
      vi.mocked(modalManager.show).mockReturnValue(
        new Promise((resolve) => {
          closeModal = resolve;
        }) as never,
      );

      renderPage();

      await userEvent.click(await screen.findByTestId('suggestion-review-btn'));

      const modalProps = vi.mocked(modalManager.show).mock.calls[0][1] as unknown as {
        referenceThumbnailUrl: string;
        loadPage: (request: { page: number; size: number }) => Promise<PersonFaceSuggestionPageResponseDto>;
        confirm: (assetFaceId: string) => Promise<void>;
        dismiss: (assetFaceId: string) => Promise<void>;
        ignore: (assetFaceId: string) => Promise<void>;
      };

      expect(modalProps.referenceThumbnailUrl).toContain('/shared-spaces/space-1/people/person-1/thumbnail');

      await modalProps.loadPage({ page: 2, size: 50 });
      expect(sdkMock.getSpacePersonFaceSuggestions).toHaveBeenLastCalledWith({
        id: 'space-1',
        personId: 'person-1',
        page: 2,
        size: 50,
      });

      await modalProps.confirm('face-1');
      expect(sdkMock.confirmSpacePersonFaceSuggestion).toHaveBeenCalledWith({
        id: 'space-1',
        personId: 'person-1',
        assetFaceId: 'face-1',
      });

      await modalProps.dismiss('face-2');
      expect(sdkMock.dismissSpacePersonFaceSuggestion).toHaveBeenCalledWith({
        id: 'space-1',
        personId: 'person-1',
        assetFaceId: 'face-2',
      });

      await modalProps.ignore('face-3');
      expect(sdkMock.ignoreSpacePersonFaceSuggestion).toHaveBeenCalledWith({
        id: 'space-1',
        personId: 'person-1',
        assetFaceId: 'face-3',
      });

      closeModal({ confirmed: 1 });

      await waitFor(() => expect(invalidateAllMock).toHaveBeenCalled());
      await waitFor(() => {
        expect(sdkMock.getSpacePersonFaceSuggestions).toHaveBeenLastCalledWith({
          id: 'space-1',
          personId: 'person-1',
          page: 1,
          size: 5,
        });
      });
    });

    it('keeps modal actions scoped to the person the review was opened for after route navigation', async () => {
      let closeModal!: (value: { confirmed: number }) => void;
      sdkMock.getSpacePersonFaceSuggestions
        .mockResolvedValueOnce({ total: 1, items: [makeSuggestion({ assetFaceId: 'face-1' })] })
        .mockResolvedValueOnce({ total: 2, items: [makeSuggestion({ assetFaceId: 'face-2' })] })
        .mockResolvedValueOnce({ total: 0, items: [] });
      vi.mocked(modalManager.show).mockReturnValue(
        new Promise((resolve) => {
          closeModal = resolve;
        }) as never,
      );

      const secondPerson = makePerson({
        id: 'person-2',
        name: 'Bob',
        updatedAt: '2026-01-03T00:00:00.000Z',
      });
      const view = renderPage();

      await userEvent.click(await screen.findByTestId('suggestion-review-btn'));

      const modalProps = vi.mocked(modalManager.show).mock.calls[0][1] as unknown as {
        loadPage: (request: { page: number; size: number }) => Promise<PersonFaceSuggestionPageResponseDto>;
        confirm: (assetFaceId: string) => Promise<void>;
        dismiss: (assetFaceId: string) => Promise<void>;
        ignore: (assetFaceId: string) => Promise<void>;
      };

      await view.rerender({
        component: SpacePersonDetailPage,
        componentProps: {
          data: {
            space: makeSpace(),
            members: [makeMember()],
            person: secondPerson,
            statistics: { assets: secondPerson.assetCount, faces: secondPerson.faceCount },
            action: null,
            previousRoute: null,
            meta: { title: 'Bob - Test Space' },
          },
        },
      });

      await waitFor(() => {
        expect(sdkMock.getSpacePersonFaceSuggestions).toHaveBeenLastCalledWith({
          id: 'space-1',
          personId: 'person-2',
          page: 1,
          size: 5,
        });
      });

      await modalProps.loadPage({ page: 2, size: 50 });
      await modalProps.confirm('face-1');
      await modalProps.dismiss('face-2');
      await modalProps.ignore('face-3');

      expect(sdkMock.getSpacePersonFaceSuggestions).toHaveBeenLastCalledWith({
        id: 'space-1',
        personId: 'person-1',
        page: 2,
        size: 50,
      });
      expect(sdkMock.confirmSpacePersonFaceSuggestion).toHaveBeenCalledWith({
        id: 'space-1',
        personId: 'person-1',
        assetFaceId: 'face-1',
      });
      expect(sdkMock.dismissSpacePersonFaceSuggestion).toHaveBeenCalledWith({
        id: 'space-1',
        personId: 'person-1',
        assetFaceId: 'face-2',
      });
      expect(sdkMock.ignoreSpacePersonFaceSuggestion).toHaveBeenCalledWith({
        id: 'space-1',
        personId: 'person-1',
        assetFaceId: 'face-3',
      });

      closeModal({ confirmed: 1 });

      await waitFor(() => expect(invalidateAllMock).toHaveBeenCalled());
      await waitFor(() => {
        expect(sdkMock.getSpacePersonFaceSuggestions).toHaveBeenLastCalledWith({
          id: 'space-1',
          personId: 'person-1',
          page: 1,
          size: 5,
        });
      });
    });

    it('keys Not now snooze by the space person id', async () => {
      sdkMock.getSpacePersonFaceSuggestions.mockResolvedValue({
        total: 2,
        items: [makeSuggestion()],
      });

      const firstRender = renderPage({ person: makePerson({ id: 'person-1', name: 'Alice' }) });
      await screen.findByTestId('person-suggestion-banner');
      await userEvent.click(screen.getByTestId('suggestion-snooze-btn'));
      expect(screen.queryByTestId('person-suggestion-banner')).not.toBeInTheDocument();
      firstRender.unmount();

      renderPage({ person: makePerson({ id: 'person-2', name: 'Alice in another space cluster' }) });

      await screen.findByTestId('person-suggestion-banner');
    });

    it('reloads suggestions when navigating to another space person in the same route component', async () => {
      sdkMock.getSpacePersonFaceSuggestions
        .mockResolvedValueOnce({ total: 2, items: [makeSuggestion({ assetFaceId: 'face-1' })] })
        .mockResolvedValueOnce({ total: 0, items: [] });
      const firstPerson = makePerson({ id: 'person-1', name: 'Alice' });
      const secondPerson = makePerson({
        id: 'person-2',
        name: 'Bob',
        updatedAt: '2026-01-03T00:00:00.000Z',
      });

      const view = renderPage({ person: firstPerson });

      await screen.findByTestId('person-suggestion-banner');

      await view.rerender({
        component: SpacePersonDetailPage,
        componentProps: {
          data: {
            space: makeSpace(),
            members: [makeMember()],
            person: secondPerson,
            statistics: { assets: secondPerson.assetCount, faces: secondPerson.faceCount },
            action: null,
            previousRoute: null,
            meta: { title: 'Bob - Test Space' },
          },
        },
      });

      await waitFor(() => {
        expect(sdkMock.getSpacePersonFaceSuggestions).toHaveBeenLastCalledWith({
          id: 'space-1',
          personId: 'person-2',
          page: 1,
          size: 5,
        });
      });
      await waitFor(() => expect(screen.queryByTestId('person-suggestion-banner')).not.toBeInTheDocument());
    });
  });
});
