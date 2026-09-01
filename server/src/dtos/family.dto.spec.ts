import {
  FamilyClusterResponseDto,
  FamilyGraphResponseDto,
  FamilyIdentityParamDto,
  FamilyMyRootResponseDto,
  FamilyMyRootUpdateDto,
  FamilyParticipantAddDto,
  FamilyUnionCreateDto,
  FamilyUnionParticipantParamDto,
} from 'src/dtos/family.dto';
import { describe, expect, it } from 'vitest';

// face_identity.id is a UUID **v7** (@PrimaryGeneratedUuidV7Column) — every field on this page
// that carries one MUST validate with z.uuid() (version-agnostic), never z.uuidv4(). Getting this
// backwards 400s the family API on every real identity id: creating a union, adding a participant,
// nominating a root, reading clusters, reading the graph — the feature is unusable end to end.
// See the identical, previously-shipped regression in face-repair.dto.spec.ts.
//
// This is deliberately NOT a UUID a human would type by hand: it has the real v7 version nibble
// (7) and the real RFC 9562 variant nibble (8-b), so a schema that quietly regressed to
// z.uuidv4() actually fails this the way it would fail on production data, not just on a
// hand-crafted string a lenient regex might accidentally still accept.
const UUID_V7 = '01890000-0000-7000-8000-000000000001';
// `family_union.id` and `user.id` (plain @PrimaryGeneratedColumn()) genuinely ARE v4 — these
// fields must keep accepting v4, which the tests below also assert.
const UUID_V4 = '00000000-0000-4000-a000-000000000001';

describe('FamilyUnionCreateDto', () => {
  it('accepts real (v7) identity ids in partnerIds and childIds', () => {
    const result = FamilyUnionCreateDto.schema.safeParse({ partnerIds: [UUID_V7], childIds: [UUID_V7] });
    expect(result.success).toBe(true);
  });

  it('rejects a non-uuid partner id', () => {
    expect(FamilyUnionCreateDto.schema.safeParse({ partnerIds: ['not-a-uuid'] }).success).toBe(false);
  });
});

describe('FamilyParticipantAddDto', () => {
  it('accepts a real (v7) identity id', () => {
    const result = FamilyParticipantAddDto.schema.safeParse({ identityId: UUID_V7, role: 'partner' });
    expect(result.success).toBe(true);
  });
});

describe('FamilyUnionParticipantParamDto', () => {
  it('accepts a v4 union id alongside a v7 identity id', () => {
    const result = FamilyUnionParticipantParamDto.schema.safeParse({ id: UUID_V4, identityId: UUID_V7 });
    expect(result.success).toBe(true);
  });
});

describe('FamilyIdentityParamDto', () => {
  // The route param on PUT /family/identities/:id/gender — a face_identity id despite the
  // generic `id` name, not a union id.
  it('accepts a real (v7) identity id', () => {
    expect(FamilyIdentityParamDto.schema.safeParse({ id: UUID_V7 }).success).toBe(true);
  });
});

describe('FamilyMyRootUpdateDto', () => {
  it('accepts a real (v7) identity id', () => {
    expect(FamilyMyRootUpdateDto.schema.safeParse({ identityId: UUID_V7 }).success).toBe(true);
  });

  it('still accepts null (clearing the root)', () => {
    expect(FamilyMyRootUpdateDto.schema.safeParse({ identityId: null }).success).toBe(true);
  });
});

describe('FamilyMyRootResponseDto', () => {
  it('accepts a real (v7) rootIdentityId', () => {
    const result = FamilyMyRootResponseDto.schema.safeParse({ rootIdentityId: UUID_V7, access: 'view' });
    expect(result.success).toBe(true);
  });
});

describe('FamilyClusterResponseDto', () => {
  it('accepts a real (v7) rootCandidateId', () => {
    const result = FamilyClusterResponseDto.schema.safeParse({ label: 'Marais', size: 3, rootCandidateId: UUID_V7 });
    expect(result.success).toBe(true);
  });
});

describe('FamilyGraphResponseDto', () => {
  it('accepts a v7 identity id nested inside a union participant', () => {
    const result = FamilyGraphResponseDto.schema.safeParse({
      unions: [
        {
          id: UUID_V4,
          status: 'partnered',
          startDate: null,
          endDate: null,
          partners: [{ kind: 'known', identityId: UUID_V7 }],
          children: [],
        },
      ],
      identities: { [UUID_V7]: { name: 'Grandma', gender: null, label: null } },
      hasNextPage: false,
    });
    expect(result.success).toBe(true);
  });
});
