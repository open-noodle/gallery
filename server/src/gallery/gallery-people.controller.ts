import { Body, Controller, Get, HttpCode, HttpStatus, Next, Param, Post, Put, Query, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { NextFunction, Response } from 'express';
import type { AuthDto } from 'src/dtos/auth.dto.js';
import { Endpoint, HistoryBuilder } from 'src/decorators.js';
import {
  DetachScopedPersonDto,
  MergeScopedPeopleDto,
  PeopleFaceStatisticsResponseDto,
  PeopleStatisticsResponseDto,
  PersonFacePageQueryDto,
  PersonFacePageResponseDto,
  PersonResponseDto,
  PersonSearchDto,
  RepresentativeFaceUpdateDto,
} from 'src/dtos/person.dto.js';
import { ApiTag, Permission } from 'src/enum.js';
import { GalleryPeopleService } from 'src/gallery/gallery-people.service.js';
import { Auth, Authenticated, FileResponse } from 'src/middleware/auth.guard.js';
import { LoggingRepository } from 'src/repositories/logging.repository.js';
import { sendFile } from 'src/utils/file.js';
import { UUIDParamDto } from 'src/validation.js';

// Mounted before PersonController (see src/gallery/index.ts), so the literal `/people/<segment>` routes here
// match before its `/people/:id`.
@ApiTags(ApiTag.People)
@Controller('people')
export class GalleryPeopleController {
  constructor(
    private service: GalleryPeopleService,
    private logger: LoggingRepository,
  ) {
    this.logger.setContext(GalleryPeopleController.name);
  }

  @Post('same-person')
  @Authenticated({ permission: Permission.PersonMerge })
  @HttpCode(HttpStatus.NO_CONTENT)
  @Endpoint({
    summary: 'Merge scoped people by identity',
    description: 'Mark personal and space people as the same person without exposing raw face identity IDs.',
    history: new HistoryBuilder().added('v2').stable('v2'),
  })
  mergeScopedPeople(@Auth() auth: AuthDto, @Body() dto: MergeScopedPeopleDto): Promise<void> {
    return this.service.mergeScopedPeople(auth, dto);
  }

  @Post('detach-profile')
  @Authenticated({ permission: Permission.PersonMerge })
  @HttpCode(HttpStatus.NO_CONTENT)
  @Endpoint({
    summary: 'Detach a scoped person profile',
    description: 'Separate one personal or space person profile from a grouped person identity.',
    history: new HistoryBuilder().added('v2').stable('v2'),
  })
  detachScopedPerson(@Auth() auth: AuthDto, @Body() dto: DetachScopedPersonDto): Promise<void> {
    return this.service.detachScopedPerson(auth, dto);
  }

  @Get('statistics')
  @Authenticated({ permission: Permission.PersonRead })
  @Endpoint({
    summary: 'Get people statistics',
    description: 'Retrieve people and detected-face counts for the authenticated user people scope.',
    history: new HistoryBuilder().added('v2').stable('v2'),
  })
  getPeopleStatistics(@Auth() auth: AuthDto, @Query() options: PersonSearchDto): Promise<PeopleStatisticsResponseDto> {
    return this.service.getPeopleStatistics(auth, options);
  }

  @Get('face-statistics')
  @Authenticated({ permission: Permission.PersonRead })
  @Endpoint({
    summary: 'Get people face statistics',
    description: 'Retrieve detailed detected-face counts for the authenticated user people scope.',
    history: new HistoryBuilder().added('v2').stable('v2'),
  })
  getPeopleFaceStatistics(
    @Auth() auth: AuthDto,
    @Query() options: PersonSearchDto,
  ): Promise<PeopleFaceStatisticsResponseDto> {
    return this.service.getPeopleFaceStatistics(auth, options);
  }

  @Get(':id/faces')
  @Authenticated({ permission: Permission.PersonRead })
  @Endpoint({
    summary: 'Get person faces',
    description: 'Retrieve detected face crops for a person.',
    history: new HistoryBuilder().added('v2').stable('v2'),
  })
  getPersonFaces(
    @Auth() auth: AuthDto,
    @Param() { id }: UUIDParamDto,
    @Query() dto: PersonFacePageQueryDto,
  ): Promise<PersonFacePageResponseDto> {
    return this.service.getFacesForPicker(auth, id, dto);
  }

  @Get(':id/faces/:faceId/thumbnail')
  @FileResponse()
  @Authenticated({ permission: Permission.PersonRead })
  @Endpoint({
    summary: 'Get person face thumbnail',
    description: 'Retrieve an exact face-crop thumbnail for a person.',
    history: new HistoryBuilder().added('v2').stable('v2'),
  })
  async getPersonFaceThumbnail(
    @Res() res: Response,
    @Next() next: NextFunction,
    @Auth() auth: AuthDto,
    @Param('id') id: string,
    @Param('faceId') faceId: string,
  ) {
    await sendFile(res, next, () => this.service.getFaceThumbnail(auth, id, faceId), this.logger);
  }

  @Put(':id/representative-face')
  @Authenticated({ permission: Permission.PersonUpdate })
  @Endpoint({
    summary: 'Update representative face',
    description: 'Update the exact face crop used as the person thumbnail.',
    history: new HistoryBuilder().added('v2').stable('v2'),
  })
  updateRepresentativeFace(
    @Auth() auth: AuthDto,
    @Param() { id }: UUIDParamDto,
    @Body() dto: RepresentativeFaceUpdateDto,
  ): Promise<PersonResponseDto> {
    return this.service.updateRepresentativeFace(auth, id, dto);
  }
}
