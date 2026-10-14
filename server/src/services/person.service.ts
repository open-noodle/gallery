import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Insertable } from 'kysely';
import { isAbsolute } from 'node:path';
import type { AccessibleIdentityFaceMatch } from 'src/repositories/face-identity.repository.js';
import type { MergeAuthorizer } from 'src/services/identity-merge-propagation.service.js';
import type { JobItem, JobOf } from 'src/types.js';
import { Chunked, OnJob } from 'src/decorators.js';
import { BulkIdErrorReason, BulkIdResponseDto } from 'src/dtos/asset-ids.response.dto.js';
import { AuthDto } from 'src/dtos/auth.dto.js';
import {
  AssetFaceCreateDto,
  AssetFaceDeleteDto,
  AssetFaceResponseDto,
  AssetFaceUpdateDto,
  FaceDto,
  MergePersonDto,
  PeopleDeleteDto,
  PeopleResponseDto,
  PeopleUpdateDto,
  PeopleUsersUpsertDto,
  PersonCreateDto,
  PersonDeleteDto,
  PersonResponseDto,
  PersonSearchDto,
  PersonStatisticsResponseDto,
  PersonUpdateDto,
  PersonUsersDeleteDto,
  PersonUsersResponseDto,
  PersonUsersSearchDto,
  mapFaces,
  mapPerson,
} from 'src/dtos/person.dto.js';
import {
  AssetVisibility,
  CacheControl,
  JobName,
  JobStatus,
  Permission,
  PersonPathType,
  QueueName,
  SourceType,
  SystemMetadataKey,
  VectorIndex,
} from 'src/enum.js';
import { crossOwnerMergeAuthorizer, resolveMinimumFaceCount } from 'src/gallery/people-config.js';
import { BoundingBox } from 'src/repositories/machine-learning.repository.js';
import { PersonId } from 'src/repositories/person.repository.js';
import { DB } from 'src/schema/index.js';
import { AssetFaceTable } from 'src/schema/tables/asset-face.table.js';
import { FaceSearchTable } from 'src/schema/tables/face-search.table.js';
import {
  buildAutomaticReconciliationClaim,
  chooseAutomaticTargetIdentity,
} from 'src/services/accessible-identity-reconciliation.js';
import { BaseService } from 'src/services/base.service.js';
import { convertFaceBoxToOriginalImageSpace, getDimensions } from 'src/utils/asset.util.js';
import { isSuggestionScanTarget } from 'src/utils/face-repair.js';
import { ImmichMediaResponse } from 'src/utils/file.js';
import { isHttpException } from 'src/utils/logger.js';
import { mimeTypes } from 'src/utils/mime-types.js';
import { batched, findOrFail, isFaceSuggestionEnabled, isFacialRecognitionEnabled } from 'src/utils/misc.js';
import { applyResolvedIdentityMetadata } from 'src/utils/person-identity.js';

const personKey = ({ ownerId, personGroupId }: PersonId) => `${ownerId}/${personGroupId}`;

/**
 * S9 (F19): upper bound on how long a forced `handleQueueRecognizeFaces` run waits for the
 * concurrency-1 PeopleBackfill queue before giving up and proceeding anyway. PeopleBackfill also
 * carries the person/space-person suggestion-scan sweep (F17/F18), which can legitimately take a
 * while on a large library — generous enough not to abandon a real drain in progress, bounded so a
 * forced recognition run is never wedged indefinitely behind it.
 */
const PEOPLE_BACKFILL_WAIT_TIMEOUT_MS = 10 * 60 * 1000;

/**
 * Gallery: upstream's person sharing (immich-31620) is pulled but dormant. Its model needs several `person` rows per
 * person group, which Option M's `person_personGroupId_key` forbids, and it shares only inside a cluster group, which
 * Gallery keeps inert. See specs/2026-10-01-upstream-person-sharing-dormant-design.md.
 */
export const personSharingUnsupported = () => new BadRequestException('Person sharing is not available in Gallery');

/**
 * Upstream lets `userId` address another owner's row of the same person through a `person_user` grant. Gallery's
 * person access is owner-only, so an override naming anyone else would bypass it: refuse it.
 */
const assertOwnRecord = (auth: AuthDto, userId: string | undefined) => {
  if (userId !== undefined && userId !== auth.user.id) {
    throw personSharingUnsupported();
  }
};

@Injectable()
export class PersonService extends BaseService {
  private async crossOwnerMergeAuthorizer(dto: { confirmCrossOwner?: boolean }): Promise<MergeAuthorizer> {
    return crossOwnerMergeAuthorizer(await this.getConfig({ withCache: false }), dto);
  }

  private async resolveMinimumFaceCount(auth: AuthDto): Promise<number> {
    return resolveMinimumFaceCount(
      await this.getConfig({ withCache: false }),
      await this.userRepository.getMetadata(auth.user.id),
    );
  }

  async getAll(auth: AuthDto, dto: PersonSearchDto): Promise<PeopleResponseDto> {
    const { withHidden = false, withSharedSpaces = false, closestAssetId, closestPersonId, page, size, type } = dto;
    const minimumFaceCount = await this.resolveMinimumFaceCount(auth);

    if (withSharedSpaces) {
      return this.faceIdentityRepository.getAccessiblePeople(auth.user.id, {
        withHidden,
        page,
        size,
        minimumFaceCount,
        type,
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
      type,
    });
    const { total, hidden } = await this.personRepository.getNumberOfPeople(auth.user.id, {
      minimumFaceCount,
      type,
    });

    return {
      people: items.map((person) => mapPerson(person)),
      hasNextPage,
      total,
      hidden,
    };
  }

  async reassignFaces(auth: AuthDto, personGroupId: string, dto: AssetFaceUpdateDto): Promise<PersonResponseDto[]> {
    for (const item of dto.data) {
      assertOwnRecord(auth, item.userId);
    }
    await this.requireAccess({ auth, permission: Permission.PersonUpdate, ids: [personGroupId] });
    const person = await this.findOrFail(auth, personGroupId);
    const result: PersonResponseDto[] = [];
    const changeFeaturePhoto = new Map<string, PersonId>();
    const faceIds: string[] = [];
    for (const data of dto.data) {
      const faces = await this.personRepository.getFacesByIds(
        [{ personGroupId: data.personId, assetId: data.assetId }],
        { viewingUserId: auth.user.id },
      );

      for (const face of faces) {
        const ids = await this.checkAccess({ auth, permission: Permission.PersonCreate, ids: [face.id] });

        if (ids.size !== 1) {
          continue;
        }

        if (person.faceAssetId === null) {
          changeFeaturePhoto.set(personKey(person), person);
        }
        if (face.person && face.person.faceAssetId === face.id) {
          changeFeaturePhoto.set(personKey(face.person), face.person);
        }

        faceIds.push(face.id);
      }

      result.push(mapPerson(person));
    }
    await this.faceAssignmentService.assignFaces({ personGroupId: person.personGroupId, faceIds, strength: 'manual' });
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

    await this.faceAssignmentService.assignFaces({
      personGroupId: person.personGroupId,
      faceIds: [face.id],
      strength: 'manual',
    });
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

    // A person the owner marked hidden must never reach another viewer (#796). Filtering on the
    // client would be cosmetic — the identity would still be on the wire — so drop the face here.
    // The owner keeps seeing their hidden people; the web decides whether to display them.
    const response = faces
      .filter((face) => !face.person?.isHidden || face.person?.ownerId === auth.user.id)
      .map((face) => mapFaces(face, asset.edits, assetDimensions));

    // #808: a name or birthday set inside a shared space lives on `shared_space_person` and is
    // resolved at read time — it is never written back to `person`. The asset viewer Info panel
    // reads this endpoint for the owner, so it has to apply the same identity-wide resolution
    // PersonService.getById does; otherwise the age silently disappears for every person whose
    // birthday only ever existed on a space profile. `mapFaces` already nulls people the caller
    // does not own, so only owned faces are resolved here.
    const identityByPersonId = new Map<string, string>();
    for (const face of faces) {
      if (face.person?.ownerId === auth.user.id && face.person.identityId) {
        identityByPersonId.set(face.person.personGroupId, face.person.identityId);
      }
    }
    await applyResolvedIdentityMetadata({
      people: response.map((face) => face.person).filter((person) => person !== null),
      identityByPersonId,
      resolve: (identityId) => this.faceIdentityRepository.getResolvedPersonByIdentityId(auth.user.id, identityId),
    });

    return response;
  }

  async createNewFeaturePhoto(changeFeaturePhoto: PersonId[]) {
    this.logger.debug(
      `Changing feature photos for ${changeFeaturePhoto.length} ${changeFeaturePhoto.length > 1 ? 'people' : 'person'}`,
    );

    const jobs: JobItem[] = [];
    for (const { ownerId, personGroupId } of changeFeaturePhoto) {
      const assetFace = await this.personRepository.getRandomFace(personGroupId);

      if (!assetFace) {
        continue;
      }

      await this.personRepository.update({ ownerId, personGroupId, faceAssetId: assetFace.id });
      jobs.push({ name: JobName.PersonGenerateThumbnail, data: { ownerId, personGroupId } });
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

  async getStatistics(auth: AuthDto, id: string): Promise<PersonStatisticsResponseDto> {
    const allowedIds = await this.checkAccess({ auth, permission: Permission.PersonRead, ids: [id] });
    if (allowedIds.has(id)) {
      const person = await this.findOrFail(auth, id);
      if (person.identityId) {
        return this.faceIdentityRepository.getAccessiblePersonStatistics(auth.user.id, person.identityId);
      }

      // L3: a legacy (null-identityId) person's statistics are otherwise unscoped — fine for the
      // owner (their own library), but a space-only reader (PersonRead granted only via
      // checkSharedSpaceAccess, never checkOwnerAccess) must only see the count reachable through
      // the space(s) they're a member of, not the owner's whole library.
      if (auth.user.id !== person.ownerId) {
        return this.personRepository.getStatistics(id, auth.user.id, { memberUserId: auth.user.id });
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
    const ownerAccess = await this.accessRepository.person.checkOwnerAccess(auth.user.id, ids);
    const isOwner = ownerAccess.has(id);
    if (!isOwner) {
      const isShared = await this.accessRepository.person.checkSharedSpaceAccess(auth.user.id, ids);
      if (!isShared.has(id)) {
        throw new BadRequestException('Not found or no person.read access');
      }
    }

    // Fork (#869 follow-up): both arms above grant person.read off ANY reachable face, while the thumbnail
    // is a crop of the representative face's photo specifically. The owner needs an elevated session to be
    // handed back a crop of their own Locked Folder photo; a shared-space viewer must never receive one at
    // all — the folder belongs to the owner, so the viewer's own elevation says nothing about it.
    if (isOwner && auth.session?.hasElevatedPermission) {
      return;
    }

    const isUnlocked = await this.accessRepository.person.checkUnlockedThumbnailAccess(ids);
    if (!isUnlocked.has(id)) {
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
    assertOwnRecord(auth, dto.userId);
    await this.requireAccess({ auth, permission: Permission.PersonUpdate, ids: [personGroupId] });
    const prior = await this.personRepository.getByGroupIdOnly(personGroupId);

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

    const { machineLearning } = await this.getConfig({ withCache: true });
    const featureEnabled = isFaceSuggestionEnabled(machineLearning);
    const nowScannable = isSuggestionScanTarget(person);
    if (featureEnabled && nowScannable && prior && prior.name !== person.name) {
      await this.jobRepository.queue({ name: JobName.PersonSuggestionScan, data: { id: personGroupId } });
    }

    return mapPerson(person);
  }

  delete(auth: AuthDto, id: string, dto: PersonDeleteDto = {}): Promise<void> {
    return this.deleteAll(auth, { ids: [id], ...dto });
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
          userId: person.userId,
        });
        results.push({ id: person.id, success: true });
      } catch (error: Error | any) {
        if (!isHttpException(error)) {
          this.logger.error(`Unable to update ${person.id} : ${error}`, error?.stack);
        }
        results.push({ id: person.id, success: false, error: BulkIdErrorReason.UNKNOWN });
      }
    }
    return results;
  }

  async deleteAll(auth: AuthDto, { ids, userId }: PeopleDeleteDto): Promise<void> {
    assertOwnRecord(auth, userId);
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

  @OnJob({ name: JobName.AssetDetectFacesQueueAll, queue: QueueName.FaceDetection })
  async handleQueueDetectFaces({ force }: JobOf<JobName.AssetDetectFacesQueueAll>): Promise<JobStatus> {
    const { machineLearning } = await this.getConfig({ withCache: false });
    if (!isFacialRecognitionEnabled(machineLearning)) {
      return JobStatus.Skipped;
    }

    if (force) {
      // excludePetFaces: pet faces carry the same machine-learning sourceType, so an unfiltered
      // delete here hard-deletes every pet face and its embedding (F3).
      await this.personRepository.deleteFaces({ sourceType: SourceType.MachineLearning, excludePetFaces: true });
      await this.handlePersonCleanup();
      await this.sharedSpaceRepository.deleteAllOrphanedPersons();
      await this.vacuum('asset_face', 'person', 'face_search');
    }

    for await (const assets of batched(this.assetJobRepository.streamForDetectFacesJob(force))) {
      await this.jobRepository.queueAll(
        assets.map((asset) => ({
          name: JobName.AssetDetectFaces as const,
          data: { id: asset.id, ...(force === true && { force: true as const }) },
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
      // Pet faces carry the same machine-learning sourceType as human faces, so without the isPet
      // guard they land in faceIdsToRemove and get hard-deleted on every re-detection (F4).
      if (face.sourceType === SourceType.MachineLearning && !face.isPet) {
        mlFaceIds.add(face.id);
      }
    }

    for (const { boundingBox, embedding } of faces) {
      const match = asset.faces.find((face) => {
        // A detected human box must never resolve to a pet face: the match either consumes it or,
        // once consumed, receives a human face_search embedding written over the pet (F4).
        if (face.isPet) {
          return false;
        }

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

    await this.jobRepository.waitForQueueCompletion(QueueName.ThumbnailGeneration, QueueName.FaceDetection);

    if (force) {
      // S9 (F19): a separate, bounded wait — PersonSuggestionScanQueueAll/SpacePersonSuggestionScanQueueAll
      // (F17/F18) can keep the concurrency-1 PeopleBackfill queue busy indefinitely, and this forced
      // recognition run must proceed rather than park forever behind that sweep. Bounding only this call
      // leaves the ThumbnailGeneration/FaceDetection wait above (and every other call site) unbounded.
      await this.jobRepository.waitForQueueCompletion(QueueName.PeopleBackfill, {
        timeoutMs: PEOPLE_BACKFILL_WAIT_TIMEOUT_MS,
      });
    }

    if (force) {
      await this.jobRepository.empty(QueueName.FacialRecognition, true);
    }

    const { active, delayed, paused, waiting } = await this.jobRepository.getJobCounts(QueueName.FacialRecognition);
    const hasOtherActiveRecognitionWork = active > 1;
    const hasPendingRecognitionWork = waiting > 0 || delayed > 0 || paused > 0 || hasOtherActiveRecognitionWork;

    if (force) {
      // excludePetFaces / excludePets throughout: pet faces share the machine-learning sourceType
      // and space pet copies are untyped-wipe collateral, so an unfiltered human reset unassigns
      // pet faces, unlinks their identities and deletes every space pet copy (F1).
      await this.personRepository.unassignFaces({
        clusterGroupId,
        sourceType: SourceType.MachineLearning,
        excludePetFaces: true,
      });
      await this.faceIdentityRepository.unlinkFacesBySourceType(SourceType.MachineLearning, {
        excludePetFaces: true,
      });
      await this.handlePersonCleanup();
      await this.vacuum('asset_face', 'person');

      // Wipe shared-space person state so the new strict clustering algorithm can
      // rebuild from scratch. Aliases cascade via the FK on personId; named
      // space-persons are lost by design (Force already clears named native persons).
      await this.sharedSpaceRepository.deleteAllPersonFaces({ excludePets: true });
      await this.sharedSpaceRepository.deleteAllPersons({ excludePets: true });
      await this.faceIdentityRepository.deleteUnreferencedIdentities();
      // Slice 8 (F16): the reaper for face_person_verdict rows deleteUnreferencedIdentities is what nulls a
      // row's LAST remaining key (personId/spacePersonId are already NULL by this point, via the person and
      // space-person wipes above) — a row is only fully orphaned once this line has run, so the reaper must
      // run strictly after it, not from inside handlePersonCleanup a few lines up (which runs BEFORE the
      // space-person wipe and before this identity GC — see the ordering test in
      // face-review-cross-flow.spec.ts for the discriminating case).
      await this.facePersonVerdictRepository.deleteOrphanedVerdicts();
    } else if (hasPendingRecognitionWork) {
      this.logger.debug(
        `Skipping facial recognition queueing because recognition work is already pending ` +
          `(${active} active, ${waiting} waiting, ${delayed} delayed, ${paused} paused)`,
      );
      return JobStatus.Skipped;
    }

    await this.databaseRepository.prewarm(VectorIndex.Face);

    const lastRun = new Date().toISOString();

    // Slice 5 (F9): excludeManuallyPlaced only applies on the non-forced branch. The forced branch already
    // wiped every face_identity_face row via unassignFaces above, so there is nothing left to preserve —
    // passing it there would be meaningless.
    // excludePetFaces on both arms: pet faces would otherwise be fanned out as human
    // FacialRecognition jobs, which fail (no face_search embedding) on every run (F2).
    const faces = this.personRepository.getAllFaces(
      force
        ? { clusterGroupId, sourceType: SourceType.MachineLearning, excludePetFaces: true }
        : {
            personGroupId: null,
            clusterGroupId,
            sourceType: SourceType.MachineLearning,
            excludeManuallyPlaced: true,
            excludePetFaces: true,
          },
    );
    for await (const batch of batched(faces)) {
      await this.jobRepository.queueAll(
        batch.map((face) => ({
          name: JobName.FacialRecognition as const,
          data: {
            id: face.id,
            deferred: false as const,
            ...(force && { skipSharedSpaceMatch: true as const }),
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
      await this.replaceFaceIdentity(face.personGroupId, face.id, 'owner-person');

      if (skipSharedSpaceMatch) {
        return JobStatus.Skipped;
      }

      // Still queue space face matching because this face may belong to a space
      // that was created or linked after the face was originally recognized.
      await this.queueSharedSpaceFaceMatchesForAsset(face.assetId);

      return JobStatus.Skipped;
    }

    const { ownerId } = face.asset;
    const matches = await this.faceSearchRepository.searchFaces({
      userIds: [ownerId],
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
          ...(skipSharedSpaceMatch && { skipSharedSpaceMatch: true }),
        },
      });
      return JobStatus.Skipped;
    }

    if (matchedOnlySelf) {
      this.logger.debug(`Face ${id} only matched the face itself, skipping`);
      return JobStatus.Skipped;
    }

    if (!personGroupId) {
      const [matchWithPerson] = await this.faceSearchRepository.searchFaces({
        userIds: [ownerId],
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

    if (!personGroupId) {
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
      this.logger.debug(`Skipping person file migration for S3 person ${personGroupId}`);
      return JobStatus.Skipped;
    }

    await this.storageCore.movePersonFile(person, PersonPathType.Face);

    return JobStatus.Success;
  }

  /**
   * Multi-person bulk merge (upstream's cluster-group `mergePeople`, adopted inert). Upstream's own
   * "merge an ordered list of people into a single person" contract already reduces to a single
   * target: `ids[0]` is that person, everything after it merges into it — exactly what
   * {@link mergePerson} does, cross-owner authorizer included. An earlier per-owner grouping here
   * (splitting `ids` into same-owner clusters) silently no-opped a target/source pair that
   * belonged to different owners instead of merging them, which broke the fork's real cross-owner
   * flow (#733: a personal merge that reaches into another owner's identity). Delegating directly
   * avoids that trap and matches `origin/main`'s `mergePerson` behavior.
   */
  async mergePeople(auth: AuthDto, { ids, confirmCrossOwner }: MergePersonDto): Promise<BulkIdResponseDto[]> {
    if (ids.length < 2) {
      throw new BadRequestException('At least two people are required for merging');
    }

    if (new Set(ids).size !== ids.length) {
      throw new BadRequestException('Cannot merge a person into themselves');
    }

    const [id, ...sourceIds] = ids;
    return this.mergePerson(auth, id, { ids: sourceIds, confirmCrossOwner });
  }

  async mergePerson(auth: AuthDto, id: string, dto: MergePersonDto): Promise<BulkIdResponseDto[]> {
    if (dto.ids.length === 0) {
      throw new BadRequestException('No people selected for merge');
    }

    if (dto.ids.includes(id)) {
      throw new BadRequestException('Cannot merge a person into themselves');
    }

    await this.requireAccess({ auth, permission: Permission.PersonUpdate, ids: [id] });
    const person = await this.personRepository.getByGroupIdOnly(id);
    if (!person) {
      throw new BadRequestException('Person not found');
    }

    const allowedIds = await this.checkAccess({ auth, permission: Permission.PersonMerge, ids: dto.ids });
    const failures: BulkIdResponseDto[] = [];
    for (const mergeId of dto.ids) {
      if (!allowedIds.has(mergeId)) {
        failures.push({ id: mergeId, success: false, error: BulkIdErrorReason.NO_PERMISSION });
        continue;
      }

      const mergePerson = await this.personRepository.getByGroupIdOnly(mergeId);
      if (!mergePerson) {
        failures.push({ id: mergeId, success: false, error: BulkIdErrorReason.NOT_FOUND });
      }
    }

    if (failures.length > 0) {
      // Propagation is all-or-nothing after validation, so do not delegate a partial source set.
      return failures;
    }

    // Same cross-owner policy as every other merge path (#733): a merge of your own two people can still
    // reach into someone else's library through a shared identity, and if it would combine two of THEIR
    // people it needs the instance toggle and an explicit acknowledgement. Re-pointing is free.
    return this.identityMergePropagationService.mergePersonalPeople(
      auth,
      id,
      dto.ids,
      await this.crossOwnerMergeAuthorizer(dto),
    );
  }

  private async queueSpacePersonMetadataBackfill(identityId?: string | null): Promise<void> {
    await this.jobRepository.queue({
      name: JobName.SharedSpacePersonMetadataBackfill,
      data: identityId ? { identityId } : {},
    });
  }

  // Upstream looks the person up owner-scoped (`getByGroupId({ ownerId, personGroupId })`) because it has
  // no concept of a person reachable by anyone but its owner. In the fork, `requireAccess` above each call
  // site is the authorization gate, and several of those permissions (PersonRead in particular) admit
  // non-owner space-granted callers — so owner-scoping the subsequent LOAD would 400 every shared-space
  // reader on routes that are supposed to serve them. This is a plain row load, owner-agnostic exactly as
  // the fork's pre-#30739 `getById(id)` was; `getByGroupIdOnly` is equivalent to it under M's 1:1 invariant.
  private findOrFail(_auth: AuthDto, personGroupId: string) {
    return findOrFail(() => this.personRepository.getByGroupIdOnly(personGroupId), 'Person');
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

    // the coordinates received from the client are based on the edited preview image; convert
    // them to the coordinate space of the original unedited image. Shared with the space
    // face-assign endpoint (SharedSpaceService.createSpaceAssetFace) so the two can never drift.
    const { topLeft, bottomRight, imageWidth, imageHeight } = convertFaceBoxToOriginalImageSpace(dto, asset);

    const faceId = await this.personRepository.createAssetFace({
      personGroupId: person.personGroupId,
      assetId: dto.assetId,
      imageHeight,
      imageWidth,
      boundingBoxX1: Math.round(topLeft.x),
      boundingBoxX2: Math.round(bottomRight.x),
      boundingBoxY1: Math.round(topLeft.y),
      boundingBoxY2: Math.round(bottomRight.y),
      sourceType: SourceType.Manual,
    });
    await this.faceAssignmentService.assignFaces({
      personGroupId: person.personGroupId,
      faceIds: [faceId],
      strength: 'manual',
      from: person.personGroupId,
    });

    if (!person.faceAssetId) {
      await this.createNewFeaturePhoto([person]);
    }
  }

  async deleteFace(auth: AuthDto, id: string, dto: AssetFaceDeleteDto): Promise<void> {
    await this.requireAccess({ auth, permission: Permission.FaceDelete, ids: [id] });

    await (dto.force ? this.personRepository.deleteAssetFace(id) : this.personRepository.softDeleteAssetFaces(id));
    await this.faceIdentityRepository.unlinkFaces([id]);
  }

  getUsersForPeople(_auth: AuthDto, _dto: PersonUsersSearchDto): Promise<PersonUsersResponseDto> {
    return Promise.resolve([]);
  }

  upsertPeopleUsers(_auth: AuthDto, _dto: PeopleUsersUpsertDto): Promise<void> {
    throw personSharingUnsupported();
  }

  removeUsersFromPeople(_auth: AuthDto, _dto: PersonUsersDeleteDto): Promise<void> {
    throw personSharingUnsupported();
  }

  private vacuum(...tables: (keyof DB)[]): Promise<unknown> {
    return Promise.all(
      tables.map((table) =>
        this.databaseRepository
          .vacuum({ analyze: true, table })
          .then(() => this.databaseRepository.reindex(table, { concurrently: true })),
      ),
    );
  }
}
