import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { AuthDto } from 'src/dtos/auth.dto';
import { AuthRequest } from 'src/middleware/auth.guard';
import { AgentRunnerToolTokenService } from 'src/services/agent-runner-tool-token.service';

const INVALID_TOKEN = 'Invalid agent runner token';

@Injectable()
export class AgentRunnerTokenGuard implements CanActivate {
  constructor(private readonly tokenService: AgentRunnerToolTokenService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AuthRequest>();
    const token = this.getBearerToken(request.headers.authorization);
    const claims = this.tokenService.verify(token);
    if (claims.sessionId !== request.params.id) {
      throw new UnauthorizedException(INVALID_TOKEN);
    }

    request.user = { user: { id: claims.userId } } as AuthDto;
    return true;
  }

  private getBearerToken(authorization: string | undefined) {
    if (!authorization) {
      throw new UnauthorizedException(INVALID_TOKEN);
    }

    const [scheme, token, extra] = authorization.split(' ');
    if (scheme !== 'Bearer' || !token || extra !== undefined) {
      throw new UnauthorizedException(INVALID_TOKEN);
    }

    return token;
  }
}
