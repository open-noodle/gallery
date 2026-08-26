import {
  RepresentativeFaceSource,
  SharedSpaceRole,
  type SharedSpaceMemberResponseDto,
  type SharedSpacePeopleStatisticsResponseDto,
  type SharedSpacePersonResponseDto,
  type SharedSpaceResponseDto,
} from '@immich/sdk';
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

/** Mirrors the page's own PAGE_SIZE — a short first page never offers a second one. */
const PAGE_SIZE = 100;

/**
 * Renders the page with a full first page loaded (so the grid offers a next page) and hands back a
 * trigger that reports the infinite-scroll sentinel as intersecting, so pagination can be driven
 * deterministically. Mirrors the global people page's helper of the same name.
 */
function renderPaginatedPage(people: SharedSpacePersonResponseDto[]) {
  let intersectionCallback: IntersectionObserverCallback | undefined;
  let observedSentinel: Element | undefined;
  vi.stubGlobal(
    'IntersectionObserver',
    vi.fn(function (callback: IntersectionObserverCallback) {
      intersectionCallback = callback;
      return {
        observe: (element: Element) => (observedSentinel = element),
        disconnect: vi.fn(),
        unobserve: vi.fn(),
        takeRecords: vi.fn(),
      };
    }),
  );

  const rendered = renderPage(people);

  const intersect = async () => {
    await waitFor(() => expect(observedSentinel).toBeDefined());
    intersectionCallback?.(
      [{ target: observedSentinel, isIntersecting: true } as IntersectionObserverEntry],
      {} as IntersectionObserver,
    );
  };

  return { ...rendered, intersect };
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
    expect(sdkMock.getSpacePeople).not.toHaveBeenCalled();

    const updatedInputs = screen.getAllByPlaceholderText('add_a_name');
    expect(updatedInputs[0]).toHaveValue('Aaron');
    expect(updatedInputs[1]).toHaveValue('Bob');
  });

  // The space twin of the global people page's "server repeats a row across the page boundary"
  // case. OFFSET pagination is not a snapshot: `getSpacePeople` orders by hidden state, name and
  // asset count, and `recountPersons` runs on every face attach/detach — so an editor naming a
  // face in this very space between the two requests shifts the window and re-emits a row page 1
  // already returned. A repeated key throws `each_key_duplicate`, and the grid then stops
  // rendering for the rest of the session while scrolling keeps firing requests.
  it('renders each person once when the space read repeats a row across the page boundary', async () => {
    const firstPage = Array.from({ length: PAGE_SIZE }, (_, index) =>
      makeSpacePerson({
        id: `space-person-${index}`,
        name: `Person ${String(index).padStart(3, '0')}`,
        assetCount: PAGE_SIZE - index,
      }),
    );
    sdkMock.getSpacePeople.mockResolvedValue([
      firstPage.at(-1)!,
      makeSpacePerson({ id: 'space-person-new', name: 'Newcomer', assetCount: 1 }),
    ]);

    const { intersect } = renderPaginatedPage(firstPage);
    await intersect();

    await waitFor(() => expect(screen.getByDisplayValue('Newcomer')).toBeInTheDocument());
    expect(screen.getAllByPlaceholderText('add_a_name')).toHaveLength(PAGE_SIZE + 1);
  });

  // The visibility manager pages the same read into a second keyed grid of its own, so it carries
  // the same exposure as the page behind it — and it is the more likely of the two to be open while
  // someone else edits, since hiding people is what a space editor does after a naming session.
  it('renders each person once in the visibility manager when the read repeats a row', async () => {
    const firstPage = Array.from({ length: PAGE_SIZE }, (_, index) =>
      makeSpacePerson({
        id: `space-person-${index}`,
        name: `Person ${String(index).padStart(3, '0')}`,
        assetCount: PAGE_SIZE - index,
      }),
    );
    // Keyed off the request rather than call order: the page's own grid pages independently, so
    // which of the two lists asks first is not something this test should depend on.
    sdkMock.getSpacePeople.mockImplementation(({ withHidden, offset }) => {
      if (!withHidden) {
        return Promise.resolve([]);
      }
      return Promise.resolve(
        offset ? [firstPage.at(-1)!, makeSpacePerson({ id: 'space-person-new', name: 'Newcomer' })] : firstPage,
      );
    });

    const { intersect } = renderPaginatedPage(firstPage);
    await userEvent.click(screen.getByText('show_and_hide_people'));
    await waitFor(() => expect(screen.getByTestId('visibility-person-space-person-0')).toBeInTheDocument());

    await intersect();

    await waitFor(() => expect(screen.getByTestId('visibility-person-space-person-new')).toBeInTheDocument());
    expect(screen.getAllByTestId(/^visibility-person-/)).toHaveLength(PAGE_SIZE + 1);
  });
});
