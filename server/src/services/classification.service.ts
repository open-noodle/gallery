import { Injectable } from '@nestjs/common';
import { OnEvent, OnJob } from 'src/decorators';
import { AuthDto } from 'src/dtos/auth.dto';
import { AssetVisibility, ImmichWorker, JobName, JobStatus, QueueName } from 'src/enum';
import { ArgOf } from 'src/repositories/event.repository';
import { BaseService } from 'src/services/base.service';
import { JobOf } from 'src/types';
import { upsertTags } from 'src/utils/tag';

@Injectable()
export class ClassificationService extends BaseService {
  private embeddingCache = new Map<string, number[]>();
  private pendingEncodes = new Map<string, Promise<number[]>>();

  private async getOrEncodePrompt(prompt: string, modelName: string): Promise<number[]> {
    const key = `${modelName}::${prompt}`;

    const cached = this.embeddingCache.get(key);
    if (cached) {
      return cached;
    }

    const pending = this.pendingEncodes.get(key);
    if (pending) {
      return pending;
    }

    const promise = this.machineLearningRepository
      .encodeText(prompt, { modelName })
      .then((raw) => {
        const embedding = typeof raw === 'string' ? this.parseEmbedding(raw) : (raw as number[]);
        this.embeddingCache.set(key, embedding);
        this.pendingEncodes.delete(key);
        return embedding;
      })
      .catch((error) => {
        this.pendingEncodes.delete(key);
        throw error;
      });

    this.pendingEncodes.set(key, promise);
    return promise;
  }

  async scanLibrary(_auth: AuthDto): Promise<void> {
    await this.jobRepository.queue({
      name: JobName.AssetClassifyQueueAll,
      data: { force: true },
    });
  }

  @OnEvent({ name: 'ConfigUpdate', workers: [ImmichWorker.Microservices], server: true })
  async onConfigUpdate({ oldConfig, newConfig }: ArgOf<'ConfigUpdate'>) {
    const clipChanged = oldConfig.machineLearning.clip.modelName !== newConfig.machineLearning.clip.modelName;
    const classificationChanged = JSON.stringify(oldConfig.classification) !== JSON.stringify(newConfig.classification);

    if (!clipChanged && !classificationChanged) {
      return;
    }

    this.embeddingCache.clear();
    this.pendingEncodes.clear();

    if (classificationChanged) {
      const oldByName = new Map(oldConfig.classification.categories.map((c) => [c.name, c]));
      const newNames = new Set(newConfig.classification.categories.map((c) => c.name));

      for (const [name, oldCategory] of oldByName) {
        if (newNames.has(name)) {
          const newCategory = newConfig.classification.categories.find((c) => c.name === name);
          if (newCategory && newCategory.similarity > oldCategory.similarity) {
            await this.classificationRepository.removeAutoTagAssignments(name);
          }
        } else {
          await this.classificationRepository.removeAutoTagAssignments(name);
        }
      }
    }
  }

  @OnJob({ name: JobName.AssetClassifyQueueAll, queue: QueueName.Classification })
  async handleClassifyQueueAll({ force }: JobOf<JobName.AssetClassifyQueueAll>): Promise<JobStatus> {
    const { classification } = await this.getConfig({ withCache: true });

    if (!classification.enabled) {
      return JobStatus.Skipped;
    }

    if (force) {
      await this.classificationRepository.resetClassifiedAt();
    }

    const stream = this.classificationRepository.streamUnclassifiedAssets();

    let queue: Array<{ name: JobName.AssetClassify; data: { id: string } }> = [];
    for await (const asset of stream) {
      queue.push({ name: JobName.AssetClassify, data: { id: asset.id } });
      if (queue.length >= 1000) {
        await this.jobRepository.queueAll(queue);
        queue = [];
      }
    }

    await this.jobRepository.queueAll(queue);
    return JobStatus.Success;
  }

  @OnJob({ name: JobName.AssetClassify, queue: QueueName.Classification })
  async handleClassify({ id }: { id: string }): Promise<JobStatus> {
    const asset = await this.assetRepository.getById(id);
    if (!asset) {
      return JobStatus.Failed;
    }

    const { classification, machineLearning } = await this.getConfig({ withCache: true });

    if (!classification.enabled) {
      return JobStatus.Skipped;
    }

    const embedding = await this.searchRepository.getEmbedding(id);
    if (!embedding) {
      return JobStatus.Skipped;
    }

    const enabledCategories = classification.categories.filter((c) => c.enabled);
    if (enabledCategories.length === 0) {
      await this.classificationRepository.setClassifiedAt(id);
      return JobStatus.Skipped;
    }

    const assetEmbedding = this.parseEmbedding(embedding);
    let shouldArchive = false;

    for (const category of enabledCategories) {
      let bestSimilarity = -1;
      for (const prompt of category.prompts) {
        const promptEmbedding = await this.getOrEncodePrompt(prompt, machineLearning.clip.modelName);
        const similarity = this.cosineSimilarity(assetEmbedding, promptEmbedding);
        if (similarity > bestSimilarity) {
          bestSimilarity = similarity;
        }
      }

      if (bestSimilarity >= category.similarity) {
        const tags = await upsertTags(this.tagRepository, {
          userId: asset.ownerId,
          tags: [`Auto/${category.name}`],
        });
        const tagId = tags[0].id;
        await this.tagRepository.upsertAssetIds([{ tagId, assetId: id }]);

        if (category.action === 'tag_and_archive') {
          shouldArchive = true;
        }
      }
    }

    if (shouldArchive && asset.visibility === AssetVisibility.Timeline) {
      await this.assetRepository.updateAll([id], { visibility: AssetVisibility.Archive });
    }

    await this.classificationRepository.setClassifiedAt(id);
    return JobStatus.Success;
  }

  private parseEmbedding(raw: string): number[] {
    return raw.replaceAll(/[[\]]/g, '').split(',').map(Number);
  }

  private cosineSimilarity(a: number[], b: number[]): number {
    let dot = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    return dot / (Math.sqrt(normA) * Math.sqrt(normB));
  }
}
