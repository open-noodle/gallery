/**
 * Lazily load a component, without using an `{#await}` block.
 *
 * `{#await}` must not be used to mount a lazy-loaded component. When such a block resolves while
 * Svelte is already flushing — which is exactly what happens on a reopen, once the module is warm
 * in the module cache — its resolution path creates a batch that nothing ever flushes. The batch
 * has already flipped CLEAN flags on the shared effect tree, so every later update bails out and
 * the mounted subtree stops reacting entirely until a page reload. That is what made the asset
 * viewer come back stale (previous photo's people, no map, no tags, blurry image) on reopen.
 *
 * Resolving the import in a plain promise callback instead keeps the state write on its own tick,
 * where Svelte schedules a flush for it normally. Code splitting is unaffected: the dynamic
 * `import()` is still what creates the chunk.
 *
 * Upstream bug: https://github.com/sveltejs/svelte/issues/18546
 */
export function lazyComponent<T>(load: () => Promise<{ default: T }>) {
  let component = $state<T | undefined>();
  let loading = false;

  return {
    /**
     * `undefined` until the module has loaded. Reading this is what starts the load, so a component
     * behind an `{#if}` only pulls its chunk once that branch is actually rendered — the same
     * laziness an `{#await}` block inside the branch used to give us.
     */
    get current() {
      if (!loading) {
        loading = true;
        void load().then((module) => {
          component = module.default;
        });
      }

      return component;
    },
  };
}
