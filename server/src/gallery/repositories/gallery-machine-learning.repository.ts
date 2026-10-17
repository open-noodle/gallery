import { Injectable } from '@nestjs/common';
import {
  MachineLearningRepository,
  ModelTask,
  ModelType,
  PetDetectionRequest,
  PetDetectionResponse,
} from 'src/repositories/machine-learning.repository.js';

// The fork's ML calls. Registered so it is the one instance behind the MachineLearningRepository token
// (src/gallery/index.ts), which SystemConfigService.setup() configures and whose health checks run once.
@Injectable()
export class GalleryMachineLearningRepository extends MachineLearningRepository {
  async ping(): Promise<{ ok: boolean }> {
    const url = this.config.urls[0];
    if (!url) {
      return { ok: false };
    }
    try {
      const response = await fetch(new URL('ping', url), {
        headers: this.connectionHeaders,
        signal: AbortSignal.timeout(2000),
      });
      return { ok: response.ok };
    } catch {
      return { ok: false };
    }
  }

  async detectPets(
    imagePath: string,
    { modelName, minScore }: { modelName: string; minScore: number },
    recognition?: { modelName: string },
  ) {
    const request: PetDetectionRequest = {
      [ModelTask.PET_DETECTION]: {
        [ModelType.DETECTION]: { modelName, options: { minScore } },
        ...(recognition && { [ModelType.RECOGNITION]: { modelName: recognition.modelName } }),
      },
    };
    const response = await this.predict<PetDetectionResponse>({ imagePath }, request);
    return {
      imageHeight: response.imageHeight,
      imageWidth: response.imageWidth,
      // A missing key (e.g. an older/misbehaving ML service) must not crash the caller's
      // `pets.filter(...)` — an absent response key is treated as "no pets detected".
      pets: response[ModelTask.PET_DETECTION] ?? [],
    };
  }
}
