import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Transaction } from 'kysely';
import { AssetFace, SharedSpacePerson } from 'src/database';
import { OnEvent, OnJob } from 'src/decorators';
import { MapAlbumDto, mapAlbum } from 'src/dtos/album.dto';
import { AuthDto } from 'src/dtos/auth.dto';
import type { FilteredMapMarkerDto } from 'src/dtos/gallery-map.dto';
import type { MapMarkerResponseDto } from 'src/dtos/map.dto';
import { mapNotification } from 'src/dtos/notification.dto';
import {
  PeopleFaceStatisticsResponseDto,
  PersonFacePageQueryDto,
  PersonFacePageResponseDto,
  PersonFaceSuggestionPageQueryDto,
  PersonFaceSuggestionPageResponseDto,
  PersonStatisticsResponseDto,
} from 'src/dtos/person.dto';
import {
  SharedSpacePeopleStatisticsResponseDto,
  SharedSpacePersonAliasDto,
  SharedSpacePersonMergeDto,
  SharedSpacePersonResponseDto,
  SharedSpacePersonUpdateDto,
  SpaceAssetFaceResponseDto,
  SpacePeopleQueryDto,
  SpaceRepresentativeFaceUpdateDto,
} from 'src/dtos/shared-space-person.dto';
import {
  SharedSpaceActivityResponseDto,
  SharedSpaceAlbumLinkUpdateDto,
  SharedSpaceAssetAddDto,
  SharedSpaceAssetLinkedAlbumDto,
  SharedSpaceAssetRemoveDto,
  SharedSpaceCreateDto,
  SharedSpaceLibraryLinkDto,
  SharedSpaceLinkedAlbumDto,
  SharedSpaceLinkedLibraryDto,
  SharedSpaceMemberCreateDto,
  SharedSpaceMemberMetadataContributionDto,
  SharedSpaceMemberPreferencesDto,
  SharedSpaceMemberResponseDto,
  SharedSpaceMemberTimelineDto,
  SharedSpaceMemberUpdateDto,
  SharedSpaceResponseDto,
  SharedSpaceUpdateDto,
} from 'src/dtos/shared-space.dto';
import {
  AssetType,
  AssetVisibility,
  CacheControl,
  ImmichWorker,
  JobName,
  JobStatus,
  NotificationLevel,
  NotificationType,
  Permission,
  QueueName,
  SharedSpaceActivityType,
  SharedSpaceRole,
  SourceType,
  SystemMetadataKey,
  UserAvatarColor,
} from 'src/enum';
import { AlbumAssetCount } from 'src/repositories/album.repository';
import type { ArgOf } from 'src/repositories/event.repository';
import type { SpaceFaceAssignment } from 'src/repositories/shared-space.repository';
import { visibleSpaceAssetVisibilities } from 'src/repositories/shared-space.repository';
import { DB } from 'src/schema';
import {
  buildAutomaticReconciliationClaim,
  chooseAutomaticTargetIdentity,
  filterUnambiguousReconciliationClaims,
  type ReconciliationClaim,
} from 'src/services/accessible-identity-reconciliation';
import { BaseService } from 'src/services/base.service';
import { JobOf } from 'src/types';
import { convertFaceBoxToOriginalImageSpace, getDimensions } from 'src/utils/asset.util';
import { asDateString, asDateTimeString } from 'src/utils/date';
import { ImmichMediaResponse } from 'src/utils/file';
import { createCrossOwnerMergeAuthorizer } from 'src/utils/merge-policy';
import { mimeTypes } from 'src/utils/mime-types';
import { isFaceSuggestionEnabled } from 'src/utils/misc';
import { transformFaceBoundingBox } from 'src/utils/transform';

const ROLE_HIERARCHY: Record<SharedSpaceRole, number> = {
  [SharedSpaceRole.Viewer]: 0,
  [SharedSpaceRole.Editor]: 1,
  [SharedSpaceRole.Owner]: 2,
};

const getSharedSpaceRoleScore = (role: string) => ROLE_HIERARCHY[role as SharedSpaceRole] ?? 0;
const getMetadataSourceScore = (sourceProfileType?: string | null) => (sourceProfileType === 'user-person' ? 1 : 0);

/** nameSource collapse precedence: a manually-set name wins over an inherited/auto/empty one. */
const NAME_SOURCE_PRECEDENCE: Record<string, number> = {
  manual: 3,
  inherited: 2,
  auto: 1,
  none: 0,
};
const getNameSourcePrecedence = (nameSource: string) => NAME_SOURCE_PRECEDENCE[nameSource] ?? 0;

/**
 * Upper bound on chained {@link SharedSpaceService.handleSharedSpacePersonDedup} passes for one
 * space. Each job runs a single pass and re-queues the next; this caps the chain so a pathological
 * always-reappears bug can't queue passes forever.
 */
export const SHARED_SPACE_DEDUP_MAX_PASSES = 100;

type SpacePersonMatchResult = {
  id: string;
  identityId?: string | null;
  sourceIdentityId?: string | null;
  type?: string | null;
};

type SharedSpaceIdentityReconciliationClaim = ReconciliationClaim & {
  spacePersonId: string;
  targetIdentityId: string;
  sourceIdentityId: string;
};

type SpacePersonSuggestionScanCandidate = Pick<SharedSpacePerson, 'id' | 'spaceId' | 'name' | 'isHidden' | 'type'>;

type SpacePersonMetadataInheritanceResult = {
  didInherit: boolean;
  suggestionScanCandidate?: SpacePersonSuggestionScanCandidate;
};

@Injectable()
export class SharedSpaceService extends BaseService {
  private sharedSpaceFaceMatchBatchSize = 1000;

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
      const albumCount = await this.sharedSpaceRepository.getLinkedAlbumCount(space.id);

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

      let linkedLibraries: SharedSpaceLinkedLibraryDto[] | undefined;
      if (auth.user.isAdmin) {
        const links = await this.sharedSpaceRepository.getLinkedLibraries(space.id);
        linkedLibraries = [];
        for (const link of links) {
          const library = await this.libraryRepository.get(link.libraryId);
          if (library) {
            linkedLibraries.push({
              libraryId: link.libraryId,
              libraryName: library.name,
              addedById: link.addedById,
              createdAt: (link.createdAt as unknown as Date).toISOString(),
            });
          }
        }
      }

      const recentAssetIds: string[] = [];
      const recentAssetThumbhashes: string[] = [];
      for (const asset of recentAssets) {
        if (!asset.thumbhash) {
          continue;
        }

        recentAssetIds.push(asset.id);
        recentAssetThumbhashes.push(Buffer.from(asset.thumbhash).toString('base64'));
      }

      results.push({
        ...this.mapSpace(space),
        memberCount: members.length,
        assetCount,
        albumCount,
        recentAssetIds,
        recentAssetThumbhashes,
        members: members.map((m) => this.mapMember(m)),
        newAssetCount,
        lastContributor,
        linkedLibraries,
      });
    }
    return results;
  }

  async get(auth: AuthDto, id: string): Promise<SharedSpaceResponseDto> {
    const membership = await this.requireMembership(auth, id);

    const space = await this.sharedSpaceRepository.getById(id);
    if (!space) {
      throw new BadRequestException('Shared space not found');
    }

    const members = await this.sharedSpaceRepository.getMembers(id);
    const assetCount = await this.sharedSpaceRepository.getAssetCount(id);
    const recentAssets = await this.sharedSpaceRepository.getRecentAssets(id);

    let { thumbnailAssetId } = space;
    if (thumbnailAssetId) {
      const activeIds = new Set(recentAssets.map((a) => a.id));
      if (assetCount === 0 || (assetCount <= activeIds.size && !activeIds.has(thumbnailAssetId))) {
        thumbnailAssetId = null;
        await this.sharedSpaceRepository.update(id, { thumbnailAssetId: null });
      }
    }

    const newAssetCount = membership.lastViewedAt
      ? await this.sharedSpaceRepository.getNewAssetCount(id, membership.lastViewedAt)
      : 0;

    let hasPets: boolean | undefined;
    if (space.faceRecognitionEnabled) {
      hasPets = await this.sharedSpaceRepository.hasPetsBySpaceId(id);
    }

    let linkedLibraries: SharedSpaceLinkedLibraryDto[] | undefined;
    if (auth.user.isAdmin) {
      const links = await this.sharedSpaceRepository.getLinkedLibraries(space.id);
      linkedLibraries = [];
      for (const link of links) {
        const library = await this.libraryRepository.get(link.libraryId);
        if (library) {
          linkedLibraries.push({
            libraryId: link.libraryId,
            libraryName: library.name,
            addedById: link.addedById,
            createdAt: (link.createdAt as unknown as Date).toISOString(),
          });
        }
      }
    }

    const recentAssetIds: string[] = [];
    const recentAssetThumbhashes: string[] = [];
    for (const asset of recentAssets) {
      if (!asset.thumbhash) {
        continue;
      }

      recentAssetIds.push(asset.id);
      recentAssetThumbhashes.push(Buffer.from(asset.thumbhash).toString('base64'));
    }

    return {
      ...this.mapSpace(space),
      thumbnailAssetId,
      memberCount: members.length,
      assetCount,
      recentAssetIds,
      recentAssetThumbhashes,
      members: members.map((m) => this.mapMember(m)),
      newAssetCount,
      lastViewedAt: membership.lastViewedAt ? (membership.lastViewedAt as unknown as Date).toISOString() : null,
      linkedLibraries,
      hasPets,
    };
  }

  async update(auth: AuthDto, id: string, dto: SharedSpaceUpdateDto): Promise<SharedSpaceResponseDto> {
    // Space-wide processing settings stay owner-only: faceRecognitionEnabled gates ML work and
    // the People tab for every member (and queues a full re-match when switched on), petsEnabled
    // changes the whole space's people list. Naming/appearance (name, description, color) and the
    // cover are editor-level. The check runs against the WHOLE dto before any write, so a mixed
    // payload from an editor is rejected outright rather than partially applied.
    const isOwnerOnlySettingsUpdate = dto.faceRecognitionEnabled !== undefined || dto.petsEnabled !== undefined;
    const minimumRole = isOwnerOnlySettingsUpdate ? SharedSpaceRole.Owner : SharedSpaceRole.Editor;
    await this.requireRole(auth, id, minimumRole);

    // Validate thumbnail asset belongs to the space
    if (dto.thumbnailAssetId !== undefined && dto.thumbnailAssetId !== null) {
      const isInSpace = await this.sharedSpaceRepository.isAssetInSpace(id, dto.thumbnailAssetId);
      if (!isInSpace) {
        throw new BadRequestException('Thumbnail asset must belong to the space');
      }
    }

    // Reset crop position when cover photo changes
    const thumbnailCropY = dto.thumbnailAssetId === undefined ? dto.thumbnailCropY : null;

    const existing = await this.sharedSpaceRepository.getById(id);

    // Build update payload with only defined fields — Kysely's .set() with all-undefined
    // values produces an empty SET clause and a SQL syntax error.
    const updatePayload: Parameters<typeof this.sharedSpaceRepository.update>[1] = {};
    if (dto.name !== undefined) {
      updatePayload.name = dto.name;
    }
    if (dto.description !== undefined) {
      updatePayload.description = dto.description;
    }
    if (dto.thumbnailAssetId !== undefined) {
      updatePayload.thumbnailAssetId = dto.thumbnailAssetId;
    }
    if (thumbnailCropY !== undefined) {
      updatePayload.thumbnailCropY = thumbnailCropY;
    }
    if (dto.color !== undefined) {
      updatePayload.color = dto.color;
    }
    if (dto.faceRecognitionEnabled !== undefined) {
      updatePayload.faceRecognitionEnabled = dto.faceRecognitionEnabled;
    }
    if (dto.petsEnabled !== undefined) {
      updatePayload.petsEnabled = dto.petsEnabled;
    }

    const space =
      Object.keys(updatePayload).length > 0 && existing
        ? await this.sharedSpaceRepository.update(id, updatePayload)
        : existing;

    if (!space) {
      throw new BadRequestException('Space not found');
    }

    if (existing) {
      if (dto.name !== undefined && dto.name !== existing.name) {
        await this.sharedSpaceRepository.logActivity({
          spaceId: id,
          userId: auth.user.id,
          type: SharedSpaceActivityType.SpaceRename,
          data: { oldName: existing.name, newName: dto.name },
        });
      }
      if (dto.color !== undefined && dto.color !== existing.color) {
        await this.sharedSpaceRepository.logActivity({
          spaceId: id,
          userId: auth.user.id,
          type: SharedSpaceActivityType.SpaceColorChange,
          data: { oldColor: existing.color, newColor: dto.color },
        });
      }
      if (dto.thumbnailAssetId !== undefined && dto.thumbnailAssetId !== existing.thumbnailAssetId) {
        await this.sharedSpaceRepository.logActivity({
          spaceId: id,
          userId: auth.user.id,
          type: SharedSpaceActivityType.CoverChange,
          data: { assetId: dto.thumbnailAssetId },
        });
      }

      // Queue face matching when toggling from disabled to enabled
      if (dto.faceRecognitionEnabled === true && !existing.faceRecognitionEnabled) {
        await this.jobRepository.queue({
          name: JobName.SharedSpaceFaceMatchAll,
          data: { spaceId: id },
        });
      }
    }

    return this.mapSpace(space);
  }

  async remove(auth: AuthDto, id: string): Promise<void> {
    await this.requireRole(auth, id, SharedSpaceRole.Owner);
    // Capture the space's linked albums BEFORE the cascade delete removes the link rows,
    // so the post-commit reconcile can target them.
    const affectedAlbumIds = (await this.sharedSpaceRepository.getLinkedAlbumIds(id)) ?? [];
    await this.sharedSpaceRepository.remove(id);
    await this.queueAlbumGrantReconcile(affectedAlbumIds);
    await this.queueSpacePersonMetadataBackfill();
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

    await this.sharedSpaceRepository.logActivity({
      spaceId,
      userId: dto.userId,
      type: SharedSpaceActivityType.MemberJoin,
      data: { role, invitedById: auth.user.id },
    });

    await this.queueSpacePersonMetadataBackfill();
    // M7: this member-join can race a concurrent album-link into this space (each create-side
    // trigger fans out from its own row only and can miss the other's just-committed one), so
    // reconcile over the space's currently-linked albums to self-heal any missed grant.
    const linkedAlbumIds = (await this.sharedSpaceRepository.getLinkedAlbumIds(spaceId)) ?? [];
    await this.queueAlbumGrantReconcile(linkedAlbumIds);
    const space = await this.sharedSpaceRepository.getById(spaceId);
    if (space?.faceRecognitionEnabled) {
      await this.jobRepository.queue({
        name: JobName.SharedSpaceFaceMatchAll,
        data: { spaceId },
      });
    }
    await this.queueSpaceIdentityReconciliation({ spaceId, userId: dto.userId });

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

    const existingMember = await this.sharedSpaceRepository.getMember(spaceId, userId);
    if (!existingMember) {
      throw new BadRequestException('Member not found');
    }

    // rbac-4: a promoted co-Owner must not be able to demote the space creator.
    // The creator is always an Owner member (create() inserts them); keeping the
    // role at Owner is a harmless no-op, anything lower is a demotion → reject.
    // testq-6: fail-closed, not fail-open — existingMember above already proves a member row exists for
    // this spaceId, and the membership FK guarantees its space row exists too, so a missing getById
    // result here is a data-integrity fault, not a legitimate "no space" case. Silently skipping the
    // creator-demotion guard on a lookup miss (the previous `space &&` short-circuit) would let a
    // repository-shape refactor that changed how getById fails disable this guard with no test noticing.
    const space = await this.sharedSpaceRepository.getById(spaceId);
    if (!space) {
      throw new NotFoundException('Space not found');
    }
    if (userId === space.createdById && dto.role !== SharedSpaceRole.Owner) {
      throw new ForbiddenException('Cannot demote the space creator');
    }

    const oldRole = existingMember.role;
    await this.sharedSpaceRepository.updateMember(spaceId, userId, { role: dto.role });

    const member = await this.sharedSpaceRepository.getMember(spaceId, userId);
    if (!member) {
      throw new BadRequestException('Member not found');
    }

    await this.sharedSpaceRepository.logActivity({
      spaceId,
      userId: auth.user.id,
      type: SharedSpaceActivityType.MemberRoleChange,
      data: { targetUserId: userId, oldRole, newRole: dto.role },
    });

    await this.queueSpacePersonMetadataBackfill();

    return this.mapMember(member);
  }

  async updateMemberTimeline(
    auth: AuthDto,
    spaceId: string,
    dto: SharedSpaceMemberTimelineDto,
  ): Promise<SharedSpaceMemberResponseDto> {
    return this.updateMemberPreferences(auth, spaceId, { showInTimeline: dto.showInTimeline });
  }

  async updateMemberPreferences(
    auth: AuthDto,
    spaceId: string,
    dto: SharedSpaceMemberPreferencesDto,
  ): Promise<SharedSpaceMemberResponseDto> {
    await this.requireMembership(auth, spaceId);

    const updates: { showInTimeline?: boolean; sharePersonMetadata?: boolean } = {};
    if (dto.showInTimeline !== undefined) {
      updates.showInTimeline = dto.showInTimeline;
    }
    if (dto.sharePersonMetadata !== undefined) {
      updates.sharePersonMetadata = dto.sharePersonMetadata;
    }

    if (Object.keys(updates).length > 0) {
      await this.sharedSpaceRepository.updateMember(spaceId, auth.user.id, updates);
      await this.queueSpacePersonMetadataBackfill();
    }

    const member = await this.sharedSpaceRepository.getMember(spaceId, auth.user.id);
    if (!member) {
      throw new BadRequestException('Member not found');
    }

    return this.mapMember(member);
  }

  async updateMemberMetadataContribution(
    auth: AuthDto,
    spaceId: string,
    userId: string,
    dto: SharedSpaceMemberMetadataContributionDto,
  ): Promise<SharedSpaceMemberResponseDto> {
    if (dto.sharePersonMetadata) {
      throw new BadRequestException('Cannot enable person metadata contribution for another member');
    }

    if (!auth.user.isAdmin) {
      await this.requireRole(auth, spaceId, SharedSpaceRole.Owner);
    }

    const target = await this.sharedSpaceRepository.getMember(spaceId, userId);
    if (!target) {
      throw new BadRequestException('Member not found');
    }

    await this.sharedSpaceRepository.updateMember(spaceId, userId, { sharePersonMetadata: false });
    await this.queueSpacePersonMetadataBackfill();

    const member = await this.sharedSpaceRepository.getMember(spaceId, userId);
    if (!member) {
      throw new BadRequestException('Member not found');
    }

    return this.mapMember(member);
  }

  async removeMember(auth: AuthDto, spaceId: string, userId: string): Promise<void> {
    const isSelf = auth.user.id === userId;
    const space = await this.sharedSpaceRepository.getById(spaceId);
    const affectedAlbumIds = (await this.sharedSpaceRepository.getLinkedAlbumIds(spaceId)) ?? [];

    if (isSelf) {
      const member = await this.requireMembership(auth, spaceId);
      if (member.role === SharedSpaceRole.Owner) {
        throw new BadRequestException('Owner cannot leave the space');
      }
      const unlinkedAlbumIds = await this.removeMemberAndOwnedAlbumsAtomically(spaceId, userId);
      await this.cleanupDepartingMemberFaces(spaceId, unlinkedAlbumIds, space?.faceRecognitionEnabled ?? false);
      await this.sharedSpaceRepository.logActivity({
        spaceId,
        userId,
        type: SharedSpaceActivityType.MemberLeave,
        data: {},
      });
      await this.logDepartingMemberAlbumUnlinks(spaceId, userId, unlinkedAlbumIds);
      await this.queueSpacePersonMetadataBackfill();
      await this.queueAlbumGrantReconcile(affectedAlbumIds);
      return;
    }

    await this.requireRole(auth, spaceId, SharedSpaceRole.Owner);
    // rbac-4: a promoted co-Owner must not be able to remove the space creator
    // (the creator is always an Owner member, so their sync/grants would otherwise
    // survive removal forever). Deleting the whole space via remove() is still allowed.
    // testq-6: fail-closed here too (see the identical guard in updateMember) — requireRole above
    // already proves a member row exists for this spaceId, so the membership FK guarantees the space
    // row exists; a missing getById result is a data-integrity fault, not license to skip the guard.
    if (!space) {
      throw new NotFoundException('Space not found');
    }
    if (space.createdById === userId) {
      throw new ForbiddenException('Cannot remove the space creator');
    }
    const unlinkedAlbumIds = await this.removeMemberAndOwnedAlbumsAtomically(spaceId, userId);
    await this.cleanupDepartingMemberFaces(spaceId, unlinkedAlbumIds, space?.faceRecognitionEnabled ?? false);
    await this.sharedSpaceRepository.logActivity({
      spaceId,
      userId: auth.user.id,
      type: SharedSpaceActivityType.MemberRemove,
      data: { removedUserId: userId },
    });
    await this.logDepartingMemberAlbumUnlinks(spaceId, auth.user.id, unlinkedAlbumIds);
    await this.queueSpacePersonMetadataBackfill();
    await this.queueAlbumGrantReconcile(affectedAlbumIds);
  }

  // L16: cleanupDepartingMemberAlbums (removeMemberAndOwnedAlbumsAtomically /
  // removeOwnedAlbumLinksAddedBy) silently auto-unlinked a departing member's own albums —
  // remaining members had no record in the activity feed of which album vanished or why. Log
  // one AlbumUnlink per auto-removed album, alongside the MemberLeave/MemberRemove entry
  // already logged by the caller. `actingUserId` mirrors that entry's `userId` (the leaver on
  // self-leave, the removing Owner on an admin removal). Album lookup can miss (M9: the
  // departing member's own album may already be TRASHED by the time we log) — fall back to a
  // generic name rather than an empty string.
  private async logDepartingMemberAlbumUnlinks(
    spaceId: string,
    actingUserId: string,
    unlinkedAlbumIds: string[],
  ): Promise<void> {
    for (const albumId of unlinkedAlbumIds) {
      const album = await this.albumRepository.getById(albumId, { withAssets: false });
      await this.sharedSpaceRepository.logActivity({
        spaceId,
        userId: actingUserId,
        type: SharedSpaceActivityType.AlbumUnlink,
        data: { albumId, albumName: album?.albumName ?? 'Deleted album' },
      });
    }
  }

  /**
   * Expand a set of asset ids to include every live sibling that shares a stack
   * with them, so shared-space membership stays stack-atomic (discussion #751).
   * The explicitly-passed ids are always preserved (even if soft-deleted) so an
   * explicit add/remove is never silently dropped; the added siblings are the
   * live stack members only.
   */
  private async expandStackAssetIds(assetIds: string[], visibilities?: AssetVisibility[]): Promise<string[]> {
    const stacked = await this.stackRepository.getStackedAssetIds(assetIds, visibilities);
    return [...new Set([...assetIds, ...stacked])];
  }

  async addAssets(auth: AuthDto, spaceId: string, dto: SharedSpaceAssetAddDto): Promise<void> {
    await this.requireRole(auth, spaceId, SharedSpaceRole.Editor);
    // Stacks are atomic in a space: contributing any member contributes the
    // whole stack. Otherwise a stack child can be added without its
    // collapse-primary and would count toward the space but never render in the
    // stack-collapsed timeline (#751). Auto-expanded siblings are restricted to
    // space-eligible visibility so we never pull a Hidden/Locked frame in, and
    // access is checked on the full expanded set so we never contribute a
    // sibling the actor cannot read.
    const assetIds = await this.expandStackAssetIds(dto.assetIds, visibleSpaceAssetVisibilities);
    // rbac-2: AssetRead's space arm (checkSpaceAccess) includes an un-role-gated shared_space_album branch,
    // so a space Viewer of a space linking album X could read X's assets and re-add them as DIRECT assets
    // into a space they own — gaining AssetUpdate over the owner's assets via checkSpaceEditAccess. AssetShare
    // (owner ∪ partner only, no album/space arm) is the same permission album-add already requires and closes
    // the read→re-share→write escalation.
    await this.requireAccess({ auth, permission: Permission.AssetShare, ids: assetIds });
    const inserted = await this.sharedSpaceRepository.addAssets(
      assetIds.map((assetId) => ({ spaceId, assetId, addedById: auth.user.id })),
    );

    await this.sharedSpaceRepository.update(spaceId, { lastActivityAt: new Date() });

    await this.sharedSpaceRepository.logActivity({
      spaceId,
      userId: auth.user.id,
      type: SharedSpaceActivityType.AssetAdd,
      data: { count: inserted.length, assetIds: dto.assetIds.slice(0, 4) },
    });

    const space = await this.sharedSpaceRepository.getById(spaceId);
    if (space?.faceRecognitionEnabled) {
      await this.jobRepository.queueAll(
        assetIds.map((assetId) => ({
          name: JobName.SharedSpaceFaceMatch as const,
          data: { spaceId, assetId },
        })),
      );
    }
  }

  async queueBulkAdd(auth: AuthDto, spaceId: string): Promise<{ spaceId: string }> {
    await this.requireRole(auth, spaceId, SharedSpaceRole.Editor);
    await this.jobRepository.queue({
      name: JobName.SharedSpaceBulkAddAssets,
      data: { spaceId, userId: auth.user.id },
    });
    return { spaceId };
  }

  async linkLibrary(auth: AuthDto, spaceId: string, dto: SharedSpaceLibraryLinkDto): Promise<void> {
    if (!auth.user.isAdmin) {
      throw new ForbiddenException('Only admins can link libraries to spaces');
    }

    await this.requireRole(auth, spaceId, SharedSpaceRole.Editor);

    const library = await this.libraryRepository.get(dto.libraryId);
    if (!library) {
      throw new BadRequestException('Library not found');
    }

    const result = await this.sharedSpaceRepository.addLibrary({
      spaceId,
      libraryId: dto.libraryId,
      addedById: auth.user.id,
    });

    // Only queue face sync for newly created links (not duplicates)
    if (result) {
      const space = await this.sharedSpaceRepository.getById(spaceId);
      if (space?.faceRecognitionEnabled) {
        await this.jobRepository.queue({
          name: JobName.SharedSpaceLibraryFaceSync,
          data: { spaceId, libraryId: dto.libraryId },
        });
      }
    }
  }

  async linkAlbum(auth: AuthDto, spaceId: string, albumId: string): Promise<void> {
    await this.requireRole(auth, spaceId, SharedSpaceRole.Editor);
    // Actor must own or be an editor of the album (cannot re-share a read-only album).
    // AlbumUpdate = owner ∪ album_user-editor and is NOT extended by the space grant → no circularity.
    await this.requireAccess({ auth, permission: Permission.AlbumUpdate, ids: [albumId] });

    const result = await this.sharedSpaceRepository.addAlbum({
      spaceId,
      albumId,
      addedById: auth.user.id,
    });

    // Only queue face sync for newly created links (not idempotent re-links).
    if (result) {
      await this.sharedSpaceRepository.update(spaceId, { lastActivityAt: new Date() });
      const space = await this.sharedSpaceRepository.getById(spaceId);
      if (space?.faceRecognitionEnabled) {
        await this.jobRepository.queue({
          name: JobName.SharedSpaceAlbumFaceSync,
          data: { spaceId, albumId },
        });
      }
      const album = await this.albumRepository.getById(albumId, { withAssets: false });
      await this.sharedSpaceRepository.logActivity({
        spaceId,
        userId: auth.user.id,
        type: SharedSpaceActivityType.AlbumLink,
        data: { albumId, albumName: album?.albumName ?? '' },
      });
      // M7: a member-join and this album-link can land in overlapping transactions and each
      // create-side trigger can miss the other's just-committed row, leaving a member of this
      // space without a grant for the newly-linked album. The reconcile self-heals it.
      await this.queueAlbumGrantReconcile([albumId]);
    }
  }

  async unlinkAlbum(auth: AuthDto, spaceId: string, albumId: string): Promise<void> {
    // rbac-6: current-space Editors curate space links; ADDITIONALLY the album owner can always
    // revoke a link to their own album, even without space membership (otherwise an owner cannot
    // discover or undo an editor's link). The Editor path short-circuits, so it is not weakened.
    const member = await this.sharedSpaceRepository.getMember(spaceId, auth.user.id);
    const isSpaceEditor = !!member && getSharedSpaceRoleScore(member.role) >= ROLE_HIERARCHY[SharedSpaceRole.Editor];
    if (!isSpaceEditor) {
      const ownedAlbums = await this.checkAccess({ auth, permission: Permission.AlbumDelete, ids: [albumId] });
      if (!ownedAlbums.has(albumId)) {
        throw new ForbiddenException('Insufficient role');
      }
    }

    // Fork RBAC (Slice 4 / M11): the owner arm authorizes on album ownership only and never verified
    // the album is actually linked to this space. Without this guard, logActivity below injects an
    // AlbumUnlink row into an arbitrary space's feed (activity spam via a leaked spaceId), and a
    // nonexistent spaceId 500s on the FK. Guard both paths: no link -> 404, before any side effect.
    const linked = await this.sharedSpaceRepository.hasAlbumLink(spaceId, albumId);
    if (!linked) {
      throw new NotFoundException('Album is not linked to this space');
    }

    const album = await this.albumRepository.getById(albumId, { withAssets: false });
    const orphanedAssetIds = await this.sharedSpaceRepository.getAlbumAssetIdsWithoutOtherSpacePath(spaceId, albumId);
    await this.sharedSpaceRepository.removeAlbum(spaceId, albumId);
    await this.sharedSpaceRepository.logActivity({
      spaceId,
      userId: auth.user.id,
      type: SharedSpaceActivityType.AlbumUnlink,
      data: { albumId, albumName: album?.albumName ?? '' },
    });
    if (orphanedAssetIds.length > 0) {
      await this.sharedSpaceRepository.removePersonFacesByAssetIds(spaceId, orphanedAssetIds);
      await this.sharedSpaceRepository.deleteOrphanedPersons(spaceId);
      await this.queueSpacePersonMetadataBackfill();
    }
    // correctness-4: reconcile grants for the just-unlinked album (its grant revocation
    // in shared_space_album_delete_audit could have lost a delete to a concurrent revocation).
    await this.queueAlbumGrantReconcile([albumId]);
  }

  async updateAlbumLink(
    auth: AuthDto,
    spaceId: string,
    albumId: string,
    dto: SharedSpaceAlbumLinkUpdateDto,
  ): Promise<void> {
    await this.requireRole(auth, spaceId, SharedSpaceRole.Editor);
    await this.sharedSpaceRepository.setAlbumShowInTimeline(spaceId, albumId, dto.showInTimeline);
  }

  async getLinkedAlbums(auth: AuthDto, spaceId: string): Promise<SharedSpaceLinkedAlbumDto[]> {
    await this.requireMembership(auth, spaceId);
    const rows = await this.sharedSpaceRepository.getLinkedAlbums(spaceId);
    if (rows.length === 0) {
      return [];
    }
    const metadata = await this.albumRepository.getMetadataForIds(
      rows.map((row) => row.id),
      {
        forUserId: auth.user.id,
      },
    );
    const byId: Record<string, AlbumAssetCount> = {};
    for (const m of metadata) {
      byId[m.albumId] = m;
    }
    return rows.map((row) => {
      const { albumUsers: _albumUsers, ...albumFields } = mapAlbum(row as unknown as MapAlbumDto);
      return {
        ...albumFields,
        ownerId: (row as unknown as { ownerId: string }).ownerId,
        startDate: asDateTimeString(byId[row.id]?.startDate ?? undefined),
        endDate: asDateTimeString(byId[row.id]?.endDate ?? undefined),
        assetCount: byId[row.id]?.assetCount ?? 0,
        lastModifiedAssetTimestamp: asDateTimeString(byId[row.id]?.lastModifiedAssetTimestamp ?? undefined),
        showInTimeline: row.showInTimeline,
        addedById: row.addedById,
        linkedAt: (row.linkedAt as unknown as Date).toISOString(),
      };
    });
  }

  async unlinkLibrary(auth: AuthDto, spaceId: string, libraryId: string): Promise<void> {
    if (!auth.user.isAdmin) {
      throw new ForbiddenException('Only admins can unlink libraries from spaces');
    }

    await this.requireRole(auth, spaceId, SharedSpaceRole.Editor);

    await this.sharedSpaceRepository.removeLibrary(spaceId, libraryId);
    await this.sharedSpaceRepository.removePersonFacesByLibrary(spaceId, libraryId);
    await this.sharedSpaceRepository.deleteOrphanedPersons(spaceId);
    await this.queueSpacePersonMetadataBackfill();
  }

  async markSpaceViewed(auth: AuthDto, spaceId: string): Promise<void> {
    await this.requireMembership(auth, spaceId);
    await this.sharedSpaceRepository.updateMemberLastViewed(spaceId, auth.user.id);
  }

  // C3: the space activity feed is readable by any member (SharedSpaceRead + membership). Most
  // activity `data` blobs are space-scoped ids/names members can already see, but a *propagated*
  // PersonMerge (written by identity-merge-propagation when a user merges people in another space
  // or their personal library) carries cross-space + personal-library UUIDs. Redact PersonMerge
  // down to the member-safe fields the in-space direct merge already uses.
  private redactActivityData(type: SharedSpaceActivityType, data: Record<string, unknown>): Record<string, unknown> {
    if (type !== SharedSpaceActivityType.PersonMerge) {
      return data;
    }
    const safe: Record<string, unknown> = {};
    for (const key of ['personName', 'count', 'activityRole'] as const) {
      if (data[key] !== undefined) {
        safe[key] = data[key];
      }
    }
    return safe;
  }

  async getActivities(
    auth: AuthDto,
    spaceId: string,
    query: { limit?: number; offset?: number },
  ): Promise<SharedSpaceActivityResponseDto[]> {
    await this.requireMembership(auth, spaceId);

    const activities = await this.sharedSpaceRepository.getActivities(spaceId, query.limit ?? 50, query.offset ?? 0);

    // Resolve the CURRENT album name for link/unlink activities. The name is captured at link time,
    // which is empty for the create-album flow (create empty → link → name later) and stale after a
    // rename; resolving it live from the stored albumId keeps the feed accurate.
    const albumIds = [
      ...new Set(
        activities
          .filter((a) => a.type === SharedSpaceActivityType.AlbumLink || a.type === SharedSpaceActivityType.AlbumUnlink)
          .map((a) => (a.data as Record<string, unknown>)?.albumId)
          .filter((id): id is string => typeof id === 'string'),
      ),
    ];
    const albumNameRows = albumIds.length > 0 ? await this.sharedSpaceRepository.getAlbumNamesByIds(albumIds) : [];
    const albumNames = new Map(albumNameRows.map((a) => [a.id, a.albumName]));

    return activities
      .filter((a) => {
        // Drop album link/unlink activities whose album no longer exists — e.g. an abandoned create-flow
        // album that was auto-deleted on navigate-away. Otherwise it lingers with a stale/empty name for
        // an album that's gone. Albums that still exist (incl. unlinked ones) keep their history.
        if (a.type === SharedSpaceActivityType.AlbumLink || a.type === SharedSpaceActivityType.AlbumUnlink) {
          const albumId = (a.data as Record<string, unknown>)?.albumId;
          return typeof albumId === 'string' && albumNames.has(albumId);
        }
        return true;
      })
      .map((a) => {
        const data = this.redactActivityData(a.type as SharedSpaceActivityType, a.data as Record<string, unknown>);
        if (
          (a.type === SharedSpaceActivityType.AlbumLink || a.type === SharedSpaceActivityType.AlbumUnlink) &&
          typeof data.albumId === 'string' &&
          albumNames.has(data.albumId)
        ) {
          data.albumName = albumNames.get(data.albumId);
        }
        return {
          id: a.id,
          type: a.type,
          data,
          createdAt: (a.createdAt as unknown as Date).toISOString(),
          userId: a.userId,
          userName: a.name,
          userEmail: a.email,
          userProfileImagePath: a.profileImagePath,
          userAvatarColor: a.avatarColor,
        };
      });
  }

  async removeAssets(auth: AuthDto, spaceId: string, dto: SharedSpaceAssetRemoveDto): Promise<string[]> {
    await this.requireRole(auth, spaceId, SharedSpaceRole.Editor);

    const space = await this.sharedSpaceRepository.getById(spaceId);
    if (!space) {
      throw new NotFoundException('Space not found');
    }
    // Only DIRECT space members can be removed here. Stack atomicity (#751) then expands from those
    // direct selections — never from an album-projected asset, which would otherwise drag a
    // directly-added stack sibling out of the space (S5). removeAssets deletes only shared_space_asset
    // rows and returns exactly the ids it deleted, so any album-only sibling in the expanded set is a
    // harmless no-op and never counted as removed.
    const directAssetIds = await this.sharedSpaceRepository.getDirectAssetIds(spaceId, dto.assetIds);
    const expandedAssetIds = await this.expandStackAssetIds(directAssetIds);
    const removedAssetIds = await this.sharedSpaceRepository.removeAssets(spaceId, expandedAssetIds);

    // Nothing was actually a direct member (e.g. only album-projected assets were selected) — the
    // removal is a true no-op, so we skip the activity log and thumbnail/face bookkeeping and report
    // that zero assets were removed (the client must not claim success it did not achieve).
    if (removedAssetIds.length === 0) {
      return [];
    }

    const lastAddedAt = await this.sharedSpaceRepository.getLastAssetAddedAt(spaceId);
    const updateData: { lastActivityAt: Date | null; thumbnailAssetId?: null } = {
      lastActivityAt: lastAddedAt ?? null,
    };

    if (space?.thumbnailAssetId && removedAssetIds.includes(space.thumbnailAssetId)) {
      updateData.thumbnailAssetId = null;
    }

    await this.sharedSpaceRepository.update(spaceId, updateData);

    await this.sharedSpaceRepository.logActivity({
      spaceId,
      userId: auth.user.id,
      type: SharedSpaceActivityType.AssetRemove,
      data: { count: removedAssetIds.length },
    });

    // Multi-path face retention: an asset removed as a DIRECT space asset may still
    // be in the space via a linked album or library — only sweep faces for assets
    // that have no other path into the space (space-album feature).
    const orphanedAssetIds = await this.sharedSpaceRepository.getAssetIdsWithoutOtherSpacePath(
      spaceId,
      removedAssetIds,
    );
    if (orphanedAssetIds.length > 0) {
      await this.sharedSpaceRepository.removePersonFacesByAssetIds(spaceId, orphanedAssetIds);
      await this.sharedSpaceRepository.deleteOrphanedPersons(spaceId);
      await this.queueSpacePersonMetadataBackfill();
    }

    return removedAssetIds;
  }

  /**
   * The linked albums that project the given assets into this space. The web uses this to explain why
   * "Remove from space" removed nothing for an album-projected asset (it's present via a linked album,
   * not as a direct member) and to name the album the user should manage it in. Membership-gated: only
   * surfaces albums linked to a space the caller belongs to (the same visibility as `getLinkedAlbums`).
   */
  async getAssetLinkedAlbums(
    auth: AuthDto,
    spaceId: string,
    dto: SharedSpaceAssetRemoveDto,
  ): Promise<SharedSpaceAssetLinkedAlbumDto[]> {
    await this.requireMembership(auth, spaceId);
    if (dto.assetIds.length === 0) {
      return [];
    }
    return this.sharedSpaceRepository.getLinkedAlbumsContainingAssets(spaceId, dto.assetIds);
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

  async getFilteredMapMarkers(auth: AuthDto, dto: FilteredMapMarkerDto): Promise<MapMarkerResponseDto[]> {
    // A space and an album are two different, mutually-exclusive scopes for this endpoint — the
    // space scope requires shared_space_asset membership in that specific space, while the album
    // scope (see below) is bounded by album access alone. Combining them isn't a query this endpoint
    // supports; reject loudly with a 400 rather than guess at an intersection. (Mirrors
    // search.service.ts:122-124.)
    if (dto.spaceId && dto.albumId) {
      throw new BadRequestException('Cannot use both spaceId and albumId');
    }

    if (dto.spaceId) {
      await this.requireAccess({ auth, permission: Permission.SharedSpaceRead, ids: [dto.spaceId] });
    }

    // An album query is scoped by album ACCESS, never by asset owner (see userIds below).
    if (dto.albumId) {
      await this.requireAccess({ auth, permission: Permission.AlbumRead, ids: [dto.albumId] });
    }

    // timelineSpaceIds has TWO independent consumers, and they do NOT want it under the same
    // conditions. Conflating them has now produced the same silently-empty map twice (00a7fd6bac,
    // and again below), so they are computed as two separate predicates.
    //
    // CONSUMER 1 — the space-scope WIDENING (searchAssetBuilder, database.ts:688). It only applies
    // to the plain (non-album, non-space) query, where it widens the result to shared-space assets
    // in the caller's timeline. It is skipped for a favorites query: `isFavorite` is the asset
    // OWNER'S flag, so widening would pin other members' favourites on the caller's favourites map
    // (timeline.service.ts:158-168 refuses the same combination outright rather than answer it).
    //
    // The album map matches the album grid on SCOPE: album ACCESS (AlbumRead, checked above) IS the
    // boundary for an album query — same as the album grid (asset.repository.ts
    // withTimeBucketAssetFilters, a plain album_asset join with no space scoping) and the pre-fork
    // GET /albums/{id}/map-markers endpoint (map.repository.ts). Re-gating an album query by the
    // caller's shared-space timeline visibility on top of that hid pins the grid shows — whenever a
    // shared album asset also lived in a space the caller wasn't a member of, or had simply toggled
    // out of their timeline (#656). (It matches the grid on VISIBILITY too — see the `visibility`
    // option below.) On the album path timelineSpaceIds is therefore inert for the gate (albumAccessIsBoundary
    // skips albumSharedSpaceScope, and with userIds unset the widening arm cannot fire either).
    const spaceScopeWidensToTimelineSpaces = !dto.spaceId && dto.withSharedSpaces === true && dto.isFavorite !== true;

    // CONSUMER 2 — scoped person-token resolution. resolveScopedMapPersonFilters forwards
    // timelineSpaceIds to faceIdentityRepository.resolveScopedPersonTokens to resolve
    // `space-person:<id>` tokens: face-identity.repository.ts's spaceMatchesScope requires
    // timelineSpaceIds.size > 0 whenever withSharedSpaces is truthy, or it treats the token as
    // inaccessible -> hasInaccessibleToken -> forceEmptyResult -> ZERO pins. This consumer is
    // conditioned on neither albumId nor isFavorite — a caller can combine
    // ?withSharedSpaces=true&isFavorite=true&personIds=space-person:<id> (the /photos favourite chip
    // and person chip are one-click co-reachable, and its map icon carries both), just as they can
    // combine ?albumId=&withSharedSpaces=true&personIds=space-person:<id>. Narrowing this predicate
    // to the widening one starves it and silently empties the map for a legitimate space member —
    // that was the albumId bug fixed in 00a7fd6bac, and the isFavorite bug fixed here. So do NOT
    // re-fold this back into the condition above.
    const hasScopedPersonTokens = !dto.spaceId && !!dto.personIds?.some((token) => token.includes(':'));
    const personScopeNeedsTimelineSpaceIds = dto.withSharedSpaces === true && hasScopedPersonTokens;

    let timelineSpaceIds: string[] | undefined;
    if (spaceScopeWidensToTimelineSpaces || personScopeNeedsTimelineSpaceIds) {
      const spaceRows = await this.sharedSpaceRepository.getSpaceIdsForTimeline(auth.user.id);
      if (spaceRows.length > 0) {
        timelineSpaceIds = spaceRows.map((row) => row.spaceId);
      }
    }

    const scopedPersonFilters = await this.resolveScopedMapPersonFilters(auth, {
      personIds: dto.spaceId ? undefined : dto.personIds,
      spacePersonIds: dto.spaceId ? dto.personIds : undefined,
      withSharedSpaces: dto.withSharedSpaces,
      timelineSpaceIds,
      spaceId: dto.spaceId,
    });

    const markers = await this.sharedSpaceRepository.getFilteredMapMarkers({
      // Album ACCESS is the scope (checked above), never asset ownership: leaving userIds set would
      // hide the album owner's pins from a viewer of a shared album — the issue #656 bug class, which
      // album.service.ts:112-123 calls out by name. albumAccessIsBoundary opts the album branch out of
      // albumSharedSpaceScope's shared-space re-gate (database.ts:713): album membership is already the
      // boundary here, matching the grid and the old map endpoint — see the comment above.
      userIds: dto.spaceId || dto.albumId ? undefined : [auth.user.id],
      spaceId: dto.spaceId,
      albumAccessIsBoundary: !!dto.albumId,
      // Consumer 1 only (see above): a favorites query resolved timelineSpaceIds purely to make its
      // space-person tokens resolvable, and must NOT be widened by it — the query stays owner-scoped.
      timelineSpaceIds: spaceScopeWidensToTimelineSpaces ? timelineSpaceIds : undefined,
      personIds: scopedPersonFilters.personIds,
      spacePersonIds: scopedPersonFilters.spacePersonIds,
      identityIds: scopedPersonFilters.identityIds,
      forceEmptyResult: scopedPersonFilters.forceEmptyResult,
      tagIds: dto.tagIds,
      make: dto.make,
      model: dto.model,
      rating: dto.rating,
      // `rating` is documented as a MINIMUM. Without this flag searchAssetBuilder falls to its
      // `=` branch, so markers matched exact ratings while every other surface matched `>=`.
      ratingIsMinimum: dto.rating === undefined ? undefined : true,
      description: dto.description,
      originalFileName: dto.originalFileName,
      ocr: dto.ocr,
      type: dto.type === 'IMAGE' ? AssetType.Image : dto.type === 'VIDEO' ? AssetType.Video : undefined,
      takenAfter: dto.takenAfter,
      takenBefore: dto.takenBefore,
      isFavorite: dto.isFavorite,
      isNotInAlbum: dto.isNotInAlbum,
      isInAlbum: dto.isInAlbum,
      city: dto.city,
      country: dto.country,
      lensModel: dto.lensModel,
      state: dto.state,
      ownerId: dto.ownerId,
      albumIds: dto.albumId ? [dto.albumId] : undefined,
      // D4: an album query matches the album GRID, which shows Archive | Timeline
      // (withDefaultVisibility, database.ts) — an archived, geotagged album asset appeared in the
      // grid with no pin on the map. The accepted caveat is that another member's archived asset in
      // the album now gets a pin, exactly as the grid already shows it. The widening is EXACTLY one
      // visibility state: Hidden and Locked stay out (the mode is a two-value IN, not the absence of
      // a clause, which would admit both), and Trashed stays out via the deletedAt predicate.
      // Every other branch (plain map, space map) is unchanged: Timeline only.
      visibility: dto.albumId ? 'timeline-or-archive' : AssetVisibility.Timeline,
      // D1: personMatchAny/tagMatchAny are deliberately NOT set. This was the only caller in the
      // server that asked searchAssetBuilder for OR matching (database.ts:721,724) — every timeline
      // path ANDs. The map is reached from a surface whose chips it carries verbatim (/photos' map
      // icon forwards ?people=alice,bob), so ORing them showed ~double the pins for identical chips,
      // made the cluster panel (which ANDs) contradict its own pin count, and made "Add all N to…"
      // advertise the OR count while collecting the AND set. The repository still supports OR for
      // callers that want it; the map simply stops asking.
    });

    return markers.map((marker) => ({
      id: marker.id,
      lat: marker.lat,
      lon: marker.lon,
      city: marker.city ?? null,
      state: marker.state ?? null,
      country: marker.country ?? null,
    }));
  }

  private async resolveScopedMapPersonFilters(
    auth: AuthDto,
    filters: {
      personIds?: string[];
      spacePersonIds?: string[];
      identityIds?: string[];
      forceEmptyResult?: boolean;
      withSharedSpaces?: boolean;
      timelineSpaceIds?: string[];
      spaceId?: string;
    },
  ) {
    const tokens = filters.personIds?.filter(Boolean) ?? [];
    const hasScopedTokens = tokens.some((token) => token.includes(':'));

    if (tokens.length === 0 || !hasScopedTokens) {
      return filters;
    }

    const resolution = await this.faceIdentityRepository.resolveScopedPersonTokens({
      userId: auth.user.id,
      tokens,
      scope: {
        withSharedSpaces: filters.withSharedSpaces,
        timelineSpaceIds: filters.timelineSpaceIds,
        spaceId: filters.spaceId,
      },
    });

    return {
      ...filters,
      personIds: resolution.legacyPersonIds,
      identityIds: resolution.identityIds,
      spacePersonIds: [...new Set([...(filters.spacePersonIds ?? []), ...resolution.legacySpacePersonIds])],
      forceEmptyResult: filters.forceEmptyResult || resolution.hasInaccessibleToken,
    };
  }

  async getSpacePeople(
    auth: AuthDto,
    spaceId: string,
    query?: SpacePeopleQueryDto,
  ): Promise<SharedSpacePersonResponseDto[]> {
    await this.requireMembership(auth, spaceId);

    const space = await this.sharedSpaceRepository.getById(spaceId);
    if (!space?.faceRecognitionEnabled) {
      return [];
    }

    const { machineLearning } = await this.getConfig({ withCache: false });
    const persons = await this.sharedSpaceRepository.getPersonsBySpaceId(spaceId, {
      withHidden: query?.withHidden ?? false,
      petsEnabled: space.petsEnabled,
      limit: query?.limit,
      offset: query?.offset,
      named: query?.named,
      name: query?.name,
      takenAfter: query?.takenAfter,
      takenBefore: query?.takenBefore,
      minimumFaceCount: machineLearning.facialRecognition.minFaces,
    });

    const aliases =
      persons.length > 0 ? await this.sharedSpaceRepository.getAliasesBySpaceAndUser(spaceId, auth.user.id) : [];
    const aliasMap = new Map(aliases.map((a) => [a.personId, a.alias]));

    return persons.map((person) => this.mapSpacePerson(person, aliasMap.get(person.id) ?? null));
  }

  async getSpacePeopleStatistics(
    auth: AuthDto,
    spaceId: string,
    query?: SpacePeopleQueryDto,
  ): Promise<SharedSpacePeopleStatisticsResponseDto> {
    await this.requireMembership(auth, spaceId);

    const space = await this.sharedSpaceRepository.getById(spaceId);
    if (!space?.faceRecognitionEnabled) {
      return { total: 0, hidden: 0, detectedFaceCount: 0 };
    }

    const { machineLearning } = await this.getConfig({ withCache: false });
    return this.sharedSpaceRepository.countPersonsBySpaceId(spaceId, {
      petsEnabled: space.petsEnabled,
      named: query?.named,
      name: query?.name,
      takenAfter: query?.takenAfter,
      takenBefore: query?.takenBefore,
      minimumFaceCount: machineLearning.facialRecognition.minFaces,
    });
  }

  async getSpacePeopleFaceStatistics(
    auth: AuthDto,
    spaceId: string,
    query?: SpacePeopleQueryDto,
  ): Promise<PeopleFaceStatisticsResponseDto> {
    await this.requireMembership(auth, spaceId);

    const space = await this.sharedSpaceRepository.getById(spaceId);
    if (!space?.faceRecognitionEnabled) {
      return {
        detectedFaceCount: 0,
        assignedVisibleFaceCount: 0,
        namedVisiblePersonCount: 0,
        assignedHiddenFaceCount: 0,
        unassignedFaceCount: 0,
      };
    }

    const { machineLearning } = await this.getConfig({ withCache: false });
    return this.sharedSpaceRepository.getPeopleFaceStatisticsBySpaceId(spaceId, {
      petsEnabled: space.petsEnabled,
      named: query?.named,
      name: query?.name,
      takenAfter: query?.takenAfter,
      takenBefore: query?.takenBefore,
      minimumFaceCount: machineLearning.facialRecognition.minFaces,
    });
  }

  async getSpacePersonFaces(
    auth: AuthDto,
    spaceId: string,
    personId: string,
    dto: PersonFacePageQueryDto,
  ): Promise<PersonFacePageResponseDto> {
    await this.requireMembership(auth, spaceId);
    const person = await this.sharedSpaceRepository.getPersonById(personId);
    if (!person || person.spaceId !== spaceId) {
      throw new BadRequestException('Person not found');
    }

    const take = dto.size;
    const skip = (dto.page - 1) * dto.size;
    const rows = await this.sharedSpaceRepository.getSpaceRepresentativeFaces({ spaceId, personId, take, skip });
    const page = rows.slice(0, take);

    return {
      faces: page.map((face) => ({
        id: face.id,
        assetId: face.assetId,
        imageHeight: face.imageHeight,
        imageWidth: face.imageWidth,
        boundingBoxX1: face.boundingBoxX1,
        boundingBoxX2: face.boundingBoxX2,
        boundingBoxY1: face.boundingBoxY1,
        boundingBoxY2: face.boundingBoxY2,
        sourceType: face.sourceType,
        fileCreatedAt: asDateTimeString(face.fileCreatedAt) ?? undefined,
        isRepresentative: face.id === person.representativeFaceId,
      })),
      hasNextPage: rows.length > take,
    };
  }

  async getSpacePersonFaceSuggestions(
    auth: AuthDto,
    spaceId: string,
    personId: string,
    dto: PersonFaceSuggestionPageQueryDto,
  ): Promise<PersonFaceSuggestionPageResponseDto> {
    const member = await this.requireMembership(auth, spaceId);
    if (ROLE_HIERARCHY[member.role as SharedSpaceRole] < ROLE_HIERARCHY[SharedSpaceRole.Editor]) {
      return { total: 0, items: [] };
    }

    await this.requireSpacePersonInSpace(spaceId, personId);

    if (!(await this.areSpacePersonSuggestionsEnabled({ withCache: true }))) {
      return { total: 0, items: [] };
    }

    const distanceConfig = await this.getFaceSuggestionDistanceConfig();
    const result = await this.facePersonVerdictRepository.getPendingForSpacePerson(spaceId, personId, {
      ...distanceConfig,
      page: dto.page,
      size: dto.size,
    });

    return {
      total: result.total,
      items: result.items.map((item) => ({
        assetFaceId: item.assetFaceId,
        assetId: item.assetId,
        distance: item.distance,
        imageWidth: item.imageWidth,
        imageHeight: item.imageHeight,
        boundingBoxX1: item.boundingBoxX1,
        boundingBoxX2: item.boundingBoxX2,
        boundingBoxY1: item.boundingBoxY1,
        boundingBoxY2: item.boundingBoxY2,
        fileCreatedAt: item.fileCreatedAt?.toISOString(),
      })),
    };
  }

  // S11 (F24): the return value is the acted/no-op signal the controller maps to 200/204 — mirrors the
  // personal confirmFaceSuggestion twin.
  async confirmSpacePersonFaceSuggestion(
    auth: AuthDto,
    spaceId: string,
    personId: string,
    assetFaceId: string,
  ): Promise<boolean> {
    await this.requireRole(auth, spaceId, SharedSpaceRole.Editor);
    const person = await this.requireSpacePersonInSpace(spaceId, personId);

    if (!(await this.areSpacePersonSuggestionsEnabled({ withCache: true }))) {
      return false;
    }

    const distanceConfig = await this.getFaceSuggestionDistanceConfig();
    const isPending = await this.facePersonVerdictRepository.hasPendingForSpacePerson(
      spaceId,
      person.id,
      assetFaceId,
      distanceConfig,
    );
    if (!isPending) {
      return false;
    }

    // Slice 5 (F10): the four writes below used to be autocommit — a crash between replaceFaceIdentity and
    // addPersonFaces left a 'manual'-linked face attached to nobody, excluded from every suggestion read and
    // every cleanup scan, with no repair path (processSpaceFaceMatch early-returns on `!face.personId`). One
    // transaction makes the whole confirm all-or-nothing, mirroring the personal confirm path. Every call
    // below threads `trx` — never `this.db` inside this callback (issue #595).
    const claimed = await this.databaseRepository.transaction(async (trx) => {
      // Ensured up front, before the claim, so claimPendingForSpacePerson's own negative-verdict
      // exclusion (matched by identityId as well as spacePersonId) has a non-null identityId to join
      // against even when this confirm turns out to be a no-op below.
      await this.faceIdentityRepository.ensureSpacePersonIdentity(person.id, trx);
      // Claim the queue row first so a double-submit resolves exactly once. No 'confirmed' status is written:
      // the durable positive verdict is the manual identity link set inside linkFaceToSpacePerson below.
      // Slice 3 (F5): pass the SAME band `hasPendingForSpacePerson` just checked, so the claim itself is gated
      // by the identical eligibility — not just the read that preceded it.
      const claimed = await this.facePersonVerdictRepository.claimPendingForSpacePerson(
        person.id,
        assetFaceId,
        distanceConfig,
        trx,
      );
      if (claimed === 0) {
        return claimed;
      }

      // The suggestion confirm only ever handles an unassigned face (that is what made it pending in the
      // first place), so it always writes the identity — see linkFaceToSpacePerson's doc comment for the one
      // caller that passes false. ensureSpacePersonIdentity above already created it; this re-fetches the
      // same row (idempotent) so linkFaceToSpacePerson stays the single implementation of the write.
      await this.linkFaceToSpacePerson(trx, person, assetFaceId, { writeIdentity: true });
      return claimed;
    });
    return claimed > 0;
  }

  /**
   * The single implementation of "this face belongs to this space person" (spec §6.3).
   *
   * `writeIdentity: false` is §6.3.1 row 3 — the face already belongs to an owner `person`
   * carrying a different identity. Writing the identity there would re-point an identity the
   * OWNER's person depends on, and `applyResolvedPersonMetadata` resolves the owner's own view
   * of names and ages through exactly that identity. Space-person reads go through
   * `shared_space_person_face`, not the identity layer, so the projection alone is enough for
   * the space to show the new name while the owner's library stays untouched.
   */
  private async linkFaceToSpacePerson(
    trx: Transaction<DB>,
    person: SharedSpacePerson,
    assetFaceId: string,
    { writeIdentity }: { writeIdentity: boolean },
  ): Promise<void> {
    // §6.3.1 (revised): the identity is now resolved on BOTH paths, not just the writeIdentity one.
    // Propagating the edit to the owner's `asset_face.personId` needs an identity to bridge the space
    // person onto a person the owner owns, so a space person that has never carried one gets it here.
    const identity = await this.faceIdentityRepository.ensureSpacePersonIdentity(person.id, trx);

    if (writeIdentity) {
      await this.faceIdentityRepository.replaceFaceIdentity(
        { assetFaceId, identityId: identity.id, source: 'manual' },
        trx,
      );
      // Slice 8 (F15): the editor just stated a fact ("this face IS this space person") that contradicts
      // any durable rejected/ignored row for this SAME target. As with the personal confirm,
      // claimPendingForSpacePerson's own eligibility gate already refuses the claim whenever such a row
      // exists (identical spacePersonId/identityId match), so this call is defense-in-depth rather than
      // something a fresh confirm can currently observe deleting a row. Scoped to this space person only.
      await this.facePersonVerdictRepository.clearNegativeForTarget(
        { spacePersonId: person.id, identityId: identity.id },
        [assetFaceId],
        trx,
      );
    }
    await this.facePersonVerdictRepository.resolveAssignedFace(assetFaceId, trx);
    // D3: write the space projection so getAssignedFaceIdsForSpace excludes this face from the same space's
    // next scan, for every space person — not just this one. addPersonFaces is onConflict().doNothing(), so
    // this is idempotent if a concurrent face-match backfill already wrote the same row.
    await this.sharedSpaceRepository.addPersonFaces([{ personId: person.id, assetFaceId }], undefined, trx);

    // §6.3.1 (revised): propagate the attach into the OWNER's layer so the space and the owner's own
    // library agree about who is in the photo. This deliberately reverses the original decision to
    // keep `asset_face.personId` untouched -- see the section for why the insulated model was
    // dropped. The owner may have never named this human, in which case a person row is created for
    // them (an editor naming a face can therefore add a person to the owner's People page).
    const ownerLink = await this.facePersonVerdictRepository.getFaceOwnerLink(assetFaceId, trx);
    if (ownerLink) {
      const ownerPerson = await this.personRepository.getOrCreateOwnerPersonForIdentity(
        {
          ownerId: ownerLink.assetOwnerId,
          identityId: identity.id,
          name: person.name,
          type: person.type,
        },
        trx,
      );
      await this.personRepository.setFaceOwnerPerson({ assetFaceId, personId: ownerPerson.id }, trx);
    }
  }

  /**
   * #734 follow-up (spec §6.3): attach a space person to a face directly — no pending ML
   * suggestion required, unlike `confirmSpacePersonFaceSuggestion` above.
   *
   * The transaction below shares `linkFaceToSpacePerson` with that method (Slice 2), so the two
   * can never drift on what "this face belongs to this space person" means.
   *
   * Idempotent: `addPersonFaces` is onConflict-doNothing and `replaceFaceIdentity` upserts, so
   * a double-submit is a no-op. Returns whether it acted, matching the S11 convention on the
   * sibling confirm/reject routes (a 200-vs-204 status signal is unreadable through
   * @oazapfts/runtime's ok()).
   */
  async attachFaceToSpacePerson(
    auth: AuthDto,
    spaceId: string,
    personId: string,
    assetFaceId: string,
  ): Promise<boolean> {
    await this.requireRole(auth, spaceId, SharedSpaceRole.Editor);
    const person = await this.requireSpacePersonInSpace(spaceId, personId);

    if (!(await this.facePersonVerdictRepository.isFaceAssignableInSpace(spaceId, assetFaceId))) {
      throw new BadRequestException('Face not found');
    }

    return this.databaseRepository.transaction(async (trx) => {
      // F-37: lock first, before any read below, so a second concurrent attach on this SAME face
      // waits for this transaction to commit rather than racing its own read of who holds the
      // face right now.
      await this.facePersonVerdictRepository.lockFaceForAssignment(assetFaceId, trx);

      // §6.3.1: does this face already belong to one of the OWNER's own people? If so, and that
      // person's identity differs from (or is absent, and so can never equal) the target space
      // person's own identity, the attach is still granted but must NOT rewrite the face's global
      // identity — see linkFaceToSpacePerson's doc comment for why the projection alone suffices.
      const ownerLink = await this.facePersonVerdictRepository.getFaceOwnerLink(assetFaceId, trx);
      // §6.3.1 (revised): row 3 -- "the owner already named this face as someone else" -- no longer
      // skips the identity write. Propagating only `asset_face.personId` while pinning the identity
      // would leave the owner's OWN two layers disagreeing about one face: the person row would say
      // "Uncle Tom" while `face_identity_face` still said "Dad", and applyResolvedPersonMetadata
      // resolves the owner's names and birthdays through the identity. That split is precisely what
      // the original §6.3.1 existed to prevent, so the editor's edit now moves both layers together.
      // The negative-verdict write that row 3 needed goes with it: linkFaceToSpacePerson's
      // clearNegativeForTarget is the correct verdict once the identity actually matches.

      // F-13 (spec §6.3): reassign — attaching a face already held by a DIFFERENT space person in
      // this same space moves it. Remove every current holder's projection row (a plain re-attach
      // to the SAME person is a harmless no-op here, since linkFaceToSpacePerson re-adds it below),
      // recount the ones that actually changed (§6.4), and record a negative verdict for each so
      // the suggestion pipeline does not immediately re-offer the face back to them.
      const allRemovedPersonIds = await this.sharedSpaceRepository.removePersonFaceAssignmentsForSpaceFace(
        spaceId,
        assetFaceId,
        trx,
      );
      const removedPersonIds = allRemovedPersonIds.filter((removedPersonId) => removedPersonId !== person.id);
      if (removedPersonIds.length > 0) {
        await this.sharedSpaceRepository.recountPersons(removedPersonIds, trx);
        for (const removedPersonId of removedPersonIds) {
          await this.facePersonVerdictRepository.markRejectedForSpacePerson(
            removedPersonId,
            assetFaceId,
            { source: 'suggestion', actorId: auth.user.id },
            trx,
          );
        }
      }

      await this.linkFaceToSpacePerson(trx, person, assetFaceId, { writeIdentity: true });

      // §6.7 (F-24/F-26): attribute the attach in the space's activity feed, unless the actor
      // owns the asset -- an owner naming their own photos should not flood their own feed,
      // matching #992's asset_edit rule. Ownership comes from the ASSET (ownerLink.assetOwnerId
      // above), never from the actor's space role. Written inside this same transaction so a row
      // can never describe a link that then rolled back.
      if (ownerLink?.assetOwnerId !== auth.user.id) {
        await this.sharedSpaceRepository.logActivity(
          {
            spaceId,
            userId: auth.user.id,
            type: SharedSpaceActivityType.PersonFaceAssign,
            data: { personId: person.id, personName: person.name, count: 1 },
          },
          trx,
        );
      }

      return true;
    });
  }

  /**
   * Spec §6.4 (Slice 4): detach a face from a space person. Removes only the space's own
   * `shared_space_person_face` projection row — deliberately leaves `face_identity_face` alone,
   * or the face's global identity would be blanked for every other space sharing it (§5.1, F-22).
   *
   * Writes a negative verdict first so the suggestion pipeline does not immediately re-offer the
   * face back to this same person, mirroring the reassign arm of `attachFaceToSpacePerson`.
   *
   * F-38: `isFaceAssignableInSpace` is re-checked here at write time, never trusted from the
   * §6.1 read — a face the read returned a moment ago may have left the space since.
   */
  async detachFaceFromSpacePerson(
    auth: AuthDto,
    spaceId: string,
    personId: string,
    assetFaceId: string,
  ): Promise<boolean> {
    await this.requireRole(auth, spaceId, SharedSpaceRole.Editor);
    const person = await this.requireSpacePersonInSpace(spaceId, personId);

    if (!(await this.facePersonVerdictRepository.isFaceAssignableInSpace(spaceId, assetFaceId))) {
      throw new BadRequestException('Face not found');
    }

    return this.databaseRepository.transaction(async (trx) => {
      // §6.7: read before the face's projection row is removed below, for the asset owner id it
      // carries. Since §6.3.1 was revised the personId/identityId half is used too -- see the
      // owner-layer clear at the end of this transaction.
      const ownerLink = await this.facePersonVerdictRepository.getFaceOwnerLink(assetFaceId, trx);

      await this.facePersonVerdictRepository.markRejectedForSpacePerson(
        person.id,
        assetFaceId,
        { source: 'suggestion', actorId: auth.user.id },
        trx,
      );
      await this.sharedSpaceRepository.removePersonFace(person.id, assetFaceId, trx);

      // §6.3.1 (revised): propagate the detach into the OWNER's layer, so a face unassigned in the
      // space also stops being tagged on the owner's own copy of the photo. Without this the space
      // projection and `asset_face.personId` disagree, and the asset-detail People row -- which is
      // seeded from `asset_face.personId` -- keeps showing the person the editor just removed.
      //
      // The identity comparison is the guard: it clears the tag ONLY when the owner's person is the
      // same human as the space person being detached. An editor detaching "Uncle Tom" must never
      // null out the owner's unrelated "Dad" tag on that face, so a mismatch is left alone.
      if (ownerLink?.personId && person.identityId && ownerLink.identityId === person.identityId) {
        await this.personRepository.setFaceOwnerPerson(
          { assetFaceId, personId: null, expectedPersonId: ownerLink.personId },
          trx,
        );
      }

      // §6.7 (F-25/F-26): the detach twin of attachFaceToSpacePerson's attribution above --
      // same owner-self exemption, same in-transaction write.
      if (ownerLink?.assetOwnerId !== auth.user.id) {
        await this.sharedSpaceRepository.logActivity(
          {
            spaceId,
            userId: auth.user.id,
            type: SharedSpaceActivityType.PersonFaceDetach,
            data: { personId: person.id, personName: person.name, count: 1 },
          },
          trx,
        );
      }

      return true;
    });
  }

  /**
   * Spec §6.2 (Slice 4): create a space person, optionally attaching a seed face ("add a name").
   *
   * When `assetFaceId` is present this is create-and-attach, and it runs as ONE transaction
   * (F-15) — a crash between the create and the attach would leave a nameless orphan person in
   * the space's people list, the same failure mode `confirmSpacePersonFaceSuggestion` guards
   * against for the suggestion path.
   *
   * F-33: the `(spaceId, identityId)` unique index is the trap. A face left over from an earlier
   * attach/detach cycle (Task 1 deliberately never touches `face_identity_face`) or from ML
   * backfill may already resolve to an identity that some OTHER space person here already holds.
   * `createOrGetPersonForIdentity` is used whenever the seed face already carries an identity, so
   * that case returns the existing person instead of racing a plain insert into a duplicate key.
   */
  async createSpacePerson(
    auth: AuthDto,
    spaceId: string,
    dto: { name?: string; assetFaceId?: string },
  ): Promise<SharedSpacePersonResponseDto> {
    await this.requireRole(auth, spaceId, SharedSpaceRole.Editor);

    if (!dto.assetFaceId) {
      const created = await this.sharedSpaceRepository.createPerson({ spaceId, name: dto.name ?? '' });
      return this.mapSpacePerson(created, null);
    }

    const assetFaceId = dto.assetFaceId;
    if (!(await this.facePersonVerdictRepository.isFaceAssignableInSpace(spaceId, assetFaceId))) {
      throw new BadRequestException('Face not found');
    }

    const person = await this.databaseRepository.transaction(async (trx) => {
      // Mirrors attachFaceToSpacePerson's F-37 lock: two concurrent creates seeded from the SAME
      // face must not both succeed with two different new people each holding a projection row.
      await this.facePersonVerdictRepository.lockFaceForAssignment(assetFaceId, trx);

      const existingIdentityId = await this.faceIdentityRepository.getIdentityIdForFace(assetFaceId, trx);
      const created = existingIdentityId
        ? await this.sharedSpaceRepository.createOrGetPersonForIdentity(
            { spaceId, identityId: existingIdentityId, name: dto.name ?? '' },
            trx,
          )
        : await this.sharedSpaceRepository.createPerson({ spaceId, name: dto.name ?? '' }, trx);

      await this.linkFaceToSpacePerson(trx, created, assetFaceId, { writeIdentity: true });
      return created;
    });

    const alias = await this.sharedSpaceRepository.getAlias(person.id, auth.user.id);
    return this.mapSpacePerson(person, alias?.alias ?? null);
  }

  /**
   * Spec §6.1 (Slice 3): the face boxes on one asset, space-scoped. Editor-only — the response
   * exposes faces nobody has named yet, which a Viewer has no business seeing.
   *
   * The hidden-person exclusion lives in the repository read (`getAssetFacesForSpace`) so it
   * cannot drift from `isFaceAssignableInSpace`'s write-side exclusion — an editor must never be
   * able to attach a face this list would not show them (F-8/F-9).
   *
   * Boxes are STORED against the original bytes, and the client renders the edited preview and
   * crops each face out of it, so they are projected on the way out — the same transform the
   * owner's twin read applies (`PersonService.getFacesById` → `mapFaces`), and the exact inverse of
   * the one `createSpaceAssetFace` applies on the way in. Returning them raw put this endpoint on
   * the opposite convention from its own write, so every crop in the editor's panel was cut from
   * the wrong region of an edited asset — and #992 is what makes editing a MEMBER's asset possible,
   * so an edited member asset is an ordinary case here, not an exotic one.
   */
  async getSpaceAssetFaces(auth: AuthDto, spaceId: string, assetId: string): Promise<SpaceAssetFaceResponseDto[]> {
    await this.requireRole(auth, spaceId, SharedSpaceRole.Editor);

    if (!(await this.sharedSpaceRepository.isAssetInSpace(spaceId, assetId))) {
      // Deliberate non-disclosure, matching attachFaceToSpacePerson's 'Face not found' — an editor
      // probing ids learns nothing about whether the asset exists at all.
      throw new BadRequestException('Asset not found');
    }

    const faces = await this.sharedSpaceRepository.getAssetFacesForSpace(spaceId, assetId);
    if (faces.length === 0) {
      return [];
    }

    const asset = await this.assetRepository.getById(assetId, { edits: true, exifInfo: true });
    const edits = asset?.edits ?? [];
    const dimensions = asset?.exifInfo ? getDimensions(asset.exifInfo) : { width: 0, height: 0 };
    // `transformFaceBoundingBox` is already a no-op without edits; the dimension check is the one
    // extra guard, because an edited asset with no exif dimensions would otherwise scale every box
    // by zero and collapse it to a point. A stored box is wrong-but-recognisable there, a collapsed
    // one is not. The write twin refuses outright instead (F-17) — a read still has to render.
    const canProject = dimensions.width > 0 && dimensions.height > 0;

    return faces.map((face) => {
      const box = {
        boundingBoxX1: face.boundingBoxX1,
        boundingBoxY1: face.boundingBoxY1,
        boundingBoxX2: face.boundingBoxX2,
        boundingBoxY2: face.boundingBoxY2,
        imageWidth: face.imageWidth,
        imageHeight: face.imageHeight,
      };

      return {
        id: face.id,
        ...(canProject ? transformFaceBoundingBox(box, edits, dimensions) : box),
        spacePersonId: face.spacePersonId,
        spacePersonName: face.spacePersonName,
        isEditorDrawn: face.isEditorDrawn,
      };
    });
  }

  /**
   * Spec §6.5 (Slice 6, Task 2): draw a face box on a member's asset.
   *
   * Coordinates arrive in the (possibly edited) PREVIEW image's space — #992 lets an editor
   * rotate a member's asset, so a rotated preview is a likely path, not an exotic one (F-16).
   * `convertFaceBoxToOriginalImageSpace` is the SAME transform `PersonService.createFace` uses
   * for the owner path, so the two can never drift on this geometry (a drift here silently
   * misplaces boxes).
   *
   * The created face gets `personId = NULL` (never the owner's), `sourceType = Manual`, and
   * `createdBy = auth.user.id` — the column §6.6 uses to decide whether the editor may later
   * delete it, never `sourceType` (see that section's doc comment for why). It is then attached
   * to the target space person through `linkFaceToSpacePerson`, always with `writeIdentity:
   * true`: a face this call just created cannot already belong to one of the owner's own people
   * (§6.3.1), so the identity-skip override case never applies here.
   */
  async createSpaceAssetFace(
    auth: AuthDto,
    spaceId: string,
    assetId: string,
    dto: {
      x: number;
      y: number;
      width: number;
      height: number;
      imageWidth: number;
      imageHeight: number;
      spacePersonId: string;
    },
  ): Promise<SpaceAssetFaceResponseDto> {
    await this.requireRole(auth, spaceId, SharedSpaceRole.Editor);

    if (!(await this.sharedSpaceRepository.isAssetInSpace(spaceId, assetId))) {
      // Deliberate non-disclosure, matching getSpaceAssetFaces/attachFaceToSpacePerson's
      // 'Asset not found' / 'Face not found' — an editor probing ids learns nothing about
      // whether the asset exists at all.
      throw new BadRequestException('Asset not found');
    }
    const person = await this.requireSpacePersonInSpace(spaceId, dto.spacePersonId);

    const asset = await this.assetRepository.getById(assetId, { edits: true, exifInfo: true });
    if (!asset) {
      throw new NotFoundException('Asset not found');
    }

    const { topLeft, bottomRight, imageWidth, imageHeight } = convertFaceBoxToOriginalImageSpace(dto, asset);
    const boundingBoxX1 = Math.round(topLeft.x);
    const boundingBoxY1 = Math.round(topLeft.y);
    const boundingBoxX2 = Math.round(bottomRight.x);
    const boundingBoxY2 = Math.round(bottomRight.y);

    const faceId = await this.databaseRepository.transaction(async (trx) => {
      const faceId = await this.personRepository.createAssetFace(
        {
          assetId,
          personId: null,
          imageHeight,
          imageWidth,
          boundingBoxX1,
          boundingBoxX2,
          boundingBoxY1,
          boundingBoxY2,
          sourceType: SourceType.Manual,
          createdBy: auth.user.id,
        },
        trx,
      );

      await this.linkFaceToSpacePerson(trx, person, faceId, { writeIdentity: true });
      return faceId;
    });

    return {
      id: faceId,
      boundingBoxX1,
      boundingBoxY1,
      boundingBoxX2,
      boundingBoxY2,
      imageWidth,
      imageHeight,
      spacePersonId: person.id,
      spacePersonName: person.name,
      // This call is the only writer of a face with createdBy set to the caller (§6.5) — always
      // editor-drawn, never a detection.
      isEditorDrawn: true,
    };
  }

  /**
   * Spec §6.6 (Slice 6, Task 3): delete a face box an EDITOR of this space drew (§6.5).
   *
   * Deletable iff `asset_face.createdBy IS NOT NULL` AND the face is reachable in a space where
   * the actor is Owner/Editor — NEVER `sourceType`. `PersonService.createFace` already writes
   * `SourceType.Manual` for an OWNER-drawn box too, so gating on `sourceType === Manual` would let
   * a space editor delete boxes the owner drew by hand — the exact regression this whole design
   * exists to avoid. A detected face (`createdBy IS NULL`) is refused: `FaceDelete` stays
   * owner-only for those.
   *
   * Hard-deletes the row. `shared_space_person_face` and `face_identity_face` both cascade away
   * (`ON DELETE CASCADE`) in EVERY space holding this face, not just this one — the box itself is
   * being destroyed, not merely detached here — but the cascade does not recount, so every
   * affected space person is snapshotted first and recounted afterward (mirrors §6.4's detach).
   */
  async deleteSpaceAssetFace(auth: AuthDto, spaceId: string, assetFaceId: string): Promise<void> {
    await this.requireRole(auth, spaceId, SharedSpaceRole.Editor);

    if (!(await this.facePersonVerdictRepository.isFaceReachableInSpace(spaceId, assetFaceId))) {
      // Deliberate non-disclosure, matching the sibling attach/detach/draw routes.
      throw new BadRequestException('Face not found');
    }

    const createdBy = await this.facePersonVerdictRepository.getFaceCreatedBy(assetFaceId);
    if (!createdBy) {
      // Not editor-drawn (a detection, or an existing pre-Slice-6 row) — refused, same message as
      // above so an editor cannot distinguish "wrong space" from "not deletable" by probing ids.
      throw new BadRequestException('Face not found');
    }

    await this.databaseRepository.transaction(async (trx) => {
      const personIds = await this.sharedSpaceRepository.getPersonIdsHoldingFace(assetFaceId, trx);
      await this.personRepository.deleteAssetFace(assetFaceId, trx);
      if (personIds.length > 0) {
        await this.sharedSpaceRepository.recountPersons(personIds, trx);
      }
    });
  }

  // D9/D2: reachability (RBAC — is this face's asset in the space at all), not pendingness, gates a space
  // reject/ignore; then the upsert runs unconditionally, same as the personal path. This matches the personal
  // path's semantics (a reject/ignore on a drained-but-otherwise-valid target still records) while still
  // refusing a face whose asset has genuinely left the space. Carries the target's identity + acting user,
  // same as a cleanup verdict, so the negative-verdict row answers "not this person" everywhere the identity
  // is checked and records who made the call.
  // S11 (F24): returns whether a row was actually written — the acted/no-op signal the controller maps to
  // 200/204, mirroring the personal reject/ignore twins.
  private async resolveSpacePersonFaceSuggestion(
    auth: AuthDto,
    spaceId: string,
    personId: string,
    assetFaceId: string,
    action: 'rejected' | 'ignored',
  ): Promise<boolean> {
    await this.requireRole(auth, spaceId, SharedSpaceRole.Editor);
    const person = await this.requireSpacePersonInSpace(spaceId, personId);
    const reachable = await this.facePersonVerdictRepository.isFaceReachableInSpace(spaceId, assetFaceId);
    if (!reachable) {
      return false;
    }

    const identity = await this.faceIdentityRepository.ensureSpacePersonIdentity(person.id);
    const opts = { identityId: identity.id, source: 'suggestion' as const, actorId: auth.user.id };
    const affected = await (action === 'rejected'
      ? this.facePersonVerdictRepository.markRejectedForSpacePerson(person.id, assetFaceId, opts)
      : this.facePersonVerdictRepository.markIgnoredForSpacePerson(person.id, assetFaceId, opts));
    return affected > 0;
  }

  async rejectSpacePersonFaceSuggestion(
    auth: AuthDto,
    spaceId: string,
    personId: string,
    assetFaceId: string,
  ): Promise<boolean> {
    return this.resolveSpacePersonFaceSuggestion(auth, spaceId, personId, assetFaceId, 'rejected');
  }

  async ignoreSpacePersonFaceSuggestion(
    auth: AuthDto,
    spaceId: string,
    personId: string,
    assetFaceId: string,
  ): Promise<boolean> {
    return this.resolveSpacePersonFaceSuggestion(auth, spaceId, personId, assetFaceId, 'ignored');
  }

  async dismissSpacePersonFaceSuggestion(
    auth: AuthDto,
    spaceId: string,
    personId: string,
    assetFaceId: string,
  ): Promise<boolean> {
    return this.rejectSpacePersonFaceSuggestion(auth, spaceId, personId, assetFaceId);
  }

  async updateSpacePersonRepresentativeFace(
    auth: AuthDto,
    spaceId: string,
    personId: string,
    dto: SpaceRepresentativeFaceUpdateDto,
  ): Promise<SharedSpacePersonResponseDto> {
    await this.requireRole(auth, spaceId, SharedSpaceRole.Editor);
    const person = await this.sharedSpaceRepository.getPersonById(personId);
    if (!person || person.spaceId !== spaceId) {
      throw new BadRequestException('Person not found');
    }

    if (dto.assetFaceId === null) {
      const representativeFaceId =
        person.representativeFaceId &&
        (await this.sharedSpaceRepository.isSpacePersonRepresentativeFaceValid(person.id, person.representativeFaceId))
          ? person.representativeFaceId
          : await this.sharedSpaceRepository.getFirstValidRepresentativeFaceForPerson(person.id);
      const updated = await this.sharedSpaceRepository.updatePerson(person.id, {
        representativeFaceSource: 'auto',
        representativeFaceId,
      });
      const alias = await this.sharedSpaceRepository.getAlias(person.id, auth.user.id);
      return this.mapSpacePerson(updated, alias?.alias ?? null);
    }

    const face = await this.sharedSpaceRepository.getSpaceRepresentativeFaceForUpdate({
      spaceId,
      personId,
      assetFaceId: dto.assetFaceId,
    });
    if (!face) {
      throw new BadRequestException('Representative face must belong to the space person');
    }

    const updated = await this.sharedSpaceRepository.updatePerson(person.id, {
      representativeFaceId: face.id,
      representativeFaceSource: 'manual',
    });
    if (person.identityId) {
      await this.faceIdentityRepository.updateRepresentativeFace({
        identityId: person.identityId,
        assetFaceId: face.id,
      });
    }
    const alias = await this.sharedSpaceRepository.getAlias(person.id, auth.user.id);
    return this.mapSpacePerson(updated, alias?.alias ?? null);
  }

  async getSpacePerson(auth: AuthDto, spaceId: string, personId: string): Promise<SharedSpacePersonResponseDto> {
    await this.requireMembership(auth, spaceId);

    const person = await this.sharedSpaceRepository.getPersonById(personId);
    if (!person || person.spaceId !== spaceId) {
      throw new BadRequestException('Person not found');
    }

    const space = await this.sharedSpaceRepository.getById(spaceId);
    if (!space?.petsEnabled && person.type === 'pet') {
      throw new BadRequestException('Person not found');
    }

    const alias = await this.sharedSpaceRepository.getAlias(personId, auth.user.id);

    return this.mapSpacePerson(person, alias?.alias ?? null);
  }

  async getSpacePersonStatistics(
    auth: AuthDto,
    spaceId: string,
    personId: string,
  ): Promise<PersonStatisticsResponseDto> {
    await this.requireMembership(auth, spaceId);

    const person = await this.sharedSpaceRepository.getPersonById(personId);
    if (!person || person.spaceId !== spaceId) {
      throw new BadRequestException('Person not found');
    }

    const space = await this.sharedSpaceRepository.getById(spaceId);
    if (!space?.petsEnabled && person.type === 'pet') {
      throw new BadRequestException('Person not found');
    }

    return this.sharedSpaceRepository.getSpacePersonStatistics(spaceId, personId);
  }

  async getSpacePersonThumbnail(auth: AuthDto, spaceId: string, personId: string): Promise<ImmichMediaResponse> {
    await this.requireMembership(auth, spaceId);

    const person = await this.sharedSpaceRepository.getPersonById(personId);
    if (!person || person.spaceId !== spaceId) {
      throw new NotFoundException();
    }

    if (person.representativeFaceSource === 'manual') {
      if (!person.representativeFaceId) {
        throw new NotFoundException();
      }

      const face = await this.sharedSpaceRepository.getSpaceRepresentativeFaceForUpdate({
        spaceId,
        personId: person.id,
        assetFaceId: person.representativeFaceId,
      });
      if (!face) {
        throw new NotFoundException();
      }

      const sourcePath = await this.getFaceThumbnailSource(face.assetId);
      if (!sourcePath) {
        throw new NotFoundException();
      }

      return this.generateFaceThumbnailResponse(face, sourcePath);
    }

    if (person.identityId) {
      const personalThumbnail = await this.sharedSpaceRepository.getPersonalThumbnailForSpacePerson({
        userId: auth.user.id,
        spaceId,
        identityId: person.identityId,
      });

      if (personalThumbnail) {
        return this.serveFromBackend(
          personalThumbnail.thumbnailPath,
          mimeTypes.lookup(personalThumbnail.thumbnailPath),
          CacheControl.PrivateWithoutCache,
        );
      }
    }

    if (!person.representativeFaceId) {
      throw new NotFoundException();
    }

    const isInSpace = await this.sharedSpaceRepository.isFaceInSpace(spaceId, person.representativeFaceId);
    if (!isInSpace) {
      throw new NotFoundException();
    }

    let face: AssetFace;
    try {
      face = await this.personRepository.getFaceById(person.representativeFaceId);
    } catch {
      throw new NotFoundException();
    }
    if (!face) {
      throw new NotFoundException();
    }

    const sourcePath = await this.getFaceThumbnailSource(face.assetId);
    if (!sourcePath) {
      throw new NotFoundException();
    }

    return this.generateFaceThumbnailResponse(face, sourcePath);
  }

  async getSpacePersonFaceThumbnail(
    auth: AuthDto,
    spaceId: string,
    personId: string,
    faceId: string,
  ): Promise<ImmichMediaResponse> {
    await this.requireMembership(auth, spaceId);
    const face = await this.sharedSpaceRepository.getSpaceRepresentativeFaceForUpdate({
      spaceId,
      personId,
      assetFaceId: faceId,
    });
    if (!face) {
      throw new NotFoundException();
    }

    const sourcePath = await this.getFaceThumbnailSource(face.assetId);
    if (!sourcePath) {
      throw new NotFoundException();
    }

    return this.generateFaceThumbnailResponse(face, sourcePath);
  }

  async updateSpacePerson(
    auth: AuthDto,
    spaceId: string,
    personId: string,
    dto: SharedSpacePersonUpdateDto,
  ): Promise<SharedSpacePersonResponseDto> {
    await this.requireRole(auth, spaceId, SharedSpaceRole.Editor);

    const person = await this.sharedSpaceRepository.getPersonById(personId);
    if (!person || person.spaceId !== spaceId) {
      throw new BadRequestException('Person not found');
    }

    if (dto.representativeFaceId) {
      const isInSpace = await this.sharedSpaceRepository.isFaceInSpace(spaceId, dto.representativeFaceId);
      if (!isInSpace) {
        throw new BadRequestException('Representative face must belong to an asset in the space');
      }
    }

    const sharedPersonUpdates: Parameters<typeof this.sharedSpaceRepository.updatePerson>[1] = {
      isHidden: dto.isHidden,
      representativeFaceId: dto.representativeFaceId,
    };
    if (dto.name !== undefined) {
      sharedPersonUpdates.name = dto.name;
      sharedPersonUpdates.nameSource = 'manual';
      sharedPersonUpdates.nameSourceProfileType = 'space-person';
      sharedPersonUpdates.nameSourceProfileId = personId;
      sharedPersonUpdates.nameSourceUpdatedAt = new Date();
    }

    const hasSharedPersonUpdates = Object.values(sharedPersonUpdates).some((value) => value !== undefined);
    if (hasSharedPersonUpdates) {
      await this.sharedSpaceRepository.updatePerson(personId, sharedPersonUpdates);
    }

    if (dto.birthDate !== undefined) {
      await this.sharedSpaceRepository.updatePerson(personId, {
        birthDate: dto.birthDate,
        birthDateSource: 'manual',
        birthDateSourceProfileType: 'space-person',
        birthDateSourceProfileId: personId,
        birthDateSourceUpdatedAt: new Date(),
      });
    }

    if (person.identityId && (dto.name !== undefined || dto.birthDate !== undefined || dto.isHidden !== undefined)) {
      await this.queueSpacePersonMetadataBackfill(person.identityId);
    }

    if (dto.name !== undefined) {
      const candidate = {
        id: personId,
        spaceId,
        name: dto.name,
        isHidden: dto.isHidden ?? person.isHidden,
        type: person.type,
      };
      if (this.isNamedVisibleSpacePerson(candidate) && dto.name.trim() !== person.name.trim()) {
        const suggestionsEnabled = await this.areSpacePersonSuggestionsEnabled({ withCache: false });
        if (suggestionsEnabled && (await this.isSpaceFaceRecognitionEnabled(spaceId))) {
          await this.jobRepository.queue({ name: JobName.SpacePersonSuggestionScan, data: { id: personId } });
        }
      }
    }

    const alias = await this.sharedSpaceRepository.getAlias(personId, auth.user.id);

    const enriched = await this.sharedSpaceRepository.getPersonById(personId);
    if (!enriched) {
      throw new BadRequestException('Person not found');
    }

    await this.sharedSpaceRepository.logActivity({
      spaceId,
      userId: auth.user.id,
      type: SharedSpaceActivityType.PersonUpdate,
      data: { personId, personName: enriched.name ?? '' },
    });

    return this.mapSpacePerson(enriched, alias?.alias ?? null);
  }

  async deleteSpacePerson(auth: AuthDto, spaceId: string, personId: string): Promise<void> {
    await this.requireRole(auth, spaceId, SharedSpaceRole.Editor);

    const person = await this.sharedSpaceRepository.getPersonById(personId);
    if (!person || person.spaceId !== spaceId) {
      throw new BadRequestException('Person not found');
    }

    await this.sharedSpaceRepository.deletePerson(personId);
    if (person.identityId) {
      await this.queueSpacePersonMetadataBackfill(person.identityId);
    }

    await this.sharedSpaceRepository.logActivity({
      spaceId,
      userId: auth.user.id,
      type: SharedSpaceActivityType.PersonDelete,
      data: { personId, personName: person.name || '' },
    });
  }

  async deduplicateSpacePeople(auth: AuthDto, spaceId: string): Promise<void> {
    await this.requireRole(auth, spaceId, SharedSpaceRole.Owner);

    await this.jobRepository.queue({
      name: JobName.SharedSpacePersonDedup,
      data: { spaceId },
    });
  }

  async backfillSpacePersonMetadata(input: {
    cursor?: string;
    identityId?: string;
    limit: number;
  }): Promise<{ processed: number; inherited: number; skipped: number; nextCursor?: string }> {
    const limit = Math.max(1, input.limit);
    const people = await this.sharedSpaceRepository.getSpacePersonMetadataBackfillPage({
      cursor: input.cursor,
      identityId: input.identityId,
      limit,
    });

    let inherited = 0;
    let skipped = 0;
    const suggestionScanCandidates: SpacePersonSuggestionScanCandidate[] = [];
    for (const person of people) {
      if (!person.identityId) {
        skipped++;
        continue;
      }
      const assetAdderIds = await this.sharedSpaceRepository.getSpacePersonAssetAdderIds(person.spaceId, person.id);
      const inheritance = await this.inheritSpacePersonMetadata(
        person.spaceId,
        person.id,
        person.identityId,
        assetAdderIds,
      );
      if (inheritance.didInherit) {
        inherited++;
        if (inheritance.suggestionScanCandidate) {
          suggestionScanCandidates.push(inheritance.suggestionScanCandidate);
        }
      } else {
        skipped++;
      }
    }

    await this.queueSpacePersonSuggestionScans(suggestionScanCandidates);

    return {
      processed: people.length,
      inherited,
      skipped,
      ...(people.length === limit && { nextCursor: people.at(-1)?.id }),
    };
  }

  private async queueSpacePersonMetadataBackfill(identityId?: string | null): Promise<void> {
    await this.jobRepository.queue({
      name: JobName.SharedSpacePersonMetadataBackfill,
      data: identityId ? { identityId } : {},
    });
  }

  @OnJob({ name: JobName.SharedSpaceAlbumGrantReconcile, queue: QueueName.BackgroundTask })
  async handleSharedSpaceAlbumGrantReconcile(job: JobOf<JobName.SharedSpaceAlbumGrantReconcile>): Promise<JobStatus> {
    await this.sharedSpaceRepository.reconcileAlbumGrants(job.albumIds ?? []);
    return JobStatus.Success;
  }

  // L8: low-frequency nightly backstop (see queue.service.ts's handleNightlyJobs). Sweeps every
  // album with a live grant, independent of which code path linked/unlinked it — this is what
  // catches cascade-deletion strands and any residual gap M6/L7's targeted fixes don't reach.
  @OnJob({ name: JobName.SharedSpaceAlbumGrantReconcileSweep, queue: QueueName.BackgroundTask })
  async handleSharedSpaceAlbumGrantReconcileSweep(): Promise<JobStatus> {
    const albumIds = await this.sharedSpaceRepository.getAllGrantedAlbumIds();
    await this.sharedSpaceRepository.reconcileAlbumGrants(albumIds);
    return JobStatus.Success;
  }

  // One-time recovery for the pre-idempotency-fix crashes: the duplicate-key failures left
  // SharedSpaceFaceMatch*/reconciliation jobs in the failed set with `removeOnFail` unset, where
  // they permanently occupy their stable dedup jobIds — BullMQ silently ignores any later add()
  // with the same id, so identity maintenance could never re-queue exactly the crashed work.
  // Deliberately NOT `removeOnFail: true` on the job options: jobs that fail *after* this cleanup
  // should park visibly in the failed set instead of being retried on every trigger forever.
  // The flag is written after the sweep so a crash mid-cleanup retries on the next boot
  // (removals are idempotent), and only a non-zero cleanup kicks identity maintenance.
  @OnEvent({ name: 'AppBootstrap', workers: [ImmichWorker.Microservices] })
  async onBootstrap(): Promise<void> {
    // Two independent one-time sweeps, each gated by its OWN state key. They must not share a gate: an
    // instance that already ran the shared-space sweep below has SharedSpaceFaceJobCleanupState.cleanedAt
    // set forever, so folding the H8 prefixes into that gate would make the H8 sweep a permanent no-op on
    // every instance that boots after this fix — exactly the instances carrying the stuck jobIds it exists
    // to clear.
    await this.cleanupBlockedSharedSpaceFaceJobs();
    await this.cleanupBlockedPersonSuggestionScanJobs();
  }

  private async cleanupBlockedSharedSpaceFaceJobs(): Promise<void> {
    const state = await this.systemMetadataRepository.get(SystemMetadataKey.SharedSpaceFaceJobCleanupState);
    if (state?.cleanedAt) {
      return;
    }

    const prefixes = ['shared-space-face-match', 'space-identity-reconcile-'];
    const removed =
      (await this.jobRepository.removeFailedJobsByJobIdPrefix(QueueName.PeopleBackfill, prefixes)) +
      (await this.jobRepository.removeFailedJobsByJobIdPrefix(QueueName.FacialRecognition, prefixes));

    if (removed > 0) {
      this.logger.log(
        `Removed ${removed} failed shared-space face job(s) that were blocking their dedup jobIds; queueing face identity maintenance`,
      );
      await this.jobRepository.queue({ name: JobName.FaceIdentityBackfill, data: {} });
    }

    await this.systemMetadataRepository.set(SystemMetadataKey.SharedSpaceFaceJobCleanupState, {
      cleanedAt: new Date().toISOString(),
    });
  }

  // H8: one-time recovery for PersonSuggestionScan/SpacePersonSuggestionScan jobs that failed before
  // job.repository.ts set removeOnFail on those two job options. Those failures permanently occupy their
  // stable per-person dedup jobId — BullMQ silently ignores any later add() with the same id, so that
  // person's suggestion queue never refills, with no log and no admin-visible symptom. removeOnFail now
  // protects every NEW failure; this sweep clears the ones that got stuck before that fix shipped. Both
  // job types run only on QueueName.PeopleBackfill (person.service.ts), so there is no FacialRecognition
  // arm to sweep here, unlike cleanupBlockedSharedSpaceFaceJobs above.
  private async cleanupBlockedPersonSuggestionScanJobs(): Promise<void> {
    const state = await this.systemMetadataRepository.get(SystemMetadataKey.PersonSuggestionScanJobCleanupState);
    if (state?.cleanedAt) {
      return;
    }

    const prefixes = ['person-suggestion-scan/', 'space-person-suggestion-scan/'];
    const removed = await this.jobRepository.removeFailedJobsByJobIdPrefix(QueueName.PeopleBackfill, prefixes);

    if (removed > 0) {
      this.logger.log(`Removed ${removed} failed person-suggestion-scan job(s) that were blocking their dedup jobIds`);
    }

    await this.systemMetadataRepository.set(SystemMetadataKey.PersonSuggestionScanJobCleanupState, {
      cleanedAt: new Date().toISOString(),
    });
  }

  // Self-heal backstop (see queue.service.ts's handleNightlyJobs): re-queues identity reconciliation
  // for every face-enabled space. A member's local person that was left unlinked from the space
  // identity — by the pre-fix crash or the multi-face reconciliation bail — collapses into one tile
  // on the next sweep, without the user doing anything.
  @OnJob({ name: JobName.SharedSpaceIdentityReconciliationSweep, queue: QueueName.BackgroundTask })
  async handleSharedSpaceIdentityReconciliationSweep(): Promise<JobStatus> {
    const spaceIds = await this.sharedSpaceRepository.getFaceRecognitionEnabledSpaceIds();
    for (const spaceId of spaceIds) {
      await this.queueSpaceIdentityReconciliation({ spaceId });
    }
    return JobStatus.Success;
  }

  // correctness-4: enqueue a post-commit reconciliation for the given albums. Idempotent
  // and deadlock-free — it runs after the triggering transaction commits, resolving the
  // TOCTOU race in the delete-side grant-revocation triggers. No-op for an empty set.
  private async queueAlbumGrantReconcile(albumIds: string[]): Promise<void> {
    const unique = [...new Set(albumIds)];
    if (unique.length === 0) {
      return;
    }
    await this.jobRepository.queue({
      name: JobName.SharedSpaceAlbumGrantReconcile,
      data: { albumIds: unique },
    });
  }

  /**
   * L7: delete the membership row and unlink the departing user's OWNED albums (albums-6)
   * in ONE transaction, so a failure between the two can never leave the ex-member's own
   * album linked with no membership row backing it (or vice versa). Fork rule: never run
   * `this.db` queries inside a Kysely transaction() callback — both repo calls thread the
   * `trx` handle instead (mirrors recountPersons). Returns the unlinked album ids so the
   * caller can run face cleanup (outside the transaction — see cleanupDepartingMemberFaces)
   * and enqueue grant reconciliation.
   */
  private async removeMemberAndOwnedAlbumsAtomically(spaceId: string, userId: string): Promise<string[]> {
    return this.databaseRepository.transaction(async (trx) => {
      await this.sharedSpaceRepository.removeMember(spaceId, userId, trx);
      return (await this.sharedSpaceRepository.removeOwnedAlbumLinksAddedBy(spaceId, userId, trx)) ?? [];
    });
  }

  /**
   * albums-6 / L6: clean up any now-orphaned space person faces for the departing member's
   * just-unlinked albums (mirrors unlinkAlbum's cleanup). Deliberately OUTSIDE the membership
   * transaction (no `this.db` inside a Kysely transaction()) and re-drivable: a failure here
   * doesn't roll back the already-committed membership/album-link removal — it falls back to
   * the durable per-space reconcile (enqueueSpaceFaceProjectionReconcile / L6's stale-face
   * sweep) instead of silently leaving stale face rows.
   */
  private async cleanupDepartingMemberFaces(
    spaceId: string,
    unlinkedAlbumIds: string[],
    faceRecognitionEnabled: boolean,
  ): Promise<void> {
    if (!faceRecognitionEnabled || unlinkedAlbumIds.length === 0) {
      return;
    }
    try {
      for (const albumId of unlinkedAlbumIds) {
        const orphanedAssetIds = await this.sharedSpaceRepository.getAlbumAssetIdsWithoutOtherSpacePath(
          spaceId,
          albumId,
        );
        if (orphanedAssetIds.length > 0) {
          await this.sharedSpaceRepository.removePersonFacesByAssetIds(spaceId, orphanedAssetIds);
        }
      }
      await this.sharedSpaceRepository.deleteOrphanedPersons(spaceId);
    } catch (error) {
      this.logger.error(`Failed to clean up departing-member space person faces for space ${spaceId}: ${error}`);
      await this.enqueueSpaceFaceProjectionReconcile([spaceId]);
    }
  }

  private async queueSpaceIdentityReconciliation(input: {
    spaceId: string;
    userId?: string;
    spacePersonId?: string;
  }): Promise<void> {
    await this.jobRepository.queue({
      name: JobName.SharedSpaceIdentityReconciliation,
      data: input,
    });
  }

  private async resolveMovedSpacePersonFaces(faceIds: Array<{ assetFaceId: string }>): Promise<void> {
    for (const { assetFaceId } of faceIds) {
      await this.facePersonVerdictRepository.resolveAssignedFace(assetFaceId);
    }
  }

  async mergeSpacePeople(
    auth: AuthDto,
    spaceId: string,
    targetPersonId: string,
    dto: SharedSpacePersonMergeDto,
  ): Promise<void> {
    await this.requireRole(auth, spaceId, SharedSpaceRole.Editor);

    if (dto.ids.length === 0) {
      throw new BadRequestException('No source people provided');
    }

    const target = await this.sharedSpaceRepository.getPersonById(targetPersonId);
    if (!target || target.spaceId !== spaceId) {
      throw new BadRequestException('Person not found');
    }

    if (dto.ids.includes(targetPersonId)) {
      throw new BadRequestException('Cannot merge a person into themselves');
    }

    const sources = [];
    for (const sourceId of dto.ids) {
      const source = await this.sharedSpaceRepository.getPersonById(sourceId);
      if (!source || source.spaceId !== spaceId) {
        throw new BadRequestException('Source person not found in this space');
      }
      sources.push(source);
    }

    // Same cross-owner policy as every other merge path (#733). An in-space merge propagates out to every
    // scope the identities are attached to, including other users' libraries, so if it would combine two of
    // another user's people it needs the instance toggle and an explicit acknowledgement.
    //
    // Resolve the toggle BEFORE the merge transaction opens: the authorizer runs inside that transaction while it
    // holds the instance-wide advisory lock, and reading config there would query a second pool connection a
    // saturated pool cannot grant, deadlocking every merge (#595). The authorizer gets an already-resolved value.
    const { server } = await this.getConfig({ withCache: false });
    // Capture the source people's face ids before the merge so any pending suggestions for
    // those faces can be resolved once the merge reassigns them to the target person.
    const movedFaceIds: Array<{ assetFaceId: string }> = [];
    for (const source of sources) {
      movedFaceIds.push(...(await this.sharedSpaceRepository.getFaceIdsForPerson(source.id)));
    }

    await this.identityMergePropagationService.mergeSpacePeople(
      auth,
      spaceId,
      targetPersonId,
      dto.ids,
      createCrossOwnerMergeAuthorizer(() => Promise.resolve(server), dto),
    );

    await this.resolveMovedSpacePersonFaces(movedFaceIds);
    await this.sharedSpaceRepository.logActivity({
      spaceId,
      userId: auth.user.id,
      type: SharedSpaceActivityType.PersonMerge,
      data: { personName: target.name ?? '', count: dto.ids.length },
    });
  }

  async setSpacePersonAlias(
    auth: AuthDto,
    spaceId: string,
    personId: string,
    dto: SharedSpacePersonAliasDto,
  ): Promise<void> {
    await this.requireMembership(auth, spaceId);

    const person = await this.sharedSpaceRepository.getPersonById(personId);
    if (!person || person.spaceId !== spaceId) {
      throw new BadRequestException('Person not found');
    }

    await this.sharedSpaceRepository.upsertAlias({
      personId,
      userId: auth.user.id,
      alias: dto.alias,
    });
  }

  async deleteSpacePersonAlias(auth: AuthDto, spaceId: string, personId: string): Promise<void> {
    await this.requireMembership(auth, spaceId);
    await this.sharedSpaceRepository.deleteAlias(personId, auth.user.id);
  }

  async getSpacePersonAssets(auth: AuthDto, spaceId: string, personId: string): Promise<string[]> {
    await this.requireMembership(auth, spaceId);

    const person = await this.sharedSpaceRepository.getPersonById(personId);
    if (!person || person.spaceId !== spaceId) {
      throw new BadRequestException('Person not found');
    }

    const assets = await this.sharedSpaceRepository.getPersonAssetIds(personId);
    return assets.map((a) => a.assetId);
  }

  @OnJob({ name: JobName.SharedSpaceIdentityReconciliation, queue: QueueName.FacialRecognition })
  async handleSharedSpaceIdentityReconciliation(
    job: JobOf<JobName.SharedSpaceIdentityReconciliation>,
  ): Promise<JobStatus> {
    return this.reconcileSharedSpaceIdentities(job);
  }

  private async reconcileSharedSpaceIdentities(
    job: JobOf<JobName.SharedSpaceIdentityReconciliation>,
  ): Promise<JobStatus> {
    const space = await this.sharedSpaceRepository.getById(job.spaceId);
    if (!space || !space.faceRecognitionEnabled) {
      return JobStatus.Skipped;
    }

    const { machineLearning } = await this.getConfig({ withCache: true });
    const maxDistance = machineLearning.facialRecognition.maxDistance;

    let members;
    if (job.userId) {
      const member = await this.sharedSpaceRepository.getMember(job.spaceId, job.userId);
      members = member ? [member] : [];
    } else {
      members = await this.sharedSpaceRepository.getMembers(job.spaceId);
    }

    const spacePeopleWithEmbeddings = await this.sharedSpaceRepository.getSpacePersonsWithEmbeddings(job.spaceId);
    const spacePeople = spacePeopleWithEmbeddings.filter(
      (person) => (!job.spacePersonId || person.id === job.spacePersonId) && person.identityId && !person.isHidden,
    );

    for (const member of members) {
      const claims: SharedSpaceIdentityReconciliationClaim[] = [];
      for (const spacePerson of spacePeople) {
        const claim = await this.findStrictSpacePersonLocalIdentityClaim({
          memberUserId: member.userId,
          spacePerson,
          maxDistance,
        });
        if (claim) {
          claims.push(claim);
        }
      }

      for (const claim of filterUnambiguousReconciliationClaims(claims) as SharedSpaceIdentityReconciliationClaim[]) {
        await this.applySharedSpaceIdentityReconciliationClaim(claim);
      }
    }

    return JobStatus.Success;
  }

  private async findStrictSpacePersonLocalIdentityClaim(input: {
    memberUserId: string;
    spacePerson: {
      id: string;
      identityId?: string | null;
      type: string;
      embedding: string;
      isHidden: boolean;
    };
    maxDistance: number;
  }): Promise<SharedSpaceIdentityReconciliationClaim | undefined> {
    const targetIdentityId = input.spacePerson.identityId;
    if (!targetIdentityId || input.spacePerson.isHidden) {
      return;
    }

    const matches = await this.searchRepository.searchFaces({
      userIds: [input.memberUserId],
      embedding: input.spacePerson.embedding,
      maxDistance: input.maxDistance,
      numResults: 2,
      hasPerson: true,
    });

    // Dedup by identity: the member's nearest faces (searchFaces returns raw face rows, not distinct
    // people) are often several faces of their own single person. Those collapse to one candidate
    // identity — only a genuinely ambiguous match against two *distinct* local identities should bail.
    const candidateIdentityIds = new Set<string>();
    for (const match of matches) {
      if (!match.personId) {
        continue;
      }

      const person = await this.personRepository.getById(match.personId);
      if (!person || person.isHidden || person.type !== input.spacePerson.type) {
        continue;
      }

      const identity = await this.faceIdentityRepository.ensurePersonIdentity(person.id);
      if (identity.id === targetIdentityId) {
        return;
      }

      candidateIdentityIds.add(identity.id);
    }

    if (candidateIdentityIds.size !== 1) {
      return;
    }
    const [candidateIdentityId] = candidateIdentityIds;

    const { sourceIdentityId, targetIdentityId: selectedTargetIdentityId } = chooseAutomaticTargetIdentity({
      bridge: 'member-join',
      localIdentityId: candidateIdentityId,
      spaceIdentityId: targetIdentityId,
    });
    const claim = buildAutomaticReconciliationClaim({
      bridge: 'member-join',
      localIdentityId: candidateIdentityId,
      spaceIdentityId: targetIdentityId,
      sourceIdentityId,
      targetIdentityId: selectedTargetIdentityId,
      sourceProfileKey: `user:${input.memberUserId}:${candidateIdentityId}`,
      targetProfileKey: `space-person:${input.spacePerson.id}`,
      hasAccessBridge: true,
      compatibleType: true,
      hasEmbedding: true,
      hiddenOrIgnored: false,
      alreadySameIdentity: false,
      sameOwnerConflict: false,
      sameSpaceConflict: false,
    });

    return claim
      ? {
          ...claim,
          spacePersonId: input.spacePerson.id,
        }
      : undefined;
  }

  private async applySharedSpaceIdentityReconciliationClaim(
    claim: SharedSpaceIdentityReconciliationClaim,
  ): Promise<void> {
    const conflicts = await this.faceIdentityRepository.getMergeConflicts({
      targetIdentityId: claim.targetIdentityId,
      sourceIdentityIds: [claim.sourceIdentityId],
    });

    // A personal-profile conflict means a single owner has two local people on the two identities.
    // Auto-collapsing a user's own people could be wrong, so we still refuse to merge here.
    if (conflicts.personalProfileConflictCount > 0) {
      this.logger.warn(
        `Skipping shared-space identity reconciliation for space person ${claim.spacePersonId}: personal-profile conflict`,
      );
      return;
    }

    // A space-profile conflict means the same space already has two space-people on the two
    // identities — they are the same real person bridged by a member's local profile, but dedup
    // can never close their embedding gap, so reconciliation is the only path. Collapse them
    // (loser folded into the higher-precedence survivor) before merging, otherwise mergeIdentities
    // would bail forever on the (spaceId, identityId) unique index.
    if (conflicts.spaceProfileConflictCount > 0) {
      await this.collapseSameSpaceReconciliationConflicts(claim);
    }

    await this.faceIdentityRepository.mergeIdentities({
      targetIdentityId: claim.targetIdentityId,
      sourceIdentityIds: [claim.sourceIdentityId],
      source: 'shared-space-evidence',
    });
    await this.queueSpacePersonMetadataBackfill(claim.targetIdentityId);
  }

  /**
   * Collapses every same-space `shared_space_person` pair that would block the identity merge.
   * For each pair the survivor is chosen by nameSource precedence (manual > inherited > auto >
   * none), tie-broken by face count then id; the loser's faces and aliases move to the survivor and
   * the loser row is deleted. The survivor's winning name is preserved by construction (it always
   * has at least the loser's nameSource precedence). The subsequent mergeIdentities then sets the
   * survivor onto the canonical target identity without colliding.
   */
  private async collapseSameSpaceReconciliationConflicts(claim: SharedSpaceIdentityReconciliationClaim): Promise<void> {
    const pairs = await this.faceIdentityRepository.getSpaceMergeConflictPairs({
      targetIdentityId: claim.targetIdentityId,
      sourceIdentityIds: [claim.sourceIdentityId],
    });

    for (const pair of pairs) {
      const target = {
        id: pair.targetId,
        name: pair.targetName,
        nameSource: pair.targetNameSource,
        faceCount: pair.targetFaceCount,
      };
      const source = {
        id: pair.sourceId,
        name: pair.sourceName,
        nameSource: pair.sourceNameSource,
        faceCount: pair.sourceFaceCount,
      };
      const [survivor, loser] = this.chooseSpaceConflictSurvivor(target, source);

      this.logger.log(
        `Collapsing same-space identity conflict in space ${pair.spaceId}: folding ${loser.id} (${loser.name || 'unnamed'}, ${loser.nameSource}) into ${survivor.id} (${survivor.name || 'unnamed'}, ${survivor.nameSource})`,
      );

      await this.sharedSpaceRepository.reassignPersonFacesSafe(loser.id, survivor.id);
      await this.sharedSpaceRepository.migrateAliases(loser.id, survivor.id);
      await this.sharedSpaceRepository.deletePerson(loser.id);
      await this.sharedSpaceRepository.recountPersons([survivor.id]);
    }
  }

  private chooseSpaceConflictSurvivor<T extends { id: string; nameSource: string; faceCount: number }>(
    a: T,
    b: T,
  ): [survivor: T, loser: T] {
    const [survivor, loser] = [a, b].toSorted((x, y) => {
      const precedenceDelta = getNameSourcePrecedence(y.nameSource) - getNameSourcePrecedence(x.nameSource);
      if (precedenceDelta !== 0) {
        return precedenceDelta;
      }
      const faceDelta = Number(y.faceCount) - Number(x.faceCount);
      if (faceDelta !== 0) {
        return faceDelta;
      }
      return x.id.localeCompare(y.id);
    });
    return [survivor, loser];
  }

  @OnJob({ name: JobName.SharedSpaceFaceMatch, queue: QueueName.FacialRecognition })
  async handleSharedSpaceFaceMatch({
    spaceId,
    assetId,
    source,
  }: JobOf<JobName.SharedSpaceFaceMatch>): Promise<JobStatus> {
    const space = await this.sharedSpaceRepository.getById(spaceId);
    if (!space || !space.faceRecognitionEnabled) {
      return JobStatus.Skipped;
    }

    const affectedPersonIds = await this.processSpaceFaceMatch(spaceId, assetId, {
      refreshExactMetadata: source === 'identity-backfill',
    });
    for (const spacePersonId of affectedPersonIds) {
      await this.queueSpaceIdentityReconciliation({ spaceId, spacePersonId });
    }

    // Queue dedup pass (jobId deduplication prevents queue spam)
    await this.jobRepository.queue({
      name: JobName.SharedSpacePersonDedup,
      data: { spaceId },
    });

    return JobStatus.Success;
  }

  @OnJob({ name: JobName.SharedSpaceFaceMatchFromBackfill, queue: QueueName.PeopleBackfill })
  async handleSharedSpaceFaceMatchFromBackfill({
    spaceId,
    assetId,
  }: JobOf<JobName.SharedSpaceFaceMatchFromBackfill>): Promise<JobStatus> {
    const space = await this.sharedSpaceRepository.getById(spaceId);
    if (!space || !space.faceRecognitionEnabled) {
      return JobStatus.Skipped;
    }

    const affectedPersonIds = await this.processSpaceFaceMatch(spaceId, assetId, {
      refreshExactMetadata: true,
    });
    for (const spacePersonId of affectedPersonIds) {
      await this.queueSpaceIdentityReconciliation({ spaceId, spacePersonId });
    }

    await this.jobRepository.queue({
      name: JobName.SharedSpacePersonDedup,
      data: { spaceId },
    });

    return JobStatus.Success;
  }

  @OnJob({ name: JobName.SharedSpaceLibraryFaceSync, queue: QueueName.FacialRecognition })
  async handleSharedSpaceLibraryFaceSync(job: JobOf<JobName.SharedSpaceLibraryFaceSync>): Promise<JobStatus> {
    const space = await this.sharedSpaceRepository.getById(job.spaceId);
    if (!space || !space.faceRecognitionEnabled) {
      return JobStatus.Skipped;
    }

    const linkExists = await this.sharedSpaceRepository.hasLibraryLink(job.spaceId, job.libraryId);
    if (!linkExists) {
      return JobStatus.Skipped;
    }

    const batchSize = 1000;
    let offset = 0;
    let affectedAny = false;

    while (true) {
      // Re-check link each batch to handle concurrent unlink
      const stillLinked = await this.sharedSpaceRepository.hasLibraryLink(job.spaceId, job.libraryId);
      if (!stillLinked) {
        this.logger.log(`Library ${job.libraryId} was unlinked from space ${job.spaceId} during sync, stopping`);
        break;
      }

      const assets = await this.assetRepository.getByLibraryIdWithFaces(job.libraryId, batchSize, offset);
      if (assets.length === 0) {
        break;
      }

      for (const asset of assets) {
        const affectedPersonIds = await this.processSpaceFaceMatch(job.spaceId, asset.id);
        affectedAny ||= affectedPersonIds.length > 0;
      }

      offset += assets.length;
    }

    if (affectedAny) {
      await this.queueSpaceIdentityReconciliation({ spaceId: job.spaceId });
    }

    // Queue dedup pass after library sync completes
    await this.jobRepository.queue({
      name: JobName.SharedSpacePersonDedup,
      data: { spaceId: job.spaceId },
    });

    return JobStatus.Success;
  }

  @OnJob({ name: JobName.SharedSpaceAlbumFaceSync, queue: QueueName.FacialRecognition })
  async handleSharedSpaceAlbumFaceSync(job: JobOf<JobName.SharedSpaceAlbumFaceSync>): Promise<JobStatus> {
    const space = await this.sharedSpaceRepository.getById(job.spaceId);
    if (!space || !space.faceRecognitionEnabled) {
      return JobStatus.Skipped;
    }

    const linkExists = await this.sharedSpaceRepository.hasAlbumLink(job.spaceId, job.albumId);
    if (!linkExists) {
      return JobStatus.Skipped;
    }

    const batchSize = 1000;
    let offset = 0;
    let affectedAny = false;

    while (true) {
      // Re-check link each batch to handle concurrent unlink
      const stillLinked = await this.sharedSpaceRepository.hasAlbumLink(job.spaceId, job.albumId);
      if (!stillLinked) {
        this.logger.log(`Album ${job.albumId} was unlinked from space ${job.spaceId} during sync, stopping`);
        break;
      }

      const assets = await this.assetRepository.getByAlbumIdWithFaces(job.albumId, job.spaceId, batchSize, offset);
      if (assets.length === 0) {
        break;
      }

      for (const asset of assets) {
        const affectedPersonIds = await this.processSpaceFaceMatch(job.spaceId, asset.id);
        affectedAny ||= affectedPersonIds.length > 0;
      }

      offset += assets.length;
    }

    if (affectedAny) {
      await this.queueSpaceIdentityReconciliation({ spaceId: job.spaceId });
    }

    // Queue dedup pass after album sync completes
    await this.jobRepository.queue({
      name: JobName.SharedSpacePersonDedup,
      data: { spaceId: job.spaceId },
    });

    return JobStatus.Success;
  }

  @OnJob({ name: JobName.SharedSpaceFaceMatchAll, queue: QueueName.FacialRecognition })
  async handleSharedSpaceFaceMatchAll({ spaceId }: JobOf<JobName.SharedSpaceFaceMatchAll>): Promise<JobStatus> {
    const space = await this.sharedSpaceRepository.getById(spaceId);
    if (!space || !space.faceRecognitionEnabled) {
      return JobStatus.Skipped;
    }

    // L6: this is the durable per-space reconcile's entry point — sweep any
    // shared_space_person_face row left behind by a space-path removal that didn't go through
    // unlinkAlbum/removeMember's synchronous cleanup (cascade delete, failed fire-and-forget job).
    await this.sweepStaleSpacePersonFaces(spaceId);

    await this.jobRepository.queue({
      name: JobName.SharedSpaceFaceMatchPage,
      data: { spaceId },
    });

    return JobStatus.Success;
  }

  // L6: delete shared_space_person_face rows whose asset has no remaining space path in this
  // space, then recount + drop any person left with zero faces. Reuses the same
  // getAssetIdsWithoutOtherSpacePath "any live path?" check the synchronous cleanup paths use.
  private async sweepStaleSpacePersonFaces(spaceId: string): Promise<void> {
    const candidateAssetIds = await this.sharedSpaceRepository.getSpacePersonFaceAssetIds(spaceId);
    if (candidateAssetIds.length === 0) {
      return;
    }
    const staleAssetIds = await this.sharedSpaceRepository.getAssetIdsWithoutOtherSpacePath(spaceId, candidateAssetIds);
    if (staleAssetIds.length === 0) {
      return;
    }
    await this.sharedSpaceRepository.removePersonFacesByAssetIds(spaceId, staleAssetIds);
    await this.sharedSpaceRepository.deleteOrphanedPersons(spaceId);
  }

  @OnJob({ name: JobName.SharedSpaceFaceMatchPage, queue: QueueName.FacialRecognition })
  async handleSharedSpaceFaceMatchPage({
    spaceId,
    afterAssetId,
    batchSize,
  }: JobOf<JobName.SharedSpaceFaceMatchPage>): Promise<JobStatus> {
    const space = await this.sharedSpaceRepository.getById(spaceId);
    if (!space || !space.faceRecognitionEnabled) {
      return JobStatus.Skipped;
    }

    const { pageSize, propagatedBatchSize } = this.getSharedSpaceFaceMatchPageSize(batchSize);
    const assets = await this.sharedSpaceRepository.getAssetIdsInSpacePage(spaceId, {
      limit: pageSize + 1,
      ...(afterAssetId && { afterAssetId }),
    });

    if (assets.length === 0) {
      if (afterAssetId) {
        await this.queueSharedSpaceFaceMatchFinalFollowUp(spaceId);
      }
      return JobStatus.Success;
    }

    const assetsToProcess = assets.slice(0, pageSize);
    const hasNextPage = assets.length > pageSize;

    for (const { assetId } of assetsToProcess) {
      await this.processSpaceFaceMatch(spaceId, assetId);
    }

    const lastProcessedAssetId = assetsToProcess.at(-1)?.assetId;
    if (hasNextPage && lastProcessedAssetId) {
      const nextPageSpace = await this.sharedSpaceRepository.getById(spaceId);
      if (!nextPageSpace || !nextPageSpace.faceRecognitionEnabled) {
        return JobStatus.Success;
      }

      await this.jobRepository.queue({
        name: JobName.SharedSpaceFaceMatchPage,
        data: {
          spaceId,
          afterAssetId: lastProcessedAssetId,
          ...(propagatedBatchSize && { batchSize: propagatedBatchSize }),
        },
      });
      return JobStatus.Success;
    }

    await this.queueSharedSpaceFaceMatchFinalFollowUp(spaceId);

    return JobStatus.Success;
  }

  private getSharedSpaceFaceMatchPageSize(batchSize: number | undefined): {
    pageSize: number;
    propagatedBatchSize?: number;
  } {
    const candidate = batchSize ?? this.sharedSpaceFaceMatchBatchSize;
    const finiteCandidate = Number.isFinite(candidate) ? candidate : this.sharedSpaceFaceMatchBatchSize;
    const pageSize = Math.min(this.sharedSpaceFaceMatchBatchSize, Math.max(1, Math.floor(finiteCandidate)));
    const propagatedBatchSize =
      batchSize !== undefined && Number.isFinite(batchSize) && batchSize > 0 ? pageSize : undefined;

    return { pageSize, propagatedBatchSize };
  }

  private async queueSharedSpaceFaceMatchFinalFollowUp(spaceId: string): Promise<void> {
    const finalSpace = await this.sharedSpaceRepository.getById(spaceId);
    if (!finalSpace || !finalSpace.faceRecognitionEnabled) {
      return;
    }

    await this.jobRepository.queue({
      name: JobName.SharedSpacePersonDedup,
      data: { spaceId },
    });

    await this.queueSpaceIdentityReconciliation({ spaceId });
  }

  @OnJob({ name: JobName.SharedSpacePersonDedup, queue: QueueName.FacialRecognition })
  async handleSharedSpacePersonDedup(job: JobOf<JobName.SharedSpacePersonDedup>): Promise<JobStatus> {
    const space = await this.sharedSpaceRepository.getById(job.spaceId);
    if (!space || !space.faceRecognitionEnabled) {
      this.logger.debug(`Dedup skipped for space ${job.spaceId}: ${space ? 'face recognition disabled' : 'not found'}`);
      return JobStatus.Skipped;
    }

    // Single-flight: at most one dedup chain per space. Only the initial trigger (pass 1) is gated —
    // a follow-up (pass >= 2) IS the running chain and must continue. The bare initial jobId only
    // de-duplicates triggers while pass 1 is in flight; once a chain advances to pass-scoped
    // follow-ups the bare id frees, so without this guard the next external trigger (e.g. a bulk
    // face-assign run) starts a parallel chain — doubling the work and reviving the
    // removeOnComplete/stalled-recovery orphan race on the shared pass-scoped jobIds.
    const pass = job.pass ?? 1;
    if (pass === 1 && (await this.jobRepository.hasInFlightDedupChain(job.spaceId))) {
      this.logger.debug(`Dedup skipped for space ${job.spaceId}: a dedup chain is already running`);
      return JobStatus.Skipped;
    }

    const { machineLearning } = await this.getConfig({ withCache: true });
    const maxDistance = machineLearning.facialRecognition.maxDistance;

    // Repair persons that have faces but lost their representativeFaceId
    // (e.g., after force-detection reset). Without this, they are invisible
    // to getSpacePersonsWithEmbeddings due to the INNER JOIN on face_search.
    await this.sharedSpaceRepository.repairInvalidRepresentativeFaces(job.spaceId);
    await this.sharedSpaceRepository.repairOrphanedRepresentativeFaces(job.spaceId);

    // One pass per job. A single in-process up-to-100-pass loop on a large space (e.g. Hagen's
    // 563k-asset space) easily ran for minutes — far longer than BullMQ's 30s lock. When the lock
    // expired mid-pass the entry could be orphaned in the "active" list with no recovery, starving
    // the whole concurrency-1 FacialRecognition queue (core face recognition included). Each
    // invocation now does exactly ONE pass and re-queues a fresh, short follow-up when a merge
    // happened, carrying a pass counter that is capped to prevent a runaway chain.
    const affectedIdentityIds = new Set<string>();
    let mergedAny = false;

    const persons = await this.sharedSpaceRepository.getSpacePersonsWithEmbeddings(job.spaceId);
    this.logger.log(`Dedup pass ${pass} for space ${job.spaceId}: ${persons.length} persons to check`);

    if (persons.length <= 1) {
      // Safety net: drop space-persons left with no faces.
      await this.sharedSpaceRepository.deleteOrphanedPersons(job.spaceId);
      return JobStatus.Success;
    }

    const deletedIds = new Set<string>();
    const targetIds = new Set<string>();
    let passMerges = 0;

    for (const person of persons) {
      if (deletedIds.has(person.id)) {
        continue;
      }

      if (person.isHidden) {
        continue;
      }

      const matches = await this.sharedSpaceRepository.findClosestSpacePerson(job.spaceId, person.embedding, {
        maxDistance,
        numResults: 2,
        excludePersonIds: [person.id, ...deletedIds],
        type: person.type,
      });

      if (matches.length === 0) {
        continue;
      }

      const compatibleMatches: Array<{ person: (typeof persons)[number]; distance: number }> = [];
      for (const match of matches) {
        const matchPerson = persons.find((p) => p.id === match.personId);
        if (!matchPerson || deletedIds.has(match.personId)) {
          this.logger.debug(
            `Dedup: skipping stale match ${match.personId} for person ${person.id} (already merged in this pass)`,
          );
          continue;
        }
        if (matchPerson.isHidden || matchPerson.type !== person.type) {
          continue;
        }
        compatibleMatches.push({ person: matchPerson, distance: match.distance });
      }

      if (compatibleMatches.length !== 1) {
        continue;
      }

      const { person: matchPerson, distance } = compatibleMatches[0];

      // Determine target (more faces) and source
      const [target, source] =
        person.faceCount >= matchPerson.faceCount ? [person, matchPerson] : [matchPerson, person];

      this.logger.log(
        `Dedup: merging person ${source.id} (${source.name || 'unnamed'}, ${source.faceCount} faces) into ${target.id} (${target.name || 'unnamed'}, ${target.faceCount} faces), distance=${distance.toFixed(4)}`,
      );

      // Reassign faces and migrate aliases
      const movedFaceIds = await this.sharedSpaceRepository.getFaceIdsForPerson(source.id);
      await this.sharedSpaceRepository.reassignPersonFacesSafe(source.id, target.id);
      await this.resolveMovedSpacePersonFaces(movedFaceIds);
      await this.sharedSpaceRepository.migrateAliases(source.id, target.id);

      const candidateIdentityIds = [target.identityId, source.identityId].filter(
        (identityId): identityId is string => !!identityId,
      );
      if (candidateIdentityIds.length > 0) {
        const mergedIdentityId = await this.mergeIdentitiesForSpacePersonEvidence({
          spaceId: job.spaceId,
          targetSpacePersonId: target.id,
          candidateIdentityIds,
        });
        await this.inheritSpacePersonMetadata(job.spaceId, target.id, mergedIdentityId);
        affectedIdentityIds.add(mergedIdentityId);
      }

      // Refresh representativeFaceId to a face with a valid embedding from the merged pool
      if (target.representativeFaceSource !== 'manual') {
        const newRepFace = await this.sharedSpaceRepository.getFirstFaceIdForPerson(target.id);
        if (newRepFace && newRepFace !== target.representativeFaceId) {
          try {
            await this.sharedSpaceRepository.updatePerson(target.id, { representativeFaceId: newRepFace });
          } catch (error) {
            this.logger.warn(`Dedup: failed to update representativeFaceId for target ${target.id}: ${error}`);
          }
        }
      }

      // Determine merged properties
      const updates: Partial<{ name: string; isHidden: boolean }> = {};
      if (!target.name && source.name) {
        updates.name = source.name;
      }

      // Update and delete separately so deletePerson still runs if updatePerson fails
      try {
        if (Object.keys(updates).length > 0) {
          await this.sharedSpaceRepository.updatePerson(target.id, updates);
        }
      } catch (error) {
        // Target may have been concurrently deleted — faces were already reassigned, continue to delete source
        this.logger.warn(`Dedup: updatePerson failed for target ${target.id}: ${error}`);
      }

      try {
        await this.sharedSpaceRepository.deletePerson(source.id);
      } catch (error) {
        // Source may have been concurrently deleted — safe to ignore
        this.logger.warn(`Dedup: deletePerson failed for source ${source.id}: ${error}`);
      }

      deletedIds.add(source.id);
      targetIds.add(target.id);
      passMerges++;
      mergedAny = true;
    }

    if (targetIds.size > 0) {
      await this.sharedSpaceRepository.recountPersons([...targetIds]);
    }

    // Clean up orphaned persons (no faces linked) as a safety net. Cheap and idempotent, so it runs
    // each pass rather than only on convergence.
    await this.sharedSpaceRepository.deleteOrphanedPersons(job.spaceId);

    for (const identityId of affectedIdentityIds) {
      await this.queueSpacePersonMetadataBackfill(identityId);
    }

    this.logger.log(`Dedup pass ${pass} for space ${job.spaceId} complete: ${passMerges} merges`);

    // Re-queue a fresh, short follow-up pass while merges are still happening, capped to avoid a
    // runaway chain. The follow-up uses a pass-scoped jobId (see job.repository getJobOptions) so it
    // enqueues even though this job is still "active".
    if (mergedAny) {
      if (pass < SHARED_SPACE_DEDUP_MAX_PASSES) {
        await this.jobRepository.queue({
          name: JobName.SharedSpacePersonDedup,
          data: { spaceId: job.spaceId, pass: pass + 1 },
        });
      } else {
        this.logger.error(
          `Dedup for space ${job.spaceId} reached the ${SHARED_SPACE_DEDUP_MAX_PASSES}-pass cap — stopping to prevent a runaway chain`,
        );
      }
    }

    return JobStatus.Success;
  }

  @OnJob({ name: JobName.SharedSpacePersonMetadataBackfill, queue: QueueName.PeopleBackfill })
  async handleSharedSpacePersonMetadataBackfill({
    cursor,
    identityId,
    limit = 1000,
  }: JobOf<JobName.SharedSpacePersonMetadataBackfill>): Promise<JobStatus> {
    const result = await this.backfillSpacePersonMetadata({ cursor, identityId, limit });
    if (result.nextCursor) {
      await this.jobRepository.queue({
        name: JobName.SharedSpacePersonMetadataBackfill,
        data: { cursor: result.nextCursor, identityId, limit },
      });
    }
    return JobStatus.Success;
  }

  @OnJob({ name: JobName.SharedSpaceBulkAddAssets, queue: QueueName.BackgroundTask })
  async handleSharedSpaceBulkAddAssets({
    spaceId,
    userId,
  }: JobOf<JobName.SharedSpaceBulkAddAssets>): Promise<JobStatus> {
    const member = await this.sharedSpaceRepository.getMember(spaceId, userId);
    if (!member || ROLE_HIERARCHY[member.role as SharedSpaceRole] < ROLE_HIERARCHY[SharedSpaceRole.Editor]) {
      return JobStatus.Skipped;
    }

    const space = await this.sharedSpaceRepository.getById(spaceId);
    if (!space) {
      return JobStatus.Skipped;
    }

    let count: number;
    try {
      count = await this.sharedSpaceRepository.bulkAddUserAssets(spaceId, userId);
    } catch (error) {
      this.logger.error(`Bulk add assets failed for space ${spaceId}: ${error}`);
      return JobStatus.Failed;
    }

    if (count === 0) {
      return JobStatus.Success;
    }

    await this.sharedSpaceRepository.update(spaceId, { lastActivityAt: new Date() });

    await this.sharedSpaceRepository.logActivity({
      spaceId,
      userId,
      type: SharedSpaceActivityType.AssetAdd,
      data: { count, bulk: true },
    });

    if (space.faceRecognitionEnabled) {
      await this.jobRepository.queue({
        name: JobName.SharedSpaceFaceMatchAll,
        data: { spaceId },
      });
    }

    const notification = await this.notificationRepository.create({
      userId,
      type: NotificationType.Custom,
      level: NotificationLevel.Success,
      title: 'Bulk add complete',
      description: `${count} photos added to space`,
      data: JSON.stringify({ spaceId }),
    });
    this.websocketRepository.clientSend('on_notification', userId, mapNotification(notification));

    return JobStatus.Success;
  }

  private async processSpaceFaceMatch(
    spaceId: string,
    assetId: string,
    options: { refreshExactMetadata?: boolean } = {},
  ): Promise<string[]> {
    const isAssetInSpace = await this.sharedSpaceRepository.isAssetInSpace(spaceId, assetId);
    if (!isAssetInSpace) {
      return [];
    }

    const spaceAsset = await this.sharedSpaceRepository.getSpaceAssetAdder(spaceId, assetId);
    const assetAdderId = spaceAsset?.addedById ?? null;
    const affectedPersonIds = new Set<string>();
    const recountPersonIds = new Set<string>();
    const stalePersonIds = new Set<string>();
    let maxDistance: number | undefined;

    const faces = await this.sharedSpaceRepository.getAssetFacesForMatching(assetId);
    for (const face of faces) {
      const selectedSpaceAssignments = await this.sharedSpaceRepository.getPersonFaceAssignmentsForSpace(
        face.id,
        spaceId,
      );

      // Strict gate: only faces native recognition has already assigned to a global
      // person are eligible to join a space-person. This guarantees every face in a
      // space-person belongs to a density-validated native cluster and eliminates the
      // single-face chaining bug reported in #272.
      if (!face.personId) {
        continue;
      }

      if (face.identityId === null) {
        continue;
      }

      let spacePerson: SpacePersonMatchResult;
      if (face.identityId) {
        const type = face.type ?? 'person';
        const identitySpacePerson = await this.findOrCreateCompatibleSpacePersonForIdentity({
          spaceId,
          faceId: face.id,
          personId: face.personId,
          identityId: face.identityId,
          type,
        });

        if (
          identitySpacePerson &&
          this.isExactSelectedSpaceAssignment(selectedSpaceAssignments, {
            personId: identitySpacePerson.id,
            identityId: face.identityId,
            type,
          })
        ) {
          if (options.refreshExactMetadata) {
            await this.inheritSpacePersonMetadata(spaceId, identitySpacePerson.id, face.identityId, assetAdderId);
          }
          continue;
        }

        if (selectedSpaceAssignments.length > 0) {
          const removedPersonIds = await this.sharedSpaceRepository.removePersonFaceAssignmentsForSpaceFace(
            spaceId,
            face.id,
          );
          for (const personId of removedPersonIds) {
            recountPersonIds.add(personId);
            stalePersonIds.add(personId);
          }
        }

        if (!identitySpacePerson) {
          continue;
        }

        spacePerson = identitySpacePerson;
      } else {
        if (selectedSpaceAssignments.length > 0) {
          continue;
        }
        if (!face.embedding) {
          continue;
        }
        if (maxDistance === undefined) {
          const { machineLearning } = await this.getConfig({ withCache: true });
          maxDistance = machineLearning.facialRecognition.maxDistance;
        }
        spacePerson = await this.findOrCreateSpacePersonForLegacyFace({
          spaceId,
          faceId: face.id,
          personId: face.personId,
          embedding: face.embedding,
          maxDistance,
        });
      }

      await this.sharedSpaceRepository.addPersonFaces([{ personId: spacePerson.id, assetFaceId: face.id }], {
        skipRecount: true,
      });
      let inheritedIdentityId = spacePerson.identityId ?? null;
      if (
        spacePerson.identityId &&
        spacePerson.sourceIdentityId &&
        spacePerson.identityId !== spacePerson.sourceIdentityId
      ) {
        inheritedIdentityId = await this.mergeIdentitiesForSpacePersonEvidence({
          spaceId,
          targetSpacePersonId: spacePerson.id,
          candidateIdentityIds: [spacePerson.identityId, spacePerson.sourceIdentityId],
        });
        await this.queueSpacePersonMetadataBackfill(inheritedIdentityId);
      }
      if (inheritedIdentityId) {
        await this.inheritSpacePersonMetadata(spaceId, spacePerson.id, inheritedIdentityId, assetAdderId);
      }
      affectedPersonIds.add(spacePerson.id);
      recountPersonIds.add(spacePerson.id);
    }

    // Process pet faces (detected by pet detection, no embeddings)
    const petFaces = await this.sharedSpaceRepository.getPetFacesForAsset(assetId);
    for (const petFace of petFaces) {
      const selectedSpaceAssignments = await this.sharedSpaceRepository.getPersonFaceAssignmentsForSpace(
        petFace.id,
        spaceId,
      );

      if (!petFace.personId) {
        continue;
      }

      let spacePerson: SpacePersonMatchResult | undefined;
      if (petFace.identityId) {
        spacePerson = await this.findOrCreateCompatibleSpacePersonForIdentity({
          spaceId,
          faceId: petFace.id,
          personId: petFace.personId,
          identityId: petFace.identityId,
          type: 'pet',
        });

        if (
          spacePerson &&
          this.isExactSelectedSpaceAssignment(selectedSpaceAssignments, {
            personId: spacePerson.id,
            identityId: petFace.identityId,
            type: 'pet',
          })
        ) {
          if (options.refreshExactMetadata) {
            await this.inheritSpacePersonMetadata(spaceId, spacePerson.id, petFace.identityId, assetAdderId);
          }
          continue;
        }

        if (selectedSpaceAssignments.length > 0) {
          const removedPersonIds = await this.sharedSpaceRepository.removePersonFaceAssignmentsForSpaceFace(
            spaceId,
            petFace.id,
          );
          for (const personId of removedPersonIds) {
            recountPersonIds.add(personId);
            stalePersonIds.add(personId);
          }
        }

        if (!spacePerson) {
          continue;
        }
      } else {
        if (selectedSpaceAssignments.length > 0) {
          continue;
        }
        const existingSpacePerson = await this.sharedSpaceRepository.findSpacePersonByLinkedPersonId(
          spaceId,
          petFace.personId,
        );
        const representativeFaceId = existingSpacePerson
          ? petFace.id
          : await this.getNewSpacePersonRepresentativeFaceId({
              spaceId,
              fallbackFaceId: petFace.id,
              personalPersonId: petFace.personId,
            });
        spacePerson =
          existingSpacePerson ??
          (await this.sharedSpaceRepository.createPerson({
            spaceId,
            name: '',
            representativeFaceId,
            type: 'pet',
          }));
      }

      await this.sharedSpaceRepository.addPersonFaces([{ personId: spacePerson.id, assetFaceId: petFace.id }], {
        skipRecount: true,
      });
      if (spacePerson.identityId) {
        await this.inheritSpacePersonMetadata(spaceId, spacePerson.id, spacePerson.identityId, assetAdderId);
      }
      affectedPersonIds.add(spacePerson.id);
      recountPersonIds.add(spacePerson.id);
    }

    if (recountPersonIds.size > 0) {
      await this.sharedSpaceRepository.recountPersons([...recountPersonIds]);
    }
    if (stalePersonIds.size > 0) {
      await this.sharedSpaceRepository.deleteOrphanedPersonsByIds(spaceId, [...stalePersonIds]);
    }
    return [...affectedPersonIds];
  }

  private async findOrCreateCompatibleSpacePersonForIdentity(input: {
    spaceId: string;
    faceId: string;
    personId: string;
    identityId: string;
    type: string;
  }): Promise<SpacePersonMatchResult | undefined> {
    const existingByIdentity = await this.sharedSpaceRepository.getSpacePersonByIdentity(
      input.spaceId,
      input.identityId,
    );
    if (existingByIdentity) {
      if (existingByIdentity.type && existingByIdentity.type !== input.type) {
        return undefined;
      }
      return existingByIdentity;
    }

    const representativeFaceId = await this.getNewSpacePersonRepresentativeFaceId({
      spaceId: input.spaceId,
      fallbackFaceId: input.faceId,
      personalPersonId: input.personId,
    });

    // Race-safe create: concurrent SharedSpaceFaceMatch* jobs carrying faces of this same identity
    // may have created the space person between our getSpacePersonByIdentity check above and here.
    // createOrGetPersonForIdentity returns the winner's row instead of crashing on the
    // (spaceId, identityId) unique index; re-apply the type-compat check since the raced-in row may
    // belong to a different type.
    const spacePerson = await this.sharedSpaceRepository.createOrGetPersonForIdentity({
      spaceId: input.spaceId,
      identityId: input.identityId,
      name: '',
      representativeFaceId,
      type: input.type,
    });
    if (spacePerson.type && spacePerson.type !== input.type) {
      return undefined;
    }
    return spacePerson;
  }

  private isExactSelectedSpaceAssignment(
    assignments: SpaceFaceAssignment[],
    target: { personId: string; identityId: string; type: string },
  ): boolean {
    return (
      assignments.length === 1 &&
      assignments[0].personId === target.personId &&
      assignments[0].identityId === target.identityId &&
      assignments[0].type === target.type
    );
  }

  private async findOrCreateSpacePersonForLegacyFace(input: {
    spaceId: string;
    faceId: string;
    personId: string;
    embedding: string;
    maxDistance: number;
  }): Promise<SpacePersonMatchResult> {
    const existingSpacePerson = await this.sharedSpaceRepository.findSpacePersonByLinkedPersonId(
      input.spaceId,
      input.personId,
    );

    if (existingSpacePerson) {
      return existingSpacePerson;
    }

    const matches = await this.sharedSpaceRepository.findClosestSpacePerson(input.spaceId, input.embedding, {
      maxDistance: input.maxDistance,
      numResults: 1,
    });

    if (matches.length > 0) {
      return { id: matches[0].personId, identityId: matches[0].identityId ?? null };
    }

    const representativeFaceId = await this.getNewSpacePersonRepresentativeFaceId({
      spaceId: input.spaceId,
      fallbackFaceId: input.faceId,
      personalPersonId: input.personId,
    });

    return this.sharedSpaceRepository.createPerson({
      spaceId: input.spaceId,
      name: '',
      representativeFaceId,
      type: 'person',
    });
  }

  private async getNewSpacePersonRepresentativeFaceId(input: {
    spaceId: string;
    fallbackFaceId: string;
    personalPersonId: string | null;
  }): Promise<string> {
    if (!input.personalPersonId) {
      return input.fallbackFaceId;
    }

    const person = await this.personRepository.getById(input.personalPersonId);
    if (!person?.thumbnailPath || !person.faceAssetId) {
      return input.fallbackFaceId;
    }

    if (person.faceAssetId === input.fallbackFaceId) {
      return input.fallbackFaceId;
    }

    const isFeatureFaceInSpace = await this.sharedSpaceRepository.isFaceInSpace(input.spaceId, person.faceAssetId);
    return isFeatureFaceInSpace ? person.faceAssetId : input.fallbackFaceId;
  }

  private async mergeIdentitiesForSpacePersonEvidence(input: {
    spaceId: string;
    targetSpacePersonId: string;
    candidateIdentityIds: string[];
  }): Promise<string> {
    const targetSpacePerson = await this.sharedSpaceRepository.getPersonById(input.targetSpacePersonId);
    const candidates = [...new Set(input.candidateIdentityIds.filter(Boolean))];
    const evidence = await this.sharedSpaceRepository.getIdentityEvidenceForSpacePerson(
      input.spaceId,
      input.targetSpacePersonId,
      candidates,
    );

    if (!targetSpacePerson || targetSpacePerson.spaceId !== input.spaceId || evidence.length === 0) {
      return candidates[0];
    }

    const types = new Set(evidence.map((item) => item.type));
    if (types.size > 1) {
      this.logger.warn(`Skipping identity merge for space person ${input.targetSpacePersonId}: incompatible types`);
      return (
        targetSpacePerson.identityId ??
        evidence.toSorted((a, b) => a.identityId.localeCompare(b.identityId))[0].identityId
      );
    }

    // Hoisted so the ternary's branches don't share a trailing `.identityId`
    // (unicorn/prefer-minimal-ternary). Safe to evaluate eagerly: when `evidence`
    // is empty, `evidence.some(...)` is false, so the old code took this same
    // branch and threw identically.
    const strongestEvidenceIdentityId = evidence.toSorted((a, b) => {
      const supportDelta = Number(b.supportingFaceCount) - Number(a.supportingFaceCount);
      return supportDelta === 0 ? a.identityId.localeCompare(b.identityId) : supportDelta;
    })[0].identityId;
    const targetIdentityId =
      targetSpacePerson.identityId && evidence.some((item) => item.identityId === targetSpacePerson.identityId)
        ? targetSpacePerson.identityId
        : strongestEvidenceIdentityId;

    const sourceIdentityIds = evidence
      .map((item) => item.identityId)
      .filter((identityId) => identityId !== targetIdentityId)
      .toSorted();

    if (sourceIdentityIds.length > 0) {
      await this.faceIdentityRepository.mergeIdentities({
        targetIdentityId,
        sourceIdentityIds,
        source: 'shared-space-evidence',
      });
    }

    if (targetSpacePerson.identityId !== targetIdentityId) {
      await this.sharedSpaceRepository.updatePerson(input.targetSpacePersonId, { identityId: targetIdentityId });
    }

    return targetIdentityId;
  }

  private async inheritSpacePersonMetadata(
    spaceId: string,
    spacePersonId: string,
    identityId: string,
    assetAdderIdOrIds?: string | string[] | null,
  ): Promise<SpacePersonMetadataInheritanceResult> {
    const person = await this.sharedSpaceRepository.getPersonById(spacePersonId);
    if (!person || person.spaceId !== spaceId) {
      return { didInherit: false };
    }
    const assetAdderIds = Array.isArray(assetAdderIdOrIds)
      ? assetAdderIdOrIds
      : assetAdderIdOrIds
        ? [assetAdderIdOrIds]
        : [];

    const metadataCandidates = await this.sharedSpaceRepository.getMetadataInheritanceCandidates({
      spaceId,
      identityId,
      assetAdderIds,
    });
    const candidates = metadataCandidates.filter((item) => item.type === person.type);
    const updates: Parameters<typeof this.sharedSpaceRepository.updatePerson>[1] = {};
    const now = new Date();
    const nameCandidates = candidates.filter((candidate) => candidate.name.trim().length > 0);
    const birthDateCandidates = candidates.filter((candidate) => candidate.birthDate !== null);
    const nameCandidate = this.selectMetadataCandidate(nameCandidates, (candidate) => candidate.name.trim());
    const birthDateCandidate = this.selectMetadataCandidate(
      birthDateCandidates,
      (candidate) => asDateString(candidate.birthDate) ?? '',
    );

    if ((person.nameSource === 'none' || person.nameSource === 'inherited') && nameCandidate) {
      const nameSourceProfileType = nameCandidate.candidate.sourceProfileType ?? 'user-person';
      const nameSourceProfileId = nameCandidate.candidate.sourceProfileId ?? nameCandidate.candidate.personId;
      // Skip when the inherited value and its provenance are unchanged — the metadata backfill scans
      // every space person, and re-stamping nameSourceUpdatedAt rewrites the row (updatedAt trigger)
      // on every pass even though nothing changed.
      const nameUnchanged =
        person.nameSource === 'inherited' &&
        person.name === nameCandidate.value &&
        person.nameSourceProfileType === nameSourceProfileType &&
        person.nameSourceProfileId === nameSourceProfileId;
      if (!nameUnchanged) {
        updates.name = nameCandidate.value;
        updates.nameSource = 'inherited';
        updates.nameSourceProfileType = nameSourceProfileType;
        updates.nameSourceProfileId = nameSourceProfileId;
        updates.nameSourceUpdatedAt = now;
      }
    } else if (person.nameSource === 'inherited' && nameCandidates.length === 0) {
      updates.name = '';
      updates.nameSource = 'none';
      updates.nameSourceProfileType = null;
      updates.nameSourceProfileId = null;
      updates.nameSourceUpdatedAt = null;
    }

    if ((person.birthDateSource === 'none' || person.birthDateSource === 'inherited') && birthDateCandidate) {
      const birthDateSourceProfileType = birthDateCandidate.candidate.sourceProfileType ?? 'user-person';
      const birthDateSourceProfileId =
        birthDateCandidate.candidate.sourceProfileId ?? birthDateCandidate.candidate.personId;
      const birthDateUnchanged =
        person.birthDateSource === 'inherited' &&
        asDateString(person.birthDate) === birthDateCandidate.value &&
        person.birthDateSourceProfileType === birthDateSourceProfileType &&
        person.birthDateSourceProfileId === birthDateSourceProfileId;
      if (!birthDateUnchanged) {
        updates.birthDate = birthDateCandidate.value;
        updates.birthDateSource = 'inherited';
        updates.birthDateSourceProfileType = birthDateSourceProfileType;
        updates.birthDateSourceProfileId = birthDateSourceProfileId;
        updates.birthDateSourceUpdatedAt = now;
      }
    } else if (person.birthDateSource === 'inherited' && birthDateCandidates.length === 0) {
      updates.birthDate = null;
      updates.birthDateSource = 'none';
      updates.birthDateSourceProfileType = null;
      updates.birthDateSourceProfileId = null;
      updates.birthDateSourceUpdatedAt = null;
    }

    if (Object.keys(updates).length > 0) {
      await this.sharedSpaceRepository.updatePerson(spacePersonId, updates);
      const nextName = updates.name ?? person.name;
      const nameChanged = typeof updates.name === 'string' && updates.name.trim() !== person.name.trim();
      return {
        didInherit: true,
        ...(nameChanged &&
          this.isNamedVisibleSpacePerson({ ...person, name: nextName }) && {
            suggestionScanCandidate: { ...person, name: nextName },
          }),
      };
    }
    return { didInherit: false };
  }

  private isNamedVisibleSpacePerson(person: Pick<SharedSpacePerson, 'name' | 'isHidden' | 'type'>): boolean {
    return person.name.trim().length > 0 && !person.isHidden && person.type === 'person';
  }

  private async areSpacePersonSuggestionsEnabled({ withCache }: { withCache: boolean }): Promise<boolean> {
    const { machineLearning } = await this.getConfig({ withCache });
    return isFaceSuggestionEnabled(machineLearning);
  }

  private async isSpaceFaceRecognitionEnabled(spaceId: string, cache = new Map<string, boolean>()): Promise<boolean> {
    const cached = cache.get(spaceId);
    if (cached !== undefined) {
      return cached;
    }

    const space = await this.sharedSpaceRepository.getById(spaceId);
    const enabled = !!space?.faceRecognitionEnabled;
    cache.set(spaceId, enabled);
    return enabled;
  }

  private async queueSpacePersonSuggestionScans(candidates: SpacePersonSuggestionScanCandidate[]): Promise<void> {
    if (candidates.length === 0) {
      return;
    }

    const suggestionsEnabled = await this.areSpacePersonSuggestionsEnabled({ withCache: false });
    if (!suggestionsEnabled) {
      return;
    }

    const queuedIds = new Set<string>();
    const spaceEnabledCache = new Map<string, boolean>();
    const jobs: Array<{ name: JobName.SpacePersonSuggestionScan; data: { id: string } }> = [];
    for (const candidate of candidates) {
      if (queuedIds.has(candidate.id) || !this.isNamedVisibleSpacePerson(candidate)) {
        continue;
      }

      if (!(await this.isSpaceFaceRecognitionEnabled(candidate.spaceId, spaceEnabledCache))) {
        continue;
      }

      queuedIds.add(candidate.id);
      jobs.push({ name: JobName.SpacePersonSuggestionScan, data: { id: candidate.id } });
    }

    if (jobs.length > 0) {
      await this.jobRepository.queueAll(jobs);
    }
  }

  private selectMetadataCandidate<
    T extends { role: string; isAssetAdder: boolean; supportingFaceCount: number; sourceProfileType?: string | null },
  >(candidates: T[], getValue: (candidate: T) => string): { candidate: T; value: string } | null {
    if (candidates.length === 0) {
      return null;
    }

    const ranked = candidates
      .map((candidate) => ({ candidate, value: getValue(candidate) }))
      .toSorted((a, b) => {
        const roleDelta = getSharedSpaceRoleScore(b.candidate.role) - getSharedSpaceRoleScore(a.candidate.role);
        if (roleDelta !== 0) {
          return roleDelta;
        }
        const assetAdderDelta = Number(b.candidate.isAssetAdder) - Number(a.candidate.isAssetAdder);
        if (assetAdderDelta !== 0) {
          return assetAdderDelta;
        }
        const faceDelta = Number(b.candidate.supportingFaceCount) - Number(a.candidate.supportingFaceCount);
        if (faceDelta !== 0) {
          return faceDelta;
        }
        const sourceDelta =
          getMetadataSourceScore(b.candidate.sourceProfileType) - getMetadataSourceScore(a.candidate.sourceProfileType);
        if (sourceDelta !== 0) {
          return sourceDelta;
        }
        return 0;
      });

    const best = ranked[0].candidate;
    const topCandidates = ranked.filter(
      (item) =>
        getSharedSpaceRoleScore(item.candidate.role) === getSharedSpaceRoleScore(best.role) &&
        item.candidate.isAssetAdder === best.isAssetAdder &&
        Number(item.candidate.supportingFaceCount) === Number(best.supportingFaceCount) &&
        getMetadataSourceScore(item.candidate.sourceProfileType) === getMetadataSourceScore(best.sourceProfileType),
    );
    const values = new Set(topCandidates.map((item) => item.value));
    return values.size === 1 ? ranked[0] : null;
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

  private async requireSpacePersonInSpace(spaceId: string, personId: string): Promise<SharedSpacePerson> {
    const person = await this.sharedSpaceRepository.getPersonById(personId);
    if (!person || person.spaceId !== spaceId) {
      throw new BadRequestException('Person not found');
    }
    return person;
  }

  private async getFaceSuggestionDistanceConfig() {
    const { machineLearning } = await this.getConfig({ withCache: false });
    return {
      maxDistance: machineLearning.facialRecognition.maxDistance,
      suggestionMaxDistance: machineLearning.facialRecognition.suggestions.maxDistance,
    };
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
    sharePersonMetadata: boolean;
  }): SharedSpaceMemberResponseDto {
    return {
      userId: member.userId,
      name: member.name,
      email: member.email,
      role: member.role as SharedSpaceRole,
      joinedAt: (member.joinedAt as Date).toISOString(),
      profileImagePath: member.profileImagePath,
      profileChangedAt: (member.profileChangedAt as Date).toISOString(),
      avatarColor: member.avatarColor ?? undefined,
      showInTimeline: member.showInTimeline,
      sharePersonMetadata: member.sharePersonMetadata,
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
    thumbnailCropY?: number | null;
    color?: string | null;
    faceRecognitionEnabled?: boolean;
    petsEnabled?: boolean;
    lastActivityAt?: Date | null;
  }): SharedSpaceResponseDto {
    return {
      id: space.id,
      name: space.name,
      description: space.description,
      createdById: space.createdById,
      createdAt: (space.createdAt as Date).toISOString(),
      updatedAt: (space.updatedAt as Date).toISOString(),
      thumbnailAssetId: space.thumbnailAssetId ?? null,
      thumbnailCropY: space.thumbnailCropY ?? null,
      color: (space.color as UserAvatarColor) ?? null,
      faceRecognitionEnabled: space.faceRecognitionEnabled ?? true,
      petsEnabled: space.petsEnabled ?? true,
      lastActivityAt: space.lastActivityAt ? space.lastActivityAt.toISOString() : null,
    };
  }

  private mapSpacePerson(person: SharedSpacePerson, alias: string | null): SharedSpacePersonResponseDto {
    return {
      id: person.id,
      spaceId: person.spaceId,
      name: person.name || '',
      thumbnailPath: '',
      isHidden: person.isHidden,
      birthDate: asDateString(person.birthDate),
      representativeFaceId: person.representativeFaceId,
      representativeFaceSource: person.representativeFaceSource ?? 'auto',
      faceCount: person.faceCount,
      assetCount: person.assetCount,
      alias,
      createdAt: (person.createdAt as unknown as Date).toISOString(),
      updatedAt: (person.updatedAt as unknown as Date).toISOString(),
      type: person.type,
    };
  }

  // C2: after a transient failure in a best-effort face-people projection handler, enqueue the
  // durable per-space reconcile (SharedSpaceFaceMatchAll → paged re-projection + dedup recount +
  // deleteOrphanedPersons) so the projection converges. Idempotent (jobId is per-space); never throws.
  private async enqueueSpaceFaceProjectionReconcile(spaceIds: string[]): Promise<void> {
    const uniqueSpaceIds = [...new Set(spaceIds)];
    if (uniqueSpaceIds.length === 0) {
      return;
    }
    try {
      await this.jobRepository.queueAll(
        uniqueSpaceIds.map((spaceId) => ({ name: JobName.SharedSpaceFaceMatchAll as const, data: { spaceId } })),
      );
    } catch (error) {
      this.logger.error(
        `Failed to enqueue space face-projection reconcile for spaces ${uniqueSpaceIds.join(', ')}: ${error}`,
      );
    }
  }

  // Space people sync is a best-effort side effect of an album mutation. EventRepository.onEvent
  // awaits handlers inline and does not isolate their errors, so a throw here would bubble up and
  // fail the user's album add/remove. Guard the whole body in try/catch: face matches are also
  // recoverable via the post-detection backfill, so logging and moving on is correct. On failure,
  // fall back to the durable per-space reconcile (C2) so the projection still converges.
  @OnEvent({ name: 'AlbumAssetsAdd' })
  async onAlbumAssetsAdd({ albumId, assetIds }: ArgOf<'AlbumAssetsAdd'>): Promise<void> {
    if (assetIds.length === 0) {
      return;
    }
    let faceEnabledSpaceIds: string[];
    try {
      const spaces = await this.sharedSpaceRepository.getSpacesLinkedToAlbum(albumId);
      faceEnabledSpaceIds = spaces.filter((space) => space.faceRecognitionEnabled).map((space) => space.spaceId);
    } catch (error) {
      this.logger.error(`Failed to resolve spaces for album ${albumId} face-people sync: ${error}`);
      return;
    }
    try {
      const jobs = faceEnabledSpaceIds.flatMap((spaceId) =>
        assetIds.map((assetId) => ({ name: JobName.SharedSpaceFaceMatch as const, data: { spaceId, assetId } })),
      );
      if (jobs.length > 0) {
        await this.jobRepository.queueAll(jobs);
      }
    } catch (error) {
      this.logger.error(`Failed to sync space people after adding assets to album ${albumId}: ${error}`);
      await this.enqueueSpaceFaceProjectionReconcile(faceEnabledSpaceIds);
    }
  }

  // Emit-timing note: AssetDelete fires AFTER the asset row and its DB cascade
  // (asset → asset_face → shared_space_person_face) have already run.  By the time this
  // handler executes, those rows are gone.  The affected (spaceId, personId) pairs are
  // therefore captured at the emit site in asset.service.ts BEFORE deletion via
  // sharedSpaceRepository.getSpacePersonsForAsset() and forwarded in the payload.
  @OnEvent({ name: 'AssetDelete' })
  async onAssetDelete({ assetId, affectedSpacePersons }: ArgOf<'AssetDelete'>): Promise<void> {
    if (!affectedSpacePersons || affectedSpacePersons.length === 0) {
      return;
    }
    // Group personIds by spaceId: one recount + orphan-cleanup pass per space.
    const spacePersonMap = new Map<string, string[]>();
    for (const { spaceId, personId } of affectedSpacePersons) {
      let ids = spacePersonMap.get(spaceId);
      if (!ids) {
        ids = [];
        spacePersonMap.set(spaceId, ids);
      }
      ids.push(personId);
    }
    try {
      for (const [spaceId, personIds] of spacePersonMap) {
        await this.sharedSpaceRepository.recountPersons(personIds);
        await this.sharedSpaceRepository.deleteOrphanedPersons(spaceId);
      }
    } catch (error) {
      this.logger.error(`Failed to sync space people after deleting asset ${assetId}: ${error}`);
      await this.enqueueSpaceFaceProjectionReconcile(spacePersonMap.keys().toArray());
    }
  }

  @OnEvent({ name: 'AlbumDelete' })
  async onAlbumDelete({ albumId }: ArgOf<'AlbumDelete'>): Promise<void> {
    let faceEnabledSpaceIds: string[];
    try {
      const spaces = await this.sharedSpaceRepository.getSpacesLinkedToAlbum(albumId);
      faceEnabledSpaceIds = spaces.filter((space) => space.faceRecognitionEnabled).map((space) => space.spaceId);
    } catch (error) {
      this.logger.error(`Failed to resolve spaces for album ${albumId} face-people sync: ${error}`);
      return;
    }
    try {
      let anyOrphanWork = false;
      for (const spaceId of faceEnabledSpaceIds) {
        const orphaned = await this.sharedSpaceRepository.getAlbumAssetIdsWithoutOtherSpacePath(spaceId, albumId);
        if (orphaned.length === 0) {
          continue;
        }
        await this.sharedSpaceRepository.removePersonFacesByAssetIds(spaceId, orphaned);
        await this.sharedSpaceRepository.deleteOrphanedPersons(spaceId);
        anyOrphanWork = true;
      }
      if (anyOrphanWork) {
        await this.queueSpacePersonMetadataBackfill();
      }
    } catch (error) {
      this.logger.error(`Failed to sync space people after deleting album ${albumId}: ${error}`);
      await this.enqueueSpaceFaceProjectionReconcile(faceEnabledSpaceIds);
    }
  }

  @OnEvent({ name: 'AlbumAssetsRemove' })
  async onAlbumAssetsRemove({ albumId, assetIds }: ArgOf<'AlbumAssetsRemove'>): Promise<void> {
    if (assetIds.length === 0) {
      return;
    }
    let faceEnabledSpaceIds: string[];
    try {
      const spaces = await this.sharedSpaceRepository.getSpacesLinkedToAlbum(albumId);
      faceEnabledSpaceIds = spaces.filter((space) => space.faceRecognitionEnabled).map((space) => space.spaceId);
    } catch (error) {
      this.logger.error(`Failed to resolve spaces for album ${albumId} face-people sync: ${error}`);
      return;
    }
    try {
      let anyOrphanWork = false;
      for (const spaceId of faceEnabledSpaceIds) {
        const orphaned = await this.sharedSpaceRepository.getAssetIdsWithoutOtherSpacePath(spaceId, assetIds);
        if (orphaned.length === 0) {
          continue;
        }
        await this.sharedSpaceRepository.removePersonFacesByAssetIds(spaceId, orphaned);
        await this.sharedSpaceRepository.deleteOrphanedPersons(spaceId);
        anyOrphanWork = true;
      }
      if (anyOrphanWork) {
        await this.queueSpacePersonMetadataBackfill();
      }
    } catch (error) {
      this.logger.error(`Failed to sync space people after removing assets from album ${albumId}: ${error}`);
      await this.enqueueSpaceFaceProjectionReconcile(faceEnabledSpaceIds);
    }
  }
}
