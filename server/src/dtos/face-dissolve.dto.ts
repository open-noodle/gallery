import { createZodDto } from 'nestjs-zod';
import { DissolveScope } from 'src/utils/face-dissolve';
import z from 'zod';

// Named, not anonymous: without an id oazapfts emits a bare `enum Scope` into the SDK, squatting a generic
// name (OAuth/permission scope) that a later endpoint will want — and a published SDK export cannot be
// renamed without a breaking change.
const DissolveScopeSchema = z.enum(DissolveScope).describe('Which faces a dissolve touches').meta({
  id: 'DissolveScope',
});

export const DissolveRequestSchema = z
  .object({
    scope: DissolveScopeSchema,
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
  remainingLiveFaces: z.number(),
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

// Discovery (Task 8): the contamination signal. The only existing people endpoint is the move-to-person
// picker (searchOwnerPeople) — it has no way to surface a person made entirely of EXIF faces, since no scan
// ever flags one. This aggregate is what makes such a person findable at all.
export const PeopleHealthQuerySchema = z
  .object({
    // Required, not optional. Without it the aggregate GROUPs BY person.id over every visible asset_face row
    // on the instance and ORDERs BY an aggregate alias, so LIMIT/OFFSET prune nothing and each page re-runs
    // the whole thing. The only client always sends it, so requiring it costs nothing and removes the
    // unbounded case from the API surface entirely.
    ownerId: z.uuid(),
    // A literal union, not an inline z.enum — an anonymous enum gets renumbered by oazapfts on regeneration.
    sort: z
      .union([z.literal('exifFaces'), z.literal('facesWithoutEmbedding'), z.literal('faceCount')])
      .default('faceCount'),
    page: z.coerce.number().int().min(1).default(1).describe('Page number'),
    size: z.coerce.number().int().min(1).max(200).default(50).describe('Number of people per page'),
  })
  .meta({ id: 'PeopleHealthQueryDto' });
export class PeopleHealthQueryDto extends createZodDto(PeopleHealthQuerySchema) {}
export type PeopleHealthQuery = z.infer<typeof PeopleHealthQuerySchema>;

const PersonHealthRowSchema = z.object({
  id: z.string(),
  name: z.string(),
  ownerId: z.string(),
  faceCount: z.number(),
  machineLearning: z.number(),
  exif: z.number(),
  manual: z.number(),
  facesWithoutEmbedding: z.number(),
});

export const PeopleHealthResponseSchema = z
  .object({
    people: z.array(PersonHealthRowSchema),
    total: z.number(),
    hasMore: z.boolean(),
  })
  .meta({ id: 'PeopleHealthResponseDto' });
export class PeopleHealthResponseDto extends createZodDto(PeopleHealthResponseSchema) {}
export type PeopleHealthResponse = z.infer<typeof PeopleHealthResponseSchema>;
