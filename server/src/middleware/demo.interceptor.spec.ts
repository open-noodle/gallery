import { CallHandler, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { of } from 'rxjs';
import { DemoInterceptor } from 'src/middleware/demo.interceptor';
import { ConfigRepository } from 'src/repositories/config.repository';

const createContext = (method: string, path: string, user?: { email: string; isAdmin?: boolean }) => {
  const request = {
    method,
    path,
    user: user ? { user: { email: user.email, isAdmin: user.isAdmin ?? false } } : undefined,
  };
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
};

describe('DemoInterceptor', () => {
  let interceptor: DemoInterceptor;
  let configRepository: { getEnv: ReturnType<typeof vi.fn> };
  let callHandler: CallHandler;

  beforeEach(() => {
    configRepository = { getEnv: vi.fn() };
    callHandler = { handle: vi.fn().mockReturnValue(of({})) };
    interceptor = new DemoInterceptor(configRepository as unknown as ConfigRepository);
  });

  it('should allow all requests when demo mode is off', () => {
    configRepository.getEnv.mockReturnValue({ demo: { enabled: false, email: '', password: '' } });
    const context = createContext('DELETE', '/api/assets', { email: 'demo@test.com' });
    interceptor.intercept(context, callHandler);
    expect(callHandler.handle).toHaveBeenCalled();
  });

  it('should block mutating requests for admin users in demo mode', () => {
    configRepository.getEnv.mockReturnValue({ demo: { enabled: true, email: 'demo@test.com', password: '' } });
    const context = createContext('DELETE', '/api/assets', { email: 'admin@test.com', isAdmin: true });

    expect(() => interceptor.intercept(context, callHandler)).toThrow(ForbiddenException);
    expect(callHandler.handle).not.toHaveBeenCalled();
  });

  it('should allow GET requests for admin users in demo mode', () => {
    configRepository.getEnv.mockReturnValue({ demo: { enabled: true, email: 'demo@test.com', password: '' } });
    const context = createContext('GET', '/api/admin/users', { email: 'admin@test.com', isAdmin: true });

    interceptor.intercept(context, callHandler);

    expect(callHandler.handle).toHaveBeenCalled();
  });

  it('should allow GET requests for demo user', () => {
    configRepository.getEnv.mockReturnValue({ demo: { enabled: true, email: 'demo@test.com', password: '' } });
    const context = createContext('GET', '/api/assets', { email: 'demo@test.com' });
    interceptor.intercept(context, callHandler);
    expect(callHandler.handle).toHaveBeenCalled();
  });

  it('should allow POST /search/metadata for demo user', () => {
    configRepository.getEnv.mockReturnValue({ demo: { enabled: true, email: 'demo@test.com', password: '' } });
    const context = createContext('POST', '/api/search/metadata', { email: 'demo@test.com' });
    interceptor.intercept(context, callHandler);
    expect(callHandler.handle).toHaveBeenCalled();
  });

  it('should block POST /assets for demo user', () => {
    configRepository.getEnv.mockReturnValue({ demo: { enabled: true, email: 'demo@test.com', password: '' } });
    const context = createContext('POST', '/api/assets', { email: 'demo@test.com' });
    expect(() => interceptor.intercept(context, callHandler)).toThrow(ForbiddenException);
  });

  it('should block DELETE requests for demo user', () => {
    configRepository.getEnv.mockReturnValue({ demo: { enabled: true, email: 'demo@test.com', password: '' } });
    const context = createContext('DELETE', '/api/assets', { email: 'demo@test.com' });
    expect(() => interceptor.intercept(context, callHandler)).toThrow(ForbiddenException);
  });

  it('should block PUT requests for demo user', () => {
    configRepository.getEnv.mockReturnValue({ demo: { enabled: true, email: 'demo@test.com', password: '' } });
    const context = createContext('PUT', '/api/assets', { email: 'demo@test.com' });
    expect(() => interceptor.intercept(context, callHandler)).toThrow(ForbiddenException);
  });

  it('should allow POST /download/info for demo user', () => {
    configRepository.getEnv.mockReturnValue({ demo: { enabled: true, email: 'demo@test.com', password: '' } });
    const context = createContext('POST', '/api/download/info', { email: 'demo@test.com' });
    interceptor.intercept(context, callHandler);
    expect(callHandler.handle).toHaveBeenCalled();
  });

  it('should allow POST /auth/logout for demo user', () => {
    configRepository.getEnv.mockReturnValue({ demo: { enabled: true, email: 'demo@test.com', password: '' } });
    const context = createContext('POST', '/api/auth/logout', { email: 'demo@test.com' });
    interceptor.intercept(context, callHandler);
    expect(callHandler.handle).toHaveBeenCalled();
  });

  it('should allow POST /auth/validateToken for demo user', () => {
    configRepository.getEnv.mockReturnValue({ demo: { enabled: true, email: 'demo@test.com', password: '' } });
    const context = createContext('POST', '/api/auth/validateToken', { email: 'demo@test.com' });
    interceptor.intercept(context, callHandler);
    expect(callHandler.handle).toHaveBeenCalled();
  });

  it('should allow POST /auth/change-password for demo user', () => {
    configRepository.getEnv.mockReturnValue({ demo: { enabled: true, email: 'demo@test.com', password: '' } });
    const context = createContext('POST', '/api/auth/change-password', { email: 'demo@test.com' });
    interceptor.intercept(context, callHandler);
    expect(callHandler.handle).toHaveBeenCalled();
  });

  it('should allow PUT /users/me/preferences for demo user', () => {
    configRepository.getEnv.mockReturnValue({ demo: { enabled: true, email: 'demo@test.com', password: '' } });
    const context = createContext('PUT', '/api/users/me/preferences', { email: 'demo@test.com' });
    interceptor.intercept(context, callHandler);
    expect(callHandler.handle).toHaveBeenCalled();
  });

  it('should allow PUT /users/me/onboarding for demo user', () => {
    configRepository.getEnv.mockReturnValue({ demo: { enabled: true, email: 'demo@test.com', password: '' } });
    const context = createContext('PUT', '/api/users/me/onboarding', { email: 'demo@test.com' });
    interceptor.intercept(context, callHandler);
    expect(callHandler.handle).toHaveBeenCalled();
  });

  // The one POST that is a READ. Listing a person's cluster takes an exclude-list body, so it could not be a
  // GET; blocking it here is what made the Face Repair console's manual review page report an empty cluster
  // for every person on the demo. It is matched by exact anchored path, NOT by prefix like SAFE_POST_PREFIXES
  // above — the tests below are what hold that distinction in place.
  it('should allow the cluster-faces POST for demo user', () => {
    configRepository.getEnv.mockReturnValue({ demo: { enabled: true, email: 'demo@test.com', password: '' } });
    const context = createContext('POST', '/api/admin/face-repair/scan/person/person-id/cluster-faces', {
      email: 'demo@test.com',
    });
    interceptor.intercept(context, callHandler);
    expect(callHandler.handle).toHaveBeenCalled();
  });

  it('should still block every other face-repair POST for demo user', () => {
    configRepository.getEnv.mockReturnValue({ demo: { enabled: true, email: 'demo@test.com', password: '' } });
    for (const path of [
      '/api/admin/face-repair/resolve',
      '/api/admin/face-repair/scan',
      '/api/admin/face-repair/unconfirm',
      '/api/admin/face-repair/scan/person/person-id',
    ]) {
      expect(() => interceptor.intercept(createContext('POST', path, { email: 'demo@test.com' }), callHandler)).toThrow(
        ForbiddenException,
      );
    }
    expect(callHandler.handle).not.toHaveBeenCalled();
  });

  // Anchoring guard: a prefix match would open every path BELOW cluster-faces too.
  it('should block a path that merely starts with the cluster-faces route', () => {
    configRepository.getEnv.mockReturnValue({ demo: { enabled: true, email: 'demo@test.com', password: '' } });
    const context = createContext('POST', '/api/admin/face-repair/scan/person/person-id/cluster-faces/delete', {
      email: 'demo@test.com',
    });
    expect(() => interceptor.intercept(context, callHandler)).toThrow(ForbiddenException);
  });

  it('should not open the cluster-faces route to other mutating methods', () => {
    configRepository.getEnv.mockReturnValue({ demo: { enabled: true, email: 'demo@test.com', password: '' } });
    for (const method of ['DELETE', 'PUT', 'PATCH']) {
      const context = createContext(method, '/api/admin/face-repair/scan/person/person-id/cluster-faces', {
        email: 'demo@test.com',
      });
      expect(() => interceptor.intercept(context, callHandler)).toThrow(ForbiddenException);
    }
  });
});
