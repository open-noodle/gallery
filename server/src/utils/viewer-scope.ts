// Fork-only: the ONE place that answers "what may this viewer see on this surface?" — the viewer's
// timeline spaces, what they hid from their own timeline (#1041), the locked-visibility default and
// how person-filter tokens resolve. Services ask once per request with the surface they serve; every
// per-surface difference is a row in `surfaceRule` below, not a comment at a call site. Sits above
// `shared-space-album-scope.ts`, which turns these ids into SQL.
import { Kysely, Transaction } from 'kysely';
import { AuthDto } from 'src/dtos/auth.dto.js';
import { AssetVisibility } from 'src/enum.js';
import { FaceIdentityRepository } from 'src/repositories/face-identity.repository.js';
import { SharedSpaceRepository } from 'src/repositories/shared-space.repository.js';
import { DB } from 'src/schema/index.js';
import { TimelineHiddenScope, timelineHiddenScopeIsEmpty } from 'src/utils/shared-space-album-scope.js';

/**
 * - `timeline`: time buckets (personal timeline, Trash/Archive/Favorites, album and space browse) and
 *   the hide previews' own-timeline count.
 * - `search`: metadata/smart search, statistics, random, large assets, suggestions, explore.
 * - `map`: the plain `/map/markers` endpoint.
 * - `filtered-map`: the filtered map markers endpoint (`/gallery/map/markers`).
 * - `memories`, `folders`: the memory lane and the folder view.
 */
export type ViewerSurface = 'timeline' | 'search' | 'map' | 'filtered-map' | 'memories' | 'folders';

export type ViewerScopeRequest = {
  userId?: string;
  withSharedSpaces?: boolean;
  withSharedAlbums?: boolean;
  albumId?: string;
  albumIds?: string[];
  spaceId?: string;
  personIds?: string[];
  spacePersonIds?: string[];
  visibility?: AssetVisibility;
  isFavorite?: boolean;
  isTrashed?: boolean;
  /**
   * Search only (#763): resolve every space the viewer belongs to instead of their timeline spaces. A
   * favourite-filtered query narrows to the viewer's own `asset_favorite` rows, so a favourite placed in a
   * space hidden from the home timeline stays findable. Never set it for an unfiltered browse.
   */
  favoriteScoped?: boolean;
  /** Search only (#763): also return `favoriteSpaceIds`, for the hasFavorites facet. */
  withFavoriteSpaces?: boolean;
};

export type ViewerScope = {
  /** The viewer's timeline spaces this query is widened to; `undefined` when not widening (or none). */
  timelineSpaceIds?: string[];
  /**
   * #763: every space the viewer belongs to, for the hasFavorites facet only, on a `withSharedSpaces`
   * request that asked for it. The other facets stay on `timelineSpaceIds`: widening those would pull a
   * hidden space's cities/tags/people back into the panel, but "is the Favourites section worth offering"
   * has to span the same spaces the favourites filter itself searches.
   */
  favoriteSpaceIds?: string[];
  /** What the viewer hid from their own timeline — only on surfaces that subtract it. */
  hiddenScope?: TimelineHiddenScope;
  /** The viewer's visible spaces, for the "another visible path re-admits this photo" rescue. */
  visibleSpaceIds?: string[];
  /** Search only: an unset visibility defaults to `not-locked` unless the session is elevated. */
  visibility?: AssetVisibility | 'not-locked';
  personIds?: string[];
  spacePersonIds?: string[];
  identityIds?: string[];
  forceEmptyResult?: boolean;
};

type SurfaceRule = {
  /** Widen the query to the viewer's timeline spaces (`ViewerScope.timelineSpaceIds`). */
  widen: boolean;
  /** #763: the spaces are every space the viewer belongs to, not only their timeline spaces. */
  memberSpaces?: boolean;
  /** Bare person ids are the viewer's own people and space-person tokens must be in a timeline space. */
  sharedPeople: boolean;
  /** Person-token resolution sees the viewer's timeline spaces. */
  peopleSeeSpaces: boolean;
  /** `personal`: subtract the hidden scope on a personal-timeline browse. `always`: on every request. */
  hidden?: 'personal' | 'always';
  /** Default an unset visibility to `not-locked` unless the session is elevated. */
  notLockedDefault?: boolean;
};

const surfaceRule = (surface: ViewerSurface, request: ViewerScopeRequest): SurfaceRule => {
  const withSharedSpaces = !!request.withSharedSpaces;
  switch (surface) {
    case 'timeline': {
      // Space ids only on a per-user browse: an album or space browse states its own scope.
      const widen = !!request.userId && withSharedSpaces;
      // #763: an `isFavorite: true` browse is scoped by the viewer's own favourites, so it spans every
      // space they belong to, including ones hidden from the home timeline: `showInTimeline` is a
      // preference about this timeline, not about whether their own explicit favourite still counts.
      return {
        widen,
        memberSpaces: request.isFavorite === true,
        sharedPeople: withSharedSpaces,
        peopleSeeSpaces: widen,
        hidden: 'personal',
      };
    }
    case 'search': {
      // An album scope counts as shared: its members' photos are in it.
      const shared = withSharedSpaces || !!request.albumId || !!request.albumIds?.length;
      return {
        widen: shared,
        memberSpaces: !!request.favoriteScoped,
        sharedPeople: shared,
        peopleSeeSpaces: shared,
        notLockedDefault: true,
      };
    }
    case 'map': {
      // #763: favourites are a per-viewer overlay, so a favourites query widens like any other: a
      // member's favourite inside a space is theirs, not the asset owner's flag.
      const widen = withSharedSpaces || !!request.withSharedAlbums;
      return { widen, sharedPeople: false, peopleSeeSpaces: false };
    }
    case 'filtered-map': {
      // Widening and person tokens want the spaces under DIFFERENT conditions, so they are two fields:
      // a space-scoped query is never widened, but `space-person:` tokens still need the viewer's spaces
      // or they resolve as inaccessible and silently empty the map — the albumId bug of 00a7fd6bac and
      // the isFavorite one after it. Do not fold `peopleSeeSpaces` into `widen`. #763: a favourites query
      // widens like any other, since favourites are a per-viewer overlay.
      const widen = !request.spaceId && withSharedSpaces;
      return { widen, sharedPeople: withSharedSpaces, peopleSeeSpaces: withSharedSpaces };
    }
    case 'memories':
    case 'folders': {
      // Always both: memories have no sibling visible-path arm, so the rescue is inline
      // (TimelineRescue); the folder view's space arm is restricted to the visible spaces, or a hidden
      // space's directly-added assets would resurface through it (#1041 §3).
      return { widen: false, sharedPeople: false, peopleSeeSpaces: false, hidden: 'always' };
    }
  }
};

/**
 * #1041 §4: the subtraction is a PERSONAL TIMELINE rule. Trash, Archive and Favorites reach the
 * timeline too, but each is a recovery/curation surface where subtracting an owned asset makes it
 * unreachable from the UI (E2/E2b/E2c); Hidden/Locked are the caller's own private buckets. Written
 * as an exclusion list so a client that omits `visibility` still gets the hide (fails CLOSED, E2e).
 * Independent of `withSharedSpaces`, which is a merge switch, not a surface (E12).
 */
const isPersonalTimeline = (request: ViewerScopeRequest) =>
  !!request.userId &&
  !request.isTrashed &&
  request.isFavorite === undefined &&
  request.visibility !== AssetVisibility.Archive &&
  request.visibility !== AssetVisibility.Hidden &&
  request.visibility !== AssetVisibility.Locked;

/**
 * Only search carries a visibility default; every other surface leaves the caller's visibility alone.
 * Typed per surface so a surface's scope can be spread straight into its own options type.
 */
export type ViewerScopeFor<S extends ViewerSurface> = S extends 'search'
  ? ViewerScope
  : Omit<ViewerScope, 'visibility'>;

export type ViewerScopeArgs<S extends ViewerSurface = ViewerSurface> = [
  auth: AuthDto,
  surface: S,
  request?: ViewerScopeRequest,
  // #1041 slice 12: the hide previews re-resolve inside their rolled-back transaction.
  db?: Kysely<DB> | Transaction<DB>,
];

export const resolveViewerScope = async <S extends ViewerSurface>(
  repos: { sharedSpaceRepository: SharedSpaceRepository; faceIdentityRepository: FaceIdentityRepository },
  ...[auth, surface, request = {}, db]: ViewerScopeArgs<S>
): Promise<ViewerScopeFor<S>> => {
  const userId = auth.user.id;
  const rule = surfaceRule(surface, request);
  const tokens = request.personIds?.filter(Boolean) ?? [];
  const hasScopedTokens = tokens.some((token) => token.includes(':'));
  const resolvePeople = tokens.length > 0 && (rule.sharedPeople || hasScopedTokens);

  let spaceIds: string[] | undefined;
  let memberSpaceIds: string[] | undefined;
  const getMemberSpaceIds = async () => {
    if (!memberSpaceIds) {
      const rows = await repos.sharedSpaceRepository.getAllMemberSpaceIds(userId, db);
      memberSpaceIds = rows.map((row) => row.spaceId);
    }
    return memberSpaceIds;
  };
  const getSpaceIds = async () => {
    if (!spaceIds) {
      if (rule.memberSpaces) {
        spaceIds = await getMemberSpaceIds();
      } else {
        const rows = await repos.sharedSpaceRepository.getSpaceIdsForTimeline(userId, db);
        spaceIds = rows.map((row) => row.spaceId);
      }
    }
    return spaceIds;
  };

  const always = rule.hidden === 'always';
  const subtract = always || (rule.hidden === 'personal' && isPersonalTimeline(request));
  // Only a `space-person:` token is checked against the timeline spaces; bare ids never are.
  const needsSpaces = always || rule.widen || (rule.peopleSeeSpaces && hasScopedTokens);
  const [hiddenScope] = await Promise.all([
    subtract ? repos.sharedSpaceRepository.getTimelineHiddenScope(userId, db) : undefined,
    needsSpaces ? getSpaceIds() : undefined,
  ]);
  // §3's rescue needs the visible spaces even when this browse is not merging space content
  // (E12b/E12c). The timeline only looks them up for a caller who has actually hidden something.
  const visibleSpaceIds =
    always || (hiddenScope && !timelineHiddenScopeIsEmpty(hiddenScope)) ? await getSpaceIds() : undefined;

  const nonEmptySpaceIds = spaceIds?.length ? spaceIds : undefined;
  const scope: ViewerScope = {
    timelineSpaceIds: rule.widen ? nonEmptySpaceIds : undefined,
    hiddenScope,
    visibleSpaceIds,
    personIds: request.personIds,
    spacePersonIds: request.spacePersonIds,
  };

  if (surface === 'search' && request.withFavoriteSpaces && request.withSharedSpaces) {
    const ids = await getMemberSpaceIds();
    scope.favoriteSpaceIds = ids.length > 0 ? ids : undefined;
  }

  if (rule.notLockedDefault) {
    scope.visibility = request.visibility ?? (auth.session?.hasElevatedPermission ? undefined : 'not-locked');
  }

  if (resolvePeople) {
    const resolution = await repos.faceIdentityRepository.resolveScopedPersonTokens({
      userId,
      tokens,
      scope: {
        withSharedSpaces: rule.sharedPeople,
        timelineSpaceIds: rule.peopleSeeSpaces ? nonEmptySpaceIds : undefined,
        spaceId: request.spaceId,
      },
    });
    scope.personIds = resolution.legacyPersonIds;
    scope.identityIds = resolution.identityIds;
    scope.spacePersonIds = [...new Set([...(request.spacePersonIds ?? []), ...resolution.legacySpacePersonIds])];
    scope.forceEmptyResult = resolution.hasInaccessibleToken;
  }

  return scope as ViewerScopeFor<S>;
};
