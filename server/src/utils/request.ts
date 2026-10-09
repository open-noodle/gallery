import { IncomingHttpHeaders } from 'node:http';
import { UAParser } from 'ua-parser-js';

export const fromChecksum = (checksum: string): Buffer => {
  return Buffer.from(checksum, checksum.length === 28 ? 'base64' : 'hex');
};

export const fromMaybeArray = <T>(param: T | T[]) => (Array.isArray(param) ? param[0] : param);

export const getAppVersionFromUA = (ua: string) =>
  ua.match(/^immich-(?:android|ios|unknown)\/(?<appVersion>.+)$/)?.groups?.appVersion ??
  // legacy format
  ua.match(/^Immich_(?:Android|iOS|Unknown)_(?<appVersion>.+)$/)?.groups?.appVersion ??
  null;

/**
 * Whether the `User-Agent` is the native mobile app's own scheme, regardless of whether a version
 * could be read out of it.
 *
 * This is deliberately **not** `getAppVersionFromUA(ua) !== null`. That is null for two unrelated
 * cases: a mobile build whose version is missing or unparseable, and every client that is not the
 * mobile app at all - a browser, the CLI, a third-party script. Behaviour that must apply only to
 * the mobile app (rather than to "anything whose version we could not read") has to tell those
 * apart, and only the UA scheme can. See `editAsset()` in src/services/asset.service.ts.
 *
 * The version group is therefore matched loosely here where `getAppVersionFromUA` requires at
 * least one character: `immich-android/` with nothing after the slash is still the mobile app,
 * it just has no usable version.
 */
export const isMobileAppUA = (ua: string) =>
  /^immich-(?:android|ios|unknown)\//.test(ua) ||
  // legacy format
  /^Immich_(?:Android|iOS|Unknown)_/.test(ua);

export const getUserAgentDetails = (headers: IncomingHttpHeaders) => {
  const userAgent = UAParser(headers['user-agent']);
  const appVersion = getAppVersionFromUA(headers['user-agent'] ?? '');

  return {
    deviceType: userAgent.browser.name || userAgent.device.type || (headers['devicemodel'] as string) || '',
    deviceOS: userAgent.os.name || (headers['devicetype'] as string) || '',
    appVersion,
  };
};
