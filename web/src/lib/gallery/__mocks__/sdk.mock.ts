// Gallery: upstream deleted its sdk mock with immich-33008 in favour of the `api` fixture
// (`#test/unit/fixtures.ts`). The fork's unit specs written against it keep this copy.
import * as sdk from '@immich/sdk';
import type { Mock, MockedObject } from 'vitest';

// eslint-disable-next-line unicorn/no-top-level-side-effects
vi.mock('@immich/sdk', async (originalImport) => {
  const module = await originalImport<typeof import('@immich/sdk')>();

  const mocks: Record<string, Mock> = {};
  for (const [key, value] of Object.entries(module)) {
    if (typeof value === 'function') {
      mocks[key] = vi.fn();
    }
  }

  const mock = { ...module, ...mocks };
  return { ...mock, default: mock };
});

export const sdkMock = sdk as MockedObject<typeof sdk>;
