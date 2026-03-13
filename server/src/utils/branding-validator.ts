export interface BrandingConfig {
  registry: string;
  serverImage: string;
  mlImage: string;
  androidPackage?: string;
  iosBundleId?: string;
  cliName?: string;
  appName?: string;
}

export interface ValidatedBrandingConfig extends BrandingConfig {
  cliName: string;
  appName: string;
}

export function validateBrandingConfig(config: unknown): ValidatedBrandingConfig {
  if (!config || typeof config !== 'object') {
    throw new Error('Branding config must be an object');
  }

  const cfg = config as Record<string, any>;

  // Required fields validation
  const required = ['registry', 'serverImage', 'mlImage'];
  for (const field of required) {
    if (!cfg[field]) {
      throw new Error(`${field} is required`);
    }
  }

  // Validate registry is a URL or docker registry format
  const registryStr = String(cfg.registry);
  const isValidUrl = /^https?:\/\/.+/.test(registryStr);
  const isValidRegistry = /^[a-zA-Z0-9.-]+(:[0-9]+)?(\/.+)?$/.test(registryStr);

  if (!isValidUrl && !isValidRegistry) {
    throw new Error('registry must be a valid URL or docker registry format');
  }

  // Validate image names (no slashes, allow colons for tags)
  const imageFields = ['serverImage', 'mlImage'];
  for (const field of imageFields) {
    if (cfg[field].includes('/')) {
      throw new Error(`${field} cannot contain slashes`);
    }
  }

  // Return with defaults for optional fields
  return {
    registry: cfg.registry,
    serverImage: cfg.serverImage,
    mlImage: cfg.mlImage,
    androidPackage: cfg.androidPackage,
    iosBundleId: cfg.iosBundleId,
    cliName: cfg.cliName ?? 'immich',
    appName: cfg.appName ?? 'Immich',
  };
}
