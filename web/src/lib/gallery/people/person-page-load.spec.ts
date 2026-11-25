import { sdkMock } from '#lib/gallery/__mocks__/sdk.mock.ts';

const { getPersonOrUnavailable, spacePersonRouteFor } = await import('./person-page-load');

const httpError = (status: number) => Object.assign(new Error('server detail'), { status });

describe('getPersonOrUnavailable', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    sdkMock.isHttpError.mockImplementation((value) => typeof (value as { status?: unknown }).status === 'number');
  });

  it('returns the person', async () => {
    const person = { id: 'person-1' };
    sdkMock.getPerson.mockResolvedValue(person as never);

    await expect(getPersonOrUnavailable('person-1')).resolves.toBe(person);
  });

  it.each([400, 404])('turns a %s into the unavailable page without the server detail', async (status) => {
    sdkMock.getPerson.mockRejectedValue(httpError(status));

    await expect(getPersonOrUnavailable('person-1')).rejects.toMatchObject({
      status: 404,
      body: { message: 'Person unavailable' },
    });
  });

  it.each([401, 500])('keeps a %s as a real error', async (status) => {
    const failure = httpError(status);
    sdkMock.getPerson.mockRejectedValue(failure);

    await expect(getPersonOrUnavailable('person-1')).rejects.toBe(failure);
  });
});

describe('spacePersonRouteFor', () => {
  const opened = { id: 'owner-person', primaryProfile: { type: 'space-person', id: 'space-person', spaceId: 'space' } };

  it('sends another member to the space page for that person', () => {
    expect(spacePersonRouteFor(opened as never, new URL('https://g.test/people/owner-person'))).toBe(
      '/spaces/space/people/space-person',
    );
  });

  it('keeps the open photo and the query', () => {
    expect(
      spacePersonRouteFor(
        opened as never,
        new URL('https://g.test/people/owner-person/photos/a?previousRoute=%2Fx'),
        'a',
      ),
    ).toBe('/spaces/space/people/space-person/photos/a?previousRoute=%2Fx');
  });

  it.each([
    ['a personal person', { id: 'p' }],
    ['a person owned by the viewer', { id: 'p', primaryProfile: { type: 'user-person', id: 'p' } }],
    [
      'a page already opened through the space profile',
      { id: 's', primaryProfile: { type: 'space-person', id: 's', spaceId: 'x' } },
    ],
  ])('leaves %s on the people page', (_name, person) => {
    expect(spacePersonRouteFor(person as never, new URL('https://g.test/people/p'))).toBeUndefined();
  });
});
