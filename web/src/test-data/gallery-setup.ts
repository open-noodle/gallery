import { defaultPublicConfig, defaultUserConfig } from '@test-data/gallery-config-defaults';

/**
 * Gallery test setup (loaded after upstream's setup.ts). Upstream moved the user and public config
 * onto preloaded queries (immich-32498), so a component reading them throws "config/... must be
 * loaded first" unless the cache is filled. Upstream's specs fill it per test; the fork's many
 * component specs written before the move get these defaults instead. A spec that needs other
 * values still calls queryClient.setQueryData itself.
 *
 * The app modules are imported inside beforeEach, never at the top: a setup file runs before a spec's
 * hoisted vi.mock calls take effect, so a static import here would load e.g. handle-error.ts against
 * the real @immich/ui and silently bypass the spec's toast mocks.
 */
beforeEach(async () => {
  let modules;
  try {
    modules = await Promise.all([
      import('$lib/queries/client'),
      import('$lib/queries/config-public.query'),
      import('$lib/queries/config-user.query'),
      import('$lib/queries/notification.query'),
    ]);
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
