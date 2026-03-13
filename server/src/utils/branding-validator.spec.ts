import { BrandingConfig, validateBrandingConfig } from 'src/utils/branding-validator';
import { describe, expect, it } from 'vitest';

describe('brandingValidator', () => {
  describe('required fields', () => {
    it('should accept valid branding config', () => {
      const config = {
        registry: 'ghcr.io/open-noodle',
        serverImage: 'gallery-server',
        mlImage: 'gallery-ml',
        androidPackage: 'app.gallery.immich',
        iosBundleId: 'app.gallery.immich',
        cliName: 'gallery',
        appName: 'Gallery',
      };

      expect(() => validateBrandingConfig(config)).not.toThrow();
    });

    it('should reject missing required fields', () => {
      const config = {
        registry: 'ghcr.io/open-noodle',
        // serverImage missing
        mlImage: 'gallery-ml',
      };

      expect(() => validateBrandingConfig(config as any)).toThrow('serverImage is required');
    });

    it('should reject missing registry', () => {
      const config = {
        serverImage: 'gallery-server',
        mlImage: 'gallery-ml',
      };

      expect(() => validateBrandingConfig(config as any)).toThrow('registry is required');
    });

    it('should reject missing mlImage', () => {
      const config = {
        registry: 'ghcr.io/open-noodle',
        serverImage: 'gallery-server',
      };

      expect(() => validateBrandingConfig(config as any)).toThrow('mlImage is required');
    });
  });

  describe('field validation', () => {
    it('should reject invalid image registry URL', () => {
      const config = {
        registry: 'not a valid registry!!!',
        serverImage: 'gallery-server',
        mlImage: 'gallery-ml',
      };

      expect(() => validateBrandingConfig(config as any)).toThrow(
        'registry must be a valid URL or docker registry format',
      );
    });

    it('should accept valid registry URLs with protocols', () => {
      const configs = [
        { registry: 'https://ghcr.io/owner', serverImage: 'img', mlImage: 'img' },
        { registry: 'http://localhost:5000', serverImage: 'img', mlImage: 'img' },
        { registry: 'ghcr.io/owner', serverImage: 'img', mlImage: 'img' },
      ];

      for (const config of configs) {
        expect(() => validateBrandingConfig(config)).not.toThrow();
      }
    });

    it('should handle missing optional fields with defaults', () => {
      const config = {
        registry: 'ghcr.io/open-noodle',
        serverImage: 'gallery-server',
        mlImage: 'gallery-ml',
        // Optional fields missing
      };

      const result = validateBrandingConfig(config);
      expect(result.cliName).toBe('immich'); // default
      expect(result.appName).toBe('Immich'); // default
    });

    it('should preserve custom optional field values', () => {
      const config = {
        registry: 'ghcr.io/open-noodle',
        serverImage: 'gallery-server',
        mlImage: 'gallery-ml',
        cliName: 'mycli',
        appName: 'MyApp',
      };

      const result = validateBrandingConfig(config);
      expect(result.cliName).toBe('mycli');
      expect(result.appName).toBe('MyApp');
    });
  });

  describe('image name validation', () => {
    it('should reject malformed image names (no slashes allowed)', () => {
      const config = {
        registry: 'ghcr.io/owner',
        serverImage: 'invalid/image/name', // Not allowed
        mlImage: 'gallery-ml',
      };

      expect(() => validateBrandingConfig(config as any)).toThrow('serverImage cannot contain slashes');
    });

    it('should reject mlImage with slashes', () => {
      const config = {
        registry: 'ghcr.io/owner',
        serverImage: 'gallery-server',
        mlImage: 'invalid/ml/image',
      };

      expect(() => validateBrandingConfig(config as any)).toThrow('mlImage cannot contain slashes');
    });

    it('should allow image names with tags', () => {
      const config = {
        registry: 'ghcr.io/owner',
        serverImage: 'gallery-server:v3.0.1',
        mlImage: 'gallery-ml:cuda-v3.0.1',
      };

      expect(() => validateBrandingConfig(config)).not.toThrow();
    });

    it('should allow image names with hyphens and numbers', () => {
      const config = {
        registry: 'ghcr.io/owner',
        serverImage: 'gallery-server-2',
        mlImage: 'gallery-ml-cuda',
      };

      expect(() => validateBrandingConfig(config)).not.toThrow();
    });
  });

  describe('return value validation', () => {
    it('should return object with all required and optional fields', () => {
      const config = {
        registry: 'ghcr.io/open-noodle',
        serverImage: 'gallery-server',
        mlImage: 'gallery-ml',
      };

      const result = validateBrandingConfig(config);

      expect(result).toHaveProperty('registry');
      expect(result).toHaveProperty('serverImage');
      expect(result).toHaveProperty('mlImage');
      expect(result).toHaveProperty('cliName');
      expect(result).toHaveProperty('appName');
      expect(result).toHaveProperty('androidPackage');
      expect(result).toHaveProperty('iosBundleId');
    });

    it('should preserve all input values in output', () => {
      const config: BrandingConfig = {
        registry: 'ghcr.io/open-noodle',
        serverImage: 'gallery-server',
        mlImage: 'gallery-ml',
        androidPackage: 'app.gallery.test',
        iosBundleId: 'app.gallery.test.ios',
        cliName: 'testcli',
        appName: 'TestApp',
      };

      const result = validateBrandingConfig(config);

      expect(result.registry).toBe(config.registry);
      expect(result.serverImage).toBe(config.serverImage);
      expect(result.mlImage).toBe(config.mlImage);
      expect(result.androidPackage).toBe(config.androidPackage);
      expect(result.iosBundleId).toBe(config.iosBundleId);
      expect(result.cliName).toBe(config.cliName);
      expect(result.appName).toBe(config.appName);
    });
  });
});
