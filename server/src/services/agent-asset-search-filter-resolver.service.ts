import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { AgentSession } from 'src/database';
import type { AgentResolveAssetSearchFiltersToolRequestDto } from 'src/dtos/agent-tool.dto';
import type { AuthDto } from 'src/dtos/auth.dto';
import { AlbumRepository } from 'src/repositories/album.repository';
import { SearchRepository } from 'src/repositories/search.repository';
import { SharedSpaceRepository } from 'src/repositories/shared-space.repository';
import type {
  AgentDeclarativeAssetFilterResolution,
  AgentDeclarativeAssetFilters,
} from 'src/types/agent-asset-source.types';
import type {
  AgentResolvedAssetSearchFilterChoice,
  AgentResolvedAssetSearchFilterKind,
  AgentResolvedAssetSearchFilterResult,
  AgentSearchAssetsFilters,
} from 'src/types/agent-tool.types';

type SelectedChoiceRefs = {
  all: Set<string>;
  consumed: Set<string>;
};

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
  }> {
    const resolvedFilters: AgentSearchAssetsFilters = {};
    const results: AgentResolvedAssetSearchFilterResult[] = [];
    const scope = request.scope ?? {};
    if (scope.spaceId) {
      resolvedFilters.spaceId = scope.spaceId;
    }

    if (request.spaces?.length) {
      const visibleSpaces = await this.sharedSpaceRepository.getAllByUserId(auth.user.id);
      const spaces = visibleSpaces.map((space) => ({ id: space.id, value: space.name }));
      for (const query of request.spaces) {
        const matched = this.matchVisibleCandidates(
          spaces,
          query,
          'space',
          (candidate) => ({
            spaceId: candidate.id,
          }),
          session.id,
        );
        if (matched.result.status === 'matched') {
          if (resolvedFilters.spaceId && resolvedFilters.spaceId !== matched.result.id) {
            results.push({
              ...matched.result,
              status: 'ambiguous',
              searchFilter: undefined,
              choices: [
                this.choiceForIdCandidate({ id: matched.result.id!, value: matched.result.value! }, 'space', {
                  spaceId: matched.result.id,
                }),
              ],
              message: 'Only one spaceId can be used in searchAssets',
            });
          } else {
            resolvedFilters.spaceId = matched.result.id;
            results.push(matched.result);
          }
        } else {
          results.push(matched.result);
        }
      }
    }

    const needsRepositoryCandidates =
      (request.people?.length ?? 0) > 0 ||
      (request.tags?.length ?? 0) > 0 ||
      (request.cameraMakes?.length ?? 0) > 0 ||
      (request.cameraModels?.length ?? 0) > 0 ||
      (request.lensModels?.length ?? 0) > 0;
    const resolverScope = { ...scope, ...(resolvedFilters.spaceId ? { spaceId: resolvedFilters.spaceId } : {}) };
    const canUseRepositoryCandidates = this.canUseResolverRepositoryCandidates(session, resolverScope);
    const shouldLoadTimelineSpaceIds =
      !resolvedFilters.spaceId &&
      (scope.withSharedSpaces === true ||
        (needsRepositoryCandidates &&
          !canUseRepositoryCandidates &&
          session.permissionPlanSnapshot.assetScope.sharedSpaces));
    const timelineSpaceRows = shouldLoadTimelineSpaceIds
      ? await this.sharedSpaceRepository.getSpaceIdsForTimeline(auth.user.id)
      : [];
    const timelineSpaceIds = timelineSpaceRows.map((row) => row.spaceId);
    const repositoryScope = resolvedFilters.spaceId
      ? { spaceId: resolvedFilters.spaceId }
      : { ...scope, ...(shouldLoadTimelineSpaceIds ? { timelineSpaceIds } : {}) };
    const needsSuggestions =
      (request.people?.length ?? 0) > 0 || (request.tags?.length ?? 0) > 0 || (request.cameraMakes?.length ?? 0) > 0;
    const suggestions =
      needsSuggestions && canUseRepositoryCandidates
        ? await this.searchRepository.getFilterSuggestions([auth.user.id], repositoryScope)
        : null;

    if (request.people?.length) {
      this.resolvePersonFilters(results, resolvedFilters, request.people, suggestions?.people ?? [], session.id);
    }

    if (request.tags?.length) {
      this.resolveIdFilters(
        results,
        resolvedFilters,
        'tag',
        request.tags,
        suggestions?.tags.map((tag) => ({ id: tag.id, value: tag.value })) ?? [],
        'tagIds',
        session.id,
      );
    }

    if (request.albums?.length) {
      const visibleAlbums = await this.albumRepository.getAgentAlbums(auth.user.id);
      const albums = visibleAlbums
        .filter((album) => {
          const isOwned = album.ownerId === auth.user.id;
          return isOwned
            ? session.permissionPlanSnapshot.assetScope.owned
            : session.permissionPlanSnapshot.assetScope.sharedSpaces;
        })
        .map((album) => ({ id: album.id, value: album.albumName }));
      this.resolveIdFilters(results, resolvedFilters, 'album', request.albums, albums, 'albumIds', session.id);
    }

    if (request.cameraMakes?.length) {
      for (const query of request.cameraMakes) {
        const matched = this.matchVisibleCandidates(
          (suggestions?.cameraMakes ?? []).map((value) => ({ value })),
          query,
          'cameraMake',
          (candidate) => ({ make: candidate.value }),
          session.id,
        );
        if (matched.result.status === 'matched') {
          resolvedFilters.make = matched.result.value;
          const models = await this.searchRepository.getCameraModels([auth.user.id], {
            ...repositoryScope,
            make: matched.result.value,
          });
          matched.result.choices = models.slice(0, 5).map((model) => ({
            value: model,
            label: model,
            searchFilter: { make: matched.result.value, model },
          }));
        }
        results.push(matched.result);
      }
    }

    if (request.cameraModels?.length) {
      const models = canUseRepositoryCandidates
        ? await this.searchRepository.getCameraModels([auth.user.id], {
            ...repositoryScope,
            ...(resolvedFilters.make ? { make: resolvedFilters.make } : {}),
          })
        : [];
      for (const query of request.cameraModels) {
        const matched = this.matchVisibleCandidates(
          models.map((value) => ({ value })),
          query,
          'cameraModel',
          (candidate) => ({ model: candidate.value }),
          session.id,
        );
        if (matched.result.status === 'matched') {
          resolvedFilters.model = matched.result.value;
        }
        results.push(matched.result);
      }
    }

    if (request.lensModels?.length) {
      const lensModels = canUseRepositoryCandidates
        ? await this.searchRepository.getCameraLensModels([auth.user.id], {
            ...repositoryScope,
            ...(resolvedFilters.make ? { make: resolvedFilters.make } : {}),
            ...(resolvedFilters.model ? { model: resolvedFilters.model } : {}),
          })
        : [];
      for (const query of request.lensModels) {
        const matched = this.matchVisibleCandidates(
          lensModels.map((value) => ({ value })),
          query,
          'lensModel',
          (candidate) => ({ lensModel: candidate.value }),
          session.id,
        );
        if (matched.result.status === 'matched') {
          resolvedFilters.lensModel = matched.result.value;
        }
        results.push(matched.result);
      }
    }

    return { resolvedFilters, results };
  }

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

    const { resolvedFilters, results } = await this.resolveDeclarativeToolFilters(
      auth,
      session,
      resolverRequest,
      filters,
    );
    const mergedFilters = { ...scalarFilters, ...resolvedFilters };
    this.applyDeclarativeMatchFlags(filters, mergedFilters);
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

  private applyDeclarativeMatchFlags(
    filters: AgentDeclarativeAssetFilters,
    resolvedFilters: AgentSearchAssetsFilters,
  ): void {
    if (filters.people?.match === 'any' && resolvedFilters.personIds?.length) {
      resolvedFilters.personMatchAny = true;
    }
    if (filters.tags?.match === 'any' && resolvedFilters.tagIds?.length) {
      resolvedFilters.tagMatchAny = true;
    }
    if (filters.albums?.match === 'any' && resolvedFilters.albumIds?.length) {
      resolvedFilters.albumMatchAny = true;
    }
  }

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

  private resolveDeclarativeScalarFilters(filters: AgentDeclarativeAssetFilters): AgentSearchAssetsFilters {
    const resolvedFilters: AgentSearchAssetsFilters = {};
    if (filters.takenAfter) {
      resolvedFilters.takenAfter = new Date(filters.takenAfter);
    }
    if (filters.takenBefore) {
      resolvedFilters.takenBefore = new Date(filters.takenBefore);
    }
    if (filters.country !== undefined) {
      resolvedFilters.country = filters.country;
    }
    if (filters.city !== undefined) {
      resolvedFilters.city = filters.city;
    }
    if (filters.state !== undefined) {
      resolvedFilters.state = filters.state;
    }
    if (filters.rating !== undefined) {
      resolvedFilters.rating = filters.rating;
    }
    if (filters.isFavorite !== undefined) {
      resolvedFilters.isFavorite = filters.isFavorite;
    }
    if (filters.isNotInAlbum !== undefined) {
      resolvedFilters.isNotInAlbum = filters.isNotInAlbum;
    }
    if (filters.type !== undefined) {
      resolvedFilters.type = filters.type;
    }
    if (filters.visibility !== undefined) {
      resolvedFilters.visibility = filters.visibility;
    }
    if (filters.withSharedSpaces !== undefined) {
      resolvedFilters.withSharedSpaces = filters.withSharedSpaces;
    }
    return resolvedFilters;
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

  private getUnsupportedAllMatchMessage(filters: AgentDeclarativeAssetFilters): string | null {
    const unsupported = [
      filters.people?.match === 'all' ? 'people' : null,
      filters.tags?.match === 'all' ? 'tags' : null,
      filters.albums?.match === 'all' ? 'albums' : null,
    ].filter((value): value is string => !!value);
    if (unsupported.length === 0) {
      return null;
    }

    return `Gallery currently supports matching any of the named people/tags/albums for this flow; matching all requested ${unsupported.join(
      ', ',
    )} needs clarification.`;
  }

  private canUseResolverRepositoryCandidates(
    session: AgentSession,
    scope: AgentResolveAssetSearchFiltersToolRequestDto['scope'],
  ): boolean {
    return session.permissionPlanSnapshot.assetScope.owned || !!scope?.spaceId;
  }

  private resolvePersonFilters(
    results: AgentResolvedAssetSearchFilterResult[],
    resolvedFilters: AgentSearchAssetsFilters,
    queries: string[],
    people: Array<{
      id: string;
      name: string;
      primaryProfile?: { type: 'user-person' | 'space-person'; id: string; spaceId?: string };
    }>,
    sessionId: string,
    choiceRefs?: string[],
  ) {
    const selected = choiceRefs?.length ? this.toSelectedChoiceRefs(choiceRefs) : undefined;
    const candidates = people.map((person) => ({
      id: person.primaryProfile?.id ?? person.id,
      value: person.name,
      searchFilter: this.getPersonSearchFilter(person, resolvedFilters.spaceId),
    }));
    const deferredOrdinaryMatches: AgentResolvedAssetSearchFilterResult[] = [];

    for (const query of queries) {
      const matched = this.matchVisibleCandidates(
        candidates,
        query,
        'person',
        (candidate) => candidate.searchFilter,
        sessionId,
        selected,
      );
      if (selected && matched.selectionReplay === 'fallback') {
        deferredOrdinaryMatches.push(matched.result);
        continue;
      }

      if (matched.result.status === 'matched') {
        this.mergeResolvedPersonFilter(resolvedFilters, matched.result.searchFilter);
      }
      results.push(matched.result);
    }

    if (selected) {
      if (selected.consumed.size > 0) {
        for (const matched of deferredOrdinaryMatches) {
          if (matched.status === 'matched') {
            this.mergeResolvedPersonFilter(resolvedFilters, matched.searchFilter);
          }
          results.push(matched);
        }
      }
      this.appendUnconsumedChoiceRefResult(results, 'person', selected);
    }
  }

  private getPersonSearchFilter(
    person: {
      id: string;
      primaryProfile?: { type: 'user-person' | 'space-person'; id: string; spaceId?: string };
    },
    resolvedSpaceId?: string,
  ): Partial<AgentSearchAssetsFilters> {
    const profile = person.primaryProfile;
    if (resolvedSpaceId) {
      if (!profile || (profile.type === 'space-person' && (!profile.spaceId || profile.spaceId === resolvedSpaceId))) {
        return { spaceId: resolvedSpaceId, spacePersonIds: [profile?.id ?? person.id] };
      }

      return {};
    }

    if (!profile || profile.type === 'user-person') {
      return { personIds: [profile?.id ?? person.id] };
    }

    if (profile.type === 'space-person' && profile.spaceId) {
      return { spaceId: profile.spaceId, spacePersonIds: [profile.id] };
    }

    return {};
  }

  private mergeResolvedPersonFilter(
    resolvedFilters: AgentSearchAssetsFilters,
    searchFilter: Partial<AgentSearchAssetsFilters> | undefined,
  ) {
    if (!searchFilter) {
      return;
    }

    if (searchFilter.spaceId && searchFilter.spacePersonIds?.length) {
      resolvedFilters.spaceId = searchFilter.spaceId;
      resolvedFilters.spacePersonIds = [
        ...new Set([...(resolvedFilters.spacePersonIds ?? []), ...searchFilter.spacePersonIds]),
      ];
      return;
    }

    if (searchFilter.personIds?.length) {
      resolvedFilters.personIds = [...new Set([...(resolvedFilters.personIds ?? []), ...searchFilter.personIds])];
    }
  }

  private resolveIdFilters(
    results: AgentResolvedAssetSearchFilterResult[],
    resolvedFilters: AgentSearchAssetsFilters,
    kind: Extract<AgentResolvedAssetSearchFilterKind, 'person' | 'tag' | 'album'>,
    queries: string[],
    candidates: Array<{ id: string; value: string }>,
    filterKey: 'personIds' | 'tagIds' | 'albumIds',
    sessionId: string,
    choiceRefs?: string[],
  ) {
    const selected = choiceRefs?.length ? this.toSelectedChoiceRefs(choiceRefs) : undefined;
    const deferredOrdinaryMatches: AgentResolvedAssetSearchFilterResult[] = [];

    for (const query of queries) {
      const matched = this.matchVisibleCandidates(
        candidates,
        query,
        kind,
        (candidate) => ({
          [filterKey]: [candidate.id],
        }),
        sessionId,
        selected,
      );
      if (selected && matched.selectionReplay === 'fallback') {
        deferredOrdinaryMatches.push(matched.result);
        continue;
      }

      if (matched.result.status === 'matched' && matched.result.id) {
        const ids = (matched.result.searchFilter?.[filterKey] as string[] | undefined) ?? [matched.result.id];
        resolvedFilters[filterKey] = [...new Set([...(resolvedFilters[filterKey] ?? []), ...ids])];
      }
      results.push(matched.result);
    }

    if (selected) {
      if (selected.consumed.size > 0) {
        for (const matched of deferredOrdinaryMatches) {
          if (matched.status === 'matched' && matched.id) {
            const ids = (matched.searchFilter?.[filterKey] as string[] | undefined) ?? [matched.id];
            resolvedFilters[filterKey] = [...new Set([...(resolvedFilters[filterKey] ?? []), ...ids])];
          }
          results.push(matched);
        }
      }
      this.appendUnconsumedChoiceRefResult(results, kind, selected);
    }
  }

  private matchVisibleCandidates<T extends { id?: string; value: string }>(
    candidates: T[],
    query: string,
    kind: AgentResolvedAssetSearchFilterKind,
    getSearchFilter: (candidate: T) => Partial<AgentSearchAssetsFilters>,
    sessionId: string,
    selected?: SelectedChoiceRefs,
  ): { result: AgentResolvedAssetSearchFilterResult; selectionReplay?: 'matched' | 'fallback' } {
    const exactMatches = candidates.filter((candidate) => this.isExactMatch(candidate.value, query));
    if (selected) {
      const choices = this.getReplayableChoices(candidates, exactMatches, query, kind, getSearchFilter, sessionId);
      const matchedChoices = choices.filter((choice) => choice.choiceRef && selected.all.has(choice.choiceRef));
      if (matchedChoices.length > 0) {
        for (const choice of matchedChoices) {
          if (choice.choiceRef) {
            selected.consumed.add(choice.choiceRef);
          }
        }

        return {
          selectionReplay: 'matched',
          result: {
            kind,
            query,
            status: 'matched',
            id: matchedChoices[0].id,
            value: matchedChoices[0].value,
            searchFilter: this.mergeChoiceSearchFilters(matchedChoices.map((choice) => choice.searchFilter ?? {})),
            choices: [],
            message: `Matched selected ${kind} choice "${query}"`,
          },
        };
      }
    }

    if (exactMatches.length === 1) {
      const candidate = exactMatches[0];
      return {
        ...(selected ? { selectionReplay: 'fallback' as const } : {}),
        result: {
          kind,
          query,
          status: 'matched',
          id: candidate.id,
          value: candidate.value,
          searchFilter: getSearchFilter(candidate),
          choices: [],
          message: `Matched ${kind} "${query}"`,
        },
      };
    }

    if (exactMatches.length > 1) {
      return {
        ...(selected ? { selectionReplay: 'fallback' as const } : {}),
        result: {
          kind,
          query,
          status: 'ambiguous',
          choices: this.toChoiceRefs(exactMatches, kind, getSearchFilter, sessionId, query),
          message: `Multiple visible ${kind} matches found`,
        },
      };
    }

    return {
      ...(selected ? { selectionReplay: 'fallback' as const } : {}),
      result: {
        kind,
        query,
        status: 'not_found',
        choices: this.toChoiceRefs(
          this.getNotFoundSuggestionCandidates(candidates, query).slice(0, 5),
          kind,
          getSearchFilter,
          sessionId,
          query,
        ),
        message: `No visible ${kind} match found`,
      },
    };
  }

  private getReplayableChoices<T extends { id?: string; value: string }>(
    candidates: T[],
    exactMatches: T[],
    query: string,
    kind: AgentResolvedAssetSearchFilterKind,
    getSearchFilter: (candidate: T) => Partial<AgentSearchAssetsFilters>,
    sessionId: string,
  ): AgentResolvedAssetSearchFilterChoice[] {
    const replayableCandidates =
      exactMatches.length > 0 ? exactMatches : this.getNotFoundSuggestionCandidates(candidates, query).slice(0, 5);
    return this.toChoiceRefs(replayableCandidates, kind, getSearchFilter, sessionId, query);
  }

  private toChoiceRefs<T extends { id?: string; value: string }>(
    candidates: T[],
    kind: AgentResolvedAssetSearchFilterKind,
    getSearchFilter: (candidate: T) => Partial<AgentSearchAssetsFilters>,
    sessionId: string,
    query: string,
  ): AgentResolvedAssetSearchFilterChoice[] {
    return candidates.flatMap((candidate) => {
      const searchFilter = getSearchFilter(candidate);
      return this.hasSearchFilter(searchFilter)
        ? [this.choiceForIdCandidate(candidate, kind, searchFilter, sessionId, query)]
        : [];
    });
  }

  private toSelectedChoiceRefs(choiceRefs: string[]): SelectedChoiceRefs {
    return {
      all: new Set(choiceRefs),
      consumed: new Set<string>(),
    };
  }

  private appendUnconsumedChoiceRefResult(
    results: AgentResolvedAssetSearchFilterResult[],
    kind: AgentResolvedAssetSearchFilterKind,
    selected: SelectedChoiceRefs,
  ): void {
    const unconsumed = [...selected.all].filter((choiceRef) => !selected.consumed.has(choiceRef));
    if (unconsumed.length === 0) {
      return;
    }

    results.push({
      kind,
      query: unconsumed.join(', '),
      status: 'not_found',
      choices: [],
      message: `Selected ${kind} choice is no longer available; choose again`,
    });
  }

  private hasSearchFilter(searchFilter: Partial<AgentSearchAssetsFilters>): boolean {
    return Object.keys(searchFilter).length > 0;
  }

  private getNotFoundSuggestionCandidates<T extends { value: string }>(candidates: T[], query: string): T[] {
    const normalizedQuery = this.normalizeResolverTerm(query);
    const related = candidates.filter((candidate) => {
      const normalizedCandidate = this.normalizeResolverTerm(candidate.value);
      return normalizedCandidate.includes(normalizedQuery) || normalizedQuery.includes(normalizedCandidate);
    });
    return related.length > 0 ? related : candidates;
  }

  private choiceForIdCandidate<T extends { id?: string; value: string }>(
    candidate: T,
    kind: AgentResolvedAssetSearchFilterKind,
    searchFilter: Partial<AgentSearchAssetsFilters>,
    sessionId?: string,
    query?: string,
  ): AgentResolvedAssetSearchFilterChoice {
    return {
      ...(candidate.id ? { id: candidate.id } : {}),
      ...(sessionId && query
        ? { choiceRef: this.buildChoiceRef(sessionId, kind, query, candidate, searchFilter) }
        : {}),
      value: candidate.value,
      label: candidate.value,
      searchFilter,
    };
  }

  private async resolveDeclarativeToolFilters(
    auth: AuthDto,
    session: AgentSession,
    request: AgentResolveAssetSearchFiltersToolRequestDto,
    filters: AgentDeclarativeAssetFilters,
  ): Promise<{
    resolvedFilters: AgentSearchAssetsFilters;
    results: AgentResolvedAssetSearchFilterResult[];
  }> {
    const selected = {
      people: filters.people?.choiceRefs,
      tags: filters.tags?.choiceRefs,
      albums: filters.albums?.choiceRefs,
    };
    if (!selected.people?.length && !selected.tags?.length && !selected.albums?.length) {
      return this.resolveToolFilters(auth, session, request);
    }

    return this.resolveToolFiltersWithSelectedChoices(auth, session, request, selected);
  }

  private async resolveToolFiltersWithSelectedChoices(
    auth: AuthDto,
    session: AgentSession,
    request: AgentResolveAssetSearchFiltersToolRequestDto,
    selected: { people?: string[]; tags?: string[]; albums?: string[] },
  ): Promise<{
    resolvedFilters: AgentSearchAssetsFilters;
    results: AgentResolvedAssetSearchFilterResult[];
  }> {
    const result = await this.resolveToolFilters(auth, session, {
      ...request,
      people: selected.people?.length ? undefined : request.people,
      tags: selected.tags?.length ? undefined : request.tags,
      albums: selected.albums?.length ? undefined : request.albums,
    });
    const resolvedFilters = result.resolvedFilters;
    const results = [...result.results];
    const repositoryScope = resolvedFilters.spaceId ? { spaceId: resolvedFilters.spaceId } : (request.scope ?? {});
    const canUseRepositoryCandidates = this.canUseResolverRepositoryCandidates(session, repositoryScope);
    const suggestions =
      (selected.people?.length || selected.tags?.length) && canUseRepositoryCandidates
        ? await this.searchRepository.getFilterSuggestions([auth.user.id], repositoryScope)
        : null;

    if (selected.people?.length && request.people?.length) {
      this.resolvePersonFilters(
        results,
        resolvedFilters,
        request.people,
        suggestions?.people ?? [],
        session.id,
        selected.people,
      );
    }

    if (selected.tags?.length && request.tags?.length) {
      this.resolveIdFilters(
        results,
        resolvedFilters,
        'tag',
        request.tags,
        suggestions?.tags.map((tag) => ({ id: tag.id, value: tag.value })) ?? [],
        'tagIds',
        session.id,
        selected.tags,
      );
    }

    if (selected.albums?.length && request.albums?.length) {
      const visibleAlbums = await this.albumRepository.getAgentAlbums(auth.user.id);
      const albums = visibleAlbums
        .filter((album) => {
          const isOwned = album.ownerId === auth.user.id;
          return isOwned
            ? session.permissionPlanSnapshot.assetScope.owned
            : session.permissionPlanSnapshot.assetScope.sharedSpaces;
        })
        .map((album) => ({ id: album.id, value: album.albumName }));
      this.resolveIdFilters(
        results,
        resolvedFilters,
        'album',
        request.albums,
        albums,
        'albumIds',
        session.id,
        selected.albums,
      );
    }

    return { resolvedFilters, results };
  }

  private mergeChoiceSearchFilters(
    searchFilters: Array<Partial<AgentSearchAssetsFilters>>,
  ): Partial<AgentSearchAssetsFilters> {
    const merged: Partial<AgentSearchAssetsFilters> = {};
    for (const searchFilter of searchFilters) {
      for (const [key, value] of Object.entries(searchFilter)) {
        if (Array.isArray(value)) {
          const existing = (merged as Record<string, unknown[]>)[key] ?? [];
          (merged as Record<string, unknown[]>)[key] = [...new Set([...existing, ...value])];
        } else if (value !== undefined) {
          (merged as Record<string, unknown>)[key] = value;
        }
      }
    }
    return merged;
  }

  private buildChoiceRef(
    sessionId: string,
    kind: AgentResolvedAssetSearchFilterKind,
    query: string,
    candidate: { id?: string; value: string },
    searchFilter: Partial<AgentSearchAssetsFilters>,
  ): string {
    const token = createHash('sha256')
      .update(
        JSON.stringify({
          sessionId,
          kind,
          query: this.normalizeResolverTerm(query),
          candidateId: candidate.id ?? '',
          candidateValue: candidate.value,
          searchFilter: this.sortObject(searchFilter),
        }),
      )
      .digest('base64url')
      .slice(0, 22);
    return `choice:${kind}:${token}`;
  }

  private sortObject(value: unknown): unknown {
    if (Array.isArray(value)) {
      return value.map((item) => this.sortObject(item));
    }
    if (!value || typeof value !== 'object') {
      return value;
    }
    return Object.fromEntries(
      Object.entries(value)
        .toSorted(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, this.sortObject(item)]),
    );
  }

  private isExactMatch(candidate: string, query: string): boolean {
    return this.normalizeResolverTerm(candidate) === this.normalizeResolverTerm(query);
  }

  private normalizeResolverTerm(term: string): string {
    return term.trim().toLocaleLowerCase();
  }
}
