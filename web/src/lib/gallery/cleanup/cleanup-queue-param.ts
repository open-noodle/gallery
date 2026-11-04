const CLEANUP_QUEUES = new Set(['space-hogs', 'bursts', 'screenshots', 'blurry']);

/** Route matcher for `[queue=cleanupQueue]`, registered in `src/params.ts`. */
export const matchCleanupQueue = (param: string) => (CLEANUP_QUEUES.has(param) ? param : undefined);
