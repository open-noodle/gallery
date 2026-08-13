import { CallHandler, ExecutionContext, ForbiddenException, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import { AuthRequest } from 'src/middleware/auth.guard';
import { ConfigRepository } from 'src/repositories/config.repository';
import { isDemoReadOnlyPostRoute } from 'src/utils/demo-preview';

const SAFE_POST_PREFIXES = ['/api/auth/', '/api/search/', '/api/download/'];

const SAFE_PUT_PREFIXES = ['/api/users/me/preferences', '/api/users/me/onboarding'];

@Injectable()
export class DemoInterceptor implements NestInterceptor {
  constructor(private configRepository: ConfigRepository) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const { demo } = this.configRepository.getEnv();
    if (!demo.enabled) {
      return next.handle();
    }

    const request = context.switchToHttp().getRequest<AuthRequest>();

    // Allow all sync endpoints (GET, POST, DELETE) for mobile app
    if (request.path.startsWith('/api/sync/')) {
      return next.handle();
    }

    const method = request.method;
    if (method === 'GET') {
      return next.handle();
    }

    if (method === 'POST' && SAFE_POST_PREFIXES.some((prefix) => request.path.startsWith(prefix))) {
      return next.handle();
    }

    // Exact-path, POST-only: the handful of routes that read but cannot be GETs. Unlike SAFE_POST_PREFIXES
    // above this is anchored, so nothing below the route rides in with it. Admin-route access is still
    // decided separately by AuthService's demo preview branch, which consults the same list.
    if (method === 'POST' && isDemoReadOnlyPostRoute(request.path)) {
      return next.handle();
    }

    if (method === 'PUT' && SAFE_PUT_PREFIXES.some((prefix) => request.path.startsWith(prefix))) {
      return next.handle();
    }

    throw new ForbiddenException('This action is not available in demo mode');
  }
}
