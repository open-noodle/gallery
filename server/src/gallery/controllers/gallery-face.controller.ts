import { Controller, Delete, Get, HttpCode, HttpStatus, Next, Param, Post, Query, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { NextFunction, Response } from 'express';
import type { AuthDto } from 'src/dtos/auth.dto.js';
import { Endpoint, HistoryBuilder } from 'src/decorators.js';
import { ApiTag, Permission } from 'src/enum.js';
import {
  VideoFaceSightingSplitResponseDto,
  VideoFaceSightingThumbnailDto,
  VideoFaceSightingTimeDto,
  VideoFaceSightingsResponseDto,
} from 'src/gallery/dtos/video-face.dto.js';
import { VideoFaceService } from 'src/gallery/services/video-face.service.js';
import { Auth, Authenticated, FileResponse } from 'src/middleware/auth.guard.js';
import { LoggingRepository } from 'src/repositories/logging.repository.js';
import { sendFile } from 'src/utils/file.js';
import { UUIDParamDto } from 'src/validation.js';

// Mounted before FaceController (see src/gallery/index.ts); upstream has no route under `/faces/:id/` and no GET under
// `/faces/:id`.
@ApiTags(ApiTag.Faces)
@Controller('faces')
export class GalleryFaceController {
  constructor(
    private service: VideoFaceService,
    private logger: LoggingRepository,
  ) {
    this.logger.setContext(GalleryFaceController.name);
  }

  @Get(':id/thumbnail')
  @FileResponse()
  @Authenticated({ permission: Permission.FaceRead })
  @Endpoint({
    summary: 'Get face thumbnail',
    description: 'Retrieve a crop of one face. A video face sampled across the whole video is cut from its best frame.',
    history: new HistoryBuilder().added('v2').stable('v2'),
  })
  async getAssetFaceThumbnail(
    @Res() res: Response,
    @Next() next: NextFunction,
    @Auth() auth: AuthDto,
    @Param() { id }: UUIDParamDto,
  ) {
    await sendFile(res, next, () => this.service.getFaceThumbnail(auth, id), this.logger);
  }

  @Get(':id/sightings')
  @Authenticated({ permission: Permission.FaceRead })
  @Endpoint({
    summary: 'Get face sightings',
    description:
      'Every moment a video face was seen while the video was sampled, on the player timeline. Empty for a photo face or a video face detected on the poster only.',
    history: new HistoryBuilder().added('v2').stable('v2'),
  })
  getAssetFaceSightings(@Auth() auth: AuthDto, @Param() { id }: UUIDParamDto): Promise<VideoFaceSightingsResponseDto> {
    return this.service.getSightings(auth, id);
  }

  @Delete(':id/sightings')
  @Authenticated({ permission: Permission.FaceDelete })
  @Endpoint({
    summary: 'Remove a face sighting',
    description:
      'Take one moment out of a video face, at a time GET /faces/{id}/sightings returned. Removing the best view makes the next best one it, which moves the face crop. A face keeps at least one sighting. Returns the sightings left.',
    history: new HistoryBuilder().added('v2').stable('v2'),
  })
  removeAssetFaceSighting(
    @Auth() auth: AuthDto,
    @Param() { id }: UUIDParamDto,
    @Query() { time }: VideoFaceSightingTimeDto,
  ): Promise<VideoFaceSightingsResponseDto> {
    return this.service.removeSighting(auth, id, time);
  }

  @Post(':id/sightings/restore')
  @HttpCode(HttpStatus.OK)
  @Authenticated({ permission: Permission.FaceDelete })
  @Endpoint({
    summary: 'Restore a face sighting',
    description:
      'Bring back a moment DELETE /faces/{id}/sightings removed, as the best view again if it was that. Returns the sightings.',
    history: new HistoryBuilder().added('v2').stable('v2'),
  })
  restoreAssetFaceSighting(
    @Auth() auth: AuthDto,
    @Param() { id }: UUIDParamDto,
    @Query() { time }: VideoFaceSightingTimeDto,
  ): Promise<VideoFaceSightingsResponseDto> {
    return this.service.restoreSighting(auth, id, time);
  }

  @Post(':id/sightings/split')
  @HttpCode(HttpStatus.OK)
  @Authenticated({ permission: Permission.FaceDelete })
  @Endpoint({
    summary: 'Move a face sighting to a new face',
    description:
      'Move one moment out of a video face into a new, unassigned face of its own, at a time GET /faces/{id}/sightings returned; name it with PUT /faces/{id}. Moving the best view makes the next best one it. A face keeps at least one sighting. Undo by deleting the new face and restoring the sighting.',
    history: new HistoryBuilder().added('v2').stable('v2'),
  })
  splitAssetFaceSighting(
    @Auth() auth: AuthDto,
    @Param() { id }: UUIDParamDto,
    @Query() { time }: VideoFaceSightingTimeDto,
  ): Promise<VideoFaceSightingSplitResponseDto> {
    return this.service.splitSighting(auth, id, time);
  }

  @Get(':id/sightings/thumbnail')
  @FileResponse()
  @Authenticated({ permission: Permission.FaceRead })
  @Endpoint({
    summary: 'Get face sighting thumbnail',
    description: 'Retrieve a crop of one sighting of a video face, at a time GET /faces/{id}/sightings returned.',
    history: new HistoryBuilder().added('v2').stable('v2'),
  })
  async getAssetFaceSightingThumbnail(
    @Res() res: Response,
    @Next() next: NextFunction,
    @Auth() auth: AuthDto,
    @Param() { id }: UUIDParamDto,
    @Query() { time }: VideoFaceSightingThumbnailDto,
  ) {
    await sendFile(res, next, () => this.service.getSightingThumbnail(auth, id, time), this.logger);
  }
}
