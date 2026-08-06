# Pi Agent Declarative Filter Resolver Slice 5 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a reusable server-side resolver that converts `AgentDeclarativeAssetFilters` into existing `AgentSearchAssetsFilters` without making Pi copy people, tag, album, space, or camera IDs.

**Architecture:** Extract the existing `resolveAssetSearchFilters` name-resolution behavior from `AgentToolService` into a dedicated `AgentAssetSearchFilterResolverService`. Keep the existing MCP resolver tool behavior unchanged by delegating to the new service, then add a new declarative filter entry point that maps scalar filters directly and resolves named filters into concrete search filters or structured clarification results. Slice 5 does not execute searches or create plans from `assetSource.search`; it only provides the resolver used by later slices.

**Tech Stack:** NestJS services, TypeScript, existing repository mocks, Zod DTO/types from `agent-asset-source`, Vitest, `pnpm --dir server`.

---

## Scope

This is Slice 5 from `docs/superpowers/specs/2026-05-22-pi-agent-declarative-planning-sources-design.md`.

Implement only:

- A reusable service method for resolving existing `resolveAssetSearchFilters` requests.
- A reusable service method for resolving `AgentDeclarativeAssetFilters`.
- Structured declarative resolution statuses: `success`, `needs_clarification`, and `denied`.
- Tests for all Slice 5 edge cases.
- Existing `AgentToolService.resolveAssetSearchFilters()` behavior preserved through delegation.

Do not implement:

- Planning from `assetSource.search`.
- Search execution or materialized selection creation for declarative sources.
- High-level album/space/batch workflow tools.
- UI clarification rendering.
- Prompt/docs changes.

## Files

- Create: `server/src/services/agent-asset-search-filter-resolver.service.ts`
  - Owns existing resolver behavior and new declarative filter conversion.
- Create: `server/src/services/agent-asset-search-filter-resolver.service.spec.ts`
  - Tests declarative conversion and compatibility with the existing resolver behavior.
- Modify: `server/src/services/agent-tool.service.ts`
  - Inject resolver service and delegate access validation/execution for `resolveAssetSearchFilters`.
  - Remove private resolver helper methods after extraction.
- Modify: `server/src/services/agent-tool.service.spec.ts`
  - Update constructor setup to pass the resolver service.
  - Keep representative resolver-tool behavior coverage so delegation is not broken.
- Modify: `server/src/services/agent-runner-flow.integration.spec.ts`
  - Update manual `AgentToolService` construction to pass the resolver service.
- Modify: `server/src/types/agent-asset-source.types.ts`
  - Add declarative resolution result types used by Slice 6.
- Modify: `server/src/types/agent-tool.types.ts`
  - Add explicit `personMatchAny`, `tagMatchAny`, and `albumMatchAny` filter flags so declarative OR semantics survive search execution.
- Modify: `server/src/dtos/agent-tool.dto.ts`
  - Accept the explicit match flags in Pi search filter schemas.
- Modify: `server/src/services/agent-search-filter-mapper.ts`
  - Pass explicit match flags from Pi filters into Gallery search options.
- Modify: `server/src/repositories/search.repository.ts`
  - Add `albumMatchAny` to search options.
- Modify: `server/src/utils/database.ts`
  - Add any-match album SQL while preserving current all-match album behavior by default.
- Modify: `server/src/services/agent-search-filter-mapper.spec.ts`
  - Cover match-flag propagation into Gallery search options.
- Modify: `server/src/repositories/search.repository.spec.ts`
  - Cover album any-match SQL separately from default all-match SQL.
- Modify: `server/src/services/index.ts`
  - Register `AgentAssetSearchFilterResolverService` for Nest injection.

## Resolution Contract

Add this type shape in `server/src/types/agent-asset-source.types.ts`:

```ts
import type { AgentResolvedAssetSearchFilterResult, AgentSearchAssetsFilters } from 'src/types/agent-tool.types';

export type AgentDeclarativeAssetFilterResolution =
  | {
      status: 'success';
      filters: AgentSearchAssetsFilters;
      results: AgentResolvedAssetSearchFilterResult[];
    }
  | {
      status: 'needs_clarification';
      filters: AgentSearchAssetsFilters;
      results: AgentResolvedAssetSearchFilterResult[];
      message: string;
    }
  | {
      status: 'denied';
      filters: AgentSearchAssetsFilters;
      results: AgentResolvedAssetSearchFilterResult[];
      reason: string;
    };
```

Rules:

- Scalar declarative fields map directly:
  - `takenAfter`, `takenBefore` parse to `Date`.
  - `country`, `city`, `state`, `rating`, `isFavorite`, `isNotInAlbum`, `type`, `visibility`, `withSharedSpaces` copy into `AgentSearchAssetsFilters`.
- Named declarative fields map through existing resolver behavior:
  - `people.names` -> `people`
  - `tags.names` -> `tags`
  - `albums.names` -> `albums`
  - `space.name` -> `spaces`
  - `camera.make` -> `cameraMakes`
  - `camera.model` -> `cameraModels`
  - `camera.lensModel` -> `lensModels`
- `match: 'any'` is supported for people/tags/albums and produces OR-compatible filters:
  - people: `personIds` plus `personMatchAny: true`;
  - tags: `tagIds` plus `tagMatchAny: true`;
  - albums: `albumIds` plus `albumMatchAny: true`.
- Explicit ID tools keep their existing default semantics unless a match flag is set. Plain `personIds`, `tagIds`, and `albumIds` remain all-match filters where the current backend already treats them that way.
- `match: 'all'` is not supported in Slice 5. Return `needs_clarification`, no resolver/search execution, and a message that says Gallery currently supports matching any of the named people/tags/albums for this flow.
- Ambiguous or missing people/tags/albums/spaces/camera values return `needs_clarification` with resolver `results` and choices. Do not return `success` with a broad partial filter.
- `space.name` must resolve before people names so shared-space people produce `{ spaceId, spacePersonIds }`.
- Permission denials return `denied` without loading shared-space candidates when the preset disallows the requested shared-space scope.

## Task 1: Extract Existing Resolver Service

**Files:**

- Create: `server/src/services/agent-asset-search-filter-resolver.service.ts`
- Create: `server/src/services/agent-asset-search-filter-resolver.service.spec.ts`
- Modify: `server/src/services/agent-tool.service.ts`
- Modify: `server/src/services/agent-tool.service.spec.ts`
- Modify: `server/src/services/agent-runner-flow.integration.spec.ts`
- Modify: `server/src/services/index.ts`

- [ ] **Step 1: Write failing extraction tests**

Create `server/src/services/agent-asset-search-filter-resolver.service.spec.ts` with tests that prove the new service owns existing resolver behavior. Start with one success case and one permission-denied case:

```ts
import { AgentSession } from 'src/database';
import { AgentPermissionPreset, AgentProviderType, AgentApprovalMode, AgentSessionStatus } from 'src/enum';
import { AlbumRepository } from 'src/repositories/album.repository';
import { SearchRepository } from 'src/repositories/search.repository';
import { SharedSpaceRepository } from 'src/repositories/shared-space.repository';
import { AgentAssetSearchFilterResolverService } from 'src/services/agent-asset-search-filter-resolver.service';
import type { AgentDeclarativeAssetFilters } from 'src/types/agent-asset-source.types';
import { AgentPermissionPlanSnapshot } from 'src/types/agent-session.types';
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
    searchRepository.getFilterSuggestions.mockResolvedValue({
      people: [{ id: personId, name: 'Pierre' }],
      tags: [{ id: tagId, value: 'Travel' }],
      cameraMakes: [],
    });
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
});
```

- [ ] **Step 2: Run extraction tests and verify red**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-asset-search-filter-resolver.service.spec.ts
```

Expected: FAIL because `AgentAssetSearchFilterResolverService` does not exist.

- [ ] **Step 3: Create the resolver service**

Create `server/src/services/agent-asset-search-filter-resolver.service.ts` and move the resolver code out of `AgentToolService`.

The new file must contain:

- the constructor shown below;
- `validateToolAccess()` copied from current `AgentToolService.validateResolveAssetSearchFiltersAccess()`, replacing `this.validateSharedSpaceAccess(...)` with a direct `sharedSpaceRepository.getMember(...)` check as shown;
- `resolveToolFilters()` copied from current `AgentToolService.executeResolveAssetSearchFilters()`;
- these private helpers copied unchanged from `AgentToolService`: `canUseResolverRepositoryCandidates`, `resolvePersonFilters`, `getPersonSearchFilter`, `mergeResolvedPersonFilter`, `resolveIdFilters`, `matchVisibleCandidates`, `hasSearchFilter`, `getNotFoundSuggestionCandidates`, `choiceForIdCandidate`, `isExactMatch`, and `normalizeResolverTerm`.

```ts
import { Injectable } from '@nestjs/common';
import { AuthDto } from 'src/dtos/auth.dto';
import { AgentResolveAssetSearchFiltersToolRequestDto } from 'src/dtos/agent-tool.dto';
import { AgentSession } from 'src/database';
import { AlbumRepository } from 'src/repositories/album.repository';
import { SearchRepository } from 'src/repositories/search.repository';
import { SharedSpaceRepository } from 'src/repositories/shared-space.repository';
import {
  AgentResolvedAssetSearchFilterChoice,
  AgentResolvedAssetSearchFilterKind,
  AgentResolvedAssetSearchFilterResult,
  AgentSearchAssetsFilters,
} from 'src/types/agent-tool.types';

@Injectable()
export class AgentAssetSearchFilterResolverService {
  constructor(
    private readonly searchRepository: SearchRepository,
    private readonly albumRepository: AlbumRepository,
    private readonly sharedSpaceRepository: SharedSpaceRepository,
  ) {}

  async validateToolAccess(
    auth: AuthDto,
    session: AgentSession,
    request: AgentResolveAssetSearchFiltersToolRequestDto,
  ): Promise<string | null> {
    const requiresSharedSpaces =
      request.scope?.withSharedSpaces === true || request.scope?.spaceId || (request.spaces?.length ?? 0) > 0;
    if (requiresSharedSpaces && !session.permissionPlanSnapshot.assetScope.sharedSpaces) {
      return 'Shared spaces are not accessible for this session';
    }

    if (request.scope?.spaceId) {
      const member = await this.sharedSpaceRepository.getMember(request.scope.spaceId, auth.user.id);
      return member ? null : 'Space is not accessible';
    }

    return null;
  }

  async resolveToolFilters(
    auth: AuthDto,
    session: AgentSession,
    request: AgentResolveAssetSearchFiltersToolRequestDto,
  ): Promise<{
    resolvedFilters: AgentSearchAssetsFilters;
    results: AgentResolvedAssetSearchFilterResult[];
  }>;
}
```

- [ ] **Step 4: Delegate `AgentToolService` to the new service**

Modify the `AgentToolService` constructor:

```ts
constructor(
  private readonly accessRepository: AccessRepository,
  private readonly assetRepository: AssetRepository,
  private readonly searchRepository: SearchRepository,
  private readonly loggingRepository: LoggingRepository,
  private readonly configRepository: ConfigRepository,
  private readonly machineLearningRepository: MachineLearningRepository,
  private readonly systemMetadataRepository: SystemMetadataRepository,
  private readonly albumRepository: AlbumRepository,
  private readonly sharedSpaceRepository: SharedSpaceRepository,
  private readonly sessionRepository: AgentSessionRepository,
  private readonly selectionHandleRepository: AgentSelectionHandleRepository,
  private readonly toolCallRepository: AgentToolCallRepository,
  private readonly agentRunnerService: AgentRunnerService,
  private readonly userService: UserService,
  private readonly assetSearchFilterResolverService: AgentAssetSearchFilterResolverService,
) {}
```

Update `resolveAssetSearchFiltersDescriptor()`:

```ts
validateAccess: (auth, session, request) =>
  this.assetSearchFilterResolverService.validateToolAccess(auth, session, request),
execute: (auth, session, request) => this.assetSearchFilterResolverService.resolveToolFilters(auth, session, request),
```

Delete the now-duplicated private resolver helper methods from `AgentToolService`.

- [ ] **Step 5: Update constructors and provider registration**

In `server/src/services/agent-tool.service.spec.ts`, create and pass a resolver service:

```ts
let assetSearchFilterResolverService: AgentAssetSearchFilterResolverService;

assetSearchFilterResolverService = new AgentAssetSearchFilterResolverService(
  searchRepository,
  albumRepository,
  sharedSpaceRepository,
);
sut = new AgentToolService(
  accessRepository as unknown as AccessRepository,
  assetRepository as unknown as AssetRepository,
  searchRepository,
  loggingRepository,
  configRepository,
  machineLearningRepository,
  systemMetadataRepository,
  albumRepository,
  sharedSpaceRepository,
  sessionRepository,
  selectionHandleRepository,
  toolCallRepository,
  agentRunnerService,
  userService as unknown as UserService,
  assetSearchFilterResolverService,
);
```

In `server/src/services/agent-runner-flow.integration.spec.ts`, update the manual `new AgentToolService(...)` call around line 754 by constructing `AgentAssetSearchFilterResolverService` with the same access/search/album/shared-space repository instances used by the integration setup and passing it as the final constructor argument.

In `server/src/services/index.ts`, import and register:

```ts
import { AgentAssetSearchFilterResolverService } from 'src/services/agent-asset-search-filter-resolver.service';
```

and add `AgentAssetSearchFilterResolverService` to `services`.

- [ ] **Step 6: Run extraction tests and existing resolver-tool tests**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-asset-search-filter-resolver.service.spec.ts src/services/agent-tool.service.spec.ts -t "resolve|resolver|searchAssets rejects broad searches"
```

Expected: PASS. If a focused `-t` misses important constructor errors, run the full `agent-tool.service.spec.ts` before moving on.

## Task 2: Declarative Scalar And `any` Named Filter Resolution

**Files:**

- Modify: `server/src/types/agent-asset-source.types.ts`
- Modify: `server/src/services/agent-asset-search-filter-resolver.service.ts`
- Test: `server/src/services/agent-asset-search-filter-resolver.service.spec.ts`

- [ ] **Step 1: Write failing declarative success tests**

Add these tests to `server/src/services/agent-asset-search-filter-resolver.service.spec.ts`:

```ts
it('resolves declarative scalar filters and people/tags/albums with match any', async () => {
  const auth = AuthFactory.create();
  const session = makeSession({ userId: auth.user.id });
  const pierreId = newUuid();
  const aureliaId = newUuid();
  const tagId = newUuid();
  const albumId = newUuid();
  searchRepository.getFilterSuggestions.mockResolvedValue({
    people: [
      { id: pierreId, name: 'Pierre' },
      { id: aureliaId, name: 'Aurelia' },
    ],
    tags: [{ id: tagId, value: 'Travel' }],
    cameraMakes: [],
  });
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
  searchRepository.getFilterSuggestions.mockResolvedValue({
    people: [],
    tags: [],
    cameraMakes: ['FUJIFILM'],
  });
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
```

- [ ] **Step 2: Run declarative success tests and verify red**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-asset-search-filter-resolver.service.spec.ts -t "declarative scalar|camera fields"
```

Expected: FAIL because `resolveDeclarativeFilters()` does not exist.

- [ ] **Step 3: Add declarative result type**

In `server/src/types/agent-asset-source.types.ts`, import `AgentResolvedAssetSearchFilterResult` and `AgentSearchAssetsFilters` using type imports to avoid runtime cycles:

```ts
import type { AgentResolvedAssetSearchFilterResult, AgentSearchAssetsFilters } from 'src/types/agent-tool.types';
```

Then add `AgentDeclarativeAssetFilterResolution` as defined in the Resolution Contract section.

- [ ] **Step 4: Implement scalar mapping and `any` named resolution**

In `AgentAssetSearchFilterResolverService`, add:

```ts
async resolveDeclarativeFilters(
  auth: AuthDto,
  session: AgentSession,
  filters: AgentDeclarativeAssetFilters,
): Promise<AgentDeclarativeAssetFilterResolution> {
  const unsupportedAll = this.getUnsupportedAllMatchMessage(filters);
  if (unsupportedAll) {
    return {
      status: 'needs_clarification',
      filters: this.resolveDeclarativeScalarFilters(filters),
      results: [],
      message: unsupportedAll,
    };
  }

  const scalarFilters = this.resolveDeclarativeScalarFilters(filters);
  const resolverRequest = this.toResolveToolRequest(filters);
  const accessReason = await this.validateDeclarativeAccess(auth, session, filters, resolverRequest);
  if (accessReason) {
    return { status: 'denied', filters: scalarFilters, results: [], reason: accessReason };
  }

  if (!resolverRequest) {
    return { status: 'success', filters: scalarFilters, results: [] };
  }

  const { resolvedFilters, results } = await this.resolveToolFilters(auth, session, resolverRequest);
  const mergedFilters = { ...scalarFilters, ...resolvedFilters };
  const blockingResults = results.filter((result) => result.status !== 'matched');
  if (blockingResults.length > 0) {
    return {
      status: 'needs_clarification',
      filters: mergedFilters,
      results,
      message: blockingResults.map((result) => result.message).join('; '),
    };
  }

  return { status: 'success', filters: mergedFilters, results };
}
```

Add helpers:

```ts
private resolveDeclarativeScalarFilters(filters: AgentDeclarativeAssetFilters): AgentSearchAssetsFilters {
  return {
    ...(filters.takenAfter ? { takenAfter: new Date(filters.takenAfter) } : {}),
    ...(filters.takenBefore ? { takenBefore: new Date(filters.takenBefore) } : {}),
    ...(filters.country !== undefined ? { country: filters.country } : {}),
    ...(filters.city !== undefined ? { city: filters.city } : {}),
    ...(filters.state !== undefined ? { state: filters.state } : {}),
    ...(filters.rating !== undefined ? { rating: filters.rating } : {}),
    ...(filters.isFavorite !== undefined ? { isFavorite: filters.isFavorite } : {}),
    ...(filters.isNotInAlbum !== undefined ? { isNotInAlbum: filters.isNotInAlbum } : {}),
    ...(filters.type !== undefined ? { type: filters.type } : {}),
    ...(filters.visibility !== undefined ? { visibility: filters.visibility } : {}),
    ...(filters.withSharedSpaces !== undefined ? { withSharedSpaces: filters.withSharedSpaces } : {}),
  };
}

private toResolveToolRequest(
  filters: AgentDeclarativeAssetFilters,
): AgentResolveAssetSearchFiltersToolRequestDto | null {
  const request: AgentResolveAssetSearchFiltersToolRequestDto = {
    ...(filters.people ? { people: filters.people.names } : {}),
    ...(filters.tags ? { tags: filters.tags.names } : {}),
    ...(filters.albums ? { albums: filters.albums.names } : {}),
    ...(filters.space ? { spaces: [filters.space.name] } : {}),
    ...(filters.camera?.make ? { cameraMakes: [filters.camera.make] } : {}),
    ...(filters.camera?.model ? { cameraModels: [filters.camera.model] } : {}),
    ...(filters.camera?.lensModel ? { lensModels: [filters.camera.lensModel] } : {}),
    scope: {
      ...(filters.withSharedSpaces === undefined ? {} : { withSharedSpaces: filters.withSharedSpaces }),
      ...(filters.takenAfter ? { takenAfter: new Date(filters.takenAfter) } : {}),
      ...(filters.takenBefore ? { takenBefore: new Date(filters.takenBefore) } : {}),
    },
  };
  const hasResolverField =
    request.people ||
    request.tags ||
    request.albums ||
    request.spaces ||
    request.cameraMakes ||
    request.cameraModels ||
    request.lensModels;

  return hasResolverField ? request : null;
}
```

Make sure imports include:

```ts
import type {
  AgentDeclarativeAssetFilterResolution,
  AgentDeclarativeAssetFilters,
} from 'src/types/agent-asset-source.types';
```

- [ ] **Step 5: Run declarative success tests and verify green**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-asset-search-filter-resolver.service.spec.ts -t "declarative scalar|camera fields"
```

Expected: PASS.

## Task 3: Clarification And Unsupported `all`

**Files:**

- Modify: `server/src/services/agent-asset-search-filter-resolver.service.ts`
- Test: `server/src/services/agent-asset-search-filter-resolver.service.spec.ts`

- [ ] **Step 1: Write failing clarification tests**

Add:

```ts
it('returns needs_clarification for ambiguous people with choices', async () => {
  const auth = AuthFactory.create();
  const session = makeSession({ userId: auth.user.id });
  const firstPierre = newUuid();
  const secondPierre = newUuid();
  searchRepository.getFilterSuggestions.mockResolvedValue({
    people: [
      { id: firstPierre, name: 'Pierre' },
      { id: secondPierre, name: 'Pierre' },
    ],
    tags: [],
    cameraMakes: [],
  });

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

it.each<[string, AgentDeclarativeAssetFilters]>([
  ['people', { people: { match: 'any', names: ['Missing Person'] } }],
  ['tags', { tags: { match: 'any', names: ['missing-tag'] } }],
  ['albums', { albums: { match: 'any', names: ['Missing Album'] } }],
])('returns needs_clarification for missing %s without broad success', async (_label, filters) => {
  const auth = AuthFactory.create();
  const session = makeSession({ userId: auth.user.id });
  searchRepository.getFilterSuggestions.mockResolvedValue({ people: [], tags: [], cameraMakes: [] });
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

it.each([
  ['tags', { tags: { match: 'all', names: ['Travel', 'Family'] } }],
  ['albums', { albums: { match: 'all', names: ['South Africa', 'Family'] } }],
])('returns needs_clarification for unsupported %s match all without resolver lookups', async (_label, filters) => {
  const auth = AuthFactory.create();
  const session = makeSession({ userId: auth.user.id });

  const result = await sut.resolveDeclarativeFilters(auth, session, filters);

  expect(result).toMatchObject({ status: 'needs_clarification', filters: {}, results: [] });
  expect(result.status === 'needs_clarification' ? result.message : '').toContain('matching any');
  expect(searchRepository.getFilterSuggestions).not.toHaveBeenCalled();
  expect(albumRepository.getAgentAlbums).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run clarification tests and verify red**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-asset-search-filter-resolver.service.spec.ts -t "needs_clarification|unsupported"
```

Expected: FAIL until `resolveDeclarativeFilters()` treats non-matched resolver results and every `match: all` named filter as blocking.

- [ ] **Step 3: Implement unsupported `all` detection**

Add:

```ts
private getUnsupportedAllMatchMessage(filters: AgentDeclarativeAssetFilters): string | null {
  const unsupportedKinds = [
    filters.people?.match === 'all' ? 'people' : null,
    filters.tags?.match === 'all' ? 'tags' : null,
    filters.albums?.match === 'all' ? 'albums' : null,
  ].filter((kind): kind is string => kind !== null);

  if (unsupportedKinds.length === 0) {
    return null;
  }

  return `Gallery currently supports matching any of the named ${unsupportedKinds.join(
    ', ',
  )} for this assistant flow. Ask the user to narrow the request or choose an any-match search.`;
}
```

Ensure `resolveDeclarativeFilters()` checks this before repository calls.

- [ ] **Step 4: Run clarification tests and verify green**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-asset-search-filter-resolver.service.spec.ts -t "needs_clarification|unsupported"
```

Expected: PASS.

## Task 4: Shared-Space Scope And Permission Coverage

**Files:**

- Modify: `server/src/services/agent-asset-search-filter-resolver.service.ts`
- Test: `server/src/services/agent-asset-search-filter-resolver.service.spec.ts`

- [ ] **Step 1: Write failing shared-space tests**

Add:

```ts
it('resolves shared-space names before people so space people use spacePersonIds', async () => {
  const auth = AuthFactory.create();
  const session = makeSession({ userId: auth.user.id });
  const spaceId = newUuid();
  const spacePersonId = newUuid();
  sharedSpaceRepository.getAllByUserId.mockResolvedValue([{ id: spaceId, name: 'Family' }] as never);
  searchRepository.getFilterSuggestions.mockResolvedValue({
    people: [
      {
        id: newUuid(),
        name: 'Pierre',
        primaryProfile: { type: 'space-person', id: spacePersonId, spaceId },
      },
    ],
    tags: [],
    cameraMakes: [],
  });

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
```

- [ ] **Step 2: Run shared-space tests and verify red**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-asset-search-filter-resolver.service.spec.ts -t "shared-space|space people|permission preset"
```

Expected: FAIL until declarative access validation and space-first resolver mapping are implemented.

- [ ] **Step 3: Implement declarative shared-space access validation**

Add:

```ts
private async validateDeclarativeAccess(
  auth: AuthDto,
  session: AgentSession,
  filters: AgentDeclarativeAssetFilters,
  resolverRequest: AgentResolveAssetSearchFiltersToolRequestDto | null,
): Promise<string | null> {
  const requiresSharedSpaces =
    filters.withSharedSpaces === true || filters.space !== undefined || resolverRequest?.scope?.spaceId !== undefined;
  if (requiresSharedSpaces && !session.permissionPlanSnapshot.assetScope.sharedSpaces) {
    return 'Shared spaces are not accessible for this session';
  }

  return resolverRequest ? this.validateToolAccess(auth, session, resolverRequest) : null;
}
```

The existing `resolveToolFilters()` logic already resolves spaces before people. Preserve that order.

- [ ] **Step 4: Run shared-space tests and verify green**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-asset-search-filter-resolver.service.spec.ts -t "shared-space|space people|permission preset"
```

Expected: PASS.

## Task 5: Full Verification And Commit

**Files:**

- Verify all modified files.

- [ ] **Step 1: Run new resolver suite**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-asset-search-filter-resolver.service.spec.ts
```

Expected: PASS, including:

- `people.match = "any"` maps multiple names to `personIds` plus `personMatchAny: true`.
- `tags.match = "any"` maps names to `tagIds` plus `tagMatchAny: true`.
- `albums.match = "any"` maps names to `albumIds` plus `albumMatchAny: true`.
- Default explicit ID filters retain existing all-match semantics unless a match flag is set.
- `people.match = "all"`, `tags.match = "all"`, and `albums.match = "all"` return `needs_clarification`.
- Ambiguous people return `needs_clarification` with choices.
- Missing people/tags/albums return `needs_clarification`.
- Date strings parse to UTC `Date` objects.
- Shared-space names resolve to `spaceId`.
- Shared-space people resolve with `spaceId` and `spacePersonIds`.
- Permission presets block disallowed shared-space scopes.

- [ ] **Step 2: Run affected agent tool suites**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-tool.service.spec.ts src/dtos/agent-asset-source.dto.spec.ts src/types/agent-asset-source.types.spec.ts
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-search-filter-mapper.spec.ts src/repositories/search.repository.spec.ts
```

Expected: PASS. This proves existing MCP resolver/search contracts, Slice 1 source contracts, match-flag propagation, and album any-match search semantics still hold.

- [ ] **Step 3: Run runner integration compile-sensitive suite**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-runner-flow.integration.spec.ts
```

Expected: PASS or existing skipped integration behavior. If this suite is too slow, at minimum run `pnpm --dir server exec tsc --noEmit --pretty false` before commit to catch constructor drift.

- [ ] **Step 4: Run static checks**

Run:

```bash
pnpm --dir server run lint
pnpm --dir server exec tsc --noEmit --pretty false
git diff --check
```

Expected: PASS.

- [ ] **Step 5: Commit and push**

Run:

```bash
git status --short
git add server/src/services/agent-asset-search-filter-resolver.service.ts \
  server/src/services/agent-asset-search-filter-resolver.service.spec.ts \
  server/src/services/agent-tool.service.ts \
  server/src/services/agent-tool.service.spec.ts \
  server/src/services/agent-runner-flow.integration.spec.ts \
  server/src/types/agent-asset-source.types.ts \
  server/src/types/agent-tool.types.ts \
  server/src/dtos/agent-tool.dto.ts \
  server/src/services/agent-search-filter-mapper.ts \
  server/src/services/agent-search-filter-mapper.spec.ts \
  server/src/repositories/search.repository.ts \
  server/src/repositories/search.repository.spec.ts \
  server/src/utils/database.ts \
  server/src/services/index.ts \
  docs/superpowers/plans/2026-05-22-pi-agent-declarative-planning-sources-slice-5.md
git commit -m "feat(server): resolve Pi declarative asset filters"
git push
```

Expected: commit succeeds and branch `explore/pi-agent-brainstorm` is pushed.

## Plan Self-Review

- TDD order is explicit for extraction, declarative success, clarification, shared-space scope, and final verification.
- Every Slice 5 edge case is mapped to an automated test:
  - `people.match = "any"` maps multiple names to `personIds`.
  - `people.match = "all"` is rejected as `needs_clarification`.
  - Ambiguous people return choices.
  - Missing people/tags/albums return `needs_clarification`, not broad success.
  - Date strings parse to stable UTC `Date` objects.
  - Shared-space names and people resolve to `spaceId` and `spacePersonIds`.
  - Permission presets block disallowed shared-space scopes.
- The plan does not implement Slice 6 search execution or plan materialization.
- Existing `resolveAssetSearchFilters` MCP behavior remains covered through delegation.
