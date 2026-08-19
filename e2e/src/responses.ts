import { expect } from 'vitest';

export const errorDto = {
  // Upstream #30870 moved its own route-auth and validation assertions out of e2e and into
  // controller/medium specs, and stripped errorDto down to `badRequest`. Gallery's fork-only
  // suites (shared-space, user-group, classification, video-trim, asset-copy, asset-edits,
  // asset-replace-jobs-bulk, pet-detection, plugin) still assert these shapes from e2e, so the
  // four members they use are kept here. The other seven upstream removed — and `deviceDto` —
  // have no remaining caller and were dropped with upstream.
  unauthorized: {
    message: 'Authentication required',
  },
  forbidden: {
    message: expect.any(String),
  },
  badRequest: (message: any = null) => ({
    message: message ?? expect.anything(),
  }),
  validationError: (errors?: ReadonlyArray<{ path: ReadonlyArray<string | number>; message: string }>) => ({
    message: 'Validation failed',
    errors: errors ? expect.arrayContaining(errors.map((e) => expect.objectContaining(e))) : expect.any(Array),
  }),
  noPermission: {
    message: expect.stringContaining('Not found or no'),
  },
};
