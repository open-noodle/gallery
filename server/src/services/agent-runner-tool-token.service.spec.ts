import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { createHmac } from 'node:crypto';
import { ConfigRepository } from 'src/repositories/config.repository';
import { AgentRunnerToolTokenService } from 'src/services/agent-runner-tool-token.service';
import { Mocked, beforeEach, describe, expect, it, vi } from 'vitest';

const configuredKey = 'runner-tool-token-secret';

const createTokenWithClaims = (claims: unknown) => {
  const encodedClaims = Buffer.from(typeof claims === 'string' ? claims : JSON.stringify(claims)).toString('base64url');
  const signature = createHmac('sha256', configuredKey).update(encodedClaims).digest('base64url');
  return `v1.${encodedClaims}.${signature}`;
};

describe(AgentRunnerToolTokenService.name, () => {
  let sut: AgentRunnerToolTokenService;
  let configRepository: Mocked<Pick<ConfigRepository, 'getEnv'>>;

  const createService = (secretKey: string | undefined = configuredKey) => {
    configRepository = {
      getEnv: vi.fn().mockReturnValue({ agent: { secretKey } }),
    };

    sut = new AgentRunnerToolTokenService(configRepository as unknown as ConfigRepository);
  };

  const createServiceWithoutKey = () => {
    configRepository = {
      getEnv: vi.fn().mockReturnValue({ agent: {} }),
    };

    sut = new AgentRunnerToolTokenService(configRepository as unknown as ConfigRepository);
  };

  beforeEach(() => {
    createService();
  });

  it('creates and verifies a session-scoped token', () => {
    const expiresAt = new Date('2026-05-15T12:00:00.000Z');

    const token = sut.create({
      sessionId: '00000000-0000-4000-8000-000000000100',
      userId: '00000000-0000-4000-8000-000000000001',
      expiresAt,
    });

    expect(token).toMatch(/^v1\.[\w-]+\.[\w-]+$/);
    expect(sut.verify(token, new Date('2026-05-15T11:59:00.000Z'))).toEqual({
      sessionId: '00000000-0000-4000-8000-000000000100',
      userId: '00000000-0000-4000-8000-000000000001',
      expiresAt,
    });
  });

  it('rejects tampered tokens', () => {
    const token = sut.create({
      sessionId: '00000000-0000-4000-8000-000000000100',
      userId: '00000000-0000-4000-8000-000000000001',
      expiresAt: new Date('2026-05-15T12:00:00.000Z'),
    });
    const parts = token.split('.');
    parts[1] = Buffer.from(
      JSON.stringify({
        sessionId: '00000000-0000-4000-8000-000000000100',
        userId: '00000000-0000-4000-8000-000000000002',
        expiresAt: '2026-05-15T12:00:00.000Z',
      }),
    ).toString('base64url');

    expect(() => sut.verify(parts.join('.'), new Date('2026-05-15T11:00:00.000Z'))).toThrow(
      new UnauthorizedException('Invalid agent runner token'),
    );
  });

  it('rejects expired tokens', () => {
    const token = sut.create({
      sessionId: '00000000-0000-4000-8000-000000000100',
      userId: '00000000-0000-4000-8000-000000000001',
      expiresAt: new Date('2026-05-15T12:00:00.000Z'),
    });

    expect(() => sut.verify(token, new Date('2026-05-15T12:00:01.000Z'))).toThrow(
      new UnauthorizedException('Agent runner token expired'),
    );
  });

  it('rejects token creation when the agent secret key is missing', () => {
    createServiceWithoutKey();

    expect(() =>
      sut.create({
        sessionId: '00000000-0000-4000-8000-000000000100',
        userId: '00000000-0000-4000-8000-000000000001',
        expiresAt: new Date('2026-05-15T12:00:00.000Z'),
      }),
    ).toThrow(new BadRequestException('Agent credential encryption key is not configured'));
  });

  it('rejects token verification as invalid when the agent secret key is missing', () => {
    const token = createTokenWithClaims({
      sessionId: '00000000-0000-4000-8000-000000000100',
      userId: '00000000-0000-4000-8000-000000000001',
      expiresAt: '2026-05-15T12:00:00.000Z',
    });
    createServiceWithoutKey();

    expect(() => sut.verify(token, new Date('2026-05-15T11:00:00.000Z'))).toThrow(
      new UnauthorizedException('Invalid agent runner token'),
    );
  });

  it.each(['not-a-token', 'v2.e30.signature', 'v1.not-json.signature'])('rejects malformed token %s', (token) => {
    expect(() => sut.verify(token)).toThrow(new UnauthorizedException('Invalid agent runner token'));
  });

  it('rejects a correctly signed non-json payload', () => {
    expect(() => sut.verify(createTokenWithClaims('not-json'))).toThrow(
      new UnauthorizedException('Invalid agent runner token'),
    );
  });

  it('rejects invalid claims', () => {
    expect(() =>
      sut.verify(
        createTokenWithClaims({
          sessionId: '00000000-0000-4000-8000-000000000100',
          expiresAt: '2026-05-15T12:00:00.000Z',
        }),
      ),
    ).toThrow(new UnauthorizedException('Invalid agent runner token'));
  });

  it('rejects invalid claim dates', () => {
    expect(() =>
      sut.verify(
        createTokenWithClaims({
          sessionId: '00000000-0000-4000-8000-000000000100',
          userId: '00000000-0000-4000-8000-000000000001',
          expiresAt: 'not-a-date',
        }),
      ),
    ).toThrow(new UnauthorizedException('Invalid agent runner token'));
  });

  it('rejects expired correctly signed claims', () => {
    expect(() =>
      sut.verify(
        createTokenWithClaims({
          sessionId: '00000000-0000-4000-8000-000000000100',
          userId: '00000000-0000-4000-8000-000000000001',
          expiresAt: '2026-05-15T12:00:00.000Z',
        }),
        new Date('2026-05-15T12:00:01.000Z'),
      ),
    ).toThrow(new UnauthorizedException('Agent runner token expired'));
  });
});
