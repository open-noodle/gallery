import { eventManager } from '$lib/managers/event-manager.svelte';
import * as handleErrorModule from '$lib/utils/handle-error';
import {
  RepresentativeFaceSource,
  Type,
  updatePerson,
  updateSpacePerson,
  type SharedSpacePersonResponseDto,
} from '@immich/sdk';
import { toastManager } from '@immich/ui';
import { personFactory } from '@test-data/factories/person-factory';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { handleUpdatePersonBirthDate } from './person.service';

vi.mock('@immich/ui', async (orig) => {
  const actual = await orig<typeof import('@immich/ui')>();
  return {
    ...actual,
    toastManager: { primary: vi.fn(), danger: vi.fn(), warning: vi.fn(), success: vi.fn(), info: vi.fn() },
  };
});

vi.mock('@immich/sdk', async (orig) => ({
  ...(await orig<typeof import('@immich/sdk')>()),
  updatePerson: vi.fn(),
  updateSpacePerson: vi.fn(),
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
