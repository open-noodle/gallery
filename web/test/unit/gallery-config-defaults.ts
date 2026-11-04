import type { PublicConfigDto, UserConfigDto } from '@immich/sdk';

/** Realistic user/public config defaults for specs; seeded before every test by gallery-setup.ts. */
export const defaultUserConfig = {
  ffmpeg: { realtime: { enabled: false } },
  image: {
    fullsize: { enabled: false, format: 'jpeg', quality: 80 },
    preview: { format: 'jpeg', quality: 80, size: 1440 },
    thumbnail: { format: 'webp', quality: 80, size: 250 },
  },
  machineLearning: {
    enabled: true,
    clip: { enabled: true },
    duplicateDetection: { enabled: true },
    facialRecognition: { enabled: true, minFaces: 3 },
    ocr: { enabled: true },
  },
  map: { enabled: true, darkStyle: '', lightStyle: '' },
  notifications: { smtp: { enabled: false } },
  oauth: { enabled: false, autoLaunch: false, buttonText: 'Login with OAuth' },
  passkey: { enabled: false },
  passwordLogin: { enabled: true },
  reverseGeocoding: { enabled: true },
  server: { externalDomain: '', loginPageMessage: '', publicUsers: true },
  trash: { enabled: true, days: 30 },
  user: { deleteDelay: 7 },
} as unknown as UserConfigDto;

export const defaultPublicConfig = {
  ffmpeg: { realtime: { enabled: false } },
  map: { enabled: true, darkStyle: '', lightStyle: '' },
  oauth: { enabled: false, autoLaunch: false, buttonText: 'Login with OAuth' },
  passkey: { enabled: false },
  passwordLogin: { enabled: true },
  server: { loginPageMessage: '' },
} as unknown as PublicConfigDto;
