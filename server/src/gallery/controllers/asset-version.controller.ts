import { Controller, Get, Next, Param, Query, Req, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { type NextFunction, type Request, type Response } from 'express';
import { Endpoint, HistoryBuilder } from 'src/decorators.js';
import type { AuthDto } from 'src/dtos/auth.dto.js';
import { ApiTag, Permission, RouteKey } from 'src/enum.js';
import {
  AssetVersionDownloadQueryDto,
  AssetVersionImageQueryDto,
  AssetVersionParamDto,
  AssetVersionsResponseDto,
} from 'src/gallery/dtos/asset-version.dto.js';
import { AssetVersionService } from 'src/gallery/services/asset-version.service.js';
import { Auth, Authenticated, FileResponse } from 'src/middleware/auth.guard.js';
import { LoggingRepository } from 'src/repositories/logging.repository.js';
import { sendFile } from 'src/utils/file.js';
import { UUIDParamDto } from 'src/validation.js';

// Asset versions (specs/2026-11-07-asset-versions-design.md). A version is a hidden asset, reached only through its
// photo: every route checks access to the photo and that the version belongs to it. Read-only: Gallery makes the
// versions itself, and nothing here changes them.
@ApiTags(ApiTag.Assets)
@Controller(RouteKey.Asset)
export class AssetVersionController {
  constructor(
    private service: AssetVersionService,
    private logger: LoggingRepository,
  ) {}

  @Get(':id/versions')
  @Authenticated({ permission: Permission.AssetRead, sharedLink: true })
  @Endpoint({
    summary: 'List the versions of a photo',
    description:
      "Returns the files of the photo's shot, the photo's own file among them (edits newest first, then the original, then the RAW), with the one the photo shows marked, for everyone who can see the photo. Empty when it has none.",
    history: new HistoryBuilder().added('v1').beta('v1'),
  })
  getAssetVersions(@Auth() auth: AuthDto, @Param() { id }: UUIDParamDto): Promise<AssetVersionsResponseDto> {
    return this.service.getVersions(auth, id);
  }

  @Get(':id/versions/:versionId/thumbnail')
  @FileResponse()
  @Authenticated({ permission: Permission.AssetView, sharedLink: true })
  @Endpoint({
    summary: 'View the thumbnail of a version',
    description: "Returns a version's thumbnail or preview, for everyone who can see the photo.",
    history: new HistoryBuilder().added('v1').beta('v1'),
  })
  async viewAssetVersionThumbnail(
    @Auth() auth: AuthDto,
    @Param() { id, versionId }: AssetVersionParamDto,
    @Query() { size }: AssetVersionImageQueryDto,
    @Res() res: Response,
    @Next() next: NextFunction,
  ) {
    await sendFile(res, next, () => this.service.viewImage(auth, id, versionId, size), this.logger);
  }

  @Get(':id/versions/:versionId/original')
  @FileResponse()
  @Authenticated({ permission: Permission.AssetDownload, sharedLink: true })
  @Endpoint({
    summary: 'Download a version',
    description: "Returns a version's file, for everyone who may download the photo. Supports byte range requests.",
    history: new HistoryBuilder().added('v1').beta('v1'),
  })
  async downloadAssetVersion(
    @Auth() auth: AuthDto,
    @Param() { id, versionId }: AssetVersionParamDto,
    @Query() { download = false }: AssetVersionDownloadQueryDto,
    @Req() req: Request,
    @Res() res: Response,
    @Next() next: NextFunction,
  ) {
    await sendFile(
      res,
      next,
      () => this.service.downloadOriginal(auth, id, versionId, download, req.headers.range),
      this.logger,
    );
  }
}
