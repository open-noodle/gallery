import { afterEach, describe, expect, it } from 'vitest';
import { authManager } from './auth-manager.svelte';

const user = (isAdmin: boolean) =>
  ({
    id: 'user-1',
    email: 'demo@gallery.app',
    name: 'Demo User',
    isAdmin,
  }) as never;

describe('AuthManager demo admin preview', () => {
  afterEach(() => {
    authManager.isDemo = false;
    authManager.reset();
  });

  it('lets real admins preview admin', () => {
    authManager.setUser(user(true));
    authManager.setPreferences({} as never);

    expect(authManager.canPreviewAdmin).toBe(true);
    expect(authManager.isReadOnlyDemo).toBe(false);
  });

  it('lets demo non-admin users preview admin without becoming admin', () => {
    authManager.isDemo = true;
    authManager.setUser(user(false));
    authManager.setPreferences({} as never);

    expect(authManager.user.isAdmin).toBe(false);
    expect(authManager.canPreviewAdmin).toBe(true);
    expect(authManager.isReadOnlyDemo).toBe(true);
  });

  it('does not let normal non-admin users preview admin', () => {
    authManager.setUser(user(false));
    authManager.setPreferences({} as never);

    expect(authManager.canPreviewAdmin).toBe(false);
    expect(authManager.isReadOnlyDemo).toBe(false);
  });

  it('clears demo read-only status on reset', () => {
    authManager.isDemo = true;
    authManager.setUser(user(false));
    authManager.setPreferences({} as never);

    authManager.reset();

    expect(authManager.canPreviewAdmin).toBe(false);
    expect(authManager.isReadOnlyDemo).toBe(false);
  });
});
