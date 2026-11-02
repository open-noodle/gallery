import z from 'zod';

// Fork S3 storage variables, merged into EnvSchema in src/dtos/env.dto.ts with one spread.

/** EnvSchema */
export const GalleryStorageEnvExtension = {
  IMMICH_STORAGE_BACKEND: z.enum(['disk', 's3']).optional(),
  IMMICH_S3_BUCKET: z.string().optional(),
  IMMICH_S3_REGION: z.string().optional(),
  IMMICH_S3_ENDPOINT: z.string().optional(),
  IMMICH_S3_ACCESS_KEY_ID: z.string().optional(),
  IMMICH_S3_SECRET_ACCESS_KEY: z.string().optional(),
  IMMICH_S3_PRESIGNED_URL_EXPIRY: z.coerce.number().int().optional(),
  IMMICH_S3_SERVE_MODE: z.enum(['redirect', 'proxy']).optional(),
};
