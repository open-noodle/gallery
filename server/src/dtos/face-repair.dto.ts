import { createZodDto } from 'nestjs-zod';
import z from 'zod';

export const FaceRepairRequestSchema = z
  .object({
    dryRun: z.boolean().default(true),
    ownerId: z.uuidv4().optional(),
    personId: z.uuidv4().optional(),
    maxDistance: z.number().gt(0).max(2).optional(),
    minFaces: z.number().int().min(1).optional(),
    voteWindow: z.number().int().min(1).optional(),
    voteMargin: z.number().int().min(0).optional(),
    maxAttributionDistance: z.number().gt(0).max(2).optional(),
    maxFlaggedFraction: z.number().min(0).max(1).optional(),
  })
  .meta({ id: 'FaceRepairRequestDto' });

export class FaceRepairRequestDto extends createZodDto(FaceRepairRequestSchema) {}

const SuspectedOwnerSchema = z.object({ ownerPersonId: z.string(), count: z.number() });
const PersonSchema = z.object({
  personId: z.string(),
  eligible: z.number(),
  flagged: z.number(),
  flaggedFraction: z.number(),
  reviewOnly: z.boolean(),
  suspectedOwners: z.array(SuspectedOwnerSchema),
});

export const FaceRepairResponseSchema = z
  .object({
    dryRun: z.boolean(),
    mutated: z.boolean(),
    executed: z.object({ unassigned: z.number(), requeued: z.number() }).optional(),
    report: z.object({
      totals: z.object({
        eligibleFaces: z.number(),
        flaggedFaces: z.number(),
        toRepair: z.number(),
        reviewOnlyFaces: z.number(),
        reviewOnlyPersons: z.number(),
        affectedPersons: z.number(),
        reviewOnlyByReason: z.object({ overCap: z.number(), badTarget: z.number(), unAttributable: z.number() }),
      }),
      persons: z.array(PersonSchema),
    }),
  })
  .meta({ id: 'FaceRepairResponseDto' });

export class FaceRepairResponseDto extends createZodDto(FaceRepairResponseSchema) {}
