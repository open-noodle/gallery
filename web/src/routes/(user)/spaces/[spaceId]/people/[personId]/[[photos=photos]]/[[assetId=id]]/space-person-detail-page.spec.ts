import TestWrapper from '#lib/components/TestWrapper.svelte';
import { sdkMock } from '#lib/gallery/__mocks__/sdk.mock.ts';
import { authManager } from '#lib/managers/auth-manager.svelte.ts';
import { factory } from '#test/unit/factories.ts';
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
import { modalManager, toastManager } from '@immich/ui';
import type { Component } from 'svelte';
import { addMessages } from 'svelte-i18n';
import { expect } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page, userEvent } from 'vitest/browser';
import { fireEvent } from '../../../../../fire-event.test-helpers';
import { load } from './+page';
import SpacePersonDetailPage from './+page.svelte';

const { gotoMock, invalidateAllMock, authenticateMock, featureFlagsMock, mockAssetMultiSelectManager } = vi.hoisted(
  () => {
    return {
      gotoMock: vi.fn(),
      invalidateAllMock: vi.fn(),
      authenticateMock: vi.fn(),
      featureFlagsMock: { value: { peopleStatistics: true } },
      mockAssetMultiSelectManager: {
        selectionActive: false,
        assets: [] as { id: string }[],
        clear: vi.fn(),
        isAllUserOwned: true,
        isAllFavorite: false,
        isAllArchived: false,
        // Mirrors the real manager's derived field; these fixtures only model the
        // all-owned and none-owned ends of the range.
        get ownedAssets() {
          // eslint-disable-next-line unicorn/no-this-outside-of-class
          return this.isAllUserOwned ? this.assets : [];
        },
      },
    };
  },
);

vi.mock('$app/navigation', async () => ({
  ...(await import('#test/unit/mocks/app-navigation.ts')),
  goto: gotoMock,
  invalidateAll: invalidateAllMock,
}));
vi.mock('#lib/utils/auth.js', () => ({ authenticate: authenticateMock }));
vi.mock('#lib/managers/feature-flags-manager.svelte.js', () => ({
  featureFlagsManager: featureFlagsMock,
}));
vi.mock('#lib/managers/asset-multi-select-manager.svelte.js', () => ({
  assetMultiSelectManager: mockAssetMultiSelectManager,
}));

vi.mock('@immich/ui', async (importOriginal) => {
  const original = await importOriginal<typeof import('@immich/ui')>();
  const { default: MockContextMenuButton } = await import('#lib/gallery/__mocks__/action-context-menu.stub.svelte');
  return {
    ...original,
    ContextMenuButton: MockContextMenuButton,
    modalManager: { show: vi.fn(), showDialog: vi.fn() },
    toastManager: { primary: vi.fn(), success: vi.fn(), danger: vi.fn() },
  };
});

vi.mock('#lib/components/timeline/Timeline.svelte', async () => {
  const { default: MockComponent } = await import('./mock-space-person-timeline.test-wrapper.svelte');
  return { default: MockComponent };
});

vi.mock('#lib/components/assets/thumbnail/ImageThumbnail.svelte', async () => {
  const { default: MockComponent } = await import('#lib/gallery/__mocks__/noop-component.svelte');
  return { default: MockComponent };
});

vi.mock('#lib/components/people/people-merge-selector.svelte', async () => {
  const { default: MockComponent } = await import('#lib/gallery/__mocks__/space-people-merge-selector.stub.svelte');
  return { default: MockComponent };
});

vi.mock('#lib/modals/RepresentativeFacePickerModal.svelte', async () => {
  const { default: MockComponent } = await import('#lib/gallery/__mocks__/noop-component.svelte');
  return { default: MockComponent };
});

// eslint-disable-next-line unicorn/no-unnecessary-parameters
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
  const currentUser = factory.user({ id: 'current-user-id' });
  authManager.setUser(currentUser);
  authManager.setPreferences(factory.preferences());

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

// The test locale renders bare keys; give the two count strings the header shows their real English
// ICU text so the assertions read the counts the page passes, not the key.
beforeAll(() => {
  addMessages('dev', {
    assets_count: '{count, plural, one {# asset} other {# assets}}',
    faces_count: '{count, plural, one {# face} other {# faces}}',
  });
});

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
    await renderPage({ previousRoute: '/people' });

    await userEvent.click(page.getByLabelText('Close'));

    expect(gotoMock).toHaveBeenCalledWith('/people');
  });

  it('uses the shared timeline surface for space person photos', async () => {
    await renderPage();

    await expect.element(page.getByTestId('space-person-timeline')).toHaveAttribute('data-enable-routing', 'true');
    await expect.element(page.getByTestId('space-person-timeline')).toHaveAttribute('data-space-id', 'space-1');
    expect(JSON.parse(page.getByTestId('timeline-options').element().textContent ?? '{}')).toEqual(
      expect.objectContaining({
        spaceId: 'space-1',
        spacePersonId: 'person-1',
        withStacked: true,
        grouping: 'day',
      }),
    );
    await expect.element(page.getByTestId('person-asset-asset-1')).not.toBeInTheDocument();
  });

  // #889 — the asset viewer opened from this timeline gates add-to-album on the space capability.
  it('passes the space capability into the timeline for an editor', async () => {
    await renderPage();

    await expect
      .element(page.getByTestId('space-person-timeline'))
      .toHaveAttribute('data-space', JSON.stringify({ id: 'space-1', canWrite: true }));
  });

  it('passes the space capability into the timeline as read-only for a viewer', async () => {
    await renderPage({ members: [makeMember({ role: SharedSpaceRole.Viewer })] });

    await expect
      .element(page.getByTestId('space-person-timeline'))
      .toHaveAttribute('data-space', JSON.stringify({ id: 'space-1', canWrite: false }));
  });

  it('renders space person timeline grouping controls and passes mobile grouping props', async () => {
    await renderPage();

    await expect.element(page.getByTestId('timeline-desktop-grouping-control')).toBeInTheDocument();
    await expect.element(page.getByTestId('timeline-grouping-day')).toHaveAttribute('aria-pressed', 'true');
    await expect
      .element(page.getByTestId('timeline-mobile-grouping-props'))
      .toHaveTextContent(JSON.stringify({ grouping: 'day', hasHandler: true }));
  });

  it('keeps the grouping control outside the scrolling timeline so it stays visible while scrolling', async () => {
    const { container } = await renderPage();

    const main = container.querySelector<HTMLElement>('main');
    const timeline = page.getByTestId('space-person-timeline').element() as HTMLElement;
    await expect.element(page.getByTestId('person-timeline-header')).toBeInTheDocument();
    const header = page.getByTestId('person-timeline-header').element() as HTMLElement;
    await expect.element(page.getByTestId('timeline-desktop-grouping-control')).toBeInTheDocument();
    const control = page.getByTestId('timeline-desktop-grouping-control').element() as HTMLElement;

    // Regression guard for Hagen's report: the switcher must not scroll away with the photo
    // grid, so it must live outside the timeline scroll container and the person header
    // (both of which scroll) — pinned in the sticky page chrome instead, exactly like Tags.
    expect(timeline).not.toContainElement(control);
    expect(header).not.toContainElement(control);
    expect(main).toContainElement(control);
  });

  it('changes space person timeline grouping while preserving scope without temporal chips', async () => {
    await renderPage();

    await userEvent.click(page.getByTestId('timeline-grouping-year'));

    await expect.element(page.getByTestId('timeline-options')).toMatchTextContent('"grouping":"year"');
    await expect.element(page.getByTestId('timeline-options')).toMatchTextContent('"spaceId":"space-1"');
    await expect.element(page.getByTestId('timeline-options')).toMatchTextContent('"spacePersonId":"person-1"');
    await expect.element(page.getByTestId('timeline-options')).toMatchTextContent('"withStacked":true');
    await expect.element(page.getByTestId('active-filters-bar')).not.toBeInTheDocument();
    await expect.element(page.getByTestId('timeline-anchor')).toHaveTextContent('null');
  });

  it('activating space person year and month buckets preserves scope without temporal chips', async () => {
    await renderPage();

    await userEvent.click(page.getByTestId('activate-year-bucket'));
    await expect.element(page.getByTestId('timeline-options')).toMatchTextContent('"grouping":"month"');
    await expect.element(page.getByTestId('timeline-options')).toMatchTextContent('"spaceId":"space-1"');
    await expect.element(page.getByTestId('timeline-options')).toMatchTextContent('"spacePersonId":"person-1"');
    await expect.element(page.getByTestId('timeline-options')).toMatchTextContent('"withStacked":true');
    await expect.element(page.getByTestId('timeline-options')).not.toMatchTextContent('"takenAfter"');
    await expect.element(page.getByTestId('timeline-options')).not.toMatchTextContent('"takenBefore"');
    await expect.element(page.getByTestId('active-filters-bar')).not.toBeInTheDocument();
    await expect.element(page.getByTestId('timeline-anchor')).toHaveTextContent('{"year":2015}');

    await userEvent.click(page.getByTestId('activate-month-bucket'));
    await expect.element(page.getByTestId('timeline-options')).toMatchTextContent('"grouping":"day"');
    await expect.element(page.getByTestId('timeline-options')).toMatchTextContent('"spaceId":"space-1"');
    await expect.element(page.getByTestId('timeline-options')).toMatchTextContent('"spacePersonId":"person-1"');
    await expect.element(page.getByTestId('timeline-options')).toMatchTextContent('"withStacked":true');
    await expect.element(page.getByTestId('timeline-options')).not.toMatchTextContent('"takenAfter"');
    await expect.element(page.getByTestId('timeline-options')).not.toMatchTextContent('"takenBefore"');
    await expect.element(page.getByTestId('active-filters-bar')).not.toBeInTheDocument();
    await expect.element(page.getByTestId('timeline-anchor')).toHaveTextContent('{"year":2015,"month":8}');
  });

  it('space person bucket activation keeps scope without rendering ActiveFiltersBar', async () => {
    await renderPage();

    await userEvent.click(page.getByTestId('activate-year-bucket'));

    await expect.element(page.getByTestId('timeline-options')).toMatchTextContent('"grouping":"month"');
    await expect.element(page.getByTestId('timeline-options')).toMatchTextContent('"spaceId":"space-1"');
    await expect.element(page.getByTestId('timeline-options')).toMatchTextContent('"spacePersonId":"person-1"');
    await expect.element(page.getByTestId('timeline-options')).toMatchTextContent('"withStacked":true');
    await expect.element(page.getByTestId('active-filters-bar')).not.toBeInTheDocument();
    await expect.element(page.getByTestId('timeline-anchor')).toHaveTextContent('{"year":2015}');
  });

  it('selection mode hides timeline grouping controls on the space person page', async () => {
    mockAssetMultiSelectManager.selectionActive = true;

    await renderPage();

    await expect.element(page.getByTestId('timeline-desktop-grouping-control')).not.toBeInTheDocument();
  });

  it('ignores space person bucket activation while selection mode is active', async () => {
    mockAssetMultiSelectManager.selectionActive = true;

    await renderPage();
    await userEvent.click(page.getByTestId('activate-year-bucket'));

    await expect.element(page.getByTestId('timeline-options')).toMatchTextContent('"grouping":"day"');
    await expect.element(page.getByTestId('timeline-anchor')).toHaveTextContent('null');
    await expect.element(page.getByTestId('active-filters-bar')).not.toBeInTheDocument();
  });

  it('renders space-scoped asset and face counts in the person header', async () => {
    await renderPage({
      person: makePerson({ assetCount: 999, faceCount: 999 }),
      statistics: { assets: 5, faces: 10 },
    });

    await expect.element(page.getByText('5 assets')).toBeInTheDocument();
    await expect.element(page.getByText('10 faces')).toBeInTheDocument();
    await expect.element(page.getByText('999 assets')).not.toBeInTheDocument();
  });

  it('hides the face count line when the peopleStatistics feature flag is disabled', async () => {
    featureFlagsMock.value.peopleStatistics = false;
    await renderPage({
      person: makePerson({ assetCount: 999, faceCount: 999 }),
      statistics: { assets: 5, faces: 10 },
    });

    await expect.element(page.getByText('5 assets')).toBeInTheDocument();
    await expect.element(page.getByText('10 faces')).not.toBeInTheDocument();
  });

  it('updates the displayed space-scoped asset count after removing selected assets', async () => {
    mockAssetMultiSelectManager.selectionActive = true;
    mockAssetMultiSelectManager.assets = [{ id: 'asset-1' }, { id: 'asset-2' }] as never[];
    vi.mocked(modalManager.showDialog as (...args: unknown[]) => Promise<boolean>).mockResolvedValue(true);
    // The server returns exactly the ids it removed (direct members); both selected assets are direct here.
    sdkMock.removeAssets.mockResolvedValue(['asset-1', 'asset-2']);

    await renderPage({ statistics: { assets: 5, faces: 10 } });

    await userEvent.click(page.getByLabelText('remove_from_space'));

    await vi.waitFor(() => {
      expect(sdkMock.removeAssets).toHaveBeenCalledWith({
        id: 'space-1',
        sharedSpaceAssetRemoveDto: { assetIds: ['asset-1', 'asset-2'] },
      });
    });
    await expect.element(page.getByText('3 assets')).toBeInTheDocument();
    await expect.element(page.getByText('10 faces')).toBeInTheDocument();
    expect(invalidateAllMock).toHaveBeenCalled();
  });

  it('does not expose person actions to viewers', async () => {
    await renderPage({ members: [makeMember({ role: SharedSpaceRole.Viewer })] });

    await expect.element(page.getByLabelText('show_person_options')).not.toBeInTheDocument();
    await expect.element(page.getByText('set_date_of_birth')).not.toBeInTheDocument();
    await expect.element(page.getByText('merge_people')).not.toBeInTheDocument();
    await expect.element(page.getByText('separate_from_grouped_person')).not.toBeInTheDocument();
  });

  it('opens the representative face picker for editors', async () => {
    await renderPage({ person: makePerson({ representativeFaceSource: RepresentativeFaceSource.Auto }) });

    await userEvent.click(page.getByText('select_representative_face'));

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

  it('does not show the representative face picker action for viewers', async () => {
    await renderPage({ members: [makeMember({ role: SharedSpaceRole.Viewer })] });

    await expect.element(page.getByText('select_representative_face')).not.toBeInTheDocument();
  });

  it('passes a reset callback for manual space representative face overrides', async () => {
    await renderPage({ person: makePerson({ representativeFaceSource: RepresentativeFaceSource.Manual }) });

    await userEvent.click(page.getByText('select_representative_face'));

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
    await renderPage({ person });

    await userEvent.click(page.getByText('select_representative_face'));
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

  it('ignores a forced merge action for viewers', async () => {
    await renderPage({ members: [makeMember({ role: SharedSpaceRole.Viewer })], action: 'merge' });

    await expect.element(page.getByTestId('people-merge-selector')).not.toBeInTheDocument();
  });

  it('opens the shared merge flow for editors', async () => {
    await renderPage({ action: 'merge' });

    await expect.element(page.getByTestId('people-merge-selector')).toHaveAttribute('data-person-id', 'person-1');
  });

  it('uses same-person repair for a space person merged with a personal candidate', async () => {
    await renderPage({ action: 'merge' });

    await userEvent.click(page.getByTestId('merge-personal-candidate'));

    expect(sdkMock.mergeScopedPeople).toHaveBeenCalledWith({
      mergeScopedPeopleDto: {
        target: { type: 'space-person', id: 'person-1', spaceId: 'space-1' },
        sources: [{ type: 'person', id: 'person-candidate' }],
      },
    });
    expect(sdkMock.mergeSpacePeople).not.toHaveBeenCalled();
  });

  it('merges a genuine same-space candidate through the direct in-space endpoint', async () => {
    sdkMock.mergeSpacePeople.mockResolvedValue(undefined as never);
    await renderPage({ action: 'merge' });

    await userEvent.click(page.getByTestId('merge-same-space-candidate'));

    await vi.waitFor(() => {
      expect(sdkMock.mergeSpacePeople).toHaveBeenCalledWith({
        id: 'space-1',
        personId: 'person-1',
        sharedSpacePersonMergeDto: { ids: ['same-space-candidate'] },
      });
    });
    expect(sdkMock.mergeScopedPeople).not.toHaveBeenCalled();
  });

  it('shows the descriptive message and does not merge a same-space merge blocked across owners', async () => {
    sdkMock.isHttpError.mockImplementation((error) => !!(error as { __http?: boolean })?.__http);
    sdkMock.mergeSpacePeople.mockRejectedValueOnce({
      __http: true,
      status: 403,
      data: { code: 'cross_owner_merge_blocked', message: 'An administrator can enable it.' },
      message: 'raw',
    });
    await renderPage({ action: 'merge' });

    await userEvent.click(page.getByTestId('merge-same-space-candidate'));

    await vi.waitFor(() => expect(toastManager.danger).toHaveBeenCalled());
    expect(sdkMock.mergeSpacePeople).toHaveBeenCalledTimes(1);
    expect(gotoMock).not.toHaveBeenCalled();
  });

  it('re-runs a same-space merge with the cross-owner acknowledgement once the user confirms', async () => {
    sdkMock.isHttpError.mockImplementation((error) => !!(error as { __http?: boolean })?.__http);
    sdkMock.mergeSpacePeople
      .mockRejectedValueOnce({
        __http: true,
        status: 409,
        data: { code: 'cross_owner_merge_confirmation_required', impactedOwnerCount: 1 },
        message: 'raw',
      })
      .mockResolvedValueOnce(undefined as never);
    vi.mocked(modalManager.showDialog as (...args: unknown[]) => Promise<boolean>).mockResolvedValue(true);
    await renderPage({ action: 'merge' });

    await userEvent.click(page.getByTestId('merge-same-space-candidate'));

    await vi.waitFor(() => expect(sdkMock.mergeSpacePeople).toHaveBeenCalledTimes(2));
    expect(sdkMock.mergeSpacePeople).toHaveBeenNthCalledWith(1, {
      id: 'space-1',
      personId: 'person-1',
      sharedSpacePersonMergeDto: { ids: ['same-space-candidate'] },
    });
    expect(sdkMock.mergeSpacePeople).toHaveBeenNthCalledWith(2, {
      id: 'space-1',
      personId: 'person-1',
      sharedSpacePersonMergeDto: { ids: ['same-space-candidate'], confirmCrossOwner: true },
    });
  });

  it('searches merge candidates with shared spaces enabled', async () => {
    await renderPage({ action: 'merge' });

    await userEvent.click(page.getByTestId('search-merge-candidates'));

    expect(sdkMock.searchPerson).toHaveBeenCalledWith({ name: 'Alice', withHidden: true, withSharedSpaces: true });
  });

  it('edits the space person name from the detail header', async () => {
    const person = makePerson({ name: '' });
    sdkMock.updateSpacePerson.mockResolvedValue({ ...person, name: 'Alice' });
    sdkMock.getSpacePeople.mockResolvedValue([]);
    await renderPage({ person });

    await userEvent.click(page.getByText('add_a_name'));
    const input = page.getByPlaceholder('add_a_name').element() as HTMLElement;
    await userEvent.type(input, 'Alice');
    await userEvent.keyboard('{Enter}');

    await vi.waitFor(() =>
      expect(sdkMock.updateSpacePerson).toHaveBeenCalledWith({
        id: 'space-1',
        personId: 'person-1',
        sharedSpacePersonUpdateDto: { name: 'Alice' },
      }),
    );
    await expect.element(page.getByText('Alice')).toBeInTheDocument();
    expect(modalManager.showDialog).not.toHaveBeenCalled();
  });

  // #1100: typing a name the space already has, without picking it from the dropdown, used to rename
  // straight through and leave two people with the same name.
  it('offers to merge into the space person that already has the typed name', async () => {
    const person = makePerson({ id: 'person-1', name: '' });
    const existingPerson = makePerson({ id: 'person-2', name: 'Norgy' });
    sdkMock.getSpacePeople.mockResolvedValue([existingPerson]);
    sdkMock.mergeSpacePeople.mockResolvedValue(undefined as never);
    vi.mocked(modalManager.showDialog as (...args: unknown[]) => Promise<boolean>).mockResolvedValue(true);
    await renderPage({ person });

    await userEvent.click(page.getByText('add_a_name'));
    await userEvent.type(page.getByPlaceholder('add_a_name'), 'norgy');
    await userEvent.keyboard('{Enter}');

    await vi.waitFor(() =>
      expect(sdkMock.mergeSpacePeople).toHaveBeenCalledWith({
        id: 'space-1',
        personId: 'person-2',
        sharedSpacePersonMergeDto: { ids: ['person-1'] },
      }),
    );
    expect(sdkMock.updateSpacePerson).not.toHaveBeenCalled();
    expect(gotoMock).toHaveBeenCalledWith(expect.stringContaining('/spaces/space-1/people/person-2'), {
      replaceState: true,
    });
  });

  it('renames anyway when the merge into the same-named space person is declined', async () => {
    const person = makePerson({ id: 'person-1', name: '' });
    sdkMock.getSpacePeople.mockResolvedValue([makePerson({ id: 'person-2', name: 'Norgy' })]);
    sdkMock.updateSpacePerson.mockResolvedValue({ ...person, name: 'Norgy' });
    vi.mocked(modalManager.showDialog as (...args: unknown[]) => Promise<boolean>).mockResolvedValue(false);
    await renderPage({ person });

    await userEvent.click(page.getByText('add_a_name'));
    await userEvent.type(page.getByPlaceholder('add_a_name'), 'Norgy');
    await userEvent.keyboard('{Enter}');

    await vi.waitFor(() =>
      expect(sdkMock.updateSpacePerson).toHaveBeenCalledWith({
        id: 'space-1',
        personId: 'person-1',
        sharedSpacePersonUpdateDto: { name: 'Norgy' },
      }),
    );
    expect(sdkMock.mergeSpacePeople).not.toHaveBeenCalled();
  });

  // The user asked for the merge; renaming after the server refused it would create the duplicate.
  it('does not rename when the merge into the same-named space person is blocked', async () => {
    sdkMock.isHttpError.mockImplementation((error) => !!(error as { __http?: boolean })?.__http);
    const person = makePerson({ id: 'person-1', name: '' });
    sdkMock.getSpacePeople.mockResolvedValue([makePerson({ id: 'person-2', name: 'Norgy' })]);
    sdkMock.mergeSpacePeople.mockRejectedValueOnce({
      __http: true,
      status: 403,
      data: { code: 'cross_owner_merge_blocked', message: 'An administrator can enable it.' },
      message: 'raw',
    });
    vi.mocked(modalManager.showDialog as (...args: unknown[]) => Promise<boolean>).mockResolvedValue(true);
    await renderPage({ person });

    await userEvent.click(page.getByText('add_a_name'));
    await userEvent.type(page.getByPlaceholder('add_a_name'), 'norgy');
    await userEvent.keyboard('{Enter}');

    await vi.waitFor(() => expect(toastManager.danger).toHaveBeenCalled());
    // The fallback rename, if any, runs after the toast; let it land before asserting it did not.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(sdkMock.mergeSpacePeople).toHaveBeenCalledTimes(1);
    expect(sdkMock.updateSpacePerson).not.toHaveBeenCalled();
    expect(gotoMock).not.toHaveBeenCalled();
  });

  it('shows matching named space people while editing an unnamed person', async () => {
    const person = makePerson({ id: 'person-1', name: '' });
    const existingPerson = makePerson({ id: 'person-2', name: 'Alice Existing' });
    sdkMock.getSpacePeople.mockResolvedValue([existingPerson]);
    await renderPage({ person });

    await userEvent.click(page.getByText('add_a_name'));
    await userEvent.type(page.getByPlaceholder('add_a_name'), 'Ali');

    await vi.waitFor(() => {
      expect(sdkMock.getSpacePeople).toHaveBeenCalledWith(
        { id: 'space-1', name: 'Ali', named: true, limit: 5 },
        expect.any(Object),
      );
    });
    await expect.element(page.getByRole('button', { name: 'Alice Existing' })).toBeInTheDocument();
  });

  it('updates birthdate from the detail page and reopens with the saved value', async () => {
    const person = makePerson({ birthDate: null });
    sdkMock.updateSpacePerson.mockResolvedValue({ ...person, birthDate: null });
    await renderPage({ person });

    await userEvent.click(page.getByText('set_date_of_birth'));
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

    await userEvent.click(page.getByText('set_date_of_birth'));
    const reopenedModalProps = vi.mocked(modalManager.show).mock.calls[1][1] as unknown as {
      birthDate: string | null;
    };
    expect(reopenedModalProps.birthDate).toBe('1990-06-15');
  });

  it('hides a space person from the detail page action menu', async () => {
    const person = makePerson({ isHidden: false });
    sdkMock.updateSpacePerson.mockResolvedValue({ ...person, isHidden: true });
    await renderPage({ person });

    await userEvent.click(page.getByText('hide_person'));

    expect(sdkMock.updateSpacePerson).toHaveBeenCalledWith({
      id: 'space-1',
      personId: 'person-1',
      sharedSpacePersonUpdateDto: { isHidden: true },
    });
    expect(gotoMock).toHaveBeenCalledWith('/spaces/space-1/people');
  });

  it('detaches a space person for owner or editor members after confirmation', async () => {
    vi.mocked(modalManager.showDialog as (...args: unknown[]) => Promise<boolean>).mockResolvedValue(true);
    await renderPage();

    await userEvent.click(page.getByText('separate_from_grouped_person'));

    expect(sdkMock.detachScopedPerson).toHaveBeenCalledWith({
      detachScopedPersonDto: { profile: { type: 'space-person', id: 'person-1', spaceId: 'space-1' } },
    });
    expect(invalidateAllMock).toHaveBeenCalled();
  });

  it('navigates to the surviving person after an autosuggest merge without reloading the deleted route', async () => {
    const person = makePerson({ id: 'person-1', name: '' });
    const existingPerson = makePerson({ id: 'person-2', name: 'Alice Existing' });
    sdkMock.getSpacePeople.mockResolvedValue([existingPerson]);
    vi.mocked(modalManager.showDialog as (...args: unknown[]) => Promise<boolean>).mockResolvedValue(true);
    await renderPage({ person });

    await userEvent.click(page.getByText('add_a_name'));
    await userEvent.type(page.getByPlaceholder('add_a_name'), 'Ali');
    await userEvent.click(page.getByRole('button', { name: 'Alice Existing' }));

    await vi.waitFor(() => {
      expect(sdkMock.mergeSpacePeople).toHaveBeenCalledWith({
        id: 'space-1',
        personId: 'person-2',
        sharedSpacePersonMergeDto: { ids: ['person-1'] },
      });
    });
    expect(gotoMock).toHaveBeenCalledWith('/spaces/space-1/people/person-2', { replaceState: true });
    expect(invalidateAllMock).not.toHaveBeenCalled();
  });

  it('shows the descriptive message and stays put when an autosuggest merge is blocked across owners', async () => {
    sdkMock.isHttpError.mockImplementation((error) => !!(error as { __http?: boolean })?.__http);
    const person = makePerson({ id: 'person-1', name: '' });
    const existingPerson = makePerson({ id: 'person-2', name: 'Alice Existing' });
    sdkMock.getSpacePeople.mockResolvedValue([existingPerson]);
    vi.mocked(modalManager.showDialog as (...args: unknown[]) => Promise<boolean>).mockResolvedValue(true);
    sdkMock.mergeSpacePeople.mockRejectedValueOnce({
      __http: true,
      status: 403,
      data: { code: 'cross_owner_merge_blocked', message: 'An administrator can enable it.' },
      message: 'raw',
    });
    await renderPage({ person });

    await userEvent.click(page.getByText('add_a_name'));
    await userEvent.type(page.getByPlaceholder('add_a_name'), 'Ali');
    await userEvent.click(page.getByRole('button', { name: 'Alice Existing' }));

    await vi.waitFor(() => expect(toastManager.danger).toHaveBeenCalled());
    expect(gotoMock).not.toHaveBeenCalledWith('/spaces/space-1/people/person-2', { replaceState: true });
  });

  it('never renames the person while confirming an autosuggest merge outside the name editor (#859)', async () => {
    sdkMock.isHttpError.mockImplementation((error) => !!(error as { __http?: boolean })?.__http);
    const person = makePerson({ id: 'person-1', name: '' });
    const existingPerson = makePerson({ id: 'person-2', name: 'Ange' });
    sdkMock.getSpacePeople.mockResolvedValue([existingPerson]);
    sdkMock.updateSpacePerson.mockResolvedValue({ ...person, name: 'Ange' });
    sdkMock.mergeSpacePeople.mockRejectedValueOnce({
      __http: true,
      status: 403,
      data: { code: 'cross_owner_merge_blocked', message: 'An administrator can enable it.' },
      message: 'raw',
    });
    // The merge prompt is portalled outside the person header, so the click that confirms it lands
    // outside the name editor — the same "click outside to save" gesture that commits a rename.
    let confirmMerge: (confirmed: boolean) => void = () => {};
    vi.mocked(modalManager.showDialog as (...args: unknown[]) => Promise<boolean>).mockReturnValue(
      new Promise<boolean>((resolve) => {
        confirmMerge = resolve;
      }),
    );
    await renderPage({ person });

    await userEvent.click(page.getByText('add_a_name'));
    await userEvent.type(page.getByPlaceholder('add_a_name'), 'Ange');
    await userEvent.click(page.getByRole('button', { name: 'Ange' }));
    fireEvent('mousedown', document.body);
    confirmMerge(true);

    await vi.waitFor(() => expect(toastManager.danger).toHaveBeenCalled());
    expect(sdkMock.updateSpacePerson).not.toHaveBeenCalled();
    expect(toastManager.success).not.toHaveBeenCalled();
  });

  it('never renames the person when the autosuggest merge prompt is dismissed outside the name editor (#859)', async () => {
    const person = makePerson({ id: 'person-1', name: '' });
    const existingPerson = makePerson({ id: 'person-2', name: 'Ange' });
    sdkMock.getSpacePeople.mockResolvedValue([existingPerson]);
    sdkMock.updateSpacePerson.mockResolvedValue({ ...person, name: 'Ange' });
    let dismissMerge: (confirmed: boolean) => void = () => {};
    vi.mocked(modalManager.showDialog as (...args: unknown[]) => Promise<boolean>).mockReturnValue(
      new Promise<boolean>((resolve) => {
        dismissMerge = resolve;
      }),
    );
    await renderPage({ person });

    await userEvent.click(page.getByText('add_a_name'));
    await userEvent.type(page.getByPlaceholder('add_a_name'), 'Ange');
    await userEvent.click(page.getByRole('button', { name: 'Ange' }));
    fireEvent('mousedown', document.body);
    dismissMerge(false);

    await vi.waitFor(() => expect(sdkMock.mergeSpacePeople).not.toHaveBeenCalled());
    expect(sdkMock.updateSpacePerson).not.toHaveBeenCalled();
  });

  it('re-runs an autosuggest merge with the cross-owner acknowledgement once the user confirms', async () => {
    sdkMock.isHttpError.mockImplementation((error) => !!(error as { __http?: boolean })?.__http);
    const person = makePerson({ id: 'person-1', name: '' });
    const existingPerson = makePerson({ id: 'person-2', name: 'Alice Existing' });
    sdkMock.getSpacePeople.mockResolvedValue([existingPerson]);
    vi.mocked(modalManager.showDialog as (...args: unknown[]) => Promise<boolean>).mockResolvedValue(true);
    sdkMock.mergeSpacePeople
      .mockRejectedValueOnce({
        __http: true,
        status: 409,
        data: { code: 'cross_owner_merge_confirmation_required', impactedOwnerCount: 1 },
        message: 'raw',
      })
      .mockResolvedValueOnce(undefined as never);
    await renderPage({ person });

    await userEvent.click(page.getByText('add_a_name'));
    await userEvent.type(page.getByPlaceholder('add_a_name'), 'Ali');
    await userEvent.click(page.getByRole('button', { name: 'Alice Existing' }));

    await vi.waitFor(() => expect(sdkMock.mergeSpacePeople).toHaveBeenCalledTimes(2));
    expect(sdkMock.mergeSpacePeople).toHaveBeenNthCalledWith(1, {
      id: 'space-1',
      personId: 'person-2',
      sharedSpacePersonMergeDto: { ids: ['person-1'] },
    });
    expect(sdkMock.mergeSpacePeople).toHaveBeenNthCalledWith(2, {
      id: 'space-1',
      personId: 'person-2',
      sharedSpacePersonMergeDto: { ids: ['person-1'], confirmCrossOwner: true },
    });
    expect(gotoMock).toHaveBeenCalledWith('/spaces/space-1/people/person-2', { replaceState: true });
  });

  it('navigates to the surviving target after a swapped merge instead of reloading the deleted route person', async () => {
    await renderPage({ action: 'merge' });

    await userEvent.click(page.getByTestId('merge-swapped-space-candidate'));

    await vi.waitFor(() => {
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

      await renderPage();

      await expect.element(page.getByTestId('person-suggestion-banner')).toBeInTheDocument();
      expect(sdkMock.getSpacePersonFaceSuggestions).toHaveBeenCalledWith({
        id: 'space-1',
        personId: 'person-1',
        page: 1,
        size: 5,
      });
      const src = page.getByTestId('suggestion-banner-reference').element().getAttribute('src') ?? '';
      expect(src).toContain('/shared-spaces/space-1/people/person-1/thumbnail');
      expect(src).not.toContain('/api/people/person-1/thumbnail');
    });

    it('relies on the server read-gate for viewers and hides when the API returns zero', async () => {
      sdkMock.getSpacePersonFaceSuggestions.mockResolvedValue({ total: 0, items: [] });

      await renderPage({ members: [makeMember({ role: SharedSpaceRole.Viewer })] });

      await vi.waitFor(() => {
        expect(sdkMock.getSpacePersonFaceSuggestions).toHaveBeenCalledWith({
          id: 'space-1',
          personId: 'person-1',
          page: 1,
          size: 5,
        });
      });
      await expect.element(page.getByTestId('person-suggestion-banner')).not.toBeInTheDocument();
      await expect.element(page.getByTestId('suggestion-review-btn')).not.toBeInTheDocument();
    });

    // S12.1: client-side defence in depth. The server already returns `{ total: 0 }` to viewers (covered
    // above), but that is enforced only by the read endpoint — a future relaxation of that read gate ("let
    // viewers see what is pending") must not silently expose the review action too. This test uses the SAME
    // non-zero suggestion data for both halves, differing only in role, so it cannot pass on `total: 0` alone
    // (the vacuous shape a previous slice removed).
    it('gates the banner on isEditor: a viewer with pending suggestions renders none, an editor with the same data does', async () => {
      const suggestions = { total: 3, items: [makeSuggestion()] };
      sdkMock.getSpacePersonFaceSuggestions.mockResolvedValue(suggestions);

      const viewerRender = await renderPage({ members: [makeMember({ role: SharedSpaceRole.Viewer })] });
      await vi.waitFor(() => expect(sdkMock.getSpacePersonFaceSuggestions).toHaveBeenCalled());
      await expect.element(page.getByTestId('person-suggestion-banner')).not.toBeInTheDocument();
      await viewerRender.unmount();

      await renderPage({ members: [makeMember({ role: SharedSpaceRole.Editor })] });
      await expect.element(page.getByTestId('person-suggestion-banner')).toBeInTheDocument();
    });

    it('hides the banner if the shared-space suggestion summary request fails', async () => {
      sdkMock.getSpacePersonFaceSuggestions.mockRejectedValue(new Error('not a member'));

      await renderPage();

      await vi.waitFor(() => {
        expect(sdkMock.getSpacePersonFaceSuggestions).toHaveBeenCalledWith({
          id: 'space-1',
          personId: 'person-1',
          page: 1,
          size: 5,
        });
      });
      await expect.element(page.getByTestId('person-suggestion-banner')).not.toBeInTheDocument();
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

      await renderPage();

      await userEvent.click(page.getByTestId('suggestion-review-btn'));

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

      await vi.waitFor(() => expect(invalidateAllMock).toHaveBeenCalled());
      await vi.waitFor(() => {
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
      const view = await renderPage();

      await userEvent.click(page.getByTestId('suggestion-review-btn'));

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

      await vi.waitFor(() => {
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

      await vi.waitFor(() => expect(invalidateAllMock).toHaveBeenCalled());
      await vi.waitFor(() => {
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

      const firstRender = await renderPage({ person: makePerson({ id: 'person-1', name: 'Alice' }) });
      await expect.element(page.getByTestId('person-suggestion-banner')).toBeInTheDocument();
      await userEvent.click(page.getByTestId('suggestion-snooze-btn'));
      await expect.element(page.getByTestId('person-suggestion-banner')).not.toBeInTheDocument();
      await firstRender.unmount();

      await renderPage({ person: makePerson({ id: 'person-2', name: 'Alice in another space cluster' }) });

      await expect.element(page.getByTestId('person-suggestion-banner')).toBeInTheDocument();
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

      const view = await renderPage({ person: firstPerson });

      await expect.element(page.getByTestId('person-suggestion-banner')).toBeInTheDocument();

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

      await vi.waitFor(() => {
        expect(sdkMock.getSpacePersonFaceSuggestions).toHaveBeenLastCalledWith({
          id: 'space-1',
          personId: 'person-2',
          page: 1,
          size: 5,
        });
      });
      await expect.element(page.getByTestId('person-suggestion-banner')).not.toBeInTheDocument();
    });
  });
});
