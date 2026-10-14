import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { MergeAuthorizer } from 'src/services/identity-merge-propagation.service.js';
import { AuthDto } from 'src/dtos/auth.dto.js';
import {
  DetachScopedPersonDto,
  MergeScopedPeopleDto,
  PeopleFaceStatisticsResponseDto,
  PeopleStatisticsResponseDto,
  PersonFacePageQueryDto,
  PersonFacePageResponseDto,
  PersonResponseDto,
  PersonSearchDto,
  RepresentativeFaceUpdateDto,
  mapPerson,
} from 'src/dtos/person.dto.js';
import { JobName, Permission } from 'src/enum.js';
import { crossOwnerMergeAuthorizer, resolveMinimumFaceCount } from 'src/gallery/people-config.js';
import { BaseService } from 'src/services/base.service.js';
import { asDateTimeString } from 'src/utils/date.js';
import { ImmichMediaResponse } from 'src/utils/file.js';
import { findOrFail } from 'src/utils/misc.js';

@Injectable()
export class GalleryPeopleService extends BaseService {
  private async crossOwnerMergeAuthorizer(dto: { confirmCrossOwner?: boolean }): Promise<MergeAuthorizer> {
    return crossOwnerMergeAuthorizer(await this.getConfig({ withCache: false }), dto);
  }

  private async resolveMinimumFaceCount(auth: AuthDto): Promise<number> {
    return resolveMinimumFaceCount(
      await this.getConfig({ withCache: false }),
      await this.userRepository.getMetadata(auth.user.id),
    );
  }

  async getPeopleStatistics(auth: AuthDto, dto: PersonSearchDto): Promise<PeopleStatisticsResponseDto> {
    if (dto.closestPersonId || dto.closestAssetId) {
      throw new BadRequestException('closestPersonId and closestAssetId are not supported for people statistics');
    }

    const minimumFaceCount = await this.resolveMinimumFaceCount(auth);

    if (dto.withSharedSpaces) {
      return this.faceIdentityRepository.getAccessiblePeopleStatistics(auth.user.id, {
        minimumFaceCount,
      });
    }

    return this.personRepository.getPeopleOverviewStatistics(auth.user.id, {
      minimumFaceCount,
    });
  }

  async getPeopleFaceStatistics(auth: AuthDto, dto: PersonSearchDto): Promise<PeopleFaceStatisticsResponseDto> {
    if (dto.closestPersonId || dto.closestAssetId) {
      throw new BadRequestException('closestPersonId and closestAssetId are not supported for people face statistics');
    }

    const minimumFaceCount = await this.resolveMinimumFaceCount(auth);

    if (dto.withSharedSpaces) {
      return this.faceIdentityRepository.getAccessiblePeopleFaceStatistics(auth.user.id, {
        minimumFaceCount,
      });
    }

    return this.personRepository.getPeopleFaceStatistics(auth.user.id, {
      minimumFaceCount,
    });
  }

  /**
   * The scoped merge (POST /people/same-person): merge people named by scoped refs — the actor's own people and
   * any space person they can repair. The planner resolves and RBAC-checks the refs, collapses profiles that
   * would land in the same scope, and propagates the identity merge everywhere it is attached (issue #733).
   *
   * The only thing gated here is the destructive cross-owner case: a merge that would combine two of ANOTHER
   * user's people. Re-pointing another owner's single person is free — that is what recognition does on its own.
   */
  async mergeScopedPeople(auth: AuthDto, dto: MergeScopedPeopleDto): Promise<void> {
    await this.identityMergePropagationService.mergeScopedProfiles(
      auth,
      dto,
      await this.crossOwnerMergeAuthorizer(dto),
    );
  }

  async detachScopedPerson(auth: AuthDto, dto: DetachScopedPersonDto): Promise<void> {
    const resolved = await this.faceIdentityRepository.resolveDetachRef(auth.user.id, dto.profile);
    if (!resolved.accessible) {
      throw new BadRequestException('Person was not found or is not accessible');
    }
    if (!resolved.allBackingFacesRepairable) {
      throw new ForbiddenException('Cannot detach a profile whose faces also back inaccessible profiles');
    }

    await this.faceIdentityRepository.detachScopedProfile(dto.profile);
    await this.jobRepository.queue({ name: JobName.SharedSpacePersonMetadataBackfill, data: {} });
  }

  async getFacesForPicker(auth: AuthDto, id: string, dto: PersonFacePageQueryDto): Promise<PersonFacePageResponseDto> {
    await this.requireAccess({ auth, permission: Permission.PersonRead, ids: [id] });
    const person = await findOrFail(() => this.personRepository.getByGroupIdOnly(id), 'Person');
    const take = dto.size;
    // Fork RBAC (Slice 2 / M1): PersonRead also admits non-owner space-granted callers. Scope those
    // callers to space-reachable, shareable-visibility faces only — never the owner's Hidden/
    // never-shared faces or faces pulled in via another user's identity. The owner keeps the full,
    // unscoped list.
    const isOwner = await this.accessRepository.person.checkOwnerAccess(auth.user.id, new Set([id]));
    const scope = isOwner.has(id) ? undefined : { memberUserId: auth.user.id };
    const rows = await this.personRepository.getRepresentativeFaces({
      personId: id,
      take,
      skip: (dto.page - 1) * dto.size,
      scope,
      hasElevatedPermission: auth.session?.hasElevatedPermission,
    });
    const faces = rows.slice(0, take);

    return {
      faces: faces.map((face) => ({
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
        isRepresentative: face.id === person.faceAssetId,
      })),
      hasNextPage: rows.length > take,
    };
  }

  async getFaceThumbnail(auth: AuthDto, personId: string, faceId: string): Promise<ImmichMediaResponse> {
    await this.requireAccess({ auth, permission: Permission.PersonRead, ids: [personId] });
    const face = await this.personRepository.getRepresentativeFaceForUpdate({ personId, assetFaceId: faceId });
    if (!face) {
      throw new NotFoundException();
    }

    await this.requireAccess({ auth, permission: Permission.AssetRead, ids: [face.assetId] });
    const sourcePath = await this.getFaceThumbnailSource(face.assetId);
    if (!sourcePath) {
      throw new NotFoundException();
    }

    return this.generateFaceThumbnailResponse(face, sourcePath);
  }

  async updateRepresentativeFace(
    auth: AuthDto,
    id: string,
    dto: RepresentativeFaceUpdateDto,
  ): Promise<PersonResponseDto> {
    // Setting the representative face manages the person's thumbnail, which shared-space Editors
    // can also do — so gate on person.read (owner | shared space) rather than owner-only
    // person.update. The chosen face is still gated on asset.read below.
    await this.requireAccess({ auth, permission: Permission.PersonRead, ids: [id] });
    const current = await findOrFail(() => this.personRepository.getByGroupIdOnly(id), 'Person');

    // Fork RBAC (Slice 3 / M2): PersonRead only proves reachability (viewers included). Mutating the
    // owner's GLOBAL representative face must be limited to the owner or an Editor/Owner of a space
    // the person is shared through — mirror album writes. A viewer is denied.
    const ids = new Set([id]);
    const isOwner = await this.accessRepository.person.checkOwnerAccess(auth.user.id, ids);
    if (!isOwner.has(id)) {
      const canEdit = await this.accessRepository.person.checkSharedSpaceEditAccess(auth.user.id, ids);
      if (!canEdit.has(id)) {
        throw new ForbiddenException('Not authorized to change this person');
      }
    }

    const face = await this.personRepository.getRepresentativeFaceForUpdate({
      personId: id,
      assetFaceId: dto.assetFaceId,
    });
    if (!face) {
      throw new BadRequestException('Representative face must belong to the person');
    }

    await this.requireAccess({ auth, permission: Permission.AssetRead, ids: [face.assetId] });
    const person = await this.personRepository.update({
      ownerId: current.ownerId,
      personGroupId: id,
      faceAssetId: face.id,
    });
    if (current.identityId) {
      await this.faceIdentityRepository.updateRepresentativeFace({
        identityId: current.identityId,
        assetFaceId: face.id,
      });
    }

    await this.jobRepository.queue({
      name: JobName.PersonGenerateThumbnail,
      data: { ownerId: current.ownerId, personGroupId: id },
    });
    return mapPerson(person);
  }
}
