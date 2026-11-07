import { sdkMock } from '#lib/gallery/__mocks__/sdk.mock.ts';
import { factory } from '#test/unit/factories.ts';
import { spacesApiMock } from './spaces-api.mock';

// sdk.mock.ts registers its `@immich/sdk` mock only when it is evaluated, after the real SDK has already
// loaded (its own import and the factories load it first). Hoist the same mock here.
vi.mock('@immich/sdk', async (importOriginal) => {
  const module = await importOriginal<typeof import('@immich/sdk')>();
  const mocks = Object.fromEntries(
    Object.entries(module)
      .filter(([, value]) => typeof value === 'function')
      .map(([key]) => [key, vi.fn()]),
  );
  return { ...module, ...mocks };
});

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
