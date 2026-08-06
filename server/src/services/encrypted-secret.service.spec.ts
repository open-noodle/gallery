import { BadRequestException } from '@nestjs/common';
import { ConfigRepository } from 'src/repositories/config.repository';
import { EncryptedSecretService } from 'src/services/encrypted-secret.service';
import { beforeEach, describe, expect, it, Mocked, vi } from 'vitest';

const configuredKey = 'test-encryption-key';

describe(EncryptedSecretService.name, () => {
  let sut: EncryptedSecretService;
  let configRepository: Mocked<Pick<ConfigRepository, 'getEnv'>>;

  const createService = (secretKey = configuredKey) => {
    configRepository = {
      getEnv: vi.fn().mockReturnValue({ agent: { secretKey } }),
    };

    sut = new EncryptedSecretService(configRepository as unknown as ConfigRepository);
  };

  const createServiceWithoutKey = () => {
    configRepository = {
      getEnv: vi.fn().mockReturnValue({ agent: {} }),
    };

    sut = new EncryptedSecretService(configRepository as unknown as ConfigRepository);
  };

  beforeEach(() => {
    createService();
  });

  it('encrypts without storing plaintext and decrypts the value', () => {
    const plaintext = 'provider-api-key';

    const encrypted = sut.encrypt(plaintext);

    expect(encrypted).not.toContain(plaintext);
    expect(encrypted).toMatch(/^v1:[\w-]+:[\w-]+:[\w-]+$/);
    expect(sut.decrypt(encrypted)).toBe(plaintext);
  });

  it('uses random nonces so the same plaintext does not encrypt the same way twice', () => {
    const plaintext = 'provider-api-key';

    const first = sut.encrypt(plaintext);
    const second = sut.encrypt(plaintext);

    expect(first).not.toBe(second);
    expect(sut.decrypt(first)).toBe(plaintext);
    expect(sut.decrypt(second)).toBe(plaintext);
  });

  it('accepts a base64-prefixed 32 byte key', () => {
    createService(`base64:${Buffer.alloc(32, 7).toString('base64')}`);

    const encrypted = sut.encrypt('provider-api-key');

    expect(sut.decrypt(encrypted)).toBe('provider-api-key');
  });

  it('encrypts and decrypts an empty value', () => {
    const encrypted = sut.encrypt('');

    expect(sut.decrypt(encrypted)).toBe('');
  });

  it('throws when the encryption key is missing', () => {
    createServiceWithoutKey();

    expect(() => sut.encrypt('provider-api-key')).toThrow(
      new BadRequestException('Agent credential encryption key is not configured'),
    );
  });

  it('throws when decrypting without an encryption key', () => {
    const encrypted = sut.encrypt('provider-api-key');
    createServiceWithoutKey();

    expect(() => sut.decrypt(encrypted)).toThrow(
      new BadRequestException('Agent credential encryption key is not configured'),
    );
  });

  it('throws when a base64 key is not 32 bytes', () => {
    createService(`base64:${Buffer.alloc(31, 7).toString('base64')}`);

    expect(() => sut.encrypt('provider-api-key')).toThrow(
      new BadRequestException('Agent credential encryption key must be 32 bytes'),
    );
  });

  it('throws for invalid encrypted payloads', () => {
    expect(() => sut.decrypt('not-an-encrypted-secret')).toThrow(
      new BadRequestException('Invalid encrypted secret format'),
    );
  });

  it('throws when ciphertext is tampered with', () => {
    const encrypted = sut.encrypt('provider-api-key');
    const parts = encrypted.split(':');
    parts[3] = Buffer.from('tampered').toString('base64url');

    expect(() => sut.decrypt(parts.join(':'))).toThrow(new BadRequestException('Invalid encrypted secret'));
  });

  it('throws when decrypting with a different key', () => {
    const encrypted = sut.encrypt('provider-api-key');
    createService('different-encryption-key');

    expect(() => sut.decrypt(encrypted)).toThrow(new BadRequestException('Invalid encrypted secret'));
  });

  it('throws when a base64-prefixed key is malformed', () => {
    createService('base64:not-valid-base64');

    expect(() => sut.encrypt('provider-api-key')).toThrow(
      new BadRequestException('Agent credential encryption key must be 32 bytes'),
    );
  });
});
