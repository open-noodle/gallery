import type { AgentSession } from 'src/database';
import { AgentApprovalMode, AgentPermissionPreset, AgentProviderType, AgentSessionStatus } from 'src/enum';
import { AlbumRepository } from 'src/repositories/album.repository';
import { SearchRepository } from 'src/repositories/search.repository';
import { SharedSpaceRepository } from 'src/repositories/shared-space.repository';
import { AgentAssetSearchFilterResolverService } from 'src/services/agent-asset-search-filter-resolver.service';
import type { AgentDeclarativeAssetFilters } from 'src/types/agent-asset-source.types';
import type { AgentPermissionPlanSnapshot } from 'src/types/agent-session.types';
import { AuthFactory } from 'test/factories/auth.factory';
import { newUuid } from 'test/small.factory';
import { automock } from 'test/utils';

const now = new Date('2026-05-22T12:00:00.000Z');

const permissionPlanSnapshot: AgentPermissionPlanSnapshot = {
  read: { metadata: true, previews: false, originals: false },
  providerExposure: {
    metadata: true,
    previews: false,
    originals: false,
    allowOriginalsForExternalProviders: false,
  },
  assetScope: { owned: true, sharedSpaces: true, locked: false },
  writeScope: { createAlbum: true, addAssets: true, updateDetails: true, setCover: true },
  limits: {
    maxAssetsPerToolCall: 100,
    maxAssetsPerSession: 1000,
    maxPreviewsPerToolCall: 0,
    maxOriginalsPerToolCall: 0,
    expiresInMinutes: 60,
  },
};

const filterSuggestions = (
  overrides: Partial<{
    people: Array<{
      id: string;
      name: string;
      primaryProfile?: { type: 'user-person' | 'space-person'; id: string; spaceId?: string };
    }>;
    tags: Array<{ id: string; value: string }>;
    cameraMakes: string[];
  }>,
) =>
  ({
    countries: [],
    ratings: [],
    mediaTypes: [],
    hasUnnamedPeople: false,
    people: [],
    tags: [],
    cameraMakes: [],
    ...overrides,
  }) as Awaited<ReturnType<SearchRepository['getFilterSuggestions']>>;

const makeSession = (overrides: Partial<AgentSession> = {}): AgentSession => {
  const providerCredentialId = newUuid();
  return {
    id: newUuid(),
    userId: newUuid(),
    providerCredentialId,
    credentialSnapshot: {
      id: providerCredentialId,
      providerType: AgentProviderType.OpenAI,
      label: 'OpenAI',
      baseUrl: null,
      models: ['gpt-5.1'],
      defaultModel: 'gpt-5.1',
    },
    modelSnapshot: { providerCredentialId, model: 'gpt-5.1' },
    permissionPreset: AgentPermissionPreset.Careful,
    permissionPlanSnapshot,
    approvalMode: AgentApprovalMode.PlanOnly,
    runnerEndpoint: null,
    runnerSessionId: null,
    runnerCapabilitiesSnapshot: null,
    workflowState: null,
    status: AgentSessionStatus.Running,
    initialContextSnapshot: {},
    title: null,
    createdAt: now,
    updatedAt: now,
    endedAt: null,
    updateId: newUuid(),
    ...overrides,
  };
};

describe(AgentAssetSearchFilterResolverService.name, () => {
  let sut: AgentAssetSearchFilterResolverService;
  let searchRepository: ReturnType<typeof automock<SearchRepository>>;
  let albumRepository: ReturnType<typeof automock<AlbumRepository>>;
  let sharedSpaceRepository: ReturnType<typeof automock<SharedSpaceRepository>>;

  beforeEach(() => {
    searchRepository = automock(SearchRepository, { args: [{} as never] });
    albumRepository = automock(AlbumRepository, { args: [{} as never] });
    sharedSpaceRepository = automock(SharedSpaceRepository, { args: [{} as never] });
    sut = new AgentAssetSearchFilterResolverService(searchRepository, albumRepository, sharedSpaceRepository);
  });

  it('resolves existing resolver requests for people, tags, albums, and spaces', async () => {
    const auth = AuthFactory.create();
    const session = makeSession({ userId: auth.user.id });
    const personId = newUuid();
    const tagId = newUuid();
    const albumId = newUuid();
    const spaceId = newUuid();
    searchRepository.getFilterSuggestions.mockResolvedValue(
      filterSuggestions({
        people: [{ id: personId, name: 'Pierre' }],
        tags: [{ id: tagId, value: 'Travel' }],
        cameraMakes: [],
      }),
    );
    albumRepository.getAgentAlbums.mockResolvedValue([
      { id: albumId, albumName: 'South Africa', ownerId: auth.user.id },
    ] as never);
    sharedSpaceRepository.getAllByUserId.mockResolvedValue([{ id: spaceId, name: 'Family' }] as never);

    const result = await sut.resolveToolFilters(auth, session, {
      people: ['Pierre'],
      tags: ['Travel'],
      albums: ['South Africa'],
      spaces: ['Family'],
    });

    expect(result.resolvedFilters).toMatchObject({
      spacePersonIds: [personId],
      tagIds: [tagId],
      albumIds: [albumId],
      spaceId,
    });
    expect(result.results.map((item) => item.status)).toEqual(['matched', 'matched', 'matched', 'matched']);
  });

  it('denies existing resolver requests that require shared spaces when the preset disallows them', async () => {
    const auth = AuthFactory.create();
    const session = makeSession({
      userId: auth.user.id,
      permissionPlanSnapshot: {
        ...permissionPlanSnapshot,
        assetScope: { owned: true, sharedSpaces: false, locked: false },
      },
    });

    const reason = await sut.validateToolAccess(auth, session, { spaces: ['Family'] });

    expect(reason).toBe('Shared spaces are not accessible for this session');
    expect(sharedSpaceRepository.getAllByUserId).not.toHaveBeenCalled();
  });

  it('resolves declarative scalar filters and people/tags/albums with match any', async () => {
    const auth = AuthFactory.create();
    const session = makeSession({ userId: auth.user.id });
    const pierreId = newUuid();
    const aureliaId = newUuid();
    const tagId = newUuid();
    const albumId = newUuid();
    searchRepository.getFilterSuggestions.mockResolvedValue(
      filterSuggestions({
        people: [
          { id: pierreId, name: 'Pierre' },
          { id: aureliaId, name: 'Aurelia' },
        ],
        tags: [{ id: tagId, value: 'Travel' }],
        cameraMakes: [],
      }),
    );
    albumRepository.getAgentAlbums.mockResolvedValue([
      { id: albumId, albumName: 'South Africa', ownerId: auth.user.id },
    ] as never);

    const result = await sut.resolveDeclarativeFilters(auth, session, {
      takenAfter: '2026-01-01T00:00:00.000Z',
      takenBefore: '2026-02-01T00:00:00.000Z',
      country: 'South Africa',
      city: 'Cape Town',
      people: { match: 'any', names: ['Pierre', 'Aurelia'] },
      tags: { match: 'any', names: ['Travel'] },
      albums: { match: 'any', names: ['South Africa'] },
      rating: 5,
      isFavorite: true,
    });

    expect(result.status).toBe('success');
    expect(result.filters).toMatchObject({
      takenAfter: new Date('2026-01-01T00:00:00.000Z'),
      takenBefore: new Date('2026-02-01T00:00:00.000Z'),
      country: 'South Africa',
      city: 'Cape Town',
      personIds: [pierreId, aureliaId],
      personMatchAny: true,
      tagIds: [tagId],
      tagMatchAny: true,
      albumIds: [albumId],
      albumMatchAny: true,
      rating: 5,
      isFavorite: true,
    });
    expect(result.results.every((item) => item.status === 'matched')).toBe(true);
  });

  it('resolves declarative camera fields through existing camera resolver behavior', async () => {
    const auth = AuthFactory.create();
    const session = makeSession({ userId: auth.user.id });
    searchRepository.getFilterSuggestions.mockResolvedValue(
      filterSuggestions({
        people: [],
        tags: [],
        cameraMakes: ['FUJIFILM'],
      }),
    );
    searchRepository.getCameraModels.mockResolvedValue(['X100VI']);
    searchRepository.getCameraLensModels.mockResolvedValue(['23mm F2']);

    const result = await sut.resolveDeclarativeFilters(auth, session, {
      camera: { make: 'FUJIFILM', model: 'X100VI', lensModel: '23mm F2' },
    });

    expect(result.status).toBe('success');
    expect(result.filters).toMatchObject({
      make: 'FUJIFILM',
      model: 'X100VI',
      lensModel: '23mm F2',
    });
  });

  it('returns needs_clarification for ambiguous people with choices', async () => {
    const auth = AuthFactory.create();
    const session = makeSession({ userId: auth.user.id });
    const firstPierre = newUuid();
    const secondPierre = newUuid();
    searchRepository.getFilterSuggestions.mockResolvedValue(
      filterSuggestions({
        people: [
          { id: firstPierre, name: 'Pierre' },
          { id: secondPierre, name: 'Pierre' },
        ],
        tags: [],
        cameraMakes: [],
      }),
    );

    const result = await sut.resolveDeclarativeFilters(auth, session, {
      people: { match: 'any', names: ['Pierre'] },
    });

    expect(result.status).toBe('needs_clarification');
    expect(result.results).toEqual([
      expect.objectContaining({
        kind: 'person',
        query: 'Pierre',
        status: 'ambiguous',
        choices: [
          expect.objectContaining({ id: firstPierre, searchFilter: { personIds: [firstPierre] } }),
          expect.objectContaining({ id: secondPierre, searchFilter: { personIds: [secondPierre] } }),
        ],
      }),
    ]);
  });

  it('returns opaque choice refs for ambiguous people choices', async () => {
    const auth = AuthFactory.create();
    const session = makeSession({ userId: auth.user.id });
    const firstPierre = newUuid();
    const secondPierre = newUuid();
    searchRepository.getFilterSuggestions.mockResolvedValue(
      filterSuggestions({
        people: [
          { id: firstPierre, name: 'Pierre' },
          { id: secondPierre, name: 'Pierre' },
        ],
        tags: [],
        cameraMakes: [],
      }),
    );

    const result = await sut.resolveDeclarativeFilters(auth, session, {
      people: { match: 'any', names: ['Pierre'] },
    });

    const choices = result.results[0].choices;
    expect(choices).toHaveLength(2);
    for (const choice of choices) {
      expect(choice.choiceRef).toMatch(/^choice:person:[A-Za-z0-9_-]{8,120}$/);
      expect(choice.choiceRef).not.toContain(choice.id);
    }
  });

  it('resolves selected people choice refs on follow-up declarative filters', async () => {
    const auth = AuthFactory.create();
    const session = makeSession({ userId: auth.user.id });
    const firstPierre = newUuid();
    const secondPierre = newUuid();
    searchRepository.getFilterSuggestions.mockResolvedValue(
      filterSuggestions({
        people: [
          { id: firstPierre, name: 'Pierre' },
          { id: secondPierre, name: 'Pierre' },
        ],
        tags: [],
        cameraMakes: [],
      }),
    );

    const ambiguous = await sut.resolveDeclarativeFilters(auth, session, {
      people: { match: 'any', names: ['Pierre'] },
    });
    const selected = ambiguous.results[0].choices[1];

    const result = await sut.resolveDeclarativeFilters(auth, session, {
      people: { match: 'any', names: ['Pierre'], choiceRefs: [selected.choiceRef!] },
    });

    expect(result.status).toBe('success');
    expect(result.filters.personIds).toEqual([selected.id]);
    expect(result.results[0]).toEqual(
      expect.objectContaining({
        kind: 'person',
        query: 'Pierre',
        status: 'matched',
        id: selected.id,
        searchFilter: { personIds: [selected.id] },
      }),
    );
  });

  it('resolves a selected ambiguous person ref plus another exact person name', async () => {
    const auth = AuthFactory.create();
    const session = makeSession({ userId: auth.user.id });
    const firstPierre = newUuid();
    const secondPierre = newUuid();
    const aureliaId = newUuid();
    searchRepository.getFilterSuggestions.mockResolvedValue(
      filterSuggestions({
        people: [
          { id: firstPierre, name: 'Pierre' },
          { id: secondPierre, name: 'Pierre' },
          { id: aureliaId, name: 'Aurelia' },
        ],
        tags: [],
        cameraMakes: [],
      }),
    );

    const ambiguous = await sut.resolveDeclarativeFilters(auth, session, {
      people: { match: 'any', names: ['Pierre'] },
    });
    const selected = ambiguous.results[0].choices[1];

    const result = await sut.resolveDeclarativeFilters(auth, session, {
      people: { match: 'any', names: ['Pierre', 'Aurelia'], choiceRefs: [selected.choiceRef!] },
    });

    expect(result.status).toBe('success');
    expect(result.filters.personIds).toEqual([selected.id, aureliaId]);
    expect(result.filters.personMatchAny).toBe(true);
  });

  it('resolves selected tag choice refs without blocking other exact tag names', async () => {
    const auth = AuthFactory.create();
    const session = makeSession({ userId: auth.user.id });
    const firstTravel = newUuid();
    const secondTravel = newUuid();
    const familyId = newUuid();
    searchRepository.getFilterSuggestions.mockResolvedValue(
      filterSuggestions({
        people: [],
        tags: [
          { id: firstTravel, value: 'Travel' },
          { id: secondTravel, value: 'Travel' },
          { id: familyId, value: 'Family' },
        ],
        cameraMakes: [],
      }),
    );

    const ambiguous = await sut.resolveDeclarativeFilters(auth, session, {
      tags: { match: 'any', names: ['Travel'] },
    });
    const selected = ambiguous.results[0].choices[0];

    const result = await sut.resolveDeclarativeFilters(auth, session, {
      tags: { match: 'any', names: ['Travel', 'Family'], choiceRefs: [selected.choiceRef!] },
    });

    expect(result.status).toBe('success');
    expect(result.filters.tagIds).toEqual([selected.id, familyId]);
    expect(result.filters.tagMatchAny).toBe(true);
  });

  it('resolves selected choice refs generated from not found suggestions', async () => {
    const auth = AuthFactory.create();
    const session = makeSession({ userId: auth.user.id });
    const pierreId = newUuid();
    searchRepository.getFilterSuggestions.mockResolvedValue(
      filterSuggestions({
        people: [{ id: pierreId, name: 'Pierre' }],
        tags: [],
        cameraMakes: [],
      }),
    );

    const suggested = await sut.resolveDeclarativeFilters(auth, session, {
      people: { match: 'any', names: ['Pier'] },
    });
    const selected = suggested.results[0].choices[0];

    const result = await sut.resolveDeclarativeFilters(auth, session, {
      people: { match: 'any', names: ['Pier'], choiceRefs: [selected.choiceRef!] },
    });

    expect(result.status).toBe('success');
    expect(result.filters.personIds).toEqual([pierreId]);
    expect(result.results[0]).toEqual(
      expect.objectContaining({
        kind: 'person',
        query: 'Pier',
        status: 'matched',
        id: pierreId,
      }),
    );
  });

  it('generates deterministic choice refs for the same session, query, and candidates', async () => {
    const auth = AuthFactory.create();
    const session = makeSession({ userId: auth.user.id });
    const firstPierre = newUuid();
    const secondPierre = newUuid();
    searchRepository.getFilterSuggestions.mockResolvedValue(
      filterSuggestions({
        people: [
          { id: firstPierre, name: 'Pierre' },
          { id: secondPierre, name: 'Pierre' },
        ],
        tags: [],
        cameraMakes: [],
      }),
    );

    const first = await sut.resolveDeclarativeFilters(auth, session, {
      people: { match: 'any', names: ['Pierre'] },
    });
    const second = await sut.resolveDeclarativeFilters(auth, session, {
      people: { match: 'any', names: ['Pierre'] },
    });

    expect(first.results[0].choices.map((choice) => choice.choiceRef)).toEqual(
      second.results[0].choices.map((choice) => choice.choiceRef),
    );
  });

  it('generates different choice refs for different sessions with the same query and candidate', async () => {
    const auth = AuthFactory.create();
    const firstSession = makeSession({ userId: auth.user.id });
    const secondSession = makeSession({ userId: auth.user.id });
    const firstPierre = newUuid();
    const secondPierre = newUuid();
    searchRepository.getFilterSuggestions.mockResolvedValue(
      filterSuggestions({
        people: [
          { id: firstPierre, name: 'Pierre' },
          { id: secondPierre, name: 'Pierre' },
        ],
        tags: [],
        cameraMakes: [],
      }),
    );

    const first = await sut.resolveDeclarativeFilters(auth, firstSession, {
      people: { match: 'any', names: ['Pierre'] },
    });
    const second = await sut.resolveDeclarativeFilters(auth, secondSession, {
      people: { match: 'any', names: ['Pierre'] },
    });

    expect(first.results[0].choices[0].choiceRef).not.toBe(second.results[0].choices[0].choiceRef);
  });

  it('returns needs_clarification for stale selected people choice refs', async () => {
    const auth = AuthFactory.create();
    const session = makeSession({ userId: auth.user.id });
    const pierreId = newUuid();
    searchRepository.getFilterSuggestions.mockResolvedValue(
      filterSuggestions({
        people: [{ id: pierreId, name: 'Pierre' }],
        tags: [],
        cameraMakes: [],
      }),
    );

    const result = await sut.resolveDeclarativeFilters(auth, session, {
      people: { match: 'any', names: ['Pierre'], choiceRefs: ['choice:person:staleChoice0000'] },
    });

    expect(result.status).toBe('needs_clarification');
    expect(result.filters.personIds).toBeUndefined();
    expect(result.status === 'needs_clarification' ? result.message : '').toMatch(/choice/i);
  });

  it.each<[string, AgentDeclarativeAssetFilters]>([
    ['people', { people: { match: 'any', names: ['Missing Person'] } }],
    ['tags', { tags: { match: 'any', names: ['missing-tag'] } }],
    ['albums', { albums: { match: 'any', names: ['Missing Album'] } }],
  ])('returns needs_clarification for missing %s without broad success', async (_label, filters) => {
    const auth = AuthFactory.create();
    const session = makeSession({ userId: auth.user.id });
    searchRepository.getFilterSuggestions.mockResolvedValue(
      filterSuggestions({ people: [], tags: [], cameraMakes: [] }),
    );
    albumRepository.getAgentAlbums.mockResolvedValue([]);

    const result = await sut.resolveDeclarativeFilters(auth, session, filters);

    expect(result.status).toBe('needs_clarification');
    expect(result.results[0]).toEqual(expect.objectContaining({ status: 'not_found' }));
  });

  it('returns needs_clarification for unsupported people match all', async () => {
    const auth = AuthFactory.create();
    const session = makeSession({ userId: auth.user.id });

    const result = await sut.resolveDeclarativeFilters(auth, session, {
      people: { match: 'all', names: ['Pierre', 'Aurelia'] },
    });

    expect(result).toMatchObject({
      status: 'needs_clarification',
      filters: {},
      results: [],
    });
    expect(result.status === 'needs_clarification' ? result.message : '').toContain('matching any');
    expect(searchRepository.getFilterSuggestions).not.toHaveBeenCalled();
  });

  it.each<[string, AgentDeclarativeAssetFilters]>([
    ['tags', { tags: { match: 'all', names: ['Travel', 'Family'] } }],
    ['albums', { albums: { match: 'all', names: ['South Africa', 'Family'] } }],
  ])('returns needs_clarification for unsupported %s match all without resolver lookups', async (_label, filters) => {
    const auth = AuthFactory.create();
    const session = makeSession({ userId: auth.user.id });

    const result = await sut.resolveDeclarativeFilters(auth, session, filters);

    expect(result).toMatchObject({
      status: 'needs_clarification',
      filters: {},
      results: [],
    });
    expect(result.status === 'needs_clarification' ? result.message : '').toContain('matching any');
    expect(searchRepository.getFilterSuggestions).not.toHaveBeenCalled();
    expect(albumRepository.getAgentAlbums).not.toHaveBeenCalled();
  });

  it('resolves shared-space names before people so space people use spacePersonIds', async () => {
    const auth = AuthFactory.create();
    const session = makeSession({ userId: auth.user.id });
    const spaceId = newUuid();
    const spacePersonId = newUuid();
    sharedSpaceRepository.getAllByUserId.mockResolvedValue([{ id: spaceId, name: 'Family' }] as never);
    searchRepository.getFilterSuggestions.mockResolvedValue(
      filterSuggestions({
        people: [
          {
            id: newUuid(),
            name: 'Pierre',
            primaryProfile: { type: 'space-person', id: spacePersonId, spaceId },
          },
        ],
        tags: [],
        cameraMakes: [],
      }),
    );

    const result = await sut.resolveDeclarativeFilters(auth, session, {
      space: { name: 'Family' },
      people: { match: 'any', names: ['Pierre'] },
    });

    expect(result.status).toBe('success');
    expect(result.filters).toMatchObject({
      spaceId,
      spacePersonIds: [spacePersonId],
    });
    expect(result.filters).not.toHaveProperty('personIds');
  });

  it('replays selected people choice refs using the resolved space-name scope', async () => {
    const auth = AuthFactory.create();
    const session = makeSession({
      userId: auth.user.id,
      permissionPlanSnapshot: {
        ...permissionPlanSnapshot,
        assetScope: { owned: false, sharedSpaces: true, locked: false },
      },
    });
    const spaceId = newUuid();
    const firstSpacePersonId = newUuid();
    const secondSpacePersonId = newUuid();
    sharedSpaceRepository.getAllByUserId.mockResolvedValue([{ id: spaceId, name: 'Family' }] as never);
    searchRepository.getFilterSuggestions.mockImplementation((_userIds, scope) =>
      Promise.resolve(
        scope?.spaceId === spaceId
          ? filterSuggestions({
              people: [
                {
                  id: newUuid(),
                  name: 'Pierre',
                  primaryProfile: { type: 'space-person', id: firstSpacePersonId, spaceId },
                },
                {
                  id: newUuid(),
                  name: 'Pierre',
                  primaryProfile: { type: 'space-person', id: secondSpacePersonId, spaceId },
                },
              ],
              tags: [],
              cameraMakes: [],
            })
          : filterSuggestions({ people: [], tags: [], cameraMakes: [] }),
      ),
    );

    const ambiguous = await sut.resolveDeclarativeFilters(auth, session, {
      space: { name: 'Family' },
      people: { match: 'any', names: ['Pierre'] },
    });
    const selected = ambiguous.results.find((result) => result.kind === 'person')?.choices[1];

    const result = await sut.resolveDeclarativeFilters(auth, session, {
      space: { name: 'Family' },
      people: { match: 'any', names: ['Pierre'], choiceRefs: [selected!.choiceRef!] },
    });

    expect(result.status).toBe('success');
    expect(result.filters).toMatchObject({
      spaceId,
      spacePersonIds: [secondSpacePersonId],
    });
    expect(searchRepository.getFilterSuggestions).toHaveBeenNthCalledWith(2, [auth.user.id], { spaceId });
  });

  it('denies declarative shared-space scope when the session permission preset blocks shared spaces', async () => {
    const auth = AuthFactory.create();
    const session = makeSession({
      userId: auth.user.id,
      permissionPlanSnapshot: {
        ...permissionPlanSnapshot,
        assetScope: { owned: true, sharedSpaces: false, locked: false },
      },
    });

    const result = await sut.resolveDeclarativeFilters(auth, session, {
      withSharedSpaces: true,
      people: { match: 'any', names: ['Pierre'] },
    });

    expect(result).toEqual({
      status: 'denied',
      filters: { withSharedSpaces: true },
      results: [],
      reason: 'Shared spaces are not accessible for this session',
    });
    expect(searchRepository.getFilterSuggestions).not.toHaveBeenCalled();
    expect(sharedSpaceRepository.getSpaceIdsForTimeline).not.toHaveBeenCalled();
  });

  it('denies declarative shared-space scalar scope without loading repository candidates', async () => {
    const auth = AuthFactory.create();
    const session = makeSession({
      userId: auth.user.id,
      permissionPlanSnapshot: {
        ...permissionPlanSnapshot,
        assetScope: { owned: true, sharedSpaces: false, locked: false },
      },
    });

    const result = await sut.resolveDeclarativeFilters(auth, session, { withSharedSpaces: true });

    expect(result).toEqual({
      status: 'denied',
      filters: { withSharedSpaces: true },
      results: [],
      reason: 'Shared spaces are not accessible for this session',
    });
    expect(searchRepository.getFilterSuggestions).not.toHaveBeenCalled();
    expect(sharedSpaceRepository.getSpaceIdsForTimeline).not.toHaveBeenCalled();
    expect(sharedSpaceRepository.getAllByUserId).not.toHaveBeenCalled();
  });
});
