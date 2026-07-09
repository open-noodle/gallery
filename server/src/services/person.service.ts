import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Insertable } from 'kysely';
import { isAbsolute } from 'node:path';
import { Chunked, OnEvent, OnJob } from 'src/decorators';
import { BulkIdErrorReason, BulkIdResponseDto, BulkIdsDto } from 'src/dtos/asset-ids.response.dto';
import { AuthDto } from 'src/dtos/auth.dto';
import {
  AssetFaceCreateDto,
  AssetFaceDeleteDto,
  AssetFaceResponseDto,
  AssetFaceUpdateDto,
  DetachScopedPersonDto,
  FaceDto,
  mapFaces,
  mapPerson,
  MergePersonDto,
  MergeScopedPeopleDto,
  PeopleFaceStatisticsResponseDto,
  PeopleResponseDto,
  PeopleStatisticsResponseDto,
  PeopleUpdateDto,
  PersonCreateDto,
  PersonFacePageQueryDto,
  PersonFacePageResponseDto,
  PersonResponseDto,
  PersonSearchDto,
  PersonStatisticsResponseDto,
  PersonUpdateDto,
  RepresentativeFaceUpdateDto,
} from 'src/dtos/person.dto';
import {
  AssetVisibility,
  CacheControl,
  ImmichWorker,
  JobName,
  JobStatus,
  Permission,
  PersonPathType,
  QueueJobStatus,
  QueueName,
  SourceType,
  SystemMetadataKey,
  VectorIndex,
} from 'src/enum';
import type {
  AccessibleIdentityFaceMatch,
  SharedSpaceFaceMatchBackfillTarget,
} from 'src/repositories/face-identity.repository';
import { BoundingBox } from 'src/repositories/machine-learning.repository';
import { AssetFaceTable } from 'src/schema/tables/asset-face.table';
import { FaceSearchTable } from 'src/schema/tables/face-search.table';
import { PersonTable } from 'src/schema/tables/person.table';
import {
  buildAutomaticReconciliationClaim,
  chooseAutomaticTargetIdentity,
} from 'src/services/accessible-identity-reconciliation';
import { PersonId } from 'src/repositories/person.repository';
import { BaseService } from 'src/services/base.service';
import { JobItem, JobOf } from 'src/types';
import { getDimensions } from 'src/utils/asset.util';
import { asDateTimeString } from 'src/utils/date';
import { ImmichMediaResponse } from 'src/utils/file';
import { mimeTypes } from 'src/utils/mime-types';
import { batched, findOrFail, isFacialRecognitionEnabled } from 'src/utils/misc';
import { getPreferences } from 'src/utils/preferences';
import { Point, transformPoints } from 'src/utils/transform';

const personKey = ({ ownerId, personGroupId }: PersonId) => `${ownerId}/${personGroupId}`;
const FACE_IDENTITY_BACKFILL_CHUNK_SIZE = 1000;

/**
 * Upper bound on full re-scan passes one backfill chain may take when getBackfillWork() keeps
 * reporting identity work. Repair passes are designed to converge in one or two passes; work that
 * is still outstanding at the cap indicates a convergence bug, and re-queueing would otherwise
 * loop full-table scans forever. The next external trigger (bootstrap, post-recognition
 * maintenance, or a manual run) starts a fresh chain.
 */
export const FACE_IDENTITY_BACKFILL_MAX_CONTINUATIONS = 5;

/**
 * Machine-readable error codes for the cross-owner scoped-merge boundary (issue #733). Returned in
 * the exception body so the web client can render descriptive UX (an enable hint or a strong
 * confirmation) instead of a raw error string.
 */
export const CROSS_OWNER_MERGE_ERROR_CODE = {
  /** The merge crosses an owner boundary and is not permitted because the instance toggle is off. */
  blocked: 'cross_owner_merge_blocked',
  /** The instance toggle is on: the merge is permitted but must be explicitly confirmed before it commits. */
  confirmationRequired: 'cross_owner_merge_confirmation_required',
} as const;

@Injectable()
export class PersonService extends BaseService {
  @OnEvent({ name: 'AppBootstrap', workers: [ImmichWorker.Microservices] })
  async onBootstrap(): Promise<void> {
    if (await this.faceIdentityRepository.hasBackfillWork()) {
      const activeBackfills = await this.jobRepository.searchJobs(QueueName.PeopleBackfill, {
        status: [QueueJobStatus.Active, QueueJobStatus.Delayed, QueueJobStatus.Paused, QueueJobStatus.Waiting],
      });
      if (activeBackfills.some((job) => job.name === JobName.FaceIdentityBackfill)) {
        return;
      }

      await this.jobRepository.queue({ name: JobName.FaceIdentityBackfill, data: {} });
    }
  }

  /**
   * Resolve the caller's People face threshold. The per-user `people.minimumFaces` preference
   * (default 3 via `getPreferences`) takes precedence over the ML config default. This keeps the
   * People count/stats surfaces consistent with the People list, whose SQL (`getAllForUser`,
   * `person.repository.ts`) already reads the same preference with a literal `3` fallback — so the
   * resolved value matches what the list applies, and neither path double-filters.
   */
  private async resolveMinimumFaceCount(auth: AuthDto): Promise<number> {
    const { machineLearning } = await this.getConfig({ withCache: false });
    const preferences = getPreferences(await this.userRepository.getMetadata(auth.user.id));
    return preferences.people.minimumFaces ?? machineLearning.facialRecognition.minFaces;
  }

  async getAll(auth: AuthDto, dto: PersonSearchDto): Promise<PeopleResponseDto> {
    const { withHidden = false, withSharedSpaces = false, closestAssetId, closestPersonId, page, size } = dto;
    const minimumFaceCount = await this.resolveMinimumFaceCount(auth);

    if (withSharedSpaces) {
      return this.faceIdentityRepository.getAccessiblePeople(auth.user.id, {
        withHidden,
        page,
        size,
        minimumFaceCount,
      });
    }

    let closestFaceAssetId = closestAssetId;
    const pagination = {
      take: size,
      skip: (page - 1) * size,
    };

    if (closestPersonId) {
      const person = await this.personRepository.getByGroupId({
        ownerId: auth.user.id,
        personGroupId: closestPersonId,
      });
      if (!person?.faceAssetId) {
        throw new NotFoundException('Person not found');
      }
      closestFaceAssetId = person.faceAssetId;
    }
    const { items, hasNextPage } = await this.personRepository.getAllForUser(pagination, auth.user.id, {
      withHidden,
      closestFaceAssetId,
    });
    const { total, hidden } = await this.personRepository.getNumberOfPeople(auth.user.id, {
      minimumFaceCount,
    });

    return {
      people: items.map((person) => mapPerson(person)),
      hasNextPage,
      total,
      hidden,
    };
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

  async mergeScopedPeople(auth: AuthDto, dto: MergeScopedPeopleDto): Promise<void> {
    const resolved = await this.faceIdentityRepository.resolveRepairRefs(auth.user.id, dto);
    if (!resolved.accessible) {
      throw new BadRequestException('One or more people were not found or are not accessible');
    }

    // A same-scope profile conflict is a terminal 400: the merge can never commit. Surface it before
    // the cross-owner confirmation below so the user is not asked to acknowledge a strong/danger
    // dialog and re-submit only to then hard-fail on a merge that could never have completed.
    if (resolved.hasScopedProfileConflict) {
      throw new BadRequestException('Cannot merge people that already have separate profiles in the same scope');
    }

    // A cross-owner merge rewrites another user's `person.identityId` and re-links their faces. It is
    // blocked by default and only permitted once the instance opts in via the
    // `server.mergePeopleAcrossOwners` toggle (issue #733); with the toggle off every user gets a
    // descriptive, machine-readable error, and with it on any user must explicitly confirm before it
    // commits. This loosening applies only to genuine cross-owner merges (another user's personal
    // person). It stays hard-blocked regardless of the toggle when there is no identifiable other
    // owner to authorize, OR when an involved identity also has a shared-space profile in a space the
    // actor cannot repair (viewer / non-member): merging would regroup that space's people (which the
    // actor could not otherwise touch) and the identity cannot be cleanly split, so the toggle path
    // covers only other users' personal people.
    if (!resolved.allAttachedProfilesRepairable) {
      if (resolved.impactedOwnerIds.length === 0 || resolved.hasInaccessibleAttachedSpaceProfile) {
        throw new ForbiddenException('Cannot merge identities with inaccessible attached profiles');
      }
      await this.authorizeCrossOwnerMerge(dto, resolved.impactedOwnerIds);
    }

    await this.faceIdentityRepository.mergeIdentities({
      targetIdentityId: resolved.targetIdentityId,
      sourceIdentityIds: resolved.sourceIdentityIds,
      source: 'manual',
    });
    await this.queueSpacePersonMetadataBackfill();
  }

  /**
   * Enforce the cross-owner merge policy (issue #733). A cross-owner merge is blocked unless the
   * instance has opted in via the `server.mergePeopleAcrossOwners` toggle; once enabled it is a
   * normal action available to any user with merge access, but it must be explicitly confirmed
   * before it commits. The toggle defaults off.
   */
  private async authorizeCrossOwnerMerge(dto: MergeScopedPeopleDto, impactedOwnerIds: string[]): Promise<void> {
    const { server } = await this.getConfig({ withCache: false });
    if (!server.mergePeopleAcrossOwners) {
      throw new ForbiddenException({
        code: CROSS_OWNER_MERGE_ERROR_CODE.blocked,
        message:
          'This person also appears in another user’s library, so merging would modify people and faces owned by someone else. An administrator can enable cross-owner merges in the server settings.',
      });
    }

    if (!dto.confirmCrossOwner) {
      throw new ConflictException({
        code: CROSS_OWNER_MERGE_ERROR_CODE.confirmationRequired,
        message:
          'This merge will modify people and faces owned by other users and may not be cleanly reversible. Confirm to continue.',
        impactedOwnerCount: impactedOwnerIds.length,
      });
    }
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
    await this.queueSpacePersonMetadataBackfill();
  }

  async reassignFaces(auth: AuthDto, personGroupId: string, dto: AssetFaceUpdateDto): Promise<PersonResponseDto[]> {
    await this.requireAccess({ auth, permission: Permission.PersonUpdate, ids: [personGroupId] });
    const person = await this.findOrFail(auth, personGroupId);
    const result: PersonResponseDto[] = [];
    const changeFeaturePhoto = new Map<string, PersonId>();
    for (const data of dto.data) {
      const faces = await this.personRepository.getFacesByIds(
        [{ personGroupId: data.personId, assetId: data.assetId }],
        { viewingUserId: auth.user.id },
      );

      for (const face of faces) {
        await this.requireAccess({ auth, permission: Permission.PersonCreate, ids: [face.id] });
        if (person.faceAssetId === null) {
          changeFeaturePhoto.set(personKey(person), person);
        }
        if (face.person && face.person.faceAssetId === face.id) {
          changeFeaturePhoto.set(personKey(face.person), face.person);
        }

        await this.personRepository.reassignFace(face.id, person.personGroupId);
        await this.replaceFaceIdentity(person.personGroupId, face.id, 'manual');
      }

      result.push(mapPerson(person));
    }
    if (changeFeaturePhoto.size > 0) {
      await this.createNewFeaturePhoto(changeFeaturePhoto.values().toArray());
    }
    return result;
  }

  async reassignFacesById(auth: AuthDto, personGroupId: string, dto: FaceDto): Promise<PersonResponseDto> {
    await this.requireAccess({ auth, permission: Permission.PersonUpdate, ids: [personGroupId] });
    await this.requireAccess({ auth, permission: Permission.PersonCreate, ids: [dto.id] });
    const face = await this.personRepository.getFaceById(dto.id, { viewingUserId: auth.user.id });
    const person = await this.findOrFail(auth, personGroupId);

    await this.personRepository.reassignFace(face.id, person.personGroupId);
    await this.replaceFaceIdentity(person.personGroupId, face.id, 'manual');
    if (person.faceAssetId === null) {
      await this.createNewFeaturePhoto([person]);
    }
    if (face.person && face.person.faceAssetId === face.id) {
      await this.createNewFeaturePhoto([face.person]);
    }

    return mapPerson(await this.findOrFail(auth, personGroupId));
  }

  async getFacesById(auth: AuthDto, dto: FaceDto): Promise<AssetFaceResponseDto[]> {
    await this.requireAccess({ auth, permission: Permission.AssetRead, ids: [dto.id] });
    const faces = await this.personRepository.getFaces(dto.id, { viewingUserId: auth.user.id, isVisible: true });
    const asset = await this.assetRepository.getForFaces(dto.id);
    const assetDimensions = getDimensions(asset);

    return faces.map((face) => mapFaces(face, auth, asset.edits, assetDimensions));
  }

  async createNewFeaturePhoto(changeFeaturePhoto: PersonId[]) {
    this.logger.debug(
      `Changing feature photos for ${changeFeaturePhoto.length} ${changeFeaturePhoto.length > 1 ? 'people' : 'person'}`,
    );

    const jobs: JobItem[] = [];
    for (const { ownerId, personGroupId } of changeFeaturePhoto) {
      const assetFace = await this.personRepository.getRandomFace(personGroupId);

      if (assetFace) {
        await this.personRepository.update({ ownerId, personGroupId, faceAssetId: assetFace.id });
        jobs.push({ name: JobName.PersonGenerateThumbnail, data: { ownerId, personGroupId } });
      }
    }

    await this.jobRepository.queueAll(jobs);
  }

  async getById(auth: AuthDto, id: string): Promise<PersonResponseDto> {
    const allowedIds = await this.checkAccess({ auth, permission: Permission.PersonRead, ids: [id] });
    if (allowedIds.has(id)) {
      const person = await this.findOrFail(auth, id);
      const response = mapPerson(person);
      // Name and birthday set in a shared space are resolved at read time (never written back to
      // `person`). The owner accessing their own person short-circuits the resolver, so overlay the
      // identity-wide resolution here — otherwise they see the raw, often-empty `person.birthDate`.
      if (person.identityId) {
        const resolved = await this.faceIdentityRepository.getResolvedPersonByIdentityId(
          auth.user.id,
          person.identityId,
        );
        if (resolved) {
          response.name = resolved.name;
          response.birthDate = resolved.birthDate;
        }
      }
      return response;
    }

    const accessiblePerson = await this.faceIdentityRepository.getAccessiblePersonByProfileId(auth.user.id, id);
    if (accessiblePerson) {
      return accessiblePerson;
    }

    throw new BadRequestException(`Not found or no ${Permission.PersonRead} access`);
  }

  async getFacesForPicker(auth: AuthDto, id: string, dto: PersonFacePageQueryDto): Promise<PersonFacePageResponseDto> {
    const person = await this.findOrFail(id);
    const take = dto.size;
    const rows = await this.personRepository.getRepresentativeFaces({
      personId: id,
      take,
      skip: (dto.page - 1) * dto.size,
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
    // Setting the representative face manages the person's thumbnail, which shared-space members
    // can also do — so gate on person.read (owner | shared space) rather than owner-only
    // person.update. The chosen face is still gated on asset.read below.
    await this.requireAccess({ auth, permission: Permission.PersonRead, ids: [id] });
    const current = await this.findOrFail(id);
    const face = await this.personRepository.getRepresentativeFaceForUpdate({
      personId: id,
      assetFaceId: dto.assetFaceId,
    });
    if (!face) {
      throw new BadRequestException('Representative face must belong to the person');
    }

    await this.requireAccess({ auth, permission: Permission.AssetRead, ids: [face.assetId] });
    const person = await this.personRepository.update({ id, faceAssetId: face.id });
    if (current.identityId) {
      await this.faceIdentityRepository.updateRepresentativeFace({
        identityId: current.identityId,
        assetFaceId: face.id,
      });
    }

    await this.jobRepository.queue({ name: JobName.PersonGenerateThumbnail, data: { id } });
    return mapPerson(person);
  }

  async getStatistics(auth: AuthDto, id: string): Promise<PersonStatisticsResponseDto> {
    const allowedIds = await this.checkAccess({ auth, permission: Permission.PersonRead, ids: [id] });
    if (allowedIds.has(id)) {
      const person = await this.findOrFail(auth, id);
      if (person.identityId) {
        return this.faceIdentityRepository.getAccessiblePersonStatistics(auth.user.id, person.identityId);
      }

      return this.personRepository.getStatistics(id, auth.user.id);
    }

    const identityId = await this.faceIdentityRepository.getAccessibleProfileIdentityId(auth.user.id, id);
    if (!identityId) {
      throw new BadRequestException(`Not found or no ${Permission.PersonRead} access`);
    }

    return this.faceIdentityRepository.getAccessiblePersonStatistics(auth.user.id, identityId);
  }

  async getThumbnail(auth: AuthDto, personGroupId: string): Promise<ImmichMediaResponse> {
    await this.requireThumbnailAccess(auth, personGroupId);
    const person = await this.personRepository.getByGroupIdOnly(personGroupId);
    if (!person || !person.thumbnailPath) {
      throw new NotFoundException();
    }

    return this.serveFromBackend(
      person.thumbnailPath,
      mimeTypes.lookup(person.thumbnailPath),
      CacheControl.PrivateWithoutCache,
    );
  }

  private async requireThumbnailAccess(auth: AuthDto, id: string) {
    const ids = new Set([id]);
    const isOwner = await this.accessRepository.person.checkOwnerAccess(auth.user.id, ids);
    if (isOwner.has(id)) {
      return;
    }

    const isShared = await this.accessRepository.person.checkSharedSpaceAccess(auth.user.id, ids);
    if (!isShared.has(id)) {
      throw new BadRequestException('Not found or no person.read access');
    }
  }

  async create(auth: AuthDto, dto: PersonCreateDto): Promise<PersonResponseDto> {
    const group = await this.personRepository.createGroup(auth.user.id);
    const person = await this.personRepository.create({
      ownerId: auth.user.id,
      personGroupId: group.id,
      name: dto.name,
      birthDate: dto.birthDate,
      isHidden: dto.isHidden,
      isFavorite: dto.isFavorite,
      color: dto.color,
    });

    return mapPerson(person);
  }

  async update(auth: AuthDto, personGroupId: string, dto: PersonUpdateDto): Promise<PersonResponseDto> {
    await this.requireAccess({ auth, permission: Permission.PersonUpdate, ids: [personGroupId] });

    const { ownerId } = await this.findOrFail(auth, personGroupId);
    const { name, birthDate, isHidden, featureFaceAssetId: assetId, isFavorite, color } = dto;
    // TODO: set by faceId directly
    let faceId: string | undefined;
    if (assetId) {
      await this.requireAccess({ auth, permission: Permission.AssetRead, ids: [assetId] });
      const face = await this.personRepository.getForFeatureFaceUpdate({ personGroupId, assetId });
      if (!face) {
        throw new BadRequestException('Invalid assetId for feature face or asset is offline');
      }

      faceId = face.id;
    }

    const person = await this.personRepository.update({
      ownerId,
      personGroupId,
      faceAssetId: faceId,
      name,
      birthDate,
      isHidden,
      isFavorite,
      color,
    });

    if (assetId) {
      await this.jobRepository.queue({ name: JobName.PersonGenerateThumbnail, data: { ownerId, personGroupId } });
    }

    if (person.identityId && (name !== undefined || birthDate !== undefined)) {
      await this.jobRepository.queue({
        name: JobName.SharedSpacePersonMetadataBackfill,
        data: { identityId: person.identityId },
      });
    }

    return mapPerson(person);
  }

  delete(auth: AuthDto, id: string): Promise<void> {
    return this.deleteAll(auth, { ids: [id] });
  }

  async updateAll(auth: AuthDto, dto: PeopleUpdateDto): Promise<BulkIdResponseDto[]> {
    const results: BulkIdResponseDto[] = [];
    for (const person of dto.people) {
      try {
        await this.update(auth, person.id, {
          isHidden: person.isHidden,
          name: person.name,
          birthDate: person.birthDate,
          featureFaceAssetId: person.featureFaceAssetId,
          isFavorite: person.isFavorite,
        });
        results.push({ id: person.id, success: true });
      } catch (error: Error | any) {
        this.logger.error(`Unable to update ${person.id} : ${error}`, error?.stack);
        results.push({ id: person.id, success: false, error: BulkIdErrorReason.UNKNOWN });
      }
    }
    return results;
  }

  async deleteAll(auth: AuthDto, { ids }: BulkIdsDto): Promise<void> {
    await this.requireAccess({ auth, permission: Permission.PersonDelete, ids });
    await this.removeAllPersonGroups(ids, auth.user.id);
    if (ids.length > 0) {
      await this.queueSpacePersonMetadataBackfill();
    }
  }

  @Chunked()
  private async removeAllPersonGroups(groupIds: string[], ownerId?: string) {
    if (groupIds.length === 0) {
      return;
    }

    // Upstream unlinks inline; the fork queues a FileDelete job so S3-backed thumbnails are removed
    // through the storage abstraction. Keep that on top of upstream's delete-returns-the-rows shape.
    const people = await this.personRepository.delete(groupIds, ownerId);
    const files = people.map((person) => person.thumbnailPath);
    await this.jobRepository.queue({ name: JobName.FileDelete, data: { files } });
    await this.personRepository.deleteEmptyGroups();
    this.logger.debug(`Deleted ${groupIds.length} people`);
  }

  @OnJob({ name: JobName.PersonCleanup, queue: QueueName.BackgroundTask })
  async handlePersonCleanup(): Promise<JobStatus> {
    // each step can leave the next one something to clean up, so the order matters
    const people = await this.personRepository.getAllWithoutFaces();
    await this.removeAllPersonGroups(people.map((person) => person.personGroupId));

    const personGroups = await this.personRepository.deleteEmptyGroups();
    const clusterGroups = await this.personRepository.deleteOrphanedClusterGroups();

    this.logger.debug(`Deleted ${personGroups} empty person groups and ${clusterGroups} orphaned cluster groups`);
    if (people.length > 0) {
      await this.queueSpacePersonMetadataBackfill();
    }
    return JobStatus.Success;
  }

  @OnJob({ name: JobName.FaceIdentityBackfill, queue: QueueName.PeopleBackfill })
  async handleFaceIdentityBackfill({
    stage = 'person',
    cursor,
    continuationId,
    continuationCount,
  }: JobOf<JobName.FaceIdentityBackfill>): Promise<JobStatus> {
    const affectedSpaceAssets: SharedSpaceFaceMatchBackfillTarget[] = [];

    if (stage === 'person') {
      const result = await this.faceIdentityRepository.backfillPersonalIdentities({
        cursor,
        limit: FACE_IDENTITY_BACKFILL_CHUNK_SIZE,
      });
      affectedSpaceAssets.push(...this.getAffectedSpaceAssets(result));

      if (result.nextCursor) {
        await this.jobRepository.queue({
          name: JobName.FaceIdentityBackfill,
          data: { stage: 'person', cursor: result.nextCursor, continuationCount },
        });
        return JobStatus.Success;
      }
    }

    const result = await this.faceIdentityRepository.backfillSpacePersonIdentities({
      cursor: stage === 'space-person' ? cursor : undefined,
      limit: FACE_IDENTITY_BACKFILL_CHUNK_SIZE,
    });
    affectedSpaceAssets.push(...this.getAffectedSpaceAssets(result));

    if (result.conflictCount > 0) {
      this.logger.warn(`Face identity backfill left ${result.conflictCount} space people unresolved`);
    }

    if (result.nextCursor) {
      await this.jobRepository.queue({
        name: JobName.FaceIdentityBackfill,
        data: { stage: 'space-person', cursor: result.nextCursor, continuationCount },
      });
      return JobStatus.Success;
    }

    const work = await this.faceIdentityRepository.getBackfillWork();

    if (work.hasPersonalIdentityWork || work.hasSpacePersonIdentityWork) {
      const passCount = continuationCount ?? 0;
      if (passCount >= FACE_IDENTITY_BACKFILL_MAX_CONTINUATIONS) {
        this.logger.error(
          `Face identity backfill still reports work after ${passCount} continuation passes — stopping to prevent an endless re-queue loop`,
        );
        return JobStatus.Success;
      }
      await this.jobRepository.queue({
        name: JobName.FaceIdentityBackfill,
        data: {
          continuationId: this.getNextFaceIdentityBackfillContinuationId(continuationId),
          continuationCount: passCount + 1,
        },
      });
      return JobStatus.Success;
    }

    const pendingTargets = await this.faceIdentityRepository.getPendingSharedSpaceFaceMatchBackfillTargets();

    if (work.hasSharedSpaceProjectionWork) {
      const projectionTargets = await this.faceIdentityRepository.getSharedSpaceFaceMatchBackfillTargets();
      if (projectionTargets.length === 0) {
        this.logger.warn('Face identity projection backfill work was reported but no targets were found');
      }
      affectedSpaceAssets.push(...projectionTargets);
    }

    const queuedTargets = await this.queueSharedSpaceFaceMatchTargets([...pendingTargets, ...affectedSpaceAssets]);
    await this.faceIdentityRepository.deletePendingSharedSpaceFaceMatchBackfillTargets(pendingTargets);
    if (queuedTargets.length === 0) {
      await this.queueSpacePersonMetadataBackfill();
    }

    return JobStatus.Success;
  }

  private getNextFaceIdentityBackfillContinuationId(currentContinuationId?: string): string {
    return currentContinuationId === 'a' ? 'b' : 'a';
  }

  private getAffectedSpaceAssets(result: object): SharedSpaceFaceMatchBackfillTarget[] {
    return (result as { affectedSpaceAssets?: SharedSpaceFaceMatchBackfillTarget[] }).affectedSpaceAssets ?? [];
  }

  private async queueSharedSpaceFaceMatchTargets(
    targets: SharedSpaceFaceMatchBackfillTarget[],
  ): Promise<SharedSpaceFaceMatchBackfillTarget[]> {
    const uniqueTargets = [
      ...new Map(
        targets
          .toSorted((a, b) => a.spaceId.localeCompare(b.spaceId) || a.assetId.localeCompare(b.assetId))
          .map((target) => [`${target.spaceId}:${target.assetId}`, target]),
      ).values(),
    ];

    if (uniqueTargets.length === 0) {
      return [];
    }

    let jobs: JobItem[] = [];
    for (const { spaceId, assetId } of uniqueTargets) {
      jobs.push({
        name: JobName.SharedSpaceFaceMatchFromBackfill as const,
        data: { spaceId, assetId },
      });

      if (jobs.length >= JOBS_ASSET_PAGINATION_SIZE) {
        await this.jobRepository.queueAll(jobs);
        jobs = [];
      }
    }

    if (jobs.length > 0) {
      await this.jobRepository.queueAll(jobs);
    }

    return uniqueTargets;
  }

  @OnJob({ name: JobName.AssetDetectFacesQueueAll, queue: QueueName.FaceDetection })
  async handleQueueDetectFaces({ force }: JobOf<JobName.AssetDetectFacesQueueAll>): Promise<JobStatus> {
    const { machineLearning } = await this.getConfig({ withCache: false });
    if (!isFacialRecognitionEnabled(machineLearning)) {
      return JobStatus.Skipped;
    }

    if (force) {
      await this.personRepository.deleteFaces({ sourceType: SourceType.MachineLearning });
      await this.handlePersonCleanup();
      await this.sharedSpaceRepository.deleteAllOrphanedPersons();
      await this.personRepository.vacuum({ reindexVectors: true });
    }

    for await (const assets of batched(this.assetJobRepository.streamForDetectFacesJob(force))) {
      await this.jobRepository.queueAll(
        assets.map((asset) => ({
          name: JobName.AssetDetectFaces as const,
          data: { id: asset.id, ...(force === true ? { force: true as const } : {}) },
        })),
      );
    }

    if (force === undefined) {
      await this.jobRepository.queue({ name: JobName.PersonCleanup });
    }

    return JobStatus.Success;
  }

  @OnJob({ name: JobName.AssetDetectFaces, queue: QueueName.FaceDetection })
  async handleDetectFaces({ id, force }: JobOf<JobName.AssetDetectFaces>): Promise<JobStatus> {
    const { machineLearning } = await this.getConfig({ withCache: true });
    if (!isFacialRecognitionEnabled(machineLearning)) {
      return JobStatus.Skipped;
    }

    const asset = await this.assetJobRepository.getForDetectFacesJob(id);
    const previewFile = asset?.previewFile;
    if (!asset || !previewFile) {
      return JobStatus.Failed;
    }

    if (asset.visibility === AssetVisibility.Hidden) {
      return JobStatus.Skipped;
    }

    const { imageHeight, imageWidth, faces } = await this.machineLearningRepository.detectFaces(
      previewFile.path,
      machineLearning.facialRecognition,
    );
    this.logger.debug(`${faces.length} faces detected in ${previewFile.path}`);

    const facesToAdd: (Insertable<AssetFaceTable> & { id: string })[] = [];
    const embeddings: FaceSearchTable[] = [];
    const mlFaceIds = new Set<string>();

    for (const face of asset.faces) {
      if (face.sourceType === SourceType.MachineLearning) {
        mlFaceIds.add(face.id);
      }
    }

    for (const { boundingBox, embedding } of faces) {
      const match = asset.faces.find((face) => {
        const heightScale = face.imageHeight / imageHeight;
        const widthScale = face.imageWidth / imageWidth;
        const scaledBox = {
          x1: boundingBox.x1 * widthScale,
          y1: boundingBox.y1 * heightScale,
          x2: boundingBox.x2 * widthScale,
          y2: boundingBox.y2 * heightScale,
        };

        return this.iou(face, scaledBox) > 0.5;
      });

      if (match && !mlFaceIds.delete(match.id)) {
        embeddings.push({ faceId: match.id, embedding });
      } else if (!match) {
        const faceId = this.cryptoRepository.randomUUID();
        facesToAdd.push({
          id: faceId,
          assetId: asset.id,
          imageHeight,
          imageWidth,
          boundingBoxX1: boundingBox.x1,
          boundingBoxY1: boundingBox.y1,
          boundingBoxX2: boundingBox.x2,
          boundingBoxY2: boundingBox.y2,
        });
        embeddings.push({ faceId, embedding });
      }
    }
    const faceIdsToRemove = [...mlFaceIds];

    if (facesToAdd.length > 0 || faceIdsToRemove.length > 0 || embeddings.length > 0) {
      await this.personRepository.refreshFaces(facesToAdd, faceIdsToRemove, embeddings);
    }

    if (faceIdsToRemove.length > 0) {
      await this.faceIdentityRepository.unlinkFaces(faceIdsToRemove);
      this.logger.log(`Removed ${faceIdsToRemove.length} faces below detection threshold in asset ${id}`);
    }

    if (facesToAdd.length > 0) {
      this.logger.log(`Detected ${facesToAdd.length} new faces in asset ${id}`);
      if (force) {
        await this.jobRepository.queue({ name: JobName.FacialRecognitionQueueAll, data: { force: true } });
      } else {
        const jobs = facesToAdd.map((face) => ({ name: JobName.FacialRecognition, data: { id: face.id } }) as const);
        await this.jobRepository.queueAll([
          { name: JobName.FacialRecognitionQueueAll, data: { force: false } },
          ...jobs,
        ]);
      }
    } else if (embeddings.length > 0) {
      this.logger.log(`Added ${embeddings.length} face embeddings for asset ${id}`);
    }

    await this.assetRepository.upsertJobStatus({ assetId: asset.id, facesRecognizedAt: new Date() });

    return JobStatus.Success;
  }

  private iou(
    face: { boundingBoxX1: number; boundingBoxY1: number; boundingBoxX2: number; boundingBoxY2: number },
    newBox: BoundingBox,
  ): number {
    const x1 = Math.max(face.boundingBoxX1, newBox.x1);
    const y1 = Math.max(face.boundingBoxY1, newBox.y1);
    const x2 = Math.min(face.boundingBoxX2, newBox.x2);
    const y2 = Math.min(face.boundingBoxY2, newBox.y2);

    const intersection = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
    const area1 = (face.boundingBoxX2 - face.boundingBoxX1) * (face.boundingBoxY2 - face.boundingBoxY1);
    const area2 = (newBox.x2 - newBox.x1) * (newBox.y2 - newBox.y1);
    const union = area1 + area2 - intersection;

    return intersection / union;
  }

  @OnJob({ name: JobName.FacialRecognitionQueueAll, queue: QueueName.FacialRecognition })
  async handleQueueRecognizeFaces({
    force,
    nightly,
    clusterGroupId,
  }: JobOf<JobName.FacialRecognitionQueueAll>): Promise<JobStatus> {
    const { machineLearning } = await this.getConfig({ withCache: false });
    if (!isFacialRecognitionEnabled(machineLearning)) {
      return JobStatus.Skipped;
    }

    if (nightly) {
      const [state, latestFaceDate] = await Promise.all([
        this.systemMetadataRepository.get(SystemMetadataKey.FacialRecognitionState),
        this.personRepository.getLatestFaceDate(),
      ]);

      if (state?.lastRun && latestFaceDate && state.lastRun > latestFaceDate) {
        this.logger.debug('Skipping facial recognition nightly since no face has been added since the last run');
        return JobStatus.Skipped;
      }
    }

    await this.jobRepository.waitForQueueCompletion(
      QueueName.ThumbnailGeneration,
      QueueName.FaceDetection,
      ...(force ? [QueueName.PeopleBackfill] : []),
    );

    if (force) {
      await this.jobRepository.empty(QueueName.FacialRecognition, true);
    }

    const { active, delayed, paused, waiting } = await this.jobRepository.getJobCounts(QueueName.FacialRecognition);
    const hasOtherActiveRecognitionWork = active > 1;
    const hasPendingRecognitionWork = waiting > 0 || delayed > 0 || paused > 0 || hasOtherActiveRecognitionWork;

    if (force) {
      await this.personRepository.unassignFaces({ clusterGroupId, sourceType: SourceType.MachineLearning });
      await this.faceIdentityRepository.unlinkFacesBySourceType(SourceType.MachineLearning);
      await this.handlePersonCleanup();
      await this.personRepository.vacuum({ reindexVectors: false });

      // Wipe shared-space person state so the new strict clustering algorithm can
      // rebuild from scratch. Aliases cascade via the FK on personId; named
      // space-persons are lost by design (Force already clears named native persons).
      await this.sharedSpaceRepository.deleteAllPersonFaces();
      await this.sharedSpaceRepository.deleteAllPersons();
      await this.faceIdentityRepository.deleteUnreferencedIdentities();
    } else if (hasPendingRecognitionWork) {
      this.logger.debug(
        `Skipping facial recognition queueing because recognition work is already pending ` +
          `(${active} active, ${waiting} waiting, ${delayed} delayed, ${paused} paused)`,
      );
      return JobStatus.Skipped;
    }

    await this.databaseRepository.prewarm(VectorIndex.Face);

    const lastRun = new Date().toISOString();

    const faces = this.personRepository.getAllFaces(
      force
        ? { clusterGroupId, sourceType: SourceType.MachineLearning }
        : { personGroupId: null, clusterGroupId, sourceType: SourceType.MachineLearning },
    );
    for await (const batch of batched(faces)) {
      await this.jobRepository.queueAll(
        batch.map((face) => ({
          name: JobName.FacialRecognition as const,
          data: {
            id: face.id,
            deferred: false as const,
            ...(force ? { skipSharedSpaceMatch: true as const } : {}),
          },
        })),
      );
    }

    // Queue SharedSpaceFaceMatchAll AFTER recognition jobs so it runs last.
    // This catches EXIF/manual-sourced faces whose personIds survive
    // unassignFaces (non-ML source). Force-created recognition jobs suppress
    // incremental space matching, so the paged rebuild is the authoritative
    // shared-space reconciliation pass.
    if (force) {
      const spaceIds = await this.sharedSpaceRepository.getSpaceIdsWithFaceRecognitionEnabled();
      await this.jobRepository.queueAll(
        spaceIds.map((spaceId) => ({
          name: JobName.SharedSpaceFaceMatchAll as const,
          data: { spaceId },
        })),
      );
    }

    await this.jobRepository.queue({ name: JobName.FaceIdentityMaintenanceAfterRecognition, data: {} });

    await this.systemMetadataRepository.set(SystemMetadataKey.FacialRecognitionState, { lastRun });

    return JobStatus.Success;
  }

  @OnJob({ name: JobName.FaceIdentityMaintenanceAfterRecognition, queue: QueueName.FacialRecognition })
  async handleFaceIdentityMaintenanceAfterRecognition(
    _data: JobOf<JobName.FaceIdentityMaintenanceAfterRecognition>,
  ): Promise<JobStatus> {
    const counts = await this.jobRepository.getJobCounts(QueueName.FacialRecognition);

    if (counts.waiting > 0 || counts.delayed > 0 || counts.paused > 0) {
      await this.jobRepository.queue({
        name: JobName.FaceIdentityMaintenanceAfterRecognition,
        data: { delay: 10_000 },
      });
      return JobStatus.Success;
    }

    // active=1 means only this marker is running — queue has drained
    if (counts.active > 1) {
      await this.jobRepository.queue({
        name: JobName.FaceIdentityMaintenanceAfterRecognition,
        data: { delay: 10_000 },
      });
      return JobStatus.Success;
    }

    const activeBackfills = await this.jobRepository.searchJobs(QueueName.PeopleBackfill, {
      status: [QueueJobStatus.Active, QueueJobStatus.Delayed, QueueJobStatus.Paused, QueueJobStatus.Waiting],
    });
    if (activeBackfills.some((job) => job.name === JobName.FaceIdentityBackfill)) {
      return JobStatus.Skipped;
    }

    await this.jobRepository.queue({ name: JobName.FaceIdentityBackfill, data: {} });
    return JobStatus.Success;
  }

  @OnJob({ name: JobName.FacialRecognition, queue: QueueName.FacialRecognition })
  async handleRecognizeFaces({
    id,
    deferred,
    skipSharedSpaceMatch,
  }: JobOf<JobName.FacialRecognition>): Promise<JobStatus> {
    const { machineLearning } = await this.getConfig({ withCache: true });
    if (!isFacialRecognitionEnabled(machineLearning)) {
      return JobStatus.Skipped;
    }

    const face = await this.personRepository.getFaceForFacialRecognitionJob(id);
    if (!face || !face.asset) {
      this.logger.warn(`Face ${id} not found`);
      return JobStatus.Failed;
    }

    if (face.sourceType !== SourceType.MachineLearning) {
      this.logger.warn(`Skipping face ${id} due to source ${face.sourceType}`);
      return JobStatus.Skipped;
    }

    if (!face.faceSearch?.embedding) {
      this.logger.warn(`Face ${id} does not have an embedding`);
      return JobStatus.Failed;
    }

    if (face.personGroupId) {
      this.logger.debug(`Face ${id} already has a person assigned`);
      await this.replaceFaceIdentity(face.personId, face.id, 'owner-person');

      if (skipSharedSpaceMatch) {
        return JobStatus.Skipped;
      }

      // Still queue space face matching because this face may belong to a space
      // that was created or linked after the face was originally recognized.
      await this.queueSharedSpaceFaceMatchesForAsset(face.assetId);

      return JobStatus.Skipped;
    }

    const { ownerId, clusterGroupId } = face.asset;
    const matches = await this.searchRepository.searchFaces({
      clusterGroupId,
      embedding: face.faceSearch.embedding,
      maxDistance: machineLearning.facialRecognition.maxDistance,
      numResults: machineLearning.facialRecognition.minFaces,
      minBirthDate: new Date(face.asset.fileCreatedAt),
    });

    this.logger.debug(`Face ${id} has ${matches.length} matches`);

    let personGroupId = matches.find((match) => match.personGroupId)?.personGroupId;
    const accessibleIdentityMatch = personGroupId
      ? undefined
      : await this.findClosestAccessibleSharedIdentity({
          userId: face.asset.ownerId,
          embedding: face.faceSearch.embedding,
          maxDistance: machineLearning.facialRecognition.maxDistance,
        });

    // `matches` also includes the face itself
    const matchedOnlySelf =
      machineLearning.facialRecognition.minFaces > 1 && matches.length <= 1 && !accessibleIdentityMatch;
    if (matchedOnlySelf && !skipSharedSpaceMatch) {
      this.logger.debug(`Face ${id} only matched the face itself, skipping`);
      return JobStatus.Skipped;
    }

    const isCore =
      (matches.length >= machineLearning.facialRecognition.minFaces || !!accessibleIdentityMatch) &&
      face.asset.visibility === AssetVisibility.Timeline;
    if (!isCore && !deferred) {
      this.logger.debug(`Deferring non-core face ${id} for later processing`);
      await this.jobRepository.queue({
        name: JobName.FacialRecognition,
        data: {
          id,
          deferred: true,
          ...(skipSharedSpaceMatch ? { skipSharedSpaceMatch: true } : {}),
        },
      });
      return JobStatus.Skipped;
    }

    if (matchedOnlySelf) {
      this.logger.debug(`Face ${id} only matched the face itself, skipping`);
      return JobStatus.Skipped;
    }

    if (!personGroupId) {
      const [matchWithPerson] = await this.searchRepository.searchFaces({
        clusterGroupId,
        embedding: face.faceSearch.embedding,
        maxDistance: machineLearning.facialRecognition.maxDistance,
        numResults: 1,
        hasPerson: true,
        minBirthDate: new Date(face.asset.fileCreatedAt),
      });

      personGroupId = matchWithPerson?.personGroupId ?? undefined;
    }

    if (!personGroupId && isCore) {
      const group = await this.personRepository.createGroup(ownerId);
      personGroupId = group.id;
      this.logger.log(`Created person group ${personGroupId} for face ${id}`);
    }

    if (personGroupId) {
      const person = await this.personRepository.getByGroupId({ ownerId, personGroupId });
      let personCreated = false;
      if (person) {
        this.logger.debug(`Face ${id} matched person ${person.personGroupId}`);
      } else {
        personCreated = true;
        await this.personRepository.create({ ownerId, faceAssetId: face.id, personGroupId });
        this.logger.log(`Created person for face ${id} in group ${personGroupId}`);
        await this.jobRepository.queue({
          name: JobName.PersonGenerateThumbnail,
          data: { ownerId, personGroupId },
        });
      }

      this.logger.debug(`Assigning face ${id} to person group ${personGroupId}`);
      await this.personRepository.reassignFaces({ faceIds: [id], newPersonGroupId: personGroupId });
      const sourceIdentityId = await this.replaceFaceIdentity(personGroupId, id, 'owner-person');
      await this.mergeWithAccessibleSharedIdentity({
        userId: face.asset.ownerId,
        embedding: face.faceSearch.embedding,
        maxDistance: machineLearning.facialRecognition.maxDistance,
        sourceIdentityId,
        match: personCreated ? accessibleIdentityMatch : undefined,
      });
    }

    if (!personId) {
      this.logger.debug(`Face ${id} did not resolve to a person, skipping shared-space face matching`);
      return JobStatus.Skipped;
    }

    if (skipSharedSpaceMatch) {
      return JobStatus.Success;
    }

    await this.queueSharedSpaceFaceMatchesForAsset(face.assetId);

    return JobStatus.Success;
  }

  private async queueSharedSpaceFaceMatchesForAsset(assetId: string): Promise<void> {
    const spaceIds = await this.sharedSpaceRepository.getSpaceIdsForAsset(assetId);
    const queuedSpaceIds = new Set<string>();
    for (const { spaceId } of spaceIds) {
      if (queuedSpaceIds.has(spaceId)) {
        continue;
      }
      queuedSpaceIds.add(spaceId);
      await this.jobRepository.queue({
        name: JobName.SharedSpaceFaceMatch,
        data: { spaceId, assetId },
      });
    }
  }

  private async replaceFaceIdentity(
    personId: string,
    assetFaceId: string,
    source: 'owner-person' | 'manual',
  ): Promise<string> {
    const identity = await this.faceIdentityRepository.ensurePersonIdentity(personId);
    await this.faceIdentityRepository.replaceFaceIdentity({ assetFaceId, identityId: identity.id, source });
    return identity.id;
  }

  private async mergeWithAccessibleSharedIdentity(input: {
    userId: string;
    embedding: string;
    maxDistance: number;
    sourceIdentityId: string;
    match?: AccessibleIdentityFaceMatch;
  }): Promise<void> {
    const match =
      input.match ??
      (await this.findClosestAccessibleSharedIdentity({
        userId: input.userId,
        embedding: input.embedding,
        maxDistance: input.maxDistance,
        excludeIdentityId: input.sourceIdentityId,
      }));
    if (!match || match.identityId === input.sourceIdentityId) {
      return;
    }

    const target = chooseAutomaticTargetIdentity({
      bridge: 'personal-upload',
      localIdentityId: input.sourceIdentityId,
      spaceIdentityId: match.identityId,
    });
    const claim = buildAutomaticReconciliationClaim({
      bridge: 'personal-upload',
      localIdentityId: input.sourceIdentityId,
      spaceIdentityId: match.identityId,
      sourceIdentityId: target.sourceIdentityId,
      targetIdentityId: target.targetIdentityId,
      distance: match.distance,
      hasAccessBridge: true,
      compatibleType: true,
      hasEmbedding: true,
      hiddenOrIgnored: false,
      alreadySameIdentity: match.identityId === input.sourceIdentityId,
      sameOwnerConflict: false,
      sameSpaceConflict: false,
    });
    if (!claim) {
      return;
    }

    const conflicts = await this.faceIdentityRepository.getMergeConflicts({
      targetIdentityId: claim.targetIdentityId,
      sourceIdentityIds: [claim.sourceIdentityId],
    });
    if (conflicts.personalProfileConflictCount > 0 || conflicts.spaceProfileConflictCount > 0) {
      this.logger.warn(
        `Skipping accessible identity merge due to conflicts: ${conflicts.personalProfileConflictCount} personal, ${conflicts.spaceProfileConflictCount} space`,
      );
      return;
    }

    await this.faceIdentityRepository.mergeIdentities({
      targetIdentityId: claim.targetIdentityId,
      sourceIdentityIds: [claim.sourceIdentityId],
      source: 'shared-space-evidence',
    });

    await this.queueSpacePersonMetadataBackfill(claim.targetIdentityId);
  }

  private findClosestAccessibleSharedIdentity(input: {
    userId: string;
    embedding: string;
    maxDistance: number;
    excludeIdentityId?: string | null;
  }): Promise<AccessibleIdentityFaceMatch | undefined> {
    return this.faceIdentityRepository.findClosestAccessibleIdentityForFace({
      userId: input.userId,
      embedding: input.embedding,
      maxDistance: input.maxDistance,
      type: 'person',
      excludeIdentityId: input.excludeIdentityId ?? null,
    });
  }

  @OnJob({ name: JobName.PersonFileMigration, queue: QueueName.Migration })
  async handlePersonMigration({ ownerId, personGroupId }: JobOf<JobName.PersonFileMigration>): Promise<JobStatus> {
    const person = await this.personRepository.getByGroupId({ ownerId, personGroupId });
    if (!person) {
      return JobStatus.Failed;
    }

    if (!person.thumbnailPath || !isAbsolute(person.thumbnailPath)) {
      // S3 thumbnails live under relative keys and are managed by the S3 backend, not fs.rename.
      this.logger.debug(`Skipping person file migration for S3 person ${id}`);
      return JobStatus.Skipped;
    }

    await this.storageCore.movePersonFile(person, PersonPathType.Face);

    return JobStatus.Success;
  }

  async mergePerson(auth: AuthDto, personGroupId: string, dto: MergePersonDto): Promise<BulkIdResponseDto[]> {
    const mergeIds = dto.ids;
    if (mergeIds.length === 0) {
      throw new BadRequestException('No people selected for merge');
    }

    if (mergeIds.includes(id)) {
      throw new BadRequestException('Cannot merge a person into themselves');
    }

    await this.requireAccess({ auth, permission: Permission.PersonUpdate, ids: [id] });
    await this.findOrFail(id);

    const allowedIds = await this.checkAccess({
      auth,
      permission: Permission.PersonMerge,
      ids: mergeIds,
    });
    const failures: BulkIdResponseDto[] = [];

    let primaryPerson: Selectable<PersonTable> | undefined;

    for (const mergePerson of await this.personRepository.getForMergePerson(mergeIds)) {
      const mergeId = mergePerson.personGroupId;
      const hasAccess = allowedIds.has(mergeId);
      if (!hasAccess) {
        failures.push({ id: mergeId, success: false, error: BulkIdErrorReason.NO_PERMISSION });
        continue;
      }

      const mergePerson = await this.personRepository.getById(mergeId);
      if (!mergePerson) {
        failures.push({ id: mergeId, success: false, error: BulkIdErrorReason.NOT_FOUND });
      }
    }

    if (failures.length > 0) {
      // Propagation is all-or-nothing after validation, so do not delegate a partial source set.
      return failures;
    }

    return this.identityMergePropagationService.mergePersonalPeople(auth, id, mergeIds);
  }

  private async queueSpacePersonMetadataBackfill(identityId?: string | null): Promise<void> {
    await this.jobRepository.queue({
      name: JobName.SharedSpacePersonMetadataBackfill,
      data: identityId ? { identityId } : {},
    });
  }

  private findOrFail(auth: AuthDto, personGroupId: string) {
    return findOrFail(() => this.personRepository.getByGroupId({ ownerId: auth.user.id, personGroupId }), 'Person');
  }

  // TODO return a asset face response
  async createFace(auth: AuthDto, dto: AssetFaceCreateDto): Promise<void> {
    await Promise.all([
      this.requireAccess({ auth, permission: Permission.AssetUpdate, ids: [dto.assetId] }),
      this.requireAccess({ auth, permission: Permission.PersonRead, ids: [dto.personId] }),
    ]);

    const [asset, person] = await Promise.all([
      this.assetRepository.getById(dto.assetId, { edits: true, exifInfo: true }),
      this.findOrFail(auth, dto.personId),
    ]);

    if (!asset) {
      throw new NotFoundException('Asset not found');
    }

    const edits = asset.edits || [];

    let topLeft: Point = { x: dto.x, y: dto.y };
    let bottomRight: Point = { x: dto.x + dto.width, y: dto.y + dto.height };

    // the coordinates received from the client are based on the edited preview image
    // we need to convert them to the coordinate space of the original unedited image
    if (edits.length > 0) {
      if (!asset.width || !asset.height || !asset.exifInfo?.exifImageWidth || !asset.exifInfo?.exifImageHeight) {
        throw new BadRequestException('Asset does not have valid dimensions');
      }

      // convert from preview to full dimensions
      const scaleFactor = asset.width / dto.imageWidth;
      topLeft = { x: topLeft.x * scaleFactor, y: topLeft.y * scaleFactor };
      bottomRight = { x: bottomRight.x * scaleFactor, y: bottomRight.y * scaleFactor };

      const [invertedTopLeft, invertedBottomRight] = transformPoints(
        [topLeft, bottomRight],
        edits,
        { width: asset.width, height: asset.height },
        { inverse: true },
      ).points;

      // make sure topLeft is top-left and bottomRight is bottom-right
      topLeft = {
        x: Math.min(invertedTopLeft.x, invertedBottomRight.x),
        y: Math.min(invertedTopLeft.y, invertedBottomRight.y),
      };
      bottomRight = {
        x: Math.max(invertedTopLeft.x, invertedBottomRight.x),
        y: Math.max(invertedTopLeft.y, invertedBottomRight.y),
      };

      // now coordinates are in original image space
      const originalDimensions = getDimensions(asset.exifInfo);
      dto.imageWidth = originalDimensions.width;
      dto.imageHeight = originalDimensions.height;
    }

    const faceId = await this.personRepository.createAssetFace({
      personGroupId: person.personGroupId,
      assetId: dto.assetId,
      imageHeight: dto.imageHeight,
      imageWidth: dto.imageWidth,
      boundingBoxX1: Math.round(topLeft.x),
      boundingBoxX2: Math.round(bottomRight.x),
      boundingBoxY1: Math.round(topLeft.y),
      boundingBoxY2: Math.round(bottomRight.y),
      sourceType: SourceType.Manual,
    });
    await this.replaceFaceIdentity(dto.personId, faceId, 'manual');

    if (!person.faceAssetId) {
      await this.createNewFeaturePhoto([person]);
    }
  }

  async deleteFace(auth: AuthDto, id: string, dto: AssetFaceDeleteDto): Promise<void> {
    await this.requireAccess({ auth, permission: Permission.FaceDelete, ids: [id] });

    await (dto.force ? this.personRepository.deleteAssetFace(id) : this.personRepository.softDeleteAssetFaces(id));
    await this.faceIdentityRepository.unlinkFaces([id]);
  }
}
