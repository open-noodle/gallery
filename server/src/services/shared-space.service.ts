import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { AuthDto } from 'src/dtos/auth.dto';
import {
  SharedSpaceAssetAddDto,
  SharedSpaceAssetRemoveDto,
  SharedSpaceCreateDto,
  SharedSpaceMemberCreateDto,
  SharedSpaceMemberResponseDto,
  SharedSpaceMemberTimelineDto,
  SharedSpaceMemberUpdateDto,
  SharedSpaceResponseDto,
  SharedSpaceUpdateDto,
} from 'src/dtos/shared-space.dto';
import { Permission, SharedSpaceRole, UserAvatarColor } from 'src/enum';
import { BaseService } from 'src/services/base.service';

const ROLE_HIERARCHY: Record<SharedSpaceRole, number> = {
  [SharedSpaceRole.Viewer]: 0,
  [SharedSpaceRole.Editor]: 1,
  [SharedSpaceRole.Owner]: 2,
};

@Injectable()
export class SharedSpaceService extends BaseService {
  async create(auth: AuthDto, dto: SharedSpaceCreateDto): Promise<SharedSpaceResponseDto> {
    const space = await this.sharedSpaceRepository.create({
      name: dto.name,
      description: dto.description ?? null,
      color: dto.color ?? 'primary',
      createdById: auth.user.id,
    });

    await this.sharedSpaceRepository.addMember({
      spaceId: space.id,
      userId: auth.user.id,
      role: SharedSpaceRole.Owner,
    });

    return this.mapSpace(space);
  }

  async getAll(auth: AuthDto): Promise<SharedSpaceResponseDto[]> {
    const spaces = await this.sharedSpaceRepository.getAllByUserId(auth.user.id);

    const results: SharedSpaceResponseDto[] = [];
    for (const space of spaces) {
      const members = await this.sharedSpaceRepository.getMembers(space.id);
      const assetCount = await this.sharedSpaceRepository.getAssetCount(space.id);
      const recentAssets = await this.sharedSpaceRepository.getRecentAssets(space.id);

      // Recency badge data
      const membership = await this.sharedSpaceRepository.getMember(space.id, auth.user.id);
      let newAssetCount: number;
      let lastContributor: { id: string; name: string } | null = null;

      if (membership?.lastViewedAt) {
        newAssetCount = await this.sharedSpaceRepository.getNewAssetCount(space.id, membership.lastViewedAt);
        if (newAssetCount > 0) {
          const contributor = await this.sharedSpaceRepository.getLastContributor(space.id, membership.lastViewedAt);
          lastContributor = contributor ?? null;
        }
      } else {
        newAssetCount = assetCount;
      }

      results.push({
        ...this.mapSpace(space),
        memberCount: members.length,
        assetCount,
        recentAssetIds: recentAssets.map((a) => a.id),
        recentAssetThumbhashes: recentAssets.map((a) =>
          a.thumbhash ? Buffer.from(a.thumbhash).toString('base64') : null,
        ),
        members: members.map((m) => this.mapMember(m)),
        newAssetCount,
        lastContributor,
      });
    }
    return results;
  }

  async get(auth: AuthDto, id: string): Promise<SharedSpaceResponseDto> {
    await this.requireMembership(auth, id);

    const space = await this.sharedSpaceRepository.getById(id);
    if (!space) {
      throw new BadRequestException('Shared space not found');
    }

    const members = await this.sharedSpaceRepository.getMembers(id);
    const assetCount = await this.sharedSpaceRepository.getAssetCount(id);
    const recentAssets = await this.sharedSpaceRepository.getRecentAssets(id);

    return {
      ...this.mapSpace(space),
      thumbnailAssetId: space.thumbnailAssetId,
      memberCount: members.length,
      assetCount,
      recentAssetIds: recentAssets.map((a) => a.id),
      recentAssetThumbhashes: recentAssets.map((a) =>
        a.thumbhash ? Buffer.from(a.thumbhash).toString('base64') : null,
      ),
      members: members.map((m) => this.mapMember(m)),
    };
  }

  async update(auth: AuthDto, id: string, dto: SharedSpaceUpdateDto): Promise<SharedSpaceResponseDto> {
    const isMetadataUpdate = dto.name !== undefined || dto.description !== undefined || dto.color !== undefined;
    const minimumRole = isMetadataUpdate ? SharedSpaceRole.Owner : SharedSpaceRole.Editor;
    await this.requireRole(auth, id, minimumRole);

    const space = await this.sharedSpaceRepository.update(id, {
      name: dto.name,
      description: dto.description,
      thumbnailAssetId: dto.thumbnailAssetId,
      color: dto.color,
    });

    return this.mapSpace(space);
  }

  async remove(auth: AuthDto, id: string): Promise<void> {
    await this.requireRole(auth, id, SharedSpaceRole.Owner);
    await this.sharedSpaceRepository.remove(id);
  }

  async getMembers(auth: AuthDto, spaceId: string): Promise<SharedSpaceMemberResponseDto[]> {
    await this.requireMembership(auth, spaceId);

    const members = await this.sharedSpaceRepository.getMembers(spaceId);
    const contributions = await this.sharedSpaceRepository.getContributionCounts(spaceId);
    const activity = await this.sharedSpaceRepository.getMemberActivity(spaceId);

    const countMap = new Map(contributions.map((c) => [c.addedById, Number(c.count)]));
    const activityMap = new Map(activity.map((a) => [a.addedById, a]));

    const enriched = members.map((member) => ({
      ...this.mapMember(member),
      contributionCount: countMap.get(member.userId) ?? 0,
      lastActiveAt: activityMap.get(member.userId)?.lastAddedAt
        ? (activityMap.get(member.userId)!.lastAddedAt as unknown as Date).toISOString()
        : null,
      recentAssetId: activityMap.get(member.userId)?.recentAssetId ?? null,
    }));

    // Sort: owner first, then by contribution count desc
    return enriched.toSorted((a, b) => {
      const aIsOwner = a.role === SharedSpaceRole.Owner ? 1 : 0;
      const bIsOwner = b.role === SharedSpaceRole.Owner ? 1 : 0;
      if (aIsOwner !== bIsOwner) {
        return bIsOwner - aIsOwner;
      }
      return (b.contributionCount ?? 0) - (a.contributionCount ?? 0);
    });
  }

  async addMember(
    auth: AuthDto,
    spaceId: string,
    dto: SharedSpaceMemberCreateDto,
  ): Promise<SharedSpaceMemberResponseDto> {
    await this.requireRole(auth, spaceId, SharedSpaceRole.Owner);

    const existing = await this.sharedSpaceRepository.getMember(spaceId, dto.userId);
    if (existing) {
      throw new BadRequestException('User is already a member of this space');
    }

    const role = dto.role ?? SharedSpaceRole.Viewer;
    await this.sharedSpaceRepository.addMember({ spaceId, userId: dto.userId, role });

    const member = await this.sharedSpaceRepository.getMember(spaceId, dto.userId);
    if (!member) {
      throw new BadRequestException('Failed to add member');
    }

    return this.mapMember(member);
  }

  async updateMember(
    auth: AuthDto,
    spaceId: string,
    userId: string,
    dto: SharedSpaceMemberUpdateDto,
  ): Promise<SharedSpaceMemberResponseDto> {
    await this.requireRole(auth, spaceId, SharedSpaceRole.Owner);

    if (auth.user.id === userId) {
      throw new BadRequestException('Cannot change your own role');
    }

    await this.sharedSpaceRepository.updateMember(spaceId, userId, { role: dto.role });

    const member = await this.sharedSpaceRepository.getMember(spaceId, userId);
    if (!member) {
      throw new BadRequestException('Member not found');
    }

    return this.mapMember(member);
  }

  async updateMemberTimeline(
    auth: AuthDto,
    spaceId: string,
    dto: SharedSpaceMemberTimelineDto,
  ): Promise<SharedSpaceMemberResponseDto> {
    await this.requireMembership(auth, spaceId);

    await this.sharedSpaceRepository.updateMember(spaceId, auth.user.id, {
      showInTimeline: dto.showInTimeline,
    });

    const member = await this.sharedSpaceRepository.getMember(spaceId, auth.user.id);
    if (!member) {
      throw new BadRequestException('Member not found');
    }

    return this.mapMember(member);
  }

  async removeMember(auth: AuthDto, spaceId: string, userId: string): Promise<void> {
    const isSelf = auth.user.id === userId;

    if (isSelf) {
      const member = await this.requireMembership(auth, spaceId);
      if (member.role === SharedSpaceRole.Owner) {
        throw new BadRequestException('Owner cannot leave the space');
      }
      await this.sharedSpaceRepository.removeMember(spaceId, userId);
      return;
    }

    await this.requireRole(auth, spaceId, SharedSpaceRole.Owner);
    await this.sharedSpaceRepository.removeMember(spaceId, userId);
  }

  async addAssets(auth: AuthDto, spaceId: string, dto: SharedSpaceAssetAddDto): Promise<void> {
    await this.requireRole(auth, spaceId, SharedSpaceRole.Editor);
    await this.sharedSpaceRepository.addAssets(
      dto.assetIds.map((assetId) => ({ spaceId, assetId, addedById: auth.user.id })),
    );

    await this.sharedSpaceRepository.update(spaceId, { lastActivityAt: new Date() });
  }

  async markSpaceViewed(auth: AuthDto, spaceId: string): Promise<void> {
    await this.requireMembership(auth, spaceId);
    await this.sharedSpaceRepository.updateMemberLastViewed(spaceId, auth.user.id);
  }

  async removeAssets(auth: AuthDto, spaceId: string, dto: SharedSpaceAssetRemoveDto): Promise<void> {
    await this.requireRole(auth, spaceId, SharedSpaceRole.Editor);
    await this.sharedSpaceRepository.removeAssets(spaceId, dto.assetIds);

    const lastAddedAt = await this.sharedSpaceRepository.getLastAssetAddedAt(spaceId);
    await this.sharedSpaceRepository.update(spaceId, { lastActivityAt: lastAddedAt ?? null });
  }

  async getMapMarkers(auth: AuthDto, id: string) {
    await this.requireAccess({ auth, permission: Permission.SharedSpaceRead, ids: [id] });

    const markers = await this.sharedSpaceRepository.getMapMarkers(id);
    return markers.map((marker) => ({
      id: marker.id,
      lat: marker.latitude!,
      lon: marker.longitude!,
      city: marker.city ?? null,
      state: marker.state ?? null,
      country: marker.country ?? null,
    }));
  }

  private async requireMembership(auth: AuthDto, spaceId: string) {
    const member = await this.sharedSpaceRepository.getMember(spaceId, auth.user.id);
    if (!member) {
      throw new ForbiddenException('Not a member of this space');
    }
    return member;
  }

  private async requireRole(auth: AuthDto, spaceId: string, minimumRole: SharedSpaceRole) {
    const member = await this.requireMembership(auth, spaceId);
    if (ROLE_HIERARCHY[member.role as SharedSpaceRole] < ROLE_HIERARCHY[minimumRole]) {
      throw new ForbiddenException('Insufficient role');
    }
    return member;
  }

  private mapMember(member: {
    userId: string;
    name: string;
    email: string;
    role: string;
    joinedAt: unknown;
    profileImagePath: string;
    profileChangedAt: unknown;
    avatarColor: string | null;
    showInTimeline: boolean;
  }): SharedSpaceMemberResponseDto {
    return {
      userId: member.userId,
      name: member.name,
      email: member.email,
      role: member.role,
      joinedAt: member.joinedAt as unknown as string,
      profileImagePath: member.profileImagePath,
      profileChangedAt: member.profileChangedAt as unknown as string,
      avatarColor: member.avatarColor ?? undefined,
      showInTimeline: member.showInTimeline,
    };
  }

  private mapSpace(space: {
    id: string;
    name: string;
    description: string | null;
    createdById: string;
    createdAt: unknown;
    updatedAt: unknown;
    thumbnailAssetId?: string | null;
    color?: string | null;
    lastActivityAt?: Date | null;
  }): SharedSpaceResponseDto {
    return {
      id: space.id,
      name: space.name,
      description: space.description,
      createdById: space.createdById,
      createdAt: space.createdAt as unknown as string,
      updatedAt: space.updatedAt as unknown as string,
      thumbnailAssetId: space.thumbnailAssetId ?? null,
      color: (space.color as UserAvatarColor) ?? null,
      lastActivityAt: space.lastActivityAt ? space.lastActivityAt.toISOString() : null,
    };
  }
}
