import type { GalleryDispatchResult, GalleryMethodArgs } from './contract.js';

type HostResult<T> = { success: true; response: T } | { success: false; status: number; message: string };

/**
 * Calls the fork's single generic host function.
 *
 * The server-side dispatcher never throws for user-fixable conditions, so `success: false` here
 * means something genuinely unexpected happened — which must fail the run rather than be swallowed.
 */
export const gallery =
  (authToken: string) =>
  <M extends keyof GalleryMethodArgs>(method: M, args: GalleryMethodArgs[M]): GalleryDispatchResult => {
    const host = Host.getFunctions();
    const input = Memory.fromString(JSON.stringify({ authToken, args: [method, args] }));
    const handle = Memory.find(host.gallery(input.offset));

    try {
      const result = JSON.parse(handle.readString()) as HostResult<GalleryDispatchResult>;
      if (!result.success) {
        throw new Error(`gallery(${method}) failed with ${result.status}: ${JSON.stringify(result.message)}`);
      }

      return result.response;
    } finally {
      handle.free();
      input.free();
    }
  };
