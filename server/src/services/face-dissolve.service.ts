import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { DissolveRequest, DissolveResponse, DissolveWarning, PeopleHealthQuery } from 'src/dtos/face-dissolve.dto';
import { JobName, QueueName } from 'src/enum';
import { DissolveCounts, PersonHealthRow } from 'src/repositories/face-dissolve.repository';
import { BaseService } from 'src/services/base.service';

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
    this.validate(dto);

    const counts = await this.faceDissolveRepository.getCounts(personId, dto.scope);
    return {
      personId: person.id,
      counts,
      expectedFaceCount: counts.faces,
      warnings: await this.buildWarnings(dto, counts),
    };
  }

  async apply(personId: string, dto: DissolveRequest): Promise<DissolveResponse> {
    const person = await this.requirePerson(personId);
    this.validate(dto);

    // L13 — mirrors triggerScan's refusal at face-repair.service.ts:573.
    if (await this.jobRepository.isActive(QueueName.FacialRecognition)) {
      throw new ConflictException('Refusing to dissolve while facial recognition is active');
    }

    const counts = await this.faceDissolveRepository.getCounts(personId, dto.scope);
    if (counts.faces !== dto.expectedFaceCount) {
      throw new ConflictException('The faces changed since the preview. Review the preview again.');
    }

    const result = await this.faceDissolveRepository.dissolve({
      personId,
      scope: dto.scope,
      outcome: dto.outcome,
      redetect: dto.redetect,
    });

    if (result.deletedThumbnailPath) {
      await this.jobRepository.queue({ name: JobName.FileDelete, data: { files: [result.deletedThumbnailPath] } });
    }

    // person.faceAssetId was SET NULL by the cascade; only a surviving person needs a new thumbnail.
    if (dto.outcome !== 'delete-faces-and-person') {
      await this.jobRepository.queue({ name: JobName.PersonGenerateThumbnail, data: { id: personId } });
    }

    // The repair. NOT PersonCleanup (L2), NOT deleteUnreferencedIdentities (L5),
    // NOT deleteAllOrphanedPersons (L1) — all three are unscoped.
    if (dto.redetect) {
      await this.jobRepository.queue({ name: JobName.AssetDetectFacesQueueAll, data: { force: false } });
    }

    this.logger.log(
      `Dissolved person ${personId} (${person.name}): ${result.faces} faces, ` +
        `${result.assetsCleared} assets requeued, outcome=${dto.outcome}, scope=${dto.scope}`,
    );

    return { personId, counts, expectedFaceCount: counts.faces, warnings: await this.buildWarnings(dto, counts) };
  }

  private async requirePerson(personId: string) {
    const person = await this.personRepository.getById(personId);
    if (!person) {
      throw new NotFoundException('Person not found');
    }
    // Pet re-detection is a separate pipeline; clearing facesRecognizedAt would not repair a pet (L6).
    if (person.type === 'pet') {
      throw new BadRequestException('Pets cannot be dissolved');
    }
    return person;
  }

  private validate(dto: DissolveRequest) {
    if (dto.outcome !== 'unassign' && !dto.redetect) {
      throw new BadRequestException('Deleting faces always re-detects the affected photos');
    }
  }

  private async buildWarnings(dto: DissolveRequest, counts: DissolveCounts): Promise<DissolveWarning[]> {
    const warnings: DissolveWarning[] = [];
    const strandable = counts.exif + counts.mlWithoutEmbedding;

    if (dto.outcome === 'unassign' && strandable > 0) {
      warnings.push({ code: 'strands-faces', count: strandable });
    }
    if (dto.outcome === 'unassign' && counts.mlWithEmbedding > 0) {
      warnings.push({ code: 'recluster-similar', count: counts.mlWithEmbedding });
    }
    // "Unassign only" reads as the least destructive choice, but it leaves the person faceless and the
    // nightly PersonCleanup deletes a faceless person on its own schedule. We never queue that job (L2) —
    // which is exactly why the admin must be told it will still happen.
    if (dto.outcome === 'unassign' && counts.faces > 0 && counts.remainingLiveFaces === 0) {
      warnings.push({ code: 'person-will-be-cleaned-up', count: 0 });
    }
    if (dto.redetect && counts.notRedetectable > 0) {
      warnings.push({ code: 'not-redetectable', count: counts.notRedetectable });
    }
    if (dto.redetect && counts.sharedAssets > 0) {
      warnings.push({ code: 'shared-assets', count: counts.sharedAssets });
    }
    // EXIF faces prove the setting was on when the files were imported, NOT that it is on now. The copy is a
    // factual claim about the current setting, so read the current setting: telling an admin who already
    // turned it off that it is on, on the panel guarding an irreversible delete, is a lie in ten languages.
    if (counts.exif > 0) {
      const { metadata } = await this.getConfig({ withCache: true });
      if (metadata.faces.import) {
        warnings.push({ code: 'metadata-import-on', count: counts.exif });
      }
    }
    return warnings;
  }
}
