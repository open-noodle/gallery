import { IncomingHttpHeaders } from 'node:http';
import { SemVer, coerce } from 'semver';
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

/** Stock clients see the Immich version Gallery is based on, so they do not treat Gallery's 5.x as a newer server. */
export const getClientServerVersion = (headers: IncomingHttpHeaders): SemVer =>
  isGalleryClient(headers) ? serverVersion : immichVersion;
