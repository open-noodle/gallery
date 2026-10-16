import { CacheControl } from 'src/enum.js';

/**
 * Cache policy for `GET /assets/:id/video/playback`. Until an encoded video exists the route serves the original
 * under the same URL, so that response is revalidated instead of cached for a day: otherwise the browser keeps
 * replaying the original (audio only, for HEVC on browsers without HEVC decode) after the encode lands (#1176).
 */
export const videoPlaybackCacheControl = (encodedVideoPath: string | null | undefined) =>
  encodedVideoPath ? CacheControl.PrivateWithCache : CacheControl.PrivateWithoutCache;
