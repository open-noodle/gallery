import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Insertable, Updateable } from 'kysely';
import { isAbsolute } from 'node:path';
import { JOBS_ASSET_PAGINATION_SIZE } from 'src/constants';
import { Person } from 'src/database';
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
  PersonFaceSuggestionPageQueryDto,
  PersonFaceSuggestionPageResponseDto,
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
import { UpdateFacesData } from 'src/repositories/person.repository';
import { AssetFaceTable } from 'src/schema/tables/asset-face.table';
import { FaceSearchTable } from 'src/schema/tables/face-search.table';
import {
  buildAutomaticReconciliationClaim,
  chooseAutomaticTargetIdentity,
} from 'src/services/accessible-identity-reconciliation';
import { BaseService } from 'src/services/base.service';
import { JobItem, JobOf } from 'src/types';
import { getDimensions } from 'src/utils/asset.util';
import { asDateString } from 'src/utils/date';
import { ImmichMediaResponse } from 'src/utils/file';
import { mimeTypes } from 'src/utils/mime-types';
import { isFacialRecognitionEnabled } from 'src/utils/misc';
import { Point, transformPoints } from 'src/utils/transform';

const FACE_IDENTITY_BACKFILL_CHUNK_SIZE = 1000;
const PERSON_SUGGESTION_EMBEDDING_SAMPLE = 20;
const PERSON_SUGGESTION_NUM_RESULTS = 100;

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

  async getAll(auth: AuthDto, dto: PersonSearchDto): Promise<PeopleResponseDto> {
    const { withHidden = false, withSharedSpaces = false, closestAssetId, closestPersonId, page, size } = dto;
    const { machineLearning } = await this.getConfig({ withCache: false });

    if (withSharedSpaces) {
      return this.faceIdentityRepository.getAccessiblePeople(auth.user.id, {
        withHidden,
        page,
        size,
        minimumFaceCount: machineLearning.facialRecognition.minFaces,
      });
    }

    let closestFaceAssetId = closestAssetId;
    const pagination = {
      take: size,
      skip: (page - 1) * size,
    };

    if (closestPersonId) {
      const person = await this.personRepository.getById(closestPersonId);
      if (!person?.faceAssetId) {
        throw new NotFoundException('Person not found');
      }
      closestFaceAssetId = person.faceAssetId;
    }
    const { items, hasNextPage } = await this.personRepository.getAllForUser(pagination, auth.user.id, {
      minimumFaceCount: machineLearning.facialRecognition.minFaces,
      withHidden,
      closestFaceAssetId,
    });
    const { total, hidden } = await this.personRepository.getNumberOfPeople(auth.user.id, {
      minimumFaceCount: machineLearning.facialRecognition.minFaces,
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

    const { machineLearning } = await this.getConfig({ withCache: false });

    if (dto.withSharedSpaces) {
      return this.faceIdentityRepository.getAccessiblePeopleStatistics(auth.user.id, {
        minimumFaceCount: machineLearning.facialRecognition.minFaces,
      });
    }

    return this.personRepository.getPeopleOverviewStatistics(auth.user.id, {
      minimumFaceCount: machineLearning.facialRecognition.minFaces,
    });
  }

  async getPeopleFaceStatistics(auth: AuthDto, dto: PersonSearchDto): Promise<PeopleFaceStatisticsResponseDto> {
    if (dto.closestPersonId || dto.closestAssetId) {
      throw new BadRequestException('closestPersonId and closestAssetId are not supported for people face statistics');
    }

    const { machineLearning } = await this.getConfig({ withCache: false });

    if (dto.withSharedSpaces) {
      return this.faceIdentityRepository.getAccessiblePeopleFaceStatistics(auth.user.id, {
        minimumFaceCount: machineLearning.facialRecognition.minFaces,
      });
    }

    return this.personRepository.getPeopleFaceStatistics(auth.user.id, {
      minimumFaceCount: machineLearning.facialRecognition.minFaces,
    });
  }

  async mergeScopedPeople(auth: AuthDto, dto: MergeScopedPeopleDto): Promise<void> {
    const resolved = await this.faceIdentityRepository.resolveRepairRefs(auth.user.id, dto);
    if (!resolved.accessible) {
      throw new BadRequestException('One or more people were not found or are not accessible');
    }
    if (resolved.blockingConflict) {
      throw new ForbiddenException(
        resolved.blockingConflict.scope === 'space'
          ? `These people also share a separate profile in shared space "${resolved.blockingConflict.spaceName}", which you can only view. Ask an editor of "${resolved.blockingConflict.spaceName}" to merge them.`
          : `These people are also linked in another user's library, so they can't be merged here.`,
      );
    }

    await this.faceIdentityRepository.mergeIdentities({
      targetIdentityId: resolved.targetIdentityId,
      sourceIdentityIds: resolved.sourceIdentityIds,
      source: 'manual',
      collapseScopedConflicts: true,
    });
    await this.queueSpacePersonMetadataBackfill();
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

  async reassignFaces(auth: AuthDto, personId: string, dto: AssetFaceUpdateDto): Promise<PersonResponseDto[]> {
    await this.requireAccess({ auth, permission: Permission.PersonUpdate, ids: [personId] });
    const person = await this.findOrFail(personId);
    const result: PersonResponseDto[] = [];
    const changeFeaturePhoto: string[] = [];
    for (const data of dto.data) {
      const faces = await this.personRepository.getFacesByIds([{ personId: data.personId, assetId: data.assetId }]);

      for (const face of faces) {
        await this.requireAccess({ auth, permission: Permission.PersonCreate, ids: [face.id] });
        if (person.faceAssetId === null) {
          changeFeaturePhoto.push(person.id);
        }
        if (face.person && face.person.faceAssetId === face.id) {
          changeFeaturePhoto.push(face.person.id);
        }

        await this.personRepository.reassignFace(face.id, personId);
        await this.personFaceSuggestionRepository.resolveAssignedFace(face.id);
        await this.replaceFaceIdentity(personId, face.id, 'manual');
      }

      result.push(mapPerson(person));
    }
    if (changeFeaturePhoto.length > 0) {
      // Remove duplicates
      await this.createNewFeaturePhoto([...new Set(changeFeaturePhoto)]);
    }
    return result;
  }

  async reassignFacesById(auth: AuthDto, personId: string, dto: FaceDto): Promise<PersonResponseDto> {
    await this.requireAccess({ auth, permission: Permission.PersonUpdate, ids: [personId] });
    await this.requireAccess({ auth, permission: Permission.PersonCreate, ids: [dto.id] });
    const face = await this.personRepository.getFaceById(dto.id);
    const person = await this.findOrFail(personId);

    await this.personRepository.reassignFace(face.id, personId);
    await this.personFaceSuggestionRepository.resolveAssignedFace(face.id);
    await this.replaceFaceIdentity(personId, face.id, 'manual');
    if (person.faceAssetId === null) {
      await this.createNewFeaturePhoto([person.id]);
    }
    if (face.person && face.person.faceAssetId === face.id) {
      await this.createNewFeaturePhoto([face.person.id]);
    }

    return await this.findOrFail(personId).then(mapPerson);
  }

  async getFacesById(auth: AuthDto, dto: FaceDto): Promise<AssetFaceResponseDto[]> {
    await this.requireAccess({ auth, permission: Permission.AssetRead, ids: [dto.id] });
    const faces = await this.personRepository.getFaces(dto.id);
    const asset = await this.assetRepository.getForFaces(dto.id);
    const assetDimensions = getDimensions(asset);

    return faces.map((face) => mapFaces(face, auth, asset.edits, assetDimensions));
  }

  async createNewFeaturePhoto(changeFeaturePhoto: string[]) {
    this.logger.debug(
      `Changing feature photos for ${changeFeaturePhoto.length} ${changeFeaturePhoto.length > 1 ? 'people' : 'person'}`,
    );

    const jobs: JobItem[] = [];
    for (const personId of changeFeaturePhoto) {
      const assetFace = await this.personRepository.getRandomFace(personId);

      if (assetFace) {
        await this.personRepository.update({ id: personId, faceAssetId: assetFace.id });
        jobs.push({ name: JobName.PersonGenerateThumbnail, data: { id: personId } });
      }
    }

    await this.jobRepository.queueAll(jobs);
  }

  async getById(auth: AuthDto, id: string): Promise<PersonResponseDto> {
    const allowedIds = await this.checkAccess({ auth, permission: Permission.PersonRead, ids: [id] });
    if (allowedIds.has(id)) {
      return this.findOrFail(id).then(mapPerson);
    }

    const accessiblePerson = await this.faceIdentityRepository.getAccessiblePersonByProfileId(auth.user.id, id);
    if (accessiblePerson) {
      return accessiblePerson;
    }

    throw new BadRequestException(`Not found or no ${Permission.PersonRead} access`);
  }

  async getFaceSuggestions(
    auth: AuthDto,
    id: string,
    dto: PersonFaceSuggestionPageQueryDto,
  ): Promise<PersonFaceSuggestionPageResponseDto> {
    await this.requireAccess({ auth, permission: Permission.PersonRead, ids: [id] });

    const { machineLearning } = await this.getConfig({ withCache: true });
    const { maxDistance, suggestionMaxDistance } = machineLearning.facialRecognition;

    const { total, items } = await this.personFaceSuggestionRepository.getPendingForPerson(id, {
      maxDistance,
      suggestionMaxDistance,
      page: dto.page,
      size: dto.size,
    });

    return {
      total,
      items: items.map((item) => ({
        assetFaceId: item.assetFaceId,
        assetId: item.assetId,
        distance: item.distance,
        imageWidth: item.imageWidth,
        imageHeight: item.imageHeight,
        boundingBoxX1: item.boundingBoxX1,
        boundingBoxX2: item.boundingBoxX2,
        boundingBoxY1: item.boundingBoxY1,
        boundingBoxY2: item.boundingBoxY2,
        fileCreatedAt: asDateString(item.fileCreatedAt) ?? undefined,
      })),
    };
  }

  async confirmFaceSuggestion(auth: AuthDto, personId: string, assetFaceId: string): Promise<void> {
    await this.requireAccess({ auth, permission: Permission.PersonUpdate, ids: [personId] });
    await this.requireAccess({ auth, permission: Permission.PersonCreate, ids: [assetFaceId] });

    const confirmed = await this.personFaceSuggestionRepository.markConfirmed(personId, assetFaceId);
    if (confirmed === 0) {
      // Idempotent: the row was already confirmed/rejected/ignored (double-submit, or a concurrent
      // scan/auto-assign resolved it) while person+face still exist. A CASCADE-deleted
      // person/face never reaches here — the requireAccess checks above already threw 400
      // (owner-only precedence; edges 9/10 — the client treats that 400 as benign-advance).
      return;
    }

    // Delegates assign + replaceFaceIdentity('manual') + createNewFeaturePhoto, and (Task 5)
    // its embedded resolveAssignedFace deletes every OTHER person's still-pending row for
    // this now-assigned face (edge 12). This person's row is already 'confirmed' above, so
    // the pending-only delete leaves it intact.
    await this.reassignFacesById(auth, personId, { id: assetFaceId });
  }

  async rejectFaceSuggestion(auth: AuthDto, personId: string, assetFaceId: string): Promise<void> {
    // Owner-only on the PERSON only — intentionally asymmetric with confirm. Reject never
    // touches the face (it only suppresses a (personId, assetFaceId) suggestion row), so
    // person ownership is sufficient; confirm additionally checks face ownership because it
    // assigns the face. Consequence: reject on a CASCADE-deleted face (person still exists)
    // → markRejected affects 0 rows → benign 200; that asymmetry is by-design, not a gap.
    await this.requireAccess({ auth, permission: Permission.PersonUpdate, ids: [personId] });
    await this.personFaceSuggestionRepository.markRejected(personId, assetFaceId);
    // Face stays unassigned; the Phase-1 conditional upsertPending never resurrects a
    // 'rejected' row, so a later scan will not re-suggest it for this person.
  }

  async ignoreFaceSuggestion(auth: AuthDto, personId: string, assetFaceId: string): Promise<void> {
    await this.requireAccess({ auth, permission: Permission.PersonUpdate, ids: [personId] });
    await this.personFaceSuggestionRepository.markIgnored(personId, assetFaceId);
    // Face stays unassigned; ignored rows suppress future suggestions without rejecting the match.
  }

  async dismissFaceSuggestion(auth: AuthDto, personId: string, assetFaceId: string): Promise<void> {
    return this.rejectFaceSuggestion(auth, personId, assetFaceId);
  }

  async getFacesForPicker(auth: AuthDto, id: string, dto: PersonFacePageQueryDto): Promise<PersonFacePageResponseDto> {
    await this.requireAccess({ auth, permission: Permission.PersonRead, ids: [id] });
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
        fileCreatedAt: asDateString(face.fileCreatedAt) ?? undefined,
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
    await this.requireAccess({ auth, permission: Permission.PersonUpdate, ids: [id] });
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
      const person = await this.findOrFail(id);
      if (person.identityId) {
        return this.faceIdentityRepository.getAccessiblePersonStatistics(auth.user.id, person.identityId);
      }

      return this.personRepository.getStatistics(id);
    }

    const identityId = await this.faceIdentityRepository.getAccessibleProfileIdentityId(auth.user.id, id);
    if (!identityId) {
      throw new BadRequestException(`Not found or no ${Permission.PersonRead} access`);
    }

    return this.faceIdentityRepository.getAccessiblePersonStatistics(auth.user.id, identityId);
  }

  async getThumbnail(auth: AuthDto, id: string): Promise<ImmichMediaResponse> {
    await this.requireThumbnailAccess(auth, id);
    const person = await this.personRepository.getById(id);
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
    const person = await this.personRepository.create({
      ownerId: auth.user.id,
      name: dto.name,
      birthDate: dto.birthDate,
      isHidden: dto.isHidden,
      isFavorite: dto.isFavorite,
      color: dto.color,
    });

    return mapPerson(person);
  }

  async update(auth: AuthDto, id: string, dto: PersonUpdateDto): Promise<PersonResponseDto> {
    await this.requireAccess({ auth, permission: Permission.PersonUpdate, ids: [id] });
    const prior = await this.personRepository.getById(id);

    const { name, birthDate, isHidden, featureFaceAssetId: assetId, isFavorite, color } = dto;
    // TODO: set by faceId directly
    let faceId: string | undefined = undefined;
    if (assetId) {
      await this.requireAccess({ auth, permission: Permission.AssetRead, ids: [assetId] });
      const face = await this.personRepository.getForFeatureFaceUpdate({ personId: id, assetId });
      if (!face) {
        throw new BadRequestException('Invalid assetId for feature face or asset is offline');
      }

      faceId = face.id;
    }

    const person = await this.personRepository.update({
      id,
      faceAssetId: faceId,
      name,
      birthDate,
      isHidden,
      isFavorite,
      color,
    });

    if (assetId) {
      await this.jobRepository.queue({ name: JobName.PersonGenerateThumbnail, data: { id } });
    }

    if (person.identityId && (name !== undefined || birthDate !== undefined)) {
      await this.jobRepository.queue({
        name: JobName.SharedSpacePersonMetadataBackfill,
        data: { identityId: person.identityId },
      });
    }

    const { machineLearning } = await this.getConfig({ withCache: true });
    const { maxDistance, suggestionMaxDistance } = machineLearning.facialRecognition;
    const featureEnabled = suggestionMaxDistance > maxDistance;
    const nowScannable = person.name !== '' && !person.isHidden && person.type === 'person';
    if (featureEnabled && nowScannable && prior && prior.name !== person.name) {
      await this.jobRepository.queue({ name: JobName.PersonSuggestionScan, data: { id } });
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
    const people = await this.personRepository.getForPeopleDelete(ids);
    await this.removeAllPeople(people);
    if (people.length > 0) {
      await this.queueSpacePersonMetadataBackfill();
    }
  }

  @Chunked()
  private async removeAllPeople(people: { id: string; thumbnailPath: string }[]) {
    const files = people.map((person) => person.thumbnailPath);
    await this.jobRepository.queue({ name: JobName.FileDelete, data: { files } });
    await this.personRepository.delete(people.map((person) => person.id));
    this.logger.debug(`Deleted ${people.length} people`);
  }

  @OnJob({ name: JobName.PersonCleanup, queue: QueueName.BackgroundTask })
  async handlePersonCleanup(): Promise<JobStatus> {
    const people = await this.personRepository.getAllWithoutFaces();
    await this.removeAllPeople(people);
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
  }: JobOf<JobName.FaceIdentityBackfill>): Promise<JobStatus> {
    const affectedSpaceAssets: SharedSpaceFaceMatchBackfillTarget[] = [];
    this.logger.debug(
      `FaceIdentityBackfill peopleBackfill start stage=${stage} cursor=${cursor ?? 'none'} continuation=${continuationId ?? 'none'}`,
    );

    if (stage === 'person') {
      const result = await this.faceIdentityRepository.backfillPersonalIdentities({
        cursor,
        limit: FACE_IDENTITY_BACKFILL_CHUNK_SIZE,
      });
      affectedSpaceAssets.push(...this.getAffectedSpaceAssets(result));
      this.logger.debug(
        `FaceIdentityBackfill peopleBackfill personal page processed=${result.processed} nextCursor=${result.nextCursor ?? 'none'} affectedSpaceAssets=${affectedSpaceAssets.length}`,
      );

      if (result.nextCursor) {
        this.logger.debug(`FaceIdentityBackfill peopleBackfill queue next stage=person cursor=${result.nextCursor}`);
        await this.jobRepository.queue({
          name: JobName.FaceIdentityBackfill,
          data: { stage: 'person', cursor: result.nextCursor },
        });
        return JobStatus.Success;
      }
    }

    const result = await this.faceIdentityRepository.backfillSpacePersonIdentities({
      cursor: stage === 'space-person' ? cursor : undefined,
      limit: FACE_IDENTITY_BACKFILL_CHUNK_SIZE,
    });
    affectedSpaceAssets.push(...this.getAffectedSpaceAssets(result));
    this.logger.debug(
      `FaceIdentityBackfill peopleBackfill space-person page processed=${result.processed} nextCursor=${result.nextCursor ?? 'none'} conflicts=${result.conflictCount} affectedSpaceAssets=${affectedSpaceAssets.length}`,
    );

    if (result.conflictCount > 0) {
      this.logger.warn(`Face identity backfill left ${result.conflictCount} space people unresolved`);
    }

    if (result.nextCursor) {
      this.logger.debug(
        `FaceIdentityBackfill peopleBackfill queue next stage=space-person cursor=${result.nextCursor}`,
      );
      await this.jobRepository.queue({
        name: JobName.FaceIdentityBackfill,
        data: { stage: 'space-person', cursor: result.nextCursor },
      });
      return JobStatus.Success;
    }

    const work = await this.faceIdentityRepository.getBackfillWork();
    this.logger.debug(
      `FaceIdentityBackfill peopleBackfill remaining work personal=${work.hasPersonalIdentityWork} spacePerson=${work.hasSpacePersonIdentityWork} projection=${work.hasSharedSpaceProjectionWork}`,
    );

    if (work.hasPersonalIdentityWork || work.hasSpacePersonIdentityWork) {
      const nextContinuationId = this.getNextFaceIdentityBackfillContinuationId(continuationId);
      this.logger.debug(`FaceIdentityBackfill peopleBackfill queue continuation=${nextContinuationId}`);
      await this.jobRepository.queue({
        name: JobName.FaceIdentityBackfill,
        data: { continuationId: nextContinuationId },
      });
      return JobStatus.Success;
    }

    const pendingTargets = await this.faceIdentityRepository.getPendingSharedSpaceFaceMatchBackfillTargets();
    this.logger.debug(
      `FaceIdentityBackfill peopleBackfill finalizing pendingTargets=${pendingTargets.length} affectedSpaceAssets=${affectedSpaceAssets.length}`,
    );

    if (work.hasSharedSpaceProjectionWork) {
      const projectionTargets = await this.faceIdentityRepository.getSharedSpaceFaceMatchBackfillTargets();
      this.logger.debug(`FaceIdentityBackfill peopleBackfill projectionTargets=${projectionTargets.length}`);
      if (projectionTargets.length === 0) {
        this.logger.warn('Face identity projection backfill work was reported but no targets were found');
      }
      affectedSpaceAssets.push(...projectionTargets);
    }

    const queuedTargets = await this.queueSharedSpaceFaceMatchTargets([...pendingTargets, ...affectedSpaceAssets]);
    this.logger.debug(`FaceIdentityBackfill peopleBackfill queued face-match targets=${queuedTargets.length}`);
    await this.faceIdentityRepository.deletePendingSharedSpaceFaceMatchBackfillTargets(pendingTargets);
    if (queuedTargets.length === 0) {
      await this.queueSpacePersonMetadataBackfill();
      this.logger.debug('FaceIdentityBackfill peopleBackfill complete; queuedSpacePersonMetadataBackfill=true');

      const { machineLearning } = await this.getConfig({ withCache: true });
      const { maxDistance, suggestionMaxDistance } = machineLearning.facialRecognition;
      if (suggestionMaxDistance > maxDistance) {
        await this.jobRepository.queue({ name: JobName.PersonSuggestionScanQueueAll, data: {} });
        await this.jobRepository.queue({ name: JobName.SpacePersonSuggestionScanQueueAll, data: {} });
      }
    }

    return JobStatus.Success;
  }

  private getNextFaceIdentityBackfillContinuationId(currentContinuationId?: string): string {
    return currentContinuationId === 'a' ? 'b' : 'a';
  }

  @OnJob({ name: JobName.PersonSuggestionScan, queue: QueueName.PeopleBackfill })
  async handlePersonSuggestionScan({ id }: JobOf<JobName.PersonSuggestionScan>): Promise<JobStatus> {
    const { machineLearning } = await this.getConfig({ withCache: true });
    const { maxDistance, suggestionMaxDistance } = machineLearning.facialRecognition;
    if (suggestionMaxDistance <= maxDistance) {
      return JobStatus.Skipped;
    }

    const person = await this.personRepository.getById(id);
    if (!person || person.name === '' || person.isHidden || person.type !== 'person') {
      return JobStatus.Skipped;
    }

    const embeddings = await this.personRepository.getAssignedFaceEmbeddings(id, PERSON_SUGGESTION_EMBEDDING_SAMPLE);
    if (embeddings.length === 0) {
      return JobStatus.Skipped;
    }

    const bestByFace = new Map<string, number>();
    for (const { embedding } of embeddings) {
      const matches = await this.searchRepository.searchFaces({
        userIds: [person.ownerId],
        embedding,
        hasPerson: false,
        maxDistance: suggestionMaxDistance,
        numResults: PERSON_SUGGESTION_NUM_RESULTS,
      });
      for (const match of matches) {
        if (match.distance <= maxDistance) {
          continue;
        }
        const prev = bestByFace.get(match.id);
        if (prev === undefined || match.distance < prev) {
          bestByFace.set(match.id, match.distance);
        }
      }
    }

    const rows = [...bestByFace].map(([assetFaceId, distance]) => ({ personId: id, assetFaceId, distance }));
    await this.personFaceSuggestionRepository.upsertPending(rows);
    return JobStatus.Success;
  }

  @OnJob({ name: JobName.PersonSuggestionScanQueueAll, queue: QueueName.PeopleBackfill })
  async handlePersonSuggestionScanQueueAll(_data: JobOf<JobName.PersonSuggestionScanQueueAll>): Promise<JobStatus> {
    const { machineLearning } = await this.getConfig({ withCache: false });
    const { maxDistance, suggestionMaxDistance } = machineLearning.facialRecognition;
    if (suggestionMaxDistance <= maxDistance) {
      return JobStatus.Skipped;
    }

    let jobs: { name: JobName.PersonSuggestionScan; data: { id: string } }[] = [];
    for await (const person of this.personRepository.getScannablePeopleWithUnassignedFaces()) {
      jobs.push({ name: JobName.PersonSuggestionScan, data: { id: person.id } });
      if (jobs.length === JOBS_ASSET_PAGINATION_SIZE) {
        await this.jobRepository.queueAll(jobs);
        jobs = [];
      }
    }
    await this.jobRepository.queueAll(jobs);
    return JobStatus.Success;
  }

  @OnJob({ name: JobName.SpacePersonSuggestionScan, queue: QueueName.PeopleBackfill })
  async handleSpacePersonSuggestionScan({ id }: JobOf<JobName.SpacePersonSuggestionScan>): Promise<JobStatus> {
    const { machineLearning } = await this.getConfig({ withCache: true });
    const { maxDistance, suggestionMaxDistance } = machineLearning.facialRecognition;
    if (suggestionMaxDistance <= maxDistance) {
      return JobStatus.Skipped;
    }

    const person = await this.sharedSpaceRepository.getPersonById(id);
    if (!person || person.name.trim() === '' || person.isHidden || person.type !== 'person') {
      return JobStatus.Skipped;
    }

    const space = await this.sharedSpaceRepository.getById(person.spaceId);
    if (!space?.faceRecognitionEnabled) {
      return JobStatus.Skipped;
    }

    const embeddings = await this.sharedSpaceRepository.getSpacePersonAssignedFaceEmbeddings(
      id,
      PERSON_SUGGESTION_EMBEDDING_SAMPLE,
    );
    if (embeddings.length === 0) {
      return JobStatus.Skipped;
    }

    const bestByFace = new Map<string, number>();
    for (const { embedding } of embeddings) {
      const matches = await this.searchRepository.searchFaces({
        spaceId: person.spaceId,
        embedding,
        hasPerson: false,
        maxDistance: suggestionMaxDistance,
        numResults: PERSON_SUGGESTION_NUM_RESULTS,
      });
      for (const match of matches) {
        if (match.distance <= maxDistance) {
          continue;
        }
        const prev = bestByFace.get(match.id);
        if (prev === undefined || match.distance < prev) {
          bestByFace.set(match.id, match.distance);
        }
      }
    }

    const assigned = await this.sharedSpaceRepository.getAssignedFaceIdsForSpace(person.spaceId, [
      ...bestByFace.keys(),
    ]);
    for (const { assetFaceId } of assigned) {
      bestByFace.delete(assetFaceId);
    }

    const rows = [...bestByFace].map(([assetFaceId, distance]) => ({
      spacePersonId: id,
      assetFaceId,
      distance,
    }));
    await this.personFaceSuggestionRepository.upsertPendingForSpacePerson(rows);
    return JobStatus.Success;
  }

  @OnJob({ name: JobName.SpacePersonSuggestionScanQueueAll, queue: QueueName.PeopleBackfill })
  async handleSpacePersonSuggestionScanQueueAll(
    _data: JobOf<JobName.SpacePersonSuggestionScanQueueAll>,
  ): Promise<JobStatus> {
    const { machineLearning } = await this.getConfig({ withCache: false });
    const { maxDistance, suggestionMaxDistance } = machineLearning.facialRecognition;
    if (suggestionMaxDistance <= maxDistance) {
      return JobStatus.Skipped;
    }

    let jobs: { name: JobName.SpacePersonSuggestionScan; data: { id: string } }[] = [];
    for await (const person of this.sharedSpaceRepository.getScannableSpacePeopleWithUnassignedFaces()) {
      jobs.push({ name: JobName.SpacePersonSuggestionScan, data: { id: person.id } });
      if (jobs.length === JOBS_ASSET_PAGINATION_SIZE) {
        await this.jobRepository.queueAll(jobs);
        jobs = [];
      }
    }
    await this.jobRepository.queueAll(jobs);
    return JobStatus.Success;
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

    let jobs: JobItem[] = [];
    const assets = this.assetJobRepository.streamForDetectFacesJob(force);
    for await (const asset of assets) {
      jobs.push({
        name: JobName.AssetDetectFaces,
        data: {
          id: asset.id,
          ...(force === true ? { force: true } : {}),
        },
      });

      if (jobs.length >= JOBS_ASSET_PAGINATION_SIZE) {
        await this.jobRepository.queueAll(jobs);
        jobs = [];
      }
    }

    await this.jobRepository.queueAll(jobs);

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
    const previewFile = asset?.files[0];
    if (!asset || asset.files.length !== 1 || !previewFile) {
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
  async handleQueueRecognizeFaces({ force, nightly }: JobOf<JobName.FacialRecognitionQueueAll>): Promise<JobStatus> {
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
      await this.personRepository.unassignFaces({ sourceType: SourceType.MachineLearning });
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
    const facePagination = this.personRepository.getAllFaces(
      force ? { sourceType: SourceType.MachineLearning } : { personId: null, sourceType: SourceType.MachineLearning },
    );

    let jobs: {
      name: JobName.FacialRecognition;
      data: { id: string; deferred: false; skipSharedSpaceMatch?: true };
    }[] = [];
    for await (const face of facePagination) {
      jobs.push({
        name: JobName.FacialRecognition,
        data: {
          id: face.id,
          deferred: false,
          ...(force ? { skipSharedSpaceMatch: true as const } : {}),
        },
      });

      if (jobs.length === JOBS_ASSET_PAGINATION_SIZE) {
        await this.jobRepository.queueAll(jobs);
        jobs = [];
      }
    }

    await this.jobRepository.queueAll(jobs);

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

    if (face.personId) {
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

    const matches = await this.searchRepository.searchFaces({
      userIds: [face.asset.ownerId],
      embedding: face.faceSearch.embedding,
      maxDistance: machineLearning.facialRecognition.maxDistance,
      numResults: machineLearning.facialRecognition.minFaces,
      minBirthDate: new Date(face.asset.fileCreatedAt),
    });

    this.logger.debug(`Face ${id} has ${matches.length} matches`);

    let personId = matches.find((match) => match.personId)?.personId;
    const accessibleIdentityMatch = personId
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

    if (!personId) {
      const matchWithPerson = await this.searchRepository.searchFaces({
        userIds: [face.asset.ownerId],
        embedding: face.faceSearch.embedding,
        maxDistance: machineLearning.facialRecognition.maxDistance,
        numResults: 1,
        hasPerson: true,
        minBirthDate: new Date(face.asset.fileCreatedAt),
      });

      if (matchWithPerson.length > 0) {
        personId = matchWithPerson[0].personId;
      }
    }

    let createdPersonId: string | undefined;
    if (isCore && !personId) {
      this.logger.log(`Creating new person for face ${id}`);
      const newPerson = await this.personRepository.create({ ownerId: face.asset.ownerId, faceAssetId: face.id });
      await this.jobRepository.queue({ name: JobName.PersonGenerateThumbnail, data: { id: newPerson.id } });
      personId = newPerson.id;
      createdPersonId = newPerson.id;
    }

    if (personId) {
      this.logger.debug(`Assigning face ${id} to person ${personId}`);
      await this.personRepository.reassignFaces({ faceIds: [id], newPersonId: personId });
      const sourceIdentityId = await this.replaceFaceIdentity(personId, id, 'owner-person');
      await this.mergeWithAccessibleSharedIdentity({
        userId: face.asset.ownerId,
        embedding: face.faceSearch.embedding,
        maxDistance: machineLearning.facialRecognition.maxDistance,
        sourceIdentityId,
        match: personId === createdPersonId ? accessibleIdentityMatch : undefined,
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
  async handlePersonMigration({ id }: JobOf<JobName.PersonFileMigration>): Promise<JobStatus> {
    const person = await this.personRepository.getById(id);
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

  async mergePerson(auth: AuthDto, id: string, dto: MergePersonDto): Promise<BulkIdResponseDto[]> {
    const mergeIds = dto.ids;
    if (mergeIds.includes(id)) {
      throw new BadRequestException('Cannot merge a person into themselves');
    }

    await this.requireAccess({ auth, permission: Permission.PersonUpdate, ids: [id] });
    let primaryPerson = await this.findOrFail(id);
    const primaryName = primaryPerson.name || primaryPerson.id;

    const results: BulkIdResponseDto[] = [];

    const allowedIds = await this.checkAccess({
      auth,
      permission: Permission.PersonMerge,
      ids: mergeIds,
    });

    for (const mergeId of mergeIds) {
      const hasAccess = allowedIds.has(mergeId);
      if (!hasAccess) {
        results.push({ id: mergeId, success: false, error: BulkIdErrorReason.NO_PERMISSION });
        continue;
      }

      try {
        const mergePerson = await this.personRepository.getById(mergeId);
        if (!mergePerson) {
          results.push({ id: mergeId, success: false, error: BulkIdErrorReason.NOT_FOUND });
          continue;
        }

        const update: Updateable<Person> & { id: string } = { id: primaryPerson.id };
        if (!primaryPerson.name && mergePerson.name) {
          update.name = mergePerson.name;
        }

        if (!primaryPerson.birthDate && mergePerson.birthDate) {
          update.birthDate = mergePerson.birthDate;
        }

        if (Object.keys(update).length > 1) {
          primaryPerson = await this.personRepository.update(update);
        }

        const mergeName = mergePerson.name || mergePerson.id;
        const mergeData: UpdateFacesData = { oldPersonId: mergeId, newPersonId: id };
        this.logger.log(`Merging ${mergeName} into ${primaryName}`);

        const targetIdentity = await this.faceIdentityRepository.ensurePersonIdentity(id);
        const sourceIdentity = await this.faceIdentityRepository.ensurePersonIdentity(mergeId);
        await this.personRepository.reassignFaces(mergeData);
        await this.faceIdentityRepository.linkPersonFaces({
          personId: id,
          identityId: targetIdentity.id,
          source: 'manual',
        });
        await this.removeAllPeople([mergePerson]);
        await this.faceIdentityRepository.mergeIdentities({
          targetIdentityId: targetIdentity.id,
          sourceIdentityIds: [sourceIdentity.id],
          source: 'manual',
        });
        await this.queueSpacePersonMetadataBackfill(targetIdentity.id);

        this.logger.log(`Merged ${mergeName} into ${primaryName}`);
        results.push({ id: mergeId, success: true });
      } catch (error: Error | any) {
        this.logger.error(`Unable to merge ${mergeId} into ${id}: ${error}`, error?.stack);
        results.push({ id: mergeId, success: false, error: BulkIdErrorReason.UNKNOWN });
      }
    }
    return results;
  }

  private async queueSpacePersonMetadataBackfill(identityId?: string | null): Promise<void> {
    await this.jobRepository.queue({
      name: JobName.SharedSpacePersonMetadataBackfill,
      data: identityId ? { identityId } : {},
    });
  }

  private async findOrFail(id: string) {
    const person = await this.personRepository.getById(id);
    if (!person) {
      throw new BadRequestException('Person not found');
    }
    return person;
  }

  // TODO return a asset face response
  async createFace(auth: AuthDto, dto: AssetFaceCreateDto): Promise<void> {
    await Promise.all([
      this.requireAccess({ auth, permission: Permission.AssetRead, ids: [dto.assetId] }),
      this.requireAccess({ auth, permission: Permission.PersonRead, ids: [dto.personId] }),
    ]);

    const [asset, person] = await Promise.all([
      this.assetRepository.getById(dto.assetId, { edits: true, exifInfo: true }),
      this.findOrFail(dto.personId),
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

      const {
        points: [invertedTopLeft, invertedBottomRight],
      } = transformPoints(
        [topLeft, bottomRight],
        edits,
        { width: asset.width, height: asset.height },
        { inverse: true },
      );

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
      personId: dto.personId,
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
      await this.createNewFeaturePhoto([person.id]);
    }
  }

  async deleteFace(auth: AuthDto, id: string, dto: AssetFaceDeleteDto): Promise<void> {
    await this.requireAccess({ auth, permission: Permission.FaceDelete, ids: [id] });

    await (dto.force ? this.personRepository.deleteAssetFace(id) : this.personRepository.softDeleteAssetFaces(id));
    await this.faceIdentityRepository.unlinkFaces([id]);
  }
}
