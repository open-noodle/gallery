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

const toJobStatus = (outcome?: ChooseOutcome) =>
  !outcome || outcome.result === 'skipped' ? JobStatus.Skipped : JobStatus.Success;

/** Preview reads one pick runs at once: a remote storage backend makes each read a round trip. */
const PREVIEW_READ_CONCURRENCY = 4;

/**
Person covers picked by quality (specs/2026-11-21-person-cover-quality-design.md): the Missing / All job over personal
and space people, and Choose automatically on one personal person. Callers queue these jobs unconditionally; the
handlers check the setting.
*/
@Injectable()
export class PersonCoverService extends BaseService {
  @OnJob({ name: JobName.PersonCoverQueueAll, queue: QueueName.PersonCover })
  async handleQueueAll({ force = false }: JobOf<JobName.PersonCoverQueueAll>): Promise<JobStatus> {
    if (!(await this.isEnabled({ withCache: false }))) {
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
    if (!(await this.isEnabled({ withCache: true }))) {
      return JobStatus.Skipped;
    }
    return toJobStatus(await this.choosePersonCover(id, force ? 'all' : 'missing'));
  }

  @OnJob({ name: JobName.SpacePersonCover, queue: QueueName.PersonCover })
  async handleSpacePersonCover({ id, force }: JobOf<JobName.SpacePersonCover>): Promise<JobStatus> {
    if (!(await this.isEnabled({ withCache: true }))) {
      return JobStatus.Skipped;
    }
    return toJobStatus(await this.chooseSpacePersonCover(id, force ? 'all' : 'missing'));
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
  pet, protected, left to a hand-picked cover elsewhere in its identity, or not stale.
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

    // This person's own hand pick was turned away above; any other one counts when it is one of this person's faces.
    if (mode !== 'action' && person.identityId) {
      const handPicked = await this.personCoverRepository.getIdentityHandPickedCovers(person.identityId);
      if (handPicked.some(({ facePersonGroupId }) => facePersonGroupId === personGroupId)) {
        return;
      }
    }

    const candidates = await this.personCoverRepository.getPersonCandidates(personGroupId);
    if (mode === 'missing' && !isPickStale(cover, person.faceAssetId, candidates.length)) {
      return;
    }

    const faceId = await this.chooseFace(candidates, person.faceAssetId, mode);
    if (faceId === null && mode === 'action') {
      return { result: 'skipped', candidateCount: candidates.length };
    }

    const result = await this.personCoverRepository.applyPersonPick({
      personGroupId,
      faceId,
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

    // A hand pick on this space person would have made it `manual`; any other one counts when it is valid here.
    if (person.identityId) {
      for (const { faceId } of await this.personCoverRepository.getIdentityHandPickedCovers(person.identityId)) {
        if (await this.sharedSpaceRepository.isSpacePersonRepresentativeFaceValid(spacePersonId, faceId)) {
          return;
        }
      }
    }

    const candidates = await this.personCoverRepository.getSpacePersonCandidates(spacePersonId);
    if (mode === 'missing') {
      const pick = await this.personCoverRepository.getSpacePersonCover(spacePersonId);
      if (!isPickStale(pick, person.representativeFaceId, candidates.length)) {
        return;
      }
    }

    const faceId = await this.chooseFace(candidates, person.representativeFaceId, mode);
    const result = await this.personCoverRepository.applySpacePersonPick({
      spacePersonId,
      faceId,
      candidateCount: candidates.length,
    });
    return { result, candidateCount: candidates.length };
  }

  /**
  The face to make the cover. The job needs two candidates to choose from (one, when the profile has no cover at
  all) and keeps the current cover within the margin; the action takes the best of any number. Null when there is
  nothing to choose, which keeps the current cover.
  */
  private async chooseFace(
    candidates: CoverCandidateRow[],
    currentFaceId: string | null,
    mode: PersonCoverMode,
  ): Promise<string | null> {
    const minimum = mode === 'action' || currentFaceId === null ? 1 : 2;
    if (candidates.length < minimum) {
      return null;
    }

    const pixels = await this.readPixels(selectCoverPool(candidates));
    const pick = pickCover({
      candidates,
      pixels,
      currentFaceId,
      margin: mode === 'action' ? 0 : PERSON_COVER_MARGIN,
    });
    return pick?.faceId ?? null;
  }

  private async readPixels(pool: CoverCandidateRow[]): Promise<Map<string, CoverPixels>> {
    const pixels = new Map<string, CoverPixels>();
    for (let start = 0; start < pool.length; start += PREVIEW_READ_CONCURRENCY) {
      await Promise.all(pool.slice(start, start + PREVIEW_READ_CONCURRENCY).map((face) => this.readFace(face, pixels)));
    }
    return pixels;
  }

  private async readFace(face: CoverCandidateRow, pixels: Map<string, CoverPixels>) {
    if (!face.previewPath) {
      return;
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

  private async isEnabled(options: { withCache: boolean }) {
    const { machineLearning } = await this.getConfig(options);
    return isPersonCoverEnabled(machineLearning);
  }
}
