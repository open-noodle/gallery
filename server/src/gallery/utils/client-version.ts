import { IncomingHttpHeaders } from 'node:http';
import { SemVer, coerce, lt } from 'semver';
import type { AuthDto } from 'src/dtos/auth.dto.js';
import { immichVersion, serverVersion } from 'src/constants.js';
import { getAppVersionFromUA } from 'src/utils/request.js';

/** Sent by the Gallery web, mobile and CLI clients on every request; the value is the client version. */
export const GALLERY_APP_HEADER = 'x-gallery-app';
export const GALLERY_CLIENT_VARY = 'User-Agent, X-Gallery-App';

/** Socket.io room holding every stock Immich client socket; `stockClientRoom(room)` scopes it to a user/session. */
export const STOCK_CLIENT_ROOM = 'stock-immich-client';
export const stockClientRoom = (room?: string) => (room ? `${STOCK_CLIENT_ROOM}:${room}` : STOCK_CLIENT_ROOM);

// shortcut: Gallery apps ship as 5.x+ and stock Immich apps are below 5 (base v3.3.1); revisit before Immich reaches 5.0.
const GALLERY_APP_MIN_MAJOR = 5;

/**
 * A Gallery client sends `x-gallery-app` (socket.io browsers cannot set headers, so the web sends it in the
 * handshake auth payload) or a Gallery app User-Agent (`immich-android/5.x`). Everything else, including stock
 * Immich apps, the stock CLI, third-party tools and plain browsers, is a stock client.
 */
export const isGalleryClient = (headers: IncomingHttpHeaders, socketAuth?: Record<string, unknown>): boolean => {
  if (headers[GALLERY_APP_HEADER] || socketAuth?.[GALLERY_APP_HEADER]) {
    return true;
  }

  const appVersion = coerce(getAppVersionFromUA(headers['user-agent'] ?? ''));
  return (appVersion?.major ?? 0) >= GALLERY_APP_MIN_MAJOR;
};

// immich-30831's `birthday` memory type first reached the Gallery app's generated client in 5.8.0.
const BIRTHDAY_MEMORY_MIN_APP = '5.8.0';

/**
 * `AuthService.authenticate`'s client class. Every build that sends `x-gallery-app` decodes `birthday` memories, so
 * only a Gallery app that identifies by User-Agent alone can be older than 5.8.0.
 */
export const classifyClient = (headers: IncomingHttpHeaders, auth: AuthDto): AuthDto => {
  if (!isGalleryClient(headers)) {
    return { ...auth, stockClient: true };
  }

  const appVersion = coerce(getAppVersionFromUA(headers['user-agent'] ?? ''));
  return !headers[GALLERY_APP_HEADER] && appVersion && lt(appVersion, BIRTHDAY_MEMORY_MIN_APP)
    ? { ...auth, legacyGalleryApp: true }
    : auth;
};

/** Stock clients see the Immich version Gallery is based on, so they do not treat Gallery's 5.x as a newer server. */
export const getClientServerVersion = (headers: IncomingHttpHeaders): SemVer =>
  isGalleryClient(headers) ? serverVersion : immichVersion;

const UPSTREAM_REPOSITORY = 'https://github.com/immich-app/immich';

/** `GET /server/about` for a stock client names the Immich base, the version `GET /server/version` reports to it. */
export const forClientAbout = <T extends { version: string; versionUrl: string }>(auth: AuthDto, about: T): T => {
  if (!auth.stockClient) {
    return about;
  }
  const version = `v${immichVersion}`;
  return { ...about, version, versionUrl: `${UPSTREAM_REPOSITORY}/releases/tag/${version}` };
};

/**
 * `GET /server/version-check` for a stock client: Gallery releases reach Gallery clients only, as `on_new_release`
 * does, so the latest release a stock client sees is the Immich base it is told it runs.
 */
export const forClientVersionCheck = <T extends { releaseVersion: string | null }>(auth: AuthDto, state: T): T =>
  auth.stockClient && state.releaseVersion ? { ...state, releaseVersion: `v${immichVersion}` } : state;
