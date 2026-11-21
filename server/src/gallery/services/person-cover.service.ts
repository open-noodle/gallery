import { BadRequestException, Injectable } from '@nestjs/common';
import { OnJob } from 'src/decorators.js';
import { AuthDto } from 'src/dtos/auth.dto.js';
import { PersonResponseDto, mapPerson } from 'src/dtos/person.dto.js';
import { JobName, JobStatus, Permission, QueueName } from 'src/enum.js';
import type { CoverCandidateRow, CoverPickResult } from 'src/gallery/repositories/person-cover.repository.js';
import { exposureStats, laplacianVariance } from 'src/gallery/utils/cleanup.js';
import { readFaceGreyscalePixels } from 'src/gallery/utils/image-quality.js';
import {
  PERSON_COVER_CROP_SIZE,
  PERSON_COVER_MARGIN,
  isCoverProtected,
  isPersonCoverEnabled,
  isPickStale,
  pickCover,
  selectCoverPool,
  type CoverPixels,
  type PersonCoverMode,
} from 'src/gallery/utils/person-cover.js';
import { BaseService } from 'src/services/base.service.js';
import type { JobOf } from 'src/types.js';
import { batched, findOrFail } from 'src/utils/misc.js';

type ChooseOutcome = { result: CoverPickResult; candidateCount: number };

/**
Person covers picked by quality (specs/2026-11-21-person-cover-quality-design.md): the Missing / All job over personal
and space people, and Choose automatically on one personal person.
*/
@Injectable()
export class PersonCoverService extends BaseService {
  @OnJob({ name: JobName.PersonCoverQueueAll, queue: QueueName.PersonCover })
  async handleQueueAll({ force = false }: JobOf<JobName.PersonCoverQueueAll>): Promise<JobStatus> {
    if (!(await this.isEnabled())) {
      return JobStatus.Skipped;
    }

    for await (const batch of batched(this.personCoverRepository.streamPeopleToPick({ force }))) {
      await this.jobRepository.queueAll(
        batch.map(({ personGroupId }) => ({ name: JobName.PersonCover, data: { id: personGroupId, force } })),
      );
    }
    for await (const batch of batched(this.personCoverRepository.streamSpacePeopleToPick({ force }))) {
      await this.jobRepository.queueAll(
        batch.map(({ id }) => ({ name: JobName.SpacePersonCover, data: { id, force } })),
      );
    }
    return JobStatus.Success;
  }

  @OnJob({ name: JobName.PersonCover, queue: QueueName.PersonCover })
  async handlePersonCover({ id, force }: JobOf<JobName.PersonCover>): Promise<JobStatus> {
    if (!(await this.isEnabled())) {
      return JobStatus.Skipped;
    }
    const outcome = await this.choosePersonCover(id, force ? 'all' : 'missing');
    return outcome?.result === 'skipped' || !outcome ? JobStatus.Skipped : JobStatus.Success;
  }

  @OnJob({ name: JobName.SpacePersonCover, queue: QueueName.PersonCover })
  async handleSpacePersonCover({ id, force }: JobOf<JobName.SpacePersonCover>): Promise<JobStatus> {
    if (!(await this.isEnabled())) {
      return JobStatus.Skipped;
    }
    const outcome = await this.chooseSpacePersonCover(id, force ? 'all' : 'missing');
    return outcome?.result === 'skipped' || !outcome ? JobStatus.Skipped : JobStatus.Success;
  }

  /** POST /people/{id}/representative-face/auto: owner only, whether the setting is on or off. */
  async chooseAutomatically(auth: AuthDto, id: string): Promise<PersonResponseDto> {
    await this.requireAccess({ auth, permission: Permission.PersonUpdate, ids: [id] });
    const outcome = await this.choosePersonCover(id, 'action');
    if (!outcome || outcome.candidateCount === 0) {
      throw new BadRequestException('Person has no photo to choose a thumbnail from');
    }
    return mapPerson(await findOrFail(() => this.personRepository.getByGroupIdOnly(id), 'Person'));
  }

  /**
  Picks one personal person's cover for `mode`. Undefined when nothing was looked at: the person is gone, hidden, a
  pet, protected, not stale, or left to a hand-picked cover elsewhere in its identity.
  */
  private async choosePersonCover(personGroupId: string, mode: PersonCoverMode): Promise<ChooseOutcome | undefined> {
    const person = await this.personRepository.getByGroupIdOnly(personGroupId);
    if (!person || (mode !== 'action' && (person.isHidden || person.type === 'pet'))) {
      return;
    }

    const cover = await this.personCoverRepository.getPersonCover(personGroupId);
    if (isCoverProtected(cover, person.faceAssetId, mode)) {
      return;
    }

    const candidates = await this.personCoverRepository.getPersonCandidates(personGroupId);
    if (mode === 'missing' && !isPickStale(cover, person.faceAssetId, candidates.length)) {
      return;
    }

    if (mode !== 'action' && person.identityId) {
      const handPicked = await this.personCoverRepository.getIdentityHandPickedCovers(person.identityId);
      const reachable = handPicked.some(
        (row) =>
          !(row.profileType === 'person' && row.profileId === personGroupId) && row.facePersonGroupId === personGroupId,
      );
      if (reachable) {
        return;
      }
    }

    const faceId = await this.chooseFace(candidates, person.faceAssetId, mode);
    if (faceId === undefined && mode === 'action') {
      return { result: 'skipped', candidateCount: candidates.length };
    }

    const result = await this.personCoverRepository.applyPersonPick({
      personGroupId,
      faceId: faceId ?? null,
      candidateCount: candidates.length,
      mode,
    });
    if (result === 'changed') {
      await this.jobRepository.queue({
        name: JobName.PersonGenerateThumbnail,
        data: { ownerId: person.ownerId, personGroupId },
      });
    }
    return { result, candidateCount: candidates.length };
  }

  /** The same for an automatic space person, from its faces reachable in the space. */
  private async chooseSpacePersonCover(
    spacePersonId: string,
    mode: 'missing' | 'all',
  ): Promise<ChooseOutcome | undefined> {
    const person = await this.sharedSpaceRepository.getPersonById(spacePersonId);
    if (!person || person.isHidden || person.type !== 'person' || person.representativeFaceSource !== 'auto') {
      return;
    }

    const candidates = await this.personCoverRepository.getSpacePersonCandidates(spacePersonId);
    if (mode === 'missing') {
      const pick = await this.personCoverRepository.getSpacePersonCover(spacePersonId);
      if (!isPickStale(pick, person.representativeFaceId, candidates.length)) {
        return;
      }
    }

    if (person.identityId) {
      const handPicked = await this.personCoverRepository.getIdentityHandPickedCovers(person.identityId);
      for (const row of handPicked) {
        if (row.profileType === 'space-person' && row.profileId === spacePersonId) {
          continue;
        }
        if (await this.sharedSpaceRepository.isSpacePersonRepresentativeFaceValid(spacePersonId, row.faceId)) {
          return;
        }
      }
    }

    const faceId = await this.chooseFace(candidates, person.representativeFaceId, mode);
    const result = await this.personCoverRepository.applySpacePersonPick({
      spacePersonId,
      faceId: faceId ?? null,
      candidateCount: candidates.length,
    });
    return { result, candidateCount: candidates.length };
  }

  /**
  The face to make the cover. The job needs two candidates to choose from (one, when the profile has no cover at
  all) and keeps the current cover within the margin; the action takes the best of any number. Undefined when there
  is nothing to choose, which keeps the current cover.
  */
  private async chooseFace(
    candidates: CoverCandidateRow[],
    currentFaceId: string | null,
    mode: PersonCoverMode,
  ): Promise<string | undefined> {
    const minimum = mode === 'action' || currentFaceId === null ? 1 : 2;
    if (candidates.length < minimum) {
      return;
    }

    const pixels = await this.readPixels(selectCoverPool(candidates) as CoverCandidateRow[]);
    const pick = pickCover({
      candidates,
      pixels,
      currentFaceId,
      margin: mode === 'action' ? 0 : PERSON_COVER_MARGIN,
    });
    return pick?.faceId;
  }

  private async readPixels(pool: CoverCandidateRow[]): Promise<Map<string, CoverPixels>> {
    const pixels = new Map<string, CoverPixels>();
    for (const face of pool) {
      if (!face.previewPath) {
        continue;
      }
      try {
        await using preview = await this.backendMedia.ensureLocalFile(face.previewPath);
        const data = await readFaceGreyscalePixels(
          preview.localPath,
          { x1: face.boundingBoxX1, y1: face.boundingBoxY1, x2: face.boundingBoxX2, y2: face.boundingBoxY2 },
          { width: face.imageWidth, height: face.imageHeight },
          PERSON_COVER_CROP_SIZE,
        );
        const { brightness, clippedDark } = exposureStats(data);
        pixels.set(face.faceId, {
          sharpness: laplacianVariance(data, PERSON_COVER_CROP_SIZE, PERSON_COVER_CROP_SIZE),
          brightness,
          clippedDark,
        });
      } catch (error) {
        this.logger.warn(`Person cover: could not read the preview of face ${face.faceId}: ${error}`);
      }
    }
    return pixels;
  }

  private async isEnabled() {
    const { machineLearning } = await this.getConfig({ withCache: false });
    return isPersonCoverEnabled(machineLearning);
  }
}
