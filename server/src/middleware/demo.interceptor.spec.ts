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
});
