import { Controller, Get, Next, Param, Query, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { NextFunction, Response } from 'express';
import type { AuthDto } from 'src/dtos/auth.dto.js';
import { Endpoint, HistoryBuilder } from 'src/decorators.js';
import { ApiTag, Permission } from 'src/enum.js';
import { VideoFaceSightingThumbnailDto, VideoFaceSightingsResponseDto } from 'src/gallery/dtos/video-face.dto.js';
import { VideoFaceService } from 'src/gallery/services/video-face.service.js';
import { Auth, Authenticated, FileResponse } from 'src/middleware/auth.guard.js';
import { LoggingRepository } from 'src/repositories/logging.repository.js';
import { sendFile } from 'src/utils/file.js';
import { UUIDParamDto } from 'src/validation.js';

// Mounted before FaceController (see src/gallery/index.ts); upstream has no GET route under `/faces/:id`.
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
