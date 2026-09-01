import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { AuthDto } from 'src/dtos/auth.dto';
import { PersonResponseDto } from 'src/dtos/person.dto';
import { CacheControl, FamilyAccessLevel, Permission, UserMetadataKey } from 'src/enum';
import { BaseService } from 'src/services/base.service';
import { asDateTimeString } from 'src/utils/date';
import {
  buildFamilyGraph,
  FamilyLabelRepositories,
  resolveFamilyAccessLevel,
  resolveFamilyRootId,
  resolveFamilyVisibility,
} from 'src/utils/family-graph';
import { deriveDirectRelations, FamilyGender, ProjectedFamilyGraph } from 'src/utils/family-labels';
import { ImmichMediaResponse } from 'src/utils/file';
import { mimeTypes } from 'src/utils/mime-types';

export type FamilyParticipantRole = 'partner' | 'child';

export interface CreateUnionDto {
  partnerIds?: string[];
  childIds?: string[];
  // Person-id forms for clients that never see an identity id — see `FamilyUnionCreateDto`.
  partnerPersonIds?: string[];
  childPersonIds?: string[];
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
  // Exactly one of these — the DTO schema enforces it. `personId` is what a people picker has.
  identityId?: string;
  personId?: string;
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

// Slice 7 (new): one relation from a person's OWN relations panel — see
// `FamilyService.getPersonRelations`. `person` is `null` for a participant the viewer cannot
// resolve, in which case `anonymousSlot` carries the opaque per-union index instead — never an
// identity id.
export interface FamilyPersonRelation {
  person: PersonResponseDto | null;
  anonymousSlot: number | null;
  relation: string;
}

// Gallery-fork: family relationships. Access comes from an admin-granted level, never from
// a shared-space role — this file must never reference spaces, membership or roles.
@Injectable()
export class FamilyService extends BaseService {
  // Graph construction and access resolution live in `src/utils/family-graph.ts` — plain
  // functions over a repositories object, not methods here — so `PersonService` can build the
  // SAME projected graph and call the SAME label engine for `familyRelationLabel` without
  // depending on this service (this codebase shares repositories across services via
  // `BaseService`, never services themselves). These methods are thin wrappers that add the
  // access-enforcement (`requireFamilyRead`) this service is responsible for.
  //
  // `this.familyRepository`/etc. are `protected` (from `BaseService`), so TS refuses to widen
  // `this` itself to the (structurally public) `FamilyLabelRepositories` shape — this object
  // literal is the fix: accessing protected members from inside the class is fine, and the
  // literal's own properties are ordinary public ones.
  private get repos(): FamilyLabelRepositories {
    return {
      familyRepository: this.familyRepository,
      faceIdentityRepository: this.faceIdentityRepository,
      userRepository: this.userRepository,
    };
  }

  async resolveFamilyAccess(auth: AuthDto): Promise<FamilyAccessLevel> {
    const { familyTree } = await this.getConfig({ withCache: false });
    return resolveFamilyAccessLevel(this.repos, familyTree, auth.user.id);
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
    return buildFamilyGraph(this.repos, auth.user.id);
  }

  // Slice 5 (D3/E63-E65): disconnected components over the SAME viewer-visible graph
  // `getVisibleGraph` returns — never the full graph, or a cluster would reveal a connection
  // through a union the viewer cannot see. Computed fresh every call; nothing is stored (`E64`).
  // A person who belongs to no union is simply never a node in this graph, so they appear in no
  // cluster (`E63`) without any special-casing.
  async getClusters(auth: AuthDto): Promise<FamilyCluster[]> {
    await this.requireFamilyRead(auth);

    const { resolved, visibleUnions } = await resolveFamilyVisibility(this.repos, auth.user.id);
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

  // Slice 7 (D4): reads back the identity the caller nominated as themselves, or null if never
  // set. `view` is sufficient — same authority as `setMyRoot` below.
  async getMyRoot(auth: AuthDto): Promise<string | null> {
    await this.requireFamilyRead(auth);
    return resolveFamilyRootId(this.repos, auth.user.id);
  }

  // New (person-page relations panel): a person's OWN relations, each labelled relative to
  // THAT PERSON, not the viewer — a genuinely different query from `familyRelationLabel`
  // (`PersonService`), which labels a person relative to the VIEWER. Same underlying engine
  // (`deriveDirectRelations`), same visibility rule (the graph is still built for the VIEWER —
  // a union the viewer cannot see contributes nothing, exactly as everywhere else in this
  // feature), different root.
  async getPersonRelations(auth: AuthDto, personId: string): Promise<FamilyPersonRelation[]> {
    await this.requireFamilyRead(auth);

    const subjectIdentityId = await this.resolvePersonIdentityId(auth, personId);
    if (!subjectIdentityId) {
      // Found and accessible, but never linked to a family identity — a valid state, not an
      // error: nothing to report yet, same as anyone else not (yet) part of the graph.
      return [];
    }

    const graph = await buildFamilyGraph(this.repos, auth.user.id);
    const directRelations = deriveDirectRelations(graph, subjectIdentityId);
    if (directRelations.length === 0) {
      return [];
    }

    // One batch resolution for every known participant in this (small, single-person) list —
    // never one query per row — mirroring the same "resolve accessible identities in one pass"
    // discipline the rest of this feature uses for the (much larger) union graph.
    const knownIds = [
      ...new Set(
        directRelations
          .filter(
            (entry): entry is typeof entry & { participant: { kind: 'known'; identityId: string } } =>
              entry.participant.kind === 'known',
          )
          .map((entry) => entry.participant.identityId),
      ),
    ];
    const resolvedPeople = await Promise.all(
      knownIds.map((identityId) => this.faceIdentityRepository.getResolvedPersonByIdentityId(auth.user.id, identityId)),
    );
    const personByIdentityId = new Map(knownIds.map((identityId, index) => [identityId, resolvedPeople[index]]));

    const relations: FamilyPersonRelation[] = [];
    for (const entry of directRelations) {
      if (entry.participant.kind === 'known') {
        const person = personByIdentityId.get(entry.participant.identityId);
        // Defensive: `identityId` came from `graph.identities`, which was itself built from the
        // SAME resolution `getResolvedPersonByIdentityId` uses, so this should always hit. If it
        // somehow doesn't, skip the row rather than ever fall back to exposing the identity id.
        if (!person) {
          continue;
        }
        relations.push({ person, anonymousSlot: null, relation: entry.relation });
        continue;
      }

      relations.push({ person: null, anonymousSlot: entry.anonymousSlot, relation: entry.relation });
    }

    return relations;
  }

  // Canvas node avatars (`A`-row "Canvas node avatars: `ImageThumbnail` `circle`"). A client on
  // the canvas holds identity ids and NOTHING else — `PersonResponseDto` deliberately withholds
  // `identityId` (E30), so there is no person id to point `GET /people/:id/thumbnail` at, and for
  // a space-resolved identity that owner-only route would 404 anyway. Hence an identity-addressed
  // thumbnail, in the same shape as the shared-space one.
  //
  // Discloses nothing new: `getResolvedPersonByIdentityId` applies the SAME accessibility
  // predicate (`hydrateAccessiblePeople`, `withHidden: false`) as the
  // `resolveAccessibleIdentityNames` call that decided the viewer could see this identity's NAME
  // in the graph at all. An identity the viewer cannot resolve has no row here and 404s, exactly
  // as it is already reduced to an anonymous seat by `D3`'s redaction.
  async getIdentityThumbnail(auth: AuthDto, identityId: string): Promise<ImmichMediaResponse> {
    await this.requireFamilyRead(auth);

    const person = await this.faceIdentityRepository.getResolvedPersonByIdentityId(auth.user.id, identityId);
    if (!person?.thumbnailPath) {
      throw new NotFoundException();
    }

    return this.serveFromBackend(
      person.thumbnailPath,
      mimeTypes.lookup(person.thumbnailPath),
      CacheControl.PrivateWithoutCache,
    );
  }

  // The person behind a canvas card, resolved FOR THIS VIEWER. A card carries an identity id and
  // nothing else, so without this there is no way to show anyone's birthday, or to rename them,
  // from the surface where their name is on screen.
  //
  // This does not weaken `E30`. What that rule withholds is the identity id behind a person, so
  // the same real person cannot be correlated across users; the mapping here runs the other way
  // and yields the profile THIS caller already has — their own `person` row, or a
  // `shared_space_person` in a space they belong to — which is per-viewer by construction and
  // already reachable from every other people surface. Same predicate, and so the same 404, as
  // `getIdentityThumbnail` above.
  //
  // Returning the whole `PersonResponseDto` rather than a bare id is deliberate: `primaryProfile`
  // is what tells a client whether a write belongs on the owner endpoint or the shared-space one,
  // and getting that wrong is a silent 404 on someone else's person.
  async getIdentityPerson(auth: AuthDto, identityId: string): Promise<PersonResponseDto> {
    await this.requireFamilyRead(auth);

    const person = await this.faceIdentityRepository.getResolvedPersonByIdentityId(auth.user.id, identityId);
    if (!person) {
      throw new NotFoundException();
    }

    return person;
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

  // The first-run picker on /family only ever knows a person id (see `FamilyMyRootUpdateDto`).
  // Delegates to `setMyRoot` so the access rule and the metadata write stay in one place.
  async setMyRootByPerson(auth: AuthDto, personId: string): Promise<void> {
    await this.requireFamilyRead(auth);
    const [identityId] = await this.resolvePersonIdsToIdentityIds(auth, [personId]);
    await this.setMyRoot(auth, identityId);
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

  // Slice 7 (new): reverts a user to the instance default by removing their explicit grant
  // entirely — NOT by setting it to a value that happens to match the default, which would
  // leave the row (and therefore the "explicit none" vs "inherits default" distinction) behind.
  // Deleting a grant that never existed is not an error: the end state ("no explicit grant") is
  // already what was asked for. Same admin-independent-of-family-level authority as the other
  // two grant endpoints (enforced by the controller, not here).
  async deleteAccessGrant(userId: string): Promise<void> {
    await this.familyRepository.deleteAccess(userId);
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

  // Resolves a `person.id` (owned) OR `shared_space_person.id` (scoped profile) to its
  // family-relationships identity, mirroring the exact two-step resolution
  // `PersonService.getStatistics`/`getById` already use for the same kind of id. Returns `null`
  // for a person the caller can access but who has never been linked to a family identity — a
  // valid, non-error state. Throws when the id is not found or the caller has no access to it at
  // all, same as the sibling methods this mirrors.
  private async resolvePersonIdentityId(auth: AuthDto, personId: string): Promise<string | null> {
    const allowedIds = await this.checkAccess({ auth, permission: Permission.PersonRead, ids: [personId] });
    if (allowedIds.has(personId)) {
      const person = await this.personRepository.getById(personId);
      if (!person) {
        throw new NotFoundException('Person not found');
      }
      return person.identityId;
    }

    const identityId = await this.faceIdentityRepository.getAccessibleProfileIdentityId(auth.user.id, personId);
    if (identityId) {
      return identityId;
    }

    throw new NotFoundException(`Not found or no ${Permission.PersonRead} access`);
  }

  // Resolves person ids for the write paths a people picker can reach. A person the caller can
  // see but who has no face identity yet is a 400, never a silent drop: dropping them would leave
  // the union below the two-resolvable threshold `computeVisibleUnions` enforces, so the caller
  // would get a 201 for a union that is invisible to everyone including themselves.
  private async resolvePersonIdsToIdentityIds(auth: AuthDto, personIds: string[]): Promise<string[]> {
    const identityIds: string[] = [];
    for (const personId of personIds) {
      const identityId = await this.resolvePersonIdentityId(auth, personId);
      if (!identityId) {
        throw new BadRequestException(
          `Person ${personId} is not linked to a face identity yet, so they cannot be part of a family relationship`,
        );
      }
      identityIds.push(identityId);
    }
    return identityIds;
  }

  // Authority comes from `requireFamilyWrite` alone (E21, E24, E25) — whoever created a union
  // is recorded for audit purposes only (`createdById`), and is never consulted for authority.
  // Any contributor may edit or delete any union.
  async createUnion(auth: AuthDto, dto: CreateUnionDto): Promise<{ id: string }> {
    await this.requireFamilyWrite(auth);

    const partnerIds = [
      ...(dto.partnerIds ?? []),
      ...(await this.resolvePersonIdsToIdentityIds(auth, dto.partnerPersonIds ?? [])),
    ];
    const childIds = [
      ...(dto.childIds ?? []),
      ...(await this.resolvePersonIdsToIdentityIds(auth, dto.childPersonIds ?? [])),
    ];
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

    const [resolvedFromPerson] = dto.identityId
      ? [undefined]
      : await this.resolvePersonIdsToIdentityIds(auth, [dto.personId!]);
    const identityId = dto.identityId ?? resolvedFromPerson!;

    await this.validateParticipantTypes([identityId]);

    const [partnerIds, childIds] = await Promise.all([
      this.familyRepository.getPartnerIds(unionId),
      this.familyRepository.getChildIds(unionId),
    ]);

    if (dto.role === 'partner') {
      if (childIds.includes(identityId)) {
        throw new BadRequestException('A person cannot be both a partner and a child of the same union');
      }
      if (partnerIds.includes(identityId)) {
        throw new BadRequestException('A person cannot be their own partner');
      }
      if (partnerIds.length + 1 > 2) {
        throw new BadRequestException('A union may have at most two partners');
      }

      for (const childId of childIds) {
        if (await this.familyRepository.isAncestor(childId, identityId)) {
          throw new BadRequestException('This would create a cycle in the family graph');
        }
      }

      await this.familyRepository.addPartner(unionId, identityId);
      return;
    }

    if (partnerIds.includes(identityId)) {
      throw new BadRequestException('A person cannot be both a partner and a child of the same union');
    }

    for (const partnerId of partnerIds) {
      if (await this.familyRepository.isAncestor(identityId, partnerId)) {
        throw new BadRequestException('This would create a cycle in the family graph');
      }
    }

    await this.familyRepository.addChild(unionId, identityId);
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
