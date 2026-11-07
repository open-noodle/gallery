import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { OnEvent } from 'src/decorators.js';
import type { AuthDto } from 'src/dtos/auth.dto.js';
import { JobName, Permission } from 'src/enum.js';
import type {
  VideoFaceMergeResponseDto,
  VideoFaceSightingMoveResponseDto,
  VideoFaceSightingSplitResponseDto,
  VideoFaceSightingsResponseDto,
} from 'src/gallery/dtos/video-face.dto.js';
import type { VideoFaceRepository } from 'src/gallery/repositories/video-face.repository.js';
import { videoFaceFrameFolder } from 'src/gallery/utils/video-face-detector.js';
import {
  VIDEO_FACE_LOW_SCORE,
  VIDEO_FACE_SAMPLER_VERSION,
  addSightings,
  detectionAt,
  findSightingAt,
  liveSightings,
  removeSightingAt,
  restoreSightingAt,
  sightingsForPlayer,
  splitSightingAt,
  takeSightingAt,
  type SightingChange,
} from 'src/gallery/utils/video-faces.js';
import { VideoFrameReader } from 'src/gallery/utils/video-frames.js';
import type { ArgOf } from 'src/repositories/event.repository.js';
import type { VideoFaceSighting } from 'src/schema/tables/asset-face-video-frame.table.js';
import { BaseService } from 'src/services/base.service.js';
import { StorageService } from 'src/services/storage.service.js';
import type { ImmichMediaResponse } from 'src/utils/file.js';
import { isFacialRecognitionEnabled } from 'src/utils/misc.js';

type StoredFaceSightings = NonNullable<Awaited<ReturnType<VideoFaceRepository['getSightings']>>>;

/** A sighting as the face's best view: the time and box the face moves to. */
const toBestView = ({ t, x1, y1, x2, y2 }: VideoFaceSighting) => ({
  timeSeconds: t,
  box: { boundingBoxX1: x1, boundingBoxY1: y1, boundingBoxX2: x2, boundingBoxY2: y2 },
});

/** A face's sightings on the player's timeline after a change, its best view moved when the change moved it. */
const playerSightings = (stored: StoredFaceSightings, { sightings, best }: SightingChange) =>
  sightingsForPlayer({ ...stored, sightings, timeSeconds: best ? best.t : stored.timeSeconds });

/** Sightings move only between faces of one video sampled at one frame size, where their boxes mean the same. */
const assertSameFrames = ([first, ...others]: StoredFaceSightings[]) => {
  for (const other of others) {
    if (
      other.assetId !== first.assetId ||
      other.imageWidth !== first.imageWidth ||
      other.imageHeight !== first.imageHeight
    ) {
      throw new BadRequestException('Sightings move only between faces of the same video');
    }
  }
};

/**
 * Video faces sampled across the whole video (specs/2026-10-31-video-face-frames-design.md): frame cleanup on delete,
 * the face-keyed crop the asset viewer shows, and each face's sightings for the assign picker (Phase 2). Detection
 * itself runs inside upstream's face detection job, through VideoFaceDetector. The owner can take a sighting out of a
 * face, bring it back, or move it to a face of its own (Phase 2).
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

  /** The crop of one sighting, cut from a frame extracted from the original at that moment. */
  async getSightingThumbnail(auth: AuthDto, id: string, time: number): Promise<ImmichMediaResponse> {
    const face = await this.getReadableFace(auth, id);
    const stored = await this.videoFaceRepository.getSightings(id);
    const sighting = stored ? findSightingAt(stored, time) : undefined;
    if (!stored || !sighting) {
      throw new NotFoundException();
    }

    const tempDir = await mkdtemp(join(tmpdir(), 'gallery-face-sighting-'));
    try {
      const framePath = join(tempDir, 'frame.jpeg');
      await this.extractFrame(stored.originalPath, sighting.t, framePath);
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

  /**
   * Takes the sighting at `time` out of the face. When it was the best view, the next best becomes it: its frame
   * replaces the face's best frame, the face's box moves to it, and a person shown by this face gets a new thumbnail.
   * The face's only remaining sighting stays.
   */
  async removeSighting(auth: AuthDto, id: string, time: number): Promise<VideoFaceSightingsResponseDto> {
    await this.requireAccess({ auth, permission: Permission.FaceDelete, ids: [id] });
    const stored = await this.videoFaceRepository.getSightings(id);
    const change = stored ? removeSightingAt(stored, time) : undefined;
    if (!stored || !change) {
      throw new NotFoundException();
    }
    if (change === 'last') {
      throw new BadRequestException('A face keeps at least one sighting');
    }

    return this.applySightingChange(id, stored, change);
  }

  /** Brings back a sighting `removeSighting` took out, as the best view again if it was that. */
  async restoreSighting(auth: AuthDto, id: string, time: number): Promise<VideoFaceSightingsResponseDto> {
    await this.requireAccess({ auth, permission: Permission.FaceDelete, ids: [id] });
    const stored = await this.videoFaceRepository.getSightings(id);
    const change = stored ? restoreSightingAt(stored, time) : undefined;
    if (!stored || !change) {
      throw new NotFoundException();
    }

    return this.applySightingChange(id, stored, change);
  }

  /**
   * Moves the sighting at `time` out of the face into a new, unassigned face of its own: a face made by hand, so
   * recognition and re-detection leave it to the user. Its frame is cut from the original at that moment, and its
   * embedding comes from detecting faces in that frame again, when the detector finds the face there. The old face
   * loses the sighting as `removeSighting` takes it out. The face's only remaining sighting stays: moving all of a
   * face is reassigning it.
   */
  async splitSighting(auth: AuthDto, id: string, time: number): Promise<VideoFaceSightingSplitResponseDto> {
    await this.requireAccess({ auth, permission: Permission.FaceDelete, ids: [id] });
    const stored = await this.videoFaceRepository.getSightings(id);
    const split = stored ? splitSightingAt(stored, time) : undefined;
    if (!stored || !split) {
      throw new NotFoundException();
    }
    if (split === 'last') {
      throw new BadRequestException('A face keeps at least one sighting');
    }

    const { sightings, best, moved } = split;
    const faceId = this.cryptoRepository.randomUUID();
    const framePath = join(dirname(stored.framePath), `${faceId}.jpeg`);
    const tempDir = await mkdtemp(join(tmpdir(), 'gallery-face-split-'));
    let embedding: string | undefined;
    try {
      const localFrame = join(tempDir, 'frame.jpeg');
      await this.extractFrame(stored.originalPath, moved.t, localFrame);
      embedding = await this.embeddingAt(localFrame, moved);
      const backend = await this.backendMedia.backendFor(stored.framePath);
      await backend.put(framePath, await readFile(localFrame), { contentType: 'image/jpeg' });
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
    if (best) {
      await this.writeBestFrame(stored, best);
    }

    await this.videoFaceRepository.splitSighting({
      faceId: id,
      sightings,
      best: best && toBestView(best),
      face: {
        id: faceId,
        assetId: stored.assetId,
        imageWidth: stored.imageWidth,
        imageHeight: stored.imageHeight,
        ...toBestView(moved).box,
      },
      frame: {
        faceId,
        path: framePath,
        timeSeconds: moved.t,
        quality: 0,
        sightings: [moved],
        version: VIDEO_FACE_SAMPLER_VERSION,
      },
      embedding,
    });
    if (best) {
      await this.queuePersonThumbnails(id);
    }

    return {
      faceId,
      sightings: sightingsForPlayer({ ...stored, sightings, timeSeconds: best ? best.t : stored.timeSeconds }),
    };
  }

  /**
   * Moves the sighting at `time` into another face of the same video, such as the face of the person it really is. A
   * sighting the target had moved away earlier comes back in place, so moving a moment back undoes the move. The
   * source's last sighting may go too, and the source face with it (`sightings` empty): the person's cover moves to the
   * target. Both faces need face delete access, a sampled frame row, and the same frame size.
   */
  async moveSighting(
    auth: AuthDto,
    id: string,
    { time, toFaceId }: { time: number; toFaceId: string },
  ): Promise<VideoFaceSightingMoveResponseDto> {
    if (id === toFaceId) {
      throw new BadRequestException('A sighting moves to another face');
    }
    await this.requireAccess({ auth, permission: Permission.FaceDelete, ids: [id, toFaceId] });
    const [source, target] = await Promise.all([
      this.videoFaceRepository.getSightings(id),
      this.videoFaceRepository.getSightings(toFaceId),
    ]);
    if (!source || !target) {
      throw new NotFoundException();
    }
    assertSameFrames([source, target]);

    const taken = takeSightingAt(source, time);
    if (!taken) {
      throw new NotFoundException();
    }
    const added = addSightings(target, [taken.moved]);

    if (taken.change?.best) {
      await this.writeBestFrame(source, taken.change.best);
    }
    if (added.best) {
      await this.writeBestFrame(target, added.best);
    }
    const faces = [{ faceId: toFaceId, sightings: added.sightings, best: added.best && toBestView(added.best) }];
    if (taken.change) {
      faces.push({
        faceId: id,
        sightings: taken.change.sightings,
        best: taken.change.best && toBestView(taken.change.best),
      });
    }
    const repointed = await this.videoFaceRepository.moveSightings({
      faces,
      faceId: toFaceId,
      deleteFaceIds: taken.change ? [] : [id],
    });
    if (!taken.change) {
      await this.cleanUpFaces([{ id, framePath: source.framePath }]);
    }
    await this.refreshThumbnails([...(taken.change?.best ? [id] : []), ...(added.best ? [toFaceId] : [])], repointed);

    return {
      sightings: taken.change ? playerSightings(source, taken.change) : [],
      targetSightings: playerSightings(target, added),
    };
  }

  /**
   * Combines faces of one video into one: the face with the most sightings keeps its id and best view and takes every
   * sighting of the others, which are deleted (a person whose cover was one of them moves to the kept face). Faces
   * without a sampled frame row are left as they are. Every face needs face delete access.
   */
  async mergeFaces(auth: AuthDto, faceIds: string[]): Promise<VideoFaceMergeResponseDto> {
    const ids = [...new Set(faceIds)];
    await this.requireAccess({ auth, permission: Permission.FaceDelete, ids });
    const sampled: { id: string; stored: StoredFaceSightings }[] = [];
    for (const id of ids) {
      const stored = await this.videoFaceRepository.getSightings(id);
      if (stored) {
        sampled.push({ id, stored });
      }
    }
    if (sampled.length < 2) {
      throw new BadRequestException('Combining needs two faces sampled from the video');
    }
    assertSameFrames(sampled.map(({ stored }) => stored));

    const [kept, ...merged] = sampled.toSorted(
      (a, b) => liveSightings(b.stored).length - liveSightings(a.stored).length,
    );
    const added = addSightings(
      kept.stored,
      merged.flatMap(({ stored }) => liveSightings(stored)),
    );
    if (added.best) {
      await this.writeBestFrame(kept.stored, added.best);
    }
    const repointed = await this.videoFaceRepository.moveSightings({
      faces: [{ faceId: kept.id, sightings: added.sightings, best: added.best && toBestView(added.best) }],
      faceId: kept.id,
      deleteFaceIds: merged.map(({ id }) => id),
    });
    await this.cleanUpFaces(merged.map(({ id, stored }) => ({ id, framePath: stored.framePath })));
    await this.refreshThumbnails(added.best ? [kept.id] : [], repointed);

    return { faceId: kept.id, sightings: playerSightings(kept.stored, added) };
  }

  /** What deleting a face leaves outside the database: its identity links, as upstream's face delete does, and its frame. */
  private async cleanUpFaces(faces: { id: string; framePath: string }[]) {
    await this.faceIdentityRepository.unlinkFaces(faces.map(({ id }) => id));
    for (const { framePath } of faces) {
      const backend = await this.backendMedia.backendFor(framePath);
      await backend.delete(framePath).catch(() => {});
    }
  }

  /** Person thumbnails cut from a face whose best view moved, and those of people now shown by another face. */
  private async refreshThumbnails(promotedFaceIds: string[], repointed: { ownerId: string; personGroupId: string }[]) {
    const people = [
      ...(promotedFaceIds.length > 0 ? await this.videoFaceRepository.getPeopleRepresentedBy(promotedFaceIds) : []),
      ...repointed,
    ];
    if (people.length > 0) {
      await this.jobRepository.queueAll(people.map((data) => ({ name: JobName.PersonGenerateThumbnail, data })));
    }
  }

  private async applySightingChange(
    id: string,
    stored: StoredFaceSightings,
    { sightings, best }: SightingChange,
  ): Promise<VideoFaceSightingsResponseDto> {
    if (best) {
      await this.writeBestFrame(stored, best);
    }
    await this.videoFaceRepository.setSightings(id, sightings, best && toBestView(best));
    if (best) {
      await this.queuePersonThumbnails(id);
    }

    return {
      sightings: sightingsForPlayer({ ...stored, sightings, timeSeconds: best ? best.t : stored.timeSeconds }),
    };
  }

  /**
   * Cuts the new best view's frame from the original over the face's frame path. Written before the box moves, so the
   * box never points into another moment's frame for longer than the request.
   */
  private async writeBestFrame(stored: StoredFaceSightings, best: VideoFaceSighting) {
    const tempDir = await mkdtemp(join(tmpdir(), 'gallery-face-best-'));
    try {
      const framePath = join(tempDir, 'frame.jpeg');
      await this.extractFrame(stored.originalPath, best.t, framePath);
      const backend = await this.backendMedia.backendFor(stored.framePath);
      await backend.put(stored.framePath, await readFile(framePath), { contentType: 'image/jpeg' });
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  }

  /** A person shown by this face is cut from its best frame, so their thumbnail follows a new best view. */
  private async queuePersonThumbnails(faceId: string) {
    const people = await this.videoFaceRepository.getPeopleRepresentedBy([faceId]);
    if (people.length > 0) {
      await this.jobRepository.queueAll(people.map((data) => ({ name: JobName.PersonGenerateThumbnail, data })));
    }
  }

  /**
   * The embedding of the face at the sighting's box in a frame, from detecting faces in it again; undefined when
   * recognition is off, the service fails, or the detector does not find that face (a small one sampling found in a
   * tile). The new face then has no embedding: it can still be named, but face search does not find it.
   */
  private async embeddingAt(framePath: string, sighting: VideoFaceSighting): Promise<string | undefined> {
    const { machineLearning } = await this.getConfig({ withCache: true });
    if (!isFacialRecognitionEnabled(machineLearning)) {
      return;
    }

    try {
      const { faces } = await this.machineLearningRepository.detectFaces(framePath, {
        ...machineLearning.facialRecognition,
        minScore: Math.min(machineLearning.facialRecognition.minScore, VIDEO_FACE_LOW_SCORE),
      });
      return detectionAt(faces, sighting)?.embedding;
    } catch (error) {
      this.logger.warn(`Could not detect the face moved out at ${sighting.t}s: ${error}`);
      return;
    }
  }

  /**
   * One frame of the original at `t`, the way sampling extracted it, so a sighting's box fits it. The original is read
   * in place (a presigned URL on S3, which ffmpeg reads with range requests), never staged: this runs in a request.
   */
  private async extractFrame(originalPath: string, t: number, framePath: string) {
    const { ffmpeg } = await this.getConfig({ withCache: true });
    const input = await this.backendMedia.getProbeInput(originalPath);
    const { videoStreams } = await this.mediaRepository.probe(input);
    const videoStream = videoStreams[0];
    if (!videoStream) {
      throw new NotFoundException();
    }

    await this.frames.extractFrame(input, framePath, t, { ffmpeg, videoStream });
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
