import { createZodDto } from 'nestjs-zod';
import { PersonResponseSchema } from 'src/dtos/person.dto';
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

const FamilyAccessLevelSchema = z.enum(FamilyAccessLevel).meta({ id: 'FamilyAccessLevel' });

const FamilyDateSchema = z.string().meta({ format: 'date' }).nullable();

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

const FamilyParticipantKindSchema = z
  .enum(['known', 'anonymous'])
  .describe('Whether this seat is a resolvable identity or unresolvable to the viewer')
  .meta({ id: 'FamilyParticipantKind' });

// Deliberately a FLAT object with a nullable `identityId`, not a `z.discriminatedUnion` —
// `z.discriminatedUnion` emits an OpenAPI `oneOf`, and the Dart client generator collapses that
// `oneOf`'s two branches into ONE class that merges their `required` arrays: the shipped Dart
// model ended up with `identityId` marked non-nullable AND REQUIRED while `kind`'s generated enum
// only carried the 'anonymous' literal — meaning it threw deserializing every 'known' participant
// (and, separately, 'kind' could never decode to 'known' at all). That is a real, previously
// shipped bug, not a hypothetical: verify any future change to this schema by decoding a payload
// through the actual generated Dart model, not by inspecting the JSON schema. A flat nullable
// field is the standard, well-supported pattern every generator here already handles correctly
// (see `PersonResponseSchema`'s own `person: PersonResponseSchema.nullable()` on
// `AssetFaceResponseDto`). `identityId: null` for an anonymous seat carries zero information —
// every anonymous seat has the exact same `null` — so it preserves `E30`'s non-correlation
// guarantee exactly as well as an absent field would; the guarantee was never about `null` vs.
// "absent", only about never sending a REAL id for an unresolvable participant.
const FamilyParticipantSchema = z
  .object({
    kind: FamilyParticipantKindSchema,
    // z.uuid() (version-agnostic), NOT z.uuidv4(): face_identity.id is a UUID **v7**
    // (@PrimaryGeneratedUuidV7Column). z.uuidv4() enforces the version nibble == 4 and 400s on
    // every real identity id — see the same fix already applied in face-repair.dto.ts.
    identityId: z.uuid().nullable().describe("Identity ID when kind is 'known'; null when 'anonymous'"),
  })
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
    // face_identity.id is UUID v7 — see the note on FamilyParticipantSchema.identityId above.
    rootCandidateId: z.uuid().describe('A resolvable identity id in this cluster, usable as a default root'),
  })
  .meta({ id: 'FamilyClusterResponseDto' });

const FamilyUnionCreateSchema = z
  .object({
    // face_identity.id is UUID v7 — see the note on FamilyParticipantSchema.identityId above.
    partnerIds: z.array(z.uuid()).max(2).optional().describe('Partner identity IDs (at most two)'),
    childIds: z.array(z.uuid()).optional().describe('Child identity IDs'),
    // A client never learns an identity id — `PersonResponseDto` deliberately withholds it so the
    // same real person cannot be correlated across users. These person-id forms are what a people
    // picker can actually supply; the server resolves them to identities. Merged with the identity
    // arrays above, so a caller may mix the two.
    partnerPersonIds: z.array(z.uuid()).max(2).optional().describe('Partner person IDs, resolved to identities'),
    childPersonIds: z.array(z.uuid()).optional().describe('Child person IDs, resolved to identities'),
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
    // face_identity.id is UUID v7 — see the note on FamilyParticipantSchema.identityId above.
    identityId: z.uuid().optional().describe('Identity ID to add to the union'),
    // See FamilyUnionCreateSchema: a picker only ever knows a person id.
    personId: z.uuid().optional().describe('Person ID to add, resolved to its identity'),
    role: FamilyParticipantRoleSchema.describe('Role to add the identity as'),
  })
  .refine((value) => (value.identityId === undefined) !== (value.personId === undefined), {
    message: 'Provide exactly one of identityId or personId',
  })
  .meta({ id: 'FamilyParticipantAddDto' });

const FamilyUnionParamSchema = z.object({
  id: z.uuidv4(),
});

const FamilyUnionParticipantParamSchema = z.object({
  id: z.uuidv4(),
  // face_identity.id is UUID v7 — see the note on FamilyParticipantSchema.identityId above.
  identityId: z.uuid(),
});

// The route param on PUT /family/identities/:id/gender — a face_identity.id (UUID v7), not a
// union id. See the note on FamilyParticipantSchema.identityId above.
const FamilyIdentityParamSchema = z.object({
  id: z.uuid(),
});

// D4: `null` clears the viewer's root, reverting to plain names.
const FamilyMyRootUpdateSchema = z
  .object({
    // face_identity.id is UUID v7 — see the note on FamilyParticipantSchema.identityId above.
    identityId: z.uuid().nullable().optional().describe('Identity ID to nominate as yourself, or null to clear'),
    // See FamilyUnionCreateSchema: the first-run picker on /family only knows a person id, and
    // nominating yourself is what makes every derived label read "your aunt" rather than a name.
    personId: z.uuid().optional().describe('Person ID to nominate as yourself, resolved to its identity'),
  })
  .refine((value) => value.identityId === undefined || value.personId === undefined, {
    message: 'Provide identityId or personId, not both',
  })
  .meta({ id: 'FamilyMyRootUpdateDto' });

// `access` lets a client learn, in the SAME call, both who it said it is and what it may do —
// resolved through the exact same `FamilyService.resolveFamilyAccess` path as every other
// endpoint (never a second derivation), and never cached across requests: a grant revoked a
// moment ago must already read back as 'none' here.
const FamilyMyRootResponseSchema = z
  .object({
    // face_identity.id is UUID v7 — see the note on FamilyParticipantSchema.identityId above.
    rootIdentityId: z.uuid().nullable().describe('The identity nominated as the caller, or null if never set'),
    access: FamilyAccessLevelSchema.describe("The caller's own effective family access level"),
  })
  .meta({ id: 'FamilyMyRootResponseDto' });

const FamilyGenderUpdateSchema = z
  .object({
    gender: FamilyGenderSchema.describe("Gender ('male' or 'female'), or null to clear"),
  })
  .meta({ id: 'FamilyGenderUpdateDto' });

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

// One row of a PERSON's own relations panel — relative to that person, not the viewer (a
// different query from `PersonResponseDto.familyRelationLabel`, which is always relative to the
// viewer). `person` is populated for a participant the viewer can resolve; `null` for one they
// cannot, in which case `anonymousSlot` carries the opaque per-union index instead — never an
// identity id, same discipline as `FamilyParticipantDto`.
const FamilyPersonRelationSchema = z
  .object({
    person: PersonResponseSchema.nullable().describe('The related person, or null if the viewer cannot resolve them'),
    anonymousSlot: z.int().min(0).nullable().describe('Opaque per-union slot index, only present when person is null'),
    relation: z.string().describe("How this participant relates to the requested person (e.g. 'parent')"),
  })
  .meta({ id: 'FamilyPersonRelationDto' });

const FamilyPersonRelationsResponseSchema = z
  .object({
    relations: z.array(FamilyPersonRelationSchema),
  })
  .meta({ id: 'FamilyPersonRelationsResponseDto' });

const FamilyPersonParamSchema = z.object({
  personId: z.uuidv4(),
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
export class FamilyPersonRelationsResponseDto extends createZodDto(FamilyPersonRelationsResponseSchema) {}
export class FamilyPersonParamDto extends createZodDto(FamilyPersonParamSchema) {}
