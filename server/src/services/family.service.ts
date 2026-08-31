import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { AuthDto } from 'src/dtos/auth.dto';
import { FamilyAccessLevel } from 'src/enum';
import { BaseService } from 'src/services/base.service';

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
