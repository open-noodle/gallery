import { defaultPublicConfig, defaultUserConfig } from '#test/unit/gallery-config-defaults.ts';

/**
Gallery test setup (loaded after upstream's setup.ts). Upstream moved the user and public config
onto preloaded queries (immich-32498), so a component reading them throws "config/... must be
loaded first" unless the cache is filled. Upstream's specs fill it per test; the fork's many
component specs written before the move get these defaults instead. A spec that needs other
values still calls queryClient.setQueryData itself.

The app modules are imported inside beforeEach, never at the top: a setup file runs before a spec's
hoisted vi.mock calls take effect, so a static import here would load e.g. handle-error.ts against
the real @immich/ui and silently bypass the spec's toast mocks.
*/

beforeEach(async () => {
  // A spec on upstream's page fixtures (#test/unit/fixtures.ts) has already loaded the config from its mock data
  // (Mock.setup runs before this hook); clearing the cache here would replace that data with the defaults.
  const { MockRouter } = await import('#test/unit/mocks/router.ts');
  try {
    void MockRouter.instance;
    return;
  } catch {
    // No page fixture: the spec renders components directly and gets the defaults.
  }
  const imports = [
    import('#lib/queries/client.ts'),
    import('#lib/queries/config-public.query.ts'),
    import('#lib/queries/config-user.query.ts'),
    import('#lib/queries/notification.query.ts'),
  ] as const;
  // Let every import settle before going on. When one rejects (a spec's `@immich/sdk` mock without
  // `getPublicConfig` fails to link in milliseconds), Promise.all returns while the others are still
  // fetching their module graphs. The spec can then finish and its iframe be removed with those
  // fetches in flight. Vitest holds a request for a factory-mocked module (`$app/navigation`,
  // `$app/state`) until the iframe returns the factory's keys. Once the iframe is gone, that request
  // rejects in the Vitest process ("Browser connection was closed ... rpc is closed, cannot call
  // resolveManualMock") and the whole run aborts.
  await Promise.allSettled(imports);
  let modules;
  try {
    modules = await Promise.all(imports);
  } catch {
    // The spec mocks one of these modules' dependencies (e.g. the event manager) out of shape: it
    // owns its query setup, so the shared defaults do not apply.
    return;
  }
  const [clientModule, { getPublicConfigQuery }, { getUserConfigQuery }, { getNotificationsQuery }] = modules;
  let queryClient: (typeof clientModule)['queryClient'];
  try {
    // Throws on a vi.mock that does not export queryClient: the spec replaced the client itself.
    queryClient = clientModule.queryClient;
  } catch {
    return;
  }
  if (typeof queryClient?.clear !== 'function') {
    return;
  }
  // One query client serves the whole test file; start every test from an empty cache.
  queryClient.clear();
  queryClient.setQueryData(getUserConfigQuery().queryKey, defaultUserConfig);
  queryClient.setQueryData(getPublicConfigQuery().queryKey, defaultPublicConfig);
  // Upstream's NavigationBar reads unread notifications through a query; without data it fetches.
  queryClient.setQueryData(getNotificationsQuery().queryKey, []);
});
