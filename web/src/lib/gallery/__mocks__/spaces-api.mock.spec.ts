import { sdkMock } from '#lib/__mocks__/sdk.mock.ts';
import { factory } from '#test/unit/factories.ts';
import { spacesApiMock } from './spaces-api.mock';

describe('spaces API mock', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('should configure getAllSpaces to return factory data', async () => {
    const spaces = factory.many(3, () => factory.sharedSpace());
    spacesApiMock.getAllSpaces(spaces);

    const result = await sdkMock.getAllSpaces();
    expect(result).toEqual(spaces);
    expect(sdkMock.getAllSpaces).toHaveBeenCalledOnce();
  });

  it('should configure getSpace to return a single space', async () => {
    const space = factory.sharedSpace({ name: 'My Space' });
    spacesApiMock.getSpace(space);

    const result = await sdkMock.getSpace({ id: space.id });
    expect(result).toEqual(space);
  });

  it('should configure createSpace to return the new space', async () => {
    const space = factory.sharedSpace({ name: 'New Space' });
    spacesApiMock.createSpace(space);

    const result = await sdkMock.createSpace({ sharedSpaceCreateDto: { name: 'New Space' } });
    expect(result).toEqual(space);
  });

  it('should configure removeSpace as void resolved', async () => {
    spacesApiMock.removeSpace();
    await expect(sdkMock.removeSpace({ id: 'some-id' })).resolves.not.toThrow();
  });
});
