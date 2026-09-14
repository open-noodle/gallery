import { Type, type PersonResponseDto } from '@immich/sdk';
import { isSpaceScopedPerson, toScopedPersonRef } from './scoped-person-ref';

function makePerson(overrides: Partial<PersonResponseDto> = {}): PersonResponseDto {
  const id = overrides.id ?? 'person-1';
  return {
    id,
    name: 'Alice',
    birthDate: null,
    thumbnailPath: '/thumb.jpg',
    isHidden: false,
    updatedAt: '2026-01-02T00:00:00.000Z',
    ...overrides,
  };
}

describe('toScopedPersonRef', () => {
  it('maps a space-person profile to a space-scoped ref carrying its space id', () => {
    const person = makePerson({
      id: 'outer-id',
      primaryProfile: { type: Type.SpacePerson, id: 'sp-1', spaceId: 'space-9' },
    });

    // The profile id, not person.id: sending person.id to the space endpoint matches zero rows (#765).
    expect(toScopedPersonRef(person)).toEqual({ type: 'space-person', id: 'sp-1', spaceId: 'space-9' });
    expect(isSpaceScopedPerson(person)).toBe(true);
  });

  it('maps a user-person profile to the "person" enum, not "user-person" (would otherwise 400)', () => {
    const person = makePerson({
      id: 'outer-id',
      primaryProfile: { type: Type.UserPerson, id: 'personal-profile-1' },
    });

    expect(toScopedPersonRef(person)).toEqual({ type: 'person', id: 'personal-profile-1' });
    expect(isSpaceScopedPerson(person)).toBe(false);
  });

  it('falls back to person.id when no primary profile is present', () => {
    const person = makePerson({ id: 'person-7', primaryProfile: undefined });

    expect(toScopedPersonRef(person)).toEqual({ type: 'person', id: 'person-7' });
    expect(isSpaceScopedPerson(person)).toBe(false);
  });

  it('treats a space-person profile without a space id as personal (no space to scope to)', () => {
    const person = makePerson({
      id: 'person-8',
      primaryProfile: { type: Type.SpacePerson, id: 'sp-2' },
    });

    expect(toScopedPersonRef(person)).toEqual({ type: 'person', id: 'person-8' });
    expect(isSpaceScopedPerson(person)).toBe(false);
  });
});
