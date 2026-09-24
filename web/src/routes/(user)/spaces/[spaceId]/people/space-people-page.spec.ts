import {
  RepresentativeFaceSource,
  SharedSpaceRole,
  type SharedSpaceMemberResponseDto,
  type SharedSpacePeopleStatisticsResponseDto,
  type SharedSpacePersonResponseDto,
  type SharedSpaceResponseDto,
} from '@immich/sdk';
import { modalManager } from '@immich/ui';
import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import type { Component } from 'svelte';
import { getAnimateMock } from '$lib/__mocks__/animate.mock';
import { getIntersectionObserverMock } from '$lib/__mocks__/intersection-observer.mock';
import { sdkMock } from '$lib/__mocks__/sdk.mock';
import TestWrapper from '$lib/components/TestWrapper.svelte';
import { clearPeopleFaceStatisticsInfoCache } from '$lib/components/people/people-face-statistics-info-cache';
import { authManager } from '$lib/managers/auth-manager.svelte';
import { PeopleSortBy, peopleViewSettings } from '$lib/stores/preferences.store';
import { preferencesFactory } from '@test-data/factories/preferences-factory';
import { userAdminFactory } from '@test-data/factories/user-factory';
import SpacePeoplePage from './+page.svelte';

const { gotoMock, pageStore, featureFlagsMock } = vi.hoisted(() => {
  let pageValue = {
    url: new URL('http://localhost/spaces/space-1/people'),
    route: { id: '/(user)/spaces/[spaceId]/people' },
  };

  return {
    gotoMock: vi.fn(),
    pageStore: {
      setUrl: (url: string) => {
        pageValue = { ...pageValue, url: new URL(url) };
      },
      subscribe: (run: (value: typeof pageValue) => void) => {
        run(pageValue);
        return () => {};
      },
    },
    featureFlagsMock: { value: { peopleStatistics: true } },
  };
});

vi.mock('$app/navigation', () => ({ goto: gotoMock }));
vi.mock('$app/stores', () => ({ page: pageStore }));
vi.mock('$lib/managers/feature-flags-manager.svelte', () => ({
  featureFlagsManager: featureFlagsMock,
}));

vi.mock('@immich/ui', async (importOriginal) => {
  const original = await importOriginal<typeof import('@immich/ui')>();
  return {
    ...original,
    modalManager: { show: vi.fn(), showDialog: vi.fn() },
    toastManager: { primary: vi.fn(), success: vi.fn(), warning: vi.fn() },
  };
});

function makeSpacePerson(overrides: Partial<SharedSpacePersonResponseDto> = {}): SharedSpacePersonResponseDto {
  return {
    id: 'space-person-1',
    spaceId: 'space-1',
    name: 'Alice',
    thumbnailPath: '',
    isHidden: false,
    birthDate: null,
    representativeFaceId: null,
    representativeFaceSource: RepresentativeFaceSource.Auto,
    faceCount: 1,
    assetCount: 4,
    alias: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
    type: 'person',
    ...overrides,
  };
}

function renderPage(people: SharedSpacePersonResponseDto[], peopleStatistics?: SharedSpacePeopleStatisticsResponseDto) {
  peopleStatistics ??= {
    total: people.length,
    hidden: people.filter((person) => person.isHidden).length,
    detectedFaceCount: 0,
  };

  const space: SharedSpaceResponseDto = {
    id: 'space-1',
    name: 'Test Space',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ownerId: 'owner-user-id',
    createdById: 'owner-user-id',
    description: '',
    slug: null,
    isPublic: false,
    publicSlug: null,
    allowDownload: true,
    showMetadata: true,
    showExif: true,
    password: null,
    expiresAt: null,
    assets: [],
    albumId: null,
    assetCount: people.length,
    faceRecognitionEnabled: true,
    petsEnabled: true,
  } as SharedSpaceResponseDto;
  const members: SharedSpaceMemberResponseDto[] = [
    {
      userId: 'current-user-id',
      email: 'user@example.com',
      name: 'Current User',
      role: SharedSpaceRole.Editor,
      showInTimeline: false,
      sharePersonMetadata: true,
      joinedAt: '2026-01-01T00:00:00.000Z',
    },
  ];

  const props = {
    data: {
      space,
      members,
      people,
      peopleStatistics,
      meta: { title: 'Test Space - People' },
    },
  };

  // The page no longer renders UserPageLayout (which provided the Tooltip context); the shell layout
  // does. TestWrapper supplies the TooltipProvider the people grid's menus rely on.
  return render(TestWrapper as Component<{ component: typeof SpacePeoplePage; componentProps: typeof props }>, {
    component: SpacePeoplePage,
    componentProps: props,
  });
}

describe('Space people page', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    peopleViewSettings.set({ sortBy: PeopleSortBy.PhotoCount });
    clearPeopleFaceStatisticsInfoCache();
    authManager.setUser(userAdminFactory.build({ id: 'current-user-id' }));
    authManager.setPreferences(preferencesFactory.build());
    Element.prototype.animate = getAnimateMock();
    vi.stubGlobal('IntersectionObserver', getIntersectionObserverMock());
    pageStore.setUrl('http://localhost/spaces/space-1/people');
    gotoMock.mockResolvedValue(undefined);
    featureFlagsMock.value.peopleStatistics = true;
  });

  it('renders people by photo count by default, named before unnamed', () => {
    renderPage([
      makeSpacePerson({ id: 'space-person-unnamed-low', name: '', assetCount: 1 }),
      makeSpacePerson({ id: 'space-person-zoe', name: 'Zoe', assetCount: 99 }),
      makeSpacePerson({ id: 'space-person-unnamed-high', name: '', assetCount: 20 }),
      makeSpacePerson({ id: 'space-person-alice', name: 'Alice', assetCount: 1 }),
    ]);

    expect(screen.getAllByPlaceholderText('add_a_name').map((input) => (input as HTMLInputElement).value)).toEqual([
      'Zoe',
      'Alice',
      '',
      '',
    ]);
    expect(
      [...document.querySelectorAll<HTMLAnchorElement>('a[href^="/spaces/space-1/people/"]')].map((link) => {
        const url = new URL(link.href);
        return url.pathname;
      }),
    ).toEqual([
      '/spaces/space-1/people/space-person-zoe',
      '/spaces/space-1/people/space-person-alice',
      '/spaces/space-1/people/space-person-unnamed-high',
      '/spaces/space-1/people/space-person-unnamed-low',
    ]);
  });

  it('orders people alphabetically when the people sort preference is Name', () => {
    peopleViewSettings.set({ sortBy: PeopleSortBy.Name });
    renderPage([
      makeSpacePerson({ id: 'space-person-zoe', name: 'Zoe', assetCount: 99 }),
      makeSpacePerson({ id: 'space-person-alice', name: 'Alice', assetCount: 1 }),
    ]);

    expect(screen.getAllByPlaceholderText('add_a_name').map((input) => (input as HTMLInputElement).value)).toEqual([
      'Alice',
      'Zoe',
    ]);
  });

  it('loads person thumbnails without the deferred queue used by visibility management', () => {
    class NeverIntersectingObserver {
      observe = vi.fn();
      disconnect = vi.fn();
      unobserve = vi.fn();
    }
    vi.stubGlobal('IntersectionObserver', NeverIntersectingObserver);

    renderPage([makeSpacePerson({ id: 'space-person-alice', name: 'Alice' })]);

    expect(screen.getByTitle('Alice').getAttribute('src')).toContain(
      '/shared-spaces/space-1/people/space-person-alice/thumbnail?updatedAt=2026-01-02T00%3A00%3A00.000Z',
    );
  });

  it('moves a newly named person into alphabetical order', async () => {
    const bob = makeSpacePerson({ id: 'space-person-bob', name: 'Bob' });
    const unnamed = makeSpacePerson({ id: 'space-person-unnamed', name: '' });
    const renamed = makeSpacePerson({ id: 'space-person-unnamed', name: 'Aaron' });
    sdkMock.updateSpacePerson.mockResolvedValue(renamed);
    sdkMock.getSpacePeople.mockResolvedValue([renamed, bob]);

    renderPage([bob, unnamed]);

    const user = userEvent.setup();
    const inputs = screen.getAllByPlaceholderText('add_a_name');
    expect(inputs).toHaveLength(2);
    expect(inputs[0]).toHaveValue('Bob');
    expect(inputs[1]).toHaveValue('');

    await user.click(inputs[1]);
    await user.type(inputs[1], 'Aaron');
    await fireEvent.focusOut(inputs[1]);

    await waitFor(() => {
      expect(sdkMock.updateSpacePerson).toHaveBeenCalledWith({
        id: 'space-1',
        personId: 'space-person-unnamed',
        sharedSpacePersonUpdateDto: { name: 'Aaron' },
      });
    });
    // Name lookups (suggestions, the same-name check) are expected; a full-list refresh is not.
    for (const [query] of sdkMock.getSpacePeople.mock.calls) {
      expect(query).toHaveProperty('name');
    }

    const updatedInputs = screen.getAllByPlaceholderText('add_a_name');
    expect(updatedInputs[0]).toHaveValue('Aaron');
    expect(updatedInputs[1]).toHaveValue('Bob');
  });

  // #1099: the tile's "Add a name" field had no suggestions, so an existing identity was only
  // reachable by typing its exact name.
  it('suggests existing space people while typing a name and merges into the one picked', async () => {
    const norgy = makeSpacePerson({ id: 'space-person-norgy', name: 'Norgy' });
    const unnamed = makeSpacePerson({ id: 'space-person-unnamed', name: '' });
    sdkMock.getSpacePeople.mockResolvedValue([norgy]);
    sdkMock.mergeSpacePeople.mockResolvedValue(undefined as never);
    vi.mocked(modalManager.showDialog).mockResolvedValue(true);
    renderPage([norgy, unnamed]);

    const user = userEvent.setup();
    const input = screen.getAllByPlaceholderText('add_a_name')[1];
    await user.click(input);
    await user.type(input, 'Norg');

    const option = await screen.findByRole('option', { name: 'Norgy' });
    expect(option.querySelector('img')).toHaveAttribute(
      'src',
      expect.stringContaining('/shared-spaces/space-1/people/space-person-norgy/thumbnail'),
    );
    expect(sdkMock.getSpacePeople).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'space-1', name: 'Norg', named: true }),
    );

    await user.click(option);

    await waitFor(() =>
      expect(sdkMock.mergeSpacePeople).toHaveBeenCalledWith({
        id: 'space-1',
        personId: 'space-person-norgy',
        sharedSpacePersonMergeDto: { ids: ['space-person-unnamed'] },
      }),
    );
    expect(sdkMock.updateSpacePerson).not.toHaveBeenCalled();
  });

  it('picks a suggestion with the keyboard', async () => {
    const norgy = makeSpacePerson({ id: 'space-person-norgy', name: 'Norgy' });
    const unnamed = makeSpacePerson({ id: 'space-person-unnamed', name: '' });
    sdkMock.getSpacePeople.mockResolvedValue([norgy]);
    sdkMock.mergeSpacePeople.mockResolvedValue(undefined as never);
    vi.mocked(modalManager.showDialog).mockResolvedValue(true);
    renderPage([norgy, unnamed]);

    const user = userEvent.setup();
    const input = screen.getAllByPlaceholderText('add_a_name')[1];
    await user.click(input);
    await user.type(input, 'Norg');
    await screen.findByRole('option', { name: 'Norgy' });
    await user.keyboard('{ArrowDown}{Enter}');

    await waitFor(() =>
      expect(sdkMock.mergeSpacePeople).toHaveBeenCalledWith(
        expect.objectContaining({ personId: 'space-person-norgy' }),
      ),
    );
    expect(sdkMock.updateSpacePerson).not.toHaveBeenCalled();
  });

  it('leaves the name unchanged when the merge for a picked suggestion is declined', async () => {
    const norgy = makeSpacePerson({ id: 'space-person-norgy', name: 'Norgy' });
    const unnamed = makeSpacePerson({ id: 'space-person-unnamed', name: '' });
    sdkMock.getSpacePeople.mockResolvedValue([norgy]);
    vi.mocked(modalManager.showDialog).mockResolvedValue(false);
    renderPage([norgy, unnamed]);

    const user = userEvent.setup();
    const input = screen.getAllByPlaceholderText('add_a_name')[1];
    await user.click(input);
    await user.type(input, 'Norg');
    await user.click(await screen.findByRole('option', { name: 'Norgy' }));

    await waitFor(() => expect(modalManager.showDialog).toHaveBeenCalled());
    expect(sdkMock.mergeSpacePeople).not.toHaveBeenCalled();
    expect(sdkMock.updateSpacePerson).not.toHaveBeenCalled();
    expect(screen.getAllByPlaceholderText('add_a_name')[1]).toHaveValue('');
  });

  // #1100: typing an existing name exactly, without picking it, renamed straight through.
  it('offers to merge when the typed name already belongs to another space person', async () => {
    const norgy = makeSpacePerson({ id: 'space-person-norgy', name: 'Norgy' });
    const unnamed = makeSpacePerson({ id: 'space-person-unnamed', name: '' });
    sdkMock.getSpacePeople.mockResolvedValue([norgy]);
    sdkMock.mergeSpacePeople.mockResolvedValue(undefined as never);
    vi.mocked(modalManager.showDialog).mockResolvedValue(true);
    renderPage([norgy, unnamed]);

    const user = userEvent.setup();
    const input = screen.getAllByPlaceholderText('add_a_name')[1];
    await user.click(input);
    await user.type(input, 'NORGY');
    await fireEvent.focusOut(input);

    await waitFor(() =>
      expect(sdkMock.mergeSpacePeople).toHaveBeenCalledWith({
        id: 'space-1',
        personId: 'space-person-norgy',
        sharedSpacePersonMergeDto: { ids: ['space-person-unnamed'] },
      }),
    );
    expect(sdkMock.updateSpacePerson).not.toHaveBeenCalled();
  });
});
