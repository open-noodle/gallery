import {
  Body,
  Controller,
  Delete,
  Get,
  HttpStatus,
  Next,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { ApiResponse, ApiTags } from '@nestjs/swagger';
import { NextFunction, Response } from 'express';
import { Endpoint, HistoryBuilder } from 'src/decorators';
import { AuthDto } from 'src/dtos/auth.dto';
import {
  FaceRepairClusterFacesRequestDto,
  FaceRepairClusterFacesResponseDto,
  FaceRepairDeclineCreatedDto,
  FaceRepairDeclineListDto,
  FaceRepairDeclineRemovedDto,
  FaceRepairDeclineRemoveRequestDto,
  FaceRepairDeclineRequestDto,
  FaceRepairOwnerPeopleQueryDto,
  FaceRepairOwnerPeopleResponseDto,
  FaceRepairOwnerPersonCreatedResponseDto,
  FaceRepairOwnerPersonCreateRequestDto,
  FaceRepairPersonFacesDto,
  FaceRepairPersonMetadataResponseDto,
  FaceRepairRequestDto,
  FaceRepairResolutionsListDto,
  FaceRepairResolutionsQueryDto,
  FaceRepairResolutionsRemovedDto,
  FaceRepairResolutionsRemoveRequestDto,
  FaceRepairResolveRequestDto,
  FaceRepairResolveResponseDto,
  FaceRepairResponseDto,
  FaceRepairScanDefaultsDto,
  FaceRepairScanStatusDto,
  FaceRepairScanTriggerRequestDto,
  FaceRepairScanTriggerResponseDto,
  FaceRepairUnconfirmRequestDto,
} from 'src/dtos/face-repair.dto';
import { ApiTag } from 'src/enum';
import { Auth, Authenticated, FileResponse } from 'src/middleware/auth.guard';
import { LoggingRepository } from 'src/repositories/logging.repository';
import { FaceRepairService } from 'src/services/face-repair.service';
import { sendFile } from 'src/utils/file';

@ApiTags(ApiTag.Faces)
@Controller('admin/face-repair')
export class FaceRepairAdminController {
  constructor(
    private service: FaceRepairService,
    private logger: LoggingRepository,
  ) {}

  @Post()
  @Authenticated({ admin: true })
  @Endpoint({
    summary: 'Run face re-attribution repair',
    history: new HistoryBuilder().added('v1'),
  })
  runFaceRepair(@Body() dto: FaceRepairRequestDto): Promise<FaceRepairResponseDto> {
    return this.service.runRepair(dto) as Promise<FaceRepairResponseDto>;
  }

  @Post('scan')
  @Authenticated({ admin: true })
  @Endpoint({ summary: 'Trigger a face-repair scan', history: new HistoryBuilder().added('v1') })
  triggerScan(
    @Auth() auth: AuthDto,
    @Body() dto: FaceRepairScanTriggerRequestDto,
  ): Promise<FaceRepairScanTriggerResponseDto> {
    return this.service.triggerScan(auth.user.id, dto.params) as Promise<FaceRepairScanTriggerResponseDto>;
  }

  @Get('scan/latest')
  @Authenticated({ admin: true })
  @ApiResponse({ status: 200, description: 'The latest face-repair scan', type: FaceRepairScanStatusDto })
  @ApiResponse({ status: 204, description: 'This instance has never run a face-repair scan' })
  @Endpoint({ summary: 'Get the latest face-repair scan', history: new HistoryBuilder().added('v1') })
  async getLatestScan(@Res({ passthrough: true }) res: Response): Promise<FaceRepairScanStatusDto | undefined> {
    const scan = (await this.service.getLatestScanStatus()) as FaceRepairScanStatusDto | null;
    if (!scan) {
      // A fresh instance has never scanned. Returning `null` made Nest emit a 200 with an empty body and
      // no content-type, which immich-31006's `jsonOnly` fetch guard now rejects as a malformed response —
      // the admin console then rendered its load-error state instead of the first-run empty state.
      // 204 is the honest representation of "no scan yet", and the guard passes it through untouched.
      res.status(HttpStatus.NO_CONTENT);
      return;
    }
    return scan;
  }

  @Get('scan/defaults')
  @Authenticated({ admin: true })
  @Endpoint({ summary: 'Get effective face-repair scan defaults', history: new HistoryBuilder().added('v1') })
  getFaceRepairScanDefaults(): Promise<FaceRepairScanDefaultsDto> {
    return this.service.getScanDefaults() as Promise<FaceRepairScanDefaultsDto>;
  }

  @Get('scan/person/:personId')
  @Authenticated({ admin: true })
  @Endpoint({ summary: "Get a person's flagged faces for review", history: new HistoryBuilder().added('v1') })
  getFaceRepairPersonFaces(
    @Param('personId', new ParseUUIDPipe({ version: '4' })) personId: string,
  ): Promise<FaceRepairPersonFacesDto> {
    return this.service.getPersonFlaggedFaces(personId) as Promise<FaceRepairPersonFacesDto>;
  }

  @Post('scan/person/:personId/cluster-faces')
  @Authenticated({ admin: true })
  @Endpoint({
    summary: "List a person's cluster faces (paginated, excluding the supplied flagged ids)",
    history: new HistoryBuilder().added('v1'),
  })
  getFaceRepairClusterFaces(
    @Param('personId', new ParseUUIDPipe({ version: '4' })) personId: string,
    @Body() dto: FaceRepairClusterFacesRequestDto,
  ): Promise<FaceRepairClusterFacesResponseDto> {
    return this.service.getClusterFaces(personId, dto) as Promise<FaceRepairClusterFacesResponseDto>;
  }

  // Slice 3 (manual face review): the manual review page has no scan to read personName/ownerId off. Does not
  // collide with `scan/person/:personId` above — the two routes have different literal prefixes
  // (`scan/person/...` vs `person/...`), so route order doesn't matter here.
  @Get('person/:personId')
  @Authenticated({ admin: true })
  @Endpoint({ summary: 'Get a person for manual review', history: new HistoryBuilder().added('v1') })
  getFaceRepairPersonMetadata(
    @Param('personId', new ParseUUIDPipe({ version: '4' })) personId: string,
  ): Promise<FaceRepairPersonMetadataResponseDto> {
    return this.service.getPersonMetadata(personId) as Promise<FaceRepairPersonMetadataResponseDto>;
  }

  @Post('resolve')
  @Authenticated({ admin: true })
  @Endpoint({ summary: 'Resolve reviewed faces', history: new HistoryBuilder().added('v1') })
  resolveFaces(@Auth() auth: AuthDto, @Body() dto: FaceRepairResolveRequestDto): Promise<FaceRepairResolveResponseDto> {
    return this.service.resolveFaces(dto, auth.user.id) as Promise<FaceRepairResolveResponseDto>;
  }

  @Post('decline')
  @Authenticated({ admin: true })
  @Endpoint({ summary: 'Decline flagged faces / dismiss flagged persons', history: new HistoryBuilder().added('v1') })
  declineFaceRepair(
    @Auth() auth: AuthDto,
    @Body() dto: FaceRepairDeclineRequestDto,
  ): Promise<FaceRepairDeclineCreatedDto> {
    return this.service.createDeclines({ ...dto, declinedBy: auth.user.id }) as Promise<FaceRepairDeclineCreatedDto>;
  }

  @Get('decline')
  @Authenticated({ admin: true })
  @Endpoint({ summary: 'List face-repair declines', history: new HistoryBuilder().added('v1') })
  getFaceRepairDeclines(): Promise<FaceRepairDeclineListDto> {
    return this.service.listDeclines() as unknown as Promise<FaceRepairDeclineListDto>;
  }

  @Delete('decline')
  @Authenticated({ admin: true })
  @Endpoint({ summary: 'Remove face-repair declines', history: new HistoryBuilder().added('v1') })
  removeFaceRepairDeclines(@Body() dto: FaceRepairDeclineRemoveRequestDto): Promise<FaceRepairDeclineRemovedDto> {
    return this.service.removeDeclines(dto) as Promise<FaceRepairDeclineRemovedDto>;
  }

  // Slice 7 (unified resolutions manage page): lists every soft-decline AND lock, each tagged `kind`, replacing
  // the declines-only `GET /decline` page. The old decline list/remove routes below are kept for now — the web
  // still uses them until the resolutions page dispatch migrates off them.
  // S11 (F23): unscoped (no owner/person filter) — paginated so a large instance's resolutions list does not
  // return every outstanding verdict in one response. See FaceRepairService.listResolutions.
  @Get('resolutions')
  @Authenticated({ admin: true })
  @Endpoint({
    summary: 'List face-repair resolutions (negative verdicts from both engines)',
    history: new HistoryBuilder().added('v1'),
  })
  getFaceRepairResolutions(@Query() dto: FaceRepairResolutionsQueryDto): Promise<FaceRepairResolutionsListDto> {
    return this.service.listResolutions(dto);
  }

  @Post('resolutions/remove')
  @Authenticated({ admin: true })
  @Endpoint({ summary: 'Remove face-repair resolutions (undo)', history: new HistoryBuilder().added('v1') })
  removeFaceRepairResolutions(
    @Body() dto: FaceRepairResolutionsRemoveRequestDto,
  ): Promise<FaceRepairResolutionsRemovedDto> {
    return this.service.removeResolutions(dto) as Promise<FaceRepairResolutionsRemovedDto>;
  }

  @Post('unconfirm')
  @Authenticated({ admin: true })
  @Endpoint({
    summary: 'Un-confirm human-placed faces so a re-scan may flag them again',
    history: new HistoryBuilder().added('v1'),
  })
  unconfirmFaceRepairFaces(@Body() dto: FaceRepairUnconfirmRequestDto): Promise<FaceRepairResolutionsRemovedDto> {
    return this.service.unconfirmFaces(dto.assetFaceIds) as Promise<FaceRepairResolutionsRemovedDto>;
  }

  @Get('owner/:ownerId/people')
  @Authenticated({ admin: true })
  @Endpoint({
    summary: "Search an owner's people for the move-to-chosen-person picker",
    history: new HistoryBuilder().added('v1'),
  })
  getFaceRepairOwnerPeople(
    @Param('ownerId', new ParseUUIDPipe({ version: '4' })) ownerId: string,
    @Query() dto: FaceRepairOwnerPeopleQueryDto,
  ): Promise<FaceRepairOwnerPeopleResponseDto> {
    return this.service.searchOwnerPeople(ownerId, dto) as Promise<FaceRepairOwnerPeopleResponseDto>;
  }

  @Post('owner/:ownerId/people')
  @Authenticated({ admin: true })
  @Endpoint({
    summary: 'Create a person under an owner for the move-to-chosen-person picker',
    history: new HistoryBuilder().added('v1'),
  })
  createFaceRepairOwnerPerson(
    @Param('ownerId', new ParseUUIDPipe({ version: '4' })) ownerId: string,
    @Body() dto: FaceRepairOwnerPersonCreateRequestDto,
  ): Promise<FaceRepairOwnerPersonCreatedResponseDto> {
    return this.service.createOwnerPerson(ownerId, dto.name) as Promise<FaceRepairOwnerPersonCreatedResponseDto>;
  }

  // Slice 7 (D7): face-keyed, join-free, admin-gated thumbnail. Admin cleanup + resolutions surfaces render
  // face crops for clusters the admin does not own — the person-scoped `/people/.../thumbnail` route 404s or
  // 403s for those. No `requireAccess`: the whole controller is admin-only by design.
  @Get('faces/:assetFaceId/thumbnail')
  @FileResponse()
  @Authenticated({ admin: true })
  @Endpoint({ summary: 'Get an admin face-repair face thumbnail', history: new HistoryBuilder().added('v1') })
  async getFaceRepairFaceThumbnail(
    @Res() res: Response,
    @Next() next: NextFunction,
    @Param('assetFaceId', new ParseUUIDPipe({ version: '4' })) assetFaceId: string,
  ): Promise<void> {
    await sendFile(res, next, () => this.service.getAdminFaceThumbnail(assetFaceId), this.logger);
  }
}
