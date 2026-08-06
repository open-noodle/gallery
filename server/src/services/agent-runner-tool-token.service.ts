import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { ConfigRepository } from 'src/repositories/config.repository';

type AgentRunnerToolTokenClaims = {
  sessionId: string;
  userId: string;
  expiresAt: Date;
};

type EncodedAgentRunnerToolTokenClaims = {
  sessionId: unknown;
  userId: unknown;
  expiresAt: unknown;
};

const FORMAT_VERSION = 'v1';
const BASE64URL_PATTERN = /^[\w-]+$/;
const INVALID_TOKEN = 'Invalid agent runner token';

@Injectable()
export class AgentRunnerToolTokenService {
  constructor(private readonly configRepository: ConfigRepository) {}

  create(input: AgentRunnerToolTokenClaims): string {
    const encodedClaims = Buffer.from(
      JSON.stringify({
        sessionId: input.sessionId,
        userId: input.userId,
        expiresAt: input.expiresAt.toISOString(),
      }),
    ).toString('base64url');

    return [FORMAT_VERSION, encodedClaims, this.sign(encodedClaims)].join('.');
  }

  verify(token: string, now = new Date()): AgentRunnerToolTokenClaims {
    const [version, encodedClaims, signature, extra] = token.split('.');
    if (version !== FORMAT_VERSION || !encodedClaims || !signature || extra !== undefined) {
      throw new UnauthorizedException(INVALID_TOKEN);
    }

    if (!BASE64URL_PATTERN.test(encodedClaims) || !BASE64URL_PATTERN.test(signature)) {
      throw new UnauthorizedException(INVALID_TOKEN);
    }

    const expectedSignature = this.signForVerify(encodedClaims);
    if (!this.safeEqual(signature, expectedSignature)) {
      throw new UnauthorizedException(INVALID_TOKEN);
    }

    const claims = this.parseClaims(encodedClaims);
    if (claims.expiresAt.getTime() <= now.getTime()) {
      throw new UnauthorizedException('Agent runner token expired');
    }

    return claims;
  }

  private parseClaims(encodedClaims: string): AgentRunnerToolTokenClaims {
    let payload: EncodedAgentRunnerToolTokenClaims;

    try {
      payload = JSON.parse(Buffer.from(encodedClaims, 'base64url').toString('utf8'));
    } catch {
      throw new UnauthorizedException(INVALID_TOKEN);
    }

    if (
      !payload ||
      typeof payload.sessionId !== 'string' ||
      typeof payload.userId !== 'string' ||
      typeof payload.expiresAt !== 'string'
    ) {
      throw new UnauthorizedException(INVALID_TOKEN);
    }

    const expiresAt = new Date(payload.expiresAt);
    if (Number.isNaN(expiresAt.getTime())) {
      throw new UnauthorizedException(INVALID_TOKEN);
    }

    return {
      sessionId: payload.sessionId,
      userId: payload.userId,
      expiresAt,
    };
  }

  private sign(encodedClaims: string) {
    const secretKey = this.configRepository.getEnv().agent.secretKey;
    if (!secretKey) {
      throw new BadRequestException('Agent credential encryption key is not configured');
    }

    return createHmac('sha256', secretKey).update(encodedClaims).digest('base64url');
  }

  private signForVerify(encodedClaims: string) {
    try {
      return this.sign(encodedClaims);
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw new UnauthorizedException(INVALID_TOKEN);
      }

      throw error;
    }
  }

  private safeEqual(value: string, expected: string) {
    const valueBuffer = Buffer.from(value, 'base64url');
    const expectedBuffer = Buffer.from(expected, 'base64url');
    return valueBuffer.length === expectedBuffer.length && timingSafeEqual(valueBuffer, expectedBuffer);
  }
}
