import { createZodDto } from 'nestjs-zod';
import { FamilyAccessLevel } from 'src/enum';
import z from 'zod';

// Gallery-fork: family relationships. See `FamilyService` and `specs/2026-08-31-family-relationships-design-and-slices.md`.
//
// D8.5 — the graph response is `{ unions: [...] }` (plus a sibling `identities` map and paging
// metadata), NEVER `{ tree: {...} }`. A flat, query-filtered collection is what keeps a future
// "named family" feature purely additive; a nested tree bakes a container into the contract
// forever. Do not add a `tree` field to `FamilyGraphResponseSchema`.

const FamilyUnionStatusSchema = z
  .enum(['married', 'partnered', 'separated', 'divorced', 'widowed'])
  .meta({ id: 'FamilyUnionStatus' });

// Deliberately NOT `z.enum([...]).nullable()`, and NOT `z.union([z.enum([...]), z.null()])`
// either — nestjs-zod's OpenAPI-3.0 conversion flattens BOTH of those into the same
// `{ enum: ['male', 'female', null], nullable: true }` shape, and oazapfts's `--useEnumType`
// then emits a TS enum with a bare `Null` member (no initializer), which fails to compile in
// the generated SDK. A plain nullable string with a runtime `.refine()` never emits an `enum`
// keyword at all, so the generator never takes that path — the trade-off is that the generated
// SDK's TS type is `string | null` here rather than a literal union, same as any other
// hand-validated string field in this codebase.
const FAMILY_GENDERS = ['male', 'female'] as const;
const FamilyGenderSchema = z
  .string()
  .nullable()
  .refine((value) => value === null || (FAMILY_GENDERS as readonly string[]).includes(value), {
    error: "Gender must be 'male', 'female', or null",
  });

const FamilyParticipantRoleSchema = z.enum(['partner', 'child']).meta({ id: 'FamilyParticipantRole' });

const FamilyDateSchema = z.string().meta({ format: 'date' }).nullable();

// Mirrors `ProjectedFamilyParticipant` (`src/utils/family-labels.ts`) exactly: the `anonymous`
// variant carries no `identityId` at all, not an optional one — see `E30` in the design spec.
// Never widen this to give the anonymous branch an id field, even an optional one.
const FamilyParticipantSchema = z
  .discriminatedUnion('kind', [
    z.object({ kind: z.literal('known'), identityId: z.uuidv4().describe('Identity ID') }),
    z.object({ kind: z.literal('anonymous') }),
  ])
  .meta({ id: 'FamilyParticipantDto' });

// `label` is derived server-side ONLY, from the projected graph and the caller's own root
// (`deriveRelationLabel`, D4) — never computed by a client, since a client only ever sees the
// already-redacted graph and correctly deriving "your niece" requires knowing the FULL set of
// unions a viewer can resolve, not just the ones on the current page. null when no root is set,
// or when the caller has no path to this identity at all (`E36`/`E45`).
const FamilyIdentitySchema = z
  .object({
    name: z.string().describe('Resolved display name'),
    gender: FamilyGenderSchema.describe("Recorded gender ('male', 'female'), or null if unset"),
    label: z.string().nullable().describe('This identity\'s relation to the caller ("your sister"), or null'),
  })
  .meta({ id: 'FamilyIdentityDto' });

const FamilyUnionSchema = z
  .object({
    id: z.uuidv4().describe('Union ID'),
    status: FamilyUnionStatusSchema.describe('Union status'),
    startDate: FamilyDateSchema.describe('Union start date'),
    endDate: FamilyDateSchema.describe('Union end date'),
    partners: z.array(FamilyParticipantSchema).describe('Partners in this union (0, 1 or 2)'),
    children: z.array(FamilyParticipantSchema).describe('Children in this union'),
  })
  .meta({ id: 'FamilyUnionDto' });

const FamilyUnionsQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1).describe('Page number'),
    size: z.coerce.number().int().min(1).max(200).default(50).describe('Number of unions per page'),
  })
  .meta({ id: 'FamilyUnionsQueryDto' });

// E49: paginated with a stable order (by union id) across pages. `identities` is scoped to only
// the identities referenced by unions in THIS page — not the whole graph — for the same reason
// `FamilyService.getVisibleGraph` scopes it to the whole response: nothing here should exist
// that isn't backed by a union actually being returned.
const FamilyGraphResponseSchema = z
  .object({
    unions: z.array(FamilyUnionSchema),
    identities: z.record(z.string(), FamilyIdentitySchema),
    hasNextPage: z.boolean(),
  })
  .meta({ id: 'FamilyGraphResponseDto' });

const FamilyClusterSchema = z
  .object({
    label: z.string().describe('Display name of the cluster'),
    size: z.int().min(0).describe('Total people in the cluster, resolvable or not'),
    rootCandidateId: z.uuidv4().describe('A resolvable identity id in this cluster, usable as a default root'),
  })
  .meta({ id: 'FamilyClusterResponseDto' });

const FamilyUnionCreateSchema = z
  .object({
    partnerIds: z.array(z.uuidv4()).max(2).optional().describe('Partner identity IDs (at most two)'),
    childIds: z.array(z.uuidv4()).optional().describe('Child identity IDs'),
    status: FamilyUnionStatusSchema.optional().describe('Union status'),
    startDate: FamilyDateSchema.optional().describe('Union start date'),
    endDate: FamilyDateSchema.optional().describe('Union end date'),
  })
  .meta({ id: 'FamilyUnionCreateDto' });

const FamilyUnionCreateResponseSchema = z.object({ id: z.uuidv4() }).meta({ id: 'FamilyUnionCreateResponseDto' });

const FamilyUnionUpdateSchema = z
  .object({
    status: FamilyUnionStatusSchema.optional().describe('Union status'),
    startDate: FamilyDateSchema.optional().describe('Union start date'),
    endDate: FamilyDateSchema.optional().describe('Union end date'),
  })
  .meta({ id: 'FamilyUnionUpdateDto' });

const FamilyParticipantAddSchema = z
  .object({
    identityId: z.uuidv4().describe('Identity ID to add to the union'),
    role: FamilyParticipantRoleSchema.describe('Role to add the identity as'),
  })
  .meta({ id: 'FamilyParticipantAddDto' });

const FamilyUnionParamSchema = z.object({
  id: z.uuidv4(),
});

const FamilyUnionParticipantParamSchema = z.object({
  id: z.uuidv4(),
  identityId: z.uuidv4(),
});

const FamilyIdentityParamSchema = z.object({
  id: z.uuidv4(),
});

// D4: `null` clears the viewer's root, reverting to plain names.
const FamilyMyRootUpdateSchema = z
  .object({
    identityId: z.uuidv4().nullable().describe('Identity ID to nominate as yourself, or null to clear'),
  })
  .meta({ id: 'FamilyMyRootUpdateDto' });

const FamilyMyRootResponseSchema = z
  .object({
    identityId: z.uuidv4().nullable().describe('The identity nominated as the caller, or null if never set'),
  })
  .meta({ id: 'FamilyMyRootResponseDto' });

const FamilyGenderUpdateSchema = z
  .object({
    gender: FamilyGenderSchema.describe("Gender ('male' or 'female'), or null to clear"),
  })
  .meta({ id: 'FamilyGenderUpdateDto' });

const FamilyAccessLevelSchema = z.enum(FamilyAccessLevel).meta({ id: 'FamilyAccessLevel' });

const FamilyAccessGrantResponseSchema = z
  .object({
    userId: z.uuidv4().describe('User ID this grant applies to'),
    level: FamilyAccessLevelSchema.describe('Explicitly granted access level'),
    grantedById: z.uuidv4().nullable().describe('Admin who last set this grant, if known'),
    grantedAt: z.string().meta({ format: 'date-time' }).describe('When this grant was last set'),
  })
  .meta({ id: 'FamilyAccessGrantResponseDto' });

const FamilyAccessUpdateSchema = z
  .object({
    level: FamilyAccessLevelSchema.describe('Access level to grant'),
  })
  .meta({ id: 'FamilyAccessUpdateDto' });

const FamilyAccessUserParamSchema = z.object({
  userId: z.uuidv4(),
});

export class FamilyUnionsQueryDto extends createZodDto(FamilyUnionsQuerySchema) {}
export class FamilyGraphResponseDto extends createZodDto(FamilyGraphResponseSchema) {}
export class FamilyClusterResponseDto extends createZodDto(FamilyClusterSchema) {}
export class FamilyUnionCreateDto extends createZodDto(FamilyUnionCreateSchema) {}
export class FamilyUnionCreateResponseDto extends createZodDto(FamilyUnionCreateResponseSchema) {}
export class FamilyUnionUpdateDto extends createZodDto(FamilyUnionUpdateSchema) {}
export class FamilyParticipantAddDto extends createZodDto(FamilyParticipantAddSchema) {}
export class FamilyUnionParamDto extends createZodDto(FamilyUnionParamSchema) {}
export class FamilyUnionParticipantParamDto extends createZodDto(FamilyUnionParticipantParamSchema) {}
export class FamilyIdentityParamDto extends createZodDto(FamilyIdentityParamSchema) {}
export class FamilyMyRootUpdateDto extends createZodDto(FamilyMyRootUpdateSchema) {}
export class FamilyMyRootResponseDto extends createZodDto(FamilyMyRootResponseSchema) {}
export class FamilyGenderUpdateDto extends createZodDto(FamilyGenderUpdateSchema) {}
export class FamilyAccessGrantResponseDto extends createZodDto(FamilyAccessGrantResponseSchema) {}
export class FamilyAccessUpdateDto extends createZodDto(FamilyAccessUpdateSchema) {}
export class FamilyAccessUserParamDto extends createZodDto(FamilyAccessUserParamSchema) {}
