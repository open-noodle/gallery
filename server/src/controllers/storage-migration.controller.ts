import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Endpoint, HistoryBuilder } from 'src/decorators';
import {
  S3EnableEncryptionStartDto,
  StorageMigrationBatchParamDto,
  StorageMigrationEstimateQueryDto,
  StorageMigrationStartDto,
} from 'src/dtos/storage-migration.dto';
import { ApiTag, Permission } from 'src/enum';
import { Authenticated } from 'src/middleware/auth.guard';
import { StorageMigrationService } from 'src/services/storage-migration.service';

@ApiTags(ApiTag.StorageMigration)
@Controller('storage-migration')
export class StorageMigrationController {
  constructor(private service: StorageMigrationService) {}

  @Get('estimate')
  @Authenticated({ permission: Permission.JobRead, admin: true })
  @Endpoint({
    summary: 'Get storage migration estimate',
    description: 'Estimate the number of files and approximate size that would be migrated for the given direction.',
    history: new HistoryBuilder().added('v2.5.0').alpha('v2.5.0'),
  })
  getEstimate(@Query() { direction }: StorageMigrationEstimateQueryDto) {
    return this.service.getEstimate(direction);
  }

  @Post('start')
  @Authenticated({ permission: Permission.JobCreate, admin: true })
  @Endpoint({
    summary: 'Start storage migration',
    description: 'Start a storage backend migration job to move files between disk and S3 storage.',
    history: new HistoryBuilder().added('v2.5.0').alpha('v2.5.0'),
  })
  start(@Body() dto: StorageMigrationStartDto) {
    return this.service.start(dto);
  }

  @Get('status')
  @Authenticated({ permission: Permission.JobRead, admin: true })
  @Endpoint({
    summary: 'Get storage migration status',
    description: 'Retrieve the current status of the storage migration queue, including active and pending job counts.',
    history: new HistoryBuilder().added('v2.5.0').alpha('v2.5.0'),
  })
  getStatus() {
    return this.service.getStatus();
  }

  @Post('rollback/:batchId')
  @Authenticated({ permission: Permission.JobCreate, admin: true })
  @Endpoint({
    summary: 'Rollback a storage migration batch',
    description: 'Rollback a previously completed storage migration batch by reverting all database path changes.',
    history: new HistoryBuilder().added('v2.5.0').alpha('v2.5.0'),
  })
  rollback(@Param() { batchId }: StorageMigrationBatchParamDto) {
    return this.service.rollback(batchId);
  }

  @Get('s3-encryption/estimate')
  @Authenticated({ permission: Permission.JobRead, admin: true })
  @Endpoint({
    summary: 'Get S3 enable-encryption estimate',
    description:
      'Estimate the number of existing S3 objects that would be re-encrypted in place if S3 encryption ' +
      '(IMMICH_S3_SSE_MODE=sse-c) were enabled now. Only relevant for buckets that already contain ' +
      'unencrypted objects; a fresh bucket needs no migration.',
    history: new HistoryBuilder().added('v2.7.5').alpha('v2.7.5'),
  })
  getS3EncryptionEstimate() {
    return this.service.getS3EncryptionEstimate();
  }

  @Post('s3-encryption/start')
  @Authenticated({ permission: Permission.JobCreate, admin: true })
  @Endpoint({
    summary: 'Start S3 enable-encryption migration',
    description:
      'Re-encrypt existing, currently-unencrypted S3 objects in place using the configured SSE-C key ' +
      '(IMMICH_S3_SSE_C_KEY). Requires IMMICH_S3_SSE_MODE=sse-c to already be configured and the server ' +
      'restarted with that config before starting this job, since the job re-encrypts using whatever key ' +
      'the running S3 backend already holds.',
    history: new HistoryBuilder().added('v2.7.5').alpha('v2.7.5'),
  })
  startS3Encryption(@Body() dto: S3EnableEncryptionStartDto) {
    return this.service.startS3Encryption(dto);
  }

  @Get('s3-encryption/status')
  @Authenticated({ permission: Permission.JobRead, admin: true })
  @Endpoint({
    summary: 'Get S3 enable-encryption migration status',
    description:
      'Retrieve the current status of the S3 enable-encryption queue, including active and pending job counts.',
    history: new HistoryBuilder().added('v2.7.5').alpha('v2.7.5'),
  })
  getS3EncryptionStatus() {
    return this.service.getS3EncryptionStatus();
  }
}
