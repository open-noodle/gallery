import { ApiProperty } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsPositive,
  IsString,
  IsUrl,
  Max,
  Min,
  Validate,
  ValidateIf,
  ValidateNested,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';
import { SystemConfig } from 'src/config';
import {
  CLIPConfigSchema,
  DuplicateDetectionConfigSchema,
  FacialRecognitionConfigSchema,
  OcrConfigSchema,
  PetDetectionConfigSchema,
} from 'src/dtos/model-config.dto';
import {
  AudioCodecSchema,
  ColorspaceSchema,
  CQModeSchema,
  ImageFormatSchema,
  LogLevelSchema,
  OAuthTokenEndpointAuthMethodSchema,
  ToneMappingSchema,
  TranscodeHardwareAccelerationSchema,
  TranscodePolicySchema,
  VideoCodecSchema,
  VideoContainerSchema,
} from 'src/enum';
import { isValidTime } from 'src/validation';
import z from 'zod';

/** Coerces 'true'/'false' strings to boolean, but also allows booleans. */
const configBool = z
  .preprocess((val) => {
    if (val === 'true') {
      return true;
    }
    if (val === 'false') {
      return false;
    }
    return val;
  }, z.boolean())
  .meta({ type: 'boolean' });

const JobSettingsSchema = z
  .object({
    concurrency: z.int().min(1).describe('Concurrency'),
  })
  .meta({ id: 'JobSettingsDto' });

const cronExpressionSchema = z
  .string()
  .regex(/(((\d+,)+\d+|(\d+(\/|-)\d+)|\d+|\*) ?){5,7}/, 'Invalid cron expression')
  .describe('Cron expression');

const DatabaseBackupSchema = z
  .object({
    enabled: configBool.describe('Enabled'),
    cronExpression: cronExpressionSchema,
    keepLastAmount: z.int().min(1).describe('Keep last amount'),
  })
  .meta({ id: 'DatabaseBackupConfig' });

const SystemConfigBackupsSchema = z.object({ database: DatabaseBackupSchema }).meta({ id: 'SystemConfigBackupsDto' });

const SystemConfigFFmpegSchema = z
  .object({
    crf: z.coerce.number().int().min(0).max(51).describe('CRF'),
    threads: z.coerce.number().int().min(0).describe('Threads'),
    preset: z.string().describe('Preset'),
    targetVideoCodec: VideoCodecSchema,
    acceptedVideoCodecs: z.array(VideoCodecSchema).describe('Accepted video codecs'),
    targetAudioCodec: AudioCodecSchema,
    acceptedAudioCodecs: z.array(AudioCodecSchema).describe('Accepted audio codecs'),
    acceptedContainers: z.array(VideoContainerSchema).describe('Accepted containers'),
    targetResolution: z.string().describe('Target resolution'),
    maxBitrate: z.string().describe('Max bitrate'),
    bframes: z.coerce.number().int().min(-1).max(16).describe('B-frames'),
    refs: z.coerce.number().int().min(0).max(6).describe('References'),
    gopSize: z.coerce.number().int().min(0).describe('GOP size'),
    temporalAQ: configBool.describe('Temporal AQ'),
    cqMode: CQModeSchema,
    twoPass: configBool.describe('Two pass'),
    preferredHwDevice: z.string().describe('Preferred hardware device'),
    transcode: TranscodePolicySchema,
    accel: TranscodeHardwareAccelerationSchema,
    accelDecode: configBool.describe('Accelerated decode'),
    tonemap: ToneMappingSchema,
  })
  .meta({ id: 'SystemConfigFFmpegDto' });

const SystemConfigJobSchema = z
  .object({
    thumbnailGeneration: JobSettingsSchema,
    metadataExtraction: JobSettingsSchema,
    videoConversion: JobSettingsSchema,
    faceDetection: JobSettingsSchema,
    smartSearch: JobSettingsSchema,
    backgroundTask: JobSettingsSchema,
    migration: JobSettingsSchema,
    search: JobSettingsSchema,
    sidecar: JobSettingsSchema,
    library: JobSettingsSchema,
    notifications: JobSettingsSchema,
    ocr: JobSettingsSchema,
    petDetection: JobSettingsSchema,
    workflow: JobSettingsSchema,
    editor: JobSettingsSchema,
    storageBackendMigration: JobSettingsSchema,
    classification: JobSettingsSchema,
  })
  .meta({ id: 'SystemConfigJobDto' });

const SystemConfigLibraryScanSchema = z
  .object({
    enabled: configBool.describe('Enabled'),
    cronExpression: cronExpressionSchema,
  })
  .meta({ id: 'SystemConfigLibraryScanDto' });

const SystemConfigLibraryWatchSchema = z
  .object({ enabled: configBool.describe('Enabled') })
  .meta({ id: 'SystemConfigLibraryWatchDto' });

const SystemConfigLibrarySchema = z
  .object({ scan: SystemConfigLibraryScanSchema, watch: SystemConfigLibraryWatchSchema })
  .meta({ id: 'SystemConfigLibraryDto' });

const SystemConfigLoggingSchema = z
  .object({
    enabled: configBool.describe('Enabled'),
    level: LogLevelSchema,
  })
  .meta({ id: 'SystemConfigLoggingDto' });

const MachineLearningAvailabilityChecksSchema = z
  .object({
    enabled: configBool.describe('Enabled'),
    timeout: z.int(),
    interval: z.int(),
  })
  .meta({ id: 'MachineLearningAvailabilityChecksDto' });

const SystemConfigMachineLearningSchema = z
  .object({
    enabled: configBool.describe('Enabled'),
    urls: z.array(z.string()).min(1).describe('ML service URLs'),
    availabilityChecks: MachineLearningAvailabilityChecksSchema,
    clip: CLIPConfigSchema,
    duplicateDetection: DuplicateDetectionConfigSchema,
    facialRecognition: FacialRecognitionConfigSchema,
    ocr: OcrConfigSchema,
    petDetection: PetDetectionConfigSchema,
  })
  .meta({ id: 'SystemConfigMachineLearningDto' });

const SystemConfigMapSchema = z
  .object({
    enabled: configBool.describe('Enabled'),
    lightStyle: z.url().describe('Light map style URL'),
    darkStyle: z.url().describe('Dark map style URL'),
  })
  .meta({ id: 'SystemConfigMapDto' });

const SystemConfigNewVersionCheckSchema = z
  .object({ enabled: configBool.describe('Enabled') })
  .meta({ id: 'SystemConfigNewVersionCheckDto' });

const SystemConfigNightlyTasksSchema = z
  .object({
    startTime: isValidTime.describe('Start time'),
    databaseCleanup: configBool.describe('Database cleanup'),
    missingThumbnails: configBool.describe('Missing thumbnails'),
    clusterNewFaces: configBool.describe('Cluster new faces'),
    generateMemories: configBool.describe('Generate memories'),
    syncQuotaUsage: configBool.describe('Sync quota usage'),
  })
  .meta({ id: 'SystemConfigNightlyTasksDto' });

const SystemConfigOAuthSchema = z
  .object({
    autoLaunch: configBool.describe('Auto launch'),
    autoRegister: configBool.describe('Auto register'),
    buttonText: z.string().describe('Button text'),
    clientId: z.string().describe('Client ID'),
    clientSecret: z.string().describe('Client secret'),
    tokenEndpointAuthMethod: OAuthTokenEndpointAuthMethodSchema,
    timeout: z.int().min(1).describe('Timeout'),
    allowInsecureRequests: configBool.describe('Allow insecure requests'),
    defaultStorageQuota: z.int().min(0).nullable().describe('Default storage quota'),
    enabled: configBool.describe('Enabled'),
    issuerUrl: z
      .string()
      .refine((url) => url.length === 0 || z.url().safeParse(url).success, {
        error: 'Issuer URL must be an empty string or a valid URL',
      })
      .describe('Issuer URL'),
    scope: z.string().describe('Scope'),
    prompt: z.string().describe('OAuth prompt parameter (e.g. select_account, login, consent)'),
    endSessionEndpoint: z
      .string()
      .refine((url) => url.length === 0 || z.url().safeParse(url).success, {
        error: 'endSessionEndpoint must be an empty string or a valid URL',
      })
      .describe('End session endpoint'),
    signingAlgorithm: z.string().describe('Signing algorithm'),
    profileSigningAlgorithm: z.string().describe('Profile signing algorithm'),
    storageLabelClaim: z.string().describe('Storage label claim'),
    storageQuotaClaim: z.string().describe('Storage quota claim'),
    roleClaim: z.string().describe('Role claim'),
    mobileOverrideEnabled: configBool.describe('Mobile override enabled'),
    mobileRedirectUri: z.string().describe('Mobile redirect URI (set to empty string to disable)'),
  })
  .transform((value, ctx) => {
    if (!value.mobileOverrideEnabled || value.mobileRedirectUri === '') {
      return value;
    }

    if (!z.url().safeParse(value.mobileRedirectUri).success) {
      ctx.issues.push({
        code: 'custom',
        message: 'Mobile redirect URI must be an empty string or a valid URL',
        input: value.mobileRedirectUri,
      });
      return z.NEVER;
    }

    return value;
  })
  .meta({
    id: 'SystemConfigOAuthDto',
  });

const SystemConfigPasswordLoginSchema = z
  .object({ enabled: configBool.describe('Enabled') })
  .meta({ id: 'SystemConfigPasswordLoginDto' });

const SystemConfigReverseGeocodingSchema = z
  .object({ enabled: configBool.describe('Enabled') })
  .meta({ id: 'SystemConfigReverseGeocodingDto' });

const SystemConfigFacesSchema = z
  .object({ import: configBool.describe('Import') })
  .meta({ id: 'SystemConfigFacesDto' });
const SystemConfigMetadataSchema = z.object({ faces: SystemConfigFacesSchema }).meta({ id: 'SystemConfigMetadataDto' });

const SystemConfigServerSchema = z
  .object({
    externalDomain: z
      .string()
      .refine((url) => url.length === 0 || z.url().safeParse(url).success, {
        error: 'External domain must be an empty string or a valid URL',
      })
      .describe('External domain'),
    loginPageMessage: z.string().describe('Login page message'),
    publicUsers: configBool.describe('Public users'),
  })
  .meta({ id: 'SystemConfigServerDto' });

const SystemConfigSmtpTransportSchema = z
  .object({
    ignoreCert: configBool.describe('Whether to ignore SSL certificate errors'),
    host: z.string().describe('SMTP server hostname'),
    port: z.int().min(0).max(65_535).describe('SMTP server port'),
    secure: configBool.describe('Whether to use secure connection (TLS/SSL)'),
    username: z.string().describe('SMTP username'),
    password: z.string().describe('SMTP password'),
  })
  tokenEndpointAuthMethod!: OAuthTokenEndpointAuthMethod;

  @IsInt()
  @IsPositive()
  @Optional()
  @ApiProperty({ type: 'integer', description: 'Timeout' })
  timeout!: number;

  @IsNumber()
  @Min(0)
  @Optional({ nullable: true })
  @ApiProperty({ type: 'integer', format: 'int64', description: 'Default storage quota' })
  defaultStorageQuota!: number | null;

  @ValidateBoolean({ description: 'Enabled' })
  enabled!: boolean;

  @ValidateIf(isOAuthEnabled)
  @IsNotEmpty()
  @IsString()
  @ApiProperty({ description: 'Issuer URL' })
  issuerUrl!: string;

  @ValidateBoolean({ description: 'Mobile override enabled' })
  mobileOverrideEnabled!: boolean;

  @ValidateIf(isOAuthOverrideEnabled)
  @IsUrl()
  @ApiProperty({ description: 'Mobile redirect URI' })
  mobileRedirectUri!: string;

  @IsString()
  @ApiProperty({ description: 'Scope' })
  scope!: string;

  @IsString()
  @IsNotEmpty()
  signingAlgorithm!: string;

  @IsString()
  @IsNotEmpty()
  @ApiProperty({ description: 'Profile signing algorithm' })
  profileSigningAlgorithm!: string;

  @IsString()
  @ApiProperty({ description: 'Storage label claim' })
  storageLabelClaim!: string;

  @IsString()
  @ApiProperty({ description: 'Storage quota claim' })
  storageQuotaClaim!: string;

  @IsString()
  @ApiProperty({ description: 'Role claim' })
  roleClaim!: string;
}

class SystemConfigPasswordLoginDto {
  @ValidateBoolean({ description: 'Enabled' })
  enabled!: boolean;
}

class SystemConfigReverseGeocodingDto {
  @ValidateBoolean({ description: 'Enabled' })
  enabled!: boolean;
}

class SystemConfigFacesDto {
  @ValidateBoolean({ description: 'Import' })
  import!: boolean;
}

class SystemConfigMetadataDto {
  @Type(() => SystemConfigFacesDto)
  @ValidateNested()
  @IsObject()
  faces!: SystemConfigFacesDto;
}

class SystemConfigServerDto {
  @ValidateIf((_, value: string) => value !== '')
  @IsUrl({ require_tld: false, require_protocol: true, protocols: ['http', 'https'] })
  @ApiProperty({ description: 'External domain' })
  externalDomain!: string;

  @IsString()
  @ApiProperty({ description: 'Login page message' })
  loginPageMessage!: string;

  @ValidateBoolean({ description: 'Public users' })
  publicUsers!: boolean;
}

class SystemConfigSmtpTransportDto {
  @ValidateBoolean({ description: 'Whether to ignore SSL certificate errors' })
  ignoreCert!: boolean;

  @ApiProperty({ description: 'SMTP server hostname' })
  @IsNotEmpty()
  @IsString()
  host!: string;

  @ApiProperty({ description: 'SMTP server port', type: Number, minimum: 0, maximum: 65_535 })
  @IsNumber()
  @Min(0)
  @Max(65_535)
  port!: number;

  @ValidateBoolean({ description: 'Whether to use secure connection (TLS/SSL)' })
  secure!: boolean;

  @ApiProperty({ description: 'SMTP username' })
  @IsString()
  username!: string;

  @ApiProperty({ description: 'SMTP password' })
  @IsString()
  password!: string;
}

export class SystemConfigSmtpDto {
  @ValidateBoolean({ description: 'Whether SMTP email notifications are enabled' })
  enabled!: boolean;

  @ApiProperty({ description: 'Email address to send from' })
  @ValidateIf(isEmailNotificationEnabled)
  @IsNotEmpty()
  @IsString()
  @IsNotEmpty()
  from!: string;

  @ApiProperty({ description: 'Email address for replies' })
  @IsString()
  replyTo!: string;

  // Description lives on schema to avoid duplication
  @ApiProperty({ description: undefined })
  @ValidateIf(isEmailNotificationEnabled)
  @Type(() => SystemConfigSmtpTransportDto)
  @ValidateNested()
  @IsObject()
  transport!: SystemConfigSmtpTransportDto;
}

class SystemConfigNotificationsDto {
  @Type(() => SystemConfigSmtpDto)
  @ValidateNested()
  @IsObject()
  smtp!: SystemConfigSmtpDto;
}

class SystemConfigTemplateEmailsDto {
  @IsString()
  albumInviteTemplate!: string;

  @IsString()
  welcomeTemplate!: string;

  @IsString()
  albumUpdateTemplate!: string;
}

class SystemConfigTemplatesDto {
  @Type(() => SystemConfigTemplateEmailsDto)
  @ValidateNested()
  @IsObject()
  email!: SystemConfigTemplateEmailsDto;
}

class SystemConfigStorageTemplateDto {
  @ValidateBoolean({ description: 'Enabled' })
  enabled!: boolean;

  @ValidateBoolean({ description: 'Hash verification enabled' })
  hashVerificationEnabled!: boolean;

  @IsNotEmpty()
  @IsString()
  @ApiProperty({ description: 'Template' })
  template!: string;
}

export class SystemConfigTemplateStorageOptionDto {
  @ApiProperty({ description: 'Available year format options for storage template' })
  yearOptions!: string[];
  @ApiProperty({ description: 'Available month format options for storage template' })
  monthOptions!: string[];
  @ApiProperty({ description: 'Available week format options for storage template' })
  weekOptions!: string[];
  @ApiProperty({ description: 'Available day format options for storage template' })
  dayOptions!: string[];
  @ApiProperty({ description: 'Available hour format options for storage template' })
  hourOptions!: string[];
  @ApiProperty({ description: 'Available minute format options for storage template' })
  minuteOptions!: string[];
  @ApiProperty({ description: 'Available second format options for storage template' })
  secondOptions!: string[];
  @ApiProperty({ description: 'Available preset template options' })
  presetOptions!: string[];
}

export class SystemConfigThemeDto {
  @ApiProperty({ description: 'Custom CSS for theming' })
  @IsString()
  customCss!: string;
}

class SystemConfigGeneratedImageDto {
  @ValidateEnum({ enum: ImageFormat, name: 'ImageFormat', description: 'Image format' })
  format!: ImageFormat;

  @IsInt()
  @Min(1)
  @Max(100)
  @Type(() => Number)
  @ApiProperty({ type: 'integer', description: 'Quality' })
  quality!: number;

  @IsInt()
  @Min(1)
  @Type(() => Number)
  @ApiProperty({ type: 'integer', description: 'Size' })
  size!: number;

  @ValidateBoolean({ optional: true, default: false })
  progressive?: boolean;
}

class SystemConfigGeneratedFullsizeImageDto {
  @ValidateBoolean({ description: 'Enabled' })
  enabled!: boolean;

  @ValidateEnum({ enum: ImageFormat, name: 'ImageFormat', description: 'Image format' })
  format!: ImageFormat;

  @IsInt()
  @Min(1)
  @Max(100)
  @Type(() => Number)
  @ApiProperty({ type: 'integer', description: 'Quality' })
  quality!: number;

  @ValidateBoolean({ optional: true, default: false, description: 'Progressive' })
  progressive?: boolean;
}

export class SystemConfigImageDto {
  @Type(() => SystemConfigGeneratedImageDto)
  @ValidateNested()
  @IsObject()
  // Description lives on schema to avoid duplication
  @ApiProperty({ description: undefined })
  thumbnail!: SystemConfigGeneratedImageDto;

  @Type(() => SystemConfigGeneratedImageDto)
  @ValidateNested()
  @IsObject()
  // Description lives on schema to avoid duplication
  @ApiProperty({ description: undefined })
  preview!: SystemConfigGeneratedImageDto;

  @Type(() => SystemConfigGeneratedFullsizeImageDto)
  @ValidateNested()
  @IsObject()
  // Description lives on schema to avoid duplication
  @ApiProperty({ description: undefined })
  fullsize!: SystemConfigGeneratedFullsizeImageDto;

  @ValidateEnum({ enum: Colorspace, name: 'Colorspace', description: 'Colorspace' })
  colorspace!: Colorspace;

  @ValidateBoolean({ description: 'Extract embedded' })
  extractEmbedded!: boolean;
}

class SystemConfigTrashDto {
  @ValidateBoolean({ description: 'Enabled' })
  enabled!: boolean;

  @IsInt()
  @Min(0)
  @Type(() => Number)
  @ApiProperty({ type: 'integer', description: 'Days' })
  days!: number;
}

@ValidatorConstraint({ name: 'UniqueNames', async: false })
class UniqueNames implements ValidatorConstraintInterface {
  validate(categories: SystemConfigClassificationCategoryDto[]) {
    if (!Array.isArray(categories)) {
      return true;
    }
    const names = categories.map((c) => c.name);
    return new Set(names).size === names.length;
  }
}

class SystemConfigClassificationCategoryDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  @ArrayMinSize(1)
  @ApiProperty({ type: [String] })
  prompts!: string[];

  @IsNumber()
  @Min(0)
  @Max(1)
  @Type(() => Number)
  @ApiProperty({ type: 'number' })
  similarity!: number;

  @IsString()
  @IsIn(['tag', 'tag_and_archive'])
  action!: 'tag' | 'tag_and_archive';

  @ValidateBoolean({ description: 'Enable or disable this category' })
  enabled!: boolean;
}

class SystemConfigClassificationDto {
  @ValidateBoolean({ description: 'Enable classification globally' })
  enabled!: boolean;

  @ValidateNested({ each: true })
  @Type(() => SystemConfigClassificationCategoryDto)
  @IsArray()
  @ApiProperty({ type: [SystemConfigClassificationCategoryDto] })
  @Validate(UniqueNames, { message: 'Category names must be unique' })
  categories!: SystemConfigClassificationCategoryDto[];
}

class SystemConfigUserDto {
  @IsInt()
  @Min(1)
  @Type(() => Number)
  @ApiProperty({ type: 'integer', description: 'Delete delay' })
  deleteDelay!: number;
}

export class SystemConfigDto implements SystemConfig {
  // Description lives on schema to avoid duplication
  @ApiProperty({ description: undefined })
  @Type(() => SystemConfigBackupsDto)
  @ValidateNested()
  @IsObject()
  backup!: SystemConfigBackupsDto;

  // Description lives on schema to avoid duplication
  @ApiProperty({ description: undefined })
  @Type(() => SystemConfigFFmpegDto)
  @ValidateNested()
  @IsObject()
  ffmpeg!: SystemConfigFFmpegDto;

  // Description lives on schema to avoid duplication
  @ApiProperty({ description: undefined })
  @Type(() => SystemConfigLoggingDto)
  @ValidateNested()
  @IsObject()
  logging!: SystemConfigLoggingDto;

  // Description lives on schema to avoid duplication
  @ApiProperty({ description: undefined })
  @Type(() => SystemConfigMachineLearningDto)
  @ValidateNested()
  @IsObject()
  machineLearning!: SystemConfigMachineLearningDto;

  // Description lives on schema to avoid duplication
  @ApiProperty({ description: undefined })
  @Type(() => SystemConfigMapDto)
  @ValidateNested()
  @IsObject()
  map!: SystemConfigMapDto;

  // Description lives on schema to avoid duplication
  @ApiProperty({ description: undefined })
  @Type(() => SystemConfigNewVersionCheckDto)
  @ValidateNested()
  @IsObject()
  newVersionCheck!: SystemConfigNewVersionCheckDto;

  // Description lives on schema to avoid duplication
  @ApiProperty({ description: undefined })
  @Type(() => SystemConfigNightlyTasksDto)
  @ValidateNested()
  @IsObject()
  nightlyTasks!: SystemConfigNightlyTasksDto;

  // Description lives on schema to avoid duplication
  @ApiProperty({ description: undefined })
  @Type(() => SystemConfigOAuthDto)
  @ValidateNested()
  @IsObject()
  oauth!: SystemConfigOAuthDto;

  // Description lives on schema to avoid duplication
  @ApiProperty({ description: undefined })
  @Type(() => SystemConfigPasswordLoginDto)
  @ValidateNested()
  @IsObject()
  passwordLogin!: SystemConfigPasswordLoginDto;

  // Description lives on schema to avoid duplication
  @ApiProperty({ description: undefined })
  @Type(() => SystemConfigReverseGeocodingDto)
  @ValidateNested()
  @IsObject()
  reverseGeocoding!: SystemConfigReverseGeocodingDto;

  // Description lives on schema to avoid duplication
  @ApiProperty({ description: undefined })
  @Type(() => SystemConfigMetadataDto)
  @ValidateNested()
  @IsObject()
  metadata!: SystemConfigMetadataDto;

  // Description lives on schema to avoid duplication
  @ApiProperty({ description: undefined })
  @Type(() => SystemConfigStorageTemplateDto)
  @ValidateNested()
  @IsObject()
  storageTemplate!: SystemConfigStorageTemplateDto;

  // Description lives on schema to avoid duplication
  @ApiProperty({ description: undefined })
  @Type(() => SystemConfigJobDto)
  @ValidateNested()
  @IsObject()
  job!: SystemConfigJobDto;

  // Description lives on schema to avoid duplication
  @ApiProperty({ description: undefined })
  @Type(() => SystemConfigImageDto)
  @ValidateNested()
  @IsObject()
  image!: SystemConfigImageDto;

  // Description lives on schema to avoid duplication
  @ApiProperty({ description: undefined })
  @Type(() => SystemConfigTrashDto)
  @ValidateNested()
  @IsObject()
  trash!: SystemConfigTrashDto;

  // Description lives on schema to avoid duplication
  @ApiProperty({ description: undefined })
  @Type(() => SystemConfigThemeDto)
  @ValidateNested()
  @IsObject()
  theme!: SystemConfigThemeDto;

  // Description lives on schema to avoid duplication
  @ApiProperty({ description: undefined })
  @Type(() => SystemConfigLibraryDto)
  @ValidateNested()
  @IsObject()
  library!: SystemConfigLibraryDto;

  // Description lives on schema to avoid duplication
  @ApiProperty({ description: undefined })
  @Type(() => SystemConfigNotificationsDto)
  @ValidateNested()
  @IsObject()
  notifications!: SystemConfigNotificationsDto;

  // Description lives on schema to avoid duplication
  @ApiProperty({ description: undefined })
  @Type(() => SystemConfigTemplatesDto)
  @ValidateNested()
  @IsObject()
  templates!: SystemConfigTemplatesDto;

  // Description lives on schema to avoid duplication
  @ApiProperty({ description: undefined })
  @Type(() => SystemConfigServerDto)
  @ValidateNested()
  @IsObject()
  server!: SystemConfigServerDto;

  // Description lives on schema to avoid duplication
  @ApiProperty({ description: undefined })
  @Type(() => SystemConfigClassificationDto)
  @ValidateNested()
  @IsObject()
  classification!: SystemConfigClassificationDto;

  // Description lives on schema to avoid duplication
  @ApiProperty({ description: undefined })
  @Type(() => SystemConfigUserDto)
  @ValidateNested()
  @IsObject()
  user!: SystemConfigUserDto;
}

export function mapConfig(config: SystemConfig): SystemConfigDto {
  return config;
}
