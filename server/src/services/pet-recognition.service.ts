import { Injectable } from '@nestjs/common';
import { OnJob } from 'src/decorators';
import { JobName, JobStatus, QueueName } from 'src/enum';
import { BaseService } from 'src/services/base.service';
import { JobOf } from 'src/types';
import { isPetRecognitionEnabled } from 'src/utils/misc';

@Injectable()
export class PetRecognitionService extends BaseService {
  @OnJob({ name: JobName.PetRecognitionQueueAll, queue: QueueName.PetRecognition })
  async handleQueuePetRecognition(_data: JobOf<JobName.PetRecognitionQueueAll>): Promise<JobStatus> {
    const { machineLearning } = await this.getConfig({ withCache: false });
    if (!isPetRecognitionEnabled(machineLearning)) {
      return JobStatus.Skipped;
    }

    // Reprocess-on-force (purge + requeue detection), the nightly skip-if-fresh check, and the
    // fan-out over embedded/unassigned pet faces are implemented in Slice 6 (reprocess, model
    // switch, nightly).
    return JobStatus.Success;
  }

  @OnJob({ name: JobName.PetRecognition, queue: QueueName.PetRecognition })
  async handlePetRecognition(_data: JobOf<JobName.PetRecognition>): Promise<JobStatus> {
    const { machineLearning } = await this.getConfig({ withCache: true });
    if (!isPetRecognitionEnabled(machineLearning)) {
      return JobStatus.Skipped;
    }

    // Clustering (nearest-neighbour search, assign/create person, face_identity linkage,
    // deferred requeue when not core) is implemented in Slice 5 (detect -> embed -> cluster
    // pipeline).
    return JobStatus.Skipped;
  }
}
