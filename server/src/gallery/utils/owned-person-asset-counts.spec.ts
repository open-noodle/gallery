import { describe, expect, it, vi } from 'vitest';
import { AuthDto } from 'src/dtos/auth.dto.js';
import { PersonResponseDto } from 'src/dtos/person.dto.js';
import { withOwnedPersonAssetCounts } from 'src/gallery/utils/owned-person-asset-counts.js';

const person = (id: string) => ({ id, name: id }) as PersonResponseDto;
const auth = (stockClient?: true) => ({ user: { id: 'owner' }, stockClient }) as AuthDto;

describe(withOwnedPersonAssetCounts.name, () => {
  it('adds the counted photos to each person and leaves uncounted people without the field', async () => {
    const repository = { getOwnedPersonAssetCounts: vi.fn().mockResolvedValue(new Map([['a', 5]])) };

    const people = await withOwnedPersonAssetCounts(repository, auth(), [person('a'), person('b')]);

    expect(repository.getOwnedPersonAssetCounts).toHaveBeenCalledWith('owner', ['a', 'b']);
    expect(people).toEqual([
      { id: 'a', name: 'a', numberOfAssets: 5 },
      { id: 'b', name: 'b' },
    ]);
  });

  it('returns upstream’s list to a stock client without querying', async () => {
    const repository = { getOwnedPersonAssetCounts: vi.fn() };
    const list = [person('a')];

    await expect(withOwnedPersonAssetCounts(repository, auth(true), list)).resolves.toBe(list);
    expect(repository.getOwnedPersonAssetCounts).not.toHaveBeenCalled();
  });

  it('skips the query for an empty page', async () => {
    const repository = { getOwnedPersonAssetCounts: vi.fn() };

    await expect(withOwnedPersonAssetCounts(repository, auth(), [])).resolves.toEqual([]);
    expect(repository.getOwnedPersonAssetCounts).not.toHaveBeenCalled();
  });
});
