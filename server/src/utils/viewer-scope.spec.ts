import { AuthDto } from 'src/dtos/auth.dto.js';
import { AssetVisibility } from 'src/enum.js';
import { TimelineHiddenScope } from 'src/utils/shared-space-album-scope.js';
import { ViewerScope, ViewerScopeRequest, ViewerSurface, resolveViewerScope } from 'src/utils/viewer-scope.js';
import { AuthFactory } from 'test/factories/auth.factory.js';
import { newUuid } from 'test/small.factory.js';

const spaceId = newUuid();
// #763: every space the viewer belongs to, including ones hidden from their timeline.
const memberSpaceId = newUuid();
const personId = newUuid();
const scopedToken = `space-person:${newUuid()}`;
const nothingHidden: TimelineHiddenScope = {
  hiddenSpaceIds: [],
  hiddenAlbumIds: [],
  hiddenAlbumSpacePairs: [],
  hiddenLibraryIds: [],
};
const somethingHidden: TimelineHiddenScope = { ...nothingHidden, hiddenSpaceIds: [newUuid()] };
const resolution = {
  identityIds: ['identity'],
  legacyPersonIds: ['legacy-person'],
  legacySpacePersonIds: ['legacy-space-person'],
  hasInaccessibleToken: false,
};

type Row = {
  name: string;
  surface: ViewerSurface;
  request: ViewerScopeRequest;
  elevated?: boolean;
  hidden?: TimelineHiddenScope;
  noSpaces?: boolean;
  /** Whether the viewer's timeline spaces are looked up at all. */
  queriesSpaces: boolean;
  /** #763: whether every space the viewer belongs to is looked up. */
  queriesMemberSpaces?: boolean;
  /** The `scope` handed to resolveScopedPersonTokens, or undefined when it must not be called. */
  people?: { withSharedSpaces: boolean; timelineSpaceIds?: string[]; spaceId?: string };
  expected: ViewerScope;
};

const userId = 'viewer';
const resolved = {
  personIds: resolution.legacyPersonIds,
  identityIds: resolution.identityIds,
  spacePersonIds: resolution.legacySpacePersonIds,
  forceEmptyResult: false,
};

const rows: Row[] = [
  // timeline: the personal-timeline rule and the merge switch are independent (E12).
  {
    name: 'timeline: personal browse merging spaces',
    surface: 'timeline',
    request: { userId, withSharedSpaces: true },
    queriesSpaces: true,
    expected: { timelineSpaceIds: [spaceId], hiddenScope: nothingHidden },
  },
  {
    name: 'timeline: personal browse with something hidden keeps the rescue spaces without merging them',
    surface: 'timeline',
    request: { userId },
    hidden: somethingHidden,
    queriesSpaces: true,
    expected: { hiddenScope: somethingHidden, visibleSpaceIds: [spaceId] },
  },
  ...[
    { isTrashed: true },
    { isFavorite: true },
    { isFavorite: false },
    { visibility: AssetVisibility.Archive },
    { visibility: AssetVisibility.Hidden },
    { visibility: AssetVisibility.Locked },
  ].map((filter): Row => ({
    name: `timeline: ${JSON.stringify(filter)} is not a personal timeline, so nothing is subtracted`,
    surface: 'timeline',
    request: { userId, ...filter },
    hidden: somethingHidden,
    queriesSpaces: false,
    expected: {},
  })),
  {
    name: 'timeline: a favourites browse merging spaces spans every member space (#763)',
    surface: 'timeline',
    request: { userId, withSharedSpaces: true, isFavorite: true },
    queriesSpaces: false,
    queriesMemberSpaces: true,
    expected: { timelineSpaceIds: [memberSpaceId] },
  },
  {
    name: 'timeline: a favourites browse resolves space-person tokens against every member space (#763)',
    surface: 'timeline',
    request: { userId, withSharedSpaces: true, isFavorite: true, personIds: [scopedToken] },
    queriesSpaces: false,
    queriesMemberSpaces: true,
    people: { withSharedSpaces: true, timelineSpaceIds: [memberSpaceId] },
    expected: { timelineSpaceIds: [memberSpaceId], ...resolved },
  },
  {
    name: 'timeline: an album browse states its own scope (no spaces, no subtraction)',
    surface: 'timeline',
    request: { albumId: newUuid(), withSharedSpaces: true },
    hidden: somethingHidden,
    queriesSpaces: false,
    people: undefined,
    expected: {},
  },
  {
    name: 'timeline: bare person id under withSharedSpaces resolves as the viewer’s own person',
    surface: 'timeline',
    request: { userId, withSharedSpaces: true, personIds: [personId] },
    queriesSpaces: true,
    people: { withSharedSpaces: true, timelineSpaceIds: [spaceId] },
    expected: { timelineSpaceIds: [spaceId], hiddenScope: nothingHidden, ...resolved },
  },
  {
    name: 'timeline: bare person id without shared spaces passes through untouched',
    surface: 'timeline',
    request: { userId, personIds: [personId] },
    queriesSpaces: false,
    expected: { hiddenScope: nothingHidden, personIds: [personId] },
  },
  {
    name: 'timeline: a space-person token in a space browse resolves against that space',
    surface: 'timeline',
    request: { spaceId, personIds: [scopedToken], spacePersonIds: ['legacy-space-person', 'other'] },
    queriesSpaces: false,
    people: { withSharedSpaces: false, spaceId },
    expected: { ...resolved, spacePersonIds: ['legacy-space-person', 'other'] },
  },

  // search: an album scope counts as shared; the not-locked default lives here only.
  {
    name: 'search: withSharedSpaces widens and defaults to not-locked',
    surface: 'search',
    request: { withSharedSpaces: true },
    queriesSpaces: true,
    expected: { timelineSpaceIds: [spaceId], visibility: 'not-locked' },
  },
  {
    name: 'search: an elevated session has no visibility default',
    surface: 'search',
    request: {},
    elevated: true,
    queriesSpaces: false,
    expected: { visibility: undefined },
  },
  {
    name: 'search: an explicit visibility wins',
    surface: 'search',
    request: { visibility: AssetVisibility.Archive },
    queriesSpaces: false,
    expected: { visibility: AssetVisibility.Archive },
  },
  {
    name: 'search: albumIds widen and resolve bare person ids as shared',
    surface: 'search',
    request: { albumIds: [newUuid()], personIds: [personId] },
    queriesSpaces: true,
    people: { withSharedSpaces: true, timelineSpaceIds: [spaceId] },
    expected: { timelineSpaceIds: [spaceId], visibility: 'not-locked', ...resolved },
  },
  {
    name: 'search: a suggestion albumId widens too',
    surface: 'search',
    request: { albumId: newUuid() },
    queriesSpaces: true,
    expected: { timelineSpaceIds: [spaceId], visibility: 'not-locked' },
  },
  {
    name: 'search: a viewer with no timeline spaces stays owner-only',
    surface: 'search',
    request: { withSharedSpaces: true },
    noSpaces: true,
    queriesSpaces: true,
    expected: { visibility: 'not-locked' },
  },

  // search (#763): a favourite-filtered query spans every member space only when the call site opts in.
  {
    name: 'search: favoriteScoped widens to every member space',
    surface: 'search',
    request: { withSharedSpaces: true, isFavorite: true, favoriteScoped: true },
    queriesSpaces: false,
    queriesMemberSpaces: true,
    expected: { timelineSpaceIds: [memberSpaceId], visibility: 'not-locked' },
  },
  {
    name: 'search: isFavorite alone keeps the timeline spaces (suggestions do not opt in)',
    surface: 'search',
    request: { withSharedSpaces: true, isFavorite: true },
    queriesSpaces: true,
    expected: { timelineSpaceIds: [spaceId], visibility: 'not-locked' },
  },
  {
    name: 'search: withFavoriteSpaces adds the member spaces for the favourites facet only',
    surface: 'search',
    request: { withSharedSpaces: true, withFavoriteSpaces: true },
    queriesSpaces: true,
    queriesMemberSpaces: true,
    expected: { timelineSpaceIds: [spaceId], favoriteSpaceIds: [memberSpaceId], visibility: 'not-locked' },
  },
  {
    name: 'search: favoriteScoped and withFavoriteSpaces share one member lookup',
    surface: 'search',
    request: { withSharedSpaces: true, favoriteScoped: true, withFavoriteSpaces: true },
    queriesSpaces: false,
    queriesMemberSpaces: true,
    expected: { timelineSpaceIds: [memberSpaceId], favoriteSpaceIds: [memberSpaceId], visibility: 'not-locked' },
  },
  {
    name: 'search: withFavoriteSpaces under an album scope adds nothing',
    surface: 'search',
    request: { albumId: spaceId, withFavoriteSpaces: true },
    queriesSpaces: true,
    expected: { timelineSpaceIds: [spaceId], visibility: 'not-locked' },
  },

  // map (#763): favourites are a per-viewer overlay, so a favourites query widens like any other.
  {
    name: 'map: shared albums widen',
    surface: 'map',
    request: { withSharedAlbums: true },
    queriesSpaces: true,
    expected: { timelineSpaceIds: [spaceId] },
  },
  {
    name: 'map: withSharedSpaces widens',
    surface: 'map',
    request: { withSharedSpaces: true },
    queriesSpaces: true,
    expected: { timelineSpaceIds: [spaceId] },
  },
  {
    name: 'map: neither switch, no lookup',
    surface: 'map',
    request: {},
    queriesSpaces: false,
    expected: {},
  },
  {
    name: 'map: a favourites query widens like any other (#763)',
    surface: 'map',
    request: { withSharedSpaces: true, isFavorite: true },
    queriesSpaces: true,
    expected: { timelineSpaceIds: [spaceId] },
  },

  // filtered-map: widening and person tokens are separate consumers (00a7fd6bac).
  {
    name: 'filtered-map: withSharedSpaces widens',
    surface: 'filtered-map',
    request: { withSharedSpaces: true },
    queriesSpaces: true,
    expected: { timelineSpaceIds: [spaceId] },
  },
  {
    name: 'filtered-map: a favourites query widens and its space-person tokens see the spaces (#763)',
    surface: 'filtered-map',
    request: { withSharedSpaces: true, isFavorite: true, personIds: [scopedToken] },
    queriesSpaces: true,
    people: { withSharedSpaces: true, timelineSpaceIds: [spaceId] },
    expected: { timelineSpaceIds: [spaceId], ...resolved },
  },
  {
    name: 'filtered-map: bare person ids on an unwidened query need no space lookup',
    surface: 'filtered-map',
    request: { albumId: newUuid(), personIds: [personId] },
    queriesSpaces: false,
    expected: { personIds: [personId] },
  },
  {
    name: 'filtered-map: an album query’s space-person tokens see the spaces (00a7fd6bac)',
    surface: 'filtered-map',
    request: { albumId: newUuid(), withSharedSpaces: true, personIds: [scopedToken] },
    queriesSpaces: true,
    people: { withSharedSpaces: true, timelineSpaceIds: [spaceId] },
    expected: { timelineSpaceIds: [spaceId], ...resolved },
  },
  {
    name: 'filtered-map: a space scope is never widened',
    surface: 'filtered-map',
    request: { spaceId, withSharedSpaces: true, spacePersonIds: ['space-person'] },
    queriesSpaces: false,
    expected: { spacePersonIds: ['space-person'] },
  },

  // memories / folders: always subtract, always with the visible spaces.
  {
    name: 'memories: hidden scope and visible spaces even when nothing is hidden',
    surface: 'memories',
    request: {},
    queriesSpaces: true,
    expected: { hiddenScope: nothingHidden, visibleSpaceIds: [spaceId] },
  },
  {
    name: 'folders: a viewer with no visible spaces gets an empty list, not undefined',
    surface: 'folders',
    request: {},
    noSpaces: true,
    hidden: somethingHidden,
    queriesSpaces: true,
    expected: { hiddenScope: somethingHidden, visibleSpaceIds: [] },
  },
];

const setup = ({ hidden = nothingHidden, noSpaces = false } = {}) => {
  const sharedSpaceRepository = {
    getSpaceIdsForTimeline: vi.fn().mockResolvedValue(noSpaces ? [] : [{ spaceId }]),
    getTimelineHiddenScope: vi.fn().mockResolvedValue(hidden),
    getAllMemberSpaceIds: vi.fn().mockResolvedValue([{ spaceId: memberSpaceId }]),
  };
  const faceIdentityRepository = { resolveScopedPersonTokens: vi.fn().mockResolvedValue(resolution) };
  const repos = { sharedSpaceRepository, faceIdentityRepository } as unknown as Parameters<
    typeof resolveViewerScope
  >[0];
  return { repos, sharedSpaceRepository, faceIdentityRepository };
};

const authFor = (elevated = false): AuthDto => {
  const auth = AuthFactory.from().session({ hasElevatedPermission: elevated }).build();
  auth.user.id = userId;
  return auth;
};

describe('resolveViewerScope', () => {
  it.each(rows)(
    '$name',
    async ({ surface, request, elevated, hidden, noSpaces, queriesSpaces, queriesMemberSpaces, people, expected }) => {
      const { repos, sharedSpaceRepository, faceIdentityRepository } = setup({ hidden, noSpaces });

      const scope = await resolveViewerScope(repos, authFor(elevated), surface, request);

      expect(scope).toEqual(expected);
      expect(sharedSpaceRepository.getSpaceIdsForTimeline).toHaveBeenCalledTimes(queriesSpaces ? 1 : 0);
      expect(sharedSpaceRepository.getAllMemberSpaceIds).toHaveBeenCalledTimes(queriesMemberSpaces ? 1 : 0);
      if (people) {
        expect(faceIdentityRepository.resolveScopedPersonTokens).toHaveBeenCalledWith({
          userId,
          tokens: request.personIds,
          scope: people,
        });
      } else {
        expect(faceIdentityRepository.resolveScopedPersonTokens).not.toHaveBeenCalled();
      }
    },
  );

  // The map drift: the global filtered map used to resolve person tokens only when one was scoped, so
  // a bare person id passed through as a legacy id while timeline and search resolved it to the
  // person's identity — map pins diverged from the grid for a person with a merged identity.
  it.each(['timeline', 'search', 'filtered-map'] as const)(
    '%s resolves a bare person id under withSharedSpaces to the viewer’s own person',
    async (surface) => {
      const { repos, faceIdentityRepository } = setup();

      const scope = await resolveViewerScope(repos, authFor(), surface, {
        userId,
        withSharedSpaces: true,
        personIds: [personId],
      });

      expect(faceIdentityRepository.resolveScopedPersonTokens).toHaveBeenCalledWith(
        expect.objectContaining({ tokens: [personId], scope: expect.objectContaining({ withSharedSpaces: true }) }),
      );
      expect(scope).toMatchObject({ identityIds: ['identity'], personIds: ['legacy-person'] });
    },
  );

  it('forces an empty result when a token is inaccessible', async () => {
    const { repos, faceIdentityRepository } = setup();
    faceIdentityRepository.resolveScopedPersonTokens.mockResolvedValue({ ...resolution, hasInaccessibleToken: true });

    const scope = await resolveViewerScope(repos, authFor(), 'search', { personIds: [scopedToken] });

    expect(scope.forceEmptyResult).toBe(true);
  });

  // The other half of the map drift fix: a bare id under withSharedSpaces is looked up among the
  // viewer's OWN people, so one that is not theirs is inaccessible and empties the map, as it already
  // did on timeline and search. It used to pass through as a legacy id and could pin other members'
  // assets carrying that face through the widened space arm.
  it('filtered-map empties the result for a bare id under withSharedSpaces that is not the viewer’s person', async () => {
    const { repos, faceIdentityRepository } = setup();
    faceIdentityRepository.resolveScopedPersonTokens.mockResolvedValue({
      identityIds: [],
      legacyPersonIds: [],
      legacySpacePersonIds: [],
      hasInaccessibleToken: true,
    });

    const scope = await resolveViewerScope(repos, authFor(), 'filtered-map', {
      withSharedSpaces: true,
      personIds: [personId],
    });

    expect(faceIdentityRepository.resolveScopedPersonTokens).toHaveBeenCalledWith(
      expect.objectContaining({ tokens: [personId], scope: expect.objectContaining({ withSharedSpaces: true }) }),
    );
    expect(scope).toMatchObject({ personIds: [], forceEmptyResult: true });
  });

  it('re-resolves inside the caller’s transaction', async () => {
    const { repos, sharedSpaceRepository } = setup();
    const trx = {} as never;

    await resolveViewerScope(repos, authFor(), 'timeline', { userId, withSharedSpaces: true }, trx);

    expect(sharedSpaceRepository.getSpaceIdsForTimeline).toHaveBeenCalledWith(userId, trx);
    expect(sharedSpaceRepository.getTimelineHiddenScope).toHaveBeenCalledWith(userId, trx);
  });

  it('re-resolves the member spaces inside the caller’s transaction too (#763)', async () => {
    const { repos, sharedSpaceRepository } = setup();
    const trx = {} as never;

    await resolveViewerScope(repos, authFor(), 'timeline', { userId, withSharedSpaces: true, isFavorite: true }, trx);

    expect(sharedSpaceRepository.getAllMemberSpaceIds).toHaveBeenCalledWith(userId, trx);
  });
});
