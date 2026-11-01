import { Controller, Get, Next, Param, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { NextFunction, Response } from 'express';
import type { AuthDto } from 'src/dtos/auth.dto.js';
import { Endpoint, HistoryBuilder } from 'src/decorators.js';
import { ApiTag, Permission } from 'src/enum.js';
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
}
