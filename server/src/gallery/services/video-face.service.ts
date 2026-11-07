import { Injectable, NotFoundException } from '@nestjs/common';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AuthDto } from 'src/dtos/auth.dto.js';
import type { VideoFaceSightingsResponseDto } from 'src/gallery/dtos/video-face.dto.js';
import type { ArgOf } from 'src/repositories/event.repository.js';
import type { ImmichMediaResponse } from 'src/utils/file.js';
import { OnEvent } from 'src/decorators.js';
import { Permission } from 'src/enum.js';
import { videoFaceFrameFolder } from 'src/gallery/utils/video-face-detector.js';
import { findSightingAt, sightingsForPlayer } from 'src/gallery/utils/video-faces.js';
import { VideoFrameReader } from 'src/gallery/utils/video-frames.js';
import { BaseService } from 'src/services/base.service.js';
import { StorageService } from 'src/services/storage.service.js';

/**
 * Video faces sampled across the whole video (specs/2026-10-31-video-face-frames-design.md): frame cleanup on delete,
 * the face-keyed crop the asset viewer shows, and each face's sightings for the assign picker (Phase 2). Detection
 * itself runs inside upstream's face detection job, through VideoFaceDetector.
 */
@Injectable()
export class VideoFaceService extends BaseService {
  private frames = new VideoFrameReader();

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
    const face = await this.getReadableFace(auth, id);
    const sourcePath = await this.backendMedia.getFaceThumbnailSource(face);
    if (!sourcePath) {
      throw new NotFoundException();
    }

    return this.backendMedia.generateFaceThumbnailResponse(face, sourcePath);
  }

  /** Every moment the face's person was seen, on the player's timeline. Empty for a face not sampled from a video. */
  async getSightings(auth: AuthDto, id: string): Promise<VideoFaceSightingsResponseDto> {
    await this.getReadableFace(auth, id);
    const stored = await this.videoFaceRepository.getSightings(id);
    return { sightings: stored ? sightingsForPlayer(stored) : [] };
  }

  /**
   * The crop of one sighting, cut from a frame extracted from the original at that moment. The original is read in
   * place (a presigned URL on S3, which ffmpeg reads with range requests), never staged: this runs in a request.
   */
  async getSightingThumbnail(auth: AuthDto, id: string, time: number): Promise<ImmichMediaResponse> {
    const face = await this.getReadableFace(auth, id);
    const stored = await this.videoFaceRepository.getSightings(id);
    const sighting = stored ? findSightingAt(stored, time) : undefined;
    if (!stored || !sighting) {
      throw new NotFoundException();
    }

    const { ffmpeg } = await this.getConfig({ withCache: true });
    const input = await this.backendMedia.getProbeInput(stored.originalPath);
    const { videoStreams } = await this.mediaRepository.probe(input);
    const videoStream = videoStreams[0];
    if (!videoStream) {
      throw new NotFoundException();
    }

    const tempDir = await mkdtemp(join(tmpdir(), 'gallery-face-sighting-'));
    try {
      const framePath = join(tempDir, 'frame.jpeg');
      await this.frames.extractFrame(input, framePath, sighting.t, { ffmpeg, videoStream });
      // The sighting's box is in the sampled frame's pixels, which the face's imageWidth/imageHeight describe; the crop
      // scales it to the frame just extracted.
      const sightingFace = {
        ...face,
        boundingBoxX1: sighting.x1,
        boundingBoxY1: sighting.y1,
        boundingBoxX2: sighting.x2,
        boundingBoxY2: sighting.y2,
      };
      // The crop is decoded and written before this returns, so the frame can go once it has.
      return await this.backendMedia.generateFaceThumbnailResponse(sightingFace, framePath, { widen: true });
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  }

  /** A face on a live asset the caller can read, under the same access check as `GET /faces`. */
  private async getReadableFace(auth: AuthDto, id: string) {
    let face;
    try {
      face = await this.galleryPersonRepository.getFaceByIdOnLiveAsset(id);
    } catch {
      throw new NotFoundException();
    }

    await this.requireAccess({ auth, permission: Permission.AssetRead, ids: [face.assetId] });
    return face;
  }
}
