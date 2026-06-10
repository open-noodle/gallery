import {
  getMembers,
  getPersonFaces,
  getSpacePersonFaces,
  RepresentativeFaceSource,
  SharedSpaceRole,
  Type,
  updatePerson,
  updateRepresentativeFace,
  updateSpacePerson,
  updateSpacePersonRepresentativeFace,
  type PersonFacePageResponseDto,
  type SharedSpaceMemberResponseDto,
  type SharedSpacePersonResponseDto,
} from '@immich/sdk';
import { toastManager } from '@immich/ui';
import type { MessageFormatter } from 'svelte-i18n';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eventManager } from '$lib/managers/event-manager.svelte';
import * as handleErrorModule from '$lib/utils/handle-error';
import { getPersonFaceThumbnailUrl, getSpacePersonFaceThumbnailUrl } from '$lib/utils/people-utils';
import { personFactory } from '@test-data/factories/person-factory';
import {
  getPersonActions,
  getPersonFacesPage,
  getPersonFaceThumbnail,
  handleUpdatePersonBirthDate,
  isSpaceEditor,
  updatePersonName,
  updatePersonRepresentativeFace,
} from './person.service';

vi.mock('@immich/ui', async (orig) => {
  const actual = await orig<typeof import('@immich/ui')>();
  return {
    ...actual,
    toastManager: { primary: vi.fn(), danger: vi.fn(), warning: vi.fn(), success: vi.fn(), info: vi.fn() },
  };
});

vi.mock('@immich/sdk', async (orig) => ({
  ...(await orig<typeof import('@immich/sdk')>()),
  getMembers: vi.fn(),
  getPersonFaces: vi.fn(),
  getSpacePersonFaces: vi.fn(),
  updatePerson: vi.fn(),
  updateRepresentativeFace: vi.fn(),
  updateSpacePerson: vi.fn(),
  updateSpacePersonRepresentativeFace: vi.fn(),
}));

const spacePersonResponse = (overrides: Partial<SharedSpacePersonResponseDto>): SharedSpacePersonResponseDto => ({
  id: 'space-person-1',
  spaceId: 'space-1',
  name: 'Grandma',
  thumbnailPath: '',
  isHidden: false,
  birthDate: null,
  representativeFaceSource: RepresentativeFaceSource.Auto,
  faceCount: 3,
  assetCount: 10,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-02T00:00:00Z',
  ...overrides,
});

let handleErrorSpy: ReturnType<typeof vi.spyOn>;
let emitSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  handleErrorSpy = vi.spyOn(handleErrorModule, 'handleError').mockImplementation(() => {});
  emitSpy = vi.spyOn(eventManager, 'emit');
});

afterEach(() => {
  handleErrorSpy.mockRestore();
  emitSpy.mockRestore();
});

describe('handleUpdatePersonBirthDate', () => {
  it('routes the birthday write to the shared space endpoint for a space-scoped person', async () => {
    const person = personFactory.build({
      id: 'space-person-1',
      birthDate: null,
      primaryProfile: { type: Type.SpacePerson, id: 'space-person-1', spaceId: 'space-1' },
    });
    vi.mocked(updateSpacePerson).mockResolvedValue(spacePersonResponse({ birthDate: '1990-06-15' }));

    await expect(handleUpdatePersonBirthDate(person, '1990-06-15')).resolves.toBe(true);

    expect(updateSpacePerson).toHaveBeenCalledWith({
      id: 'space-1',
      personId: 'space-person-1',
      sharedSpacePersonUpdateDto: { birthDate: '1990-06-15' },
    });
    expect(updatePerson).not.toHaveBeenCalled();
    expect(emitSpy).toHaveBeenCalledWith(
      'PersonUpdate',
      expect.objectContaining({ id: person.id, name: person.name, birthDate: '1990-06-15' }),
    );
    expect(toastManager.primary).toHaveBeenCalledOnce();
  });

  it('clears the birthday of a space-scoped person', async () => {
    const person = personFactory.build({
      id: 'space-person-1',
      birthDate: '1990-06-15',
      primaryProfile: { type: Type.SpacePerson, id: 'space-person-1', spaceId: 'space-1' },
    });
    vi.mocked(updateSpacePerson).mockResolvedValue(spacePersonResponse({ birthDate: null }));

    await expect(handleUpdatePersonBirthDate(person, '')).resolves.toBe(true);

    expect(updateSpacePerson).toHaveBeenCalledWith({
      id: 'space-1',
      personId: 'space-person-1',
      sharedSpacePersonUpdateDto: { birthDate: '' },
    });
    expect(emitSpy).toHaveBeenCalledWith('PersonUpdate', expect.objectContaining({ id: person.id, birthDate: null }));
  });

  it('keeps using the person endpoint for an owned person', async () => {
    const person = personFactory.build({
      primaryProfile: { type: Type.UserPerson, id: 'person-1' },
    });
    const updated = { ...person, birthDate: '1990-06-15' };
    vi.mocked(updatePerson).mockResolvedValue(updated);

    await expect(handleUpdatePersonBirthDate(person, '1990-06-15')).resolves.toBe(true);

    expect(updatePerson).toHaveBeenCalledWith({ id: person.id, personUpdateDto: { birthDate: '1990-06-15' } });
    expect(updateSpacePerson).not.toHaveBeenCalled();
    expect(emitSpy).toHaveBeenCalledWith('PersonUpdate', updated);
  });

  it('handles failures from the shared space endpoint without emitting updates', async () => {
    const person = personFactory.build({
      primaryProfile: { type: Type.SpacePerson, id: 'space-person-1', spaceId: 'space-1' },
    });
    const error = new Error('no access');
    vi.mocked(updateSpacePerson).mockRejectedValue(error);

    await expect(handleUpdatePersonBirthDate(person, '1990-06-15')).resolves.toBeUndefined();

    expect(handleErrorSpy).toHaveBeenCalledWith(error, expect.any(String));
    expect(emitSpy).not.toHaveBeenCalled();
    expect(toastManager.primary).not.toHaveBeenCalled();
  });
});

describe('getPersonActions', () => {
  const $t = ((key: string) => key) as unknown as MessageFormatter;

  it('routes hiding a space-scoped person to the shared space endpoint', async () => {
    const person = personFactory.build({
      id: 'space-person-1',
      isHidden: false,
      primaryProfile: { type: Type.SpacePerson, id: 'space-person-1', spaceId: 'space-1' },
    });
    vi.mocked(updateSpacePerson).mockResolvedValue(spacePersonResponse({ isHidden: true }));

    const { HidePerson } = getPersonActions($t, person);
    await HidePerson.onAction(HidePerson);

    expect(updateSpacePerson).toHaveBeenCalledWith({
      id: 'space-1',
      personId: 'space-person-1',
      sharedSpacePersonUpdateDto: { isHidden: true },
    });
    expect(updatePerson).not.toHaveBeenCalled();
    expect(emitSpy).toHaveBeenCalledWith('PersonUpdate', expect.objectContaining({ id: person.id, isHidden: true }));
    expect(toastManager.primary).toHaveBeenCalledOnce();
  });

  it('routes unhiding a space-scoped person to the shared space endpoint', async () => {
    const person = personFactory.build({
      id: 'space-person-1',
      isHidden: true,
      primaryProfile: { type: Type.SpacePerson, id: 'space-person-1', spaceId: 'space-1' },
    });
    vi.mocked(updateSpacePerson).mockResolvedValue(spacePersonResponse({ isHidden: false }));

    const { ShowPerson } = getPersonActions($t, person);
    await ShowPerson.onAction(ShowPerson);

    expect(updateSpacePerson).toHaveBeenCalledWith({
      id: 'space-1',
      personId: 'space-person-1',
      sharedSpacePersonUpdateDto: { isHidden: false },
    });
    expect(emitSpy).toHaveBeenCalledWith('PersonUpdate', expect.objectContaining({ id: person.id, isHidden: false }));
  });

  it('keeps hiding an owned person on the person endpoint', async () => {
    const person = personFactory.build({
      isHidden: false,
      primaryProfile: { type: Type.UserPerson, id: 'person-1' },
    });
    const updated = { ...person, isHidden: true };
    vi.mocked(updatePerson).mockResolvedValue(updated);

    const { HidePerson } = getPersonActions($t, person);
    await HidePerson.onAction(HidePerson);

    expect(updatePerson).toHaveBeenCalledWith({ id: person.id, personUpdateDto: { isHidden: true } });
    expect(updateSpacePerson).not.toHaveBeenCalled();
    expect(emitSpy).toHaveBeenCalledWith('PersonUpdate', updated);
  });

  it('handles failures when hiding a space-scoped person without emitting updates', async () => {
    const person = personFactory.build({
      isHidden: false,
      primaryProfile: { type: Type.SpacePerson, id: 'space-person-1', spaceId: 'space-1' },
    });
    const error = new Error('no access');
    vi.mocked(updateSpacePerson).mockRejectedValue(error);

    const { HidePerson } = getPersonActions($t, person);
    await HidePerson.onAction(HidePerson);

    expect(handleErrorSpy).toHaveBeenCalledWith(error, expect.any(String));
    expect(emitSpy).not.toHaveBeenCalled();
    expect(toastManager.primary).not.toHaveBeenCalled();
  });

  it('does not offer favorite actions for a space-scoped person', () => {
    const person = personFactory.build({
      isFavorite: undefined,
      primaryProfile: { type: Type.SpacePerson, id: 'space-person-1', spaceId: 'space-1' },
    });

    const { Favorite, Unfavorite } = getPersonActions($t, person);

    expect(Favorite.$if?.()).toBe(false);
    expect(Unfavorite.$if?.()).toBe(false);
  });

  it('offers favorite actions for an owned person', () => {
    const person = personFactory.build({
      isFavorite: false,
      primaryProfile: { type: Type.UserPerson, id: 'person-1' },
    });

    const { Favorite } = getPersonActions($t, person);

    expect(Favorite.$if?.()).toBe(true);
  });
});

describe('isSpaceEditor', () => {
  const member = (userId: string, role: SharedSpaceRole): SharedSpaceMemberResponseDto => ({
    userId,
    role,
    email: `${userId}@test.dev`,
    name: userId,
    joinedAt: '2026-01-01T00:00:00Z',
    sharePersonMetadata: true,
    showInTimeline: true,
  });

  it('returns true for editors and owners', async () => {
    vi.mocked(getMembers).mockResolvedValue([member('user-1', SharedSpaceRole.Editor)]);
    await expect(isSpaceEditor('editor-space', 'user-1')).resolves.toBe(true);

    vi.mocked(getMembers).mockResolvedValue([member('user-1', SharedSpaceRole.Owner)]);
    await expect(isSpaceEditor('owner-space', 'user-1')).resolves.toBe(true);
  });

  it('returns false for viewers', async () => {
    vi.mocked(getMembers).mockResolvedValue([
      member('someone-else', SharedSpaceRole.Owner),
      member('user-1', SharedSpaceRole.Viewer),
    ]);

    await expect(isSpaceEditor('viewer-space', 'user-1')).resolves.toBe(false);

    expect(getMembers).toHaveBeenCalledWith({ id: 'viewer-space' });
  });

  it('fails open when the membership cannot be loaded', async () => {
    vi.mocked(getMembers).mockRejectedValue(new Error('network'));

    await expect(isSpaceEditor('unreachable-space', 'user-1')).resolves.toBe(true);
  });

  it('caches the result per space', async () => {
    vi.mocked(getMembers).mockResolvedValue([member('user-1', SharedSpaceRole.Viewer)]);

    await expect(isSpaceEditor('cached-space', 'user-1')).resolves.toBe(false);
    await expect(isSpaceEditor('cached-space', 'user-1')).resolves.toBe(false);

    expect(getMembers).toHaveBeenCalledTimes(1);
  });
});

describe('getPersonActions viewer gating', () => {
  const $t = ((key: string) => key) as unknown as MessageFormatter;
  const spaceProfile = { type: Type.SpacePerson, id: 'space-person-1', spaceId: 'space-1' };

  it('hides write actions for a space-scoped person when the user cannot edit', () => {
    const visible = personFactory.build({ isHidden: false, primaryProfile: spaceProfile });
    const hidden = personFactory.build({ isHidden: true, primaryProfile: spaceProfile });

    const { SetDateOfBirth, HidePerson } = getPersonActions($t, visible, { canEditSpacePerson: false });
    const { ShowPerson } = getPersonActions($t, hidden, { canEditSpacePerson: false });

    expect(SetDateOfBirth.$if?.()).toBe(false);
    expect(HidePerson.$if?.()).toBe(false);
    expect(ShowPerson.$if?.()).toBe(false);
  });

  it('offers write actions for a space-scoped person by default', () => {
    const person = personFactory.build({ isHidden: false, primaryProfile: spaceProfile });

    const { SetDateOfBirth, HidePerson } = getPersonActions($t, person);

    expect(SetDateOfBirth.$if?.()).not.toBe(false);
    expect(HidePerson.$if?.()).toBe(true);
  });

  it('keeps write actions for an owned person regardless of the flag', () => {
    const person = personFactory.build({
      isHidden: false,
      primaryProfile: { type: Type.UserPerson, id: 'person-1' },
    });

    const { SetDateOfBirth, HidePerson } = getPersonActions($t, person, { canEditSpacePerson: false });

    expect(SetDateOfBirth.$if?.()).not.toBe(false);
    expect(HidePerson.$if?.()).toBe(true);
  });
});

describe('representative face routing', () => {
  const spaceScopedPerson = (overrides: Parameters<typeof personFactory.build>[0] = {}) =>
    personFactory.build({
      id: 'space-person-1',
      primaryProfile: { type: Type.SpacePerson, id: 'space-person-1', spaceId: 'space-1' },
      ...overrides,
    });
  const facesPage: PersonFacePageResponseDto = { faces: [], hasNextPage: false };

  it('loads faces of a space-scoped person from the shared space endpoint', async () => {
    vi.mocked(getSpacePersonFaces).mockResolvedValue(facesPage);

    await expect(getPersonFacesPage(spaceScopedPerson(), { page: 2, size: 50 })).resolves.toEqual(facesPage);

    expect(getSpacePersonFaces).toHaveBeenCalledWith({ id: 'space-1', personId: 'space-person-1', page: 2, size: 50 });
    expect(getPersonFaces).not.toHaveBeenCalled();
  });

  it('loads faces of an owned person from the person endpoint', async () => {
    const person = personFactory.build({ primaryProfile: { type: Type.UserPerson, id: 'person-1' } });
    vi.mocked(getPersonFaces).mockResolvedValue(facesPage);

    await expect(getPersonFacesPage(person, { page: 1, size: 20 })).resolves.toEqual(facesPage);

    expect(getPersonFaces).toHaveBeenCalledWith({ id: person.id, page: 1, size: 20 });
    expect(getSpacePersonFaces).not.toHaveBeenCalled();
  });

  it('updates the representative face of a space-scoped person via the shared space endpoint', async () => {
    const person = spaceScopedPerson();
    vi.mocked(updateSpacePersonRepresentativeFace).mockResolvedValue(
      spacePersonResponse({ updatedAt: '2026-02-01T00:00:00Z' }),
    );

    const result = await updatePersonRepresentativeFace(person, 'face-1');

    expect(updateSpacePersonRepresentativeFace).toHaveBeenCalledWith({
      id: 'space-1',
      personId: 'space-person-1',
      spaceRepresentativeFaceUpdateDto: { assetFaceId: 'face-1' },
    });
    expect(updateRepresentativeFace).not.toHaveBeenCalled();
    expect(result).toEqual(expect.objectContaining({ id: person.id, updatedAt: '2026-02-01T00:00:00Z' }));
  });

  it('updates the representative face of an owned person via the person endpoint', async () => {
    const person = personFactory.build({ primaryProfile: { type: Type.UserPerson, id: 'person-1' } });
    const updated = { ...person, updatedAt: '2026-02-01T00:00:00Z' };
    vi.mocked(updateRepresentativeFace).mockResolvedValue(updated);

    await expect(updatePersonRepresentativeFace(person, 'face-1')).resolves.toEqual(updated);

    expect(updateRepresentativeFace).toHaveBeenCalledWith({
      id: person.id,
      representativeFaceUpdateDto: { assetFaceId: 'face-1' },
    });
    expect(updateSpacePersonRepresentativeFace).not.toHaveBeenCalled();
  });

  it('builds face thumbnail URLs for space-scoped and owned people', () => {
    const spacePerson = spaceScopedPerson();
    const ownedPerson = personFactory.build({ primaryProfile: { type: Type.UserPerson, id: 'person-1' } });

    expect(getPersonFaceThumbnail(spacePerson, 'face-1')).toBe(
      getSpacePersonFaceThumbnailUrl('space-1', 'space-person-1', 'face-1', spacePerson.updatedAt),
    );
    expect(getPersonFaceThumbnail(ownedPerson, 'face-2')).toBe(
      getPersonFaceThumbnailUrl(ownedPerson.id, 'face-2', ownedPerson.updatedAt),
    );
  });
});

describe('updatePersonName', () => {
  it('routes renames of a space-scoped person to the shared space endpoint', async () => {
    const person = personFactory.build({
      id: 'space-person-1',
      name: 'Old Name',
      numberOfAssets: 5,
      primaryProfile: { type: Type.SpacePerson, id: 'space-person-1', spaceId: 'space-1' },
    });
    vi.mocked(updateSpacePerson).mockResolvedValue(spacePersonResponse({ name: 'New Name', assetCount: 12 }));

    const updated = await updatePersonName(person, 'New Name');

    expect(updateSpacePerson).toHaveBeenCalledWith({
      id: 'space-1',
      personId: 'space-person-1',
      sharedSpacePersonUpdateDto: { name: 'New Name' },
    });
    expect(updatePerson).not.toHaveBeenCalled();
    expect(updated).toEqual(
      expect.objectContaining({
        id: person.id,
        name: 'New Name',
        numberOfAssets: 12,
        updatedAt: '2026-01-02T00:00:00Z',
      }),
    );
  });

  it('keeps renames of an owned person on the person endpoint', async () => {
    const person = personFactory.build({
      primaryProfile: { type: Type.UserPerson, id: 'person-1' },
    });
    const response = { ...person, name: 'New Name' };
    vi.mocked(updatePerson).mockResolvedValue(response);

    await expect(updatePersonName(person, 'New Name')).resolves.toEqual(response);

    expect(updatePerson).toHaveBeenCalledWith({ id: person.id, personUpdateDto: { name: 'New Name' } });
    expect(updateSpacePerson).not.toHaveBeenCalled();
  });
});
