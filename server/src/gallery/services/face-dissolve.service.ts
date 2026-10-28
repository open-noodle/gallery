import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { AuthDto } from 'src/dtos/auth.dto.js';
import { JobName, QueueName } from 'src/enum.js';
import {
  DissolveRequest,
  DissolveResponse,
  DissolveWarning,
  PeopleHealthQuery,
} from 'src/gallery/dtos/face-dissolve.dto.js';
import {
  DissolveCounts,
  DissolveWriteResult,
  PersonHealthRow,
} from 'src/gallery/repositories/face-dissolve.repository.js';
import { BaseService } from 'src/services/base.service.js';

@Injectable()
export class FaceDissolveService extends BaseService {
  /**
   * The contamination signal. Deliberately NOT the picker search (searchOwnerPeople) — this aggregate is what
   * makes a person with only EXIF faces findable at all, since no scan will ever flag one.
   */
  async getPeopleHealth(
    dto: PeopleHealthQuery,
  ): Promise<{ people: PersonHealthRow[]; total: number; hasMore: boolean }> {
    return this.faceDissolveRepository.getPeopleHealth({
      ownerId: dto.ownerId,
      sort: dto.sort,
      page: dto.page,
      size: dto.size,
    });
  }

  async preview(personId: string, dto: DissolveRequest): Promise<DissolveResponse> {
    const person = await this.requirePerson(personId);
    const counts = await this.faceDissolveRepository.getCounts(personId, dto.scope);
    return {
      personId: person.personGroupId,
      counts,
      expectedFaceCount: counts.faces,
      warnings: await this.buildWarnings(counts),
    };
  }

  async apply(auth: AuthDto, personId: string, dto: DissolveRequest): Promise<DissolveResponse> {
    const person = await this.requirePerson(personId);
    await this.refuseWhileRecognitionRuns();

    const counts = await this.faceDissolveRepository.getCounts(personId, dto.scope);
    if (counts.faces !== dto.expectedFaceCount) {
      throw new ConflictException('The faces changed since the preview. Review the preview again.');
    }

    // One transaction: the write, and the pending suggestions of the faces it hid. A hidden face's stale suggestion
    // must clear iff the hide commits, the same pairing the console's "Not a face" detach uses.
    const result: DissolveWriteResult = await this.databaseRepository.transaction(async (trx) => {
      const written = await this.faceDissolveRepository.dissolve(
        {
          personGroupId: personId,
          scope: dto.scope,
          ownerId: person.ownerId,
          personName: person.name,
          actorId: auth.user.id,
        },
        trx,
      );
      await this.facePersonVerdictRepository.drainPendingForFaces(written.hiddenFaceIds, trx);
      return written;
    });

    if (result.deletedThumbnailPath) {
      await this.jobRepository.queue({ name: JobName.FileDelete, data: { files: [result.deletedThumbnailPath] } });
    }

    // A surviving person must never keep a hidden or deleted face as its thumbnail.
    if (!result.personRemoved) {
      const repointed = await this.faceRepairRepository.reconcileRepresentativeFaces([personId]);
      if (repointed.length > 0) {
        await this.jobRepository.queueAll(
          repointed.map(({ ownerId, personGroupId }) => ({
            name: JobName.PersonGenerateThumbnail as const,
            data: { ownerId, personGroupId },
          })),
        );
      }
    }

    // The repair for deleted imported faces. Detected faces are hidden and never re-scanned. NOT PersonCleanup (L2),
    // NOT deleteUnreferencedIdentities (L5), NOT deleteAllOrphanedPersons (L1): all three are unscoped.
    if (result.assetsCleared > 0) {
      await this.jobRepository.queue({ name: JobName.AssetDetectFacesQueueAll, data: { force: false } });
    }

    this.logger.log(
      `Dissolved person ${personId} (${person.name}), scope=${dto.scope}: ${result.hiddenFaceIds.length} hidden, ` +
        `${result.deleted} deleted, ${result.unassigned} unassigned, ${result.assetsCleared} photos re-queued, ` +
        `person ${result.personRemoved ? 'removed' : 'kept'}`,
    );

    return {
      personId,
      counts,
      expectedFaceCount: counts.faces,
      warnings: await this.buildWarnings(counts),
      ...(result.dissolveId && { dissolveId: result.dissolveId }),
    };
  }

  private async requirePerson(personId: string) {
    const person = await this.personRepository.getByGroupIdOnly(personId);
    if (!person) {
      throw new NotFoundException('Person not found');
    }
    // Pet re-detection is a separate pipeline (L6).
    if (person.type === 'pet') {
      throw new BadRequestException('Pets cannot be dissolved');
    }
    return person;
  }

  /** A dissolve or restore under a running recognition or detection pass would race it (L13). */
  protected async refuseWhileRecognitionRuns() {
    for (const queue of [QueueName.FacialRecognition, QueueName.FaceDetection]) {
      if (await this.jobRepository.isActive(queue)) {
        throw new ConflictException('Refusing while face detection or recognition is running');
      }
    }
  }

  private async buildWarnings(counts: DissolveCounts): Promise<DissolveWarning[]> {
    const warnings: DissolveWarning[] = [];

    if (counts.keep > 0) {
      warnings.push({ code: 'hand-drawn-kept', count: counts.keep });
    }
    if (counts.notRedetectable > 0) {
      warnings.push({ code: 'not-redetectable', count: counts.notRedetectable });
    }
    if (counts.sharedAssets > 0) {
      warnings.push({ code: 'shared-assets', count: counts.sharedAssets });
    }
    if (counts.spacePersonsKept > 0) {
      warnings.push({ code: 'space-persons-kept', count: counts.spacePersonsKept });
    }
    // Imported faces prove the setting was on when the files were imported, NOT that it is on now: read the
    // current setting before telling the admin a re-import will bring them back.
    if (counts.delete > 0) {
      const { metadata } = await this.getConfig({ withCache: true });
      if (metadata.faces.import) {
        warnings.push({ code: 'metadata-import-on', count: counts.delete });
      }
    }
    return warnings;
  }
}
