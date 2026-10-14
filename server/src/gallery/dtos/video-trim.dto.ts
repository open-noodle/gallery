import { createZodDto } from 'nestjs-zod';
import z from 'zod';

const seconds = (description: string) => z.number().meta({ format: 'double' }).min(0).describe(description);

const AssetVideoTrimSchema = z
  .object({
    startTime: seconds('Start of the kept part, in seconds from the start of the original video'),
    endTime: seconds('End of the kept part, in seconds from the start of the original video'),
  })
  .refine((trim) => trim.endTime > trim.startTime, {
    error: 'endTime must be greater than startTime',
    path: ['endTime'],
  })
  .meta({ id: 'AssetVideoTrimDto' });

const AssetVideoTrimResponseSchema = z
  .object({
    startTime: seconds('Start of the kept part, in seconds from the start of the original video'),
    endTime: seconds('End of the kept part, in seconds from the start of the original video'),
    originalDuration: seconds('Length of the untrimmed video, in seconds'),
  })
  .meta({ id: 'AssetVideoTrimResponseDto' });

export class AssetVideoTrimDto extends createZodDto(AssetVideoTrimSchema) {}
export class AssetVideoTrimResponseDto extends createZodDto(AssetVideoTrimResponseSchema) {}
