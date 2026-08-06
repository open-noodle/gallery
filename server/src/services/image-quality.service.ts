import { Injectable } from '@nestjs/common';
import { JOBS_ASSET_PAGINATION_SIZE } from 'src/constants';
import { OnJob } from 'src/decorators';
import { AssetVisibility, JobName, JobStatus, QueueName } from 'src/enum';
import { BaseService } from 'src/services/base.service';
import { JobItem, JobOf } from 'src/types';
import { isImageQualityEnabled } from 'src/utils/misc';

@Injectable()
export class ImageQualityService extends BaseService {
  @OnJob({ name: JobName.ImageQualityQueueAll, queue: QueueName.ImageQuality })
  async handleQueueImageQuality({ force }: JobOf<JobName.ImageQualityQueueAll>): Promise<JobStatus> {
    const { machineLearning } = await this.getConfig({ withCache: false });
    if (!isImageQualityEnabled(machineLearning)) {
      return JobStatus.Skipped;
    }

    let jobs: JobItem[] = [];
    const assets = this.assetJobRepository.streamForImageQualityJob(force);
    for await (const asset of assets) {
      jobs.push({ name: JobName.ImageQuality, data: { id: asset.id } });
      if (jobs.length >= JOBS_ASSET_PAGINATION_SIZE) {
        await this.jobRepository.queueAll(jobs);
        jobs = [];
      }
    }
    await this.jobRepository.queueAll(jobs);
    return JobStatus.Success;
  }

  @OnJob({ name: JobName.ImageQuality, queue: QueueName.ImageQuality })
  async handleImageQuality({ id }: JobOf<JobName.ImageQuality>): Promise<JobStatus> {
    const { machineLearning } = await this.getConfig({ withCache: true });
    if (!isImageQualityEnabled(machineLearning)) {
      return JobStatus.Skipped;
    }

    const asset = await this.assetJobRepository.getForImageQuality(id);
    if (!asset || !asset.previewFile) {
      return JobStatus.Failed;
    }
    if (asset.visibility === AssetVisibility.Hidden) {
      return JobStatus.Skipped;
    }

    const { sharpness, exposure, brightness, quality } = await this.machineLearningRepository.analyzeAssetQuality(
      asset.previewFile,
    );
    await this.assetRepository.upsertAssetQuality({ assetId: id, sharpness, exposure, brightness, quality });
    await this.assetRepository.upsertJobStatus({ assetId: id, qualityScoredAt: new Date() });

    return JobStatus.Success;
  }
}
