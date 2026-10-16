import { Injectable } from '@nestjs/common';
import type { ArgOf } from 'src/repositories/event.repository.js';
import { OnEvent } from 'src/decorators.js';
import { BaseService } from 'src/services/base.service.js';

@Injectable()
export class GalleryStackService extends BaseService {
  /**
   * Trashing a stack's cover hid the whole stack: the timeline shows a stack through its primary asset, and
   * upstream only promotes a new primary on permanent deletion (`handleAssetDeletion`). Promote the first
   * remaining member when a primary is trashed, the same choice permanent deletion makes (#1187). The stack is
   * kept, so restoring a trashed member puts it back. Every trash path (bulk delete, duplicate resolve,
   * integrity) emits `AssetTrashAll`.
   */
  @OnEvent({ name: 'AssetTrashAll' })
  async onAssetsTrash({ assetIds }: ArgOf<'AssetTrashAll'>): Promise<void> {
    const trashed = new Set(assetIds);
    const assets = await this.assetRepository.getByIds(assetIds);
    const stacked = assets.filter((asset) => asset.stackId);
    const stackIds = new Set<string>();
    for (const asset of stacked) {
      const stack = await this.stackRepository.getForAssetRemoval(asset.id);
      if (stack?.id && stack.primaryAssetId === asset.id) {
        stackIds.add(stack.id);
      }
    }

    for (const stackId of stackIds) {
      const stack = await this.stackRepository.getById(stackId);
      // `assets` lists the members outside the trash, oldest first.
      const nextPrimary = stack?.assets.find((asset) => !trashed.has(asset.id));
      if (stack && nextPrimary) {
        await this.stackRepository.update(stack.id, { id: stack.id, primaryAssetId: nextPrimary.id });
      }
    }
  }
}
