/**
 * A REACTIVE stand-in for `$app/state`'s `page`.
 *
 * A plain `vi.hoisted({ mockPage: { url: new URL(…) } })` object pins hydrate-on-mount and goto()
 * arguments, but it registers no signal: a Svelte 5 `$effect` reading `page.url.search` never
 * re-runs when a test reassigns `mockPage.url`. A page whose filters are URL-backed has an $effect
 * exactly like that (re-hydrate on back/forward, on a shared link, and on the `?at=` write that
 * closing the asset viewer performs), so testing it needs `url` to be `$state`.
 *
 * Real `page` from $app/state IS reactive, so this is the faithful mock, not a convenience one.
 */
class ReactivePageMock {
  url = $state(new URL('https://gallery.test/'));
  route = $state<{ id: string | null }>({ id: null });
  params = $state<Record<string, string>>({});

  reset(url: string, options: { routeId?: string | null; params?: Record<string, string> } = {}) {
    this.url = new URL(url);
    this.route = { id: options.routeId ?? null };
    this.params = options.params ?? {};
  }
}

export const reactivePageMock = new ReactivePageMock();
