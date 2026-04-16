const UUID = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}';

const ROUTES: { regex: RegExp; build: (m: RegExpMatchArray) => string }[] = [
  // Sub-routes BEFORE parents — important for /spaces/:id/photos/:assetId vs /spaces/:id
  { regex: new RegExp(`^/spaces/${UUID}/photos/(${UUID})$`), build: (m) => `immich://asset?id=${m[1]}` },
  { regex: new RegExp(`^/albums/${UUID}/(${UUID})$`), build: (m) => `immich://asset?id=${m[1]}` },
  { regex: new RegExp(`^/photos/(${UUID})$`), build: (m) => `immich://asset?id=${m[1]}` },
  { regex: new RegExp(`^/albums/(${UUID})$`), build: (m) => `immich://album?id=${m[1]}` },
  { regex: new RegExp(`^/people/(${UUID})$`), build: (m) => `immich://people?id=${m[1]}` },
  { regex: new RegExp(`^/memory/(${UUID})$`), build: (m) => `immich://memory?id=${m[1]}` },
  { regex: new RegExp(`^/spaces/(${UUID})$`), build: (m) => `immich://space?id=${m[1]}` },
  { regex: /^\/memory$/, build: () => `immich://memory` },
];

export const pathToDeepLink = (pathname: string): string | null => {
  // Tolerate trailing slashes (server redirects, hand-pasted URLs).
  const normalized = pathname.length > 1 && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;
  for (const { regex, build } of ROUTES) {
    const match = normalized.match(regex);
    if (match) {
      return build(match);
    }
  }
  return null;
};

export type Platform = 'ios' | 'android';

export const detectPlatform = (userAgent: string, maxTouchPoints: number): Platform | null => {
  if (/iPhone|iPod|iPad/i.test(userAgent)) {
    return 'ios';
  }
  if (maxTouchPoints > 1 && /Macintosh/i.test(userAgent)) {
    return 'ios';
  }
  if (/Android/i.test(userAgent)) {
    return 'android';
  }
  return null;
};

export const isDismissed = (value: string | null, now: Date): boolean => {
  if (!value) {
    return false;
  }
  const ts = Date.parse(value);
  if (Number.isNaN(ts)) {
    return false;
  }
  return ts > now.getTime();
};

export type Eligibility = { eligible: false } | { eligible: true; deepLink: string; platform: Platform };

export interface EligibilityOpts {
  userAgent: string;
  maxTouchPoints: number;
  pathname: string;
  isAuthenticated: boolean;
  coldEntry: boolean;
  dismissedUntil: string | null;
  now: Date;
}

export const isEligible = (opts: EligibilityOpts): Eligibility => {
  if (!opts.coldEntry) {
    return { eligible: false };
  }
  if (!opts.isAuthenticated) {
    return { eligible: false };
  }
  if (isDismissed(opts.dismissedUntil, opts.now)) {
    return { eligible: false };
  }

  const platform = detectPlatform(opts.userAgent, opts.maxTouchPoints);
  if (!platform) {
    return { eligible: false };
  }

  const deepLink = pathToDeepLink(opts.pathname);
  if (!deepLink) {
    return { eligible: false };
  }

  return { eligible: true, platform, deepLink };
};
