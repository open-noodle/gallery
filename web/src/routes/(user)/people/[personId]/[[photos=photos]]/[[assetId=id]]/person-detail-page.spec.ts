import {
  SharedSpaceRole,
  Type,
  type PersonFaceSuggestionPageResponseDto,
  type PersonResponseDto,
  type PersonStatisticsResponseDto,
  type SharedSpaceMemberResponseDto,
} from '@immich/sdk';
import { modalManager, toastManager } from '@immich/ui';
import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import type { Component } from 'svelte';
import type { Mock } from 'vitest';
import { sdkMock } from '$lib/__mocks__/sdk.mock';
import TestWrapper from '$lib/components/TestWrapper.svelte';
import { authManager } from '$lib/managers/auth-manager.svelte';
import { isSuggestionSnoozed, snoozeSuggestions } from '$lib/utils/face-suggestion-snooze';
import { preferencesFactory } from '@test-data/factories/preferences-factory';
import { userAdminFactory } from '@test-data/factories/user-factory';
import PersonDetailPage from './+page.svelte';

const {
  afterNavigateMock,
  featureFlagsMock,
  formatMessage,
  gotoMock,
  invalidateAllMock,
  mockAssetMultiSelectManager,
  mockPage,
} = vi.hoisted(() => {
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
    afterNavigateMock: vi.fn(),
    featureFlagsMock: { value: { peopleStatistics: true } },
    formatMessage,
    gotoMock: vi.fn(),
    invalidateAllMock: vi.fn(),
    mockAssetMultiSelectManager: {
      selectionActive: false,
      assets: [],
      clear: vi.fn(),
      isAllUserOwned: true,
      isAllFavorite: false,
      isAllArchived: false,
    },
    mockPage: {
      url: new URL('https://gallery.test/people/person-1'),
      route: { id: '/(user)/people/[personId]/[[photos=photos]]/[[assetId=id]]' },
      params: { personId: 'person-1' },
    },
  };
});

vi.mock('$lib/managers/feature-flags-manager.svelte', () => ({
  featureFlagsManager: featureFlagsMock,
}));

vi.mock('$app/navigation', () => ({
  afterNavigate: afterNavigateMock,
  goto: gotoMock,
  invalidateAll: invalidateAllMock,
}));

vi.mock('$app/stores', () => ({
  page: {
    subscribe: (run: (value: typeof mockPage) => void) => {
      run(mockPage);
      return () => {};
    },
  },
  navigating: {
    subscribe: (run: (value: null) => void) => {
      run(null);
      return () => {};
    },
  },
}));

vi.mock('svelte-i18n', () => ({
  t: {
    subscribe: (run: (formatter: typeof formatMessage) => void) => {
      run(formatMessage);
      return () => {};
    },
  },
}));

vi.mock('$lib/managers/asset-multi-select-manager.svelte', () => ({
  assetMultiSelectManager: mockAssetMultiSelectManager,
}));

vi.mock('@immich/ui', async (importOriginal) => {
  const original = await importOriginal<typeof import('@immich/ui')>();
  const { default: MockContextMenuButton } = await import('@test-data/mocks/action-context-menu.stub.svelte');
  return {
    ...original,
    ContextMenuButton: MockContextMenuButton,
    modalManager: { show: vi.fn(), showDialog: vi.fn() },
    toastManager: { primary: vi.fn(), success: vi.fn(), warning: vi.fn(), danger: vi.fn() },
  };
});

vi.mock('$lib/components/OnEvents.svelte', async () => {
  const { default: MockComponent } = await import('@test-data/mocks/noop-component.svelte');
  return { default: MockComponent };
});

vi.mock('$lib/components/timeline/Timeline.svelte', async () => {
  const { default: MockComponent } =
    await import('./../../../../spaces/[spaceId]/people/[personId]/[[photos=photos]]/[[assetId=id]]/mock-space-person-timeline.test-wrapper.svelte');
  return { default: MockComponent };
});

vi.mock('$lib/components/assets/thumbnail/ImageThumbnail.svelte', async () => {
  const { default: MockComponent } = await import('@test-data/mocks/image-thumbnail.stub.svelte');
  return { default: MockComponent };
});

vi.mock('$lib/components/people/people-merge-selector.svelte', async () => {
  const { default: MockComponent } = await import('@test-data/mocks/people-merge-selector.stub.svelte');
  return { default: MockComponent };
});

vi.mock('$lib/modals/RepresentativeFacePickerModal.svelte', async () => {
  const { default: MockComponent } = await import('@test-data/mocks/noop-component.svelte');
  return { default: MockComponent };
});

vi.mock('$lib/modals/PersonSuggestionReviewModal.svelte', async () => {
  const { default: MockComponent } = await import('@test-data/mocks/noop-component.svelte');
  return { default: MockComponent };
});

function makePerson(overrides: Partial<PersonResponseDto> = {}): PersonResponseDto {
  return {
    id: 'person-1',
    name: 'Alice',
    birthDate: null,
    thumbnailPath: '/thumb.jpg',
    isHidden: false,
    isFavorite: false,
    color: undefined,
    updatedAt: '2026-01-02T00:00:00.000Z',
    type: 'person',
    species: null,
    ...overrides,
  };
}

function makeMember(userId: string, role: SharedSpaceRole): SharedSpaceMemberResponseDto {
  return {
    userId,
    role,
    email: `${userId}@test.dev`,
    name: userId,
    joinedAt: '2026-01-01T00:00:00.000Z',
    sharePersonMetadata: true,
    showInTimeline: true,
  };
}

function makeSuggestion(overrides: Partial<PersonFaceSuggestionPageResponseDto['items'][number]> = {}) {
  return {
    assetFaceId: 'face-1',
    assetId: 'asset-1',
    distance: 0.6,
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
  person = makePerson(),
  statistics = { assets: 5, faces: 6 },
}: {
  person?: PersonResponseDto;
  statistics?: PersonStatisticsResponseDto;
} = {}) {
  authManager.setUser(userAdminFactory.build({ id: 'current-user-id' }));
  authManager.setPreferences(preferencesFactory.build());

  const props = {
    data: {
      person,
      statistics,
      meta: { title: person.name || 'Person' },
    },
  };

  return render(TestWrapper as Component<{ component: typeof PersonDetailPage; componentProps: typeof props }>, {
    component: PersonDetailPage,
    componentProps: props,
  });
}

describe('Person detail page', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    gotoMock.mockResolvedValue(undefined);
    invalidateAllMock.mockResolvedValue(undefined);
    mockAssetMultiSelectManager.selectionActive = false;
    mockAssetMultiSelectManager.assets = [];
    sdkMock.getPerson.mockResolvedValue(makePerson());
    sdkMock.getPersonFaceSuggestions.mockResolvedValue({ total: 0, items: [] });
    featureFlagsMock.value.peopleStatistics = true;
    // Gallery-fork: family relationships, slice 8. `FamilyRelationsPanel`'s data source has no
    // generated SDK function yet (see family-relations.ts), so every render of this page makes a
    // real `fetch` call unless stubbed here — this suite isn't testing that panel, so refuse it
    // quietly rather than let it hit the network.
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 403, json: () => Promise.resolve({}) }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('uses same-person repair when merging a personal person with a space-primary candidate', async () => {
    renderPage();

    await userEvent.click(screen.getByText('merge_people'));
    await userEvent.click(screen.getByTestId('merge-space-candidate'));

    expect(sdkMock.mergeScopedPeople).toHaveBeenCalledWith({
      mergeScopedPeopleDto: {
        target: { type: 'person', id: 'person-1' },
        sources: [{ type: 'space-person', id: 'space-person-candidate', spaceId: 'space-2' }],
      },
    });
    expect(sdkMock.mergePerson).not.toHaveBeenCalled();
  });

  it('shows the descriptive message and does not merge a classic merge blocked across owners', async () => {
    vi.mocked(sdkMock.isHttpError).mockImplementation((error) => !!(error as { __http?: boolean })?.__http);
    sdkMock.mergePerson.mockRejectedValueOnce({
      __http: true,
      status: 403,
      data: { code: 'cross_owner_merge_blocked', message: 'An administrator can enable it.' },
      message: 'raw',
    });

    renderPage();

    await userEvent.click(screen.getByText('merge_people'));
    await userEvent.click(screen.getByTestId('merge-personal-candidate'));

    await waitFor(() => expect(toastManager.danger).toHaveBeenCalled());
    expect(sdkMock.mergePerson).toHaveBeenCalledTimes(1);
    expect(modalManager.showDialog).not.toHaveBeenCalled();
  });

  it('re-runs a classic merge with the cross-owner acknowledgement once the user confirms', async () => {
    vi.mocked(sdkMock.isHttpError).mockImplementation((error) => !!(error as { __http?: boolean })?.__http);
    sdkMock.mergePerson
      .mockRejectedValueOnce({
        __http: true,
        status: 409,
        data: { code: 'cross_owner_merge_confirmation_required', impactedOwnerCount: 1 },
        message: 'raw',
      })
      .mockResolvedValueOnce([{ id: 'person-candidate', success: true }]);
    vi.mocked(modalManager.showDialog).mockResolvedValue(true);

    renderPage();

    await userEvent.click(screen.getByText('merge_people'));
    await userEvent.click(screen.getByTestId('merge-personal-candidate'));

    await waitFor(() => expect(sdkMock.mergePerson).toHaveBeenCalledTimes(2));
    expect(sdkMock.mergePerson).toHaveBeenNthCalledWith(1, {
      id: 'person-1',
      mergePersonDto: { ids: ['person-candidate'] },
    });
    expect(sdkMock.mergePerson).toHaveBeenNthCalledWith(2, {
      id: 'person-1',
      mergePersonDto: { ids: ['person-candidate'], confirmCrossOwner: true },
    });
  });

  it('renders asset and face counts in the person header', () => {
    renderPage({
      person: makePerson({ name: 'Alice' }),
      statistics: { assets: 7, faces: 10 },
    });

    expect(screen.getByText('7 assets')).toBeInTheDocument();
    expect(screen.getByText('10 faces')).toBeInTheDocument();
  });

  it('hides the face count line when the peopleStatistics feature flag is disabled', () => {
    featureFlagsMock.value.peopleStatistics = false;
    renderPage({
      person: makePerson({ name: 'Alice' }),
      statistics: { assets: 7, faces: 10 },
    });

    expect(screen.getByText('7 assets')).toBeInTheDocument();
    expect(screen.queryByText('10 faces')).not.toBeInTheDocument();
  });

  it('keeps the page person as the repair target when a space candidate is promoted by auto-swap', async () => {
    renderPage({ person: makePerson({ name: '' }) });

    await userEvent.click(screen.getByText('merge_people'));
    await userEvent.click(screen.getByTestId('merge-swapped-space-candidate'));

    expect(sdkMock.mergeScopedPeople).toHaveBeenCalledWith({
      mergeScopedPeopleDto: {
        target: { type: 'person', id: 'person-1' },
        sources: [{ type: 'space-person', id: 'space-person-candidate', spaceId: 'space-2' }],
      },
    });
    expect(sdkMock.getPerson).toHaveBeenCalledWith({ id: 'person-1' });
  });

  it('routes swapped space candidates to their space-person detail page', async () => {
    renderPage();

    await userEvent.click(screen.getByText('merge_people'));
    await userEvent.click(screen.getByTestId('swap-space-candidate'));

    expect(gotoMock).toHaveBeenCalledWith(
      '/spaces/space-2/people/space-person-candidate?previousRoute=%2Fpeople&action=merge',
    );
  });

  it('searches merge candidates with shared spaces enabled', async () => {
    renderPage();

    await userEvent.click(screen.getByText('merge_people'));
    await userEvent.click(screen.getByTestId('search-merge-candidates'));

    expect(sdkMock.searchPerson).toHaveBeenCalledWith({ name: 'Alice', withHidden: true, withSharedSpaces: true });
  });

  it('loads the global person timeline with shared-space assets included', () => {
    renderPage();

    const options = JSON.parse(screen.getByTestId('timeline-stub').dataset.options ?? '{}');
    expect(options).toEqual(
      expect.objectContaining({
        personIds: ['person-1'],
        visibility: 'timeline',
        withSharedSpaces: true,
      }),
    );
  });

  it('uses the scoped person token for identity-wide shared-space timelines', () => {
    renderPage({
      person: makePerson({
        id: 'space-person-1',
        filterId: 'space-person:space-person-1',
        primaryProfile: { type: Type.SpacePerson, id: 'space-person-1', spaceId: 'space-1' },
      }),
    });

    const options = JSON.parse(screen.getByTestId('timeline-stub').dataset.options ?? '{}');
    expect(options).toEqual(
      expect.objectContaining({
        personIds: ['space-person:space-person-1'],
        visibility: 'timeline',
        withSharedSpaces: true,
      }),
    );
  });

  it('renders person timeline grouping controls and passes mobile grouping props', async () => {
    renderPage();

    expect(await screen.findByTestId('timeline-desktop-grouping-control')).toBeInTheDocument();
    expect(screen.getByTestId('timeline-grouping-day')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('timeline-mobile-grouping-props')).toHaveTextContent(
      JSON.stringify({ grouping: 'day', hasHandler: true }),
    );
  });

  it('shows the add-all-to-collection button when the surface has results', async () => {
    renderPage({ statistics: { assets: 3, faces: 6 } });

    expect(await screen.findByTestId('add-all-to-collection')).toBeInTheDocument();
  });

  it('hides the add-all-to-collection button when empty', async () => {
    renderPage({ statistics: { assets: 0, faces: 6 } });

    await screen.findByTestId('timeline-stub');
    expect(screen.queryByTestId('add-all-to-collection')).not.toBeInTheDocument();
  });

  it('keeps the grouping control outside the scrolling timeline so it stays visible while scrolling', async () => {
    const { container } = renderPage();

    const main = container.querySelector<HTMLElement>('main');
    const timeline = screen.getByTestId('space-person-timeline');
    const header = await screen.findByTestId('person-timeline-header');
    const control = await screen.findByTestId('timeline-desktop-grouping-control');

    // Regression guard for Hagen's report: the switcher must not scroll away with the photo
    // grid, so it must live outside the timeline scroll container and the person header
    // (both of which scroll) — pinned in the sticky page chrome instead, exactly like Tags.
    expect(timeline).not.toContainElement(control);
    expect(header).not.toContainElement(control);
    expect(main).toContainElement(control);
  });

  it('changes person timeline grouping while preserving person scope without temporal chips', async () => {
    renderPage();

    await fireEvent.click(await screen.findByTestId('timeline-grouping-year'));

    await waitFor(() => {
      expect(screen.getByTestId('timeline-options')).toHaveTextContent('"grouping":"year"');
    });
    expect(screen.getByTestId('timeline-options')).toHaveTextContent('"personIds":["person-1"]');
    expect(screen.getByTestId('timeline-options')).toHaveTextContent('"withSharedSpaces":true');
    expect(screen.queryByTestId('active-filters-bar')).not.toBeInTheDocument();
    expect(screen.getByTestId('timeline-anchor')).toHaveTextContent('null');
  });

  it('activating person year and month buckets preserves person scope without temporal chips', async () => {
    renderPage();

    await fireEvent.click(await screen.findByTestId('activate-year-bucket'));
    await waitFor(() => {
      expect(screen.getByTestId('timeline-options')).toHaveTextContent('"grouping":"month"');
      expect(screen.getByTestId('timeline-options')).toHaveTextContent('"personIds":["person-1"]');
      expect(screen.getByTestId('timeline-options')).not.toHaveTextContent('"takenAfter"');
      expect(screen.getByTestId('timeline-options')).not.toHaveTextContent('"takenBefore"');
      expect(screen.queryByTestId('active-filters-bar')).not.toBeInTheDocument();
      expect(screen.getByTestId('timeline-anchor')).toHaveTextContent('{"year":2015}');
    });

    await fireEvent.click(screen.getByTestId('activate-month-bucket'));
    await waitFor(() => {
      expect(screen.getByTestId('timeline-options')).toHaveTextContent('"grouping":"day"');
      expect(screen.getByTestId('timeline-options')).toHaveTextContent('"personIds":["person-1"]');
      expect(screen.getByTestId('timeline-options')).not.toHaveTextContent('"takenAfter"');
      expect(screen.getByTestId('timeline-options')).not.toHaveTextContent('"takenBefore"');
      expect(screen.queryByTestId('active-filters-bar')).not.toBeInTheDocument();
      expect(screen.getByTestId('timeline-anchor')).toHaveTextContent('{"year":2015,"month":8}');
    });
  });

  it('person bucket activation keeps scope without rendering ActiveFiltersBar', async () => {
    renderPage();

    await fireEvent.click(await screen.findByTestId('activate-year-bucket'));

    await waitFor(() => {
      expect(screen.getByTestId('timeline-options')).toHaveTextContent('"grouping":"month"');
      expect(screen.getByTestId('timeline-options')).toHaveTextContent('"personIds":["person-1"]');
      expect(screen.getByTestId('timeline-options')).toHaveTextContent('"withSharedSpaces":true');
      expect(screen.queryByTestId('active-filters-bar')).not.toBeInTheDocument();
      expect(screen.getByTestId('timeline-anchor')).toHaveTextContent('{"year":2015}');
    });
  });

  it('selection mode hides timeline grouping controls on the person page', () => {
    mockAssetMultiSelectManager.selectionActive = true;

    renderPage();

    expect(screen.queryByTestId('timeline-desktop-grouping-control')).not.toBeInTheDocument();
  });

  it('ignores person bucket activation while selection mode is active', async () => {
    mockAssetMultiSelectManager.selectionActive = true;

    renderPage();
    await fireEvent.click(await screen.findByTestId('activate-year-bucket'));

    await waitFor(() => {
      expect(screen.getByTestId('timeline-options')).toHaveTextContent('"grouping":"day"');
      expect(screen.getByTestId('timeline-anchor')).toHaveTextContent('null');
    });
    expect(screen.queryByTestId('active-filters-bar')).not.toBeInTheDocument();
  });

  it('uses the shared-space thumbnail for a space-primary identity-wide person page', () => {
    renderPage({
      person: makePerson({
        id: 'space-person-1',
        filterId: 'space-person:space-person-1',
        primaryProfile: { type: Type.SpacePerson, id: 'space-person-1', spaceId: 'space-1' },
      }),
    });

    expect(screen.getByRole('img', { name: 'Alice' }).getAttribute('src')).toContain(
      '/shared-spaces/space-1/people/space-person-1/thumbnail?updatedAt=2026-01-02T00%3A00%3A00.000Z',
    );
  });

  it('hides space-person write actions when the current user is a space viewer', async () => {
    sdkMock.getMembers.mockResolvedValue([makeMember('current-user-id', SharedSpaceRole.Viewer)]);
    renderPage({
      person: makePerson({
        id: 'space-person-1',
        primaryProfile: { type: Type.SpacePerson, id: 'space-person-1', spaceId: 'viewer-space-detail' },
      }),
    });

    await waitFor(() => expect(sdkMock.getMembers).toHaveBeenCalledWith({ id: 'viewer-space-detail' }));
    await waitFor(() => expect(screen.queryByText('set_date_of_birth')).not.toBeInTheDocument());
    expect(screen.queryByText('hide_person')).not.toBeInTheDocument();
    expect(screen.queryByText('select_representative_face')).not.toBeInTheDocument();
  });

  it('hides the merge option for a space-primary person the actor cannot edit', async () => {
    sdkMock.getMembers.mockResolvedValue([makeMember('current-user-id', SharedSpaceRole.Viewer)]);
    renderPage({
      person: makePerson({
        id: 'space-person-1',
        primaryProfile: { type: Type.SpacePerson, id: 'space-person-1', spaceId: 'viewer-space-detail-merge-gate' },
      }),
    });

    await waitFor(() => expect(sdkMock.getMembers).toHaveBeenCalledWith({ id: 'viewer-space-detail-merge-gate' }));
    expect(screen.queryByText('merge_people')).not.toBeInTheDocument();
  });

  it('keeps space-person write actions for space editors', async () => {
    sdkMock.getMembers.mockResolvedValue([makeMember('current-user-id', SharedSpaceRole.Editor)]);
    renderPage({
      person: makePerson({
        id: 'space-person-1',
        primaryProfile: { type: Type.SpacePerson, id: 'space-person-1', spaceId: 'editor-space-detail' },
      }),
    });

    await waitFor(() => expect(sdkMock.getMembers).toHaveBeenCalledWith({ id: 'editor-space-detail' }));
    expect(screen.getByText('set_date_of_birth')).toBeInTheDocument();
    expect(screen.getByText('hide_person')).toBeInTheDocument();
    expect(screen.getByText('select_representative_face')).toBeInTheDocument();
  });

  it('opens the representative face picker from the person menu', async () => {
    renderPage();

    await userEvent.click(screen.getByText('select_representative_face'));

    expect(modalManager.show).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        title: 'select_representative_face',
        loadFaces: expect.any(Function),
        updateFace: expect.any(Function),
        canUpdate: true,
        getThumbnailUrl: expect.any(Function),
      }),
    );
  });

  it('uses exact-face SDK calls for personal representative selection', async () => {
    sdkMock.getPersonFaces.mockResolvedValue({ faces: [], hasNextPage: false });
    sdkMock.updateRepresentativeFace.mockResolvedValue(makePerson({ updatedAt: '2026-02-01T00:00:00.000Z' }));
    renderPage();

    await userEvent.click(screen.getByText('select_representative_face'));
    const props = vi.mocked(modalManager.show).mock.calls[0][1] as unknown as {
      loadFaces: (request: { page: number; size: number }) => Promise<unknown>;
      updateFace: (faceId: string) => Promise<unknown>;
    };

    await props.loadFaces({ page: 2, size: 50 });
    await props.updateFace('face-1');

    expect(sdkMock.getPersonFaces).toHaveBeenCalledWith({ id: 'person-1', page: 2, size: 50 });
    expect(sdkMock.updateRepresentativeFace).toHaveBeenCalledWith({
      id: 'person-1',
      representativeFaceUpdateDto: { assetFaceId: 'face-1' },
    });
  });

  it('does not enter timeline single-select mode for representative face picker', async () => {
    renderPage();

    await userEvent.click(screen.getByText('select_representative_face'));

    expect(modalManager.show).toHaveBeenCalled();
    expect(screen.getByTestId('timeline-stub')).not.toHaveAttribute('singleSelect');
    expect(screen.getByTestId('timeline-stub')).not.toHaveAttribute('isSelectionMode');
  });

  it('detaches the personal profile after confirmation', async () => {
    vi.mocked(modalManager.showDialog).mockResolvedValue(true);
    renderPage();

    await userEvent.click(screen.getByText('separate_from_grouped_person'));

    expect(sdkMock.detachScopedPerson).toHaveBeenCalledWith({
      detachScopedPersonDto: { profile: { type: 'person', id: 'person-1' } },
    });
    expect(invalidateAllMock).toHaveBeenCalled();
  });
});

describe('face suggestions', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    gotoMock.mockResolvedValue(undefined);
    invalidateAllMock.mockResolvedValue(undefined);
    mockAssetMultiSelectManager.selectionActive = false;
    mockAssetMultiSelectManager.assets = [];
    sdkMock.getPerson.mockResolvedValue(makePerson());
    sdkMock.getPersonFaceSuggestions.mockResolvedValue({ total: 0, items: [] });
    sdkMock.confirmPersonFaceSuggestion.mockResolvedValue(undefined as never);
    sdkMock.dismissPersonFaceSuggestion.mockResolvedValue(undefined as never);
    sdkMock.ignorePersonFaceSuggestion.mockResolvedValue(undefined as never);
    sdkMock.getSpacePersonFaceSuggestions.mockResolvedValue({ total: 0, items: [] });
    sdkMock.confirmSpacePersonFaceSuggestion.mockResolvedValue(undefined as never);
    sdkMock.dismissSpacePersonFaceSuggestion.mockResolvedValue(undefined as never);
    sdkMock.ignoreSpacePersonFaceSuggestion.mockResolvedValue(undefined as never);
    sdkMock.getMembers.mockResolvedValue([makeMember('current-user-id', SharedSpaceRole.Editor)]);
    // See the note in the 'Person detail page' describe above.
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 403, json: () => Promise.resolve({}) }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders the banner when the API returns suggestions for a named owned person', async () => {
    sdkMock.getPersonFaceSuggestions.mockResolvedValue({
      total: 4,
      items: [
        {
          assetFaceId: 'f1',
          assetId: 'a1',
          distance: 0.6,
          imageWidth: 100,
          imageHeight: 100,
          boundingBoxX1: 10,
          boundingBoxX2: 40,
          boundingBoxY1: 10,
          boundingBoxY2: 40,
        },
      ],
    });
    renderPage({ person: makePerson({ name: 'Alice' }) });
    await screen.findByTestId('person-suggestion-banner');
    expect(sdkMock.getPersonFaceSuggestions).toHaveBeenCalledWith({ id: 'person-1', page: 1, size: 5 });
  });

  // S12.3 (pin): the new canEditSpacePerson gate (S12.2) must never suppress the banner for a personal
  // (non-space) person — that flag is a space-write-role check, not a general "may this viewer act" gate, and
  // it must stay true unconditionally when there is no space profile to check a role against.
  it('pin: a personal (non-space) person always renders the banner for its owner', async () => {
    sdkMock.getPersonFaceSuggestions.mockResolvedValue({
      total: 2,
      items: [makeSuggestion()],
    });
    renderPage({ person: makePerson({ name: 'Alice', primaryProfile: undefined }) });

    await screen.findByTestId('person-suggestion-banner');
  });

  it('renders no banner when the API returns total 0 (server read-gate: edges 7/13)', async () => {
    sdkMock.getPersonFaceSuggestions.mockResolvedValue({ total: 0, items: [] });
    renderPage({ person: makePerson({ name: 'Alice' }) });
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByTestId('person-suggestion-banner')).not.toBeInTheDocument();
  });

  // A space member who owns no person row for the identity reaches the shared person through this
  // (global) route from the main People list — their primaryProfile is the space profile. Suggestions
  // must come from the space endpoint there, not be skipped, otherwise the banner is only ever
  // reachable inside /spaces/... and a non-owner never sees it (#834 follow-up).
  it('loads suggestions from the space endpoint for a space-primary person', async () => {
    sdkMock.getSpacePersonFaceSuggestions.mockResolvedValue({
      total: 4,
      items: [makeSuggestion({ assetFaceId: 'face-1' })],
    });

    renderPage({
      person: makePerson({
        id: 'space-person-1',
        name: 'Alice',
        primaryProfile: { type: Type.SpacePerson, id: 'space-person-1', spaceId: 'space-suggest-banner' },
      }),
    });

    await screen.findByTestId('person-suggestion-banner');
    expect(sdkMock.getSpacePersonFaceSuggestions).toHaveBeenCalledWith({
      id: 'space-suggest-banner',
      personId: 'space-person-1',
      page: 1,
      size: 5,
    });
    expect(sdkMock.getPersonFaceSuggestions).not.toHaveBeenCalled();
  });

  // S12.2: client-side defence in depth, mirroring S12.1 on the space route. The server already returns
  // `{ total: 0 }` to non-editors (covered above), but that is enforced only by the read endpoint. This test
  // uses the SAME non-zero suggestion data for both halves, differing only in role, so it cannot pass on
  // `total: 0` alone. Two distinct spaceIds are used because `isSpaceEditor` caches its result per
  // `spaceId:userId` — reusing one space between the two renders would read the first render's cached answer.
  it('gates the banner on canEditSpacePerson: a space viewer with pending suggestions renders none, an editor with the same data does', async () => {
    sdkMock.getSpacePersonFaceSuggestions.mockResolvedValue({
      total: 3,
      items: [makeSuggestion({ assetFaceId: 'face-1' })],
    });

    sdkMock.getMembers.mockResolvedValueOnce([makeMember('current-user-id', SharedSpaceRole.Viewer)]);
    const viewerRender = renderPage({
      person: makePerson({
        id: 'space-person-1',
        name: 'Alice',
        primaryProfile: { type: Type.SpacePerson, id: 'space-person-1', spaceId: 'space-suggest-gate-viewer' },
      }),
    });
    await waitFor(() => expect(sdkMock.getMembers).toHaveBeenCalledWith({ id: 'space-suggest-gate-viewer' }));
    await waitFor(() => expect(screen.queryByTestId('person-suggestion-banner')).not.toBeInTheDocument());
    viewerRender.unmount();

    sdkMock.getMembers.mockResolvedValueOnce([makeMember('current-user-id', SharedSpaceRole.Editor)]);
    renderPage({
      person: makePerson({
        id: 'space-person-1',
        name: 'Alice',
        primaryProfile: { type: Type.SpacePerson, id: 'space-person-1', spaceId: 'space-suggest-gate-editor' },
      }),
    });
    await screen.findByTestId('person-suggestion-banner');
  });

  it('renders no banner for a space-primary person when the space endpoint returns total 0', async () => {
    sdkMock.getSpacePersonFaceSuggestions.mockResolvedValue({ total: 0, items: [] });

    renderPage({
      person: makePerson({
        id: 'space-person-1',
        name: 'Alice',
        primaryProfile: { type: Type.SpacePerson, id: 'space-person-1', spaceId: 'space-suggest-viewer' },
      }),
    });

    await waitFor(() => expect(sdkMock.getSpacePersonFaceSuggestions).toHaveBeenCalled());
    expect(screen.queryByTestId('person-suggestion-banner')).not.toBeInTheDocument();
  });

  it('shows the space thumbnail as the banner reference for a space-primary person', async () => {
    sdkMock.getSpacePersonFaceSuggestions.mockResolvedValue({
      total: 1,
      items: [makeSuggestion({ assetFaceId: 'face-1' })],
    });

    renderPage({
      person: makePerson({
        id: 'space-person-1',
        name: 'Alice',
        primaryProfile: { type: Type.SpacePerson, id: 'space-person-1', spaceId: 'space-suggest-thumbnail' },
      }),
    });

    const reference = await screen.findByTestId('suggestion-banner-reference');
    expect(reference.getAttribute('src')).toContain(
      '/shared-spaces/space-suggest-thumbnail/people/space-person-1/thumbnail',
    );
  });

  it('opens the review modal with space SDK actions for a space-primary person', async () => {
    let closeModal!: (value: { confirmed: number }) => void;
    sdkMock.getSpacePersonFaceSuggestions
      .mockResolvedValueOnce({ total: 1, items: [makeSuggestion({ assetFaceId: 'face-1' })] })
      .mockResolvedValueOnce({ total: 0, items: [] });
    vi.mocked(modalManager.show).mockReturnValue(
      new Promise((resolve) => {
        closeModal = resolve;
      }) as never,
    );

    renderPage({
      person: makePerson({
        id: 'space-person-1',
        name: 'Alice',
        primaryProfile: { type: Type.SpacePerson, id: 'space-person-1', spaceId: 'space-suggest-modal' },
      }),
    });

    await userEvent.click(await screen.findByTestId('suggestion-review-btn'));

    const modalProps = vi.mocked(modalManager.show).mock.calls[0][1] as unknown as {
      loadPage: (request: { page: number; size: number }) => Promise<PersonFaceSuggestionPageResponseDto>;
      confirm: (assetFaceId: string) => Promise<void>;
      dismiss: (assetFaceId: string) => Promise<void>;
      ignore: (assetFaceId: string) => Promise<void>;
    };

    await modalProps.loadPage({ page: 2, size: 50 });
    expect(sdkMock.getSpacePersonFaceSuggestions).toHaveBeenLastCalledWith({
      id: 'space-suggest-modal',
      personId: 'space-person-1',
      page: 2,
      size: 50,
    });

    await modalProps.confirm('face-1');
    expect(sdkMock.confirmSpacePersonFaceSuggestion).toHaveBeenCalledWith({
      id: 'space-suggest-modal',
      personId: 'space-person-1',
      assetFaceId: 'face-1',
    });

    await modalProps.dismiss('face-2');
    expect(sdkMock.dismissSpacePersonFaceSuggestion).toHaveBeenCalledWith({
      id: 'space-suggest-modal',
      personId: 'space-person-1',
      assetFaceId: 'face-2',
    });

    await modalProps.ignore('face-3');
    expect(sdkMock.ignoreSpacePersonFaceSuggestion).toHaveBeenCalledWith({
      id: 'space-suggest-modal',
      personId: 'space-person-1',
      assetFaceId: 'face-3',
    });

    expect(sdkMock.confirmPersonFaceSuggestion).not.toHaveBeenCalled();

    closeModal({ confirmed: 0 });

    await waitFor(() => {
      expect(sdkMock.getSpacePersonFaceSuggestions).toHaveBeenLastCalledWith({
        id: 'space-suggest-modal',
        personId: 'space-person-1',
        page: 1,
        size: 5,
      });
    });
  });

  it('opens the review modal with personal SDK actions including ignore', async () => {
    let closeModal!: (value: { confirmed: number }) => void;
    sdkMock.getPersonFaceSuggestions
      .mockResolvedValueOnce({ total: 1, items: [makeSuggestion({ assetFaceId: 'face-1' })] })
      .mockResolvedValueOnce({ total: 0, items: [] });
    vi.mocked(modalManager.show).mockReturnValue(
      new Promise((resolve) => {
        closeModal = resolve;
      }) as never,
    );

    renderPage({ person: makePerson({ name: 'Alice' }) });

    await userEvent.click(await screen.findByTestId('suggestion-review-btn'));

    const modalProps = vi.mocked(modalManager.show).mock.calls[0][1] as unknown as {
      loadPage: (request: { page: number; size: number }) => Promise<PersonFaceSuggestionPageResponseDto>;
      confirm: (assetFaceId: string) => Promise<void>;
      dismiss: (assetFaceId: string) => Promise<void>;
      ignore: (assetFaceId: string) => Promise<void>;
    };

    await modalProps.loadPage({ page: 2, size: 50 });
    expect(sdkMock.getPersonFaceSuggestions).toHaveBeenLastCalledWith({
      id: 'person-1',
      page: 2,
      size: 50,
    });

    await modalProps.confirm('face-1');
    expect(sdkMock.confirmPersonFaceSuggestion).toHaveBeenCalledWith({ id: 'person-1', assetFaceId: 'face-1' });

    await modalProps.dismiss('face-2');
    expect(sdkMock.dismissPersonFaceSuggestion).toHaveBeenCalledWith({ id: 'person-1', assetFaceId: 'face-2' });

    await modalProps.ignore('face-3');
    expect(sdkMock.ignorePersonFaceSuggestion).toHaveBeenCalledWith({ id: 'person-1', assetFaceId: 'face-3' });

    closeModal({ confirmed: 0 });

    await waitFor(() => {
      expect(sdkMock.getPersonFaceSuggestions).toHaveBeenLastCalledWith({ id: 'person-1', page: 1, size: 5 });
    });
  });

  it('keeps modal actions scoped to the person the review was opened for after route navigation', async () => {
    let closeModal!: (value: { confirmed: number }) => void;
    sdkMock.getPersonFaceSuggestions
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
    const view = renderPage({ person: makePerson({ name: 'Alice' }) });

    await userEvent.click(await screen.findByTestId('suggestion-review-btn'));

    const modalProps = vi.mocked(modalManager.show).mock.calls[0][1] as unknown as {
      loadPage: (request: { page: number; size: number }) => Promise<PersonFaceSuggestionPageResponseDto>;
      confirm: (assetFaceId: string) => Promise<void>;
      dismiss: (assetFaceId: string) => Promise<void>;
      ignore: (assetFaceId: string) => Promise<void>;
    };

    await view.rerender({
      component: PersonDetailPage,
      componentProps: {
        data: {
          person: secondPerson,
          statistics: { assets: 5, faces: 6 },
          meta: { title: 'Bob' },
        },
      },
    });

    await waitFor(() => {
      expect(sdkMock.getPersonFaceSuggestions).toHaveBeenLastCalledWith({ id: 'person-2', page: 1, size: 5 });
    });

    await modalProps.loadPage({ page: 2, size: 50 });
    await modalProps.confirm('face-1');
    await modalProps.dismiss('face-2');
    await modalProps.ignore('face-3');

    expect(sdkMock.getPersonFaceSuggestions).toHaveBeenLastCalledWith({
      id: 'person-1',
      page: 2,
      size: 50,
    });
    expect(sdkMock.confirmPersonFaceSuggestion).toHaveBeenCalledWith({ id: 'person-1', assetFaceId: 'face-1' });
    expect(sdkMock.dismissPersonFaceSuggestion).toHaveBeenCalledWith({ id: 'person-1', assetFaceId: 'face-2' });
    expect(sdkMock.ignorePersonFaceSuggestion).toHaveBeenCalledWith({ id: 'person-1', assetFaceId: 'face-3' });

    closeModal({ confirmed: 0 });

    await waitFor(() => {
      expect(sdkMock.getPersonFaceSuggestions).toHaveBeenLastCalledWith({ id: 'person-1', page: 1, size: 5 });
    });
  });

  // S12.11/F32a: cross-route snooze consistency (pin). The space route's snoozeId is `person.id` (its own
  // SharedSpacePersonResponseDto id — see space-person-detail-page.spec.ts); this route's snoozeId for the
  // identical space-primary profile is `getSuggestionTarget(person).personId`. Rendering both routes' pages in
  // one spec file isn't practical (each pulls in a distinct set of top-level `vi.mock()`s), so this drives the
  // REAL, unmocked face-suggestion-snooze module directly for the "other route" half of each assertion —
  // exactly the calls that route's own banner would make with the same id.
  //
  // Pin, not a fresh red/green: the server always sets `person.id === primaryProfile.id` for a space-primary
  // identity (FaceIdentityRepository.mapAccessiblePerson), so with realistic fixtures this passes even against
  // the pre-fix code that derived the key from `person.id` directly — the two values coincide here regardless.
  // What this guards is the WIRING: that `snoozeId` is actually threaded from `getSuggestionTarget(person)`,
  // not a value that merely happens to match. Confirmed by mutating `snoozeId` to a wrong constant and back
  // (see the slice-12 report's Pin evidence) — this test goes red under that mutation and green again on revert.
  describe('cross-route snooze consistency (F32a)', () => {
    const PROFILE_ID = 'space-person-1';
    const spacePrimaryPerson = () =>
      makePerson({
        id: PROFILE_ID,
        name: 'Alice',
        primaryProfile: { type: Type.SpacePerson, id: PROFILE_ID, spaceId: 'space-snooze-consistency' },
      });

    beforeEach(() => {
      localStorage.clear();
    });

    it('a snooze recorded by the space route (keyed on the raw profile id) suppresses this route’s banner', async () => {
      sdkMock.getSpacePersonFaceSuggestions.mockResolvedValue({
        total: 3,
        items: [makeSuggestion()],
      });
      // The snooze module keys on the authenticated user (both `user` AND `preferences` — see
      // AuthManager#authenticated), so the (real, unmocked) session has to be established before recording it,
      // exactly as it would be by the time the space route runs.
      authManager.setUser(userAdminFactory.build({ id: 'current-user-id' }));
      authManager.setPreferences(preferencesFactory.build());
      // What clicking "Not now" on /spaces/… would do: it passes snoozeId={person.id}, the space-person's own
      // (raw) id — identical to PROFILE_ID here.
      snoozeSuggestions(PROFILE_ID, 3);

      renderPage({ person: spacePrimaryPerson() });

      await waitFor(() => expect(sdkMock.getSpacePersonFaceSuggestions).toHaveBeenCalled());
      expect(screen.queryByTestId('person-suggestion-banner')).not.toBeInTheDocument();
    });

    it('a snooze recorded on this route reads back as snoozed under the raw profile id the space route uses', async () => {
      sdkMock.getSpacePersonFaceSuggestions.mockResolvedValue({
        total: 3,
        items: [makeSuggestion()],
      });

      renderPage({ person: spacePrimaryPerson() });
      await screen.findByTestId('person-suggestion-banner');
      await userEvent.click(screen.getByTestId('suggestion-snooze-btn'));
      expect(screen.queryByTestId('person-suggestion-banner')).not.toBeInTheDocument();

      // What the space route's banner would check for the same profile: isSuggestionSnoozed(person.id, total).
      expect(isSuggestionSnoozed(PROFILE_ID, 3)).toBe(true);
    });
  });
});

// Gallery-fork: family relationships, slice 8. `GET /family/people/{personId}/relations` has no
// generated SDK function yet (see `family-relations.ts`), so the wiring calls raw `fetch` — these
// tests stub `global.fetch` directly rather than `sdkMock`.
describe('family relations panel wiring', () => {
  let fetchMock: Mock;

  beforeEach(() => {
    vi.resetAllMocks();
    gotoMock.mockResolvedValue(undefined);
    invalidateAllMock.mockResolvedValue(undefined);
    mockAssetMultiSelectManager.selectionActive = false;
    mockAssetMultiSelectManager.assets = [];
    sdkMock.getPerson.mockResolvedValue(makePerson());
    sdkMock.getPersonFaceSuggestions.mockResolvedValue({ total: 0, items: [] });
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // E55 — pets are never part of the family graph; the wiring must not even ask.
  it('never requests family relations for a pet, and renders no panel', async () => {
    renderPage({ person: makePerson({ type: 'pet', name: 'Mochi' }) });

    await screen.findByTestId('timeline-stub');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.queryByTestId('family-relations-panel')).not.toBeInTheDocument();
  });

  // A12, paired with the positive control below on an otherwise identical render.
  it('renders no family relations panel when the relations request is refused', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 403, json: () => Promise.resolve({}) });
    renderPage();

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/family/people/person-1/relations'),
        expect.anything(),
      ),
    );
    expect(screen.queryByTestId('family-relations-panel')).not.toBeInTheDocument();
  });

  it('renders the family relations panel when the relations request succeeds', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          relations: [{ person: makePerson({ id: 'anton', name: 'Anton' }), anonymousSlot: null, relation: 'parent' }],
        }),
    });
    renderPage();

    expect(await screen.findByTestId('family-relations-panel')).toBeInTheDocument();
    expect(screen.getByText('Anton')).toBeInTheDocument();
  });
});
