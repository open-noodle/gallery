import { createZodDto } from 'nestjs-zod';
import { DissolveScope } from 'src/utils/face-dissolve';
import z from 'zod';

export const DissolveRequestSchema = z
  .object({
    scope: z.enum(DissolveScope),
    // A literal union, not an inline z.enum — an anonymous enum gets renumbered by oazapfts on regeneration.
    outcome: z.union([z.literal('unassign'), z.literal('delete-faces'), z.literal('delete-faces-and-person')]),
    redetect: z.boolean(),
    expectedFaceCount: z.number().int().min(0),
  })
  .meta({ id: 'DissolveRequestDto' });

export class DissolveRequestDto extends createZodDto(DissolveRequestSchema) {}
export type DissolveRequest = z.infer<typeof DissolveRequestSchema>;

const DissolveCountsSchema = z.object({
  faces: z.number(),
  exif: z.number(),
  mlWithEmbedding: z.number(),
  mlWithoutEmbedding: z.number(),
  softDeleted: z.number(),
  assets: z.number(),
  sharedAssets: z.number(),
  notRedetectable: z.number(),
});

const DissolveWarningSchema = z.object({ code: z.string(), count: z.number() });

export const DissolveResponseSchema = z
  .object({
    personId: z.string(),
    counts: DissolveCountsSchema,
    expectedFaceCount: z.number(),
    warnings: z.array(DissolveWarningSchema),
  })
  .meta({ id: 'DissolveResponseDto' });

export class DissolveResponseDto extends createZodDto(DissolveResponseSchema) {}
export type DissolveResponse = z.infer<typeof DissolveResponseSchema>;
export type DissolveWarning = z.infer<typeof DissolveWarningSchema>;
