import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { AuthDto } from 'src/dtos/auth.dto';
import { FamilyAccessLevel, UserMetadataKey } from 'src/enum';
import { RawUnionRow, VisibilityParticipant, VisibleUnion } from 'src/repositories/family.repository';
import { BaseService } from 'src/services/base.service';
import { asDateTimeString } from 'src/utils/date';
import {
  FamilyGender,
  FamilyUnionStatus,
  ProjectedFamilyGraph,
  ProjectedFamilyIdentity,
  ProjectedFamilyParticipant,
  ProjectedFamilyUnion,
} from 'src/utils/family-labels';

export type FamilyParticipantRole = 'partner' | 'child';

export interface CreateUnionDto {
  partnerIds?: string[];
  childIds?: string[];
  status?: string;
  startDate?: string | null;
  endDate?: string | null;
}

export interface UpdateUnionDto {
  status?: string;
  startDate?: string | null;
  endDate?: string | null;
}

export interface AddParticipantDto {
  identityId: string;
  role: FamilyParticipantRole;
}

export interface FamilyCluster {
  label: string;
  size: number;
  rootCandidateId: string;
}

// Slice 7: one row of the admin grants table. A user with no explicit grant simply has no row
// here — this never synthesizes one for the instance default, so the caller can tell "explicit
// none" apart from "inherits default" (D5.1's "two kinds of blank", applied to access).
export interface FamilyAccessGrant {
  userId: string;
  level: FamilyAccessLevel;
  grantedById: string | null;
  grantedAt: string;
}

/** A resolved identity's name and gender, keyed by identity id — the per-viewer product of
 * Slice 5's redaction: an identity appears here iff the viewer can resolve it (`D3`). */
type ResolvedIdentities = Map<string, { name: string; gender: FamilyGender }>;

const toProjectedParticipant = (seat: VisibilityParticipant): ProjectedFamilyParticipant =>
  'identityId' in seat ? { kind: 'known', identityId: seat.identityId } : { kind: 'anonymous' };

// face_identity.gender is a free-form nullable varchar; family-labels.ts only ever wants the two
// terms it knows a wording for. Anything else (never written today, but not schema-enforced)
// falls back to the neutral term, same as unset.
const normalizeGender = (value: string | null | undefined): FamilyGender =>
  value === 'male' || value === 'female' ? value : null;

// Gallery-fork: family relationships. Access comes from an admin-granted level, never from
// a shared-space role — this file must never reference spaces, membership or roles.
@Injectable()
export class FamilyService extends BaseService {
  async resolveFamilyAccess(auth: AuthDto): Promise<FamilyAccessLevel> {
    const { familyTree } = await this.getConfig({ withCache: false });
    if (!familyTree.enabled) {
      return FamilyAccessLevel.None;
    }

    const row = await this.familyRepository.getAccess(auth.user.id);
    return (row?.level ?? familyTree.defaultAccess) as FamilyAccessLevel;
  }

  async requireFamilyWrite(auth: AuthDto): Promise<void> {
    const level = await this.resolveFamilyAccess(auth);
    if (level !== FamilyAccessLevel.Contribute) {
      throw new ForbiddenException();
    }
  }

  // Read is the lower bar: 'view' or 'contribute' both qualify, only 'none' is refused. D2's
  // capability gate is independent of D3's content scoping below — a granted view-only user
  // still only sees what they can resolve.
  async requireFamilyRead(auth: AuthDto): Promise<void> {
    const level = await this.resolveFamilyAccess(auth);
    if (level === FamilyAccessLevel.None) {
      throw new ForbiddenException();
    }
  }

  // Slice 5 (D3): the read path. Returns every union the viewer can see — at least two
  // resolvable participants — with everyone else in it reduced to an anonymous seat (`E27`-`E34`).
  async getVisibleGraph(auth: AuthDto): Promise<ProjectedFamilyGraph> {
    await this.requireFamilyRead(auth);

    const { resolved, visibleUnions } = await this.buildVisibility(auth.user.id);

    const unions: ProjectedFamilyUnion[] = visibleUnions.map((union) => ({
      id: union.id,
      status: union.status as FamilyUnionStatus,
      partners: union.partners.map((seat) => toProjectedParticipant(seat)),
      children: union.children.map((seat) => toProjectedParticipant(seat)),
    }));

    // `identities` is scoped to identities that actually appear as a known seat in `unions` —
    // NOT every identity the viewer happens to resolve across the whole graph. An identity whose
    // only unions were all redacted away must not still surface here: nothing in this response
    // should exist that isn't backed by at least one visible union.
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

  // Slice 5 (D3/E63-E65): disconnected components over the SAME viewer-visible graph
  // `getVisibleGraph` returns — never the full graph, or a cluster would reveal a connection
  // through a union the viewer cannot see. Computed fresh every call; nothing is stored (`E64`).
  // A person who belongs to no union is simply never a node in this graph, so they appear in no
  // cluster (`E63`) without any special-casing.
  async getClusters(auth: AuthDto): Promise<FamilyCluster[]> {
    await this.requireFamilyRead(auth);

    const { resolved, visibleUnions } = await this.buildVisibility(auth.user.id);
    const rawClusters = this.familyRepository.computeClusters(visibleUnions);

    return rawClusters.map((cluster) => {
      // Deterministic, arbitrary tie-break — every visible union already guarantees at least two
      // resolvable participants, so `knownIds` is never empty here.
      const rootCandidateId = cluster.knownIds.toSorted()[0]!;
      return {
        rootCandidateId,
        size: cluster.size,
        label: resolved.get(rootCandidateId)?.name ?? '',
      };
    });
  }

  // Slice 7 (D4): stores which identity the caller means when a relative label says "your ...".
  // Requires only `view` — nominating yourself changes nothing anyone else can see, so it does
  // not need `contribute`. Stored as its own user-metadata key (never a `preferences` field) so
  // this never touches the shared preferences default/merge machinery. `null` clears it.
  async setMyRoot(auth: AuthDto, identityId: string | null): Promise<void> {
    await this.requireFamilyRead(auth);

    if (identityId !== null) {
      await this.assertPersonIdentity(identityId);
    }

    await this.userRepository.upsertMetadata(auth.user.id, {
      key: UserMetadataKey.FamilyRoot,
      value: { identityId },
    });
  }

  // Slice 7 (D4/E37/E38): gender requires `contribute`, not `view` — unlike the viewer's own
  // root, it is shared data that changes the label every OTHER viewer reads for this identity.
  async updateGender(auth: AuthDto, identityId: string, gender: FamilyGender): Promise<void> {
    await this.requireFamilyWrite(auth);
    await this.assertPersonIdentity(identityId);
    await this.familyRepository.setGender(identityId, gender);
  }

  // Slice 7: grant administration for every user on the instance. Deliberately NOT gated by
  // `requireFamilyRead`/`requireFamilyWrite` — the controller enforces `admin` instead, so an
  // admin with no family grant of their own can still administer everyone else's (D2, and the
  // spec's explicit "an admin with no grant must still be able to administer other people's").
  async getAllAccessGrants(): Promise<FamilyAccessGrant[]> {
    const rows = await this.familyRepository.getAllAccess();
    return rows.map((row) => ({
      userId: row.userId,
      level: row.level as FamilyAccessLevel,
      grantedById: row.grantedById,
      grantedAt: asDateTimeString(row.grantedAt),
    }));
  }

  async setAccessGrant(auth: AuthDto, userId: string, level: FamilyAccessLevel): Promise<FamilyAccessGrant> {
    const row = await this.familyRepository.setAccess(userId, level, auth.user.id);
    return {
      userId: row.userId,
      level: row.level as FamilyAccessLevel,
      grantedById: row.grantedById,
      grantedAt: asDateTimeString(row.grantedAt),
    };
  }

  // Pets are never part of the graph (E12), and that includes being nominated as a root or
  // having a gender recorded for family purposes — reused by both `setMyRoot` and
  // `updateGender` rather than duplicating the not-found/type check twice.
  private async assertPersonIdentity(identityId: string): Promise<void> {
    const type = await this.familyRepository.getIdentityType(identityId);
    if (!type) {
      throw new NotFoundException(`Identity ${identityId} not found`);
    }
    if (type !== 'person') {
      throw new BadRequestException('Pets cannot participate in family relationships');
    }
  }

  // Shared by getVisibleGraph and getClusters so the (potentially large) union graph is fetched
  // and every participant identity resolved exactly ONCE per request, not once per caller. Both
  // callers already required `requireFamilyRead`, so this never checks access itself.
  private async buildVisibility(
    userId: string,
  ): Promise<{ resolved: ResolvedIdentities; visibleUnions: VisibleUnion[] }> {
    const allUnions: RawUnionRow[] = await this.familyRepository.getAllUnionsWithParticipants();
    if (allUnions.length === 0) {
      return { resolved: new Map(), visibleUnions: [] };
    }

    const candidateIds = [...new Set(allUnions.flatMap((union) => [...union.partnerIds, ...union.childIds]))];

    // The single reused resolution (`face-identity.repository.ts`) — one query for every
    // participant across every union in the graph, never one per union (`E65`). A hidden profile
    // never comes back here (`withHidden: false`), which is what makes it unresolvable (`E33`).
    const names = await this.faceIdentityRepository.resolveAccessibleIdentityNames({
      userId,
      identityIds: candidateIds,
      withHidden: false,
    });

    const genders = await this.familyRepository.getGenders(names.keys().toArray());

    const resolved: ResolvedIdentities = new Map(
      [...names].map(([identityId, name]) => [identityId, { name, gender: normalizeGender(genders.get(identityId)) }]),
    );

    const visibleUnions = this.familyRepository.computeVisibleUnions(allUnions, new Set(resolved.keys()));

    return { resolved, visibleUnions };
  }

  // Authority comes from `requireFamilyWrite` alone (E21, E24, E25) — whoever created a union
  // is recorded for audit purposes only (`createdById`), and is never consulted for authority.
  // Any contributor may edit or delete any union.
  async createUnion(auth: AuthDto, dto: CreateUnionDto): Promise<{ id: string }> {
    await this.requireFamilyWrite(auth);

    const partnerIds = dto.partnerIds ?? [];
    const childIds = dto.childIds ?? [];
    const startDate = dto.startDate ?? null;
    const endDate = dto.endDate ?? null;

    this.validateDates(startDate, endDate);
    this.validateArity(partnerIds);
    this.validateDistinctPartners(partnerIds);
    this.validateNoRoleOverlap(partnerIds, childIds);
    await this.validateParticipantTypes([...partnerIds, ...childIds]);
    await this.validateNoCycles(partnerIds, childIds);

    const union = await this.familyRepository.createUnion({
      status: dto.status,
      startDate,
      endDate,
      createdById: auth.user.id,
      partnerIds,
      childIds,
    });

    return { id: union.id };
  }

  async updateUnion(auth: AuthDto, unionId: string, dto: UpdateUnionDto): Promise<void> {
    await this.requireFamilyWrite(auth);

    const union = await this.familyRepository.getUnion(unionId);
    if (!union) {
      throw new NotFoundException('Union not found');
    }

    const startDate = dto.startDate === undefined ? union.startDate : dto.startDate;
    const endDate = dto.endDate === undefined ? union.endDate : dto.endDate;
    this.validateDates(startDate, endDate);

    const values: UpdateUnionDto = {};
    if (dto.status !== undefined) {
      values.status = dto.status;
    }
    if (dto.startDate !== undefined) {
      values.startDate = dto.startDate;
    }
    if (dto.endDate !== undefined) {
      values.endDate = dto.endDate;
    }

    await this.familyRepository.updateUnion(unionId, values);
  }

  async deleteUnion(auth: AuthDto, unionId: string): Promise<void> {
    await this.requireFamilyWrite(auth);

    const union = await this.familyRepository.getUnion(unionId);
    if (!union) {
      throw new NotFoundException('Union not found');
    }

    await this.familyRepository.deleteUnion(unionId);
  }

  async addParticipant(auth: AuthDto, unionId: string, dto: AddParticipantDto): Promise<void> {
    await this.requireFamilyWrite(auth);

    const union = await this.familyRepository.getUnion(unionId);
    if (!union) {
      throw new NotFoundException('Union not found');
    }

    await this.validateParticipantTypes([dto.identityId]);

    const [partnerIds, childIds] = await Promise.all([
      this.familyRepository.getPartnerIds(unionId),
      this.familyRepository.getChildIds(unionId),
    ]);

    if (dto.role === 'partner') {
      if (childIds.includes(dto.identityId)) {
        throw new BadRequestException('A person cannot be both a partner and a child of the same union');
      }
      if (partnerIds.includes(dto.identityId)) {
        throw new BadRequestException('A person cannot be their own partner');
      }
      if (partnerIds.length + 1 > 2) {
        throw new BadRequestException('A union may have at most two partners');
      }

      for (const childId of childIds) {
        if (await this.familyRepository.isAncestor(childId, dto.identityId)) {
          throw new BadRequestException('This would create a cycle in the family graph');
        }
      }

      await this.familyRepository.addPartner(unionId, dto.identityId);
      return;
    }

    if (partnerIds.includes(dto.identityId)) {
      throw new BadRequestException('A person cannot be both a partner and a child of the same union');
    }

    for (const partnerId of partnerIds) {
      if (await this.familyRepository.isAncestor(dto.identityId, partnerId)) {
        throw new BadRequestException('This would create a cycle in the family graph');
      }
    }

    await this.familyRepository.addChild(unionId, dto.identityId);
  }

  async removeParticipant(auth: AuthDto, unionId: string, identityId: string): Promise<void> {
    await this.requireFamilyWrite(auth);

    const union = await this.familyRepository.getUnion(unionId);
    if (!union) {
      throw new NotFoundException('Union not found');
    }

    await this.familyRepository.removeParticipant(unionId, identityId);
  }

  private validateDates(startDate: string | null, endDate: string | null): void {
    if (startDate && endDate && endDate < startDate) {
      throw new BadRequestException('endDate cannot be earlier than startDate');
    }
  }

  private validateArity(partnerIds: string[]): void {
    if (partnerIds.length > 2) {
      throw new BadRequestException('A union may have at most two partners');
    }
  }

  private validateDistinctPartners(partnerIds: string[]): void {
    if (partnerIds.length === 2 && partnerIds[0] === partnerIds[1]) {
      throw new BadRequestException('A person cannot be their own partner');
    }
  }

  private validateNoRoleOverlap(partnerIds: string[], childIds: string[]): void {
    const partnerSet = new Set(partnerIds);
    for (const childId of childIds) {
      if (partnerSet.has(childId)) {
        throw new BadRequestException('A person cannot be both a partner and a child of the same union');
      }
    }
  }

  // Pets are never in the graph (E12): every participant must resolve to a `person`
  // face_identity, never a `pet` one.
  private async validateParticipantTypes(identityIds: string[]): Promise<void> {
    for (const identityId of new Set(identityIds)) {
      const type = await this.familyRepository.getIdentityType(identityId);
      if (!type) {
        throw new NotFoundException(`Identity ${identityId} not found`);
      }
      if (type !== 'person') {
        throw new BadRequestException('Pets cannot participate in family relationships');
      }
    }
  }

  // Rejects any (partner, child) pair that would close a cycle. `isAncestor` walks the whole
  // chain — see FamilyRepository.isAncestor — so this catches both a direct cycle (E7) and one
  // that only closes several generations up (E8).
  private async validateNoCycles(partnerIds: string[], childIds: string[]): Promise<void> {
    for (const partnerId of partnerIds) {
      for (const childId of childIds) {
        if (await this.familyRepository.isAncestor(childId, partnerId)) {
          throw new BadRequestException('This would create a cycle in the family graph');
        }
      }
    }
  }
}
