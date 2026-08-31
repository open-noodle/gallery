// Gallery-fork: family relationships. Repository-touching graph construction, split out of
// `FamilyService` so a DIFFERENT service (currently `PersonService`, for `familyRelationLabel`)
// can build the SAME viewer-projected graph and call the SAME label engine, without one service
// depending on another — this codebase shares REPOSITORIES across services via `BaseService`,
// never services themselves. `FamilyService` itself is a thin wrapper over these functions, so
// there is exactly one graph-building routine for the whole feature, not two that could drift.
//
// Every export here takes its repositories as a plain object rather than as `this` from a
// specific class, so any `BaseService` subclass can call it with `this` directly (it already has
// `familyRepository`/`faceIdentityRepository`/`userRepository` injected).
import { FamilyAccessLevel, UserMetadataKey } from 'src/enum';
import { FaceIdentityRepository } from 'src/repositories/face-identity.repository';
import { FamilyRepository, RawUnionRow, VisibleUnion } from 'src/repositories/family.repository';
import { UserRepository } from 'src/repositories/user.repository';
import { UserMetadataItem } from 'src/types';
import {
  deriveRelationLabel,
  FamilyGender,
  FamilyUnionStatus,
  ProjectedFamilyGraph,
  ProjectedFamilyIdentity,
  ProjectedFamilyParticipant,
  ProjectedFamilyUnion,
} from 'src/utils/family-labels';

export interface FamilyAccessRepositories {
  familyRepository: Pick<FamilyRepository, 'getAccess'>;
}

export interface FamilyGraphRepositories {
  familyRepository: Pick<FamilyRepository, 'getAllUnionsWithParticipants' | 'getGenders' | 'computeVisibleUnions'>;
  faceIdentityRepository: Pick<FaceIdentityRepository, 'resolveAccessibleIdentityNames'>;
}

export interface FamilyRootRepositories {
  userRepository: Pick<UserRepository, 'getMetadata'>;
}

export type FamilyLabelRepositories = FamilyAccessRepositories & FamilyGraphRepositories & FamilyRootRepositories;

type VisibilityParticipant = VisibleUnion['partners'][number];

const toProjectedParticipant = (seat: VisibilityParticipant): ProjectedFamilyParticipant =>
  'identityId' in seat ? { kind: 'known', identityId: seat.identityId } : { kind: 'anonymous' };

// face_identity.gender is a free-form nullable varchar; family-labels.ts only ever wants the two
// terms it knows a wording for. Anything else (never written today, but not schema-enforced)
// falls back to the neutral term, same as unset.
const normalizeGender = (value: string | null | undefined): FamilyGender =>
  value === 'male' || value === 'female' ? value : null;

/** A resolved identity's name and gender, keyed by identity id — the per-viewer product of D3's
 * redaction: an identity appears here iff the viewer can resolve it. */
export type ResolvedFamilyIdentities = Map<string, { name: string; gender: FamilyGender }>;

/**
 * Resolves visibility (D3) for one viewer: every union in the instance, redacted to what this
 * user can resolve (>= 2 resolvable participants), plus the resolved name/gender for every
 * identity that turned out resolvable. Shared by `buildFamilyGraph` (below) and
 * `FamilyService.getClusters`, which needs the raw `VisibleUnion[]` shape (for
 * `computeClusters`) rather than the public `ProjectedFamilyGraph`.
 */
export async function resolveFamilyVisibility(
  repos: FamilyGraphRepositories,
  userId: string,
): Promise<{ resolved: ResolvedFamilyIdentities; visibleUnions: VisibleUnion[] }> {
  const allUnions: RawUnionRow[] = await repos.familyRepository.getAllUnionsWithParticipants();
  if (allUnions.length === 0) {
    return { resolved: new Map(), visibleUnions: [] };
  }

  const candidateIds = [...new Set(allUnions.flatMap((union) => [...union.partnerIds, ...union.childIds]))];

  // The single reused resolution (`face-identity.repository.ts`) — one query for every
  // participant across every union in the graph, never one per union (`E65`). A hidden profile
  // never comes back here (`withHidden: false`), which is what makes it unresolvable (`E33`).
  const names = await repos.faceIdentityRepository.resolveAccessibleIdentityNames({
    userId,
    identityIds: candidateIds,
    withHidden: false,
  });

  const genders = await repos.familyRepository.getGenders(names.keys().toArray());

  const resolved: ResolvedFamilyIdentities = new Map(
    [...names].map(([identityId, name]) => [identityId, { name, gender: normalizeGender(genders.get(identityId)) }]),
  );

  const visibleUnions = repos.familyRepository.computeVisibleUnions(allUnions, new Set(resolved.keys()));

  return { resolved, visibleUnions };
}

/**
 * The viewer-projected family graph (D3): every union this user can see, with everyone else
 * reduced to an anonymous seat, and only the identities that actually appear as a known seat in
 * one of those unions. THE single graph-building routine for the whole feature — every consumer
 * that needs to label a person relative to a viewer (or relative to another identity, for a
 * person's own relations) must call this, never re-derive visibility itself.
 */
export async function buildFamilyGraph(repos: FamilyGraphRepositories, userId: string): Promise<ProjectedFamilyGraph> {
  const { resolved, visibleUnions } = await resolveFamilyVisibility(repos, userId);

  const unions: ProjectedFamilyUnion[] = visibleUnions.map((union) => ({
    id: union.id,
    status: union.status as FamilyUnionStatus,
    startDate: union.startDate,
    endDate: union.endDate,
    partners: union.partners.map((seat) => toProjectedParticipant(seat)),
    children: union.children.map((seat) => toProjectedParticipant(seat)),
  }));

  const identities: Record<string, ProjectedFamilyIdentity> = {};
  for (const union of unions) {
    for (const participant of [...union.partners, ...union.children]) {
      if (participant.kind !== 'known' || identities[participant.identityId]) {
        continue;
      }
      const info = resolved.get(participant.identityId);
      if (info) {
        identities[participant.identityId] = { name: info.name, gender: info.gender };
      }
    }
  }

  return { identities, unions };
}

/** Whether the feature is enabled and, if so, what level a user without an explicit grant gets. */
export interface FamilyTreeAccessConfig {
  enabled: boolean;
  defaultAccess: string;
}

/** Same rule `FamilyService.resolveFamilyAccess` enforces: disabled -> `none`; otherwise the
 * user's explicit grant, or the instance default if they have none. */
export async function resolveFamilyAccessLevel(
  repos: FamilyAccessRepositories,
  config: FamilyTreeAccessConfig,
  userId: string,
): Promise<FamilyAccessLevel> {
  if (!config.enabled) {
    return FamilyAccessLevel.None;
  }

  const row = await repos.familyRepository.getAccess(userId);
  return (row?.level ?? config.defaultAccess) as FamilyAccessLevel;
}

/** The identity a user nominated as themselves (D4), or null if never set. No access check —
 * callers that need `view` enforced (the `/family/me` endpoints) check separately; callers that
 * only conditionally attach a label (`resolveFamilyLabelSet` below) do not need to. */
export async function resolveFamilyRootId(repos: FamilyRootRepositories, userId: string): Promise<string | null> {
  const metadata = await repos.userRepository.getMetadata(userId);
  const entry = metadata.find(
    (item): item is UserMetadataItem<UserMetadataKey.FamilyRoot> => item.key === UserMetadataKey.FamilyRoot,
  );

  return entry?.value.identityId ?? null;
}

export interface FamilyLabelSet {
  readonly level: FamilyAccessLevel;
  /** The projected graph this label set was built from — exposed for a caller that also needs
   * the raw graph (e.g. to derive OTHER people's relations from it), so it never has to build a
   * second one. */
  readonly graph: ProjectedFamilyGraph;
  /** `null` for an identity the viewer cannot resolve, has no root set, or has no path to. */
  label(identityId: string | null | undefined): string | null;
}

/**
 * The single entry point for attaching a `familyRelationLabel` to a person from a service OTHER
 * than `FamilyService` — currently `PersonService`. Loads the projected graph and the viewer's
 * root AT MOST once (nothing at all when access is `none`); call this ONCE PER REQUEST and reuse
 * the returned `.label()` for every person in that response — never call it once per person, or
 * a "many people" response turns into a graph walk per row.
 *
 * Unlike `FamilyService.requireFamilyRead`, this never throws: a caller with `none` access gets a
 * label set whose `.label()` always returns `null`, so `PersonResponseDto.familyRelationLabel`
 * can be omitted from the response entirely (the caller's job, based on `.level`) rather than the
 * whole request failing.
 */
export async function resolveFamilyLabelSet(
  repos: FamilyLabelRepositories,
  config: FamilyTreeAccessConfig,
  userId: string,
): Promise<FamilyLabelSet> {
  const level = await resolveFamilyAccessLevel(repos, config, userId);
  if (level === FamilyAccessLevel.None) {
    return { level, graph: { identities: {}, unions: [] }, label: () => null };
  }

  const [graph, rootId] = await Promise.all([buildFamilyGraph(repos, userId), resolveFamilyRootId(repos, userId)]);

  return {
    level,
    graph,
    label: (identityId) => (identityId ? deriveRelationLabel(graph, rootId, identityId) : null),
  };
}
