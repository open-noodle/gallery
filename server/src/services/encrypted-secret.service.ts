import { BadRequestException, Injectable } from '@nestjs/common';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { ConfigRepository } from 'src/repositories/config.repository';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const KEY_LENGTH = 32;
const FORMAT_VERSION = 'v1';
const BASE64_PREFIX = 'base64:';
const BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const BASE64URL_PATTERN = /^[\w-]*$/;

@Injectable()
export class EncryptedSecretService {
  constructor(private readonly configRepository: ConfigRepository) {}

  encrypt(plaintext: string) {
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv(ALGORITHM, this.getKey(), iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();

    return [FORMAT_VERSION, iv.toString('base64url'), tag.toString('base64url'), ciphertext.toString('base64url')].join(
      ':',
    );
  }

  decrypt(encryptedSecret: string) {
    const { iv, tag, ciphertext } = this.parseEncryptedSecret(encryptedSecret);
    const key = this.getKey();

    try {
      const decipher = createDecipheriv(ALGORITHM, key, iv);
      decipher.setAuthTag(tag);
      const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);

      return plaintext.toString('utf8');
    } catch {
      throw new BadRequestException('Invalid encrypted secret');
    }
  }

  private getKey() {
    const secretKey = this.configRepository.getEnv().agent.secretKey;
    if (!secretKey) {
      throw new BadRequestException('Agent credential encryption key is not configured');
    }

    if (secretKey.startsWith(BASE64_PREFIX)) {
      const encodedKey = secretKey.slice(BASE64_PREFIX.length);
      const key = BASE64_PATTERN.test(encodedKey) ? Buffer.from(encodedKey, 'base64') : Buffer.alloc(0);
      if (key.length !== KEY_LENGTH) {
        throw new BadRequestException('Agent credential encryption key must be 32 bytes');
      }

      return key;
    }

    return createHash('sha256').update(secretKey).digest();
  }

  private parseEncryptedSecret(encryptedSecret: string) {
    const parts = encryptedSecret.split(':');
    if (parts.length !== 4 || parts[0] !== FORMAT_VERSION) {
      throw new BadRequestException('Invalid encrypted secret format');
    }

    const [, ivPart, tagPart, ciphertextPart] = parts;
    if (!this.isBase64Url(ivPart) || !this.isBase64Url(tagPart) || !this.isBase64Url(ciphertextPart)) {
      throw new BadRequestException('Invalid encrypted secret format');
    }

    const iv = Buffer.from(ivPart, 'base64url');
    const tag = Buffer.from(tagPart, 'base64url');
    const ciphertext = Buffer.from(ciphertextPart, 'base64url');

    if (iv.length !== IV_LENGTH || tag.length === 0) {
      throw new BadRequestException('Invalid encrypted secret format');
    }

    return { iv, tag, ciphertext };
  }

  private isBase64Url(value: string) {
    return BASE64URL_PATTERN.test(value);
  }
}
