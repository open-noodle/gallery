import { Injectable, NotFoundException } from '@nestjs/common';
import type { AuthDto } from 'src/dtos/auth.dto.js';
import type { ArgOf } from 'src/repositories/event.repository.js';
import type { ImmichMediaResponse } from 'src/utils/file.js';
import { OnEvent } from 'src/decorators.js';
import { Permission } from 'src/enum.js';
import { videoFaceFrameFolder } from 'src/gallery/utils/video-face-detector.js';
import { BaseService } from 'src/services/base.service.js';
import { StorageService } from 'src/services/storage.service.js';

/**
 * Video faces sampled across the whole video (specs/2026-10-31-video-face-frames-design.md): frame cleanup on delete,
 * and the face-keyed crop the asset viewer shows. Detection itself runs inside upstream's face detection job, through
 * VideoFaceDetector.
 */
@Injectable()
export class VideoFaceService extends BaseService {
  // The cascade has already removed the rows, so the folder is found by its deterministic path, as Spatial Scene
  // finds its depth maps. Deleting a folder that does not exist is a no-op on both backends.
  @OnEvent({ name: 'AssetDelete' })
  async onAssetDelete({ assetId, userId }: ArgOf<'AssetDelete'>) {
    const backend = StorageService.getWriteBackend();
    const folder = videoFaceFrameFolder({ id: assetId, ownerId: userId }, backend);
    try {
      await backend.deletePrefix(`${folder}/`);
    } catch (error) {
      this.logger.warn(`Could not delete the video face frames of asset ${assetId}: ${error}`);
    }
  }

  /** A face crop keyed by face, for faces of any person or none, under the same access check as `GET /faces`. */
  async getFaceThumbnail(auth: AuthDto, id: string): Promise<ImmichMediaResponse> {
    let face;
    try {
      face = await this.personRepository.getFaceByIdOnLiveAsset(id);
    } catch {
      throw new NotFoundException();
    }

    await this.requireAccess({ auth, permission: Permission.AssetRead, ids: [face.assetId] });
    const sourcePath = await this.backendMedia.getFaceThumbnailSource(face);
    if (!sourcePath) {
      throw new NotFoundException();
    }

    return this.backendMedia.generateFaceThumbnailResponse(face, sourcePath);
  }
}
